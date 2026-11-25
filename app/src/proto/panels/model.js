// Pure view models of the Proto Studio's Assets, Variables and Styles UI and of the component, instance, binding and
// mode sections of the Design panel (docs/concepts/proto-studio.md §5.3, task T6). No DOM: the panels (assets.js,
// variables.js, binding.js, design.js) render what these functions return, and every edit they offer is an operation
// built here, so the panels stay thin and the logic is tested in Node (tests/proto/panels-model.test.js).
//
// Public API
//   assetList(model, { query?, page? }) → { components: [Asset], styles: [StyleAsset] }
//       Asset { id, name, type: "component"|"componentSet", page, pageName, variants, preview: id }
//   insertInstanceOp(model, of, { page, parent?, index?, x?, y? }) → op            instance.create
//   canCreateComponent(model, ids) / canCombine(model, ids) → boolean
//   componentOp(model, ids, name?) / combineOp(model, ids, name?) → op
//   instanceInfo(model, id) → { id, of, main, mainName, mainPage, axes, props, overrides, missing } | null
//   componentInfo(model, id) → { owner, ownerName, isSet, props: [PropRow], variants: [{ id, name, variant }] } | null
//   propBindTargets(model, id) → [{ comp, field, prop: name|null, props: [{ name, type }] }]   a layer inside a component
//   newPropDef(type, model, owner) → def                 a fresh property definition of a type
//   FIELD_TYPES / fieldType(path) → "color"|"number"|"string"|"bool"|null   the variable type a field path takes
//   valueAt(node, path) / bindingAt(node, path) → value / variable id | null
//   commonBinding(model, ids, path) → { var, mixed }      the binding shared by every layer
//   bindOp(model, ids, path, varId|null, { force? }) → op  node.bind for every layer (a batch)
//   bindCandidates(model, path, { query?, type? }) → [{ coll, collName, items: [{ id, name, type, value, allowed }] }]
//   boundValue(model, varId, nodeId) → value             the variable's value in the layer's modes
//   varLabel(model, id) → string                          "color/brand" (or "?" for a missing variable)
//   collectionsList(model) → [{ id, name, extends, depth, modes, count }]
//   variableTable(model, collId, { query? }) → { coll, base, family, modes, rows: [Row] } | null
//       Row { id, name, type, unit, scopes, css, own (the variable belongs to this collection), cells: [Cell] }
//       Cell { mode, raw, value, alias: varId|null, override: boolean, inherited: boolean }
//   cellOp(model, collId, varId, mode, value) → op         var.update (own values, or the `ext` override of a brand)
//   resetCellOp(model, collId, varId, mode) → op | null    removes a brand override
//   parseCell(type, text) → value | undefined             text from a table cell as a variable value
//   formatValue(type, value) → string
//   uniqueName(taken, base) → string
//   modeChoices(model, nodeId | null, pageId) → [{ root, colls: [{ id, name }], modes: [{ id, name }], sel, mode, inherited }]
//   modeOp(model, nodeId | null, pageId, root, coll | null, mode | null) → op     node.update / page.update of `modes`
//   STYLE_SLOT_KIND / stylesOfKind(model, kind, query?) → [{ id, name, kind, value }]
//   styleSlotInfo(model, ids, slot) → { style: id|null, mixed, name }
//   styleFromSelectionOp(model, id, kind, name) / applyStyleOp(ids, slot, style) / detachStyleOp(ids, slot)
//   updateStyleFromOp(model, styleId, nodeId) → op | null
//   tokenExport(model, format) → { name, mime, text }      dtcg | css | tailwind | swift
//   overrideSummary(model, id) → { count, active: [path], inactive: [path], props: n }
import { isContainer, STYLE_SLOTS, VAR_TYPES } from "../../engine/proto/schema.js";
import { indexOf, ancestors, pageList } from "../../engine/proto/tree.js";
import { setOf, propOwner, propsOfTarget, pickVariant, variantAxes, overridePaths, swapOptions, bindingsOf } from "../../engine/proto/components.js";
import { isBinding, canBind, rawValue, variableValue, familyOf, rootOf, chainOf, modeIdsOf, modesAtNode, selection, cssVarName, styleValueFrom } from "../../engine/proto/variables.js";
import { exportTokens, tokensCss, tokensTailwind, tokensSwift } from "../../engine/proto/tokens.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }) || (a.id < b.id ? -1 : 1);
const collsOf = (m) => (isObj(m?.vars?.collections) ? m.vars.collections : {});
const itemsOf = (m) => (isObj(m?.vars?.items) ? m.vars.items : {});
const stylesOf = (m) => (isObj(m?.styles) ? m.styles : {});
const matches = (q, ...texts) => !q || texts.some((s) => String(s ?? "").toLowerCase().includes(q));
const batch = (ops) => (ops.length === 1 ? ops[0] : { op: "batch", ops });

