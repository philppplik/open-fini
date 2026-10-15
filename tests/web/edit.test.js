import test from "node:test";
import assert from "node:assert/strict";
import { parseHtml, elementAtOffset, findByTag, getAttr, classList, findById } from "../../app/src/engine/web/html.js";
import { parseCss } from "../../app/src/engine/web/css.js";
import {
  applyChanges, mapOffset, detectIndent, setAttribute, setClasses, setInlineStyle, setTag, setText, setInnerHtml, insertHtml, deleteElement,
  duplicateElement, moveElement, wrapElement, unwrapElement, elementSource, findRule, getDeclarations, setDeclarations, deleteRule,
  renameSelector, renameClass, appendRulesIfMissing, findRules,
} from "../../app/src/engine/web/edit.js";
import { checkHtml, checkCss } from "./_helpers.js";

const H = (s) => parseHtml(s);
const C = (s) => parseCss(s);
const byTag = (p, tag, n = 0) => p.elements.filter((e) => e.tag === tag)[n];
/** applies html edit and verifies the result parses consistently */
const run = (src, fn) => {
  const p = H(src);
  const res = fn(p);
  const changes = Array.isArray(res) ? res : res.changes;
  const out = applyChanges(src, changes);
  checkHtml(H(out));
  return out;
};
const runCss = (src, fn) => {
  const out = applyChanges(src, fn(C(src)));
  checkCss(C(out));
  return out;
};

test("applyChanges: order independent, same-offset inserts keep list order, overlap throws", () => {
  const src = "0123456789";
  const a = { from: 1, to: 3, insert: "AB" };
  const b = { from: 5, to: 5, insert: "X" };
  const c = { from: 8, to: 10, insert: "" };
  assert.equal(applyChanges(src, [a, b, c]), "0AB34X567");
  assert.equal(applyChanges(src, [c, b, a]), "0AB34X567");
  assert.equal(applyChanges(src, [{ from: 2, to: 2, insert: "x" }, { from: 2, to: 2, insert: "y" }]), "01xy23456789");
  assert.equal(applyChanges(src, [{ from: 2, to: 4, insert: "-" }, { from: 4, to: 4, insert: "+" }]), "01-+456789");
  assert.equal(applyChanges(src, [{ from: 2, to: 2, insert: "+" }, { from: 2, to: 4, insert: "-" }]), "01+-456789");
  assert.throws(() => applyChanges(src, [{ from: 1, to: 5, insert: "" }, { from: 3, to: 6, insert: "" }]), /Overlapping/);
  assert.throws(() => applyChanges(src, [{ from: 1, to: 5, insert: "" }, { from: 3, to: 3, insert: "x" }]), /Overlapping/);
  assert.throws(() => applyChanges(src, [{ from: 5, to: 20, insert: "" }]));
  assert.equal(applyChanges(src, []), src);
});

test("mapOffset", () => {
  const ch = [{ from: 2, to: 4, insert: "ABCDE" }, { from: 6, to: 6, insert: "!!" }, { from: 8, to: 9, insert: "" }];
  assert.equal(mapOffset(0, ch), 0);
  assert.equal(mapOffset(2, ch), 2);
  assert.equal(mapOffset(3, ch), 2);
  assert.equal(mapOffset(3, ch, "right"), 7);
  assert.equal(mapOffset(4, ch), 7);
  assert.equal(mapOffset(5, ch), 8);
  assert.equal(mapOffset(6, ch, "left"), 9);
  assert.equal(mapOffset(6, ch, "right"), 11);
  assert.equal(mapOffset(7, ch), 12);
  assert.equal(mapOffset(9, ch), 13);
  assert.equal(mapOffset(10, ch), 14);
  assert.equal(mapOffset(5, []), 5);
});

test("detectIndent", () => {
  assert.equal(detectIndent("<div>\n  <p>\n    <b>\n"), "  ");
  assert.equal(detectIndent("a {\n    b: c;\n}\n"), "    ");
  assert.equal(detectIndent("<div>\n\t<p>\n\t\t<b>\n"), "\t");
  assert.equal(detectIndent("no indent"), "  ");
  assert.equal(detectIndent(""), "  ");
});

