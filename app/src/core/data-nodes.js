// Table and chart nodes: creation and undoable edits shared by the UI (panel, tools, dialogs) and the Vibe tools.
// All model logic lives in the pure modules under engine/layout/ (table-model.js, chart-data.js).
import { clone } from "./util.js";
import { createNode } from "./nodes.js";
import { translate } from "./math.js";
import { addNodes } from "./ops.js";
import { createTable, normalizeMerges } from "../engine/layout/table-model.js";
import { resolveStyle } from "../engine/layout/table-styles.js";
import { CHART_PRESETS, chartFromPreset, normalizeChart, resolveData, matrixToData } from "../engine/layout/chart-data.js";

export const TABLE_KEYS = ["cols", "rows", "cells", "headerRows", "headerCols", "tstyle", "colFmt", "autoHeight", "styleId"];

export const isTable = (n) => n?.type === "table";
export const isChart = (n) => n?.type === "chart";

/** Extracts the table model (deep copy) from a table node. */
export function tableModel(node) {
  const m = {};
  for (const k of TABLE_KEYS) m[k] = clone(node[k]);
  return m;
}

/**
 * Edits a table through a mutator that receives a deep copy of the model. The mutator may return `false` or an
 * error string to abort. The change is one undo step (`coalesce` merges rapid edits such as sliders).
 * @returns {true|false|string} true when something was applied
 */
export function editTable(doc, node, fn, label = "Edit Table", { coalesce } = {}) {
  const model = tableModel(node);
  const res = fn(model);
  if (res === false || typeof res === "string") return res;
  normalizeMerges(model);
  doc.tx(label, () => doc.set(node, model, label), coalesce ? { coalesce } : undefined);
  return true;
}

/** Edits the chart definition of a chart node (mutator gets a deep copy; the result is normalized). */
export function editChart(doc, node, fn, label = "Edit Chart", { coalesce } = {}) {
  const chart = normalizeChart(clone(node.chart));
  const res = fn(chart);
  if (res === false || typeof res === "string") return res;
  const next = normalizeChart(chart);
  doc.tx(label, () => doc.set(node, { chart: next }, label), coalesce ? { coalesce } : undefined);
  return true;
}

/** Page rectangle where a new object is centered by default. */
function centered(app, w, h) {
  const p = app.page;
  return { x: Math.max(0, (p.w - w) / 2), y: Math.max(0, (p.h - h) / 2) };
}

/**
 * Creates and inserts a table.
 * @param {*} app
 * @param {{rows?:number, cols?:number, headerRows?:number, headerCols?:number, style?:string|object, data?:any[][], width?:number, rowHeight?:number,
 *   colWidths?:number[], x?:number, y?:number, name?:string, alt?:string, parent?:object, select?:boolean}} [o]
 */
export function addTableNode(app, o = {}) {
  const doc = app.doc;
  const model = createTable({ ...o, savedStyles: doc.tableStyles });
  if (typeof o.style === "string" && doc.tableStyles?.[o.style]) model.tstyle = resolveStyle(o.style, doc.tableStyles);
  const width = model.cols.reduce((a, b) => a + b, 0);
  const height = model.rows.reduce((a, b) => a + b, 0);
  const pos = centered(app, width, height);
  const node = createNode("table", { ...model, name: o.name || "Table", alt: o.alt || "", m: translate(o.x ?? pos.x, o.y ?? pos.y) });
  addNodes(app, node, { label: "Insert Table", parent: o.parent || app.context, select: o.select !== false });
  return node;
}

/**
 * Creates and inserts a chart from a gallery preset id or chart type, optionally with your own data / options.
 * @param {*} app
 * @param {{preset?:string, type?:string, title?:string, subtitle?:string, data?:object, source?:object, options?:object,
 *   x?:number, y?:number, w?:number, h?:number, name?:string, alt?:string, parent?:object, select?:boolean}} [o]
 */
export function addChartNode(app, o = {}) {
  const over = {};
  for (const k of ["title", "subtitle", "data", "source", "options"]) if (o[k] !== undefined) over[k] = o[k];
  let chart;
  if (o.preset) {
    chart = chartFromPreset(o.preset, over);
    if (o.type) chart.type = normalizeChart({ type: o.type }).type;
  } else {
    // a plain type: sample data of the first preset of that type, but none of the preset's styling
    const sample = CHART_PRESETS.find((p) => p.type === o.type) || CHART_PRESETS[0];
    chart = normalizeChart({ type: o.type || "column", title: o.title || "", subtitle: o.subtitle, data: o.data || sample.data, source: o.source, options: o.options || {} });
  }
  const single = chart.type === "kpi" || chart.type === "progress" || chart.type === "ring" || chart.type === "sparkline";
  const w = o.w ?? (single ? 260 : Math.min(520, app.page.w - 40));
  const h = o.h ?? (single ? (chart.type === "ring" ? 220 : chart.type === "sparkline" ? 80 : chart.type === "progress" ? 90 : 150) : Math.round(w * 0.62));
  const pos = centered(app, w, h);
  const node = createNode("chart", { w, h, chart, name: o.name || chartName(chart), alt: o.alt || "", m: translate(o.x ?? pos.x, o.y ?? pos.y) });
  addNodes(app, node, { label: "Insert Chart", parent: o.parent || app.context, select: o.select !== false });
  return node;
}

export const chartName = (chart) => chart.title || { kpi: "Big number", progress: "Progress bar", ring: "Progress ring", sparkline: "Sparkline" }[chart.type] || "Chart";

/** `{id, name, rows, cols}` of every table in the document (for the "link chart to table" menu). */
export function listTables(doc) {
  const out = [];
  doc.walkAll((n) => {
    if (isTable(n)) out.push({ id: n.id, name: n.name, rows: n.rows.length, cols: n.cols.length, page: doc.pages.indexOf(n._page) + 1 });
  });
  return out;
}

/** Links a chart definition to a table (caches the resolved data so the chart still renders if the table is deleted). */
export function linkChart(chart, tableNode, o = {}) {
  chart.source = { tableId: tableNode.id, seriesIn: o.seriesIn || "columns", header: o.header !== false, labelCol: o.labelCol !== false, ...(o.range ? { range: o.range } : {}) };
  chart.data = resolveData(chart, () => tableNode).data;
  return chart;
}

/** Replaces chart data from a matrix (header row = series names, first column = categories). */
export function setChartMatrix(chart, matrix, o = {}) {
  chart.source = null;
  chart.data = matrixToData(matrix, o);
  return chart;
}

// remapLinks moved to nodes.js (ops.js needs it; importing it from here made a cycle); re-exported for callers.
export { remapLinks } from "./nodes.js";
