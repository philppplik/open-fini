import test from "node:test";
import assert from "node:assert/strict";
import { auditDesign, auditHtml, auditCss, scanHtml, backgroundBehind, flattenLayers, toMarkdown, summarize, runAudit, applyFix, selectIssue, mix } from "../../extensions/a11y-checker/src/lib.js";
import { mockApi } from "./_mock.js";

const rule = (issues, r) => issues.filter((i) => i.rule === r);

test("design: low contrast text is an error with a working fix suggestion", () => {
  const layers = [
    { id: "t", type: "text", name: "Title", text: "Hello", fill: "#aaaaaa", fontSize: 20, x: 10, y: 10, w: 100, h: 30 },
    { id: "bg", type: "rect", name: "Card", fill: "#ffffff", x: 0, y: 0, w: 400, h: 300 },
  ];
  const issues = auditDesign({ layers, pageBg: "#ffffff" });
  const c = rule(issues, "contrast");
  assert.equal(c.length, 1);
  assert.equal(c[0].severity, "error");
  assert.equal(c[0].layerId, "t");
  assert.equal(c[0].fix.kind, "style");
  assert.equal(c[0].fix.args.ids[0], "t");
  assert.match(c[0].fix.args.fill, /^#[0-9a-f]{6}$/);
});

test("design: large text only needs 3:1, good contrast passes, the layer behind decides the background", () => {
  const big = [{ id: "t", type: "text", text: "Big", fill: "#777777", fontSize: 32, x: 10, y: 10, w: 100, h: 40 }, { id: "bg", type: "rect", fill: "#ffffff", x: 0, y: 0, w: 300, h: 300 }];
  assert.equal(rule(auditDesign({ layers: big }), "contrast").length, 0);
  const dark = [{ id: "t", type: "text", text: "On dark", fill: "#222222", fontSize: 16, x: 10, y: 10, w: 100, h: 20 }, { id: "bg", type: "rect", fill: "#111111", x: 0, y: 0, w: 300, h: 300 }];
  assert.equal(rule(auditDesign({ layers: dark, pageBg: "#ffffff" }), "contrast")[0].severity, "error");
  const ok = [{ id: "t", type: "text", text: "Fine", fill: "#111111", fontSize: 16, x: 10, y: 10, w: 100, h: 20 }];
  assert.equal(rule(auditDesign({ layers: ok, pageBg: "#ffffff" }), "contrast").length, 0);
});

test("design: layers above the text and hidden layers are not the background; images and gradients are reported as unknown", () => {
  const above = [{ id: "cover", type: "rect", fill: "#000000", x: 0, y: 0, w: 300, h: 300 }, { id: "t", type: "text", text: "T", fill: "#111111", fontSize: 16, x: 10, y: 10, w: 50, h: 20 }];
  assert.equal(rule(auditDesign({ layers: above, pageBg: "#ffffff" }), "contrast").length, 0);
  const photo = [{ id: "t", type: "text", text: "T", fill: "#ffffff", fontSize: 16, x: 10, y: 10, w: 50, h: 20 }, { id: "img", type: "image", name: "Photo", alt: "a photo", x: 0, y: 0, w: 300, h: 300 }];
  assert.equal(rule(auditDesign({ layers: photo }), "contrast-unknown").length, 1);
  const grad = [{ id: "t", type: "text", text: "T", fill: "#ffffff", fontSize: 16, x: 10, y: 10, w: 50, h: 20 }, { id: "g", type: "rect", fill: "linear-gradient(#000, #fff)", x: 0, y: 0, w: 300, h: 300 }];
  assert.equal(rule(auditDesign({ layers: grad }), "contrast-unknown").length, 1);
  const flat = flattenLayers(above);
  assert.equal(backgroundBehind(flat, flat[1], null).kind, "page");
  assert.equal(backgroundBehind(flat, flat[1], null).assumed, true);
});

test("design: transparency lowers the effective contrast", () => {
  assert.deepEqual(mix([0, 0, 0], [255, 255, 255], 0.5).map(Math.round), [128, 128, 128]);
  const faded = [{ id: "t", type: "text", text: "Faded", fill: "#000000", opacity: 0.3, fontSize: 16, x: 0, y: 0, w: 50, h: 20 }];
  assert.equal(rule(auditDesign({ layers: faded, pageBg: "#ffffff" }), "contrast").length, 1);
});

test("design: small fonts, missing alt text and its fix", () => {
  const layers = [
    { id: "a", type: "text", text: "tiny", fill: "#000000", fontSize: 8, x: 0, y: 0, w: 20, h: 10 },
    { id: "b", type: "text", text: "small", fill: "#000000", fontSize: 11, x: 0, y: 40, w: 20, h: 10 },
    { id: "c", type: "image", name: "Hero", x: 0, y: 100, w: 50, h: 50 },
    { id: "d", type: "image", name: "Ok", alt: "A dog", x: 0, y: 200, w: 50, h: 50 },
    { id: "e", type: "text", text: "hidden", visible: false, fontSize: 4, fill: "#000000" },
  ];
  const issues = auditDesign({ layers, pageBg: "#ffffff" });
  const fonts = rule(issues, "min-font-size");
  assert.deepEqual(fonts.map((f) => [f.layerId, f.severity]).sort(), [["a", "error"], ["b", "warning"]]);
  assert.deepEqual(fonts[0].fix.args, { ids: [fonts[0].layerId], fontSize: 12 });
  const alt = rule(issues, "alt-text");
  assert.equal(alt.length, 1);
  assert.equal(alt[0].layerId, "c");
  assert.equal(alt[0].fix.args.alt, "Image: Hero");
  assert.equal(rule(issues, "min-font-size").some((f) => f.layerId === "e"), false);
});

test("design: reading order differs from visual order", () => {
  // listed front to back: stack (back to front) is Footer, Header, so Footer is read first although it is at the bottom
  const layers = [
    { id: "h", type: "text", name: "Header", text: "Header text", fill: "#000", fontSize: 20, x: 0, y: 0, w: 100, h: 20 },
    { id: "f", type: "text", name: "Footer", text: "Footer text", fill: "#000", fontSize: 20, x: 0, y: 500, w: 100, h: 20 },
  ];
  const issues = rule(auditDesign({ layers, pageBg: "#fff" }), "reading-order");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "info");
  const ordered = [layers[1], layers[0]];
  assert.equal(rule(auditDesign({ layers: ordered, pageBg: "#fff" }), "reading-order").length, 0);
});

