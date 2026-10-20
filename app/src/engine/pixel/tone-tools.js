// Pure helpers behind the interactive Levels and Curves widgets: slider <-> gamma math, per-channel parameter
// normalization, eyedropper points, curve point editing and curve presets. No DOM.

import { buildLevelsLUT, buildCurveFloat } from "./adjustments.js";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const FIELDS = ["inBlack", "inWhite", "gamma", "outBlack", "outWhite"];
const NAMES = ["red", "green", "blue"];
export const levelsIdentity = () => ({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });

/** Relative position (0..1, between black and white point) of the midtone slider for a gamma value. */
export const gammaToMidPos = (g) => Math.pow(0.5, clamp(g, 0.1, 5));
/** Inverse of {@link gammaToMidPos}; the result is clamped to the 0.1..5 range of the Levels effect. */
export const midPosToGamma = (x) => clamp(Math.log(clamp(x, 0.0001, 0.9999)) / Math.log(0.5), 0.1, 5);

const isIdentityLevels = (p) => FIELDS.every((k) => p[k] === levelsIdentity()[k]);

/**
 * Splits Levels params into the master (RGB) set and per-channel sets. The legacy form (`channel: "red"` with the
 * master fields) is converted to the per-channel form.
 * @param {object} params Levels params as stored on an adjustment layer
 * @returns {{rgb: object, red: object, green: object, blue: object}} each with inBlack, inWhite, gamma, outBlack, outWhite
 */
export function levelsSets(params = {}) {
  const pick = (o) => ({ ...levelsIdentity(), ...Object.fromEntries(FIELDS.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]])) });
  const out = { rgb: pick(params), red: pick(params.channels?.red), green: pick(params.channels?.green), blue: pick(params.channels?.blue) };
  const ch = params.channel;
  if (ch === "red" || ch === "green" || ch === "blue") {
    out[ch] = pick(params);
    out.rgb = levelsIdentity();
  }
  return out;
}

/**
 * Builds stored Levels params from the sets of {@link levelsSets}. `channel` is always "rgb"; per-channel sets live in `channels`
 * (null when all three are identity).
 */
export function levelsParams(sets) {
  const any = NAMES.some((k) => !isIdentityLevels(sets[k]));
  return { ...sets.rgb, channel: "rgb", channels: any ? Object.fromEntries(NAMES.map((k) => [k, { ...sets[k] }])) : null };
}

/** Applies a slider edit to one set keeping black < white (at least 1 level apart) and rounding to whole levels. */
export function editLevels(set, patch) {
  const o = { ...set, ...patch };
  o.inBlack = clamp(Math.round(o.inBlack), 0, 254);
  o.inWhite = clamp(Math.round(o.inWhite), 1, 255);
  if (patch.inBlack !== undefined && o.inBlack >= o.inWhite) o.inBlack = o.inWhite - 1;
  if (patch.inWhite !== undefined && o.inWhite <= o.inBlack) o.inWhite = o.inBlack + 1;
  o.gamma = clamp(Math.round(o.gamma * 100) / 100, 0.1, 5);
  o.outBlack = clamp(Math.round(o.outBlack), 0, 255);
  o.outWhite = clamp(Math.round(o.outWhite), 0, 255);
  return o;
}

/**
 * Applies a Levels eyedropper sample.
 * @param {{rgb: object, red: object, green: object, blue: object}} sets from {@link levelsSets}
 * @param {'rgb'|'red'|'green'|'blue'} tab channel tab the dropper works on
 * @param {'black'|'gray'|'white'} kind
 * @param {[number, number, number]} color sampled RGB (0..255)
 * @returns {{rgb: object, red: object, green: object, blue: object}} new sets
 */
