// Tool math of the Proto Studio (task T4): handles, resizing, rotation, constraints, drawing, auto layout insertion,
// padding and gap handles, grid tracks and text runs (app/src/proto/tools/math.js), and the operations the tools and
// panels build (app/src/proto/tools/edit.js), applied through the real operation layer.
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../app/src/engine/proto/schema.js";
import { apply, applyAll } from "../../app/src/engine/proto/ops.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { children } from "../../app/src/engine/proto/tree.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import * as M from "../../app/src/proto/tools/math.js";
import * as E from "../../app/src/proto/tools/edit.js";

const R = (x, y, w, h) => ({ x, y, w, h });

test("handles: points, hits, rotate zones and cursors", () => {
  const r = R(0, 0, 100, 50);
  assert.deepEqual(M.handlePoints(r).map((p) => p.id), M.HANDLES);
  assert.equal(M.hitHandle(r, 1, 1), "nw");
  assert.equal(M.hitHandle(r, 100, 50), "se");
  assert.equal(M.hitHandle(r, 50, 0), "n");
  assert.equal(M.hitHandle(r, 100, 25), "e");
  assert.equal(M.hitHandle(r, 50, 25), null);
  assert.equal(M.hitHandle(r, 112, 60), "rot-se");
  assert.equal(M.hitHandle(r, 112, 60, 5, { rotate: false }), null);
  assert.equal(M.cursorFor("e"), "ew-resize");
  assert.equal(M.cursorFor("e", 90), "ns-resize");
  assert.equal(M.cursorFor("nw"), "nwse-resize");
  assert.equal(M.cursorFor("rot-ne"), "crosshair");
});

test("resizeRect: edges, corners, ratio, center, flip and minimum", () => {
  assert.deepEqual(M.resizeRect(R(0, 0, 100, 50), "e", 20, 99), R(0, 0, 120, 50));
  assert.deepEqual(M.resizeRect(R(0, 0, 100, 50), "nw", 10, 10), R(10, 10, 90, 40));
  assert.deepEqual(M.resizeRect(R(0, 0, 100, 50), "se", 100, 0, { ratio: true }), R(0, 0, 200, 100));
  assert.deepEqual(M.resizeRect(R(0, 0, 100, 50), "e", 10, 0, { center: true }), R(-10, 0, 120, 50));
  assert.deepEqual(M.resizeRect(R(0, 0, 100, 50), "e", -150, 0), R(-50, 0, 50, 50)); // flipped across the left edge
  assert.deepEqual(M.resizeRect(R(0, 0, 100, 50), "e", -100, 0), R(0, 0, 1, 50));
  const s = M.resizeRect(R(0, 0, 100, 50), "s", 0, 50, { ratio: true });
  assert.deepEqual(s, R(-50, 0, 200, 100));
});

test("rotation: angle around the center, 15 degree snapping, normalized", () => {
  const c = { x: 0, y: 0 };
  assert.equal(M.rotationAt(c, { x: 10, y: 0 }, { x: 0, y: 10 }, 0), 90);
  assert.equal(M.rotationAt(c, { x: 10, y: 0 }, { x: 10, y: 1 }, 0, { snap: true }), 0);
  assert.equal(M.rotationAt(c, { x: 10, y: 0 }, { x: -10, y: -1 }, 30), -144.29);
  assert.equal(M.snapAngle(52), 45);
});

