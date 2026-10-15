// Color and tone adjustments. Each entry of ADJUSTMENTS follows the EffectModule contract
// (docs/engine-contracts.md): { id, label, category, defaults, controls, apply(img, params, ctx) }.
//
// Rules shared by every adjustment: alpha is preserved, fully transparent pixels are left
// untouched, work happens on sRGB-encoded values unless a comment says "linear light", and
// tone-only operations are collapsed into 256-entry lookup tables.

import { clamp, clamp01, clampByte, smoothstep, luma8, parseColor, LUMA_R, LUMA_G, LUMA_B } from "./image.js";
import { rgbToHsl, hslToRgb, hueDistance, HSL_OUT, RGB_OUT, srgbToLinear, linearToSrgb, SRGB_TO_LINEAR } from "./color.js";
import { gaussianBlurPlane, lumaPlane } from "./blur.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ key: string, label: string, type: string, min?: number, max?: number, step?: number, options?: {value:string,label:string}[], unit?: string, group?: string, hint?: string, default: any }} Control
 * @typedef {{ id: string, label: string, category: string, defaults: object, controls: Control[], apply: (img: RGBAImage, params: object, ctx: {scale: number}) => RGBAImage }} EffectModule
 */

// ---------------------------------------------------------------------------------------------
// LUT helpers (exported: useful on their own)
// ---------------------------------------------------------------------------------------------

/**
 * Identity lookup table.
 * @returns {Uint8Array} 256 entries, lut[i] = i
 */
export function identityLUT() {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = i;
  return t;
}

/**
 * True when a 256-entry table maps every value to itself.
 * @param {ArrayLike<number>} lut
 * @returns {boolean}
 */
export function isIdentityLUT(lut) {
  for (let i = 0; i < 256; i++) if (lut[i] !== i) return false;
  return true;
}

/**
 * Composes two tables: result[i] = second[first[i]].
 * @param {ArrayLike<number>} first applied first
 * @param {ArrayLike<number>} second applied second
 * @returns {Uint8Array}
 */
export function composeLUTs(first, second) {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = second[first[i]];
  return t;
}

/**
 * Applies per-channel lookup tables to RGB, skipping fully transparent pixels. Alpha is preserved.
 * @param {RGBAImage} img modified in place
 * @param {ArrayLike<number>} lr red table
 * @param {ArrayLike<number>} [lg=lr] green table
 * @param {ArrayLike<number>} [lb=lr] blue table
 * @returns {RGBAImage} img
 */
export function applyLUT(img, lr, lg = lr, lb = lr) {
  const d = img.data;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = lr[d[i]];
    d[i + 1] = lg[d[i + 1]];
    d[i + 2] = lb[d[i + 2]];
  }
  return img;
}

/**
 * Levels table: input black/white, gamma, output black/white (all on a 0..255 scale).
 * out = outBlack + ((in - inBlack) / (inWhite - inBlack)) ^ (1 / gamma) * (outWhite - outBlack)
 * @param {{inBlack?:number,inWhite?:number,gamma?:number,outBlack?:number,outWhite?:number}} [p]
 * @returns {Uint8Array}
 */
export function buildLevelsLUT(p = {}) {
  const inB = p.inBlack === undefined ? 0 : p.inBlack;
  let inW = p.inWhite === undefined ? 255 : p.inWhite;
  const g = clamp(p.gamma === undefined ? 1 : p.gamma, 0.01, 10);
  const outB = p.outBlack === undefined ? 0 : p.outBlack;
  const outW = p.outWhite === undefined ? 255 : p.outWhite;
  if (inW <= inB) inW = inB + 0.5;
  const t = new Uint8Array(256);
  const inv = 1 / g;
  for (let i = 0; i < 256; i++) {
    let v = clamp01((i - inB) / (inW - inB));
    if (inv !== 1) v = Math.pow(v, inv);
    t[i] = clampByte(outB + v * (outW - outB));
  }
  return t;
}

/**
 * Builds a 256-entry table from curve control points using a monotone cubic spline
 * (Fritsch-Carlson), so the curve never overshoots between points.
 * @param {number[][]} points [[x,y],...] with x,y in 0..1 (unsorted input is sorted, duplicate x keeps the last)
 * @returns {Uint8Array}
 */
export function buildCurveLUT(points) {
  const f = buildCurveFloat(points, 256);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = clampByte(f[i] * 255);
  return t;
}

/**
 * Same spline as {@link buildCurveLUT} sampled at `size` positions across 0..1 and returned as floats (0..1).
 * @param {number[][]} points control points
 * @param {number} size number of samples (>= 2); sample i is evaluated at x = i / (size - 1)
 * @returns {Float32Array}
 */
export function buildCurveFloat(points, size) {
  const out = new Float32Array(size);
  const pts = (points || []).filter((p) => p && isFinite(p[0]) && isFinite(p[1])).map((p) => [clamp01(p[0]), clamp01(p[1])]);
  pts.sort((a, b) => a[0] - b[0]);
  const xs = [];
  const ys = [];
  for (const p of pts) {
    if (xs.length && p[0] - xs[xs.length - 1] < 1e-6) ys[ys.length - 1] = p[1];
    else {
      xs.push(p[0]);
      ys.push(p[1]);
    }
  }
  const n = xs.length;
  if (n === 0) {
    for (let i = 0; i < size; i++) out[i] = i / (size - 1);
    return out;
  }
  if (n === 1) {
    out.fill(ys[0]);
    return out;
  }
  const h = new Array(n - 1);
  const dl = new Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    h[k] = xs[k + 1] - xs[k];
    dl[k] = (ys[k + 1] - ys[k]) / h[k];
  }
  const m = new Array(n);
  m[0] = dl[0];
  m[n - 1] = dl[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = dl[k - 1] * dl[k] <= 0 ? 0 : (dl[k - 1] + dl[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (dl[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
    } else {
      const a = m[k] / dl[k];
      const b = m[k + 1] / dl[k];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[k] = tau * a * dl[k];
        m[k + 1] = tau * b * dl[k];
      }
    }
  }
  let seg = 0;
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    if (x <= xs[0]) {
      out[i] = ys[0];
      continue;
    }
    if (x >= xs[n - 1]) {
      out[i] = ys[n - 1];
      continue;
    }
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const t = (x - xs[seg]) / h[seg];
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h[seg] * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h[seg] * m[seg + 1];
    out[i] = y < 0 ? 0 : y > 1 ? 1 : y;
  }
  return out;
}

