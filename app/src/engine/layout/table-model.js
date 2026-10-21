/**
 * Pure table model operations (no DOM, no document): creation, cell edits, rows / columns (insert, delete, move,
 * duplicate), merge / split, sorting, formulas, number formats and CSV / TSV in and out.
 *
 * A table is plain JSON that lives in a `table` node:
 *
 * ```
 * { cols: number[],            column widths (px)
 *   rows: number[],            minimum row heights (px); rows grow to fit wrapped text when rendered
 *   cells: Cell[][],           rows x cols
 *   headerRows, headerCols,    count of header rows / columns (styled by the table style)
 *   tstyle: TableStyle,        see table-styles.js
 *   colFmt: (Format|null)[],   number format per column (see format.js)
 *   autoHeight: boolean }      rows grow with content (default true)
 *
 * Cell = { v: string,          raw content; a leading "=" makes it a formula
 *          rs?, cs?,           row / column span of a merged origin cell
 *          m?: [r, c],         set on covered cells: points at the merged origin
 *          bold?, italic?, underline?, color?, size?, family?, align?, valign?, fill?, fmt?, pad?,
 *          borders?: { t?, r?, b?, l?: {w, c} | null } }
 * ```
 *
 * Every function mutates the model passed in; hosts clone first (`structuredClone` / the app's `clone`) and write
 * the result back through the document so undo works.
 *
 * @module table-model
 */

import { createSheet, isError, shiftFormula, moveFormula, rewriteRefs } from './formula.js';
import { parseNumber, formatValue, plainNumber, parseRange, rangeName, cellName } from './format.js';
import { parseDelimited, detectDelimiter } from './data-merge.js';
import { presetStyle } from './table-styles.js';

export const MAX_ROWS = 500;
export const MAX_COLS = 60;

const STYLE_KEYS = ['bold', 'italic', 'underline', 'strike', 'color', 'size', 'family', 'align', 'valign', 'fill', 'fmt', 'pad', 'borders', 'lineHeight'];

export const blankCell = () => ({ v: '' });
const cloneJson = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** A copy of `cell` without content or merge info (keeps formatting). */
/** Removes tags until nothing changes, so nested fragments such as `<scr<b>ipt>` cannot reassemble into a tag. */
function stripTagsStable(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
}

function styleOnly(cell) {
  const out = { v: '' };
  if (!cell) return out;
  for (const k of STYLE_KEYS) if (cell[k] !== undefined) out[k] = cloneJson(cell[k]);
  return out;
}

// ------------------------------------------------------------------------------------------------ creation

/**
 * Creates the data part of a table node.
 * @param {{rows?:number, cols?:number, headerRows?:number, headerCols?:number, width?:number, rowHeight?:number,
 *   style?:string|object, data?:(string|number)[][], colWidths?:number[], savedStyles?:object}} [o]
 */
export function createTable(o = {}) {
  const data = o.data && o.data.length ? o.data : null;
  const rows = clampInt(o.rows ?? (data ? data.length : 4), 1, MAX_ROWS);
  const dataCols = data ? Math.max(...data.map((r) => r.length), 1) : 0;
  const cols = clampInt(o.cols ?? (data ? dataCols : 3), 1, MAX_COLS);
  const width = o.width ?? Math.min(560, cols * 140);
  const rowH = o.rowHeight ?? 34;
  const colWidths = o.colWidths && o.colWidths.length === cols ? o.colWidths.slice() : Array(cols).fill(width / cols);
  const headerRows = Math.min(rows, Math.max(0, o.headerRows ?? 1));
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let v = data && data[r] && data[r][c] != null ? String(data[r][c]) : '';
      if (!data && r < headerRows && c >= (o.headerCols ?? 0)) v = `Column ${c + 1}`;
      row.push({ v });
    }
    cells.push(row);
  }
  return {
    cols: colWidths,
    rows: Array(rows).fill(rowH),
    cells,
    headerRows,
    headerCols: Math.min(cols, Math.max(0, o.headerCols ?? 0)),
    tstyle: presetStyle(o.style && typeof o.style === 'string' ? o.style : 'clean', o.savedStyles),
    ...(o.style && typeof o.style === 'object' ? { tstyle: presetStyle(o.style) } : {}),
    colFmt: Array(cols).fill(null),
    autoHeight: true,
  };
}

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));
}

/** Total nominal size of a table (rows grow beyond this when text wraps). */
export const nominalSize = (t) => ({ w: t.cols.reduce((a, b) => a + b, 0), h: t.rows.reduce((a, b) => a + b, 0) });

