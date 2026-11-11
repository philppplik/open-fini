// Scene Studio effects (docs/scene-studio.md ▸ Effects). The registry is data plus pure pixel math, so it is unit
// tested (tests/scene/effects.test.js) and shared by the three places that draw: the 2D compositor (scene/render.js),
// the WebGL pass (scene/gl.js, same formulas in GLSL) and the assistant's tools (parameter documentation).
//
// An effect type has `stage`:
//   "filter"  a CSS filter of the canvas (blur, brightness …): free on the GPU, applied while the layer is drawn
//   "pixel"   per-pixel color math (grade, chroma key, vignette …): WebGL when available, else `applyPixel` on the CPU
//   "glow"    a blurred, brightened copy added on top (needs an extra canvas)
//   "audio"   sound processing of audio clips (scene/audio.js builds the Web Audio nodes)
// Parameters are numbers (all animatable) or "#rrggbb" colors. `registerEffect` adds types (extensions, later packs).

const N_ = (s) => s; // marks texts for the catalog (scripts/i18n-extract.mjs); this module cannot import the i18n runtime
const P = (label, def, min, max, step = 0.01) => ({ label, def, min, max, step });
const C = (label, def) => ({ label, def, color: true });

/** @type {Record<string, { label: string, stage: "filter"|"pixel"|"glow"|"audio", group: string, params: Record<string, any>, css?: Function, look?: object }>} */
export const EFFECTS = {
  blur: { label: "Gaussian blur", stage: "filter", group: "Blur", params: { radius: P("Radius", 8, 0, 200, 0.5) }, css: (p, s = 1) => (p.radius > 0 ? `blur(${p.radius * s}px)` : "") },
  brightness: { label: "Brightness and contrast", stage: "filter", group: "Color", params: { brightness: P("Brightness", 1, 0, 3), contrast: P("Contrast", 1, 0, 3) }, css: (p) => `brightness(${p.brightness}) contrast(${p.contrast})` },
  saturation: { label: "Hue and saturation", stage: "filter", group: "Color", params: { hue: P("Hue", 0, -180, 180, 1), saturation: P("Saturation", 1, 0, 3) }, css: (p) => `hue-rotate(${p.hue}deg) saturate(${p.saturation})` },
  grayscale: { label: "Black and white", stage: "filter", group: "Color", params: { amount: P("Amount", 1, 0, 1) }, css: (p) => `grayscale(${p.amount})` },
  sepia: { label: "Sepia", stage: "filter", group: "Color", params: { amount: P("Amount", 1, 0, 1) }, css: (p) => `sepia(${p.amount})` },
  invert: { label: "Invert", stage: "filter", group: "Color", params: { amount: P("Amount", 1, 0, 1) }, css: (p) => `invert(${p.amount})` },
  shadow: { label: "Drop shadow", stage: "filter", group: "Stylize", params: { x: P("Offset X", 0, -200, 200, 1), y: P("Offset Y", 8, -200, 200, 1), blur: P("Blur", 16, 0, 200, 1), color: C("Color", "#000000"), opacity: P("Opacity", 0.5, 0, 1) }, css: (p, s = 1) => `drop-shadow(${p.x * s}px ${p.y * s}px ${p.blur * s}px ${withAlpha(p.color, p.opacity)})` },
  grade: {
    label: "Color grade",
    stage: "pixel",
    group: "Color",
    params: { exposure: P("Exposure", 0, -3, 3), temperature: P("Temperature", 0, -1, 1), tint: P("Tint", 0, -1, 1), contrast: P("Contrast", 1, 0, 2), saturation: P("Saturation", 1, 0, 2), vibrance: P("Vibrance", 0, -1, 1), lift: P("Shadows", 0, -0.5, 0.5), gamma: P("Midtones", 1, 0.2, 3), gain: P("Highlights", 1, 0, 2) },
  },
  look: { label: "Look", stage: "pixel", group: "Color", params: { look: { label: "Look", def: 0, min: 0, max: 5, step: 1, options: [N_("Teal and orange"), N_("Noir"), N_("Warm film"), N_("Cool night"), N_("Vintage fade"), N_("Bleach bypass")] }, amount: P("Amount", 1, 0, 1) } },
  "chroma-key": { label: "Chroma key", stage: "pixel", group: "Keying", params: { color: C("Key color", "#00d000"), tolerance: P("Tolerance", 0.3, 0, 1), softness: P("Softness", 0.1, 0, 1), spill: P("Spill removal", 0.5, 0, 1) } },
  duotone: { label: "Duotone", stage: "pixel", group: "Stylize", params: { shadows: C("Shadows", "#1e1b4b"), highlights: C("Highlights", "#fde68a"), amount: P("Amount", 1, 0, 1) } },
  vignette: { label: "Vignette", stage: "pixel", group: "Stylize", params: { amount: P("Amount", 0.5, 0, 1), size: P("Size", 0.5, 0, 1), softness: P("Softness", 0.5, 0.01, 1) } },
  posterize: { label: "Posterize", stage: "pixel", group: "Stylize", params: { levels: P("Levels", 6, 2, 32, 1) } },
  grain: { label: "Film grain", stage: "pixel", group: "Stylize", params: { amount: P("Amount", 0.15, 0, 1) } },
  eq: { label: "Equalizer", stage: "audio", group: "Audio", params: { low: P("Low (dB)", 0, -24, 24, 0.5), mid: P("Mid (dB)", 0, -24, 24, 0.5), high: P("High (dB)", 0, -24, 24, 0.5) } },
  compressor: { label: "Compressor", stage: "audio", group: "Audio", params: { threshold: P("Threshold (dB)", -24, -60, 0, 1), ratio: P("Ratio", 4, 1, 20, 0.5), makeup: P("Make-up gain (dB)", 0, 0, 24, 0.5) } },
  highpass: { label: "Low cut", stage: "audio", group: "Audio", params: { freq: P("Frequency (Hz)", 100, 20, 2000, 1) } },
  lowpass: { label: "High cut", stage: "audio", group: "Audio", params: { freq: P("Frequency (Hz)", 8000, 200, 20000, 10) } },
  gate: { label: "Noise gate", stage: "audio", group: "Audio", params: { threshold: P("Threshold (dB)", -45, -90, 0, 1), release: P("Release (s)", 0.15, 0.01, 2) } },
  glow: { label: "Glow", stage: "glow", group: "Stylize", params: { radius: P("Radius", 24, 0, 200, 1), intensity: P("Intensity", 0.6, 0, 3), threshold: P("Threshold", 0.6, 0, 1) } },
};

