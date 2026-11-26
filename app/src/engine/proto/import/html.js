// HTML and CSS → Proto layers (docs/concepts/proto-studio.md §10.4, task T8). Pure.
//
//   importHtml(html, { model, width?, probe?, name?, random? }) → { ops, roots, pages: [], report, size }
//       probe   the tree the app's sandboxed preview frame reported (proto/html-probe.js: computed styles and boxes);
//               without it the static path (html-static.js) computes the styles in Node, approximately
//   mapProbe(probe, { builder, report, width, exact }) → root layer trees
//
// A probe tree node is { tag, attrs, style: { longhand: computed value }, decl: { width, height, flex-basis,
// grid-template-* as declared }, box?: { x, y, w, h } (page coordinates), kids: [node | { text, box? }], svg? }.
//
// Mapping: flex containers become flex auto layout (direction, wrap, gaps, padding, alignment); grid containers
// grid layout (tracks with fr, px, auto and minmax from the declared template); other blocks a column auto layout
// whose gap is the space between the children (margins; uneven spacing is evened out and reported) or, when every
// child is inline, a wrapping row. Sizes are fixed, hug, fill or a percentage where the declared values and the
// parent's layout say so (fill: `flex-grow`, stretching, 100 % or block width; hug: auto sizes, fit-content). Absolute
// and fixed elements become absolute layers. Elements with only inline content become text layers with one run per
// styled piece (bold, italic, color, size); decorated ones (a background, a border, padding) become a frame around
// the text. `img` with embedded data becomes an image layer, inline `svg` the SVG importer's layers. Backgrounds
// (colors, gradients, data: images), borders, outlines, radii, shadows, blur, opacity, blend modes, rotation and
// clipping map to the matching fields. Custom properties of :root become a variable collection, and colors equal to
// exactly one of them are bound. Repeated sibling structures are offered as component candidates in the report.
// `data-proto-id` attributes (Proto's own exports) keep their layer ids, so the round trip is lossless for what Proto
// can express. Everything else (pseudo-elements, transforms other than rotation, tables' exact column widths, list
// markers, form control internals, video, canvas) is reported.
import { createBuilder, spec, ImportReport, checkSize, cssColor, hexA, dataUrlBytes, r2, num, cleanName, finite, imageSize } from "./common.js";
import { sanitizeHtml } from "./sanitize.js";
import { staticProbe, splitTop } from "./html-static.js";
import { svgTree } from "./svg.js";

const SEMANTIC = new Set(["header", "footer", "main", "nav", "section", "article", "aside", "form", "button", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "p", "label", "figure", "figcaption", "blockquote", "img", "input", "textarea", "select", "table", "dialog", "menu", "address", "small", "strong", "em", "code", "pre", "span", "time"]);
const TAG_NAMES = { header: "Header", footer: "Footer", main: "Main", nav: "Navigation", section: "Section", article: "Article", aside: "Aside", form: "Form", button: "Button", a: "Link", ul: "List", ol: "List", li: "List item", figure: "Figure", table: "Table", tr: "Row", td: "Cell", th: "Cell", input: "Input", textarea: "Text area", select: "Select", img: "Image", label: "Label", body: "Page", hr: "Divider", video: "Video", canvas: "Canvas" };
const INLINE_TEXT = new Set(["inline", "contents"]);
const ATOMIC = new Set(["img", "svg", "input", "textarea", "select", "video", "canvas", "hr", "iframe", "audio", "progress", "meter"]);

const px = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const st = (n, k) => (n.style && n.style[k] !== undefined ? String(n.style[k]).trim() : "");
const isText = (k) => typeof k?.text === "string";

/**
 * @param {string} html
 * @param {{ model: object, width?: number, height?: number, probe?: object, name?: string, random?: () => number, report?: ImportReport, builder?: object }} o
 */
export function importHtml(html, { model, width = 1280, height = 800, probe = null, name = "HTML", random, report = null, builder = null } = {}) {
  html = String(html ?? "");
  checkSize(html.length, "html");
  report ||= new ImportReport("HTML", name);
  const b = builder || createBuilder(model, { random, report });
  let tree = probe;
  if (!tree) {
    const clean = sanitizeHtml(html, { report }).html;
    tree = staticProbe(clean, { width, height, report });
    report.note("Imported without a browser (static path): sizes and positions are approximate.");
  }
  const roots = mapProbe(tree, { builder: b, report, width, name, exact: !!probe, fragment: !/<(html|body)[\s>]/i.test(html) });
  for (const r of roots) b.add(r, { page: null });
  const size = roots.length ? { w: Math.max(...roots.map((r) => num(r.fields.x) + num(r.fields.w?.value, width))), h: Math.max(...roots.map((r) => num(r.fields.y) + num(r.fields.h?.value, 0))) } : { w: 0, h: 0 };
  report.kept(`${b.nodes} layer${b.nodes === 1 ? "" : "s"} with auto layout, text, fills, strokes and effects.`);
  return { ops: b.ops(), roots: roots.map((r) => r.id), pages: [], report, size };
}

// ------------------------------------------------------------------------------------------------ values

const colorOf = (v) => cssColor(v);
const hexOf = (v) => {
  const c = colorOf(v);
  return c ? hexA(c.hex, c.alpha) : null;
};

function angleOf(s) {
  const t = s.trim().toLowerCase();
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)$/.exec(t);
  if (m) return ((m[2] === "turn" ? +m[1] * 360 : m[2] === "rad" ? (+m[1] * 180) / Math.PI : m[2] === "grad" ? +m[1] * 0.9 : +m[1]) % 360 + 360) % 360;
  if (t.startsWith("to ")) {
    const d = t.slice(3).split(/\s+/).sort().join(" ");
    return { top: 0, right: 90, bottom: 180, left: 270, "right top": 45, "bottom right": 135, "bottom left": 225, "left top": 315 }[d] ?? null;
  }
  return null;
}

