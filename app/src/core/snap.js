// Snapping: page edges, margins, guides, grid and the edges/centers of other objects.
import { localBounds, worldMatrix } from "./nodes.js";
import { rectTransform } from "./math.js";

/**
 * Collects snap lines (page space) for the active page.
 * @param {import('./doc.js').Doc} doc
 * @param {object} page
 * @param {{exclude?:Set<object>, area?:{x,y,w,h}, group?:object}} [o]
 */
export function collectTargets(doc, page, { exclude = new Set(), area = null, group = null } = {}) {
  const xs = [];
  const ys = [];
  const s = doc.settings;
  if (s.snap === false) return { xs, ys };
  // page edges and center
  xs.push({ v: 0, k: "page" }, { v: page.w / 2, k: "page" }, { v: page.w, k: "page" });
  ys.push({ v: 0, k: "page" }, { v: page.h / 2, k: "page" }, { v: page.h, k: "page" });
  const m = page.margins;
  if (m && (m.left || m.right || m.top || m.bottom)) {
    xs.push({ v: m.left, k: "margin" }, { v: page.w - m.right, k: "margin" });
    ys.push({ v: m.top, k: "margin" }, { v: page.h - m.bottom, k: "margin" });
    if (page.columns > 1) {
      const inner = page.w - m.left - m.right;
      const colW = (inner - page.gutter * (page.columns - 1)) / page.columns;
      for (let i = 0; i < page.columns; i++) {
        const x0 = m.left + i * (colW + page.gutter);
        xs.push({ v: x0, k: "column" }, { v: x0 + colW, k: "column" });
      }
    }
  }
  for (const g of page.guides.v) xs.push({ v: g, k: "guide" });
  for (const g of page.guides.h) ys.push({ v: g, k: "guide" });
  if (s.snapGrid && s.grid) {
    const step = s.grid.size / (s.grid.subdivisions || 1);
    if (area) {
      for (let x = Math.floor(area.x / step) * step; x <= area.x + area.w; x += step) xs.push({ v: x, k: "grid" });
      for (let y = Math.floor(area.y / step) * step; y <= area.y + area.h; y += step) ys.push({ v: y, k: "grid" });
    }
  }
  if (s.snapObjects !== false) {
    const root = group || page.root;
    const pw = worldMatrix(root);
    let count = 0;
    for (const n of root.children) {
      if (!n.visible || exclude.has(n)) continue;
      const b = localBounds(n);
      if (!b) continue;
      const r = rectTransform(b, [pw[0] * n.m[0] + pw[2] * n.m[1], pw[1] * n.m[0] + pw[3] * n.m[1], pw[0] * n.m[2] + pw[2] * n.m[3], pw[1] * n.m[2] + pw[3] * n.m[3], pw[0] * n.m[4] + pw[2] * n.m[5] + pw[4], pw[1] * n.m[4] + pw[3] * n.m[5] + pw[5]]);
      if (area && (r.x > area.x + area.w || r.x + r.w < area.x || r.y > area.y + area.h || r.y + r.h < area.y)) continue;
      xs.push({ v: r.x, k: "object" }, { v: r.x + r.w / 2, k: "object" }, { v: r.x + r.w, k: "object" });
      ys.push({ v: r.y, k: "object" }, { v: r.y + r.h / 2, k: "object" }, { v: r.y + r.h, k: "object" });
      if (++count > 300) break;
    }
  }
  return { xs, ys };
}

function best(values, targets, thr) {
  let bd = thr + 1e-9;
  let delta = 0;
  let line = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t.v - v;
      if (Math.abs(d) < Math.abs(bd) - 1e-9 || (Math.abs(d) <= Math.abs(bd) && line === null)) {
        if (Math.abs(d) <= thr) {
          bd = d;
          delta = d;
          line = t;
        }
      }
    }
  }
  return line ? { delta, line } : null;
}

/** Snaps a rectangle's edges/center. Returns {dx, dy, lines:[{axis,v}]}. */
export function snapRect(rect, targets, thr) {
  const out = { dx: 0, dy: 0, lines: [] };
  const sx = best([rect.x, rect.x + rect.w / 2, rect.x + rect.w], targets.xs, thr);
  const sy = best([rect.y, rect.y + rect.h / 2, rect.y + rect.h], targets.ys, thr);
  if (sx) {
    out.dx = sx.delta;
    out.lines.push({ axis: "x", v: sx.line.v });
  }
  if (sy) {
    out.dy = sy.delta;
    out.lines.push({ axis: "y", v: sy.line.v });
  }
  return out;
}

/** Snaps a single point. Returns {x, y, lines}. */
export function snapPoint(x, y, targets, thr) {
  const sx = best([x], targets.xs, thr);
  const sy = best([y], targets.ys, thr);
  const lines = [];
  if (sx) lines.push({ axis: "x", v: sx.line.v });
  if (sy) lines.push({ axis: "y", v: sy.line.v });
  return { x: sx ? x + sx.delta : x, y: sy ? y + sy.delta : y, lines };
}
