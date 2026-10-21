// "Edit together" (beta) for design documents (Vector, Pixel structure, Layout): a replicated tree of registers.
// Pure (no DOM). Decision record: docs/adr/0011-live-editing-sync.md. Protocol: docs/collaboration.md ▸ Live editing.
//
// Model. Every node, page, page root, story, asset and the document's own settings is an ENTRY keyed by its id. An entry
// holds last-writer-wins registers, each stamped with a clock [lamport, site] (site = member id of the writer):
//   pos   { parent, key, q?, qk? }  where it sits: parent id (or a virtual root "#pages", "#masters", "#stories",
//                                   "#assets") and a fractional ordering key (collab/fractional.js); q/qk = where it was
//                                   before a move (used only to break move cycles)
//   live  true | false              exists or is deleted (tombstones are kept for the whole session)
//   props { field: JSON text }      one register per field (fill, m, name, story, w, ...)
// Clocks compare by lamport, then site (string order), so every replica picks the same winner. Applying an op is
// commutative, associative and idempotent, so replicas that received the same set of ops hold the same state in any
// delivery order (tests/collab/tree-crdt.test.js checks this with seeded random histories).
//
// Conflict policy (documented in docs/collaboration.md):
//   * the same field of the same entry: the later clock wins (last writer wins);
//   * delete vs. concurrent edit: delete wins (edits never touch `live`); an explicit restore (undo of a delete) after
//     seeing the delete brings the entry back (`add` writes live = true with a newer clock);
//   * a node is visible only if its whole parent chain is visible (deleting a group hides what others add inside);
//   * siblings are ordered by (key, id): concurrent inserts at the same place never interleave differently;
//   * concurrent moves that would form a cycle: the move with the highest clock is undone (its entry goes back to `q`).
//
// Ops (wire format, validated by validateTreeOp):
//   { o:"add", id, p, k, v:{field:value}, c }    create or restore (sets pos, live=true and every field)
//   { o:"set", id, f, v?, c }                    one field; no `v` deletes the field
//   { o:"del", id, c }                           live = false
//   { o:"mv",  id, p, k, q?, qk?, c }            move / reorder
// `c` is the lamport number; the site is NOT on the wire: receivers use the authenticated sender id.
//
// Public API
//   class TreeCRDT  .site .lamport .apply(op, site) .applyLocal(ops) → stamped ops .view() .propsOf(id) .toJSON()
//                   static fromJSON(json) static fromFlat(flat)
//   flattenDoc(doc, cache?) → Map(id → { parent, slot, index, props: Map(field → JSON text) })
//   diffOps(crdt, flat) → unstamped ops that turn the CRDT view into `flat`
//   validateTreeOp(op) → cleaned op | throws
import { keyBetween, keysBetween, initialKey, isKey } from "./fractional.js";

export const DOC_ID = "#doc";
export const ROOTS = Object.freeze({ pages: "#pages", masters: "#masters", stories: "#stories", assets: "#assets" });
const VIRTUAL = new Set(Object.values(ROOTS));
export const SLOT_KEYS = Object.freeze({ root: "#root", mask: "#mask", none: "~" });
const SPECIAL_KEYS = new Set(Object.values(SLOT_KEYS));
/** Document-level fields that travel live (others such as comments, web and office projects do not). */
export const DOC_FIELDS = Object.freeze(["name", "dpi", "unit", "styles", "swatches", "slices", "tableStyles", "settings"]);
const SKIP_NODE = new Set(["id", "children", "mask"]);
const SKIP_PAGE = new Set(["id", "root"]);
const ASSET_FIELDS = ["name", "mime", "w", "h"];

export const TREE_LIMITS = Object.freeze({ valueChars: 96 * 1024, depth: 32, opsPerMessage: 512, maxLamport: 2 ** 48 });

