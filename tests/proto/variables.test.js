// Proto variables, modes, extending collections and styles (docs/concepts/proto-studio.md §3.4, task T5): value lookup
// per mode with brand overrides and aliases, family-wise mode selection, scopes, the variable, mode and style operations
// with exact inverses, the CSS custom-property rules of css.js, and a property test over random sequences.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as O from "../../app/src/engine/proto/ops.js";
import * as V from "../../app/src/engine/proto/variables.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { nodeCss, treeCss, varRules, varSheet, declsToObject } from "../../app/src/engine/proto/css.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const sample = () => structuredClone(SAMPLE);
const opts = (seed = 1) => ({ random: seededRandom(seed) });
const run = (m, op, seed) => O.apply(m, op, opts(seed));
const code = (fn) => (e) => e instanceof O.OpError && (typeof fn === "string" ? e.code === fn : fn(e));
/** Applies, checks validity and the exact inverse, and returns the result. */
function step(m, op, seed = 1) {
  const r = run(m, op, seed);
  assert.deepEqual(validate(r.model).errors, [], JSON.stringify(op));
  assert.deepEqual(O.apply(r.model, r.inverse).model, m, `inverse of ${op.op}`);
  return r;
}

/** The sample with a brand collection that overrides two colors. */
function brands() {
  const m = sample();
  m.vars.items.v1.ext = { c2: { light: "#fef3c7", dark: "#451a03" } };
  m.vars.items.v2.ext = { c2: { dark: { $var: "v3" } } };
  return m;
}

test("extending collections: brand overrides, inherited values and aliases in the brand's modes", () => {
  const m = brands();
  assert.deepEqual(validate(m).errors, []);
  assert.equal(V.variableValue(m, "v1", {}), "#ffffff");
  assert.equal(V.variableValue(m, "v1", { c1: "dark" }), "#18181b");
  assert.equal(V.variableValue(m, "v1", { c2: "light" }), "#fef3c7", "the brand's override");
  assert.equal(V.variableValue(m, "v1", { c2: "dark" }), "#451a03");
  assert.equal(V.variableValue(m, "v3", { c2: "dark" }), "#fafafa", "not overridden: the base value in the brand's mode");
  assert.equal(V.variableValue(m, "v2", { c2: "dark" }), "#fafafa", "an override that is an alias");
  assert.equal(V.variableValue(m, "v2", { c2: "light" }), "#4f46e5");
  assert.deepEqual(V.rawValue(m, "v2", { c2: "dark" }), { $var: "v3" });
  // a nested brand of the brand
  m.vars.collections.c4 = { name: "Brand C", extends: "c2", modes: structuredClone(m.vars.collections.c1.modes), default: "light" };
  m.vars.items.v3.ext = { c4: { light: "#00ff00" } };
  assert.deepEqual(validate(m).errors, []);
  assert.equal(V.variableValue(m, "v3", { c4: "light" }), "#00ff00");
  assert.equal(V.variableValue(m, "v1", { c4: "light" }), "#fef3c7", "the nearer brand's override");
  assert.deepEqual(V.chainOf(m.vars.collections, "c4"), ["c4", "c2", "c1"]);
  assert.deepEqual(V.familyOf(m.vars.collections, "c2"), ["c1", "c2", "c4"]);
  // validation: overrides only from collections that extend the variable's collection; extending modes mirror the base
  const bad = brands();
  bad.vars.items.v9.ext = { c2: { base: 1 } };
  assert.ok(validate(bad).errors.some((e) => e.code === "ext-collection"));
  bad.vars.items.v9.ext = undefined;
  bad.vars.collections.c2.modes = [{ id: "light", name: "Light" }];
  assert.ok(validate(bad).errors.some((e) => e.code === "extends-modes"));
});

