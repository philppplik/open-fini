// Document design and review features of the word processor (docs/office-studio.md ▸ Design and review): themes (font
// and color sets), style sets, update-style-from-selection, the table style gallery, section breaks with columns,
// floating text boxes, the generated table of contents and tracked changes (accept / reject). Pure module (no DOM) on
// top of model.js: the editor, the design UI (ui/office/design-ui.js), the codecs and the Vibe tools
// (vibe/tools/office-design.js) share it. Loaded with the Document app, never at start-up.
import * as M from "./model.js";

// ------------------------------------------------------------------------------------------------ themes

/** Font and color sets. `heading` colors Title and Heading 1-2, `accent` Heading 3-6 and table styles, `text` the body. */
export const THEMES = [
  { id: "office", label: "Office", fonts: { heading: "Calibri", body: "Calibri" }, colors: { heading: "#1f3864", accent: "#2f5496", text: "#000000" } },
  { id: "classic", label: "Classic", fonts: { heading: "Georgia", body: "Cambria" }, colors: { heading: "#5b1a1a", accent: "#8b3a3a", text: "#1a1a1a" } },
  { id: "modern", label: "Modern", fonts: { heading: "Inter", body: "Inter" }, colors: { heading: "#0f766e", accent: "#0d9488", text: "#1f2937" } },
  { id: "elegant", label: "Elegant", fonts: { heading: "Garamond", body: "Garamond" }, colors: { heading: "#6b4423", accent: "#9c6b3c", text: "#2b2b2b" } },
  { id: "bold", label: "Bold", fonts: { heading: "Arial", body: "Arial" }, colors: { heading: "#c2410c", accent: "#ea580c", text: "#111111" } },
  { id: "minimal", label: "Minimal", fonts: { heading: "Helvetica", body: "Helvetica" }, colors: { heading: "#111827", accent: "#4b5563", text: "#111827" } },
  { id: "ocean", label: "Ocean", fonts: { heading: "Segoe UI", body: "Segoe UI" }, colors: { heading: "#1e3a8a", accent: "#2563eb", text: "#0f172a" } },
];

const isHeadingLike = (id) => id === "Title" || id === "Subtitle" || /^Heading[1-6]$/.test(id);

/** Applies a theme (id from THEMES, or a custom { fonts, colors }) to the built-in styles. Returns a new document. */
export function applyTheme(doc, theme) {
  const th = typeof theme === "string" ? THEMES.find((t) => t.id === theme) : theme;
  if (!th) throw new Error(`Unknown theme "${theme}". Themes: ${THEMES.map((t) => t.id).join(", ")}.`);
  const styles = { ...doc.styles };
  const set = (id, run) => styles[id] && (styles[id] = { ...styles[id], run: { ...styles[id].run, ...run } });
  set("Normal", { font: th.fonts.body, color: th.colors.text });
  for (const id of Object.keys(styles)) {
    if (!isHeadingLike(id)) continue;
    const n = id.startsWith("Heading") ? Number(id.slice(7)) : 0;
    set(id, { font: th.fonts.heading, color: id === "Subtitle" ? th.colors.accent : n >= 3 ? th.colors.accent : th.colors.heading });
  }
  set("Quote", { color: th.colors.accent });
  const out = { ...doc, styles, theme: { id: th.id || "custom", fonts: { ...th.fonts }, colors: { ...th.colors } } };
  // tables styled from the gallery follow the theme accent
  out.blocks = doc.blocks.map((b) => (b.type === "table" && b.design ? applyTableStyle(b, b.design.style, b.design, out.theme) : b));
  return out;
}

// ------------------------------------------------------------------------------------------------ style sets

/** Quick style sets: spacing and emphasis of the built-in styles (fonts and colors stay with the theme). */
export const STYLE_SETS = [
  { id: "default", label: "Default", normal: { spaceAfter: 8, lineHeight: 1.15 }, heading: { spaceBefore: null, spaceAfter: 4 }, title: { size: 28, align: null } },
  { id: "compact", label: "Compact", normal: { spaceAfter: 4, lineHeight: 1 }, heading: { spaceBefore: 8, spaceAfter: 2 }, title: { size: 24, align: null } },
  { id: "airy", label: "Airy", normal: { spaceAfter: 12, lineHeight: 1.5 }, heading: { spaceBefore: 24, spaceAfter: 8 }, title: { size: 32, align: null } },
  { id: "formal", label: "Formal", normal: { spaceAfter: 6, lineHeight: 1.15, align: "justify" }, heading: { spaceBefore: 18, spaceAfter: 6 }, title: { size: 26, align: "center" } },
];

