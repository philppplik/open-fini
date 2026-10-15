// Histograms, statistics and "auto" corrections. The auto helpers return parameter objects that can be
// passed straight to ADJUSTMENTS.levels, e.g.
//   applyAdjustment(img, { kind: 'levels', params: autoLevels(img) })

import { luma8, clampByte, toHex } from "./image.js";

/**
 * @typedef {{ r: Uint32Array, g: Uint32Array, b: Uint32Array, luma: Uint32Array, count: number }} Histogram
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/**
 * 256-bin histograms of an image. Pixels with alpha 0 (and pixels outside the mask) are skipped;
 * `count` is the number of pixels that were counted.
 * @param {RGBAImage} img
 * @param {{mask?: {width:number,height:number,data:Uint8Array}, minAlpha?: number, maskThreshold?: number}} [opts]
 *   `mask`: only pixels with mask >= maskThreshold (default 128) are counted; `minAlpha` (default 1) is the
 *   smallest alpha that counts
 * @returns {Histogram}
 */
export function histogram(img, opts = {}) {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);
  const d = img.data;
  const n = img.width * img.height;
  const mask = opts.mask ? opts.mask.data : null;
  if (opts.mask && (opts.mask.width !== img.width || opts.mask.height !== img.height)) throw new RangeError("histogram: mask size mismatch");
  const minA = opts.minAlpha === undefined ? 1 : opts.minAlpha;
  const mt = opts.maskThreshold === undefined ? 128 : opts.maskThreshold;
  let count = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] < minA) continue;
    if (mask && mask[i] < mt) continue;
    const R = d[j], G = d[j + 1], B = d[j + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    luma[luma8(R, G, B)]++;
    count++;
  }
  return { r, g, b, luma, count };
}

/**
 * Summary of one 256-bin histogram channel.
 * @param {Uint32Array} h
 * @returns {{min:number, max:number, mean:number, median:number, stddev:number, count:number}}
 */
export function channelStats(h) {
  let count = 0, sum = 0, min = -1, max = -1;
  for (let v = 0; v < 256; v++) {
    const c = h[v];
    if (!c) continue;
    if (min < 0) min = v;
    max = v;
    count += c;
    sum += c * v;
  }
  if (!count) return { min: 0, max: 0, mean: 0, median: 0, stddev: 0, count: 0 };
  const mean = sum / count;
  let vs = 0;
  let cum = 0;
  let median = 0;
  let found = false;
  for (let v = 0; v < 256; v++) {
    const c = h[v];
    if (!c) continue;
    vs += c * (v - mean) * (v - mean);
    cum += c;
    if (!found && cum * 2 >= count) {
      median = v;
      found = true;
    }
  }
  return { min, max, mean, median, stddev: Math.sqrt(vs / count), count };
}

/**
 * Per-channel statistics of an image or of a histogram returned by {@link histogram}.
 * @param {RGBAImage|Histogram} source
 * @param {{mask?: object}} [opts] forwarded to {@link histogram} when `source` is an image
 * @returns {{r:object, g:object, b:object, luma:object, count:number}}
 */
export function stats(source, opts) {
  const h = source.luma ? source : histogram(source, opts);
  return { r: channelStats(h.r), g: channelStats(h.g), b: channelStats(h.b), luma: channelStats(h.luma), count: h.count };
}

/**
 * Value below which `p` (0..1) of the samples lie.
 * @param {Uint32Array} h 256-bin histogram
 * @param {number} p fraction 0..1
 * @returns {number} bin 0..255
 */
export function percentile(h, p) {
  let total = 0;
  for (let v = 0; v < 256; v++) total += h[v];
  if (!total) return 0;
  const target = p * total;
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += h[v];
    if (cum > target) return v;
  }
  return 255;
}

// Black / white points after discarding `clip` (fraction) of the darkest and brightest samples.
function clipPoints(h, clip) {
  let total = 0;
  for (let v = 0; v < 256; v++) total += h[v];
  if (!total) return [0, 255];
  const cut = total * clip;
  let cum = 0;
  let lo = 0;
  for (let v = 0; v < 256; v++) {
    cum += h[v];
    if (cum > cut) {
      lo = v;
      break;
    }
  }
  cum = 0;
  let hi = 255;
  for (let v = 255; v >= 0; v--) {
    cum += h[v];
    if (cum > cut) {
      hi = v;
      break;
    }
  }
  return [lo, hi];
}

const LEVELS_IDENTITY = () => ({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255, channel: "rgb", channels: null });

