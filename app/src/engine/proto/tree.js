// Tree views of the flat Proto node map (docs/concepts/proto-studio.md §3.1). Pure.
//
// Children are derived: an Index maps a parent key (a node id, or "#<pageId>" for the top-level nodes of a page) to
// the ids of its children sorted by `ord`, ties broken by id (as on every collaboration replica). The index is cached
// per `model.nodes` object (a WeakMap), so it is built once per revision; ops.js hands the index it maintained while
// changing the model to the cache (`adoptIndex`), so a property edit never rebuilds it.
//
// Public API
//   parentKey(node)                         "#<page>" for a top-level node, else its parent id
//   indexOf(model) → Index                  the cached index of a model
//   children(model, id) / topLevel(model, page) / siblings(model, id)
//   ancestors(model, id) / depthOf(model, id) / isInside(model, id, ancestorId)
//   descendants(model, id) / subtree(model, ids) / roots(model, ids) / walk(model, page, fn)
//   pageList(model)                         pages sorted by `ord` (then id)
//   summarize(model)                        counts for `ofini info` and the Doctor

const TOP = "#";
const EMPTY = Object.freeze([]);

/** Parent key of a node: its parent id, or "#<page>" for a top-level node. */
export const parentKey = (n) => (n.parent == null ? TOP + n.page : n.parent);
/** Parent key of the top level of a page. */
export const pageKey = (pageId) => TOP + pageId;

const ordOf = (n) => (n && typeof n.ord === "string" ? n.ord : "");
const compare = (nodes, a, b) => {
  const x = ordOf(nodes[a]);
  const y = ordOf(nodes[b]);
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

export class Index {
  /** @param {Map<string, string[]>} [map] */
  constructor(map = new Map()) {
    this.map = map;
    /** keys whose arrays this index owns (copy on write after `fork`) */
    this.own = new Set();
  }

  static build(nodes) {
    const map = new Map();
    for (const id of Object.keys(nodes)) {
      const n = nodes[id];
      if (!n || typeof n !== "object") continue;
      const k = parentKey(n);
      let a = map.get(k);
      if (!a) map.set(k, (a = []));
      a.push(id);
    }
    for (const a of map.values()) a.sort((x, y) => compare(nodes, x, y));
    return new Index(map);
  }

  /** Sorted child ids of a parent key (do not mutate). */
  get(key) {
    return this.map.get(key) || EMPTY;
  }

  /** A copy that shares the arrays until it changes them. */
  fork() {
    return new Index(new Map(this.map));
  }

  _own(key) {
    let a = this.map.get(key);
    if (!this.own.has(key)) {
      a = a ? a.slice() : [];
      this.map.set(key, a);
      this.own.add(key);
    }
    return a;
  }

  /** Inserts `id` (already in `nodes`) at its sorted place among the children of its parent key. */
  add(nodes, id) {
    const a = this._own(parentKey(nodes[id]));
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(nodes, a[mid], id) < 0) lo = mid + 1;
      else hi = mid;
    }
    a.splice(lo, 0, id);
  }

  /** Removes `id` from the children of `key`. */
  remove(key, id) {
    if (!this.map.has(key)) return;
    const a = this._own(key);
    const i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1);
    if (!a.length) {
      this.map.delete(key);
      this.own.delete(key);
    }
  }
}

const cache = new WeakMap();

/** The (cached) index of `model`. */
export function indexOf(model) {
  const nodes = model?.nodes || {};
  let ix = cache.get(nodes);
  if (!ix) {
    ix = Index.build(nodes);
    cache.set(nodes, ix);
  }
  return ix;
}

/** Registers `ix` as the index of the `nodes` object (used by ops.js; the index must match `nodes` exactly). */
export function adoptIndex(nodes, ix) {
  ix.own = new Set();
  cache.set(nodes, ix);
}

