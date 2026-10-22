// A small CommonMark-compatible Markdown renderer with GitHub-flavored extensions (tables, task lists,
// strikethrough, bare-URL autolinks), footnotes, front matter and optional math placeholders. Pure: no DOM.
//
// Safety: the output is meant to be inserted into the application DOM. Text is always escaped; raw HTML is passed
// through an allowlist sanitizer (no scripts, styles, forms, frames, event handlers, ids or classes; only safe URL
// schemes); every URL goes through `options.resolveUrl` first, so the host decides what may load.
//
// It follows the CommonMark rules for the constructs it supports (flanking delimiter runs, setext headings, loose
// and tight lists, lazy continuation, link reference definitions, HTML block kinds 1-7). It does not implement
// every corner of the spec (for example nested link labels with unusual bracket balance); see tests/web/markdown.test.js.
import { highlight, languageId, escapeCode } from "./highlight.js";

/**
 * @typedef {{
 *   math?: boolean, mdx?: boolean, highlight?: boolean, breaks?: boolean, headingIds?: boolean, idPrefix?: string,
 *   lineMarkers?: boolean, frontMatter?: 'hide'|'table', resolveUrl?: (url: string, kind: 'link'|'image') => string|null,
 *   externalLinkAttrs?: boolean
 * }} MarkdownOptions
 * `math`: `$..$` and `$$..$$` become `<span class="tex-math" data-tex>` placeholders (render them with KaTeX).
 * `mdx`: lightweight MDX: top-level import/export lines are dropped and JSX components are shown as placeholders.
 * `lineMarkers`: top-level blocks get `data-line` (1-based source line) for scroll syncing.
 * `idPrefix` (default "md-") is put in front of heading and footnote ids so they cannot collide with application ids.
 * @typedef {{ level: number, text: string, id: string, line: number }} MarkdownHeading
 * @typedef {{
 *   html: string, headings: MarkdownHeading[], meta: Record<string, any>, title: string, hasMath: boolean,
 *   words: number, footnotes: number
 * }} MarkdownResult
 */

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ------------------------------------------------------------------------------------------------ entities

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  bull: "•", middot: "·", times: "×", divide: "÷", euro: "€", pound: "£", yen: "¥", cent: "¢",
  sect: "§", para: "¶", deg: "°", plusmn: "±", micro: "µ", larr: "←", rarr: "→", uarr: "↑",
  darr: "↓", harr: "↔", hearts: "♥", check: "✓", infin: "∞", ne: "≠", le: "≤", ge: "≥",
  frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", iexcl: "¡", iquest: "¿", shy: "­",
  ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍", auml: "ä", ouml: "ö", uuml: "ü",
  Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
};

/** Decodes the entity at the start of `s` (`&amp;`, `&#38;`, `&#x26;`); returns { text, length } or null. */
function entityAt(s) {
  const m = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/.exec(s);
  if (!m) return null;
  if (m[3]) return Object.prototype.hasOwnProperty.call(ENTITIES, m[3]) ? { text: ENTITIES[m[3]], length: m[0].length } : null;
  const cp = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16);
  const ok = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
  return { text: ok ? String.fromCodePoint(cp) : "�", length: m[0].length };
}

/** Decodes backslash escapes and entities (used for link destinations, titles and info strings). */
function unescapeMd(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && /[!-/:-@[-`{-~]/.test(s[i + 1] || "")) {
      out += s[++i];
    } else if (c === "&") {
      const e = entityAt(s.slice(i, i + 40));
      if (e) {
        out += e.text;
        i += e.length - 1;
      } else out += c;
    } else out += c;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ URL safety

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel", "ftp", "sms"]);

/**
 * Returns the URL when it is safe to use (relative references, #fragments and http/https/mailto/tel/ftp/sms links;
 * images may also use data:image/* and blob: URLs), else null.
 * @param {string} url
 * @param {'link'|'image'} [kind]
 * @returns {string|null}
 */
export function safeUrl(url, kind = "link") {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  // browsers ignore control characters and whitespace inside the scheme ("java\tscript:")
  // eslint-disable-next-line no-control-regex
  const probe = raw.replace(/[\x00-\x20\x7f-\x9f\p{Cf}\p{Zl}\p{Zp}]/gu, "");
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe);
  if (!m) return raw;
  const scheme = m[1].toLowerCase();
  if (SAFE_SCHEMES.has(scheme)) return raw;
  if (kind === "image" && scheme === "blob") return raw;
  if (kind === "image" && scheme === "data" && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(probe)) return raw;
  return null;
}

/** Percent-encodes what must not appear in an href while keeping existing escapes. */
function encodeUrl(url) {
  try {
    return encodeURI(url).replace(/%25([0-9a-fA-F]{2})/g, "%$1");
  } catch {
    return url.replace(/[^\w!#$&'()*+,\-./:;=?@[\]~%]/g, "");
  }
}

// ------------------------------------------------------------------------------------------------ sanitizer

const ALLOWED_TAGS = new Set(
  `a abbr b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd
  li mark ol p pre q s samp small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr`.split(/\s+/),
);
const VOID_TAGS = new Set(["br", "hr", "img", "wbr", "col", "input", "source", "area", "base", "link", "meta", "embed", "param", "track"]);
const ALLOWED_ATTRS = {
  "*": new Set(["title", "lang", "dir", "align"]),
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  td: new Set(["colspan", "rowspan", "scope", "valign"]),
  th: new Set(["colspan", "rowspan", "scope", "valign"]),
  ol: new Set(["start", "type", "reversed"]),
  details: new Set(["open"]),
  time: new Set(["datetime"]),
  col: new Set(["span", "width"]),
  colgroup: new Set(["span"]),
  ins: new Set(["datetime"]),
  del: new Set(["datetime"]),
};
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Escapes text but keeps valid character references untouched. */
function escapeKeepEntities(text) {
  return text.replace(/&(?!(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanitizes a fragment of raw HTML with an allowlist: unknown tags are shown as text, attributes other than a small
 * allowlist are dropped (no ids, classes, styles or event handlers), URLs are checked, comments are removed.
 * @param {string} html
 * @param {{ resolveUrl?: (url: string, kind: 'link'|'image') => string|null, mdx?: boolean }} [opts]
 * @returns {string}
 */
export function sanitizeHtml(html, opts = {}) {
  const src = String(html ?? "");
  let out = "";
  let last = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src))) {
    out += escapeKeepEntities(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      out += escapeKeepEntities(m[0]);
      continue;
    }
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    let attrs = "";
    const allow = ALLOWED_ATTRS[tag];
    ATTR_RE.lastIndex = 0;
    let a;
    const attrText = m[3] || "";
    while ((a = ATTR_RE.exec(attrText))) {
      const name = a[1].toLowerCase();
      if (!(ALLOWED_ATTRS["*"].has(name) || allow?.has(name))) continue;
      let value = a[2] ?? a[3] ?? a[4] ?? "";
      value = unescapeMd(value);
      if (name === "href" || name === "src") {
        const kind = name === "src" ? "image" : "link";
        let u = safeUrl(value, kind);
        if (u === null) continue;
        if (opts.resolveUrl && u) u = opts.resolveUrl(u, kind);
        if (u === null) {
          if (tag === "img") return out + `<span class="md-missing-image">${escHtml(attrText.match(/alt\s*=\s*"([^"]*)"/i)?.[1] || "image")}</span>`;
          continue;
        }
        value = encodeUrl(u);
      } else if ((name === "width" || name === "height" || name === "colspan" || name === "rowspan" || name === "start" || name === "span") && !/^\d{1,4}%?$/.test(value)) continue;
      else if (name === "loading" && !/^(lazy|eager)$/.test(value)) continue;
      else if (name === "align" && !/^(left|right|center|justify)$/i.test(value)) continue;
      attrs += a[2] === undefined && a[3] === undefined && a[4] === undefined ? ` ${name}` : ` ${name}="${escHtml(value)}"`;
    }
    if (tag === "a" && /\shref=/.test(attrs) && /\shref="(?:https?:|\/\/)/.test(attrs)) attrs += ' rel="noopener noreferrer"';
    out += `<${tag}${attrs}>`;
  }
  out += escapeKeepEntities(src.slice(last));
  return out;
}