test("mode selection: a deeper selection replaces the inherited selection of the same family", () => {
  const colls = brands().vars.collections;
  assert.deepEqual(V.mergeModes(colls, { c1: "dark", c3: "base" }, { c2: "light" }), { c3: "base", c2: "light" });
  assert.deepEqual(V.mergeModes(colls, { c2: "light" }, { c1: "dark" }), { c1: "dark" });
  assert.deepEqual(V.mergeModes(colls, {}, { c1: "dark", c2: "light" }), { c2: "light" }, "inside one object the most derived wins");
  assert.deepEqual(V.selection(colls, { c2: "dark" }, "c1"), { sel: "c2", mode: "dark" });
  assert.deepEqual(V.selection(colls, { c2: "nope" }, "c1"), { sel: "c2", mode: "light" });
  // the resolver: a frame in brand B, dark, with a card that switches back to the base collection in light mode
  const m = brands();
  m.nodes.n1.modes = { c2: "dark" };
  m.nodes.n3.modes = { c1: "light" };
  m.nodes.n3.fills = [{ type: "solid", color: { $var: "v1" } }];
  const r = createResolver(m);
  const t = r.tree("n1");
  assert.equal(t.node.fills[0].color, "#451a03");
  assert.equal(t.children[1].node.fills[0].color, "#ffffff");
  assert.deepEqual(r.modesAt("n4"), { c1: "light" });
  // the resolver's modes apply over the page's, the layers' over both
  m.pages.p1.modes = { c1: "dark" };
  delete m.nodes.n1.modes;
  assert.equal(createResolver(m).tree("n1").node.fills[0].color, "#18181b");
  assert.equal(createResolver(m, { modes: { c2: "light" } }).tree("n1").node.fills[0].color, "#fef3c7");
});