test("setAttribute: add, update, remove, quote styles, escaping, idempotence", () => {
  const src = '<a href="x.html" target=\'_blank\' rel=noopener hidden>t</a>';
  assert.equal(run(src, (p) => setAttribute(p, 0, "href", "y.html")), '<a href="y.html" target=\'_blank\' rel=noopener hidden>t</a>');
  assert.equal(run(src, (p) => setAttribute(p, 0, "target", "_self")), '<a href="x.html" target=\'_self\' rel=noopener hidden>t</a>');
  assert.equal(run(src, (p) => setAttribute(p, 0, "rel", "no opener")), '<a href="x.html" target=\'_blank\' rel="no opener" hidden>t</a>');
  assert.equal(run(src, (p) => setAttribute(p, 0, "rel", "nofollow")), '<a href="x.html" target=\'_blank\' rel=nofollow hidden>t</a>');
  assert.equal(run(src, (p) => setAttribute(p, 0, "title", 'Say "hi" & bye')), '<a href="x.html" target=\'_blank\' rel=noopener hidden title=\'Say "hi" &amp; bye\'>t</a>'.replace("title='Say \"hi\" &amp; bye'", 'title="Say &quot;hi&quot; &amp; bye"').replace("target='_blank'", "target='_blank'"));
  assert.equal(run(src, (p) => setAttribute(p, 0, "target", null)), '<a href="x.html" rel=noopener hidden>t</a>');
  assert.equal(run(src, (p) => setAttribute(p, 0, "href", null)), "<a target='_blank' rel=noopener hidden>t</a>");
  assert.equal(run(src, (p) => setAttribute(p, 0, "hidden", null)), '<a href="x.html" target=\'_blank\' rel=noopener>t</a>');
  assert.equal(run(src, (p) => setAttribute(p, 0, "hidden", "until-found")), '<a href="x.html" target=\'_blank\' rel=noopener hidden="until-found">t</a>');
  assert.deepEqual(setAttribute(H(src), 0, "hidden", ""), []);
  assert.deepEqual(setAttribute(H(src), 0, "href", "x.html"), []);
  assert.deepEqual(setAttribute(H(src), 0, "missing", null), []);
  assert.deepEqual(setAttribute(H('<a href="a&amp;b">x</a>'), 0, "href", "a&b"), []);
  assert.equal(run('<a href="a&amp;b">x</a>', (p) => setAttribute(p, 0, "href", "c&d")), '<a href="c&amp;d">x</a>');
  assert.equal(run("<input>", (p) => setAttribute(p, 0, "disabled", "")), "<input disabled>");
  assert.equal(run('<input disabled="">', (p) => setAttribute(p, 0, "disabled", "")), '<input disabled="">');
  assert.equal(run('<input disabled="disabled">', (p) => setAttribute(p, 0, "disabled", "")), "<input disabled>");
  assert.equal(run('<img alt="x">', (p) => setAttribute(p, 0, "alt", "")), '<img alt="">');
  assert.equal(run("<img>", (p) => setAttribute(p, 0, "alt", "")), '<img alt="">');
  assert.equal(run("<img/>", (p) => setAttribute(p, 0, "alt", "a")), '<img alt="a"/>');
  assert.equal(run('<img src="a" />', (p) => setAttribute(p, 0, "alt", "a")), '<img src="a" alt="a" />');
  assert.equal(run("<div></div>", (p) => setAttribute(p, 0, "ID", "x")), '<div ID="x"></div>');
  assert.equal(run("<div class='a'></div>", (p) => setAttribute(p, 0, "id", "x")), "<div class='a' id='x'></div>");
  assert.equal(run('<svg viewBox="0 0 1 1"></svg>', (p) => setAttribute(p, 0, "viewbox", "0 0 2 2")), '<svg viewBox="0 0 2 2"></svg>');
  assert.throws(() => setAttribute(H("<a>"), 0, "bad name", "x"));
  assert.throws(() => setAttribute(H("<a>"), 7, "x", "y"));
  // multi-line tags
  const ml = '<img\n  src="a.png"\n  alt="A"\n>';
  assert.equal(run(ml, (p) => setAttribute(p, 0, "width", "10")), '<img\n  src="a.png"\n  alt="A"\n  width="10"\n>');
  assert.equal(run(ml, (p) => setAttribute(p, 0, "alt", null)), '<img\n  src="a.png"\n>');
  assert.equal(run(ml, (p) => setAttribute(p, 0, "src", null)), '<img\n  alt="A"\n>');
  // unterminated quote is repaired when the value changes
  assert.equal(run('<a href="x>text</a>', (p) => setAttribute(p, 0, "href", "y")), '<a href="y">text</a>');
});

test("setClasses", () => {
  assert.equal(run('<div class="a  b">x</div>', (p) => setClasses(p, 0, ["a", "b", "c"])), '<div class="a b c">x</div>');
  assert.deepEqual(setClasses(H('<div class="a  b">x</div>'), 0, ["a", "b"]), []);
  assert.equal(run('<div class="a b">x</div>', (p) => setClasses(p, 0, [])), "<div>x</div>");
  assert.equal(run("<div>x</div>", (p) => setClasses(p, 0, ["hero", " wide  dark ", "hero"])), '<div class="hero wide dark">x</div>');
  assert.deepEqual(setClasses(H("<div>x</div>"), 0, []), []);
});

test("setInlineStyle merges, appends, removes and drops an empty attribute", () => {
  assert.equal(run("<div>x</div>", (p) => setInlineStyle(p, 0, { color: "red", "margin-top": "4px" })), '<div style="color: red; margin-top: 4px;">x</div>');
  assert.equal(run('<div style="color: blue; margin:0">x</div>', (p) => setInlineStyle(p, 0, { color: "red" })), '<div style="color: red; margin:0">x</div>');
  assert.equal(run('<div style="color: blue; margin:0">x</div>', (p) => setInlineStyle(p, 0, { padding: "1px" })), '<div style="color: blue; margin:0; padding: 1px">x</div>');
  assert.equal(run('<div style="color: blue; margin:0;">x</div>', (p) => setInlineStyle(p, 0, { padding: "1px" })), '<div style="color: blue; margin:0; padding: 1px;">x</div>');
  assert.equal(run('<div style="color: blue; margin:0;">x</div>', (p) => setInlineStyle(p, 0, { color: null })), '<div style="margin:0;">x</div>');
  assert.equal(run('<div style="color: blue; margin:0;">x</div>', (p) => setInlineStyle(p, 0, { margin: null })), '<div style="color: blue;">x</div>');
  assert.equal(run('<div style="color: blue">x</div>', (p) => setInlineStyle(p, 0, { color: null })), "<div>x</div>");
  assert.equal(run('<div style="a:b; c:d; e:f">x</div>', (p) => setInlineStyle(p, 0, { c: null })), '<div style="a:b; e:f">x</div>');
  assert.equal(run('<div style="font-family: &quot;Inter&quot;, sans-serif">x</div>', (p) => setInlineStyle(p, 0, { color: "red" })), '<div style="font-family: &quot;Inter&quot;, sans-serif; color: red">x</div>');
  assert.equal(run("<div>x</div>", (p) => setInlineStyle(p, 0, { "font-family": '"A B", serif' })), '<div style="font-family: &quot;A B&quot;, serif;">x</div>');
  assert.deepEqual(setInlineStyle(H('<div style="color: red">x</div>'), 0, { color: "red" }), []);
  assert.deepEqual(setInlineStyle(H("<div>x</div>"), 0, { color: null }), []);
  assert.equal(run('<div style="color:red">x</div>', (p) => setInlineStyle(p, 0, { color: { value: "red", important: true } })), '<div style="color:red !important">x</div>');
});

