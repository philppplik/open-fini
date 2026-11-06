import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { tokenizeJs, beautifyJs, minifyJs } from "../../app/src/engine/web/js-format.js";
import { formatText, minifyText, formatJs, DEFAULT_FORMAT_OPTIONS, FORMAT_PRESETS } from "../../app/src/engine/web/format.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("tokenizer: strings, templates with nested code, regex and comments", () => {
  const t = tokenizeJs("a = `x ${ /}/.test(b) ? `y${c}` : '}' } z` / 2; // c\n/re[/]/g.x");
  assert.deepEqual(t.map((x) => x.t), ["word", "punct", "tmpl", "punct", "word", "punct", "line", "regex", "punct", "word"]);
  assert.equal(t[7].nl, 1);
  assert.equal(tokenizeJs("'unterminated"), null);
  assert.equal(tokenizeJs("x <!-- y"), null);
});

test("beautify: minified code becomes readable", () => {
  const out = beautifyJs("function greet(name){if(!name){return 'nobody'}else{const p=[1,2].map(x=>x*2);return `Hi ${name}`+p.join(\",\")}}const o={a:1,b:{c:2}};");
  assert.equal(out, [
    "function greet(name) {",
    "  if (!name) {",
    "    return 'nobody'",
    "  } else {",
    "    const p = [1, 2].map(x => x * 2);",
    "    return `Hi ${name}` + p.join(\",\")",
    "  }",
    "}",
    "const o = { a: 1, b: { c: 2 } };",
    "",
  ].join("\n"));
});

test("beautify: switch, do/while, try, classes and long objects", () => {
  const out = beautifyJs("switch(x){case 1:foo();break;case 2:{bar()}default:baz()}do{i--}while(i>0)\ntry{a()}catch(e){}finally{b()}\nclass A extends B{get y(){return this.#p?.z??0}}\nconst big={alpha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaa',beta:'bbbbbbbbbbbbbbbbbbbbbbbbbb',gamma:'cccccccccccccccc'};", { lineWidth: 60 });
  assert.match(out, /^switch \(x\) \{\n {2}case 1:\n {4}foo\(\);\n {4}break;\n {2}case 2: \{\n {4}bar\(\)\n {2}\}\n {2}default:\n {4}baz\(\)\n\}\n/);
  assert.match(out, /\} while \(i > 0\)/);
  assert.match(out, /\} catch \(e\) \{\} finally \{/);
  assert.match(out, /return this\.#p\?\.z \?\? 0/);
  assert.match(out, /const big = \{\n {2}alpha: 'a+',\n {2}beta: 'b+',\n {2}gamma: 'c+'\n\};/);
});

test("beautify keeps every source line break (ASI, return, postfix)", () => {
  const src = "const a = 1\nconst b = a\n++c\nfunction f(){return\n42}\nlet x = y\n(z)\n";
  const out = beautifyJs(src);
  assert.match(out, /const b = a\n\+\+c/);
  assert.match(out, /return\n\s*42/);
  assert.match(out, /let x = y\n\(z\)/);
  // same behavior: run both
  const run = (code) => vm.runInNewContext(`${code.replace("let x = y\n(z)", "")};[typeof c, f()]`, { c: 1 });
  assert.equal(JSON.stringify(run(out)), JSON.stringify(run(src)));
});

test("beautify options: braces, quotes, function space", () => {
  const src = "function a(){return 'x'}";
  assert.equal(beautifyJs(src, { jsBraceStyle: "allman" }), "function a()\n{\n  return 'x'\n}\n");
  assert.equal(beautifyJs(src, { jsQuote: "double", jsSpaceBeforeFunctionParen: true, indentUnit: "    " }), "function a () {\n    return \"x\"\n}\n");
  assert.equal(beautifyJs("s = 'it\\'s'", { jsQuote: "double" }), "s = 'it\\'s'\n"); // never re-escapes
});

