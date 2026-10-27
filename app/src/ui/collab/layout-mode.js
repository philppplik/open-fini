// Responsive layout decisions of the Collaboration window (pure, no DOM; unit tested in tests/collab/layout-mode.test.js).
//
// Public API
//   MODES, BREAKPOINTS                    "narrow" (< 520 px: top tabs) | "rail" (>= 520 px: left side rail) | "wide" (>= 900 px: rail + two columns)
//   layoutMode(width) → mode
//   clampRect(rect, { vw, vh, min, max }) → rect       min/max sizes and keep inside the viewport
//   snapRect(rect, { vw, vh, threshold }) → { rect, edge }   snaps to viewport edges (edge: "left"|"right"|"top"|"bottom"|null, first hit)
//   maximizedRect({ vw, vh, margin }) → rect
//   readLayoutState(json) / defaultLayoutState() → { x?, y?, w, h, maximized, compact, dock }  validated per-profile state
// Invariants: every function returns finite numbers inside the viewport; bad stored state falls back to defaults.
export const BREAKPOINTS = { rail: 520, wide: 900 };
export const MODES = ["narrow", "rail", "wide"];
export const MIN_SIZE = { w: 300, h: 280 };
export const DOCKS = ["float", "left", "right"];

export function layoutMode(width) {
  const w = Number.isFinite(width) ? width : 0;
  return w >= BREAKPOINTS.wide ? "wide" : w >= BREAKPOINTS.rail ? "rail" : "narrow";
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function clampRect(rect, { vw, vh, min = MIN_SIZE, max = null } = {}) {
  const maxW = Math.min(max?.w ?? vw - 16, vw - 16);
  const maxH = Math.min(max?.h ?? vh - 16, vh - 16);
  const w = Math.round(clamp(rect.w, Math.min(min.w, maxW), maxW));
  const h = Math.round(clamp(rect.h, Math.min(min.h, maxH), maxH));
  const x = Math.round(clamp(rect.x, 0, vw - w));
  const y = Math.round(clamp(rect.y, 0, vh - h));
  return { x, y, w, h };
}

export function snapRect(rect, { vw, vh, threshold = 16 } = {}) {
  let { x, y } = rect;
  let edge = null;
  if (Math.abs(x) <= threshold) ((x = 0), (edge = "left"));
  else if (Math.abs(vw - (x + rect.w)) <= threshold) ((x = vw - rect.w), (edge = "right"));
  if (Math.abs(y) <= threshold) ((y = 0), (edge = edge || "top"));
  else if (Math.abs(vh - (y + rect.h)) <= threshold) ((y = vh - rect.h), (edge = edge || "bottom"));
  return { rect: { ...rect, x, y }, edge };
}

export const maximizedRect = ({ vw, vh, margin = 8 }) => ({ x: margin, y: margin, w: vw - 2 * margin, h: vh - 2 * margin });

export const defaultLayoutState = () => ({ w: 380, h: 560, maximized: false, compact: false, dock: "float" });

export function readLayoutState(json) {
  const d = defaultLayoutState();
  if (!json || typeof json !== "object") return d;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : undefined);
  const out = { ...d };
  if (n(json.x) !== undefined && n(json.y) !== undefined) ((out.x = n(json.x)), (out.y = n(json.y)));
  if (n(json.w) > 0 && n(json.h) > 0) ((out.w = n(json.w)), (out.h = n(json.h)));
  out.maximized = json.maximized === true;
  out.compact = json.compact === true;
  out.dock = DOCKS.includes(json.dock) ? json.dock : "float";
  return out;
}