// ------------------------------------------------------------------------------------------------- assets

/**
 * Components and component sets of the document (a variant inside a set is listed through its set) and the styles.
 * `query` filters by name (a set also matches by the names of its variants); `page` puts that page's assets first.
 */
export function assetList(model, { query = "", page = null } = {}) {
  const q = query.trim().toLowerCase();
  const ix = indexOf(model);
  const pages = Object.fromEntries(pageList(model).map((p, i) => [p.id, { name: p.name, i }]));
  const components = [];
  for (const n of Object.values(model.nodes || {})) {
    if (!isObj(n)) continue;
    if (n.type === "componentSet") {
      const variants = ix.get(n.id).filter((k) => model.nodes[k]?.type === "component");
      const names = variants.map((k) => model.nodes[k].name);
      if (!matches(q, n.name, ...names)) continue;
      const def = pickVariant(model, n, {});
      components.push({ id: n.id, name: n.name || "Component Set", type: "componentSet", page: n.page, pageName: pages[n.page]?.name || "", variants: variants.length, preview: def?.id || null });
    } else if (n.type === "component" && !setOf(model, n)) {
      if (!matches(q, n.name)) continue;
      components.push({ id: n.id, name: n.name || "Component", type: "component", page: n.page, pageName: pages[n.page]?.name || "", variants: 0, preview: n.id });
    }
  }
  components.sort((a, b) => (a.page === page ? 0 : 1) - (b.page === page ? 0 : 1) || (pages[a.page]?.i ?? 0) - (pages[b.page]?.i ?? 0) || byName(a, b));
  const styles = Object.entries(stylesOf(model))
    .filter(([, s]) => isObj(s) && matches(q, s.name))
    .map(([id, s]) => ({ id, name: s.name, kind: s.kind, value: s.value }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b));
  return { components, styles };
}

/** An instance of a component or set at a place (top-left `x`, `y` in the parent's coordinates, or a flow index). */
export function insertInstanceOp(model, of, { page, parent = null, index, x, y } = {}) {
  const op = { op: "instance.create", of, page: page ?? model.nodes[of]?.page };
  if (parent != null) op.parent = parent;
  if (index !== undefined) op.index = index;
  const fields = {};
  if (Number.isFinite(x)) fields.x = Math.round(x);
  if (Number.isFinite(y)) fields.y = Math.round(y);
  if (Object.keys(fields).length) op.fields = fields;
  return op;
}

const insideComponent = (model, id) => ancestors(model, id).some((a) => ["component", "componentSet", "instance"].includes(model.nodes[a]?.type));

/** True when the selection can become a component (no components, sets, instances or slots; not inside one). */
export function canCreateComponent(model, ids) {
  if (!ids.length) return false;
  return ids.every((id) => {
    const n = model.nodes[id];
    return n && !["component", "componentSet", "instance", "slot"].includes(n.type) && !insideComponent(model, id);
  });
}

/** True when the selection is two or more components of one page that are not variants yet. */
export function canCombine(model, ids) {
  if (ids.length < 2) return false;
  const list = ids.map((id) => model.nodes[id]);
  return list.every((n) => n?.type === "component" && !setOf(model, n) && n.page === list[0].page);
}

export const componentOp = (model, ids, name) => ({ op: "component.create", ids: [...ids], ...(name ? { name } : {}) });
export const combineOp = (model, ids, name) => ({ op: "component.combine", ids: [...ids], ...(name ? { name } : {}) });

