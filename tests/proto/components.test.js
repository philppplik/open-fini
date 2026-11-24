// Proto components (docs/concepts/proto-studio.md §3.3, task T5): properties and bindings, nested instances, overrides
// that survive edits of the main component, instance swap with a preferred list, slots, detach equal to the resolved
// subtree, the component and instance operations with exact inverses, the resolve cache, the 1,000-instance budget,
// and a property test over random operation sequences.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as O from "../../app/src/engine/proto/ops.js";
import * as C from "../../app/src/engine/proto/components.js";
import { createResolver, createResolveCache, walkResolved } from "../../app/src/engine/proto/resolve.js";
import { treeCss } from "../../app/src/engine/proto/css.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { keysBetween } from "../../app/src/collab/fractional.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const opts = (seed = 1) => ({ random: seededRandom(seed) });
const run = (m, op, seed) => O.apply(m, op, opts(seed));
const code = (c) => (e) => e instanceof O.OpError && e.code === c;
function step(m, op, seed = 1) {
  const r = run(m, op, seed);
  assert.deepEqual(validate(r.model).errors, [], JSON.stringify(op));
  assert.deepEqual(O.apply(r.model, r.inverse).model, m, `inverse of ${op.op}`);
  return r;
}
const text = (t, extra = {}) => ({ type: "text", text: { runs: [{ t, s: {} }], style: { font: "Inter", size: 14 }, autoSize: "width" }, w: { mode: "hug" }, h: { mode: "hug" }, ...extra });

/** The sample plus a card component with two slots, a panel that nests a card, and instances of both. */
function fixture() {
  const m = structuredClone(SAMPLE);
  const add = (id, page, parent, ord, fields) => (m.nodes[id] = { id, name: id, page, parent, ord, ...fields });
  m.nodes.n92 = { id: "n92", type: "component", name: "Icon/Star", page: "p2", parent: null, ord: "t", x: 300, y: 0, w: { mode: "fixed", value: 16 }, h: { mode: "fixed", value: 16 }, layout: { type: "none" } };
  add("n93", "p2", "n92", "V", { type: "ellipse", w: { mode: "fixed", value: 16 }, h: { mode: "fixed", value: 16 }, fills: [{ type: "solid", color: "#f59e0b" }] });
  m.nodes.n20.props.icon.preferred = ["n90", "n92"];
  // Card: title text property, body and footer slots
  add("n60", "p2", null, "w", {
    type: "component", name: "Card", w: { mode: "fixed", value: 240 }, h: { mode: "hug" },
    layout: { type: "flex", dir: "column", gap: 8, pad: [12, 12, 12, 12] },
    props: { title: { type: "text", default: "Title" }, body: { type: "slot" }, footer: { type: "slot" } },
    bind: { "n61.text": "title", "n62.children": "body", "n63.children": "footer" },
  });
  add("n61", "p2", "n60", "V", { ...text("Title"), pos: "flow" });
  add("n62", "p2", "n60", "k", { type: "slot", pos: "flow", w: { mode: "fill" }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: 4 } });
  add("n64", "p2", "n62", "V", { ...text("Empty"), pos: "flow" });
  add("n63", "p2", "n60", "r", { type: "slot", pos: "flow", w: { mode: "fill" }, h: { mode: "hug" }, layout: { type: "flex", dir: "row", gap: 4 } });
  // Panel: a card instance whose body the panel fills
  add("n80", "p2", null, "x", { type: "component", name: "Panel", w: { mode: "hug" }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: 0 } });
  add("n81", "p2", "n80", "V", { type: "instance", pos: "flow", of: "n60", props: { title: "Panel card" } });
  add("n82", "p2", "n81", "V", { ...text("Panel body"), pos: "flow" });
  // instances on the screen page
  add("n70", "p1", null, "y", { type: "instance", x: 900, y: 0, of: "n60", props: { title: "Order", footer: ["n72"] } });
  add("n71", "p1", "n70", "V", { ...text("Two items"), pos: "flow" });
  add("n72", "p1", "n70", "k", { type: "rect", pos: "flow", w: { mode: "fixed", value: 20 }, h: { mode: "fixed", value: 20 } });
  add("n85", "p1", null, "z", { type: "instance", x: 1200, y: 0, of: "n80", over: { "n81/n61": { opacity: 0.5 }, "n81/n82": { text: { runs: [{ t: "Overridden", s: {} }], style: { font: "Inter", size: 12 }, autoSize: "width" } } } });
  assert.deepEqual(validate(m).errors, [], "fixture");
  return m;
}

