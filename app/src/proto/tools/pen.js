// Pen tool of the Proto Studio (P; docs/concepts/proto-studio.md §5.2): click for corner points, drag for smooth
// points (symmetric handles), click the first point to close the shape; Enter or a tool change finishes an open path,
// Escape finishes (or drops a single point), Backspace removes the last point. The path is built with the Vector
// studio's path model (engine/vector/path.js) and lands as ONE `vector` layer whose path data is relative to its box.
import { t } from "../../i18n/index.js";
import { makeNode, pathBBox, pathToSvgD, pathToData } from "../../engine/vector/path.js";
import { toScreen } from "../camera.js";
import { placement, createLayer } from "./draw.js";

/** The vector layer fields of a pen path (points with absolute handles in world units) placed in a parent at `origin`. */
export function vectorFields(points, closed, origin = { x: 0, y: 0 }) {
  const path = { subpaths: [{ closed, nodes: points.map((p) => makeNode(p.x, p.y, p.ix ?? null, p.iy ?? null, p.ox ?? null, p.oy ?? null)) }] };
  const bb = pathBBox(path) || { x: points[0].x, y: points[0].y, w: 0, h: 0 };
  const d = pathToSvgD(path, [1, 0, 0, 1, -bb.x, -bb.y], 2);
  const r = (v) => Math.round(v * 100) / 100;
  return {
    x: r(bb.x - origin.x),
    y: r(bb.y - origin.y),
    w: { mode: "fixed", value: Math.max(1, r(bb.w)) },
    h: { mode: "fixed", value: Math.max(1, r(bb.h)) },
    d,
    fills: closed ? [{ type: "solid", color: "#d4d4d8" }] : [],
    strokes: [{ color: "#18181b", w: 1, align: "center" }],
  };
}

export function createPenTool(ws) {
  let pts = [];
  let drag = null;
  let cursor = null;

  function finish(closed = false, back = true) {
    const list = pts;
    pts = [];
    drag = null;
    ws.requestDraw();
    if (list.length < 2) return;
    const first = list[0];
    const where = placement(ws, first);
    const pb = where.parent != null ? ws.box(where.parent) || { x: 0, y: 0 } : { x: 0, y: 0 };
    const fields = vectorFields(list, closed, pb);
    if (where.flow) {
      delete fields.x;
      delete fields.y;
    }
    createLayer(ws, "vector", where, fields, t("Draw path"));
    if (back) ws.tools.set("move");
  }

  return {
    id: "pen",
    cursor: "crosshair",
    down({ e, stage: p, world: w }) {
      if (ws.readOnly || e.button !== 0) return false;
      if (pts.length >= 2) {
        const f = toScreen(ws.view.camera, pts[0].x, pts[0].y);
        if (Math.hypot(f.x - p.x, f.y - p.y) <= 6) {
          finish(true);
          return true;
        }
      }
      const pt = { x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100 };
      pts.push(pt);
      drag = pt;
      ws.requestDraw();
      return true;
    },
    move({ world: w }) {
      cursor = w;
      if (drag && Math.hypot(w.x - drag.x, w.y - drag.y) > 1 / ws.view.camera.zoom) {
        drag.ox = w.x;
        drag.oy = w.y;
        drag.ix = 2 * drag.x - w.x;
        drag.iy = 2 * drag.y - w.y;
      }
      ws.requestDraw();
    },
    hover({ world: w }) {
      cursor = w;
      ws.setHover(null);
      if (pts.length) ws.requestDraw();
    },
    up() {
      drag = null;
    },
    key(e) {
      if (!pts.length) return false;
      if (e.key === "Enter" || e.key === "Escape") {
        finish(false);
        return true;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        pts.pop();
        ws.requestDraw();
        return true;
      }
      return false;
    },
    draw(ctx, s) {
      if (!pts.length) return;
      const cam = s.cam;
      const accent = s.accent || "#0d99ff";
      const path = { subpaths: [{ closed: false, nodes: pts.map((p) => makeNode(p.x, p.y, p.ix ?? null, p.iy ?? null, p.ox ?? null, p.oy ?? null)) }] };
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const c of pathToData(path)) {
        const q = (i) => toScreen(cam, c[i], c[i + 1]);
        if (c[0] === "M") ctx.moveTo(q(1).x, q(1).y);
        else if (c[0] === "L") ctx.lineTo(q(1).x, q(1).y);
        else if (c[0] === "C") ctx.bezierCurveTo(q(1).x, q(1).y, q(3).x, q(3).y, q(5).x, q(5).y);
      }
      const lastPt = pts[pts.length - 1];
      if (cursor && !drag) {
        const a = toScreen(cam, lastPt.x, lastPt.y);
        const b = toScreen(cam, cursor.x, cursor.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
      for (const p of pts) {
        const a = toScreen(cam, p.x, p.y);
        if (p.ox != null) {
          const o = toScreen(cam, p.ox, p.oy);
          const i = toScreen(cam, p.ix, p.iy);
          ctx.beginPath();
          ctx.moveTo(i.x, i.y);
          ctx.lineTo(o.x, o.y);
          ctx.stroke();
        }
        ctx.fillStyle = p === pts[0] && pts.length > 1 ? accent : "#ffffff";
        ctx.fillRect(Math.round(a.x) - 3, Math.round(a.y) - 3, 7, 7);
        ctx.strokeRect(Math.round(a.x) - 2.5, Math.round(a.y) - 2.5, 6, 6);
      }
    },
    deactivate() {
      if (pts.length >= 2) finish(false, false);
      pts = [];
      drag = null;
    },
  };
}
