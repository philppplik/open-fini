// Hit testing: which node is under a point? Uses the browser's own path hit tests
// (isPointInPath / isPointInStroke) so picking matches rendering exactly.
import { invert, apply, det, mul, rectContainsPoint, rectInflate } from "../core/math.js";
import { shapeGeometry, localBounds, worldMatrix } from "../core/nodes.js";
import { pathToData, dataToPath2D } from "./vector/path.js";
import { createCanvas } from "../core/doc.js";

let hctx = null;
const ctx = () => hctx || (hctx = createCanvas(1, 1).getContext("2d"));

function path2dOf(node) {
  const k = node._rev | 0;
  if (node._h2dk !== k) {
    const geo = shapeGeometry(node);
    node._h2d = geo && geo.subpaths.length ? dataToPath2D(pathToData(geo)) : null;
    node._h2dk = k;
  }
  return node._h2d;
}

function hitOwn(node, x, y, tol) {
  switch (node.type) {
    case "rect":
    case "ellipse":
    case "polygon":
    case "star":
    case "path": {
      const p = path2dOf(node);
      if (!p) return false;
      const c = ctx();
      const filled = node.fill && (node.fill.alpha ?? 1) > 0.01;
      if (filled && c.isPointInPath(p, x, y, node.rule || "nonzero")) return true;
      c.lineWidth = Math.max((node.stroke?.width || 0) + tol * 2, tol * 2);
      c.lineJoin = "round";
      return c.isPointInStroke(p, x, y);
    }
    case "image":
    case "pixel":
      return x >= -tol && y >= -tol && x <= node.w + tol && y <= node.h + tol;
    case "text": {
      const b = node._bounds || { x: 0, y: 0, w: node.w || 0, h: node.h || 0 };
      return x >= b.x - tol && y >= b.y - tol && x <= b.x + b.w + tol && y <= b.y + b.h + tol;
    }
    default:
      return false;
  }
}

/** `x,y` are in the PARENT space of `node`. Returns the deepest hit node or null. */
export function hitNode(node, x, y, tol, { includeLocked = false } = {}) {
  if (!node.visible || (node.locked && !includeLocked)) return null;
  const inv = invert(node.m);
  if (!inv) return null;
  const [lx, ly] = apply(inv, x, y);
  const s = Math.sqrt(Math.abs(det(node.m))) || 1;
  const t = tol / s;
  const b = localBounds(node);
  if (!b) return null;
  const sw = node.stroke ? node.stroke.width : 0;
  if (!rectContainsPoint(rectInflate(b, t + sw), lx, ly)) return null;
  if (node.children) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const r = hitNode(node.children[i], lx, ly, t, { includeLocked });
      if (r) return r;
    }
  }
  return hitOwn(node, lx, ly, t) ? node : null;
}

/**
 * Picks a node at page coordinates.
 * @param {object} root page root (or any container to search inside)
 * @param {{deep?:boolean, includeLocked?:boolean}} [o] `deep` returns the leaf, otherwise the direct child of `root`.
 */
export function pick(root, x, y, tol, o = {}) {
  // convert page space into the container's own interior space
  const w = worldMatrix(root);
  const inv = invert(w) || [1, 0, 0, 1, 0, 0];
  const [px, py] = apply(inv, x, y);
  const s = Math.sqrt(Math.abs(det(w))) || 1;
  for (let i = root.children.length - 1; i >= 0; i--) {
    const c = root.children[i];
    const r = hitNode(c, px, py, tol / s, o);
    if (r) return o.deep ? r : c;
  }
  return null;
}

/** Nodes (direct children of `root`) whose visual bounds intersect/are inside a page-space rectangle. */
export function pickInRect(root, rect, { contain = true, includeLocked = false } = {}) {
  const w = worldMatrix(root);
  const out = [];
  for (const c of root.children) {
    if (!c.visible || (c.locked && !includeLocked)) continue;
    const b = localBounds(c);
    if (!b) continue;
    const m = mul(w, c.m);
    // bounds of the child in page space
    const xs = [];
    const ys = [];
    for (const [cx, cy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]) {
      const [tx, ty] = apply(m, cx, cy);
      xs.push(tx);
      ys.push(ty);
    }
    const bx0 = Math.min(...xs);
    const by0 = Math.min(...ys);
    const bx1 = Math.max(...xs);
    const by1 = Math.max(...ys);
    const inside = bx0 >= rect.x && by0 >= rect.y && bx1 <= rect.x + rect.w && by1 <= rect.y + rect.h;
    const overlaps = bx0 < rect.x + rect.w && bx1 > rect.x && by0 < rect.y + rect.h && by1 > rect.y;
    if (contain ? inside : overlaps) out.push(c);
  }
  return out;
}
