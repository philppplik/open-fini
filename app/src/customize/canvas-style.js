// Canvas look derived from preferences: transparency checkerboard, grid / guide / selection colors and pointer size.
// Pure (strings and numbers only) so it can be unit tested; ui/canvas-view.js and customize/apply.js use it.

const HEX = /^#[0-9a-f]{6}$/i;

export const CHECKERS = {
  light: ["#ffffff", "#d4d4d8"],
  dark: ["#3a3b43", "#2a2b31"],
  neutral: ["#c9c9c9", "#a8a8a8"],
};

/** The checkerboard to draw behind transparent pages, or null for a plain white page. */
export function checkerConfig(prefs) {
  const kind = prefs.checker || "light";
  if (kind === "solid") return null;
  const [a, b] = CHECKERS[kind] || CHECKERS.light;
  const size = [4, 6, 8, 12].includes(prefs.checkerSize) ? prefs.checkerSize : 6;
  return { a, b, size };
}

export function hexToRgba(hex, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

/** Colors of grid lines, guides and selection outlines (user color or the built-in default). `accent` is the theme's strong accent. */
export function overlayColors(prefs, accent = "#7a69f2") {
  const pick = (hex, alpha, dflt) => (HEX.test(hex || "") ? hexToRgba(hex, alpha) : dflt);
  return {
    gridMajor: pick(prefs.gridColor, 0.35, "rgba(120,130,255,0.35)"),
    gridMinor: pick(prefs.gridColor, 0.14, "rgba(120,130,255,0.14)"),
    guide: pick(prefs.guideColor, 0.85, "rgba(34,211,238,0.85)"),
    guidePreview: pick(prefs.guideColor, 0.95, "rgba(34,211,238,0.95)"),
    selection: HEX.test(prefs.selectionColor || "") ? prefs.selectionColor : accent,
  };
}

const CURSOR_PX = { default: 0, large: 32, xlarge: 48 };

/**
 * CSS cursor value for a tool cursor name at the chosen pointer size. Only the plain arrow and the crosshair are enlarged
 * (custom cursors of tools keep the browser's rendering); unknown names and the default size pass through.
 */
export function cursorFor(name, size) {
  const px = CURSOR_PX[size] || 0;
  if (!px || (name !== "default" && name !== "crosshair")) return name;
  const stroke = "%23000";
  const halo = "%23fff";
  let svg;
  let hot;
  if (name === "crosshair") {
    const c = px / 2;
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='0 0 ${px} ${px}'><path d='M${c} 1V${px - 1}M1 ${c}H${px - 1}' stroke='${halo}' stroke-width='4' fill='none'/><path d='M${c} 1V${px - 1}M1 ${c}H${px - 1}' stroke='${stroke}' stroke-width='1.5' fill='none'/></svg>`;
    hot = `${c} ${c}`;
  } else {
    const k = px / 24;
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='0 0 24 24'><path d='M3 2l0 17 4.5-4 3 7 3-1.3-3-6.8 6-.2z' fill='${stroke}' stroke='${halo}' stroke-width='1.6' stroke-linejoin='round' transform='scale(1)'/></svg>`;
    hot = `${Math.round(3 * k)} ${Math.round(2 * k)}`;
  }
  return `url("data:image/svg+xml;utf8,${svg.replace(/</g, "%3C").replace(/>/g, "%3E")}") ${hot}, ${name}`;
}
