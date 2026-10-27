// Edit, arrange, shape and view commands.
import * as ops from "../core/ops.js";
import { topLevelSelection } from "../core/ops.js";
import { translate } from "../core/math.js";
import { createCanvas, ctx2d } from "../core/doc.js";
import { paintTarget, layerSpaceMask, newPixelLayer } from "../core/pixel.js";

const hasDoc = (a) => !!a.doc;
const hasSel = (a) => !!a.doc && a.selection.length > 0;
const multi = (n) => (a) => !!a.doc && topLevelSelection(a).length >= n;

export function registerEditCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });

  // ---- history & clipboard
  def("edit.undo", "Undo", (a) => (a.studio === "code" && a.codeUI?.built ? a.codeUI.undo() : a.doc.undo()), { shortcut: "Mod+Z", enabled: (a) => (a.studio === "code" && a.codeUI?.built ? a.codeUI.canUndo() : !!a.doc?.history.canUndo), icon: "arrow-counterclockwise" });
  def("edit.redo", "Redo", (a) => (a.studio === "code" && a.codeUI?.built ? a.codeUI.redo() : a.doc.redo()), { shortcut: "Mod+Shift+Z", altShortcut: "Mod+Y", enabled: (a) => (a.studio === "code" && a.codeUI?.built ? a.codeUI.canRedo() : !!a.doc?.history.canRedo), icon: "arrow-clockwise" });
  // pixel selections copy as pixels (a rectangular crop of the layer with the selection as its alpha)
  const pixelSel = (a) => a.studio === "pixel" && !!a.state?.pixelMask && a.activeNode?.type === "pixel";
  const copyPixels = (a) => {
    const t = paintTarget(a, { create: false });
    const sel = t && layerSpaceMask(a, t);
    if (!t || !sel) return false;
    const m = a.state.pixelMask;
    const b = m.bounds();
    if (!b) return false;
    // selection bounds are page space; work in layer space via the layer-space mask canvas
    const W = t.canvas.width;
    const H = t.canvas.height;
    const work = createCanvas(W, H);
    const ctx = ctx2d(work);
    ctx.drawImage(t.canvas, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(sel, 0, 0);
    const [x0, y0] = [Math.max(0, Math.floor(t.inv[0] * b.x + t.inv[2] * b.y + t.inv[4])), Math.max(0, Math.floor(t.inv[1] * b.x + t.inv[3] * b.y + t.inv[5]))];
    const w = Math.min(W - x0, Math.ceil(b.width / t.scale));
    const h = Math.min(H - y0, Math.ceil(b.height / t.scale));
    if (w < 1 || h < 1) return false;
    const out = createCanvas(w, h);
    ctx2d(out).drawImage(work, x0, y0, w, h, 0, 0, w, h);
    a.clip = { kind: "pixels", canvas: out, x: b.x, y: b.y };
    a.emit("clipboard");
    return true;
  };
  def("edit.copy", "Copy", (a) => {
    if (a.tool?.copy?.()) return;
    if (pixelSel(a) && copyPixels(a)) return;
    ops.copySelection(a);
  }, { shortcut: "Mod+C", enabled: hasSel });
  def("edit.cut", "Cut", (a) => {
    if (a.tool?.cut?.()) return;
    if (pixelSel(a)) {
      if (copyPixels(a)) a.run("pixel.clearSelection");
      return;
    }
    if (ops.copySelection(a)) ops.deleteSelection(a);
  }, { shortcut: "Mod+X", enabled: hasSel });
  const pastePixels = (a, inPlace) => {
    const c = a.clip;
    const layer = newPixelLayer(a, { name: "Pasted", w: c.canvas.width, h: c.canvas.height });
    const copy = createCanvas(c.canvas.width, c.canvas.height);
    ctx2d(copy).drawImage(c.canvas, 0, 0);
    a.doc.pixels.set(layer.id, copy);
    const off = inPlace ? 0 : 16;
    layer.m = translate(c.x + off, c.y + off);
    a.doc.touch(layer);
    a.requestRender();
  };
  def("edit.paste", "Paste", async (a) => {
    if (a.tool?.paste?.()) return;
    if (a.clip?.kind === "pixels") return pastePixels(a, false);
    if (a.clip) return ops.pasteClipboard(a);
    return a.run("file.pasteSystem");
  }, { shortcut: "Mod+V", enabled: hasDoc });
  def("edit.pasteInPlace", "Paste in Place", (a) => (a.clip?.kind === "pixels" ? pastePixels(a, true) : ops.pasteClipboard(a, { inPlace: true })), { shortcut: "Mod+Shift+V", enabled: (a) => !!a.doc && !!a.clip });
  def("edit.duplicate", "Duplicate", (a) => ops.duplicateSelection(a, { offset: 0 }), { shortcut: "Mod+J", enabled: hasSel });
  def("edit.delete", "Delete", (a) => {
    if (a.tool?.deleteSelected?.()) return;
    if (a.studio === "pixel" && a.state?.pixelMask && a.activeNode?.type === "pixel") return a.run("pixel.clearSelection");
    ops.deleteSelection(a);
  }, { shortcut: "Delete", altShortcut: "Backspace", enabled: hasSel });
  def("edit.selectAll", "Select All", (a) => {
    if (a.studio === "pixel" && a.activeNode?.type === "pixel") return a.run("select.all");
    a.select(a.context.children.filter((n) => n.visible && !n.locked));
  }, { shortcut: "Mod+A", enabled: hasDoc });
  def("edit.deselect", "Deselect", (a) => {
    if (a.state?.pixelMask) return a.run("select.none");
    a.clearSelection();
  }, { shortcut: "Mod+D", enabled: hasDoc });
  def("edit.preferences", "Settings…", (a) => a.emit("dialog", { id: "preferences" }), { shortcut: "Mod+,", icon: "gear" });
  // deep link: app.run("settings.open", { section: "ai", tab: "models" })
  def("settings.open", "Open Settings Section…", (a, args) => a.emit("dialog", { id: "preferences", section: args?.section, tab: args?.tab }), { icon: "gear" });

  // ---- arrange
  def("arrange.group", "Group", (a) => ops.groupSelection(a), { shortcut: "Mod+G", enabled: hasSel, icon: "collection" });
  def("arrange.ungroup", "Ungroup", (a) => ops.ungroupSelection(a), { shortcut: "Mod+Shift+G", enabled: (a) => topLevelSelection(a).some((n) => n.type === "group") });
  def("arrange.front", "Bring to Front", (a) => ops.arrange(a, "front"), { shortcut: "Mod+Shift+]", enabled: hasSel, icon: "layer-forward" });
  def("arrange.forward", "Bring Forward", (a) => ops.arrange(a, "forward"), { shortcut: "Mod+]", enabled: hasSel });
  def("arrange.backward", "Send Backward", (a) => ops.arrange(a, "backward"), { shortcut: "Mod+[", enabled: hasSel });
  def("arrange.back", "Send to Back", (a) => ops.arrange(a, "back"), { shortcut: "Mod+Shift+[", enabled: hasSel, icon: "layer-backward" });
  def("arrange.lock", "Lock", (a) => ops.toggleFlag(a, "locked"), { shortcut: "Mod+L", enabled: hasSel, icon: "lock" });
  def("arrange.hide", "Hide / Show", (a) => ops.toggleFlag(a, "visible"), { shortcut: "Mod+Shift+H", enabled: hasSel, icon: "eye-slash" });

  for (const [id, label, icon] of [
    ["left", "Align Left", "align-start"], ["centerH", "Align Center", "align-center"], ["right", "Align Right", "align-end"],
    ["top", "Align Top", "align-top"], ["centerV", "Align Middle", "align-middle"], ["bottom", "Align Bottom", "align-bottom"],
  ]) def(`align.${id}`, label, (a) => ops.align(a, id), { enabled: hasSel, icon: `of:${icon}` });
  def("distribute.h", "Distribute Horizontally", (a) => ops.distribute(a, "h"), { enabled: multi(3), icon: "distribute-horizontal" });
  def("distribute.v", "Distribute Vertically", (a) => ops.distribute(a, "v"), { enabled: multi(3), icon: "distribute-vertical" });
  def("arrange.flipH", "Flip Horizontal", (a) => ops.flip(a, "h"), { enabled: hasSel, icon: "symmetry-vertical" });
  def("arrange.flipV", "Flip Vertical", (a) => ops.flip(a, "v"), { enabled: hasSel, icon: "symmetry-horizontal" });
  def("arrange.rotateCW", "Rotate 90° Clockwise", (a) => ops.rotateSelection(a, 90), { enabled: hasSel, icon: "arrow-clockwise" });
  def("arrange.rotateCCW", "Rotate 90° Counter-clockwise", (a) => ops.rotateSelection(a, -90), { enabled: hasSel, icon: "arrow-counterclockwise" });

  // ---- shape operations
  def("shape.convert", "Convert to Curves", (a) => ops.convertToCurves(a), { shortcut: "Mod+Enter", enabled: hasSel });
  def("shape.expandStroke", "Expand Stroke", (a) => ops.expandStrokeOp(a), { enabled: hasSel });
  for (const [op, label, icon] of [
    ["union", "Add", "union"], ["subtract", "Subtract", "subtract"], ["intersect", "Intersect", "intersect"], ["xor", "Exclude", "exclude"], ["divide", "Divide", "divide"],
  ]) def(`bool.${op}`, label, (a) => ops.booleanOp(a, op), { enabled: multi(2), icon: icon === "divide" ? "of:divide" : icon });

  // ---- view
  def("view.zoomIn", "Zoom In", (a) => zoomStep(a, 1), { shortcut: "Mod+=", altShortcut: "Mod++", enabled: hasDoc, icon: "zoom-in" });
  def("view.zoomOut", "Zoom Out", (a) => zoomStep(a, -1), { shortcut: "Mod+-", enabled: hasDoc, icon: "zoom-out" });
  def("view.zoom100", "Actual Size (100%)", (a) => a.cv?.setZoom(1), { shortcut: "Mod+1", enabled: hasDoc });
  def("view.zoom200", "200%", (a) => a.cv?.setZoom(2), { shortcut: "Mod+2", enabled: hasDoc });
  def("view.fit", "Fit Page", (a) => a.cv?.fitPage(), { shortcut: "Mod+0", enabled: hasDoc });
  def("view.fitAll", "Fit All Pages", (a) => a.cv?.fitAll(), { shortcut: "Mod+Alt+0", enabled: hasDoc });
  def("view.fitSelection", "Zoom to Selection", (a) => a.cv?.fitSelection(), { shortcut: "Mod+Shift+0", enabled: hasDoc });
  def("view.rulers", "Rulers", (a) => a.setPref("rulers", !a.prefs.rulers), { shortcut: "Mod+R", checked: (a) => a.prefs.rulers });
  def("view.grid", "Grid", (a) => toggleSetting(a, "grid"), { shortcut: "Mod+'", checked: (a) => !!a.doc?.settings.grid?.visible, enabled: hasDoc });
  def("view.guides", "Guides", (a) => {
    a.doc.settings.guidesVisible = a.doc.settings.guidesVisible === false;
    a.requestRender();
  }, { shortcut: "Mod+;", checked: (a) => a.doc?.settings.guidesVisible !== false, enabled: hasDoc });
  def("view.snapping", "Snapping", (a) => {
    a.doc.settings.snap = a.doc.settings.snap === false;
    a.emit("docchange", {});
  }, { checked: (a) => a.doc?.settings.snap !== false, enabled: hasDoc });
  def("view.snapGrid", "Snap to Grid", (a) => (a.doc.settings.snapGrid = !a.doc.settings.snapGrid), { checked: (a) => !!a.doc?.settings.snapGrid, enabled: hasDoc });
  def("view.clipContent", "Clip Content to Page", (a) => a.setPref("clipContent", !(a.prefs.clipContent ?? a.doc?.studio !== "vector")), { checked: (a) => a.prefs.clipContent ?? a.doc?.studio !== "vector" });
  def("view.theme", "Toggle Light / Dark", (a) => a.setPref("theme", a.prefs.theme === "dark" ? "light" : "dark"));
  def("view.lowPower", "Low-power Mode", (a) => a.setPref("lowPower", a.perf.low ? "off" : "on"), { checked: (a) => a.perf.low });
  // studio.<id> commands and Alt+N shortcuts: commands/studios.js (derived from the studio registry)
}

function zoomStep(a, dir) {
  const v = a.view;
  if (!v) return;
  a.cv.setZoom(v.nextStep(dir));
}

function toggleSetting(a, key) {
  const s = a.doc.settings[key];
  s.visible = !s.visible;
  a.requestRender();
  a.emit("docchange", {});
}
