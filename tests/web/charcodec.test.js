import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMATS, MODES, encode, decode, decodeEntities, decodeJs, decodeCss, decodePercent, decodeCodePoints, entityName, entityCodePoint, ENTITY_COUNT, charInfo, describeChar, transformRanges, shouldEncode,
} from "../../app/src/engine/web/charcodec.js";

const SAMPLE = "Café — ü & <b>";
const ASTRAL = "a😀b𝒳c";

test("sample from the brief: decimal and hex, and back", () => {
  assert.equal(encode(SAMPLE, { format: "html-decimal" }), "Caf&#233; &#8212; &#252; & <b>");
  assert.equal(encode(SAMPLE, { format: "html-hex" }), "Caf&#xE9; &#x2014; &#xFC; & <b>");
  assert.equal(decode(encode(SAMPLE, { format: "html-decimal" }), "html"), SAMPLE);
  assert.equal(decode(encode(SAMPLE, { format: "html-hex" }), "html"), SAMPLE);
});

test("named entities with fallback to decimal", () => {
  assert.equal(encode("é—€ ∑ ☃", { format: "html-named" }), "&eacute;&mdash;&euro; &sum; &#9731;");
  assert.equal(encode("a & b", { format: "html-named", mode: "special" }), "a &amp; b");
  assert.equal(encode(`<a href="x">'`, { format: "html-named", mode: "special" }), "&lt;a href=&quot;x&quot;&gt;&#39;");
  assert.equal(encode("'", { format: "html-named", mode: "special", apos: true }), "&apos;");
});

test("modes: non-ascii, special, everything", () => {
  assert.equal(encode(SAMPLE, { format: "html-decimal", mode: "special" }), "Café &#8212; ü &#38; &#60;b&#62;");
  assert.equal(encode("ab\n", { format: "html-decimal", mode: "everything" }), "&#97;&#98;\n");
  assert.equal(encode("é©", { format: "html-decimal", mode: "special" }), "é&#169;"); // letters stay, symbols are encoded
  assert.equal(shouldEncode("a", "non-ascii"), false);
  assert.equal(shouldEncode("\t", "everything"), false);
});

test("javascript escapes, surrogate pairs and braces", () => {
  assert.equal(encode("é", { format: "js" }), "\\u00e9");
  assert.equal(encode("😀", { format: "js" }), "\\ud83d\\ude00");
  assert.equal(encode("😀", { format: "js", braces: true }), "\\u{1f600}");
  assert.equal(encode("😀é", { format: "js", braces: true }), "\\u{1f600}\\u00e9");
  assert.equal(encode("é", { format: "js", upper: true }), "\\u00E9");
  assert.equal(decode("\\ud83d\\ude00 \\u{1F600} \\u00e9 \\x41", "js"), "😀 😀 é A");
  assert.equal(encode("A", { format: "js", mode: "everything" }), "\\u0041");
});

test("css escapes", () => {
  assert.equal(encode("é€", { format: "css" }), "\\E9 \\20AC ");
  assert.equal(encode("😀", { format: "css" }), "\\1F600 ");
  assert.equal(decode("\\E9 x \\20AC;", "css"), "éx €;");
  assert.equal(decodeCss("a\\E9 b"), "aéb");
  assert.equal(decodeCss("\\1F600 "), "😀");
});

test("url percent-encoding is UTF-8", () => {
  assert.equal(encode("é€😀", { format: "url" }), "%C3%A9%E2%82%AC%F0%9F%98%80");
  assert.equal(decode("%C3%A9%E2%82%AC%F0%9F%98%80", "url"), "é€😀");
  assert.equal(decodePercent("caf%C3%A9 100%25 50%ZZ"), "café 100% 50%ZZ");
  assert.equal(decodePercent("%FF%FE"), "%FF%FE"); // invalid UTF-8 is left alone
  assert.equal(encode("a b%", { format: "url", mode: "everything" }), "%61%20%62%25");
});

