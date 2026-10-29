// Spreadsheet model (Office Suite ▸ Spreadsheet, docs/office-sheet.md ▸ Model): plain JSON, immutable values (every
// change returns a new object; untouched sheets and cells keep their identity so the calc engine and the
// collaboration diff only look at what changed). Pure; tests in tests/office/sheet-formula.test.js and
// tests/office/sheet-codecs.test.js.
//
// Workbook  { version: 1, sheets: Sheet[], active: sheetId, meta: { title }, media: {} }
// Sheet     { id, name, pos, cells: { "A1": Cell }, cols: { "<index>": px }, rows: { "<index>": px },
//             merges: ["A1:B2"], freeze: { r, c } | null, filter: { range, hide: { "<col>": string[] } } | null,
//             cf: CfRule[], charts: Chart[], tab?: color }
// Cell      { v?: number | string | boolean, f?: "SUM(A1:A3)" (no "="), s?: Style }
// Style     { b, i, u, st (strike), color, fill, ha: left|center|right, va: top|middle|bottom, wrap, nf: number format
//             code, font, size (pt), bd: { t, r, b, l } colors }
// CfRule    { id, range, type: gt|lt|ge|le|eq|ne|between|contains|blank|notBlank|scale, a?, b?, style?, colors? }
// Chart     { id, type: column|bar|line|pie|area|donut|…, range, title, r, c (anchor cell), w, h, seriesIn? }
// Public API: see the exports below (each documented). Invariants: sheet names are unique (case-insensitive) and
// 1–31 characters without []:*?/\ ; cell keys are A1 refs inside 1048576 x 16384; formulas never start with "=".
import { colName, parseRange, formatRange, normRange } from "../toolkit/selection.js";
import { adjustFormula, shiftFormula, renameSheetInFormula, keyRC, rcKey, MAX_ROWS, MAX_COLS } from "./formula.js";
import { dateToSerial } from "./numfmt-code.js";

export const DEFAULT_COL = 96;
export const DEFAULT_ROW = 22;
export const MODEL_VERSION = 1;

let seq = 0;
export const newId = (p = "s") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newSheet(name = "Sheet1", id = newId("s"), pos = 1) {
  return { id, name, pos, cells: {}, cols: {}, rows: {}, merges: [], freeze: null, filter: null, cf: [], charts: [] };
}

export function newWorkbook({ sheets = ["Sheet1"], title = "" } = {}) {
  const list = sheets.map((n, i) => newSheet(n, `s${i + 1}`, i + 1));
  return { version: MODEL_VERSION, sheets: list, active: list[0].id, meta: { title }, media: {} };
}

