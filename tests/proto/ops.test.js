// Proto Studio operation layer (engine/proto/ops.js, task T1): every operation, its inverse, atomicity, the field
// allow-list, structural sharing, and a property test over seeded random operation sequences.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../../app/src/engine/proto/schema.js";
import * as O from "../../app/src/engine/proto/ops.js";
import * as T from "../../app/src/engine/proto/tree.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { isKey } from "../../app/src/collab/fractional.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const sample = () => structuredClone(SAMPLE);
const opts = (seed = 1) => ({ random: seededRandom(seed) });

/** Applies `op`, checks the result is valid and that the inverse restores the input exactly. */
function roundTrip(model, op, o = opts()) {
  const r = O.apply(model, op, o);
  const v = validate(r.model);
  assert.deepEqual(v.errors, [], `${op.op}: result must be valid`);
  const back = O.apply(r.model, r.inverse);
  assert.deepEqual(back.model, model, `${op.op}: the inverse restores the model`);
  return r;
}

const code = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof O.OpError, `expected OpError, got ${e}`);
    return e.code;
  }
  assert.fail("expected an OpError");
};

test("node.create: defaults, nested children, flow children in auto layout, positions, inverse", () => {
  const m = sample();
  const r = roundTrip(m, { op: "node.create", type: "frame", page: "p1", fields: { name: "Screen", layout: { type: "flex", dir: "column", gap: 8 } }, children: [{ type: "text" }, { type: "rect", fields: { name: "Box" } }] });
  const [id, t, b] = r.ids;
  const n = r.model.nodes[id];
  assert.equal(n.type, "frame");
  assert.equal(n.parent, null);
  assert.equal(n.page, "p1");
  assert.deepEqual(T.topLevel(r.model, "p1"), ["n1", "n40", id]);
  assert.deepEqual(T.children(r.model, id), [t, b]);
  assert.equal(r.model.nodes[t].pos, "flow");
  assert.equal(r.model.nodes[b].name, "Box");
  assert.match(id, /^n[0-9a-z]{8}$/);
  // structural sharing: untouched nodes and maps keep their identity, the input is unchanged
  assert.equal(r.model.nodes.n2, m.nodes.n2);
  assert.equal(r.model.pages, m.pages);
  assert.equal(r.model.vars, m.vars);
  assert.deepEqual(m, sample());
  // positions
  const first = O.apply(m, { op: "node.create", type: "rect", parent: "n1", index: 0, id: "nfirst" });
  assert.deepEqual(T.children(first.model, "n1"), ["nfirst", "n2", "n3", "n5"]);
  const mid = O.apply(m, { op: "node.create", type: "rect", parent: "n1", after: "n2", id: "nmid" });
  assert.deepEqual(T.children(mid.model, "n1"), ["n2", "nmid", "n3", "n5"]);
  const before = O.apply(m, { op: "node.create", type: "rect", parent: "n1", before: "n5", id: "nbef" });
  assert.deepEqual(T.children(before.model, "n1"), ["n2", "n3", "nbef", "n5"]);
  const neg = O.apply(m, { op: "node.create", type: "rect", parent: "n1", index: -2, id: "nneg" });
  assert.deepEqual(T.children(neg.model, "n1"), ["n2", "n3", "nneg", "n5"]);
  // the default page is the first one
  assert.equal(O.apply(m, { op: "node.create", type: "rect" }, opts()).model.nodes[O.apply(m, { op: "node.create", type: "rect" }, opts()).ids[0]].page, "p1");
});