test("setTag, setText, setInnerHtml", () => {
  assert.equal(run('<div class="a">x</div>', (p) => setTag(p, 0, "section")), '<section class="a">x</section>');
  assert.equal(run("<H1>x</H1>", (p) => setTag(p, 0, "h2")), "<h2>x</h2>");
  assert.equal(run("<ul><li>a</li><li>b</li></ul>", (p) => setTag(p, 1, "div")), "<ul><div>a</div><li>b</li></ul>");
  assert.throws(() => setTag(H("<ul><li>a<li>b</ul>"), 1, "div"), /invalid HTML/);
  assert.throws(() => setTag(H("<div><section>x</section></div>"), 0, "p"), /invalid HTML/);
  assert.throws(() => insertHtml(H("<p>text</p>"), 0, 0, "<section>x</section>"), /block elements/);
  assert.throws(() => insertHtml(H("<div>x</div>"), 0, 0, "<b>unclosed"), /invalid HTML/);
  assert.deepEqual(setTag(H("<div>x</div>"), 0, "DIV"), []);
  assert.throws(() => setTag(H("<div>x</div>"), 0, "img"));
  assert.throws(() => setTag(H("<div>x</div>"), 0, "1bad"));
  assert.equal(run("<p>a &amp; b</p>", (p) => setText(p, 0, "x < y & z")), "<p>x &lt; y &amp; z</p>");
  assert.deepEqual(setText(H("<p>a &amp; b</p>"), 0, "a & b"), []);
  assert.equal(run("<p></p>", (p) => setText(p, 0, "hi")), "<p>hi</p>");
  assert.equal(run("<style>a{b:c}</style>", (p) => setText(p, 0, "d>e{f:g}")), "<style>d>e{f:g}</style>");
  assert.throws(() => setText(H("<br>"), 0, "x"));
  assert.equal(run("<div><p>x</p></div>", (p) => setInnerHtml(p, 0, "<b>y</b>")), "<div><b>y</b></div>");
  assert.equal(run("<ul><li>a\n<li>b\n</ul>", (p) => setText(p, 1, "z")), "<ul><li>z\n<li>b\n</ul>");
});

test("insertHtml: empty and whitespace-only containers", () => {
  assert.equal(run("<body></body>", (p) => insertHtml(p, null, 0, "<p>a</p>")), "<body>\n  <p>a</p>\n</body>");
  assert.equal(run("<body>\n</body>", (p) => insertHtml(p, null, 0, "<p>a</p>")), "<body>\n  <p>a</p>\n</body>");
  assert.equal(run("<div>\n  <section>\n    <div></div>\n  </section>\n</div>", (p) => insertHtml(p, 2, 0, "<p>a</p>")), "<div>\n  <section>\n    <div>\n      <p>a</p>\n    </div>\n  </section>\n</div>");
  assert.equal(run("<p></p>", (p) => insertHtml(p, 0, 0, "<b>x</b>")), "<p><b>x</b></p>");
  assert.equal(run("<p>Hello</p>", (p) => insertHtml(p, 0, 0, "<b>x</b>")), "<p>Hello<b>x</b></p>");
  assert.equal(run("", (p) => insertHtml(p, null, 0, "<p>a</p>")), "<p>a</p>\n");
  assert.equal(run("\t<div></div>", (p) => insertHtml(p, null, 5, "<p>a</p>")), "\t<div></div>\n\t<p>a</p>");
});

test("insertHtml: before, between and after siblings; fragment re-indentation; tabs", () => {
  const src = "<body>\n  <header>H</header>\n  <main>M</main>\n</body>";
  assert.equal(run(src, (p) => insertHtml(p, null, 0, "<nav>N</nav>")), "<body>\n  <nav>N</nav>\n  <header>H</header>\n  <main>M</main>\n</body>");
  assert.equal(run(src, (p) => insertHtml(p, null, 1, "<nav>N</nav>")), "<body>\n  <header>H</header>\n  <nav>N</nav>\n  <main>M</main>\n</body>");
  assert.equal(run(src, (p) => insertHtml(p, null, 2, "<nav>N</nav>")), "<body>\n  <header>H</header>\n  <main>M</main>\n  <nav>N</nav>\n</body>");
  assert.equal(run(src, (p) => insertHtml(p, null, 99, "<nav>N</nav>")), "<body>\n  <header>H</header>\n  <main>M</main>\n  <nav>N</nav>\n</body>");
  assert.equal(
    run(src, (p) => insertHtml(p, null, 1, "\n    <section>\n      <h2>T</h2>\n    </section>\n")),
    "<body>\n  <header>H</header>\n  <section>\n    <h2>T</h2>\n  </section>\n  <main>M</main>\n</body>",
  );
  assert.equal(run("<ul>\n\t<li>a</li>\n</ul>", (p) => insertHtml(p, 0, 1, "<li>b\n<b>x</b></li>")), "<ul>\n\t<li>a</li>\n\t<li>b\n\t<b>x</b></li>\n</ul>");
  assert.equal(run("<p>one <b>two</b> three</p>", (p) => insertHtml(p, 0, 0, "<i>x</i>")), "<p>one <i>x</i><b>two</b> three</p>");
  assert.equal(run("<p>one <b>two</b> three</p>", (p) => insertHtml(p, 0, 1, "<i>x</i>")), "<p>one <b>two</b><i>x</i> three</p>");
  assert.equal(run("<pre>\n  keep\n</pre>", (p) => insertHtml(p, null, 1, "<pre>a\n  b</pre>")), "<pre>\n  keep\n</pre>\n<pre>a\n  b</pre>");
  assert.throws(() => insertHtml(H("<br>"), 0, 0, "<b></b>"));
  assert.throws(() => insertHtml(H("<script></script>"), 0, 0, "<b></b>"));
  assert.deepEqual(insertHtml(H("<div></div>"), 0, 0, "  \n ").changes, []);
});

test("insertHtml: `at` points at the inserted fragment in the new source", () => {
  const cases = [
    ["<body></body>", null, 0], ["<body>\n  <p>a</p>\n</body>", null, 0], ["<body>\n  <p>a</p>\n</body>", null, 1],
    ["<div><p>a</p></div>", 0, 0], ["<div><p>a</p></div>", 0, 1], ["<p>x</p>", null, 0],
  ];
  for (const [src, parent, idx] of cases) {
    const p = H(src);
    const { changes, at } = insertHtml(p, parent, idx, '<aside id="new">N</aside>');
    const out = applyChanges(src, changes);
    assert.ok(out.startsWith('<aside id="new">', at), `${JSON.stringify(src)} -> ${JSON.stringify(out)} at ${at}`);
    assert.equal(getAttr(elementAtOffset(H(out), at), "id"), "new");
  }
});

