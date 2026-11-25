// "Edit together" adapter of the Proto Studio (docs/concepts/proto-studio.md §13, docs/collaboration.md). Pure: no
// DOM; tests in tests/proto/collab.test.js. Loaded by ui/collab/live.js when a Proto design is shared live and used
// through collab/office-sync.js (the record engine of the Office Suite and the Scene Studio: last writer wins per
// record, out-of-order delivery, chunked media, late joiners through the CRDT state).
//
// Records (one record per key; two people editing different records of one layer both win):
//   n:<id>         structure: type, page, parent, ord, name, visible, locked
//   n:<id>/geo     x, y, rot, w, h, pos, cx, cy, cell             n:<id>/lay    layout, clip, scroll, sticky
//   n:<id>/look    fills, strokes, radius, effects, opacity, blend, style
//   n:<id>/text    text, d, rule, alt (the content of text, vector and image layers)
//   n:<id>/comp    props, variant, bind, of, over, code           n:<id>/proto  proto, tag, a11y, modes
//   n:<id>/x       fields this version does not know (forward compatibility; a group record is absent when empty)
//   p:<id>  pages   vc:<id>  variable collections   v:<id>  variables   s:<id>  styles   media:<id>  media (no bytes)
//   meta:<key>     every other top-level value as a whole (meta, breakpoints, code, and anything a later task adds)
// Media bytes travel as chunk records of office-sync.js (`inlineMedia` 0).
//
// Generic over the model: COLLECTIONS lists the id-keyed maps that sync entry by entry. A new id-keyed map (a later
// task's `model.foo = { id: {…} }`) syncs without code changes as one `meta:foo` record; adding `{ prefix, path }` to
// COLLECTIONS makes it sync per entry (and validated per entry). The node field groups follow schema.js ▸ NODE_FIELDS:
// a field missing from GROUPS travels in `n:<id>/x`.
//
// Remote records are checked before they reach the model: values must be plain objects with ids matching their keys,
// nodes go through validate.js ▸ nodeProblems and pages, collections and meta values through validate.js on a model
// without layers. Shape errors (wrong types, unknown enumerations, oversized values) reject the record (the model keeps
// its value; office-sync retries the key with the next message, so nothing is lost when a later record fixes it).
// Reference problems (a variable, component or parent that has not arrived or was removed concurrently) are accepted:
// the resolver treats them as warnings, and rejecting them would make replicas diverge.
//
// Tree integrity is restored deterministically from the records, so every replica shows the same tree:
//   * a layer whose page is missing is not shown (it reappears when its page does);
//   * a layer whose parent is missing (deleted concurrently), is no container, is on another page, or a non-component
//     inside a component set is shown at the top level of its page instead of being lost;
//   * concurrent moves that form a parent cycle are broken at the layer with the smallest id (shown at the top level).
// Such placements stay local until someone edits the layer (office-sync keeps the record "unapplied" and retries it).
import { isContainer, nodeDefaults } from "../engine/proto/schema.js";
import { nodeProblems, validate } from "../engine/proto/validate.js";
import { indexOf, adoptIndex, parentKey, pageKey } from "../engine/proto/tree.js";
import { loadModel } from "../engine/proto/format.js";
import { isId } from "../engine/proto/ids.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Node field groups (record suffix → fields). The structure record `n:<id>` has no suffix. */
export const STRUCT = Object.freeze(["type", "page", "parent", "ord", "name", "visible", "locked"]);
export const GROUPS = Object.freeze({
  geo: Object.freeze(["x", "y", "rot", "w", "h", "pos", "cx", "cy", "cell"]),
  lay: Object.freeze(["layout", "clip", "scroll", "sticky"]),
  look: Object.freeze(["fills", "strokes", "radius", "effects", "opacity", "blend", "style"]),
  text: Object.freeze(["text", "d", "rule", "alt"]),
  comp: Object.freeze(["props", "variant", "bind", "of", "over", "code"]),
  proto: Object.freeze(["proto", "tag", "a11y", "modes"]),
});
const KNOWN = new Set(["id", ...STRUCT, ...Object.values(GROUPS).flat()]);
const EXTRA = "x";
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Id-keyed maps that sync entry by entry: `<prefix>:<id>` holds `model[path…][id]` (see the header). */
export const COLLECTIONS = Object.freeze([
  Object.freeze({ prefix: "p", path: Object.freeze(["pages"]) }),
  Object.freeze({ prefix: "vc", path: Object.freeze(["vars", "collections"]) }),
  Object.freeze({ prefix: "v", path: Object.freeze(["vars", "items"]) }),
  Object.freeze({ prefix: "s", path: Object.freeze(["styles"]) }),
  Object.freeze({ prefix: "media", path: Object.freeze(["media"]), media: true }),
]);
/** Top-level keys that are not records: the schema version, the node map, and the container's bookkeeping. */
const SKIP_TOP = new Set(["schema", "nodes", "kind", "_raw"]);
const MEDIA_INFO = ["mime", "name", "w", "h"];