test("node.create refuses bad input", () => {
  const m = sample();
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "blob" })), "type");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", parent: "n404" })), "not-found");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", parent: "n2" })), "parent-type");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", page: "p9" })), "not-found");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", parent: "n1", page: "p2" })), "page-mismatch");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", id: "n1" })), "exists");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", id: "bad.id" })), "id");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", fields: { parent: "n1" } })), "field");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", fields: { bogus: 1 } })), "field");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", fields: { opacity: 5 } })), "invalid");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", children: [{ type: "rect" }] })), "parent-type");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", parent: "n1", before: "n40" })), "position");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "frame", parent: "n20" })), "invalid");
  assert.equal(code(() => O.apply(m, { op: "nope" })), "bad-op");
  assert.equal(code(() => O.apply({}, { op: "batch", ops: [] })), "bad-model");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "rect", fields: { name: () => 1 } })), "value");
  // an instance of a component inside that component is a cycle
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "instance", parent: "n21", fields: { of: "n20" } })), "component-cycle");
  assert.equal(code(() => O.apply(m, { op: "node.create", type: "instance", parent: "n90", fields: { of: "n90" } })), "component-cycle");
});

test("node.update: fields, dotted paths, unset, exact inverse, allow-list", () => {
  const m = sample();
  const r = roundTrip(m, { op: "node.update", id: "n1", set: { name: "Pay", "layout.gap": 12, "layout.wrap": true, opacity: 0.5 }, unset: ["tag"] });
  const n = r.model.nodes.n1;
  assert.equal(n.name, "Pay");
  assert.equal(n.layout.gap, 12);
  assert.equal(n.layout.dir, "column");
  assert.equal(n.tag, undefined);
  assert.equal(r.model.nodes.n2, m.nodes.n2);
  // creating a nested object that did not exist is undone by removing it again
  const r2 = roundTrip(m, { op: "node.update", id: "n2", set: { "a11y.label": "Total price" } });
  assert.deepEqual(r2.model.nodes.n2.a11y, { label: "Total price" });
  assert.deepEqual(r2.inverse, { op: "node.update", id: "n2", set: {}, unset: ["a11y"] });
  // the set value is copied, later mutation of the argument does not leak in
  const fills = [{ type: "solid", color: "#000000" }];
  const r3 = O.apply(m, { op: "node.update", id: "n40", set: { fills } });
  fills[0].color = "#ffffff";
  assert.equal(r3.model.nodes.n40.fills[0].color, "#000000");
  // set to undefined removes; unset of an absent field is a no-op
  assert.equal(O.apply(m, { op: "node.update", id: "n1", set: { tag: undefined } }).model.nodes.n1.tag, undefined);
  assert.equal(O.apply(m, { op: "node.update", id: "n1", unset: ["sticky"] }).model, m);
  assert.equal(O.apply(m, { op: "node.update", id: "n1" }).model, m);
  for (const [set, unset, c] of [
    [{ parent: "n40" }, [], "field"],
    [{ type: "rect" }, [], "field"],
    [{ ord: "k" }, [], "field"],
    [{ bogus: 1 }, [], "field"],
    [{ layout: {}, "layout.gap": 1 }, [], "path"],
    [{ "fills.0.color": "#000000" }, [], "path"],
    [{ "name.x": 1 }, [], "path"],
    [{ opacity: 3 }, [], "invalid"],
    [{}, ["name"], "invalid"],
    [[], [], "bad-op"],
  ])
    assert.equal(code(() => O.apply(m, { op: "node.update", id: "n1", set, unset })), c, JSON.stringify(set));
  assert.equal(code(() => O.apply(m, { op: "node.update", id: "n404", set: { name: "x" } })), "not-found");
});

test("node.update of component properties re-checks variants and instances", () => {
  const m = sample();
  // removing the "lg" option breaks the instance n5 and the variant n24
  assert.equal(code(() => O.apply(m, { op: "node.update", id: "n20", set: { "props.size.options": ["sm", "md"] } })), "invalid");
  roundTrip(m, { op: "node.update", id: "n20", set: { "props.size.options": ["sm", "md", "lg", "xl"] } });
  // pointing an instance at a component that contains it is a cycle
  assert.equal(code(() => O.apply(m, { op: "node.update", id: "n23", set: { of: "n20" } })), "component-cycle");
});

