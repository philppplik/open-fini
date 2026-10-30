// Page-level image operations of the Pixel studio: crop to selection, trim edges, reveal all, rotate (90 degrees or any
// angle), resize with resampling. Each function is ONE history step and is shared by the Image menu commands
// (commands/pixel-image.js) and the Vibe tools (vibe/tools/pixel.js). They return `true` on success or a short
// English reason string (shown as a toast / returned to the assistant) when nothing was done.
// Pure geometry is in engine/pixel/crop.js and engine/pixel/transform.js.
import { mul, translate, scale as scaleM } from "../../core/math.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { pageVisualBounds, rasterizeNodes } from "../../core/raster.js";
import { trimBounds } from "../../engine/pixel/crop.js";
import { cropPage } from "./pixel-crop-impl.js";

export const RESAMPLE_FILTERS = ["lanczos3", "bicubic", "bilinear", "nearest"];

/** Crops the page to the bounds of the active pixel selection. */
export function cropToSelection(app, opts = {}) {
  const b = app.state?.pixelMask?.bounds?.();
  if (!b || b.width < 1 || b.height < 1) return "There is no pixel selection to crop to.";
  cropPage(app, { x: b.x, y: b.y, w: b.width, h: b.height }, opts);
  return true;
}

/**
 * Removes transparent or solid-colored margins. mode: "transparent" | "topleft" | "bottomright" (color of that pixel);
 * tolerance 0-255; sides: which edges to trim.
 */
export function trimEdges(app, { mode = "transparent", tolerance = 0, sides } = {}) {
  const page = app.page;
  const W = Math.round(page.w), H = Math.round(page.h);
  const nodes = page.root.children.filter((n) => n.visible);
  const r = nodes.length ? rasterizeNodes(app, nodes, { clip: true }) : null;
  if (!r) return "There is nothing visible to trim.";
  const c = createCanvas(W, H);
  ctx2d(c).drawImage(r.canvas, r.rect.x, r.rect.y);
  const img = ctx2d(c).getImageData(0, 0, W, H);
  const b = trimBounds(img, { mode, tolerance, sides });
  if (!b) return "Nothing is left after trimming.";
  if (b.x === 0 && b.y === 0 && b.w === W && b.h === H) return "There are no edges to trim.";
  cropPage(app, b, { deletePixels: false });
  return true;
}

/** Enlarges the page so that all content, including parts outside the page, is visible again. */
export function revealAll(app) {
  const page = app.page;
  const b = pageVisualBounds(page.root.children.filter((n) => n.visible));
  if (!b) return "There is no content outside the page.";
  const x0 = Math.min(0, Math.floor(b.x)), y0 = Math.min(0, Math.floor(b.y));
  const x1 = Math.max(page.w, Math.ceil(b.x + b.w)), y1 = Math.max(page.h, Math.ceil(b.y + b.h));
  if (x0 === 0 && y0 === 0 && x1 === page.w && y1 === page.h) return "All content is already inside the page.";
  cropPage(app, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { deletePixels: false });
  return true;
}

/**
 * Rotates the whole document clockwise by `degrees` around the page center. With `expand` the page grows to hold the
 * rotated content (the corners stay transparent, or `fill`: "background"); otherwise the size is kept.
 */