export const cmpClock = (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const newer = (c, reg) => !reg || cmpClock(c, reg.c) > 0;

export class TreeCRDT {
  constructor(site = "") {
    this.site = site;
    this.lamport = 0;
    /** @type {Map<string, {id:string, pos:any, live:any, props:Map<string,{v:string|null,c:[number,string]}>}>} */
    this.entries = new Map();
    this._view = null;
  }

  entry(id) {
    let e = this.entries.get(id);
    if (!e) this.entries.set(id, (e = { id, pos: null, live: null, props: new Map() }));
    return e;
  }

  /**
   * Applies one (validated) op written by `site`. Returns what changed:
   * { id, structural, fields: [field], overwrote: [{ field, site, c }] } (overwrote: registers whose previous value
   * came from another write and was replaced; the UI uses it to detect lost concurrent edits).
   */
  apply(op, site) {
    const c = [op.c, site];
    if (op.c > this.lamport) this.lamport = op.c;
    const e = this.entry(op.id);
    const out = { id: op.id, structural: false, fields: [], overwrote: [] };
    const setField = (f, v) => {
      const reg = e.props.get(f);
      if (!newer(c, reg)) return;
      const s = v === undefined ? null : JSON.stringify(v);
      if (reg && reg.v !== s) out.overwrote.push({ field: f, site: reg.c[1], c: reg.c });
      e.props.set(f, { v: s, c });
      out.fields.push(f);
    };
    switch (op.o) {
      case "add":
        if (newer(c, e.live)) {
          if (e.live && !e.live.v) out.structural = true;
          if (!e.live) out.structural = true;
          e.live = { v: true, c };
        }
        if (newer(c, e.pos)) {
          e.pos = { parent: op.p, key: op.k, c };
          out.structural = true;
        }
        for (const f of Object.keys(op.v || {})) setField(f, op.v[f]);
        break;
      case "set":
        setField(op.f, op.v);
        break;
      case "del":
        if (newer(c, e.live)) {
          if (e.live?.v !== false) out.overwrote.push({ field: "#live", site: e.live?.c[1] ?? "", c: e.live?.c ?? [0, ""] });
          e.live = { v: false, c };
          out.structural = true;
        }
        break;
      case "mv":
        if (newer(c, e.pos)) {
          e.pos = { parent: op.p, key: op.k, c, ...(op.q !== undefined ? { q: op.q, qk: op.qk } : {}) };
          out.structural = true;
        }
        break;
      default:
        throw new Error(`unknown op ${op.o}`);
    }
    this._view = null;
    return out;
  }

  /** Stamps local ops with fresh clocks, applies them and returns them for sending. */
  applyLocal(ops) {
    const out = [];
    for (const op of ops) {
      const stamped = { ...op, c: ++this.lamport };
      this.apply(stamped, this.site);
      out.push(stamped);
    }
    return out;
  }

  /** Field values of an entry as JSON text (null = deleted field). */
  propsOf(id) {
    const e = this.entries.get(id);
    const out = new Map();
    if (e) for (const [f, r] of e.props) if (r.v !== null) out.set(f, r.v);
    return out;
  }

  /**
   * The materialized tree: which entries are visible, their effective parent, ordered children, the page root and
   * mask slots. Cached until the next apply.
   */
  view() {
    if (this._view) return this._view;
    const eff = new Map(); // id → effective parent
    for (const e of this.entries.values()) if (e.live?.v && e.pos) eff.set(e.id, e.pos.parent);
    // break move cycles: in each cycle, the entry with the newest move goes back to where it was before (q)
    for (let guard = 0; guard <= this.entries.size; guard++) {
      const cycle = findCycle(eff);
      if (!cycle) break;
      let pick = cycle[0];
      for (const id of cycle) {
        const a = this.entries.get(id).pos.c;
        const b = this.entries.get(pick).pos.c;
        if (cmpClock(a, b) > 0) pick = id;
      }
      const pos = this.entries.get(pick).pos;
      if (pos.q !== undefined && pos.q !== pick) eff.set(pick, pos.q);
      else eff.delete(pick);
    }
    const visible = new Set();
    const state = new Map(); // id → true/false (memo)
    const isVisible = (id) => {
      const stack = [];
      let cur = id;
      let result = false;
      for (let steps = 0; steps <= eff.size + 1; steps++) {
        if (state.has(cur)) {
          result = state.get(cur);
          break;
        }
        if (VIRTUAL.has(cur)) {
          result = true;
          break;
        }
        const p = eff.get(cur);
        if (p === undefined) {
          result = false;
          state.set(cur, false);
          break;
        }
        stack.push(cur);
        cur = p;
      }
      for (const s of stack) state.set(s, result);
      return state.get(id) ?? result;
    };
    for (const id of eff.keys()) if (isVisible(id)) visible.add(id);
    if (this.entries.has(DOC_ID)) visible.add(DOC_ID);
    const children = new Map();
    const slot = new Map(); // `${parent}|#root` / `${parent}|#mask` → id
    const parent = new Map();
    const keyOf = new Map();
    for (const id of visible) {
      if (id === DOC_ID) continue;
      const pos = this.entries.get(id).pos;
      const p = eff.get(id);
      const key = p === pos.parent ? pos.key : pos.qk ?? pos.key;
      parent.set(id, p);
      keyOf.set(id, key);
      if (key === SLOT_KEYS.root || key === SLOT_KEYS.mask) {
        const k = `${p}|${key}`;
        const prev = slot.get(k);
        if (!prev || cmpClock(pos.c, this.entries.get(prev).pos.c) > 0) slot.set(k, id);
        continue;
      }
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(id);
    }
    for (const [p, list] of children) {
      if (p === ROOTS.stories || p === ROOTS.assets) list.sort();
      else list.sort((a, b) => (keyOf.get(a) < keyOf.get(b) ? -1 : keyOf.get(a) > keyOf.get(b) ? 1 : a < b ? -1 : a > b ? 1 : 0));
    }
    this._view = { visible, parent, children, keyOf, root: (pageId) => slot.get(`${pageId}|#root`) || null, mask: (id) => slot.get(`${id}|#mask`) || null, kids: (id) => children.get(id) || [] };
    return this._view;
  }

  toJSON() {
    const e = [];
    for (const x of this.entries.values()) {
      e.push([
        x.id,
        x.pos ? [x.pos.parent, x.pos.key, x.pos.c[0], x.pos.c[1], ...(x.pos.q !== undefined ? [x.pos.q, x.pos.qk ?? null] : [])] : 0,
        x.live ? [x.live.v ? 1 : 0, x.live.c[0], x.live.c[1]] : 0,
        [...x.props].map(([f, r]) => [f, r.v, r.c[0], r.c[1]]),
      ]);
    }
    return { v: 1, l: this.lamport, e };
  }

  /** Rebuilds a replica from toJSON() output (validated: this comes from another member). */
  static fromJSON(json, site = "") {
    if (!json || json.v !== 1 || !Array.isArray(json.e) || !Number.isInteger(json.l)) throw new Error("invalid live state");
    const t = new TreeCRDT(site);
    t.lamport = clampLamport(json.l);
    for (const row of json.e) {
      if (!Array.isArray(row) || row.length !== 4) throw new Error("invalid live state entry");
      const [id, pos, live, props] = row;
      checkId(id, "id");
      const e = t.entry(id);
      if (pos) {
        const [p, k, l, s, q, qk] = pos;
        checkParent(p);
        checkKey(k);
        e.pos = { parent: p, key: k, c: [clampLamport(l), checkSite(s)] };
        if (q !== undefined) {
          checkParent(q);
          if (qk !== null) checkKey(qk);
          e.pos.q = q;
          e.pos.qk = qk ?? undefined;
        }
      }
      if (live) e.live = { v: !!live[0], c: [clampLamport(live[1]), checkSite(live[2])] };
      if (!Array.isArray(props) || props.length > 512) throw new Error("invalid live state props");
      for (const [f, v, l, s] of props) {
        checkField(f);
        if (v !== null && (typeof v !== "string" || v.length > TREE_LIMITS.valueChars)) throw new Error("invalid live state value");
        if (v !== null) checkValue(JSON.parse(v), 0);
        e.props.set(f, { v, c: [clampLamport(l), checkSite(s)] });
      }
    }
    return t;
  }

  /** A replica whose state is exactly `flat` (every clock [0, ""], deterministic keys): the shared starting point. */
  static fromFlat(flat, site = "") {
    const t = new TreeCRDT(site);
    const c = [0, ""];
    const groups = new Map();
    for (const [id, x] of flat) {
      const e = t.entry(id);
      for (const [f, s] of x.props) e.props.set(f, { v: s, c });
      if (x.parent === null) continue;
      e.live = { v: true, c };
      if (x.slot === "order") {
        if (!groups.has(x.parent)) groups.set(x.parent, []);
        groups.get(x.parent).push([x.index, id]);
      } else e.pos = { parent: x.parent, key: SLOT_KEYS[x.slot], c };
    }
    for (const [p, list] of groups) {
      list.sort((a, b) => a[0] - b[0]);
      list.forEach(([, id], i) => (t.entry(id).pos = { parent: p, key: initialKey(i, list.length), c }));
    }
    return t;
  }
}

function findCycle(eff) {
  const done = new Set();
  for (const start of eff.keys()) {
    if (done.has(start)) continue;
    const path = [];
    const onPath = new Map();
    let cur = start;
    while (cur !== undefined && !done.has(cur) && eff.has(cur)) {
      if (onPath.has(cur)) return path.slice(onPath.get(cur));
      onPath.set(cur, path.length);
      path.push(cur);
      cur = eff.get(cur);
    }
    for (const id of path) done.add(id);
  }
  return null;
}

// ------------------------------------------------------------------ the live document as a flat map

/**
 * Flattens a document (core/doc.js Doc, or any object with the same shape) into entries. `cache` (a WeakMap) reuses
 * the JSON text of nodes whose render revision (`_rev`) did not change since the last call.
 */
export function flattenDoc(doc, cache = null) {
  const flat = new Map();
  const meta = new Map();
  for (const f of DOC_FIELDS) if (doc[f] !== undefined) meta.set(f, JSON.stringify(doc[f]));
  flat.set(DOC_ID, { parent: null, slot: "none", index: 0, props: meta });
  const nodeProps = (n) => {
    if (cache) {
      const hit = cache.get(n);
      if (hit && hit.rev === n._rev && hit.rev !== undefined) return hit.props;
    }
    const props = new Map();
    for (const k of Object.keys(n)) {
      if (SKIP_NODE.has(k) || k.charCodeAt(0) === 95 || n[k] === undefined || typeof n[k] === "function") continue;
      props.set(k, JSON.stringify(n[k]));
    }
    if (Array.isArray(n.children)) props.set("children", "[]");
    if (cache && n._rev !== undefined) cache.set(n, { rev: n._rev, props });
    return props;
  };
  const visit = (n, parent, slot, index) => {
    flat.set(n.id, { parent, slot, index, props: nodeProps(n) });
    if (Array.isArray(n.children)) n.children.forEach((c, i) => visit(c, n.id, "order", i));
    if (n.mask) visit(n.mask, n.id, "mask", 0);
  };
  const pages = (list, root) =>
    list.forEach((p, i) => {
      const props = new Map();
      for (const k of Object.keys(p)) if (!SKIP_PAGE.has(k) && k.charCodeAt(0) !== 95 && p[k] !== undefined) props.set(k, JSON.stringify(p[k]));
      flat.set(p.id, { parent: root, slot: "order", index: i, props });
      visit(p.root, p.id, "root", 0);
    });
  pages(doc.pages || [], ROOTS.pages);
  pages(doc.masters || [], ROOTS.masters);
  for (const [id, s] of Object.entries(doc.stories || {})) {
    const props = new Map([["story", JSON.stringify(s.story)]]);
    if (s.defaults !== undefined) props.set("defaults", JSON.stringify(s.defaults));
    flat.set(id, { parent: ROOTS.stories, slot: "none", index: 0, props });
  }
  for (const [id, a] of Object.entries(doc.assets || {})) {
    const props = new Map();
    for (const f of ASSET_FIELDS) if (a[f] !== undefined) props.set(f, JSON.stringify(a[f]));
    flat.set(id, { parent: ROOTS.assets, slot: "none", index: 0, props });
  }
  return flat;
}

// ------------------------------------------------------------------ local changes → ops

const parseProps = (props) => {
  const v = {};
  for (const [f, s] of props) v[f] = JSON.parse(s);
  return v;
};

/**
 * The ops (without clocks) that make the CRDT's view equal to `flat`. `prevIds` (optional): the ids of the previous
 * flat; only those can be deleted (an entry that is visible in the CRDT but was never in this document, e.g. a page
 * whose root has not arrived yet, is left alone).
 */
export function diffOps(crdt, flat, prevIds = null) {
  const V = crdt.view();
  const ops = [];
  const pending = new Map(); // id → op that still needs a key
  for (const [id, L] of flat) {
    if (L.parent === null) {
      // the document entry: fields only
      const cur = crdt.propsOf(id);
      for (const [f, s] of L.props) if (cur.get(f) !== s) ops.push({ o: "set", id, f, v: JSON.parse(s) });
      for (const f of cur.keys()) if (!L.props.has(f)) ops.push({ o: "set", id, f });
      continue;
    }
    const fixedKey = L.slot === "order" ? null : SLOT_KEYS[L.slot];
    if (!V.visible.has(id)) {
      const op = { o: "add", id, p: L.parent, k: fixedKey, v: parseProps(L.props) };
      ops.push(op);
      if (!fixedKey) pending.set(id, op);
      continue;
    }
    if (V.parent.get(id) !== L.parent || (fixedKey && V.keyOf.get(id) !== fixedKey)) {
      const op = { o: "mv", id, p: L.parent, k: fixedKey, q: V.parent.get(id), qk: V.keyOf.get(id) };
      ops.push(op);
      if (!fixedKey) pending.set(id, op);
    }
    const cur = crdt.propsOf(id);
    for (const [f, s] of L.props) if (cur.get(f) !== s) ops.push({ o: "set", id, f, v: JSON.parse(s) });
    for (const f of cur.keys()) if (!L.props.has(f)) ops.push({ o: "set", id, f });
  }
  // deletions: only the topmost removed entry (descendants disappear with it; delete wins over concurrent edits)
  for (const id of V.visible) {
    if (id === DOC_ID || flat.has(id) || (prevIds && !prevIds.has(id))) continue;
    const p = V.parent.get(id);
    if (VIRTUAL.has(p) || flat.has(p) || (prevIds && !prevIds.has(p))) ops.push({ o: "del", id });
  }
  // ordering: keep the longest run of children that is already in key order, give the others new keys
  const groups = new Map();
  for (const [id, L] of flat) {
    if (L.slot !== "order") continue;
    if (!groups.has(L.parent)) groups.set(L.parent, []);
    groups.get(L.parent).push([L.index, id]);
  }
  for (const [p, list] of groups) {
    list.sort((a, b) => a[0] - b[0]);
    const ids = list.map((x) => x[1]);
    const stable = ids.map((id) => (!pending.has(id) && V.parent.get(id) === p && V.visible.has(id) ? V.keyOf.get(id) : null));
    const keep = lis(ids, stable);
    const keys = ids.map((id, i) => (keep.has(i) ? stable[i] : null));
    if (!fillKeys(keys, ids)) {
      // equal keys around a gap (concurrent inserts): re-key the whole list
      const fresh = keysBetween(null, null, ids.length);
      ids.forEach((id, i) => (keys[i] = fresh[i]));
      keep.clear();
    }
    ids.forEach((id, i) => {
      if (keep.has(i)) return;
      const op = pending.get(id);
      if (op) op.k = keys[i];
      else if (keys[i] !== V.keyOf.get(id) || V.parent.get(id) !== p) ops.push({ o: "mv", id, p, k: keys[i], q: V.parent.get(id), qk: V.keyOf.get(id) });
    });
  }
  return ops;
}

/** Indices of a longest increasing subsequence of the non-null (key, id) pairs. */
function lis(ids, keys) {
  const less = (i, j) => keys[i] < keys[j] || (keys[i] === keys[j] && ids[i] < ids[j]);
  const tails = [];
  const prev = new Array(ids.length).fill(-1);
  for (let i = 0; i < ids.length; i++) {
    if (keys[i] === null) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (less(tails[mid], i)) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/** Fills null slots with keys between their kept neighbors. False when two neighbors leave no room. */
function fillKeys(keys) {
  let i = 0;
  while (i < keys.length) {
    if (keys[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < keys.length && keys[j] === null) j++;
    const lo = i > 0 ? keys[i - 1] : null;
    const hi = j < keys.length ? keys[j] : null;
    if (lo !== null && hi !== null && lo >= hi) return false;
    const fresh = keysBetween(lo, hi, j - i);
    for (let k = i; k < j; k++) keys[k] = fresh[k - i];
    i = j;
  }
  return true;
}

// ------------------------------------------------------------------ validation (ops come from other members)

const ID_RE = /^(?:#doc|[A-Za-z0-9_.:-]{1,64})$/;
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const FORBIDDEN = new Set(["constructor", "prototype", "id", "mask", "root"]);
const SITE_RE = /^(?:[A-Za-z0-9_-]{22}|)$/;
const bad = (m) => {
  throw new Error(m);
};
const checkId = (v, what) => (typeof v === "string" && ID_RE.test(v) ? v : bad(`${what} is invalid`));
const checkParent = (v) => (VIRTUAL.has(v) ? v : checkId(v, "parent"));
const checkKey = (v) => (SPECIAL_KEYS.has(v) || isKey(v) ? v : bad("key is invalid"));
const checkField = (f) => (typeof f === "string" && FIELD_RE.test(f) && !FORBIDDEN.has(f) ? f : bad("field is invalid"));
const checkSite = (s) => (typeof s === "string" && SITE_RE.test(s) ? s : bad("site is invalid"));
const clampLamport = (l) => (Number.isInteger(l) && l >= 0 && l <= TREE_LIMITS.maxLamport ? l : bad("clock is invalid"));

/** JSON values only (no functions, no prototype keys), bounded depth. */
function checkValue(v, depth) {
  if (depth > TREE_LIMITS.depth) bad("value is nested too deeply");
  if (v === null || typeof v === "boolean" || typeof v === "string") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) bad("number is invalid");
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) checkValue(x, depth + 1);
    return;
  }
  if (typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") bad("value has a forbidden key");
      checkValue(v[k], depth + 1);
    }
    return;
  }
  bad("value is not JSON");
}

const sizeOf = (v) => JSON.stringify(v)?.length ?? 0;

/** Validates one op received from another member. Returns a clean copy; throws on anything unexpected. */
export function validateTreeOp(op) {
  if (!op || typeof op !== "object" || Array.isArray(op)) bad("op must be an object");
  const allowed = { add: ["o", "id", "p", "k", "v", "c"], set: ["o", "id", "f", "v", "c"], del: ["o", "id", "c"], mv: ["o", "id", "p", "k", "q", "qk", "c"] }[op.o];
  if (!allowed) bad("unknown op");
  for (const k of Object.keys(op)) if (!allowed.includes(k)) bad(`op field ${k} is not allowed`);
  const out = { o: op.o, id: checkId(op.id, "id"), c: clampLamport(op.c) };
  if (op.c < 1) bad("clock is invalid");
  if (op.o === "add" || op.o === "mv") {
    if (op.id === DOC_ID) bad("the document entry cannot move");
    out.p = checkParent(op.p);
    if (out.p === out.id) bad("an entry cannot be its own parent");
    out.k = checkKey(op.k);
  }
  if (op.o === "mv" && op.q !== undefined) {
    out.q = checkParent(op.q);
    if (op.qk !== undefined && op.qk !== null) out.qk = checkKey(op.qk);
  }
  if (op.o === "add") {
    if (!op.v || typeof op.v !== "object" || Array.isArray(op.v)) bad("add needs fields");
    const keys = Object.keys(op.v);
    if (keys.length > 256) bad("too many fields");
    for (const f of keys) {
      checkField(f);
      checkValue(op.v[f], 0);
    }
    if (sizeOf(op.v) > TREE_LIMITS.valueChars * 2) bad("add is too large");
    out.v = op.v;
  }
  if (op.o === "set") {
    out.f = checkField(op.f);
    if (op.id === DOC_ID && !DOC_FIELDS.includes(op.f)) bad("this document field is not shared");
    if (op.v !== undefined) {
      checkValue(op.v, 0);
      if (sizeOf(op.v) > TREE_LIMITS.valueChars) bad("value is too large");
      out.v = op.v;
    }
  }
  return out;
}
