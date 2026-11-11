// Patch and Object Eraser tool shells: registration data only (eager, tiny). The interaction is in pixel-heal-impl.js
// (loaded on first activation); the pixel work runs on the worker pool through heal-ops.js.
import { Tool } from "../../core/tool.js";
import { N_ } from "../../i18n/index.js";

/** A tool whose pointer, key and overlay handling lives in `impl`, an instance of `name` from pixel-heal-impl.js. */
class LazyHealTool extends Tool {
  static studios = ["pixel"];
  static group = "retouch";
  static implName = "";
  impl = null;
  activate() {
    this.app.cv?.setCursor(this.cursor);
    import("./pixel-heal-impl.js").then((m) => {
      if (this.app.tool !== this) return;
      this.impl = new m[this.constructor.implName](this.app, this);
      this.app.emit("contextbar");
    });
  }
  deactivate() {
    this.impl?.cancel();
    this.impl = null;
  }
  cancel() {
    this.impl?.cancel();
  }
  hover(e) {
    this.impl?.hover(e);
  }
  pointerDown(e) {
    this.impl?.pointerDown(e);
  }
  pointerMove(e) {
    this.impl?.pointerMove(e);
  }
  pointerUp(e) {
    this.impl?.pointerUp(e);
  }
  overlay(ctx) {
    this.impl?.overlay(ctx);
  }
  contextBar() {
    return this.impl?.contextBar() || null;
  }
}

export class PatchTool extends LazyHealTool {
  static id = "patch";
  static label = "Patch";
  static icon = "bounding-box";
  static shortcut = "J";
  static implName = "PatchImpl";
  static options = [
    { key: "mode", label: N_("Patch"), type: "select", default: "source", options: [{ value: "source", label: N_("Source: fill the selection from where you drag") }, { value: "destination", label: N_("Destination: copy the selection to where you drag") }] },
    { key: "blend", label: N_("Blend"), type: "select", default: "heal", options: [{ value: "heal", label: N_("Match the surroundings") }, { value: "copy", label: N_("Copy exactly") }] },
  ];
  cursor = "crosshair";
}

export class ObjectEraserTool extends LazyHealTool {
  static id = "object-eraser";
  static label = "Object Eraser";
  static icon = "magic";
  static shortcut = "J";
  static implName = "ObjectEraserImpl";
  static options = [
    { key: "grow", label: N_("Grow"), type: "int", min: 0, max: 20, step: 1, unit: "px", default: 3 },
    { key: "method", label: N_("Fill"), type: "select", default: "auto", options: [{ value: "auto", label: N_("Automatic") }, { value: "patch", label: N_("Texture (patches)") }, { value: "diffuse", label: N_("Smooth (fast)") }] },
  ];
  cursor = "none";
}

export const PIXEL_HEAL_TOOLS = [PatchTool, ObjectEraserTool];
