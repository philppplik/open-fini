// The operation layer of the Proto model (docs/concepts/proto-studio.md §3, ADR 0034 decision 3). Pure.
//
// This is the only way a Proto model changes. The editor tools, the Vibe tools, the MCP server, the CLI and live
// collaboration all call it, so every capability has one implementation and one set of tests.
//
// An operation is a plain JSON object `{ op: "<name>", …args }`. `apply(model, op)` returns
//   { model, inverse, ids, map? }
// where `model` is the new immutable model (structural sharing: untouched nodes, pages and maps keep their identity;
// a no-op returns the input model itself), `inverse` is an operation that restores the previous model exactly (undo,
// collaboration rebase, agent run logs), `ids` are the ids the operation created or primarily affected, and `map`
// (node.duplicate) maps source ids to copies. Operations are atomic: when one fails it throws an OpError and nothing
// changes. Every node and page an operation touched is validated (validate.js); a structural change is also checked
// for parent cycles, nesting depth and component cycles.
//
// Operations
//   node.create     { type, parent?, page?, index?|before?|after?, id?, fields?, children?: [{ type, id?, fields?, children? }] }
//   node.insert     { nodes: [node] }                         exact nodes (inverse of delete, paste)
//   node.update     { id, set?: { field|"field.sub": value }, unset?: [field|"field.sub"] }   allow-list: UPDATABLE_FIELDS
//   node.move       { ids, parent: id|null, page?, index?|before?|after? }   reorder and reparent (fractional keys)
//   node.place      { items: [{ id, page, parent, ord }] }    exact placement (inverse of move)
//   node.delete     { ids }                                   with subtrees; refused while instances use a component
//   node.duplicate  { ids, offset?: [dx, dy] }                copies right after each source
//   node.wrap       { ids, layout?: "flex"|"grid"|"none", id?, fields? }   wrap siblings in a frame
//   page.create     { id?, name?, bg?, index?|before?|after? } or { page } (restore)
//   page.update     { id, set?, unset? }                      allow-list: PAGE_UPDATABLE
//   page.move       { id, index? | ord? }
//   page.delete     { id }                                    with its layers; the last page cannot be deleted
//   meta.update     { set?, unset? }                          title, created, app
//   batch           { ops: [op] }                             one atomic step
//   restore         { nodes?, pages?, collections?, items?, styles? }   exact state: { id: object | null } (null removes);
//                                                             the inverse of the component, variable and style operations
// Components and instances (components.js, T5):
//   component.create    { ids, name?, id?, layout? }          a frame becomes a component, other layers are wrapped
//   component.combine   { ids, name?, id? }                   components → a component set ("size=md, state=hover" names
//                                                             become variant properties)
//   component.addVariant { set, from?, variant?, name? }      a copy of a variant with new variant values
//   prop.define         { id, name, def }                     add or replace a property definition (cascades to values)
//   prop.rename         { id, name, to } / prop.delete { id, name }
//   prop.bind           { id, layer, field, prop|null }       connect a property to "<layer>.<field>"
//   instance.create     { of, parent?, page?, index?|before?|after?, id?, variant?, props?, fields? }
//   instance.set        { id, variant?, props? }              values; null removes one
//   instance.swap       { id, of }                            another main component, overrides kept
//   instance.override   { id, path, set?, unset? }            fields of a layer inside the instance ("n31/n22")
//   instance.reset      { id, paths?, props? }                remove overrides (and property values)
//   instance.detach     { ids }                               materialize the resolved subtree
// Variables, modes and styles (variables.js, T5):
//   collection.create   { id?, name, modes?: [{ id?, name }], default?, extends? }
//   collection.update   { id, set?, unset? } (name, default, description) / collection.delete { id, detach? }
//   mode.create         { coll, id?, name, from?, index? } / mode.update { coll, id, name } / mode.delete { coll, id }
//   var.create          { id?, coll, name, type, values?|value?, unit?, scopes?, code?, description?, ext? }
//   var.update          { id, set?, unset? }                  e.g. { "values.dark": "#000000" }, { "ext.c2.light": … }
//   var.delete          { ids, detach? }                      refused while used, unless detach (bindings → values)
//   node.bind           { id, path, var|null, force? }        bind a field ("fills.0.color") or replace the binding by
//                                                             its value; checks the variable's scopes unless force
//   style.create        { id?, name, kind, value?, from?: layerId, apply? }
//   style.update        { id, set?, unset? } / style.delete { ids, detach? }
//   style.apply         { ids, slot, style|null }             style.detach { ids, slot? } (bake into local fields)
// Tokens (tokens.js, T5):
//   tokens.import       { tokens, collection?, mode?, replace? }   DTCG JSON into variables and styles
//
// Options: apply(model, op, { random }) — the random source for new ids (tests pass ids.js ▸ seededRandom).
import { keysBetween, isKey } from "../../collab/fractional.js";
import { newId, isId, ID_PREFIX } from "./ids.js";
import { indexOf, adoptIndex, parentKey, pageKey, pageList } from "./tree.js";
import { nodeProblems, pageProblems, componentCycleProblems, varsProblems, stylesProblems } from "./validate.js";
import { variableOps } from "./variables.js";
import { componentOps } from "./components.js";
import { tokenOps } from "./tokens.js";
import { createResolver } from "./resolve.js";
import * as S from "./schema.js";

export class OpError extends Error {
  /** @param {string} code @param {string} message @param {object[]} [problems] */
  constructor(code, message, problems = null) {
    super(message);
    this.name = "OpError";
    this.code = code;
    if (problems) this.problems = problems;
  }
}

const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const COMPONENTISH = new Set(["instance", "component", "componentSet"]);

function clone(v) {
  if (v === undefined) return undefined;
  try {
    return structuredClone(v);
  } catch {
    throw new OpError("value", "Values must be plain JSON data.");
  }
}

// ------------------------------------------------------------------------------------------------- draft