/** Repairs a possibly hand-edited / foreign table model so every function below can rely on its shape. */
export function sanitizeTable(t) {
  t.cols = (Array.isArray(t.cols) && t.cols.length ? t.cols : [100]).slice(0, MAX_COLS).map((w) => (Number.isFinite(w) && w > 4 ? w : 100));
  t.rows = (Array.isArray(t.rows) && t.rows.length ? t.rows : [30]).slice(0, MAX_ROWS).map((h) => (Number.isFinite(h) && h > 4 ? h : 30));
  const R = t.rows.length;
  const C = t.cols.length;
  if (!Array.isArray(t.cells)) t.cells = [];
  t.cells.length = R;
  for (let r = 0; r < R; r++) {
    if (!Array.isArray(t.cells[r])) t.cells[r] = [];
    t.cells[r].length = C;
    for (let c = 0; c < C; c++) {
      const cell = t.cells[r][c];
      if (!cell || typeof cell !== 'object') t.cells[r][c] = { v: cell == null ? '' : String(cell) };
      else if (typeof cell.v !== 'string') cell.v = cell.v == null ? '' : String(cell.v);
    }
  }
  t.headerRows = Math.min(R, Math.max(0, t.headerRows | 0));
  t.headerCols = Math.min(C, Math.max(0, t.headerCols | 0));
  if (!Array.isArray(t.colFmt)) t.colFmt = [];
  t.colFmt.length = C;
  for (let c = 0; c < C; c++) if (t.colFmt[c] === undefined) t.colFmt[c] = null;
  if (!t.tstyle || typeof t.tstyle !== 'object') t.tstyle = presetStyle('clean');
  normalizeMerges(t);
  return t;
}

// ------------------------------------------------------------------------------------------------ merges

/** Rebuilds `m` pointers from the `rs` / `cs` of origin cells and drops spans that conflict or leave the table. */
export function normalizeMerges(t) {
  const R = t.rows.length;
  const C = t.cols.length;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) delete t.cells[r][c].m;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const cell = t.cells[r][c];
      if (cell.m) continue;
      let rs = Math.max(1, cell.rs | 0 || 1);
      let cs = Math.max(1, cell.cs | 0 || 1);
      rs = Math.min(rs, R - r);
      cs = Math.min(cs, C - c);
      if (rs === 1 && cs === 1) {
        delete cell.rs;
        delete cell.cs;
        continue;
      }
      let clash = false;
      for (let y = r; y < r + rs && !clash; y++) {
        for (let x = c; x < c + cs; x++) {
          if (y === r && x === c) continue;
          const o = t.cells[y][x];
          if (o.m || o.rs > 1 || o.cs > 1) {
            clash = true;
            break;
          }
        }
      }
      if (clash) {
        delete cell.rs;
        delete cell.cs;
        continue;
      }
      cell.rs = rs;
      cell.cs = cs;
      for (let y = r; y < r + rs; y++) {
        for (let x = c; x < c + cs; x++) {
          if (y === r && x === c) continue;
          const o = t.cells[y][x];
          o.m = [r, c];
          o.v = '';
        }
      }
    }
  }
  return t;
}

/** The merged origin `[r, c]` that owns a cell (itself when not covered). */
export function originOf(t, r, c) {
  const m = t.cells[r]?.[c]?.m;
  return m ? { r: m[0], c: m[1] } : { r, c };
}

/** Extent of the merged cell at an origin: `{r, c, rs, cs}`. */
export function spanOf(t, r, c) {
  const o = originOf(t, r, c);
  const cell = t.cells[o.r][o.c];
  return { r: o.r, c: o.c, rs: cell.rs || 1, cs: cell.cs || 1 };
}

/** Normalizes `{r0,c0,r1,c1}` to the table and grows it until it contains whole merged cells. */
export function expandRect(t, rect) {
  let { r0, c0, r1, c1 } = rect;
  r0 = Math.max(0, Math.min(r0, r1));
  r1 = Math.min(t.rows.length - 1, Math.max(rect.r0, rect.r1));
  c0 = Math.max(0, Math.min(rect.c0, rect.c1));
  c1 = Math.min(t.cols.length - 1, Math.max(rect.c0, rect.c1));
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const s = spanOf(t, r, c);
        if (s.r < r0) (r0 = s.r), (changed = true);
        if (s.c < c0) (c0 = s.c), (changed = true);
        if (s.r + s.rs - 1 > r1) (r1 = s.r + s.rs - 1), (changed = true);
        if (s.c + s.cs - 1 > c1) (c1 = s.c + s.cs - 1), (changed = true);
      }
    }
  }
  return { r0, c0, r1, c1 };
}

