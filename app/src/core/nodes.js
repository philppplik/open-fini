// Scene-graph node factories and geometry helpers.
//
// Node = {
//   id, type, name, visible, locked, opacity, blend, m (local→parent matrix), fx:[],
//   children?: Node[],            // groups, or nested/clipped children of painted nodes
//   mask?: Node,                  // pixel node used as an alpha mask, in this node's local space
//   fill, stroke,                 // vector shapes and text
//   ...type-specific fields
// }
// Types: group | rect | ellipse | polygon | star | path | text | image | pixel | adjust | table | chart
import { uid } from "./util.js";
import { ident, rectUnion, rectTransform, mul } from "./math.js";
import { rectPath, ellipsePath, polygonPath, starPath, pathBBox } from "../engine/vector/path.js";
import { createTable, nominalSize } from "../engine/layout/table-model.js";

export const SHAPE_TYPES = ["rect", "ellipse", "polygon", "star", "path"];

export const solid = (color = "#000000", alpha = 1) => ({ type: "solid", color, alpha });

export function linearGradient(c0 = "#ffffff", c1 = "#000000") {
  return {
    type: "linear",
    x0: 0, y0: 0.5, x1: 1, y1: 0.5,
    stops: [
      { o: 0, color: c0, alpha: 1 },
      { o: 1, color: c1, alpha: 1 },
    ],
  };
}

export function radialGradient(c0 = "#ffffff", c1 = "#000000") {
  return {
    type: "radial",
    cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5,
    stops: [
      { o: 0, color: c0, alpha: 1 },
      { o: 1, color: c1, alpha: 1 },
    ],
  };
}

export function conicGradient(c0 = "#ff0000", c1 = "#0000ff") {
  return {
    type: "conic",
    cx: 0.5, cy: 0.5, angle: 0,
    stops: [
      { o: 0, color: c0, alpha: 1 },
      { o: 1, color: c1, alpha: 1 },
    ],
  };
}

export function defaultStroke(color = "#000000", width = 1) {
  return { fill: solid(color), width, align: "center", cap: "butt", join: "miter", miterLimit: 4, dash: null, dashOffset: 0 };
}

const NAMES = {
  group: "Group", rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", star: "Star", path: "Curve",
  text: "Text", image: "Image", pixel: "Pixel Layer", adjust: "Adjustment", table: "Table", chart: "Chart",
};

/** Creates a node with sane defaults. `props` override anything. */
export function createNode(type, props = {}) {
  const base = {
    id: uid("n"),
    type,
    name: NAMES[type] || type,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    m: ident(),
    fx: [],
  };
  switch (type) {
    case "group":
      base.children = [];
      break;
    case "rect":
      Object.assign(base, { w: 100, h: 100, r: [0, 0, 0, 0], fill: solid("#8e8e93"), stroke: null });
      break;
    case "ellipse":
      Object.assign(base, { w: 100, h: 100, fill: solid("#8e8e93"), stroke: null });
      break;
    case "polygon":
      Object.assign(base, { w: 100, h: 100, sides: 5, cr: 0, fill: solid("#8e8e93"), stroke: null });
      break;
    case "star":
      Object.assign(base, { w: 100, h: 100, points: 5, ratio: 0.5, cr: 0, fill: solid("#8e8e93"), stroke: null });
      break;
    case "path":
      Object.assign(base, { path: { subpaths: [] }, rule: "nonzero", fill: null, stroke: defaultStroke(), name: "Curve" });
      break;
    case "text":
      Object.assign(base, {
        storyId: null, w: null, h: null, mode: "artistic", columns: 1, gutter: 12,
        insets: { top: 0, right: 0, bottom: 0, left: 0 }, vAlign: "top", fill: solid("#000000"), stroke: null,
      });
      break;
    case "image":
      Object.assign(base, { assetId: null, w: 100, h: 100, smooth: true });
      break;
    case "pixel":
      Object.assign(base, { w: 100, h: 100, smooth: true });
      break;
    case "adjust":
      Object.assign(base, { effect: { group: "adjustment", id: "levels" }, params: {}, name: "Adjustment" });
      break;
    case "table":
      Object.assign(base, createTable(), { alt: "" });
      break;
    case "chart":
      // `chart` holds the definition (see engine/layout/chart-data.js); filled in by the creator
      Object.assign(base, { w: 480, h: 300, chart: null, alt: "" });
      break;
  }
  const node = Object.assign(base, props);
  if (props.children === undefined && node.children === undefined && type === "group") node.children = [];
  return node;
}

export const isContainer = (n) => !!n.children && (n.type === "group" || n.children.length > 0);
export const isShape = (n) => SHAPE_TYPES.includes(n.type);
export const hasFillStroke = (n) => isShape(n) || n.type === "text";

/** The node's geometry as a VPath in its local coordinate space (shapes only). */
export function shapeGeometry(n) {
  switch (n.type) {
    case "rect":
      return rectPath(n.w, n.h, n.r);
    case "ellipse":
      return ellipsePath(n.w, n.h);
    case "polygon":
      return polygonPath(n.w, n.h, n.sides, n.cr || 0);
    case "star":
      return starPath(n.w, n.h, n.points, n.ratio, n.cr || 0);
    case "path":
      return n.path;
    default:
      return null;
  }
}

