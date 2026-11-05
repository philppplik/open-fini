// Spreadsheet depth: dynamic arrays (FILTER, SORT, UNIQUE, SEQUENCE with spilling), defined names, table styles, data
// validation, paste special, row/column groups, page setup, pivot-lite, sparklines and chart data for other apps
// (docs/office-sheet.md).
import test from "node:test";
import assert from "node:assert/strict";
import { createCalc, isErr } from "../../app/src/office/sheet/formula.js";
import * as M from "../../app/src/office/sheet/model.js";
import * as D from "../../app/src/office/sheet/depth.js";

const val = (calc, k, sid = "s1") => {
  const v = calc.value(sid, k);
  return isErr(v) ? v.code : v;
};
const book = (cells, extra = {}) => ({ ...M.normalizeWorkbook({ sheets: [{ id: "s1", name: "Sheet1", cells }] }), ...extra });
const nums = (list, col = "A") => Object.fromEntries(list.map((v, i) => [`${col}${i + 1}`, { v }]));

test("dynamic arrays spill into the cells below and to the right", () => {
  const m = book({ ...nums([3, 1, 3, 7, 2]), B1: { f: "SORT(UNIQUE(A1:A5))" }, C1: { f: "SUM(B1:B9)" }, E1: { f: "FILTER(A1:A5,A1:A5>2)" }, G1: { f: "SEQUENCE(2,3,10,5)" }, K1: { f: "TRANSPOSE(A1:A3)" } });
  const calc = createCalc(m);
  assert.deepEqual(["B1", "B2", "B3", "B4", "B5"].map((k) => val(calc, k)), [1, 2, 3, 7, null]);
  assert.equal(val(calc, "C1"), 13);
  assert.deepEqual(["E1", "E2", "E3", "E4"].map((k) => val(calc, k)), [3, 3, 7, null]);
  assert.deepEqual(["G1", "H1", "I1", "G2", "I2"].map((k) => val(calc, k)), [10, 15, 20, 25, 35]);
  assert.deepEqual(["K1", "L1", "M1"].map((k) => val(calc, k)), [3, 1, 3]);
  assert.equal(calc.spillAnchor("s1", 1, 7), "s1!G1");
  assert.deepEqual(calc.spillSize("s1", "G1"), { rows: 2, cols: 3 });
});

test("a blocked spill is #SPILL! and recovers when the blocker is cleared; sources update the spill", () => {
  let m = book({ ...nums([5, 4, 6]), B1: { f: "SORT(A1:A3)" }, B3: { v: "x" }, C1: { f: "SUM(B1:B3)" } });
  const calc = createCalc(m);
  assert.equal(val(calc, "B1"), "#SPILL!");
  m = M.setCells(m, "s1", { B3: null });
  calc.update(m);
  assert.deepEqual(["B1", "B2", "B3"].map((k) => val(calc, k)), [4, 5, 6]);
  assert.equal(val(calc, "C1"), 15);
  m = M.setCells(m, "s1", { A1: { v: 1 } });
  calc.update(m);
  assert.deepEqual(["B1", "B2", "B3"].map((k) => val(calc, k)), [1, 4, 6]);
  assert.equal(val(calc, "C1"), 11);
});

test("FILTER with an empty result, SORTBY and element-wise operators inside aggregates", () => {
  const m = book({ ...nums(["b", "a", "c"]), ...nums([2, 3, 1], "B"), D1: { f: 'FILTER(A1:A3,B1:B3>5,"none")' }, E1: { f: "FILTER(A1:A3,B1:B3>5)" }, F1: { f: "SORTBY(A1:A3,B1:B3,-1)" }, G1: { f: "SUM(B1:B3*2)" } });
  const calc = createCalc(m);
  assert.equal(val(calc, "D1"), "none");
  assert.equal(val(calc, "E1"), "#N/A");
  assert.deepEqual(["F1", "F2", "F3"].map((k) => val(calc, k)), ["a", "b", "c"]);
  assert.equal(val(calc, "G1"), 12);
});