const byKey = (root) => {
  const out = new Map();
  walkResolved(root, (r) => void out.set(r.key, r));
  return out;
};

test("properties: text and boolean values and defaults write into the bound fields; overrides win", () => {
  const m = fixture();
  m.nodes.n5.variant = { size: "md" };
  let t = byKey(createResolver(m).tree("n5"));
  const label = t.get("n5/n22").node;
  assert.equal(label.text.runs[0].t, "Pay now");
  assert.equal(label.text.style.weight, 600, "the layer's text style stays");
  assert.equal(t.get("n5/n23").node.visible, false, "the default of showIcon");
  m.nodes.n5.props.showIcon = true;
  m.nodes.n5.over.n22.text = { runs: [{ t: "Override", s: {} }], style: { font: "Inter", size: 14 } };
  t = byKey(createResolver(m).tree("n5"));
  assert.equal(t.get("n5/n23").node.visible, true);
  assert.equal(t.get("n5/n22").node.text.runs[0].t, "Override", "an override wins over the property");
  // a property value may be a string variable
  m.vars.items.vs = { name: "copy/pay", coll: "c3", type: "string", values: { base: "Pay with card" } };
  delete m.nodes.n5.over.n22.text;
  m.nodes.n5.props.label = { $var: "vs" };
  assert.deepEqual(validate(m).errors, []);
  t = byKey(createResolver(m).tree("n5"));
  assert.equal(t.get("n5/n22").node.text.runs[0].t, "Pay with card");
  assert.equal(t.get("n5/n22").bound["text.runs.0.t"], "vs");
  // the main component itself shows its stored layers
  assert.equal(createResolver(m).tree("n21").children.find((c) => c.id === "n22").node.text.runs[0].t, "Button");
});

test("instance swap: a swap property with a preferred list replaces a nested instance's component", () => {
  const m = fixture();
  m.nodes.n5.variant = { size: "md" };
  m.nodes.n5.props.showIcon = true;
  assert.deepEqual(C.swapOptions(m, "n20", "icon"), { preferred: ["n90", "n92"], others: ["n20", "n60", "n80"] });
  assert.deepEqual(byKey(createResolver(m).tree("n5")).get("n5/n23").children.map((c) => c.key), ["n5/n23/n91"]);
  const r = step(m, { op: "instance.set", id: "n5", props: { icon: "n92" } });
  const t = byKey(createResolver(r.model).tree("n5"));
  assert.deepEqual(t.get("n5/n23").children.map((c) => c.key), ["n5/n23/n93"]);
  assert.equal(t.get("n5/n23/n93").node.fills[0].color, "#f59e0b");
  assert.equal(t.get("n5/n23").src.of, "n92", "src carries the swapped component");
  assert.throws(() => run(m, { op: "instance.set", id: "n5", props: { icon: "n1" } }), code("invalid"));
  // swapping an instance's own main component keeps known values and every override
  m.nodes.n5.props.content = ["nX"];
  delete m.nodes.n5.props.content;
  const s = step(m, { op: "instance.swap", id: "n5", of: "n90" });
  assert.equal(s.model.nodes.n5.of, "n90");
  assert.equal(s.model.nodes.n5.variant, undefined);
  assert.equal(s.model.nodes.n5.props, undefined);
  assert.deepEqual(s.model.nodes.n5.over, m.nodes.n5.over);
  assert.deepEqual(C.overridePaths(s.model, "n5"), { active: [], inactive: ["n22"] }, "the override no longer reaches a layer");
  assert.throws(() => run(m, { op: "instance.swap", id: "n5", of: "n22" }), code("type"));
});

