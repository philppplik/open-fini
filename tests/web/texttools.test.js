import test from "node:test";
import assert from "node:assert/strict";
import {
  words, toCamel, toSnake, toKebab, toConstant, toTitle, base64Encode, base64Decode, sortLines, joinLines, trimLines, normalizeSpaces, tabsToSpaces, spacesToTabs, convertLineEndings,
  jsonPrettify, jsonMinify, wrap, parseColor, formatColor, convertColor, colorAt, wordRangeAt, TRANSFORMS, TRANSFORM_BY_ID,
} from "../../app/src/engine/web/texttools.js";

test("case transforms", () => {
  assert.deepEqual(words("fooBar_baz-QUXThing 2x"), ["foo", "Bar", "baz", "QUX", "Thing", "2", "x"]);
  assert.equal(toCamel("hello big-world"), "helloBigWorld");
  assert.equal(toSnake("helloBigWorld"), "hello_big_world");
  assert.equal(toKebab("Hello Big_World"), "hello-big-world");
  assert.equal(toConstant("helloBigWorld"), "HELLO_BIG_WORLD");
  assert.equal(toTitle("the quick brown fox's den"), "The Quick Brown Fox's Den");
  assert.equal(TRANSFORM_BY_ID.get("camelCase").apply("a b\nc d"), "aB\ncD");
  assert.equal(toSnake("Café au lait"), "café_au_lait");
});

test("base64 is UTF-8 safe and validates", () => {
  assert.equal(base64Encode("Café"), "Q2Fmw6k=");
  assert.equal(base64Decode("Q2Fmw6k="), "Café");
  assert.equal(base64Decode("Q2Fmw6k"), "Café"); // missing padding
  assert.equal(base64Decode(base64Encode("😀 — ü")), "😀 — ü");
  assert.throws(() => base64Decode("not base64!"));
  assert.throws(() => base64Decode("/w==")); // 0xFF is not UTF-8
});

test("line operations", () => {
  assert.equal(sortLines("b\na\nc"), "a\nb\nc");
  assert.equal(sortLines("b\na\nc\n", "desc"), "c\nb\na\n");
  assert.equal(sortLines("item10\nitem9\nitem1"), "item1\nitem9\nitem10");
  assert.equal(sortLines("x 10\nx 2\ny 1", "numeric"), "y 1\nx 2\nx 10");
  assert.equal(sortLines("b\na\nb\na", "unique"), "a\nb");
  assert.equal(sortLines("1\n2\n3", "reverse"), "3\n2\n1");
  assert.equal(joinLines("a\n  b \n\nc"), "a b c");
  assert.equal(joinLines("a\nb", ", "), "a, b");
  assert.equal(trimLines("  a \n\tb\t"), "a\nb");
  assert.equal(normalizeSpaces("  a    b \t c  "), "  a b c");
  assert.equal(tabsToSpaces("\t\tx\ty", 2), "    x  y");
  assert.equal(spacesToTabs("    x\n   y", 2), "\t\tx\n\t y");
  assert.equal(convertLineEndings("a\r\nb\rc\nd", "lf"), "a\nb\nc\nd");
  assert.equal(convertLineEndings("a\nb", "crlf"), "a\r\nb");
});

test("json", () => {
  assert.equal(jsonPrettify('{"a":[1,2],"b":"é"}'), '{\n  "a": [\n    1,\n    2\n  ],\n  "b": "é"\n}');
  assert.equal(jsonMinify('{\n "a": 1,\n "b": [ 1, 2 ]\n}'), '{"a":1,"b":[1,2]}');
  assert.throws(() => jsonPrettify("{nope"));
});

test("wrappers", () => {
  assert.equal(wrap("x", "tag", "div"), "<div>x</div>");
  assert.equal(wrap("x", "tag", 'a href="#"'), '<a href="#">x</a>');
  assert.equal(wrap("x", "tag"), "<span>x</span>");
  assert.throws(() => wrap("x", "tag", "1bad"));
  assert.equal(wrap("x", "double"), '"x"');
  assert.equal(wrap("x", "parens"), "(x)");
  assert.equal(wrap("a--b", "comment", "html"), "<!-- a- -b -->");
  assert.equal(wrap("a*/b", "comment", "block"), "/* a* /b */");
  assert.equal(wrap("a\nb", "comment", "line"), "// a\n// b");
});