/** Local-space bounds of the node's own content (not children), without stroke. */
export function ownBounds(n) {
  switch (n.type) {
    case "rect":
    case "ellipse":
    case "image":
    case "pixel":
      return { x: 0, y: 0, w: n.w, h: n.h };
    case "polygon":
    case "star":
    case "path":
      return pathBBox(shapeGeometry(n));
    case "text":
      return n._bounds || { x: 0, y: 0, w: n.w || 0, h: n.h || 0 };
    case "chart":
      return { x: 0, y: 0, w: n.w, h: n.h };
    case "table":
      return n._bounds || { x: 0, y: 0, ...nominalSize(n) };
    default:
      return null;
  }
}

/** Local-space bounds including children, cached per node revision. */
export function localBounds(n, includeChildren = true) {
  if (!includeChildren) return ownBounds(n);
  const k = n._rev | 0;
  if (n._lbk === k && n._lbv !== undefined) return n._lbv;
  let b = ownBounds(n);
  // children of a painted node are clipped to it, so only groups (and bounds-less nodes) grow with their children
  if (n.children && (n.type === "group" || !b)) {
    for (const c of n.children) {
      if (!c.visible) continue;
      const cb = localBounds(c, true);
      if (cb) b = rectUnion(b, rectTransform(cb, c.m));
    }
  }
  n._lbk = k;
  n._lbv = b;
  return b;
}

/** Bounds in the node's parent space (applies n.m). */
export function boundsInParent(n) {
  const b = localBounds(n);
  return b ? rectTransform(b, n.m) : null;
}

/** Visual bounds in parent space, expanded for stroke width and effects. */
export function visualBounds(n) {
  const b = boundsInParent(n);
  if (!b) return null;
  let grow = 0;
  if (n.stroke && n.stroke.width) {
    const a = n.stroke.align || "center";
    grow = a === "inside" ? 0 : a === "outside" ? n.stroke.width : n.stroke.width / 2;
    if (n.stroke.join === "miter") grow *= Math.min(n.stroke.miterLimit || 4, 4) * 0.5 + 0.5;
  }
  for (const fx of n.fx || []) {
    if (fx.enabled === false) continue;
    if (fx.type === "dropShadow" || fx.type === "outerGlow") {
      grow = Math.max(grow, (fx.blur || fx.radius || 0) * 2 + Math.max(Math.abs(fx.dx || 0), Math.abs(fx.dy || 0)) + (fx.spread || 0));
    } else if (fx.type === "blur") grow = Math.max(grow, (fx.radius || 0) * 3);
    else if (fx.type === "outline") grow = Math.max(grow, fx.width || 0);
  }
  return grow ? { x: b.x - grow, y: b.y - grow, w: b.w + 2 * grow, h: b.h + 2 * grow } : b;
}

/** Matrix from node local space to the page root space (product of ancestor `m`s, stopping at the page root). */
export function worldMatrix(n) {
  let m = ident();
  for (let c = n; c && c._parent !== undefined; c = c._parent) {
    m = mul(c.m, m);
    if (!c._parent) break;
  }
  return m;
}

/** Matrix from the PARENT space of `n` to page space. */
export function parentWorldMatrix(n) {
  return n._parent ? worldMatrix(n._parent) : ident();
}

/** Depth-first walk. Return `false` from fn to skip children. */
export function walk(node, fn, parent = null) {
  if (fn(node, parent) === false) return;
  if (node.children) for (const c of node.children) walk(c, fn, node);
  if (node.mask) walk(node.mask, fn, node);
}

/**
 * After cloning nodes (duplicate / paste), charts that were linked to a table that is part of the same copy are
 * re-linked to the table's clone. `originals` and `clones` are parallel arrays of top-level nodes.
 * (Lives here rather than in data-nodes.js so core/ops.js can use it without an import cycle.)
 */
export function remapLinks(originals, clones) {
  const map = new Map();
  originals.forEach((o, i) => {
    const pairs = [];
    const a = [];
    const b = [];
    walk(o, (n) => a.push(n));
    walk(clones[i], (n) => b.push(n));
    for (let k = 0; k < Math.min(a.length, b.length); k++) pairs.push([a[k], b[k]]);
    for (const [x, y] of pairs) map.set(x.id, y.id);
  });
  for (const c of clones) {
    walk(c, (n) => {
      if (n.type === "chart" && n.chart?.source && map.has(n.chart.source.tableId)) n.chart.source.tableId = map.get(n.chart.source.tableId);
    });
  }
}

export function* iterate(node) {
  yield node;
  if (node.children) for (const c of node.children) yield* iterate(c);
}

/** True when `ancestor` contains `n` (or is `n`). */
export function isInside(n, ancestor) {
  for (let c = n; c; c = c._parent) if (c === ancestor) return true;
  return false;
}

export const typeLabel = (n) => NAMES[n.type] || n.type;
