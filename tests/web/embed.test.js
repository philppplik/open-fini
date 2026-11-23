// Smart embedding: the reference text for each pair of file types (engine/web/embed.js).
import test from "node:test";
import assert from "node:assert/strict";
import { embedSnippet, relativeImportPath, identifierFor, canInline, dataUriFor, INLINE_LIMIT } from "../../app/src/engine/web/embed.js";

const text = (t, a, o) => embedSnippet(t, a, o).text;

test("images: <img> in HTML, url() in CSS, ![]() in Markdown, \\includegraphics in LaTeX", () => {
  assert.equal(text("index.html", "img/logo.png"), '<img src="img/logo.png" alt="logo" />');
  assert.equal(text("pages/about.html", "img/my photo.jpg"), '<img src="../img/my%20photo.jpg" alt="my photo" />');
  assert.equal(text("css/site.css", "img/bg.webp"), 'url("../img/bg.webp")');
  assert.equal(text("README.md", "docs/shot.png"), "![shot](docs/shot.png)");
  assert.equal(text("paper/main.tex", "paper/fig/plot.pdf"), "\\includegraphics[width=\\linewidth]{fig/plot.pdf}");
  assert.equal(text("App.vue", "assets/a.svg"), '<img src="assets/a.svg" alt="a" />');
});

test("stylesheets and scripts", () => {
  assert.equal(text("index.html", "css/site.css"), '<link rel="stylesheet" href="css/site.css" />');
  assert.equal(text("index.html", "js/app.js"), '<script src="js/app.js"></script>');
  assert.equal(text("index.html", "js/app.mjs"), '<script type="module" src="js/app.mjs"></script>');
  assert.equal(text("css/site.css", "css/base/reset.css"), '@import url("base/reset.css");');
  assert.equal(text("src/main.js", "src/styles.css"), 'import "./styles.css";');
  assert.ok(embedSnippet("index.html", "css/site.css").block);
});

test("JavaScript and TypeScript imports use relative module specifiers", () => {
  assert.equal(text("src/main.js", "src/lib/util.js"), 'import util from "./lib/util.js";');
  assert.equal(text("src/a/main.js", "src/b/util.js"), 'import util from "../b/util.js";');
  assert.equal(text("src/app.ts", "src/data-store.ts"), 'import dataStore from "./data-store";');
  assert.equal(text("src/main.js", "data/config.json"), 'import config from "../data/config.json" with { type: "json" };');
  assert.equal(text("src/app.tsx", "src/logo.svg"), 'import logo from "./logo.svg";');
  assert.equal(text("js/main.js", "img/hero-image.png"), 'const heroImage = new URL("../img/hero-image.png", import.meta.url).href;');
  assert.equal(relativeImportPath("a.js", "b.js"), "./b.js");
  assert.equal(relativeImportPath("x/a.js", "b.js"), "../b.js");
});

test("identifiers are valid JavaScript", () => {
  assert.equal(identifierFor("img/hero-image.png"), "heroImage");
  assert.equal(identifierFor("2x.png"), "_2x");
  assert.equal(identifierFor("class.js"), "classFile");
  assert.equal(identifierFor("my file (1).json"), "myFile1");
});

test("fonts, manifests, pages and everything else", () => {
  assert.match(text("css/a.css", "fonts/Inter-Bold.woff2"), /@font-face \{\n {2}font-family: "Inter";\n {2}src: url\("\.\.\/fonts\/Inter-Bold\.woff2"\) format\("woff2"\);/);
  assert.equal(text("index.html", "site.webmanifest"), '<link rel="manifest" href="site.webmanifest" />');
  assert.equal(text("index.html", "about.html"), '<a href="about.html">about</a>');
  assert.equal(text("README.md", "docs/guide.md"), "[guide](docs/guide.md)");
  assert.equal(text("config.yaml", "certs/ca.pem"), "certs/ca.pem");
  assert.equal(text("app/main.py", "app/util/helpers.py"), "import util.helpers");
  assert.equal(text("main.tex", "chapters/intro.tex"), "\\input{chapters/intro}");
});

test("attributes are escaped and URLs encoded", () => {
  assert.equal(text("index.html", 'img/a"b.png'), '<img src="img/a%22b.png" alt="a&quot;b" />');
  assert.equal(text("a.css", "img/(x).png"), 'url("img/%28x%29.png")');
});

test("inline data URIs for small files", () => {
  const uri = dataUriFor(new Uint8Array([137, 80, 78, 71]), "a.png");
  assert.equal(uri, "data:image/png;base64,iVBORw==");
  assert.equal(text("index.html", "a.png", { dataUri: uri }), `<img src="${uri}" alt="a" />`);
  assert.equal(text("a.css", "a.png", { dataUri: uri }), `url("${uri}")`);
  assert.equal(text("a.js", "a.png", { dataUri: uri }), `const a = "${uri}";`);
  assert.equal(canInline(INLINE_LIMIT), true);
  assert.equal(canInline(INLINE_LIMIT + 1), false);
});
