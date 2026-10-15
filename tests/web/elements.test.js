import test from "node:test";
import assert from "node:assert/strict";
import { ELEMENT_CATEGORIES, planInsert, getElementDef } from "../../app/src/engine/web/elements.js";
import { parseHtml, getAttr, classList, elementAtOffset, findAttr } from "../../app/src/engine/web/html.js";
import { parseCss, flattenRules, normalizeMedia } from "../../app/src/engine/web/css.js";
import { applyChanges } from "../../app/src/engine/web/edit.js";
import { checkHtml, checkCss } from "./_helpers.js";

const ALL = ELEMENT_CATEGORIES.flatMap((c) => c.items.map((i) => ({ ...i, category: c.id })));
const labels = (cat) => ELEMENT_CATEGORIES.find((c) => c.id === cat).items.map((i) => i.label);

test("categories and minimum items", () => {
  assert.deepEqual(ELEMENT_CATEGORIES.map((c) => c.label), ["Layout", "Typography", "Media", "Forms", "Navigation", "Sections"]);
  assert.deepEqual(labels("layout"), ["Section", "Container", "Div block", "2 columns", "3 columns", "4 columns", "Flex row", "Stack", "Spacer"]);
  assert.deepEqual(labels("typography"), ["Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6", "Paragraph", "Link", "Button", "Bulleted list", "Numbered list", "Quote", "Code block", "Divider"]);
  assert.deepEqual(labels("media"), ["Image", "Video", "Audio", "Embed", "Figure with caption", "SVG icon"]);
  assert.deepEqual(labels("forms"), ["Form", "Text input", "Email input", "Textarea", "Select", "Checkbox", "Radio group", "Label", "Submit button"]);
  assert.deepEqual(labels("navigation"), ["Navbar", "Footer", "Breadcrumbs", "Pagination"]);
  assert.deepEqual(labels("sections"), ["Hero", "Feature grid", "Pricing table", "Testimonial", "Call to action", "Image gallery", "FAQ", "Stats row", "Team cards"]);
  const ids = ALL.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const i of ALL) {
    assert.match(i.id, /^[a-z0-9-]+$/);
    assert.ok(i.label && i.description.length > 8 && /^[a-z0-9-]+$/.test(i.icon) && i.html, i.id);
    assert.ok(i.description.endsWith("."), i.id);
  }
  assert.equal(getElementDef("hero").label, "Hero");
  assert.equal(getElementDef("nope"), null);
});

