// Pop-out windows: the pure parts (no DOM, no Tauri, no IndexedDB), unit tested in tests/packaging/popout.test.js.
// The runtime that uses them (windows, BroadcastChannel, IndexedDB) is app/src/ui/popout.js. See docs/multi-window.md.
//
// Public API
//   parsePopoutParams(search)        -> { id, studio, doc } | null   (?popout=<studio>&doc=<id>&pid=<windowId>)
//   buildPopoutUrl(base, opts)       -> URL string for window.open / WebviewWindow
//   makeEnvelope(fields) / readEnvelope(value) -> handoff envelope (one document as .ofini bytes) / validated copy
//   handoffKey(id), sessionKey(id)   -> IndexedDB keys ("popout:<id>", "popout-session:<id>")
//   createPopoutRegistry()           -> bookkeeping of open pop-outs in the main window
//   nextWindowLabel(taken)           -> "popout-<n>" (Tauri labels; matches the capability glob popout-*)
//   isMessage(msg)                   -> shape check of BroadcastChannel messages
// Invariants: envelopes are plain structured-clonable data (bytes are a Uint8Array); ids are url/key safe.

export const CHANNEL = "openfini-popout";
export const ENVELOPE_VERSION = 1;
export const HANDOFF_MODES = ["move", "copy"];
/** Message types on the channel. */
export const MESSAGE_TYPES = ["adopted", "return", "ping", "pong", "closed"];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
export const isSafeId = (v) => typeof v === "string" && ID_RE.test(v);

/** Short random id (injectable random for tests). */
export function newId(rand = Math.random, now = Date.now) {
  return `${now().toString(36)}${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

export const handoffKey = (id) => `popout:${id}`;
export const sessionKey = (id) => `popout-session:${id}`;

/** `?popout=<studio>&doc=<handoff id>&pid=<window id>`; null when this is a normal window. */
export function parsePopoutParams(search) {
  const p = new URLSearchParams(search || "");
  if (!p.has("popout")) return null;
  const studio = (p.get("popout") || "").trim();
  const doc = p.get("doc");
  const pid = p.get("pid");
  return {
    id: isSafeId(pid) ? pid : newId(),
    studio: /^[a-z0-9_-]{1,32}$/i.test(studio) ? studio : "",
    doc: isSafeId(doc) ? doc : null,
  };
}

export function buildPopoutUrl(base, { studio, doc, pid } = {}) {
  const q = new URLSearchParams();
  q.set("popout", studio || "");
  if (doc) q.set("doc", doc);
  if (pid) q.set("pid", pid);
  const prefix = String(base).split(/[?#]/)[0]; // any query of the base is replaced
  return `${prefix}?${q}`;
}

/** @param {{id:string,name:string,studio?:string,bytes:Uint8Array,saved?:boolean,path?:string|null,untrusted?:boolean,mode?:string}} f */
export function makeEnvelope(f) {
  if (!isSafeId(f.id)) throw new Error("Invalid handoff id");
  if (!(f.bytes instanceof Uint8Array) || !f.bytes.length) throw new Error("A handoff needs the document bytes");
  const mode = HANDOFF_MODES.includes(f.mode) ? f.mode : "move";
  return { v: ENVELOPE_VERSION, id: f.id, name: String(f.name || "Untitled"), studio: f.studio || "vector", saved: !!f.saved, path: f.path || null, untrusted: !!f.untrusted, mode, bytes: f.bytes, time: Date.now() };
}

/** Validates a value read from storage; returns it or null (wrong version, no bytes, bad id). */
export function readEnvelope(v) {
  if (!v || typeof v !== "object" || v.v !== ENVELOPE_VERSION || !isSafeId(v.id)) return null;
  if (!(v.bytes instanceof Uint8Array) || !v.bytes.length) return null;
  return v;
}

export function isMessage(m) {
  return !!m && typeof m === "object" && MESSAGE_TYPES.includes(m.type) && (m.type === "ping" || isSafeId(m.id));
}

export function nextWindowLabel(taken = []) {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`popout-${n}`)) n++;
  return `popout-${n}`;
}

/** Which pop-outs the main window knows: window id → { id, label, studio, docs: handoff ids }. */
export function createPopoutRegistry() {
  const map = new Map();
  return {
    add(entry) {
      map.set(entry.id, { docs: [], ...entry });
      return map.get(entry.id);
    },
    get: (id) => map.get(id),
    remove: (id) => map.delete(id),
    attachDoc(id, docId) {
      const e = map.get(id);
      if (e && !e.docs.includes(docId)) e.docs.push(docId);
    },
    /** Window that received handoff `docId`, if any. */
    byDoc: (docId) => [...map.values()].find((e) => e.docs.includes(docId)) || null,
    list: () => [...map.values()],
    labels: () => [...map.values()].map((e) => e.label).filter(Boolean),
    get size() {
      return map.size;
    },
  };
}
