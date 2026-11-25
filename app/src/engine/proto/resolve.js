// The resolver of the Proto model (docs/concepts/proto-studio.md §3.3, §3.4, §4.1; ADR 0034). Pure: no DOM.
//
// It turns stored nodes into a *resolved tree*: styles applied, instances expanded into virtual subtrees, component
// properties and overrides applied, and every variable binding `{ "$var": id }` replaced by its concrete value in the
// modes that are active at that node. The CSS compiler (css.js), the pure layout solver (layout.js), and later the
// renderer, code export, lint and agents all read this tree, never the stored nodes directly.
//
// A resolved node:
//   { key, id, type, node, children, modes, bound, instance, parent, src, base, slot }
//     key       unique in the tree: the node id, or "<instanceKey>/<sourceId>" for a layer inside an instance
//     id        the id of the stored (source) node
//     node      the effective node: plain JSON with styles, properties and overrides applied and bindings replaced by
//               values (fields with a schema default may still be omitted; read them with schema.js ▸ field)
//     modes     the active variable modes { collectionId: modeId } at this node (collection defaults not filled in)
//     bound     { "<field path>": variableId } for every binding that was replaced, or null; css.js uses it to emit
//               `var(--name, value)` (paths are dotted with list indexes: "layout.gap", "fills.0.color")
//     instance  the key of the instance this layer was expanded from, or null
//     parent    the parent's key, or null for the root of the resolved tree
//     src       the stored node with component properties and overrides applied (before instance expansion, styles
//               and variables): what detaching writes for a nested instance
//     base      `src` after instance expansion (for an instance: the main component's fields under its own), still with
//               variable bindings and style references: what detaching writes for every other layer
//     slot      the key of the instance whose slot this layer fills (slot content), else null
//
// Public API
//   createResolver(model, opts?) → resolver
//     .tree(id)                 resolved subtree of a node (modes of its ancestors and page applied)
//     .page(pageId)             resolved top-level nodes of a page
//     .modesAt(id)              active modes at a stored node
//     .modeOf(collId, modes)    the mode of a collection that applies in `modes`
//     .variable(id, modes)      concrete value of a variable (extending collections and aliases followed)
//     .value(v, modes)          a literal, or the value of a binding
//     .cssName(id)              custom property name of a variable ("--color-bg-surface")
//     .warnings                 problems met while resolving ({ code, key, message }), never thrown
//   createResolveCache()        a cache of resolved instances kept across model revisions (pass it as opts.cache)
//   resolve(model, id, opts?) / resolvePage(model, pageId, opts?)   one-shot helpers
//   cssVarName(item) / slug(name) / pickVariant(model, target, variant) / walkResolved / rfield
//   expandInstance / applyStyles                       the default hooks (see below)
//
// Options
//   modes          { collectionId: modeId } applied at the page level (render a frame in dark mode)
//   instance       (ctx, inst) → { node, source, children, binds?, defs?, values?, slots? } | null    expands an instance
//   applyStyles    (ctx, node) → node                         applies style references (default: text, effect, fill,
//                                                             stroke and grid styles; variables.js ▸ applyStyleRefs)
//   variableValue  (ctx, varId, modes) → value | undefined    looks up a variable value (default: variables.js)
//   cache          a createResolveCache(): real (top-level) instances whose inputs did not change since the last
//                  resolver are reused as the same resolved objects (only with the default instance hook)
//   maxDepth       nesting limit of the resolved tree (default 128)
//
// Instances (components.js has the semantics): the variant of a set is picked, the main component's fields lie under
// the instance's own fields, property values are written into the bound fields of the component's layers, the
// component's layers become virtual children, overrides (`over`) apply by source-id path through nested instances
// (outer instances win), and the instance's own stored children fill the component's slots.
import { field } from "./schema.js";
import { indexOf, pageKey, ancestors } from "./tree.js";
import { slug, cssVarName, mergeModes, selection, variableValue, applyStyleRefs } from "./variables.js";
import { pickVariant, propsOfTarget, effectiveProps, bindingsOf, applyBinds, slotTargets, slotContent } from "./components.js";

export { slug, cssVarName, pickVariant };

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isBinding = (v) => isObj(v) && typeof v.$var === "string" && Object.keys(v).length === 1;

/** Fields that are never variable-resolved (structure, component data handled by the instance hook, interactions). */
const SKIP = new Set(["id", "type", "page", "parent", "ord", "proto", "props", "variant", "bind", "of", "over", "code", "a11y", "tag"]);
/** Fields of a main component that an instance does not inherit (identity and component definitions). */
const NOT_INHERITED = new Set(["id", "type", "name", "page", "parent", "ord", "x", "y", "pos", "cx", "cy", "cell", "sticky", "props", "variant", "bind", "of", "over", "code", "proto"]);
/** Instance fields that are not node fields of the expanded root. */
const INSTANCE_ONLY = new Set(["of", "variant", "props", "over"]);

