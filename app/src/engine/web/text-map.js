// Maps a text selection made in the visual preview (DOM text nodes and character offsets) to the exact source range
// in the page's HTML, so the Code studio can select precisely that text in the editor. Pure (no DOM), unit tested in
// tests/web/text-map.test.js. Docs: docs/code-studio.md ▸ "Text selection in the preview".
//
// Public API
//   alignText(source, dom)          -> number[] | null   source offset (relative) for every DOM index 0..dom.length
//   sanitizeTextPoint(p)            -> TextPoint | null  validates a point posted by the (untrusted) preview frame
//   sourceOffsetFor(parsed, point)  -> number | null     absolute source offset of one end of the selection
//   sourceRangeFor(parsed, a, b)    -> { from, to } | null
//
// TextPoint (what the preview bridge posts for the anchor and the focus of the selection):
//   { id, index, offset, data }  a position inside a DOM text node: `id` = data-of of the nearest annotated element,
//                                `index` = the node's position among that element's direct text-node children (-1 when
//                                the parent element is not annotated), `offset` = UTF-16 offset in `data`, the node text
//   { id, edge: "start" | "end" } before the element's start tag, or at the end of its content
//
// Invariants
//   * The DOM text is the decoded source text: character references (&amp; &#233; &eacute;) are one DOM character but
//     several source characters, CRLF is one "\n" and a leading newline after <pre>/<textarea>/<listing> is dropped.
//     alignText reproduces exactly that and returns null when the texts do not correspond (the page changed, a
//     script rewrote the text), so a stale or forged message never selects a wrong range.
//   * An offset inside a character reference maps to its start (or its end for the DOM index after it).
import { decodeEntities } from "./charcodec.js";

const REF = /&(?:#[xX][0-9a-fA-F]{1,8};?|#[0-9]{1,8};?|[A-Za-z][A-Za-z0-9]{1,31};?)/y;
const MAX_DATA = 1_000_000;

/**
 * Aligns source text (with character references and CRLF) to the DOM text the browser made of it.
 * @param {string} source raw text between tags
 * @param {string} dom the DOM text node's data
 * @returns {number[]|null} map[j] = source offset of DOM index j (map.length === dom.length + 1), or null
 */
export function alignText(source, dom) {
  const s = String(source);
  const d = String(dom);
  const map = new Array(d.length + 1);
  let i = 0;
  let j = 0;
  // the HTML parser drops one newline right after <pre>, <textarea> and <listing>
  if (s[0] === "\n" && d[0] !== "\n") i = 1;
  else if (s[0] === "\r" && s[1] === "\n" && d[0] !== "\n") i = 2;
  while (j < d.length) {
    if (i >= s.length) return null;
    const c = s[i];
    if (c === "&") {
      REF.lastIndex = i;
      const m = REF.exec(s);
      if (m) {
        const lit = m[0];
        let dec = lit.endsWith(";") ? decodeEntities(lit) : lit;
        if (dec === lit && d[j] !== "&") dec = String.fromCodePoint(d.codePointAt(j)); // a reference this table does not know
        if (dec !== lit && d.startsWith(dec, j)) {
          for (let k = 0; k < dec.length; k++) map[j + k] = i;
          j += dec.length;
          i += lit.length;
          continue;
        }
      }
    }
    if (c === "\r" && d[j] === "\n") {
      map[j] = i;
      i += s[i + 1] === "\n" ? 2 : 1;
      j++;
      continue;
    }
    if (c !== d[j]) return null;
    map[j] = i;
    i++;
    j++;
  }
  if (i !== s.length) return null;
  map[d.length] = s.length;
  return map;
}

const isInt = (v) => Number.isInteger(v) && v >= 0 && v < 1e9;

/**
 * Validates a point posted by the preview frame (untrusted: the page's own scripts can post messages too).
 * @returns {{id:number, index:number, offset:number, data:string}|{id:number, edge:"start"|"end"}|null}
 */
export function sanitizeTextPoint(p) {
  if (!p || typeof p !== "object" || !isInt(p.id)) return null;
  if (p.edge === "start" || p.edge === "end") return { id: p.id, edge: p.edge };
  if (typeof p.data !== "string" || p.data.length > MAX_DATA) return null;
  if (!(isInt(p.index) || p.index === -1) || !isInt(p.offset) || p.offset > p.data.length) return null;
  return { id: p.id, index: p.index, offset: p.offset, data: p.data };
}

function textChildren(el) {
  return el.children.filter((c) => c.type === "text");
}
function textDescendants(el, out = []) {
  for (const c of el.children) {
    if (c.type === "text") out.push(c);
    else if (c.type === "element") textDescendants(c, out);
  }
  return out;
}

/**
 * The absolute source offset of one end of a preview selection, or null when it cannot be mapped exactly.
 * @param {import("./html.js").ParsedHtml} parsed the page as parsed by parseHtml (the preview's data-of ids are its element ids)
 * @param {object} point a TextPoint (see the header)
 * @returns {number|null}
 */
export function sourceOffsetFor(parsed, point) {
  const p = sanitizeTextPoint(point);
  const el = p && parsed?.elements?.[p.id];
  if (!el) return null;
  if (p.edge === "start") return el.start;
  if (p.edge === "end") return el.close ? el.close.start : el.end;
  const own = textChildren(el);
  const tryNode = (n) => {
    if (!n) return null;
    const map = alignText(parsed.source.slice(n.start, n.end), p.data);
    return map ? n.start + map[p.offset] : null;
  };
  // the node at the reported index first, then any text node of the element whose text matches (closest index wins)
  const direct = p.index >= 0 ? tryNode(own[p.index]) : null;
  if (direct != null) return direct;
  const pool = p.index >= 0 ? own : textDescendants(el);
  const order = pool.map((n, k) => [Math.abs(k - Math.max(0, p.index)), n]).sort((a, b) => a[0] - b[0]);
  for (const [, n] of order) {
    const r = tryNode(n);
    if (r != null) return r;
  }
  return null;
}

/**
 * The source range of a preview selection (anchor and focus in any order).
 * @returns {{from:number, to:number}|null}
 */
export function sourceRangeFor(parsed, a, b) {
  const x = sourceOffsetFor(parsed, a);
  const y = sourceOffsetFor(parsed, b);
  if (x == null || y == null) return null;
  return { from: Math.min(x, y), to: Math.max(x, y) };
}

// ------------------------------------------------------------------------------------------------ source -> preview

const DROP_NEWLINE = new Set(["pre", "textarea", "listing"]);
const NOT_RENDERED = new Set(["script", "style", "template", "title", "noscript", "head"]);

/**
 * The DOM text a browser makes of source text, with the source offset of every DOM index (the inverse of alignText).
 * @param {string} source raw text between tags
 * @param {boolean} [dropNewline] the text is the first content of a <pre>, <textarea> or <listing>
 * @returns {{text:string, map:number[]}} map.length === text.length + 1
 */
export function decodeTextMap(source, dropNewline = false) {
  const s = String(source);
  let text = "";
  const map = [];
  let i = 0;
  if (dropNewline && s[0] === "\n") i = 1;
  else if (dropNewline && s[0] === "\r") i = s[1] === "\n" ? 2 : 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "&") {
      REF.lastIndex = i;
      const m = REF.exec(s);
      if (m && m[0].endsWith(";")) {
        const dec = decodeEntities(m[0]);
        if (dec !== m[0]) {
          for (let k = 0; k < dec.length; k++) map.push(i);
          text += dec;
          i += m[0].length;
          continue;
        }
      }
    }
    if (c === "\r") {
      map.push(i);
      text += "\n";
      i += s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    map.push(i);
    text += c;
    i++;
  }
  map.push(s.length);
  return { text, map };
}