test("nested instances: overrides by path reach through instances and survive edits of the main component", () => {
  const m = fixture();
  let t = byKey(createResolver(m).tree("n85"));
  assert.equal(t.get("n85/n81/n61").node.opacity, 0.5);
  assert.equal(t.get("n85/n81/n61").node.text.runs[0].t, "Panel card", "the nested instance's own property value");
  assert.equal(t.get("n85/n81/n82").node.text.runs[0].t, "Overridden", "slot content inside the panel, overridden from outside");
  assert.equal(t.get("n85/n81/n82").slot, "n85/n81");
  assert.deepEqual(C.overridePaths(m, "n85"), { active: ["n81/n61", "n81/n82"], inactive: [] });
  // edit the main components: a new layer, a changed field, a moved layer; the overrides still apply
  let x = step(m, { op: "node.create", type: "rect", parent: "n60", index: 0, id: "n66" }).model;
  x = step(x, { op: "node.update", id: "n61", set: { "text.style.size": 20 } }).model;
  x = step(x, { op: "node.move", ids: ["n61"], parent: "n60", index: 2 }).model;
  t = byKey(createResolver(x).tree("n85"));
  assert.equal(t.get("n85/n81/n61").node.opacity, 0.5);
  assert.equal(t.get("n85/n81/n61").node.text.style.size, 20);
  assert.deepEqual(t.get("n85/n81").children.map((c) => c.id), ["n66", "n62", "n61", "n63"]);
  // removing the overridden layer leaves an inactive override (kept, reported)
  x = step(x, { op: "node.delete", ids: ["n61"] }).model;
  assert.deepEqual(C.overridePaths(x, "n85"), { active: ["n81/n82"], inactive: ["n81/n61"] });
  assert.deepEqual(validate(x).errors, []);
});

test("slots: stored children of an instance fill the slots; empty slots show the default content", () => {
  const m = fixture();
  const t = byKey(createResolver(m).tree("n70"));
  assert.equal(t.get("n70/n61").node.text.runs[0].t, "Order");
  assert.deepEqual(t.get("n70/n62").children.map((c) => c.key), ["n71"], "unlisted children fill the first slot");
  assert.deepEqual(t.get("n70/n63").children.map((c) => c.key), ["n72"], "props.footer lists its content");
  assert.equal(t.get("n71").slot, "n70");
  assert.equal(t.get("n71").instance, null, "slot content of a real instance is a real layer");
  assert.equal(t.get("n71").parent, "n70/n62");
  // without content the slot shows the main component's default layers
  const e = structuredClone(m);
  delete e.nodes.n71;
  delete e.nodes.n72;
  delete e.nodes.n70.props.footer;
  const te = byKey(createResolver(e).tree("n70"));
  assert.deepEqual(te.get("n70/n62").children.map((c) => c.key), ["n70/n62/n64"]);
  assert.deepEqual(te.get("n70/n63").children, []);
  // a slot property without a binding takes the first free slot layer
  const u = structuredClone(m);
  u.nodes.n60.bind = { "n61.text": "title" };
  const tu = byKey(createResolver(u).tree("n70"));
  assert.deepEqual(tu.get("n70/n62").children.map((c) => c.key), ["n71"]);
  assert.deepEqual(tu.get("n70/n63").children.map((c) => c.key), ["n72"]);
  // slot values are lists of child ids
  u.nodes.n70.props.footer = "n72";
  assert.ok(validate(u).errors.some((x) => x.code === "slot"));
  // new layers inside an instance are slot content and flow in the slot's layout
  const c = step(m, { op: "node.create", type: "rect", parent: "n70", id: "n73" });
  assert.equal(c.model.nodes.n73.pos, "flow");
  assert.deepEqual(byKey(createResolver(c.model).tree("n70")).get("n70/n62").children.map((x) => x.key), ["n71", "n73"]);
  // duplicating an instance copies its slot content and remaps the slot lists
  const d = step(m, { op: "node.duplicate", ids: ["n70"] });
  const copy = d.model.nodes[d.ids[0]];
  assert.deepEqual(copy.props.footer, [d.map.n72]);
});

