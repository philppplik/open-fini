import test from "node:test";
import assert from "node:assert/strict";
import { WriteLock } from "../../app/src/vibe/locks.js";
import { undoRun, undoRunCheck, runSteps } from "../../app/src/vibe/run-undo.js";
import { History } from "../../app/src/core/history.js";
import { Doc } from "../../app/src/core/doc.js";

test("write lock: one holder, strict FIFO order, idempotent release", async () => {
  const lock = new WriteLock();
  const order = [];
  const work = (owner, ms) => lock.run(owner, async () => {
    order.push(`${owner}+`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${owner}-`);
  });
  await Promise.all([work("a", 15), work("b", 1), work("c", 1), work("a", 1)]);
  assert.deepEqual(order, ["a+", "a-", "b+", "b-", "c+", "c-", "a+", "a-"]);
  const rel = await lock.acquire("x");
  rel();
  rel();
  assert.equal(lock.busy, false);
});

test("write lock: an aborted waiter leaves the queue, the next one is granted", async () => {
  const lock = new WriteLock();
  const rel = await lock.acquire("a");
  const ctl = new AbortController();
  const waiting = lock.acquire("b", { signal: ctl.signal });
  const third = lock.acquire("c");
  assert.equal(lock.waitingFor("b"), true);
  ctl.abort();
  await assert.rejects(waiting, /Aborted/);
  rel();
  const relC = await third;
  assert.equal(lock.holder.owner, "c");
  relC();
  await assert.rejects(lock.acquire("d", { signal: AbortSignal.abort() }), /Aborted/);
});

test("history: ambient tag is stamped and entries with different tags never coalesce", () => {
  const h = new History();
  const op = { undo() {}, redo() {} };
  h.tag = { chat: "c1", run: "r1" };
  h.push({ ops: [op], key: "k" });
  h.tag = { chat: "c2", run: "r2" };
  h.push({ ops: [op], key: "k" });
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries[0].tag.run, "r1");
  assert.equal(h.entries[1].tag.run, "r2");
  h.push({ ops: [op], key: "k" }); // same tag + key merges
  assert.equal(h.entries.length, 2);
  h.tag = null;
  h.push({ ops: [op] });
  assert.equal(h.entries[2].tag, undefined);
});

function docWith() {
  const d = new Doc({ name: "u" });
  d.history.clear();
  const edit = (tag, v) => {
    d.history.tag = tag;
    d.set(d.pages[0], { name: v });
    d.history.tag = null;
  };
  return { d, edit };
}

test("run undo: undoes only the run's entries when they are on top", () => {
  const { d, edit } = docWith();
  edit({ chat: "A", run: "ra" }, "a1");
  edit({ chat: "A", run: "ra" }, "a2");
  edit({ chat: "B", run: "rb" }, "b1");
  assert.equal(runSteps(d.history, "ra"), 2);
  const blocked = undoRunCheck(d.history, "ra");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockedBy, "other");
  assert.match(undoRun(d, "ra").reason, /Another chat/);
  assert.equal(d.pages[0].name, "b1", "nothing was undone");
  assert.deepEqual(undoRun(d, "rb"), { undone: 1 });
  assert.deepEqual(undoRun(d, "ra"), { undone: 2 });
  assert.equal(d.pages[0].name, "Page 1");
  assert.match(undoRun(d, "ra").reason, /no edits left/);
});

test("run undo: an untagged (user) edit after the run blocks it", () => {
  const { d, edit } = docWith();
  edit({ chat: "A", run: "ra" }, "a1");
  d.set(d.pages[0], { name: "user" });
  const c = undoRunCheck(d.history, "ra");
  assert.equal(c.blockedBy, "user");
  assert.match(c.reason, /You edited/);
});
