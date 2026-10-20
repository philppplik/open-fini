// Office Studio document model: a flow document of blocks (paragraphs, tables, page breaks, rules) with inline runs,
// named styles with inheritance, lists, footnotes, media and one page setup. Pure module (no DOM): the readers and
// writers (docx, odt, rtf, html, markdown, text, pdf), the editor and the Vibe tools all work on this model.
//
// Lengths are points (1 pt = 1/72 in). Every update function is immutable: it returns a new document that shares
// unchanged blocks with the old one, so undo can keep cheap snapshots and the editor re-renders only what changed.
//
//   OfficeDoc  = { type: "office-document", version, meta, page, header, footer, styles, blocks, footnotes, media }
//   Block      = Paragraph | Table | { type: "pageBreak" } | { type: "rule" }
//   Paragraph  = { type: "paragraph", style, props?, list?: { kind: "bullet"|"number", level, id? }, runs: Inline[] }
//   Table      = { type: "table", cols: number[], rows: [{ header?, cells: [{ blocks: Paragraph[], colspan?, rowspan?, shading?, vAlign? }] }], borders }
//   Inline     = { text, b?, i?, u?, s?, va?: "sub"|"super", color?, highlight?, font?, size?, link? }
//              | { type: "break" } | { type: "image", media, width, height, alt? } | { type: "footnote", id }
//              | { type: "field", field: "page"|"pages"|"date" }
// Inline objects count as one character in offsets (a line break as "\n", the others as U+FFFC).

export const OFFICE_VERSION = 1;
export const OBJ = "\uFFFC";

/** Page sizes in points, portrait. */
export const PAGE_SIZES = {
  A4: { label: "A4", width: 595.28, height: 841.89 },
  Letter: { label: "US Letter", width: 612, height: 792 },
  Legal: { label: "US Legal", width: 612, height: 1008 },
  A5: { label: "A5", width: 419.53, height: 595.28 },
  A3: { label: "A3", width: 841.89, height: 1190.55 },
};

export const MARK_KEYS = ["b", "i", "u", "s", "va", "color", "highlight", "font", "size", "link"];
export const PARA_KEYS = ["align", "spaceBefore", "spaceAfter", "lineHeight", "indentLeft", "indentRight", "indentFirst", "keepWithNext", "pageBreakBefore"];
export const ALIGNS = ["left", "center", "right", "justify"];
export const BUILTIN_STYLE_IDS = ["Normal", "Title", "Subtitle", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6", "Quote", "Code", "List"];
export const DEFAULT_FONT = "Calibri";

const H_SIZE = [20, 16, 14, 12, 11, 11];
const H_BEFORE = [20, 16, 14, 12, 10, 10];

/** The built-in named styles (Normal, Title, Subtitle, Heading 1-6, Quote, Code, List). */
export function defaultStyles() {
  const s = {
    Normal: { name: "Normal", type: "paragraph", para: { spaceAfter: 8, lineHeight: 1.15 }, run: { font: DEFAULT_FONT, size: 11, color: "#000000" } },
    Title: { name: "Title", type: "paragraph", basedOn: "Normal", next: "Normal", para: { spaceAfter: 6 }, run: { size: 28, color: "#17202a" } },
    Subtitle: { name: "Subtitle", type: "paragraph", basedOn: "Normal", next: "Normal", para: { spaceAfter: 10 }, run: { size: 15, color: "#595959" } },
    Quote: { name: "Quote", type: "paragraph", basedOn: "Normal", para: { indentLeft: 36, indentRight: 36, spaceBefore: 6, spaceAfter: 10 }, run: { i: true, color: "#404040" } },
    Code: { name: "Code", type: "paragraph", basedOn: "Normal", para: { spaceAfter: 0, lineHeight: 1 }, run: { font: "Consolas", size: 10 } },
    List: { name: "List Paragraph", type: "paragraph", basedOn: "Normal", para: { spaceAfter: 2 } },
  };
  for (let n = 1; n <= 6; n++) {
    s[`Heading${n}`] = { name: `Heading ${n}`, type: "paragraph", basedOn: "Normal", next: "Normal", outline: n, para: { spaceBefore: H_BEFORE[n - 1], spaceAfter: 4, keepWithNext: true }, run: { size: H_SIZE[n - 1], b: n <= 4, i: n === 6, color: n <= 2 ? "#1f3864" : "#2f5496" } };
  }
  return s;
}

export function defaultPage(size = "A4", orientation = "portrait") {
  const base = PAGE_SIZES[size] || PAGE_SIZES.A4;
  const land = orientation === "landscape";
  const m = size === "Letter" || size === "Legal" ? 72 : 70.87; // 1 in / 2.5 cm
  return { size: PAGE_SIZES[size] ? size : "A4", width: land ? base.height : base.width, height: land ? base.width : base.height, orientation: land ? "landscape" : "portrait", margins: { top: m, right: m, bottom: m, left: m, header: 36, footer: 36 }, columns: 1, columnGap: 36 };
}

let seq = 0;
export function uid(prefix = "o") {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36).slice(-5)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const para = (runs = [], style = "Normal", extra = {}) => ({ type: "paragraph", style, runs: typeof runs === "string" ? (runs ? [{ text: runs }] : []) : runs, ...extra });
export const heading = (level, text) => para(text, `Heading${Math.min(6, Math.max(1, level | 0))}`);

/** A new, empty document. */
export function createDocument({ size = "A4", orientation = "portrait", title = "" } = {}) {
  return {
    type: "office-document",
    version: OFFICE_VERSION,
    meta: { title, author: "", subject: "", keywords: "", created: new Date().toISOString(), modified: "", lang: "en-US" },
    page: defaultPage(size, orientation),
    header: [],
    footer: [],
    styles: defaultStyles(),
    blocks: [para("")],
    footnotes: {},
    media: {},
  };
}

/** A table block with `rows` x `cols` empty cells; `width` is the content width the columns share. */
export function createTable(rows, cols, width = 450, { header = false } = {}) {
  rows = clampInt(rows, 1, 200, 2);
  cols = clampInt(cols, 1, 40, 2);
  const w = Math.round((width / cols) * 100) / 100;
  return {
    type: "table",
    cols: Array.from({ length: cols }, () => w),
    rows: Array.from({ length: rows }, (_, r) => ({ header: header && r === 0, cells: Array.from({ length: cols }, () => ({ blocks: [para("")] })) })),
    borders: { style: "single", width: 0.5, color: "#808080" },
  };
}

// ------------------------------------------------------------------------------------------------ normalization

const clampNum = (v, lo, hi, d) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
function clampInt(v, lo, hi, d) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}
const str = (v, max = 1e6) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));
const HEX = /^#[0-9a-f]{6}$/i;
export function normColor(c) {
  if (typeof c !== "string") return undefined;
  let s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^[0-9a-f]{6}$/.test(s)) s = `#${s}`;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (rgb) s = `#${[rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, "0")).join("")}`;
  if (NAMED_COLORS[s]) s = NAMED_COLORS[s];
  return HEX.test(s) ? s : undefined;
}
export const NAMED_COLORS = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#00ff00", darkgreen: "#008000", blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff", gray: "#808080", grey: "#808080", darkgray: "#a9a9a9", lightgray: "#d3d3d3", orange: "#ffa500", purple: "#800080", navy: "#000080", teal: "#008080", maroon: "#800000", olive: "#808000", pink: "#ffc0cb", darkblue: "#00008b", darkred: "#8b0000", darkcyan: "#008b8b", darkmagenta: "#8b008b", darkyellow: "#808000", lime: "#00ff00" };

