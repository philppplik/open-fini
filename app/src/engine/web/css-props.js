// Style panel schema and CSS value helpers for the Code studio (data driven, like the pixel effect controls).
// See docs/web-engine.md. Pure code, no DOM.

/**
 * @typedef {{ value: string, label: string, icon?: string }} PropOption
 * @typedef {{
 *   prop: string, label: string,
 *   type: 'keyword'|'segmented'|'length'|'number'|'color'|'box'|'font-family'|'font-weight'|'shadow'|'gradient'|'text'|'toggle',
 *   options?: PropOption[], units?: string[], keywords?: string[], min?: number, max?: number, step?: number,
 *   longhands?: string[], when?: { prop: string, in: string[] }, inherited?: boolean
 * }} PropDef
 * @typedef {{ id: string, label: string, props: PropDef[] }} StyleSection
 * @typedef {{ id: string, label: string, media: string|null, width: number, min?: boolean }} Breakpoint
 */

// ------------------------------------------------------------------------------------------------ schema

const title = (v) => v.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
/** @param {(string | PropOption)[]} list */
const opts = (list) => list.map((o) => (typeof o === "string" ? { value: o, label: title(o) } : o));
const LENGTH_UNITS = ["px", "%", "em", "rem", "vw", "vh"];
const SIZE_KEYWORDS = ["auto", "fit-content", "min-content", "max-content"];
const FLEX_LIKE = { prop: "display", in: ["flex", "inline-flex"] };
const GRID_LIKE = { prop: "display", in: ["grid", "inline-grid"] };
const FLEX_OR_GRID = { prop: "display", in: ["flex", "inline-flex", "grid", "inline-grid"] };

