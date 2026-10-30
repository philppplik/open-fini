import test from "node:test";
import assert from "node:assert/strict";
import { createHeartbeat, createFloodGuard, recordHang, WATCHDOG } from "../../app/src/extensions/watchdog.js";

/** Manual interval timers: tick() fires every registered interval once. */
function fakeTimers() {
  const live = new Map();
  let id = 0;
  return {
    setInterval: (fn) => (live.set(++id, fn), id),
    clearInterval: (h) => live.delete(h),
    async tick(n = 1) {
      for (let i = 0; i < n; i++) {
        for (const fn of [...live.values()]) fn();
        await new Promise((r) => setImmediate(r)); // let ping promises settle
      }
    },
    get count() {
      return live.size;
    },
  };
}

test("a sandbox that answers every ping is never declared hung", async () => {
  const timers = fakeTimers();
  let pings = 0;
  let hung = 0;
  const hb = createHeartbeat({ ping: async () => void pings++, onHang: () => hung++, misses: 3, timers });
  hb.start();
  await timers.tick(10);
  assert.equal(hung, 0);
  assert.equal(pings, 10);
  assert.equal(hb.state, "running");
});

test("a sandbox that stops answering is declared hung after `misses` ticks, once, and the timer stops", async () => {
  const timers = fakeTimers();
  let answer = true;
  const hangs = [];
  const hb = createHeartbeat({ ping: () => (answer ? Promise.resolve() : new Promise(() => {})), onHang: (i) => hangs.push(i), misses: 3, timers });
  hb.start();
  await timers.tick(2);
  answer = false; // busy loop: the next ping never comes back
  await timers.tick(1); // sends the unanswered ping
  await timers.tick(2);
  assert.equal(hangs.length, 0, "two missed ticks are tolerated");
  await timers.tick(1);
  assert.deepEqual(hangs, [{ misses: 3 }]);
  assert.equal(hb.state, "hung");
  assert.equal(timers.count, 0, "the interval is cleared");
  await timers.tick(5);
  assert.equal(hangs.length, 1);
});

test("a late answer resets the miss counter; rejected pings count as missed", async () => {
  const timers = fakeTimers();
  let release;
  let mode = "slow";
  let hung = 0;
  const ping = () => (mode === "slow" ? new Promise((r) => (release = r)) : Promise.reject(new Error("TIMEOUT")));
  const hb = createHeartbeat({ ping, onHang: () => hung++, misses: 2, timers });
  hb.start();
  await timers.tick(1); // ping 1 outstanding
  await timers.tick(1); // miss 1
  assert.equal(hb.missed, 1);
  release();
  await timers.tick(1); // answered → fresh ping
  assert.equal(hb.missed, 0);
  release();
  mode = "reject";
  await timers.tick(1); // rejected ping stays outstanding
  await timers.tick(2);
  assert.equal(hung, 1);
});

test("stop() ends the heartbeat without a hang", async () => {
  const timers = fakeTimers();
  let hung = 0;
  const hb = createHeartbeat({ ping: () => new Promise(() => {}), onHang: () => hung++, misses: 2, timers });
  hb.start();
  await timers.tick(1);
  hb.stop();
  await timers.tick(5);
  assert.equal(hung, 0);
  assert.equal(hb.state, "idle");
  assert.equal(timers.count, 0);
});

test("the flood guard lets bursts through, drops the excess and asks for a kill exactly once", () => {
  let t = 0;
  const g = createFloodGuard({ burst: 10, perSecond: 5, killAfter: 4, now: () => t });
  for (let i = 0; i < 10; i++) assert.equal(g.hit(), "ok");
  assert.deepEqual([g.hit(), g.hit(), g.hit()], ["drop", "drop", "drop"]);
  assert.equal(g.hit(), "kill");
  assert.equal(g.hit(), "drop", "kill is reported once");
  t += 1000; // 5 tokens refill
  assert.equal(g.hit(), "ok");
});

test("a flood that trickles through the refill is still caught; brief overshoots are not", () => {
  let t = 0;
  const g = createFloodGuard({ burst: 10, perSecond: 1000, killAfter: 2000, now: () => t });
  const seen = { ok: 0, drop: 0, kill: 0 };
  for (let i = 0; i < 100_000 && !seen.kill; i++) {
    t += 0.01; // 100 000 messages per second: one gets through every 100
    seen[g.hit()]++;
  }
  assert.equal(seen.kill, 1, "the slow refill does not reset the count");
  const calm = createFloodGuard({ burst: 10, perSecond: 1000, killAfter: 2000, now: () => t });
  for (let s = 0; s < 5; s++) {
    for (let i = 0; i < 1500; i++) assert.notEqual(calm.hit(), "kill"); // 1500 at once, then a second of quiet
    t += 1001;
  }
});

test("three stops inside the window disable the extension; old stops expire", () => {
  const W = WATCHDOG.hangWindowMs;
  let r = recordHang([], 0);
  assert.deepEqual([r.count, r.disable], [1, false]);
  r = recordHang(r.times, 1000);
  assert.deepEqual([r.count, r.disable], [2, false]);
  assert.equal(recordHang(r.times, 2000).disable, true);
  const later = recordHang(r.times, W + 500); // the first stop (t=0) left the window
  assert.deepEqual([later.count, later.disable], [2, false]);
});
