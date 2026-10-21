// Applies the appearance and accessibility preferences to the document: theme, accent color, density,
// interface scale, reduced motion, high contrast, focus rings and tooltips. Called on start-up and on every change.

import { applyTheme, onThemesChanged } from "./themes.js";
import { applyCustomization } from "../customize/apply.js";

export const ACCENTS = [
  { id: "violet", label: "Theme default", color: null }, // each theme brings its own accent
  { id: "blue", label: "Blue", color: "#3b82f6" },
  { id: "teal", label: "Teal", color: "#0d9488" },
  { id: "green", label: "Green", color: "#16a34a" },
  { id: "orange", label: "Orange", color: "#ea580c" },
  { id: "pink", label: "Pink", color: "#db2777" },
  { id: "red", label: "Red", color: "#dc2626" },
  { id: "indigo", label: "Indigo", color: "#4f46e5" },
  { id: "sky", label: "Sky", color: "#0ea5e9" },
  { id: "cyan", label: "Cyan", color: "#06b6d4" },
  { id: "emerald", label: "Emerald", color: "#059669" },
  { id: "lime", label: "Lime", color: "#65a30d" },
  { id: "amber", label: "Amber", color: "#d97706" },
  { id: "rose", label: "Rose", color: "#e11d48" },
  { id: "fuchsia", label: "Fuchsia", color: "#c026d3" },
  { id: "purple", label: "Purple", color: "#9333ea" },
  { id: "brown", label: "Brown", color: "#92400e" },
  { id: "slate", label: "Slate", color: "#64748b" },
  { id: "graphite", label: "Graphite", color: "#3f3f46" },
];

const DENSITY = {
  compact: { "--of-bar-h": "34px", "--of-tabs-h": "28px", "--of-context-h": "38px", "--of-status-h": "24px" },
  default: {},
  spacious: { "--of-bar-h": "42px", "--of-tabs-h": "36px", "--of-context-h": "46px", "--of-status-h": "28px" },
};

let registrySync = false;

/** The accent the user picked as an override, or null to use the theme's own accent. */
export function accentOverride(p) {
  const accent = ACCENTS.find((a) => a.id === p.accent) || ACCENTS[0];
  const custom = /^#[0-9a-f]{6}$/i.test(p.accentCustom || "") && p.accent === "custom" ? p.accentCustom : null;
  return custom || accent.color;
}

/** Whether the interface is dark right now (the `theme` preference is the mode: dark, light or auto). */
export function isDark(p) {
  return p.theme === "dark" || (p.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
}

export function applyAppearance(app) {
  const p = app.prefs;
  const root = document.documentElement;
  if (!registrySync) {
    // extensions may add or remove themes at any time: re-apply so a saved theme appears as soon as it is registered
    registrySync = true;
    onThemesChanged(() => {
      applyAppearance(app);
      app.emit("themes");
      app.emit("render");
    });
  }

  // theme (surfaces, borders, selection, editor), mode and accent override
  const dark = isDark(p);
  const applied = applyTheme(p.themeId || "default", dark ? "dark" : "light", { highContrast: !!p.highContrast, accent: accentOverride(p) });
  root.classList.toggle("sl-theme-dark", dark);
  root.classList.toggle("sl-theme-light", !dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", applied.vars["--of-bg-bar"]);

  // density
  for (const vars of Object.values(DENSITY)) for (const k of Object.keys(vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(DENSITY[p.density] || {})) root.style.setProperty(k, v);

  // interface scale (CSS zoom is supported by Chromium, WebKit and current Firefox)
  const scale = Math.max(0.8, Math.min(1.6, (Number(p.uiScale) || 100) / 100));
  const host = document.getElementById("app");
  if (host) host.style.zoom = scale === 1 ? "" : String(scale);

  // accessibility
  const reduce = p.reduceMotion === "on" || (p.reduceMotion === "auto" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  root.classList.toggle("of-reduce-motion", reduce);
  root.classList.toggle("of-high-contrast", !!p.highContrast);
  root.classList.toggle("of-focus-rings", !!p.focusRings);
  root.classList.toggle("of-no-tips", p.showHints === false);
  root.classList.toggle("of-code-font", true);
  root.style.setProperty("--of-code-font-size", `${Number(p.codeFontSize) || 13}px`);
  applyCustomization(app); // fonts, radius, animation speed, canvas colors, dock (after the theme so it wins)
}
