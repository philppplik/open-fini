import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCss, flattenRules, splitSelectorList, normalizeSelector, selectorSpecificity, classesInSelector, mediaOf, parseMediaQuery, formatCss,
  minifyCss, parseDeclarationList, normalizeMedia, cssUrls, parseImport, scanClassTokens, cssEscapeIdent, unescapeCss,
} from "../../app/src/engine/web/css.js";
import { checkCss } from "./_helpers.js";

const P = (src) => {
  const p = parseCss(src);
  checkCss(p);
  return p;
};
const codes = (p) => p.errors.map((d) => d.code);

/** Structure of a parsed sheet without offsets, for before/after comparisons. */
const norm = (v) => v.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ");
function shape(parsed) {
  const walk = (rules) =>
    rules.map((r) =>
      r.type === "style"
        ? { s: normalizeSelector(r.selector), d: r.decls.map((d) => [d.prop, norm(d.value), d.important]), r: walk(r.rules) }
        : { a: r.name, p: normalizeMedia(r.prelude), d: r.decls.map((d) => [d.prop, norm(d.value), d.important]), r: walk(r.rules), b: !!r.block },
    );
  return walk(parsed.rules);
}

const SAMPLE = `/* header */
@charset "utf-8";
@import url("a.css") screen;
:root { --accent: #4f46e5; --font: "Inter", sans-serif; --empty: ; }
html{scroll-behavior:smooth}
a:hover,a:focus-visible > span{color:red!important;background:url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>) no-repeat}
.btn::after{content:"a;b{c}/*d*/";margin:0 auto}
.card{
  padding: calc(1rem + 2px) 1rem ;   /* inline */
  box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.1);
  grid-template-areas: "a b"
                       "c d";
}
@media (max-width:991px){.card{padding:1rem}.a{b:c}}
@media screen and (min-width: 768px) and (max-width: 991px) { .x { y: z } }
@font-face{font-family:Foo;src:url(foo.woff2) format("woff2")}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.parent{color:blue;&:hover{color:red}.child &{margin:0}@media (min-width:600px){padding:0}}
`;

test("parses rules, declarations and at-rules with exact ranges", () => {
  const p = P(SAMPLE);
  assert.deepEqual(p.errors, []);
  const top = p.rules.map((r) => (r.type === "style" ? r.selector : "@" + r.name));
  assert.deepEqual(top, [":root", "html", "a:hover,a:focus-visible > span", ".btn::after", ".card", "@media", "@media", "@font-face", "@keyframes", ".parent"].toSpliced(0, 0, "@charset", "@import"));
  const link = p.rules.find((r) => r.selector && r.selector.startsWith("a:hover"));
  assert.equal(link.decls[0].prop, "color");
  assert.equal(link.decls[0].value, "red");
  assert.equal(link.decls[0].important, true);
  assert.equal(SAMPLE.slice(link.decls[0].start, link.decls[0].end), "color:red!important;");
  assert.match(link.decls[1].value, /^url\(data:image\/svg\+xml;utf8,<svg .*\) no-repeat$/);
  const btn = p.rules.find((r) => r.selector === ".btn::after");
  assert.equal(btn.decls[0].value, '"a;b{c}/*d*/"');
  assert.equal(btn.decls[1].end, SAMPLE.indexOf("margin:0 auto") + "margin:0 auto".length);
  assert.equal(SAMPLE.slice(btn.block.start, btn.block.end), 'content:"a;b{c}/*d*/";margin:0 auto');
  const card = p.rules.find((r) => r.selector === ".card");
  assert.equal(card.decls[0].value, "calc(1rem + 2px) 1rem");
  assert.equal(card.decls[2].value.replace(/\s+/g, " "), '"a b" "c d"');
  assert.equal(card.decls.length, 3);
  const root = p.rules[2];
  assert.equal(root.decls[0].prop, "--accent");
  assert.equal(root.decls[1].value, '"Inter", sans-serif');
  assert.equal(root.decls[2].value, "");
  const media = p.rules.find((r) => r.name === "media");
  assert.equal(media.prelude, "(max-width:991px)");
  assert.equal(media.rules.length, 2);
  assert.equal(media.rules[0].parent, media);
  assert.equal(SAMPLE.slice(media.rules[0].start, media.rules[0].end), ".card{padding:1rem}");
  const imp = p.rules.find((r) => r.name === "import");
  assert.equal(imp.block, null);
  assert.equal(imp.prelude, 'url("a.css") screen');
  assert.equal(SAMPLE.slice(imp.start, imp.end), '@import url("a.css") screen;');
  const font = p.rules.find((r) => r.name === "font-face");
  assert.equal(font.decls.length, 2);
  assert.equal(font.rules.length, 0);
  const kf = p.rules.find((r) => r.name === "keyframes");
  assert.deepEqual(kf.rules.map((r) => r.selector), ["from", "to"]);
  const parent = p.rules.find((r) => r.selector === ".parent");
  assert.equal(parent.decls.length, 1);
  assert.deepEqual(parent.rules.map((r) => (r.type === "style" ? r.selector : "@" + r.name)), ["&:hover", ".child &", "@media"]);
  assert.equal(parent.rules[0].outer, parent);
  assert.equal(parent.rules[0].parent, null);
  assert.equal(parent.rules[2].decls.length, 1);
  assert.equal(parent.rules[2].outer, parent);
});

