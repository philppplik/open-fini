// Spreadsheet app codecs: XLSX / ODS / CSV round trips, hostile input, collaboration records and the model's structure
// operations (docs/office-sheet.md).
import test from "node:test";
import assert from "node:assert/strict";
import { readXlsx, writeXlsx } from "../../app/src/office/sheet/xlsx.js";
import { readOds, writeOds, fromOdfFormula, toOdfFormula } from "../../app/src/office/sheet/ods.js";
import { readDelimitedSheet, writeDelimitedSheet } from "../../app/src/office/sheet/csv.js";
import { createCalc } from "../../app/src/office/sheet/formula.js";
import * as M from "../../app/src/office/sheet/model.js";
import { writeZip } from "../../app/src/engine/office/zip.js";

const book = () => {
  let m = M.templateWorkbook("budget", "Budget 2026");
  m = M.addSheet(m, { name: "Data sheet" });
  const sid = m.active;
  m = M.setCells(m, sid, { A1: { v: "x" }, B1: { v: 2.5, s: { nf: "0.00%", b: true, fill: "#ffeeaa", ha: "center" } }, A2: { v: true }, B2: { f: "Budget!B11*2" }, C3: { v: 46323, s: { nf: "yyyy-mm-dd" } } });
  m = M.mergeRange(m, sid, { r0: 4, c0: 0, r1: 5, c1: 2 });
  m = M.setSize(m, sid, "col", [1], 150);
  m = M.setSize(m, sid, "row", [2], 40);
  return m;
};

const cellsOf = (m, name) => M.sheetByName(m, name).cells;

for (const [label, write, read] of [
  ["xlsx", writeXlsx, readXlsx],
  ["ods", writeOds, readOds],
]) {
  test(`${label}: round trip keeps values, formulas, styles, merges, sizes and frozen panes`, () => {
    const m = book();
    const bytes = write(m, { calc: createCalc(m) });
    assert.ok(bytes instanceof Uint8Array && bytes.length > 500);
    const back = read(bytes, {});
    assert.deepEqual(back.sheets.map((s) => s.name), ["Budget", "Data sheet"]);
    const a = cellsOf(back, "Data sheet");
    assert.equal(a.A1.v, "x");
    assert.equal(a.B1.v, 2.5);
    assert.equal(a.B1.s.nf, "0.00%");
    assert.equal(a.B1.s.b, true);
    assert.equal(a.B1.s.fill, "#ffeeaa");
    assert.equal(a.B1.s.ha, "center");
    assert.equal(a.A2.v, true);
    assert.equal(a.B2.f, "Budget!B11*2");
    assert.equal(a.C3.v, 46323);
    const dataSheet = M.sheetByName(back, "Data sheet");
    assert.deepEqual(dataSheet.merges, ["A5:C6"]);
    assert.ok(Math.abs(dataSheet.cols[1] - 150) <= 2, `column width ${dataSheet.cols[1]}`);
    assert.ok(Math.abs(dataSheet.rows[2] - 40) <= 2, `row height ${dataSheet.rows[2]}`);
    const budget = M.sheetByName(back, "Budget");
    assert.deepEqual(budget.freeze, { r: 3, c: 0 });
    assert.equal(budget.cells.D4.f, "B4-C4");
    assert.equal(budget.cells.B11.f, "SUM(B4:B10)");
    assert.equal(budget.cells.B4.s.nf, '"$"#,##0.00');
    const calc = createCalc(back);
    assert.equal(calc.value(budget.id, "B11"), 2645);
    assert.equal(calc.value(dataSheet.id, "B2"), 5290);
  });
}

test("xlsx: charts, conditional formats and filters survive a round trip", () => {
  let m = M.templateWorkbook("budget");
  const sid = m.active;
  m = M.updateSheet(m, sid, (s) => ({ ...s, filter: { range: "A3:D10", hide: {} } }));
  const back = readXlsx(writeXlsx(m, { calc: createCalc(m) }));
  const s = back.sheets[0];
  assert.equal(s.charts.length, 1);
  assert.equal(s.charts[0].type, "column");
  assert.equal(s.charts[0].range, "A3:C10");
  assert.equal(s.charts[0].title, "Planned vs. actual");
  assert.equal(s.cf.length, 1);
  assert.equal(s.cf[0].type, "lt");
  assert.equal(s.cf[0].a, 0);
  assert.equal(s.filter.range, "A3:D10");
});

