// Spreadsheet depth features in files (docs/office-sheet.md ▸ Formats): named ranges, data validation, tables, groups,
// page setup, sparklines, refreshable pivots and dynamic arrays through XLSX and ODS; fit-to-page scaling; validation of
// pasted and tool-written values.
import test from "node:test";
import assert from "node:assert/strict";
import { readXlsx, writeXlsx } from "../../app/src/office/sheet/xlsx.js";
import { readOds, writeOds } from "../../app/src/office/sheet/ods.js";
import { createCalc, isErr } from "../../app/src/office/sheet/formula.js";
import { readZip, strFromU8 } from "../../app/src/engine/office/zip.js";
import { sheetPages } from "../../app/src/office/sheet/render.js";
import * as M from "../../app/src/office/sheet/model.js";
import * as D from "../../app/src/office/sheet/depth.js";
import { outlineLevels, groupsFromLevels, nestedGroups, bakeTables, unbakeTable, tableStyleFromXl } from "../../app/src/office/sheet/depth-io.js";

const val = (calc, k, sid) => {
  const v = calc.value(sid, k);
  return isErr(v) ? v.code : v;
};

/** A workbook that uses every depth feature. */
function richBook() {
  let m = M.normalizeWorkbook({
    sheets: [
      {
        id: "s1",
        name: "Data",
        cells: {
          A1: { v: "Region" }, B1: { v: "Year" }, C1: { v: "Sales" },
          A2: { v: "North" }, B2: { v: 2025 }, C2: { v: 10 },
          A3: { v: "South" }, B3: { v: 2025 }, C3: { v: 20 },
          A4: { v: "North" }, B4: { v: 2026 }, C4: { v: 30 },
          A5: { v: "South" }, B5: { v: 2026 }, C5: { v: 5 },
          E1: { f: "SORT(UNIQUE(A2:A5))" },
          F1: { f: "SUM(C2:C5)*TaxRate" },
          G1: { v: 0.19 },
          H1: { v: "x" },
        },
      },
    ],
  });
  m = D.setName(m, "TaxRate", "Data!$G$1");
  m = D.setName(m, "Sales", "Data!$C$2:$C$5");
  m = D.addTable(m, "s1", { range: "A1:C5", style: "green", total: true });
  m = D.addValidation(m, "s1", { range: "C2:C5", type: "number", min: 0, max: 100, message: "0 to 100" });
  m = D.addValidation(m, "s1", { range: "H1:H4", type: "list", list: ["x", "y", "z"], allowBlank: false });
  m = D.addValidation(m, "s1", { range: "I1", type: "textLength", max: 5 });
  m = D.group(m, "s1", "row", 1, 4);
  m = D.group(m, "s1", "row", 1, 2);
  m = D.setCollapsed(m, "s1", "row", 1, true); // the inner group
  m = D.group(m, "s1", "col", 9, 11);
  m = D.setPageSetup(m, "s1", { orientation: "landscape", paper: "letter", margin: 72, gridlines: true, fit: "page", printArea: "A1:F10" });
  m = D.addSparkline(m, "s1", { cell: "D2", range: "B2:C2", type: "column", color: "#ff0000" });
  const calc = createCalc(m);
  const table = D.pivot(m, M.sheetById(m, "s1"), (sid, r, c) => calc.get(sid, r, c), { range: "A1:C5", rows: "Region", columns: "Year", values: "Sales" });
  m = D.writePivot(m, "s1", table, { name: "Pivot", spec: { range: "A1:C5", rows: "Region", columns: "Year", values: "Sales" } });
  return m;
}

const sheetOf = (m, name) => M.sheetByName(m, name);
const strip = (list) => (list || []).map(({ id, ...rest }) => rest);