/** Repairs a stored / imported / remote model so the UI can trust its shape. */
export function normalizeWorkbook(m) {
  const src = m && typeof m === "object" ? m : {};
  const seen = new Set();
  let sheets = (Array.isArray(src.sheets) ? src.sheets : []).filter((s) => s && typeof s === "object").map((s, i) => {
    let name = validSheetName(s.name) ? String(s.name) : `Sheet${i + 1}`;
    while (seen.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${i + 1}`;
    seen.add(name.toLowerCase());
    const cells = {};
    for (const [k, c] of Object.entries(s.cells && typeof s.cells === "object" ? s.cells : {})) if (/^[A-Z]{1,3}\d{1,7}$/.test(k) && c && typeof c === "object") cells[k] = c;
    return {
      ...newSheet(name, typeof s.id === "string" && s.id ? s.id : newId("s"), Number.isFinite(s.pos) ? s.pos : i + 1),
      ...s,
      name,
      cells,
      cols: s.cols && typeof s.cols === "object" ? s.cols : {},
      rows: s.rows && typeof s.rows === "object" ? s.rows : {},
      merges: Array.isArray(s.merges) ? s.merges.filter((x) => parseRange(x)) : [],
      cf: Array.isArray(s.cf) ? s.cf : [],
      charts: Array.isArray(s.charts) ? s.charts : [],
      freeze: s.freeze && (s.freeze.r > 0 || s.freeze.c > 0) ? { r: Math.max(0, s.freeze.r | 0), c: Math.max(0, s.freeze.c | 0) } : null,
      filter: s.filter && parseRange(s.filter.range) ? { range: s.filter.range, hide: s.filter.hide || {} } : null,
    };
  });
  if (!sheets.length) sheets = [newSheet("Sheet1", "s1", 1)];
  sheets.sort((a, b) => a.pos - b.pos);
  const ids = new Set();
  sheets = sheets.map((s) => (ids.has(s.id) ? { ...s, id: newId("s") } : (ids.add(s.id), s)));
  const { _raw, ...rest } = src;
  return { ...rest, version: MODEL_VERSION, sheets, active: sheets.some((s) => s.id === src.active) ? src.active : sheets[0].id, meta: src.meta && typeof src.meta === "object" ? src.meta : { title: "" }, media: src.media || {} };
}

export const validSheetName = (n) => typeof n === "string" && n.length >= 1 && n.length <= 31 && !/[[\]:*?/\\]/.test(n) && !/^'|'$/.test(n);

export const sheetById = (m, id) => m.sheets.find((s) => s.id === id) || null;
export const sheetByName = (m, name) => m.sheets.find((s) => s.name.toLowerCase() === String(name).toLowerCase()) || null;
export const activeSheet = (m) => sheetById(m, m.active) || m.sheets[0];

/** Replaces one sheet (by id) with fn(sheet). */
export function updateSheet(m, sid, fn) {
  return { ...m, sheets: m.sheets.map((s) => (s.id === sid ? fn(s) : s)) };
}

/** Used range of a sheet { r0, c0, r1, c1 } or null when empty (cells, merges and charts count). */
export function usedRange(sheet) {
  let r1 = -1;
  let c1 = -1;
  let r0 = Infinity;
  let c0 = Infinity;
  for (const [k, cell] of Object.entries(sheet.cells)) {
    if (cell.v === undefined && cell.f === undefined) continue;
    const { r, c } = keyRC(k);
    if (r > r1) r1 = r;
    if (c > c1) c1 = c;
    if (r < r0) r0 = r;
    if (c < c0) c0 = c;
  }
  for (const mg of sheet.merges) {
    const g = parseRange(mg);
    if (g.r1 > r1) r1 = g.r1;
    if (g.c1 > c1) c1 = g.c1;
    r0 = Math.min(r0, g.r0);
    c0 = Math.min(c0, g.c0);
  }
  return r1 < 0 ? null : { r0, c0, r1, c1 };
}

/** The block of filled cells around (r, c), bounded by empty rows and columns (Ctrl+A / "current region"). */
export function currentRegion(sheet, r, c) {
  const filled = (rr, cc) => {
    const x = sheet.cells[rcKey(rr, cc)];
    return !!x && (x.v !== undefined || x.f !== undefined);
  };
  let g = { r0: r, c0: c, r1: r, c1: c };
  for (let pass = 0; pass < 200; pass++) {
    let grew = false;
    const rowHas = (rr) => rr >= 0 && Array.from({ length: g.c1 - g.c0 + 3 }, (_, i) => g.c0 - 1 + i).some((cc) => cc >= 0 && filled(rr, cc));
    const colHas = (cc) => cc >= 0 && Array.from({ length: g.r1 - g.r0 + 3 }, (_, i) => g.r0 - 1 + i).some((rr) => rr >= 0 && filled(rr, cc));
    if (rowHas(g.r0 - 1)) (g = { ...g, r0: g.r0 - 1 }), (grew = true);
    if (rowHas(g.r1 + 1)) (g = { ...g, r1: g.r1 + 1 }), (grew = true);
    if (colHas(g.c0 - 1)) (g = { ...g, c0: g.c0 - 1 }), (grew = true);
    if (colHas(g.c1 + 1)) (g = { ...g, c1: g.c1 + 1 }), (grew = true);
    if (!grew) break;
  }
  return g;
}

/** Grid extent including formatting-only cells (for scrolling and saving). */
export function extentOf(sheet) {
  let rows = 0;
  let cols = 0;
  for (const k of Object.keys(sheet.cells)) {
    const { r, c } = keyRC(k);
    if (r + 1 > rows) rows = r + 1;
    if (c + 1 > cols) cols = c + 1;
  }
  return { rows, cols };
}

// ------------------------------------------------------------------------------------------------------ input

const NUM = /^[+-]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * What a user typed → cell content: "=…" formula, numbers ("1,234.5", "$12", "12%", "1e3"), booleans, dates
 * ("2026-10-28", "10/28/2026", "28.10.2026"), times ("12:30"), "'text" (forced text). `nf` is a number format the
 * input implies (only applied when the cell has none).
 * @returns {{ v?: any, f?: string, nf?: string } | null} null = clear the cell
 */
export function parseInput(text) {
  const s = String(text ?? "");
  if (s === "") return null;
  if (s.startsWith("'")) return { v: s.slice(1) };
  if (s.startsWith("=") && s.length > 1) return { f: s.slice(1).trim() };
  const t = s.trim();
  if (/^true$/i.test(t)) return { v: true };
  if (/^false$/i.test(t)) return { v: false };
  let m = /^([+-]?)\$\s?([\d,]*\.?\d+)$/.exec(t);
  if (m && NUM.test(m[2])) return { v: Number(m[1] + m[2].replace(/,/g, "")), nf: '"$"#,##0.00' };
  m = /^([+-]?[\d,]*\.?\d+)\s?€$/.exec(t);
  if (m && NUM.test(m[1])) return { v: Number(m[1].replace(/,/g, "")), nf: '#,##0.00 "€"' };
  m = /^([+-]?[\d,]*\.?\d+)%$/.exec(t);
  if (m && NUM.test(m[1])) {
    const dec = (m[1].split(".")[1] || "").length;
    return { v: Number(m[1].replace(/,/g, "")) / 100, nf: dec ? `0.${"0".repeat(dec)}%` : "0%" };
  }
  if (NUM.test(t) && /\d/.test(t)) return { v: Number(t.replace(/,/g, "")), ...(/,/.test(t) ? { nf: t.includes(".") ? "#,##0.00" : "#,##0" } : {}) };
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m && validDate(+m[1], +m[2], +m[3])) return { v: dateToSerial(+m[1], +m[2], +m[3]), nf: "yyyy-mm-dd" };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m && validDate(+m[3], +m[1], +m[2])) return { v: dateToSerial(+m[3], +m[1], +m[2]), nf: "mm/dd/yyyy" };
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m && validDate(+m[3], +m[2], +m[1])) return { v: dateToSerial(+m[3], +m[2], +m[1]), nf: "dd.mm.yyyy" };
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m && +m[1] < 24 && +m[2] < 60) return { v: (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400, nf: m[3] ? "hh:mm:ss" : "hh:mm" };
  return { v: s };
}
const validDate = (y, mo, d) => y >= 1900 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** The text a cell shows in the editor (formula with "=", raw value otherwise). */
export function editText(cell) {
  if (!cell) return "";
  if (typeof cell.f === "string") return `=${cell.f}`;
  if (cell.v === undefined || cell.v === null) return "";
  if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
  if (typeof cell.v === "string" && parseInput(cell.v)?.v !== cell.v && !cell.v.startsWith("'")) return `'${cell.v}`;
  return String(cell.v);
}

// ------------------------------------------------------------------------------------------------------ cell edits

/** Writes cells: `updates` maps A1 → cell | null (null deletes the content but keeps the style). */
export function setCells(m, sid, updates) {
  return updateSheet(m, sid, (s) => {
    const cells = { ...s.cells };
    for (const [k, next] of Object.entries(updates)) {
      const prev = cells[k];
      if (next === null) {
        if (prev?.s) cells[k] = { s: prev.s };
        else delete cells[k];
      } else {
        const cell = { ...next };
        if (cell.s === undefined && prev?.s) cell.s = prev.s;
        if (cell.v === undefined) delete cell.v;
        if (cell.f === undefined) delete cell.f;
        if (cell.s === undefined || (cell.s && !Object.keys(cell.s).length)) delete cell.s;
        if (cell.v === undefined && cell.f === undefined && !cell.s) delete cells[k];
        else cells[k] = cell;
      }
    }
    return { ...s, cells };
  });
}

/** Applies typed input to a cell (keeps its style; adds an implied number format when it has none). */
export function inputCell(m, sid, a1, text) {
  const sheet = sheetById(m, sid);
  const prev = sheet.cells[a1];
  const p = parseInput(text);
  if (!p) return setCells(m, sid, { [a1]: null });
  const cell = { ...(p.f !== undefined ? { f: p.f } : { v: p.v }) };
  if (p.nf && !prev?.s?.nf) cell.s = { ...(prev?.s || {}), nf: p.nf };
  return setCells(m, sid, { [a1]: cell });
}

const MAX_STYLE_CELLS = 200000;

/** Cells of a range (clamped to the used extent + 1 when it covers whole rows/columns). */
export function* rangeCells(sheet, range, cap = MAX_STYLE_CELLS) {
  const g = normRange(range);
  const ext = extentOf(sheet);
  const r1 = g.r1 >= MAX_ROWS - 1 ? Math.max(g.r0, ext.rows - 1) : g.r1;
  const c1 = g.c1 >= MAX_COLS - 1 ? Math.max(g.c0, ext.cols - 1) : g.c1;
  let n = 0;
  for (let r = g.r0; r <= r1; r++)
    for (let c = g.c0; c <= c1; c++) {
      if (++n > cap) return;
      yield [r, c, rcKey(r, c)];
    }
}

/** Merges a style patch into every cell of a range (`null` values remove a property). */
export function applyStyle(m, sid, range, patch) {
  return updateSheet(m, sid, (s) => {
    const cells = { ...s.cells };
    for (const [, , k] of rangeCells(s, range)) {
      const prev = cells[k] || {};
      const st = { ...(prev.s || {}) };
      for (const [p, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === false) delete st[p];
        else st[p] = v;
      }
      const cell = { ...prev, s: st };
      if (!Object.keys(st).length) delete cell.s;
      if (cell.v === undefined && cell.f === undefined && !cell.s) delete cells[k];
      else cells[k] = cell;
    }
    return { ...s, cells };
  });
}

/** Clears contents (and with `all` the formats) of a range. */
export function clearRange(m, sid, range, { all = false } = {}) {
  return updateSheet(m, sid, (s) => {
    const cells = { ...s.cells };
    const g = normRange(range);
    for (const k of Object.keys(cells)) {
      const { r, c } = keyRC(k);
      if (r < g.r0 || r > g.r1 || c < g.c0 || c > g.c1) continue;
      if (all || !cells[k].s) delete cells[k];
      else cells[k] = { s: cells[k].s };
    }
    return { ...s, cells };
  });
}

/**
 * Copies a block of cells (from a clipboard or a fill) into a sheet at (r, c). `block` is a 2-D array of cells
 * (null = empty); `from` = { r, c } of the source so relative formula references move along.
 */
export function pasteBlock(m, sid, r, c, block, { from = null, values = false } = {}) {
  const updates = {};
  for (let i = 0; i < block.length; i++)
    for (let j = 0; j < block[i].length; j++) {
      const rr = r + i;
      const cc = c + j;
      if (rr >= MAX_ROWS || cc >= MAX_COLS) continue;
      const src = block[i][j];
      const k = rcKey(rr, cc);
      if (!src) {
        updates[k] = null;
        continue;
      }
      const cell = { ...src };
      if (values) delete cell.f;
      else if (typeof cell.f === "string" && from) cell.f = shiftFormula(cell.f, rr - (from.r + i), cc - (from.c + j));
      updates[k] = cell;
    }
  return setCells(m, sid, updates);
}

/** Fill (drag handle / Ctrl+D / Ctrl+R): repeats the source range over the target range, series for numbers. */
export function fillRange(m, sid, source, target) {
  const s = sheetById(m, sid);
  const g = normRange(source);
  const t = normRange(target);
  const h = g.r1 - g.r0 + 1;
  const w = g.c1 - g.c0 + 1;
  const down = t.c0 === g.c0 && t.c1 === g.c1;
  const updates = {};
  // numeric series per column (down) or row (right) when the source has 2+ numbers in a line
  const step = (vals) => (vals.length >= 2 && vals.every((v) => typeof v === "number") ? vals[1] - vals[0] : null);
  for (let r = t.r0; r <= t.r1; r++)
    for (let c = t.c0; c <= t.c1; c++) {
      if (r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1) continue;
      const i = (((r - g.r0) % h) + h) % h;
      const j = (((c - g.c0) % w) + w) % w;
      const src = s.cells[rcKey(g.r0 + i, g.c0 + j)];
      const k = rcKey(r, c);
      if (!src) {
        updates[k] = null;
        continue;
      }
      const cell = { ...src };
      if (typeof cell.f === "string") cell.f = shiftFormula(cell.f, r - (g.r0 + i), c - (g.c0 + j));
      else if (typeof cell.v === "number") {
        const line = down ? Array.from({ length: h }, (_, q) => s.cells[rcKey(g.r0 + q, c)]?.v) : Array.from({ length: w }, (_, q) => s.cells[rcKey(r, g.c0 + q)]?.v);
        const d = step(line);
        if (d !== null) cell.v = Number((line[line.length - 1] + d * (down ? r - g.r1 : c - g.c1)).toPrecision(15));
      }
      updates[k] = cell;
    }
  return setCells(m, sid, updates);
}

// ------------------------------------------------------------------------------------------------------ structure

const adjustRange = (rg, opts) => {
  const out = adjustFormula(rg, opts);
  return out.includes("#REF!") ? null : out;
};

/** Inserts (n > 0) or deletes (n < 0) rows or columns at `at` of a sheet; formulas everywhere follow. */
export function shiftAxis(m, sid, axis, at, n) {
  const target = sheetById(m, sid);
  if (!target || !n) return m;
  const opts = { sheet: target.name, axis, at, n };
  const sheets = m.sheets.map((s) => {
    const own = { ...opts, ownSheet: s.name };
    const cells = {};
    for (const [k, cell0] of Object.entries(s.cells)) {
      let cell = cell0;
      if (typeof cell.f === "string") {
        const f = adjustFormula(cell.f, own);
        if (f !== cell.f) cell = { ...cell, f };
      }
      if (s.id !== sid) {
        cells[k] = cell;
        continue;
      }
      const { r, c } = keyRC(k);
      const i = axis === "row" ? r : c;
      if (n < 0 && i >= at && i < at - n) continue; // deleted
      const j = i >= at ? i + n : i;
      if (j < 0 || j >= (axis === "row" ? MAX_ROWS : MAX_COLS)) continue;
      cells[axis === "row" ? rcKey(j, c) : rcKey(r, j)] = cell;
    }
    if (s.id !== sid) return cells === s.cells ? s : { ...s, cells };
    const sizes = (obj) => {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        const i = Number(k);
        if (n < 0 && i >= at && i < at - n) continue;
        out[i >= at ? i + n : i] = v;
      }
      return out;
    };
    const fr = s.freeze;
    const freezeAxis = axis === "row" ? "r" : "c";
    const freeze = fr && fr[freezeAxis] > at ? { ...fr, [freezeAxis]: Math.max(at, fr[freezeAxis] + n) } : fr;
    const charts = s.charts.map((ch) => {
      const a = axis === "row" ? "r" : "c";
      const range = adjustRange(ch.range, own) || ch.range;
      return { ...ch, range, [a]: ch[a] >= at ? Math.max(at, ch[a] + n) : ch[a] };
    });
    const filter = s.filter ? (adjustRange(s.filter.range, own) ? { ...s.filter, range: adjustRange(s.filter.range, own) } : null) : null;
    return {
      ...s,
      cells,
      rows: axis === "row" ? sizes(s.rows) : s.rows,
      cols: axis === "col" ? sizes(s.cols) : s.cols,
      merges: s.merges.map((x) => adjustRange(x, own)).filter(Boolean),
      cf: s.cf.map((x) => ({ ...x, range: adjustRange(x.range, own) })).filter((x) => x.range),
      charts,
      filter,
      freeze: freeze && (freeze.r || freeze.c) ? freeze : null,
    };
  });
  return { ...m, sheets };
}

export function setSize(m, sid, axis, indexes, px) {
  return updateSheet(m, sid, (s) => {
    const key = axis === "row" ? "rows" : "cols";
    const def = axis === "row" ? DEFAULT_ROW : DEFAULT_COL;
    const obj = { ...s[key] };
    for (const i of indexes) {
      if (px == null || px === def) delete obj[i];
      else obj[i] = Math.max(0, Math.min(2000, Math.round(px)));
    }
    return { ...s, [key]: obj };
  });
}

export function mergeRange(m, sid, range) {
  const g = normRange(range);
  if (g.r0 === g.r1 && g.c0 === g.c1) return m;
  return updateSheet(m, sid, (s) => {
    const merges = s.merges.filter((x) => !overlaps(parseRange(x), g));
    // a merged block keeps the top-left content only
    const cells = { ...s.cells };
    for (let r = g.r0; r <= g.r1; r++)
      for (let c = g.c0; c <= g.c1; c++) {
        if (r === g.r0 && c === g.c0) continue;
        const k = rcKey(r, c);
        if (cells[k]) cells[k].s ? (cells[k] = { s: cells[k].s }) : delete cells[k];
      }
    return { ...s, cells, merges: [...merges, formatRange(g)] };
  });
}

export function unmergeRange(m, sid, range) {
  const g = normRange(range);
  return updateSheet(m, sid, (s) => ({ ...s, merges: s.merges.filter((x) => !overlaps(parseRange(x), g)) }));
}

export const overlaps = (a, b) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

/** The merge that contains a cell, or null. */
export function mergeAt(sheet, r, c) {
  for (const x of sheet.merges) {
    const g = parseRange(x);
    if (r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1) return g;
  }
  return null;
}

/**
 * Sorts the rows of a range by one column (values from `valueOf(r, c)`, the computed values). `header` keeps the
 * first row in place. Relative formula references move with their rows.
 */
export function sortRange(m, sid, range, col, { asc = true, header = false, valueOf, compare }) {
  const g = normRange(range);
  const s = sheetById(m, sid);
  const r0 = header ? g.r0 + 1 : g.r0;
  if (r0 >= g.r1) return m;
  const rows = [];
  for (let r = r0; r <= g.r1; r++) rows.push(r);
  const key = (r) => valueOf(r, col);
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const ex = x == null || x === "";
    const ey = y == null || y === "";
    if (ex || ey) return ex === ey ? a - b : ex ? 1 : -1; // blanks last in both directions
    return (asc ? compare(x, y) : compare(y, x)) || a - b;
  });
  const updates = {};
  rows.forEach((src, i) => {
    const dst = r0 + i;
    for (let c = g.c0; c <= g.c1; c++) {
      const cell = s.cells[rcKey(src, c)];
      const k = rcKey(dst, c);
      if (!cell) updates[k] = null;
      else updates[k] = typeof cell.f === "string" ? { ...cell, f: shiftFormula(cell.f, dst - src, 0) } : cell;
    }
  });
  return setCells(m, sid, updates);
}

