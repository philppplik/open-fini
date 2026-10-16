// Applies the appearance and accessibility preferences to the document: theme, accent color, density,
// interface scale, reduced motion, high contrast, focus rings and tooltips. Called on start-up and on every change.

export const ACCENTS = [
  { id: "violet", label: "Violet", color: null }, // the built-in accent of each theme
  { id: "blue", label: "Blue", color: "#3b82f6" },
  { id: "teal", label: "Teal", color: "#0d9488" },
  { id: "green", label: "Green", color: "#16a34a" },
  { id: "orange", label: "Orange", color: "#ea580c" },
  { id: "pink", label: "Pink", color: "#db2777" },
  { id: "red", label: "Red", color: "#dc2626" },
];

const DENSITY = {
  compact: { "--of-bar-h": "34px", "--of-tabs-h": "28px", "--of-context-h": "38px", "--of-status-h": "24px" },
  default: {},
  spacious: { "--of-bar-h": "42px", "--of-tabs-h": "36px", "--of-context-h": "46px", "--of-status-h": "28px" },
};

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount * (amount < 0 ? v : 255 - v))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function applyAppearance(app) {
  const p = app.prefs;
  const root = document.documentElement;
  const dark = p.theme === "dark" || (p.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("sl-theme-dark", dark);
  root.classList.toggle("sl-theme-light", !dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1d1e22" : "#f6f6f8");

  // accent color
  const accent = ACCENTS.find((a) => a.id === p.accent) || ACCENTS[0];
  const custom = /^#[0-9a-f]{6}$/i.test(p.accentCustom || "") && p.accent === "custom" ? p.accentCustom : null;
  const color = custom || accent.color;
  for (const k of ["--of-accent", "--of-accent-strong", "--of-accent-soft"]) root.style.removeProperty(k);
  if (color) {
    root.style.setProperty("--of-accent", color);
    root.style.setProperty("--of-accent-strong", shade(color, -0.14));
    const n = parseInt(color.slice(1), 16);
    root.style.setProperty("--of-accent-soft", `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${dark ? 0.2 : 0.14})`);
  }

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
}
