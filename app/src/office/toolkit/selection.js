// Office Toolkit: selection model utilities for grid-like apps (spreadsheet cells, table cells, slide/board item
// sets). Pure (no DOM); tests in tests/office/toolkit.test.js.
//
// Public API
//   colName(i) → "A" .. "Z", "AA" …          (0-based column index)
//   colIndex("AB") → 27
//   parseRef("B3") → { r: 2, c: 1 } | null     ("$B$3" is accepted; rows/cols 0-based)
//   formatRef({ r, c }) → "B3"
//   parseRange("A1:C4") → { r0, c0, r1, c1 } | null   (single refs become 1x1 ranges; order is normalized)
//   formatRange(range) → "A1:C4" ("A1" for one cell)
//   normRange({ r0, c0, r1, c1 }) → ordered range;  rangeSize(range) → { rows, cols, cells }
//   inRange(range, r, c) → boolean;  clampCell({ r, c }, { rows, cols })
//   moveCell(cell, dir, { rows, cols }, step?) → cell   dir: up | down | left | right | home | end
//   extendRange(anchor, focus) → range          (shift+arrow selection)
//   createItemSelection() → { ids, has, set, toggle, add, clear, size }   for slide/board items
// Invariants: indexes are integers ≥ 0; ranges are always normalized (r0 ≤ r1, c0 ≤ c1) on output.

export function colName(i) {
  let n = Math.max(0, Math.floor(i)) + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(name) {
  let n = 0;
  for (const ch of String(name).toUpperCase()) {
    const v = ch.charCodeAt(0) - 64;
    if (v < 1 || v > 26) return -1;
    n = n * 26 + v;
  }
  return n - 1;
}

const REF = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;
export function parseRef(s) {
  const m = REF.exec(String(s).trim());
  if (!m) return null;
  const r = Number(m[2]) - 1;
  const c = colIndex(m[1]);
  return r >= 0 && c >= 0 ? { r, c } : null;
}

export const formatRef = ({ r, c }) => `${colName(c)}${r + 1}`;

export function normRange({ r0, c0, r1 = r0, c1 = c0 }) {
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

export function parseRange(s) {
  const [a, b] = String(s).split(":");
  const p = parseRef(a);
  const q = b === undefined ? p : parseRef(b);
  return p && q ? normRange({ r0: p.r, c0: p.c, r1: q.r, c1: q.c }) : null;
}

export function formatRange(range) {
  const g = normRange(range);
  const a = formatRef({ r: g.r0, c: g.c0 });
  return g.r0 === g.r1 && g.c0 === g.c1 ? a : `${a}:${formatRef({ r: g.r1, c: g.c1 })}`;
}

export function rangeSize(range) {
  const g = normRange(range);
  const rows = g.r1 - g.r0 + 1;
  const cols = g.c1 - g.c0 + 1;
  return { rows, cols, cells: rows * cols };
}

export const inRange = (range, r, c) => r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;

export function clampCell({ r, c }, { rows = Infinity, cols = Infinity } = {}) {
  return { r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) };
}

export function moveCell(cell, dir, bounds = {}, step = 1) {
  const d = { up: [-step, 0], down: [step, 0], left: [0, -step], right: [0, step] }[dir];
  if (d) return clampCell({ r: cell.r + d[0], c: cell.c + d[1] }, bounds);
  if (dir === "home") return { r: cell.r, c: 0 };
  if (dir === "end") return clampCell({ r: cell.r, c: (bounds.cols ?? cell.c + 1) - 1 }, bounds);
  return { ...cell };
}

export const extendRange = (anchor, focus) => normRange({ r0: anchor.r, c0: anchor.c, r1: focus.r, c1: focus.c });

/** A set of selected item ids (slides, shapes, sticky notes) with the usual click / shift-click semantics. */
export function createItemSelection(initial = []) {
  let ids = [...new Set(initial)];
  return {
    get ids() {
      return ids.slice();
    },
    get size() {
      return ids.length;
    },
    has: (id) => ids.includes(id),
    set(list) {
      ids = [...new Set(list)];
    },
    add(id) {
      if (!ids.includes(id)) ids.push(id);
    },
    toggle(id) {
      ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    },
    clear() {
      ids = [];
    },
  };
}
