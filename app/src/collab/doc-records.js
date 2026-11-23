// "Edit together" records for the word processor (Office Document app). Pure (no DOM); tests in
// tests/collab/office-sync.test.js. Used through the Document app's `collabAdapter.bind()` (office/document/app.js)
// by collab/office-sync.js.
//
// The document model (engine/office/model.js) is an immutable array of blocks without ids. This adapter gives every
// block a stable id per shared document, kept in a WeakMap by block object (unchanged blocks keep their object, so
// they keep their id). Edited blocks are matched to the block they replace by position between unchanged neighbors
// (typing in a paragraph keeps its id; splitting a paragraph keeps the id for the first half). Records:
//   blk:<id>     { z, b }   z = fractional ordering key (collab/fractional.js), b = the block
//   doc:<field>  every other top-level field of the model (meta, page, styles, header, footer, footnotes, theme …)
//   media:<id>   { mime, name, w?, h? }   (the bytes travel as chunk records, see office-sync.js)
// Merging: different paragraphs (and tables, breaks …) merge; two people editing the SAME paragraph at the same time
// resolve to the later edit of that paragraph (last writer wins per block). Concurrent inserts at the same place keep
// a deterministic order (key, then id).
//
// Public API
//   new DocRecords({ newId? })   .records(model) → records   .applyRecords(model, changes) → model
//   .rebase(cur, from, to) → model   (Undo/Redo of a step: only the blocks it changed)
//   remapBlockIndex(prevBlocks, nextBlocks, index) → index   where the caret's top-level block went after a remote edit
import { keysBetween, isKey } from "./fractional.js";

const SKIP = new Set(["blocks", "media", "_raw"]);
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const isObj = (v) => !!v && typeof v === "object";

