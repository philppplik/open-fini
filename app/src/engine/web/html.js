// Offset-preserving, error tolerant HTML parser for the Code studio. See docs/web-engine.md.
//
// This is a *source parser*, not an HTML5 tree builder: it never inserts implied <html>/<head>/<body>/<tbody>
// elements, because every node maps to real source text. Every range slices back to the exact source text.

/**
 * @typedef {{ severity: 'error'|'warning'|'info', code: string, message: string, start: number, end: number }} Diagnostic
 * @typedef {{ name: string, value: string|null, start: number, end: number, valueStart: number, valueEnd: number,
 *   quote: '"'|"'"|''|null, unterminated?: boolean }} Attr
 * @typedef {{ type: 'element', id: number, tag: string, attrs: Attr[], children: HtmlNode[], parent: ElementNode|null,
 *   start: number, end: number, open: {start:number,end:number}, close: {start:number,end:number}|null,
 *   void: boolean, selfClosing: boolean, depth: number, index: number }} ElementNode
 * @typedef {{ type: 'text', start: number, end: number, text: string }} TextNode
 * @typedef {{ type: 'comment', start: number, end: number }} CommentNode
 * @typedef {{ type: 'doctype', start: number, end: number }} DoctypeNode
 * @typedef {ElementNode|TextNode|CommentNode|DoctypeNode} HtmlNode
 * @typedef {{ source: string, children: HtmlNode[], elements: ElementNode[], errors: Diagnostic[] }} ParsedHtml
 */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style"]);
const ESCAPABLE_RAW = new Set(["textarea", "title"]);
const OPTIONAL_END = new Set([
  "p", "li", "dt", "dd", "tr", "td", "th", "option", "optgroup", "thead", "tbody", "tfoot", "rt", "rp", "colgroup", "caption",
  "html", "head", "body",
]);
const DEPRECATED = new Set(["font", "center", "marquee", "blink"]);

/** Boolean attributes of HTML (written as a bare name). */
export const BOOLEAN_ATTRS = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate",
  "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly",
  "required", "reversed", "selected",
]);

const P_CLOSERS = [
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
];
const set = (...a) => new Set(a);
/** start tag -> { closes: tags an open element of which is closed implicitly, stop: scope boundaries } */
const IMPLIED = new Map();
for (const t of P_CLOSERS) IMPLIED.set(t, { closes: set("p"), stop: set("button", "table", "td", "th", "caption", "marquee", "object", "template", "svg", "math") });
IMPLIED.set("li", { closes: set("li"), stop: set("ul", "ol", "menu") });
IMPLIED.set("dt", { closes: set("dt", "dd"), stop: set("dl") });
IMPLIED.set("dd", { closes: set("dt", "dd"), stop: set("dl") });
IMPLIED.set("tr", { closes: set("tr"), stop: set("table", "thead", "tbody", "tfoot") });
IMPLIED.set("td", { closes: set("td", "th"), stop: set("tr", "table") });
IMPLIED.set("th", { closes: set("td", "th"), stop: set("tr", "table") });
for (const t of ["thead", "tbody", "tfoot"]) IMPLIED.set(t, { closes: set("thead", "tbody", "tfoot"), stop: set("table") });
IMPLIED.set("option", { closes: set("option"), stop: set("select", "datalist", "optgroup") });
IMPLIED.set("optgroup", { closes: set("optgroup"), stop: set("select") });
IMPLIED.set("rt", { closes: set("rt", "rp"), stop: set("ruby") });
IMPLIED.set("rp", { closes: set("rt", "rp"), stop: set("ruby") });
IMPLIED.set("body", { closes: set("head"), stop: set("html") });

const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/**
 * @param {string} tag
 * @returns {boolean}
 */
export function isVoidTag(tag) {
  return VOID.has(String(tag).toLowerCase());
}

/**
 * True for elements whose content is raw text (script, style, textarea, title).
 * @param {string} tag
 * @returns {boolean}
 */
export function isRawTextTag(tag) {
  return RAW_TEXT.has(tag) || ESCAPABLE_RAW.has(tag);
}

/**
 * Finds the end tag of a raw text element (case-insensitive). Returns -1 when absent.
 * @param {string} s
 * @param {string} tag lower-case
 * @param {number} from
 */
function findRawClose(s, tag, from) {
  const n = s.length;
  let i = s.indexOf("</", from);
  while (i >= 0) {
    if (s.substr(i + 2, tag.length).toLowerCase() === tag) {
      const c = i + 2 + tag.length < n ? s.charCodeAt(i + 2 + tag.length) : 62;
      if (isWs(c) || c === 47 || c === 62) return i;
    }
    i = s.indexOf("</", i + 2);
  }
  return -1;
}

