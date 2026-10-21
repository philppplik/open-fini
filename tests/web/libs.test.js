import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCdnUrl, cdnUrl, isAllowedCdnUrl, compareVersions, CATALOG, catalogUrl, readImportMap, setImportMapEntry, addLibraryToPage,
  listPageLibraries, removeLibraryFromPage, retargetLibrary, listCodeImports, parseNpmSearch, parseJsdelivrPackage, parseJsdelivrFiles,
  parseCdnjsSearch, parseCdnjsLibrary, vendorPathFor, vendorFromUrl, vendoredRef, resolveWithImportMap, importMapChanges,
  npmSearchUrl, jsdelivrPackageUrl, cdnjsSearchUrl,
} from "../../app/src/engine/web/libs.js";
import { parseHtml } from "../../app/src/engine/web/html.js";
import { applyChanges } from "../../app/src/engine/web/edit.js";
import { buildPreview } from "../../app/src/engine/web/preview.js";
import { buildSite } from "../../app/src/engine/web/site.js";
import { makeFiles } from "./_helpers.js";

const page = (head = "", body = "") => `<!doctype html>\n<html lang="en-US">\n<head>\n  <meta charset="utf-8">\n  <title>T</title>\n${head}</head>\n<body>\n${body}</body>\n</html>\n`;
const edit = (src, fn) => {
  const out = applyChanges(src, fn(parseHtml(src)));
  assert.deepEqual(parseHtml(out).errors.filter((e) => e.severity === "error"), [], out);
  return out;
};

test("CDN URLs are parsed and built", () => {
  assert.deepEqual(parseCdnUrl("https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.runtime.esm-browser.prod.js"), { cdn: "jsdelivr", pkg: "vue", version: "3.5.13", file: "/dist/vue.runtime.esm-browser.prod.js" });
  assert.deepEqual(parseCdnUrl("https://cdn.jsdelivr.net/npm/@alpinejs/csp@3.14.9/dist/cdn.min.js"), { cdn: "jsdelivr", pkg: "@alpinejs/csp", version: "3.14.9", file: "/dist/cdn.min.js" });
  assert.deepEqual(parseCdnUrl("https://unpkg.com/lit@3/index.js"), { cdn: "unpkg", pkg: "lit", version: "3", file: "/index.js" });
  assert.deepEqual(parseCdnUrl("https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css"), { cdn: "cdnjs", pkg: "animate.css", version: "4.1.1", file: "/animate.min.css" });
  assert.equal(parseCdnUrl("https://example.com/a.js"), null);
  assert.equal(parseCdnUrl("nope"), null);
  assert.equal(cdnUrl({ pkg: "vue", version: "3.5.13", file: "dist/vue.js" }), "https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.js");
  assert.equal(cdnUrl({ cdn: "cdnjs", pkg: "animate.css", version: "4.1.1", file: "/animate.min.css" }), "https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css");
  assert.equal(cdnUrl({ cdn: "unpkg", pkg: "lit", version: "3.2.1" }), "https://unpkg.com/lit@3.2.1");
  assert.ok(isAllowedCdnUrl("https://unpkg.com/x") && !isAllowedCdnUrl("https://esm.sh/x") && !isAllowedCdnUrl("junk"));
});

test("versions compare numerically", () => {
  assert.equal(compareVersions("1.10.0", "1.9.2"), 1);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  assert.equal(compareVersions("3.0.0-beta.1", "3.0.0"), -1);
  assert.equal(compareVersions("v1.2", "1.2.0"), 0);
});

test("the catalog is consistent and only uses allowed CDNs", () => {
  const ids = new Set();
  for (const c of CATALOG) {
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
    assert.ok(["script", "module", "style"].includes(c.kind), c.id);
    assert.ok(isAllowedCdnUrl(catalogUrl(c)), c.id);
    assert.match(c.version, /^\d+\.\d+\.\d+$/);
    if (c.kind === "module") assert.ok(c.specifier, c.id);
    assert.ok(c.description.length > 10 && c.group, c.id);
  }
  assert.ok(CATALOG.length >= 20);
});

