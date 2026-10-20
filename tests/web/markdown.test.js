import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, parseFrontMatter, sanitizeHtml, slugify, safeUrl, buildDocumentPage } from "../../app/src/engine/web/markdown.js";
import { highlight, languageId } from "../../app/src/engine/web/highlight.js";
import { rng } from "./_helpers.js";

const md = (s, o) => renderMarkdown(s, { idPrefix: "", ...o }).html;
const eq = (src, html, o) => assert.equal(md(src, o).trim(), html, src);

test("paragraphs, breaks and escapes", () => {
  eq("hello\nworld", "<p>hello\nworld</p>");
  eq("a  \nb", "<p>a<br>\nb</p>");
  eq("a\\\nb", "<p>a<br>\nb</p>");
  eq("a\n\nb", "<p>a</p>\n<p>b</p>");
  eq("\\*not em\\*", "<p>*not em*</p>");
  eq("1 < 2 & 3 > 2", "<p>1 &lt; 2 &amp; 3 &gt; 2</p>");
  eq("&copy; &#35; &#x41; &bogus;", "<p>© # A &amp;bogus;</p>");
  eq("a\nb", "<p>a<br>\nb</p>", { breaks: true });
});

test("ATX and setext headings, ids and explicit ids", () => {
  eq("# Title", '<h1 id="title">Title</h1>');
  eq("###### six ##", '<h6 id="six">six</h6>');
  eq("####### seven", "<p>####### seven</p>");
  eq("#hashtag", "<p>#hashtag</p>");
  eq("Title\n=====", '<h1 id="title">Title</h1>');
  eq("Sub\n---", '<h2 id="sub">Sub</h2>');
  eq("## A {#custom}", '<h2 id="custom">A</h2>');
  const r = renderMarkdown("# A\n## A\n## A", { idPrefix: "" });
  assert.deepEqual(r.headings.map((h) => h.id), ["a", "a-2", "a-3"]);
  assert.equal(renderMarkdown("# Hi *there*").title, "Hi there");
  assert.equal(renderMarkdown("# Über Straße").headings[0].id, "md-uber-strasse");
});

test("emphasis follows the flanking rules", () => {
  eq("*a* _b_", "<p><em>a</em> <em>b</em></p>");
  eq("**a** __b__", "<p><strong>a</strong> <strong>b</strong></p>");
  eq("***a***", "<p><em><strong>a</strong></em></p>");
  eq("snake_case_word", "<p>snake_case_word</p>");
  eq("2 * 3 * 4", "<p>2 * 3 * 4</p>");
  eq("foo*bar*baz", "<p>foo<em>bar</em>baz</p>");
  eq("**bold *nested* bold**", "<p><strong>bold <em>nested</em> bold</strong></p>");
  eq("*a **b** c*", "<p><em>a <strong>b</strong> c</em></p>");
  eq("**unclosed", "<p>**unclosed</p>");
  eq("~~gone~~", "<p><del>gone</del></p>");
});

test("code spans and fenced code", () => {
  eq("`a < b`", "<p><code>a &lt; b</code></p>");
  eq("`` a`b ``", "<p><code>a`b</code></p>");
  eq("```\nx < y\n```", '<pre class="md-code"><code>x &lt; y\n</code></pre>');
  eq("```text\nplain\n```", '<pre class="md-code" data-lang="text"><code class="language-text">plain\n</code></pre>');
  eq("~~~\ntilde\n~~~", '<pre class="md-code"><code>tilde\n</code></pre>');
  eq("````\n```\ninner\n```\n````", '<pre class="md-code"><code>```\ninner\n```\n</code></pre>');
  eq("    indented\n    code", '<pre class="md-code"><code>indented\ncode\n</code></pre>');
  const r = md("```js\nconst a = 1; // hi\n```");
  assert.ok(r.includes('class="tok-keyword">const</span>') && r.includes("tok-comment") && r.includes("tok-number"));
  assert.ok(!md("```js\nconst a = 1;\n```", { highlight: false }).includes("tok-"));
  assert.ok(md("```\nunterminated").includes("unterminated"));
});

