// Whiteboard comments: anchoring (element and point), pins that follow elements (move, resize, rotate), deleted
// elements and undo, clustering, filters and unread marks, serialization through the document's comment threads and
// the room's comment ops (merge), and the Vibe description of a board anchor.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/office/board/model.js";
import * as C from "../../app/src/office/board/comments.js";
import { newThread, applyCommentOp, normalizeThreads } from "../../app/src/collab/comments.js";
import { validateThread } from "../../app/src/collab/protocol.js";
import { resolveTarget } from "../../app/src/collab/comment-context.js";

const ME = "AAAAAAAAAAAAAAAAAAAAAA";
const YOU = "BBBBBBBBBBBBBBBBBBBBBB";
const author = (id, nick = "Ann") => ({ id, nick, color: "#3b82f6" });
const board = () => {
  let m = M.emptyModel({ title: "T" });
  m = M.addElements(m, [M.makeElement("sticky", { id: "s1", x: 100, y: 100, w: 200, h: 200, text: "Ideas" }), M.makeElement("rect", { id: "r1", x: 500, y: 100, w: 100, h: 50 })]);
  return m;
};

test("element anchor: offset inside the box, pin at the click, quote from the text", () => {
  const m = board();
  const a = C.elementAnchor(m.elements.s1, { x: 250, y: 150 });
  assert.equal(a.kind, "item");
  assert.equal(a.item, "el:s1");
  assert.equal(a.page, "p1");
  assert.deepEqual(a.pin, { x: 250, y: 150 });
  assert.deepEqual(a.off, { x: 0.75, y: 0.25 });
  assert.equal(a.quote, "Ideas");
  assert.ok(C.isBoardAnchor(a));
  assert.equal(C.anchorElementId(a), "s1");
  // without a point: the top right corner
  assert.deepEqual(C.elementAnchor(m.elements.r1).off, { x: 1, y: 0 });
  // the protocol accepts it (saved files, room messages)
  const th = newThread({ id: "c1", anchor: a, author: author(ME), text: "Hi" });
  assert.equal(validateThread(th).ok, true);
});

test("point anchor sits on its page; old anchors without a pin use the top right corner", () => {
  const m = board();
  const p = C.pointAnchor("p1", { x: 10, y: 20 });
  assert.deepEqual(C.resolvePin(p, m), { x: 10, y: 20, page: "p1", attached: false, orphan: false });
  assert.equal(C.resolvePin(C.pointAnchor("nope", { x: 1, y: 1 }), m), null);
  const old = { kind: "item", item: "el:r1", quote: "r" };
  const pin = C.resolvePin(old, m);
  assert.equal(pin.x, 600);
  assert.equal(pin.y, 100);
  assert.equal(C.resolvePin({ kind: "item", item: "el:gone" }, m), null);
  assert.equal(C.resolvePin({ kind: "text", path: "[0]" }, m), null);
});

test("pins follow their element: move, resize and rotate", () => {
  let m = board();
  const a = C.elementAnchor(m.elements.s1, { x: 300, y: 300 }); // bottom right corner
  m = M.moveElements(m, ["s1"], 50, -20);
  assert.deepEqual(C.resolvePin(a, m), { x: 350, y: 280, page: "p1", attached: true, orphan: false });
  m = M.updateElements(m, { s1: M.resizeElement(m.elements.s1, { x: 150, y: 80, w: 400, h: 100 }) });
  const r = C.resolvePin(a, m);
  assert.equal(r.x, 550);
  assert.equal(r.y, 180);
  m = M.updateElements(m, { s1: { angle: Math.PI } }); // half a turn: the corner goes to the opposite side
  const q = C.resolvePin(a, m);
  assert.ok(Math.abs(q.x - 150) < 1e-6 && Math.abs(q.y - 80) < 1e-6);
  // a click on a rotated element keeps its spot on the element
  const b = C.elementAnchor(m.elements.s1, { x: 160, y: 85 });
  const back = C.resolvePin(b, m);
  assert.ok(Math.abs(back.x - 160) < 0.5 && Math.abs(back.y - 85) < 0.5);
});

test("deleting the element leaves the pin at its last place; undo re-attaches it", () => {
  const m0 = board();
  const a = C.elementAnchor(m0.elements.r1, { x: 550, y: 125 });
  const moved = M.moveElements(m0, ["r1"], 100, 0);
  const last = C.resolvePin(a, moved);
  const gone = M.removeElements(moved, ["r1"]);
  const orphan = C.resolvePin(a, gone, { lastKnown: { x: last.x, y: last.y } });
  assert.deepEqual(orphan, { x: 650, y: 125, page: "p1", attached: false, orphan: true });
  // without a session memory: the saved pin
  assert.deepEqual(C.resolvePin(a, gone), { x: 550, y: 125, page: "p1", attached: false, orphan: true });
  // undo restores the same element id: the pin follows it again
  assert.equal(C.resolvePin(a, moved).attached, true);
  assert.deepEqual(C.anchorLabel(a, gone), ["Deleted element “{name}”", { name: "rect" }]);
  assert.deepEqual(C.anchorLabel(a, moved), ["{type}", { type: "rect" }]);
});

