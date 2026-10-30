// Manifest of the Spreadsheet app (Office Suite, docs/office-sheet.md): plain data for the launcher, file routing and
// the Vibe prompt. The implementation (office/sheet/app.js) loads on first use.
export const SHEET_APP = {
  kind: "sheet",
  label: "Spreadsheet",
  icon: "table",
  blurb: "Budgets, lists and calculations: Excel, OpenDocument, CSV",
  order: 20,
  formats: [
    { id: "xlsx", label: "Excel workbook", ext: ["xlsx", "xlsm"], mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", read: true, write: true },
    { id: "xltx", label: "Excel template", ext: ["xltx"], read: true, template: true },
    { id: "ods", label: "OpenDocument spreadsheet", ext: ["ods", "fods"], mime: "application/vnd.oasis.opendocument.spreadsheet", read: true, write: true },
    { id: "ots", label: "OpenDocument spreadsheet template", ext: ["ots"], read: true, template: true },
    { id: "csv", label: "CSV", ext: ["csv"], mime: "text/csv", read: true, write: true, lossy: true },
    { id: "tsv", label: "Tab-separated values", ext: ["tsv"], mime: "text/tab-separated-values", read: true, write: true, lossy: true },
    { id: "pdf", label: "PDF", ext: ["pdf"], mime: "application/pdf", write: true },
    { id: "png", label: "PNG image", ext: ["png"], mime: "image/png", write: true },
  ],
  templates: [
    { id: "blank", label: "Blank spreadsheet", description: "An empty workbook", icon: "table", category: "Basic" },
    { id: "budget", label: "Budget", description: "Planned and actual amounts, totals and a chart", icon: "currency-dollar", category: "Personal" },
    { id: "invoice-table", label: "Invoice table", description: "Items, quantities, prices, tax and total", icon: "list-check", category: "Business" },
  ],
  aiNote: "The active Office document is a spreadsheet (workbook with sheets, cells, formulas, charts). Read it with sheet_describe and sheet_read_range before editing; edit with sheet_write_range, sheet_set_formula, sheet_format, sheet_add_sheet and sheet_add_chart. Formulas use English function names and commas (=SUM(A1:A3)). Every call is one undoable step.",
  load: () => import("./app.js"),
};
