import test from "node:test";
import assert from "node:assert/strict";
import { newThread, normalizeThreads, applyCommentOp } from "../../app/src/collab/comments.js";
import { migrateDocumentJson } from "../../app/src/core/ofini-migrate.js";
import { Doc } from "../../app/src/core/doc.js";

const ME = "A".repeat(22);
const AI = { id: ME, nick: "Vibe (AI)", color: "#7c6df2", ai: true };

test("comments written by the assistant carry ai: true on the thread and the message", () => {
  const th = newThread({ id: "c1", anchor: { kind: "doc" }, author: AI, text: "Made it bigger." });
  assert.equal(th.ai, true);
  assert.equal(th.messages[0].ai, true);
  assert.equal(th.nick, "Vibe (AI)");
  const human = newThread({ id: "c2", anchor: { kind: "doc" }, author: { id: ME, nick: "Mia", color: "#0090ff" }, text: "Bigger?" });
  assert.equal("ai" in human, false);
  assert.equal("ai" in human.messages[0], false);
});

test("ai survives validation, replies keep it, and old comments without it still load", () => {
  const threads = normalizeThreads([newThread({ id: "c1", anchor: { kind: "doc" }, author: { id: ME, nick: "Mia", color: "#0090ff" }, text: "Bigger?" })]);
  assert.equal(threads.length, 1);
  assert.ok(applyCommentOp(threads, { op: "reply", threadId: "c1", msg: { id: "m1", author: ME, nick: "Vibe (AI)", color: "#7c6df2", text: "Done.", ts: 1, ai: true } }, { sender: ME }));
  const again = normalizeThreads(JSON.parse(JSON.stringify(threads)));
  assert.equal(again[0].messages[1].ai, true);
  assert.equal(again[0].messages[0].ai, undefined);
});

test("a document from before the AI label (no ai field) round-trips unchanged", () => {
  const old = {
    format: "openfini", version: 1, id: "d1", name: "Old", dpi: 96, unit: "px", studio: "vector", createdAt: 1, modifiedAt: 2,
    pages: [{ id: "p_1", name: "Page 1", x: 0, y: 0, w: 400, h: 300, bg: "#ffffff", masterId: null, guides: { h: [], v: [] }, root: { id: "n_root", type: "group", name: "root", children: [] } }],
    masters: [], assets: [], stories: {}, styles: { paragraph: {}, character: {} }, swatches: [], slices: [], settings: {},
    comments: [{ id: "c9", author: ME, nick: "Mia", color: "#0090ff", ts: 5, anchor: { kind: "doc" }, resolved: false, messages: [{ id: "c9-0", author: ME, nick: "Mia", color: "#0090ff", text: "Hi", ts: 5 }] }],
  };
  const doc = Doc.fromJSON(migrateDocumentJson(JSON.parse(JSON.stringify(old))).json);
  const [th] = normalizeThreads(doc.comments);
  assert.equal(th.id, "c9");
  assert.equal(th.ai, undefined);
});
