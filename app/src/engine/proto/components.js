// Components, variant sets, properties, instances, overrides, swap, slots and detaching (docs/concepts/proto-studio.md
// §3.3, task T5). Pure: no DOM, imports in plain Node.
//
// Model:
//   componentSet  { props: { name: def } }                    the variants are its `component` children
//   component     { variant?: { axis: option }, props?, bind?: { "<layerId>.<field>": propName } }
//   instance      { of, variant?, props?: { name: value }, over?: { "<id>/<id>": { field: value } } }
// Property definitions (`def.type`): variant (one axis of a set: options, default), text, bool, number, swap (a
// component or set; `preferred` lists the suggested ones), slot (a container whose children the instance provides).
//
// Semantics (the resolver implements them; resolve.js):
// * An instance renders the variant of its set that matches its `variant` over the set's defaults (`pickVariant`).
// * Property values: the instance's `props[name]`, else the definition's `default`. A binding `<layer>.<field>` of the
//   main component (the set's `bind`, then the variant's) writes the value into that field of the layer inside the
//   instance: a text property bound to `text` replaces the text content (keeping the first run's style), every other
//   binding sets the field (`visible` for booleans, `of` of a nested instance for swap properties, `opacity` for
//   numbers…). Bindings apply to the layers of the instance's own component, not to the inside of nested instances.
// * Overrides (`over`) apply after the properties, by source-id path, and outer instances win (resolve.js, T2).
// * Slots. The instance's own stored children are slot content. A slot property is connected to a `slot` layer of the
//   component by binding `<slotLayer>.children`; an unconnected slot property takes the first `slot` layer that no
//   other property took. `props[slotName]` may list child ids for that slot; children not listed go to the first slot
//   property. A slot without content shows the main component's default content.
// * Detaching materializes the resolved subtree with new ids: the instance becomes a frame with the merged fields;
//   layers keep their variable bindings and style references (they are not replaced by values); nested instances stay
//   instances, with the outer overrides that reached into them moved into their own `over`; slot content keeps its ids
//   and moves into the materialized slot frame.
//
// Public API (helpers)
//   setOf(model, comp) / propsOfTarget(model, id) / propOwner(model, id) / pickVariant(model, target, variant)
//   effectiveProps(defs, inst) / bindingsOf(model, comp) / applyBinds(node, list, defs, values)
//   slotTargets(model, comp, defs, binds) / slotContent(model, inst, kids, defs, targets)
//   swapOptions(model, id, prop) / variantAxes(model, id) / overridePaths(model, instId) / parseVariantName(name)
// Operations (registered in ops.js; inverses are exact `restore` operations):
//   component.create / component.combine / component.addVariant
//   prop.define / prop.rename / prop.delete / prop.bind
//   instance.create / instance.set / instance.swap / instance.override / instance.reset / instance.detach
import { indexOf } from "./tree.js";
import { PROP_TYPES, STRUCTURE_FIELDS, UPDATABLE_FIELDS } from "./schema.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const FIELD_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const PROP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_ -]{0,63}$/;

/** The component set a component belongs to, or null. */
export function setOf(model, comp) {
  const p = isObj(comp) && comp.parent != null ? model.nodes[comp.parent] : null;
  return isObj(p) && p.type === "componentSet" ? p : null;
}

/** The node that owns the property definitions of a component or set (the set for a variant), or null. */
export function propOwner(model, id) {
  const n = model?.nodes?.[id];
  if (!isObj(n)) return null;
  if (n.type === "componentSet") return n;
  if (n.type === "component") return setOf(model, n) || n;
  return null;
}

/** The property definitions an instance of `id` (a component or set) can set, or null. */
export function propsOfTarget(model, id) {
  const o = propOwner(model, id);
  return o ? (isObj(o.props) ? o.props : {}) : null;
}

/**
 * The component an instance of `target` renders: `target` itself for a single component, else the component of the set
 * whose variant values match `variant` merged over the set's defaults (the best partial match, then the first one).
 * `rec` (optional) is told every node and children list read, for the resolver's cache.
 */
