// Fits cubic Béziers to polylines (Philip J. Schneider, "An Algorithm for Automatically
// Fitting Digitized Curves", Graphics Gems, 1990) with corner detection and straight-run
// detection. Used by boolean operations, the pencil tool and Image Trace.
import { makeNode } from "./path.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mulS = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a);
  return l ? [a[0] / l, a[1] / l] : [0, 0];
};

function bezierPoint(b, t) {
  const u = 1 - t;
  const a0 = u * u * u;
  const a1 = 3 * u * u * t;
  const a2 = 3 * u * t * t;
  const a3 = t * t * t;
  return [a0 * b[0][0] + a1 * b[1][0] + a2 * b[2][0] + a3 * b[3][0], a0 * b[0][1] + a1 * b[1][1] + a2 * b[2][1] + a3 * b[3][1]];
}

function bezier1(b, t) {
  const u = 1 - t;
  return [
    3 * u * u * (b[1][0] - b[0][0]) + 6 * u * t * (b[2][0] - b[1][0]) + 3 * t * t * (b[3][0] - b[2][0]),
    3 * u * u * (b[1][1] - b[0][1]) + 6 * u * t * (b[2][1] - b[1][1]) + 3 * t * t * (b[3][1] - b[2][1]),
  ];
}

function bezier2(b, t) {
  const u = 1 - t;
  return [
    6 * u * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]),
    6 * u * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1]),
  ];
}

function chordLengthParam(pts, first, last) {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[i - first - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[last - first] || 1;
  for (let i = 1; i <= last - first; i++) u[i] /= total;
  return u;
}

function generateBezier(pts, first, last, u, t1, t2) {
  const n = last - first + 1;
  const p0 = pts[first];
  const p3 = pts[last];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < n; i++) {
    const t = u[i];
    const m = 1 - t;
    const b0 = m * m * m;
    const b1 = 3 * t * m * m;
    const b2 = 3 * t * t * m;
    const b3 = t * t * t;
    const a1 = mulS(t1, b1);
    const a2 = mulS(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[first + i], add(mulS(p0, b0 + b1), mulS(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const detC = c00 * c11 - c01 * c01;
  const detX0 = c00 * x1 - c01 * x0;
  const detX1 = x0 * c11 - x1 * c01;
  const al = detC === 0 ? 0 : detX1 / detC;
  const ar = detC === 0 ? 0 : detX0 / detC;
  const segLen = len(sub(p3, p0));
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps) {
    const d = segLen / 3;
    return [p0, add(p0, mulS(t1, d)), add(p3, mulS(t2, d)), p3];
  }
  return [p0, add(p0, mulS(t1, al)), add(p3, mulS(t2, ar)), p3];
}

function newtonStep(b, p, t) {
  const d = sub(bezierPoint(b, t), p);
  const d1 = bezier1(b, t);
  const d2 = bezier2(b, t);
  const num = dot(d, d1);
  const den = dot(d1, d1) + dot(d, d2);
  return den === 0 ? t : t - num / den;
}

function reparameterize(pts, first, last, u, b) {
  const out = new Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = newtonStep(b, pts[first + i], u[i]);
  return out;
}

function maxError(pts, first, last, b, u) {
  let split = Math.floor((last - first + 1) / 2);
  let maxD = 0;
  for (let i = first + 1; i < last; i++) {
    const p = bezierPoint(b, u[i - first]);
    const v = sub(p, pts[i]);
    const d = v[0] * v[0] + v[1] * v[1];
    if (d >= maxD) {
      maxD = d;
      split = i;
    }
  }
  return { maxD, split };
}

function centerTangent(pts, c) {
  return norm(sub(pts[c - 1], pts[c + 1]));
}

function fitCubic(pts, first, last, t1, t2, err, out, depth = 0) {
  if (last - first === 1) {
    const d = len(sub(pts[last], pts[first])) / 3;
    out.push([pts[first], add(pts[first], mulS(t1, d)), add(pts[last], mulS(t2, d)), pts[last]]);
    return;
  }
  let u = chordLengthParam(pts, first, last);
  let b = generateBezier(pts, first, last, u, t1, t2);
  let { maxD, split } = maxError(pts, first, last, b, u);
  if (maxD < err) {
    out.push(b);
    return;
  }
  if (maxD < err * 16) {
    for (let i = 0; i < 6; i++) {
      u = reparameterize(pts, first, last, u, b);
      b = generateBezier(pts, first, last, u, t1, t2);
      ({ maxD, split } = maxError(pts, first, last, b, u));
      if (maxD < err) {
        out.push(b);
        return;
      }
    }
  }
  if (depth > 40 || split <= first || split >= last) {
    out.push(b);
    return;
  }
  const tc = centerTangent(pts, split);
  fitCubic(pts, first, split, t1, tc, err, out, depth + 1);
  fitCubic(pts, split, last, mulS(tc, -1), t2, err, out, depth + 1);
}

/** Ramer–Douglas–Peucker simplification of an open polyline ([[x,y],...]). */
export function simplifyRDP(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const ax = pts[a][0];
    const ay = pts[a][1];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (!l2) d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      else {
        const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2));
        d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function dedupe(pts, closed) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  if (closed && out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop();
  }
  return out;
}

function runIsStraight(pts, a, b, tol) {
  const p0 = pts[a];
  const p1 = pts[b];
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return true;
  for (let i = a + 1; i < b; i++) {
    const d = Math.abs((pts[i][0] - p0[0]) * dy - (pts[i][1] - p0[1]) * dx) / l;
    if (d > tol) return false;
  }
  return true;
}

function findCorners(pts, closed, angleDeg) {
  const n = pts.length;
  const corners = [];
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      corners.push(i);
      continue;
    }
    const p = pts[(i + n - 1) % n];
    const c = pts[i];
    const q = pts[(i + 1) % n];
    const a = norm(sub(c, p));
    const b = norm(sub(q, c));
    // turning angle between consecutive directions
    if (dot(a, b) < cosLimit) corners.push(i);
  }
  return corners;
}

