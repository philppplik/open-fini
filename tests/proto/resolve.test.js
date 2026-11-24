// Proto resolver (docs/concepts/proto-studio.md §3.3, §3.4, §4.1, task T2): variables per mode with aliases, styles,
// the baseline instance expansion with overrides by source-id path, and the hooks T5 builds on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createResolver, resolve, resolvePage, cssVarName, slug, pickVariant, walkResolved, rfield } from "../../app/src/engine/proto/resolve.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const sample = () => structuredClone(SAMPLE);

test("resolve imports in plain Node without a DOM", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(typeof createResolver, "function");
});

test("bindings resolve to the values of the active modes and are recorded by path", () => {
  const m = sample();
  const r = createResolver(m);
  const t = r.tree("n1");
  assert.equal(t.node.layout.gap, 16);
  assert.equal(t.node.fills[0].color, "#ffffff");
  assert.deepEqual(t.bound, { "layout.gap": "v9", "fills.0.color": "v1" });
  // the stored model is untouched
  assert.deepEqual(m.nodes.n1.layout.gap, { $var: "v9" });
  // a node's own modes switch its subtree; aliases are followed in the same modes
  m.nodes.n1.modes = { c1: "dark" };
  const dark = createResolver(m).tree("n1");
  assert.equal(dark.node.fills[0].color, "#18181b");
  assert.equal(dark.children[0].node.text.style.color, "#fafafa");
  assert.equal(createResolver(m).variable("v2", { c1: "dark" }), "#818cf8");
});

test("modes: node, then ancestors, then page, then the resolver's modes, then the collection default", () => {
  const m = sample();
  delete m.nodes.n1.modes;
  m.pages.p1.modes = { c1: "dark" };
  const r = createResolver(m);
  assert.deepEqual(r.modesAt("n2"), { c1: "dark" });
  assert.equal(r.tree("n2").node.text.style.color, "#fafafa");
  delete m.pages.p1.modes;
  const forced = createResolver(m, { modes: { c1: "dark" } });
  assert.equal(forced.tree("n1").node.fills[0].color, "#18181b");
  assert.equal(createResolver(m).tree("n1").node.fills[0].color, "#ffffff");
  // an unknown mode falls back to the collection default
  assert.equal(createResolver(m).variable("v1", { c1: "nope" }), "#ffffff");
  assert.equal(createResolver(m).modeOf("c1", {}), "light");
});

test("unresolvable variables become undefined with a warning, never an exception", () => {
  const m = sample();
  m.vars.items.v1.values = {};
  const r = createResolver(m);
  const t = r.tree("n1");
  assert.equal(t.node.fills[0].color, undefined);
  assert.ok(r.warnings.some((w) => w.code === "unresolved-variable"));
  // an alias cycle (rejected by validate.js) still terminates
  m.vars.items.v2.values = { light: { $var: "v7" }, dark: { $var: "v7" } };
  m.vars.items.v7.values = { light: { $var: "v2" }, dark: { $var: "v2" } };
  assert.equal(createResolver(m).variable("v2", {}), undefined);
});

test("text run strings bound to string variables resolve; interactions and component data are left alone", () => {
  const m = sample();
  m.vars.items.vs = { name: "copy/total", coll: "c3", type: "string", values: { base: "Sum " } };
  m.nodes.n2.text.runs[0].t = { $var: "vs" };
  const t = createResolver(m).tree("n2");
  assert.equal(t.node.text.runs[0].t, "Sum ");
  assert.equal(t.bound["text.runs.0.t"], "vs");
  const inst = createResolver(m).tree("n5");
  assert.equal(inst.node.proto[2].do[0].cond.var, "v30");
});

test("styles: text, effect, fill and stroke references apply over local fields", () => {
  const m = sample();
  m.styles.s2.value = { font: "Georgia", size: 20 };
  m.styles.sf = { name: "Brand", kind: "fill", value: [{ type: "solid", color: "#ff0000" }] };
  m.nodes.n3.style = { effect: "s9", fill: "sf", stroke: "sf" };
  const r = createResolver(m);
  const text = r.tree("n2").node.text.style;
  assert.equal(text.font, "Georgia");
  assert.equal(text.size, 20);
  assert.equal(text.weight, 400, "fields the style does not set stay local");
  const card = r.tree("n3");
  assert.equal(card.node.fills[0].color, "#ff0000");
  assert.equal(card.node.strokes[0].color, "#ff0000");
  assert.equal(card.node.effects[0].color, "#0000001f", "the effect style's binding resolved in the node's modes");
  assert.equal(card.bound["effects.0.color"], "v12");
});

