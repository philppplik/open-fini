// Code studio commands (palette, views, files, breakpoints, element editing). They only exist in the Code studio:
// `studios: ["code"]` keeps their shortcuts from clashing with the design studios' commands.
import { exportDialog } from "../ui/export-dialog.js";

export function registerCodeCommands(app) {
  const ws = () => app.codeUI;
  const live = (a) => a.studio === "code" && !!a.codeUI?.built;
  const sel = (a) => live(a) && !!a.codeUI.selection;
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: ["code"], enabled: live, ...extra });

  // ---- navigation
  def("code.palette", "Show All Commands", () => ws().palette(), { shortcut: "Mod+Shift+P", icon: "terminal" });
  def("code.quickOpen", "Go to File…", () => ws().quickOpen(), { shortcut: "Mod+P", icon: "search" });
  def("code.gotoLine", "Go to Line…", () => ws().editors.gotoLine(), { shortcut: "Mod+G" });
  def("code.gotoElement", "Go to Element…", () => ws().openPalette("#"), { shortcut: "Mod+Shift+O", icon: "diagram-3" });
  def("code.findInFiles", "Find in Files", () => ws().showSide("search"), { shortcut: "Mod+Shift+F", icon: "search" });
  def("code.find", "Find in File", () => ws().editors.find(), { shortcut: "Mod+F" });
  def("code.closeTab", "Close Editor", () => ws().editors.active && ws().editors.close(ws().editors.active), { shortcut: "Mod+W", enabled: (a) => live(a) && !!a.codeUI.editors.active });
  def("code.closeAllTabs", "Close All Editors", () => ws().editors.closeAll());

  // ---- views and panels
  def("code.viewDesign", "Design View", () => ws().setView("design"), { shortcut: "Mod+Alt+1", checked: (a) => a.codeUI?.view === "design", icon: "palette2" });
  def("code.viewSplit", "Split View", () => ws().setView("split"), { shortcut: "Mod+Alt+2", checked: (a) => a.codeUI?.view === "split", icon: "layout-split" });
  def("code.viewCode", "Code View", () => ws().setView("code"), { shortcut: "Mod+Alt+3", checked: (a) => a.codeUI?.view === "code", icon: "code-slash" });
  def("code.toggleSidebar", "Toggle Sidebar", () => ws().toggleSidebar(), { shortcut: "Mod+B", icon: "layout-sidebar" });
  def("code.toggleBottom", "Toggle Console and Problems", () => ws().bottom.toggle(), { shortcut: "Mod+J", icon: "layout-text-window-reverse" });
  def("code.showExplorer", "Show Explorer", () => ws().showSide("explorer"), { icon: "files" });
  def("code.showAdd", "Show Add Elements", () => ws().showSide("add"), { icon: "plus-square" });
  def("code.showNavigator", "Show Navigator", () => ws().showSide("outline"), { icon: "diagram-3" });
  def("code.showAssets", "Show Assets", () => ws().showSide("assets"), { icon: "images" });
  def("code.problems", "Show Problems", () => ws().bottom.show("problems"), { icon: "exclamation-triangle" });
  def("code.console", "Show Console", () => ws().bottom.show("console"), { icon: "terminal" });
  def("code.previewMode", "Toggle Design Mode / Live Preview", () => ws().preview.setMode(!ws().preview.edit), { shortcut: "Mod+Alt+P", icon: "play-circle" });
  def("code.reload", "Reload Preview", () => ws().preview.rebuild(), { shortcut: "Mod+Alt+R", icon: "arrow-repeat" });
  def("code.wordWrap", "Toggle Word Wrap", () => ws().editors.setWordWrap(!ws().web.settings.wordWrap), { shortcut: "Alt+Z", checked: (a) => !!a.codeUI?.web?.settings.wordWrap });
  def("code.spacingGuides", "Toggle Margin and Padding Guides", () => ws().toggleSpacingGuides(), { checked: (a) => a.codeUI?.spacingGuides !== false });
  def("code.zoomFit", "Preview Zoom: Fit", () => ws().preview.setZoom("fit"));
  def("code.zoomIn", "Preview Zoom In", () => ws().preview.setZoom(Math.min(4, +(ws().preview.scale + 0.25).toFixed(2))), { shortcut: "Mod+=" });
  def("code.zoomOut", "Preview Zoom Out", () => ws().preview.setZoom(Math.max(0.1, +(ws().preview.scale - 0.25).toFixed(2))), { shortcut: "Mod+-" });
  def("code.zoom100", "Preview Zoom: 100%", () => ws().preview.setZoom(1), { shortcut: "Mod+1" });
  for (const [id, label] of [["desktop-2xl", "Desktop 1920"], ["desktop-xl", "Desktop 1440"], ["desktop", "Desktop"], ["tablet", "Tablet"], ["mobile-landscape", "Mobile Landscape"], ["mobile-portrait", "Mobile Portrait"]]) {
    def(`code.bp.${id}`, `Breakpoint: ${label}`, () => ws().preview.setBreakpoint(id), { checked: (a) => a.codeUI?.preview?.bp.id === id });
  }

  // ---- files
  def("code.newFile", "New File…", () => ws().explorer.newFile(), { shortcut: "Mod+Alt+N", icon: "file-earmark-plus" });
  def("code.upload", "Upload Files…", () => ws().explorer.upload(), { icon: "upload" });
  def("code.importFolder", "Import Website Folder…", () => ws().explorer.importFolder(), { icon: "folder2-open" });
  def("code.setHome", "Set Current Page as Home Page", () => ws().web.setEntry(ws().page), { enabled: (a) => live(a) && !!a.codeUI.page && a.codeUI.page !== a.codeUI.web.entry });
  def("code.publish", "Export Website…", (a) => exportDialog(a, { tab: "website" }), { icon: "globe2" });

  // ---- libraries, documents (Markdown, LaTeX) and Markdown sites
  def("code.libraries", "Libraries…", () => import("../ui/code/libraries-ui.js").then((m) => m.openLibrariesDialog(ws())), { icon: "stack" });
  def("code.showLibraries", "Show Libraries", () => ws().showSide("libs"), { icon: "stack" });
  const docKind = (a) => live(a) && !!a.codeUI.documentKind;
  def("code.docExportHtml", "Document: Export Preview as HTML Page", () => ws().docPreview.exportToProject(), { enabled: docKind, icon: "code-slash" });
  def("code.docPrint", "Document: Print or Save Preview as PDF", () => ws().docPreview.print(), { enabled: docKind, icon: "file-earmark-text" });
  def("code.docSave", "Document: Save This File to Your Computer…", () => ws().docPreview.saveSource(), { enabled: docKind, icon: "download" });
  def("code.buildMarkdownSite", "Build Pages from Markdown (content/ and layouts/)", () => import("../ui/code/mdsite.js").then((m) => m.buildNow(ws(), { toast: true })), { icon: "journal-text", enabled: (a) => live(a) && a.codeUI.web.paths.some((p) => p.startsWith("content/")) });
  def("code.newMarkdown", "New Markdown Document", () => import("../ui/code/mdsite.js").then((m) => m.newDocument(ws(), "md")), { icon: "filetype-md" });
  def("code.newLatex", "New LaTeX Document", () => import("../ui/code/mdsite.js").then((m) => m.newDocument(ws(), "tex")), { icon: "file-earmark-text" });

  // ---- editing
  def("code.format", "Format Document", () => ws().editors.format(), { shortcut: "Shift+Alt+F", icon: "text-indent-left" });
  def("code.toggleComment", "Toggle Line Comment", () => ws().editors.toggleComment(), { shortcut: "Mod+/" });
  def("code.foldAll", "Fold All", () => ws().editors.foldAll());
  def("code.unfoldAll", "Unfold All", () => ws().editors.unfoldAll());
  def("code.undo", "Undo", () => ws().undo(), { shortcut: "Mod+Z", icon: "arrow-counterclockwise", enabled: (a) => live(a) && a.codeUI.canUndo() });
  def("code.redo", "Redo", () => ws().redo(), { shortcut: "Mod+Shift+Z", altShortcut: "Mod+Y", icon: "arrow-clockwise", enabled: (a) => live(a) && a.codeUI.canRedo() });
  def("code.cut", "Cut", () => (ws().editors.hasFocus() ? document.execCommand("cut") : ws().cutSelected()), { shortcut: "Mod+X" });
  def("code.copy", "Copy", () => (ws().editors.hasFocus() ? document.execCommand("copy") : ws().copySelected()), { shortcut: "Mod+C" });
  def("code.paste", "Paste", async () => {
    if (ws().editors.hasFocus()) {
      const text = await navigator.clipboard.readText().catch(() => "");
      const v = ws().editors.view;
      if (text && v) v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true });
    } else ws().pasteElement();
  }, { shortcut: "Mod+V" });
  def("code.duplicateElement", "Duplicate Element", () => ws().duplicateSelected(), { shortcut: "Mod+D", enabled: sel, icon: "files" });
  def("code.deleteElement", "Delete Element", () => ws().deleteSelected(), { shortcut: "Delete", altShortcut: "Backspace", enabled: sel, icon: "trash3" });
  def("code.selectParent", "Select Parent Element", () => ws().selectParent(), { enabled: sel });
  def("code.selectChild", "Select First Child Element", () => ws().selectChild(), { enabled: sel });
  def("code.wrapDiv", "Wrap Element in Div", () => ws().wrapSelected("div"), { enabled: sel });
  def("code.unwrap", "Unwrap Element", () => ws().unwrapSelected(), { enabled: sel });
  def("code.showInCode", "Show Selected Element in Code", () => ws().revealInCode(ws().selection.id), { enabled: sel, icon: "code-slash" });

  // ---- Insert menu: the element catalog (built lazily so the engine stays out of the shell bundle)
  app.menuProviders ||= {};
  app.menuProviders.elements = (a) => {
    const ws2 = a.codeUI;
    const cats = ws2?.built ? ws2.elementCategories?.() : null;
    if (!cats) return [];
    return cats.map((c) => ({ label: c.label, items: c.items.map((i) => ({ label: i.label, icon: i.icon, run: () => ws2.insertElement(i) })) }));
  };
}