/**
 * The preview text positions (TextPoints with `data`, as the bridge reports them) of a source range of the page, for
 * highlighting the text selected in the editor in the preview. Ends in tags or between elements snap to the nearest
 * text inside the range; whitespace-only text at the ends is skipped. Returns null when the range holds no rendered text.
 * @param {import("./html.js").ParsedHtml} parsed
 * @param {number} from
 * @param {number} to
 * @returns {{a:{id:number,index:number,offset:number,data:string}, b:{id:number,index:number,offset:number,data:string}}|null}
 */
export function textPointsFor(parsed, from, to) {
  if (!parsed || !(to > from)) return null;
  const hits = [];
  const visit = (node, hidden) => {
    for (const c of node.children) {
      if (c.start >= to) return;
      if (c.type === "element") {
        if (c.end > from) visit(c, hidden || NOT_RENDERED.has(c.tag));
      } else if (c.type === "text" && !hidden && node.type === "element" && c.end > from) hits.push({ node: c, parent: node });
    }
  };
  visit(parsed, false);
  const solid = hits.filter((x) => /\S/.test(x.node.text));
  const list = solid.length ? solid : hits;
  if (!list.length) return null;
  const point = (x, abs, isEnd) => {
    const n = x.node;
    const own = x.parent.children.filter((c) => c.type === "text");
    const { text, map } = decodeTextMap(parsed.source.slice(n.start, n.end), DROP_NEWLINE.has(x.parent.tag) && n.start === x.parent.open.end);
    const rel = Math.max(0, Math.min(n.end - n.start, abs - n.start));
    let j;
    if (isEnd) {
      // the first DOM index at or after the source offset (a reference cut in half is included)
      j = 0;
      while (j < text.length && map[j] < rel) j++;
    } else {
      // the last DOM index at or before the source offset
      j = text.length;
      while (j > 0 && map[j] > rel) j--;
    }
    return { id: x.parent.id, index: own.indexOf(n), offset: j, data: text };
  };
  return { a: point(list[0], from, false), b: point(list[list.length - 1], to, true) };
}
