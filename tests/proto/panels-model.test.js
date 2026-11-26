// Pure view models of the Proto Studio's Assets, Variables and Styles UI and of the component, instance, binding and
// mode sections of the Design panel (app/src/proto/panels/model.js, task T6): what the panels show, and that every
// edit they offer is one valid operation (applied with its exact inverse).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as O from "../../app/src/engine/proto/ops.js";
import * as P from "../../app/src/proto/panels/model.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const sample = () => structuredClone(SAMPLE);
/** Applies an operation as the panels do: valid result, exact inverse. */
function step(m, op, seed = 1) {
  assert.ok(op, "an operation");
  const r = O.apply(m, op, { random: seededRandom(seed) });
  assert.deepEqual(validate(r.model).errors, [], JSON.stringify(op));
  assert.deepEqual(O.apply(r.model, r.inverse).model, m, `inverse of ${op.op}`);
  return r;
}

test("assets: sets and single components (variants through their set), styles, search", () => {
  const m = sample();
  const { components, styles } = P.assetList(m);
  assert.deepEqual(
    components.map((c) => [c.id, c.type]),
    [
      ["n20", "componentSet"],
      ["n90", "component"],
    ],
  );
  assert.equal(components[0].variants, 2);
  assert.equal(components[0].preview, "n21", "a set previews its default variant");
  assert.ok(styles.length >= 1 && styles.every((s) => typeof s.kind === "string"));
  assert.deepEqual(P.assetList(m, { query: "icon" }).components.map((c) => c.id), ["n90"]);
  assert.deepEqual(P.assetList(m, { query: "lg" }).components.map((c) => c.id), ["n20"], "a set matches by variant names");
});

test("assets: insert an instance, create a component, combine as variants", () => {
  let m = sample();
  const ins = step(m, P.insertInstanceOp(m, "n20", { page: "p1", x: 400.4, y: 20 }));
  const inst = ins.model.nodes[ins.ids[0]];
  assert.equal(inst.type, "instance");
  assert.equal(inst.of, "n20");
  assert.equal(inst.x, 400);
  assert.equal(inst.parent, null);
  const flow = step(m, P.insertInstanceOp(m, "n90", { page: "p1", parent: "n3", index: 0 }));
  assert.equal(flow.model.nodes[flow.ids[0]].parent, "n3");

  // two frames → two components → one set
  m = step(m, { op: "node.create", type: "frame", page: "p1", id: "na1", fields: { name: "state=on" } }).model;
  m = step(m, { op: "node.create", type: "frame", page: "p1", id: "na2", fields: { name: "state=off" } }).model;
  assert.equal(P.canCreateComponent(m, ["na1"]), true);
  assert.equal(P.canCreateComponent(m, ["n5"]), false, "instances do not become components");
  assert.equal(P.canCreateComponent(m, ["n22"]), false, "layers inside a component do not");
  m = step(m, P.componentOp(m, ["na1"])).model;
  m = step(m, P.componentOp(m, ["na2"])).model;
  assert.equal(m.nodes.na1.type, "component");
  assert.equal(P.canCombine(m, ["na1", "na2"]), true);
  assert.equal(P.canCombine(m, ["na1"]), false);
  assert.equal(P.canCombine(m, ["na1", "n21"]), false, "a variant of a set cannot be combined again");
  const r = step(m, P.combineOp(m, ["na1", "na2"], "Toggle"));
  const set = r.model.nodes[r.ids[0]];
  assert.equal(set.type, "componentSet");
  assert.deepEqual(set.props.state.options, ["on", "off"]);
});