test("xlsx: shared formulas expand, inline strings and 1904 dates read", () => {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c><c r="C1" t="inlineStr"><is><t>hi</t></is></c></row>
    <row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/></c></row>
    <row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/></c><c r="C3" s="1"><v>0</v></c></row></sheetData></worksheet>`;
  const bytes = writeZip([
    ["[Content_Types].xml", "<Types/>"],
    ["xl/workbook.xml", '<workbook xmlns:r="r"><workbookPr date1904="1"/><sheets><sheet name="One" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/styles.xml", '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
  const m = readXlsx(bytes);
  const c = m.sheets[0].cells;
  assert.equal(c.B2.f, "A2*2");
  assert.equal(c.B3.f, "A3*2");
  assert.equal(c.C1.v, "hi");
  assert.equal(c.C3.v, 1462);
  assert.equal(createCalc(m).value(m.sheets[0].id, "B3"), 6);
});

test("hostile input: not a workbook, unsafe zip entries", () => {
  assert.throws(() => readXlsx(new Uint8Array([1, 2, 3, 4, 5])));
  const bytes = writeZip([["../evil.xml", "x"], ["mimetype", "application/vnd.oasis.opendocument.spreadsheet"]]);
  assert.throws(() => readOds(bytes));
  // billion-laughs style entities are not expanded by the XML parser
  const lol = writeZip([["mimetype", "application/vnd.oasis.opendocument.spreadsheet"], ["content.xml", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><office:document-content><office:body><office:spreadsheet><table:table table:name="T"><table:table-row><table:table-cell office:value-type="string"><text:p>&b;</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>']]);
  const m = readOds(lol);
  assert.ok(String(m.sheets[0].cells.A1.v).length < 20);
});

test("ods: huge repeated empty rows and columns do not expand", () => {
  const xml = '<office:document-content><office:body><office:spreadsheet><table:table table:name="T"><table:table-column table:number-columns-repeated="16384"/><table:table-row><table:table-cell office:value-type="float" office:value="7"/></table:table-row><table:table-row table:number-rows-repeated="1048575"><table:table-cell table:number-columns-repeated="16384"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>';
  const t0 = Date.now();
  const m = readOds(new TextEncoder().encode(xml));
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(Object.keys(m.sheets[0].cells), ["A1"]);
});

test("ods: OpenFormula conversion", () => {
  assert.equal(fromOdfFormula("of:=SUM([.A1:.B3];[$'My sheet'.C1])"), "SUM(A1:B3,'My sheet'!C1)");
  assert.equal(fromOdfFormula('of:=IF([.A1]>0;"a;b";"c")'), 'IF(A1>0,"a;b","c")');
  assert.equal(toOdfFormula('IF(A1>0,"a,b",Other!$B$2)'), `of:=IF([.A1]>0;"a,b";[$'Other'.$B$2])`);
  assert.equal(fromOdfFormula(toOdfFormula("SUM('My sheet'!A1:B2)")), "SUM('My sheet'!A1:'My sheet'!B2)".replace(":'My sheet'!", ":"));
});

test("csv / tsv: read with separator sniffing and number parsing, write computed values", () => {
  const m = readDelimitedSheet(new TextEncoder().encode('name;amount\n"a; b";1.5\nc;=2*3\n'), "x.csv");
  const c = m.sheets[0].cells;
  assert.equal(c.A2.v, "a; b");
  assert.equal(c.B2.v, 1.5);
  assert.equal(c.B3.f, "2*3");
  const out = new TextDecoder().decode(writeDelimitedSheet(m, { calc: createCalc(m), sep: "," }));
  assert.equal(out, "name,amount\r\na; b,1.5\r\nc,6\r\n");
  assert.equal(new TextDecoder().decode(writeDelimitedSheet(m, { calc: createCalc(m), sep: ";" })).split("\r\n")[1], '"a; b";1.5');
});

test("collab records round trip and merge per cell", () => {
  const m = book();
  const rec = M.toRecords(m);
  assert.ok(Object.keys(rec).some((k) => /^cell:s1!B4$/.test(k)));
  const sid = m.sheets[1].id;
  const next = M.applyRecords(m, { [`cell:${sid}!Z9`]: { v: 9 }, [`cell:${sid}!A1`]: null, "sheet:new1": { name: "Remote", pos: 99, cols: {}, rows: {}, merges: [], freeze: null, filter: null, cf: [], charts: [] } });
  assert.equal(M.sheetById(next, sid).cells.Z9.v, 9);
  assert.equal(M.sheetById(next, sid).cells.A1, undefined);
  assert.equal(next.sheets[next.sheets.length - 1].name, "Remote");
  assert.deepEqual(M.toRecords(M.applyRecords(m, {})), rec);
});

test("structure: insert/delete rows keeps formulas, merges and charts consistent", () => {
  let m = M.templateWorkbook("budget");
  const sid = m.active;
  m = M.shiftAxis(m, sid, "row", 4, 2); // two rows above Utilities
  const s = M.sheetById(m, sid);
  assert.equal(s.cells.B13.f, "SUM(B4:B12)");
  assert.equal(s.cells.D7.f, "B7-C7");
  assert.equal(s.charts[0].range, "A3:C12");
  const calc = createCalc(m);
  assert.equal(calc.value(sid, "B13"), 2645);
  m = M.shiftAxis(m, sid, "row", 4, -2);
  assert.equal(M.sheetById(m, sid).cells.B11.f, "SUM(B4:B10)");
  m = M.renameSheet(M.addSheet(m, { name: "Other" }), sid, "Plan");
  m = M.setCells(m, m.active, { A1: { f: "Plan!B11" } });
  assert.equal(createCalc(m).value(m.active, "A1"), 2645);
});

test("sort and fill", () => {
  let m = M.newWorkbook();
  const sid = m.active;
  m = M.setCells(m, sid, { A1: { v: "n" }, A2: { v: 3 }, A3: { v: 1 }, A4: { v: 2 }, B2: { f: "A2*10" }, B3: { f: "A3*10" }, B4: { f: "A4*10" } });
  const calc = createCalc(m);
  m = M.sortRange(m, sid, { r0: 0, c0: 0, r1: 3, c1: 1 }, 0, { asc: true, header: true, valueOf: (r, c) => calc.get(sid, r, c), compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) });
  const c = M.sheetById(m, sid).cells;
  assert.deepEqual([c.A2.v, c.A3.v, c.A4.v], [1, 2, 3]);
  assert.equal(c.B2.f, "A2*10");
  m = M.fillRange(m, sid, { r0: 1, c0: 0, r1: 2, c1: 0 }, { r0: 1, c0: 0, r1: 5, c1: 0 });
  assert.deepEqual([4, 5].map((r) => M.sheetById(m, sid).cells[`A${r + 1}`].v), [4, 5]);
});

test("input parsing", () => {
  assert.deepEqual(M.parseInput("=SUM(A1:A2)"), { f: "SUM(A1:A2)" });
  assert.deepEqual(M.parseInput("1,234.5"), { v: 1234.5, nf: "#,##0.00" });
  assert.deepEqual(M.parseInput("12%"), { v: 0.12, nf: "0%" });
  assert.deepEqual(M.parseInput("$12"), { v: 12, nf: '"$"#,##0.00' });
  assert.deepEqual(M.parseInput("2026-10-28"), { v: 46323, nf: "yyyy-mm-dd" });
  assert.deepEqual(M.parseInput("'00123"), { v: "00123" });
  assert.deepEqual(M.parseInput("true"), { v: true });
  assert.equal(M.parseInput(""), null);
  assert.equal(M.editText({ v: "00123" }), "'00123");
});