/**
 * Brightness / contrast table. Non-legacy brightness is a gamma-like curve that keeps black and white
 * fixed (no clipping); legacy brightness adds a constant. Contrast pivots around mid gray.
 * @param {number} brightness -100..100
 * @param {number} contrast -100..100
 * @param {boolean} [legacy=false]
 * @returns {Uint8Array}
 */
export function buildBrightnessContrastLUT(brightness, contrast, legacy = false) {
  const b = clamp(brightness, -100, 100) / 100;
  const c = clamp(contrast, -100, 100) / 100;
  const slope = Math.min(1000, Math.tan(((c + 1) * Math.PI) / 4));
  const expo = Math.pow(2, -b * 1.5);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let v = legacy ? x + b : Math.pow(x, expo);
    v = (v - 0.5) * slope + 0.5;
    t[i] = clampByte(v * 255);
  }
  return t;
}

/**
 * Exposure table working in linear light: out = encode((decode(in) * 2^exposure + offset) ^ (1 / gamma)).
 * @param {number} exposure stops (EV)
 * @param {number} offset linear offset, about -0.5..0.5
 * @param {number} gamma gamma correction (1 = none; > 1 brightens midtones)
 * @returns {Uint8Array}
 */
export function buildExposureLUT(exposure, offset, gamma) {
  const mul = Math.pow(2, exposure);
  const inv = 1 / clamp(gamma, 0.05, 10);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let v = SRGB_TO_LINEAR[i] * mul + offset;
    v = clamp01(v);
    if (inv !== 1) v = Math.pow(v, inv);
    t[i] = clampByte(linearToSrgb(v) * 255);
  }
  return t;
}

/**
 * Posterize table with `levels` output levels per channel.
 * @param {number} levels 2..256
 * @returns {Uint8Array}
 */
export function buildPosterizeLUT(levels) {
  const n = clamp(Math.round(levels), 2, 256);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const q = Math.min(n - 1, Math.floor((i * n) / 256));
    t[i] = clampByte((q / (n - 1)) * 255);
  }
  return t;
}

/**
 * Gradient lookup: 768 bytes (r,g,b for each of 256 positions) interpolated in sRGB.
 * @param {{o:number, color:string}[]} stops gradient stops, o in 0..1
 * @returns {Uint8Array} 256*3 entries
 */
export function buildGradientLUT(stops) {
  const s = stops.map((st) => ({ o: clamp01(st.o), c: parseColor(st.color) })).sort((a, b) => a.o - b.o);
  const out = new Uint8Array(768);
  if (!s.length) {
    for (let i = 0; i < 256; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = i;
    return out;
  }
  let k = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let r, g, b;
    if (x <= s[0].o) [r, g, b] = s[0].c;
    else if (x >= s[s.length - 1].o) [r, g, b] = s[s.length - 1].c;
    else {
      while (k < s.length - 2 && x > s[k + 1].o) k++;
      const a = s[k];
      const c = s[k + 1];
      const t = (x - a.o) / Math.max(1e-9, c.o - a.o);
      r = a.c[0] + (c.c[0] - a.c[0]) * t;
      g = a.c[1] + (c.c[1] - a.c[1]) * t;
      b = a.c[2] + (c.c[2] - a.c[2]) * t;
    }
    out[i * 3] = clampByte(r);
    out[i * 3 + 1] = clampByte(g);
    out[i * 3 + 2] = clampByte(b);
  }
  return out;
}

/**
 * Per-channel white balance gains for the temperature / tint sliders, normalized so that the
 * linear-light luminance of a neutral gray is unchanged.
 * @param {number} temperature -100 (cooler / bluer) .. 100 (warmer / more orange)
 * @param {number} tint -100 (green) .. 100 (magenta)
 * @returns {number[]} [gainR, gainG, gainB] in linear light
 */
export function whiteBalanceGains(temperature, tint) {
  const t = clamp(temperature, -100, 100) / 100;
  const n = clamp(tint, -100, 100) / 100;
  const lr = WB_KT * t + 0.5 * WB_KN * n;
  const lg = -WB_KN * n;
  const lb = -WB_KT * t + 0.5 * WB_KN * n;
  let gr = Math.pow(2, lr);
  let gg = Math.pow(2, lg);
  let gb = Math.pow(2, lb);
  const y = 0.2126 * gr + 0.7152 * gg + 0.0722 * gb;
  gr /= y;
  gg /= y;
  gb /= y;
  return [gr, gg, gb];
}
const WB_KT = 0.6;
const WB_KN = 0.5;

/**
 * Computes the temperature / tint that turn the sampled sRGB color into a neutral gray (eyedropper).
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @returns {{temperature:number, tint:number}}
 */
export function whiteBalanceFromColor(r, g, b) {
  const lr = -Math.log2(Math.max(1e-4, SRGB_TO_LINEAR[clampByte(r)]));
  const lg = -Math.log2(Math.max(1e-4, SRGB_TO_LINEAR[clampByte(g)]));
  const lb = -Math.log2(Math.max(1e-4, SRGB_TO_LINEAR[clampByte(b)]));
  const t = (lr - lb) / (2 * WB_KT);
  const n = (lr + lb - 2 * lg) / (3 * WB_KN);
  return { temperature: clamp(Math.round(t * 100), -100, 100), tint: clamp(Math.round(n * 100), -100, 100) };
}

/**
 * Per-channel table that multiplies linear-light values by `gain`.
 * @param {number} gain
 * @returns {Uint8Array}
 */
function gainLUT(gain) {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = clampByte(linearToSrgb(clamp01(SRGB_TO_LINEAR[i] * gain)) * 255);
  return t;
}