/** A copy-on-write working state for one operation (or one batch). */
class Draft {
  constructor(model, { random = Math.random } = {}) {
    this.base = model;
    this.m = { ...model };
    this.random = random;
    this.ix = null;
    this.nodesOwned = false;
    this.pagesOwned = false;
    this.changed = false;
    this.touched = new Set();
    this.touchedPages = new Set();
    this.created = 0;
    this.structural = false;
    this.components = false;
    this.reserved = new Set();
    this.varsOwned = false;
    this.stylesOwned = false;
    this.varsChanged = false;
    this.stylesChanged = false;
    /** journals of the operations that record their inverse as one `restore` (innermost last) */
    this.journals = [];
  }

  /** Remembers the state of an entry before its first change, for every recording operation. */
  log(kind, id, old) {
    for (const j of this.journals) if (!j[kind].has(id)) j[kind].set(id, old === undefined ? null : old);
  }

  /**
   * Runs `fn` (which returns the ids it created or affected) and returns { inverse, ids } where `inverse` is one
   * `restore` operation that puts back every node, page, collection, variable and style `fn` changed.
   */
  record(fn) {
    const j = { nodes: new Map(), pages: new Map(), collections: new Map(), items: new Map(), styles: new Map() };
    this.journals.push(j);
    let ids;
    try {
      ids = fn();
    } finally {
      this.journals.splice(this.journals.indexOf(j), 1);
    }
    const inverse = { op: "restore" };
    for (const k of Object.keys(j)) if (j[k].size) inverse[k] = Object.fromEntries(j[k]);
    return { inverse, ids: ids || [] };
  }

  /** Makes the cached children index of the working model the live one (for readers such as the resolver). */
  syncIndex() {
    if (this.nodesOwned) adoptIndex(this.m.nodes, this.ix);
  }

  varsForWrite() {
    if (!this.varsOwned) {
      const v = isPlain(this.m.vars) ? this.m.vars : {};
      this.m.vars = { ...v, collections: { ...(isPlain(v.collections) ? v.collections : {}) }, items: { ...(isPlain(v.items) ? v.items : {}) } };
      this.varsOwned = true;
    }
    this.varsChanged = true;
    this.changed = true;
    return this.m.vars;
  }

  /** Sets (or with null removes) a variable collection. */
  putColl(id, c) {
    const v = this.varsForWrite();
    this.log("collections", id, v.collections[id]);
    if (c === null) delete v.collections[id];
    else v.collections[id] = c;
  }

  /** Sets (or with null removes) a variable. */
  putItem(id, item) {
    const v = this.varsForWrite();
    this.log("items", id, v.items[id]);
    if (item === null) delete v.items[id];
    else v.items[id] = item;
  }

  /** Sets (or with null removes) a style. */
  putStyle(id, s) {
    if (!this.stylesOwned) {
      this.m.styles = { ...(isPlain(this.m.styles) ? this.m.styles : {}) };
      this.stylesOwned = true;
    }
    this.log("styles", id, this.m.styles[id]);
    if (s === null) delete this.m.styles[id];
    else this.m.styles[id] = s;
    this.stylesChanged = true;
    this.changed = true;
  }

  node(id) {
    return typeof id === "string" && own(this.m.nodes, id) ? this.m.nodes[id] : undefined;
  }

  need(id) {
    const n = this.node(id);
    if (!n) throw new OpError("not-found", `The layer “${id}” does not exist.`);
    return n;
  }

  index() {
    if (!this.ix) this.ix = indexOf(this.base).fork();
    return this.ix;
  }

  kids(key) {
    return this.index().get(key);
  }

  nodesForWrite() {
    if (!this.nodesOwned) {
      this.index();
      this.m.nodes = { ...this.m.nodes };
      this.nodesOwned = true;
    }
    return this.m.nodes;
  }

  /** Adds or replaces a node, keeping the children index in step. */
  put(node) {
    const nodes = this.nodesForWrite();
    const old = nodes[node.id];
    if (this.journals.length) this.log("nodes", node.id, old);
    const ix = this.index();
    if (!old) {
      nodes[node.id] = node;
      ix.add(nodes, node.id);
      this.created++;
      this.structural = true;
    } else if (parentKey(old) !== parentKey(node) || old.ord !== node.ord) {
      ix.remove(parentKey(old), old.id);
      nodes[node.id] = node;
      ix.add(nodes, node.id);
      this.structural = true;
    } else nodes[node.id] = node;
    if (COMPONENTISH.has(node.type)) this.components = true;
    this.touched.add(node.id);
    this.changed = true;
  }

  drop(id) {
    const nodes = this.nodesForWrite();
    const old = nodes[id];
    if (!old) return;
    if (this.journals.length) this.log("nodes", id, old);
    this.index().remove(parentKey(old), id);
    delete nodes[id];
    this.touched.delete(id);
    this.changed = true;
    this.structural = true;
  }

  page(id) {
    return typeof id === "string" && isPlain(this.m.pages) && own(this.m.pages, id) ? this.m.pages[id] : undefined;
  }

  needPage(id) {
    const p = this.page(id);
    if (!p) throw new OpError("not-found", `The page “${id}” does not exist.`);
    return p;
  }

  putPage(p) {
    if (!this.pagesOwned) {
      this.m.pages = { ...this.m.pages };
      this.pagesOwned = true;
    }
    if (this.journals.length) this.log("pages", p.id, this.m.pages[p.id]);
    this.m.pages[p.id] = p;
    this.touchedPages.add(p.id);
    this.changed = true;
  }

  dropPage(id) {
    if (!this.pagesOwned) {
      this.m.pages = { ...this.m.pages };
      this.pagesOwned = true;
    }
    if (this.journals.length) this.log("pages", id, this.m.pages[id]);
    delete this.m.pages[id];
    this.touchedPages.delete(id);
    this.changed = true;
  }

