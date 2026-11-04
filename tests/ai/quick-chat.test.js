import test from "node:test";
import assert from "node:assert/strict";
import { chatTitle, canvasTarget, officeAppTarget } from "../../app/src/vibe/quick-actions.js";
import { rememberInstruction, loadHistory, HISTORY_MAX } from "../../app/src/ui/vibe/custom-instruction.js";

const app = (sel = []) => ({ studio: "vector", doc: { id: "d1", name: "Poster", studio: "vector", pages: [{ root: { children: [1] } }] }, page: { id: "p1", name: "Page 1" }, selection: sel });

test("right-click chats get a clear title and a target that points back", () => {
  const tg = canvasTarget(app([{ id: "n1", type: "text", name: "Headline" }]));
  assert.equal(tg.kind, "text");
  assert.deepEqual(tg.ids, ["n1"]);
  assert.equal(tg.docId, "d1");
  assert.equal(chatTitle("Rewrite", tg), "Rewrite · Headline");
  const many = canvasTarget(app([{ id: "a", type: "rect" }, { id: "b", type: "text" }]));
  assert.equal(many.kind, "layers");
  assert.equal(many.label, "2 layers");
  assert.equal(canvasTarget(app()).kind, "page");
  assert.ok(chatTitle("x".repeat(80), tg).length <= 60);
});

test("spreadsheet ranges become A1 targets", () => {
  const view = { range: { r0: 1, c0: 0, r1: 3, c1: 27 }, sid: "s1", sheet: { name: "Budget" } };
  const { target, extra } = officeAppTarget(app(), "office-sheet", { view });
  assert.equal(target.label, "Budget!A2:AB4");
  assert.match(extra, /sheet_read_range/);
});

test("custom instruction history is most-recent-first, unique and bounded", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  for (let i = 0; i < HISTORY_MAX + 3; i++) rememberInstruction(`p${i}`, storage);
  rememberInstruction("p5", storage);
  const h = loadHistory(storage);
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[0], "p5");
  assert.equal(h.filter((x) => x === "p5").length, 1);
});
