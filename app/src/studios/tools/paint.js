// Vector paint tools: Gradient (interactive on-canvas gradient editing) and Fill (applies the current style).
// The same ids are reused by the Pixel studio, whose tool set overrides behavior when app.studio === "pixel".
import { Tool } from "../../core/tool.js";
import { clone } from "../../core/util.js";
import { linearGradient, radialGradient, conicGradient, solid, worldMatrix, shapeGeometry, hasFillStroke } from "../../core/nodes.js";
import { apply, invert, snapAngle } from "../../core/math.js";
import { pathBBox } from "../../engine/vector/path.js";
import { pick } from "../../engine/hit.js";
import { toHex6 } from "../../core/color.js";
import { segmented } from "../../ui/controls.js";
import { h } from "../../core/util.js";
import { pixelFill, PixelGradientDrag, FILL_OPTIONS, PIXEL_GRADIENT_OPTIONS } from "./pixel-paint.js";

const ACCENT = "#8b7cf6";

/** Local bbox the gradient's unit coordinates refer to. */
function geoBox(node) {
  const g = shapeGeometry(node);
  if (g) return pathBBox(g) || { x: 0, y: 0, w: 1, h: 1 };
  if (node.type === "text") return node._bounds || { x: 0, y: 0, w: node.w || 1, h: node.h || 1 };
  return { x: 0, y: 0, w: node.w || 1, h: node.h || 1 };
}

export class GradientTool extends Tool {
  static id = "gradient";
  static label = "Gradient";
  static icon = "of:gradient";
  static shortcut = "G";
  static studios = ["vector", "layout", "pixel"];
  static group = "paint";
  static options = PIXEL_GRADIENT_OPTIONS;
  /** Options shown in the context bar: pixel mode paints with the foreground/background colors. */
  static getOptions(studio) {
    return studio === "pixel" ? PIXEL_GRADIENT_OPTIONS : [];
  }
  cursor = "crosshair";

  target = null;
  drag = null;

  activate() {
    this.app.cv?.setCursor("crosshair");
    this.refresh();
  }

