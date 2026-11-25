// The Proto Studio controller (task T3): selection, operations as undo steps replayed through their inverses
// (app/src/proto/controller.js), hit testing and marquee selection on the geometry cache (app/src/proto/geometry.js),
// and the Labs registration of the studio (app/src/studios/proto.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../app/src/engine/proto/schema.js";
import { apply, applyAll } from "../../app/src/engine/proto/ops.js";
import { createController, opStep } from "../../app/src/proto/controller.js";
import { createGeometry, hitTest, pickAt, marqueeSelect, unionRect, normRect } from "../../app/src/proto/geometry.js";
import { PROTO_STUDIO, PROTO_MENUS, installProtoLabs, PROTO_LABS_PREF } from "../../app/src/studios/proto.js";
import { createStudioRegistry } from "../../app/src/studios/registry.js";
import { naturalStudio, editableStudios } from "../../app/src/core/tab-studio.js";

const PAGE = "p1";
function design() {
  let m = S.emptyDocument({ title: "T", created: "2026-01-01T00:00:00Z", pageId: PAGE });
  m = applyAll(m, [
    { op: "node.create", type: "frame", page: PAGE, id: "nA", fields: { name: "A" }, children: [{ type: "rect", id: "nA1" }, { type: "frame", id: "nA2", children: [{ type: "text", id: "nA3" }] }] },
    { op: "node.create", type: "frame", page: PAGE, id: "nB", fields: { name: "B", x: 500 } },
  ]).model;
  return m;
}

/** A controller over a plain model with a recording history (what the workspace does with doc.tx). */
function harness() {
  const h = { model: design(), undo: [], redo: [], events: [] };
  h.ctl = createController({
    model: () => h.model,
    page: PAGE,
    emit: (ev) => h.events.push(ev),
    commit(step, label) {
      h.model = step.redo(h.model);
      h.undo.push({ step, label });
      h.redo.length = 0;
    },
  });
  h.doUndo = () => {
    const s = h.undo.pop();
    h.model = s.step.undo(h.model);
    h.redo.push(s);
    h.ctl.prune();
  };
  h.doRedo = () => {
    const s = h.redo.pop();
    h.model = s.step.redo(h.model);
    h.undo.push(s);
  };
  return h;
}

test("opStep: undo and redo restore the exact models, and replay through the inverse when the model moved on", () => {
  const m = design();
  assert.equal(opStep(m, { op: "node.update", id: "nA1", set: { name: "Rectangle" } }), null, "a no-op is no step");
  const step = opStep(m, { op: "node.update", id: "nA1", set: { opacity: 0.5 } });
  assert.equal(step.redo(m), step.after);
  assert.equal(step.undo(step.after), m, "nothing else changed: the stored model comes back (identity)");
  // someone else changed another layer in between (live collaboration): the inverse applies on top of it
  const other = apply(step.after, { op: "node.update", id: "nB", set: { name: "Renamed" } }).model;
  const undone = step.undo(other);
  assert.equal(undone.nodes.nA1.opacity, undefined);
  assert.equal(undone.nodes.nB.name, "Renamed", "the other edit survives the undo");
  const redone = step.redo(undone);
  assert.equal(redone.nodes.nA1.opacity, 0.5);
  assert.equal(redone.nodes.nB.name, "Renamed");
  // a created layer comes back with the same id after an undo and redo that had to replay
  const create = opStep(m, { op: "node.create", type: "rect", parent: "nB" });
  const id = create.result.ids[0];
  const moved = apply(create.after, { op: "node.update", id: "nA", set: { name: "X" } }).model;
  const without = create.undo(moved);
  assert.equal(without.nodes[id], undefined);
  assert.ok(create.redo(without).nodes[id], "redo restores the same id");
  // an inverse that cannot apply any more keeps the current model
  const gone = apply(step.after, { op: "node.delete", ids: ["nA"] }).model;
  assert.equal(step.undo(gone), gone);
  assert.throws(() => opStep(m, { op: "node.update", id: "n404", set: { opacity: 1 } }), /n404|not/i);
});

