// Rasterizing parts of the scene graph (merge down, rasterize, flatten) and adjustment/filter layer creation.
import { createNode, worldMatrix, visualBounds, walk } from "./nodes.js";
import { createCanvas, ctx2d } from "./doc.js";
import { nodeItems } from "../engine/dl.js";
import { renderToCanvas, CanvasPool } from "../engine/backends/canvas.js";
import { mul, ident, rectUnion, rectTransform, invert, translate } from "./math.js";
import { addNodes } from "./ops.js";
import { clone } from "./util.js";
import { getEffect } from "../engine/pixel/index.js";

/** Display-list items of `nodes` expressed in page space (ancestor transforms applied). */
export function pageItems(doc, page, nodes) {
  const ctx = { doc, page, requestAsset: doc.requestAsset };
  const items = [];
  for (const n of nodes) {
    const parentW = n._parent ? worldMatrix(n._parent) : ident();
    const own = nodeItems(n, ctx);
    if (!own.length) continue;
    items.push({ t: "group", items: own, m: parentW, opacity: 1, blend: "normal", clip: null, isolate: false, fx: null, mask: null, b: null });
  }
  return items;
}

/** Union of page-space visual bounds of the nodes. */
export function pageVisualBounds(nodes) {
  let r = null;
  for (const n of nodes) {
    const b = visualBounds(n);
    if (!b) continue;
    const pw = n._parent ? worldMatrix(n._parent) : ident();
    r = rectUnion(r, rectTransform(b, pw));
  }
  return r;
}

/**
 * Renders nodes (stacked bottom → top) into a transparent canvas.
 * `clip` limits the result to the page; returns {canvas, rect} with rect in page space (integers).
 */
export function rasterizeNodes(app, nodes, { clip = true } = {}) {
  const doc = app.doc;
  const page = app.page;
  let b = pageVisualBounds(nodes);
  if (!b) return null;
  if (clip) {
    const x0 = Math.max(0, b.x);
    const y0 = Math.max(0, b.y);
    const x1 = Math.min(page.w, b.x + b.w);
    const y1 = Math.min(page.h, b.y + b.h);
    if (x1 <= x0 || y1 <= y0) return null;
    b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const rect = { x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.x + b.w) - Math.floor(b.x), h: Math.ceil(b.y + b.h) - Math.floor(b.y) };
  const dl = { width: page.w, height: page.h, items: pageItems(doc, page, nodes) };
  const canvas = renderToCanvas(dl, { crop: rect, width: rect.w, height: rect.h, bg: null, pool: new CanvasPool({ cpu: true }) });
  return { canvas, rect };
}

/** Replaces `nodes` by a single pixel layer containing their rendered result. */
export function rasterizeToLayer(app, nodes, { name = "Rasterized", remove = true, above } = {}) {
  const res = rasterizeNodes(app, nodes);
  if (!res) {
    app.toast("There is nothing visible to rasterize.", "warning");
    return null;
  }
  const doc = app.doc;
  const layer = createNode("pixel", { name, w: res.rect.w, h: res.rect.h, m: translate(res.rect.x, res.rect.y) });
  doc.pixels.set(layer.id, res.canvas);
  const ref = above || nodes[nodes.length - 1];
  const parent = ref._parent;
  doc.tx("Rasterize", () => {
    const index = parent.children.indexOf(ref) + 1;
    doc.insert(layer, parent, index);
    if (remove) for (const n of nodes) doc.remove(n);
  });
  app.select([layer]);
  return layer;
}

/** Creates an adjustment / live-filter / develop layer above the active layer. */
export function addEffectLayer(app, group, id, { nested = false } = {}) {
  const eff = getEffect(group, id);
  if (!eff) return null;
  const ref = app.activeNode;
  const node = createNode("adjust", { name: eff.label, effect: { group, id }, params: clone(eff.defaults) });
  if (nested && ref && ref.type !== "group") {
    // nested: the effect applies to the layer only
    ref._open = true;
    addNodes(app, node, { parent: ref, label: `Add ${eff.label}` });
    return node;
  }
  const parent = ref && ref._parent ? ref._parent : app.context;
  const index = ref && ref._parent === parent ? parent.children.indexOf(ref) + 1 : parent.children.length;
  addNodes(app, node, { parent, index, label: `Add ${eff.label}` });
  return node;
}

/**
 * Bakes an adjust layer (or all adjust children) into the pixel layer below it. Returns true on success.
 */
export function mergeDown(app, node) {
  const doc = app.doc;
  const parent = node._parent;
  const idx = parent.children.indexOf(node);
  const below = parent.children[idx - 1];
  if (!below) {
    app.toast("There is no layer below to merge into.", "warning");
    return false;
  }
  const res = rasterizeNodes(app, [below, node], { clip: false });
  if (!res) return false;
  const merged = createNode("pixel", { name: below.name, w: res.rect.w, h: res.rect.h, m: translate(res.rect.x, res.rect.y), opacity: 1 });
  doc.pixels.set(merged.id, res.canvas);
  doc.tx("Merge Down", () => {
    doc.insert(merged, parent, idx + 1);
    doc.remove(node);
    doc.remove(below);
  });
  app.select([merged]);
  return true;
}

/** Flattens all visible top-level layers of the page into one pixel layer. */
export function flattenPage(app) {
  const page = app.page;
  const nodes = page.root.children.filter((n) => n.visible);
  if (nodes.length < 1) return null;
  const doc = app.doc;
  const dl = { width: page.w, height: page.h, items: pageItems(doc, page, nodes) };
  const rect = { x: 0, y: 0, w: Math.round(page.w), h: Math.round(page.h) };
  const canvas = renderToCanvas(dl, { crop: rect, width: rect.w, height: rect.h, bg: null, pool: new CanvasPool({ cpu: true }) });
  const layer = createNode("pixel", { name: "Flattened", w: rect.w, h: rect.h });
  doc.pixels.set(layer.id, canvas);
  doc.tx("Flatten", () => {
    for (const n of [...page.root.children]) doc.remove(n);
    doc.insert(layer, page.root, 0);
  });
  app.select([layer]);
  return layer;
}

export { createCanvas, ctx2d, invert, mul, walk };
