// Shared color math for bundled extensions (WCAG contrast, HSL, color parsing). Pure; no imports.
// Extensions import it as `import {...} from "../../_shared/color.js"`; the packer inlines it and drops the import line.

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** "#rgb", "#rrggbb", "#rrggbbaa", "rgb(1,2,3)" or a CSS name -> [r,g,b] (0-255) or null. */
export function parseColor(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase().split(/\s+@/)[0];
  const named = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080" };
  const t = named[s] || s;
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(t);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(t);
  if (m) return [m[1], m[2], m[3]].map((x) => clamp(Number(x), 0, 255));
  return null;
}

export function toHex(rgb) {
  return `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

/** [r,g,b] -> [h (0-360), s (0-1), l (0-1)] */
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** WCAG 2.x relative luminance. */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1-21) of two colors given as strings or [r,g,b]. */
export function contrastRatio(a, b) {
  const ca = typeof a === "string" ? parseColor(a) : a;
  const cb = typeof b === "string" ? parseColor(b) : b;
  if (!ca || !cb) return null;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** @returns {{aa: boolean, aaLarge: boolean, aaa: boolean, aaaLarge: boolean, level: string}} */
export function wcagLevel(ratio) {
  const r = ratio ?? 0;
  const out = { aa: r >= 4.5, aaLarge: r >= 3, aaa: r >= 7, aaaLarge: r >= 4.5 };
  out.level = out.aaa ? "AAA" : out.aa ? "AA" : out.aaLarge ? "AA large text only" : "Fail";
  return out;
}

/** Moves the lightness of `fg` until it reaches `target` against `bg`. Returns up to two suggestions (darker/lighter). */
export function suggestFix(fg, bg, target = 4.5) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return [];
  const [h, s, l] = rgbToHsl(f);
  const out = [];
  for (const dir of [-1, 1]) {
    for (let step = dir < 0 ? 0 : 1; step <= 100; step++) {
      const nl = l + (dir * step) / 100;
      if (nl < 0 || nl > 1) break;
      const rgb = hslToRgb([h, s, nl]);
      if (contrastRatio(rgb, b) >= target) {
        out.push({ color: toHex(rgb), ratio: Math.round(contrastRatio(rgb, b) * 100) / 100, direction: dir < 0 ? "darker" : "lighter", delta: step });
        break;
      }
    }
  }
  return out.sort((x, y) => x.delta - y.delta);
}
