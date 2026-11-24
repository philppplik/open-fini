// Commands of the Proto Studio (docs/proto-studio.md): menus (studios/proto.js ▸ PROTO_MENUS) and the command palette.
// Registered lazily by proto/host.js the first time the studio shows, so nothing here is start-up code. Single keys
// (Delete, Enter, Escape, +, -, Shift+1 …) are handled by the workspace while the canvas has focus; the shortcuts
// listed here only document them. The tools and the Design panel add their commands with T4.
let done = false;

export function registerProtoCommands(app) {
  if (done) return;
  done = true;
  const on = (a) => a.studio === "proto" && !!a.protoUI;
  const ws = () => app.protoUI;
  const editable = (a) => on(a) && !a.protoUI.readOnly;
  const hasSel = (a) => editable(a) && a.protoUI.selection.length > 0;
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: ["proto"], enabled: on, ...extra });

  def("proto.addFrame", "Desktop Frame", () => ws().addFrame("desktop"), { icon: "display", enabled: editable });
  def("proto.addPhoneFrame", "Phone Frame", () => ws().addFrame("phone"), { icon: "phone", enabled: editable });
  def("proto.duplicate", "Duplicate", () => ws().duplicateSelection(), { icon: "copy", enabled: hasSel, shortcut: "Mod+D" });
  def("proto.delete", "Delete", () => ws().deleteSelection(), { icon: "trash", enabled: hasSel, shortcut: "Delete" });
  def("proto.selectAll", "Select All", () => ws().selectAll(), { shortcut: "Mod+A" });
  def("proto.deselect", "Deselect", () => ws().clear(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0 });
  def("proto.selectParent", "Select Parent", () => ws().selectParent(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0 });
  def("proto.selectChildren", "Select Children", () => ws().selectChildren(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0 });
  def("proto.zoomIn", "Zoom In", () => ws().zoomIn(), { icon: "zoom-in" });
  def("proto.zoomOut", "Zoom Out", () => ws().zoomOut(), { icon: "zoom-out" });
  def("proto.zoom100", "Actual Size", () => ws().zoomTo(1), { shortcut: "Shift+0" });
  def("proto.zoomFit", "Zoom to Fit", () => ws().zoomToFit(), { icon: "arrows-expand", shortcut: "Shift+1" });
  def("proto.zoomSelection", "Zoom to Selection", () => ws().zoomToSelection(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0, shortcut: "Shift+2" });
  app.emit("commands");
}
