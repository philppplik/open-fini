// Drawing tools of the Proto Studio (docs/concepts/proto-studio.md §5.2): Frame (F), Rectangle (R), Ellipse (O) and
// Line (L) draw by dragging (Shift: square, circle or 45° steps; Alt: from the center) or place a default size with a
// click; Zoom (Z) zooms in on a click (Alt: out) or to a dragged rect. A new layer goes into the frame under the
// pointer (into its flow at the pointer when it has auto layout) and is ONE undo step; the Move tool comes back after.
import { t, N_ } from "../../i18n/index.js";
import { field } from "../../engine/proto/schema.js";
import { normRect } from "../geometry.js";
import { toScreen } from "../camera.js";
import * as M from "./math.js";
import { snapTargets, snapRect } from "./snap.js";
import { containerAt, childBoxes, inFlow, snapBoxes, stageRect, badge, drawGuides, outline } from "./common.js";

export const TYPE_NAMES = { frame: N_("Frame"), rect: N_("Rectangle"), ellipse: N_("Ellipse"), line: N_("Line"), vector: N_("Vector"), text: N_("Text") };

/** "Rectangle 3": the type's name and the next number among the page's layers of that type. */
export function layerName(model, type, page) {
  const base = t(TYPE_NAMES[type] || "Layer");
  let n = 0;
  for (const node of Object.values(model.nodes)) if (node.type === type && node.page === page) n++;
  return `${base} ${n + 1}`;
}

/**
 * Where a new layer goes for a world point: { parent, index?, at } with `at` the point in the parent's coordinates
 * and `index` the flow position in an auto layout parent.
 */
export function placement(ws, w) {
  const model = ws.model();
  const parent = containerAt(ws, w);
  const pb = parent != null ? ws.box(parent) : null;
  const lt = parent != null ? field(model.nodes[parent], "layout")?.type : "none";
  const out = { parent, at: { x: w.x - (pb?.x || 0), y: w.y - (pb?.y || 0) }, flow: lt === "flex" || lt === "grid" };
  if (out.flow) {
    const kids = childBoxes(ws, parent).filter((e) => inFlow(model, e.id));
    out.index = M.insertionAt(kids, w, lt === "grid" ? "row" : field(model.nodes[parent], "layout").dir || "row").index;
  }
  return out;
}

/** Creates a layer from a tool and selects it (one undo step). */
export function createLayer(ws, type, where, fields, label) {
  const op = { op: "node.create", type, page: ws.page, parent: where.parent, fields: { name: layerName(ws.model(), type, ws.page), ...fields } };
  if (where.index !== undefined) op.index = where.index;
  const res = ws.apply(op, label);
  if (res?.ids?.[0]) ws.select([res.ids[0]]);
  return res;
}

const DEFAULT_SIZE = { frame: 100, rect: 100, ellipse: 100 };
const ADD_LABELS = { frame: N_("Add frame"), rect: N_("Add rectangle"), ellipse: N_("Add ellipse") };