  newNodeId() {
    const id = newId(ID_PREFIX.node, (x) => own(this.m.nodes, x) || this.reserved.has(x), this.random);
    this.reserved.add(id);
    return id;
  }

  descendants(id) {
    const ix = this.index();
    const out = [];
    const stack = [...ix.get(id)].reverse();
    while (stack.length) {
      const c = stack.pop();
      out.push(c);
      const k = ix.get(c);
      for (let i = k.length - 1; i >= 0; i--) stack.push(k[i]);
    }
    return out;
  }

  /** True when `id` is `anc` or inside it. */
  inside(id, anc) {
    const seen = new Set();
    let cur = id;
    while (cur != null && !seen.has(cur)) {
      if (cur === anc) return true;
      seen.add(cur);
      cur = this.node(cur)?.parent;
    }
    return false;
  }

  depth(id) {
    let d = 0;
    const seen = new Set([id]);
    let p = this.node(id)?.parent;
    while (p != null && !seen.has(p)) {
      seen.add(p);
      d++;
      p = this.node(p)?.parent;
    }
    return d;
  }

  roots(ids) {
    const set = new Set(ids);
    return [...set].filter((id) => {
      let p = this.node(id)?.parent;
      const seen = new Set();
      while (p != null && !seen.has(p)) {
        if (set.has(p)) return false;
        seen.add(p);
        p = this.node(p)?.parent;
      }
      return true;
    });
  }

  finish() {
    if (!this.changed) return this.base;
    const m = this.m;
    if (this.created && Object.keys(m.nodes).length > S.LIMITS.nodes) throw new OpError("limit", `A design can have at most ${S.LIMITS.nodes} layers.`);
    if (Object.keys(m.pages).length > S.LIMITS.pages) throw new OpError("limit", `A design can have at most ${S.LIMITS.pages} pages.`);
    for (const id of this.touched) {
      const n = m.nodes[id];
      if (!n) continue;
      const errs = nodeProblems(m, n).filter((p) => p.severity === "error");
      if (errs.length) throw new OpError("invalid", `${errs[0].path}: ${errs[0].message}`, errs);
    }
    for (const id of this.touchedPages) {
      const p = m.pages[id];
      if (!p) continue;
      const errs = pageProblems(m, p).filter((x) => x.severity === "error");
      if (errs.length) throw new OpError("invalid", `${errs[0].path}: ${errs[0].message}`, errs);
    }
    if (this.varsChanged) {
      const errs = varsProblems(m);
      if (errs.length) throw new OpError("invalid", `${errs[0].path}: ${errs[0].message}`, errs);
    }
    if (this.stylesChanged) {
      const errs = stylesProblems(m);
      if (errs.length) throw new OpError("invalid", `${errs[0].path}: ${errs[0].message}`, errs);
    }
    if (this.structural || this.components) {
      for (const id of this.touched) if (m.nodes[id] && this.depth(id) >= S.LIMITS.depth) throw new OpError("depth", `Layers can be nested at most ${S.LIMITS.depth} levels deep.`);
      if (this.components) {
        const errs = componentCycleProblems(m);
        if (errs.length) throw new OpError("component-cycle", errs[0].message, errs);
      }
    }
    if (this.nodesOwned) adoptIndex(m.nodes, this.ix);
    return m;
  }
}

// ------------------------------------------------------------------------------------------------- helpers

/** The sibling list a position refers to and the insertion index in it. */
function positionIn(sibs, pos) {
  if (pos.before != null) {
    const i = sibs.indexOf(pos.before);
    if (i < 0) throw new OpError("position", `“${pos.before}” is not at the target position.`);
    return i;
  }
  if (pos.after != null) {
    const i = sibs.indexOf(pos.after);
    if (i < 0) throw new OpError("position", `“${pos.after}” is not at the target position.`);
    return i + 1;
  }
  if (pos.index != null) {
    if (!Number.isInteger(pos.index)) throw new OpError("position", "The index must be a whole number.");
    return pos.index < 0 ? Math.max(0, sibs.length + 1 + pos.index) : Math.min(pos.index, sibs.length);
  }
  return sibs.length;
}

/**
 * `n` new order keys for a position among the children of `key` (ignoring `moving`). When neighbors share a key
 * (concurrent inserts elsewhere), the siblings are re-keyed and their old placements are added to `inv`.
 */
function placeKeys(d, key, pos, n, inv, moving = null) {
  const sibs = d.kids(key).filter((id) => !moving?.has(id));
  const i = positionIn(sibs, pos);
  const a = i > 0 ? d.node(sibs[i - 1]).ord : null;
  const b = i < sibs.length ? d.node(sibs[i]).ord : null;
  if ((a === null || isKey(a)) && (b === null || isKey(b)) && (a === null || b === null || a < b)) return keysBetween(a, b, n);
  const keys = keysBetween(null, null, sibs.length + n);
  sibs.forEach((id, k) => {
    const want = k < i ? keys[k] : keys[k + n];
    const node = d.node(id);
    if (node.ord !== want) {
      inv.push({ id, page: node.page, parent: node.parent, ord: node.ord });
      d.put({ ...node, ord: want });
    }
  });
  return keys.slice(i, i + n);
}

const batchOf = (ops) => {
  const list = ops.filter(Boolean);
  return list.length === 1 ? list[0] : { op: "batch", ops: list };
};

function checkPaths(keys) {
  for (const a of keys)
    for (const b of keys) if (a !== b && b.startsWith(`${a}.`)) throw new OpError("path", `“${a}” and “${b}” overlap.`);
  if (new Set(keys).size !== keys.length) throw new OpError("path", "A field is listed twice.");
}

const getPath = (o, segs) => {
  let v = o;
  for (const s of segs) {
    if (!isPlain(v) || !own(v, s)) return undefined;
    v = v[s];
  }
  return v;
};

