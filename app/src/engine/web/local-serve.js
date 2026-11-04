// Pure helpers of the Code studio's local preview server ("Open in browser", previews of folders and files opened from
// disk): request path resolution with traversal protection, MIME types, SPA fallback, asset reference rewriting for
// blob-URL pages (web build), the live-reload snippet, disk-change detection and standalone file previews.
// No DOM, no fetch: the desktop server (src-tauri/src/preview_server.rs) mirrors resolveRequest() and MIME_TYPES.
import { normalizePath, extname, resolveRef, isExternalRef } from "./paths.js";

/** Extension → Content-Type. Text types carry charset=utf-8. Keep in sync with preview_server.rs. */
export const MIME_TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8", webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", markdown: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8", tsv: "text/tab-separated-values; charset=utf-8", xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", bmp: "image/bmp", pdf: "application/pdf", wasm: "application/wasm",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", tex: "text/plain; charset=utf-8", bib: "text/plain; charset=utf-8",
};

/** Content-Type for a path; unknown extensions are served as application/octet-stream. */
export function mimeFor(path) {
  return MIME_TYPES[extname(path).slice(1).toLowerCase()] || "application/octet-stream";
}

/**
 * Turns the path part of a request URL into a project-relative path, or null when it is unsafe: `..` segments (also
 * percent-encoded), backslashes, NUL and other control characters, drive letters and absolute Windows paths.
 * A trailing slash or an empty path means the folder's index.html.
 */
export function safeRequestPath(urlPath) {
  let raw = String(urlPath ?? "").split(/[?#]/)[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(raw) || /^\/*[A-Za-z]:/.test(raw)) return null;
  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) return null;
  let path = parts.join("/");
  if (!path || raw.endsWith("/")) path = path ? `${path}/index.html` : "index.html";
  return path;
}

/**
 * Resolves a request against the files the server can see. `has(path)` tells whether a file exists.
 * Order: the file itself, `<path>/index.html`, `<path>.html`, then (with `spa`) the entry page for
 * extension-less paths. Returns { path, status } (status 200, 403 for unsafe paths, 404).
 */
export function resolveRequest(urlPath, { has, spa = false, entry = "index.html" } = {}) {
  const path = safeRequestPath(urlPath);
  if (path == null) return { path: null, status: 403 };
  if (has(path)) return { path, status: 200 };
  const bare = path.replace(/\/index\.html$/, "");
  for (const c of [`${bare}/index.html`, `${bare}.html`]) if (bare && has(c)) return { path: c, status: 200 };
  if (spa && !extname(bare) && has(entry)) return { path: entry, status: 200 };
  return { path: null, status: 404 };
}

/** The live-reload script injected into HTML pages served by the local server: polls `revUrl`, reloads on change. */
export function liveReloadSnippet(revUrl, intervalMs = 1000) {
  return `<script>(()=>{let r=null;const t=async()=>{try{const n=await (await fetch(${JSON.stringify(revUrl)},{cache:"no-store"})).text();if(r!==null&&n!==r)location.reload();r=n}catch{}setTimeout(t,${intervalMs})};t()})();</script>`;
}

/** Inserts `snippet` before </body> (or at the end when there is none). */
export function injectBeforeBodyEnd(html, snippet) {
  const i = html.search(/<\/body\s*>/i);
  return i < 0 ? html + snippet : html.slice(0, i) + snippet + html.slice(i);
}

/**
 * Rewrites the relative asset references of an HTML or CSS file (src, href, poster, srcset entries, CSS url() and
 * @import) with `urlFor(projectPath)`; references that `urlFor` does not know (null) and external ones stay as they are.
 */
export function rewriteRefs(text, file, urlFor, kind = /\.css$/i.test(file) ? "css" : "html") {
  const map = (ref) => {
    const r = String(ref).trim();
    if (!r || isExternalRef(r) || /^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(r)) return ref;
    const res = resolveRef(file, r);
    if (!res) return ref;
    const url = urlFor(res.path);
    return url ? url + (res.hash || "") : ref;
  };
  const css = (s) =>
    s
      .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, u) => `url(${q}${map(u)}${q})`)
      .replace(/@import\s+(["'])([^"']+)\1/gi, (m, q, u) => `@import ${q}${map(u)}${q}`);
  if (kind === "css") return css(text);
  // attribute values: "…" or '…' (the other quote may appear inside)
  const attr = (names, fn) => (s) => s.replace(new RegExp(`(\\s(?:${names})\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`, "gi"), (m, pre, d, sq) => (d != null ? `${pre}"${fn(d)}"` : `${pre}'${fn(sq)}'`));
  const srcset = (v) => v.split(",").map((part) => part.replace(/^(\s*)(\S+)/, (x, sp, u) => sp + map(u))).join(",");
  let out = attr("src|href|poster|data", map)(text);
  out = attr("srcset", srcset)(out);
  out = attr("style", css)(out);
  return out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, body, b) => a + css(body) + b);
}

