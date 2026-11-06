// Deciding how dropped files open (ui/open-drop.js). Pure, no DOM.
//
//   localRefsOfHtml(html)              local paths a page loads: stylesheets, scripts, images, media, icons, frames and
//                                      url() in style attributes and <style> (external URLs, data:, # and mailto: skipped)
//   planHtmlDrop(entries, texts)       for dropped files [{ path, size }] and the text of each dropped HTML file:
//                                      { page, refs, matched: [{ path, target }], missing: [ref] } for the first page that
//                                      references local files, or null. `target` is where the file must go in a project
//                                      so the page finds it (a dropped "style.css" lands at "css/style.css").
//   projectFromZip(bytes, limits)      { files: [{ path, bytes }], problems, name? } read with zip-slip protection (no "..",
//                                      absolute paths, drive letters or backslashes), entry-count and size limits; macOS
//                                      metadata, dot files, .git and node_modules are skipped; one wrapping folder is
//                                      removed (its name is returned).
import { readZip } from "../office/zip.js";
import { isExternalRef, resolveRef, normalizePath } from "./paths.js";

const ATTR = /\s(?:src|href|poster|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SRCSET = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const URL_FN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

const isLocal = (ref) => !!ref && !isExternalRef(ref) && !/^(#|data:|mailto:|tel:|javascript:|about:|blob:|\$\{|\{\{)/i.test(ref);

/** @param {string} html */
export function localRefsOfHtml(html) {
  const s = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const out = new Set();
  const add = (ref) => {
    const r = String(ref || "").trim().split(/[?#]/)[0];
    if (isLocal(r) && r !== "/" && !r.endsWith("/")) out.add(r);
  };
  // only tags that load something: links to other pages (<a href>) are not dependencies of this page
  for (const tag of s.matchAll(/<(link|script|img|source|video|audio|track|iframe|embed|object|input|image|use)\b[^>]*>/gi)) {
    const text = tag[0];
    if (tag[1].toLowerCase() === "link" && !/\brel\s*=\s*["']?[^"'>]*(stylesheet|icon|manifest|preload|modulepreload)/i.test(text)) continue;
    for (const m of text.matchAll(ATTR)) add(m[1] ?? m[2] ?? m[3]);
    for (const m of text.matchAll(SRCSET)) for (const part of (m[1] ?? m[2]).split(",")) add(part.trim().split(/\s+/)[0]);
  }
  for (const m of s.matchAll(URL_FN)) add(m[1] ?? m[2] ?? m[3]);
  return [...out];
}

const base = (p) => p.split("/").pop().toLowerCase();

/**
 * @param {{ path: string, size?: number }[]} entries dropped files (flat names or paths)
 * @param {Record<string, string>} texts text of each dropped HTML file by path
 */
export function planHtmlDrop(entries, texts) {
  const pages = entries.filter((e) => /\.html?$/i.test(e.path)).sort((a, b) => (/(^|\/)index\.html?$/i.test(b.path) ? 1 : 0) - (/(^|\/)index\.html?$/i.test(a.path) ? 1 : 0));
  for (const page of pages) {
    const refs = localRefsOfHtml(texts[page.path] || "");
    if (!refs.length) continue;
    const matched = [];
    const missing = [];
    const used = new Set([page.path]);
    for (const ref of refs) {
      const res = resolveRef(page.path, ref);
      const target = res && normalizePath(res.path);
      if (!target) continue;
      const exact = entries.find((e) => e.path === target && !used.has(e.path));
      const byName = exact || entries.find((e) => base(e.path) === base(target) && !used.has(e.path));
      if (byName) {
        used.add(byName.path);
        matched.push({ path: byName.path, target });
      } else if (!entries.some((e) => e.path === target)) missing.push(ref);
    }
    return { page: page.path, refs, matched, missing };
  }
  return null;
}

export const ZIP_PROJECT_LIMITS = { maxEntries: 5000, maxEntryBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 };
const SKIP = /(^|\/)(__MACOSX|\.git|\.svn|\.hg|node_modules|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/;

/**
 * @param {Uint8Array} bytes
 * @param {Partial<typeof ZIP_PROJECT_LIMITS>} [limits]
 * @returns {{ files: { path: string, bytes: Uint8Array }[], problems: string[], name: string }}
 */
export function projectFromZip(bytes, limits = {}) {
  const L = { ...ZIP_PROJECT_LIMITS, ...limits };
  const { entries, problems, ok } = readZip(bytes, { want: (n) => !SKIP.test(n), limits: L });
  if (!ok) return { files: [], problems, name: "" };
  let files = [];
  for (const [name, data] of Object.entries(entries)) {
    const path = normalizePath(name);
    // normalizePath must not have changed the meaning: a name that only becomes safe by normalization is rejected
    if (!path || path !== name.replace(/^\.\//, "") || path.split("/").some((seg) => seg.startsWith("."))) continue;
    files.push({ path, bytes: data });
  }
  // one wrapping folder ("site/index.html", "site/css/...") is the project root
  let name = "";
  const tops = new Set(files.map((f) => f.path.split("/")[0]));
  if (tops.size === 1 && files.length && files.every((f) => f.path.includes("/"))) {
    name = [...tops][0];
    files = files.map((f) => ({ ...f, path: f.path.slice(name.length + 1) }));
  }
  return { files, problems, name };
}
