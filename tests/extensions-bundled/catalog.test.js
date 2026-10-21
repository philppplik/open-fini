import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { packAll, catalogText, stage, stripExports, sameContent } from "../../scripts/pack-extensions.mjs";
import { unpackExtension } from "../../app/src/extensions/zip.js";
import { validateManifest, checkPackageFiles, describePermission } from "../../app/src/extensions/manifest.js";
import { checkPermission } from "../../app/src/extensions/permissions.js";
import { fetchCatalog, entryState, installEntry } from "../../app/src/extensions/catalog.js";
import { RpcError } from "../../app/src/extensions/rpc.js";
import { exportForExtension } from "../../app/src/extensions/export-api.js";
import { ExtensionHost } from "../../app/src/extensions/host.js";

const root = join(import.meta.dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dec = new TextDecoder();

/** Minimal permissions each bundled extension may declare. Adding one here is a deliberate, reviewed decision. */
const EXPECTED = {
  "openfini.palette-pro": ["document.read", "document.write", "ui", "files", "storage"],
  "openfini.batch-export": ["document.read", "document.write", "export", "files", "ui"],
  "openfini.data-filler": ["document.read", "document.write", "ui"],
  "openfini.code-tools": ["document.read", "document.write", "ui", "storage"],
  "openfini.a11y-checker": ["document.read", "document.write", "ui", "files", "storage"],
};

test("the committed packages and catalog are up to date (run: npm run ext:pack-all)", async () => {
  const { packages, catalog } = await packAll();
  assert.equal(readFileSync(join(root, "extensions", "catalog.json"), "utf8"), catalogText(catalog));
  for (const [file, bytes] of Object.entries(packages)) {
    assert.ok(existsSync(join(root, "extensions", file)), file);
    assert.ok(sameContent(bytes, readFileSync(join(root, "extensions", file))), `${file} is stale (run: npm run ext:pack-all)`);
  }
  const onDisk = readdirSync(join(root, "extensions", "packages")).map((f) => `packages/${f}`).sort();
  assert.deepEqual(onDisk, Object.keys(packages).sort(), "no orphaned packages");
});

test("five extensions ship, each valid, with minimal declared permissions", async () => {
  const { catalog } = await packAll();
  assert.deepEqual(catalog.extensions.map((e) => e.id).sort(), Object.keys(EXPECTED).sort());
  for (const e of catalog.extensions) {
    assert.deepEqual([...e.permissions].sort(), [...EXPECTED[e.id]].sort(), `${e.id} permissions`);
    assert.ok(e.description.length > 20 && e.studios.length >= 1 && e.version);
    const files = unpackExtension(readFileSync(join(root, "extensions", e.file)));
    const res = validateManifest(JSON.parse(dec.decode(files["openfini-extension.json"])), { hostVersion: pkg.version });
    assert.deepEqual(res.errors, [], e.id);
    assert.deepEqual(checkPackageFiles(res.manifest, Object.keys(files)), [], e.id);
    for (const p of res.manifest.permissions) assert.ok(describePermission(p).text, `${p} is described for the consent dialog`);
  }
});

test("packaged scripts are plain scripts: they parse, have no module syntax and register every declared command", () => {
  for (const dir of readdirSync(join(root, "extensions"), { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith("_") || dir.name === "packages") continue;
    const { files, manifest } = stage(join(root, "extensions", dir.name));
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.endsWith(".js")) continue;
      const code = dec.decode(bytes);
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${dir.name}/${path}` }), `${dir.name}/${path}`);
      assert.ok(!/^\s*(import|export)\s/m.test(code), `${dir.name}/${path} has module syntax`);
    }
    const main = dec.decode(files[manifest.main]);
    for (const c of manifest.contributes.commands) assert.match(main, new RegExp(`register\\(\\s*[\`"']${c.id.replace(/-.*/, "")}`), `${dir.name}: command ${c.id} has a handler`);
    assert.match(main, /async function activate\(openfini\)/);
    assert.match(main, /export const STRINGS|const STRINGS = \{/, `${dir.name} keeps its UI strings in one STRINGS object`);
  }
});

test("stripExports inlines shared code and refuses other imports", () => {
  assert.equal(stripExports('import { a } from "../../_shared/color.js";\nexport const x = 1;\nexport function f() {}\nexport { a };\n').trim(), "const x = 1;\nfunction f() {}");
  assert.throws(() => stripExports('import fs from "node:fs";'), /may only import/);
});

test("every extension has a README and an icon", () => {
  for (const id of ["palette-pro", "batch-export", "data-filler", "code-tools", "a11y-checker"]) {
    assert.ok(existsSync(join(root, "extensions", id, "README.md")), `${id} README`);
    assert.ok(existsSync(join(root, "extensions", id, "icon.svg")), `${id} icon`);
  }
});

test("fetchCatalog, entryState and installEntry", async () => {
  const catalogJson = readFileSync(join(root, "extensions", "catalog.json"));
  const fakeFetch = async (url) => {
    if (url.endsWith("catalog.json")) return new Response(catalogJson);
    const f = join(root, "extensions", url.replace("./extensions/", ""));
    return existsSync(f) ? new Response(readFileSync(f)) : new Response("nope", { status: 404 });
  };
  const list = await fetchCatalog(fakeFetch);
  assert.equal(list.length, 5);
  await assert.rejects(() => fetchCatalog(async () => new Response("x", { status: 404 })), /not part of this build/);
  await assert.rejects(() => fetchCatalog(async () => new Response("{}")), /malformed/);
  await assert.rejects(() => fetchCatalog(async () => { throw new Error("offline"); }), /could not be loaded/);
  const e = { id: "a.b", version: "1.1.0", engines: ">=0.4.0" };
  assert.equal(entryState(e, null, "0.5.0"), "available");
  assert.equal(entryState(e, { manifest: { version: "1.0.0" } }, "0.5.0"), "update");
  assert.equal(entryState(e, { manifest: { version: "1.1.0" } }, "0.5.0"), "installed");
  assert.equal(entryState(e, { manifest: { version: "2.0.0" } }, "0.5.0"), "installed");
  assert.equal(entryState({ ...e, engines: ">=9.0.0" }, null, "0.5.0"), "incompatible");
  const asked = [];
  const host = { install: async (p, ask) => (asked.push(p), ask({ manifest: { name: "x" } }), { id: "ok" }) };
  await installEntry(host, list[0], async (info) => (asked.push(info), true), fakeFetch);
  assert.equal(asked[0].source.type, "bundled");
  assert.ok(asked[0].files["openfini-extension.json"]);
  await assert.rejects(() => installEntry(host, { ...list[0], file: "packages/missing.ofext" }, async () => true, fakeFetch), /not part of this build/);
});

function stubApp() {
  const commands = new Map();
  return {
    prefs: {},
    studio: "vector",
    selection: [],
    safeMode: false,
    commands,
    on() {},
    emit() {},
    toast() {},
    status() {},
    registerCommand: (id, def) => commands.set(id, def),
    run: async () => true,
  };
}

test("a fresh app has zero installed extensions: nothing bundled is installed or enabled by default", async () => {
  const host = new ExtensionHost(stubApp());
  await host.load();
  assert.equal(host.list().length, 0);
  assert.equal([...host.exts.keys()].length, 0);
});

test("installing a bundled extension asks for consent first and lists exactly its permissions", async () => {
  const { catalog } = await packAll();
  for (const e of catalog.extensions) {
    const app = stubApp();
    const host = new ExtensionHost(app);
    await host.load();
    host.hostVersion = pkg.version;
    const files = unpackExtension(readFileSync(join(root, "extensions", e.file)));
    let shown = null;
    const declined = await host.install({ files, source: { type: "bundled", name: e.name } }, async (info) => ((shown = info), false));
    assert.equal(declined, null);
    assert.equal(host.list().length, 0, `${e.id}: declining installs nothing`);
    assert.deepEqual([...shown.manifest.permissions].sort(), [...EXPECTED[e.id]].sort());
    await assert.rejects(() => host.install({ files, source: { type: "bundled" } }), /consent/);
    const done = await host.install({ files, source: { type: "bundled", name: e.name } }, async () => true);
    assert.deepEqual(done, { id: e.id, updated: false });
    assert.equal(host.list().length, 1);
    assert.ok([...app.commands.keys()].every((k) => k.startsWith(`ext:${e.id}:`)));
    assert.ok(app.commands.size >= 3, `${e.id} registered its commands`);
  }
});

test("export permission: the document.export call needs it, and the manifest validator knows it", () => {
  assert.equal(checkPermission(["document.read"], "document.export").code, "PERMISSION_DENIED");
  assert.equal(checkPermission(["export"], "document.export").ok, true);
  const r = validateManifest({ id: "acme.thing", name: "X", version: "1.0.0", engines: { openfini: ">=0.4.0" }, permissions: ["export"] }, { hostVersion: "0.5.0" });
  assert.deepEqual(r.errors, []);
  assert.equal(describePermission("export").risk, "medium");
});

test("document.export validates its arguments before touching the document", async () => {
  const app = { doc: { pages: [], web: null }, page: null };
  await assert.rejects(() => exportForExtension(app, { format: "bmp" }), (e) => e instanceof RpcError && /format/.test(e.message));
  await assert.rejects(() => exportForExtension(app, { scale: 100 }), /scale/);
  await assert.rejects(() => exportForExtension(app, { ids: "x" }), /ids/);
  await assert.rejects(() => exportForExtension({ doc: null }, {}), /No design document/);
  await assert.rejects(() => exportForExtension({ doc: { pages: [], web: {} } }, {}), /website project/);
  await assert.rejects(() => exportForExtension({ doc: { pages: [], find: () => null }, page: null }, { ids: ["nope"] }), /Unknown layer/);
});
