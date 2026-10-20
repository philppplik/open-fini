// Theme registry. A theme is pure data: CSS custom properties for a light and a dark variant.
// `applyTheme(id, mode)` writes the resolved variables onto <html>; everything else in the UI reads `--of-*` variables,
// so a theme tints surfaces, borders, selection, editor and accent without any per-component code.
//
// Extensions register their own themes with `registerTheme()` and remove them with the returned function or
// `unregisterTheme(id)`. See docs/themes.md for the variable reference.
//
// This module has no DOM dependency at import time (the contrast checks in tests/ui run it under Node).
import { parseColor } from "../core/color.js";

// ------------------------------------------------------------------ color math (pure)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** "#rrggbb" for any CSS color the app understands (alpha is dropped). */
export function hex(color) {
  const c = parseColor(color);
  return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`;
}

/** WCAG relative luminance (0..1) of an opaque color. */
export function luminance(color) {
  const c = parseColor(color);
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio (1..21). Translucent foregrounds are composited over `bg` first. */
export function contrast(fg, bg) {
  const back = composite(bg, "#000000");
  const front = composite(fg, back);
  const a = luminance(front);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Alpha-composites `fg` (may be rgba) over the opaque `bg`; returns "#rrggbb". */
export function composite(fg, bg) {
  const f = parseColor(fg);
  if (f.a >= 1) return hex(fg);
  const b = parseColor(bg);
  const m = (x, y) => x * f.a + y * (1 - f.a);
  return `#${to2(m(f.r, b.r))}${to2(m(f.g, b.g))}${to2(m(f.b, b.b))}`;
}

