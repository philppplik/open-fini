// Retouching: per-dab brush operations (smudge, blur, sharpen, dodge/burn, sponge, clone, heal),
// automatic spot healing and red-eye removal. Mask inpainting (Content-Aware Fill) is in inpaint.js (lazy).
//
// Every dab function receives a brush falloff from makeBrushFalloff(diameter, hardness) (a d x d
// Float32Array, d = side length) and a dab CENTER in image pixels. Each returns the dirty rectangle it
// touched ({x, y, width, height}, width 0 when nothing changed). Scratch buffers are module level and
// reused between dabs, so strokes do not allocate per dab.

import { clamp01, smoothstep, LUMA_R, LUMA_G, LUMA_B } from "./image.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

const EMPTY = () => ({ x: 0, y: 0, width: 0, height: 0 });

const _pool = Object.create(null);
function scratch(key, n) {
  let b = _pool[key];
  if (!b || b.length < n) {
    b = new Float32Array(Math.max(n, 1024));
    _pool[key] = b;
  }
  return b;
}

/**
 * Brush falloff table: a d x d grid of opacity multipliers (0..1), d = round(diameter). Fully opaque inside
 * `hardness` * radius, smoothly fading to 0 at the radius, with an anti-aliased rim.
 * @param {number} diameter brush diameter in px
 * @param {number} hardness 0 (very soft) .. 1 (hard edge)
 * @returns {Float32Array} d*d values, row major
 */
export function makeBrushFalloff(diameter, hardness) {
  const d = Math.max(1, Math.round(diameter));
  const out = new Float32Array(d * d);
  const R = d / 2;
  const hd = clamp01(hardness);
  const inner = hd * R;
  for (let y = 0; y < d; y++) {
    const dy = y + 0.5 - R;
    for (let x = 0; x < d; x++) {
      const dx = x + 0.5 - R;
      const r = Math.sqrt(dx * dx + dy * dy);
      let v;
      if (r <= inner) v = 1;
      else if (R - inner < 1e-6) v = 1;
      else {
        const t = (r - inner) / (R - inner);
        v = t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
      }
      const rim = R - r + 0.5;
      if (rim < 1) v *= rim < 0 ? 0 : rim;
      out[y * d + x] = v;
    }
  }
  return out;
}

/**
 * Side length d of a falloff table made by {@link makeBrushFalloff}.
 * @param {Float32Array} falloff
 * @returns {number}
 */
export function brushSize(falloff) {
  return Math.round(Math.sqrt(falloff.length));
}

// Top-left corner of the d x d dab centered at c.
function topLeft(c, d) {
  return Math.round(c - d / 2);
}

function clipDab(img, x0, y0, d) {
  const x1 = Math.min(img.width, x0 + d);
  const y1 = Math.min(img.height, y0 + d);
  const cx = Math.max(0, x0);
  const cy = Math.max(0, y0);
  if (x1 <= cx || y1 <= cy) return EMPTY();
  return { x: cx, y: cy, width: x1 - cx, height: y1 - cy };
}

// Loads (x0, y0, w, h) of the image as premultiplied floats. Outside the image the samples are either
// edge-clamped (clampEdges) or marked invalid with alpha = -1 (skipped when blending).
function loadPremult(img, x0, y0, w, h, out, clampEdges) {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  for (let j = 0; j < h; j++) {
    const y = y0 + j;
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      const o = (j * w + i) * 4;
      let sx = x, sy = y;
      if (x < 0 || y < 0 || x >= W || y >= H) {
        if (!clampEdges) {
          out[o] = out[o + 1] = out[o + 2] = 0;
          out[o + 3] = -1;
          continue;
        }
        sx = x < 0 ? 0 : x >= W ? W - 1 : x;
        sy = y < 0 ? 0 : y >= H ? H - 1 : y;
      }
      const p = (sy * W + sx) * 4;
      const a = d[p + 3];
      const k = a * (1 / 255);
      out[o] = d[p] * k;
      out[o + 1] = d[p + 1] * k;
      out[o + 2] = d[p + 2] * k;
      out[o + 3] = a;
    }
  }
}