test("colors", () => {
  assert.deepEqual(parseColor("#f00"), { r: 255, g: 0, b: 0, a: 1 });
  assert.equal(convertColor("#ff6b35", "rgb"), "rgb(255, 107, 53)");
  assert.equal(convertColor("rgb(255, 107, 53)", "hex"), "#ff6b35");
  assert.equal(convertColor("#ff0000", "hsl"), "hsl(0, 100%, 50%)");
  assert.equal(convertColor("hsl(120, 100%, 25%)", "hex"), "#008000");
  assert.equal(convertColor("rgba(0, 0, 0, 0.5)", "hex"), "#00000080");
  assert.equal(convertColor("#00000080", "rgb"), "rgba(0, 0, 0, 0.502)");
  assert.equal(convertColor("#fff", "hsl"), "hsl(0, 0%, 100%)");
  assert.equal(convertColor("hsl(210 50% 40%)".replace(/ /g, ", "), "hex").length, 7);
  assert.throws(() => convertColor("blue", "hex"));
  assert.equal(parseColor("nonsense"), null);
  const line = "color: #FF6B35; background: rgb(0, 0, 0);";
  assert.deepEqual(colorAt(line, 10), { from: 7, to: 14, text: "#FF6B35" });
  assert.equal(colorAt(line, 3), null);
  assert.equal(colorAt(line, 30).text, "rgb(0, 0, 0)");
  assert.equal(formatColor({ r: 1, g: 2, b: 3, a: 1 }, "hex"), "#010203");
});

test("word range", () => {
  assert.deepEqual(wordRangeAt("foo bar-baz qux", 5), { from: 4, to: 11 });
  assert.deepEqual(wordRangeAt("foo bar", 3), { from: 0, to: 3 });
  assert.deepEqual(wordRangeAt("a  b", 2), { from: 2, to: 2 });
});

test("catalog: the start-up catalog matches the transforms one to one, in order, with the same metadata", async () => {
  const { TRANSFORM_INFO } = await import("../../app/src/engine/web/texttools-catalog.js");
  assert.equal(TRANSFORM_INFO.length, TRANSFORMS.length);
  TRANSFORM_INFO.forEach((info, i) => {
    const { apply, ...meta } = TRANSFORMS[i];
    assert.deepEqual(meta, info);
    assert.equal(typeof apply, "function");
  });
  // the catalog is plain data: no imports, so the palette can load it without the codec
  const src = (await import("node:fs")).readFileSync(new URL("../../app/src/engine/web/texttools-catalog.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.equal(TRANSFORM_BY_ID.get("lineEndingsCrlf").fileOnly, true);
  assert.equal(TRANSFORM_BY_ID.get("wrapTag").needsArg, 'Tag (for example div or a href="#")');
  assert.equal(TRANSFORM_BY_ID.get("encodeJsBraces").apply("😀"), "\\u{1f600}");
});

test("registry: unique ids, labels, groups, scopes; every transform runs", () => {
  const ids = new Set();
  for (const t of TRANSFORMS) {
    assert.ok(!ids.has(t.id), `duplicate ${t.id}`);
    ids.add(t.id);
    assert.ok(t.label && t.group && ["word", "line", "file", "color"].includes(t.scope), t.id);
    assert.equal(typeof t.apply, "function");
  }
  assert.ok(TRANSFORMS.length >= 50);
  assert.equal(TRANSFORM_BY_ID.get("encodeEntitiesDecimal").apply("Café — ü & <b>"), "Caf&#233; &#8212; &#252; & <b>");
  assert.equal(TRANSFORM_BY_ID.get("encodeEntitiesHex").apply("é"), "&#xE9;");
  assert.equal(TRANSFORM_BY_ID.get("escapeHtml").apply('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
  assert.equal(TRANSFORM_BY_ID.get("decodeAuto").apply("&#233;\\u00e9"), "éé");
  assert.equal(TRANSFORM_BY_ID.get("wrapComment").apply("x", { lang: "html" }), "<!-- x -->");
  assert.equal(TRANSFORM_BY_ID.get("urlDecode").apply("a%20b+c"), "a b c");
  assert.throws(() => TRANSFORM_BY_ID.get("urlDecode").apply("%E0%A4%A"));
  assert.equal(TRANSFORM_BY_ID.get("jsonPrettify").apply('{"a":1}', { tabSize: 4 }), '{\n    "a": 1\n}');
});
