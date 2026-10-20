// Table actions on the current cell selection: used by the Data panel, the Table tool, context menus and commands.
// The cell selection lives on `app.tableSel` ({node, ar, ac, fr, fc, all}); every edit is one undo step.
import { clone } from "./util.js";
import { editTable, addTableNode, isTable } from "./data-nodes.js";
import { measurer } from "./fonts.js";
import * as M from "../engine/layout/table-model.js";
import { resolveStyle, presetStyle } from "../engine/layout/table-styles.js";

/** The table the actions apply to: the one with a cell selection, else the single selected table. */
export function activeTable(app) {
  const s = app.tableSel;
  if (s && s.node && app.doc?.find(s.node.id) === s.node && app.selection.includes(s.node)) return s.node;
  const sel = app.selection;
  return sel.length === 1 && isTable(sel[0]) ? sel[0] : null;
}

/** Sets the cell selection (anchor `ar,ac` → focus `fr,fc`). `all` marks "the whole table, no particular cells". */
export function setTableSel(app, node, ar, ac, fr = ar, fc = ac, all = false) {
  app.tableSel = node ? { node, ar, ac, fr, fc, all } : null;
  app.emit("tablesel");
  app.requestOverlay();
}

/** Normalized selection rectangle `{r0,c0,r1,c1}` grown to whole merged cells; the whole table when `all`. */
export function selRect(app, node = activeTable(app)) {
  if (!node) return null;
  const s = app.tableSel;
  const R = node.rows.length;
  const C = node.cols.length;
  if (!s || s.node !== node || s.all) return { r0: 0, c0: 0, r1: R - 1, c1: C - 1 };
  const cl = (v, hi) => Math.max(0, Math.min(hi, v));
  const r = { r0: cl(Math.min(s.ar, s.fr), R - 1), r1: cl(Math.max(s.ar, s.fr), R - 1), c0: cl(Math.min(s.ac, s.fc), C - 1), c1: cl(Math.max(s.ac, s.fc), C - 1) };
  return M.expandRect(node, r);
}

/** Runs `fn(model, rect, node)` on the active table as one undo step. Returns true when applied. */
export function tableEdit(app, label, fn, opts) {
  const node = activeTable(app);
  if (!node) return false;
  const rect = selRect(app, node);
  const res = editTable(app.doc, node, (m) => fn(m, rect, node), label, opts);
  if (typeof res === "string") app.toast(res, "warning");
  if (res === true) app.requestRender();
  return res === true;
}

const keepSel = (app, node, ar, ac, fr, fc) => {
  const s = app.tableSel;
  if (s && s.node === node && !s.all) setTableSel(app, node, ar, ac, fr, fc);
};

// ---- rows and columns
export function insertRow(app, below = true) {
  const r = selRect(app);
  if (!r) return false;
  const at = below ? r.r1 + 1 : r.r0;
  const ok = tableEdit(app, below ? "Insert Row Below" : "Insert Row Above", (m) => M.insertLines(m, "row", at, 1, { like: below ? r.r1 : r.r0 }) || "The table cannot have more rows.");
  if (ok) keepSel(app, activeTable(app), below ? at : at, app.tableSel?.ac ?? 0, below ? at : at, app.tableSel?.fc ?? 0);
  return ok;
}
export function insertColumn(app, after = true) {
  const r = selRect(app);
  if (!r) return false;
  const at = after ? r.c1 + 1 : r.c0;
  const ok = tableEdit(app, after ? "Insert Column Right" : "Insert Column Left", (m) => M.insertLines(m, "col", at, 1, { like: after ? r.c1 : r.c0 }) || "The table cannot have more columns.");
  if (ok) keepSel(app, activeTable(app), app.tableSel?.ar ?? 0, at, app.tableSel?.fr ?? 0, at);
  return ok;
}
export function deleteRows(app) {
  const r = selRect(app);
  if (!r) return false;
  const ok = tableEdit(app, "Delete Rows", (m) => M.deleteLines(m, "row", r.r0, r.r1 - r.r0 + 1) || "A table needs at least one row.");
  if (ok) keepSel(app, activeTable(app), Math.min(r.r0, activeTable(app).rows.length - 1), r.c0, Math.min(r.r0, activeTable(app).rows.length - 1), r.c1);
  return ok;
}
export function deleteColumns(app) {
  const r = selRect(app);
  if (!r) return false;
  const ok = tableEdit(app, "Delete Columns", (m) => M.deleteLines(m, "col", r.c0, r.c1 - r.c0 + 1) || "A table needs at least one column.");
  if (ok) keepSel(app, activeTable(app), r.r0, Math.min(r.c0, activeTable(app).cols.length - 1), r.r1, Math.min(r.c0, activeTable(app).cols.length - 1));
  return ok;
}
export function moveRows(app, dir) {
  const r = selRect(app);
  if (!r || r.r0 !== r.r1) return app.toast("Select a single row to move it.", "warning"), false;
  const to = r.r0 + dir;
  const ok = tableEdit(app, "Move Row", (m) => M.moveLine(m, "row", r.r0, to) || "This row cannot move (merged cells or table edge).");
  if (ok) keepSel(app, activeTable(app), to, r.c0, to, r.c1);
  return ok;
}
export function moveColumns(app, dir) {
  const r = selRect(app);
  if (!r || r.c0 !== r.c1) return app.toast("Select a single column to move it.", "warning"), false;
  const to = r.c0 + dir;
  const ok = tableEdit(app, "Move Column", (m) => M.moveLine(m, "col", r.c0, to) || "This column cannot move (merged cells or table edge).");
  if (ok) keepSel(app, activeTable(app), r.r0, to, r.r1, to);
  return ok;
}
export const duplicateRow = (app) => {
  const r = selRect(app);
  return !!r && tableEdit(app, "Duplicate Row", (m) => M.duplicateLine(m, "row", r.r1) || "This row cannot be duplicated (merged cells or limit reached).");
};
export const duplicateColumn = (app) => {
  const r = selRect(app);
  return !!r && tableEdit(app, "Duplicate Column", (m) => M.duplicateLine(m, "col", r.c1) || "This column cannot be duplicated (merged cells or limit reached).");
};
export const distributeColumns = (app) => {
  const r = selRect(app);
  const single = r && r.c0 === r.c1;
  return !!r && tableEdit(app, "Distribute Columns", (m) => M.distribute(m, "col", single ? 0 : r.c0, single ? m.cols.length - 1 : r.c1) || "Select two or more columns.");
};
export const distributeRows = (app) => {
  const r = selRect(app);
  const single = r && r.r0 === r.r1;
  return !!r && tableEdit(app, "Distribute Rows", (m) => M.distribute(m, "row", single ? 0 : r.r0, single ? m.rows.length - 1 : r.r1) || "Select two or more rows.");
};