// out = lerp(current pixel, res, falloff * k) in premultiplied space, for the d x d dab at (x0, y0).
// `res` is a d x d premultiplied float buffer; `resStride` its row width in pixels, offset (ox, oy) of the dab inside it.
function blendPremult(img, x0, y0, d, res, resStride, ox, oy, falloff, k) {
  const W = img.width;
  const H = img.height;
  const data = img.data;
  for (let j = 0; j < d; j++) {
    const y = y0 + j;
    if (y < 0 || y >= H) continue;
    for (let i = 0; i < d; i++) {
      const x = x0 + i;
      if (x < 0 || x >= W) continue;
      const f = falloff[j * d + i] * k;
      if (f <= 0.0005) continue;
      const p = (y * W + x) * 4;
      const ro = ((j + oy) * resStride + (i + ox)) * 4;
      const a1 = res[ro + 3];
      if (a1 < 0) continue;
      const a0 = data[p + 3];
      const k0 = a0 * (1 / 255);
      const a = a0 + (a1 - a0) * f;
      if (a <= 0.0005) {
        data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0;
        continue;
      }
      const r = data[p] * k0 + (res[ro] - data[p] * k0) * f;
      const g = data[p + 1] * k0 + (res[ro + 1] - data[p + 1] * k0) * f;
      const b = data[p + 2] * k0 + (res[ro + 2] - data[p + 2] * k0) * f;
      const inv = 255 / a;
      data[p] = r * inv;
      data[p + 1] = g * inv;
      data[p + 2] = b * inv;
      data[p + 3] = a;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Smudge
// ---------------------------------------------------------------------------------------------

/**
 * Creates the carried state for {@link smudgeDab}; make one per stroke.
 * @returns {{pickup: Float32Array|null, size: number}}
 */
export function createSmudgeState() {
  return { pickup: null, size: 0 };
}

/**
 * Smudge ("finger painting") dab. The first dab of a stroke only picks up the color under the brush;
 * every following dab paints the carried color and picks up what is under the brush for the next one.
 * @param {RGBAImage} img modified in place
 * @param {number} cx dab center x
 * @param {number} cy dab center y
 * @param {Float32Array} falloff brush falloff
 * @param {number} d falloff side length
 * @param {number} strength 0..1 how much of the carried color is applied
 * @param {{pickup: Float32Array|null, size: number}} state from {@link createSmudgeState}
 * @returns {Rect} dirty rect
 */
export function smudgeDab(img, cx, cy, falloff, d, strength, state) {
  const x0 = topLeft(cx, d);
  const y0 = topLeft(cy, d);
  const first = !state.pickup || state.size !== d;
  if (first) {
    state.pickup = new Float32Array(d * d * 4);
    state.size = d;
    loadPremult(img, x0, y0, d, d, state.pickup);
    return EMPTY();
  }
  blendPremult(img, x0, y0, d, state.pickup, d, 0, 0, falloff, clamp01(strength));
  loadPremult(img, x0, y0, d, d, state.pickup);
  return clipDab(img, x0, y0, d);
}

// ---------------------------------------------------------------------------------------------
// Blur / sharpen
// ---------------------------------------------------------------------------------------------

// Separable [1 2 1]/4 passes on a w x h premultiplied RGBA float region (clamped edges).
function binomialBlur(buf, tmp, w, h, passes) {
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        const l = row + (x > 0 ? x - 1 : 0) * 4;
        const c = row + x * 4;
        const r = row + (x < w - 1 ? x + 1 : x) * 4;
        for (let k = 0; k < 4; k++) tmp[c + k] = 0.25 * buf[l + k] + 0.5 * buf[c + k] + 0.25 * buf[r + k];
      }
    }
    for (let y = 0; y < h; y++) {
      const u = (y > 0 ? y - 1 : 0) * w * 4;
      const c = y * w * 4;
      const dn = (y < h - 1 ? y + 1 : y) * w * 4;
      for (let i = 0; i < w * 4; i++) buf[c + i] = 0.25 * tmp[u + i] + 0.5 * tmp[c + i] + 0.25 * tmp[dn + i];
    }
  }
}