// ------------------------------------------------------------------------------------------------------ sheets

export function uniqueSheetName(m, base = "Sheet") {
  if (!sheetByName(m, base) && validSheetName(base)) return base;
  for (let i = m.sheets.length + 1; ; i++) {
    const n = `${base.replace(/\s*\d+$/, "").slice(0, 26)}${/\d$/.test(base) || base === "Sheet" ? "" : " "}${i}`;
    if (!sheetByName(m, n)) return n;
  }
}

export function addSheet(m, { name, after = m.active, sheet = null } = {}) {
  const idx = m.sheets.findIndex((s) => s.id === after);
  const prev = m.sheets[idx] || m.sheets[m.sheets.length - 1];
  const next = m.sheets[idx + 1];
  const pos = next ? (prev.pos + next.pos) / 2 : prev.pos + 1;
  const s = { ...newSheet(uniqueSheetName(m, name || "Sheet"), newId("s"), pos), ...(sheet || {}) };
  s.name = sheetByName(m, s.name) ? uniqueSheetName(m, s.name) : s.name;
  const sheets = [...m.sheets.slice(0, idx + 1), s, ...m.sheets.slice(idx + 1)];
  return { ...m, sheets, active: s.id };
}

export function renameSheet(m, sid, name) {
  const s = sheetById(m, sid);
  if (!s || !validSheetName(name)) throw new Error("Sheet names have 1 to 31 characters and none of [ ] : * ? / \\");
  const other = sheetByName(m, name);
  if (other && other.id !== sid) throw new Error("Another sheet already has this name.");
  const from = s.name;
  return {
    ...m,
    sheets: m.sheets.map((x) => {
      let cells = x.cells;
      for (const [k, c] of Object.entries(x.cells)) {
        if (typeof c.f !== "string" || !c.f.toLowerCase().includes(from.toLowerCase())) continue;
        const f = renameSheetInFormula(c.f, from, name);
        if (f !== c.f) {
          if (cells === x.cells) cells = { ...x.cells };
          cells[k] = { ...c, f };
        }
      }
      return { ...x, ...(x.id === sid ? { name } : {}), cells };
    }),
  };
}