/**
 * Merges a rectangle into one cell. Text of the covered cells is joined into the origin when it is empty.
 * @returns {boolean} false when the rectangle is a single cell
 */
export function mergeCells(t, rect) {
  const g = expandRect(t, rect);
  if (g.r0 === g.r1 && g.c0 === g.c1) return false;
  const origin = t.cells[g.r0][g.c0];
  const parts = [];
  for (let r = g.r0; r <= g.r1; r++) {
    for (let c = g.c0; c <= g.c1; c++) {
      const cell = t.cells[r][c];
      if (cell.m) continue;
      if (cell.v && !(r === g.r0 && c === g.c0)) parts.push(cell.v);
      if (!(r === g.r0 && c === g.c0)) {
        delete cell.rs;
        delete cell.cs;
        cell.v = '';
      }
    }
  }
  if (!origin.v && parts.length) origin.v = parts.join(' ');
  origin.rs = g.r1 - g.r0 + 1;
  origin.cs = g.c1 - g.c0 + 1;
  normalizeMerges(t);
  return true;
}

/** Splits every merged cell that intersects the rectangle. */
export function splitCells(t, rect) {
  const g = expandRect(t, rect);
  let did = false;
  for (let r = g.r0; r <= g.r1; r++) {
    for (let c = g.c0; c <= g.c1; c++) {
      const cell = t.cells[r][c];
      if (cell.rs > 1 || cell.cs > 1) {
        delete cell.rs;
        delete cell.cs;
        did = true;
      }
    }
  }
  if (did) normalizeMerges(t);
  return did;
}

// ------------------------------------------------------------------------------------------------ cells

/** Sets raw text of a cell. Merged (covered) cells redirect to their origin. */
export function setCellValue(t, r, c, v) {
  const o = originOf(t, r, c);
  t.cells[o.r][o.c].v = v == null ? '' : String(v);
}

/**
 * Applies formatting keys to every cell of the rectangle. `null` / `undefined` values remove a key.
 * `borders` patches merge per edge: `{t: {w, c}, b: null}`.
 */
export function formatCells(t, rect, patch) {
  const g = expandRect(t, rect);
  for (let r = g.r0; r <= g.r1; r++) {
    for (let c = g.c0; c <= g.c1; c++) {
      const cell = t.cells[r][c];
      for (const k of Object.keys(patch)) {
        if (!STYLE_KEYS.includes(k)) continue;
        const v = patch[k];
        if (k === 'borders') {
          if (v == null) delete cell.borders;
          else {
            const b = { ...(cell.borders || {}) };
            for (const e of Object.keys(v)) {
              if (!['t', 'r', 'b', 'l'].includes(e)) continue;
              if (v[e] === undefined) delete b[e];
              else b[e] = v[e];
            }
            if (Object.keys(b).length) cell.borders = b;
            else delete cell.borders;
          }
        } else if (v === null || v === undefined || v === false) delete cell[k];
        else cell[k] = cloneJson(v);
      }
    }
  }
}

/**
 * Applies borders to a rectangle's edges: `where` is `'all'|'outer'|'inner'|'top'|'bottom'|'left'|'right'|'none'`;
 * `line` is `{w, c}` (or null to clear / remove the edge).
 */
export function setBorders(t, rect, where, line) {
  const g = expandRect(t, rect);
  const set = (r, c, edge, val) => {
    const cell = t.cells[r][c];
    const b = { ...(cell.borders || {}) };
    b[edge] = val;
    cell.borders = b;
  };
  const clearAll = where === 'none';
  for (let r = g.r0; r <= g.r1; r++) {
    for (let c = g.c0; c <= g.c1; c++) {
      const top = r === g.r0;
      const bottom = r === g.r1;
      const left = c === g.c0;
      const right = c === g.c1;
      const v = clearAll ? null : line;
      const edges = [];
      if (where === 'all' || clearAll) edges.push('t', 'r', 'b', 'l');
      else if (where === 'outer') {
        if (top) edges.push('t');
        if (bottom) edges.push('b');
        if (left) edges.push('l');
        if (right) edges.push('r');
      } else if (where === 'inner') {
        if (!top) edges.push('t');
        if (!bottom) edges.push('b');
        if (!left) edges.push('l');
        if (!right) edges.push('r');
      } else if (where === 'top' && top) edges.push('t');
      else if (where === 'bottom' && bottom) edges.push('b');
      else if (where === 'left' && left) edges.push('l');
      else if (where === 'right' && right) edges.push('r');
      for (const e of edges) set(r, c, e, v);
    }
  }
}

