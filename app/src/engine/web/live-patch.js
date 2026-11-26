// Incremental live preview: turns an edit of the page's HTML into a DOM patch of the document that is already on
// screen, so typing in the editor or in the visual designer never reloads the preview (scroll position, text
// selection, focus and the state of the page's scripts survive). Docs: docs/code-studio.md ▸ "Live updates".
//
// Public API
//   changedRange(a, b)              -> { from, oldTo, newTo }   the one range in which two texts differ
//   planPagePatch(oldSrc, newSrc)   -> PatchPlan                 what the preview has to do for that edit
//   morphKit()                      -> { renumber, morph }       the DOM side; runs INSIDE the preview frame
//
// PatchPlan
//   { kind: "none" }                                   nothing changed
//   { kind: "reload", reason }                         patching is unsafe (a script, an inline event handler, a
//                                                      <template>, or a structural change outside one element)
//   { kind: "patch", root, keep, removed, added }      renumber data-of ids, then morph the element `root` (a data-of
//                                                      id; null = the whole document) to its rebuilt counterpart
//
// Ids: the preview annotates every element with data-of = its index in parseHtml(source).elements (document order). An
// edit inside [from, oldTo) keeps the ids of the elements before it (< keep), drops `removed` ids from `keep` on and
// creates `added` fresh ones; every later id moves by added - removed. planPagePatch verifies that mapping element by
// element (tag, start offset and parent), so a patch is only planned when the rest of the document is provably the same.
//
// morphKit is serialized with Function#toString and injected into the sandboxed preview (like measureKit): it must be
// self-contained ES5 with no imports, and it only uses DOM methods of the nodes it is given, so the tests can run it on
// a small fake DOM.
/* eslint-disable no-var */
import { parseHtml } from "./html.js";

/**
 * The single range in which two texts differ (common prefix and suffix removed).
 * @param {string} a old text
 * @param {string} b new text
 * @returns {{from:number, oldTo:number, newTo:number}}
 */
export function changedRange(a, b) {
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < n - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { from: p, oldTo: a.length - s, newTo: b.length - s };
}

const HANDLER = /^on[a-z]{3,}$/;
const RAW_RELOAD = new Set(["script", "template", "noscript"]);
/** True when [from, to) (an insertion point when empty) touches the inside of [start, end). */
const touches = (start, end, from, to) => (from === to ? start < from && end > from : start < to && end > from);
const overlaps = (el, from, to) => touches(el.start, el.end, from, to);
const hasHandler = (el) => el.attrs.some((a) => HANDLER.test(a.name));

/** True when an element's start tag (up to the end of its name) begins before `from`. */
const nameBefore = (el, from) => el.open.start + 1 + el.tag.length < from;

/**
 * Plans how the preview follows an edit of the page's HTML.
 * @param {string} oldSrc the source the preview currently shows
 * @param {string} newSrc the edited source
 * @param {{ oldParsed?: import("./html.js").ParsedHtml, newParsed?: import("./html.js").ParsedHtml }} [cache]
 * @returns {{kind:"none"}|{kind:"reload", reason:string}|{kind:"patch", root:number|null, keep:number, removed:number, added:number}}
 */