/** Compiled CSS of a resolved tree in tree order (keys and ids left out). */
function shape(root) {
  const css = treeCss(root, { root: "origin" });
  const out = [];
  walkResolved(root, (r) => void out.push([r.type === "slot" ? "frame" : r.type, css.get(r.key).decls, css.get(r.key).text ?? null, r.children.length]));
  out[0][0] = "root";
  return out;
}

test("detach: the frame resolves exactly like the instance did; nested instances and slot content survive", () => {
  for (const [id, extra] of [["n5", (m) => ((m.nodes.n5.variant = { size: "md" }), (m.nodes.n5.props.showIcon = true))], ["n70", null], ["n85", null]]) {
    const m = fixture();
    if (extra) extra(m);
    const before = createResolver(m).tree(id);
    const r = step(m, { op: "instance.detach", ids: [id] });
    const n = r.model.nodes[id];
    assert.equal(n.type, "frame");
    assert.equal(n.of, undefined);
    assert.equal(n.over, undefined);
    const after = createResolver(r.model).tree(id);
    assert.deepEqual(shape(after), shape(before), `${id}: the same CSS`);
    // bindings stay bindings
    if (id === "n5") {
      const label = Object.values(r.model.nodes).find((x) => x.parent === id && x.type === "text");
      assert.equal(label.text.runs[0].t, "Pay now");
      assert.deepEqual(r.model.nodes[id].fills[0].color, { $var: "v2" });
      const icon = Object.values(r.model.nodes).find((x) => x.parent === id && x.type === "instance");
      assert.equal(icon.of, "n90", "a nested instance stays an instance");
      assert.equal(icon.visible, true, "with the property value written in");
    }
    if (id === "n70") {
      assert.equal(r.model.nodes.n71.type, "text", "slot content keeps its id");
      assert.equal(r.model.nodes[r.model.nodes.n71.parent].type, "frame", "and moves into the materialized slot");
    }
    if (id === "n85") {
      const inner = Object.values(r.model.nodes).find((x) => x.parent === id && x.type === "instance");
      assert.deepEqual(Object.keys(inner.over).sort(), ["n61"], "outer overrides moved into the nested instance");
      const content = Object.values(r.model.nodes).find((x) => x.parent === inner.id);
      assert.equal(content.text.runs[0].t, "Overridden", "the nested instance's slot content is materialized with its override");
    }
  }
  assert.throws(() => run(fixture(), { op: "instance.detach", ids: ["n1"] }), code("type"));
});