export function eyedropperLevels(sets, tab, kind, color) {
  const next = { rgb: { ...sets.rgb }, red: { ...sets.red }, green: { ...sets.green }, blue: { ...sets.blue } };
  const luma = (77 * color[0] + 150 * color[1] + 29 * color[2] + 128) >> 8;
  const value = tab === "rgb" ? luma : color[NAMES.indexOf(tab)];
  if (kind === "black") next[tab] = editLevels(next[tab], { inBlack: Math.min(value, next[tab].inWhite - 1) });
  else if (kind === "white") next[tab] = editLevels(next[tab], { inWhite: Math.max(value, next[tab].inBlack + 1) });
  else if (tab !== "rgb") {
    const s = next[tab];
    const x = clamp((value - s.inBlack) / Math.max(1, s.inWhite - s.inBlack), 0.02, 0.98);
    next[tab] = editLevels(s, { gamma: Math.log(x) / Math.log(0.5) });
  } else {
    // neutralize: bring the three channels of the sample to the same level while keeping its brightness
    const xs = NAMES.map((k, i) => {
      const s = next[k];
      return clamp((color[i] - s.inBlack) / Math.max(1, s.inWhite - s.inBlack), 0.02, 0.98);
    });
    const t = (xs[0] + xs[1] + xs[2]) / 3;
    NAMES.forEach((k, i) => {
      next[k] = editLevels(next[k], { gamma: Math.log(xs[i]) / Math.log(t) });
    });
  }
  return next;
}

/** Output histogram of a Levels set: every input bin moved through the set's table. */
export function mapHistogram(h, lut) {
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) out[lut[i]] += h[i];
  return out;
}
export const levelsLUT = (set) => buildLevelsLUT(set);

// ------------------------------------------------------------------ curves

export const curveIdentity = () => [[0, 0], [1, 1]];
export const MIN_POINT_GAP = 1 / 255;

/** True when a point list maps every input to itself. */
export function isIdentityCurve(points) {
  if (!points || !points.length) return true;
  const f = buildCurveFloat(points, 256);
  for (let i = 0; i < 256; i++) if (Math.abs(f[i] - i / 255) > 0.5 / 255) return false;
  return true;
}

/** Output (0..1) of a curve at input x (0..1). */
export function curveAt(points, x) {
  return buildCurveFloat(points, 256)[clamp(Math.round(x * 255), 0, 255)];
}

/**
 * Adds a point (x, y in 0..1). If a point is already within one level in x, that point is moved instead.
 * @returns {{points: number[][], index: number}}
 */
export function addCurvePoint(points, x, y) {
  const pts = points.map((p) => [...p]);
  const near = pts.findIndex((p) => Math.abs(p[0] - x) < MIN_POINT_GAP);
  if (near >= 0) {
    pts[near][1] = clamp(y, 0, 1);
    return { points: pts, index: near };
  }
  pts.push([clamp(x, 0, 1), clamp(y, 0, 1)]);
  pts.sort((a, b) => a[0] - b[0]);
  return { points: pts, index: pts.findIndex((p) => p[0] === clamp(x, 0, 1)) };
}

/** Moves point `i`; x stays between its neighbors (one level apart). Returns a new list. */
export function moveCurvePoint(points, i, x, y) {
  const pts = points.map((p) => [...p]);
  const lo = i > 0 ? pts[i - 1][0] + MIN_POINT_GAP : 0;
  const hi = i < pts.length - 1 ? pts[i + 1][0] - MIN_POINT_GAP : 1;
  pts[i] = [clamp(x, lo, Math.max(lo, hi)), clamp(y, 0, 1)];
  return pts;
}

/** Removes point `i` (a curve keeps at least two points). Returns a new list. */
export function removeCurvePoint(points, i) {
  if (points.length <= 2) return points.map((p) => [...p]);
  return points.filter((_, k) => k !== i).map((p) => [...p]);
}

/** Curve presets (master curve; applied to the RGB tab or to the active channel). */
export const CURVE_PRESETS = [
  { id: "linear", label: "Linear (default)", points: [[0, 0], [1, 1]] },
  { id: "contrast", label: "Medium contrast", points: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] },
  { id: "strong", label: "Strong contrast", points: [[0, 0], [0.25, 0.14], [0.75, 0.86], [1, 1]] },
  { id: "lighter", label: "Lighter", points: [[0, 0], [0.5, 0.62], [1, 1]] },
  { id: "darker", label: "Darker", points: [[0, 0], [0.5, 0.38], [1, 1]] },
  { id: "lift-shadows", label: "Lift shadows", points: [[0, 0], [0.2, 0.3], [0.6, 0.65], [1, 1]] },
  { id: "fade", label: "Faded blacks", points: [[0, 0.08], [0.5, 0.5], [1, 0.95]] },
  { id: "negative", label: "Negative", points: [[0, 1], [1, 0]] },
];
