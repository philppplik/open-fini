// Viewport and split-layout logic of the Code studio, as pure functions (no DOM): device presets, size parsing and
// clamping, breakpoint markers parsed from the project's CSS, snapping, ruler ticks, and the arithmetic of the
// code/preview split (layout resolution, ratios, splitter keyboard steps).
//
// Public API
//   VIEWPORT_LIMITS, DEVICE_PRESETS, LAYOUTS
//   clampSize(n, axis) · parseSizeInput(text) · nudgeSize(value, dir, shift) · matchPreset(w, h)
//   breakpointMarkers(cssTexts[, configBreakpoints]) -> [{ px, kind, source, label }]
//   snapWidth(w, markers, tolerance) -> { width, marker }
//   rulerTicks(from, to, scale) -> { minor, major, ticks: [{ v, major, label }] }
//   resolveLayout(choice, containerWidth) · isStacked(layout) · codeFirst(layout)
//   clampRatio(r, total, minPx) · ratioFromPointer(layout, pos, total) · stepRatio(r, key, layout, shift)
// Invariants: sizes are integer CSS px; a split ratio is the share of the CODE pane (0..1), whatever the arrangement.
import { BREAKPOINTS } from "./css-props.js";

export const VIEWPORT_LIMITS = { min: 100, max: 4000, sliderMin: 280, sliderMax: 2560 };

/** Device presets: generic names only (no product names). `h` is the typical visible height. */
export const DEVICE_PRESETS = [
  { id: "desktop-1440", label: "Desktop 1440", w: 1440, h: 900, group: "Desktop" },
  { id: "desktop-1280", label: "Desktop 1280", w: 1280, h: 800, group: "Desktop" },
  { id: "desktop-1024", label: "Desktop 1024", w: 1024, h: 768, group: "Desktop" },
  { id: "tablet-820", label: "Tablet 820", w: 820, h: 1180, group: "Tablet" },
  { id: "tablet-768", label: "Tablet 768", w: 768, h: 1024, group: "Tablet" },
  { id: "phone-390", label: "Phone 390", w: 390, h: 844, group: "Phone" },
  { id: "phone-375", label: "Phone 375", w: 375, h: 667, group: "Phone" },
  { id: "phone-360", label: "Phone 360", w: 360, h: 800, group: "Phone" },
  { id: "phone-320", label: "Phone 320", w: 320, h: 568, group: "Phone" },
];

export const LAYOUTS = ["codeLeft", "codeRight", "codeTop", "codeBottom"];

/** Rounds and clamps a size. `axis` is "w" or "h"; heights may go as low as the minimum. */
export function clampSize(n, axis = "w") {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return axis === "w" ? 1280 : 800;
  return Math.max(VIEWPORT_LIMITS.min, Math.min(VIEWPORT_LIMITS.max, v));
}