test("import maps: create, edit, remove", () => {
  let src = page('  <link rel="stylesheet" href="a.css">\n  <script type="module" src="main.js"></script>\n');
  src = edit(src, (p) => setImportMapEntry(p, "vue", "https://cdn.jsdelivr.net/npm/vue@3/+esm"));
  const p1 = parseHtml(src);
  assert.ok(src.indexOf('type="importmap"') < src.indexOf('src="main.js"'), "import map precedes module scripts");
  assert.deepEqual(readImportMap(p1).map.imports, { vue: "https://cdn.jsdelivr.net/npm/vue@3/+esm" });
  src = edit(src, (p) => setImportMapEntry(p, "lit", "https://cdn.jsdelivr.net/npm/lit@3/+esm"));
  assert.deepEqual(Object.keys(readImportMap(parseHtml(src)).map.imports), ["vue", "lit"]);
  assert.deepEqual(setImportMapEntry(parseHtml(src), "lit", "https://cdn.jsdelivr.net/npm/lit@3/+esm"), []);
  src = edit(src, (p) => setImportMapEntry(p, "vue", "./vendor/vue.js"));
  assert.equal(readImportMap(parseHtml(src)).map.imports.vue, "./vendor/vue.js");
  src = edit(src, (p) => setImportMapEntry(p, "vue", null));
  src = edit(src, (p) => setImportMapEntry(p, "lit", null));
  assert.equal(readImportMap(parseHtml(src)), null);
  assert.equal(setImportMapEntry(parseHtml(src), "x", null).length, 0);
  assert.throws(() => setImportMapEntry(parseHtml(page('<script type="importmap">{ nope</script>')), "a", "b"), /not valid JSON/);
  assert.equal(readImportMap(parseHtml(page('<script type="importmap">{ nope</script>'))).valid, false);
  const full = page('<script type="importmap">{"imports":{"a":"./a.js"},"scopes":{"/x/":{"a":"./b.js"}}}</script>');
  const keep = edit(full, (p) => setImportMapEntry(p, "c", "./c.js"));
  assert.ok(keep.includes('"scopes"'));
});

test("import map resolution supports prefixes", () => {
  const imports = { vue: "https://x/vue.js", "three/addons/": "https://x/examples/jsm/", three: "https://x/three.js" };
  assert.equal(resolveWithImportMap(imports, "vue"), "https://x/vue.js");
  assert.equal(resolveWithImportMap(imports, "three/addons/controls/OrbitControls.js"), "https://x/examples/jsm/controls/OrbitControls.js");
  assert.equal(resolveWithImportMap(imports, "nope"), null);
  assert.equal(resolveWithImportMap(null, "x"), null);
  assert.deepEqual(importMapChanges('import { a } from "vue";\nimport "./x.js";\nimport z from "zod";', imports, (t) => t).map((c) => c.insert), ["https://x/vue.js"]);
});

