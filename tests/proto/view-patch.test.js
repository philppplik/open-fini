// The pure half of the Proto renderer (task T3): which top-level layers change after a commit, the keyed patch
// planner, culling and level of detail (app/src/proto/patch.js), and the camera math (app/src/proto/camera.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../app/src/engine/proto/schema.js";
import { apply, applyAll } from "../../app/src/engine/proto/ops.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { treeCss } from "../../app/src/engine/proto/css.js";
import { changedRoots, entriesFor, planPatch, planStats, cullState, estimateBox, LOD_ZOOM, BLOCK_ZOOM } from "../../app/src/proto/patch.js";
import * as C from "../../app/src/proto/camera.js";

const PAGE = "p1";
function design() {
  const opts = { random: seededRandom(7) };
  let m = S.emptyDocument({ title: "T", created: "2026-01-01T00:00:00Z", pageId: PAGE });
  m = applyAll(
    m,
    [
      { op: "node.create", type: "frame", page: PAGE, id: "nA", fields: { name: "A", x: 0, y: 0, layout: { type: "flex", dir: "column", gap: 8, pad: [16, 16, 16, 16] } }, children: [{ type: "text", id: "nA1" }, { type: "rect", id: "nA2" }, { type: "ellipse", id: "nA3" }] },
      { op: "node.create", type: "frame", page: PAGE, id: "nB", fields: { name: "B", x: 500, y: 0 }, children: [{ type: "rect", id: "nB1", fields: { x: 10, y: 10 } }] },
    ],
    opts,
  ).model;
  return m;
}

const entries = (m, id) => {
  const r = createResolver(m);
  const tree = r.tree(id);
  return entriesFor(tree, treeCss(tree, { resolver: r, model: m, vars: "css", root: "origin" }));
};

test("changedRoots: identity tells which top-level layers to re-resolve", () => {
  const m = design();
  assert.deepEqual([...changedRoots(null, m, PAGE).roots], ["nA", "nB"], "a first render resolves everything");
  assert.equal(changedRoots(null, m, PAGE).all, true);
  assert.equal(changedRoots(m, m, PAGE).roots.size, 0, "the same model changes nothing");
  const edited = apply(m, { op: "node.update", id: "nA2", set: { opacity: 0.5 } }).model;
  const ch = changedRoots(m, edited, PAGE);
  assert.equal(ch.all, false);
  assert.deepEqual([...ch.roots], ["nA"], "a child edit marks only its top-level frame");
  assert.deepEqual(ch.order, ["nA", "nB"]);
  // a move from one frame to another marks both
  const moved = apply(m, { op: "node.move", ids: ["nA2"], parent: "nB" }).model;
  assert.deepEqual([...changedRoots(m, moved, PAGE).roots].sort(), ["nA", "nB"]);
  // deletion of a whole frame: it leaves the order (the view drops it)
  const gone = apply(m, { op: "node.delete", ids: ["nB"] }).model;
  assert.deepEqual(changedRoots(m, gone, PAGE).order, ["nA"]);
  // variables and page fields reach every layer
  const page = apply(m, { op: "page.update", id: PAGE, set: { bg: "#000000" } }).model;
  assert.equal(changedRoots(m, page, PAGE).all, true);
});

test("changedRoots: a component edit re-resolves every frame that shows an instance", () => {
  let m = design();
  m = applyAll(m, [
    { op: "node.create", type: "component", page: PAGE, id: "nC", fields: { name: "Button", x: 0, y: 900 }, children: [{ type: "text", id: "nC1" }] },
    { op: "node.create", type: "instance", parent: "nB", id: "nI", fields: { of: "nC" } },
  ]).model;
  const edited = apply(m, { op: "node.update", id: "nC1", set: { opacity: 0.4 } }).model;
  assert.deepEqual([...changedRoots(m, edited, PAGE).roots].sort(), ["nB", "nC"]);
});

test("entriesFor builds the render description from css.js only", () => {
  const e = entries(design(), "nA");
  assert.deepEqual([...e.keys()], ["nA", "nA1", "nA2", "nA3"]);
  const root = e.get("nA");
  assert.equal(root.parent, null);
  assert.deepEqual(root.children, ["nA1", "nA2", "nA3"]);
  assert.ok(root.decls.some(([p, v]) => p === "display" && v === "flex"));
  assert.ok(root.decls.some(([p, v]) => p === "left" && v === "0px"), "the root sits at the origin of its host");
  assert.ok(e.get("nA1").text.runs.length, "text layers carry their runs");
  assert.equal(e.get("nA2").paint.fill, "#d4d4d8", "the simplified drawing knows the fill");
  assert.equal(e.get("nA1").paint.text, true);
});

test("planPatch: a first render creates every element and places the children", () => {
  const e = entries(design(), "nA");
  const ops = planPatch(null, e);
  assert.deepEqual(planStats(ops), { create: 4, children: 1, root: 1 });
  assert.deepEqual(ops.find((o) => o.t === "children"), { t: "children", key: "nA", children: ["nA1", "nA2", "nA3"] });
  assert.equal(ops.at(-1).t, "root");
  assert.deepEqual(planPatch(e, e), [], "nothing changed, nothing to do");
});

