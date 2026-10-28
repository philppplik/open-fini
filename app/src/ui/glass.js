// Surface styles ("glass"): pure logic. No DOM, runs under Node (tests/ui/glass.test.js).
//
// A surface style turns the window chrome (header, docks, menus, dialogs, ...) from opaque panels into translucent ones
// that sit on a background layer. Everything visual lives in app/styles/glass.css and is driven by the `--of-glass-*`
// variables this module computes; the DOM glue is ui/glass-dom.js, the Settings UI is ui/surface-gallery.js.
//
// Public API
//   SURFACE_STYLES, STYLE_DEFS, BACKDROPS         static data
//   blend(top, bottom, alpha)                     opaque color of `top` at `alpha` over `bottom`
//   glassFill(surface, bottom, opts)              opaque color a translucent panel really shows over a backdrop
//   stressBackdrops(vars, scrim)                  worst-case backdrops (white, black, accent) after the scrim
//   minAlpha(vars, style)                         lowest fill opacity that keeps text AA on the worst backdrops
//   resolveTint(style, dark, vars, s)             tint color (sea glass: derived from the accent, ui/sea-glass.js)
//   specularVars(specular, bevel, dark)           Liquid glass highlight/bevel variables
//   fxState(env)                                  is backdrop-filter active, and if not why
//   resolveGlass(vars, prefs, env)                the CSS variables to write on <html>
//
// Invariants
//   * Text stays AA: the fill opacity is never below `minAlpha()`, whatever the Transparency slider says. The check uses
//     white, black and the accent as backdrops, after the always-present scrim (the theme's app color drawn over the
//     backdrop layer, at least 60%), so any wallpaper the user picks is bounded by that worst case.
//   * With effects off (low power, high contrast, reduced transparency, no backdrop-filter) the fill is opaque and keeps
//     the style's tint: same look, nothing to blur.
import { mix, contrast, luminance, ensureContrast } from "./themes.js";
import { seaPalette } from "./sea-glass.js";

export const SURFACE_STYLES = ["solid", "glass", "liquid", "sea"];
export const MIN_SCRIM = 0.6;

/**
 * blur px, transparency % (how see-through the fill is), saturate factor, tint (null or per mode) and tint amount %.
 * `sheen` and `grain` are look flags consumed by glass.css through the data-surface attribute.
 */
export const STYLE_DEFS = Object.freeze({
  solid: { id: "solid", name: "Solid", description: "Opaque panels. The default, fastest look.", blur: 0, transparency: 0, saturate: 1, tint: null, tintAmount: 0, backdrop: "aurora" },
  glass: { id: "glass", name: "Glass", description: "Frosted glass: blurred, translucent panels with a thin light edge.", blur: 18, transparency: 30, saturate: 1.5, tint: null, tintAmount: 0, backdrop: "aurora" },
  liquid: { id: "liquid", name: "Liquid glass", description: "Thick, refractive glass with bevelled edges and a soft specular sheen.", blur: 26, transparency: 40, saturate: 1.8, tint: null, tintAmount: 0, backdrop: "ocean" },
  sea: { id: "sea", name: "Sea glass", description: "Matte, softly grained glass tinted by your accent color (or any hue), like weathered sea glass.", blur: 14, transparency: 22, saturate: 1.05, tint: { dark: "#1b5a54", light: "#86cfbd" }, tintAmount: 26, backdrop: "seaglass" },
});

/** Background layers. "auto" picks the style's own; "image" is the user's picture (ignored when none is stored). */
export const BACKDROPS = Object.freeze([
  { id: "auto", name: "Automatic" },
  { id: "aurora", name: "Aurora" },
  { id: "ocean", name: "Ocean" },
  { id: "dusk", name: "Dusk" },
  { id: "seaglass", name: "Sea glass" },
  { id: "mono", name: "Mono" },
  { id: "accent", name: "Accent" },
  { id: "image", name: "My image" },
]);

export const isStyle = (s) => SURFACE_STYLES.includes(s);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

