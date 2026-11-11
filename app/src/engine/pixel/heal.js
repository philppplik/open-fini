// Healing algorithms of the Pixel studio that are too heavy for the UI thread (no AI models): the Patch tool's
// gradient-domain transfer, horizon / vertical detection for Straighten Horizon, and edge extension for the empty
// corners of a rotated crop. Content-Aware Fill and the Object Eraser use inpaintMask (inpaint.js).
// Pure: plain {width, height, data} images, no DOM. Not part of engine/pixel/index.js (the start-up chunk): the worker
// pool runs it (core/workers/jobs.js "pixel.patch", "pixel.horizon", "pixel.extend"). Tests: tests/pixel/heal.test.js.
import { pushPull } from "./inpaint.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

const EMPTY = () => ({ x: 0, y: 0, width: 0, height: 0 });

/**
 * Patch: replaces the masked area with the pixels at offset (dx, dy) (where the patch was dragged to). In "heal" mode
 * (default) the copied texture takes the color and light of the surroundings: the difference between destination and
 * source along the area's border is interpolated smoothly over the inside (a membrane, the classic healing approach),
 * so only the texture moves. "copy" moves the pixels as they are. Coverage below 255 blends softly. Source points
 * outside the image are clamped to the edge.
 * @param {RGBAImage} img modified in place
 * @param {Uint8Array} mask coverage 0..255, same size as the image
 * @param {number} dx source offset x (source = destination + offset)
 * @param {number} dy source offset y
 * @param {{mode?: 'heal'|'copy'}} [opts]
 * @returns {Rect} dirty rect
 */
export function patchTransfer(img, mask, dx, dy, opts = {}) {
  const W = img.width, H = img.height;
  if (mask.length !== W * H) throw new RangeError("patchTransfer: mask size mismatch");
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return EMPTY();
  const ox = Math.round(dx), oy = Math.round(dy);
  if (!ox && !oy) return EMPTY();
  const orig = new Uint8ClampedArray(img.data);
  const src = (x, y) => {
    const sx = Math.min(W - 1, Math.max(0, x + ox)), sy = Math.min(H - 1, Math.max(0, y + oy));
    return (sy * W + sx) * 4;
  };
  // working box: the masked area plus a one pixel ring of known border pixels
  const bx = Math.max(0, x0 - 1), by = Math.max(0, y0 - 1);
  const bw = Math.min(W, x1 + 2) - bx, bh = Math.min(H, y1 + 2) - by;
  let diff = null;
  if (opts.mode !== "copy") {
    const val = new Float32Array(bw * bh * 4);
    const wgt = new Float32Array(bw * bh);
    let known = 0;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const gx = bx + x, gy = by + y, i = gy * W + gx;
        if (mask[i]) continue;
        // a known pixel next to the area: its destination-minus-source difference is a boundary condition
        const near = (gx > 0 && mask[i - 1]) || (gx < W - 1 && mask[i + 1]) || (gy > 0 && mask[i - W]) || (gy < H - 1 && mask[i + W]);
        if (!near) continue;
        const p = i * 4, s = src(gx, gy), o = (y * bw + x) * 4;
        for (let c = 0; c < 4; c++) val[o + c] = orig[p + c] - orig[s + c];
        wgt[y * bw + x] = 1;
        known++;
      }
    }
    if (known) {
      pushPull(val, wgt, bw, bh);
      diff = val;
    }
  }
  const d = img.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x, m = mask[i];
      if (!m) continue;
      const p = i * 4, s = src(x, y), k = m / 255;
      const o = diff ? ((y - by) * bw + (x - bx)) * 4 : 0;
      for (let c = 0; c < 4; c++) {
        let v = orig[s + c] + (diff ? diff[o + c] : 0);
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        d[p + c] = orig[p + c] + (v - orig[p + c]) * k;
      }
    }
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// ---------------------------------------------------------------------------------------------
// Horizon detection
// ---------------------------------------------------------------------------------------------

/** Luma of `img` box-averaged down by the integer factor k (Float32Array, w x h). */
function lumaDown(img, k) {
  const W = img.width, H = img.height, d = img.data;
  const w = Math.max(1, Math.floor(W / k)), h = Math.max(1, Math.floor(H / k));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let yy = y * k; yy < (y + 1) * k && yy < H; yy++) {
        for (let xx = x * k; xx < (x + 1) * k && xx < W; xx++) {
          const p = (yy * W + xx) * 4, a = d[p + 3] / 255;
          s += (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) * a; // transparent counts as black
          n++;
        }
      }
      out[y * w + x] = n ? s / n : 0;
    }
  }
  return { L: out, w, h };
}

