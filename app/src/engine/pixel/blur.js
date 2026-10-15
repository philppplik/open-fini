// Shared blur kernels for the pixel engine (internal building block for filters, selection,
// develop, tone mapping, ...). All passes are O(1) per pixel (sliding sums) and work on
// Float32Array planes, so they are reusable for single-channel data such as masks and luma.
//
// Gaussian blur = three box passes whose edge taps are fractional, so the variance of every pass is
// matched EXACTLY to sigma^2/3 (fractional radius support, no integer-radius jumps). The 3-fold
// box convolution is within ~1-2 % of a true Gaussian. Image edges are replicated.

import { LUMA_R, LUMA_G, LUMA_B } from "./image.js";

/**
 * Returns the box shape (2k+1 full-weight taps plus two edge taps of weight f) whose variance equals `v`.
 * @param {number} v target variance in px^2 (>= 0)
 * @returns {{k:number, f:number}}
 */
export function boxForVariance(v) {
  if (!(v > 0)) return { k: 0, f: 0 };
  const k = Math.max(0, Math.floor((-1 + Math.sqrt(1 + 12 * v)) / 2 + 1e-9));
  const s = (k * (k + 1) * (2 * k + 1)) / 6;
  let f = (v * (2 * k + 1) - 2 * s) / (2 * ((k + 1) * (k + 1) - v));
  if (f < 0) f = 0;
  if (f > 1) f = 1;
  return { k, f };
}

function padEdges(a, pad, n) {
  const l = a[pad];
  const r = a[pad + n - 1];
  for (let i = 0; i < pad; i++) {
    a[i] = l;
    a[pad + n + i] = r;
  }
}

function boxRow(P, Q, n, k, f, inv, pad) {
  let s = 0;
  const base = pad - k;
  for (let j = 0; j <= 2 * k; j++) s += P[base + j];
  if (f === 0) {
    for (let i = 0; i < n; i++) {
      Q[pad + i] = s * inv;
      s += P[pad + i + k + 1] - P[pad + i - k];
    }
  } else {
    for (let i = 0; i < n; i++) {
      Q[pad + i] = (s + f * (P[pad + i - k - 1] + P[pad + i + k + 1])) * inv;
      s += P[pad + i + k + 1] - P[pad + i - k];
    }
  }
}

function hBox(plane, w, h, k, f, passes) {
  const pad = k + 1;
  const len = w + 2 * pad;
  const A = new Float64Array(len);
  const B = new Float64Array(len);
  const inv = 1 / (2 * k + 1 + 2 * f);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) A[pad + x] = plane[o + x];
    padEdges(A, pad, w);
    let P = A;
    let Q = B;
    for (let p = 0; p < passes; p++) {
      boxRow(P, Q, w, k, f, inv, pad);
      if (p < passes - 1) padEdges(Q, pad, w);
      const t = P; P = Q; Q = t;
    }
    for (let x = 0; x < w; x++) plane[o + x] = P[pad + x];
  }
}

function clampRow(y, h) {
  return y < 0 ? 0 : y >= h ? h - 1 : y;
}

