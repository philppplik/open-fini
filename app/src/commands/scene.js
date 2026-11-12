// Commands of the Scene Studio (docs/scene-studio.md): menus (studios/scene.js ▸ SCENE_MENUS) and the command palette.
// Registered lazily by scene/view.js the first time a scene mounts, so nothing here is start-up code. Single-key
// shortcuts (Space, J/K/L, I/O, C/V …) are handled by the workspace while it has focus; the commands only document
// them, so they never collide with the shortcuts of other studios.
import * as M from "../scene/model.js";

let done = false;

export function registerSceneCommands(app) {
  if (done) return;
  done = true;
  const on = (a) => a.studio === "scene" && !!a.sceneUI;
  const s = () => app.sceneUI;
  const hasSel = (a) => on(a) && a.sceneUI.selection().length > 0;
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: ["scene"], enabled: on, ...extra });

  def("scene.import", "Import Media…", () => s().importDialog(), { icon: "plus-lg" });
  def("scene.export", "Export Video…", () => import("../scene/export-dialog.js").then((m) => m.sceneExportDialog(app)), { icon: "box-arrow-up" });
  def("scene.addText", "Add Text", () => s().addText(), { icon: "fonts" });
  def("scene.addShape", "Add Shape", () => s().addShape("rect"), { icon: "square" });
  def("scene.addSolid", "Add Solid", () => s().addSolid(), { icon: "palette" });
  def("scene.addAdjustment", "Add Adjustment Layer", () => s().addAdjustment(), { icon: "layers-half" });
  def("scene.precompose", "Pre-compose", () => s().precompose(), { icon: "collection", enabled: hasSel });
  const oneComp = (a) => {
    const ids = on(a) ? a.sceneUI.selection() : [];
    return ids.length === 1 && a.sceneUI.seqModel().clips[ids[0]]?.type === "comp";
  };
  def("scene.openComposition", "Open Composition", () => s().openCompClip(s().selection()[0]), { enabled: oneComp });
  def("scene.timeRemap", "Time Remapping", () => {
    const ui = s();
    const id = ui.selection()[0];
    const c = ui.seqModel().clips[id];
    ui.commitSeq("Time Remapping", M.setTimeRemap(ui.seqModel(), id, c.remap === undefined));
  }, { enabled: oneComp });
  def("scene.newComposition", "New Composition", () => s().newComposition(), { icon: "collection" });
  def("scene.mainSequence", "Go to the Main Sequence", () => s().openSequence("main"), { enabled: (a) => on(a) && a.sceneUI.seq !== "main" });
  def("scene.graphEditor", "Graph Editor", () => s().toggleGraph(), { icon: "bezier2", shortcut: "Shift+F3" });
  def("scene.split", "Split at Playhead", () => s().splitAtPlayhead(), { icon: "layout-split", shortcut: "Mod+K" });
  def("scene.duplicate", "Duplicate", () => s().duplicateSelection(), { icon: "files", enabled: hasSel, shortcut: "Mod+D" });
  def("scene.delete", "Delete", () => s().deleteSelection(), { icon: "trash", enabled: hasSel, shortcut: "Delete" });
  def("scene.rippleDelete", "Ripple Delete", () => s().deleteSelection({ ripple: true }), { enabled: hasSel, shortcut: "Shift+Delete" });
  def("scene.selectAll", "Select All Clips", () => s().selectAll(), { shortcut: "Mod+A" });
  def("scene.lift", "Lift (Remove the In to Out Range)", () => s().removeRange(false), { shortcut: ";" });
  def("scene.extract", "Extract (Remove the Range and Close the Gap)", () => s().removeRange(true), { shortcut: "'" });
  def("scene.fit", "Fit to Frame", () => s().selection().forEach((id) => s().fitClip(id, "fit")), { enabled: hasSel });
  def("scene.fill", "Fill Frame", () => s().selection().forEach((id) => s().fitClip(id, "fill")), { enabled: hasSel });
  def("scene.rippleTrimStart", "Ripple Trim Start to Playhead", () => s().rippleTrimTo("start"), { shortcut: "Q" });
  def("scene.rippleTrimEnd", "Ripple Trim End to Playhead", () => s().rippleTrimTo("end"), { shortcut: "W" });
  def("scene.addVideoTrack", "Add Video Track", () => s().addTrack("video"));
  def("scene.addAudioTrack", "Add Audio Track", () => s().addTrack("audio"));
  def("scene.setIn", "Set In Point", () => s().setIn(), { shortcut: "I" });
  def("scene.setOut", "Set Out Point", () => s().setOut(), { shortcut: "O" });
  def("scene.clearRange", "Clear In and Out", () => s().clearRange(), { shortcut: "X" });
  def("scene.addMarker", "Add Marker", () => s().addMarker(), { icon: "bookmark-plus", shortcut: "M" });
  def("scene.play", "Play / Pause", () => s().toggle(), { icon: "play-circle", shortcut: "Space" });
  def("scene.stepBack", "Step Back One Frame", () => s().step(-1), { shortcut: "ArrowLeft" });
  def("scene.stepForward", "Step Forward One Frame", () => s().step(1), { shortcut: "ArrowRight" });
  def("scene.prevEdit", "Go to Previous Edit", () => s().goEdit(-1), { shortcut: "ArrowUp" });
  def("scene.nextEdit", "Go to Next Edit", () => s().goEdit(1), { shortcut: "ArrowDown" });
  def("scene.goStart", "Go to Start", () => s().seek(0), { shortcut: "Home" });
  def("scene.goEnd", "Go to End", () => s().seek(Infinity), { shortcut: "End" });
  def("scene.zoomIn", "Zoom In", () => s().zoomBy(1.4), { icon: "zoom-in", shortcut: "=" });
  def("scene.zoomOut", "Zoom Out", () => s().zoomBy(1 / 1.4), { icon: "zoom-out", shortcut: "-" });
  def("scene.zoomFit", "Fit the Sequence", () => s().fit(), { shortcut: "\\" });
  def("scene.toolSelect", "Selection Tool", () => s().setTool("select"), { icon: "cursor", shortcut: "V" });
  def("scene.toolRazor", "Razor Tool", () => s().setTool("razor"), { icon: "scissors", shortcut: "C" });
  def("scene.toolSlip", "Slip Tool", () => s().setTool("slip"), { shortcut: "Y" });
  def("scene.toolHand", "Hand Tool", () => s().setTool("hand"), { icon: "hand-index", shortcut: "H" });
  // timeline and keyframe depth (docs/scene-studio.md ▸ Keyboard); the workspace handles the keys while it has focus
  def("scene.copy", "Copy Clips or Keyframes", () => s().copy(), { shortcut: "Mod+C", icon: "copy" });
  def("scene.cut", "Cut Clips or Keyframes", () => s().cut(), { shortcut: "Mod+X", icon: "scissors" });
  def("scene.paste", "Paste at Playhead", () => s().paste(), { shortcut: "Mod+V", icon: "clipboard" });
  def("scene.shuttleBack", "Shuttle Back (J)", () => s().shuttle(-1), { shortcut: "J" });
  def("scene.shuttleStop", "Stop (K)", () => s().shuttle(0), { shortcut: "K" });
  def("scene.shuttleForward", "Play Forward, Faster on Repeat (L)", () => s().shuttle(1), { shortcut: "L" });
  def("scene.prevKeyframe", "Go to Previous Keyframe", () => s().goKeyframe(-1), { shortcut: "Shift+J" });
  def("scene.nextKeyframe", "Go to Next Keyframe", () => s().goKeyframe(1), { shortcut: "Shift+K" });
  def("scene.showKeyframes", "Show Keyframes", () => s().toggleTwirl(), { shortcut: "U", icon: "diamond" });
  def("scene.nudgeLeft", "Nudge One Frame Left", () => s().nudge(-1), { shortcut: "Alt+ArrowLeft" });
  def("scene.nudgeRight", "Nudge One Frame Right", () => s().nudge(1), { shortcut: "Alt+ArrowRight" });
  def("scene.trimStart", "Trim Start to Playhead", () => s().trimTo("start"), { shortcut: "Alt+[" });
  def("scene.trimEnd", "Trim End to Playhead", () => s().trimTo("end"), { shortcut: "Alt+]" });
  def("scene.speed", "Speed / Duration…", () => s().speedDialog(), { shortcut: "Mod+R", enabled: hasSel, icon: "clock-history" });
  def("scene.reverse", "Reverse Clip", () => s().reverse(), { enabled: hasSel });
  def("scene.freeze", "Freeze Frame", () => s().freeze(), { enabled: hasSel });
  def("scene.link", "Link / Unlink", () => s().link(), { shortcut: "Mod+L", enabled: hasSel, icon: "link-45deg" });
  def("scene.enable", "Enable / Disable Clip", () => s().toggleEnabled(), { shortcut: "Shift+E", enabled: hasSel });
  def("scene.easyEase", "Easy Ease Keyframes", () => s().easeKeys("easyEase"), { shortcut: "F9" });
  def("scene.addNull", "Add Null Object", () => s().addLayerAt("null"), { icon: "plus-square-dotted" });
  def("scene.effects", "Effects Browser", () => s().showBinTab("effects"), { icon: "stars" });  def("scene.snap", "Snapping", () => s().toggleSnap(), { icon: "magnet", shortcut: "S" });
}
