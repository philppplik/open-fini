// Scene Studio referenced media (docs/scene-studio.md ▸ Referenced media, docs/file-format.md ▸ Scenes). On the
// desktop a media item can point at its file instead of carrying the bytes inside the .ofini file:
//
//   media item (format 4): { …, path, size, hash }   path = absolute path when it was imported or relinked,
//                                                     size = bytes, hash = fingerprint(bytes) (identity check)
//   stored:                document.json ▸ office.media[id] = { …, path, size, hash, rel? }   and no archive entry
//
// The bytes are read back when the scene opens (resolveMedia) and held in memory like embedded media; nothing else
// in the studio knows the difference. An item without bytes after that is offline: the media bin shows it with
// *Relink*, the viewer and the export skip its clips.
//
//   fingerprint(bytes)                       → Promise<string>   "fp1:<sha-256 hex>" of the size, first and last MiB
//   isReferenced(md) / isOffline(md)         → boolean
//   candidatePaths(md, docPath)              → string[]          where to look, most likely first
//   resolveMedia(model, { docPath, read })   → Promise<{ found, missing, changed, moved }>   hydrates items in place
//   matchFolder(model, files)                → [{ id, path }]    offline items found in a list of { path, size }
//   relativePath(fromDir, to), joinPath(dir, rel), dirName(path), baseName(path)   path helpers (\ and /)
// Invariants: pure apart from the injected `read`; `bytes` is the only field resolveMedia adds (runtime data, never
// written for a referenced item), `path` is updated when the file was found somewhere else (saved next time); a file
// whose size or fingerprint differs from the stored one is never used silently (reported as `changed`).

import { relativeTo } from "../core/office.js";

const SAMPLE = 1 << 20; // bytes hashed at each end of the file

/** Identity of a media file: SHA-256 over its size and its first and last MiB (fast for multi-GB video). */
export async function fingerprint(bytes) {
  const n = bytes.length;
  const head = bytes.subarray(0, Math.min(n, SAMPLE));
  const tail = n > SAMPLE * 2 ? bytes.subarray(n - SAMPLE) : bytes.subarray(head.length);
  const size = new TextEncoder().encode(`${n}:`);
  const buf = new Uint8Array(size.length + head.length + tail.length);
  buf.set(size, 0);
  buf.set(head, size.length);
  buf.set(tail, size.length + head.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buf));
  return "fp1:" + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isReferenced = (md) => typeof md?.path === "string" && md.path.length > 0;
export const isOffline = (md) => isReferenced(md) && !(md.bytes?.length > 0);

const sepOf = (p) => (/^[a-zA-Z]:[\\/]|^\\\\/.test(p) || (p.includes("\\") && !p.includes("/")) ? "\\" : "/");
const parts = (p) => String(p).split(/[\\/]+/).filter((s) => s.length);

export function baseName(p) {
  const s = parts(p);
  return s.length ? s[s.length - 1] : "";
}

export function dirName(p) {
  const str = String(p || "");
  const i = Math.max(str.lastIndexOf("/"), str.lastIndexOf("\\"));
  if (i < 0) return "";
  const d = i === 0 ? str[0] : str.slice(0, i);
  return /^[a-zA-Z]:$/.test(d) ? d + str[i] : d; // a drive root keeps its separator
}

const isWin = (p) => /^[a-zA-Z]:[\\/]|^\\\\/.test(p);
/** `to` relative to the folder `fromDir` ("../footage/a.mp4"), or null on another drive / share. */
export const relativePath = relativeTo;

/** Joins a folder and a relative path with the folder's separator; ".." steps up. */
export function joinPath(dir, rel) {
  if (!dir) return String(rel || "");
  const sep = sepOf(dir);
  const out = parts(isWin(dir) ? dir.slice(2) : dir);
  for (const s of parts(rel)) {
    if (s === "..") out.pop();
    else if (s !== ".") out.push(s);
  }
  const head = isWin(dir) ? (dir.startsWith("\\\\") ? "\\\\" : dir.slice(0, 2) + sep) : dir.startsWith("/") ? "/" : "";
  return head + out.join(sep);
}

/** Folder name of a project's collected media ("Trailer Media" next to "Trailer.ofini"). */
export const mediaFolderName = (docName) => `${String(docName || "Project").replace(/\.ofini$/i, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Project"} Media`;

/** Where an item's file may be, most likely first: its path, its path relative to the project, next to the project. */
export function candidatePaths(md, docPath = null) {
  const out = [];
  const add = (p) => p && !out.includes(p) && out.push(p);
  add(md.path);
  const dir = docPath ? dirName(docPath) : "";
  if (dir) {
    if (md.rel) add(joinPath(dir, md.rel));
    const name = baseName(md.path);
    if (name) {
      add(joinPath(dir, name));
      add(joinPath(dir, `${mediaFolderName(baseName(docPath))}/${name}`));
      add(joinPath(dir, `Media/${name}`));
    }
  }
  return out;
}

/** Checks bytes against an item's stored size and fingerprint (items written without them accept any file). */
export async function sameFile(md, bytes) {
  if (Number.isFinite(md.size) && md.size > 0 && bytes.length !== md.size) return false;
  if (typeof md.hash === "string" && md.hash.startsWith("fp1:")) return (await fingerprint(bytes)) === md.hash;
  return true;
}

/**
 * Reads the files of referenced items that have no bytes yet and attaches them (in place: every snapshot of the
 * model in the undo history shares the item). `read(path)` resolves with the bytes or rejects. Resolves with the ids
 * found, still missing, found but different (size or fingerprint), and found at another path (path updated).
 */
export async function resolveMedia(model, { docPath = null, read, onItem = () => {} } = {}) {
  const res = { found: [], missing: [], changed: [], moved: [] };
  for (const md of Object.values(model?.media || {})) {
    if (!isOffline(md)) continue;
    let state = "missing";
    for (const p of candidatePaths(md, docPath)) {
      let bytes;
      try {
        bytes = await read(p);
      } catch {
        continue;
      }
      if (!bytes?.length) continue;
      if (!(await sameFile(md, bytes))) {
        state = "changed";
        continue;
      }
      md.bytes = bytes;
      if (p !== md.path) {
        md.path = p;
        res.moved.push(md.id);
      }
      state = "found";
      break;
    }
    res[state === "found" ? "found" : state].push(md.id);
    onItem(md.id, state);
  }
  return res;
}

/** Offline items whose file name and size match a file in `files` ([{ path, size }], e.g. a folder listing). */
export function matchFolder(model, files) {
  const out = [];
  const byName = new Map();
  for (const f of files) {
    const k = baseName(f.path).toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(f);
  }
  for (const md of Object.values(model?.media || {})) {
    if (!isOffline(md)) continue;
    const hits = byName.get(baseName(md.path).toLowerCase()) || [];
    const hit = hits.find((f) => !(md.size > 0) || !(f.size > 0) || f.size === md.size);
    if (hit) out.push({ id: md.id, path: hit.path });
  }
  return out;
}