// the fields an instance takes from a main component, and its own node fields; cached per (immutable) node object
const inheritedCache = new WeakMap();
const ownCache = new WeakMap();
function fieldsOf(n, skip, cache) {
  let o = cache.get(n);
  if (!o) {
    o = {};
    for (const k in n) if (!skip.has(k)) o[k] = n[k];
    cache.set(n, o);
  }
  return o;
}

/** Applies a node's style references (text, effect, fill, stroke and grid) over its local fields: the style wins. */
export const applyStyles = (ctx, node) => applyStyleRefs(ctx.model, node);

/**
 * The default instance hook: the main component's fields under the instance's own fields, the component's layers as
 * children, its property bindings with the instance's values, and the slot content of the instance. Returns null when
 * the component cannot be found (library references, removed components); the instance then resolves as an empty
 * container.
 */
export function expandInstance(ctx, inst, rec = null) {
  const model = ctx.model;
  const target = typeof inst.of === "string" ? model.nodes[inst.of] : null;
  if (rec && target) rec(target);
  const comp = pickVariant(model, target, inst.variant, rec, ctx.variantMemo || null);
  if (!comp) return null;
  const node = Object.assign({}, fieldsOf(comp, NOT_INHERITED, inheritedCache), fieldsOf(inst, INSTANCE_ONLY, ownCache));
  node.type = "instance";
  const defs = propsOfTarget(model, comp.id) || {};
  const binds = bindingsOf(model, comp);
  const values = effectiveProps(defs, inst);
  const children = indexOf(model).get(comp.id);
  if (rec) rec(null, comp.id, children);
  // slot content: the instance's own stored children
  const kids = indexOf(model).get(inst.id);
  if (rec) rec(null, inst.id, kids);
  const slots = kids.length ? slotContent(model, inst, kids, defs, slotTargets(model, comp, defs, binds)) : null;
  return { node, source: comp, children, binds, defs, values, slots };
}

/** Deep-replaces bindings in `v` (a field value), recording their paths. */
function bindDeep(ctx, v, modes, path, bound) {
  if (isBinding(v)) {
    bound[path] = v.$var;
    return ctx.variable(v.$var, modes);
  }
  if (Array.isArray(v)) {
    let out = v;
    for (let i = 0; i < v.length; i++) {
      const x = bindDeep(ctx, v[i], modes, `${path}.${i}`, bound);
      if (x !== v[i]) {
        if (out === v) out = v.slice();
        out[i] = x;
      }
    }
    return out;
  }
  if (isObj(v)) {
    let out = v;
    for (const k of Object.keys(v)) {
      const x = bindDeep(ctx, v[k], modes, `${path}.${k}`, bound);
      if (x !== v[k]) {
        if (out === v) out = { ...v };
        out[k] = x;
      }
    }
    return out;
  }
  return v;
}

/** A cache of resolved real instances across model revisions (see the header). */
export function createResolveCache() {
  return { map: new Map(), gen: 0, hits: 0, misses: 0 };
}

const ROOT_ENV = Object.freeze({ instKey: null, srcPath: Object.freeze([]), scopes: Object.freeze([]), comps: Object.freeze([]), own: null, slot: null });

/**
 * Creates a resolver for one model revision.
 * @param {object} model
 * @param {{ modes?: Record<string,string>, instance?: Function, applyStyles?: Function, variableValue?: Function, cache?: object, maxDepth?: number }} [opts]
 */
