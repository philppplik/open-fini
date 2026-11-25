// Prototype interactions and flows (engine/proto/interactions.js, task T9): the operations with exact inverses, what
// they refuse, the connections and flow graph, transitions and springs, and the smart animate layer matching.
import test from "node:test";
import assert from "node:assert/strict";
import * as O from "../../app/src/engine/proto/ops.js";
import * as I from "../../app/src/engine/proto/interactions.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { flowModel } from "./flow-fixture.js";

const opts = () => ({ random: seededRandom(3) });
function roundTrip(model, op) {
  const r = O.apply(model, op, opts());
  assert.deepEqual(validate(r.model).errors, [], `${op.op}: valid`);
  assert.deepEqual(O.apply(r.model, r.inverse).model, model, `${op.op}: inverse restores`);
  return r;
}
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof O.OpError, String(e));
    return e.code;
  }
  assert.fail("expected an OpError");
};

test("interaction.add / set / delete keep the list and invert exactly", () => {
  const m = flowModel();
  const it = { on: { type: "key", key: "Escape", mods: ["shift"] }, do: [{ act: "closeOverlay" }] };
  const a = roundTrip(m, { op: "interaction.add", id: "menu", interaction: it });
  assert.deepEqual(a.model.nodes.menu.proto, [it]);
  const b = roundTrip(a.model, { op: "interaction.add", id: "menu", index: 0, interaction: { on: { type: "afterDelay", ms: 500 }, do: [{ act: "back" }] } });
  assert.equal(b.model.nodes.menu.proto[0].on.type, "afterDelay");
  const c = roundTrip(b.model, { op: "interaction.set", id: "menu", index: 1, interaction: { on: { type: "hover" }, do: [] } });
  assert.equal(c.model.nodes.menu.proto[1].on.type, "hover");
  const d = roundTrip(c.model, { op: "interaction.delete", id: "menu", index: 0 });
  assert.equal(d.model.nodes.menu.proto.length, 1);
  const e = roundTrip(d.model, { op: "interaction.delete", id: "menu", index: 0 });
  assert.equal(e.model.nodes.menu.proto, undefined, "an empty list is removed");
  assert.equal(code(() => O.apply(m, { op: "interaction.delete", id: "menu", index: 0 })), "bad-op");
});

test("interactions are checked: triggers, targets, transitions, variables, expressions and links", () => {
  const m = flowModel();
  const bad = [
    [{ on: { type: "tap" }, do: [] }, /on.type/],
    [{ on: { type: "click" }, do: [{ act: "navigate", to: "nope" }] }, /does not exist/],
    [{ on: { type: "click" }, do: [{ act: "navigate", to: "card1" }] }, /not a top-level/],
    [{ on: { type: "click" }, do: [{ act: "navigate", to: "done", tr: { type: "wipe" } }] }, /tr.type/],
    [{ on: { type: "click" }, do: [{ act: "navigate", to: "done", tr: { type: "smart", ease: { spring: [1, "x", 3] } } }] }, /ease/],
    [{ on: { type: "click" }, do: [{ act: "set", var: "nope", value: 1 }] }, /variable/],
    [{ on: { type: "click" }, do: [{ act: "set", var: "v1", value: { op: "eval", args: ["x"] } }] }, /operator/],
    [{ on: { type: "click" }, do: [{ act: "openUrl", url: "javascript:alert(1)" }] }, /link/],
    [{ on: { type: "key" }, do: [] }, /on.key/],
    [{ on: { type: "afterDelay", ms: -1 }, do: [] }, /on.ms/],
    [{ on: { type: "variableChange", var: "zz" }, do: [] }, /on.var/],
    [{ on: { type: "click" }, do: [{ act: "variant", set: {} }] }, /set/],
    [{ on: { type: "click" }, do: [], extra: 1 }, /Unknown key/],
  ];
  for (const [it, re] of bad) {
    const p = I.interactionProblems(m, it);
    assert.ok(p.some((x) => re.test(x)), `${JSON.stringify(it)} → ${p.join(" | ")}`);
    assert.throws(() => O.apply(m, { op: "interaction.add", id: "card1", interaction: it }), O.OpError);
  }
  const deep = { on: { type: "click" }, do: [{ act: "if", cond: true, then: [] }] };
  let cur = deep.do[0];
  for (let i = 0; i < 12; i++) {
    const next = { act: "if", cond: true, then: [] };
    cur.then.push(next);
    cur = next;
  }
  assert.ok(I.interactionProblems(m, deep).some((x) => /nested too deeply/.test(x)));
  const ok = { on: { type: "click" }, do: [{ act: "if", cond: { var: "v1", op: "==", value: true }, then: [{ act: "navigate", to: "done", tr: { type: "smart", ease: { spring: [1, 300, 20] } } }], else: [{ act: "openUrl", url: "https://example.com", newTab: true }] }] };
  assert.deepEqual(I.interactionProblems(m, ok), []);
});

