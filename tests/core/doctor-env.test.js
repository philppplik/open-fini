// App Doctor checks (app/src/core/doctor/env.js): the pure evaluation of a collected status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateEnvironment, checkPrefs, providerUrlOk, ENV_FIXES, doctorReport } from "../../app/src/core/doctor/index.js";

const by = (list, code) => list.filter((f) => f.code === code);
const healthy = {
  storage: { usage: 10 * 1048576, quota: 1000 * 1048576, persisted: true, persistSupported: true },
  idb: { ok: true, keys: 12, unreadable: [] },
  recovery: { present: true, docs: 2, damaged: 0, recents: 3, recentsMissing: 0 },
  sw: { supported: true, registered: true, controlled: true, caches: ["openfini-1.1.1"], current: "openfini-1.1.1", desktop: false },
  features: { webgl: true, webgl2: true, webgpu: true, webcodecs: true, offscreen: true, workers: true, localFonts: true },
  fonts: { user: 1, failed: 0 },
  workers: { ok: true, ms: 12 },
  extensions: { total: 2, failed: [], hung: [] },
  engines: { total: 5, kinds: {} },
  ai: { enabled: true, offline: false, locked: false, activeMissing: false, providers: [{ label: "Local", local: true, hasKey: false, needsKey: false, urlOk: true, reachable: true }] },
  prefs: { ok: true, parseError: false, invalid: [] },
};

test("a healthy setup has no errors or warnings", () => {
  const f = evaluateEnvironment(healthy);
  assert.equal(f.filter((x) => x.severity === "error" || x.severity === "warning").length, 0, JSON.stringify(f.filter((x) => x.severity !== "ok" && x.severity !== "info")));
  assert.ok(f.every((x) => x.message && x.area));
});

test("problems map to findings with the right fixes", () => {
  const s = structuredClone(healthy);
  s.storage = { usage: 95, quota: 100, persisted: false, persistSupported: true };
  s.idb = { ok: true, keys: 3, unreadable: ["x"] };
  s.recovery.damaged = 1;
  s.sw = { supported: true, registered: false, caches: [], desktop: false };
  s.features.webgl = s.features.webgl2 = false;
  s.workers = { ok: false, error: "timeout" };
  s.extensions = { total: 1, failed: ["Broken"], hung: [] };
  s.ai = { enabled: true, activeMissing: true, providers: [{ label: "Cloud", needsKey: true, hasKey: false, urlOk: true }, { label: "Bad", urlOk: false }] };
  s.prefs = { ok: false, parseError: true, invalid: [] };
  const f = evaluateEnvironment(s);
  assert.equal(by(f, "quota")[0].severity, "error");
  assert.equal(by(f, "persist")[0].fix.id, "persist-storage");
  assert.equal(by(f, "idb")[0].fix.id, "rebuild-recovery");
  assert.equal(by(f, "recovery")[0].fix.id, "rebuild-recovery");
  assert.equal(by(f, "sw")[0].fix.id, "reregister-sw");
  assert.equal(by(f, "webgl")[0].severity, "warning");
  assert.equal(by(f, "workers")[0].severity, "error");
  assert.equal(by(f, "extensions")[0].fix.id, "restart-extensions");
  assert.equal(by(f, "ai-active").length, 1);
  assert.equal(by(f, "ai-key").length, 1);
  assert.equal(by(f, "ai-url").length, 1);
  assert.equal(by(f, "prefs")[0].fix.id, "reset-prefs");
  // errors first
  assert.equal(f[0].severity, "error");
  for (const x of f) if (x.fix) assert.equal(ENV_FIXES[x.fix.id].safe, x.fix.safe);
});

test("stale caches, the desktop app and safe mode", () => {
  const s = structuredClone(healthy);
  s.sw.caches = ["openfini-1.0.0", "openfini-1.1.1", "ofshare-v1"];
  assert.equal(by(evaluateEnvironment(s), "caches")[0].params.n, 1);
  const d = structuredClone(healthy);
  d.sw = { supported: true, desktop: true };
  d.storage.persisted = false;
  const f = evaluateEnvironment({ ...d, extensions: null, safeMode: true });
  assert.equal(by(f, "sw")[0].severity, "ok");
  assert.equal(by(f, "persist").length, 0, "the desktop web view keeps its data");
  assert.equal(by(f, "extensions")[0].severity, "info");
  assert.equal(by(f, "safe").length, 1);
  assert.equal(by(f, "cache-reset").length, 0);
});

test("preferences are checked against the defaults' types", () => {
  const defaults = { theme: "dark", zoom: 1, autosave: true, recent: [] };
  assert.deepEqual(checkPrefs(null, defaults), { ok: true, parseError: false, invalid: [] });
  assert.equal(checkPrefs("{bad", defaults).parseError, true);
  assert.equal(checkPrefs("[1]", defaults).parseError, true);
  assert.deepEqual(checkPrefs(JSON.stringify({ theme: 3, zoom: "big", autosave: false, recent: {} }), defaults).invalid, ["theme", "zoom", "recent"]);
  assert.equal(checkPrefs(JSON.stringify({ theme: "light", extra: 1 }), defaults).ok, true);
});

test("AI provider addresses: https or this device only, no credentials", () => {
  assert.equal(providerUrlOk(""), true);
  assert.equal(providerUrlOk("https://api.example.com/v1"), true);
  assert.equal(providerUrlOk("http://localhost:11434"), true);
  assert.equal(providerUrlOk("http://127.0.0.1:1234/v1"), true);
  assert.equal(providerUrlOk("http://example.com"), false);
  assert.equal(providerUrlOk("https://user:pw@example.com"), false);
  assert.equal(providerUrlOk("not a url"), false);
});

test("the report hides names unless asked and never includes keys", () => {
  const env = evaluateEnvironment({ ...healthy, ai: { enabled: true, providers: [{ label: "My Secret Server", needsKey: true, hasKey: false, urlOk: true }] } });
  const text = doctorReport({ app: { version: "9", platform: "web" }, env });
  assert.ok(text.includes("OpenFini Doctor 9"));
  assert.ok(text.includes("My Secret Server"), "provider labels are part of the app section (they are not document data)");
  const doc = { counts: { error: 1, warning: 0, info: 0 }, findings: [{ code: "dangling-asset", severity: "error", message: "The image layer {layer} refers to a picture that is not in the file.", params: { layer: "“Holiday photo”" } }] };
  assert.ok(!doctorReport({ env: [], doc }).includes("Holiday"));
  assert.ok(doctorReport({ env: [], doc, names: true }).includes("Holiday"));
});
