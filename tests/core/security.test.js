import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { evaluateSecurity, securityCounts } from "../../app/src/core/security.js";
import { parseManifest, verifyFiles, shortHash, integritySummary } from "../../app/src/core/integrity.js";

const byId = (checks, id) => checks.find((c) => c.id === id);

test("security check: a fresh install is quiet and honest", () => {
  const c = evaluateSecurity({ ai: { enabled: false, providers: [] }, extensions: [], network: { offline: false }, csp: { desktop: true }, storage: { appLock: false } });
  assert.equal(byId(c, "ai").level, "ok");
  assert.equal(byId(c, "keys").level, "ok");
  assert.equal(byId(c, "extensions").level, "ok");
  assert.equal(byId(c, "csp").level, "ok");
  assert.equal(byId(c, "lock").level, "info");
  assert.equal(byId(c, "lock").action, "enable-lock");
  assert.equal(securityCounts(c).warn, 0);
});

test("security check: plain API keys are a warning with a fix, encryption clears it", () => {
  const base = { ai: { enabled: true, providers: [{ id: "p", label: "OpenAI", hasKey: true }], keysEncrypted: false }, storage: {} };
  const plain = evaluateSecurity(base);
  assert.equal(byId(plain, "keys").level, "warn");
  assert.equal(byId(plain, "keys").action, "set-passphrase");
  assert.equal(byId(plain, "ai").level, "warn");
  assert.match(byId(plain, "ai").detail, /OpenAI/);
  assert.equal(byId(evaluateSecurity({ ...base, ai: { ...base.ai, keysEncrypted: true } }), "keys").level, "ok");
  assert.equal(byId(evaluateSecurity({ ...base, storage: { appLock: true } }), "keys").level, "ok");
  assert.equal(byId(evaluateSecurity({ ...base, ai: { ...base.ai, keysLocked: true } }), "keys").level, "ok");
});

test("security check: local providers are not reported as leaving the device", () => {
  const c = evaluateSecurity({ ai: { enabled: true, providers: [{ id: "o", label: "Ollama", local: true, hasKey: false }] } });
  assert.equal(byId(c, "ai").level, "info");
  assert.match(byId(c, "ai").detail, /on this device/);
});

test("security check: extensions with network or file permissions warn", () => {
  const c = evaluateSecurity({ extensions: [{ id: "a.b", name: "Quiet", enabled: true, permissions: ["ui"] }, { id: "c.d", name: "Chatty", enabled: true, permissions: ["net:https://api.example.com"] }, { id: "e.f", name: "Off", enabled: false, permissions: ["files"] }] });
  assert.equal(byId(c, "extensions").level, "warn");
  assert.match(byId(c, "extensions").detail, /Chatty/);
  assert.ok(!/Off|Quiet/.test(byId(c, "extensions").detail));
  assert.match(byId(c, "extensions").label, /2 of 3/);
  const calm = evaluateSecurity({ extensions: [{ id: "a.b", name: "Quiet", enabled: true, permissions: ["ui", "storage"] }] });
  assert.equal(byId(calm, "extensions").level, "info");
});

test("security check: offline mode, safe mode, protected mode, csp variants", () => {
  assert.equal(byId(evaluateSecurity({ network: { offline: true } }), "offline").level, "ok");
  assert.equal(byId(evaluateSecurity({ network: { offline: false } }), "network").action, "offline");
  assert.equal(byId(evaluateSecurity({ safeMode: true }), "safe").level, "info");
  assert.equal(byId(evaluateSecurity({ protectedMode: true }), "protected").level, "ok");
  assert.equal(byId(evaluateSecurity({ protectedMode: false }), "protected").level, "info");
  assert.equal(byId(evaluateSecurity({ csp: { header: "default-src 'self'" } }), "csp").level, "ok");
  assert.match(byId(evaluateSecurity({ csp: { header: null } }), "csp").label, /No Content-Security-Policy/);
  assert.match(byId(evaluateSecurity({ csp: {} }), "csp").label, /could not be checked/);
  assert.ok(byId(evaluateSecurity({}), "sandbox"));
  assert.equal(byId(evaluateSecurity({ previewScripts: false }), "scripts").level, "ok");
});

