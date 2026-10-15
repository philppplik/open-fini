// Boolean path operations and stroke expansion, built on the vendored polygon-clipping library.
// Curves are flattened for the operation and re-fitted to smooth Béziers afterwards, so results
// of curved inputs stay compact and editable while polygonal inputs keep their straight edges.
import pc from "../../../vendor/polygon-clipping/polygon-clipping.js";
import { flattenPath } from "./path.js";
import { fitSubpath } from "./fit.js";

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i];
    const q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

function hasCurves(path) {
  for (const s of path.subpaths) for (const n of s.nodes) if (n.ix != null || n.ox != null) return true;
  return false;
}

/** VPath (already in the common coordinate space) → polygon-clipping MultiPolygon, honoring the fill rule. */
export function pathToMultiPolygon(path, rule = "nonzero", tol = 0.05) {
  const rings = [];
  for (const f of flattenPath(path, tol)) {
    if (f.pts.length < 6) continue; // need at least 3 points; open subpaths are implicitly closed (fill semantics)
    const r = [];
    for (let i = 0; i < f.pts.length; i += 2) r.push([f.pts[i], f.pts[i + 1]]);
    rings.push(r);
  }
  if (!rings.length) return [];
  if (rule === "evenodd") {
    let acc = pc.union([rings[0]]);
    for (let i = 1; i < rings.length; i++) acc = pc.xor(acc, [rings[i]]);
    return acc;
  }
  // nonzero: rings that wind like the dominant (largest) ring are filled, opposite ones carve holes
  let big = rings[0];
  for (const r of rings) if (Math.abs(ringArea(r)) > Math.abs(ringArea(big))) big = r;
  const sign = Math.sign(ringArea(big)) || 1;
  const pos = [];
  const neg = [];
  for (const r of rings) (Math.sign(ringArea(r)) === sign ? pos : neg).push([r]);
  let acc = pos.length > 1 ? pc.union(pos[0], ...pos.slice(1)) : pos[0] ? pc.union(pos[0]) : [];
  if (neg.length) acc = pc.difference(acc, ...neg);
  return acc;
}

/** polygon-clipping MultiPolygon → VPath (optionally curve-fitted). */
export function multiPolygonToPath(mp, { fit = true, tolerance = 0.4, cornerAngle = 40 } = {}) {
  const subpaths = [];
  for (const poly of mp) {
    for (const ring of poly) {
      const pts = ring.slice(0, ring.length - 1); // pc rings repeat the first point
      if (pts.length < 3) continue;
      subpaths.push(
        fit ? fitSubpath(pts, { closed: true, tolerance, cornerAngle }) : { closed: true, nodes: pts.map((p) => ({ x: p[0], y: p[1], ix: null, iy: null, ox: null, oy: null })) },
      );
    }
  }
  return { subpaths };
}

/**
 * @param {'union'|'subtract'|'intersect'|'xor'|'divide'} op
 * @param {{path:object, rule?:string}[]} items bottom → top, all in the same coordinate space
 * @returns {object[]} VPaths — one entry for most operations; 'divide' returns one VPath per piece.
 */
export function booleanPaths(op, items, { tol = 0.05, fit } = {}) {
  if (!items.length) return [];
  const doFit = fit ?? items.some((it) => hasCurves(it.path));
  const polys = items.map((it) => pathToMultiPolygon(it.path, it.rule || "nonzero", tol));
  const fin = (mp) => multiPolygonToPath(mp, { fit: doFit });
  let res;
  switch (op) {
    case "union":
      res = polys.length > 1 ? pc.union(polys[0], ...polys.slice(1)) : polys[0];
      break;
    case "subtract":
      // the bottom-most item is the subject; everything above is cut out of it
      res = polys.length > 1 ? pc.difference(polys[0], ...polys.slice(1)) : polys[0];
      break;
    case "intersect":
      res = polys.length > 1 ? pc.intersection(polys[0], ...polys.slice(1)) : polys[0];
      break;
    case "xor":
      res = polys.length > 1 ? pc.xor(polys[0], ...polys.slice(1)) : polys[0];
      break;
    case "divide": {
      // Planar subdivision: every distinct region of the overlapping shapes becomes its own piece.
      let pieces = polys[0].length ? [polys[0]] : [];
      let covered = polys[0];
      for (let i = 1; i < polys.length; i++) {
        const next = [];
        for (const p of pieces) {
          const a = pc.intersection(p, polys[i]);
          const b = pc.difference(p, polys[i]);
          if (a.length) next.push(a);
          if (b.length) next.push(b);
        }
        const only = covered.length ? pc.difference(polys[i], covered) : polys[i];
        if (only.length) next.push(only);
        pieces = next;
        covered = covered.length ? pc.union(covered, polys[i]) : polys[i];
      }
      return pieces.map(fin).filter((p) => p.subpaths.length);
    }
    default:
      throw new Error(`Unknown boolean operation: ${op}`);
  }
  const out = fin(res || []);
  return out.subpaths.length ? [out] : [];
}

// ---------------------------------------------------------------- stroke expansion

function circlePoly(cx, cy, r, segs) {
  const ring = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return [ring];
}

