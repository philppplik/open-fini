// Healing operations of the Pixel studio on the main thread (loaded on first use): Content-Aware Fill, the Object
// Eraser and Patch tools' apply step, Straighten Horizon, and the edge-extended / content-aware corners of a rotated
// crop. Each edit is ONE history step; the pixel work runs on the worker pool (core/workers/jobs.js: pixel.inpaint,
// pixel.patch, pixel.horizon, pixel.extend). Functions return `true` (or a result object) or a short English reason.
// Pure algorithms: engine/pixel/inpaint.js (inpaintMask) and engine/pixel/heal.js. Docs: docs/studios.md ▸ Pixel.
import { createCanvas, ctx2d } from "../../core/doc.js";
import { N_ } from "../../i18n/index.js";
import { paintTarget, layerSpaceMask } from "../../core/pixel.js";
import { rasterizeNodes } from "../../core/raster.js";
import { invert } from "../../core/math.js";

const run = async (name, args, transfer) => (await import("../../core/workers/index.js")).runJob(name, args, { transfer });

/** The pixel layer to edit: `nodeId`, else the active one. Returns the paint target or a reason string. */
function target(app, nodeId) {
  const doc = app.doc;
  if (!doc) return N_("No document is open.");
  if (nodeId) {
    const n = doc.find?.(nodeId) || null;
    if (!n || n.type !== "pixel") return N_("That layer is not a pixel layer.");
    app.select?.([n]);
  }
  const t = paintTarget(app, { create: false });
  if (!t || t.isMask) return N_("Select a pixel layer first.");
  if (t.locked) return N_("The layer is locked.");
  return t;
}