function vBoxPass(src, dst, w, h, k, f, acc) {
  const inv = 1 / (2 * k + 1 + 2 * f);
  for (let x = 0; x < w; x++) acc[x] = (k + 1) * src[x];
  for (let j = 1; j <= k; j++) {
    const o = (j < h ? j : h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += src[o + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const add = clampRow(y + k + 1, h) * w;
    const rem = clampRow(y - k, h) * w;
    if (f === 0) {
      for (let x = 0; x < w; x++) {
        const a = acc[x];
        dst[o + x] = a * inv;
        acc[x] = a + src[add + x] - src[rem + x];
      }
    } else {
      const ra = clampRow(y - k - 1, h) * w;
      for (let x = 0; x < w; x++) {
        const a = acc[x];
        const sa = src[add + x];
        dst[o + x] = (a + f * (src[ra + x] + sa)) * inv;
        acc[x] = a + sa - src[rem + x];
      }
    }
  }
}

function vBox(plane, scratch, w, h, k, f, passes) {
  const acc = new Float64Array(w);
  let src = plane;
  let dst = scratch;
  for (let p = 0; p < passes; p++) {
    vBoxPass(src, dst, w, h, k, f, acc);
    const t = src; src = dst; dst = t;
  }
  if (src !== plane) plane.set(src);
}

/**
 * Cache-blocked transpose of a w x h plane into `dst` (which is then h wide and w tall):
 * dst[x * h + y] = src[y * w + x].
 * @param {Float32Array} src
 * @param {Float32Array} dst
 * @param {number} w source width
 * @param {number} h source height
 */
export function transposePlane(src, dst, w, h) {
  const B = 32;
  for (let by = 0; by < h; by += B) {
    const ye = by + B < h ? by + B : h;
    for (let bx = 0; bx < w; bx += B) {
      const xe = bx + B < w ? bx + B : w;
      for (let y = by; y < ye; y++) {
        const so = y * w;
        for (let x = bx; x < xe; x++) dst[x * h + y] = src[so + x];
      }
    }
  }
}

/**
 * In-place box blur of a Float32 plane. A radius r gives a box of width 2r+1 (fractional radii use
 * fractional edge weights). Edges are replicated.
 * @param {Float32Array} plane w*h samples, modified in place
 * @param {Float32Array} scratch w*h scratch samples
 * @param {number} w
 * @param {number} h
 * @param {number} rx horizontal radius in px (>= 0)
 * @param {number} [ry=rx] vertical radius in px (>= 0)
 * @param {number} [passes=1] number of successive box passes
 */
export function boxBlurPlane(plane, scratch, w, h, rx, ry = rx, passes = 1) {
  if (w <= 0 || h <= 0) return;
  if (rx > 0) {
    const k = Math.floor(rx);
    hBox(plane, w, h, k, rx - k, passes);
  }
  if (ry > 0) {
    const k = Math.floor(ry);
    vBox(plane, scratch, w, h, k, ry - k, passes);
  }
}

/**
 * In-place Gaussian blur of a Float32 plane (three exact-variance box passes).
 * @param {Float32Array} plane w*h samples, modified in place
 * @param {Float32Array} scratch w*h scratch samples
 * @param {number} w
 * @param {number} h
 * @param {number} sigmaX horizontal standard deviation in px
 * @param {number} [sigmaY=sigmaX] vertical standard deviation in px
 */
export function gaussianBlurPlane(plane, scratch, w, h, sigmaX, sigmaY = sigmaX) {
  if (w <= 0 || h <= 0) return;
  if (sigmaX > 0.15) {
    const b = boxForVariance((sigmaX * sigmaX) / 3);
    hBox(plane, w, h, b.k, b.f, 3);
  }
  if (sigmaY > 0.15) {
    const b = boxForVariance((sigmaY * sigmaY) / 3);
    vBox(plane, scratch, w, h, b.k, b.f, 3);
  }
}

/**
 * Applies a per-plane blur to every channel of an RGBA image with correct premultiplied-alpha handling
 * (no dark fringes). Fully opaque images skip the alpha plane.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} src
 * @param {{width:number,height:number,data:Uint8ClampedArray}} dst may be `src`
 * @param {(plane:Float32Array, scratch:Float32Array) => void} blurPlane
 * @returns {{width:number,height:number,data:Uint8ClampedArray}} dst
 */
export function blurImageWith(src, dst, blurPlane) {
  const w = src.width;
  const h = src.height;
  const n = w * h;
  const d = src.data;
  const o = dst.data;
  if (n === 0) return dst;
  const plane = new Float32Array(n);
  const scratch = new Float32Array(n);
  let opaque = true;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) {
      opaque = false;
      break;
    }
  }
  if (opaque) {
    for (let c = 0; c < 3; c++) {
      for (let i = 0, j = c; i < n; i++, j += 4) plane[i] = d[j];
      blurPlane(plane, scratch);
      for (let i = 0, j = c; i < n; i++, j += 4) o[j] = plane[i];
    }
    if (o !== d) for (let j = 3; j < d.length; j += 4) o[j] = 255;
    return dst;
  }
  const alpha = new Float32Array(n);
  for (let i = 0, j = 3; i < n; i++, j += 4) alpha[i] = d[j];
  blurPlane(alpha, scratch);
  for (let c = 0; c < 3; c++) {
    for (let i = 0, j = c; i < n; i++, j += 4) plane[i] = d[j] * d[j + 3 - c] * (1 / 255);
    blurPlane(plane, scratch);
    for (let i = 0, j = c; i < n; i++, j += 4) {
      const a = alpha[i];
      if (a > 0.004) o[j] = (plane[i] * 255) / a;
      else if (o !== d) o[j] = d[j];
    }
  }
  for (let i = 0, j = 3; i < n; i++, j += 4) o[j] = alpha[i];
  return dst;
}

/**
 * Premultiplied-correct Gaussian blur of an RGBA image.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} src
 * @param {number} sigmaX horizontal standard deviation in px
 * @param {number} [sigmaY=sigmaX] vertical standard deviation in px
 * @param {{width:number,height:number,data:Uint8ClampedArray}} [dst=src] destination (same size)
 * @returns {{width:number,height:number,data:Uint8ClampedArray}} dst
 */
export function gaussianBlurImage(src, sigmaX, sigmaY = sigmaX, dst = src) {
  if (!(sigmaX > 0.15) && !(sigmaY > 0.15)) {
    if (dst !== src) dst.data.set(src.data);
    return dst;
  }
  const w = src.width;
  const h = src.height;
  return blurImageWith(src, dst, (p, s) => gaussianBlurPlane(p, s, w, h, sigmaX, sigmaY));
}