// ---------------------------------------------------------------------------------------------
// Module plumbing
// ---------------------------------------------------------------------------------------------

function merge(defaults, params) {
  const o = Object.assign({}, defaults);
  if (params) for (const k of Object.keys(params)) if (params[k] !== undefined) o[k] = params[k];
  return o;
}

function define(id, label, category, controls, hidden, run) {
  const defaults = Object.assign({}, hidden);
  for (const c of controls) defaults[c.key] = c.default;
  return {
    id,
    label,
    category,
    defaults,
    controls,
    apply(img, params, ctx) {
      const p = merge(defaults, params);
      const out = run(img, p, ctx && ctx.scale > 0 ? ctx : { scale: 1 });
      return out || img;
    },
  };
}

const range = (key, label, min, max, def, extra = {}) => Object.assign({ key, label, type: "range", min, max, step: 1, default: def }, extra);
const bool = (key, label, def, extra = {}) => Object.assign({ key, label, type: "bool", default: def }, extra);
const color = (key, label, def, extra = {}) => Object.assign({ key, label, type: "color", default: def }, extra);
const select = (key, label, options, def, extra = {}) => Object.assign({ key, label, type: "select", options: options.map(([value, lab]) => ({ value, label: lab })), default: def }, extra);

const IDENT_CURVE = () => [[0, 0], [1, 1]];

// ---------------------------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------------------------

const LEVELS_IDENTITY = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

const GRADIENT_PRESETS = {
  grayscale: [{ o: 0, color: "#000000" }, { o: 1, color: "#ffffff" }],
  sepia: [{ o: 0, color: "#2b1a0e" }, { o: 0.55, color: "#b88a56" }, { o: 1, color: "#fff3dc" }],
  "blue-orange": [{ o: 0, color: "#0b1e5a" }, { o: 0.5, color: "#a07a82" }, { o: 1, color: "#ffb347" }],
  "cool-warm": [{ o: 0, color: "#1d3a8f" }, { o: 0.5, color: "#efefef" }, { o: 1, color: "#d4622b" }],
  sunset: [{ o: 0, color: "#1a0b3a" }, { o: 0.4, color: "#b3366b" }, { o: 0.75, color: "#ff9a3c" }, { o: 1, color: "#fff2b3" }],
  "green-gold": [{ o: 0, color: "#06210f" }, { o: 0.55, color: "#4f8a3b" }, { o: 1, color: "#f5e6a0" }],
};

const PHOTO_FILTERS = {
  "warming-85": "#ec8a00",
  "warming-81": "#ebb113",
  "cooling-80": "#006dff",
  "cooling-82": "#00b5ff",
  sepia: "#ac7a33",
  underwater: "#00c2b1",
  red: "#e20c0c",
  orange: "#f58c14",
  yellow: "#f2e30c",
  green: "#19c419",
  blue: "#1a4be0",
  violet: "#9b1ae0",
  magenta: "#e01aa8",
};

const SEL_BANDS = ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"];
const SEL_LABELS = ["Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas", "Whites", "Neutrals", "Blacks"];
const SEL_INKS = [["Cyan", "Cyan"], ["Magenta", "Magenta"], ["Yellow", "Yellow"], ["Black", "Black"]];

function selectiveControls() {
  const c = [select("method", "Method", [["relative", "Relative"], ["absolute", "Absolute"]], "relative", { hint: "Relative changes ink by a fraction of what is already there; absolute adds a fixed amount." })];
  SEL_BANDS.forEach((b, bi) => {
    for (const [ink, lab] of SEL_INKS) c.push(range(b + ink, lab, -100, 100, 0, { unit: "%", group: SEL_LABELS[bi] }));
  });
  return c;
}

const DEF_BAND_MIX = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };

/**
 * Registry of adjustments keyed by id: brightness-contrast, levels, curves, hsl, vibrance, exposure,
 * white-balance, color-balance, black-white, channel-mixer, invert, threshold, posterize, gradient-map,
 * shadows-highlights, photo-filter, selective-color, recolor. Each apply() mutates and returns the image,
 * preserves alpha and leaves fully transparent pixels untouched.
 * @type {Object<string, EffectModule>}
 */
