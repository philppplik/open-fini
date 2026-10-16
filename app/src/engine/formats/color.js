// Small color conversions shared by the file-format readers. Pure functions, no DOM.

/**
 * Clamps and rounds a channel value to an integer 0..255.
 * @param {number} v
 * @returns {number}
 */
export function clamp8(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

/**
 * Formats three 0..255 channels as '#rrggbb'.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function toHex(r, g, b) {
  return '#' + ((1 << 24) | (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b)).toString(16).slice(1);
}

/**
 * Simple CMYK to RGB conversion (no ICC): r = 255 * (1 - c) * (1 - k).
 * @param {number} c 0..1 ink coverage
 * @param {number} m 0..1
 * @param {number} y 0..1
 * @param {number} k 0..1
 * @returns {[number, number, number]} 0..255
 */
export function cmykToRgb(c, m, y, k) {
  const ik = 1 - Math.min(1, Math.max(0, k));
  return [
    clamp8(255 * (1 - Math.min(1, Math.max(0, c))) * ik),
    clamp8(255 * (1 - Math.min(1, Math.max(0, m))) * ik),
    clamp8(255 * (1 - Math.min(1, Math.max(0, y))) * ik),
  ];
}

/**
 * CIE L*a*b* (D50) to sRGB, Bradford adapted.
 * @param {number} L 0..100
 * @param {number} a about -128..127
 * @param {number} b about -128..127
 * @returns {[number, number, number]} 0..255
 */
export function labToRgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t) => (t > 6 / 29 ? t * t * t : (3 * 36 / 841) * (t - 4 / 29));
  const X = 0.9642 * inv(fx);
  const Y = inv(fy);
  const Z = 0.8249 * inv(fz);
  const lr = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
  const lg = -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z;
  const lb = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
  const enc = (v) => {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return clamp8(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };
  return [enc(lr), enc(lg), enc(lb)];
}
