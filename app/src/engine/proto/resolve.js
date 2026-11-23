// The resolver of the Proto model (docs/concepts/proto-studio.md §3.3, §3.4, §4.1; ADR 0034). Pure: no DOM.
//
// It turns stored nodes into a *resolved tree*: styles applied, instances expanded into virtual subtrees, overrides
// applied, and every variable binding `{ "$var": id }` replaced by its concrete value in the modes that are active at
// that node. The CSS compiler (css.js), the pure layout solver (layout.js), and later the renderer, code export, lint and
// agents all read this tree, never the stored nodes directly.
//
// A resolved node:
//   { key, id, type, node, children, modes, bound, instance, parent }
//     key       unique in the tree: the node id, or "<instanceKey>/<sourceId>" for a layer inside an instance
//     id        the id of the stored (source) node
//     node      the effective node: plain JSON with styles and overrides applied and bindings replaced by values
//               (fields with a schema default may still be omitted; read them with schema.js ▸ field)
//     modes     the active variable modes { collectionId: modeId } at this node (collection defaults not filled in)
//     bound     { "<field path>": variableId } for every binding that was replaced, or null; css.js uses it to emit
//               `var(--name, value)` (paths are dotted with list indexes: "layout.gap", "fills.0.color")
//     instance  the key of the instance this layer was expanded from, or null
//     parent    the parent's key, or null for the root of the resolved tree
//
// Public API
//   createResolver(model, opts?) → resolver
//     .tree(id)                 resolved subtree of a node (modes of its ancestors and page applied)
//     .page(pageId)             resolved top-level nodes of a page
//     .modesAt(id)              active modes at a stored node
//     .variable(id, modes)      concrete value of a variable (aliases followed), undefined when it cannot be resolved
//     .value(v, modes)          a literal, or the value of a binding
//     .cssName(id)              custom property name of a variable ("--color-bg-surface")
//     .warnings                 problems met while resolving ({ code, key, message }), never thrown
//   resolve(model, id, opts?) / resolvePage(model, pageId, opts?)   one-shot helpers
//   cssVarName(item) / slug(name)
//   pickVariant(model, target, variant) → component node | null
//   expandInstance                                     the default instance hook (see below)
//
// Options
//   modes          { collectionId: modeId } applied at the page level (render a frame in dark mode)
//   instance       (ctx, inst) → { node, children } | null     hook that expands an instance (default: expandInstance)
//   applyStyles    (ctx, node) → node                         hook that applies style references (default: applyStyles)
//   variableValue  (ctx, varId, modes) → value | undefined    hook that looks up a variable value (default: built in)
//   maxDepth       nesting limit of the resolved tree (default 128)
//
// Scope of T2 (the hooks are where T5 continues): variables resolve per mode (node → ancestors → page → collection
// default) and follow aliases; extending collections are not applied yet. Instances get a baseline expansion: the
// variant of a set is picked, the main component's layers become virtual children, and overrides (`over`) apply by
// source-id path, also through nested instances. Component properties (`props`, `bind`), instance swap, slots,
// detaching and resolution caches come with T5.
import { field } from "./schema.js";
import { indexOf, pageKey, ancestors } from "./tree.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isBinding = (v) => isObj(v) && typeof v.$var === "string" && Object.keys(v).length === 1;

/** Fields that are never variable-resolved (structure, component data handled by the instance hook, interactions). */
const SKIP = new Set(["id", "type", "page", "parent", "ord", "proto", "props", "variant", "bind", "of", "over", "code", "a11y", "tag"]);
/** Fields of a main component that an instance does not inherit (identity and component definitions). */
const NOT_INHERITED = new Set(["id", "type", "name", "page", "parent", "ord", "x", "y", "pos", "cx", "cy", "cell", "sticky", "props", "variant", "bind", "of", "over", "code", "proto"]);
/** Instance fields that are not node fields of the expanded root. */
const INSTANCE_ONLY = new Set(["of", "variant", "props", "over"]);