export function pickVariant(model, target, variant = null, rec = null, memo = null) {
  if (!isObj(target)) return null;
  let set = null;
  if (target.type === "componentSet") set = target;
  else if (target.type === "component") {
    const p = target.parent != null ? model.nodes[target.parent] : null;
    if (rec && p) rec(p);
    if (!isObj(p) || p.type !== "componentSet") return target;
    set = p;
    // an instance of one variant keeps that variant's values unless it sets others
    variant = { ...(isObj(target.variant) ? target.variant : {}), ...(isObj(variant) ? variant : {}) };
  } else return null;
  const want = Object.assign({}, variantDefaults(set), isObj(variant) ? variant : null);
  const kids = indexOf(model).get(set.id);
  if (rec) rec(null, set.id, kids);
  // one resolver picks the same variant for many instances: memoized per set and wanted values
  let key = null;
  if (memo) {
    key = set.id;
    for (const axis of Object.keys(want)) key += `|${axis}=${want[axis]}`;
    if (memo.has(key)) {
      if (rec) for (const id of kids) rec(model.nodes[id] || { id });
      return memo.get(key);
    }
  }
  let best = null;
  let score = -1;
  for (const id of kids) {
    const c = model.nodes[id];
    if (rec) rec(c);
    if (!isObj(c) || c.type !== "component") continue;
    const v = isObj(c.variant) ? c.variant : {};
    let s = 0;
    for (const [axis, value] of Object.entries(want)) if (v[axis] === value) s++;
    if (s > score) (best = c), (score = s);
  }
  if (memo) memo.set(key, best);
  return best;
}

const defaultsCache = new WeakMap();
/** The default values of a set's variant axes (cached per set object). */
function variantDefaults(set) {
  let d = defaultsCache.get(set);
  if (!d) {
    d = {};
    for (const [axis, def] of Object.entries(isObj(set.props) ? set.props : {})) if (isObj(def) && def.type === "variant" && def.default !== undefined) d[axis] = def.default;
    defaultsCache.set(set, d);
  }
  return d;
}

const valueDefsCache = new WeakMap();
/** Property values of an instance: its own values over the definitions' defaults (variant and slot excluded). */
export function effectiveProps(defs, inst) {
  if (!isObj(defs)) return {};
  let list = valueDefsCache.get(defs);
  if (!list) {
    list = Object.entries(defs).filter(([, d]) => isObj(d) && d.type !== "variant" && d.type !== "slot");
    valueDefsCache.set(defs, list);
  }
  const out = {};
  const mine = isObj(inst?.props) ? inst.props : null;
  for (const [name, d] of list) {
    const v = mine && mine[name] !== undefined ? mine[name] : d.default;
    if (v !== undefined) out[name] = v;
  }
  return out;
}

const bindCache = new WeakMap();

/** Bindings of a component (its set's, then its own): Map layerId → [[field, propName]]. Cached per node identity. */
export function bindingsOf(model, comp) {
  const set = setOf(model, comp);
  const hit = bindCache.get(comp);
  if (hit && hit.set === set) return hit.map;
  const map = new Map();
  for (const src of [set?.bind, comp.bind])
    if (isObj(src))
      for (const [key, prop] of Object.entries(src)) {
        const dot = key.indexOf(".");
        if (dot < 1 || typeof prop !== "string") continue;
        const layer = key.slice(0, dot);
        const field = key.slice(dot + 1);
        if (!map.has(layer)) map.set(layer, []);
        const list = map.get(layer);
        const at = list.findIndex(([f]) => f === field);
        if (at >= 0) list[at] = [field, prop];
        else list.push([field, prop]);
      }
  bindCache.set(comp, { set, map });
  return map;
}

/** Writes bound property values into a layer (see the header). Returns the node or a changed copy. */
export function applyBinds(node, list, defs, values) {
  if (!list) return node;
  let out = node;
  const set = (k, v) => {
    if (out === node) out = { ...node };
    out[k] = v;
  };
  for (const [field, prop] of list) {
    const d = defs?.[prop];
    if (!isObj(d) || d.type === "variant" || d.type === "slot" || STRUCTURE_FIELDS.includes(field)) continue;
    const v = values[prop];
    if (v === undefined) continue;
    if (field === "text" && node.type === "text") {
      if (!isObj(out.text)) continue;
      const runs = Array.isArray(out.text.runs) ? out.text.runs : [];
      const style = isObj(runs[0]?.s) ? runs[0].s : {};
      set("text", { ...out.text, runs: [{ t: d.type === "text" || typeof v === "string" || isObj(v) ? v : String(v), s: style }] });
    } else if (field === "of" && node.type !== "instance") continue;
    else set(field, v);
  }
  return out;
}