test("beautify is idempotent and safe on the app's own sources", () => {
  const dirs = ["app/src/engine/web", "app/src/ui/code", "app/src/core"];
  let n = 0;
  for (const d of dirs) {
    for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith(".js"))) {
      const src = readFileSync(join(root, d, f), "utf8");
      const out = beautifyJs(src, { lineWidth: 140 });
      assert.notEqual(out, null, `${d}/${f}`);
      assert.equal(beautifyJs(out, { lineWidth: 140 }), out, `${d}/${f} is not idempotent`);
      assert.notEqual(minifyJs(src), null, `${d}/${f} minify`);
      n++;
    }
  }
  assert.ok(n > 60);
});

test("minify: whitespace and comments go, statements stay apart", () => {
  assert.equal(minifyJs("/*! (c) me */\n// note\nconst a = 1\nconst b = a + +c\nreturn\nx"), "/*! (c) me */\nconst a=1\nconst b=a+ +c\nreturn\nx");
  assert.equal(minifyJs("a = b / c; d = /re/g; e = x - -y", {}), "a=b/c;d=/re/g;e=x- -y");
  assert.equal(minifyJs("/*! keep */ x", { keepLicense: false }), "x");
  const code = "function fib(n){ // recursive\n  return n < 2 ? n : fib(n - 1) + fib(n - 2)\n}\nfib(10)";
  assert.equal(vm.runInNewContext(minifyJs(code)), 55);
});

test("formatText uses the beautifier, TypeScript paths and reindent keep the old formatter", () => {
  const min = "if(a){b()}";
  assert.equal(formatText("javascript", min).text, "if (a) {\n  b()\n}\n");
  assert.equal(formatText("javascript", min, { path: "x.ts" }).text, "if(a){b()}\n");
  assert.equal(formatText("javascript", min, { jsStyle: "reindent" }).text, "if(a){b()}\n");
  assert.equal(formatJs(min, { jsIndentSize: 4 }), "if (a) {\n    b()\n}\n");
  const html = formatText("html", "<div><script>if(a){b()}</script></div>").text;
  assert.match(html, /<script>\n {4}if \(a\) \{\n {6}b\(\)\n {4}\}\n {2}<\/script>/);
});

test("HTML and CSS options", () => {
  const src = '<html><head><meta charset="utf-8"></head><body><img src="a.png" alt="A"><br/></body></html>';
  assert.match(formatText("html", src, { htmlVoidStyle: "xhtml" }).text, /<meta charset="utf-8" \/>[\s\S]*<br \/>/);
  assert.match(formatText("html", src, { htmlVoidStyle: "html" }).text, /<br>/);
  assert.match(formatText("html", src, { htmlWrapAttributes: "force" }).text, /<img\n\s+src="a.png"\n\s+alt="A">/);
  assert.match(formatText("html", src, { htmlIndentRoot: false }).text, /^<html>\n<head>/);
  const css = ".a,.b{color:#ABCDEF}\n.c{background:url(x.svg#ABC)}";
  assert.equal(formatText("css", css, { cssSelectorsPerLine: false, cssBlankLines: false, cssHexCase: "lower" }).text, ".a, .b {\n  color: #abcdef;\n}\n.c {\n  background: url(x.svg#ABC);\n}\n");
  assert.equal(formatText("css", css, { cssIndentSize: 4 }).text.split("\n")[2], "    color: #ABCDEF;");
});

test("minifyText for every language", () => {
  assert.equal(minifyText("css", ".a {\n  color: red;\n}\n").text, ".a{color:red}");
  assert.equal(minifyText("json", '{\n  "a": [1, 2]\n}').text, '{"a":[1,2]}');
  assert.equal(minifyText("html", "<p>\n  Hi  <b>you</b>\n</p>\n<script>\n  const a = 1;\n</script>").text, "<p>Hi <b>you</b></p><script>const a=1;</script>");
  assert.equal(minifyText("javascript", "x", { path: "a.tsx" }).ok, false);
  assert.equal(minifyText("markdown", "# x").ok, false);
});

test("presets only use known options", () => {
  for (const [id, p] of Object.entries(FORMAT_PRESETS)) for (const k of Object.keys(p)) assert.ok(k in DEFAULT_FORMAT_OPTIONS, `${id}.${k}`);
});