export function safeHref(href) {
  const s = str(href, 2048).trim();
  if (!s) return undefined;
  if (/^(https?:|mailto:|tel:)/i.test(s) || s.startsWith("#")) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return undefined; // javascript:, data:, file: ...
  return s.startsWith("//") ? `https:${s}` : undefined;
}

/** Cleans run marks: known keys with valid values only. */
export function normMarks(r) {
  const m = {};
  if (!r || typeof r !== "object") return m;
  for (const k of ["b", "i", "u", "s"]) if (r[k]) m[k] = true;
  if (r.va === "sub" || r.va === "super") m.va = r.va;
  const color = normColor(r.color);
  if (color) m.color = color;
  const hl = normColor(r.highlight);
  if (hl) m.highlight = hl;
  if (typeof r.font === "string" && r.font.trim()) m.font = r.font.trim().replace(/["<>;{}]/g, "").slice(0, 64);
  const size = clampNum(r.size, 1, 1638, undefined);
  if (size) m.size = Math.round(size * 2) / 2;
  const link = safeHref(r.link);
  if (link) m.link = link;
  return m;
}

export function normParaProps(p) {
  const o = {};
  if (!p || typeof p !== "object") return o;
  if (ALIGNS.includes(p.align)) o.align = p.align;
  for (const k of ["spaceBefore", "spaceAfter"]) {
    const v = clampNum(p[k], 0, 1584, undefined);
    if (v !== undefined) o[k] = v;
  }
  const lh = clampNum(p.lineHeight, 0.5, 10, undefined);
  if (lh !== undefined) o.lineHeight = lh;
  for (const k of ["indentLeft", "indentRight"]) {
    const v = clampNum(p[k], -1584, 1584, undefined);
    if (v !== undefined) o[k] = v;
  }
  const f = clampNum(p.indentFirst, -1584, 1584, undefined);
  if (f !== undefined) o.indentFirst = f;
  if (p.keepWithNext) o.keepWithNext = true;
  if (p.pageBreakBefore) o.pageBreakBefore = true;
  return o;
}

function normInline(r, media, footnotes) {
  if (!r || typeof r !== "object") return null;
  if (r.type === "break") return { type: "break" };
  if (r.type === "image") {
    if (!r.media || !media[r.media]) return null;
    return { type: "image", media: str(r.media, 64), width: clampNum(r.width, 1, 5000, 100), height: clampNum(r.height, 1, 5000, 100), ...(r.alt ? { alt: str(r.alt, 2000) } : {}) };
  }
  if (r.type === "footnote") return footnotes[r.id] ? { type: "footnote", id: str(r.id, 64) } : null;
  if (r.type === "field") return ["page", "pages", "date"].includes(r.field) ? { type: "field", field: r.field } : null;
  const text = str(r.text).replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFC]/g, "");
  if (!text) return null;
  return { text, ...normMarks(r) };
}

export function normParagraph(p, ctx) {
  const out = { type: "paragraph", style: typeof p?.style === "string" && ctx.styles[p.style] ? p.style : "Normal", runs: [] };
  const props = normParaProps(p?.props);
  if (Object.keys(props).length) out.props = props;
  if (p?.list && (p.list.kind === "bullet" || p.list.kind === "number")) out.list = { kind: p.list.kind, level: clampInt(p.list.level, 0, 8, 0), ...(p.list.id ? { id: str(p.list.id, 64) } : {}) };
  for (const r of Array.isArray(p?.runs) ? p.runs : []) {
    if (out.runs.length >= 20000) break;
    const n = normInline(r, ctx.media, ctx.footnotes);
    if (n) out.runs.push(n);
  }
  out.runs = mergeRuns(out.runs);
  return out;
}

function normTable(t, ctx) {
  const rows = (Array.isArray(t.rows) ? t.rows : []).slice(0, 2000).map((row) => ({
    ...(row?.header ? { header: true } : {}),
    cells: (Array.isArray(row?.cells) ? row.cells : []).slice(0, 64).map((c) => {
      const cell = { blocks: (Array.isArray(c?.blocks) ? c.blocks : []).filter((b) => b?.type === "paragraph").slice(0, 2000).map((b) => normParagraph(b, ctx)) };
      if (!cell.blocks.length) cell.blocks.push(para(""));
      const cs = clampInt(c?.colspan, 1, 64, 1);
      const rs = clampInt(c?.rowspan, 1, 2000, 1);
      if (cs > 1) cell.colspan = cs;
      if (rs > 1) cell.rowspan = rs;
      const sh = normColor(c?.shading);
      if (sh) cell.shading = sh;
      if (["top", "middle", "bottom"].includes(c?.vAlign)) cell.vAlign = c.vAlign;
      return cell;
    }),
  })).filter((r) => r.cells.length);
  if (!rows.length) return null;
  const ncols = Math.max(1, ...rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan || 1), 0)));
  const cols = Array.from({ length: ncols }, (_, i) => clampNum(Array.isArray(t.cols) ? t.cols[i] : undefined, 4, 2000, 72));
  const b = t.borders || {};
  return { type: "table", cols, rows, borders: { style: b.style === "none" ? "none" : "single", width: clampNum(b.width, 0.25, 6, 0.5), color: normColor(b.color) || "#808080" } };
}