function setPath(o, segs, value) {
  const [h, ...rest] = segs;
  if (!rest.length) return { ...o, [h]: value };
  const child = own(o, h) ? o[h] : undefined;
  if (child !== undefined && !isPlain(child)) throw new OpError("path", `“${h}” is not an object.`);
  return { ...o, [h]: setPath(child || {}, rest, value) };
}

function unsetPath(o, segs) {
  const [h, ...rest] = segs;
  if (!own(o, h)) return o;
  if (!rest.length) {
    const { [h]: _gone, ...r } = o;
    return r;
  }
  const child = o[h];
  return isPlain(child) ? { ...o, [h]: unsetPath(child, rest) } : o;
}

/**
 * Applies `set` and `unset` (field paths, allow-listed by their first segment) to `target`.
 * Returns { next, inv: { set, unset } } where `inv` restores `target` exactly.
 */
function patch(target, set = {}, unset = [], allowed, what) {
  if (!isPlain(set) || !Array.isArray(unset)) throw new OpError("bad-op", "`set` must be an object and `unset` a list.");
  const keys = [...Object.keys(set), ...unset];
  for (const k of keys) {
    if (typeof k !== "string" || !k) throw new OpError("path", "Field paths are non-empty text.");
    const segs = k.split(".");
    if (segs.some((s) => !s || /^\d+$/.test(s))) throw new OpError("path", `“${k}” is not a field path (list items are replaced as a whole).`);
    if (!allowed.includes(segs[0])) throw new OpError("field", `“${segs[0]}” cannot be changed on a ${what}.`);
  }
  checkPaths(keys);
  let next = target;
  const inv = { set: {}, unset: [] };
  const remember = (segs) => {
    for (let k = 1; k < segs.length; k++) {
      if (getPath(target, segs.slice(0, k)) === undefined) {
        const p = segs.slice(0, k).join(".");
        if (!inv.unset.includes(p)) inv.unset.push(p);
        return;
      }
    }
    const old = getPath(target, segs);
    if (old === undefined) inv.unset.push(segs.join("."));
    else inv.set[segs.join(".")] = old;
  };
  for (const [k, v] of Object.entries(set)) {
    const segs = k.split(".");
    remember(segs);
    next = v === undefined ? unsetPath(next, segs) : setPath(next, segs, clone(v));
  }
  for (const k of unset) {
    const segs = k.split(".");
    if (getPath(target, segs) === undefined) continue;
    remember(segs);
    next = unsetPath(next, segs);
  }
  return { next, inv };
}

/** Component ids a node refers to (instances, swap properties). */
function componentRefs(n) {
  const out = [];
  if (n.type === "instance") {
    if (typeof n.of === "string") out.push(n.of);
    if (isPlain(n.props)) for (const v of Object.values(n.props)) if (typeof v === "string") out.push(v);
  }
  if (isPlain(n.props) && n.type !== "instance")
    for (const d of Object.values(n.props)) {
      if (!isPlain(d) || d.type !== "swap") continue;
      if (typeof d.default === "string") out.push(d.default);
      if (Array.isArray(d.preferred)) for (const x of d.preferred) if (typeof x === "string") out.push(x);
    }
  return out;
}

/** Nodes that depend on the properties of a component or set (its variants and its instances). */
function dependents(d, id) {
  const n = d.node(id);
  const ids = new Set([id]);
  if (n.type === "componentSet") for (const c of d.kids(id)) ids.add(c);
  const out = n.type === "componentSet" ? [...d.kids(id)] : [];
  for (const x of Object.values(d.m.nodes)) if (x.type === "instance" && ids.has(x.of)) out.push(x.id);
  return out;
}

/** Throws when the subtree of `id` reaches deeper than the nesting limit. */
function checkDepth(d, id) {
  let height = 0;
  const stack = [[id, 0]];
  while (stack.length) {
    const [x, h] = stack.pop();
    if (h > height) height = h;
    for (const c of d.kids(x)) stack.push([c, h + 1]);
  }
  if (d.depth(id) + height >= S.LIMITS.depth) throw new OpError("depth", `Layers can be nested at most ${S.LIMITS.depth} levels deep.`);
}

const touch = (d, ids) => {
  for (const id of ids) d.touched.add(id);
};

function fieldsCheck(fields) {
  if (fields === undefined) return {};
  if (!isPlain(fields)) throw new OpError("bad-op", "`fields` must be an object.");
  for (const k of Object.keys(fields)) if (!S.UPDATABLE_FIELDS.includes(k)) throw new OpError("field", `“${k}” cannot be set on a new layer.`);
  return clone(fields);
}

function idList(ids) {
  if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === "string")) throw new OpError("bad-op", "`ids` must be a non-empty list of layer ids.");
  return [...new Set(ids)];
}

// ------------------------------------------------------------------------------------------------- node operations

function target(d, op) {
  const parent = op.parent ?? null;
  let page;
  if (parent !== null) {
    const p = d.need(parent);
    if (!S.isContainer(p.type)) throw new OpError("parent-type", `A ${p.type} cannot contain other layers.`);
    if (op.page != null && op.page !== p.page) throw new OpError("page-mismatch", "The parent is on another page.");
    page = p.page;
  } else {
    page = op.page ?? pageList(d.m)[0]?.id;
    d.needPage(page);
  }
  return { parent, page, key: parent ?? pageKey(page) };
}