test("controller: run is one undo step; undo and redo go through the step", () => {
  const h = harness();
  const res = h.ctl.run({ op: "node.create", type: "frame", page: PAGE, fields: { name: "C", x: 900 } }, "Add frame");
  const id = res.ids[0];
  assert.equal(h.model.nodes[id].name, "C");
  assert.equal(h.undo.length, 1);
  assert.equal(h.undo[0].label, "Add frame");
  h.ctl.select([id]);
  h.doUndo();
  assert.equal(h.model.nodes[id], undefined);
  assert.deepEqual(h.ctl.selection, [], "undo prunes the selection");
  h.doRedo();
  assert.ok(h.model.nodes[id]);
  assert.equal(h.ctl.run({ op: "node.update", id, set: { name: "C" } }), null, "a no-op records nothing");
  assert.equal(h.undo.length, 1);
});

test("controller: selection, Ctrl+A, Enter and Shift+Enter", () => {
  const h = harness();
  const c = h.ctl;
  assert.equal(c.page, PAGE);
  c.select(["nA1", "n404"]);
  assert.deepEqual(c.selection, ["nA1"], "unknown ids are ignored");
  c.select(["nA2"], { add: true });
  assert.deepEqual(c.selection, ["nA1", "nA2"]);
  c.select(["nA1"], { toggle: true });
  assert.deepEqual(c.selection, ["nA2"]);
  assert.equal(c.context(), "nA", "clicks select among the siblings of the selection");
  c.selectAll();
  assert.deepEqual(c.selection, ["nA1", "nA2"]);
  c.selectParent();
  assert.deepEqual(c.selection, ["nA"]);
  c.selectParent();
  assert.deepEqual(c.selection, [], "the parent of a top-level layer is the page: nothing");
  c.selectAll();
  assert.deepEqual(c.selection, ["nA", "nB"], "without a selection Ctrl+A takes the top-level layers");
  c.select(["nA"]);
  c.selectChildren();
  assert.deepEqual(c.selection, ["nA1", "nA2"]);
  assert.ok(h.events.includes("selection"));
});

test("controller: delete and duplicate the selection (subtrees once)", () => {
  const h = harness();
  h.ctl.select(["nA", "nA1"]);
  const dup = h.ctl.duplicateSelection("Duplicate");
  assert.equal(dup.ids.length, 1, "nA1 is inside nA: one copy");
  assert.deepEqual(h.ctl.selection, [dup.map.nA]);
  assert.equal(h.model.nodes[dup.map.nA].x, 16);
  h.ctl.deleteSelection("Delete");
  assert.equal(h.model.nodes[dup.map.nA], undefined);
  assert.deepEqual(h.ctl.selection, []);
  h.doUndo();
  assert.ok(h.model.nodes[dup.map.nA], "delete is undoable");
});

test("controller: pages switch the selection scope", () => {
  const h = harness();
  h.model = apply(h.model, { op: "page.create", id: "p2", name: "Two" }).model;
  h.ctl.select(["nA"]);
  h.ctl.setPage("p2");
  assert.equal(h.ctl.page, "p2");
  assert.deepEqual(h.ctl.selection, []);
  h.ctl.select(["nA"]);
  assert.deepEqual(h.ctl.selection, [], "layers of another page are not selectable");
  h.model = apply(h.model, { op: "page.delete", id: "p2" }).model;
  assert.equal(h.ctl.page, PAGE, "a removed page falls back to the first page");
});

/** Geometry of design(): A at 0,0 390×844 with A1 at 10,10 and A2 (with A3 inside) at 50,200; B at 500,0. */
function geometry() {
  const g = createGeometry();
  const e = (key, parent, x, y, w, h, order, type = "frame", extra = {}) => ({ key, id: key.split("/").at(-1), sel: key.split("/")[0], root: key.split("/")[0] === "nI" ? "nB" : key.startsWith("nB") ? "nB" : "nA", parent, type, x, y, w, h, order, clip: null, ...extra });
  const clipA = { x: 0, y: 0, w: 390, h: 844 };
  g.setRoot("nA", [e("nA", null, 0, 0, 390, 844, 0), e("nA1", "nA", 10, 10, 100, 100, 1, "rect", { clip: clipA }), e("nA2", "nA", 50, 200, 300, 200, 2, "frame", { clip: clipA }), e("nA3", "nA2", 60, 210, 80, 20, 3, "text", { clip: clipA }), e("nA4", "nA", 350, 800, 100, 100, 4, "rect", { clip: clipA })]);
  g.setRoot("nB", [e("nB", null, 500, 0, 390, 844, 1e6), { ...e("nI", "nB", 520, 20, 120, 40, 1e6 + 1, "instance"), sel: "nI" }, { ...e("nI/nC1", "nI", 530, 30, 60, 20, 1e6 + 2, "text"), sel: "nI", id: "nC1" }]);
  return g;
}

