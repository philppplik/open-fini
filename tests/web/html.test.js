import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHtml, getAttr, hasAttr, classList, elementPath, elementAtPath, elementAtOffset, findByTag, elementText, describe, isVoidTag,
  decodeEntities, escapeText, escapeAttr, childElements, findById, contentRange,
} from "../../app/src/engine/web/html.js";
import { checkHtml } from "./_helpers.js";

const P = (src) => {
  const p = parseHtml(src);
  checkHtml(p);
  return p;
};
const codes = (p) => p.errors.map((d) => d.code);
const slice = (p, el) => p.source.slice(el.start, el.end);

test("basic tree, ranges and ids", () => {
  const src = '<!doctype html>\n<html lang="en-US">\n<head><title>Hi</title></head>\n<body>\n  <h1 class="big title">Hello &amp; welcome</h1>\n  <p>One<br>Two</p>\n</body>\n</html>\n';
  const p = P(src);
  assert.deepEqual(p.elements.map((e) => e.tag), ["html", "head", "title", "body", "h1", "p", "br"]);
  assert.equal(p.children[0].type, "doctype");
  const h1 = findByTag(p, "h1");
  assert.equal(slice(p, h1), '<h1 class="big title">Hello &amp; welcome</h1>');
  assert.equal(src.slice(h1.open.start, h1.open.end), '<h1 class="big title">');
  assert.equal(src.slice(h1.close.start, h1.close.end), "</h1>");
  assert.equal(h1.depth, 2);
  assert.equal(h1.parent.tag, "body");
  assert.deepEqual(classList(h1), ["big", "title"]);
  assert.equal(elementText(p, h1), "Hello & welcome");
  assert.equal(describe(h1), "h1.big.title");
  const br = findByTag(p, "br");
  assert.ok(br.void);
  assert.equal(br.close, null);
  assert.equal(br.end, br.open.end);
  assert.equal(p.errors.filter((d) => d.severity === "error").length, 0);
});

test("attribute forms keep exact ranges", () => {
  const src = `<a href="x.html" target='_blank' rel=noopener data-x = "1 2" hidden disabled="" class=a/b>t</a>`;
  const p = P(src);
  const a = p.elements[0];
  const by = (n) => a.attrs.find((x) => x.name === n);
  assert.equal(by("href").value, "x.html");
  assert.equal(by("href").quote, '"');
  assert.equal(src.slice(by("href").start, by("href").end), 'href="x.html"');
  assert.equal(by("target").quote, "'");
  assert.equal(by("rel").value, "noopener");
  assert.equal(by("rel").quote, "");
  assert.equal(src.slice(by("data-x").start, by("data-x").end), 'data-x = "1 2"');
  assert.equal(by("data-x").value, "1 2");
  assert.equal(by("hidden").value, null);
  assert.equal(by("hidden").quote, null);
  assert.equal(by("hidden").valueStart, by("hidden").end);
  assert.equal(by("disabled").value, "");
  assert.equal(by("class").value, "a/b");
  assert.equal(getAttr(a, "hidden"), "");
  assert.equal(getAttr(a, "missing"), null);
  assert.equal(getAttr(a, "HREF"), "x.html");
  assert.ok(hasAttr(a, "target"));
});

test("tolerates stray quotes, < in values, '>' inside quotes and unterminated quotes", () => {
  let p = P('<div title="a > b <c> d" data-q=\'say "hi"\'>x</div>');
  assert.equal(p.elements.length, 1);
  assert.equal(p.elements[0].attrs[0].value, "a > b <c> d");
  assert.equal(p.elements[0].attrs[1].value, 'say "hi"');
  p = P('<div class="a><p>text</p></div>\n<span>after</span>');
  assert.ok(p.elements.length >= 1);
  assert.ok(p.elements[0].attrs[0].unterminated || p.elements[0].attrs[0].value.length > 0);
  p = P("<div class=a\"b>x</div>");
  assert.equal(p.elements[0].attrs[0].value, 'a"b');
  p = P("a < b and c<3, <3 <> &lt;");
  assert.equal(p.elements.length, 0);
  assert.equal(p.children.length, 1);
});

