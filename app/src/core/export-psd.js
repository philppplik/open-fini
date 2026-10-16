// Exports a page as a layered Photoshop PSD: every top-level layer is rendered on its own into a PSD layer
// (groups become single merged layers); adjustment layers are applied to what is below them only in the
// flattened composite.
import { createCanvas } from "./doc.js";
import { pageBounds } from "./transform.js";
import { buildPageDL } from "../engine/dl.js";
import { renderToCanvas } from "../engine/backends/canvas.js";
import { CanvasPool } from "../engine/backends/canvas.js";

const MAX_LAYERS = 80;

function pixelsOf(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** @returns {Promise<{bytes: Uint8Array, warnings: string[]}>} */
export async function exportPsd(app, page = app.page) {
  const { writePsd } = await import("../engine/formats/index.js");
  const doc = app.doc;
  const W = Math.max(1, Math.round(page.w));
  const H = Math.max(1, Math.round(page.h));
  const warnings = [];
  const layers = [];
  const kids = page.root.children.filter((n) => n.type !== "adjust");
  if (page.root.children.some((n) => n.type === "adjust")) warnings.push("Adjustment layers are not exported as layers; they affect only the flattened preview inside the file.");
  if (kids.length > MAX_LAYERS) warnings.push(`Only the top ${MAX_LAYERS} layers were exported separately; the rest were merged into one layer.`);
  const pool = new CanvasPool({ cpu: true });
  const render = (root) => {
    const tmp = { ...page, root };
    return renderToCanvas(buildPageDL(doc, tmp), { crop: { x: 0, y: 0, w: W, h: H }, width: W, height: H, bg: null, pool });
  };
  const list = kids.length > MAX_LAYERS ? [...kids.slice(0, MAX_LAYERS - 1), { merge: kids.slice(MAX_LAYERS - 1) }] : kids;
  for (const n of list) {
    const nodes = n.merge || [n];
    const b = pageBounds(nodes[0]);
    const canvas = render({ ...page.root, children: nodes });
    const px = pixelsOf(canvas);
    // trim to the layer's pixels (keeps files small)
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    void b;
    if (maxX < 0) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) rgba.set(px.subarray(((minY + y) * W + minX) * 4, ((minY + y) * W + minX + w) * 4), y * w * 4);
    layers.push({ name: n.merge ? "Merged layers" : n.name || "Layer", x: minX, y: minY, width: w, height: h, rgba, opacity: 1, visible: n.merge ? true : n.visible !== false, blend: "normal" });
  }
  // the page opacity/blend of each layer is already baked into its pixels by the renderer
  void createCanvas;
  const bytes = writePsd({ width: W, height: H, layers });
  return { bytes, warnings };
}
