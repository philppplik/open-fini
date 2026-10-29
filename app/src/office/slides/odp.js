// OpenDocument presentation (.odp, flat .fodp, template .otp) reader and .odp writer for the Presentation app. Pure (no
// DOM). Best effort like the PowerPoint codec (docs/office-slides.md ▸ Fidelity): pages, frames with text (title,
// subtitle and outline placeholders), custom shapes, rectangles, ellipses, lines, pictures, tables, page backgrounds,
// speaker notes, fade/slide transitions and hidden pages. The deck theme travels in a meta.xml user-defined field so a
// round trip through OpenFini keeps it; other producers get explicit colors and fonts.
//
// Public API
//   readOdp(bytes, { report, flat }) → deck
//   writeOdp(deck, { title }) → Uint8Array
import { readZip, writeZip, text as zipText } from "../../engine/office/zip.js";
import { parseXml, child, children, find, findAll, attr, esc, escAttr } from "../../engine/office/xml.js";
import { sniffImage, imageSize } from "../../engine/office/media.js";
import { normalizeDeck, newId } from "./model.js";

const UNIT = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, px: 1 };
const len = (v, d = 0) => {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?$/.exec(String(v ?? "").trim());
  return m ? +m[1] * (UNIT[m[2] || "px"] || 1) : d;
};
const ptOf = (v) => {
  const m = /^([\d.]+)\s*(pt|px|cm|mm|in)?$/.exec(String(v ?? "").trim());
  return m ? (m[2] && m[2] !== "pt" ? (len(v) * 72) / 96 : +m[1]) : null;
};
const hexColor = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || "")) ? String(v).toLowerCase() : null);
const GEOM = { rectangle: "rect", "round-rectangle": "roundRect", ellipse: "ellipse", circle: "ellipse", "isosceles-triangle": "triangle", diamond: "diamond", "right-arrow": "arrow" };
const GEOM_OUT = { rect: "rectangle", roundRect: "round-rectangle", ellipse: "ellipse", triangle: "isosceles-triangle", diamond: "diamond", arrow: "right-arrow" };
const ALIGN = { start: "left", left: "left", center: "center", end: "right", right: "right", justify: "justify" };

/**
 * @param {Uint8Array} bytes
 * @param {{ report?: any, flat?: boolean }} [o]
 */
