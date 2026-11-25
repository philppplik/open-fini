// Design lint of the Proto model (engine/proto/lint.js, task T11): every rule has a positive and a negative fixture,
// and its fix (where there is one) applies through ops.js and makes the issue go away.
import test from "node:test";
import assert from "node:assert/strict";
import { emptyDocument } from "../../app/src/engine/proto/schema.js";
import { apply } from "../../app/src/engine/proto/ops.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { lint, fixOps, contrastRatio, suggestName, suggestTag, RULES } from "../../app/src/engine/proto/lint.js";

const PAGE = "p1";
const base = () => emptyDocument({ title: "Lint", created: "2026-01-01T00:00:00.000Z", pageId: PAGE });
const run = (m, op) => apply(m, op, { random: seededRandom(7) }).model;
const frame = (id, fields = {}, children = []) => ({ op: "node.create", type: "frame", page: PAGE, id, fields: { name: "Screen", w: { mode: "fixed", value: 390 }, h: { mode: "fixed", value: 844 }, layout: { type: "flex", dir: "column", gap: 16, pad: [24, 24, 24, 24] }, ...fields }, children });
const text = (id, t, style = {}, fields = {}) => ({ type: "text", id, fields: { name: t, text: { runs: [{ t, s: {} }], style: { font: "Inter", size: 16, weight: 400, color: "#18181b", ...style } }, ...fields } });
const box = (id, fields = {}, children = []) => ({ type: "frame", id, fields: { name: "Box", w: { mode: "hug" }, h: { mode: "hug" }, fills: [], layout: { type: "flex", dir: "row", gap: 8 }, ...fields }, children });
const rules = (m, rule, o = {}) => lint(m, { rules: [rule], ...o }).issues;
const fixAll = (m, rule) => run(m, { op: "batch", ops: fixOps(rules(m, rule), { unsafe: true }) });

test("contrast: flags low-contrast text and the fix picks a readable color", () => {
  assert.ok(contrastRatio("#000000", "#ffffff") > 20);
  assert.equal(Math.round(contrastRatio("#ffffff", "#ffffff")), 1);
  const bad = run(base(), frame("f1", {}, [text("t1", "Faint", { color: "#d4d4d8" })]));
  const good = run(base(), frame("f1", {}, [text("t1", "Clear")]));
  const [i] = rules(bad, "contrast");
  assert.equal(i.node, "t1");
  assert.equal(i.severity, "error");
  assert.deepEqual(rules(good, "contrast"), []);
  assert.deepEqual(rules(fixAll(bad, "contrast"), "contrast"), []);
  // large text needs only 3:1; on a dark button the background of the parent counts
  const large = run(base(), frame("f1", {}, [text("t1", "Big", { size: 32, color: "#8a8a8a" })]));
  assert.deepEqual(rules(large, "contrast"), []);
  const onDark = run(base(), frame("f1", {}, [box("b", { fills: [{ type: "solid", color: "#1d4ed8" }] }, [text("t1", "Go", { color: "#1e3a8a" })])]));
  assert.equal(rules(onDark, "contrast").length, 1);
});

test("touch-target: small interactive layers only", () => {
  const small = run(base(), frame("f1", {}, [box("b", { name: "Button", tag: "button", h: { mode: "fixed", value: 20 } }, [text("t", "OK")])]));
  const big = run(base(), frame("f1", {}, [box("b", { name: "Button", tag: "button", h: { mode: "fixed", value: 48 }, w: { mode: "fixed", value: 120 } }, [text("t", "OK")])]));
  const plain = run(base(), frame("f1", {}, [box("b", { name: "Label row", h: { mode: "fixed", value: 20 } }, [text("t", "OK")])]));
  assert.equal(rules(small, "touch-target")[0].severity, "warning");
  assert.deepEqual(rules(big, "touch-target"), []);
  assert.deepEqual(rules(plain, "touch-target"), []);
  assert.deepEqual(rules(fixAll(small, "touch-target"), "touch-target"), []);
});