test("applyConstraints: every horizontal and vertical constraint", () => {
  const from = { w: 200, h: 100 };
  const to = { w: 300, h: 50 };
  const c = { x: 20, y: 10, w: 40, h: 20 };
  assert.deepEqual(M.applyConstraints({ ...c, cx: "left", cy: "top" }, from, to), { x: 20, y: 10, w: 40, h: 20 });
  assert.deepEqual(M.applyConstraints({ ...c, cx: "right", cy: "bottom" }, from, to), { x: 120, y: -40, w: 40, h: 20 });
  assert.deepEqual(M.applyConstraints({ ...c, cx: "leftRight", cy: "topBottom" }, from, to), { x: 20, y: 10, w: 140, h: 0 });
  assert.deepEqual(M.applyConstraints({ ...c, cx: "center", cy: "center" }, from, to), { x: 70, y: -15, w: 40, h: 20 });
  assert.deepEqual(M.applyConstraints({ ...c, cx: "scale", cy: "scale" }, from, to), { x: 30, y: 5, w: 60, h: 10 });
  assert.deepEqual(M.scaleInto(R(10, 10, 10, 10), R(0, 0, 100, 100), R(0, 0, 200, 50)), R(20, 5, 20, 5));
});

test("drawing: rects from drags, squares, from the center, lines", () => {
  assert.deepEqual(M.dragRect(10, 10, 0, 30), R(0, 10, 10, 20));
  assert.deepEqual(M.dragRect(0, 0, 10, 30, { square: true }), R(0, 0, 30, 30));
  assert.deepEqual(M.dragRect(50, 50, 60, 55, { center: true }), R(40, 45, 20, 10));
  const l = M.lineFrom(0, 0, 100, 0);
  assert.deepEqual([l.x, l.y, l.w, l.rot], [0, 0, 100, 0]);
  const d = M.lineFrom(0, 0, 0, 100);
  assert.deepEqual([d.x, d.y, d.w, d.rot], [-50, 50, 100, 90]);
  const s = M.lineFrom(0, 0, 100, 10, { snap: true });
  assert.equal(s.rot, 0);
  assert.equal(M.lineFrom(0, 0, 100, 90, { snap: true }).rot, 45);
});

test("insertionAt: the index and marker in a row and a column", () => {
  const row = [R(0, 0, 50, 20), R(60, 0, 50, 20), R(120, 0, 50, 20)];
  assert.equal(M.insertionAt(row, { x: 10, y: 5 }, "row").index, 0);
  assert.equal(M.insertionAt(row, { x: 40, y: 5 }, "row").index, 1);
  const end = M.insertionAt(row, { x: 500, y: 5 }, "row");
  assert.equal(end.index, 3);
  assert.deepEqual(end.line, { x: 170, y: 0, w: 0, h: 20 });
  assert.deepEqual(M.insertionAt(row, { x: 70, y: 0 }, "row").line, { x: 55, y: 0, w: 0, h: 20 });
  const col = [R(0, 0, 50, 20), R(0, 30, 50, 20)];
  assert.equal(M.insertionAt(col, { x: 0, y: 26 }, "column").index, 1);
  assert.equal(M.insertionAt([], { x: 0, y: 0 }).index, 0);
});

test("padding and gap handles, dragging padding", () => {
  const p = M.padHandles(R(0, 0, 100, 80), [10, 20, 30, 40]);
  assert.deepEqual(p.map((h) => h.side), ["top", "right", "bottom", "left"]);
  assert.deepEqual(p[1].area, R(80, 0, 20, 80));
  assert.deepEqual(p[2].area, R(0, 50, 100, 30));
  const g = M.gapHandles([R(0, 0, 20, 20), R(30, 0, 20, 40)], "row");
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].area, R(20, 0, 10, 40));
  assert.deepEqual(M.gapHandles([R(0, 0, 20, 20), R(0, 24, 20, 20)], "column")[0].area, R(0, 20, 20, 4));
  assert.deepEqual(M.dragPad([10, 10, 10, 10], 1, 5.4), [10, 15, 10, 10]);
  assert.deepEqual(M.dragPad([10, 10, 10, 10], 0, -20), [0, 10, 10, 10]);
  assert.deepEqual(M.dragPad([10, 10, 10, 10], 0, 6, { all: true }), [16, 16, 16, 16]);
  assert.deepEqual(M.dragPad([10, 12, 10, 10], 1, 4, { mirror: true }), [10, 16, 10, 16]);
});

