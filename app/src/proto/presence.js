// Presence of other room members on the Proto canvas (docs/concepts/proto-studio.md §13, docs/collaboration.md ▸
// Presence): what this window publishes (page, pointer and selection in world coordinates, the visible rect for
// "follow"), the camera that follows a member, and the overlay layer that draws the others' selection outlines and
// pointers. Used by the collaboration runtime (ui/collab/runtime.js, ui/collab/overlay.js); nothing here runs outside
// a room. Pure apart from the Canvas 2D calls of `drawPresence`.
//
//   protoPresence(ws, pointer) → { page, x?, y?, sel, view }      the payload fields of this window (ws = app.protoUI)
//   followCamera(ws, presence) → camera | null                     the camera that shows the member's visible rect
//   drawPresence(ctx, { cam, geo, members })                        outlines and pointers, in stage pixels
//     members: [{ color, nick, presence }] (already filtered to this design and page)
import { toScreen, worldViewport, fitRect, MAX_ZOOM } from "./camera.js";

const MAX_SEL = 64; // collab/protocol.js ▸ LIMITS.ids
const round = (v) => Math.round(v * 10) / 10;

/** The presence fields of a Proto workspace. `pointer` is the last pointer position in world units (or null). */
export function protoPresence(ws, pointer = null) {
  const p = { page: ws.page, sel: ws.selection.slice(0, MAX_SEL) };
  if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) Object.assign(p, { x: round(pointer.x), y: round(pointer.y) });
  const size = ws.view.size;
  if (size.w > 0 && size.h > 0) {
    const v = worldViewport(ws.view.camera, size.w, size.h);
    p.view = { x: round(v.x), y: round(v.y), w: round(Math.max(0, v.w)), h: round(Math.max(0, v.h)) };
  }
  return p;
}

/** The camera that shows what the member sees (same center, the zoom that fits their visible rect), or null. */
export function followCamera(ws, presence) {
  const v = presence?.view;
  const size = ws.view.size;
  if (!v || !(v.w > 0) || !(v.h > 0) || !(size.w > 0) || !(size.h > 0)) return null;
  return fitRect(v, size.w, size.h, { padding: 0, maxZoom: MAX_ZOOM });
}

/** Draws the others' selections (outline in their color, name tag) and pointers (arrow and name). */
export function drawPresence(ctx, { cam, geo, members }) {
  for (const { color, nick, presence: p } of members) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    let labelAt = null;
    for (const id of p.sel || []) {
      const e = geo.get(id);
      if (!e) continue;
      const a = toScreen(cam, e.x, e.y);
      const w = e.w * cam.zoom;
      const h = e.h * cam.zoom;
      ctx.strokeRect(Math.round(a.x) - 1.5, Math.round(a.y) - 1.5, Math.round(w) + 3, Math.round(h) + 3);
      labelAt ||= a;
    }
    if (labelAt && p.x === undefined) tag(ctx, labelAt.x - 1.5, labelAt.y - 20, nick, color);
    if (p.x !== undefined && p.y !== undefined) {
      const s = toScreen(cam, p.x, p.y);
      arrow(ctx, s.x, s.y, color);
      tag(ctx, s.x + 12, s.y + 14, nick, color);
    }
    ctx.restore();
  }
}

function arrow(ctx, x, y, color) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4.5, 12);
  ctx.lineTo(8, 19);
  ctx.lineTo(10.5, 18);
  ctx.lineTo(7, 11);
  ctx.lineTo(12.5, 11);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.25;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function tag(ctx, x, y, text, color) {
  ctx.save();
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(Math.round(x), Math.round(y), w, 17, 4);
  else ctx.rect(Math.round(x), Math.round(y), w, 17);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, Math.round(x) + 5, Math.round(y) + 9);
  ctx.restore();
}
