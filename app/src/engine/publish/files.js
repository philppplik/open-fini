// What gets published: include/exclude globs, a dry-run summary and the ZIP that most targets upload. Pure.
import { zipSync } from "../../../vendor/fflate/fflate.js";
import { createIgnore } from "../git/ignore.js";
import { mimeOf } from "../web/paths.js";

/** Always left out of a deployment (editor and system leftovers). */
export const DEFAULT_EXCLUDE = [".git/", ".gitignore", ".DS_Store", "Thumbs.db", "desktop.ini"];

const lines = (v) => (Array.isArray(v) ? v : String(v || "").split(/\r?\n|,/)).map((s) => s.trim()).filter(Boolean);
export const parseGlobs = lines;

/**
 * @param {{ path: string, bytes: Uint8Array }[]} files
 * @param {{ include?: string | string[], exclude?: string | string[] }} [opts] gitignore-style patterns (`*.map`, `drafts/`, `**\/*.psd`)
 * @returns {{ files: { path: string, bytes: Uint8Array }[], skipped: string[] }}
 */
export function selectFiles(files, { include = [], exclude = [] } = {}) {
  const inc = lines(include);
  const exc = [...DEFAULT_EXCLUDE, ...lines(exclude)];
  const isExc = createIgnore((p) => (p === ".gitignore" ? exc.join("\n") : null), [".gitignore"]);
  const isInc = inc.length ? createIgnore((p) => (p === ".gitignore" ? inc.join("\n") : null), [".gitignore"]) : null;
  const out = [];
  const skipped = [];
  for (const f of files) {
    if (isExc(f.path) || (isInc && !isInc(f.path))) skipped.push(f.path);
    else out.push(f);
  }
  return { files: out, skipped };
}

/** Plain description of an upload for the confirmation dialog: counts, bytes and the largest files. */
export function summarize(files) {
  const bytes = files.reduce((n, f) => n + f.bytes.length, 0);
  return { count: files.length, bytes, largest: [...files].sort((a, b) => b.bytes.length - a.bytes.length).slice(0, 5).map((f) => ({ path: f.path, bytes: f.bytes.length })) };
}

const STORED = /\.(png|jpe?g|gif|webp|avif|woff2?|mp4|webm|mp3|ogg|zip|pdf)$/i;
export function zipFiles(files) {
  const z = {};
  for (const f of files) z[f.path] = [f.bytes, { level: STORED.test(f.path) ? 0 : 6 }];
  return zipSync(z);
}

export const contentType = (path) => mimeOf(path);

/** Escapes a project path for use in a URL path (keeps slashes). */
export const urlPath = (path) => path.split("/").map(encodeURIComponent).join("/");

/** Joins a base URL and a project path. */
export function joinUrl(base, path) {
  return `${base.replace(/\/+$/, "")}/${urlPath(path)}`;
}

export const sleepMs = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Cancelled", "AbortError"))), { once: true });
  });
