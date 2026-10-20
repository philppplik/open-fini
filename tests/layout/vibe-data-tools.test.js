import test from "node:test";
import assert from "node:assert/strict";

globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return { font: "", measureText: (t) => ({ width: String(t).length * 7, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3, actualBoundingBoxAscent: 8 }) };
  }
};
const { Doc } = await import("../../app/src/core/doc.js");
const { layoutDataTools } = await import("../../app/src/vibe/tools/layout-data.js");
const { buildPageDL } = await import("../../app/src/engine/dl.js");

function setup() {
  const doc = new Doc({ name: "R", width: 1000, height: 700, studio: "layout" });
  const app = { doc, page: doc.pages[0], context: doc.pages[0].root, selection: [], select(n) { app.selection = n; }, toast() {}, requestRender() {} };
  const tools = Object.fromEntries(layoutDataTools(app).map((t) => [t.name, t]));
  return { doc, app, tools };
}

test("the tools describe themselves and mark reads as read-only", () => {
  const { tools } = setup();
  for (const n of ["add_table", "edit_table", "read_table", "add_chart", "edit_chart", "read_chart", "import_csv_to_table", "list_tables"]) {
    assert.ok(tools[n], n);
    assert.ok(tools[n].description.length > 60, n);
  }
  assert.equal(tools.read_table.readOnly, true);
  assert.equal(tools.read_chart.readOnly, true);
  assert.ok(!tools.add_table.readOnly);
});

test("build a report: table with formulas, linked chart, edits, read-back", async () => {
  const { doc, tools } = setup();
  const t = await tools.add_table.run({ data: [["Region", "Q1", "Q2"], ["North", 120, 150], ["South", 90, "=B3*1.2"], ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)"]], headerCols: 1, style: "striped", numberFormats: { B: { type: "currency", decimals: 0 } }, x: 40, y: 40 });
  assert.equal(t.rows, 4);
  assert.equal(t.lastCell, "C4");
  const r = await tools.read_table.run({ id: t.id });
  assert.equal(r.values[3][1], 210);
  assert.equal(r.display[3][1], "$210");
  assert.equal(r.values[2][2], 108);

  const c = await tools.add_chart.run({ type: "column", title: "Sales", tableId: t.id, x: 40, y: 300 });
  assert.equal(c.linkedTo, t.id);
  assert.equal(c.series, 2);
  const rc = await tools.read_chart.run({ id: c.id });
  assert.deepEqual(rc.data.categories, ["North", "South", "Total"]);
  assert.deepEqual(rc.data.series[0].values, [120, 90, 210]);

  await tools.edit_table.run({ id: t.id, operations: [{ op: "set_cells", cells: { B2: "200" } }, { op: "insert_rows", at: 2 }, { op: "set_cells", cells: { A3: "East", B3: "50" } }, { op: "format", range: "A1:C1", bold: true, fill: "#ffeeaa" }] });
  const r2 = await tools.read_table.run({ id: t.id });
  assert.equal(r2.rows, 5);
  assert.equal(r2.raw[4][1], "=SUM(B2:B4)", "formula range grows with the inserted row");
  assert.equal(r2.values[4][1], 340);
  assert.equal((await tools.read_chart.run({ id: c.id })).data.series[0].values[3], 340);

  await assert.rejects(async () => tools.edit_table.run({ id: t.id, operations: [{ op: "set_cells", cells: { Z99: "x" } }] }), /outside the table/);
  assert.equal((await tools.read_table.run({ id: t.id })).rows, 5, "a failed operation changes nothing");
  await assert.rejects(async () => tools.edit_table.run({ id: c.id, operations: [] }), /not a table/);

  await tools.edit_chart.run({ id: c.id, type: "line", palette: "ocean", legend: "top", yTitle: "Units", numberFormat: { type: "number", decimals: 0 } });
  const rc2 = await tools.read_chart.run({ id: c.id });
  assert.equal(rc2.type, "line");
  assert.equal(rc2.options.palette, "ocean");
  assert.equal(rc2.options.yTitle, "Units");
  assert.ok(rc2.linked);
  await tools.edit_chart.run({ id: c.id, unlink: true });
  assert.equal((await tools.read_chart.run({ id: c.id })).linked, null);
  assert.ok(doc.history.entries.length > 3);
  const dl = buildPageDL(doc, doc.pages[0]);
  assert.ok(dl.items.length >= 2);
});

test("merge / sort / import CSV through the tools", async () => {
  const { tools } = setup();
  const t = await tools.import_csv_to_table.run({ csv: 'Name;Score\n"Lee, A";30\nKim;10\nPat;20', header: true });
  assert.equal(t.rows, 4);
  assert.equal(t.cols, 2);
  await tools.edit_table.run({ id: t.id, operations: [{ op: "sort", column: "B", direction: "asc" }] });
  const r = await tools.read_table.run({ id: t.id });
  assert.deepEqual(r.raw.map((x) => x[0]), ["Name", "Kim", "Pat", "Lee, A"]);
  await tools.edit_table.run({ id: t.id, operations: [{ op: "merge", range: "A1:B1" }] });
  assert.deepEqual((await tools.read_table.run({ id: t.id })).merges, ["A1:B1"]);
  await tools.import_csv_to_table.run({ csv: "a,b,c\n1,2,3", tableId: t.id });
  assert.equal((await tools.read_table.run({ id: t.id })).cols, 3);
  assert.equal((await tools.list_tables.run({})).tables.length, 1);
  const c = await tools.add_chart.run({ preset: "donut" });
  assert.equal((await tools.read_chart.run({ id: c.id })).type, "donut");
  const k = await tools.add_chart.run({ type: "kpi", series: [{ name: "Revenue", values: [10, 12] }], categories: ["a", "b"] });
  assert.equal(k.series, 1);
});