test("links, images, references and autolinks", () => {
  eq("[a](http://x.com)", '<p><a href="http://x.com" rel="noopener noreferrer">a</a></p>');
  eq('[a](/p "T")', '<p><a href="/p" title="T">a</a></p>');
  eq("[a](<my file.md>)", '<p><a href="my%20file.md">a</a></p>');
  eq("![alt *x*](img.png)", '<p><img src="img.png" alt="alt x" loading="lazy"></p>');
  eq("[ref][r]\n\n[r]: /url 'title'", '<p><a href="/url" title="title">ref</a></p>');
  eq("[r]\n\n[R]: /u", '<p><a href="/u">r</a></p>');
  eq("[no]\n", "<p>[no]</p>");
  eq("<https://a.b/c>", '<p><a href="https://a.b/c">https://a.b/c</a></p>');
  eq("<me@x.org>", '<p><a href="mailto:me@x.org">me@x.org</a></p>');
  eq("see https://example.com/a_b_c. ok", '<p>see <a href="https://example.com/a_b_c" rel="noopener noreferrer">https://example.com/a_b_c</a>. ok</p>');
  eq("(www.example.com)", '<p>(<a href="http://www.example.com" rel="noopener noreferrer">www.example.com</a>)</p>');
  eq("[a [b](c) d](e)", '<p>[a <a href="c">b</a> d](e)</p>');
  eq("[*em*](u)", '<p><a href="u"><em>em</em></a></p>');
});

test("unsafe URLs are never emitted", () => {
  eq("[x](javascript:alert(1))", "<p>x</p>");
  eq("[x](JaVaScRiPt:alert(1))", "<p>x</p>");
  eq("[x](java&#x09;script:alert(1))", "<p>x</p>");
  eq("[x](data:text/html,<script>)", "<p>x</p>");
  eq("[x](vbscript:x)", "<p>x</p>");
  assert.ok(md("![x](javascript:alert(1))").includes("md-missing-image"));
  assert.ok(md("![x](data:image/png;base64,AAAA)").includes('src="data:image/png;base64,AAAA"'));
  assert.ok(!md("![x](data:text/html;base64,AAAA)").includes("data:text/html"));
  assert.equal(safeUrl("https://a"), "https://a");
  assert.equal(safeUrl("file:///etc/passwd"), null);
  assert.equal(safeUrl("#frag"), "#frag");
});

test("resolveUrl hook maps or drops URLs", () => {
  const out = md("![a](pic.png) [l](doc.md) [e](https://x.org)", { resolveUrl: (u, kind) => (kind === "image" ? `blob:${u}` : u.startsWith("http") ? null : u) });
  assert.ok(out.includes('src="blob:pic.png"'));
  assert.ok(out.includes('<a href="doc.md">l</a>'));
  assert.ok(out.includes(" e") && !out.includes("x.org"));
  assert.ok(md("![a](https://x.org/i.png)", { resolveUrl: () => null }).includes("md-missing-image"));
});

test("block quotes, lazy continuation", () => {
  eq("> a\n> b", "<blockquote>\n<p>a\nb</p>\n</blockquote>");
  eq("> a\nb", "<blockquote>\n<p>a\nb</p>\n</blockquote>");
  eq("> # H\n> text", '<blockquote>\n<h1 id="h">H</h1>\n<p>text</p>\n</blockquote>');
  eq("> a\n\nb", "<blockquote>\n<p>a</p>\n</blockquote>\n<p>b</p>");
  eq("> > deep", "<blockquote>\n<blockquote>\n<p>deep</p>\n</blockquote>\n</blockquote>");
});

