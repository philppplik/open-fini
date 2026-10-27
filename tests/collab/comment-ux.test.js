import test from "node:test";
import assert from "node:assert/strict";
import { canvasAnchor, resolvePin, moveAnchor, codeAnchor, codeRange, officeAnchor, elementAnchor, pinNumbers, stepThread, popoverPosition } from "../../app/src/collab/anchors.js";
import { validateThread } from "../../app/src/collab/protocol.js";
import { layoutMode, clampRect, snapRect, maximizedRect, readLayoutState } from "../../app/src/ui/collab/layout-mode.js";
import { isUiMessage, validateAction, makeSnapshot, readSnapshot } from "../../app/src/collab/remote-ui.js";

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
  const r = clampRect({ x: -50, y: 900, w: 100, h: 9999 }, { vw: 1000, vh: 800 });
  assert.deepEqual(r, { x: 0, y: 16, w: 300, h: 784 });
  assert.equal(snapRect({ x: 5, y: 100, w: 300, h: 300 }, { vw: 1000, vh: 800 }).edge, "left");
  assert.equal(snapRect({ x: 690, y: 100, w: 300, h: 300 }, { vw: 1000, vh: 800 }).rect.x, 700);
  assert.equal(snapRect({ x: 200, y: 200, w: 300, h: 300 }, { vw: 1000, vh: 800 }).edge, null);
  assert.deepEqual(maximizedRect({ vw: 1000, vh: 800 }), { x: 8, y: 8, w: 984, h: 784 });
  assert.deepEqual(readLayoutState({ x: "a", w: 400, h: 500, dock: "evil", compact: true }), { w: 400, h: 500, maximized: false, compact: true, dock: "float" });
  assert.equal(readLayoutState(null).dock, "float");
});

test("pop-out remote view protocol: whitelist and bounded snapshots", () => {
  assert.equal(isUiMessage({ t: "hello", pid: "p1" }), true);
  assert.equal(isUiMessage({ t: "evil" }), false);
  assert.equal(isUiMessage(null), false);
  assert.deepEqual(validateAction({ name: "chat.send", args: { text: "  hi  " } }), { ok: true, action: { name: "chat.send", args: { text: "hi" } } });
  assert.equal(validateAction({ name: "chat.send", args: { text: "  " } }).ok, false);
  assert.equal(validateAction({ name: "leave" }).ok, false);
  assert.equal(validateAction({ name: "constructor" }).ok, false);
  assert.equal(validateAction({ name: "comment.reply", args: { thread: "../x", text: "a" } }).ok, false);
  assert.equal(validateAction({ name: "comment.resolve", args: { thread: "t1", on: false } }).action.args.on, false);
  const s = makeSnapshot({ status: { inRoom: true, state: "open", members: 2 }, me: { id: "m1", nick: "A", color: "bad" }, members: [{ id: "m2", nick: "B", color: "#abcdef" }], chat: Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, text: "x".repeat(9000), ts: i })), unread: 3, doc: { id: "d", name: "Doc" }, threads: [], inviteCode: "SECRET" });
  assert.equal(s.chat.length, 120);
  assert.equal(s.chat[0].text.length, 4000);
  assert.equal(s.me.color, "#888888");
  assert.equal(JSON.stringify(s).includes("SECRET"), false);
  assert.equal(readSnapshot(null), null);
});
