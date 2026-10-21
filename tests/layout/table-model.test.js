import test from "node:test";
import assert from "node:assert/strict";
import { createSheet, evaluateFormula, shiftFormula, moveFormula, isError } from "../../app/src/engine/layout/formula.js";
import { parseNumber, formatNumber, formatValue, parseDate, colName, parseCellName, parseRange } from "../../app/src/engine/layout/format.js";
import * as M from "../../app/src/engine/layout/table-model.js";

const sheetOf = (rows) => createSheet((r, c) => rows[r]?.[c], rows.length, Math.max(...rows.map((x) => x.length)));
const val = (rows, r, c) => sheetOf(rows).value(r, c);

test("parseNumber and number formats", () => {
  assert.equal(parseNumber("1,234.5"), 1234.5);
  assert.equal(parseNumber("$12"), 12);
  assert.equal(parseNumber("(5)"), -5);
  assert.equal(parseNumber("45%"), 0.45);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber(""), null);
  assert.equal(formatNumber(1234.5, { type: "number", decimals: 1 }), "1,234.5");
  assert.equal(formatNumber(1234.5, { type: "currency" }), "$1,234.50");
  assert.equal(formatNumber(0.256, { type: "percent", decimals: 1 }), "25.6%");
  assert.equal(formatNumber(-5, { type: "number", negative: "parens" }), "(5)");
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatValue("2026-01-31", { type: "date", dateStyle: "medium" }), "Jan 31, 2026");
  assert.equal(parseDate("2/30/2026"), null);
  assert.equal(colName(27), "AB");
  assert.deepEqual(parseCellName("C4"), { r: 3, c: 2 });
  assert.deepEqual(parseRange("B2:A1"), { r0: 0, c0: 0, r1: 1, c1: 1 });
});

test("formulas: aggregates, operators, errors", () => {
  const rows = [["Item", "Qty"], ["a", "10"], ["b", "20"], ["c", "x"], ["Sum", "=SUM(B2:B4)"], ["Avg", "=AVERAGE(B2:B4)"], ["n", "=COUNT(B1:B4)"], ["mm", "=MAX(B2:B3)-MIN(B2:B3)"]];
  assert.equal(val(rows, 4, 1), 30);
  assert.equal(val(rows, 5, 1), 15);
  assert.equal(val(rows, 6, 1), 2);
  assert.equal(val(rows, 7, 1), 10);
  const ctx = { rows: 1, cols: 1, get: () => null };
  assert.equal(evaluateFormula("=1+2*3^2", ctx), 19);
  assert.equal(evaluateFormula("=-(2+3)%", ctx), -0.05);
  assert.equal(evaluateFormula('=IF(2>1,"yes","no")&"!"', ctx), "yes!");
  assert.equal(evaluateFormula("=ROUND(2.345,2)", ctx), 2.35);
  assert.equal(evaluateFormula("=1/0", ctx).code, "#DIV/0!");
  assert.equal(evaluateFormula("=FOO(1)", ctx).code, "#NAME?");
  assert.equal(evaluateFormula("=1+", ctx).code, "#ERROR!");
  assert.equal(evaluateFormula("=Z99", ctx).code, "#REF!");
  assert.equal(evaluateFormula("=constructor", ctx).code, "#NAME?");
  assert.equal(evaluateFormula("=alert(1)", ctx).code, "#NAME?");
});

test("formulas: cycles and references", () => {
  const rows = [["=B1", "=A1"], ["=B2+1", "5"]];
  assert.ok(isError(val(rows, 0, 0)));
  assert.equal(val(rows, 0, 0).code, "#CYCLE!");
  assert.equal(val(rows, 1, 0), 6);
  assert.equal(shiftFormula("=SUM(B2:B5)+A9", { axis: "row", op: "insert", at: 3 }), "=SUM(B2:B6)+A10");
  assert.equal(shiftFormula("=A3+B4", { axis: "row", op: "delete", at: 2 }), "=#REF!+B3");
  assert.equal(shiftFormula("=SUM(B2:B5)", { axis: "row", op: "delete", at: 2 }), "=SUM(B2:B4)");
  assert.equal(shiftFormula("=$A$1+C1", { axis: "col", op: "insert", at: 0 }), "=$B$1+D1");
  assert.equal(moveFormula("=A1+A2", { axis: "row", from: 0, to: 1 }), "=A2+A1");
});

