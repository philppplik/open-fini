// Node-based vector paths (VPath) — see docs/engine-contracts.md §1.3.
// A VPath is {subpaths:[{closed, nodes:[{x,y,ix,iy,ox,oy,t?}]}]} where handles are ABSOLUTE.
import { apply, pointSegment } from "../../core/math.js";

export const KAPPA = 0.5522847498307936;

export const makeNode = (x, y, ix = null, iy = null, ox = null, oy = null, t) => {
  const n = { x, y, ix, iy, ox, oy };
  if (t) n.t = t;
  return n;
};
export const emptyPath = () => ({ subpaths: [] });
export const polylineSubpath = (pts, closed = false) => ({
  closed,
  nodes: pts.map((p) => makeNode(p[0], p[1])),
});

export function clonePath(p) {
  return {
    subpaths: p.subpaths.map((s) => ({
      closed: s.closed,
      nodes: s.nodes.map((n) => ({ ...n })),
    })),
  };
}

export const nodeCount = (p) => p.subpaths.reduce((a, s) => a + s.nodes.length, 0);

export function transformPath(p, m) {
  const tp = (x, y) => apply(m, x, y);
  return {
    subpaths: p.subpaths.map((s) => ({
      closed: s.closed,
      nodes: s.nodes.map((n) => {
        const [x, y] = tp(n.x, n.y);
        const out = { x, y, ix: null, iy: null, ox: null, oy: null };
        if (n.ix != null) [out.ix, out.iy] = tp(n.ix, n.iy);
        if (n.ox != null) [out.ox, out.oy] = tp(n.ox, n.oy);
        if (n.t) out.t = n.t;
        return out;
      }),
    })),
  };
}

// ---------------------------------------------------------------- path data

function seg(a, b, out) {
  const ha = a.ox != null;
  const hb = b.ix != null;
  if (!ha && !hb) out.push(["L", b.x, b.y]);
  else out.push(["C", ha ? a.ox : a.x, ha ? a.oy : a.y, hb ? b.ix : b.x, hb ? b.iy : b.y, b.x, b.y]);
}

/** Converts a VPath to display-list PathData (M/L/C/Z), optionally transformed. */
export function pathToData(p, m) {
  const src = m ? transformPath(p, m) : p;
  const out = [];
  for (const s of src.subpaths) {
    const n = s.nodes;
    if (!n.length) continue;
    out.push(["M", n[0].x, n[0].y]);
    for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i], out);
    if (s.closed) {
      if (n.length > 1 && (n[n.length - 1].ox != null || n[0].ix != null)) seg(n[n.length - 1], n[0], out);
      out.push(["Z"]);
    }
  }
  return out;
}

/** Builds a Path2D (browser only) from PathData. */
export function dataToPath2D(d) {
  const p = new Path2D();
  for (const c of d) {
    switch (c[0]) {
      case "M": p.moveTo(c[1], c[2]); break;
      case "L": p.lineTo(c[1], c[2]); break;
      case "C": p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break;
      case "Q": p.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
      case "Z": p.closePath(); break;
    }
  }
  return p;
}

/** Converts PathData into SVG path syntax. */
export function dataToSvgD(d, precision = 3) {
  const f = (v) => {
    const s = (+v.toFixed(precision)).toString();
    return s === "-0" ? "0" : s;
  };
  let out = "";
  for (const c of d) {
    if (c[0] === "Z") out += "Z";
    else out += c[0] + c.slice(1).map(f).join(" ");
  }
  return out;
}
export const pathToSvgD = (p, m, precision) => dataToSvgD(pathToData(p, m), precision);

