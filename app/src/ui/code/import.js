// Getting files into a project: file picker, folder picker and drag & drop (including dropped folders).
import { h } from "../../core/util.js";
import { normalizePath, sanitizeFileName } from "../../engine/web/index.js";

const SKIP = /(^|\/)(\.git|\.svn|\.hg|node_modules|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/;
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/** Opens the system file picker. Resolves with File[] (empty when cancelled). */
export function pickFiles({ directory = false, accept = "", multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", multiple, accept, style: { display: "none" } });
    if (directory) input.webkitdirectory = true;
    let settled = false;
    const done = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done([...input.files]));
    input.addEventListener("cancel", () => done([]));
    document.body.append(input);
    input.click();
  });
}

/** Converts picked files to [{ path, file }]; folder picks drop the top-level folder name. */
export function entriesFromPicked(files, { directory = false } = {}) {
  const out = [];
  for (const file of files) {
    let path = directory && file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
    path = normalizePath(path);
    if (!path || SKIP.test(path)) continue;
    out.push({ path, file });
  }
  return out;
}

/** Reads a drop event's DataTransfer, walking dropped folders. Returns Promise<[{ path, file }]>. */
export async function entriesFromDrop(dataTransfer) {
  const out = [];
  const items = [...(dataTransfer.items || [])].filter((i) => i.kind === "file");
  const roots = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!roots.length) {
    for (const file of dataTransfer.files || []) out.push({ path: normalizePath(file.name), file });
    return out;
  }
  const walk = async (entry, prefix) => {
    if (SKIP.test(`${prefix}${entry.name}`)) return;
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: normalizePath(`${prefix}${entry.name}`), file });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const r of roots) await walk(r, "");
  return out;
}

/**
 * Adds [{ path, file }] to a project under `prefix`. Returns { added, replaced, skipped }.
 * `confirmReplace(paths)` is asked once when files already exist (resolve true to overwrite).
 */
export async function importInto(web, entries, { prefix = "", confirmReplace } = {}) {
  let total = 0;
  for (const e of entries) total += e.file.size;
  if (total > MAX_IMPORT_BYTES) throw new Error(`That is ${(total / 1048576).toFixed(0)} MB — projects are limited to ${MAX_IMPORT_BYTES / 1048576} MB.`);
  const target = (e) => normalizePath(prefix ? `${prefix}/${cleanPath(e.path)}` : cleanPath(e.path));
  const clash = entries.map(target).filter((p) => web.has(p));
  let overwrite = true;
  if (clash.length && confirmReplace) overwrite = await confirmReplace(clash);
  const res = { added: 0, replaced: 0, skipped: 0 };
  for (const e of entries) {
    const path = target(e);
    if (!path) continue;
    const exists = web.has(path);
    if (exists && !overwrite) {
      res.skipped++;
      continue;
    }
    web.put(path, new Uint8Array(await e.file.arrayBuffer()), { mime: e.file.type || undefined });
    res[exists ? "replaced" : "added"]++;
  }
  return res;
}

function cleanPath(p) {
  return p
    .split("/")
    .map((s) => sanitizeFileName(s))
    .filter(Boolean)
    .join("/");
}
