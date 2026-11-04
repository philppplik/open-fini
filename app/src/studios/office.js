// Office Studio: the Office Suite (docs/office-suite.md): a launcher plus one app per document kind (Document = the
// word processor of docs/office-studio.md; Spreadsheet, Presentation, Whiteboard register the same way). The suite
// host (office/host.js) and every app load on first use; only this definition and the menus are start-up code.
// Menus of an app carry `officeKinds` so they show only while that app is active (ui/menubar-select.js).
//
// Registration is kept in this one file plus one clearly marked block in studios/index.js so it can move to the studio
// registry (visible-studios preference, "More" menu) without touching anything else.
export const OFFICE_STUDIO = {
  id: "office",
  label: "Office",
  icon: "office",
  blurb: "Documents and more: Word, OpenDocument, templates",
  workspace: true,
  order: 60,
  // File ▸ New in this studio opens the Office launcher (new document per app, templates, recent files)
  newDocument: (app) => import("../office/host.js").then((m) => m.showOfficeHome(app)),
  tools: [],
  top: [],
  bottom: [],
};

/** Menus of the Office Studio (merged into ui/menus.js MENUS). */
export const OFFICE_MENUS = [
  {
    label: "Edit",
    studios: ["office"],
    officeKinds: ["document"],
    items: ["edit.undo", "edit.redo", "-", "office.cut", "office.copy", "office.paste", "office.pastePlain", "-", "office.selectAll", "-", "office.find", "office.replace", "-", "collab.addCommentHere", "collab.commentMode", "comments.panel", "-", "edit.preferences"],
  },
  {
    label: "Insert",
    studios: ["office"],
    officeKinds: ["document"],
    items: ["office.insertImage", "office.insertTable", "office.insertLink", "-", "office.insertPageBreak", "office.insertRule", "office.insertFootnote", "-", "office.insertPageNumber", "office.insertDate"],
  },
  {
    label: "Format",
    studios: ["office"],
    officeKinds: ["document"],
    items: ["office.bold", "office.italic", "office.underline", "office.strike", "office.superscript", "office.subscript", "-", "office.alignLeft", "office.alignCenter", "office.alignRight", "office.justify", "-", "office.bullets", "office.numbering", "office.indent", "office.outdent", "-", "office.paragraph", "office.styles", "office.clearFormatting"],
  },
  {
    label: "Table",
    studios: ["office"],
    officeKinds: ["document"],
    items: ["office.insertTable", "-", "office.rowAbove", "office.rowBelow", "office.colLeft", "office.colRight", "-", "office.deleteRow", "office.deleteCol", "office.deleteTable", "-", "office.mergeCells", "office.splitCell", "-", "office.headerRow", "office.cellShading", "office.tableBorders"],
  },
  {
    label: "View",
    studios: ["office"],
    officeKinds: ["document"],
    items: ["office.printLayout", "office.webLayout", "-", "office.zoomIn", "office.zoomOut", "office.zoom100", "office.zoomWidth", "-", "office.showOutline", "office.showStyles", "-", "office.spellcheck", "office.darkPage", "-", "view.theme"],
  },
  {
    label: "Document",
    studios: ["office"],
    officeKinds: ["document"],
    items: ["office.pageSetup", "office.headerFooter", "office.properties", "office.wordCount", "-", "office.export", { label: "Export As", items: ["office.exportDocx", "office.exportOdt", "office.exportRtf", "office.exportPdf", "office.exportHtml", "office.exportMd", "office.exportTxt"] }, "office.importReport"],
  },
  // Presentation app (office/slides): commands register when the app first loads (commands/office-slides.js)
  { label: "Edit", studios: ["office"], officeKinds: ["slides"], items: ["edit.undo", "edit.redo", "-", "slides.cut", "slides.copy", "slides.paste", "slides.duplicate", "slides.delete", "-", "slides.selectAll", "-", "edit.preferences"] },
  { label: "Insert", studios: ["office"], officeKinds: ["slides"], items: ["slides.newSlide", "slides.duplicateSlide", "-", "slides.insertText", "slides.insertShape", "slides.insertImage", "slides.insertTable"] },
  { label: "Format", studios: ["office"], officeKinds: ["slides"], items: ["slides.bold", "slides.italic", "slides.underline", "slides.bullets", "-", "slides.alignLeft", "slides.alignCenter", "slides.alignRight", "-", "slides.front", "slides.forward", "slides.backward", "slides.back", "slides.rotate"] },
  { label: "Slide", studios: ["office"], officeKinds: ["slides"], items: ["slides.newSlide", "slides.duplicateSlide", "slides.deleteSlide", "slides.hideSlide", "-", "slides.moveUp", "slides.moveDown", "-", "slides.transition.none", "slides.transition.fade", "slides.transition.slide", "-", "slides.export"] },
  { label: "View", studios: ["office"], officeKinds: ["slides"], items: ["slides.sorter", "-", "slides.present", "slides.presentCurrent", "slides.presenterView", "-", "view.theme"] },
  // Spreadsheet (commands/office-sheet.js, registered when the app loads)
  ...[
    ["Edit", "edit.undo edit.redo - sheet.cut sheet.copy sheet.paste sheet.pasteValues - sheet.fillDown sheet.fillRight sheet.clear sheet.clearAll - sheet.selectAll sheet.find sheet.replace"],
    ["Insert", "sheet.insertRowAbove sheet.insertRowBelow sheet.insertColLeft sheet.insertColRight - sheet.insertFunction sheet.insertChart - sheet.addSheet"],
    ["Format", "sheet.bold sheet.italic sheet.underline sheet.strike - sheet.alignLeft sheet.alignCenter sheet.alignRight sheet.wrap sheet.merge sheet.unmerge - sheet.numberFormat sheet.moreDecimals sheet.fewerDecimals - sheet.bordersAll sheet.bordersOuter sheet.bordersNone - sheet.conditional sheet.clearFormats - sheet.colWidth sheet.rowHeight sheet.autofit"],
    ["Data", "sheet.sortAsc sheet.sortDesc - sheet.filter - sheet.deleteRows sheet.deleteCols"],
    ["View", "sheet.freeze sheet.freezeRow sheet.freezeCol sheet.unfreeze - sheet.zoomIn sheet.zoomOut sheet.zoom100 - view.theme"],
    ["Sheet", "sheet.addSheet sheet.renameSheet sheet.duplicateSheet sheet.deleteSheet - office.export sheet.exportXlsx sheet.exportOds sheet.exportCsv sheet.exportPdf sheet.exportPng"],
  ].map(([label, items]) => ({ label, studios: ["office"], officeKinds: ["sheet"], items: items.split(" ") })),
];
