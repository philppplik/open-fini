// "Edit together" engine for record-based documents (Office Suite apps and the Scene Studio): the pure part of
// ui/collab/live.js ▸ OfficeBinding. No DOM; tests in tests/collab/office-sync.test.js (two and three in-memory peers).
//
// An app's `collabAdapter` turns its immutable model into keyed records and back (docs/office-suite.md ▸
// Collaboration). Adapters are either stateless ({ records(model), applyRecords(model, changes) }) or stateful:
// `bind()` returns a fresh { records, applyRecords } per shared document (the word processor keeps block identities,
// collab/doc-records.js). `inlineMedia` (bytes) says up to which size the adapter carries media bytes itself.
//
// What this module adds on top of collab/office-records.js:
//   * local edits are the difference between the records of the model the last time we looked (`base`) and now, never
//     between the shared view and the model: a record the model cannot hold yet (a cell of a sheet that has not
//     arrived, an element of a page that is still on its way, a value the app normalizes) is no longer "deleted" by
//     the next local edit of a peer (that used to propagate data loss to everyone);
//   * remote ops are reconciled key by key against the model; keys the model could not take are retried with the
//     next remote message (so delivery order does not matter);
//   * media bytes larger than `inlineMedia` travel as immutable chunk records `blob:<media id>/<i>` (≤ 45 KiB each)
//     and are assembled into `model.media[id].bytes` once every chunk is there (they used to stay local);
//   * `rebase(cur, from, to)` lets Undo/Redo revert only the records of the user's own step instead of restoring a
//     whole older model (which used to wipe every remote edit made in between, then send that loss to the room);
//   * ops with values over the record limit are kept back (counted in `skipped`) instead of making every receiver
//     reject the whole message.
//
// Public API
//   new OfficeSync(adapter, model, { site, state? })   state = stateJSON() of the member we got the snapshot from
//   sync.local(model) → stamped ops to send           sync.skipped (ops too large to send, cumulative)
//   sync.remote(ops, model) → { model, changed, lost }  ops must be validated (validateRecordOp) by the caller
//   sync.rollback(model) → model                       the model reset to the shared view where it differs locally
//   sync.rebase(cur, from, to) → model                 apply the step from → to on top of cur (Undo/Redo)
//   sync.replaceState(state, model) → model            Resync
//   sync.stateJSON() → json                            CRDT state without media chunks (the snapshot has the bytes)
// Invariants: a remote op never produces an outgoing op (no echo); the same ops in any order give the same model on
// every replica (as far as the adapter is deterministic); media chunk records are content-addressed and immutable.
import { RecordsCRDT, RECORD_LIMITS } from "./office-records.js";

export const BLOB = "blob:";
export const BLOB_CHUNK = 45 * 1024; // raw bytes per chunk: base64 plus the record's JSON stays below 64 KiB
export const BLOB_MAX = 32 * 1024 * 1024; // media larger than this stay local (Resync brings them)

const same = (a, b) => a === b || (a !== null && b !== null && typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));
const isBlob = (k) => k.startsWith(BLOB);

const b64 = (bytes) => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Chunk records of every media item whose bytes the adapter does not carry itself. */
export function blobRecords(model, inline = 0) {
  const out = {};
  for (const [id, m] of Object.entries(model?.media || {})) {
    const bytes = m?.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length <= inline || bytes.length > BLOB_MAX) continue;
    const n = Math.ceil(bytes.length / BLOB_CHUNK);
    for (let i = 0; i < n; i++) out[`${BLOB}${id}/${i}`] = { n, size: bytes.length, d: b64(bytes.subarray(i * BLOB_CHUNK, (i + 1) * BLOB_CHUNK)) };
  }
  return out;
}

/** Media whose bytes are missing locally but whose chunks are all in the view get their bytes. */
function assembleBlobs(model, map) {
  let media = null;
  for (const [id, m] of Object.entries(model?.media || {})) {
    if (!m || m.bytes instanceof Uint8Array) continue;
    const first = map.get(`${BLOB}${id}/0`)?.v;
    if (!first || !Number.isInteger(first.n) || first.n < 1 || !Number.isInteger(first.size) || first.size > BLOB_MAX) continue;
    const parts = [];
    for (let i = 0; i < first.n; i++) {
      const v = map.get(`${BLOB}${id}/${i}`)?.v;
      if (!v || typeof v.d !== "string") break;
      parts.push(unb64(v.d));
    }
    if (parts.length !== first.n) continue;
    const bytes = new Uint8Array(first.size);
    let at = 0;
    for (const p of parts) {
      if (at + p.length > bytes.length) break;
      bytes.set(p, at);
      at += p.length;
    }
    if (at !== first.size) continue;
    const { missing, ...rest } = m;
    (media ||= { ...model.media })[id] = { ...rest, bytes };
  }
  return media ? { ...model, media } : model;
}