for (const [label, write, read] of [["XLSX", writeXlsx, readXlsx], ["ODS", writeOds, readOds]]) {
  test(`${label}: names, validation, tables, groups, page setup, sparklines and pivots round trip`, () => {
    const m = richBook();
    const back = read(write(m, { calc: createCalc(m) }));
    const a = sheetOf(m, "Data");
    const b = sheetOf(back, "Data");
    assert.equal(back.names.TaxRate.replace(/\$/g, ""), "Data!G1");
    assert.equal(back.names.Sales.replace(/\$/g, ""), "Data!C2:C5");
    assert.deepEqual(strip(b.validation).map((v) => ({ ...v })), strip(a.validation));
    assert.deepEqual(strip(b.tables), strip(a.tables));
    assert.deepEqual(b.groups, a.groups);
    assert.deepEqual(b.page, a.page);
    assert.deepEqual(strip(b.sparks), strip(a.sparks));
    // collapsed rows are hidden by the group, not by a row size of 0
    assert.equal(b.rows[1], undefined);
    // the table look is not baked into the cells
    assert.equal(b.cells.A1.s?.fill, a.cells.A1.s?.fill);
    const pa = sheetOf(m, "Pivot").pivots;
    const pb = sheetOf(back, "Pivot").pivots;
    assert.deepEqual(strip(pb), strip(pa));
    // formulas with names still compute
    const calc = createCalc(back);
    assert.ok(Math.abs(val(calc, "F1", b.id) - 65 * 0.19) < 1e-9);
    // the spill still spills (its cached values were not stored as cell values)
    assert.deepEqual(["E1", "E2", "E3"].map((k) => val(calc, k, b.id)), ["North", "South", null]);
    assert.equal(b.cells.E2, undefined);
  });
}

