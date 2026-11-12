// Spreadsheet depth features (docs/office-sheet.md ▸ Tables, names and data tools): table styles with banding and a
// total row, defined names, data validation, paste special, row/column groups, page setup, pivot-lite, sparklines and
// chart data for other apps. Pure model operations (immutable, like model.js); the grid (view.js), the dialogs
// (depth-dialogs.js) and the Vibe tools (vibe/tools/office-sheet-depth.js) call them. Tests:
// tests/office/sheet-depth.test.js.
//
// Model additions (all optional, absent = none):
//   Workbook.names   { "<Name>": "Sheet1!$A$1:$B$9" | "0.19" }                defined names (formula text without "=")
//   Sheet.tables     [{ id, range, style, header: true, banded: true, total: false }]
//   Sheet.validation [{ id, range, type: list|number|integer|textLength, list?: string[], source?: "Sheet1!D1:D9",
//                      min?, max?, allowBlank: true, message? }]
//   Sheet.groups     { row: [{ from, to, collapsed }], col: [...] }            indexes are 0-based and inclusive
//   Sheet.page       { orientation: portrait|landscape, paper: a4|a3|a5|letter|legal, margin (px), printArea?, gridlines,
//                      fit: none|page|width }                                 fit scales the print area onto the paper
//   Sheet.sparks     [{ id, cell, range, type: line|column, color }]
//   Sheet.pivots     [{ id, at: "A1", src: "Data!A1:D9", rows, columns, values, agg, size: { rows, cols } }]
//                    pivot tables written on this sheet, refreshed by refreshPivots
import { parseRange, formatRange, normRange } from "../toolkit/selection.js";
import { rcKey, keyRC, shiftFormula, isErr, compareValues, toText, MAX_ROWS, MAX_COLS } from "./formula.js";
import { sheetById, sheetByName, updateSheet, setCells, addSheet, newId, overlaps } from "./model.js";

const range = (text) => {
  const g = parseRange(String(text || "").replace(/\$/g, "").trim().toUpperCase());
  if (!g) throw new Error(`"${text}" is not an A1 range such as B2 or A1:C10.`);
  return g;
};
const list = (s, key) => (Array.isArray(s[key]) ? s[key] : []);
const inside = (g, r, c) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;

/** "Data!A1:C9" or "A1:C9" (with the default sheet) → { sheet, g }. */
export function sheetRange(m, text, fallback) {
  const s = String(text || "").trim();
  const i = s.lastIndexOf("!");
  const sheet = i > 0 ? sheetByName(m, s.slice(0, i).replace(/^'|'$/g, "").replace(/''/g, "'")) : fallback;
  if (!sheet) throw new Error(`No sheet named "${s.slice(0, i)}".`);
  return { sheet, g: range(i > 0 ? s.slice(i + 1) : s) };
}

// ------------------------------------------------------------------------------------------------------ names

const NAME_RE = /^[A-Za-z_\\][\w.]{0,254}$/;
/** Defined names: letters, digits, _ and . (starting with a letter or _), not a cell reference, not TRUE/FALSE. */
export const validName = (n) => typeof n === "string" && NAME_RE.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^(true|false)$/i.test(n) && !/^[Rr]\d*[Cc]\d*$/.test(n);

export function setName(m, name, ref) {
  if (!validName(name)) throw new Error(`"${name}" is not a valid name: use letters, digits, _ and . (start with a letter), not a cell reference such as A1.`);
  const text = String(ref ?? "").replace(/^=/, "").trim();
  if (!text) throw new Error("A name needs a reference or value, for example Sheet1!$A$1:$A$10.");
  const names = Object.fromEntries(Object.entries(m.names || {}).filter(([k]) => k.toLowerCase() !== name.toLowerCase()));
  names[name] = text;
  return { ...m, names };
}

export function deleteName(m, name) {
  const names = Object.fromEntries(Object.entries(m.names || {}).filter(([k]) => k.toLowerCase() !== String(name).toLowerCase()));
  return { ...m, names };
}

