import test from "node:test";
import assert from "node:assert/strict";
import { alignText, sanitizeTextPoint, sourceOffsetFor, sourceRangeFor } from "../../app/src/engine/web/text-map.js";
import { parseHtml } from "../../app/src/engine/web/html.js";

const byTag = (parsed, tag, n = 0) => parsed.elements.filter((e) => e.tag === tag)[n];

test("alignText maps plain text one to one", () => {
  assert.deepEqual(alignText("abc", "abc"), [0, 1, 2, 3]);
  assert.deepEqual(alignText("", ""), [0]);
  assert.equal(alignText("abc", "abd"), null);
  assert.equal(alignText("abc", "ab"), null);
  assert.equal(alignText("ab", "abc"), null);
});

test("alignText decodes character references to one DOM character", () => {
  const map = alignText("A &amp; B", "A & B");
  assert.deepEqual(map, [0, 1, 2, 7, 8, 9]);
  assert.deepEqual(alignText("caf&eacute;!", "café!"), [0, 1, 2, 3, 11, 12]);
  assert.deepEqual(alignText("&#233;&#x41;", "éA"), [0, 6, 12]);
  // astral code point: two UTF-16 units map to the reference start
  assert.deepEqual(alignText("x&#128512;y", "x😀y"), [0, 1, 1, 10, 11]);
  // a reference left as written by the browser (unknown name)
  assert.deepEqual(alignText("&nosuch;", "&nosuch;"), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("alignText handles CRLF and the dropped first newline of <pre>", () => {
  assert.deepEqual(alignText("a\r\nb", "a\nb"), [0, 1, 3, 4]);
  assert.deepEqual(alignText("\nline", "line"), [1, 2, 3, 4, 5]);
  assert.deepEqual(alignText("\r\nx", "x"), [2, 3]);
});

test("sanitizeTextPoint rejects malformed points", () => {
  assert.equal(sanitizeTextPoint(null), null);
  assert.equal(sanitizeTextPoint({ id: -1, edge: "start" }), null);
  assert.equal(sanitizeTextPoint({ id: 1.5, edge: "start" }), null);
  assert.equal(sanitizeTextPoint({ id: 1, edge: "middle" }), null);
  assert.equal(sanitizeTextPoint({ id: 1, index: 0, offset: 5, data: "abc" }), null);
  assert.equal(sanitizeTextPoint({ id: 1, index: -2, offset: 0, data: "abc" }), null);
  assert.equal(sanitizeTextPoint({ id: 1, index: 0, offset: 0, data: 42 }), null);
  assert.deepEqual(sanitizeTextPoint({ id: 1, index: 0, offset: 2, data: "abc", extra: true }), { id: 1, index: 0, offset: 2, data: "abc" });
  assert.deepEqual(sanitizeTextPoint({ id: 3, edge: "end" }), { id: 3, edge: "end" });
});

test("sourceRangeFor selects exactly the selected characters", () => {
  const src = '<!doctype html>\n<body>\n  <h1 class="t">Home &amp; garden</h1>\n  <p>Hello <b>bold</b> world</p>\n</body>\n';
  const parsed = parseHtml(src);
  const h1 = byTag(parsed, "h1");
  // "& gar" in the DOM text "Home & garden"
  const r = sourceRangeFor(parsed, { id: h1.id, index: 0, offset: 5, data: "Home & garden" }, { id: h1.id, index: 0, offset: 10, data: "Home & garden" });
  assert.equal(src.slice(r.from, r.to), "&amp; gar");
  // backwards selection (focus before anchor) gives the same range
  const back = sourceRangeFor(parsed, { id: h1.id, index: 0, offset: 10, data: "Home & garden" }, { id: h1.id, index: 0, offset: 5, data: "Home & garden" });
  assert.deepEqual(back, r);
  // across elements: "lo bold wor" from <p>'s first text node to its second
  const p = byTag(parsed, "p");
  const b = byTag(parsed, "b");
  const r2 = sourceRangeFor(parsed, { id: p.id, index: 0, offset: 3, data: "Hello " }, { id: p.id, index: 1, offset: 4, data: " world" });
  assert.equal(src.slice(r2.from, r2.to), "lo <b>bold</b> wor");
  const r3 = sourceRangeFor(parsed, { id: b.id, index: 0, offset: 0, data: "bold" }, { id: b.id, index: 0, offset: 4, data: "bold" });
  assert.equal(src.slice(r3.from, r3.to), "bold");
});

test("sourceOffsetFor uses element edges and falls back to matching text", () => {
  const src = "<div><p>One</p><!-- c --><p>Two</p></div>";
  const parsed = parseHtml(src);
  const div = byTag(parsed, "div");
  const p2 = byTag(parsed, "p", 1);
  assert.equal(sourceOffsetFor(parsed, { id: p2.id, edge: "start" }), src.indexOf("<p>Two"));
  assert.equal(sourceOffsetFor(parsed, { id: div.id, edge: "end" }), src.indexOf("</div>"));
  // a wrong index (the browser split text differently) still finds the node whose text matches
  assert.equal(sourceOffsetFor(parsed, { id: p2.id, index: 3, offset: 1, data: "Two" }), src.indexOf("Two") + 1);
  // parent not annotated (-1): search the element's descendants
  assert.equal(sourceOffsetFor(parsed, { id: div.id, index: -1, offset: 2, data: "One" }), src.indexOf("One") + 2);
});

test("stale or forged points map to nothing", () => {
  const src = "<p>Hello</p>";
  const parsed = parseHtml(src);
  assert.equal(sourceOffsetFor(parsed, { id: 0, index: 0, offset: 1, data: "Changed" }), null);
  assert.equal(sourceOffsetFor(parsed, { id: 99, index: 0, offset: 0, data: "Hello" }), null);
  assert.equal(sourceOffsetFor(null, { id: 0, index: 0, offset: 0, data: "Hello" }), null);
  assert.equal(sourceRangeFor(parsed, { id: 0, index: 0, offset: 0, data: "Hello" }, { id: 0, index: 0, offset: 9, data: "Hello" }), null);
});
