// Variables, modes, extending collections and styles of the Proto model (docs/concepts/proto-studio.md §3.4, task T5).
// Pure: no DOM, imports in plain Node.
//
// Model (vars):
//   collections: { id: { name, modes: [{ id, name }], default?, extends?, description? } }
//   items:       { id: { name, coll, type, values: { modeId: value | { $var } }, unit?, scopes?, code?, description?,
//                        ext?: { extendingCollectionId: { modeId: value | { $var } } } } }
//
// * Extending collections. A collection with `extends` is a brand or theme of its base: it has the base's modes (same
//   ids; the mode operations keep the lists in step) and overrides some values of the base's variables. The overrides
//   live on the variable, in `ext[<extending collection>][<mode>]`, so one variable stays one collaboration record.
//   Collections that extend each other form a *family* (the root and every collection that extends it, directly or
//   not); variables may also belong to an extending collection itself.
// * Mode selection. A node (or page, or the resolver) selects a mode per collection: `modes: { c1: "dark" }`. Selecting
//   a collection of a family also selects the family: `{ c2: "light" }` means "brand B (c2), light mode" for every
//   variable of the family. Deeper selections replace the inherited selection of the same family (`mergeModes`), and
//   inside one `modes` object the most derived collection wins. That is the CSS cascade of `data-mode-*` attributes.
// * Value lookup (`variableValue`): the selected collection and mode of the variable's family; the first override on
//   the way from the selected collection down to the variable's collection; else the variable's own value in that
//   mode; else its collection's default mode; else its first value. Aliases (`{ $var }`) are followed in the same modes.
// * Scopes restrict which fields a variable may be bound to (`SCOPES`, `scopeOf`, `canBind`); no scopes (or "all")
//   allows every field.
// * Styles are composite tokens: `text` (a partial text style), `effect` (a list of effects), `fill` (a list of fills;
//   also usable for strokes through the `stroke` slot) and `grid` (a CSS grid definition: tracks, areas, flow, gaps;
//   a container with a grid style becomes a grid). The style wins over the local fields (`applyStyleRefs`); detaching
//   bakes the style into the local fields (`bakeStyle`).
//
// Public API (helpers)
//   slug(name) / cssVarName(item, id)
//   chainOf(colls, id) / rootOf(colls, id) / familyOf(colls, id) / modeIdsOf(colls, id)
//   mergeModes(colls, parent, own) / selection(colls, modes, collId) → { sel, mode }
//   rawValue(model, id, modes) / variableValue(model, id, modes) / modesAtNode(model, id)
//   SCOPES / scopeOf(path) / canBind(item, path)
//   bindingsIn(value, path?) / variableRefs(model, ids) / mapBindings(value, fn)
//   applyStyleRefs(model, node) / bakeStyle(model, node, slot) / styleValueFrom(node, kind) / styleRefs(model, ids)
//   defaultValue(type)
// Operations (registered in ops.js; each returns an exact `restore` inverse):
//   collection.create / collection.update / collection.delete
//   mode.create / mode.update / mode.delete
//   var.create / var.update / var.delete / node.bind
//   style.create / style.update / style.delete / style.apply / style.detach
import { newId, isId, ID_PREFIX } from "./ids.js";
import { VAR_TYPES, STYLE_KINDS, STYLE_SLOTS, UPDATABLE_FIELDS, LIMITS, isContainer } from "./schema.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
export const isBinding = (v) => isObj(v) && typeof v.$var === "string" && Object.keys(v).length === 1;

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
  const c = item?.code?.css;
  if (typeof c === "string" && /^--[A-Za-z0-9_-]+$/.test(c)) return c;
  const s = slug(item?.name);
  return `--${s || slug(id) || "var"}`;
}

const collsOf = (model) => (isObj(model?.vars?.collections) ? model.vars.collections : {});
const itemsOf = (model) => (isObj(model?.vars?.items) ? model.vars.items : {});

// ------------------------------------------------------------------------------------------------- families

/** The collection and its bases, most derived first (stops at a missing collection or a cycle). */
export function chainOf(colls, id) {
  const out = [];
  let cur = id;
  while (cur != null && isObj(colls[cur]) && !out.includes(cur)) {
    out.push(cur);
    cur = colls[cur].extends ?? null;
  }
  return out;
}

/** The root of a collection's family. */
export const rootOf = (colls, id) => {
  const c = chainOf(colls, id);
  return c.length ? c[c.length - 1] : id;
};

/** Every collection of the family of `id` (the root first, then by depth and id). */
export function familyOf(colls, id) {
  const root = rootOf(colls, id);
  return Object.keys(colls)
    .filter((k) => rootOf(colls, k) === root)
    .sort((a, b) => chainOf(colls, a).length - chainOf(colls, b).length || (a < b ? -1 : a > b ? 1 : 0));
}

