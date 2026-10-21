// OpenDocument Text (ODT, ISO/IEC 26300) reader and writer for the office document model. Pure (no DOM).
import { readZip, text as zipText, writeZip } from "./zip.js";
import { parseXml, child, children, find, findAll, attr, textOf, esc, escAttr } from "./xml.js";
import { createDocument, defaultStyles, defaultPage, normalizeDoc, mergeRuns, tableGrid, PAGE_SIZES, normColor, safeHref, isText, resolveStyle } from "./model.js";
import { sniffImage, IMAGE_EXT, imageSize, fromBase64 } from "./media.js";
import { createReport, plural } from "./report.js";

export const ODT_MIME = "application/vnd.oasis.opendocument.text";

const NSDECL = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"',
].join(" ");

const pt = (v) => `${Math.round((v || 0) * 1000) / 1000}pt`;
/** "1.5cm" | "0.5in" | "12pt" | "10mm" | "2pc" | "16px" -> points */
export function lengthPt(s) {
  const m = /^\s*(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?\s*$/i.exec(String(s ?? ""));
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return undefined;
  switch ((m[2] || "pt").toLowerCase()) {
    case "cm":
      return (v * 72) / 2.54;
    case "mm":
      return (v * 72) / 25.4;
    case "in":
      return v * 72;
    case "pc":
      return v * 12;
    case "px":
      return v * 0.75;
    default:
      return v;
  }
}

// model style id <-> ODF style name
const TO_ODF = { Normal: "Standard", Title: "Title", Subtitle: "Subtitle", Quote: "Quotations", Code: "Preformatted_20_Text", List: "List_20_Paragraph" };
const DISPLAY = { Standard: "Default Paragraph Style", Quotations: "Quotations", Preformatted_20_Text: "Preformatted Text", List_20_Paragraph: "List Paragraph" };
const odfName = (id) => (/^Heading[1-9]$/.test(id) ? `Heading_20_${id.slice(7)}` : TO_ODF[id] || String(id).replace(/[^\w-]/g, "_"));

function textProps(m) {
  const a = [];
  if (m.b) a.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"');
  if (m.i) a.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"');
  if (m.u) a.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
  if (m.s) a.push('style:text-line-through-style="solid" style:text-line-through-type="single"');
  if (m.va) a.push(`style:text-position="${m.va === "sub" ? "sub" : "super"} 58%"`);
  if (m.color) a.push(`fo:color="${m.color}"`);
  if (m.highlight) a.push(`fo:background-color="${m.highlight}"`);
  if (m.font) a.push(`style:font-name="${escAttr(m.font)}" fo:font-family="${escAttr(m.font)}"`);
  if (m.size) a.push(`fo:font-size="${pt(m.size)}"`);
  return a.length ? `<style:text-properties ${a.join(" ")}/>` : "";
}

function paraProps(p, extra = "") {
  const a = [];
  if (!p) p = {};
  if (p.align) a.push(`fo:text-align="${p.align === "left" ? "start" : p.align === "right" ? "end" : p.align}"`);
  if (p.spaceBefore !== undefined) a.push(`fo:margin-top="${pt(p.spaceBefore)}"`);
  if (p.spaceAfter !== undefined) a.push(`fo:margin-bottom="${pt(p.spaceAfter)}"`);
  if (p.indentLeft !== undefined) a.push(`fo:margin-left="${pt(p.indentLeft)}"`);
  if (p.indentRight !== undefined) a.push(`fo:margin-right="${pt(p.indentRight)}"`);
  if (p.indentFirst !== undefined) a.push(`fo:text-indent="${pt(p.indentFirst)}"`);
  if (p.lineHeight !== undefined) a.push(`fo:line-height="${Math.round(p.lineHeight * 100)}%"`);
  if (p.keepWithNext) a.push('fo:keep-with-next="always"');
  if (p.pageBreakBefore) a.push('fo:break-before="page"');
  if (extra) a.push(extra);
  return a.length ? `<style:paragraph-properties ${a.join(" ")}/>` : "";
}

function odfText(s) {
  // ODF collapses white space: tabs, runs of spaces and leading spaces need elements
  let out = "";
  const parts = s.split("\t");
  parts.forEach((t, i) => {
    if (i) out += "<text:tab/>";
    out += esc(t).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`).replace(/^ /, "<text:s/>");
  });
  return out;
}

const BULLETS = ["•", "◦", "▪"];
const NUMFMT = ["1", "a", "i"];

/**
 * Writes an .odt file.
 * @param {object} input office document model
 * @returns {Uint8Array}
 */
export function writeOdt(input) {
  const doc = normalizeDoc(input);
  const auto = []; // automatic styles of content.xml
  const textStyles = new Map();
  const paraStyles = new Map();
  const pictures = [];
  const picNames = new Map();
  let frameN = 0;
  const textStyle = (m) => {
    const props = textProps(m);
    if (!props) return null;
    if (!textStyles.has(props)) {
      const name = `T${textStyles.size + 1}`;
      textStyles.set(props, name);
      auto.push(`<style:style style:name="${name}" style:family="text">${props}</style:style>`);
    }
    return textStyles.get(props);
  };
  const paraStyle = (p, extra = "") => {
    const parent = odfName(p.style || "Normal");
    const props = paraProps(p.props, extra);
    if (!props) return parent;
    const key = `${parent}|${props}`;
    if (!paraStyles.has(key)) {
      const name = `P${paraStyles.size + 1}`;
      paraStyles.set(key, name);
      auto.push(`<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${escAttr(parent)}">${props}</style:style>`);
    }
    return paraStyles.get(key);
  };
  const footnoteNo = new Map();
  const inline = (runs, inNote = false) => {
    let x = "";
    for (const r of runs) {
      let piece = "";
      if (isText(r)) {
        const { link, ...m } = r;
        const ts = textStyle(m);
        piece = ts ? `<text:span text:style-name="${ts}">${odfText(r.text)}</text:span>` : odfText(r.text);
        if (link) piece = `<text:a xlink:type="simple" xlink:href="${escAttr(link)}">${piece}</text:a>`;
      } else if (r.type === "break") piece = "<text:line-break/>";
      else if (r.type === "field") piece = r.field === "page" ? '<text:page-number text:select-page="current">1</text:page-number>' : r.field === "pages" ? "<text:page-count>1</text:page-count>" : '<text:date style:data-style-name="N1"/>';
      else if (r.type === "image") {
        const m = doc.media[r.media];
        if (!m?.bytes) continue;
        let href = picNames.get(r.media);
        if (!href) {
          href = `Pictures/${r.media}.${IMAGE_EXT[m.mime] || "png"}`;
          picNames.set(r.media, href);
          pictures.push([href, m.bytes, m.mime]);
        }
        frameN++;
        piece = `<draw:frame draw:name="Image${frameN}" text:anchor-type="as-char" svg:width="${pt(r.width)}" svg:height="${pt(r.height)}" draw:z-index="0"><draw:image xlink:href="${escAttr(href)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${r.alt ? `<svg:desc>${esc(r.alt)}</svg:desc>` : ""}</draw:frame>`;
      } else if (r.type === "footnote" && !inNote) {
        if (!footnoteNo.has(r.id)) footnoteNo.set(r.id, footnoteNo.size + 1);
        const n = footnoteNo.get(r.id);
        const body = (doc.footnotes[r.id] || []).map((p) => `<text:p text:style-name="Footnote">${inline(p.runs, true)}</text:p>`).join("") || '<text:p text:style-name="Footnote"/>';
        piece = `<text:note text:id="ftn${n}" text:note-class="footnote"><text:note-citation>${n}</text:note-citation><text:note-body>${body}</text:note-body></text:note>`;
      }
      x += piece;
    }
    return x;
  };
  const paraXml = (p, extra = "") => {
    const level = p.list ? 0 : resolveStyle(doc, p.style).outline;
    const sn = escAttr(paraStyle(p, extra));
    return level ? `<text:h text:style-name="${sn}" text:outline-level="${level}">${inline(p.runs)}</text:h>` : `<text:p text:style-name="${sn}">${inline(p.runs)}</text:p>`;
  };
  const tableXml = (t, n) => {
    const total = t.cols.reduce((a, c) => a + c, 0);
    auto.push(`<style:style style:name="Table${n}" style:family="table"><style:table-properties style:width="${pt(total)}" table:align="left"/></style:style>`);
    let x = `<table:table table:name="Table${n}" table:style-name="Table${n}">`;
    t.cols.forEach((w, i) => {
      auto.push(`<style:style style:name="Table${n}.C${i + 1}" style:family="table-column"><style:table-column-properties style:column-width="${pt(w)}"/></style:style>`);
      x += `<table:table-column table:style-name="Table${n}.C${i + 1}"/>`;
    });
    const border = t.borders.style === "none" ? "none" : `${pt(t.borders.width)} solid ${t.borders.color}`;
    const cellStyles = new Map();
    const cellStyle = (cell) => {
      const key = `${cell.shading || ""}|${cell.vAlign || ""}`;
      if (!cellStyles.has(key)) {
        const name = `Table${n}.S${cellStyles.size + 1}`;
        cellStyles.set(key, name);
        auto.push(`<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties fo:padding="2.5pt" fo:border="${border}"${cell.shading ? ` fo:background-color="${cell.shading}"` : ""}${cell.vAlign ? ` style:vertical-align="${cell.vAlign}"` : ""}/></style:style>`);
      }
      return cellStyles.get(key);
    };
    const grid = tableGrid(t);
    const headerRows = t.rows.findIndex((r) => !r.header);
    t.rows.forEach((row, r) => {
      if (r === 0 && headerRows > 0) x += "<table:table-header-rows>";
      x += "<table:table-row>";
      for (let c = 0; c < t.cols.length; c++) {
        const g = grid[r][c];
        if (g && g.origin) {
          const cell = row.cells[g.ci];
          x += `<table:table-cell table:style-name="${cellStyle(cell)}" office:value-type="string"${g.colspan > 1 ? ` table:number-columns-spanned="${g.colspan}"` : ""}${g.rowspan > 1 ? ` table:number-rows-spanned="${g.rowspan}"` : ""}>${cell.blocks.map((p) => paraXml(p)).join("")}</table:table-cell>`;
        } else if (g) x += "<table:covered-table-cell/>";
        else x += `<table:table-cell table:style-name="${cellStyle({})}"><text:p/></table:table-cell>`;
      }
      x += "</table:table-row>";
      if (r === headerRows - 1 && headerRows > 0) x += "</table:table-header-rows>";
    });
    return `${x}</table:table>`;
  };

  let body = "";
  let pendingBreak = false;
  let tables = 0;
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const brk = pendingBreak ? 'fo:break-before="page"' : "";
    if (b.type === "paragraph" && b.list) {
      // consecutive list paragraphs of one list become one nested text:list
      let j = i;
      const group = [];
      while (j < blocks.length && blocks[j].type === "paragraph" && blocks[j].list && (j === i || blocks[j].list.id === b.list.id || blocks[j].list.level > 0)) group.push(blocks[j++]);
      body += listXml(group, b.list.kind === "number" ? "LNum" : "LBul", (p, k) => paraXml(p, k === 0 ? brk : ""));
      pendingBreak = false;
      i = j - 1;
      continue;
    }
    if (b.type === "paragraph") body += paraXml(b, brk);
    else if (b.type === "table") {
      if (pendingBreak) body += `<text:p text:style-name="${paraStyle({ style: "Normal" }, 'fo:break-before="page"')}"/>`;
      body += tableXml(b, ++tables);
    } else if (b.type === "rule") body += `<text:p text:style-name="${paraStyle({ style: "Normal" }, 'fo:border-bottom="0.75pt solid #808080" fo:padding-bottom="2pt"')}"/>`;
    pendingBreak = b.type === "pageBreak";
  }

  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NSDECL} office:version="1.3"><office:font-face-decls>${fontDecls(doc)}</office:font-face-decls><office:automatic-styles>${listStyles()}${auto.join("")}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const pg = doc.page;
  const hf = (tag, blocks) => (blocks.length ? `<style:${tag}>${blocks.map((p) => `<text:p text:style-name="${odfName(p.style)}">${inline(p.runs, true)}</text:p>`).join("")}</style:${tag}>` : "");
  const headerHeight = (m) => `<style:header-footer-properties fo:min-height="0pt" fo:margin-${m}="${pt(6)}"/>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NSDECL} office:version="1.3"><office:font-face-decls>${fontDecls(doc)}</office:font-face-decls><office:styles>${namedStyles(doc)}<style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-left="0pt" fo:text-indent="0pt"/><style:text-properties fo:font-size="10pt"/></style:style><text:notes-configuration text:note-class="footnote" style:num-format="1" text:start-value="0" text:footnotes-position="page" text:start-numbering-at="document"/></office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${pt(pg.width)}" fo:page-height="${pt(pg.height)}" style:print-orientation="${pg.orientation}" fo:margin-top="${pt(doc.header.length ? pg.margins.header : pg.margins.top)}" fo:margin-bottom="${pt(doc.footer.length ? pg.margins.footer : pg.margins.bottom)}" fo:margin-left="${pt(pg.margins.left)}" fo:margin-right="${pt(pg.margins.right)}">${pg.columns > 1 ? `<style:columns fo:column-count="${pg.columns}" fo:column-gap="${pt(pg.columnGap)}"/>` : ""}</style:page-layout-properties><style:header-style>${doc.header.length ? headerHeight("bottom").replace(pt(6), pt(Math.max(0, pg.margins.top - pg.margins.header - 14))) : ""}</style:header-style><style:footer-style>${doc.footer.length ? headerHeight("top").replace(pt(6), pt(Math.max(0, pg.margins.bottom - pg.margins.footer - 14))) : ""}</style:footer-style></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${hf("header", doc.header)}${hf("footer", doc.footer)}</style:master-page></office:master-styles></office:document-styles>`;
  const m = doc.meta;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${NSDECL} office:version="1.3"><office:meta><meta:generator>OpenFini</meta:generator><dc:title>${esc(m.title)}</dc:title><dc:subject>${esc(m.subject)}</dc:subject><dc:creator>${esc(m.author)}</dc:creator><meta:initial-creator>${esc(m.author)}</meta:initial-creator>${m.keywords ? m.keywords.split(/\s*,\s*/).filter(Boolean).map((k) => `<meta:keyword>${esc(k)}</meta:keyword>`).join("") : ""}<dc:language>${esc(m.lang || "en-US")}</dc:language>${/^\d{4}-/.test(m.created) ? `<meta:creation-date>${esc(m.created.replace(/Z$/, ""))}</meta:creation-date>` : ""}</office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pictures.map(([p, , mime]) => `<manifest:file-entry manifest:full-path="${escAttr(p)}" manifest:media-type="${mime}"/>`).join("")}</manifest:manifest>`;
  return writeZip([
    ["mimetype", ODT_MIME, { store: true }],
    ["content.xml", content],
    ["styles.xml", styles],
    ["meta.xml", meta],
    ...pictures.map(([p, bytes]) => [p, bytes, { store: true }]),
    ["META-INF/manifest.xml", manifest],
  ]);
}

function listXml(items, styleName, para) {
  let x = "";
  let cur = -1;
  const itemOpen = [];
  items.forEach((p, k) => {
    const L = Math.min(8, p.list.level || 0);
    if (cur < L) {
      for (let lv = cur + 1; lv <= L; lv++) {
        if (lv > 0 && !itemOpen[lv - 1]) {
          x += "<text:list-item>";
          itemOpen[lv - 1] = true;
        }
        x += lv === 0 ? `<text:list text:style-name="${styleName}">` : "<text:list>";
      }
      cur = L;
    } else {
      while (cur > L) {
        if (itemOpen[cur]) x += "</text:list-item>";
        itemOpen[cur] = false;
        x += "</text:list>";
        cur--;
      }
      if (itemOpen[L]) x += "</text:list-item>";
    }
    x += `<text:list-item>${para(p, k)}`;
    itemOpen[L] = true;
  });
  while (cur >= 0) {
    if (itemOpen[cur]) x += "</text:list-item>";
    x += "</text:list>";
    cur--;
  }
  return x;
}

function listStyles() {
  const level = (k, inner) => `${inner}<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${pt(36 * (k + 1))}" fo:text-indent="-18pt" fo:margin-left="${pt(36 * (k + 1))}"/></style:list-level-properties>`;
  let b = '<text:list-style style:name="LBul">';
  let n = '<text:list-style style:name="LNum">';
  for (let k = 0; k < 10; k++) {
    b += `<text:list-level-style-bullet text:level="${k + 1}" text:bullet-char="${BULLETS[k % 3]}">${level(k, "")}</text:list-level-style-bullet>`;
    n += `<text:list-level-style-number text:level="${k + 1}" style:num-suffix="." style:num-format="${NUMFMT[k % 3]}">${level(k, "")}</text:list-level-style-number>`;
  }
  return `${b}</text:list-style>${n}</text:list-style>`;
}

