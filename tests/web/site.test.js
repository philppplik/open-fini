import test from "node:test";
import assert from "node:assert/strict";
import { buildSite, minifyHtml } from "../../app/src/engine/web/site.js";
import { parseHtml } from "../../app/src/engine/web/html.js";
import { makeFiles } from "./_helpers.js";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);
const dec = (b) => new TextDecoder().decode(b);
const byPath = (res) => Object.fromEntries(res.files.map((f) => [f.path, f.bytes]));

const PROJECT = {
  "index.html": '<!doctype html>\n<html lang="en-US">\n<head>\n  <meta charset="utf-8">\n  <title>Home</title>\n  <link rel="stylesheet" href="css/style.css">\n  <!-- build comment -->\n</head>\n<body>\n  <h1>Hello,   <em>world</em></h1>\n  <p>\n    One\n    <a href="about.html">two</a>\n    <b>three</b>\n  </p>\n  <pre>  keep\n    this  </pre>\n  <img src="assets/logo.png" alt="Logo">\n  <script src="js/main.js"></script>\n</body>\n</html>\n',
  "about.html": '<!doctype html><html lang="en-US"><head><title>About</title></head><body><h1>About</h1><a href="index.html">Home</a> <a href="blog/">Blog</a> <a href="missing.html">Gone</a> <a href="#top">top</a> <a href="https://example.com/x">ext</a></body></html>',
  "blog/index.html": "<!doctype html><title>Blog</title><h1>Blog</h1>",
  "404.html": "<!doctype html><title>Not found</title>",
  "css/style.css": "/* c */\nbody {\n  margin: 0;\n  background: url(../assets/logo.png);\n}\n.a   >   .b { color : red ; }\n.gone { background: url(../assets/gone.png) }\n",
  "js/main.js": "// js stays\nconsole.log( 'x' );\n",
  "assets/logo.png": PNG,
  ".hidden/secret.txt": "x",
  "node_modules/pkg/index.js": "x",
  ".gitignore": "x",
};

test("copies the project, skips dotfiles and node_modules, keeps bytes identical", () => {
  const res = buildSite(makeFiles(PROJECT));
  const out = byPath(res);
  assert.deepEqual(Object.keys(out).sort(), ["404.html", "about.html", "assets/logo.png", "blog/index.html", "css/style.css", "index.html", "js/main.js"]);
  assert.deepEqual(out["assets/logo.png"], PNG);
  assert.equal(dec(out["index.html"]), PROJECT["index.html"]);
  assert.equal(dec(out["css/style.css"]), PROJECT["css/style.css"]);
  assert.equal(res.stats.files, 7);
  assert.equal(res.stats.bytes, res.files.reduce((a, f) => a + f.bytes.length, 0));
  assert.ok(!/data-of|__OF_CONFIG__/.test(res.files.map((f) => dec(f.bytes)).join("")));
});

test("warnings list broken local references with their line", () => {
  const res = buildSite(makeFiles(PROJECT));
  assert.deepEqual(res.warnings, [
    'about.html (line 1): missing file "missing.html"',
    'css/style.css (line 7): missing file "assets/gone.png"',
  ]);
  const noIndex = buildSite(makeFiles({ "a.html": "<p>x</p>" }));
  assert.equal(noIndex.warnings.length, 1);
  assert.match(noIndex.warnings[0], /index\.html/);
  const custom = buildSite(makeFiles({ "home.html": "<p>x</p>" }), { entry: "home.html" });
  assert.deepEqual(custom.warnings, []);
  // srcset, poster, inline styles and <style> blocks are checked too
  const refs = buildSite(makeFiles({ "index.html": '<img srcset="a.png 1x, b.png 2x" alt=""><video poster="p.png"></video><div style="background:url(s.png)"></div><style>@import "x.css"; a{background:url(y.png)}</style>', "a.png": PNG }));
  assert.deepEqual(refs.warnings.map((w) => w.match(/"(.*)"/)[1]), ["b.png", "p.png", "s.png", "x.css", "y.png"]);
});

test("include filter", () => {
  const res = buildSite(makeFiles(PROJECT), { include: (p) => p.endsWith(".html") });
  assert.deepEqual(res.files.map((f) => f.path), ["404.html", "about.html", "blog/index.html", "index.html"]);
});

test("minify: HTML whitespace and comments, CSS, JS untouched", () => {
  const res = buildSite(makeFiles(PROJECT), { minify: true });
  const out = byPath(res);
  const html = dec(out["index.html"]);
  assert.ok(!html.includes("build comment"));
  assert.ok(html.includes("<h1>Hello, <em>world</em></h1>"));
  assert.ok(html.includes('<p>One <a href="about.html">two</a> <b>three</b></p>'));
  assert.ok(html.includes("<pre>  keep\n    this  </pre>"));
  assert.ok(html.includes('<img src="assets/logo.png" alt="Logo">'));
  assert.ok(html.length < PROJECT["index.html"].length);
  assert.equal(parseHtml(html).errors.filter((d) => d.severity === "error").length, 0);
  assert.equal(dec(out["css/style.css"]), "body{margin:0;background:url(../assets/logo.png)}.a>.b{color:red}.gone{background:url(../assets/gone.png)}");
  assert.equal(dec(out["js/main.js"]), PROJECT["js/main.js"]);
  assert.deepEqual(out["assets/logo.png"], PNG);
});

