// Pixel-studio helpers: the page selection mask, painting targets (layers and masks) and layer creation.
import { createCanvas, ctx2d } from "./doc.js";
import { createNode, worldMatrix, localBounds } from "./nodes.js";
import { invert, mul, ident, translate } from "./math.js";
import { addNodes } from "./ops.js";
import { Mask } from "../engine/pixel/index.js";

// ------------------------------------------------------------------ selection mask (per document page)

export function getMask(app) {
  return app.state?.pixelMask || null;
}

/** Replaces the page selection mask (null clears it) as one undoable step. */
export function setMask(app, mask, label = "Selection") {
  const st = app.state;
  if (!st) return;
  const prev = st.pixelMask ? st.pixelMask.clone() : null;
  if (mask && mask.isEmpty()) mask = null;
  const next = mask ? mask.clone() : null;
  if (!prev && !next) return;
  const bytes = (prev?.data.length || 0) + (next?.data.length || 0);
  app.doc.tx(label, () =>
    app.doc._do(
      {
        redo: () => {
          st.pixelMask = next ? next.clone() : null;
          st.maskRev = (st.maskRev | 0) + 1;
          app.requestOverlay();
          app.emit("pixelmask");
        },
        undo: () => {
          st.pixelMask = prev ? prev.clone() : null;
          st.maskRev = (st.maskRev | 0) + 1;
          app.requestOverlay();
          app.emit("pixelmask");
        },
        bytes,
      },
      { label },
    ),
  );
}

/** Combines a freshly made mask with the existing selection ('replace'|'add'|'subtract'|'intersect'|'xor'). */
export function combineMask(app, fresh, op = "replace", label = "Selection") {
  const cur = getMask(app);
  if (!cur || op === "replace") return setMask(app, fresh, label);
  const next = cur.clone();
  next.combine(fresh, op);
  setMask(app, next, label);
}

export function emptyPageMask(app) {
  const p = app.page;
  return Mask.empty(Math.round(p.w), Math.round(p.h));
}

/** Modifier keys → combine op (shift = add, alt = subtract, both = intersect) with the tool option as base. */
export function opFrom(e, base = "replace") {
  if (e.shift && e.alt) return "intersect";
  if (e.shift) return "add";
  if (e.alt) return "subtract";
  return base;
}

/** Alpha canvas of the selection in page space (cached per mask revision). */
export function maskCanvas(app) {
  const st = app.state;
  const m = st?.pixelMask;
  if (!m) return null;
  if (st._maskCv && st._maskCv.rev === st.maskRev && st._maskCv.m === m) return st._maskCv.canvas;
  const c = createCanvas(m.width, m.height);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(m.width, m.height);
  const d = img.data;
  const src = m.data;
  for (let i = 0, j = 3; i < src.length; i++, j += 4) d[j] = src[i];
  ctx.putImageData(img, 0, 0);
  st._maskCv = { rev: st.maskRev, m, canvas: c };
  return c;
}

// ------------------------------------------------------------------ painting target

/**
 * Resolves the pixel canvas an edit should go to: the selected pixel layer, its mask when mask editing is
 * on, or a freshly created pixel layer. Returns null if there is no document.
 */
export function paintTarget(app, { create = true } = {}) {
  const doc = app.doc;
  if (!doc) return null;
  let node = app.activeNode;
  const st = app.state;
  if (node && st.maskTarget && node.mask) {
    return describeTarget(app, node.mask, true, node);
  }
  if (node && node.type === "pixel") return describeTarget(app, node, false, node);
  if (!create) return null;
  node = newPixelLayer(app, { name: "Pixel Layer" });
  return describeTarget(app, node, false, node);
}

function describeTarget(app, node, isMask, owner) {
  const doc = app.doc;
  const canvas = doc.getPixels(node);
  const W = worldMatrix(isMask ? owner : node);
  // mask nodes live in the owner's local space
  const maskM = isMask ? mul(W, node.m) : W;
  const inv = invert(maskM) || ident();
  const sc = Math.sqrt(Math.abs(maskM[0] * maskM[3] - maskM[1] * maskM[2])) || 1;
  return { node, owner, isMask, canvas, ctx: ctx2d(canvas), world: maskM, inv, scale: sc, locked: !!(isMask ? owner.locked : node.locked) };
}

/** Page coordinates → layer pixel coordinates. */
export const toLayer = (t, x, y) => [t.inv[0] * x + t.inv[2] * y + t.inv[4], t.inv[1] * x + t.inv[3] * y + t.inv[5]];

/** The selection rendered into the target layer's pixel space (or null when nothing is selected). */
export function layerSpaceMask(app, t) {
  const src = maskCanvas(app);
  if (!src) return null;
  const c = createCanvas(t.canvas.width, t.canvas.height);
  const ctx = ctx2d(c);
  ctx.setTransform(t.inv[0], t.inv[1], t.inv[2], t.inv[3], t.inv[4], t.inv[5]);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Records an edit of a rect of a pixel layer (ImageData before/after already applied). */
export function commitPixelEdit(app, t, edit, label) {
  if (!edit) return;
  app.doc.recordPixelEdit(t.node, edit.x, edit.y, edit.before, edit.after, label);
}

// ------------------------------------------------------------------ layers

export function newPixelLayer(app, { name = "Pixel Layer", w, h, parent, above, select = true } = {}) {
  const doc = app.doc;
  const page = app.page;
  const node = createNode("pixel", { name, w: w ?? Math.round(page.w), h: h ?? Math.round(page.h) });
  doc.pixels.set(node.id, createCanvas(node.w, node.h));
  const ref = above || app.activeNode;
  const par = parent || (ref && ref._parent ? ref._parent : app.context);
  const index = ref && ref._parent === par ? par.children.indexOf(ref) + 1 : par.children.length;
  addNodes(app, node, { parent: par, index, label: "New Pixel Layer", select });
  return node;
}

/** Adds a raster mask to a node: 'reveal' (all visible), 'hide', or 'selection'. */
export function addLayerMask(app, node, kind = "reveal") {
  const doc = app.doc;
  const b = localBounds(node) || { x: 0, y: 0, w: app.page.w, h: app.page.h };
  const w = Math.max(1, Math.round(b.w));
  const h = Math.max(1, Math.round(b.h));
  const mask = createNode("pixel", { name: "Mask", w, h, m: translate(Math.round(b.x), Math.round(b.y)) });
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  if (kind === "reveal") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  } else if (kind === "selection") {
    const src = maskCanvas(app);
    if (src) {
      const W = worldMatrix(node);
      const inv = invert(W) || ident();
      const mm = mul(inv, ident());
      ctx.setTransform(mm[0], mm[1], mm[2], mm[3], mm[4] - Math.round(b.x), mm[5] - Math.round(b.y));
      ctx.drawImage(src, 0, 0);
    }
  }
  doc.pixels.set(mask.id, c);
  doc.tx("Add Mask", () => doc.setMask(node, mask));
  app.state.maskTarget = true;
  app.emit("selection");
  return mask;
}

export function removeLayerMask(app, node) {
  if (!node.mask) return;
  app.doc.setMask(node, null);
  app.state.maskTarget = false;
  app.emit("selection");
}

export { Mask };