// ------------------------------------------------------------------------------------------------- instances

/** Overrides of an instance: how many paths, which still reach a layer, and how many property values it sets. */
export function overrideSummary(model, id) {
  const n = model.nodes[id];
  if (!n || n.type !== "instance") return { count: 0, active: [], inactive: [], props: 0 };
  const { active, inactive } = overridePaths(model, id);
  const props = isObj(n.props) ? Object.keys(n.props).length : 0;
  return { count: active.length + inactive.length, active, inactive, props };
}

/**
 * What the instance section of the Design panel shows: the main component (the variant it renders), variant axes
 * with the current value, the other properties with their values and defaults, and the override summary.
 */
export function instanceInfo(model, id) {
  const n = model.nodes[id];
  if (!n || n.type !== "instance") return null;
  const target = typeof n.of === "string" ? model.nodes[n.of] : null;
  if (!target) return { id, of: n.of, main: null, mainName: "", mainPage: null, axes: [], props: [], overrides: overrideSummary(model, id), missing: true };
  const main = pickVariant(model, target, n.variant);
  const owner = propOwner(model, target.id);
  const defs = propsOfTarget(model, target.id) || {};
  const own = isObj(n.variant) ? n.variant : {};
  // an instance of one variant keeps that variant's values (components.js ▸ pickVariant)
  const base = target.type === "component" && isObj(target.variant) ? target.variant : {};
  const axes = Object.entries(variantAxes(model, target.id)).map(([name, a]) => ({ name, options: a.options, default: a.default, value: own[name] ?? base[name] ?? a.default, set: own[name] !== undefined }));
  const values = isObj(n.props) ? n.props : {};
  const props = Object.entries(defs)
    .filter(([, d]) => isObj(d) && d.type !== "variant")
    .map(([name, d]) => {
      const row = { name, type: d.type, default: d.default, value: values[name] !== undefined ? values[name] : d.default, set: values[name] !== undefined };
      if (d.type === "swap") {
        const o = swapOptions(model, owner.id, name);
        row.options = [...o.preferred, ...o.others].map((x) => ({ id: x, name: model.nodes[x]?.name || x, preferred: o.preferred.includes(x) }));
      }
      return row;
    });
  return { id, of: target.id, main: main?.id || target.id, mainName: target.name || "", mainPage: (main || target).page, axes, props, overrides: overrideSummary(model, id), missing: false };
}

/** Swap candidates for an instance: every component and set (sets first by name), the current one marked. */
export function swapChoices(model, id) {
  const n = model.nodes[id];
  const list = [];
  for (const x of Object.values(model.nodes || {})) if (x.type === "componentSet" || (x.type === "component" && !setOf(model, x))) list.push({ id: x.id, name: x.name || x.id, current: x.id === n?.of || (model.nodes[n?.of] && setOf(model, model.nodes[n.of])?.id === x.id) });
  return list.sort(byName);
}

// ------------------------------------------------------------------------------------------------- components

/** A fresh definition of a property type. */
export function newPropDef(type, model, owner) {
  switch (type) {
    case "text":
      return { type, default: "Text" };
    case "bool":
      return { type, default: true };
    case "number":
      return { type, default: 0 };
    case "slot":
      return { type };
    case "variant":
      return { type, options: ["Default"], default: "Default" };
    case "swap": {
      const first = Object.values(model.nodes).find((n) => (n.type === "component" && !setOf(model, n)) || n.type === "componentSet");
      return { type, default: first && first.id !== owner ? first.id : null, preferred: [] };
    }
    default:
      return { type: "text", default: "" };
  }
}

