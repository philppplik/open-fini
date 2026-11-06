import { test } from "node:test";
import assert from "node:assert/strict";
import { contextItems, dropContextItem, dropOldToolResults, contextWindowFor, DROPPED, IMAGE_TOKENS } from "../../app/src/vibe/context-items.js";
import { nestChats } from "../../app/src/vibe/chat-ops.js";

const transcript = () => [
  { role: "user", content: [{ type: "text", text: "[Attached file: notes.md (attachment 1)]\n```\nhello world\n```" }, { type: "image", mime: "image/png", data: "AAAA" }, { type: "text", text: "Make a logo" }] },
  { role: "assistant", content: [{ type: "text", text: "Looking first." }, { type: "tool_use", id: "t1", name: "describe_page", input: { page: 0 } }] },
  { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "x".repeat(4000) }] },
  { role: "assistant", content: "Done." },
  { role: "user", content: "Now make it blue" },
  { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "set_style", input: { fill: "#00f" } }] },
  { role: "user", content: [{ type: "tool_result", toolUseId: "t2", content: "ok" }] },
];

test("contextItems lists every part with token estimates", () => {
  const { items, total, byKind } = contextItems({ system: "s".repeat(400), tools: [{ name: "a" }], memory: [{ id: "m1", text: "Prefers teal" }], messages: transcript() });
  const kinds = items.map((i) => i.kind);
  assert.ok(kinds.includes("system") && kinds.includes("tools") && kinds.includes("memory"));
  const res = items.find((i) => i.id === "res:t1");
  assert.equal(res.label, "describe_page");
  assert.equal(res.tokens, 1000);
  assert.ok(items.some((i) => i.kind === "attachment" && i.tokens === IMAGE_TOKENS));
  assert.ok(items.some((i) => i.kind === "attachment" && /notes\.md/.test(i.label)));
  assert.equal(total, items.reduce((n, i) => n + i.tokens, 0));
  assert.equal(byKind.system, 100);
  assert.equal(items.find((i) => i.kind === "tool_call").droppable, false, "tool calls stay so pairs remain valid");
});

test("dropping a tool result keeps the tool_use / tool_result pair", () => {
  const msgs = transcript();
  const { items } = contextItems({ messages: msgs });
  const out = dropContextItem(msgs, items.find((i) => i.id === "res:t1"));
  assert.equal(out[2].content[0].toolUseId, "t1");
  assert.equal(out[2].content[0].content, DROPPED);
  assert.equal(msgs[2].content[0].content.length, 4000, "input untouched");
  assert.ok(!contextItems({ messages: out }).items.some((i) => i.id === "res:t1"), "dropped items disappear from the list");
});

test("dropping an attachment or a turn", () => {
  const msgs = transcript();
  const { items } = contextItems({ messages: msgs });
  const img = items.find((i) => i.id.startsWith("img:"));
  assert.equal(dropContextItem(msgs, img)[0].content[1].text, DROPPED);
  const turn = items.find((i) => i.kind === "message" && i.label === "Now make it blue");
  const out = dropContextItem(msgs, turn);
  assert.equal(out.length, 4, "the whole second turn (with its tool results) is removed");
  assert.equal(dropContextItem(msgs, { kind: "system", droppable: false }), msgs);
});

test("dropOldToolResults keeps the newest turn", () => {
  const out = dropOldToolResults(transcript());
  assert.equal(out[2].content[0].content, DROPPED);
  assert.equal(out[6].content[0].content, "ok");
});

test("contextWindowFor knows common families and falls back", () => {
  assert.equal(contextWindowFor("claude-sonnet-4-5"), 200000);
  assert.equal(contextWindowFor("gpt-4o-mini"), 128000);
  assert.equal(contextWindowFor("gemini-2.5-pro"), 1000000);
  assert.equal(contextWindowFor("my-local-model"), 128000);
});

test("nestChats puts sub-threads under their main thread", () => {
  const rows = nestChats([{ id: "b", parent: "a" }, { id: "c" }, { id: "a" }, { id: "x", parent: "gone" }]);
  assert.deepEqual(rows.map((r) => `${r.sub ? "-" : ""}${r.chat.id}`), ["c", "a", "-b", "x"]);
});
