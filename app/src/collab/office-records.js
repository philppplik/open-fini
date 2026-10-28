// "Edit together" for Office Suite apps (spreadsheet cells, slide objects, board items): a last-writer-wins map of
// keyed records with Lamport clocks. Pure (no DOM); tests in tests/collab/office-records.test.js. Bound to documents
// by ui/collab/live.js ▸ OfficeBinding through an app's `collabAdapter` (docs/office-suite.md ▸ Collaboration).
//
// Model: an app flattens its model into records `{ key: jsonValue }` (adapter.records(model)) with stable keys
// ("cell:s1!B3", "obj:slide2/o7", "item:n42", "meta:title", "order:slides" …) and rebuilds the model from changed
// records (adapter.applyRecords(model, { key: value | null })). Concurrent edits of the SAME record resolve to the
// higher (clock, site); edits of different records merge. Ordered collections should store fractional keys
// (collab/fractional.js) inside their records instead of arrays, so moves do not conflict.
//
// Public API
//   RecordsCRDT.fromRecords(records, site)   every replica starts from the same snapshot with clock 0
//   RecordsCRDT.fromJSON(json, site) / crdt.toJSON()
//   crdt.view() → { key: value }              current records (deleted ones absent)
//   crdt.diff(records) → [{ k, v }]           local edits needed to reach `records` (v null = delete)
//   crdt.applyLocal(ops) → stamped ops        [{ k, v, c, s }] to send
//   crdt.apply(op) → { changed, overwrote }   a remote op; overwrote = { site } when a newer local value lost
//   crdt.changesTo(records) → { key: value|null }  what to write into a model holding `records` to match the view
//   validateRecordOp(op) → op                 throws on malformed input (sizes, types, keys)
// Invariants: apply is commutative, idempotent and associative (same ops in any order → same view); values are
// plain JSON (validated size ≤ RECORD_LIMITS.valueChars); keys are ≤ 256 chars.
export const RECORD_LIMITS = { keyChars: 256, valueChars: 64 * 1024, siteChars: 64, records: 200_000 };

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const wins = (c, s, cur) => !cur || c > cur.c || (c === cur.c && s > cur.s);

export class RecordsCRDT {
  constructor(site) {
    this.site = String(site || "");
    this.clock = 0;
    /** key → { v, c, s } (v null = deleted) */
    this.map = new Map();
  }

  static fromRecords(records, site) {
    const crdt = new RecordsCRDT(site);
    for (const [k, v] of Object.entries(records || {})) crdt.map.set(k, { v, c: 0, s: "" });
    return crdt;
  }

  static fromJSON(json, site) {
    const crdt = new RecordsCRDT(site);
    crdt.clock = Number.isInteger(json?.clock) ? json.clock : 0;
    for (const [k, e] of Object.entries(json?.map || {})) if (e && Number.isInteger(e.c) && typeof e.s === "string") crdt.map.set(k, { v: e.v ?? null, c: e.c, s: e.s });
    return crdt;
  }

  toJSON() {
    return { clock: this.clock, map: Object.fromEntries(this.map) };
  }

  view() {
    const out = {};
    for (const [k, e] of this.map) if (e.v !== null) out[k] = e.v;
    return out;
  }

  diff(records) {
    const ops = [];
    for (const [k, v] of Object.entries(records || {})) {
      const cur = this.map.get(k);
      if (!cur || cur.v === null || !same(cur.v, v)) ops.push({ k, v: v ?? null });
    }
    for (const [k, e] of this.map) if (e.v !== null && !(k in (records || {}))) ops.push({ k, v: null });
    return ops;
  }

  applyLocal(ops) {
    return ops.map(({ k, v }) => {
      const op = { k, v: v ?? null, c: ++this.clock, s: this.site };
      this.map.set(k, { v: op.v, c: op.c, s: op.s });
      return op;
    });
  }

  apply(op) {
    this.clock = Math.max(this.clock, op.c);
    const cur = this.map.get(op.k);
    if (!wins(op.c, op.s, cur)) return { changed: false, overwrote: null };
    const changed = !cur || !same(cur.v, op.v);
    const overwrote = cur && cur.s === this.site && changed ? { site: cur.s, c: cur.c } : null;
    this.map.set(op.k, { v: op.v, c: op.c, s: op.s });
    return { changed, overwrote };
  }

  changesTo(records) {
    const view = this.view();
    const out = {};
    for (const [k, v] of Object.entries(view)) if (!(k in (records || {})) || !same(records[k], v)) out[k] = v;
    for (const k of Object.keys(records || {})) if (!(k in view)) out[k] = null;
    return out;
  }
}

export function validateRecordOp(op) {
  if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error("record op must be an object");
  const { k, v = null, c, s } = op;
  if (typeof k !== "string" || !k || k.length > RECORD_LIMITS.keyChars || k === "__proto__") throw new Error("record op has a bad key");
  if (!Number.isInteger(c) || c < 0 || c > 1e15) throw new Error("record op has a bad clock");
  if (typeof s !== "string" || s.length > RECORD_LIMITS.siteChars) throw new Error("record op has a bad site");
  if (v !== null && JSON.stringify(v).length > RECORD_LIMITS.valueChars) throw new Error("record value is too large");
  return { k, v, c, s };
}