// ------------------------------------------------------------------ color math

/** The opaque color of `top` drawn at `alpha` (0..1) over the opaque `bottom`. */
export const blend = (top, bottom, alpha) => mix(bottom, top, clamp(alpha, 0, 1));

/**
 * The tint a style uses in a mode (null for none) when it does not depend on the accent. Sea glass is tinted by
 * `resolveTint` (accent-derived by default); this returns the classic teal for it.
 */
export const tintFor = (style, dark) => {
  const t = STYLE_DEFS[style]?.tint;
  return t ? (dark ? t.dark : t.light) : null;
};

export const SEA_TINTS = Object.freeze(["accent", "teal", "custom"]);

/** The tint actually used: sea glass follows the accent (default), classic teal or an own hue; other styles have none. */
export function resolveTint(style, dark, vars, s = {}) {
  if (style !== "sea") return tintFor(style, dark);
  return seaPalette(vars?.["--of-accent"] || "#0d9488", dark, { mode: s.seaTint || "accent", hue: s.seaHue }).tint;
}

/**
 * What a translucent panel really looks like: the surface (optionally tinted) at `alpha` over an opaque backdrop.
 * @param {string} surface surface color, e.g. vars["--of-bg-panel"]
 * @param {string} backdrop opaque color behind the panel
 * @param {{alpha:number, tint?:string|null, tintAmount?:number}} o tintAmount is a percentage
 */
export function glassFill(surface, backdrop, { alpha, tint = null, tintAmount = 0 }) {
  const base = tint && tintAmount > 0 ? mix(surface, tint, tintAmount / 100) : surface;
  return blend(base, backdrop, alpha);
}

/** White, black and the accent as they look through the scrim (the app color drawn over the backdrop layer). */
export function stressBackdrops(vars, scrim = MIN_SCRIM) {
  return ["#ffffff", "#000000", vars["--of-accent"]].map((c) => blend(vars["--of-bg-app"], c, scrim));
}

const TEXT_KEYS = ["--of-text", "--of-text-dim"];
const PANEL_KEYS = ["--of-bg-bar", "--of-bg-panel", "--of-bg-raised"];
const SYN_KEYS = ["--of-syn-keyword", "--of-syn-string", "--of-syn-number", "--of-syn-function", "--of-syn-tag", "--of-syn-attr", "--of-syn-prop", "--of-syn-type", "--of-syn-op", "--of-syn-heading", "--of-syn-link"];

/** Every opaque color a translucent surface can show: each surface over each stress backdrop. */
function worstFills(vars, style, dark, alpha, scrim, surfaces, tinted, tintColor) {
  const tint = tinted ? (tintColor === undefined ? tintFor(style, dark) : tintColor) : null;
  const amount = STYLE_DEFS[style]?.tintAmount || 0;
  const out = [];
  for (const bd of stressBackdrops(vars, scrim)) for (const s of surfaces) out.push(glassFill(vars[s], bd, { alpha, tint, tintAmount: amount }));
  return out;
}

/**
 * Text and dim text moved just far enough (towards white in dark mode, black in light mode) to be 4.5:1 on the worst
 * fills at `alpha`. Returns the overrides for --of-text, --of-text-dim and --of-text-faint (unchanged when they pass).
 */
export function liftedText(vars, style, alpha, scrim = MIN_SCRIM, tint) {
  const dark = luminance(vars["--of-bg-app"]) < 0.4;
  const fills = worstFills(vars, style, dark, alpha, scrim, PANEL_KEYS, true, tint);
  const out = {};
  for (const k of TEXT_KEYS) out[k] = ensureContrast(vars[k], fills, 4.5, dark ? 1 : -1);
  out["--of-text-faint"] = ensureContrast(vars["--of-text-faint"], fills, 3, dark ? 1 : -1);
  return out;
}

