// IndexedDB storage for autosave sessions and recent documents. Everything stays on the device.
import { pushRecent, dropRecent, clampRecentLimit } from "./recents.js";
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

export const kvGetRaw = (key) => tx("readonly", (s) => s.get(key)).catch(() => undefined);
export const kvSetRaw = (key, value) => tx("readwrite", (s) => s.put(value, key)).catch(() => undefined);
export const kvDelete = (key) => tx("readwrite", (s) => s.delete(key)).catch(() => undefined);

// ---- app lock hook (see core/atrest.js and ui/app-lock.js)
// While the app lock is on, the private keys below are stored sealed (AES-GCM). Without the key they read as
// missing and are never written in plain text.

/** Keys the app lock encrypts: the autosaved session, recent files, AI keys and chats. */
export function isProtectedKey(key) {
  const k = String(key);
  return k === "session" || k.startsWith("popout:") || k.startsWith("popout-session:") || k === "recents" || k.startsWith("recent:") || k === "vibe.secrets" || k === "publish.secrets" || k === "vibe.chats" || k.startsWith("vibe.chat.") || k.startsWith("versions.");
}
/** True for values written by the app lock. */
export const isSealed = (v) => !!v && typeof v === "object" && v.__ofl === 1 && v.iv instanceof Uint8Array && v.data instanceof Uint8Array;

let codec = null; // { ready(): boolean, encode(value): Promise<sealed>, decode(sealed): Promise<value> }
export function setStorageCodec(c) {
  codec = c;
}
const lockFlag = () => {
  try {
    return localStorage.getItem("openfini.lock") === "1";
  } catch {
    return false;
  }
};

export async function kvGet(key) {
  const v = await kvGetRaw(key);
  if (!isSealed(v)) return v;
  if (!codec?.ready()) return undefined;
  try {
    return await codec.decode(v);
  } catch {
    return undefined;
  }
}
export async function kvSet(key, value) {
  if (isProtectedKey(key) && (codec || lockFlag())) {
    if (!codec?.ready()) return undefined; // locked: never write private data in plain text
    try {
      value = await codec.encode(value);
    } catch {
      return undefined;
    }
  }
  return kvSetRaw(key, value);
}

/** Approximate size in bytes of a stored value (binary parts exact, the rest by JSON length). */
export function approxSize(v, depth = 0) {
  if (v == null) return 0;
  if (typeof v === "string") return v.length * 2;
  if (typeof v === "number") return 8;
  if (typeof v === "boolean") return 4;
  if (v instanceof Uint8Array || v instanceof ArrayBuffer || (typeof Blob !== "undefined" && v instanceof Blob)) return v.byteLength ?? v.size ?? 0;
  if (depth > 6 || typeof v !== "object") return 0;
  let n = 0;
  for (const k of Array.isArray(v) ? v : Object.keys(v)) n += Array.isArray(v) ? approxSize(k, depth + 1) : k.length * 2 + approxSize(v[k], depth + 1);
  return n;
}

/** Every key of the store with its approximate size (reads all values: use for inventories, not in hot paths). */
export async function kvEntries() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push({ key: String(c.key), bytes: approxSize(c.value) });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }).catch(() => []);
}
export const kvKeys = async () => (await kvEntries()).map((e) => e.key);

/** Deletes every key of the store. */
export const kvClear = () => tx("readwrite", (s) => s.clear()).catch(() => undefined);

const MAX_RECENT_BYTES = 40 * 1024 * 1024;

/** Recent list: [{id, name, time, size, path?}] with bytes kept under `recent:<id>` (web only, size-capped). */
export async function getRecents() {
  return (await kvGet("recents")) || [];
}

let recentLimit = 12;
/** How many recent files are remembered (Settings > General; 0 turns the list off). */
export function setRecentLimit(n) {
  recentLimit = clampRecentLimit(n);
}

export async function addRecent({ name, bytes, path, isDir }) {
  const list = await getRecents();
  const id = path || `${name}:${Date.now()}`;
  // `isDir`: a project folder opened by path (desktop); it has no stored bytes and reopens through the folder reader.
  const next = pushRecent(list, { id, name, path, ...(isDir ? { isDir: true } : {}), time: Date.now(), size: bytes?.length || 0 }, recentLimit);
  if (recentLimit > 0 && bytes && bytes.length <= MAX_RECENT_BYTES && !path) await kvSet(`recent:${id}`, bytes);
  for (const gone of list.filter((r) => !next.some((n) => n.id === r.id))) await kvDelete(`recent:${gone.id}`);
  await kvSet("recents", next);
  return next;
}

/** Applies a smaller limit to the stored list right away. */
export async function trimRecents() {
  const list = await getRecents();
  const next = list.slice(0, recentLimit);
  for (const gone of list.slice(recentLimit)) await kvDelete(`recent:${gone.id}`);
  if (next.length !== list.length) await kvSet("recents", next);
  return next;
}

/** Empties the list and the stored copies. Returns a snapshot for `restoreRecents` (the Undo of "Clear recent"). */
export async function clearRecents() {
  const list = await getRecents();
  const bytes = new Map();
  for (const r of list) {
    const b = await kvGet(`recent:${r.id}`);
    if (b) bytes.set(r.id, b);
    await kvDelete(`recent:${r.id}`);
  }
  await kvSet("recents", []);
  return { list, bytes };
}

export async function restoreRecents({ list, bytes }) {
  for (const [id, b] of bytes) await kvSet(`recent:${id}`, b);
  await kvSet("recents", list);
  return list;
}

/** Removes one entry (and its stored copy) from the recent list; returns the new list. */
export async function removeRecent(id) {
  const next = dropRecent(await getRecents(), id);
  await kvDelete(`recent:${id}`);
  await kvSet("recents", next);
  return next;
}

export const getRecentBytes = (id) => kvGet(`recent:${id}`);

/** Autosave session: every open document as .ofini bytes. */
export async function saveSession(entries, active, key = "session") {
  await kvSet(key, { time: Date.now(), active, docs: entries });
}
export const loadSession = () => kvGet("session");
export const clearSession = () => kvDelete("session");