/** Adds an effect type (id: lowercase letters, digits, dashes). Returns false when the id is taken or invalid. */
export function registerEffect(id, def) {
  if (!/^[a-z][\w-]{0,31}$/.test(id) || EFFECTS[id] || !def?.params || !["filter", "pixel", "glow", "audio"].includes(def.stage)) return false;
  EFFECTS[id] = { group: "Other", ...def };
  return true;
}

/** Parameters of an effect with defaults filled in and numbers clamped to their range. */
export function effectParams(type, p = {}) {
  const def = EFFECTS[type];
  if (!def) return null;
  const out = {};
  for (const [k, d] of Object.entries(def.params)) {
    const v = p[k];
    if (d.color) out[k] = typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d.def;
    else out[k] = Number.isFinite(+v) && v !== null && v !== "" ? Math.max(d.min, Math.min(d.max, +v)) : d.def;
  }
  return out;
}

/** Default parameters of an effect type. */
export const effectDefaults = (type) => effectParams(type, {});

const withAlpha = (hex, a) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Math.max(0, Math.min(1, a))})`;
};

/** "#rrggbb" → [r, g, b] in 0..1 */
export function rgb(hex) {
  const m = /^#([0-9a-f]{6})/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The CSS filter string of a layer's "filter" effects, in order ("" when there are none). */
export function cssFilter(effects, scale = 1) {
  const parts = [];
  for (const e of effects) {
    const def = EFFECTS[e.type];
    if (def?.stage === "filter") parts.push(def.css(effectParams(e.type, e.p), scale));
  }
  return parts.filter(Boolean).join(" ");
}

/** The effects of one stage, with complete parameters. */
export const stageEffects = (effects, stage) => effects.filter((e) => EFFECTS[e.type]?.stage === stage).map((e) => ({ type: e.type, p: effectParams(e.type, e.p) }));

// ---------------------------------------------------------------------------------------------- pixel math
// Every function maps one straight-alpha RGBA color (0..1) to another. scene/gl.js mirrors them in GLSL: change both.

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a, b, t) => a + (b - a) * t;
const sat01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = sat01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};

/** Parameters of the six looks as grade settings plus a split-tone (shadows / highlights tint). */
export const LOOKS = [
  { exposure: 0.05, contrast: 1.12, saturation: 1.1, sh: [0.0, 0.08, 0.1], hi: [0.1, 0.04, -0.06] },
  { exposure: 0, contrast: 1.35, saturation: 0, sh: [0, 0, 0], hi: [0, 0, 0] },
  { exposure: 0.08, contrast: 1.05, saturation: 0.95, sh: [0.04, 0.01, -0.03], hi: [0.08, 0.04, -0.04] },
  { exposure: -0.1, contrast: 1.1, saturation: 0.85, sh: [-0.03, 0.0, 0.08], hi: [-0.04, 0.0, 0.06] },
  { exposure: 0.05, contrast: 0.85, saturation: 0.75, sh: [0.06, 0.04, 0.02], hi: [0.04, 0.02, -0.04] },
  { exposure: 0.05, contrast: 1.3, saturation: 0.45, sh: [0, 0, 0], hi: [0, 0, 0] },
];

function grade(c, p) {
  let r = c[0];
  let g = c[1];
  let b = c[2];
  const ex = Math.pow(2, p.exposure);
  r *= ex * (1 + p.temperature * 0.25);
  g *= ex * (1 - p.tint * 0.2);
  b *= ex * (1 - p.temperature * 0.25);
  // lift / gamma / gain
  r = Math.pow(sat01(r * p.gain + p.lift * (1 - r)), 1 / p.gamma);
  g = Math.pow(sat01(g * p.gain + p.lift * (1 - g)), 1 / p.gamma);
  b = Math.pow(sat01(b * p.gain + p.lift * (1 - b)), 1 / p.gamma);
  r = (r - 0.5) * p.contrast + 0.5;
  g = (g - 0.5) * p.contrast + 0.5;
  b = (b - 0.5) * p.contrast + 0.5;
  const l = luma(r, g, b);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const s = p.saturation * (1 + p.vibrance * (1 - (mx - mn)));
  c[0] = sat01(mix(l, r, s));
  c[1] = sat01(mix(l, g, s));
  c[2] = sat01(mix(l, b, s));
}

function look(c, p) {
  const k = LOOKS[Math.round(p.look)] || LOOKS[0];
  const o = [c[0], c[1], c[2], c[3]];
  grade(o, { exposure: k.exposure, temperature: 0, tint: 0, contrast: k.contrast, saturation: k.saturation, vibrance: 0, lift: 0, gamma: 1, gain: 1 });
  const l = luma(o[0], o[1], o[2]);
  for (let i = 0; i < 3; i++) o[i] = sat01(o[i] + k.sh[i] * (1 - l) + k.hi[i] * l);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], o[i], p.amount);
}

function chromaKey(c, p, key) {
  // distance in the chroma plane (Cb, Cr), so brightness differences of the screen do not matter
  const cb = (r, g, b) => -0.169 * r - 0.331 * g + 0.5 * b;
  const cr = (r, g, b) => 0.5 * r - 0.419 * g - 0.081 * b;
  const d = Math.hypot(cb(c[0], c[1], c[2]) - cb(key[0], key[1], key[2]), cr(c[0], c[1], c[2]) - cr(key[0], key[1], key[2]));
  const a = smooth(p.tolerance * 0.5, p.tolerance * 0.5 + p.softness * 0.5 + 1e-4, d);
  // spill: pull the key's dominant channel down to the average of the other two
  if (p.spill > 0) {
    const i = key[1] >= key[0] && key[1] >= key[2] ? 1 : key[2] >= key[0] ? 2 : 0;
    const other = (c[(i + 1) % 3] + c[(i + 2) % 3]) / 2;
    if (c[i] > other) c[i] = mix(c[i], other, p.spill);
  }
  c[3] *= a;
}

function duotone(c, p, sh, hi) {
  const l = luma(c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], mix(sh[i], hi[i], l), p.amount);
}

function vignette(c, p, u, v) {
  const d = Math.hypot(u - 0.5, v - 0.5) * 1.41421;
  const k = 1 - p.amount * smooth(p.size, p.size + p.softness, d);
  c[0] *= k;
  c[1] *= k;
  c[2] *= k;
}

function posterize(c, p) {
  const n = Math.max(2, Math.round(p.levels)) - 1;
  for (let i = 0; i < 3; i++) c[i] = Math.round(c[i] * n) / n;
}

/** Deterministic noise in -0.5..0.5 for pixel (x, y) of frame `seed` (the same on CPU and GPU within rounding). */
export function noise(x, y, seed) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

function grain(c, p, x, y, seed) {
  const n = noise(x, y, seed) * p.amount;
  for (let i = 0; i < 3; i++) c[i] = sat01(c[i] + n);
}

/**
 * Applies "pixel" effects to straight-alpha RGBA bytes in place (the CPU path, and the reference for the shaders).
 * @param {Uint8ClampedArray} data  @param {{ type: string, p: object }[]} list complete parameters (stageEffects)
 * @param {number} frame frame number (grain)
 */
export function applyPixel(data, w, h, list, frame = 0) {
  const prepared = list.map((e) => ({ ...e, key: e.type === "chroma-key" ? rgb(e.p.color) : null, sh: e.type === "duotone" ? rgb(e.p.shadows) : null, hi: e.type === "duotone" ? rgb(e.p.highlights) : null }));
  const c = [0, 0, 0, 0];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      if (data[i + 3] === 0) continue;
      c[0] = data[i] / 255;
      c[1] = data[i + 1] / 255;
      c[2] = data[i + 2] / 255;
      c[3] = data[i + 3] / 255;
      for (const e of prepared) {
        if (e.type === "grade") grade(c, e.p);
        else if (e.type === "look") look(c, e.p);
        else if (e.type === "chroma-key") chromaKey(c, e.p, e.key);
        else if (e.type === "duotone") duotone(c, e.p, e.sh, e.hi);
        else if (e.type === "vignette") vignette(c, e.p, (x + 0.5) / w, (y + 0.5) / h);
        else if (e.type === "posterize") posterize(c, e.p);
        else if (e.type === "grain") grain(c, e.p, x, y, frame);
      }
      data[i] = c[0] * 255;
      data[i + 1] = c[1] * 255;
      data[i + 2] = c[2] * 255;
      data[i + 3] = c[3] * 255;
    }
  }
  return data;
}

/** Effect catalog for the UI and the assistant: [{ type, label, group, stage, params: [{ name, label, def, min, max, color, options }] }]. */
export function effectCatalog() {
  return Object.entries(EFFECTS).map(([type, d]) => ({ type, label: d.label, group: d.group, stage: d.stage, params: Object.entries(d.params).map(([name, q]) => ({ name, ...q })) }));
}