/** Alpha of a layer-space canvas as a coverage plane, plus its bounding box (null when empty). */
function coverage(canvas) {
  const { width: W, height: H } = canvas;
  const a = ctx2d(canvas).getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0, y = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const v = a[i * 4 + 3];
      if (!v) continue;
      m[i] = v;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { m, W, H, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

const grow = (b, d, W, H) => {
  const x = Math.max(0, b.x - d), y = Math.max(0, b.y - d);
  return { x, y, w: Math.min(W, b.x + b.w + d) - x, h: Math.min(H, b.y + b.h + d) - y };
};
const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const cropPlane = (m, W, r) => {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(m.subarray((r.y + y) * W + r.x, (r.y + y) * W + r.x + r.w), y * r.w);
  return out;
};

/** Runs a pixel job on rect `r` of the target layer and records the result as one history step. */
async function editRegion(app, t, r, job, args, label) {
  const doc = app.doc;
  const before = t.ctx.getImageData(r.x, r.y, r.w, r.h);
  const data = new Uint8ClampedArray(before.data);
  const out = await run(job, { ...args, img: { width: r.w, height: r.h, data } }, [data.buffer, ...(args.mask ? [args.mask.buffer] : [])]);
  if (app.doc !== doc || !doc.pixels.has(t.node.id) || doc.getPixels(t.node) !== t.canvas) return N_("The document changed while the edit was running.");
  const after = new ImageData(new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length), r.w, r.h);
  t.ctx.putImageData(after, r.x, r.y);
  doc.recordPixelEdit(t.node, r.x, r.y, before, t.ctx.getImageData(r.x, r.y, r.w, r.h), label);
  doc.touch(t.node);
  app.requestRender?.();
  app.emit?.("pixels");
  return true;
}

/**
 * Content-Aware Fill: fills the selected area (or the layer-space coverage canvas `area`) of a pixel layer with
 * texture from its surroundings. `method` auto | patch | diffuse (engine/pixel/inpaint.js inpaintMask), `grow` px.
 */
export async function contentAwareFill(app, { area = null, method = "auto", grow: g = 1, nodeId, label = "Content-Aware Fill" } = {}) {
  const t = target(app, nodeId);
  if (typeof t === "string") return t;
  const c = coverage(area || layerSpaceMask(app, t) || createCanvas(1, 1));
  if (!c || c.W !== t.canvas.width || c.H !== t.canvas.height) return N_("Select the area to fill first.");
  // the source search looks about 1.5 hole sizes around the hole
  const b = c.box;
  const r = grow(b, Math.min(400, Math.max(24, Math.round(Math.max(b.w, b.h) * 1.6))), c.W, c.H);
  if (b.w * b.h >= c.W * c.H * 0.98) return N_("The area covers the whole layer: there is nothing around it to fill from.");
  return editRegion(app, t, r, "pixel.inpaint", { mask: cropPlane(c.m, c.W, r), opts: { method, grow: g } }, label);
}

/**
 * Patch: replaces the selected area with the pixels `dx, dy` page units away (mode "source", the Patch tool's default),
 * or copies the selected pixels to that place (mode "destination"). `blend` heal (match the light around) or copy.
 */
export async function patchArea(app, { dx, dy, mode = "source", blend = "heal", nodeId } = {}) {
  const t = target(app, nodeId);
  if (typeof t === "string") return t;
  const sel = layerSpaceMask(app, t);
  if (!sel) return N_("Select the area to patch first.");
  // page offset → layer offset (linear part of the page → layer matrix)
  const lx = Math.round(t.inv[0] * dx + t.inv[2] * dy), ly = Math.round(t.inv[1] * dx + t.inv[3] * dy);
  if (!lx && !ly) return N_("Drag the patch to another place first.");
  let area = sel;
  if (mode === "destination") {
    area = createCanvas(sel.width, sel.height);
    ctx2d(area).drawImage(sel, lx, ly);
  }
  const c = coverage(area);
  if (!c) return N_("The patch is outside the layer.");
  const ox = mode === "destination" ? -lx : lx, oy = mode === "destination" ? -ly : ly;
  const src = { x: c.box.x + ox, y: c.box.y + oy, w: c.box.w, h: c.box.h };
  const r = grow(union(c.box, src), 2, c.W, c.H);
  return editRegion(app, t, r, "pixel.patch", { mask: cropPlane(c.m, c.W, r), dx: ox, dy: oy, mode: blend === "copy" ? "copy" : "heal" }, "Patch");
}

/** The visible page content as one page-sized RGBA image (null when nothing is visible). */
function pageComposite(app, maxPixels = Infinity) {
  const page = app.page;
  const W = Math.max(1, Math.round(page.w)), H = Math.max(1, Math.round(page.h));
  const nodes = page.root.children.filter((n) => n.visible);
  const res = nodes.length ? rasterizeNodes(app, nodes, { clip: true }) : null;
  if (!res) return null;
  const k = Math.min(1, Math.sqrt(maxPixels / (W * H)));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.drawImage(res.canvas, res.rect.x * k, res.rect.y * k, res.rect.w * k, res.rect.h * k);
  return { img: g.getImageData(0, 0, w, h), k, W, H, canvas: c };
}

/**
 * Finds the horizon (or the strongest plumb line) of the visible page. Returns { angle, kind, line (page px),
 * strength } or a reason string. `angle` is the crop rotation that levels it (the crop tool's Straighten angle).
 */
export async function findHorizon(app) {
  if (!app.doc) return N_("No document is open.");
  const comp = pageComposite(app, 640 * 640);
  if (!comp) return N_("There is nothing visible to straighten.");
  const { img, k } = comp;
  const data = new Uint8ClampedArray(img.data);
  const r = await run("pixel.horizon", { img: { width: img.width, height: img.height, data } }, [data.buffer]);
  if (!r) return N_("No clear horizon or vertical edge was found. Straighten by hand: Crop tool ▸ Straighten, then draw along a level line.");
  const { levelAngle } = await import("../../engine/pixel/crop.js");
  const line = r.line.map(([x, y]) => [x / k, y / k]);
  return { angle: levelAngle(line[0], line[1]), kind: r.kind, line, strength: r.strength };
}

/**
 * Straighten Horizon: detects the horizon and rotates the page by it, cropped to the largest box without empty corners
 * (`corners` "fit", default) or keeping the page size with filled corners ("extend", "content", "transparent",
 * "background"). One history step. Returns the findHorizon() result or a reason.
 */
export async function straightenHorizon(app, { corners = "fit" } = {}) {
  const found = await findHorizon(app);
  if (typeof found === "string") return found;
  if (Math.abs(found.angle) < 0.05) return { ...found, applied: false };
  const p = app.page;
  const { cropPage } = await import("./pixel-crop-impl.js");
  const r = await cropPage(app, { x: 0, y: 0, w: p.w, h: p.h }, { angle: found.angle, corners });
  if (typeof r === "string") return r;
  return { ...found, applied: true };
}

/**
 * Fill layer for the empty corners of a rotated crop, made BEFORE the crop (needs the uncropped page): "extend" repeats
 * the edge pixels outward, "content" fills the corners from the image (inpainting). `M` maps old page → new page,
 * `w x h` is the new page. Returns a canvas (w x h) or a reason string.
 */
export async function cornerFill(app, M, w, h, kind) {
  const comp = pageComposite(app);
  if (!comp) return N_("There is nothing visible to fill the corners from.");
  const inv = invert(M);
  if (!inv) return N_("The crop cannot be inverted.");
  const out = createCanvas(w, h);
  const g = ctx2d(out);
  if (kind === "extend") {
    const { img } = comp;
    const data = new Uint8ClampedArray(img.data);
    const r = await run("pixel.extend", { img: { width: img.width, height: img.height, data }, inv, width: w, height: h }, [data.buffer]);
    g.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), w, h), 0, 0);
    return out;
  }
  // content-aware: the rotated page in the new frame, then inpaint everything the old page does not cover
  g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
  g.drawImage(comp.canvas, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cov = createCanvas(w, h);
  const cg = ctx2d(cov);
  cg.fillStyle = "#000";
  cg.fillRect(0, 0, w, h);
  cg.globalCompositeOperation = "destination-out";
  cg.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
  cg.fillRect(0.75, 0.75, comp.W - 1.5, comp.H - 1.5);
  const hole = cg.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < mask.length; i++) if ((mask[i] = hole[i * 4 + 3])) any = true;
  if (!any) return out;
  const img = g.getImageData(0, 0, w, h);
  const data = new Uint8ClampedArray(img.data);
  const keep = mask.slice();
  const r = await run("pixel.inpaint", { img: { width: w, height: h, data }, mask, opts: { grow: 1 } }, [data.buffer, mask.buffer]);
  // keep only the corners (with the sub-pixel overlap of the coverage edge): the layer sits under the original content
  const d = new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length);
  for (let i = 0; i < keep.length; i++) d[i * 4 + 3] = (d[i * 4 + 3] * keep[i]) / 255;
  g.putImageData(new ImageData(d, w, h), 0, 0);
  return out;
}