test("defined names resolve in formulas and follow edits", () => {
  let m = book({ ...nums([1, 2, 3]), D1: { v: 10 } });
  m = D.setName(m, "Data", "Sheet1!$A$1:$A$3");
  m = D.setName(m, "Rate", "Sheet1!$D$1");
  m = M.setCells(m, "s1", { F1: { f: "SUM(Data)*Rate" }, F2: { f: "Missing+1" } });
  const calc = createCalc(m);
  assert.equal(val(calc, "F1"), 60);
  assert.equal(val(calc, "F2"), "#NAME?");
  m = M.setCells(m, "s1", { A1: { v: 4 } });
  calc.update(m);
  assert.equal(val(calc, "F1"), 90);
  assert.throws(() => D.setName(m, "A1", "Sheet1!A1"), /name/i);
  assert.throws(() => D.setName(m, "1x", "Sheet1!A1"), /name/i);
  m = D.deleteName(m, "rate");
  assert.deepEqual(Object.keys(m.names), ["Data"]);
  // shifting rows keeps names pointing at their cells
  const shifted = M.shiftAxis(m, "s1", "row", 0, 2);
  assert.equal(shifted.names.Data, "Sheet1!$A$3:$A$5");
});

test("table styles band rows, style the header and add a total row", () => {
  let m = book({ A1: { v: "Item" }, B1: { v: "Amount" }, A2: { v: "a" }, B2: { v: 1 }, A3: { v: "b" }, B3: { v: 2 }, A4: { v: "c" }, B4: { v: 3 } });
  m = D.addTable(m, "s1", { range: "A1:B4", style: "blue", total: true });
  const s = M.sheetById(m, "s1");
  assert.equal(s.tables.length, 1);
  assert.equal(s.tables[0].range, "A1:B5");
  assert.equal(s.cells.B5.f, "SUBTOTAL(109,B2:B4)");
  assert.equal(s.cells.A5.v, "Total");
  const head = D.tableLook(s, 0, 0);
  const odd = D.tableLook(s, 1, 0);
  const even = D.tableLook(s, 2, 0);
  assert.equal(head.b, true);
  assert.ok(head.fill && odd.fill && odd.fill !== even.fill);
  assert.equal(D.tableLook(s, 9, 9), null);
  assert.equal(createCalc(m).value("s1", "B5"), 6);
  m = D.removeTable(m, "s1", s.tables[0].id);
  assert.equal(M.sheetById(m, "s1").tables.length, 0);
});

test("data validation: lists from values or a range, number bounds and messages", () => {
  let m = book({ D1: { v: "red" }, D2: { v: "green" } });
  m = D.addValidation(m, "s1", { range: "A1:A5", type: "list", source: "Sheet1!D1:D2" });
  m = D.addValidation(m, "s1", { range: "B1:B5", type: "number", min: 0, max: 10, message: "0 to 10" });
  m = D.addValidation(m, "s1", { range: "C1", type: "list", list: ["yes", "no"] });
  const s = M.sheetById(m, "s1");
  const calc = createCalc(m);
  const get = (sid, r, c) => calc.get(sid, r, c);
  assert.deepEqual(D.listItems(m, s, D.validationAt(s, 0, 0), get), ["red", "green"]);
  assert.deepEqual(D.listItems(m, s, D.validationAt(s, 0, 2), get), ["yes", "no"]);
  assert.equal(D.checkInput(m, s, 0, 0, "Red", get).ok, true);
  assert.equal(D.checkInput(m, s, 0, 0, "blue", get).ok, false);
  assert.equal(D.checkInput(m, s, 0, 1, "11", get).message, "0 to 10");
  assert.equal(D.checkInput(m, s, 0, 1, "5", get).ok, true);
  assert.equal(D.checkInput(m, s, 0, 1, "", get).ok, true);
  assert.equal(D.checkInput(m, s, 0, 1, "=A1", get).ok, true);
  assert.equal(D.checkInput(m, s, 9, 9, "x", get).ok, true);
  m = D.clearValidation(m, "s1", "A1:C5");
  assert.equal(M.sheetById(m, "s1").validation.length, 0);
});