for (const item of ALL) {
  test(`snippet ${item.id}: valid HTML without problems, no network requests, valid CSS`, () => {
    const p = parseHtml(item.html);
    checkHtml(p);
    assert.deepEqual(p.errors, [], item.id);
    assert.ok(p.elements.length >= 1);
    assert.ok(p.children.filter((c) => c.type === "element").length === 1, "exactly one root element");
    for (const el of p.elements) {
      if (el.tag === "img") {
        assert.notEqual(getAttr(el, "alt"), null);
        assert.ok(getAttr(el, "width") && getAttr(el, "height"));
      }
      for (const a of el.attrs) {
        if (a.name === "id") assert.fail("snippets use wrapped labels, not ids");
        if (/^(src|href|poster|action)$/.test(a.name) && a.value) assert.ok(a.value.startsWith("#") || a.value.startsWith("data:image/svg+xml,") || a.value === "about:blank" || a.value.startsWith("mailto:"), `${a.name}=${a.value.slice(0, 40)}`);
        assert.ok(!/^on/.test(a.name));
      }
    }
    assert.ok(!/https?:\/\//.test(item.html.replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, "").replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")), "no network URLs");
    assert.ok(!/lorem|ipsum/i.test(item.html));
    if (item.css !== undefined) {
      const c = parseCss(item.css);
      checkCss(c);
      assert.deepEqual(c.errors, [], item.id);
      assert.ok(!/https?:|@import|@font-face/.test(item.css));
      // every class the snippet uses is either styled by the css or a plain hook
      const defined = new Set(flattenRules(c).flatMap((r) => r.selector.match(/\.[A-Za-z_][\w-]*/g) || []).map((s) => s.slice(1)));
      const used = new Set(p.elements.flatMap((e) => classList(e)));
      const unstyled = [...used].filter((u) => !defined.has(u));
      assert.ok(unstyled.length <= 3, `${item.id}: ${unstyled.join(", ")}`);
      // responsive rules follow the shared breakpoints
      for (const r of c.rules) if (r.type === "at") assert.ok(["(max-width: 991px)", "(max-width: 767px)", "(max-width: 478px)"].includes(normalizeMedia(r.prelude)), `${item.id}: ${r.prelude}`);
    }
  });
}

test("layout sections and sections category are complete responsive blocks", () => {
  for (const id of ["hero", "feature-grid", "pricing-table", "gallery", "team-cards", "stats-row", "columns-3", "columns-4"]) {
    assert.match(getElementDef(id).css, /@media \(max-width: (991|767)px\)/, id);
  }
  for (const id of ["feature-grid", "pricing-table", "testimonial", "cta", "gallery", "faq", "stats-row", "team-cards", "hero"]) {
    const def = getElementDef(id);
    assert.ok(/<(section|div)[^>]*class="[^"]*"/.test(def.html), id);
    if (id !== "testimonial" && id !== "stats-row") assert.ok(/<h[12]/.test(def.html), id);
    assert.ok(def.html.includes("alt=") || !def.html.includes("<img"), id);
  }
  assert.ok(getElementDef("faq").html.includes("<details>") && getElementDef("faq").html.includes("<summary>"));
});

const PAGE = '<!doctype html>\n<html lang="en-US">\n<head>\n  <meta charset="utf-8">\n  <title>T</title>\n</head>\n<body>\n  <main>\n    <h1>Hello</h1>\n  </main>\n</body>\n</html>\n';
const SHEET = "body {\n  margin: 0;\n}\n";

test("planInsert inserts at the right place and reports where", () => {
  const html = parseHtml(PAGE);
  const main = html.elements.find((e) => e.tag === "main");
  const hero = getElementDef("hero");
  const plan = planInsert(html, SHEET, main.id, 1, hero);
  const out = applyChanges(PAGE, plan.html.changes);
  assert.ok(out.startsWith("<section", plan.html.at) || out.slice(plan.html.at).startsWith('<section class="hero">'));
  const re = parseHtml(out);
  checkHtml(re);
  assert.equal(elementAtOffset(re, plan.html.at).tag, "section");
  assert.equal(classList(elementAtOffset(re, plan.html.at))[0], "hero");
  assert.deepEqual(re.errors.filter((d) => d.severity === "error"), []);
  // the snippet is indented like its neighbors
  assert.match(out, /\n {4}<section class="hero">\n {6}<div class="container">\n/);
  // CSS: only the missing rules are appended, and the result is valid
  const css = applyChanges(SHEET, plan.css);
  checkCss(parseCss(css));
  assert.ok(css.startsWith(SHEET));
  assert.ok(/\.hero \{/.test(css) && /\.btn-primary \{/.test(css) && /@media \(max-width: 991px\)/.test(css));
  assert.deepEqual(parseCss(css).errors, []);
  // inserting a Hero twice adds the CSS once
  const html2 = parseHtml(out);
  const second = planInsert(html2, css, null, 0, hero);
  assert.deepEqual(second.css, []);
  assert.equal(applyChanges(css, second.css), css);
  // top level insert goes to <body>
  const top = planInsert(html, null, null, 0, getElementDef("navbar"));
  assert.deepEqual(top.css, []);
  const topOut = applyChanges(PAGE, top.html.changes);
  assert.ok(topOut.indexOf("<header") < topOut.indexOf("<main>"));
  assert.equal(elementAtOffset(parseHtml(topOut), top.html.at).tag, "header");
  // def without css, or a missing stylesheet: no css changes
  assert.deepEqual(planInsert(html, SHEET, main.id, 0, getElementDef("paragraph")).css, []);
  assert.deepEqual(planInsert(html, null, main.id, 0, hero).css, []);
  // an empty stylesheet still receives the rules
  assert.ok(applyChanges("", planInsert(html, "", main.id, 0, getElementDef("stack")).css).includes(".stack {"));
});

test("planInsert keeps radio group names and ids unique within the page", () => {
  const radio = getElementDef("radio-group");
  let html = PAGE;
  const names = [];
  for (let i = 0; i < 3; i++) {
    const p = parseHtml(html);
    const plan = planInsert(p, SHEET, null, 99, radio);
    html = applyChanges(html, plan.html.changes);
    names.push(...parseHtml(html).elements.filter((e) => e.tag === "input").map((e) => getAttr(e, "name")));
  }
  const groups = [...new Set(names)];
  assert.deepEqual(groups, ["choice-group", "choice-group-2", "choice-group-3"]);
  // ids and references inside a snippet are renamed together
  const custom = { id: "x", label: "X", icon: "x", description: "A test snippet.", html: '<div><label for="f">Name</label><input id="f" name="n"><a href="#f">jump</a><span aria-labelledby="f"></span></div>' };
  const page = '<body><input id="f"><input id="f-2"></body>';
  const plan = planInsert(parseHtml(page), null, null, 2, custom);
  const out = applyChanges(page, plan.html.changes);
  assert.ok(out.includes('<label for="f-3">') && out.includes('id="f-3"') && out.includes('href="#f-3"') && out.includes('aria-labelledby="f-3"'));
  assert.equal(parseHtml(out).errors.filter((d) => d.code === "html/duplicate-id").length, 0);
});

test("every element can be inserted into a real page and the page stays valid", () => {
  let html = PAGE;
  let css = SHEET;
  for (const item of ALL) {
    const p = parseHtml(html);
    const main = p.elements.find((e) => e.tag === "main");
    const plan = planInsert(p, css, main.id, 1, item);
    html = applyChanges(html, plan.html.changes);
    css = applyChanges(css, plan.css);
    const re = parseHtml(html);
    checkHtml(re);
    assert.deepEqual(re.errors.filter((d) => d.severity === "error"), [], item.id);
    assert.equal(re.errors.filter((d) => d.code === "html/duplicate-id").length, 0, item.id);
    const cp = parseCss(css);
    assert.deepEqual(cp.errors, [], item.id);
  }
  checkCss(parseCss(css));
  // every rule is unique per (selector, media)
  const seen = new Set();
  for (const r of flattenRules(parseCss(css))) {
    let media = "";
    for (let c = r.parent; c; c = c.parent) if (c.type === "at" && c.name === "media") media = normalizeMedia(c.prelude);
    const key = `${r.selector}|${media}`;
    assert.ok(!seen.has(key), `duplicate rule ${key}`);
    seen.add(key);
  }
  // the media blocks follow a desktop-first cascade
  const widths = parseCss(css).rules.filter((r) => r.type === "at" && r.name === "media").map((r) => parseInt(normalizeMedia(r.prelude).match(/\d+/)[0], 10));
  const firstOf = (w) => widths.indexOf(w);
  assert.ok(firstOf(991) < firstOf(767) && firstOf(767) < firstOf(478), widths.join(","));
  assert.equal(findAttr(parseHtml(html).elements[0], "lang").value, "en-US");
});
