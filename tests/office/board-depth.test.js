// Whiteboard depth: TeX environments and stretched delimiters, parametric and implicit curves, merged table cells,
// sub-board previews and the Vibe parameters for them (docs/office-board.md ▸ Rich objects).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/office/board/model.js";
import * as O from "../../app/src/office/board/objects.js";
import { elementItems, pageDisplayList } from "../../app/src/office/board/render.js";
import { officeBoardTools } from "../../app/src/vibe/tools/office-board.js";
import { OfficeProject } from "../../app/src/core/office.js";

const measure = (s, size) => String(s).length * size * 0.55;
const lay = (tex) => O.layoutTex(O.parseTex(tex), 28, measure);
const text = (l) => l.runs.map((r) => r.text).join("").replace(/\s+/g, "");

test("TeX: matrices, cases, aligned and \\left … \\right", () => {
  const p = O.parseTex(String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`);
  assert.equal(p.items[0].k, "matrix");
  assert.equal(p.items[0].env, "pmatrix");
  assert.deepEqual(p.items[0].rows.map((r) => r.length), [2, 2]);
  const pm = lay(String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`);
  assert.equal(text(pm), "abcd");
  assert.equal(pm.strokes.length, 2, "two parentheses");
  const two = lay(String.raw`\begin{matrix} 1 \\ 2 \end{matrix}`);
  const one = lay("1");
  assert.ok(two.ascent + two.descent > (one.ascent + one.descent) * 1.8, "rows stack");
  const trailing = lay(String.raw`\begin{bmatrix} 1 & 2 \\ 3 & 4 \\ \end{bmatrix}`);
  assert.equal(O.parseTex(String.raw`\begin{bmatrix} 1 & 2 \\ 3 & 4 \\ \end{bmatrix}`).items[0].rows.length, 2, "a trailing \\\\ adds no row");
  assert.ok(trailing.strokes.length === 2);
  assert.equal(lay(String.raw`\begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix}`).strokes.length, 2);
  assert.equal(lay(String.raw`\begin{Vmatrix} 1 \end{Vmatrix}`).strokes.length, 4);
  const cases = lay(String.raw`|x| = \begin{cases} x & x \ge 0 \\ -x & \text{otherwise} \end{cases}`);
  assert.equal(cases.strokes.length, 1, "one brace on the left");
  assert.match(text(cases), /otherwise/);
  const al = lay(String.raw`\begin{aligned} a &= b + c \\ d &= e \end{aligned}`);
  assert.ok(!al.strokes?.length);
  const fenced = lay(String.raw`\left( \frac{a}{b} \right)`);
  assert.equal(fenced.strokes.length, 2);
  const tall = Math.max(...fenced.strokes[0].map((p) => p[1])) - Math.min(...fenced.strokes[0].map((p) => p[1]));
  assert.ok(tall > 28, "the parenthesis stretches over the fraction");
  assert.equal(lay(String.raw`\left. x \right|`).strokes.length, 1, "\\left. draws nothing");
  assert.doesNotThrow(() => lay(String.raw`\begin{pmatrix} a & b`), "unterminated input is laid out");
  assert.doesNotThrow(() => lay(String.raw`\end{x} \right) \left[`));
  const el = M.makeElement("math", { tex: String.raw`\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}`, x: 0, y: 0, w: 120, h: 90 });
  assert.ok(elementItems(el, { measure }).some((it) => it.t === "path"), "brackets are drawn as paths");
});

test("plots: parametric and implicit curves", () => {
  assert.equal(O.parseCurve("x^2").kind, "y");
  assert.equal(O.parseCurve("y = 2x + 1").kind, "y");
  assert.equal(O.parseCurve("(x + 1)^2").kind, "y", "a leading parenthesis alone is not a curve");
  const c = O.parseCurve("(cos(t), sin(t))");
  assert.equal(c.kind, "param");
  assert.equal(c.t0, 0);
  assert.ok(Math.abs(c.t1 - 2 * Math.PI) < 1e-12);
  const r = O.parseCurve("(t, t^2) t = -2..2");
  assert.deepEqual([r.t0, r.t1], [-2, 2]);
  assert.equal(r.fy(-2), 4);
  assert.throws(() => O.parseCurve("(t, t) t = 3..1"), /larger end/);
  assert.equal(O.parseCurve("x^2 + y^2 = 4").kind, "implicit");
  assert.equal(O.parseCurve("x = 3").kind, "implicit");
  assert.equal(O.parseCurve("x*y - 1").kind, "implicit");
  assert.throws(() => O.parseCurve("x = y = 1"), /one “=”/);
  const pl = O.sampleParametric(c.fx, c.fy, c.t0, c.t1);
  assert.equal(pl.length, 1);
  assert.ok(pl[0].every(([x, y]) => Math.abs(Math.hypot(x, y) - 1) < 1e-9));
  const segs = O.implicitSegments(O.parseCurve("x^2 + y^2 = 4").F, -5, 5, -5, 5, 50, 50);
  assert.ok(segs.length > 40);
  assert.ok(segs.every(([a, b]) => Math.abs(Math.hypot(...a) - 2) < 0.05 && Math.abs(Math.hypot(...b) - 2) < 0.05), "points on the circle");
  const pole = O.implicitSegments(O.parseCurve("y - 1/x").F, -5, 5, -5, 5, 50, 50);
  assert.ok(!pole.some(([a, b]) => Math.abs(a[1] - b[1]) > 2), "no segment across the pole at x = 0");
  assert.equal(O.curveLabel({ expr: "x^2" }), "y = x^2");
  assert.equal(O.curveLabel({ expr: "x^2 + y^2 = 4" }), "x^2 + y^2 = 4");
  const plot = M.makeElement("plot", { x: 0, y: 0, w: 300, h: 300, functions: [{ expr: "(2cos(t), 2sin(t))" }, { expr: "x^2 + y^2 = 9" }, { expr: "x = 1" }] });
  const items = elementItems(plot, { measure });
  assert.equal(items.filter((it) => it.t === "group").length, 3, "one clipped curve per function");
  assert.match(O.objectText(plot), /x\^2 \+ y\^2 = 9/);
});