test("instance section: main component, variant axes, properties with swap options, overrides", () => {
  const m = sample();
  const info = P.instanceInfo(m, "n5");
  assert.equal(info.of, "n20");
  assert.equal(info.missing, false);
  const axes = Object.fromEntries(info.axes.map((a) => [a.name, a]));
  assert.ok(axes.size.options.includes("lg"));
  assert.equal(axes.size.value, m.nodes.n5.variant?.size ?? m.nodes.n20.props.size.default);
  const label = info.props.find((p) => p.name === "label");
  assert.equal(label.type, "text");
  assert.equal(label.value, m.nodes.n5.props?.label ?? m.nodes.n20.props.label.default);
  const icon = info.props.find((p) => p.type === "swap");
  if (icon) assert.ok(icon.options.length >= 1 && icon.options.some((o) => o.id === "n90"));
  assert.equal(info.main, P.mainOf(m, "n5").id);
  assert.equal(P.instanceInfo(m, "n1"), null, "not an instance");
  assert.ok(P.swapChoices(m, "n5").find((c) => c.id === "n20").current);

  // variant picker, property field, reset and detach are single operations
  step(m, { op: "instance.set", id: "n5", variant: { size: "lg" } });
  step(m, { op: "instance.set", id: "n5", props: { label: "Pay" } });
  const over = step(m, { op: "instance.override", id: "n5", path: "n22", set: { opacity: 0.5 } }).model;
  assert.equal(P.overrideSummary(over, "n5").count, (P.overrideSummary(m, "n5").count || 0) + (m.nodes.n5.over?.n22 ? 0 : 1));
  const reset = step(over, { op: "instance.reset", id: "n5" }).model;
  assert.equal(P.overrideSummary(reset, "n5").count, 0);
  const det = step(m, { op: "instance.detach", ids: ["n5"] }).model;
  assert.equal(det.nodes.n5.type, "frame");
});

test("component section: properties, variants, property bindings of inner layers", () => {
  const m = sample();
  const info = P.componentInfo(m, "n21");
  assert.equal(info.owner, "n20", "a variant shows its set's properties");
  assert.equal(info.isSet, true);
  assert.deepEqual(info.variants.map((v) => v.id).sort(), ["n21", "n24"]);
  assert.ok(info.props.some((p) => p.name === "size" && p.type === "variant" && p.options.includes("md")));
  for (const type of ["text", "bool", "number", "slot", "variant", "swap"]) {
    const def = P.newPropDef(type, m, "n20");
    step(m, { op: "prop.define", id: "n20", name: `new ${type}`, def });
  }
  const targets = P.propBindTargets(m, "n22");
  const text = targets.find((x) => x.field === "text");
  assert.ok(text, "a text layer of a component can bind its content");
  assert.equal(text.comp, "n21");
  assert.ok(text.props.some((p) => p.name === "label"));
  const r = step(m, { op: "prop.bind", id: text.comp, layer: "n22", field: "visible", prop: text.prop ? null : null });
  assert.ok(r.model);
  assert.deepEqual(P.propBindTargets(m, "n2"), [], "a layer outside components has no property bindings");
});

test("bindings: field types, candidates by type and scope, common bindings, one batch for several layers", () => {
  const m = sample();
  assert.equal(P.fieldType("fills.0.color"), "color");
  assert.equal(P.fieldType("layout.gap"), "number");
  assert.equal(P.fieldType("w.value"), "number");
  assert.equal(P.fieldType("visible"), "bool");
  assert.equal(P.fieldType("text.style.font"), "string");
  const colors = P.bindCandidates(m, "fills.0.color");
  assert.ok(colors.every((g) => g.items.every((i) => i.type === "color")));
  const v1 = colors.flatMap((g) => g.items).find((i) => i.id === "v1");
  assert.equal(v1.allowed, true, "v1 is scoped to fills");
  const strokes = P.bindCandidates(m, "strokes.0.color").flatMap((g) => g.items);
  assert.equal(strokes.find((i) => i.id === "v1").allowed, false, "…not to strokes");
  assert.deepEqual(P.bindCandidates(m, "layout.gap").flatMap((g) => g.items).map((i) => i.id), ["v9"]);
  assert.deepEqual(P.bindCandidates(m, "fills.0.color", { query: "brand" }).flatMap((g) => g.items).map((i) => i.id).sort(), ["v2", "v7"]);

  const ids = ["n1", "n3"].filter((id) => Array.isArray(m.nodes[id].fills) && m.nodes[id].fills.length);
  const op = P.bindOp(m, ids, "fills.0.color", "v1");
  const r = step(m, op);
  assert.deepEqual(P.commonBinding(r.model, ids, "fills.0.color"), { var: "v1", mixed: false });
  if (ids.length > 1) assert.equal(op.op, "batch");
  const un = step(r.model, P.bindOp(r.model, ids, "fills.0.color", null));
  assert.equal(P.commonBinding(un.model, ids, "fills.0.color").var, null);
  assert.equal(typeof un.model.nodes[ids[0]].fills[0].color, "string", "unbinding writes the value");
  assert.equal(P.bindOp(m, ["n4"], "opacity", null), null, "nothing to unbind");
  assert.equal(P.varLabel(m, "v2"), "color/brand");
});

