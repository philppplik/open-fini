// Liquify tool (the Crop tool lives in pixel-crop.js).
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { Liquify } from "../../engine/pixel/index.js";
import { paintTarget, toLayer, commitPixelEdit } from "../../core/pixel.js";
import { button } from "../../ui/controls.js";
import { setMask } from "../../core/pixel.js";
import { brushBar } from "./pixel-paint.js";
import { CropTool } from "./pixel-crop.js";


// ------------------------------------------------------------------ liquify

export class LiquifyTool extends Tool {
  static id = "liquify";
  static label = "Liquify";
  static icon = "of:liquify";
  static shortcut = "Q";
  static studios = ["pixel"];
  static options = [
    { key: "mode", label: "Mode", type: "select", default: "push", options: [{ value: "push", label: "Push" }, { value: "twirl-cw", label: "Twirl clockwise" }, { value: "twirl-ccw", label: "Twirl counter-clockwise" }, { value: "pinch", label: "Pinch" }, { value: "bloat", label: "Bloat" }, { value: "reconstruct", label: "Reconstruct" }] },
    { key: "strength", label: "Strength", type: "range", min: 0.05, max: 1, step: 0.01, default: 0.6 },
  ];
  cursor = "none";
  session = null;
  hoverPt = null;

  activate() {
    this.app.cv?.setCursor("none");
  }
  deactivate() {
    this.commit();
  }
  contextBar() {
    return h("div.of-row.of-inline", brushBar(this.app, { opacity: false, flow: false, hardness: false }), button("Apply", () => this.commit(), { variant: "primary" }), button("Reset", () => this.reset()));
  }

  /** Tool pill (ui/tool-pill.js): only while there are unapplied distortions. */
  pillState() {
    if (!this.session?.changed) return null;
    return { key: "Liquify in progress", actions: [{ id: "apply", label: "Apply", key: "Enter", primary: true }, { id: "reset", label: "Cancel", key: "Escape" }] };
  }
  pillAction(id) {
    if (id === "apply") this.commit();
    else this.reset();
  }

  #begin() {
    const t = paintTarget(this.app);
    if (!t || t.locked) return null;
    const W = t.canvas.width;
    const H = t.canvas.height;
    const src = t.ctx.getImageData(0, 0, W, H);
    const out = new ImageData(new Uint8ClampedArray(src.data), W, H);
    this.session = { t, src, out, lq: new Liquify(src, { copy: true }), changed: false };
    return this.session;
  }

  pointerDown(e) {
    const s = this.session || this.#begin();
    if (!s) return;
    this.last = toLayer(s.t, e.x, e.y);
    this.moved = false;
    this.#dab(e, this.last, 0, 0, true);
  }

  #dab(e, [x, y], dx, dy, first = false) {
    const s = this.session;
    const mode = this.opts.mode;
    if (first && mode === "push") return; // push needs movement
    const radius = Math.max(2, this.app.brush.size / s.t.scale / 2);
    const rect = s.lq.applyBrush({ mode, x, y, radius, strength: this.opts.strength * (e.pressure || 1), dx, dy });
    if (rect.width > 0) {
      s.lq.renderRegion(rect, s.out);
      s.t.ctx.putImageData(s.out, 0, 0, rect.x, rect.y, rect.width, rect.height);
      s.changed = true;
      this.app.doc.touch(s.t.node);
      this.app.requestRender();
    }
  }

  pointerMove(e) {
    this.hoverPt = [e.x, e.y];
    const s = this.session;
    if (!s || !this.last) return this.app.requestOverlay();
    const [x, y] = toLayer(s.t, e.x, e.y);
    const dx = x - this.last[0];
    const dy = y - this.last[1];
    if (Math.hypot(dx, dy) < 1) return;
    this.#dab(e, [x, y], dx, dy);
    this.last = [x, y];
    this.app.requestOverlay();
  }

  hover(e) {
    this.hoverPt = [e.x, e.y];
    this.app.requestOverlay();
  }

  pointerUp() {
    this.last = null;
  }

  reset() {
    const s = this.session;
    if (!s) return;
    s.lq.reset();
    s.out.data.set(s.src.data);
    s.t.ctx.putImageData(s.src, 0, 0);
    s.changed = false;
    this.app.doc.touch(s.t.node);
    this.app.requestRender();
  }

  commit() {
    const s = this.session;
    this.session = null;
    if (!s || !s.changed) return;
    const after = s.t.ctx.getImageData(0, 0, s.src.width, s.src.height);
    commitPixelEdit(this.app, s.t, { x: 0, y: 0, before: s.src, after }, "Liquify");
    s.lq.dispose();
  }

  keyDown(ev) {
    if (ev.key === "Enter") {
      this.commit();
      return true;
    }
    if (ev.key === "Escape") {
      this.reset();
      return true;
    }
    return false;
  }

  overlay(ctx) {
    if (!this.hoverPt) return;
    const [x, y] = this.app.pageToScreen(...this.hoverPt);
    const r = Math.max(3, (this.app.brush.size / 2) * this.app.view.zoom);
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, 7);
    ctx.stroke();
    ctx.restore();
  }
}

export const PIXEL_MISC_TOOLS = [CropTool, LiquifyTool];
export { setMask };
