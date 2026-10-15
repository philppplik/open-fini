// A compact Emmet-style abbreviation expander for HTML and CSS (Tab expansion in the code editor).
// Pure code, no DOM. Supports the parts of Emmet that are used all day long:
//   HTML  tag#id.class[attr=value]{text}  >  +  ^  ( )  *n  $ numbering  implicit tag names  common snippets ("!", "a:link", …)
//   CSS   property shorthands with units and values: m10, p10-20, w100p, df, bgc#fff, fz1.2r, pos:a, …

const INLINE = new Set(["a", "abbr", "b", "bdo", "big", "br", "button", "cite", "code", "dfn", "em", "font", "i", "img", "input", "kbd", "label", "q", "samp", "select", "small", "span", "strike", "strong", "sub", "sup", "textarea", "tt", "u", "var"]);
const TAGS = new Set(["a", "abbr", "address", "article", "aside", "audio", "b", "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "dd", "details", "div", "dl", "dt", "em", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "i", "iframe", "img", "input", "label", "legend", "li", "link", "main", "mark", "meta", "nav", "ol", "option", "p", "picture", "pre", "q", "section", "select", "small", "source", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "u", "ul", "video"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Snippet aliases: abbreviation → { tag, attrs: [[name, value]] }. */
const ALIASES = {
  a: { tag: "a", attrs: [["href", ""]] },
  "a:link": { tag: "a", attrs: [["href", "http://"]] },
  "a:mail": { tag: "a", attrs: [["href", "mailto:"]] },
  "a:tel": { tag: "a", attrs: [["href", "tel:+"]] },
  abbr: { tag: "abbr", attrs: [["title", ""]] },
  img: { tag: "img", attrs: [["src", ""], ["alt", ""]] },
  link: { tag: "link", attrs: [["rel", "stylesheet"], ["href", ""]] },
  "link:css": { tag: "link", attrs: [["rel", "stylesheet"], ["href", "style.css"]] },
  "link:favicon": { tag: "link", attrs: [["rel", "shortcut icon"], ["type", "image/x-icon"], ["href", "favicon.ico"]] },
  script: { tag: "script", attrs: [] },
  "script:src": { tag: "script", attrs: [["src", ""]] },
  "meta:vp": { tag: "meta", attrs: [["name", "viewport"], ["content", "width=device-width, initial-scale=1"]] },
  "meta:utf": { tag: "meta", attrs: [["charset", "UTF-8"]] },
  form: { tag: "form", attrs: [["action", ""]] },
  "form:post": { tag: "form", attrs: [["action", ""], ["method", "post"]] },
  input: { tag: "input", attrs: [["type", "text"]] },
  "input:text": { tag: "input", attrs: [["type", "text"], ["name", ""]] },
  "input:email": { tag: "input", attrs: [["type", "email"], ["name", ""]] },
  "input:password": { tag: "input", attrs: [["type", "password"], ["name", ""]] },
  "input:number": { tag: "input", attrs: [["type", "number"], ["name", ""]] },
  "input:checkbox": { tag: "input", attrs: [["type", "checkbox"], ["name", ""]] },
  "input:radio": { tag: "input", attrs: [["type", "radio"], ["name", ""]] },
  "input:submit": { tag: "input", attrs: [["type", "submit"], ["value", ""]] },
  btn: { tag: "button", attrs: [] },
  "btn:s": { tag: "button", attrs: [["type", "submit"]] },
  "btn:b": { tag: "button", attrs: [["type", "button"]] },
  bq: { tag: "blockquote", attrs: [] },
  fig: { tag: "figure", attrs: [] },
  figc: { tag: "figcaption", attrs: [] },
  ifr: { tag: "iframe", attrs: [["src", ""], ["title", ""]] },
  sect: { tag: "section", attrs: [] },
  art: { tag: "article", attrs: [] },
  hdr: { tag: "header", attrs: [] },
  ftr: { tag: "footer", attrs: [] },
  adr: { tag: "address", attrs: [] },
  tarea: { tag: "textarea", attrs: [["name", ""], ["rows", "3"]] },
  sel: { tag: "select", attrs: [["name", ""]] },
  opt: { tag: "option", attrs: [["value", ""]] },
  video: { tag: "video", attrs: [["src", ""], ["controls", null]] },
  audio: { tag: "audio", attrs: [["src", ""], ["controls", null]] },
  label: { tag: "label", attrs: [["for", ""]] },
};
const IMPLICIT = { ul: "li", ol: "li", table: "tr", thead: "tr", tbody: "tr", tfoot: "tr", tr: "td", select: "option", optgroup: "option", datalist: "option", dl: "dt", p: "span", span: "span", em: "span", strong: "span", a: "span", button: "span", label: "span", h1: "span", h2: "span", h3: "span", h4: "span", h5: "span", h6: "span" };

const MARK = "⁣"; // caret placeholder
const DOC5 = `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Document</title>
</head>
<body>
  ${MARK}
</body>
</html>`;

// ------------------------------------------------------------------------------------------------ parsing

/** @returns {{ items: object[] } | null} a forest of { name, id, classes, attrs, text, repeat, children, group } */
function parse(src) {
  let i = 0;
  const peek = () => src[i];
  const fail = () => {
    throw new Error("bad abbreviation");
  };
  const readUntil = (close) => {
    // reads a {text} or [attrs] block respecting nesting of the same bracket
    const open = src[i];
    let depth = 0;
    const start = ++i;
    for (; i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close) {
        if (depth === 0) return src.slice(start, i++);
        depth--;
      }
    }
    return fail();
  };
  const name = () => {
    const m = /^[A-Za-z][\w:$@-]*|^\$+[\w$@-]*/.exec(src.slice(i));
    if (!m) return "";
    i += m[0].length;
    return m[0];
  };
  const word = () => {
    const m = /^[\w$@-]+/.exec(src.slice(i));
    if (!m) return fail();
    i += m[0].length;
    return m[0];
  };
  function parseAttrs(text) {
    const out = [];
    const re = /([\w:@.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?/g;
    let m;
    while ((m = re.exec(text))) out.push([m[1], m[2] ?? m[3] ?? m[4] ?? ""]);
    return out;
  }
  function item() {
    if (peek() === "(") {
      i++;
      const kids = sequence(")");
      if (peek() !== ")") fail();
      i++;
      const node = { group: true, children: kids, repeat: 1 };
      if (peek() === "*") {
        i++;
        node.repeat = parseInt(word(), 10) || 1;
      }
      return node;
    }
    const node = { name: name(), id: null, classes: [], attrs: [], text: null, repeat: 1, children: [] };
    for (;;) {
      const c = peek();
      if (c === "#") {
        i++;
        node.id = word();
      } else if (c === ".") {
        i++;
        node.classes.push(word());
      } else if (c === "[") node.attrs.push(...parseAttrs(readUntil("]")));
      else if (c === "{") node.text = (node.text || "") + readUntil("}");
      else if (c === "*") {
        i++;
        node.repeat = parseInt(word(), 10) || 1;
      } else break;
    }
    if (!node.name && !node.id && !node.classes.length && !node.attrs.length && node.text == null) fail();
    return node;
  }
  /** Parses `item (op item)*` into siblings; `>` nests, `+` adds a sibling, `^` climbs. */
  function sequence(stop) {
    const root = [];
    let level = root;
    const stack = [];
    let last = null;
    last = item();
    level.push(last);
    while (i < src.length && peek() !== stop) {
      const op = peek();
      if (op === ">") {
        i++;
        stack.push(level);
        level = last.children;
      } else if (op === "+") i++;
      else if (op === "^") {
        while (peek() === "^") {
          i++;
          level = stack.pop() || root;
        }
      } else return fail();
      last = item();
      level.push(last);
    }
    return root;
  }
  const forest = sequence(null);
  if (i < src.length) fail();
  return forest;
}

// ------------------------------------------------------------------------------------------------ rendering

const pad = (n, width) => String(n).padStart(width, "0");
function number(str, idx, count) {
  return str.replace(/(\$+)(?:@(-)?(\d+)?)?/g, (m, dollars, rev, start) => {
    const s = start ? parseInt(start, 10) : 1;
    const v = rev ? s + count - 1 - idx : s + idx;
    return pad(v, dollars.length);
  });
}

function expandNode(node, idx, count, parentTag, depth, ind, out) {
  if (node.group) {
    for (let r = 0; r < node.repeat; r++) for (const c of node.children) expandNode(c, r, node.repeat, parentTag, depth, ind, out);
    return;
  }
  for (let r = 0; r < node.repeat; r++) {
    const n = node.repeat > 1 ? r : idx;
    const total = node.repeat > 1 ? node.repeat : count;
    renderElement(node, n, total, parentTag, depth, ind, out);
  }
}

function renderElement(node, idx, count, parentTag, depth, ind, out) {
  const alias = ALIASES[node.name];
  let tag = alias ? alias.tag : node.name;
  if (!tag) tag = IMPLICIT[parentTag] || (node.name === "" && INLINE.has(parentTag) ? "span" : "div");
  tag = number(tag, idx, count);
  const attrs = [];
  const put = (k, v) => {
    const existing = attrs.find((a) => a[0] === k);
    if (existing) existing[1] = v;
    else attrs.push([k, v]);
  };
  for (const [k, v] of alias?.attrs || []) put(k, v);
  if (node.id) put("id", number(node.id, idx, count));
  if (node.classes.length) {
    const cur = attrs.find((a) => a[0] === "class");
    const cls = node.classes.map((c) => number(c, idx, count)).join(" ");
    put("class", cur ? `${cur[1]} ${cls}` : cls);
  }
  for (const [k, v] of node.attrs) put(number(k, idx, count), number(v ?? "", idx, count));
  const attrText = attrs.map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${v}"`)).join("");
  const text = node.text != null ? number(node.text, idx, count) : null;
  const pre = ind.repeat(depth);
  if (VOID.has(tag)) {
    out.push(`${pre}<${tag}${attrText}>`);
    return;
  }
  const kids = node.children;
  if (!kids.length) {
    out.push(`${pre}<${tag}${attrText}>${text ?? MARK}</${tag}>`);
    return;
  }
  out.push(`${pre}<${tag}${attrText}>${text ?? ""}`);
  for (const c of kids) expandNode(c, idx, count, tag, depth + 1, ind, out);
  out.push(`${pre}</${tag}>`);
}

/**
 * Expands an HTML abbreviation. Returns { text, cursor } where `cursor` is the offset of the caret inside `text`
 * (the first empty element or attribute), or null when the abbreviation is not valid or is only a plain word.
 * @param {string} abbr
 * @param {{indent?: string}} [opts]
 */
export function expandHtml(abbr, { indent = "  " } = {}) {
  abbr = abbr.trim();
  if (!abbr) return null;
  if (abbr === "!" || abbr === "html:5") return finish(DOC5);
  let forest;
  try {
    forest = parse(abbr);
  } catch {
    return null;
  }
  // a bare word is only an abbreviation when it is a known tag or snippet ("hello" stays text)
  if (/^[A-Za-z][\w:-]*$/.test(abbr) && !ALIASES[abbr] && !TAGS.has(abbr)) return null;
  const out = [];
  for (const n of forest) expandNode(n, 0, 1, "", 0, indent, out);
  return finish(out.join("\n"));
}

function finish(text) {
  // the caret goes to the first empty attribute value or empty element, whichever comes first
  let cursor = text.indexOf(MARK);
  const attr = text.indexOf('=""');
  if (attr >= 0 && (cursor < 0 || attr + 2 < cursor)) {
    text = text.split(MARK).join("");
    return { text, cursor: attr + 2 };
  }
  if (cursor >= 0) text = text.slice(0, cursor) + text.slice(cursor + 1);
  text = text.split(MARK).join("");
  if (cursor < 0) {
    // first empty attribute value, else end
    const m = /=""/.exec(text);
    cursor = m ? m.index + 2 : text.length;
  }
  return { text, cursor };
}

// ------------------------------------------------------------------------------------------------ CSS

const CSS_PROPS = {
  m: "margin", mt: "margin-top", mr: "margin-right", mb: "margin-bottom", ml: "margin-left",
  p: "padding", pt: "padding-top", pr: "padding-right", pb: "padding-bottom", pl: "padding-left",
  w: "width", h: "height", maw: "max-width", mah: "max-height", miw: "min-width", mih: "min-height",
  fz: "font-size", fw: "font-weight", ff: "font-family", fs: "font-style", lh: "line-height", ls: "letter-spacing", ta: "text-align", td: "text-decoration", tt: "text-transform",
  c: "color", bg: "background", bgc: "background-color", bgi: "background-image", bgs: "background-size", bgp: "background-position", bgr: "background-repeat",
  bd: "border", bdt: "border-top", bdr: "border-right", bdb: "border-bottom", bdl: "border-left", bdrs: "border-radius", bds: "border-style", bdw: "border-width", bdc: "border-color",
  op: "opacity", z: "z-index", t: "top", r: "right", b: "bottom", l: "left", bxsh: "box-shadow", ov: "overflow", cur: "cursor", va: "vertical-align",
  d: "display", pos: "position", fl: "float", cl: "clear", jc: "justify-content", ai: "align-items", ac: "align-content", as: "align-self", fx: "flex", fxd: "flex-direction", fxw: "flex-wrap", fxg: "flex-grow", fxs: "flex-shrink",
  g: "gap", gtc: "grid-template-columns", gtr: "grid-template-rows", tr: "transition", trf: "transform", ws: "white-space", whs: "white-space", v: "visibility", ct: "content", ol: "outline", pe: "pointer-events", us: "user-select", ar: "aspect-ratio", of: "object-fit", fil: "filter",
};
const CSS_VALUES = {
  d: { n: "none", b: "block", f: "flex", g: "grid", i: "inline", ib: "inline-block", if: "inline-flex", ig: "inline-grid", t: "table", tc: "table-cell" },
  pos: { s: "static", a: "absolute", r: "relative", f: "fixed", st: "sticky" },
  fl: { l: "left", r: "right", n: "none" },
  cl: { l: "left", r: "right", b: "both", n: "none" },
  ta: { l: "left", r: "right", c: "center", j: "justify" },
  fw: { b: "bold", n: "normal", l: "lighter" },
  fs: { i: "italic", n: "normal", o: "oblique" },
  td: { n: "none", u: "underline", lt: "line-through" },
  tt: { u: "uppercase", l: "lowercase", c: "capitalize", n: "none" },
  ov: { h: "hidden", a: "auto", s: "scroll", v: "visible" },
  jc: { c: "center", s: "flex-start", e: "flex-end", sb: "space-between", sa: "space-around", se: "space-evenly" },
  ai: { c: "center", s: "flex-start", e: "flex-end", st: "stretch", b: "baseline" },
  ac: { c: "center", s: "flex-start", e: "flex-end", sb: "space-between", sa: "space-around", st: "stretch" },
  fxd: { r: "row", c: "column", rr: "row-reverse", cr: "column-reverse" },
  fxw: { w: "wrap", n: "nowrap" },
  cur: { p: "pointer", d: "default", t: "text", m: "move", n: "not-allowed" },
  v: { h: "hidden", v: "visible" },
  of: { c: "cover", n: "contain", f: "fill" },
  bgr: { n: "no-repeat", x: "repeat-x", y: "repeat-y" },
  ws: { n: "nowrap", p: "pre", pw: "pre-wrap" },
  whs: { n: "nowrap", p: "pre", pw: "pre-wrap" },
  pe: { n: "none", a: "auto" },
};
const NO_UNIT = new Set(["fw", "op", "z", "fxg", "fxs", "fx", "lh", "ar", "ct"]);

function cssNumber(tok, prop) {
  const m = /^(-?\d*\.?\d+)(p|e|r|x|vw|vh|%|px|em|rem|s|ms|deg)?$/.exec(tok);
  if (!m) return null;
  const n = m[1];
  const u = m[2];
  if (u === "p" || u === "%") return `${n}%`;
  if (u === "e" || u === "em") return `${n}em`;
  if (u === "r" || u === "rem") return `${n}rem`;
  if (u === "x") return n;
  if (u) return `${n}${u}`;
  if (NO_UNIT.has(prop)) return n;
  return n === "0" ? "0" : `${n}px`;
}

/**
 * Expands a CSS abbreviation (`m10-20`, `df`, `bgc#fff`, `w100p!`) to a declaration, or returns null.
 * @returns {{ text: string, cursor: number } | null}
 */
export function expandCss(abbr) {
  abbr = abbr.trim();
  if (!abbr) return null;
  let important = false;
  if (abbr.endsWith("!")) {
    important = true;
    abbr = abbr.slice(0, -1);
  }
  const mm = /^([a-z]+)(?::|(?=[-\d#.$]))?(.*)$/.exec(abbr);
  if (!mm) return null;
  let key = mm[1];
  let rest = mm[2];
  // prefer the longest matching property key (e.g. "bgc" over "bg"+"c…")
  while (key && !CSS_PROPS[key]) {
    rest = key[key.length - 1] + rest;
    key = key.slice(0, -1);
  }
  const prop = CSS_PROPS[key];
  if (!prop) return null;
  // what follows the property must look like a value: a number, a color, or a known keyword
  if (rest && !/^[-\d.#$]/.test(rest) && !CSS_VALUES[key]?.[rest]) return null;
  let value;
  if (!rest) {
    value = null;
  } else if (rest.startsWith("#")) {
    value = rest;
  } else if (CSS_VALUES[key]?.[rest]) value = CSS_VALUES[key][rest];
  else {
    const parts = rest.split(/(?<=[\w.%])-/).filter(Boolean);
    const conv = parts.map((p) => cssNumber(p, key) ?? (CSS_VALUES[key]?.[p] ?? p));
    value = conv.join(" ");
  }
  if (value == null) return { text: `${prop}: ;`, cursor: prop.length + 2 };
  const text = `${prop}: ${value}${important ? " !important" : ""};`;
  return { text, cursor: text.length };
}

/**
 * Finds the abbreviation that ends at `pos` in `text`. Returns { from, abbr } or null.
 * HTML abbreviations may contain {text} and [attrs] blocks with spaces; CSS ones stop at whitespace and `;`/`{`/`}`.
 */
export function abbreviationBefore(text, pos, lang) {
  const stop = lang === "css" ? /[\s;{}]/ : /[\s<]/;
  let i = pos;
  let depthCurly = 0;
  let depthSquare = 0;
  let depthParen = 0;
  while (i > 0) {
    const c = text[i - 1];
    if (c === "}") depthCurly++;
    else if (c === "{") {
      if (!depthCurly) break;
      depthCurly--;
    } else if (c === "]") depthSquare++;
    else if (c === "[") {
      if (!depthSquare) break;
      depthSquare--;
    } else if (c === ")") depthParen++;
    else if (c === "(") {
      if (!depthParen) break;
      depthParen--;
    } else if (!depthCurly && !depthSquare && stop.test(c)) break;
    else if (lang === "html" && c === ">" && !depthCurly && !depthSquare && text.lastIndexOf("<", i - 1) > text.lastIndexOf(">", i - 2)) break; // the end of a real tag
    i--;
  }
  const abbr = text.slice(i, pos);
  if (!abbr || depthCurly || depthSquare || depthParen) return null;
  return { from: i, abbr };
}
