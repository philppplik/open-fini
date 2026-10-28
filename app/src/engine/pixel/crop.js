// Pure crop geometry for the Pixel studio (no DOM): aspect ratios, handle resizing with a locked ratio, rotated /
// straightened crops, composition overlays and edge trimming. The Crop tool (studios/tools/pixel-crop.js) and the
// Vibe tools call these; tests live in tests/pixel/crop.test.js.
//
// Conventions: rects are {x, y, w, h} in page pixels; angles are degrees, positive = clockwise on screen (y down);
// matrices are [a, b, c, d, e, f] with x' = a*x + c*y + e, y' = b*x + d*y + f (same as core/math.js).

export const RATIO_PRESETS = ["free", "original", "1:1", "4:3", "3:2", "16:9", "5:4", "3:4", "2:3", "9:16", "custom"];
export const OVERLAYS = ["thirds", "grid", "golden", "diagonal", "triangle", "none"];
const PHI = 0.381966011;

/**
 * Numeric width/height ratio of a preset, or null for "free". `flip` swaps portrait/landscape.
 * @param {string} key one of RATIO_PRESETS
 * @param {{w:number,h:number}} page used by "original"
 * @param {string} [custom] "W:H" text for "custom"
 */
export function ratioValue(key, page, custom = "") {
  let r = null;
  if (key === "original") r = page.w / page.h;
  else if (key === "custom") r = parseRatio(custom);
  else if (key && key !== "free") r = parseRatio(key);
  return r && r > 0 && Number.isFinite(r) ? r : null;
}

/** "16:9", "16/9", "1.5" -> number or null. */
export function parseRatio(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[:/x×]\s*(\d+(?:\.\d+)?))?\s*$/.exec(String(text));
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = m[2] === undefined ? 1 : parseFloat(m[2]);
  return b > 0 && a > 0 ? a / b : null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Resizes `rect` by dragging `handle` (n, s, e, w, ne, nw, se, sw) to the point (px, py). With `ratio` the
 * aspect ratio is locked (corners anchor the opposite corner, edges grow around the center of the other axis).
 * `bounds` ({w,h}) keeps the result inside [0,w]x[0,h]; pass null for an unbounded (rotated) crop.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function resizeRect(rect, handle, px, py, ratio = null, bounds = null, min = 1) {
  let x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
  const bx0 = bounds ? 0 : -Infinity, by0 = bounds ? 0 : -Infinity;
  const bx1 = bounds ? bounds.w : Infinity, by1 = bounds ? bounds.h : Infinity;
  const west = handle.includes("w"), east = handle.includes("e"), north = handle.includes("n"), south = handle.includes("s");
  if (!ratio) {
    if (west) x0 = clamp(px, bx0, x1 - min);
    if (east) x1 = clamp(px, x0 + min, bx1);
    if (north) y0 = clamp(py, by0, y1 - min);
    if (south) y1 = clamp(py, y0 + min, by1);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if ((west || east) && (north || south)) {
    // corner: anchor at the opposite corner
    const ax = west ? x1 : x0, ay = north ? y1 : y0;
    const sx = west ? -1 : 1, sy = north ? -1 : 1;
    let w = Math.max((px - ax) * sx, 0), hh = Math.max((py - ay) * sy, 0);
    if (w / ratio > hh) hh = w / ratio;
    else w = hh * ratio;
    const maxW = sx > 0 ? bx1 - ax : ax - bx0;
    const maxH = sy > 0 ? by1 - ay : ay - by0;
    const k = Math.min(1, maxW / w || 1, maxH / hh || 1);
    w *= k; hh *= k;
    if (w < min) { w = min; hh = min / ratio; }
    return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - hh, w, h: hh };
  }
  if (west || east) {
    const ax = west ? x1 : x0;
    const sx = west ? -1 : 1;
    let w = Math.max((px - ax) * sx, min);
    const cy = (y0 + y1) / 2;
    let hh = w / ratio;
    const maxW = sx > 0 ? bx1 - ax : ax - bx0;
    const maxH = 2 * Math.min(cy - by0, by1 - cy);
    const k = Math.min(1, maxW / w, maxH / hh);
    w *= k; hh *= k;
    return { x: sx > 0 ? ax : ax - w, y: cy - hh / 2, w, h: hh };
  }
  const ay = north ? y1 : y0;
  const sy = north ? -1 : 1;
  let hh = Math.max((py - ay) * sy, min);
  const cx = (x0 + x1) / 2;
  let w = hh * ratio;
  const maxH = sy > 0 ? by1 - ay : ay - by0;
  const maxW = 2 * Math.min(cx - bx0, bx1 - cx);
  const k = Math.min(1, maxH / hh, maxW / w);
  w *= k; hh *= k;
  return { x: cx - w / 2, y: sy > 0 ? ay : ay - hh, w, h: hh };
}

/** Forces `rect` to `ratio` (shrinking the longer side around the center) and keeps it inside `bounds`. */
export function applyRatio(rect, ratio, bounds = null) {
  if (!ratio) return { ...rect };
  let w = rect.w, hh = rect.h;
  if (w / hh > ratio) w = hh * ratio;
  else hh = w / ratio;
  if (bounds) {
    const k = Math.min(1, bounds.w / w, bounds.h / hh);
    w *= k; hh *= k;
  }
  let x = rect.x + (rect.w - w) / 2, y = rect.y + (rect.h - hh) / 2;
  if (bounds) { x = clamp(x, 0, bounds.w - w); y = clamp(y, 0, bounds.h - hh); }
  return { x, y, w, h: hh };
}

