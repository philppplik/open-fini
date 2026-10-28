// Office Toolkit: hand-drawn ("sketchy", Excalidraw-style) geometry for the whiteboard and for sketch-style charts.
// Deterministic: the same shape with the same seed always produces the same strokes, so a drawing does not "boil"
// on every repaint and two collaborators see identical lines. Clean-room implementation (seeded jitter of polylines
// with a slight bow), no third-party code. Pure; tests in tests/office/toolkit.test.js.
//
// Public API (every function returns strokes: an array of polylines, each polyline an array of [x, y])
//   rng(seed) → () => number in [0, 1)              mulberry32
//   roughLine(x1, y1, x2, y2, opts) → strokes        two overlapping, slightly bowed passes
//   roughPolyline(points, opts) / roughPolygon(points, opts)
//   roughRect(x, y, w, h, opts)
//   roughEllipse(cx, cy, rx, ry, opts)
//   hachure(points, opts) → strokes                  parallel fill lines clipped to a polygon (gap, angle)
//   strokesToPath(strokes) → SVG path data "M … L …"
//   drawStrokes(ctx, strokes)                         Canvas2D: one path, caller sets stroke style and calls stroke()
// opts: { seed = 1, roughness = 1 (0 = straight), bowing = 1, passes = 2, gap = 8, angle = -41 (hachure degrees) }
// Invariants: output coordinates are finite; roughness 0 returns the exact geometry (one pass).

export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const opt = (o = {}) => ({ seed: 1, roughness: 1, bowing: 1, passes: 2, gap: 8, angle: -41, ...o });

function pass(x1, y1, x2, y2, o, rand, k) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (o.roughness <= 0 || len === 0) return [[x1, y1], [x2, y2]];
  const amp = Math.min(len / 10, 2 + len / 40) * o.roughness * (k ? 1.3 : 1);
  const j = () => (rand() - 0.5) * 2 * amp;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const bow = (rand() - 0.5) * o.bowing * o.roughness * len * 0.04;
  const pts = [];
  const steps = Math.max(2, Math.min(8, Math.round(len / 60) + 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const b = Math.sin(Math.PI * t) * bow;
    const end = i === 0 || i === steps;
    const jx = end ? j() * 0.5 : j() * 0.25;
    const jy = end ? j() * 0.5 : j() * 0.25;
    pts.push([x1 + (x2 - x1) * t + nx * b + jx, y1 + (y2 - y1) * t + ny * b + jy]);
  }
  return pts;
}

export function roughLine(x1, y1, x2, y2, o = {}) {
  const p = opt(o);
  const rand = rng(p.seed);
  if (p.roughness <= 0) return [[[x1, y1], [x2, y2]]];
  return Array.from({ length: Math.max(1, p.passes) }, (_, k) => pass(x1, y1, x2, y2, p, rand, k));
}

export function roughPolyline(points, o = {}) {
  const p = opt(o);
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) out.push(...roughLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], { ...p, seed: p.seed + i * 7919 }));
  return out;
}

export function roughPolygon(points, o = {}) {
  return points.length < 2 ? [] : roughPolyline([...points, points[0]], o);
}

export function roughRect(x, y, w, h, o = {}) {
  return roughPolygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], o);
}

export function roughEllipse(cx, cy, rx, ry, o = {}) {
  const p = opt(o);
  const rand = rng(p.seed);
  const n = Math.max(12, Math.min(48, Math.round((Math.abs(rx) + Math.abs(ry)) / 6)));
  const strokes = [];
  for (let k = 0; k < Math.max(1, p.roughness <= 0 ? 1 : p.passes); k++) {
    const pts = [];
    const start = p.roughness <= 0 ? 0 : rand() * Math.PI * 2;
    const overlap = p.roughness <= 0 ? 0 : 0.15 + rand() * 0.2; // the pen overshoots where the loop closes
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * (Math.PI * 2 + overlap);
      const wob = p.roughness <= 0 ? 1 : 1 + (rand() - 0.5) * 0.06 * p.roughness;
      pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
    }
    strokes.push(pts);
  }
  return strokes;
}

/** Parallel hatch lines inside a polygon (even-odd), each drawn rough. */
export function hachure(points, o = {}) {
  const p = opt(o);
  if (points.length < 3 || p.gap <= 0) return [];
  const a = (p.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // rotate the polygon so hatch lines become horizontal scanlines
  const rot = points.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
  const ys = rot.map((q) => q[1]);
  const out = [];
  let i = 0;
  for (let y = Math.min(...ys) + p.gap / 2; y < Math.max(...ys); y += p.gap) {
    const xs = [];
    for (let k = 0; k < rot.length; k++) {
      const [x1, y1] = rot[k];
      const [x2, y2] = rot[(k + 1) % rot.length];
      if (y1 === y2 || y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
      xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const back = ([x, yy]) => [x * cos - yy * sin, x * sin + yy * cos];
      const [ax, ay] = back([xs[k], y]);
      const [bx, by] = back([xs[k + 1], y]);
      out.push(...roughLine(ax, ay, bx, by, { ...p, passes: 1, seed: p.seed + ++i * 104729 }));
    }
  }
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
export function strokesToPath(strokes) {
  return strokes.map((s) => s.map(([x, y], i) => `${i ? "L" : "M"}${r2(x)} ${r2(y)}`).join(" ")).join(" ");
}

export function drawStrokes(ctx, strokes) {
  ctx.beginPath();
  for (const s of strokes) {
    s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  }
}