test("insertHtml without <body>: top level of the document or <html>", () => {
  assert.equal(run("<h1>a</h1>\n<p>b</p>\n", (p) => insertHtml(p, null, 1, "<hr>")), "<h1>a</h1>\n<hr>\n<p>b</p>\n");
  assert.equal(run("<html>\n  <head></head>\n</html>", (p) => insertHtml(p, null, 1, "<body></body>")), "<html>\n  <head></head>\n  <body></body>\n</html>");
});

test("deleteElement removes the whole line and keeps everything else", () => {
  const src = "<ul>\n  <li>a</li>\n  <li>b</li>\n  <li>c</li>\n</ul>\n";
  assert.equal(run(src, (p) => deleteElement(p, 2)), "<ul>\n  <li>a</li>\n  <li>c</li>\n</ul>\n");
  assert.equal(run(src, (p) => deleteElement(p, 1)), "<ul>\n  <li>b</li>\n  <li>c</li>\n</ul>\n");
  assert.equal(run("<p>a <b>x</b> c</p>", (p) => deleteElement(p, 1)), "<p>a  c</p>");
  assert.equal(run("<ul>\n  <li>a</li> <li>b</li>\n</ul>", (p) => deleteElement(p, 1)), "<ul>\n  <li>b</li>\n</ul>");
  assert.equal(run("<div>\n  <p>\n    multi\n    line\n  </p>\n</div>", (p) => deleteElement(p, 1)), "<div>\n</div>");
  assert.equal(run("<ul>\n  <li>a\n  <li>b\n  <li>c\n</ul>", (p) => deleteElement(p, 2)), "<ul>\n  <li>a\n  <li>c\n</ul>");
  assert.equal(run("<ul>\r\n  <li>a</li>\r\n  <li>b</li>\r\n</ul>", (p) => deleteElement(p, 1)), "<ul>\r\n  <li>b</li>\r\n</ul>");
  assert.equal(run("<p>a</p>", (p) => deleteElement(p, 0)), "");
});

test("duplicateElement removes ids from the copy", () => {
  const src = '<body>\n  <section id="a" class="x">\n    <h2 id="t">T</h2>\n  </section>\n</body>';
  const p = H(src);
  const { changes, at } = duplicateElement(p, 1);
  const out = applyChanges(src, changes);
  assert.equal(out, '<body>\n  <section id="a" class="x">\n    <h2 id="t">T</h2>\n  </section>\n  <section class="x">\n    <h2>T</h2>\n  </section>\n</body>');
  assert.ok(out.startsWith('<section class="x">', at));
  const re = H(out);
  assert.equal(re.errors.filter((d) => d.code === "html/duplicate-id").length, 0);
  assert.equal(run("<p>a <b>x</b></p>", (q) => duplicateElement(q, 1)), "<p>a <b>x</b><b>x</b></p>");
  assert.equal(elementSource(p, 2), '<h2 id="t">T</h2>');
  assert.equal(elementSource(H("<ul><li>a\n<li>b</ul>"), 1), "<li>a");
});

test("moveElement: reorder, reparent, no-op and invalid moves", () => {
  const src = "<div>\n  <p id=a>A</p>\n  <p id=b>B</p>\n  <p id=c>C</p>\n</div>";
  const order = (out) => [...out.matchAll(/id=(\w)/g)].map((m) => m[1]).join("");
  let out = run(src, (p) => moveElement(p, 1, 0, 2));
  assert.equal(out, "<div>\n  <p id=b>B</p>\n  <p id=c>C</p>\n  <p id=a>A</p>\n</div>");
  assert.equal(order(run(src, (p) => moveElement(p, 3, 0, 0))), "cab");
  assert.equal(order(run(src, (p) => moveElement(p, 2, 0, 0))), "bac");
  assert.equal(order(run(src, (p) => moveElement(p, 1, 0, 1))), "bac");
  assert.deepEqual(moveElement(H(src), 1, 0, 0).changes, []);
  assert.deepEqual(moveElement(H(src), 2, 0, 1).changes, []);
  assert.deepEqual(moveElement(H(src), 3, 0, 99).changes, []);
  const nested = "<body>\n  <section>\n    <h2>T</h2>\n    <p>x</p>\n  </section>\n  <footer>\n  </footer>\n</body>";
  const p = H(nested);
  const mv = moveElement(p, 3, 4, 0);
  const moved = applyChanges(nested, mv.changes);
  assert.equal(moved, "<body>\n  <section>\n    <h2>T</h2>\n  </section>\n  <footer>\n    <p>x</p>\n  </footer>\n</body>");
  assert.ok(moved.startsWith("<p>x</p>", mv.at));
  const up = moveElement(p, 3, null, 0);
  const upOut = applyChanges(nested, up.changes);
  assert.equal(upOut, "<body>\n  <p>x</p>\n  <section>\n    <h2>T</h2>\n  </section>\n  <footer>\n  </footer>\n</body>");
  assert.ok(upOut.startsWith("<p>x</p>", up.at));
  assert.throws(() => moveElement(p, 1, 1, 0), /itself/);
  assert.throws(() => moveElement(p, 1, 2, 0), /descendants/);
  // moving a whole subtree re-indents it
  const tree = "<div>\n  <section>\n    <ul>\n      <li>a</li>\n    </ul>\n  </section>\n  <aside></aside>\n</div>";
  const t = H(tree);
  const res = moveElement(t, 2, 4, 0);
  const treeOut = applyChanges(tree, res.changes);
  assert.equal(treeOut, "<div>\n  <section>\n  </section>\n  <aside>\n    <ul>\n      <li>a</li>\n    </ul>\n  </aside>\n</div>");
  assert.ok(treeOut.startsWith("<ul>", res.at));
  checkHtml(H(treeOut));
});