// ------------------------------------------------------------------------------------------------------ table styles

/** Table styles: header fill and text, band fill, total-row border. */
export const TABLE_STYLES = {
  blue: { head: "#4472c4", headText: "#ffffff", band: "#d9e1f2", line: "#4472c4" },
  green: { head: "#70ad47", headText: "#ffffff", band: "#e2efda", line: "#70ad47" },
  orange: { head: "#ed7d31", headText: "#ffffff", band: "#fce4d6", line: "#ed7d31" },
  gray: { head: "#595959", headText: "#ffffff", band: "#ededed", line: "#595959" },
  light: { head: "#ffffff", headText: "#1f3864", band: "#f2f2f2", line: "#8ea9db" },
};

/**
 * Formats a range as a table. With `total` a total row is added below the data (SUBTOTAL sums for numeric columns,
 * "Total" in the first column) unless the range's last row is empty, which then becomes the total row.
 */
export function addTable(m, sid, { range: text, style = "blue", header = true, banded = true, total = false }) {
  const s = sheetById(m, sid);
  let g = range(text);
  if (list(s, "tables").some((t) => overlaps(parseRange(t.range), g))) throw new Error("The range overlaps another table.");
  let next = m;
  if (total) {
    const hasData = (r) => Array.from({ length: g.c1 - g.c0 + 1 }, (_, j) => s.cells[rcKey(r, g.c0 + j)]).some((c) => c && (c.v !== undefined || c.f !== undefined));
    const tr = hasData(g.r1) ? g.r1 + 1 : g.r1;
    const first = header ? g.r0 + 1 : g.r0;
    const updates = {};
    for (let c = g.c0; c <= g.c1; c++) {
      let numeric = false;
      for (let r = first; r < tr && !numeric; r++) numeric = typeof s.cells[rcKey(r, c)]?.v === "number" || s.cells[rcKey(r, c)]?.f !== undefined;
      if (c === g.c0) updates[rcKey(tr, c)] = { v: "Total" };
      else if (numeric && tr > first) updates[rcKey(tr, c)] = { f: `SUBTOTAL(109,${rcKey(first, c)}:${rcKey(tr - 1, c)})` };
    }
    next = setCells(next, sid, updates);
    g = { ...g, r1: tr };
  }
  const table = { id: newId("tb"), range: formatRange(g), style: TABLE_STYLES[style] ? style : "blue", header: !!header, banded: !!banded, total: !!total };
  return updateSheet(next, sid, (x) => ({ ...x, tables: [...list(x, "tables"), table] }));
}

export function updateTable(m, sid, id, patch) {
  return updateSheet(m, sid, (x) => ({ ...x, tables: list(x, "tables").map((t) => (t.id === id ? { ...t, ...patch, style: TABLE_STYLES[patch.style ?? t.style] ? patch.style ?? t.style : t.style } : t)) }));
}

export function removeTable(m, sid, id) {
  return updateSheet(m, sid, (x) => ({ ...x, tables: list(x, "tables").filter((t) => t.id !== id) }));
}

export const tableAt = (sheet, r, c) => list(sheet, "tables").find((t) => {
  const g = parseRange(t.range);
  return g && inside(g, r, c);
}) || null;

/** The style a table adds to a cell (header, bands, total row) or null. Cell styles win over it. */
export function tableLook(sheet, r, c) {
  const t = tableAt(sheet, r, c);
  if (!t) return null;
  const g = parseRange(t.range);
  const st = TABLE_STYLES[t.style] || TABLE_STYLES.blue;
  if (t.header && r === g.r0) return { b: true, fill: st.head, color: st.headText, bd: { b: st.line } };
  if (t.total && r === g.r1) return { b: true, bd: { t: st.line } };
  const i = r - g.r0 - (t.header ? 1 : 0);
  return t.banded && i % 2 === 0 ? { fill: st.band } : { fill: "#ffffff" };
}