test("XLSX writes spilling formulas as dynamic arrays with Excel's metadata", () => {
  const m = richBook();
  const { entries } = readZip(writeXlsx(m, { calc: createCalc(m) }));
  const sheet = strFromU8(entries["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<c r="E1"[^>]* cm="1"><f t="array" ref="E1:E2">_xlfn\._xlws\.SORT\(_xlfn\.UNIQUE\(A2:A5\)\)<\/f>/);
  assert.match(sheet, /<c r="E2"[^>]*t="str"><v>South<\/v>/);
  assert.match(strFromU8(entries["xl/metadata.xml"]), /XLDAPR[\s\S]*fDynamic="1"/);
  assert.match(strFromU8(entries["xl/_rels/workbook.xml.rels"]), /sheetMetadata/);
  assert.match(strFromU8(entries["[Content_Types].xml"]), /sheetMetadata\+xml/);
  assert.match(sheet, /<tableParts count="1">/);
  const tablePart = strFromU8(entries["xl/tables/table1.xml"]);
  assert.match(tablePart, /totalsRowCount="1"/);
  assert.match(tablePart, /<tableColumn id="1" name="Region" totalsRowLabel="Total"\/>/);
  assert.match(tablePart, /name="TableStyleMedium7"/);
  assert.match(sheet, /<dataValidation type="list"[^>]*sqref="H1:H4"><formula1>"x,y,z"<\/formula1>/);
  assert.match(sheet, /<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="1"\/>/);
  assert.match(sheet, /<row r="2" hidden="1" outlineLevel="2">/);
  assert.match(sheet, /<row r="4" outlineLevel="1" collapsed="1">/);
  assert.match(sheet, /x14:sparklineGroup type="column"/);
  assert.match(strFromU8(entries["xl/workbook.xml"]), /_xlnm\.Print_Area[^>]*>Data!\$A\$1:\$F\$10/);
});

test("XLSX: a table without unique text headers is written as formatted cells", () => {
  let m = M.normalizeWorkbook({ sheets: [{ id: "s1", name: "S", cells: { A1: { v: 1 }, B1: { v: 1 }, A2: { v: 2 }, B2: { v: 3 } } }] });
  m = D.addTable(m, "s1", { range: "A1:B2", style: "blue" });
  const { entries } = readZip(writeXlsx(m));
  assert.equal(entries["xl/tables/table1.xml"], undefined);
  const back = readXlsx(writeXlsx(m));
  assert.equal(back.sheets[0].cells.A1.s.fill, "#4472c4");
});

test("outline levels rebuild nested groups; crossing groups are left out of files", () => {
  const groups = [{ from: 1, to: 6, collapsed: false }, { from: 2, to: 3, collapsed: true }, { from: 5, to: 6, collapsed: false }];
  const lv = outlineLevels(groups);
  assert.equal(lv.get(2), 2);
  assert.deepEqual(groupsFromLevels(lv, (g) => g.from === 2), groups);
  assert.deepEqual(nestedGroups([{ from: 1, to: 4 }, { from: 3, to: 8 }]), [{ from: 1, to: 4 }]);
});

test("table looks bake into cell styles and unbake again", () => {
  let m = M.normalizeWorkbook({ sheets: [{ id: "s1", name: "S", cells: { A1: { v: "h" }, A2: { v: 1, s: { b: true } }, A3: { v: 2 } } }] });
  m = D.addTable(m, "s1", { range: "A1:A3", style: "orange" });
  const s = m.sheets[0];
  const cells = bakeTables(s);
  assert.equal(cells.A1.s.fill, "#ed7d31");
  const copy = { ...s, cells: { ...cells } };
  unbakeTable(copy, s.tables[0]);
  assert.deepEqual(copy.cells, s.cells);
  assert.equal(tableStyleFromXl("TableStyleMedium9"), "blue");
});

test("pivot tables refresh from changed data and shrink cleanly", () => {
  let m = richBook();
  const data = sheetOf(m, "Data");
  m = M.setCells(m, data.id, { C2: { v: 100 }, A2: { v: "South" }, A4: { v: "South" } });
  const calc = createCalc(m);
  const res = D.refreshPivots(m, (sid, r, c) => calc.get(sid, r, c));
  assert.equal(res.refreshed, 1);
  assert.deepEqual(res.errors, []);
  const p = sheetOf(res.model, "Pivot");
  const c2 = createCalc(res.model);
  // only South is left: the table shrinks by a row and the old last row is cleared
  assert.equal(val(c2, "A2", p.id), "South");
  assert.equal(val(c2, "B2", p.id), 120);
  assert.equal(val(c2, "A3", p.id), "Total");
  assert.equal(val(c2, "A4", p.id), null);
  assert.equal(p.pivots[0].size.rows, 3);
  assert.ok(D.pivotAt(p, 1, 1));
  // the source reference follows inserted rows
  const shifted = M.shiftAxis(res.model, data.id, "row", 0, 2);
  assert.equal(sheetOf(shifted, "Pivot").pivots[0].src, "Data!A3:C7");
});

test("fit to page scales the print area onto the chosen paper", () => {
  const cells = {};
  for (let c = 0; c < 30; c++) cells[`${String.fromCharCode(65 + (c % 26))}${c < 26 ? 1 : 2}`] = { v: c };
  let m = M.normalizeWorkbook({ sheets: [{ id: "s1", name: "S", cells }] });
  const measurer = { measure: (font, text) => String(text).length * 6 };
  const calc = createCalc(m);
  m = D.setPageSetup(m, "s1", { paper: "a4", fit: "page" });
  const pages = sheetPages(m, "s1", calc, { measurer, ...D.printOptions(m.sheets[0]) });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 794);
  assert.equal(pages[0].items[0].t, "group");
  assert.ok(pages[0].items[0].m[0] < 1);
  const plain = sheetPages(m, "s1", calc, { measurer, ...D.printOptions({ page: { paper: "a4" } }) });
  assert.ok(plain.length > 1);
  m = D.setPageSetup(m, "s1", { fit: "width", paper: "legal" });
  const wide = sheetPages(m, "s1", calc, { measurer, ...D.printOptions(m.sheets[0]) });
  assert.equal(wide.length, 1);
  assert.equal(wide[0].height, 1344);
});

test("pasted and tool-written values are checked against data validation", () => {
  let m = M.normalizeWorkbook({ sheets: [{ id: "s1", name: "S", cells: {} }] });
  m = D.addValidation(m, "s1", { range: "A1:A5", type: "integer", min: 1, max: 10 });
  const calc = createCalc(m);
  const get = (sid, r, c) => calc.get(sid, r, c);
  const next = M.setCells(m, "s1", { A1: { v: 5 }, A2: { v: 50 }, A3: { f: "100" }, B1: { v: 999 } });
  assert.deepEqual(D.invalidWrites(m, next, "s1", get).map((x) => x.cell), ["A2"]);
});