test("custom properties may contain braces and semicolons inside strings or parentheses", () => {
  const p = P("a{--x: { a: b; c: d }; --y: 1; color:red}");
  const a = p.rules[0];
  assert.deepEqual(a.decls.map((d) => d.prop), ["--x", "--y", "color"]);
  assert.equal(a.decls[0].value, "{ a: b; c: d }");
  assert.equal(p.errors.length, 0);
});

test("diagnostics: unbalanced braces, stray braces, unclosed comments and strings", () => {
  let p = P(".a{color:red;");
  assert.deepEqual(codes(p), ["css/unbalanced-brace"]);
  assert.equal(p.rules[0].decls[0].value, "red");
  assert.equal(p.rules[0].end, p.source.length);
  p = P(".a{}} .b{}");
  assert.deepEqual(codes(p), ["css/stray-brace"]);
  assert.equal(p.rules.length, 2);
  p = P("@media (a){.a{b:c}");
  assert.deepEqual(codes(p), ["css/unbalanced-brace"]);
  assert.equal(p.rules[0].rules.length, 1);
  p = P(".a{b:c} /* open");
  assert.ok(codes(p).includes("css/unclosed-comment"));
  p = P('.a{content:"abc\n;d:e}');
  assert.ok(codes(p).includes("css/unclosed-string"));
  assert.ok(P(".a{color}").errors.some((d) => d.code === "css/invalid-declaration"));
  assert.ok(P("color:red;.a{}").errors.some((d) => d.code === "css/invalid-statement"));
});

test("misc tolerance: missing semicolon, html comment tokens, empty selector, escapes, uppercase", () => {
  const p = P("<!-- .a{COLOR:Red;Margin : 0 } --> .b\\:c{x:y}\n.d{--Mixed-Case:1}");
  assert.equal(p.rules.length, 3);
  assert.equal(p.rules[0].decls[0].prop, "color");
  assert.equal(p.rules[0].decls[0].value, "Red");
  assert.equal(p.rules[0].decls[1].prop, "margin");
  assert.equal(p.rules[0].decls[1].value, "0");
  assert.equal(p.rules[1].selector, ".b\\:c");
  assert.equal(p.rules[2].decls[0].prop, "--Mixed-Case");
  const q = P("{a:b}");
  assert.equal(q.rules[0].selector, "");
  const r = P("a{color:red /* c */ !important;margin:/* x */1px /* y */}");
  assert.equal(r.rules[0].decls[0].value, "red");
  assert.equal(r.rules[0].decls[0].important, true);
  assert.equal(r.rules[0].decls[1].value, "1px");
  assert.equal(r.rules[0].decls[1].valueStart, r.source.indexOf("1px"));
  const s = P("a{b:c !IMPORTANT}");
  assert.equal(s.rules[0].decls[0].important, true);
  assert.equal(s.rules[0].decls[0].value, "c");
});

