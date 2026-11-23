// Smart embedding (Code studio ▸ Explorer ▸ "Embed in current file" and drag and drop into the editor): the reference
// text that brings one project file into another, chosen by both file types: an image becomes <img> in HTML, url() in
// CSS, ![]() in Markdown and an import in a bundled script; a stylesheet becomes <link> in HTML, @import in CSS and a
// side-effect import in JavaScript; a script becomes <script src>; JSON becomes an import with a JSON attribute; anything
// else becomes its relative path.
// Pure string code (no DOM): runs in browsers, workers and Node.js. Tests: tests/web/embed.test.js.
//
// Public API
//   embedSnippet(target, asset, { dataUri?, alt? })  -> { text, kind, block }   kind names the form ("img", "link" ...)
//   relativeImportPath(target, asset)                -> "./a.js", "../lib/b.js" (always starts with ./ or ../)
//   identifierFor(path)                              -> a valid JavaScript identifier from a file name ("heroImage")
//   canInline(size) / INLINE_LIMIT                   -> data URIs are offered for files up to 64 KiB
//   dataUriFor(bytes, path)                          -> "data:<mime>;base64,..."
import { relativeRef, extname, basename, mimeOf } from "./paths.js";
import { codeLanguageOf } from "./code-langs.js";
import { bytesToBase64 } from "./bytes.js";

/** Data URIs are offered for files up to this size (larger files make the source unwieldy). */
export const INLINE_LIMIT = 64 * 1024;

export const canInline = (size) => Number.isFinite(size) && size >= 0 && size <= INLINE_LIMIT;

