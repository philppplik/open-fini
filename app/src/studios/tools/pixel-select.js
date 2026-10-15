// Pixel selection tools and the marching-ants overlay.
import { Tool } from "../../core/tool.js";
import { Mask, magicWand, colorRange } from "../../engine/pixel/index.js";
import { combineMask, opFrom, emptyPageMask, getMask, setMask } from "../../core/pixel.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { buildPageDL } from "../../engine/dl.js";
import { renderToCanvas } from "../../engine/backends/canvas.js";
import { worldMatrix } from "../../core/nodes.js";
import { parseColor } from "../../core/color.js";

const MODE_OPTION = {
  key: "mode",
  label: "Mode",
  type: "select",
  default: "replace",
  options: [
    { value: "replace", label: "New selection" },
    { value: "add", label: "Add (Shift)" },
    { value: "subtract", label: "Subtract (Alt)" },
    { value: "intersect", label: "Intersect (Shift+Alt)" },
  ],
};
const FEATHER_OPTION = { key: "feather", label: "Feather", type: "range", min: 0, max: 100, step: 1, unit: "px", default: 0 };

/** Page-sized RGBA image: the merged composite or only the active layer. */
export function pageImage(app, { merged = true } = {}) {
  const page = app.page;
  const w = Math.round(page.w);
  const h = Math.round(page.h);
  if (merged) {
    const c = renderToCanvas(buildPageDL(app.doc, page), { scale: 1, width: w, height: h, bg: page.bg });
    return ctx2d(c).getImageData(0, 0, w, h);
  }
  const node = app.activeNode;
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const src = node && app.doc.pixels.get(node.id);
  if (src) {
    const W = worldMatrix(node);
    ctx.setTransform(W[0], W[1], W[2], W[3], W[4], W[5]);
    ctx.drawImage(src, 0, 0);
  }
  return ctx.getImageData(0, 0, w, h);
}

class SelectTool extends Tool {
  static studios = ["pixel"];
  static group = "select";
  cursor = "crosshair";
  activate() {
    this.app.cv?.setCursor("crosshair");
  }
  finish(app, e, mask) {
    if (this.opts.feather > 0) mask.feather(this.opts.feather);
    combineMask(app, mask, opFrom(e, this.opts.mode), "Selection");
  }
}