/** PathData (absolute M/L/C/Q/Z) → VPath. Quadratics are promoted to cubics. */
export function dataToPath(d) {
  const subs = [];
  let cur = null;
  let last = null;
  for (const c of d) {
    if (c[0] === "M") {
      cur = { closed: false, nodes: [makeNode(c[1], c[2])] };
      subs.push(cur);
      last = cur.nodes[0];
    } else if (c[0] === "L" && cur) {
      last = makeNode(c[1], c[2]);
      cur.nodes.push(last);
    } else if ((c[0] === "C" || c[0] === "Q") && cur) {
      let c1x;
      let c1y;
      let c2x;
      let c2y;
      let x;
      let y;
      if (c[0] === "C") [c1x, c1y, c2x, c2y, x, y] = c.slice(1);
      else {
        x = c[3];
        y = c[4];
        c1x = last.x + (2 / 3) * (c[1] - last.x);
        c1y = last.y + (2 / 3) * (c[2] - last.y);
        c2x = x + (2 / 3) * (c[1] - x);
        c2y = y + (2 / 3) * (c[2] - y);
      }
      last.ox = c1x;
      last.oy = c1y;
      const n = makeNode(x, y, c2x, c2y);
      cur.nodes.push(n);
      last = n;
    } else if (c[0] === "Z" && cur) {
      cur.closed = true;
      closeDuplicate(cur);
      const first = cur.nodes[0];
      last = first;
      // next implicit subpath starts at the first node
      cur = { closed: false, nodes: [makeNode(first.x, first.y)], _implicit: true };
      subs.push(cur);
    }
  }
  const clean = subs.filter((s) => !(s._implicit && s.nodes.length < 2) && (s.nodes.length > 1 || s.closed));
  for (const s of clean) delete s._implicit;
  return { subpaths: clean };
}

/** If the final node coincides with the first on a closed subpath, merge them. */
function closeDuplicate(s) {
  if (s.nodes.length < 2) return;
  const a = s.nodes[0];
  const b = s.nodes[s.nodes.length - 1];
  if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) {
    if (b.ix != null) {
      a.ix = b.ix;
      a.iy = b.iy;
    }
    s.nodes.pop();
  }
}

// ---------------------------------------------------------------- shapes

/** Rounded rectangle; radii = number | [tl,tr,br,bl]. */
export function rectPath(w, h, radii = 0) {
  const r = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const lim = Math.min(Math.abs(w), Math.abs(h)) / 2;
  const [tl, tr, br, bl] = r.map((v) => Math.max(0, Math.min(v || 0, lim)));
  const nodes = [];
  const push = (x, y, ix, iy, ox, oy) => nodes.push(makeNode(x, y, ix, iy, ox, oy));
  const k = 1 - KAPPA;
  // clockwise from top-left exit
  if (tl > 0) push(tl, 0, tl * k, 0, null, null);
  else push(0, 0);
  if (tr > 0) {
    push(w - tr, 0, null, null, w - tr * k, 0);
    push(w, tr, w, tr * k, null, null);
  } else push(w, 0);
  if (br > 0) {
    push(w, h - br, null, null, w, h - br * k);
    push(w - br, h, w - br * k, h, null, null);
  } else push(w, h);
  if (bl > 0) {
    push(bl, h, null, null, bl * k, h);
    push(0, h - bl, 0, h - bl * k, null, null);
  } else push(0, h);
  // The top-left corner's entry node closes the loop (the first node is its exit).
  if (tl > 0) nodes.push(makeNode(0, tl, null, null, 0, tl * k));
  return { subpaths: [{ closed: true, nodes }] };
}

export function ellipsePath(w, h) {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const nodes = [
    makeNode(rx, 0, rx - kx, 0, rx + kx, 0, "symmetric"),
    makeNode(w, ry, w, ry - ky, w, ry + ky, "symmetric"),
    makeNode(rx, h, rx + kx, h, rx - kx, h, "symmetric"),
    makeNode(0, ry, 0, ry + ky, 0, ry - ky, "symmetric"),
  ];
  return { subpaths: [{ closed: true, nodes }] };
}