/** The component section: properties of the component or set (with variant options) and the variants of a set. */
export function componentInfo(model, id) {
  const n = model.nodes[id];
  if (!n || (n.type !== "component" && n.type !== "componentSet")) return null;
  const owner = propOwner(model, id);
  const defs = isObj(owner.props) ? owner.props : {};
  const props = Object.entries(defs).map(([name, d]) => ({ name, type: d?.type, default: d?.default, options: Array.isArray(d?.options) ? d.options : null, preferred: Array.isArray(d?.preferred) ? d.preferred : null }));
  const variants = owner.type === "componentSet" ? indexOf(model).get(owner.id).map((k) => model.nodes[k]).filter((c) => c?.type === "component").map((c) => ({ id: c.id, name: c.name, variant: isObj(c.variant) ? c.variant : {} })) : [];
  return { owner: owner.id, ownerName: owner.name || "", isSet: owner.type === "componentSet", props, variants };
}

/** Bindable fields of a layer inside a component, with the property bound now: text content, visibility, swap. */
export function propBindTargets(model, id) {
  const n = model.nodes[id];
  if (!n) return [];
  const comp = ancestors(model, id)
    .map((a) => model.nodes[a])
    .find((a) => a?.type === "component");
  if (!comp || insideInstanceBelow(model, id, comp.id)) return [];
  const owner = propOwner(model, comp.id);
  const defs = isObj(owner?.props) ? owner.props : {};
  const binds = bindingsOf(model, comp);
  const current = (f) => (binds.get(id) || []).find(([x]) => x === f)?.[1] ?? null;
  const of = (types) =>
    Object.entries(defs)
      .filter(([, d]) => types.includes(d?.type))
      .map(([name, d]) => ({ name, type: d.type }));
  const out = [];
  if (n.type === "text") out.push({ comp: comp.id, field: "text", prop: current("text"), props: of(["text"]) });
  out.push({ comp: comp.id, field: "visible", prop: current("visible"), props: of(["bool"]) });
  if (n.type === "instance") out.push({ comp: comp.id, field: "of", prop: current("of"), props: of(["swap"]) });
  if (n.type === "slot") out.push({ comp: comp.id, field: "children", prop: current("children"), props: of(["slot"]) });
  return out;
}

const insideInstanceBelow = (model, id, compId) => {
  for (const a of ancestors(model, id)) {
    if (a === compId) return false;
    if (model.nodes[a]?.type === "instance") return true;
  }
  return false;
};

// ------------------------------------------------------------------------------------------------- bindings

/** The variable type a field path takes (null: the field cannot be bound from the Design panel). */
export function fieldType(path) {
  const s = String(path).split(".");
  const last = s[s.length - 1];
  if (last === "color") return "color";
  if (s[0] === "visible") return "bool";
  if (s[0] === "text" && last === "font") return "string";
  if (s[0] === "text" && last === "t") return "string";
  if (["opacity", "radius", "w", "h", "layout", "text", "strokes", "effects"].includes(s[0])) return "number";
  return null;
}
export const FIELD_TYPES = Object.freeze(VAR_TYPES);

/** The stored value at a dotted path ("fills.0.color"). */
export function valueAt(node, path) {
  let v = node;
  for (const s of String(path).split(".")) {
    if (Array.isArray(v)) v = v[Number(s)];
    else if (isObj(v)) v = v[s];
    else return undefined;
  }
  return v;
}

/** The variable bound at a path of a layer, or null. */
export const bindingAt = (node, path) => {
  const v = valueAt(node, path);
  return isBinding(v) ? v.$var : null;
};

/** The binding every layer of `ids` shares at `path` ({ var: null, mixed: true } when they differ). */
export function commonBinding(model, ids, path) {
  const list = ids.map((id) => model.nodes[id]).filter(Boolean);
  if (!list.length) return { var: null, mixed: false };
  const first = bindingAt(list[0], path);
  const mixed = list.some((n) => bindingAt(n, path) !== first);
  return { var: mixed ? null : first, mixed };
}

/** Binds (or with `varId` null unbinds, writing the value) the field at `path` of every layer. */
export function bindOp(model, ids, path, varId, { force = false } = {}) {
  const ops = ids.filter((id) => model.nodes[id] && (varId != null || bindingAt(model.nodes[id], path))).map((id) => ({ op: "node.bind", id, path, var: varId ?? null, ...(force ? { force: true } : {}) }));
  return ops.length ? batch(ops) : null;
}