const MANIFEST = [["index.html", "aaaaaaaaaaaa"], ["assets/app.js", "bbbbbbbbbbbb"], ["vendor/x.js", "cccccccccccc"]];

test("integrity: manifest is parsed from minified and pretty sw.js, dev worker gives null", () => {
  const minified = `const e="x",t=${JSON.stringify(MANIFEST)},n=1;self.addEventListener("install",()=>{})`;
  assert.deepEqual(parseManifest(minified), MANIFEST);
  assert.deepEqual(parseManifest(`const PRECACHE = /*@@PRECACHE_MANIFEST@@*/ ${JSON.stringify(MANIFEST, null, 2)};`), MANIFEST);
  assert.equal(parseManifest("const PRECACHE = /*@@PRECACHE_MANIFEST@@*/ [];"), null);
  assert.equal(parseManifest(""), null);
});

test("integrity: shortHash matches the build script's 12 hex chars", async () => {
  const h = await shortHash(new TextEncoder().encode("hello"), webcrypto.subtle);
  assert.equal(h, "2cf24dba5fb0");
});

test("integrity: verifyFiles reports matching, differing and unreadable files and honors the filter", async () => {
  const files = { "index.html": "A", "assets/app.js": "B", "vendor/x.js": "C" };
  const hash = async (b) => ({ A: "aaaaaaaaaaaa", B: "zzzzzzzzzzzz" })[new TextDecoder().decode(b)] || "unknown";
  const fetchBytes = async (p) => {
    if (p === "vendor/x.js") throw new Error("404");
    return new TextEncoder().encode(files[p]);
  };
  const progress = [];
  const r = await verifyFiles({ manifest: MANIFEST, fetchBytes, hash, onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual({ ok: r.ok, checked: r.checked, mismatched: r.mismatched, missing: r.missing }, { ok: 1, checked: 2, mismatched: ["assets/app.js"], missing: ["vendor/x.js"] });
  assert.deepEqual(progress.at(-1), [3, 3]);
  const quick = await verifyFiles({ manifest: MANIFEST, fetchBytes, hash, filter: (p) => !p.startsWith("vendor/") });
  assert.equal(quick.skipped, 1);
  assert.equal(quick.missing.length, 0);
  assert.match(integritySummary(r), /1 file differ|1 file differs|1 file differ/);
  assert.match(integritySummary({ ...r, mismatched: [], missing: [] }), /All 1 checked files match/);
  const cancelled = await verifyFiles({ manifest: MANIFEST, fetchBytes, hash, signal: { aborted: true } });
  assert.equal(cancelled.aborted, true);
  assert.equal(integritySummary(cancelled), "The check was cancelled.");
});

import { scriptsBlocked, blockedByProtection, markUntrusted } from "../../app/src/core/security.js";

test("protected mode: scripts of untrusted website projects stay off until enabled", () => {
  const on = { previewScripts: true, protectedMode: true };
  assert.equal(scriptsBlocked(on, { untrusted: true }), true);
  assert.equal(blockedByProtection(on, { untrusted: true }), true);
  assert.equal(scriptsBlocked(on, { untrusted: true, scriptsOk: true }), false);
  assert.equal(scriptsBlocked(on, {}), false, "projects made in OpenFini are trusted");
  assert.equal(scriptsBlocked(on, null), false);
  assert.equal(scriptsBlocked({ previewScripts: true, protectedMode: false }, { untrusted: true }), false);
  assert.equal(scriptsBlocked({ previewScripts: false, protectedMode: false }, {}), true, "the existing preference still wins");
  assert.equal(blockedByProtection({ previewScripts: false, protectedMode: true }, { untrusted: true }), false);
});

test("markUntrusted flags only website projects and only in protected mode", () => {
  assert.equal(markUntrusted({ protectedMode: true }, { web: {} }).untrusted, true);
  assert.equal(markUntrusted({ protectedMode: true }, { pages: [] }).untrusted, undefined);
  assert.equal(markUntrusted({ protectedMode: false }, { web: {} }).untrusted, undefined);
});