test("node.move: reorder, reparent, cross-page subtree, cycles and sets refused, inverse", () => {
  const m = sample();
  const r = roundTrip(m, { op: "node.move", ids: ["n5"], parent: "n1", index: 0 });
  assert.deepEqual(T.children(r.model, "n1"), ["n5", "n2", "n3"]);
  const r2 = roundTrip(m, { op: "node.move", ids: ["n3", "n2"], parent: "n40", index: 0 });
  assert.deepEqual(T.children(r2.model, "n40"), ["n3", "n2", "n6"]);
  assert.deepEqual(T.children(r2.model, "n1"), ["n5"]);
  // to another page: the subtree follows
  const r3 = roundTrip(m, { op: "node.move", ids: ["n3"], parent: null, page: "p2" });
  assert.equal(r3.model.nodes.n3.page, "p2");
  assert.equal(r3.model.nodes.n4.page, "p2");
  assert.deepEqual(T.topLevel(r3.model, "p2"), ["n20", "n90", "n3"]);
  // to the top level of the same page
  const r4 = roundTrip(m, { op: "node.move", ids: ["n4"], parent: null });
  assert.deepEqual(T.topLevel(r4.model, "p1"), ["n1", "n40", "n4"]);
  // a node and its descendant: only the ancestor moves
  const r5 = O.apply(m, { op: "node.move", ids: ["n4", "n3"], parent: "n40" });
  assert.equal(r5.model.nodes.n4.parent, "n3");
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: ["n1"], parent: "n3" })), "cycle");
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: ["n1"], parent: "n1" })), "cycle");
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: ["n40"], parent: "n20" })), "invalid");
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: ["n3"], parent: "n2" })), "parent-type");
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: [], parent: "n1" })), "bad-op");
  // moving an instance of n90 into n90 creates a component cycle
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: ["n21"], parent: "n90" })), "invalid");
  const withInst = O.apply(m, { op: "node.create", type: "frame", page: "p2", id: "nwrap", children: [{ type: "instance", id: "nin", fields: { of: "n90" } }] }).model;
  assert.equal(code(() => O.apply(withInst, { op: "node.move", ids: ["nwrap"], parent: "n90" })), "component-cycle");
});

test("node.move re-keys siblings that share an order key and the inverse restores them", () => {
  const m = sample();
  m.nodes.n2 = { ...m.nodes.n2, ord: "V" };
  m.nodes.n3 = { ...m.nodes.n3, ord: "V" };
  const r = roundTrip(m, { op: "node.move", ids: ["n5"], parent: "n1", after: "n2" });
  assert.deepEqual(T.children(r.model, "n1"), ["n2", "n5", "n3"]);
  const ords = T.children(r.model, "n1").map((id) => r.model.nodes[id].ord);
  assert.deepEqual([...ords].sort(), ords);
  assert.equal(new Set(ords).size, 3);
});

test("node.move enforces the nesting depth limit", () => {
  let m = S.emptyDocument({ pageId: "p1", created: "x" });
  let parent = null;
  const ids = [];
  for (let i = 0; i < 40; i++) {
    const r = O.apply(m, { op: "node.create", type: "frame", parent, page: "p1", id: `d${i}` });
    m = r.model;
    parent = r.ids[0];
    ids.push(parent);
  }
  let other = null;
  for (let i = 0; i < 30; i++) {
    const r = O.apply(m, { op: "node.create", type: "frame", parent: other, page: "p1", id: `e${i}` });
    m = r.model;
    other = r.ids[0];
  }
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: ["e0"], parent: "d39" })), "depth");
  assert.equal(code(() => O.apply(m, { op: "node.move", ids: ["d0"], parent: "e29" })), "depth");
  assert.equal(O.apply(m, { op: "node.move", ids: ["d20"], parent: "e29" }).model.nodes.d20.parent, "e29");
});