export const ADJUSTMENTS = {
  "brightness-contrast": define(
    "brightness-contrast",
    "Brightness / Contrast",
    "Tone",
    [
      range("brightness", "Brightness", -100, 100, 0),
      range("contrast", "Contrast", -100, 100, 0),
      bool("legacy", "Use Legacy", false, { hint: "Linear brightness shift like older editors (may clip highlights)." }),
    ],
    {},
    (img, p) => {
      const lut = buildBrightnessContrastLUT(p.brightness, p.contrast, p.legacy);
      return isIdentityLUT(lut) ? img : applyLUT(img, lut);
    },
  ),

  levels: define(
    "levels",
    "Levels",
    "Tone",
    [
      select("channel", "Channel", [["rgb", "RGB"], ["red", "Red"], ["green", "Green"], ["blue", "Blue"]], "rgb"),
      range("inBlack", "Input Black", 0, 254, 0, { group: "Input" }),
      range("gamma", "Gamma", 0.1, 5, 1, { step: 0.01, group: "Input", hint: "Midtone brightness; above 1 lightens." }),
      range("inWhite", "Input White", 1, 255, 255, { group: "Input" }),
      range("outBlack", "Output Black", 0, 255, 0, { group: "Output" }),
      range("outWhite", "Output White", 0, 255, 255, { group: "Output" }),
    ],
    { channels: null },
    (img, p) => {
      const master = buildLevelsLUT(p);
      const id = identityLUT();
      const lut = [
        p.channel === "rgb" || p.channel === "red" ? master : id,
        p.channel === "rgb" || p.channel === "green" ? master : id,
        p.channel === "rgb" || p.channel === "blue" ? master : id,
      ];
      if (p.channels) {
        ["red", "green", "blue"].forEach((k, i) => {
          if (p.channels[k]) lut[i] = composeLUTs(buildLevelsLUT(merge(LEVELS_IDENTITY, p.channels[k])), lut[i]);
        });
      }
      if (isIdentityLUT(lut[0]) && isIdentityLUT(lut[1]) && isIdentityLUT(lut[2])) return img;
      return applyLUT(img, lut[0], lut[1], lut[2]);
    },
  ),

  curves: define(
    "curves",
    "Curves",
    "Tone",
    [
      { key: "master", label: "RGB", type: "curve", default: IDENT_CURVE() },
      { key: "red", label: "Red", type: "curve", default: IDENT_CURVE() },
      { key: "green", label: "Green", type: "curve", default: IDENT_CURVE() },
      { key: "blue", label: "Blue", type: "curve", default: IDENT_CURVE() },
    ],
    {},
    (img, p) => {
      const master = buildCurveLUT(p.master);
      const lr = composeLUTs(buildCurveLUT(p.red), master);
      const lg = composeLUTs(buildCurveLUT(p.green), master);
      const lb = composeLUTs(buildCurveLUT(p.blue), master);
      if (isIdentityLUT(lr) && isIdentityLUT(lg) && isIdentityLUT(lb)) return img;
      return applyLUT(img, lr, lg, lb);
    },
  ),

  hsl: define(
    "hsl",
    "Hue / Saturation / Lightness",
    "Color",
    [
      range("hue", "Hue", -180, 180, 0, { unit: "°" }),
      range("saturation", "Saturation", -100, 100, 0),
      range("lightness", "Lightness", -100, 100, 0),
    ],
    {},
    (img, p) => {
      const hue = p.hue;
      const sat = clamp(p.saturation, -100, 100) / 100;
      const lig = clamp(p.lightness, -100, 100) / 100;
      if (hue === 0 && sat === 0 && lig === 0) return img;
      const d = img.data;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        rgbToHsl(d[i], d[i + 1], d[i + 2]);
        let h = HSL_OUT[0];
        let s = HSL_OUT[1];
        let l = HSL_OUT[2];
        h += hue;
        if (sat > 0) s = s + (1 - s) * sat * (s * 5 > 1 ? 1 : s * 5);
        else s *= 1 + sat;
        if (lig > 0) l = l + (1 - l) * lig;
        else l *= 1 + lig;
        hslToRgb(h, s, l);
        d[i] = RGB_OUT[0];
        d[i + 1] = RGB_OUT[1];
        d[i + 2] = RGB_OUT[2];
      }
      return img;
    },
  ),

  vibrance: define(
    "vibrance",
    "Vibrance",
    "Color",
    [
      range("vibrance", "Vibrance", -100, 100, 0, { hint: "Boosts muted colors more than already saturated ones." }),
      range("saturation", "Saturation", -100, 100, 0),
      bool("protectSkin", "Protect Skin Tones", true),
    ],
    {},
    (img, p) => {
      const v = clamp(p.vibrance, -100, 100) / 100;
      const s = clamp(p.saturation, -100, 100) / 100;
      if (v === 0 && s === 0) return img;
      const skin = !!p.protectSkin;
      const d = img.data;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
        const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
        const sat = mx > 0 ? (mx - mn) / mx : 0;
        let k;
        if (v >= 0) {
          let w = 1 - sat;
          w *= w;
          if (skin && r > g && g >= b && r > mn) {
            const hh = (60 * (g - b)) / (r - b); // 0..60 degrees
            const sw = 1 - Math.abs(hh - 25) / 30;
            if (sw > 0) w *= 1 - 0.65 * sw;
          }
          k = 1 + v * w * 2;
        } else {
          k = 1 + v * (0.25 + 0.75 * sat);
        }
        k *= 1 + s;
        if (k < 0) k = 0;
        const l = LUMA_R * r + LUMA_G * g + LUMA_B * b;
        d[i] = l + (r - l) * k;
        d[i + 1] = l + (g - l) * k;
        d[i + 2] = l + (b - l) * k;
      }
      return img;
    },
  ),

  exposure: define(
    "exposure",
    "Exposure",
    "Tone",
    [
      range("exposure", "Exposure", -5, 5, 0, { step: 0.01, unit: " EV" }),
      range("offset", "Offset", -0.5, 0.5, 0, { step: 0.001 }),
      range("gamma", "Gamma Correction", 0.1, 5, 1, { step: 0.01 }),
    ],
    {},
    (img, p) => {
      // Linear light.
      const lut = buildExposureLUT(p.exposure, p.offset, p.gamma);
      return isIdentityLUT(lut) ? img : applyLUT(img, lut);
    },
  ),

  "white-balance": define(
    "white-balance",
    "White Balance",
    "Color",
    [
      range("temperature", "Temperature", -100, 100, 0, { hint: "Negative = cooler (blue), positive = warmer (orange)." }),
      range("tint", "Tint", -100, 100, 0, { hint: "Negative = green, positive = magenta." }),
    ],
    {},
    (img, p) => {
      // Linear light gains.
      if (p.temperature === 0 && p.tint === 0) return img;
      const g = whiteBalanceGains(p.temperature, p.tint);
      return applyLUT(img, gainLUT(g[0]), gainLUT(g[1]), gainLUT(g[2]));
    },
  ),

  "color-balance": define(
    "color-balance",
    "Color Balance",
    "Color",
    (() => {
      const c = [];
      for (const [zone, label] of [["shadows", "Shadows"], ["midtones", "Midtones"], ["highlights", "Highlights"]]) {
        c.push(range(zone + "CyanRed", "Cyan / Red", -100, 100, 0, { group: label }));
        c.push(range(zone + "MagentaGreen", "Magenta / Green", -100, 100, 0, { group: label }));
        c.push(range(zone + "YellowBlue", "Yellow / Blue", -100, 100, 0, { group: label }));
      }
      c.push(bool("preserveLuminosity", "Preserve Luminosity", true));
      return c;
    })(),
    {},
    (img, p) => {
      const zones = ["shadows", "midtones", "highlights"];
      const amt = new Float64Array(9);
      let any = false;
      zones.forEach((z, zi) => {
        amt[zi * 3] = clamp(p[z + "CyanRed"], -100, 100) / 100;
        amt[zi * 3 + 1] = clamp(p[z + "MagentaGreen"], -100, 100) / 100;
        amt[zi * 3 + 2] = clamp(p[z + "YellowBlue"], -100, 100) / 100;
      });
      for (let i = 0; i < 9; i++) if (amt[i] !== 0) any = true;
      if (!any) return img;
      // Offsets depend only on pixel luma: precompute per luma byte.
      const off = new Float32Array(256 * 3);
      const SCALE = 0.45 * 255;
      for (let l = 0; l < 256; l++) {
        const x = l / 255;
        const sw = 1 - smoothstep(0, 0.5, x);
        const hw = smoothstep(0.5, 1, x);
        const mw = 1 - sw - hw;
        let dr = (sw * amt[0] + mw * amt[3] + hw * amt[6]) * SCALE;
        let dg = (sw * amt[1] + mw * amt[4] + hw * amt[7]) * SCALE;
        let db = (sw * amt[2] + mw * amt[5] + hw * amt[8]) * SCALE;
        if (p.preserveLuminosity) {
          const dl = LUMA_R * dr + LUMA_G * dg + LUMA_B * db;
          dr -= dl;
          dg -= dl;
          db -= dl;
        }
        off[l * 3] = dr;
        off[l * 3 + 1] = dg;
        off[l * 3 + 2] = db;
      }
      const d = img.data;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const k = luma8(d[i], d[i + 1], d[i + 2]) * 3;
        d[i] = d[i] + off[k];
        d[i + 1] = d[i + 1] + off[k + 1];
        d[i + 2] = d[i + 2] + off[k + 2];
      }
      return img;
    },
  ),

  "black-white": define(
    "black-white",
    "Black & White",
    "Color",
    [
      range("reds", "Reds", -200, 300, DEF_BAND_MIX.reds, { unit: "%" }),
      range("yellows", "Yellows", -200, 300, DEF_BAND_MIX.yellows, { unit: "%" }),
      range("greens", "Greens", -200, 300, DEF_BAND_MIX.greens, { unit: "%" }),
      range("cyans", "Cyans", -200, 300, DEF_BAND_MIX.cyans, { unit: "%" }),
      range("blues", "Blues", -200, 300, DEF_BAND_MIX.blues, { unit: "%" }),
      range("magentas", "Magentas", -200, 300, DEF_BAND_MIX.magentas, { unit: "%" }),
      bool("tint", "Tint", false, { group: "Tint" }),
      color("tintColor", "Tint Color", "#e1b987", { group: "Tint" }),
      range("tintAmount", "Tint Strength", 0, 100, 40, { unit: "%", group: "Tint" }),
    ],
    {},
    (img, p) => {
      // Gray = min + (max - min) * weight(hue): pure colors map to the slider value, neutrals stay put.
      const w = [p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas].map((v) => v / 100);
      let tintLUT = null;
      if (p.tint) {
        const tc = parseColor(p.tintColor);
        rgbToHsl(tc[0], tc[1], tc[2]);
        const th = HSL_OUT[0];
        const ts = HSL_OUT[1] * clamp01(p.tintAmount / 100) * 1;
        tintLUT = new Uint8Array(768);
        for (let i = 0; i < 256; i++) {
          hslToRgb(th, ts, i / 255);
          tintLUT[i * 3] = clampByte(RGB_OUT[0]);
          tintLUT[i * 3 + 1] = clampByte(RGB_OUT[1]);
          tintLUT[i * 3 + 2] = clampByte(RGB_OUT[2]);
        }
      }
      const d = img.data;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
        const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
        let gray = mn;
        const c = mx - mn;
        if (c > 0) {
          let h;
          if (mx === r) h = (g - b) / c + (g < b ? 6 : 0);
          else if (mx === g) h = (b - r) / c + 2;
          else h = (r - g) / c + 4;
          const k = h | 0; // sector 0..5 (h < 6)
          const f = h - k;
          const wt = w[k] + (w[k === 5 ? 0 : k + 1] - w[k]) * f;
          gray = mn + c * wt;
        }
        gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
        if (tintLUT) {
          const gi = (gray + 0.5) | 0;
          d[i] = tintLUT[gi * 3];
          d[i + 1] = tintLUT[gi * 3 + 1];
          d[i + 2] = tintLUT[gi * 3 + 2];
        } else {
          d[i] = d[i + 1] = d[i + 2] = gray;
        }
      }
      return img;
    },
  ),

  "channel-mixer": define(
    "channel-mixer",
    "Channel Mixer",
    "Color",
    [
      range("rr", "Red", -200, 200, 100, { unit: "%", group: "Red Output" }),
      range("rg", "Green", -200, 200, 0, { unit: "%", group: "Red Output" }),
      range("rb", "Blue", -200, 200, 0, { unit: "%", group: "Red Output" }),
      range("rc", "Constant", -100, 100, 0, { unit: "%", group: "Red Output" }),
      range("gr", "Red", -200, 200, 0, { unit: "%", group: "Green Output" }),
      range("gg", "Green", -200, 200, 100, { unit: "%", group: "Green Output" }),
      range("gb", "Blue", -200, 200, 0, { unit: "%", group: "Green Output" }),
      range("gc", "Constant", -100, 100, 0, { unit: "%", group: "Green Output" }),
      range("br", "Red", -200, 200, 0, { unit: "%", group: "Blue Output" }),
      range("bg", "Green", -200, 200, 0, { unit: "%", group: "Blue Output" }),
      range("bb", "Blue", -200, 200, 100, { unit: "%", group: "Blue Output" }),
      range("bc", "Constant", -100, 100, 0, { unit: "%", group: "Blue Output" }),
      bool("monochrome", "Monochrome", false, { group: "Monochrome" }),
      range("grayR", "Red", -200, 300, 40, { unit: "%", group: "Monochrome" }),
      range("grayG", "Green", -200, 300, 40, { unit: "%", group: "Monochrome" }),
      range("grayB", "Blue", -200, 300, 20, { unit: "%", group: "Monochrome" }),
    ],
    {},
    (img, p) => {
      const d = img.data;
      const n = d.length;
      if (p.monochrome) {
        const a = p.grayR / 100, b = p.grayG / 100, c = p.grayB / 100;
        for (let i = 0; i < n; i += 4) {
          if (d[i + 3] === 0) continue;
          const v = a * d[i] + b * d[i + 1] + c * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        return img;
      }
      const m00 = p.rr / 100, m01 = p.rg / 100, m02 = p.rb / 100, c0 = (p.rc / 100) * 255;
      const m10 = p.gr / 100, m11 = p.gg / 100, m12 = p.gb / 100, c1 = (p.gc / 100) * 255;
      const m20 = p.br / 100, m21 = p.bg / 100, m22 = p.bb / 100, c2 = (p.bc / 100) * 255;
      const ident = m00 === 1 && m01 === 0 && m02 === 0 && m10 === 0 && m11 === 1 && m12 === 0 && m20 === 0 && m21 === 0 && m22 === 1 && c0 === 0 && c1 === 0 && c2 === 0;
      if (ident) return img;
      for (let i = 0; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = m00 * r + m01 * g + m02 * b + c0;
        d[i + 1] = m10 * r + m11 * g + m12 * b + c1;
        d[i + 2] = m20 * r + m21 * g + m22 * b + c2;
      }
      return img;
    },
  ),

  invert: define(
    "invert",
    "Invert",
    "Color",
    [bool("red", "Red", true), bool("green", "Green", true), bool("blue", "Blue", true)],
    {},
    (img, p) => {
      const inv = new Uint8Array(256);
      for (let i = 0; i < 256; i++) inv[i] = 255 - i;
      const id = identityLUT();
      return applyLUT(img, p.red ? inv : id, p.green ? inv : id, p.blue ? inv : id);
    },
  ),

  threshold: define(
    "threshold",
    "Threshold",
    "Color",
    [
      range("level", "Threshold Level", 0, 255, 128),
      range("softness", "Softness", 0, 128, 0, { hint: "Width of a smooth transition around the level." }),
      bool("invert", "Invert", false),
    ],
    {},
    (img, p) => {
      const lut = new Uint8Array(256);
      const s = Math.max(0, p.softness);
      for (let i = 0; i < 256; i++) {
        let v = s > 0 ? clamp01((i - (p.level - s / 2)) / s) : i >= p.level ? 1 : 0;
        if (p.invert) v = 1 - v;
        lut[i] = clampByte(v * 255);
      }
      const d = img.data;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = d[i + 1] = d[i + 2] = lut[luma8(d[i], d[i + 1], d[i + 2])];
      }
      return img;
    },
  ),

  posterize: define(
    "posterize",
    "Posterize",
    "Color",
    [{ key: "levels", label: "Levels", type: "int", min: 2, max: 64, step: 1, default: 4 }],
    {},
    (img, p) => {
      const lut = buildPosterizeLUT(p.levels);
      return isIdentityLUT(lut) ? img : applyLUT(img, lut);
    },
  ),

  "gradient-map": define(
    "gradient-map",
    "Gradient Map",
    "Color",
    [
      select("preset", "Preset", [["custom", "Custom"], ["grayscale", "Grayscale"], ["sepia", "Sepia"], ["blue-orange", "Blue / Orange"], ["cool-warm", "Cool / Warm"], ["sunset", "Sunset"], ["green-gold", "Green / Gold"]], "custom"),
      color("shadow", "Shadows", "#0a0a2a"),
      color("midtone", "Midtones", "#c0507a"),
      color("highlight", "Highlights", "#ffe9b0"),
      bool("useMidtone", "Use Midtone Color", true),
      range("midpoint", "Midpoint", 5, 95, 50, { unit: "%" }),
      bool("reverse", "Reverse", false),
      range("amount", "Strength", 0, 100, 100, { unit: "%" }),
    ],
    { stops: null },
    (img, p) => {
      let stops;
      if (Array.isArray(p.stops) && p.stops.length) stops = p.stops;
      else if (p.preset !== "custom" && GRADIENT_PRESETS[p.preset]) stops = GRADIENT_PRESETS[p.preset];
      else {
        stops = [{ o: 0, color: p.shadow }];
        if (p.useMidtone) stops.push({ o: p.midpoint / 100, color: p.midtone });
        stops.push({ o: 1, color: p.highlight });
      }
      if (p.reverse) stops = stops.map((s) => ({ o: 1 - s.o, color: s.color }));
      const lut = buildGradientLUT(stops);
      const k = clamp01(p.amount / 100);
      if (k === 0) return img;
      const d = img.data;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const l = luma8(d[i], d[i + 1], d[i + 2]) * 3;
        if (k === 1) {
          d[i] = lut[l];
          d[i + 1] = lut[l + 1];
          d[i + 2] = lut[l + 2];
        } else {
          d[i] += (lut[l] - d[i]) * k;
          d[i + 1] += (lut[l + 1] - d[i + 1]) * k;
          d[i + 2] += (lut[l + 2] - d[i + 2]) * k;
        }
      }
      return img;
    },
  ),

  "shadows-highlights": define(
    "shadows-highlights",
    "Shadows / Highlights",
    "Tone",
    [
      range("shadows", "Shadows Amount", 0, 100, 35, { unit: "%", group: "Shadows" }),
      range("shadowTone", "Shadows Tonal Width", 0, 100, 50, { unit: "%", group: "Shadows" }),
      range("shadowRadius", "Shadows Radius", 1, 300, 30, { unit: "px", group: "Shadows" }),
      range("highlights", "Highlights Amount", 0, 100, 0, { unit: "%", group: "Highlights" }),
      range("highlightTone", "Highlights Tonal Width", 0, 100, 50, { unit: "%", group: "Highlights" }),
      range("highlightRadius", "Highlights Radius", 1, 300, 30, { unit: "px", group: "Highlights" }),
      range("colorCorrection", "Color Correction", -100, 100, 20, { unit: "%", group: "Adjustments", hint: "Saturation change applied where tones were recovered." }),
    ],
    {},
    (img, p, ctx) => shadowsHighlights(img, p, ctx.scale),
  ),

  "photo-filter": define(
    "photo-filter",
    "Photo Filter",
    "Color",
    [
      select(
        "filter",
        "Filter",
        [["custom", "Custom Color"], ["warming-85", "Warming (85)"], ["warming-81", "Warming (81)"], ["cooling-80", "Cooling (80)"], ["cooling-82", "Cooling (82)"], ["sepia", "Sepia"], ["underwater", "Underwater"], ["red", "Red"], ["orange", "Orange"], ["yellow", "Yellow"], ["green", "Green"], ["blue", "Blue"], ["violet", "Violet"], ["magenta", "Magenta"]],
        "warming-85",
      ),
      color("color", "Color", "#ec8a00", { hint: "Used when Filter is Custom Color." }),
      range("density", "Density", 0, 100, 25, { unit: "%" }),
      bool("preserveLuminosity", "Preserve Luminosity", true),
    ],
    {},
    (img, p) => {
      // Multiplicative tint applied to encoded values.
      const hex = p.filter !== "custom" && PHOTO_FILTERS[p.filter] ? PHOTO_FILTERS[p.filter] : p.color;
      const c = parseColor(hex);
      const k = clamp01(p.density / 100);
      if (k === 0) return img;
      const mr = 1 - k + (k * c[0]) / 255;
      const mg = 1 - k + (k * c[1]) / 255;
      const mb = 1 - k + (k * c[2]) / 255;
      const d = img.data;
      const keep = !!p.preserveLuminosity;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let nr = r * mr, ng = g * mg, nb = b * mb;
        if (keep) {
          const l0 = LUMA_R * r + LUMA_G * g + LUMA_B * b;
          const l1 = LUMA_R * nr + LUMA_G * ng + LUMA_B * nb;
          if (l1 > 0.5) {
            const s = l0 / l1;
            nr *= s;
            ng *= s;
            nb *= s;
          }
        }
        d[i] = nr;
        d[i + 1] = ng;
        d[i + 2] = nb;
      }
      return img;
    },
  ),

  "selective-color": define("selective-color", "Selective Color", "Color", selectiveControls(), {}, (img, p) => selectiveColor(img, p)),

  recolor: define(
    "recolor",
    "Recolor",
    "Color",
    [
      color("source", "Source Color", "#d03030", { hint: "Pixels close to this color are changed." }),
      color("target", "Target Color", "#2a6fd0", { hint: "The source color becomes this color; similar colors shift by the same amount." }),
      range("hueRange", "Hue Range", 1, 180, 30, { unit: "°" }),
      range("satRange", "Saturation Range", 1, 100, 60, { unit: "%" }),
      range("lightRange", "Lightness Range", 1, 100, 60, { unit: "%" }),
      range("softness", "Softness", 0, 100, 40, { unit: "%" }),
      range("strength", "Strength", 0, 100, 100, { unit: "%" }),
    ],
    {},
    (img, p) => recolor(img, p),
  ),
};

