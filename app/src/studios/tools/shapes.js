// Shape creation tools: rectangle, ellipse, polygon, star, line and preset shapes.
import { Tool } from "../../core/tool.js";
import { createNode, shapeGeometry } from "../../core/nodes.js";
import { translate } from "../../core/math.js";
import { addNodes, applyStyle } from "../../core/ops.js";
import { pathToData, dataToPath2D, linePath, pathBBox, transformPath } from "../../engine/vector/path.js";
import { SHAPE_PRESETS, getPreset } from "../../engine/vector/presets.js";
import { collectTargets, snapPoint } from "../../core/snap.js";
import { cssColor } from "../../core/color.js";

class ShapeTool extends Tool {
  static studios = ["vector", "layout", "pixel"];
  static group = "shapes";
  cursor = "crosshair";
  drawing = false;

  /** Build a node for the given page-space box. Subclasses override. */
  build(_x, _y, _w, _h, _e) {
    return null;
  }

  activate() {
    this.app.cv?.setCursor("crosshair");
  }

  pointerDown(e) {
    const app = this.app;
    const vis = app.view.visibleRect();
    this.targets = collectTargets(app.doc, app.page, { group: app.state.group, area: { x: vis.x - app.page.x, y: vis.y - app.page.y, w: vis.w, h: vis.h } });
    const s = this.#snap(e.x, e.y, e);
    this.start = s;
    this.cur = s;
    this.sx = e.sx;
    this.sy = e.sy;
    this.drawing = true;
    this.moved = false;
  }

  #snap(x, y, e) {
    if (this.app.doc.settings.snap === false || e?.ctrl) return [x, y];
    const s = snapPoint(x, y, this.targets, 6 / this.app.view.zoom);
    return [s.x, s.y];
  }

  box(e) {
    let [x1, y1] = this.#snap(e.x, e.y, e);
    let [x0, y0] = this.start;
    let dx = x1 - x0;
    let dy = y1 - y0;
    if (e.shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    if (e.alt) {
      x0 -= dx;
      y0 -= dy;
      dx *= 2;
      dy *= 2;
    }
    x1 = x0 + dx;
    y1 = y0 + dy;
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(dx), h: Math.abs(dy) };
  }

  pointerMove(e) {
    if (!this.drawing) return;
    if (Math.hypot(e.sx - this.sx, e.sy - this.sy) > 3) this.moved = true;
    this.cur = [e.x, e.y];
    this.lastE = e;
    this.app.status(`W ${this.box(e).w.toFixed(1)}  H ${this.box(e).h.toFixed(1)}`);
    this.app.requestOverlay();
  }

  pointerUp(e) {
    if (!this.drawing) return;
    this.drawing = false;
    this.app.status("");
    let b = this.box(e);
    if (!this.moved || b.w < 1 || b.h < 1) b = { x: this.start[0] - 50, y: this.start[1] - 50, w: 100, h: 100 };
    const node = this.build(b.x, b.y, b.w, b.h, e);
    if (node) addNodes(this.app, node, { label: `Add ${node.name}` });
    this.app.requestOverlay();
  }

  cancel() {
    this.drawing = false;
    this.app.requestOverlay();
  }

  keyDown(ev) {
    if (ev.key === "Escape" && this.drawing) {
      this.cancel();
      return true;
    }
    return false;
  }

  overlay(ctx) {
    if (!this.drawing || !this.lastE || !this.moved) return;
    const app = this.app;
    const b = this.box(this.lastE);
    const node = this.build(b.x, b.y, Math.max(b.w, 0.01), Math.max(b.h, 0.01), this.lastE);
    const geo = node && shapeGeometry(node);
    if (!geo) return;
    const [ox, oy] = app.pageToScreen(node.m[4], node.m[5]);
    const z = app.view.zoom;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(z, z);
    const p = dataToPath2D(pathToData(geo));
    if (node.fill && node.fill.type === "solid") {
      ctx.fillStyle = cssColor(node.fill.color, 0.55 * (node.fill.alpha ?? 1));
      ctx.fill(p);
    }
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = "#8b7cf6";
    ctx.stroke(p);
    ctx.restore();
  }
}