export function deleteSheet(m, sid) {
  if (m.sheets.length <= 1) throw new Error("A workbook needs at least one sheet.");
  const i = m.sheets.findIndex((s) => s.id === sid);
  const sheets = m.sheets.filter((s) => s.id !== sid);
  return { ...m, sheets, active: m.active === sid ? sheets[Math.max(0, i - 1)].id : m.active };
}

export function moveSheet(m, sid, toIndex) {
  const list = m.sheets.filter((s) => s.id !== sid);
  const s = sheetById(m, sid);
  const k = Math.max(0, Math.min(list.length, toIndex));
  const before = list[k - 1];
  const after = list[k];
  const pos = before && after ? (before.pos + after.pos) / 2 : before ? before.pos + 1 : after ? after.pos - 1 : 1;
  list.splice(k, 0, { ...s, pos });
  return { ...m, sheets: list };
}

export function duplicateSheet(m, sid) {
  const s = sheetById(m, sid);
  return addSheet(m, { name: `${s.name.slice(0, 24)} (2)`, after: sid, sheet: { cells: s.cells, cols: s.cols, rows: s.rows, merges: s.merges, freeze: s.freeze, cf: s.cf.map((x) => ({ ...x, id: newId("cf") })), charts: s.charts.map((x) => ({ ...x, id: newId("ch") })) } });
}