/** Mode ids of a collection. */
export const modeIdsOf = (colls, id) => (Array.isArray(colls[id]?.modes) ? colls[id].modes.map((m) => m?.id).filter((m) => typeof m === "string") : []);

/**
 * Active modes below a node that selects `own`: the parent's selections, where a selection in `own` replaces the
 * inherited selection of the same family; inside `own`, the most derived collection of a family wins.
 */
export function mergeModes(colls, parent, own) {
  if (!isObj(own)) return parent || {};
  const keys = Object.keys(own);
  if (!keys.length) return parent || {};
  const out = { ...(parent || {}) };
  const sorted = keys.slice().sort((a, b) => chainOf(colls, a).length - chainOf(colls, b).length);
  for (const k of sorted) {
    const root = rootOf(colls, k);
    for (const p of Object.keys(out)) if (p !== k && rootOf(colls, p) === root) delete out[p];
    out[k] = own[k];
  }
  return out;
}

/** The selected collection of the family of `collId` in `modes` and the mode that applies to `collId`. */
export function selection(colls, modes, collId) {
  const c = colls[collId];
  if (!isObj(c)) return { sel: null, mode: undefined };
  const root = rootOf(colls, collId);
  let sel = null;
  if (isObj(modes))
    for (const k of Object.keys(modes)) {
      if (!isObj(colls[k]) || rootOf(colls, k) !== root) continue;
      if (sel === null || chainOf(colls, k).length > chainOf(colls, sel).length) sel = k;
    }
  const list = modeIdsOf(colls, collId);
  const want = sel !== null ? modes[sel] : undefined;
  if (want !== undefined && list.includes(want)) return { sel, mode: want };
  for (const x of chainOf(colls, collId)) if (colls[x].default !== undefined && list.includes(colls[x].default)) return { sel, mode: colls[x].default };
  return { sel, mode: list[0] };
}

/** The value of a variable in `modes` without following an alias (may be a binding), or undefined. */
export function rawValue(model, id, modes = {}) {
  const colls = collsOf(model);
  const item = itemsOf(model)[id];
  if (!isObj(item) || !isObj(item.values)) return undefined;
  const { sel, mode } = selection(colls, modes, item.coll);
  if (mode === undefined) return Object.values(item.values)[0];
  if (sel !== null && sel !== item.coll && isObj(item.ext)) {
    const chain = chainOf(colls, sel);
    const at = chain.indexOf(item.coll);
    if (at > 0)
      for (const x of chain.slice(0, at)) {
        const o = item.ext[x];
        if (isObj(o) && o[mode] !== undefined) return o[mode];
      }
  }
  let v = item.values[mode];
  if (v === undefined) {
    const d = colls[item.coll]?.default;
    if (d !== undefined) v = item.values[d];
    if (v === undefined) v = Object.values(item.values)[0];
  }
  return v;
}

/** The concrete value of a variable in `modes`, aliases followed in the same modes; undefined on a cycle or gap. */
export function variableValue(model, id, modes = {}) {
  const seen = new Set();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const v = rawValue(model, cur, modes);
    if (!isBinding(v)) return v;
    cur = v.$var;
  }
  return undefined;
}

/** Active modes at a stored node: the page's, then every ancestor's and the node's own selections. */
export function modesAtNode(model, id, base = {}) {
  const colls = collsOf(model);
  const n = model?.nodes?.[id];
  if (!isObj(n)) return { ...base };
  const chain = [];
  const seen = new Set();
  let cur = id;
  while (cur != null && isObj(model.nodes[cur]) && !seen.has(cur)) {
    seen.add(cur);
    chain.push(model.nodes[cur]);
    cur = model.nodes[cur].parent;
  }
  let modes = mergeModes(colls, base, model.pages?.[n.page]?.modes);
  for (const x of chain.reverse()) modes = mergeModes(colls, modes, x.modes);
  return modes;
}

/** A neutral value of a variable type. */
export const defaultValue = (type) => (type === "color" ? "#000000" : type === "number" ? 0 : type === "bool" ? false : "");

// ------------------------------------------------------------------------------------------------- scopes

/** Binding scopes (like a design tool's variable scopes): which fields a variable may be bound to. */
export const SCOPES = Object.freeze(["all", "fill", "stroke", "effect", "text", "content", "size", "gap", "padding", "radius", "opacity", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "font", "visibility", "other"]);

/** The scope of a field path ("fills.0.color" → "fill"). */
export function scopeOf(path) {
  const s = String(path).split(".");
  const [a, b] = s;
  const last = s[s.length - 1];
  if (a === "fills") return "fill";
  if (a === "strokes") return last === "color" ? "stroke" : "other";
  if (a === "effects") return last === "color" ? "effect" : "other";
  if (a === "w" || a === "h") return "size";
  if (a === "radius") return "radius";
  if (a === "opacity") return "opacity";
  if (a === "visible") return "visibility";
  if (a === "layout") return b === "pad" ? "padding" : b === "gap" || b === "rowGap" ? "gap" : "other";
  if (a === "text") {
    if (last === "t") return "content";
    return { color: "text", size: "fontSize", weight: "fontWeight", lineHeight: "lineHeight", px: "lineHeight", tracking: "letterSpacing", font: "font" }[last] || "other";
  }
  return "other";
}