/**
 * Validates any JSON-ish value into a well-formed document (unknown keys dropped, values clamped). Never throws.
 * @param {any} input
 */
export function normalizeDoc(input) {
  const d = input && typeof input === "object" ? input : {};
  const base = createDocument();
  const media = {};
  for (const [id, m] of Object.entries(d.media && typeof d.media === "object" ? d.media : {})) {
    if (!/^[\w.-]{1,64}$/.test(id) || !m || typeof m !== "object") continue;
    const mime = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "image/webp"].includes(m.mime) ? m.mime : null;
    if (!mime) continue;
    media[id] = { id, mime, name: str(m.name, 200), ...(m.bytes instanceof Uint8Array ? { bytes: m.bytes } : {}), ...(m.w ? { w: clampNum(m.w, 1, 1e5, 1) } : {}), ...(m.h ? { h: clampNum(m.h, 1, 1e5, 1) } : {}) };
  }
  const styles = defaultStyles();
  for (const [id, s] of Object.entries(d.styles && typeof d.styles === "object" ? d.styles : {})) {
    if (!/^[\w -]{1,64}$/.test(id) || !s || typeof s !== "object") continue;
    styles[id] = {
      name: str(s.name || id, 100),
      type: s.type === "character" ? "character" : "paragraph",
      ...(typeof s.basedOn === "string" && s.basedOn !== id ? { basedOn: s.basedOn } : {}),
      ...(typeof s.next === "string" ? { next: s.next } : {}),
      ...(s.outline ? { outline: clampInt(s.outline, 1, 9, 1) } : {}),
      para: normParaProps(s.para),
      run: normMarks(s.run),
    };
  }
  for (const s of Object.values(styles)) if (s.basedOn && !styles[s.basedOn]) delete s.basedOn;
  if (styles.Normal.basedOn) delete styles.Normal.basedOn;
  const footnotes = {};
  const ctx = { styles, media, footnotes };
  // footnote ids must exist before paragraphs reference them
  const fnIn = d.footnotes && typeof d.footnotes === "object" ? d.footnotes : {};
  for (const id of Object.keys(fnIn)) if (/^[\w.-]{1,64}$/.test(id)) footnotes[id] = [];
  for (const id of Object.keys(footnotes)) footnotes[id] = (Array.isArray(fnIn[id]) ? fnIn[id] : []).filter((b) => b?.type === "paragraph").slice(0, 200).map((b) => normParagraph(b, { ...ctx, footnotes: {} }));
  const blocks = [];
  for (const b of Array.isArray(d.blocks) ? d.blocks : []) {
    if (blocks.length >= 200000) break;
    if (!b || typeof b !== "object") continue;
    if (b.type === "paragraph") blocks.push(normParagraph(b, ctx));
    else if (b.type === "table") {
      const t = normTable(b, ctx);
      // two tables in a row would merge into one in Word: keep an empty paragraph between them
      if (t && blocks[blocks.length - 1]?.type === "table") blocks.push(para(""));
      if (t) blocks.push(t);
    } else if (b.type === "pageBreak" || b.type === "rule") blocks.push({ type: b.type });
  }
  if (!blocks.length || blocks[blocks.length - 1].type !== "paragraph") blocks.push(para(""));
  const p = d.page && typeof d.page === "object" ? d.page : {};
  const m = p.margins || {};
  const page = {
    size: PAGE_SIZES[p.size] ? p.size : "custom",
    width: clampNum(p.width, 72, 14400, base.page.width),
    height: clampNum(p.height, 72, 14400, base.page.height),
    orientation: p.orientation === "landscape" ? "landscape" : "portrait",
    margins: {},
    columns: clampInt(p.columns, 1, 4, 1),
    columnGap: clampNum(p.columnGap, 0, 288, 36),
  };
  if (!p.width) page.size = base.page.size;
  for (const k of ["top", "right", "bottom", "left", "header", "footer"]) page.margins[k] = clampNum(m[k], 0, 1440, base.page.margins[k]);
  const meta = { ...base.meta };
  for (const k of Object.keys(meta)) if (d.meta && typeof d.meta[k] === "string") meta[k] = str(d.meta[k], 2000);
  const hf = (list) => (Array.isArray(list) ? list.filter((b) => b?.type === "paragraph").slice(0, 20).map((b) => normParagraph(b, { ...ctx, footnotes: {} })) : []);
  return { type: "office-document", version: OFFICE_VERSION, meta, page, header: hf(d.header), footer: hf(d.footer), styles, blocks, footnotes, media };
}

// ------------------------------------------------------------------------------------------------ styles

/** Paragraph and run properties of a named style with its `basedOn` chain applied (cycles are cut). */
export function resolveStyle(doc, id) {
  const chain = [];
  const seen = new Set();
  for (let s = id; s && doc.styles[s] && !seen.has(s) && chain.length < 32; s = doc.styles[s].basedOn) {
    seen.add(s);
    chain.unshift(doc.styles[s]);
  }
  if (!chain.length && doc.styles.Normal && id !== "Normal") return resolveStyle(doc, "Normal");
  const para = {};
  const run = {};
  let outline = 0;
  for (const s of chain) {
    Object.assign(para, s.para || {});
    Object.assign(run, s.run || {});
    if (s.outline) outline = s.outline;
  }
  return { para, run, outline };
}

/** Effective paragraph properties (style chain, then direct props). */
export function effectivePara(doc, p) {
  const st = resolveStyle(doc, p.style || "Normal");
  return { ...st.para, ...(p.props || {}) };
}

/** Effective run marks (paragraph style run props, then run marks). */
export function effectiveRun(doc, p, r) {
  const st = resolveStyle(doc, p.style || "Normal");
  const out = { ...st.run };
  for (const k of MARK_KEYS) if (r && r[k] !== undefined) out[k] = r[k];
  return out;
}

/** Heading level 1-9 of a paragraph (0 = body text). */
export function headingLevel(doc, p) {
  return p?.type === "paragraph" ? resolveStyle(doc, p.style || "Normal").outline || 0 : 0;
}

