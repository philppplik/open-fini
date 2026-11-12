// Shared helpers for writing and reading the spreadsheet depth features (docs/office-sheet.md ▸ Formats) in XLSX and
// ODS: outline levels of row and column groups, table looks baked into cell styles (ODS has no table styles), refreshable
// pivot definitions stored as hidden defined names, and data validation rules as bounds. Pure; xlsx.js and ods.js call
// it. Tests: tests/office/sheet-depth-io.test.js.
import { parseRange } from "../toolkit/selection.js";
import { rcKey } from "./formula.js";
import { tableLook } from "./depth.js";

// ------------------------------------------------------------------------------------------------------ groups

/** Outline level of every grouped index (1-7: how many groups contain it). */
export function outlineLevels(list) {
  const out = new Map();
  for (const g of list || [])
    for (let i = g.from; i <= g.to && i - g.from < 1048576; i++) out.set(i, Math.min(7, (out.get(i) || 0) + 1));
  return out;
}

/**
 * Groups from outline levels (Map index → level): each run of indexes at level ≥ L is a group of level L.
 * `collapsed(group)` decides whether a rebuilt group is collapsed.
 */
export function groupsFromLevels(levels, collapsed = () => false) {
  const keys = [...levels.keys()].sort((a, b) => a - b);
  const out = [];
  for (let L = 1; L <= 7; L++) {
    let start = null;
    let prev = null;
    const close = () => {
      if (start === null) return;
      const g = { from: start, to: prev, collapsed: false };
      g.collapsed = !!collapsed(g);
      out.push(g);
      start = null;
    };
    for (const i of keys) {
      if (levels.get(i) < L) continue;
      if (start !== null && i !== prev + 1) close();
      if (start === null) start = i;
      prev = i;
    }
    close();
  }
  return out.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** Groups that nest properly (a group crossing an enclosing one is left out, so the file stays a tree). */
export function nestedGroups(list) {
  const sorted = [...(list || [])].sort((a, b) => a.from - b.from || b.to - a.to);
  const stack = [];
  const out = [];
  for (const g of sorted) {
    while (stack.length && stack[stack.length - 1].to < g.from) stack.pop();
    const top = stack[stack.length - 1];
    if (top && g.to > top.to) continue;
    out.push(g);
    stack.push(g);
  }
  return out;
}

/** Indexes hidden only because a collapsed group hides them: the reader drops their "hidden" size. */
export function unhideCollapsed(sizes, groups) {
  for (const g of groups) if (g.collapsed) for (let i = g.from; i <= g.to && i - g.from < 1048576; i++) if (sizes[i] === 0) delete sizes[i];
}

// ------------------------------------------------------------------------------------------------------ table looks

/** Cell styles with the sheet's table looks merged in (cell styles win), for formats without table styles. */
export function bakeTables(sheet, tables = sheet.tables) {
  if (!tables?.length) return sheet.cells;
  const cells = { ...sheet.cells };
  const only = { ...sheet, tables };
  for (const t of tables) {
    const g = parseRange(t.range);
    if (!g) continue;
    for (let r = g.r0; r <= g.r1 && r - g.r0 < 100000; r++)
      for (let c = g.c0; c <= g.c1 && c - g.c0 < 1000; c++) {
        const look = tableLook(only, r, c);
        if (!look) continue;
        const k = rcKey(r, c);
        const cell = cells[k] || {};
        const st = cell.s || {};
        const bd = look.bd || st.bd ? { bd: { ...(look.bd || {}), ...(st.bd || {}) } } : {};
        cells[k] = { ...cell, s: { ...look, ...st, ...bd } };
      }
  }
  return cells;
}

/** Removes a table's baked look from the cells it covers (keys whose value equals the look). */
export function unbakeTable(sheet, table) {
  const g = parseRange(table.range);
  if (!g) return;
  const only = { ...sheet, tables: [table] };
  for (let r = g.r0; r <= g.r1 && r - g.r0 < 100000; r++)
    for (let c = g.c0; c <= g.c1 && c - g.c0 < 1000; c++) {
      const k = rcKey(r, c);
      const cell = sheet.cells[k];
      const look = tableLook(only, r, c);
      if (!cell?.s || !look) continue;
      const s = { ...cell.s };
      for (const [key, v] of Object.entries(look)) if (key !== "bd" && s[key] === v) delete s[key];
      if (look.bd && s.bd) {
        const bd = { ...s.bd };
        for (const [side, v] of Object.entries(look.bd)) if (bd[side] === v) delete bd[side];
        if (Object.keys(bd).length) s.bd = bd;
        else delete s.bd;
      }
      const next = { ...cell };
      if (Object.keys(s).length) next.s = s;
      else delete next.s;
      if (next.v === undefined && next.f === undefined && !next.s) delete sheet.cells[k];
      else sheet.cells[k] = next;
    }
}

/** Database range name that carries an OpenFini table through ODS: OpenFiniTable_<style>_<header><banded><total>_<n>. */
export const odsTableName = (t, n) => `OpenFiniTable_${t.style}_${t.header ? 1 : 0}${t.banded ? 1 : 0}${t.total ? 1 : 0}_${n}`;
export function odsTableFromName(name) {
  const m = /^OpenFiniTable_([a-z]+)_([01])([01])([01])_\d+$/.exec(String(name || ""));
  return m ? { style: m[1], header: m[2] === "1", banded: m[3] === "1", total: m[4] === "1" } : null;
}

/** Excel's built-in table style for an OpenFini style, and back (any Excel style maps to the nearest accent). */
const XL_TABLE = { blue: "TableStyleMedium2", orange: "TableStyleMedium3", gray: "TableStyleMedium4", green: "TableStyleMedium7", light: "TableStyleLight1" };
export const xlTableStyle = (style) => XL_TABLE[style] || XL_TABLE.blue;
export function tableStyleFromXl(name) {
  const own = Object.entries(XL_TABLE).find(([, v]) => v === name);
  if (own) return own[0];
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(String(name || ""));
  if (!m) return "blue";
  return ["gray", "gray", "blue", "orange", "gray", "orange", "blue", "green"][Number(m[2]) % 7 || 7] || "blue";
}

// ------------------------------------------------------------------------------------------------------ pivots

const PIVOT_RE = /^_OpenFini_Pivot_\d+$/i;
export const isPivotName = (name) => PIVOT_RE.test(String(name || ""));

/** Pivot definitions of a workbook as hidden-name entries [name, JSON]; definitions longer than 250 characters are skipped. */
export function pivotNames(wb) {
  const out = [];
  for (const s of wb.sheets)
    for (const p of s.pivots || []) {
      const json = JSON.stringify({ t: `${s.name}!${p.at}`, s: p.src, r: p.rows, c: p.columns ?? null, v: p.values, a: p.agg, n: p.size || null });
      if (json.length <= 250) out.push([`_OpenFini_Pivot_${out.length + 1}`, json]);
    }
  return out;
}

/** Adds pivot definitions read from hidden names back to their target sheets. `defs` = JSON texts. */
export function restorePivots(sheets, defs) {
  let n = 0;
  for (const text of defs) {
    let d;
    try {
      d = JSON.parse(text);
    } catch {
      continue;
    }
    const i = typeof d?.t === "string" ? d.t.lastIndexOf("!") : -1;
    if (i <= 0 || typeof d.s !== "string" || !d.r || !d.v) continue;
    const name = d.t.slice(0, i).replace(/^'|'$/g, "").replace(/''/g, "'");
    const s = sheets.find((x) => x.name === name);
    if (!s || !parseRange(d.t.slice(i + 1))) continue;
    s.pivots = [...(s.pivots || []), { id: `pv${++n}`, at: d.t.slice(i + 1), src: d.s, rows: String(d.r), columns: d.c ?? null, values: String(d.v), agg: d.a || "sum", ...(d.n ? { size: d.n } : {}) }];
  }
}

// ------------------------------------------------------------------------------------------------------ validation

/** Bounds of a number / length rule as an operator and formulas (Excel style). */
export function ruleBounds(rule) {
  const has = (x) => x !== undefined && x !== null && Number.isFinite(Number(x));
  if (has(rule.min) && has(rule.max)) return { op: "between", a: rule.min, b: rule.max };
  if (has(rule.min)) return { op: "greaterThanOrEqual", a: rule.min };
  if (has(rule.max)) return { op: "lessThanOrEqual", a: rule.max };
  return null;
}

/** min / max from an Excel operator and its formulas, or null when it cannot be kept (cell references, notBetween). */
export function boundsFromOp(op = "between", a, b) {
  const n = (x) => (x !== undefined && x !== null && String(x).trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : undefined);
  const na = n(a);
  const nb = n(b);
  if (a !== undefined && a !== null && String(a).trim() !== "" && na === undefined) return null;
  switch (op) {
    case "between":
      return b !== undefined && nb === undefined ? null : { min: na, max: nb };
    case "greaterThan":
    case "greaterThanOrEqual":
      return { min: na };
    case "lessThan":
    case "lessThanOrEqual":
      return { max: na };
    case "equal":
      return { min: na, max: na };
    default:
      return null;
  }
}