function createOp(d, op) {
  const { parent, page, key } = target(d, op);
  const inv = [];
  const [ord] = placeKeys(d, key, op, 1, inv);
  const ids = [];
  const build = (spec, parentId, ordKey) => {
    if (!isPlain(spec)) throw new OpError("bad-op", "A layer spec must be an object.");
    if (!S.NODE_TYPES.includes(spec.type)) throw new OpError("type", `Unknown layer type “${spec.type}”.`);
    const parentNode = parentId != null ? d.node(parentId) : null;
    if (parentNode && !S.isContainer(parentNode.type)) throw new OpError("parent-type", `A ${parentNode.type} cannot contain other layers.`);
    let id = spec.id;
    if (id != null) {
      if (!isId(id)) throw new OpError("id", `“${id}” is not a valid id.`);
      if (d.node(id) || d.reserved.has(id)) throw new OpError("exists", `The id “${id}” is already used.`);
      d.reserved.add(id);
    } else id = d.newNodeId();
    const fields = fieldsCheck(spec.fields);
    const node = { ...S.nodeDefaults(spec.type), ...fields, id, type: spec.type, page, parent: parentId, ord: ordKey };
    const lt = parentNode?.layout?.type;
    // slot content (the children of an instance) flows in the slot's layout
    if (fields.pos === undefined && (lt === "flex" || lt === "grid" || parentNode?.type === "instance")) node.pos = "flow";
    d.put(node);
    ids.push(id);
    const kids = spec.children ?? [];
    if (!Array.isArray(kids)) throw new OpError("bad-op", "`children` must be a list.");
    if (kids.length && !S.isContainer(spec.type)) throw new OpError("parent-type", `A ${spec.type} cannot contain other layers.`);
    const keys = keysBetween(null, null, kids.length);
    kids.forEach((c, i) => build(c, id, keys[i]));
  };
  build({ type: op.type, id: op.id, fields: op.fields, children: op.children }, parent, ord);
  return { inverse: batchOf([{ op: "node.delete", ids: [ids[0]] }, inv.length ? { op: "node.place", items: inv } : null]), ids };
}

function insertOp(d, op) {
  if (!Array.isArray(op.nodes) || !op.nodes.length) throw new OpError("bad-op", "`nodes` must be a non-empty list.");
  const ids = [];
  for (const raw of op.nodes) {
    if (!isPlain(raw) || !isId(raw.id)) throw new OpError("bad-op", "Each node needs a valid id.");
    if (d.node(raw.id) || ids.includes(raw.id)) throw new OpError("exists", `The id “${raw.id}” is already used.`);
    if (!S.NODE_TYPES.includes(raw.type)) throw new OpError("type", `Unknown layer type “${raw.type}”.`);
    if (!isKey(raw.ord)) throw new OpError("invalid", `The layer “${raw.id}” has no valid order key.`);
    ids.push(raw.id);
  }
  for (const raw of op.nodes) d.put(clone(raw));
  for (const id of ids) if (d.node(id).parent != null && d.inside(d.node(id).parent, id)) throw new OpError("cycle", "A layer cannot be inside itself.");
  return { inverse: { op: "node.delete", ids: d.roots(ids) }, ids };
}

function updateOp(d, op) {
  const n = d.need(op.id);
  const { next, inv } = patch(n, op.set, op.unset, S.UPDATABLE_FIELDS, "layer");
  if (next === n) return { inverse: { op: "node.update", id: n.id, set: {}, unset: [] }, ids: [n.id] };
  d.put(next);
  if ((n.type === "component" || n.type === "componentSet") && (own(op.set || {}, "props") || Object.keys(op.set || {}).some((k) => k.startsWith("props.")) || (op.unset || []).some((k) => k === "props" || k.startsWith("props.")))) touch(d, dependents(d, n.id));
  return { inverse: { op: "node.update", id: n.id, set: inv.set, unset: inv.unset }, ids: [n.id] };
}

function moveOp(d, op) {
  const ids = d.roots(idList(op.ids));
  for (const id of ids) d.need(id);
  const parent = op.parent ?? null;
  const { page, key } = target(d, { ...op, page: op.page ?? (parent === null ? d.node(ids[0]).page : undefined) });
  if (parent !== null) for (const id of ids) if (d.inside(parent, id)) throw new OpError("cycle", "A layer cannot be moved into itself.");
  const inv = [];
  for (const id of ids) {
    const n = d.node(id);
    inv.push({ id, page: n.page, parent: n.parent, ord: n.ord });
  }
  const moving = new Set(ids);
  const ords = placeKeys(d, key, op, ids.length, inv, moving);
  ids.forEach((id, i) => {
    const n = d.node(id);
    const pageChanged = n.page !== page;
    d.put({ ...n, page, parent, ord: ords[i] });
    for (const c of d.descendants(id)) {
      const cn = d.node(c);
      if (COMPONENTISH.has(cn.type)) d.components = true;
      if (pageChanged) {
        inv.push({ id: c, page: cn.page, parent: cn.parent, ord: cn.ord });
        d.put({ ...cn, page });
      }
    }
    checkDepth(d, id);
  });
  return { inverse: { op: "node.place", items: inv }, ids };
}

function placeOp(d, op) {
  if (!Array.isArray(op.items) || !op.items.length) throw new OpError("bad-op", "`items` must be a non-empty list.");
  const inv = [];
  const changedPage = [];
  for (const it of op.items) {
    if (!isPlain(it)) throw new OpError("bad-op", "Each item is { id, page, parent, ord }.");
    const n = d.need(it.id);
    if (!isKey(it.ord)) throw new OpError("invalid", `“${it.ord}” is not an order key.`);
    inv.push({ id: n.id, page: n.page, parent: n.parent, ord: n.ord });
    if (n.page !== it.page) changedPage.push(n.id);
    d.put({ ...n, page: it.page, parent: it.parent ?? null, ord: it.ord });
  }
  for (const it of op.items) {
    const p = d.node(it.id).parent;
    if (p != null && d.inside(p, it.id)) throw new OpError("cycle", "A layer cannot be inside itself.");
    for (const c of d.descendants(it.id)) if (COMPONENTISH.has(d.node(c).type)) d.components = true;
  }
  for (const it of op.items) checkDepth(d, it.id);
  for (const id of changedPage) for (const c of d.kids(id)) if (d.node(c).page !== d.node(id).page) throw new OpError("page-mismatch", "A layer must be on the page of its parent.");
  return { inverse: { op: "node.place", items: inv.reverse() }, ids: op.items.map((x) => x.id) };
}