/** A new style id for a style name. */
export function styleIdFor(doc, name) {
  const base = String(name || "Style").replace(/[^\w -]/g, "").replace(/\s+/g, "") || "Style";
  let id = base;
  for (let i = 2; doc.styles[id]; i++) id = `${base}${i}`;
  return id;
}

// ------------------------------------------------------------------------------------------------ runs

export const isText = (r) => !r.type || r.type === "text";
export const runLength = (r) => (isText(r) ? r.text.length : 1);
export const runChar = (r) => (isText(r) ? r.text : r.type === "break" ? "\n" : OBJ);

export function sameMarks(a, b) {
  for (const k of MARK_KEYS) if ((a[k] ?? undefined) !== (b[k] ?? undefined)) return false;
  return true;
}
export function marksOf(r) {
  const m = {};
  if (!r || !isText(r)) return m;
  for (const k of MARK_KEYS) if (r[k] !== undefined) m[k] = r[k];
  return m;
}

/** Joins neighbouring text runs with equal marks and drops empty ones. */
export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (isText(r) && !r.text) continue;
    const last = out[out.length - 1];
    if (last && isText(last) && isText(r) && sameMarks(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text };
    else out.push(r);
  }
  return out;
}

export const paraText = (p) => (p.runs || []).map(runChar).join("");
export const paraLength = (p) => (p.runs || []).reduce((n, r) => n + runLength(r), 0);

/** Runs covering [a, b) (text runs are split). */
export function sliceRuns(runs, a, b) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const len = runLength(r);
    const s = Math.max(a, pos);
    const e = Math.min(b, pos + len);
    if (e > s) out.push(isText(r) ? { ...r, text: r.text.slice(s - pos, e - pos) } : r);
    pos += len;
    if (pos >= b) break;
  }
  return out;
}

export function deleteRuns(runs, a, b) {
  return mergeRuns([...sliceRuns(runs, 0, a), ...sliceRuns(runs, b, Infinity)]);
}

export function insertRuns(runs, at, add) {
  return mergeRuns([...sliceRuns(runs, 0, at), ...add, ...sliceRuns(runs, at, Infinity)]);
}

/** Marks a character typed at `offset` should get: the marks of the text before it (or after, at the start). */
export function marksAt(runs, offset) {
  let pos = 0;
  let prev = null;
  for (const r of runs) {
    const len = runLength(r);
    if (isText(r) && offset > pos && offset <= pos + len) return marksOf(r);
    if (isText(r) && pos >= offset && !prev) return marksOf(r);
    if (isText(r)) prev = r;
    pos += len;
    if (pos > offset && prev) break;
  }
  return prev ? marksOf(prev) : {};
}

/** Applies `fn(marks) => marks` to the text in [a, b). */
export function mapRuns(runs, a, b, fn) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const len = runLength(r);
    const s = Math.max(a, pos);
    const e = Math.min(b, pos + len);
    if (e <= s || !isText(r)) out.push(r);
    else {
      if (s > pos) out.push({ ...r, text: r.text.slice(0, s - pos) });
      const mid = { text: r.text.slice(s - pos, e - pos), ...cleanMarks(fn(marksOf(r))) };
      out.push(mid);
      if (e < pos + len) out.push({ ...r, text: r.text.slice(e - pos) });
    }
    pos += len;
  }
  return mergeRuns(out);
}

function cleanMarks(m) {
  const o = {};
  for (const k of MARK_KEYS) if (m[k] !== undefined && m[k] !== null && m[k] !== false && m[k] !== "") o[k] = m[k];
  return o;
}

/** True when every text character in [a, b) has mark `key` (equal to `value` when given). */
export function rangeHasMark(runs, a, b, key, value) {
  let pos = 0;
  let any = false;
  for (const r of runs) {
    const len = runLength(r);
    if (pos + len > a && pos < b && isText(r)) {
      any = true;
      if (value === undefined ? !r[key] : r[key] !== value) return false;
    }
    pos += len;
  }
  return any;
}

// ------------------------------------------------------------------------------------------------ paths

// A paragraph is addressed by a path: [blockIndex] at the top level, [tableIndex, row, cell, paragraphIndex] in a table
// cell (`cell` counts the cells of that row, not grid columns). A position is { path, offset }.

export const samePath = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export function comparePos(a, b) {
  const n = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < n; i++) if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i];
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.offset - b.offset;
}

export function getBlock(doc, path) {
  if (!path?.length) return null;
  const top = doc.blocks[path[0]];
  if (path.length === 1) return top || null;
  return top?.rows?.[path[1]]?.cells?.[path[2]]?.blocks?.[path[3]] || null;
}

/** The list of blocks a path lives in. */
export function containerBlocks(doc, path) {
  if (path.length === 1) return doc.blocks;
  return doc.blocks[path[0]]?.rows?.[path[1]]?.cells?.[path[2]]?.blocks || null;
}

/** Replaces the block list that contains `path` with fn(list). */
export function updateContainer(doc, path, fn) {
  if (path.length === 1) return { ...doc, blocks: fn(doc.blocks) };
  const [ti, r, c] = path;
  const t = doc.blocks[ti];
  const rows = t.rows.slice();
  const cells = rows[r].cells.slice();
  cells[c] = { ...cells[c], blocks: fn(cells[c].blocks) };
  rows[r] = { ...rows[r], cells };
  const blocks = doc.blocks.slice();
  blocks[ti] = { ...t, rows };
  return { ...doc, blocks };
}

export function setBlock(doc, path, block) {
  const i = path[path.length - 1];
  return updateContainer(doc, path, (list) => {
    const next = list.slice();
    next[i] = block;
    return next;
  });
}

export function replaceTop(doc, i, block) {
  const blocks = doc.blocks.slice();
  blocks[i] = block;
  return { ...doc, blocks };
}

/** Every paragraph with its path, in reading order (table cells row by row). */
export function* paragraphs(doc) {
  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.type === "paragraph") yield { path: [i], para: b };
    else if (b.type === "table")
      for (let r = 0; r < b.rows.length; r++) for (let c = 0; c < b.rows[r].cells.length; c++) for (let j = 0; j < b.rows[r].cells[c].blocks.length; j++) yield { path: [i, r, c, j], para: b.rows[r].cells[c].blocks[j] };
  }
}

