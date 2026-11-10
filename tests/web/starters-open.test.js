import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../../app/vendor/fflate/fflate.js";
import { STARTERS, STARTER_CATEGORIES, loadStarter } from "../../app/src/engine/web/starters.js";
import { TEMPLATES } from "../../app/src/engine/web/templates.js";
import { parseHtml } from "../../app/src/engine/web/html.js";
import { resolveRef, isExternalRef } from "../../app/src/engine/web/paths.js";
import { localRefsOfHtml, planHtmlDrop, projectFromZip } from "../../app/src/engine/web/open-plan.js";
import vm from "node:vm";

test("starter catalog: unique ids, known categories, no clash with the built-in templates", () => {
  const ids = [...TEMPLATES.map((t) => t.id), ...STARTERS.map((s) => s.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(STARTERS.length >= 20);
  for (const s of STARTERS) {
    assert.ok(STARTER_CATEGORIES.includes(s.category), s.id);
    assert.match(s.accent, /^#[0-9a-f]{6}$/);
    assert.ok(s.name && s.description.endsWith("."), s.id);
  }
});

test("every starter loads, every local reference resolves, pages parse cleanly", async () => {
  for (const meta of STARTERS) {
    const t = await loadStarter(meta.id);
    assert.ok(t, meta.id);
    assert.ok(t.files["index.html"], `${meta.id} has index.html`);
    assert.equal(!!t.framework, !!meta.libs, meta.id);
    for (const [path, text] of Object.entries(t.files)) {
      if (/\.html$/.test(path)) {
        const parsed = parseHtml(text);
        assert.deepEqual(parsed.errors.filter((e) => e.severity === "error"), [], `${meta.id}/${path}`);
        for (const ref of localRefsOfHtml(text)) assert.ok(t.files[resolveRef(path, ref).path], `${meta.id}/${path} -> ${ref}`);
        // only the library starters load anything from the network
        const external = [...text.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => isExternalRef(u) && !u.startsWith("https://www.openstreetmap.org"));
        if (!meta.libs) assert.deepEqual(external, [], meta.id);
      }
      if (/\.js$/.test(path)) assert.doesNotThrow(() => new vm.Script(text.replace(/^import .*$/gm, "")), `${meta.id}/${path} has a syntax error`);
      if (/\.webmanifest$/.test(path)) JSON.parse(text);
    }
  }
  assert.equal(await loadStarter("nope"), null);
  const a = await loadStarter("resume");
  a.files["x.txt"] = "changed";
  assert.equal((await loadStarter("resume")).files["x.txt"], undefined);
});

test("local references of a page", () => {
  const html = `<link rel="stylesheet" href="css/site.css"><link rel="canonical" href="https://x.org/"><link rel="icon" href="/favicon.ico">
<script src="js/app.js?v=2"></script><img src="img/a.png" srcset="img/a@2x.png 2x, img/a@3x.png 3x"><a href="about.html">About</a>
<div style="background: url('img/bg.jpg')"></div><img src="data:image/png;base64,AA"><!-- <img src="old.png"> --><img src="https://cdn.x/y.png">`;
  assert.deepEqual(localRefsOfHtml(html).sort(), ["/favicon.ico", "css/site.css", "img/a.png", "img/a@2x.png", "img/a@3x.png", "img/bg.jpg", "js/app.js"].sort());
});

test("dropping a page with its files plans one project with the right folders", () => {
  const entries = [{ path: "index.html" }, { path: "style.css" }, { path: "app.js" }, { path: "notes.txt" }];
  const texts = { "index.html": '<link rel="stylesheet" href="css/style.css"><script src="app.js"></script><img src="img/logo.png">' };
  const plan = planHtmlDrop(entries, texts);
  assert.equal(plan.page, "index.html");
  assert.deepEqual(plan.matched, [{ path: "style.css", target: "css/style.css" }, { path: "app.js", target: "app.js" }]);
  assert.deepEqual(plan.missing, ["img/logo.png"]);
  assert.equal(planHtmlDrop([{ path: "a.html" }], { "a.html": "<p>No assets</p>" }), null);
  assert.deepEqual(planHtmlDrop([{ path: "a.html" }], { "a.html": '<script src="x.js"></script>' }).missing, ["x.js"]);
});

test("zip projects: wrapping folder removed, junk skipped, zip-slip rejected", () => {
  const zip = zipSync({
    "site/index.html": strToU8("<h1>Hi</h1>"),
    "site/css/style.css": strToU8("h1{}"),
    "site/.DS_Store": strToU8("x"),
    "__MACOSX/site/._index.html": strToU8("x"),
    "site/node_modules/a/index.js": strToU8("x"),
  });
  const r = projectFromZip(zip);
  assert.equal(r.name, "site");
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["css/style.css", "index.html"]);
  const evil = zipSync({ "../evil.sh": strToU8("x"), "ok/../../x": strToU8("x"), "/abs.txt": strToU8("x"), "C:/win.txt": strToU8("x"), "good.html": strToU8("<p>"), "a\\b.txt": strToU8("x") });
  const e = projectFromZip(evil);
  assert.deepEqual(e.files.map((f) => f.path), ["good.html"]);
  assert.ok(e.problems.some((p) => /unsafe name/.test(p)));
  const big = projectFromZip(zipSync({ "a.txt": new Uint8Array(2000), "b.txt": new Uint8Array(2000) }), { maxTotalBytes: 3000 });
  assert.equal(big.files.length, 1);
  assert.ok(big.problems.length);
  assert.deepEqual(projectFromZip(strToU8("not a zip")).files, []);
});
