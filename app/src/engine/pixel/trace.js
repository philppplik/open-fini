// Image Trace support: color quantization, region labelling, speckle removal and per-color contour
// extraction. The host turns the returned polylines into Bézier paths; this module only does the
// raster side.

import { toHex, clampByte } from "./image.js";
import { Mask } from "./selection.js";
import { gaussianBlurImage } from "./blur.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ r: number, g: number, b: number, hex: string, weight: number }} PaletteColor
 * @typedef {{ points: number[], hole: boolean }} Contour
 * @typedef {{ width: number, height: number, layers: { color: string, contours: Contour[] }[] }} TraceResult
 */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Collects up to maxSamples opaque pixels as parallel typed arrays.
function samplePixels(img, maxSamples, seed, alphaMin) {
  const n = img.width * img.height;
  const d = img.data;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= alphaMin) opaque++;
  const stride = Math.max(1, Math.floor(opaque / maxSamples));
  const rnd = mulberry32(seed);
  const cap = Math.min(opaque, Math.ceil(opaque / stride) + 1);
  const px = new Uint8Array(cap * 3);
  let m = 0;
  let skip = Math.floor(rnd() * stride);
  for (let i = 0; i < n && m < cap; i++) {
    if (d[i * 4 + 3] < alphaMin) continue;
    if (skip > 0) {
      skip--;
      continue;
    }
    skip = stride - 1;
    px[m * 3] = d[i * 4];
    px[m * 3 + 1] = d[i * 4 + 1];
    px[m * 3 + 2] = d[i * 4 + 2];
    m++;
  }
  return { px, m };
}

/**
 * Reduces an image to at most `k` representative colors: the pixels of a down-sampled set are binned on a
 * 5 bit/channel grid, centers are seeded by weighted farthest-point selection (so small but distinct colors
 * such as a tiny blue logo mark survive) and refined with k-means passes over the bins.
 * Transparent pixels (alpha < 128) are ignored.
 * @param {RGBAImage} img
 * @param {number} k number of colors (1..255)
 * @param {{seed?: number, sampleSize?: number, iterations?: number}} [opts] seed jitters the pixel sampling
 *   (default 1); sampleSize = pixels analyzed (default 20000); iterations = k-means passes (default 8)
 * @returns {PaletteColor[]} palette sorted by decreasing weight (share of the sampled pixels)
 */
