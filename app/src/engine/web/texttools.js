// Text transforms for code and plain text (pure, no DOM). One registry feeds the code editor's Transform menu, the
// command palette and the Vibe `transform_file_text` tool. Character encoding lives in charcodec.js.
import { encode, decode } from "./charcodec.js";

// ---------------------------------------------------------------------------------------------- helpers

const WORD_RE = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lo}+|\p{N}+/gu;
/** Splits an identifier or phrase into words: "fooBar_baz-QUX 2" -> foo Bar baz QUX 2. */
export function words(s) {
  return String(s).match(WORD_RE) || [];
}
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);

const perLine = (fn) => (text) => text.split("\n").map(fn).join("\n");

export const toCamel = (s) => words(s).map((w, i) => (i ? cap(w) : w.toLowerCase())).join("");
export const toSnake = (s) => words(s).map((w) => w.toLowerCase()).join("_");
export const toKebab = (s) => words(s).map((w) => w.toLowerCase()).join("-");
export const toConstant = (s) => words(s).map((w) => w.toUpperCase()).join("_");
export const toTitle = (s) => String(s).replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => cap(w));

/** UTF-8 safe Base64. */
export function base64Encode(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function base64Decode(s) {
  const clean = String(s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("This is not valid Base64.");
  const bin = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "="));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The Base64 data is not UTF-8 text.");
  }
}

export function sortLines(text, order = "asc") {
  const trailing = text.endsWith("\n");
  let lines = (trailing ? text.slice(0, -1) : text).split("\n");
  const cmp = (a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
  const num = (l) => {
    const m = /-?\d+(?:\.\d+)?/.exec(l);
    return m ? parseFloat(m[0]) : Infinity;
  };
  if (order === "unique") lines = [...new Set(lines)].sort(cmp);
  else if (order === "numeric") lines.sort((a, b) => num(a) - num(b) || cmp(a, b));
  else if (order === "desc") lines.sort((a, b) => cmp(b, a));
  else if (order === "reverse") lines.reverse();
  else lines.sort(cmp);
  return lines.join("\n") + (trailing ? "\n" : "");
}

export function joinLines(text, sep = " ") {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).join(sep);
}
export const trimLines = perLine((l) => l.trim());
export const trimTrailing = perLine((l) => l.replace(/[ \t]+$/, ""));
export const normalizeSpaces = perLine((l) => {
  const indent = /^[ \t]*/.exec(l)[0];
  return indent + l.slice(indent.length).replace(/[ \t ]+/g, " ").replace(/ $/, "");
});
export const removeBlankLines = (text) => text.split("\n").filter((l) => l.trim()).join("\n");

export function tabsToSpaces(text, size = 2) {
  return text.replace(/^\t+/gm, (m) => " ".repeat(size).repeat(m.length)).replace(/\t/g, " ".repeat(size));
}
export function spacesToTabs(text, size = 2) {
  return text.replace(/^( +)/gm, (m) => "\t".repeat(Math.floor(m.length / size)) + " ".repeat(m.length % size));
}
export function convertLineEndings(text, to = "lf") {
  const eol = to === "crlf" ? "\r\n" : to === "cr" ? "\r" : "\n";
  return text.replace(/\r\n|\r|\n/g, eol);
}

export function jsonPrettify(text, indent = 2) {
  return JSON.stringify(JSON.parse(text), null, indent);
}
export function jsonMinify(text) {
  return JSON.stringify(JSON.parse(text));
}

/** Wraps text in a tag (`<tag>…</tag>`, attributes allowed: "a href='#'"), quotes, parentheses or a comment. */
export function wrap(text, kind, arg = "") {
  switch (kind) {
    case "tag": {
      const spec = String(arg || "span").trim();
      const name = /^[A-Za-z][\w:-]*/.exec(spec)?.[0];
      if (!name) throw new Error("Enter a tag name such as div or a href=\"#\".");
      return `<${spec}>${text}</${name}>`;
    }
    case "double":
      return `"${text}"`;
    case "single":
      return `'${text}'`;
    case "backtick":
      return `\`${text}\``;
    case "parens":
      return `(${text})`;
    case "brackets":
      return `[${text}]`;
    case "braces":
      return `{${text}}`;
    case "comment":
      if (arg === "html") return `<!-- ${text.replace(/--/g, "- -")} -->`;
      if (arg === "line") return text.split("\n").map((l) => `// ${l}`).join("\n");
      return `/* ${text.replace(/\*\//g, "* /")} */`;
    default:
      throw new Error(`Unknown wrapper "${kind}".`);
  }
}

// ---------------------------------------------------------------------------------------------- colors

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?)\(\s*[^()]*\)/gi;

