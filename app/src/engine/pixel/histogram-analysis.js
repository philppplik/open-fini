// Histogram analysis for the Histogram panel, the adjustment widgets and the Vibe assistant.
// Pure functions (no DOM): sampled/chunked histogram accumulation, per-channel summaries, display curves,
// plain-language assessment of tone problems and auto-correction suggestions.
//
// Conventions: every histogram has 256 bins (0..255). "Shadows clipped" / "highlights clipped" count samples
// at level 0 / level 255 of the channel in question; for the RGB view they count pixels where ANY channel is 0
// / 255. The assessment is deliberately tolerant (luminosity <= 1 and >= 254) so JPEG noise does not hide clipping.

import { luma8, clampByte } from "./image.js";
import { SRGB_TO_LINEAR } from "./color.js";
import { autoContrast, autoColor, channelStats } from "./histogram.js";

/** @typedef {{ r: Uint32Array, g: Uint32Array, b: Uint32Array, luma: Uint32Array, lab: Uint32Array, count: number, total: number, step: number, sampled: boolean, clipLow: number, clipHigh: number }} Analysis */

export const HIST_CHANNELS = ["rgb", "luma", "r", "g", "b", "lab"];
export const CHANNEL_LABELS = { rgb: "RGB", luma: "Luminosity", r: "Red", g: "Green", b: "Blue", lab: "Lab L*" };

/** Above this many pixels the panel analyzes a strided sample until the exact pass has finished. */
export const SAMPLE_LIMIT = 4_000_000;

// L* (0..100) of a linear luminance, scaled to 0..255 bins; 4096-entry table indexed by Y * 4095.
const LAB_L = (() => {
  const t = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) {
    const y = i / 4095;
    const f = y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116;
    t[i] = clampByte(((116 * f - 16) / 100) * 255);
  }
  return t;
})();

/** @returns {Analysis} an empty accumulator */
export function createAnalysis() {
  return { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), luma: new Uint32Array(256), lab: new Uint32Array(256), count: 0, total: 0, step: 1, sampled: false, clipLow: 0, clipHigh: 0 };
}

/**
 * Adds an image (or a horizontal strip of one) to an analysis. Pixels with alpha 0 and pixels outside the mask are skipped.
 * @param {Analysis} acc accumulator from {@link createAnalysis}
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{maxPixels?: number, mask?: {width:number,height:number,data:Uint8Array}, maskThreshold?: number, rowOffset?: number, maskStride?: number, lab?: boolean, minAlpha?: number}} [opts]
 *   `maxPixels`: sample with a stride when the image has more pixels; `mask`: a mask at the image's resolution (or, with
 *   `rowOffset`, at the resolution of the whole picture the strip belongs to; `maskStride` = mask width)
 * @returns {Analysis} acc
 */
export function accumulate(acc, img, opts = {}) {
  const W = img.width;
  const H = img.height;
  const maxPixels = opts.maxPixels || Infinity;
  const step = W * H > maxPixels ? Math.ceil(Math.sqrt((W * H) / maxPixels)) : 1;
  const mask = opts.mask ? opts.mask.data : null;
  const mw = opts.maskStride || (opts.mask ? opts.mask.width : W);
  const row0 = opts.rowOffset || 0;
  const mt = opts.maskThreshold === undefined ? 128 : opts.maskThreshold;
  const minA = opts.minAlpha === undefined ? 1 : opts.minAlpha;
  const wantLab = opts.lab !== false;
  const d = img.data;
  const { r, g, b, luma, lab } = acc;
  let count = 0, low = 0, high = 0;
  for (let y = 0; y < H; y += step) {
    let j = y * W * 4;
    const mrow = (row0 + y) * mw;
    for (let x = 0; x < W; x += step, j += 4 * step) {
      if (d[j + 3] < minA) continue;
      if (mask && mask[mrow + x] < mt) continue;
      const R = d[j], G = d[j + 1], B = d[j + 2];
      r[R]++;
      g[G]++;
      b[B]++;
      luma[luma8(R, G, B)]++;
      if (wantLab) lab[LAB_L[((SRGB_TO_LINEAR[R] * 0.2126 + SRGB_TO_LINEAR[G] * 0.7152 + SRGB_TO_LINEAR[B] * 0.0722) * 4095 + 0.5) | 0]]++;
      if (R === 0 || G === 0 || B === 0) low++;
      if (R === 255 || G === 255 || B === 255) high++;
      count++;
    }
  }
  acc.count += count;
  acc.clipLow += low;
  acc.clipHigh += high;
  acc.step = Math.max(acc.step, step);
  acc.sampled = acc.sampled || step > 1;
  acc.total = acc.sampled ? Math.round(acc.count * acc.step * acc.step) : acc.count;
  return acc;
}

