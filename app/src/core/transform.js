// Applying page-space transforms to nodes, with "scale baking": resizing a rectangle changes its
// width/height (strokes keep their weight), resizing a curve rewrites its points, while groups,
// pixel layers and artistic text keep the scale in their matrix.
import { mul, invert, decompose, compose, scale as scaleM, apply, rectTransform, rectUnion, ident } from "./math.js";
import { clone } from "./util.js";
import { transformPath } from "../engine/vector/path.js";
import { worldMatrix, localBounds, boundsInParent } from "./nodes.js";

const RECTLIKE = new Set(["rect", "ellipse", "polygon", "star", "image", "chart"]);

/** Everything needed to restore a node before an interactive transform. */
export function captureTransform(node) {
  const s = { m: node.m.slice() };
  if (RECTLIKE.has(node.type)) {
    s.w = node.w;
    s.h = node.h;
  }
  if (node.type === "text" && node.w != null) {
    s.w = node.w;
    s.h = node.h;
  }
  if (node.type === "path") s.path = clone(node.path);
  if (node.type === "table") {
    s.cols = node.cols.slice();
    s.rows = node._tl ? node._tl.rowHeights.slice() : node.rows.slice();
  }
  return s;
}

export function restoreTransform(node, snap) {
  node.m = snap.m.slice();
  if (snap.w !== undefined) node.w = snap.w;
  if (snap.h !== undefined) node.h = snap.h;
  if (snap.path) node.path = clone(snap.path);
  if (snap.cols) {
    node.cols = snap.cols.slice();
    node.rows = snap.rows.slice();
  }
}

/** Keys to record in history for a transform. */
export function transformKeys(node) {
  const k = ["m"];
  if (RECTLIKE.has(node.type) || node.type === "text") k.push("w", "h");
  if (node.type === "path") k.push("path");
  if (node.type === "table") k.push("cols", "rows");
  return k;
}

const EPS = 1e-4;

/**
 * Applies a PAGE-space delta matrix to `node`, starting from `snap` (captureTransform result).
 * Mutates the node live (callers call doc.touch / doc.recordSet).
 */
export function applyPageDelta(node, delta, snap, { bake = true } = {}) {
  const P = node._parent ? worldMatrix(node._parent) : ident();
  const Pinv = invert(P) || ident();
  restoreTransform(node, snap);
  node.m = mul(mul(Pinv, mul(delta, P)), snap.m);
  if (bake) bakeScale(node, snap);
}

function bakeScale(node, snap) {
  const bakeable = RECTLIKE.has(node.type) || (node.type === "text" && node.w != null) || node.type === "path" || node.type === "table";
  if (!bakeable) return;
  const d = decompose(node.m);
  if (Math.abs(d.skew) > EPS) return; // skewed: leave the matrix alone
  const sx = d.sx;
  const sy = Math.abs(d.sy);
  const flipY = d.sy < 0 ? -1 : 1;
  if (node.type === "path") {
    node.path = transformPath(snap.path, scaleM(sx, sy));
  } else if (node.type === "table") {
    node.cols = snap.cols.map((w) => Math.max(8, w * sx));
    node.rows = snap.rows.map((h) => Math.max(8, h * sy));
  } else {
    node.w = Math.max(0.01, snap.w * sx);
    node.h = Math.max(0.01, snap.h * sy);
  }
  node.m = compose({ tx: d.tx, ty: d.ty, rotation: d.rotation, sx: 1, sy: flipY });
}

/** Page-space oriented bounds of a node: {m, w, h} where m maps unit-box local coords to page space. */
export function orientedBounds(node) {
  const b = localBounds(node);
  if (!b) return null;
  const W = worldMatrix(node);
  return { m: W, x: b.x, y: b.y, w: b.w, h: b.h };
}

/** Axis-aligned page-space bounds of a node (visual-ish, without effects). */
export function pageBounds(node) {
  const b = localBounds(node);
  if (!b) return null;
  return rectTransform(b, worldMatrix(node));
}

/** Union of page-space bounds for several nodes. */
export function pageBoundsOf(nodes) {
  let r = null;
  for (const n of nodes) r = rectUnion(r, pageBounds(n));
  return r;
}

/** Converts a page-space point into a node's local coordinates. */
export function toLocal(node, x, y) {
  const inv = invert(worldMatrix(node));
  return inv ? apply(inv, x, y) : [x, y];
}

/** Moves a node by (dx,dy) in page space without baking. */
export function nudge(node, dx, dy) {
  const P = node._parent ? worldMatrix(node._parent) : ident();
  const Pinv = invert(P) || ident();
  const [tx, ty] = [Pinv[0] * dx + Pinv[2] * dy, Pinv[1] * dx + Pinv[3] * dy];
  node.m = [node.m[0], node.m[1], node.m[2], node.m[3], node.m[4] + tx, node.m[5] + ty];
}

export { boundsInParent };