/** Sizes the selected columns (all when one or none) to their widest text. */
export function autoFitColumns(app) {
  const node = activeTable(app);
  if (!node) return false;
  return tableEdit(app, "Fit Columns to Content", (m, r) => {
    const disp = M.tableDisplay(m);
    const st = resolveStyle(m.tstyle);
    const all = r.c0 === r.c1 || (r.c0 === 0 && r.c1 === m.cols.length - 1);
    for (let c = all ? 0 : r.c0; c <= (all ? m.cols.length - 1 : r.c1); c++) {
      let w = 24;
      for (let rr = 0; rr < m.rows.length; rr++) {
        const cell = m.cells[rr][c];
        if (cell.m || (cell.cs || 1) > 1) continue;
        const head = rr < m.headerRows;
        const font = { family: cell.family || st.family, size: cell.size || st.size, weight: cell.bold ? 700 : head ? st.headWeight : st.weight, style: cell.italic ? "italic" : "normal" };
        const tw = Math.max(0, ...String(disp[rr][c]).split("\n").map((l) => measurer.measure(font, l)));
        w = Math.max(w, tw + 2 * (Number.isFinite(cell.pad) ? cell.pad : st.padX) + 2);
      }
      m.cols[c] = Math.ceil(w);
    }
  });
}

// ---- cells
export const mergeSelection = (app) => tableEdit(app, "Merge Cells", (m, r) => M.mergeCells(m, r) || "Select two or more cells to merge.");
export const splitSelection = (app) => tableEdit(app, "Split Cells", (m, r) => M.splitCells(m, r) || "The selection has no merged cells.");
export const formatSelection = (app, patch, label = "Format Cells", opts) => tableEdit(app, label, (m, r) => M.formatCells(m, r, patch), opts);
export const borderSelection = (app, where, line) => tableEdit(app, "Cell Borders", (m, r) => M.setBorders(m, r, where, line));
export const clearSelection = (app, formatting = false) => tableEdit(app, formatting ? "Clear Cells" : "Clear Contents", (m, r) => M.clearCells(m, r, { formatting }));
/** Applies a number format to the columns of the selection (`null` removes it). */
export const setColumnFormat = (app, fmt) => tableEdit(app, "Number Format", (m, r) => {
  for (let c = r.c0; c <= r.c1; c++) m.colFmt[c] = fmt ? clone(fmt) : null;
});
export const setCellFormat = (app, fmt) => tableEdit(app, "Number Format", (m, r) => M.formatCells(m, r, { fmt: fmt || null }));
export const sortSelection = (app, dir) => {
  const r = selRect(app);
  return !!r && tableEdit(app, "Sort Table", (m) => M.sortRows(m, r.c0, dir));
};
export const setCellText = (app, r, c, text) => tableEdit(app, "Edit Cell", (m) => M.setCellValue(m, r, c, text), { coalesce: `cell:${r}:${c}` });