  get #px() {
    if (this.app.studio !== "pixel") return null;
    return this._px || (this._px = new PixelGradientDrag(this.app, this.opts));
  }

  refresh() {
    const sel = this.app.selection.filter(hasFillStroke);
    this.target = sel.length === 1 ? sel[0] : null;
    this.app.requestOverlay();
  }

  get fill() {
    return this.target?.fill && this.target.fill.type !== "solid" ? this.target.fill : null;
  }

  /** Unit → page. */
  toPage(u, v) {
    const b = geoBox(this.target);
    const [x, y] = apply(worldMatrix(this.target), b.x + u * b.w, b.y + v * b.h);
    return [x, y];
  }
  toUnit(px, py) {
    const b = geoBox(this.target);
    const inv = invert(worldMatrix(this.target));
    const [x, y] = apply(inv, px, py);
    return [(x - b.x) / (b.w || 1), (y - b.y) / (b.h || 1)];
  }

  handles() {
    const f = this.fill;
    if (!f) return [];
    if (f.type === "linear") return [{ id: "p0", p: this.toPage(f.x0, f.y0) }, { id: "p1", p: this.toPage(f.x1, f.y1) }];
    if (f.type === "radial") {
      const c = this.toPage(f.cx, f.cy);
      const b = geoBox(this.target);
      const edge = this.toPage(f.cx + f.r * (Math.max(b.w, b.h) / (b.w || 1)), f.cy);
      return [{ id: "c", p: c }, { id: "r", p: edge }];
    }
    const c = this.toPage(f.cx, f.cy);
    const b = geoBox(this.target);
    const rr = Math.max(b.w, b.h) * 0.35;
    return [{ id: "c", p: c }, { id: "a", p: [c[0] + Math.cos(f.angle || 0) * rr, c[1] + Math.sin(f.angle || 0) * rr] }];
  }

  pointerDown(e) {
    const app = this.app;
    const doc = app.doc;
    if (this.#px) return this.#px.down(e);
    if (!this.target) {
      const hit = pick(app.context, e.x, e.y, 5 / app.view.zoom, { deep: true });
      if (hit && hasFillStroke(hit)) {
        app.select([hit]);
        this.refresh();
      }
      if (!this.target) return;
    }
    this.before = doc.snapshot(this.target, ["fill"]);
    // grab an existing handle
    const tol = 8 / app.view.zoom;
    for (const hd of this.handles()) {
      if (Math.hypot(hd.p[0] - e.x, hd.p[1] - e.y) <= tol) {
        this.drag = { kind: "handle", id: hd.id };
        return;
      }
    }
    // otherwise start a new gradient from this drag
    const base = this.target.fill;
    const t = this.fill?.type || this.opts.type || "linear";
    const c0 = base?.type === "solid" ? toHex6(base.color) : toHex6(app.style.fill?.type === "solid" ? app.style.fill.color : "#7c6df2");
    let g;
    if (this.fill) g = clone(this.fill);
    else g = t === "radial" ? radialGradient(c0, "#ffffff") : t === "conic" ? conicGradient(c0, "#22d3ee") : linearGradient(c0, "#22d3ee");
    this.target.fill = g;
    const [u, v] = this.toUnit(e.x, e.y);
    if (g.type === "linear") Object.assign(g, { x0: u, y0: v, x1: u, y1: v });
    else Object.assign(g, { cx: u, cy: v });
    this.drag = { kind: "new", u0: u, v0: v };
    app.doc.touch(this.target);
    app.requestRender();
  }

  pointerMove(e) {
    if (this.#px) return this.#px.move(e);
    if (!this.drag || !this.target) return;
    const f = this.target.fill;
    let [u, v] = this.toUnit(e.x, e.y);
    if (this.drag.kind === "new") {
      if (f.type === "linear") {
        if (e.shift) [u, v] = this.#snapAxis(f.x0, f.y0, u, v);
        f.x1 = u;
        f.y1 = v;
      } else if (f.type === "radial") {
        const b = geoBox(this.target);
        f.r = Math.hypot((u - f.cx) * b.w, (v - f.cy) * b.h) / Math.max(b.w, b.h, 1);
      } else {
        f.angle = Math.atan2(v - f.cy, u - f.cx);
      }
    } else {
      const id = this.drag.id;
      if (f.type === "linear") {
        if (e.shift) [u, v] = this.#snapAxis(id === "p0" ? f.x1 : f.x0, id === "p0" ? f.y1 : f.y0, u, v);
        if (id === "p0") [f.x0, f.y0] = [u, v];
        else [f.x1, f.y1] = [u, v];
      } else if (f.type === "radial") {
        if (id === "c") [f.cx, f.cy, f.fx, f.fy] = [u, v, u, v];
        else {
          const b = geoBox(this.target);
          f.r = Math.max(0.001, Math.hypot((u - f.cx) * b.w, (v - f.cy) * b.h) / Math.max(b.w, b.h, 1));
        }
      } else if (id === "c") [f.cx, f.cy] = [u, v];
      else f.angle = e.shift ? snapAngle(Math.atan2(v - f.cy, u - f.cx)) : Math.atan2(v - f.cy, u - f.cx);
    }
    this.app.doc.touch(this.target);
    this.app.requestRender();
    this.app.requestOverlay();
  }

  #snapAxis(x0, y0, u, v) {
    const b = geoBox(this.target);
    const dx = (u - x0) * b.w;
    const dy = (v - y0) * b.h;
    const a = snapAngle(Math.atan2(dy, dx), Math.PI / 4);
    const l = Math.hypot(dx, dy);
    return [x0 + (Math.cos(a) * l) / (b.w || 1), y0 + (Math.sin(a) * l) / (b.h || 1)];
  }

  pointerUp() {
    if (this.#px) return this.#px.up();
    if (this.drag && this.target && this.before) this.app.doc.recordSet(this.target, this.before, "Gradient");
    this.drag = null;
    this.before = null;
    this.app.emit("docchange", {});
    this.app.requestOverlay();
  }

  doubleClick(e) {
    // add a color stop where the line is double-clicked
    const f = this.fill;
    if (!f || f.type !== "linear") return;
    const [u, v] = this.toUnit(e.x, e.y);
    const dx = f.x1 - f.x0;
    const dy = f.y1 - f.y0;
    const t = Math.max(0, Math.min(1, ((u - f.x0) * dx + (v - f.y0) * dy) / (dx * dx + dy * dy || 1)));
    const before = this.app.doc.snapshot(this.target, ["fill"]);
    const g = clone(f);
    const sorted = [...g.stops].sort((a, b) => a.o - b.o);
    const right = sorted.find((s) => s.o >= t) || sorted[sorted.length - 1];
    g.stops.push({ o: t, color: right.color, alpha: right.alpha ?? 1 });
    this.target.fill = g;
    this.app.doc.touch(this.target);
    this.app.doc.recordSet(this.target, before, "Add Gradient Stop");
  }

  contextBar() {
    if (this.app.studio === "pixel") return null;
    const f = this.fill;
    const type = f?.type || this.opts.type || "linear";
    const seg = segmented(
      [
        { value: "linear", label: "Linear", icon: "grad-linear", lib: "of" },
        { value: "radial", label: "Radial", icon: "grad-radial", lib: "of" },
        { value: "conic", label: "Conical", icon: "grad-conic", lib: "of" },
      ],
      type,
      (t) => {
        this.opts.type = t;
        if (this.target && f) {
          const doc = this.app.doc;
          const base = f.stops.map((s) => ({ ...s }));
          const g = t === "radial" ? radialGradient() : t === "conic" ? conicGradient() : linearGradient();
          g.stops = base;
          doc.set(this.target, { fill: g }, "Gradient Type");
          this.refresh();
        }
      },
    );
    return h("div.of-row.of-inline", seg.el);
  }

  overlay(ctx) {
    if (this.#px) return this.#px.overlay(ctx);
    if (!this.target) return;
    const f = this.fill;
    if (!f) return;
    const app = this.app;
    const page = this.target._page;
    const S = (p) => app.pageToScreen(p[0], p[1], page);
    ctx.save();
    ctx.lineWidth = 1.5;
    const hs = this.handles();
    if (f.type === "linear") {
      const a = S(hs[0].p);
      const b = S(hs[1].p);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
      // stops along the line
      for (const s of f.stops) {
        const x = a[0] + (b[0] - a[0]) * s.o;
        const y = a[1] + (b[1] - a[1]) * s.o;
        ctx.fillStyle = s.color;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
    } else if (f.type === "radial") {
      const c = S(hs[0].p);
      const r = S(hs[1].p);
      const rad = Math.hypot(r[0] - c[0], r[1] - c[1]);
      ctx.strokeStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(c[0], c[1], rad, 0, 7);
      ctx.stroke();
    } else {
      const c = S(hs[0].p);
      const a = S(hs[1].p);
      ctx.strokeStyle = ACCENT;
      ctx.beginPath();
      ctx.moveTo(...c);
      ctx.lineTo(...a);
      ctx.stroke();
    }
    for (const hd of hs) {
      const [x, y] = S(hd.p);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 7);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Fill tool. Vector/layout: applies the current fill style to the clicked object. Pixel: see pixel tool set. */
export class FillTool extends Tool {
  static id = "fill";
  static label = "Fill";
  static icon = "paint-bucket";
  static shortcut = "F";
  static studios = ["vector", "layout", "pixel"];
  static group = "paint";
  static options = FILL_OPTIONS;
  static getOptions(studio) {
    return studio === "pixel" ? FILL_OPTIONS : [];
  }
  cursor = "copy";
  pointerDown(e) {
    const app = this.app;
    if (app.studio === "pixel") return pixelFill(app, e, this.opts);
    const hit = pick(app.context, e.x, e.y, 5 / app.view.zoom, { deep: !e.ctrl });
    if (!hit || !hasFillStroke(hit)) return;
    const f = e.alt ? null : app.style.fill ? clone(app.style.fill) : solid("#7c6df2");
    app.select([hit]);
    app.doc.set(hit, { fill: f }, "Fill");
  }
}
