// Pen (Bézier) and Pencil (freehand) tools.
import { Tool } from "../../core/tool.js";
import { createNode } from "../../core/nodes.js";
import { addNodes, applyStyle } from "../../core/ops.js";
import { makeNode, pathToData, dataToPath2D, nearestOnPath } from "../../engine/vector/path.js";
import { fitSubpath, simplifyRDP } from "../../engine/vector/fit.js";
import { collectTargets, snapPoint } from "../../core/snap.js";
import { translate } from "../../core/math.js";

const ACCENT = "#8b7cf6";

export class PenTool extends Tool {
  static id = "pen";
  static label = "Pen";
  static icon = "vector-pen";
  static shortcut = "P";
  static studios = ["vector", "layout", "pixel"];
  static group = "draw";
  cursor = "crosshair";

  nodes = [];
  dragging = false;
  hoverPt = null;

  activate() {
    this.app.cv?.setCursor("crosshair");
  }

  #snap(e) {
    const app = this.app;
    if (app.doc.settings.snap === false || e.ctrl) return [e.x, e.y];
    if (!this.targets) {
      const vis = app.view.visibleRect();
      this.targets = collectTargets(app.doc, app.page, { group: app.state.group, area: { x: vis.x - app.page.x, y: vis.y - app.page.y, w: vis.w, h: vis.h } });
    }
    const s = snapPoint(e.x, e.y, this.targets, 6 / app.view.zoom);
    return [s.x, s.y];
  }

  #constrain(x, y, e) {
    if (!e.shift || !this.nodes.length) return [x, y];
    const last = this.nodes[this.nodes.length - 1];
    const dx = x - last.x;
    const dy = y - last.y;
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const l = Math.hypot(dx, dy);
    return [last.x + Math.cos(a) * l, last.y + Math.sin(a) * l];
  }

  pointerDown(e) {
    const app = this.app;
    this.page = e.page;
    let [x, y] = this.#snap(e);
    [x, y] = this.#constrain(x, y, e);
    const tol = 8 / app.view.zoom;
    if (this.nodes.length >= 2 && Math.hypot(x - this.nodes[0].x, y - this.nodes[0].y) < tol) {
      this.finish(true);
      return;
    }
    const n = makeNode(x, y);
    n.t = "cusp";
    this.nodes.push(n);
    this.dragging = true;
    this.cur = n;
    app.requestOverlay();
  }

  pointerMove(e) {
    if (!this.dragging || !this.cur) return;
    const [x, y] = this.#constrain(e.x, e.y, e);
    const n = this.cur;
    if (Math.hypot(x - n.x, y - n.y) < 2 / this.app.view.zoom) return;
    n.ox = x;
    n.oy = y;
    if (!e.alt) {
      n.ix = 2 * n.x - x;
      n.iy = 2 * n.y - y;
      n.t = "symmetric";
    }
    this.app.requestOverlay();
  }

  hover(e) {
    this.hoverPt = [e.x, e.y];
    this.lastE = e;
    this.app.requestOverlay();
  }

  pointerUp() {
    this.dragging = false;
    this.cur = null;
  }

  doubleClick() {
    // the second click of the double click already added a node at the same spot: drop it
    if (this.nodes.length > 1) {
      const a = this.nodes[this.nodes.length - 1];
      const b = this.nodes[this.nodes.length - 2];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1) this.nodes.pop();
    }
    this.finish(false);
  }

  keyDown(ev) {
    if (ev.key === "Enter") {
      this.finish(false);
      return true;
    }
    if (ev.key === "Escape") {
      if (this.nodes.length >= 2) this.finish(false);
      else this.cancel();
      return true;
    }
    if ((ev.key === "Backspace" || ev.key === "Delete") && this.nodes.length) {
      this.nodes.pop();
      this.app.requestOverlay();
      return true;
    }
    return false;
  }

  deactivate() {
    if (this.nodes.length >= 2) this.finish(false);
    else this.cancel();
  }

  /** Tool pill (ui/tool-pill.js): while a path is being drawn. */
  pillState() {
    const n = this.nodes.length;
    if (!n) return null;
    const actions = [{ id: "finish", label: "Finish path", key: "Enter", primary: true }];
    if (n >= 2) actions.push({ id: "close", label: "Close path" });
    actions.push({ id: "cancel", label: "Cancel", key: "Escape" });
    return { key: n === 1 ? "Drawing a path · 1 point" : "Drawing a path · {n} points", params: { n }, actions };
  }
  pillAction(id) {
    if (id === "finish") this.finish(false);
    else if (id === "close") this.finish(true);
    else this.cancel();
  }

  cancel() {
    this.nodes = [];
    this.dragging = false;
    this.cur = null;
    this.targets = null;
    this.app.requestOverlay();
  }

  finish(closed) {
    const app = this.app;
    const nodes = this.nodes;
    this.nodes = [];
    this.targets = null;
    this.dragging = false;
    if (nodes.length < 2) return app.requestOverlay();
    // when closing onto the first node, its incoming handle comes from the last node's drag
    const node = createNode("path", { name: closed ? "Shape" : "Curve", path: { subpaths: [{ closed, nodes }] }, rule: "nonzero" });
    applyStyle(app, node, { closed });
    addNodes(app, node, { label: "Add Curve" });
    app.requestOverlay();
  }

  overlay(ctx) {
    const app = this.app;
    if (!this.nodes.length) return;
    const page = this.page || app.page;
    const toS = (x, y) => app.pageToScreen(x, y, page);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ACCENT;
    const nodes = this.nodes;
    ctx.beginPath();
    const [sx, sy] = toS(nodes[0].x, nodes[0].y);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < nodes.length; i++) this.#segTo(ctx, toS, nodes[i - 1], nodes[i]);
    // rubber band to cursor
    if (this.hoverPt && !this.dragging) {
      const last = nodes[nodes.length - 1];
      const cur = this.lastE ? this.#constrain(...this.#snap(this.lastE), this.lastE) : this.hoverPt;
      this.#segTo(ctx, toS, last, { x: cur[0], y: cur[1], ix: null, iy: null });
    }
    ctx.stroke();
    // handles and nodes
    for (const n of nodes) {
      const [x, y] = toS(n.x, n.y);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      for (const [hx, hy] of [[n.ix, n.iy], [n.ox, n.oy]]) {
        if (hx == null) continue;
        const [px, py] = toS(hx, hy);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, 7);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = n === nodes[0] && nodes.length >= 2 ? "#fff" : ACCENT;
      ctx.fillRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
    }
    ctx.restore();
  }

  #segTo(ctx, toS, a, b) {
    const [bx, by] = toS(b.x, b.y);
    if (a.ox != null || b.ix != null) {
      const c1 = toS(a.ox ?? a.x, a.oy ?? a.y);
      const c2 = toS(b.ix ?? b.x, b.iy ?? b.y);
      ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], bx, by);
    } else ctx.lineTo(bx, by);
  }
}