/** Slot properties of a component and the slot layer each one fills: Map propName → layerId. */
export function slotTargets(model, comp, defs, binds) {
  const out = new Map();
  const names = Object.entries(isObj(defs) ? defs : {})
    .filter(([, d]) => isObj(d) && d.type === "slot")
    .map(([n]) => n);
  if (!names.length) return out;
  const taken = new Set();
  for (const [layer, list] of binds)
    for (const [field, prop] of list)
      if (field === "children" && names.includes(prop) && !out.has(prop) && model.nodes[layer]?.type === "slot") {
        out.set(prop, layer);
        taken.add(layer);
      }
  const free = [];
  if (names.some((n) => !out.has(n))) {
    const ix = indexOf(model);
    const stack = [...ix.get(comp.id)].reverse();
    while (stack.length) {
      const id = stack.pop();
      const n = model.nodes[id];
      if (!isObj(n)) continue;
      if (n.type === "slot" && !taken.has(id)) free.push(id);
      if (n.type === "instance") continue;
      const k = ix.get(id);
      for (let i = k.length - 1; i >= 0; i--) stack.push(k[i]);
    }
  }
  for (const n of names) if (!out.has(n) && free.length) out.set(n, free.shift());
  return out;
}

/** Slot content of an instance: Map slotLayerId → child ids, from its stored children `kids` (see the header). */
export function slotContent(model, inst, kids, defs, targets) {
  const out = new Map();
  if (!kids.length || !targets.size) return out;
  const placed = new Set();
  const mine = isObj(inst.props) ? inst.props : {};
  for (const [prop, layer] of targets) {
    const want = mine[prop];
    if (!Array.isArray(want)) continue;
    const ids = kids.filter((k) => want.includes(k) && !placed.has(k));
    for (const k of ids) placed.add(k);
    if (ids.length) out.set(layer, ids);
  }
  const rest = kids.filter((k) => !placed.has(k));
  if (rest.length) {
    const first = targets.values().next().value;
    out.set(first, [...(out.get(first) || []), ...rest].sort((a, b) => kids.indexOf(a) - kids.indexOf(b)));
  }
  return out;
}

/** Components an instance swap property suggests: { preferred, others } (ids; others are every other component). */
export function swapOptions(model, id, prop) {
  const def = propsOfTarget(model, id)?.[prop];
  const preferred = isObj(def) && Array.isArray(def.preferred) ? def.preferred.filter((x) => isObj(model.nodes[x])) : [];
  const others = Object.values(model.nodes)
    .filter((n) => isObj(n) && (n.type === "componentSet" || (n.type === "component" && !setOf(model, n))) && !preferred.includes(n.id))
    .map((n) => n.id)
    .sort();
  return { preferred, others };
}

/** The variant axes of a component or set: { axis: { options, default } }. */
export function variantAxes(model, id) {
  const out = {};
  for (const [name, d] of Object.entries(propsOfTarget(model, id) || {})) if (isObj(d) && d.type === "variant") out[name] = { options: [...(d.options || [])], default: d.default };
  return out;
}

/** Override paths of an instance that reach a layer ({ active }) and those that do not anymore ({ inactive }). */
export function overridePaths(model, instId) {
  const inst = model.nodes[instId];
  const active = [];
  const inactive = [];
  if (!isObj(inst?.over)) return { active, inactive };
  // a step of a path is a layer of the current instance's component, or slot content of the current instance
  const reach = (path) => {
    let target = model.nodes[inst.of];
    let variant = inst.variant;
    let owner = inst.id;
    for (const seg of path.split("/")) {
      const comp = pickVariant(model, target, variant);
      const n = model.nodes[seg];
      if (!isObj(n)) return false;
      let p = n.parent;
      const seen = new Set();
      while (p != null && (!comp || p !== comp.id) && p !== owner && !seen.has(p)) {
        seen.add(p);
        p = model.nodes[p]?.parent;
      }
      if (p == null || seen.has(p) || (p !== owner && (!comp || p !== comp.id))) return false;
      target = n.type === "instance" ? model.nodes[n.of] : null;
      variant = n.variant;
      owner = n.id;
    }
    return true;
  };
  for (const p of Object.keys(inst.over)) (reach(p) ? active : inactive).push(p);
  return { active, inactive };
}

/** Variant values from a layer name such as "size=md, state=hover", or null. */
export function parseVariantName(name) {
  if (typeof name !== "string" || !name.includes("=")) return null;
  const out = {};
  for (const part of name.split(",")) {
    const m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(part);
    if (!m || !PROP_NAME_RE.test(m[1])) return null;
    out[m[1]] = m[2];
  }
  return out;
}

const variantName = (v) =>
  Object.entries(v)
    .map(([k, x]) => `${k}=${x}`)
    .join(", ");