function passes(vars, style, dark, alpha, scrim, kind, tint) {
  if (kind === "editor") {
    const fills = worstFills(vars, style, dark, alpha, scrim, ["--of-editor-bg"], false);
    const texts = [["--of-text", 4.5], ...SYN_KEYS.map((k) => [k, 4.5]), ["--of-syn-comment", 3], ["--of-syn-punct", 3]];
    return fills.every((f) => texts.every(([k, need]) => contrast(vars[k], f) >= need));
  }
  const fills = worstFills(vars, style, dark, alpha, scrim, PANEL_KEYS, true, tint);
  const lifted = liftedText(vars, style, alpha, scrim, tint);
  return fills.every((f) => TEXT_KEYS.every((k) => contrast(lifted[k], f) >= 4.5));
}

const cache = new Map();

/**
 * Lowest fill opacity (0.5..1, step 0.02) at which text and dim text (after `liftedText`) stay 4.5:1 on every panel surface over the worst
 * backdrops, for `kind` "panel" (bars, docks, menus, dialogs) or "editor" (code editor: text 4.5, syntax colors too).
 */
export function minAlpha(vars, style, kind = "panel", scrim = MIN_SCRIM, tint) {
  const dark = luminance(vars["--of-bg-app"]) < 0.4;
  const key = [tint === undefined ? "" : tint, style, kind, scrim, vars["--of-bg-app"], vars["--of-accent"], ...TEXT_KEYS.map((k) => vars[k]), ...PANEL_KEYS.map((k) => vars[k]), kind === "editor" ? vars["--of-editor-bg"] : ""].join("|");
  if (cache.has(key)) return cache.get(key);
  let found = 1;
  for (let a = kind === "editor" ? 0.8 : 0.5; a <= 1.0001; a += 0.02) {
    if (passes(vars, style, dark, a, scrim, kind, tint)) {
      found = Math.min(1, Math.round(a * 100) / 100);
      break;
    }
  }
  if (cache.size > 400) cache.clear();
  cache.set(key, found);
  return found;
}

// ------------------------------------------------------------------ environment

/**
 * Is the blur effect active? `env` = { lowPower, highContrast, reducedTransparency, contrastMore, supported }.
 * @returns {{on:boolean, reason:string|null}} reason is one of solid, low-power, high-contrast, reduced-transparency, unsupported
 */
export function fxState(style, env = {}) {
  if (!isStyle(style) || style === "solid") return { on: false, reason: "solid" };
  if (env.lowPower) return { on: false, reason: "low-power" };
  if (env.highContrast || env.contrastMore) return { on: false, reason: "high-contrast" };
  if (env.reducedTransparency) return { on: false, reason: "reduced-transparency" };
  if (env.supported === false) return { on: false, reason: "unsupported" };
  return { on: true, reason: null };
}

/** The effective settings for the preferences: slider values or the style defaults, clamped. */
export function glassSettings(prefs) {
  const style = isStyle(prefs.surfaceStyle) ? prefs.surfaceStyle : "solid";
  const def = STYLE_DEFS[style];
  return {
    style,
    blur: clamp(Math.round(num(prefs.glassBlur, def.blur)), 0, 40),
    transparency: clamp(Math.round(num(prefs.glassTransparency, def.transparency)), 0, 50),
    dim: clamp(Math.round(num(prefs.glassDim, 0)), 0, 80),
    backdrop: BACKDROPS.some((b) => b.id === prefs.glassBackdrop) ? prefs.glassBackdrop : "auto",
    animate: prefs.glassAnimate === true,
    seaTint: SEA_TINTS.includes(prefs.seaTint) ? prefs.seaTint : "accent",
    seaHue: clamp(Math.round(num(prefs.seaHue, 174)), 0, 359),
    refraction: clamp(Math.round(num(prefs.glassRefraction, 60)), 0, 100),
    bevel: clamp(Math.round(num(prefs.glassBevel, 16)), 4, 40),
    specular: clamp(Math.round(num(prefs.glassSpecular, 60)), 0, 100),
    dispersion: clamp(Math.round(num(prefs.glassDispersion, 20)), 0, 100),
  };
}