// ------------------------------------------------------------------------------------------------------ filter

/** Rows hidden by the sheet's filter (Set of row indexes). `textOf(r, c)` is the displayed text. */
export function filteredRows(sheet, textOf) {
  const out = new Set();
  const f = sheet.filter;
  if (!f) return out;
  const g = parseRange(f.range);
  if (!g) return out;
  const cols = Object.entries(f.hide || {}).filter(([, list]) => list?.length);
  if (!cols.length) return out;
  const sets = cols.map(([c, list]) => [g.c0 + Number(c), new Set(list)]);
  for (let r = g.r0 + 1; r <= g.r1; r++) if (sets.some(([c, set]) => set.has(textOf(r, c)))) out.add(r);
  return out;
}

// ------------------------------------------------------------------------------------------------------ conditional formats

/** The style a conditional-format rule list adds to a cell value (or null). `scale` needs the range's min/max. */
export function cfStyle(rules, r, c, value, stats) {
  let out = null;
  for (const rule of rules) {
    const g = parseRange(rule.range);
    if (!g || r < g.r0 || r > g.r1 || c < g.c0 || c > g.c1) continue;
    if (rule.type === "scale") {
      if (typeof value !== "number") continue;
      const st = stats(rule);
      if (!st || st.max === st.min) continue;
      const t = (value - st.min) / (st.max - st.min);
      out = { ...out, fill: mix(rule.colors?.[0] || "#f8696b", rule.colors?.[1] || "#63be7b", t) };
      continue;
    }
    if (matchRule(rule, value)) out = { ...out, ...(rule.style || {}) };
  }
  return out;
}