/** Variables that can be bound at `path` (type and scopes), grouped by collection; `allowed` false = outside its scopes. */
export function bindCandidates(model, path, { query = "", type = undefined, exclude = null } = {}) {
  const want = type === undefined ? fieldType(path) : type;
  const q = query.trim().toLowerCase();
  const colls = collsOf(model);
  const groups = new Map();
  for (const [id, v] of Object.entries(itemsOf(model))) {
    if (!isObj(v) || (want && v.type !== want) || id === exclude || !matches(q, v.name)) continue;
    if (!groups.has(v.coll)) groups.set(v.coll, []);
    groups.get(v.coll).push({ id, name: v.name, type: v.type, value: variableValue(model, id, {}), allowed: path ? canBind(v, path) : true });
  }
  return [...groups.entries()]
    .map(([coll, items]) => ({ coll, collName: colls[coll]?.name || coll, items: items.sort(byName) }))
    .sort((a, b) => a.collName.localeCompare(b.collName));
}

/** The value of a variable as a layer sees it (the layer's modes). */
export const boundValue = (model, varId, nodeId) => variableValue(model, varId, nodeId != null && model.nodes[nodeId] ? modesAtNode(model, nodeId) : {});

/** The display name of a variable. */
export const varLabel = (model, id) => itemsOf(model)[id]?.name || "?";

// ------------------------------------------------------------------------------------------------- variables

/** Collections in family order (a base, then the collections that extend it, indented by `depth`). */
export function collectionsList(model) {
  const colls = collsOf(model);
  const items = Object.values(itemsOf(model));
  const roots = Object.keys(colls)
    .filter((id) => rootOf(colls, id) === id)
    .sort((a, b) => String(colls[a].name).localeCompare(String(colls[b].name)) || (a < b ? -1 : 1));
  const out = [];
  for (const r of roots)
    for (const id of familyOf(colls, r)) {
      const c = colls[id];
      out.push({ id, name: c.name, extends: c.extends ?? null, depth: chainOf(colls, id).length - 1, modes: (c.modes || []).map((m) => ({ id: m.id, name: m.name })), default: c.default ?? c.modes?.[0]?.id, count: items.filter((v) => v?.coll === id).length });
    }
  return out;
}

/**
 * The table of a collection: one row per variable, one cell per mode. For an extending collection (a brand) the rows are
 * the variables of its chain (the base's and its own); a cell shows the brand's value and whether it overrides the base.
 */
export function variableTable(model, collId, { query = "" } = {}) {
  const colls = collsOf(model);
  const c = colls[collId];
  if (!isObj(c)) return null;
  const chain = chainOf(colls, collId);
  const inChain = new Set(chain);
  const q = query.trim().toLowerCase();
  const modes = (c.modes || []).map((m) => ({ id: m.id, name: m.name }));
  const rows = [];
  for (const [id, v] of Object.entries(itemsOf(model))) {
    if (!isObj(v) || !inChain.has(v.coll) || !matches(q, v.name)) continue;
    const own = v.coll === collId;
    const cells = modes.map((m) => {
      const sel = { [collId]: m.id };
      const raw = rawValue(model, id, sel);
      const mine = !own && isObj(v.ext?.[collId]) && v.ext[collId][m.id] !== undefined;
      return { mode: m.id, raw, value: variableValue(model, id, sel), alias: isBinding(raw) ? raw.$var : null, override: mine, inherited: !own && !mine };
    });
    rows.push({ id, name: v.name, type: v.type, unit: v.unit ?? null, scopes: Array.isArray(v.scopes) ? v.scopes : [], css: cssVarName(v, id), codeCss: v.code?.css ?? null, description: v.description ?? "", own, cells });
  }
  rows.sort(byName);
  return { coll: collId, name: c.name, base: c.extends ?? null, family: familyOf(colls, collId), modes, default: c.default ?? modes[0]?.id, rows };
}

/** The edit of one table cell: the variable's own value, or the override of the extending collection `collId`. */
export function cellOp(model, collId, varId, mode, value) {
  const v = itemsOf(model)[varId];
  if (!v) return null;
  if (v.coll === collId) return { op: "var.update", id: varId, set: { values: { ...(v.values || {}), [mode]: value } } };
  const ext = { ...(isObj(v.ext) ? v.ext : {}) };
  ext[collId] = { ...(isObj(ext[collId]) ? ext[collId] : {}), [mode]: value };
  return { op: "var.update", id: varId, set: { ext } };
}