test("interaction.connect adds, retargets and removes a click navigation; flows are created, updated and deleted", () => {
  const m = flowModel();
  const a = roundTrip(m, { op: "interaction.connect", from: "card2", to: "done" });
  assert.equal(a.model.nodes.card2.proto[0].do[0].to, "done");
  assert.equal(a.model.nodes.card2.proto[0].do[0].tr.type, "dissolve", "a default transition");
  const b = roundTrip(a.model, { op: "interaction.connect", from: "card2", to: "home" });
  assert.equal(b.model.nodes.card2.proto.length, 1, "retargeted, not added");
  assert.equal(b.model.nodes.card2.proto[0].do[0].to, "home");
  const c = roundTrip(b.model, { op: "interaction.connect", from: "card2", to: null });
  assert.equal(c.model.nodes.card2.proto, undefined);
  assert.equal(code(() => O.apply(m, { op: "interaction.connect", from: "card2", to: "details" })), "self");
  assert.equal(code(() => O.apply(m, { op: "interaction.connect", from: "card2", to: "h1" })), "missing-target");

  const f = roundTrip(m, { op: "flow.create", start: "details", name: "  Second  " });
  const id = f.ids[0];
  assert.match(id, /^f[0-9a-z]{8}$/);
  assert.deepEqual(f.model.pages.p1.flows.at(-1), { id, name: "Second", start: "details" });
  const g = roundTrip(f.model, { op: "flow.update", page: "p1", id, set: { name: "Two", start: "done", description: "Short" } });
  assert.deepEqual(g.model.pages.p1.flows.at(-1), { id, name: "Two", start: "done", description: "Short" });
  const h = roundTrip(g.model, { op: "flow.delete", page: "p1", id });
  assert.equal(h.model.pages.p1.flows.length, 1);
  assert.equal(code(() => O.apply(m, { op: "flow.create", start: "card1" })), "flow-start");
  assert.equal(code(() => O.apply(m, { op: "flow.create", start: "home", id: "f1" })), "id");
  assert.equal(code(() => O.apply(m, { op: "flow.update", page: "p1", id: "nope", set: {} })), "missing");
  assert.equal(code(() => O.apply(m, { op: "flow.update", page: "p1", id: "f1", set: { name: " " } })), "bad-op");
});

test("connections and the flow graph follow navigations, overlays and branches", () => {
  const m = flowModel();
  const c = I.connections(m, "p1");
  assert.ok(c.some((x) => x.from === "go" && x.to === "details" && x.act === "navigate" && x.trigger === "click"));
  assert.ok(c.some((x) => x.from === "h1" && x.to === "menu" && x.act === "openOverlay"));
  assert.ok(c.some((x) => x.from === "back-btn" && x.act === "back" && x.to === null));
  const g = I.flowGraph(m, m.pages.p1.flows[0]);
  assert.deepEqual(g.screens, ["home", "menu", "details", "done"], "breadth first, layers in document order");
  assert.deepEqual(g.missing, []);
  assert.ok(g.edges.some((e) => e.from === "details" && e.via === "done-btn" && e.to === "done"));
  // a target removed later shows up as missing (validate only warns, deleting a frame never fails)
  const del = O.apply(m, { op: "node.delete", ids: ["done"] }).model;
  assert.deepEqual(I.flowGraph(del, del.pages.p1.flows[0]).missing, ["done"]);
  assert.ok(validate(del).warnings.some((w) => w.code === "missing-target"));
  assert.equal(I.describe(m.nodes.go.proto[0], (id) => m.nodes[id]?.name || id), "On click: navigate to Details (smart animate, 300 ms)");
  assert.match(I.describe(m.nodes.card1.proto[0], (id) => m.vars.items[id]?.name || id), /^On click: set liked = .*; set count = /);
});

test("duplicating a frame with its targets remaps interactions inside the copy", () => {
  const m = flowModel();
  const r = O.apply(m, { op: "node.duplicate", ids: ["home"] }, opts());
  const copy = r.map.go;
  assert.equal(r.model.nodes[copy].proto[0].do[0].to, "details", "targets outside the copy stay");
});

test("transitions: defaults, CSS easings and springs sampled for linear()", () => {
  assert.deepEqual(I.transition(null), { type: "instant", dir: "left", dur: 0, ease: "ease-out" });
  assert.deepEqual(I.transition({ type: "push", dir: "up" }), { type: "push", dir: "up", dur: 300, ease: "ease-out" });
  assert.equal(I.transition({ type: "smart", dur: 99999 }).dur, 10000);
  assert.equal(I.easingCss("ease-in"), "ease-in");
  assert.equal(I.easingCss({ bezier: [0.2, 0, 2, 1] }), "cubic-bezier(0.2, 0, 1, 1)");
  assert.equal(I.easingCss("bogus"), "ease-out");
  const spring = I.easingCss({ spring: [1, 300, 20] });
  assert.match(spring, /^linear\(0, .*, 1\)$/);
  const pts = I.springCurve([1, 600, 10], 40);
  assert.equal(pts.length, 41);
  assert.equal(pts[0], 0);
  assert.ok(Math.max(...pts) > 1.05, "an underdamped spring overshoots");
  const stiff = I.springDuration([1, 600, 50]);
  const soft = I.springDuration([1, 80, 8]);
  assert.ok(stiff < soft && stiff >= 50 && soft <= 10000, `${stiff} < ${soft}`);
  assert.equal(I.transition({ type: "smart", ease: { spring: [1, 80, 8] } }).dur, soft, "a spring sets its own duration");
});