/** Child ids of a node, in order. */
export const children = (model, id) => indexOf(model).get(id);
/** Top-level node ids of a page, in order. */
export const topLevel = (model, pageId) => indexOf(model).get(pageKey(pageId));
/** Ids of the node and its siblings, in order. */
export function siblings(model, id) {
  const n = model.nodes[id];
  return n ? indexOf(model).get(parentKey(n)) : EMPTY;
}

/** Ancestor ids from the parent up to the top-level node (stops at a cycle in an invalid model). */
export function ancestors(model, id) {
  const out = [];
  const seen = new Set([id]);
  let p = model.nodes[id]?.parent;
  while (p != null && !seen.has(p) && model.nodes[p]) {
    out.push(p);
    seen.add(p);
    p = model.nodes[p].parent;
  }
  return out;
}

/** Nesting depth: 0 for a top-level node. */
export const depthOf = (model, id) => ancestors(model, id).length;

/** True when `id` is `ancestorId` or lies inside it. */
export function isInside(model, id, ancestorId) {
  if (id === ancestorId) return true;
  const seen = new Set();
  let p = model.nodes[id]?.parent;
  while (p != null && !seen.has(p)) {
    if (p === ancestorId) return true;
    seen.add(p);
    p = model.nodes[p]?.parent;
  }
  return false;
}

/** Descendant ids of a node in pre-order (without the node itself). */
export function descendants(model, id) {
  const ix = indexOf(model);
  const out = [];
  const stack = [...ix.get(id)].reverse();
  while (stack.length) {
    const c = stack.pop();
    out.push(c);
    const kids = ix.get(c);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

/** The ids of `ids` that are not inside another of `ids`, in the given order. */
export function roots(model, ids) {
  const set = new Set(ids);
  return [...new Set(ids)].filter((id) => !ancestors(model, id).some((a) => set.has(a)));
}

/** Every id of the subtrees of `ids` (roots first, pre-order), each once. */
export function subtree(model, ids) {
  const out = [];
  const seen = new Set();
  for (const r of roots(model, ids)) {
    if (!model.nodes[r] || seen.has(r)) continue;
    for (const id of [r, ...descendants(model, r)]) if (!seen.has(id)) seen.add(id), out.push(id);
  }
  return out;
}

/**
 * Walks the nodes of a page in pre-order (paint order: later siblings paint above earlier ones).
 * `fn(node, depth)` may return false to skip the children of that node.
 */
export function walk(model, pageId, fn) {
  const ix = indexOf(model);
  const visit = (ids, depth) => {
    for (const id of ids) {
      const n = model.nodes[id];
      if (!n) continue;
      if (fn(n, depth) === false) continue;
      visit(ix.get(id), depth + 1);
    }
  };
  visit(ix.get(pageKey(pageId)), 0);
}

/** Pages sorted by `ord` (then id). */
export function pageList(model) {
  return Object.values(model?.pages || {})
    .filter((p) => p && typeof p === "object")
    .sort((a, b) => (ordOf(a) < ordOf(b) ? -1 : ordOf(a) > ordOf(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Counts used by `ofini info`, the Doctor and the describe tools. Tolerates invalid models. */
export function summarize(model) {
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const nodes = Object.values(obj(model?.nodes)).filter((n) => n && typeof n === "object");
  const byType = {};
  for (const n of nodes) byType[n.type] = (byType[n.type] || 0) + 1;
  const pages = Object.values(obj(model?.pages)).filter((p) => p && typeof p === "object");
  return {
    schema: model?.schema ?? null,
    pages: pages.length,
    frames: nodes.filter((n) => n.type === "frame" && n.parent == null).length,
    nodes: nodes.length,
    byType,
    components: (byType.component || 0) + (byType.componentSet || 0),
    instances: byType.instance || 0,
    collections: Object.keys(obj(model?.vars?.collections)).length,
    variables: Object.keys(obj(model?.vars?.items)).length,
    styles: Object.keys(obj(model?.styles)).length,
    flows: pages.reduce((s, p) => s + (Array.isArray(p.flows) ? p.flows.length : 0), 0),
    media: Object.keys(obj(model?.media)).length,
  };
}