/** Paragraph paths from `a` to `b` (inclusive) in reading order. */
export function pathsBetween(doc, a, b) {
  const out = [];
  let on = false;
  for (const { path } of paragraphs(doc)) {
    if (samePath(path, a)) on = true;
    if (on) out.push(path);
    if (samePath(path, b)) break;
  }
  return out;
}

export function firstPos(doc) {
  for (const { path } of paragraphs(doc)) return { path, offset: 0 };
  return { path: [0], offset: 0 };
}

// ------------------------------------------------------------------------------------------------ editing

const order = (a, b) => (comparePos(a, b) <= 0 ? [a, b] : [b, a]);

/** Deletes the content between two positions. Returns { doc, pos }. Paragraphs between are removed and the ends merged
 * when both ends share a container; across containers only the part in the first container is removed. */
export function deleteRange(doc, from, to) {
  [from, to] = order(from, to);
  if (samePath(from.path, to.path)) {
    const p = getBlock(doc, from.path);
    return { doc: setBlock(doc, from.path, { ...p, runs: deleteRuns(p.runs, from.offset, to.offset) }), pos: from };
  }
  const cf = from.path.slice(0, -1);
  const ct = to.path.slice(0, -1);
  const pf = getBlock(doc, from.path);
  if (!samePath(cf, ct)) {
    // different containers (top level and a table cell, or two cells): only the part in the first container goes;
    // a table the selection ends in is kept whole
    const i = from.path[from.path.length - 1];
    const head = { ...pf, runs: sliceRuns(pf.runs, 0, from.offset) };
    if (from.path.length === 1) doc = updateContainer(doc, from.path, (list) => [...list.slice(0, i), head, ...list.slice(Math.max(i + 1, to.path[0]))]);
    else doc = updateContainer(doc, from.path, (list) => [...list.slice(0, i), head]);
    return { doc, pos: from };
  }
  const pt = getBlock(doc, to.path);
  const i = from.path[from.path.length - 1];
  const j = to.path[to.path.length - 1];
  const merged = { ...pf, runs: mergeRuns([...sliceRuns(pf.runs, 0, from.offset), ...sliceRuns(pt.runs, to.offset, Infinity)]) };
  doc = updateContainer(doc, from.path, (list) => [...list.slice(0, i), merged, ...list.slice(j + 1)]);
  return { doc, pos: from };
}

/** Inserts plain text (may contain "\n" = new paragraph, "\v" = line break) with marks. */
export function insertText(doc, pos, text, marks = {}) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  let p = getBlock(doc, pos.path);
  if (!p || p.type !== "paragraph") return { doc, pos };
  const toRuns = (s) => {
    const parts = s.split("\v");
    const out = [];
    parts.forEach((t, k) => {
      if (k) out.push({ type: "break" });
      const clean = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFC]/g, "");
      if (clean) out.push({ text: clean, ...marks });
    });
    return out;
  };
  if (lines.length === 1) {
    const add = toRuns(lines[0]);
    const len = add.reduce((n, r) => n + runLength(r), 0);
    return { doc: setBlock(doc, pos.path, { ...p, runs: insertRuns(p.runs, pos.offset, add) }), pos: { path: pos.path, offset: pos.offset + len } };
  }
  const head = sliceRuns(p.runs, 0, pos.offset);
  const tail = sliceRuns(p.runs, pos.offset, Infinity);
  const i = pos.path[pos.path.length - 1];
  const made = lines.map((l, k) => ({ ...p, ...(k > 0 ? { props: p.props } : {}), runs: mergeRuns([...(k === 0 ? head : []), ...toRuns(l)]) }));
  const last = made[made.length - 1];
  const lastLen = paraLength(last);
  made[made.length - 1] = { ...last, runs: mergeRuns([...last.runs, ...tail]) };
  doc = updateContainer(doc, pos.path, (list) => [...list.slice(0, i), ...made, ...list.slice(i + 1)]);
  const path = pos.path.slice(0, -1).concat(i + lines.length - 1);
  return { doc, pos: { path, offset: lastLen } };
}

/** Inserts inline objects (image, footnote, field, break) or runs at a position. */
export function insertInline(doc, pos, items) {
  const p = getBlock(doc, pos.path);
  if (!p || p.type !== "paragraph") return { doc, pos };
  const len = items.reduce((n, r) => n + runLength(r), 0);
  return { doc: setBlock(doc, pos.path, { ...p, runs: insertRuns(p.runs, pos.offset, items) }), pos: { path: pos.path, offset: pos.offset + len } };
}

/** Splits a paragraph (Enter). The new paragraph gets the style's `next` style when the split is at the end. */
export function splitParagraph(doc, pos) {
  const p = getBlock(doc, pos.path);
  if (!p || p.type !== "paragraph") return { doc, pos };
  const len = paraLength(p);
  // Enter in an empty list item ends the list
  if (p.list && len === 0) return { doc: setBlock(doc, pos.path, { ...p, list: undefined, style: p.style === "List" ? "Normal" : p.style }), pos };
  const atEnd = pos.offset >= len;
  const nextStyle = atEnd ? doc.styles[p.style]?.next || (p.style === "Code" || p.style === "Quote" || p.style === "List" ? p.style : resolveStyle(doc, p.style).outline ? "Normal" : p.style) : p.style;
  const a = { ...p, runs: sliceRuns(p.runs, 0, pos.offset) };
  const b = { type: "paragraph", style: nextStyle, runs: sliceRuns(p.runs, pos.offset, Infinity) };
  if (p.props && nextStyle === p.style) b.props = { ...p.props };
  if (b.props) delete b.props.pageBreakBefore;
  if (p.list) b.list = { ...p.list };
  const i = pos.path[pos.path.length - 1];
  doc = updateContainer(doc, pos.path, (list) => [...list.slice(0, i), a, b, ...list.slice(i + 1)]);
  return { doc, pos: { path: pos.path.slice(0, -1).concat(i + 1), offset: 0 } };
}

