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
    items: ["edit.undo", "edit.redo", "-", "office.cut", "office.copy", "office.paste", "office.pastePlain", "-", "office.selectAll", "-", "office.find", "office.replace", "-", "edit.preferences"],
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
];