/** Clears the raw content of the (non-covered) cells in a rectangle. */
export function clearCells(t, rect, { formatting = false } = {}) {
  const g = expandRect(t, rect);
  for (let r = g.r0; r <= g.r1; r++) {
    for (let c = g.c0; c <= g.c1; c++) {
      const cell = t.cells[r][c];
      if (cell.m) continue;
      cell.v = '';
      if (formatting) {
        for (const k of STYLE_KEYS) delete cell[k];
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ rows / columns

const axisInfo = (axis) => (axis === 'row' ? { sizes: 'rows', span: 'rs', header: 'headerRows', max: MAX_ROWS } : { sizes: 'cols', span: 'cs', header: 'headerCols', max: MAX_COLS });
const count = (t, axis) => (axis === 'row' ? t.rows.length : t.cols.length);
const getCell = (t, axis, i, j) => (axis === 'row' ? t.cells[i][j] : t.cells[j][i]);
const setCell = (t, axis, i, j, cell) => {
  if (axis === 'row') t.cells[i][j] = cell;
  else t.cells[j][i] = cell;
};

function shiftAllFormulas(t, edit) {
  for (const row of t.cells) for (const cell of row) if (cell.v && cell.v.charCodeAt(0) === 61) cell.v = shiftFormula(cell.v, edit);
}

/**
 * Inserts `n` blank rows / columns before index `at` (`at === count` appends). New cells copy the formatting of
 * the neighboring line; formulas are adjusted.
 * @param {'row'|'col'} axis
 */
export function insertLines(t, axis, at, n = 1, { like } = {}) {
  const info = axisInfo(axis);
  const total = count(t, axis);
  n = Math.max(1, Math.round(n));
  if (total + n > info.max) return false;
  at = Math.max(0, Math.min(total, at));
  const ref = Math.max(0, Math.min(total - 1, like ?? (at > 0 ? at - 1 : 0)));
  // spans straddling the insertion point grow
  const cross = count(t, axis === 'row' ? 'col' : 'row');
  for (let i = 0; i < total; i++) {
    for (let j = 0; j < cross; j++) {
      const cell = getCell(t, axis, i, j);
      const span = cell[info.span] || 1;
      if (span > 1 && !cell.m && i < at && at < i + span) cell[info.span] = span + n;
    }
  }
  const newLines = [];
  for (let k = 0; k < n; k++) {
    const line = [];
    for (let j = 0; j < cross; j++) line.push(styleOnly(getCell(t, axis, ref, j)));
    newLines.push(line);
  }
  if (axis === 'row') {
    t.cells.splice(at, 0, ...newLines);
    t.rows.splice(at, 0, ...Array(n).fill(t.rows[ref]));
  } else {
    for (let r = 0; r < t.rows.length; r++) t.cells[r].splice(at, 0, ...newLines.map((l) => l[r]));
    t.cols.splice(at, 0, ...Array(n).fill(t.cols[ref]));
    t.colFmt.splice(at, 0, ...Array(n).fill(cloneJson(t.colFmt[ref] ?? null)));
  }
  if (at < t[info.header]) t[info.header] += n;
  shiftAllFormulas(t, { axis, op: 'insert', at, count: n });
  normalizeMerges(t);
  return true;
}

/**
 * Deletes `n` rows / columns starting at `at`. The last remaining line cannot be deleted.
 * @param {'row'|'col'} axis
 */
export function deleteLines(t, axis, at, n = 1) {
  const info = axisInfo(axis);
  const total = count(t, axis);
  n = Math.max(1, Math.round(n));
  if (at < 0 || at >= total) return false;
  n = Math.min(n, total - at);
  if (n >= total) return false;
  const cross = count(t, axis === 'row' ? 'col' : 'row');
  const end = at + n;
  for (let i = 0; i < total; i++) {
    for (let j = 0; j < cross; j++) {
      const cell = getCell(t, axis, i, j);
      const span = cell[info.span] || 1;
      if (span <= 1 || cell.m) continue;
      const s0 = i;
      const s1 = i + span;
      const overlap = Math.min(s1, end) - Math.max(s0, at);
      if (overlap <= 0) continue;
      if (s0 >= at && s0 < end) {
        const remaining = s1 - end;
        if (remaining > 0) {
          const target = getCell(t, axis, end, j);
          const moved = cloneJson(cell);
          delete moved.m;
          moved[info.span] = remaining;
          setCell(t, axis, end, j, Object.assign(target, moved));
        }
      } else cell[info.span] = span - overlap;
    }
  }
  const hdr = Math.max(0, Math.min(end, t[info.header]) - Math.min(at, t[info.header]));
  if (axis === 'row') {
    t.cells.splice(at, n);
    t.rows.splice(at, n);
  } else {
    for (const row of t.cells) row.splice(at, n);
    t.cols.splice(at, n);
    t.colFmt.splice(at, n);
  }
  t[info.header] = Math.max(0, t[info.header] - hdr);
  shiftAllFormulas(t, { axis, op: 'delete', at, count: n });
  normalizeMerges(t);
  return true;
}

/** True when a merged cell crosses a boundary inside `[from, to]` (such lines cannot be reordered). */
function spansCross(t, axis, lo, hi) {
  const info = axisInfo(axis);
  const total = count(t, axis);
  const cross = count(t, axis === 'row' ? 'col' : 'row');
  for (let i = 0; i < total; i++) {
    for (let j = 0; j < cross; j++) {
      const cell = getCell(t, axis, i, j);
      if (!cell.m && (cell[info.span] || 1) > 1 && i <= hi && i + cell[info.span] - 1 >= lo) return true;
    }
  }
  return false;
}

/**
 * Moves a row / column from index `from` to index `to` (final position). Fails (returns false) when merged
 * cells span any of the moved lines.
 * @param {'row'|'col'} axis
 */
export function moveLine(t, axis, from, to) {
  const total = count(t, axis);
  if (from === to || from < 0 || to < 0 || from >= total || to >= total) return false;
  if (spansCross(t, axis, Math.min(from, to), Math.max(from, to))) return false;
  const move = (arr) => {
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
  };
  if (axis === 'row') {
    move(t.cells);
    move(t.rows);
  } else {
    for (const row of t.cells) move(row);
    move(t.cols);
    move(t.colFmt);
  }
  for (const row of t.cells) for (const cell of row) if (cell.v && cell.v.charCodeAt(0) === 61) cell.v = moveFormula(cell.v, { axis, from, to });
  normalizeMerges(t);
  return true;
}

/** Duplicates a row / column (content included) right after itself. */
export function duplicateLine(t, axis, at) {
  const info = axisInfo(axis);
  if (spansCross(t, axis, at, at)) return false;
  if (!insertLines(t, axis, at + 1, 1, { like: at })) return false;
  const cross = count(t, axis === 'row' ? 'col' : 'row');
  for (let j = 0; j < cross; j++) {
    const src = getCell(t, axis, at, j);
    const dst = getCell(t, axis, at + 1, j);
    const copy = cloneJson(src);
    delete copy.m;
    delete copy[info.span];
    // formulas shift like a copy-paste would not; keep the text so SUMs stay valid
    setCell(t, axis, at + 1, j, copy);
  }
  normalizeMerges(t);
  return true;
}

/** Makes columns `c0..c1` (or rows) equally wide / tall, keeping their total size. */
export function distribute(t, axis, from, to) {
  const arr = axis === 'row' ? t.rows : t.cols;
  from = Math.max(0, from);
  to = Math.min(arr.length - 1, to);
  if (to <= from) return false;
  let sum = 0;
  for (let i = from; i <= to; i++) sum += arr[i];
  const each = sum / (to - from + 1);
  for (let i = from; i <= to; i++) arr[i] = each;
  return true;
}

/** Sets a column width / row height. `shiftNext` keeps the table width by taking the difference from the next line. */
export function resizeLine(t, axis, i, size, { shiftNext = false, min = 12 } = {}) {
  const arr = axis === 'row' ? t.rows : t.cols;
  if (i < 0 || i >= arr.length) return false;
  size = Math.max(min, size);
  if (shiftNext && i + 1 < arr.length) {
    const pair = arr[i] + arr[i + 1];
    size = Math.min(size, pair - min);
    arr[i + 1] = pair - size;
  }
  arr[i] = size;
  return true;
}

// ------------------------------------------------------------------------------------------------ evaluation

/** A formula sheet over the raw cell text of a table. */
export function evalTable(t) {
  return createSheet((r, c) => t.cells[r]?.[c]?.v, t.rows.length, t.cols.length);
}

/**
 * Display information of a cell.
 * @returns {{text:string, value:any, number:boolean, error:string|null}}
 */
export function cellDisplay(t, sheet, r, c) {
  const cell = t.cells[r][c];
  const value = sheet.value(r, c);
  if (isError(value)) return { text: value.code, value, number: false, error: value.code };
  const header = r < t.headerRows || c < t.headerCols;
  const fmt = cell.fmt || (!header ? t.colFmt?.[c] : null) || null;
  const isFormula = typeof cell.v === 'string' && cell.v.charCodeAt(0) === 61 && cell.v.length > 1;
  const numeric = typeof value === 'number';
  let text;
  if (fmt && fmt.type && fmt.type !== 'auto') text = formatValue(value, fmt);
  else if (isFormula) text = value == null ? '' : typeof value === 'number' ? plainNumber(value) : formatValue(value, fmt);
  else text = cell.v;
  return { text, value, number: numeric, error: null };
}

/** Evaluated values as a matrix (numbers stay numbers, errors become their code text). */
export function tableValues(t) {
  const sheet = evalTable(t);
  return t.cells.map((row, r) => row.map((_, c) => {
    const v = sheet.value(r, c);
    return isError(v) ? v.code : v;
  }));
}

/** Display text matrix (formats applied). */
export function tableDisplay(t) {
  const sheet = evalTable(t);
  return t.cells.map((row, r) => row.map((_, c) => (t.cells[r][c].m ? '' : cellDisplay(t, sheet, r, c).text)));
}

// ------------------------------------------------------------------------------------------------ sorting

const isEmpty = (v) => v == null || v === '';

/**
 * Sorts the body rows (below the header rows) by a column. Numbers sort before text; empty cells always last.
 * Formulas referring to cells of their own row keep working. Fails when merged cells span body rows.
 * @returns {boolean|string} true, or an error message
 */
export function sortRows(t, col, dir = 'asc') {
  const start = t.headerRows;
  const end = t.rows.length;
  if (end - start < 2) return 'There is nothing to sort.';
  if (spansCross(t, 'row', start, end - 1)) return 'Cells merged across rows cannot be sorted. Split them first.';
  const sheet = evalTable(t);
  const items = [];
  for (let r = start; r < end; r++) items.push({ r, v: sheet.value(r, col) });
  const sign = dir === 'desc' ? -1 : 1;
  items.sort((a, b) => {
    const ae = isEmpty(a.v) || isError(a.v);
    const be = isEmpty(b.v) || isError(b.v);
    if (ae || be) return ae && be ? a.r - b.r : ae ? 1 : -1;
    const an = typeof a.v === 'number';
    const bn = typeof b.v === 'number';
    let d;
    if (an && bn) d = a.v - b.v;
    else if (an !== bn) d = an ? -1 : 1;
    else d = String(a.v).localeCompare(String(b.v), 'en', { sensitivity: 'base', numeric: true });
    return d === 0 ? a.r - b.r : d * sign;
  });
  const oldCells = t.cells.slice(start, end);
  const oldRows = t.rows.slice(start, end);
  items.forEach((it, i) => {
    const newR = start + i;
    const cells = oldCells[it.r - start];
    for (const cell of cells) {
      if (cell.v && cell.v.charCodeAt(0) === 61 && newR !== it.r) cell.v = rewriteRefs(cell.v, (ref) => (ref.r === it.r ? { r: newR, c: ref.c } : { r: ref.r, c: ref.c }));
    }
    t.cells[newR] = cells;
    t.rows[newR] = oldRows[it.r - start];
  });
  normalizeMerges(t);
  return true;
}

// ------------------------------------------------------------------------------------------------ data in / out

/** Quotes one CSV field when needed. */
const q = (s, d) => (/["\r\n]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Serializes a matrix to CSV / TSV text.
 * @param {(string|number|null)[][]} matrix
 * @param {string} [delimiter=',']
 */
export function matrixToDelimited(matrix, delimiter = ',') {
  return matrix.map((row) => row.map((v) => q(v == null ? '' : typeof v === 'number' ? plainNumber(v) : String(v), delimiter)).join(delimiter)).join('\n');
}

/**
 * Exports a table (or a rectangle of it) as CSV / TSV. `mode`: `'values'` (formula results, default),
 * `'display'` (formatted like on the page) or `'raw'` (formulas as typed).
 */
export function tableToCSV(t, { delimiter = ',', mode = 'values', rect } = {}) {
  const g = rect ? expandRect(t, rect) : { r0: 0, c0: 0, r1: t.rows.length - 1, c1: t.cols.length - 1 };
  const matrix = mode === 'raw' ? t.cells.map((row) => row.map((c) => c.v)) : mode === 'display' ? tableDisplay(t) : tableValues(t);
  const out = [];
  for (let r = g.r0; r <= g.r1; r++) out.push(matrix[r].slice(g.c0, g.c1 + 1));
  return matrixToDelimited(out, delimiter);
}

/**
 * Parses CSV / TSV text (delimiter detected unless given) into a rectangular string matrix.
 * @param {string} text
 * @param {{delimiter?:string}} [o]
 */
export function parseTextMatrix(text, o = {}) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const delimiter = o.delimiter && o.delimiter !== 'auto' ? o.delimiter : detectDelimiter(src);
  const rows = parseDelimited(src, { delimiter, skipEmptyLines: true });
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? r.concat(Array(width - r.length).fill('')) : r));
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decodeEntities = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (ENT[e.toLowerCase()] !== undefined) return ENT[e.toLowerCase()];
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  }
  return m;
});

/**
 * Extracts the first `<table>` of an HTML fragment (spreadsheets put one on the clipboard) as a string matrix.
 * Handles `colspan` / `rowspan` by repeating nothing (the covered cells stay empty). Returns `null` when the
 * fragment has no table. Regex based on purpose: no DOM needed and no markup is ever inserted anywhere.
 * @param {string} html
 * @returns {string[][]|null}
 */
export function parseHtmlTable(html) {
  const m = /<table[\s\S]*?<\/table>/i.exec(String(html));
  if (!m) return null;
  const rows = [];
  const rowRe = /<tr[\s\S]*?(?:<\/tr>|(?=<tr)|$)/gi;
  const carry = []; // rowspans still covering columns: carry[c] = remaining rows
  let rm;
  while ((rm = rowRe.exec(m[0]))) {
    const row = [];
    let c = 0;
    const fillCarry = () => {
      while (carry[c] > 0) {
        carry[c]--;
        row[c] = '';
        c++;
      }
    };
    const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)(?:<\/\1>|(?=<t[dh]\b)|$)/gi;
    let cm;
    while ((cm = cellRe.exec(rm[0]))) {
      fillCarry();
      const attrs = cm[2];
      const cs = Math.min(60, parseInt(/colspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] || '1', 10) || 1);
      const rs = Math.min(500, parseInt(/rowspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] || '1', 10) || 1);
      const text = decodeEntities(stripTagsStable(cm[3].replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n'))).replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
      row[c] = text;
      for (let k = 1; k < cs; k++) row[c + k] = '';
      if (rs > 1) for (let k = 0; k < cs; k++) carry[c + k] = rs - 1;
      c += cs;
    }
    fillCarry();
    if (row.length) rows.push(Array.from(row, (x) => x ?? ''));
  }
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? r.concat(Array(width - r.length).fill('')) : r));
}

