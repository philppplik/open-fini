// Crop and Liquify tools.
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { Liquify } from "../../engine/pixel/index.js";
import { paintTarget, toLayer, commitPixelEdit } from "../../core/pixel.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { mul, translate, rectFromPoints } from "../../core/math.js";
import { walk, worldMatrix } from "../../core/nodes.js";
import { button } from "../../ui/controls.js";
import { setMask } from "../../core/pixel.js";
import { brushBar } from "./pixel-paint.js";

const RATIOS = { free: null, original: "original", "1:1": 1, "4:3": 4 / 3, "3:2": 3 / 2, "16:9": 16 / 9, "3:4": 3 / 4, "2:3": 2 / 3, "9:16": 9 / 16 };

/** Crops the active page to `rect` (page px). Content shifts so the crop origin becomes (0,0). */
export function cropPage(app, rect, { deletePixels = false } = {}) {
  const doc = app.doc;
  const page = app.page;
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.w));
  const hh = Math.max(1, Math.round(rect.h));
  doc.tx("Crop", () => {
    for (const n of page.root.children) doc.set(n, { m: mul(translate(-x, -y), n.m) });
    if (deletePixels) {
      const nodes = [];
      for (const c of page.root.children) walk(c, (n) => n.type === "pixel" && nodes.push(n));
      for (const n of nodes) {
        const W = worldMatrix(n);
        // only axis-aligned, unscaled layers can be cropped losslessly
        if (Math.abs(W[0] - 1) > 1e-6 || Math.abs(W[3] - 1) > 1e-6 || Math.abs(W[1]) > 1e-6 || Math.abs(W[2]) > 1e-6) continue;
        const src = doc.getPixels(n);
        const lx = Math.max(0, Math.round(-W[4]));
        const ly = Math.max(0, Math.round(-W[5]));
        const lw = Math.min(src.width - lx, Math.round(w - Math.max(0, W[4])));
        const lh = Math.min(src.height - ly, Math.round(hh - Math.max(0, W[5])));
        if (lw < 1 || lh < 1) continue;
        const c = createCanvas(lw, lh);
        ctx2d(c).drawImage(src, lx, ly, lw, lh, 0, 0, lw, lh);
        doc.replacePixels(n, c, { w: lw, h: lh, m: mul(translate(lx, ly), n.m) }, "Crop Pixels");
      }
    }
    const g = page.guides;
    doc.set(page, { w, h: hh, guides: { h: g.h.map((v) => v - y), v: g.v.map((v) => v - x) } });
  });
  app.state.pixelMask = null;
  app.state.maskRev = (app.state.maskRev | 0) + 1;
  app.cv?.fitPage();
}

export class CropTool extends Tool {
  static id = "crop";
  static label = "Crop";
  static icon = "of:crop";
  static shortcut = "C";
  static studios = ["pixel", "vector", "layout"];
  static options = [
    { key: "ratio", label: "Ratio", type: "select", default: "free", options: Object.keys(RATIOS).map((k) => ({ value: k, label: k === "free" ? "Free" : k === "original" ? "Original" : k })) },
    { key: "deletePixels", label: "Delete cropped pixels", type: "bool", default: false },
  ];
  cursor = "crosshair";
  rect = null;