test("parseDeclarationList", () => {
  const text = "color: red; margin:0 auto ;background: url(a;b)";
  const ds = parseDeclarationList(text);
  assert.deepEqual(ds.map((d) => d.prop), ["color", "margin", "background"]);
  assert.equal(text.slice(ds[1].start, ds[1].end), "margin:0 auto ;");
  assert.equal(text.slice(ds[2].valueStart, ds[2].valueEnd), "url(a;b)");
  assert.deepEqual(parseDeclarationList(""), []);
});

test("flattenRules is depth first and includes nested rules", () => {
  const p = P("@media (a){.a{b:c}.d{e:f}}.g{h:i;&:hover{j:k}}@keyframes x{from{a:b}}");
  assert.deepEqual(flattenRules(p).map((r) => r.selector), [".a", ".d", ".g", "&:hover", "from"]);
});

test("splitSelectorList and normalizeSelector", () => {
  assert.deepEqual(splitSelectorList("a, b:is(c, d), [x=\"1,2\"] , .e"), ["a", "b:is(c, d)", '[x="1,2"]', ".e"]);
  assert.equal(normalizeSelector("a>b  +c~d"), "a > b + c ~ d");
  assert.equal(normalizeSelector("  .a   .b ,\n.c>.d "), ".a .b, .c > .d");
  assert.equal(normalizeSelector('a[href="x  y"]  >b'), 'a[href="x  y"] > b');
  assert.equal(normalizeSelector(":is( .a ,.b )>c"), ":is(.a, .b) > c");
  assert.equal(normalizeSelector("> .child"), "> .child");
  assert.equal(normalizeSelector(".a /* c */ .b"), ".a .b");
  assert.equal(normalizeSelector("a:nth-child(2n+1)"), "a:nth-child(2n+1)");
  assert.equal(normalizeSelector(".card:hover"), ".card:hover");
});

test("selectorSpecificity", () => {
  assert.deepEqual(selectorSpecificity("a"), [0, 0, 1]);
  assert.deepEqual(selectorSpecificity(".a .b"), [0, 2, 0]);
  assert.deepEqual(selectorSpecificity("#x .y a:hover"), [1, 2, 1]);
  assert.deepEqual(selectorSpecificity("ul > li::before"), [0, 0, 3]);
  assert.deepEqual(selectorSpecificity("a:before"), [0, 0, 2]);
  assert.deepEqual(selectorSpecificity("a[href].b"), [0, 2, 1]);
  assert.deepEqual(selectorSpecificity(":not(#a, .b)"), [1, 0, 0]);
  assert.deepEqual(selectorSpecificity(":where(#a) .b"), [0, 1, 0]);
  assert.deepEqual(selectorSpecificity(":is(.a, #b) c"), [1, 0, 1]);
  assert.deepEqual(selectorSpecificity("*"), [0, 0, 0]);
  assert.deepEqual(selectorSpecificity(".a, #b"), [1, 0, 0]);
  assert.deepEqual(selectorSpecificity("li:nth-child(2n+1)"), [0, 1, 1]);
  assert.deepEqual(selectorSpecificity('[data-x=".a #b"]'), [0, 1, 0]);
});

