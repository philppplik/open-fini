// Font helpers: CSS font strings, canvas-based measurement for the layout engine, font loading.
import { createCanvas } from "./doc.js";

const SERIF = /^(times|georgia|garamond|palatino|baskerville|bodoni|cambria|book antiqua|didot|minion|playfair|lora|merriweather|source serif)/i;
const MONO = /^(courier|consolas|menlo|monaco|lucida console|jetbrains|fira code|source code|sf mono|ibm plex mono|cascadia)/i;

export const DEFAULT_FONT_FAMILY = "Inter";

export function genericFor(family) {
  if (SERIF.test(family)) return "serif";
  if (MONO.test(family)) return "monospace";
  return "sans-serif";
}

const quote = (f) => (/^[a-z-]+$/i.test(f) && !/\s/.test(f) && !/^(serif|sans-serif|monospace|system-ui|cursive|fantasy)$/i.test(f) ? f : `"${f.replace(/"/g, "")}"`);

/** CSS `font` shorthand for a {family,size,weight,style} spec. */
export function fontCss(font) {
  const fam = font.family || DEFAULT_FONT_FAMILY;
  const stack = /^(serif|sans-serif|monospace|system-ui)$/i.test(fam) ? fam : `${quote(fam)}, ${genericFor(fam)}`;
  return `${font.style === "italic" ? "italic " : ""}${font.weight || 400} ${font.size}px ${stack}`;
}

let scratch = null;
function ctx() {
  if (!scratch) {
    const c = createCanvas(4, 4);
    scratch = c.getContext("2d");
  }
  return scratch;
}

const widthCache = new Map();
const metricCache = new Map();
export const fontState = { version: 0 };

/** Width of `text` in px for the font spec (cached). */
export function measure(font, text) {
  if (!text) return 0;
  const css = fontCss(font);
  const cacheable = text.length <= 48;
  const key = cacheable ? `${css}|${text}` : null;
  if (key) {
    const hit = widthCache.get(key);
    if (hit !== undefined) return hit;
  }
  const c = ctx();
  c.font = css;
  const w = c.measureText(text).width;
  if (key) {
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

/** Ascent/descent (px) of the font spec. */
export function metrics(font) {
  const css = fontCss(font);
  let m = metricCache.get(css);
  if (!m) {
    const c = ctx();
    c.font = css;
    const t = c.measureText("Hxg");
    const ascent = t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent ?? font.size * 0.9;
    const descent = t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent ?? font.size * 0.25;
    const x = c.measureText("x");
    m = { ascent, descent, lineGap: 0, xHeight: x.actualBoundingBoxAscent || font.size * 0.5 };
    if (metricCache.size > 2000) metricCache.clear();
    metricCache.set(css, m);
  }
  return m;
}

export const measurer = { measure, metrics };

const loaded = new Set();

/** Waits for a web font (best effort) and bumps the version so text re-lays out. */
export async function ensureFont(family, weight = 400, style = "normal") {
  if (typeof document === "undefined" || !document.fonts) return;
  const spec = `${style === "italic" ? "italic " : ""}${weight} 16px ${quote(family)}`;
  if (loaded.has(spec)) return;
  try {
    await document.fonts.load(spec, "Hxg");
  } catch {
    /* ignore */
  }
  loaded.add(spec);
  bumpFonts();
}

export function bumpFonts() {
  fontState.version++;
  widthCache.clear();
  metricCache.clear();
}

if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener?.("loadingdone", () => {
    bumpFonts();
    window.dispatchEvent(new CustomEvent("openfini:fonts"));
  });
}

const COMMON = [
  "Inter", "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Calibri", "Candara",
  "Times New Roman", "Georgia", "Garamond", "Palatino Linotype", "Book Antiqua", "Cambria",
  "Courier New", "Consolas", "Lucida Console", "Impact", "Comic Sans MS", "Arial Black", "Futura", "Gill Sans",
  "Optima", "Baskerville", "Didot", "Avenir", "Menlo", "Monaco", "system-ui", "serif", "sans-serif", "monospace",
];

let fontList = null;
/** Installed font families when the Local Font Access API is available; otherwise a curated list. */
export async function listFontFamilies({ request = false } = {}) {
  if (fontList) return fontList;
  const out = new Set(COMMON);
  if (request && typeof window !== "undefined" && window.queryLocalFonts) {
    try {
      for (const f of await window.queryLocalFonts()) out.add(f.family);
    } catch {
      /* permission denied */
    }
  }
  fontList = [...out].sort((a, b) => a.localeCompare(b));
  if (request) return fontList;
  const l = fontList;
  fontList = null;
  return l;
}

/** Registers a font file (TTF/OTF/WOFF) so canvas text can use it. */
export async function registerFont(family, buffer, { weight = "400", style = "normal" } = {}) {
  const face = new FontFace(family, buffer, { weight, style });
  await face.load();
  document.fonts.add(face);
  bumpFonts();
  return face;
}
