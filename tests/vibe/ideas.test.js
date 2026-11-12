import test from "node:test";
import assert from "node:assert/strict";
import { IDEAS, GROUPS, pickIdeas } from "../../app/src/vibe/ideas.js";
import { createOpenFiniTools } from "../../app/src/vibe/tools/index.js";
import { fakeApp } from "./helpers.js";

test("every idea is well-formed and uses only registered tools", () => {
  const names = new Set(createOpenFiniTools(fakeApp()).map((t) => t.name));
  const ids = new Set();
  for (const i of IDEAS) {
    assert.ok(!ids.has(i.id), `duplicate id ${i.id}`);
    ids.add(i.id);
    assert.ok(GROUPS.includes(i.group), i.id);
    assert.ok(i.title && i.prompt.length > 30 && i.tools.length, i.id);
    for (const t of i.tools) assert.ok(names.has(t), `${i.id}: unknown tool ${t}`);
  }
  for (const g of GROUPS) assert.ok(IDEAS.some((i) => i.group === g), `group ${g} is empty`);
});

test("pickIdeas leads with the active studio, never repeats in a round and cycles the whole pool", () => {
  const first = pickIdeas("scene", 0);
  assert.equal(first.length, 4);
  assert.equal(first[0].group, "scene");
  assert.equal(new Set(first.map((i) => i.id)).size, 4);
  const seen = new Set();
  for (let r = 0; r < Math.ceil(IDEAS.length / 4); r++) pickIdeas("pixel", r).forEach((i) => seen.add(i.id));
  assert.equal(seen.size, IDEAS.length);
  assert.equal(pickIdeas("vibe", 0)[0].group, "vector", "an unknown studio falls back to the group order");
});
