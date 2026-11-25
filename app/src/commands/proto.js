// Commands of the Proto Studio (docs/proto-studio.md): menus (studios/proto.js ▸ PROTO_MENUS), the canvas context
// menu, the command palette and the keyboard shortcuts. Registered lazily by proto/host.js the first time the studio
// shows, so nothing here is start-up code. Keys that act on the canvas only (arrows, Tab, Enter, Escape, Space, +, −,
// Shift+0/1/2) are handled by the workspace while the canvas has focus; the shortcuts of those commands document them.
import { t, N_ } from "../i18n/index.js";
import { roots as rootIds, pageList } from "../engine/proto/tree.js";
import { isContainer, field } from "../engine/proto/schema.js";
import * as E from "../proto/tools/edit.js";
import { lockedSet } from "../proto/tools/common.js";

let done = false;

export function registerProtoCommands(app) {
  if (done) return;
  done = true;
  const on = (a) => a.studio === "proto" && !!a.protoUI;
  const ws = () => app.protoUI;
  const editable = (a) => on(a) && !a.protoUI.readOnly;
  const hasSel = (a) => editable(a) && a.protoUI.selection.length > 0;
  const single = (a) => hasSel(a) && a.protoUI.selection.length === 1;
  const node = (a) => a.protoUI.model().nodes[a.protoUI.selection[0]];
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: ["proto"], enabled: on, ...extra });
  const runOp = (op, label) => ws().apply(op, label);
  const sel = () => ws().selection;
  const model = () => ws().model();

  // tools (single keys while no text field has focus)
  const tool = (id, label, key, icon) => def(`proto.tool.${id}`, label, () => ws().tools.set(id), { icon, shortcut: key, checked: (a) => on(a) && a.protoUI.tool === id });
  tool("move", "Move Tool", "V", "cursor");
  tool("frame", "Frame Tool", "F", "hash");
  tool("rect", "Rectangle Tool", "R", "square");
  tool("ellipse", "Ellipse Tool", "O", "circle");
  tool("line", "Line Tool", "L", "slash-lg");
  tool("pen", "Pen Tool", "P", "vector-pen");
  tool("text", "Text Tool", "T", "fonts");
  tool("hand", "Hand Tool", "H", "hand-index");
  tool("zoom", "Zoom Tool", "Z", "zoom-in");

  // insert
  def("proto.addFrame", "Desktop Frame", () => ws().addFrame("desktop"), { icon: "display", enabled: editable });
  def("proto.addLaptopFrame", "Laptop Frame", () => ws().addFrame("laptop"), { icon: "laptop", enabled: editable });
  def("proto.addTabletFrame", "Tablet Frame", () => ws().addFrame("tablet"), { icon: "tablet", enabled: editable });
  def("proto.addPhoneFrame", "Phone Frame", () => ws().addFrame("phone"), { icon: "phone", enabled: editable });
  def("proto.addWatchFrame", "Watch Frame", () => ws().addFrame("watch"), { icon: "stopwatch", enabled: editable });
  def("proto.addPage", "New Page", () => addPage(), { icon: "file-earmark-plus", enabled: editable });

  // edit
  def("proto.copy", "Copy", () => ws().copy(), { icon: "copy", enabled: (a) => on(a) && a.protoUI.selection.length > 0, shortcut: "Mod+C" });
  def("proto.cut", "Cut", () => ws().cut(), { icon: "scissors", enabled: hasSel, shortcut: "Mod+X" });
  def("proto.paste", "Paste", () => ws().paste(), { icon: "clipboard", enabled: (a) => editable(a) && a.protoUI.canPaste, shortcut: "Mod+V" });
  def("proto.duplicate", "Duplicate", () => ws().duplicateSelection(), { icon: "copy", enabled: hasSel, shortcut: "Mod+D" });
  def("proto.delete", "Delete", () => ws().deleteSelection(), { icon: "trash", enabled: hasSel, shortcut: "Delete" });
  def("proto.selectAll", "Select All", () => ws().selectAll(), { shortcut: "Mod+A" });
  def("proto.deselect", "Deselect", () => ws().clear(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0 });
  def("proto.selectParent", "Select Parent", () => ws().selectParent(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0, shortcut: "Shift+Enter" });
  def("proto.selectChildren", "Select Children", () => ws().selectChildren(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0 });
  def("proto.rename", "Rename", () => ws().rename(sel()[0]), { icon: "input-cursor-text", enabled: single, shortcut: "F2" });
  def("proto.editText", "Edit Text", () => ws().editText(sel()[0]), { icon: "fonts", enabled: (a) => single(a) && node(a)?.type === "text" });

  // object: layout
  def("proto.autoLayout", "Add Auto Layout", () => runOp(E.autoLayout(model(), sel(), "flex", ws().box), t("Auto layout")), { icon: "layout-three-columns", enabled: hasSel, shortcut: "Shift+A" });
  def("proto.gridLayout", "Add Grid Layout", () => runOp(E.autoLayout(model(), sel(), "grid", ws().box), t("Grid layout")), { icon: "grid-3x3", enabled: hasSel, shortcut: "Mod+Alt+G" });
  def("proto.removeAutoLayout", "Remove Auto Layout", () => runOp(E.batch(sel().map((id) => E.removeAutoLayout(model(), id, ws().box))), t("Remove auto layout")), {
    enabled: (a) => hasSel(a) && a.protoUI.selection.some((id) => ["flex", "grid"].includes(field(a.protoUI.model().nodes[id], "layout")?.type)),
    shortcut: "Alt+Shift+A",
  });
  def("proto.group", "Group Selection", () => runOp(E.group(model(), sel()), t("Group")), { icon: "bounding-box", enabled: hasSel, shortcut: "Mod+G" });
  def("proto.ungroup", "Ungroup", () => ungroup(), { enabled: (a) => hasSel(a) && a.protoUI.selection.some((id) => isContainer(a.protoUI.model().nodes[id]?.type)), shortcut: "Mod+Shift+G" });

  // object: order, visibility, lock
  const order = (where, label) => () => runOp(E.reorder(model(), sel(), where), t(label));
  def("proto.bringToFront", "Bring to Front", order("front", N_("Bring to front")), { enabled: hasSel, shortcut: "Mod+Shift+]" });
  def("proto.bringForward", "Bring Forward", order("forward", N_("Bring forward")), { enabled: hasSel, shortcut: "Mod+]" });
  def("proto.sendBackward", "Send Backward", order("backward", N_("Send backward")), { enabled: hasSel, shortcut: "Mod+[" });
  def("proto.sendToBack", "Send to Back", order("back", N_("Send to back")), { enabled: hasSel, shortcut: "Mod+Shift+[" });
  def("proto.toggleVisible", "Show/Hide", () => {
    const m = model();
    const show = sel().some((id) => m.nodes[id]?.visible === false);
    runOp(E.setFields(m, sel(), { visible: show }), show ? t("Show layers") : t("Hide layers"));
  }, { icon: "eye", enabled: hasSel, shortcut: "Mod+Shift+H" });
  def("proto.toggleLock", "Lock/Unlock", () => {
    const m = model();
    const unlock = sel().some((id) => m.nodes[id]?.locked);
    runOp(E.setFields(m, sel(), { locked: !unlock }), unlock ? t("Unlock layers") : t("Lock layers"));
    if (!unlock) ws().clear();
  }, { icon: "lock", enabled: hasSel, shortcut: "Mod+Shift+L" });

  // view
  def("proto.zoomIn", "Zoom In", () => ws().zoomIn(), { icon: "zoom-in" });
  def("proto.zoomOut", "Zoom Out", () => ws().zoomOut(), { icon: "zoom-out" });
  def("proto.zoom100", "Actual Size", () => ws().zoomTo(1), { shortcut: "Shift+0" });
  def("proto.zoomFit", "Zoom to Fit", () => ws().zoomToFit(), { icon: "arrows-expand", shortcut: "Shift+1" });
  def("proto.zoomSelection", "Zoom to Selection", () => ws().zoomToSelection(), { enabled: (a) => on(a) && a.protoUI.selection.length > 0, shortcut: "Shift+2" });

  function addPage() {
    const w = ws();
    const res = w.apply({ op: "page.create", name: t("Page {n}", { n: pageList(w.model()).length + 1 }) }, t("Add page"));
    if (res?.ids?.[0]) w.setPage(res.ids[0]);
  }

  function ungroup() {
    const m = model();
    const ids = rootIds(m, sel()).filter((id) => isContainer(m.nodes[id]?.type) && !lockedSet(m).has(id));
    const kids = ids.flatMap((id) => [...(m.nodes[id] ? Object.values(m.nodes).filter((n) => n.parent === id).map((n) => n.id) : [])]);
    const op = E.batch(ids.map((id) => E.ungroup(m, id, ws().box)));
    if (runOp(op, t("Ungroup"))) ws().select(kids);
  }

  app.emit("commands");
}
