// Vibe "Image editing" tools: native photo edits without image generation. The work (one history step, worker pool)
// is in studios/tools/native-edit-ops.js, loaded on first call; edit names and defaults: engine/pixel/native-edit-list.js.
import { tool, S, requireDoc } from "./helpers.js";

const EDITS = ["remove_background", "auto_white_balance", "auto_levels", "auto_contrast", "color_replace", "sharpen", "denoise", "vignette", "tilt_shift", "upscale"];
const run = async (app, fn, ...args) => {
  requireDoc(app);
  const r = await (await import("../../studios/tools/native-edit-ops.js"))[fn](app, ...args);
  if (r !== true) throw new Error(r);
  return { ok: true };
};

export function pixelEditTools(app) {
  const layer = S.str("Pixel layer id (default: active layer)");
  const tol = S.num("Color tolerance 1-150 (default 40)");
  return [
    tool("edit_pixels", "Native (non-generative) photo edit of a pixel layer, one undo step, limited to the pixel selection. params: remove_background {tolerance, feather, edges}; color_replace {from, to, tolerance} (keeps shading); sharpen {amount, radius, threshold}; denoise {strength, color, radius, detail}; vignette {amount -1..1, midpoint, feather, roundness}; tilt_shift {band, transition, blur, angle, y 0..1}; upscale {factor 1-4, detail}; auto_* {clip}.", {
      edit: S.str("Edit", { enum: EDITS }), params: { type: "object", description: "Edit parameters" }, layer,
    }, ["edit"], (a) => run(app, "editLayer", a.edit, a.params || {}, { nodeId: a.layer })),
    tool("remove_background", "Removes the background of a pixel layer without image generation (border colors grown inward, stopped at edges, feathered). Best on plain backgrounds; check with screenshot.", {
      layer, tolerance: tol, feather: S.num("Edge feather px 0-10 (default 1.5)"),
    }, [], (a) => run(app, "editLayer", "remove_background", { ...(a.tolerance != null && { tolerance: a.tolerance }), ...(a.feather != null && { feather: a.feather }) }, { nodeId: a.layer })),
    tool("select_subject", "Selects the main subject of the visible page (edge-aware region growing from the border, no AI model).", { tolerance: tol }, [], (a) => run(app, "selectSubject", a.tolerance != null ? { tolerance: a.tolerance } : {})),
  ];
}