/**
 * Parses HTML into an offset-preserving tree. Never throws.
 * @param {string} source
 * @returns {ParsedHtml}
 */
export function parseHtml(source) {
  const s = String(source ?? "");
  const n = s.length;
  /** @type {HtmlNode[]} */
  const root = [];
  /** @type {ElementNode[]} */
  const elements = [];
  /** @type {Diagnostic[]} */
  const errors = [];
  /** @type {ElementNode[]} */
  const stack = [];
  /** @type {number[]} element-sibling counters: counts[0] for the root, counts[k+1] for stack[k] */
  const counts = [0];
  let foreign = 0;
  let pending = 0;
  /** @type {Map<string, number>} number of currently open elements per tag (keeps stray/implied lookups O(1)) */
  const openTags = new Map();
  const bump = (tag, d) => openTags.set(tag, (openTags.get(tag) || 0) + d);
  const anyOpen = (tags) => {
    for (const t of tags) if (openTags.get(t)) return true;
    return false;
  };
  let sawHtml = null;
  let sawDoctype = false;
  const ids = new Map();

  const diag = (severity, code, message, start, end) => errors.push({ severity, code, message, start, end });
  const listOf = () => (stack.length ? stack[stack.length - 1].children : root);
  const flushText = (upTo) => {
    if (upTo > pending) listOf().push({ type: "text", start: pending, end: upTo, text: s.slice(pending, upTo) });
  };
  /** Pops the top element because of an implied end at offset `at`. */
  const popImplied = (at) => {
    const el = stack.pop();
    counts.pop();
    bump(el.tag, -1);
    el.end = at;
    if (el.tag === "svg" || el.tag === "math") foreign--;
    if (!OPTIONAL_END.has(el.tag)) {
      diag("error", "html/unclosed", `The <${el.tag}> element is never closed.`, el.open.start, el.open.end);
    }
  };

  let i = 0;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;
    const c1 = lt + 1 < n ? s.charCodeAt(lt + 1) : 0;

    // ---- comments, doctype, CDATA, processing instructions
    if (c1 === 33 /* ! */) {
      flushText(lt);
      if (s.startsWith("<!--", lt)) {
        let end;
        if (s.startsWith(">", lt + 4)) end = lt + 5;
        else if (s.startsWith("->", lt + 4)) end = lt + 6;
        else {
          const e = s.indexOf("-->", lt + 4);
          if (e < 0) {
            end = n;
            diag("error", "html/unclosed-comment", "This comment is never closed.", lt, n);
          } else end = e + 3;
        }
        listOf().push({ type: "comment", start: lt, end });
        pending = i = end;
        continue;
      }
      if (s.substr(lt, 9).toLowerCase() === "<!doctype") {
        const e = s.indexOf(">", lt + 2);
        const end = e < 0 ? n : e + 1;
        listOf().push({ type: "doctype", start: lt, end });
        sawDoctype = true;
        pending = i = end;
        continue;
      }
      let end;
      if (s.startsWith("<![CDATA[", lt)) {
        const e = s.indexOf("]]>", lt + 9);
        end = e < 0 ? n : e + 3;
      } else {
        const e = s.indexOf(">", lt + 2);
        end = e < 0 ? n : e + 1;
      }
      listOf().push({ type: "comment", start: lt, end });
      pending = i = end;
      continue;
    }
    if (c1 === 63 /* ? */) {
      flushText(lt);
      const e = s.indexOf(">", lt + 2);
      const end = e < 0 ? n : e + 1;
      listOf().push({ type: "comment", start: lt, end });
      pending = i = end;
      continue;
    }

    // ---- end tag
    if (c1 === 47 /* / */) {
      if (!(lt + 2 < n && isAlpha(s.charCodeAt(lt + 2)))) {
        i = lt + 2;
        continue; // text
      }
      flushText(lt);
      let p = lt + 2;
      while (p < n) {
        const d = s.charCodeAt(p);
        if (isWs(d) || d === 47 || d === 62) break;
        p++;
      }
      const tag = s.slice(lt + 2, p).toLowerCase();
      const gt = s.indexOf(">", p);
      const end = gt < 0 ? n : gt + 1;
      if (gt < 0) diag("error", "html/unterminated-tag", `The </${tag}> end tag is not terminated.`, lt, n);
      let k = openTags.get(tag) ? stack.length - 1 : -1;
      while (k >= 0 && stack[k].tag !== tag) k--;
      if (k < 0) {
        diag("error", "html/stray-end-tag", `Stray end tag </${tag}>: no matching <${tag}> is open.`, lt, end);
      } else {
        while (stack.length - 1 > k) popImplied(lt);
        const el = stack.pop();
        counts.pop();
        bump(tag, -1);
        el.close = { start: lt, end };
        el.end = end;
        if (tag === "svg" || tag === "math") foreign--;
      }
      pending = i = end;
      continue;
    }

    // ---- start tag
    if (!isAlpha(c1)) {
      i = lt + 1;
      continue; // a literal '<' in text
    }
    flushText(lt);
    let p = lt + 1;
    while (p < n) {
      const d = s.charCodeAt(p);
      if (isWs(d) || d === 47 || d === 62) break;
      p++;
    }
    const tagRaw = s.slice(lt + 1, p);
    const tag = tagRaw.toLowerCase();
    const attrs = [];
    let selfClosing = false;
    let terminated = true;
    for (;;) {
      while (p < n && isWs(s.charCodeAt(p))) p++;
      if (p >= n) {
        terminated = false;
        break;
      }
      const c = s.charCodeAt(p);
      if (c === 62) {
        p++;
        break;
      }
      if (c === 47) {
        if (s.charCodeAt(p + 1) === 62) {
          selfClosing = true;
          p += 2;
          break;
        }
        p++;
        continue;
      }
      const ns = p++;
      while (p < n) {
        const d = s.charCodeAt(p);
        if (isWs(d) || d === 61 || d === 47 || d === 62) break;
        p++;
      }
      const ne = p;
      const name = s.slice(ns, ne).toLowerCase();
      let q = p;
      while (q < n && isWs(s.charCodeAt(q))) q++;
      if (q < n && s.charCodeAt(q) === 61) {
        q++;
        while (q < n && isWs(s.charCodeAt(q))) q++;
        const qc = q < n ? s.charCodeAt(q) : 0;
        if (qc === 34 || qc === 39) {
          const quote = qc === 34 ? '"' : "'";
          const close = s.indexOf(quote, q + 1);
          if (close < 0) {
            let gt = s.indexOf(">", q + 1);
            if (gt < 0) gt = n;
            attrs.push({ name, value: s.slice(q + 1, gt), start: ns, end: gt, valueStart: q + 1, valueEnd: gt, quote, unterminated: true });
            diag("error", "html/unterminated-attribute", `The value of "${name}" is missing its closing quote.`, ns, gt);
            p = gt;
          } else {
            attrs.push({ name, value: s.slice(q + 1, close), start: ns, end: close + 1, valueStart: q + 1, valueEnd: close, quote });
            p = close + 1;
          }
        } else if (q >= n || qc === 62) {
          attrs.push({ name, value: "", start: ns, end: q, valueStart: q, valueEnd: q, quote: "" });
          p = q;
        } else {
          let r = q;
          while (r < n && !isWs(s.charCodeAt(r)) && s.charCodeAt(r) !== 62) r++;
          attrs.push({ name, value: s.slice(q, r), start: ns, end: r, valueStart: q, valueEnd: r, quote: "" });
          p = r;
        }
      } else {
        attrs.push({ name, value: null, start: ns, end: ne, valueStart: ne, valueEnd: ne, quote: null });
        p = ne;
      }
    }
    const openEnd = p;
    if (!terminated) diag("error", "html/unterminated-tag", `The <${tag}> start tag is not terminated.`, lt, n);

    // implied end tags caused by this start tag
    const rule = IMPLIED.get(tag);
    if (rule && stack.length && anyOpen(rule.closes)) {
      for (let k = stack.length - 1, steps = 0; k >= 0 && steps < 256; k--, steps++) {
        const t = stack[k].tag;
        if (rule.closes.has(t)) {
          while (stack.length > k) popImplied(lt);
          break;
        }
        if (rule.stop.has(t)) break;
      }
    }

    const parent = stack.length ? stack[stack.length - 1] : null;
    const idx = counts[counts.length - 1]++;
    const isVoid = VOID.has(tag);
    /** @type {ElementNode} */
    const el = {
      type: "element", id: elements.length, tag, attrs, children: [], parent, start: lt, end: openEnd,
      open: { start: lt, end: openEnd }, close: null, void: isVoid, selfClosing: selfClosing && !isVoid, depth: stack.length, index: idx,
    };
    elements.push(el);
    (parent ? parent.children : root).push(el);

    // diagnostics tied to the start tag
    if (tag === "html" && !sawHtml) sawHtml = el;
    if (DEPRECATED.has(tag)) diag("info", "html/deprecated-tag", `<${tag}> is obsolete; use CSS instead.`, lt, openEnd);
    if (tag === "img" && !attrs.some((a) => a.name === "alt")) diag("warning", "html/img-alt", "This image has no alt attribute.", lt, openEnd);
    if (tag === "a" && !attrs.some((a) => a.name === "href" || a.name === "name")) diag("info", "html/empty-link", "This link has no href attribute.", lt, openEnd);
    const seen = new Set();
    for (const a of attrs) {
      if (seen.has(a.name)) diag("warning", "html/duplicate-attr", `Duplicate attribute "${a.name}"; browsers ignore all but the first.`, a.start, a.end);
      seen.add(a.name);
      if (a.name === "id" && a.value) {
        if (ids.has(a.value)) diag("warning", "html/duplicate-id", `Duplicate id "${a.value}".`, a.start, a.end);
        else ids.set(a.value, el);
      }
    }
    if (selfClosing && !isVoid && foreign === 0 && tag !== "svg" && tag !== "math") {
      diag("warning", "html/self-closing", `Browsers ignore the self-closing slash on <${tag}>; add an end tag.`, lt, openEnd);
    }

    pending = i = openEnd;
    if (isVoid || selfClosing) continue;

    if (RAW_TEXT.has(tag) || ESCAPABLE_RAW.has(tag)) {
      const ci = findRawClose(s, tag, openEnd);
      const contentEnd = ci < 0 ? n : ci;
      if (contentEnd > openEnd) el.children.push({ type: "text", start: openEnd, end: contentEnd, text: s.slice(openEnd, contentEnd) });
      if (ci < 0) {
        el.end = n;
        diag("error", "html/unclosed", `The <${tag}> element is never closed.`, lt, openEnd);
        pending = i = n;
      } else {
        const gt = s.indexOf(">", ci);
        const end = gt < 0 ? n : gt + 1;
        el.close = { start: ci, end };
        el.end = end;
        pending = i = end;
      }
      continue;
    }

    stack.push(el);
    counts.push(0);
    bump(tag, 1);
    if (tag === "svg" || tag === "math") foreign++;
  }

  flushText(n);
  while (stack.length) popImplied(n);

  if (sawHtml) {
    if (!sawDoctype) diag("info", "html/missing-doctype", "The document has no <!doctype html>.", 0, 0);
    if (!sawHtml.attrs.some((a) => a.name === "lang")) diag("info", "html/missing-lang", 'The <html> element has no lang attribute (for example lang="en-US").', sawHtml.open.start, sawHtml.open.end);
  }
  return { source: s, children: root, elements, errors };
}

