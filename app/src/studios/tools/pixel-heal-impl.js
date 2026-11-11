// Interaction of the Patch and Object Eraser tools (loaded on first activation by pixel-heal.js).
//
// Patch: without a selection (or outside it) drag a freehand outline around the area; then drag from inside the
// selection to the place whose texture should replace it (mode "source"), or to where the selected pixels should be
// copied (mode "destination"). On release the pixels blend into their new surroundings (heal-ops.js patchArea).
// Object Eraser: paint over an object; on release the painted area is filled from its surroundings
// (heal-ops.js contentAwareFill). Both are one undo step each; the work runs on the worker pool.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { getMask, setMask, paintTarget, Mask } from "../../core/pixel.js";
import { brushBar } from "./pixel-paint.js";

const ops = () => import("./heal-ops.js");

/** Runs an async edit with a status text; toasts the reason when it declined. */
async function busy(app, text, fn) {
  app.status(text);
  try {
    const r = await fn();
    if (r !== true) app.toast(r, "warning", 6000);
  } catch (err) {
    app.toast(String(err?.message || err), "danger", 6000);
  } finally {
    app.status("");
    app.requestOverlay();
  }
}

function strokeLine(ctx, app, pts, close, color = "#fff") {
  ctx.save();
  ctx.lineWidth = 1;
  for (const [col, off] of [[color, 0], ["#000", 4]]) {
    ctx.strokeStyle = col;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = off;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) ctx[i ? "lineTo" : "moveTo"](...app.pageToScreen(pts[i], pts[i + 1]));
    if (close) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export class PatchImpl {
  constructor(app, tool) {
    this.app = app;
    this.tool = tool;
    this.pts = null;
    this.drag = null;
    this.working = false;
  }
  get opts() {
    return this.tool.opts;
  }
  cancel() {
    this.pts = null;
    this.drag = null;
    this.app.requestOverlay();
  }
  #inside(e) {
    const m = getMask(this.app);
    return !!m && m.get(Math.floor(e.x), Math.floor(e.y)) >= 128;
  }
  hover(e) {
    this.app.cv?.setCursor(this.#inside(e) ? "move" : "crosshair");
  }
  pointerDown(e) {
    if (this.working) return;
    if (this.#inside(e)) {
      const b = getMask(this.app).bounds(128);
      this.drag = { x: e.x, y: e.y, dx: 0, dy: 0, b };
    } else this.pts = [e.x, e.y];
  }
  pointerMove(e) {
    const app = this.app;
    if (this.drag) {
      this.drag.dx = e.x - this.drag.x;
      this.drag.dy = e.y - this.drag.y;
      app.status(`Δ ${Math.round(this.drag.dx)}, ${Math.round(this.drag.dy)} px`);
    } else if (this.pts) {
      const n = this.pts.length;
      if (Math.hypot(e.x - this.pts[n - 2], e.y - this.pts[n - 1]) * app.view.zoom < 2) return;
      this.pts.push(e.x, e.y);
    }
    app.requestOverlay();
  }
  pointerUp() {
    const app = this.app;
    if (this.pts) {
      const pts = this.pts;
      this.pts = null;
      if (pts.length >= 6) setMask(app, Mask.polygon(Math.round(app.page.w), Math.round(app.page.h), pts, { antialias: true }), "Patch Selection");
      return app.requestOverlay();
    }
    const d = this.drag;
    this.drag = null;
    app.status("");
    if (!d || Math.hypot(d.dx, d.dy) < 1) return app.requestOverlay();
    this.working = true;
    busy(app, t("Patching…"), async () => (await ops()).patchArea(app, { dx: d.dx, dy: d.dy, mode: this.opts.mode, blend: this.opts.blend })).finally(() => (this.working = false));
  }
  contextBar() {
    return h("div.of-row.of-inline", h("span.of-hint", t("Draw around the area, then drag the selection to a clean spot")));
  }
  overlay(ctx) {
    const app = this.app;
    if (this.pts) strokeLine(ctx, app, this.pts, false);
    const d = this.drag;
    if (!d) return;
    const { x, y, width: w, height: hh } = d.b;
    // the box shows where the pixels come from (source mode) or go to (destination mode)
    const q = [x + d.dx, y + d.dy, x + d.dx + w, y + d.dy, x + d.dx + w, y + d.dy + hh, x + d.dx, y + d.dy + hh];
    strokeLine(ctx, app, q, true, "#ff4fa3");
    ctx.save();
    ctx.strokeStyle = "#ff4fa3";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(...app.pageToScreen(x + w / 2, y + hh / 2));
    ctx.lineTo(...app.pageToScreen(x + w / 2 + d.dx, y + hh / 2 + d.dy));
    ctx.stroke();
    ctx.restore();
  }
}

export class ObjectEraserImpl {
  constructor(app, tool) {
    this.app = app;
    this.tool = tool;
    this.pts = null; // page points of the current stroke
    this.strokes = [];
    this.hoverPt = null;
    this.working = false;
  }
  get opts() {
    return this.tool.opts;
  }
  cancel() {
    this.pts = null;
    this.app.requestOverlay();
  }
  hover(e) {
    this.hoverPt = [e.x, e.y];
    this.app.requestOverlay();
  }
  pointerDown(e) {
    if (this.working) return;
    const tg = paintTarget(this.app, { create: false });
    if (!tg || tg.isMask) return this.app.toast("Select a pixel layer first.", "warning");
    this.pts = [e.x, e.y];
    this.size = this.app.brush.size;
    this.app.requestOverlay();
  }
  pointerMove(e) {
    this.hoverPt = [e.x, e.y];
    if (this.pts) {
      const n = this.pts.length;
      if (Math.hypot(e.x - this.pts[n - 2], e.y - this.pts[n - 1]) * this.app.view.zoom >= 2) this.pts.push(e.x, e.y);
    }
    this.app.requestOverlay();
  }
  pointerUp() {
    const app = this.app;
    const pts = this.pts;
    this.pts = null;
    if (!pts) return;
    const tg = paintTarget(app, { create: false });
    if (!tg || tg.isMask) return app.requestOverlay();
    // the stroke in layer pixels: drawn through the page → layer matrix, so rotated or scaled layers work too
    const area = createCanvas(tg.canvas.width, tg.canvas.height);
    const g = ctx2d(area);
    g.setTransform(tg.inv[0], tg.inv[1], tg.inv[2], tg.inv[3], tg.inv[4], tg.inv[5]);
    g.strokeStyle = g.fillStyle = "#000";
    g.lineWidth = this.size;
    g.lineCap = g.lineJoin = "round";
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    if (pts.length === 2) g.lineTo(pts[0] + 0.01, pts[1]);
    g.stroke();
    this.working = true;
    this.strokes = [{ pts, size: this.size }];
    busy(app, t("Erasing the object…"), async () => (await ops()).contentAwareFill(app, { area, method: this.opts.method, grow: Number(this.opts.grow) || 0, label: "Object Eraser" })).finally(() => {
      this.working = false;
      this.strokes = [];
      app.requestOverlay();
    });
  }
  contextBar() {
    return h("div.of-row.of-inline", brushBar(this.app, { opacity: false, flow: false, hardness: false }), h("span.of-hint", t("Paint over the object to remove it")));
  }
  overlay(ctx) {
    const app = this.app;
    const z = app.view.zoom;
    const paint = (pts, size) => {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 60, 90, 0.45)";
      ctx.lineWidth = Math.max(1, size * z);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(...app.pageToScreen(pts[0], pts[1]));
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(...app.pageToScreen(pts[i], pts[i + 1]));
      if (pts.length === 2) ctx.lineTo(...app.pageToScreen(pts[0] + 0.01, pts[1]));
      ctx.stroke();
      ctx.restore();
    };
    for (const s of this.strokes) paint(s.pts, s.size);
    if (this.pts) paint(this.pts, this.size);
    if (this.hoverPt) {
      const [x, y] = app.pageToScreen(...this.hoverPt);
      const r = Math.max(2, (app.brush.size / 2) * z);
      ctx.save();
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.beginPath();
      ctx.arc(x, y, r + 1, 0, 7);
      ctx.stroke();
      ctx.restore();
    }
  }
}