function fontDecls(doc) {
  const fonts = new Set();
  for (const s of Object.values(doc.styles)) if (s.run?.font) fonts.add(s.run.font);
  const scan = (runs) => runs.forEach((r) => r.font && fonts.add(r.font));
  for (const b of doc.blocks) {
    if (b.type === "paragraph") scan(b.runs);
    else if (b.type === "table") b.rows.forEach((r) => r.cells.forEach((c) => c.blocks.forEach((p) => scan(p.runs))));
  }
  return [...fonts].map((f) => `<style:font-face style:name="${escAttr(f)}" svg:font-family="${escAttr(/\s/.test(f) ? `'${f}'` : f)}"/>`).join("");
}

function namedStyles(doc) {
  let x = "";
  for (const [id, s] of Object.entries(doc.styles)) {
    if (s.type === "character") continue;
    const name = odfName(id);
    const display = /^Heading[1-9]$/.test(id) ? `Heading ${id.slice(7)}` : DISPLAY[name] || s.name || id;
    const parent = s.basedOn ? ` style:parent-style-name="${escAttr(odfName(s.basedOn))}"` : "";
    const next = s.next ? ` style:next-style-name="${escAttr(odfName(s.next))}"` : "";
    const outline = s.outline ? ` style:default-outline-level="${s.outline}"` : "";
    x += `<style:style style:name="${escAttr(name)}" style:display-name="${escAttr(display)}" style:family="paragraph"${parent}${next}${outline} style:class="text">${paraProps(s.para)}${textProps(s.run || {})}</style:style>`;
  }
  return x;
}