// ------------------------------------------------------------------------------------------------------ validation

export const VALIDATION_TYPES = ["list", "number", "integer", "textLength"];

export function addValidation(m, sid, { range: text, type = "list", list: items, source, min, max, allowBlank = true, message = "" }) {
  const g = range(text);
  if (!VALIDATION_TYPES.includes(type)) throw new Error(`Validation type is one of ${VALIDATION_TYPES.join(", ")}.`);
  const rule = { id: newId("dv"), range: formatRange(g), type, allowBlank: allowBlank !== false };
  if (type === "list") {
    if (source) rule.source = String(source).replace(/^=/, "");
    else if (Array.isArray(items) && items.length) rule.list = items.map((x) => String(x)).slice(0, 500);
    else throw new Error("A list rule needs items or a source range.");
  } else {
    const n = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    if (n(min) !== undefined && !Number.isFinite(n(min))) throw new Error("min must be a number.");
    if (n(max) !== undefined && !Number.isFinite(n(max))) throw new Error("max must be a number.");
    if (n(min) !== undefined) rule.min = n(min);
    if (n(max) !== undefined) rule.max = n(max);
  }
  if (message) rule.message = String(message).slice(0, 255);
  // a new rule replaces older ones on the same cells
  return updateSheet(clearValidation(m, sid, rule.range), sid, (x) => ({ ...x, validation: [...list(x, "validation"), rule] }));
}

/** Removes validation from a range (rules that only partly overlap keep their range; they just stop at it). */
export function clearValidation(m, sid, text) {
  const g = range(text);
  return updateSheet(m, sid, (x) => ({ ...x, validation: list(x, "validation").filter((v) => {
    const h = parseRange(v.range);
    return !(h && h.r0 >= g.r0 && h.r1 <= g.r1 && h.c0 >= g.c0 && h.c1 <= g.c1) && !(h && h.r0 === h.r1 && h.c0 === h.c1 && inside(g, h.r0, h.c0));
  }) }));
}

export const validationAt = (sheet, r, c) => {
  const all = list(sheet, "validation");
  for (let i = all.length - 1; i >= 0; i--) {
    const g = parseRange(all[i].range);
    if (g && inside(g, r, c)) return all[i];
  }
  return null;
};

/** Items of a list rule (from its list or its source range, computed values via `get(sid, r, c)`). */
export function listItems(m, sheet, rule, get) {
  if (!rule || rule.type !== "list") return [];
  if (rule.list) return rule.list;
  try {
    const { sheet: src, g } = sheetRange(m, rule.source, sheet);
    const out = [];
    for (let r = g.r0; r <= Math.min(g.r1, g.r0 + 999); r++)
      for (let c = g.c0; c <= Math.min(g.c1, g.c0 + 49); c++) {
        const v = get(src.id, r, c);
        if (v != null && v !== "" && !isErr(v)) out.push(toText(v));
      }
    return [...new Set(out)];
  } catch {
    return [];
  }
}

/** Checks typed input against the cell's rule → { ok, message }. Formulas and (by default) blanks always pass. */
export function checkInput(m, sheet, r, c, text, get) {
  const rule = validationAt(sheet, r, c);
  if (!rule) return { ok: true };
  const s = String(text ?? "");
  if (s.startsWith("=")) return { ok: true };
  if (s.trim() === "") return rule.allowBlank === false ? { ok: false, message: rule.message || "This cell cannot be empty." } : { ok: true };
  const fail = (fallback) => ({ ok: false, message: rule.message || fallback });
  if (rule.type === "list") {
    const items = listItems(m, sheet, rule, get);
    return items.some((x) => x.toLowerCase() === s.trim().toLowerCase()) ? { ok: true } : fail(`Pick one of: ${items.slice(0, 12).join(", ")}${items.length > 12 ? ", …" : ""}`);
  }
  const range = `${rule.min ?? "-∞"} to ${rule.max ?? "∞"}`;
  if (rule.type === "textLength") {
    const n = s.length;
    return (rule.min === undefined || n >= rule.min) && (rule.max === undefined || n <= rule.max) ? { ok: true } : fail(`Text length ${range}.`);
  }
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return fail(rule.type === "integer" ? "Enter a whole number." : "Enter a number.");
  if (rule.type === "integer" && !Number.isInteger(n)) return fail("Enter a whole number.");
  return (rule.min === undefined || n >= rule.min) && (rule.max === undefined || n <= rule.max) ? { ok: true } : fail(`Enter a value from ${range}.`);
}

