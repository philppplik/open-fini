import test from "node:test";
import assert from "node:assert/strict";
import { newThread, applyCommentOp, normalizeThreads, filterThreads, threadTitle, threadCounts } from "../../app/src/collab/comments.js";
import { planAdd, createVersionStore } from "../../app/src/collab/versions.js";
import { checkFile, chunkCount, sliceChunk, Assembler } from "../../app/src/collab/files.js";
import { createThrottle, TokenBucket, followTarget, samePresence } from "../../app/src/collab/presence.js";
import { sha256B64u } from "../../app/src/collab/crypto.js";
import { LIMITS } from "../../app/src/collab/protocol.js";

const A = { id: "A".repeat(22), nick: "Ann", color: "#ff0000" };
const B = { id: "B".repeat(22), nick: "Ben", color: "#00ff00" };

test("comments: add, reply, edit/delete by author only, resolve and reopen, drop", () => {
  const threads = [];
  const t = newThread({ id: "t1", anchor: { kind: "node", node: "n1", page: "p1" }, author: A, text: "Make this bigger", ts: 10 });
  assert.equal(applyCommentOp(threads, { op: "add", thread: t }, { sender: A.id }), true);
  assert.equal(applyCommentOp(threads, { op: "add", thread: t }, { sender: A.id }), false, "idempotent");
  assert.equal(applyCommentOp([], { op: "add", thread: t }, { sender: B.id }), false, "cannot add a thread in someone else's name");
  const reply = { id: "r1", author: B.id, nick: "Ben", color: "#00ff00", text: "Done", ts: 20 };
  assert.equal(applyCommentOp(threads, { op: "reply", threadId: "t1", msg: reply }, { sender: A.id }), false, "reply must come from its author");
  assert.equal(applyCommentOp(threads, { op: "reply", threadId: "t1", msg: reply }, { sender: B.id }), true);
  assert.equal(applyCommentOp(threads, { op: "edit", threadId: "t1", msgId: "r1", text: "x" }, { sender: A.id }), false);
  assert.equal(applyCommentOp(threads, { op: "edit", threadId: "t1", msgId: "r1", text: "Done!" }, { sender: B.id }), true);
  assert.equal(applyCommentOp(threads, { op: "resolve", threadId: "t1", text: "Ann" }, { sender: A.id }), true);
  assert.equal(threads[0].resolved, true);
  assert.equal(threads[0].resolvedBy, "Ann");
  assert.deepEqual(threadCounts(threads), { open: 0, resolved: 1, all: 1 });
  // a reply reopens
  applyCommentOp(threads, { op: "reply", threadId: "t1", msg: { ...reply, id: "r2" } }, { sender: B.id });
  assert.equal(threads[0].resolved, false);
  assert.equal(applyCommentOp(threads, { op: "delete", threadId: "t1", msgId: "r2" }, { sender: B.id }), true);
  assert.equal(threads[0].messages[2].deleted, true);
  assert.equal(threadTitle(threads[0]), "Make this bigger");
  assert.equal(applyCommentOp(threads, { op: "drop", threadId: "t1" }, { sender: B.id }), false, "only author or host drops");
  assert.equal(applyCommentOp(threads, { op: "drop", threadId: "t1" }, { sender: B.id, isHost: true }), true);
  assert.equal(threads.length, 0);
});

test("comments: filters and normalization of stored threads", () => {
  const t1 = newThread({ id: "t1", anchor: { kind: "page", page: "p1" }, author: A, text: "one", ts: 1 });
  const t2 = newThread({ id: "t2", anchor: { kind: "line", path: "index.html", line: 4 }, author: B, text: "two @Ann", ts: 2, mentions: [A.id] });
  t2.resolved = true;
  const all = [t1, t2];
  assert.deepEqual(filterThreads(all, { status: "open" }).map((t) => t.id), ["t1"]);
  assert.deepEqual(filterThreads(all, { status: "resolved" }).map((t) => t.id), ["t2"]);
  assert.deepEqual(filterThreads(all, { status: "all", mine: A.id }).map((t) => t.id), ["t2", "t1"], "mine includes mentions");
  assert.deepEqual(filterThreads(all, { status: "all", anchorKind: "line" }).map((t) => t.id), ["t2"]);
  const loaded = normalizeThreads([t1, t1, { id: "evil", anchor: { kind: "script" } }, "x", { ...t2, extra: 1 }, t2]);
  assert.deepEqual(loaded.map((t) => t.id), ["t1", "t2"]);
  assert.deepEqual(normalizeThreads("nope"), []);
});

test("versions: pruning keeps named versions longer than automatic ones", () => {
  const idx = [
    { id: "a", docId: "d", ts: 1, bytes: 10, auto: false },
    { id: "b", docId: "d", ts: 2, bytes: 10, auto: true },
    { id: "c", docId: "d", ts: 3, bytes: 10, auto: false },
  ];
  const r = planAdd(idx, { id: "n", docId: "d", ts: 4, bytes: 10, auto: false }, { maxPerDoc: 3, maxBytes: 1000 });
  assert.deepEqual(r.evict, ["b"]);
  const r2 = planAdd(idx, { id: "n", docId: "x", ts: 4, bytes: 25, auto: false }, { maxPerDoc: 30, maxBytes: 40 });
  assert.deepEqual(r2.evict, ["b", "a"]);
  assert.ok(r2.index.some((v) => v.id === "n"));
});