/** The backdrop id actually shown ("auto" → the style's own, "image" without a stored image → the style's own). */
export const effectiveBackdrop = (s, hasImage) => (s.backdrop === "auto" || (s.backdrop === "image" && !hasImage) ? STYLE_DEFS[s.style].backdrop : s.backdrop);

/**
 * Everything glass.css needs. `vars` are the resolved theme variables (themes.js `resolveVars`).
 * @returns {{style:string, on:boolean, reason:string|null, alpha:number, alphaEditor:number, requested:number, vars:Record<string,string>}}
 *   `vars` is empty for the solid style.
 */
export function resolveGlass(vars, prefs, env = {}) {
  const s = glassSettings(prefs);
  if (s.style === "solid") return { style: "solid", on: false, reason: "solid", alpha: 1, alphaEditor: 1, requested: 1, vars: {} };
  const fx = fxState(s.style, env);
  const dark = luminance(vars["--of-bg-app"]) < 0.4;
  const scrim = clamp(MIN_SCRIM + (s.dim / 100) * 0.25, MIN_SCRIM, 0.95);
  const requested = 1 - s.transparency / 100;
  const tint = resolveTint(s.style, dark, vars, s);
  const alpha = fx.on ? Math.max(requested, minAlpha(vars, s.style, "panel", MIN_SCRIM, tint)) : 1;
  const alphaEditor = fx.on ? Math.min(1, Math.max(requested + 0.3, minAlpha(vars, s.style, "editor"), 0.9, alpha)) : 1;
  const out = {
    "--of-glass-blur": fx.on ? `${s.blur}px` : "0px",
    "--of-glass-sat": String(fx.on ? STYLE_DEFS[s.style].saturate : 1),
    "--of-glass-alpha": String(round(alpha)),
    // menus and dialogs: more opaque than bars. With Liquid refraction they stay a bit more see-through so the bent backdrop
    // shows; never below `alpha`, which already carries the AA guarantee for every panel surface
    "--of-glass-alpha-strong": String(round(fx.on ? Math.min(1, s.style === "liquid" && s.refraction > 0 ? Math.max(alpha + 0.04, 0.72) : Math.max(alpha + 0.16, 0.86)) : 1)),
    "--of-glass-alpha-editor": String(round(alphaEditor)),
    "--of-glass-tint": tint || "transparent",
    "--of-glass-tint-amt": `${STYLE_DEFS[s.style].tint ? STYLE_DEFS[s.style].tintAmount : 0}%`,
    "--of-glass-scrim": String(round(scrim)),
  };
  if (fx.on) Object.assign(out, liftedText(vars, s.style, alpha, MIN_SCRIM, tint)); // AA text over the worst backdrops
  const pal = seaPalette(vars["--of-accent"] || "#0d9488", dark, { mode: s.seaTint, hue: s.seaHue });
  Object.assign(out, pal.vars); // --of-sea-*: also used by the sea previews and the sea background layer
  if (s.style === "liquid") Object.assign(out, specularVars(s.specular, s.bevel, dark));
  return { style: s.style, on: fx.on, reason: fx.reason, alpha, alphaEditor, requested, vars: out };
}

/** Liquid glass: highlight strength and bevel thickness (defaults 60 and 16 reproduce the stylesheet values). */
export function specularVars(specular, bevel, dark) {
  const m = specular / 60;
  const a = (base) => round(clamp(base * m, 0, 1));
  return {
    "--of-glass-hi": dark ? `rgba(255, 255, 255, ${a(0.22)})` : `rgba(255, 255, 255, ${a(0.85)})`,
    "--of-glass-lo": dark ? `rgba(0, 0, 0, ${a(0.22)})` : `rgba(0, 0, 0, ${a(0.1)})`,
    "--of-glass-bevel": `${round(clamp((bevel / 16) * 1.5, 0.5, 4))}px`,
  };
}

const round = (n) => Math.round(n * 100) / 100;