function deleteOp(d, op) {
  const ids = d.roots(idList(op.ids));
  const removed = [];
  for (const id of ids) {
    d.need(id);
    for (const x of [id, ...d.descendants(id)]) removed.push(d.node(x));
  }
  const gone = new Set(removed.map((n) => n.id));
  const comps = new Set(removed.filter((n) => n.type === "component" || n.type === "componentSet").map((n) => n.id));
  if (comps.size)
    for (const n of Object.values(d.m.nodes)) {
      if (gone.has(n.id)) continue;
      const ref = componentRefs(n).find((r) => comps.has(r));
      if (ref) throw new OpError("in-use", `The component “${d.node(ref).name}” is used by “${n.name}”; delete or detach its instances first.`);
    }
  for (const n of [...removed].reverse()) d.drop(n.id);
  return { inverse: { op: "node.insert", nodes: removed }, ids };
}

function remapInteractions(list, map) {
  return list.map((it) => (isPlain(it) && Array.isArray(it.do) ? { ...it, do: remapActions(it.do, map) } : it));
}
function remapActions(list, map) {
  return list.map((a) => {
    if (!isPlain(a)) return a;
    const b = { ...a };
    if (typeof b.to === "string" && map.has(b.to)) b.to = map.get(b.to);
    if (Array.isArray(b.then)) b.then = remapActions(b.then, map);
    if (Array.isArray(b.else)) b.else = remapActions(b.else, map);
    return b;
  });
}

/** Rewrites the references of a copied node that point into the copied set. */
function remap(n, map) {
  const m = (id) => (typeof id === "string" && map.has(id) ? map.get(id) : id);
  if (typeof n.of === "string" && map.has(n.of)) {
    n.of = m(n.of);
    if (isPlain(n.over)) n.over = Object.fromEntries(Object.entries(n.over).map(([k, v]) => [k.split("/").map(m).join("/"), v]));
  }
  if (isPlain(n.bind)) n.bind = Object.fromEntries(Object.entries(n.bind).map(([k, v]) => [k.replace(/^[^.]+/, (id) => m(id)), v]));
  if (isPlain(n.props)) {
    if (n.type === "instance") n.props = Object.fromEntries(Object.entries(n.props).map(([k, v]) => [k, Array.isArray(v) ? v.map(m) : m(v)]));
    else
      for (const [k, def] of Object.entries(n.props))
        if (isPlain(def) && def.type === "swap") n.props[k] = { ...def, ...(def.default != null ? { default: m(def.default) } : {}), ...(Array.isArray(def.preferred) ? { preferred: def.preferred.map(m) } : {}) };
  }
  if (Array.isArray(n.proto)) n.proto = remapInteractions(n.proto, map);
  return n;
}

function duplicateOp(d, op) {
  const ids = d.roots(idList(op.ids));
  const [dx, dy] = Array.isArray(op.offset) ? op.offset : [0, 0];
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new OpError("bad-op", "`offset` is [dx, dy].");
  const map = new Map();
  const groups = ids.map((id) => {
    d.need(id);
    const all = [id, ...d.descendants(id)];
    for (const x of all) map.set(x, d.newNodeId());
    return all;
  });
  const inv = [];
  const newRoots = [];
  groups.forEach((all) => {
    const src = d.node(all[0]);
    const [ord] = placeKeys(d, parentKey(src), { after: src.id }, 1, inv);
    for (const x of all) {
      const n = remap(clone(d.node(x)), map);
      n.id = map.get(x);
      if (x === src.id) {
        n.ord = ord;
        // an omitted position is the default 0, so the offset applies to it as well
        if (dx) n.x = (typeof n.x === "number" ? n.x : 0) + dx;
        if (dy) n.y = (typeof n.y === "number" ? n.y : 0) + dy;
      } else n.parent = map.get(n.parent);
      d.put(n);
    }
    newRoots.push(map.get(src.id));
  });
  return { inverse: batchOf([{ op: "node.delete", ids: newRoots }, inv.length ? { op: "node.place", items: inv } : null]), ids: newRoots, map: Object.fromEntries(map) };
}

const literal = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const sizeOf = (s) => (s?.mode === "fixed" ? literal(s.value) : 0);

