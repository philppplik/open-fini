import { test } from "node:test";
import assert from "node:assert/strict";
import { beginBoot, markBootOk, resetBootFailures, isSafeMode, safeModeUrl, BOOT_KEY } from "../../app/src/core/bootguard.js";

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

test("a healthy start never offers safe mode", () => {
  const s = store();
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(beginBoot(s), { failures: 0, offerSafeMode: false });
    markBootOk(s);
  }
});

test("two failed starts in a row offer safe mode on the third start", () => {
  const s = store();
  assert.equal(beginBoot(s).failures, 0); // never finishes
  assert.deepEqual(beginBoot(s), { failures: 1, offerSafeMode: false });
  assert.deepEqual(beginBoot(s), { failures: 2, offerSafeMode: true });
  assert.equal(beginBoot(s).offerSafeMode, true);
});

test("a successful start resets the counter", () => {
  const s = store();
  beginBoot(s);
  beginBoot(s);
  markBootOk(s);
  assert.deepEqual(beginBoot(s), { failures: 0, offerSafeMode: false });
});

test("continuing normally starts counting from zero", () => {
  const s = store();
  beginBoot(s);
  beginBoot(s);
  assert.equal(beginBoot(s).offerSafeMode, true);
  resetBootFailures(s);
  assert.deepEqual(beginBoot(s), { failures: 1, offerSafeMode: false });
});

test("damaged or unavailable storage does not break the guard", () => {
  assert.deepEqual(beginBoot(store({ [BOOT_KEY]: "{not json" })), { failures: 0, offerSafeMode: false });
  assert.deepEqual(beginBoot(store({ [BOOT_KEY]: '"str"' })), { failures: 0, offerSafeMode: false });
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.deepEqual(beginBoot(broken), { failures: 0, offerSafeMode: false });
  assert.doesNotThrow(() => markBootOk(broken));
});

test("isSafeMode reads the query string", () => {
  assert.equal(isSafeMode("?safe=1"), true);
  assert.equal(isSafeMode("?studio=code&safe"), true);
  assert.equal(isSafeMode("?safe=true"), true);
  assert.equal(isSafeMode("?safe=0"), false);
  assert.equal(isSafeMode("?safe=false"), false);
  assert.equal(isSafeMode(""), false);
  assert.equal(isSafeMode(undefined), false);
  assert.equal(safeModeUrl("/app/"), "/app/?safe=1");
});