const PAGE = `<!doctype html>
<html>
<head><title>Shop</title><meta name="viewport" content="width=device-width, user-scalable=no">
<style>
.btn { color: #999999; background: #ffffff; }
.ok { color: #000; background-color: #fff; }
a:focus { outline: none; }
</style></head>
<body>
<h3>Skipped</h3>
<img src="a.png">
<img src="b.png" alt="">
<img src="c.png" alt="Chart of sales">
<a href="/x">click here</a>
<a href="/y"></a>
<input type="text" name="q" placeholder="Search">
<label for="mail">Mail</label><input id="mail" type="email">
<label>Wrapped <input type="text" name="w"></label>
<button></button>
<button aria-label="Close">x</button>
<div tabindex="3" id="d">x</div>
<div id="d" onclick="go()">dup</div>
<h1>One</h1><h1>Two</h1>
</body>
</html>`;

test("html: finds the common accessibility problems with locations and fixes", () => {
  const issues = auditHtml("index.html", PAGE);
  const has = (r, n = 1) => assert.equal(rule(issues, r).length, n, r);
  has("html-lang");
  has("landmark-main");
  has("viewport-zoom");
  has("img-alt");
  has("link-text");
  has("link-name");
  has("button-name");
  has("tabindex");
  has("duplicate-id");
  has("click-keyboard");
  has("multiple-h1");
  has("heading-order", 1);
  has("css-contrast");
  has("focus-outline");
  assert.equal(rule(issues, "form-label").length, 1, "only the unlabeled input is reported");
  assert.equal(rule(issues, "doc-title").length, 0);
  const lang = rule(issues, "html-lang")[0];
  assert.equal(lang.file, "index.html");
  assert.equal(lang.line, 2);
  assert.equal(lang.fix.replace, '<html lang="en">');
  const img = rule(issues, "img-alt")[0];
  assert.equal(img.line, 11);
  assert.equal(img.tag, "img");
  assert.equal(img.nth, 0);
  assert.match(img.fix.replace, /alt="TODO describe this image"/);
  assert.match(rule(issues, "form-label")[0].fix.label, /Search/);
  assert.equal(rule(issues, "tabindex")[0].fix.replace.includes("tabindex"), false);
  assert.equal(rule(issues, "css-contrast")[0].line, 5);
});

test("html: a clean page has no issues", () => {
  const clean = `<!doctype html><html lang="en"><head><title>T</title></head><body><header><nav aria-label="Main"><a href="/">Home</a></nav></header><main><h1>Hi</h1><h2>Sub</h2><img src="a.png" alt="A cat"><form><label for="n">Name</label><input id="n"><button>Send</button></form></main></body></html>`;
  assert.deepEqual(auditHtml("index.html", clean).map((i) => i.rule), []);
});