/** Rounds the corners of a closed polygon given as [[x,y],...]; radius in px. */
function roundedPolygon(pts, radius) {
  const n = pts.length;
  if (radius <= 0) return pts.map((p) => makeNode(p[0], p[1]));
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const v1x = p0[0] - p1[0];
    const v1y = p0[1] - p1[1];
    const v2x = p2[0] - p1[0];
    const v2y = p2[1] - p1[1];
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    const cosT = (v1x * v2x + v1y * v2y) / (l1 * l2 || 1);
    const theta = Math.acos(Math.max(-1, Math.min(1, cosT))); // interior angle
    const phi = Math.PI - theta; // turn angle
    if (phi < 1e-3) {
      nodes.push(makeNode(p1[0], p1[1]));
      continue;
    }
    let d = radius * Math.tan(phi / 2);
    const maxD = Math.min(l1, l2) / 2;
    let r = radius;
    if (d > maxD) {
      d = maxD;
      r = d / Math.tan(phi / 2);
    }
    const hl = (4 / 3) * Math.tan(phi / 4) * r;
    const e = [p1[0] + (v1x / l1) * d, p1[1] + (v1y / l1) * d];
    const x = [p1[0] + (v2x / l2) * d, p1[1] + (v2y / l2) * d];
    nodes.push(makeNode(e[0], e[1], null, null, e[0] - (v1x / l1) * hl, e[1] - (v1y / l1) * hl));
    nodes.push(makeNode(x[0], x[1], x[0] - (v2x / l2) * hl, x[1] - (v2y / l2) * hl, null, null));
  }
  return nodes;
}

function fitToBox(pts, w, h) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  const sx = maxX - minX ? w / (maxX - minX) : 1;
  const sy = maxY - minY ? h / (maxY - minY) : 1;
  return pts.map((p) => [(p[0] - minX) * sx, (p[1] - minY) * sy]);
}

/** Regular polygon with `sides` vertices fitted to a w×h box. */
export function polygonPath(w, h, sides = 5, cornerRadius = 0) {
  const n = Math.max(3, Math.round(sides));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return { subpaths: [{ closed: true, nodes: roundedPolygon(fitToBox(pts, w, h), cornerRadius) }] };
}

/** Star with `points` tips; `ratio` = inner radius / outer radius. */
export function starPath(w, h, points = 5, ratio = 0.5, cornerRadius = 0) {
  const n = Math.max(3, Math.round(points));
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? ratio : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return { subpaths: [{ closed: true, nodes: roundedPolygon(fitToBox(pts, w, h), cornerRadius) }] };
}

export function linePath(x0, y0, x1, y1) {
  return { subpaths: [{ closed: false, nodes: [makeNode(x0, y0), makeNode(x1, y1)] }] };
}

/** Speech-bubble/arrow-like presets live in shapes.js; these are primitives only. */
export function trianglePath(w, h) {
  return { subpaths: [{ closed: true, nodes: [makeNode(w / 2, 0), makeNode(w, h), makeNode(0, h)] }] };
}

// ---------------------------------------------------------------- cubic helpers

export function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

export function splitCubic(p0, p1, p2, p3, t) {
  const lerp2 = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const p01 = lerp2(p0, p1);
  const p12 = lerp2(p1, p2);
  const p23 = lerp2(p2, p3);
  const p012 = lerp2(p01, p12);
  const p123 = lerp2(p12, p23);
  const m = lerp2(p012, p123);
  return { left: [p0, p01, p012, m], right: [m, p123, p23, p3] };
}

/** Control points of the segment starting at node index i (wraps for closed subpaths). */
export function segmentPoints(sub, i) {
  const a = sub.nodes[i];
  const b = sub.nodes[(i + 1) % sub.nodes.length];
  return [
    [a.x, a.y],
    [a.ox != null ? a.ox : a.x, a.ox != null ? a.oy : a.y],
    [b.ix != null ? b.ix : b.x, b.ix != null ? b.iy : b.y],
    [b.x, b.y],
  ];
}

export const segmentCount = (sub) => (sub.closed ? sub.nodes.length : sub.nodes.length - 1);
const isStraight = (a, b) => a.ox == null && b.ix == null;