  activate() {
    const p = this.app.page;
    this.rect = { x: 0, y: 0, w: p.w, h: p.h };
    this.app.cv?.setCursor("crosshair");
    this.app.requestOverlay();
  }
  deactivate() {
    this.rect = null;
  }
  refresh() {
    this.#applyRatio();
    this.app.requestOverlay();
  }
  #ratio() {
    const r = RATIOS[this.opts.ratio];
    return r === "original" ? this.app.page.w / this.app.page.h : r;
  }
  #applyRatio() {
    const r = this.#ratio();
    if (!r || !this.rect) return;
    this.rect.h = this.rect.w / r;
  }

  #hit(e) {
    const rect = this.rect;
    const z = this.app.view.zoom;
    const tol = 8 / z;
    const near = (a, b) => Math.abs(a - b) <= tol;
    const { x, y, w, h: hh } = rect;
    const l = near(e.x, x);
    const r = near(e.x, x + w);
    const t = near(e.y, y);
    const b = near(e.y, y + hh);
    const inX = e.x > x - tol && e.x < x + w + tol;
    const inY = e.y > y - tol && e.y < y + hh + tol;
    if (t && l) return "nw";
    if (t && r) return "ne";
    if (b && l) return "sw";
    if (b && r) return "se";
    if (t && inX) return "n";
    if (b && inX) return "s";
    if (l && inY) return "w";
    if (r && inY) return "e";
    if (e.x > x && e.x < x + w && e.y > y && e.y < y + hh) return "move";
    return null;
  }

  hover(e) {
    if (!this.rect) return;
    const h2 = this.#hit(e);
    const cur = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", w: "ew-resize", e: "ew-resize", move: "move" }[h2] || "crosshair";
    this.app.cv?.setCursor(cur);
  }

  pointerDown(e) {
    if (!this.rect) return;
    const hit = this.#hit(e);
    this.drag = hit ? { kind: hit, rect: { ...this.rect }, x: e.x, y: e.y } : { kind: "new", x: e.x, y: e.y };
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const page = this.app.page;
    const clampX = (v) => Math.max(0, Math.min(page.w, v));
    const clampY = (v) => Math.max(0, Math.min(page.h, v));
    if (d.kind === "new") {
      this.rect = rectFromPoints(clampX(d.x), clampY(d.y), clampX(e.x), clampY(e.y));
    } else if (d.kind === "move") {
      const dx = e.x - d.x;
      const dy = e.y - d.y;
      const r = d.rect;
      this.rect = { x: Math.max(0, Math.min(page.w - r.w, r.x + dx)), y: Math.max(0, Math.min(page.h - r.h, r.y + dy)), w: r.w, h: r.h };
    } else {
      const r = d.rect;
      let x0 = r.x;
      let y0 = r.y;
      let x1 = r.x + r.w;
      let y1 = r.y + r.h;
      if (d.kind.includes("w")) x0 = clampX(e.x);
      if (d.kind.includes("e")) x1 = clampX(e.x);
      if (d.kind.includes("n")) y0 = clampY(e.y);
      if (d.kind.includes("s")) y1 = clampY(e.y);
      this.rect = rectFromPoints(x0, y0, x1, y1);
      const ratio = this.#ratio();
      if (ratio) {
        if (d.kind === "n" || d.kind === "s") this.rect.w = this.rect.h * ratio;
        else this.rect.h = this.rect.w / ratio;
      }
    }
    this.app.status(`${Math.round(this.rect.w)} × ${Math.round(this.rect.h)} px`);
    this.app.requestOverlay();
  }

  pointerUp() {
    this.drag = null;
    if (this.rect && (this.rect.w < 4 || this.rect.h < 4)) this.activate();
    this.app.status("");
  }

  doubleClick() {
    this.apply();
  }

  apply() {
    if (!this.rect) return;
    const r = this.rect;
    const p = this.app.page;
    if (r.w >= p.w - 0.5 && r.h >= p.h - 0.5 && r.x < 0.5 && r.y < 0.5) return this.app.toast("Drag a crop area first.", "warning");
    cropPage(this.app, r, { deletePixels: this.opts.deletePixels });
    this.activate();
    this.app.setTool("move");
  }

  keyDown(ev) {
    if (ev.key === "Enter") {
      this.apply();
      return true;
    }
    if (ev.key === "Escape") {
      this.app.setTool("move");
      return true;
    }
    return false;
  }

  contextBar() {
    return h("div.of-row.of-inline", button("Apply crop", () => this.apply(), { variant: "primary" }), button("Cancel", () => this.app.setTool("move")));
  }

  overlay(ctx) {
    if (!this.rect) return;
    const app = this.app;
    const [x0, y0] = app.pageToScreen(this.rect.x, this.rect.y);
    const [x1, y1] = app.pageToScreen(this.rect.x + this.rect.w, this.rect.y + this.rect.h);
    const [px0, py0] = app.pageToScreen(0, 0);
    const [px1, py1] = app.pageToScreen(app.page.w, app.page.h);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(px0, py0, px1 - px0, py1 - py0);
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, x1 - x0, y1 - y0);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x0 + ((x1 - x0) * i) / 3, y0);
      ctx.lineTo(x0 + ((x1 - x0) * i) / 3, y1);
      ctx.moveTo(x0, y0 + ((y1 - y0) * i) / 3);
      ctx.lineTo(x1, y0 + ((y1 - y0) * i) / 3);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#8b7cf6";
    for (const [hx, hy] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]) {
      ctx.beginPath();
      ctx.rect(Math.round(hx) - 4, Math.round(hy) - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

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
