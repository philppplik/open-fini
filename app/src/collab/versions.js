// Named versions (snapshots) of documents, stored on this device. Pure logic + an injected key-value store.
//
// A version is the complete .ofini bytes of a document at one moment, plus metadata. The index lives under the kv key
// `versions.index` (array of meta), the bytes under `versions.data.<id>`, the thumbnail (PNG bytes from the .ofini) under
// `versions.thumb.<id>`. Caps: MAX_PER_DOC versions per document and MAX_TOTAL_BYTES for all versions together; the
// oldest automatic snapshots go first, then the oldest named ones. Nothing here leaves the device; "send version to
// room" is a file transfer done by the session.
//
// Meta = { id, docId, docName, name, note, author, ts, bytes, auto: boolean, reason?: "restore"|"remote"|... }
//
// Public API
//   planAdd(index, meta, { maxPerDoc, maxBytes }) → { index, evict: ids }     pure pruning decision
//   createVersionStore(kv)  kv = { get(key), set(key, value), del(key) } (async) →
//     .list(docId?)  .add({ doc meta, bytes, thumb })  .bytes(id)  .thumb(id)  .rename(id, name, note)  .remove(id)  .clear()
export const MAX_PER_DOC = 30;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const INDEX_KEY = "versions.index";
const dataKey = (id) => `versions.data.${id}`;
const thumbKey = (id) => `versions.thumb.${id}`;

/**
 * Decides which versions to drop when `meta` is added.
 * @returns {{index:any[], evict:string[]}}
 */
export function planAdd(index, meta, { maxPerDoc = MAX_PER_DOC, maxBytes = MAX_TOTAL_BYTES } = {}) {
  const next = [...index, meta];
  const evict = [];
  // oldest first; automatic snapshots are dropped before named ones
  const victims = (list) => [...list].sort((a, b) => (a.auto === b.auto ? a.ts - b.ts : a.auto ? -1 : 1));
  const drop = (v) => {
    evict.push(v.id);
    next.splice(next.indexOf(v), 1);
  };
  const ofDoc = next.filter((v) => v.docId === meta.docId);
  for (const v of victims(ofDoc)) {
    if (next.filter((x) => x.docId === meta.docId).length <= maxPerDoc) break;
    if (v.id !== meta.id) drop(v);
  }
  let total = next.reduce((s, v) => s + (v.bytes || 0), 0);
  for (const v of victims(next)) {
    if (total <= maxBytes) break;
    if (v.id === meta.id) continue;
    total -= v.bytes || 0;
    drop(v);
  }
  return { index: next, evict };
}

export function createVersionStore(kv, { now = () => Date.now(), newId = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, limits } = {}) {
  let cache = null;
  const load = async () => {
    if (!cache) {
      const v = await kv.get(INDEX_KEY);
      cache = Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : [];
    }
    return cache;
  };
  const save = async (index) => {
    cache = index;
    await kv.set(INDEX_KEY, index);
  };
  return {
    async list(docId = null) {
      const idx = await load();
      return idx.filter((v) => !docId || v.docId === docId).sort((a, b) => b.ts - a.ts);
    },
    /** Stores a version; returns its meta. `bytes` are the .ofini bytes, `thumb` optional PNG bytes. */
    async add({ docId, docName, name = "", note = "", author = "", auto = false, reason, bytes, thumb }) {
      if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("A version needs the document bytes.");
      const meta = { id: newId(), docId, docName: String(docName || "").slice(0, 120), name: String(name || "").slice(0, 80), note: String(note || "").slice(0, 500), author: String(author || "").slice(0, 32), ts: now(), bytes: bytes.length, auto: !!auto, ...(reason ? { reason } : {}) };
      const plan = planAdd(await load(), meta, limits);
      await kv.set(dataKey(meta.id), bytes);
      if (thumb) await kv.set(thumbKey(meta.id), thumb);
      for (const id of plan.evict) {
        await kv.del(dataKey(id));
        await kv.del(thumbKey(id));
      }
      await save(plan.index);
      return meta;
    },
    async get(id) {
      return (await load()).find((v) => v.id === id) || null;
    },
    async bytes(id) {
      const b = await kv.get(dataKey(id));
      return b instanceof Uint8Array ? b : b ? new Uint8Array(b) : null;
    },
    async thumb(id) {
      const b = await kv.get(thumbKey(id));
      return b instanceof Uint8Array ? b : null;
    },
    async rename(id, name, note) {
      const idx = await load();
      const v = idx.find((x) => x.id === id);
      if (!v) return false;
      if (name !== undefined) v.name = String(name).slice(0, 80);
      if (note !== undefined) v.note = String(note).slice(0, 500);
      v.auto = false;
      await save([...idx]);
      return true;
    },
    async remove(id) {
      const idx = await load();
      if (!idx.some((v) => v.id === id)) return false;
      await kv.del(dataKey(id));
      await kv.del(thumbKey(id));
      await save(idx.filter((v) => v.id !== id));
      return true;
    },
    async clear() {
      for (const v of await load()) {
        await kv.del(dataKey(v.id));
        await kv.del(thumbKey(v.id));
      }
      await save([]);
    },
    async totalBytes() {
      return (await load()).reduce((s, v) => s + (v.bytes || 0), 0);
    },
  };
}