// =============================================================================================== reader

const FROM_ODF = { Standard: "Normal", Default_20_Paragraph_20_Style: "Normal", Text_20_body: "Normal", Body_20_Text: "Normal", Title: "Title", Subtitle: "Subtitle", Quotations: "Quote", Preformatted_20_Text: "Code", List_20_Paragraph: "List", List: "List" };

function readTextProps(tp) {
  const m = {};
  if (!tp) return m;
  const a = tp.attrs;
  if (a["fo:font-weight"] && /bold|[6-9]00/.test(a["fo:font-weight"])) m.b = true;
  if (a["fo:font-style"] === "italic" || a["fo:font-style"] === "oblique") m.i = true;
  if (a["style:text-underline-style"] && a["style:text-underline-style"] !== "none") m.u = true;
  if (a["style:text-line-through-style"] && a["style:text-line-through-style"] !== "none") m.s = true;
  const pos = a["style:text-position"];
  if (pos) {
    if (/^super|^\d/.test(pos) && !/^0/.test(pos)) m.va = /^-/.test(pos) ? "sub" : "super";
    if (/^sub|^-/.test(pos)) m.va = "sub";
  }
  const color = normColor(a["fo:color"]);
  if (color) m.color = color;
  const bg = a["fo:background-color"];
  if (bg && bg !== "transparent") m.highlight = normColor(bg);
  const font = a["style:font-name"] || a["fo:font-family"];
  if (font) m.font = font.replace(/^['"]|['"]$/g, "");
  const size = lengthPt(a["fo:font-size"]);
  if (size) m.size = size;
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}

function readParaProps(pp) {
  const p = {};
  if (!pp) return p;
  const a = pp.attrs;
  const al = a["fo:text-align"];
  if (al) p.align = al === "start" || al === "left" ? "left" : al === "end" || al === "right" ? "right" : al === "center" ? "center" : al === "justify" ? "justify" : undefined;
  const map = [["fo:margin-top", "spaceBefore"], ["fo:margin-bottom", "spaceAfter"], ["fo:margin-left", "indentLeft"], ["fo:margin-right", "indentRight"], ["fo:text-indent", "indentFirst"]];
  for (const [k, key] of map) {
    const v = lengthPt(a[k]);
    if (v !== undefined) p[key] = v;
  }
  const lh = a["fo:line-height"];
  if (lh && /%$/.test(lh)) p.lineHeight = parseFloat(lh) / 100;
  if (a["fo:keep-with-next"] === "always") p.keepWithNext = true;
  if (a["fo:break-before"] === "page") p.pageBreakBefore = true;
  if (a["fo:break-after"] === "page") p._breakAfter = true;
  if (a["fo:border-bottom"] && a["fo:border-bottom"] !== "none") p._rule = true;
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return p;
}

function styleTable(root) {
  // style:name -> { family, parent, display, para, text, outline, listStyle }
  const map = new Map();
  for (const s of findAll(root, "style:style")) {
    map.set(`${s.attrs["style:family"]}:${s.attrs["style:name"]}`, {
      name: s.attrs["style:name"],
      family: s.attrs["style:family"],
      parent: s.attrs["style:parent-style-name"],
      next: s.attrs["style:next-style-name"],
      display: s.attrs["style:display-name"],
      outline: Number(s.attrs["style:default-outline-level"] || 0),
      listStyle: s.attrs["style:list-style-name"],
      para: readParaProps(child(s, "style:paragraph-properties")),
      text: readTextProps(child(s, "style:text-properties")),
      cell: child(s, "style:table-cell-properties"),
      col: child(s, "style:table-column-properties"),
    });
  }
  for (const s of findAll(root, "text:list-style")) {
    const levels = [];
    for (const l of s.children) if (typeof l !== "string") levels[Number(l.attrs["text:level"] || 1) - 1] = l.local === "list-level-style-bullet" ? "bullet" : l.local === "list-level-style-number" && l.attrs["style:num-format"] ? "number" : l.local === "list-level-style-number" ? "bullet" : "bullet";
    map.set(`list:${s.attrs["style:name"]}`, { levels });
  }
  return map;
}

/**
 * Reads an .odt file (or a flat .fodt XML document).
 * @param {Uint8Array} bytes
 * @param {{report?: object, name?: string}} [o]
 */
export function readOdt(bytes, o = {}) {
  const report = o.report || createReport("OpenDocument Text (ODT)", o.name);
  let contentXml;
  let stylesXml;
  let metaXml;
  let entries = {};
  const flat = bytes[0] === 0x3c || (bytes[0] === 0xef && bytes[1] === 0xbb);
  if (flat) contentXml = stylesXml = metaXml = new TextDecoder().decode(bytes);
  else {
    const z = readZip(bytes, { want: (n) => !/^(Thumbnails|Configurations2)\//.test(n) });
    for (const p of z.problems) report.note(p);
    if (!z.ok) throw new Error(z.problems[z.problems.length - 1] || "This is not a valid OpenDocument file.");
    entries = z.entries;
    const mime = zipText(entries, "mimetype")?.trim();
    if (mime && mime !== ODT_MIME && !/opendocument\.text/.test(mime)) throw new Error(/spreadsheet|presentation/.test(mime) ? "This is an OpenDocument spreadsheet or presentation, not a text document." : "This is not an OpenDocument text file.");
    contentXml = zipText(entries, "content.xml");
    stylesXml = zipText(entries, "styles.xml");
    metaXml = zipText(entries, "meta.xml");
  }
  if (!contentXml) throw new Error("The OpenDocument file has no content (content.xml is missing).");
  const content = parseXml(contentXml);
  const stylesRoot = stylesXml ? (flat ? content : parseXml(stylesXml)) : null;
  const named = stylesRoot ? styleTable(find(stylesRoot, "office:styles") || stylesRoot) : new Map();
  const autos = styleTable(find(content, "office:automatic-styles") || { children: [] });
  const stylesAuto = stylesRoot ? styleTable(find(stylesRoot, "office:automatic-styles") || { children: [] }) : new Map();
  const lookup = (family, name) => autos.get(`${family}:${name}`) || named.get(`${family}:${name}`) || stylesAuto.get(`${family}:${name}`);

  // named paragraph styles -> model styles
  const model = createDocument();
  const styles = defaultStyles();
  const idOf = new Map();
  for (const s of named.values()) {
    if (s.family !== "paragraph") continue;
    let id = FROM_ODF[s.name];
    const h = /^Heading_20_([1-9])$/.exec(s.name);
    if (h) id = `Heading${Math.min(6, +h[1])}`;
    if (!id && s.outline) id = `Heading${Math.min(6, s.outline)}`;
    if (!id) id = (s.display || s.name).replace(/[^\w -]/g, "").slice(0, 60) || s.name;
    idOf.set(s.name, id);
  }
  for (const s of named.values()) {
    if (s.family !== "paragraph") continue;
    const id = idOf.get(s.name);
    const def = styles[id] || {};
    const { _breakAfter, ...para } = s.para;
    styles[id] = { ...def, name: def.name || s.display || id, type: "paragraph", para: { ...(def.para || {}), ...para }, run: { ...(def.run || {}), ...s.text } };
    const parent = s.parent && idOf.get(s.parent);
    if (parent && parent !== id) styles[id].basedOn = parent;
    else if (id !== "Normal" && !def.basedOn) styles[id].basedOn = "Normal";
    if (s.next && idOf.get(s.next)) styles[id].next = idOf.get(s.next);
    if (/^Heading[1-6]$/.test(id)) styles[id].outline = +id.slice(7);
    if (id === "Normal") delete styles[id].basedOn;
  }
  // LibreOffice's default font lives in style:default-style
  const dflt = stylesRoot && findAll(stylesRoot, "style:default-style").find((d) => d.attrs["style:family"] === "paragraph");
  if (dflt) styles.Normal.run = { ...readTextProps(child(dflt, "style:text-properties")), ...styles.Normal.run };
  model.styles = styles;

  const ctx = { report, lookup, idOf, entries, media: {}, mediaByHref: new Map(), footnotes: {}, counts: { images: 0, tables: 0, lists: 0, links: 0 }, listId: 0, lastListId: null };
  const officeText = find(content, "office:text");
  if (!officeText) throw new Error("This OpenDocument file has no text body.");
  model.blocks = readBody(officeText, ctx);

  // page layout and header/footer of the "Standard" (or first) master page
  if (stylesRoot) {
    const masters = findAll(stylesRoot, "style:master-page");
    const master = masters.find((m) => m.attrs["style:name"] === "Standard") || masters[0];
    const layoutName = master?.attrs["style:page-layout-name"];
    const layout = findAll(stylesRoot, "style:page-layout").find((l) => l.attrs["style:name"] === layoutName);
    const lp = child(layout, "style:page-layout-properties");
    if (lp) {
      const page = defaultPage();
      const w = lengthPt(lp.attrs["fo:page-width"]);
      const h = lengthPt(lp.attrs["fo:page-height"]);
      if (w && h) {
        page.width = w;
        page.height = h;
        page.orientation = lp.attrs["style:print-orientation"] === "landscape" || w > h ? "landscape" : "portrait";
        const pw = Math.min(w, h);
        const ph = Math.max(w, h);
        page.size = Object.keys(PAGE_SIZES).find((k) => Math.abs(PAGE_SIZES[k].width - pw) < 3 && Math.abs(PAGE_SIZES[k].height - ph) < 3) || "custom";
      }
      for (const [k, key] of [["fo:margin-top", "top"], ["fo:margin-bottom", "bottom"], ["fo:margin-left", "left"], ["fo:margin-right", "right"]]) {
        const v = lengthPt(lp.attrs[k]);
        if (v !== undefined) page.margins[key] = v;
      }
      const cols = child(lp, "style:columns");
      if (cols && Number(cols.attrs["fo:column-count"]) > 1) {
        page.columns = Math.min(4, Number(cols.attrs["fo:column-count"]));
        page.columnGap = lengthPt(cols.attrs["fo:column-gap"]) ?? 36;
      }
      // ODF margins are outside the header/footer; the body starts below the header area
      for (const kind of ["header", "footer"]) {
        const el = child(master, `style:${kind}`);
        if (!el) continue;
        const saved = ctx.lookup;
        ctx.lookup = (f, n) => stylesAuto.get(`${f}:${n}`) || named.get(`${f}:${n}`);
        model[kind] = readBody(el, ctx).filter((b) => b.type === "paragraph").slice(0, 20);
        ctx.lookup = saved;
        if (model[kind].length) {
          const edge = kind === "header" ? "top" : "bottom";
          page.margins[kind] = page.margins[edge];
          page.margins[edge] += 28;
        }
      }
      model.page = page;
    }
    if (findAll(stylesRoot, "style:header-first").length || findAll(stylesRoot, "style:header-left").length) report.flattened("Different first-page or left-page headers were replaced by the default header.");
  }

  if (metaXml) {
    const m = parseXml(metaXml);
    model.meta.title = textOf(find(m, "dc:title")).trim();
    model.meta.author = (textOf(find(m, "dc:creator")) || textOf(find(m, "meta:initial-creator"))).trim();
    model.meta.subject = textOf(find(m, "dc:subject")).trim();
    model.meta.keywords = findAll(m, "meta:keyword").map(textOf).join(", ");
    model.meta.created = textOf(find(m, "meta:creation-date")).trim() || model.meta.created;
  }
  model.media = ctx.media;
  model.footnotes = ctx.footnotes;
  const c = ctx.counts;
  report.kept(`${plural(model.blocks.filter((b) => b.type === "paragraph").length, "paragraph")}, text formatting and named styles.`);
  if (c.lists) report.kept(`${plural(c.lists, "list paragraph")}.`);
  if (c.tables) report.kept(`${plural(c.tables, "table")}.`);
  if (c.images) report.kept(`${plural(c.images, "image")}.`);
  if (Object.keys(ctx.footnotes).length) report.kept(`${plural(Object.keys(ctx.footnotes).length, "footnote")}.`);
  return { doc: normalizeDoc(model), report };
}

function resolveParaStyle(ctx, name) {
  // automatic style -> { style id, props, marks }
  let s = ctx.lookup("paragraph", name);
  const props = {};
  const marks = {};
  let guard = 0;
  while (s && !ctx.idOf.has(s.name) && guard++ < 10) {
    Object.assign(props, s.para);
    Object.assign(marks, s.text);
    if (s.listStyle) props._list = s.listStyle;
    s = s.parent ? ctx.lookup("paragraph", s.parent) : null;
  }
  return { style: s ? ctx.idOf.get(s.name) : ctx.idOf.get(name) || "Normal", props, marks };
}

function readBody(parent, ctx, listCtx = null) {
  const out = [];
  for (const el of parent.children) {
    if (typeof el === "string") continue;
    switch (el.name) {
      case "text:p":
      case "text:h":
        out.push(...readPara(el, ctx, listCtx));
        break;
      case "text:list": {
        const styleName = el.attrs["text:style-name"] || listCtx?.style;
        const level = listCtx ? listCtx.level + 1 : 0;
        let id = listCtx?.id;
        if (!listCtx) {
          id = el.attrs["text:continue-numbering"] === "true" || el.attrs["text:continue-list"] ? ctx.lastListId || `o${++ctx.listId}` : `o${++ctx.listId}`;
          ctx.lastListId = id;
        }
        const kinds = ctx.lookup("list", styleName)?.levels || [];
        for (const item of children(el, "list-item").concat(children(el, "list-header"))) out.push(...readBody(item, ctx, { style: styleName, level, id, kind: kinds[level] || kinds[0] || "bullet" }));
        break;
      }
      case "table:table":
        if (listCtx || parent.name === "table:table-cell") {
          ctx.report.flattened("Nested tables were converted to paragraphs.");
          for (const cell of findAll(el, "table:table-cell")) out.push(...readBody(cell, ctx));
        } else out.push(readTable(el, ctx));
        break;
      case "text:section":
      case "text:soft-page-break":
      case "office:forms":
      case "text:sequence-decls":
        if (el.name === "text:section") out.push(...readBody(el, ctx, listCtx));
        break;
      case "text:table-of-content":
      case "text:alphabetical-index":
      case "text:illustration-index":
        ctx.report.flattened("Tables of contents and indexes were kept as plain text.");
        out.push(...readBody(child(el, "text:index-body") || el, ctx, listCtx));
        break;
      case "draw:frame":
        out.push({ type: "paragraph", style: "Normal", runs: readInline(el, ctx, {}) });
        break;
    }
  }
  return out;
}

function readPara(el, ctx, listCtx) {
  const { style: sid, props, marks } = resolveParaStyle(ctx, el.attrs["text:style-name"]);
  let style = sid;
  if (el.name === "text:h" && !/^Heading/.test(style)) style = `Heading${Math.min(6, Math.max(1, Number(el.attrs["text:outline-level"] || 1)))}`;
  const { _breakAfter, _list, _rule, ...pp } = props;
  const p = { type: "paragraph", style, runs: mergeRuns(readInline(el, ctx, marks)) };
  const before = [];
  const after = [];
  if (pp.pageBreakBefore) {
    delete pp.pageBreakBefore;
    before.push({ type: "pageBreak" });
  }
  if (_breakAfter) after.push({ type: "pageBreak" });
  if (Object.keys(pp).length) p.props = pp;
  if (listCtx) {
    p.list = { kind: listCtx.kind, level: Math.min(8, listCtx.level), id: listCtx.id };
    if (p.props) {
      delete p.props.indentLeft;
      delete p.props.indentFirst;
    }
    if (p.style === "Normal") p.style = "List";
    ctx.counts.lists++;
  }
  // an empty paragraph with a bottom border is a horizontal rule
  if (_rule && !p.runs.length && !listCtx) return [...before, { type: "rule" }, ...after];
  return [...before, p, ...after];
}

function readInline(el, ctx, base, link = null) {
  const out = [];
  for (const c of el.children) {
    if (typeof c === "string") {
      const t = c.replace(/[ \t\r\n]+/g, " ");
      if (t) out.push({ text: t, ...base, ...(link ? { link } : {}) });
      continue;
    }
    switch (c.name) {
      case "text:span": {
        const st = ctx.lookup("text", c.attrs["text:style-name"]);
        out.push(...readInline(c, ctx, { ...base, ...(st?.text || {}) }, link));
        break;
      }
      case "text:a": {
        const href = safeHref(c.attrs["xlink:href"]);
        if (href) ctx.counts.links++;
        out.push(...readInline(c, ctx, base, href || link));
        break;
      }
      case "text:s":
        out.push({ text: " ".repeat(Math.min(1000, Math.max(1, Number(c.attrs["text:c"] || 1)))), ...base });
        break;
      case "text:tab":
        out.push({ text: "\t", ...base });
        break;
      case "text:line-break":
        out.push({ type: "break" });
        break;
      case "text:page-number":
        out.push({ type: "field", field: "page" });
        break;
      case "text:page-count":
        out.push({ type: "field", field: "pages" });
        break;
      case "text:date":
      case "text:time":
        out.push({ type: "field", field: "date" });
        break;
      case "text:note": {
        if (c.attrs["text:note-class"] === "endnote") ctx.report.flattened("Endnotes were converted to footnotes.");
        const id = `fn${Object.keys(ctx.footnotes).length + 1}`;
        ctx.footnotes[id] = readBody(child(c, "text:note-body") || c, ctx).filter((b) => b.type === "paragraph").map((p) => ({ ...p, style: "Normal" }));
        out.push({ type: "footnote", id });
        break;
      }
      case "draw:frame": {
        const img = child(c, "draw:image");
        const box = child(c, "draw:text-box");
        if (img) {
          const r = readImage(c, img, ctx);
          if (r) out.push(r);
        } else if (box) {
          ctx.report.flattened("Text frames were converted to inline text.");
          out.push({ text: ` ${findAll(box, "text:p").map(textOf).join(" ")} `, ...base });
        } else ctx.report.dropped("Embedded objects and charts.");
        break;
      }
      case "draw:a":
        out.push(...readInline(c, ctx, base, safeHref(c.attrs["xlink:href"]) || link));
        break;
      case "text:bookmark":
      case "text:bookmark-start":
      case "text:bookmark-end":
      case "text:soft-page-break":
      case "office:annotation-end":
        break;
      case "office:annotation":
        ctx.report.dropped("Comments (Office Studio does not support comments yet).");
        break;
      case "text:tracked-changes":
        ctx.report.dropped("Tracked changes (the current text is shown).");
        break;
      case "draw:custom-shape":
      case "draw:rect":
      case "draw:g":
      case "draw:line":
        ctx.report.dropped("Drawing shapes.");
        break;
      default:
        // unknown inline elements: keep their text
        if (c.children.length) out.push(...readInline(c, ctx, base, link));
    }
  }
  return out;
}

function readImage(frame, img, ctx) {
  const href = img.attrs["xlink:href"] || "";
  let bytes = null;
  if (href && !/^[a-z]+:/i.test(href)) bytes = ctx.entries[href.replace(/^\.\//, "")];
  else if (child(img, "office:binary-data")) bytes = fromBase64(textOf(child(img, "office:binary-data")));
  if (!bytes) {
    ctx.report.dropped("Linked or missing images.");
    return null;
  }
  const mime = sniffImage(bytes, href);
  if (!mime) {
    ctx.report.dropped("Images in a format Office Studio cannot show (for example EMF, WMF or SVM).");
    return null;
  }
  let id = ctx.mediaByHref.get(href);
  if (!id) {
    id = `img${Object.keys(ctx.media).length + 1}`;
    const size = imageSize(bytes, mime);
    ctx.media[id] = { id, mime, name: href.split("/").pop(), bytes, ...(size ? { w: size.w, h: size.h } : {}) };
    ctx.mediaByHref.set(href, id);
  }
  const width = lengthPt(frame.attrs["svg:width"]) || (ctx.media[id].w || 200) * 0.75;
  const height = lengthPt(frame.attrs["svg:height"]) || (ctx.media[id].h || 150) * 0.75;
  const alt = textOf(child(frame, "svg:desc")) || textOf(child(frame, "svg:title")) || "";
  if (frame.attrs["text:anchor-type"] && frame.attrs["text:anchor-type"] !== "as-char") ctx.report.flattened("Floating images were placed inline with the text.");
  ctx.counts.images++;
  return { type: "image", media: id, width, height, ...(alt ? { alt } : {}) };
}

function readTable(el, ctx) {
  ctx.counts.tables++;
  const cols = [];
  const colEls = [];
  const collect = (p) => {
    for (const c of p.children) {
      if (typeof c === "string") continue;
      if (c.name === "table:table-column") colEls.push(c);
      else if (c.name === "table:table-columns" || c.name === "table:table-header-columns") collect(c);
    }
  };
  collect(el);
  for (const c of colEls) {
    const st = ctx.lookup("table-column", c.attrs["table:style-name"]);
    const w = lengthPt(st?.col?.attrs["style:column-width"]) || 72;
    const n = Math.min(64, Math.max(1, Number(c.attrs["table:number-columns-repeated"] || 1)));
    for (let k = 0; k < n; k++) cols.push(w);
  }
  const rows = [];
  let borders = { style: "none", width: 0.5, color: "#808080" };
  const addRows = (p, header) => {
    for (const r of p.children) {
      if (typeof r === "string") continue;
      if (r.name === "table:table-header-rows") addRows(r, true);
      else if (r.name === "table:table-rows" || r.name === "table:table-row-group") addRows(r, header);
      else if (r.name === "table:table-row") {
        const repeat = Math.min(100, Math.max(1, Number(r.attrs["table:number-rows-repeated"] || 1)));
        for (let k = 0; k < repeat && rows.length < 2000; k++) {
          const row = { cells: [] };
          if (header) row.header = true;
          for (const c of r.children) {
            if (typeof c === "string" || c.name !== "table:table-cell") continue;
            const st = ctx.lookup("table-cell", c.attrs["table:style-name"]);
            const cell = { blocks: readBody(c, ctx).filter((b) => b.type === "paragraph") };
            if (!cell.blocks.length) cell.blocks.push({ type: "paragraph", style: "Normal", runs: [] });
            const cs = Number(c.attrs["table:number-columns-spanned"] || 1);
            const rs = Number(c.attrs["table:number-rows-spanned"] || 1);
            if (cs > 1) cell.colspan = cs;
            if (rs > 1) cell.rowspan = rs;
            const a = st?.cell?.attrs || {};
            const bg = a["fo:background-color"];
            if (bg && bg !== "transparent") cell.shading = normColor(bg);
            if (["middle", "bottom"].includes(a["style:vertical-align"])) cell.vAlign = a["style:vertical-align"];
            const b = a["fo:border"] || a["fo:border-top"];
            if (b && b !== "none") {
              const m = /([\d.]+(?:pt|cm|mm|in)).*?(#[0-9a-f]{6})/i.exec(b);
              borders = { style: "single", width: Math.max(0.25, lengthPt(m?.[1]) || 0.5), color: normColor(m?.[2]) || "#000000" };
            }
            const rc = Math.min(64, Math.max(1, Number(c.attrs["table:number-columns-repeated"] || 1)));
            for (let q = 0; q < rc; q++) row.cells.push(q ? structuredCloneSafe(cell) : cell);
          }
          rows.push(row);
        }
      }
    }
  };
  addRows(el, false);
  const ncols = Math.max(cols.length, 1, ...rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan || 1), 0)));
  while (cols.length < ncols) cols.push(72);
  if (!rows.length) rows.push({ cells: [{ blocks: [{ type: "paragraph", style: "Normal", runs: [] }] }] });
  return { type: "table", cols: cols.slice(0, ncols), rows, borders };
}

const structuredCloneSafe = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Uint8Array ? undefined : x)));