/** True when the variable's scopes allow binding it at `path`. */
export function canBind(item, path) {
  const sc = item?.scopes;
  if (!Array.isArray(sc) || !sc.length || sc.includes("all")) return true;
  return sc.includes(scopeOf(path));
}

// ------------------------------------------------------------------------------------------------- references

/** Every binding inside `value`: [[path, varId]]. */
export function bindingsIn(value, path = "", out = []) {
  if (isBinding(value)) out.push([path, value.$var]);
  else if (Array.isArray(value)) value.forEach((x, i) => bindingsIn(x, path ? `${path}.${i}` : String(i), out));
  else if (isObj(value)) for (const k of Object.keys(value)) bindingsIn(value[k], path ? `${path}.${k}` : k, out);
  return out;
}

/** A copy of `value` with every binding replaced by `fn(varId, path)` (return the binding to keep it). */
export function mapBindings(value, fn, path = "") {
  if (isBinding(value)) return fn(value.$var, path);
  if (Array.isArray(value)) {
    let out = value;
    value.forEach((x, i) => {
      const y = mapBindings(x, fn, path ? `${path}.${i}` : String(i));
      if (y !== x) {
        if (out === value) out = value.slice();
        out[i] = y;
      }
    });
    return out;
  }
  if (isObj(value)) {
    let out = value;
    for (const k of Object.keys(value)) {
      const y = mapBindings(value[k], fn, path ? `${path}.${k}` : k);
      if (y !== value[k]) {
        if (out === value) out = { ...value };
        out[k] = y;
      }
    }
    return out;
  }
  return value;
}

const NODE_SKIP = new Set(["id", "type", "page", "parent", "ord", "proto"]);

/**
 * Where the variables `ids` (a Set) are used: nodes (binding paths, also inside instance overrides and properties),
 * pages, styles and other variables (aliases).
 * @returns {{ nodes: string[], pages: string[], styles: string[], items: string[] }}
 */
export function variableRefs(model, ids) {
  const hit = (v) => bindingsIn(v).some(([, id]) => ids.has(id));
  const out = { nodes: [], pages: [], styles: [], items: [] };
  for (const [id, n] of Object.entries(model?.nodes || {})) {
    if (!isObj(n)) continue;
    for (const k of Object.keys(n))
      if (!NODE_SKIP.has(k) && hit(n[k])) {
        out.nodes.push(id);
        break;
      }
  }
  for (const [id, p] of Object.entries(model?.pages || {})) if (isObj(p) && hit(p.bg)) out.pages.push(id);
  for (const [id, s] of Object.entries(isObj(model?.styles) ? model.styles : {})) if (isObj(s) && hit(s.value)) out.styles.push(id);
  for (const [id, v] of Object.entries(itemsOf(model))) if (!ids.has(id) && isObj(v) && (hit(v.values) || hit(v.ext))) out.items.push(id);
  return out;
}

// ------------------------------------------------------------------------------------------------- styles

/** Node style slot of a style kind (the `stroke` slot also takes fill styles). */
export const slotOfKind = (kind) => (kind === "fill" ? "fill" : kind);

/** Nodes whose style references use one of the styles `ids` (a Set): [[nodeId, slot]]. */
export function styleRefs(model, ids) {
  const out = [];
  for (const [id, n] of Object.entries(model?.nodes || {})) {
    if (!isObj(n) || !isObj(n.style)) continue;
    for (const [slot, ref] of Object.entries(n.style)) if (STYLE_SLOTS[slot] && ids.has(ref)) out.push([id, slot]);
  }
  return out;
}

const GRID_KEYS = ["cols", "rows", "areas", "autoFlow", "dense"];

