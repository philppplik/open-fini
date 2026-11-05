// 3D Transform / Free Transform of a pixel layer or of the selected part of it: perspective tilt (X/Y/Z, distance),
// skew, corner pin and grid warp. ONE history step; the bicubic resampling runs on the worker pool ("pixel.warpMesh").
// Shared by the 3D Transform tool (pixel-transform3d-impl.js) and the Vibe tool transform_layer_3d.
// Pure geometry: engine/pixel/transform3d.js. Returns `true` or a short English reason string.
import { createCanvas, ctx2d } from "../../core/doc.js";
import { mul, translate } from "../../core/math.js";
import { paintTarget, layerSpaceMask } from "../../core/pixel.js";
import { projectRect, meshFromQuad } from "../../engine/pixel/transform3d.js";

/** Bounds {x, y, w, h} of the non-transparent pixels of a canvas, or null. */
function alphaBounds(cv) {
  const { data, width: W, height: H } = ctx2d(cv).getImageData(0, 0, cv.width, cv.height);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3]) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The transform source of the active pixel layer: { t, sel, rect } where rect (layer pixels) is the whole layer or
 * the bounds of the pixel selection inside it. Returns a reason string when there is nothing to transform.
 */
export function transformSource(app) {
  if (!app.doc) return "No document is open.";
  const t = paintTarget(app, { create: false });
  if (!t || t.isMask) return "Select a pixel layer first.";
  if (t.locked) return "The layer is locked.";
  const sel = layerSpaceMask(app, t);
  const rect = sel ? alphaBounds(sel) : { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height };
  if (!rect) return "The selection does not cover this layer.";
  return { t, sel, rect };
}

/** Mesh points (layer pixels) for 3D parameters applied to `rect`. */
export function meshForParams(rect, params = {}, n = 1) {
  return meshFromQuad(projectRect(rect.w, rect.h, params), n).map(([x, y]) => [x + rect.x, y + rect.y]);
}

/**
 * Applies the transform. `points` are (n+1)^2 mesh points in layer pixels (row-major); without them `params`
 * ({rotateX, rotateY, rotateZ, distance, skewX, skewY, scale}) build a corner pin. With a pixel selection only the
 * selected pixels move (the rest of the layer stays) and the selection is cleared.
 */
export async function transformLayer3d(app, { points, n = 1, params, filter = "bicubic", source } = {}) {
  const s = source || transformSource(app);
  if (typeof s === "string") return s;
  const { t, sel, rect } = s;
  const doc = app.doc, node = t.node;
  n = Math.max(1, Math.min(8, Math.round(n)));
  const pts = points || meshForParams(rect, params, n);
  if (pts.length !== (n + 1) * (n + 1) || pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return "Invalid mesh points.";
  const piece = createCanvas(rect.w, rect.h);
  const pg = ctx2d(piece);
  pg.drawImage(t.canvas, -rect.x, -rect.y);
  if (sel) {
    pg.globalCompositeOperation = "destination-in";
    pg.drawImage(sel, -rect.x, -rect.y);
  }
  const id = pg.getImageData(0, 0, rect.w, rect.h);
  const local = pts.map(([x, y]) => [x - rect.x, y - rect.y]);
  const { runJob } = await import("../../core/workers/index.js");
  let out;
  try {
    out = await runJob("pixel.warpMesh", { img: { width: id.width, height: id.height, data: id.data }, n, points: local, filter }, { transfer: [id.data.buffer] });
  } catch (e) {
    return e?.message || "The transform failed.";
  }
  if (app.doc !== doc || !doc.pixels.has(node.id)) return "The document changed while the transform was running.";
  const ox = out.x + rect.x, oy = out.y + rect.y, ow = out.img.width, oh = out.img.height;
  const ux = sel ? Math.min(0, ox) : ox, uy = sel ? Math.min(0, oy) : oy;
  const uw = (sel ? Math.max(t.canvas.width, ox + ow) : ox + ow) - ux, uh = (sel ? Math.max(t.canvas.height, oy + oh) : oy + oh) - uy;
  const cv = createCanvas(uw, uh);
  const g = ctx2d(cv);
  if (sel) {
    g.drawImage(t.canvas, -ux, -uy);
    g.globalCompositeOperation = "destination-out";
    g.drawImage(sel, -ux, -uy);
    g.globalCompositeOperation = "source-over";
  }
  const warped = createCanvas(ow, oh);
  ctx2d(warped).putImageData(new ImageData(new Uint8ClampedArray(out.img.data.buffer, out.img.data.byteOffset, out.img.data.length), ow, oh), 0, 0);
  g.drawImage(warped, ox - ux, oy - uy);
  doc.replacePixels(node, cv, { w: uw, h: uh, m: mul(node.m, translate(ux, uy)) }, "3D Transform");
  if (sel) {
    app.state.pixelMask = null;
    app.state.maskRev = (app.state.maskRev | 0) + 1;
  }
  app.requestRender?.();
  return true;
}