/** One-shot analysis of an image. See {@link accumulate} for the options. @returns {Analysis} */
export function analyzeImage(img, opts) {
  return accumulate(createAnalysis(), img, opts);
}

/**
 * Per-bin sum of the three color channels, or one channel's histogram.
 * @param {Analysis} a
 * @param {string} channel one of HIST_CHANNELS
 * @returns {Uint32Array}
 */
export function channelHistogram(a, channel) {
  if (channel === "rgb") {
    const o = new Uint32Array(256);
    for (let i = 0; i < 256; i++) o[i] = a.r[i] + a.g[i] + a.b[i];
    return o;
  }
  return a[channel] || a.luma;
}

/** Sums 256 bins into `bins` equal groups (256 must be divisible by `bins`; other values are rounded to the nearest edge). */
export function rebin(h, bins) {
  const o = new Uint32Array(bins);
  for (let i = 0; i < 256; i++) o[Math.min(bins - 1, Math.floor((i * bins) / 256))] += h[i];
  return o;
}

/** Percentage of samples at level `v` or below (0..100). */
export function percentileOfLevel(h, v) {
  let total = 0, below = 0;
  for (let i = 0; i < 256; i++) {
    total += h[i];
    if (i <= v) below += h[i];
  }
  return total ? (below / total) * 100 : 0;
}

/**
 * Hover readout of a histogram level.
 * @param {Uint32Array} h
 * @param {number} level 0..255
 * @returns {{level:number, count:number, percentile:number, share:number}} `percentile` = % of samples <= level, `share` = % of samples at exactly this level
 */
export function readout(h, level) {
  const v = Math.max(0, Math.min(255, Math.round(level)));
  let total = 0;
  for (let i = 0; i < 256; i++) total += h[i];
  return { level: v, count: h[v], percentile: percentileOfLevel(h, v), share: total ? (h[v] / total) * 100 : 0 };
}

/**
 * Statistics of the selected channel plus clipping percentages.
 * @param {Analysis} a
 * @param {string} channel
 * @returns {{channel:string, count:number, pixels:number, mean:number, median:number, stddev:number, min:number, max:number, p1:number, p99:number, shadowsClipped:number, highlightsClipped:number, sampled:boolean}}
 */
export function summarize(a, channel = "luma") {
  const h = channelHistogram(a, channel);
  const st = channelStats(h);
  const pct = (p) => {
    let t = 0;
    for (let i = 0; i < 256; i++) t += h[i];
    if (!t) return 0;
    const target = t * p;
    let c = 0;
    for (let i = 0; i < 256; i++) {
      c += h[i];
      if (c > target) return i;
    }
    return 255;
  };
  const n = a.count || 0;
  const shadows = channel === "rgb" ? a.clipLow : h[0];
  const highlights = channel === "rgb" ? a.clipHigh : h[255];
  const den = channel === "rgb" ? n : st.count;
  return {
    channel,
    count: st.count,
    pixels: a.total || n,
    mean: st.mean,
    median: st.median,
    stddev: st.stddev,
    min: st.min,
    max: st.max,
    p1: pct(0.01),
    p99: pct(0.99),
    shadowsClipped: den ? (shadows / den) * 100 : 0,
    highlightsClipped: den ? (highlights / den) * 100 : 0,
    sampled: !!a.sampled,
  };
}