test("versions: store on an injected kv", async () => {
  const kv = new Map();
  let n = 0;
  const store = createVersionStore({ get: async (k) => kv.get(k), set: async (k, v) => kv.set(k, v), del: async (k) => kv.delete(k) }, { now: () => ++n, newId: () => `v${n + 1}`, limits: { maxPerDoc: 2, maxBytes: 1e9 } });
  const v1 = await store.add({ docId: "d", docName: "Poster", name: "First", bytes: new Uint8Array([1, 2, 3]), thumb: new Uint8Array([9]) });
  await store.add({ docId: "d", docName: "Poster", auto: true, bytes: new Uint8Array([4]) });
  await store.add({ docId: "d", docName: "Poster", name: "Third", bytes: new Uint8Array([5]) });
  const list = await store.list("d");
  assert.deepEqual(list.map((v) => v.name), ["Third", "First"], "the automatic one was pruned first");
  assert.deepEqual([...(await store.bytes(v1.id))], [1, 2, 3]);
  assert.deepEqual([...(await store.thumb(v1.id))], [9]);
  assert.equal(await store.rename(v1.id, "Renamed", "note"), true);
  assert.equal((await store.get(v1.id)).name, "Renamed");
  assert.equal(await store.remove(v1.id), true);
  assert.equal(await store.bytes(v1.id), null);
  await assert.rejects(store.add({ docId: "d", bytes: new Uint8Array() }));
  await store.clear();
  assert.deepEqual(await store.list(), []);
});

test("files: allow-list, size cap, chunking and verified reassembly", async () => {
  assert.equal(checkFile("poster.ofini", 10).ok, true);
  assert.equal(checkFile("photo.JPG", 10).mime, "image/jpeg");
  assert.equal(checkFile("run.exe", 10).ok, false);
  assert.equal(checkFile("page.html", 10).ok, false, "HTML is not allowed (it could run scripts when opened)");
  assert.equal(checkFile("big.png", LIMITS.fileBytes + 1).ok, false);
  const bytes = new Uint8Array(LIMITS.chunkBytes * 2 + 100).map((_, i) => i % 251);
  const chunks = chunkCount(bytes.length);
  assert.equal(chunks, 3);
  const sha = await sha256B64u(bytes);
  const asm = new Assembler({ verify: async (b, s) => (await sha256B64u(b)) === s });
  assert.equal(asm.offer("s", { fid: "f1", name: "x.png", size: bytes.length, chunks: 99, sha }).ok, false, "chunk count must match");
  assert.equal(asm.offer("s", { fid: "f1", name: "x.png", size: bytes.length, chunks, sha }).ok, true);
  assert.equal((await asm.chunk("other", { fid: "f1", i: 0, data: sliceChunk(bytes, 0) })).ok, false, "chunks from another sender are refused");
  let res;
  for (const i of [2, 0, 1]) res = await asm.chunk("s", { fid: "f1", i, data: sliceChunk(bytes, i) });
  assert.equal(res.done, true);
  assert.deepEqual(res.transfer.bytes, bytes);
  // a tampered file fails the checksum
  asm.offer("s", { fid: "f2", name: "y.png", size: 5, chunks: 1, sha });
  const r2 = await asm.chunk("s", { fid: "f2", i: 0, data: sliceChunk(new Uint8Array(5), 0) });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /checksum/);
  // wrong chunk size aborts
  asm.offer("s", { fid: "f3", name: "z.png", size: 10, chunks: 1, sha });
  assert.equal((await asm.chunk("s", { fid: "f3", i: 0, data: sliceChunk(new Uint8Array(4), 0) })).ok, false);
  assert.equal(asm.active.size, 0);
});

test("presence: throttle sends at most N per second and always the latest value", () => {
  let now = 0;
  const timers = [];
  const sent = [];
  const th = createThrottle((v) => sent.push(v), { perSecond: 20, now: () => now, setTimer: (fn, ms) => (timers.push({ fn, at: now + ms }), timers.length), clearTimer: () => {} });
  th.push(1);
  th.push(2);
  th.push(3);
  assert.deepEqual(sent, [1]);
  now = 50;
  timers.shift().fn();
  assert.deepEqual(sent, [1, 3]);
  th.push(4);
  th.flush();
  assert.deepEqual(sent, [1, 3, 4]);
});

test("presence: token bucket, follow target and equality", () => {
  let now = 0;
  const b = new TokenBucket(10, 2, () => now);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  now = 100;
  assert.equal(b.take(), true);
  assert.deepEqual(followTarget({ x: 0, y: 0, w: 200, h: 100 }, { w: 400, h: 400 }), { cx: 100, cy: 50, zoom: 2 });
  assert.equal(followTarget({ x: 0, y: 0, w: 0, h: 0 }, { w: 1, h: 1 }), null);
  assert.equal(samePresence({ doc: "d", studio: "v", x: 1.01 }, { doc: "d", studio: "v", x: 1.02 }), true);
  assert.equal(samePresence({ doc: "d", studio: "v", x: 1 }, { doc: "d", studio: "v", x: 2 }), false);
});