export function createResolver(model, opts = {}) {
  const items = isObj(model?.vars?.items) ? model.vars.items : {};
  const colls = isObj(model?.vars?.collections) ? model.vars.collections : {};
  const maxDepth = opts.maxDepth ?? 128;
  const customHook = typeof opts.instance === "function";
  const stylesHook = opts.applyStyles || applyStyles;
  const cache = !customHook && opts.cache && opts.cache.map instanceof Map ? opts.cache : null;
  if (cache) cache.gen++;
  const warnings = [];
  const warn = (code, key, message) => {
    if (warnings.length < 1000) warnings.push({ code, key, message });
  };
  const ix = indexOf(model);

  // dependency recorders of the cached instances being built (innermost last)
  const recorders = [];
  const rec = (node, kidsOf, kids) => {
    for (const r of recorders) {
      if (node) r.nodes.push(node);
      else r.kids.push(kidsOf, kids);
    }
  };
  const kidsOf = (id) => {
    const k = ix.get(id);
    if (recorders.length) rec(null, id, k);
    return k;
  };

  const ctx = {
    model,
    warnings,
    /** variant choices of this resolver (pickVariant memo) */
    variantMemo: new Map(),
    /** The mode of `collId` that applies in `modes` (extending collections and defaults included). */
    modeOf: (collId, modes) => selection(colls, modes, collId).mode,
    variable(id, modes = {}) {
      const v = opts.variableValue ? opts.variableValue(ctx, id, modes) : variableValue(model, id, modes);
      if (v === undefined) warn("unresolved-variable", null, `The variable “${id}” has no value.`);
      return v;
    },
    value(v, modes = {}) {
      return isBinding(v) ? ctx.variable(v.$var, modes) : v;
    },
    cssName(id) {
      return cssVarName(items[id], id);
    },
    /** Active modes at a stored node: page modes, then ancestors' and the node's own `modes`, over `opts.modes`. */
    modesAt(id) {
      const n = model.nodes[id];
      if (!isObj(n)) return { ...(opts.modes || {}) };
      const chain = [id, ...ancestors(model, id)].reverse();
      let modes = pageModes(n.page);
      for (const a of chain) modes = mergeModes(colls, modes, model.nodes[a]?.modes);
      return modes;
    },
    tree(id) {
      const n = model.nodes[id];
      if (!isObj(n)) return null;
      const parentModes = n.parent != null ? ctx.modesAt(n.parent) : pageModes(n.page);
      return build(n, id, null, parentModes, ROOT_ENV, 0);
    },
    page(pageId) {
      const modes = pageModes(pageId);
      return ix
        .get(pageKey(pageId))
        .map((id) => build(model.nodes[id], id, null, modes, ROOT_ENV, 0))
        .filter(Boolean);
    },
  };

  // the resolver's selections apply over the page's (`opts.modes` renders a page in a mode), the layers' over both
  const pageModes = (pageId) => mergeModes(colls, mergeModes(colls, {}, model.pages?.[pageId]?.modes), opts.modes);

  const expand = customHook ? (node) => opts.instance(ctx, node) : (node) => expandInstance(ctx, node, recorders.length ? rec : null);

  /** A cached real instance, or the result of building it (and caching it). */
  function cached(stored, key, parentKeyStr, parentModes, env, depth) {
    const sig = `${parentKeyStr}|${env.slot}|${JSON.stringify(parentModes)}`;
    const e = cache.map.get(key);
    if (e && e.sig === sig && e.vars === model.vars && e.styles === model.styles && e.stored === stored && valid(e)) {
      e.gen = cache.gen;
      cache.hits++;
      for (const w of e.warnings) warn(w.code, w.key, w.message);
      for (const r of recorders) {
        r.nodes.push(stored, ...e.nodes);
        r.kids.push(...e.kids);
      }
      return e.r;
    }
    cache.misses++;
    const deps = { nodes: [], kids: [] };
    recorders.push(deps);
    const w0 = warnings.length;
    let r;
    try {
      r = build(stored, key, parentKeyStr, parentModes, env, depth, true);
    } finally {
      recorders.pop();
    }
    for (const x of recorders) {
      x.nodes.push(stored, ...deps.nodes);
      x.kids.push(...deps.kids);
    }
    cache.map.set(key, { sig, vars: model.vars, styles: model.styles, stored, nodes: deps.nodes, kids: deps.kids, warnings: warnings.slice(w0), r, gen: cache.gen });
    if (cache.map.size > 20000) for (const [k, x] of cache.map) if (x.gen < cache.gen - 2) cache.map.delete(k);
    return r;
  }

  const valid = (e) => {
    for (const n of e.nodes) if (model.nodes[n.id] !== n) return false;
    for (let i = 0; i < e.kids.length; i += 2) if (ix.get(e.kids[i]) !== e.kids[i + 1]) return false;
    return true;
  };

  /**
   * @param {object} stored   the stored node
   * @param {string} key
   * @param {string|null} parentKeyStr
   * @param {object} parentModes
   * @param {{ instKey: string|null, srcPath: string[], scopes: object[], comps: string[], own: object|null, slot: string|null }} env
   *   instKey: the instance this layer belongs to; srcPath: source ids from the outermost instance's component down to
   *   this layer; scopes: override maps of the enclosing instances (innermost last); comps: components being expanded
   *   (cycle guard); own: { binds, defs, values, slots, owner } of the instance whose component this layer belongs to;
   *   slot: the instance whose slot this layer fills
   */
  function build(stored, key, parentKeyStr, parentModes, env, depth, fromCache = false) {
    if (!isObj(stored)) return null;
    if (depth > maxDepth) {
      warn("depth", key, "The layer is nested too deeply to resolve.");
      return null;
    }
    if (cache && !fromCache && env.instKey === null && stored.type === "instance") return cached(stored, key, parentKeyStr, parentModes, env, depth);
    if (recorders.length) rec(stored);
    const own = env.own;
    // component properties of the instance this layer belongs to, then overrides (innermost first, outer instances win)
    let node = own?.binds ? applyBinds(stored, own.binds.get(stored.id), own.defs, own.values) : stored;
    for (let i = env.scopes.length - 1; i >= 0; i--) {
      const sc = env.scopes[i];
      const over = sc.over[env.srcPath.slice(sc.start).join("/")];
      if (isObj(over)) node = { ...node, ...over };
    }
    const src = node;
    let kids = kidsOf(stored.id);
    let childEnv = null;
    let slotOwner = null;
    if (node.type === "instance") {
      const compId = isObj(model.nodes[node.of]) ? node.of : null;
      const cyclic = compId !== null && env.comps.includes(compId);
      const over = node.over;
      const exp = cyclic ? null : expand(node);
      if (cyclic) warn("component-cycle", key, "An instance contains itself.");
      if (exp) {
        node = { ...exp.node, id: stored.id };
        if (exp.binds && exp.source) node = applyBinds(node, exp.binds.get(exp.source.id), exp.defs, exp.values);
        kids = exp.children || [];
        let comps = env.comps;
        if (exp.source) {
          const set = exp.source.parent != null && model.nodes[exp.source.parent]?.type === "componentSet" ? [exp.source.parent] : [];
          comps = [...env.comps, exp.source.id, ...set];
        }
        childEnv = {
          instKey: key,
          srcPath: env.srcPath,
          // overrides inside this instance are keyed by the source-id path below it
          scopes: isObj(over) ? [...env.scopes, { start: env.srcPath.length, over }] : env.scopes,
          comps,
          own: exp.binds || exp.slots ? { binds: exp.binds || null, defs: exp.defs || {}, values: exp.values || {}, slots: exp.slots || null, owner: { key, env } } : null,
          slot: null,
        };
      } else {
        kids = [];
        if (!cyclic) warn("missing-component", key, `The component “${node.of}” is not available.`);
      }
    } else if (own?.slots?.has(stored.id)) {
      kids = own.slots.get(stored.id);
      slotOwner = own.owner;
    }
    const modes = mergeModes(colls, parentModes, node.modes);
    const base = node;
    node = stylesHook(ctx, node);
    const bound = {};
    // bindings replaced by values; a node without bindings is kept as it is
    let out = node;
    for (const k in node) {
      if (SKIP.has(k)) continue;
      const v = node[k];
      if (v === null || typeof v !== "object") continue;
      const x = bindDeep(ctx, v, modes, k, bound);
      if (x !== v) {
        if (out === node) out = { ...node };
        out[k] = x;
      }
    }
    const r = {
      key,
      id: stored.id,
      type: out.type,
      node: out,
      children: [],
      modes,
      bound: Object.keys(bound).length ? bound : null,
      instance: env.instKey,
      parent: parentKeyStr,
      src,
      base,
      slot: env.slot,
    };
    for (const cid of kids) {
      const c = model.nodes[cid];
      if (recorders.length) rec(c || { id: cid });
      if (!isObj(c)) continue;
      let ce;
      let childKey;
      if (slotOwner) {
        // slot content belongs to the instance that provides it, not to the component the slot is in
        const o = slotOwner.env;
        const inside = o.instKey !== null;
        childKey = inside ? `${slotOwner.key}/${cid}` : cid;
        ce = { instKey: o.instKey, srcPath: inside ? [...o.srcPath, cid] : [], scopes: o.scopes, comps: o.comps, own: o.own, slot: slotOwner.key };
      } else {
        const e = childEnv || env;
        const inside = childEnv !== null || env.instKey !== null;
        childKey = inside ? `${key}/${cid}` : cid;
        ce = e === env ? { ...env, srcPath: inside ? [...env.srcPath, cid] : [], slot: null } : { ...e, srcPath: [...e.srcPath, cid] };
      }
      const rc = build(c, childKey, key, modes, ce, depth + 1);
      if (rc) r.children.push(rc);
    }
    return r;
  }

  return ctx;
}

/** Resolved subtree of one node. */
export const resolve = (model, id, opts) => createResolver(model, opts).tree(id);
/** Resolved top-level nodes of a page. */
export const resolvePage = (model, pageId, opts) => createResolver(model, opts).page(pageId);

/** Visits a resolved tree in pre-order: `fn(rnode, parent)`; return false to skip children. */
export function walkResolved(root, fn, parent = null) {
  if (!root) return;
  if (fn(root, parent) === false) return;
  for (const c of root.children) walkResolved(c, fn, root);
}

/** A resolved node's field with its schema default. */
export const rfield = (r, key) => field(r.node, key);