/** Share of samples in the four tonal quarters (0-63, 64-127, 128-191, 192-255) in percent. */
export function tonalShares(h) {
  const q = [0, 0, 0, 0];
  let t = 0;
  for (let i = 0; i < 256; i++) {
    q[i >> 6] += h[i];
    t += h[i];
  }
  return q.map((v) => (t ? (v / t) * 100 : 0));
}

/**
 * Normalizes counts to 0..1 for drawing. The scale ignores the two extreme bins (they usually hold clipped pixels
 * and would flatten everything else) unless they are all there is; bars taller than the scale are clipped at 1.
 * @param {Uint32Array|number[]} h 256 counts
 * @param {{log?: boolean, smooth?: number}} [o] `log`: logarithmic height; `smooth`: number of [1 2 1] smoothing passes
 * @returns {{values: Float32Array, max: number}}
 */
export function displayCurve(h, { log = false, smooth = 0 } = {}) {
  let v = Float32Array.from(h);
  for (let p = 0; p < smooth; p++) {
    const w = new Float32Array(256);
    for (let i = 0; i < 256; i++) w[i] = (v[Math.max(0, i - 1)] + 2 * v[i] + v[Math.min(255, i + 1)]) / 4;
    v = w;
  }
  let max = 0;
  for (let i = 1; i < 255; i++) if (v[i] > max) max = v[i];
  if (max === 0) max = Math.max(v[0], v[255], 1);
  const f = log ? Math.log1p(max) : max;
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) out[i] = Math.min(1, (log ? Math.log1p(v[i]) : v[i]) / f);
  return { values: out, max };
}

/**
 * Per-pixel clipping flags of an image for the canvas overlay: bit 1 = a channel at/below `low`, bit 2 = a channel at/above `high`.
 * Transparent pixels (alpha 0) are never flagged.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{low?: number, high?: number}} [o] thresholds (default 0 and 255)
 * @returns {Uint8Array} width * height flags
 */
export function clipFlags(img, { low = 0, high = 255 } = {}) {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) continue;
    const R = d[j], G = d[j + 1], B = d[j + 2];
    let f = 0;
    if (R <= low || G <= low || B <= low) f |= 1;
    if (R >= high || G >= high || B >= high) f |= 2;
    out[i] = f;
  }
  return out;
}

// ------------------------------------------------------------------ assessment

const lin = (v) => SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(v)))];

/** Exposure change (EV, positive = brighter) that moves the median luminosity to a mid tone. */
export function exposureToMidtone(median, target = 118) {
  const m = Math.max(lin(median), 1 / 255 / 12.92);
  return Math.max(-3, Math.min(3, Math.log2(lin(target) / m)));
}

/**
 * Plain-language assessment of an analysis.
 * @param {Analysis} a
 * @returns {{exposure:'underexposed'|'overexposed'|'balanced', contrast:'low'|'normal'|'high', clipping:{shadows:number, highlights:number, shadowsLevel:'none'|'some'|'heavy', highlightsLevel:'none'|'some'|'heavy', channels:string[]}, cast:string|null, stats:object, issues:string[], summary:string, suggestions:{adjustment:string, id:string, reason:string, params:object}[]}}
 */