/** Closes unclosed tags at the end and drops stray end tags in HTML that this module generated or sanitized. */
export function balanceHtml(html) {
  const stack = [];
  let out = "";
  let last = 0;
  const re = /<(\/?)([a-z][a-z0-9-]*)(?:\s[^>]*)?>/g;
  let m;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index);
    last = m.index + m[0].length;
    const tag = m[2];
    if (VOID_TAGS.has(tag)) {
      out += m[0];
    } else if (!m[1]) {
      stack.push(tag);
      out += m[0];
    } else {
      const i = stack.lastIndexOf(tag);
      if (i < 0) continue; // stray end tag
      while (stack.length > i + 1) out += `</${stack.pop()}>`;
      stack.pop();
      out += m[0];
    }
  }
  out += html.slice(last);
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

// ------------------------------------------------------------------------------------------------ front matter

function parseScalar(v) {
  const t = v.trim();
  if (t === "") return "";
  if (/^".*"$/s.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  if (/^'.*'$/s.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^(true|yes)$/i.test(t)) return true;
  if (/^(false|no)$/i.test(t)) return false;
  if (/^(null|~)$/i.test(t)) return null;
  if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t);
  if (t.startsWith("[") && t.endsWith("]")) return splitFlow(t.slice(1, -1)).map(parseScalar);
  return t;
}

function splitFlow(s) {
  const out = [];
  let cur = "";
  let q = "";
  for (const c of s) {
    if (q) {
      cur += c;
      if (c === q) q = "";
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "" || out.length) out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== "");
}

/**
 * Parses a leading `---` YAML block (a practical subset: scalars, quoted strings, `[a, b]` lists, `- item` lists,
 * `|` and `>` block scalars, one level of nested keys).
 * @param {string} source
 * @returns {{ meta: Record<string, any>, body: string, raw: string, lines: number }}
 */
