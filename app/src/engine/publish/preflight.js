// Pre-publish checks of a website project: broken links, missing alt text, title/description/viewport/lang, mixed
// content, oversized files. Pure; reads the project through a FileSource ({ list, readText, readBytes }).
import { parseHtml, getAttr, findByTag, elementText, resolveRef, isExternalRef } from "../web/index.js";

const MAX_FILE = 10 * 1024 * 1024;
const LINK_ATTRS = [["a", "href"], ["link", "href"], ["script", "src"], ["img", "src"], ["source", "src"], ["video", "src"], ["video", "poster"], ["audio", "src"], ["iframe", "src"], ["form", "action"]];

/**
 * @param {{ list(): string[], readText(p: string): string | null, readBytes(p: string): Uint8Array | null }} source
 * @param {{ entry?: string }} [opts]
 * @returns {{ severity: "error" | "warning" | "info", code: string, path: string, message: string }[]}
 */
export function preflight(source, { entry = "index.html" } = {}) {
  const out = [];
  const add = (severity, code, path, message) => out.push({ severity, code, path, message });
  const all = new Set(source.list());
  const pages = [...all].filter((p) => /\.html?$/i.test(p));
  if (!pages.length) add("error", "site/no-pages", "", "The project has no HTML page to publish.");
  else if (!all.has(entry) && !all.has("index.html")) add("warning", "site/no-index", "", `There is no ${entry}; visitors of the site root will see an error or a file list.`);
  const exists = (p) => all.has(p) || all.has(`${p.replace(/\/$/, "")}/index.html`.replace(/^\//, ""));
  for (const p of all) {
    const n = source.readBytes(p)?.length ?? 0;
    if (n > MAX_FILE) add("warning", "site/large-file", p, `${p} is ${(n / 1048576).toFixed(1)} MB. Large files slow the site down and some hosts reject them.`);
  }
  for (const page of pages) {
    const text = source.readText(page);
    if (text == null) continue;
    const parsed = parseHtml(text);
    const html = findByTag(parsed, "html");
    const title = findByTag(parsed, "title");
    if (!title || !elementText(parsed, title).trim()) add("warning", "html/no-title", page, "The page has no title. Search engines and browser tabs show it.");
    if (!parsed.elements.some((e) => e.tag === "meta" && (getAttr(e, "name") || "").toLowerCase() === "description" && (getAttr(e, "content") || "").trim())) add("info", "html/no-description", page, "The page has no meta description.");
    if (!parsed.elements.some((e) => e.tag === "meta" && (getAttr(e, "name") || "").toLowerCase() === "viewport")) add("warning", "html/no-viewport", page, "The page has no viewport meta tag, so it will not scale on phones.");
    if (html && !(getAttr(html, "lang") || "").trim()) add("warning", "html/no-lang", page, "The <html> element has no lang attribute.");
    for (const d of parsed.errors) {
      if (d.code === "html/img-alt") add("warning", "html/img-alt", page, "An image has no alt text.");
      else if (d.code === "html/duplicate-id") add("warning", d.code, page, d.message);
      else if (d.code === "html/unclosed") add("error", d.code, page, d.message);
    }
    const ids = new Set(parsed.elements.map((e) => getAttr(e, "id")).filter(Boolean));
    for (const el of parsed.elements) {
      for (const [tag, attr] of LINK_ATTRS) {
        if (el.tag !== tag) continue;
        const ref = getAttr(el, attr);
        if (!ref || !ref.trim()) continue;
        if (/^http:\/\//i.test(ref) && tag !== "a") add("warning", "html/mixed-content", page, `“${ref.slice(0, 80)}” loads over http://. Browsers block this on https sites.`);
        if (isExternalRef(ref)) continue;
        if (ref.startsWith("#")) {
          if (ref.length > 1 && tag === "a" && !ids.has(decodeURIComponent(ref.slice(1))) && ref !== "#top") add("warning", "link/anchor", page, `The link “${ref}” points to an element that does not exist on this page.`);
          continue;
        }
        const r = resolveRef(page, ref);
        if (r && !exists(r.path)) add("error", "link/broken", page, `“${ref}” points to a file that is not in the project (${r.path}).`);
      }
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path));
}

/** One-line summary: "2 errors, 3 warnings". */
export function summarizeIssues(issues) {
  const c = (s) => issues.filter((i) => i.severity === s).length;
  const parts = [];
  if (c("error")) parts.push(`${c("error")} error${c("error") === 1 ? "" : "s"}`);
  if (c("warning")) parts.push(`${c("warning")} warning${c("warning") === 1 ? "" : "s"}`);
  if (c("info")) parts.push(`${c("info")} note${c("info") === 1 ? "" : "s"}`);
  return parts.join(", ") || "No problems found";
}