// ------------------------------------------------------------------------------------------------ helpers

/**
 * Raw attribute value: '' for a boolean attribute that is present, null when absent.
 * @param {ElementNode} el
 * @param {string} name
 * @returns {string|null}
 */
export function getAttr(el, name) {
  const nm = String(name).toLowerCase();
  for (const a of el.attrs) if (a.name === nm) return a.value === null ? "" : a.value;
  return null;
}

/**
 * The first attribute object with this name, or null.
 * @param {ElementNode} el
 * @param {string} name
 * @returns {Attr|null}
 */
export function findAttr(el, name) {
  const nm = String(name).toLowerCase();
  for (const a of el.attrs) if (a.name === nm) return a;
  return null;
}

/**
 * @param {ElementNode} el
 * @param {string} name
 * @returns {boolean}
 */
export function hasAttr(el, name) {
  return findAttr(el, name) !== null;
}

/**
 * @param {ElementNode} el
 * @returns {string[]}
 */
export function classList(el) {
  const v = getAttr(el, "class");
  return v ? v.split(/[ \t\n\r\f]+/).filter(Boolean) : [];
}

/**
 * Element children only.
 * @param {ElementNode|ParsedHtml} node
 * @returns {ElementNode[]}
 */
export function childElements(node) {
  return node.children.filter((c) => c.type === "element");
}