export function planPagePatch(oldSrc, newSrc, cache = {}) {
  if (oldSrc === newSrc) return { kind: "none" };
  const reload = (reason) => ({ kind: "reload", reason });
  let { from, oldTo, newTo } = changedRange(oldSrc, newSrc);
  // a pure insertion or deletion is ambiguous ("<p>a</p><" + "p>b</p><" + "script>"): slide it left to start at a tag
  if (from === oldTo || from === newTo) {
    const src = from === oldTo ? newSrc : oldSrc;
    const len = from === oldTo ? newTo - from : oldTo - from;
    for (let f = from; f > 0 && src[f - 1] === src[f + len - 1]; ) {
      f--;
      if (src[f] === "<") {
        oldTo -= from - f;
        newTo -= from - f;
        from = f;
        break;
      }
    }
  }
  const P0 = cache.oldParsed?.source === oldSrc ? cache.oldParsed : parseHtml(oldSrc);
  const P1 = cache.newParsed?.source === newSrc ? cache.newParsed : parseHtml(newSrc);
  const E0 = P0.elements;
  const E1 = P1.elements;
  const shift = newSrc.length - oldSrc.length;

  // ids: [0, keep) unchanged, [keep, keep + removed) gone, later ones shifted
  let keep = 0;
  while (keep < E0.length && E0[keep].start < from && nameBefore(E0[keep], from)) keep++;
  // an edit of a tag name replaces that element: the changed range starts at its "<"
  if (keep < E0.length && E0[keep].start < from) from = E0[keep].start;
  let after = keep;
  while (after < E0.length && E0[after].start < oldTo) after++;
  const removed = after - keep;
  const added = E1.length - E0.length + removed;
  if (added < 0) return reload("structure");
  const map = (id) => (id < keep ? id : id >= keep + removed ? id + added - removed : -1);

  // every kept or shifted element must be the same element in the new parse (tag, position, parent)
  for (let i = 0; i < E0.length; i++) {
    const j = map(i);
    if (j < 0) continue;
    const a = E0[i];
    const b = E1[j];
    if (!b || b.tag !== a.tag || b.start !== (i < keep ? a.start : a.start + shift)) return reload("structure");
  }
  for (let j = keep; j < keep + added; j++) if (E1[j].start < from || E1[j].start >= newTo) return reload("structure");

  // scripts, inline event handlers, templates and noscript (parsed differently with scripting off) are never patched
  const risky = (el, lo, hi) => overlaps(el, lo, hi) && (RAW_RELOAD.has(el.tag) || (hasHandler(el) && touches(el.open.start, el.open.end, lo, hi)));
  const why = (el) => (RAW_RELOAD.has(el.tag) ? el.tag : "handler");
  for (const el of E0) if (risky(el, from, oldTo)) return reload(why(el));
  for (const el of E1) if (risky(el, from, newTo)) return reload(why(el));
  for (let j = keep; j < keep + added; j++) if (hasHandler(E1[j])) return reload("handler");

  // the root: the deepest kept element that contains the whole change in both versions
  let root = null;
  for (let i = keep - 1; i >= 0; i--) {
    const a = E0[i];
    const b = E1[i];
    const holds = (el, to) => el.end >= to && (!el.close || el.close.start >= to);
    if (holds(a, oldTo) && holds(b, newTo)) {
      root = i;
      break;
    }
  }
  if (root != null) {
    // an element outside the root must keep its parent (inside it, the morph rebuilds whatever changed)
    const r0 = E0[root];
    const r1 = E1[root];
    for (let i = 0; i < E0.length; i++) {
      const j = map(i);
      if (j < 0) continue;
      const a = E0[i];
      const b = E1[j];
      if (a.start > r0.start && a.end <= r0.end && b.start > r1.start && b.end <= r1.end) continue;
      const pa = a.parent ? map(a.parent.id) : null;
      const pb = E1[j].parent ? E1[j].parent.id : null;
      if (pa !== pb) return reload("structure");
    }
  } else {
    // no element contains the change: the edit is at the top level of the file (the whole document is morphed)
    const doctype = (P, to) => P.children.some((c) => c.type === "doctype" && (touches(c.start, c.end, from, to) || c.end === from));
    if (doctype(P0, oldTo) || doctype(P1, newTo)) return reload("doctype");
    for (let i = 0; i < E0.length; i++) {
      const j = map(i);
      if (j < 0) continue;
      const pa = E0[i].parent ? map(E0[i].parent.id) : null;
      const pb = E1[j].parent ? E1[j].parent.id : null;
      if (pa !== pb) return reload("structure");
    }
  }
  return { kind: "patch", root, keep, removed, added };
}

/**
 * The DOM side of a patch. Runs inside the preview frame (serialized), and in the tests on a fake DOM.
 * renumber(root, keep, removed, added): rewrites data-of ids of the live document to the new numbering; removed
 *   elements get a key that matches nothing, so the morph drops them.
 * toTree(node) / fromTree(tree, doc): the root of the rebuilt page as plain JSON (built by the host from a DOMParser copy,
 *   rebuilt in the frame with createElementNS), so the frame never parses HTML it receives in a message.
 * morph(live, next, opts): makes `live` equal to `next` (an element of a parsed copy of the rebuilt page) with as few
 *   DOM changes as possible. Children are matched by data-of id, others by position and node name. opts:
 *   adopt(node) -> a live copy of a node of `next`; keep(node) -> true for live nodes the morph must not touch or
 *   remove (the inspector overlay); frozen(el) -> true for an element that is being edited inline (left alone).
 *   Elements without data-of that the new document does not have (made by the page's scripts) are kept, and
 *   <script> elements are never re-created or emptied: setting their attributes does not run them again.
 */
