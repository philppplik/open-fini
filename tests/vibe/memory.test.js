import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMemory, selectMemories, findDuplicate, similarity, inScope, importMemories, memoryTokens, MAX_MEMORY_TEXT } from "../../app/src/vibe/memory.js";

const NOW = Date.UTC(2026, 10, 5);
const mem = (id, text, extra = {}) => normalizeMemory({ id, text, created: NOW - 1000, ...extra }, NOW);

test("normalizeMemory migrates the old { id, text, time } notes", () => {
  const m = normalizeMemory({ id: "m1", text: "  Brand color is #ff6600  ", time: 123 });
  assert.equal(m.text, "Brand color is #ff6600");
  assert.equal(m.kind, "note");
  assert.equal(m.scope, "global");
  assert.equal(m.enabled, true);
  assert.equal(m.created, 123);
  assert.equal(normalizeMemory({ text: "x".repeat(900) }).text.length, MAX_MEMORY_TEXT);
  assert.equal(normalizeMemory({ text: "a", kind: "bogus", scope: "elsewhere" }).kind, "note");
  assert.equal(normalizeMemory({ text: "a", scope: "elsewhere" }).scope, "global");
});

test("tokens drop stop words and keep Unicode letters", () => {
  assert.deepEqual(memoryTokens("The user's Größe is 12 cm"), ["user", "größe", "12", "cm"]);
});

test("duplicates are found by token overlap", () => {
  const list = [mem("a", "Use metric units for all measurements"), mem("b", "Brand color is teal")];
  assert.equal(findDuplicate(list, "use metric units for all measurements please")?.id, "a");
  assert.equal(findDuplicate(list, "The logo is round"), null);
  assert.ok(similarity("same text", "same text") === 1);
});

test("selectMemories returns everything relevant first when the pool is small", () => {
  const list = [mem("a", "Prefers a calm, friendly tone", { kind: "preference" }), mem("b", "Works at a coffee roaster called Ember & Oak", { kind: "fact" })];
  const { selected } = selectMemories(list, "write a slogan for the coffee roaster", { k: 8, now: NOW });
  assert.deepEqual(selected.map((m) => m.id), ["b", "a"]);
});

test("selectMemories ranks by relevance, honors k, pins, switches, scope and exclusions", () => {
  const list = [];
  for (let i = 0; i < 30; i++) list.push(mem(`n${i}`, `Unrelated detail number ${i} about gardening and tomatoes`));
  list.push(mem("logo", "The logo uses the colors teal and sand", { kind: "project" }));
  list.push(mem("pin", "Always answer in short sentences", { pinned: true }));
  list.push(mem("off", "Logo colors were red before", { enabled: false }));
  list.push(mem("proj", "Logo for Acme must stay square", { scope: "project:Acme" }));
  list.push(mem("ex", "Logo font is Inter"));
  const r = selectMemories(list, "make the logo colors brighter", { k: 3, now: NOW, exclude: ["ex"] });
  const ids = r.selected.map((m) => m.id);
  assert.equal(ids[0], "pin", "pinned first");
  assert.ok(ids.includes("logo"));
  assert.ok(!ids.includes("off"), "disabled memories are never sent");
  assert.ok(!ids.includes("proj"), "project memories only in their project");
  assert.ok(!ids.includes("ex"), "excluded for this chat");
  assert.ok(ids.length <= 4);
  assert.ok(!ids.some((id) => id.startsWith("n")), "unrelated memories stay home");
  const acme = selectMemories(list, "logo", { k: 5, now: NOW, project: "acme" });
  assert.ok(acme.selected.some((m) => m.id === "proj"));
  assert.ok(inScope(list.find((m) => m.id === "proj"), "ACME"));
});

test("selectMemories keeps within the character budget", () => {
  const list = [mem("a", "logo ".repeat(80)), mem("b", "logo ".repeat(80)), mem("c", "logo ".repeat(80))];
  const { selected } = selectMemories(list, "logo", { k: 1, budgetChars: 500, now: NOW });
  assert.equal(selected.length, 1);
});

test("importMemories validates and skips duplicates", () => {
  const existing = [mem("a", "Brand color is teal")];
  const r = importMemories(existing, JSON.stringify({ memories: [{ text: "Brand color is teal" }, { text: "Uses Inter for headings", kind: "preference" }, { nope: 1 }] }));
  assert.equal(r.added, 1);
  assert.equal(r.list.length, 2);
  assert.throws(() => importMemories([], "{}"), /does not contain memories/);
});