export function matchRule(rule, v) {
  const a = rule.a;
  const b = rule.b;
  const n = typeof v === "number" ? v : null;
  const an = Number(a);
  const bn = Number(b);
  switch (rule.type) {
    case "gt":
      return n !== null && n > an;
    case "lt":
      return n !== null && n < an;
    case "ge":
      return n !== null && n >= an;
    case "le":
      return n !== null && n <= an;
    case "eq":
      return n !== null && Number.isFinite(an) ? n === an : String(v ?? "").toLowerCase() === String(a ?? "").toLowerCase();
    case "ne":
      return n !== null && Number.isFinite(an) ? n !== an : String(v ?? "").toLowerCase() !== String(a ?? "").toLowerCase();
    case "between":
      return n !== null && n >= Math.min(an, bn) && n <= Math.max(an, bn);
    case "contains":
      return v != null && String(v).toLowerCase().includes(String(a ?? "").toLowerCase());
    case "blank":
      return v == null || v === "";
    case "notBlank":
      return !(v == null || v === "");
    default:
      return false;
  }
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  const k = Math.max(0, Math.min(1, t));
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

// ------------------------------------------------------------------------------------------------------ collaboration

/**
 * Records for "Edit together" (collab/office-records.js): one per cell ("cell:<sheetId>!A1"), one per sheet
 * ("sheet:<id>": name, position, sizes, merges, freeze, filter, rules and charts) and "meta:active" is not shared
 * (each member has their own active sheet).
 */
export function toRecords(m) {
  const out = {};
  for (const s of m.sheets) {
    const { cells, id, ...meta } = s;
    out[`sheet:${id}`] = meta;
    for (const [k, c] of Object.entries(cells)) out[`cell:${id}!${k}`] = c;
  }
  if (m.meta?.title) out["meta:title"] = m.meta.title;
  return out;
}

export function applyRecords(m, changes) {
  const sheets = new Map(m.sheets.map((s) => [s.id, s]));
  const cellChanges = new Map();
  let meta = m.meta;
  for (const [key, val] of Object.entries(changes)) {
    if (key.startsWith("sheet:")) {
      const id = key.slice(6);
      if (val === null) sheets.delete(id);
      else sheets.set(id, { ...newSheet(val.name || "Sheet", id), ...(sheets.get(id) || {}), ...val, id, cells: sheets.get(id)?.cells || {} });
    } else if (key.startsWith("cell:")) {
      const i = key.lastIndexOf("!");
      const sid = key.slice(5, i);
      if (!cellChanges.has(sid)) cellChanges.set(sid, {});
      cellChanges.get(sid)[key.slice(i + 1)] = val;
    } else if (key === "meta:title") meta = { ...meta, title: val || "" };
  }
  for (const [sid, ch] of cellChanges) {
    const s = sheets.get(sid);
    if (!s) continue;
    const cells = { ...s.cells };
    for (const [k, v] of Object.entries(ch)) v === null ? delete cells[k] : (cells[k] = v);
    sheets.set(sid, { ...s, cells });
  }
  const list = [...sheets.values()].sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : 1));
  if (!list.length) return m;
  return { ...m, meta, sheets: list, active: sheets.has(m.active) ? m.active : list[0].id };
}