test("css variable names: code.css, else the slug of the name", () => {
  assert.equal(cssVarName({ name: "color/bg/surface", code: { css: "--surface" } }), "--surface");
  assert.equal(cssVarName({ name: "Space / 4 (Café)" }), "--space-4-cafe");
  assert.equal(cssVarName({ name: "" }, "v1"), "--v1");
  assert.equal(cssVarName({ name: "x", code: { css: "bad; value" } }), "--x");
  assert.equal(slug("  Brand B  "), "brand-b");
  assert.equal(createResolver(sample()).cssName("v9"), "--space-4");
});

test("variant picking: set defaults, the instance's values, then the best partial match", () => {
  const m = sample();
  assert.equal(pickVariant(m, m.nodes.n20, {}).id, "n21");
  assert.equal(pickVariant(m, m.nodes.n20, { size: "lg" }).id, "n24");
  assert.equal(pickVariant(m, m.nodes.n20, { size: "sm" }).id, "n21");
  assert.equal(pickVariant(m, m.nodes.n24, {}).id, "n24", "an instance of one variant keeps its values");
  assert.equal(pickVariant(m, m.nodes.n90, {}).id, "n90");
  assert.equal(pickVariant(m, m.nodes.n1, {}), null);
});

test("instances expand into virtual layers keyed by path, with overrides by source-id path", () => {
  const m = sample();
  m.nodes.n5.variant = { size: "md" };
  const t = createResolver(m).tree("n5");
  assert.equal(t.type, "instance");
  assert.equal(t.node.layout.pad[1], 16, "the main component's layout");
  assert.equal(t.node.w.mode, "hug", "the instance's own sizing");
  assert.deepEqual(t.children.map((c) => c.key), ["n5/n23", "n5/n22"]);
  const label = t.children[1];
  assert.equal(label.id, "n22");
  assert.equal(label.instance, "n5");
  assert.equal(label.node.fills[0].color, "#ffffff", "override on n22");
  // nested instance: n23 is an instance of n90 whose layer n91 is reached as "n23/n91"
  const icon = t.children[0];
  assert.deepEqual(icon.children.map((c) => c.key), ["n5/n23/n91"]);
  m.nodes.n5.over["n23/n91"] = { strokes: [{ color: "#ff0000", w: 3 }] };
  m.nodes.n23.over = { n91: { strokes: [{ color: "#00ff00", w: 1 }] } };
  const t2 = createResolver(m).tree("n5");
  assert.equal(t2.children[0].children[0].node.strokes[0].color, "#ff0000", "the outer instance wins");
  delete m.nodes.n5.over["n23/n91"];
  assert.equal(createResolver(m).tree("n5").children[0].children[0].node.strokes[0].color, "#00ff00");
});

test("missing components and component cycles resolve as empty containers with warnings", () => {
  const m = sample();
  m.nodes.n5.of = "lib:abc/def";
  delete m.nodes.n5.variant;
  delete m.nodes.n5.props;
  const r = createResolver(m);
  const t = r.tree("n5");
  assert.equal(t.children.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "missing-component"));
  // a cycle the validator would reject: n90 contains an instance of itself
  const c = sample();
  c.nodes.nx = { id: "nx", type: "instance", name: "Loop", page: "p2", parent: "n90", ord: "k", of: "n90" };
  const rc = createResolver(c);
  const tc = rc.tree("n90");
  const loop = tc.children.find((k) => k.id === "nx");
  assert.deepEqual(loop.children.map((k) => k.key), ["nx/n91", "nx/nx"], "one level is expanded");
  assert.equal(loop.children[1].children.length, 0);
  assert.ok(rc.warnings.some((w) => w.code === "component-cycle"));
});

test("hooks: instance, styles and variable lookup can be replaced (T5)", () => {
  const m = sample();
  const calls = [];
  const r = createResolver(m, {
    instance: (ctx, inst) => (calls.push(inst.id), { node: { ...inst, layout: { type: "none" } }, source: null, children: [] }),
    applyStyles: (ctx, node) => node,
    variableValue: (ctx, id) => (id === "v9" ? 99 : "#123456"),
  });
  assert.equal(r.tree("n1").node.layout.gap, 99);
  assert.equal(r.tree("n2").node.text.style.font, "Inter");
  calls.length = 0;
  r.tree("n5");
  assert.deepEqual(calls, ["n5"]);
});

test("pages, one-shot helpers, walking and field defaults", () => {
  const m = sample();
  assert.deepEqual(resolvePage(m, "p1").map((r) => r.key), ["n1", "n40"]);
  assert.equal(resolve(m, "nope"), null);
  const keys = [];
  walkResolved(resolve(m, "n1"), (r, parent) => keys.push(`${parent?.key ?? "-"}>${r.key}`));
  assert.deepEqual(keys, ["->n1", "n1>n2", "n1>n3", "n3>n4", "n1>n5"]);
  const r = resolve(m, "n40");
  assert.equal(rfield(r, "opacity"), 1);
  assert.equal(r.parent, null);
  assert.equal(r.children[0].parent, "n40");
});
