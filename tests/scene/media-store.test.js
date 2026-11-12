// The Scene media store releases what it holds for media items that left the bin (object URLs are full copies of
// the file): prune() revokes them, and an item that comes back (undo) loads again on demand.
import test from "node:test";
import assert from "node:assert/strict";
import { createMediaStore } from "../../app/src/scene/media.js";

test("prune releases the object URL, sound and peaks of removed media items", async (t) => {
  const made = [];
  const revoked = [];
  const { createObjectURL, revokeObjectURL } = URL;
  URL.createObjectURL = () => {
    made.push(`blob:${made.length}`);
    return made.at(-1);
  };
  URL.revokeObjectURL = (u) => revoked.push(u);
  t.after(() => Object.assign(URL, { createObjectURL, revokeObjectURL }));

  let model = { media: { a: { kind: "audio", mime: "audio/wav", bytes: new Uint8Array(8) }, b: { kind: "audio", mime: "audio/wav", bytes: new Uint8Array(8) } } };
  const store = createMediaStore(() => model);
  const ua = store.url("a");
  const ub = store.url("b");
  assert.equal(store.url("a"), ua, "one URL per item");
  await store.audio("a"); // no audio context in Node: resolves to null, but the entry is cached

  store.prune(new Set());
  assert.deepEqual(revoked, [], "items still in the bin keep their URL");

  model = { media: { b: model.media.b } };
  store.prune(new Set());
  assert.deepEqual(revoked, [ua], "the removed item's URL is revoked");
  assert.equal(store.url("b"), ub);

  model = { media: { ...model.media, a: { kind: "audio", mime: "audio/wav", bytes: new Uint8Array(8) } } };
  assert.notEqual(store.url("a"), ua, "an item that comes back gets a fresh URL");
  store.destroy();
  assert.equal(revoked.length, 3);
});
