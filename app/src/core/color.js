// Color parsing, conversion and formatting. Internally colors are '#rrggbb' or '#rrggbbaa'.
import { clamp } from "./util.js";

const NAMED = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  transparent: "#00000000",
};

const cache = new Map();

/** Parses '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', 'rgb()/rgba()' and a few names → {r,g,b,a} (0..255, a 0..1). */
export function parseColor(input) {
  if (typeof input !== "string") return { r: 0, g: 0, b: 0, a: 1 };
  let c = cache.get(input);
  if (c) return c;
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let out = { r: 0, g: 0, b: 0, a: 1 };
  let m;
  if (s[0] === "#") {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((ch) => ch + ch).join("");
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) {
      out = {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  } else if ((m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s))) {
    const ch = (v) => (v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    out = {
      r: clamp(Math.round(ch(m[1])), 0, 255),
      g: clamp(Math.round(ch(m[2])), 0, 255),
      b: clamp(Math.round(ch(m[3])), 0, 255),
      a: m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]),
    };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(input, out);
  return out;
}

const hex2 = (v) => {
  const n = clamp(Math.round(v), 0, 255);
  return (n < 16 ? "0" : "") + n.toString(16);
};

export function rgbToHex(r, g, b, a = 1) {
  return "#" + hex2(r) + hex2(g) + hex2(b) + (a < 1 ? hex2(a * 255) : "");
}

/** Returns '#rrggbb' (alpha dropped). */
export function toHex6(color) {
  const { r, g, b } = parseColor(color);
  return rgbToHex(r, g, b);
}

export function colorAlpha(color) {
  return parseColor(color).a;
}

/** Returns a CSS `rgba(...)` string, applying an extra alpha multiplier. */
export function cssColor(color, alpha = 1) {
  const c = parseColor(color);
  const a = c.a * alpha;
  return a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${+a.toFixed(4)})`;
}

export function withAlpha(color, a) {
  const c = parseColor(color);
  return rgbToHex(c.r, c.g, c.b, clamp(a, 0, 1));
}

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/** WCAG relative luminance 0..1. */
export function luminance(color) {
  const { r, g, b } = parseColor(color);
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Perceptual brightness 0..1 (fast, non-linear). Used for choosing mask paint direction. */
export function brightness(color) {
  const { r, g, b } = parseColor(color);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function mixColors(a, b, t) {
  const A = parseColor(a);
  const B = parseColor(b);
  return rgbToHex(
    A.r + (B.r - A.r) * t,
    A.g + (B.g - A.g) * t,
    A.b + (B.b - A.b) * t,
    A.a + (B.a - A.a) * t,
  );
}

export const WHITE = "#ffffff";
export const BLACK = "#000000";

/** The default swatch palette shipped with every new document. */
export const DEFAULT_SWATCHES = [
  "#000000", "#404040", "#808080", "#bfbfbf", "#ffffff",
  "#e5484d", "#f76b15", "#ffb224", "#f5d90a", "#99d52a",
  "#30a46c", "#12a594", "#00a2c7", "#0090ff", "#3e63dd",
  "#6e56cf", "#8e4ec6", "#d6409f", "#ab4aba", "#ce2c31",
  "#a18072", "#665b52", "#2b2d42", "#ef233c", "#2ec4b6",
];