/** Joins the paragraph at `path` with the previous paragraph of the same container (Backspace at the start). */
export function joinBackward(doc, path) {
  const i = path[path.length - 1];
  const p = getBlock(doc, path);
  if (p.list) {
    const { list: _l, ...rest } = p;
    return { doc: setBlock(doc, path, { ...rest, style: p.style === "List" ? "Normal" : p.style }), pos: { path, offset: 0 } };
  }
  const list = containerBlocks(doc, path);
  if (i === 0) {
    if (p.style !== "Normal" && !paraLength(p)) return { doc: setBlock(doc, path, { ...p, style: "Normal" }), pos: { path, offset: 0 } };
    return { doc, pos: { path, offset: 0 } };
  }
  const prev = list[i - 1];
  if (prev.type === "pageBreak" || prev.type === "rule") {
    doc = updateContainer(doc, path, (l) => [...l.slice(0, i - 1), ...l.slice(i)]);
    return { doc, pos: { path: path.slice(0, -1).concat(i - 1), offset: 0 } };
  }
  if (prev.type !== "paragraph") {
    // after a table: an empty paragraph is removed, otherwise the caret stays
    if (!paraLength(p) && i + 1 < list.length) {
      doc = updateContainer(doc, path, (l) => [...l.slice(0, i), ...l.slice(i + 1)]);
      return { doc, pos: { path, offset: 0 } };
    }
    return { doc, pos: { path, offset: 0 } };
  }
  const off = paraLength(prev);
  const merged = { ...prev, runs: mergeRuns([...prev.runs, ...p.runs]) };
  if (!off && !prev.list) merged.style = p.style;
  doc = updateContainer(doc, path, (l) => [...l.slice(0, i - 1), merged, ...l.slice(i + 1)]);
  return { doc, pos: { path: path.slice(0, -1).concat(i - 1), offset: off } };
}

/** Joins the next paragraph into this one (Delete at the end). */
export function joinForward(doc, path) {
  const list = containerBlocks(doc, path);
  const i = path[path.length - 1];
  const next = list[i + 1];
  if (!next) return { doc, pos: { path, offset: paraLength(getBlock(doc, path)) } };
  if (next.type === "paragraph") return joinBackward(doc, path.slice(0, -1).concat(i + 1));
  if (next.type === "pageBreak" || next.type === "rule") {
    doc = updateContainer(doc, path, (l) => [...l.slice(0, i + 1), ...l.slice(i + 2)]);
  }
  return { doc, pos: { path, offset: paraLength(getBlock(doc, path)) } };
}

/** Applies a function to every paragraph touched by the range [from, to]. */
export function mapParagraphs(doc, from, to, fn) {
  [from, to] = order(from, to);
  for (const path of pathsBetween(doc, from.path, to.path)) {
    const p = getBlock(doc, path);
    if (p?.type === "paragraph") doc = setBlock(doc, path, fn(p, path));
  }
  return doc;
}

/** Changes marks in the range: `marks` values of null/false remove a mark. */
export function formatRange(doc, from, to, marks) {
  [from, to] = order(from, to);
  return mapParagraphs(doc, from, to, (p, path) => {
    const a = samePath(path, from.path) ? from.offset : 0;
    const b = samePath(path, to.path) ? to.offset : Infinity;
    return { ...p, runs: mapRuns(p.runs, a, b, (m) => ({ ...m, ...marks })) };
  });
}

export function clearFormatting(doc, from, to) {
  [from, to] = order(from, to);
  return mapParagraphs(doc, from, to, (p, path) => {
    const a = samePath(path, from.path) ? from.offset : 0;
    const b = samePath(path, to.path) ? to.offset : Infinity;
    const runs = mapRuns(p.runs, a, b, () => ({}));
    return { type: "paragraph", style: p.list ? "List" : "Normal", runs, ...(p.list ? { list: p.list } : {}) };
  });
}

export function setParagraphStyle(doc, from, to, style) {
  return mapParagraphs(doc, from, to, (p) => ({ ...p, style: doc.styles[style] ? style : "Normal" }));
}

export function setParagraphProps(doc, from, to, props) {
  return mapParagraphs(doc, from, to, (p) => {
    const next = { ...(p.props || {}) };
    for (const [k, v] of Object.entries(props)) if (v === null || v === undefined) delete next[k];
    const merged = normParaProps({ ...next, ...Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null && v !== undefined)) });
    const out = { ...p, props: merged };
    if (!Object.keys(merged).length) delete out.props;
    return out;
  });
}

/** Toggles a list kind on the paragraphs of the range. */
export function toggleList(doc, from, to, kind) {
  const all = [...pathsBetween(doc, order(from, to)[0].path, order(from, to)[1].path)].map((p) => getBlock(doc, p)).filter((p) => p?.type === "paragraph");
  const on = all.length && all.every((p) => p.list?.kind === kind);
  const id = uid("l");
  return mapParagraphs(doc, from, to, (p) => {
    if (on) {
      const { list, ...rest } = p;
      return { ...rest, style: p.style === "List" ? "Normal" : p.style };
    }
    return { ...p, list: { kind, level: p.list?.level || 0, id: p.list?.kind === kind ? p.list.id : id }, style: p.style === "Normal" ? "List" : p.style };
  });
}

/** Changes the list level (or the left indent outside lists) by `delta` steps. */
export function indentParagraphs(doc, from, to, delta) {
  return mapParagraphs(doc, from, to, (p) => {
    if (p.list) return { ...p, list: { ...p.list, level: Math.max(0, Math.min(8, p.list.level + delta)) } };
    const cur = p.props?.indentLeft || 0;
    const v = Math.max(0, cur + delta * 36);
    const props = { ...(p.props || {}), indentLeft: v };
    if (!v) delete props.indentLeft;
    const out = { ...p, props };
    if (!Object.keys(props).length) delete out.props;
    return out;
  });
}

/** Inserts blocks after the paragraph at `pos` (top level), splitting it when the caret is inside. */
export function insertBlocksAt(doc, pos, blocks) {
  const top = { path: [pos.path[0]], offset: pos.path.length === 1 ? pos.offset : 0 };
  const p = doc.blocks[top.path[0]];
  let i = top.path[0];
  if (p?.type === "paragraph" && pos.path.length === 1) {
    const len = paraLength(p);
    if (top.offset > 0 && top.offset < len) {
      ({ doc } = splitParagraph(doc, top));
      i += 1;
    } else if (top.offset >= len && len > 0) i += 1;
    else if (len === 0) {
      // replace an empty paragraph
      const blocksNext = doc.blocks.slice();
      blocksNext.splice(i, 1, ...blocks);
      doc = { ...doc, blocks: blocksNext };
      return ensureTrailingParagraph(doc, i + blocks.length);
    }
  } else i += 1;
  const next = doc.blocks.slice();
  next.splice(i, 0, ...blocks);
  return ensureTrailingParagraph({ ...doc, blocks: next }, i + blocks.length);
}

