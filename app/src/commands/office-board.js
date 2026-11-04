// Commands of the Whiteboard app (Office Suite kind "board", docs/office-board.md): menus (studios/office.js ▸
// OFFICE_MENUS with officeKinds ["board"]), the command palette and the context menu of the canvas. Registered lazily
// by office/board/view.js the first time a whiteboard mounts, so nothing here is start-up code. Keyboard shortcuts are
// handled by the canvas itself while it has focus (single-key tools, Delete, Mod+D/G/A …), so the commands carry no
// global shortcuts that could collide with the word processor's.
import { registerContextProvider } from "../ui/context-menu/index.js";

const S = ["office"];
let done = false;

export function registerBoardCommands(app) {
  if (done) return;
  done = true;
  const on = (a) => a.studio === "office" && a.officeUI?.kind === "board";
  const b = () => app.officeUI;
  const hasSel = (n = 1) => (a) => on(a) && a.officeUI.selection.length >= n;
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: S, enabled: on, ...extra });
  const exp = (id) => () => import("../office/services/export.js").then((m) => m.exportOfficeDoc(app, app.doc, id));

  // tools
  def("board.toolSelect", "Select Tool", () => b().setTool("select"), { icon: "cursor" });
  def("board.toolHand", "Hand Tool", () => b().setTool("hand"), { icon: "hand-index-thumb" });
  def("board.toolPen", "Pen", () => b().setTool("pen"), { icon: "pen" });
  def("board.toolHighlighter", "Highlighter", () => b().setTool("highlighter"), { icon: "brush" });
  def("board.toolEraser", "Eraser", () => b().setTool("eraser"), { icon: "eraser" });
  def("board.toolLaser", "Laser Pointer", () => b().setTool("laser"), { icon: "record" });
  def("board.toolRect", "Rectangle", () => b().setTool("rect"), { icon: "square" });
  def("board.toolEllipse", "Ellipse", () => b().setTool("ellipse"), { icon: "circle" });
  def("board.toolDiamond", "Diamond", () => b().setTool("diamond"), { icon: "diamond" });
  def("board.toolLine", "Line", () => b().setTool("line"), { icon: "slash-lg" });
  def("board.toolArrow", "Arrow (Connector)", () => b().setTool("arrow"), { icon: "arrow-right" });
  def("board.toolText", "Text", () => b().setTool("text"), { icon: "fonts" });
  def("board.toolSticky", "Sticky Note", () => b().setTool("sticky"), { icon: "sticky" });
  def("board.toolFrame", "Frame", () => b().setTool("frame"), { icon: "bounding-box" });
  def("board.insertImage", "Image…", () => b().insertImage(), { icon: "image" });

  // edit
  def("board.cut", "Cut", () => b().cut(), { icon: "scissors", enabled: hasSel() });
  def("board.copy", "Copy", () => b().copy(), { icon: "files", enabled: hasSel() });
  def("board.paste", "Paste", () => b().paste(), { icon: "clipboard" });
  def("board.duplicate", "Duplicate", () => b().duplicate(), { icon: "copy", enabled: hasSel() });
  def("board.delete", "Delete", () => b().deleteSelection(), { icon: "trash", enabled: hasSel() });
  def("board.selectAll", "Select All", (a) => a.officeUI.select(a.doc.office.model ? Object.values(a.doc.office.model.elements).filter((e) => e.page === a.officeUI.page).map((e) => e.id) : []));
  def("board.editText", "Edit Text", () => b().editText(), { icon: "pencil", enabled: hasSel() });

  // arrange
  def("board.bringFront", "Bring to Front", () => b().order("front"), { icon: "front", enabled: hasSel() });
  def("board.bringForward", "Bring Forward", () => b().order("forward"), { icon: "layer-forward", enabled: hasSel() });
  def("board.sendBackward", "Send Backward", () => b().order("backward"), { icon: "layer-backward", enabled: hasSel() });
  def("board.sendBack", "Send to Back", () => b().order("back"), { icon: "back", enabled: hasSel() });
  def("board.group", "Group", () => b().group(), { icon: "collection", enabled: hasSel(2) });
  def("board.ungroup", "Ungroup", () => b().ungroup(), { icon: "view-stacked", enabled: hasSel() });
  def("board.alignLeft", "Align Left", () => b().align("left"), { icon: "align-start", enabled: hasSel(2) });
  def("board.alignCenter", "Align Centers", () => b().align("center"), { icon: "align-center", enabled: hasSel(2) });
  def("board.alignRight", "Align Right", () => b().align("right"), { icon: "align-end", enabled: hasSel(2) });
  def("board.alignTop", "Align Top", () => b().align("top"), { icon: "align-top", enabled: hasSel(2) });
  def("board.alignMiddle", "Align Middles", () => b().align("middle"), { icon: "align-middle", enabled: hasSel(2) });
  def("board.alignBottom", "Align Bottom", () => b().align("bottom"), { icon: "align-bottom", enabled: hasSel(2) });
  def("board.distributeH", "Distribute Horizontally", () => b().distribute("horizontal"), { icon: "distribute-horizontal", enabled: hasSel(3) });
  def("board.distributeV", "Distribute Vertically", () => b().distribute("vertical"), { icon: "distribute-vertical", enabled: hasSel(3) });
  def("board.arrangeGrid", "Arrange in a Grid", () => b().arrange("grid"), { icon: "grid-3x3-gap" });
  def("board.arrangeFlow", "Arrange as Flowchart", () => b().arrange("flow"), { icon: "diagram-3" });
  def("board.lock", "Lock or Unlock", () => b().toggleLock(), { icon: "lock", enabled: hasSel() });

  // view
  def("board.zoomIn", "Zoom In", () => b().zoomBy(1.25), { icon: "zoom-in" });
  def("board.zoomOut", "Zoom Out", () => b().zoomBy(1 / 1.25), { icon: "zoom-out" });
  def("board.zoom100", "Actual Size", () => b().zoomTo(1));
  def("board.zoomFit", "Zoom to Fit", () => b().fit(), { icon: "arrows-expand" });
  def("board.toggleGrid", "Show Grid", () => b().toggleGrid(), { icon: "grid-3x3", checked: (a) => on(a) && a.officeUI.isGrid() });
  def("board.toggleSnap", "Snap to Grid", () => b().toggleSnap(), { icon: "magnet", checked: (a) => on(a) && a.officeUI.isSnap() });
  def("board.toggleRough", "Hand-Drawn Style", () => b().toggleRough(), { icon: "feather" });

  // pages and export
  def("board.addPage", "Add Page", () => b().addPage(), { icon: "file-earmark-plus" });
  def("board.renamePage", "Rename Page…", () => b().renamePage());
  def("board.deletePage", "Delete Page", () => b().deletePage(), { icon: "trash", enabled: (a) => on(a) && a.doc.office.model.pages.length > 1 });
  def("board.nextPage", "Next Page", () => b().gotoPage(1), { icon: "chevron-right" });
  def("board.prevPage", "Previous Page", () => b().gotoPage(-1), { icon: "chevron-left" });
  def("board.exportExcalidraw", "Excalidraw (.excalidraw)…", exp("excalidraw"));
  def("board.exportTldraw", "tldraw (.tldraw)…", exp("tldraw"));
  def("board.exportPng", "PNG Image (Current Page)…", exp("png"));
  def("board.exportSvg", "SVG Image (Current Page)…", exp("svg"));
  def("board.exportPdf", "PDF (All Pages)…", exp("pdf"));
  app.emit("commands");

  registerContextProvider({
    id: "office.board",
    priority: 50,
    matches: (c) => c.kind === "office-board" && !!c.data?.board,
    items: (c) => {
      const brd = c.data.board;
      if (c.data.page) return [{ label: "Rename page…", icon: "pencil", run: () => brd.renamePage(c.data.page) }, { label: "Add page", icon: "file-earmark-plus", run: () => brd.addPage() }, { label: "Delete page", icon: "trash", disabled: c.data.doc.office.model.pages.length < 2, run: () => brd.deletePage(c.data.page) }];
      const n = brd.selection.length;
      if (!n)
        return [
          { label: "Paste", icon: "clipboard", run: () => brd.paste() },
          { label: "Select all", run: () => app.run("board.selectAll") },
          "-",
          { label: "Add sticky note", icon: "sticky", run: () => brd.setTool("sticky") },
          { label: "Insert image…", icon: "image", run: () => brd.insertImage() },
          "-",
          { label: "Arrange as flowchart", icon: "diagram-3", run: () => brd.arrange("flow") },
          { label: "Zoom to fit", icon: "arrows-expand", run: () => brd.fit() },
        ];
      return [
        { label: "Edit text", icon: "pencil", hidden: n !== 1, run: () => brd.editText() },
        { label: "Cut", icon: "scissors", run: () => brd.cut() },
        { label: "Copy", icon: "files", run: () => brd.copy() },
        { label: "Duplicate", icon: "copy", run: () => brd.duplicate() },
        { label: "Delete", icon: "trash", run: () => brd.deleteSelection() },
        "-",
        { label: "Bring to front", icon: "front", run: () => brd.order("front") },
        { label: "Send to back", icon: "back", run: () => brd.order("back") },
        { label: "Group", icon: "collection", hidden: n < 2, run: () => brd.group() },
        { label: "Ungroup", icon: "view-stacked", run: () => brd.ungroup() },
        { label: "Lock or unlock", icon: "lock", run: () => brd.toggleLock() },
        "-",
        { label: "Add comment…", icon: "chat-quote", hidden: n !== 1, run: () => app.run("collab.addComment") },
      ];
    },
  });
}
