// OpenFini tools for tables and charts (Layout studio, usable in any studio): build and edit real, editable table
// and chart objects, read them back, import CSV. Pure model logic lives in engine/layout/table-model.js and chart-data.js.
import { tool, S, cssToHex, nodesById, requireDoc } from "./helpers.js";
import { translate } from "../../core/math.js";
import { addTableNode, addChartNode, editTable, editChart, linkChart, isTable, isChart, listTables } from "../../core/data-nodes.js";
import * as M from "../../engine/layout/table-model.js";
import { parseCellName, parseRange, colIndex, cellName, rangeName } from "../../engine/layout/format.js";
import { PRESET_IDS, resolveStyle, presetStyle } from "../../engine/layout/table-styles.js";
import { CHART_TYPE_IDS, CHART_PRESETS, PALETTE_IDS, normalizeChart, resolveData, describeChart } from "../../engine/layout/chart-data.js";
import { pageBounds } from "../../core/transform.js";

const FMT = S.str("Number format object, e.g. {\"type\":\"currency\",\"decimals\":2,\"currency\":\"EUR\"}. type: auto | number | currency | percent | compact | date | text; also decimals, currency (ISO code), prefix, suffix, thousands (bool), negative (minus | parens), dateStyle (short | medium | long | iso).");
const fmtSchema = {
  type: "object",
  description: FMT.description,
  properties: {
    type: { type: "string", enum: ["auto", "number", "currency", "percent", "compact", "date", "text"] },
    decimals: { type: "number" }, currency: { type: "string" }, prefix: { type: "string" }, suffix: { type: "string" }, thousands: { type: "boolean" },
    negative: { type: "string", enum: ["minus", "parens"] }, dateStyle: { type: "string", enum: ["short", "medium", "long", "iso"] },
  },
};
const matrixSchema = { type: "array", description: "Rows of cells; each cell is a string or number. A string starting with = is a formula, e.g. \"=SUM(B2:B5)\".", items: { type: "array", items: {} } };

const rangeOf = (m, spec) => {
  if (!spec) return { r0: 0, c0: 0, r1: m.rows.length - 1, c1: m.cols.length - 1 };
  const s = String(spec).trim();
  const colOnly = /^([A-Za-z]{1,3})(?::([A-Za-z]{1,3}))?$/.exec(s);
  if (colOnly) {
    const c0 = colIndex(colOnly[1]);
    const c1 = colOnly[2] ? colIndex(colOnly[2]) : c0;
    return { r0: 0, c0: Math.min(c0, c1), r1: m.rows.length - 1, c1: Math.max(c0, c1) };
  }
  const r = parseRange(s);
  if (!r) throw new Error(`“${spec}” is not a cell range. Use A1 notation such as B2, A1:C4 or a column letter such as B.`);
  if (r.r1 >= m.rows.length || r.c1 >= m.cols.length) throw new Error(`Range ${spec} is outside the table (${m.rows.length} rows × ${m.cols.length} columns, last cell ${cellName(m.rows.length - 1, m.cols.length - 1)}).`);
  return r;
};
const toFmt = (f) => (f && f.type && f.type !== "auto" ? f : f && (f.prefix || f.suffix) ? { type: "auto", ...f } : null);