/** [{ k, v }] that turn records `a` into records `b` (v null = delete). */
export function diffRecords(a, b) {
  const ops = [];
  for (const [k, v] of Object.entries(b)) if (!(k in a) || !same(a[k], v)) ops.push({ k, v: v ?? null });
  for (const k of Object.keys(a)) if (!(k in b)) ops.push({ k, v: null });
  return ops;
}

const bindAdapter = (adapter) => (typeof adapter?.bind === "function" ? adapter.bind() : adapter);

export class OfficeSync {
  constructor(adapter, model, { site, state = null } = {}) {
    if (!adapter) throw new Error("no collaboration adapter");
    this.a = bindAdapter(adapter);
    if (typeof this.a?.records !== "function" || typeof this.a?.applyRecords !== "function") throw new Error("invalid collaboration adapter");
    this.inline = Number.isFinite(adapter.inlineMedia) ? adapter.inlineMedia : 0;
    this.site = String(site || "");
    this.skipped = 0;
    this.unapplied = new Set();
    const recs = this.records(model);
    this.crdt = state ? RecordsCRDT.fromJSON(state, this.site) : RecordsCRDT.fromRecords(recs, this.site);
    this.crdt.site = this.site;
    if (state) this.#restoreBlobs(recs);
    this.base = recs;
  }

  records(model) {
    return { ...this.a.records(model), ...blobRecords(model, this.inline) };
  }

  /** The snapshot carries the media bytes, so chunk records are left out (they are rebuilt from the model). */
  stateJSON() {
    const json = this.crdt.toJSON();
    const map = {};
    for (const [k, e] of Object.entries(json.map)) if (!isBlob(k)) map[k] = e;
    return { clock: json.clock, map };
  }

  #restoreBlobs(recs) {
    for (const [k, v] of Object.entries(recs)) if (isBlob(k) && !this.crdt.map.has(k)) this.crdt.map.set(k, { v, c: 0, s: "" });
  }

  /** Local edits since the last look: stamped ops (to send). */
  local(model) {
    const cur = this.records(model);
    const ops = diffRecords(this.base, cur);
    this.base = cur;
    if (!ops.length) return [];
    const fit = [];
    for (const op of ops) {
      if (op.k.length > RECORD_LIMITS.keyChars || (op.v !== null && JSON.stringify(op.v).length > RECORD_LIMITS.valueChars)) this.skipped++;
      else fit.push(op);
    }
    return this.crdt.applyLocal(fit);
  }

  /** Does the model differ from what was last seen (a local edit not yet turned into ops)? */
  dirty(model) {
    return diffRecords(this.base, this.records(model)).length > 0;
  }

  /** Applies validated remote ops; returns the model to show (the same object when nothing changed). */
  remote(ops, model) {
    const keys = new Set(this.unapplied);
    let lost = 0;
    let changed = false;
    for (const op of ops) {
      const r = this.crdt.apply(op);
      if (r.changed) {
        keys.add(op.k);
        changed = true;
      }
      if (r.overwrote) lost++;
    }
    if (!keys.size) return { model, changed: false, lost };
    const next = this.#reconcile(model, keys);
    return { model: next, changed: changed || next !== model, lost };
  }

  /** Local edits of a member who may not edit (or while paused): put the shared values back. */
  rollback(model) {
    const keys = new Set(diffRecords(this.base, this.records(model)).map((o) => o.k));
    return keys.size ? this.#reconcile(model, keys) : model;
  }

  /** Undo/Redo: the change from `from` to `to`, applied on top of `cur` (remote edits made since stay). */
  rebase(cur, from, to) {
    if (cur === from) return to;
    if (typeof this.a.rebase === "function") return this.a.rebase(cur, from, to);
    const changes = {};
    for (const { k, v } of diffRecords(this.a.records(from), this.a.records(to))) changes[k] = v;
    return Object.keys(changes).length ? this.a.applyRecords(cur, changes) : cur;
  }

  /** Resync: adopt a fresh state; the model is brought to its view. */
  replaceState(state, model) {
    const recs = this.records(model);
    this.crdt = RecordsCRDT.fromJSON(state, this.site);
    this.#restoreBlobs(recs);
    this.unapplied.clear();
    return this.#reconcile(model, new Set([...this.crdt.map.keys(), ...Object.keys(recs)]));
  }

  #reconcile(model, keys) {
    const cur = this.records(model);
    const changes = {};
    for (const k of keys) {
      if (isBlob(k)) continue;
      const v = this.crdt.map.get(k)?.v ?? null;
      if (!same(cur[k] ?? null, v)) changes[k] = v;
    }
    let next = model;
    if (Object.keys(changes).length) next = this.a.applyRecords(model, changes);
    next = assembleBlobs(next, this.crdt.map);
    const after = this.records(next);
    this.unapplied = new Set();
    for (const k of keys) {
      if (isBlob(k) || this.unapplied.size >= 10_000) continue;
      if (!same(after[k] ?? null, this.crdt.map.get(k)?.v ?? null)) this.unapplied.add(k);
    }
    this.base = after;
    return next;
  }
}
