// Whiteboard rich objects: the expression compiler, function sampling, TeX layout, normalizers, rendering, diagram
// generators, formats and the Vibe tools that create them.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/office/board/model.js";
import * as O from "../../app/src/office/board/objects.js";
import { buildDiagram, DIAGRAM_KINDS } from "../../app/src/office/board/diagrams.js";
import { elementItems, pageDisplayList } from "../../app/src/office/board/render.js";
import { writeExcalidraw, writeTldraw } from "../../app/src/office/board/formats.js";
import { officeBoardTools } from "../../app/src/vibe/tools/office-board.js";
import { OfficeProject } from "../../app/src/core/office.js";

test("compileExpr: precedence, implicit multiplication, functions, safety", () => {
  const f = (s, x) => O.compileExpr(s)(x);
  assert.equal(f("2x^2 + 3x - 1", 2), 13);
  assert.equal(f("y = -x^2", 3), -9);
  assert.equal(f("f(x) = 3(x+1)", 1), 6);
  assert.ok(Math.abs(f("sin(pi/2) + ln(e)", 0) - 2) < 1e-12);
  assert.equal(f("sqrt x", 9), 3);
  assert.equal(f("2^3^2", 0), 512, "power is right associative");
  assert.ok(Number.isNaN(f("1/0", 0)), "infinite values become NaN");
  for (const bad of ["alert(1)", "constructor", "x +", "(x", "x $ 2", ""]) assert.throws(() => O.compileExpr(bad), Error, bad);
});

test("sampleFunction splits at asymptotes and undefined values", () => {
  const parts = O.sampleFunction(O.compileExpr("1/x"), -5, 5, -10, 10, 200);
  assert.ok(parts.length >= 2, "split at x = 0");
  const sq = O.sampleFunction(O.compileExpr("sqrt(x)"), -4, 4, -1, 3, 80);
  assert.ok(sq.every((pl) => pl.every(([x]) => x >= 0)));
  assert.equal(O.niceStep(20, 8), 5);
  assert.equal(O.niceStep(10, 10), 1);
});