test("planPatch: a property edit touches only the declarations that changed", () => {
  const m = design();
  const before = entries(m, "nA");
  const after = entries(apply(m, { op: "node.update", id: "nA2", set: { opacity: 0.5, radius: 8 } }).model, "nA");
  const ops = planPatch(before, after);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].t, "style");
  assert.equal(ops[0].key, "nA2");
  assert.deepEqual(ops[0].set.map(([p]) => p).sort(), ["border-radius", "opacity"]);
  assert.deepEqual(ops[0].remove, []);
  // and back: the declarations are removed again
  const back = planPatch(after, before);
  assert.deepEqual(back[0].remove.sort(), ["border-radius", "opacity"]);
});

test("planPatch: text, order, insertions and removals", () => {
  const m = design();
  const base = entries(m, "nA");
  const text = planPatch(base, entries(apply(m, { op: "node.update", id: "nA1", set: { text: { runs: [{ t: "Hello", s: {} }] } } }).model, "nA"));
  assert.deepEqual(text.map((o) => o.t), ["text"]);
  assert.equal(text[0].text.runs[0].text, "Hello");
  const reordered = planPatch(base, entries(apply(m, { op: "node.move", ids: ["nA3"], parent: "nA", index: 0 }).model, "nA"));
  assert.deepEqual(reordered.filter((o) => o.t === "children"), [{ t: "children", key: "nA", children: ["nA3", "nA1", "nA2"] }]);
  const added = apply(m, { op: "node.create", type: "rect", parent: "nA", id: "nA4" }).model;
  const plus = planPatch(base, entries(added, "nA"));
  assert.deepEqual(plus.map((o) => o.t), ["create", "children"]);
  const removed = planPatch(entries(added, "nA"), base);
  assert.deepEqual(removed.filter((o) => o.t === "remove"), [{ t: "remove", key: "nA4", top: true }]);
  // a removed subtree: only its top needs to leave the DOM
  const nested = apply(m, { op: "node.create", type: "frame", parent: "nA", id: "nA5", children: [{ type: "rect", id: "nA6" }] }).model;
  const drop = planPatch(entries(nested, "nA"), base).filter((o) => o.t === "remove");
  assert.deepEqual(drop.sort((a, b) => a.key.localeCompare(b.key)), [{ t: "remove", key: "nA5", top: true }, { t: "remove", key: "nA6", top: false }]);
});

test("cullState: live near the view, hidden offscreen, detached later, simplified when zoomed out", () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 };
  const near = { x: -500, y: -500, w: 2000, h: 1800 };
  const inside = { x: 100, y: 100, w: 400, h: 400 };
  const far = { x: 5000, y: 0, w: 400, h: 400 };
  assert.equal(cullState({ box: null, view, near, zoom: 1 }), "live", "a layer never measured renders once");
  assert.equal(cullState({ box: inside, view, near, zoom: 1 }), "live");
  assert.equal(cullState({ box: far, view, near, zoom: 1 }), "hidden");
  assert.equal(cullState({ box: far, view, near, zoom: 1, hiddenSince: 0, now: 5000 }), "hidden");
  assert.equal(cullState({ box: far, view, near, zoom: 1, hiddenSince: 0, now: 10000 }), "detached");
  assert.equal(cullState({ box: inside, view, near, zoom: LOD_ZOOM / 2 }), "lod", "400 px at 12.5 % is 50 px on screen");
  assert.equal(cullState({ box: { ...inside, w: 4000, h: 4000 }, view, near, zoom: LOD_ZOOM / 2 }), "live", "large frames keep their DOM");
  assert.equal(cullState({ box: inside, view, near, zoom: BLOCK_ZOOM / 2 }), "block");
  assert.deepEqual(estimateBox({ x: 10, y: 20, w: { mode: "fixed", value: 390 }, h: { mode: "hug" } }), { x: 10, y: 20, w: 390, h: 100 });
});

test("camera: conversions, zoom around a point, fit and preset steps", () => {
  const cam = { x: 100, y: 50, zoom: 2 };
  assert.deepEqual(C.toWorld(cam, 300, 250), { x: 100, y: 100 });
  assert.deepEqual(C.toScreen(cam, 100, 100), { x: 300, y: 250 });
  const z = C.zoomAt(cam, 300, 250, 4);
  assert.deepEqual(C.toWorld(z, 300, 250), { x: 100, y: 100 }, "the point under the pointer stays");
  assert.equal(C.zoomAt(cam, 0, 0, 1e6).zoom, C.MAX_ZOOM);
  assert.equal(C.zoomAt(cam, 0, 0, 0).zoom, C.MIN_ZOOM);
  const f = C.fitRect({ x: 0, y: 0, w: 1000, h: 500 }, 600, 400, { padding: 50, maxZoom: 1 });
  assert.equal(f.zoom, 0.5);
  assert.deepEqual(C.toScreen(f, 500, 250), { x: 300, y: 200 }, "the rect is centered");
  assert.equal(C.fitRect({ x: 0, y: 0, w: 10, h: 10 }, 600, 400).zoom, 1, "never zooms in past maxZoom");
  assert.equal(C.stepZoom(1, 1), 1.5);
  assert.equal(C.stepZoom(1, -1), 0.667);
  assert.equal(C.stepZoom(0.7, -1), 0.667);
  const vp = C.worldViewport({ x: -100, y: 0, zoom: 0.5 }, 800, 600, 10);
  assert.deepEqual(vp, { x: 180, y: -20, w: 1640, h: 1240 });
  const w = C.wheelZoom(cam, 300, 250, -100);
  assert.ok(w.zoom > cam.zoom);
  assert.deepEqual(C.toWorld(w, 300, 250), { x: 100, y: 100 });
});