export function assess(a) {
  const st = summarize(a, "luma");
  const n = st.count;
  const out = { exposure: "balanced", contrast: "normal", clipping: { shadows: 0, highlights: 0, shadowsLevel: "none", highlightsLevel: "none", channels: [] }, cast: null, stats: st, issues: [], summary: "", suggestions: [] };
  if (!n) {
    out.summary = "There are no visible pixels to analyze.";
    return out;
  }
  const near = (lo, hi) => {
    let s = 0;
    for (let i = lo; i <= hi; i++) s += a.luma[i];
    return (s / n) * 100;
  };
  const sh = near(0, 1);
  const hi = near(254, 255);
  const level = (p) => (p >= 5 ? "heavy" : p >= 1 ? "some" : "none");
  out.clipping = { shadows: sh, highlights: hi, shadowsLevel: level(sh), highlightsLevel: level(hi), channels: [] };
  for (const [k, name] of [["r", "Red"], ["g", "Green"], ["b", "Blue"]]) {
    const c = (a[k][255] / n) * 100;
    if (c >= 2) out.clipping.channels.push(`${name} highlights ${c.toFixed(1)}%`);
  }
  const dark = st.median < 80 && st.mean < 95;
  const bright = st.median > 180 && st.mean > 165;
  out.exposure = dark ? "underexposed" : bright ? "overexposed" : "balanced";
  const range = st.p99 - st.p1;
  out.contrast = range < 140 || st.stddev < 38 ? "low" : st.stddev > 80 ? "high" : "normal";
  const mr = channelStats(a.r).mean, mg = channelStats(a.g).mean, mb = channelStats(a.b).mean;
  const warm = mr - mb, tint = mg - (mr + mb) / 2;
  if (warm >= 14) out.cast = "warm (red/yellow)";
  else if (warm <= -14) out.cast = "cool (blue)";
  else if (tint >= 10) out.cast = "green tint";
  else if (tint <= -10) out.cast = "magenta tint";

  const S = out.suggestions;
  const issues = out.issues;
  if (dark) {
    const ev = exposureToMidtone(st.median);
    issues.push("The image is dark; most tones sit in the shadows.");
    S.push({ adjustment: "exposure", id: "exposure", reason: "Brighten the midtones.", params: { exposure: +Math.max(0.2, ev * 0.7).toFixed(2) } });
  } else if (bright) {
    const ev = exposureToMidtone(st.median);
    issues.push("The image is bright; most tones sit in the highlights.");
    S.push({ adjustment: "exposure", id: "exposure", reason: "Darken the midtones.", params: { exposure: +Math.min(-0.2, ev * 0.7).toFixed(2) } });
  }
  if (out.contrast === "low") {
    const lv = autoContrast(a, { clip: 0.5 });
    issues.push(`Low contrast: 98% of the tones span only ${st.p99 - st.p1} of 255 levels.`);
    S.push({ adjustment: "levels", id: "levels", reason: "Stretch the tonal range to the real black and white points.", params: { inBlack: lv.inBlack, inWhite: lv.inWhite } });
  } else if (out.contrast === "high") issues.push("High contrast: the histogram is wide and may hide detail in shadows and highlights.");
  if (out.clipping.shadowsLevel !== "none") {
    issues.push(`${sh.toFixed(1)}% of the pixels are (almost) pure black${out.clipping.shadowsLevel === "heavy" ? "; shadow detail is lost" : ""}.`);
    S.push({ adjustment: "shadows-highlights", id: "shadows-highlights", reason: "Open up the shadows.", params: { shadows: out.clipping.shadowsLevel === "heavy" ? 50 : 30, highlights: 0 } });
  }
  if (out.clipping.highlightsLevel !== "none") {
    issues.push(`${hi.toFixed(1)}% of the pixels are (almost) pure white${out.clipping.highlightsLevel === "heavy" ? "; highlight detail is lost" : ""}.`);
    S.push({ adjustment: "shadows-highlights", id: "shadows-highlights", reason: "Recover highlight detail (fully blown pixels cannot be restored).", params: { shadows: 0, highlights: out.clipping.highlightsLevel === "heavy" ? 50 : 30 } });
  }
  if (out.clipping.channels.length && out.clipping.highlightsLevel === "none") issues.push(`A color channel is clipped: ${out.clipping.channels.join(", ")}.`);
  if (out.cast) {
    issues.push(`Possible ${out.cast} color cast (average channel means differ).`);
    S.push({ adjustment: "levels", id: "levels", reason: "Neutralize the cast with per-channel gamma (Auto Color).", params: { channels: autoColor(a, { clip: 0.1 }).channels } });
  }
  out.summary = issues.length ? issues.join(" ") : "The tonal distribution looks balanced: no clipping, normal contrast and no strong color cast.";
  return out;
}