test("component.create, combine and addVariant", () => {
  const m = fixture();
  // a frame becomes a component in place
  let r = step(m, { op: "component.create", ids: ["n40"], name: "Done screen" });
  assert.equal(r.model.nodes.n40.type, "component");
  assert.equal(r.model.nodes.n40.name, "Done screen");
  // other layers are wrapped
  r = step(m, { op: "component.create", ids: ["n6"], id: "nc1" });
  assert.equal(r.model.nodes.nc1.type, "component");
  assert.equal(r.model.nodes.n6.parent, "nc1");
  assert.throws(() => run(m, { op: "component.create", ids: ["n22"] }), code("nested-component"));
  assert.throws(() => run(m, { op: "component.create", ids: ["n5"] }), code("type"));
  // combine: "axis=value" names become variant properties
  let x = step(m, { op: "node.create", type: "component", page: "p2", id: "nk1", fields: { name: "tone=light, size=sm" } }).model;
  x = step(x, { op: "node.create", type: "component", page: "p2", id: "nk2", fields: { name: "tone=dark, size=sm", props: { hint: { type: "text", default: "?" } } } }).model;
  x = step(x, { op: "node.create", type: "instance", page: "p1", id: "nki", fields: { of: "nk2" } }).model;
  r = step(x, { op: "component.combine", ids: ["nk1", "nk2"], id: "nks", name: "Badge" });
  const set = r.model.nodes.nks;
  assert.equal(set.type, "componentSet");
  assert.deepEqual(set.props.tone, { type: "variant", options: ["light", "dark"], default: "light" });
  assert.deepEqual(set.props.size, { type: "variant", options: ["sm"], default: "sm" });
  assert.deepEqual(set.props.hint, { type: "text", default: "?" }, "component properties move to the set");
  assert.equal(r.model.nodes.nk2.props, undefined);
  assert.deepEqual(r.model.nodes.nk2.variant, { tone: "dark", size: "sm" });
  assert.equal(createResolver(r.model).tree("nki").node.type, "instance", "instances of a combined component still resolve");
  // other names: one "variant" property
  let y = step(m, { op: "node.create", type: "component", page: "p2", id: "nq1", fields: { name: "Primary" } }).model;
  y = step(y, { op: "node.create", type: "component", page: "p2", id: "nq2", fields: { name: "Primary" } }).model;
  r = step(y, { op: "component.combine", ids: ["nq1", "nq2"] });
  assert.deepEqual(r.model.nodes[r.ids[0]].props.variant.options, ["Primary", "Primary 2"]);
  assert.throws(() => run(m, { op: "component.combine", ids: ["n21"] }), code("set-child"));
  // addVariant: a copy with new values; new options join the axes
  r = step(m, { op: "component.addVariant", set: "n20", variant: { size: "xl" } });
  const v = r.model.nodes[r.ids[0]];
  assert.equal(v.parent, "n20");
  assert.deepEqual(v.variant, { size: "xl", state: "default" });
  assert.equal(v.name, "size=xl, state=default");
  assert.deepEqual(r.model.nodes.n20.props.size.options, ["sm", "md", "lg", "xl"]);
  assert.ok(Object.keys(v.bind).every((k) => !k.startsWith("n22.")), "the copy binds its own layers");
  assert.throws(() => run(m, { op: "component.addVariant", set: "n20", variant: { size: "lg" } }), code("duplicate-variant"));
  r = step(m, { op: "component.addVariant", set: "n20" });
  assert.equal(r.model.nodes[r.ids[0]].variant.size, "Variant 4");
});

