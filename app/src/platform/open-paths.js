// Pure helpers for files the operating system hands to OpenFini ("Open with", file associations, launch
// arguments, the PWA launch queue). No DOM, no Tauri: the Rust side does the real argument parsing
// (src-tauri/src/cli.rs); this module re-checks what arrives in the webview and buffers files until the app listens.

/**
 * Converts a file:// URL to a local path (Windows drive and UNC forms included).
 * Returns null for anything that is not a file URL.
 * @param {string} url
 * @returns {string | null}
 */
export function fileUrlToPath(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== "file:") return null;
  let path;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  if (host && host !== "localhost") return `\\\\${host}${path.replace(/\//g, "\\")}`; // UNC share
  if (/^\/[A-Za-z]:/.test(path)) return path.slice(1).replace(/\//g, "\\"); // C:\folder\file
  return path || null;
}

/**
 * Cleans a list of paths or file:// URLs: drops non-strings, empty entries, option-like arguments and
 * duplicates, and turns URLs into paths. The order is kept.
 * @param {unknown} list
 * @returns {string[]}
 */
export function normalizeOpenPaths(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || text.startsWith("-")) continue;
    const path = /^file:/i.test(text) ? fileUrlToPath(text) : text;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * A buffer between "files arrived" and "the app is listening". Files delivered while nobody is subscribed are
 * kept and handed to the next subscriber right when it subscribes.
 * @template T
 * @returns {{ deliver: (items: T[]) => void, subscribe: (listener: (items: T[]) => void) => () => void, readonly pending: number }}
 */
export function createOpenBuffer() {
  /** @type {Set<(items: T[]) => void>} */
  const listeners = new Set();
  /** @type {T[]} */
  let pending = [];

  const call = (listener, items) => {
    try {
      listener(items);
    } catch (err) {
      console.error("OpenFini: onOpenFiles callback failed", err);
    }
  };

  return {
    deliver(items) {
      if (!items || items.length === 0) return;
      if (listeners.size === 0) {
        pending.push(...items);
        return;
      }
      for (const listener of [...listeners]) call(listener, items);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (pending.length > 0) {
        const items = pending;
        pending = [];
        call(listener, items);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    get pending() {
      return pending.length;
    },
  };
}

/** Files above this size get a progress message while they open. */
export const LARGE_FILE_BYTES = 25 * 1024 * 1024;

/** Case-insensitive path comparison on Windows/macOS paths (backslashes or drive letters), exact otherwise. */
export function samePath(a, b) {
  if (!a || !b) return false;
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(a) || /^[A-Za-z]:[\\/]|^\\\\/.test(b);
  const norm = (p) => (windows ? p.replace(/\//g, "\\").toLowerCase() : p);
  return norm(a) === norm(b);
}