test("variables table: rows per variable, cells per mode, aliases, brand overrides", () => {
  const m = sample();
  const list = P.collectionsList(m);
  assert.deepEqual(list.map((c) => [c.id, c.depth]), [
    ["c1", 0],
    ["c2", 1],
    ["c3", 0],
  ]);
  const t = P.variableTable(m, "c1");
  assert.deepEqual(t.modes.map((x) => x.id), ["light", "dark"]);
  const brand = t.rows.find((r) => r.id === "v2");
  assert.equal(brand.cells[1].alias, "v7");
  assert.equal(brand.cells[1].value, "#818cf8");
  assert.equal(brand.own, true);

  // edit a cell; set an alias; a brand override and its reset
  let r = step(m, P.cellOp(m, "c1", "v1", "dark", "#000000"));
  assert.equal(r.model.vars.items.v1.values.dark, "#000000");
  r = step(m, P.cellOp(m, "c1", "v3", "light", { $var: "v7" }));
  assert.equal(P.variableTable(r.model, "c1").rows.find((x) => x.id === "v3").cells[0].alias, "v7");
  const b0 = P.variableTable(m, "c2");
  assert.ok(b0.rows.every((x) => !x.own && x.cells.every((c) => c.inherited)), "a brand starts with the base's values");
  r = step(m, P.cellOp(m, "c2", "v1", "light", "#fef3c7"));
  const b1 = P.variableTable(r.model, "c2").rows.find((x) => x.id === "v1");
  assert.equal(b1.cells[0].override, true);
  assert.equal(b1.cells[0].value, "#fef3c7");
  assert.equal(P.variableTable(r.model, "c1").rows.find((x) => x.id === "v1").cells[0].value, "#ffffff", "the base keeps its value");
  const back = step(r.model, P.resetCellOp(r.model, "c2", "v1", "light"));
  assert.deepEqual(back.model.vars.items.v1, m.vars.items.v1);
  assert.equal(P.resetCellOp(m, "c2", "v1", "light"), null);
  assert.equal(P.variableTable(m, "nope"), null);
  assert.deepEqual(P.variableTable(m, "c1", { query: "text" }).rows.map((x) => x.id), ["v3"]);
});

test("cells: parsing and formatting values per type", () => {
  assert.equal(P.parseCell("color", "#ABC"), "#aabbcc");
  assert.equal(P.parseCell("color", "ff000080"), "#ff000080");
  assert.equal(P.parseCell("color", "red"), undefined);
  assert.equal(P.parseCell("number", "1,5"), 1.5);
  assert.equal(P.parseCell("number", ""), undefined);
  assert.equal(P.parseCell("bool", "yes"), true);
  assert.equal(P.parseCell("bool", "maybe"), undefined);
  assert.equal(P.parseCell("string", "  Hi "), "Hi");
  assert.equal(P.formatValue("number", 1 / 3), "0.333");
  assert.equal(P.formatValue("bool", false), "false");
  assert.equal(P.uniqueName(["Color", "Color 2"], "Color"), "Color 3");
  assert.equal(P.uniqueName(new Set(), "Space"), "Space");
});

