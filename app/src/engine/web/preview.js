// Builds the self-contained document that the Code studio shows in its preview iframe (srcdoc).
// Pure: no DOM, no Blob/URL.createObjectURL, no fetch. The UI supplies the blob/data URL factories.
// See docs/web-engine.md.
import { parseHtml, findAttr, getAttr, decodeEntities, escapeAttr, escapeText, findByTag } from "./html.js";
import { parseCss, cssUrls, parseImport, minifyCss } from "./css.js";
import { resolveRef, normalizePath, mimeOf } from "./paths.js";
import { dataUrl } from "./bytes.js";
import { applyChanges } from "./edit.js";

/**
 * @typedef {import('./html.js').Diagnostic & { file: string }} FileDiagnostic
 * @typedef {{ file: string, module: boolean, inline: boolean }} ScriptInfo
 * @typedef {{
 *   bridge?: string, config?: object,
 *   makeScriptUrl?: (code: string, info: ScriptInfo) => string | null,
 *   makeAssetUrl?: (path: string, bytes: Uint8Array, mime: string) => string,
 *   annotate?: boolean,
 *   inlineAll?: boolean, minifyCss?: boolean
 * }} PreviewOptions
 * `inlineAll` and `minifyCss` are internal switches used by site.js for the single-file export: no annotations, no
 * data-of-file attributes, no head/doctype/bridge injection.
 * @typedef {{
 *   html: string, pages: string[],
 *   styles: { file: string, inline: boolean, index: number }[],
 *   diagnostics: FileDiagnostic[]
 * }} PreviewResult
 */

const MAX_IMPORT_DEPTH = 5;
const CYCLE = Symbol("cycle");

// ------------------------------------------------------------------------------------------------ JS module scanner

const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const REGEX_PUNCT = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const isIdStart = (c) => /[A-Za-z_$\u0080-\uffff]/.test(c);
const isIdPart = (c) => /[A-Za-z0-9_$\u0080-\uffff]/.test(c);

/**
 * Finds the string-literal specifiers of static imports, `export ... from`, side-effect imports and dynamic
 * `import("...")` calls. Comments, strings, template literals and regular expression literals are skipped (best effort).
 * `start`/`end` delimit the specifier text without its quotes.
 * @param {string} code
 * @returns {{ start: number, end: number, specifier: string, dynamic: boolean }[]}
 */
export function scanModuleSpecifiers(code) {
  const src = String(code ?? "");
  const n = src.length;
  const out = [];
  const hist = [];
  const push = (t) => {
    hist.push(t);
    if (hist.length > 3) hist.shift();
  };
  const skipString = (i, q) => {
    let j = i + 1;
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") j += 2;
      else if (ch === q) return j + 1;
      else if (ch === "\n") return j;
      else j++;
    }
    return n;
  };
  const skipRegex = (i) => {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") j += 2;
      else if (ch === "\n") return j;
      else if (ch === "[") {
        inClass = true;
        j++;
      } else if (ch === "]") {
        inClass = false;
        j++;
      } else if (ch === "/" && !inClass) {
        j++;
        while (j < n && isIdPart(src[j])) j++;
        return j;
      } else j++;
    }
    return n;
  };
  const skipTrivia = (i) => {
    let j = i;
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (src.startsWith("//", j)) {
        const e = src.indexOf("\n", j);
        j = e < 0 ? n : e;
      } else if (src.startsWith("/*", j)) {
        const e = src.indexOf("*/", j + 2);
        j = e < 0 ? n : e + 2;
      } else return j;
    }
  };
  const skipTemplate = (i) => {
    let j = i + 1;
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") j += 2;
      else if (ch === "`") return j + 1;
      else if (ch === "$" && src[j + 1] === "{") j = scan(j + 2, true);
      else j++;
    }
    return n;
  };
  function scan(from, inTemplate) {
    let i = from;
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) {
        i++;
      } else if (c === "/") {
        if (src[i + 1] === "/") {
          const e = src.indexOf("\n", i);
          i = e < 0 ? n : e;
        } else if (src[i + 1] === "*") {
          const e = src.indexOf("*/", i + 2);
          i = e < 0 ? n : e + 2;
        } else {
          const prev = hist[hist.length - 1];
          if (prev === undefined || REGEX_PUNCT.has(prev) || REGEX_KEYWORDS.has(prev)) {
            i = skipRegex(i);
            push("re");
          } else {
            push("/");
            i++;
          }
        }
      } else if (c === '"' || c === "'") {
        const start = i;
        i = skipString(i, c);
        const p1 = hist[hist.length - 1];
        const p2 = hist[hist.length - 2];
        const p3 = hist[hist.length - 3];
        const closed = i - 1 > start && src[i - 1] === c;
        if (closed && (p1 === "from" || p1 === "import")) {
          out.push({ start: start + 1, end: i - 1, specifier: src.slice(start + 1, i - 1), dynamic: false });
        } else if (closed && p1 === "(" && p2 === "import" && p3 !== ".") {
          const j = skipTrivia(i);
          if (src[j] === ")" || src[j] === ",") out.push({ start: start + 1, end: i - 1, specifier: src.slice(start + 1, i - 1), dynamic: true });
        }
        push("str");
      } else if (c === "`") {
        i = skipTemplate(i);
        push("tpl");
      } else if (c === "{") {
        depth++;
        push("{");
        i++;
      } else if (c === "}") {
        if (inTemplate && depth === 0) return i + 1;
        depth = Math.max(0, depth - 1);
        push("}");
        i++;
      } else if (isIdStart(c) || (c >= "0" && c <= "9")) {
        let j = i + 1;
        while (j < n && isIdPart(src[j])) j++;
        push(src.slice(i, j));
        i = j;
      } else {
        push(c);
        i++;
      }
    }
    return i;
  }
  scan(0, false);
  return out;
}

