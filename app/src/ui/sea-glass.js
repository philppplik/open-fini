// Sea glass palette: pure color derivation, no DOM (tests/ui/glass.test.js).
//
// Sea glass is matte, softly grained and tinted. The tint follows the active accent (any theme, any of the accent presets,
// the custom accent, extension themes) or stays the classic teal, or uses an own hue. The look is inspired by the visual
// language of "weathered sea glass" (frosted matte translucency, soft caustic highlights, tinted depth, grain); no code from
// any other project is used.
//
// Public API
//   seaPalette(accent, dark, { mode, hue })  -> { tint, deep, hi, glow, grain, vars }
//     mode "accent" (default): hue and part of the saturation come from `accent`; "teal": the classic palette;
//     "custom": hue from `hue` (0-359) at a fixed saturation.
//   hexToHsl(hex)                            -> { h 0..360, s 0..1, l 0..1 }
//
// Invariants
//   * Fixed lightness per mode and a clamped saturation, so every hue gives a calm, readable tint: the tint is only ever a
//     26 % mix into the panel color, and ui/glass.js raises the fill opacity until text is AA over it (minAlpha), so contrast
//     never depends on the hue.
//   * `vars` are `--of-sea-*` custom properties consumed by glass.css (background mesh, edge light, caustics, grain).
import { hsl } from "./themes.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hexToHsl(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || "").trim());
  if (!m) return { h: 174, s: 0.5, l: 0.4 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 174, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

const CLASSIC = {
  tint: { dark: "#1b5a54", light: "#86cfbd" },
  deep: { dark: "#0f3a36", light: "#3f9b94" },
  hue: 174,
  sat: 50,
};

/** Hue shift helper (wraps). */
const hh = (h, d) => (((h + d) % 360) + 360) % 360;

export function seaPalette(accent, dark, { mode = "accent", hue = 174 } = {}) {
  let h;
  let sat; // 0..100
  if (mode === "teal") {
    h = CLASSIC.hue;
    sat = CLASSIC.sat;
  } else if (mode === "custom") {
    h = clamp(Number.isFinite(Number(hue)) ? Number(hue) : 174, 0, 359);
    sat = 48;
  } else {
    const a = hexToHsl(accent);
    h = a.h;
    sat = a.s < 0.1 ? 8 : clamp(a.s * 100 * 0.6, 28, 52); // gray accents give a nearly neutral (still tinted) glass
  }
  const classic = mode === "teal";
  const tint = classic ? (dark ? CLASSIC.tint.dark : CLASSIC.tint.light) : hsl(h, sat, dark ? 24 : 72);
  const deep = classic ? (dark ? CLASSIC.deep.dark : CLASSIC.deep.light) : hsl(h, sat, dark ? 14 : 42);
  const hi = hsl(h, clamp(sat + 6, 8, 60), dark ? 88 : 97);
  const glow = hsl(h, clamp(sat + 18, 10, 70), dark ? 72 : 80);
  const grain = dark ? 0.3 : 0.22;
  // the background layer (mesh gradient): three soft lights and a base gradient around the hue
  const mesh = [hsl(hh(h, -12), clamp(sat + 4, 8, 56), 64), hsl(hh(h, 14), clamp(sat + 8, 8, 60), 78), hsl(hh(h, -4), clamp(sat - 4, 8, 50), 42), hsl(h, clamp(sat, 8, 52), 30), hsl(hh(h, -8), clamp(sat - 2, 8, 50), 52)];
  const vars = {
    "--of-sea-tint": tint,
    "--of-sea-deep": deep,
    "--of-sea-hi": hi,
    "--of-sea-glow": glow,
    "--of-sea-grain": String(grain),
    "--of-sea-m1": mesh[0],
    "--of-sea-m2": mesh[1],
    "--of-sea-m3": mesh[2],
    "--of-sea-b1": mesh[3],
    "--of-sea-b2": mesh[4],
  };
  return { tint, deep, hi, glow, grain, vars };
}
