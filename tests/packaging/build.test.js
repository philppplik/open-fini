import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { build } from "../../scripts/build.mjs";
import { buildFixture } from "./_fixture.js";

const exists = (file) => access(file).then(() => true, () => false);

describe("scripts/build.mjs", () => {
  let fx;
  let html;
  let bundleName;
  let bundle;

  before(async () => {
    fx = await buildFixture();
    html = await readFile(join(fx.out, "index.html"), "utf8");
    bundleName = (await readdir(join(fx.out, "assets"))).find((f) => /^main-[A-Z0-9]+\.js$/.test(f));
    bundle = await readFile(join(fx.out, "assets", bundleName), "utf8");
  });
  after(() => fx?.cleanup());

  it("bundles the module entry of index.html into a content-hashed file", () => {
    assert.ok(bundleName, "assets/main-<hash>.js exists");
    assert.match(html, new RegExp(`<script type="module" src="\\./assets/${bundleName}">`));
    assert.ok(!html.includes("src/main.js"));
    assert.ok(bundle.includes("hello"), "shared module is inlined");
  });

  it("keeps Shoelace external and points at the copy in dist/", async () => {
    assert.ok(bundle.includes("../vendor/shoelace/shoelace-autoloader.js"));
    assert.ok(await exists(join(fx.out, "vendor", "shoelace", "shoelace-autoloader.js")));
    // the Shoelace theme stylesheet is linked as is
    assert.match(html, /href="\.\/vendor\/shoelace\/themes\/dark\.css"/);
  });

  it("drops unused Shoelace translations but keeps English", async () => {
    assert.ok(await exists(join(fx.out, "vendor", "shoelace", "translations", "en.js")));
    assert.ok(!(await exists(join(fx.out, "vendor", "shoelace", "translations", "de.js"))));
  });

  it("bundles workers in place and rewrites their URL for the bundle location", async () => {
    assert.ok(bundle.includes("../src/worker.js"), "new URL() now points from assets/ to src/worker.js");
    const worker = await readFile(join(fx.out, "src", "worker.js"), "utf8");
    assert.ok(worker.includes("hello"), "worker bundle contains its dependency");
    assert.ok(!/\bfrom\s*["']\.\/util\.js["']/.test(worker), "worker has no import left");
  });

  it("rewrites the folder of template-literal URLs and allows top-level await", async () => {
    // The source says new URL(`../assets/icons/${name}.svg`, import.meta.url) in src/main.js. The
    // bundle lives in dist/assets/, so the same folder is now reached as "./icons/".
    // other template-literal URLs may exist in the fixture bundle (the order is not guaranteed): pick the icons one
    const match = [...bundle.matchAll(/new URL\(`([^`$]*)\$\{/g)].find((m) => /icons\/$/.test(m[1]));
    assert.ok(match, "template literal kept");
    assert.equal(match[1], "./icons/");
    assert.ok(await exists(join(fx.out, "assets", "icons", "star.svg")));
    assert.match(bundle, /\bawait\b/, "top-level await survived (target ES2022)");
  });

  it("code-splits import() into chunks", async () => {
    const assets = await readdir(join(fx.out, "assets"));
    assert.ok(assets.some((f) => /^chunk-[A-Z0-9]+\.js$/.test(f)), "a chunk exists");
  });

  it("removes sources that now live inside bundles", async () => {
    for (const rel of ["src/main.js", "src/util.js", "src/lazy.js", "vendor/fflate/fflate.js"]) {
      assert.ok(!(await exists(join(fx.out, rel))), `${rel} should not ship`);
    }
    assert.ok(await exists(join(fx.out, "vendor", "fflate", "LICENSE")), "licenses stay");
  });

  it("minifies and hashes the stylesheet, leaving url() references valid", async () => {
    const link = html.match(/<link rel="stylesheet" href="(\.\/styles\/app-[0-9a-f]+\.css)">/);
    assert.ok(link, "stylesheet link rewritten");
    const css = await readFile(join(fx.out, link[1]), "utf8");
    assert.ok(!css.includes("comment"));
    assert.ok(css.includes("../img/bg.png"));
    assert.ok(!(await exists(join(fx.out, "styles", "app.css"))));
  });

  it("injects the version and the precache manifest into sw.js", async () => {
    const sw = await readFile(join(fx.out, "sw.js"), "utf8");
    assert.ok(!sw.includes("@@BUILD_VERSION@@") && !sw.includes("@@PRECACHE_MANIFEST@@"));
    assert.ok(sw.includes(fx.result.version));
    const paths = fx.result.manifest.map(([p]) => p);
    assert.ok(paths.includes("index.html"));
    assert.ok(paths.includes(`assets/${bundleName}`));
    assert.ok(paths.includes("manifest.webmanifest"));
    assert.ok(!paths.includes("sw.js"), "the worker does not precache itself");
    assert.ok(!paths.some((p) => /LICENSE/.test(p)), "license texts are not precached");
    for (const [path, revision] of fx.result.manifest) {
      assert.ok(await exists(join(fx.out, path)), `${path} exists in dist`);
      assert.match(revision, /^[0-9a-f]{12}$/);
    }
  });

  it("writes build-info.json", async () => {
    const info = JSON.parse(await readFile(join(fx.out, "build-info.json"), "utf8"));
    assert.equal(info.buildId, fx.result.version);
    assert.equal(info.precachedFiles, fx.result.manifest.length);
  });

  it("is deterministic for identical input", async () => {
    const again = await buildFixture();
    try {
      // Same sources => same hashes => same version, so users never re-download for nothing.
      assert.deepEqual(again.result.manifest, fx.result.manifest);
      assert.equal(again.result.version, fx.result.version);
    } finally {
      await again.cleanup();
    }
  });

  it("refuses to build into the source folder", async () => {
    await assert.rejects(() => build({ root: fx.app, out: fx.app, quiet: true }), /Refusing/);
    await assert.rejects(() => build({ root: fx.app, out: join(fx.app, "dist"), quiet: true }), /Refusing/);
  });
});