/**
 * Premultiplied-correct box blur of an RGBA image (box width 2r+1).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} src
 * @param {number} rx horizontal radius
 * @param {number} [ry=rx] vertical radius
 * @param {number} [passes=1]
 * @param {{width:number,height:number,data:Uint8ClampedArray}} [dst=src]
 * @returns {{width:number,height:number,data:Uint8ClampedArray}} dst
 */
export function boxBlurImage(src, rx, ry = rx, passes = 1, dst = src) {
  if (!(rx > 0) && !(ry > 0)) {
    if (dst !== src) dst.data.set(src.data);
    return dst;
  }
  const w = src.width;
  const h = src.height;
  return blurImageWith(src, dst, (p, s) => boxBlurPlane(p, s, w, h, rx, ry, passes));
}

/**
 * Fills a Float32 plane with the luma (0..255) of an RGBA image. Transparent pixels borrow the luma of
 * the nearest opaque pixel to their left/right in the same row so blurs of the plane do not bleed
 * a bogus tone over edges.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {Float32Array} out w*h
 * @returns {Float32Array} out
 */
export function lumaPlane(img, out) {
  const w = img.width;
  const h = img.height;
  const d = img.data;
  let sum = 0;
  let cnt = 0;
  let anyTransparent = false;
  for (let i = 0, j = 0, n = w * h; i < n; i++, j += 4) {
    const l = LUMA_R * d[j] + LUMA_G * d[j + 1] + LUMA_B * d[j + 2];
    out[i] = l;
    if (d[j + 3] === 0) anyTransparent = true;
    else {
      sum += l;
      cnt++;
    }
  }
  if (!anyTransparent) return out;
  const fallback = cnt ? sum / cnt : 128;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (d[(o + x) * 4 + 3] !== 0) last = out[o + x];
      else if (last >= 0) out[o + x] = last;
      else out[o + x] = NaN;
    }
    let next = fallback;
    for (let x = w - 1; x >= 0; x--) {
      if (d[(o + x) * 4 + 3] !== 0) next = out[o + x];
      else if (out[o + x] !== out[o + x]) out[o + x] = next;
    }
  }
  return out;
}

/**
 * Self-guided edge-preserving smoothing (He et al. guided filter with the plane as its own guide).
 * @param {Float32Array} I input plane (also the guide)
 * @param {number} w
 * @param {number} h
 * @param {number} radius box radius in px
 * @param {number} eps regularisation in plane units squared (larger = smoother)
 * @param {Float32Array} out output plane (may be `I`)
 * @param {Float32Array} scratch w*h scratch
 * @returns {Float32Array} out
 */
export function guidedFilterSelf(I, w, h, radius, eps, out, scratch) {
  const n = w * h;
  const A = new Float32Array(n);
  const C = new Float32Array(n);
  A.set(I);
  for (let i = 0; i < n; i++) C[i] = I[i] * I[i];
  boxBlurPlane(A, scratch, w, h, radius);
  boxBlurPlane(C, scratch, w, h, radius);
  for (let i = 0; i < n; i++) {
    const m = A[i];
    const v = C[i] - m * m;
    const a = v / (v + eps);
    C[i] = a;
    A[i] = (1 - a) * m;
  }
  boxBlurPlane(C, scratch, w, h, radius);
  boxBlurPlane(A, scratch, w, h, radius);
  for (let i = 0; i < n; i++) out[i] = C[i] * I[i] + A[i];
  return out;
}

/**
 * Guided filter: smooths `P` while following the edges of the guide `I`.
 * @param {Float32Array} I guide plane
 * @param {Float32Array} P plane to filter
 * @param {number} w
 * @param {number} h
 * @param {number} radius box radius in px
 * @param {number} eps regularisation in plane units squared
 * @param {Float32Array} out output plane (may be `P`)
 * @param {Float32Array} scratch w*h scratch
 * @returns {Float32Array} out
 */
export function guidedFilter(I, P, w, h, radius, eps, out, scratch) {
  const n = w * h;
  const mI = new Float32Array(n);
  const mP = new Float32Array(n);
  const cII = new Float32Array(n);
  const cIP = new Float32Array(n);
  mI.set(I);
  mP.set(P);
  for (let i = 0; i < n; i++) {
    cII[i] = I[i] * I[i];
    cIP[i] = I[i] * P[i];
  }
  boxBlurPlane(mI, scratch, w, h, radius);
  boxBlurPlane(mP, scratch, w, h, radius);
  boxBlurPlane(cII, scratch, w, h, radius);
  boxBlurPlane(cIP, scratch, w, h, radius);
  for (let i = 0; i < n; i++) {
    const v = cII[i] - mI[i] * mI[i];
    const c = cIP[i] - mI[i] * mP[i];
    const a = c / (v + eps);
    cII[i] = a;
    cIP[i] = mP[i] - a * mI[i];
  }
  boxBlurPlane(cII, scratch, w, h, radius);
  boxBlurPlane(cIP, scratch, w, h, radius);
  for (let i = 0; i < n; i++) out[i] = cII[i] * I[i] + cIP[i];
  return out;
}
