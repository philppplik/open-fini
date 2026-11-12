// Vibe tools for the Spreadsheet depth features (docs/office-sheet.md ▸ Tables, names and data tools): table styles,
// defined names, data validation, paste special, row/column groups, page setup, pivot-lite, sparklines and chart data
// for other apps. They work on the active spreadsheet (sheet_chart_data also on any open one); every edit is one
// undoable step ("Vibe: …"). The model code (office/sheet/depth.js) loads on first use.
import { tool, S } from "./helpers.js";

export function officeSheetDepthTools(app) {
  async function ctx(sheetName, docName = null) {
    const doc = docName ? app.docs.find((x) => x.office?.kind === "sheet" && x.name.toLowerCase() === String(docName).toLowerCase()) : app.doc;
    if (docName && !doc) throw new Error(`No open spreadsheet named "${docName}". Open spreadsheets: ${app.docs.filter((x) => x.office?.kind === "sheet").map((x) => x.name).join(", ") || "none"}.`);
    if (doc?.office?.kind !== "sheet") throw new Error("The active document is not a spreadsheet. Create one with office_new (kind sheet) or open an .xlsx/.ods/.csv file.");
    const { loadOfficeApp } = await import("../../office/index.js");
    await loadOfficeApp("sheet");
    const [{ calcFor, ensureModel }, M, D, core] = await Promise.all([import("../../office/sheet/app.js"), import("../../office/sheet/model.js"), import("../../office/sheet/depth.js"), import("../../core/office.js")]);
    const model = ensureModel(doc.office);
    const sheet = sheetName ? M.sheetByName(model, sheetName) : M.sheetById(model, app.officeUI?.kind === "sheet" && app.officeUI.doc === doc ? app.officeUI.sid : model.active) || M.activeSheet(model);
    if (!sheet) throw new Error(`No sheet named "${sheetName}". Sheets: ${model.sheets.map((s) => s.name).join(", ")}.`);
    const calc = calcFor(doc);
    const get = (sid, r, c) => calc.get(sid, r, c);
    const commit = (label, next) => core.commitOffice(doc, `Vibe: ${label}`, next);
    return { doc, model, sheet, M, D, calc, get, commit };
  }
  const sheetArg = { sheet: S.str("Sheet name (default: the active sheet)") };

  return [
    tool("sheet_format_table", "Formats a range with a header row as a table: header style, banded rows and optionally a total row (SUBTOTAL sums under numeric columns). Watch out: include the header row in the range; the total row is added below the data, so leave that row empty.", {
      range: S.str("A1 range including the header row, e.g. A1:D20"),
      style: S.str("Table style", { enum: ["blue", "green", "orange", "gray", "light"] }),
      total: S.bool("Add a total row"),
      banded: S.bool("Banded rows (default true)"),
      header: S.bool("First row is a header (default true)"),
      ...sheetArg,
    }, ["range"], async ({ range, style = "blue", total = false, banded = true, header = true, sheet }) => {
      const c = await ctx(sheet);
      const next = c.D.addTable(c.model, c.sheet.id, { range, style, total, banded, header });
      c.commit("Format as Table", next);
      const t = c.M.sheetById(next, c.sheet.id).tables.at(-1);
      return { table: t.id, range: t.range, style: t.style, total: t.total, sheet: c.sheet.name };
    }),

    tool("sheet_define_name", "Defines (or deletes) a named range or constant for formulas, e.g. TaxRate = Sheet1!$B$1 so =A2*TaxRate works. Names: letters, digits, _ and . starting with a letter; not a cell reference such as A1 or TAX1.", {
      name: S.str("Name, e.g. Sales or TaxRate"),
      refersTo: S.str("Reference with sheet name and $ signs (Sheet1!$A$2:$A$20) or a constant (0.19); omit with delete"),
      delete: S.bool("Delete the name instead"),
    }, ["name"], async ({ name, refersTo, delete: del = false }) => {
      const c = await ctx();
      const next = del ? c.D.deleteName(c.model, name) : c.D.setName(c.model, name, refersTo);
      c.commit(del ? "Delete Name" : "Define Name", next);
      return { names: next.names || {} };
    }),

    tool("sheet_set_validation", "Adds data validation to a range: a drop-down list (items or a source range), or number, whole-number or text-length limits; typed values that break the rule are rejected with the message. `clear` removes validation from the range. Watch out: validation checks typed, pasted and tool-written values, not values already in the cells.", {
      range: S.str("A1 range, e.g. C2:C100"),
      type: S.str("Rule type", { enum: ["list", "number", "integer", "textLength"] }),
      items: { type: "array", items: { type: "string" }, description: "List items (type list)" },
      source: S.str("Source range of the list instead of items, e.g. Lists!$A$1:$A$10"),
      min: S.num("Minimum (number, integer, textLength)"),
      max: S.num("Maximum (number, integer, textLength)"),
      message: S.str("Message shown when input is rejected"),
      allowBlank: S.bool("Allow empty cells (default true)"),
      clear: S.bool("Remove validation from the range instead"),
      ...sheetArg,
    }, ["range"], async ({ range, type = "list", items, source, min, max, message, allowBlank = true, clear = false, sheet }) => {
      const c = await ctx(sheet);
      const next = clear ? c.D.clearValidation(c.model, c.sheet.id, range) : c.D.addValidation(c.model, c.sheet.id, { range, type, list: items, source, min, max, message, allowBlank });
      c.commit(clear ? "Clear Validation" : "Data Validation", next);
      return { validation: (c.M.sheetById(next, c.sheet.id).validation || []).map((v) => `${v.range} ${v.type}`), sheet: c.sheet.name };
    }),

    tool("sheet_paste_special", "Copies a range to another place of the same sheet with paste-special options: only values (computed results), formulas, or formats; add/subtract/multiply/divide into the target numbers; skip blanks; transpose (rows become columns).", {
      from: S.str("Source range, e.g. A1:C10"),
      to: S.str("Top-left target cell, e.g. F1"),
      paste: S.str("What to paste (default values)", { enum: ["all", "values", "formulas", "formats"] }),
      op: S.str("Arithmetic with the target numbers (default none)", { enum: ["none", "add", "sub", "mul", "div"] }),
      transpose: S.bool("Swap rows and columns"),
      skipBlanks: S.bool("Leave target cells unchanged where the source is empty"),
      ...sheetArg,
    }, ["from", "to"], async ({ from, to, paste = "values", op = "none", transpose = false, skipBlanks = false, sheet }) => {
      const c = await ctx(sheet);
      const { g } = c.D.sheetRange(c.model, from, c.sheet);
      if ((g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1) > 20000) throw new Error("At most 20000 cells per call.");
      const at = c.D.sheetRange(c.model, to, c.sheet).g;
      const block = [];
      const values = [];
      for (let r = g.r0; r <= g.r1; r++) {
        const row = [];
        const vrow = [];
        for (let col = g.c0; col <= g.c1; col++) {
          row.push(c.sheet.cells[c.M.rcKey(r, col)] || null);
          const v = c.calc.get(c.sheet.id, r, col);
          vrow.push(v && typeof v === "object" ? null : v);
        }
        block.push(row);
        values.push(vrow);
      }
      const pasted = c.D.pasteSpecial(c.model, c.sheet.id, at.r0, at.c0, { block, values, from: { r: g.r0, c: g.c0 } }, { paste, op, transpose, skipBlanks });
      const bad = c.D.invalidWrites(c.model, pasted, c.sheet.id, c.get);
      if (bad.length) throw new Error(`Data validation rejects ${bad.map((b) => `${b.cell} (${b.message})`).join("; ")}. Nothing was pasted.`);
      c.commit("Paste Special", pasted);
      const h = transpose ? g.c1 - g.c0 : g.r1 - g.r0;
      const w = transpose ? g.r1 - g.r0 : g.c1 - g.c0;
      return { pasted: `${c.M.rcKey(at.r0, at.c0)}:${c.M.rcKey(at.r0 + h, at.c0 + w)}`, sheet: c.sheet.name };
    }),

    tool("sheet_group", "Groups rows or columns into an outline and collapses (hides) or expands them, e.g. detail rows under a subtotal. Ranges are row numbers (3:8) or column letters (B:D).", {
      range: S.str("Rows like 3:8 or columns like B:D"),
      action: S.str("group (default), ungroup, collapse or expand", { enum: ["group", "ungroup", "collapse", "expand"] }),
      ...sheetArg,
    }, ["range"], async ({ range, action = "group", sheet }) => {
      const c = await ctx(sheet);
      const s = String(range).replace(/\$/g, "").trim().toUpperCase();
      let m = /^(\d+)(?::(\d+))?$/.exec(s);
      let axis = "row";
      let a;
      let b;
      if (m) [a, b] = [Number(m[1]) - 1, Number(m[2] || m[1]) - 1];
      else if ((m = /^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/.exec(s))) {
        axis = "col";
        [a, b] = [c.M.keyRC(`${m[1]}1`).c, c.M.keyRC(`${m[2] || m[1]}1`).c];
      } else throw new Error(`"${range}" is not a row range (3:8) or a column range (B:D).`);
      let next = c.model;
      if (action === "group") next = c.D.group(next, c.sheet.id, axis, a, b);
      else if (action === "ungroup") next = c.D.ungroup(next, c.sheet.id, axis, Math.min(a, b), Math.max(a, b));
      else next = c.D.setCollapsed(next, c.sheet.id, axis, Math.min(a, b), action === "collapse");
      c.commit(action[0].toUpperCase() + action.slice(1), next);
      return { groups: c.M.sheetById(next, c.sheet.id).groups || { row: [], col: [] }, sheet: c.sheet.name };
    }),

    tool("sheet_page_setup", "Sets how a sheet prints and exports to PDF: orientation, paper, margins, print area, gridlines and scaling (fit the print area on one page, or all columns on one page width).", {
      orientation: S.str("portrait or landscape", { enum: ["portrait", "landscape"] }),
      paper: S.str("Paper size", { enum: ["a4", "a3", "a5", "letter", "legal"] }),
      margin: S.num("Margin in pixels at 96 dpi (24 narrow, 48 normal, 96 wide)"),
      printArea: S.str("A1 range to print; empty string prints the whole sheet"),
      gridlines: S.bool("Print gridlines"),
      fitToPage: S.bool("Fit the print area on one page (same as fit: page)"),
      fit: S.str("Scaling onto the paper: none, page (one page) or width (all columns on one page width)", { enum: ["none", "page", "width"] }),
      ...sheetArg,
    }, [], async ({ orientation, paper, margin, printArea, gridlines, fitToPage, fit, sheet }) => {
      const c = await ctx(sheet);
      const next = c.D.setPageSetup(c.model, c.sheet.id, { orientation, paper, margin, printArea, gridlines, fit: fit || (fitToPage === undefined ? undefined : fitToPage ? "page" : "none") });
      c.commit("Page Setup", next);
      return { page: c.M.sheetById(next, c.sheet.id).page, sheet: c.sheet.name };
    }),

    tool("sheet_pivot", "Summarizes a table (header row + data rows) like a pivot table: one row per value of `rows`, optionally one column per value of `columns`, with the sum, count, average, min or max of `values`, plus totals. Writes the result to a new sheet (default) or at a cell and keeps its definition, so sheet_refresh_pivots updates it after the data changes.", {
      range: S.str("Source range with its header row, e.g. A1:E200 (Data!A1:E200 for another sheet)"),
      rows: S.str("Header (or column letter) of the row field"),
      columns: S.str("Optional header of the column field"),
      values: S.str("Header of the value field"),
      agg: S.str("Aggregate (default sum)", { enum: ["sum", "count", "average", "min", "max"] }),
      newSheet: S.str("Name of the new sheet for the result (default Pivot)"),
      at: S.str("Instead of a new sheet: top-left cell on the active sheet"),
      ...sheetArg,
    }, ["range", "rows", "values"], async ({ range, rows, columns, values, agg = "sum", newSheet, at, sheet }) => {
      const c = await ctx(sheet);
      const table = c.D.pivot(c.model, c.sheet, c.get, { range, rows, columns, values, agg });
      const spec = { range, rows, columns, values, agg };
      const next = at ? c.D.writePivot(c.model, c.sheet.id, table, { at, spec }) : c.D.writePivot(c.model, c.sheet.id, table, { name: newSheet || "Pivot", spec });
      c.commit("Pivot Table", next);
      if (!at && app.officeUI?.kind === "sheet" && app.officeUI.doc === c.doc) app.officeUI.showSheet(next.active);
      return { sheet: at ? c.sheet.name : c.M.sheetById(next, next.active).name, rows: table.length, columns: table[0].length, preview: table.slice(0, 12) };
    }),

    tool("sheet_refresh_pivots", "Recomputes pivot tables from their source data after it changed: every pivot table of the workbook, or those on one sheet. Pivot tables made by sheet_pivot or Insert ▸ Pivot Table remember their definition (also through XLSX and ODS files saved by OpenFini). Verify with sheet_read_range on the pivot sheet.", {
      sheet: S.str("Only the pivot tables on this sheet (default: all sheets)"),
    }, [], async ({ sheet }) => {
      const c = await ctx(sheet);
      const res = c.D.refreshPivots(c.model, c.get, { sid: sheet ? c.sheet.id : null });
      if (res.refreshed) c.commit("Refresh Pivot Tables", res.model);
      return { refreshed: res.refreshed, errors: res.errors };
    }),

    tool("sheet_add_sparkline", "Draws a small line or column chart inside one cell from a row or column of numbers (a trend next to each data row).", {
      cell: S.str("Cell that shows the sparkline, e.g. F2"),
      range: S.str("Numbers to draw, e.g. B2:E2"),
      type: S.str("line (default) or column", { enum: ["line", "column"] }),
      color: S.str("Color #rrggbb"),
      ...sheetArg,
    }, ["cell", "range"], async ({ cell, range, type = "line", color = "#2563eb", sheet }) => {
      const c = await ctx(sheet);
      const next = c.D.addSparkline(c.model, c.sheet.id, { cell, range, type, color });
      c.commit("Insert Sparkline", next);
      return { sparklines: (c.M.sheetById(next, c.sheet.id).sparks || []).map((x) => `${x.cell} ← ${x.range}`), sheet: c.sheet.name };
    }),

    tool("sheet_chart_data", "Reads chart-ready data from a range of an open spreadsheet (computed values): categories from the first column, one series per further column named by the header row (seriesIn rows swaps them). Use it to put sheet numbers into a presentation or document chart or table without retyping them.", {
      range: S.str("A1 range with a header row and a label column, e.g. A1:C13"),
      spreadsheet: S.str("Name of the open spreadsheet (office_list_documents); default: the active document"),
      seriesIn: S.str("columns (default) or rows", { enum: ["columns", "rows"] }),
      ...sheetArg,
    }, ["range"], async ({ range, spreadsheet, seriesIn = "columns", sheet }) => {
      const c = await ctx(sheet, spreadsheet);
      const data = c.D.sheetChartData(c.model, { sheet: c.sheet.name, range, seriesIn }, c.get);
      return { ...data, rows: [["", ...data.series.map((s) => s.name)], ...data.categories.map((cat, i) => [cat, ...data.series.map((s) => s.values[i])])] };
    }, { readOnly: true }),
  ];
}