/** Applies one style value to a node's local fields (the style wins). Returns the node or a changed copy. */
function applySlot(node, slot, s) {
  if (!isObj(s) || s.kind !== STYLE_SLOTS[slot]) return node;
  const v = s.value;
  if (slot === "text") {
    if (!isObj(v) || !isObj(node.text)) return node;
    return { ...node, text: { ...node.text, style: { ...(isObj(node.text.style) ? node.text.style : {}), ...v } } };
  }
  if (slot === "effect") return Array.isArray(v) ? { ...node, effects: v } : node;
  if (slot === "fill") return Array.isArray(v) ? { ...node, fills: v } : node;
  if (slot === "stroke") {
    if (!Array.isArray(v) || !Array.isArray(node.strokes)) return node;
    const solid = v.find((f) => isObj(f) && f.type === "solid" && f.visible !== false);
    return solid ? { ...node, strokes: node.strokes.map((x) => (isObj(x) ? { ...x, color: solid.color } : x)) } : node;
  }
  if (slot === "grid") {
    if (!isObj(v) || !isContainer(node.type)) return node;
    const layout = { ...(isObj(node.layout) ? node.layout : {}), type: "grid" };
    const grid = { ...(isObj(layout.grid) ? layout.grid : {}) };
    for (const k of GRID_KEYS) if (v[k] !== undefined) grid[k] = v[k];
    if (!Array.isArray(grid.cols)) grid.cols = [{ fr: 1 }];
    layout.grid = grid;
    if (v.gap !== undefined) layout.gap = v.gap;
    if (v.rowGap !== undefined) layout.rowGap = v.rowGap;
    return { ...node, layout };
  }
  return node;
}

/** Applies every style reference of a node over its local fields (the resolver's default `applyStyles`). */
export function applyStyleRefs(model, node) {
  const refs = node?.style;
  if (!isObj(refs)) return node;
  const styles = isObj(model?.styles) ? model.styles : {};
  let out = node;
  for (const slot of ["text", "effect", "fill", "stroke", "grid"]) {
    const id = refs[slot];
    if (typeof id === "string") out = applySlot(out, slot, styles[id]);
  }
  return out;
}

/** The node with the style of `slot` baked into its local fields and the reference removed. */
export function bakeStyle(model, node, slot) {
  const id = node?.style?.[slot];
  let out = typeof id === "string" ? applySlot(node, slot, model?.styles?.[id]) : node;
  if (!isObj(out.style) || !own(out.style, slot)) return out;
  const { [slot]: _gone, ...rest } = out.style;
  out = { ...out };
  if (Object.keys(rest).length) out.style = rest;
  else delete out.style;
  return out;
}