/** Lower-case, dash-separated name for CSS ("color/bg/surface" → "color-bg-surface"). */
export function slug(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The custom property of a variable: its `code.css` name, else "--" + the slug of its name. */
export function cssVarName(item, id = "") {
  const own = item?.code?.css;
  if (typeof own === "string" && /^--[A-Za-z0-9_-]+$/.test(own)) return own;
  const s = slug(item?.name);
  return `--${s || slug(id) || "var"}`;
}

/**
 * The component an instance of `target` renders: `target` itself for a single component, else the component of the set
 * whose variant values match `variant` merged over the set's defaults (the best partial match, then the first one).
 */
export function pickVariant(model, target, variant = null) {
  if (!isObj(target)) return null;
  let set = null;
  if (target.type === "componentSet") set = target;
  else if (target.type === "component") {
    const p = target.parent != null ? model.nodes[target.parent] : null;
    if (!isObj(p) || p.type !== "componentSet") return target;
    set = p;
    // an instance of one variant keeps that variant's values unless it sets others
    variant = { ...(isObj(target.variant) ? target.variant : {}), ...(isObj(variant) ? variant : {}) };
  } else return null;
  const want = {};
  for (const [axis, d] of Object.entries(isObj(set.props) ? set.props : {})) if (isObj(d) && d.type === "variant" && d.default !== undefined) want[axis] = d.default;
  Object.assign(want, isObj(variant) ? variant : {});
  const comps = indexOf(model)
    .get(set.id)
    .map((id) => model.nodes[id])
    .filter((n) => isObj(n) && n.type === "component");
  let best = null;
  let score = -1;
  for (const c of comps) {
    const v = isObj(c.variant) ? c.variant : {};
    let s = 0;
    for (const [axis, value] of Object.entries(want)) if (v[axis] === value) s++;
    if (s > score) (best = c), (score = s);
  }
  return best;
}

/** Applies a node's style references (text, effect, fill and stroke) over its local fields: the style wins. */
export function applyStyles(ctx, node) {
  const refs = node.style;
  if (!isObj(refs)) return node;
  const styles = isObj(ctx.model.styles) ? ctx.model.styles : {};
  const get = (slot, kind) => {
    const s = typeof refs[slot] === "string" ? styles[refs[slot]] : null;
    return isObj(s) && s.kind === kind ? s.value : undefined;
  };
  let out = node;
  const set = (k, v) => {
    if (out === node) out = { ...node };
    out[k] = v;
  };
  const text = get("text", "text");
  if (isObj(text) && isObj(node.text)) set("text", { ...node.text, style: { ...(isObj(node.text.style) ? node.text.style : {}), ...text } });
  const effects = get("effect", "effect");
  if (Array.isArray(effects)) set("effects", effects);
  const fills = get("fill", "fill");
  if (Array.isArray(fills)) set("fills", fills);
  const strokeFill = get("stroke", "fill");
  if (Array.isArray(strokeFill) && Array.isArray(out.strokes)) {
    const solid = strokeFill.find((f) => isObj(f) && f.type === "solid" && f.visible !== false);
    if (solid) set("strokes", out.strokes.map((s) => (isObj(s) ? { ...s, color: solid.color } : s)));
  }
  return out;
}

/**
 * The default instance hook (T2 baseline): the main component's fields under the instance's own fields, and the
 * component's layers as children. Returns null when the component cannot be found (library references, removed
 * components); the instance then resolves as an empty container.
 * @returns {{ node: object, source: object, children: string[] } | null}
 */
export function expandInstance(ctx, inst) {
  const target = typeof inst.of === "string" ? ctx.model.nodes[inst.of] : null;
  const comp = pickVariant(ctx.model, target, inst.variant);
  if (!comp) return null;
  const node = {};
  for (const [k, v] of Object.entries(comp)) if (!NOT_INHERITED.has(k)) node[k] = v;
  for (const [k, v] of Object.entries(inst)) if (!INSTANCE_ONLY.has(k)) node[k] = v;
  node.type = "instance";
  return { node, source: comp, children: indexOf(ctx.model).get(comp.id) };
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

/**
 * Creates a resolver for one model revision.
 * @param {object} model
 * @param {{ modes?: Record<string,string>, instance?: Function, applyStyles?: Function, variableValue?: Function, maxDepth?: number }} [opts]
 */
export function createResolver(model, opts = {}) {
  const items = isObj(model?.vars?.items) ? model.vars.items : {};
  const colls = isObj(model?.vars?.collections) ? model.vars.collections : {};
  const maxDepth = opts.maxDepth ?? 128;
  const instanceHook = opts.instance || expandInstance;
  const stylesHook = opts.applyStyles || applyStyles;
  const warnings = [];
  const warn = (code, key, message) => {
    if (warnings.length < 1000) warnings.push({ code, key, message });
  };

  /** The mode of `collId` in `modes`, else the collection's default, else its first mode. */
  const modeOf = (collId, modes) => {
    const c = colls[collId];
    if (!isObj(c)) return undefined;
    const list = Array.isArray(c.modes) ? c.modes.map((m) => m?.id) : [];
    const m = modes?.[collId];
    if (m !== undefined && list.includes(m)) return m;
    if (c.default !== undefined && list.includes(c.default)) return c.default;
    return list[0];
  };

  const builtinValue = (ctx, id, modes) => {
    const seen = new Set();
    let cur = id;
    while (!seen.has(cur)) {
      seen.add(cur);
      const item = items[cur];
      if (!isObj(item) || !isObj(item.values)) return undefined;
      const mode = modeOf(item.coll, modes);
      let v = mode !== undefined ? item.values[mode] : undefined;
      if (v === undefined) {
        const c = colls[item.coll];
        v = isObj(c) && c.default !== undefined ? item.values[c.default] : undefined;
        if (v === undefined) v = Object.values(item.values)[0];
      }
      if (!isBinding(v)) return v;
      cur = v.$var;
    }
    return undefined; // alias cycle (validate.js rejects these)
  };

  const ctx = {
    model,
    warnings,
    modeOf,
    variable(id, modes = {}) {
      const v = opts.variableValue ? opts.variableValue(ctx, id, modes) : builtinValue(ctx, id, modes);
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
      let modes = { ...(isObj(model.pages?.[n.page]?.modes) ? model.pages[n.page].modes : {}), ...(opts.modes || {}) };
      for (const a of chain) if (isObj(model.nodes[a]?.modes)) modes = { ...modes, ...model.nodes[a].modes };
      return modes;
    },
    tree(id) {
      const n = model.nodes[id];
      if (!isObj(n)) return null;
      const parentModes = n.parent != null ? ctx.modesAt(n.parent) : { ...(isObj(model.pages?.[n.page]?.modes) ? model.pages[n.page].modes : {}), ...(opts.modes || {}) };
      return build(n, id, null, parentModes, null, [], [], [], 0);
    },
    page(pageId) {
      const page = model.pages?.[pageId];
      const modes = { ...(isObj(page?.modes) ? page.modes : {}), ...(opts.modes || {}) };
      return indexOf(model)
        .get(pageKey(pageId))
        .map((id) => build(model.nodes[id], id, null, modes, null, [], [], [], 0))
        .filter(Boolean);
    },
  };

  /**
   * @param {object} stored   the stored node (or the instance-expanded node)
   * @param {string} key
   * @param {string|null} parentKeyStr
   * @param {object} parentModes
   * @param {string|null} instKey  the instance this layer belongs to
   * @param {string[]} srcPath     source ids from the outermost instance's component down to this layer
   * @param {{ start: number, over: object }[]} scopes   override maps of the enclosing instances, innermost last
   * @param {string[]} comps       component ids being expanded (cycle guard)
   */
  function build(stored, key, parentKeyStr, parentModes, instKey, srcPath, scopes, comps, depth) {
    if (!isObj(stored)) return null;
    if (depth > maxDepth) {
      warn("depth", key, "The layer is nested too deeply to resolve.");
      return null;
    }
    // overrides: innermost scope first, outer instances win
    let node = stored;
    for (let i = scopes.length - 1; i >= 0; i--) {
      const sc = scopes[i];
      const over = sc.over[srcPath.slice(sc.start).join("/")];
      if (isObj(over)) node = { ...node, ...over };
    }
    let kids = indexOf(model).get(stored.id);
    let childScopes = scopes;
    let childComps = comps;
    let instance = instKey;
    if (node.type === "instance") {
      const compId = isObj(model.nodes[node.of]) ? node.of : null;
      const cyclic = compId !== null && comps.includes(compId);
      const over = node.over;
      const exp = cyclic ? null : instanceHook(ctx, node);
      if (cyclic) warn("component-cycle", key, "An instance contains itself.");
      if (exp) {
        node = { ...exp.node, id: stored.id };
        kids = exp.children || [];
        // overrides inside this instance are keyed by the source-id path below it
        if (isObj(over)) childScopes = [...scopes, { start: srcPath.length, over }];
        if (exp.source) {
          const set = exp.source.parent != null && model.nodes[exp.source.parent]?.type === "componentSet" ? [exp.source.parent] : [];
          childComps = [...comps, exp.source.id, ...set];
        }
        instance = key;
      } else {
        kids = [];
        if (!cyclic) warn("missing-component", key, `The component “${node.of}” is not available.`);
      }
    }
    const modes = isObj(node.modes) ? { ...parentModes, ...node.modes } : parentModes;
    node = stylesHook(ctx, node);
    const bound = {};
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = SKIP.has(k) ? v : bindDeep(ctx, v, modes, k, bound);
    const r = {
      key,
      id: stored.id,
      type: out.type,
      node: out,
      children: [],
      modes,
      bound: Object.keys(bound).length ? bound : null,
      instance: instKey,
      parent: parentKeyStr,
    };
    const expanded = instance !== instKey;
    for (const cid of kids) {
      const c = model.nodes[cid];
      if (!isObj(c)) continue;
      const inside = expanded || instKey !== null;
      const childKey = inside ? `${key}/${cid}` : cid;
      const path = inside ? [...srcPath, cid] : [];
      const rc = build(c, childKey, key, modes, expanded ? key : instKey, path, childScopes, childComps, depth + 1);
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

/** A field of a resolved node with its schema default. */
export const rfield = (r, key) => field(r.node, key);
