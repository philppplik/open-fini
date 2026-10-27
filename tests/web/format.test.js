import test from "node:test";
import assert from "node:assert/strict";
import { formatHtml, formatJs, formatJson, formatMarkdown, formatText, formatRange, canFormat, parseHtml, parseCss, formatCss, TEMPLATES } from "../../app/src/engine/web/index.js";

/** Structure signature of an HTML source: tags, attributes and whitespace-collapsed text (what renders). */
function sig(html) {
  const parsed = parseHtml(html);
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === "text") {
        const t = n.text.replace(/\s+/g, " ");
        if (t.trim()) out.push(`#${t.trim()}`);
      } else if (n.type === "element") {
        const raw = ["script", "style", "pre", "textarea"].includes(n.tag);
        out.push(`<${n.tag} ${n.attrs.map((a) => `${a.name}=${a.value}`).join(" ")}>`);
        if (raw) {
          // pre/textarea keep every character; script/style only their tokens (whitespace and a final `;` may change)
          const body = html.slice(n.open.end, n.close ? n.close.start : n.end);
          out.push(`~${n.tag === "pre" || n.tag === "textarea" ? body : body.replace(/\s+/g, "").replace(/;}/g, "}")}`);
        }
        else walk(n.children);
      } else if (n.type === "comment") out.push(`!${html.slice(n.start, n.end)}`);
    }
  };
  walk(parsed.children);
  return out.join("|");
}

const SAMPLE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>  Spaced   title </title>
<style>body{margin:0}.a{color:red}</style></head>
<body class="x   y">
<header><nav><a href="/">Home</a>   <a href="/a">About</a></nav></header>
<main>
<h1>Hello   <em>big</em> world</h1>

<p>Some <b>bold</b>, <i>italic</i> and a very long line of text that keeps going and going so that it has to be wrapped somewhere around the line width limit.</p>
<pre>  keep
    this   exactly
</pre>
<textarea name="t">
  a   b
</textarea>
<ul><li>One<li>Two</ul>
<img src="a.png" alt="x"><br>
<button type="submit" class="btn btn-primary btn-lg" data-toggle="modal" data-target="#exampleModal" aria-label="Open the dialog">Go</button>
<!-- a comment
   spanning lines -->
</main>
<script>
function a(){
if(x){
return 1
}
}
</script>
</body></html>`;

test("html: output is stable (idempotent) and keeps the rendered structure", () => {
  const once = formatHtml(SAMPLE);
  assert.equal(formatHtml(once), once);
  assert.equal(sig(once), sig(SAMPLE));
  assert.ok(once.endsWith("</html>\n"));
});

test("html: pre, textarea and comments keep their exact characters", () => {
  const out = formatHtml(SAMPLE);
  assert.ok(out.includes("<pre>  keep\n    this   exactly\n</pre>"));
  assert.ok(out.includes('<textarea name="t">\n  a   b\n</textarea>'));
  assert.ok(out.includes("<!-- a comment\n   spanning lines -->"));
});

test("html: indentation, void elements, optional end tags and inline runs", () => {
  const out = formatHtml("<div><p>Hi <b>there</b></p><ul><li>One<li>Two</ul><img src=a.png><br></div>", { indentSize: 2 });
  assert.equal(out, "<div>\n  <p>Hi <b>there</b></p>\n  <ul>\n    <li>One\n    <li>Two\n  </ul>\n  <img src=a.png><br>\n</div>\n");
});

test("html: long start tags wrap one attribute per line at the configured width", () => {
  const out = formatHtml('<button type="submit" class="btn btn-primary btn-lg" data-toggle="modal" data-target="#x">Go</button>', { lineWidth: 60 });
  assert.ok(out.split("\n").length > 3);
  assert.ok(out.includes('\n  type="submit"\n'));
  assert.equal(formatHtml(out, { lineWidth: 60 }), out);
});

test("html: tabs and quote style options", () => {
  assert.equal(formatHtml("<div><p>x</p></div>", { useTabs: true }), "<div>\n\t<p>x</p>\n</div>\n");
  assert.equal(formatHtml("<a href='x'>y</a>", { quote: "double" }), '<a href="x">y</a>\n');
  assert.equal(formatHtml('<a title="it\'s" href="x">y</a>', { quote: "single" }), "<a title=\"it's\" href='x'>y</a>\n");
});

test("html: inline whitespace is never dropped or invented", () => {
  assert.equal(formatHtml("<p><b>a</b><i>b</i></p>"), "<p><b>a</b><i>b</i></p>\n"); // no space between: stays glued
  assert.equal(formatHtml("<p><b>a</b>   <i>b</i></p>"), "<p><b>a</b> <i>b</i></p>\n");
});

test("html: broken markup never loses text", () => {
  const out = formatHtml("<div><p>open <b>bold</div> tail <span");
  assert.ok(out.includes("open") && out.includes("bold") && out.includes("tail") && out.includes("<span"));
});

test("html: every starter template formats idempotently without changing its structure", () => {
  for (const t of TEMPLATES) {
    for (const [path, text] of Object.entries(t.files)) {
      if (!/\.html?$/i.test(path) || typeof text !== "string") continue;
      const once = formatHtml(text);
      assert.equal(formatHtml(once), once, `${t.id}/${path} is not idempotent`);
      assert.equal(sig(once), sig(text), `${t.id}/${path} changed its structure`);
    }
  }
});

test("css: formatting keeps the rules (same parse) and is idempotent", () => {
  const src = "a{color:red;background:#FFF}\n\n\n@media (max-width:600px){.x{margin:0 auto;padding:1px}}\n.y>.z , .w{font:12px/1 a}";
  const once = formatText("css", src).text;
  assert.equal(formatText("css", once).text, once);
  const flat = (css) => JSON.stringify(parseCss(css).rules.map((r) => [r.type, (r.selector || r.name).replace(/\s+/g, ""), (r.decls || []).map((d) => `${d.prop}:${d.value}`)]));
  assert.equal(flat(once), flat(src));
  assert.equal(formatText("css", src, { useTabs: true }).text, formatCss(src, { indent: "\t" }));
});

test("js: reindents by bracket depth, keeps strings, templates, comments and regex literals", () => {
  const src = `function a(x) {
if (x) {
const s = "}{";
const t = \`
  keep {
\${x}
\`;
const re = /[}{]/g;
/* a
   comment { */
return foo(
1,
2
);
}
switch (x) {
case 1:
y();
break;
default:
z();
}
}


`;
  const out = formatJs(src);
  assert.equal(
    out,
    `function a(x) {
  if (x) {
    const s = "}{";
    const t = \`
  keep {
\${x}
\`;
    const re = /[}{]/g;
    /* a
   comment { */
    return foo(
      1,
      2
    );
  }
  switch (x) {
    case 1:
      y();
      break;
    default:
      z();
  }
}
`,
  );
  assert.equal(formatJs(out), out);
});