test("self-closing, void, raw text and escapable raw text elements", () => {
  const src = '<br/><img src="a.png" alt=""/><svg><path d="M0 0"/></svg><script>if (a<b) { x = "</div>"; }</script><style>a>b{c:d}</style><textarea><b>not a tag</b></textarea><title>a <b> c</title>';
  const p = P(src);
  assert.deepEqual(p.elements.map((e) => e.tag), ["br", "img", "svg", "path", "script", "style", "textarea", "title"]);
  const script = findByTag(p, "script");
  assert.equal(script.children.length, 1);
  assert.equal(script.children[0].text, 'if (a<b) { x = "</div>"; }');
  assert.equal(findByTag(p, "style").children[0].text, "a>b{c:d}");
  assert.equal(findByTag(p, "textarea").children[0].text, "<b>not a tag</b>");
  assert.equal(findByTag(p, "title").children.length, 1);
  assert.ok(findByTag(p, "br").selfClosing === false && findByTag(p, "br").void);
  assert.ok(findByTag(p, "path").selfClosing);
  assert.equal(codes(p).includes("html/self-closing"), false);
  assert.equal(codes(P("<div/>text")).includes("html/self-closing"), true);
  assert.equal(elementText(p, script), 'if (a<b) { x = "</div>"; }');
  // case-insensitive end tag
  const q = P("<SCRIPT>var a = 1;</ScRiPt><p>x</p>");
  assert.equal(q.elements.length, 2);
  assert.equal(q.elements[0].tag, "script");
  assert.ok(q.elements[0].close);
});

test("comments, doctype, CDATA and processing instructions", () => {
  const src = "<!DOCTYPE html><!-- a <b> comment --><?xml version='1.0'?><![CDATA[x<y]]><p>t<!----></p><!--->after";
  const p = P(src);
  assert.deepEqual(p.children.map((c) => c.type), ["doctype", "comment", "comment", "comment", "element", "comment", "text"]);
  assert.equal(p.elements.length, 1);
  assert.equal(p.elements[0].children.length, 2);
  const u = P("<p>a</p><!-- never closed <b>x</b>");
  assert.equal(u.children[1].type, "comment");
  assert.equal(u.children[1].end, u.source.length);
  assert.ok(codes(u).includes("html/unclosed-comment"));
});

test("implied end tags", () => {
  const src = "<ul>\n<li>one\n<li>two <b>bold</b>\n<li>three\n</ul>\n<p>para one\n<p>para two<div>block</div>\n<dl><dt>a<dd>b<dt>c<dd>d</dl>\n<table><tr><td>1<td>2<tr><td>3</table><select><option>a<option>b</select>";
  const p = P(src);
  assert.equal(p.errors.filter((d) => d.severity === "error").length, 0, JSON.stringify(p.errors));
  const lis = p.elements.filter((e) => e.tag === "li");
  assert.equal(lis.length, 3);
  assert.ok(lis.every((li) => li.close === null && li.parent.tag === "ul"));
  assert.equal(slice(p, lis[0]), "<li>one\n");
  const ps = p.elements.filter((e) => e.tag === "p");
  assert.equal(ps.length, 2);
  assert.equal(slice(p, ps[0]), "<p>para one\n");
  assert.equal(slice(p, ps[1]), "<p>para two");
  const div = findByTag(p, "div");
  assert.equal(div.parent, null);
  assert.equal(p.elements.filter((e) => e.tag === "dt").length, 2);
  assert.equal(p.elements.filter((e) => e.tag === "dd").every((e) => e.parent.tag === "dl"), true);
  const trs = p.elements.filter((e) => e.tag === "tr");
  assert.equal(trs.length, 2);
  assert.equal(trs[0].children.filter((c) => c.type === "element").length, 2);
  assert.equal(p.elements.filter((e) => e.tag === "option").every((e) => e.parent.tag === "select"), true);
  // nested lists keep their own li
  const n = P("<ul><li>a<ul><li>b<li>c</ul><li>d</ul>");
  const lis2 = n.elements.filter((e) => e.tag === "li");
  assert.equal(lis2.length, 4);
  assert.equal(lis2[3].parent, n.elements[0]);
  assert.equal(lis2[1].parent.tag, "ul");
  assert.equal(lis2[1].parent.parent.tag, "li");
});

test("unclosed elements and stray end tags produce diagnostics", () => {
  let p = P("<div><span>text</div><b>x");
  assert.deepEqual(codes(p), ["html/unclosed", "html/unclosed"]);
  assert.equal(p.elements[1].close, null);
  assert.equal(slice(p, p.elements[1]), "<span>text");
  p = P("<div>a</div></div></p></br>b");
  assert.deepEqual(codes(p), ["html/stray-end-tag", "html/stray-end-tag", "html/stray-end-tag"]);
  assert.equal(p.errors[0].severity, "error");
  p = P("<p>a<div>b");
  assert.deepEqual(codes(p), ["html/unclosed"]);
  p = P("<div class='x");
  assert.ok(codes(p).includes("html/unterminated-tag"));
  p = P("<script>var a;");
  assert.ok(codes(p).includes("html/unclosed"));
});