/**
 * Validation problems that depend on other records (accepted, see the header). Everything else rejects a record.
 * The list covers validate.js on main and the component and variable codes of T5.
 */
const REFERENCE_CODES = new Set([
  "missing-page", "missing-parent", "missing-component", "missing-variable", "missing-collection", "missing-mode",
  "missing-style", "missing-prop", "page-mismatch", "parent-type", "set-child", "cycle", "alias-cycle",
  "component-cycle", "depth", "limit", "no-pages", "binding-type", "variant-prop", "ext-collection", "extends-modes",
  "bind-field", "slot", "style-kind",
]);
const shapeErrors = (problems) => problems.filter((p) => p.severity === "error" && !REFERENCE_CODES.has(p.code));

// ----------------------------------------------------------------------------------------------- canonical values

/** A copy with object keys sorted (deep), so equal values compare equal as JSON on every replica. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (!isObj(v)) return v;
  const out = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canon(v[k]);
  return out;
}

const at = (obj, path) => {
  let v = obj;
  for (const k of path) v = isObj(v) ? v[k] : undefined;
  return v;
};

// ----------------------------------------------------------------------------------------------- records

const nodeCache = new WeakMap(); // node object → its records (nodes are immutable, so unchanged layers reuse them)
const valueCache = new WeakMap(); // page, variable, style … object → canonical value

function nodeRecords(n, id) {
  let out = nodeCache.get(n);
  if (out) return out;
  out = {};
  const struct = {};
  for (const f of STRUCT) if (n[f] !== undefined) struct[f] = canon(n[f]);
  out[`n:${id}`] = struct;
  for (const [g, fields] of Object.entries(GROUPS)) {
    let rec = null;
    for (const f of fields) if (n[f] !== undefined) (rec ||= {})[f] = canon(n[f]);
    if (rec) out[`n:${id}/${g}`] = rec;
  }
  let extra = null;
  for (const k of Object.keys(n).sort()) if (!KNOWN.has(k) && n[k] !== undefined) (extra ||= {})[k] = canon(n[k]);
  if (extra) out[`n:${id}/${EXTRA}`] = extra;
  nodeCache.set(n, out);
  return out;
}

function entryValue(spec, v) {
  let out = valueCache.get(v);
  if (out) return out;
  if (spec.media) {
    out = {};
    for (const k of MEDIA_INFO) if (v[k] !== undefined && typeof v[k] !== "object") out[k] = v[k];
  } else {
    const { id: _id, ...rest } = v;
    out = canon(rest);
  }
  valueCache.set(v, out);
  return out;
}

/** The value of `meta:<key>`: the top-level value without the maps COLLECTIONS syncs per entry. */
function metaValue(model, key) {
  const v = model[key];
  const nested = COLLECTIONS.filter((c) => c.path.length > 1 && c.path[0] === key);
  if (!nested.length || !isObj(v)) return canon(v);
  const rest = { ...v };
  for (const c of nested) if (c.path.length === 2) delete rest[c.path[1]];
  return Object.keys(rest).length ? canon(rest) : undefined;
}