/**
 * Fits a polyline to a VSubpath.
 * @param {number[][]} points [[x,y],...]
 * @param {{closed?:boolean, tolerance?:number, cornerAngle?:number, straightTolerance?:number}} [o]
 */
export function fitSubpath(points, o = {}) {
  const { closed = false, tolerance = 0.75, cornerAngle = 45, straightTolerance } = o;
  const straightTol = straightTolerance ?? tolerance * 0.5;
  let pts = dedupe(points, closed);
  if (pts.length < 2) return { closed, nodes: pts.map((p) => makeNode(p[0], p[1])) };
  if (pts.length === 2) return { closed, nodes: pts.map((p) => makeNode(p[0], p[1])) };
  const err = tolerance * tolerance;
  let corners = findCorners(pts, closed, cornerAngle);
  // rotate so a closed path starts at a corner (if any)
  if (closed && corners.length) {
    const s = corners[0];
    pts = [...pts.slice(s), ...pts.slice(0, s)];
    corners = corners.map((c) => (c - s + pts.length) % pts.length).sort((a, b) => a - b);
  }
  const n = pts.length;
  const bounds = corners.slice();
  if (closed) {
    if (!bounds.length) bounds.push(0, Math.floor(n / 2));
    bounds.push(bounds[0] + n);
  }
  const nodes = [];
  const pushNode = (p, type) => {
    const node = makeNode(p[0], p[1], null, null, null, null, type);
    nodes.push(node);
    return node;
  };
  const at = (i) => pts[i % n];
  const noCorner = closed && corners.length === 0;
  pushNode(at(bounds[0]), noCorner ? "smooth" : "cusp");
  for (let bi = 0; bi < bounds.length - 1; bi++) {
    const a = bounds[bi];
    const b = bounds[bi + 1];
    const run = [];
    for (let i = a; i <= b; i++) run.push(at(i));
    const last = nodes[nodes.length - 1];
    const endIsStart = closed && bi === bounds.length - 2;
    const endNode = () => {
      if (endIsStart) return nodes[0];
      return pushNode(run[run.length - 1], noCorner && bi < bounds.length - 2 ? "smooth" : "cusp");
    };
    if (run.length === 2 || runIsStraight(run, 0, run.length - 1, straightTol)) {
      endNode();
      continue;
    }
    // tangents: one sided at corners, central for smooth closed loops
    let t1 = norm(sub(run[Math.min(2, run.length - 1)], run[0]));
    let t2 = norm(sub(run[Math.max(0, run.length - 3)], run[run.length - 1]));
    if (noCorner) {
      const before = at(a + n - 1);
      const after = at(b + 1);
      t1 = norm(sub(run[1], before));
      t2 = norm(sub(run[run.length - 2], after));
    }
    const beziers = [];
    fitCubic(run, 0, run.length - 1, t1, t2, err, beziers);
    let prev = last;
    beziers.forEach((bz, k) => {
      prev.ox = bz[1][0];
      prev.oy = bz[1][1];
      const isLastBez = k === beziers.length - 1;
      const target = isLastBez ? endNode() : pushNode(bz[3], "smooth");
      target.ix = bz[2][0];
      target.iy = bz[2][1];
      prev = target;
    });
  }
  return { closed, nodes };
}

/** Fits a closed polygon ring ([[x,y]...], not repeating the first point). */
export const fitRing = (ring, o) => fitSubpath(ring, { ...o, closed: true });
