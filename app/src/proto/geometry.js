// Geometry cache of the Proto canvas (docs/concepts/proto-studio.md §4.1): boxes of every rendered layer in world
// coordinates, filled by proto/measure.js from the DOM and read by hit testing, marquee selection, the overlay and
// (later) snapping and agents. Pure: no DOM, unit tested.
//
// An entry: { key, id, sel, root, parent, type, x, y, w, h, order, clip, paint }
//   key     resolved key (resolve.js): the node id, or "<instance>/<sourceId>" inside an instance
//   sel     the stored node a click selects for this entry: the node itself, or the outermost instance it belongs to
//   root    the top-level layer (a node id) the entry belongs to; parent: the parent's key (null for the root)
//   order   paint order across the page (higher paints on top); clip: the world rect the entry is visible in, or null
//
// Public API
//   createGeometry() → geo   .setRoot(rootId, entries[]) .dropRoot(rootId) .get(key) .rootBox(rootId) .entries()
//   hitTest(geo, x, y) → entries containing the point, top-most first
//   pickAt(geo, x, y, { deep, context }) → node id to select, or null
//   marqueeSelect(geo, rect, { scope }) → node ids
//   unionRect(rects) / rectsIntersect(a, b) / normRect(x0, y0, x1, y1)

export const rectsIntersect = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** A rect from two corners in any order. */
export const normRect = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });

/** The smallest rect around `rects` (null when there are none). */
export function unionRect(rects) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Intersection of two rects (null when one is null: no clipping). */
export function clipRect(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

export function createGeometry() {
  /** rootId → entries (in paint order) */
  const roots = new Map();
  /** key → entry */
  const byKey = new Map();
  let rev = 0;
  return {
    get rev() {
      return rev;
    },
    setRoot(rootId, entries) {
      for (const e of roots.get(rootId) || []) byKey.delete(e.key);
      roots.set(rootId, entries);
      for (const e of entries) byKey.set(e.key, e);
      rev++;
    },
    dropRoot(rootId) {
      for (const e of roots.get(rootId) || []) byKey.delete(e.key);
      if (roots.delete(rootId)) rev++;
    },
    has: (rootId) => roots.has(rootId),
    get: (key) => byKey.get(key) || null,
    rootEntries: (rootId) => roots.get(rootId) || [],
    /** The measured box of a top-level layer (its root entry), or null. */
    rootBox(rootId) {
      const e = byKey.get(rootId);
      return e ? { x: e.x, y: e.y, w: e.w, h: e.h } : null;
    },
    rootIds: () => [...roots.keys()],
    *entries() {
      for (const list of roots.values()) yield* list;
    },
    clear() {
      roots.clear();
      byKey.clear();
      rev++;
    },
  };
}

/** Every entry under the world point, top-most first (clipping by `clip` respected). */
export function hitTest(geo, x, y) {
  const out = [];
  for (const e of geo.entries()) {
    if (!(e.w >= 0 && e.h >= 0) || !contains(e, x, y)) continue;
    if (e.clip && !contains(e.clip, x, y)) continue;
    out.push(e);
  }
  return out.sort((a, b) => b.order - a.order);
}

/** The keys from `e` up to its root (inclusive), innermost first. */
function chainOf(geo, e) {
  const chain = [];
  let cur = e;
  let guard = 0;
  while (cur && guard++ < 256) {
    chain.push(cur);
    cur = cur.parent != null ? geo.get(cur.parent) : null;
  }
  return chain;
}

/**
 * The node a click at (x, y) selects.
 *   deep      Ctrl/Cmd-click: the top-most layer under the point
 *   context   a parent key whose children are being selected (the parent of the current selection): a hit inside it
 *             selects the child of it that contains the point
 * Otherwise a click selects the top-level layer's child under the point (the layers of a frame), or the top-level
 * layer itself (its background, or a layer that is not a container). Layers inside an instance select the instance.
 */
export function pickAt(geo, x, y, { deep = false, context = null } = {}) {
  const hits = hitTest(geo, x, y);
  const hit = hits[0];
  if (!hit) return null;
  if (deep) return hit.sel;
  const chain = chainOf(geo, hit);
  if (context != null) {
    const i = chain.findIndex((e) => e.parent === context);
    if (i >= 0) return chain[i].sel;
  }
  const pick = chain.length >= 2 ? chain[chain.length - 2] : chain[0];
  return pick.sel;
}

/**
 * Node ids whose boxes intersect the world rect `rect`, among the children of `scope` (a parent key), or among the
 * top-level layers when `scope` is null. Locked and hidden layers are left out by the caller (they are not measured).
 */
export function marqueeSelect(geo, rect, { scope = null } = {}) {
  const out = [];
  const seen = new Set();
  for (const e of geo.entries()) {
    if (e.parent !== scope) continue;
    if (!rectsIntersect(e, rect)) continue;
    if (e.clip && !rectsIntersect(e.clip, rect)) continue;
    if (seen.has(e.sel)) continue;
    seen.add(e.sel);
    out.push(e.sel);
  }
  return out;
}