/** Frame, Rectangle and Ellipse. */
export function createShapeTool(ws, type) {
  let st = null;
  const snap = (w, e) => {
    const p = { x: Math.round(w.x), y: Math.round(w.y) };
    if (e.ctrlKey || e.metaKey) return { p, guides: [] };
    const parent = containerAt(ws, st ? st.w0 : w);
    const s = snapRect({ x: p.x, y: p.y, w: 0, h: 0 }, snapTargets(snapBoxes(ws, parent, new Set())), 5 / ws.view.camera.zoom, { x: ["start"], y: ["start"] });
    return { p: { x: p.x + s.dx, y: p.y + s.dy }, guides: s.guides };
  };
  return {
    id: type,
    cursor: "crosshair",
    down({ e, world: w }) {
      if (ws.readOnly || e.button !== 0) return false;
      st = null;
      const s = snap(w, e);
      st = { w0: s.p, w1: s.p, raw: w, rect: null, guides: s.guides };
      return true;
    },
    move({ e, world: w }) {
      if (!st) return;
      const s = snap(w, e);
      st.w1 = s.p;
      st.guides = s.guides;
      st.rect = M.dragRect(st.w0.x, st.w0.y, st.w1.x, st.w1.y, { square: e.shiftKey, center: e.altKey });
      ws.requestDraw();
    },
    hover({ e, world: w }) {
      ws.setHover(null);
      const s = snap(w, e);
      st = null;
      this._guides = s.guides;
      ws.requestDraw();
    },
    up() {
      const s = st;
      st = null;
      if (!s) return;
      const click = !s.rect || (s.rect.w < 2 && s.rect.h < 2);
      const size = DEFAULT_SIZE[type];
      const r = click ? { x: s.w0.x, y: s.w0.y, w: size, h: size } : s.rect;
      const where = placement(ws, { x: r.x + 0.5, y: r.y + 0.5 });
      const fields = { w: { mode: "fixed", value: Math.max(1, r.w) }, h: { mode: "fixed", value: Math.max(1, r.h) } };
      if (!where.flow) Object.assign(fields, { x: Math.round(where.at.x), y: Math.round(where.at.y) });
      createLayer(ws, type, where, fields, t(ADD_LABELS[type]));
      ws.tools.set("move");
    },
    draw(ctx, s) {
      const cam = s.cam;
      drawGuides(ctx, cam, st ? st.guides : this._guides);
      if (!st?.rect) return;
      const accent = s.accent || "#0d99ff";
      if (type === "ellipse") {
        const r = stageRect(cam, st.rect);
        ctx.strokeStyle = accent;
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.5, r.w / 2), Math.max(0.5, r.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      outline(ctx, cam, st.rect, accent);
      const r = stageRect(cam, st.rect);
      badge(ctx, r.x + r.w / 2, r.y + r.h + 14, `${Math.round(st.rect.w)} × ${Math.round(st.rect.h)}`, accent);
    },
    deactivate() {
      st = null;
      this._guides = null;
    },
  };
}

/** Line: drag from one end to the other (Shift: 45° steps). */
export function createLineTool(ws) {
  let st = null;
  return {
    id: "line",
    cursor: "crosshair",
    down({ e, world: w }) {
      if (ws.readOnly || e.button !== 0) return false;
      st = { w0: { x: Math.round(w.x), y: Math.round(w.y) }, line: null };
      return true;
    },
    move({ e, world: w }) {
      if (!st) return;
      st.line = M.lineFrom(st.w0.x, st.w0.y, w.x, w.y, { snap: e.shiftKey });
      ws.requestDraw();
    },
    hover() {
      ws.setHover(null);
    },
    up() {
      const s = st;
      st = null;
      if (!s?.line || s.line.w < 1) return void ws.requestDraw();
      const mid = { x: (s.w0.x + s.line.end.x) / 2, y: (s.w0.y + s.line.end.y) / 2 };
      const where = placement(ws, mid);
      const pb = where.parent != null ? ws.box(where.parent) : { x: 0, y: 0 };
      const fields = { w: { mode: "fixed", value: s.line.w }, h: { mode: "fixed", value: 0 } };
      if (s.line.rot) fields.rot = s.line.rot;
      if (!where.flow) Object.assign(fields, { x: Math.round((s.line.x - pb.x) * 100) / 100, y: Math.round((s.line.y - pb.y) * 100) / 100 });
      createLayer(ws, "line", where, fields, t("Add line"));
      ws.tools.set("move");
    },
    draw(ctx, s) {
      if (!st?.line) return;
      const a = toScreen(s.cam, st.w0.x, st.w0.y);
      const b = toScreen(s.cam, st.line.end.x, st.line.end.y);
      ctx.strokeStyle = s.accent || "#0d99ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      badge(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2 + 14, `${Math.round(st.line.w)} · ${Math.round(st.line.rot)}°`, s.accent || "#0d99ff");
    },
    deactivate() {
      st = null;
    },
  };
}

/** Zoom: click to zoom in around the point (Alt: out), drag to zoom to a rect. */
export function createZoomTool(ws) {
  let st = null;
  return {
    id: "zoom",
    cursor: "zoom-in",
    down({ e, stage: p, world: w }) {
      if (e.button !== 0) return false;
      st = { p0: p, w0: w, rect: null, out: e.altKey };
      return true;
    },
    move({ stage: p, world: w }) {
      if (!st) return;
      if (Math.hypot(p.x - st.p0.x, p.y - st.p0.y) > 4) st.rect = normRect(st.w0.x, st.w0.y, w.x, w.y);
      ws.requestDraw();
    },
    hover({ e }) {
      ws.setCursor(e.altKey ? "zoom-out" : "zoom-in");
    },
    up({ stage: p }) {
      const s = st;
      st = null;
      if (!s) return;
      if (s.rect && s.rect.w > 1 && s.rect.h > 1) ws.view.fit(s.rect, { maxZoom: 256, padding: 16 });
      else ws.zoomAround(p.x, p.y, s.out ? -1 : 1);
      ws.requestDraw();
    },
    draw(ctx, s) {
      if (st?.rect) outline(ctx, s.cam, st.rect, s.accent || "#0d99ff", { dash: true });
    },
    deactivate() {
      st = null;
    },
  };
}