export class RectTool extends ShapeTool {
  static id = "rect";
  static label = "Rectangle";
  static icon = "square";
  static shortcut = "M";
  static options = [{ key: "radius", label: "Corner Radius", type: "range", min: 0, max: 200, step: 1, unit: "px", default: 0 }];
  build(x, y, w, h) {
    const n = createNode("rect", { w, h, r: [this.opts.radius, this.opts.radius, this.opts.radius, this.opts.radius], m: translate(x, y) });
    return applyStyle(this.app, n);
  }
}

export class EllipseTool extends ShapeTool {
  static id = "ellipse";
  static label = "Ellipse";
  static icon = "circle";
  static shortcut = "E";
  build(x, y, w, h) {
    return applyStyle(this.app, createNode("ellipse", { w, h, m: translate(x, y) }));
  }
}

export class PolygonTool extends ShapeTool {
  static id = "polygon";
  static label = "Polygon";
  static icon = "pentagon";
  static options = [
    { key: "sides", label: "Sides", type: "int", min: 3, max: 32, step: 1, default: 6 },
    { key: "radius", label: "Corner Radius", type: "range", min: 0, max: 100, step: 1, unit: "px", default: 0 },
  ];
  build(x, y, w, h) {
    return applyStyle(this.app, createNode("polygon", { w, h, sides: this.opts.sides, cr: this.opts.radius, m: translate(x, y) }));
  }
}

export class StarTool extends ShapeTool {
  static id = "star";
  static label = "Star";
  static icon = "star";
  static options = [
    { key: "points", label: "Points", type: "int", min: 3, max: 32, step: 1, default: 5 },
    { key: "ratio", label: "Inner Radius", type: "range", min: 0.1, max: 0.95, step: 0.01, default: 0.45 },
    { key: "radius", label: "Corner Radius", type: "range", min: 0, max: 50, step: 1, unit: "px", default: 0 },
  ];
  build(x, y, w, h) {
    return applyStyle(this.app, createNode("star", { w, h, points: this.opts.points, ratio: this.opts.ratio, cr: this.opts.radius, m: translate(x, y) }));
  }
}

export class PresetShapeTool extends ShapeTool {
  static id = "shapes";
  static label = "Shapes";
  static icon = "hexagon";
  static options = [{ key: "preset", label: "Shape", type: "select", options: SHAPE_PRESETS.map((p) => ({ value: p.id, label: p.label })), default: "heart" }];
  build(x, y, w, h) {
    const p = getPreset(this.opts.preset) || SHAPE_PRESETS[0];
    const node = createNode("path", { name: p.label, path: p.build(Math.max(w, 0.01), Math.max(h, 0.01)), rule: p.rule || "nonzero", m: translate(x, y) });
    return applyStyle(this.app, node);
  }
}

export class LineTool extends ShapeTool {
  static id = "line";
  static label = "Line";
  static icon = "slash-lg";
  static shortcut = "\\";

  pointerMove(e) {
    super.pointerMove(e);
  }
  box() {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  #end(e) {
    let [x1, y1] = this.start;
    let dx = e.x - x1;
    let dy = e.y - y1;
    if (e.shift) {
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const l = Math.hypot(dx, dy);
      dx = Math.cos(a) * l;
      dy = Math.sin(a) * l;
    }
    return [dx, dy];
  }
  pointerUp(e) {
    if (!this.drawing) return;
    this.drawing = false;
    if (!this.moved) return;
    const [dx, dy] = this.#end(e);
    const node = createNode("path", { name: "Line", path: linePath(0, 0, dx, dy), m: translate(this.start[0], this.start[1]) });
    applyStyle(this.app, node, { closed: false });
    addNodes(this.app, node, { label: "Add Line" });
    this.app.requestOverlay();
  }
  overlay(ctx) {
    if (!this.drawing || !this.moved || !this.lastE) return;
    const app = this.app;
    const [dx, dy] = this.#end(this.lastE);
    const [x0, y0] = app.pageToScreen(this.start[0], this.start[1]);
    const [x1, y1] = app.pageToScreen(this.start[0] + dx, this.start[1] + dy);
    ctx.save();
    ctx.strokeStyle = "#8b7cf6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }
}

export { pathBBox, transformPath };