test("size modes, direction guess and grid tracks", () => {
  assert.equal(M.nextSizeMode("hug"), "fill");
  assert.equal(M.nextSizeMode("fill"), "fixed");
  assert.equal(M.nextSizeMode("fixed", { fill: false }), "hug");
  assert.equal(M.guessDirection([R(0, 0, 10, 10), R(100, 5, 10, 10)]), "row");
  assert.equal(M.guessDirection([R(0, 0, 10, 10), R(5, 100, 10, 10)]), "column");
  assert.deepEqual(M.parseTracks("1fr 240px auto minmax(200px, 1fr) 16"), [{ fr: 1 }, { px: 240 }, { auto: true }, { minmax: [200, { fr: 1 }] }, { px: 16 }]);
  assert.deepEqual(M.parseTracks("repeat(3, 1fr)"), [{ fr: 1 }, { fr: 1 }, { fr: 1 }]);
  assert.equal(M.parseTracks("1fr banana"), null);
  assert.equal(M.formatTracks([{ fr: 1 }, { px: 240 }, { auto: true }, { minmax: [200, { fr: 1 }] }]), "1fr 240px auto minmax(200px, 1fr)");
  assert.deepEqual(M.parseTracks(M.formatTracks([{ fr: 2 }, { minmax: [{ auto: true }, 300] }])), [{ fr: 2 }, { minmax: [{ auto: true }, 300] }]);
});

test("editRuns keeps the styles of unchanged text", () => {
  const runs = [{ t: "Total ", s: {} }, { t: "$42.00", s: { weight: 700 } }];
  assert.equal(M.editRuns(runs, "Total $42.00"), runs);
  assert.deepEqual(M.editRuns(runs, "Total $43.00"), [runs[0], { t: "$43.00", s: { weight: 700 } }]);
  assert.deepEqual(M.editRuns(runs, "Sum $42.00"), [{ t: "Sum ", s: {} }, runs[1]]);
  assert.deepEqual(M.editRuns(runs, "Total: $42.00"), [{ t: "Total: ", s: {} }, runs[1]]);
  assert.deepEqual(M.editRuns(runs, "Total $42.00 net"), [runs[0], { t: "$42.00 net", s: { weight: 700 } }]);
  assert.deepEqual(M.editRuns(runs, "Total"), [{ t: "Total", s: {} }]);
  assert.deepEqual(M.editRuns(runs, ""), [{ t: "", s: {} }]);
  assert.deepEqual(M.editRuns([], "Hi"), [{ t: "Hi", s: {} }]);
});

// ------------------------------------------------------------------------------------------------- operations

const PAGE = "p1";
function design() {
  return applyAll(S.emptyDocument({ title: "T", created: "2026-01-01T00:00:00Z", pageId: PAGE }), [
    {
      op: "node.create", type: "frame", page: PAGE, id: "nF", fields: { name: "F", w: { mode: "fixed", value: 200 }, h: { mode: "fixed", value: 100 } },
      children: [
        { type: "rect", id: "nL", fields: { x: 10, y: 10, w: { mode: "fixed", value: 20 }, h: { mode: "fixed", value: 20 } } },
        { type: "rect", id: "nR", fields: { x: 170, y: 10, cx: "right", w: { mode: "fixed", value: 20 }, h: { mode: "fixed", value: 20 } } },
        { type: "rect", id: "nS", fields: { x: 10, y: 50, cx: "leftRight", cy: "bottom", w: { mode: "fixed", value: 180 }, h: { mode: "fixed", value: 40 } } },
      ],
    },
    { op: "node.create", type: "frame", page: PAGE, id: "nG", fields: { name: "G", x: 400, layout: { type: "flex", dir: "row", gap: 8, pad: [0, 0, 0, 0] } }, children: [{ type: "rect", id: "nG1" }, { type: "rect", id: "nG2" }, { type: "text", id: "nT" }] },
  ]).model;
}
const run = (m, op) => {
  const res = apply(m, op);
  assert.equal(validate(res.model).ok, true, JSON.stringify(validate(res.model).errors));
  return res.model;
};
/** World boxes from the stored positions and fixed sizes (what the geometry cache measures on the canvas). */
const boxes = (m) => (id) => {
  const n = m.nodes[id];
  const p = n.parent ? boxes(m)(n.parent) : { x: 0, y: 0 };
  return { x: p.x + (n.x ?? 0), y: p.y + (n.y ?? 0), w: E.fixedSize(n, "w") ?? 50, h: E.fixedSize(n, "h") ?? 20 };
};