export function rotateDocument(app, degrees, { expand = true } = {}) {
  const doc = app.doc, page = app.page;
  const deg = ((((degrees + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(deg) < 1e-9) return "Nothing to rotate (0 degrees).";
  const quarter = deg / 90;
  const right = Math.abs(quarter - Math.round(quarter)) < 1e-9;
  const rad = (deg * Math.PI) / 180;
  const cs = right ? [1, 0, -1, 0][(((Math.round(quarter) % 4) + 4) % 4)] : Math.cos(rad);
  const sn = right ? [0, 1, 0, -1][(((Math.round(quarter) % 4) + 4) % 4)] : Math.sin(rad);
  const nw = expand ? Math.max(1, Math.round(Math.abs(page.w * cs) + Math.abs(page.h * sn))) : page.w;
  const nh = expand ? Math.max(1, Math.round(Math.abs(page.w * sn) + Math.abs(page.h * cs))) : page.h;
  const M = [cs, sn, -sn, cs, nw / 2 - cs * (page.w / 2) + sn * (page.h / 2), nh / 2 - sn * (page.w / 2) - cs * (page.h / 2)];
  doc.tx("Rotate Document", () => {
    for (const n of page.root.children) doc.set(n, { m: mul(M, n.m) });
    doc.set(page, { w: nw, h: nh, guides: { h: [], v: [] } });
  });
  app.state.pixelMask = null;
  app.state.maskRev = (app.state.maskRev | 0) + 1;
  app.cv?.fitPage();
  return true;
}

/**
 * Resizes the document to width x height. `resample` "scale" (default) only scales the layers (vector and text stay
 * sharp); a filter name ("lanczos3", "bicubic", "bilinear", "nearest") also re-samples the bitmaps of top-level pixel
 * layers so they carry the new pixel dimensions. Sets the DPI when `dpi` is given (metadata only).
 * Async: the re-sampling (about 0.5 s per 12-megapixel layer) runs on the worker pool, all layers in parallel.
 */
export async function resizeDocument(app, width, height, { resample = "scale", dpi } = {}) {
  const doc = app.doc, p = app.page;
  const w = Math.max(1, Math.min(32000, Math.round(width))), hh = Math.max(1, Math.min(32000, Math.round(height)));
  if (!Number.isFinite(w) || !Number.isFinite(hh)) return "Invalid size.";
  const sx = w / p.w, sy = hh / p.h;
  const layers = p.root.children.map((n) => ({ n, m: mul(scaleM(sx, sy), n.m) }));
  const baked = resample === "scale" ? [] : await Promise.all(layers.filter((l) => l.n.type === "pixel").map((l) => resampleLayer(doc, l, resample)));
  if (app.doc !== doc || app.page !== p) return "The document changed while it was being resized.";
  doc.tx("Resize Document", () => {
    for (const { n, m } of layers) doc.set(n, { m });
    for (const b of baked) if (b && p.root.children.includes(b.n)) doc.replacePixels(b.n, b.cv, { w: b.cv.width, h: b.cv.height, m: b.m }, "Resample");
    doc.set(p, { w, h: hh, guides: { h: p.guides.h.map((v) => v * sy), v: p.guides.v.map((v) => v * sx) } });
    if (dpi && dpi > 0) doc.dpi = dpi;
  });
  app.state.pixelMask = null;
  app.state.maskRev = (app.state.maskRev | 0) + 1;
  app.cv?.fitPage();
  return true;
}

/**
 * Re-samples a top-level pixel layer whose new matrix `m` is a plain positive scale + translation to its on-page pixel
 * size. Resolves to { n, cv, m } (the bitmap and the translation-only matrix to apply), or null when nothing changes.
 */
async function resampleLayer(doc, { n, m }, filter) {
  const [a, b, c, d, e, f] = m;
  if (Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9 || a <= 0 || d <= 0) return null;
  const src = doc.getPixels(n);
  const tw = Math.max(1, Math.round(src.width * a)), th = Math.max(1, Math.round(src.height * d));
  if (tw === src.width && th === src.height) return null;
  const img = ctx2d(src).getImageData(0, 0, src.width, src.height);
  const { runJob } = await import("../../core/workers/index.js");
  const out = await runJob("pixel.resize", { img: { width: img.width, height: img.height, data: img.data }, width: tw, height: th, filter }, { transfer: [img.data.buffer] });
  const cv = createCanvas(tw, th);
  ctx2d(cv).putImageData(new ImageData(new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length), tw, th), 0, 0);
  return { n, cv, m: translate(e, f) };
}