// ------------------------------------------------------------------------------------------------------ describe

/** Small JSON summary for Vibe (office_describe, the system prompt). `valueOf(sid, a1)` gives computed values. */
export function describeWorkbook(m, valueOf = null) {
  return {
    kind: "sheet",
    title: m.meta?.title || "",
    active: activeSheet(m).name,
    sheets: m.sheets.map((s) => {
      const used = usedRange(s);
      const head = [];
      if (used) {
        for (let c = used.c0; c <= Math.min(used.c1, used.c0 + 11); c++) {
          const cell = s.cells[rcKey(used.r0, c)];
          const v = valueOf ? valueOf(s.id, rcKey(used.r0, c)) : cell?.v;
          head.push(v == null ? "" : String(v).slice(0, 40));
        }
      }
      return {
        name: s.name,
        used: used ? formatRange(used) : null,
        cells: Object.keys(s.cells).length,
        formulas: Object.values(s.cells).filter((c) => typeof c.f === "string").length,
        firstRow: head,
        ...(s.charts.length ? { charts: s.charts.map((c) => `${c.type} ${c.range}${c.title ? ` "${c.title}"` : ""}`) } : {}),
        ...(s.freeze ? { freeze: `${s.freeze.r} rows, ${s.freeze.c} cols` } : {}),
        ...(s.filter ? { filter: s.filter.range } : {}),
        ...(s.merges.length ? { merges: s.merges.length } : {}),
      };
    }),
  };
}