/**
 * Blur brush dab.
 * @param {RGBAImage} img modified in place
 * @param {number} cx dab center x
 * @param {number} cy dab center y
 * @param {Float32Array} falloff brush falloff
 * @param {number} d falloff side length
 * @param {number} strength 0..1
 * @returns {Rect} dirty rect
 */
export function blurDab(img, cx, cy, falloff, d, strength) {
  const x0 = topLeft(cx, d);
  const y0 = topLeft(cy, d);
  const rect = clipDab(img, x0, y0, d);
  if (rect.width === 0) return rect;
  const passes = Math.max(1, Math.min(6, Math.round(d / 8)));
  const m = passes;
  const w = d + 2 * m;
  const buf = scratch("blurA", w * w * 4);
  const tmp = scratch("blurB", w * w * 4);
  loadPremult(img, x0 - m, y0 - m, w, w, buf, true);
  binomialBlur(buf, tmp, w, w, passes);
  blendPremult(img, x0, y0, d, buf, w, m, m, falloff, clamp01(strength));
  return rect;
}

/**
 * Sharpen brush dab (local unsharp mask on a small neighborhood).
 * @param {RGBAImage} img modified in place
 * @param {number} cx dab center x
 * @param {number} cy dab center y
 * @param {Float32Array} falloff brush falloff
 * @param {number} d falloff side length
 * @param {number} strength 0..1
 * @returns {Rect} dirty rect
 */
export function sharpenDab(img, cx, cy, falloff, d, strength) {
  const x0 = topLeft(cx, d);
  const y0 = topLeft(cy, d);
  const rect = clipDab(img, x0, y0, d);
  if (rect.width === 0) return rect;
  const passes = Math.max(1, Math.min(3, Math.round(d / 40)));
  const m = passes;
  const w = d + 2 * m;
  const buf = scratch("blurA", w * w * 4);
  const tmp = scratch("blurB", w * w * 4);
  loadPremult(img, x0 - m, y0 - m, w, w, buf, true);
  binomialBlur(buf, tmp, w, w, passes);
  const W = img.width;
  const H = img.height;
  const data = img.data;
  const amount = 2 * clamp01(strength);
  for (let j = 0; j < d; j++) {
    const y = y0 + j;
    if (y < 0 || y >= H) continue;
    for (let i = 0; i < d; i++) {
      const x = x0 + i;
      if (x < 0 || x >= W) continue;
      const f = falloff[j * d + i] * amount;
      if (f <= 0.0005) continue;
      const p = (y * W + x) * 4;
      if (data[p + 3] === 0) continue;
      const bo = ((j + m) * w + (i + m)) * 4;
      const ba = buf[bo + 3];
      if (ba <= 0.01) continue;
      const s = 255 / ba;
      data[p] += (data[p] - buf[bo] * s) * f;
      data[p + 1] += (data[p + 1] - buf[bo + 1] * s) * f;
      data[p + 2] += (data[p + 2] - buf[bo + 2] * s) * f;
    }
  }
  return rect;
}

// ---------------------------------------------------------------------------------------------
// Dodge / burn / sponge
// ---------------------------------------------------------------------------------------------

/**
 * Dodge (lighten) or burn (darken) brush dab, restricted to a tonal range.
 * @param {RGBAImage} img modified in place
 * @param {number} cx dab center x
 * @param {number} cy dab center y
 * @param {Float32Array} falloff brush falloff
 * @param {number} d falloff side length
 * @param {{mode?: 'dodge'|'burn', range?: 'shadows'|'midtones'|'highlights', exposure?: number}} [opts]
 *   exposure 0..1 (default 0.5)
 * @returns {Rect} dirty rect
 */
