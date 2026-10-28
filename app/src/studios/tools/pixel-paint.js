// Pixel painting tools: Brush, Pencil, Eraser, plus the pixel-mode Fill and Gradient behaviors.
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { StrokeEngine } from "../../engine/brush.js";
import { paintTarget, toLayer, layerSpaceMask, commitPixelEdit, maskCanvas } from "../../core/pixel.js";
import { floodFill, Mask } from "../../engine/pixel/index.js";
import { brightness, cssColor } from "../../core/color.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { sliderField, switchField, selectField } from "../../ui/controls.js";
import { N_ } from "../../i18n/index.js";
import { fillGradient } from "../../engine/pixel/gradient.js";

/** Shared brush controls (bound to app.brush) shown in the context bar of every brush-like tool. */
export function brushBar(app, { opacity = true, flow = true, hardness = true } = {}) {
  const b = app.brush;
  const row = h("div.of-row.of-inline", { style: { gap: "14px" } });
  const mk = (key, label, min, max, step, scale = 1, unit = "") => {
    const f = sliderField({ label, value: b[key], min, max, step, unit, scale, onInput: (v) => (b[key] = v), onChange: (v) => {
      b[key] = v;
      app.emit("brush");
    } });
    f.el.style.width = "190px";
    return f;
  };
  const size = mk("size", "Size", 1, 800, 1, 1, "px");
  row.append(size.el);
  if (hardness) row.append(mk("hardness", "Hardness", 0, 1, 0.01, 100, "%").el);
  if (opacity) row.append(mk("opacity", "Opacity", 0.01, 1, 0.01, 100, "%").el);
  if (flow) row.append(mk("flow", "Flow", 0.01, 1, 0.01, 100, "%").el);
  const press = switchField({ label: "Pressure", value: b.pressureSize, onChange: (v) => (b.pressureSize = v) });
  row.append(press.el);
  app.on("brush", () => size.set(b.size));
  return row;
}

class PaintBase extends Tool {
  static studios = ["pixel"];
  erase = false;
  hard = false;
  cursor = "none";
  hoverPt = null;

  activate() {
    this.app.cv?.setCursor("none");
  }
  deactivate() {
    this.hoverPt = null;
  }
  contextBar() {
    return brushBar(this.app, { hardness: !this.hard });
  }