/** Records of a Proto model (see the header). */
export function protoRecords(model) {
  const out = {};
  if (!isObj(model)) return out;
  for (const [id, n] of Object.entries(model.nodes || {})) if (isObj(n)) Object.assign(out, nodeRecords(n, id));
  for (const spec of COLLECTIONS) {
    const map = at(model, spec.path);
    if (!isObj(map)) continue;
    for (const [id, v] of Object.entries(map)) if (isObj(v)) out[`${spec.prefix}:${id}`] = entryValue(spec, v);
  }
  for (const key of Object.keys(model)) {
    if (SKIP_TOP.has(key) || COLLECTIONS.some((c) => c.path.length === 1 && c.path[0] === key)) continue;
    const v = metaValue(model, key);
    if (v !== undefined) out[`meta:${key}`] = v;
  }
  return out;
}

// ----------------------------------------------------------------------------------------------- applying

function parseKey(k) {
  const i = k.indexOf(":");
  if (i <= 0) return null;
  const kind = k.slice(0, i);
  const rest = k.slice(i + 1);
  if (kind === "n") {
    const j = rest.indexOf("/");
    const id = j < 0 ? rest : rest.slice(0, j);
    const group = j < 0 ? null : rest.slice(j + 1);
    if (!isId(id) || (group !== null && group !== EXTRA && !GROUPS[group])) return null;
    return { kind: "n", id, group };
  }
  if (kind === "meta") return isId(rest) && !SKIP_TOP.has(rest) && !BAD_KEYS.has(rest) ? { kind: "meta", key: rest } : null;
  const spec = COLLECTIONS.find((c) => c.prefix === kind);
  return spec && isId(rest) ? { kind: "entry", spec, id: rest } : null;
}

/** Sets `model[path…] = value` immutably (creating plain objects on the way). */
function setAt(model, path, value) {
  if (!path.length) return value;
  const [k, ...rest] = path;
  const base = isObj(model) ? model : {};
  return { ...base, [k]: setAt(base[k], rest, value) };
}

/** Applies the non-node records; returns the next model and the keys it rejected. */
function applyTop(model, list) {
  let next = model;
  const entries = []; // { key, path, prefix, id, value }
  for (const { k, p, v } of list) {
    if (p.kind === "entry") {
      const map = at(next, p.spec.path);
      const cur = isObj(map) ? map[p.id] : undefined;
      let val;
      if (v === null) val = undefined;
      else if (!isObj(v)) continue;
      else if (p.spec.media) {
        val = { ...(isObj(cur) ? cur : {}), id: p.id };
        for (const f of MEDIA_INFO) {
          if (v[f] !== undefined && typeof v[f] !== "object") val[f] = v[f];
          else delete val[f];
        }
      } else val = { ...v, id: p.id };
      const nextMap = { ...(isObj(map) ? map : {}) };
      if (val === undefined) delete nextMap[p.id];
      else nextMap[p.id] = val;
      next = setAt(next, p.spec.path, nextMap);
      entries.push({ k, check: `${p.spec.path.join(".")}.${p.id}`, revert: (m) => setAt(m, p.spec.path, revertMap(at(m, p.spec.path), p.id, cur)) });
    } else {
      const key = p.key;
      const cur = model[key];
      const nested = COLLECTIONS.filter((c) => c.path.length === 2 && c.path[0] === key);
      let val;
      if (nested.length) {
        // keep the per-entry maps; the record holds the rest of the object
        const keep = {};
        for (const c of nested) if (isObj(next[key]) && next[key][c.path[1]] !== undefined) keep[c.path[1]] = next[key][c.path[1]];
        val = { ...(isObj(v) ? v : {}), ...keep };
      } else val = v === null ? undefined : v;
      next = { ...next };
      if (val === undefined) delete next[key];
      else next[key] = val;
      entries.push({ k, check: key, nested: nested.map((c) => c.path.join(".")), revert: (m) => {
        const out = { ...m };
        if (cur === undefined) delete out[key];
        else if (nested.length && isObj(cur)) {
          const keep = {};
          for (const c of nested) if (isObj(m[key]) && m[key][c.path[1]] !== undefined) keep[c.path[1]] = m[key][c.path[1]];
          out[key] = { ...cur, ...keep };
        } else out[key] = cur;
        return out;
      } });
    }
  }
  if (!entries.length) return { model: next, rejected: [] };
  // one validation of everything but the layers; errors under a changed record that are about its shape reject it
  const res = validate({ ...next, schema: model.schema, nodes: {} }, { maxProblems: 5000 });
  const errors = shapeErrors(res.errors);
  const rejected = [];
  for (const e of entries) {
    const under = (path) => path === e.check || path.startsWith(`${e.check}.`) || path.startsWith(`${e.check}[`);
    const bad = errors.some((er) => under(er.path) && !(e.nested || []).some((n) => er.path === n || er.path.startsWith(`${n}.`)));
    if (bad) {
      next = e.revert(next);
      rejected.push(e.k);
    }
  }
  return { model: next, rejected };
}

