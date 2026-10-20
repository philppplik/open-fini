import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCss, minifyCss, sortCssProperties, formatJson, minifyJson, formatJs, minifyJs, tokenizeJs, formatHtml, minifyHtml, tokenizeHtml, detectLanguage, formatCode, minifyCode } from "../../extensions/code-tools/src/lib-format.js";
import { SNIPPETS, snippetText, snippetError, filterSnippets, projectFiles, processFile, insertSnippet } from "../../extensions/code-tools/src/lib.js";
import { mockApi } from "./_mock.js";

const squash = (s) => s.replace(/\s+/g, "");

test("CSS: format, idempotence, comments, urls with semicolons, nested at-rules", () => {
  const src = '@import url("a.css");/* hi */a,b>c{color:red;background:url(data:image/png;base64,AAA=);margin:0 auto}@media (min-width:600px){.x{display:flex;gap:4px}}';
  const out = formatCss(src);
  assert.match(out, /^@import url\("a\.css"\);\n\n\/\* hi \*\/\na,\nb>c \{\n  color: red;\n  background: url\(data:image\/png;base64,AAA=\);\n  margin: 0 auto;\n\}/);
  assert.match(out, /@media \(min-width:600px\) \{\n  \.x \{\n    display: flex;/);
  assert.equal(formatCss(out), out);
  assert.equal(squash(minifyCss(out)), squash(minifyCss(src)));
  assert.equal(minifyCss(src), '@import url("a.css");a,b>c{color:red;background:url(data:image/png;base64,AAA=);margin:0 auto}@media (min-width:600px){.x{display:flex;gap:4px}}');
  assert.equal(formatCss(""), "");
  assert.doesNotThrow(() => formatCss("a{"), "broken CSS must not throw");
});

test("CSS: sort properties alphabetically, vendor prefixes next to their base", () => {
  const out = sortCssProperties(".a{margin:0;-webkit-transition:none;color:red;transition:none;display:flex}");
  const props = [...out.matchAll(/^\s+([\w-]+):/gm)].map((m) => m[1]);
  assert.deepEqual(props, ["color", "display", "margin", "transition", "-webkit-transition"]);
});

test("JSON: format, sort keys, minify, errors are thrown", () => {
  assert.equal(formatJson('{"b":1,"a":[1,2]}'), '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');
  assert.equal(formatJson('{"b":1,"a":2}', { sortKeys: true }).indexOf('"a"') < formatJson('{"b":1,"a":2}', { sortKeys: true }).indexOf('"b"'), true);
  assert.equal(minifyJson('{ "a": [1, 2] }'), '{"a":[1,2]}');
  assert.throws(() => formatJson("{bad"));
});

const JS = `const a=1,b={x:1,y:[1,2,3],z:function(q){return q+1}};
function foo(a,b){if(a>b){return a-b}else if(a===b){return 0}else{return b-a}}
for(let i=0;i<10;i++){console.log(i)}
const s = \`t\${a}\`; const r=/ab+c/gi.test("x")
let n = -1, m = a? b : c
switch(x){case 1:foo();break;default:bar()}
try{x()}catch(e){y()}finally{z()}
class A extends B{constructor(){super();this.a=1}get x(){return 1}}
const o = {a:1,
  b:2}
x = a
+ b
async function q(){ await fetch("/x"); return [...a, ...b] }
// done
`;

test("JS: formatting only changes whitespace, parses, and is stable", () => {
  const out = formatJs(JS);
  assert.equal(squash(out), squash(JS));
  assert.doesNotThrow(() => new vm.Script(out));
  assert.equal(formatJs(out), out);
  assert.match(out, /switch \(x\) \{\n  case 1:\n    foo\(\);/);
  assert.match(out, /\} else if \(a === b\) \{/);
  assert.match(out, /const a = 1, b = \{\n  x: 1,/);
  assert.match(out, /for \(let i = 0; i < 10; i\+\+\) \{/);
});

test("JS: lines that rely on automatic semicolon insertion stay separate", () => {
  const src = "const a = 1\nconst b = 2\nfoo()\n[1, 2].map(x => x)";
  const out = formatJs(src);
  assert.deepEqual(out.trim().split("\n").slice(0, 2), ["const a = 1", "const b = 2"]);
  assert.doesNotThrow(() => new vm.Script(formatJs("let a = 1\nlet b = 2\nb++")));
});

test("JS: strings, templates, regexes and comments are left alone", () => {
  const src = 'const s = "a;b{c}";const t = `x ${ {a:1}.a } ;`;const re = /[;{}]\\/+/g; // keep ; { }\n/* block ; */ f()';
  const toks = tokenizeJs(src);
  assert.deepEqual(toks.filter((t) => t.k === "str" || t.k === "tpl" || t.k === "re").map((t) => t.k), ["str", "tpl", "re"]);
  const out = formatJs(src);
  assert.ok(out.includes('"a;b{c}"'));
  assert.ok(out.includes("`x ${ {a:1}.a } ;`"));
  assert.ok(out.includes("/[;{}]\\/+/g"));
  assert.doesNotThrow(() => new vm.Script(out));
});

test("JS: minify drops comments and whitespace but keeps the program valid", () => {
  const out = minifyJs(JS);
  assert.ok(out.length < JS.length - 20);
  assert.doesNotThrow(() => new vm.Script(out));
  assert.ok(!out.includes("// done"));
  assert.equal(minifyJs("a = b + +c;\nreturn a"), "a=b+ +c;return a");
  assert.equal(minifyJs("let x = 1 // c\nlet y = 2"), "let x=1\nlet y=2");
});

test("HTML: formatting indents blocks, keeps inline runs and <pre>, formats embedded CSS and JS", () => {
  const src = '<!doctype html><html><head><title>T</title><style>a{color:red}</style><script>var a=1;function f(){return 2}</script></head><body><h1>Hello <b>world</b></h1><ul><li>One</li><li><a href="x">Two</a></li></ul><pre>  keep\n   this</pre><img src="a.png" alt="x"><p>text</p></body></html>';
  const out = formatHtml(src);
  assert.match(out, /^<!doctype html>\n<html>\n  <head>\n    <title>T<\/title>/);
  assert.match(out, /<h1>Hello <b>world<\/b><\/h1>/);
  assert.match(out, /<pre>  keep\n   this<\/pre>/);
  assert.match(out, /      a \{\n        color: red;/);
  assert.match(out, /      function f\(\) \{/);
  assert.equal(squash(formatHtml(out)), squash(out));
  assert.equal(minifyHtml(src), '<!doctype html><html><head><title>T</title><style>a{color:red}</style><script>var a=1;function f(){return 2}</script></head><body><h1>Hello <b>world</b></h1><ul><li>One</li><li><a href="x">Two</a></li></ul><pre>  keep\n   this</pre><img src="a.png" alt="x"><p>text</p></body></html>');
  assert.equal(tokenizeHtml("<br/><p class='a b'>x</p><!-- c -->").map((t) => t.k).join(), "self,open,text,close,comment");
});

test("language detection and dispatch", () => {
  assert.equal(detectLanguage("css/site.CSS"), "css");
  assert.equal(detectLanguage("a.mjs"), "js");
  assert.equal(detectLanguage("x.png"), null);
  assert.equal(formatCode("json", '{"a":1}'), '{\n  "a": 1\n}\n');
  assert.equal(minifyCode("css", "a { color : red ; }"), "a{color:red}");
});

test("the snippet pack is valid and in sync with the manifest", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "extensions", "code-tools", "openfini-extension.json"), "utf8"));
  assert.deepEqual(manifest.contributes.snippets, SNIPPETS, "run: node extensions/code-tools/build-manifest.mjs");
  assert.ok(SNIPPETS.length >= 30);
  const keys = new Set();
  for (const s of SNIPPETS) {
    assert.equal(snippetError(s), null, s.label);
    const key = `${s.language}:${s.label}`;
    assert.ok(!keys.has(key), `duplicate ${key}`);
    keys.add(key);
  }
  for (const lang of ["html", "css", "javascript"]) assert.ok(SNIPPETS.some((s) => s.language === lang), lang);
  assert.ok(SNIPPETS.some((s) => s.label === "html5") && SNIPPETS.some((s) => /^a11y-/.test(s.label)) && SNIPPETS.some((s) => /^media-/.test(s.label)) && SNIPPETS.some((s) => /^anim-/.test(s.label)));
});

test("snippet helpers", () => {
  assert.equal(snippetText('<a href="${1:#}">${2:Text}${3}</a>'), '<a href="#">Text</a>');
  assert.match(snippetError({ language: "html", label: "x", body: "b" }), /trigger/);
  assert.match(snippetError({ language: "go", label: "okay", body: "b" }), /Language/);
  assert.match(snippetError({ language: "css", label: "okay", body: "" }), /body/);
  assert.equal(snippetError({ language: "css", label: "my-card", body: "a{}" }), null);
  assert.ok(filterSnippets(SNIPPETS, { language: "css", query: "grid" }).every((s) => s.language === "css"));
  assert.ok(filterSnippets(SNIPPETS, { query: "dark" }).some((s) => s.label === "media-dark"));
});

test("processFile formats, sorts and minifies project files through the tools", async () => {
  const api = mockApi({ studio: "code", files: { "index.html": "<p>x</p>", "css/a.css": "a{b:1;a:2}", "logo.png": "bin" } });
  assert.deepEqual((await projectFiles(api)).map((f) => f.path), ["index.html", "css/a.css"]);
  const r = await processFile(api, "css/a.css", "sort");
  assert.equal(r.changed, true);
  assert.match(api.fileMap["css/a.css"], /a: 2;\n  b: 1;/);
  await processFile(api, "css/a.css", "minify");
  assert.equal(api.fileMap["css/a.min.css"], "a{a:2;b:1}");
  const same = await processFile(api, "index.html", "format");
  assert.equal(api.fileMap["index.html"], "<p>x</p>\n");
  assert.equal(same.changed, true);
  await assert.rejects(() => processFile(api, "index.html", "sort"), /CSS/);
  await assert.rejects(() => processFile(api, "logo.png", "format"), /not supported/);
});

test("insertSnippet puts HTML into the page and CSS/JS into a chosen file", async () => {
  const api = mockApi({ studio: "code", files: { "a.css": "body{}" } });
  await insertSnippet(api, SNIPPETS.find((s) => s.label === "a11y-skip-link"));
  assert.equal(api.calls[0][0], "insert_html");
  assert.ok(!api.calls[0][1].html.includes("${"));
  await insertSnippet(api, SNIPPETS.find((s) => s.label === "flex-center"), { file: "a.css" });
  assert.match(api.fileMap["a.css"], /^body\{\}\n\ndisplay: flex;/);
  await assert.rejects(() => insertSnippet(api, SNIPPETS.find((s) => s.label === "flex-center")), /Choose a file/);
});