/** Applies one table operation to a model (throws on invalid input). */
function applyOpX(m, op) {
  const fail = (msg) => {
    throw new Error(msg);
  };
  const need = (res, msg) => res || fail(msg);
  switch (op.op) {
    case "set_cells": {
      for (const [ref, v] of Object.entries(op.cells || {})) {
        const p = parseCellName(ref) || fail(`Bad cell reference “${ref}”.`);
        if (p.r >= m.rows.length || p.c >= m.cols.length) fail(`Cell ${ref} is outside the table. Add rows or columns first.`);
        M.setCellValue(m, p.r, p.c, v);
      }
      return;
    }
    case "set_range": {
      const p = parseCellName(op.start || "A1") || fail(`Bad start cell “${op.start}”.`);
      need(M.pasteMatrix(m, p.r, p.c, (op.data || []).map((r) => r.map((v) => (v == null ? "" : String(v))))), "No data given.");
      return;
    }
    case "insert_rows":
      return need(M.insertLines(m, "row", op.at ?? m.rows.length, op.count || 1, { like: op.at != null ? Math.max(0, op.at - 1) : m.rows.length - 1 }), "Cannot insert rows (limit reached).");
    case "insert_columns":
      return need(M.insertLines(m, "col", op.at ?? m.cols.length, op.count || 1, { like: op.at != null ? Math.max(0, op.at - 1) : m.cols.length - 1 }), "Cannot insert columns (limit reached).");
    case "delete_rows":
      return need(M.deleteLines(m, "row", op.at, op.count || 1), "Cannot delete these rows (a table needs one row).");
    case "delete_columns":
      return need(M.deleteLines(m, "col", op.at, op.count || 1), "Cannot delete these columns (a table needs one column).");
    case "move_row":
      return need(M.moveLine(m, "row", op.from, op.to), "That row cannot move (merged cells).");
    case "move_column":
      return need(M.moveLine(m, "col", op.from, op.to), "That column cannot move (merged cells).");
    case "duplicate_row":
      return need(M.duplicateLine(m, "row", op.at), "Cannot duplicate that row.");
    case "merge":
      return need(M.mergeCells(m, rangeOf(m, op.range)), "Merge needs a range of at least two cells.");
    case "split":
      return M.splitCells(m, rangeOf(m, op.range));
    case "sort": {
      const c = colIndex(String(op.column ?? "A"));
      const col = c >= 0 ? c : Number(op.column);
      const res = M.sortRows(m, col, op.direction === "desc" ? "desc" : "asc");
      return res === true || fail(res);
    }
    case "format": {
      const r = rangeOf(m, op.range);
      const patch = {};
      for (const k of ["bold", "italic", "underline", "strike", "align", "valign", "size", "family", "lineHeight"]) if (op[k] !== undefined) patch[k] = op[k];
      if (op.color !== undefined) patch.color = op.color && cssToHex(op.color);
      if (op.fill !== undefined) patch.fill = op.fill === "none" || op.fill === null ? null : cssToHex(op.fill);
      if (op.padding !== undefined) patch.pad = op.padding;
      if (Object.keys(patch).length) M.formatCells(m, r, patch);
      if (op.numberFormat) {
        const f = toFmt(op.numberFormat);
        if (op.cellsOnly) M.formatCells(m, r, { fmt: f });
        else for (let c = r.c0; c <= r.c1; c++) m.colFmt[c] = f;
      }
      if (op.borders) M.setBorders(m, r, op.borders.where || "all", op.borders.width === 0 || op.borders.where === "none" ? null : { w: op.borders.width ?? 1, c: cssToHex(op.borders.color || "#111827") });
      return;
    }
    case "clear":
      return M.clearCells(m, rangeOf(m, op.range), { formatting: !!op.formatting });
    case "column_widths": {
      (op.widths || []).forEach((w, i) => {
        if (i < m.cols.length && w > 4) m.cols[i] = w;
      });
      return;
    }
    case "row_heights": {
      (op.heights || []).forEach((v, i) => {
        if (i < m.rows.length && v > 4) m.rows[i] = v;
      });
      return;
    }
    case "distribute_columns":
      return M.distribute(m, "col", 0, m.cols.length - 1);
    case "header":
      if (op.rows != null) m.headerRows = Math.max(0, Math.min(m.rows.length, op.rows));
      if (op.columns != null) m.headerCols = Math.max(0, Math.min(m.cols.length, op.columns));
      return;
    case "style": {
      if (op.preset) m.tstyle = presetStyle(op.preset);
      const patch = {};
      for (const k of ["zebra", "hLines", "vLines", "outer", "size", "padX", "padY", "family", "borderWidth"]) if (op[k] !== undefined) patch[k] = op[k];
      for (const [k, key] of [["headerFill", "headFill"], ["headerColor", "headColor"], ["textColor", "color"], ["lineColor", "borderColor"], ["zebraFill", "altFill"], ["bodyFill", "fill"]]) if (op[k] !== undefined) patch[key] = op[k] === "none" ? null : cssToHex(op[k]);
      m.tstyle = { ...m.tstyle, ...patch };
      m.styleId = op.preset || undefined;
      return;
    }
    default:
      return fail(`Unknown table operation “${op.op}”.`);
  }
}