function applyDash(pts, closed, dash, offset) {
  if (!dash || !dash.length || dash.every((d) => d <= 0)) return [{ pts, closed }];
  const pattern = dash.length % 2 ? dash.concat(dash) : dash;
  const src = pts.slice();
  if (closed) src.push(pts[0], pts[1]);
  const out = [];
  let idx = 0;
  let remain = pattern[0];
  let on = true;
  let off = offset % pattern.reduce((a, b) => a + b, 0);
  while (off > 0) {
    if (off >= remain) {
      off -= remain;
      idx = (idx + 1) % pattern.length;
      remain = pattern[idx];
      on = !on;
    } else {
      remain -= off;
      off = 0;
    }
  }
  let cur = on ? [src[0], src[1]] : null;
  for (let i = 2; i < src.length; i += 2) {
    let x0 = src[i - 2];
    let y0 = src[i - 1];
    const x1 = src[i];
    const y1 = src[i + 1];
    let segLen = Math.hypot(x1 - x0, y1 - y0);
    while (segLen > 1e-9) {
      const step = Math.min(remain, segLen);
      const t = step / segLen;
      const nx = x0 + (x1 - x0) * t;
      const ny = y0 + (y1 - y0) * t;
      if (on) cur.push(nx, ny);
      segLen -= step;
      remain -= step;
      x0 = nx;
      y0 = ny;
      if (remain <= 1e-9) {
        if (on && cur.length >= 4) out.push({ pts: cur, closed: false });
        idx = (idx + 1) % pattern.length;
        remain = pattern[idx] || 1e-6;
        on = !on;
        cur = on ? [nx, ny] : null;
      }
    }
  }
  if (on && cur && cur.length >= 4) out.push({ pts: cur, closed: false });
  return out;
}

/**
 * Converts a stroked path into a filled outline.
 * @param {object} path VPath
 * @param {{width:number, cap?:string, join?:string, miterLimit?:number, dash?:number[], dashOffset?:number}} s
 */
export function expandStroke(path, s, { tol = 0.1 } = {}) {
  const w = s.width;
  const hw = w / 2;
  if (!(hw > 0)) return { subpaths: [] };
  const cap = s.cap || "butt";
  const join = s.join || "miter";
  const miterLimit = s.miterLimit || 4;
  const segs = Math.max(8, Math.min(64, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - tol / hw)) || 16)));
  const polys = [];
  for (const f0 of flattenPath(path, tol)) {
    for (const f of applyDash(f0.pts, f0.closed, s.dash, s.dashOffset || 0)) {
      const p = f.pts;
      const n = p.length / 2;
      if (n < 2) continue;
      const count = f.closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % n;
        let x0 = p[i * 2];
        let y0 = p[i * 2 + 1];
        let x1 = p[j * 2];
        let y1 = p[j * 2 + 1];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const l = Math.hypot(dx, dy);
        if (l < 1e-9) continue;
        const ux = dx / l;
        const uy = dy / l;
        if (!f.closed && cap === "square") {
          if (i === 0) {
            x0 -= ux * hw;
            y0 -= uy * hw;
          }
          if (i === count - 1) {
            x1 += ux * hw;
            y1 += uy * hw;
          }
        }
        const nx = -uy * hw;
        const ny = ux * hw;
        polys.push([[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]]);
      }
      // joins
      const joinAt = (k) => {
        const a = (k + n - 1) % n;
        const b = (k + 1) % n;
        const px = p[k * 2];
        const py = p[k * 2 + 1];
        const d1x = px - p[a * 2];
        const d1y = py - p[a * 2 + 1];
        const d2x = p[b * 2] - px;
        const d2y = p[b * 2 + 1] - py;
        const l1 = Math.hypot(d1x, d1y);
        const l2 = Math.hypot(d2x, d2y);
        if (l1 < 1e-9 || l2 < 1e-9) return;
        const cross = (d1x * d2y - d1y * d2x) / (l1 * l2);
        const dotp = (d1x * d2x + d1y * d2y) / (l1 * l2);
        if (Math.abs(cross) < 1e-6 && dotp > 0) return;
        if (join === "round") {
          polys.push(circlePoly(px, py, hw, segs));
          return;
        }
        // outer side of the turn
        const side = cross > 0 ? -1 : 1;
        const n1 = [(-d1y / l1) * hw * side, (d1x / l1) * hw * side];
        const n2 = [(-d2y / l2) * hw * side, (d2x / l2) * hw * side];
        const A = [px + n1[0], py + n1[1]];
        const B = [px + n2[0], py + n2[1]];
        const wedge = [[px, py], A, B];
        if (join === "miter") {
          const cosHalf = Math.sqrt(Math.max(0, (1 + dotp) / 2));
          const ratio = cosHalf > 1e-6 ? 1 / cosHalf : Infinity;
          if (ratio <= miterLimit) {
            const mx = n1[0] + n2[0];
            const my = n1[1] + n2[1];
            const ml = Math.hypot(mx, my) || 1;
            const k = (hw * ratio) / ml;
            wedge.splice(2, 0, [px + mx * k, py + my * k]);
          }
        }
        polys.push([wedge]);
      };
      if (f.closed) for (let k = 0; k < n; k++) joinAt(k);
      else for (let k = 1; k < n - 1; k++) joinAt(k);
      if (!f.closed && cap === "round") {
        polys.push(circlePoly(p[0], p[1], hw, segs));
        polys.push(circlePoly(p[(n - 1) * 2], p[(n - 1) * 2 + 1], hw, segs));
      }
    }
  }
  if (!polys.length) return { subpaths: [] };
  const mp = polys.length > 1 ? pc.union(polys[0], ...polys.slice(1)) : pc.union(polys[0]);
  return multiPolygonToPath(mp, { fit: false });
}