test("unbound-color and unbound-spacing: values that equal a variable get a binding fix", () => {
  let m = run(base(), { op: "collection.create", id: "c1", name: "Color", modes: [{ id: "light", name: "Light" }] });
  m = run(m, { op: "var.create", id: "v1", coll: "c1", name: "color/primary", type: "color", value: "#2563eb" });
  m = run(m, { op: "var.create", id: "v2", coll: "c1", name: "space/4", type: "number", value: 16, scopes: ["gap", "padding"] });
  const used = run(m, frame("f1", { fills: [{ type: "solid", color: "#2563eb" }] }, [text("t", "Hi")]));
  const colors = rules(used, "unbound-color");
  assert.ok(colors.some((i) => i.id === "unbound-color:f1:fills.0.color" && i.fix));
  const spacing = rules(used, "unbound-spacing");
  assert.ok(spacing.some((i) => i.id === "unbound-spacing:f1:layout.gap"));
  const fixed = run(used, { op: "batch", ops: fixOps([...colors, ...spacing]) });
  assert.deepEqual(fixed.nodes.f1.fills[0].color, { $var: "v1" });
  assert.deepEqual(fixed.nodes.f1.layout.gap, { $var: "v2" });
  assert.ok(!rules(fixed, "unbound-color").some((i) => i.fix));
  // without variables nothing is reported
  assert.deepEqual(rules(run(base(), frame("f1")), "unbound-color"), []);
});

test("off-grid: spacing off the 4 px grid is rounded", () => {
  const off = run(base(), frame("f1", { layout: { type: "flex", dir: "column", gap: 10, pad: [24, 14, 24, 14] } }));
  const on = run(base(), frame("f1"));
  assert.equal(rules(off, "off-grid").length, 1);
  assert.deepEqual(rules(on, "off-grid"), []);
  const fixed = fixAll(off, "off-grid");
  assert.equal(fixed.nodes.f1.layout.gap, 12);
  assert.deepEqual(fixed.nodes.f1.layout.pad, [24, 16, 24, 16]);
});

test("detached-style: local values equal to a style", () => {
  let m = run(base(), frame("f1", {}, [text("t1", "Body", { size: 18 })]));
  m = run(m, { op: "style.create", id: "s1", name: "Body", kind: "text", value: { font: "Inter", size: 18, weight: 400, color: "#18181b" } });
  assert.equal(rules(m, "detached-style").length, 1);
  const fixed = fixAll(m, "detached-style");
  assert.equal(fixed.nodes.t1.style.text, "s1");
  assert.deepEqual(rules(fixed, "detached-style"), []);
});

test("inactive-override, detached-instance and empty-frame", () => {
  let m = run(base(), { op: "node.create", type: "component", page: PAGE, id: "c1", fields: { name: "Chip", x: 600 }, children: [text("ct", "Chip")] });
  m = run(m, frame("f1", {}, [{ type: "instance", id: "i1", fields: { of: "c1", over: { ct: { opacity: 0.5 }, gone: { opacity: 0.2 } } } }, box("copy", { name: "Chip" }, [text("x", "Chip")]), box("empty", { name: "Spacer" })]));
  const over = rules(m, "inactive-override");
  assert.equal(over.length, 1);
  assert.match(over[0].message, /gone/);
  const detached = rules(m, "detached-instance");
  assert.equal(detached[0].node, "copy");
  assert.equal(detached[0].fix.safe, false);
  assert.deepEqual(fixOps(detached), [], "unsafe fixes need the issue id");
  const empty = rules(m, "empty-frame");
  assert.deepEqual(empty.map((i) => i.node), ["empty"]);
  const fixed = run(m, { op: "batch", ops: fixOps([...over, ...detached, ...empty], { ids: [over[0].id, detached[0].id, empty[0].id] }) });
  assert.deepEqual(Object.keys(fixed.nodes.i1.over), ["ct"]);
  assert.ok(!fixed.nodes.copy && !fixed.nodes.empty);
  assert.ok(Object.values(fixed.nodes).some((n) => n.type === "instance" && n.id !== "i1" && n.parent === "f1"));
  for (const r of ["inactive-override", "detached-instance", "empty-frame"]) assert.deepEqual(rules(fixed, r), [], r);
});