test("lists: tight, loose, nested, ordered start", () => {
  eq("- a\n- b", "<ul>\n<li>a</li>\n<li>b</li>\n</ul>");
  eq("- a\n\n- b", "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>");
  eq("1. a\n2. b", "<ol>\n<li>a</li>\n<li>b</li>\n</ol>");
  eq("3. a\n4. b", '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
  eq("- a\n  - b\n  - c\n- d", "<ul>\n<li>a\n<ul>\n<li>b</li>\n<li>c</li>\n</ul></li>\n<li>d</li>\n</ul>");
  eq("- a\n+ b", "<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>");
  eq("* a\n\n  para\n* b", "<ul>\n<li>\n<p>a</p>\n<p>para</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>");
  eq("- a\nlazy", "<ul>\n<li>a\nlazy</li>\n</ul>");
  eq("text\n- item", "<p>text</p>\n<ul>\n<li>item</li>\n</ul>");
  eq("- ```\n  code\n  ```", '<ul>\n<li><pre class="md-code"><code>code\n</code></pre></li>\n</ul>');
  eq("- a\n\n\n- b", md("- a\n\n- b").trim());
  eq("-\n  foo", "<ul>\n<li>foo</li>\n</ul>");
});

test("task lists", () => {
  const h = md("- [ ] todo\n- [x] done\n- plain");
  assert.ok(h.includes('<ul class="task-list">'));
  assert.ok(h.includes('<li class="task-list-item"><input type="checkbox" disabled> todo</li>'));
  assert.ok(h.includes('<input type="checkbox" disabled checked> done'));
  assert.ok(h.includes("<li>plain</li>"));
});

test("thematic breaks", () => {
  eq("---", "<hr>");
  eq("***", "<hr>");
  eq("_ _ _", "<hr>");
  eq("a\n\n---\n\nb", "<p>a</p>\n<hr>\n<p>b</p>");
  eq("- - -", "<hr>");
});

test("GFM tables", () => {
  const h = md("| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | `x\\|y` |");
  assert.ok(h.includes('<th style="text-align:left">a</th>'));
  assert.ok(h.includes('<th style="text-align:right">b</th>'));
  assert.ok(h.includes('<td style="text-align:right">2</td>'));
  assert.ok(h.includes("<code>x|y</code>"));
  assert.equal((h.match(/<tr>/g) || []).length, 3);
  assert.ok(md("a | b\n- | -\n1 | 2").includes("<table"));
  assert.ok(!md("| a | b |\n|---|\n| 1 | 2 |").includes("<table"));
  assert.ok(md("text\n| a |\n|---|\n| 1 |").startsWith("<p>text</p>"));
  assert.ok(md("| a | b |\n|---|---|\n| only |").includes("<td></td>"));
});

test("footnotes", () => {
  const r = renderMarkdown("Text[^1] and again[^1] and[^n].\n\n[^1]: First note.\n[^n]: Second\n    continues.", { idPrefix: "" });
  assert.ok(r.html.includes('<sup class="footnote-ref"><a href="#fn-1" id="fnref-1">1</a></sup>'));
  assert.ok(r.html.includes('id="fnref-1-2"'));
  assert.ok(r.html.includes('<section class="footnotes"'));
  assert.ok(r.html.includes('<li id="fn-1">'));
  assert.ok(r.html.includes("First note."));
  assert.ok(r.html.includes('href="#fnref-1"'));
  assert.equal(r.footnotes, 2);
  assert.ok(md("no def[^x]").includes("[^x]"));
});

test("front matter", () => {
  const fm = parseFrontMatter('---\ntitle: "Hello: World"\ndate: 2026-01-02\ntags: [a, "b c"]\ndraft: false\nn: 3\nlist:\n  - one\n  - two\nsummary: >\n  folded\n  text\n---\n# Body');
  assert.equal(fm.meta.title, "Hello: World");
  assert.equal(fm.meta.date, "2026-01-02");
  assert.deepEqual(fm.meta.tags, ["a", "b c"]);
  assert.equal(fm.meta.draft, false);
  assert.equal(fm.meta.n, 3);
  assert.deepEqual(fm.meta.list, ["one", "two"]);
  assert.equal(fm.meta.summary, "folded text");
  assert.equal(fm.body, "# Body");
  const r = renderMarkdown("---\ntitle: T\n---\n# H", { idPrefix: "" });
  assert.equal(r.title, "T");
  assert.ok(!r.html.includes("title:"));
  assert.ok(renderMarkdown("---\nk: v\n---\ntext", { frontMatter: "table" }).html.includes("md-frontmatter"));
  // a leading rule is not front matter
  assert.equal(parseFrontMatter("---\nnot yaml at all\n---\nx").lines, 0);
  assert.deepEqual(parseFrontMatter("---\n---\nx").meta, {});
  assert.equal(renderMarkdown("---\ntitle: T\n---\n# H", { lineMarkers: true }).html.includes('data-line="4"'), true);
});

test("raw HTML is sanitized", () => {
  assert.equal(sanitizeHtml('<b>x</b>'), "<b>x</b>");
  assert.equal(sanitizeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.ok(!sanitizeHtml('<img src=x onerror="alert(1)">').includes("onerror"));
  assert.ok(!sanitizeHtml('<a href="javascript:alert(1)">x</a>').includes("javascript"));
  assert.ok(!sanitizeHtml('<div class="of-x" id="app" style="x">t</div>').match(/class|id=|style/));
  assert.ok(!sanitizeHtml('<iframe src="https://x"></iframe>').includes("<iframe"));
  assert.ok(!sanitizeHtml("<style>*{}</style>").includes("<style"));
  assert.ok(!sanitizeHtml("<!-- c -->x").includes("<!--"));
  assert.ok(sanitizeHtml('<a href="https://x.org">y</a>').includes('rel="noopener noreferrer"'));
  assert.ok(md("<div>\n\n**md** inside\n\n</div>").includes("<strong>md</strong>"));
  assert.equal(md("inline <span>x</span> and <b>unclosed").trim().endsWith("<b>unclosed</b></p>"), true);
  assert.ok(md("<details>\n<summary>S</summary>\n\nbody\n\n</details>").includes("</details>"));
  assert.ok(!md("<script>alert(1)</script>").includes("<script"));
  assert.ok(!md("x <script>y</script>").includes("<script"));
  assert.ok(!md("<img src=x onerror=alert(1)>").includes("onerror=alert"));
  assert.ok(md("<img src=x onerror=alert(1)>").includes("<img"));
  assert.ok(md("<!-- hidden -->\ntext").includes("text"));
});

test("math placeholders", () => {
  const r = renderMarkdown("Euler $e^{i\\pi}=-1$ and $$x^2$$ and cost $5 or $6.\n\n$$\na=b\n$$", { math: true, idPrefix: "" });
  assert.ok(r.hasMath);
  assert.ok(r.html.includes('class="tex-math" data-display="false" data-tex="e^{i\\pi}=-1"'));
  assert.ok(r.html.includes('data-tex="x^2"'));
  assert.ok(r.html.includes("cost $5 or $6."));
  assert.ok(r.html.includes('<div class="tex-math tex-display" data-display="true" data-tex="a=b">'));
  assert.ok(!md("$x$").includes("tex-math"));
  assert.ok(md('$a"<b>$', { math: true }).includes('data-tex="a&quot;&lt;b&gt;"'));
});

test("mdx-lite", () => {
  const h = md("import X from './x'\nexport const a = 1\n\n# T\n\n<Chart data={1} />\n\ntext <Inline /> end", { mdx: true });
  assert.ok(!h.includes("import X"));
  assert.ok(h.includes('class="md-jsx"'));
  assert.ok(h.includes("&lt;Chart"));
  assert.ok(h.includes("<h1"));
});

test("highlighter", () => {
  assert.equal(languageId("TypeScript"), "js");
  assert.equal(languageId("nope"), null);
  assert.equal(highlight("<b>", "nope"), "&lt;b&gt;");
  assert.ok(highlight('{"a": [1, true]}', "json").includes("tok-propertyName"));
  assert.ok(highlight("<a href='x'>t</a>", "html").includes("tok-tag"));
  assert.ok(highlight("+add\n-del", "diff").includes("tok-inserted"));
  assert.ok(highlight("def f(x):\n  return None  # c", "python").includes("tok-comment"));
  assert.ok(highlight("\\section{A} % c", "latex").includes("tok-keyword"));
  assert.ok(!highlight("<script>alert(1)</script>", "html").includes("<script"));
});

test("slugify and the standalone page", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("***"), "section");
  const page = buildDocumentPage({ html: "<h1>x</h1>", title: "A & B" });
  assert.ok(page.startsWith("<!doctype html>") && page.includes("<title>A &amp; B</title>") && page.includes("@media print"));
});