/**
 * Index among *element* siblings at each level, root first.
 * @param {ElementNode} el
 * @returns {number[]}
 */
export function elementPath(el) {
  const path = [];
  for (let e = el; e; e = e.parent) path.push(e.index);
  return path.reverse();
}

/**
 * @param {ParsedHtml} parsed
 * @param {number[]} path
 * @returns {ElementNode|null}
 */
export function elementAtPath(parsed, path) {
  let list = parsed.children;
  let found = null;
  for (const idx of path) {
    found = null;
    let k = 0;
    for (const c of list) {
      if (c.type !== "element") continue;
      if (k++ === idx) {
        found = c;
        break;
      }
    }
    if (!found) return null;
    list = found.children;
  }
  return found;
}

/**
 * Deepest element whose [start, end) contains the offset (offsets inside its tags count).
 * @param {ParsedHtml} parsed
 * @param {number} offset
 * @returns {ElementNode|null}
 */
export function elementAtOffset(parsed, offset) {
  let list = parsed.children;
  let found = null;
  for (;;) {
    let lo = 0;
    let hi = list.length - 1;
    let hit = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = list[mid];
      if (offset < c.start) hi = mid - 1;
      else if (offset >= c.end) lo = mid + 1;
      else {
        hit = c;
        break;
      }
    }
    if (!hit || hit.type !== "element") return found;
    found = hit;
    list = hit.children;
  }
}