test("wrapElement and unwrapElement", () => {
  const src = "<body>\n  <p>a</p>\n  <p>b\n    c</p>\n</body>";
  let p = H(src);
  let w = wrapElement(p, 2, "div", { class: "box", "data-x": 'a"b' });
  let out = applyChanges(src, w.changes);
  assert.equal(out, '<body>\n  <p>a</p>\n  <div class="box" data-x="a&quot;b">\n    <p>b\n      c</p>\n  </div>\n</body>');
  assert.ok(out.startsWith("<div", w.at));
  assert.equal(run("<p>a <b>x</b> c</p>", (q) => wrapElement(q, 1, "span").changes), "<p>a <span><b>x</b></span> c</p>");
  assert.throws(() => wrapElement(p, 1, "bad tag"));
  assert.throws(() => wrapElement(p, 1, "div", { "bad name": "x" }));
  // unwrap round trip
  const wrapped = out;
  const un = run(wrapped, (q) => unwrapElement(q, 2));
  assert.equal(un, src);
  assert.equal(run("<p>a <b>x</b> c</p>", (q) => unwrapElement(q, 1)), "<p>a x c</p>");
  assert.equal(run("<body>\n  <div>\n  </div>\n  <p>z</p>\n</body>", (q) => unwrapElement(q, 1)), "<body>\n  <p>z</p>\n</body>");
  assert.equal(run("<body>\n  <img src=a alt=''>\n</body>", (q) => unwrapElement(q, 1)), "<body>\n</body>");
  assert.equal(run("<body>\n\t<div class=w>\n\t\t<p>a</p>\n\t\t<p>b</p>\n\t</div>\n</body>", (q) => unwrapElement(q, 1)), "<body>\n\t<p>a</p>\n\t<p>b</p>\n</body>");
});

test("CRLF sources keep their line endings", () => {
  const src = "<body>\r\n  <p>a</p>\r\n</body>";
  const out = run(src, (p) => insertHtml(p, null, 1, "<p>b</p>"));
  assert.equal(out, "<body>\r\n  <p>a</p>\r\n  <p>b</p>\r\n</body>");
  assert.equal(run(src, (p) => wrapElement(p, 1, "div").changes), "<body>\r\n  <div>\r\n    <p>a</p>\r\n  </div>\r\n</body>");
  assert.ok(!/\r\r/.test(run(src, (p) => duplicateElement(p, 1).changes)));
});

// ------------------------------------------------------------------------------------------------ CSS

const SHEET = `/* site */
:root { --a: 1; }

.hero {
  color: red;
  margin: 0 auto;
}

.btn { color: blue; padding: 4px }

@media (max-width: 991px) {
  .hero {
    color: green;
  }
}
`;

test("findRule, findRules and getDeclarations", () => {
  const p = C(SHEET);
  assert.equal(findRule(p, { selector: ".hero" }).decls.length, 2);
  assert.equal(findRule(p, { selector: ".hero", media: "(max-width:991px)" }).decls[0].value, "green");
  assert.equal(findRule(p, { selector: ".hero", media: "(max-width: 767px)" }), null);
  assert.equal(findRule(p, { selector: " .btn " }).selector, ".btn");
  assert.equal(findRule(p, { selector: ".nope" }), null);
  assert.deepEqual(Object.keys(getDeclarations(p, { selector: ".hero" })), ["color", "margin"]);
  assert.equal(getDeclarations(p, { selector: ".hero" }).color.value, "red");
  assert.deepEqual(getDeclarations(p, { selector: ".nope" }), {});
  const dup = C(".a{color:red;margin:0}.a{color:blue}");
  assert.equal(findRules(dup, { selector: ".a" }).length, 2);
  assert.equal(getDeclarations(dup, { selector: ".a" }).color.value, "blue");
  assert.equal(getDeclarations(dup, { selector: ".a" }).margin.value, "0");
  const dupLast = C(".a{color:red;color:blue}");
  assert.equal(getDeclarations(dupLast, { selector: ".a" }).color.value, "blue");
  const nested = C(".p{&:hover{color:red}}");
  assert.equal(findRule(nested, { selector: "&:hover" }), null);
});

test("setDeclarations updates in place and appends with matching indentation", () => {
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".hero" }, { color: "teal" })), SHEET.replace("color: red;", "color: teal;"));
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".hero" }, { padding: "8px" })), SHEET.replace("margin: 0 auto;\n}", "margin: 0 auto;\n  padding: 8px;\n}"));
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".btn" }, { margin: "1px", color: "red" })), SHEET.replace(".btn { color: blue; padding: 4px }", ".btn { color: red; padding: 4px; margin: 1px; }"));
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".hero", media: "(max-width: 991px)" }, { color: "navy", gap: "4px" })), SHEET.replace("    color: green;\n", "    color: navy;\n    gap: 4px;\n"));
  assert.equal(runCss(".a {}", (p) => setDeclarations(p, { selector: ".a" }, { color: "red" })), ".a {\n  color: red;\n}");
  assert.equal(runCss(".a {\n}", (p) => setDeclarations(p, { selector: ".a" }, { color: "red", margin: "0" })), ".a {\n  color: red;\n  margin: 0;\n}");
  assert.equal(runCss(".a{}", (p) => setDeclarations(p, { selector: ".a" }, { color: "red" })), ".a{\n  color: red;\n}");
  assert.equal(runCss("@media (x) {\n  .a {\n  }\n}", (p) => setDeclarations(p, { selector: ".a", media: "(x)" }, { color: "red" })), "@media (x) {\n  .a {\n    color: red;\n  }\n}");
  assert.equal(runCss("\t.a {\n\t\tcolor: red\n\t}", (p) => setDeclarations(p, { selector: ".a" }, { margin: "0" })), "\t.a {\n\t\tcolor: red;\n\t\tmargin: 0;\n\t}");
  assert.equal(runCss(".a {\n  color: red; /* brand */\n}", (p) => setDeclarations(p, { selector: ".a" }, { margin: "0" })), ".a {\n  color: red; /* brand */\n  margin: 0;\n}");
  assert.equal(runCss(".a {\n  color: red /* brand */\n}", (p) => setDeclarations(p, { selector: ".a" }, { margin: "0" })), ".a {\n  color: red; /* brand */\n  margin: 0;\n}");
  assert.equal(runCss(".p {\n  &:hover { x: y }\n}", (p) => setDeclarations(p, { selector: ".p" }, { color: "red" })), ".p {\n  color: red;\n  &:hover { x: y }\n}");
  assert.equal(runCss(".a { color: red; color: blue }", (p) => setDeclarations(p, { selector: ".a" }, { color: "green" })), ".a { color: red; color: green }");
  assert.equal(runCss(".a { --x: ; }", (p) => setDeclarations(p, { selector: ".a" }, { "--x": "1" })), ".a { --x: 1; }");
});