test("classesInSelector, scanClassTokens, escapes", () => {
  assert.deepEqual(classesInSelector(".a.b > .a:not(.c)[data-x=\".d\"] .e\\:f"), ["a", "b", "c", "e:f"]);
  assert.deepEqual(classesInSelector("a, #id"), []);
  const toks = scanClassTokens('.a[x=".b"] /* .c */ .d');
  assert.deepEqual(toks.map((t) => t.name), ["a", "d"]);
  assert.equal(cssEscapeIdent("md:flex"), "md\\:flex");
  assert.equal(cssEscapeIdent("9lives"), "\\39 lives");
  assert.equal(cssEscapeIdent("ok-name_1"), "ok-name_1");
  assert.equal(unescapeCss("md\\:flex"), "md:flex");
  assert.equal(unescapeCss("\\31 23"), "123");
});

test("mediaOf, normalizeMedia and parseMediaQuery", () => {
  const p = P("@media ( MAX-WIDTH:991px ){.a{b:c}} @supports (display:grid){@media (min-width:600px){.d{e:f}}.g{h:i}} .j{k:l}");
  const [a, d, g, j] = flattenRules(p);
  assert.equal(mediaOf(a), "(max-width: 991px)");
  assert.equal(mediaOf(d), "(min-width: 600px)");
  assert.equal(mediaOf(g), null);
  assert.equal(mediaOf(j), null);
  assert.equal(normalizeMedia("  screen   and ( min-width : 10px )"), "screen and (min-width: 10px)");
  assert.deepEqual(parseMediaQuery("(max-width: 991px)"), { minWidth: null, maxWidth: 991, other: false });
  assert.deepEqual(parseMediaQuery("(min-width:768px) and (max-width:991.98px)"), { minWidth: 768, maxWidth: 991.98, other: false });
  assert.deepEqual(parseMediaQuery("(width <= 600px)"), { minWidth: null, maxWidth: 600, other: false });
  assert.equal(parseMediaQuery("screen and (max-width: 600px)").other, true);
  assert.equal(parseMediaQuery("(max-width: 40em)").other, true);
  assert.equal(parseMediaQuery("(prefers-reduced-motion: reduce)").other, true);
  assert.equal(parseMediaQuery("(max-width: 1px), print").other, true);
  assert.equal(parseMediaQuery("").other, true);
});

test("cssUrls and parseImport", () => {
  const css = `a{background:url(a.png)}/* url(no.png) */b{background:url( "b c.png" ) , url('d.png'), image-set(url(e.png) 1x)}c{content:"url(x.png)"}d{src:URL(f.woff2)format("woff2")}`;
  const urls = cssUrls(css);
  assert.deepEqual(urls.map((u) => u.url), ["a.png", "b c.png", "d.png", "e.png", "f.woff2"]);
  assert.equal(css.slice(urls[1].start, urls[1].end), 'url( "b c.png" )');
  assert.equal(css.slice(urls[1].urlStart, urls[1].urlEnd), "b c.png");
  assert.equal(urls[1].quote, '"');
  assert.equal(urls[0].quote, "");
  assert.deepEqual(parseImport('url("a.css") screen and (min-width: 1px)'), { url: "a.css", rest: "screen and (min-width: 1px)" });
  assert.deepEqual(parseImport("'b.css'"), { url: "b.css", rest: "" });
  assert.deepEqual(parseImport("url(c.css) layer(base)"), { url: "c.css", rest: "layer(base)" });
  assert.equal(parseImport(""), null);
});