// ------------------------------------------------------------------------------------------------- operations

const INSTANCE_ONLY = ["of", "variant", "props", "over", "bind"];

/**
 * Operation handlers of components and instances. `kit` comes from ops.js: { OpError, runOp, clone, createResolver }.
 */
export function componentOps(kit) {
  const { OpError, runOp, clone, createResolver } = kit;

  const ids = (v) => {
    const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : null;
    if (!list || !list.length || !list.every((x) => typeof x === "string")) throw new OpError("bad-op", "`ids` must be a non-empty list of layer ids.");
    return [...new Set(list)];
  };
  const needType = (d, id, types, what) => {
    const n = d.need(id);
    if (!types.includes(n.type)) throw new OpError("type", `“${n.name ?? id}” is not ${what}.`);
    return n;
  };
  const insideComponent = (d, id) => {
    let p = id;
    const seen = new Set();
    while (p != null && !seen.has(p)) {
      seen.add(p);
      const n = d.node(p);
      if (!n) return false;
      if (n.type === "component" || n.type === "componentSet" || n.type === "instance") return true;
      p = n.parent;
    }
    return false;
  };
  const owner = (d, id) => {
    const o = propOwner(d.m, id);
    if (!o) throw new OpError("type", `“${id}” is not a component or component set.`);
    return o;
  };
  /** Instances that render `ownerId` (a set or component) or one of its variants. */
  const instancesOf = (d, ownerId) => {
    const targets = new Set([ownerId]);
    if (d.node(ownerId)?.type === "componentSet") for (const c of d.kids(ownerId)) targets.add(c);
    return Object.values(d.m.nodes).filter((n) => n.type === "instance" && targets.has(n.of));
  };
  const variantsOf = (d, ownerId) => (d.node(ownerId)?.type === "componentSet" ? d.kids(ownerId).map((c) => d.node(c)).filter((c) => c?.type === "component") : []);
  const withField = (n, k, v) => {
    const out = { ...n };
    if (v === undefined || (isObj(v) && !Object.keys(v).length)) delete out[k];
    else out[k] = v;
    return out;
  };
  const rename = (o, from, to) => {
    if (!own(o, from)) return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k === from ? to : k] = v;
    return out;
  };
  const without = (o, k) => {
    if (!own(o, k)) return o;
    const { [k]: _gone, ...rest } = o;
    return rest;
  };

  const H = {};

  // component.create { ids, name?, id?, layout? } — a single frame becomes a component in place; anything else is
  // wrapped in a new component
  H["component.create"] = (d, op) =>
    d.record(() => {
      const list = d.roots(ids(op.ids ?? op.id));
      for (const id of list) {
        const n = d.need(id);
        if (["component", "componentSet", "instance", "slot"].includes(n.type)) throw new OpError("type", `A ${n.type} cannot become a component.`);
        if (insideComponent(d, n.parent)) throw new OpError("nested-component", "Components cannot be created inside components or instances.");
      }
      const first = d.node(list[0]);
      if (list.length === 1 && first.type === "frame") {
        d.put({ ...first, type: "component", ...(op.name != null ? { name: op.name } : {}) });
        return [first.id];
      }
      const r = runOp(d, { op: "node.wrap", ids: list, layout: op.layout ?? "none", ...(op.id != null ? { id: op.id } : {}) });
      const w = d.node(r.ids[0]);
      d.put({ ...w, type: "component", name: op.name ?? (list.length === 1 ? first.name : "Component") });
      return [w.id];
    });

  // component.combine { ids, name?, id? } — combine components into a new set; names such as "size=md, state=hover"
  // become variant properties, other names one "variant" property
  H["component.combine"] = (d, op) =>
    d.record(() => {
      const list = ids(op.ids ?? op.id);
      if (list.length < 1) throw new OpError("bad-op", "Combine needs components.");
      const comps = list.map((id) => needType(d, id, ["component"], "a component"));
      for (const c of comps) if (setOf(d.m, c)) throw new OpError("set-child", `“${c.name}” is already a variant of a set.`);
      if (comps.some((c) => c.page !== comps[0].page)) throw new OpError("page-mismatch", "Combine components of one page.");
      let parsed = comps.map((c) => parseVariantName(c.name));
      const props = {};
      if (parsed.every(Boolean)) {
        for (const v of parsed)
          for (const [axis, val] of Object.entries(v)) {
            if (!props[axis]) props[axis] = { type: "variant", options: [], default: val };
            if (!props[axis].options.includes(val)) props[axis].options.push(val);
          }
        parsed = parsed.map((v) => {
          const full = {};
          for (const axis of Object.keys(props)) full[axis] = v[axis] ?? props[axis].default;
          return full;
        });
      } else {
        const used = new Set();
        parsed = comps.map((c) => {
          let base = String(c.name || "Variant").replace(/[,=]/g, " ").trim().slice(0, 100) || "Variant";
          let v = base;
          for (let i = 2; used.has(v); i++) v = `${base} ${i}`;
          used.add(v);
          return { variant: v };
        });
        props.variant = { type: "variant", options: parsed.map((p) => p.variant), default: parsed[0].variant };
      }
      const seen = new Set();
      for (const v of parsed) {
        const k = JSON.stringify(v);
        if (seen.has(k)) throw new OpError("duplicate-variant", `Two components have the variant ${variantName(v)}.`);
        seen.add(k);
      }
      for (const c of comps) if (isObj(c.props)) for (const [k, def] of Object.entries(c.props)) if (!props[k] && isObj(def) && def.type !== "variant") props[k] = clone(def);
      const anchor = d.node(d.roots(list)[0]);
      const created = runOp(d, { op: "node.create", type: "componentSet", parent: anchor.parent, page: anchor.page, before: anchor.id, ...(op.id != null ? { id: op.id } : {}), fields: { name: op.name ?? (parsed.every((p) => !own(p, "variant")) ? "Component Set" : comps[0].name), props, x: anchor.x ?? 0, y: anchor.y ?? 0 } });
      const setId = created.ids[0];
      runOp(d, { op: "node.move", ids: list, parent: setId, index: 0 });
      list.forEach((id, i) => {
        const c = without(d.node(id), "props");
        d.put({ ...c, variant: parsed[i], pos: "flow", name: variantName(parsed[i]) });
      });
      return [setId];
    });

  // component.addVariant { set, from?, variant?, name? } — a copy of a variant with new variant values (new options
  // are added to the set's axes)
  H["component.addVariant"] = (d, op) =>
    d.record(() => {
      const set = needType(d, op.set, ["componentSet"], "a component set");
      const comps = variantsOf(d, set.id);
      const src = op.from != null ? needType(d, op.from, ["component"], "a component") : pickVariant(d.m, set, {});
      if (!src || src.parent !== set.id) throw new OpError("not-found", "The set has no variant to copy.");
      const props = { ...(isObj(set.props) ? set.props : {}) };
      const axes = Object.keys(props).filter((k) => props[k]?.type === "variant");
      let values;
      if (isObj(op.variant)) values = { ...(src.variant || {}), ...op.variant };
      else {
        let axis = axes[0];
        if (!axis) {
          axis = "variant";
          props.variant = { type: "variant", options: ["Default"], default: "Default" };
          axes.push(axis);
          for (const c of comps) d.put({ ...c, variant: { ...(c.variant || {}), variant: "Default" } });
        }
        const opts = props[axis].options || [];
        let v = `Variant ${opts.length + 1}`;
        for (let i = opts.length + 2; opts.includes(v); i++) v = `Variant ${i}`;
        values = { ...(d.node(src.id).variant || {}), [axis]: v };
      }
      for (const [axis, val] of Object.entries(values)) {
        if (typeof val !== "string" || !val) throw new OpError("bad-op", "Variant values are text.");
        const def = props[axis];
        if (!def) props[axis] = { type: "variant", options: [val], default: val };
        else if (def.type !== "variant") throw new OpError("type", `“${axis}” is not a variant property.`);
        else if (!def.options.includes(val)) props[axis] = { ...def, options: [...def.options, val] };
      }
      for (const axis of Object.keys(props)) if (props[axis]?.type === "variant" && values[axis] === undefined) values[axis] = props[axis].default ?? props[axis].options[0];
      const key = JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]));
      for (const c of variantsOf(d, set.id)) {
        const v = d.node(c.id).variant || {};
        if (JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]])) === key) throw new OpError("duplicate-variant", `The set already has the variant ${variantName(values)}.`);
      }
      d.put({ ...d.node(set.id), props });
      const r = runOp(d, { op: "node.duplicate", ids: [src.id] });
      const id = r.ids[0];
      d.put({ ...d.node(id), variant: values, name: op.name ?? variantName(values) });
      return [id];
    });

  const checkDef = (def, set) => {
    if (!isObj(def) || !PROP_TYPES.includes(def.type)) throw new OpError("bad-op", `A property definition is { type: ${PROP_TYPES.join(" | ")}, … }.`);
    if (def.type === "variant" && !set) throw new OpError("type", "Variant properties belong to component sets.");
    return clone(def);
  };

  // prop.define { id, name, def } — add or replace a property definition of a component or set
  H["prop.define"] = (d, op) =>
    d.record(() => {
      const o = owner(d, op.id);
      if (typeof op.name !== "string" || !PROP_NAME_RE.test(op.name)) throw new OpError("prop-name", "Property names are letters, digits, spaces, “-” and “_” (up to 64).");
      const def = checkDef(op.def, o.type === "componentSet");
      const old = isObj(o.props) ? o.props[op.name] : undefined;
      d.put({ ...o, props: { ...(isObj(o.props) ? o.props : {}), [op.name]: def } });
      if (def.type === "variant") {
        const opts = Array.isArray(def.options) ? def.options : [];
        for (const c of variantsOf(d, o.id)) {
          const v = c.variant?.[op.name];
          if (v === undefined) d.put({ ...c, variant: { ...(c.variant || {}), [op.name]: def.default ?? opts[0] } });
          else if (!opts.includes(v)) throw new OpError("in-use", `The variant “${c.name}” uses the option “${v}”.`);
        }
      }
      for (const inst of instancesOf(d, o.id)) {
        let n = inst;
        if (old && old.type !== def.type) {
          n = withField(n, "props", without(n.props, op.name));
          n = withField(n, "variant", without(n.variant, op.name));
        } else if (def.type === "variant" && isObj(n.variant) && n.variant[op.name] !== undefined && !(def.options || []).includes(n.variant[op.name])) n = withField(n, "variant", without(n.variant, op.name));
        if (n !== inst) d.put(n);
      }
      return [o.id];
    });

  // prop.rename { id, name, to }
  H["prop.rename"] = (d, op) =>
    d.record(() => {
      const o = owner(d, op.id);
      if (!own(o.props, op.name)) throw new OpError("not-found", `There is no property “${op.name}”.`);
      if (typeof op.to !== "string" || !PROP_NAME_RE.test(op.to)) throw new OpError("prop-name", "Property names are letters, digits, spaces, “-” and “_” (up to 64).");
      if (op.to === op.name) return [o.id];
      if (own(o.props, op.to)) throw new OpError("exists", `There is already a property “${op.to}”.`);
      const fixBind = (n) => (isObj(n.bind) && Object.values(n.bind).includes(op.name) ? withField(n, "bind", Object.fromEntries(Object.entries(n.bind).map(([k, v]) => [k, v === op.name ? op.to : v]))) : n);
      d.put(fixBind({ ...o, props: rename(o.props, op.name, op.to) }));
      for (const c of variantsOf(d, o.id)) {
        const n = fixBind(withField(c, "variant", rename(c.variant, op.name, op.to)));
        if (n.variant !== c.variant || n.bind !== c.bind) d.put(n);
      }
      for (const inst of instancesOf(d, o.id)) {
        const n = withField(withField(inst, "props", rename(inst.props, op.name, op.to)), "variant", rename(inst.variant, op.name, op.to));
        if (n.props !== inst.props || n.variant !== inst.variant) d.put(n);
      }
      return [o.id];
    });

  // prop.delete { id, name } — removes the definition, its bindings and every value of it
  H["prop.delete"] = (d, op) =>
    d.record(() => {
      const o = owner(d, op.id);
      if (!own(o.props, op.name)) throw new OpError("not-found", `There is no property “${op.name}”.`);
      const unbind = (n) => (isObj(n.bind) && Object.values(n.bind).includes(op.name) ? withField(n, "bind", Object.fromEntries(Object.entries(n.bind).filter(([, v]) => v !== op.name))) : n);
      d.put(unbind(withField(o, "props", without(o.props, op.name))));
      if (o.type === "componentSet" && !Object.keys(d.node(o.id).props || {}).length) d.put({ ...d.node(o.id), props: {} });
      for (const c of variantsOf(d, o.id)) {
        const n = unbind(withField(c, "variant", without(c.variant, op.name)));
        if (n !== c) d.put(n);
      }
      for (const inst of instancesOf(d, o.id)) {
        const n = withField(withField(inst, "props", without(inst.props, op.name)), "variant", without(inst.variant, op.name));
        if (n.props !== inst.props || n.variant !== inst.variant) d.put(n);
      }
      return [o.id];
    });

  // prop.bind { id: component, layer, field, prop: name | null } — connect a property to a field of a layer
  H["prop.bind"] = (d, op) =>
    d.record(() => {
      const comp = needType(d, op.id, ["component", "componentSet"], "a component");
      d.need(op.layer);
      if (!d.inside(op.layer, comp.id)) throw new OpError("not-inside", "The layer is not part of the component.");
      if (typeof op.field !== "string" || !FIELD_RE.test(op.field) || (STRUCTURE_FIELDS.includes(op.field) && op.field !== "children") || (!UPDATABLE_FIELDS.includes(op.field) && op.field !== "children")) throw new OpError("field", `“${op.field}” cannot be bound to a property.`);
      const key = `${op.layer}.${op.field}`;
      const bind = { ...(isObj(comp.bind) ? comp.bind : {}) };
      if (op.prop == null) delete bind[key];
      else {
        const def = propsOfTarget(d.m, comp.id)?.[op.prop];
        if (!isObj(def)) throw new OpError("not-found", `There is no property “${op.prop}”.`);
        if (def.type === "variant") throw new OpError("type", "Variant properties choose the variant; they are not bound to layers.");
        if ((def.type === "slot") !== (op.field === "children")) throw new OpError("type", "Slot properties bind the `children` of a slot layer, and only they do.");
        if (def.type === "slot" && d.node(op.layer).type !== "slot") throw new OpError("type", "Slot properties bind a slot layer.");
        if (def.type === "swap" && (op.field !== "of" || d.node(op.layer).type !== "instance")) throw new OpError("type", "Swap properties bind the `of` of a nested instance.");
        bind[key] = op.prop;
      }
      d.put(withField(comp, "bind", bind));
      return [comp.id];
    });

  // instance.create { of, parent?, page?, index?|before?|after?, id?, variant?, props?, fields? }
  H["instance.create"] = (d, op) =>
    d.record(() => {
      const target = needType(d, op.of, ["component", "componentSet"], "a component");
      const fields = { name: target.name, ...(isObj(op.fields) ? clone(op.fields) : {}), of: target.id };
      if (isObj(op.variant)) fields.variant = clone(op.variant);
      if (isObj(op.props)) fields.props = clone(op.props);
      const { op: _o, of: _of, variant: _v, props: _p, fields: _f, ...pos } = op;
      const r = runOp(d, { ...pos, op: "node.create", type: "instance", fields });
      const n = { ...d.node(r.ids[0]) };
      // the main component's size applies unless the caller set one
      for (const k of ["w", "h"]) if (!isObj(op.fields) || op.fields[k] === undefined) delete n[k];
      d.put(n);
      return [n.id];
    });

  // instance.set { id, variant?: { axis: value|null }, props?: { name: value|null } }
  H["instance.set"] = (d, op) =>
    d.record(() => {
      let n = needType(d, op.id, ["instance"], "an instance");
      for (const k of ["variant", "props"]) {
        if (op[k] === undefined) continue;
        if (!isObj(op[k])) throw new OpError("bad-op", `\`${k}\` must be an object.`);
        const next = { ...(isObj(n[k]) ? n[k] : {}) };
        for (const [name, v] of Object.entries(op[k])) {
          if (v === null) delete next[name];
          else next[name] = clone(v);
        }
        n = withField(n, k, next);
      }
      if (n !== d.node(op.id)) d.put(n);
      return [n.id];
    });

  // instance.swap { id, of } — another main component; variant and property values it does not know are dropped,
  // overrides are kept (overrides of layers it does not have are inactive)
  H["instance.swap"] = (d, op) =>
    d.record(() => {
      const n = needType(d, op.id, ["instance"], "an instance");
      needType(d, op.of, ["component", "componentSet"], "a component");
      const defs = propsOfTarget(d.m, op.of) || {};
      const variant = Object.fromEntries(Object.entries(isObj(n.variant) ? n.variant : {}).filter(([k, v]) => defs[k]?.type === "variant" && defs[k].options?.includes(v)));
      const oldDefs = propsOfTarget(d.m, n.of) || {};
      const props = Object.fromEntries(Object.entries(isObj(n.props) ? n.props : {}).filter(([k]) => isObj(defs[k]) && defs[k].type !== "variant" && (!oldDefs[k] || oldDefs[k].type === defs[k].type)));
      d.put(withField(withField({ ...n, of: op.of }, "variant", variant), "props", props));
      return [n.id];
    });

  // instance.override { id, path, set?: { field: value }, unset?: [field] } — fields of a layer inside the instance
  H["instance.override"] = (d, op) =>
    d.record(() => {
      const n = needType(d, op.id, ["instance"], "an instance");
      if (typeof op.path !== "string" || !op.path) throw new OpError("path", "`path` is a path of layer ids such as “n31/n22”.");
      const cur = { ...(isObj(n.over?.[op.path]) ? n.over[op.path] : {}) };
      const allowed = UPDATABLE_FIELDS.filter((f) => f !== "bind" && f !== "code");
      for (const [k, v] of Object.entries(isObj(op.set) ? op.set : {})) {
        if (!allowed.includes(k)) throw new OpError("field", `“${k}” cannot be overridden.`);
        if (v === undefined) delete cur[k];
        else cur[k] = clone(v);
      }
      for (const k of Array.isArray(op.unset) ? op.unset : []) delete cur[k];
      const over = { ...(isObj(n.over) ? n.over : {}) };
      if (Object.keys(cur).length) over[op.path] = cur;
      else delete over[op.path];
      d.put(withField(n, "over", over));
      return [n.id];
    });

  // instance.reset { id, paths?, props? } — remove overrides (all, or the listed paths and the layers below them),
  // and with props: true the property values too
  H["instance.reset"] = (d, op) =>
    d.record(() => {
      const n = needType(d, op.id, ["instance"], "an instance");
      let over = isObj(n.over) ? n.over : {};
      if (Array.isArray(op.paths)) over = Object.fromEntries(Object.entries(over).filter(([k]) => !op.paths.some((p) => k === p || k.startsWith(`${p}/`))));
      else over = {};
      let next = withField(n, "over", over);
      if (op.props === true) next = withField(next, "props", {});
      if (next.over !== n.over || next.props !== n.props) d.put(next);
      return [n.id];
    });

  // instance.detach { ids } — materialize the resolved subtree (see the header)
  H["instance.detach"] = (d, op) =>
    d.record(() => {
      const list = ids(op.ids ?? op.id);
      for (const id of list) needType(d, id, ["instance"], "an instance");
      for (const id of list) detachOne(d, id);
      return list;
    });

  function detachOne(d, id) {
    const n = d.need(id);
    if (!isObj(d.node(n.of))) throw new OpError("missing-component", "The main component of the instance is not available.");
    d.syncIndex();
    const res = createResolver(d.m);
    const r = res.tree(id);
    const rootKey = r.key;
    const puts = [];
    const moves = [];
    const strip = (x, keep = []) => {
      const out = { ...x };
      for (const k of INSTANCE_ONLY) if (!keep.includes(k)) delete out[k];
      return out;
    };
    const outer = isObj(n.over) ? n.over : {};
    const contentOf = (r0) => {
      const out = [];
      const visit = (x) => {
        for (const c of x.children) {
          if (c.slot === r0.key) out.push(c);
          else visit(c);
        }
      };
      visit(r0);
      return out;
    };
    const mat = (c, parentId) => {
      if (c.slot === rootKey) {
        moves.push([c.id, parentId]);
        return;
      }
      const nid = d.newNodeId();
      const at = { id: nid, page: n.page, parent: parentId, ord: c.src.ord };
      if (c.type === "instance") {
        const rel = c.key.slice(rootKey.length + 1);
        const over = { ...(isObj(c.src.over) ? c.src.over : {}) };
        // overrides of its slot content are already in the materialized content (which gets new ids)
        const content = new Set(d.kids(c.id));
        for (const [k, v] of Object.entries(outer)) {
          if (!k.startsWith(`${rel}/`) || !isObj(v)) continue;
          const sub = k.slice(rel.length + 1);
          if (content.has(sub.split("/")[0])) continue;
          over[sub] = { ...(over[sub] || {}), ...v };
        }
        const node = withField({ ...strip(c.src, ["of", "variant", "props"]), ...at, type: "instance" }, "over", over);
        puts.push(node);
        for (const x of contentOf(c)) mat(x, nid);
        return;
      }
      puts.push({ ...strip(c.base), ...at, type: c.type === "slot" || c.type === "component" || c.type === "componentSet" ? "frame" : c.type });
      for (const k of c.children) mat(k, nid);
    };
    const root = { ...strip(r.base), id, type: "frame", page: n.page, parent: n.parent, ord: n.ord };
    if (root.name === undefined) root.name = n.name ?? "Frame";
    for (const c of r.children) mat(c, id);
    d.put(root);
    for (const x of puts) d.put(x);
    for (const [cid, parentId] of moves) d.put({ ...d.node(cid), parent: parentId });
  }

  return H;
}
