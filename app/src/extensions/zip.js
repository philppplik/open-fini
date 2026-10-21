// `.ofext` packages: a ZIP with openfini-extension.json at its root (or inside one top-level folder).
// Unpacking is defensive: path traversal, absolute paths, zip bombs and absurd file counts are rejected.
import { unzipSync, zipSync, strFromU8 } from "../../vendor/fflate/fflate.js";
import { MANIFEST_FILE } from "./manifest.js";

export const PACK_LIMITS = { maxFiles: 500, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 24 * 1024 * 1024 };

/** Normalizes a path inside a package; null for anything unsafe (absolute, "..", drive letters, empty). */
export function safePath(p) {
  const s = String(p).replace(/\\/g, "/");
  if (!s || s.startsWith("/") || /^[a-zA-Z]:/.test(s) || /[\0:*?"<>|]/.test(s)) return null;
  const parts = s.split("/").filter((x) => x && x !== ".");
  if (!parts.length || parts.some((x) => x === "..")) return null;
  return parts.join("/");
}

const SKIP = /(^|\/)(__MACOSX|\.git|node_modules|\.DS_Store|Thumbs\.db)(\/|$)/;

/** Strips a single wrapping folder when the manifest lives inside it. */
export function stripRoot(files) {
  if (files[MANIFEST_FILE]) return files;
  const paths = Object.keys(files);
  const root = paths.find((p) => p.endsWith(`/${MANIFEST_FILE}`) && p.split("/").length === 2);
  if (!root) return files;
  const prefix = root.slice(0, root.length - MANIFEST_FILE.length);
  const out = {};
  for (const [p, b] of Object.entries(files)) if (p.startsWith(prefix)) out[p.slice(prefix.length)] = b;
  return out;
}

/** @returns {Record<string, Uint8Array>} files by safe relative path (wrapper folder removed) */
export function unpackExtension(bytes, limits = PACK_LIMITS) {
  let total = 0;
  let count = 0;
  let raw;
  try {
    raw = unzipSync(bytes, {
      filter(f) {
        if (f.name.endsWith("/")) return false;
        const path = safePath(f.name);
        if (!path) throw new Error(`The package contains an unsafe path: “${f.name}”.`);
        if (SKIP.test(path)) return false;
        if (++count > limits.maxFiles) throw new Error(`The package has more than ${limits.maxFiles} files.`);
        if (f.originalSize > limits.maxFileBytes) throw new Error(`“${path}” is larger than ${limits.maxFileBytes / 1048576} MB when unpacked.`);
        total += f.originalSize;
        if (total > limits.maxTotalBytes) throw new Error(`The package is larger than ${limits.maxTotalBytes / 1048576} MB when unpacked.`);
        return true;
      },
    });
  } catch (err) {
    if (/unsafe path|more than|larger than/.test(err.message)) throw err;
    throw new Error("This is not a valid .ofext package (it could not be unzipped).");
  }
  const files = {};
  for (const [name, data] of Object.entries(raw)) {
    const path = safePath(name);
    if (path) files[path] = data;
  }
  const out = stripRoot(files);
  if (!out[MANIFEST_FILE]) throw new Error(`The package has no ${MANIFEST_FILE} at its top level.`);
  return out;
}

/** Zips files ({path: Uint8Array|string}); the manifest goes first. */
export function packExtension(files, { level = 6 } = {}) {
  const enc = new TextEncoder();
  const entries = {};
  const names = Object.keys(files).sort((a, b) => (a === MANIFEST_FILE ? -1 : b === MANIFEST_FILE ? 1 : a < b ? -1 : 1));
  for (const n of names) {
    const path = safePath(n);
    if (!path) throw new Error(`Unsafe path: ${n}`);
    const data = typeof files[n] === "string" ? enc.encode(files[n]) : files[n];
    entries[path] = [data, { level: data.length < 64 ? 0 : level, mtime: 1577836800000 }];
  }
  return zipSync(entries);
}

/** Parses the manifest JSON of unpacked files; throws a readable error. */
export function readManifest(files) {
  const bytes = files[MANIFEST_FILE];
  if (!bytes) throw new Error(`The package has no ${MANIFEST_FILE}.`);
  try {
    return JSON.parse(strFromU8(bytes).replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`${MANIFEST_FILE} is not valid JSON: ${err.message}`);
  }
}