test("node.place: exact placement and its checks", () => {
  const m = sample();
  const r = roundTrip(m, { op: "node.place", items: [{ id: "n2", page: "p1", parent: "n40", ord: "z" }] });
  assert.deepEqual(T.children(r.model, "n40"), ["n6", "n2"]);
  assert.equal(code(() => O.apply(m, { op: "node.place", items: [{ id: "n3", page: "p2", parent: null, ord: "z" }] })), "page-mismatch");
  assert.equal(code(() => O.apply(m, { op: "node.place", items: [{ id: "n1", page: "p1", parent: "n4", ord: "z" }] })), "cycle");
  assert.equal(code(() => O.apply(m, { op: "node.place", items: [{ id: "n1", page: "p1", parent: null, ord: "a0" }] })), "invalid");
  assert.equal(code(() => O.apply(m, { op: "node.place", items: [] })), "bad-op");
});

test("node.delete: subtrees, inverse re-inserts, components in use are refused", () => {
  const m = sample();
  const r = roundTrip(m, { op: "node.delete", ids: ["n3", "n4"] });
  assert.equal(r.model.nodes.n3, undefined);
  assert.equal(r.model.nodes.n4, undefined);
  assert.deepEqual(T.children(r.model, "n1"), ["n2", "n5"]);
  // deleting the target of an interaction leaves a warning, not an error
  const r2 = roundTrip(m, { op: "node.delete", ids: ["n40"] });
  assert.ok(validate(r2.model).warnings.some((w) => w.code === "missing-target"));
  assert.equal(code(() => O.apply(m, { op: "node.delete", ids: ["n20"] })), "in-use");
  assert.equal(code(() => O.apply(m, { op: "node.delete", ids: ["n90"] })), "in-use");
  // with its instances gone, the set can go (n23 inside the set uses n90, which stays)
  roundTrip(m, { op: "node.delete", ids: ["n5", "n20"] });
  assert.equal(code(() => O.apply(m, { op: "node.delete", ids: ["n404"] })), "not-found");
  // node.insert refuses ids in use and invalid nodes
  assert.equal(code(() => O.apply(m, { op: "node.insert", nodes: [m.nodes.n2] })), "exists");
  assert.equal(code(() => O.apply(m, { op: "node.insert", nodes: [{ ...m.nodes.n2, id: "nx", ord: "" }] })), "invalid");
  assert.equal(code(() => O.apply(m, { op: "node.insert", nodes: [{ ...m.nodes.n2, id: "nx", type: "zzz" }] })), "type");
  assert.equal(code(() => O.apply(m, { op: "node.insert", nodes: [{ ...m.nodes.n2, id: "nx", parent: "n404" }] })), "invalid");
});

test("node.duplicate: copies after the source with new ids and remapped references", () => {
  const m = sample();
  const r = roundTrip(m, { op: "node.duplicate", ids: ["n3"], offset: [10, 20] });
  const [copy] = r.ids;
  assert.notEqual(copy, "n3");
  assert.deepEqual(T.children(r.model, "n1"), ["n2", "n3", copy, "n5"]);
  const [kid] = T.children(r.model, copy);
  assert.equal(r.map.n4, kid);
  assert.equal(r.model.nodes[kid].parent, copy);
  assert.deepEqual(r.model.nodes[kid].fills, m.nodes.n4.fills);
  // offset applies to the stored position of the copied root only
  const off = roundTrip(m, { op: "node.duplicate", ids: ["n40"], offset: [10, 20] });
  assert.deepEqual([off.model.nodes[off.ids[0]].x, off.model.nodes[off.ids[0]].y], [450, 20]);
  assert.equal(off.model.nodes[off.map.n6].x, 183);
  // duplicating a set with its instance remaps the instance, its overrides and the bindings
  const both = roundTrip(m, { op: "node.duplicate", ids: ["n20"] }, opts(5));
  const set2 = both.ids[0];
  const variant = both.map.n21;
  assert.equal(both.model.nodes[variant].parent, set2);
  assert.deepEqual(Object.keys(both.model.nodes[variant].bind).map((k) => k.split(".")[0]).sort(), [both.map.n22, both.map.n23, both.map.n23].sort());
  const frame = roundTrip(m, { op: "node.duplicate", ids: ["n1", "n40"] }, opts(9));
  const inst = frame.map.n5;
  assert.equal(frame.model.nodes[inst].proto[0].do[0].to, frame.map.n40, "interaction targets inside the copy are remapped");
  assert.equal(frame.model.nodes[inst].of, "n20", "references outside the copy stay");
});

