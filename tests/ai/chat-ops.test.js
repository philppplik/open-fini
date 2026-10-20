import test from "node:test";
import assert from "node:assert/strict";
import { turnBounds, messageText, messageMarkdown, turnMarkdown, retryPlan, withoutTurn, branchMessages, isToolResultOnly } from "../../app/src/vibe/chat-ops.js";

const chat = () => [
  { role: "user", content: "make a poster" },
  { role: "assistant", content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "t1", name: "add_shape", input: { kind: "rect" } }] },
  { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "ok" }] },
  { role: "assistant", content: [{ type: "text", text: "Done **now**." }] },
  { role: "user", content: [{ type: "text", text: "make it red" }] },
  { role: "assistant", content: "Red it is." },
];

test("turn bounds skip tool results", () => {
  const m = chat();
  assert.deepEqual(turnBounds(m, 0), { start: 0, end: 4 });
  assert.deepEqual(turnBounds(m, 2), { start: 0, end: 4 });
  assert.deepEqual(turnBounds(m, 3), { start: 0, end: 4 });
  assert.deepEqual(turnBounds(m, 5), { start: 4, end: 6 });
  assert.ok(isToolResultOnly(m[2]));
});

test("message text and markdown", () => {
  const m = chat();
  assert.equal(messageText(m[1]), "On it.");
  assert.equal(messageText(m[5]), "Red it is.");
  assert.match(messageMarkdown(m[1]), /Tool call: `add_shape`[\s\S]*"kind": "rect"/);
  assert.equal(messageMarkdown(m[0]), "**You:**\n\nmake a poster");
  assert.equal(messageMarkdown(m[3]), "Done **now**.");
  assert.match(turnMarkdown(m, 1), /^\*\*You:\*\*\n\nmake a poster\n\nOn it\./);
});

test("retry, delete and branch operate on whole turns", () => {
  const m = chat();
  assert.deepEqual(retryPlan(m, 3), { keep: [], text: "make a poster" });
  assert.deepEqual(retryPlan(m, 5), { keep: m.slice(0, 4), text: "make it red" });
  assert.equal(withoutTurn(m, 1).length, 2);
  assert.equal(withoutTurn(m, 1)[0].content[0].text, "make it red");
  assert.equal(withoutTurn(m, 5).length, 4);
  const b = branchMessages(m, 1);
  assert.equal(b.length, 4);
  b[0].content = "changed";
  assert.equal(m[0].content, "make a poster"); // deep copy
  assert.equal(retryPlan([], 0), null);
  assert.equal(retryPlan([{ role: "user", content: [{ type: "image", mime: "image/png", data: "x" }, { type: "text", text: "describe" }] }], 0), null);
});
