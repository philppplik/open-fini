// Snapping and smart guides of the Proto Studio tools (docs/concepts/proto-studio.md §5.2): a moving or resizing rect
// snaps its edges and center to the edges and centers of its siblings and its parent, guide lines show what it
// snapped to, and distance labels show the gaps to the nearest neighbors. Everything comes from the geometry cache
// (world units); nothing reads the DOM. Pure, unit tested (tests/proto/snap.test.js).
//
// Public API
//   snapTargets(boxes) → { xs, ys }                     candidate lines: [{ v, box }]
//   snapRect(rect, targets, tol, { x, y }) → { dx, dy, guides }
//       x / y: the edges of `rect` that may snap on that axis (subset of ["start", "center", "end"]; [] = none)
//       guides: [{ axis: "x"|"y", v, from, to }] lines through the snapped positions after applying dx, dy
//   edgesFor(handle) → { x, y }                         the edges a resize handle moves
//   distances(rect, boxes, parent?) → [{ x1, y1, x2, y2, value }]   gaps to the nearest neighbor on every side
//   roundRect(rect) → rect with whole-pixel position and size (the pixel grid)

/** Candidate snap lines: the edges and centers of `boxes`. */
export function snapTargets(boxes) {
  const xs = [];
  const ys = [];
  for (const b of boxes) {
    if (!b || !(b.w >= 0) || !(b.h >= 0)) continue;
    xs.push({ v: b.x, box: b }, { v: b.x + b.w / 2, box: b }, { v: b.x + b.w, box: b });
    ys.push({ v: b.y, box: b }, { v: b.y + b.h / 2, box: b }, { v: b.y + b.h, box: b });
  }
  return { xs, ys };
}

const ALL = ["start", "center", "end"];
const at = (r, axis, edge) => {
  const p = axis === "x" ? r.x : r.y;
  const s = axis === "x" ? r.w : r.h;
  return edge === "start" ? p : edge === "center" ? p + s / 2 : p + s;
};

function best(rect, axis, edges, list, tol) {
  let d = Infinity;
  for (const e of edges) {
    const v = at(rect, axis, e);
    for (const t of list) {
      const diff = t.v - v;
      if (Math.abs(diff) <= tol && Math.abs(diff) < Math.abs(d)) d = diff;
    }
  }
  return Number.isFinite(d) ? d : 0;
}

/**
 * Snaps `rect` to `targets` within `tol` (world units). Returns the offset to apply and the guides to draw. Guides are
 * computed after the offset: every target line that an edge of the moved rect lies on (within 0.5 px).
 */
export function snapRect(rect, targets, tol, { x = ALL, y = ALL } = {}) {
  const dx = x.length ? best(rect, "x", x, targets.xs, tol) : 0;
  const dy = y.length ? best(rect, "y", y, targets.ys, tol) : 0;
  const moved = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
  const guides = [];
  const lines = (axis, edges, list, snapped) => {
    if (!snapped) return;
    const seen = new Map();
    for (const e of edges) {
      const v = at(moved, axis, e);
      for (const t of list) {
        if (Math.abs(t.v - v) > 0.5) continue;
        const b = t.box;
        const lo = axis === "x" ? Math.min(moved.y, b.y) : Math.min(moved.x, b.x);
        const hi = axis === "x" ? Math.max(moved.y + moved.h, b.y + b.h) : Math.max(moved.x + moved.w, b.x + b.w);
        const k = Math.round(v * 100);
        const g = seen.get(k);
        if (g) (g.from = Math.min(g.from, lo)), (g.to = Math.max(g.to, hi));
        else seen.set(k, { axis, v, from: lo, to: hi });
      }
    }
    guides.push(...seen.values());
  };
  lines("x", x, targets.xs, dx !== 0 || x.length > 0);
  lines("y", y, targets.ys, dy !== 0 || y.length > 0);
  return { dx, dy, guides };
}

/** The edges of a rect that a resize handle moves, as snapRect options. */
export function edgesFor(handle) {
  const x = handle.includes("w") ? ["start"] : handle.includes("e") ? ["end"] : [];
  const y = handle.includes("n") ? ["start"] : handle.includes("s") ? ["end"] : [];
  return { x, y };
}

const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Distance labels: for each side of `rect`, the gap to the nearest box in `boxes` that overlaps it on the other axis,
 * or (when `parent` contains the rect and nothing is closer) the gap to the parent's edge.
 */
export function distances(rect, boxes, parent = null) {
  const out = [];
  const x0 = rect.x;
  const x1 = rect.x + rect.w;
  const y0 = rect.y;
  const y1 = rect.y + rect.h;
  const side = (dir) => {
    let bestGap = Infinity;
    let line = null;
    for (const b of boxes) {
      if (!b) continue;
      const bx1 = b.x + b.w;
      const by1 = b.y + b.h;
      if (dir === "left" || dir === "right") {
        const ov = overlap(y0, y1, b.y, by1);
        if (ov <= 0) continue;
        const gap = dir === "left" ? x0 - bx1 : b.x - x1;
        if (gap < 0 || gap >= bestGap) continue;
        const y = Math.max(y0, b.y) + ov / 2;
        bestGap = gap;
        line = dir === "left" ? { x1: bx1, y1: y, x2: x0, y2: y } : { x1: x1, y1: y, x2: b.x, y2: y };
      } else {
        const ov = overlap(x0, x1, b.x, bx1);
        if (ov <= 0) continue;
        const gap = dir === "top" ? y0 - by1 : b.y - y1;
        if (gap < 0 || gap >= bestGap) continue;
        const x = Math.max(x0, b.x) + ov / 2;
        bestGap = gap;
        line = dir === "top" ? { x1: x, y1: by1, x2: x, y2: y0 } : { x1: x, y1: y1, x2: x, y2: b.y };
      }
    }
    if (!line && parent && x0 >= parent.x && x1 <= parent.x + parent.w && y0 >= parent.y && y1 <= parent.y + parent.h) {
      const cy = y0 + rect.h / 2;
      const cx = x0 + rect.w / 2;
      if (dir === "left") line = { x1: parent.x, y1: cy, x2: x0, y2: cy };
      else if (dir === "right") line = { x1: x1, y1: cy, x2: parent.x + parent.w, y2: cy };
      else if (dir === "top") line = { x1: cx, y1: parent.y, x2: cx, y2: y0 };
      else line = { x1: cx, y1: y1, x2: cx, y2: parent.y + parent.h };
    }
    if (!line) return;
    const value = r2(Math.hypot(line.x2 - line.x1, line.y2 - line.y1));
    if (value > 0) out.push({ ...line, value, side: dir });
  };
  for (const d of ["left", "right", "top", "bottom"]) side(d);
  return out;
}

/** The rect on the pixel grid: whole-pixel position and size. */
export const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.max(0, Math.round(r.w)), h: Math.max(0, Math.round(r.h)) });