export function morphKit() {
  var KEY = "data-of";
  function key(n) {
    return n && n.nodeType === 1 && n.hasAttribute(KEY) ? n.getAttribute(KEY) : null;
  }
  function walk(n, fn) {
    for (var c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      fn(c);
      walk(c, fn);
    }
  }
  function renumber(root, keep, removed, added) {
    var delta = added - removed;
    var visit = function (el) {
      var k = key(el);
      if (k == null || !/^\d+$/.test(k)) return;
      var id = Number(k);
      if (id >= keep + removed) {
        if (delta) el.setAttribute(KEY, String(id + delta));
      } else if (id >= keep) el.setAttribute(KEY, "gone-" + id);
    };
    if (root.nodeType === 1) visit(root);
    walk(root, visit);
  }
  function syncAttrs(live, next) {
    var i;
    var la = live.attributes;
    for (i = la.length - 1; i >= 0; i--) if (!next.hasAttribute(la[i].name)) live.removeAttribute(la[i].name);
    var na = next.attributes;
    for (i = 0; i < na.length; i++) if (live.getAttribute(na[i].name) !== na[i].value) live.setAttribute(na[i].name, na[i].value);
  }
  function same(a, b) {
    return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
  }
  function morphEl(live, next, o, stats) {
    if (o.frozen && o.frozen(live)) return;
    syncAttrs(live, next);
    if (String(live.nodeName).toUpperCase() === "SCRIPT") return;
    morphChildren(live, next, o, stats);
  }
  function morphChildren(live, next, o, stats) {
    var keyed = {};
    var c;
    for (c = live.firstChild; c; c = c.nextSibling) {
      var k0 = key(c);
      if (k0 != null) keyed[k0] = c;
    }
    var cur = live.firstChild;
    var skip = function () {
      while (cur && o.keep && o.keep(cur)) cur = cur.nextSibling;
    };
    for (var nc = next.firstChild; nc; nc = nc.nextSibling) {
      skip();
      var k = key(nc);
      if (k != null) {
        var m = keyed[k];
        if (m && same(m, nc)) {
          delete keyed[k];
          if (m === cur) cur = cur.nextSibling;
          else {
            live.insertBefore(m, cur);
            stats.moved++;
          }
          morphEl(m, nc, o, stats);
        } else {
          live.insertBefore(o.adopt(nc), cur);
          stats.inserted++;
        }
      } else if (cur && key(cur) == null && same(cur, nc)) {
        if (nc.nodeType === 1) morphEl(cur, nc, o, stats);
        else if (cur.nodeValue !== nc.nodeValue) {
          cur.nodeValue = nc.nodeValue;
          stats.text++;
        }
        cur = cur.nextSibling;
      } else {
        live.insertBefore(o.adopt(nc), cur);
        stats.inserted++;
      }
    }
    while (cur) {
      var nx = cur.nextSibling;
      var scriptMade = cur.nodeType === 1 && key(cur) == null;
      if (!(o.keep && o.keep(cur)) && !scriptMade) {
        live.removeChild(cur);
        stats.removed++;
      }
      cur = nx;
    }
  }
  function toTree(n) {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType === 8) return { c: n.nodeValue };
    if (n.nodeType !== 1) return null;
    var a = [];
    for (var i = 0; i < n.attributes.length; i++) a.push([n.attributes[i].name, n.attributes[i].value, n.attributes[i].namespaceURI || null]);
    var k = [];
    for (var c = n.firstChild; c; c = c.nextSibling) {
      var t = toTree(c);
      if (t != null) k.push(t);
    }
    return { t: n.localName || String(n.nodeName).toLowerCase(), ns: n.namespaceURI || null, a: a, k: k };
  }
  function fromTree(t, doc) {
    if (typeof t === "string") return doc.createTextNode(t);
    if (!t || typeof t !== "object") throw new Error("bad tree");
    if (typeof t.c === "string") return doc.createComment(t.c);
    if (typeof t.t !== "string" || !Array.isArray(t.a) || !Array.isArray(t.k)) throw new Error("bad tree");
    var el = t.ns ? doc.createElementNS(String(t.ns), t.t) : doc.createElement(t.t);
    for (var i = 0; i < t.a.length; i++) {
      var at = t.a[i];
      if (at[2]) el.setAttributeNS(String(at[2]), String(at[0]), String(at[1]));
      else el.setAttribute(String(at[0]), String(at[1]));
    }
    for (var j = 0; j < t.k.length; j++) el.appendChild(fromTree(t.k[j], doc));
    return el;
  }
  function morph(live, next, o) {
    var stats = { inserted: 0, removed: 0, moved: 0, text: 0 };
    morphEl(live, next, o || {}, stats);
    return stats;
  }
  return { renumber: renumber, morph: morph, toTree: toTree, fromTree: fromTree };
}