// ---- styles
export function applyStylePreset(app, id) {
  const node = activeTable(app);
  if (!node) return false;
  return tableEdit(app, "Table Style", (m) => {
    m.tstyle = presetStyle(id, app.doc.tableStyles);
    m.styleId = id;
  });
}
export function patchStyle(app, patch, label = "Table Style", opts) {
  return tableEdit(app, label, (m) => {
    m.tstyle = { ...m.tstyle, ...patch };
    m.styleId = undefined;
  }, opts);
}
/** Saves the table's current style into the document so it can be reused. Returns the id. */
export function saveTableStyle(app, name) {
  const node = activeTable(app);
  if (!node || !name) return null;
  const id = `ts_${Math.random().toString(36).slice(2, 8)}`;
  app.doc.set(app.doc, { tableStyles: { ...app.doc.tableStyles, [id]: { name, style: clone(node.tstyle) } } }, "Save Table Style");
  return id;
}
export function deleteTableStyle(app, id) {
  const next = { ...app.doc.tableStyles };
  delete next[id];
  app.doc.set(app.doc, { tableStyles: next }, "Delete Table Style");
}

// ---- data in / out
/** Replaces the cells of the active table with a matrix (keeps the table style). */
export function replaceTableData(app, matrix, { header = true } = {}) {
  return tableEdit(app, "Replace Table Data", (m) => {
    const fresh = M.createTable({ data: matrix, headerRows: header ? 1 : 0, width: m.cols.reduce((a, b) => a + b, 0), rowHeight: m.rows[0] });
    Object.assign(m, { cols: fresh.cols, rows: fresh.rows, cells: fresh.cells, headerRows: fresh.headerRows, headerCols: Math.min(m.headerCols, fresh.cols.length), colFmt: fresh.colFmt });
  });
}

/** New table from text (CSV / TSV / HTML table text already parsed into a matrix). */
export function tableFromMatrix(app, matrix, { header = true, style = "clean", name } = {}) {
  const cols = Math.max(...matrix.map((r) => r.length), 1);
  const width = Math.min(app.page.w - 80, Math.max(240, cols * 130));
  return addTableNode(app, { data: matrix, headerRows: header ? 1 : 0, width, style, name });
}

/** Pastes a matrix at the selected cell (growing the table); returns true when applied. */
export function pasteIntoSelection(app, matrix) {
  const node = activeTable(app);
  if (!node) return false;
  const s = app.tableSel;
  const r0 = s && !s.all ? Math.min(s.ar, s.fr) : 0;
  const c0 = s && !s.all ? Math.min(s.ac, s.fc) : 0;
  let rect = null;
  const ok = tableEdit(app, "Paste Cells", (m) => {
    rect = M.pasteMatrix(m, r0, c0, matrix);
    return !!rect;
  });
  if (ok && rect) setTableSel(app, node, rect.r0, rect.c0, rect.r1, rect.c1);
  return ok;
}

/** The selection as a matrix of raw text (for copy / cut). */
export function selectionMatrix(app) {
  const node = activeTable(app);
  return node ? M.copyRect(node, selRect(app, node)) : null;
}

/**
 * Splits the active table across pages: the table keeps the rows that fit, the rest moves to new pages as
 * continuation tables with the header rows repeated. Formulas become plain values (see docs). Returns the number
 * of tables the result consists of.
 */
export function flowAcrossPages(app) {
  const node = activeTable(app);
  const doc = app.doc;
  if (!node || !node._tl || !node._page) return 0;
  const page = node._page;
  const mg = page.margins || {};
  const top = mg.top || 40;
  const bottom = page.h - (mg.bottom || 40);
  const y0 = node.m[5];
  const first = bottom - y0;
  const next = bottom - top;
  const heights = node._tl.rowHeights;
  const total = heights.reduce((a, b) => a + b, 0);
  if (total <= first + 0.5) {
    app.toast("The table already fits on the page.", "primary");
    return 1;
  }
  if (node._parent !== page.root) {
    app.toast("Move the table out of its group first.", "warning");
    return 0;
  }
  const chunks = M.paginateRows(node, heights, first, next, { repeatHeader: node.repeatHeader !== false });
  if (chunks.length < 2) return 1;
  const pieces = chunks.map((c) => M.sliceRows(node, c.from, c.to, { repeatHeader: node.repeatHeader !== false }));
  doc.tx("Flow Table Across Pages", () => {
    const keep = ["cols", "rows", "cells", "headerRows", "headerCols", "tstyle", "colFmt", "autoHeight"];
    doc.set(node, Object.fromEntries(keep.map((k) => [k, pieces[0][k]])), "Flow Table Across Pages");
    let prev = page;
    for (let i = 1; i < pieces.length; i++) {
      const idx = doc.pages.indexOf(prev);
      const np = doc.addPage({}, idx + 1);
      const copy = doc.cloneNode(node);
      for (const k of keep) copy[k] = pieces[i][k];
      copy.name = `${node.name} (continued ${i})`;
      copy.m = [node.m[0], node.m[1], node.m[2], node.m[3], node.m[4], top];
      doc.insert(copy, np.root, np.root.children.length);
      prev = np;
    }
    doc.relayoutPages(doc.settings.facing);
  });
  app.toast(`Table split across ${pieces.length} pages. Continuation tables repeat the header rows.`, "success", 5000);
  return pieces.length;
}