/**
 * Cells of sheet `sid` whose new value (written by paste, fill or a tool) breaks their validation rule:
 * [{ cell, message }], at most `limit`. Formulas and cleared cells are not checked, like typed input.
 */
export function invalidWrites(before, after, sid, get, limit = 20) {
  const s = sheetById(after, sid);
  const old = sheetById(before, sid);
  if (!s?.validation?.length || !old) return [];
  const out = [];
  for (const [k, cell] of Object.entries(s.cells)) {
    if (cell === old.cells[k] || cell?.v === undefined || cell.f !== undefined || cell.v === old.cells[k]?.v) continue;
    const { r, c } = keyRC(k);
    const text = typeof cell.v === "boolean" ? (cell.v ? "TRUE" : "FALSE") : String(cell.v);
    const res = checkInput(before, s, r, c, text, get);
    if (!res.ok && out.push({ cell: k, message: res.message }) >= limit) break;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------ paste special

const OPS = { add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => (b === 0 ? a : a / b) };

/**
 * Paste special. `clip` = { block: cells[][], values: computed values[][], from: { r, c } }; options:
 * paste: all|values|formulas|formats, op: none|add|sub|mul|div (numbers only), skipBlanks, transpose.
 */
export function pasteSpecial(m, sid, r, c, clip, { paste = "all", op = "none", skipBlanks = false, transpose = false } = {}) {
  const s = sheetById(m, sid);
  let block = clip.block;
  let values = clip.values || clip.block.map((row) => row.map((x) => x?.v ?? null));
  if (transpose) {
    const tr = (b) => (b[0] || []).map((_, j) => b.map((row) => row[j]));
    block = tr(block);
    values = tr(values);
  }
  const updates = {};
  for (let i = 0; i < block.length; i++)
    for (let j = 0; j < block[i].length; j++) {
      const rr = r + i;
      const cc = c + j;
      if (rr >= MAX_ROWS || cc >= MAX_COLS) continue;
      const src = block[i][j];
      const v = values[i]?.[j];
      if (skipBlanks && (!src || (src.v === undefined && src.f === undefined))) continue;
      const k = rcKey(rr, cc);
      const prev = s.cells[k] || {};
      let cell;
      if (paste === "formats") cell = { ...prev, s: src?.s };
      else {
        const content = paste === "values" ? (v == null || isErr(v) ? {} : { v }) : src ? (typeof src.f === "string" ? { f: clip.from ? shiftFormula(src.f, r - clip.from.r, c - clip.from.c) : src.f } : src.v !== undefined ? { v: src.v } : {}) : {};
        if (op !== "none" && OPS[op] && typeof content.v === "number" && typeof prev.v === "number") content.v = Number(OPS[op](prev.v, content.v).toPrecision(15));
        else if (op !== "none" && OPS[op] && content.v === undefined && content.f === undefined && typeof prev.v === "number") content.v = prev.v;
        cell = { ...content, s: paste === "all" ? src?.s : prev.s };
      }
      if (cell.s === undefined) delete cell.s;
      updates[k] = cell.v === undefined && cell.f === undefined && !cell.s ? null : cell;
    }
  return setCells(m, sid, updates);
}

// ------------------------------------------------------------------------------------------------------ groups

const groupsOf = (s) => ({ row: s.groups?.row || [], col: s.groups?.col || [] });

/** Groups rows or columns from..to (inclusive, 0-based); a group equal to an existing one is ignored. */
export function group(m, sid, axis, from, to) {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(axis === "row" ? MAX_ROWS - 1 : MAX_COLS - 1, Math.max(from, to));
  return updateSheet(m, sid, (s) => {
    const gs = groupsOf(s);
    if (gs[axis].some((x) => x.from === a && x.to === b)) return s;
    return { ...s, groups: { ...gs, [axis]: [...gs[axis], { from: a, to: b, collapsed: false }].sort((x, y) => x.from - y.from || y.to - x.to) } };
  });
}

/** Removes the groups inside from..to (the innermost one around it when none is inside). */
export function ungroup(m, sid, axis, from, to) {
  return updateSheet(m, sid, (s) => {
    const gs = groupsOf(s);
    let keep = gs[axis].filter((x) => !(x.from >= from && x.to <= to));
    if (keep.length === gs[axis].length) {
      const around = gs[axis].filter((x) => x.from <= from && x.to >= to).sort((x, y) => x.to - x.from - (y.to - y.from))[0];
      keep = gs[axis].filter((x) => x !== around);
    }
    return { ...s, groups: { ...gs, [axis]: keep } };
  });
}

/** Collapses or expands the innermost group containing `index` (all groups with `index` = null). */
export function setCollapsed(m, sid, axis, index, collapsed) {
  return updateSheet(m, sid, (s) => {
    const gs = groupsOf(s);
    const hits = gs[axis].filter((x) => index == null || (index >= x.from && index <= x.to)).sort((x, y) => x.to - x.from - (y.to - y.from));
    const target = index == null ? new Set(hits) : new Set(hits.slice(0, 1));
    return { ...s, groups: { ...gs, [axis]: gs[axis].map((x) => (target.has(x) ? { ...x, collapsed: !!collapsed } : x)) } };
  });
}

/** Indexes hidden by collapsed groups. */
export function collapsedIndexes(s, axis) {
  const out = new Set();
  for (const x of groupsOf(s)[axis]) if (x.collapsed) for (let i = x.from; i <= x.to && i - x.from < 100000; i++) out.add(i);
  return out;
}

// ------------------------------------------------------------------------------------------------------ page setup

/** Paper sizes in px at 96 dpi (portrait). */
export const PAPERS = { a4: { w: 794, h: 1123 }, a3: { w: 1123, h: 1587 }, a5: { w: 559, h: 794 }, letter: { w: 816, h: 1056 }, legal: { w: 816, h: 1344 } };
export const FIT_MODES = ["none", "page", "width"];

export function setPageSetup(m, sid, patch) {
  return updateSheet(m, sid, (s) => {
    const p = { orientation: "portrait", paper: "a4", margin: 48, gridlines: true, fit: "none", ...(s.page || {}) };
    if (patch.orientation) p.orientation = patch.orientation === "landscape" ? "landscape" : "portrait";
    if (patch.paper) p.paper = PAPERS[patch.paper] ? patch.paper : "a4";
    if (patch.margin != null) p.margin = Math.max(0, Math.min(144, Math.round(Number(patch.margin) || 0)));
    if (patch.gridlines != null) p.gridlines = !!patch.gridlines;
    if (patch.fit) p.fit = FIT_MODES.includes(patch.fit) ? patch.fit : "none";
    if (patch.printArea !== undefined) {
      if (patch.printArea === null || patch.printArea === "") delete p.printArea;
      else p.printArea = formatRange(range(patch.printArea));
    }
    return { ...s, page: p };
  });
}

/** Options for render.js ▸ sheetPages from a sheet's page setup. */
export function printOptions(s) {
  const p = s.page || {};
  const paper = PAPERS[p.paper] || PAPERS.a4;
  const page = p.orientation === "landscape" ? { w: paper.h, h: paper.w } : { ...paper };
  const out = { page, margin: p.margin ?? 48, gridlines: p.gridlines !== false, fit: FIT_MODES.includes(p.fit) ? p.fit : "none" };
  if (p.printArea) out.range = parseRange(p.printArea);
  return out;
}

// ------------------------------------------------------------------------------------------------------ pivot-lite

export const AGGREGATES = ["sum", "count", "average", "min", "max"];

/**
 * A summary table of a range with a header row: one row per distinct value of `rows`, optionally one column per value
 * of `columns`, cells = `agg` of `values` (a header name or a column letter). Returns rows of values with totals.
 */
export function pivot(m, sheet, get, { range: text, rows, columns = null, values, agg = "sum" }) {
  const { sheet: src, g } = sheetRange(m, text, sheet);
  if (g.r1 <= g.r0) throw new Error("The pivot range needs a header row and data rows.");
  if (!AGGREGATES.includes(agg)) throw new Error(`agg is one of ${AGGREGATES.join(", ")}.`);
  const heads = [];
  for (let c = g.c0; c <= g.c1; c++) heads.push(toText(get(src.id, g.r0, c)));
  const col = (key, what) => {
    if (key == null || key === "") return null;
    let i = heads.findIndex((h) => h.toLowerCase() === String(key).toLowerCase());
    if (i < 0 && /^[A-Z]{1,3}$/i.test(key)) i = keyRC(`${String(key).toUpperCase()}1`).c - g.c0;
    if (i < 0 || i >= heads.length) throw new Error(`No ${what} column "${key}". Columns: ${heads.join(", ")}.`);
    return i;
  };
  const ri = col(rows, "row");
  const ci = col(columns, "column");
  const vi = col(values, "value");
  const acc = new Map(); // rowKey → Map(colKey → numbers[])
  const rowKeys = new Map();
  const colKeys = new Map();
  const keyOf = (v) => (typeof v === "string" ? v.toLowerCase() : `${typeof v}:${v}`);
  for (let r = g.r0 + 1; r <= Math.min(g.r1, g.r0 + 100000); r++) {
    const rv = get(src.id, r, g.c0 + ri);
    if (rv == null || rv === "") continue;
    const rk = keyOf(rv);
    if (!rowKeys.has(rk)) rowKeys.set(rk, rv);
    const cv = ci == null ? "" : get(src.id, r, g.c0 + ci);
    const ck = ci == null ? "" : keyOf(cv ?? "");
    if (ci != null && !colKeys.has(ck)) colKeys.set(ck, cv ?? "");
    const vv = get(src.id, r, g.c0 + vi);
    if (!acc.has(rk)) acc.set(rk, new Map());
    const cell = acc.get(rk);
    if (!cell.has(ck)) cell.set(ck, []);
    if (agg === "count" ? vv != null && vv !== "" : typeof vv === "number") cell.get(ck).push(agg === "count" ? 1 : vv);
  }
  const reduce = (xs) => {
    if (!xs.length) return agg === "count" || agg === "sum" ? 0 : null;
    if (agg === "sum" || agg === "count") return Number(xs.reduce((a, b) => a + b, 0).toPrecision(15));
    if (agg === "average") return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toPrecision(15));
    return agg === "min" ? Math.min(...xs) : Math.max(...xs);
  };
  const sortKeys = (map) => [...map.entries()].sort((a, b) => compareValues(a[1], b[1])).map(([k]) => k);
  const rk = sortKeys(rowKeys);
  const ck = ci == null ? [""] : sortKeys(colKeys);
  const label = `${agg[0].toUpperCase()}${agg.slice(1)} of ${heads[vi]}`;
  const head = [heads[ri], ...(ci == null ? [label] : [...ck.map((k) => colKeys.get(k)), "Total"])];
  const out = [head];
  const all = (fn) => [].concat(...fn());
  for (const k of rk) {
    const cells = ck.map((c) => reduce(acc.get(k).get(c) || []));
    out.push([rowKeys.get(k), ...cells, ...(ci == null ? [] : [reduce(all(() => ck.map((c) => acc.get(k).get(c) || [])))])]);
  }
  const totals = ck.map((c) => reduce(all(() => rk.map((k) => acc.get(k).get(c) || []))));
  out.push(["Total", ...totals, ...(ci == null ? [] : [reduce(all(() => rk.flatMap((k) => ck.map((c) => acc.get(k).get(c) || []))))])]);
  return out;
}

/**
 * Writes a pivot result to a new sheet (`name`) or at a cell of a sheet (`sid` + `at` "A1"); header and total bold.
 * With `spec` (the options given to `pivot`, read relative to sheet `sid`) the definition is kept on the target sheet
 * so refreshPivots can recompute it.
 */
export function writePivot(m, sid, table, { name = null, at = "A1", spec = null, prev = null } = {}) {
  let next = m;
  let target = sid;
  if (name) {
    next = addSheet(m, { name, after: sid });
    target = next.active;
  }
  const o = range(at);
  const updates = {};
  if (prev?.size) for (let i = 0; i < prev.size.rows; i++) for (let j = 0; j < prev.size.cols; j++) updates[rcKey(o.r0 + i, o.c0 + j)] = null;
  table.forEach((row, i) =>
    row.forEach((v, j) => {
      const bold = i === 0 || i === table.length - 1;
      updates[rcKey(o.r0 + i, o.c0 + j)] = { ...(v == null ? {} : { v }), ...(bold ? { s: { b: true, ...(i === 0 ? { fill: "#dbe5f1" } : { bd: { t: "#000000" } }) } } : {}) };
    }));
  next = setCells(next, target, updates);
  if (!spec && !prev) return next;
  const size = { rows: table.length, cols: Math.max(...table.map((r) => r.length)) };
  const def = prev
    ? { ...prev, size }
    : { id: newId("pv"), at: rcKey(o.r0, o.c0), src: qualify(m, spec.range, sheetById(m, sid)), rows: String(spec.rows), columns: spec.columns || null, values: String(spec.values), agg: spec.agg || "sum", size };
  return updateSheet(next, target, (s) => ({ ...s, pivots: [...list(s, "pivots").filter((p) => p.id !== def.id && p.at !== def.at), def] }));
}

/** "A1:D9" read on `sheet` → "Data!A1:D9" (a reference that stays valid from any sheet). */
function qualify(m, text, sheet) {
  const { sheet: src, g } = sheetRange(m, text, sheet);
  const q = /^[A-Za-z_][\w.]*$/.test(src.name) && !/^[A-Za-z]{1,3}\d+$/.test(src.name) ? src.name : `'${src.name.replace(/'/g, "''")}'`;
  return `${q}!${formatRange(g)}`;
}

/** The pivot table whose output covers a cell, or null. */
export const pivotAt = (sheet, r, c) => list(sheet, "pivots").find((p) => {
  const o = parseRange(p.at);
  return o && p.size && r >= o.r0 && r < o.r0 + p.size.rows && c >= o.c0 && c < o.c0 + p.size.cols;
}) || null;

/**
 * Recomputes pivot tables from their source data: every pivot of the workbook, or those of sheet `sid` (or only
 * `id`). Returns { model, refreshed, errors: [{ at, message }] }. `get(sid, r, c)` reads computed values.
 */
export function refreshPivots(m, get, { sid = null, id = null } = {}) {
  let next = m;
  let refreshed = 0;
  const errors = [];
  for (const s of m.sheets) {
    if (sid && s.id !== sid) continue;
    for (const p of list(s, "pivots")) {
      if (id && p.id !== id) continue;
      try {
        const table = pivot(next, s, get, { range: p.src, rows: p.rows, columns: p.columns, values: p.values, agg: p.agg });
        next = writePivot(next, s.id, table, { at: p.at, prev: p });
        refreshed++;
      } catch (err) {
        errors.push({ at: `${s.name}!${p.at}`, message: err.message });
      }
    }
  }
  return { model: next, refreshed, errors };
}

/** Forgets the pivot definition at a cell (its values stay). */
export function removePivot(m, sid, pid) {
  return updateSheet(m, sid, (s) => ({ ...s, pivots: list(s, "pivots").filter((p) => p.id !== pid) }));
}

// ------------------------------------------------------------------------------------------------------ sparklines

export function addSparkline(m, sid, { cell, range: text, type = "line", color = "#2563eb" }) {
  const at = range(cell);
  const src = String(text || "").trim();
  sheetRange(m, src, sheetById(m, sid)); // validates
  const sp = { id: newId("sp"), cell: rcKey(at.r0, at.c0), range: src.replace(/\$/g, ""), type: type === "column" ? "column" : "line", color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#2563eb" };
  return updateSheet(m, sid, (s) => ({ ...s, sparks: [...list(s, "sparks").filter((x) => x.cell !== sp.cell), sp] }));
}

export function removeSparklines(m, sid, text) {
  const g = range(text);
  return updateSheet(m, sid, (s) => ({ ...s, sparks: list(s, "sparks").filter((x) => {
    const { r, c } = keyRC(x.cell);
    return !inside(g, r, c);
  }) }));
}

export const sparklineAt = (sheet, r, c) => list(sheet, "sparks").find((x) => x.cell === rcKey(r, c)) || null;

export function sparkValues(m, sheet, sp, get) {
  try {
    const { sheet: src, g } = sheetRange(m, sp.range, sheet);
    const out = [];
    for (let r = g.r0; r <= Math.min(g.r1, g.r0 + 499); r++)
      for (let c = g.c0; c <= Math.min(g.c1, g.c0 + 499); c++) {
        const v = get(src.id, r, c);
        if (typeof v === "number") out.push(v);
      }
    return out;
  } catch {
    return [];
  }
}

/** Points of a line sparkline inside a box (first value at the left edge, the maximum at the top). */
export function sparkPoints(values, { x, y, w, h }) {
  if (!values.length) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => [x + i * step, y + h - ((v - lo) / span) * h]);
}

// ------------------------------------------------------------------------------------------------------ chart data

/**
 * Chart data of a sheet range, independent of any app: { source, categories, series: [{ name, values }] }. The first
 * row holds series names and the first column categories (`seriesIn: "rows"` swaps them). Presentations and documents
 * use it to chart sheet data (vibe tool sheet_chart_data).
 */
export function sheetChartData(m, { sheet = null, range: text, seriesIn = "columns" }, get) {
  const base = sheet ? sheetByName(m, sheet) : sheetById(m, m.active);
  if (!base) throw new Error(`No sheet named "${sheet}".`);
  const { sheet: src, g0 } = (() => {
    const x = sheetRange(m, text, base);
    return { sheet: x.sheet, g0: normRange(x.g) };
  })();
  const g = { ...g0, r1: Math.min(g0.r1, g0.r0 + 500), c1: Math.min(g0.c1, g0.c0 + 50) };
  let grid = [];
  for (let r = g.r0; r <= g.r1; r++) {
    const row = [];
    for (let c = g.c0; c <= g.c1; c++) {
      const v = get(src.id, r, c);
      row.push(isErr(v) ? null : v);
    }
    grid.push(row);
  }
  if (seriesIn === "rows") grid = grid[0].map((_, j) => grid.map((row) => row[j]));
  const categories = grid.slice(1).map((row) => toText(row[0]));
  const series = grid[0].slice(1).map((name, j) => ({ name: toText(name), values: grid.slice(1).map((row) => (typeof row[j + 1] === "number" ? row[j + 1] : null)) }));
  return { source: `${src.name}!${formatRange(g0)}`, categories, series };
}
