// Color-space helpers shared by the adjustment, develop and retouch modules.
// Scratch outputs are module level typed arrays so the per-pixel helpers never allocate
// (the engine is single threaded per module instance, so sharing them is safe).

/** Output of {@link rgbToHsl}: [hue 0..360, saturation 0..1, lightness 0..1]. */
export const HSL_OUT = new Float64Array(3);
/** Output of {@link hslToRgb}: [r, g, b] on a 0..255 scale (unclamped). */
export const RGB_OUT = new Float64Array(3);

/**
 * Converts RGB bytes to HSL. The result is written to {@link HSL_OUT}.
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 */
export function rgbToHsl(r, g, b) {
  const rn = r * (1 / 255);
  const gn = g * (1 / 255);
  const bn = b * (1 / 255);
  const mx = rn > gn ? (rn > bn ? rn : bn) : gn > bn ? gn : bn;
  const mn = rn < gn ? (rn < bn ? rn : bn) : gn < bn ? gn : bn;
  const l = (mx + mn) * 0.5;
  const d = mx - mn;
  let h = 0;
  let s = 0;
  if (d > 1e-9) {
    const den = 1 - Math.abs(2 * l - 1);
    s = den > 1e-9 ? d / den : 0;
    if (mx === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  HSL_OUT[0] = h;
  HSL_OUT[1] = s > 1 ? 1 : s;
  HSL_OUT[2] = l;
}

function hue2(p, q, t) {
  if (t < 0) t += 1;
  else if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 0.5) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/**
 * Converts HSL to RGB on a 0..255 scale. The result is written to {@link RGB_OUT}.
 * @param {number} h hue in degrees (any value, wraps)
 * @param {number} s saturation 0..1
 * @param {number} l lightness 0..1
 */
export function hslToRgb(h, s, l) {
  if (s <= 0) {
    const v = l * 255;
    RGB_OUT[0] = RGB_OUT[1] = RGB_OUT[2] = v;
    return;
  }
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  RGB_OUT[0] = hue2(p, q, h + 1 / 3) * 255;
  RGB_OUT[1] = hue2(p, q, h) * 255;
  RGB_OUT[2] = hue2(p, q, h - 1 / 3) * 255;
}

/**
 * Smallest absolute difference between two hue angles in degrees (0..180).
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function hueDistance(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * sRGB electro-optical transfer: encoded 0..1 to linear 0..1.
 * @param {number} v
 * @returns {number}
 */
export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Inverse of {@link srgbToLinear}: linear 0..1 to encoded 0..1.
 * @param {number} v
 * @returns {number}
 */
export function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Linear-light value (0..1) for every encoded byte. */
export const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255);
  return t;
})();

const ENC_SIZE = 4096;
/** 4097-entry table: linear 0..1 -> encoded sRGB 0..1 (index = linear * 4096). */
export const LINEAR_TO_SRGB_TABLE = (() => {
  const t = new Float32Array(ENC_SIZE + 1);
  for (let i = 0; i <= ENC_SIZE; i++) t[i] = linearToSrgb(i / ENC_SIZE);
  return t;
})();

/**
 * Fast linear->sRGB encode (0..1 in, 0..1 out) using a table with linear interpolation, with
 * the steep toe handled by a dedicated formula so dark values stay accurate.
 * @param {number} v linear value (clamped to 0..1)
 * @returns {number}
 */
export function encodeSrgbFast(v) {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  if (v < 0.0031308) return v * 12.92;
  const x = v * ENC_SIZE;
  const i = x | 0;
  const f = x - i;
  const a = LINEAR_TO_SRGB_TABLE[i];
  return a + (LINEAR_TO_SRGB_TABLE[i + 1] - a) * f;
}
