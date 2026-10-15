import { test } from "node:test";
import assert from "node:assert/strict";
import { expandHtml, expandCss, abbreviationBefore } from "../../app/src/engine/web/emmet.js";

test("html: single tags, ids, classes, attributes and text", () => {
  assert.equal(expandHtml("div").text, "<div></div>");
  assert.equal(expandHtml("div#main.a.b").text, '<div id="main" class="a b"></div>');
  assert.equal(expandHtml(".hero").text, '<div class="hero"></div>');
  assert.equal(expandHtml("p{Hello}").text, "<p>Hello</p>");
  assert.equal(expandHtml('a[href=/x target=_blank]{Go}').text, '<a href="/x" target="_blank">Go</a>');
  assert.equal(expandHtml("img").text, '<img src="" alt="">');
});

test("html: children, siblings, climbing, groups and multiplication", () => {
  assert.equal(expandHtml("ul>li*3").text, "<ul>\n  <li></li>\n  <li></li>\n  <li></li>\n</ul>");
  assert.equal(expandHtml("div>p^footer").text, "<div>\n  <p></p>\n</div>\n<footer></footer>");
  assert.equal(expandHtml("(header>nav)+main").text, "<header>\n  <nav></nav>\n</header>\n<main></main>");
  assert.equal(expandHtml("ul>.item*2").text, '<ul>\n  <li class="item"></li>\n  <li class="item"></li>\n</ul>');
});

test("html: numbering follows the nearest multiplied ancestor", () => {
  assert.equal(expandHtml("ul>li.item$*3").text, '<ul>\n  <li class="item1"></li>\n  <li class="item2"></li>\n  <li class="item3"></li>\n</ul>');
  const t = expandHtml("ul>li*2>a{Link $}").text;
  assert.match(t, /Link 1/);
  assert.match(t, /Link 2/);
  assert.equal(expandHtml("p.a$$*2").text, '<p class="a01"></p>\n<p class="a02"></p>');
});

test("html: doctype snippet and caret placement", () => {
  const doc = expandHtml("!");
  assert.match(doc.text, /^<!doctype html>/);
  assert.match(doc.text, /<html lang="en-US">/);
  assert.equal(doc.text.slice(doc.cursor - 2, doc.cursor + 2).includes("\n"), true);
  const a = expandHtml("a");
  assert.equal(a.text.slice(0, a.cursor), '<a href="');
  const ul = expandHtml("ul>li*2");
  assert.equal(ul.text.slice(0, ul.cursor), "<ul>\n  <li>");
});

test("html: bare words that are not tags stay plain text", () => {
  assert.equal(expandHtml("hello"), null);
  assert.equal(expandHtml(""), null);
  assert.equal(expandHtml("ul>>li"), null);
});

test("html: implicit tag names", () => {
  assert.equal(expandHtml("ul>.x").text.includes("<li"), true);
  assert.equal(expandHtml("table>.row>.cell").text.includes("<tr"), true);
  assert.equal(expandHtml("select>.o").text.includes("<option"), true);
});

test("css: shorthands, units and keywords", () => {
  assert.equal(expandCss("m10").text, "margin: 10px;");
  assert.equal(expandCss("m0-auto").text, "margin: 0 auto;");
  assert.equal(expandCss("p10-20").text, "padding: 10px 20px;");
  assert.equal(expandCss("w100p").text, "width: 100%;");
  assert.equal(expandCss("fz1.2r").text, "font-size: 1.2rem;");
  assert.equal(expandCss("df").text, "display: flex;");
  assert.equal(expandCss("dib").text, "display: inline-block;");
  assert.equal(expandCss("pos:a").text, "position: absolute;");
  assert.equal(expandCss("bgc#fff").text, "background-color: #fff;");
  assert.equal(expandCss("op0.5").text, "opacity: 0.5;");
  assert.equal(expandCss("z10").text, "z-index: 10;");
  assert.equal(expandCss("m10!").text, "margin: 10px !important;");
  assert.equal(expandCss("zzz"), null);
});

test("abbreviationBefore finds the abbreviation ending at the caret", () => {
  assert.deepEqual(abbreviationBefore("  ul>li*3", 9, "html"), { from: 2, abbr: "ul>li*3" });
  assert.deepEqual(abbreviationBefore("<p>a{x y}", 9, "html"), { from: 3, abbr: "a{x y}" });
  assert.equal(abbreviationBefore("  ", 2, "html"), null);
  assert.deepEqual(abbreviationBefore("  m10-20", 8, "css"), { from: 2, abbr: "m10-20" });
});
