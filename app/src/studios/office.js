// Office Studio: a page-based word processor for Word / OpenDocument / RTF documents (docs/office-studio.md).
// Its whole workspace (toolbar, outline/styles sidebar, pages) is ui/office/, loaded on first use.
//
// Registration is kept in this one file plus one clearly marked block in studios/index.js so it can move to the studio
// registry (visible-studios preference, "More" menu) without touching anything else.
export const OFFICE_STUDIO = {
  id: "office",
  label: "Office",
  icon: "office",
  blurb: "Word documents: write, format and export",
  workspace: true,
  tools: [],
  top: [],
  bottom: [],
};

/** Menus of the Office Studio (merged into ui/menus.js MENUS). */
export const OFFICE_MENUS = [
  {
    label: "Edit",
    studios: ["office"],
    items: ["edit.undo", "edit.redo", "-", "office.cut", "office.copy", "office.paste", "office.pastePlain", "-", "office.selectAll", "-", "office.find", "office.replace", "-", "edit.preferences"],
  },
  {
    label: "Insert",
    studios: ["office"],
    items: ["office.insertImage", "office.insertTable", "office.insertLink", "-", "office.insertPageBreak", "office.insertRule", "office.insertFootnote", "-", "office.insertPageNumber", "office.insertDate"],
  },
  {
    label: "Format",
    studios: ["office"],
    items: ["office.bold", "office.italic", "office.underline", "office.strike", "office.superscript", "office.subscript", "-", "office.alignLeft", "office.alignCenter", "office.alignRight", "office.justify", "-", "office.bullets", "office.numbering", "office.indent", "office.outdent", "-", "office.paragraph", "office.styles", "office.clearFormatting"],
  },
  {
    label: "Table",
    studios: ["office"],
    items: ["office.insertTable", "-", "office.rowAbove", "office.rowBelow", "office.colLeft", "office.colRight", "-", "office.deleteRow", "office.deleteCol", "office.deleteTable", "-", "office.mergeCells", "office.splitCell", "-", "office.headerRow", "office.cellShading", "office.tableBorders"],
  },
  {
    label: "View",
    studios: ["office"],
    items: ["office.printLayout", "office.webLayout", "-", "office.zoomIn", "office.zoomOut", "office.zoom100", "office.zoomWidth", "-", "office.showOutline", "office.showStyles", "-", "office.spellcheck", "office.darkPage", "-", "view.theme"],
  },
  {
    label: "Document",
    studios: ["office"],
    items: ["office.pageSetup", "office.headerFooter", "office.properties", "office.wordCount", "-", "office.export", { label: "Export As", items: ["office.exportDocx", "office.exportOdt", "office.exportRtf", "office.exportPdf", "office.exportHtml", "office.exportMd", "office.exportTxt"] }, "office.importReport"],
  },
];