/** A style value of `kind` taken from a node's local fields, or undefined when the node has none. */
export function styleValueFrom(node, kind) {
  if (kind === "text") return isObj(node.text?.style) ? structuredClone(node.text.style) : undefined;
  if (kind === "effect") return Array.isArray(node.effects) ? structuredClone(node.effects) : undefined;
  if (kind === "fill") return Array.isArray(node.fills) ? structuredClone(node.fills) : undefined;
  if (kind === "grid") {
    const l = node.layout;
    if (!isObj(l) || l.type !== "grid" || !isObj(l.grid)) return undefined;
    const v = {};
    for (const k of GRID_KEYS) if (l.grid[k] !== undefined) v[k] = structuredClone(l.grid[k]);
    if (l.gap !== undefined) v.gap = structuredClone(l.gap);
    if (l.rowGap !== undefined) v.rowGap = structuredClone(l.rowGap);
    return v;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------------- operations

/**
 * Operation handlers of variables, modes and styles. `kit` comes from ops.js: { OpError, runOp, patch, clone }.
 * Every handler runs inside `d.record`, so its inverse is one exact `restore`.
 */
export function variableOps(kit) {
  const { OpError, patch, clone } = kit;

  const needColl = (d, id) => {
    const c = collsOf(d.m)[id];
    if (!isObj(c)) throw new OpError("not-found", `The variable collection “${id}” does not exist.`);
    return c;
  };
  const needItem = (d, id) => {
    const v = itemsOf(d.m)[id];
    if (!isObj(v)) throw new OpError("not-found", `The variable “${id}” does not exist.`);
    return v;
  };
  const needStyle = (d, id) => {
    const s = isObj(d.m.styles) ? d.m.styles[id] : undefined;
    if (!isObj(s)) throw new OpError("not-found", `The style “${id}” does not exist.`);
    return s;
  };
  const name = (v, what) => {
    if (typeof v !== "string" || !v.trim() || v.length > LIMITS.nameLength) throw new OpError("bad-op", `${what} needs a name (up to ${LIMITS.nameLength} characters).`);
    return v;
  };
  const freshId = (d, prefix, taken, want) => {
    if (want != null) {
      if (!isId(want)) throw new OpError("id", `“${want}” is not a valid id.`);
      if (taken(want)) throw new OpError("exists", `The id “${want}” is already used.`);
      return want;
    }
    return newId(prefix, taken, d.random);
  };
  const ids = (v, what) => {
    const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : null;
    if (!list || !list.length || !list.every((x) => typeof x === "string")) throw new OpError("bad-op", `\`ids\` must be a non-empty list of ${what} ids.`);
    return [...new Set(list)];
  };
  const modeIdFor = (d, colls, collId, want, nm) => {
    const taken = (x) => modeIdsOf(colls, collId).includes(x);
    if (want != null) {
      if (!isId(want)) throw new OpError("id", `“${want}” is not a valid mode id.`);
      if (taken(want)) throw new OpError("exists", `The mode “${want}” already exists.`);
      return want;
    }
    const s = slug(nm).replace(/-+/g, "-");
    if (isId(s) && !taken(s)) return s;
    for (let i = 2; i < 1000; i++) if (!taken(`mode${i}`)) return `mode${i}`;
    return newId("m", taken, d.random);
  };

  /** Replaces bindings to deleted variables by concrete values (in each user's own modes). */
  function detachVars(d, gone) {
    const model = d.m;
    const literal = (varId, modes, type) => {
      const v = variableValue(model, varId, modes);
      return v === undefined || isBinding(v) ? defaultValue(type ?? itemsOf(model)[varId]?.type) : clone(v);
    };
    const refs = variableRefs(model, gone);
    for (const id of refs.nodes) {
      const n = d.node(id);
      const modes = modesAtNode(model, id);
      const next = {};
      for (const k of Object.keys(n)) next[k] = NODE_SKIP.has(k) ? n[k] : mapBindings(n[k], (v) => (gone.has(v) ? literal(v, modes) : { $var: v }));
      d.put(next);
    }
    for (const id of refs.pages) {
      const p = d.page(id);
      d.putPage({ ...p, bg: mapBindings(p.bg, (v) => (gone.has(v) ? literal(v, p.modes || {}) : { $var: v })) });
    }
    for (const id of refs.styles) {
      const s = d.m.styles[id];
      d.putStyle(id, { ...s, value: mapBindings(s.value, (v) => (gone.has(v) ? literal(v, {}) : { $var: v })) });
    }
    for (const id of refs.items) {
      const item = itemsOf(d.m)[id];
      const values = {};
      for (const [m, val] of Object.entries(item.values || {})) values[m] = isBinding(val) && gone.has(val.$var) ? literal(val.$var, { [item.coll]: m }, item.type) : val;
      const next = { ...item, values };
      if (isObj(item.ext)) {
        next.ext = {};
        for (const [c, o] of Object.entries(item.ext)) {
          next.ext[c] = {};
          for (const [m, val] of Object.entries(isObj(o) ? o : {})) next.ext[c][m] = isBinding(val) && gone.has(val.$var) ? literal(val.$var, { [c]: m }, item.type) : val;
        }
      }
      d.putItem(id, next);
    }
  }

  function refuseOrDetach(d, gone, detach, what) {
    const refs = variableRefs(d.m, gone);
    const n = refs.nodes.length + refs.pages.length + refs.styles.length + refs.items.length;
    if (!n) return;
    if (!detach) throw new OpError("in-use", `${what} is used by ${n} layer${n === 1 ? "" : "s"}, styles or variables; pass detach to replace the bindings by values.`);
    detachVars(d, gone);
  }

  /** Removes the selections of `colls` (or of one mode of them) from nodes and pages. */
  function dropSelections(d, colls, mode = null) {
    const fix = (modes) => {
      if (!isObj(modes)) return modes;
      let out = modes;
      for (const c of colls)
        if (own(out, c) && (mode === null || out[c] === mode)) {
          const { [c]: _gone, ...rest } = out;
          out = rest;
        }
      return out;
    };
    for (const n of Object.values(d.m.nodes)) {
      const next = fix(n.modes);
      if (next === n.modes) continue;
      const copy = { ...n };
      if (Object.keys(next).length) copy.modes = next;
      else delete copy.modes;
      d.put(copy);
    }
    for (const p of Object.values(d.m.pages)) {
      const next = fix(p.modes);
      if (next === p.modes) continue;
      const copy = { ...p };
      if (Object.keys(next).length) copy.modes = next;
      else delete copy.modes;
      d.putPage(copy);
    }
  }

  const H = {};

  H["collection.create"] = (d, op) =>
    d.record(() => {
      const colls = collsOf(d.m);
      const id = freshId(d, ID_PREFIX.collection, (x) => own(colls, x), op.id);
      const c = { name: name(op.name, "A collection") };
      if (op.extends != null) {
        const base = needColl(d, op.extends);
        c.extends = op.extends;
        c.modes = clone(base.modes || []);
        const def = op.default ?? base.default;
        if (def !== undefined) c.default = def;
      } else {
        const list = op.modes === undefined ? [{ name: "Default" }] : op.modes;
        if (!Array.isArray(list) || !list.length) throw new OpError("bad-op", "`modes` must be a non-empty list of { id?, name }.");
        c.modes = [];
        for (const m of list) {
          if (!isObj(m)) throw new OpError("bad-op", "A mode is { id?, name }.");
          const nm = name(m.name, "A mode");
          c.modes.push({ id: modeIdFor(d, { x: c }, "x", m.id, nm), name: nm });
        }
        c.default = op.default ?? c.modes[0].id;
      }
      if (op.description !== undefined) c.description = op.description;
      d.putColl(id, c);
      return [id];
    });

  H["collection.update"] = (d, op) =>
    d.record(() => {
      const c = needColl(d, op.id);
      const { next } = patch(c, op.set, op.unset, ["name", "default", "description"], "collection");
      if (next !== c) d.putColl(op.id, next);
      return [op.id];
    });

  H["collection.delete"] = (d, op) =>
    d.record(() => {
      const colls = collsOf(d.m);
      needColl(d, op.id);
      const ext = Object.keys(colls).filter((k) => k !== op.id && colls[k]?.extends === op.id);
      if (ext.length) throw new OpError("in-use", `The collection is extended by “${colls[ext[0]].name}”; delete that one first.`);
      const items = itemsOf(d.m);
      const gone = new Set(Object.keys(items).filter((k) => items[k]?.coll === op.id));
      refuseOrDetach(d, gone, op.detach, "A variable of this collection");
      for (const v of gone) d.putItem(v, null);
      // overrides this (extending) collection holds on variables of its family
      for (const [vid, item] of Object.entries(itemsOf(d.m)))
        if (isObj(item.ext) && own(item.ext, op.id)) {
          const { [op.id]: _gone, ...rest } = item.ext;
          const next = { ...item };
          if (Object.keys(rest).length) next.ext = rest;
          else delete next.ext;
          d.putItem(vid, next);
        }
      dropSelections(d, [op.id]);
      d.putColl(op.id, null);
      return [op.id];
    });

  H["mode.create"] = (d, op) =>
    d.record(() => {
      const colls = collsOf(d.m);
      const c = needColl(d, op.coll);
      if (c.extends != null) throw new OpError("extends", "An extending collection has the modes of its base; add the mode there.");
      const list = modeIdsOf(colls, op.coll);
      if (list.length >= LIMITS.modesPerCollection) throw new OpError("limit", `A collection can have at most ${LIMITS.modesPerCollection} modes.`);
      const nm = name(op.name, "A mode");
      const id = modeIdFor(d, colls, op.coll, op.id, nm);
      const from = op.from ?? c.default ?? list[0];
      if (!list.includes(from)) throw new OpError("not-found", `The collection has no mode “${from}”.`);
      const fam = familyOf(colls, op.coll);
      const at = op.index == null ? list.length : Math.max(0, Math.min(list.length, op.index | 0));
      for (const f of fam) {
        const cc = collsOf(d.m)[f];
        const modes = [...(cc.modes || [])];
        modes.splice(at, 0, { id, name: nm });
        d.putColl(f, { ...cc, modes });
      }
      const famSet = new Set(fam);
      for (const [vid, item] of Object.entries(itemsOf(d.m))) {
        if (!famSet.has(item.coll)) continue;
        const next = { ...item };
        if (isObj(item.values) && item.values[from] !== undefined) next.values = { ...item.values, [id]: clone(item.values[from]) };
        if (isObj(item.ext)) {
          next.ext = {};
          for (const [k, o] of Object.entries(item.ext)) next.ext[k] = isObj(o) && o[from] !== undefined ? { ...o, [id]: clone(o[from]) } : o;
        }
        d.putItem(vid, next);
      }
      return [id];
    });

  H["mode.update"] = (d, op) =>
    d.record(() => {
      const colls = collsOf(d.m);
      needColl(d, op.coll);
      if (!modeIdsOf(colls, op.coll).includes(op.id)) throw new OpError("not-found", `The collection has no mode “${op.id}”.`);
      const nm = name(op.name, "A mode");
      for (const f of familyOf(colls, op.coll)) {
        const cc = collsOf(d.m)[f];
        d.putColl(f, { ...cc, modes: cc.modes.map((m) => (m?.id === op.id ? { ...m, name: nm } : m)) });
      }
      return [op.id];
    });

  H["mode.delete"] = (d, op) =>
    d.record(() => {
      const colls = collsOf(d.m);
      const c = needColl(d, op.coll);
      if (c.extends != null) throw new OpError("extends", "An extending collection has the modes of its base; delete the mode there.");
      const list = modeIdsOf(colls, op.coll);
      if (!list.includes(op.id)) throw new OpError("not-found", `The collection has no mode “${op.id}”.`);
      if (list.length <= 1) throw new OpError("last-mode", "A collection needs at least one mode.");
      const fam = familyOf(colls, op.coll);
      const famSet = new Set(fam);
      for (const f of fam) {
        const cc = collsOf(d.m)[f];
        const next = { ...cc, modes: cc.modes.filter((m) => m?.id !== op.id) };
        if (next.default === op.id) next.default = next.modes[0].id;
        d.putColl(f, next);
      }
      for (const [vid, item] of Object.entries(itemsOf(d.m))) {
        if (!famSet.has(item.coll)) continue;
        const hasV = own(item.values, op.id);
        const hasE = isObj(item.ext) && Object.values(item.ext).some((o) => own(o, op.id));
        if (!hasV && !hasE) continue;
        const next = { ...item };
        if (hasV) {
          const { [op.id]: _gone, ...rest } = item.values;
          next.values = rest;
        }
        if (hasE) {
          next.ext = {};
          for (const [k, o] of Object.entries(item.ext)) {
            if (!own(o, op.id)) next.ext[k] = o;
            else {
              const { [op.id]: _gone, ...rest } = o;
              if (Object.keys(rest).length) next.ext[k] = rest;
            }
          }
          if (!Object.keys(next.ext).length) delete next.ext;
        }
        d.putItem(vid, next);
      }
      dropSelections(d, fam, op.id);
      return [op.id];
    });

  const checkName = (d, coll, nm, except = null) => {
    for (const [id, v] of Object.entries(itemsOf(d.m))) if (id !== except && v?.coll === coll && v.name === nm) throw new OpError("exists", `The collection already has a variable “${nm}”.`);
  };

  H["var.create"] = (d, op) =>
    d.record(() => {
      const colls = collsOf(d.m);
      needColl(d, op.coll);
      if (!VAR_TYPES.includes(op.type)) throw new OpError("type", `Unknown variable type “${op.type}”.`);
      const nm = name(op.name, "A variable");
      checkName(d, op.coll, nm);
      const items = itemsOf(d.m);
      if (Object.values(items).filter((v) => v?.coll === op.coll).length >= LIMITS.varsPerCollection) throw new OpError("limit", `A collection can have at most ${LIMITS.varsPerCollection} variables.`);
      const id = freshId(d, ID_PREFIX.variable, (x) => own(items, x), op.id);
      const values = {};
      // `values` per mode; modes it leaves out take `value` (one value for every mode) or a neutral value
      for (const m of modeIdsOf(colls, op.coll)) values[m] = clone(isObj(op.values) && op.values[m] !== undefined ? op.values[m] : op.value !== undefined ? op.value : defaultValue(op.type));
      const item = { name: nm, coll: op.coll, type: op.type, values };
      for (const k of ["unit", "scopes", "code", "description", "ext"]) if (op[k] !== undefined) item[k] = clone(op[k]);
      d.putItem(id, item);
      return [id];
    });

  H["var.update"] = (d, op) =>
    d.record(() => {
      const item = needItem(d, op.id);
      const { next } = patch(item, op.set, op.unset, ["name", "type", "values", "unit", "scopes", "code", "description", "ext"], "variable");
      if (next === item) return [op.id];
      if (next.name !== item.name) checkName(d, item.coll, name(next.name, "A variable"), op.id);
      if (next.type !== item.type) {
        const refs = variableRefs(d.m, new Set([op.id]));
        if (refs.nodes.length + refs.pages.length + refs.styles.length + refs.items.length) throw new OpError("in-use", "The type of a variable that is in use cannot change.");
      }
      d.putItem(op.id, next);
      return [op.id];
    });

  H["var.delete"] = (d, op) =>
    d.record(() => {
      const list = ids(op.ids ?? op.id, "variable");
      for (const id of list) needItem(d, id);
      const gone = new Set(list);
      refuseOrDetach(d, gone, op.detach, list.length === 1 ? "The variable" : "One of the variables");
      for (const id of list) d.putItem(id, null);
      return list;
    });

  // node.bind { id, path: "fills.0.color", var: id | null, force? } — bind one field (list items included) or unbind it
  H["node.bind"] = (d, op) =>
    d.record(() => {
      const n = d.need(op.id);
      if (typeof op.path !== "string" || !op.path) throw new OpError("path", "`path` is a field path such as “fills.0.color”.");
      const segs = op.path.split(".");
      if (!UPDATABLE_FIELDS.includes(segs[0]) || ["props", "variant", "bind", "of", "over", "code", "proto", "modes", "style", "name", "tag", "a11y"].includes(segs[0])) throw new OpError("field", `“${segs[0]}” cannot be bound to a variable.`);
      const get = (o, i) => {
        let v = o;
        for (const s of segs.slice(0, i)) v = Array.isArray(v) ? v[Number(s)] : isObj(v) ? v[s] : undefined;
        return v;
      };
      const cur = get(n, segs.length);
      let value;
      if (op.var == null) {
        if (!isBinding(cur)) return [n.id];
        const v = variableValue(d.m, cur.$var, modesAtNode(d.m, n.id));
        value = v === undefined || isBinding(v) ? defaultValue(itemsOf(d.m)[cur.$var]?.type) : clone(v);
      } else {
        const item = needItem(d, op.var);
        if (!op.force && !canBind(item, op.path)) throw new OpError("scope", `The variable “${item.name}” cannot be used for ${scopeOf(op.path)}.`);
        value = { $var: op.var };
      }
      const set = (o, i) => {
        const s = segs[i];
        if (i === segs.length - 1) {
          if (Array.isArray(o)) {
            const k = Number(s);
            if (!Number.isInteger(k) || k < 0 || k >= o.length) throw new OpError("path", `“${op.path}” is not in the layer.`);
            const a = o.slice();
            a[k] = value;
            return a;
          }
          return { ...(isObj(o) ? o : {}), [s]: value };
        }
        if (Array.isArray(o)) {
          const k = Number(s);
          if (!Number.isInteger(k) || k < 0 || k >= o.length || !isObj(o[k])) throw new OpError("path", `“${op.path}” is not in the layer.`);
          const a = o.slice();
          a[k] = set(o[k], i + 1);
          return a;
        }
        const child = isObj(o) ? o[s] : undefined;
        if (child !== undefined && !isObj(child) && !Array.isArray(child)) throw new OpError("path", `“${op.path}” is not in the layer.`);
        if (child === undefined && /^\d+$/.test(segs[i + 1])) throw new OpError("path", `“${op.path}” is not in the layer.`);
        return { ...(isObj(o) ? o : {}), [s]: set(child ?? {}, i + 1) };
      };
      d.put(set(n, 0));
      return [n.id];
    });

  // ---------------------------------------------------------------------------------------------- styles

  const styleValue = (kind, v) => {
    if (v === undefined) return kind === "text" ? {} : kind === "grid" ? { cols: [{ fr: 1 }] } : [];
    return clone(v);
  };

  H["style.create"] = (d, op) =>
    d.record(() => {
      if (!STYLE_KINDS.includes(op.kind)) throw new OpError("type", `Unknown style kind “${op.kind}”.`);
      const styles = isObj(d.m.styles) ? d.m.styles : {};
      const id = freshId(d, ID_PREFIX.style, (x) => own(styles, x), op.id);
      let value = op.value;
      let from = null;
      if (op.from != null) {
        from = d.need(op.from);
        value = styleValueFrom(from, op.kind);
        if (value === undefined) throw new OpError("style-source", `The layer has no ${op.kind} values to make a style from.`);
      }
      const s = { name: name(op.name, "A style"), kind: op.kind, value: styleValue(op.kind, value) };
      if (op.description !== undefined) s.description = op.description;
      d.putStyle(id, s);
      if (from && op.apply !== false) d.put({ ...d.node(from.id), style: { ...(isObj(from.style) ? from.style : {}), [slotOfKind(op.kind)]: id } });
      return [id];
    });

  H["style.update"] = (d, op) =>
    d.record(() => {
      const s = needStyle(d, op.id);
      const { next } = patch(s, op.set, op.unset, ["name", "value", "description", "code"], "style");
      if (next !== s) d.putStyle(op.id, next);
      return [op.id];
    });

  H["style.delete"] = (d, op) =>
    d.record(() => {
      const list = ids(op.ids ?? op.id, "style");
      for (const id of list) needStyle(d, id);
      const refs = styleRefs(d.m, new Set(list));
      if (refs.length && !op.detach) throw new OpError("in-use", `The style is used by ${refs.length} layer${refs.length === 1 ? "" : "s"}; pass detach to keep its values on them.`);
      for (const [nid, slot] of refs) d.put(bakeStyle(d.m, d.node(nid), slot));
      for (const id of list) d.putStyle(id, null);
      return list;
    });

  // style.apply { ids, slot, style: id | null } — reference a style (or remove the reference; local fields stay)
  H["style.apply"] = (d, op) =>
    d.record(() => {
      const list = ids(op.ids ?? op.id, "layer");
      if (!STYLE_SLOTS[op.slot]) throw new OpError("bad-op", `Unknown style slot “${op.slot}”.`);
      if (op.style != null) {
        const s = needStyle(d, op.style);
        if (s.kind !== STYLE_SLOTS[op.slot]) throw new OpError("style-kind", `A ${s.kind} style cannot be used as ${op.slot}.`);
      }
      for (const id of list) {
        const n = d.need(id);
        const refs = { ...(isObj(n.style) ? n.style : {}) };
        if (op.style == null) delete refs[op.slot];
        else refs[op.slot] = op.style;
        const next = { ...n };
        if (Object.keys(refs).length) next.style = refs;
        else delete next.style;
        d.put(next);
      }
      return list;
    });

  // style.detach { ids, slot? } — bake the style values into the layers and remove the references
  H["style.detach"] = (d, op) =>
    d.record(() => {
      const list = ids(op.ids ?? op.id, "layer");
      for (const id of list) {
        let n = d.need(id);
        const slots = op.slot != null ? [op.slot] : Object.keys(isObj(n.style) ? n.style : {}).filter((s) => STYLE_SLOTS[s]);
        for (const slot of slots) n = bakeStyle(d.m, n, slot);
        if (n !== d.node(id)) d.put(n);
      }
      return list;
    });

  return H;
}