/** Parses a CSS color literal (hex, rgb(), hsl()) into {r,g,b,a} (0-255, alpha 0-1) or null. */
export function parseColor(s) {
  s = String(s).trim();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(s);
  if (m) {
    const ch = (v, pct) => (pct ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    return { r: clamp(ch(m[1], m[2]), 0, 255), g: clamp(ch(m[3], m[4]), 0, 255), b: clamp(ch(m[5], m[6]), 0, 255), a: m[7] == null ? 1 : clamp(m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]), 0, 1) };
  }
  m = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(s);
  if (m) {
    const h = (((parseFloat(m[1]) % 360) + 360) % 360) / 360;
    const sat = clamp(parseFloat(m[2]) / 100, 0, 1);
    const l = clamp(parseFloat(m[3]) / 100, 0, 1);
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
    };
    return { r: sat === 0 ? l * 255 : f(h + 1 / 3), g: sat === 0 ? l * 255 : f(h), b: sat === 0 ? l * 255 : f(h - 1 / 3), a: m[4] == null ? 1 : clamp(m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]), 0, 1) };
  }
  return null;
}

const r3 = (n) => Math.round(n * 1000) / 1000;
/** Formats {r,g,b,a} as "hex", "rgb" or "hsl". */
export function formatColor(c, to) {
  const a = r3(c.a);
  if (to === "hex") return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${a < 1 ? hex2(c.a * 255) : ""}`;
  if (to === "rgb") return a < 1 ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})` : `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
  if (to === "hsl") {
    const r = c.r / 255;
    const g = c.g / 255;
    const b = c.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    const hs = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
    return a < 1 ? `hsla(${hs}, ${a})` : `hsl(${hs})`;
  }
  throw new Error(`Unknown color format "${to}".`);
}
export function convertColor(text, to) {
  const c = parseColor(text);
  if (!c) throw new Error("This is not a color literal (hex, rgb() or hsl()).");
  return formatColor(c, to);
}
/** The color literal that contains `offset` in a line of text, as {from,to,text} (offsets within the line) or null. */
export function colorAt(line, offset) {
  COLOR_RE.lastIndex = 0;
  let m;
  while ((m = COLOR_RE.exec(line))) {
    if (offset >= m.index && offset <= m.index + m[0].length && parseColor(m[0])) return { from: m.index, to: m.index + m[0].length, text: m[0] };
  }
  return null;
}

/** Word range around an offset: letters, digits, underscore, dash and dollar. */
export function wordRangeAt(text, offset) {
  const isW = (c) => !!c && /[\p{L}\p{N}_$-]/u.test(c);
  let a = offset;
  let b = offset;
  while (a > 0 && isW(text[a - 1])) a--;
  while (b < text.length && isW(text[b])) b++;
  return { from: a, to: b };
}

// ---------------------------------------------------------------------------------------------- registry

/**
 * @typedef {object} Transform
 * @property {string} id camelCase id (also the command id `code.<id>` and the Vibe tool's `transform` value)
 * @property {string} label
 * @property {"encode"|"decode"|"convert"|"case"|"lines"|"wrap"|"json"|"color"} group
 * @property {"word"|"line"|"file"|"color"} scope what an empty selection operates on
 * @property {(text: string, o?: object) => string} apply may throw an Error with a user-facing message
 */
const T = (id, label, group, scope, apply, extra = {}) => ({ id, label, group, scope, apply, ...extra });
const enc = (id, label, format, mode = "non-ascii", o = {}) => T(id, label, "encode", "line", (t) => encode(t, { format, mode, ...o }));

/** @type {Transform[]} */
export const TRANSFORMS = [
  enc("encodeEntitiesNamed", "HTML named entities (&eacute;)", "html-named"),
  enc("encodeEntitiesDecimal", "HTML decimal (&#233;)", "html-decimal"),
  enc("encodeEntitiesHex", "HTML hexadecimal (&#xE9;)", "html-hex"),
  enc("encodeJsEscapes", "JavaScript / JSON (\\u00e9)", "js"),
  enc("encodeJsBraces", "JavaScript with \\u{…} for astral characters", "js", "non-ascii", { braces: true }),
  enc("encodeCssEscapes", "CSS escapes (\\E9 )", "css"),
  enc("encodePercent", "URL percent-encoding (UTF-8)", "url"),
  enc("encodeCodePoints", "Unicode code points (<U+00E9>)", "codepoints"),
  enc("escapeHtml", "Escape markup characters (& < > \" ')", "html-named", "special"),
  T("unescapeHtml", "Unescape HTML entities", "decode", "line", (t) => decode(t, "html")),
  T("decodeEntities", "HTML entities (named, decimal, hex)", "decode", "line", (t) => decode(t, "html")),
  T("decodeJsEscapes", "JavaScript / JSON \\u escapes", "decode", "line", (t) => decode(t, "js")),
  T("decodeCssEscapes", "CSS escapes", "decode", "line", (t) => decode(t, "css")),
  T("decodePercent", "URL percent-encoding", "decode", "line", (t) => decode(t, "url")),
  T("decodeCodePoints", "Unicode code points", "decode", "line", (t) => decode(t, "codepoints")),
  T("decodeAuto", "Auto (entities and \\u escapes)", "decode", "line", (t) => decode(t, "auto")),
  T("base64Encode", "Base64 encode", "convert", "line", (t) => base64Encode(t)),
  T("base64Decode", "Base64 decode", "convert", "line", (t) => base64Decode(t)),
  T("urlEncode", "URL encode (component)", "convert", "line", (t) => encodeURIComponent(t)),
  T("urlDecode", "URL decode (component)", "convert", "line", (t) => {
    try {
      return decodeURIComponent(t.replace(/\+/g, " "));
    } catch {
      throw new Error("This is not valid percent-encoded text.");
    }
  }),
  T("upperCase", "UPPER CASE", "case", "word", (t) => t.toUpperCase()),
  T("lowerCase", "lower case", "case", "word", (t) => t.toLowerCase()),
  T("titleCase", "Title Case", "case", "word", toTitle),
  T("camelCase", "camelCase", "case", "word", perLine(toCamel)),
  T("snakeCase", "snake_case", "case", "word", perLine(toSnake)),
  T("kebabCase", "kebab-case", "case", "word", perLine(toKebab)),
  T("constantCase", "CONSTANT_CASE", "case", "word", perLine(toConstant)),
  T("sortLinesAsc", "Sort lines ascending", "lines", "file", (t) => sortLines(t, "asc")),
  T("sortLinesDesc", "Sort lines descending", "lines", "file", (t) => sortLines(t, "desc")),
  T("sortLinesNumeric", "Sort lines numerically", "lines", "file", (t) => sortLines(t, "numeric")),
  T("sortLinesUnique", "Sort lines and remove duplicates", "lines", "file", (t) => sortLines(t, "unique")),
  T("reverseLines", "Reverse lines", "lines", "file", (t) => sortLines(t, "reverse")),
  T("joinLines", "Join lines", "lines", "file", (t) => joinLines(t)),
  T("trimLines", "Trim lines", "lines", "file", trimLines),
  T("trimTrailing", "Trim trailing whitespace", "lines", "file", trimTrailing),
  T("normalizeWhitespace", "Normalize whitespace", "lines", "file", normalizeSpaces),
  T("removeBlankLines", "Remove blank lines", "lines", "file", removeBlankLines),
  T("tabsToSpaces", "Tabs to spaces", "lines", "file", (t, o) => tabsToSpaces(t, o?.tabSize || 2)),
  T("spacesToTabs", "Spaces to tabs", "lines", "file", (t, o) => spacesToTabs(t, o?.tabSize || 2)),
  T("lineEndingsLf", "Line endings: LF", "lines", "file", (t) => convertLineEndings(t, "lf"), { fileOnly: true }),
  T("lineEndingsCrlf", "Line endings: CRLF", "lines", "file", (t) => convertLineEndings(t, "crlf"), { fileOnly: true }),
  T("wrapTag", "Wrap in tag…", "wrap", "word", (t, o) => wrap(t, "tag", o?.arg), { needsArg: "Tag (for example div or a href=\"#\")" }),
  T("wrapDoubleQuotes", "Wrap in double quotes", "wrap", "word", (t) => wrap(t, "double")),
  T("wrapSingleQuotes", "Wrap in single quotes", "wrap", "word", (t) => wrap(t, "single")),
  T("wrapParens", "Wrap in parentheses", "wrap", "word", (t) => wrap(t, "parens")),
  T("wrapBrackets", "Wrap in brackets", "wrap", "word", (t) => wrap(t, "brackets")),
  T("wrapComment", "Wrap in comment", "wrap", "line", (t, o) => wrap(t, "comment", o?.lang === "html" || o?.lang === "markdown" ? "html" : "block")),
  T("jsonPrettify", "Prettify JSON", "json", "file", (t, o) => jsonPrettify(t, o?.tabSize || 2)),
  T("jsonMinify", "Minify JSON", "json", "file", jsonMinify),
  T("colorToHex", "Color to hex", "color", "color", (t) => convertColor(t, "hex")),
  T("colorToRgb", "Color to rgb()", "color", "color", (t) => convertColor(t, "rgb")),
  T("colorToHsl", "Color to hsl()", "color", "color", (t) => convertColor(t, "hsl")),
];

export const TRANSFORM_BY_ID = new Map(TRANSFORMS.map((t) => [t.id, t]));