// ---------------------------------------------------------------------------------------------
// Heavier adjustments
// ---------------------------------------------------------------------------------------------

function shadowsHighlights(img, p, scale) {
  const as = clamp01(p.shadows / 100);
  const ah = clamp01(p.highlights / 100);
  const cc = clamp(p.colorCorrection, -100, 100) / 100;
  if (as === 0 && ah === 0) return img;
  const w = img.width;
  const h = img.height;
  const n = w * h;
  const scratch = new Float32Array(n);
  const blurFor = (radius) => {
    const pl = lumaPlane(img, new Float32Array(n));
    gaussianBlurPlane(pl, scratch, w, h, Math.max(0.5, radius * scale), Math.max(0.5, radius * scale));
    return pl;
  };
  const sameRadius = p.shadowRadius === p.highlightRadius;
  const bs = as > 0 ? blurFor(p.shadowRadius) : null;
  const bh = ah > 0 ? (sameRadius && bs ? bs : blurFor(p.highlightRadius)) : null;
  // Local-brightness-dependent gamma: one table lookup per channel.
  // For a pixel whose neighborhood brightness is B: c' = c ^ E(B).
  const ps = 1 + (1 - clamp01(p.shadowTone / 100)) * 5;
  const phh = 1 + (1 - clamp01(p.highlightTone / 100)) * 5;
  const tabS = new Uint8Array(256 * 256);
  const tabH = new Uint8Array(256 * 256);
  for (let b = 0; b < 256; b++) {
    const bb = b / 255;
    const es = 1 + as * Math.pow(1 - bb, ps) * 3; // > 1 lifts
    const eh = 1 + ah * Math.pow(bb, phh) * 4; // > 1 darkens
    for (let c = 0; c < 256; c++) {
      const x = c / 255;
      const vs = es === 1 ? x : Math.pow(x, 1 / es);
      tabS[b * 256 + c] = clampByte(vs * 255);
      tabH[b * 256 + c] = clampByte((eh === 1 ? x : Math.pow(x, eh)) * 255);
    }
  }
  const d = img.data;
  const doCC = cc !== 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) continue;
    let r = d[j], g = d[j + 1], b = d[j + 2];
    const l0 = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    if (bs) {
      const bi = (bs[i] + 0.5) | 0;
      const row = (bi > 255 ? 255 : bi) * 256;
      r = tabS[row + r];
      g = tabS[row + g];
      b = tabS[row + b];
    }
    if (bh) {
      const bi = ((bh[i] + 0.5) | 0);
      const row = (bi > 255 ? 255 : bi) * 256;
      r = tabH[row + r];
      g = tabH[row + g];
      b = tabH[row + b];
    }
    if (doCC) {
      const l1 = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      let dl = (l1 - l0) / 255;
      dl = dl < 0 ? -dl : dl;
      const k = 1 + cc * (dl > 0.5 ? 1 : dl * 2) * 1.5;
      r = l1 + (r - l1) * k;
      g = l1 + (g - l1) * k;
      b = l1 + (b - l1) * k;
    }
    d[j] = r;
    d[j + 1] = g;
    d[j + 2] = b;
  }
  return img;
}