const ext = (p) => extname(p).slice(1).toLowerCase();
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "cur", "apng", "tif", "tiff"]);
const VIDEO = new Set(["mp4", "webm", "ogv", "mov", "m4v"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"]);
const FONT = new Set(["woff", "woff2", "ttf", "otf", "eot"]);
const FONT_FORMAT = { woff: "woff", woff2: "woff2", ttf: "truetype", otf: "opentype", eot: "embedded-opentype" };
const SCRIPT = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts"]);
const STYLE = new Set(["css", "scss", "sass", "less", "styl"]);

/** What kind of file `path` is for embedding purposes. */
function assetKind(path) {
  const e = ext(path);
  if (IMAGE.has(e)) return "image";
  if (VIDEO.has(e)) return "video";
  if (AUDIO.has(e)) return "audio";
  if (FONT.has(e)) return "font";
  if (SCRIPT.has(e)) return "script";
  if (STYLE.has(e)) return "style";
  if (e === "json" || e === "jsonc" || e === "webmanifest") return "json";
  if (e === "html" || e === "htm") return "page";
  if (e === "tex" || e === "latex") return "tex";
  if (e === "bib") return "bib";
  if (e === "md" || e === "markdown" || e === "mdx") return "markdown";
  return "file";
}

/** What kind of file the reference is inserted into. */
function targetKind(path) {
  const e = ext(path);
  if (["scss", "sass", "less", "styl", "css"].includes(e)) return "css";
  if (["vue", "svelte", "astro", "php", "phtml", "erb", "twig", "njk", "liquid", "hbs", "handlebars", "j2", "jinja", "jinja2", "mustache"].includes(e)) return "html";
  const lang = codeLanguageOf(path)?.id;
  if (lang === "html" || lang === "css" || lang === "markdown" || lang === "latex" || lang === "python") return lang;
  if (lang === "javascript") return e === "ts" || e === "tsx" || e === "jsx" || e === "mts" || e === "cts" ? "bundled" : "javascript";
  return "other";
}

/** URL-safe relative reference for HTML, CSS and Markdown (spaces and other unsafe characters percent-encoded). */
const urlRef = (target, asset) => encodeURI(relativeRef(target, asset)).replace(/[()'"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Relative module specifier from `target` to `asset`: always starts with "./" or "../" so module resolution treats it
 * as a path and not as a package name.
 */
export function relativeImportPath(target, asset) {
  const r = relativeRef(target, asset);
  return r.startsWith("../") ? r : `./${r}`;
}

const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof var void while with yield await".split(" "));

/** A valid JavaScript identifier from a file name: "hero-image.png" -> "heroImage", "2x.png" -> "_2x". */
export function identifierFor(path) {
  const stem = basename(path).replace(/\.[^.]+$/, "") || "asset";
  const parts = stem.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  let id = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join("") || "asset";
  if (/^[0-9]/.test(id)) id = `_${id}`;
  if (RESERVED.has(id)) id = `${id}File`;
  return id;
}

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const altOf = (path) => basename(path).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

/** "data:<mime>;base64,…" for the bytes of `path`. */
export function dataUriFor(bytes, path) {
  return `data:${mimeOf(path)};base64,${bytesToBase64(bytes)}`;
}

/**
 * The text that embeds `asset` into the file `target`.
 * @param {string} target project path of the file being edited
 * @param {string} asset project path of the file to embed
 * @param {{ dataUri?: string, alt?: string }} [o] dataUri: inline the file instead of referencing it
 * @returns {{ text: string, kind: string, block: boolean }} block: the snippet belongs on a line of its own
 */
export function embedSnippet(target, asset, o = {}) {
  const a = assetKind(asset);
  const t = targetKind(target);
  const inline = typeof o.dataUri === "string" && o.dataUri.startsWith("data:");
  const url = inline ? o.dataUri : urlRef(target, asset);
  const alt = o.alt ?? altOf(asset);
  const name = basename(asset);
  const out = (kind, text, block = false) => ({ kind, text, block });
  switch (t) {
    case "html":
      switch (a) {
        case "image": return out("img", `<img src="${escAttr(url)}" alt="${escAttr(alt)}" />`);
        case "video": return out("video", `<video src="${escAttr(url)}" controls></video>`, true);
        case "audio": return out("audio", `<audio src="${escAttr(url)}" controls></audio>`, true);
        case "style": return out("link", `<link rel="stylesheet" href="${escAttr(url)}" />`, true);
        case "script": {
          const module = /^(mjs|ts|tsx|jsx|mts)$/.test(ext(asset));
          return out("script", `<script${module ? ' type="module"' : ""} src="${escAttr(url)}"></script>`, true);
        }
        case "font": return out("preload", `<link rel="preload" href="${escAttr(url)}" as="font" type="font/${ext(asset) === "ttf" ? "ttf" : ext(asset) === "otf" ? "otf" : ext(asset)}" crossorigin />`, true);
        case "page": return out("a", `<a href="${escAttr(url)}">${escAttr(alt)}</a>`);
        case "json":
          if (ext(asset) === "webmanifest" || /manifest\.json$/i.test(asset)) return out("manifest", `<link rel="manifest" href="${escAttr(url)}" />`, true);
          return out("a", `<a href="${escAttr(url)}">${escAttr(name)}</a>`);
        default: return out("a", `<a href="${escAttr(url)}">${escAttr(name)}</a>`);
      }
    case "css":
      switch (a) {
        case "style": return out("import", `@import url("${url}");`, true);
        case "font": {
          const family = altOf(asset).replace(/\b(regular|bold|italic|light|medium|semibold|black|thin|\d{3})\b/gi, "").trim() || "Custom font";
          return out("font-face", `@font-face {\n  font-family: "${family}";\n  src: url("${url}") format("${FONT_FORMAT[ext(asset)]}");\n  font-display: swap;\n}`, true);
        }
        default: return out("url", `url("${url}")`);
      }
    case "markdown":
      if (a === "image") return out("image", `![${alt}](${url.includes(" ") ? `<${url}>` : url})`);
      return out("link", `[${a === "page" || a === "markdown" ? alt : name}](${url})`);
    case "latex": {
      const rel = relativeRef(target, asset);
      if (a === "image" || /^(pdf|eps)$/.test(ext(asset))) return out("includegraphics", `\\includegraphics[width=\\linewidth]{${rel}}`, true);
      if (a === "tex") return out("input", `\\input{${rel.replace(/\.(tex|latex)$/i, "")}}`, true);
      if (a === "bib") return out("bibliography", `\\bibliography{${rel.replace(/\.bib$/i, "")}}`, true);
      return out("path", rel);
    }
    case "javascript":
    case "bundled": {
      const id = identifierFor(asset);
      if (inline) return out("const", `const ${id} = "${o.dataUri}";`, true);
      let spec = relativeImportPath(target, asset);
      if (a === "script") {
        if (t === "bundled" && /\.(ts|tsx|mts|cts)$/i.test(spec)) spec = spec.replace(/\.(ts|tsx|mts|cts)$/i, ""); // TypeScript resolves without the extension
        return out("import", `import ${id} from "${spec}";`, true);
      }
      if (a === "style") return out("import", `import "${spec}";`, true);
      if (a === "json") return out("import", `import ${id} from "${spec}" with { type: "json" };`, true);
      // assets: bundlers (TypeScript, JSX) import them; plain browser modules resolve the URL next to the module
      if (t === "bundled") return out("import", `import ${id} from "${spec}";`, true);
      return out("url", `const ${id} = new URL("${spec}", import.meta.url).href;`, true);
    }
    case "python":
      if (a === "file" && ext(asset) === "py") {
        const rel = relativeRef(target, asset).replace(/\.py$/i, "");
        if (!rel.startsWith("../")) return out("import", `import ${rel.split("/").join(".")}`, true);
      }
      return out("path", `"${relativeRef(target, asset)}"`);
    default:
      return out("path", inline ? o.dataUri : relativeRef(target, asset));
  }
}