test("moveBy moves absolute layers, leaves flow children alone, and is one step", () => {
  const m = design();
  const op = E.moveBy(m, ["nL", "nG1"], 5, -3);
  assert.equal(op.op, "node.update");
  const m2 = run(m, op);
  assert.deepEqual([m2.nodes.nL.x, m2.nodes.nL.y], [15, 7]);
  assert.equal(E.moveBy(m, ["nG1"], 5, 5), null);
});

test("resizeTo: the layer gets fixed sizes and its children follow their constraints", () => {
  const m = design();
  const op = E.resizeTo(m, "nF", { x: 0, y: 0, w: 300, h: 150 }, { from: { w: 200, h: 100 } });
  const m2 = run(m, op);
  assert.equal(m2.nodes.nF.w.value, 300);
  assert.equal(m2.nodes.nL.x, 10);
  assert.equal(m2.nodes.nR.x, 270);
  assert.equal(m2.nodes.nS.w.value, 280);
  assert.equal(m2.nodes.nS.y, 100);
  // undo restores everything in one inverse
  const back = apply(m, op);
  assert.deepEqual(apply(back.model, back.inverse).model.nodes, m.nodes);
  // a text layer resized in width wraps
  const t = run(m, E.resizeTo(m, "nT", { x: 0, y: 0, w: 120, h: 24 }, { from: { w: 30, h: 24 } }));
  assert.equal(t.nodes.nT.text.autoSize, "height");
  assert.deepEqual(t.nodes.nT.w, { mode: "fixed", value: 120 });
});

test("sizeMode, setFields and editText", () => {
  const m = design();
  const m2 = run(m, E.sizeMode(m, ["nG1"], "w", "fill"));
  assert.deepEqual(m2.nodes.nG1.w, { mode: "fill" });
  const m3 = run(m2, E.sizeMode(m2, ["nG1"], "w", "fixed", () => ({ w: 77, h: 10 })));
  assert.deepEqual(m3.nodes.nG1.w, { mode: "fixed", value: 77 });
  const m4 = run(m, E.sizeMode(m, ["nT"], "w", "fixed", () => ({ w: 40, h: 10 })));
  assert.equal(m4.nodes.nT.text.autoSize, "height");
  assert.equal(E.setFields(m, ["nL", "nR"], { opacity: 1 }), null);
  const op = E.setFields(m, ["nL", "nR"], { opacity: 0.5 });
  assert.equal(op.op, "batch");
  const m5 = run(m, E.editText(m, "nT", "Hello"));
  assert.equal(E.plainText(m5.nodes.nT), "Hello");
  assert.equal(E.editText(m5, "nT", "Hello"), null);
});

test("autoLayout turns a frame into a flex container, removeAutoLayout keeps places", () => {
  let m = design();
  const box = (id) => ({ nF: R(0, 0, 200, 100), nL: R(10, 10, 20, 20), nR: R(170, 10, 20, 20), nS: R(10, 50, 180, 40) })[id] || null;
  const op = E.autoLayout(m, ["nF"], "flex", box);
  m = run(m, op);
  const f = m.nodes.nF;
  assert.equal(f.layout.type, "flex");
  assert.equal(f.layout.dir, "row");
  assert.deepEqual(f.layout.pad, [10, 10, 10, 10]);
  assert.deepEqual(f.w, { mode: "hug" });
  assert.deepEqual(children(m, "nF"), ["nL", "nS", "nR"]);
  assert.ok(children(m, "nF").every((id) => m.nodes[id].pos === "flow"));
  m = run(m, E.removeAutoLayout(m, "nF", box));
  assert.equal(m.nodes.nF.layout.type, "none");
  assert.equal(m.nodes.nR.x, 170);
  assert.equal(m.nodes.nR.pos, "abs");
  // several siblings are wrapped
  const w = E.autoLayout(design(), ["nL", "nR"], "flex");
  assert.equal(w.op, "node.wrap");
  const g = run(design(), E.autoLayout(design(), ["nF"], "grid", box));
  assert.equal(g.nodes.nF.layout.type, "grid");
});