test("never throws and stays fast on hostile input", () => {
  const rand = rng(7);
  const pieces = ["*", "_", "[", "]", "(", ")", "`", "<", ">", "&", "\\", "\n", "  ", "# ", "- ", "1. ", "> ", "|", "~~", "![", "<b>", "</i>", "$", "[^1]", "http://a.b", "    ", "---", "```", "\t"];
  for (let k = 0; k < 400; k++) {
    let s = "";
    const n = 1 + Math.floor(rand() * 60);
    for (let i = 0; i < n; i++) s += pieces[Math.floor(rand() * pieces.length)] + (rand() < 0.4 ? "word" : "");
    const out = renderMarkdown(s, { math: rand() < 0.5, mdx: rand() < 0.2 }).html;
    assert.ok(!/<script/i.test(out), s);
    assert.ok(!/\son\w+=/i.test(out.replace(/data-tex="[^"]*"/g, "")), s);
  }
  const t = Date.now();
  renderMarkdown("*".repeat(50000) + "a" + "_".repeat(50000));
  renderMarkdown("[".repeat(20000) + "x" + "]".repeat(20000));
  renderMarkdown("> ".repeat(2000) + "x");
  renderMarkdown("- ".repeat(2000) + "x");
  renderMarkdown("<div>".repeat(20000));
  assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
});

test("a realistic README renders", () => {
  const src = `---\ntitle: Demo\n---\n# Demo\n\nA *fast* tool. See [docs](docs/index.md).\n\n## Install\n\n\`\`\`sh\nnpm install demo\n\`\`\`\n\n| Option | Default |\n| --- | --- |\n| \`a\` | 1 |\n\n- [x] done\n- [ ] todo\n\n> Note: be careful.\n\n[^1]: Footnote.\n`;
  const r = renderMarkdown(src);
  assert.equal(r.title, "Demo");
  assert.deepEqual(r.headings.map((h) => h.text), ["Demo", "Install"]);
  assert.ok(r.words > 10);
  assert.ok(r.html.includes("<table") && r.html.includes("<blockquote") && r.html.includes("task-list"));
});