function wrapOp(d, op) {
  const ids = d.roots(idList(op.ids));
  const nodes = ids.map((id) => d.need(id));
  const key = parentKey(nodes[0]);
  if (nodes.some((n) => parentKey(n) !== key)) throw new OpError("siblings", "Only layers with the same parent can be wrapped together.");
  const parentNode = nodes[0].parent != null ? d.node(nodes[0].parent) : null;
  if (parentNode?.type === "componentSet") throw new OpError("set-child", "A component set contains only components.");
  const layoutType = op.layout ?? "flex";
  if (!S.LAYOUT_TYPES.includes(layoutType)) throw new OpError("bad-op", `Unknown layout “${layoutType}”.`);
  const sibs = d.kids(key);
  nodes.sort((a, b) => sibs.indexOf(a.id) - sibs.indexOf(b.id));
  const box = (n) => ({ x: literal(n.x), y: literal(n.y), w: sizeOf(n.w), h: sizeOf(n.h) });
  const boxes = new Map(nodes.map((n) => [n.id, box(n)]));
  const bs = [...boxes.values()];
  const minX = Math.min(...bs.map((b) => b.x));
  const minY = Math.min(...bs.map((b) => b.y));
  const maxX = Math.max(...bs.map((b) => b.x + b.w));
  const maxY = Math.max(...bs.map((b) => b.y + b.h));
  let layout = { type: "none" };
  let order = nodes.map((n) => n.id);
  if (layoutType === "flex") {
    const cx = bs.map((b) => b.x + b.w / 2);
    const cy = bs.map((b) => b.y + b.h / 2);
    const dir = Math.max(...cx) - Math.min(...cx) >= Math.max(...cy) - Math.min(...cy) ? "row" : "column";
    const start = (id) => (dir === "row" ? boxes.get(id).x : boxes.get(id).y);
    const len = (id) => (dir === "row" ? boxes.get(id).w : boxes.get(id).h);
    order = [...order].sort((a, b) => start(a) - start(b));
    const gaps = order.slice(1).map((id, i) => Math.max(0, start(id) - (start(order[i]) + len(order[i]))));
    const gap = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : 0;
    layout = { type: "flex", dir, gap, pad: [0, 0, 0, 0], align: "start", justify: "start" };
  } else if (layoutType === "grid") {
    const xs = [...new Set(bs.map((b) => Math.round(b.x)))];
    const cols = Math.max(1, Math.min(12, xs.length));
    order = [...order].sort((a, b) => boxes.get(a).y - boxes.get(b).y || boxes.get(a).x - boxes.get(b).x);
    layout = { type: "grid", gap: 0, rowGap: 0, grid: { cols: Array.from({ length: cols }, () => ({ fr: 1 })), rows: [], autoFlow: "row" } };
  }
  const fields = {
    name: "Frame",
    x: minX,
    y: minY,
    w: layoutType === "none" ? { mode: "fixed", value: maxX - minX } : { mode: "hug" },
    h: layoutType === "none" ? { mode: "fixed", value: maxY - minY } : { mode: "hug" },
    layout,
    clip: false,
    fills: [],
    ...fieldsCheck(op.fields),
  };
  const inverses = [];
  const c = runOp(d, { op: "node.create", type: "frame", parent: nodes[0].parent, page: nodes[0].page, before: nodes[0].id, id: op.id, fields });
  inverses.push(c.inverse);
  const wrapper = c.ids[0];
  inverses.push(runOp(d, { op: "node.move", ids: order, parent: wrapper, index: 0 }).inverse);
  for (const id of order) {
    const n = d.node(id);
    const set = layoutType === "none" ? { pos: "abs", x: literal(n.x) - minX, y: literal(n.y) - minY } : { pos: "flow" };
    if (Object.entries(set).some(([k, v]) => n[k] !== v)) inverses.push(runOp(d, { op: "node.update", id, set }).inverse);
  }
  return { inverse: batchOf(inverses.reverse()), ids: [wrapper] };
}

// ------------------------------------------------------------------------------------------------- pages and meta

function pageCreateOp(d, op) {
  let page;
  if (op.page !== undefined) {
    if (!isPlain(op.page) || !isId(op.page.id)) throw new OpError("bad-op", "`page` must be a page object with an id.");
    if (d.page(op.page.id)) throw new OpError("exists", `The page “${op.page.id}” already exists.`);
    page = clone(op.page);
  } else {
    const id = op.id ?? newId(ID_PREFIX.page, (x) => !!d.page(x), d.random);
    if (!isId(id)) throw new OpError("id", `“${id}” is not a valid id.`);
    if (d.page(id)) throw new OpError("exists", `The page “${id}” already exists.`);
    const list = pageList(d.m).map((p) => p.id);
    const i = positionIn(list, op);
    const a = i > 0 ? d.page(list[i - 1]).ord : null;
    const b = i < list.length ? d.page(list[i]).ord : null;
    let ord;
    try {
      ord = keysBetween(a, b, 1)[0];
    } catch {
      throw new OpError("position", "Pages share an order key; move a page first.");
    }
    page = S.newPage({ id, name: op.name ?? `Page ${list.length + 1}`, ord, bg: op.bg ?? "#f4f4f5" });
  }
  d.putPage(page);
  return { inverse: { op: "page.delete", id: page.id }, ids: [page.id] };
}

function pageUpdateOp(d, op) {
  const p = d.needPage(op.id);
  const { next, inv } = patch(p, op.set, op.unset, S.PAGE_UPDATABLE, "page");
  if (next !== p) d.putPage(next);
  return { inverse: { op: "page.update", id: p.id, set: inv.set, unset: inv.unset }, ids: [p.id] };
}

function pageMoveOp(d, op) {
  const p = d.needPage(op.id);
  let ord = op.ord;
  if (ord !== undefined) {
    if (!isKey(ord)) throw new OpError("invalid", `“${ord}” is not an order key.`);
  } else {
    const list = pageList(d.m)
      .map((x) => x.id)
      .filter((x) => x !== p.id);
    const i = positionIn(list, op);
    const a = i > 0 ? d.page(list[i - 1]).ord : null;
    const b = i < list.length ? d.page(list[i]).ord : null;
    try {
      ord = keysBetween(a, b, 1)[0];
    } catch {
      throw new OpError("position", "Pages share an order key at that position.");
    }
  }
  if (ord !== p.ord) d.putPage({ ...p, ord });
  return { inverse: { op: "page.move", id: p.id, ord: p.ord }, ids: [p.id] };
}

function pageDeleteOp(d, op) {
  const p = d.needPage(op.id);
  if (Object.keys(d.m.pages).length <= 1) throw new OpError("last-page", "A design needs at least one page.");
  const top = [...d.kids(pageKey(p.id))];
  const r = top.length ? runOp(d, { op: "node.delete", ids: top }) : null;
  d.dropPage(p.id);
  return { inverse: batchOf([{ op: "page.create", page: p }, r?.inverse]), ids: [p.id] };
}

const META_FIELDS = ["title", "created", "app"];

function metaUpdateOp(d, op) {
  const meta = isPlain(d.m.meta) ? d.m.meta : {};
  const { next, inv } = patch(meta, op.set, op.unset, META_FIELDS, "document");
  for (const k of META_FIELDS) if (next[k] !== undefined && (typeof next[k] !== "string" || next[k].length > 1000)) throw new OpError("invalid", `meta.${k}: Expected text.`);
  if (next !== meta) {
    d.m.meta = next;
    d.changed = true;
  }
  return { inverse: { op: "meta.update", set: inv.set, unset: inv.unset }, ids: [] };
}

