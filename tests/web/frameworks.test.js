import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { TEMPLATES, getTemplate } from "../../app/src/engine/web/templates.js";
import { parseHtml, getAttr, classList } from "../../app/src/engine/web/html.js";
import { parseCss } from "../../app/src/engine/web/css.js";
import { buildPreview, scanModuleSpecifiers } from "../../app/src/engine/web/preview.js";
import { buildSite } from "../../app/src/engine/web/site.js";
import { resolveRef, extname } from "../../app/src/engine/web/paths.js";
import { isAllowedCdnUrl, readImportMap, resolveWithImportMap } from "../../app/src/engine/web/libs.js";
import { detectFrameworks, tailwindClasses, BOOTSTRAP_CLASSES, FRAMEWORK_ELEMENT_CATEGORIES, attributeOptions, htmxValues, splitVariant } from "../../app/src/engine/web/frameworks.js";
import { buildMarkdownSite, renderLayout, planWrites, isSiteSource, usesMarkdownSite, outputPathFor, GENERATED_MARKER } from "../../app/src/engine/web/ssg.js";
import { makeFiles } from "./_helpers.js";

const FW = TEMPLATES.filter((t) => t.framework);
const IDS = ["tailwind", "bootstrap", "alpine", "htmx", "vue", "preact-htm", "react", "lit", "web-components", "three", "md-blog", "md-docs", "pwa"];

/** Syntax check for ES module source (imports are removed, exports unwrapped). */
function checkModule(code, name) {
  const body = code.replace(/^\s*import\s[^;]*;?$/gm, "").replace(/^export default /gm, "const __default = ").replace(/^export (?=(?:const|let|var|class|function|async))/gm, "");
  assert.doesNotThrow(() => new vm.Script(`(async function(){\n${body}\n})`, { filename: name }), name);
}