test("js: chains get one extra level, blank lines collapse, tokens are preserved", () => {
  const src = "const a = b\n.map(x => x)\n.filter(Boolean);\n\n\n\nlet i = 0";
  const out = formatJs(src);
  assert.equal(out, "const a = b\n  .map(x => x)\n  .filter(Boolean);\n\nlet i = 0\n");
  assert.equal(out.replace(/\s+/g, ""), src.replace(/\s+/g, ""));
});

test("json: pretty prints with the indent option and rejects invalid input", () => {
  assert.equal(formatJson('{"a":[1,2],"b":{"c":null}}'), '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}\n');
  assert.equal(formatJson('{"a":1}', { useTabs: true }), '{\n\t"a": 1\n}\n');
  assert.throws(() => formatJson("{a:1}"));
  const bad = formatText("json", "{a:1}");
  assert.equal(bad.ok, false);
  assert.equal(bad.text, "{a:1}");
  const once = formatJson('{"x":[{"y":1}]}');
  assert.equal(formatJson(once), once);
});

test("markdown: trailing whitespace, heading spacing, fenced code stays", () => {
  const src = "# Title\ntext  \nmore   \n\n\n\n## Two\n- a\n```js\nlet  x;   \n\n\n# not a heading\n```\n#hashtag stays";
  const out = formatMarkdown(src);
  assert.equal(out, "# Title\n\ntext  \nmore  \n\n## Two\n\n- a\n```js\nlet  x;   \n\n\n# not a heading\n```\n#hashtag stays\n");
  assert.equal(formatMarkdown(out), out);
});

test("formatText dispatches by language and reports unsupported types", () => {
  assert.ok(canFormat("html") && canFormat("css") && canFormat("javascript") && canFormat("json") && canFormat("markdown"));
  assert.equal(canFormat("yaml"), false);
  assert.equal(formatText("yaml", "a:   1").ok, false);
  assert.equal(formatText("html", "").text, "");
});

test("formatRange formats only the selected lines and keeps their indentation", () => {
  const src = "<div>\n  <ul><li>a</li><li>b</li></ul>\n  <p>x</p>\n</div>\n";
  const from = src.indexOf("<ul>");
  const r = formatRange("html", src, from, from + 5);
  assert.equal(r.ok, true);
  assert.equal(r.insert, "  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>");
  const next = src.slice(0, r.from) + r.insert + src.slice(r.to);
  assert.ok(next.endsWith("  <p>x</p>\n</div>\n"));
  const js = formatRange("javascript", "if (a) {\n    b();\n  c();\n}\n", 8, 20);
  assert.equal(js.ok, true);
});
