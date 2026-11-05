// 3D Transform tool shell: registration data only (eager, tiny). The interaction (handles, live preview, apply) is in
// pixel-transform3d-impl.js and loads on first activation; the warp itself runs on the worker pool.
import { Tool } from "../../core/tool.js";
import { N_ } from "../../i18n/index.js";

export class Transform3DTool extends Tool {
  static id = "transform-3d";
  static label = "3D Transform";
  static icon = "of:crop";
  static shortcut = "";
  static studios = ["pixel"];
  static options = [
    { key: "rotateX", label: N_("Tilt X"), type: "angle", min: -80, max: 80, step: 1, default: 0 },
    { key: "rotateY", label: N_("Tilt Y"), type: "angle", min: -80, max: 80, step: 1, default: 0 },
    { key: "rotateZ", label: N_("Rotate Z"), type: "angle", min: -180, max: 180, step: 1, default: 0 },
    { key: "distance", label: N_("Perspective distance"), type: "range", min: 0.5, max: 10, step: 0.1, default: 2 },
    { key: "skewX", label: N_("Skew X"), type: "angle", min: -60, max: 60, step: 1, default: 0 },
    { key: "skewY", label: N_("Skew Y"), type: "angle", min: -60, max: 60, step: 1, default: 0 },
    { key: "grid", label: N_("Warp grid"), type: "select", default: "1", options: [{ value: "1", label: N_("Corner pin") }, { value: "2", label: "2 × 2" }, { value: "3", label: "3 × 3" }, { value: "4", label: "4 × 4" }] },
    { key: "filter", label: N_("Resampling"), type: "select", default: "bicubic", options: [{ value: "bicubic", label: N_("Bicubic") }, { value: "bilinear", label: N_("Bilinear") }, { value: "nearest", label: N_("Nearest neighbor (pixel art)") }] },
  ];
  cursor = "default";
  impl = null;

  activate() {
    import("./pixel-transform3d-impl.js").then((m) => {
      if (this.app.tool !== this) return;
      this.impl = new m.Transform3DImpl(this.app, this);
      this.impl.activate();
      this.app.emit("contextbar");
    });
  }
  deactivate() {
    this.impl?.deactivate();
    this.impl = null;
  }
  refresh() {
    this.impl?.refresh();
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
  keyDown(ev) {
    return this.impl ? this.impl.keyDown(ev) : false;
  }
  pillState() {
    return this.impl?.pillState() || null;
  }
  pillAction(id) {
    this.impl?.pillAction(id);
  }
  overlay(ctx) {
    this.impl?.overlay(ctx);
  }
}
