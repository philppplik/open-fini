// Vibe "Image editing" tools: native photo edits without image generation. The work (one history step, worker pool)
// is in studios/tools/native-edit-ops.js, loaded on first call; edit names and defaults: engine/pixel/native-edit-list.js.
import { tool, S, requireDoc } from "./helpers.js";
import { Mask } from "../../core/pixel.js";

const EDITS = ["remove_background", "auto_white_balance", "auto_levels", "auto_contrast", "color_replace", "sharpen", "denoise", "vignette", "tilt_shift", "upscale"];
const run = async (app, fn, ...args) => {
  requireDoc(app);
  const r = await (await import("../../studios/tools/native-edit-ops.js"))[fn](app, ...args);
  if (r !== true) throw new Error(r);
  return { ok: true };
};

/**
 * Runs `fn` with the area of a tool call as the pixel selection: the given rect/ellipse temporarily replaces the
 * selection (restored afterwards without an extra undo step), or the current selection is used.
 */
async function withArea(app, a, fn) {
  requireDoc(app);
  if (!a.shape) {
    if (!app.state?.pixelMask) throw new Error("Select an area first (select_area) or pass shape, x, y, w, h.");
    return fn();
  }
  if (![a.x, a.y, a.w, a.h].every((v) => Number.isFinite(v)) || a.w <= 0 || a.h <= 0) throw new Error("shape needs x, y, w and h.");
  const W = Math.round(app.page.w), H = Math.round(app.page.h);
  const st = app.state;
  const prev = st.pixelMask, prevRev = st.maskRev;
  st.pixelMask = a.shape === "ellipse" ? Mask.ellipse(W, H, a.x, a.y, a.w, a.h) : Mask.rect(W, H, a.x, a.y, a.w, a.h);
  st.maskRev = (st.maskRev | 0) + 1;
  try {
    return await fn();
  } finally {
    st.pixelMask = prev;
    st.maskRev = (prevRev | 0) + 2;
    app.requestOverlay?.();
  }
}

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
    tool("content_aware_fill", "Removes what is in an area of a pixel layer and fills it from the surroundings (content-aware fill / object removal, no image generation). The area is the current pixel selection, or the rect/ellipse given here in page px (the selection is left as it was). One undo step. Best for objects on texture or plain backgrounds; check with screenshot.", {
      layer, shape: S.str("Area shape when no selection should be used", { enum: ["rect", "ellipse"] }), x: S.num("Left"), y: S.num("Top"), w: S.num("Width"), h: S.num("Height"),
      method: S.str("auto (default), patch (copies texture, best quality) or diffuse (smooth, fast)", { enum: ["auto", "patch", "diffuse"] }), grow: S.num("Grow the area by px first (default 1; 3-6 hides halos around objects)"),
    }, [], (a) => withArea(app, a, () => run(app, "contentAwareFill", { method: a.method || "auto", grow: a.grow ?? 1, nodeId: a.layer }))),
    tool("patch_area", "Patch: replaces an area of a pixel layer with the texture dx/dy page px away, blended into the surrounding light (heal), or copied exactly. The area is the current pixel selection or the rect/ellipse given here. mode destination copies the area to the offset instead. One undo step; check with screenshot.", {
      layer, shape: S.str("Area shape when no selection should be used", { enum: ["rect", "ellipse"] }), x: S.num("Left"), y: S.num("Top"), w: S.num("Width"), h: S.num("Height"),
      dx: S.num("Horizontal offset of the source (source mode) or the copy (destination mode), page px"), dy: S.num("Vertical offset, page px"),
      mode: S.str("source (default) or destination", { enum: ["source", "destination"] }), blend: S.str("heal (default) or copy", { enum: ["heal", "copy"] }),
    }, ["dx", "dy"], (a) => withArea(app, a, () => run(app, "patchArea", { dx: a.dx, dy: a.dy, mode: a.mode || "source", blend: a.blend || "heal", nodeId: a.layer }))),
    tool("straighten_horizon", "Finds the horizon (or the strongest vertical edge) of the page without AI and, unless detectOnly, rotates the whole page to level it, cropped so no corner is empty (corners fit) or keeping the size with filled corners. One undo step. Returns the angle; check with screenshot.", {
      detectOnly: S.bool("Only report the angle and the line (default false)"), corners: S.str("Empty corners: fit (default, crop them away), extend (repeat the edges), content (content-aware fill), background, transparent", { enum: ["fit", "extend", "content", "background", "transparent"] }),
    }, [], async (a) => {
      requireDoc(app);
      const m = await import("../../studios/tools/heal-ops.js");
      const r = a.detectOnly ? await m.findHorizon(app) : await m.straightenHorizon(app, { corners: a.corners || "fit" });
      if (typeof r === "string") throw new Error(r);
      return { ok: true, ...r, page: { w: app.page.w, h: app.page.h } };
    }),
    tool("select_subject","Selects the main subject of the visible page (edge-aware region growing from the border, no AI model).", { tolerance: tol }, [], (a) => run(app, "selectSubject", a.tolerance != null ? { tolerance: a.tolerance } : {})),
  ];
}
