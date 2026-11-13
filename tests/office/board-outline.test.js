// Whiteboard sidebar outline: rows (top-most first, frames with their children), search, z-order drag and drop,
// hidden elements (not hit, not exported) and names.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/office/board/model.js";
import { boardOutline, moveInZOrder } from "../../app/src/office/board/outline.js";
import { pageDisplayList } from "../../app/src/office/board/render.js";

const board = () => {
  let m = M.emptyModel({ title: "T" });
  m = M.addElements(m, [
    M.makeElement("frame", { id: "f1", x: 0, y: 0, w: 400, h: 400, name: "Themes" }),
    M.makeElement("sticky", { id: "a", x: 20, y: 20, text: "Alpha" }),
    M.makeElement("sticky", { id: "b", x: 200, y: 20, text: "Beta" }),
    M.makeElement("rect", { id: "c", x: 600, y: 0, w: 100, h: 100 }),
  ]);
  return M.assignFrames(m, ["a", "b"]);
};
const order = (m) => M.pageElements(m, "p1").map((e) => e.id);

test("outline lists the page top-most first, frame children under their frame", () => {
  const rows = boardOutline(board(), "p1");
  assert.deepEqual(rows.map((r) => [r.id, r.depth]), [["c", 0], ["f1", 0], ["b", 1], ["a", 1]]);
  assert.equal(rows[1].label, "Themes");
  assert.equal(rows[0].label, ""); // the UI shows the type name
});

test("outline search keeps matches and the frames that contain them", () => {
  const rows = boardOutline(board(), "p1", { query: "beta" });
  assert.deepEqual(rows.map((r) => r.id), ["f1", "b"]);
  assert.equal(rows[1].match, true);
  assert.deepEqual(boardOutline(board(), "p1", { query: "rect" }).map((r) => r.id), ["c"]);
  assert.deepEqual(boardOutline(board(), "p1", { query: "zzz" }), []);
});

test("drag and drop: above puts elements in front of the target, below behind it", () => {
  const m = board();
  assert.deepEqual(order(m), ["f1", "a", "b", "c"]);
  const m1 = moveInZOrder(m, ["a"], "c", "above");
  assert.deepEqual(order(m1), ["f1", "b", "c", "a"]);
  const m2 = moveInZOrder(m, ["c"], "f1", "below");
  assert.deepEqual(order(m2), ["c", "f1", "a", "b"]);
  const m3 = moveInZOrder(m, ["a", "c"], "f1", "above"); // several keep their order
  assert.deepEqual(order(m3), ["f1", "a", "c", "b"]);
  assert.equal(moveInZOrder(m, ["a"], "a", "above"), m);
  assert.equal(moveInZOrder(m, ["a"], "missing", "above"), m);
});

test("hidden elements are not hit, not marquee-selected and not exported; names label rows", () => {
  let m = board();
  m = M.updateElements(m, { c: { hidden: true, name: "Legend" } });
  assert.equal(M.elementAt(m, "p1", 650, 50), null);
  assert.ok(!M.elementsInRect(m, "p1", { x: -10, y: -40, w: 800, h: 500 }).some((e) => e.id === "c"));
  const dl = pageDisplayList(m, "p1", { measure: (s, z) => s.length * z * 0.5 });
  assert.ok(dl.width < 500, "the hidden rectangle does not widen the export");
  const row = boardOutline(m, "p1").find((r) => r.id === "c");
  assert.equal(row.hidden, true);
  assert.equal(row.label, "Legend");
  // names survive a save/load (normalize) and the collaboration records
  const back = M.normalizeBoard(JSON.parse(JSON.stringify({ ...m, media: {} })));
  assert.equal(back.elements.c.name, "Legend");
  assert.equal(back.elements.c.hidden, true);
  const applied = M.applyBoardRecords(M.emptyModel(), M.boardRecords(m));
  assert.equal(applied.elements.c.hidden, true);
});