test("tables: merged cells and bold cells", () => {
  const el = M.makeElement("table", { x: 0, y: 0, w: 300, h: 90, rows: [["Title", "", ""], ["1", "2", "3"], ["4", "5", "6"]], merges: ["a1:c1", "B2:B3", "A1:A2", "Z1:Z2", "C3"], styles: { b2: { bold: true, fill: "#FFEE00" }, Q9: { bold: true }, C3: { bold: false } } });
  assert.deepEqual(el.merges, ["A1:C1", "B2:B3"], "overlapping, outside and single-cell merges are dropped");
  assert.deepEqual(el.styles, { B2: { bold: true, fill: "#ffee00" } });
  assert.deepEqual(O.cellRange("b3:a1"), { r0: 0, c0: 0, r1: 2, c1: 1 });
  assert.equal(O.a1(2, 27), "AB3");
  const items = elementItems(el, { measure });
  const runs = items.filter((it) => it.t === "text").flatMap((it) => it.runs);
  const title = runs.find((r) => r.text === "Title");
  assert.ok(Math.abs(title.x + title.width / 2 - 150) < 1, "merged text is centered over the merge");
  assert.equal(runs.find((r) => r.text === "2").font.weight, 700, "bold cell");
  assert.ok(!runs.some((r) => r.text === "5"), "covered cells are not drawn");
  const grid = items.find((it) => it.t === "path" && it.stroke && !it.fill);
  const hLineAt = (y, x) => grid.d.some((c, k) => c[0] === "M" && c[2] === y && c[1] <= x && grid.d[k + 1][1] >= x && grid.d[k + 1][2] === y);
  assert.ok(!hLineAt(60, 150), "no line inside the vertical merge");
  assert.ok(hLineAt(60, 50), "lines elsewhere");
});

test("sub-board cards preview their page, one level deep", () => {
  let m = M.templateBoard("blank");
  const r = M.addPage(m, {});
  m = r.model;
  const card = M.makeElement("portal", { page: "p1", x: 0, y: 0, w: 300, h: 220, target: r.page, name: "Details" });
  const note = M.makeElement("sticky", { page: r.page, x: 0, y: 0, text: "inside" });
  const back = M.makeElement("portal", { page: r.page, x: 300, y: 0, w: 300, h: 220, target: "p1", name: "Back" });
  m = M.addElements(m, [card, note, back]);
  const json = JSON.stringify(pageDisplayList(m, "p1", { measure }));
  assert.match(json, /inside/, "the card shows the sticky of its page");
  assert.equal(json.split("Back").length - 1, 1, "the nested card is drawn without its own preview");
  const plain = JSON.stringify(elementItems(m.elements[card.id], { measure }));
  assert.doesNotMatch(plain, /inside/, "without the board, the card has no preview");
  const empty = M.addPage(m, {});
  const card2 = M.makeElement("portal", { page: "p1", x: 0, y: 300, w: 300, h: 220, target: empty.page, name: "Empty" });
  assert.match(JSON.stringify(elementItems(card2, { measure, board: empty.model })), /Sub-board/, "an empty page keeps the plain card");
});

test("Vibe: merged tables, curves and matrices", async () => {
  const model = M.normalizeBoard(M.emptyModel({ title: "Lesson" }));
  const doc = { office: new OfficeProject(model, "board"), tx: (label, fn) => fn(), _do: (op) => op.redo() };
  const app = { doc, docs: [doc], officeUI: null };
  const tools = Object.fromEntries(officeBoardTools(app).map((t) => [t.name, t]));
  const m = () => doc.office.model;
  const tbl = await tools.board_add_table.run({ rows: [["Q1", "", "Q2"], ["1", "2", "3"]], merges: ["A1:B1"], bold: ["C2"], x: 0, y: 0 });
  assert.deepEqual(tbl.merges, ["A1:B1"]);
  assert.deepEqual(m().elements[tbl.id].styles, { C2: { bold: true } });
  const ed = await tools.board_edit_table.run({ id: tbl.id, merges: [], bold: ["A2"] });
  assert.deepEqual(ed.merges, []);
  assert.deepEqual(m().elements[tbl.id].styles, { A2: { bold: true } });
  const pl = await tools.board_add_plot.run({ functions: [{ expr: "(cos(t), sin(t))" }, { expr: "x^2 + y^2 = 4" }], x: 0, y: 200 });
  assert.equal(pl.functions, 2);
  await assert.rejects(async () => tools.board_add_plot.run({ functions: [{ expr: "(t, t) t = 2..1" }], x: 0, y: 0 }), /larger end/);
  const mt = await tools.board_add_math.run({ tex: String.raw`A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`, x: 0, y: 600 });
  assert.ok(m().elements[mt.id].h > 70, "the formula box fits two rows");
});