/**
 * First element with this tag in document order.
 * @param {ParsedHtml} parsed
 * @param {string} tag
 * @returns {ElementNode|null}
 */
export function findByTag(parsed, tag) {
  const t = String(tag).toLowerCase();
  for (const el of parsed.elements) if (el.tag === t) return el;
  return null;
}

/**
 * First element whose id attribute equals `idValue`.
 * @param {ParsedHtml} parsed
 * @param {string} idValue
 * @returns {ElementNode|null}
 */
export function findById(parsed, idValue) {
  for (const el of parsed.elements) if (getAttr(el, "id") === idValue) return el;
  return null;
}

/**
 * True when `el` is `ancestor` or lies inside it.
 * @param {ElementNode} el
 * @param {ElementNode} ancestor
 * @returns {boolean}
 */
export function isInside(el, ancestor) {
  for (let e = el; e; e = e.parent) if (e === ancestor) return true;
  return false;
}

/**
 * Range of the content between the start and the end tag (to the end of the element when there is no end tag).
 * @param {ElementNode} el
 * @returns {{ start: number, end: number }}
 */
export function contentRange(el) {
  return { start: el.open.end, end: el.close ? el.close.start : el.end };
}

/**
 * Concatenated text of all text descendants (entities decoded except inside script/style).
 * @param {ParsedHtml} parsed
 * @param {ElementNode} el
 * @returns {string}
 */
export function elementText(parsed, el) {
  const out = [];
  const stack = [el.children];
  const pos = [0];
  const owners = [el];
  while (stack.length) {
    const list = stack[stack.length - 1];
    const k = pos[pos.length - 1]++;
    if (k >= list.length) {
      stack.pop();
      pos.pop();
      owners.pop();
      continue;
    }
    const node = list[k];
    if (node.type === "text") {
      const owner = owners[owners.length - 1];
      out.push(RAW_TEXT.has(owner.tag) ? node.text : decodeEntities(node.text));
    } else if (node.type === "element") {
      stack.push(node.children);
      pos.push(0);
      owners.push(node);
    }
  }
  return out.join("");
}

/**
 * Short label such as 'div.hero#top' (tag, up to two classes, id).
 * @param {ElementNode} el
 * @returns {string}
 */
export function describe(el) {
  let out = el.tag;
  for (const c of classList(el).slice(0, 2)) out += "." + c;
  const id = getAttr(el, "id");
  if (id) out += "#" + id;
  return out;
}

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  bull: "•", middot: "·", times: "×", divide: "÷", deg: "°", plusmn: "±", euro: "€", pound: "£",
  yen: "¥", cent: "¢", sect: "§", para: "¶", larr: "←", rarr: "→", uarr: "↑", darr: "↓",
  hearts: "♥", shy: "­", ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍", check: "✓",
  star: "☆", infin: "∞", ne: "≠", le: "≤", ge: "≥", micro: "µ", frac12: "½", frac14: "¼",
};

/**
 * Decodes &amp; &lt; &gt; &quot; &#39; &nbsp;, numeric references and a set of common named entities. Unknown ones stay as written.
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  const t = String(text);
  if (t.indexOf("&") < 0) return t;
  return t.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
  });
}

/**
 * Escapes text for element content (& < >).
 * @param {string} text
 * @returns {string}
 */
export function escapeText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escapes text for an attribute value: & and the quote character (double quote by default).
 * @param {string} text
 * @param {'"'|"'"} [quote]
 * @returns {string}
 */
export function escapeAttr(text, quote = '"') {
  const t = String(text).replace(/&/g, "&amp;");
  return quote === "'" ? t.replace(/'/g, "&#39;") : t.replace(/"/g, "&quot;");
}
