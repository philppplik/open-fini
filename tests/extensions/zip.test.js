import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "../../app/vendor/fflate/fflate.js";
import { unpackExtension, packExtension, safePath, readManifest, PACK_LIMITS } from "../../app/src/extensions/zip.js";
import { packFolder, zipStore, crc32 } from "../../sdk/pack.mjs";

const enc = (s) => new TextEncoder().encode(s);
const MANIFEST = JSON.stringify({ id: "acme.zip-test", name: "Zip", version: "1.0.0", engines: { openfini: ">=0.3.0" } });

test("pack and unpack round-trip, manifest first", () => {
  const bytes = packExtension({ "main.js": "console.log(1)", "openfini-extension.json": MANIFEST, "panels/a.html": "<p>hi</p>" });
  const files = unpackExtension(bytes);
  assert.deepEqual(Object.keys(files).sort(), ["main.js", "openfini-extension.json", "panels/a.html"]);
  assert.equal(new TextDecoder().decode(files["main.js"]), "console.log(1)");
  assert.equal(readManifest(files).id, "acme.zip-test");
});

test("a single wrapper folder is stripped", () => {
  const files = unpackExtension(zipSync({ "my-ext/openfini-extension.json": enc(MANIFEST), "my-ext/main.js": enc("x"), "__MACOSX/._junk": enc("j") }));
  assert.deepEqual(Object.keys(files).sort(), ["main.js", "openfini-extension.json"]);
});

test("unsafe paths are rejected", () => {
  for (const name of ["../evil.js", "/abs.js", "a/../../b.js", "C:/x.js"]) {
    assert.throws(() => unpackExtension(zipSync({ "openfini-extension.json": enc(MANIFEST), [name]: enc("x") })), /unsafe path/, name);
  }
  assert.equal(safePath("a\\b/./c.js"), "a/b/c.js");
  assert.equal(safePath("../x"), null);
  assert.equal(safePath(""), null);
});

test("zip bombs and huge packages are refused before inflating", () => {
  const big = zipSync({ "openfini-extension.json": enc(MANIFEST), "blob.bin": new Uint8Array(PACK_LIMITS.maxFileBytes + 1) });
  assert.ok(big.length < 100_000, "highly compressible");
  assert.throws(() => unpackExtension(big), /larger than/);
  const many = {};
  for (let i = 0; i < 12; i++) many[`f${i}.txt`] = enc("x");
  many["openfini-extension.json"] = enc(MANIFEST);
  assert.throws(() => unpackExtension(zipSync(many), { ...PACK_LIMITS, maxFiles: 10 }), /more than 10 files/);
  assert.throws(() => unpackExtension(zipSync({ "a.bin": new Uint8Array(3000) }), { ...PACK_LIMITS, maxTotalBytes: 2000 }), /larger than/);
});

test("errors for non-zips and missing manifests are readable", () => {
  assert.throws(() => unpackExtension(enc("not a zip")), /not a valid \.ofext/);
  assert.throws(() => unpackExtension(zipSync({ "main.js": enc("x") })), /no openfini-extension\.json/);
  assert.throws(() => readManifest({ "openfini-extension.json": enc("{oops") }), /not valid JSON/);
});

test("the SDK's store-only writer produces archives the app can read", () => {
  assert.equal(crc32(enc("123456789")), 0xcbf43926);
  const files = unpackExtension(zipStore({ "openfini-extension.json": enc(MANIFEST), "dir/main.js": enc("hello") }));
  assert.equal(new TextDecoder().decode(files["dir/main.js"]), "hello");
});

test("sdk/pack.mjs packs a folder and the result unpacks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ofext-"));
  try {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "openfini-extension.json"), MANIFEST);
    writeFileSync(join(dir, "main.js"), "// code");
    writeFileSync(join(dir, "sub", "a.txt"), "a");
    writeFileSync(join(dir, "old.ofext"), "skip me");
    const { bytes, manifest, count } = await packFolder(dir);
    assert.equal(manifest.version, "1.0.0");
    assert.equal(count, 3);
    assert.deepEqual(Object.keys(unpackExtension(bytes)).sort(), ["main.js", "openfini-extension.json", "sub/a.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
