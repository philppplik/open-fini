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
    review: { left: [["code-explorer", "code-git"]], right: [["comments", "style", "element"]], bottom: [["code-problems"]], sizes: { left: 300, bottom: 220 } },
    focus: { left: [["code-explorer"]], sizes: { left: 300 } },
  },
  scene: {
    motion: { left: [["scene-effects"]], right: [["scene-inspector"]], sizes: { left: 260, right: 360 } },
    audio: { left: [["scene-media"]], right: [["scene-inspector"]], sizes: { left: 232, right: 340 } },
  },
  "office:document": {
    review: { left: [["doc-outline"]], sizes: { left: 236 } },
  },
  "office:board": {
    review: { right: [["board-comments", "board-outline"]], sizes: { right: 320 } },
  },
};

/**
 * The Essentials arrangement of a studio: its `essentials` spec when it has one (Code, Scene, Office apps, Vibe), else
 * its `top` and `bottom` panel lists as two stacked groups on the right.
 */
export function essentialsSpec(studio) {
  return studio?.essentials || { right: [studio?.top || [], studio?.bottom || []] };
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