/** Gradient stops: "color [pos]" lists → [{ at, color }]. */
function gradientStops(parts) {
  const stops = [];
  for (const p of parts) {
    const toks = splitTop(p, " ");
    const color = hexOf(toks[0]);
    if (!color) continue;
    const pos = toks[1];
    stops.push({ at: pos && pos.endsWith("%") ? Math.max(0, Math.min(1, parseFloat(pos) / 100)) : null, color });
    if (toks[2] && toks[2].endsWith("%")) stops.push({ at: Math.max(0, Math.min(1, parseFloat(toks[2]) / 100)), color });
  }
  if (stops.length < 2) return null;
  // distribute unspecified positions evenly between their neighbors
  if (stops[0].at == null) stops[0].at = 0;
  if (stops.at(-1).at == null) stops.at(-1).at = 1;
  for (let i = 1; i < stops.length - 1; i++) {
    if (stops[i].at != null) continue;
    let j = i;
    while (stops[j].at == null) j++;
    const a = stops[i - 1].at;
    const step = (stops[j].at - a) / (j - i + 1);
    for (let k = i; k < j; k++) stops[k].at = a + step * (k - i + 1);
  }
  return stops.map((s) => ({ at: r2(s.at * 1000) / 1000, color: s.color }));
}

function backgroundFills(n, b, report) {
  const fills = [];
  const bg = colorOf(st(n, "background-color"));
  if (bg && bg.alpha > 0) fills.push({ type: "solid", color: hexA(bg.hex, bg.alpha) });
  const img = st(n, "background-image");
  if (img && img !== "none") {
    const layers = splitTop(img, ",");
    const sizes = splitTop(st(n, "background-size") || "auto", ",");
    const imgs = [];
    layers.forEach((layer, i) => {
      const m = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/is.exec(layer.trim());
      if (m) {
        if (m[1]) report.flattened("Repeating gradients were imported as plain gradients.");
        const parts = splitTop(m[3], ",");
        let angle = m[2] === "linear" ? 180 : 0;
        let center = null;
        const first = parts[0] || "";
        if (m[2] === "linear" && angleOf(first) != null) {
          angle = angleOf(first);
          parts.shift();
        } else if (m[2] !== "linear" && (/\bat\b/.test(first) || /^(circle|ellipse|from)/.test(first.trim()))) {
          const at = /\bat\s+([\d.]+%)\s+([\d.]+%)/.exec(first);
          if (at) center = [r2(parseFloat(at[1]) / 100), r2(parseFloat(at[2]) / 100)];
          const from = /from\s+(-?[\d.]+(?:deg|turn|rad))/.exec(first);
          if (from) angle = angleOf(from[1]) ?? 0;
          parts.shift();
        }
        const stops = gradientStops(parts);
        if (stops) imgs.push({ type: m[2], ...(m[2] !== "radial" ? { angle: r2(angle) } : {}), ...(center && m[2] !== "linear" ? { center } : {}), stops });
        return;
      }
      const u = /^url\(\s*(['"]?)(.*?)\1\s*\)$/is.exec(layer.trim());
      if (u) {
        const data = dataUrlBytes(u[2]);
        const media = data ? b.media({ bytes: data.bytes, mime: data.mime, name: "Background" }) : null;
        if (!media) return void report.dropped("Background images that are not embedded (data: URLs) were not imported.");
        const size = (sizes[i] || sizes[0] || "auto").trim();
        imgs.push({ type: "image", media, fit: size === "cover" ? "cover" : size === "contain" ? "contain" : size === "100% 100%" ? "fill" : /repeat/.test(st(n, "background-repeat")) && !/no-repeat/.test(st(n, "background-repeat")) ? "tile" : "cover" });
      }
    });
    // CSS lists background layers top first; fills are bottom to top
    fills.push(...imgs.reverse());
  }
  return fills;
}

function strokesOf(n) {
  const sides = ["top", "right", "bottom", "left"];
  const w = sides.map((s) => (/(none|hidden)/.test(st(n, `border-${s}-style`) || "solid") ? 0 : px(st(n, `border-${s}-width`))));
  const out = [];
  if (w.some((x) => x > 0)) {
    const i = w.findIndex((x) => x > 0);
    const c = hexOf(st(n, `border-${sides[i]}-color`)) || "#000000";
    const dashed = /dashed|dotted/.test(st(n, `border-${sides[i]}-style`));
    const even = w.every((x) => x === w[0]);
    out.push({ color: c, w: r2(Math.max(...w)), align: "inside", ...(even ? {} : { sides: w.map(r2) }), ...(dashed ? { dash: [r2(w[i] * 2), r2(w[i] * 2)] } : {}) });
  }
  const ow = px(st(n, "outline-width"));
  const os = st(n, "outline-style");
  if (ow > 0 && os && !/(none|hidden)/.test(os)) {
    const off = px(st(n, "outline-offset"));
    out.push({ color: hexOf(st(n, "outline-color")) || "#000000", w: r2(ow), align: off < 0 ? "center" : "outside", ...(/dashed|dotted/.test(os) ? { dash: [r2(ow * 2), r2(ow * 2)] } : {}) });
  }
  return out;
}

function effectsOf(n, isTextLayer) {
  const fx = [];
  const sh = st(n, isTextLayer ? "text-shadow" : "box-shadow");
  if (sh && sh !== "none") {
    const list = splitTop(sh, ",").map((one) => {
      const toks = splitTop(one, " ");
      const inset = toks.includes("inset");
      const lens = toks.filter((t) => /^-?[\d.]+(px)?$/.test(t)).map(px);
      const color = hexOf(toks.find((t) => t !== "inset" && !/^-?[\d.]+(px)?$/.test(t)) || "#00000040") || "#00000040";
      return { type: "shadow", x: r2(lens[0] || 0), y: r2(lens[1] || 0), blur: r2(Math.max(0, lens[2] || 0)), ...(isTextLayer ? {} : { spread: r2(lens[3] || 0) }), color, ...(inset ? { inset: true } : {}) };
    });
    fx.push(...list.reverse());
  }
  const f = st(n, "filter");
  const blur = /blur\(\s*([\d.]+)px\s*\)/.exec(f);
  if (blur) fx.push({ type: "blur", radius: r2(parseFloat(blur[1])) });
  const bf = /blur\(\s*([\d.]+)px\s*\)/.exec(st(n, "backdrop-filter"));
  if (bf) fx.push({ type: "backgroundBlur", radius: r2(parseFloat(bf[1])) });
  return fx;
}

function radiusOf(n, box) {
  const corners = ["top-left", "top-right", "bottom-right", "bottom-left"].map((c) => st(n, `border-${c}-radius`) || "0");
  const minSide = box ? Math.min(box.w, box.h) : null;
  const pctAll = corners.every((c) => c.trim() === "50%");
  const vals = corners.map((c) => {
    const first = c.trim().split(/\s+/)[0];
    if (first.endsWith("%")) return minSide != null ? (parseFloat(first) / 100) * minSide * 2 * 0.5 : 9999;
    return px(first);
  });
  return { pctAll, radius: vals.every((v) => v === vals[0]) ? r2(vals[0]) : vals.map(r2) };
}

function rotationOf(n) {
  const t = st(n, "transform");
  if (!t || t === "none") return 0;
  const m = /^matrix\(([^)]*)\)$/.exec(t);
  if (m) {
    const a = m[1].split(",").map(Number);
    return r2((Math.atan2(a[1], a[0]) * 180) / Math.PI);
  }
  const r = /rotate\(\s*(-?[\d.]+(?:deg|turn|rad))\s*\)/.exec(t);
  if (r) {
    const d = angleOf(r[1]);
    return d == null ? 0 : r2(d > 180 ? d - 360 : d);
  }
  return null;
}

function textStyleOf(n) {
  const fam = splitTop(st(n, "font-family") || "Inter", ",")[0]?.replace(/["']/g, "").trim() || "Inter";
  const font = /^(sans-serif|system-ui|-apple-system|ui-sans-serif)$/i.test(fam) ? "Inter" : fam;
  const size = Math.max(0.5, px(st(n, "font-size")) || 16);
  const w = st(n, "font-weight");
  const weight = Math.max(1, Math.min(1000, w === "bold" ? 700 : w === "normal" || !w ? 400 : num(w, 400)));
  const lhRaw = st(n, "line-height");
  let lineHeight = "auto";
  if (/%$/.test(lhRaw)) lineHeight = { pct: r2(parseFloat(lhRaw)) };
  else if (/^[\d.]+$/.test(lhRaw)) lineHeight = { pct: r2(parseFloat(lhRaw) * 100) };
  else if (/px$/.test(lhRaw)) lineHeight = { px: r2(px(lhRaw)) };
  const ls = st(n, "letter-spacing");
  const ta = st(n, "text-align");
  const tt = st(n, "text-transform");
  const td = st(n, "text-decoration-line") || st(n, "text-decoration");
  const c = colorOf(st(n, "color") || "#000000") || { hex: "#000000", alpha: 1 };
  const s = { font, size: r2(size), weight, lineHeight, tracking: ls && ls !== "normal" ? r2(px(ls)) : 0, align: ta === "center" ? "center" : ta === "right" || ta === "end" ? "right" : ta === "justify" ? "justify" : "left", color: hexA(c.hex, c.alpha) };
  if (st(n, "font-style") === "italic" || st(n, "font-style").startsWith("oblique")) s.italic = true;
  if (tt === "uppercase") s.case = "upper";
  else if (tt === "lowercase") s.case = "lower";
  else if (tt === "capitalize") s.case = "title";
  if (/underline/.test(td)) s.decoration = "underline";
  else if (/line-through/.test(td)) s.decoration = "strike";
  return s;
}

const RUN_KEYS = ["font", "size", "weight", "italic", "color", "decoration", "case", "tracking"];

// ------------------------------------------------------------------------------------------------ mapper

/**
 * @param {object} probe the root probe node (the page's body)
 * @param {{ builder: object, report: ImportReport, width?: number, name?: string, exact?: boolean }} o
 * @returns {object[]} layer trees for builder.add
 */
export function mapProbe(probe, { builder: b, report, width = 1280, name = "HTML", exact = false, fragment = false } = {}) {
  const stats = { uneven: 0, reversed: 0, margins: 0, tables: 0, pseudo: 0, media: 0, transforms: 0, placeholders: 0, lists: 0 };
  const colorVars = variables(probe.vars || {}, b, report);
  const bindColor = (hex) => (colorVars.has(hex) ? { $var: colorVars.get(hex) } : hex);
  const display = (n) => st(n, "display") || "inline";
  const hidden = (n) => display(n) === "none";
  const posOf = (n) => st(n, "position") || "static";
  const outOfFlow = (n) => !isText(n) && /^(absolute|fixed)$/.test(posOf(n));
  const inlineLevel = (n) => isText(n) || display(n).startsWith("inline");

  /** Children with display: contents dissolved and hidden ones dropped. */
  const kidsOf = (n) => {
    const out = [];
    for (const k of n.kids || []) {
      if (isText(k)) out.push(k);
      else if (hidden(k)) continue;
      else if (display(k) === "contents") out.push(...kidsOf(k));
      else out.push(k);
    }
    return out;
  };

  /** True when everything inside is inline content (text and inline elements without layout of their own). */
  const textOnly = (n) => {
    if (n.svg || ATOMIC.has(n.tag) || /(flex|grid)$/.test(display(n))) return false; // a flex or grid container lays its children out as items
    const kids = kidsOf(n);
    if (!kids.some((k) => (isText(k) ? k.text.trim() : true))) return false;
    return kids.every((k) => isText(k) || (INLINE_TEXT.has(display(k)) && !ATOMIC.has(k.tag) && !k.svg && !outOfFlow(k) && textOnly2(k)));
  };
  const textOnly2 = (n) => kidsOf(n).every((k) => isText(k) || (INLINE_TEXT.has(display(k)) && !ATOMIC.has(k.tag) && !k.svg && textOnly2(k)));

  const decorated = (n) => {
    const fills = st(n, "background-color");
    const bg = colorOf(fills);
    const pad = ["top", "right", "bottom", "left"].some((s) => px(st(n, `padding-${s}`)) > 0);
    const border = ["top", "right", "bottom", "left"].some((s) => px(st(n, `border-${s}-width`)) > 0 && !/(none|hidden)/.test(st(n, `border-${s}-style`)));
    const img = st(n, "background-image");
    return (bg && bg.alpha > 0) || pad || border || (img && img !== "none") || (st(n, "box-shadow") && st(n, "box-shadow") !== "none") || ["button", "input", "textarea", "select"].includes(n.tag);
  };

  /** Runs of a text-only element: [{ t, s }] with per-run differences from the layer style. */
  function runsOf(n, base, pre) {
    const raw = [];
    const walk = (k, owner) => {
      if (isText(k)) return void raw.push({ t: k.text, s: textStyleOf(owner), br: !!k.br });
      for (const c of kidsOf(k)) walk(c, k);
    };
    for (const c of kidsOf(n)) walk(c, n);
    const ws = st(n, "white-space");
    const keep = pre || /^(pre|pre-wrap|break-spaces|pre-line)$/.test(ws);
    let text = "";
    const runs = [];
    for (const r of raw) {
      let t = r.br ? "\n" : keep ? r.t : r.t.replace(/[ \t\r\n\f]+/g, " ");
      if (!keep && !r.br && (text.endsWith(" ") || text.endsWith("\n") || !text) && t.startsWith(" ")) t = t.slice(1);
      if (!t) continue;
      text += t;
      const s = {};
      for (const key of RUN_KEYS) if (JSON.stringify(r.s[key]) !== JSON.stringify(base[key]) && r.s[key] !== undefined) s[key] = r.s[key];
      const last = runs.at(-1);
      if (last && JSON.stringify(last.s) === JSON.stringify(s)) last.t += t;
      else runs.push({ t, s });
    }
    if (!keep) {
      while (runs.length && /\s$/.test(runs.at(-1).t)) {
        runs.at(-1).t = runs.at(-1).t.replace(/[ ]+$/, "");
        if (!runs.at(-1).t) runs.pop();
        else break;
      }
    }
    for (const r of runs) if (r.s.color) r.s.color = bindColor(r.s.color);
    return runs.length ? runs : [{ t: "", s: {} }];
  }

  function nameOf(n, fallback) {
    const a = n.attrs || {};
    if (a["aria-label"]) return cleanName(a["aria-label"]);
    if (a.id) return cleanName(a.id.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
    if (a.alt) return cleanName(a.alt);
    if (fallback) return cleanName(fallback);
    const cls = String(a.class || "").split(/\s+/).find((c) => c && !/^(flex|grid|p[xytrbl]?-|m[xytrbl]?-|w-|h-|text-|bg-|gap-|items-|justify-|rounded|border|shadow|font-|leading-|tracking-)/.test(c));
    if (cls) return cleanName(cls.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
    return TAG_NAMES[n.tag] || (/^h[1-6]$/.test(n.tag) ? "Heading" : n.tag === "p" ? "Paragraph" : "Frame");
  }

  const semantic = (n) => (SEMANTIC.has(n.tag) && n.tag !== "span" ? { tag: n.tag } : {});
  const a11y = (n) => {
    const a = n.attrs || {};
    const out = {};
    if (a["aria-label"]) out.label = String(a["aria-label"]).slice(0, 1000);
    if (a.role && /^[a-z]+$/.test(a.role)) out.role = a.role;
    return Object.keys(out).length ? { a11y: out } : {};
  };

  /** Layout of a container from its display and children. */
  function layoutOf(n, kids, box) {
    const d = display(n);
    const pad = ["top", "right", "bottom", "left"].map((s) => r2(px(st(n, `padding-${s}`))));
    if (/flex$/.test(d)) {
      const dir = st(n, "flex-direction") || "row";
      const row = !dir.startsWith("column");
      if (dir.endsWith("reverse")) stats.reversed++;
      const cg = px(st(n, "column-gap"));
      const rg = px(st(n, "row-gap"));
      const main = row ? cg : rg;
      const cross = row ? rg : cg;
      const wrap = /^wrap/.test(st(n, "flex-wrap"));
      const L = { type: "flex", dir: row ? "row" : "column", ...(wrap ? { wrap: true } : {}), gap: r2(main), ...(wrap && cross !== main ? { rowGap: r2(cross) } : {}), pad, align: alignOf(st(n, "align-items")), justify: justifyOf(st(n, "justify-content")) };
      if (wrap) {
        const ac = st(n, "align-content");
        const v = alignContentOf(ac);
        if (v !== "start") L.alignContent = v;
      }
      if (kids.some((k) => !isText(k) && ["top", "right", "bottom", "left"].some((s) => px(st(k, `margin-${s}`)) !== 0))) stats.margins++;
      return L;
    }
    if (/grid$/.test(d)) {
      const cols = tracks(n.decl?.["grid-template-columns"] || st(n, "grid-template-columns"));
      const rows = tracks(n.decl?.["grid-template-rows"] || st(n, "grid-template-rows"));
      const flow = st(n, "grid-auto-flow") || "row";
      const ji = st(n, "justify-items");
      const jc = st(n, "justify-content");
      return {
        type: "grid",
        gap: r2(px(st(n, "column-gap"))),
        rowGap: r2(px(st(n, "row-gap"))),
        pad,
        align: alignOf(st(n, "align-items"), true),
        justify: /space-/.test(jc) ? jc : ji === "center" ? "center" : ji === "end" || ji === "flex-end" ? "end" : "start",
        grid: { cols: cols.length ? cols : [{ fr: 1 }], rows, autoFlow: flow.startsWith("column") ? "column" : "row", ...(/dense/.test(flow) ? { dense: true } : {}) },
      };
    }
    // block flow: a column (or a wrapping row of inline boxes) whose gap is the space between the children
    const flowKids = kids.filter((k) => !outOfFlow(k));
    if (!flowKids.length) return { type: "none", pad };
    const allInline = flowKids.every(inlineLevel);
    const spaces = [];
    for (let i = 1; i < flowKids.length; i++) {
      const a = flowKids[i - 1];
      const c = flowKids[i];
      if (exact && a.box && c.box) spaces.push(allInline ? c.box.x - (a.box.x + a.box.w) : c.box.y - (a.box.y + a.box.h));
      else spaces.push(allInline ? px(st(a, "margin-right")) + px(st(c, "margin-left")) : Math.max(px(st(a, "margin-bottom")), px(st(c, "margin-top"))));
    }
    const gap = mostCommon(spaces.map((s) => Math.max(0, r2(s))));
    if (spaces.some((s) => Math.abs(Math.max(0, s) - gap) > 1)) stats.uneven++;
    const first = flowKids[0];
    const last = flowKids.at(-1);
    if (!allInline && !isText(first)) {
      pad[0] = r2(pad[0] + Math.max(0, px(st(first, "margin-top"))));
      pad[2] = r2(pad[2] + Math.max(0, px(st(last, "margin-bottom"))));
      const ml = flowKids.filter((k) => !isText(k)).map((k) => px(st(k, "margin-left")));
      const mr = flowKids.filter((k) => !isText(k)).map((k) => px(st(k, "margin-right")));
      if (ml.length && ml.every((x) => x === ml[0]) && ml[0] > 0) pad[3] = r2(pad[3] + ml[0]);
      if (mr.length && mr.every((x) => x === mr[0]) && mr[0] > 0) pad[1] = r2(pad[1] + mr[0]);
    }
    const ta = st(n, "text-align");
    return allInline
      ? { type: "flex", dir: "row", wrap: true, gap, rowGap: 0, pad, align: "baseline", justify: ta === "center" ? "center" : ta === "right" || ta === "end" ? "end" : "start" }
      : { type: "flex", dir: "column", gap, pad, align: "stretch", justify: "start" };
  }

  /** Sizing of a layer on one axis. */
  function sizeOf(n, axis, parent, pl, box, { text = false } = {}) {
    const attrSize = ["img", "svg", "video", "canvas", "iframe"].includes(n.tag) ? n.attrs?.[axis === "w" ? "width" : "height"] : null;
    const raw = String(n.decl?.[axis === "w" ? "width" : "height"] ?? (attrSize && /^\d+(\.\d+)?$/.test(attrSize) ? `${attrSize}px` : "")).trim().toLowerCase();
    const flexParent = pl && pl.type === "flex";
    const gridParent = pl && pl.type === "grid";
    const main = flexParent && ((pl.dir === "row") === (axis === "w"));
    const value = box ? r2(axis === "w" ? box.w : box.h) : null;
    const lim = {};
    for (const [k, key] of [["min", axis === "w" ? "min-width" : "min-height"], ["max", axis === "w" ? "max-width" : "max-height"]]) {
      const v = String(n.decl?.[key] ?? st(n, key) ?? "").trim();
      if (/^-?[\d.]+px$/.test(v) && !(k === "min" && px(v) === 0) && px(v) > 0) lim[k] = r2(px(v));
    }
    const fixed = (v) => ({ mode: "fixed", value: v ?? 0, ...lim });
    const grow = px(st(n, "flex-grow"));
    if (flexParent && main && grow > 0) return { mode: "fill", ...lim };
    if (/(fit|max|min)-content/.test(raw)) return { mode: "hug", ...lim };
    if (/^-?[\d.]+(px)?$/.test(raw)) return fixed(value ?? r2(px(raw)));
    if (/%$/.test(raw)) {
      const p = parseFloat(raw);
      if (p === 100 && parent) return { mode: "fill", ...lim };
      return { mode: "rel", value: r2(p), ...lim };
    }
    if (/^calc|vw|vh|em|rem/.test(raw) && value != null) return fixed(value);
    if (raw && raw !== "auto" && value != null) return fixed(value);
    // auto: the parent's layout decides
    if (!parent) return axis === "w" ? fixed(value ?? width) : exact && value != null ? fixed(value) : { mode: "hug", ...lim };
    if (outOfFlow(n)) return value != null && !text ? fixed(value) : { mode: "hug", ...lim };
    if (flexParent && !main && pl._block && inlineLevel(n)) return { mode: "hug", ...lim };
    if (flexParent && !main) {
      const self = st(n, "align-self");
      const as = self && self !== "auto" ? self : pl.align;
      if (/stretch|normal/.test(as) && !pl.wrap) return { mode: "fill", ...lim };
      return { mode: "hug", ...lim };
    }
    if (gridParent) {
      if (axis === "w") return /^(start|end|center|flex-start|flex-end)$/.test(st(n, "justify-self")) || pl.justify === "center" || pl.justify === "end" ? { mode: "hug", ...lim } : { mode: "fill", ...lim };
      return { mode: "fill", ...lim };
    }
    if (flexParent && main && pl._block) {
      // converted block flow: block children fill the width (handled as the cross axis above); heights hug
      return { mode: "hug", ...lim };
    }
    return { mode: "hug", ...lim };
  }

  function place(fields, n, parentBox, parentNode, pl) {
    if (!outOfFlow(n)) {
      if (st(n, "position") === "sticky") {
        const side = ["top", "bottom", "left", "right"].find((s) => st(n, s) && st(n, s) !== "auto");
        if (side) fields.sticky = side;
      }
      return;
    }
    if (posOf(n) === "fixed") report.flattened("Fixed elements were placed as absolute layers in their parent.");
    fields.pos = "abs";
    const bl = parentNode ? px(st(parentNode, "border-left-width")) : 0;
    const bt = parentNode ? px(st(parentNode, "border-top-width")) : 0;
    if (exact && n.box && parentBox) {
      fields.x = r2(n.box.x - parentBox.x);
      fields.y = r2(n.box.y - parentBox.y);
      return;
    }
    const L = st(n, "left");
    const T = st(n, "top");
    const R = st(n, "right");
    const B = st(n, "bottom");
    const pw = parentNode ? num(parentNode._w, NaN) : NaN;
    const ph = parentNode ? num(parentNode._h, NaN) : NaN;
    const w = fields.w?.mode === "fixed" ? fields.w.value : NaN;
    const h = fields.h?.mode === "fixed" ? fields.h.value : NaN;
    if (/px$/.test(L)) fields.x = r2(px(L) + bl);
    else if (/px$/.test(R) && Number.isFinite(pw) && Number.isFinite(w)) {
      fields.x = r2(pw - px(R) - w - px(st(parentNode, "border-right-width")));
      fields.cx = "right";
    } else fields.x = 0;
    if (/px$/.test(T)) fields.y = r2(px(T) + bt);
    else if (/px$/.test(B) && Number.isFinite(ph) && Number.isFinite(h)) {
      fields.y = r2(ph - px(B) - h - px(st(parentNode, "border-bottom-width")));
      fields.cy = "bottom";
    } else fields.y = 0;
    if (/px$/.test(L) && /px$/.test(R) && fields.w?.mode !== "fixed") {
      fields.cx = "leftRight";
      if (Number.isFinite(pw)) fields.w = { mode: "fixed", value: r2(pw - px(L) - px(R) - bl - px(st(parentNode, "border-right-width"))) };
    }
    void pl;
  }

  function appearance(n, fields, box, { textLayer = false } = {}) {
    if (!textLayer) {
      // node.create starts from the type's defaults (a white frame that clips): every field is set explicitly
      fields.fills = backgroundFills(n, b, report).map((f) => (f.type === "solid" ? { ...f, color: bindColor(f.color) } : f));
      fields.clip = false;
      const strokes = strokesOf(n);
      if (strokes.length) fields.strokes = strokes;
      const { radius } = radiusOf(n, box);
      if (Array.isArray(radius) ? radius.some((x) => x > 0) : radius > 0) fields.radius = radius;
      if (/(hidden|clip|auto|scroll)/.test(st(n, "overflow-x")) || /(hidden|clip|auto|scroll)/.test(st(n, "overflow-y"))) {
        fields.clip = true;
        const sx = /(auto|scroll)/.test(st(n, "overflow-x"));
        const sy = /(auto|scroll)/.test(st(n, "overflow-y"));
        if (sx || sy) fields.scroll = sx && sy ? "both" : sx ? "x" : "y";
      }
    }
    const fx = effectsOf(n, textLayer);
    if (fx.length) fields.effects = fx;
    const op = num(st(n, "opacity"), 1);
    if (op < 1) fields.opacity = r2(Math.max(0, op));
    const blend = st(n, "mix-blend-mode");
    if (blend && blend !== "normal" && /^[a-z-]+$/.test(blend)) fields.blend = blend;
    const rot = rotationOf(n);
    if (rot === null) stats.transforms++;
    else if (rot) fields.rot = rot;
    if (st(n, "visibility") === "hidden") fields.visible = false;
  }

  function textLayer(n, parent, pl, parentBox, { name: nm, fromDecorated = false } = {}) {
    const base = textStyleOf(n);
    const runs = runsOf(n, base, false);
    const ws = st(n, "white-space");
    const fields = { name: nameOf(n, runs.map((r) => r.t).join("").slice(0, 40) || "Text"), ...(fromDecorated ? {} : { ...semantic(n), ...a11y(n) }) };
    if (nm) fields.name = nm;
    const box = n.box || null;
    let w = fromDecorated ? { mode: "hug" } : sizeOf(n, "w", parent, pl, box, { text: true });
    const h = fromDecorated ? { mode: "hug" } : sizeOf(n, "h", parent, pl, box, { text: true });
    let autoSize = "height";
    if (w.mode === "hug" || /^(nowrap|pre)$/.test(ws)) {
      autoSize = /^(nowrap|pre)$/.test(ws) || w.mode === "hug" ? "width" : "height";
      if (autoSize === "width") w = { mode: "hug" };
    }
    if (h.mode === "fixed" && autoSize === "height" && !exact) autoSize = "fixed";
    if (exact && autoSize === "height" && h.mode === "fixed") autoSize = "height";
    fields.w = w;
    fields.h = autoSize === "fixed" ? h : { mode: "hug" };
    const clamp = num(st(n, "-webkit-line-clamp"), 0);
    const color = base.color;
    fields.text = { runs, style: { ...base, color: bindColor(color) }, autoSize, maxLines: clamp >= 1 ? Math.round(clamp) : null };
    if (!fromDecorated) {
      place(fields, n, parentBox, parent, pl);
      appearance(n, fields, box, { textLayer: true });
    }
    return spec(b, "text", fields, [], n.attrs?.["data-proto-id"]);
  }

  /** One element → a layer tree (or null). */
  function element(n, parent, pl, parentBox, depth) {
    if (depth > 60) return null;
    const box = n.box || null;
    if (n.tag === "img") return image(n, parent, pl, parentBox);
    if (n.svg) return inlineSvg(n, parent, pl, parentBox);
    if (["video", "canvas", "iframe", "audio", "object", "embed"].includes(n.tag)) {
      stats.placeholders++;
      const fields = { name: nameOf(n), w: sizeOf(n, "w", parent, pl, box), h: sizeOf(n, "h", parent, pl, box), fills: [{ type: "solid", color: "#e4e4e7" }] };
      place(fields, n, parentBox, parent, pl);
      return spec(b, "rect", fields);
    }
    if (n.tag === "hr") {
      const fields = { name: "Divider", tag: "hr", w: sizeOf(n, "w", parent, pl, box), h: { mode: "fixed", value: Math.max(1, r2(px(st(n, "border-top-width")) + px(st(n, "border-bottom-width")))) }, fills: [{ type: "solid", color: bindColor(hexOf(st(n, "border-top-color")) || "#808080") }] };
      if (fields.w.mode === "hug") fields.w = { mode: "fill" };
      place(fields, n, parentBox, parent, pl);
      return spec(b, "rect", fields);
    }
    if (display(n) === "list-item" && /^(disc|circle|square|decimal)/.test(st(n, "list-style-type") || "disc")) stats.lists++;
    if (/^table/.test(display(n))) stats.tables++;
    const isInput = n.tag === "input" || n.tag === "textarea" || n.tag === "select";
    if (!isInput && textOnly(n) && !decorated(n)) return textLayer(n, parent, pl, parentBox);
    // a frame
    let kids = kidsOf(n);
    if (isInput) {
      const a = n.attrs || {};
      const shown = a.type === "password" && a.value ? "••••••••" : a.value || a.placeholder || "";
      if (a.type === "checkbox" || a.type === "radio") kids = [];
      else kids = shown ? [{ text: shown }] : [];
    }
    const fields = { name: nameOf(n), ...semantic(n), ...a11y(n) };
    const d = display(n);
    const asText = textOnly(n) && decorated(n);
    let L = asText || isInput ? { type: "flex", dir: "row", gap: 0, pad: ["top", "right", "bottom", "left"].map((s) => r2(px(st(n, `padding-${s}`)))), align: "center", justify: st(n, "text-align") === "center" || n.tag === "button" ? "center" : "start" } : layoutOf(n, kids, box);
    if (/^table(-row-group|-header-group|-footer-group)?$/.test(d)) L = { ...L, type: "flex", dir: "column", gap: r2(px(st(n, "row-gap"))), align: "stretch", justify: "start" };
    if (d === "table-row") L = { ...L, type: "flex", dir: "row", gap: 0, align: "stretch", justify: "start" };
    if (L.type === "flex" && !/flex$/.test(d) && !asText && !isInput) L._block = true;
    fields.layout = { ...L };
    delete fields.layout._block;
    if (fields.layout.type === "none") fields.layout = { type: "none", ...(L.pad.some((p) => p) ? { pad: L.pad } : {}) };
    fields.w = sizeOf(n, "w", parent, pl, box);
    fields.h = sizeOf(n, "h", parent, pl, box);
    if (d === "table-cell" && exact && box) fields.w = { mode: "fixed", value: r2(box.w) };
    if (fields.layout.type === "none" && box && !parent) fields.h = { mode: "fixed", value: r2(box.h) };
    if (fields.layout.type === "none" && fields.h.mode === "hug") fields.h = { mode: "fixed", value: box ? r2(box.h) : 0 };
    if (fields.layout.type === "none" && fields.w.mode === "hug") fields.w = { mode: "fixed", value: box ? r2(box.w) : 0 };
    place(fields, n, parentBox, parent, pl);
    appearance(n, fields, box);
    // an element whose corners are all 50 % and that holds nothing is an ellipse
    const { pctAll } = radiusOf(n, box);
    // remember design-time sizes for absolute children of the static path
    n._w = fields.w.mode === "fixed" ? fields.w.value : NaN;
    n._h = fields.h.mode === "fixed" ? fields.h.value : NaN;
    const children = [];
    if (asText || isInput) {
      if (kids.length) {
        const t = textLayer(isInput ? { ...n, kids, tag: "span" } : n, n, L, box, { fromDecorated: true, name: isInput ? (n.attrs?.value ? "Value" : "Placeholder") : null });
        if (isInput && !n.attrs?.value && t.fields.text) t.fields.text.style = { ...t.fields.text.style, color: hexA((colorOf(st(n, "color")) || { hex: "#000000" }).hex, 0.5) };
        if (fields.w.mode !== "hug") {
          t.fields.w = { mode: "fill" };
          t.fields.text.autoSize = "height";
        }
        children.push(t);
      }
    } else {
      const order = st(n, "flex-direction").endsWith("reverse") ? [...kids].reverse() : kids;
      for (const k of order) {
        if (isText(k)) {
          const tx = k.text.replace(/\s+/g, " ").trim();
          if (!tx) continue;
          const anon = { tag: "span", attrs: {}, style: { ...n.style, display: "inline", "background-color": "transparent", "background-image": "none", "padding-top": "0", "padding-right": "0", "padding-bottom": "0", "padding-left": "0", "border-top-width": "0", "border-right-width": "0", "border-bottom-width": "0", "border-left-width": "0", "box-shadow": "none", opacity: "1", position: "static", transform: "none", "flex-grow": "0", filter: "none", "backdrop-filter": "none" }, decl: {}, kids: [k], box: k.box };
          children.push(textLayer(anon, n, L, box));
          continue;
        }
        const c = element(k, n, L, box, depth + 1);
        if (c) children.push(c);
      }
    }
    if (pctAll && !children.length && L.type !== "grid") {
      const { layout: _l, radius: _r, clip: _c, scroll: _s, ...rest } = fields;
      return spec(b, "ellipse", rest, [], n.attrs?.["data-proto-id"]);
    }
    return spec(b, "frame", fields, children, n.attrs?.["data-proto-id"]);
  }

  function image(n, parent, pl, parentBox) {
    const box = n.box || null;
    const src = n.attrs?.src || "";
    const data = src.startsWith("data:") ? dataUrlBytes(src) : null;
    const media = data ? b.media({ bytes: data.bytes, mime: data.mime, name: n.attrs?.alt || "Image" }) : null;
    const fit = st(n, "object-fit");
    const fields = { name: nameOf(n, n.attrs?.alt || "Image"), alt: String(n.attrs?.alt || "").slice(0, 1000) };
    const imgFill = media ? { type: "image", media, fit: fit === "cover" || fit === "contain" || fit === "none" ? fit : "fill" } : { type: "solid", color: "#e4e4e7" };
    if (!media) stats.placeholders++;
    let w = sizeOf(n, "w", parent, pl, box);
    let h = sizeOf(n, "h", parent, pl, box);
    const nat = data ? imageSize(data.bytes, data.mime) : null;
    // images hug their natural size: Proto images have no intrinsic size, so hug becomes the natural (or box) size
    if (w.mode === "hug") w = { mode: "fixed", value: box ? r2(box.w) : nat ? nat.w : 100 };
    if (h.mode === "hug") h = { mode: "fixed", value: box ? r2(box.h) : nat ? (w.mode === "fixed" && nat.w ? r2((nat.h * w.value) / nat.w) : nat.h) : 100 };
    fields.w = w;
    fields.h = h;
    place(fields, n, parentBox, parent, pl);
    appearance(n, fields, box);
    // the element's own background lies under the picture
    fields.fills = [...fields.fills, imgFill];
    fields.clip = true;
    return spec(b, "image", fields, [], n.attrs?.["data-proto-id"]);
  }

  function inlineSvg(n, parent, pl, parentBox) {
    let t;
    try {
      t = svgTree(n.svg, b, report, nameOf(n, "SVG"));
    } catch {
      report.dropped("An inline SVG could not be read.");
      return null;
    }
    const box = n.box || null;
    const f = t.root.fields;
    const w = sizeOf(n, "w", parent, pl, box);
    const h = sizeOf(n, "h", parent, pl, box);
    if (w.mode === "fixed" && Math.abs(w.value - f.w.value) > 0.01) report.flattened("Inline SVGs were imported at their own size; resize them in Proto if they were scaled.");
    if (w.mode === "fill") f.w = w;
    if (h.mode === "fill") f.h = h;
    delete f.x;
    delete f.y;
    place(f, n, parentBox, parent, pl);
    return t.root;
  }

  // ---- the page: a single wrapper or absolutely placed children become the top-level layers
  const body = probe;
  const bodyKids = kidsOf(body).filter((k) => !isText(k) || k.text.trim());
  const bodyBg = backgroundFills(body, b, report);
  const htmlBg = body.htmlStyle ? backgroundFills({ style: body.htmlStyle }, b, report) : [];
  const roots = [];
  // a pasted fragment with one element (no <html> or <body>) becomes that element, not a page around it
  const single = fragment && bodyKids.length === 1 && !isText(bodyKids[0]) && !bodyBg.length;
  const unwrap = single || (bodyKids.length >= 1 && bodyKids.every((k) => !isText(k) && outOfFlow(k)) && !bodyBg.length);
  if (unwrap) {
    for (const k of bodyKids) {
      const r = element(k, null, null, null, 1);
      if (!r) continue;
      // top-level layers keep their page position
      if (!outOfFlow(k)) {
        r.fields.x = 0;
        r.fields.y = 0;
      } else if (exact && k.box) {
        r.fields.x = r2(k.box.x);
        r.fields.y = r2(k.box.y);
      } else {
        r.fields.x = r2(px(st(k, "left")));
        r.fields.y = r2(px(st(k, "top")));
      }
      delete r.fields.pos;
      delete r.fields.cx;
      delete r.fields.cy;
      roots.push(r);
    }
  } else {
    const page = { ...body, tag: "body", style: { ...body.style, "background-color": bodyBg.length ? body.style["background-color"] : htmlBg.length ? body.htmlStyle["background-color"] : "#ffffff" } };
    if (!exact) {
      // the page's margin becomes its padding
      for (const s of ["top", "right", "bottom", "left"]) page.style[`padding-${s}`] = `${px(st(body, `padding-${s}`)) + px(st(body, `margin-${s}`))}px`;
    }
    const r = element(page, null, null, null, 0);
    if (r) {
      r.fields.name = cleanName(body.title || name.replace(/\.html?$/i, ""), "Page");
      r.fields.x = 0;
      r.fields.y = 0;
      r.fields.w = { mode: "fixed", value: r2(width) };
      if (exact && body.box) r.fields.h = { mode: "fixed", value: r2(Math.max(body.box.h, body.viewport?.h || 0)) };
      delete r.fields.tag;
      r.fields.clip = true;
      roots.push(r);
    }
  }

  if (stats.uneven) report.flattened("Uneven spacing between stacked elements was evened out (block layouts become auto layout with one gap).");
  if (stats.reversed) report.flattened("Reversed flex directions were imported with the children in their visual order.");
  if (stats.margins) report.flattened("Margins of children in flex and grid layouts were not imported (Proto has gaps and padding, no margins).");
  if (stats.tables) report.flattened("Tables were converted to auto layout rows and cells; column widths are approximate.");
  if (stats.lists) report.dropped("List bullets and numbers were not imported.");
  if (stats.transforms) report.flattened("Transforms other than rotation (scale, skew, translate) were ignored.");
  if (stats.placeholders) report.dropped(`${stats.placeholders} image${stats.placeholders === 1 ? "" : "s"} or media element${stats.placeholders === 1 ? "" : "s"} without embedded data became gray placeholders.`);
  report.note("Pseudo-elements (::before, ::after), hover and focus states and animations are not imported.");
  componentCandidates(roots, report);
  return roots;
}

function alignOf(v, grid = false) {
  const s = String(v || "").trim();
  if (/^(center)$/.test(s)) return "center";
  if (/^(flex-end|end|self-end)$/.test(s)) return "end";
  if (/^(flex-start|start|self-start)$/.test(s)) return "start";
  if (/baseline/.test(s)) return "baseline";
  return grid ? (s === "normal" || s === "stretch" || !s ? "stretch" : "start") : "stretch";
}
function justifyOf(v) {
  const s = String(v || "").trim();
  if (s === "center") return "center";
  if (/^(flex-end|end|right)$/.test(s)) return "end";
  if (/^space-(between|around|evenly)$/.test(s)) return s;
  return "start";
}
function alignContentOf(v) {
  const s = String(v || "").trim();
  if (s === "center") return "center";
  if (/^(flex-end|end)$/.test(s)) return "end";
  if (s === "stretch" || s === "normal") return "stretch";
  if (/^space-(between|around|evenly)$/.test(s)) return s;
  return "start";
}

function mostCommon(list) {
  if (!list.length) return 0;
  const c = new Map();
  for (const v of list) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** Grid tracks from a template: px, fr, auto, minmax(), repeat(n, …). */
export function tracks(v) {
  const s = String(v || "").trim();
  if (!s || s === "none") return [];
  const out = [];
  const one = (t) => {
    t = t.trim();
    if (/^[\d.]+fr$/.test(t)) return { fr: r2(parseFloat(t)) };
    if (/^-?[\d.]+(px)?$/.test(t)) return { px: r2(parseFloat(t)) };
    if (t === "auto" || /content$/.test(t)) return { auto: true };
    const m = /^minmax\((.*)\)$/.exec(t);
    if (m) {
      const [a, c] = splitTop(m[1], ",");
      const part = (x) => (/^-?[\d.]+(px)?$/.test(x.trim()) ? r2(parseFloat(x)) : one(x));
      return { minmax: [part(a), part(c)] };
    }
    return { auto: true };
  };
  for (const tok of splitTop(s.replace(/\[[^\]]*\]/g, " "), " ")) {
    const rep = /^repeat\(\s*(\d+)\s*,(.*)\)$/.exec(tok);
    if (rep) {
      const items = splitTop(rep[2], " ");
      for (let i = 0; i < Math.min(1000, +rep[1]); i++) for (const it of items) out.push(one(it));
    } else if (/^repeat\(\s*auto-(fill|fit)/.test(tok)) {
      const items = splitTop(tok.slice(tok.indexOf(",") + 1, -1), " ");
      for (const it of items) out.push(one(it));
    } else out.push(one(tok));
  }
  return out.slice(0, 1000);
}

function variables(vars, b, report) {
  const map = new Map();
  const entries = Object.entries(vars).filter(([k]) => k.startsWith("--")).slice(0, 2000);
  const colors = [];
  const numbers = [];
  for (const [k, v] of entries) {
    const c = cssColor(v);
    if (c) colors.push([k, hexA(c.hex, c.alpha)]);
    else if (/^-?[\d.]+px$/.test(String(v).trim())) numbers.push([k, parseFloat(v)]);
  }
  if (!colors.length && !numbers.length) return map;
  const coll = b.id("c");
  b.op({ op: "collection.create", id: coll, name: "CSS variables", modes: [{ id: "base", name: "Base" }] });
  const counts = new Map();
  for (const [, hex] of colors) counts.set(hex, (counts.get(hex) || 0) + 1);
  const names = new Set();
  for (const [k, hex] of colors) {
    const id = b.id("v");
    const name = uniqueName(k.slice(2).replace(/[-_]+/g, "/"), names);
    b.op({ op: "var.create", id, coll, name, type: "color", value: hex });
    if (counts.get(hex) === 1) map.set(hex, id);
  }
  for (const [k, n] of numbers) b.op({ op: "var.create", id: b.id("v"), coll, name: uniqueName(k.slice(2).replace(/[-_]+/g, "/"), names), type: "number", unit: "px", value: n });
  report.kept(`${colors.length + numbers.length} CSS custom propert${colors.length + numbers.length === 1 ? "y" : "ies"} as variables (colors used once are bound).`);
  return map;
}

function uniqueName(n, names) {
  let s = n.replace(/^\/+|\/+$/g, "") || "var";
  let i = 2;
  while (names.has(s)) s = `${n}-${i++}`;
  names.add(s);
  return s;
}

/** Siblings with the same structure (types and names, three or more) are offered as component candidates. */
function componentCandidates(roots, report) {
  const sig = (t) => `${t.type}:${t.fields.layout?.type || ""}(${(t.children || []).map(sig).join(",")})`;
  const found = [];
  const visit = (t) => {
    const groups = new Map();
    for (const c of t.children || []) {
      if (c.type !== "frame" || !(c.children || []).length) continue;
      const s = sig(c);
      groups.set(s, [...(groups.get(s) || []), c]);
    }
    for (const list of groups.values()) if (list.length >= 3) found.push(`${list[0].fields.name} (×${list.length})`);
    (t.children || []).forEach(visit);
  };
  roots.forEach(visit);
  if (found.length) report.note(`Repeated structures that could become components (select one and choose Create Component): ${found.slice(0, 8).join(", ")}${found.length > 8 ? ", …" : ""}.`);
}

export { sanitizeHtml };
