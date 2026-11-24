// The pure half of the Proto renderer (docs/concepts/proto-studio.md §4.1, §4.2): what changed, what to patch, and
// which top-level layers are drawn how. No DOM; unit tested in tests/proto/view-patch.test.js. proto/view.js applies
// the results to the DOM.
//
// Public API
//   changedRoots(prev, next, pageId) → { all, roots: Set<id>, order }
//       Which top-level layers of a page need a new resolve after a commit. The model shares structure (ops.js), so a
//       node whose object is unchanged is unchanged; a change inside a component marks every root with instances.
//   entriesFor(resolvedRoot, cssMap) → Map<key, entry>
//       The render description of one top-level layer: per resolved node { key, parent, type, decls, attrs, text,
//       svg, children, paint } built from css.js output (the single source of CSS).
//   planPatch(prev, next) → ops
//       Keyed patch from one description to the next: create, remove, style, attrs, text, svg, children (order).
//   cullState({ box, view, zoom, hiddenSince, now, detachAfter }) → "live" | "hidden" | "detached" | "lod" | "block"
//       How a top-level layer is drawn: live DOM, kept but skipped (`content-visibility: hidden`), detached far
//       away, or detached and drawn on the overlay as simplified geometry (zoomed out).
//   estimateBox(node) → { x, y, w, h }   the design-time box of a top-level layer (before it was ever measured)
import { indexOf, pageKey } from "../engine/proto/tree.js";

/** Below this zoom small frames switch to simplified drawing on the overlay. */
export const LOD_ZOOM = 0.25;
/** Below this zoom every top-level layer is a filled rectangle with its name. */
export const BLOCK_ZOOM = 0.05;
/** On-screen size (stage pixels) under which a frame is drawn simplified below LOD_ZOOM. */
export const LOD_PIXELS = 160;
/** Offscreen layers are detached from the DOM after this many milliseconds. */
export const DETACH_AFTER = 10000;

const COMPONENTISH = new Set(["component", "componentSet"]);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** The top-level ancestor id of `id` in `model` (or null when the node is not on a page). */
function rootOf(model, id) {
  const nodes = model.nodes;
  let cur = nodes[id];
  let guard = 0;
  while (cur && cur.parent != null && guard++ < 256) cur = nodes[cur.parent];
  return cur ? cur.id : null;
}

function insideComponent(model, id) {
  const nodes = model.nodes;
  let cur = nodes[id];
  let guard = 0;
  while (cur && guard++ < 256) {
    if (COMPONENTISH.has(cur.type)) return true;
    cur = cur.parent != null ? nodes[cur.parent] : null;
  }
  return false;
}

/**
 * Which top-level layers of `pageId` must be re-resolved going from `prev` to `next`.
 * @param {object|null} prev
 * @param {object} next
 * @param {string} pageId
 */
export function changedRoots(prev, next, pageId) {
  const order = indexOf(next).get(pageKey(pageId)).slice();
  const all = { all: true, roots: new Set(order), order };
  if (!prev || prev === next) return prev === next ? { all: false, roots: new Set(), order } : all;
  // variables, styles and media reach any layer; a page's own fields (modes) reach all of its layers
  if (prev.vars !== next.vars || prev.styles !== next.styles || prev.media !== next.media || prev.pages?.[pageId] !== next.pages?.[pageId]) return all;
  const roots = new Set();
  if (prev.nodes === next.nodes) return { all: false, roots, order };
  let components = false;
  const mark = (model, id) => {
    const n = model.nodes[id];
    if (!n || n.page !== pageId) {
      if (n && !components && insideComponent(model, id)) components = true;
      return;
    }
    const r = rootOf(model, id);
    if (r) roots.add(r);
    if (!components && insideComponent(model, id)) components = true;
  };
  for (const id in next.nodes) if (prev.nodes[id] !== next.nodes[id]) mark(next, id), prev.nodes[id] && mark(prev, id);
  for (const id in prev.nodes) if (!(id in next.nodes)) mark(prev, id);
  if (components) {
    // instances show their component: every root of this page that contains an instance follows it
    for (const id in next.nodes) {
      const n = next.nodes[id];
      if (n.type === "instance" && n.page === pageId) {
        const r = rootOf(next, id);
        if (r) roots.add(r);
      }
    }
  }
  return { all: false, roots, order };
}

/** The first visible solid fill color of a resolved node (for the simplified drawing), or null. */
function paintOf(r) {
  const fills = Array.isArray(r.node.fills) ? r.node.fills : [];
  let fill = null;
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    if (isObj(f) && f.visible !== false && f.type === "solid" && typeof f.color === "string") {
      fill = f.color;
      break;
    }
    if (isObj(f) && f.visible !== false && f.type !== "solid") {
      fill = "#c4c4cc";
      break;
    }
  }
  return { fill, text: r.type === "text", ellipse: r.type === "ellipse" };
}

/**
 * The render description of one resolved top-level layer.
 * @param {object} root   resolved tree (resolve.js)
 * @param {Map<string, object>} css   treeCss(root) results by key
 */
