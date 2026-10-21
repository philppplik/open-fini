// Table and chart commands (Layout studio): insert, edit rows / columns / cells, import / export CSV, flow across
// pages, chart data. The heavy UI (dialogs, panel) is loaded on first use.
import { downloadName } from "../core/util.js";
import { pick } from "../engine/hit.js";
import { toLocal } from "../core/transform.js";
import { isTable, isChart } from "../core/data-nodes.js";
import * as A from "../core/table-actions.js";
import { cellAt } from "../engine/layout/table-render.js";
import { originOf, looksTabular, parseTextMatrix, tableToCSV, expandRect } from "../engine/layout/table-model.js";
import { platform } from "../platform/index.js";

const hasDoc = (a) => !!a.doc;
const hasTable = (a) => !!a.doc && !!A.activeTable(a);
const hasChart = (a) => !!a.doc && a.selection.length === 1 && isChart(a.selection[0]);

const dialogs = () => import("../ui/data/dialogs.js");

/** Pasted text that looks like a spreadsheet becomes a table. Returns true when it did. */
export function pasteTextAsTable(app, text) {
  if (!looksTabular(text)) return false;
  const matrix = parseTextMatrix(text, { delimiter: text.includes("\t") ? "\t" : "auto" });
  if (matrix.length < 2 || matrix[0].length < 2) return false;
  A.tableFromMatrix(app, matrix, { header: true });
  app.toast(`Pasted ${matrix.length} × ${matrix[0].length} cells as a table.`, "success");
  app.emit("revealpanel", "data");
  return true;
}

export function registerDataCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });

  def("layout.insertTable", "Insert Table…", async (a) => (await dialogs()).insertDialog(a, "table"), { enabled: hasDoc });
  def("layout.insertChart", "Insert Chart…", async (a) => (await dialogs()).insertDialog(a, "chart"), { enabled: hasDoc });
  def("layout.importTable", "Import CSV / TSV as Table…", async (a) => (await dialogs()).importTableDialog(a), { enabled: hasDoc });

  def("table.rowAbove", "Insert Row Above", (a) => A.insertRow(a, false), { enabled: hasTable });
  def("table.rowBelow", "Insert Row Below", (a) => A.insertRow(a, true), { enabled: hasTable });
  def("table.colLeft", "Insert Column Left", (a) => A.insertColumn(a, false), { enabled: hasTable });
  def("table.colRight", "Insert Column Right", (a) => A.insertColumn(a, true), { enabled: hasTable });
  def("table.deleteRows", "Delete Row(s)", (a) => A.deleteRows(a), { enabled: hasTable });
  def("table.deleteCols", "Delete Column(s)", (a) => A.deleteColumns(a), { enabled: hasTable });
  def("table.moveRowUp", "Move Row Up", (a) => A.moveRows(a, -1), { enabled: hasTable });
  def("table.moveRowDown", "Move Row Down", (a) => A.moveRows(a, 1), { enabled: hasTable });
  def("table.moveColLeft", "Move Column Left", (a) => A.moveColumns(a, -1), { enabled: hasTable });
  def("table.moveColRight", "Move Column Right", (a) => A.moveColumns(a, 1), { enabled: hasTable });
  def("table.dupRow", "Duplicate Row", (a) => A.duplicateRow(a), { enabled: hasTable });
  def("table.dupCol", "Duplicate Column", (a) => A.duplicateColumn(a), { enabled: hasTable });
  def("table.merge", "Merge Cells", (a) => A.mergeSelection(a), { enabled: hasTable });
  def("table.split", "Split Merged Cells", (a) => A.splitSelection(a), { enabled: hasTable });
  def("table.distributeCols", "Distribute Columns Evenly", (a) => A.distributeColumns(a), { enabled: hasTable });
  def("table.distributeRows", "Distribute Rows Evenly", (a) => A.distributeRows(a), { enabled: hasTable });
  def("table.fit", "Fit Columns to Content", (a) => A.autoFitColumns(a), { enabled: hasTable });
  def("table.sortAsc", "Sort Ascending by Column", (a) => A.sortSelection(a, "asc"), { enabled: hasTable });
  def("table.sortDesc", "Sort Descending by Column", (a) => A.sortSelection(a, "desc"), { enabled: hasTable });
  def("table.clear", "Clear Cell Contents", (a) => A.clearSelection(a), { enabled: hasTable });
  def("table.flow", "Flow Table Across Pages", (a) => A.flowAcrossPages(a), { enabled: hasTable });
  def("table.exportCSV", "Export Table as CSV…", async (a) => {
    const node = A.activeTable(a);
    if (!node) return;
    const text = tableToCSV(node, { mode: "values" });
    const bytes = new TextEncoder().encode(`﻿${text}\n`);
    const r = await platform.saveFile({ suggestedName: downloadName(node.name || "table", "csv"), bytes, mime: "text/csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (r) a.toast(`Exported the table to ${r.name}.`, "success");
  }, { enabled: hasTable });

  def("chart.editData", "Edit Chart Data…", async (a) => (await dialogs()).chartDataDialog(a, a.selection[0]), { enabled: hasChart });
  def("chart.gallery", "Chart Gallery…", async (a) => (await dialogs()).insertDialog(a, "chart"), { enabled: hasDoc });

  // right-click menu: table and chart items first
  app.contextItemProviders = app.contextItemProviders || [];
  app.contextItemProviders.push((a, ev) => {
    if (!a.doc || !ev || a.studio !== "layout") return null;
    const hit = pick(a.context, ev.x, ev.y, 6 / a.view.zoom, { deep: true });
    if (hit && isTable(hit)) {
      a.select([hit]);
      if (hit._tl) {
        const [lx, ly] = toLocal(hit, ev.x, ev.y);
        const cell = cellAt(hit._tl, lx, ly, 1e9);
        const o = originOf(hit, cell.r, cell.c);
        const s = a.tableSel;
        const inside = s && s.node === hit && !s.all && (() => {
          const r = expandRect(hit, { r0: Math.min(s.ar, s.fr), c0: Math.min(s.ac, s.fc), r1: Math.max(s.ar, s.fr), c1: Math.max(s.ac, s.fc) });
          return o.r >= r.r0 && o.r <= r.r1 && o.c >= r.c0 && o.c <= r.c1;
        })();
        if (!inside) A.setTableSel(a, hit, o.r, o.c);
      }
      return ["table.rowAbove", "table.rowBelow", "table.colLeft", "table.colRight", "table.dupRow", "table.dupCol", "table.deleteRows", "table.deleteCols", "-", "table.merge", "table.split", "table.clear", "-", "table.sortAsc", "table.sortDesc", "table.exportCSV"];
    }
    if (hit && isChart(hit)) {
      a.select([hit]);
      return ["chart.editData", "chart.gallery"];
    }
    return null;
  });
}
