// Builds the published site from the project files: copy, optional minification, single-file mode, sitemap.
// Pure: no DOM, no fetch. See docs/web-engine.md.
import { parseHtml, getAttr, decodeEntities } from "./html.js";
import { parseCss, cssUrls, parseImport, minifyCss } from "./css.js";
import { normalizePath, resolveRef, joinPath } from "./paths.js";
import { utf8Bytes, lineOf } from "./bytes.js";
import { applyChanges } from "./edit.js";
import { buildPreview } from "./preview.js";
import { usesMarkdownSite, isSiteSource } from "./ssg.js";

/**
 * @typedef {{ list(): string[], readText(path: string): string|null, readBytes(path: string): Uint8Array|null }} FileSourceLike
 * @typedef {{
 *   minify?: boolean, singleFile?: boolean, siteUrl?: string, include?: (path: string) => boolean, entry?: string
 * }} SiteOptions
 */

const defaultInclude = (path) => !path.split("/").some((seg) => seg.startsWith(".") || seg === "node_modules" || seg === ".git");

// ------------------------------------------------------------------------------------------------ HTML minifier

const INLINE = new Set([
  "a", "abbr", "audio", "b", "bdi", "bdo", "br", "button", "canvas", "cite", "code", "data", "del", "dfn", "em", "embed", "i", "iframe",
  "img", "input", "ins", "kbd", "label", "mark", "math", "meter", "object", "output", "picture", "progress", "q", "ruby", "s", "samp",
  "select", "slot", "small", "span", "strong", "sub", "sup", "svg", "textarea", "time", "u", "var", "video", "wbr",
]);
const PRESERVE = new Set(["pre", "textarea", "script", "style"]);
const HTML_WS = /[ \t\n\r\f]+/g;

/**
 * Minifies HTML: removes comments (except conditional comments) and collapses insignificant whitespace outside
 * <pre>, <textarea>, <script> and <style>. Inline <style> blocks are minified as CSS; scripts are untouched.
 * @param {string} source
 * @returns {string}
 */