test("code point list", () => {
  assert.equal(encode("é—", { format: "codepoints" }), "<U+00E9><U+2014>");
  assert.equal(encode("😀", { format: "codepoints" }), "<U+1F600>");
  assert.equal(decode("<U+00E9><U+2014> and U+1F600 x", "codepoints"), "é— and 😀 x");
  assert.equal(decodeCodePoints("<U+D800>"), "<U+D800>");
});

test("round trips for every format and mode, including astral characters", () => {
  const texts = [SAMPLE, ASTRAL, "plain ascii", "", "Ünïcödé — “quotes” … 日本語 ✓ ½", "tab\tline\nbreak", "100% <b>&amp;</b> 'x' \"y\" \\ backslash"];
  const dec = { "html-named": "html", "html-decimal": "html", "html-hex": "html", js: "js", css: "css", url: "url", codepoints: "codepoints" };
  for (const format of FORMATS) {
    for (const mode of MODES) {
      for (const t of texts) {
        if (format === "css" && /\\/.test(t) && mode !== "special") continue; // literal backslashes are only escaped in "special" mode
        if (format === "js" && /\\/.test(t) && mode !== "special") continue;
        if (format.startsWith("html") && /&amp;/.test(t) && mode === "non-ascii") continue; // literal entities are only escaped when & is encoded
        const e = encode(t, { format, mode });
        assert.equal(decode(e, dec[format]), t, `${format}/${mode}: ${JSON.stringify(t)} -> ${JSON.stringify(e)}`);
      }
    }
  }
});

test("braces option round trips", () => {
  for (const t of [ASTRAL, "😀😀", "é😀"]) assert.equal(decode(encode(t, { format: "js", braces: true }), "js"), t);
});

test("non-ascii encoding is idempotent and produces ASCII only", () => {
  for (const format of FORMATS) {
    const once = encode(SAMPLE + ASTRAL, { format });
    assert.equal(encode(once, { format }), once, format);
    assert.match(once, /^[\x00-\x7f]*$/, format);
  }
});

