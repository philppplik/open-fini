// Built-in workspace arrangements (docs/workspaces.md). Which panels a built-in workspace shows is decided by its
// `hidden` list in customize/toolbox-model.js (builtinWorkspaces); this file only says where the shown panels sit.
// A workspace without a preset id (Essentials and the plain ones) uses the studio's own `top` and `bottom` panels:
// one column on the right with two tab groups, exactly the dock of OpenFini 1.1.
import { fromSpec, mirror, setRegionSize } from "./model.js";

/** Arrangements per studio and preset id: regions with their tab groups (see model.js ▸ fromSpec). */
export const PRESETS = {
  vector: {
    typography: { right: [["type", "appearance"], ["layers", "history"]] },
  },
  pixel: {
    photography: { right: [["histogram", "info", "navigator"], ["adjustments", "color"], ["layers", "history"]], shares: { right: [0.3, 0.3, 0.4] } },
    painting: { left: [["brush"]], right: [["color"], ["layers", "history"]], sizes: { left: 260 } },
  },
  layout: {
    typography: { right: [["type", "styles"], ["pages", "layers"]] },
    data: { right: [["data", "color"], ["layers"]] },
    review: { right: [["comments"], ["pages", "history"]] },
  },
  code: {
    review: { right: [["comments", "style", "element"]] },
  },
};

/** The Essentials arrangement of a studio: its `top` and `bottom` panel lists as two stacked groups on the right. */
export function essentialsSpec(studio) {
  return { right: [studio?.top || [], studio?.bottom || []] };
}

/**
 * The base layout of a layout state ({ preset, side, width }): what a workspace looks like before you move anything,
 * and where a reopened panel goes back to.
 */
export function baseLayout(studioId, studio, state = {}) {
  const spec = PRESETS[studioId]?.[state.preset] || essentialsSpec(studio);
  let L = fromSpec(spec);
  if (Number.isFinite(state.width)) L = setRegionSize(L, "right", state.width);
  if (state.side === "left") L = mirror(L);
  return L;
}