export class PencilTool extends Tool {
  static id = "pencil";
  static label = "Pencil";
  static icon = "pencil";
  static shortcut = "N";
  static studios = ["vector", "layout"];
  static group = "draw";
  static options = [{ key: "smoothing", label: "Smoothing", type: "range", min: 0, max: 100, step: 1, unit: "%", default: 55 }];
  cursor = "crosshair";

  pts = null;

  activate() {
    this.app.cv?.setCursor("crosshair");
  }

  pointerDown(e) {
    this.page = e.page;
    this.pts = [[e.x, e.y]];
  }

  pointerMove(e) {
    if (!this.pts) return;
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(e.x - last[0], e.y - last[1]) * this.app.view.zoom < 2) return;
    this.pts.push([e.x, e.y]);
    this.app.requestOverlay();
  }

  pointerUp() {
    const app = this.app;
    const pts = this.pts;
    this.pts = null;
    if (!pts || pts.length < 2) return app.requestOverlay();
    const zoom = app.view.zoom;
    const k = this.opts.smoothing / 100;
    const closed = pts.length > 8 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) * zoom < 10;
    const simplified = simplifyRDP(pts, (0.3 + k * 2.2) / zoom);
    const sub = fitSubpath(closed ? simplified.slice(0, -1) : simplified, { closed, tolerance: (0.6 + k * 4) / zoom, cornerAngle: 55 });
    const node = createNode("path", { name: "Curve", path: { subpaths: [sub] } });
    applyStyle(app, node, { closed });
    addNodes(app, node, { label: "Pencil" });
    app.requestOverlay();
  }

  cancel() {
    this.pts = null;
    this.app.requestOverlay();
  }

  overlay(ctx) {
    if (!this.pts || this.pts.length < 2) return;
    const app = this.app;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    this.pts.forEach(([x, y], i) => {
      const [sx, sy] = app.pageToScreen(x, y, this.page);
      ctx[i ? "lineTo" : "moveTo"](sx, sy);
    });
    ctx.stroke();
    ctx.restore();
  }
}

export { pathToData, dataToPath2D, nearestOnPath, translate };
