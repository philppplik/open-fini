// A one-shot sampling tool used by the Levels / Curves eyedroppers: the next click on the canvas calls `cfg.onPick`.
import { Tool } from "../../core/tool.js";

export class AdjustPickerTool extends Tool {
  static id = "adjust-picker";
  static label = "Sample Image";
  static icon = "eyedropper";
  static shortcut = "";
  static studios = ["pixel", "vector", "layout"];
  cursor = "crosshair";
  cfg = null;
  back = null;

  /** Starts sampling. cfg: { label, sample(e) → [r,g,b]|null, onPick(rgb, e), onEnd?() } */
  static begin(app, cfg) {
    const prev = app.tool?.id === AdjustPickerTool.id ? app.tool.back : app.tool?.id;
    app.setTool(AdjustPickerTool.id);
    const t = app.tool;
    t.cfg?.onEnd?.();
    t.cfg = cfg;
    t.back = prev || "move";
    app.status(`${cfg.label} — click the image (Esc to cancel)`);
    app.cv?.setCursor("crosshair");
  }

  end() {
    const cfg = this.cfg;
    this.cfg = null;
    cfg?.onEnd?.();
    this.app.status("");
    if (this.app.tool === this) this.app.setTool(this.back || "move");
  }
  activate() {
    this.app.cv?.setCursor("crosshair");
  }
  pointerDown(e) {
    if (!this.cfg) return this.end();
    const rgb = this.cfg.sample(e);
    if (rgb) this.cfg.onPick(rgb, e);
    this.end();
  }
  keyDown(ev) {
    if (ev.key !== "Escape") return false;
    this.end();
    return true;
  }
  cancel() {
    const cfg = this.cfg;
    this.cfg = null;
    cfg?.onEnd?.();
  }
}
