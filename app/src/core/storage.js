// IndexedDB storage for autosave sessions and recent documents. Everything stays on the device.
const DB = "openfini";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const r = fn(store);
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kvGet = (key) => tx("readonly", (s) => s.get(key)).catch(() => undefined);
export const kvSet = (key, value) => tx("readwrite", (s) => s.put(value, key)).catch(() => undefined);
export const kvDelete = (key) => tx("readwrite", (s) => s.delete(key)).catch(() => undefined);

const MAX_RECENT_BYTES = 40 * 1024 * 1024;

/** Recent list: [{id, name, time, size, path?}] with bytes kept under `recent:<id>` (web only, size-capped). */
export async function getRecents() {
  return (await kvGet("recents")) || [];
}

export async function addRecent({ name, bytes, path }) {
  const list = await getRecents();
  const id = path || `${name}:${Date.now()}`;
  const next = [{ id, name, path, time: Date.now(), size: bytes?.length || 0 }, ...list.filter((r) => r.id !== id && (r.path ? r.path !== path : r.name !== name))].slice(0, 12);
  if (bytes && bytes.length <= MAX_RECENT_BYTES && !path) await kvSet(`recent:${id}`, bytes);
  for (const gone of list.filter((r) => !next.some((n) => n.id === r.id))) await kvDelete(`recent:${gone.id}`);
  await kvSet("recents", next);
  return next;
}

export const getRecentBytes = (id) => kvGet(`recent:${id}`);

/** Autosave session: every open document as .ofini bytes. */
export async function saveSession(entries, active) {
  await kvSet("session", { time: Date.now(), active, docs: entries });
}
export const loadSession = () => kvGet("session");
export const clearSession = () => kvDelete("session");