/** Removes the override of a brand cell (null when the cell does not override). */
export function resetCellOp(model, collId, varId, mode) {
  const v = itemsOf(model)[varId];
  if (!v || v.coll === collId || !isObj(v.ext?.[collId]) || v.ext[collId][mode] === undefined) return null;
  const { [mode]: _gone, ...rest } = v.ext[collId];
  const ext = { ...v.ext };
  if (Object.keys(rest).length) ext[collId] = rest;
  else delete ext[collId];
  return Object.keys(ext).length ? { op: "var.update", id: varId, set: { ext } } : { op: "var.update", id: varId, unset: ["ext"] };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A table cell's text as a value of `type` (undefined when it is not one). Colors expand to 6 or 8 hex digits. */
export function parseCell(type, text) {
  const s = String(text ?? "").trim();
  if (type === "color") {
    const x = s.startsWith("#") ? s : `#${s}`;
    if (!HEX.test(x)) return undefined;
    if (x.length === 4 || x.length === 5) return `#${[...x.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
    return x.toLowerCase();
  }
  if (type === "number") {
    if (!s) return undefined;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "bool") {
    if (/^(true|yes|on|1)$/i.test(s)) return true;
    if (/^(false|no|off|0)$/i.test(s)) return false;
    return undefined;
  }
  return s;
}

/** A value for display in a table cell or a picker. */
export function formatValue(type, value) {
  if (value === undefined || value === null) return "";
  if (isBinding(value)) return "";
  if (type === "bool") return value ? "true" : "false";
  if (type === "number") return String(Math.round(Number(value) * 1000) / 1000);
  return String(value);
}

/** `base`, or `base 2`, `base 3`… that is not in `taken` (a Set or list of names). */
export function uniqueName(taken, base) {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ------------------------------------------------------------------------------------------------- modes

/**
 * The mode switcher of a frame (or the page, `nodeId` null): one entry per collection family with more than one mode
 * or with brands. `sel` is the collection this layer selects (null: inherited) and `mode` its mode; `inherited` is
 * what applies without a selection of its own.
 */
export function modeChoices(model, nodeId, pageId) {
  const colls = collsOf(model);
  const n = nodeId != null ? model.nodes[nodeId] : null;
  const own = n ? (isObj(n.modes) ? n.modes : {}) : isObj(model.pages?.[pageId]?.modes) ? model.pages[pageId].modes : {};
  const parentModes = n ? (n.parent != null ? modesAtNode(model, n.parent) : modesAtNode(model, null, model.pages?.[n.page]?.modes || {})) : {};
  const out = [];
  for (const root of Object.keys(colls).filter((id) => rootOf(colls, id) === id)) {
    const fam = familyOf(colls, root);
    const modes = (colls[root].modes || []).map((m) => ({ id: m.id, name: m.name }));
    if (modes.length < 2 && fam.length < 2) continue;
    let sel = null;
    for (const k of Object.keys(own)) if (fam.includes(k) && (sel === null || chainOf(colls, k).length > chainOf(colls, sel).length)) sel = k;
    const inhSel = selection(colls, parentModes, root).sel ?? root;
    const inhMode = selection(colls, parentModes, inhSel).mode;
    out.push({
      root,
      name: colls[root].name,
      colls: fam.map((id) => ({ id, name: colls[id].name })),
      modes,
      sel,
      mode: sel !== null ? own[sel] : null,
      inherited: { coll: inhSel, collName: colls[inhSel]?.name || "", mode: inhMode, modeName: modes.find((m) => m.id === inhMode)?.name || "" },
    });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Sets (or with `coll` null clears) the selection of a family on a layer or a page: one operation. */
export function modeOp(model, nodeId, pageId, root, coll, mode) {
  const colls = collsOf(model);
  const fam = new Set(familyOf(colls, root));
  const cur = nodeId != null ? model.nodes[nodeId]?.modes : model.pages?.[pageId]?.modes;
  const next = {};
  for (const [k, v] of Object.entries(isObj(cur) ? cur : {})) if (!fam.has(k)) next[k] = v;
  if (coll != null) next[coll] = mode ?? colls[coll]?.default ?? modeIdsOf(colls, coll)[0];
  const has = Object.keys(next).length > 0;
  if (nodeId != null) return has ? { op: "node.update", id: nodeId, set: { modes: next } } : { op: "node.update", id: nodeId, unset: ["modes"] };
  return { op: "page.update", id: pageId, set: { modes: has ? next : {} } };
}

// ------------------------------------------------------------------------------------------------- styles

/** The kind of style each Design panel slot takes. */
export const STYLE_SLOT_KIND = STYLE_SLOTS;

/** Styles of a kind, by name. */
export function stylesOfKind(model, kind, query = "") {
  const q = query.trim().toLowerCase();
  return Object.entries(stylesOf(model))
    .filter(([, s]) => isObj(s) && s.kind === kind && matches(q, s.name))
    .map(([id, s]) => ({ id, name: s.name, kind: s.kind, value: s.value }))
    .sort(byName);
}

/** The style the layers use in a slot: { style, mixed, name }. */
export function styleSlotInfo(model, ids, slot) {
  const refs = ids.map((id) => model.nodes[id]?.style?.[slot] ?? null);
  const first = refs[0] ?? null;
  const mixed = refs.some((r) => r !== first);
  const style = mixed ? null : first;
  return { style, mixed, name: style ? stylesOf(model)[style]?.name || "?" : "" };
}

/** A new style of `kind` from a layer's local values, applied to that layer (null: the layer has none). */
export function styleFromSelectionOp(model, id, kind, name) {
  const n = model.nodes[id];
  if (!n || styleValueFrom(n, kind) === undefined) return null;
  return { op: "style.create", kind, name, from: id };
}

export const applyStyleOp = (ids, slot, style) => ({ op: "style.apply", ids: [...ids], slot, style });
export const detachStyleOp = (ids, slot) => ({ op: "style.detach", ids: [...ids], ...(slot ? { slot } : {}) });

/** Replaces a style's value with a layer's local values (null when the layer has none of that kind). */
export function updateStyleFromOp(model, styleId, nodeId) {
  const s = stylesOf(model)[styleId];
  const n = model.nodes[nodeId];
  if (!s || !n) return null;
  const v = styleValueFrom(n, s.kind);
  return v === undefined ? null : { op: "style.update", id: styleId, set: { value: v } };
}

/** Which style kinds a layer offers values for (for "Create style from selection"). */
export function styleKindsOf(node) {
  if (!node) return [];
  return ["fill", "text", "effect", "grid"].filter((k) => styleValueFrom(node, k) !== undefined && (k !== "grid" || isContainer(node.type)));
}

// ------------------------------------------------------------------------------------------------- tokens

const slugTitle = (s) =>
  String(s || "design")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "design";

/** The text of a tokens export and a file name for it. */
export function tokenExport(model, format) {
  const base = slugTitle(model.meta?.title);
  switch (format) {
    case "css":
      return { name: `${base}.tokens.css`, mime: "text/css", text: tokensCss(model) };
    case "tailwind":
      return { name: `${base}.tailwind.css`, mime: "text/css", text: tokensTailwind(model) };
    case "swift":
      return { name: `${base.replace(/-./g, (x) => x[1].toUpperCase()).replace(/^./, (c) => c.toUpperCase())}Tokens.swift`, mime: "text/x-swift", text: tokensSwift(model) };
    default:
      return { name: `${base}.tokens.json`, mime: "application/json", text: `${JSON.stringify(exportTokens(model), null, 2)}\n` };
  }
}

/** Whether the main component of an instance can be shown (it exists and is on a page). */
export const mainOf = (model, instId) => {
  const n = model.nodes[instId];
  const target = n && typeof n.of === "string" ? model.nodes[n.of] : null;
  if (!target) return null;
  return pickVariant(model, target, n.variant) || target;
};