function batchOp(d, op) {
  if (!Array.isArray(op.ops)) throw new OpError("bad-op", "`ops` must be a list.");
  const inverses = [];
  const ids = [];
  for (const o of op.ops) {
    const r = runOp(d, o);
    inverses.push(r.inverse);
    ids.push(...r.ids);
  }
  return { inverse: { op: "batch", ops: inverses.reverse() }, ids };
}

/** Exact state of entries: { kind: { id: object | null } }; the inverse of recording operations. */
function restoreOp(d, op) {
  return d.record(() => {
    const ids = [];
    const map = (k) => {
      const v = op[k];
      if (v === undefined) return [];
      if (!isPlain(v)) throw new OpError("bad-op", `\`${k}\` must be an object of id → value.`);
      for (const [id, x] of Object.entries(v)) if (x !== null && !isPlain(x)) throw new OpError("bad-op", `${k}.${id} must be an object or null.`);
      return Object.entries(v);
    };
    const nodes = map("nodes");
    for (const [id, n] of nodes) if (n === null) d.drop(id);
    for (const [id, n] of nodes)
      if (n !== null) {
        if (n.id !== id || !S.NODE_TYPES.includes(n.type) || !isKey(n.ord)) throw new OpError("invalid", `The layer “${id}” is not a valid layer.`);
        d.put(n);
        ids.push(id);
      }
    for (const [id, n] of nodes) if (n === null && d.kids(id).length) throw new OpError("orphans", `Removing “${id}” would leave its children without a parent.`);
    for (const [id, n] of nodes)
      if (n !== null) {
        if (n.parent != null && d.inside(n.parent, id)) throw new OpError("cycle", "A layer cannot be inside itself.");
        checkDepth(d, id);
      }
    const pages = map("pages");
    for (const [id, p] of pages) {
      if (p === null) {
        if (d.kids(pageKey(id)).length) throw new OpError("orphans", `The page “${id}” still has layers.`);
        d.dropPage(id);
      } else {
        if (p.id !== id) throw new OpError("invalid", `The page “${id}” is not a valid page.`);
        d.putPage(p);
      }
    }
    for (const [id, c] of map("collections")) d.putColl(id, c);
    for (const [id, v] of map("items")) d.putItem(id, v);
    for (const [id, s] of map("styles")) d.putStyle(id, s);
    return ids;
  });
}

const HANDLERS = {
  restore: restoreOp,
  "node.create": createOp,
  "node.insert": insertOp,
  "node.update": updateOp,
  "node.move": moveOp,
  "node.place": placeOp,
  "node.delete": deleteOp,
  "node.duplicate": duplicateOp,
  "node.wrap": wrapOp,
  "page.create": pageCreateOp,
  "page.update": pageUpdateOp,
  "page.move": pageMoveOp,
  "page.delete": pageDeleteOp,
  "meta.update": metaUpdateOp,
  batch: batchOp,
};

const KIT = { OpError, runOp: (d, op) => runOp(d, op), patch, clone, createResolver };
Object.assign(HANDLERS, componentOps(KIT), variableOps(KIT), tokenOps(KIT));

/** Names of every operation. */
export const OPS = Object.freeze(Object.keys(HANDLERS));

function runOp(d, op) {
  if (!isPlain(op) || typeof op.op !== "string" || !own(HANDLERS, op.op)) throw new OpError("bad-op", `Unknown operation “${isPlain(op) ? op.op : op}”.`);
  return HANDLERS[op.op](d, op);
}

/**
 * Applies one operation (see the header). Throws OpError; the input model is never changed.
 * @param {object} model
 * @param {object} op
 * @param {{ random?: () => number }} [opts]
 * @returns {{ model: object, inverse: object, ids: string[], map?: Record<string, string> }}
 */
export function apply(model, op, opts = {}) {
  if (!isPlain(model) || !isPlain(model.nodes) || !isPlain(model.pages)) throw new OpError("bad-model", "Not a Proto model.");
  const d = new Draft(model, opts);
  const r = runOp(d, op);
  const next = d.finish();
  const out = { model: next, inverse: r.inverse, ids: r.ids };
  if (r.map) out.map = r.map;
  if (r.report) out.report = r.report;
  return out;
}

/** Applies several operations as one atomic step; the inverse is one batch. */
export function applyAll(model, ops, opts = {}) {
  return apply(model, { op: "batch", ops }, opts);
}

// Convenience wrappers: each returns the same result as apply().
export const createNode = (model, args, opts) => apply(model, { ...args, op: "node.create" }, opts);
export const insertNodes = (model, nodes, opts) => apply(model, { op: "node.insert", nodes }, opts);
export const updateNode = (model, id, set = {}, unset = [], opts) => apply(model, { op: "node.update", id, set, unset }, opts);
export const moveNodes = (model, ids, to, opts) => apply(model, { ...to, op: "node.move", ids }, opts);
export const placeNodes = (model, items, opts) => apply(model, { op: "node.place", items }, opts);
export const deleteNodes = (model, ids, opts) => apply(model, { op: "node.delete", ids }, opts);
export const duplicateNodes = (model, ids, offset, opts) => apply(model, { op: "node.duplicate", ids, ...(offset ? { offset } : {}) }, opts);
export const wrapNodes = (model, ids, layout = "flex", extra = {}, opts) => apply(model, { ...extra, op: "node.wrap", ids, layout }, opts);
export const createPage = (model, args = {}, opts) => apply(model, { ...args, op: "page.create" }, opts);
export const updatePage = (model, id, set = {}, unset = [], opts) => apply(model, { op: "page.update", id, set, unset }, opts);
export const movePage = (model, id, to, opts) => apply(model, { ...to, op: "page.move", id }, opts);
export const deletePage = (model, id, opts) => apply(model, { op: "page.delete", id }, opts);
export const updateMeta = (model, set = {}, unset = [], opts) => apply(model, { op: "meta.update", set, unset }, opts);