test("decoding is a single pass: no double decoding", () => {
  assert.equal(decodeEntities("&amp;#233;"), "&#233;");
  assert.equal(decodeEntities("&amp;amp;"), "&amp;");
  assert.equal(decodeEntities("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
  assert.equal(decodeJs("\\\\u00e9"), "\\\\u00e9"); // escaped backslash then literal "u00e9"
  assert.equal(decodeJs("\\\\\\u00e9"), "\\\\é");
  assert.equal(decodeCss("\\\\E9 "), "\\\\E9 ");
  assert.equal(decodePercent("%2541"), "%41");
  assert.equal(decode("&#92;u0041", "auto"), "\\u0041"); // an entity result is never decoded as a JS escape
  assert.equal(decode("&eacute; \\u00e9", "auto"), "é é");
});

test("decoding is stable once nothing is left to decode", () => {
  for (const s of ["Café — ü", "a < b", "😀"]) assert.equal(decode(decode(s, "auto"), "auto"), s);
});

test("malformed input is left alone or replaced as in HTML", () => {
  assert.equal(decodeEntities("&;"), "&;");
  assert.equal(decodeEntities("&#;"), "&#;");
  assert.equal(decodeEntities("&#xZZ;"), "&#xZZ;");
  assert.equal(decodeEntities("&unknown;"), "&unknown;");
  assert.equal(decodeEntities("&eacute"), "&eacute"); // no semicolon
  assert.equal(decodeEntities("AT&T; &amp"), "AT&T; &amp");
  assert.equal(decodeEntities("&#0;"), "�");
  assert.equal(decodeEntities("&#xD800;"), "�");
  assert.equal(decodeEntities("&#1114112;"), "�");
  assert.equal(decodeEntities("&#150;"), "–"); // windows-1252 interpretation
  assert.equal(decodeEntities("&#x1F600;"), "😀");
  assert.equal(decodeEntities("&#X41;"), "A");
  assert.equal(decodeJs("\\u12"), "\\u12");
  assert.equal(decodeJs("\\u{110000}"), "\\u{110000}");
  assert.equal(decodeJs("\\ud800"), "\ud800");
  assert.equal(decodePercent("%"), "%");
  assert.equal(decodePercent("%4"), "%4");
  assert.equal(decodeCss("\\"), "\\");
  assert.equal(decode(null), "");
  assert.throws(() => decode("x", "nope"));
  assert.throws(() => encode("x", { format: "nope" }));
  assert.throws(() => encode("x", { mode: "nope" }));
});

test("lone surrogates do not throw", () => {
  const lone = "a\ud83db";
  assert.equal(encode(lone, { format: "html-decimal" }), lone);
  assert.equal(encode(lone, { format: "js" }), "a\\ud83db");
  assert.equal(encode(lone, { format: "url" }), "a%EF%BF%BDb");
});

test("entity table: full HTML 4 set and common HTML 5 additions", () => {
  assert.ok(ENTITY_COUNT >= 252 + 60, `only ${ENTITY_COUNT}`);
  const html4 = ["nbsp", "iexcl", "yuml", "OElig", "fnof", "Alpha", "Omega", "alpha", "omega", "thetasym", "ensp", "mdash", "euro", "trade", "larr", "hArr", "forall", "infin", "ne", "diams", "loz", "lceil", "sdot"];
  for (const n of html4) assert.ok(entityCodePoint(n) != null, n);
  assert.equal(entityCodePoint("eacute"), 233);
  assert.equal(entityCodePoint("Eacute"), 201);
  assert.equal(entityCodePoint("apos"), 39);
  assert.equal(entityCodePoint("check"), 0x2713);
  assert.equal(entityName(8364), "euro");
  assert.equal(entityName(0x2713), undefined); // HTML 5 only: encoded numerically
  // HTML 4 has exactly 252 named references (including quot, amp, lt, gt)
  let html4Count = 0;
  for (let cp = 0; cp < 0x3000; cp++) if (entityName(cp)) html4Count++;
  assert.ok(html4Count >= 248, `html4 names: ${html4Count}`);
  assert.equal(entityCodePoint("shy"), 173);
  assert.equal(entityCodePoint("thorn"), 254);
});

test("every named entity decodes and the primary names re-encode", () => {
  for (let cp = 128; cp < 0x2700; cp++) {
    const n = entityName(cp);
    if (!n) continue;
    const ch = String.fromCodePoint(cp);
    assert.equal(decodeEntities(`&${n};`), ch, n);
    assert.equal(encode(ch, { format: "html-named" }), `&${n};`, n);
  }
});

test("charInfo and describeChar", () => {
  const i = charInfo("é");
  assert.equal(i.codePoint, "U+00E9");
  assert.deepEqual(i.utf8, ["C3", "A9"]);
  assert.deepEqual(i.utf16, ["00E9"]);
  assert.equal(i.entity, "&eacute;");
  assert.equal(i.category, "Lowercase letter");
  const e = charInfo("😀x");
  assert.equal(e.length, 2);
  assert.equal(e.codePoint, "U+1F600");
  assert.deepEqual(e.utf16, ["D83D", "DE00"]);
  assert.deepEqual(e.utf8, ["F0", "9F", "98", "80"]);
  assert.equal(charInfo("", 0), null);
  assert.match(describeChar("€"), /U\+20AC.*&euro;.*E2 82 AC/);
});

test("transformRanges keeps selections consistent across several ranges", () => {
  const doc = "é a é b é";
  const ranges = [{ from: 0, to: 1 }, { from: 4, to: 5 }, { from: 8, to: 9 }];
  const { changes, selection } = transformRanges(ranges, (s) => encode(s, { format: "html-decimal" }), (a, b) => doc.slice(a, b));
  assert.equal(changes.length, 3);
  // apply the changes from the back, then check that the selections cover the new text
  let out = doc;
  for (const c of [...changes].reverse()) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  assert.equal(out, "&#233; a &#233; b &#233;");
  for (const s of selection) assert.equal(out.slice(s.anchor, s.head), "&#233;");
  // untouched ranges produce no change but keep their (shifted) selection
  const same = transformRanges([{ from: 2, to: 3 }], (s) => s, (a, b) => doc.slice(a, b));
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.selection, [{ anchor: 2, head: 3 }]);
});
