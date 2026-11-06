import test from "node:test";
import assert from "node:assert/strict";
import { colorsInLine, colorAt, parseColor, formatColorLike, toHex, pathAt } from "../../app/src/engine/web/code-hover.js";
import { SYNTAX_THEMES, SYNTAX_SLOTS, syntaxTheme, syntaxVars, sanitizeSyntaxCustom } from "../../app/src/engine/web/syntax-themes.js";
import { sanitizeSnippets, snippetsFor, MAX_SNIPPETS } from "../../app/src/engine/web/snippets.js";

test("color literals in a line", () => {
  const line = "a { color: #fff; background: rgba(0, 0, 0, .5); border-color: hsl(210 40% 50% / 0.8); fill: red; }";
  const found = colorsInLine(line, { named: true }).map((c) => [c.value, c.kind]);
  assert.deepEqual(found, [["#fff", "hex"], ["rgba(0, 0, 0, .5)", "rgb"], ["hsl(210 40% 50% / 0.8)", "hsl"], ["red", "named"]]);
  // named colors only where asked for, and never as property names, selectors or JavaScript identifiers
  assert.deepEqual(colorsInLine("const red = 1; red.x", { named: false }), []);
  assert.deepEqual(colorsInLine(".red { color: blue }", { named: true }).map((c) => c.value), ["blue"]);
  // id selectors and URL fragments are not colors
  assert.deepEqual(colorsInLine("#cafe { top: 0 }"), []);
  assert.deepEqual(colorsInLine('<a href="#add">'), []);
  assert.deepEqual(colorsInLine("x#fff"), []);
  assert.equal(colorAt("color: #abcdef;", 9).value, "#abcdef");
  assert.equal(colorAt("color: #abcdef;", 2), null);
  assert.deepEqual(colorsInLine("#".repeat(5000)), []);
});