export function dodgeBurnDab(img, cx, cy, falloff, d, opts = {}) {
  const x0 = topLeft(cx, d);
  const y0 = topLeft(cy, d);
  const rect = clipDab(img, x0, y0, d);
  if (rect.width === 0) return rect;
  const dodge = (opts.mode || "dodge") === "dodge";
  const range = opts.range || "midtones";
  const exposure = clamp01(opts.exposure === undefined ? 0.5 : opts.exposure) * 0.5;
  const W = img.width;
  const data = img.data;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const f = falloff[(y - y0) * d + (x - x0)] * exposure;
      if (f <= 0.0005) continue;
      const p = (y * W + x) * 4;
      if (data[p + 3] === 0) continue;
      const l = (LUMA_R * data[p] + LUMA_G * data[p + 1] + LUMA_B * data[p + 2]) / 255;
      let w;
      if (range === "shadows") w = (1 - l) * (1 - l);
      else if (range === "highlights") w = l * l;
      else w = 4 * l * (1 - l);
      const a = f * w;
      if (dodge) {
        data[p] += (255 - data[p]) * a;
        data[p + 1] += (255 - data[p + 1]) * a;
        data[p + 2] += (255 - data[p + 2]) * a;
      } else {
        const k = 1 - a;
        data[p] *= k;
        data[p + 1] *= k;
        data[p + 2] *= k;
      }
    }
  }
  return rect;
}

/**
 * Sponge brush dab: locally saturates or desaturates.
 * @param {RGBAImage} img modified in place
 * @param {number} cx dab center x
 * @param {number} cy dab center y
 * @param {Float32Array} falloff brush falloff
 * @param {number} d falloff side length
 * @param {{mode?: 'saturate'|'desaturate', flow?: number}} [opts] flow 0..1 (default 0.5)
 * @returns {Rect} dirty rect
 */
export function spongeDab(img, cx, cy, falloff, d, opts = {}) {
  const x0 = topLeft(cx, d);
  const y0 = topLeft(cy, d);
  const rect = clipDab(img, x0, y0, d);
  if (rect.width === 0) return rect;
  const sat = (opts.mode || "saturate") === "saturate";
  const flow = clamp01(opts.flow === undefined ? 0.5 : opts.flow);
  const W = img.width;
  const data = img.data;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const f = falloff[(y - y0) * d + (x - x0)] * flow;
      if (f <= 0.0005) continue;
      const p = (y * W + x) * 4;
      if (data[p + 3] === 0) continue;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const l = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      let k;
      if (sat) {
        const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
        const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
        const s = mx > 0 ? (mx - mn) / mx : 0;
        k = 1 + f * (1 - s) * 1.0;
      } else {
        k = 1 - f;
      }
      data[p] = l + (r - l) * k;
      data[p + 1] = l + (g - l) * k;
      data[p + 2] = l + (b - l) * k;
    }
  }
  return rect;
}

// ---------------------------------------------------------------------------------------------
// Clone / heal
// ---------------------------------------------------------------------------------------------

/**
 * Clone stamp dab: copies the d x d area centered at (sx, sy) of `srcImg` onto the area centered at
 * (dx, dy) of `img`, weighted by `falloff * opacity` (premultiplied blend). `srcImg` may be `img`.
 * Source pixels outside `srcImg` are skipped.
 * @param {RGBAImage} img destination, modified in place
 * @param {RGBAImage} srcImg source image
 * @param {number} sx source center x
 * @param {number} sy source center y
 * @param {number} dx destination center x
 * @param {number} dy destination center y
 * @param {Float32Array} falloff brush falloff
 * @param {number} d falloff side length
 * @param {number} opacity 0..1
 * @returns {Rect} dirty rect
 */
export function cloneDab(img, srcImg, sx, sy, dx, dy, falloff, d, opacity) {
  const dx0 = topLeft(dx, d);
  const dy0 = topLeft(dy, d);
  const sx0 = topLeft(sx, d);
  const sy0 = topLeft(sy, d);
  const rect = clipDab(img, dx0, dy0, d);
  if (rect.width === 0) return rect;
  const buf = scratch("cloneSrc", d * d * 4);
  loadPremult(srcImg, sx0, sy0, d, d, buf);
  blendPremult(img, dx0, dy0, d, buf, d, 0, 0, falloff, clamp01(opacity));
  return rect;
}