/**
 * A script for blob-URL pages: maps fetch()/XMLHttpRequest of relative project paths (local JSON, text, …) to the
 * blob URLs in `table` ({ projectPath: url }), resolved against `file`.
 */
export function fetchShim(table, file) {
  return `<script>(()=>{const T=${JSON.stringify(table).replace(/</g, "\\u003c")},B=${JSON.stringify(file)};const R=(u)=>{try{if(typeof u!=="string"||/^[a-z][a-z0-9+.-]*:|^\\/\\//i.test(u))return u;const b=new URL(B,"http://x/");const p=decodeURIComponent(new URL(u,b).pathname.slice(1));return T[p]||u}catch{return u}};const F=window.fetch;window.fetch=(u,o)=>F(R(u),o);const O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...a){return O.call(this,m,R(u),...a)}})();</script>`;
}

/**
 * Compares two disk snapshots ({ path: stamp }) and returns { changed, added, removed } path lists.
 * A stamp is anything comparable with === (for example `${mtime}:${size}`).
 */
export function diffStamps(prev, next) {
  const changed = [];
  const added = [];
  const removed = [];
  for (const [p, s] of Object.entries(next)) {
    if (!(p in prev)) added.push(p);
    else if (prev[p] !== s) changed.push(p);
  }
  for (const p of Object.keys(prev)) if (!(p in next)) removed.push(p);
  return { changed, added, removed };
}

/** How a single file is previewed on its own: html | markdown | svg | image | pdf | json | csv | text | null. */
export function standaloneKind(path) {
  const e = extname(path).slice(1).toLowerCase();
  if (e === "html" || e === "htm") return "html";
  if (e === "md" || e === "markdown" || e === "mdx") return "markdown";
  if (e === "svg") return "svg";
  if (/^(png|jpe?g|gif|webp|avif|bmp|ico)$/.test(e)) return "image";
  if (e === "pdf") return "pdf";
  if (e === "json" || e === "webmanifest" || e === "map") return "json";
  if (e === "csv" || e === "tsv") return "csv";
  if (/^(txt|log|xml|css|js|mjs|tex|bib|ya?ml|toml|ini)$/.test(e)) return "text";
  return null;
}

/** Parses CSV/TSV (quotes, doubled quotes, CRLF) into rows; at most `maxRows`. */
export function parseCsv(text, sep = ",", maxRows = 5000) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length && rows.length < maxRows; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if ((cell !== "" || row.length) && rows.length < maxRows) row.push(cell), rows.push(row);
  return rows;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An HTML table for CSV text (first row as header). */
export function csvToHtml(text, path = "") {
  const rows = parseCsv(text, /\.tsv$/i.test(path) ? "\t" : ",");
  if (!rows.length) return "<p>(empty)</p>";
  const [head, ...body] = rows;
  return `<table class="of-csv"><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** Pretty-printed JSON as escaped HTML, or the parse error. */
export function jsonToHtml(text) {
  try {
    return `<pre class="of-json">${esc(JSON.stringify(JSON.parse(text), null, 2))}</pre>`;
  } catch (err) {
    return `<p class="of-json-error">${esc(err.message)}</p><pre>${esc(text)}</pre>`;
  }
}

/** Validates a port setting: 0 (any free port) or 1024–65535. */
export function validPort(port) {
  const n = Number(port);
  return Number.isInteger(n) && (n === 0 || (n >= 1024 && n <= 65535)) ? n : 0;
}

/** Normalized project paths of a list (drops unsafe ones). */
export function safePaths(paths) {
  return paths.map((p) => safeRequestPath(p)).filter((p) => p && p === normalizePath(p));
}