export function applyStyleSet(doc, id) {
  const set = STYLE_SETS.find((s) => s.id === id);
  if (!set) throw new Error(`Unknown style set "${id}". Style sets: ${STYLE_SETS.map((s) => s.id).join(", ")}.`);
  const styles = { ...doc.styles };
  const para = (sid, props) => {
    if (!styles[sid]) return;
    const p = { ...styles[sid].para };
    for (const [k, v] of Object.entries(props)) if (v === null) delete p[k];
    else p[k] = v;
    styles[sid] = { ...styles[sid], para: p };
  };
  para("Normal", { align: null, ...set.normal });
  for (let n = 1; n <= 6; n++) {
    const before = set.heading.spaceBefore === null ? [20, 16, 14, 12, 10, 10][n - 1] : Math.max(4, set.heading.spaceBefore - (n - 1) * 3);
    para(`Heading${n}`, { spaceBefore: before, spaceAfter: set.heading.spaceAfter, align: null });
  }
  para("Title", { align: set.title.align });
  if (styles.Title) styles.Title = { ...styles.Title, run: { ...styles.Title.run, size: set.title.size } };
  return { ...doc, styles };
}

/**
 * Update style to match selection: the direct paragraph formatting and the common run marks of the paragraph at
 * `path` become part of its style (or `styleId`); the paragraph's own copies are cleared. Returns a new document.
 */
export function updateStyleFromParagraph(doc, path, styleId) {
  const p = M.getBlock(doc, path);
  if (!p || p.type !== "paragraph") throw new Error("Put the caret in a paragraph first.");
  const id = styleId || p.style || "Normal";
  if (!doc.styles[id]) throw new Error(`Unknown style "${id}".`);
  const texts = p.runs.filter(M.isText);
  const common = {};
  if (texts.length)
    for (const k of ["b", "i", "u", "s", "color", "font", "size", "highlight"]) {
      const v = texts[0][k];
      if (v !== undefined && texts.every((r) => r[k] === v)) common[k] = v;
    }
  const st = doc.styles[id];
  const styles = { ...doc.styles, [id]: { ...st, para: { ...st.para, ...(p.props || {}) }, run: { ...st.run, ...common } } };
  const clean = { ...p, style: id, runs: M.mergeRuns(p.runs.map((r) => (M.isText(r) ? Object.fromEntries(Object.entries(r).filter(([k]) => !(k in common))) : r))) };
  delete clean.props;
  return M.setBlock({ ...doc, styles }, path, clean);
}

// ------------------------------------------------------------------------------------------------ table styles

/** Table style gallery. `accent` true takes the theme accent color instead of `head`. */
export const TABLE_STYLES = [
  { id: "plain", label: "Plain grid", head: null, headText: null, band: null, border: "#808080" },
  { id: "light", label: "Light", head: "#f2f2f2", headText: null, band: "#f7f7f7", border: "#bfbfbf" },
  { id: "accent", label: "Theme accent", accent: true, headText: "#ffffff", band: null, border: null },
  { id: "blue", label: "Blue", head: "#4472c4", headText: "#ffffff", band: "#d9e2f3", border: "#8eaadb" },
  { id: "green", label: "Green", head: "#70ad47", headText: "#ffffff", band: "#e2efd9", border: "#a8d08d" },
  { id: "orange", label: "Orange", head: "#ed7d31", headText: "#ffffff", band: "#fbe4d5", border: "#f4b083" },
  { id: "dark", label: "Dark", head: "#262626", headText: "#ffffff", band: "#e7e6e6", border: "#7f7f7f" },
  { id: "minimal", label: "Minimal", head: null, headText: null, band: "#f5f5f5", border: "none" },
];