test("paste special: values, formats, transpose, operations and skip blanks", () => {
  const block = [[{ v: 2, s: { b: true } }, { f: "A1*2" }], [null, { v: 4 }]];
  const values = [[2, 4], [null, 4]];
  let m = book({ D1: { v: 10, s: { fill: "#ff0000" } }, E1: { v: 1 }, D2: { v: 7 }, E2: { v: 1 } });
  const v1 = D.pasteSpecial(m, "s1", 0, 3, { block, values, from: { r: 0, c: 0 } }, { paste: "values" });
  const s1 = M.sheetById(v1, "s1");
  assert.deepEqual([s1.cells.D1.v, s1.cells.E1.v, s1.cells.D1.s.fill], [2, 4, "#ff0000"]);
  assert.equal(s1.cells.E1.f, undefined);
  const v2 = D.pasteSpecial(m, "s1", 0, 3, { block, values, from: { r: 0, c: 0 } }, { paste: "formats" });
  assert.deepEqual([M.sheetById(v2, "s1").cells.D1.v, M.sheetById(v2, "s1").cells.D1.s.b], [10, true]);
  const v3 = D.pasteSpecial(m, "s1", 0, 3, { block, values, from: { r: 0, c: 0 } }, { paste: "values", op: "add", skipBlanks: true });
  const s3 = M.sheetById(v3, "s1");
  assert.deepEqual([s3.cells.D1.v, s3.cells.E1.v, s3.cells.D2.v, s3.cells.E2.v], [12, 5, 7, 5]);
  const v4 = D.pasteSpecial(m, "s1", 5, 0, { block, values, from: { r: 0, c: 0 } }, { paste: "all", transpose: true });
  const s4 = M.sheetById(v4, "s1");
  assert.equal(s4.cells.A6.v, 2);
  assert.equal(s4.cells.A7.f, "A6*2"); // formulas move with the paste offset
  assert.equal(s4.cells.B7.v, 4);
});

test("row and column groups collapse and expand; hidden indexes", () => {
  let m = book({});
  m = D.group(m, "s1", "row", 2, 5);
  m = D.group(m, "s1", "col", 1, 2);
  let s = M.sheetById(m, "s1");
  assert.equal(s.groups.row.length, 1);
  assert.deepEqual([...D.collapsedIndexes(s, "row")], []);
  m = D.setCollapsed(m, "s1", "row", 3, true);
  s = M.sheetById(m, "s1");
  assert.deepEqual([...D.collapsedIndexes(s, "row")], [2, 3, 4, 5]);
  m = D.ungroup(m, "s1", "row", 2, 5);
  assert.equal(M.sheetById(m, "s1").groups.row.length, 0);
  const shifted = M.shiftAxis(m, "s1", "col", 0, 1);
  assert.deepEqual(M.sheetById(shifted, "s1").groups.col[0], { from: 2, to: 3, collapsed: false });
});

test("page setup is validated and the print range follows it", () => {
  let m = book({ A1: { v: 1 }, C3: { v: 2 } });
  m = D.setPageSetup(m, "s1", { orientation: "landscape", paper: "letter", printArea: "A1:B2", gridlines: false, fit: "page", margin: 999 });
  const s = M.sheetById(m, "s1");
  assert.equal(s.page.orientation, "landscape");
  assert.equal(s.page.margin, 144);
  const opts = D.printOptions(s);
  assert.deepEqual(opts.page, { w: 1056, h: 816 });
  assert.equal(opts.gridlines, false);
  assert.equal(opts.single, true);
  assert.deepEqual(opts.range, { r0: 0, c0: 0, r1: 1, c1: 1 });
  assert.throws(() => D.setPageSetup(m, "s1", { printArea: "nope" }), /range/i);
});