function revertMap(map, id, cur) {
  const out = { ...(isObj(map) ? map : {}) };
  if (cur === undefined) delete out[id];
  else out[id] = cur;
  return out;
}

/** Removes `ids` and their subtrees (by the index of `prev`) from `nodes`. */
function removeSubtrees(ix, nodes, ids, touched) {
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop();
    if (nodes[id]) {
      delete nodes[id];
      touched.add(id);
    }
    for (const c of ix.get(id)) stack.push(c);
  }
}

/** A layer with its structure record replaced (`cur` may be null for a new layer). */
function withStruct(cur, s, id) {
  const n = {};
  if (cur) for (const k of Object.keys(cur)) if (!STRUCT.includes(k)) n[k] = cur[k];
  for (const f of STRUCT) if (s[f] !== undefined) n[f] = s[f];
  if (n.parent === undefined) n.parent = null;
  n.id = id;
  return complete(n);
}

/**
 * Fields a layer cannot do without get their defaults: a text layer whose text record was removed by a concurrent
 * deletion while someone renamed it (the rename brings the layer back) shows the default text on every replica.
 */
function complete(n) {
  if (n.type === "text" && n.text === undefined) n.text = nodeDefaults("text").text;
  return n;
}

/** A layer with one field group replaced (`v` null removes the group's fields). */
function withGroup(cur, g, v) {
  const n = { ...cur };
  const fields = g === EXTRA ? Object.keys(n).filter((k) => !KNOWN.has(k)) : GROUPS[g];
  for (const f of fields) delete n[f];
  if (!isObj(v)) return complete(n);
  const take = g === EXTRA ? Object.keys(v).filter((k) => !KNOWN.has(k) && !BAD_KEYS.has(k)) : fields;
  for (const f of take) if (v[f] !== undefined) n[f] = v[f];
  return complete(n);
}

const problemKeys = (model, n) => new Set(shapeErrors(nodeProblems(model, n)).map((p) => `${p.path} ${p.code}`));

