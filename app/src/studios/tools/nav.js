// Navigation and sampling tools: Hand, Zoom, Eyedropper.
import { Tool } from "../../core/tool.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { buildPageDL } from "../../engine/dl.js";
import { renderToCanvas } from "../../engine/backends/canvas.js";
import { rgbToHex } from "../../core/color.js";
import { solid } from "../../core/nodes.js";

export class HandTool extends Tool {
  static id = "hand";
  static label = "Hand";
  static icon = "hand-index-thumb";
  static shortcut = "H";
  static studios = ["vector", "pixel", "layout"];
  cursor = "grab";
}

export class ZoomTool extends Tool {
  static id = "zoom";
  static label = "Zoom";
  static icon = "zoom-in";
  static shortcut = "Z";
  static studios = ["vector", "pixel", "layout"];
  cursor = "zoom-in";
  activate() {
    this.app.cv?.setCursor("zoom-in");
  }
  pointerDown(e) {
    this.start = { x: e.sx, y: e.sy, alt: e.alt };
    this.rect = null;
  }
  pointerMove(e) {
    if (!this.start) return;
    if (Math.hypot(e.sx - this.start.x, e.sy - this.start.y) > 4) this.rect = { x0: this.start.x, y0: this.start.y, x1: e.sx, y1: e.sy };
    this.app.requestOverlay();
  }
  pointerUp(e) {
    const app = this.app;
    const v = app.view;
    if (this.rect) {
      const r = this.rect;
      const [ax, ay] = v.toDoc(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1));
      const [bx, by] = v.toDoc(Math.max(r.x0, r.x1), Math.max(r.y0, r.y1));
      v.fit({ x: ax, y: ay, w: bx - ax, h: by - ay }, 8, 64);
    } else v.zoomAt(e.sx, e.sy, v.nextStep(this.start?.alt || e.alt ? -1 : 1));
    this.start = this.rect = null;
    app.emit("view");
    app.requestOverlay();
  }
  overlay(ctx) {
    if (!this.rect) return;
    const r = this.rect;
    ctx.save();
    ctx.strokeStyle = "#8b7cf6";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.min(r.x0, r.x1) + 0.5, Math.min(r.y0, r.y1) + 0.5, Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
    ctx.restore();
  }
}

/** Samples the composited color under the pointer and assigns it to fill (vector) or foreground (pixel). */
export class EyedropperTool extends Tool {
  static id = "eyedropper";
  static label = "Color Picker";
  static icon = "eyedropper";
  static shortcut = "I";
  static studios = ["vector", "pixel", "layout"];
  static options = [{ key: "sample", label: "Sample Size", type: "select", default: "1", options: [{ value: "1", label: "Point" }, { value: "3", label: "3 × 3" }, { value: "5", label: "5 × 5" }, { value: "11", label: "11 × 11" }] }];
  cursor = "crosshair";

  sample(e) {
    const app = this.app;
    const doc = app.doc;
    const page = e.page;
    const size = parseInt(this.opts.sample, 10) || 1;
    const dl = buildPageDL(doc, page);
    const px = Math.floor(e.x);
    const py = Math.floor(e.y);
    if (px < 0 || py < 0 || px >= page.w || py >= page.h) return null;
    const half = Math.floor(size / 2);
    const c = renderToCanvas(dl, { scale: 1, crop: { x: px - half, y: py - half, w: size, h: size }, width: size, height: size, bg: page.bg });
    const d = ctx2d(c).getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    const n = size * size;
    for (let i = 0; i < n; i++) {
      const al = d[i * 4 + 3] / 255;
      r += d[i * 4] * al;
      g += d[i * 4 + 1] * al;
      b += d[i * 4 + 2] * al;
      a += al;
    }
    if (a === 0) return null;
    return { hex: rgbToHex(r / a, g / a, b / a), alpha: a / n };
  }

  apply(e, secondary = false) {
    const app = this.app;
    const s = this.sample(e);
    if (!s) return;
    if (app.studio === "pixel") app.style[secondary ? "secondary" : "primary"] = s.hex;
    else app.style.fill = solid(s.hex);
    app.emit("colors");
    app.emit("eyedropper", { x: e.x, y: e.y, secondary });
    app.status(s.hex.toUpperCase());
    // vector: also paint the selection when shift is held
    if (app.studio !== "pixel" && e.shift && app.selection.length) {
      app.doc.tx("Apply Color", () => app.selection.forEach((n) => "fill" in n && app.doc.set(n, { fill: solid(s.hex) })));
    }
  }

  pointerDown(e) {
    this.down = true;
    this.apply(e, e.alt);
  }
  pointerMove(e) {
    if (this.down) this.apply(e, e.alt);
  }
  pointerUp() {
    this.down = false;
    this.app.status("");
  }
}

export { createCanvas };