test("pivot-lite groups rows and aggregates values", () => {
  const cells = {};
  const rows = [["Region", "Product", "Sales"], ["North", "A", 10], ["South", "A", 5], ["North", "B", 7], ["North", "A", 3]];
  rows.forEach((row, r) => row.forEach((v, c) => (cells[M.rcKey(r, c)] = { v })));
  const m = book(cells);
  const calc = createCalc(m);
  const p = D.pivot(m, M.sheetById(m, "s1"), (sid, r, c) => calc.get(sid, r, c), { range: "A1:C5", rows: "Region", values: "Sales", agg: "sum" });
  assert.deepEqual(p, [["Region", "Sum of Sales"], ["North", 20], ["South", 5], ["Total", 25]]);
  const q = D.pivot(m, M.sheetById(m, "s1"), (sid, r, c) => calc.get(sid, r, c), { range: "A1:C5", rows: "Region", columns: "Product", values: "Sales", agg: "count" });
  assert.deepEqual(q[0], ["Region", "A", "B", "Total"]);
  assert.deepEqual(q[1], ["North", 2, 1, 3]);
  const out = D.writePivot(m, "s1", p, { name: "Pivot" });
  assert.equal(out.sheets.length, 2);
  assert.equal(M.sheetByName(out, "Pivot").cells.B4.v, 25);
});

test("sparklines read their range and draw as a path", () => {
  let m = book(nums([1, 3, 2, 5], "A"));
  m = D.addSparkline(m, "s1", { cell: "B1", range: "A1:A4", type: "line" });
  const s = M.sheetById(m, "s1");
  const calc = createCalc(m);
  const sp = D.sparklineAt(s, 0, 1);
  assert.equal(sp.type, "line");
  assert.deepEqual(D.sparkValues(m, s, sp, (sid, r, c) => calc.get(sid, r, c)), [1, 3, 2, 5]);
  const pts = D.sparkPoints([1, 3, 2, 5], { x: 0, y: 0, w: 30, h: 10 });
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], [0, 10]);
  assert.deepEqual(pts[3], [30, 0]);
  m = D.removeSparklines(m, "s1", "B1");
  assert.equal(M.sheetById(m, "s1").sparks.length, 0);
});

test("chart data from a sheet range is a plain, app-neutral payload", () => {
  const cells = {};
  const rows = [["Month", "Plan", "Actual"], ["Jan", 10, 12], ["Feb", 20, 18]];
  rows.forEach((row, r) => row.forEach((v, c) => (cells[M.rcKey(r, c)] = { v })));
  const m = book(cells);
  const calc = createCalc(m);
  const d = D.sheetChartData(m, { range: "A1:C3" }, (sid, r, c) => calc.get(sid, r, c));
  assert.deepEqual(d.categories, ["Jan", "Feb"]);
  assert.deepEqual(d.series, [{ name: "Plan", values: [10, 20] }, { name: "Actual", values: [12, 18] }]);
  assert.equal(d.source, "Sheet1!A1:C3");
  const byRows = D.sheetChartData(m, { range: "A1:C3", seriesIn: "rows" }, (sid, r, c) => calc.get(sid, r, c));
  assert.deepEqual(byRows.categories, ["Plan", "Actual"]);
  assert.deepEqual(byRows.series[0], { name: "Jan", values: [10, 12] });
});

test("collaboration records carry defined names", () => {
  const m = D.setName(book({ A1: { v: 1 } }), "One", "Sheet1!$A$1");
  const rec = M.toRecords(m);
  assert.deepEqual(rec["meta:names"], { One: "Sheet1!$A$1" });
  const back = M.applyRecords(book({}), rec);
  assert.deepEqual(back.names, { One: "Sheet1!$A$1" });
});