export function parseFrontMatter(source) {
  const text = String(source ?? "").replace(/^﻿/, "");
  const m = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text, raw: "", lines: 0 };
  const raw = m[1] ?? "";
  const first = raw.split(/\r?\n/).find((l) => l.trim() !== "");
  if (first !== undefined && !/^(#|-\s|[\w"'.-][^:]*:(\s|$))/.test(first)) return { meta: {}, body: text, raw: "", lines: 0 };
  const meta = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#") || /^\s/.test(line)) continue;
    const kv = /^([^:]+?):(?:\s+(.*)|\s*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim().replace(/^["']|["']$/g, "");
    const rest = (kv[2] ?? "").replace(/\s+#\s.*$/, "");
    if (/^[|>][+-]?$/.test(rest.trim())) {
      const folded = rest.trim()[0] === ">";
      const buf = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) buf.push(lines[++i].replace(/^\s{1,4}/, ""));
      meta[key] = (folded ? buf.join(" ").replace(/\s+/g, " ") : buf.join("\n")).trim();
    } else if (rest.trim() === "") {
      const items = [];
      const nested = {};
      let isList = false;
      let isMap = false;
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        const l = lines[++i];
        const li = /^\s*-\s+(.*)$/.exec(l);
        if (li) {
          isList = true;
          items.push(parseScalar(li[1]));
        } else if (l.trim()) {
          const nk = /^\s+([^:]+?):\s*(.*)$/.exec(l);
          if (nk) {
            isMap = true;
            nested[nk[1].trim()] = parseScalar(nk[2]);
          }
        }
      }
      meta[key] = isList ? items : isMap ? nested : "";
    } else meta[key] = parseScalar(rest);
  }
  return { meta, body: text.slice(m[0].length), raw, lines: m[0].split("\n").length - 1 };
}

// ------------------------------------------------------------------------------------------------ helpers

/** URL/heading slug: lower case, letters and digits kept (including non-Latin), everything else becomes "-". */
export function slugify(text) {
  const s = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s || "section";
}

const isWs = (c) => c === undefined || c === "" || /\s/.test(c);
const isPunct = (c) => c !== undefined && c !== "" && /[\p{P}\p{S}]/u.test(c);
const normLabel = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
/** Removes tags until nothing changes, so nested fragments such as `<scr<b>ipt>` cannot reassemble into a tag. */
const stripTags = (html) => {
  let s = html;
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);
  return s;
};
const decodeAll = (s) => s.replace(/&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (m) => entityAt(m)?.text ?? m);

function expandTabs(line) {
  if (!line.includes("\t")) return line;
  let out = "";
  let col = 0;
  for (const c of line) {
    if (c === "\t") {
      const n = 4 - (col % 4);
      out += " ".repeat(n);
      col += n;
    } else {
      out += c;
      col++;
    }
  }
  return out;
}

const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => /^[ \t]*$/.test(l);

// ------------------------------------------------------------------------------------------------ block parser

const BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML6 = new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?:\\s|/?>|$)`, "i");
const HTML7 = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/;

function htmlBlockKind(line, canInterrupt) {
  if (/^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i.test(line)) return 1;
  if (/^ {0,3}<!--/.test(line)) return 2;
  if (/^ {0,3}<\?/.test(line)) return 3;
  if (/^ {0,3}<![A-Za-z]/.test(line)) return 4;
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return 5;
  if (HTML6.test(line)) return 6;
  if (!canInterrupt && HTML7.test(line) && !/^ {0,3}<(?:script|style|pre)(?:\s|>|$)/i.test(line)) return 7;
  return 0;
}
const HTML_END = [
  null,
  /<\/(?:script|pre|style|textarea)\s*>/i,
  /--!?>/,
  /\?>/,
  />/,
  /\]\]>/,
];

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)[ \t]*(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET_RE = /^( {0,3})([-+*])( +|$)/;
const ORDERED_RE = /^( {0,3})(\d{1,9})([.)])( +|$)/;
const REF_DEF_RE = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:[ \t\n]*(<[^<>\n]*>|[^\s<][^\s]*)(?:[ \t\n]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?[ \t]*(?:\n|$)/;
const FN_DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function fenceOpen(line) {
  const m = FENCE_RE.exec(line);
  if (!m) return null;
  if (m[2][0] === "`" && m[3].includes("`")) return null;
  return { indent: m[1].length, ch: m[2][0], len: m[2].length, info: m[3].trim() };
}

function listMarker(line) {
  let m = BULLET_RE.exec(line);
  if (m) {
    const rest = line.slice(m[0].length);
    const spaces = m[3].length;
    const empty = rest.trim() === "" && spaces <= 1 + 0 ? true : rest.trim() === "";
    const W = empty ? m[1].length + 2 : m[1].length + 1 + (spaces > 4 ? 1 : spaces);
    return { ordered: false, ch: m[2], indent: m[1].length, W, empty, start: 1 };
  }
  m = ORDERED_RE.exec(line);
  if (m) {
    const rest = line.slice(m[0].length);
    const spaces = m[4].length;
    const empty = rest.trim() === "";
    const W = empty ? m[1].length + m[2].length + 2 : m[1].length + m[2].length + 1 + (spaces > 4 ? 1 : spaces);
    return { ordered: true, ch: m[3], indent: m[1].length, W, empty, start: parseInt(m[2], 10), digits: m[2] };
  }
  return null;
}

function splitCells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Does this line start a block that may interrupt a paragraph? (`quote`, fence, heading, rule, list, HTML 1-6) */
function interruptsParagraph(line, opts) {
  if (fenceOpen(line) || ATX_RE.test(line) || HR_RE.test(line) || /^ {0,3}>/.test(line)) return true;
  const lm = listMarker(line);
  if (lm && !lm.empty && (!lm.ordered || lm.start === 1)) return true;
  if (htmlBlockKind(line, true)) return true;
  if (opts.math && /^ {0,3}\$\$/.test(line)) return true;
  return false;
}

/**
 * Parses `lines` into block nodes. `top` blocks carry their source line (index + lineBase + 1).
 */
function parseBlocks(lines, ctx, top = false, lineBase = 0) {
  if ((ctx.depth || 0) > 24) return [{ t: "p", text: lines.join("\n").trim() }];
  ctx.depth = (ctx.depth || 0) + (top ? 0 : 1);
  try {
    return parseBlocksInner(lines, ctx, top, lineBase, []);
  } finally {
    ctx.depth -= top ? 0 : 1;
  }
}

function parseBlocksInner(lines, ctx, top, lineBase, blocks) {
  const n = lines.length;
  let i = 0;
  let blankBefore = false;
  const push = (b, startIdx) => {
    if (blankBefore) b.blankBefore = true;
    blankBefore = false;
    if (top) b.line = startIdx + lineBase + 1;
    blocks.push(b);
  };

  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      blankBefore = true;
      i++;
      continue;
    }
    const start = i;
    const ind = indentOf(line);

    // indented code
    if (ind >= 4) {
      const buf = [];
      while (i < n && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) buf.push(lines[i++]);
      while (buf.length && isBlank(buf[buf.length - 1])) {
        buf.pop();
        i--;
      }
      push({ t: "code", info: "", text: buf.map((l) => l.slice(4)).join("\n") }, start);
      continue;
    }

    // fenced code
    const f = fenceOpen(line);
    if (f) {
      const buf = [];
      i++;
      while (i < n) {
        const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (m && m[1][0] === f.ch && m[1].length >= f.len) {
          i++;
          break;
        }
        buf.push(lines[i].replace(new RegExp(`^ {0,${f.indent}}`), ""));
        i++;
      }
      push({ t: "code", info: unescapeMd(f.info), text: buf.join("\n") }, start);
      continue;
    }

    // display math block
    if (ctx.opts.math && /^ {0,3}\$\$/.test(line)) {
      const first = line.trim().slice(2);
      let tex;
      if (first.includes("$$")) {
        tex = first.slice(0, first.indexOf("$$"));
        i++;
      } else {
        const buf = first.trim() ? [first] : [];
        i++;
        while (i < n && !lines[i].includes("$$")) buf.push(lines[i++]);
        if (i < n) {
          const before = lines[i].slice(0, lines[i].indexOf("$$"));
          if (before.trim()) buf.push(before);
          i++;
        }
        tex = buf.join("\n");
      }
      ctx.hasMath = true;
      push({ t: "math", text: tex.trim() }, start);
      continue;
    }

    // ATX heading
    let m = ATX_RE.exec(line);
    if (m) {
      let text = m[2];
      text = text.replace(/[ \t]+#+[ \t]*$/, "").replace(/^#+[ \t]*$/, "").trim();
      push({ t: "h", level: m[1].length, text }, start);
      i++;
      continue;
    }

    // thematic break
    if (HR_RE.test(line)) {
      push({ t: "hr" }, start);
      i++;
      continue;
    }

    // blockquote
    if (/^ {0,3}>/.test(line)) {
      const inner = [];
      let inFence = null;
      while (i < n) {
        const l = lines[i];
        if (/^ {0,3}>/.test(l)) {
          const stripped = l.replace(/^ {0,3}> ?/, "");
          inner.push(stripped);
          const fo = fenceOpen(stripped);
          if (inFence) {
            const cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(stripped);
            if (cm && cm[1][0] === inFence.ch && cm[1].length >= inFence.len) inFence = null;
          } else if (fo) inFence = fo;
          i++;
        } else if (!isBlank(l) && inner.length && !isBlank(inner[inner.length - 1]) && !inFence && !interruptsParagraph(l, ctx.opts) && lazyOk(inner[inner.length - 1])) {
          inner.push(l.trim());
          i++;
        } else break;
      }
      push({ t: "quote", children: parseBlocks(inner, ctx) }, start);
      continue;
    }

    // list
    const lm = listMarker(line);
    if (lm && (blocksAllowList(line, lm))) {
      const res = parseList(lines, i, lm, ctx);
      i = res.next;
      push(res.node, start);
      continue;
    }

    // HTML block
    const kind = htmlBlockKind(line, false);
    if (kind) {
      const buf = [];
      if (kind <= 5) {
        while (i < n) {
          buf.push(lines[i]);
          if (HTML_END[kind].test(lines[i]) && (i > start || HTML_END[kind].test(lines[i].replace(/^ {0,3}<[^>]*?(?:>|$)/, kind === 4 ? "" : "").length ? lines[i].slice(1) : lines[i]))) {
            i++;
            break;
          }
          i++;
        }
      } else {
        while (i < n && !isBlank(lines[i])) buf.push(lines[i++]);
      }
      push({ t: "html", text: buf.join("\n") }, start);
      continue;
    }

    // footnote definition
    m = FN_DEF_RE.exec(line);
    if (m && !ctx.opts.noFootnotes) {
      const id = m[1];
      const buf = [m[2]];
      i++;
      while (i < n) {
        if (isBlank(lines[i])) {
          let j = i;
          while (j < n && isBlank(lines[j])) j++;
          if (j < n && indentOf(lines[j]) >= 4) {
            for (; i < j; i++) buf.push("");
            continue;
          }
          break;
        }
        if (indentOf(lines[i]) >= 2 || (!interruptsParagraph(lines[i], ctx.opts) && !FN_DEF_RE.test(lines[i]) && !isBlank(buf[buf.length - 1]))) {
          buf.push(lines[i].replace(/^ {1,4}/, ""));
          i++;
        } else break;
      }
      if (!ctx.footnoteDefs.has(id)) ctx.footnoteDefs.set(id, { id, blocks: parseBlocks(buf, ctx), order: 0, used: false });
      blankBefore = false;
      continue;
    }

    // paragraph (with link reference definitions, setext headings and tables)
    {
      const para = [];
      let setext = 0;
      let tableAt = -1;
      while (i < n) {
        const l = lines[i];
        if (isBlank(l)) break;
        if (para.length) {
          const sm = /^ {0,3}(=+|-+)[ \t]*$/.exec(l);
          if (sm && indentOf(l) < 4) {
            setext = sm[1][0] === "=" ? 1 : 2;
            i++;
            break;
          }
          if (TABLE_DELIM_RE.test(l) && /\|/.test(para[para.length - 1] + l) && indentOf(l) < 4) {
            const head = splitCells(para[para.length - 1]);
            const delim = splitCells(l);
            if (head.length === delim.length && delim.every((c) => /^:?-+:?$/.test(c))) {
              tableAt = para.length - 1;
              break;
            }
          }
          if (indentOf(l) < 4 && interruptsParagraph(l, ctx.opts)) break;
          if (indentOf(l) < 4 && FN_DEF_RE.test(l) && false) break;
        }
        para.push(l.replace(/^[ \t]+/, ""));
        i++;
      }
      let text = para.join("\n");
      // link reference definitions at the start of the paragraph
      for (;;) {
        const d = REF_DEF_RE.exec(text);
        if (!d || /^\[\^/.test(d[0].trim())) break;
        const label = normLabel(d[1]);
        if (label && !ctx.refs.has(label)) {
          let dest = d[2];
          if (dest.startsWith("<") && dest.endsWith(">")) dest = dest.slice(1, -1);
          const title = d[3] ? unescapeMd(d[3].slice(1, -1)) : "";
          ctx.refs.set(label, { dest: unescapeMd(dest), title });
        }
        text = text.slice(d[0].length);
        if (tableAt >= 0) tableAt = Math.max(-1, tableAt - d[0].split("\n").length + 1);
      }
      if (tableAt >= 0) {
        const paraLines = text.split("\n").filter((_, idx, arr) => arr.length);
        const headLine = paraLines.pop();
        const before = paraLines.join("\n").trim();
        if (before) push({ t: "p", text: before.replace(/[ \t]+$/gm, "") }, start);
        // table: header, delimiter, rows
        const head = splitCells(headLine);
        const delim = splitCells(lines[i]);
        const align = delim.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
        i++;
        const rows = [];
        while (i < n && !isBlank(lines[i]) && !/^ {0,3}>/.test(lines[i]) && !fenceOpen(lines[i]) && !ATX_RE.test(lines[i]) && !HR_RE.test(lines[i])) {
          const cells = splitCells(lines[i]);
          while (cells.length < head.length) cells.push("");
          rows.push(cells.slice(0, head.length));
          i++;
        }
        push({ t: "table", align, head, rows }, start + para.length - 1);
        continue;
      }
      if (!text.trim()) continue; // the paragraph was only definitions
      text = text.replace(/[ \t]+$/gm, (s, off, str) => (str[off + s.length] === "\n" && s.length >= 2 ? s : "")).replace(/[ \t]+$/, "");
      if (setext) push({ t: "h", level: setext, text: text.trim() }, start);
      else push({ t: "p", text }, start);
    }
  }
  return blocks;
}

/** A line may start a list when the marker is followed by content or the list is not an empty item in a paragraph. */
function blocksAllowList() {
  return true;
}

/** Lazy continuation is only possible when the previous inner line is paragraph text (not a heading, rule, fence …). */
function lazyOk(prev) {
  return !(ATX_RE.test(prev) || HR_RE.test(prev) || fenceOpen(prev) || /^ {4,}\S/.test(prev));
}

function parseList(lines, from, first, ctx) {
  const n = lines.length;
  let i = from;
  const items = [];
  let loose = false;
  let gap = false;
  while (i < n) {
    const line = lines[i];
    const lm = listMarker(line);
    if (!lm || lm.ordered !== first.ordered || lm.ch !== first.ch || HR_RE.test(line)) break;
    if (items.length && gap) loose = true;
    gap = false;
    const W = lm.W;
    const buf = [line.slice(Math.min(W, line.length)).replace(/^ {0,0}/, "")];
    // when the content after the marker is indented code (>= 5 spaces), keep the extra spaces
    if (!lm.empty) {
      const afterMarker = line.slice(lm.W - (lm.W - lm.indent - (lm.ordered ? lm.digits.length + 1 : 1)));
      void afterMarker;
    }
    i++;
    let startedEmpty = lm.empty;
    let lastWasBlank = false;
    let inFence = null;
    const trackFence = (l) => {
      const body = l;
      if (inFence) {
        const cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body);
        if (cm && cm[1][0] === inFence.ch && cm[1].length >= inFence.len) inFence = null;
      } else {
        const fo = fenceOpen(body);
        if (fo) inFence = fo;
      }
    };
    trackFence(buf[0]);
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) {
        if (startedEmpty && buf.length === 1) break; // an item can begin with at most one blank line
        let j = i;
        while (j < n && isBlank(lines[j])) j++;
        if (j < n && indentOf(lines[j]) >= W) {
          for (; i < j; i++) buf.push("");
          lastWasBlank = true;
          continue;
        }
        break;
      }
      startedEmpty = false;
      if (indentOf(l) >= W) {
        const stripped = l.slice(W);
        buf.push(stripped);
        trackFence(stripped);
        lastWasBlank = false;
        i++;
        continue;
      }
      // lazy continuation of a paragraph
      if (!lastWasBlank && !inFence && !isBlank(buf[buf.length - 1]) && !interruptsParagraph(l, ctx.opts) && !listMarker(l) && lazyOk(buf[buf.length - 1]) && !FN_DEF_RE.test(l)) {
        buf.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    // trailing blank lines belong between items
    while (buf.length > 1 && isBlank(buf[buf.length - 1])) buf.pop();
    const children = parseBlocks(buf, ctx);
    for (let k = 1; k < children.length; k++) if (children[k].blankBefore) loose = true;
    // a blank line after the item before the next item
    let j = i;
    let blanks = 0;
    while (j < n && isBlank(lines[j])) {
      j++;
      blanks++;
    }
    if (blanks && j < n) {
      const nm = listMarker(lines[j]);
      if (nm && nm.ordered === first.ordered && nm.ch === first.ch && !HR_RE.test(lines[j])) {
        gap = true;
        i = j;
      }
    }
    // task list item
    let task = null;
    const c0 = children[0];
    if (c0 && c0.t === "p") {
      const tm = /^\[([ xX])\](?:[ \t]+|$)/.exec(c0.text);
      if (tm) {
        task = tm[1] !== " ";
        c0.text = c0.text.slice(tm[0].length);
      }
    }
    items.push({ children, task });
    if (!(blanks && gap)) {
      // continue only when the next line is another item of the same list
      if (i >= n) break;
    }
  }
  return { next: i, node: { t: "list", ordered: first.ordered, start: first.start, loose, items } };
}

// ------------------------------------------------------------------------------------------------ inline parser

function nodesToHtml(nodes, ctx) {
  let out = "";
  for (const nd of nodes) {
    if (nd.t === "html") out += nd.v;
    else if (nd.t === "text") out += escHtml(nd.v);
    else out += escHtml(nd.ch.repeat(nd.n));
  }
  return out;
}

function processEmphasis(nodes, from, ctx) {
  const bottoms = {};
  let ci = from;
  while (ci < nodes.length) {
    const c = nodes[ci];
    if (c.t !== "delim" || !c.canClose || c.n === 0) {
      ci++;
      continue;
    }
    const key = `${c.ch}${c.canOpen ? 1 : 0}${c.orig % 3}`;
    const bottom = bottoms[key] ?? from - 1;
    let found = -1;
    for (let oi = ci - 1; oi > bottom && oi >= from; oi--) {
      const o = nodes[oi];
      if (o.t !== "delim" || !o.canOpen || o.ch !== c.ch || o.n === 0) continue;
      if (c.ch === "~") {
        if (o.n === c.n && c.n <= 2) {
          found = oi;
          break;
        }
        continue;
      }
      const odd = (c.canOpen || o.canClose) && (o.orig + c.orig) % 3 === 0 && !(o.orig % 3 === 0 && c.orig % 3 === 0);
      if (!odd) {
        found = oi;
        break;
      }
    }
    if (found < 0) {
      bottoms[key] = ci - 1;
      ci++;
      continue;
    }
    const o = nodes[found];
    let use;
    let tag;
    if (c.ch === "~") {
      use = c.n;
      tag = "del";
    } else {
      use = c.n >= 2 && o.n >= 2 ? 2 : 1;
      tag = use === 2 ? "strong" : "em";
    }
    o.n -= use;
    c.n -= use;
    const inner = nodes.slice(found + 1, ci);
    const html = `<${tag}>${nodesToHtml(inner, ctx)}</${tag}>`;
    nodes.splice(found + 1, ci - found - 1, { t: "html", v: html });
    ci = found + 2;
    if (o.n === 0) {
      nodes.splice(found, 1);
      ci--;
    }
    if (c.n === 0) nodes.splice(ci, 1);
  }
}

/** Resolves a URL for output; returns null when the link/image must not be rendered. */
function outUrl(raw, kind, ctx) {
  let u = safeUrl(raw, kind);
  if (u === null) return null;
  if (ctx.opts.resolveUrl && u) u = ctx.opts.resolveUrl(u, kind);
  if (u === null) return null;
  return encodeUrl(u);
}

function parseLinkTail(src, i) {
  // expects src[i] === "(" ; returns { dest, title, end } or null
  let j = i + 1;
  const n = src.length;
  const skipWs = () => {
    while (j < n && /[ \t\n]/.test(src[j])) j++;
  };
  skipWs();
  let dest = "";
  if (src[j] === "<") {
    const e = /^<((?:[^<>\n\\]|\\.)*)>/.exec(src.slice(j));
    if (!e) return null;
    dest = e[1];
    j += e[0].length;
  } else {
    let depth = 0;
    const s = j;
    while (j < n) {
      const c = src[j];
      if (c === "\\" && j + 1 < n && /[!-/:-@[-`{-~]/.test(src[j + 1])) j += 2;
      else if (c === "(") {
        depth++;
        j++;
      } else if (c === ")") {
        if (depth === 0) break;
        depth--;
        j++;
      } else if (/[\s\u0000-\u001f]/.test(c)) break;
      else j++;
    }
    if (depth !== 0) return null;
    dest = src.slice(s, j);
  }
  const beforeTitle = j;
  skipWs();
  let title = "";
  if (j > beforeTitle && /["'(]/.test(src[j] || "")) {
    const open = src[j];
    const close = open === "(" ? ")" : open;
    let k = j + 1;
    let ok = false;
    while (k < n) {
      if (src[k] === "\\") k += 2;
      else if (src[k] === close) {
        ok = true;
        break;
      } else k++;
    }
    if (!ok) return null;
    title = unescapeMd(src.slice(j + 1, k));
    j = k + 1;
    skipWs();
  }
  if (src[j] !== ")") return null;
  return { dest: unescapeMd(dest), title, end: j + 1 };
}

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const AUTOLINK_RE = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const EMAIL_RE = /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
const INLINE_HTML_RE = /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--[\s\S]*?-->)/;