/**
 * Gradient-guided Hough transform for lines within +-maxAngle of horizontal. `gx`, `gy`, `mag` are planes of size
 * w x h (already transposed for the vertical family). Returns the strongest line {angle (deg, + = descends to the
 * right), rho, votes} or null.
 */
function houghNearHorizontal(gx, gy, mag, w, h, thr, maxAngle) {
  const step = 0.25;
  const nA = Math.round((2 * maxAngle) / step) + 1;
  const rad = (a) => ((a * step - maxAngle) * Math.PI) / 180;
  const sinA = new Float32Array(nA), cosA = new Float32Array(nA);
  for (let a = 0; a < nA; a++) {
    sinA[a] = Math.sin(rad(a));
    cosA[a] = Math.cos(rad(a));
  }
  const rOff = Math.ceil(w * Math.sin((maxAngle * Math.PI) / 180)) + 2;
  const nR = h + 2 * rOff;
  const acc = new Float32Array(nA * nR);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, m = mag[i];
      if (m < thr) continue;
      // direction of the edge line (perpendicular to the gradient), folded into (-90, 90]. Pixel staircases make the
      // local direction rough, so it only filters out steep edges; the vote goes to every searched angle.
      let al = (Math.atan2(-gx[i], gy[i]) * 180) / Math.PI;
      if (al > 90) al -= 180;
      else if (al <= -90) al += 180;
      if (Math.abs(al) > maxAngle + 25) continue;
      for (let a = 0; a < nA; a++) {
        const r = Math.round(y * cosA[a] - x * sinA[a]) + rOff;
        if (r >= 0 && r < nR) acc[a * nR + r] += m;
      }
    }
  }
  let best = -1, bv = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > bv) { bv = acc[i]; best = i; }
  if (best < 0) return null;
  const a = Math.floor(best / nR), r = best % nR;
  // sub-bin angle: parabola through the neighboring angle bins at the same rho
  let off = 0;
  if (a > 0 && a < nA - 1) {
    const l = acc[(a - 1) * nR + r], c = acc[a * nR + r], rr = acc[(a + 1) * nR + r];
    const den = l - 2 * c + rr;
    if (den < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (l - rr)) / den));
  }
  return { angle: (a + off) * step - maxAngle, rho: r - rOff, votes: bv };
}

/**
 * Finds the dominant almost-level line (a horizon, shoreline, table edge) or, when stronger, the dominant almost-plumb
 * line (building edges, door frames) of an image. Returns null when no line is clear enough.
 * @param {RGBAImage} img
 * @param {{maxAngle?: number, maxSide?: number}} [opts] maxAngle: largest tilt searched (degrees, default 20);
 *   maxSide: analysis size (default 480 px)
 * @returns {{kind: 'horizon'|'vertical', angle: number, line: [[number, number], [number, number]], strength: number} | null}
 *   `angle`: tilt of the line in degrees (+ = clockwise from level/plumb, y down); `line`: two points on it in image
 *   pixels across the image; `strength`: supporting edge length relative to the image side (0..1+)
 */