// ------------------------------------------------------------------------------------------------------ templates

const B = { b: true };
const HEAD = { b: true, fill: "#dbe5f1", bd: { b: "#7f9cc0" } };
const MONEY = '"$"#,##0.00';

function sheetFrom(name, rows, extra = {}) {
  const s = newSheet(name, "s1", 1);
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v == null) return;
      const cell = typeof v === "object" && !Array.isArray(v) ? { ...v } : typeof v === "string" && v.startsWith("=") ? { f: v.slice(1) } : { v };
      if (cell.text !== undefined) {
        cell.v = cell.text;
        delete cell.text;
      }
      s.cells[rcKey(r, c)] = cell;
    }));
  return { ...s, ...extra };
}

/** A new workbook from a template id of the manifest. */
export function templateWorkbook(id = "blank", title = "") {
  const wb = newWorkbook({ title });
  if (id === "budget") {
    const items = [["Rent", 1200, 1200], ["Utilities", 180, 164.5], ["Groceries", 450, 512.3], ["Transport", 120, 98], ["Insurance", 95, 95], ["Leisure", 200, 260.75], ["Savings", 400, 400]];
    const rows = [
      [{ v: "Monthly budget", s: { b: true, size: 16 } }],
      [],
      [{ v: "Category", s: HEAD }, { v: "Planned", s: { ...HEAD, ha: "right" } }, { v: "Actual", s: { ...HEAD, ha: "right" } }, { v: "Difference", s: { ...HEAD, ha: "right" } }],
      ...items.map(([n, p, a], i) => [n, { v: p, s: { nf: MONEY } }, { v: a, s: { nf: MONEY } }, { f: `B${i + 4}-C${i + 4}`, s: { nf: MONEY } }]),
      [{ v: "Total", s: B }, { f: `SUM(B4:B${items.length + 3})`, s: { b: true, nf: MONEY, bd: { t: "#000000" } } }, { f: `SUM(C4:C${items.length + 3})`, s: { b: true, nf: MONEY, bd: { t: "#000000" } } }, { f: `SUM(D4:D${items.length + 3})`, s: { b: true, nf: MONEY, bd: { t: "#000000" } } }],
    ];
    const s = sheetFrom("Budget", rows, {
      cols: { 0: 150, 1: 110, 2: 110, 3: 110 },
      freeze: { r: 3, c: 0 },
      cf: [{ id: "cf1", range: `D4:D${items.length + 3}`, type: "lt", a: 0, style: { color: "#c00000", fill: "#fde2e1" } }],
      charts: [{ id: "ch1", type: "column", range: `A3:C${items.length + 3}`, title: "Planned vs. actual", r: 1, c: 5, w: 460, h: 280 }],
    });
    return { ...wb, sheets: [s], active: s.id };
  }
  if (id === "invoice-table") {
    const items = [["Design work", 12, 85], ["Development", 30, 95], ["Hosting (year)", 1, 240], ["Support package", 4, 60]];
    const first = 7;
    const last = first + items.length - 1;
    const rows = [
      [{ v: "INVOICE", s: { b: true, size: 20, color: "#1f3864" } }],
      ["Invoice no.", "2026-001", null, "Date", { f: "TODAY()", s: { nf: "yyyy-mm-dd" } }],
      ["Customer", "Example Customer Ltd."],
      ["Due", { f: "E2+14", s: { nf: "yyyy-mm-dd" } }],
      [],
      [{ v: "Item", s: HEAD }, { v: "Quantity", s: { ...HEAD, ha: "right" } }, { v: "Unit price", s: { ...HEAD, ha: "right" } }, { v: "Amount", s: { ...HEAD, ha: "right" } }],
      ...items.map(([n, q, p], i) => [n, q, { v: p, s: { nf: MONEY } }, { f: `B${first + i}*C${first + i}`, s: { nf: MONEY } }]),
      [],
      [null, null, { v: "Subtotal", s: B }, { f: `SUM(D${first}:D${last})`, s: { nf: MONEY, bd: { t: "#000000" } } }],
      [null, null, { v: "Tax rate", s: B }, { v: 0.19, s: { nf: "0%" } }],
      [null, null, { v: "Tax", s: B }, { f: `ROUND(D${last + 2}*D${last + 3},2)`, s: { nf: MONEY } }],
      [null, null, { v: "Total", s: { b: true, size: 13 } }, { f: `D${last + 2}+D${last + 4}`, s: { b: true, size: 13, nf: MONEY, bd: { t: "#000000", b: "#000000" } } }],
    ];
    const s = sheetFrom("Invoice", rows, { cols: { 0: 200, 1: 160, 2: 110, 3: 120, 4: 110 } });
    return { ...wb, sheets: [s], active: s.id };
  }
  return wb;
}

export { colName, rcKey, keyRC };