function ensureTrailingParagraph(doc, after) {
  let blocks = doc.blocks;
  if (!blocks.length || blocks[blocks.length - 1].type !== "paragraph") blocks = [...blocks, para("")];
  if (blocks.some((b, k) => k && b.type === "table" && blocks[k - 1].type === "table")) {
    blocks = blocks.flatMap((b, k) => (k && b.type === "table" && blocks[k - 1].type === "table" ? [para(""), b] : [b]));
  }
  doc = { ...doc, blocks };
  // caret goes into the first paragraph at or after `after`
  let k = Math.min(after, blocks.length - 1);
  while (k < blocks.length && blocks[k].type !== "paragraph") k++;
  if (k >= blocks.length) k = blocks.length - 1;
  return { doc, pos: { path: [k], offset: 0 } };
}

// ------------------------------------------------------------------------------------------------ queries

/** Label of a list item: bullets per level, or 1. / a. / i. numbering by level. */
const ROMAN = [["m", 1000], ["cm", 900], ["d", 500], ["cd", 400], ["c", 100], ["xc", 90], ["l", 50], ["xl", 40], ["x", 10], ["ix", 9], ["v", 5], ["iv", 4], ["i", 1]];
export function listLabel(kind, level, n) {
  if (kind === "bullet") return ["•", "◦", "▪"][level % 3];
  const k = level % 3;
  if (k === 1) {
    let s = "";
    for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(97 + ((v - 1) % 26)) + s;
    return `${s}.`;
  }
  if (k === 2) {
    let s = "";
    let v = n;
    for (const [r, val] of ROMAN) while (v >= val) (s += r), (v -= val);
    return `${s}.`;
  }
  return `${n}.`;
}



/** Headings for the outline / navigation panel. */
export function outline(doc) {
  const out = [];
  doc.blocks.forEach((b, i) => {
    const level = headingLevel(doc, b);
    if (level) out.push({ path: [i], level, text: paraText(b).replace(/\uFFFC/g, "").replace(/\n/g, " ").trim() || "(empty heading)" });
  });
  return out;
}