test("setDeclarations handles !important, idempotence and removal", () => {
  assert.equal(runCss(".a { color: red; }", (p) => setDeclarations(p, { selector: ".a" }, { color: { value: "red", important: true } })), ".a { color: red !important; }");
  assert.equal(runCss(".a { color: red !important; }", (p) => setDeclarations(p, { selector: ".a" }, { color: { value: "red", important: false } })), ".a { color: red; }");
  assert.equal(runCss(".a { color: red !important; }", (p) => setDeclarations(p, { selector: ".a" }, { color: "blue" })), ".a { color: blue !important; }");
  assert.equal(runCss(".a { }", (p) => setDeclarations(p, { selector: ".a" }, { color: { value: "red", important: true } })), ".a {\n  color: red !important;\n}");
  assert.deepEqual(setDeclarations(C(SHEET), { selector: ".hero" }, { color: "red", margin: "0 auto" }), []);
  assert.deepEqual(setDeclarations(C(SHEET), { selector: ".hero" }, { padding: null }), []);
  assert.deepEqual(setDeclarations(C(SHEET), { selector: ".nope" }, { padding: null }), []);
  assert.deepEqual(setDeclarations(C(SHEET), { selector: ".hero" }, {}), []);
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".hero" }, { margin: null })), SHEET.replace("  margin: 0 auto;\n", ""));
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".hero" }, { margin: "" })), SHEET.replace("  margin: 0 auto;\n", ""));
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".btn" }, { color: null })), SHEET.replace("{ color: blue; padding: 4px }", "{ padding: 4px }"));
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".btn" }, { padding: null })), SHEET.replace("{ color: blue; padding: 4px }", "{ color: blue; }"));
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".hero" }, { color: null, margin: "0" })), SHEET.replace("  color: red;\n  margin: 0 auto;\n", "  margin: 0;\n").replace("  margin: 0;\n", "  margin: 0;\n"));
  assert.equal(runCss(".a {\n  color: red;\n  margin: 0;\n}", (p) => setDeclarations(p, { selector: ".a" }, { margin: null, padding: "1px" })), ".a {\n  color: red;\n  padding: 1px;\n}");
});

test("setDeclarations removes empty rules and empty media blocks", () => {
  assert.equal(
    runCss(SHEET, (p) => setDeclarations(p, { selector: ".hero", media: "(max-width: 991px)" }, { color: null })),
    SHEET.replace("\n@media (max-width: 991px) {\n  .hero {\n    color: green;\n  }\n}\n", ""),
  );
  assert.equal(runCss(SHEET, (p) => setDeclarations(p, { selector: ".btn" }, { color: null, padding: null })), SHEET.replace(".btn { color: blue; padding: 4px }\n\n", ""));
  assert.equal(runCss(".a {\n  x: y;\n}\n\n.b {\n  z: w;\n}\n", (p) => setDeclarations(p, { selector: ".b" }, { z: null })), ".a {\n  x: y;\n}\n");
  assert.equal(
    runCss("@media (a) {\n  .x { a: b }\n  .y { c: d }\n}\n", (p) => setDeclarations(p, { selector: ".x", media: "(a)" }, { a: null })),
    "@media (a) {\n  .y { c: d }\n}\n",
  );
  // a rule that still holds nested rules stays
  assert.equal(runCss(".p { color: red; &:hover { x: y } }", (p) => setDeclarations(p, { selector: ".p" }, { color: null })), ".p { &:hover { x: y } }");
});