export function entriesFor(root, css) {
  const out = new Map();
  const visit = (r, parentKey) => {
    const c = css.get(r.key) || { decls: [], attrs: {} };
    out.set(r.key, {
      key: r.key,
      id: r.id,
      parent: parentKey,
      type: r.type,
      name: typeof r.node.name === "string" ? r.node.name : "",
      decls: c.decls,
      attrs: c.attrs || {},
      text: c.text || null,
      svg: c.svg || null,
      children: r.children.map((k) => k.key),
      paint: paintOf(r),
    });
    for (const k of r.children) visit(k, r.key);
  };
  if (root) visit(root, null);
  return out;
}

const sameDecls = (a, b) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
};
const sameList = (a, b) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
const json = (v) => JSON.stringify(v ?? null);

/**
 * Keyed patch operations from `prev` to `next` (Maps from entriesFor; prev may be null for a first render). The order
 * of the result is the order to apply: create (elements, not yet placed), remove, style, attrs, text, svg, then
 * children (place and reorder). The root is the entry without a parent.
 *   { t: "create", key, entry }
 *   { t: "remove", key, top }                  every removed key; `top` marks the ones whose parent survives (only
 *                                              those need to leave the DOM, the rest go with them)
 *   { t: "style", key, set: [[prop, value]], remove: [prop] }
 *   { t: "attrs", key, set: [[name, value]], remove: [name] }
 *   { t: "text", key, text }                   text runs changed (or null)
 *   { t: "svg", key, svg }                     vector or line drawing changed
 *   { t: "children", key, children }           the full ordered child key list of a parent whose list changed
 *   { t: "root", key }                         the root element changed identity (a new top-level element)
 */
export function planPatch(prev, next) {
  const ops = [];
  const before = prev || new Map();
  const removes = [];
  for (const [key, e] of next) if (!before.has(key)) ops.push({ t: "create", key, entry: e });
  for (const [key, e] of before) {
    if (next.has(key)) continue;
    removes.push({ t: "remove", key, top: e.parent == null || next.has(e.parent) });
  }
  ops.push(...removes);
  const children = [];
  for (const [key, e] of next) {
    const old = before.get(key);
    if (!old) {
      if (e.children.length) children.push({ t: "children", key, children: e.children });
      continue;
    }
    if (!sameDecls(old.decls, e.decls)) {
      const now = new Map(e.decls);
      const set = [];
      const remove = [];
      const was = new Map(old.decls);
      for (const [p, v] of e.decls) if (was.get(p) !== v) set.push([p, v]);
      for (const [p] of old.decls) if (!now.has(p)) remove.push(p);
      if (set.length || remove.length) ops.push({ t: "style", key, set, remove });
    }
    if (old.attrs !== e.attrs) {
      const set = [];
      const remove = [];
      for (const [n, v] of Object.entries(e.attrs)) if (old.attrs[n] !== v) set.push([n, v]);
      for (const n of Object.keys(old.attrs)) if (!(n in e.attrs)) remove.push(n);
      if (set.length || remove.length) ops.push({ t: "attrs", key, set, remove });
    }
    if (old.text !== e.text && json(old.text) !== json(e.text)) ops.push({ t: "text", key, text: e.text });
    if (old.svg !== e.svg && json(old.svg) !== json(e.svg)) ops.push({ t: "svg", key, svg: e.svg });
    if (!sameList(old.children, e.children)) children.push({ t: "children", key, children: e.children });
  }
  ops.push(...children);
  const rootKey = [...next.values()].find((e) => e.parent == null)?.key;
  const oldRoot = [...before.values()].find((e) => e.parent == null)?.key;
  if (rootKey !== oldRoot && rootKey != null) ops.push({ t: "root", key: rootKey });
  return ops;
}

/** Counts of a plan by operation type (stats and tests). */
export function planStats(ops) {
  const out = {};
  for (const o of ops) out[o.t] = (out[o.t] || 0) + 1;
  return out;
}

const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * How a top-level layer is drawn.
 * @param {{ box: {x,y,w,h}|null, view: {x,y,w,h}, near?: {x,y,w,h}, zoom: number, hiddenSince?: number|null, now?: number, detachAfter?: number }} o
 *   `view` is the visible world rect, `near` the rect (view plus a margin) inside which layers stay live.
 */
export function cullState({ box, view, near = view, zoom, hiddenSince = null, now = 0, detachAfter = DETACH_AFTER }) {
  if (!box) return "live"; // never measured: render it once to learn its size
  if (zoom < BLOCK_ZOOM) return "block";
  if (zoom < LOD_ZOOM && Math.max(box.w, box.h) * zoom < LOD_PIXELS) return "lod";
  if (intersects(box, near)) return "live";
  if (hiddenSince != null && now - hiddenSince >= detachAfter) return "detached";
  return "hidden";
}

const sizeOf = (s, fallback) => (isObj(s) && s.mode === "fixed" && Number.isFinite(s.value) ? s.value : fallback);

/** The design-time box of a top-level layer: its position and fixed sizes (hug and fill layers guess 100). */
export function estimateBox(node) {
  return { x: Number.isFinite(node?.x) ? node.x : 0, y: Number.isFinite(node?.y) ? node.y : 0, w: sizeOf(node?.w, 100), h: sizeOf(node?.h, 100) };
}