/** Linear mix in sRGB: t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  return `#${to2(x.r + (y.r - x.r) * t)}${to2(x.g + (y.g - x.g) * t)}${to2(x.b + (y.b - x.b) * t)}`;
}

/** HSL (h 0..360, s and l 0..100) → "#rrggbb". */
export function hsl(h, s, l) {
  const sat = clamp01(s / 100);
  const lig = clamp01(l / 100);
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${to2(f(0) * 255)}${to2(f(8) * 255)}${to2(f(4) * 255)}`;
}

/** Lightness (0..100) of a color. */
function lightness(color) {
  const c = parseColor(color);
  return ((Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 510) * 100;
}

/** Moves `fg` towards white (`dir` = 1) or black (`dir` = -1) until it reaches `min` contrast on every background. */
export function ensureContrast(fg, backgrounds, min, dir) {
  const bgs = Array.isArray(backgrounds) ? backgrounds : [backgrounds];
  const ok = (c) => bgs.every((b) => contrast(c, b) >= min);
  if (ok(fg)) return hex(fg);
  const target = dir > 0 ? "#ffffff" : "#000000";
  for (let t = 0.04; t <= 1.0001; t += 0.04) {
    const c = mix(fg, target, t);
    if (ok(c)) return c;
  }
  return target;
}

/** The text color (white or near-black) that is most readable on `bg`; white wins ties at 4.5:1. */
export function readableOn(bg) {
  const white = contrast("#ffffff", bg);
  const dark = contrast("#111218", bg);
  return white >= 4.5 || white >= dark ? "#ffffff" : "#111218";
}

const rgbaOf = (color, alpha) => {
  const c = parseColor(color);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
};

// ------------------------------------------------------------------ variable reference

/** Every variable a theme variant may set, with its purpose (also used by docs/themes.md). */
export const THEME_VARS = {
  "--of-bg-app": "Window background behind everything",
  "--of-bg-bar": "Header, toolbars, side bars and the status bar",
  "--of-bg-panel": "Dock panels and dialogs",
  "--of-bg-raised": "Raised surfaces: menus, cards, buttons, popovers",
  "--of-bg-input": "Text fields and wells",
  "--of-bg-canvas": "Pasteboard around the pages and the code preview surround",
  "--of-border": "Field borders and strong separators",
  "--of-border-soft": "Hairlines between areas",
  "--of-text": "Primary text",
  "--of-text-dim": "Secondary text and icons",
  "--of-text-faint": "Hints, placeholders and disabled text (not for essential information)",
  "--of-accent": "Selection, focus rings, active controls, primary buttons",
  "--of-accent-strong": "Hover state of the accent (derived when omitted)",
  "--of-accent-soft": "Translucent accent for selected rows (derived when omitted)",
  "--of-on-accent": "Text and icons drawn on the accent (derived when omitted)",
  "--of-danger": "Errors and destructive actions (raised to AA contrast automatically)",
  "--of-ok": "Success (raised to AA contrast automatically)",
  "--of-hover": "Overlay for hovered rows and buttons",
  "--of-active": "Overlay for pressed rows and buttons",
  "--of-shadow": "Elevation shadow of menus and dialogs",
  "--of-selection": "Background of selected text (derived when omitted)",
  "--of-editor-bg": "Code editor background (derived when omitted)",
  "--of-editor-gutter": "Line numbers",
  "--of-editor-line": "Active line highlight",
  "--of-editor-select": "Editor selection",
  "--of-syn-keyword": "Syntax: keywords",
  "--of-syn-string": "Syntax: strings",
  "--of-syn-number": "Syntax: numbers",
  "--of-syn-comment": "Syntax: comments",
  "--of-syn-function": "Syntax: functions",
  "--of-syn-tag": "Syntax: tags",
  "--of-syn-attr": "Syntax: attributes",
  "--of-syn-prop": "Syntax: properties",
  "--of-syn-type": "Syntax: types",
  "--of-syn-op": "Syntax: operators",
  "--of-syn-punct": "Syntax: punctuation",
  "--of-syn-heading": "Syntax: headings",
  "--of-syn-link": "Syntax: links",
};

/** Surfaces text is drawn on. */
export const SURFACES = ["--of-bg-app", "--of-bg-bar", "--of-bg-panel", "--of-bg-raised", "--of-bg-input"];
const SYN_KEYS = Object.keys(THEME_VARS).filter((k) => k.startsWith("--of-syn-"));

// ------------------------------------------------------------------ the default theme ("OpenFini")
// Mirrors app/styles/theme.css and code.css (tests/ui/themes.test.js keeps them in sync).

const DEFAULT_DARK = {
  "--of-accent": "#8b7cf6",
  "--of-accent-strong": "#7a69f2",
  "--of-accent-soft": "rgba(139, 124, 246, 0.18)",
  "--of-danger": "#ef5b64",
  "--of-ok": "#3dd68c",
  "--of-bg-app": "#1d1e22",
  "--of-bg-bar": "#25262b",
  "--of-bg-panel": "#2a2b31",
  "--of-bg-raised": "#34353c",
  "--of-bg-input": "#1a1b1e",
  "--of-bg-canvas": "#141518",
  "--of-border": "#3a3b43",
  "--of-border-soft": "#2f3037",
  "--of-text": "#e8e9ee",
  "--of-text-dim": "#a3a5ae",
  "--of-text-faint": "#6f717b",
  "--of-hover": "rgba(255, 255, 255, 0.07)",
  "--of-active": "rgba(255, 255, 255, 0.12)",
  "--of-shadow": "0 8px 28px rgba(0, 0, 0, 0.45)",
  "--of-syn-keyword": "#c792ea",
  "--of-syn-string": "#a5d681",
  "--of-syn-number": "#f78c6c",
  "--of-syn-comment": "#6f7586",
  "--of-syn-function": "#82aaff",
  "--of-syn-tag": "#ff757f",
  "--of-syn-attr": "#ffc777",
  "--of-syn-prop": "#7fdbca",
  "--of-syn-type": "#ffcb6b",
  "--of-syn-op": "#89ddff",
  "--of-syn-punct": "#8d92a3",
  "--of-syn-heading": "#82aaff",
  "--of-syn-link": "#7fb4ff",
  "--of-editor-bg": "#1f2025",
  "--of-editor-gutter": "#6b6f7d",
  "--of-editor-line": "rgba(255, 255, 255, 0.045)",
  "--of-editor-select": "rgba(139, 124, 246, 0.32)",
};

const DEFAULT_LIGHT = {
  "--of-accent": "#6b58e8",
  "--of-accent-strong": "#5a46de",
  "--of-accent-soft": "rgba(107, 88, 232, 0.14)",
  "--of-danger": "#c62832",
  "--of-ok": "#15803d",
  "--of-bg-app": "#e9eaee",
  "--of-bg-bar": "#f6f6f8",
  "--of-bg-panel": "#f1f1f4",
  "--of-bg-raised": "#ffffff",
  "--of-bg-input": "#ffffff",
  "--of-bg-canvas": "#cfd1d8",
  "--of-border": "#d2d3da",
  "--of-border-soft": "#dfe0e6",
  "--of-text": "#1c1d22",
  "--of-text-dim": "#5d5f69",
  "--of-text-faint": "#7c7e88",
  "--of-hover": "rgba(0, 0, 0, 0.06)",
  "--of-active": "rgba(0, 0, 0, 0.1)",
  "--of-shadow": "0 8px 28px rgba(20, 20, 40, 0.2)",
  "--of-syn-keyword": "#8c3fd6",
  "--of-syn-string": "#3a7d1e",
  "--of-syn-number": "#c4501b",
  "--of-syn-comment": "#767b8a",
  "--of-syn-function": "#2858d0",
  "--of-syn-tag": "#c8283c",
  "--of-syn-attr": "#a15c00",
  "--of-syn-prop": "#0b7d70",
  "--of-syn-type": "#9a6a00",
  "--of-syn-op": "#1b78a8",
  "--of-syn-punct": "#6b6f7d",
  "--of-syn-heading": "#2858d0",
  "--of-syn-link": "#1f5fd0",
  "--of-editor-bg": "#ffffff",
  "--of-editor-gutter": "#8a8e99",
  "--of-editor-line": "rgba(0, 0, 0, 0.04)",
  "--of-editor-select": "rgba(107, 88, 232, 0.22)",
};

// ------------------------------------------------------------------ built-in palettes (generated, then frozen as data)

/**
 * Tinted neutrals for one mode. `h`/`s` tint the surfaces, `depth` shifts the dark lightness scale (negative = deeper),
 * `lift` brightens the light scale.
 */
function neutrals(mode, { h, s, depth = 0 }) {
  if (mode === "dark") {
    const L = (l, k = 1) => hsl(h, s * k, l + depth);
    return {
      "--of-bg-app": L(11.5),
      "--of-bg-bar": L(14.5),
      "--of-bg-panel": L(17.2),
      "--of-bg-raised": L(21.5),
      "--of-bg-input": L(9.6),
      "--of-bg-canvas": L(7.4),
      "--of-border": L(26.5, 0.9),
      "--of-border-soft": L(20.5, 0.9),
      "--of-text": hsl(h, s * 0.55, 93),
      "--of-text-dim": hsl(h, s * 0.45, 70),
      "--of-text-faint": hsl(h, s * 0.35, 55),
      "--of-hover": "rgba(255, 255, 255, 0.07)",
      "--of-active": "rgba(255, 255, 255, 0.12)",
      "--of-shadow": "0 8px 28px rgba(0, 0, 0, 0.5)",
    };
  }
  const L = (l, k = 1) => hsl(h, s * k, l + depth);
  return {
    "--of-bg-app": L(92),
    "--of-bg-bar": L(97),
    "--of-bg-panel": L(95),
    "--of-bg-raised": L(100),
    "--of-bg-input": L(100),
    "--of-bg-canvas": L(82.5),
    "--of-border": L(83.5, 0.9),
    "--of-border-soft": L(89, 0.9),
    "--of-text": hsl(h, s * 0.6, 11),
    "--of-text-dim": hsl(h, s * 0.5, 36),
    "--of-text-faint": hsl(h, s * 0.4, 47),
    "--of-hover": "rgba(0, 0, 0, 0.06)",
    "--of-active": "rgba(0, 0, 0, 0.1)",
    "--of-shadow": `0 8px 28px ${rgbaOf(hsl(h, 30, 20), 0.22)}`,
  };
}

const variant = (mode, tint, accent, extra = {}) => ({ vars: { ...neutrals(mode, tint), "--of-accent": accent, ...extra } });

const BUILTIN_THEMES = [
  {
    id: "default",
    name: "OpenFini",
    group: "Classic",
    description: "The original violet-accented neutrals.",
    dark: { vars: DEFAULT_DARK },
    light: { vars: DEFAULT_LIGHT },
    neutrals: false,
  },
  {
    id: "slate",
    name: "Slate",
    group: "Classic",
    description: "Cool blue-gray with a calm blue accent.",
    dark: variant("dark", { h: 218, s: 15 }, "#7ca6ff"),
    light: variant("light", { h: 218, s: 18 }, "#2754c5"),
  },
  {
    id: "mono",
    name: "Mono",
    group: "Classic",
    description: "Pure grays. Nothing competes with your artwork.",
    dark: variant("dark", { h: 0, s: 0 }, "#e6e6e8"),
    light: variant("light", { h: 0, s: 0 }, "#202024"),
  },
  {
    id: "midnight",
    name: "Midnight",
    group: "Classic",
    description: "Deep blue-black for late sessions.",
    dark: variant("dark", { h: 233, s: 34, depth: -3.5 }, "#8c9cff"),
    light: variant("light", { h: 230, s: 30 }, "#3447d1"),
  },
  {
    id: "paper",
    name: "Paper",
    group: "Classic",
    description: "Warm off-white like uncoated stock, with a terracotta accent.",
    dark: variant("dark", { h: 34, s: 9 }, "#e2a674"),
    light: variant("light", { h: 40, s: 38 }, "#a8441f"),
  },
  {
    id: "ocean",
    name: "Ocean",
    group: "Colorful",
    description: "Deep teal-blue surfaces with a bright cyan accent.",
    dark: variant("dark", { h: 203, s: 32 }, "#3cc2f0"),
    light: variant("light", { h: 200, s: 36 }, "#075f8c"),
  },
  {
    id: "forest",
    name: "Forest",
    group: "Colorful",
    description: "Mossy greens that are easy on the eyes.",
    dark: variant("dark", { h: 152, s: 17 }, "#58cd86"),
    light: variant("light", { h: 140, s: 20 }, "#1b6f3e"),
  },
  {
    id: "sunset",
    name: "Sunset",
    group: "Colorful",
    description: "Warm dusk surfaces with an orange accent.",
    dark: variant("dark", { h: 18, s: 20 }, "#ff8a50"),
    light: variant("light", { h: 24, s: 36 }, "#b83c08"),
  },
  {
    id: "rose",
    name: "Rose",
    group: "Colorful",
    description: "Soft berry tones with a pink accent.",
    dark: variant("dark", { h: 335, s: 18 }, "#f27cb8"),
    light: variant("light", { h: 340, s: 28 }, "#b4175c"),
  },
  {
    id: "coffee",
    name: "Coffee",
    group: "Warm and retro",
    description: "Espresso browns and caramel highlights.",
    dark: variant("dark", { h: 28, s: 22 }, "#dba26a"),
    light: variant("light", { h: 32, s: 30 }, "#8a5420"),
  },
  {
    id: "solar",
    name: "Solar",
    group: "Warm and retro",
    description: "A Solarized-inspired teal night and cream day.",
    dark: variant("dark", { h: 194, s: 70, depth: -1.5 }, "#3aa5e0", {
      "--of-text": "#e6e0cc",
      "--of-text-dim": "#a4b4b4",
      "--of-text-faint": "#7f9494",
    }),
    light: variant("light", { h: 44, s: 62, depth: -0.5 }, "#1d6aa5", {
      "--of-text": "#2b3a3d",
      "--of-text-dim": "#566a6d",
      "--of-text-faint": "#6d7f7f",
    }),
  },
  {
    id: "contrast",
    name: "High contrast",
    group: "Accessible",
    description: "Maximum legibility: black and white surfaces, strong borders, a yellow accent.",
    contrast: "high",
    dark: {
      vars: {
        "--of-bg-app": "#000000",
        "--of-bg-bar": "#080808",
        "--of-bg-panel": "#0d0d0d",
        "--of-bg-raised": "#1a1a1a",
        "--of-bg-input": "#000000",
        "--of-bg-canvas": "#121212",
        "--of-border": "#9a9a9a",
        "--of-border-soft": "#5f5f5f",
        "--of-text": "#ffffff",
        "--of-text-dim": "#e2e2e2",
        "--of-text-faint": "#bdbdbd",
        "--of-accent": "#ffd60a",
        "--of-hover": "rgba(255, 255, 255, 0.16)",
        "--of-active": "rgba(255, 255, 255, 0.26)",
        "--of-shadow": "0 8px 28px rgba(0, 0, 0, 0.8)",
      },
    },
    light: {
      vars: {
        "--of-bg-app": "#f2f2f2",
        "--of-bg-bar": "#ffffff",
        "--of-bg-panel": "#ffffff",
        "--of-bg-raised": "#ffffff",
        "--of-bg-input": "#ffffff",
        "--of-bg-canvas": "#d8d8d8",
        "--of-border": "#4a4a4a",
        "--of-border-soft": "#7a7a7a",
        "--of-text": "#000000",
        "--of-text-dim": "#1f1f1f",
        "--of-text-faint": "#444444",
        "--of-accent": "#0b2fb5",
        "--of-hover": "rgba(0, 0, 0, 0.14)",
        "--of-active": "rgba(0, 0, 0, 0.24)",
        "--of-shadow": "0 8px 28px rgba(0, 0, 0, 0.4)",
      },
    },
  },
];

// ------------------------------------------------------------------ registry

const registry = new Map(); // id → normalized theme
const listeners = new Set();
const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY_RE = /^--(of|sl)-[a-z0-9-]{1,60}$/;
const VALUE_RE = /^[^;{}<>\\]{1,240}$/;
const BAD_VALUE_RE = /url\s*\(|@import|expression\s*\(|javascript:/i;

/** Reasons a theme definition is invalid (empty array = valid). Pure, so extension hosts can pre-check manifests. */
export function validateTheme(def) {
  const errors = [];
  if (!def || typeof def !== "object") return ["The theme must be an object."];
  if (typeof def.id !== "string" || !ID_RE.test(def.id)) errors.push("id must be lowercase letters, digits and dashes (max 40 characters).");
  if (typeof def.name !== "string" || !def.name.trim() || def.name.length > 40) errors.push("name is required (max 40 characters).");
  for (const mode of ["light", "dark"]) {
    const v = def[mode];
    if (!v || typeof v !== "object") {
      errors.push(`${mode} variant is required: every theme must support light and dark.`);
      continue;
    }
    const vars = v.vars ?? v;
    if (!vars || typeof vars !== "object") {
      errors.push(`${mode}.vars must be an object of CSS custom properties.`);
      continue;
    }
    for (const [k, val] of Object.entries(vars)) {
      if (k === "vars") continue;
      if (!KEY_RE.test(k)) errors.push(`${mode}: "${k}" is not an allowed variable (use --of-* or --sl-*).`);
      else if (typeof val !== "string" || !VALUE_RE.test(val) || BAD_VALUE_RE.test(val)) errors.push(`${mode}: the value of ${k} is not allowed.`);
    }
    if (!vars["--of-bg-panel"] && !def.derive) {
      // a missing base color falls back to the default theme: allowed, just checked for the minimum
    }
  }
  if (def.accent != null) {
    const accents = typeof def.accent === "string" ? [def.accent] : [def.accent.light, def.accent.dark];
    for (const a of accents) if (typeof a !== "string" || !/^#[0-9a-f]{6}$/i.test(a)) errors.push("accent must be #rrggbb (or { light, dark }).");
  }
  return errors;
}

function normalize(def) {
  const pick = (mode) => {
    const raw = def[mode];
    const vars = { ...(raw.vars ?? raw) };
    delete vars.vars;
    const accent = typeof def.accent === "string" ? def.accent : def.accent?.[mode];
    if (accent && !vars["--of-accent"]) vars["--of-accent"] = accent;
    return Object.freeze(vars);
  };
  return Object.freeze({
    id: def.id,
    name: def.name.trim(),
    group: def.group || "Extensions",
    description: def.description || "",
    contrast: def.contrast === "high" ? "high" : "normal",
    neutrals: def.neutrals !== false,
    builtin: BUILTIN_IDS.has(def.id) && def.__builtin === true,
    light: Object.freeze({ vars: pick("light") }),
    dark: Object.freeze({ vars: pick("dark") }),
  });
}

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (err) {
      console.error("[themes]", err);
    }
  }
}

/**
 * Registers a theme. Returns a function that removes it again.
 * @param {{id:string,name:string,group?:string,description?:string,accent?:string|{light:string,dark:string},contrast?:"high",
 *   light:{vars:Record<string,string>},dark:{vars:Record<string,string>}}} def
 * @param {{replace?:boolean}} [opts] allow replacing an extension theme with the same id (built-ins can never be replaced)
 */
export function registerTheme(def, { replace = false } = {}) {
  const errors = validateTheme(def);
  if (errors.length) throw new Error(`Invalid theme: ${errors.join(" ")}`);
  const existing = registry.get(def.id);
  if (existing?.builtin) throw new Error(`“${def.id}” is a built-in theme and cannot be replaced.`);
  if (existing && !replace) throw new Error(`A theme with the id “${def.id}” is already registered.`);
  const theme = normalize(def);
  registry.set(theme.id, theme);
  notify();
  return () => {
    if (registry.get(theme.id) === theme) unregisterTheme(theme.id);
  };
}

/** Removes an extension theme. Built-in themes cannot be removed. Returns true when something was removed. */
export function unregisterTheme(id) {
  const t = registry.get(id);
  if (!t || t.builtin) return false;
  registry.delete(id);
  notify();
  return true;
}

export const getTheme = (id) => registry.get(id) || null;
export const hasTheme = (id) => registry.has(id);

/** Registered themes in display order: built-ins first (as listed), then extensions by name. */
export function listThemes() {
  const all = [...registry.values()];
  const builtin = BUILTIN_THEMES.map((t) => registry.get(t.id)).filter(Boolean);
  const ext = all.filter((t) => !t.builtin).sort((a, b) => a.name.localeCompare(b.name));
  return [...builtin, ...ext];
}

/** Calls `fn` whenever a theme is added or removed. Returns the unsubscribe function. */
export function onThemesChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

for (const t of BUILTIN_THEMES) {
  const theme = normalize({ ...t, __builtin: true });
  registry.set(theme.id, theme);
}

// ------------------------------------------------------------------ resolving a theme variant

const NEUTRAL_STOPS = { 0: 0, 50: 0.035, 100: 0.07, 200: 0.14, 300: 0.24, 400: 0.46, 500: 0.6, 600: 0.72, 700: 0.82, 800: 0.9, 900: 0.95, 950: 0.98, 1000: 1 };

/** Shoelace's neutral scale rebuilt from the theme's surface and text colors (so menus, selects and dialogs are tinted). */
function shoelaceNeutrals(v) {
  const out = {};
  for (const [step, t] of Object.entries(NEUTRAL_STOPS)) out[`--sl-color-neutral-${step}`] = mix(v["--of-bg-raised"], v["--of-text"], t);
  return out;
}

/** Variables derived from the accent (strong, soft, on-accent). `dark` selects the lightness direction of the hover state. */
export function accentVars(accent, { dark, dim = null } = {}) {
  const on = readableOn(accent);
  const lightText = on === "#ffffff";
  return {
    "--of-accent": hex(accent),
    "--of-accent-strong": mix(accent, lightText ? "#000000" : "#ffffff", lightText ? 0.12 : 0.14),
    "--of-accent-soft": rgbaOf(accent, dim ?? (dark ? 0.2 : 0.14)),
    "--of-on-accent": on,
  };
}

/**
 * The complete variable map of a theme variant: the theme's own values over the default theme's, plus derived values
 * (accent states, editor colors, selection, readable status colors, Shoelace neutrals) and the optional high-contrast
 * treatment. `accent` overrides the theme's accent (the user's accent preference).
 * @returns {Record<string,string>}
 */
export function resolveVars(themeOrId, mode, { highContrast = false, accent = null } = {}) {
  const theme = typeof themeOrId === "string" ? registry.get(themeOrId) || registry.get("default") : themeOrId;
  const dark = mode === "dark";
  const base = dark ? DEFAULT_DARK : DEFAULT_LIGHT;
  const own = theme[dark ? "dark" : "light"].vars;
  const v = { ...base, ...own };
  const surfaces = SURFACES.map((k) => v[k]);

  // surfaces and text for themes that only gave some of them
  if (own["--of-bg-panel"] && !own["--of-bg-input"]) v["--of-bg-input"] = own["--of-bg-panel"];

  // text hierarchy: guarantee AA for text and dim text, and a readable faint text
  v["--of-text"] = ensureContrast(v["--of-text"], surfaces, 7, dark ? 1 : -1);
  v["--of-text-dim"] = ensureContrast(v["--of-text-dim"], surfaces, 4.5, dark ? 1 : -1);
  v["--of-text-faint"] = ensureContrast(v["--of-text-faint"], surfaces, 3, dark ? 1 : -1);

  // accent: the user's override wins over the theme's accent; values the theme set explicitly win over derived ones
  const acc = accent || own["--of-accent"] || base["--of-accent"];
  const derived = accentVars(acc, { dark });
  v["--of-accent"] = derived["--of-accent"];
  for (const k of ["--of-accent-strong", "--of-accent-soft", "--of-on-accent"]) v[k] = !accent && own[k] ? own[k] : derived[k];

  // status colors stay readable on every surface
  const statusBgs = [v["--of-bg-bar"], v["--of-bg-panel"], v["--of-bg-raised"]];
  v["--of-danger"] = ensureContrast(v["--of-danger"], statusBgs, 4.5, dark ? 1 : -1);
  v["--of-ok"] = ensureContrast(v["--of-ok"], statusBgs, 4.5, dark ? 1 : -1);

  // text selection and the code editor follow the theme's surfaces
  v["--of-selection"] = own["--of-selection"] || rgbaOf(v["--of-accent"], dark ? 0.38 : 0.28);
  if (!own["--of-editor-bg"]) v["--of-editor-bg"] = dark ? mix(v["--of-bg-input"], v["--of-bg-panel"], 0.5) : v["--of-bg-raised"];
  if (!own["--of-editor-select"]) v["--of-editor-select"] = rgbaOf(v["--of-accent"], dark ? 0.34 : 0.22);
  if (!own["--of-editor-line"]) v["--of-editor-line"] = dark ? "rgba(255, 255, 255, 0.045)" : "rgba(0, 0, 0, 0.04)";
  const ed = v["--of-editor-bg"];
  for (const k of SYN_KEYS) v[k] = ensureContrast(v[k], ed, k === "--of-syn-comment" || k === "--of-syn-punct" ? 3 : 4.5, dark ? 1 : -1);
  v["--of-editor-gutter"] = ensureContrast(v["--of-editor-gutter"], ed, 3, dark ? 1 : -1);

  if (highContrast) {
    const fg = dark ? "#ffffff" : "#000000";
    const bgMain = v["--of-bg-panel"];
    v["--of-text"] = fg;
    v["--of-text-dim"] = ensureContrast(mix(fg, bgMain, 0.1), surfaces, 7, dark ? 1 : -1);
    v["--of-text-faint"] = ensureContrast(mix(fg, bgMain, 0.25), surfaces, 4.5, dark ? 1 : -1);
    v["--of-border"] = ensureContrast(mix(fg, bgMain, 0.45), [v["--of-bg-input"], bgMain], 3, dark ? 1 : -1);
    v["--of-border-soft"] = ensureContrast(mix(fg, bgMain, 0.62), [bgMain], 3, dark ? 1 : -1);
    v["--of-hover"] = dark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.14)";
    v["--of-active"] = dark ? "rgba(255, 255, 255, 0.26)" : "rgba(0, 0, 0, 0.24)";
    v["--of-accent"] = ensureContrast(v["--of-accent"], surfaces, 4.5, dark ? 1 : -1);
    Object.assign(v, accentVars(v["--of-accent"], { dark }));
  }

  if (theme.neutrals) Object.assign(v, shoelaceNeutrals(v));
  return v;
}

// ------------------------------------------------------------------ applying

let applied = { keys: new Set(), id: null, mode: null };

/**
 * Applies a theme to the document.
 * @param {string} id registered theme id (falls back to the default theme)
 * @param {"light"|"dark"|"auto"} mode
 * @param {{root?:HTMLElement, highContrast?:boolean, accent?:string|null}} [opts]
 * @returns {{id:string, mode:"light"|"dark", vars:Record<string,string>}}
 */
export function applyTheme(id, mode, { root = typeof document !== "undefined" ? document.documentElement : null, highContrast = false, accent = null } = {}) {
  const effective = mode === "auto" ? (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode === "light" ? "light" : "dark";
  const theme = registry.get(id) || registry.get("default");
  const vars = resolveVars(theme, effective, { highContrast, accent });
  if (root) {
    for (const k of applied.keys) if (!(k in vars)) root.style.removeProperty(k);
    for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
    root.dataset.ofTheme = theme.id;
    root.dataset.ofMode = effective;
    root.style.colorScheme = effective;
  }
  applied = { keys: new Set(Object.keys(vars)), id: theme.id, mode: effective };
  return { id: theme.id, mode: effective, vars };
}

/** What the last `applyTheme` call produced (for the Vibe tools and the gallery). */
export const currentTheme = () => ({ id: applied.id, mode: applied.mode });

/** The raw default variants (tests compare them with theme.css and code.css). */
export const DEFAULT_VARS = Object.freeze({ dark: DEFAULT_DARK, light: DEFAULT_LIGHT });
