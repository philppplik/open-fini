// Commands of the Spreadsheet app (Office Suite, docs/office-sheet.md). Registered by the app itself the first time
// a spreadsheet is mounted (office/sheet/view.js), so nothing of it is start-up code; the menus in studios/office.js
// (officeKinds: ["sheet"]) only show while a spreadsheet is active and skip ids that are not registered yet.
// Keyboard shortcuts of the grid (Ctrl+B, Ctrl+D, …) are handled by the grid itself; the shortcuts listed here are
// display hints only where another studio command owns the chord.
import { registerContextProvider } from "../ui/context-menu/index.js";

const S = ["office"];

export function registerSheetCommands(app) {
  if (app.commands.has("sheet.copy")) return;
  const on = (a) => a.studio === "office" && a.officeUI?.kind === "sheet";
  const v = () => app.officeUI;
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run: () => run(v()), studios: S, enabled: on, ...extra });

  def("sheet.cut", "Cut", (x) => x.copy(true), { icon: "scissors" });
  def("sheet.copy", "Copy", (x) => x.copy(false), { icon: "files" });
  def("sheet.paste", "Paste", (x) => x.paste(false), { icon: "clipboard" });
  def("sheet.pasteValues", "Paste Values Only", (x) => x.paste(true));
  def("sheet.pasteSpecial", "Paste Special…", (x) => x.pasteSpecialDialog());
  def("sheet.clear", "Clear Contents", (x) => x.clear(false), { icon: "eraser" });
  def("sheet.clearAll", "Clear All", (x) => x.clear(true));
  def("sheet.clearFormats", "Clear Formats", (x) => x.clearFormats());
  def("sheet.selectAll", "Select All", (x) => x.selectAll());
  def("sheet.find", "Find…", (x) => x.findDialog(false), { icon: "search" });
  def("sheet.replace", "Replace…", (x) => x.findDialog(true));
  def("sheet.fillDown", "Fill Down", (x) => x.fill("down"));
  def("sheet.fillRight", "Fill Right", (x) => x.fill("right"));

  def("sheet.insertRowAbove", "Insert Row Above", (x) => x.insert("row", false));
  def("sheet.insertRowBelow", "Insert Row Below", (x) => x.insert("row", true));
  def("sheet.insertColLeft", "Insert Column Left", (x) => x.insert("col", false));
  def("sheet.insertColRight", "Insert Column Right", (x) => x.insert("col", true));
  def("sheet.deleteRows", "Delete Rows", (x) => x.remove("row"));
  def("sheet.deleteCols", "Delete Columns", (x) => x.remove("col"));
  def("sheet.insertChart", "Chart…", (x) => x.chartDialog(), { icon: "bar-chart" });
  def("sheet.insertFunction", "Function…", (x) => x.insertFunction(), { icon: "hash" });

  def("sheet.bold", "Bold", (x) => x.toggle("b"));
  def("sheet.italic", "Italic", (x) => x.toggle("i"));
  def("sheet.underline", "Underline", (x) => x.toggle("u"));
  def("sheet.strike", "Strikethrough", (x) => x.toggle("st"));
  def("sheet.alignLeft", "Align Left", (x) => x.setStyle({ ha: "left" }));
  def("sheet.alignCenter", "Center", (x) => x.setStyle({ ha: "center" }));
  def("sheet.alignRight", "Align Right", (x) => x.setStyle({ ha: "right" }));
  def("sheet.wrap", "Wrap Text", (x) => x.toggle("wrap"));
  def("sheet.merge", "Merge Cells", (x) => x.merge(true));
  def("sheet.unmerge", "Unmerge Cells", (x) => x.merge(false));
  def("sheet.numberFormat", "Number Format…", (x) => x.numberFormatDialog());
  def("sheet.moreDecimals", "Increase Decimals", (x) => x.decimals(1));
  def("sheet.fewerDecimals", "Decrease Decimals", (x) => x.decimals(-1));
  def("sheet.bordersAll", "All Borders", (x) => x.borders("all"));
  def("sheet.bordersOuter", "Outside Borders", (x) => x.borders("outer"));
  def("sheet.bordersNone", "No Borders", (x) => x.borders("none"));
  def("sheet.conditional", "Conditional Formatting…", (x) => x.conditionalDialog());
  def("sheet.colWidth", "Column Width…", (x) => x.sizePrompt("col"));
  def("sheet.rowHeight", "Row Height…", (x) => x.sizePrompt("row"));
  def("sheet.autofit", "Autofit Column Width", (x) => x.autofit("col", x.sel.c));

  def("sheet.sortAsc", "Sort Ascending", (x) => x.sort(true));
  def("sheet.sortDesc", "Sort Descending", (x) => x.sort(false));
  def("sheet.filter", "Filter", (x) => x.toggleFilter(), { checked: (a) => !!(on(a) && a.officeUI.sheet.filter) });
  def("sheet.freeze", "Freeze Panes", (x) => x.freeze("selection"), { checked: (a) => !!(on(a) && a.officeUI.sheet.freeze) });
  def("sheet.freezeRow", "Freeze Top Row", (x) => x.freeze("row"));
  def("sheet.freezeCol", "Freeze First Column", (x) => x.freeze("col"));
  def("sheet.unfreeze", "Unfreeze Panes", (x) => x.freeze("none"));
  def("sheet.formatTable", "Format as Table…", (x) => x.tableDialog(), { icon: "table" });
  def("sheet.validation", "Data Validation…", (x) => x.validationDialog(), { icon: "ui-checks" });
  def("sheet.names", "Named Ranges…", (x) => x.namesDialog(), { icon: "bookmark" });
  def("sheet.pivot", "Pivot Table…", (x) => x.pivotDialog(), { icon: "diagram-3" });
  def("sheet.refreshPivots", "Refresh Pivot Tables", (x) => x.refreshPivots(), { icon: "arrow-clockwise" });
  def("sheet.sparkline", "Sparkline…", (x) => x.sparklineDialog(), { icon: "graph-up" });
  def("sheet.groupRows", "Group Rows", (x) => x.groupSelection("row", true), { shortcut: "Alt+Shift+Right" });
  def("sheet.ungroupRows", "Ungroup Rows", (x) => x.groupSelection("row", false), { shortcut: "Alt+Shift+Left" });
  def("sheet.groupCols", "Group Columns", (x) => x.groupSelection("col", true));
  def("sheet.ungroupCols", "Ungroup Columns", (x) => x.groupSelection("col", false));
  def("sheet.collapseGroup", "Collapse Group", (x) => x.collapseGroups(true));
  def("sheet.expandGroups", "Expand All Groups", (x) => x.collapseGroups(false, true));
  def("sheet.pageSetup", "Page Setup…", (x) => x.pageSetupDialog(), { icon: "file-earmark-ruled" });
  def("sheet.print", "Print…", (x) => x.printSheet(), { icon: "printer" });
  def("sheet.zoomIn", "Zoom In", (x) => x.setZoom(x.zoom * 1.25));
  def("sheet.zoomOut", "Zoom Out", (x) => x.setZoom(x.zoom / 1.25));
  def("sheet.zoom100", "Actual Size", (x) => x.setZoom(1));

  def("sheet.addSheet", "New Sheet", (x) => x.addSheet(), { icon: "plus-lg" });
  def("sheet.renameSheet", "Rename Sheet…", (x) => x.renameSheet());
  def("sheet.duplicateSheet", "Duplicate Sheet", (x) => x.duplicateSheet());
  def("sheet.deleteSheet", "Delete Sheet", (x) => x.deleteSheet());
  for (const [id, label] of [["xlsx", "Excel Workbook (.xlsx)…"], ["ods", "OpenDocument Spreadsheet (.ods)…"], ["csv", "CSV (.csv)…"], ["pdf", "PDF…"], ["png", "PNG Image…"]])
    def(`sheet.export${id[0].toUpperCase()}${id.slice(1)}`, label, () => import("../office/services/export.js").then((m) => m.exportOfficeDoc(app, app.doc, id)).catch((e) => app.toast(e.message, "danger", 6000)));

  registerContextProvider({
    id: "office-sheet",
    priority: 50,
    matches: (ctx) => ctx.kind === "office-sheet",
    items: (ctx) =>
      ctx.data?.tab
        ? ["sheet.addSheet", "sheet.renameSheet", "sheet.duplicateSheet", "sheet.deleteSheet"]
        : ["sheet.cut", "sheet.copy", "sheet.paste", "sheet.pasteValues", "sheet.pasteSpecial", "-", "sheet.insertRowAbove", "sheet.insertColLeft", "sheet.deleteRows", "sheet.deleteCols", "-", "sheet.clear", "sheet.clearFormats", "-", "sheet.sortAsc", "sheet.sortDesc", "sheet.filter", "-", "sheet.merge", "sheet.numberFormat", "sheet.conditional", "sheet.validation", "sheet.insertChart"],
  });
  app.emit("commands");
}