test("framework templates: metadata", () => {
  assert.deepEqual(FW.map((t) => t.id), IDS);
  for (const t of FW) {
    assert.ok(t.description.length > 20 && t.description.length < 160, t.id);
    assert.ok(["Starter", "Content", "Framework"].includes(t.category), t.id);
    assert.match(t.accent, /^#[0-9a-f]{6}$/);
    assert.ok(t.files["index.html"], t.id);
    assert.ok(Array.isArray(t.libs), t.id);
    assert.equal(getTemplate(t.id).id, t.id);
  }
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
});

for (const tpl of FW) {
  test(`${tpl.name}: pages are valid HTML, every local reference exists and scripts parse`, () => {
    const files = makeFiles(tpl.files);
    const pages = Object.keys(tpl.files).filter((p) => p.endsWith(".html"));
    for (const path of pages) {
      const src = tpl.files[path];
      const p = parseHtml(src);
      assert.deepEqual(p.errors, [], `${tpl.id}/${path}: ${JSON.stringify(p.errors.slice(0, 3))}`);
      assert.ok(/^<!doctype html>/i.test(src.replace(/^<!--.*?-->\s*/s, "")) || /^<!doctype html>/i.test(src), `${path}: doctype`);
      assert.equal(getAttr(p.elements.find((e) => e.tag === "html"), "lang"), "en-US");
      assert.ok(p.elements.some((e) => e.tag === "meta" && getAttr(e, "name") === "viewport"), "viewport");
      assert.ok(p.elements.some((e) => e.tag === "title"), "title");
      assert.ok(p.elements.some((e) => e.tag === "main"), `${path}: main landmark`);
      assert.ok(!/ on[a-z]+=/i.test(src), `${path}: inline event handler`);
      for (const img of p.elements.filter((e) => e.tag === "img")) assert.notEqual(getAttr(img, "alt"), null);
      for (const b of p.elements.filter((e) => e.tag === "button")) assert.ok(getAttr(b, "type"), `${path}: button type`);
      // external requests only to CDNs the desktop CSP allows
      for (const el of p.elements) {
        const url = el.tag === "script" || el.tag === "img" ? getAttr(el, "src") : el.tag === "link" ? getAttr(el, "href") : null;
        if (url && /^(https?:)?\/\//.test(url)) assert.ok(isAllowedCdnUrl(url), `${path}: ${url}`);
        if (url && !/^(https?:)?\/\//.test(url) && !url.startsWith("data:")) {
          const ref = resolveRef(path, url);
          assert.ok(ref && tpl.files[ref.path], `${path}: missing ${url}`);
        }
      }
    }
    for (const [path, src] of Object.entries(tpl.files)) {
      assert.ok(!path.startsWith("/") && !path.includes(".."), path);
      assert.ok(!/lorem|ipsum|\btodo\b|fixme/i.test(src.replace(/To-do|to-do|todos|Todo/g, "")), `${path}: placeholder text`);
      if (path.endsWith(".css")) assert.deepEqual(parseCss(src).errors, [], path);
      if (path.endsWith(".json") || path.endsWith(".webmanifest")) assert.doesNotThrow(() => JSON.parse(src), path);
      if (path.endsWith(".js")) {
        const isModule = /^\s*(import|export)\s/m.test(src);
        if (isModule) checkModule(src, path);
        else assert.doesNotThrow(() => new vm.Script(src, { filename: path }), path);
        // relative imports exist
        for (const s of scanModuleSpecifiers(src)) {
          if (!/^\.\.?\//.test(s.specifier)) continue;
          const ref = resolveRef(path, s.specifier);
          assert.ok(tpl.files[ref.path], `${path}: import ${s.specifier}`);
        }
      }
      if (path.endsWith(".svg")) assert.ok(src.startsWith("<svg") && src.includes("viewBox"));
    }
    // every bare import is in the import map; CDN versions are pinned
    for (const path of pages) {
      const p = parseHtml(tpl.files[path]);
      const im = readImportMap(p);
      if (im) {
        assert.ok(im.valid, `${path}: import map JSON`);
        for (const url of Object.values(im.map.imports)) assert.match(url, /@\d+\.\d+\.\d+/, `${url} is pinned`);
      }
      for (const [file, src] of Object.entries(tpl.files)) {
        if (!file.endsWith(".js")) continue;
        for (const s of scanModuleSpecifiers(src)) {
          if (/^(\.|\/|https?:)/.test(s.specifier)) continue;
          assert.ok(im && resolveWithImportMap(im.map.imports, s.specifier), `${file}: "${s.specifier}" is not in the import map of ${path}`);
        }
      }
    }
    // the preview builds without diagnostics (this applies the import map to module code)
    for (const path of pages) {
      const scripts = [];
      const res = buildPreview(files, path, { makeScriptUrl: (code) => (scripts.push(code), `data:text/javascript,#${scripts.length}`), annotate: true });
      assert.deepEqual(res.diagnostics, [], `${tpl.id}/${path}`);
      for (const code of scripts) assert.ok(!/from ["'](vue|react|react-dom\/client|htm|lit|three|preact-htm)["']/.test(code), "bare specifiers are resolved in the preview");
    }
    const site = buildSite(files);
    assert.deepEqual(site.warnings, [], `${tpl.id} export`);
    assert.ok(site.files.some((f) => f.path === "index.html"));
  });
}

test("Markdown templates keep generated pages in sync with their sources", () => {
  for (const id of ["md-blog", "md-docs"]) {
    const t = getTemplate(id);
    const files = makeFiles(t.files);
    assert.ok(usesMarkdownSite(files));
    const built = buildMarkdownSite(files);
    assert.deepEqual(built.diagnostics.filter((d) => d.severity !== "info"), [], id);
    for (const [path, html] of Object.entries(built.files)) {
      assert.equal(t.files[path], html, `${id}/${path} is current`);
      assert.ok(html.includes(GENERATED_MARKER));
    }
    assert.ok(t.files["index.html"] && t.files["layouts/page.tmpl"]);
  }
  const blog = getTemplate("md-blog").files;
  assert.ok(blog["index.html"].includes("posts/finding-your-pace.html"), "index lists posts");
  assert.ok(blog["posts/small-tools.html"].includes('href="../css/style.css"'), "root-relative paths in subfolders");
  assert.ok(blog["posts/finding-your-pace.html"].includes('href="second-draft.html"'), ".md links become .html links");
  assert.ok(blog["posts/finding-your-pace.html"].includes("<blockquote>"));
  assert.ok(getTemplate("md-docs").files["configuration.html"].includes('class="toc"') || getTemplate("md-docs").files["configuration.html"].includes("On this page"));
});

test("site generator: layouts, drafts, ordering and safety", () => {
  const files = makeFiles({
    "site.json": '{"title":"S"}',
    "layouts/page.tmpl": '<!doctype html><title>{{title}}</title><body>{{{content}}}{{#if date}}<time>{{date}}</time>{{/if}}{{#each nav}}<a href="{{url}}">{{title}}</a>{{/each}}',
    "layouts/index.tmpl": "<!doctype html><ul>{{#each posts}}<li>{{title}}|{{url}}</li>{{/each}}</ul>{{site.title}}",
    "content/index.md": "# Home",
    "content/posts/b.md": "---\ntitle: B <script>\ndate: 2026-01-01\n---\n![i](/assets/x.png) [o](a.md#h)",
    "content/posts/a.md": "---\ntitle: A\ndate: 2026-02-01\n---\nA",
    "content/posts/draft.md": "---\ndraft: true\n---\nD",
    "content/_hidden.md": "x",
  });
  const b = buildMarkdownSite(files);
  assert.deepEqual(Object.keys(b.files).sort(), ["index.html", "posts/a.html", "posts/b.html"]);
  const idx = b.files["index.html"];
  assert.ok(idx.indexOf("A|posts/a.html") < idx.indexOf("B &lt;script&gt;|posts/b.html"), "newest first, titles escaped");
  assert.ok(idx.includes("S"));
  const post = b.files["posts/b.html"];
  assert.ok(post.includes('src="../assets/x.png"') && post.includes('href="a.html#h"'));
  assert.ok(!post.includes("<script>"));
  assert.ok(post.includes("<time>2026-01-01</time>"));
  assert.equal(outputPathFor("content/guide/x.md", {}), "guide/x.html");
  assert.equal(outputPathFor("content/a.md", { slug: "Hello World" }), "hello-world.html");
  assert.ok(isSiteSource("content/a.md") && isSiteSource("layouts/x.tmpl") && isSiteSource("site.json") && !isSiteSource("css/a.css"));
  // existing hand-written files are protected
  const plan = planWrites(b, { readText: (p) => (p === "index.html" ? "<h1>mine</h1>" : p === "posts/a.html" ? `<!-- ${GENERATED_MARKER} old -->` : null) });
  assert.deepEqual(plan.skipped, ["index.html"]);
  assert.deepEqual(Object.keys(plan.write).sort(), ["posts/a.html", "posts/b.html"]);
  // no layouts: a plain page and a diagnostic
  const bare = buildMarkdownSite(makeFiles({ "content/index.md": "# Hi" }));
  assert.ok(bare.files["index.html"].includes("<h1"));
  assert.ok(bare.diagnostics.length > 0);
});

test("layout renderer: escaping, loops, conditions, parent scope", () => {
  assert.equal(renderLayout("{{a}} {{{a}}}", { a: "<b>" }), "&lt;b&gt; <b>");
  assert.equal(renderLayout("{{#each xs}}[{{n}}{{../p}}]{{/each}}", { xs: [{ n: 1 }, { n: 2 }], p: "!" }), "[1!][2!]");
  assert.equal(renderLayout("{{#if x}}yes{{/if}}{{#if y}}no{{/if}}", { x: 1, y: [] }), "yes");
  assert.equal(renderLayout("{{#each a}}{{#each b}}{{v}}{{/each}};{{/each}}", { a: [{ b: [{ v: 1 }, { v: 2 }] }, { b: [{ v: 3 }] }] }), "12;3;");
  assert.equal(renderLayout("{{missing}}{{a.b.c}}", { a: {} }), "");
});

test("framework detection and completion data", () => {
  const f = detectFrameworks(makeFiles({
    "index.html": '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script><div x-data="a" hx-get="/x">',
    "js/a.js": 'import { createApp } from "vue"; import * as T from "three";',
  }));
  assert.deepEqual([...f].sort(), ["alpine", "htmx", "tailwind", "three", "vue"]);
  assert.equal(detectFrameworks(makeFiles({ "index.html": "<p>plain</p>" })).size, 0);
  const tw = tailwindClasses();
  assert.ok(tw.length > 2000 && tw.includes("bg-indigo-600") && tw.includes("md:") === false && tw.includes("grid-cols-3") && tw.includes("px-4"));
  assert.equal(tailwindClasses(), tw, "cached");
  assert.deepEqual(splitVariant("md:hover:bg-"), { prefix: "md:hover:", rest: "bg-" });
  assert.ok(BOOTSTRAP_CLASSES.includes("btn-primary") && BOOTSTRAP_CLASSES.includes("col-md-6") && BOOTSTRAP_CLASSES.includes("mt-3"));
  assert.ok(attributeOptions(new Set(["alpine"])).some((a) => a.label === "x-data"));
  assert.ok(attributeOptions(new Set(["htmx"])).some((a) => a.label === "hx-swap"));
  assert.equal(attributeOptions(new Set()).length, 0);
  assert.ok(htmxValues("hx-swap").includes("outerHTML"));
});

test("framework element snippets parse and have one root", () => {
  for (const cat of FRAMEWORK_ELEMENT_CATEGORIES) {
    assert.ok(cat.items.length >= 3, cat.id);
    for (const item of cat.items) {
      const p = parseHtml(item.html);
      assert.deepEqual(p.errors, [], item.id);
      assert.equal(p.children.filter((c) => c.type === "element").length, 1, `${item.id}: one root`);
      assert.ok(item.label && item.icon && item.description, item.id);
    }
  }
  const ids = FRAMEWORK_ELEMENT_CATEGORIES.flatMap((c) => c.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
  void classList;
  void extname;
});
