// Vibe tools of the Spreadsheet app (docs/office-sheet.md ▸ Vibe): describe the workbook, read and write ranges, set
// formulas, format cells, add sheets and charts. They work on the active Office document of kind "sheet"; every edit
// is one undoable step ("Vibe: …"). The app modules load on first use.
import { tool, S } from "./helpers.js";

const MAX_CELLS = 5000;
const CHART_TYPES = ["column", "stacked-column", "bar", "line", "area", "pie", "donut", "scatter"];

export function officeSheetTools(app) {
  async function ctx(sheetName) {
    const doc = app.doc;
    if (doc?.office?.kind !== "sheet") throw new Error("The active document is not a spreadsheet. Create one with office_new (kind sheet) or open an .xlsx/.ods/.csv file.");
    const { loadOfficeApp } = await import("../../office/index.js");
    await loadOfficeApp("sheet");
    const [{ calcFor, ensureModel }, M, sel, F, core] = await Promise.all([import("../../office/sheet/app.js"), import("../../office/sheet/model.js"), import("../../office/toolkit/selection.js"), import("../../office/sheet/formula.js"), import("../../core/office.js")]);
    const model = ensureModel(doc.office);
    const sheet = sheetName ? M.sheetByName(model, sheetName) : M.sheetById(model, app.officeUI?.kind === "sheet" && app.officeUI.doc === doc ? app.officeUI.sid : model.active) || M.activeSheet(model);
    if (!sheet) throw new Error(`No sheet named "${sheetName}". Sheets: ${model.sheets.map((s) => s.name).join(", ")}.`);
    const range = (ref) => {
      const g = sel.parseRange(String(ref || "").replace(/\$/g, "").trim().toUpperCase());
      if (!g) throw new Error(`"${ref}" is not an A1 range such as B2 or A1:C10.`);
      return g;
    };
    const commit = (label, next) => core.commitOffice(doc, `Vibe: ${label}`, next);
    return { doc, model, sheet, M, sel, F, calc: calcFor(doc), range, commit };
  }

  const plain = (F, v) => (F.isErr(v) ? v.code : v);
  const sheetArg = { sheet: S.str("Sheet name (default: the active sheet)") };

  return [
    tool("sheet_describe", "Describes the active spreadsheet: sheets, used ranges, header rows, formulas count, charts, frozen panes and filters.", {}, [], async () => {
      const c = await ctx();
      return c.M.describeWorkbook(c.model, (sid, a1) => plain(c.F, c.calc.value(sid, a1)));
    }, { readOnly: true }),

    tool("sheet_read_range", "Reads cell values (computed results) of a range of the active spreadsheet, optionally with formulas and number formats. At most 5000 cells per call.", {
      range: S.str("A1 range, e.g. A1:D20 (default: the used range)"),
      formulas: S.bool("Also return the formulas (=…) of formula cells"),
      formats: S.bool("Also return number format codes"),
      ...sheetArg,
    }, [], async ({ range, formulas = false, formats = false, sheet }) => {
      const c = await ctx(sheet);
      const g = range ? c.range(range) : c.M.usedRange(c.sheet);
      if (!g) return { sheet: c.sheet.name, range: null, values: [] };
      const r1 = Math.min(g.r1, g.r0 + Math.floor(MAX_CELLS / (g.c1 - g.c0 + 1)) - 1);
      const values = [];
      const f = [];
      const nf = [];
      for (let r = g.r0; r <= r1; r++) {
        const row = [];
        const fr = [];
        const nr = [];
        for (let col = g.c0; col <= g.c1; col++) {
          const cell = c.sheet.cells[c.F.rcKey(r, col)];
          row.push(plain(c.F, c.calc.get(c.sheet.id, r, col)));
          fr.push(cell?.f !== undefined ? `=${cell.f}` : null);
          nr.push(cell?.s?.nf || null);
        }
        values.push(row);
        f.push(fr);
        nf.push(nr);
      }
      return { sheet: c.sheet.name, range: c.sel.formatRange({ ...g, r1 }), truncated: r1 < g.r1, values, ...(formulas ? { formulas: f } : {}), ...(formats ? { formats: nf } : {}) };
    }, { readOnly: true }),

    tool("sheet_write_range", "Writes values into the active spreadsheet starting at a cell. Each value is entered like typed input: numbers, TRUE/FALSE, dates (2026-10-28), \"=SUM(A1:A3)\" formulas, text; null clears a cell.", {
      start: S.str("Top-left cell, e.g. A1"),
      values: { type: "array", items: { type: "array", items: {} }, minItems: 1, description: "Rows of values" },
      ...sheetArg,
    }, ["start", "values"], async ({ start, values, sheet }) => {
      const c = await ctx(sheet);
      const g = c.range(start);
      const cells = values.reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0);
      if (cells > MAX_CELLS) throw new Error(`At most ${MAX_CELLS} cells per call.`);
      let next = c.model;
      values.forEach((row, i) =>
        (Array.isArray(row) ? row : [row]).forEach((v, j) => {
          const a1 = c.F.rcKey(g.r0 + i, g.c0 + j);
          next = c.M.inputCell(next, c.sheet.id, a1, v == null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
        }));
      c.commit("Write Range", next);
      const end = c.F.rcKey(g.r0 + values.length - 1, g.c0 + Math.max(...values.map((r) => (Array.isArray(r) ? r.length : 1))) - 1);
      return { written: cells, range: `${c.F.rcKey(g.r0, g.c0)}:${end}`, sheet: c.sheet.name };
    }),

    tool("sheet_set_formula", "Sets a formula in a cell (English function names, commas between arguments, e.g. =SUM(B2:B10) or =VLOOKUP(A2,Data!A:C,3,FALSE)). `fillTo` copies it down or right with relative references adjusted. Returns the computed value.", {
      cell: S.str("Cell, e.g. D2"),
      formula: S.str("Formula with or without the leading ="),
      fillTo: S.str("Optional last cell to fill to, e.g. D20"),
      ...sheetArg,
    }, ["cell", "formula"], async ({ cell, formula, fillTo, sheet }) => {
      const c = await ctx(sheet);
      const g = c.range(cell);
      const f = String(formula).replace(/^=/, "").trim();
      try {
        c.F.parseFormula(f);
      } catch {
        throw new Error(`The formula "${formula}" has a syntax error.`);
      }
      let next = c.M.setCells(c.model, c.sheet.id, { [c.F.rcKey(g.r0, g.c0)]: { f } });
      if (fillTo) {
        const t = c.range(fillTo);
        next = c.M.fillRange(next, c.sheet.id, { r0: g.r0, c0: g.c0, r1: g.r0, c1: g.c0 }, { r0: g.r0, c0: g.c0, r1: Math.max(g.r0, t.r1), c1: Math.max(g.c0, t.c1) });
      }
      c.commit("Set Formula", next);
      const calc = (await import("../../office/sheet/app.js")).calcFor(c.doc);
      return { cell: c.F.rcKey(g.r0, g.c0), value: plain(c.F, calc.get(c.sheet.id, g.r0, g.c0)) };
    }),

    tool("sheet_format", "Formats a range of the active spreadsheet: font style, colors, alignment, number format, wrapping, borders, column width, merging.", {
      range: S.str("A1 range, e.g. A1:D1"),
      bold: S.bool("Bold"),
      italic: S.bool("Italic"),
      underline: S.bool("Underline"),
      color: S.str("Text color #rrggbb"),
      fill: S.str("Fill color #rrggbb, or \"none\""),
      align: S.str("left | center | right", { enum: ["left", "center", "right"] }),
      numberFormat: S.str("Number format code such as #,##0.00, 0%, \"$\"#,##0.00, yyyy-mm-dd, or General"),
      fontSize: S.num("Font size in points"),
      wrap: S.bool("Wrap text"),
      borders: S.str("all | outer | none", { enum: ["all", "outer", "none"] }),
      columnWidth: S.num("Width of the range's columns in pixels"),
      merge: S.bool("Merge (true) or unmerge (false) the range"),
      ...sheetArg,
    }, ["range"], async (a) => {
      const c = await ctx(a.sheet);
      const g = c.range(a.range);
      const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v.toLowerCase() : null);
      const patch = {};
      for (const [k, p] of [["bold", "b"], ["italic", "i"], ["underline", "u"], ["wrap", "wrap"]]) if (typeof a[k] === "boolean") patch[p] = a[k] || null;
      if (a.color) patch.color = hex(a.color);
      if (a.fill) patch.fill = a.fill === "none" ? null : hex(a.fill);
      if (a.align) patch.ha = a.align;
      if (a.numberFormat) patch.nf = a.numberFormat === "General" ? null : String(a.numberFormat).slice(0, 120);
      if (a.fontSize) patch.size = Math.max(4, Math.min(200, a.fontSize));
      let next = Object.keys(patch).length ? c.M.applyStyle(c.model, c.sheet.id, g, patch) : c.model;
      if (a.borders) {
        const col = "#000000";
        if (a.borders === "none") next = c.M.applyStyle(next, c.sheet.id, g, { bd: null });
        else if (a.borders === "all") next = c.M.applyStyle(next, c.sheet.id, g, { bd: { t: col, r: col, b: col, l: col } });
        else {
          next = c.M.applyStyle(next, c.sheet.id, { ...g, r1: g.r0 }, { bd: { t: col } });
          for (const [part, bd] of [[{ ...g, r0: g.r1 }, "b"], [{ ...g, c1: g.c0 }, "l"], [{ ...g, c0: g.c1 }, "r"]]) {
            next = c.M.updateSheet(next, c.sheet.id, (s) => {
              const cells = { ...s.cells };
              for (const [, , k] of c.M.rangeCells(s, part)) cells[k] = { ...(cells[k] || {}), s: { ...(cells[k]?.s || {}), bd: { ...(cells[k]?.s?.bd || {}), [bd]: col } } };
              return { ...s, cells };
            });
          }
        }
      }
      if (a.columnWidth) next = c.M.setSize(next, c.sheet.id, "col", Array.from({ length: Math.min(200, g.c1 - g.c0 + 1) }, (_, i) => g.c0 + i), a.columnWidth);
      if (typeof a.merge === "boolean") next = a.merge ? c.M.mergeRange(next, c.sheet.id, g) : c.M.unmergeRange(next, c.sheet.id, g);
      c.commit("Format Cells", next);
      return { formatted: c.sel.formatRange(g), sheet: c.sheet.name };
    }),

    tool("sheet_add_sheet", "Adds a sheet to the active spreadsheet (after the active one) and makes it active.", { name: S.str("Sheet name (1-31 characters, no [ ] : * ? / \\)") }, [], async ({ name }) => {
      const c = await ctx();
      if (name && !c.M.validSheetName(name)) throw new Error("Sheet names have 1 to 31 characters and none of [ ] : * ? / \\.");
      const next = c.M.addSheet(c.model, { name, after: c.sheet.id });
      c.commit("Add Sheet", next);
      if (app.officeUI?.kind === "sheet" && app.officeUI.doc === c.doc) app.officeUI.showSheet(next.active);
      return { added: c.M.sheetById(next, next.active).name, sheets: next.sheets.map((s) => s.name) };
    }),

    tool("sheet_add_chart", "Adds a chart to the active spreadsheet from a data range (first row = series names, first column = categories).", {
      range: S.str("Data range, e.g. A1:C8"),
      type: S.str("Chart type", { enum: CHART_TYPES }),
      title: S.str("Chart title"),
      at: S.str("Top-left cell of the chart (default: two columns right of the data)"),
      seriesIn: S.str("columns (default) or rows", { enum: ["columns", "rows"] }),
      ...sheetArg,
    }, ["range"], async ({ range, type = "column", title = "", at, seriesIn = "columns", sheet }) => {
      const c = await ctx(sheet);
      const g = c.range(range);
      const pos = at ? c.range(at) : { r0: g.r0, c0: g.c1 + 2 };
      const chart = { id: c.M.newId("ch"), type: CHART_TYPES.includes(type) ? type : "column", range: c.sel.formatRange(g), title: String(title).slice(0, 200), seriesIn, r: pos.r0, c: pos.c0, w: 480, h: 300 };
      c.commit("Add Chart", c.M.updateSheet(c.model, c.sheet.id, (s) => ({ ...s, charts: [...s.charts, chart] })));
      return { chart: chart.id, type: chart.type, range: chart.range, at: c.F.rcKey(pos.r0, pos.c0) };
    }),
  ];
}