test("add, list, retarget and remove libraries on a page", () => {
  let src = page();
  src = edit(src, (p) => addLibraryToPage(p, { kind: "style", url: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" }));
  src = edit(src, (p) => addLibraryToPage(p, { kind: "script", url: "https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js" }));
  src = edit(src, (p) => addLibraryToPage(p, { kind: "module", specifier: "three", url: "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" }));
  assert.ok(src.includes('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">'));
  assert.ok(src.includes('src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js" defer'));
  assert.deepEqual(addLibraryToPage(parseHtml(src), { kind: "style", url: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" }), []);
  assert.throws(() => addLibraryToPage(parseHtml(src), { kind: "module", url: "x" }), /specifier/);
  const libs = listPageLibraries(parseHtml(src), "index.html");
  assert.deepEqual(libs.map((l) => [l.kind, l.name, l.version]), [["style", "bootstrap", "5.3.3"], ["script", "htmx.org", "2.0.4"], ["importmap", "three", "0.170.0"]]);
  assert.ok(libs.every((l) => !l.vendored));
  const up = edit(src, (p) => retargetLibrary(p, listPageLibraries(p, "index.html")[1], "https://cdn.jsdelivr.net/npm/htmx.org@2.0.5/dist/htmx.min.js"));
  assert.ok(up.includes("htmx.org@2.0.5"));
  const upMap = edit(src, (p) => retargetLibrary(p, listPageLibraries(p, "index.html")[2], "./vendor/three.js"));
  assert.ok(upMap.includes('"three": "./vendor/three.js"'));
  const gone = edit(src, (p) => removeLibraryFromPage(p, listPageLibraries(p, "index.html")[0]));
  assert.ok(!gone.includes("bootstrap"));
  const noMap = edit(src, (p) => removeLibraryFromPage(p, listPageLibraries(p, "index.html")[2]));
  assert.ok(!noMap.includes("importmap"));
  const local = listPageLibraries(parseHtml(page('<script src="vendor/vue@3.5.13/dist/vue.js"></script><script src="js/main.js"></script>')), "index.html");
  assert.equal(local.length, 1);
  assert.deepEqual([local[0].vendored, local[0].name, local[0].version], [true, "vue", "3.5.13"]);
});

test("CDN imports in JavaScript are found", () => {
  const found = listCodeImports('import React from "https://cdn.jsdelivr.net/npm/react@18.3.1/+esm";\nimport "./x.js";\nconst m = await import("https://unpkg.com/lit@3.2.1");', "js/main.js");
  assert.deepEqual(found.map((f) => [f.name, f.version, f.kind]), [["react", "18.3.1", "import"], ["lit", "3.2.1", "import"]]);
});

test("API responses are parsed defensively", () => {
  assert.deepEqual(parseNpmSearch({ objects: [{ package: { name: "vue", version: "3.5.13", description: "d", keywords: ["a"] } }, { nope: 1 }, null] }), [{ name: "vue", version: "3.5.13", description: "d", keywords: ["a"] }]);
  assert.deepEqual(parseNpmSearch(null), []);
  const a = parseJsdelivrPackage({ name: "x", tags: { latest: "1.2.0" }, versions: ["1.0.0", "1.2.0", "1.10.0", "2.0.0-beta.1"] });
  assert.equal(a.latest, "1.2.0");
  assert.deepEqual(a.versions.slice(0, 2), ["2.0.0-beta.1", "1.10.0"]);
  assert.deepEqual(parseJsdelivrPackage({ versions: [{ version: "1.0.0" }, { version: "1.1.0" }] }).versions, ["1.1.0", "1.0.0"]);
  assert.equal(parseJsdelivrPackage({}), null);
  const files = parseJsdelivrFiles({ default: "/dist/a.js", files: [{ name: "/dist/a.js", size: 5 }, { name: "/dist/a.min.js", size: 3 }, { name: "/dist/a.esm.js" }, { name: "/dist/a.js.map" }, { name: "/dist/a.min.css" }, { name: "/src/a.js" }] });
  assert.equal(files.scripts[0].path, "/dist/a.min.js");
  assert.equal(files.modules[0].path, "/dist/a.esm.js");
  assert.equal(files.styles[0].path, "/dist/a.min.css");
  assert.ok(!files.scripts.some((f) => f.path.endsWith(".map") || f.path.startsWith("/src")));
  assert.deepEqual(parseCdnjsSearch({ results: [{ name: "animate.css", version: "4.1.1", description: "x", filename: "animate.min.css" }, {}] }).map((r) => r.name), ["animate.css"]);
  assert.equal(parseCdnjsLibrary({ name: "x", version: "2.0.0", versions: ["1.0.0", "2.0.0"] }).versions[0], "2.0.0");
  assert.equal(parseCdnjsLibrary(null), null);
  assert.ok(npmSearchUrl("a b").includes("text=a%20b"));
  assert.equal(jsdelivrPackageUrl("vue"), "https://data.jsdelivr.com/v1/package/npm/vue");
  assert.ok(cdnjsSearchUrl("x").startsWith("https://api.cdnjs.com/libraries?search=x"));
});

test("vendor paths", () => {
  assert.equal(vendorPathFor("https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.runtime.esm-browser.prod.js"), "vendor/vue@3.5.13/dist/vue.runtime.esm-browser.prod.js");
  assert.equal(vendorPathFor("https://cdn.jsdelivr.net/npm/react@18.3.1/+esm"), "vendor/react@18.3.1/react.esm.js");
  assert.equal(vendorPathFor("https://cdn.jsdelivr.net/npm/react-dom@18.3.1/client/+esm"), "vendor/react-dom@18.3.1/client/react-dom.esm.js");
  assert.equal(vendorPathFor("https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css"), "vendor/animate.css@4.1.1/animate.min.css");
  assert.equal(vendorPathFor("https://other.example/a/b.js?x=1"), "vendor/_ext/other.example/a/b.js");
  assert.equal(vendorPathFor("https://unpkg.com/@scope/pkg@1.0.0/dist/x.js"), "vendor/@scope/pkg@1.0.0/dist/x.js");
  assert.equal(vendoredRef("index.html", "vendor/a/b.js"), "./vendor/a/b.js");
  assert.equal(vendoredRef("pages/x.html", "vendor/a/b.js"), "../vendor/a/b.js");
});

test("vendoring a module graph rewrites imports to relative paths", async () => {
  const web = {
    "https://cdn.jsdelivr.net/npm/lit@3.2.1/+esm": 'import{a as o}from"/npm/lit-html@3.2.1/+esm";export*from"/npm/lit-element@4.1.1/+esm";\n//# sourceMappingURL=lit.map',
    "https://cdn.jsdelivr.net/npm/lit-html@3.2.1/+esm": "export const a=1;",
    "https://cdn.jsdelivr.net/npm/lit-element@4.1.1/+esm": 'import{a}from"/npm/lit-html@3.2.1/+esm";export{a};',
  };
  const calls = [];
  const res = await vendorFromUrl("https://cdn.jsdelivr.net/npm/lit@3.2.1/+esm", async (u) => {
    calls.push(u);
    if (!web[u]) throw new Error("404");
    return new TextEncoder().encode(web[u]);
  });
  assert.equal(res.entry, "vendor/lit@3.2.1/lit.esm.js");
  assert.deepEqual(Object.keys(res.files).sort(), ["vendor/lit-element@4.1.1/lit-element.esm.js", "vendor/lit-html@3.2.1/lit-html.esm.js", "vendor/lit@3.2.1/lit.esm.js"]);
  assert.equal(calls.length, 3, "each file is downloaded once");
  const main = new TextDecoder().decode(res.files[res.entry]);
  assert.ok(main.includes('"../lit-html@3.2.1/lit-html.esm.js"') && main.includes('"../lit-element@4.1.1/lit-element.esm.js"'));
  assert.ok(!main.includes("sourceMappingURL"));
});

test("vendoring a stylesheet downloads fonts and imports", async () => {
  const css = '@import "extra.css";\n@font-face{font-family:x;src:url(../fonts/x.woff2?v=1) format("woff2"),url(data:font/woff;base64,AAAA)}\n.a{background:url("img/bg.png")}';
  const store = {
    "https://cdn.jsdelivr.net/npm/pkg@1.0.0/css/all.css": css,
    "https://cdn.jsdelivr.net/npm/pkg@1.0.0/css/extra.css": ".e{color:red}",
    "https://cdn.jsdelivr.net/npm/pkg@1.0.0/fonts/x.woff2": "FONT",
    "https://cdn.jsdelivr.net/npm/pkg@1.0.0/css/img/bg.png": "PNG",
  };
  const res = await vendorFromUrl("https://cdn.jsdelivr.net/npm/pkg@1.0.0/css/all.css", async (u) => {
    if (!(u in store)) throw new Error("404");
    return new TextEncoder().encode(store[u]);
  });
  assert.deepEqual(Object.keys(res.files).sort(), ["vendor/pkg@1.0.0/css/all.css", "vendor/pkg@1.0.0/css/extra.css", "vendor/pkg@1.0.0/css/img/bg.png", "vendor/pkg@1.0.0/fonts/x.woff2"]);
  const out = new TextDecoder().decode(res.files["vendor/pkg@1.0.0/css/all.css"]);
  assert.ok(out.includes('@import "./extra.css"'));
  assert.ok(out.includes("url(../fonts/x.woff2?v=1)") || out.includes("url(\"../fonts/x.woff2?v=1\")"));
  assert.ok(out.includes("data:font/woff;base64,AAAA"));
  assert.ok(out.includes("./img/bg.png"));
});

test("vendoring honors limits, missing files and host rules", async () => {
  await assert.rejects(() => vendorFromUrl("https://cdn.jsdelivr.net/npm/x@1.0.0/a.js", async () => { throw new Error("offline"); }), /offline/);
  const warn = await vendorFromUrl("https://cdn.jsdelivr.net/npm/x@1.0.0/a.js", async (u) => {
    if (u.endsWith("a.js")) return new TextEncoder().encode('import "./b.js"; import "https://evil.example/c.js";');
    throw new Error("404");
  }, { allowHost: (u) => u.startsWith("https://cdn.jsdelivr.net/") });
  assert.ok(warn.warnings.some((w) => w.includes("b.js")));
  await assert.rejects(() => vendorFromUrl("https://cdn.jsdelivr.net/npm/x@1.0.0/a.js", async () => new Uint8Array(100), { maxBytes: 10 }), /larger than/);
});

test("preview applies the import map (inline import maps are blocked by the desktop CSP)", () => {
  const files = makeFiles({
    "index.html": page('<script type="importmap">{"imports":{"lib":"./vendor/lib.js","cdn":"https://cdn.jsdelivr.net/npm/cdn@1/+esm","pre/":"./vendor/pre/"}}</script>', '<script type="module" src="main.js"></script>\n<script type="module">import { x } from "lib"; window.y = x;</script>'),
    "main.js": 'import { x } from "lib";\nimport c from "cdn";\nimport p from "pre/a.js";\nimport z from "unmapped";\n',
    "vendor/lib.js": "export const x = 1;",
    "vendor/pre/a.js": "export default 2;",
  });
  const res = buildPreview(files, "index.html", { makeScriptUrl: (code) => `data:text/javascript,${encodeURIComponent(code)}`, annotate: false });
  const decoded = decodeURIComponent(res.html);
  assert.ok(!decoded.includes('from "lib"') && !decoded.includes('from "pre/a.js"'), "mapped specifiers are rewritten");
  assert.ok(decoded.includes('from "https://cdn.jsdelivr.net/npm/cdn@1/+esm"'));
  assert.ok(decoded.includes('from "unmapped"'), "unmapped specifiers stay");
  assert.deepEqual(res.diagnostics, []);
  const broken = buildPreview(makeFiles({ "index.html": page('<script type="importmap">{"imports":{"lib":"./nope.js"}}</script>', '<script type="module">import "lib";</script>') }), "index.html", { makeScriptUrl: (c) => `data:,${c}`, annotate: false });
  assert.ok(broken.diagnostics.some((d) => d.code === "preview/missing-file" && /import map/.test(d.message)));
});

test("single-file export works offline with vendored modules and an import map", () => {
  const files = makeFiles({
    "index.html": page('<script type="importmap">{"imports":{"lib":"./vendor/lib.js"}}</script>', '<script type="module" src="main.js"></script>'),
    "main.js": 'import { x } from "lib"; document.title = String(x);',
    "vendor/lib.js": "export const x = 1;",
  });
  const site = buildSite(files, { singleFile: true });
  const html = new TextDecoder().decode(site.files.find((f) => f.path === "index.html").bytes);
  assert.ok(html.includes("data:text/javascript") && !html.includes('from "lib"') && !html.includes('src="main.js"'));
  const normal = buildSite(files);
  assert.deepEqual(normal.warnings, []);
});