/** True when pasted plain text looks like a table (several lines with tabs, or consistent delimiters). */
export function looksTabular(text) {
  const t = String(text).replace(/\r\n?/g, '\n').trim();
  if (!t.includes('\n') && !t.includes('\t')) return false;
  const lines = t.split('\n').filter(Boolean);
  if (lines.length >= 2 && lines.filter((l) => l.includes('\t')).length >= Math.ceil(lines.length * 0.8)) return true;
  if (lines.length >= 2 && lines.length <= 5000) {
    const rows = parseTextMatrix(t);
    return rows.length >= 2 && rows[0].length >= 2 && !t.includes('\t') && (t.match(/[;,|]/g) || []).length >= lines.length;
  }
  return false;
}

/**
 * Writes a matrix into the table starting at `(r0, c0)`, adding rows / columns as needed. Cells covered by a
 * merge are skipped. Returns the rectangle that was written.
 */
export function pasteMatrix(t, r0, c0, matrix, { expand = true } = {}) {
  if (!matrix.length) return null;
  const h = matrix.length;
  const w = Math.max(...matrix.map((r) => r.length));
  if (expand) {
    if (r0 + h > t.rows.length) insertLines(t, 'row', t.rows.length, Math.min(MAX_ROWS - t.rows.length, r0 + h - t.rows.length), { like: t.rows.length - 1 });
    if (c0 + w > t.cols.length) insertLines(t, 'col', t.cols.length, Math.min(MAX_COLS - t.cols.length, c0 + w - t.cols.length), { like: t.cols.length - 1 });
  }
  let r1 = r0;
  let c1 = c0;
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const r = r0 + i;
      const c = c0 + j;
      if (r >= t.rows.length || c >= t.cols.length) continue;
      const cell = t.cells[r][c];
      if (cell.m) continue;
      cell.v = matrix[i][j] == null ? '' : String(matrix[i][j]);
      r1 = Math.max(r1, r);
      c1 = Math.max(c1, c);
    }
  }
  return { r0, c0, r1, c1 };
}