// Fills `field` (per-node RGB offsets) over a coarse grid: known nodes (weight > 0) keep their average,
// unknown nodes are filled by diffusion.
function diffuseGrid(field, wsum, G) {
  const n = G * G;
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (wsum[i] > 0) {
      known[i] = 1;
      field[i * 3] /= wsum[i];
      field[i * 3 + 1] /= wsum[i];
      field[i * 3 + 2] /= wsum[i];
    }
  }
  let nk = 0;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    if (known[i]) {
      nk++;
      mr += field[i * 3];
      mg += field[i * 3 + 1];
      mb += field[i * 3 + 2];
    }
  }
  if (nk === 0) return false;
  if (nk === n) return true;
  for (let i = 0; i < n; i++) {
    if (!known[i]) {
      field[i * 3] = mr / nk;
      field[i * 3 + 1] = mg / nk;
      field[i * 3 + 2] = mb / nk;
    }
  }
  const iters = 40 + 4 * G;
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const i = y * G + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        if (x > 0) { const k = (i - 1) * 3; r += field[k]; g += field[k + 1]; b += field[k + 2]; c++; }
        if (x < G - 1) { const k = (i + 1) * 3; r += field[k]; g += field[k + 1]; b += field[k + 2]; c++; }
        if (y > 0) { const k = (i - G) * 3; r += field[k]; g += field[k + 1]; b += field[k + 2]; c++; }
        if (y < G - 1) { const k = (i + G) * 3; r += field[k]; g += field[k + 1]; b += field[k + 2]; c++; }
        field[i * 3] = r / c;
        field[i * 3 + 1] = g / c;
        field[i * 3 + 2] = b / c;
      }
    }
  }
  return true;
}

/**
 * Healing brush dab: like {@link cloneDab}, but the copied texture is color- and tone-matched to
 * its destination. The difference between destination and source along a ring just outside the brush is
 * interpolated smoothly across the dab and added to the source, so seams vanish.
 * @param {RGBAImage} img destination, modified in place
 * @param {RGBAImage} srcImg source image (may be `img`)
 * @param {number} sx source center x
 * @param {number} sy source center y
 * @param {number} dx destination center x
 * @param {number} dy destination center y
 * @param {Float32Array} falloff brush falloff
 * @param {number} d falloff side length
 * @param {number} [opacity=1] 0..1
 * @returns {Rect} dirty rect
 */
