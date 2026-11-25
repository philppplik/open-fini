// Proto Studio: application interface design on an infinite canvas whose meaning is CSS (docs/proto-studio.md,
// docs/concepts/proto-studio.md, ADR 0034). Only this definition, the menus and the Labs switch are start-up code; the
// host (proto/host.js), the workspace, the renderer and the engine (engine/proto/) load on first use.
// Proto documents are OpenFini documents whose project (doc.office, core/office.js) has kind "proto"; the Office
// Suite never mounts them (office/host.js sends them here).
//
// Until the 1.3.x preview ends, the studio exists only with the *Settings ▸ Labs ▸ Proto Studio* preference
// (`labsProto`): installProtoLabs registers it at start-up and as soon as the switch is turned on. The registry cannot
// unregister a studio, so turning the switch off takes effect at the next start.
import { N_ } from "../i18n/index.js";

/** The preference behind the Labs switch. */
export const PROTO_LABS_PREF = "labsProto";

const host = () => import("../proto/host.js");

export const PROTO_STUDIO = {
  id: "proto",
  label: "Proto",
  systemIcon: "window-stack",
  blurb: N_("Interface design and prototypes in real HTML and CSS (Labs preview)"),
  workspace: true,
  order: 57,
  // File ▸ New: a design with one desktop frame; File ▸ New Blank: an empty page
  newDocument: (app) => host().then((m) => m.newProto(app, { starter: "desktop" })),
  newBlank: (app) => host().then((m) => m.newProto(app, { starter: "blank" })),
  tools: [],
  // Pages, Layers and Assets (left), the Design panel (right, id proto-inspector) and the Variables table (bottom)
  top: ["proto-pages", "proto-layers", "proto-assets"],
  bottom: ["proto-inspector", "proto-variables"],
  essentials: { left: [["proto-pages"], ["proto-layers", "proto-assets"]], right: [["proto-inspector", "comments"]], bottom: [["proto-variables"]], sizes: { left: 240, right: 280, bottom: 220 } },
};

/** Menus of the Proto Studio (merged into ui/menus.js MENUS). The commands register when the first design mounts. */
export const PROTO_MENUS = [
  { label: "Edit", studios: ["proto"], items: ["edit.undo", "edit.redo", "-", "proto.cut", "proto.copy", "proto.paste", "proto.duplicate", "proto.delete", "-", "proto.selectAll", "proto.deselect", "proto.selectParent", "proto.selectChildren", "-", "proto.rename", "proto.editText", "-", "edit.preferences"] },
  { label: "Insert", studios: ["proto"], items: ["proto.addFrame", "proto.addLaptopFrame", "proto.addTabletFrame", "proto.addPhoneFrame", "proto.addWatchFrame", "-", "proto.tool.frame", "proto.tool.rect", "proto.tool.ellipse", "proto.tool.line", "proto.tool.pen", "proto.tool.text", "proto.placeImage", "-", "proto.addPage", "-", "proto.import"] },
  { label: "Object", studios: ["proto"], items: ["proto.autoLayout", "proto.gridLayout", "proto.removeAutoLayout", "-", "proto.group", "proto.ungroup", "-", "proto.createComponent", "proto.combineVariants", "proto.goToMain", "proto.resetInstance", "proto.detachInstance", "-", "proto.bringToFront", "proto.bringForward", "proto.sendBackward", "proto.sendToBack", "-", "proto.toggleVisible", "proto.toggleLock"] },
  { label: "View", studios: ["proto"], items: ["proto.zoomIn", "proto.zoomOut", "proto.zoom100", "proto.zoomFit", "proto.zoomSelection", "-", "proto.tool.move", "proto.tool.hand", "proto.tool.zoom", "proto.tool.comment", "-", "view.theme"] },
];

/**
 * Registers the Proto Studio while the Labs switch is on (now, and when it is turned on later).
 * @param {{ prefs: object, on: Function }} app
 * @param {{ registerStudio: Function, hasStudio: Function }} registry
 */
export function installProtoLabs(app, { registerStudio, hasStudio }) {
  const sync = () => {
    if (app.prefs[PROTO_LABS_PREF] && !hasStudio(PROTO_STUDIO.id)) registerStudio(PROTO_STUDIO);
  };
  sync();
  app.on("prefs", (key) => (key === PROTO_LABS_PREF || key === "*") && sync());
}