/** Words, characters and paragraphs of the body (footnotes excluded). */
export function stats(doc) {
  let words = 0;
  let chars = 0;
  let charsNoSpaces = 0;
  let paras = 0;
  for (const { para: p } of paragraphs(doc)) {
    const t = paraText(p).replace(/\uFFFC/g, "");
    if (t.trim()) paras++;
    chars += t.replace(/\n/g, "").length;
    charsNoSpaces += t.replace(/\s/g, "").length;
    words += (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
  }
  return { words, chars, charsNoSpaces, paragraphs: paras, pages: 0 };
}

/** Plain text of the whole document (paragraphs separated by newlines, table cells by tabs). */
export function documentText(doc, { max = Infinity } = {}) {
  const out = [];
  let n = 0;
  for (const b of doc.blocks) {
    let line;
    if (b.type === "paragraph") line = paraText(b).replace(/\uFFFC/g, "");
    else if (b.type === "table") line = b.rows.map((r) => r.cells.map((c) => c.blocks.map(paraText).join(" ").replace(/\uFFFC/g, "")).join("\t")).join("\n");
    else if (b.type === "pageBreak") line = "\f";
    else line = "";
    out.push(line);
    n += line.length + 1;
    if (n > max) break;
  }
  return out.join("\n").slice(0, max);
}

/**
 * Finds text. Matches never cross paragraphs.
 * @returns {{path:number[], from:number, to:number, text:string}[]}
 */
export function findMatches(doc, query, { caseSensitive = false, regex = false, wholeWord = false, limit = 10000 } = {}) {
  if (!query) return [];
  let re;
  try {
    const src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])` : src, `gu${caseSensitive ? "" : "i"}`);
  } catch {
    return [];
  }
  const out = [];
  for (const { path, para: p } of paragraphs(doc)) {
    const t = paraText(p);
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(t)) && out.length < limit && guard++ < 100000) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      if (!m[0].includes(OBJ)) out.push({ path, from: m.index, to: m.index + m[0].length, text: m[0] });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Replaces matches (from findMatches) with text; `$1` groups work in regex mode when `query` is given. */
export function replaceMatches(doc, matches, replacement, { query, regex = false, caseSensitive = false } = {}) {
  // later matches first so earlier offsets stay valid
  const sorted = matches.slice().sort((a, b) => comparePos({ path: b.path, offset: b.from }, { path: a.path, offset: a.from }));
  let re = null;
  if (regex && query) {
    try {
      re = new RegExp(query, `u${caseSensitive ? "" : "i"}`);
    } catch {
      re = null;
    }
  }
  for (const m of sorted) {
    const p = getBlock(doc, m.path);
    if (!p || p.type !== "paragraph") continue;
    const marks = marksAt(p.runs, m.from + 1);
    const text = re ? m.text.replace(re, replacement) : replacement;
    const runs = insertRuns(deleteRuns(p.runs, m.from, m.to), m.from, text ? [{ text, ...marks }] : []);
    doc = setBlock(doc, m.path, { ...p, runs });
  }
  return doc;
}

// ------------------------------------------------------------------------------------------------ tables

/** Grid view of a table: grid[r][c] = { r, c (cell index in its row), origin: boolean } honoring spans. */
export function tableGrid(t) {
  const ncols = t.cols.length;
  const grid = t.rows.map(() => new Array(ncols).fill(null));
  t.rows.forEach((row, r) => {
    let c = 0;
    row.cells.forEach((cell, ci) => {
      while (c < ncols && grid[r][c]) c++;
      if (c >= ncols) return;
      const cs = Math.min(cell.colspan || 1, ncols - c);
      const rs = Math.min(cell.rowspan || 1, t.rows.length - r);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = { r, ci, origin: dr === 0 && dc === 0, col: c, colspan: cs, rowspan: rs };
      c += cs;
    });
  });
  return grid;
}

/** Grid column where the cell [r, ci] starts. */
export function cellColumn(t, r, ci) {
  const g = tableGrid(t);
  const c = g[r].findIndex((x) => x && x.r === r && x.ci === ci);
  return c < 0 ? 0 : c;
}

/** Table as a dense matrix of cell objects (origin cells at their slots, null for covered slots). */
function matrix(t) {
  const g = tableGrid(t);
  return g.map((row, r) => row.map((x) => (x && x.origin ? t.rows[r].cells[x.ci] : x ? null : { blocks: [para("")] })));
}

function fromMatrix(t, m, cols) {
  return { ...t, cols, rows: m.map((row, r) => ({ ...(t.rows[r] ? { header: t.rows[r].header } : {}), cells: row.filter(Boolean) })).map((row) => (row.header ? row : { cells: row.cells })) };
}

export function tableInsertRow(t, r, after = true) {
  const m = matrix(t);
  const g = tableGrid(t);
  const at = after ? r + 1 : r;
  const row = t.cols.map(() => ({ blocks: [para("")] }));
  // cells spanning across the insertion point grow
  const grown = new Set();
  if (at > 0 && at < m.length)
    for (let c = 0; c < t.cols.length; c++) {
      const x = g[at][c];
      if (x && !x.origin && x.r < at && !grown.has(`${x.r}:${x.ci}`)) {
        grown.add(`${x.r}:${x.ci}`);
        const cell = m[x.r][x.col];
        m[x.r][x.col] = { ...cell, rowspan: (cell.rowspan || 1) + 1 };
        for (let k = 0; k < x.colspan; k++) row[x.col + k] = null;
      }
    }
  m.splice(at, 0, row);
  const rowsMeta = t.rows.slice();
  rowsMeta.splice(at, 0, {});
  return fromMatrix({ ...t, rows: rowsMeta.map((x) => x || {}) }, m, t.cols);
}

export function tableDeleteRow(t, r) {
  if (t.rows.length <= 1) return null;
  const g = tableGrid(t);
  const m = matrix(t);
  for (let c = 0; c < t.cols.length; c++) {
    const x = g[r][c];
    if (!x || x.col !== c) continue;
    const cell = t.rows[x.r].cells[x.ci];
    if (x.rowspan > 1) {
      if (x.r === r) m[r + 1][c] = { ...cell, rowspan: x.rowspan - 1 };
      else m[x.r][c] = { ...cell, rowspan: x.rowspan - 1 };
    }
  }
  m.splice(r, 1);
  const meta = t.rows.slice();
  meta.splice(r, 1);
  return fromMatrix({ ...t, rows: meta }, m, t.cols);
}

export function tableInsertCol(t, c, after = true) {
  const at = after ? c + 1 : c;
  const g = tableGrid(t);
  const m = matrix(t);
  const w = t.cols[Math.min(c, t.cols.length - 1)] || 72;
  m.forEach((row, r) => {
    let slot = { blocks: [para("")] };
    if (at > 0 && at < t.cols.length) {
      const x = g[r][at];
      if (x && x.col < at) {
        slot = null;
        if (x.r === r) {
          const cell = row[x.col];
          row[x.col] = { ...cell, colspan: (cell.colspan || 1) + 1 };
        }
      }
    }
    row.splice(at, 0, slot);
  });
  const cols = t.cols.slice();
  cols.splice(at, 0, w);
  return fromMatrix(t, m, cols);
}

export function tableDeleteCol(t, c) {
  if (t.cols.length <= 1) return null;
  const g = tableGrid(t);
  const m = matrix(t);
  m.forEach((row, r) => {
    const x = g[r][c];
    if (x && x.r === r && x.colspan > 1) {
      const cell = t.rows[x.r].cells[x.ci];
      if (x.col === c) row[c + 1] = { ...cell, colspan: x.colspan - 1 };
      else row[x.col] = { ...cell, colspan: x.colspan - 1 };
    }
    row.splice(c, 1);
  });
  const cols = t.cols.slice();
  cols.splice(c, 1);
  return fromMatrix(t, m, cols);
}

/** Merges the rectangle of grid slots [r0..r1] x [c0..c1] into one cell (content joined). */
export function tableMerge(t, r0, c0, r1, c1) {
  [r0, r1] = [Math.min(r0, r1), Math.max(r0, r1)];
  [c0, c1] = [Math.min(c0, c1), Math.max(c0, c1)];
  const g = tableGrid(t);
  // grow the rectangle to include partially covered spans
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = g[r][c];
        if (!x) continue;
        const nr0 = Math.min(r0, x.r);
        const nc0 = Math.min(c0, x.col);
        const nr1 = Math.max(r1, x.r + x.rowspan - 1);
        const nc1 = Math.max(c1, x.col + x.colspan - 1);
        if (nr0 !== r0 || nc0 !== c0 || nr1 !== r1 || nc1 !== c1) {
          [r0, c0, r1, c1] = [nr0, nc0, nr1, nc1];
          changed = true;
        }
      }
  }
  const m = matrix(t);
  const blocks = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const cell = m[r][c];
      if (cell) {
        for (const b of cell.blocks) if (paraLength(b) || !blocks.length) blocks.push(b);
        m[r][c] = null;
      }
    }
  const first = t.rows[g[r0][c0].r].cells[g[r0][c0].ci];
  m[r0][c0] = { ...first, blocks: blocks.length ? blocks : [para("")], colspan: c1 - c0 + 1, rowspan: r1 - r0 + 1 };
  if (m[r0][c0].colspan === 1) delete m[r0][c0].colspan;
  if (m[r0][c0].rowspan === 1) delete m[r0][c0].rowspan;
  return fromMatrix(t, m, t.cols);
}

/** Splits a merged cell back into single cells. */
export function tableSplit(t, r, ci) {
  const cell = t.rows[r]?.cells[ci];
  if (!cell || ((cell.colspan || 1) === 1 && (cell.rowspan || 1) === 1)) return t;
  const col = cellColumn(t, r, ci);
  const m = matrix(t);
  for (let dr = 0; dr < (cell.rowspan || 1); dr++) for (let dc = 0; dc < (cell.colspan || 1); dc++) m[r + dr][col + dc] = dr || dc ? { blocks: [para("")] } : { ...cell, colspan: undefined, rowspan: undefined };
  const c0 = m[r][col];
  delete c0.colspan;
  delete c0.rowspan;
  return fromMatrix(t, m, t.cols);
}