test("node.wrap: flex with direction and gap guessed from positions, grid, plain frame, inverse", () => {
  let m = S.emptyDocument({ pageId: "p1", created: "x" });
  const box = (id, x, y) => ({ op: "node.create", type: "rect", page: "p1", id, fields: { x, y, w: { mode: "fixed", value: 40 }, h: { mode: "fixed", value: 20 } } });
  m = O.applyAll(m, [box("na", 100, 10), box("nb", 0, 10), box("nc", 50, 10)]).model;
  const r = roundTrip(m, { op: "node.wrap", ids: ["na", "nb", "nc"], id: "nw" });
  const w = r.model.nodes.nw;
  assert.deepEqual([w.x, w.y, w.layout.type, w.layout.dir, w.layout.gap], [0, 10, "flex", "row", 10]);
  assert.deepEqual(T.children(r.model, "nw"), ["nb", "nc", "na"], "children follow their visual order");
  assert.equal(r.model.nodes.na.pos, "flow");
  assert.deepEqual(T.topLevel(r.model, "p1"), ["nw"]);
  // vertical stack
  let v = S.emptyDocument({ pageId: "p1", created: "x" });
  v = O.applyAll(v, [box("na", 0, 0), box("nb", 0, 50)]).model;
  assert.equal(O.apply(v, { op: "node.wrap", ids: ["na", "nb"] }, opts()).model.nodes[O.apply(v, { op: "node.wrap", ids: ["na", "nb"] }, opts()).ids[0]].layout.dir, "column");
  // a plain frame keeps absolute positions relative to the wrapper
  const none = roundTrip(m, { op: "node.wrap", ids: ["na", "nc"], layout: "none", id: "nn" });
  assert.deepEqual([none.model.nodes.nn.x, none.model.nodes.nn.w.value, none.model.nodes.na.x, none.model.nodes.nc.x, none.model.nodes.na.pos], [50, 90, 50, 0, "abs"]);
  const grid = roundTrip(m, { op: "node.wrap", ids: ["na", "nb", "nc"], layout: "grid", id: "ng", fields: { name: "Gallery" } });
  assert.equal(grid.model.nodes.ng.layout.grid.cols.length, 3);
  assert.equal(grid.model.nodes.ng.name, "Gallery");
  const s = sample();
  assert.equal(code(() => O.apply(s, { op: "node.wrap", ids: ["n2", "n6"] })), "siblings");
  assert.equal(code(() => O.apply(s, { op: "node.wrap", ids: ["n21"] })), "set-child");
  assert.equal(code(() => O.apply(s, { op: "node.wrap", ids: ["n2"], layout: "table" })), "bad-op");
  // wrapping inside an auto layout parent keeps the place of the first child
  const inFlex = roundTrip(s, { op: "node.wrap", ids: ["n3", "n2"], id: "nk" });
  assert.deepEqual(T.children(inFlex.model, "n1"), ["nk", "n5"]);
  assert.equal(inFlex.model.nodes.nk.pos, "flow");
});