  #settings(t) {
    const b = this.app.brush;
    let erase = this.erase;
    let color = this.app.style.primary;
    if (t.isMask) {
      // masks: light colors reveal, dark colors hide
      if (!erase) {
        erase = brightness(color) < 0.5;
        color = "#ffffff";
      }
    }
    return {
      size: Math.max(1, b.size / t.scale),
      hardness: this.hard ? 1 : b.hardness,
      opacity: b.opacity,
      flow: this.hard ? 1 : b.flow,
      spacing: this.hard ? 0.05 : b.spacing,
      smoothing: b.smoothing,
      pressureSize: b.pressureSize && this.pressureAware !== false,
      pressureOpacity: b.pressureOpacity,
      color,
      erase,
    };
  }

  pointerDown(e) {
    const app = this.app;
    const t = paintTarget(app);
    if (!t) return;
    if (t.locked) return app.toast("This layer is locked.", "warning");
    this.t = t;
    const mask = layerSpaceMask(app, t);
    this.engine = new StrokeEngine(t.canvas, { ...this.#settings(t), mask });
    const [lx, ly] = toLayer(t, e.x, e.y);
    this.engine.begin(lx, ly, e.pointerType === "mouse" ? 1 : e.pressure);
    app.doc.touch(t.node);
    app.requestRender();
  }

  pointerMove(e) {
    if (!this.engine) return;
    const app = this.app;
    const raw = e.raw;
    const events = raw.getCoalescedEvents?.() || [];
    const list = events.length ? events : [raw];
    for (const ce of list) {
      const pe = app.cv.makeEvent(ce);
      const [lx, ly] = toLayer(this.t, pe.x, pe.y);
      this.engine.move(lx, ly, pe.pointerType === "mouse" ? 1 : pe.pressure);
    }
    this.hoverPt = [e.x, e.y];
    app.doc.touch(this.t.node);
    app.requestRender();
    app.requestOverlay();
  }

  hover(e) {
    this.hoverPt = [e.x, e.y];
    this.app.requestOverlay();
  }

  pointerUp() {
    if (!this.engine) return;
    const edit = this.engine.end();
    this.engine = null;
    commitPixelEdit(this.app, this.t, edit, this.erase ? "Erase" : "Paint");
    this.app.doc.touch(this.t.node);
    this.app.requestRender();
    this.app.emit("pixels");
  }

  cancel() {
    this.engine = null;
  }

  keyDown(ev) {
    const b = this.app.brush;
    if (ev.key === "[" || ev.key === "]") {
      const f = ev.key === "]" ? 1 : -1;
      b.size = Math.max(1, Math.min(800, Math.round(b.size * (1 + 0.12 * f) + f)));
      this.app.emit("brush");
      this.app.requestOverlay();
      return true;
    }
    return false;
  }

  overlay(ctx) {
    const app = this.app;
    if (!this.hoverPt) return;
    const [x, y] = app.pageToScreen(this.hoverPt[0], this.hoverPt[1]);
    const r = Math.max(1.5, (app.brush.size / 2) * app.view.zoom);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.7)";
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    if (r < 4) {
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class BrushTool extends PaintBase {
  static id = "brush";
  static label = "Paint Brush";
  static icon = "of:brush";
  static shortcut = "B";
  static group = "paint-brush";
}

export class PixelPencilTool extends PaintBase {
  static id = "pixel-pencil";
  static label = "Pixel Pencil";
  static icon = "of:pixel-pencil";
  static shortcut = "B";
  static group = "paint-brush";
  hard = true;
  pressureAware = false;
}

export class EraserTool extends PaintBase {
  static id = "eraser";
  static label = "Eraser";
  static icon = "eraser";
  static shortcut = "E";
  erase = true;
}

// ------------------------------------------------------------------ fill (paint bucket)

export const FILL_OPTIONS = [
  { key: "tolerance", label: "Tolerance", type: "int", min: 0, max: 255, step: 1, default: 32 },
  { key: "contiguous", label: "Contiguous", type: "bool", default: true },
  { key: "grow", label: "Grow", type: "int", min: 0, max: 10, step: 1, unit: "px", default: 0 },
];

/** Flood-fills the active pixel layer at the event position with the foreground color. */
export function pixelFill(app, e, opts) {
  const t = paintTarget(app);
  if (!t) return;
  if (t.locked) return app.toast("This layer is locked.", "warning");
  const [lx, ly] = toLayer(t, e.x, e.y);
  const W = t.canvas.width;
  const H = t.canvas.height;
  if (lx < 0 || ly < 0 || lx >= W || ly >= H) return;
  const img = t.ctx.getImageData(0, 0, W, H);
  const before = new Uint8ClampedArray(img.data);
  const selMask = layerSpaceMask(app, t);
  const mask = selMask ? Mask.fromAlpha(ctx2d(selMask).getImageData(0, 0, W, H)) : undefined;
  const color = t.isMask ? (brightness(app.style.primary) >= 0.5 ? "#ffffff" : "#000000") : app.style.primary;
  const rect = floodFill(img, lx, ly, color, { tolerance: opts.tolerance, contiguous: opts.contiguous, grow: opts.grow, mask, opacity: app.brush.opacity });
  if (!rect.width) return;
  t.ctx.putImageData(img, 0, 0);
  const rb = t.ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
  // build the "before" patch from the saved copy
  const bp = new ImageData(new Uint8ClampedArray(rect.width * rect.height * 4), rect.width, rect.height);
  for (let y = 0; y < rect.height; y++) {
    const srcOff = ((rect.y + y) * W + rect.x) * 4;
    bp.data.set(before.subarray(srcOff, srcOff + rect.width * 4), y * rect.width * 4);
  }
  commitPixelEdit(app, t, { x: rect.x, y: rect.y, before: bp, after: rb }, "Fill");
  app.doc.touch(t.node);
  app.requestRender();
}

// ------------------------------------------------------------------ gradient (pixel mode)

export const PIXEL_GRADIENT_OPTIONS = [
  { key: "type", label: "Type", type: "select", default: "linear", options: [{ value: "linear", label: "Linear" }, { value: "radial", label: "Radial" }, { value: "conic", label: N_("Angular") }, { value: "reflected", label: N_("Reflected") }, { value: "diamond", label: N_("Diamond") }] },
  { key: "colors", label: "Colors", type: "select", default: "fg-bg", options: [{ value: "fg-bg", label: "Foreground → Background" }, { value: "fg-transparent", label: "Foreground → Transparent" }, { value: "bg-fg", label: "Background → Foreground" }] },
];

export class PixelGradientDrag {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
  }
  down(e) {
    this.t = paintTarget(this.app);
    if (!this.t || this.t.locked) return (this.t = null);
    this.p0 = [e.x, e.y];
    this.p1 = [e.x, e.y];
  }
  move(e) {
    if (!this.t) return;
    this.p1 = [e.x, e.y];
    if (e.shift) {
      const dx = this.p1[0] - this.p0[0];
      const dy = this.p1[1] - this.p0[1];
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const l = Math.hypot(dx, dy);
      this.p1 = [this.p0[0] + Math.cos(a) * l, this.p0[1] + Math.sin(a) * l];
    }
    this.app.requestOverlay();
  }
  up() {
    const t = this.t;
    this.t = null;
    if (!t) return;
    const app = this.app;
    const [x0, y0] = toLayer(t, ...this.p0);
    const [x1, y1] = toLayer(t, ...this.p1);
    if (Math.hypot(x1 - x0, y1 - y0) < 2) return;
    const W = t.canvas.width;
    const H = t.canvas.height;
    const fg = app.style.primary;
    const bg = app.style.secondary;
    const mode = this.opts.colors;
    const c0 = mode === "bg-fg" ? bg : fg;
    const c1 = mode === "fg-transparent" ? `${fg}00` : mode === "bg-fg" ? fg : bg;
    const before = t.ctx.getImageData(0, 0, W, H);
    const tmp = createCanvas(W, H);
    const tctx = tmp.getContext("2d");
    let g;
    const custom = this.opts.type === "reflected" || this.opts.type === "diamond";
    if (custom) tctx.putImageData(new ImageData(fillGradient(W, H, this.opts.type, [x0, y0], [x1, y1], c0, c1), W, H), 0, 0);
    else if (this.opts.type === "radial") g = tctx.createRadialGradient(x0, y0, 0, x0, y0, Math.hypot(x1 - x0, y1 - y0));
    else if (this.opts.type === "conic") g = tctx.createConicGradient(Math.atan2(y1 - y0, x1 - x0), x0, y0);
    else g = tctx.createLinearGradient(x0, y0, x1, y1);
    if (!custom) {
      g.addColorStop(0, cssColor(c0));
      g.addColorStop(1, c1.length === 9 ? `rgba(${parseInt(c1.slice(1, 3), 16)},${parseInt(c1.slice(3, 5), 16)},${parseInt(c1.slice(5, 7), 16)},0)` : cssColor(c1));
      tctx.fillStyle = g;
      tctx.fillRect(0, 0, W, H);
    }
    const sel = layerSpaceMask(app, t);
    if (sel) {
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(sel, 0, 0);
    }
    t.ctx.save();
    t.ctx.globalAlpha = app.brush.opacity;
    t.ctx.drawImage(tmp, 0, 0);
    t.ctx.restore();
    const after = t.ctx.getImageData(0, 0, W, H);
    commitPixelEdit(app, t, { x: 0, y: 0, before, after }, "Gradient");
    app.doc.touch(t.node);
    app.requestRender();
  }
  overlay(ctx) {
    if (!this.t) return;
    const a = this.app.pageToScreen(...this.p0);
    const b = this.app.pageToScreen(...this.p1);
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.stroke();
    ctx.strokeStyle = "#8b7cf6";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

export const PIXEL_PAINT_TOOLS = [BrushTool, PixelPencilTool, EraserTool];
export { maskCanvas, selectField };
