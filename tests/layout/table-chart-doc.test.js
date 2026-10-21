import test from "node:test";
import assert from "node:assert/strict";

// A tiny canvas stand-in so the browser text measurer works in Node.
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
const { saveOfini, loadOfini } = await import("../../app/src/core/ofini.js");
const { buildPageDL } = await import("../../app/src/engine/dl.js");
const { displayListToSVG } = await import("../../app/src/engine/backends/svg.js");
const { createPDF } = await import("../../app/src/engine/backends/pdf.js");
const { addTableNode, addChartNode, editTable, editChart, linkChart, remapLinks, listTables } = await import("../../app/src/core/data-nodes.js");
const { insertLines, setCellValue } = await import("../../app/src/engine/layout/table-model.js");
const { captureTransform, applyPageDelta } = await import("../../app/src/core/transform.js");
const { localBounds } = await import("../../app/src/core/nodes.js");
const { duplicateSelection } = await import("../../app/src/core/ops.js");

function fakeApp(doc) {
  const app = { doc, page: doc.pages[0], context: doc.pages[0].root, selection: [], select(n) { app.selection = n; }, toast() {} };
  return app;
}

const flatten = (items) => items.flatMap((i) => (i.t === "group" ? flatten(i.items) : [i]));

function setup() {
  const doc = new Doc({ name: "Report", width: 800, height: 600, studio: "layout" });
  const app = fakeApp(doc);
  const table = addTableNode(app, { rows: 4, cols: 2, data: [["Quarter", "Sales"], ["Q1", "10"], ["Q2", "20"], ["Q3", "=SUM(B2:B3)"]], style: "striped", alt: "Sales table" });
  const chart = addChartNode(app, { type: "column", title: "Sales", w: 400, h: 240, alt: "" });
  doc.tx("link", () => editChart(doc, chart, (c) => linkChart(c, table)));
  return { doc, app, table, chart };
}

test("tables and charts compile to display lists and export to SVG / PDF", () => {
  const { doc, table, chart } = setup();
  assert.equal(table.type, "table");
  const dl = buildPageDL(doc, doc.pages[0]);
  const items = flatten(dl.items);
  assert.ok(items.some((i) => i.t === "text" && i.runs.some((r) => r.text === "Quarter")));
  assert.ok(items.some((i) => i.t === "text" && i.runs.some((r) => r.text === "Sales")), "chart title");
  assert.ok(table._bounds.w > 0 && table._bounds.h > 0);
  assert.ok(chart._plot);
  const svg = displayListToSVG(dl, { title: doc.name });
  assert.match(svg, /<title>Table<\/title><desc>Sales table<\/desc>/);
  assert.match(svg, /<title>Sales<\/title><desc>Column chart titled/);
  assert.ok(!svg.includes("NaN"));
  const pdf = createPDF([dl], { compress: false });
  assert.ok(pdf.length > 1000);
});

test("editing a table redraws the linked chart and undo restores both", () => {
  const { doc, table, chart } = setup();
  const before = JSON.stringify(flatten(buildPageDL(doc, doc.pages[0]).items).filter((i) => i.t === "path").length);
  assert.deepEqual(chart.chart.data.series[0].values, [10, 20, 30]);
  editTable(doc, table, (m) => setCellValue(m, 1, 1, "100"));
  const dl1 = buildPageDL(doc, doc.pages[0]);
  const desc = displayListToSVG(dl1, {}).match(/<desc>([^<]*)<\/desc>/g).join("");
  assert.match(desc, /peaks at 120/, "the chart sees the recalculated formula (100 + 20)");
  void before;
  doc.undo();
  assert.equal(table.cells[1][1].v, "10");
  assert.match(displayListToSVG(buildPageDL(doc, doc.pages[0]), {}), /peaks at 30/);
});

test("insert row keeps the SUM formula and adds a row to the layout", () => {
  const { doc, table } = setup();
  editTable(doc, table, (m) => insertLines(m, "row", 2));
  assert.equal(table.rows.length, 5);
  assert.equal(table.cells[4][1].v, "=SUM(B2:B4)");
});

test(".ofini round trip keeps tables, charts, links, alt text and saved styles", async () => {
  const { doc, table, chart } = setup();
  doc.set(doc, { tableStyles: { ts1: { name: "Mine", style: { size: 16 } } } });
  const back = await loadOfini(await saveOfini(doc));
  const t = back.find(table.id);
  const c = back.find(chart.id);
  assert.equal(t.type, "table");
  assert.equal(t.cells[3][1].v, "=SUM(B2:B3)");
  assert.equal(t.alt, "Sales table");
  assert.equal(t.tstyle.zebra, true);
  assert.equal(c.chart.source.tableId, table.id);
  assert.equal(c.chart.type, "column");
  assert.equal(back.tableStyles.ts1.name, "Mine");
  assert.equal(listTables(back).length, 1);
  assert.ok(!("_tl" in JSON.parse(JSON.stringify(back.toJSON().pages[0].root.children[0]))));
  const svg = displayListToSVG(buildPageDL(back, back.pages[0]), {});
  assert.match(svg, /Quarter/);
});

test("duplicating a table with its chart re-links the copy; resizing a table scales columns and rows", () => {
  const { doc, app, table, chart } = setup();
  app.selection = [table, chart];
  const copies = duplicateSelection(app);
  assert.equal(copies.length, 2);
  const [t2, c2] = copies;
  assert.notEqual(t2.id, table.id);
  assert.equal(c2.chart.source.tableId, t2.id);
  assert.equal(chart.chart.source.tableId, table.id);
  void remapLinks;
  buildPageDL(doc, doc.pages[0]);
  const w0 = localBounds(table).w;
  const snap = captureTransform(table);
  applyPageDelta(table, [2, 0, 0, 1, 0, 0], snap);
  doc.touch(table);
  buildPageDL(doc, doc.pages[0]);
  assert.ok(Math.abs(localBounds(table).w - w0 * 2) < 1e-6);
  assert.equal(table.m[0], 1, "scale is baked into the column widths");
});