// Hue centers of the six chromatic bands.
const SEL_HUES = [0, 60, 120, 180, 240, 300];

function selectiveColor(img, p) {
  const adj = new Float64Array(SEL_BANDS.length * 4);
  const active = [];
  SEL_BANDS.forEach((b, bi) => {
    let any = false;
    SEL_INKS.forEach(([ink], ii) => {
      const v = clamp(p[b + ink] || 0, -100, 100) / 100;
      adj[bi * 4 + ii] = v;
      if (v !== 0) any = true;
    });
    if (any) active.push(bi);
  });
  if (!active.length) return img;
  const relative = p.method !== "absolute";
  const na = active.length;
  const d = img.data;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i] * (1 / 255), g = d[i + 1] * (1 / 255), b = d[i + 2] * (1 / 255);
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    const chroma = mx - mn;
    const l = (mx + mn) * 0.5;
    let hue = 0;
    if (chroma > 1e-6) {
      if (mx === r) hue = (g - b) / chroma + (g < b ? 6 : 0);
      else if (mx === g) hue = (b - r) / chroma + 2;
      else hue = (r - g) / chroma + 4;
      hue *= 60;
    }
    const cw = smoothstep(0.02, 0.4, chroma);
    let dc = 0, dm = 0, dy = 0, dk = 0;
    for (let a = 0; a < na; a++) {
      const bi = active[a];
      let w;
      if (bi < 6) {
        const dist = hueDistance(hue, SEL_HUES[bi]);
        w = dist >= 60 ? 0 : (1 - dist / 60) * cw;
      } else if (bi === 6) w = smoothstep(0.5, 1, mn);
      else if (bi === 7) w = (1 - cw) * (1 - Math.abs(2 * l - 1));
      else w = 1 - smoothstep(0, 0.5, mx);
      if (w <= 0) continue;
      const o = bi * 4;
      dc += adj[o] * w;
      dm += adj[o + 1] * w;
      dy += adj[o + 2] * w;
      dk += adj[o + 3] * w;
    }
    if (dc === 0 && dm === 0 && dy === 0 && dk === 0) continue;
    // Simple CMY ink amounts of the pixel.
    let ci = 1 - r, mi = 1 - g, yi = 1 - b;
    if (relative) {
      ci += dc * ci;
      mi += dm * mi;
      yi += dy * yi;
      dk *= 1 - l;
    } else {
      ci += dc;
      mi += dm;
      yi += dy;
    }
    ci = ci < 0 ? 0 : ci > 1 ? 1 : ci;
    mi = mi < 0 ? 0 : mi > 1 ? 1 : mi;
    yi = yi < 0 ? 0 : yi > 1 ? 1 : yi;
    let nr = 1 - ci, ng = 1 - mi, nb = 1 - yi;
    if (dk > 0) {
      const f = 1 - (dk > 1 ? 1 : dk);
      nr *= f;
      ng *= f;
      nb *= f;
    } else if (dk < 0) {
      const f = dk < -1 ? 1 : -dk;
      nr += (1 - nr) * f;
      ng += (1 - ng) * f;
      nb += (1 - nb) * f;
    }
    d[i] = nr * 255;
    d[i + 1] = ng * 255;
    d[i + 2] = nb * 255;
  }
  return img;
}