const mix = (hex, t) => {
  // tint toward white by t (0..1)
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** Colors of a table style, resolved against the theme. */
export function tableStyleColors(id, theme) {
  const s = TABLE_STYLES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown table style "${id}". Table styles: ${TABLE_STYLES.map((x) => x.id).join(", ")}.`);
  if (!s.accent) return s;
  const a = theme?.colors?.accent || "#2f5496";
  return { ...s, head: a, band: mix(a, 0.85), border: mix(a, 0.5) };
}

/**
 * Applies a gallery style: header row, banded rows, first column and total row options. The colors are written into
 * the cells (shading, header text marks) so every export format keeps them; `design` remembers the choice.
 */
export function applyTableStyle(t, id, { header = true, banded = true, firstCol = false, total = false } = {}, theme) {
  const s = tableStyleColors(id, theme);
  const prev = t.design ? tableStyleColors(t.design.style, theme) : null;
  const last = t.rows.length - 1;
  const pd = t.design;
  // undo what the previous gallery style wrote (bold in its strong cells, the header text color)
  const strip = (x, r, ci) => {
    if (!pd || !M.isText(x)) return x;
    const o = { ...x };
    if (pd.header && r === 0 && prev?.headText && o.color === prev.headText) delete o.color;
    if ((pd.header && r === 0) || (pd.total && r === last && r > 0) || (pd.firstCol && ci === 0)) delete o.b;
    return o;
  };
  const rows = t.rows.map((row, r) => {
    const isHead = header && r === 0;
    const isTotal = total && r === last && r > 0;
    const band = banded && !isHead && !isTotal && (r - (header ? 1 : 0)) % 2 === 1;
    const cells = row.cells.map((cell, ci) => {
      const strong = isHead || isTotal || (firstCol && ci === 0);
      const c = { ...cell };
      const fill = isHead ? s.head : band ? s.band : null;
      if (fill) c.shading = fill;
      else delete c.shading;
      c.blocks = cell.blocks.map((p) => ({ ...p, runs: M.mergeRuns(p.runs.map((x) => {
        const y = strip(x, r, ci);
        if (!M.isText(y)) return y;
        return { ...y, ...(strong ? { b: true } : {}), ...(isHead && s.headText ? { color: s.headText } : {}) };
      })) }));
      return c;
    });
    const out = { cells };
    if (isHead) out.header = true;
    return out;
  });
  const borders = s.border === "none" ? { ...t.borders, style: "none" } : { style: "single", width: t.borders?.width || 0.5, color: s.border || t.borders?.color || "#808080" };
  return { ...t, rows, borders, design: { style: id, header: !!header, banded: !!banded, firstCol: !!firstCol, total: !!total } };
}

/** Text color the editor uses for header cells typed after styling (the baked marks only cover existing text). */
export function tableHeaderText(t, theme) {
  if (!t.design?.header) return null;
  try {
    return tableStyleColors(t.design.style, theme).headText || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ table tools

const cellText = (cell) => (cell?.blocks || []).map(M.paraText).join(" ").replace(/￼/g, "").trim();
const hasSpans = (t) => t.rows.some((r) => r.cells.some((c) => (c.colspan || 1) > 1 || (c.rowspan || 1) > 1));

/** A number in cell text ("1,200.50", "$3", "-4", "12 %", "(7)") or null. */
export function parseNumber(text) {
  let s = String(text ?? "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^[-−]/.test(s);
  s = s.replace(/^\(|\)$/g, "").replace(/^[-−]/, "").replace(/^[$€£¥]\s*|\s*[$€£¥%]$|\s*(USD|EUR|GBP)$/gi, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  return (neg ? -1 : 1) * Number(s);
}

/** Grid rows of a table as text (merged cells repeat their text). */
export function tableText(t) {
  const g = M.tableGrid(t);
  return g.map((row) => row.map((x) => (x ? cellText(t.rows[x.r].cells[x.ci]) : "")));
}

/**
 * Sorts the body rows by a grid column (numbers numerically when every non-empty cell is a number, text otherwise).
 * The header row and a styled total row stay in place. Tables with merged cells cannot be sorted.
 */
export function tableSort(t, col, { desc = false } = {}, theme) {
  if (hasSpans(t)) throw new Error("Tables with merged cells cannot be sorted. Split the cells first.");
  if (!(col >= 0 && col < t.cols.length)) throw new Error(`Column ${col} does not exist; the table has ${t.cols.length} columns (0-based).`);
  const head = t.rows[0]?.header ? 1 : 0;
  const tail = t.design?.total && t.rows.length - head > 1 ? 1 : 0;
  const body = t.rows.slice(head, t.rows.length - tail);
  const keys = body.map((r) => cellText(r.cells[col]));
  const numeric = keys.every((k) => !k || parseNumber(k) !== null) && keys.some((k) => k);
  const coll = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const order = body.map((r, i) => i).sort((a, b) => {
    const x = keys[a];
    const y = keys[b];
    if (!x !== !y) return x ? -1 : 1; // empty cells last
    const c = numeric ? parseNumber(x) - parseNumber(y) : coll.compare(x, y);
    return (desc ? -c : c) || a - b;
  });
  const out = { ...t, rows: [...t.rows.slice(0, head), ...order.map((i) => body[i]), ...t.rows.slice(t.rows.length - tail)] };
  // banding follows the new order
  return t.design ? applyTableStyle(out, t.design.style, t.design, theme) : out;
}

/** Equal column widths, keeping the table width (or `width`). */
export function tableDistribute(t, width) {
  const total = width || t.cols.reduce((a, c) => a + c, 0);
  const w = Math.round((total / t.cols.length) * 100) / 100;
  return { ...t, cols: t.cols.map(() => w) };
}

/** Scales the columns so the table is exactly `width` points wide (fit to the text area). */
export function tableFit(t, width) {
  const total = t.cols.reduce((a, c) => a + c, 0) || 1;
  return { ...t, cols: t.cols.map((c) => Math.max(4, Math.round(((c * width) / total) * 100) / 100)) };
}

/**
 * Appends a total row: `label` in the first column and the sum of every numeric column (header excluded). Decimals and
 * thousands separators follow the column's values. Returns the new table.
 */
export function tableTotalRow(t, { label = "Total" } = {}, theme) {
  if (hasSpans(t)) throw new Error("Tables with merged cells cannot get an automatic total row.");
  const text = tableText(t);
  const head = t.rows[0]?.header ? 1 : 0;
  const body = text.slice(head);
  const cells = t.cols.map((_, c) => {
    if (c === 0) return { blocks: [M.para([{ text: label, b: true }])] };
    const vals = body.map((r) => r[c]).filter(Boolean);
    const nums = vals.map(parseNumber);
    if (!vals.length || nums.some((n) => n === null)) return { blocks: [M.para("")] };
    const dec = Math.max(0, ...vals.map((v) => (/\.(\d+)/.exec(v.replace(/[^\d.]/g, ""))?.[1].length || 0)));
    const sum = nums.reduce((a, b) => a + b, 0);
    const grouped = vals.some((v) => v.includes(","));
    const s = grouped ? sum.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : sum.toFixed(dec);
    return { blocks: [M.para([{ text: s, b: true }], "Normal", { props: { align: "right" } })] };
  });
  let out = { ...t, rows: [...t.rows, { cells }] };
  if (t.design) out = applyTableStyle(out, t.design.style, { ...t.design, total: true }, theme);
  return out;
}

/** A table block from rows of strings (first row as header when `header`), `width` points wide. */
export function tableFromRows(rows, width, { header = true, style } = {}, theme) {
  const n = Math.max(1, ...rows.map((r) => r.length));
  let t = M.createTable(rows.length, n, width, { header });
  t.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      const v = String(rows[r]?.[c] ?? "");
      cell.blocks = [M.para(v, "Normal", r >= (header ? 1 : 0) && parseNumber(v) !== null ? { props: { align: "right" } } : undefined)];
    }),
  );
  if (style) t = applyTableStyle(t, style, { header, banded: true }, theme);
  return t;
}

// ------------------------------------------------------------------------------------------------ sections

/** Sections of the body: [{ from, to, columns, columnGap, start }] where [from, to) are block indexes. */
export function sectionsOf(doc) {
  const out = [];
  let cur = { from: 0, columns: doc.page.columns || 1, columnGap: doc.page.columnGap ?? 36, start: "page" };
  doc.blocks.forEach((b, i) => {
    if (b.type !== "sectionBreak") return;
    out.push({ ...cur, to: i });
    cur = { from: i, columns: b.columns, columnGap: b.columnGap, start: b.start };
  });
  out.push({ ...cur, to: doc.blocks.length });
  return out;
}

export const sectionBreak = ({ columns = 1, columnGap = 36, start = "continuous" } = {}) => ({ type: "sectionBreak", columns: Math.max(1, Math.min(4, Math.round(columns) || 1)), columnGap: Math.max(0, Math.min(288, Number(columnGap) || 36)), start: start === "page" ? "page" : "continuous" });

// ------------------------------------------------------------------------------------------------ text boxes

/**
 * A floating text box. Content is `paras` (paragraphs of formatted runs: bold, italic, underline, color, size, font,
 * and an alignment per paragraph) or plain `text` (one paragraph per line).
 */
export const textBox = ({ text = "", paras, width = 180, wrap = "right", fill, border = "#808080" } = {}) => {
  let content = M.normBoxParas(Array.isArray(paras) ? paras : String(text).slice(0, 5000).replace(/\r\n?/g, "\n").split("\n").map((l) => ({ runs: [{ text: l }] })));
  if (!content.length) content = [{ runs: [] }];
  const box = { type: "textbox", text: M.boxText(content).slice(0, 5000), paras: content, width: Math.max(36, Math.min(1000, Number(width) || 180)), wrap: ["left", "right", "none"].includes(wrap) ? wrap : "right" };
  const f = M.normColor(fill);
  const b = M.normColor(border);
  if (f) box.fill = f;
  if (b) box.border = b;
  return box;
};

/** Every floating object (text boxes and wrapped images) with its paragraph path and offset. */
export function floatingObjects(doc) {
  const out = [];
  for (const { path, para } of M.paragraphs(doc)) {
    let off = 0;
    for (const r of para.runs) {
      if (r.type === "textbox" || (r.type === "image" && r.wrap)) out.push({ path, offset: off, kind: r.type, wrap: r.wrap, ...(r.type === "textbox" ? { text: r.text.slice(0, 300) } : { media: r.media }) });
      off += M.runLength(r);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ table of contents

/** Entries of a table of contents: top-level headings up to `levels`. */
export function tocEntries(doc, levels = 3) {
  return M.outline(doc).filter((o) => o.level <= levels);
}

export const tocBlock = ({ levels = 3, title = "Contents" } = {}) => ({ type: "toc", levels: Math.max(1, Math.min(6, Math.round(levels) || 3)), title: String(title ?? "Contents").slice(0, 200) });

/** The table of contents as plain paragraphs (export formats without a TOC field). `pages` maps block index → page. */
export function tocParagraphs(doc, toc, pages) {
  const out = [];
  if (toc.title) out.push(M.para([{ text: toc.title, b: true, size: 14 }], "Normal", { props: { spaceAfter: 6, keepWithNext: true } }));
  for (const e of tocEntries(doc, toc.levels)) {
    const pg = pages?.get?.(e.path[0]);
    out.push(M.para([{ text: e.text }, ...(pg ? [{ text: `\t${pg}` }] : [])], "Normal", { props: { indentLeft: (e.level - 1) * 18, spaceAfter: 2 } }));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ tracked changes

export { VIBE_AUTHOR, trackDelete, removedLength, trackSplit, trackJoin, revisions, resolveRevisions, acceptAll, trackDiff } from "./track.js";
import { revisions, acceptAll } from "./track.js";

// ------------------------------------------------------------------------------------------------ export

/**
 * Turns the design features into what a format can store: DOCX keeps sections, text boxes, wrapped images, the TOC
 * and tracked changes natively (engine/office/docx.js); ODT keeps sections with columns, text boxes and wrapped images
 * (engine/office/odt.js); every other format gets tracked changes accepted, the TOC as paragraphs, page-starting
 * sections as page breaks and text boxes as indented paragraphs (with their formatting) after their paragraph.
 * Returns { doc, notes }.
 */
export function prepareForExport(doc, format) {
  const notes = [];
  const native = format === "docx";
  const frames = native || format === "odt";
  if (!native && revisions(doc).length) {
    doc = acceptAll(doc);
    notes.push("Tracked changes were accepted: only Word documents store them.");
  }
  const blocks = [];
  let boxes = 0;
  let cols = false;
  for (const b of doc.blocks) {
    if (b.type === "toc" && !native) blocks.push(...tocParagraphs(doc, b));
    else if (b.type === "sectionBreak" && !frames) {
      if (b.columns > 1) cols = true;
      if (b.start === "page") blocks.push({ type: "pageBreak" });
    } else if (!frames && b.type === "paragraph" && b.runs.some((r) => r.type === "textbox")) {
      const tb = b.runs.filter((r) => r.type === "textbox");
      boxes += tb.length;
      blocks.push({ ...b, runs: b.runs.filter((r) => r.type !== "textbox") });
      for (const box of tb) for (const p of box.paras) blocks.push(M.para(p.runs.map((r) => ({ ...r })), "Normal", { props: { indentLeft: 18, indentRight: 18, spaceAfter: 2, ...(p.align ? { align: p.align } : {}) } }));
    } else blocks.push(b);
  }
  if (boxes) notes.push("Text boxes were written as indented paragraphs after their anchor paragraph.");
  if (cols || (!frames && doc.page.columns > 1)) notes.push("Multi-column sections are only kept in Word and OpenDocument files.");
  return { doc: { ...doc, blocks }, notes };
}