export function quantizeColors(img, k, opts = {}) {
  k = Math.max(1, Math.min(255, Math.round(k)));
  const seed = opts.seed === undefined ? 1 : opts.seed;
  const { px, m } = samplePixels(img, opts.sampleSize || 20000, seed, 128);
  if (m === 0) return [];
  // --- histogram on a 32 x 32 x 32 grid
  const cnt = new Int32Array(32768);
  const sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  for (let i = 0; i < m; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    cnt[key]++;
    sr[key] += r; sg[key] += g; sb[key] += b;
  }
  const bc = [], br = [], bg = [], bb = [];
  for (let key = 0; key < 32768; key++) {
    if (!cnt[key]) continue;
    bc.push(cnt[key]);
    br.push(sr[key] / cnt[key]);
    bg.push(sg[key] / cnt[key]);
    bb.push(sb[key] / cnt[key]);
  }
  const nb = bc.length;
  let cr, cg, cb;
  if (nb <= k) {
    cr = Float64Array.from(br); cg = Float64Array.from(bg); cb = Float64Array.from(bb);
  } else {
    // weighted farthest-point seeding
    const centers = [];
    let first = 0;
    for (let i = 1; i < nb; i++) if (bc[i] > bc[first]) first = i;
    centers.push(first);
    const mind = new Float64Array(nb);
    for (let i = 0; i < nb; i++) {
      const dr = br[i] - br[first], dg = bg[i] - bg[first], db = bb[i] - bb[first];
      mind[i] = dr * dr + dg * dg + db * db;
    }
    while (centers.length < k) {
      let best = -1, bs = 0;
      for (let i = 0; i < nb; i++) {
        const sc = mind[i] * Math.sqrt(bc[i]);
        if (sc > bs) { bs = sc; best = i; }
      }
      if (best < 0) break;
      centers.push(best);
      for (let i = 0; i < nb; i++) {
        const dr = br[i] - br[best], dg = bg[i] - bg[best], db = bb[i] - bb[best];
        const d = dr * dr + dg * dg + db * db;
        if (d < mind[i]) mind[i] = d;
      }
    }
    const kk0 = centers.length;
    cr = new Float64Array(kk0); cg = new Float64Array(kk0); cb = new Float64Array(kk0);
    centers.forEach((bi, c) => { cr[c] = br[bi]; cg[c] = bg[bi]; cb[c] = bb[bi]; });
    // k-means over the bins
    const iters = opts.iterations === undefined ? 8 : opts.iterations;
    const ar = new Float64Array(kk0), ag = new Float64Array(kk0), ab = new Float64Array(kk0), an = new Float64Array(kk0);
    for (let it = 0; it < iters; it++) {
      ar.fill(0); ag.fill(0); ab.fill(0); an.fill(0);
      for (let i = 0; i < nb; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < kk0; c++) {
          const dr = br[i] - cr[c], dg = bg[i] - cg[c], db = bb[i] - cb[c];
          const dd = dr * dr + dg * dg + db * db;
          if (dd < bd) { bd = dd; best = c; }
        }
        ar[best] += br[i] * bc[i]; ag[best] += bg[i] * bc[i]; ab[best] += bb[i] * bc[i]; an[best] += bc[i];
      }
      for (let c = 0; c < kk0; c++) {
        if (an[c]) { cr[c] = ar[c] / an[c]; cg[c] = ag[c] / an[c]; cb[c] = ab[c] / an[c]; }
      }
    }
  }
  const kk = cr.length;
  const wn = new Float64Array(kk);
  for (let i = 0; i < nb; i++) {
    let best = 0, bd = Infinity;
    for (let c = 0; c < kk; c++) {
      const dr = br[i] - cr[c], dg = bg[i] - cg[c], db = bb[i] - cb[c];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; best = c; }
    }
    wn[best] += bc[i];
  }
  const out = [];
  for (let c = 0; c < kk; c++) {
    if (!wn[c]) continue;
    const r = clampByte(cr[c]), g = clampByte(cg[c]), b = clampByte(cb[c]);
    out.push({ r, g, b, hex: toHex(r, g, b), weight: wn[c] / m });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

// Removes connected regions (4-connectivity) of one label smaller than minArea by relabelling them with the
// most frequent neighboring label. Label -1 (transparent) is never removed or used as a replacement.
function removeSpecks(labels, W, H, minArea) {
  if (minArea <= 1) return;
  const n = W * H;
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  const counts = new Map();
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    const lab = labels[s];
    let head = 0, tail = 0;
    queue[tail++] = s;
    visited[s] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const y = (i / W) | 0;
      if (x > 0 && !visited[i - 1] && labels[i - 1] === lab) { visited[i - 1] = 1; queue[tail++] = i - 1; }
      if (x < W - 1 && !visited[i + 1] && labels[i + 1] === lab) { visited[i + 1] = 1; queue[tail++] = i + 1; }
      if (y > 0 && !visited[i - W] && labels[i - W] === lab) { visited[i - W] = 1; queue[tail++] = i - W; }
      if (y < H - 1 && !visited[i + W] && labels[i + W] === lab) { visited[i + W] = 1; queue[tail++] = i + W; }
    }
    if (lab < 0 || tail >= minArea) continue;
    counts.clear();
    for (let q = 0; q < tail; q++) {
      const i = queue[q];
      const x = i % W;
      const y = (i / W) | 0;
      const nb = [x > 0 ? labels[i - 1] : -2, x < W - 1 ? labels[i + 1] : -2, y > 0 ? labels[i - W] : -2, y < H - 1 ? labels[i + W] : -2];
      for (let t = 0; t < 4; t++) {
        const l = nb[t];
        if (l >= 0 && l !== lab) counts.set(l, (counts.get(l) || 0) + 1);
      }
    }
    let best = -1, bc = 0;
    for (const [l, c] of counts) {
      if (c > bc) { bc = c; best = l; }
    }
    if (best < 0) continue;
    for (let q = 0; q < tail; q++) labels[queue[q]] = best;
  }
}