class ShapeSelect extends SelectTool {
  static options = [MODE_OPTION, FEATHER_OPTION];
  ellipse = false;
  pointerDown(e) {
    this.start = [e.x, e.y];
    this.cur = [e.x, e.y];
    this.sx = e.sx;
    this.sy = e.sy;
    this.moved = false;
  }
  rect(e) {
    let [x0, y0] = this.start;
    let dx = e.x - x0;
    let dy = e.y - y0;
    if (e.shift && !e.alt && this.opts.mode === "replace") {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    if (e.alt && this.opts.mode === "replace") {
      x0 -= dx;
      y0 -= dy;
      dx *= 2;
      dy *= 2;
    }
    return { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) };
  }
  pointerMove(e) {
    if (!this.start) return;
    if (Math.hypot(e.sx - this.sx, e.sy - this.sy) > 3) this.moved = true;
    this.last = e;
    this.app.status(`W ${this.rect(e).w.toFixed(0)}  H ${this.rect(e).h.toFixed(0)}`);
    this.app.requestOverlay();
  }
  pointerUp(e) {
    const app = this.app;
    if (!this.start) return;
    const r = this.rect(e);
    this.start = null;
    app.status("");
    if (!this.moved || r.w < 1 || r.h < 1) {
      if (this.opts.mode === "replace") setMask(app, null, "Deselect");
      return app.requestOverlay();
    }
    const W = Math.round(app.page.w);
    const H = Math.round(app.page.h);
    const mask = this.ellipse ? Mask.ellipse(W, H, r.x, r.y, r.w, r.h) : Mask.rect(W, H, r.x, r.y, r.w, r.h);
    this.finish(app, e, mask);
    app.requestOverlay();
  }
  cancel() {
    this.start = null;
    this.app.requestOverlay();
  }
  overlay(ctx) {
    if (!this.start || !this.moved || !this.last) return;
    const r = this.rect(this.last);
    const [x0, y0] = this.app.pageToScreen(r.x, r.y);
    const [x1, y1] = this.app.pageToScreen(r.x + r.w, r.y + r.h);
    ctx.save();
    ctx.lineWidth = 1;
    for (const [col, off] of [["#fff", 0], ["#000", 4]]) {
      ctx.strokeStyle = col;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = off;
      ctx.beginPath();
      if (this.ellipse) ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      else ctx.rect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class MarqueeTool extends ShapeSelect {
  static id = "marquee";
  static label = "Rectangular Marquee";
  static icon = "of:marquee";
  static shortcut = "M";
}
export class EllipseMarqueeTool extends ShapeSelect {
  static id = "marquee-ellipse";
  static label = "Elliptical Marquee";
  static icon = "of:marquee-ellipse";
  static shortcut = "M";
  ellipse = true;
}

export class LassoTool extends SelectTool {
  static id = "lasso";
  static label = "Freehand Lasso";
  static icon = "of:lasso";
  static shortcut = "L";
  static options = [MODE_OPTION, FEATHER_OPTION];
  pts = null;
  pointerDown(e) {
    this.pts = [e.x, e.y];
  }
  pointerMove(e) {
    if (!this.pts) return;
    const n = this.pts.length;
    if (Math.hypot(e.x - this.pts[n - 2], e.y - this.pts[n - 1]) * this.app.view.zoom < 2) return;
    this.pts.push(e.x, e.y);
    this.app.requestOverlay();
  }
  pointerUp(e) {
    const pts = this.pts;
    this.pts = null;
    const app = this.app;
    if (!pts || pts.length < 6) {
      if (this.opts.mode === "replace") setMask(app, null, "Deselect");
      return app.requestOverlay();
    }
    const mask = Mask.polygon(Math.round(app.page.w), Math.round(app.page.h), pts, { antialias: true });
    this.finish(app, e, mask);
    app.requestOverlay();
  }
  cancel() {
    this.pts = null;
    this.app.requestOverlay();
  }
  overlay(ctx) {
    if (!this.pts) return;
    drawPolyline(ctx, this.app, this.pts, false);
  }
}

function drawPolyline(ctx, app, pts, closeHint, page = app.page) {
  ctx.save();
  ctx.lineWidth = 1;
  for (const [col, off] of [["#fff", 0], ["#000", 4]]) {
    ctx.strokeStyle = col;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = off;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = app.pageToScreen(pts[i], pts[i + 1], page);
      ctx[i ? "lineTo" : "moveTo"](x, y);
    }
    if (closeHint) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export class PolyLassoTool extends SelectTool {
  static id = "poly-lasso";
  static label = "Polygonal Lasso";
  static icon = "of:poly-lasso";
  static shortcut = "L";
  static options = [MODE_OPTION, FEATHER_OPTION];
  pts = [];
  hoverPt = null;
  pointerDown(e) {
    const app = this.app;
    this.lastE = e;
    if (this.pts.length >= 6) {
      const d = Math.hypot(e.x - this.pts[0], e.y - this.pts[1]) * app.view.zoom;
      if (d < 8) return this.close(e);
    }
    this.pts.push(e.x, e.y);
    app.requestOverlay();
  }
  hover(e) {
    this.hoverPt = [e.x, e.y];
    this.app.requestOverlay();
  }
  pointerMove() {}
  pointerUp() {}
  doubleClick(e) {
    if (this.pts.length >= 6) this.close(e);
  }
  close(e) {
    const pts = this.pts;
    this.pts = [];
    const app = this.app;
    const mask = Mask.polygon(Math.round(app.page.w), Math.round(app.page.h), pts, { antialias: true });
    this.finish(app, e, mask);
    app.requestOverlay();
  }
  keyDown(ev) {
    if (ev.key === "Enter" && this.pts.length >= 6) {
      this.close(this.lastE || { shift: false, alt: false });
      return true;
    }
    if (ev.key === "Escape" && this.pts.length) {
      this.cancel();
      return true;
    }
    if (ev.key === "Backspace" && this.pts.length) {
      this.pts.length -= 2;
      this.app.requestOverlay();
      return true;
    }
    return false;
  }
  cancel() {
    this.pts = [];
    this.app.requestOverlay();
  }
  deactivate() {
    this.pts = [];
  }
  overlay(ctx) {
    if (!this.pts.length) return;
    const pts = this.hoverPt ? [...this.pts, ...this.hoverPt] : this.pts;
    drawPolyline(ctx, this.app, pts, false);
  }
}

export class WandTool extends SelectTool {
  static id = "wand";
  static label = "Magic Wand";
  static icon = "of:wand";
  static shortcut = "W";
  static options = [
    MODE_OPTION,
    { key: "tolerance", label: "Tolerance", type: "int", min: 0, max: 255, step: 1, default: 32 },
    { key: "contiguous", label: "Contiguous", type: "bool", default: true },
    { key: "sample", label: "Sample", type: "select", default: "layer", options: [{ value: "layer", label: "Active layer" }, { value: "merged", label: "All layers" }] },
    FEATHER_OPTION,
  ];
  pointerDown(e) {
    const app = this.app;
    const img = pageImage(app, { merged: this.opts.sample === "merged" });
    const mask = magicWand(img, e.x, e.y, { tolerance: this.opts.tolerance, contiguous: this.opts.contiguous, antialias: true });
    if (mask.isEmpty() && this.opts.mode === "replace") return setMask(app, null, "Deselect");
    this.finish(app, e, mask);
  }
}

export class ColorRangeTool extends SelectTool {
  static id = "color-range";
  static label = "Color Range";
  static icon = "of:color-range";
  static shortcut = "W";
  static options = [
    MODE_OPTION,
    { key: "tolerance", label: "Range", type: "int", min: 0, max: 255, step: 1, default: 40 },
    { key: "fuzziness", label: "Softness", type: "range", min: 0, max: 100, step: 1, unit: "%", default: 30 },
    FEATHER_OPTION,
  ];
  pointerDown(e) {
    const app = this.app;
    const img = pageImage(app, { merged: true });
    const x = Math.max(0, Math.min(img.width - 1, Math.floor(e.x)));
    const y = Math.max(0, Math.min(img.height - 1, Math.floor(e.y)));
    const i = (y * img.width + x) * 4;
    const color = `#${[img.data[i], img.data[i + 1], img.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const mask = colorRange(img, color, { tolerance: this.opts.tolerance, fuzziness: this.opts.fuzziness / 100 });
    this.finish(app, e, mask);
  }
}

// ------------------------------------------------------------------ marching ants

export function installAnts(app) {
  let timer = 0;
  const contoursFor = (st) => {
    if (st._ants && st._ants.rev === st.maskRev && st._ants.m === st.pixelMask) return st._ants.list;
    const list = st.pixelMask.toContours({ simplify: 0.6 });
    st._ants = { rev: st.maskRev, m: st.pixelMask, list };
    return list;
  };
  app.on("overlay-pixel", (ctx) => {
    const st = app.state;
    if (!st?.pixelMask) return;
    const view = st.view;
    const page = st.page;
    const list = contoursFor(st);
    const off = (performance.now() / 70) % 8;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const c of list) {
      const p = c.points;
      for (let i = 0; i < p.length; i += 2) {
        const [x, y] = view.toScreen(p[i] + page.x, p[i + 1] + page.y);
        if (i) ctx.lineTo(Math.round(x) + 0.5, Math.round(y) + 0.5);
        else ctx.moveTo(Math.round(x) + 0.5, Math.round(y) + 0.5);
      }
      ctx.closePath();
    }
    ctx.strokeStyle = "#fff";
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -off;
    ctx.stroke();
    ctx.restore();
  });
  const tick = () => {
    if (app.state?.pixelMask && app.studio === "pixel") app.requestOverlay();
  };
  timer = setInterval(tick, 110);
  return () => clearInterval(timer);
}

export { parseColor, getMask, emptyPageMask };
export const PIXEL_SELECT_TOOLS = [MarqueeTool, EllipseMarqueeTool, LassoTool, PolyLassoTool, WandTool, ColorRangeTool];