export function healPatch(img, srcImg, sx, sy, dx, dy, falloff, d, opacity = 1) {
  const dx0 = topLeft(dx, d);
  const dy0 = topLeft(dy, d);
  const sx0 = topLeft(sx, d);
  const sy0 = topLeft(sy, d);
  const rect = clipDab(img, dx0, dy0, d);
  if (rect.width === 0) return rect;
  const M = 3;
  const e = d + 2 * M;
  const R = d / 2;
  const D = scratch("healD", e * e * 4);
  const Sg = scratch("healS", e * e * 4);
  // straight (non-premultiplied) copies with alpha
  const load = (im, x0, y0, out) => {
    const W = im.width, H = im.height, data = im.data;
    for (let j = 0; j < e; j++) {
      const y = y0 + j;
      for (let i = 0; i < e; i++) {
        const x = x0 + i;
        const o = (j * e + i) * 4;
        if (x < 0 || y < 0 || x >= W || y >= H) {
          out[o + 3] = -1;
          continue;
        }
        const p = (y * W + x) * 4;
        out[o] = data[p];
        out[o + 1] = data[p + 1];
        out[o + 2] = data[p + 2];
        out[o + 3] = data[p + 3];
      }
    }
  };
  load(img, dx0 - M, dy0 - M, D);
  load(srcImg, sx0 - M, sy0 - M, Sg);
  const g = Math.max(2, Math.round(d / 8));
  const G = Math.ceil(e / g);
  const field = new Float32Array(G * G * 3);
  const wsum = new Float32Array(G * G);
  const c = e / 2;
  // ring: pixels outside the brush disc but within M px of it
  for (let j = 0; j < e; j++) {
    for (let i = 0; i < e; i++) {
      const o = (j * e + i) * 4;
      if (D[o + 3] <= 0 || Sg[o + 3] <= 0) continue;
      const ddx = i + 0.5 - c, ddy = j + 0.5 - c;
      const r = Math.sqrt(ddx * ddx + ddy * ddy);
      if (r < R - 0.5 || r > R + M) continue;
      const gi = ((j / g) | 0) * G + ((i / g) | 0);
      field[gi * 3] += D[o] - Sg[o];
      field[gi * 3 + 1] += D[o + 1] - Sg[o + 1];
      field[gi * 3 + 2] += D[o + 2] - Sg[o + 2];
      wsum[gi] += 1;
    }
  }
  const have = diffuseGrid(field, wsum, G);
  const W = img.width;
  const H = img.height;
  const data = img.data;
  const op = clamp01(opacity);
  for (let j = 0; j < d; j++) {
    const y = dy0 + j;
    if (y < 0 || y >= H) continue;
    for (let i = 0; i < d; i++) {
      const x = dx0 + i;
      if (x < 0 || x >= W) continue;
      const f = falloff[j * d + i] * op;
      if (f <= 0.0005) continue;
      const o = ((j + M) * e + (i + M)) * 4;
      const sa = Sg[o + 3];
      if (sa <= 0) continue;
      let mr = 0, mg = 0, mb = 0;
      if (have) {
        // bilinear interpolation of the coarse offset field at node centers
        const fx = (i + M + 0.5) / g - 0.5;
        const fy = (j + M + 0.5) / g - 0.5;
        let gx0 = Math.floor(fx), gy0 = Math.floor(fy);
        const tx = fx - gx0, ty = fy - gy0;
        let gx1 = gx0 + 1, gy1 = gy0 + 1;
        gx0 = gx0 < 0 ? 0 : gx0 >= G ? G - 1 : gx0;
        gx1 = gx1 < 0 ? 0 : gx1 >= G ? G - 1 : gx1;
        gy0 = gy0 < 0 ? 0 : gy0 >= G ? G - 1 : gy0;
        gy1 = gy1 < 0 ? 0 : gy1 >= G ? G - 1 : gy1;
        const i00 = (gy0 * G + gx0) * 3, i10 = (gy0 * G + gx1) * 3, i01 = (gy1 * G + gx0) * 3, i11 = (gy1 * G + gx1) * 3;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        mr = field[i00] * w00 + field[i10] * w10 + field[i01] * w01 + field[i11] * w11;
        mg = field[i00 + 1] * w00 + field[i10 + 1] * w10 + field[i01 + 1] * w01 + field[i11 + 1] * w11;
        mb = field[i00 + 2] * w00 + field[i10 + 2] * w10 + field[i01 + 2] * w01 + field[i11 + 2] * w11;
      }
      const p = (y * W + x) * 4;
      const da = data[p + 3];
      const nr = Sg[o] + mr, ng = Sg[o + 1] + mg, nb = Sg[o + 2] + mb;
      if (da === 0) {
        data[p] = nr; data[p + 1] = ng; data[p + 2] = nb; data[p + 3] = sa * f;
        continue;
      }
      data[p] += (nr - data[p]) * f;
      data[p + 1] += (ng - data[p + 1]) * f;
      data[p + 2] += (nb - data[p + 2]) * f;
      data[p + 3] = da + (sa - da) * f;
    }
  }
  return rect;
}

/**
 * Spot healing: removes a blemish centered at (cx, cy) by sampling a matching patch from the
 * surroundings automatically (the candidate whose neighborhood ring best matches wins) and healing it in.
 * @param {RGBAImage} img modified in place
 * @param {number} cx blemish center x
 * @param {number} cy blemish center y
 * @param {number} radius brush radius in px
 * @returns {Rect} dirty rect
 */