/** "834", "834px", " 834 px " -> 834 (clamped); anything else -> null. */
export function parseSizeInput(text) {
  const m = /^\s*(\d{1,5}(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(String(text ?? ""));
  return m ? clampSize(Number(m[1])) : null;
}

/** Arrow-key step: 1 px, 10 px with Shift. `dir` is +1 or -1. */
export function nudgeSize(value, dir, shift = false) {
  return clampSize(Number(value) + (dir < 0 ? -1 : 1) * (shift ? 10 : 1));
}

/** The preset with exactly this size (height optional), or null. */
export function matchPreset(w, h = null) {
  return DEVICE_PRESETS.find((p) => p.w === w && (h == null || p.h === h)) || null;
}

/**
 * Widths where the page's layout changes: the editor's breakpoint config plus every `min-width` / `max-width`
 * condition of an `@media` rule found in the given CSS sources (px, em and rem; `width <= 600px` range syntax too).
 * Sorted ascending, one marker per width (a CSS-derived marker that equals a config breakpoint keeps the config label).
 * @param {string[]} cssTexts
 * @param {Array<{id: string, label: string, width: number, media: string|null}>} [config]
 * @returns {Array<{px: number, kind: "max"|"min"|"config", source: "config"|"css", label: string}>}
 */
export function breakpointMarkers(cssTexts, config = BREAKPOINTS) {
  const by = new Map();
  for (const b of config) {
    if (b.media === null && b.id === "desktop") continue; // the base desktop width is not a boundary
    by.set(b.width, { px: b.width, kind: b.media && /min-width/.test(b.media) ? "min" : "max", source: "config", label: `${b.label} ${b.width}` });
  }
  const toPx = (n, unit) => Math.round(unit === "px" ? n : n * 16);
  for (const css of cssTexts || []) {
    const text = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /@media([^{]*)\{/gi;
    let m;
    while ((m = re.exec(text))) {
      const cond = m[1];
      const found = [];
      for (const c of cond.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)\s*(px|em|rem)\s*\)/gi)) found.push([c[1].toLowerCase(), toPx(Number(c[2]), c[3].toLowerCase())]);
      for (const c of cond.matchAll(/\(\s*width\s*(<=|>=|<|>)\s*([\d.]+)\s*(px|em|rem)\s*\)/gi)) {
        const px = toPx(Number(c[2]), c[3].toLowerCase());
        found.push(c[1] === "<=" ? ["max", px] : c[1] === "<" ? ["max", px - 1] : c[1] === ">=" ? ["min", px] : ["min", px + 1]);
      }
      for (const [kind, px] of found) {
        if (!(px >= 100 && px <= 4000) || by.has(px)) continue;
        by.set(px, { px, kind, source: "css", label: `${kind}-width ${px}` });
      }
    }
  }
  return [...by.values()].sort((a, b) => a.px - b.px);
}

/** Snaps `w` to a marker within `tolerance` px. Returns the (possibly unchanged) width and the marker it snapped to. */
export function snapWidth(w, markers, tolerance = 6) {
  let best = null;
  for (const m of markers || []) {
    const d = Math.abs(m.px - w);
    if (d <= tolerance && (!best || d < Math.abs(best.px - w))) best = m;
  }
  return best ? { width: best.px, marker: best } : { width: w, marker: null };
}

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/**
 * Tick positions for a ruler showing CSS px `from..to` at `scale` screen px per CSS px.
 * Minor ticks are at least ~8 screen px apart; major ticks (labeled) at least ~48 screen px apart.
 */
export function rulerTicks(from, to, scale) {
  const s = scale > 0 ? scale : 1;
  const minor = STEPS.find((st) => st * s >= 8) || STEPS[STEPS.length - 1];
  const major = STEPS.find((st) => st >= minor && st * s >= 48 && st % minor === 0) || STEPS[STEPS.length - 1];
  const ticks = [];
  const start = Math.floor(from / minor) * minor;
  for (let v = start; v <= to && ticks.length < 4000; v += minor) {
    if (v < from) continue;
    const isMajor = v % major === 0;
    ticks.push({ v, major: isMajor, label: isMajor ? String(v) : "" });
  }
  return { minor, major, ticks };
}

// ------------------------------------------------------------------------------------------------ split layout

export const isStacked = (layout) => layout === "codeTop" || layout === "codeBottom";
/** True when the code pane comes first in reading order (left or top). */
export const codeFirst = (layout) => layout === "codeLeft" || layout === "codeTop";

/**
 * The arrangement to show: an explicit choice wins; "auto" (or nothing chosen) puts code left, and stacks it on top
 * when the workbench is narrower than 900 px.
 */
export function resolveLayout(choice, containerWidth) {
  if (LAYOUTS.includes(choice)) return choice;
  return containerWidth > 0 && containerWidth < 900 ? "codeTop" : "codeLeft";
}

/** Clamps a code-pane ratio so that both panes keep at least `minPx` of `total`, and never leave 10..90 %. */
export function clampRatio(r, total, minPx = 240) {
  let lo = 0.1;
  let hi = 0.9;
  if (total > 0 && minPx > 0 && total >= minPx * 2) {
    lo = Math.max(lo, minPx / total);
    hi = Math.min(hi, 1 - minPx / total);
  }
  const v = Number.isFinite(r) ? r : 0.5;
  return Math.max(lo, Math.min(hi, v));
}

/** Ratio of the code pane for a pointer at `pos` px from the start of the (left/top edge of the) container. */
export function ratioFromPointer(layout, pos, total) {
  if (!(total > 0)) return 0.5;
  const f = pos / total;
  return codeFirst(layout) ? f : 1 - f;
}

/** New ratio after an arrow/Home/End key on the splitter. Returns null for keys that do nothing. */
export function stepRatio(r, key, layout, shift = false) {
  const step = shift ? 0.1 : 0.02;
  const stacked = isStacked(layout);
  const grow = stacked ? "ArrowDown" : "ArrowRight"; // moves the bar toward the end
  const shrink = stacked ? "ArrowUp" : "ArrowLeft";
  if (key === "Home") return 0.1;
  if (key === "End") return 0.9;
  if (key !== grow && key !== shrink) return null;
  const toEnd = key === grow ? 1 : -1;
  // the bar moves toward the end: the code pane grows when it comes first, shrinks otherwise
  return r + toEnd * (codeFirst(layout) ? 1 : -1) * step;
}
