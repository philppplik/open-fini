import { test } from "node:test";
import assert from "node:assert/strict";
import { packValue, unpackValue, AtRest, createLock, verifyLock, isProtectedKey, isSealed } from "../../app/src/core/atrest.js";

const ITER = { iterations: 1000 };

test("packValue round-trips JSON with binary parts", () => {
  const v = { time: 5, active: 0, docs: [{ name: "a", saved: true, path: null, bytes: new Uint8Array([1, 2, 3, 250]) }, { name: "b", bytes: new Uint8Array(0) }], nested: { n: [1, "x", null] } };
  const out = unpackValue(packValue(v));
  assert.deepEqual(out.docs[0].bytes, new Uint8Array([1, 2, 3, 250]));
  assert.equal(out.docs[1].bytes.length, 0);
  assert.deepEqual(out.nested, v.nested);
  assert.equal(out.docs[0].name, "a");
  assert.deepEqual(unpackValue(packValue(new Uint8Array([9, 8]))), new Uint8Array([9, 8]));
  assert.equal(unpackValue(packValue("text")), "text");
  assert.equal(unpackValue(packValue(undefined)), null);
});

test("packValue handles views into larger buffers", () => {
  const big = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(unpackValue(packValue({ b: big.subarray(2, 5) })).b, new Uint8Array([2, 3, 4]));
});

test("seal and open: round trip, envelope shape, fresh IV each time", async () => {
  const { key } = await createLock("correct horse", ITER);
  const ar = new AtRest();
  ar.key = key;
  const value = { docs: [{ bytes: new Uint8Array([7, 7, 7]) }], secret: "sk-test" };
  const a = await ar.seal(value);
  const b = await ar.seal(value);
  assert.ok(isSealed(a));
  assert.notDeepEqual(a.iv, b.iv);
  assert.ok(!Buffer.from(a.data).includes(Buffer.from("sk-test")), "plaintext is not visible in the ciphertext");
  assert.deepEqual((await ar.open(a)).docs[0].bytes, new Uint8Array([7, 7, 7]));
  assert.equal((await ar.open(b)).secret, "sk-test");
});

test("tampering is detected and a locked store refuses to work", async () => {
  const { key } = await createLock("pw-1234", ITER);
  const ar = new AtRest();
  ar.key = key;
  const env = await ar.seal({ a: 1 });
  const bad = { ...env, data: env.data.slice() };
  bad.data[3] ^= 1;
  await assert.rejects(() => ar.open(bad), { code: "bad_passphrase" });
  ar.forget();
  assert.equal(ar.unlocked, false);
  await assert.rejects(() => ar.seal({}), { code: "locked" });
  await assert.rejects(() => ar.open(env), { code: "locked" });
});

test("lock record: right passphrase gives a working key, wrong one fails, nothing secret is stored", async () => {
  const { record, key } = await createLock("my passphrase", ITER);
  const sealed = await new (class extends AtRest { key = key })().seal({ x: 1 });
  const k2 = await verifyLock(record, "my passphrase");
  const ar = new AtRest();
  ar.key = k2;
  assert.deepEqual(await ar.open(sealed), { x: 1 });
  await assert.rejects(() => verifyLock(record, "my passphrasE"), { code: "bad_passphrase" });
  await assert.rejects(() => verifyLock({ v: 2 }, "x"), { code: "bad_format" });
  await assert.rejects(() => verifyLock({ ...record, iter: 99999999 }, "x"), { code: "bad_format" });
  assert.ok(!JSON.stringify(record, (k, v) => (v instanceof Uint8Array ? Array.from(v) : v)).includes("my passphrase"));
  await assert.rejects(() => createLock("", ITER), { code: "bad_passphrase" });
});

test("protected keys are the private ones only", () => {
  for (const k of ["session", "recents", "recent:a.ofini:1", "vibe.secrets", "vibe.chats", "vibe.chat.abc"]) assert.equal(isProtectedKey(k), true, k);
  for (const k of ["fonts", "applock", "diag.errors", "vibe.settings", "vibe.providers"]) assert.equal(isProtectedKey(k), false, k);
  assert.equal(isSealed({ __ofl: 1 }), false);
  assert.equal(isSealed(null), false);
});
