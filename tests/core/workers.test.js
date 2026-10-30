import test from "node:test";
import assert from "node:assert/strict";
import { createPool, defaultPoolSize } from "../../app/src/core/workers/pool.js";
import { runJob as runJobDirect, JOB_NAMES } from "../../app/src/core/workers/jobs.js";
import { runJob } from "../../app/src/core/workers/index.js";
import { resizeImage } from "../../app/src/engine/pixel/transform.js";
import { unzipSync, strFromU8, strToU8 } from "../../app/vendor/fflate/fflate.js";

const tick = () => new Promise((r) => setImmediate(r));

/** A Worker-like fake that runs jobs from a table on the next tick; `hang` jobs never finish. */
function fakeWorkerFactory(jobs, log = { created: 0, terminated: 0 }) {
  return () => {
    log.created++;
    const w = {
      dead: false,
      postMessage({ id, job, args }) {
        setImmediate(async () => {
          if (w.dead) return;
          if (job === "crash") return w.onerror?.({ message: "boom", preventDefault() {} });
          if (job === "hang") return;
          try {
            const post = (m) => !w.dead && w.onmessage?.({ data: m });
            const r = await jobs[job](args, (p) => post({ id, t: "progress", p }));
            post({ id, t: "done", r });
          } catch (err) {
            w.onmessage?.({ data: { id, t: "error", e: { message: err.message } } });
          }
        });
      },
      terminate() {
        w.dead = true;
        log.terminated++;
      },
    };
    return w;
  };
}

const JOBS = {
  double: async (x) => x * 2,
  steps: async (n, progress) => {
    for (let i = 1; i <= n; i++) progress(i / n);
    return "done";
  },
  fail: async () => {
    throw new Error("nope");
  },
};
const noLocal = () => Promise.reject(new Error("local should not run"));

test("pool size leaves one core to the UI and is capped", () => {
  assert.equal(defaultPoolSize(1), 1);
  assert.equal(defaultPoolSize(4), 3);
  assert.equal(defaultPoolSize(32), 4);
  assert.equal(defaultPoolSize(undefined), 1);
});

test("jobs run on workers, at most `size` at once, and report progress and errors", async () => {
  const log = { created: 0, terminated: 0 };
  const pool = createPool({ create: fakeWorkerFactory(JOBS, log), runLocal: noLocal, size: 2, idleMs: 0 });
  const progress = [];
  const results = await Promise.all([pool.run("double", 2), pool.run("double", 3), pool.run("double", 4), pool.run("steps", 2, { onProgress: (p) => progress.push(p) })]);
  assert.deepEqual(results, [4, 6, 8, "done"]);
  assert.deepEqual(progress, [0.5, 1]);
  assert.equal(log.created, 2, "workers are reused");
  await assert.rejects(pool.run("fail"), /nope/);
  assert.equal(pool.stats.local, false);
});

test("cancelling a running job terminates its worker; a queued job is dropped; the pool keeps working", async () => {
  const log = { created: 0, terminated: 0 };
  const pool = createPool({ create: fakeWorkerFactory(JOBS, log), runLocal: noLocal, size: 1, idleMs: 0 });
  assert.equal(await pool.run("double", 1), 2); // prove the worker
  const a = new AbortController();
  const b = new AbortController();
  const running = pool.run("hang", null, { signal: a.signal });
  const queued = pool.run("double", 5, { signal: b.signal });
  await tick();
  b.abort();
  await assert.rejects(queued, { name: "AbortError" });
  a.abort();
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(log.terminated, 1, "the hung worker was terminated");
  assert.equal(await pool.run("double", 21), 42);
  assert.equal(log.created, 2, "a fresh worker replaced it");
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(pool.run("double", 1, { signal: pre.signal }), { name: "AbortError" });
});

test("a worker that fails before its first job switches the pool to local mode and re-runs the job", async () => {
  let local = 0;
  const create = () => {
    const w = { postMessage: () => setImmediate(() => w.onerror?.({ message: "module failed", preventDefault() {} })), terminate() {} };
    return w;
  };
  const pool = createPool({ create, runLocal: async (job, x) => (local++, x * 2), size: 2, idleMs: 0 });
  assert.deepEqual(await Promise.all([pool.run("double", 1), pool.run("double", 2)]), [2, 4]);
  assert.equal(pool.stats.local, true);
  assert.equal(await pool.run("double", 5), 10);
  assert.equal(local, 3);
});

test("a proven worker that crashes fails only its job", async () => {
  const pool = createPool({ create: fakeWorkerFactory(JOBS), runLocal: noLocal, size: 1, idleMs: 0 });
  assert.equal(await pool.run("double", 1), 2);
  await assert.rejects(pool.run("crash"), /crashed/);
  assert.equal(await pool.run("double", 3), 6);
  assert.equal(pool.stats.local, false);
});

test("without a worker factory every job runs locally (the Node and no-Worker fallback)", async () => {
  const pool = createPool({ create: null, runLocal: async (job, x, o) => (o.onProgress?.(1), x + 1) });
  const seen = [];
  assert.equal(await pool.run("inc", 1, { onProgress: (p) => seen.push(p) }), 2);
  assert.deepEqual(seen, [1]);
  assert.equal(pool.stats.local, true);
});

test("idle workers are terminated after idleMs", async () => {
  const log = { created: 0, terminated: 0 };
  const timers = { fns: [], setTimeout(fn) { this.fns.push(fn); return this.fns.length; }, clearTimeout() {} };
  const pool = createPool({ create: fakeWorkerFactory(JOBS, log), runLocal: noLocal, size: 1, idleMs: 1000, timers });
  await pool.run("double", 1);
  timers.fns.forEach((f) => f());
  assert.equal(log.terminated, 1);
  assert.equal(pool.stats.idle, 0);
});

test("the real jobs give the same results as the engines, through the public entry (local fallback in Node)", async () => {
  assert.deepEqual(JOB_NAMES.sort(), ["pixel.resize", "pixel.trace", "zip.compress"]);
  const img = { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4).map((_, i) => (i * 37) & 255) };
  const viaPool = await runJob("pixel.resize", { img, width: 4, height: 3, filter: "bicubic" });
  assert.deepEqual(viaPool, resizeImage(img, 4, 3, { filter: "bicubic" }));
  const zipped = await runJob("zip.compress", { files: { "a.json": strToU8('{"x":1}') }, level: 6 });
  assert.equal(strFromU8(unzipSync(zipped)["a.json"]), '{"x":1}');
  const square = { width: 20, height: 20, data: new Uint8ClampedArray(20 * 20 * 4) };
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) square.data.set([0, 0, 0, 255], (y * 20 + x) * 4);
  const tr = await runJob("pixel.trace", { img: square, maxSide: 10, opts: { mode: "mono", speckle: 0 } });
  assert.deepEqual([tr.width, tr.height], [10, 10]);
  assert.equal(tr.trace.layers.length, 1);
  await assert.rejects(runJobDirect("nope", {}), /Unknown job/);
});