test("geometry: hit testing respects paint order and clipping", () => {
  const g = geometry();
  assert.deepEqual(hitTest(g, 70, 215).map((e) => e.key), ["nA3", "nA2", "nA"]);
  assert.deepEqual(hitTest(g, 420, 850).map((e) => e.key), [], "clipped by its frame");
  assert.deepEqual(hitTest(g, 380, 820).map((e) => e.key), ["nA4", "nA"]);
  assert.equal(g.rootBox("nB").x, 500);
  assert.deepEqual(unionRect([g.get("nA1"), g.get("nA3")]), { x: 10, y: 10, w: 130, h: 220 });
  assert.deepEqual(normRect(10, 50, 0, 0), { x: 0, y: 0, w: 10, h: 50 });
  g.dropRoot("nB");
  assert.equal(g.get("nI"), null);
});

test("geometry: what a click selects", () => {
  const g = geometry();
  assert.equal(pickAt(g, 70, 215), "nA2", "a click selects the frame's layer under the point");
  assert.equal(pickAt(g, 70, 215, { deep: true }), "nA3", "Ctrl/Cmd-click selects the deepest layer");
  assert.equal(pickAt(g, 70, 215, { context: "nA2" }), "nA3", "inside the selection's parent, its children are selected");
  assert.equal(pickAt(g, 200, 600), "nA", "the frame's own background selects the frame");
  assert.equal(pickAt(g, 2000, 2000), null);
  assert.equal(pickAt(g, 540, 35), "nI", "layers of an instance select the instance");
  assert.equal(pickAt(g, 540, 35, { deep: true }), "nI");
});

test("geometry: marquee selection among the top-level layers or a parent's children", () => {
  const g = geometry();
  assert.deepEqual(marqueeSelect(g, { x: -10, y: -10, w: 20, h: 20 }), ["nA"]);
  assert.deepEqual(marqueeSelect(g, { x: 300, y: 0, w: 400, h: 10 }), ["nA", "nB"]);
  assert.deepEqual(marqueeSelect(g, { x: 0, y: 0, w: 120, h: 300 }, { scope: "nA" }), ["nA1", "nA2"]);
  assert.deepEqual(marqueeSelect(g, { x: 395, y: 850, w: 20, h: 20 }, { scope: "nA" }), [], "clipped parts are not selectable");
});

test("studio: registered only with the Labs switch, and complete like other studios", () => {
  const reg = createStudioRegistry();
  const handlers = [];
  const app = { prefs: { [PROTO_LABS_PREF]: false }, on: (ev, fn) => handlers.push([ev, fn]) };
  installProtoLabs(app, reg);
  assert.equal(reg.hasStudio("proto"), false, "off by default");
  app.prefs[PROTO_LABS_PREF] = true;
  for (const [ev, fn] of handlers) if (ev === "prefs") fn(PROTO_LABS_PREF);
  assert.equal(reg.hasStudio("proto"), true, "turning the switch on registers it right away");
  for (const [, fn] of handlers) fn(PROTO_LABS_PREF);
  assert.equal(reg.studioIds().filter((id) => id === "proto").length, 1, "once");
  const s = reg.getStudio("proto");
  assert.equal(s.workspace, true);
  assert.equal(typeof s.newDocument, "function");
  assert.equal(typeof s.newBlank, "function");
  assert.deepEqual(s.essentials.left, [["proto-pages"], ["proto-layers"]]);
  assert.deepEqual([...s.top, ...s.bottom].sort(), ["proto-code", "proto-inspector", "proto-layers", "proto-pages"]);
  assert.equal(PROTO_STUDIO.id, "proto");
  assert.ok(PROTO_MENUS.every((m) => m.studios.includes("proto")));
  const doc = { office: { kind: "proto" } };
  assert.equal(naturalStudio(doc), "proto");
  assert.deepEqual(editableStudios(doc), ["proto"]);
});