/** The corners of `rect` rotated by `deg` around its own center, clockwise from top-left. */
export function rotatedCorners(rect, deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  return [[-rect.w / 2, -rect.h / 2], [rect.w / 2, -rect.h / 2], [rect.w / 2, rect.h / 2], [-rect.w / 2, rect.h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/**
 * Shrinks `rect` around its center until it, rotated by `deg`, lies inside the page [0,W]x[0,H].
 * With `deg` = 0 this just clamps the size. Used for "no empty corners" crops.
 */
export function fitRotatedInside(rect, deg, W, H) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const cx = clamp(rect.x + rect.w / 2, 0, W), cy = clamp(rect.y + rect.h / 2, 0, H);
  let t = 1;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ox = (x * rect.w * c - y * rect.h * s) / 2, oy = (x * rect.w * s + y * rect.h * c) / 2;
    if (ox > 1e-9) t = Math.min(t, (W - cx) / ox); else if (ox < -1e-9) t = Math.min(t, (0 - cx) / ox);
    if (oy > 1e-9) t = Math.min(t, (H - cy) / oy); else if (oy < -1e-9) t = Math.min(t, (0 - cy) / oy);
  }
  t = Math.max(0, Math.min(1, t));
  const w = rect.w * t, hh = rect.h * t;
  return { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
}

/** The largest centered rect of the given aspect ratio that fits the page after rotating by `deg`. */
export function largestInscribed(W, H, deg, ratio) {
  const r = (deg * Math.PI) / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const k = Math.min(W / 2 / (ratio * c + s), H / 2 / (ratio * s + c));
  const w = 2 * k * ratio, hh = 2 * k;
  return { x: (W - w) / 2, y: (H - hh) / 2, w, h: hh };
}

/**
 * Matrix mapping old page coordinates into the cropped page whose size is rect.w x rect.h, for a crop box that is
 * rotated by `deg` around its center (the content is rotated by -deg so the box becomes upright).
 */
export function cropMatrix(rect, deg = 0) {
  const r = (-deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const dx = Math.round(rect.w) / 2, dy = Math.round(rect.h) / 2;
  return [c, s, -s, c, dx - c * cx + s * cy, dy - s * cx - c * cy].map((v) => v + 0);
}

/** Angle (degrees, within +-45) that levels the line p0->p1: after rotating the crop by it the line is horizontal or vertical. */
export function levelAngle(p0, p1) {
  let a = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI;
  a = ((((a + 45) % 90) + 90) % 90) - 45;
  return Math.round(a * 100) / 100;
}

/** Overlay line segments of a composition guide in unit coordinates [x0, y0, x1, y1] (multiply by the box size). */
export function overlayLines(kind) {
  switch (kind) {
    case "thirds": return [[1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 2 / 3, 1], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 2 / 3]];
    case "grid": {
      const out = [];
      for (let i = 1; i < 6; i++) out.push([i / 6, 0, i / 6, 1], [0, i / 6, 1, i / 6]);
      return out;
    }
    case "golden": return [[PHI, 0, PHI, 1], [1 - PHI, 0, 1 - PHI, 1], [0, PHI, 1, PHI], [0, 1 - PHI, 1, 1 - PHI]];
    case "diagonal": return [[0, 0, 1, 1], [1, 0, 0, 1], [0.5, 0, 0.5, 1], [0, 0.5, 1, 0.5]];
    case "triangle": return [[0, 1, 1, 0], [0, 0, 0.5, 0.5], [0.5, 0.5, 1, 1]];
    default: return [];
  }
}

/** The next overlay in the cycle (key `O`). */
export function nextOverlay(kind) {
  return OVERLAYS[(OVERLAYS.indexOf(kind) + 1) % OVERLAYS.length];
}

/**
 * Bounds of the content of an RGBA image after trimming edges that are transparent or equal (within `tolerance`)
 * to a reference color.
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img
 * @param {{mode?: 'transparent'|'topleft'|'bottomright', tolerance?: number, sides?: {top?:boolean,bottom?:boolean,left?:boolean,right?:boolean}}} [opts]
 * @returns {{x:number,y:number,w:number,h:number}|null} null when nothing remains
 */
export function trimBounds(img, opts = {}) {
  const { width: W, height: H, data: d } = img;
  const mode = opts.mode || "transparent";
  const tol = opts.tolerance ?? 0;
  const sides = { top: true, bottom: true, left: true, right: true, ...opts.sides };
  let ref = null;
  if (mode === "topleft") ref = [d[0], d[1], d[2], d[3]];
  else if (mode === "bottomright") { const o = ((H - 1) * W + (W - 1)) * 4; ref = [d[o], d[o + 1], d[o + 2], d[o + 3]]; }
  const same = (i) => {
    if (!ref) return d[i + 3] <= tol;
    return Math.abs(d[i] - ref[0]) <= tol && Math.abs(d[i + 1] - ref[1]) <= tol && Math.abs(d[i + 2] - ref[2]) <= tol && Math.abs(d[i + 3] - ref[3]) <= tol;
  };
  const rowEmpty = (y, x0, x1) => { for (let x = x0; x < x1; x++) if (!same((y * W + x) * 4)) return false; return true; };
  const colEmpty = (x, y0, y1) => { for (let y = y0; y < y1; y++) if (!same((y * W + x) * 4)) return false; return true; };
  let t = 0, b = H, l = 0, r = W;
  if (sides.top) while (t < b && rowEmpty(t, 0, W)) t++;
  if (t >= b) return null;
  if (sides.bottom) while (b > t && rowEmpty(b - 1, 0, W)) b--;
  if (sides.left) while (l < r && colEmpty(l, t, b)) l++;
  if (sides.right) while (r > l && colEmpty(r - 1, t, b)) r--;
  if (l >= r || t >= b) return null;
  return { x: l, y: t, w: r - l, h: b - t };
}