test("property definitions: define, rename, delete and bind with cascades to variants and instances", () => {
  const m = fixture();
  let r = step(m, { op: "prop.define", id: "n21", name: "badge", def: { type: "bool", default: true } });
  assert.deepEqual(r.model.nodes.n20.props.badge, { type: "bool", default: true }, "a variant's properties live on its set");
  // narrowing variant options removes instance values that are gone; options a variant still uses are refused
  m.nodes.n5.variant = { size: "lg", state: "hover" };
  r = step(m, { op: "prop.define", id: "n20", name: "state", def: { type: "variant", options: ["default", "disabled"], default: "default" } });
  assert.deepEqual(r.model.nodes.n5.variant, { size: "lg" });
  assert.throws(() => run(m, { op: "prop.define", id: "n20", name: "size", def: { type: "variant", options: ["sm"] } }), code("in-use"));
  // a new variant axis gives every variant its default
  r = step(m, { op: "prop.define", id: "n20", name: "tone", def: { type: "variant", options: ["a", "b"], default: "b" } });
  assert.equal(r.model.nodes.n21.variant.tone, "b");
  assert.throws(() => run(m, { op: "prop.define", id: "n90", name: "x", def: { type: "variant", options: ["a"] } }), code("type"));
  // changing a type drops the instances' values
  r = step(m, { op: "prop.define", id: "n20", name: "label", def: { type: "bool", default: false } });
  assert.equal(r.model.nodes.n5.props?.label, undefined);
  // rename everywhere
  r = step(m, { op: "prop.rename", id: "n20", name: "label", to: "caption" });
  assert.equal(r.model.nodes.n5.props.caption, "Pay now");
  assert.equal(r.model.nodes.n21.bind["n22.text"], "caption");
  r = step(m, { op: "prop.rename", id: "n20", name: "size", to: "scale" });
  assert.deepEqual(r.model.nodes.n21.variant, { scale: "md", state: "default" });
  assert.deepEqual(r.model.nodes.n5.variant, { scale: "lg", state: "hover" });
  assert.throws(() => run(m, { op: "prop.rename", id: "n20", name: "label", to: "icon" }), code("exists"));
  // delete everywhere
  r = step(m, { op: "prop.delete", id: "n20", name: "showIcon" });
  assert.equal(r.model.nodes.n21.bind["n23.visible"], undefined);
  r = step(m, { op: "prop.delete", id: "n20", name: "size" });
  assert.deepEqual(r.model.nodes.n24.variant, { state: "default" });
  // bind
  r = step(m, { op: "prop.bind", id: "n24", layer: "n24", field: "opacity", prop: "showIcon" });
  assert.equal(r.model.nodes.n24.bind["n24.opacity"], "showIcon");
  r = step(m, { op: "prop.bind", id: "n21", layer: "n22", field: "text", prop: null });
  assert.equal(r.model.nodes.n21.bind["n22.text"], undefined);
  assert.throws(() => run(m, { op: "prop.bind", id: "n21", layer: "n91", field: "visible", prop: "showIcon" }), code("not-inside"));
  assert.throws(() => run(m, { op: "prop.bind", id: "n21", layer: "n22", field: "parent", prop: "label" }), code("field"));
  assert.throws(() => run(m, { op: "prop.bind", id: "n21", layer: "n22", field: "of", prop: "icon" }), code("type"));
  assert.throws(() => run(m, { op: "prop.bind", id: "n21", layer: "n22", field: "text", prop: "size" }), code("type"));
  assert.throws(() => run(m, { op: "prop.bind", id: "n60", layer: "n61", field: "children", prop: "body" }), code("type"));
});

test("instances: create, set values, override, reset", () => {
  const m = fixture();
  let r = step(m, { op: "instance.create", of: "n20", parent: "n1", index: 0, variant: { size: "sm" }, props: { label: "Back" } });
  const id = r.ids[0];
  const inst = r.model.nodes[id];
  assert.equal(inst.name, "Button");
  assert.equal(inst.pos, "flow");
  assert.equal(inst.w, undefined, "the main component's size applies");
  assert.equal(createResolver(r.model).tree(id).node.w.mode, "hug");
  assert.throws(() => run(m, { op: "instance.create", of: "n1" }), code("type"));
  assert.throws(() => run(m, { op: "instance.create", of: "n20", parent: "n21" }), code("component-cycle"));
  r = step(m, { op: "instance.set", id: "n5", variant: { state: "disabled", size: null }, props: { label: null, showIcon: true } });
  assert.deepEqual(r.model.nodes.n5.variant, { state: "disabled" });
  assert.deepEqual(r.model.nodes.n5.props, { showIcon: true });
  assert.throws(() => run(m, { op: "instance.set", id: "n5", variant: { size: "xxl" } }), code("invalid"));
  r = step(m, { op: "instance.override", id: "n85", path: "n81/n63", set: { visible: false } });
  assert.deepEqual(r.model.nodes.n85.over["n81/n63"], { visible: false });
  r = step(r.model, { op: "instance.override", id: "n85", path: "n81/n63", unset: ["visible"] });
  assert.equal(r.model.nodes.n85.over["n81/n63"], undefined);
  assert.throws(() => run(m, { op: "instance.override", id: "n85", path: "n81", set: { parent: "n1" } }), code("field"));
  r = step(m, { op: "instance.reset", id: "n85", paths: ["n81"] });
  assert.equal(r.model.nodes.n85.over, undefined, "a path resets the layers below it");
  r = step(m, { op: "instance.reset", id: "n5", props: true });
  assert.equal(r.model.nodes.n5.over, undefined);
  assert.equal(r.model.nodes.n5.props, undefined);
  assert.deepEqual(r.model.nodes.n5.variant, { size: "lg" }, "the variant stays");
});