export function spotHeal(img, cx, cy, radius) {
  const r = Math.max(1, radius);
  const d = Math.max(2, Math.round(r * 2 * 1.15));
  const falloff = makeBrushFalloff(d, 0.55);
  const W = img.width;
  const H = img.height;
  const data = img.data;
  // ring samples around the target
  const nS = 48;
  const rs = [r * 1.25, r * 1.55];
  let best = null;
  let bestCost = Infinity;
  const dists = [2.4 * r, 3.4 * r, 4.8 * r, 6.5 * r];
  for (let ang = 0; ang < 24; ang++) {
    const a = (ang / 24) * Math.PI * 2;
    for (const dist of dists) {
      const ox = Math.cos(a) * dist;
      const oy = Math.sin(a) * dist;
      const scx = cx + ox, scy = cy + oy;
      if (scx - d / 2 < 0 || scy - d / 2 < 0 || scx + d / 2 > W || scy + d / 2 > H) continue;
      let cost = 0;
      let cnt = 0;
      for (let k = 0; k < nS; k++) {
        const t = (k / nS) * Math.PI * 2;
        const ct = Math.cos(t), st = Math.sin(t);
        for (let q = 0; q < rs.length; q++) {
          const px = Math.round(cx + ct * rs[q]), py = Math.round(cy + st * rs[q]);
          const qx = Math.round(scx + ct * rs[q]), qy = Math.round(scy + st * rs[q]);
          if (px < 0 || py < 0 || px >= W || py >= H || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          const p = (py * W + px) * 4, s = (qy * W + qx) * 4;
          const dr = data[p] - data[s], dg = data[p + 1] - data[s + 1], db = data[p + 2] - data[s + 2];
          cost += dr * dr + dg * dg + db * db;
          cnt++;
        }
      }
      if (cnt < nS) continue;
      // prefer smooth source patches: add the variance of the candidate center region
      const cxi = Math.round(scx), cyi = Math.round(scy);
      let m = 0, v = 0, n = 0;
      for (let yy = -2; yy <= 2; yy++) {
        for (let xx = -2; xx <= 2; xx++) {
          const s = (Math.min(H - 1, Math.max(0, cyi + yy)) * W + Math.min(W - 1, Math.max(0, cxi + xx))) * 4;
          const l = data[s] + data[s + 1] + data[s + 2];
          m += l;
          v += l * l;
          n++;
        }
      }
      v = v / n - (m / n) * (m / n);
      cost = cost / cnt + 0.15 * v;
      if (cost < bestCost) {
        bestCost = cost;
        best = [scx, scy];
      }
    }
  }
  if (!best) return EMPTY();
  return healPatch(img, img, best[0], best[1], cx, cy, falloff, d, 1);
}

// ---------------------------------------------------------------------------------------------
// Red eye
// ---------------------------------------------------------------------------------------------

/**
 * Removes red eye inside `rect`: pixels where red dominates green and blue by more than `threshold` are
 * neutralized and darkened, with a smooth transition at the boundary of the red area.
 * @param {RGBAImage} img modified in place
 * @param {Rect} rect region to inspect (clipped to the image)
 * @param {{threshold?: number}} [opts] minimum amount (0..255) by which red must exceed max(green, blue); default 50
 * @returns {Rect} bounding box of the pixels that were changed
 */
export function removeRedEye(img, rect, opts = {}) {
  const thr = opts.threshold === undefined ? 50 : opts.threshold;
  const W = img.width;
  const H = img.height;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(W, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(H, Math.ceil(rect.y + rect.height));
  const d = img.data;
  let mx0 = W, my0 = H, mx1 = -1, my1 = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const j = (y * W + x) * 4;
      if (d[j + 3] === 0) continue;
      const r = d[j], g = d[j + 1], b = d[j + 2];
      const gb = g > b ? g : b;
      const red = r - gb;
      if (red <= thr || r < 60) continue;
      const w = smoothstep(thr, thr + 40, red);
      const target = (g + b) * 0.5;
      const nr = r + (Math.min(r, target) - r) * w;
      const dark = 1 - 0.35 * w;
      d[j] = nr * dark;
      d[j + 1] = g * dark;
      d[j + 2] = b * dark;
      if (x < mx0) mx0 = x;
      if (x > mx1) mx1 = x;
      if (y < my0) my0 = y;
      if (y > my1) my1 = y;
    }
  }
  if (mx1 < 0) return EMPTY();
  return { x: mx0, y: my0, width: mx1 - mx0 + 1, height: my1 - my0 + 1 };
}
