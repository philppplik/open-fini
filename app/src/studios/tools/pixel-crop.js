// Crop tool shell: the registration data (id, key, options) is tiny and eager; the interaction code
// (pixel-crop-impl.js: handles, straighten, overlays, cropPage) loads on first activation so it stays out of the
// start-up bundle. Public API for other modules: `cropPage` (lazy, async re-export), `CropTool`.
import { Tool } from "../../core/tool.js";
import { N_ } from "../../i18n/index.js";

const RATIO_OPTIONS = ["free", "original", "1:1", "4:3", "3:2", "16:9", "5:4", "3:4", "2:3", "9:16", "custom"].map((k) => ({ value: k, label: k === "free" ? N_("Free") : k === "original" ? N_("Original") : k === "custom" ? N_("Custom…") : k }));

/** Crops the active page (see pixel-crop-impl.js). Loads the implementation on first use. */
export async function cropPage(app, rect, opts) {
  return (await import("./pixel-crop-impl.js")).cropPage(app, rect, opts);
}

export class CropTool extends Tool {
  static id = "crop";
  static label = "Crop";
  static icon = "of:crop";
  static shortcut = "C";
  static studios = ["pixel", "vector", "layout"];
  static options = [
    { key: "ratio", label: N_("Ratio"), type: "select", default: "free", options: RATIO_OPTIONS },
    { key: "customW", label: N_("Custom W"), type: "int", min: 1, max: 99, step: 1, default: 5 },
    { key: "customH", label: N_("Custom H"), type: "int", min: 1, max: 99, step: 1, default: 4 },
    { key: "angle", label: N_("Straighten"), type: "angle", min: -45, max: 45, step: 0.1, default: 0 },
    { key: "overlay", label: N_("Overlay"), type: "select", default: "thirds", options: [{ value: "thirds", label: N_("Rule of thirds") }, { value: "grid", label: N_("Grid") }, { value: "golden", label: N_("Golden ratio") }, { value: "diagonal", label: N_("Diagonals") }, { value: "triangle", label: N_("Golden triangle") }, { value: "none", label: N_("None") }] },
    { key: "corners", label: N_("Empty corners"), type: "select", default: "transparent", options: [{ value: "transparent", label: N_("Transparent") }, { value: "background", label: N_("Background color") }, { value: "fit", label: N_("Shrink to fit") }] },
    { key: "deletePixels", label: N_("Delete cropped pixels"), type: "bool", default: false },
  ];
  cursor = "crosshair";
  impl = null;

  activate() {
    this.app.cv?.setCursor("crosshair");
    import("./pixel-crop-impl.js").then((m) => {
      if (this.app.tool !== this) return;
      this.impl = new m.CropToolImpl(this.app);
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
  doubleClick(e) {
    this.impl?.doubleClick(e);
  }
  keyDown(ev) {
    return this.impl ? this.impl.keyDown(ev) : false;
  }
  contextBar() {
    return this.impl?.contextBar() || null;
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