test("restore: the generic inverse refuses orphans and invalid layers", () => {
  const m = fixture();
  assert.throws(() => run(m, { op: "restore", nodes: { n60: null } }), code("orphans"));
  assert.throws(() => run(m, { op: "restore", nodes: { n60: { id: "n61" } } }), code("invalid"));
  assert.throws(() => run(m, { op: "restore", nodes: [] }), code("bad-op"));
  const r = step(m, { op: "restore", nodes: { n64: null } });
  assert.equal(r.model.nodes.n64, undefined);
});

/** A page with `n` instances of a three-layer card that holds a nested icon instance. */
function many(n) {
  const m = fixture();
  const ords = keysBetween(null, null, n);
  m.nodes.f1 = { id: "f1", type: "frame", name: "List", page: "p1", parent: null, ord: "zz", x: 0, y: 1000, w: { mode: "fixed", value: 400 }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: { $var: "v9" } }, fills: [{ type: "solid", color: { $var: "v1" } }] };
  for (let i = 0; i < n; i++) {
    const id = `i${i}`;
    m.nodes[id] = { id, type: "instance", name: "Row", page: "p1", parent: "f1", ord: ords[i], pos: "flow", of: "n20", variant: { size: i % 2 ? "md" : "lg" }, props: { label: `Row ${i}`, showIcon: i % 3 === 0 }, ...(i % 5 === 0 ? { over: { n22: { opacity: 0.5 } } } : {}) };
  }
  return m;
}

test("performance: 1,000 instances resolve in under 50 ms; the cache reuses unchanged instances", () => {
  const m = many(1000);
  assert.deepEqual(validate(m).errors, []);
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const t = createResolver(m).tree("f1");
    best = Math.min(best, performance.now() - t0);
    assert.equal(t.children.length, 1000);
  }
  assert.ok(best < 50, `1,000 instances took ${best.toFixed(1)} ms`);
  // the cache: the same resolved objects while nothing they read changed
  const cache = createResolveCache();
  const a = createResolver(m, { cache }).tree("f1");
  const b = createResolver(m, { cache }).tree("f1");
  const at = (t, i) => t.children.find((x) => x.key === `i${i}`);
  assert.equal(at(b, 10), at(a, 10));
  assert.equal(cache.hits, 1000);
  // an edit of one instance re-resolves only that one
  const m2 = run(m, { op: "instance.set", id: "i11", props: { label: "Changed" } }).model;
  const c = createResolver(m2, { cache }).tree("f1");
  assert.notEqual(at(c, 11), at(a, 11));
  assert.equal(at(c, 13), at(a, 13));
  assert.equal(byKey(c).get("i11/n22").node.text.runs[0].t, "Changed");
  // an edit of the main component re-resolves every instance of it
  const m3 = run(m2, { op: "node.update", id: "n22", set: { name: "Caption" } }).model;
  const d = createResolver(m3, { cache }).tree("f1");
  assert.notEqual(at(d, 13), at(c, 13));
  assert.equal(at(d, 12), at(c, 12), "an instance of another variant is not affected");
  assert.equal(byKey(d).get("i11/n22").node.name, "Caption");
  // a variable edit re-resolves too; cached results equal fresh ones
  const m4 = run(m3, { op: "var.update", id: "v2", set: { "values.light": "#000000" } }).model;
  const e = createResolver(m4, { cache }).tree("f1");
  assert.equal(at(e, 1).node.fills[0].color, "#000000");
  const strip = (r) => JSON.parse(JSON.stringify(r));
  assert.deepEqual(strip(createResolver(m4, { cache }).tree("f1")), strip(createResolver(m4).tree("f1")));
  const t0 = performance.now();
  createResolver(m4, { cache }).tree("f1");
  const cachedMs = performance.now() - t0;
  assert.ok(cachedMs < 50, `cached: ${cachedMs.toFixed(1)} ms`);
});

// ------------------------------------------------------------------------------------------------- property test

