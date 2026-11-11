// Commands of the Scene Studio (docs/scene-studio.md): menus (studios/scene.js ▸ SCENE_MENUS) and the command palette.
// Registered lazily by scene/view.js the first time a scene mounts, so nothing here is start-up code. Single-key
// shortcuts (Space, J/K/L, I/O, C/V …) are handled by the workspace while it has focus; the commands only document
// them, so they never collide with the shortcuts of other studios.
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
  def("scene.split", "Split at Playhead", () => s().splitAtPlayhead(), { icon: "layout-split" });
  def("scene.duplicate", "Duplicate", () => s().duplicateSelection(), { icon: "files", enabled: hasSel });
  def("scene.delete", "Delete", () => s().deleteSelection(), { icon: "trash", enabled: hasSel });
  def("scene.rippleDelete", "Ripple Delete", () => s().deleteSelection({ ripple: true }), { enabled: hasSel });
  def("scene.selectAll", "Select All Clips", () => s().selectAll());
  def("scene.lift", "Lift (Remove the In to Out Range)", () => s().removeRange(false));
  def("scene.extract", "Extract (Remove the Range and Close the Gap)", () => s().removeRange(true));
  def("scene.fit", "Fit to Frame", () => s().selection().forEach((id) => s().fitClip(id, "fit")), { enabled: hasSel });
  def("scene.fill", "Fill Frame", () => s().selection().forEach((id) => s().fitClip(id, "fill")), { enabled: hasSel });
  def("scene.rippleTrimStart", "Ripple Trim Start to Playhead", () => s().rippleTrimTo("start"));
  def("scene.rippleTrimEnd", "Ripple Trim End to Playhead", () => s().rippleTrimTo("end"));
  def("scene.addVideoTrack", "Add Video Track", () => s().addTrack("video"));
  def("scene.addAudioTrack", "Add Audio Track", () => s().addTrack("audio"));
  def("scene.setIn", "Set In Point", () => s().setIn());
  def("scene.setOut", "Set Out Point", () => s().setOut());
  def("scene.clearRange", "Clear In and Out", () => s().clearRange());
  def("scene.addMarker", "Add Marker", () => s().addMarker(), { icon: "bookmark-plus" });
  def("scene.play", "Play / Pause", () => s().toggle(), { icon: "play-circle" });
  def("scene.stepBack", "Step Back One Frame", () => s().step(-1));
  def("scene.stepForward", "Step Forward One Frame", () => s().step(1));
  def("scene.prevEdit", "Go to Previous Edit", () => s().goEdit(-1));
  def("scene.nextEdit", "Go to Next Edit", () => s().goEdit(1));
  def("scene.goStart", "Go to Start", () => s().seek(0));
  def("scene.goEnd", "Go to End", () => s().seek(Infinity));
  def("scene.zoomIn", "Zoom In", () => s().zoomBy(1.4), { icon: "zoom-in" });
  def("scene.zoomOut", "Zoom Out", () => s().zoomBy(1 / 1.4), { icon: "zoom-out" });
  def("scene.zoomFit", "Fit the Sequence", () => s().fit());
  def("scene.toolSelect", "Selection Tool", () => s().setTool("select"), { icon: "cursor" });
  def("scene.toolRazor", "Razor Tool", () => s().setTool("razor"), { icon: "scissors" });
  def("scene.toolSlip", "Slip Tool", () => s().setTool("slip"));
  def("scene.toolHand", "Hand Tool", () => s().setTool("hand"), { icon: "hand-index" });
  def("scene.snap", "Snapping", () => s().toggleSnap(), { icon: "magnet" });
}