test("group, ungroup, reorder and reparent", () => {
  let m = design();
  m = run(m, E.group(m, ["nL", "nR"]));
  const g = children(m, "nF").find((id) => m.nodes[id].name === "Group");
  assert.ok(g);
  const box = (id) => ({ [g]: R(10, 10, 180, 20), nL: R(10, 10, 20, 20), nR: R(170, 10, 20, 20), nF: R(0, 0, 200, 100) })[id] || null;
  m = run(m, E.ungroup(m, g, box));
  assert.equal(m.nodes[g], undefined);
  assert.deepEqual([m.nodes.nR.x, m.nodes.nR.y], [170, 10]);
  m = design();
  assert.deepEqual(children(run(m, E.reorder(m, ["nL"], "front")), "nF"), ["nR", "nS", "nL"]);
  assert.deepEqual(children(run(m, E.reorder(m, ["nS"], "back")), "nF"), ["nS", "nL", "nR"]);
  assert.deepEqual(children(run(m, E.reorder(m, ["nL"], "forward")), "nF"), ["nR", "nL", "nS"]);
  assert.deepEqual(children(run(m, E.reorder(m, ["nS"], "backward")), "nF"), ["nL", "nS", "nR"]);
  assert.equal(E.reorder(m, ["nS"], "forward"), null);
  // into the flex frame: becomes a flow child; out to the page: keeps its world position
  const m2 = run(m, E.reparent(m, ["nL"], "nG", { index: 1 }, boxes(m)));
  assert.deepEqual(children(m2, "nG"), ["nG1", "nL", "nG2", "nT"]);
  assert.equal(m2.nodes.nL.pos, "flow");
  const m3 = run(m, E.reparent(m, ["nL"], null, {}, () => R(510, 20, 20, 20)));
  assert.equal(m3.nodes.nL.parent, null);
  assert.deepEqual([m3.nodes.nL.x, m3.nodes.nL.y], [510, 20]);
  const m4 = run(m, E.flowMove(m, ["nT"], "nG", 0));
  assert.deepEqual(children(m4, "nG"), ["nT", "nG1", "nG2"]);
  assert.equal(E.flowMove(m, ["nG1"], "nG", 0), null);
});

test("copy and paste: new ids, structure kept, valid, one undo step", () => {
  const m = design();
  const payload = E.copyNodes(m, ["nF", "nL"]);
  assert.deepEqual(payload.roots, ["nF"]);
  assert.equal(payload.nodes.length, 4);
  const res = E.pasteNodes(m, payload, { page: PAGE, offset: [10, 0], random: seededRandom(3) });
  const m2 = run(m, res.op);
  const id = res.ids[0];
  assert.notEqual(id, "nF");
  assert.equal(m2.nodes[id].x, 10);
  assert.equal(children(m2, id).length, 3);
  // into a flex frame the pasted layer flows
  const r2 = E.pasteNodes(m, E.copyNodes(m, ["nL"]), { parent: "nG", random: seededRandom(4) });
  const m3 = run(m, r2.op);
  assert.equal(m3.nodes[r2.ids[0]].pos, "flow");
  assert.equal(children(m3, "nG").at(-1), r2.ids[0]);
  assert.equal(E.pasteNodes(m, { kind: "x" }, { page: PAGE }), null);
});