test("minifyHtml keeps meaningful whitespace and raw text", () => {
  assert.equal(minifyHtml("<p>a <b>b</b> <i>c</i></p>\n<div>\n  <span>x</span>\n  <span>y</span>\n</div>\n"), "<p>a <b>b</b> <i>c</i></p><div><span>x</span> <span>y</span></div>");
  assert.equal(minifyHtml("<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>"), "<ul><li>One</li><li>Two</li></ul>");
  assert.equal(minifyHtml("<textarea>\n  a   b\n</textarea>"), "<textarea>\n  a   b\n</textarea>");
  assert.equal(minifyHtml("<script>\n  var a = 1;\n  // x\n</script>"), "<script>\n  var a = 1;\n  // x\n</script>");
  assert.equal(minifyHtml("<style>\n  a { color : red }\n</style>"), "<style>a{color:red}</style>");
  assert.equal(minifyHtml("<!--[if IE]><p>ie</p><![endif]--><!-- gone --><p>x</p>"), "<!--[if IE]><p>ie</p><![endif]--><p>x</p>");
  assert.equal(minifyHtml('<div   class="a"\n     id="b">x</div>'), '<div class="a" id="b">x</div>');
  assert.equal(minifyHtml('<p>  lead and trail  </p>'), "<p>lead and trail</p>");
  assert.equal(minifyHtml("<span> a </span>"), "<span> a </span>");
  assert.equal(minifyHtml('<button>a</button> <button>b</button>'), "<button>a</button> <button>b</button>");
  assert.equal(minifyHtml(""), "");
  const doc = "<!doctype html>\n<html>\n<head>\n<title>  T  </title>\n</head>\n<body>\n<p>x</p>\n</body>\n</html>\n";
  assert.equal(minifyHtml(doc), "<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>");
});

test("sitemap.xml and robots.txt when siteUrl is set", () => {
  const res = buildSite(makeFiles(PROJECT), { siteUrl: "https://example.com/" });
  const out = byPath(res);
  const xml = dec(out["sitemap.xml"]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<loc>https://example.com/</loc>"));
  assert.ok(xml.includes("<loc>https://example.com/about.html</loc>"));
  assert.ok(xml.includes("<loc>https://example.com/blog/</loc>"));
  assert.ok(!xml.includes("404"));
  assert.equal(dec(out["robots.txt"]), "User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n");
  assert.ok(!byPath(buildSite(makeFiles(PROJECT)))["sitemap.xml"]);
  // user files win
  const own = buildSite(makeFiles({ ...PROJECT, "robots.txt": "mine" }), { siteUrl: "https://example.com" });
  assert.equal(dec(byPath(own)["robots.txt"]), "mine");
  assert.equal(own.files.filter((f) => f.path === "robots.txt").length, 1);
});

test("singleFile inlines CSS, JS and images and drops every other file", () => {
  const files = makeFiles({
    ...PROJECT,
    "css/style.css": '@import "extra.css";\nbody{background:url(../assets/logo.png)}',
    "css/extra.css": ".x{color:red}",
    "js/main.js": 'document.title = "</script>";',
  });
  const res = buildSite(files, { singleFile: true });
  assert.deepEqual(res.files.map((f) => f.path), ["404.html", "about.html", "blog/index.html", "index.html"]);
  const html = dec(byPath(res)["index.html"]);
  const b64 = Buffer.from(PNG).toString("base64");
  assert.ok(!html.includes("<link"));
  assert.ok(html.includes(`<style>.x{color:red}\nbody{background:url("data:image/png;base64,${b64}")}</style>`));
  assert.ok(html.includes(`<img src="data:image/png;base64,${b64}" alt="Logo">`));
  assert.ok(html.includes('<script>document.title = "<\\/script>";</script>'));
  assert.ok(!/data-of|data-of-file/.test(html));
  assert.ok(html.startsWith("<!doctype html>"));
  const min = dec(byPath(buildSite(files, { singleFile: true, minify: true }))["index.html"]);
  assert.ok(min.includes(`<style>.x{color:red}body{background:url("data:image/png;base64,${b64}")}</style>`));
  assert.ok(min.length < html.length);
  // module imports are inlined as data URLs
  const mod = buildSite(makeFiles({ "index.html": '<script type="module" src="m.js"></script>', "m.js": 'import { a } from "./a.js";', "a.js": "export const a = 1;" }), { singleFile: true });
  assert.match(dec(mod.files[0].bytes), /<script type="module">import \{ a \} from "data:text\/javascript;charset=utf-8,export%20const%20a%20%3D%201%3B";<\/script>/);
});