test("parse colors", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#11223380"), { r: 17, g: 34, b: 51, a: 0.502 });
  assert.deepEqual(parseColor("rgb(10 20 30 / 50%)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor("rgba(100%, 0%, 0%, 0.25)"), { r: 255, g: 0, b: 0, a: 0.25 });
  assert.deepEqual(parseColor("hsl(120, 100%, 25%)"), { r: 0, g: 128, b: 0, a: 1 });
  assert.deepEqual(parseColor("RebeccaPurple"), { r: 102, g: 51, b: 153, a: 1 });
  assert.equal(parseColor("#12345"), null);
  assert.equal(parseColor("rgb(1, 2)"), null);
  assert.equal(parseColor("notacolor"), null);
  assert.equal(toHex({ r: 255, g: 0, b: 16, a: 1 }), "#ff0010");
  assert.equal(toHex({ r: 255, g: 0, b: 16, a: 0.5 }), "#ff001080");
});

test("a picked color keeps the notation of the original", () => {
  const c = { r: 255, g: 0, b: 0, a: 1 };
  assert.equal(formatColorLike("#abc", c), "#f00");
  assert.equal(formatColorLike("#ABCDEF", { r: 18, g: 52, b: 171, a: 1 }), "#1234AB");
  assert.equal(formatColorLike("#aabbcc", c), "#ff0000");
  assert.equal(formatColorLike("#abc", { ...c, a: 0.5 }), "#ff000080");
  assert.equal(formatColorLike("rgb(1, 2, 3)", c), "rgb(255, 0, 0)");
  assert.equal(formatColorLike("rgb(1, 2, 3)", { ...c, a: 0.5 }), "rgba(255, 0, 0, 0.5)");
  assert.equal(formatColorLike("rgba(1, 2, 3, 0.2)", c), "rgba(255, 0, 0, 1)");
  assert.equal(formatColorLike("rgb(1 2 3)", { ...c, a: 0.25 }), "rgb(255 0 0 / 0.25)");
  assert.equal(formatColorLike("hsl(0, 0%, 0%)", { r: 0, g: 128, b: 0, a: 1 }), "hsl(120, 100%, 25%)");
  assert.equal(formatColorLike("HSL(0 0% 0%)", c), "HSL(0 100% 50%)");
  assert.equal(formatColorLike("red", { r: 0, g: 0, b: 255, a: 1 }), "#0000ff");
  // round trip: every notation parses back to the same color
  for (const v of ["#123", "#0a0b0c", "rgb(4, 5, 6)", "rgba(4, 5, 6, 0.4)", "hsl(200 50% 40%)"]) assert.deepEqual(parseColor(formatColorLike(v, parseColor(v))), parseColor(v), v);
});

test("local paths under the pointer", () => {
  assert.deepEqual(pathAt('<img src="img/logo.png" alt="">', 12), { from: 10, to: 22, ref: "img/logo.png" });
  assert.deepEqual(pathAt("background: url(../img/a.svg);", 20), { from: 16, to: 28, ref: "../img/a.svg" });
  assert.deepEqual(pathAt("import x from './util.js';", 17), { from: 15, to: 24, ref: "./util.js" });
  assert.equal(pathAt('<a href="https://example.com/a.html">', 15), null);
  assert.equal(pathAt('<a href="#top">', 10), null);
  assert.equal(pathAt('<img src="data:image/png;base64,AAA">', 12), null);
  assert.equal(pathAt('const s = "hello world";', 13), null);
  assert.equal(pathAt('const s = "react";', 12), null);
  assert.equal(pathAt('<img src="img/logo.png">', 2), null);
});

test("syntax themes", () => {
  assert.ok(SYNTAX_THEMES.length >= 15);
  assert.equal(new Set(SYNTAX_THEMES.map((t) => t.id)).size, SYNTAX_THEMES.length);
  for (const t of SYNTAX_THEMES) {
    for (const s of SYNTAX_SLOTS) assert.match(t.colors[s], /^#[0-9a-f]{6}([0-9a-f]{2})?$/, `${t.id}.${s}`);
    // the current-line color is translucent so the selection behind the text stays visible
    assert.equal(t.colors.line.length, 9, `${t.id}.line`);
  }
  assert.equal(syntaxTheme("app"), null);
  assert.deepEqual(syntaxVars("app", {}), {});
  const v = syntaxVars("monokai", { keyword: "#123456", nope: "#fff", string: "red" });
  assert.equal(v["--of-editor-bg"], "#272822");
  assert.equal(v["--of-syn-keyword"], "#123456");
  assert.equal(v["--of-syn-string"], "#e6db74");
  assert.equal(Object.keys(v).length, SYNTAX_SLOTS.length);
  assert.deepEqual(syntaxVars("app", { bg: "#000" }), { "--of-editor-bg": "#000" });
  assert.deepEqual(sanitizeSyntaxCustom([1]), {});
  assert.deepEqual(sanitizeSyntaxCustom({ fg: "#ABCDEF", x: "#000", bg: "url(x)" }), { fg: "#abcdef" });
});

test("your snippets", () => {
  const list = sanitizeSnippets([
    { lang: "html", prefix: "card", body: "<div class=\"card\">${}</div>", description: "Card" },
    { lang: "nope", prefix: "log", body: "console.log(${})" },
    { lang: "css", prefix: "bad prefix", body: "x" },
    { lang: "css", prefix: "empty", body: "  " },
    null,
  ]);
  assert.deepEqual(list.map((s) => [s.lang, s.prefix]), [["html", "card"], ["*", "log"]]);
  assert.deepEqual(snippetsFor(list, "css").map((s) => s.prefix), ["log"]);
  assert.deepEqual(snippetsFor(list, "html").map((s) => s.prefix), ["card", "log"]);
  assert.equal(sanitizeSnippets(Array.from({ length: 300 }, (_, i) => ({ prefix: `s${i}`, body: "x" }))).length, MAX_SNIPPETS);
  assert.deepEqual(sanitizeSnippets("x"), []);
});