/**
 * Recommended Levels / Curves / Exposure parameters for the image behind an analysis. All objects can be passed as `params`
 * to `apply_adjustment` (levels uses `inBlack`, `inWhite`, `gamma`, `channels`; curves uses `master`, `red`, `green`, `blue` point lists in 0..1).
 * @param {Analysis} a
 * @param {{clip?: number}} [o] `clip` = percent of pixels ignored at each end when finding black and white points (default 0.3)
 * @returns {{levels: object, curves: {master: number[][]}, colorLevels: object, exposure: {exposure:number}, notes: string[]}}
 */
export function autoCorrectSuggestion(a, { clip = 0.3 } = {}) {
  const st = summarize(a, "luma");
  const notes = [];
  const lv = autoContrast(a, { clip });
  const lo = lv.inBlack, hi = lv.inWhite;
  const span = Math.max(1, hi - lo);
  const x = Math.min(0.97, Math.max(0.03, (st.median - lo) / span));
  let gamma = Math.log(x) / Math.log(0.46);
  gamma = Math.min(2, Math.max(0.6, gamma));
  if (Math.abs(gamma - 1) < 0.06) gamma = 1;
  const levels = { inBlack: lo, inWhite: hi, gamma: +gamma.toFixed(2), outBlack: 0, outWhite: 255 };
  if (lo > 0 || hi < 255) notes.push(`Black point ${lo}, white point ${hi}: ${clip}% of the pixels are clipped at each end.`);
  else notes.push("The tonal range already spans black to white; Levels would only move the midtones.");
  if (gamma !== 1) notes.push(`Midtone gamma ${levels.gamma} moves the median (${st.median}) to a mid tone.`);
  const s = st.stddev < 45 ? 0.07 : st.stddev < 65 ? 0.045 : 0.02;
  const at = (t) => (lo + span * t) / 255;
  const yAt = (t) => Math.pow(t, 1 / gamma);
  const master = [[lo / 255, 0], [at(0.25), Math.max(0, yAt(0.25) - s)], [at(0.5), yAt(0.5)], [at(0.75), Math.min(1, yAt(0.75) + s)], [hi / 255, 1]].map(([px, py]) => [+px.toFixed(4), +py.toFixed(4)]);
  notes.push(`A gentle S-curve (${Math.round(s * 100)}% bend) adds contrast around the midtones.`);
  const colorLevels = autoColor(a, { clip: 0.1 });
  return { levels, curves: { master }, colorLevels: { channels: colorLevels.channels }, exposure: { exposure: +exposureToMidtone(st.median).toFixed(2) }, notes };
}

/**
 * Accessible text description of a histogram.
 * @param {Analysis} a
 * @param {string} channel
 * @param {string} [source] human-readable source name
 * @returns {string}
 */
export function describeHistogram(a, channel, source = "Image") {
  const st = summarize(a, channel);
  if (!st.count) return `${CHANNEL_LABELS[channel] || channel} histogram of ${source}: no pixels.`;
  const sh = tonalShares(channelHistogram(a, channel)).map((v) => Math.round(v));
  return `${CHANNEL_LABELS[channel] || channel} histogram of ${source}. Mean ${Math.round(st.mean)}, median ${st.median}, standard deviation ${Math.round(st.stddev)}, range ${st.min} to ${st.max}. ` +
    `${sh[0]} percent of the tones are shadows, ${sh[1]} dark midtones, ${sh[2]} light midtones and ${sh[3]} highlights. ` +
    `Shadows clipped ${st.shadowsClipped.toFixed(1)} percent, highlights clipped ${st.highlightsClipped.toFixed(1)} percent.`;
}
