import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogStore, pruneIndex, summarizeSessions, filterEntries, INDEX_KEY } from "../../app/src/core/log-store.js";

const DAY = 86400000;
const fake = () => {
  const m = new Map();
  return { m, get: async (k) => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)), delete: async (k) => void m.delete(k) };
};
const entry = (t, o = {}) => ({ t, last: t, level: "info", scope: "app", msg: "hello", count: 1, ...o });

test("append + flush persists entries with session and build; sessions() counts them", async () => {
  const storage = fake();
  const s = createLogStore({ storage, session: "s1", build: "0.9.0", now: () => 1000 });
  s.append(entry(1000));
  s.append(entry(1001, { msg: "two" }));
  await s.flush();
  const sessions = await s.sessions();
  assert.equal(sessions.length, 1);
  assert.deepEqual([sessions[0].session, sessions[0].count, sessions[0].build], ["s1", 2, "0.9.0"]);
  const all = await s.load("all");
  assert.equal(all.length, 2);
  assert.equal(all[0].session, "s1");
});

test("a merged entry (same object, higher count) is rewritten, not duplicated", async () => {
  const storage = fake();
  const s = createLogStore({ storage, session: "s1", now: () => 5 });
  const e = entry(5);
  s.append(e);
  await s.flush();
  e.count = 4;
  s.append(e);
  await s.flush();
  const all = await s.load("s1");
  assert.equal(all.length, 1);
  assert.equal(all[0].count, 4);
});

test("segments rotate at segmentSize and keep one session each", async () => {
  const storage = fake();
  const s = createLogStore({ storage, session: "s1", segmentSize: 3, now: () => 100 });
  for (let i = 0; i < 7; i++) s.append(entry(100 + i, { msg: `m${i}` }));
  await s.flush();
  assert.deepEqual(storage.m.get(INDEX_KEY).map((r) => r.count), [3, 3, 1]);
  assert.equal((await s.load("s1")).length, 7);
});

test("retention 0 persists nothing", async () => {
  const storage = fake();
  const s = createLogStore({ storage, session: "s1", retentionDays: 0 });
  s.append(entry(1));
  await s.flush();
  assert.equal(storage.m.size, 0);
});

test("pruneIndex drops old segments, then oldest beyond the entry and byte caps; keeps the open one", () => {
  const now = 100 * DAY;
  const idx = [
    { key: "a", session: "x", t0: 1 * DAY, t1: 1 * DAY, count: 10, bytes: 100 },
    { key: "b", session: "y", t0: 95 * DAY, t1: 96 * DAY, count: 10, bytes: 100 },
    { key: "c", session: "z", t0: 99 * DAY, t1: 99 * DAY, count: 10, bytes: 100 },
  ];
  assert.deepEqual(pruneIndex(idx, { now, retentionDays: 14 }).drop.map((r) => r.key), ["a"]);
  assert.deepEqual(pruneIndex(idx, { now, retentionDays: 365, maxEntries: 15 }).drop.map((x) => x.key), ["a", "b"]);
  assert.deepEqual(pruneIndex(idx, { now, retentionDays: 365, maxBytes: 150, keepKeys: ["a"] }).keep.map((x) => x.key), ["a"]);
});

test("old sessions are pruned on flush and a new session survives", async () => {
  const storage = fake();
  let now = 0;
  const old = createLogStore({ storage, session: "old", now: () => now });
  old.append(entry(0));
  await old.flush();
  now = 30 * DAY;
  const cur = createLogStore({ storage, session: "new", now: () => now, retentionDays: 14 });
  cur.append(entry(30 * DAY));
  await cur.flush();
  assert.deepEqual((await cur.sessions()).map((x) => x.session), ["new"]);
  assert.equal([...storage.m.keys()].filter((k) => k.startsWith("diag.seg.")).length, 1);
});

test("redaction is applied again on the way in", async () => {
  const storage = fake();
  const s = createLogStore({ storage, session: "s", now: () => 1 });
  s.append(entry(1, { msg: "key sk-proj-ABCDEFGH12345678abcd used" }));
  await s.flush();
  assert.ok(!JSON.stringify([...storage.m.values()]).includes("ABCDEFGH12345678abcd"));
});

test("clear removes everything; storage failures do not throw", async () => {
  const storage = fake();
  const s = createLogStore({ storage, session: "s", now: () => 1 });
  s.append(entry(1));
  await s.flush();
  await s.clear();
  assert.equal(storage.m.size, 0);
  const boom = async () => {
    throw new Error("x");
  };
  const bad = createLogStore({ storage: { get: boom, set: boom, delete: async () => {} }, session: "s" });
  bad.append(entry(1));
  await bad.flush();
});

test("summarizeSessions and filterEntries", () => {
  const sum = summarizeSessions([
    { key: "a", session: "x", build: "1", t0: 1, t1: 2, count: 3, bytes: 1 },
    { key: "b", session: "x", build: "1", t0: 3, t1: 4, count: 2, bytes: 1 },
    { key: "c", session: "y", build: "1", t0: 9, t1: 9, count: 1, bytes: 1 },
  ]);
  assert.deepEqual(sum.map((s) => [s.session, s.count, s.segments]), [["y", 1, 1], ["x", 5, 2]]);
  const es = [entry(1, { level: "warn", scope: "net", msg: "Offline" }), entry(2, { msg: "ok" })];
  assert.equal(filterEntries(es, { level: "warn" }).length, 1);
  assert.equal(filterEntries(es, { scope: "app", search: "OK" }).length, 1);
});