test("naming: default names get semantic suggestions; tags follow the content", () => {
  const m = run(base(), frame("f1", { name: "Frame" }, [{ ...text("t1", "Welcome back", { size: 32 }), fields: { ...text("t1", "Welcome back", { size: 32 }).fields, name: "Text" } }, box("b", { name: "Frame 3", fills: [{ type: "solid", color: "#2563eb" }] }, [text("bt", "Sign in")])]));
  const issues = rules(m, "naming");
  assert.deepEqual(issues.map((i) => i.node).sort(), ["b", "f1", "t1"]);
  assert.equal(suggestName(m, "t1"), "Welcome back");
  assert.equal(suggestName(m, "b"), "Sign in button");
  assert.equal(suggestTag(m, "t1"), "h1");
  const fixed = fixAll(m, "naming");
  assert.equal(fixed.nodes.b.name, "Sign in button");
  assert.deepEqual(rules(run(base(), frame("f1", {}, [text("t1", "Named")])), "naming"), []);
});

test("overflow-text: fixed text boxes that cut text off", () => {
  const long = "A long sentence that will certainly need more than one line in a narrow box";
  const cut = run(base(), frame("f1", {}, [{ ...text("t1", long), fields: { ...text("t1", long).fields, w: { mode: "fixed", value: 120 }, h: { mode: "fixed", value: 20 }, text: { ...text("t1", long).fields.text, autoSize: "fixed" } } }]));
  const ok = run(base(), frame("f1", {}, [{ ...text("t1", long), fields: { ...text("t1", long).fields, w: { mode: "fixed", value: 120 }, text: { ...text("t1", long).fields.text, autoSize: "height" } } }]));
  assert.equal(rules(cut, "overflow-text").length, 1);
  assert.deepEqual(rules(ok, "overflow-text"), []);
  assert.deepEqual(rules(fixAll(cut, "overflow-text"), "overflow-text"), []);
});

test("unused-token: variables and styles nobody uses", () => {
  let m = run(base(), { op: "collection.create", id: "c1", name: "Color", modes: [{ id: "light", name: "Light" }] });
  m = run(m, { op: "var.create", id: "v1", coll: "c1", name: "used", type: "color", value: "#111111" });
  m = run(m, { op: "var.create", id: "v2", coll: "c1", name: "alias", type: "color", value: { $var: "v1" } });
  m = run(m, { op: "var.create", id: "v3", coll: "c1", name: "unused", type: "color", value: "#222222" });
  m = run(m, frame("f1", { fills: [{ type: "solid", color: { $var: "v2" } }] }));
  const issues = rules(m, "unused-token");
  assert.deepEqual(issues.map((i) => i.node), ["v3"]);
  assert.deepEqual(fixOps(issues), [], "deleting tokens is never automatic");
  assert.deepEqual(rules(run(m, { op: "batch", ops: fixOps(issues, { unsafe: true }) }), "unused-token"), []);
});

test("lint covers every rule, scopes to layers and pages, and is stable", () => {
  assert.equal(RULES.length, 12);
  const m = run(run(base(), frame("f1", {}, [text("t1", "Faint", { color: "#eeeeee" })])), frame("f2", { x: 500 }, [text("t2", "Faint", { color: "#eeeeee" })]));
  assert.equal(rules(m, "contrast").length, 2);
  assert.deepEqual(rules(m, "contrast", { ids: ["f2"] }).map((i) => i.node), ["t2"]);
  assert.deepEqual(lint(m), lint(m));
  assert.equal(lint(m, { page: "nope" }).issues.length, 0);
});
