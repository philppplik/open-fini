// 2D geometry: affine matrices, rectangles and points.
// Matrices are [a,b,c,d,e,f] exactly like CanvasRenderingContext2D.transform:
//   x' = a*x + c*y + e ;  y' = b*x + d*y + f

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export const ident = () => [1, 0, 0, 1, 0, 0];

/** Returns a*b — the result applies `b` first, then `a`. */
export function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function mulAll(...ms) {
  let r = ident();
  for (const m of ms) r = mul(r, m);
  return r;
}

export function det(m) {
  return m[0] * m[3] - m[1] * m[2];
}

export function invert(m) {
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  const id = 1 / d;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function applyVec(m, x, y) {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

export const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
export const scale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export const rotate = (a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, 0, 0];
};
export const skew = (ax, ay = 0) => [1, Math.tan(ay), Math.tan(ax), 1, 0, 0];

/** Scale about a pivot point. */
export function scaleAbout(sx, sy, cx, cy) {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}
/** Rotate about a pivot point. */
export function rotateAbout(a, cx, cy) {
  return mulAll(translate(cx, cy), rotate(a), translate(-cx, -cy));
}

export function isIdentity(m, eps = 1e-9) {
  return (
    Math.abs(m[0] - 1) < eps &&
    Math.abs(m[1]) < eps &&
    Math.abs(m[2]) < eps &&
    Math.abs(m[3] - 1) < eps &&
    Math.abs(m[4]) < eps &&
    Math.abs(m[5]) < eps
  );
}

/**
 * Decomposes into translate * rotate * skewX * scale.
 * Returns {tx, ty, rotation (rad), sx, sy, skew (rad)}.
 */
export function decompose(m) {
  const [a, b, c, d, e, f] = m;
  let sx = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const ca = sx ? a / sx : 1;
  const sa = sx ? b / sx : 0;
  // component of (c,d) along and perpendicular to the rotated x axis
  let shear = ca * c + sa * d;
  let sy = -sa * c + ca * d;
  const skewv = sy ? Math.atan(shear / sy) : 0;
  if (det(m) < 0) {
    // keep rotation stable, push the flip into sy
    sy = -Math.abs(sy);
  }
  return { tx: e, ty: f, rotation, sx, sy, skew: skewv };
}

export function compose({ tx = 0, ty = 0, rotation = 0, sx = 1, sy = 1, skew: sk = 0 }) {
  return mulAll(translate(tx, ty), rotate(rotation), [1, 0, Math.tan(sk), 1, 0, 0], scale(sx, sy));
}

// ----- rectangles: {x, y, w, h} -----

export const rect = (x, y, w, h) => ({ x, y, w, h });
export const rectRight = (r) => r.x + r.w;
export const rectBottom = (r) => r.y + r.h;
export const rectCenter = (r) => [r.x + r.w / 2, r.y + r.h / 2];

export function rectFromPoints(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function rectUnion(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectIntersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bt > y ? { x, y, w: r - x, h: bt - y } : null;
}

export const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const rectContainsPoint = (r, x, y) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
export const rectContainsRect = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

export function rectInflate(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function rectCorners(r) {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
}

/** Axis-aligned bounds of a rect after a transform. */
export function rectTransform(r, m) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of rectCorners(r)) {
    const [tx, ty] = apply(m, x, y);
    if (tx < minX) minX = tx;
    if (ty < minY) minY = ty;
    if (tx > maxX) maxX = tx;
    if (ty > maxY) maxY = ty;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function pointsBounds(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return pts.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

// ----- points / vectors -----

export const dist = (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0);
export const distSq = (x0, y0, x1, y1) => (x1 - x0) ** 2 + (y1 - y0) ** 2;

/** Distance from point p to segment ab. Returns {d, t, x, y}. */
export function pointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { d: Math.hypot(px - x, py - y), t, x, y };
}

export function normalizeAngle(a) {
  const t = Math.PI * 2;
  a %= t;
  return a < -Math.PI ? a + t : a > Math.PI ? a - t : a;
}

/** Snaps an angle (rad) to the nearest multiple of `step` (rad). */
export const snapAngle = (a, step = Math.PI / 12) => Math.round(a / step) * step;
