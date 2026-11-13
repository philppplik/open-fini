// Whiteboard comments (docs/office-board.md ▸ Comments). Pure: no DOM, no app state; unit tested in
// tests/office/board-comments.test.js. The threads themselves are the document's comment threads (doc.comments,
// collab/comments.js: saved in the .ofini, synced to a collaboration room as comment ops); this module only knows how
// a whiteboard anchors them and how the board shows them (pins, clusters, the sidebar list).
//
// Anchors (validated by ANCHOR in collab/protocol.js; kind "item" like every Office Suite comment)
//   on an element   { kind: "item", item: "el:<elementId>", page, pin: {x, y}, off: {x, y}, quote }
//                   `off` is the point relative to the element's unrotated box (0..1 = inside): the pin follows the
//                   element when it moves, resizes or rotates. `pin` is the board point at creation (or the last
//                   reanchor): where the pin stays when the element is deleted. Undo brings the element (same id) back
//                   and the pin re-attaches.
//   on the canvas   { kind: "item", item: "pt:<pageId>", page, pin: {x, y} }
//   older anchors   { kind: "item", item: "el:<id>", quote } (before 1.1.2): the pin sits at the element's top right.
//
// Public API
//   elementAnchor(el, point?) → anchor          pointAnchor(pageId, point) → anchor
//   isBoardAnchor(anchor) → boolean              anchorElementId(anchor) → id | null
//   resolvePin(anchor, model, { lastKnown }) → { x, y, page, attached, orphan } | null
//   clusterPins(pins, { zoom, radius }) → [{ x, y, items: [pin] }]   screen-space clustering (radius in px)
//   filterBoardThreads(threads, { status, mine, query, page, model }) → threads (oldest first)
//   isUnread(thread, seenAt, myId) → boolean     a message by someone else after `seenAt`
//   threadLastActivity(thread) → ms
//   anchorLabel(anchor, model) → string          "Sticky note “Ideas”", "Deleted element “…”", "Page 2"
const N_ = (s) => s; // marks text for the i18n extractor (this module does not import the i18n runtime)
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const clip = (s, n = 200) => String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
const frac = (v, start, size) => (size > 0 ? Math.round(((v - start) / size) * 1e4) / 1e4 : 0.5); // 4 decimals: under 0.1 px on a 1000 px element

const rot = ([x, y], [cx, cy], a) => {
  if (!a) return [x, y];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};

/** Plain label of an element (frame name, text, object title) for quotes and lists. */
export function elementLabel(el) {
  if (!el) return "";
  if (el.name) return clip(el.name, 80);
  if (el.type === "frame") return clip(el.name || "Frame", 80);
  if (typeof el.text === "string" && el.text.trim()) return clip(el.text, 80);
  if (typeof el.title === "string" && el.title.trim()) return clip(el.title, 80);
  return "";
}

/**
 * Anchor on an element. `point` (board coordinates) is where the user clicked; without it the pin goes to the top
 * right corner. Rotation is undone first, so the pin stays on the same spot of a rotated element.
 */
export function elementAnchor(el, point = null) {
  const w = num(el.w);
  const h = num(el.h);
  const c = [num(el.x) + w / 2, num(el.y) + h / 2];
  const p = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : rot([num(el.x) + w, num(el.y)], c, el.angle || 0);
  const [lx, ly] = rot(p, c, -(el.angle || 0));
  const off = { x: Math.max(-1000, Math.min(1000, frac(lx, num(el.x), w))), y: Math.max(-1000, Math.min(1000, frac(ly, num(el.y), h))) };
  const quote = elementLabel(el) || el.type;
  return { kind: "item", item: `el:${el.id}`, page: el.page, pin: { x: r2(p[0]), y: r2(p[1]) }, off, quote: clip(quote) };
}

export function pointAnchor(pageId, point) {
  return { kind: "item", item: `pt:${pageId}`, page: pageId, pin: { x: r2(num(point?.x)), y: r2(num(point?.y)) } };
}

export const isBoardAnchor = (a) => a?.kind === "item" && /^(el|pt):/.test(String(a.item || ""));
export const anchorElementId = (a) => (a?.kind === "item" && String(a.item || "").startsWith("el:") ? String(a.item).slice(3) : null);

/**
 * Where the pin of an anchor is drawn now: { x, y, page, attached, orphan }.
 *   attached  the element exists: the pin follows it (offset in its rotated box)
 *   orphan    the element is gone: the pin stays at `lastKnown` (where the element was seen last in this session) or
 *             at the saved pin
 * null when the anchor has no place on the board (a deleted element of an old anchor without a pin).
 */
export function resolvePin(anchor, model, { lastKnown = null } = {}) {
  if (!isBoardAnchor(anchor)) return null;
  const id = anchorElementId(anchor);
  if (id) {
    const el = model?.elements?.[id];
    if (el) {
      const w = num(el.w);
      const h = num(el.h);
      const off = anchor.off || { x: 1, y: 0 };
      const c = [num(el.x) + w / 2, num(el.y) + h / 2];
      const [x, y] = rot([num(el.x) + off.x * w, num(el.y) + off.y * h], c, el.angle || 0);
      return { x, y, page: el.page, attached: true, orphan: false };
    }
    const at = lastKnown || anchor.pin;
    if (!at) return null;
    const page = model?.pages?.some((p) => p.id === anchor.page) ? anchor.page : null;
    return page ? { x: at.x, y: at.y, page, attached: false, orphan: true } : null;
  }
  const page = anchor.page || String(anchor.item).slice(3);
  if (!model?.pages?.some((p) => p.id === page) || !anchor.pin) return null;
  return { x: anchor.pin.x, y: anchor.pin.y, page, attached: false, orphan: false };
}