test("pages: create, update, move, delete with their layers; the last page stays", () => {
  const m = sample();
  const c = roundTrip(m, { op: "page.create", name: "Flows", index: 1, id: "p3" });
  assert.deepEqual(T.pageList(c.model).map((p) => p.id), ["p1", "p3", "p2"]);
  assert.equal(c.model.nodes, m.nodes);
  const auto = O.apply(m, { op: "page.create" }, opts());
  assert.equal(auto.model.pages[auto.ids[0]].name, "Page 3");
  roundTrip(m, { op: "page.update", id: "p1", set: { name: "Main", bg: "#000000" } });
  assert.equal(code(() => O.apply(m, { op: "page.update", id: "p1", set: { ord: "z" } })), "field");
  assert.equal(code(() => O.apply(m, { op: "page.update", id: "p1", set: { bg: "black" } })), "invalid");
  const mv = roundTrip(m, { op: "page.move", id: "p2", index: 0 });
  assert.deepEqual(T.pageList(mv.model).map((p) => p.id), ["p2", "p1"]);
  roundTrip(m, { op: "page.move", id: "p2", ord: "A" });
  assert.equal(code(() => O.apply(m, { op: "page.move", id: "p2", ord: "a0" })), "invalid");
  // deleting the components page is refused while n5 on p1 uses the button
  assert.equal(code(() => O.apply(m, { op: "page.delete", id: "p2" })), "in-use");
  const d = roundTrip(m, { op: "page.delete", id: "p1" });
  assert.equal(Object.values(d.model.nodes).some((n) => n.page === "p1"), false);
  const one = O.apply(m, { op: "batch", ops: [{ op: "node.delete", ids: ["n5"] }, { op: "page.delete", id: "p1" }] }).model;
  assert.equal(code(() => O.apply(one, { op: "page.delete", id: "p2" })), "last-page");
  assert.equal(code(() => O.apply(m, { op: "page.create", page: m.pages.p1 })), "exists");
  assert.equal(code(() => O.apply(m, { op: "page.create", id: "p1" })), "exists");
});

test("meta.update and batch: one atomic step with one inverse", () => {
  const m = sample();
  const r = roundTrip(m, { op: "meta.update", set: { title: "Pay flow" } });
  assert.equal(r.model.meta.title, "Pay flow");
  assert.equal(r.model.nodes, m.nodes);
  assert.equal(code(() => O.apply(m, { op: "meta.update", set: { unit: "mm" } })), "field");
  assert.equal(code(() => O.apply(m, { op: "meta.update", set: { title: 5 } })), "invalid");
  const b = roundTrip(m, {
    op: "batch",
    ops: [
      { op: "node.create", type: "rect", parent: "n40", id: "nr" },
      { op: "node.update", id: "nr", set: { name: "Badge" } },
      { op: "node.move", ids: ["nr"], parent: "n1", index: 0 },
    ],
  });
  assert.equal(b.model.nodes.nr.name, "Badge");
  assert.equal(b.inverse.op, "batch");
  assert.deepEqual(b.ids, ["nr", "nr", "nr"]);
  // a failing step leaves nothing behind
  assert.equal(code(() => O.applyAll(m, [{ op: "node.create", type: "rect", id: "nq" }, { op: "node.update", id: "nq", set: { opacity: 4 } }])), "invalid");
  assert.equal(m.nodes.nq, undefined);
  assert.deepEqual(m, sample());
});

test("convenience wrappers call the same operations", () => {
  let m = sample();
  m = O.createNode(m, { type: "rect", parent: "n40", id: "nz" }).model;
  m = O.updateNode(m, "nz", { name: "Z" }).model;
  m = O.moveNodes(m, ["nz"], { parent: "n1", index: 0 }).model;
  m = O.duplicateNodes(m, ["nz"], [5, 5], opts()).model;
  m = O.wrapNodes(m, ["n2"], "flex", { id: "nw2" }).model;
  m = O.createPage(m, { id: "p7", name: "Seven" }).model;
  m = O.updatePage(m, "p7", { name: "7" }).model;
  m = O.movePage(m, "p7", { index: 0 }).model;
  m = O.deletePage(m, "p7").model;
  m = O.updateMeta(m, { title: "X" }).model;
  const del = O.deleteNodes(m, ["nz"]);
  m = O.insertNodes(del.model, del.inverse.nodes).model;
  m = O.placeNodes(m, [{ id: "nz", page: "p1", parent: "n40", ord: "z" }]).model;
  assert.equal(validate(m).ok, true);
  assert.equal(m.meta.title, "X");
  assert.ok(O.OPS.includes("node.wrap") && O.OPS.includes("batch"));
});

test("the cached child index stays identical to a fresh one after operations", () => {
  let m = sample();
  for (const op of [
    { op: "node.update", id: "n2", set: { name: "x" } },
    { op: "node.move", ids: ["n5"], parent: "n40", index: 0 },
    { op: "node.duplicate", ids: ["n3"] },
    { op: "node.delete", ids: ["n6"] },
  ]) {
    m = O.apply(m, op, opts()).model;
    assert.deepEqual(new Map(T.indexOf(m).map), T.Index.build(m.nodes).map);
  }
});