let n = 0;
const defaultId = () => `b${Date.now().toString(36).slice(-4)}${(n = (n + 1) % 1e6).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Indices of the longest increasing run (by z, then id) among entries with a z. */
function keepMask(list) {
  const lt = (a, b) => a.z < b.z || (a.z === b.z && a.id < b.id);
  const tails = []; // index into list
  const prev = new Array(list.length).fill(-1);
  for (let i = 0; i < list.length; i++) {
    if (!list[i].z) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lt(list[tails[mid]], list[i])) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Array(list.length).fill(false);
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep[i] = true;
  return keep;
}

export class DocRecords {
  constructor({ newId = defaultId } = {}) {
    this.newId = newId;
    this.ids = new WeakMap(); // block object → id
    this.z = new Map(); // id → ordering key (current document)
    this.last = []; // ids of the blocks of the last model seen, in order
    this.cache = new WeakMap(); // block object → { z, rec } (records keep their identity while nothing changes)
  }

  /** Ids and keys for an array of blocks (matched against `prev`, the ids of the previous model). */
  #assign(blocks, prev = this.last) {
    const used = new Set();
    const ids = blocks.map((b) => {
      const id = isObj(b) ? this.ids.get(b) : undefined;
      if (!id || used.has(id)) return null;
      used.add(id);
      return id;
    });
    const at = new Map(prev.map((id, i) => [id, i]));
    for (let i = 0; i < blocks.length; ) {
      if (ids[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < blocks.length && !ids[j]) j++;
      // blocks [i, j) are new or edited: reuse the ids of the removed blocks between the same neighbors, in order
      const lo = i > 0 ? at.get(ids[i - 1]) : -1;
      const hi = j < blocks.length ? at.get(ids[j]) : prev.length;
      const free = lo !== undefined && hi !== undefined && hi > lo ? prev.slice(lo + 1, hi).filter((id) => !used.has(id)) : [];
      for (let k = i; k < j; k++) {
        ids[k] = free.length ? free.shift() : this.newId();
        used.add(ids[k]);
      }
      i = j;
    }
    const list = ids.map((id, i) => ({ id, z: this.z.get(id) || null, b: blocks[i] }));
    const keep = keepMask(list);
    for (let k = 0; k < list.length; ) {
      if (keep[k]) {
        k++;
        continue;
      }
      let j = k;
      const left = k > 0 ? list[k - 1].z : null;
      while (j < list.length && (!keep[j] || (left !== null && list[j].z <= left))) j++;
      const right = j < list.length ? list[j].z : null;
      const keys = keysBetween(left, right, j - k);
      for (let m = k; m < j; m++) list[m].z = keys[m - k];
      k = j;
    }
    return list;
  }

  #commit(list) {
    for (const e of list) {
      if (isObj(e.b)) this.ids.set(e.b, e.id);
      this.z.set(e.id, e.z);
    }
    this.last = list.map((e) => e.id);
  }

  records(model) {
    const list = this.#assign(Array.isArray(model?.blocks) ? model.blocks : []);
    this.#commit(list);
    const out = {};
    for (const [k, v] of Object.entries(model || {})) if (!SKIP.has(k) && v !== undefined && FIELD_RE.test(k)) out[`doc:${k}`] = v;
    for (const e of list) {
      let c = isObj(e.b) ? this.cache.get(e.b) : null;
      if (!c || c.z !== e.z) {
        c = { z: e.z, rec: { z: e.z, b: e.b } };
        if (isObj(e.b)) this.cache.set(e.b, c);
      }
      out[`blk:${e.id}`] = c.rec;
    }
    for (const [id, m] of Object.entries(model?.media || {})) if (m) out[`media:${id}`] = { mime: String(m.mime || ""), name: String(m.name || ""), ...(m.w ? { w: m.w, h: m.h } : {}) };
    return out;
  }

  applyRecords(model, changes) {
    const list = this.#assign(Array.isArray(model?.blocks) ? model.blocks : []);
    const map = new Map(list.map((e) => [e.id, e]));
    const next = { ...model };
    let blocksChanged = false;
    let media = null;
    for (const [k, v] of Object.entries(changes)) {
      const i = k.indexOf(":");
      const kind = k.slice(0, i);
      const id = k.slice(i + 1);
      if (kind === "blk" && id) {
        blocksChanged = true;
        if (isObj(v) && isObj(v.b) && !Array.isArray(v.b) && typeof v.b.type === "string" && isKey(v.z)) map.set(id, { id, z: v.z, b: v.b });
        else map.delete(id);
      } else if (kind === "doc" && FIELD_RE.test(id) && !SKIP.has(id)) {
        if (v === null) delete next[id];
        else next[id] = v;
      } else if (kind === "media" && id && id !== "__proto__") {
        media ||= { ...(model.media || {}) };
        if (!isObj(v)) delete media[id];
        else media[id] = { ...(media[id] || {}), id, mime: String(v.mime || ""), name: String(v.name || ""), ...(v.w ? { w: v.w, h: v.h } : {}) };
      }
    }
    if (blocksChanged) {
      const sorted = [...map.values()].sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (!sorted.length) sorted.push({ id: this.newId(), z: keysBetween(null, null, 1)[0], b: { type: "paragraph", style: "Normal", runs: [{ text: "" }] } });
      this.#commit(sorted);
      next.blocks = sorted.map((e) => e.b);
    } else {
      this.#commit(list);
      next.blocks = model.blocks;
    }
    if (media) next.media = media;
    return next;
  }

  /** The step from → to on top of cur, block by block (the identities of `from` are matched to `to` by position). */
  rebase(cur, from, to) {
    const saved = { last: this.last, z: new Map(this.z) };
    let changes;
    try {
      this.last = this.#assign(from.blocks || []).map((e) => e.id);
      const a = this.records(from);
      const b = this.records(to);
      changes = {};
      for (const [k, v] of Object.entries(b)) if (a[k] !== v && JSON.stringify(a[k]) !== JSON.stringify(v)) changes[k] = v;
      for (const k of Object.keys(a)) if (!(k in b)) changes[k] = null;
    } finally {
      this.last = saved.last;
      this.z = saved.z;
    }
    return Object.keys(changes).length ? this.applyRecords(cur, changes) : cur;
  }
}

/** Where a top-level block index went after a remote edit (by identity; falls back to the nearest unchanged block). */
export function remapBlockIndex(prev, next, index) {
  if (!Array.isArray(prev) || !Array.isArray(next) || prev === next) return index;
  const direct = next.indexOf(prev[index]);
  if (direct >= 0) return direct;
  for (let i = index - 1; i >= 0; i--) {
    const j = next.indexOf(prev[i]);
    if (j >= 0) return Math.min(next.length - 1, j + (index - i));
  }
  return Math.max(0, Math.min(next.length - 1, index + (next.length - prev.length)));
}
