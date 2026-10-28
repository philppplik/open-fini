// Commands of the Office Studio (menus, shortcuts, command palette). The UI modules load on first use.
const S = ["office"];

export function registerOfficeCommands(app) {
  const live = (a) => a.studio === "office" && !!a.officeUI?.editor;
  const ws = () => app.officeUI;
  const ed = () => app.officeUI?.editor;
  const dlg = () => import("../ui/office/dialogs.js");
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: S, enabled: live, ...extra });
  const then = (fn) => (a) => {
    fn(a);
    ed()?.focus();
  };

  // ---- clipboard and selection
  const exec = (cmd) => () => {
    ed()?.focus();
    if (!document.execCommand?.(cmd)) app.toast(`Use ${cmd === "copy" ? "Ctrl+C" : "Ctrl+X"} (the browser blocked clipboard access).`, "warning");
  };
  def("office.cut", "Cut", exec("cut"), { icon: "scissors" });
  def("office.copy", "Copy", exec("copy"), { icon: "files" });
  const paste = async (plain) => {
    const e = ed();
    try {
      if (!plain && navigator.clipboard?.read) {
        for (const item of await navigator.clipboard.read()) {
          const img = item.types.find((t) => t.startsWith("image/"));
          if (img) return e.insertImage(new Uint8Array(await (await item.getType(img)).arrayBuffer()), "Pasted image");
          if (item.types.includes("text/html")) return e.pasteHtml(await (await item.getType("text/html")).text());
        }
      }
      const text = await navigator.clipboard.readText();
      if (text) e.insertText(text.replace(/\r\n?/g, "\n"), "Paste");
    } catch {
      app.toast("Use Ctrl+V to paste (the browser blocked clipboard access).", "warning", 3500);
    }
  };
  def("office.paste", "Paste", () => paste(false), { icon: "clipboard" });
  def("office.pastePlain", "Paste as Plain Text", () => paste(true), { shortcut: "Mod+Shift+V" });
  def("office.selectAll", "Select All", () => ed().selectAll());
  def("office.find", "Find…", () => ws().find.open(false), { shortcut: "Mod+F", icon: "search" });
  def("office.replace", "Replace…", () => ws().find.open(true), { shortcut: "Mod+H" });

  // ---- character formatting
  def("office.bold", "Bold", then(() => ed().toggleMark("b")), { shortcut: "Mod+B" });
  def("office.italic", "Italic", then(() => ed().toggleMark("i")), { shortcut: "Mod+I" });
  def("office.underline", "Underline", then(() => ed().toggleMark("u")), { shortcut: "Mod+U" });
  def("office.strike", "Strikethrough", then(() => ed().toggleMark("s")), { shortcut: "Mod+Shift+X" });
  def("office.superscript", "Superscript", then(() => ed().toggleMark("va", "super")), { shortcut: "Mod+." });
  def("office.subscript", "Subscript", then(() => ed().toggleMark("va", "sub")), { shortcut: "Mod+," });
  def("office.removeHighlight", "Remove Highlight", then(() => ed().setMarks({ highlight: null }, "Remove Highlight")));
  def("office.clearFormatting", "Clear Formatting", then(() => ed().clearFormatting()), { shortcut: "Mod+Space", icon: "eraser" });

  // ---- paragraphs
  def("office.alignLeft", "Align Left", then(() => ed().setParagraph({ align: "left" })), { shortcut: "Mod+L", icon: "text-left" });
  def("office.alignCenter", "Center", then(() => ed().setParagraph({ align: "center" })), { shortcut: "Mod+E", icon: "text-center" });
  def("office.alignRight", "Align Right", then(() => ed().setParagraph({ align: "right" })), { shortcut: "Mod+R", icon: "text-right" });
  def("office.justify", "Justify", then(() => ed().setParagraph({ align: "justify" })), { shortcut: "Mod+J", icon: "justify" });
  def("office.bullets", "Bulleted List", then(() => ed().toggleList("bullet")), { shortcut: "Mod+Shift+L", icon: "list-ul" });
  def("office.numbering", "Numbered List", then(() => ed().toggleList("number")), { shortcut: "Mod+Shift+N", icon: "list-ol" });
  def("office.indent", "Increase Indent", then(() => ed().indent(1)), { shortcut: "Mod+]" });
  def("office.outdent", "Decrease Indent", then(() => ed().indent(-1)), { shortcut: "Mod+[" });
  def("office.paragraph", "Paragraph…", () => dlg().then((m) => m.paragraphDialog(app, ws())), { icon: "paragraph" });
  def("office.styles", "Styles", () => ws().showPanel("styles"));
  def("office.normal", "Normal Text", then(() => ed().setStyle("Normal")), { shortcut: "Mod+Alt+0" });
  for (const n of [1, 2, 3]) def(`office.heading${n}`, `Heading ${n}`, then(() => ed().setStyle(`Heading${n}`)), { shortcut: `Mod+Alt+${n}` });

  // ---- insert
  def("office.insertImage", "Image…", async () => {
    const { platform } = await import("../platform/index.js");
    const files = await platform.openFiles({ accept: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }], multiple: true });
    for (const f of files) ed().insertImage(f.bytes, f.name);
  }, { icon: "image" });
  def("office.insertTable", "Table…", () => {
    const anchor = ws().toolbar.querySelector('[aria-label="Insert table"]') || ws().toolbar;
    dlg().then((m) => m.tablePicker(app, anchor, (r, c) => ed().insertTable(r, c)));
  }, { icon: "table" });
  def("office.insertLink", "Link…", () => dlg().then((m) => m.linkDialog(app, ws())), { shortcut: "Mod+K", icon: "link-45deg" });
  def("office.openLink", "Open Link", () => import("../ui/links.js").then((m) => m.openLink(ed().linkAt(), { app })), { enabled: (a) => live(a) && !!a.officeUI.editor.linkAt() });
  def("office.removeLink", "Remove Link", then(() => ed().setLink(null)), { enabled: (a) => live(a) && !!a.officeUI.editor.linkAt() });
  def("office.insertPageBreak", "Page Break", then(() => ed().insertPageBreak()), { shortcut: "Mod+Enter" });
  def("office.insertRule", "Horizontal Line", then(() => ed().insertRule()), { icon: "hr" });
  def("office.insertFootnote", "Footnote…", async () => {
    const { promptDialog } = await import("../ui/dialogs.js");
    const v = await promptDialog({ title: "Insert footnote", label: "Footnote text", ok: "Insert" });
    if (v !== null) ed().insertFootnote(v);
    ed().focus();
  }, { shortcut: "Mod+Alt+F" });
  def("office.insertPageNumber", "Page Number", then(() => ed().insertInline([{ type: "field", field: "page" }], "Page Number")));
  def("office.insertDate", "Date", then(() => ed().insertText(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), "Insert Date")));
  def("office.imageProperties", "Image Properties…", () => dlg().then((m) => m.imagePropertiesDialog(app, ws())));

  // ---- tables
  const inTable = (a) => live(a) && !!a.officeUI.editor.tableContext();
  const t = (id, label, op, extra = {}) => def(id, label, then(() => ed().tableOp(op)), { enabled: inTable, ...extra });
  t("office.rowAbove", "Insert Row Above", "rowAbove");
  t("office.rowBelow", "Insert Row Below", "rowBelow");
  t("office.colLeft", "Insert Column Left", "colLeft");
  t("office.colRight", "Insert Column Right", "colRight");
  t("office.deleteRow", "Delete Row", "deleteRow");
  t("office.deleteCol", "Delete Column", "deleteCol");
  t("office.deleteTable", "Delete Table", "deleteTable");
  t("office.mergeCells", "Merge Cells", "merge");
  t("office.splitCell", "Split Cell", "split");
  t("office.headerRow", "Header Row", "header", { checked: (a) => !!a.officeUI?.editor?.tableContext()?.t.rows[0].header });
  def("office.cellShading", "Cell Shading…", () => dlg().then((m) => m.shadingDialog(app, ws())), { enabled: inTable });
  def("office.tableBorders", "Borders…", () => dlg().then((m) => m.bordersDialog(app, ws())), { enabled: inTable });

  // ---- view
  def("office.printLayout", "Print Layout", () => (ed().setLayout("print"), ws().refreshToolbar()), { checked: (a) => a.officeUI?.prj.view.layout !== "web" });
  def("office.webLayout", "Web Layout", () => (ed().setLayout("web"), ws().refreshToolbar()), { checked: (a) => a.officeUI?.prj.view.layout === "web" });
  def("office.zoomIn", "Zoom In", () => (ed().setZoom((ws().prj.view.zoom || 1) * 1.2), ws().refreshToolbar()), { shortcut: "Mod+=", icon: "zoom-in" });
  def("office.zoomOut", "Zoom Out", () => (ed().setZoom((ws().prj.view.zoom || 1) / 1.2), ws().refreshToolbar()), { shortcut: "Mod+-", icon: "zoom-out" });
  def("office.zoom100", "Actual Size", () => (ed().setZoom(1), ws().refreshToolbar()), { shortcut: "Mod+0" });
  def("office.zoomWidth", "Fit Page Width", () => (ed().zoomToWidth(), ws().refreshToolbar()));
  def("office.showOutline", "Outline", () => ws().showPanel("outline"));
  def("office.showStyles", "Styles Panel", () => ws().showPanel("styles"));
  def("office.spellcheck", "Check Spelling as You Type", (a) => (a.setPref("officeSpellcheck", a.prefs.officeSpellcheck === false), ed()?.relayout()), { checked: (a) => a.prefs.officeSpellcheck !== false, enabled: () => true });
  def("office.darkPage", "Dark Page in Dark Mode", (a) => (a.setPref("officeDarkPage", !a.prefs.officeDarkPage), ed()?.relayout()), { checked: (a) => !!a.prefs.officeDarkPage, enabled: () => true });

  // ---- document
  def("office.pageSetup", "Page Setup…", () => dlg().then((m) => m.pageSetupDialog(app, ws())), { icon: "file-earmark-text" });
  def("office.headerFooter", "Header & Footer…", () => dlg().then((m) => m.headerFooterDialog(app, ws())));
  def("office.properties", "Document Properties…", () => dlg().then((m) => m.propertiesDialog(app, ws())), { icon: "info-circle" });
  def("office.wordCount", "Word Count…", () => dlg().then((m) => m.wordCountDialog(app, ws())), { icon: "123" });
  // every Office kind: the active app's own export dialog, or the suite's generic one (office/services/export.js)
  def("office.export", "Export…", () => import("../office/services/export.js").then((m) => m.officeExportDialog(app)), { icon: "box-arrow-up", enabled: (a) => a.studio === "office" && !!a.doc?.office && !!a.officeUI });
  def("office.home", "Office Home", () => import("../office/host.js").then((m) => m.showOfficeHome(app)), { icon: "house-door", enabled: () => true });
  for (const [f, label] of [["docx", "Word (.docx)"], ["odt", "OpenDocument (.odt)"], ["rtf", "Rich Text (.rtf)"], ["pdf", "PDF (.pdf)"], ["html", "Web Page (.html)"], ["md", "Markdown (.md)"], ["txt", "Plain Text (.txt)"]]) {
    def(`office.export${f[0].toUpperCase()}${f.slice(1)}`, label, () => dlg().then((m) => m.exportOffice(app, ws(), f)));
  }
  def("office.importReport", "Import Report…", (a) => import("../ui/import-dialogs.js").then((m) => m.showImportReport(a.doc.importReport, a)), { enabled: (a) => live(a) && !!a.doc?.importReport });
}
