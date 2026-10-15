// Layout-studio tools and slices: Image Frame and Slice (+ slice overlay). Slices are exported from the export popup.
import { Tool } from "../../core/tool.js";
import { createNode, solid, defaultStroke } from "../../core/nodes.js";
import { translate, rectFromPoints } from "../../core/math.js";
import { addNodes } from "../../core/ops.js";
import { uid } from "../../core/util.js";
import { pick } from "../../engine/hit.js";

export class ImageFrameTool extends Tool {
  static id = "image-frame";
  static label = "Image Frame";
  static icon = "of:image-frame";
  static shortcut = "I";
  static studios = ["layout"];
  cursor = "crosshair";

  activate() {
    this.app.cv?.setCursor("crosshair");
  }
  pointerDown(e) {
    this.start = [e.x, e.y];
    this.cur = [e.x, e.y];
    this.moved = false;
    this.sx = e.sx;
    this.sy = e.sy;
  }
  pointerMove(e) {
    if (!this.start) return;
    this.cur = [e.x, e.y];
    if (Math.hypot(e.sx - this.sx, e.sy - this.sy) > 3) this.moved = true;
    this.app.requestOverlay();
  }
  pointerUp(e) {
    if (!this.start) return;
    const r = this.moved ? rectFromPoints(this.start[0], this.start[1], e.x, e.y) : { x: this.start[0] - 120, y: this.start[1] - 90, w: 240, h: 180 };
    this.start = null;
    if (r.w < 4 || r.h < 4) return;
    const node = createNode("rect", { name: "Image Frame", w: r.w, h: r.h, r: [0, 0, 0, 0], m: translate(r.x, r.y), fill: solid("#e5e7eb"), stroke: { ...defaultStroke("#9ca3af", 1) } });
    node.imageFrame = true;
    addNodes(this.app, node, { label: "Add Image Frame" });
    this.app.status("Place an image into the frame with File ▸ Place Image, or drop a file onto it.");
    this.app.requestOverlay();
  }
  overlay(ctx) {
    if (!this.start || !this.moved) return;
    const app = this.app;
    const [x0, y0] = app.pageToScreen(this.start[0], this.start[1]);
    const [x1, y1] = app.pageToScreen(this.cur[0], this.cur[1]);
    ctx.save();
    ctx.strokeStyle = "#8b7cf6";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }
}

// ------------------------------------------------------------------ slices

export class SliceTool extends Tool {
  static id = "slice";
  static label = "Slice";
  static icon = "of:slice";
  static shortcut = "S";
  static studios = ["vector", "layout"];
  cursor = "crosshair";
  drag = null;

  activate() {
    this.app.cv?.setCursor("crosshair");
  }

  #sliceAt(e) {
    const doc = this.app.doc;
    for (let i = doc.slices.length - 1; i >= 0; i--) {
      const s = doc.slices[i];
      if (s.page === e.page.id && e.x >= s.x && e.y >= s.y && e.x <= s.x + s.w && e.y <= s.y + s.h) return s;
    }
    return null;
  }

  pointerDown(e) {
    const app = this.app;
    const hit = this.#sliceAt(e);
    if (hit) {
      app.sliceSel = hit.id;
      this.drag = { kind: "move", s: hit, x: e.x, y: e.y, ox: hit.x, oy: hit.y, before: { x: hit.x, y: hit.y } };
      app.emit("slices");
      app.requestOverlay();
      return;
    }
    this.drag = { kind: "new", x0: e.x, y0: e.y, x1: e.x, y1: e.y, page: e.page };
  }
  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === "new") {
      d.x1 = e.x;
      d.y1 = e.y;
    } else {
      d.s.x = Math.round(d.ox + e.x - d.x);
      d.s.y = Math.round(d.oy + e.y - d.y);
    }
    this.app.requestOverlay();
  }
  pointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const app = this.app;
    const doc = app.doc;
    if (d.kind === "move") {
      const now = { x: d.s.x, y: d.s.y };
      d.s.x = d.before.x;
      d.s.y = d.before.y;
      doc.set(d.s, now, "Move Slice");
      app.emit("slices");
      return;
    }
    const r = rectFromPoints(d.x0, d.y0, d.x1, d.y1);
    if (r.w < 4 || r.h < 4) return;
    const slice = { id: uid("sl"), name: `Slice ${doc.slices.length + 1}`, page: d.page.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), format: "png", scale: 1, quality: 0.9 };
    doc.arrayInsert(doc.slices, slice, doc.slices.length, "Add Slice");
    app.sliceSel = slice.id;
    app.emit("slices");
    app.requestOverlay();
  }
  keyDown(ev) {
    if ((ev.key === "Delete" || ev.key === "Backspace") && this.app.sliceSel) {
      const s = this.app.doc.slices.find((x) => x.id === this.app.sliceSel);
      if (s) this.app.doc.arrayRemove(this.app.doc.slices, s, "Delete Slice");
      this.app.sliceSel = null;
      this.app.emit("slices");
      this.app.requestOverlay();
      return true;
    }
    return false;
  }
  overlay(ctx) {
    const d = this.drag;
    if (!d || d.kind !== "new") return;
    const app = this.app;
    const [x0, y0] = app.pageToScreen(d.x0, d.y0, d.page);
    const [x1, y1] = app.pageToScreen(d.x1, d.y1, d.page);
    ctx.save();
    ctx.strokeStyle = "#22d3ee";
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }
}

/** Draws slice rectangles while the Slice tool is active or the export popup's Slices tab is open. */
export function installSliceOverlay(app) {
  app.on("overlay-extra", (ctx) => {
    if (!app.doc || !(app.tool?.id === "slice" || app.sliceShow)) return;
    const view = app.view;
    ctx.save();
    ctx.font = "11px Inter, system-ui, sans-serif";
    for (const s of app.doc.slices) {
      const page = app.doc.page(s.page);
      if (!page) continue;
      const [x0, y0] = view.toScreen(page.x + s.x, page.y + s.y);
      const w = s.w * view.zoom;
      const h = s.h * view.zoom;
      const sel = s.id === app.sliceSel;
      ctx.strokeStyle = sel ? "#22d3ee" : "rgba(34,211,238,0.7)";
      ctx.fillStyle = sel ? "rgba(34,211,238,0.14)" : "rgba(34,211,238,0.06)";
      ctx.lineWidth = sel ? 2 : 1;
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, w, h);
      ctx.fillStyle = "#06b6d4";
      const label = `${s.name} · ${s.w}×${s.h}`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillRect(x0, y0 - 17, tw, 17);
      ctx.fillStyle = "#04222b";
      ctx.fillText(label, x0 + 5, y0 - 5);
    }
    ctx.restore();
  });
}

export const LAYOUT_TOOLS = [ImageFrameTool, SliceTool];
export { pick };
