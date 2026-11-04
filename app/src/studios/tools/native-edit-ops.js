// Native photo edits on a pixel layer (no image generation): remove background, auto tone, color replace, sharpen,
// denoise, vignette, tilt-shift, upscale, and Select Subject. Shared by the Image > Edit commands
// (commands/pixel-image.js) and the Vibe "Image editing" tools (vibe/tools/pixel-edit.js). Each edit is ONE history
// step; the work runs on the worker pool. Functions return `true` or a short English reason string.
// Pure algorithms: engine/pixel/native-edit.js.
import { createCanvas, ctx2d } from "../../core/doc.js";
import { mul, scale as scaleM } from "../../core/math.js";
import { paintTarget, layerSpaceMask, setMask, Mask } from "../../core/pixel.js";
import { rasterizeNodes } from "../../core/raster.js";
import { NATIVE_EDITS } from "../../engine/pixel/native-edit-list.js";

const WORKER_EDITS = ["remove_background", "auto_white_balance", "color_replace", "upscale"]; // = native-edit.js WORKER_EDITS

export const EDIT_LABELS = {
  remove_background: "Remove Background",
  auto_white_balance: "Auto White Balance",
  auto_levels: "Auto Levels",
  auto_contrast: "Auto Contrast",
  color_replace: "Replace Color",
  sharpen: "Unsharp Mask",
  denoise: "Reduce Noise",
  vignette: "Vignette",
  tilt_shift: "Tilt-Shift Blur",
  upscale: "Upscale",
};

const run = async (name, args, transfer) => (await import("../../core/workers/index.js")).runJob(name, args, { transfer });

/**
 * Applies the native edit `name` to a pixel layer (`nodeId`, else the active one). With a pixel selection the edit is
 * limited to it (except upscale, which changes the layer's pixel size and keeps its on-page size).
 */
export async function editLayer(app, name, params = {}, { nodeId } = {}) {
  if (!NATIVE_EDITS[name]) return `Unknown edit "${name}".`;
  const doc = app.doc;
  if (!doc) return "No document is open.";
  if (nodeId) {
    const n = doc.find?.(nodeId) || null;
    if (!n || n.type !== "pixel") return "That layer is not a pixel layer.";
    app.select?.([n]);
  }
  const t = paintTarget(app, { create: false });
  if (!t || t.isMask) return "Select a pixel layer first.";
  if (t.locked) return "The layer is locked.";
  const n = t.node, src = t.canvas;
  const before = ctx2d(src).getImageData(0, 0, src.width, src.height);
  const copy = new Uint8ClampedArray(before.data);
  const img = { width: before.width, height: before.height, data: copy };
  // self-contained edits run on the worker pool; the others reuse the filters already loaded on the main thread
  const out = WORKER_EDITS.includes(name) ? await run("pixel.edit", { name, params, img }, [copy.buffer]) : (await import("../../engine/pixel/native-edit.js")).applyEdit(name, img, params, await import("../../engine/pixel/native-edit-fx.js"));
  if (app.doc !== doc || !doc.pixels.has(n.id)) return "The document changed while the edit was running.";
  const cv = createCanvas(out.width, out.height);
  ctx2d(cv).putImageData(new ImageData(new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length), out.width, out.height), 0, 0);
  if (name === "upscale") {
    const k = out.width / src.width;
    doc.replacePixels(n, cv, { w: out.width, h: out.height, m: mul(n.m, scaleM(1 / k, 1 / k)) }, EDIT_LABELS[name]);
  } else {
    const sel = layerSpaceMask(app, t);
    if (sel) {
      // keep the original outside the selection: original, then the edited pixels through the selection
      const edited = createCanvas(cv.width, cv.height);
      const g = ctx2d(edited);
      g.drawImage(sel, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.drawImage(cv, 0, 0);
      const keep = ctx2d(cv);
      keep.clearRect(0, 0, cv.width, cv.height);
      keep.putImageData(before, 0, 0);
      keep.globalCompositeOperation = "destination-out";
      keep.drawImage(sel, 0, 0);
      keep.globalCompositeOperation = "source-over";
      keep.drawImage(edited, 0, 0);
    }
    doc.replacePixels(n, cv, { w: cv.width, h: cv.height }, EDIT_LABELS[name]);
  }
  app.requestRender?.();
  return true;
}

/** Selects the main subject of the visible page content (edge-aware region growing from the border). */
export async function selectSubject(app, opts = {}) {
  const page = app.page;
  if (!page) return "No document is open.";
  const W = Math.round(page.w), H = Math.round(page.h);
  const nodes = page.root.children.filter((n) => n.visible);
  const r = nodes.length ? rasterizeNodes(app, nodes, { clip: true }) : null;
  if (!r) return "There is nothing visible to select.";
  const c = createCanvas(W, H);
  ctx2d(c).drawImage(r.canvas, r.rect.x, r.rect.y);
  const img = ctx2d(c).getImageData(0, 0, W, H);
  const data = new Uint8ClampedArray(img.data);
  const mask = await run("pixel.edit", { name: "subject_mask", img: { width: W, height: H, data }, params: opts }, [data.buffer]);
  const m = new Mask(W, H, new Uint8Array(mask.buffer, mask.byteOffset, mask.length));
  if (m.isEmpty()) return "No subject was found (the border and the content look alike).";
  setMask(app, m, "Select Subject");
  return true;
}
