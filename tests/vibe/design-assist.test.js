import test from "node:test";
import assert from "node:assert/strict";
import { lintFacts, LINT_RULES, harmony, colorScale, bestTextColor, fixContrast, hexToHsl, hslToHex, mixHex, colorDistance, paletteFromFacts, typeScale, columnGrid, generateSvg, ASSET_KINDS, code128, C128, rng, clipToBox } from "../../app/src/vibe/design-lib.js";
import { contrastRatio } from "../../app/src/vibe/script-lib.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";
import { encodeQR, qrToSvgPath } from "../../app/src/collab/qr.js";
import { plainText } from "../../app/src/engine/layout/text-model.js";
import { duplicatePage } from "../../app/src/commands/layout.js";
import { fakeApp } from "./helpers.js";

function setup() {
  const app = fakeApp();
  app.commands.set("doc.duplicatePage", (a) => duplicatePage(a));
  const ctx = {};
  const tools = createOpenFiniTools(app, ctx);
  const by = new Map(tools.map((t) => [t.name, t]));
  ctx.lookup = (n) => by.get(n);
  ctx.toolNames = () => [...by.keys()];
  return { app, by, run: (name, args) => by.get(name).run(args, {}) };
}

test("color math: hsl round trip, mix, harmony, scale, readable text", () => {
  for (const c of ["#2563eb", "#f59e0b", "#000000", "#ffffff", "#808080"]) assert.ok(colorDistance(hslToHex(hexToHsl(c)), c) <= 2, c);
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.deepEqual(harmony("#ff0000", "complementary"), ["#ff0000", "#00ffff"]);
  assert.equal(harmony("#ff0000", "triadic").length, 3);
  assert.throws(() => harmony("#ff0000", "rainbow"), /Unknown scheme/);
  const sc = colorScale("#2563EB");
  assert.equal(sc[500], "#2563eb");
  assert.deepEqual(Object.keys(sc).map(Number), [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  assert.ok(contrastRatio(sc[50], "#000000") > contrastRatio(sc[900], "#000000"));
  assert.equal(bestTextColor("#ffffff"), "#111111");
  assert.equal(bestTextColor("#111827"), "#ffffff");
  assert.ok(contrastRatio(fixContrast("#8a8a8a", "#ffffff"), "#ffffff") >= 4.5);
  assert.ok(contrastRatio(fixContrast("#555555", "#111111"), "#111111") >= 4.5);
});

test("type scale and column grid", () => {
  const s = typeScale({ base: 16, ratio: "major-third" });
  assert.deepEqual(s.find((x) => x.step === 0), { step: 0, name: "body", size: 16, lineHeight: 1.6 });
  assert.equal(s.find((x) => x.step === 1).size, 20);
  assert.equal(s[0].name, "caption");
  assert.ok(s.at(-1).lineHeight < 1.3);
  assert.throws(() => typeScale({ ratio: "huge" }), /Unknown ratio/);
  const g = columnGrid({ width: 1200, margin: 60, columns: 12, gutter: 24 });
  assert.equal(g.columnWidth, 68);
  assert.deepEqual(g.columns[1], { index: 2, x: 152, w: 68 });
  assert.throws(() => columnGrid({ width: 100, margin: 60 }), /no room/);
});

test("lint: contrast, tiny text, near-miss alignment, uneven gaps, grid, overlaps, alt, colors", () => {
  assert.equal(Object.keys(LINT_RULES).length, 11);
  const page = { w: 800, h: 600, bg: "#ffffff" };
  const rect = (id, x, y, w = 100, h = 50, fill = "#2563eb") => ({ id, type: "rect", name: id, depth: 0, parentId: null, visible: true, x, y, w, h, fill });
  const facts = [
    { id: "t1", type: "text", name: "t1", depth: 0, parentId: null, visible: true, x: 20, y: 20, w: 200, h: 20, text: "Faint", color: "#bbbbbb", fontSize: 9 },
    { id: "t2", type: "text", name: "t2", depth: 0, parentId: null, visible: true, x: 100, y: 30, w: 200, h: 20, text: "Overlap", color: "#111111", fontSize: 16 },
    { id: "t3", type: "text", name: "t3", depth: 0, parentId: null, visible: true, x: 400, y: 300, w: 50, h: 20, text: " ", color: "#111111", fontSize: 16 },
    { id: "img", type: "image", name: "Photo", depth: 0, parentId: null, visible: true, x: 600, y: 400, w: 100, h: 100 },
    rect("a", 40, 100), rect("b", 150, 101), rect("c", 263, 100), rect("d", 40, 220, 100, 50, "#2563ec"), rect("gone", 900, 100),
  ];
  const r = lintFacts(facts, page, { grid: 8 });
  const rules = (name) => r.issues.filter((i) => i.rule === name);
  assert.equal(rules("contrast")[0].ids[0], "t1");
  assert.ok(contrastRatio(rules("contrast")[0].fix.args.fill, "#ffffff") >= 4.5);
  assert.deepEqual(rules("tiny-text")[0].fix, { tool: "set_style", args: { ids: ["t1"], fontSize: 11 } });
  assert.deepEqual(rules("empty-text")[0].fix.args.ids, ["t3"]);
  assert.deepEqual(rules("off-page")[0].ids, ["gone"]);
  assert.deepEqual(rules("near-align").find((i) => i.ids[0] === "b").fix, { tool: "transform_layers", args: { ids: ["b"], y: 100 } });
  assert.equal(rules("text-overlap").length, 1);
  assert.equal(rules("missing-alt")[0].ids[0], "img");
  assert.deepEqual(rules("near-colors")[0].fix.args, { kind: "color", find: "#2563ec", replace: "#2563eb", scope: "page" });
  assert.ok(rules("off-grid")[0].ids.includes("b"));
  assert.equal(r.issues[0].severity, "error", "errors first");
  // gaps 10 and 13 in a clean row
  const row = lintFacts([rect("a", 0, 0), rect("b", 110, 0), rect("c", 223, 0)], page, { rules: ["uneven-spacing"] });
  assert.deepEqual(row.issues[0].fix, { tool: "distribute_layers", args: { ids: ["a", "b", "c"], axis: "x" } });
  assert.equal(lintFacts([rect("a", 0, 0), rect("b", 120, 0), rect("c", 240, 0)], page).total, 0, "a clean row has no issues");
});

test("palette from facts", () => {
  const p = paletteFromFacts([{ fill: "#ff0000", w: 10, h: 10 }, { fill: "#FF0000", w: 5, h: 5 }, { fill: "#00ff00", stroke: "#0000ff/2", w: 100, h: 100 }, { fill: "linear-gradient(#111, #222)" }, { fill: "#123456", visible: false }]);
  assert.deepEqual(p.map((c) => [c.color, c.uses]), [["#ff0000", 2], ["#00ff00", 1], ["#0000ff", 1]]);
});

test("procedural assets: valid, deterministic, importable SVG", () => {
  const qr = encodeQR("https://example.org");
  for (const kind of ASSET_KINDS) {
    const o = { width: 240, height: 160, seed: 7, text: "OF-123", colors: ["#ff0000", "#00ff00"], qrPath: { d: qrToSvgPath(qr), size: qr.size } };
    const a = generateSvg(kind, o);
    assert.match(a.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="[^"]+">.+<\/svg>$/s, kind);
    assert.ok(!/NaN|undefined|Infinity/.test(a.svg), `${kind}: clean numbers`);
    assert.equal(generateSvg(kind, o).svg, a.svg, `${kind}: same seed, same result`);
    assert.ok((a.svg.match(/<path |<text |<rect /g) || []).length >= 1, `${kind}: has content`);
  }
  assert.notEqual(generateSvg("blob", { seed: 1 }).svg, generateSvg("blob", { seed: 2 }).svg);
  // imported paths are not clipped by the viewBox, so shapes are clipped to the box up front
  assert.deepEqual(clipToBox([[-50, 10], [150, 10], [150, 20], [-50, 20]], 100, 100), [[0, 10], [100, 10], [100, 20], [0, 20]]);
  assert.deepEqual(clipToBox([[200, 200], [300, 200], [300, 300]], 100, 100), []);
  const stripes = generateSvg("stripes", { width: 100, height: 60, cell: 20, angle: 30 }).svg;
  const nums = [...stripes.match(/ d="([^"]+)"/)[1].matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(nums.length > 8 && nums.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 60), "stripes stay inside the box");
  assert.throws(() => generateSvg("dots", { width: 8000, height: 8000, cell: 2 }), /more than 20 000/);
  assert.throws(() => generateSvg("spiral"), /Unknown kind/);
  const r = rng(5);
  const xs = [r(), r(), r()];
  assert.ok(xs.every((x) => x >= 0 && x < 1) && new Set(xs).size === 3);
});

test("Code 128: table, checksum, stop", () => {
  assert.equal(C128.length, 106);
  assert.equal(new Set(C128).size, 106);
  assert.ok(C128.every((p) => [...p].reduce((s, d) => s + Number(d), 0) === 11));
  // start B, "A" (33), checksum (104 + 33) % 103 = 34, stop
  assert.equal(code128("A").join(""), "211214" + "111323" + "131123" + "2331112");
  assert.throws(() => code128("é"), /cannot encode/);
});

test("tools: lint and fix in one undo step", async () => {
  const { app, run } = setup();
  const doc = app.doc;
  const a = await run("add_shape", { type: "rect", x: 40, y: 100, w: 100, h: 50, fill: "#2563eb", name: "A" });
  const b = await run("add_shape", { type: "rect", x: 160, y: 102, w: 100, h: 50, fill: "#2563eb", name: "B" });
  await run("add_shape", { type: "rect", x: 280, y: 100, w: 100, h: 50, fill: "#2563eb", name: "C" });
  const t = await run("add_text", { text: "Hello", x: 40, y: 300, fontSize: 8 });
  const lint = await run("lint_design", {});
  assert.ok(lint.total >= 2);
  assert.ok(lint.pages[0].issues.some((i) => i.rule === "near-align" && i.ids[0] === b.id));
  const dry = await run("fix_design_issues", { dryRun: true });
  assert.ok(dry.count >= 2);
  const before = doc.history.index;
  const fixed = await run("fix_design_issues", { rules: ["near-align", "tiny-text"] });
  assert.ok(fixed.applied >= 2);
  assert.equal(doc.history.index, before + 1, "one undo step");
  assert.equal(fixed.remaining, 0);
  assert.equal(doc.stories[doc.find(t.id).storyId].defaults.char.fontSize, 11);
  assert.ok(a.id && TOOL_GROUPS["Design checks and assets"].includes("lint_design"));
});

test("tools: assets, palettes, scales", async () => {
  const { by, run } = setup();
  // the SVG importer needs DOMParser (browser); here the placement is recorded instead
  const placed = [];
  by.set("import_svg", { ...by.get("import_svg"), run: (a) => (placed.push(a), { id: `g${placed.length}` }) });
  const labels = [];
  by.set("add_text", { ...by.get("add_text"), run: (x) => (labels.push(x), { id: "t" }) });
  const g = await run("generate_asset", { kind: "dots", width: 200, height: 100, cell: 20, x: 10, y: 20 });
  assert.equal(g.id, "g1");
  assert.deepEqual([placed[0].x, placed[0].y, placed[0].name], [10, 20, "Dots"]);
  assert.match(placed[0].svg, /^<svg /);
  const ph = await run("generate_asset", { kind: "placeholder", width: 300, height: 200 });
  assert.equal(ph.id, "g2");
  assert.deepEqual([labels[0].text, labels[0].parentId, labels[0].align], ["300 × 200", "g2", "center"]);
  const q = await run("generate_asset", { kind: "qr", text: "https://openfini.example" });
  assert.ok(q.modules >= 21);
  await assert.rejects(run("generate_asset", { kind: "qr" }), /Give the text/);
  const p = await run("make_palette", { base: "#2563eb", scheme: "triadic" });
  assert.equal(p.harmony.length, 3);
  assert.ok(p.scale[900].contrast >= 4.5);
  assert.equal((await run("type_scale", { base: 18, ratio: 1.2, up: 2, down: 0 })).scale.length, 3);
  assert.equal((await run("column_grid", { columns: 4, margin: 40, gutter: 20 })).columns.length, 4);
  await run("add_shape", { type: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#abcdef" });
  assert.ok((await run("extract_palette", {})).colors.some((c) => c.color === "#abcdef"));
});

test("tools: data merge fills one page per record", async () => {
  const { app, run } = setup();
  const doc = app.doc;
  await run("add_text", { text: "Hello <<Name>>, you are <<Role>>.", x: 40, y: 40 });
  await run("add_shape", { type: "rect", x: 0, y: 200, w: 50, h: 50 });
  assert.deepEqual((await run("list_merge_fields", {})).fields, ["Name", "Role"]);
  const before = doc.history.index;
  const r = await run("data_merge", { csv: "Name,Role,Extra\nAda,Engineer,x\nLin,Designer,y\n", pageName: "Badge <<Name>>" });
  assert.equal(r.pages, 2);
  assert.deepEqual(r.unusedColumns, ["Extra"]);
  assert.equal(doc.pages.length, 3);
  assert.deepEqual(doc.pages.map((p) => p.name).slice(1), ["Badge Ada", "Badge Lin"]);
  const textOn = (pg) => plainText(doc.stories[pg.root.children.find((n) => n.type === "text").storyId].story);
  assert.equal(textOn(doc.pages[1]), "Hello Ada, you are Engineer.");
  assert.equal(textOn(doc.pages[2]), "Hello Lin, you are Designer.");
  assert.equal(textOn(doc.pages[0]), "Hello <<Name>>, you are <<Role>>.", "the template is untouched");
  assert.equal(doc.history.index, before + 1, "one undo step");
  doc.undo();
  assert.equal(doc.pages.length, 1);
  await assert.rejects(run("data_merge", { records: [] }), /Give records/);
});