export function minifyHtml(source) {
  const parsed = parseHtml(source);
  const changes = [];
  const isBoundary = (node, parent) => {
    if (!node) return !parent || !INLINE.has(parent.tag);
    return node.type === "element" ? !INLINE.has(node.tag) : false;
  };
  const visit = (list, parent) => {
    const sig = list.filter((n) => n.type !== "comment");
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (node.type === "comment") {
        const text = source.slice(node.start, node.end);
        if (!/^<!--\s*\[if\b|^<!\[endif|^<!--<!\[endif/i.test(text) && !/^<!--!/.test(text)) changes.push({ from: node.start, to: node.end, insert: "" });
      } else if (node.type === "text") {
        if (parent && parent.tag === "style") {
          const css = minifyCss(node.text);
          if (css !== node.text) changes.push({ from: node.start, to: node.end, insert: css });
          continue;
        }
        if (parent && PRESERVE.has(parent.tag)) continue;
        const k = sig.indexOf(node);
        const left = isBoundary(sig[k - 1], parent);
        const right = isBoundary(sig[k + 1], parent);
        let t = node.text.replace(HTML_WS, " ");
        if (t === " ") t = left || right ? "" : " ";
        else {
          if (left) t = t.replace(/^ /, "");
          if (right) t = t.replace(/ $/, "");
        }
        if (t !== node.text) changes.push({ from: node.start, to: node.end, insert: t });
      } else if (node.type === "element") {
        // whitespace between attributes
        for (const a of node.attrs) {
          let f = a.start;
          while (f > node.open.start + 1 && /\s/.test(source[f - 1])) f--;
          if (source.slice(f, a.start) !== " " && f < a.start && f > node.open.start + 1) changes.push({ from: f, to: a.start, insert: " " });
        }
        if (node.tag === "style" || !PRESERVE.has(node.tag)) visit(node.children, node);
      }
    }
  };
  visit(parsed.children, null);
  return changes.length ? applyChanges(source, changes) : source;
}

// ------------------------------------------------------------------------------------------------ reference checks

/**
 * Local references of an HTML document: { ref, start, end } with offsets into the source.
 * @param {string} text
 */
function htmlRefs(text) {
  const parsed = parseHtml(text);
  const refs = [];
  const add = (a, rawStart, rawEnd) => refs.push({ ref: decodeEntities(text.slice(rawStart, rawEnd)), start: rawStart, end: rawEnd, attr: a });
  for (const el of parsed.elements) {
    for (const a of el.attrs) {
      if (a.value === null || a.unterminated) continue;
      const tag = el.tag;
      if (a.name === "href" && (tag === "a" || tag === "area" || tag === "link" || tag === "image" || tag === "use")) add(a, a.valueStart, a.valueEnd);
      else if (a.name === "src" && ["img", "script", "source", "iframe", "video", "audio", "track", "embed"].includes(tag)) add(a, a.valueStart, a.valueEnd);
      else if (a.name === "src" && tag === "input" && (getAttr(el, "type") || "").toLowerCase() === "image") add(a, a.valueStart, a.valueEnd);
      else if (a.name === "poster" && tag === "video") add(a, a.valueStart, a.valueEnd);
      else if (a.name === "data" && tag === "object") add(a, a.valueStart, a.valueEnd);
      else if (a.name === "srcset" && (tag === "img" || tag === "source")) {
        for (const m of a.value.matchAll(/(?:^|,)\s*([^\s,]+)/g)) {
          const s = a.valueStart + m.index + m[0].length - m[1].length;
          add(a, s, s + m[1].length);
        }
      } else if (a.name === "style" && /url\(/i.test(a.value)) {
        const css = decodeEntities(a.value);
        for (const u of cssUrls(css)) refs.push({ ref: u.url, start: a.valueStart, end: a.valueEnd, attr: a });
      }
    }
    if (el.tag === "style" && el.children[0] && el.children[0].type === "text") {
      const t = el.children[0];
      for (const r of cssRefs(t.text)) refs.push({ ref: r.ref, start: t.start + r.start, end: t.start + r.end, inline: true });
    }
  }
  return refs;
}

/** Local references of a stylesheet: url() and @import. */
function cssRefs(text) {
  const out = [];
  const parsed = parseCss(text);
  const skip = [];
  for (const r of parsed.rules) {
    if (r.type === "at" && r.name === "import" && !r.block) {
      skip.push([r.start, r.end]);
      const imp = parseImport(r.prelude);
      if (imp) out.push({ ref: imp.url, start: r.preludeStart, end: r.preludeEnd });
    }
  }
  for (const u of cssUrls(text)) if (!skip.some(([a, b]) => u.start >= a && u.start < b)) out.push({ ref: u.url, start: u.urlStart, end: u.urlEnd });
  return out;
}

// ------------------------------------------------------------------------------------------------ build

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * Builds the published site. Output paths mirror the project.
 * @param {FileSourceLike} files
 * @param {SiteOptions} [options]
 * @returns {{ files: { path: string, bytes: Uint8Array }[], warnings: string[], stats: { files: number, bytes: number } }}
 */
export function buildSite(files, options = {}) {
  // Markdown sites: the sources (content/, layouts/, site.json) are not published, only the generated pages
  const generated = !options.include && usesMarkdownSite(files);
  const include = options.include || (generated ? (p) => defaultInclude(p) && !isSiteSource(p) : defaultInclude);
  const entry = normalizePath(options.entry || "index.html");
  const paths = [...new Set(files.list().map(normalizePath).filter((p) => p && include(p)))].sort();
  const have = new Set(paths);
  const warnings = [];
  const out = [];
  const isHtml = (p) => /\.html?$/i.test(p);
  const isCss = (p) => /\.css$/i.test(p);
  const exists = (path) => have.has(path) || (path !== "" && have.has(joinPath(path, "index.html"))) || (path === "" && have.has("index.html"));

  const check = (file, text, refs) => {
    for (const r of refs) {
      const ref = resolveRef(file, r.ref);
      if (!ref) continue;
      if (!exists(ref.path)) warnings.push(`${file} (line ${lineOf(text, r.start)}): missing file "${ref.path}"`);
    }
  };

  if (!have.has(entry)) warnings.push(`The project has no ${entry}; the site root will not show a page.`);

  for (const path of paths) {
    const html = isHtml(path);
    const css = isCss(path);
    const text = html || css ? files.readText(path) : null;
    if (text !== null && html) check(path, text, htmlRefs(text));
    if (text !== null && css) check(path, text, cssRefs(text));
    if (options.singleFile) {
      if (!html || text === null) continue;
      const res = buildPreview(files, path, { inlineAll: true, minifyCss: !!options.minify });
      for (const d of res.diagnostics) {
        if (d.code !== "preview/missing-file") warnings.push(`${d.file}: ${d.message}`);
      }
      out.push({ path, bytes: utf8Bytes(options.minify ? minifyHtml(res.html) : res.html) });
      continue;
    }
    if (text !== null && options.minify && html) out.push({ path, bytes: utf8Bytes(minifyHtml(text)) });
    else if (text !== null && options.minify && css) out.push({ path, bytes: utf8Bytes(minifyCss(text)) });
    else {
      const bytes = files.readBytes(path);
      if (bytes) out.push({ path, bytes });
    }
  }

  if (options.siteUrl) {
    const base = String(options.siteUrl).trim().replace(/\/+$/, "");
    const generated = new Set(out.map((f) => f.path));
    if (!generated.has("sitemap.xml") && !have.has("sitemap.xml")) {
      const urls = paths
        .filter((p) => isHtml(p) && !/(^|\/)404\.html?$/i.test(p))
        .map((p) => {
          let loc = p;
          if (/(^|\/)index\.html?$/i.test(p)) loc = p.replace(/index\.html?$/i, "");
          return `  <url><loc>${xmlEscape(base + "/" + loc.split("/").map(encodeURIComponent).join("/"))}</loc></url>`;
        });
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
      out.push({ path: "sitemap.xml", bytes: utf8Bytes(xml) });
    }
    if (!generated.has("robots.txt") && !have.has("robots.txt")) {
      out.push({ path: "robots.txt", bytes: utf8Bytes(`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`) });
    }
  }

  let total = 0;
  for (const f of out) total += f.bytes.length;
  return { files: out, warnings, stats: { files: out.length, bytes: total } };
}