function randomComponentOp(m, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const ids = Object.keys(m.nodes);
  const of = (...types) => ids.filter((id) => types.includes(m.nodes[id].type));
  const comps = of("component", "componentSet");
  const insts = of("instance");
  const frames = of("frame");
  const k = r();
  if (k < 0.1) return { op: "instance.create", of: pick(comps), parent: r() < 0.5 ? pick(frames) : null, page: "p1" };
  if (k < 0.18 && insts.length) return { op: "instance.set", id: pick(insts), props: { label: r() < 0.5 ? "A" : null, showIcon: r() < 0.5 }, variant: { size: pick(["sm", "md", "lg", null]) } };
  if (k < 0.24 && insts.length) return { op: "instance.swap", id: pick(insts), of: pick(comps) };
  if (k < 0.32 && insts.length) return { op: "instance.override", id: pick(insts), path: pick(["n22", "n23", "n81/n61", "n61", "n23/n91"]), set: { opacity: Math.round(r() * 10) / 10 } };
  if (k < 0.37 && insts.length) return { op: "instance.reset", id: pick(insts), ...(r() < 0.5 ? { paths: ["n81"] } : { props: true }) };
  if (k < 0.45 && insts.length) return { op: "instance.detach", ids: [pick(insts)] };
  if (k < 0.5) return { op: "component.create", ids: [pick(ids)] };
  if (k < 0.55) return { op: "component.addVariant", set: "n20", variant: r() < 0.5 ? { size: `s${Math.floor(r() * 9)}` } : undefined };
  if (k < 0.6) return { op: "prop.define", id: pick(comps), name: pick(["extra", "label", "showIcon"]), def: pick([{ type: "text", default: "x" }, { type: "bool", default: true }, { type: "number", default: 1 }]) };
  if (k < 0.64) return { op: "prop.rename", id: "n20", name: pick(["label", "showIcon", "caption"]), to: pick(["caption", "label2", "flag"]) };
  if (k < 0.68) return { op: "prop.delete", id: pick(comps), name: pick(["label", "showIcon", "title", "extra"]) };
  if (k < 0.72) return { op: "prop.bind", id: pick(of("component")), layer: pick(ids), field: pick(["visible", "opacity", "text"]), prop: pick(["showIcon", "label", "title", null]) };
  if (k < 0.8) return { op: "node.create", type: pick(["rect", "text"]), parent: pick([...insts, ...of("component", "slot")]) };
  if (k < 0.86) return { op: "node.update", id: pick(of("text")), set: { opacity: 0.7 } };
  if (k < 0.92) return { op: "node.delete", ids: [pick(ids)] };
  if (k < 0.96) return { op: "node.duplicate", ids: [pick(ids)] };
  return { op: "component.combine", ids: of("component").filter((id) => !m.nodes[m.nodes[id].parent]?.type?.startsWith("componentSet")).filter(() => r() < 0.3) };
}

test("property: random component and instance sequences keep the model valid, resolvable and invertible", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const r = seededRandom(seed);
    let m = fixture();
    let applied = 0;
    for (let i = 0; i < 80; i++) {
      const op = randomComponentOp(m, r);
      const before = m;
      let res;
      try {
        res = O.apply(m, op, { random: r });
      } catch (e) {
        assert.ok(e instanceof O.OpError, `seed ${seed} step ${i} ${JSON.stringify(op)}: ${e.stack}`);
        assert.equal(m, before);
        continue;
      }
      applied++;
      assert.deepEqual(validate(res.model).errors, [], `seed ${seed} step ${i} ${JSON.stringify(op)}`);
      assert.deepEqual(O.apply(res.model, res.inverse).model, before, `seed ${seed} step ${i}: inverse of ${op.op}`);
      const rs = createResolver(res.model);
      for (const p of Object.keys(res.model.pages)) for (const t of rs.page(p)) treeCss(t, { vars: "css", resolver: rs });
      m = res.model;
    }
    assert.ok(applied > 30, `seed ${seed}: only ${applied} operations applied`);
  }
});
