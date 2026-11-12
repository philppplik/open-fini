// Responsive layout of the Collaboration window (pure, no DOM): decided from the window's own width.
//
// Public API
//   MODES, BREAKPOINTS    "narrow" (< 520 px: top tabs) | "rail" (>= 520 px: left side rail) | "wide" (>= 900 px: rail + list column)
//   layoutMode(width) → mode
export const BREAKPOINTS = { rail: 520, wide: 900 };
export const MODES = ["narrow", "rail", "wide"];

export function layoutMode(width) {
  const w = Number.isFinite(width) ? width : 0;
  return w >= BREAKPOINTS.wide ? "wide" : w >= BREAKPOINTS.rail ? "rail" : "narrow";
}