export function readOdp(bytes, { report, flat = false } = {}) {
  let content, styles, meta;
  let entries = {};
  if (flat || !(bytes?.[0] === 0x50 && bytes[1] === 0x4b)) {
    content = styles = meta = parseXml(new TextDecoder().decode(bytes));
    if (!find(content, "presentation")) throw new Error("This XML file is not an OpenDocument presentation.");
  } else {
    const z = readZip(bytes);
    if (!z.ok) throw new Error(z.problems[z.problems.length - 1] || "The file is not an OpenDocument package.");
    report?.warnings(z.problems);
    entries = z.entries;
    const mt = zipText(entries, "mimetype") || "";
    if (mt && !/opendocument\.presentation/.test(mt)) throw new Error("This OpenDocument file is not a presentation.");
    content = parseXml(zipText(entries, "content.xml") || "");
    styles = parseXml(zipText(entries, "styles.xml") || "");
    meta = parseXml(zipText(entries, "meta.xml") || "");
  }
  const pres = find(content, "presentation");
  if (!pres) throw new Error("The file has no presentation content.");

  // styles: name → element (automatic and common styles of both parts)
  const S = new Map();
  for (const root of [styles, content]) {
    for (const st of [...findAll(root, "style:style"), ...findAll(root, "style:page-layout")]) S.set(`${attr(st, "style:family") || "page-layout"}:${attr(st, "style:name")}`, st);
  }
  const props = (family, name, tag) => {
    const out = {};
    const chain = [];
    for (let k = 0, n = name; n && k < 6; k++) {
      const st = S.get(`${family}:${n}`);
      if (!st) break;
      chain.unshift(st);
      n = attr(st, "style:parent-style-name");
    }
    for (const st of chain) Object.assign(out, child(st, tag)?.attrs || {});
    return out;
  };
  const prop = (o, n) => o[n] ?? o[n.slice(n.indexOf(":") + 1)];

  // page size and master background
  const master = find(styles, "style:master-page");
  const pl = S.get(`page-layout:${attr(master, "style:page-layout-name")}`);
  const plp = child(pl, "style:page-layout-properties");
  const size = { w: Math.round(len(attr(plp, "fo:page-width"), 1058)), h: Math.round(len(attr(plp, "fo:page-height"), 595)) };
  const masterBg = bgOf(props("drawing-page", attr(master, "draw:style-name"), "style:drawing-page-properties"));

  // theme saved by OpenFini
  let theme = { id: "office" };
  for (const u of findAll(meta, "meta:user-defined")) {
    if (attr(u, "meta:name") !== "OpenFini theme") continue;
    try {
      theme = JSON.parse(u.children.filter((c) => typeof c === "string").join(""));
    } catch {
      /* keep the default theme */
    }
  }
  if (!theme.bg && masterBg?.color) theme.bg = masterBg.color;

  // media
  const media = {};
  const mediaFor = (img) => {
    let b = null;
    const href = attr(img, "xlink:href");
    if (href && entries[href]) b = entries[href];
    else {
      const bin = find(img, "office:binary-data");
      if (bin) try {
        b = Uint8Array.from(atob(bin.children.join("").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
      } catch {
        b = null;
      }
    }
    const mime = b && sniffImage(b, href || "");
    if (!mime) {
      report?.dropped("Pictures in formats OpenFini cannot show (EMF, WMF, linked files) were left out.");
      return null;
    }
    const id = newId("m");
    const s = imageSize(b, mime) || {};
    media[id] = { id, mime, name: String(href || "image").split("/").pop(), w: s.w || 0, h: s.h || 0, bytes: b };
    return id;
  };
  function bgOf(p) {
    if (prop(p, "draw:fill") === "solid" && hexColor(prop(p, "draw:fill-color"))) return { color: hexColor(prop(p, "draw:fill-color")) };
    return null;
  }

  const textOf = (el, ctx) => {
    // paragraphs of a text-box or shape: text:p, text:h, text:list
    const paras = [];
    let first = null;
    let list = false;
    const inline = (n) => {
      let s = "";
      for (const c of n.children) {
        if (typeof c === "string") s += c;
        else if (c.name === "text:span" || c.name === "text:a") {
          if (!first) first = attr(c, "text:style-name");
          s += inline(c);
        } else if (c.name === "text:line-break") s += "\n";
        else if (c.name === "text:tab") s += "\t";
        else if (c.name === "text:s") s += " ".repeat(Math.min(100, +attr(c, "text:c") || 1));
      }
      return s;
    };
    let pstyle = null;
    const walk = (n) => {
      for (const c of children(n)) {
        if (c.name === "text:p" || c.name === "text:h") {
          pstyle ||= attr(c, "text:style-name");
          paras.push(inline(c));
        } else if (c.name === "text:list") {
          list = true;
          walk(c);
        } else if (c.name === "text:list-item" || c.name === "text:list-header") walk(c);
      }
    };
    walk(el);
    const pp = props("paragraph", pstyle, "style:paragraph-properties");
    const tp = { ...ctx.text, ...props("paragraph", pstyle, "style:text-properties"), ...props("text", first, "style:text-properties") };
    return {
      text: paras.join("\n"),
      style: {
        size: ptOf(prop(tp, "fo:font-size")) || ctx.size,
        color: hexColor(prop(tp, "fo:color")),
        bold: prop(tp, "fo:font-weight") === "bold" || +prop(tp, "fo:font-weight") >= 600,
        italic: prop(tp, "fo:font-style") === "italic",
        underline: !!prop(tp, "style:text-underline-style") && prop(tp, "style:text-underline-style") !== "none",
        font: prop(tp, "fo:font-family")?.replace(/['"]/g, "") || prop(tp, "style:font-name") || null,
        align: ALIGN[prop(pp, "fo:text-align") || prop(ctx.para, "fo:text-align")] || "left",
        valign: { top: "top", middle: "middle", bottom: "bottom" }[prop(ctx.graphic, "draw:textarea-vertical-align")] || ctx.valign,
        bullets: list,
      },
    };
  };

  const boxOf = (el) => {
    const w = len(attr(el, "svg:width"));
    const h = len(attr(el, "svg:height"));
    const tf = attr(el, "draw:transform");
    if (tf) {
      const rot = /rotate\s*\(\s*(-?[\d.e-]+)\s*\)/.exec(tf);
      const tr = /translate\s*\(\s*(-?[\d.]+\w*)\s+(-?[\d.]+\w*)\s*\)/.exec(tf);
      const th = rot ? +rot[1] : 0;
      const phi = -th; // ODF angles are counter-clockwise; ours are clockwise in a y-down space
      const tx = tr ? len(tr[1]) : 0, ty = tr ? len(tr[2]) : 0;
      const cx = (w / 2) * Math.cos(phi) - (h / 2) * Math.sin(phi) + tx;
      const cy = (w / 2) * Math.sin(phi) + (h / 2) * Math.cos(phi) + ty;
      return { x: cx - w / 2, y: cy - h / 2, w, h, rot: Math.round(((phi * 180) / Math.PI) * 100) / 100 };
    }
    return { x: len(attr(el, "svg:x")), y: len(attr(el, "svg:y")), w, h, rot: 0 };
  };

  const ctxOf = (el, cls) => {
    const sn = attr(el, "presentation:style-name") || attr(el, "draw:style-name");
    const fam = attr(el, "presentation:style-name") ? "presentation" : "graphic";
    const graphic = props(fam, sn, "style:graphic-properties");
    return { graphic, text: props(fam, sn, "style:text-properties"), para: props(fam, sn, "style:paragraph-properties"), size: cls === "title" ? 40 : cls ? 22 : 18, valign: cls === "title" ? "middle" : "top" };
  };
  const paint = (g, shape) => ({
    fill: prop(g, "draw:fill") === "none" ? null : hexColor(prop(g, "draw:fill-color")) || (shape && prop(g, "draw:fill") !== "none" ? "#729fcf" : null),
    stroke: prop(g, "draw:stroke") === "none" ? null : hexColor(prop(g, "svg:stroke-color")) || (shape && prop(g, "draw:stroke") !== "none" ? "#3465a4" : null),
    strokeWidth: Math.max(prop(g, "draw:stroke") === "none" ? 0 : 1, len(prop(g, "svg:stroke-width"), 1)),
  });
  const ROLE = { title: "title", subtitle: "subtitle", outline: "body" };

  const readItems = (parent, out) => {
    let bodies = 0;
    for (const el of children(parent)) {
      try {
        if (el.name === "draw:frame") {
          const cls = attr(el, "presentation:class");
          if (cls === "notes" || cls === "page-number" || cls === "footer" || cls === "date-time" || cls === "header") continue;
          let role = ROLE[cls] || null;
          if (role === "body" && bodies++ === 1) role = "body2";
          const box = boxOf(el);
          const ctx = ctxOf(el, role);
          const tb = child(el, "draw:text-box");
          const img = child(el, "draw:image");
          const tbl = child(el, "table:table");
          if (tb) {
            const t = textOf(tb, ctx);
            out.push({ type: "text", ...(role ? { ph: role } : {}), ...box, ...paint(ctx.graphic, false), text: t.text, style: { ...t.style, bullets: t.style.bullets || role === "body" || role === "body2" } });
          } else if (img) {
            const id = mediaFor(img);
            if (id) out.push({ type: "image", media: id, ...box });
          } else if (tbl) {
            const rows = findAll(tbl, "table:table-row").map((r) => children(r, "table:table-cell").flatMap((c) => Array(Math.min(50, +attr(c, "table:number-columns-repeated") || 1)).fill(children(c, "text:p").map((p) => p.children.filter((x) => typeof x === "string").join("") || find(p, "text:span")?.children.join("") || "").join("\n"))));
            out.push({ type: "table", rows, ...box, style: { size: 14 } });
          } else report?.dropped("Charts, embedded objects and media were left out.");
        } else if (el.name === "draw:custom-shape" || el.name === "draw:rect" || el.name === "draw:ellipse" || el.name === "draw:circle") {
          const g = find(el, "draw:enhanced-geometry");
          const kind = el.name === "draw:custom-shape" ? GEOM[attr(g, "draw:type")] : el.local === "rect" ? (attr(el, "draw:corner-radius") ? "roundRect" : "rect") : "ellipse";
          if (!kind) report?.flattened("Shapes without a simple equivalent became rectangles.");
          const ctx = ctxOf(el, null);
          const t = textOf(el, { ...ctx, valign: "middle" });
          out.push({ type: "shape", shape: kind || "rect", ...boxOf(el), ...paint(ctx.graphic, true), text: t.text, style: { ...t.style, align: t.text ? t.style.align : "center" } });
        } else if (el.name === "draw:line") {
          const x1 = len(attr(el, "svg:x1")), y1 = len(attr(el, "svg:y1")), x2 = len(attr(el, "svg:x2")), y2 = len(attr(el, "svg:y2"));
          const ctx = ctxOf(el, null);
          out.push({ type: "shape", shape: "line", x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.abs(y2 - y1), flipV: (x2 - x1) * (y2 - y1) < 0, ...paint(ctx.graphic, true), fill: null });
        } else if (el.name === "draw:g") {
          readItems(el, out);
          report?.flattened("Grouped objects were ungrouped.");
        } else if (el.name === "draw:connector" || el.name === "draw:path" || el.name === "draw:polygon" || el.name === "draw:polyline") {
          report?.dropped("Connectors, free-form paths and polygons were left out.");
        }
      } catch {
        report?.dropped("An object that could not be read was left out.");
      }
    }
    return out;
  };

  const slides = [];
  for (const page of children(pres, "draw:page")) {
    const elements = readItems(page, []);
    const dp = props("drawing-page", attr(page, "draw:style-name"), "style:drawing-page-properties");
    const smil = prop(dp, "smil:type");
    const dur = parseFloat(prop(dp, "smil:dur") || prop(dp, "presentation:duration") || "");
    const transition = { type: !smil ? "none" : smil === "fade" ? "fade" : "slide", duration: Number.isFinite(dur) && dur > 0 ? dur : prop(dp, "presentation:transition-speed") === "slow" ? 1 : 0.5 };
    let notes = "";
    const nf = findAll(child(page, "presentation:notes"), "draw:frame").find((f) => attr(f, "presentation:class") === "notes");
    if (nf) notes = textOf(child(nf, "draw:text-box") || nf, { graphic: {}, text: {}, para: {}, size: 12, valign: "top" }).text;
    if (find(page, "anim:par")) report?.dropped("Animations were left out (slide transitions are kept).");
    const roles = elements.map((e) => e.ph);
    const layout = roles.includes("subtitle") && roles.includes("title") ? "title" : roles.includes("body2") ? "two-content" : roles.includes("body") ? "title-content" : roles.includes("title") ? "title-only" : "blank";
    slides.push({ id: newId("s"), layout, background: bgOf(dp), elements, notes, transition, ...(prop(dp, "presentation:visibility") === "hidden" ? { hidden: true } : {}) });
  }
  const title = find(meta, "dc:title");
  const deck = normalizeDeck({ size, theme, meta: { title: title ? title.children.join("") : "" }, slides, media });
  report?.kept(`${deck.slides.length} slides with text, shapes, pictures, tables, backgrounds and speaker notes`);
  report?.flattened("Text formatting was reduced to one style per text box.");
  return deck;
}

// ---------------------------------------------------------------- writer

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0" xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0" office:version="1.3"';
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const cm = (px) => `${(Math.round(((Number(px) || 0) * 2.54 * 1000) / 96) / 1000).toFixed(3)}cm`;
const MEDIA_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };
const TALIGN = { left: "start", center: "center", right: "end", justify: "justify" };

/** Writes a deck as an OpenDocument presentation (.odp). */
export function writeOdp(deck, { title = "" } = {}) {
  const t = deck.theme;
  const auto = [];
  const fillImages = [];
  const pics = {};
  let n = 0;
  for (const [id, m] of Object.entries(deck.media || {})) if (m.bytes && MEDIA_EXT[m.mime]) pics[id] = `Pictures/${id}.${MEDIA_EXT[m.mime]}`;
  const style = (family, propsXml) => {
    const name = `${{ graphic: "gr", paragraph: "P", text: "T", "drawing-page": "dp", "table-cell": "ce" }[family]}${++n}`;
    auto.push(`<style:style style:name="${name}" style:family="${family}">${propsXml}</style:style>`);
    return name;
  };
  // colors and fonts that come from the theme are left to the default style, so they follow the theme after a round trip
  const textProps = (st) => `<style:text-properties fo:font-size="${st.size}pt"${st.color ? ` fo:color="${st.color}"` : ""}${st.font ? ` fo:font-family="${escAttr(st.font)}"` : ""} fo:font-weight="${st.bold ? "bold" : "normal"}" fo:font-style="${st.italic ? "italic" : "normal"}" style:text-underline-style="${st.underline ? "solid" : "none"}"/>`;
  const paras = (e) => {
    const st = e.style;
    const P = style("paragraph", `<style:paragraph-properties fo:text-align="${TALIGN[st.align] || "start"}"/>${textProps(st)}`);
    const T = style("text", textProps(st));
    const ps = String(e.text ?? "").split("\n").map((line) => `<text:p text:style-name="${P}">${line ? `<text:span text:style-name="${T}">${esc(line)}</text:span>` : ""}</text:p>`);
    return st.bullets ? `<text:list text:style-name="L1">${ps.map((p) => `<text:list-item>${p}</text:list-item>`).join("")}</text:list>` : ps.join("");
  };
  const placement = (e) => {
    if (!e.rot) return `svg:x="${cm(e.x)}" svg:y="${cm(e.y)}" svg:width="${cm(e.w)}" svg:height="${cm(e.h)}"`;
    const phi = (e.rot * Math.PI) / 180;
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const tx = cx - ((e.w / 2) * Math.cos(phi) - (e.h / 2) * Math.sin(phi));
    const ty = cy - ((e.w / 2) * Math.sin(phi) + (e.h / 2) * Math.cos(phi));
    return `svg:width="${cm(e.w)}" svg:height="${cm(e.h)}" draw:transform="rotate (${(-phi).toFixed(6)}) translate (${cm(tx)} ${cm(ty)})"`;
  };
  const graphic = (e, extra = "") => style("graphic", `<style:graphic-properties draw:fill="${e.fill ? "solid" : "none"}"${e.fill ? ` draw:fill-color="${e.fill}"` : ""} draw:stroke="${e.stroke && e.strokeWidth ? "solid" : "none"}"${e.stroke ? ` svg:stroke-color="${e.stroke}" svg:stroke-width="${cm(e.strokeWidth)}"` : ""} draw:textarea-vertical-align="${e.style?.valign || "top"}" draw:auto-grow-height="false" fo:padding="0.125cm"${extra}/>`);
  const CLASS = { title: "title", subtitle: "subtitle", body: "outline", body2: "outline" };

  const element = (e) => {
    if (e.type === "image") {
      if (!pics[e.media]) return "";
      return `<draw:frame draw:style-name="${graphic({ ...e, fill: null, stroke: null })}" ${placement(e)}><draw:image xlink:href="${pics[e.media]}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
    }
    if (e.type === "table") {
      const cols = e.rows[0].length;
      const ce = style("table-cell", `<style:table-cell-properties fo:border="0.03cm solid ${e.stroke || "#9ca3af"}"${e.fill ? ` fo:background-color="${e.fill}"` : ""} fo:padding="0.1cm"/>`);
      const rows = e.rows.map((r) => `<table:table-row>${r.map((c) => `<table:table-cell table:style-name="${ce}" office:value-type="string">${paras({ ...e, text: c, style: { ...e.style, bullets: false } })}</table:table-cell>`).join("")}</table:table-row>`).join("");
      return `<draw:frame draw:style-name="${graphic({ fill: null, stroke: null })}" ${placement(e)}><table:table>${`<table:table-column/>`.repeat(cols)}${rows}</table:table></draw:frame>`;
    }
    if (e.type === "shape" && e.shape === "line") {
      const x1 = e.flipH ? e.x + e.w : e.x, x2 = e.flipH ? e.x : e.x + e.w, y1 = e.flipV ? e.y + e.h : e.y, y2 = e.flipV ? e.y : e.y + e.h;
      return `<draw:line draw:style-name="${graphic({ ...e, fill: null })}" svg:x1="${cm(x1)}" svg:y1="${cm(y1)}" svg:x2="${cm(x2)}" svg:y2="${cm(y2)}"/>`;
    }
    if (e.type === "shape") {
      return `<draw:custom-shape draw:style-name="${graphic(e)}" ${placement(e)}>${paras(e)}<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="${GEOM_OUT[e.shape] || "rectangle"}"/></draw:custom-shape>`;
    }
    const cls = CLASS[e.ph];
    return `<draw:frame draw:style-name="${graphic(e)}"${cls ? ` presentation:class="${cls}" presentation:user-transformed="true"` : ""} ${placement(e)}><draw:text-box>${paras(e)}</draw:text-box></draw:frame>`;
  };

  const pages = deck.slides.map((s, i) => {
    let fill = "";
    if (s.background?.color) fill = ` draw:fill="solid" draw:fill-color="${s.background.color}"`;
    else if (s.background?.media && pics[s.background.media]) {
      const name = `bg${i + 1}`;
      fillImages.push(`<draw:fill-image draw:name="${name}" xlink:href="${pics[s.background.media]}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`);
      fill = ` draw:fill="bitmap" draw:fill-image-name="${name}" style:repeat="stretch"`;
    }
    const tr = s.transition.type === "fade" ? ` smil:type="fade" smil:subtype="crossfade" smil:dur="${s.transition.duration}s"` : s.transition.type === "slide" ? ` smil:type="pushWipe" smil:subtype="fromRight" smil:dur="${s.transition.duration}s"` : "";
    const dp = style("drawing-page", `<style:drawing-page-properties presentation:background-visible="true" presentation:background-objects-visible="true"${fill}${tr}${s.hidden ? ' presentation:visibility="hidden"' : ""}/>`);
    const notes = s.notes ? `<presentation:notes><draw:frame presentation:class="notes" svg:x="2cm" svg:y="14cm" svg:width="17cm" svg:height="12cm"><draw:text-box>${paras({ text: s.notes, style: { size: 12, align: "left", bullets: false } })}</draw:text-box></draw:frame></presentation:notes>` : "";
    return `<draw:page draw:name="page${i + 1}" draw:style-name="${dp}" draw:master-page-name="Default">${s.elements.map(element).join("")}${notes}</draw:page>`;
  });
  const listStyle = `<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet></text:list-style>`;
  const contentXml = `${HEAD}<office:document-content ${NS}><office:automatic-styles>${auto.join("")}${listStyle}</office:automatic-styles><office:body><office:presentation>${pages.join("")}</office:presentation></office:body></office:document-content>`;
  const stylesXml = `${HEAD}<office:document-styles ${NS}><office:styles>${fillImages.join("")}<style:default-style style:family="graphic"><style:graphic-properties svg:stroke-color="#3465a4" draw:fill-color="#729fcf"/><style:text-properties fo:font-family="${escAttr(t.body)}" fo:font-size="18pt" fo:color="${t.text}"/></style:default-style></office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="${cm(deck.size.w)}" fo:page-height="${cm(deck.size.h)}" style:print-orientation="${deck.size.w >= deck.size.h ? "landscape" : "portrait"}"/></style:page-layout><style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="${t.bg}"/></style:style></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp1"/></office:master-styles></office:document-styles>`;
  const themeJson = JSON.stringify({ id: t.id, name: t.name, bg: t.bg, text: t.text, accent: t.accent, accent2: t.accent2, heading: t.heading, body: t.body });
  const metaXml = `${HEAD}<office:document-meta ${NS}><office:meta><meta:generator>OpenFini</meta:generator><dc:title>${esc(deck.meta?.title || title || "")}</dc:title><meta:user-defined meta:name="OpenFini theme">${esc(themeJson)}</meta:user-defined></office:meta></office:document-meta>`;
  const manifest = `${HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.presentation"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${Object.entries(pics).map(([id, p]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${deck.media[id].mime}"/>`).join("")}</manifest:manifest>`;
  return writeZip([
    ["mimetype", "application/vnd.oasis.opendocument.presentation", { store: true }],
    ["content.xml", contentXml],
    ["styles.xml", stylesXml],
    ["meta.xml", metaXml],
    ["META-INF/manifest.xml", manifest],
    ...Object.entries(pics).map(([id, p]) => [p, deck.media[id].bytes]),
  ]);
}