const OPS_DOC = "Operations (applied in order, all or nothing as one undo step): " +
  "set_cells {cells:{\"B2\":\"12\",\"C2\":\"=B2*2\"}} · set_range {start:\"A1\", data:[[...]]} (grows the table) · insert_rows/insert_columns {at, count} (at = index before which to insert, 0-based; omit to append) · " +
  "delete_rows/delete_columns {at, count} · move_row/move_column {from,to} · duplicate_row {at} · merge {range:\"A1:C1\"} · split {range} · sort {column:\"B\", direction:\"asc|desc\"} (body rows, below the header) · " +
  "format {range:\"A1:C1\" (omit = all cells; column letters like \"B\" allowed), bold, italic, underline, align:left|center|right, valign:top|middle|bottom, color, fill, size, padding, numberFormat:{type,decimals,...} (applies to the columns of the range; cellsOnly:true for cells only), borders:{where:all|outer|inner|top|bottom|left|right|none, width, color}} · " +
  "clear {range, formatting} · column_widths {widths:[...]} · row_heights {heights:[...]} · distribute_columns · header {rows, columns} · " +
  "style {preset, zebra, hLines, vLines, outer, headerFill, headerColor, textColor, lineColor, zebraFill, bodyFill, size, padX, padY, family, borderWidth}. " +
  "Formulas: =SUM(B2:B5), AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT, MEDIAN, ROUND, ABS, SQRT, IF, AND, OR, NOT, operators + - * / ^ & % and comparisons; cell refs like B2 or $B$2, ranges B2:B5.";

const opsSchema = {
  type: "array",
  description: OPS_DOC,
  items: { type: "object", properties: { op: { type: "string", enum: ["set_cells", "set_range", "insert_rows", "insert_columns", "delete_rows", "delete_columns", "move_row", "move_column", "duplicate_row", "merge", "split", "sort", "format", "clear", "column_widths", "row_heights", "distribute_columns", "header", "style"] }, numberFormat: fmtSchema }, required: ["op"] },
};

function tableSummary(app, n) {
  const b = pageBounds(n);
  return { id: n.id, name: n.name, rows: n.rows.length, cols: n.cols.length, headerRows: n.headerRows, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), lastCell: cellName(n.rows.length - 1, n.cols.length - 1) };
}

function getTable(app, id) {
  const [n] = nodesById(app, [id]);
  if (!isTable(n)) throw new Error(`Layer “${id}” is a ${n.type}, not a table. Use list_tables or list_layers to find tables.`);
  return n;
}
function getChart(app, id) {
  const [n] = nodesById(app, [id]);
  if (!isChart(n)) throw new Error(`Layer “${id}” is a ${n.type}, not a chart.`);
  return n;
}

function placeNode(app, n, a) {
  const doc = app.doc;
  if (a.x != null || a.y != null) {
    const b = pageBounds(n);
    doc.set(n, { m: translate(n.m[4] + ((a.x ?? b.x) - b.x), n.m[5] + ((a.y ?? b.y) - b.y)) });
  }
}

function chartOptions(a) {
  const o = { ...(a.options || {}) };
  if (a.palette) o.palette = a.palette;
  if (a.legend) o.legend = a.legend;
  if (a.dataLabels !== undefined) o.dataLabels = a.dataLabels;
  if (a.xTitle !== undefined) o.xTitle = a.xTitle;
  if (a.yTitle !== undefined) o.yTitle = a.yTitle;
  if (a.numberFormat) o.numFmt = toFmt(a.numberFormat);
  if (a.theme) o.theme = a.theme;
  return o;
}

const seriesSchema = {
  type: "array",
  description: "Series: [{name, values:[numbers], color?}]. All series share the categories.",
  items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: ["number", "null"] } }, color: { type: "string" } }, required: ["values"] },
};
const optionProps = {
  palette: S.str("Palette name", { enum: PALETTE_IDS }),
  legend: S.str("Legend position", { enum: ["auto", "bottom", "top", "right", "left", "none"] }),
  dataLabels: S.bool("Show values on the marks"),
  xTitle: S.str("Horizontal axis title"), yTitle: S.str("Vertical axis title"),
  numberFormat: fmtSchema,
  theme: S.str("light (default) or dark text/grid colors", { enum: ["light", "dark"] }),
  options: { type: "object", description: "More chart options: gridlines, smooth, markers, radius (bar corner radius px), gap (0-0.9), overlap (-0.5..1), min, max, log, sort (none|asc|desc), innerRadius (donut hole 0.2-0.9), startAngle, varyColors, fontScale, background (hex), textColor, centerLabel, target (progress/ring maximum), numFmt." },
};