/**
 * Auto Levels: stretches every channel independently between its own clipped black and white
 * points (this can shift colors, like Photoshop's Auto Levels). Returns params for ADJUSTMENTS.levels.
 * @param {RGBAImage|Histogram} img image or its histogram
 * @param {{clip?: number, mask?: object}} [opts] `clip` = percent of pixels ignored at each end (default 0.1)
 * @returns {object} levels params
 */
export function autoLevels(img, opts = {}) {
  const h = img.luma ? img : histogram(img, opts);
  const clip = (opts.clip === undefined ? 0.1 : opts.clip) / 100;
  const out = LEVELS_IDENTITY();
  out.channels = {};
  [["red", h.r], ["green", h.g], ["blue", h.b]].forEach(([name, hist]) => {
    const [lo, hi] = clipPoints(hist, clip);
    out.channels[name] = hi - lo >= 1 ? { inBlack: lo, inWhite: hi, gamma: 1 } : { inBlack: 0, inWhite: 255, gamma: 1 };
  });
  return out;
}

/**
 * Auto Contrast: one shared black/white point for all channels (colors keep their relationships).
 * Returns params for ADJUSTMENTS.levels.
 * @param {RGBAImage|Histogram} img image or its histogram
 * @param {{clip?: number, mask?: object}} [opts] `clip` = percent of values ignored at each end (default 0.1)
 * @returns {object} levels params
 */
export function autoContrast(img, opts = {}) {
  const h = img.luma ? img : histogram(img, opts);
  const clip = (opts.clip === undefined ? 0.1 : opts.clip) / 100;
  const all = new Uint32Array(256);
  for (let v = 0; v < 256; v++) all[v] = h.r[v] + h.g[v] + h.b[v];
  const [lo, hi] = clipPoints(all, clip);
  const out = LEVELS_IDENTITY();
  if (hi - lo >= 1) {
    out.inBlack = lo;
    out.inWhite = hi;
  }
  return out;
}

/**
 * Auto Color: per-channel stretch (like {@link autoLevels}) plus a per-channel gamma that moves the
 * average colors of the three channels onto each other, removing global color casts.
 * Returns params for ADJUSTMENTS.levels.
 * @param {RGBAImage|Histogram} img image or its histogram
 * @param {{clip?: number, mask?: object, neutralize?: boolean}} [opts] `neutralize` (default true) enables the gamma step
 * @returns {object} levels params
 */
export function autoColor(img, opts = {}) {
  const h = img.luma ? img : histogram(img, opts);
  const out = autoLevels(h, opts);
  if (opts.neutralize === false) return out;
  const names = ["red", "green", "blue"];
  const hists = [h.r, h.g, h.b];
  const m = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p = out.channels[names[c]];
    const st = channelStats(hists[c]);
    const span = Math.max(1, p.inWhite - p.inBlack);
    m[c] = Math.min(0.98, Math.max(0.02, (st.mean - p.inBlack) / span));
  }
  const target = (m[0] + m[1] + m[2]) / 3;
  for (let c = 0; c < 3; c++) {
    const g = Math.log(m[c]) / Math.log(target);
    out.channels[names[c]].gamma = Math.min(2, Math.max(0.5, g));
  }
  return out;
}

/**
 * Alpha-weighted average color of a rectangle (eyedropper with a sample area).
 * @param {RGBAImage} img
 * @param {Rect} [rect] defaults to the whole image; clipped to the image
 * @returns {{r:number, g:number, b:number, a:number, hex:string}} integers 0..255; a = mean alpha
 */
export function averageColor(img, rect) {
  const W = img.width;
  const H = img.height;
  const x0 = Math.max(0, Math.floor(rect ? rect.x : 0));
  const y0 = Math.max(0, Math.floor(rect ? rect.y : 0));
  const x1 = Math.min(W, Math.ceil(rect ? rect.x + rect.width : W));
  const y1 = Math.min(H, Math.ceil(rect ? rect.y + rect.height : H));
  const d = img.data;
  let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    let j = (y * W + x0) * 4;
    for (let x = x0; x < x1; x++, j += 4) {
      const a = d[j + 3];
      sr += d[j] * a;
      sg += d[j + 1] * a;
      sb += d[j + 2] * a;
      sa += a;
      n++;
    }
  }
  if (!n || sa === 0) return { r: 0, g: 0, b: 0, a: 0, hex: "#000000" };
  const r = clampByte(sr / sa), g = clampByte(sg / sa), b = clampByte(sb / sa), a = clampByte(sa / n);
  return { r, g, b, a, hex: toHex(r, g, b) };
}
