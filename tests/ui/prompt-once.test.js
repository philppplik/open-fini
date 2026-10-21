// Regression tests for the "studios ask twice when saving or exporting" bug: prompts must be idempotent.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { singleFlight, createOnceRegistry } from "../../app/src/core/single-flight.js";

const here = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(here, "../../app/src/commands");

test("singleFlight: a second trigger while the first runs joins it (one file dialog)", async () => {
  let prompts = 0;
  let release;
  const save = singleFlight(() => {
    prompts++;
    return new Promise((r) => (release = r));
  });
  const a = save();
  const b = save(); // key auto-repeat / shortcut plus click
  assert.equal(a, b);
  assert.equal(prompts, 1);
  release("ok");
  assert.equal(await a, "ok");
  const c = save(); // after it finished a new request is allowed
  assert.equal(prompts, 2);
  release();
  await c;
});

test("singleFlight: keys keep documents independent and failures free the slot", async () => {
  let runs = 0;
  const f = singleFlight(async (doc) => {
    runs++;
    if (doc.fail) throw new Error("boom");
  }, (doc) => doc);
  const d1 = {};
  const d2 = {};
  await Promise.all([f(d1), f(d2), f(d1)]);
  assert.equal(runs, 2);
  const bad = { fail: true };
  await assert.rejects(f(bad), /boom/);
  await assert.rejects(f(bad), /boom/);
  assert.equal(runs, 4);
});

test("singleFlight: a synchronous throw becomes a rejection and does not occupy the slot", async () => {
  let n = 0;
  const f = singleFlight(() => {
    n++;
    throw new Error("sync");
  });
  await assert.rejects(f(), /sync/);
  await assert.rejects(f(), /sync/);
  assert.equal(n, 2);
});

test("dialog opener is idempotent for the same request", () => {
  const reg = createOnceRegistry();
  let created = 0;
  const open = () => reg.open("export", () => ({ id: ++created }));
  const first = open();
  const second = open();
  assert.equal(first, second);
  assert.equal(created, 1);
});

test("dialog opener: releasing allows a new dialog, and a stale release does not close the newer one", () => {
  const reg = createOnceRegistry();
  let releaseFirst;
  const first = reg.open("export", (release) => {
    releaseFirst = release;
    return { n: 1 };
  });
  releaseFirst();
  assert.equal(reg.has("export"), false);
  const second = reg.open("export", () => ({ n: 2 }));
  assert.notEqual(first, second);
  releaseFirst(); // the old dialog finishes its hide animation late
  assert.equal(reg.has("export"), true);
  assert.equal(reg.size, 1);
});

test("no command id is registered twice in app/src/commands", () => {
  const seen = new Map();
  const dupes = [];
  const re = /(?:\bdef\(|registerCommand\()\s*(["'`])([\w.:-]+)\1/g;
  for (const file of readdirSync(commandsDir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(commandsDir, file), "utf8");
    let m;
    while ((m = re.exec(src))) {
      const id = m[2];
      if (seen.has(id)) dupes.push(`${id} (${seen.get(id)} and ${file})`);
      else seen.set(id, file);
    }
  }
  assert.deepEqual(dupes, []);
  assert.ok(seen.size > 100, "the scan should find the command definitions");
});