export function layoutDataTools(app) {
  const T = [];

  T.push(
    tool("add_table", "Adds a real, editable table object (not shapes) to the page: header row(s), per-column number formats, formulas, merged cells and style presets. Use it for price lists, schedules, comparison grids and report data. It exports as vector (PDF/SVG/PNG). Cell text wraps and rows grow to fit. Returns the table id and the last cell name; then use edit_table to refine, or add_chart with tableId to chart it.", {
      data: { ...matrixSchema, description: "All cell contents including the header row(s): [[\"Region\",\"Q1\"],[\"North\",120]]. Numbers or strings; a leading = starts a formula such as =SUM(B2:B4). Omit to create an empty rows x cols table with placeholder headers." },
      rows: S.num("Rows (default: data length or 4)", { minimum: 1, maximum: 500 }), cols: S.num("Columns (default: widest data row or 3)", { minimum: 1, maximum: 60 }),
      headerRows: S.num("Header rows (default 1)", { minimum: 0, maximum: 5 }), headerCols: S.num("Header columns, e.g. 1 when the first column holds labels", { minimum: 0, maximum: 5 }),
      style: S.str(`Style preset (default clean). One of: ${PRESET_IDS.join(", ")}`, { enum: PRESET_IDS }),
      x: S.num("Left in page px"), y: S.num("Top in page px"), w: S.num("Total width in px (default min(560, 140 per column))"), rowHeight: S.num("Minimum row height in px (default 34)"),
      columnWidths: { type: "array", items: { type: "number" }, description: "Column widths in px (overrides w)" },
      numberFormats: { type: "object", description: "Number format per column letter, e.g. {\"B\":{\"type\":\"currency\",\"decimals\":0},\"C\":{\"type\":\"percent\",\"decimals\":1}}", additionalProperties: fmtSchema },
      operations: opsSchema,
      name: S.str("Layer name"), alt: S.str("Alt text / description for accessibility (exported to SVG)"),
    }, [], (a) => {
      requireDoc(app);
      const n = addTableNode(app, { data: a.data, rows: a.rows, cols: a.cols, headerRows: a.headerRows, headerCols: a.headerCols, style: a.style, x: a.x, y: a.y, width: a.w, rowHeight: a.rowHeight, colWidths: a.columnWidths, name: a.name, alt: a.alt });
      const extra = [];
      for (const [col, f] of Object.entries(a.numberFormats || {})) extra.push({ op: "format", range: col, numberFormat: f });
      extra.push(...(a.operations || []));
      if (extra.length) {
        const res = editTable(app.doc, n, (m) => {
          for (const op of extra) applyOpX(m, op);
        }, "Edit Table");
        if (typeof res === "string") throw new Error(res);
      }
      return { ok: true, ...tableSummary(app, n), hint: "Use edit_table to change cells, read_table to check values, add_chart with tableId to chart it." };
    }),

    tool("edit_table", "Edits an existing table with an ordered list of operations (set cells, add/remove/move rows and columns, merge/split, formatting, number formats, borders, sort, formulas, style). All operations apply as one undo step; if one fails nothing changes. Cell references use spreadsheet A1 notation: A=first column, 1=first row.", {
      id: S.str("Table layer id (from add_table or list_tables)"),
      operations: opsSchema,
      name: S.str("New layer name"), alt: S.str("Alt text"),
      x: S.num("Move: left in page px"), y: S.num("Move: top in page px"),
    }, ["id"], (a) => {
      const n = getTable(app, a.id);
      if (a.operations?.length) {
        const res = editTable(app.doc, n, (m) => {
          for (const op of a.operations) applyOpX(m, op);
        }, "Edit Table");
        if (typeof res === "string") throw new Error(res);
      }
      if (a.name) app.doc.set(n, { name: a.name });
      if (a.alt !== undefined) app.doc.set(n, { alt: a.alt });
      placeNode(app, n, a);
      app.requestRender();
      return { ok: true, ...tableSummary(app, n) };
    }),

    tool("read_table", "Reads a table: raw cell contents (formulas as typed), the evaluated values and the displayed text, plus size, header counts, merged cells and column formats. Use it before editing an existing table or to verify formula results.", {
      id: S.str("Table layer id"),
    }, ["id"], (a) => {
      const n = getTable(app, a.id);
      const values = M.tableValues(n);
      const display = M.tableDisplay(n);
      const merges = [];
      n.cells.forEach((row, r) => row.forEach((c, ci) => {
        if (c.rs > 1 || c.cs > 1) merges.push(rangeName({ r0: r, c0: ci, r1: r + (c.rs || 1) - 1, c1: ci + (c.cs || 1) - 1 }));
      }));
      const cap = 200;
      return {
        ...tableSummary(app, n),
        raw: n.cells.slice(0, cap).map((r) => r.map((c) => c.v)),
        values: values.slice(0, cap),
        display: display.slice(0, cap),
        merges,
        columnFormats: n.colFmt.map((f, i) => (f ? { column: cellName(0, i).replace(/\d+/, ""), ...f } : null)).filter(Boolean),
        style: { preset: n.styleId || "custom", zebra: !!resolveStyle(n.tstyle).zebra },
        truncated: n.rows.length > cap,
      };
    }, { readOnly: true }),

    tool("list_tables", "Lists the tables of the open document with ids, sizes and pages, so charts can be linked to them (add_chart tableId) or tables edited.", {}, [], () => ({ tables: listTables(requireDoc(app)) }), { readOnly: true }),

    tool("import_csv_to_table", "Creates a table from CSV / TSV text (delimiter detected automatically, quoted fields supported), or replaces the data of an existing table. Use it when the user pastes or provides data as text.", {
      csv: S.str("The CSV or TSV text"),
      tableId: S.str("Replace the data of this existing table instead of creating a new one"),
      header: S.bool("First row is a header (default true)"),
      delimiter: S.str("Delimiter, default auto-detect", { enum: ["auto", ",", ";", "\t", "|"] }),
      style: S.str("Style preset for a new table", { enum: PRESET_IDS }),
      x: S.num("Left in page px"), y: S.num("Top in page px"), w: S.num("Width in px"), name: S.str("Layer name"),
    }, ["csv"], (a) => {
      requireDoc(app);
      const matrix = M.parseTextMatrix(a.csv, { delimiter: a.delimiter });
      if (!matrix.length) throw new Error("The text contains no rows.");
      if (matrix.length > 500 || matrix[0].length > 60) throw new Error("The data is larger than a table can hold (500 rows × 60 columns).");
      const header = a.header !== false;
      if (a.tableId) {
        const n = getTable(app, a.tableId);
        const fresh = M.createTable({ data: matrix, headerRows: header ? 1 : 0, width: n.cols.reduce((s, v) => s + v, 0), rowHeight: n.rows[0] });
        editTable(app.doc, n, (m) => Object.assign(m, { cols: fresh.cols, rows: fresh.rows, cells: fresh.cells, headerRows: fresh.headerRows, headerCols: Math.min(m.headerCols, fresh.cols.length), colFmt: fresh.colFmt }), "Import CSV");
        return { ok: true, replaced: true, ...tableSummary(app, n) };
      }
      const n = addTableNode(app, { data: matrix, headerRows: header ? 1 : 0, style: a.style, x: a.x, y: a.y, width: a.w || Math.min(app.page.w - 80, Math.max(240, matrix[0].length * 130)), name: a.name });
      return { ok: true, ...tableSummary(app, n) };
    }),

    tool("add_chart", `Adds a real, editable chart object (vector, re-editable after saving) to the page. Types: ${CHART_TYPE_IDS.join(", ")}. Give data inline (categories + series) or link it to a table with tableId (the chart then updates live when the table changes; first table column = categories, header row = series names, or set seriesIn:"rows"). Without data a sample is used. kpi/progress/ring/sparkline are single-value infographics: use ONE series; the last value is the number (progress/ring: value out of options.target, default 100). Scatter: categories are the numeric X values. A good report page pairs a table (add_table) with a chart linked to it (tableId).`, {
      type: S.str("Chart type", { enum: CHART_TYPE_IDS }),
      preset: S.str(`Gallery preset (sample data and styling): ${CHART_PRESETS.map((p) => p.id).join(", ")}`, { enum: CHART_PRESETS.map((p) => p.id) }),
      title: S.str("Chart title"), subtitle: S.str("Subtitle"),
      categories: { type: "array", items: { type: "string" }, description: "Category labels (x axis / pie slices)" },
      series: seriesSchema,
      tableId: S.str("Link the chart to this table (see list_tables / add_table)"), range: S.str("Range of the table to chart, e.g. A1:D6 (default: whole table)"), seriesIn: S.str("Series are in table columns (default) or rows", { enum: ["columns", "rows"] }),
      ...optionProps,
      x: S.num("Left in page px"), y: S.num("Top in page px"), w: S.num("Width px (default 520)"), h: S.num("Height px (default 0.62 × width)"),
      name: S.str("Layer name"), alt: S.str("Alt text; default is generated automatically from the data"),
    }, [], (a) => {
      requireDoc(app);
      const data = a.series || a.categories ? { categories: a.categories || (a.series?.[0]?.values || []).map((_, i) => String(i + 1)), series: (a.series || []).map((s, i) => ({ name: s.name || `Series ${i + 1}`, values: s.values, ...(s.color ? { color: cssToHex(s.color) } : {}) })) } : undefined;
      const node = addChartNode(app, { preset: a.preset, type: a.type, title: a.title, subtitle: a.subtitle, data, options: chartOptions(a), x: a.x, y: a.y, w: a.w, h: a.h, name: a.name, alt: a.alt });
      if (a.tableId) {
        const t = getTable(app, a.tableId);
        const res = editChart(app.doc, node, (c) => linkChart(c, t, { range: a.range, seriesIn: a.seriesIn }), "Link Chart");
        if (typeof res === "string") throw new Error(res);
      }
      const chart = normalizeChart(node.chart);
      const b = pageBounds(node);
      return { ok: true, id: node.id, type: chart.type, series: chart.data.series.length, categories: chart.data.categories.length, linkedTo: chart.source?.tableId || null, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
    }),

    tool("edit_chart", "Edits an existing chart: type, title, data (inline or linked to a table), colors, legend, axes, labels, size and position. Only the fields you pass change. Use read_chart first to see the current definition.", {
      id: S.str("Chart layer id"),
      type: S.str("New chart type", { enum: CHART_TYPE_IDS }),
      title: S.str("Title"), subtitle: S.str("Subtitle"),
      categories: { type: "array", items: { type: "string" } }, series: seriesSchema,
      tableId: S.str("Link to this table (replaces inline data)"), unlink: S.bool("Stop following the linked table and keep the current values as own data"),
      range: S.str("Table range"), seriesIn: S.str("columns or rows", { enum: ["columns", "rows"] }),
      ...optionProps,
      x: S.num("Left in page px"), y: S.num("Top in page px"), w: S.num("Width px"), h: S.num("Height px"), name: S.str("Layer name"), alt: S.str("Alt text"),
    }, ["id"], (a) => {
      const node = getChart(app, a.id);
      const res = editChart(app.doc, node, (c) => {
        if (a.type) c.type = a.type;
        if (a.title !== undefined) c.title = a.title;
        if (a.subtitle !== undefined) c.subtitle = a.subtitle;
        if (a.series || a.categories) {
          c.source = null;
          c.data = {
            categories: a.categories || c.data.categories,
            series: (a.series || c.data.series).map((s, i) => ({ name: s.name || `Series ${i + 1}`, values: s.values, ...(s.color ? { color: cssToHex(s.color) } : {}) })),
          };
        }
        if (a.tableId) {
          const t = getTable(app, a.tableId);
          linkChart(c, t, { range: a.range ?? c.source?.range, seriesIn: a.seriesIn ?? c.source?.seriesIn });
        } else if (c.source && (a.range || a.seriesIn)) {
          if (a.range) c.source.range = a.range;
          if (a.seriesIn) c.source.seriesIn = a.seriesIn;
          const t = app.doc.find(c.source.tableId);
          if (t) c.data = resolveData(c, () => t).data;
        }
        if (a.unlink) c.source = null;
        Object.assign(c.options, chartOptions(a));
      }, "Edit Chart");
      if (typeof res === "string") throw new Error(res);
      const patch = {};
      if (a.w) patch.w = a.w;
      if (a.h) patch.h = a.h;
      if (a.name) patch.name = a.name;
      if (a.alt !== undefined) patch.alt = a.alt;
      if (Object.keys(patch).length) app.doc.set(node, patch);
      placeNode(app, node, a);
      app.requestRender();
      const chart = normalizeChart(node.chart);
      return { ok: true, id: node.id, type: chart.type, series: chart.data.series.length, categories: chart.data.categories.length, linkedTo: chart.source?.tableId || null };
    }),

    tool("read_chart", "Reads a chart definition: type, title, the resolved data (categories and series), options, whether it is linked to a table, and the accessible description. Use before edit_chart.", { id: S.str("Chart layer id") }, ["id"], (a) => {
      const node = getChart(app, a.id);
      const chart = normalizeChart(node.chart);
      const { data, linked, missing } = resolveData(chart, (id) => (app.doc.find(id)?.type === "table" ? app.doc.find(id) : null));
      const b = pageBounds(node);
      return { id: node.id, name: node.name, type: chart.type, title: chart.title, subtitle: chart.subtitle, data, linked: linked ? { tableId: chart.source.tableId, range: chart.source.range || null, seriesIn: chart.source.seriesIn, tableMissing: missing } : null, options: chart.options, alt: node.alt || null, description: describeChart(chart, data), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
    }, { readOnly: true }),
  );
  return T;
}