test("setDeclarations creates rules; media blocks follow the desktop-first cascade", () => {
  assert.equal(runCss("", (p) => setDeclarations(p, { selector: ".a" }, { color: "red" })), ".a {\n  color: red;\n}\n");
  assert.equal(runCss(".x {\n  a: b;\n}\n", (p) => setDeclarations(p, { selector: ".a" }, { color: "red" })), ".x {\n  a: b;\n}\n\n.a {\n  color: red;\n}\n");
  assert.equal(runCss(".x {\n  a: b;\n}", (p) => setDeclarations(p, { selector: ".a" }, { color: "red" })), ".x {\n  a: b;\n}\n\n.a {\n  color: red;\n}\n");
  assert.equal(runCss(".x {\n  a: b;\n}\n\n\n", (p) => setDeclarations(p, { selector: ".a" }, { color: "red" })), ".x {\n  a: b;\n}\n\n\n.a {\n  color: red;\n}\n");
  assert.equal(runCss("  .x {\n    a: b;\n  }\n", (p) => setDeclarations(p, { selector: ".a" }, { color: "red", margin: null })), "  .x {\n    a: b;\n  }\n\n.a {\n  color: red;\n}\n");
  assert.equal(
    runCss(".x {\n  a: b;\n}\n", (p) => setDeclarations(p, { selector: ".x", media: "(max-width: 991px)" }, { a: "c" })),
    ".x {\n  a: b;\n}\n\n@media (max-width: 991px) {\n  .x {\n    a: c;\n  }\n}\n",
  );
  // reuse an existing block, same normalized prelude
  const withBlock = ".x {\n  a: b;\n}\n\n@media (max-width: 991px) {\n  .x {\n    a: c;\n  }\n}\n";
  assert.equal(
    runCss(withBlock, (p) => setDeclarations(p, { selector: ".y", media: "(max-width:991px)" }, { d: "e" })),
    ".x {\n  a: b;\n}\n\n@media (max-width: 991px) {\n  .x {\n    a: c;\n  }\n\n  .y {\n    d: e;\n  }\n}\n",
  );
  // ordering: 991 then 767 then 478; min-width after max-width
  let css = ".x {\n  a: b;\n}\n";
  for (const m of ["(max-width: 478px)", "(max-width: 991px)", "(min-width: 1440px)", "(max-width: 767px)", "(min-width: 1920px)"]) {
    css = runCss(css, (p) => setDeclarations(p, { selector: ".x", media: m }, { a: m }));
  }
  const order = [...css.matchAll(/@media ([^{]+) \{/g)].map((m) => m[1]);
  assert.deepEqual(order, ["(max-width: 991px)", "(max-width: 767px)", "(max-width: 478px)", "(min-width: 1440px)", "(min-width: 1920px)"]);
  assert.equal(css.startsWith(".x {\n  a: b;\n}\n\n@media (max-width: 991px)"), true);
  // other queries go to the end
  const other = runCss(css, (p) => setDeclarations(p, { selector: ".x", media: "(prefers-reduced-motion: reduce)" }, { a: "none" }));
  assert.ok(other.trimEnd().endsWith("@media (prefers-reduced-motion: reduce) {\n  .x {\n    a: none;\n  }\n}"));
  // a new top-level rule goes before a media block that already styles the same selector
  const only = "@media (max-width: 991px) {\n  .z {\n    a: c;\n  }\n}\n";
  assert.equal(runCss(only, (p) => setDeclarations(p, { selector: ".z" }, { a: "b" })), ".z {\n  a: b;\n}\n\n" + only);
  // creating with only removals does nothing
  assert.deepEqual(setDeclarations(C(""), { selector: ".a" }, { color: null }), []);
  // tabs
  assert.equal(runCss("\t.x {\n\t\ta: b;\n\t}\n", (p) => setDeclarations(p, { selector: ".x", media: "(max-width: 991px)" }, { a: "c" })), "\t.x {\n\t\ta: b;\n\t}\n\n@media (max-width: 991px) {\n\t.x {\n\t\ta: c;\n\t}\n}\n");
});

test("deleteRule, renameSelector, renameClass", () => {
  assert.equal(runCss(SHEET, (p) => deleteRule(p, { selector: ".btn" })), SHEET.replace(".btn { color: blue; padding: 4px }\n\n", ""));
  assert.equal(runCss(SHEET, (p) => deleteRule(p, { selector: ".hero", media: "(max-width: 991px)" })), SHEET.replace("\n@media (max-width: 991px) {\n  .hero {\n    color: green;\n  }\n}\n", ""));
  assert.equal(runCss(SHEET, (p) => deleteRule(p, { selector: ".hero" })), SHEET.replace(".hero {\n  color: red;\n  margin: 0 auto;\n}\n\n", ""));
  assert.deepEqual(deleteRule(C(SHEET), { selector: ".none" }), []);
  assert.equal(runCss(SHEET, (p) => renameSelector(p, ".hero", ".banner")), SHEET.replaceAll(".hero", ".banner"));
  assert.equal(runCss(SHEET, (p) => renameSelector(p, ".HERO", ".banner")), SHEET);
  assert.deepEqual(renameSelector(C(SHEET), ".nope", ".x"), []);
  const sel = 'a.btn:hover, .btn > span, [data-x=".btn"], .btn-lg, .x\\.btn, .card:not(.btn), /* .btn */ .y {}';
  assert.equal(runCss(sel, (p) => renameClass(p, "btn", "button")), 'a.button:hover, .button > span, [data-x=".btn"], .btn-lg, .x\\.btn, .card:not(.button), /* .btn */ .y {}');
  assert.equal(runCss(".a.b{}@media (x){.b .a{}}", (p) => renameClass(p, ".a", "c")), ".c.b{}@media (x){.b .c{}}");
  assert.deepEqual(renameClass(C(".a{}"), "a", "a"), []);
  assert.equal(runCss(".md\\:flex{}", (p) => renameClass(p, "md:flex", "md:grid")), ".md\\:grid{}");
});

test("appendRulesIfMissing adds only the missing (selector, media) pairs", () => {
  const css = ".hero { color: red; }\n\n.btn { x: y; }\n";
  const add = ".hero { color: blue; }\n.hero-title { font-size: 2rem; }\n@media (max-width: 767px) {\n  .hero-title { font-size: 1.5rem; }\n  .hero { padding: 0; }\n}\n@keyframes fade { from { opacity: 0 } to { opacity: 1 } }\n";
  const out = runCss(css, (p) => appendRulesIfMissing(css, add));
  assert.equal(
    out,
    ".hero { color: red; }\n\n.btn { x: y; }\n\n.hero-title {\n  font-size: 2rem;\n}\n\n@keyframes fade {\n  from {\n    opacity: 0;\n  }\n\n  to {\n    opacity: 1;\n  }\n}\n\n@media (max-width: 767px) {\n  .hero-title {\n    font-size: 1.5rem;\n  }\n\n  .hero {\n    padding: 0;\n  }\n}\n",
  );
  // running it again changes nothing
  assert.deepEqual(appendRulesIfMissing(out, add), []);
  assert.deepEqual(appendRulesIfMissing(out, ""), []);
  // into an existing, differently formatted media block
  const withMedia = ".hero { a: b }\n@media (max-width:767px) {\n    .x { a: b }\n}\n";
  const out2 = applyChanges(withMedia, appendRulesIfMissing(withMedia, "@media (max-width: 767px) { .y { c: d } }"));
  assert.equal(out2, ".hero { a: b }\n@media (max-width:767px) {\n    .x { a: b }\n\n    .y {\n        c: d;\n    }\n}\n");
  // into empty source
  assert.equal(applyChanges("", appendRulesIfMissing("", ".a { b: c }")), ".a {\n  b: c;\n}\n");
  // media blocks go in cascade order
  const base = "@media (max-width: 478px) { .a { x: y } }\n";
  const out3 = applyChanges(base, appendRulesIfMissing(base, "@media (max-width: 991px) { .a { x: z } }"));
  assert.ok(out3.indexOf("991px") < out3.indexOf("478px"));
});

test("changes never touch text outside the edited range", () => {
  const html = '<!doctype html>\n<html lang="en-US">\n<head>\n  <title>T</title>\n</head>\n<body>\n  <!-- keep -->\n  <h1   class="a"  id="t">Hello</h1>\n  <p>x</p>\n</body>\n</html>\n';
  const p = H(html);
  const h1 = findById(p, "t");
  const ch = setAttribute(p, h1.id, "class", "b");
  assert.equal(ch.length, 1);
  const out = applyChanges(html, ch);
  assert.equal(out.slice(0, ch[0].from), html.slice(0, ch[0].from));
  assert.equal(out.slice(out.length - (html.length - ch[0].to)), html.slice(ch[0].to));
  assert.equal(out, html.replace('class="a"', 'class="b"'));
  assert.deepEqual(classList(findByTag(H(out), "h1")), ["b"]);
});

test("new base rules go before the first width-based @media block so media blocks can override them", () => {
  const css = ".card {\n  padding: 8px;\n}\n\n@media (max-width: 991px) {\n  .card {\n    padding: 4px;\n  }\n}\n\n@media (max-width: 478px) {\n  .card {\n    padding: 2px;\n  }\n}\n";
  // (1) the new base rule lands before the tablet block ...
  const withBase = runCss(css, (p) => setDeclarations(p, { selector: ".heading" }, { "font-size": "60px" }));
  assert.equal(withBase, ".card {\n  padding: 8px;\n}\n\n.heading {\n  font-size: 60px;\n}\n\n" + css.slice(css.indexOf("@media (max-width: 991px)")));
  // ... and the tablet edit for the same selector goes INTO the existing block
  const both = runCss(withBase, (p) => setDeclarations(p, { selector: ".heading", media: "(max-width: 991px)" }, { "font-size": "40px" }));
  assert.equal(both.match(/@media \(max-width: 991px\)/g).length, 1);
  assert.ok(both.indexOf(".heading {\n  font-size: 60px;") < both.indexOf("@media (max-width: 991px)"));
  assert.match(both, /@media \(max-width: 991px\) \{\n {2}\.card \{\n {4}padding: 4px;\n {2}\}\n\n {2}\.heading \{\n {4}font-size: 40px;\n {2}\}\n\}/);
  // the intended cascade: base first, then the tablet override, then the phone block
  const order = [...both.matchAll(/font-size: (\d+)px/g)].map((m) => m[1]);
  assert.deepEqual(order, ["60", "40"]);
  assert.ok(both.indexOf("font-size: 40px") < both.indexOf("@media (max-width: 478px)"));
  // min-width blocks count as width-based as well
  const minOnly = "@media (min-width: 1440px) {\n  .a {\n    x: y;\n  }\n}\n";
  assert.equal(runCss(minOnly, (p) => setDeclarations(p, { selector: ".b" }, { c: "d" })), ".b {\n  c: d;\n}\n\n" + minOnly);
  // a block that is not at the start of its line is not used as an anchor
  assert.equal(runCss(".a{b:c} @media (max-width: 10px){.a{b:d}}", (p) => setDeclarations(p, { selector: ".z" }, { c: "d" })).startsWith(".a{b:c} @media"), true);

  // (2) queries that are not width based do not count
  const other = ".x {\n  a: b;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .x {\n    a: none;\n  }\n}\n\n@media print {\n  .x {\n    a: none;\n  }\n}\n";
  assert.equal(runCss(other, (p) => setDeclarations(p, { selector: ".y" }, { c: "d" })), other + "\n.y {\n  c: d;\n}\n");
  // a width block after a non-width block: the rule goes in front of the width block, behind the other one
  const mixed = "@media print {\n  .x {\n    a: none;\n  }\n}\n\n@media (max-width: 767px) {\n  .x {\n    a: b;\n  }\n}\n";
  const mixedOut = runCss(mixed, (p) => setDeclarations(p, { selector: ".y" }, { c: "d" }));
  assert.ok(mixedOut.indexOf("@media print") < mixedOut.indexOf(".y {") && mixedOut.indexOf(".y {") < mixedOut.indexOf("@media (max-width: 767px)"));

  // (3) no media blocks: still appended at the end
  assert.equal(runCss(".x {\n  a: b;\n}\n", (p) => setDeclarations(p, { selector: ".y" }, { c: "d" })), ".x {\n  a: b;\n}\n\n.y {\n  c: d;\n}\n");

  // new media blocks keep the cascade order (max-width descending, after the existing blocks they must follow)
  const media = runCss(css, (p) => setDeclarations(p, { selector: ".card", media: "(max-width: 767px)" }, { padding: "3px" }));
  assert.deepEqual([...media.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => m[1]), ["991", "767", "478"]);
});

test("appendRulesIfMissing inserts base rules before the first width-based @media block", () => {
  const css = ".hero {\n  color: red;\n}\n\n@media (max-width: 991px) {\n  .hero {\n    color: blue;\n  }\n}\n";
  const add = ".hero-title { font-size: 2rem; }\n@media (max-width: 991px) { .hero-title { font-size: 1.5rem; } }\n@media (max-width: 767px) { .hero-title { font-size: 1.25rem; } }";
  const out = applyChanges(css, appendRulesIfMissing(css, add));
  checkCss(C(out));
  const base = out.indexOf(".hero-title {\n  font-size: 2rem;");
  const tablet = out.indexOf("@media (max-width: 991px)");
  assert.ok(base > 0 && base < tablet, "the base rule precedes the tablet block");
  assert.equal(out.match(/@media \(max-width: 991px\)/g).length, 1, "the existing tablet block is reused");
  assert.match(out, /@media \(max-width: 991px\) \{\n {2}\.hero \{\n {4}color: blue;\n {2}\}\n\n {2}\.hero-title \{\n {4}font-size: 1\.5rem;\n {2}\}\n\}/);
  assert.ok(out.indexOf("@media (max-width: 767px)") > tablet, "the new phone block comes after the tablet block");
  assert.deepEqual(appendRulesIfMissing(out, add), []);
  // without width-based blocks the rules are appended at the end
  const plain = ".hero {\n  color: red;\n}\n";
  const plainOut = applyChanges(plain, appendRulesIfMissing(plain, ".cta { margin: 0; }"));
  assert.equal(plainOut, plain + "\n.cta {\n  margin: 0;\n}\n");
  // non-width queries are ignored as anchors
  const rm = "@media (prefers-reduced-motion: reduce) {\n  .hero {\n    color: red;\n  }\n}\n";
  assert.equal(applyChanges(rm, appendRulesIfMissing(rm, ".cta { margin: 0; }")), rm + "\n.cta {\n  margin: 0;\n}\n");
});

test("removing an attribute never glues the neighboring tokens together", () => {
  assert.equal(run('<button class="btn"{type="submit">Go</button>', (p) => setAttribute(p, 0, "class", null)), '<button {type="submit">Go</button>');
  assert.equal(run('<svg class="a"width="24"></svg>', (p) => setClasses(p, 0, [])), '<svg width="24"></svg>');
});

test("structure-changing edits refuse to produce invalid markup", () => {
  assert.throws(() => moveElement(H("<ul><li><a href=#>x</a></li><li>y</li></ul>"), 3, 2, 0), /invalid HTML/);
  assert.equal(run("<div><p>a</p></div>", (p) => setTag(p, 0, "section")), "<section><p>a</p></section>");
});
