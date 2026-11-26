// Shared helpers of the Proto code exporters (codegen/*.js): identifiers, escaping, class namers, CSS printing.
// Pure: no DOM.

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export { isObj };

/** Words of a layer or property name, ASCII only ("Pay button 2" → ["Pay", "button", "2"]). */
export function words(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** kebab-case class name; never starts with a digit; `fallback` when the name has no usable characters. */
export function kebab(s, fallback = "layer") {
  let k = words(s).map((w) => w.toLowerCase()).join("-").slice(0, 48).replace(/-+$/, "");
  if (!k) k = fallback;
  if (/^\d/.test(k)) k = `${fallback}-${k}`;
  return k;
}

/** PascalCase identifier (component and screen names). */
export function pascal(s, fallback = "Component") {
  let p = words(s)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
    .slice(0, 64);
  if (!p) p = fallback;
  if (/^\d/.test(p)) p = `${fallback}${p}`;
  return p;
}

const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await children className key ref style".split(" "),
);

/** camelCase identifier (React props); reserved words get a "Prop" suffix. */
export function camel(s, fallback = "prop") {
  const p = pascal(s, "");
  let c = p ? p[0].toLowerCase() + p.slice(1) : fallback;
  if (RESERVED.has(c)) c += "Prop";
  return c;
}

/** Makes names unique in a scope: "card", "card-2", … (case-insensitive). */
export function uniquer(sep = "-") {
  const used = new Set();
  return (name) => {
    let n = name;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${name}${sep}${i}`;
    used.add(n.toLowerCase());
    return n;
  };
}

/**
 * Class names for a stylesheet scope. Layers with the same base name and the same declarations share one class (ten
 * list items of one component print one rule); otherwise the name gets a number.
 */
export function classNamer() {
  const unique = uniquer("-");
  const byKey = new Map();
  return (base, decls) => {
    const k = `${base}\n${declKey(decls)}`;
    if (byKey.has(k)) return { cls: byKey.get(k), fresh: false };
    const cls = unique(base);
    byKey.set(k, cls);
    return { cls, fresh: true };
  };
}

export const declKey = (decls) => (decls || []).map(([p, v]) => `${p}:${v}`).join(";");

/** A CSS rule as text (two-space indentation). */
export function cssRule(selector, decls, indent = "") {
  if (!decls.length) return "";
  return `${indent}${selector} {\n${decls.map(([p, v]) => `${indent}  ${p}: ${v};`).join("\n")}\n${indent}}`;
}

/** Declarations of `b` that differ from `a` (properties missing in `b` reset to their initial value where known). */
export function declDiff(a, b) {
  const am = new Map(a);
  const bm = new Map(b);
  const out = [];
  for (const [p, v] of b) if (am.get(p) !== v) out.push([p, v]);
  for (const [p] of a) if (!bm.has(p) && INITIAL[p] !== undefined) out.push([p, INITIAL[p]]);
  return out;
}

/** Initial values of the properties css.js emits, for diffs that remove a declaration. */
export const INITIAL = Object.freeze({
  position: "static", left: "auto", top: "auto", right: "auto", bottom: "auto", "z-index": "auto", display: "block",
  width: "auto", height: "auto", "min-width": "auto", "max-width": "none", "min-height": "auto", "max-height": "none",
  flex: "0 1 auto", "align-self": "auto", "justify-self": "auto", "grid-column": "auto", "grid-row": "auto",
  "flex-direction": "row", "flex-wrap": "nowrap", "column-gap": "normal", "row-gap": "normal", "align-items": "normal",
  "justify-content": "normal", "align-content": "normal", "justify-items": "legacy", "grid-template-columns": "none",
  "grid-template-rows": "none", "grid-template-areas": "none", "grid-auto-flow": "row", padding: "0",
  overflow: "visible", "overflow-x": "visible", "overflow-y": "visible", opacity: "1", "mix-blend-mode": "normal",
  transform: "none", "background-color": "transparent", "background-image": "none", "background-position": "0% 0%",
  "background-size": "auto", "background-repeat": "repeat", "border-width": "0", "border-style": "none",
  "border-color": "currentcolor", "border-radius": "0", outline: "none", "outline-offset": "0", "box-shadow": "none",
  filter: "none", "backdrop-filter": "none", "font-style": "normal", "letter-spacing": "normal", "text-align": "start",
  "text-transform": "none", "text-decoration-line": "none", "white-space": "normal", "overflow-wrap": "normal",
  "text-shadow": "none", "-webkit-text-stroke": "0", "-webkit-line-clamp": "none", "object-fit": "fill",
  "object-position": "50% 50%",
});

const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
/** Escapes text and attribute values for HTML. */
export const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => HTML_ESC[c]);

/** JSX text: plain when safe, else a JS string expression. */
export function jsxText(s) {
  const t = String(s ?? "");
  if (t === "") return "";
  if (/^[^{}<>&\n\r\t"'`\\]*$/.test(t) && t === t.trim() && !/\s{2}/.test(t)) return t;
  return `{${JSON.stringify(t)}}`;
}

/** A JSX attribute value: "text" or {expression}. */
export const jsxAttr = (v) => (/^[^"\\{}<>&\n]*$/.test(String(v)) ? `"${v}"` : `{${JSON.stringify(String(v))}}`);

/** A JS string literal with double quotes. */
export const jsStr = (s) => JSON.stringify(String(s ?? ""));

/** Indents every non-empty line of a block. */
export const indent = (text, pad) =>
  text
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");

/** Stable order: by a string key. */
export const byStr = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);

const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg" };
export const extOf = (mime) => MIME_EXT[mime] || "bin";