/**
 * Groups pins that would overlap on screen. `pins` = [{ x, y, ... }] in board coordinates; zoom is the camera zoom.
 * Greedy, in the given order (stable): a pin joins the first cluster whose center is within `radius` screen px.
 * Clusters carry the centroid of their members.
 */
export function clusterPins(pins, { zoom = 1, radius = 28 } = {}) {
  const r = radius / Math.max(1e-6, zoom);
  const out = [];
  for (const p of pins) {
    const c = out.find((k) => Math.hypot(k.x - p.x, k.y - p.y) <= r);
    if (c) {
      c.items.push(p);
      const n = c.items.length;
      c.x += (p.x - c.x) / n;
      c.y += (p.y - c.y) / n;
    } else out.push({ x: p.x, y: p.y, items: [p] });
  }
  return out;
}

export function threadLastActivity(t) {
  let last = num(t.ts);
  for (const m of t.messages || []) last = Math.max(last, num(m.edited), num(m.ts));
  return last;
}

/** A message (or edit) by someone other than me after `seenAt` (ms). Never unread when I wrote everything. */
export function isUnread(t, seenAt, myId) {
  const seen = num(seenAt, 0);
  return (t.messages || []).some((m) => !m.deleted && m.author !== myId && Math.max(num(m.ts), num(m.edited)) > seen);
}

/** Board threads matching the sidebar filter, in pin-number order (creation). */
export function filterBoardThreads(threads, { status = "open", mine = null, query = "", page = null, model = null } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (threads || [])
    .filter((t) => isBoardAnchor(t.anchor) || t.anchor?.kind === "doc")
    .filter((t) => (status === "all" ? true : status === "resolved" ? !!t.resolved : !t.resolved))
    .filter((t) => !mine || t.author === mine || (t.messages || []).some((m) => m.author === mine || m.mentions?.includes(mine)))
    .filter((t) => {
      if (!page) return true;
      const p = model ? resolvePin(t.anchor, model)?.page : t.anchor?.page;
      return p === page;
    })
    .filter((t) => !q || (t.messages || []).some((m) => !m.deleted && String(m.text).toLowerCase().includes(q)) || String(t.nick || "").toLowerCase().includes(q) || String(t.anchor?.quote || "").toLowerCase().includes(q))
    .sort((a, b) => num(a.ts) - num(b.ts) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Short English description of where an anchor points (callers translate the template with t()):
 * returns [template, params] so the UI can translate and tests can check.
 */
export function anchorLabel(anchor, model) {
  const id = anchorElementId(anchor);
  if (id) {
    const el = model?.elements?.[id];
    if (!el) return [N_("Deleted element “{name}”"), { name: anchor.quote || "?" }];
    const name = elementLabel(el);
    return name ? [N_("{type} “{name}”"), { type: el.type, name }] : [N_("{type}"), { type: el.type }];
  }
  if (isBoardAnchor(anchor)) {
    const pages = model?.pages || [];
    const p = pages.find((x) => x.id === anchor.page);
    return [N_("A point on “{page}”"), { page: p?.name || "?" }];
  }
  return [N_("Whiteboard"), {}];
}

/**
 * What a board anchor points at, for the Vibe comment tools (collab/comment-context.js env.officeItem):
 * { exists, board: "element"|"point", elementId?, elementType?, text?, bounds?, page: { id, name }, point, note? }.
 * null when the anchor is not a board anchor.
 */
export function describeBoardAnchor(anchor, model) {
  if (!isBoardAnchor(anchor)) return null;
  const r1 = (v) => Math.round(v * 10) / 10;
  const id = anchorElementId(anchor);
  const pin = resolvePin(anchor, model);
  const pageId = pin?.page || anchor.page || null;
  const page = pageId ? { id: pageId, name: model?.pages?.find((p) => p.id === pageId)?.name ?? null } : null;
  const point = pin ? { x: r1(pin.x), y: r1(pin.y) } : anchor.pin || null;
  if (!id) return { exists: !!pin, board: "point", ...(page ? { page } : {}), ...(point ? { point } : {}) };
  const el = model?.elements?.[id];
  if (!el) return { exists: false, board: "element", elementId: id, ...(page ? { page } : {}), ...(point ? { point } : {}), note: "The element was deleted; the comment stays at its last position." };
  const b = { x: r1(num(el.x)), y: r1(num(el.y)), w: r1(num(el.w)), h: r1(num(el.h)) };
  const text = elementLabel(el);
  return { exists: true, board: "element", elementId: id, elementType: el.type, ...(text ? { text } : {}), bounds: b, ...(page ? { page } : {}), ...(point ? { point } : {}) };
}