// ------------------------------------------------------------------------------------------------ helpers

const isJsType = (type) => type === null || /^(|text\/javascript|application\/javascript|application\/x-javascript|text\/ecmascript|application\/ecmascript|text\/jscript)$/i.test(type.split(";")[0].trim());
const jsEscapeUrl = (u) => u.replace(/[\\'"`\n\r$]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const dataScriptUrl = (code) => "data:text/javascript;charset=utf-8," + encodeURIComponent(code).replace(/'/g, "%27");
const escapeScriptText = (code) => code.replace(/<\/(script)/gi, "<\\/$1");
const escapeStyleText = (css) => css.replace(/<\/(style)/gi, "<\\/$1");

/** Removal range of an attribute including the whitespace before it. */
function attrRemoval(s, el, attr) {
  const floor = el.open.start + 1 + el.tag.length;
  const next = s[attr.end];
  // glued to the next token (`class="a"id=b`): keep the whitespace in front so the tokens stay apart
  if (next !== undefined && !/[\s>/]/.test(next)) return { from: attr.start, to: attr.end, insert: "" };
  let from = attr.start;
  while (from > floor && /\s/.test(s[from - 1])) from--;
  return { from, to: attr.end, insert: "" };
}

function parseSrcset(value) {
  const out = [];
  let i = 0;
  const n = value.length;
  while (i < n) {
    while (i < n && (value[i] === "," || /\s/.test(value[i]))) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !/\s/.test(value[i])) i++;
    let end = i;
    let commaEnded = false;
    while (end > start && value[end - 1] === ",") {
      end--;
      commaEnded = true;
    }
    out.push({ url: value.slice(start, end), start, end });
    if (!commaEnded) while (i < n && value[i] !== ",") i++;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ context

/**
 * Shared state for one preview build.
 * @param {import('./site.js').FileSourceLike} files
 * @param {PreviewOptions} options
 */
function makeContext(files, options) {
  /** @type {FileDiagnostic[]} */
  const diagnostics = [];
  const assetCache = new Map();
  const modules = new Map();
  const ctx = {
    files, options, diagnostics, modules,
    diag(severity, code, message, file, start, end) {
      diagnostics.push({ severity, code, message, start, end, file });
    },
    exists(path) {
      return files.readBytes(path) !== null || files.readText(path) !== null;
    },
    /** Asset URL for a project file or null when it does not exist. */
    asset(path) {
      if (assetCache.has(path)) return assetCache.get(path);
      const bytes = files.readBytes(path);
      let url = null;
      if (bytes) {
        const mime = mimeOf(path);
        url = options.makeAssetUrl ? options.makeAssetUrl(path, bytes, mime) : dataUrl(bytes, mime);
      }
      assetCache.set(path, url);
      return url;
    },
    /** URL for a script through the host factory, or null (inline it). */
    scriptUrl(code, info) {
      if (!options.makeScriptUrl) return null;
      const u = options.makeScriptUrl(code, info);
      return u || null;
    },
  };
  return ctx;
}

// ------------------------------------------------------------------------------------------------ CSS

/**
 * Rewrites one stylesheet: local @import rules are inlined, url() references become asset URLs.
 * `base` shifts diagnostic offsets when `text` is a slice of `file`.
 */
function processCss(ctx, file, text, base, chain, depth) {
  const parsed = parseCss(text);
  const changes = [];
  const importRanges = [];
  for (const r of parsed.rules) {
    if (r.type !== "at" || r.name !== "import" || r.block) continue;
    importRanges.push([r.start, r.end]);
    const imp = parseImport(r.prelude);
    if (!imp) continue;
    const ref = resolveRef(file, imp.url);
    if (!ref) continue;
    const content = ctx.files.readText(ref.path);
    if (content === null) {
      ctx.diag("warning", "preview/missing-file", `Imported stylesheet "${ref.path}" does not exist.`, file, base + r.preludeStart, base + r.preludeEnd);
      continue;
    }
    if (chain.includes(ref.path)) {
      ctx.diag("warning", "preview/css-cycle", `Circular @import of "${ref.path}" was skipped.`, file, base + r.start, base + r.end);
      changes.push({ from: r.start, to: r.end, insert: "/* circular @import skipped */" });
      continue;
    }
    if (depth >= MAX_IMPORT_DEPTH) {
      ctx.diag("warning", "preview/css-import-depth", `@import nesting is deeper than ${MAX_IMPORT_DEPTH} levels; "${ref.path}" was skipped.`, file, base + r.start, base + r.end);
      changes.push({ from: r.start, to: r.end, insert: "/* @import depth limit reached */" });
      continue;
    }
    let inner = processCss(ctx, ref.path, content, 0, chain.concat(ref.path), depth + 1);
    // wrap in the conditions of the @import rule
    let rest = imp.rest;
    const wrappers = [];
    const layer = /^layer(?:\(([^)]*)\))?/i.exec(rest);
    if (layer) {
      wrappers.push(`@layer${layer[1] ? " " + layer[1].trim() : ""}`);
      rest = rest.slice(layer[0].length).trim();
    }
    const supports = /^supports\(/i.exec(rest);
    if (supports) {
      let d = 0;
      let k = supports[0].length - 1;
      for (; k < rest.length; k++) {
        if (rest[k] === "(") d++;
        else if (rest[k] === ")" && --d === 0) break;
      }
      wrappers.push(`@supports ${rest.slice("supports".length, k + 1)}`);
      rest = rest.slice(k + 1).trim();
    }
    if (rest) wrappers.push(`@media ${rest}`);
    for (const w of wrappers.reverse()) inner = `${w} {\n${inner}\n}`;
    changes.push({ from: r.start, to: r.end, insert: inner });
  }
  for (const u of cssUrls(text)) {
    if (importRanges.some(([a, b]) => u.start >= a && u.start < b)) continue;
    const ref = resolveRef(file, u.url);
    if (!ref) continue;
    const url = ctx.asset(ref.path);
    if (url === null) {
      ctx.diag("warning", "preview/missing-file", `File "${ref.path}" does not exist.`, file, base + u.urlStart, base + u.urlEnd);
      continue;
    }
    changes.push({ from: u.start, to: u.end, insert: `url("${url.replace(/["\\\n\r]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ")}${ref.hash}")` });
  }
  return changes.length ? applyChanges(text, changes) : text;
}

/**
 * The rewritten text of one stylesheet (local assets as URLs, local @imports inlined) for replacing it in the
 * running preview without reloading the iframe.
 * @param {import('./site.js').FileSourceLike} files
 * @param {string} cssFile
 * @param {PreviewOptions} [options]
 * @returns {string}
 */
export function hotCss(files, cssFile, options = {}) {
  const path = normalizePath(cssFile);
  const text = files.readText(path);
  if (text === null) return "";
  return processCss(makeContext(files, options), path, text, 0, [path], 0);
}

// ------------------------------------------------------------------------------------------------ JS modules

/** Rewrites the import specifiers of a module so they point at the URLs of the dependencies (dependencies first). */
function rewriteModule(ctx, file, code) {
  const changes = [];
  for (const s of scanModuleSpecifiers(code)) {
    if (!/^(\.\.?\/|\/)/.test(s.specifier)) continue;
    const ref = resolveRef(file, s.specifier);
    if (!ref) continue;
    const dep = moduleUrl(ctx, ref.path);
    if (dep === null) {
      ctx.diag("warning", "preview/missing-file", `Imported module "${ref.path}" does not exist.`, file, s.start, s.end);
    } else if (dep === CYCLE) {
      ctx.diag("warning", "preview/module-cycle", `Circular import of "${ref.path}"; the specifier was left unchanged and will not resolve in the preview.`, file, s.start, s.end);
    } else changes.push({ from: s.start, to: s.end, insert: jsEscapeUrl(dep) });
  }
  return changes.length ? applyChanges(code, changes) : code;
}

/** URL of a dependency module (built on first use), null when missing, CYCLE while it is being built. */
function moduleUrl(ctx, path) {
  const st = ctx.modules.get(path);
  if (st === "visiting") return CYCLE;
  if (st) return st.url;
  const code = ctx.files.readText(path);
  if (code === null) return null;
  ctx.modules.set(path, "visiting");
  const rewritten = rewriteModule(ctx, path, code);
  const url = ctx.scriptUrl(rewritten, { file: path, module: true, inline: false }) || dataScriptUrl(rewritten);
  ctx.modules.set(path, { url });
  return url;
}

/** Processes a module that the page loads directly. Returns the code and the URL (null = inline it). */
function entryModule(ctx, path, code) {
  const st = ctx.modules.get(path);
  if (st && st !== "visiting") return { code: null, url: st.url };
  ctx.modules.set(path, "visiting");
  const rewritten = rewriteModule(ctx, path, code);
  const url = ctx.scriptUrl(rewritten, { file: path, module: true, inline: false });
  ctx.modules.set(path, { url: url || dataScriptUrl(rewritten) });
  return { code: rewritten, url };
}

// ------------------------------------------------------------------------------------------------ the document

const SRC_TAGS = new Set(["img", "source", "video", "audio", "track", "embed", "input"]);

/**
 * Builds the srcdoc document for an HTML page of the project.
 * @param {import('./site.js').FileSourceLike} files
 * @param {string} entry path of the HTML file, e.g. 'index.html'
 * @param {PreviewOptions} [options]
 * @returns {PreviewResult}
 */
export function buildPreview(files, entry, options = {}) {
  const entryPath = normalizePath(entry);
  const ctx = makeContext(files, options);
  const inlineAll = options.inlineAll === true;
  const annotate = options.annotate !== false && !inlineAll;
  const finishCss = (css) => (options.minifyCss ? minifyCss(css) : css);
  const pages = files.list().filter((p) => /\.html?$/i.test(p)).sort();
  const styles = [];
  let text = files.readText(entryPath);
  if (text === null) {
    ctx.diag("error", "preview/missing-entry", `The file "${entryPath}" does not exist.`, entryPath, 0, 0);
    text = `<main><h1>File not found</h1><p>The file ${escapeText(entryPath)} does not exist in this project.</p></main>`;
  }
  const parsed = parseHtml(text);
  const changes = [];
  const handlers = [];
  let linkedIndex = 0;
  let inlineIndex = 0;

  const refDiag = (start, end, ref) => ctx.diag("warning", "preview/missing-file", `File "${ref.path}" does not exist.`, entryPath, start, end);
  /** Replaces the value of a single-URL attribute with an asset URL. */
  const rewriteUrlAttr = (el, attr) => {
    if (attr.value === null || attr.unterminated) return;
    const ref = resolveRef(entryPath, decodeEntities(attr.value));
    if (!ref) return;
    const url = ctx.asset(ref.path);
    if (url === null) return refDiag(attr.valueStart, attr.valueEnd, ref);
    changes.push({ from: attr.valueStart, to: attr.valueEnd, insert: escapeAttr(url + ref.hash, attr.quote === "'" ? "'" : '"') });
  };
  const rewriteSrcset = (attr) => {
    if (!attr.value || attr.unterminated) return;
    for (const c of parseSrcset(attr.value)) {
      const ref = resolveRef(entryPath, decodeEntities(c.url));
      if (!ref) continue;
      const url = ctx.asset(ref.path);
      if (url === null) {
        refDiag(attr.valueStart + c.start, attr.valueStart + c.end, ref);
        continue;
      }
      changes.push({ from: attr.valueStart + c.start, to: attr.valueStart + c.end, insert: escapeAttr(url + ref.hash, attr.quote === "'" ? "'" : '"') });
    }
  };
  const rewriteStyleAttr = (attr) => {
    if (!attr.value || attr.unterminated || !/url\(/i.test(attr.value)) return;
    const css = decodeEntities(attr.value);
    const edits = [];
    for (const u of cssUrls(css)) {
      const ref = resolveRef(entryPath, u.url);
      if (!ref) continue;
      const url = ctx.asset(ref.path);
      if (url === null) {
        refDiag(attr.valueStart, attr.valueEnd, ref);
        continue;
      }
      edits.push({ from: u.start, to: u.end, insert: `url('${url}${ref.hash}')` });
    }
    if (edits.length) changes.push({ from: attr.valueStart, to: attr.valueEnd, insert: escapeAttr(applyChanges(css, edits), attr.quote === "'" ? "'" : '"') });
  };

  for (const el of parsed.elements) {
    const nameEnd = el.open.start + 1 + el.tag.length;
    let extra = annotate ? ` data-of="${el.id}"` : "";
    const tag = el.tag;
    let replaced = false;

    if (tag === "link") {
      const rel = (getAttr(el, "rel") || "").toLowerCase().split(/\s+/);
      const href = findAttr(el, "href");
      if (href && href.value !== null) {
        const ref = resolveRef(entryPath, decodeEntities(href.value));
        if (ref && rel.includes("stylesheet") && !rel.includes("alternate")) {
          const css = files.readText(ref.path);
          if (css === null) refDiag(href.valueStart, href.valueEnd, ref);
          else {
            const media = findAttr(el, "media");
            const out = finishCss(processCss(ctx, ref.path, css, 0, [ref.path], 0));
            const attrsText = (annotate ? ` data-of="${el.id}"` : "") + (inlineAll ? "" : ` data-of-file="${escapeAttr(ref.path)}"`) + (media && media.value ? ` media="${escapeAttr(decodeEntities(media.value))}"` : "");
            changes.push({ from: el.start, to: el.end, insert: `<style${attrsText}>${escapeStyleText(out)}</style>` });
            styles.push({ file: ref.path, inline: false, index: linkedIndex++ });
            replaced = true;
          }
        } else if (ref && rel.some((r) => r === "icon" || r === "apple-touch-icon" || r === "preload" || r === "shortcut" || r === "mask-icon" || r === "manifest") && !rel.includes("modulepreload")) {
          rewriteUrlAttr(el, href);
        }
      }
    } else if (tag === "style") {
      const content = el.children.length ? el.children[0] : null;
      const n = inlineIndex++;
      if (!inlineAll) {
        extra += ` data-of-file="${escapeAttr(entryPath)}" data-of-inline="${n}"`;
        styles.push({ file: entryPath, inline: true, index: n });
      }
      if (content && content.type === "text") {
        const out = finishCss(processCss(ctx, entryPath, content.text, content.start, [entryPath], 0));
        if (out !== content.text) changes.push({ from: content.start, to: content.end, insert: escapeStyleText(out) });
      }
    } else if (tag === "script") {
      const type = getAttr(el, "type");
      const module = type !== null && type.trim().toLowerCase() === "module";
      const src = findAttr(el, "src");
      if (isJsType(type) || module) {
        if (src && src.value !== null) {
          const ref = resolveRef(entryPath, decodeEntities(src.value));
          if (ref) {
            const code = files.readText(ref.path);
            if (code === null) refDiag(src.valueStart, src.valueEnd, ref);
            else {
              let outCode = code;
              let url;
              if (module) {
                const r = entryModule(ctx, ref.path, code);
                url = r.url;
                if (r.code !== null) outCode = r.code;
                else outCode = null;
              } else url = ctx.scriptUrl(code, { file: ref.path, module: false, inline: false });
              if (url) changes.push({ from: src.start, to: src.end, insert: `src="${escapeAttr(url)}"` });
              else {
                const r = el.close ? { start: el.open.end, end: el.close.start } : { start: el.open.end, end: el.end };
                changes.push(attrRemoval(text, el, src));
                changes.push({ from: r.start, to: r.end, insert: escapeScriptText(outCode) });
              }
            }
          }
        } else if (!src) {
          const content = el.children.length ? el.children[0] : null;
          if (content && content.type === "text" && content.text.trim() !== "") {
            let code = content.text;
            if (module) code = rewriteModule(ctx, entryPath, code);
            const url = ctx.scriptUrl(code, { file: entryPath, module, inline: true });
            if (url) {
              changes.push({ from: content.start, to: content.end, insert: "" });
              extra += ` src="${escapeAttr(url)}"`;
              if (!module) for (const a of el.attrs) if (a.name === "defer" || a.name === "async") changes.push(attrRemoval(text, el, a));
            } else if (code !== content.text) changes.push({ from: content.start, to: content.end, insert: escapeScriptText(code) });
          }
        }
      }
    } else {
      for (const a of el.attrs) {
        if (a.name === "src" && SRC_TAGS.has(tag)) {
          if (tag !== "input" || (getAttr(el, "type") || "").toLowerCase() === "image") rewriteUrlAttr(el, a);
        } else if (a.name === "srcset" && (tag === "img" || tag === "source")) rewriteSrcset(a);
        else if (a.name === "poster" && tag === "video") rewriteUrlAttr(el, a);
        else if (a.name === "data" && tag === "object") rewriteUrlAttr(el, a);
        else if ((a.name === "href" || a.name === "xlink:href") && tag === "image") rewriteUrlAttr(el, a);
      }
    }

    if (!replaced) {
      for (const a of el.attrs) {
        if (a.name === "style") rewriteStyleAttr(a);
        else if (annotate && /^on[a-z]{3,}$/.test(a.name) && a.value !== null && !a.unterminated) {
          handlers.push({ id: el.id, name: a.name, code: decodeEntities(a.value) });
          changes.push(attrRemoval(text, el, a));
        }
      }
      if (extra) changes.push({ from: nameEnd, to: nameEnd, insert: extra });
    }
  }

  // inline event handlers become one generated classic script before the end of the body
  const head = findByTag(parsed, "head");
  const html = findByTag(parsed, "html");
  const body = findByTag(parsed, "body");
  if (handlers.length) {
    const code = handlers
      .map((h) => `(function(){var e=document.querySelector('[data-of="${h.id}"]');if(e)e.${h.name}=function(event){${h.code}\n};})();`)
      .join("\n");
    const url = ctx.scriptUrl(code, { file: entryPath, module: false, inline: true });
    const tagText = url ? `<script src="${escapeAttr(url)}"></script>` : `<script>${escapeScriptText(code)}</script>`;
    const at = body && body.close ? body.close.start : text.length;
    changes.push({ from: at, to: at, insert: tagText });
  }

  // the bridge (with its config) is the first script of <head>
  let injected = "";
  if (options.bridge || options.config !== undefined) {
    const cfg = options.config !== undefined ? `window.__OF_CONFIG__=${JSON.stringify(options.config).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")};\n` : "";
    const code = cfg + (options.bridge || "");
    const url = ctx.scriptUrl(code, { file: "openfini-bridge.js", module: false, inline: true });
    injected = url ? `<script src="${escapeAttr(url)}"></script>` : `<script>${escapeScriptText(code)}</script>`;
  }
  let prefix = "";
  let suffix = "";
  if (head) {
    if (injected) changes.push({ from: head.open.end, to: head.open.end, insert: injected });
  } else if (html) {
    if (injected) changes.push({ from: html.open.end, to: html.open.end, insert: `<head>${injected}</head>` });
  } else if (body) {
    if (injected) changes.push({ from: body.start, to: body.start, insert: `<head>${injected}</head>` });
  } else {
    prefix = `<head>${injected}</head><body>`;
    suffix = "</body>";
  }
  if (inlineAll) return { html: applyChanges(text, changes), pages, styles, diagnostics: ctx.diagnostics };
  const hasDoctype = parsed.children.some((c) => c.type === "doctype");
  const doc = (hasDoctype ? "" : "<!doctype html>\n") + prefix + applyChanges(text, changes) + suffix;
  return { html: doc, pages, styles, diagnostics: ctx.diagnostics };
}
