import test from "node:test";
import assert from "node:assert/strict";
import { safeRequestPath, resolveRequest, mimeFor, rewriteRefs, injectBeforeBodyEnd, liveReloadSnippet, diffStamps, standaloneKind, parseCsv, csvToHtml, jsonToHtml, validPort, fetchShim } from "../../app/src/engine/web/local-serve.js";

test("request paths: index, nesting, query and hash", () => {
  assert.equal(safeRequestPath("/"), "index.html");
  assert.equal(safeRequestPath(""), "index.html");
  assert.equal(safeRequestPath("/docs/"), "docs/index.html");
  assert.equal(safeRequestPath("/css/site.css?v=2#x"), "css/site.css");
  assert.equal(safeRequestPath("/a%20b/c.png"), "a b/c.png");
  assert.equal(safeRequestPath("/./a//b.js"), "a/b.js");
});

test("traversal protection", () => {
  for (const bad of ["/../secret", "/a/../../etc/passwd", "/%2e%2e/x", "/a/%2E%2E/%2e%2e/x", "/..%2fx", "/a\\..\\b", "/C:/Windows/win.ini", "/x%00.html", "/%zz", "/a\nb"]) {
    assert.equal(safeRequestPath(bad), null, bad);
    assert.equal(resolveRequest(bad, { has: () => true }).status, 403, bad);
  }
});

test("resolution order and SPA fallback", () => {
  const files = new Set(["index.html", "about.html", "docs/index.html", "app.js"]);
  const has = (p) => files.has(p);
  assert.deepEqual(resolveRequest("/about", { has }), { path: "about.html", status: 200 });
  assert.deepEqual(resolveRequest("/docs", { has }), { path: "docs/index.html", status: 200 });
  assert.deepEqual(resolveRequest("/app.js", { has }), { path: "app.js", status: 200 });
  assert.equal(resolveRequest("/users/42", { has }).status, 404);
  assert.deepEqual(resolveRequest("/users/42", { has, spa: true }), { path: "index.html", status: 200 });
  assert.equal(resolveRequest("/missing.png", { has, spa: true }).status, 404, "no SPA fallback for files with an extension");
});

test("MIME types", () => {
  assert.equal(mimeFor("a/b.HTML"), "text/html; charset=utf-8");
  assert.equal(mimeFor("x.mjs"), "text/javascript; charset=utf-8");
  assert.equal(mimeFor("f.woff2"), "font/woff2");
  assert.equal(mimeFor("d.json"), "application/json; charset=utf-8");
  assert.equal(mimeFor("i.svg"), "image/svg+xml");
  assert.equal(mimeFor("p.pdf"), "application/pdf");
  assert.equal(mimeFor("m.wasm"), "application/wasm");
  assert.equal(mimeFor("noext"), "application/octet-stream");
});

test("rewriting asset references for blob pages", () => {
  const urls = { "css/site.css": "blob:1", "img/a.png": "blob:2", "img/b.png": "blob:3", "fonts/f.woff2": "blob:4", "pages/about.html": "blob:5" };
  const urlFor = (p) => urls[p] || null;
  const html = `<link href="../css/site.css"><img src="../img/a.png" srcset="../img/a.png 1x, ../img/b.png 2x"><a href="about.html#top">x</a><a href="https://x.org/a.png">e</a><div style="background:url('../img/b.png')"></div><style>@font-face{src:url(../fonts/f.woff2)}</style><img src="data:image/png;base64,AA">`;
  const out = rewriteRefs(html, "pages/index.html", urlFor);
  assert.ok(out.includes('href="blob:1"'));
  assert.ok(out.includes('src="blob:2"'));
  assert.ok(out.includes('srcset="blob:2 1x, blob:3 2x"'));
  assert.ok(out.includes('href="blob:5#top"'));
  assert.ok(out.includes('href="https://x.org/a.png"'));
  assert.ok(out.includes("url('blob:3')"));
  assert.ok(out.includes("url(blob:4)"));
  assert.ok(out.includes('src="data:image/png;base64,AA"'));
  assert.equal(rewriteRefs("a{background:url(missing.png)}", "x.css", urlFor), "a{background:url(missing.png)}");
  assert.equal(rewriteRefs('@import "../img/a.png";', "css/x.css", urlFor), '@import "blob:2";');
});

test("live reload injection and fetch shim", () => {
  const s = liveReloadSnippet("/t/abc/__of_rev");
  assert.ok(s.includes('"/t/abc/__of_rev"'));
  assert.equal(injectBeforeBodyEnd("<body>x</body>", "<i>"), "<body>x<i></body>");
  assert.equal(injectBeforeBodyEnd("x", "<i>"), "x<i>");
  assert.ok(!fetchShim({ "a</script>.json": "blob:x" }, "index.html").includes("a</script>"));
});

test("disk change detection", () => {
  assert.deepEqual(diffStamps({ a: "1", b: "1", c: "1" }, { a: "1", b: "2", d: "1" }), { changed: ["b"], added: ["d"], removed: ["c"] });
});

test("standalone previews", () => {
  assert.equal(standaloneKind("a.md"), "markdown");
  assert.equal(standaloneKind("a.SVG"), "svg");
  assert.equal(standaloneKind("a.jpeg"), "image");
  assert.equal(standaloneKind("a.pdf"), "pdf");
  assert.equal(standaloneKind("a.csv"), "csv");
  assert.equal(standaloneKind("a.json"), "json");
  assert.equal(standaloneKind("a.htm"), "html");
  assert.equal(standaloneKind("a.exe"), null);
  assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n1,2,3'), [["a", "b,c", 'd"e'], ["1", "2", "3"]]);
  assert.ok(csvToHtml("<x>,y\n1,2").includes("<th>&lt;x&gt;</th>"));
  assert.ok(jsonToHtml('{"a":1}').includes("&quot;a&quot;: 1"));
  assert.ok(jsonToHtml("{oops").includes("of-json-error"));
});

test("port setting", () => {
  assert.equal(validPort(5520), 5520);
  assert.equal(validPort(80), 0);
  assert.equal(validPort("x"), 0);
  assert.equal(validPort(70000), 0);
});
