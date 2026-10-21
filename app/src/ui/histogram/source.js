// Pixel sources for histograms: composite, active layer, selection and "up to this layer", rendered to a bounded
// proxy for live updates and, for large pages, analyzed exactly in row strips that yield to the UI between strips.
import { buildPageDL, nodeItems } from "../../engine/dl.js";
import { renderToCanvas, CanvasPool } from "../../engine/backends/canvas.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { worldMatrix } from "../../core/nodes.js";
import { ident } from "../../core/math.js";
import { pageItems } from "../../core/raster.js";
import { createAnalysis, accumulate, analyzeImage } from "../../engine/pixel/histogram-analysis.js";

export const SOURCES = [
  { value: "composite", label: "Composite (all layers)" },
  { value: "layer", label: "Active layer" },
  { value: "selection", label: "Selection" },
  { value: "upto", label: "With adjustments up to this layer" },
];

/** Pixels rendered for live updates; larger pages are sampled until an exact pass has finished. */
export const LIVE_PIXELS = 1_500_000;
const STRIP_PIXELS = 1_000_000;
const pool = new CanvasPool({ cpu: true });
const tick = () => new Promise((r) => setTimeout(r, 0));

const group = (items, m) => ({ t: "group", items, m, opacity: 1, blend: "normal", clip: null, isolate: false, fx: null, mask: null, b: null });

/** Display-list items of everything painted before (or up to and including) `node`, in page space, plus identity parts for caching. */
export function itemsUpTo(app, node, includeSelf) {
  const doc = app.doc;
  const page = node._page || app.page;
  const ctx = { doc, page, requestAsset: doc.requestAsset };
  const chain = [];
  for (let n = node; n && n._parent; n = n._parent) chain.unshift(n);
  const items = [];
  const parts = [];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i];
    const parent = n._parent;
    const pw = parent === page.root || !parent._parent ? ident() : worldMatrix(parent);
    const idx = parent.children.indexOf(n);
    const last = i === chain.length - 1;
    const next = chain[i + 1];
    if (!last && n.type !== "group" && next) {
      // a layer with nested adjustments: the layer plus the adjustments that come before `node`
      const upto = n.children.indexOf(next) + (i + 1 === chain.length - 1 && includeSelf ? 1 : 0);
      const clone = Object.create(n, { children: { value: n.children.slice(0, upto) }, _dl: { value: null, writable: true } });
      const own = nodeItems(clone, ctx);
      if (own.length) items.push(group(own, pw));
      parts.push(own);
      break;
    }
    const end = last ? (includeSelf ? idx + 1 : idx) : idx;
    for (const s of parent.children.slice(0, end)) {
      const own = nodeItems(s, ctx);
      parts.push(own);
      if (own.length) items.push(group(own, pw));
    }
  }
  return { items, parts, page };
}

/** True when two part lists describe the same pixels (nodes unchanged since the last render). */
export const samePartsList = (a, b) => !!a && !!b && a.length === b.length && a.every((p, i) => p === b[i] || (p.length === 0 && b[i].length === 0));

/** Resolves a source spec to display-list items. */
export function resolveSource(app, source, nodeOverride = null) {
  const doc = app.doc;
  const page = nodeOverride?._page || app.page;
  const node = nodeOverride || app.activeNode;
  const note = [];
  let kind = source;
  if (kind === "selection" && !app.state?.pixelMask) {
    note.push("No selection: showing the composite.");
    kind = "composite";
  }
  if (kind === "layer" && !node) {
    note.push("No layer selected: showing the composite.");
    kind = "composite";
  }
  if (kind === "upto" && !node) kind = "composite";
  if (kind === "layer" && node.type === "adjust") {
    note.push("Adjustment layers have no pixels: showing the result up to this layer.");
    kind = "upto";
  }
  const base = { page, bg: page.bg, mask: null, label: "composite", note, kind };
  if (kind === "layer") {
    if (!nodeOverride && app.state?.maskTarget && node.mask) return { ...base, bg: null, label: "layer mask", maskCanvas: doc.getPixels(node.mask), items: [] };
    return { ...base, bg: null, label: `layer “${node.name}”`, items: pageItems(doc, page, [node]), parts: [nodeItems(node, { doc, page, requestAsset: doc.requestAsset })] };
  }
  if (kind === "upto") {
    const u = itemsUpTo(app, node, true);
    return { ...base, label: `result up to “${node.name}”`, items: u.items, parts: u.parts };
  }
  const dl = buildPageDL(doc, page);
  const res = { ...base, items: dl.items, parts: [dl.items] };
  if (kind === "selection") {
    res.mask = app.state.pixelMask;
    res.label = "selection";
  }
  return res;
}