test("smart animate matches the same layer, unique instances, name paths and layers inside matched instances", () => {
  const L = (key, name, parent, depth, extra = {}) => ({ key, id: key.split("/").pop(), name, type: "rect", parent, of: null, depth, path: "", ...extra });
  const withPaths = (list) => {
    const by = new Map(list.map((x) => [x.key, x]));
    for (const x of list) {
      const names = [];
      for (let p = x; p && p.depth > 0; p = by.get(p.parent)) names.unshift(p.name);
      x.path = names.join("/");
    }
    return list;
  };
  const a = withPaths([L("A", "Home", null, 0), L("a1", "Card", "A", 1), L("a2", "Title", "a1", 2), L("a3", "Card", "A", 1), L("a4", "Only in A", "A", 1), L("i1", "Btn", "A", 1, { type: "instance", of: "C" }), L("i1/s1", "Label", "i1", 2), L("shared", "Shared", "A", 1)]);
  const b = withPaths([L("B", "Details", null, 0), L("b1", "Card", "B", 1), L("b2", "Title", "b1", 2), L("b3", "Card", "B", 1), L("b5", "Only in B", "B", 1), L("i2", "Renamed button", "B", 1, { type: "instance", of: "C" }), L("i2/s1", "Label", "i2", 2), L("shared", "Shared moved", "B", 1)]);
  const m = I.matchLayers(a, b);
  assert.equal(m.get("B"), "A", "the roots");
  assert.equal(m.get("shared"), "shared", "the same layer");
  assert.equal(m.get("i2"), "i1", "the only instances of one component");
  assert.equal(m.get("i2/s1"), "i1/s1", "inside matched instances");
  assert.equal(m.get("b1"), "a1", "the first Card with the first");
  assert.equal(m.get("b3"), "a3", "the second with the second");
  assert.equal(m.get("b2"), "a2", "Card/Title");
  assert.equal(m.has("b5"), false, "unmatched layers fade");
  assert.equal(new Set(m.values()).size, m.size, "each old layer matches once");
  assert.equal(I.matchLayers([], b).size, 0);

  // on real resolved trees: Home and Details share Card by name
  const model = flowModel();
  const r = createResolver(model);
  const fa = I.flatten(r.tree("home"));
  const fb = I.flatten(r.tree("details"));
  assert.equal(fa[0].path, "");
  assert.ok(fa.some((x) => x.path === "Card"));
  const mm = I.matchLayers(fa, fb);
  assert.equal(mm.get("card2"), "card1");
  assert.equal(mm.get("details"), "home");
  assert.equal(mm.has("done-btn"), false);
  // re-rendering one frame (variables, variants) matches every layer to itself
  const self = I.matchLayers(fa, I.flatten(r.tree("home")));
  for (const x of fa) assert.equal(self.get(x.key), x.key);
});

test("an instance without interactions of its own uses those of the variant it shows", () => {
  let m = flowModel();
  const run = (op) => (m = O.apply(m, op, opts()).model);
  run({ op: "node.create", type: "component", page: "p1", id: "btn", fields: { name: "state=default", x: 0, y: 1000 } });
  run({ op: "node.create", type: "component", page: "p1", id: "btnh", fields: { name: "state=hover", x: 200, y: 1000 } });
  run({ op: "component.combine", ids: ["btn", "btnh"], id: "set1", name: "Button" });
  run({ op: "interaction.add", id: "btn", interaction: { on: { type: "hover" }, do: [{ act: "variant", set: { state: "hover" }, tr: { type: "smart", dur: 150 } }] } });
  run({ op: "instance.create", of: "set1", parent: "home", id: "inst" });
  const r = createResolver(m);
  const node = r.tree("home").children.find((c) => c.key === "inst");
  assert.equal(I.instanceKeyOf(node), "inst");
  assert.equal(I.interactionsOf(m, node)[0].on.type, "hover");
  run({ op: "interaction.add", id: "inst", interaction: { on: { type: "click" }, do: [{ act: "back" }] } });
  const own = createResolver(m).tree("home").children.find((c) => c.key === "inst");
  assert.equal(I.interactionsOf(m, own)[0].on.type, "click", "its own interactions win");
});