test("formatCss pretty prints and is idempotent", () => {
  const out = formatCss(SAMPLE);
  assert.match(out, /^\/\* header \*\/\n@charset "utf-8";\n@import url\("a.css"\) screen;\n\n:root \{\n  --accent: #4f46e5;/);
  assert.match(out, /a:hover,\na:focus-visible > span \{\n  color: red !important;/);
  assert.match(out, /\.btn::after \{\n  content: "a;b\{c\}\/\*d\*\/";\n  margin: 0 auto;\n\}/);
  assert.match(out, /padding: calc\(1rem \+ 2px\) 1rem; \/\* inline \*\//);
  assert.match(out, /@media \(max-width: 991px\) \{\n  \.card \{\n    padding: 1rem;\n  \}\n\n  \.a \{/);
  assert.ok(out.endsWith("}\n"));
  assert.equal(formatCss(out), out);
  assert.deepEqual(shape(P(out)), shape(P(SAMPLE)));
  assert.equal(formatCss("a{b:c}", { indent: "\t" }), "a {\n\tb: c;\n}\n");
  assert.equal(formatCss(""), "");
  assert.equal(formatCss("a{}"), "a {}\n");
  assert.equal(formatCss("a{b:c"), "a {\n  b: c;\n");
  assert.equal(formatCss('a{content:"x   y"}'), 'a {\n  content: "x   y";\n}\n');
  assert.equal(formatCss("/* only */"), "/* only */\n");
});

test("minifyCss keeps meaning", () => {
  const min = minifyCss(SAMPLE);
  assert.ok(!min.includes("/* header */") && !min.includes("/* inline */"));
  assert.ok(!min.includes("\n"));
  assert.ok(min.includes("calc(1rem + 2px) 1rem"), "calc operators keep their spaces");
  assert.ok(min.includes('content:"a;b{c}/*d*/"'));
  assert.ok(min.includes("a:hover,a:focus-visible>span{color:red!important"));
  assert.ok(min.includes("url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>) no-repeat"));
  assert.ok(min.includes("@media (max-width:991px){.card{padding:1rem}.a{b:c}}"));
  assert.ok(min.includes("@media screen and (min-width:768px) and (max-width:991px){"));
  assert.ok(min.includes("--font:\"Inter\", sans-serif"));
  assert.deepEqual(shape(P(min)), shape(P(SAMPLE)));
  assert.equal(minifyCss(min), min);
  assert.equal(minifyCss("a  >  b , c { margin : 0   auto ; }"), "a>b,c{margin:0 auto}");
  assert.equal(minifyCss("a :hover{x:y}"), "a :hover{x:y}");
  assert.equal(minifyCss('a{content:"  x  "}'), 'a{content:"  x  "}');
  assert.equal(minifyCss("a{margin:-1px -2px}"), "a{margin:-1px -2px}");
  assert.equal(minifyCss("a{width:calc(100% - 10px)}"), "a{width:calc(100% - 10px)}");
  assert.equal(minifyCss("a{b:c/**/d}"), "a{b:c d}");
});

test("extra diagnostics: unclosed parenthesis and invalid property names", () => {
  assert.ok(codes(P("a{b:calc(1px + 2px;c:d}")).includes("css/unclosed-paren"));
  assert.ok(codes(P("a{b:url(x.png}")).includes("css/unclosed-paren"));
  assert.deepEqual(codes(P("a{b:calc(1px + 2px);c:url(a;b)}")), []);
  assert.ok(codes(P("a{max-wid margin: 0}")).includes("css/invalid-declaration"));
  assert.equal(P("a{max-wid margin: 0; color: red}").rules[0].decls.length, 1);
});

test("formatCss and minifyCss keep braces inside custom property values and never repair invalid selectors", () => {
  const css = "a{--x: { b: c;  d: e }; color: red}";
  assert.equal(P(css).rules[0].decls[0].value, "{ b: c;  d: e }");
  const f = formatCss(css);
  const m = minifyCss(css);
  assert.deepEqual(shape(P(f)), shape(P(css)));
  assert.deepEqual(shape(P(m)), shape(P(css)));
  assert.ok(m.includes("{ b: c; d: e }"));
  // an escaped semicolon at the end of a block is not a terminator
  assert.equal(minifyCss("a{b:c \\;}"), "a{b:c \\;}");
  assert.equal(minifyCss("a{b:c;}"), "a{b:c}");
  // an empty selector member is invalid CSS: keep it as written
  assert.ok(formatCss("a,,b{c:d}").startsWith("a,,b {"));
  assert.equal(formatCss("a,b{c:d}"), "a,\nb {\n  c: d;\n}\n");
});