function recolor(img, p) {
  const k = clamp01(p.strength / 100);
  if (k === 0) return img;
  const sc = parseColor(p.source);
  const tc = parseColor(p.target);
  rgbToHsl(sc[0], sc[1], sc[2]);
  const hs = HSL_OUT[0], ss = HSL_OUT[1], ls = HSL_OUT[2];
  rgbToHsl(tc[0], tc[1], tc[2]);
  const ht = HSL_OUT[0], st = HSL_OUT[1], lt = HSL_OUT[2];
  const hr = Math.max(1e-3, p.hueRange);
  const sr = Math.max(1e-3, p.satRange / 100);
  const lr = Math.max(1e-3, p.lightRange / 100);
  const soft = clamp01(p.softness / 100);
  const dh = ht - hs;
  const satRatio = ss > 0.05 ? st / ss : 0;
  const d = img.data;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (d[i + 3] === 0) continue;
    rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const h = HSL_OUT[0], s = HSL_OUT[1], l = HSL_OUT[2];
    // Hue is meaningless for near-gray pixels: only consider it when the source color is chromatic.
    let q = Math.max(Math.abs(s - ss) / sr, Math.abs(l - ls) / lr);
    if (ss > 0.05) {
      const hq = hueDistance(h, hs) / hr;
      q = Math.max(q, hq);
      if (s < 0.04) q = Math.max(q, 2);
    }
    if (q >= 1) continue;
    const w = (soft > 0 ? 1 - smoothstep(1 - soft, 1, q) : 1) * k;
    if (w <= 0) continue;
    let ns = ss > 0.05 ? s * satRatio : s + (st - ss);
    ns = ns < 0 ? 0 : ns > 1 ? 1 : ns;
    let nl = l + (lt - ls);
    nl = nl < 0 ? 0 : nl > 1 ? 1 : nl;
    hslToRgb(h + dh, ns, nl);
    d[i] += (RGB_OUT[0] - d[i]) * w;
    d[i + 1] += (RGB_OUT[1] - d[i + 1]) * w;
    d[i + 2] += (RGB_OUT[2] - d[i + 2]) * w;
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Applies an adjustment by id.
 * @param {RGBAImage} img image (modified in place and returned)
 * @param {{kind: string, params?: object}} adjustment `kind` is an id of {@link ADJUSTMENTS}
 * @param {{scale: number}} [ctx] render context; `scale` multiplies length-like params (default 1)
 * @returns {RGBAImage}
 */
export function applyAdjustment(img, adjustment, ctx = { scale: 1 }) {
  const mod = ADJUSTMENTS[adjustment.kind];
  if (!mod) throw new RangeError("Unknown adjustment: " + adjustment.kind);
  return mod.apply(img, adjustment.params || {}, ctx);
}

export { srgbToLinear, linearToSrgb };