test("table model: create, insert/delete lines with formulas", () => {
  const t = M.createTable({ rows: 3, cols: 2, data: [["h1", "h2"], ["1", "2"], ["3", "=SUM(B2:B3)"]] });
  assert.equal(t.cells[2][1].v, "=SUM(B2:B3)");
  M.insertLines(t, "row", 2);
  assert.equal(t.rows.length, 4);
  assert.equal(t.cells[3][1].v, "=SUM(B2:B4)");
  M.deleteLines(t, "row", 2);
  assert.equal(t.cells[2][1].v, "=SUM(B2:B3)");
  M.insertLines(t, "col", 1);
  assert.equal(t.cols.length, 3);
  assert.equal(t.cells[2][2].v, "=SUM(C2:C3)");
  assert.equal(M.deleteLines(t, "col", 0, 3), false);
});

test("table model: merge, split, merged rows survive insert and delete", () => {
  const t = M.createTable({ rows: 4, cols: 3, headerRows: 1, data: [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]] });
  assert.ok(M.mergeCells(t, { r0: 1, c0: 0, r1: 2, c1: 1 }));
  assert.deepEqual(t.cells[1][0].rs, 2);
  assert.deepEqual(t.cells[2][1].m, [1, 0]);
  assert.equal(t.cells[1][0].v, "1");
  M.insertLines(t, "row", 2);
  assert.equal(t.cells[1][0].rs, 3);
  M.deleteLines(t, "row", 1);
  assert.equal(t.cells[1][0].rs, 2);
  assert.equal(t.cells[1][0].v, "1");
  assert.ok(M.splitCells(t, { r0: 1, c0: 0, r1: 1, c1: 0 }));
  assert.equal(t.cells[1][0].rs, undefined);
  assert.equal(M.moveLine(t, "row", 3, 1), true);
});

test("table model: sort keeps row formulas and puts empties last", () => {
  const t = M.createTable({ rows: 5, cols: 3, data: [["n", "a", "tot"], ["b", "30", "=B2*2"], ["a", "10", "=B3*2"], ["c", "", ""], ["d", "20", "=B5*2"]] });
  assert.equal(M.sortRows(t, 1, "asc"), true);
  assert.deepEqual(t.cells.slice(1).map((r) => r[0].v), ["a", "d", "b", "c"]);
  assert.equal(t.cells[1][2].v, "=B2*2");
  assert.deepEqual(M.tableValues(t).slice(1).map((r) => r[2]), [20, 40, 60, null]);
  M.sortRows(t, 1, "desc");
  assert.deepEqual(t.cells.slice(1).map((r) => r[0].v), ["b", "d", "a", "c"]);
});

test("CSV / TSV / HTML in and out", () => {
  const m = M.parseTextMatrix('a,b\n"x, y","say ""hi"""\n1,2');
  assert.deepEqual(m, [["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
  assert.deepEqual(M.parseTextMatrix("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  const t = M.createTable({ data: m, headerRows: 1 });
  assert.equal(M.tableToCSV(t, { mode: "raw" }), 'a,b\n"x, y","say ""hi"""\n1,2');
  assert.equal(M.tableToCSV(t, { delimiter: "\t" }), 'a\tb\nx, y\t"say ""hi"""\n1\t2');
  const html = "<table><tr><th>A</th><th>B &amp; C</th></tr><tr><td colspan=2>x<br>y</td></tr></table>";
  assert.deepEqual(M.parseHtmlTable(html), [["A", "B & C"], ["x\ny", ""]]);
  assert.equal(M.parseHtmlTable("<p>no</p>"), null);
  assert.equal(M.looksTabular("a\tb\n1\t2"), true);
  assert.equal(M.looksTabular("just a sentence"), false);
  const p = M.createTable({ rows: 1, cols: 1 });
  M.pasteMatrix(p, 0, 0, [["1", "2"], ["3", "4"]]);
  assert.equal(p.rows.length, 2);
  assert.equal(p.cols.length, 2);
  assert.equal(p.cells[1][1].v, "4");
});

test("pagination repeats header rows and keeps merged rows together", () => {
  const t = M.createTable({ rows: 8, cols: 2, headerRows: 1 });
  const heights = Array(8).fill(40);
  const chunks = M.paginateRows(t, heights, 130, 130);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].from, 0);
  assert.equal(chunks[chunks.length - 1].to, 8);
  const s = M.sliceRows(t, chunks[1].from, chunks[1].to);
  assert.equal(s.headerRows, 1);
  assert.equal(s.cells[0][0].v, "Column 1");
  const tm = M.createTable({ rows: 5, cols: 1, headerRows: 1 });
  M.mergeCells(tm, { r0: 2, c0: 0, r1: 3, c1: 0 });
  for (const c of M.paginateRows(tm, Array(5).fill(40), 100, 100)) assert.ok(!(c.from === 3) && !(c.to === 3));
});