// ------------------------------------------------------------------------------------------------- property test

const TYPES = ["frame", "rect", "text", "ellipse", "vector"];
const FIELD_EDITS = [
  () => ({ name: "Renamed" }),
  (r) => ({ opacity: Math.round(r() * 100) / 100 }),
  (r) => ({ x: Math.round(r() * 500), y: Math.round(r() * 500) }),
  () => ({ visible: false }),
  (r) => ({ fills: [{ type: "solid", color: r() < 0.5 ? "#112233" : { $var: "v1" } }] }),
  () => ({ radius: [4, 4, 4, 4] }),
  () => ({ pos: "abs", cx: "center" }),
];

function randomOp(m, r) {
  const ids = Object.keys(m.nodes);
  const pages = Object.keys(m.pages);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const containers = ids.filter((id) => S.isContainer(m.nodes[id].type) && m.nodes[id].type !== "componentSet" && m.nodes[id].type !== "instance");
  const k = r();
  if (k < 0.3 || !ids.length) {
    const parent = r() < 0.7 && containers.length ? pick(containers) : null;
    return { op: "node.create", type: pick(TYPES), parent, page: parent ? undefined : pick(pages), index: Math.floor(r() * 4) };
  }
  if (k < 0.45) return { op: "node.update", id: pick(ids), set: pick(FIELD_EDITS)(r) };
  if (k < 0.65) {
    const parent = r() < 0.75 && containers.length ? pick(containers) : null;
    return { op: "node.move", ids: [pick(ids), pick(ids)], parent, page: parent ? undefined : pick(pages), index: Math.floor(r() * 5) };
  }
  if (k < 0.75) return { op: "node.delete", ids: [pick(ids)] };
  if (k < 0.83) return { op: "node.duplicate", ids: [pick(ids)], offset: [8, 8] };
  if (k < 0.9) {
    const id = pick(ids);
    return { op: "node.wrap", ids: T.siblings(m, id).filter(() => r() < 0.6).concat(id), layout: pick(["flex", "grid", "none"]) };
  }
  if (k < 0.94) return { op: "page.create", name: "P", index: Math.floor(r() * 3) };
  if (k < 0.97) return { op: "page.move", id: pick(pages), index: Math.floor(r() * 3) };
  return { op: "page.delete", id: pick(pages) };
}

test("property: random operation sequences keep the model valid, acyclic, sorted and invertible", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = seededRandom(seed);
    let m = sample();
    let applied = 0;
    for (let step = 0; step < 120; step++) {
      const op = randomOp(m, r);
      let res;
      const before = m;
      try {
        res = O.apply(m, op, { random: r });
      } catch (e) {
        assert.ok(e instanceof O.OpError, `seed ${seed} step ${step} ${op.op}: ${e.stack}`);
        assert.equal(m, before);
        continue;
      }
      applied++;
      const v = validate(res.model);
      assert.deepEqual(v.errors, [], `seed ${seed} step ${step} ${JSON.stringify(op)}`);
      // order keys valid and sorted, index in step with the nodes
      const ix = T.indexOf(res.model);
      assert.deepEqual(new Map(ix.map), T.Index.build(res.model.nodes).map, `seed ${seed} step ${step}: index`);
      for (const kids of ix.map.values()) {
        const ords = kids.map((id) => res.model.nodes[id].ord);
        assert.ok(ords.every(isKey));
        for (let i = 1; i < ords.length; i++) assert.ok(ords[i - 1] <= ords[i]);
      }
      // the inverse restores the previous model exactly
      if (step % 3 === 0) assert.deepEqual(O.apply(res.model, res.inverse).model, before, `seed ${seed} step ${step}: inverse of ${op.op}`);
      m = res.model;
    }
    assert.ok(applied > 40, `seed ${seed}: only ${applied} operations applied`);
  }
});
