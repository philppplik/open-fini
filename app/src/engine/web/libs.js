// Libraries for projects without a build step: CDN URLs, import maps, a curated catalog, detection of what a
// project already uses, edit producers (add / remove / update a library in HTML), response parsers for the package
// APIs (npm registry, jsDelivr data API, cdnjs) and the planner that "vendors" a library into the project so the
// exported site works offline. Pure: no DOM, no network (callers inject `fetchBytes`).
import { getAttr, findByTag, decodeEntities } from "./html.js";
import { setAttribute, insertHtml, deleteElement, setText } from "./edit.js";
import { scanModuleSpecifiers, resolveImportMap } from "./preview.js";
import { cssUrls, parseImport, parseCss } from "./css.js";
import { relativeRef, normalizePath, resolveRef } from "./paths.js";

/**
 * @typedef {{ cdn: 'jsdelivr'|'unpkg'|'cdnjs'|'esm.sh'|'other', pkg: string, version: string, file: string }} CdnRef
 * @typedef {{
 *   id: string, name: string, version: string, url: string, cdn: string, kind: 'script'|'module'|'style'|'importmap'|'import',
 *   file: string, local: boolean, specifier?: string, elementId?: number, vendored: boolean
 * }} Library
 */

/** Hosts the desktop app's Content-Security-Policy allows for scripts and styles. */
export const ALLOWED_CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"];

// ------------------------------------------------------------------------------------------------ CDN URLs

/**
 * Splits a CDN URL into package, version and file. Returns null for other URLs.
 * @param {string} url
 * @returns {CdnRef|null}
 */
