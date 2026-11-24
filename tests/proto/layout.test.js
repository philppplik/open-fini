// Proto pure layout solver (docs/concepts/proto-studio.md §4.4, task T2): golden tests against geometry recorded in a
// Chromium-based browser (scripts/proto-record-geometry.mjs), plus unit tests of the solver's own behavior.
//
// Tolerances: 1 px for fixtures without text (the acceptance criterion of T2); 2 px for text fixtures, because the
// solver measures with the Adobe base-14 widths (approxMeasurer) without kerning while the browser shapes real fonts
// (the fixtures use Arial, which is metric-compatible with Helvetica, so the remaining error is kerning).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { layout, layoutNode } from "../../app/src/engine/proto/layout.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { validate } from "../../app/src/engine/proto/validate.js";

const DIR = new URL("./fixtures/geometry/", import.meta.url);
const FIXTURES = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, DIR), "utf8")));
const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const TOLERANCE = { box: 1, text: 2 };

test("the solver imports in plain Node without a DOM", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(typeof globalThis.window, "undefined");
});

test("geometry fixtures are valid models with recorded boxes", () => {
  assert.ok(FIXTURES.length >= 12);
  assert.ok(FIXTURES.filter((f) => !f.text).length >= 10, "enough fixtures without text");
  for (const f of FIXTURES) {
    const r = validate(f.model);
    assert.ok(r.ok, `${f.name}: ${JSON.stringify(r.errors)}`);
    assert.ok(f.boxes && Object.keys(f.boxes).length > 1, `${f.name} has recorded boxes`);
    assert.ok(f.recorded?.browser, `${f.name} records the browser`);
  }
});

for (const f of FIXTURES) {
  test(`golden: ${f.name} matches the browser within ${f.text ? TOLERANCE.text : TOLERANCE.box} px`, () => {
    const res = layoutNode(f.model, f.root, { origin: true });
    assert.equal(res.approximate, true);
    const tol = f.text ? TOLERANCE.text : TOLERANCE.box;
    assert.deepEqual([...res.boxes.keys()].sort(), Object.keys(f.boxes).sort(), "the same layers");
    for (const [key, want] of Object.entries(f.boxes)) {
      const b = res.boxes.get(key);
      const got = [b.x, b.y, b.w, b.h];
      got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= tol, `${f.name} ▸ ${key}: got [${got.map((x) => x.toFixed(2))}], browser [${want}]`));
    }
  });
}

test("the sample design lays out: flex column, grid card, instance, absolute vector", () => {
  const res = layoutNode(SAMPLE, "n1");
  const b = (k) => res.boxes.get(k);
  assert.deepEqual([b("n1").w, b("n1").h], [390, 844]);
  assert.equal(b("n2").x, 24);
  assert.equal(b("n2").w, 342, "fill width in a column");
  assert.equal(b("n3").y, b("n2").y + b("n2").h + 16, "gap bound to a variable");
  assert.ok(b("n4"));
  const done = layoutNode(SAMPLE, "n40");
  const check = done.boxes.get("n6");
  assert.deepEqual([check.x, check.y, check.w, check.h], [440 + 183, 410, 24, 24], "canvas coordinates of the root");
});

test("boxes: absolute and parent-relative coordinates, rotation kept, hidden layers omitted", () => {
  const m = structuredClone(SAMPLE);
  m.nodes.n3.rot = 30;
  m.nodes.n2.visible = false;
  const res = layoutNode(m, "n1", { origin: true });
  assert.equal(res.boxes.has("n2"), false);
  const card = res.boxes.get("n3");
  assert.equal(card.rot, 30);
  assert.equal(card.y, 24, "the hidden layer takes no space");
  const hero = res.boxes.get("n4");
  assert.equal(hero.x, card.x + hero.px);
  assert.equal(hero.y, card.y + hero.py);
  m.nodes.n1.visible = false;
  assert.equal(layoutNode(m, "n1").boxes.size, 0);
  assert.equal(layout(null).boxes.size, 0);
});

test("the measurer is a seam: a host passes its own (as core/fonts.js ▸ setTextMeasurer)", () => {
  const mono = { measure: (font, text) => [...text].length * font.size * 0.5, metrics: (font) => ({ ascent: font.size * 0.8, descent: font.size * 0.2, lineGap: 0 }) };
  const m = structuredClone(SAMPLE);
  const res = layoutNode(m, "n22", { measurer: mono, origin: true });
  const label = res.boxes.get("n22");
  assert.equal(label.w, 6 * 14 * 0.5, "“Button” at 14 px");
  assert.equal(label.h, 21, "the default line height, 150 % of 14 px");
  m.nodes.n22.text.style.lineHeight = "auto";
  assert.ok(Math.abs(layoutNode(m, "n22", { measurer: mono }).boxes.get("n22").h - 14) < 1e-9, "line-height auto = ascent + descent + line gap");
});