export function detectHorizon(img, opts = {}) {
  const maxAngle = Math.max(1, Math.min(44, opts.maxAngle ?? 20));
  const k = Math.max(1, Math.ceil(Math.max(img.width, img.height) / (opts.maxSide || 480)));
  const { L, w, h } = lumaDown(img, k);
  if (w < 16 || h < 16) return null;
  const n = w * h;
  const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = L[i - w - 1], b = L[i - w], c = L[i - w + 1], dd = L[i - 1], f = L[i + 1], g = L[i + w - 1], hh = L[i + w], ii = L[i + w + 1];
      const sx = c + 2 * f + ii - a - 2 * dd - g;
      const sy = g + 2 * hh + ii - a - 2 * b - c;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.hypot(sx, sy);
    }
  }
  // threshold: the strongest 12 % of the edges, at least a clear step
  const hist = new Uint32Array(256);
  let maxM = 0;
  for (let i = 0; i < n; i++) if (mag[i] > maxM) maxM = mag[i];
  if (maxM < 40) return null;
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.floor((mag[i] / maxM) * 255))]++;
  let acc = 0, bin = 255;
  for (; bin > 0; bin--) {
    acc += hist[bin];
    if (acc >= n * 0.12) break;
  }
  const thr = Math.max(40, (bin / 255) * maxM);
  let edgeSum = 0, edgeN = 0;
  for (let i = 0; i < n; i++) if (mag[i] >= thr) { edgeSum += mag[i]; edgeN++; }
  if (!edgeN) return null;
  const meanEdge = edgeSum / edgeN;
  const hor = houghNearHorizontal(gx, gy, mag, w, h, thr, maxAngle);
  // vertical family: the same search on the transposed planes
  const tgx = new Float32Array(n), tgy = new Float32Array(n), tmag = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, j = x * h + y;
    tgx[j] = gy[i];
    tgy[j] = gx[i];
    tmag[j] = mag[i];
  }
  const ver = houghNearHorizontal(tgx, tgy, tmag, h, w, thr, maxAngle);
  const hs = hor ? hor.votes / meanEdge / w : 0;
  const vs = ver ? ver.votes / meanEdge / h : 0;
  const useV = vs > hs * 1.25;
  const s = useV ? vs : hs;
  if (s < 0.35) return null;
  const sc = (v) => v * k;
  if (!useV) {
    const t = Math.tan((hor.angle * Math.PI) / 180), c = Math.cos((hor.angle * Math.PI) / 180);
    const yAt = (x) => (hor.rho / c) + x * t;
    return { kind: "horizon", angle: round2(hor.angle), line: [[0, sc(yAt(0))], [img.width, sc(yAt(w))]], strength: round2(s) };
  }
  // transposed: x' = y, y' = x, so the line is x = rho / cos + y * tan; its tilt from plumb is the negative angle
  const t = Math.tan((ver.angle * Math.PI) / 180), c = Math.cos((ver.angle * Math.PI) / 180);
  const xAt = (y) => (ver.rho / c) + y * t;
  return { kind: "vertical", angle: round2(-ver.angle), line: [[sc(xAt(0)), 0], [sc(xAt(h)), img.height]], strength: round2(s) };
}

const round2 = (v) => Math.round(v * 100) / 100 + 0;

// ---------------------------------------------------------------------------------------------
// Edge extension (rotated crop corners)
// ---------------------------------------------------------------------------------------------

/**
 * Fills the parts of a new width x height canvas that fall outside the source image by extending the source's edge
 * pixels outward (clamp-to-edge, bilinear). `inv` maps output pixels to source pixels (an affine [a, b, c, d, e, f]:
 * sx = a x + c y + e, sy = b x + d y + f). Inside the source the output stays transparent except for a one pixel
 * overlap that hides the seam, so the layer can sit under the original content.
 * @param {RGBAImage} src
 * @param {number[]} inv
 * @param {number} width
 * @param {number} height
 * @returns {RGBAImage}
 */
export function extendEdges(src, inv, width, height) {
  const W = src.width, H = src.height, s = src.data;
  const out = new Uint8ClampedArray(width * height * 4);
  const [a, b, c, d, e, f] = inv;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const sx = a * X + c * Y + e, sy = b * X + d * Y + f;
      const dist = Math.max(-sx, sx - W, -sy, sy - H);
      const cov = dist + 1;
      if (cov <= 0) continue;
      const k = cov >= 1 ? 1 : cov;
      // bilinear sample at the clamped point
      const px = Math.min(W - 0.5, Math.max(0.5, sx)) - 0.5, py = Math.min(H - 0.5, Math.max(0.5, sy)) - 0.5;
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      const tx = px - x0, ty = py - y0;
      const p00 = (y0 * W + x0) * 4, p10 = (y0 * W + x1) * 4, p01 = (y1 * W + x0) * 4, p11 = (y1 * W + x1) * 4;
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const v = (s[p00 + ch] * (1 - tx) + s[p10 + ch] * tx) * (1 - ty) + (s[p01 + ch] * (1 - tx) + s[p11 + ch] * tx) * ty;
        out[o + ch] = ch === 3 ? v * k : v;
      }
    }
  }
  return { width, height, data: out };
}