function parseInline(src, ctx, noLinks = false) {
  const nodes = [];
  const brackets = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ t: "text", v: buf });
      buf = "";
    }
  };
  const n = src.length;
  let i = 0;
  let delims = 0;
  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      const nx = src[i + 1];
      if (nx === "\n") {
        flush();
        nodes.push({ t: "html", v: "<br>\n" });
        i += 2;
        while (src[i] === " " || src[i] === "\t") i++;
      } else if (nx !== undefined && ESCAPABLE.test(nx)) {
        buf += nx;
        i += 2;
      } else {
        buf += c;
        i++;
      }
    } else if (c === "`") {
      let j = i;
      while (src[j] === "`") j++;
      const len = j - i;
      let k = j;
      let found = -1;
      while (k < n) {
        const p = src.indexOf("`", k);
        if (p < 0) break;
        let q = p;
        while (src[q] === "`") q++;
        if (q - p === len) {
          found = p;
          break;
        }
        k = q;
      }
      if (found < 0) {
        buf += src.slice(i, j);
        i = j;
      } else {
        flush();
        let code = src.slice(j, found).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
        nodes.push({ t: "html", v: `<code>${escHtml(code)}</code>` });
        i = found + len;
      }
    } else if (c === "$" && ctx.opts.math) {
      const m = /^\$\$([^\n]|\n(?!\n))+?\$\$/.exec(src.slice(i, i + 4000)) || /^\$(?!\s)((?:[^$\\\n]|\\.|\n(?!\n))+?)(?<!\s)\$(?!\d)/.exec(src.slice(i, i + 4000));
      if (m && (i === 0 || !/[\w$\\]/.test(src[i - 1]) || src[i - 1] === " ")) {
        flush();
        const display = m[0].startsWith("$$");
        const tex = display ? m[0].slice(2, -2) : m[1];
        ctx.hasMath = true;
        nodes.push({ t: "html", v: mathHtml(tex.trim(), display) });
        i += m[0].length;
      } else {
        buf += c;
        i++;
      }
    } else if (c === "*" || c === "_" || c === "~") {
      let j = i;
      while (src[j] === c) j++;
      const len = j - i;
      if (c === "~" && len > 2) {
        buf += src.slice(i, j);
        i = j;
        continue;
      }
      const before = i === 0 ? "\n" : src[i - 1];
      const after = j >= n ? "\n" : src[j];
      const bws = isWs(before);
      const aws = isWs(after);
      const bp = isPunct(before);
      const ap = isPunct(after);
      const left = !aws && (!ap || bws || bp);
      const right = !bws && (!bp || aws || ap);
      const canOpen = c === "_" ? left && (!right || bp) : left;
      const canClose = c === "_" ? right && (!left || ap) : right;
      flush();
      nodes.push({ t: "delim", ch: c, n: len, orig: len, canOpen, canClose });
      delims++;
      i = j;
    } else if (c === "[" || (c === "!" && src[i + 1] === "[")) {
      // footnote reference
      if (c === "[" && src[i + 1] === "^" && !ctx.opts.noFootnotes) {
        const m = /^\[\^([^\]\s]+)\]/.exec(src.slice(i, i + 200));
        if (m && ctx.footnoteDefs.has(m[1])) {
          flush();
          nodes.push({ t: "html", v: footnoteRef(m[1], ctx) });
          i += m[0].length;
          continue;
        }
      }
      const image = c === "!";
      flush();
      nodes.push({ t: "text", v: image ? "![" : "[" });
      brackets.push({ idx: nodes.length - 1, image, active: true });
      i += image ? 2 : 1;
    } else if (c === "]") {
      const op = brackets.pop();
      if (!op) {
        buf += c;
        i++;
        continue;
      }
      flush();
      if (!op.active) {
        nodes.push({ t: "text", v: "]" });
        i++;
        continue;
      }
      const innerSrcFrom = op.idx;
      // inline link / image
      let dest = null;
      let title = "";
      let end = i + 1;
      if (src[i + 1] === "(") {
        const tail = parseLinkTail(src, i + 1);
        if (tail) {
          dest = tail.dest;
          title = tail.title;
          end = tail.end;
        }
      }
      if (dest === null) {
        // reference link: [text][label], [text][] or [text]
        let label = null;
        const rm = ctx.refs.size ? /^\[((?:[^[\]\\]|\\.){0,999})\]/.exec(src.slice(i + 1, i + 1100)) : null;
        if (!ctx.refs.size) label = null;
        else if (rm && rm[1].trim() !== "") {
          label = rm[1];
          end = i + 1 + rm[0].length;
        } else {
          // collapsed or shortcut: the label is the text between the brackets
          let textSrc = "";
          for (let k = innerSrcFrom; k < nodes.length && textSrc.length < 1000; k++) textSrc += nodes[k].t === "delim" ? nodes[k].ch.repeat(nodes[k].orig) : nodes[k].t === "text" ? nodes[k].v : "";
          textSrc = textSrc.slice(op.image ? 2 : 1);
          label = textSrc;
          end = rm ? i + 1 + rm[0].length : i + 1;
        }
        const ref = label === null ? null : ctx.refs.get(normLabel(label));
        if (ref) {
          dest = ref.dest;
          title = ref.title;
        }
      }
      if (dest === null) {
        nodes.push({ t: "text", v: "]" });
        i++;
        continue;
      }
      // build the link / image
      const innerNodes = nodes.splice(op.idx + 1);
      nodes.splice(op.idx, 1); // the "[" / "![" text node
      processEmphasis(innerNodes, 0, ctx);
      let innerHtml = nodesToHtml(innerNodes, ctx);
      let html;
      if (op.image) {
        const alt = decodeAll(stripTags(innerHtml));
        const url = outUrl(dest, "image", ctx);
        html = url === null ? `<span class="md-missing-image">${escHtml(alt || "image")}</span>` : `<img src="${escHtml(url)}" alt="${escHtml(alt)}"${title ? ` title="${escHtml(title)}"` : ""} loading="lazy">`;
      } else {
        const url = noLinks ? null : outUrl(dest, "link", ctx);
        if (url === null) html = innerHtml;
        else {
          const ext = /^(?:https?:)?\/\//i.test(url) && ctx.opts.externalLinkAttrs !== false;
          html = `<a href="${escHtml(url)}"${title ? ` title="${escHtml(title)}"` : ""}${ext ? ' rel="noopener noreferrer"' : ""}>${innerHtml}</a>`;
        }
        for (const b of brackets) if (!b.image) b.active = false;
      }
      nodes.push({ t: "html", v: html });
      // brackets inside the removed range no longer exist
      while (brackets.length && brackets[brackets.length - 1].idx >= nodes.length) brackets.pop();
      i = end;
    } else if (c === "<") {
      const rest = src.slice(i, i + 2000);
      let m;
      if (!noLinks && (m = AUTOLINK_RE.exec(rest))) {
        const url = outUrl(unescapeMd(m[1]), "link", ctx);
        flush();
        nodes.push({ t: "html", v: url === null ? escHtml(m[0]) : `<a href="${escHtml(url)}">${escHtml(m[1])}</a>` });
        i += m[0].length;
      } else if (!noLinks && (m = EMAIL_RE.exec(rest))) {
        flush();
        nodes.push({ t: "html", v: `<a href="mailto:${escHtml(m[1])}">${escHtml(m[1])}</a>` });
        i += m[0].length;
      } else if ((m = INLINE_HTML_RE.exec(rest))) {
        flush();
        const name = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(m[0]);
        if (ctx.opts.mdx && name && /^[A-Z]/.test(name[1])) nodes.push({ t: "html", v: `<span class="md-jsx" title="JSX is not executed">${escHtml(m[0])}</span>` });
        else nodes.push({ t: "html", v: sanitizeHtml(m[0], { resolveUrl: ctx.opts.resolveUrl }) });
        i += m[0].length;
      } else {
        buf += c;
        i++;
      }
    } else if (c === "&") {
      const e = entityAt(src.slice(i, i + 40));
      if (e) {
        buf += e.text;
        i += e.length;
      } else {
        buf += c;
        i++;
      }
    } else if (c === "\n") {
      const hard = / {2,}$/.test(buf) || /\t$/.test(buf) && false;
      buf = buf.replace(/[ \t]+$/, "");
      flush();
      nodes.push({ t: "html", v: hard || ctx.opts.breaks ? "<br>\n" : "\n" });
      i++;
      while (src[i] === " " || src[i] === "\t") i++;
    } else if (!noLinks && (c === "h" || c === "w") && (i === 0 || /[\s(*_~]/.test(src[i - 1]) || (nodes.length && nodes[nodes.length - 1].t === "delim" && !buf))) {
      const m = /^(?:https?:\/\/|www\.)[^\s<]+/.exec(src.slice(i, i + 2000));
      if (m && /^(?:https?:\/\/[^\s/?#.]+\.|https?:\/\/localhost|www\.[^\s/?#.]+\.)/i.test(m[0]) ) {
        let url = m[0];
        // trailing punctuation is not part of the URL; unbalanced ")" is dropped
        for (;;) {
          const t = url[url.length - 1];
          if (/[?!.,:;*_~'"]/.test(t)) url = url.slice(0, -1);
          else if (t === ")" && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
          else break;
        }
        const href = outUrl(url.startsWith("www.") ? `http://${url}` : url, "link", ctx);
        if (href !== null && url.length > 7) {
          flush();
          nodes.push({ t: "html", v: `<a href="${escHtml(href)}" rel="noopener noreferrer">${escHtml(url)}</a>` });
          i += url.length;
          continue;
        }
      }
      buf += c;
      i++;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  if (delims && delims < 4000) processEmphasis(nodes, 0, ctx);
  return nodesToHtml(nodes, ctx);
}

function mathHtml(tex, display) {
  const e = escHtml(tex);
  return display
    ? `<span class="tex-math tex-display" data-display="true" data-tex="${e}">${e}</span>`
    : `<span class="tex-math" data-display="false" data-tex="${e}">${e}</span>`;
}

function footnoteRef(id, ctx) {
  const def = ctx.footnoteDefs.get(id);
  if (!def.order) {
    def.order = ++ctx.footnoteCount;
    ctx.footnoteQueue.push(def);
  }
  def.refs = (def.refs || 0) + 1;
  const prefix = ctx.opts.idPrefix;
  const slug = escHtml(slugify(id) === "section" ? id.replace(/[^\w-]/g, "") || String(def.order) : slugify(id));
  def.slug = slug;
  const refId = def.refs === 1 ? `${prefix}fnref-${slug}` : `${prefix}fnref-${slug}-${def.refs}`;
  return `<sup class="footnote-ref"><a href="#${prefix}fn-${slug}" id="${refId}">${def.order}</a></sup>`;
}

// ------------------------------------------------------------------------------------------------ renderer

function renderInline(text, ctx) {
  return balanceHtml(parseInline(text, ctx));
}

function uniqueId(base, ctx) {
  const prefix = ctx.opts.idPrefix;
  const used = ctx.ids;
  let id = `${prefix}${base}`;
  let k = 1;
  while (used.has(id)) id = `${prefix}${base}-${++k}`;
  used.add(id);
  return id;
}

function renderBlocks(blocks, ctx, tightParent = false) {
  let out = "";
  for (const b of blocks) out += renderBlock(b, ctx, tightParent);
  return out;
}

function lineAttr(b, ctx) {
  return ctx.opts.lineMarkers && b.line ? ` data-line="${b.line}"` : "";
}

function renderBlock(b, ctx, tight) {
  const la = lineAttr(b, ctx);
  switch (b.t) {
    case "p": {
      const html = renderInline(b.text, ctx);
      return tight ? `${html}\n` : `<p${la}>${html}</p>\n`;
    }
    case "h": {
      let text = b.text;
      let explicit = null;
      const em = /\s+\{#([A-Za-z][\w:.-]*)\}\s*$/.exec(text);
      if (em) {
        explicit = em[1];
        text = text.slice(0, em.index);
      }
      const html = renderInline(text, ctx);
      const plain = decodeAll(stripTags(html)).trim();
      let id = "";
      if (ctx.opts.headingIds !== false) {
        const base = explicit || slugify(plain);
        id = uniqueId(base, ctx);
      }
      ctx.headings.push({ level: b.level, text: plain, id, line: b.line || 0 });
      return `<h${b.level}${id ? ` id="${escHtml(id)}"` : ""}${la}>${html}</h${b.level}>\n`;
    }
    case "hr":
      return `<hr${la}>\n`;
    case "code": {
      const lang = b.info.split(/\s+/)[0];
      const code = b.text;
      if (ctx.opts.math && /^(math|latex|tex)$/i.test(lang) && lang.toLowerCase() === "math") {
        ctx.hasMath = true;
        return `<div class="tex-math tex-display" data-display="true" data-tex="${escHtml(code)}"${la}>${escHtml(code)}</div>\n`;
      }
      const id = languageId(lang);
      const body = ctx.opts.highlight !== false && id ? highlight(code, lang) : escapeCode(code);
      return `<pre class="md-code"${lang ? ` data-lang="${escHtml(lang)}"` : ""}${la}><code${lang ? ` class="language-${escHtml(lang.replace(/[^\w+#.-]/g, ""))}"` : ""}>${body}${code ? "\n" : ""}</code></pre>\n`;
    }
    case "math":
      return `<div class="tex-math tex-display" data-display="true" data-tex="${escHtml(b.text)}"${la}>${escHtml(b.text)}</div>\n`;
    case "quote":
      return `<blockquote${la}>\n${renderBlocks(b.children, ctx)}</blockquote>\n`;
    case "html": {
      if (ctx.opts.mdx && /^\s*<[A-Z]/.test(b.text)) return `<div class="md-jsx" title="JSX is not executed"${la}>${escHtml(b.text.trim())}</div>\n`;
      return `${sanitizeHtml(b.text, { resolveUrl: ctx.opts.resolveUrl })}\n`;
    }
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const isTask = b.items.some((it) => it.task !== null);
      const attrs = `${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ""}${isTask ? ' class="task-list"' : ""}${la}`;
      let out = `<${tag}${attrs}>\n`;
      for (const it of b.items) {
        const tightItem = !b.loose;
        let inner = "";
        let content = renderBlocks(it.children, ctx, tightItem);
        if (it.task !== null) {
          const box = `<input type="checkbox" disabled${it.task ? " checked" : ""}> `;
          content = tightItem || !it.children.length || it.children[0].t !== "p" ? box + content : content.replace(/^<p([^>]*)>/, `<p$1>${box}`);
        }
        inner = tightItem ? content.replace(/\n$/, "") : `\n${content}`;
        out += `<li${it.task !== null ? ' class="task-list-item"' : ""}>${inner}</li>\n`;
      }
      return `${out}</${tag}>\n`;
    }
    case "table": {
      const cell = (tag, text, i) => `<${tag}${b.align[i] ? ` style="text-align:${b.align[i]}"` : ""}>${renderInline(text, ctx)}</${tag}>`;
      let out = `<table${la}>\n<thead>\n<tr>${b.head.map((c, i) => cell("th", c, i)).join("")}</tr>\n</thead>\n`;
      if (b.rows.length) out += `<tbody>\n${b.rows.map((r) => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`).join("\n")}\n</tbody>\n`;
      return `${out}</table>\n`;
    }
    default:
      return "";
  }
}

function plainTextOf(html) {
  return decodeAll(stripTags(html)).replace(/\s+/g, " ").trim();
}

/**
 * Renders Markdown to a sanitized HTML fragment.
 * @param {string} source
 * @param {MarkdownOptions} [options]
 * @returns {MarkdownResult}
 */
export function renderMarkdown(source, options = {}) {
  const opts = { idPrefix: "md-", ...options };
  let text = String(source ?? "").replace(/^﻿/, "");
  const fm = parseFrontMatter(text);
  text = fm.body;
  let lineBase = fm.lines;
  let lines = text.replace(/\r\n?/g, "\n").split("\n").map(expandTabs);
  if (opts.mdx) {
    // drop top-level import/export statements (outside code fences), keeping line numbers stable
    let fence = null;
    let dropping = false;
    lines = lines.map((l) => {
      const f = fenceOpen(l);
      if (fence) {
        const cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
        if (cm && cm[1][0] === fence.ch && cm[1].length >= fence.len) fence = null;
        return l;
      }
      if (f) {
        fence = f;
        return l;
      }
      if (/^(import|export)\s/.test(l) || (dropping && !isBlank(l))) {
        dropping = true;
        return "";
      }
      dropping = false;
      return l;
    });
  }
  const ctx = {
    opts,
    refs: new Map(),
    footnoteDefs: new Map(),
    footnoteQueue: [],
    footnoteCount: 0,
    headings: [],
    ids: new Set(),
    hasMath: false,
  };
  const blocks = parseBlocks(lines, ctx, true, lineBase);
  let html = "";
  if (opts.frontMatter === "table" && Object.keys(fm.meta).length) {
    const rows = Object.entries(fm.meta).map(([k, v]) => `<tr><th>${escHtml(k)}</th><td>${escHtml(Array.isArray(v) ? v.join(", ") : typeof v === "object" && v ? JSON.stringify(v) : String(v))}</td></tr>`);
    html += `<table class="md-frontmatter"><tbody>${rows.join("")}</tbody></table>\n`;
  }
  html += renderBlocks(blocks, ctx);
  if (ctx.footnoteQueue.length) {
    let items = "";
    for (let k = 0; k < ctx.footnoteQueue.length; k++) {
      const def = ctx.footnoteQueue[k];
      let body = renderBlocks(def.blocks, ctx);
      const prefix = opts.idPrefix;
      let back = "";
      for (let r = 1; r <= (def.refs || 1); r++) back += ` <a class="footnote-backref" href="#${prefix}fnref-${def.slug}${r > 1 ? `-${r}` : ""}" aria-label="Back to reference ${def.order}">↩</a>`;
      body = /<\/p>\n$/.test(body) ? body.replace(/<\/p>\n$/, `${back}</p>\n`) : `${body}<p>${back.trim()}</p>\n`;
      items += `<li id="${prefix}fn-${def.slug}">\n${body}</li>\n`;
    }
    html += `<section class="footnotes" role="doc-endnotes">\n<hr>\n<ol>\n${items}</ol>\n</section>\n`;
  }
  html = balanceHtml(html);
  const h1 = ctx.headings.find((h) => h.level === 1);
  const title = typeof fm.meta.title === "string" && fm.meta.title ? fm.meta.title : h1 ? h1.text : "";
  const words = (plainTextOf(html).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  return { html, headings: ctx.headings, meta: fm.meta, title, hasMath: ctx.hasMath, words, footnotes: ctx.footnoteCount };
}

// ------------------------------------------------------------------------------------------------ standalone page

/** CSS of the standalone page: readable typography in light and dark, and print rules for PDF export. */
export const MARKDOWN_PAGE_CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--soft:#f6f8fa;--link:#0969da;--code-bg:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--border:#3d444d;--soft:#151b23;--link:#4493f8;--code-bg:#151b23}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:46rem;margin:0 auto;padding:3rem 1.25rem 5rem}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:2em 0 .6em}
h1{font-size:2.1em;margin-top:0;padding-bottom:.3em;border-bottom:1px solid var(--border)}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
h3{font-size:1.25em}h4{font-size:1em}h5,h6{font-size:.9em;color:var(--muted)}
p,ul,ol,blockquote,pre,table,details,figure{margin:0 0 1em}
a{color:var(--link)}
img{max-width:100%;height:auto}
code{font:.9em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code-bg);padding:.15em .35em;border-radius:6px}
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:1em;overflow:auto;line-height:1.45}
pre code{background:none;padding:0;border-radius:0;font-size:.875em}
blockquote{margin-left:0;padding:0 1em;color:var(--muted);border-left:.25em solid var(--border)}
table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}
th,td{border:1px solid var(--border);padding:.4em .8em}
th{background:var(--soft)}
tr:nth-child(2n) td{background:color-mix(in srgb,var(--soft) 55%,transparent)}
hr{border:0;border-top:1px solid var(--border);margin:2em 0}
ul.task-list,.task-list-item{list-style:none}
ul.task-list{padding-left:1.4em}
.task-list-item input{margin:0 .5em .15em -1.4em;vertical-align:middle}
.footnotes{font-size:.9em;color:var(--muted)}
.footnotes hr{margin:2.5em 0 1em}
sup.footnote-ref{font-size:.75em}
.tex-display{display:block;text-align:center;margin:1em 0;overflow-x:auto}
.tok-comment{color:#6e7781;font-style:italic}.tok-keyword,.tok-tag{color:#cf222e}.tok-string,.tok-attributeName{color:#0a3069}.tok-number,.tok-atom{color:#0550ae}.tok-function,.tok-typeName,.tok-propertyName{color:#8250df}.tok-variable{color:#953800}.tok-inserted{color:#116329;background:#dafbe1}.tok-deleted{color:#82071e;background:#ffebe9}
@media (prefers-color-scheme:dark){.tok-comment{color:#8b949e}.tok-keyword,.tok-tag{color:#ff7b72}.tok-string,.tok-attributeName{color:#a5d6ff}.tok-number,.tok-atom{color:#79c0ff}.tok-function,.tok-typeName,.tok-propertyName{color:#d2a8ff}.tok-variable{color:#ffa657}.tok-inserted{color:#7ee787;background:#0f2d17}.tok-deleted{color:#ffa198;background:#3c1618}}
@page{margin:18mm}
@media print{:root{--bg:#fff;--fg:#000;--muted:#333;--border:#bbb;--soft:#f2f2f2;--link:#000;--code-bg:#f2f2f2}body{font-size:11pt}main{max-width:none;padding:0}h1,h2,h3{break-after:avoid}pre,table,figure,blockquote{break-inside:avoid}a{text-decoration:none}a[href^="http"]::after{content:" (" attr(href) ")";font-size:.8em;color:#444}pre{white-space:pre-wrap}}`;

/**
 * A complete, self-contained HTML page for a rendered document (also the "PDF-ready" page: it has print rules).
 * @param {{ html: string, title?: string, lang?: string, css?: string, head?: string }} page
 * @returns {string}
 */
export function buildDocumentPage({ html, title = "Document", lang = "en-US", css = MARKDOWN_PAGE_CSS, head = "" }) {
  return `<!doctype html>\n<html lang="${escHtml(lang)}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escHtml(title)}</title>\n<style>\n${css}\n</style>\n${head}</head>\n<body>\n<main>\n${html}</main>\n</body>\n</html>\n`;
}