test("html scanner: nth counts body elements per tag and skips svg content", () => {
  const { elements } = scanHtml("<html><head><title>x</title></head><body><svg><a href='#'></a></svg><a href='#'>1</a><a href='#'>2</a></body></html>");
  const anchors = elements.filter((e) => e.tag === "a");
  assert.deepEqual(anchors.map((a) => a.nth), [-1, 0, 1]);
});

test("css: contrast pairs per rule, large text threshold, no false alarms for var()", () => {
  assert.equal(auditCss("a.css", "a{color:#777;background:#fff}").length, 1);
  assert.equal(auditCss("a.css", "a{color:#777;background:#fff;font-size:30px}").length, 0);
  assert.equal(auditCss("a.css", "a{color:var(--x);background:#fff}").length, 0);
  assert.equal(auditCss("a.css", "@media (x){b{color:#fff;background:#fff}}").length, 1);
  assert.equal(auditCss("a.css", "/* a{color:#fff;background:#fff} */").length, 0);
});

test("fixes are applied through the tools on the exact element", async () => {
  const text = '<html>\n<body>\n<img src="a.png">\n<img src="a.png">\n</body></html>';
  const api = mockApi({ studio: "code", files: { "index.html": text } });
  const issues = auditHtml("index.html", text).filter((i) => i.rule === "img-alt");
  assert.equal(issues.length, 2);
  await applyFix(api, issues[1]);
  assert.equal(api.fileMap["index.html"], '<html>\n<body>\n<img src="a.png">\n<img src="a.png" alt="TODO describe this image">\n</body></html>');
  await assert.rejects(() => applyFix(api, { rule: "x" }), /no safe automatic fix/);
  await assert.rejects(() => applyFix(api, { ...issues[0], fix: { ...issues[0].fix, find: "<img nope>" } }), /changed since/);
  const design = mockApi({});
  await applyFix(design, { fix: { kind: "style", args: { ids: ["t"], fontSize: 12 } } });
  assert.deepEqual(design.calls[0], ["set_style", { ids: ["t"], fontSize: 12 }]);
});

test("selectIssue selects layers directly and elements through the page outline", async () => {
  const api = mockApi({ tools: { get_page_outline: () => "index.html\n[1] body\n  [2] h1 “Hi”\n  [3] a “x”\n  [4] a “y”" } });
  assert.equal(await selectIssue(api, { layerId: "L9" }), true);
  assert.deepEqual(api.calls[0], ["select_layers", { ids: ["L9"] }]);
  assert.equal(await selectIssue(api, { file: "index.html", tag: "a", nth: 1 }), true);
  assert.deepEqual(api.calls.at(-1), ["select_element", { id: 4 }]);
  assert.equal(await selectIssue(api, { file: "index.html", tag: "a", nth: 5 }), false);
  assert.equal(await selectIssue(api, { file: "x.css", where: "x.css:3" }), false);
});

test("runAudit picks the design or the website audit by studio and reuses check_problems", async () => {
  const design = mockApi({ layers: [{ id: "i", type: "image", name: "Pic", x: 0, y: 0, w: 5, h: 5 }], pages: [{ name: "P", active: true, background: "#ffffff" }] });
  const d = await runAudit(design);
  assert.equal(d.kind, "design");
  assert.equal(d.issues[0].rule, "alt-text");
  const code = mockApi({ studio: "code", files: { "index.html": '<html lang="en"><head><title>t</title></head><body><main><img src="a.png"></main></body></html>', "x.css": "a{color:#fff;background:#fff}", "n.js": "1" }, tools: { check_problems: () => ({ problems: ["error index.html: Unclosed tag"], console: [] }) } });
  const c = await runAudit(code);
  assert.equal(c.kind, "code");
  assert.deepEqual(c.issues.map((i) => i.rule).sort(), ["css-contrast", "img-alt", "project-check"]);
  await assert.rejects(() => runAudit({ studio: { current: async () => "vector" }, document: { info: async () => ({ activeDocument: null }) } }), /Open a document/);
});

test("markdown report summarizes by severity and mentions limits", () => {
  const issues = [{ rule: "contrast", severity: "error", where: "Layer “A”", message: "Low", fix: { label: "Use #000000" } }, { rule: "alt-text", severity: "warning", where: "index.html:3", message: "No alt" }];
  const md = toMarkdown({ target: "Doc", issues, date: "2026-10-20" });
  assert.match(md, /^# Accessibility report/);
  assert.match(md, /\*\*Result:\*\* 1 errors, 1 warnings, 0 notes/);
  assert.match(md, /## Errors \(1\)\n\n- \*\*contrast\*\* at Layer “A”: Low _Fix: Use #000000\._/);
  assert.match(md, /## Warnings \(1\)/);
  assert.match(toMarkdown({ issues: [] }), /No issues found/);
  assert.deepEqual(summarize(issues), { errors: 1, warnings: 1, info: 0 });
});
