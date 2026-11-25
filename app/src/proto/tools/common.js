// Shared helpers of the Proto Studio tools: picking that respects locked layers, the container a new layer goes into,
// snap targets from the geometry cache, and overlay drawing of guides, distance labels and value badges (stage
// pixels). The tools themselves are in this folder; the workspace (proto/workspace.js) routes pointer input to them.
import { field, isContainer } from "../../engine/proto/schema.js";
import { hitTest, pickAt as pick } from "../geometry.js";
import { toScreen } from "../camera.js";

export const GUIDE = "#f43f5e";
export const LABEL_FONT = "11px Inter, system-ui, sans-serif";
export const isMod = (e) => (/Mac|iPhone|iPad/.test(navigator.platform || "") ? e.metaKey : e.ctrlKey);

const lockCache = new WeakMap();
/** Ids of locked layers and of everything inside them (cached per node map). */
export function lockedSet(model) {
  let s = lockCache.get(model.nodes);
  if (s) return s;
  s = new Set();
  const nodes = model.nodes;
  const locked = (id, guard = 0) => {
    if (s.has(id)) return true;
    const n = nodes[id];
    if (!n || guard > 256) return false;
    if (n.locked) return true;
    return n.parent != null && locked(n.parent, guard + 1);
  };
  for (const id of Object.keys(nodes)) if (locked(id)) s.add(id);
  lockCache.set(model.nodes, s);
  return s;
}

/** The geometry cache without locked layers (and without `exclude`d keys and their descendants). */
export function selectableGeo(ws, exclude = null) {
  const geo = ws.view.geo;
  const locked = lockedSet(ws.model());
  const skip = (e) => locked.has(e.sel) || locked.has(e.id) || (exclude && (exclude.has(e.sel) || insideAny(geo, e, exclude)));
  return {
    get: (k) => geo.get(k),
    *entries() {
      for (const e of geo.entries()) if (!skip(e)) yield e;
    },
  };
}

function insideAny(geo, e, set) {
  let cur = e;
  let guard = 0;
  while (cur && guard++ < 256) {
    if (set.has(cur.key) || set.has(cur.sel)) return true;
    cur = cur.parent != null ? geo.get(cur.parent) : null;
  }
  return false;
}

/** What a click at a world point selects (locked layers are skipped). */
export function pickLayer(ws, w, { deep = false, context } = {}) {
  return pick(selectableGeo(ws), w.x, w.y, { deep, context: context === undefined ? ws.controller.context() : context });
}

/**
 * The container a layer drawn or dropped at the world point goes into: the deepest frame or component under the point
 * that is not locked, not inside an instance, and not in `exclude` (the layers being moved). Null: the page.
 */
export function containerAt(ws, w, exclude = null) {
  const model = ws.model();
  for (const e of hitTest(selectableGeo(ws, exclude), w.x, w.y)) {
    if (e.key !== e.id || e.sel !== e.id) continue; // inside an instance
    const n = model.nodes[e.id];
    if (!n || !isContainer(n.type) || n.type === "instance" || n.type === "componentSet") continue;
    return e.id;
  }
  return null;
}

/** World boxes of the children of a parent key (geometry entries), in model order. */
export function childBoxes(ws, parentId, exclude = null) {
  const out = [];
  for (const e of ws.view.geo.entries()) if (e.parent === parentId && e.key === e.id && !(exclude && exclude.has(e.id))) out.push(e);
  return out;
}

/** Boxes a layer with parent `parentId` snaps to: its siblings and its parent (or nearby top-level layers). */
export function snapBoxes(ws, parentId, exclude) {
  const geo = ws.view.geo;
  const boxes = [];
  if (parentId == null) {
    for (const id of geo.rootIds()) if (!exclude.has(id)) boxes.push(geo.rootBox(id));
  } else {
    for (const e of childBoxes(ws, parentId, exclude)) boxes.push(e);
    const p = geo.get(parentId);
    if (p) boxes.push(p);
  }
  return boxes.filter(Boolean);
}

/** True when the layer is laid out by its parent's flex or grid layout. */
export function inFlow(model, id) {
  const n = model.nodes[id];
  if (!n || n.parent == null) return false;
  const lt = field(model.nodes[n.parent], "layout")?.type;
  return (lt === "flex" || lt === "grid") && field(n, "pos") === "flow";
}

export const stageRect = (cam, r) => {
  const p = toScreen(cam, r.x, r.y);
  return { x: p.x, y: p.y, w: r.w * cam.zoom, h: r.h * cam.zoom };
};

/** A small filled badge with white text centered at (x, y) in stage pixels. */
export function badge(ctx, x, y, text, color = GUIDE) {
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x - w / 2), Math.round(y - 8), Math.round(w), 16);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, Math.round(x), Math.round(y) + 0.5);
  ctx.textAlign = "start";
}

/** Snap guides ({ axis, v, from, to } in world units) as thin lines. */
export function drawGuides(ctx, cam, guides) {
  if (!guides?.length) return;
  ctx.strokeStyle = GUIDE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const g of guides) {
    if (g.axis === "x") {
      const a = toScreen(cam, g.v, g.from);
      const b = toScreen(cam, g.v, g.to);
      ctx.moveTo(Math.round(a.x) + 0.5, a.y);
      ctx.lineTo(Math.round(b.x) + 0.5, b.y);
    } else {
      const a = toScreen(cam, g.from, g.v);
      const b = toScreen(cam, g.to, g.v);
      ctx.moveTo(a.x, Math.round(a.y) + 0.5);
      ctx.lineTo(b.x, Math.round(b.y) + 0.5);
    }
  }
  ctx.stroke();
}

const fmtNum = (v) => String(Math.round(v * 100) / 100);

/** Distance lines with their values ({ x1, y1, x2, y2, value } in world units). */
export function drawDistances(ctx, cam, list) {
  if (!list?.length) return;
  ctx.strokeStyle = GUIDE;
  ctx.lineWidth = 1;
  for (const d of list) {
    const a = toScreen(cam, d.x1, d.y1);
    const b = toScreen(cam, d.x2, d.y2);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 2) continue;
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
    ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
    ctx.stroke();
    badge(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, fmtNum(d.value));
  }
}

/** Outlines a world rect (dashed when `dash`). */
export function outline(ctx, cam, r, color, { dash = false, width = 1 } = {}) {
  const s = stageRect(cam, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash([4, 3]);
  ctx.strokeRect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
  ctx.setLineDash([]);
}

export { fmtNum };
