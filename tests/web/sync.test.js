import test from "node:test";
import assert from "node:assert/strict";
import { parseHtml, parseCss, crumbsOf, openTagLines, cssRuleAt, matchableSelector, rulesForElement, elementAtOffset } from "../../app/src/engine/web/index.js";

const HTML = `<html>
<body>
  <section class="hero big" id="top">
    <h1
      class="t">Hi</h1>
  </section>
</body>
</html>`;

test("crumbs run from the root element to the element with tag, classes and id", () => {
  const p = parseHtml(HTML);
  const h1 = p.elements.find((e) => e.tag === "h1");
  assert.deepEqual(crumbsOf(h1).map((c) => c.label), ["html", "body", "section.hero.big#top", "h1.t"]);
  assert.equal(crumbsOf(h1)[3].id, h1.id);
});

test("the start tag lines cover multi-line tags from column 0 to the end of the last line", () => {
  const p = parseHtml(HTML);
  const h1 = p.elements.find((e) => e.tag === "h1");
  const { from, to } = openTagLines(HTML, h1);
  assert.equal(HTML.slice(from, to), '    <h1\n      class="t">Hi</h1>');
  assert.equal(elementAtOffset(p, from + 6).tag, "h1");
});

test("css: the innermost rule at the caret, also inside @media", () => {
  const css = ".a { color: red; }\n@media (max-width: 600px) {\n  .b > .c { margin: 0; }\n}";
  const p = parseCss(css);
  assert.equal(cssRuleAt(p, css.indexOf("color")).selector, ".a");
  assert.equal(cssRuleAt(p, css.indexOf("margin")).selector, ".b > .c");
  assert.equal(cssRuleAt(p, css.indexOf("@media") + 2), null);
});

test("matchable selectors drop states and pseudo-elements and refuse nesting", () => {
  assert.equal(matchableSelector(".btn:hover, .btn::after"), ".btn");
  assert.equal(matchableSelector("a:focus-visible"), "a");
  assert.equal(matchableSelector(".x > li:not(.y)"), ".x > li:not(.y)");
  assert.equal(matchableSelector("&:hover"), null);
  assert.equal(matchableSelector(""), null);
  assert.equal(matchableSelector("::before"), null);
});

test("rules for an element: tag, id and class compounds of the last selector part", () => {
  const css = "h1 { a: b }\n.hero { a: b }\n#top { a: b }\nsection.hero.big { a: b }\n.other { a: b }\n.nav .hero > h1.t, p { a: b }\n@media (max-width: 600px) { .hero { a: b } }\n.hero:hover { a: b }";
  const files = [{ file: "style.css", parsed: parseCss(css) }];
  const p = parseHtml(HTML);
  const section = p.elements.find((e) => e.tag === "section");
  const sel = rulesForElement(files, section).map((r) => r.selector + (r.media ? " @" + r.media : ""));
  assert.deepEqual(sel, [".hero", "#top", "section.hero.big", ".hero @(max-width: 600px)", ".hero:hover"]);
  const h1 = p.elements.find((e) => e.tag === "h1");
  assert.deepEqual(rulesForElement(files, h1).map((r) => r.selector), ["h1", ".nav .hero > h1.t, p"]);
});