function cubicExtremaT(a, b, c, d) {
  // derivative of cubic bezier coefficient form: 3[(b-a)(1-t)^2 + 2(c-b)(1-t)t + (d-c)t^2]
  const A = -a + 3 * b - 3 * c + d;
  const B = 2 * (a - 2 * b + c);
  const C = b - a;
  const ts = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) ts.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      ts.push((-B + sq) / (2 * A), (-B - sq) / (2 * A));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

/** Exact bounding box of a VPath ({x,y,w,h}) or null when empty. */
export function pathBBox(p, m) {
  const src = m ? transformPath(p, m) : p;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const s of src.subpaths) {
    for (const n of s.nodes) add(n.x, n.y);
    const count = segmentCount(s);
    for (let i = 0; i < count; i++) {
      const a = s.nodes[i];
      const b = s.nodes[(i + 1) % s.nodes.length];
      if (isStraight(a, b)) continue;
      const [p0, p1, p2, p3] = segmentPoints(s, i);
      for (const t of cubicExtremaT(p0[0], p1[0], p2[0], p3[0])) add(...cubicAt(p0, p1, p2, p3, t));
      for (const t of cubicExtremaT(p0[1], p1[1], p2[1], p3[1])) add(...cubicAt(p0, p1, p2, p3, t));
    }
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------- flattening

function flattenCubic(p0, p1, p2, p3, tol, out) {
  const ddx = Math.max(Math.abs(p0[0] - 2 * p1[0] + p2[0]), Math.abs(p1[0] - 2 * p2[0] + p3[0]));
  const ddy = Math.max(Math.abs(p0[1] - 2 * p1[1] + p2[1]), Math.abs(p1[1] - 2 * p2[1] + p3[1]));
  const M = 6 * Math.hypot(ddx, ddy);
  const n = Math.max(1, Math.min(200, Math.ceil(Math.sqrt(M / (8 * tol)))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const [x, y] = cubicAt(p0, p1, p2, p3, t);
    out.push(x, y);
  }
}

/** Flattens to polylines: [{closed, pts:[x0,y0,x1,y1,...]}] with the given tolerance (px). */
export function flattenPath(p, tol = 0.25, m) {
  const src = m ? transformPath(p, m) : p;
  const res = [];
  for (const s of src.subpaths) {
    if (!s.nodes.length) continue;
    const pts = [s.nodes[0].x, s.nodes[0].y];
    const count = segmentCount(s);
    for (let i = 0; i < count; i++) {
      const a = s.nodes[i];
      const b = s.nodes[(i + 1) % s.nodes.length];
      if (isStraight(a, b)) pts.push(b.x, b.y);
      else {
        const [p0, p1, p2, p3] = segmentPoints(s, i);
        flattenCubic(p0, p1, p2, p3, tol, pts);
      }
    }
    if (s.closed && pts.length > 2 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) pts.length -= 2;
    res.push({ closed: s.closed, pts });
  }
  return res;
}

/** Total length of all subpaths. */
export function pathLength(p, tol = 0.1) {
  let len = 0;
  for (const f of flattenPath(p, tol)) {
    const q = f.pts;
    for (let i = 2; i < q.length; i += 2) len += Math.hypot(q[i] - q[i - 2], q[i + 1] - q[i - 1]);
    if (f.closed && q.length > 2) len += Math.hypot(q[0] - q[q.length - 2], q[1] - q[q.length - 1]);
  }
  return len;
}

// ---------------------------------------------------------------- queries

/** Closest point on the path. → {sub, seg, t, x, y, d} or null. */
export function nearestOnPath(p, px, py) {
  let best = null;
  p.subpaths.forEach((s, si) => {
    const count = segmentCount(s);
    for (let i = 0; i < count; i++) {
      const a = s.nodes[i];
      const b = s.nodes[(i + 1) % s.nodes.length];
      let cand;
      if (isStraight(a, b)) {
        const r = pointSegment(px, py, a.x, a.y, b.x, b.y);
        cand = { sub: si, seg: i, t: r.t, x: r.x, y: r.y, d: r.d };
      } else {
        const [p0, p1, p2, p3] = segmentPoints(s, i);
        const N = 24;
        let bt = 0;
        let bd = Infinity;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const [x, y] = cubicAt(p0, p1, p2, p3, t);
          const d = Math.hypot(x - px, y - py);
          if (d < bd) {
            bd = d;
            bt = t;
          }
        }
        let lo = Math.max(0, bt - 1 / N);
        let hi = Math.min(1, bt + 1 / N);
        for (let it = 0; it < 40; it++) {
          const t1 = lo + (hi - lo) / 3;
          const t2 = hi - (hi - lo) / 3;
          const d1 = Math.hypot(...cubicAt(p0, p1, p2, p3, t1).map((v, j) => v - (j ? py : px)));
          const d2 = Math.hypot(...cubicAt(p0, p1, p2, p3, t2).map((v, j) => v - (j ? py : px)));
          if (d1 < d2) hi = t2;
          else lo = t1;
        }
        const t = (lo + hi) / 2;
        const [x, y] = cubicAt(p0, p1, p2, p3, t);
        cand = { sub: si, seg: i, t, x, y, d: Math.hypot(x - px, y - py) };
      }
      if (!best || cand.d < best.d) best = cand;
    }
  });
  return best;
}

// ---------------------------------------------------------------- editing

/** Inserts a node into segment `seg` of subpath `si` at parameter t. Returns the index of the new node. */
export function insertNodeAt(p, si, seg, t) {
  const s = p.subpaths[si];
  const a = s.nodes[seg];
  const bi = (seg + 1) % s.nodes.length;
  const b = s.nodes[bi];
  let node;
  if (isStraight(a, b)) {
    node = makeNode(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  } else {
    const [p0, p1, p2, p3] = segmentPoints(s, seg);
    const { left, right } = splitCubic(p0, p1, p2, p3, t);
    a.ox = left[1][0];
    a.oy = left[1][1];
    b.ix = right[2][0];
    b.iy = right[2][1];
    node = makeNode(left[3][0], left[3][1], left[2][0], left[2][1], right[1][0], right[1][1], "smooth");
  }
  s.nodes.splice(seg + 1, 0, node);
  return seg + 1;
}

export function deleteNode(p, si, ni) {
  const s = p.subpaths[si];
  s.nodes.splice(ni, 1);
  if (s.nodes.length < (s.closed ? 2 : 1)) p.subpaths.splice(si, 1);
}

/** Sets handles automatically from neighbors (smooth Catmull-Rom style). */
export function autoSmoothNode(sub, i) {
  const n = sub.nodes.length;
  const node = sub.nodes[i];
  const prev = sub.nodes[i - 1] || (sub.closed ? sub.nodes[n - 1] : null);
  const next = sub.nodes[i + 1] || (sub.closed ? sub.nodes[0] : null);
  if (!prev && !next) return;
  const px = prev ? prev.x : node.x - (next.x - node.x);
  const py = prev ? prev.y : node.y - (next.y - node.y);
  const nx = next ? next.x : node.x + (node.x - prev.x);
  const ny = next ? next.y : node.y + (node.y - prev.y);
  let tx = nx - px;
  let ty = ny - py;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const dp = Math.hypot(node.x - px, node.y - py) / 3;
  const dn = Math.hypot(nx - node.x, ny - node.y) / 3;
  if (prev) {
    node.ix = node.x - tx * dp;
    node.iy = node.y - ty * dp;
  }
  if (next) {
    node.ox = node.x + tx * dn;
    node.oy = node.y + ty * dn;
  }
  node.t = "smooth";
}

/** Converts a node to a handle behavior. 'sharp' removes both handles. */
export function setNodeType(sub, i, type) {
  const n = sub.nodes[i];
  if (type === "sharp") {
    n.ix = n.iy = n.ox = n.oy = null;
    n.t = "cusp";
    return;
  }
  if (n.ix == null && n.ox == null) {
    autoSmoothNode(sub, i);
    if (type === "symmetric") n.t = "symmetric";
    return;
  }
  const hasIn = n.ix != null;
  const hasOut = n.ox != null;
  if (hasIn && hasOut) {
    const li = Math.hypot(n.ix - n.x, n.iy - n.y);
    const lo = Math.hypot(n.ox - n.x, n.oy - n.y);
    const dx = (n.ox - n.x) / (lo || 1) - (n.ix - n.x) / (li || 1);
    const dy = (n.oy - n.y) / (lo || 1) - (n.iy - n.y) / (li || 1);
    const dl = Math.hypot(dx, dy) || 1;
    const ux = dx / dl;
    const uy = dy / dl;
    const lIn = type === "symmetric" ? (li + lo) / 2 : li;
    const lOut = type === "symmetric" ? (li + lo) / 2 : lo;
    n.ix = n.x - ux * lIn;
    n.iy = n.y - uy * lIn;
    n.ox = n.x + ux * lOut;
    n.oy = n.y + uy * lOut;
  }
  n.t = type;
}

export function reverseSubpath(sub) {
  sub.nodes.reverse();
  for (const n of sub.nodes) {
    [n.ix, n.ox] = [n.ox, n.ix];
    [n.iy, n.oy] = [n.oy, n.iy];
  }
}

/** Breaks a subpath at node `i`, returning the new subpath list (1 or 2 entries). */
export function breakAt(sub, i) {
  const n = sub.nodes;
  if (sub.closed) {
    const rotated = [...n.slice(i), ...n.slice(0, i)].map((x) => ({ ...x }));
    const dup = { ...rotated[0], ix: rotated[0].ix, iy: rotated[0].iy };
    rotated[0] = { ...rotated[0], ix: null, iy: null };
    rotated.push({ ...dup, ox: null, oy: null });
    return [{ closed: false, nodes: rotated }];
  }
  const a = n.slice(0, i + 1).map((x) => ({ ...x }));
  const b = n.slice(i).map((x) => ({ ...x }));
  a[a.length - 1].ox = a[a.length - 1].oy = null;
  b[0].ix = b[0].iy = null;
  return [a.length > 1 ? { closed: false, nodes: a } : null, b.length > 1 ? { closed: false, nodes: b } : null].filter(Boolean);
}

/** Joins subpath b onto the end of a (a.last connects to b.first). */
export function joinSubpaths(a, b) {
  const nodes = a.nodes.map((n) => ({ ...n }));
  const bn = b.nodes.map((n) => ({ ...n }));
  const last = nodes[nodes.length - 1];
  const first = bn[0];
  if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) {
    if (first.ox != null) {
      last.ox = first.ox;
      last.oy = first.oy;
    }
    bn.shift();
  }
  return { closed: false, nodes: nodes.concat(bn) };
}

/** Moves a whole node (anchor + handles). */
export function moveNode(n, dx, dy) {
  n.x += dx;
  n.y += dy;
  if (n.ix != null) {
    n.ix += dx;
    n.iy += dy;
  }
  if (n.ox != null) {
    n.ox += dx;
    n.oy += dy;
  }
}

/**
 * Moves one handle of node `n` ('in'|'out'), keeping the opposite handle consistent
 * with the node's type (smooth = collinear, symmetric = mirrored).
 */
export function moveHandle(n, which, x, y, { breakSymmetry = false } = {}) {
  const type = breakSymmetry ? "cusp" : n.t || "cusp";
  if (which === "in") {
    n.ix = x;
    n.iy = y;
  } else {
    n.ox = x;
    n.oy = y;
  }
  if (type === "cusp") return;
  const mine = which === "in" ? [n.ix, n.iy] : [n.ox, n.oy];
  const otherKey = which === "in" ? ["ox", "oy"] : ["ix", "iy"];
  if (n[otherKey[0]] == null && type !== "symmetric") return;
  const vx = mine[0] - n.x;
  const vy = mine[1] - n.y;
  const len = Math.hypot(vx, vy);
  let olen = len;
  if (type === "smooth") olen = n[otherKey[0]] != null ? Math.hypot(n[otherKey[0]] - n.x, n[otherKey[1]] - n.y) : len;
  if (len < 1e-9) return;
  n[otherKey[0]] = n.x - (vx / len) * olen;
  n[otherKey[1]] = n.y - (vy / len) * olen;
}

// ---------------------------------------------------------------- SVG path parsing

const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenizePathD(d) {
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) tokens.push(m[1] ? m[1] : parseFloat(m[2]));
  return tokens;
}