export function parseCdnUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const path = u.pathname;
  let m;
  if (u.hostname === "cdn.jsdelivr.net" && (m = /^\/npm\/((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(path))) return { cdn: "jsdelivr", pkg: m[1], version: m[2] || "", file: m[3] || "" };
  if (u.hostname === "cdn.jsdelivr.net" && (m = /^\/gh\/([^/@]+\/[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(path))) return { cdn: "jsdelivr", pkg: `gh:${m[1]}`, version: m[2] || "", file: m[3] || "" };
  if (u.hostname === "unpkg.com" && (m = /^\/((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(path))) return { cdn: "unpkg", pkg: m[1], version: m[2] || "", file: m[3] || "" };
  if (u.hostname === "cdnjs.cloudflare.com" && (m = /^\/ajax\/libs\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path))) return { cdn: "cdnjs", pkg: m[1], version: m[2], file: m[3] || "" };
  if (u.hostname === "esm.sh" && (m = /^\/((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(path))) return { cdn: "esm.sh", pkg: m[1], version: m[2] || "", file: m[3] || "" };
  return null;
}

/**
 * Builds a CDN URL.
 * @param {{ cdn?: 'jsdelivr'|'unpkg'|'cdnjs', pkg: string, version?: string, file?: string }} ref
 * @returns {string}
 */
export function cdnUrl({ cdn = "jsdelivr", pkg, version = "", file = "" }) {
  const f = file ? (file.startsWith("/") ? file : `/${file}`) : "";
  if (cdn === "cdnjs") return `https://cdnjs.cloudflare.com/ajax/libs/${pkg}/${version}${f}`;
  if (cdn === "unpkg") return `https://unpkg.com/${pkg}${version ? `@${version}` : ""}${f}`;
  return `https://cdn.jsdelivr.net/npm/${pkg}${version ? `@${version}` : ""}${f}`;
}

/** Is this a URL on a CDN that the desktop CSP allows? (esm.sh is not allowed.) */
export function isAllowedCdnUrl(url) {
  try {
    return ALLOWED_CDN_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Compares dotted versions ("1.10.0" > "1.9.2"; pre-releases sort before the release). */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ""] = String(v).replace(/^[v=]/, "").split(/-(.+)/);
    return { n: core.split(".").map((x) => parseInt(x, 10) || 0), pre };
  };
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < Math.max(A.n.length, B.n.length); i++) {
    const d = (A.n[i] || 0) - (B.n[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre < B.pre ? -1 : 1;
}
export const isPrerelease = (v) => /-/.test(String(v));

// ------------------------------------------------------------------------------------------------ catalog

/**
 * Libraries that work from a CDN without a build step (pinned versions that were verified in the preview).
 * `kind`: "script" (classic script, defines a global), "module" (ES module, becomes an import map entry),
 * "style" (stylesheet). `pkg`/`version`/`file` let the library manager offer other versions.
 * @type {{ id: string, name: string, description: string, kind: 'script'|'module'|'style', pkg: string, version: string, file: string,
 *   specifier?: string, global?: string, group: string, note?: string, defer?: boolean }[]}
 */
export const CATALOG = [
  { id: "tailwind", name: "Tailwind CSS (browser build)", description: "Utility classes compiled in the browser. Great for prototypes; use the Tailwind CLI for production.", kind: "script", pkg: "@tailwindcss/browser", version: "4.1.11", file: "/dist/index.global.js", group: "CSS frameworks", note: "Prints a console warning that it is not meant for production." },
  { id: "bootstrap-css", name: "Bootstrap 5 CSS", description: "Components and grid.", kind: "style", pkg: "bootstrap", version: "5.3.3", file: "/dist/css/bootstrap.min.css", group: "CSS frameworks" },
  { id: "bootstrap-js", name: "Bootstrap 5 JS bundle", description: "Dropdowns, modals, collapse (includes Popper).", kind: "script", pkg: "bootstrap", version: "5.3.3", file: "/dist/js/bootstrap.bundle.min.js", global: "bootstrap", group: "CSS frameworks", defer: true },
  { id: "bootstrap-icons", name: "Bootstrap Icons", description: "Icon font (CSS with web fonts).", kind: "style", pkg: "bootstrap-icons", version: "1.11.3", file: "/font/bootstrap-icons.min.css", group: "Icons and fonts" },
  { id: "fontawesome", name: "Font Awesome Free", description: "Icon font (CSS with web fonts).", kind: "style", pkg: "@fortawesome/fontawesome-free", version: "6.7.2", file: "/css/all.min.css", group: "Icons and fonts" },
  { id: "pico", name: "Pico CSS", description: "Minimal semantic CSS.", kind: "style", pkg: "@picocss/pico", version: "2.0.6", file: "/css/pico.min.css", group: "CSS frameworks" },
  { id: "normalize", name: "normalize.css", description: "Consistent default styles.", kind: "style", pkg: "normalize.css", version: "8.0.1", file: "/normalize.css", group: "CSS frameworks" },
  { id: "animate", name: "Animate.css", description: "Ready-made CSS animations.", kind: "style", pkg: "animate.css", version: "4.1.1", file: "/animate.min.css", group: "CSS frameworks" },
  { id: "alpine", name: "Alpine.js (CSP build)", description: "Lightweight reactivity in HTML attributes. The CSP build works under strict Content-Security-Policies.", kind: "script", pkg: "@alpinejs/csp", version: "3.14.9", file: "/dist/cdn.min.js", global: "Alpine", group: "Frameworks", defer: true, note: "Register components with Alpine.data(); inline expressions are limited." },
  { id: "htmx", name: "htmx", description: "HTML-over-the-wire interactions with hx-* attributes.", kind: "script", pkg: "htmx.org", version: "2.0.4", file: "/dist/htmx.min.js", global: "htmx", group: "Frameworks" },
  { id: "vue", name: "Vue 3 (runtime, ES module)", description: "Runtime-only build: write components with render functions or h(). Template strings need unsafe-eval and are blocked by the desktop CSP.", kind: "module", pkg: "vue", version: "3.5.13", file: "/dist/vue.runtime.esm-browser.prod.js", specifier: "vue", group: "Frameworks" },
  { id: "preact-htm", name: "Preact + htm + hooks", description: "3 KB React-like library with tagged-template JSX.", kind: "module", pkg: "htm", version: "3.1.1", file: "/preact/standalone.module.js", specifier: "preact-htm", group: "Frameworks" },
  { id: "react", name: "React 18 (ES module)", description: "Use with htm for JSX-free templates.", kind: "module", pkg: "react", version: "18.3.1", file: "/+esm", specifier: "react", group: "Frameworks" },
  { id: "react-dom", name: "ReactDOM 18 client", description: "createRoot for React 18.", kind: "module", pkg: "react-dom", version: "18.3.1", file: "/client/+esm", specifier: "react-dom/client", group: "Frameworks" },
  { id: "htm", name: "htm", description: "JSX-like tagged templates for React or Preact (bind it to createElement).", kind: "module", pkg: "htm", version: "3.1.1", file: "/+esm", specifier: "htm", group: "Frameworks" },
  { id: "lit", name: "Lit", description: "Fast web components with reactive properties.", kind: "module", pkg: "lit", version: "3.2.1", file: "/+esm", specifier: "lit", group: "Frameworks" },
  { id: "three", name: "Three.js", description: "3D graphics with WebGL.", kind: "module", pkg: "three", version: "0.170.0", file: "/build/three.module.js", specifier: "three", group: "Graphics" },
  { id: "chartjs", name: "Chart.js", description: "Simple, flexible charts on canvas.", kind: "script", pkg: "chart.js", version: "4.4.7", file: "/dist/chart.umd.js", global: "Chart", group: "Graphics" },
  { id: "d3", name: "D3", description: "Data-driven documents.", kind: "module", pkg: "d3", version: "7.9.0", file: "/+esm", specifier: "d3", group: "Graphics" },
  { id: "gsap", name: "GSAP", description: "Professional-grade animation.", kind: "script", pkg: "gsap", version: "3.12.7", file: "/dist/gsap.min.js", global: "gsap", group: "Graphics" },
  { id: "marked", name: "marked", description: "Markdown parser for the browser.", kind: "module", pkg: "marked", version: "15.0.4", file: "/+esm", specifier: "marked", group: "Utilities" },
  { id: "dayjs", name: "Day.js", description: "Small date library.", kind: "module", pkg: "dayjs", version: "1.11.13", file: "/+esm", specifier: "dayjs", group: "Utilities" },
  { id: "lodash", name: "lodash-es", description: "Utility functions as ES modules.", kind: "module", pkg: "lodash-es", version: "4.17.21", file: "/+esm", specifier: "lodash-es", group: "Utilities" },
  { id: "katex", name: "KaTeX (script + CSS)", description: "Fast math typesetting.", kind: "script", pkg: "katex", version: "0.16.11", file: "/dist/katex.min.js", global: "katex", group: "Utilities", defer: true },
  { id: "hljs", name: "highlight.js (core)", description: "Syntax highlighting.", kind: "module", pkg: "@highlightjs/cdn-assets", version: "11.10.0", file: "/es/highlight.min.js", specifier: "highlight.js", group: "Utilities" },
];

/** Catalog entry → URL on the given CDN. */
export function catalogUrl(entry, cdn = "jsdelivr") {
  return cdnUrl({ cdn, pkg: entry.pkg, version: entry.version, file: entry.file });
}

// ------------------------------------------------------------------------------------------------ import maps

const isImportMap = (el) => el.tag === "script" && (getAttr(el, "type") || "").trim().toLowerCase() === "importmap";

/**
 * The import map of a page: { el, map: { imports, scopes }, valid } or null when there is none (the first one counts).
 * @param {import('./html.js').ParsedHtml} parsed
 */
export function readImportMap(parsed) {
  const el = parsed.elements.find(isImportMap);
  if (!el) return null;
  const text = el.children[0]?.type === "text" ? el.children[0].text : "";
  try {
    const map = JSON.parse(text.trim() || "{}");
    if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("not an object");
    return { el, map: { imports: map.imports && typeof map.imports === "object" ? map.imports : {}, scopes: map.scopes || undefined, ...Object.fromEntries(Object.entries(map).filter(([k]) => k !== "imports" && k !== "scopes")) }, valid: true };
  } catch {
    return { el, map: { imports: {} }, valid: false };
  }
}

/** Resolves a module specifier with an import map (see preview.js). */
export const resolveWithImportMap = resolveImportMap;

const formatMap = (map) => `${JSON.stringify(map, null, 2)}`;

function importMapInsertIndex(parsed, headEl) {
  // before the first script (an import map must precede module scripts) but after metas, titles and links
  if (!headEl) return Number.MAX_SAFE_INTEGER;
  const kids = headEl.children.filter((c) => c.type === "element");
  const i = kids.findIndex((k) => k.tag === "script" || (k.tag === "link" && /modulepreload/i.test(getAttr(k, "rel") || "")));
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Sets (or with url = null removes) one import map entry; creates the `<script type="importmap">` when needed and
 * removes it again when it becomes empty. Throws when the existing import map is not valid JSON.
 * @param {import('./html.js').ParsedHtml} parsed
 * @param {string} specifier
 * @param {string|null} url
 * @returns {import('./edit.js').Change[]}
 */
export function setImportMapEntry(parsed, specifier, url) {
  const cur = readImportMap(parsed);
  if (cur && !cur.valid) throw new Error("The import map in this page is not valid JSON. Fix it first.");
  if (!cur) {
    if (url === null) return [];
    const head = findByTag(parsed, "head");
    const html = `<script type="importmap">\n${formatMap({ imports: { [specifier]: url } })}\n</script>`;
    return insertHtml(parsed, head ? head.id : null, importMapInsertIndex(parsed, head), html).changes;
  }
  const map = { ...cur.map, imports: { ...cur.map.imports } };
  if (url === null) delete map.imports[specifier];
  else map.imports[specifier] = url;
  if (map.imports[specifier] === cur.map.imports[specifier] && (url !== null || !(specifier in cur.map.imports))) return [];
  if (!Object.keys(map.imports).length && !map.scopes) return deleteElement(parsed, cur.el.id);
  return setText(parsed, cur.el.id, `\n${formatMap(map)}\n`);
}

// ------------------------------------------------------------------------------------------------ tags

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Adds a library to a page: stylesheets go to the end of `<head>`, classic scripts to the end of `<head>` with `defer`
 * (or before `</body>`), modules become an import map entry plus nothing else (import it from your own script).
 * @param {import('./html.js').ParsedHtml} parsed
 * @param {{ kind: 'script'|'style'|'module', url: string, specifier?: string, defer?: boolean, position?: 'head'|'body' }} lib
 * @returns {import('./edit.js').Change[]}
 */
export function addLibraryToPage(parsed, lib) {
  if (lib.kind === "module") {
    if (!lib.specifier) throw new Error("A module needs an import specifier (for example \"vue\").");
    return setImportMapEntry(parsed, lib.specifier, lib.url);
  }
  const exists = parsed.elements.some((e) => (e.tag === "script" && getAttr(e, "src") === lib.url) || (e.tag === "link" && getAttr(e, "href") === lib.url));
  if (exists) return [];
  const head = findByTag(parsed, "head");
  const body = findByTag(parsed, "body");
  if (lib.kind === "style") {
    return insertHtml(parsed, head ? head.id : null, Number.MAX_SAFE_INTEGER, `<link rel="stylesheet" href="${escAttr(lib.url)}">`).changes;
  }
  const html = `<script src="${escAttr(lib.url)}"${lib.defer !== false ? " defer" : ""}></script>`;
  if (lib.position === "body" && body) return insertHtml(parsed, body.id, Number.MAX_SAFE_INTEGER, `<script src="${escAttr(lib.url)}"></script>`).changes;
  return insertHtml(parsed, head ? head.id : null, Number.MAX_SAFE_INTEGER, html).changes;
}

/** Name and version of a library from a URL or a vendored path (`vendor/vue@3.5.13/...`). */
function describeSource(url) {
  const c = parseCdnUrl(url);
  if (c) return { name: c.pkg, version: c.version, cdn: c.cdn };
  const m = /(?:^|\/)vendor\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\//.exec(url);
  if (m) return { name: m[1], version: m[2], cdn: "local" };
  const v = /(?:^|\/)vendor\/([^/]+)\//.exec(url);
  if (v) return { name: v[1], version: "", cdn: "local" };
  return { name: url.split("/").pop() || url, version: "", cdn: "other" };
}

/**
 * Libraries a page uses: script and stylesheet tags, import map entries (local files, vendored copies and CDN).
 * @param {import('./html.js').ParsedHtml} parsed
 * @param {string} file path of the HTML file
 * @returns {Library[]}
 */
export function listPageLibraries(parsed, file) {
  const out = [];
  for (const el of parsed.elements) {
    if (el.tag === "script" && getAttr(el, "src") && !isImportMap(el)) {
      const src = decodeEntities(getAttr(el, "src"));
      const external = /^(https?:)?\/\//i.test(src);
      if (!external && !/(^|\/)vendor\//.test(src)) continue;
      const d = describeSource(src);
      const module = (getAttr(el, "type") || "").toLowerCase() === "module";
      out.push({ id: `${file}#${el.id}`, name: d.name, version: d.version, url: src, cdn: d.cdn, kind: module ? "module" : "script", file, local: !external, elementId: el.id, vendored: !external });
    } else if (el.tag === "link" && /stylesheet/i.test(getAttr(el, "rel") || "") && getAttr(el, "href")) {
      const href = decodeEntities(getAttr(el, "href"));
      const external = /^(https?:)?\/\//i.test(href);
      if (!external && !/(^|\/)vendor\//.test(href)) continue;
      const d = describeSource(href);
      out.push({ id: `${file}#${el.id}`, name: d.name, version: d.version, url: href, cdn: d.cdn, kind: "style", file, local: !external, elementId: el.id, vendored: !external });
    }
  }
  const im = readImportMap(parsed);
  if (im?.valid) {
    for (const [spec, url] of Object.entries(im.map.imports)) {
      if (typeof url !== "string") continue;
      const external = /^(https?:)?\/\//i.test(url);
      const d = describeSource(url);
      out.push({ id: `${file}#map:${spec}`, name: d.name === url.split("/").pop() ? spec : d.name, version: d.version, url, cdn: d.cdn, kind: "importmap", file, local: !external, specifier: spec, vendored: !external && /(^|\/)vendor\//.test(url) });
    }
  }
  return out;
}

/**
 * Removes a library found by `listPageLibraries` from its page.
 * @param {import('./html.js').ParsedHtml} parsed
 * @param {Library} lib
 */
export function removeLibraryFromPage(parsed, lib) {
  if (lib.kind === "importmap") return setImportMapEntry(parsed, lib.specifier, null);
  if (lib.elementId == null) return [];
  return deleteElement(parsed, lib.elementId);
}

/**
 * Points a library at a new URL (a different version, or the vendored copy).
 * @param {import('./html.js').ParsedHtml} parsed
 * @param {Library} lib
 * @param {string} url
 */
export function retargetLibrary(parsed, lib, url) {
  if (lib.kind === "importmap") return setImportMapEntry(parsed, lib.specifier, url);
  if (lib.elementId == null) return [];
  const el = parsed.elements[lib.elementId];
  return setAttribute(parsed, el.id, el.tag === "link" ? "href" : "src", url);
}

/**
 * CDN URLs that JavaScript files import directly (`import x from "https://cdn.jsdelivr.net/..."`).
 * @param {string} code
 * @param {string} file
 * @returns {(Library & { start: number, end: number })[]}
 */
export function listCodeImports(code, file) {
  const out = [];
  for (const s of scanModuleSpecifiers(code)) {
    if (!/^https?:\/\//i.test(s.specifier)) continue;
    const d = describeSource(s.specifier);
    out.push({ id: `${file}@${s.start}`, name: d.name, version: d.version, url: s.specifier, cdn: d.cdn, kind: "import", file, local: false, vendored: false, start: s.start, end: s.end });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ package APIs

/** npm registry search (has CORS headers; used for finding packages by keyword). */
export const npmSearchUrl = (q, size = 15) => `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=${size}`;
export const jsdelivrPackageUrl = (name) => `https://data.jsdelivr.com/v1/package/npm/${name}`;
export const jsdelivrFilesUrl = (name, version) => `https://data.jsdelivr.com/v1/package/npm/${name}@${version}/flat`;
export const cdnjsSearchUrl = (q, limit = 15) => `https://api.cdnjs.com/libraries?search=${encodeURIComponent(q)}&fields=name,version,description,filename,homepage&limit=${limit}`;
export const cdnjsLibraryUrl = (name) => `https://api.cdnjs.com/libraries/${encodeURIComponent(name)}?fields=name,version,versions,description,filename`;

/** @returns {{ name: string, version: string, description: string, keywords: string[] }[]} */
export function parseNpmSearch(json) {
  const list = Array.isArray(json?.objects) ? json.objects : [];
  return list
    .map((o) => o?.package)
    .filter((p) => p && typeof p.name === "string")
    .map((p) => ({ name: p.name, version: String(p.version || ""), description: String(p.description || ""), keywords: Array.isArray(p.keywords) ? p.keywords.map(String).slice(0, 6) : [] }));
}

/**
 * jsDelivr package info: both response shapes (`versions: ["1.0.0"]` and `versions: [{ version }]`) are handled.
 * @returns {{ name: string, latest: string, versions: string[] }|null}
 */
export function parseJsdelivrPackage(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.versions)) return null;
  const versions = json.versions.map((v) => (typeof v === "string" ? v : v?.version)).filter((v) => typeof v === "string");
  versions.sort((a, b) => compareVersions(b, a));
  const latest = json.tags?.latest || versions.find((v) => !isPrerelease(v)) || versions[0] || "";
  return { name: String(json.name || ""), latest, versions };
}

/** jsDelivr `/flat` listing → files and ranked suggestions for scripts, modules and stylesheets. */
export function parseJsdelivrFiles(json) {
  const files = (Array.isArray(json?.files) ? json.files : []).filter((f) => f && typeof f.name === "string").map((f) => ({ path: f.name, size: Number(f.size) || 0 }));
  const scored = (re, bonus = []) =>
    files
      .filter((f) => re.test(f.path) && !/\.map$|\.d\.ts$|\/(?:test|tests|src|docs?|examples?)\//i.test(f.path))
      .map((f) => ({ ...f, score: (/\.min\./.test(f.path) ? 3 : 0) + (/\/dist\//.test(f.path) ? 2 : 0) + bonus.reduce((s, [r, v]) => s + (r.test(f.path) ? v : 0), 0) - f.path.split("/").length * 0.1 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  return {
    default: typeof json?.default === "string" ? json.default : "",
    files,
    scripts: scored(/\.(?:js|cjs)$/i, [[/\.(umd|global|iife)\./, 2], [/\.esm|\.mjs/, -2]]),
    modules: scored(/\.(?:mjs|js)$/i, [[/\.esm|\.mjs|module/, 6], [/\.(umd|cjs|global)\./, -3]]),
    styles: scored(/\.css$/i),
  };
}

/** @returns {{ name: string, version: string, description: string, filename: string }[]} */
export function parseCdnjsSearch(json) {
  const list = Array.isArray(json?.results) ? json.results : [];
  return list.filter((r) => r && typeof r.name === "string").map((r) => ({ name: r.name, version: String(r.version || ""), description: String(r.description || ""), filename: String(r.filename || "") }));
}

/** @returns {{ name: string, latest: string, versions: string[], filename: string }|null} */
export function parseCdnjsLibrary(json) {
  if (!json || typeof json !== "object" || typeof json.name !== "string") return null;
  const versions = (Array.isArray(json.versions) ? json.versions : []).map(String).sort((a, b) => compareVersions(b, a));
  return { name: json.name, latest: String(json.version || versions[0] || ""), versions, filename: String(json.filename || "") };
}

// ------------------------------------------------------------------------------------------------ vendoring

/**
 * Project path for a downloaded file: `vendor/<package>@<version>/<file>`. jsDelivr's `/+esm` bundles become
 * `<name>.esm.js`. Anything else goes to `vendor/_ext/<host>/<path>`.
 * @param {string} url
 * @returns {string}
 */
export function vendorPathFor(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "vendor/_ext/unknown.js";
  }
  const c = parseCdnUrl(url);
  let rel;
  if (c && c.pkg && c.cdn !== "other") {
    let file = decodeURIComponent(c.file || "");
    if (!file || file === "/") file = "/index.js";
    if (/\/\+esm$/.test(file)) file = file.replace(/\/\+esm$/, "") || "";
    if (/\/\+esm$/.test(c.file || "") || c.file === "/+esm") file = `${file}/${c.pkg.split("/").pop()}.esm.js`.replace(/\/\//g, "/");
    rel = `vendor/${c.pkg.replace(/^gh:/, "gh/")}${c.version ? `@${c.version}` : ""}${file}`;
  } else rel = `vendor/_ext/${u.hostname}${decodeURIComponent(u.pathname)}`;
  rel = normalizePath(rel.replace(/\?.*$/, ""));
  if (/\/$/.test(rel) || !/\.[A-Za-z0-9]+$/.test(rel.split("/").pop())) rel += ".js";
  return rel;
}

const textOf = (bytes) => new TextDecoder("utf-8").decode(bytes);
const bytesOf = (text) => new TextEncoder().encode(text);

function dotRelative(from, to) {
  const r = relativeRef(from, to);
  return r.startsWith(".") ? r : `./${r}`;
}

function resolveAgainst(baseUrl, spec) {
  try {
    return new URL(spec, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Downloads a script, module or stylesheet together with what it needs (imported modules, fonts and images that a
 * stylesheet references, `@import`ed sheets) and returns the files to store in the project, with references rewritten
 * to relative paths. Bare module specifiers are left alone (map them in an import map).
 * `fetchBytes(url)` is injected (it must reject on failure); `limits` bound the work.
 * @param {string} entryUrl
 * @param {(url: string) => Promise<Uint8Array>} fetchBytes
 * @param {{ maxFiles?: number, maxBytes?: number, allowHost?: (url: string) => boolean }} [limits]
 * @returns {Promise<{ entry: string, files: Record<string, Uint8Array>, warnings: string[] }>}
 */
export async function vendorFromUrl(entryUrl, fetchBytes, limits = {}) {
  const maxFiles = limits.maxFiles ?? 80;
  const maxBytes = limits.maxBytes ?? 12 * 1024 * 1024;
  const allow = limits.allowHost || ((u) => /^https:/i.test(u));
  /** @type {Map<string, string>} url -> project path */
  const paths = new Map();
  const files = {};
  const warnings = [];
  let total = 0;
  const used = new Set();
  const pathFor = (url) => {
    if (paths.has(url)) return paths.get(url);
    let p = vendorPathFor(url);
    while (used.has(p.toLowerCase())) p = p.replace(/(\.[A-Za-z0-9]+)?$/, (m) => `-${used.size}${m}`);
    used.add(p.toLowerCase());
    paths.set(url, p);
    return p;
  };
  const queue = [];
  const done = new Set();
  const enqueue = (url, kind) => {
    const p = pathFor(url);
    if (!done.has(url)) {
      done.add(url);
      queue.push({ url, kind, path: p });
    }
    return p;
  };
  const entry = enqueue(entryUrl, /\.css(\?|$)/i.test(entryUrl) ? "css" : "js");
  while (queue.length) {
    const item = queue.shift();
    if (Object.keys(files).length >= maxFiles) {
      warnings.push(`Stopped after ${maxFiles} files; some dependencies were not downloaded.`);
      break;
    }
    if (!allow(item.url)) {
      warnings.push(`Skipped ${item.url} (host not allowed).`);
      continue;
    }
    let bytes;
    try {
      bytes = await fetchBytes(item.url);
    } catch (err) {
      if (item.url === entryUrl) throw err;
      warnings.push(`Could not download ${item.url}: ${err?.message || err}`);
      continue;
    }
    total += bytes.length;
    if (total > maxBytes) throw new Error(`The download is larger than ${Math.round(maxBytes / 1048576)} MB; stopped.`);
    if (item.kind === "css") {
      let css = textOf(bytes);
      const edits = [];
      const parsed = parseCss(css);
      const imports = new Set();
      for (const r of parsed.rules) {
        if (r.type === "at" && r.name === "import" && !r.block) {
          const imp = parseImport(r.prelude);
          if (imp) imports.add(imp.url);
        }
      }
      for (const u of cssUrls(css)) {
        if (/^(data:|#|about:)/i.test(u.url)) continue;
        const abs = resolveAgainst(item.url, u.url);
        if (!abs) continue;
        const clean = abs.replace(/[?#].*$/, "");
        const isImport = imports.has(u.url);
        const p = enqueue(clean, isImport || /\.css$/i.test(clean) ? "css" : "bin");
        const suffix = abs.slice(clean.length);
        edits.push({ from: u.urlStart, to: u.urlEnd, insert: dotRelative(item.path, p) + suffix });
      }
      // @import "x.css" (string form): cssUrls only sees url(...)
      css = applyEdits(css, edits);
      css = css.replace(/@import\s+(["'])([^"']+)\1/g, (m, q, u) => {
        const abs = resolveAgainst(item.url, u);
        if (!abs) return m;
        return `@import ${q}${dotRelative(item.path, enqueue(abs.replace(/[?#].*$/, ""), "css"))}${q}`;
      });
      css = css.replace(/\/\*# sourceMappingURL=[^*]*\*\//g, "");
      files[item.path] = bytesOf(css);
    } else if (item.kind === "js") {
      let code = textOf(bytes);
      const edits = [];
      for (const s of scanModuleSpecifiers(code)) {
        if (!/^(https?:\/\/|\/|\.\.?\/)/.test(s.specifier)) continue;
        const abs = resolveAgainst(item.url, s.specifier);
        if (!abs || !allow(abs)) continue;
        const p = enqueue(abs.replace(/[?#].*$/, ""), "js");
        edits.push({ from: s.start, to: s.end, insert: dotRelative(item.path, p) });
      }
      code = applyEdits(code, edits).replace(/^\s*\/\/# sourceMappingURL=.*$/gm, "");
      files[item.path] = bytesOf(code);
    } else files[item.path] = bytes;
  }
  return { entry, files, warnings };
}

function applyEdits(text, edits) {
  if (!edits.length) return text;
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let out = "";
  let last = 0;
  for (const e of sorted) {
    if (e.from < last) continue;
    out += text.slice(last, e.from) + e.insert;
    last = e.to;
  }
  return out + text.slice(last);
}

/**
 * Where a library's entry should point after vendoring, relative to the HTML file that uses it.
 * @param {string} htmlFile
 * @param {string} vendoredPath
 */
export function vendoredRef(htmlFile, vendoredPath) {
  return dotRelative(htmlFile, vendoredPath);
}

// ------------------------------------------------------------------------------------------------ import maps for previews

/**
 * Rewrites bare specifiers of a module according to an import map, so the preview works without the browser applying
 * the map (inline import maps are blocked by the desktop Content-Security-Policy). `resolveTarget(url)` maps a map
 * target to the final replacement text (a project file's data URL, or the URL itself). Returns the changes.
 * @param {string} code
 * @param {Record<string,string>} imports
 * @param {(target: string) => string|null} resolveTarget
 * @returns {{ from: number, to: number, insert: string }[]}
 */
export function importMapChanges(code, imports, resolveTarget) {
  const out = [];
  for (const s of scanModuleSpecifiers(code)) {
    if (/^(\.\.?\/|\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(s.specifier)) continue;
    const target = resolveWithImportMap(imports, s.specifier);
    if (target == null) continue;
    const r = resolveTarget(target);
    if (r != null) out.push({ from: s.start, to: s.end, insert: r });
  }
  return out;
}

/** Project-relative path of an import map target as seen from `htmlFile` (null for absolute URLs). */
export function importMapTargetPath(htmlFile, target) {
  if (/^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(target)) return null;
  const ref = resolveRef(htmlFile, target);
  return ref ? ref.path : null;
}
