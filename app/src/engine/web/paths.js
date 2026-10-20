// Project path helpers, MIME types and language detection for the Code studio.
// Pure string code: runs in browsers, workers and Node.js. See docs/web-engine.md.

/**
 * Normalizes a project path: converts backslashes, strips the leading slash, resolves '.' and '..'.
 * The result never escapes the project root ('../x' becomes 'x').
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  const parts = String(p ?? "").replace(/\\/g, "/").split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/**
 * Folder part of a path ('' for top-level files).
 * @param {string} p
 * @returns {string}
 */
export function dirname(p) {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i < 0 ? "" : n.slice(0, i);
}

/**
 * Last segment of a path, optionally without the given extension.
 * @param {string} p
 * @param {string} [ext] e.g. '.css'
 * @returns {string}
 */
export function basename(p, ext) {
  const n = normalizePath(p);
  const b = n.slice(n.lastIndexOf("/") + 1);
  if (ext && b.length > ext.length && b.toLowerCase().endsWith(ext.toLowerCase())) return b.slice(0, b.length - ext.length);
  return b;
}

/**
 * Extension including the dot, as written ('' when there is none; dotfiles have no extension).
 * @param {string} p
 * @returns {string}
 */
export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}

/**
 * Joins path segments and normalizes the result.
 * @param {...string} parts
 * @returns {string}
 */
export function joinPath(...parts) {
  return normalizePath(parts.filter((x) => x !== "" && x != null).join("/"));
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * True for references that leave the project (http:, //host, data:, blob:, mailto:, ...).
 * @param {string} ref
 * @returns {boolean}
 */
export function isExternalRef(ref) {
  const r = String(ref ?? "").trim();
  return SCHEME.test(r) || r.startsWith("//");
}

/**
 * Resolves a reference found in `fromFile` (href, src, url(), import ...) to a project path.
 * Returns null for absolute URLs, `//host`, empty references and pure '#hash' references.
 * Percent escapes in the path are decoded; '/x' is relative to the project root.
 * @param {string} fromFile
 * @param {string} ref
 * @returns {{ path: string, query: string, hash: string } | null}
 */
export function resolveRef(fromFile, ref) {
  let r = String(ref ?? "").trim();
  if (r === "" || r.startsWith("#") || isExternalRef(r)) return null;
  let hash = "";
  let query = "";
  const h = r.indexOf("#");
  if (h >= 0) {
    hash = r.slice(h);
    r = r.slice(0, h);
  }
  const q = r.indexOf("?");
  if (q >= 0) {
    query = r.slice(q);
    r = r.slice(0, q);
  }
  try {
    r = decodeURIComponent(r);
  } catch {
    /* keep the raw text */
  }
  if (r === "") return { path: normalizePath(fromFile), query, hash };
  const path = r.startsWith("/") || r.startsWith("\\") ? normalizePath(r) : joinPath(dirname(fromFile), r);
  return { path, query, hash };
}

/**
 * Reference text that points from the folder of `fromFile` to `toPath`.
 * @param {string} fromFile
 * @param {string} toPath
 * @returns {string}
 */
export function relativeRef(fromFile, toPath) {
  const from = dirname(fromFile).split("/").filter(Boolean);
  const to = normalizePath(toPath).split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  return "../".repeat(up) + to.slice(i).join("/");
}

const MIME = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  json: "application/json", map: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", bmp: "image/bmp", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject", txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
  xml: "application/xml", webmanifest: "application/manifest+json", csv: "text/csv", mp4: "video/mp4", webm: "video/webm",
  ogv: "video/ogg", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  pdf: "application/pdf", zip: "application/zip", wasm: "application/wasm", ts: "text/typescript", tsx: "text/typescript",
  jsx: "text/javascript", vtt: "text/vtt", tex: "application/x-tex", latex: "application/x-tex", bib: "application/x-bibtex", mdx: "text/markdown", yaml: "application/yaml", yml: "application/yaml", toml: "application/toml", tsv: "text/tab-separated-values", rss: "application/rss+xml", atom: "application/atom+xml",
};

const TEXT_EXT = new Set([
  "html", "htm", "css", "js", "mjs", "cjs", "jsx", "ts", "tsx", "json", "map", "svg", "txt", "md", "markdown", "xml", "webmanifest",
  "csv", "vtt", "rss", "atom", "yml", "yaml", "toml", "ini", "conf", "log",
  "tex", "latex", "sty", "cls", "bib", "mdx", "tmpl", "tsv", "jsonc", "vue", "svelte", "properties", "env",
]);

const extOf = (path) => extname(path).slice(1).toLowerCase();

/**
 * MIME type for a path (by extension, lower-cased). Falls back to application/octet-stream.
 * @param {string} path
 * @returns {string}
 */
export function mimeOf(path) {
  return MIME[extOf(path)] || "application/octet-stream";
}

/**
 * True for text-like extensions that the code editor can open.
 * @param {string} path
 * @returns {boolean}
 */
export function isTextPath(path) {
  const b = basename(path).toLowerCase();
  if (b === ".gitignore" || b === ".htaccess" || b === "license" || b === "readme") return true;
  return TEXT_EXT.has(extOf(path));
}

/**
 * Editor language id for a path.
 * @param {string} path
 * @returns {'html'|'css'|'javascript'|'json'|'markdown'|'xml'|'latex'|'yaml'|'toml'|'properties'|'text'}
 */
export function languageOf(path) {
  switch (extOf(path)) {
    case "html": case "htm": case "tmpl": return "html";
    case "css": return "css";
    case "js": case "mjs": case "cjs": case "jsx": case "ts": case "tsx": return "javascript";
    case "json": case "map": case "webmanifest": return "json";
    case "md": case "markdown": case "mdx": return "markdown";
    case "tex": case "latex": case "sty": case "cls": case "bib": return "latex";
    case "yml": case "yaml": return "yaml";
    case "toml": return "toml";
    case "ini": case "conf": case "properties": return "properties";
    case "xml": case "svg": case "rss": case "atom": return "xml";
    default: return "text";
  }
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Removes characters that are invalid on Windows, macOS or Linux and trims dots and spaces.
 * Returns '' when nothing usable is left.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFileName(name) {
  // eslint-disable-next-line no-control-regex
  let n = String(name ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/^[\s.]+|[\s.]+$/g, "");
  if (n.length > 200) n = n.slice(0, 200).replace(/[\s.]+$/g, "");
  if (n && RESERVED.test(n)) n = "_" + n;
  return n;
}

/**
 * Returns `path`, or 'name-2.ext', 'name-3.ext', ... when a file with that path (compared
 * case-insensitively, like Windows and macOS do) already exists.
 * @param {string} path
 * @param {Iterable<string>} existing
 * @returns {string}
 */
export function uniquePath(path, existing) {
  const taken = new Set();
  for (const e of existing) taken.add(normalizePath(e).toLowerCase());
  const p = normalizePath(path);
  if (!taken.has(p.toLowerCase())) return p;
  const dir = dirname(p);
  const ext = extname(p);
  const stem = basename(p).slice(0, basename(p).length - ext.length);
  for (let i = 2; ; i++) {
    const cand = (dir ? dir + "/" : "") + `${stem}-${i}${ext}`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
}