test("mode switcher: families with modes or brands, selection on a frame and on the page", () => {
  const m = sample();
  const ch = P.modeChoices(m, "n1", "p1");
  const color = ch.find((c) => c.root === "c1");
  assert.ok(color, "Color has two modes and a brand");
  assert.deepEqual(color.colls.map((c) => c.id), ["c1", "c2"]);
  assert.ok(!ch.some((c) => c.root === "c3"), "one mode and no brand: nothing to switch");
  let r = step(m, P.modeOp(m, "n1", "p1", "c1", "c1", "dark"));
  assert.deepEqual(r.model.nodes.n1.modes?.c1, "dark");
  assert.equal(P.modeChoices(r.model, "n1", "p1").find((c) => c.root === "c1").mode, "dark");
  // the brand replaces the base's selection of the same family
  r = step(r.model, P.modeOp(r.model, "n1", "p1", "c1", "c2", "light"));
  assert.deepEqual(Object.keys(r.model.nodes.n1.modes || {}).filter((k) => k === "c1" || k === "c2"), ["c2"]);
  const kid = Object.values(r.model.nodes).find((n) => n.parent === "n1");
  if (kid) assert.equal(P.modeChoices(r.model, kid.id, "p1").find((c) => c.root === "c1").inherited.coll, "c2");
  r = step(r.model, P.modeOp(r.model, "n1", "p1", "c1", null));
  assert.equal(r.model.nodes.n1.modes?.c2, undefined);
  const pg = step(m, P.modeOp(m, null, "p1", "c1", "c1", "dark"));
  assert.equal(pg.model.pages.p1.modes.c1, "dark");
  // the resolver sees the selection
  const res = createResolver(step(m, P.modeOp(m, "n1", "p1", "c1", "c1", "dark")).model);
  assert.equal(res.modesAt("n1").c1, "dark");
});

test("styles: create from a layer, apply, detach, update from a layer; tokens export formats", () => {
  const m = step(sample(), { op: "node.create", type: "rect", page: "p1", id: "nr1", fields: { fills: [{ type: "solid", color: "#ff0000" }] } }).model;
  const withFill = m.nodes.nr1;
  assert.ok(P.styleKindsOf(withFill).includes("fill"));
  const c = step(m, P.styleFromSelectionOp(m, withFill.id, "fill", "Surface"));
  const sid = c.ids[0];
  assert.equal(c.model.nodes[withFill.id].style.fill, sid);
  assert.deepEqual(P.styleSlotInfo(c.model, [withFill.id], "fill"), { style: sid, mixed: false, name: "Surface" });
  assert.ok(P.stylesOfKind(c.model, "fill").some((s) => s.id === sid));
  const d = step(c.model, P.detachStyleOp([withFill.id], "fill"));
  assert.equal(d.model.nodes[withFill.id].style?.fill, undefined);
  const a = step(d.model, P.applyStyleOp([withFill.id], "fill", sid));
  assert.equal(a.model.nodes[withFill.id].style.fill, sid);
  const up = step(c.model, P.updateStyleFromOp(c.model, sid, "n1"));
  assert.deepEqual(up.model.styles[sid].value, c.model.nodes.n1.fills);
  assert.equal(P.styleFromSelectionOp(m, "n2", "grid", "x"), null, "a text has no grid");
  for (const f of ["dtcg", "css", "tailwind", "swift"]) {
    const out = P.tokenExport(m, f);
    assert.ok(out.text.length > 20 && out.name.includes("."), f);
  }
  assert.ok(JSON.parse(P.tokenExport(m, "dtcg").text));
  assert.match(P.tokenExport(m, "css").text, /--color-bg-surface/);
});