function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [["L", x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = den ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  else if (fs && dth < 0) dth += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const delta = dth / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out = [];
  let a = th1;
  for (let i = 0; i < segs; i++) {
    const a2 = a + delta;
    const c1 = Math.cos(a);
    const s1 = Math.sin(a);
    const c2 = Math.cos(a2);
    const s2 = Math.sin(a2);
    const pt = (x, y) => [cosP * rx * x - sinP * ry * y + cx, sinP * rx * x + cosP * ry * y + cy];
    const p1 = pt(c1 - t * s1, s1 + t * c1);
    const p2 = pt(c2 + t * s2, s2 - t * c2);
    const p3 = pt(c2, s2);
    out.push(["C", p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]);
    a = a2;
  }
  return out;
}

/** Parses an SVG path `d` attribute into absolute PathData (M/L/C/Q/Z). */
export function parseSvgPathData(d) {
  const t = tokenizePathD(d || "");
  const out = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null; // last cubic control for S
  let lastQ = null; // last quad control for T
  const num = () => (typeof t[i] === "number" ? t[i++] : NaN);
  while (i < t.length) {
    if (typeof t[i] === "string") cmd = t[i++];
    else if (!cmd) break;
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (up === "Z") {
      out.push(["Z"]);
      x = sx;
      y = sy;
      lastC = lastQ = null;
      continue;
    }
    const need = ARG_COUNT[up];
    if (need == null) break;
    const a = [];
    for (let k = 0; k < need; k++) a.push(num());
    if (a.some(Number.isNaN)) break;
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (up) {
      case "M":
        x = a[0] + ox;
        y = a[1] + oy;
        sx = x;
        sy = y;
        out.push(["M", x, y]);
        cmd = rel ? "l" : "L";
        lastC = lastQ = null;
        break;
      case "L":
        x = a[0] + ox;
        y = a[1] + oy;
        out.push(["L", x, y]);
        lastC = lastQ = null;
        break;
      case "H":
        x = a[0] + ox;
        out.push(["L", x, y]);
        lastC = lastQ = null;
        break;
      case "V":
        y = a[0] + oy;
        out.push(["L", x, y]);
        lastC = lastQ = null;
        break;
      case "C": {
        const c = ["C", a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
        out.push(c);
        lastC = [c[3], c[4]];
        x = c[5];
        y = c[6];
        lastQ = null;
        break;
      }
      case "S": {
        const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const c = ["C", c1[0], c1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        out.push(c);
        lastC = [c[3], c[4]];
        x = c[5];
        y = c[6];
        lastQ = null;
        break;
      }
      case "Q": {
        const c = ["Q", a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        out.push(c);
        lastQ = [c[1], c[2]];
        x = c[3];
        y = c[4];
        lastC = null;
        break;
      }
      case "T": {
        const c1 = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const c = ["Q", c1[0], c1[1], a[0] + ox, a[1] + oy];
        out.push(c);
        lastQ = c1;
        x = c[3];
        y = c[4];
        lastC = null;
        break;
      }
      case "A": {
        const x2 = a[5] + ox;
        const y2 = a[6] + oy;
        for (const c of arcToCubics(x, y, a[0], a[1], a[2], a[3] ? 1 : 0, a[4] ? 1 : 0, x2, y2)) out.push(c);
        x = x2;
        y = y2;
        lastC = lastQ = null;
        break;
      }
    }
  }
  return out;
}

export const svgDToPath = (d) => dataToPath(parseSvgPathData(d));