test("css: custom property rules for defaults, every mode and every brand; layers switch them by attribute", () => {
  const m = brands();
  m.vars.items.vp = { name: "space/pad", coll: "c3", type: "number", values: { base: 12 } };
  m.vars.items.vx = { name: "color/link", coll: "c1", type: "color", values: { light: { $var: "v2" }, dark: { $var: "v2" } } };
  m.vars.collections.c5 = { name: "Primitives", modes: [{ id: "base", name: "Base" }], default: "base" };
  m.vars.items.vq = { name: "prim/red", coll: "c5", type: "color", values: { base: "#ff0000" } };
  m.vars.items.vy = { name: "color/danger", coll: "c1", type: "color", values: { light: { $var: "vq" }, dark: "#990000" } };
  assert.deepEqual(validate(m).errors, []);
  const rules = varRules(m);
  const at = (sel) => Object.fromEntries(rules.find((r) => r.selector === sel)?.decls || []);
  assert.equal(at(":root")["--color-bg-surface"], "#ffffff");
  assert.equal(at(":root")["--space-pad"], "12", "a number without a unit");
  assert.equal(at(":root")["--space-4"], "16px");
  assert.equal(at(":root")["--color-link"], "#4f46e5", "an alias in the same family is its value");
  assert.equal(at(":root")["--color-danger"], "var(--prim-red)", "an alias into another family follows that family");
  assert.equal(at('[data-mode-color="dark"]')["--color-bg-surface"], "#18181b");
  assert.equal(at('[data-mode-brand-b="light"]')["--color-bg-surface"], "#fef3c7");
  assert.equal(at('[data-mode-brand-b="dark"]')["--color-brand"], "#fafafa");
  assert.equal(at('[data-mode-brand-b="dark"]')["--color-text"], "#fafafa", "every variable of the family, overridden or not");
  assert.equal(at('[data-mode-brand-b="light"]')["--space-4"], undefined, "other families are not in a brand rule");
  // base collections come before the brands (the same element: the brand wins, as in the resolver)
  const idx = (s) => rules.findIndex((r) => r.selector === s);
  assert.ok(idx('[data-mode-color="dark"]') < idx('[data-mode-brand-b="dark"]'));
  assert.match(varSheet(m, { root: ":host" }), /^:host \{\n {2}--color-bg-surface: #ffffff;/);
  // the attribute a layer gets matches the rule's selector
  m.nodes.n1.modes = { c2: "dark" };
  const r = createResolver(m);
  assert.deepEqual(nodeCss(r.tree("n1"), { resolver: r }).attrs, { "data-mode-brand-b": "dark" });
  // a number variable without a unit bound to a length multiplies by 1px in "css" mode
  m.nodes.n1.layout.gap = { $var: "vp" };
  const d = declsToObject(treeCss(createResolver(m).tree("n1"), { vars: "css", resolver: createResolver(m) }).get("n1").decls);
  assert.equal(d["column-gap"], "calc(var(--space-pad, 12) * 1px)");
});

test("scopes: which fields a variable may be bound to", () => {
  assert.equal(V.scopeOf("fills.0.color"), "fill");
  assert.equal(V.scopeOf("strokes.1.color"), "stroke");
  assert.equal(V.scopeOf("text.style.size"), "fontSize");
  assert.equal(V.scopeOf("text.runs.0.t"), "content");
  assert.equal(V.scopeOf("layout.pad.2"), "padding");
  assert.equal(V.scopeOf("layout.gap"), "gap");
  assert.equal(V.scopeOf("w.value"), "size");
  assert.ok(V.canBind({ scopes: ["fill"] }, "fills.0.color"));
  assert.ok(!V.canBind({ scopes: ["fill"] }, "strokes.0.color"));
  assert.ok(V.canBind({ scopes: ["all"] }, "strokes.0.color"));
  assert.ok(V.canBind({}, "strokes.0.color"));
});

test("node.bind: bind list items and nested fields, refuse out-of-scope variables, unbind to the value", () => {
  const m = sample();
  let r = step(m, { op: "node.bind", id: "n3", path: "fills.0.stops.1.color", var: "v2" });
  assert.deepEqual(r.model.nodes.n3.fills[0].stops[1].color, { $var: "v2" });
  r = step(m, { op: "node.bind", id: "n3", path: "layout.rowGap", var: "v9" });
  assert.deepEqual(r.model.nodes.n3.layout.rowGap, { $var: "v9" });
  assert.throws(() => run(m, { op: "node.bind", id: "n3", path: "strokes.0.color", var: "v1" }), code("scope"));
  r = step(m, { op: "node.bind", id: "n3", path: "strokes.0.color", var: "v1", force: true });
  assert.deepEqual(r.model.nodes.n3.strokes[0].color, { $var: "v1" });
  assert.throws(() => run(m, { op: "node.bind", id: "n3", path: "layout.gap", var: "v1", force: true }), code("invalid"), "a color variable on a number field");
  assert.throws(() => run(m, { op: "node.bind", id: "n3", path: "fills.5.color", var: "v1" }), code("path"));
  assert.throws(() => run(m, { op: "node.bind", id: "n3", path: "name", var: "v1" }), code("field"));
  // unbinding writes the value in the layer's modes (n1 is in light mode, its page has none)
  m.nodes.n1.modes = { c1: "dark" };
  r = step(m, { op: "node.bind", id: "n1", path: "fills.0.color", var: null });
  assert.equal(r.model.nodes.n1.fills[0].color, "#18181b");
  assert.equal(run(m, { op: "node.bind", id: "n1", path: "fills.0.opacity", var: null }).model, m, "not bound: a no-op");
});

test("collections and modes: create, update, delete with cascades and exact inverses", () => {
  const m = sample();
  let r = step(m, { op: "collection.create", id: "c9", name: "Density", modes: [{ name: "Comfortable" }, { name: "Compact" }] });
  assert.deepEqual(r.model.vars.collections.c9, { name: "Density", modes: [{ id: "comfortable", name: "Comfortable" }, { id: "compact", name: "Compact" }], default: "comfortable" });
  r = step(m, { op: "collection.create", id: "c8", name: "Brand C", extends: "c1" });
  assert.deepEqual(r.model.vars.collections.c8.modes, m.vars.collections.c1.modes);
  step(m, { op: "collection.update", id: "c1", set: { name: "Colors", default: "dark" } });
  assert.throws(() => run(m, { op: "collection.update", id: "c1", set: { default: "nope" } }), code("invalid"));
  assert.throws(() => run(m, { op: "collection.update", id: "c1", set: { modes: [] } }), code("field"));
  // a new mode copies the values of another mode, in the whole family (also the brand's overrides)
  const b = brands();
  r = step(b, { op: "mode.create", coll: "c1", name: "High contrast", from: "dark" });
  assert.equal(r.ids[0], "high-contrast");
  assert.equal(r.model.vars.items.v1.values["high-contrast"], "#18181b");
  assert.equal(r.model.vars.items.v1.ext.c2["high-contrast"], "#451a03");
  assert.deepEqual(r.model.vars.collections.c2.modes.map((x) => x.id), ["light", "dark", "high-contrast"]);
  assert.throws(() => run(b, { op: "mode.create", coll: "c2", name: "X" }), code("extends"));
  step(b, { op: "mode.update", coll: "c1", id: "dark", name: "Night" });
  // deleting a mode removes its values and the selections of it; the default moves
  b.nodes.n1.modes = { c2: "light" };
  b.pages.p1.modes = { c1: "light" };
  r = step(b, { op: "mode.delete", coll: "c1", id: "light" });
  assert.equal(r.model.vars.collections.c1.default, "dark");
  assert.equal(r.model.vars.items.v1.values.light, undefined);
  assert.deepEqual(r.model.vars.items.v1.ext.c2, { dark: "#451a03" });
  assert.equal(r.model.nodes.n1.modes, undefined);
  assert.equal(r.model.pages.p1.modes, undefined);
  assert.throws(() => run(r.model, { op: "mode.delete", coll: "c1", id: "dark" }), code("last-mode"));
  // a collection that is extended or whose variables are bound cannot be deleted without detach
  assert.throws(() => run(m, { op: "collection.delete", id: "c1" }), code("in-use"));
  assert.throws(() => run(m, { op: "collection.delete", id: "c3" }), code("in-use"));
  r = step(m, { op: "collection.delete", id: "c3", detach: true });
  assert.equal(r.model.vars.items.v9, undefined);
  assert.equal(r.model.nodes.n1.layout.gap, 16, "the binding became its value");
  r = step(brands(), { op: "collection.delete", id: "c2" });
  assert.equal(r.model.vars.items.v1.ext, undefined, "the brand's overrides go with it");
});

test("variables: create, update, alias cycles, delete with detach, type changes", () => {
  const m = sample();
  let r = step(m, { op: "var.create", id: "v50", coll: "c1", name: "color/accent", type: "color", values: { dark: "#ff00ff" }, value: "#00ffff", scopes: ["fill"] });
  assert.deepEqual(r.model.vars.items.v50, { name: "color/accent", coll: "c1", type: "color", values: { light: "#00ffff", dark: "#ff00ff" }, scopes: ["fill"] });
  r = step(m, { op: "var.create", coll: "c3", name: "space/8", type: "number", unit: "px" });
  assert.equal(r.model.vars.items[r.ids[0]].values.base, 0);
  assert.throws(() => run(m, { op: "var.create", coll: "c1", name: "color/brand", type: "color" }), code("exists"));
  assert.throws(() => run(m, { op: "var.create", coll: "c1", name: "x", type: "date" }), code("type"));
  assert.throws(() => run(m, { op: "var.create", coll: "zz", name: "x", type: "color" }), code("not-found"));
  // values per mode, overrides of a brand, aliases
  r = step(m, { op: "var.update", id: "v3", set: { "values.dark": { $var: "v7" }, "ext.c2.light": "#123456" } });
  assert.deepEqual(r.model.vars.items.v3.values.dark, { $var: "v7" });
  assert.equal(r.model.vars.items.v3.ext.c2.light, "#123456");
  assert.throws(() => run(m, { op: "var.update", id: "v7", set: { "values.light": { $var: "v2" } } }), code((e) => e.code === "invalid" && e.problems.some((p) => p.code === "alias-cycle")));
  assert.throws(() => run(m, { op: "var.update", id: "v7", set: { "values.light": { $var: "v9" } } }), code("invalid"), "an alias of another type");
  assert.throws(() => run(m, { op: "var.update", id: "v1", set: { type: "number" } }), code("in-use"));
  assert.throws(() => run(m, { op: "var.update", id: "v1", set: { name: "color/brand" } }), code("exists"));
  // delete: refused while used; detach writes the values in each user's modes
  assert.throws(() => run(m, { op: "var.delete", ids: ["v1"] }), code("in-use"));
  m.nodes.n40.fills = [{ type: "solid", color: { $var: "v1" } }];
  m.nodes.n40.modes = { c1: "dark" };
  r = step(m, { op: "var.delete", ids: ["v1", "v7"], detach: true });
  assert.equal(r.model.nodes.n1.fills[0].color, "#ffffff");
  assert.equal(r.model.nodes.n40.fills[0].color, "#18181b");
  assert.equal(r.model.vars.items.v2.values.dark, "#818cf8", "an alias of a deleted variable becomes its value in that mode");
  r = step(sample(), { op: "var.delete", ids: ["v30"] });
  assert.equal(r.model.vars.items.v30, undefined);
});

test("styles: create from a layer, apply, update, detach, delete, and grid styles", () => {
  const m = sample();
  let r = step(m, { op: "style.create", id: "sc", name: "Card/Fill", kind: "fill", from: "n3" });
  assert.deepEqual(r.model.styles.sc.value, m.nodes.n3.fills);
  assert.equal(r.model.nodes.n3.style.fill, "sc");
  assert.throws(() => run(m, { op: "style.create", name: "x", kind: "text", from: "n3" }), code("style-source"));
  assert.throws(() => run(m, { op: "style.create", name: "x", kind: "nope" }), code("type"));
  // apply and remove references
  r = step(m, { op: "style.apply", ids: ["n2", "n3"], slot: "effect", style: "s9" });
  assert.equal(r.model.nodes.n2.style.effect, "s9");
  assert.throws(() => run(m, { op: "style.apply", ids: ["n3"], slot: "text", style: "s9" }), code("style-kind"));
  r = step(m, { op: "style.apply", ids: ["n3"], slot: "effect", style: null });
  assert.equal(r.model.nodes.n3.style, undefined);
  // updating the style changes every user
  r = step(m, { op: "style.update", id: "s2", set: { "value.size": 20 } });
  assert.equal(createResolver(r.model).tree("n2").node.text.style.size, 20);
  // detaching bakes the values in
  r = step(m, { op: "style.detach", ids: ["n2"] });
  assert.equal(r.model.nodes.n2.style, undefined);
  assert.equal(r.model.nodes.n2.text.style.lineHeight.pct, 150);
  const { style: _ref, ...styled } = createResolver(m).tree("n2").node;
  assert.deepEqual(createResolver(r.model).tree("n2").node, styled, "the same resolved values");
  // deleting a used style
  assert.throws(() => run(m, { op: "style.delete", ids: ["s9"] }), code("in-use"));
  r = step(m, { op: "style.delete", ids: ["s9"], detach: true });
  assert.deepEqual(r.model.nodes.n3.effects, m.styles.s9.value);
  // grid styles make a container a grid with the style's tracks and gaps
  r = step(m, { op: "style.create", id: "sg", name: "Grid/3", kind: "grid", value: { cols: [{ fr: 1 }, { fr: 1 }, { px: 200 }], gap: { $var: "v9" }, rowGap: 4 } });
  r = step(r.model, { op: "style.apply", ids: ["n40"], slot: "grid", style: "sg" });
  const res = createResolver(r.model);
  const t = res.tree("n40");
  assert.equal(t.node.layout.type, "grid");
  assert.equal(t.node.layout.gap, 16);
  assert.equal(t.bound["layout.gap"], "v9");
  const d = declsToObject(nodeCss(t, { vars: "css", resolver: res }).decls);
  assert.equal(d["grid-template-columns"], "1fr 1fr 200px");
  assert.equal(d["column-gap"], "var(--space-4, 16px)");
  assert.equal(d["row-gap"], "4px");
  assert.throws(() => run(m, { op: "style.create", name: "Bad", kind: "grid", value: { cols: [{ nope: 1 }] } }), code("invalid"));
  // a grid style from a grid layer
  r = step(m, { op: "style.create", name: "Card grid", kind: "grid", from: "n3" });
  assert.deepEqual(r.model.styles[r.ids[0]].value, { cols: m.nodes.n3.layout.grid.cols, rows: [{ auto: true }], areas: null, autoFlow: "row", dense: false, gap: 8, rowGap: 8 });
});

// ------------------------------------------------------------------------------------------------- property test

function randomVarOp(m, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const colls = Object.keys(m.vars.collections);
  const items = Object.keys(m.vars.items);
  const styles = Object.keys(m.styles);
  const nodes = Object.keys(m.nodes);
  const coll = pick(colls);
  const modes = V.modeIdsOf(m.vars.collections, coll);
  const k = r();
  if (k < 0.1) return { op: "collection.create", name: `C${Math.floor(r() * 100)}`, ...(r() < 0.4 ? { extends: coll } : { modes: [{ name: "A" }, { name: "B" }] }) };
  if (k < 0.14) return { op: "collection.delete", id: coll, detach: r() < 0.7 };
  if (k < 0.2) return { op: "mode.create", coll, name: `M${Math.floor(r() * 100)}` };
  if (k < 0.24) return { op: "mode.delete", coll, id: pick(modes) };
  if (k < 0.27) return { op: "mode.update", coll, id: pick(modes), name: "Renamed" };
  if (k < 0.37) {
    const type = pick(["color", "number", "string", "bool"]);
    return { op: "var.create", coll, name: `x/${Math.floor(r() * 1000)}`, type };
  }
  if (k < 0.5 && items.length) {
    const id = pick(items);
    const it = m.vars.items[id];
    const mode = pick(V.modeIdsOf(m.vars.collections, it.coll));
    const same = items.filter((x) => m.vars.items[x].type === it.type);
    const value = r() < 0.4 ? { $var: pick(same) } : it.type === "color" ? "#abcdef" : it.type === "number" ? Math.round(r() * 50) : it.type === "bool" ? true : "text";
    return { op: "var.update", id, set: { [`values.${mode}`]: value } };
  }
  if (k < 0.56 && items.length) return { op: "var.delete", ids: [pick(items)], detach: r() < 0.7 };
  if (k < 0.68 && items.length) {
    const id = pick(nodes);
    const colors = items.filter((x) => m.vars.items[x].type === "color");
    return { op: "node.bind", id, path: "fills.0.color", var: r() < 0.3 ? null : pick(colors.length ? colors : items), force: true };
  }
  if (k < 0.76) return { op: "style.create", name: `S${Math.floor(r() * 100)}`, kind: pick(["fill", "effect", "text"]), ...(r() < 0.5 ? { from: pick(nodes) } : {}) };
  if (k < 0.84 && styles.length) {
    const s = pick(styles);
    return { op: "style.apply", ids: [pick(nodes)], slot: V.slotOfKind(m.styles[s].kind), style: r() < 0.2 ? null : s };
  }
  if (k < 0.9 && styles.length) return { op: "style.delete", ids: [pick(styles)], detach: r() < 0.7 };
  if (k < 0.95) return { op: "style.detach", ids: [pick(nodes)] };
  const id = pick(nodes);
  return { op: "node.update", id, set: { modes: { [coll]: pick(modes) } } };
}

test("property: random variable, mode and style sequences keep the model valid and invertible", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const r = seededRandom(seed);
    let m = brands();
    let applied = 0;
    for (let i = 0; i < 100; i++) {
      const op = randomVarOp(m, r);
      const before = m;
      let res;
      try {
        res = O.apply(m, op, { random: r });
      } catch (e) {
        assert.ok(e instanceof O.OpError, `seed ${seed} step ${i} ${JSON.stringify(op)}: ${e.stack}`);
        continue;
      }
      applied++;
      assert.deepEqual(validate(res.model).errors, [], `seed ${seed} step ${i} ${JSON.stringify(op)}`);
      assert.deepEqual(O.apply(res.model, res.inverse).model, before, `seed ${seed} step ${i}: inverse of ${op.op}`);
      // the resolver and the CSS rules never throw on a valid model
      createResolver(res.model).page("p1");
      varRules(res.model);
      m = res.model;
    }
    assert.ok(applied > 40, `seed ${seed}: only ${applied} operations applied`);
  }
});