/** @type {StyleSection[]} */
export const STYLE_SECTIONS = [
  {
    id: "layout",
    label: "Layout",
    props: [
      {
        prop: "display", label: "Display", type: "segmented",
        options: opts([{ value: "block", label: "Block" }, { value: "flex", label: "Flex" }, { value: "grid", label: "Grid" }, { value: "inline-block", label: "Inline block" }, { value: "inline", label: "Inline" }, { value: "none", label: "None" }]),
      },
      {
        prop: "flex-direction", label: "Direction", type: "segmented", when: FLEX_LIKE,
        options: opts([{ value: "row", label: "Row", icon: "arrow-right" }, { value: "column", label: "Column", icon: "arrow-down" }, { value: "row-reverse", label: "Row reverse", icon: "arrow-left" }, { value: "column-reverse", label: "Column reverse", icon: "arrow-up" }]),
      },
      { prop: "flex-wrap", label: "Wrap", type: "segmented", when: FLEX_LIKE, options: opts([{ value: "nowrap", label: "No wrap" }, { value: "wrap", label: "Wrap" }, { value: "wrap-reverse", label: "Wrap reverse" }]) },
      {
        prop: "justify-content", label: "Justify", type: "keyword", when: FLEX_OR_GRID,
        options: opts(["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly", "stretch"]),
      },
      {
        prop: "align-items", label: "Align items", type: "segmented", when: FLEX_OR_GRID,
        options: opts([{ value: "flex-start", label: "Start", icon: "align-top" }, { value: "center", label: "Center", icon: "align-middle" }, { value: "flex-end", label: "End", icon: "align-bottom" }, { value: "stretch", label: "Stretch" }, { value: "baseline", label: "Baseline" }]),
      },
      { prop: "align-content", label: "Align content", type: "keyword", when: FLEX_OR_GRID, options: opts(["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly", "stretch"]) },
      { prop: "gap", label: "Gap", type: "length", units: ["px", "rem", "em", "%"], min: 0, when: FLEX_OR_GRID },
      { prop: "row-gap", label: "Row gap", type: "length", units: ["px", "rem", "em", "%"], min: 0, when: FLEX_OR_GRID },
      { prop: "column-gap", label: "Column gap", type: "length", units: ["px", "rem", "em", "%"], min: 0, when: FLEX_OR_GRID },
      { prop: "grid-template-columns", label: "Columns", type: "text", when: GRID_LIKE },
      { prop: "grid-template-rows", label: "Rows", type: "text", when: GRID_LIKE },
      { prop: "flex-grow", label: "Grow", type: "number", min: 0, step: 1 },
      { prop: "flex-shrink", label: "Shrink", type: "number", min: 0, step: 1 },
      { prop: "flex-basis", label: "Basis", type: "length", units: LENGTH_UNITS, keywords: ["auto", "content", "fit-content", "min-content", "max-content"], min: 0 },
      { prop: "align-self", label: "Align self", type: "keyword", options: opts(["auto", "flex-start", "center", "flex-end", "stretch", "baseline"]) },
      { prop: "order", label: "Order", type: "number", step: 1 },
      { prop: "overflow", label: "Overflow", type: "keyword", options: opts(["visible", "hidden", "scroll", "auto", "clip"]) },
    ],
  },
  {
    id: "spacing",
    label: "Spacing",
    props: [
      { prop: "margin", label: "Margin", type: "box", longhands: ["margin-top", "margin-right", "margin-bottom", "margin-left"], units: LENGTH_UNITS, keywords: ["auto"] },
      { prop: "padding", label: "Padding", type: "box", longhands: ["padding-top", "padding-right", "padding-bottom", "padding-left"], units: LENGTH_UNITS, min: 0 },
    ],
  },
  {
    id: "size",
    label: "Size",
    props: [
      { prop: "width", label: "Width", type: "length", units: LENGTH_UNITS, keywords: SIZE_KEYWORDS, min: 0 },
      { prop: "height", label: "Height", type: "length", units: LENGTH_UNITS, keywords: SIZE_KEYWORDS, min: 0 },
      { prop: "min-width", label: "Min width", type: "length", units: LENGTH_UNITS, keywords: ["auto", "min-content", "max-content", "fit-content"], min: 0 },
      { prop: "min-height", label: "Min height", type: "length", units: LENGTH_UNITS, keywords: ["auto", "min-content", "max-content", "fit-content"], min: 0 },
      { prop: "max-width", label: "Max width", type: "length", units: LENGTH_UNITS, keywords: ["none", "min-content", "max-content", "fit-content"], min: 0 },
      { prop: "max-height", label: "Max height", type: "length", units: LENGTH_UNITS, keywords: ["none", "min-content", "max-content", "fit-content"], min: 0 },
      { prop: "aspect-ratio", label: "Aspect ratio", type: "text" },
      { prop: "object-fit", label: "Object fit", type: "keyword", options: opts(["fill", "contain", "cover", "none", "scale-down"]) },
    ],
  },
  {
    id: "position",
    label: "Position",
    props: [
      { prop: "position", label: "Position", type: "keyword", options: opts(["static", "relative", "absolute", "fixed", "sticky"]) },
      { prop: "top", label: "Top", type: "length", units: LENGTH_UNITS, keywords: ["auto"] },
      { prop: "right", label: "Right", type: "length", units: LENGTH_UNITS, keywords: ["auto"] },
      { prop: "bottom", label: "Bottom", type: "length", units: LENGTH_UNITS, keywords: ["auto"] },
      { prop: "left", label: "Left", type: "length", units: LENGTH_UNITS, keywords: ["auto"] },
      { prop: "z-index", label: "Z-index", type: "number", step: 1 },
      { prop: "float", label: "Float", type: "segmented", options: opts(["none", "left", "right"]) },
      { prop: "clear", label: "Clear", type: "segmented", options: opts(["none", "left", "right", "both"]) },
    ],
  },
  {
    id: "typography",
    label: "Typography",
    props: [
      { prop: "font-family", label: "Font", type: "font-family", inherited: true },
      { prop: "font-size", label: "Size", type: "length", units: ["px", "rem", "em", "%", "vw"], min: 0, inherited: true },
      { prop: "font-weight", label: "Weight", type: "font-weight", inherited: true },
      { prop: "line-height", label: "Line height", type: "length", units: ["", "px", "em", "rem", "%"], keywords: ["normal"], min: 0, inherited: true },
      { prop: "letter-spacing", label: "Letter spacing", type: "length", units: ["em", "px", "rem"], keywords: ["normal"], inherited: true },
      { prop: "color", label: "Color", type: "color", inherited: true },
      {
        prop: "text-align", label: "Align", type: "segmented", inherited: true,
        options: opts([{ value: "left", label: "Left", icon: "text-left" }, { value: "center", label: "Center", icon: "text-center" }, { value: "right", label: "Right", icon: "text-right" }, { value: "justify", label: "Justify", icon: "justify" }]),
      },
      { prop: "font-style", label: "Style", type: "segmented", inherited: true, options: opts([{ value: "normal", label: "Normal" }, { value: "italic", label: "Italic", icon: "type-italic" }]) },
      { prop: "text-decoration", label: "Decoration", type: "segmented", options: opts([{ value: "none", label: "None" }, { value: "underline", label: "Underline", icon: "type-underline" }, { value: "line-through", label: "Strikethrough", icon: "type-strikethrough" }, { value: "overline", label: "Overline" }]) },
      { prop: "text-transform", label: "Transform", type: "keyword", inherited: true, options: opts(["none", "uppercase", "lowercase", "capitalize"]) },
      { prop: "white-space", label: "White space", type: "keyword", inherited: true, options: opts(["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"]) },
      { prop: "text-overflow", label: "Text overflow", type: "keyword", options: opts(["clip", "ellipsis"]) },
      { prop: "text-shadow", label: "Text shadow", type: "shadow", inherited: true },
    ],
  },
  {
    id: "backgrounds",
    label: "Backgrounds",
    props: [
      { prop: "background-color", label: "Color", type: "color" },
      { prop: "background-image", label: "Image", type: "gradient" },
      { prop: "background-size", label: "Size", type: "keyword", options: opts(["auto", "cover", "contain"]) },
      { prop: "background-position", label: "Position", type: "keyword", options: opts(["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"].map((v) => ({ value: v, label: title(v.replace(" ", "-")).replace("-", " ") }))) },
      { prop: "background-repeat", label: "Repeat", type: "keyword", options: opts(["repeat", "no-repeat", "repeat-x", "repeat-y", "space", "round"]) },
      { prop: "background-attachment", label: "Attachment", type: "keyword", options: opts(["scroll", "fixed", "local"]) },
    ],
  },
  {
    id: "borders",
    label: "Borders",
    props: [
      { prop: "border-style", label: "Style", type: "box", longhands: ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"], options: opts(["none", "solid", "dashed", "dotted", "double"]) },
      { prop: "border-width", label: "Width", type: "box", longhands: ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"], units: ["px", "em", "rem"], min: 0 },
      { prop: "border-color", label: "Color", type: "box", longhands: ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"] },
      { prop: "border-radius", label: "Radius", type: "box", longhands: ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"], units: ["px", "%", "em", "rem"], min: 0 },
      { prop: "outline", label: "Outline", type: "text" },
    ],
  },
  {
    id: "effects",
    label: "Effects",
    props: [
      { prop: "opacity", label: "Opacity", type: "number", min: 0, max: 1, step: 0.05 },
      { prop: "box-shadow", label: "Box shadow", type: "shadow" },
      { prop: "transform", label: "Transform", type: "text" },
      { prop: "transition", label: "Transition", type: "text" },
      { prop: "filter", label: "Filter", type: "text" },
      { prop: "backdrop-filter", label: "Backdrop filter", type: "text" },
      { prop: "cursor", label: "Cursor", type: "keyword", inherited: true, options: opts(["auto", "default", "pointer", "text", "move", "not-allowed", "grab", "grabbing", "crosshair", "wait", "zoom-in", "zoom-out"]) },
      { prop: "mix-blend-mode", label: "Blend mode", type: "keyword", options: opts(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]) },
      { prop: "pointer-events", label: "Pointer events", type: "segmented", inherited: true, options: opts(["auto", "none"]) },
      { prop: "visibility", label: "Visibility", type: "segmented", inherited: true, options: opts([{ value: "visible", label: "Visible", icon: "eye" }, { value: "hidden", label: "Hidden", icon: "eye-slash" }]) },
    ],
  },
];

/**
 * The definition of a property (also matches the longhands of box properties).
 * @param {string} prop
 * @returns {PropDef|null}
 */
export function getPropDef(prop) {
  for (const s of STYLE_SECTIONS) for (const p of s.props) if (p.prop === prop || (p.longhands && p.longhands.includes(prop))) return p;
  return null;
}

/**
 * True when a property's `when` condition holds for the given computed values.
 * @param {PropDef} def
 * @param {(prop: string) => string | null | undefined} getValue
 * @returns {boolean}
 */
export function isPropVisible(def, getValue) {
  if (!def.when) return true;
  const v = getValue(def.when.prop);
  return v != null && def.when.in.includes(String(v).trim().toLowerCase());
}

// ------------------------------------------------------------------------------------------------ tokenizing

/** Splits at top-level whitespace (or commas) outside parentheses and strings. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  const isSep = sep === "," ? (c) => c === "," : (c) => /\s/.test(c);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      cur += text.slice(i, j + 1);
      i = j;
    } else if (c === "(") {
      depth++;
      cur += c;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      cur += c;
    } else if (depth === 0 && isSep(c)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ------------------------------------------------------------------------------------------------ lengths and boxes

const LENGTH_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;
const ZERO_UNITLESS_UNITS = new Set(["", "px", "%", "em", "rem", "vw", "vh", "vmin", "vmax", "ch", "ex", "pt", "cm", "mm", "in", "pc", "svh", "lvh", "dvh", "svw", "dvw", "lh", "rlh", "cqw", "cqh"]);

/**
 * Parses a CSS length/number: '12px' '1.5rem' '50%' '0' '1.5' 'auto' 'calc(...)'.
 * Functions (calc, var, min, max, clamp, env) and identifiers become `{ keyword }`.
 * @param {string} value
 * @returns {{ n: number, unit: string } | { keyword: string } | null}
 */
export function parseLength(value) {
  const t = String(value ?? "").trim();
  if (!t) return null;
  const m = LENGTH_RE.exec(t);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? { n, unit: m[2].toLowerCase() === "" ? "" : m[2] === "%" ? "%" : m[2].toLowerCase() } : null;
  }
  if (/^(calc|var|min|max|clamp|env|attr|round|mod|rem|abs|sign)\(.*\)$/i.test(t)) return { keyword: t };
  if (/^-?[a-z][a-z-]*$/i.test(t)) return { keyword: t.toLowerCase() };
  return null;
}

/**
 * Formats a parsed length. Zero lengths become '0'; trailing zeros are trimmed.
 * @param {{ n: number, unit?: string } | { keyword: string }} len
 * @returns {string}
 */
export function formatLength(len) {
  if (!len) return "";
  if ("keyword" in len) return len.keyword;
  const unit = len.unit || "";
  const n = Math.round(len.n * 10000) / 10000;
  if (n === 0 && ZERO_UNITLESS_UNITS.has(unit)) return "0";
  return String(n) + unit;
}

/**
 * Expands a 1-4 value shorthand to [top, right, bottom, left].
 * @param {string} value
 * @returns {[string, string, string, string]}
 */
export function expandBox(value) {
  const p = splitTop(String(value ?? "").trim(), " ");
  if (p.length === 0) return ["", "", "", ""];
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  return [p[0], p[1], p[2], p[3]];
}

/**
 * Shortest valid shorthand for [top, right, bottom, left].
 * @param {[string, string, string, string]} box
 * @returns {string}
 */
export function collapseBox([t, r, b, l]) {
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

// ------------------------------------------------------------------------------------------------ colors

const NAMED_COLORS = {
  black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", orange: "ffa500", purple: "800080",
  pink: "ffc0cb", gray: "808080", grey: "808080", silver: "c0c0c0", maroon: "800000", navy: "000080", teal: "008080", aqua: "00ffff",
  cyan: "00ffff", magenta: "ff00ff", fuchsia: "ff00ff", lime: "00ff00", olive: "808000", brown: "a52a2a", gold: "ffd700", indigo: "4b0082",
  violet: "ee82ee", coral: "ff7f50", salmon: "fa8072", tomato: "ff6347", crimson: "dc143c", khaki: "f0e68c", ivory: "fffff0", beige: "f5f5dc",
  tan: "d2b48c", turquoise: "40e0d0", lavender: "e6e6fa", plum: "dda0dd", orchid: "da70d6", skyblue: "87ceeb", steelblue: "4682b4",
  slategray: "708090", darkgray: "a9a9a9", darkblue: "00008b", darkgreen: "006400", darkred: "8b0000", lightgray: "d3d3d3", lightblue: "add8e6",
  lightgreen: "90ee90", whitesmoke: "f5f5f5", gainsboro: "dcdcdc", rebeccapurple: "663399", hotpink: "ff69b4", chocolate: "d2691e",
  firebrick: "b22222", forestgreen: "228b22", royalblue: "4169e1", seagreen: "2e8b57",
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

function parseAlpha(tok) {
  if (tok === undefined) return 1;
  const t = tok.trim();
  if (t.endsWith("%")) return clamp(Number(t.slice(0, -1)) / 100, 0, 1);
  const n = Number(t);
  return Number.isFinite(n) ? clamp(n, 0, 1) : NaN;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * Parses hex (3/4/6/8 digits), rgb()/rgba() and hsl()/hsla() (comma and space syntax), 'transparent' and common color names.
 * @param {string} value
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function parseColor(value) {
  const t = String(value ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (t[0] === "#") {
    const h = t.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? round3(a / 255) : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? round3(parseInt(h.slice(6, 8), 16) / 255) : 1 };
    }
    return null;
  }
  const fn = /^(rgba?|hsla?)\(\s*(.*)\s*\)$/.exec(t);
  if (fn) {
    const body = fn[2].replace(/\s*\/\s*/g, " / ");
    const parts = body.includes(",") ? body.split(/\s*,\s*/) : body.split(/\s+/).filter((x) => x !== "/");
    if (parts.length < 3 || parts.length > 4) return null;
    const a = parseAlpha(parts[3]);
    if (Number.isNaN(a)) return null;
    if (fn[1].startsWith("rgb")) {
      const ch = parts.slice(0, 3).map((p) => (p.endsWith("%") ? (Number(p.slice(0, -1)) / 100) * 255 : Number(p)));
      if (ch.some((v) => !Number.isFinite(v))) return null;
      return { r: Math.round(clamp(ch[0], 0, 255)), g: Math.round(clamp(ch[1], 0, 255)), b: Math.round(clamp(ch[2], 0, 255)), a };
    }
    const hm = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(parts[0]);
    const sat = /^(-?\d*\.?\d+)%$/.exec(parts[1]);
    const lig = /^(-?\d*\.?\d+)%$/.exec(parts[2]);
    if (!hm || !sat || !lig) return null;
    let h = Number(hm[1]);
    if (hm[2] === "turn") h *= 360;
    else if (hm[2] === "rad") h = (h * 180) / Math.PI;
    else if (hm[2] === "grad") h *= 0.9;
    const [r, g, b] = hslToRgb(h, Number(sat[1]) / 100, Number(lig[1]) / 100);
    return { r, g, b, a };
  }
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, t)) {
    const h = NAMED_COLORS[t];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  return null;
}

/**
 * '#rrggbb', or 'rgba(r, g, b, a)' when the color is translucent.
 * @param {{ r: number, g: number, b: number, a?: number }} c
 * @returns {string}
 */
export function formatColor({ r, g, b, a = 1 }) {
  const ch = [r, g, b].map((v) => clamp(Math.round(v), 0, 255));
  if (a < 1) return `rgba(${ch[0]}, ${ch[1]}, ${ch[2]}, ${round3(clamp(a, 0, 1))})`;
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------------------------------------ shadows

const isColorToken = (tok) => parseColor(tok) !== null || /^(rgba?|hsla?|var|color|color-mix|oklch|oklab|lab|lch|hwb)\(/i.test(tok) || /^currentcolor$/i.test(tok) || /^[a-z]+$/i.test(tok);

/**
 * Parses a (text-|box-)shadow list. 'none' gives []. Only pixel lengths are understood: shadows using other units or
 * values the parser cannot read give [] as well (compare with 'none' to tell them apart).
 * @param {string} value
 * @returns {{ inset: boolean, x: number, y: number, blur: number, spread: number, color: string }[]}
 */
export function parseShadowList(value) {
  const t = String(value ?? "").trim();
  if (!t || /^none$/i.test(t)) return [];
  const out = [];
  for (const part of splitTop(t, ",")) {
    let inset = false;
    const nums = [];
    let color = null;
    for (const tok of splitTop(part, " ")) {
      if (/^inset$/i.test(tok)) inset = true;
      else {
        const len = parseLength(tok);
        if (len && "n" in len && (len.unit === "px" || (len.unit === "" && len.n === 0))) nums.push(len.n);
        else if (len && "n" in len) return [];
        else if (color === null && isColorToken(tok)) color = tok;
        else return [];
      }
    }
    if (nums.length < 2 || nums.length > 4) return [];
    out.push({ inset, x: nums[0], y: nums[1], blur: nums[2] ?? 0, spread: nums[3] ?? 0, color: color ?? "currentcolor" });
  }
  return out;
}

/**
 * @param {{ inset?: boolean, x: number, y: number, blur?: number, spread?: number, color?: string }[]} list
 * @returns {string}
 */
export function formatShadowList(list) {
  if (!list || !list.length) return "none";
  const px = (n) => formatLength({ n, unit: "px" });
  return list
    .map((s) => [s.inset ? "inset" : "", px(s.x), px(s.y), px(s.blur || 0), s.spread ? px(s.spread) : "", s.color || "rgba(0, 0, 0, 0.25)"].filter(Boolean).join(" "))
    .join(", ");
}

// ------------------------------------------------------------------------------------------------ gradients

const SIDE_ANGLES = { top: 0, "top right": 45, right: 90, "bottom right": 135, bottom: 180, "bottom left": 225, left: 270, "top left": 315 };

function parseAngle(tok) {
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(tok);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2] === "turn") n *= 360;
  else if (m[2] === "rad") n = (n * 180) / Math.PI;
  else if (m[2] === "grad") n *= 0.9;
  else if (!m[2] && n !== 0) return null;
  return round3(n);
}

/**
 * Parses linear-gradient() and radial-gradient() with percentage color stops.
 * Repeating gradients, conic gradients and pixel stop positions give null.
 * @param {string} value
 * @returns {{ kind: 'linear'|'radial', angle?: number, shape?: string, stops: { color: string, pos: number|null }[] } | null}
 */
export function parseGradient(value) {
  const t = String(value ?? "").trim();
  const m = /^(linear|radial)-gradient\(([\s\S]*)\)$/i.exec(t);
  if (!m) return null;
  const kind = m[1].toLowerCase() === "linear" ? "linear" : "radial";
  const args = splitTop(m[2], ",");
  if (args.length < 2) return null;
  const g = { kind, stops: [] };
  let first = 0;
  const head = args[0];
  if (kind === "linear") {
    const to = /^to\s+((?:top|bottom)(?:\s+(?:left|right))?|(?:left|right)(?:\s+(?:top|bottom))?)$/i.exec(head);
    if (to) {
      const words = to[1].toLowerCase().split(/\s+/);
      const key = words.length === 2 && (words[0] === "left" || words[0] === "right") ? `${words[1]} ${words[0]}` : words.join(" ");
      g.angle = SIDE_ANGLES[key];
      first = 1;
    } else {
      const a = parseAngle(head);
      if (a !== null) {
        g.angle = a;
        first = 1;
      } else g.angle = 180;
    }
  } else if (/^(circle|ellipse|closest-|farthest-|at\s)|^\d/i.test(head)) {
    g.shape = head;
    first = 1;
  }
  for (const arg of args.slice(first)) {
    const toks = splitTop(arg, " ");
    let pos = null;
    const lastTok = toks[toks.length - 1];
    if (toks.length > 1 && /^[+-]?(\d+\.?\d*|\.\d+)%$/.test(lastTok)) {
      pos = Number(lastTok.slice(0, -1));
      toks.pop();
    } else if (toks.length > 1 && /^[+-]?(\d+\.?\d*|\.\d+)(px|em|rem|vw|vh)$/.test(lastTok)) return null;
    const color = toks.join(" ");
    if (!color || toks.length > 1 && !/\(/.test(color)) return null;
    g.stops.push({ color, pos });
  }
  return g.stops.length >= 2 ? g : null;
}

/**
 * @param {{ kind: 'linear'|'radial', angle?: number, shape?: string, stops: { color: string, pos?: number|null }[] }} g
 * @returns {string}
 */
export function formatGradient(g) {
  const stops = g.stops.map((s) => (s.pos === null || s.pos === undefined ? s.color : `${s.color} ${round3(s.pos)}%`)).join(", ");
  if (g.kind === "radial") return `radial-gradient(${g.shape || "circle"}, ${stops})`;
  return `linear-gradient(${round3(g.angle ?? 180)}deg, ${stops})`;
}

// ------------------------------------------------------------------------------------------------ transitions

const TIMING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$|^(cubic-bezier|steps|linear)\(/i;
const TIME = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s)$/i;

/**
 * Parses a transition list into { property, duration (ms), timing, delay (ms) }.
 * @param {string} value
 * @returns {{ property: string, duration: number, timing: string, delay: number }[]}
 */
export function parseTransition(value) {
  const t = String(value ?? "").trim();
  if (!t || /^none$/i.test(t)) return [];
  const out = [];
  for (const part of splitTop(t, ",")) {
    const item = { property: "all", duration: 0, timing: "ease", delay: 0 };
    let times = 0;
    for (const tok of splitTop(part, " ")) {
      const tm = TIME.exec(tok);
      if (tm) {
        const ms = Math.round(Number(tm[1]) * (tm[2].toLowerCase() === "s" ? 1000 : 1));
        if (times === 0) item.duration = ms;
        else item.delay = ms;
        times++;
      } else if (TIMING.test(tok)) item.timing = tok;
      else item.property = tok;
    }
    out.push(item);
  }
  return out;
}

const fmtTime = (ms) => (ms !== 0 && ms % 1000 === 0 ? `${ms / 1000}s` : ms === 0 ? "0s" : `${ms}ms`);

/**
 * @param {{ property?: string, duration?: number, timing?: string, delay?: number }[]} list
 * @returns {string}
 */
export function formatTransition(list) {
  if (!list || !list.length) return "none";
  return list
    .map((t) => [t.property || "all", fmtTime(t.duration || 0), t.timing || "ease", t.delay ? fmtTime(t.delay) : ""].filter(Boolean).join(" "))
    .join(", ");
}

// ------------------------------------------------------------------------------------------------ fonts

/** System font stacks only (no web fonts are loaded). */
export const FONT_STACKS = [
  { label: "Sans", value: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { label: "Serif", value: 'Georgia, Cambria, "Times New Roman", Times, serif' },
  { label: "Mono", value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' },
  { label: "Rounded", value: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif' },
  { label: "Humanist", value: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", sans-serif' },
  { label: "Geometric", value: 'Avenir, "Avenir Next", Montserrat, Corbel, "URW Gothic", "Century Gothic", sans-serif' },
];

// ------------------------------------------------------------------------------------------------ breakpoints

/** @type {Breakpoint[]} */
export const BREAKPOINTS = [
  { id: "desktop", label: "Desktop", media: null, width: 1280 },
  { id: "desktop-xl", label: "Large desktop", media: "(min-width: 1440px)", width: 1440, min: true },
  { id: "desktop-2xl", label: "Extra large desktop", media: "(min-width: 1920px)", width: 1920, min: true },
  { id: "tablet", label: "Tablet", media: "(max-width: 991px)", width: 991 },
  { id: "mobile-landscape", label: "Mobile landscape", media: "(max-width: 767px)", width: 767 },
  { id: "mobile-portrait", label: "Mobile portrait", media: "(max-width: 478px)", width: 478 },
];

/**
 * The media query that scopes styles to a breakpoint (null for the base desktop styles).
 * @param {string} id
 * @returns {string|null}
 */
export function mediaForBreakpoint(id) {
  const bp = BREAKPOINTS.find((b) => b.id === id);
  return bp ? bp.media : null;
}

/**
 * The breakpoint that applies to a viewport of `px` width (the smallest matching max-width wins).
 * @param {number} px
 * @returns {Breakpoint}
 */
export function breakpointForWidth(px) {
  const w = Number(px);
  if (w >= 1920) return BREAKPOINTS[2];
  if (w >= 1440) return BREAKPOINTS[1];
  if (w <= 478) return BREAKPOINTS[5];
  if (w <= 767) return BREAKPOINTS[4];
  if (w <= 991) return BREAKPOINTS[3];
  return BREAKPOINTS[0];
}

/**
 * The breakpoint id whose media query equals `media` (whitespace-insensitive), or null.
 * @param {string|null} media
 * @returns {string|null}
 */
export function breakpointForMedia(media) {
  const norm = (m) => String(m ?? "").replace(/\s+/g, "").toLowerCase();
  const bp = BREAKPOINTS.find((b) => norm(b.media) === norm(media));
  return bp ? bp.id : null;
}
