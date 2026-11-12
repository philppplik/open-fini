import test from "node:test";
import assert from "node:assert/strict";
import { canvasAnchor, resolvePin, moveAnchor, codeAnchor, codeRange, officeAnchor, elementAnchor, pinNumbers, stepThread, popoverPosition } from "../../app/src/collab/anchors.js";
import { validateThread, validateMessage } from "../../app/src/collab/protocol.js";
import { applyCommentOp, newThread } from "../../app/src/collab/comments.js";
import { layoutMode } from "../../app/src/ui/collab/layout-mode.js";

const author = { id: "m1m1m1m1m1m1m1m1m1m1m1", nick: "Ann", color: "#112233" };
const thread = (anchor) => ({ id: "t1", anchor, author: author.id, nick: "Ann", color: "#112233", ts: 1, messages: [{ id: "a1", author: author.id, text: "hi", ts: 1 }] });

test("canvas anchor stores the layer offset and the page point", () => {
  const a = canvasAnchor({ pageId: "p1", node: { id: "n1", name: "Logo" }, bounds: { x: 100, y: 50, w: 200, h: 100 }, point: { x: 150, y: 100 } });
  assert.equal(a.kind, "node");
  assert.deepEqual(a.off, { x: 0.25, y: 0.5 });
  assert.deepEqual(a.pin, { x: 150, y: 100 });
  assert.equal(validateThread(thread(a)).ok, true);
  // the layer moved: the pin follows it
  assert.deepEqual(resolvePin(a, { bounds: { x: 300, y: 50, w: 200, h: 100 } }), { x: 350, y: 100 });
  // the layer is gone: the pin stays on the page
  assert.deepEqual(resolvePin(a, {}), { x: 150, y: 100 });
});

test("canvas anchor without a layer is a region pin; old node anchors still resolve", () => {
  const a = canvasAnchor({ pageId: "p1", point: { x: 10.123, y: 5 } });
  assert.equal(a.kind, "region");
  assert.deepEqual(resolvePin(a), { x: 10.12, y: 5 });
  assert.deepEqual(resolvePin({ kind: "node", node: "n", page: "p" }, { bounds: { x: 1, y: 2, w: 3, h: 4 } }), { x: 4, y: 2 });
  assert.equal(resolvePin({ kind: "node", node: "n" }, {}), null);
  const moved = moveAnchor(a, { point: { x: 40, y: 40 } });
  assert.deepEqual(moved.pin, { x: 40, y: 40 });
});

test("code anchors: caret, range, offsets", () => {
  const lines = { 1: { from: 0, to: 10 }, 2: { from: 11, to: 20 }, 3: { from: 21, to: 30 } };
  const lineAt = (n) => lines[n] || null;
  const caret = codeAnchor({ path: "a.js", from: { line: 2, col: 3 } });
  assert.equal(caret.endLine, undefined);
  assert.deepEqual(codeRange(caret, lineAt), { from: 11, to: 20, whole: true });
  const range = codeAnchor({ path: "a.js", from: { line: 3, col: 2 }, to: { line: 1, col: 4 } });
  assert.deepEqual([range.line, range.col, range.endLine, range.endCol], [1, 4, 3, 2]);
  assert.deepEqual(codeRange(range, lineAt), { from: 4, to: 23, whole: false });
  assert.equal(codeRange({ kind: "line", line: 99 }, lineAt), null);
  assert.equal(validateThread(thread(range)).ok, true);
});

test("office and element anchors validate", () => {
  const o = officeAnchor({ path: [0, 2], from: 3, to: 9, quote: "text" });
  assert.equal(o.path, "[0,2]");
  assert.equal(validateThread(thread(o)).ok, true);
  const e = elementAnchor({ elem: "hero", box: { x: 0, y: 0, w: 100, h: 50 }, point: { x: 50, y: 25 } });
  assert.deepEqual(e.off, { x: 0.5, y: 0.5 });
  assert.equal(validateThread(thread(e)).ok, true);
  assert.equal(validateThread(thread({ kind: "script" })).ok, false);
});

test("pin numbers, stepping and popover placement", () => {
  const ts = [{ id: "b", ts: 2 }, { id: "a", ts: 1 }, { id: "c", ts: 3 }];
  const n = pinNumbers(ts);
  assert.deepEqual([n.get("a"), n.get("b"), n.get("c")], [1, 2, 3]);
  assert.equal(stepThread(["a", "b", "c"], "c", 1), "a");
  assert.equal(stepThread(["a", "b", "c"], "a", -1), "c");
  assert.equal(stepThread(["a", "b"], null, -1), "b");
  assert.equal(stepThread([], null), null);
  const p = popoverPosition({ x: 900, y: 700, w: 300, h: 200, vw: 1000, vh: 800 });
  assert.ok(p.left + 300 <= 992 && p.top + 200 <= 792 && p.flipped);
});

test("responsive layout decisions", () => {
  assert.equal(layoutMode(380), "narrow");
  assert.equal(layoutMode(519), "narrow");
  assert.equal(layoutMode(520), "rail");
  assert.equal(layoutMode(899), "rail");
  assert.equal(layoutMode(900), "wide");
  assert.equal(layoutMode(NaN), "narrow");
});

// The Collaboration window's protocol and model: tests/collab/remote-ui.test.js

test("new anchors travel in comment ops; reanchor is limited to the author or the host", () => {
  const anchor = canvasAnchor({ pageId: "p1", node: { id: "n1", name: "Logo" }, bounds: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 5, y: 5 } });
  const th = newThread({ id: "t9", anchor, author, text: "look", ts: 5 });
  assert.equal(validateMessage({ t: "comment", ts: 1, doc: "d1", op: { op: "add", thread: th } }).ok, true);
  const moved = moveAnchor(anchor, { point: { x: 90, y: 90 } });
  assert.equal(validateMessage({ t: "comment", ts: 1, doc: "d1", op: { op: "reanchor", threadId: "t9", anchor: moved } }).ok, true);
  const threads = [th];
  const other = "o2o2o2o2o2o2o2o2o2o2o2";
  assert.equal(applyCommentOp(threads, { op: "reanchor", threadId: "t9", anchor: moved }, { sender: other }), false);
  assert.equal(applyCommentOp(threads, { op: "reanchor", threadId: "t9", anchor: moved }, { sender: author.id }), true);
  assert.deepEqual(threads[0].anchor.pin, { x: 90, y: 90 });
  assert.equal(applyCommentOp(threads, { op: "reanchor", threadId: "t9", anchor }, { sender: other, isHost: true }), true);
});