/** Rectangular selection text for the clipboard (TSV of raw values, merged-cell safe). */
export function copyRect(t, rect) {
  const g = expandRect(t, rect);
  const out = [];
  for (let r = g.r0; r <= g.r1; r++) {
    const row = [];
    for (let c = g.c0; c <= g.c1; c++) row.push(t.cells[r][c].m ? '' : t.cells[r][c].v);
    out.push(row);
  }
  return out;
}

/** HTML table text of a matrix (for the clipboard, so spreadsheets and word processors accept it). */
export function matrixToHtml(matrix, { headerRows = 0 } = {}) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<table>${matrix.map((row, r) => `<tr>${row.map((v) => `<${r < headerRows ? 'th' : 'td'}>${esc(v == null ? '' : v)}</${r < headerRows ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`;
}

// ------------------------------------------------------------------------------------------------ pagination

/**
 * Splits rows into page chunks. `heights` are the rendered row heights. The first chunk may use `first`
 * pixels, the following ones `next` pixels; `headerRows` rows are repeated on every continuation chunk.
 * Rows that belong to a vertically merged cell stay together. Returns `[{from, to}]` with `to` exclusive.
 * @param {object} t table model
 * @param {number[]} heights
 * @param {number} first
 * @param {number} next
 * @param {{repeatHeader?:boolean}} [o]
 */
export function paginateRows(t, heights, first, next, { repeatHeader = true } = {}) {
  const R = t.rows.length;
  const hdr = repeatHeader ? t.headerRows : 0;
  const hdrH = heights.slice(0, hdr).reduce((a, b) => a + b, 0);
  // blocks: rows glued together by row spans
  const blockEnd = Array.from({ length: R }, (_, i) => i);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < t.cols.length; c++) {
      const cell = t.cells[r][c];
      if (!cell.m && cell.rs > 1) for (let k = r; k < r + cell.rs; k++) blockEnd[k] = Math.max(blockEnd[k], r + cell.rs - 1);
    }
  }
  const chunks = [];
  let from = 0;
  let used = 0;
  let avail = first;
  let r = 0;
  while (r < R) {
    let end = r;
    for (let k = r; k <= end; k++) end = Math.max(end, blockEnd[k]);
    let bh = 0;
    for (let k = r; k <= end; k++) bh += heights[k];
    const isFirstChunkRow = r === from;
    if (used + bh > avail && !isFirstChunkRow && r >= Math.max(hdr, 1)) {
      chunks.push({ from, to: r });
      from = r;
      used = hdrH;
      avail = next;
      continue; // re-evaluate the same block on the new chunk
    }
    used += bh;
    r = end + 1;
  }
  chunks.push({ from, to: R });
  return chunks;
}

/** Builds the model of one continuation chunk: rows `[from, to)` plus the repeated header rows. */
export function sliceRows(t, from, to, { repeatHeader = true } = {}) {
  const hdr = from > 0 && repeatHeader ? t.headerRows : 0;
  const idx = [];
  for (let r = 0; r < hdr; r++) idx.push(r);
  for (let r = from; r < to; r++) if (r >= hdr || from === 0) idx.push(r);
  const copy = cloneJson({ ...t, cells: undefined });
  copy.cells = idx.map((r) => cloneJson(t.cells[r]));
  copy.rows = idx.map((r) => t.rows[r]);
  copy.headerRows = from === 0 ? t.headerRows : hdr;
  // formulas refer to the original grid, which no longer exists after a split: keep their results as plain values
  const values = tableValues(t);
  copy.cells.forEach((row, i) => row.forEach((cell, c) => {
    if (cell.v && cell.v.charCodeAt(0) === 61) cell.v = values[idx[i]][c] == null ? '' : String(values[idx[i]][c]);
  }));
  normalizeMerges(copy);
  return copy;
}

export { parseRange, rangeName, cellName, parseNumber };