test("clustering groups pins that overlap on screen, more when zoomed out", () => {
  const pins = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 400, y: 0 }];
  assert.equal(C.clusterPins(pins, { zoom: 1, radius: 24 }).length, 2);
  assert.equal(C.clusterPins(pins, { zoom: 4, radius: 24 }).length, 3);
  const far = C.clusterPins(pins, { zoom: 0.05, radius: 24 });
  assert.equal(far.length, 1);
  assert.equal(far[0].items.length, 3);
  assert.ok(Math.abs(far[0].x - 140) < 1e-9);
});

test("filters: status, mine, search, page; unread marks", () => {
  let m = board();
  m = M.addPage(m, { name: "Two" }).model;
  const p2 = m.pages[1].id;
  const t1 = newThread({ id: "c1", anchor: C.elementAnchor(m.elements.s1), author: author(ME), text: "Group by theme", ts: 1000 });
  const t2 = newThread({ id: "c2", anchor: C.pointAnchor(p2, { x: 0, y: 0 }), author: author(YOU, "Bo"), text: "Second page", ts: 2000 });
  const t3 = newThread({ id: "c3", anchor: { kind: "text", path: "[0]", from: 0, to: 1 }, author: author(ME), text: "not a board comment", ts: 3000 });
  const all = [t1, t2, t3];
  applyCommentOp(all, { op: "resolve", threadId: "c2", text: "Bo" }, { sender: YOU });
  assert.deepEqual(C.filterBoardThreads(all, { status: "open" }).map((t) => t.id), ["c1"]);
  assert.deepEqual(C.filterBoardThreads(all, { status: "all" }).map((t) => t.id), ["c1", "c2"]);
  assert.deepEqual(C.filterBoardThreads(all, { status: "all", mine: YOU }).map((t) => t.id), ["c2"]);
  assert.deepEqual(C.filterBoardThreads(all, { status: "all", query: "THEME" }).map((t) => t.id), ["c1"]);
  assert.deepEqual(C.filterBoardThreads(all, { status: "all", query: "ideas" }).map((t) => t.id), ["c1"]); // the anchor quote
  assert.deepEqual(C.filterBoardThreads(all, { status: "all", page: p2, model: m }).map((t) => t.id), ["c2"]);
  // unread: someone else's message after my last look
  assert.equal(C.isUnread(t1, 0, ME), false); // only my own message
  assert.equal(C.isUnread(t2, 0, ME), true);
  assert.equal(C.isUnread(t2, 5000, ME), false);
  applyCommentOp(all, { op: "reply", threadId: "c1", msg: { id: "m2", author: YOU, nick: "Bo", text: "ok", ts: 6000 } }, { sender: YOU });
  assert.equal(C.isUnread(t1, 5000, ME), true);
  assert.equal(C.threadLastActivity(t1), 6000);
});

test("threads round-trip through the document (normalize) and merge from the room in any order", () => {
  const m = board();
  const a = C.elementAnchor(m.elements.s1, { x: 120, y: 130 });
  const th = newThread({ id: "c1", anchor: a, author: author(ME), text: "Hello", ts: 1 });
  const saved = JSON.parse(JSON.stringify([th]));
  const back = normalizeThreads(saved);
  assert.deepEqual(back[0].anchor, a);
  // two replicas receive the same ops in different orders: same result; ops are idempotent
  const ops = [
    [{ op: "add", thread: th }, ME],
    [{ op: "reply", threadId: "c1", msg: { id: "m1", author: YOU, nick: "Bo", text: "Re", ts: 2 } }, YOU],
    [{ op: "reanchor", threadId: "c1", anchor: C.pointAnchor("p1", { x: 5, y: 5 }) }, ME],
  ];
  const r1 = [];
  for (const [op, s] of ops) applyCommentOp(r1, op, { sender: s });
  const r2 = [];
  applyCommentOp(r2, ops[0][0], { sender: ME });
  applyCommentOp(r2, ops[2][0], { sender: ME });
  applyCommentOp(r2, ops[1][0], { sender: YOU });
  applyCommentOp(r2, ops[1][0], { sender: YOU }); // duplicate delivery
  assert.deepEqual(r1, r2);
  assert.equal(r1[0].messages.length, 2);
  assert.equal(r1[0].anchor.item, "pt:p1");
  // only the author (or the host) moves a pin
  assert.equal(applyCommentOp(r1, { op: "reanchor", threadId: "c1", anchor: a }, { sender: YOU }), false);
  // comments are not board records (they travel as comment ops; no double sync)
  assert.ok(Object.keys(M.boardRecords(m)).every((k) => !k.startsWith("comment")));
});

test("Vibe: a board anchor resolves to the element or point it points at", () => {
  let m = board();
  const a = C.elementAnchor(m.elements.s1, { x: 150, y: 150 });
  const d = C.describeBoardAnchor(a, m);
  assert.equal(d.exists, true);
  assert.equal(d.elementId, "s1");
  assert.equal(d.elementType, "sticky");
  assert.equal(d.text, "Ideas");
  assert.deepEqual(d.point, { x: 150, y: 150 });
  m = M.removeElements(m, ["s1"]);
  assert.equal(C.describeBoardAnchor(a, m).exists, false);
  assert.equal(C.describeBoardAnchor({ kind: "doc" }, m), null);
  const tgt = resolveTarget(a, { officeItem: (x) => C.describeBoardAnchor(x, board()) });
  assert.equal(tgt.type, "item");
  assert.equal(tgt.elementId, "s1");
  // without the board env the generic description stays
  assert.equal(resolveTarget(a, {}).note.startsWith("An item"), true);
});
