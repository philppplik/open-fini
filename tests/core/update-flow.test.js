import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateFlow, updatePolicy, classifyError } from "../../app/src/core/update-flow.js";

const fakeUpdate = (over = {}) => ({
  version: "2.0.0",
  date: "2026-01-01",
  body: "Notes",
  async download(cb) {
    cb({ event: "Started", data: { contentLength: 100 } });
    cb({ event: "Progress", data: { chunkLength: 40 } });
    cb({ event: "Progress", data: { chunkLength: 60 } });
    cb({ event: "Finished" });
  },
  async install() {
    this.installed = true;
  },
  ...over,
});
const mk = (native, extra = {}) => createUpdateFlow({ native: { installKind: async () => "app", relaunch: async () => {}, ...native }, current: "1.0.0", policy: "notify", ...extra });

test("policy from prefs: off, notify, auto", () => {
  assert.equal(updatePolicy({}), "off");
  assert.equal(updatePolicy({ auto: true }), "notify");
  assert.equal(updatePolicy({ auto: true, autoDownload: true }), "auto");
});

test("no update", async () => {
  const f = mk({ check: async () => null });
  assert.equal((await f.check()).phase, "current");
});

test("update available, progress, ready; install saves work first, then restarts", async () => {
  const order = [];
  const u = fakeUpdate({
    async install() {
      order.push("install");
    },
  });
  const f = mk({ check: async () => u, relaunch: async () => order.push("relaunch") }, { saveWork: async () => order.push("save") });
  const seen = [];
  f.subscribe((s) => s.phase === "downloading" && seen.push(`${s.downloaded}/${s.total}`));
  assert.deepEqual([(await f.check()).phase, f.state.version, f.state.notes], ["available", "2.0.0", "Notes"]);
  assert.equal((await f.install()).phase, "available", "install before download does nothing");
  assert.equal((await f.download()).phase, "ready");
  assert.deepEqual(seen, ["0/0", "0/100", "40/100", "100/100", "100/100"]);
  await f.install();
  assert.deepEqual(order, ["save", "install", "relaunch"]);
});

test("signature error is reported and nothing is installed", async () => {
  const u = fakeUpdate({
    async download() {
      throw new Error("signature verification failed");
    },
  });
  const f = mk({ check: async () => u });
  await f.check();
  const s = await f.download();
  assert.deepEqual([s.phase, s.error.kind], ["error", "signature"]);
  assert.equal((await f.install()).phase, "error");
  assert.ok(!u.installed);
});

test("offline: blocked by offline mode, and a network failure", async () => {
  const f = mk(
    { check: async () => null },
    {
      canCheck: () => {
        throw new Error("Offline mode is on");
      },
    },
  );
  assert.equal((await f.check()).phase, "blocked");
  const g = mk({
    check: async () => {
      throw new Error("error sending request for url");
    },
  });
  const s = await g.check();
  assert.deepEqual([s.phase, s.error.kind], ["error", "offline"]);
});

test("unsupported install types (package manager, portable) are manual updates", async () => {
  let called = false;
  const f = mk({ installKind: async () => "package", check: async () => (called = true) });
  assert.deepEqual([(await f.check()).phase, f.state.reason, called], ["manual", "package", false]);
  const g = mk({ installKind: async () => "portable", check: async () => null });
  assert.equal((await g.check()).reason, "portable");
});

test("plugin missing or not configured falls back to the release page without an error", async () => {
  const f = mk({
    check: async () => {
      throw new Error("plugin updater not found");
    },
  });
  assert.deepEqual([(await f.check()).phase, f.state.reason], ["manual", "unconfigured"]);
});

test("web build has no native updater", async () => {
  assert.equal((await createUpdateFlow({ native: null }).check()).phase, "web");
});

test("classifyError", () => {
  assert.equal(classifyError(new Error("boom")), "failed");
  assert.equal(classifyError("Network unreachable"), "offline");
});