test("TeX layout: fractions, roots, scripts and symbols", () => {
  const measure = (t, s) => t.length * s * 0.5;
  const l = O.layoutTex(O.parseTex(String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`), 20, measure);
  assert.equal(l.rules.length, 2, "fraction bar and root bar");
  assert.ok(l.runs.some((r) => r.text.includes("±")));
  assert.ok(l.runs.some((r) => r.text === "2" && r.size < 20 && r.y < 0), "superscript is smaller and raised");
  const s = O.layoutTex(O.parseTex(String.raw`a_{i} \le \alpha`), 20, measure);
  assert.ok(s.runs.some((r) => r.text === "i" && r.y > 0), "subscript is lowered");
  assert.ok(s.runs.some((r) => r.text.includes("≤")) && s.runs.some((r) => r.text === "α"));
  const size = O.mathSize("x^2", 28, measure);
  assert.ok(size.w > 20 && size.h > 28);
});

test("rich objects normalize, render and survive normalizeBoard", () => {
  const els = [
    M.makeElement("table", { x: 0, y: 0, w: 300, h: 120, rows: [["a", "b", "c"], ["1"]], header: true }),
    M.makeElement("chart", { x: 0, y: 200, w: 300, h: 200, chart: { type: "pie", data: { categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }] } } }),
    M.makeElement("plot", { x: 400, y: 0, w: 400, h: 300, functions: [{ expr: "x^2" }, "1/x", { expr: "" }], points: [{ x: 1, y: 1, label: "P" }, { x: "bad" }], xMin: 5, xMax: 1 }),
    M.makeElement("math", { x: 0, y: 500, w: 200, h: 60, tex: String.raw`\sqrt{2}` }),
    M.makeElement("portal", { x: 300, y: 500, w: 240, h: 140, target: "p2", name: "Details" }),
  ];
  assert.deepEqual(els[0].rows[1], ["1", "", ""], "ragged rows are padded");
  assert.equal(els[2].functions.length, 2, "empty functions are dropped");
  assert.equal(els[2].points.length, 1);
  assert.deepEqual([els[2].xMin, els[2].xMax], [-10, 10], "an inverted range falls back");
  for (const e of els) assert.ok(elementItems(e).length > 0, e.type);
  let m = M.addElements(M.emptyModel({ title: "T" }), els);
  assert.match(M.boardToMarkdown(m).markdown, /\| a \| b \| c \|/);
  const back = M.normalizeBoard(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(Object.values(back.elements).map((e) => e.type).sort(), ["chart", "math", "plot", "portal", "table"]);
  m = M.updateElements(m, { [els[0].id]: { rows: [["x"]] } });
  assert.equal(m.elements[els[0].id].header, true, "updates are normalized");
  assert.match(M.describeBoard(m).items.find((i) => i.type === "plot").text, /y = x\^2/);
  assert.ok(pageDisplayList(m, m.pages[0].id, {}).items.length > 1);
  assert.ok(writeExcalidraw(m));
  assert.ok(writeTldraw(m));
});

test("diagram generators lay out and connect items", () => {
  const items = [{ text: "A", children: [{ text: "A1" }, { text: "A2" }] }, "B", { text: "C", children: ["C1"] }, "D"];
  for (const kind of DIAGRAM_KINDS) {
    const r = buildDiagram(kind, { title: "Topic", items, page: "p1" });
    assert.ok(r.elements.length >= 4, kind);
    const ids = new Set(r.elements.map((e) => e.id));
    for (const e of r.elements) if (e.start) assert.ok(ids.has(e.start.id) && ids.has(e.end.id), `${kind} connectors are bound`);
  }
  const tree = buildDiagram("tree", { title: "Root", items, page: "p1" });
  assert.equal(tree.elements.filter((e) => e.type === "arrow").length, 7, "one arrow per child");
  const matrix = buildDiagram("matrix", { items, page: "p1" });
  assert.equal(matrix.elements.filter((e) => e.type === "frame").length, 4);
  assert.throws(() => buildDiagram("spiral", { items }), /Unknown diagram/);
  assert.throws(() => buildDiagram("tree", { items: [] }), /at least one/);
});

test("Vibe board tools create tables, charts, graphs, formulas, sub-boards, diagrams and drawings", async () => {
  const model = M.normalizeBoard(M.emptyModel({ title: "Lesson" }));
  const doc = { office: new OfficeProject(model, "board"), tx: (label, fn) => fn(), _do: (op) => op.redo() };
  const app = { doc, docs: [doc], officeUI: null };
  const tools = Object.fromEntries(officeBoardTools(app).map((t) => [t.name, t]));
  const m = () => doc.office.model;
  const tbl = await tools.board_add_table.run({ rows: [["x", "y"], ["1", "1"], ["2", "4"]], x: 0, y: 0 });
  assert.equal(m().elements[tbl.id].rows.length, 3);
  await tools.board_edit_table.run({ id: tbl.id, cells: [{ row: 3, col: 0, text: "3" }], addColumn: true });
  assert.deepEqual(m().elements[tbl.id].rows[3], ["3", "", ""]);
  const ch = await tools.board_add_chart.run({ type: "line", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }], x: 0, y: 200 });
  assert.equal(m().elements[ch.id].chart.type, "line");
  await assert.rejects(async () => tools.board_add_chart.run({ x: 0, y: 0 }), /series/);
  const pl = await tools.board_add_plot.run({ functions: [{ expr: "x^2 - 2" }], points: [{ x: 0, y: -2, label: "Vertex" }], xMin: -3, xMax: 3, yMin: -3, yMax: 7, x: 400, y: 0 });
  assert.equal(pl.functions, 1);
  await assert.rejects(async () => tools.board_add_plot.run({ functions: [{ expr: "x +" }], x: 0, y: 0 }), /Unexpected/);
  const mt = await tools.board_add_math.run({ tex: String.raw`\frac{1}{2}`, x: 0, y: 600 });
  assert.ok(m().elements[mt.id].w > 10);
  const sb = await tools.board_add_subboard.run({ name: "Exercises", x: 600, y: 600 });
  assert.equal(m().pages.length, 2);
  assert.equal(m().elements[sb.id].target, sb.page);
  const dg = await tools.board_add_diagram.run({ kind: "mindmap", title: "Topic", items: [{ text: "One" }, { text: "Two" }], page: sb.page });
  assert.ok(dg.ids.every((id) => m().elements[id].page === sb.page));
  const dr = await tools.board_draw.run({ points: [[0, 0], [50, 0], [25, 40]], closed: true, smooth: false });
  assert.equal(m().elements[dr.id].points.length, 4);
  await assert.rejects(async () => tools.board_draw.run({ points: [[0, 0]] }), /two points/);
});