const pageDims = (page) => [Math.max(1, Math.round(page.w)), Math.max(1, Math.round(page.h))];

/** Nearest-neighbor copy of a page selection at proxy resolution. */
function scaledMask(m, w, h) {
  if (m.width === w && m.height === h) return { width: w, height: h, data: m.data };
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.height - 1, Math.floor((y * m.height) / h));
    for (let x = 0; x < w; x++) out[y * w + x] = m.data[sy * m.width + Math.min(m.width - 1, Math.floor((x * m.width) / w))];
  }
  return { width: w, height: h, data: out };
}

/** Renders display-list items of a page into ImageData at `scale` (1 = page pixels). */
export function renderItems(page, items, { scale = 1, bg = null, crop = null, width, height } = {}) {
  const [W, H] = pageDims(page);
  const w = Math.max(1, Math.round(width ?? (crop ? crop.w : W) * scale));
  const h = Math.max(1, Math.round(height ?? (crop ? crop.h : H) * scale));
  const c = renderToCanvas({ width: page.w, height: page.h, items }, { scale, width: w, height: h, bg, crop, pool });
  return ctx2d(c).getImageData(0, 0, w, h);
}

/** Proxy image of a resolved source (at most `maxPixels`). */
export function renderProxy(src, maxPixels = LIVE_PIXELS) {
  const [W, H] = pageDims(src.page);
  if (src.maskCanvas) {
    const mc = src.maskCanvas;
    const s = Math.min(1, Math.sqrt(maxPixels / (mc.width * mc.height)));
    const w = Math.max(1, Math.round(mc.width * s)), h = Math.max(1, Math.round(mc.height * s));
    const c = createCanvas(w, h);
    const g = ctx2d(c);
    g.drawImage(mc, 0, 0, w, h);
    return { img: g.getImageData(0, 0, w, h), scale: s, full: s === 1 };
  }
  const s = Math.min(1, Math.sqrt(maxPixels / (W * H)));
  const img = renderItems(src.page, src.items, { scale: s, bg: src.bg });
  return { img, scale: s, full: s === 1 };
}

/** Live analysis from a bounded proxy. */
export function analyzeSource(src, maxPixels = LIVE_PIXELS) {
  const { img, scale, full } = renderProxy(src, maxPixels);
  const mask = src.mask ? scaledMask(src.mask, img.width, img.height) : null;
  const a = analyzeImage(img, { mask });
  if (!full) {
    a.sampled = true;
    a.total = Math.round(a.count / (scale * scale));
  }
  return { a, approx: !full, w: img.width, h: img.height };
}

/** Exact analysis in row strips; `isCurrent()` aborts it. Resolves to null when cancelled. */
export async function analyzeExact(src, isCurrent) {
  if (src.maskCanvas) return null;
  const [W, H] = pageDims(src.page);
  const rows = Math.max(1, Math.floor(STRIP_PIXELS / W));
  const acc = createAnalysis();
  for (let y = 0; y < H; y += rows) {
    if (!isCurrent()) return null;
    const hs = Math.min(rows, H - y);
    const img = renderItems(src.page, src.items, { scale: 1, bg: src.bg, crop: { x: 0, y, w: W, h: hs }, width: W, height: hs });
    accumulate(acc, img, { mask: src.mask && src.mask.width === W ? src.mask : null, rowOffset: y, maskStride: W });
    await tick();
  }
  return acc;
}

/** Pixel size of the page used for proxy decisions. */
export const pageArea = (page) => pageDims(page)[0] * pageDims(page)[1];