test("lint diagnostics", () => {
  const src = '<html><body><img src="a.png"><img src="b.png" alt=""><a>x</a><a name="n">y</a><a href="#">z</a><font>f</font><div id="a"></div><div id="a"></div><p class="a" class="b"></p></body></html>';
  const p = P(src);
  const c = codes(p);
  assert.ok(c.includes("html/img-alt"));
  assert.equal(c.filter((x) => x === "html/img-alt").length, 1);
  assert.equal(c.filter((x) => x === "html/empty-link").length, 1);
  assert.ok(c.includes("html/deprecated-tag"));
  assert.ok(c.includes("html/duplicate-id"));
  assert.ok(c.includes("html/duplicate-attr"));
  assert.ok(c.includes("html/missing-doctype"));
  assert.ok(c.includes("html/missing-lang"));
  assert.equal(p.errors.find((d) => d.code === "html/duplicate-id").severity, "warning");
  assert.equal(p.errors.find((d) => d.code === "html/missing-lang").severity, "info");
  const ok = P('<!doctype html><html lang="en-US"><body><img src="a" alt="A"></body></html>');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(P("<p>fragment</p>").errors, []);
});

test("elementPath, elementAtPath and elementAtOffset", () => {
  const src = "<html><body>\n<div><p>a</p><!-- c --><p><b>x</b></p></div>\n<footer></footer></body></html>";
  const p = P(src);
  const b = findByTag(p, "b");
  assert.deepEqual(elementPath(b), [0, 0, 0, 1, 0]);
  assert.equal(elementAtPath(p, [0, 0, 0, 1, 0]), b);
  assert.equal(elementAtPath(p, [0, 0, 1]).tag, "footer");
  assert.equal(elementAtPath(p, [0, 0, 5]), null);
  assert.equal(elementAtPath(p, []), null);
  for (const el of p.elements) assert.equal(elementAtPath(p, elementPath(el)), el);
  assert.equal(elementAtOffset(p, src.indexOf("x</b>")), b);
  assert.equal(elementAtOffset(p, src.indexOf("<b>") + 1), b);
  assert.equal(elementAtOffset(p, src.indexOf("</b>") + 2), b);
  assert.equal(elementAtOffset(p, src.indexOf("<!--")).tag, "div");
  assert.equal(elementAtOffset(p, 0).tag, "html");
  assert.equal(elementAtOffset(p, src.length), null);
  assert.equal(elementAtOffset(p, src.indexOf("<footer>")).tag, "footer");
  assert.equal(elementAtOffset(parseHtml(""), 0), null);
});

test("helpers: findById, childElements, contentRange, describe, isVoidTag", () => {
  const p = P('<div id="top" class="hero wide dark"><p>a</p> text <img src=x alt=""></div>');
  const div = findById(p, "top");
  assert.equal(describe(div), "div.hero.wide#top");
  assert.equal(childElements(div).length, 2);
  assert.deepEqual(contentRange(div), { start: div.open.end, end: div.close.start });
  assert.ok(isVoidTag("IMG") && isVoidTag("br") && !isVoidTag("div"));
  assert.equal(findById(p, "nope"), null);
});

test("entities", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; x&nbsp;y &#x41;&#66; &copy; &unknown; &#0; &#xD800;"), 'a & b <c> "d" \'e\' x y AB © &unknown; � �');
  assert.equal(decodeEntities("no entities"), "no entities");
  assert.equal(escapeText("a & b < c > d"), "a &amp; b &lt; c &gt; d");
  assert.equal(escapeAttr('say "hi" & \'bye\''), "say &quot;hi&quot; &amp; 'bye'");
  assert.equal(escapeAttr("it's", "'"), "it&#39;s");
  assert.equal(decodeEntities(escapeText("x < y && z > w")), "x < y && z > w");
});

test("deep nesting does not overflow the stack", () => {
  const depth = 20000;
  const src = "<div>".repeat(depth) + "x" + "</div>".repeat(depth);
  const p = parseHtml(src);
  assert.equal(p.elements.length, depth);
  assert.equal(p.errors.length, 0);
  assert.equal(elementAtOffset(p, src.indexOf("x")).id, depth - 1);
});

test("never throws on garbage", () => {
  for (const s of ["", "<", "<<<<", "</", "<a", "<a b", "<a b=", "<a b='", "<!", "<!-", "<!--", "<![CDATA[", "<?", "&", "<script", "<style>", "</div", "<p/", "<a =>", "<a = = >", "\0<\0>"]) {
    const p = parseHtml(s);
    checkHtml(p);
  }
  assert.doesNotThrow(() => parseHtml(undefined));
  assert.doesNotThrow(() => parseHtml(null));
});

test("extra diagnostics: unterminated attribute values and end tags", () => {
  assert.ok(codes(P('<a href="x>t</a>')).includes("html/unterminated-attribute"));
  assert.ok(codes(P("<div>x</div")).includes("html/unterminated-tag"));
  assert.ok(codes(P("<div x")).includes("html/unterminated-tag"));
  assert.deepEqual(codes(P('<a href="x">t</a>')), []);
});
