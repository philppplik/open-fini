// Scene Studio: video editing and motion design on a timeline (docs/scene-studio.md). Only this definition and the
// menus are start-up code; the host (scene/host.js), the workspace and the engine load on first use.
// Scene documents are OpenFini documents whose project (doc.office, the generic container of core/office.js) has
// kind "scene"; the Office Suite never mounts them (office/host.js sends them here).
export const SCENE_STUDIO = {
  id: "scene",
  label: "Scene",
  icon: "scene",
  blurb: "Video editing and motion design on a timeline",
  workspace: true,
  order: 55,
  // File ▸ New in this studio creates an empty sequence (the start screen offers the templates)
  newDocument: (app) => import("../scene/host.js").then((m) => m.newScene(app, {})),
  tools: [],
  top: [],
  bottom: [],
};

/** Menus of the Scene Studio (merged into ui/menus.js MENUS). The commands register when the first scene mounts. */
export const SCENE_MENUS = [
  { label: "Edit", studios: ["scene"], items: ["edit.undo", "edit.redo", "-", "scene.split", "scene.duplicate", "scene.delete", "scene.rippleDelete", "-", "scene.selectAll", "-", "scene.lift", "scene.extract", "-", "edit.preferences"] },
  { label: "Clip", studios: ["scene"], items: ["scene.addText", "scene.addShape", "scene.addSolid", "scene.addAdjustment", "-", "scene.precompose", "scene.openComposition", "scene.timeRemap", "-", "scene.fit", "scene.fill", "-", "scene.rippleTrimStart", "scene.rippleTrimEnd"] },
  { label: "Sequence", studios: ["scene"], items: ["scene.import", "-", "scene.addVideoTrack", "scene.addAudioTrack", "-", "scene.setIn", "scene.setOut", "scene.clearRange", "-", "scene.addMarker", "-", "scene.newComposition", "scene.mainSequence", "-", "scene.export"] },
  { label: "Playback", studios: ["scene"], items: ["scene.play", "scene.stepBack", "scene.stepForward", "scene.prevEdit", "scene.nextEdit", "scene.goStart", "scene.goEnd"] },
  { label: "View", studios: ["scene"], items: ["scene.zoomIn", "scene.zoomOut", "scene.zoomFit", "scene.graphEditor", "-", "scene.toolSelect", "scene.toolRazor", "scene.toolSlip", "scene.toolHand", "scene.snap", "-", "view.theme"] },
];