function applyNodes(prev, next, byNode, removedPages) {
  const old = isObj(prev.nodes) ? prev.nodes : {};
  const oldIx = indexOf(prev);
  const nodes = { ...old };
  const touched = new Set();
  for (const [id, ch] of byNode) {
    const cur = old[id];
    if (ch.s === null) {
      if (cur) {
        delete nodes[id];
        touched.add(id);
      }
      continue;
    }
    if (ch.s === undefined && !cur) continue; // fields of a layer whose structure has not arrived: retried later
    if (ch.s !== undefined && !isObj(ch.s)) continue;
    let n = cur || null;
    if (ch.s !== undefined) n = withStruct(n, ch.s, id);
    for (const [g, v] of Object.entries(ch.g)) n = withGroup(n, g, v);
    nodes[id] = n;
    touched.add(id);
  }
  const model = { ...next, nodes };
  // shape validation of every changed layer (references are looked up in the new model); when the layer as a whole
  // fails, its records are tried one by one, so one bad record does not hold back the good ones
  for (const id of touched) {
    const n = nodes[id];
    if (!n) continue;
    const cur = old[id] || null;
    const base = cur ? problemKeys(model, cur) : new Set();
    const bad = (x) => shapeErrors(nodeProblems(model, x)).some((p) => !base.has(`${p.path} ${p.code}`));
    if (!bad(n)) continue;
    const ch = byNode.get(id);
    let ok = cur;
    if (ch.s !== undefined) {
      const s = withStruct(ok, ch.s, id);
      if (!bad(s)) ok = s;
    }
    if (ok) {
      for (const [g, v] of Object.entries(ch.g)) {
        const x = withGroup(ok, g, v);
        if (!bad(x)) ok = x;
      }
    }
    if (ok) nodes[id] = ok;
    else delete nodes[id];
  }
  // pages: layers of removed pages leave with them; a layer whose page is missing is not shown
  if (removedPages.length) removeSubtrees(oldIx, nodes, removedPages.map(pageKey), touched);
  const pages = isObj(next.pages) ? next.pages : {};
  for (const id of [...touched]) {
    const n = nodes[id];
    if (n && !isObj(pages[n.page])) removeSubtrees(oldIx, nodes, [id], touched);
  }
  // placement: the changed layers and the old children of changed layers
  const check = new Set(touched);
  for (const id of touched) for (const c of oldIx.get(id)) check.add(c);
  const lift = (id) => {
    nodes[id] = { ...nodes[id], parent: null };
    touched.add(id);
  };
  for (const id of check) {
    // parent cycles: the layer with the smallest id on the cycle goes to the top level
    const n = nodes[id];
    if (!n || n.parent == null) continue;
    const seen = new Set([id]);
    let cur = n.parent;
    while (cur != null && nodes[cur] && !seen.has(cur)) {
      seen.add(cur);
      cur = nodes[cur].parent;
    }
    if (cur !== id) continue;
    let min = id;
    for (let c = nodes[id].parent; c !== id; c = nodes[c].parent) if (c < min) min = c;
    lift(min);
  }
  for (const id of check) {
    const n = nodes[id];
    if (!n || n.parent == null) continue;
    const p = nodes[n.parent];
    if (!p || !isContainer(p.type) || p.page !== n.page || (p.type === "componentSet" && n.type !== "component")) lift(id);
  }
  // the children index, updated for the touched layers only (ops.js does the same for local edits)
  const ix = oldIx.fork();
  const moved = (o, n) => !o || !n || parentKey(o) !== parentKey(n) || o.ord !== n.ord;
  for (const id of touched) {
    const o = old[id];
    if (o && moved(o, nodes[id])) ix.remove(parentKey(o), id);
  }
  for (const id of touched) {
    const n = nodes[id];
    if (n && moved(old[id], n)) ix.add(nodes, id);
  }
  adoptIndex(nodes, ix);
  return model;
}

/** Writes changed records into a model (`changes`: key → value, null = removed). Returns a new model. */
export function applyProtoRecords(model, changes) {
  if (!isObj(model)) return model;
  const top = [];
  const byNode = new Map();
  const removedPages = [];
  for (const [k, v] of Object.entries(changes || {})) {
    const p = parseKey(k);
    if (!p) continue;
    if (p.kind === "n") {
      if (!byNode.has(p.id)) byNode.set(p.id, { s: undefined, g: {} });
      const ch = byNode.get(p.id);
      if (p.group === null) ch.s = v ?? null;
      else ch.g[p.group] = v ?? null;
    } else {
      top.push({ k, p, v: v ?? null });
      if (p.kind === "entry" && p.spec.prefix === "p" && v == null && isObj(model.pages?.[p.id])) removedPages.push(p.id);
    }
  }
  let next = model;
  if (top.length) {
    const r = applyTop(model, top);
    next = r.model;
    // a rejected page removal keeps the page and its layers
    for (const k of r.rejected) {
      const i = removedPages.indexOf(k.slice(2));
      if (k.startsWith("p:") && i >= 0) removedPages.splice(i, 1);
    }
  }
  if (byNode.size || removedPages.length) next = applyNodes(model, next, byNode, removedPages);
  return next;
}

/**
 * A design that arrived as a file (the snapshot of a live share) still has its container fields; bring it into the
 * shape the studio edits (proto/workspace.js ▸ ensureProto does the same when the design is mounted).
 */
function prepare(prj) {
  if (!prj?.model?._raw) return;
  try {
    prj.model = loadModel(prj.model, { validate: false }).model;
  } catch {
    /* not a Proto model: the binding fails with its own message */
  }
}

export const protoCollabAdapter = Object.freeze({ records: protoRecords, applyRecords: applyProtoRecords, inlineMedia: 0, prepare });
