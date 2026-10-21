// Palette Pro: pure color math (no OpenFini API). Imported by the tests; `scripts/pack-extensions.mjs` strips the
// `export` keywords and prepends this file to main.js and panel.js, so keep it free of imports and top-level side effects.

/** All user-visible strings of the extension in one object (translated later). */
export const STRINGS = {
  title: "Palette Pro",
  noSelection: "Select one or more layers first.",
  noColors: "The selection has no solid fill colors.",
  applied: "Palette applied to {n} layers.",
  copied: "Copied {hex}",
  imageFailed: "That image could not be read.",
  contrastResult: "Contrast {ratio}:1 ({level})",
};

import { clamp, parseColor, toHex, rgbToHsl, hslToRgb, contrastRatio, wcagLevel, suggestFix } from "../../_shared/color.js";
export { parseColor, toHex, rgbToHsl, hslToRgb, contrastRatio, wcagLevel, suggestFix };

export const HARMONIES = {
  complementary: [0, 180],
  "split-complementary": [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  analogous: [-30, 0, 30],
  monochromatic: null,
};

/** Palette of hex colors for a base color and harmony name. */
export function harmony(base, kind = "complementary", count = 5) {
  const rgb = parseColor(base);
  if (!rgb) return [];
  const [h, s, l] = rgbToHsl(rgb);
  if (kind === "monochromatic") return shades(base, count);
  const angles = HARMONIES[kind] || HARMONIES.complementary;
  return angles.map((a) => toHex(hslToRgb([h + a, s, l])));
}

/** `count` shades from dark to light that keep hue and saturation. */
export function shades(base, count = 5) {
  const rgb = parseColor(base);
  if (!rgb) return [];
  const [h, s] = rgbToHsl(rgb);
  const n = Math.max(2, count);
  return Array.from({ length: n }, (_, i) => toHex(hslToRgb([h, s, 0.15 + (0.75 * i) / (n - 1)])));
}

/** Unique hex colors of layer infos (list_layers / get_selection output), in order of appearance. */
export function colorsFromLayers(layers) {
  const seen = new Set();
  const out = [];
  const add = (v) => {
    const c = typeof v === "string" ? parseColor(v) : null;
    if (!c) return;
    const hex = toHex(c);
    if (!seen.has(hex)) (seen.add(hex), out.push(hex));
  };
  const walk = (list) => {
    for (const n of list || []) {
      add(n.fill);
      if (typeof n.stroke === "string") add(n.stroke.split(" ")[0]);
      walk(n.children);
    }
  };
  walk(layers);
  return out;
}

/**
 * Dominant colors of RGBA pixel data by median cut. Transparent pixels are ignored; near-duplicates are merged.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} k number of colors (1-12)
 */
export function dominantColors(rgba, k = 5) {
  const step = Math.max(1, Math.floor(rgba.length / 4 / 20000));
  const px = [];
  for (let i = 0; i < rgba.length; i += 4 * step) if (rgba[i + 3] > 128) px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  if (!px.length) return [];
  let boxes = [px];
  const range = (box, c) => {
    let lo = 255, hi = 0;
    for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
    return hi - lo;
  };
  while (boxes.length < clamp(k, 1, 12)) {
    let best = -1, bestSpan = 0, bestC = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        const span = range(box, c) * Math.sqrt(box.length);
        if (span > bestSpan) (bestSpan = span, best = i, bestC = c);
      }
    });
    if (best < 0) break;
    const box = boxes[best].slice().sort((a, b) => a[bestC] - b[bestC]);
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  const avg = (box) => [0, 1, 2].map((c) => box.reduce((s, p) => s + p[c], 0) / box.length);
  const result = boxes.sort((a, b) => b.length - a.length).map((b) => ({ rgb: avg(b), n: b.length }));
  const out = [];
  for (const r of result) if (!out.some((o) => distance(o.rgb, r.rgb) < 24)) out.push(r);
  return out.map((o) => toHex(o.rgb));
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Assigns palette colors to `ids` in a repeating cycle: [{ids:[...], fill}] grouped per color. */
export function assignPalette(ids, palette) {
  if (!palette.length) return [];
  const groups = palette.map((fill) => ({ ids: [], fill }));
  ids.forEach((id, i) => groups[i % palette.length].ids.push(id));
  return groups.filter((g) => g.ids.length);
}