test("text lines: wrapping, alignment, explicit breaks and line clamping", () => {
  const fixture = FIXTURES.find((f) => f.name === "text-wrap");
  const res = layoutNode(fixture.model, fixture.root, { origin: true });
  const p1 = res.boxes.get("p1");
  assert.ok(p1.lines.length >= 3);
  assert.equal(p1.lines[0].y, 0);
  assert.equal(p1.lines[1].y, 24, "150% of 16 px");
  assert.ok(p1.lines.every((l) => l.w <= p1.w + 0.01));
  assert.ok(p1.lines[0].baseline > 0 && p1.lines[0].baseline < 24);
  const p4 = res.boxes.get("p4");
  assert.equal(p4.lines.length, 2, "maxLines");
  const hug = FIXTURES.find((f) => f.name === "text-hug");
  const t5 = layoutNode(hug.model, hug.root).boxes.get("t5");
  assert.deepEqual(t5.lines.map((l) => l.segs.map((s) => s.text).join("")), ["Line one", "Line two"]);
  const m = structuredClone(fixture.model);
  m.nodes.p2.text.style.align = "right";
  const right = layoutNode(m, "root").boxes.get("p2");
  assert.ok(right.lines.every((l) => Math.abs(l.x + l.w - right.w) < 0.01));
});

test("long words break when they do not fit (overflow-wrap: break-word)", () => {
  const m = structuredClone(FIXTURES.find((f) => f.name === "text-wrap").model);
  m.nodes.p2.text.runs = [{ t: "Supercalifragilisticexpialidocious", s: {} }];
  const b = layoutNode(m, "root").boxes.get("p2");
  assert.ok(b.lines.length > 1);
  assert.ok(b.lines.every((l) => l.w <= 120 + 0.01));
  assert.equal(b.lines.map((l) => l.segs.map((s) => s.text).join("")).join(""), "Supercalifragilisticexpialidocious");
});

test("fill and relative roots use the viewport; without one they hug", () => {
  const f = FIXTURES.find((x) => x.name === "flex-row-sizing");
  const m = structuredClone(f.model);
  m.nodes.root.w = { mode: "fill" };
  m.nodes.root.h = { mode: "rel", value: 50 };
  const vp = layoutNode(m, "root", { viewport: { w: 1000, h: 800 } }).boxes.get("root");
  assert.deepEqual([vp.w, vp.h], [1000, 400]);
  const hug = layoutNode(m, "root").boxes.get("root");
  assert.ok(hug.w < 1000 && hug.w > 0);
});

test("instances lay out from the resolved tree, with keys by path", () => {
  const f = FIXTURES.find((x) => x.name === "instance");
  const r = createResolver(f.model).tree("root");
  const res = layout(r, { origin: true });
  assert.ok(res.boxes.has("i1/lg/lgb") === false, "keys are instance key + source id");
  assert.ok(res.boxes.has("i1/lgb"));
  assert.equal(res.boxes.get("i1/lgb").w, 90, "the override applies");
});

test("large trees lay out quickly", () => {
  const nodes = {};
  const page = { id: "p1", name: "P", ord: "V", bg: "#ffffff", flows: [] };
  nodes.root = { id: "root", type: "frame", name: "R", page: "p1", parent: null, ord: "V", w: { mode: "fixed", value: 1200 }, h: { mode: "hug" }, layout: { type: "flex", dir: "row", wrap: true, gap: 4 } };
  for (let i = 0; i < 500; i++) {
    nodes[`c${i}`] = { id: `c${i}`, type: "frame", name: "C", page: "p1", parent: "root", ord: `V${String(i).padStart(3, "1")}`.replace(/0/g, "1"), pos: "flow", w: { mode: "hug" }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: 2, pad: [4, 4, 4, 4] } };
    nodes[`r${i}`] = { id: `r${i}`, type: "rect", name: "A", page: "p1", parent: `c${i}`, ord: "V", pos: "flow", w: { mode: "fixed", value: 40 }, h: { mode: "fixed", value: 20 } };
    nodes[`f${i}`] = { id: `f${i}`, type: "rect", name: "B", page: "p1", parent: `c${i}`, ord: "k", pos: "flow", w: { mode: "fill" }, h: { mode: "fixed", value: 10 } };
  }
  const model = { schema: 1, meta: {}, pages: { p1: page }, nodes, vars: { collections: {}, items: {} }, styles: {}, breakpoints: [], code: { links: {}, tokensFile: null }, media: {} };
  const t0 = performance.now();
  const res = layoutNode(model, "root");
  const ms = performance.now() - t0;
  assert.equal(res.boxes.size, 1501);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});