/**
 * Traces an image into stacked color layers of polygon contours (the host fits Bézier curves to them).
 *
 * 'color' mode quantizes to `colors` colors and returns one layer per color. With `stacking: 'stacked'`
 * (default) each layer covers its own pixels plus those of all layers above it, so neighboring shapes
 * overlap instead of leaving hairline gaps; 'cutout' returns disjoint regions. Layers are ordered
 * bottom to top by decreasing area (backgrounds first). 'mono' mode returns one layer with the pixels
 * darker than `threshold`. Contours come from {@link Mask#toContours} (holes included), in pixel-edge coordinates.
 * @param {RGBAImage} img
 * @param {{mode?: 'color'|'mono', colors?: number, threshold?: number, speckle?: number, smoothing?: number, blur?: number, stacking?: 'stacked'|'cutout', color?: string, seed?: number, simplify?: number}} [opts]
 *   colors (default 8), threshold luma 0..255 (default 128), speckle = smallest region area in px to keep (default 4),
 *   smoothing = corner rounding radius in px (default 1), blur = pre-blur sigma in px (default 0), color = ink color of
 *   mono mode (default '#000000'), simplify = contour tolerance in px (default 0.5)
 * @returns {TraceResult}
 */
export function traceImage(img, opts = {}) {
  const W = img.width;
  const H = img.height;
  const n = W * H;
  const mode = opts.mode === "mono" ? "mono" : "color";
  const speckle = opts.speckle === undefined ? 4 : opts.speckle;
  const smoothing = opts.smoothing === undefined ? 1 : opts.smoothing;
  const simplify = opts.simplify === undefined ? 0.5 : opts.simplify;
  const stacked = opts.stacking !== "cutout";
  const result = { width: W, height: H, layers: [] };
  if (n === 0) return result;
  let work = img;
  if (opts.blur > 0) {
    work = { width: W, height: H, data: new Uint8ClampedArray(img.data) };
    gaussianBlurImage(work, opts.blur, opts.blur, work);
  }
  const d = work.data;
  const labels = new Int16Array(n);
  let palette;
  if (mode === "mono") {
    const thr = opts.threshold === undefined ? 128 : opts.threshold;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (d[j + 3] < 128) labels[i] = -1;
      else labels[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2] < thr ? 1 : 0;
    }
    palette = [null, { hex: opts.color ? toHex(...parseHex(opts.color)) : "#000000" }];
  } else {
    const q = quantizeColors(work, opts.colors === undefined ? 8 : opts.colors, { seed: opts.seed });
    if (!q.length) return result;
    palette = q;
    const K = q.length;
    const lut = new Uint8Array(32768);
    for (let c = 0; c < 32768; c++) {
      const r = ((c >> 10) << 3) + 4, g = (((c >> 5) & 31) << 3) + 4, b = ((c & 31) << 3) + 4;
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const dr = r - q[k].r, dg = g - q[k].g, db = b - q[k].b;
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = k; }
      }
      lut[c] = best;
    }
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      labels[i] = d[j + 3] < 128 ? -1 : lut[((d[j] >> 3) << 10) | ((d[j + 1] >> 3) << 5) | (d[j + 2] >> 3)];
    }
  }
  removeSpecks(labels, W, H, speckle);
  const K = palette.length;
  const area = new Float64Array(K);
  for (let i = 0; i < n; i++) if (labels[i] >= 0) area[labels[i]]++;
  let order;
  if (mode === "mono") order = [1];
  else {
    order = [];
    for (let k = 0; k < K; k++) if (area[k] > 0) order.push(k);
    order.sort((a, b) => area[b] - area[a]);
  }
  const rank = new Int16Array(K).fill(-1);
  order.forEach((lab, r) => (rank[lab] = r));
  for (let li = 0; li < order.length; li++) {
    const lab = order[li];
    const mask = new Mask(W, H);
    const md = mask.data;
    if (mode === "mono") {
      for (let i = 0; i < n; i++) if (labels[i] === 1) md[i] = 255;
    } else if (stacked) {
      for (let i = 0; i < n; i++) {
        const l = labels[i];
        if (l >= 0 && rank[l] >= li) md[i] = 255;
      }
    } else {
      for (let i = 0; i < n; i++) if (labels[i] === lab) md[i] = 255;
    }
    if (smoothing > 0) mask.smooth(smoothing);
    const contours = mask.toContours({ threshold: 128, simplify });
    if (contours.length) result.layers.push({ color: palette[lab].hex, contours });
  }
  return result;
}

function parseHex(c) {
  const s = c.replace("#", "");
  const v = parseInt(s.length === 3 ? s.split("").map((x) => x + x).join("") : s.slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
