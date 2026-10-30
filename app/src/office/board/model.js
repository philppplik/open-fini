// Whiteboard model (Office Suite kind "board", docs/office-board.md). Pure: no DOM, no app state; unit-tested in
// tests/office/board.test.js. Models are immutable values: every operation returns a new model and keeps unchanged
// elements (the renderer caches by object identity).
//
// Model
//   { version: 1, title, background: "#ffffff", pages: [{ id, name, z, paper: "plain"|"dots"|"grid"|"lines" }],
//     elements: { <id>: Element }, media: { <id>: { id, mime, name, w, h, bytes } } }
// Element (every type): { id, type, page, x, y, w, h, angle (radians, about the center), z (fractional key),
//     stroke, fill (null = none), fillStyle: "solid"|"hachure"|"cross", width (stroke px), dash: "solid"|"dashed"|"dotted",
//     rough (0 clean, 1 hand-drawn, 2 sketchy), opacity 0..1, seed, group?, frame?, locked?, link? }
//   rect | ellipse | diamond   + text (label), round (rect corners), font, fontSize, align
//   line | arrow               + points [[x, y]] relative to (x, y), start/end: { id } | null (connectors), heads: { start, end }
//   pen | highlighter          + points [[x, y, pressure 0..1]] relative to (x, y)
//   text                       + text, font: "hand"|"sans"|"serif"|"mono", fontSize, align
//   sticky                     + text, fill (paper color), font, fontSize
//   image                      + media (id in model.media)
//   frame                      + name; elements whose `frame` is its id move with it
// Invariants: (x, y, w, h) is the unrotated box; points stay inside it after normalizePoints(); connectors are
// re-routed by layoutConnectors() after every change that moves or resizes elements (the ops below call it).
import { initialKey, keyBetween, isKey } from "../../collab/fractional.js";

export const BOARD_VERSION = 1;
export const SHAPES = ["rect", "ellipse", "diamond"];
export const LINEAR = ["line", "arrow"];
export const INK = ["pen", "highlighter"];
export const TYPES = [...SHAPES, ...LINEAR, ...INK, "text", "sticky", "image", "frame"];
export const PAPERS = ["plain", "dots", "grid", "lines"];
export const FONTS = ["hand", "sans", "serif", "mono"];
export const HEADS = ["none", "arrow", "triangle", "dot", "bar"];
export const STICKY_COLORS = ["#fff3a0", "#ffd1dc", "#c8f0d0", "#cfe5ff", "#ffe0b2", "#e6d7ff"];
const ID_RE = /^[\w-]{1,64}$/;

let seq = 0;
/** A short random id (unique enough across collaborators). */
export function newId(prefix = "e") {
  let r = "";
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(2);
    c.getRandomValues(a);
    r = a[0].toString(36) + a[1].toString(36).slice(0, 3);
  } else r = Math.random().toString(36).slice(2, 11);
  return `${prefix}${r}${(seq++ % 36).toString(36)}`;
}

export const isId = (id) => typeof id === "string" && ID_RE.test(id);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------- model basics

export function emptyModel({ title = "", paper = "plain" } = {}) {
  return { version: BOARD_VERSION, title, background: "#ffffff", pages: [{ id: "p1", name: "Page 1", z: initialKey(0, 1), paper }], elements: {}, media: {} };
}

const DEFAULTS = { angle: 0, stroke: "#1e1e1e", fill: null, fillStyle: "solid", width: 2, dash: "solid", rough: 1, opacity: 1 };

/** A complete element of a type from partial props (defaults, a seed, a fresh id). */
export function makeElement(type, props = {}) {
  if (!TYPES.includes(type)) throw new Error(`Unknown board element type "${type}"`);
  const el = { id: isId(props.id) ? props.id : newId(), type, page: props.page || "p1", x: 0, y: 0, w: 0, h: 0, z: props.z || "", ...DEFAULTS, seed: (Math.random() * 2 ** 31) | 0, ...props };
  if (!isId(el.id)) el.id = newId();
  if (type === "text") Object.assign(el, { font: "hand", fontSize: 24, align: "left", text: "", ...props, fill: props.fill ?? null });
  if (type === "sticky") Object.assign(el, { fill: STICKY_COLORS[0], font: "hand", fontSize: 20, align: "center", text: "", w: 200, h: 200, ...props, stroke: props.stroke ?? "#1e1e1e" });
  if (SHAPES.includes(type)) Object.assign(el, { font: "hand", fontSize: 20, align: "center", text: "", ...props });
  if (LINEAR.includes(type) || INK.includes(type)) el.points = Array.isArray(props.points) ? props.points : [[0, 0], [el.w, el.h]];
  if (type === "arrow") el.heads = { start: "none", end: "arrow", ...(props.heads || {}) };
  if (type === "line") el.heads = { start: "none", end: "none", ...(props.heads || {}) };
  if (type === "highlighter") Object.assign(el, { stroke: props.stroke || "#ffd43b", width: props.width || 18, opacity: props.opacity ?? 0.45, rough: 0 });
  if (type === "pen") el.rough = 0;
  if (type === "frame") Object.assign(el, { name: props.name || "Frame", stroke: props.stroke || "#868e96", width: 1, rough: 0 });
  if (LINEAR.includes(type) || INK.includes(type)) return normalizePoints(el);
  return el;
}

/** Elements of a page in paint order (z, then id: identical on every collaborator). */
export function pageElements(model, page) {
  return Object.values(model.elements).filter((e) => e.page === page).sort(byZ);
}
export const byZ = (a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const sortedPages = (model) => [...model.pages].sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));

function topZ(model, page) {
  let max = null;
  for (const e of Object.values(model.elements)) if (e.page === page && (max === null || e.z > max)) max = e.z;
  return max;
}

/** Recomputes x, y, w, h of a point-based element so the points start at its box origin. */
export function normalizePoints(el) {
  const pts = el.points || [];
  if (!pts.length) return { ...el, points: [[0, 0]], w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (x0 === 0 && y0 === 0 && el.w === r2(x1) && el.h === r2(y1)) return el;
  return { ...el, x: r2(el.x + x0), y: r2(el.y + y0), w: r2(x1 - x0), h: r2(y1 - y0), points: pts.map((p) => (p.length > 2 ? [r2(p[0] - x0), r2(p[1] - y0), p[2]] : [r2(p[0] - x0), r2(p[1] - y0)])) };
}

/** Absolute points of a linear / ink element (rotation ignored: connectors and ink are stored unrotated). */
export const absPoints = (el) => (el.points || []).map(([x, y]) => [el.x + x, el.y + y]);

/** Builds a linear element's relative points from absolute ones. */
export function withAbsPoints(el, abs) {
  return normalizePoints({ ...el, x: 0, y: 0, points: abs.map(([x, y]) => [x, y]) });
}

// ---------------------------------------------------------------------------------------------- geometry

export const center = (el) => [el.x + el.w / 2, el.y + el.h / 2];

/** Rotates [x, y] around [cx, cy] by angle. */
export function rotate([x, y], [cx, cy], a) {
  if (!a) return [x, y];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

/** Axis-aligned bounds of an element including rotation and stroke: { x, y, w, h }. */
export function bounds(el) {
  const pad = INK.includes(el.type) ? el.width / 2 : 0;
  const c = center(el);
  const pts = [[el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h]].map((p) => rotate(p, c, el.angle || 0));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let x = Math.min(...xs) - pad;
  let y = Math.min(...ys) - pad;
  let w = Math.max(...xs) - x + pad;
  let h = Math.max(...ys) - y + pad;
  if (el.type === "frame") {
    y -= 22; // the name above the frame
    h += 22;
  }
  return { x, y, w, h };
}

/** Bounds of several elements (null when empty). */
export function unionBounds(els) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const e of els) {
    const b = bounds(e);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a polyline. */
export function distToPolyline(px, py, pts) {
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSegment(px, py, pts[i], pts[i + 1]));
  return d;
}

/**
 * True when the world point (px, py) hits the element. Filled shapes, text, stickies and images hit inside; unfilled
 * shapes and frames only near their outline (so things inside them stay clickable); lines and ink near the stroke.
 */
export function hitTest(el, px, py, tol = 6) {
  const [lx, ly] = rotate([px, py], center(el), -(el.angle || 0));
  if (LINEAR.includes(el.type) || INK.includes(el.type)) return distToPolyline(lx, ly, absPoints(el)) <= tol + el.width / 2;
  const inBox = lx >= el.x - tol && lx <= el.x + el.w + tol && ly >= el.y - tol && ly <= el.y + el.h + tol;
  if (!inBox) return el.type === "frame" && lx >= el.x && lx <= el.x + el.w && ly >= el.y - 24 && ly <= el.y; // frame title
  const solid = el.type === "text" || el.type === "sticky" || el.type === "image" || !!el.fill || !!el.text;
  const a = el.w / 2;
  const b = el.h / 2;
  const dx = lx - (el.x + a);
  const dy = ly - (el.y + b);
  if (el.type === "ellipse") {
    const r = Math.sqrt((dx * dx) / Math.max(1, a * a) + (dy * dy) / Math.max(1, b * b));
    return solid ? r <= 1 + tol / Math.max(1, Math.min(a, b)) : Math.abs(r - 1) * Math.min(a, b) <= tol + el.width;
  }
  if (el.type === "diamond") {
    const r = Math.abs(dx) / Math.max(1, a) + Math.abs(dy) / Math.max(1, b);
    return solid ? r <= 1 + tol / Math.max(1, Math.min(a, b)) : Math.abs(r - 1) * Math.min(a, b) <= tol + el.width;
  }
  if (solid) return true;
  const edge = Math.min(Math.abs(lx - el.x), Math.abs(lx - el.x - el.w), Math.abs(ly - el.y), Math.abs(ly - el.y - el.h));
  return edge <= tol + el.width;
}

/** The top-most element of a page at a world point (null if none). */
export function elementAt(model, page, x, y, tol = 6) {
  const els = pageElements(model, page);
  for (let i = els.length - 1; i >= 0; i--) if (hitTest(els[i], x, y, tol)) return els[i];
  return null;
}

/** Elements of a page whose bounds lie fully inside a world rectangle (marquee selection). */
export function elementsInRect(model, page, r) {
  return pageElements(model, page).filter((e) => {
    const b = bounds(e);
    return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
  });
}

/**
 * Where a connector meets an element: the point on its outline in the direction of `toward` (world), pushed out by
 * `gap`. Respects the element's shape (rectangle, ellipse, diamond) and rotation.
 */
export function attachPoint(el, toward, gap = 6) {
  const c = center(el);
  const [lx, ly] = rotate(toward, c, -(el.angle || 0));
  let dx = lx - c[0];
  let dy = ly - c[1];
  if (!dx && !dy) dy = -1;
  const a = Math.max(1, el.w / 2);
  const b = Math.max(1, el.h / 2);
  let t;
  if (el.type === "ellipse") t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  else if (el.type === "diamond") t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else t = 1 / Math.max(Math.abs(dx) / a, Math.abs(dy) / b);
  const len = Math.hypot(dx, dy);
  const px = c[0] + dx * t + (dx / len) * gap;
  const py = c[1] + dy * t + (dy / len) * gap;
  return rotate([px, py], c, el.angle || 0).map(r2);
}

/** Re-routes every connector bound to an element that exists (only connectors whose geometry changes are replaced). */
export function layoutConnectors(model) {
  let elements = null;
  for (const el of Object.values(model.elements)) {
    if (!LINEAR.includes(el.type) || (!el.start && !el.end)) continue;
    const s = el.start && model.elements[el.start.id];
    const e = el.end && model.elements[el.end.id];
    const pts = absPoints(el);
    if (pts.length < 2) continue;
    const n = pts.length;
    const next = pts.map((p) => [...p]);
    if (s) next[0] = attachPoint(s, n > 2 ? pts[1] : e ? center(e) : pts[n - 1]);
    if (e) next[n - 1] = attachPoint(e, n > 2 ? pts[n - 2] : s ? center(s) : pts[0]);
    const changed = next.some((p, i) => Math.abs(p[0] - pts[i][0]) > 0.01 || Math.abs(p[1] - pts[i][1]) > 0.01);
    const unbound = (el.start && !s) || (el.end && !e);
    if (!changed && !unbound) continue;
    elements ||= { ...model.elements };
    elements[el.id] = withAbsPoints({ ...el, start: s ? el.start : null, end: e ? el.end : null }, next);
  }
  return elements ? { ...model, elements } : model;
}

// ---------------------------------------------------------------------------------------------- operations

/** Adds elements on top of their page (z keys assigned when missing). */
export function addElements(model, els) {
  const elements = { ...model.elements };
  const tops = {};
  for (const raw of els) {
    const el = raw.type && raw.id && raw.seed !== undefined ? { ...raw } : makeElement(raw.type, raw);
    if (!el.page || !model.pages.some((p) => p.id === el.page)) el.page = model.pages[0].id;
    while (elements[el.id]) el.id = newId();
    if (!isKey(el.z)) {
      const top = el.page in tops ? tops[el.page] : topZ({ elements }, el.page);
      el.z = keyBetween(top, null);
    }
    tops[el.page] = el.z > (tops[el.page] ?? "") ? el.z : tops[el.page];
    elements[el.id] = el;
  }
  return layoutConnectors({ ...model, elements });
}

/** Applies partial props per id: { id: { ...props } } (unknown ids are ignored). */
export function updateElements(model, patches) {
  const elements = { ...model.elements };
  let hit = false;
  for (const [id, p] of Object.entries(patches)) {
    const el = elements[id];
    if (!el || !p) continue;
    let next = { ...el, ...p, id, type: el.type };
    if (p.points && (LINEAR.includes(el.type) || INK.includes(el.type))) next = normalizePoints(next);
    elements[id] = next;
    hit = true;
  }
  return hit ? layoutConnectors({ ...model, elements }) : model;
}

/** Removes elements; connectors that pointed at them stay where they are, frame children are released. */
export function removeElements(model, ids) {
  const gone = new Set(ids.filter((id) => model.elements[id]));
  if (!gone.size) return model;
  const elements = {};
  for (const [id, el] of Object.entries(model.elements)) {
    if (gone.has(id)) continue;
    elements[id] = el.frame && gone.has(el.frame) ? { ...el, frame: null } : el;
  }
  return layoutConnectors({ ...model, elements, media: pruneMedia(model.media, elements) });
}

function pruneMedia(media = {}, elements) {
  const used = new Set(Object.values(elements).filter((e) => e.media).map((e) => e.media));
  const out = {};
  for (const [id, m] of Object.entries(media)) if (used.has(id)) out[id] = m;
  return Object.keys(out).length === Object.keys(media).length ? media : out;
}

/** The ids plus the members of their groups and the children of frames among them (what a drag moves). */
export function expandSelection(model, ids) {
  const out = new Set(ids);
  const groups = new Set(ids.map((id) => model.elements[id]?.group).filter(Boolean));
  for (const el of Object.values(model.elements)) {
    if (el.group && groups.has(el.group)) out.add(el.id);
  }
  for (const el of Object.values(model.elements)) if (el.frame && out.has(el.frame)) out.add(el.id);
  return [...out].filter((id) => model.elements[id]);
}

/** Moves elements by (dx, dy); unbound connector ends move along only when both ends' elements move. */
export function moveElements(model, ids, dx, dy) {
  if (!dx && !dy) return model;
  const set = new Set(ids);
  const elements = { ...model.elements };
  for (const id of set) {
    const el = elements[id];
    if (!el || el.locked) continue;
    elements[id] = { ...el, x: r2(el.x + dx), y: r2(el.y + dy) };
  }
  return layoutConnectors({ ...model, elements });
}

/**
 * Resizes one element to a new unrotated box. Point-based elements scale their points, text scales its font size.
 * Negative sizes flip.
 */
export function resizeElement(el, box) {
  const sx = el.w ? box.w / el.w : 1;
  const sy = el.h ? box.h / el.h : 1;
  let next = { ...el, x: r2(Math.min(box.x, box.x + box.w)), y: r2(Math.min(box.y, box.y + box.h)), w: r2(Math.abs(box.w)), h: r2(Math.abs(box.h)) };
  if (el.points) {
    const pts = el.points.map((p) => [box.x + p[0] * sx, box.y + p[1] * sy, ...(p.length > 2 ? [p[2]] : [])]);
    next = normalizePoints({ ...next, x: 0, y: 0, points: pts });
  }
  if (el.type === "text") next.fontSize = Math.max(4, r2(el.fontSize * Math.abs(sy || 1)));
  return next;
}

/** Scales several elements from their union box to a new box (multi-selection resize). */
export function resizeElements(model, ids, from, to) {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const patches = {};
  for (const id of ids) {
    const el = model.elements[id];
    if (!el || el.locked) continue;
    const box = { x: to.x + (el.x - from.x) * sx, y: to.y + (el.y - from.y) * sy, w: el.w * sx, h: el.h * sy };
    patches[id] = resizeElement(el, box);
  }
  return updateElements(model, patches);
}

/** Rotates elements around a pivot (their own centers move around it, each angle grows by da). */
export function rotateElements(model, ids, pivot, da) {
  const patches = {};
  for (const id of ids) {
    const el = model.elements[id];
    if (!el || el.locked || LINEAR.includes(el.type)) continue;
    const c = rotate(center(el), pivot, da);
    patches[id] = { x: r2(c[0] - el.w / 2), y: r2(c[1] - el.h / 2), angle: normAngle((el.angle || 0) + da) };
  }
  return updateElements(model, patches);
}
const normAngle = (a) => {
  const t = Math.PI * 2;
  const v = ((a % t) + t) % t;
  return Math.abs(v) < 1e-6 || Math.abs(v - t) < 1e-6 ? 0 : Math.round(v * 1e4) / 1e4;
};

/** Copies elements (new ids, offset, connectors re-bound inside the copy, groups renamed). Returns { model, ids }. */
export function duplicateElements(model, ids, dx = 20, dy = 20, page = null) {
  const src = expandSelection(model, ids).map((id) => model.elements[id]).sort(byZ);
  const map = new Map(src.map((e) => [e.id, newId()]));
  const groups = new Map();
  const copies = src.map((e) => {
    const c = { ...e, id: map.get(e.id), x: r2(e.x + dx), y: r2(e.y + dy), z: "", page: page || e.page, seed: (e.seed + 7) | 0 };
    if (e.group) {
      if (!groups.has(e.group)) groups.set(e.group, newId("g"));
      c.group = groups.get(e.group);
    }
    if (e.frame) c.frame = map.get(e.frame) || (page && page !== e.page ? null : e.frame);
    if (e.start) c.start = map.has(e.start.id) ? { ...e.start, id: map.get(e.start.id) } : null;
    if (e.end) c.end = map.has(e.end.id) ? { ...e.end, id: map.get(e.end.id) } : null;
    return c;
  });
  return { model: addElements(model, copies), ids: copies.map((c) => c.id) };
}

export function groupElements(model, ids) {
  if (ids.length < 2) return model;
  const g = newId("g");
  return updateElements(model, Object.fromEntries(ids.map((id) => [id, { group: g }])));
}

export function ungroupElements(model, ids) {
  const groups = new Set(ids.map((id) => model.elements[id]?.group).filter(Boolean));
  const patches = {};
  for (const el of Object.values(model.elements)) if (el.group && groups.has(el.group)) patches[el.id] = { group: null };
  return updateElements(model, patches);
}

/** Aligns elements: left | center | right | top | middle | bottom (to the selection bounds). */
export function alignElements(model, ids, how) {
  const els = ids.map((id) => model.elements[id]).filter(Boolean);
  const box = unionBounds(els);
  if (!box || els.length < 2) return model;
  const patches = {};
  for (const el of els) {
    const b = bounds(el);
    let dx = 0;
    let dy = 0;
    if (how === "left") dx = box.x - b.x;
    else if (how === "center") dx = box.x + box.w / 2 - (b.x + b.w / 2);
    else if (how === "right") dx = box.x + box.w - (b.x + b.w);
    else if (how === "top") dy = box.y - b.y;
    else if (how === "middle") dy = box.y + box.h / 2 - (b.y + b.h / 2);
    else if (how === "bottom") dy = box.y + box.h - (b.y + b.h);
    if (dx || dy) patches[el.id] = { x: r2(el.x + dx), y: r2(el.y + dy) };
  }
  return updateElements(model, patches);
}

/** Spaces elements evenly: "horizontal" | "vertical" (equal gaps between bounds, the outer two stay). */
export function distributeElements(model, ids, axis = "horizontal") {
  const els = ids.map((id) => model.elements[id]).filter(Boolean);
  if (els.length < 3) return model;
  const hz = axis === "horizontal";
  const bs = els.map((e) => ({ e, b: bounds(e) })).sort((p, q) => (hz ? p.b.x - q.b.x : p.b.y - q.b.y));
  const first = bs[0].b;
  const last = bs[bs.length - 1].b;
  const total = bs.reduce((s, p) => s + (hz ? p.b.w : p.b.h), 0);
  const gap = ((hz ? last.x + last.w - first.x : last.y + last.h - first.y) - total) / (bs.length - 1);
  let pos = hz ? first.x : first.y;
  const patches = {};
  for (const { e, b } of bs) {
    const d = pos - (hz ? b.x : b.y);
    if (Math.abs(d) > 0.01) patches[e.id] = hz ? { x: r2(e.x + d) } : { y: r2(e.y + d) };
    pos += (hz ? b.w : b.h) + gap;
  }
  return updateElements(model, patches);
}

/** Z-order: "front" | "back" | "forward" | "backward" (one step past the next overlapping neighbor). */
export function reorderElements(model, ids, how) {
  const set = new Set(ids);
  const page = model.elements[ids[0]]?.page;
  if (!page) return model;
  const all = pageElements(model, page);
  const moving = all.filter((e) => set.has(e.id));
  const rest = all.filter((e) => !set.has(e.id));
  if (!moving.length || !rest.length) return model;
  let lo;
  let hi;
  if (how === "front") [lo, hi] = [rest[rest.length - 1].z, null];
  else if (how === "back") [lo, hi] = [null, rest[0].z];
  else if (how === "forward") {
    const top = moving[moving.length - 1];
    const i = rest.findIndex((e) => byZ(e, top) > 0);
    if (i < 0) return model;
    [lo, hi] = [rest[i].z, rest[i + 1]?.z ?? null];
  } else {
    const bottom = moving[0];
    let i = -1;
    for (let k = rest.length - 1; k >= 0; k--) if (byZ(rest[k], bottom) < 0) { i = k; break; }
    if (i < 0) return model;
    [lo, hi] = [rest[i - 1]?.z ?? null, rest[i].z];
  }
  if (lo !== null && hi !== null && lo >= hi) hi = null; // equal keys from concurrent inserts: fall back to the end
  const patches = {};
  let prev = lo;
  for (const e of moving) {
    const z = keyBetween(prev, hi);
    patches[e.id] = { z };
    prev = z;
  }
  return updateElements(model, patches);
}

/** Sets `frame` of elements whose center lies inside a frame of their page (the top-most frame wins). */
export function assignFrames(model, ids) {
  const patches = {};
  for (const id of ids) {
    const el = model.elements[id];
    if (!el || el.type === "frame") continue;
    const [cx, cy] = center(el);
    const frames = pageElements(model, el.page).filter((f) => f.type === "frame" && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h);
    const f = frames[frames.length - 1]?.id || null;
    if ((el.frame || null) !== f) patches[id] = { frame: f };
  }
  return Object.keys(patches).length ? updateElements(model, patches) : model;
}

/**
 * Arranges elements: "grid" (rows of equal cells, `columns` default √n), "row", "column", or "flow" (layers along the
 * connector graph, left to right: a quick flowchart layout). Keeps the top-left of the current bounds.
 */
export function arrangeElements(model, ids, { layout = "grid", gap = 40, columns = 0 } = {}) {
  const els = ids.map((id) => model.elements[id]).filter((e) => e && !LINEAR.includes(e.type));
  if (els.length < 2) return model;
  const box = unionBounds(els);
  const patches = {};
  const place = (e, x, y) => (patches[e.id] = { x: r2(x), y: r2(y) });
  if (layout === "flow") {
    const set = new Set(els.map((e) => e.id));
    const out = new Map(els.map((e) => [e.id, []]));
    const indeg = new Map(els.map((e) => [e.id, 0]));
    for (const c of Object.values(model.elements)) {
      if (!LINEAR.includes(c.type) || !c.start || !c.end || !set.has(c.start.id) || !set.has(c.end.id) || c.start.id === c.end.id) continue;
      out.get(c.start.id).push(c.end.id);
      indeg.set(c.end.id, indeg.get(c.end.id) + 1);
    }
    const layer = new Map();
    const queue = els.filter((e) => !indeg.get(e.id)).map((e) => e.id);
    if (!queue.length) queue.push(els[0].id);
    for (const id of queue) layer.set(id, 0);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const n of out.get(id)) {
        if (layer.has(n)) continue; // cycles: first visit wins
        layer.set(n, layer.get(id) + 1);
        queue.push(n);
      }
    }
    for (const e of els) if (!layer.has(e.id)) layer.set(e.id, 0);
    const cols = new Map();
    for (const e of [...els].sort(byZ)) {
      const l = layer.get(e.id);
      if (!cols.has(l)) cols.set(l, []);
      cols.get(l).push(e);
    }
    let x = box.x;
    for (const l of [...cols.keys()].sort((a, b) => a - b)) {
      const col = cols.get(l);
      const w = Math.max(...col.map((e) => e.w));
      const total = col.reduce((s, e) => s + e.h, 0) + gap * (col.length - 1);
      let y = box.y + Math.max(0, (box.h - total) / 2);
      for (const e of col) {
        place(e, x + (w - e.w) / 2, y);
        y += e.h + gap;
      }
      x += w + gap * 2;
    }
  } else {
    const n = els.length;
    const ordered = [...els].sort((a, b) => a.y - b.y || a.x - b.x);
    const cols = layout === "row" ? n : layout === "column" ? 1 : Math.max(1, columns || Math.ceil(Math.sqrt(n)));
    const cw = Math.max(...els.map((e) => e.w));
    const ch = Math.max(...els.map((e) => e.h));
    ordered.forEach((e, i) => place(e, box.x + (i % cols) * (cw + gap), box.y + Math.floor(i / cols) * (ch + gap)));
  }
  return updateElements(model, patches);
}

// ---------------------------------------------------------------------------------------------- pages

export function addPage(model, { name, paper = "plain", after = null } = {}) {
  const pages = sortedPages(model);
  const i = after ? pages.findIndex((p) => p.id === after) : pages.length - 1;
  const z = keyBetween(pages[i]?.z ?? null, pages[i + 1]?.z ?? null);
  let id = newId("p");
  const page = { id, name: name || `Page ${pages.length + 1}`, z, paper: PAPERS.includes(paper) ? paper : "plain" };
  return { model: { ...model, pages: [...model.pages, page] }, page: id };
}

export function updatePage(model, id, props) {
  return { ...model, pages: model.pages.map((p) => (p.id === id ? { ...p, ...props, id } : p)) };
}

export function removePage(model, id) {
  if (model.pages.length < 2) return model;
  const elements = {};
  for (const [k, e] of Object.entries(model.elements)) if (e.page !== id) elements[k] = e;
  return { ...model, pages: model.pages.filter((p) => p.id !== id), elements, media: pruneMedia(model.media, elements) };
}

export function movePage(model, id, delta) {
  const pages = sortedPages(model);
  const i = pages.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= pages.length) return model;
  const [lo, hi] = delta < 0 ? [pages[j - 1]?.z ?? null, pages[j].z] : [pages[j].z, pages[j + 1]?.z ?? null];
  return updatePage(model, id, { z: keyBetween(lo, hi) });
}

// ---------------------------------------------------------------------------------------------- normalization

/** Validates a model from disk, collaborators or Vibe; drops what cannot be drawn. */
export function normalizeBoard(raw) {
  const m = raw && typeof raw === "object" ? raw : {};
  const pagesIn = Array.isArray(m.pages) && m.pages.length ? m.pages : [{ id: "p1", name: "Page 1" }];
  const pages = [];
  const seen = new Set();
  pagesIn.forEach((p, i) => {
    const id = isId(p?.id) && !seen.has(p.id) ? p.id : newId("p");
    seen.add(id);
    pages.push({ id, name: String(p?.name || `Page ${i + 1}`).slice(0, 120), z: isKey(p?.z) ? p.z : initialKey(i, pagesIn.length), paper: PAPERS.includes(p?.paper) ? p.paper : "plain" });
  });
  const elements = {};
  for (const [k, e] of Object.entries(m.elements || {})) {
    if (!e || !TYPES.includes(e.type)) continue;
    const id = isId(e.id) ? e.id : isId(k) ? k : newId();
    const el = { ...e, id, page: seen.has(e.page) ? e.page : pages[0].id, x: num(e.x), y: num(e.y), w: num(e.w), h: num(e.h), angle: num(e.angle), z: isKey(e.z) ? e.z : "", opacity: Math.max(0, Math.min(1, num(e.opacity, 1))), width: Math.max(0, num(e.width, 2)), seed: num(e.seed, 1) | 0 };
    if (el.points) el.points = Array.isArray(el.points) ? el.points.filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map((p) => p.slice(0, 3).map(Number)) : [[0, 0]];
    if ((LINEAR.includes(el.type) || INK.includes(el.type)) && !el.points?.length) continue;
    if (typeof el.text === "string") el.text = el.text.slice(0, 20000);
    elements[id] = el;
  }
  // keys for elements without one, in their stored order
  const missing = Object.values(elements).filter((e) => !e.z);
  missing.forEach((e, i) => (e.z = initialKey(i, missing.length)));
  const media = {};
  for (const [id, md] of Object.entries(m.media || {})) if (md?.bytes || md?.data) media[id] = md;
  return { version: BOARD_VERSION, title: String(m.title || ""), background: typeof m.background === "string" ? m.background : "#ffffff", pages, elements, media };
}

// ---------------------------------------------------------------------------------------------- text helpers

/** Approximate text size (the UI replaces it with canvas measurement for exact layout). */
export const approxWidth = (s, size) => [...String(s)].length * size * 0.56;
export function textBox(text, fontSize, measure = approxWidth) {
  const lines = String(text || "").split("\n");
  return { w: Math.max(fontSize * 0.6, ...lines.map((l) => measure(l, fontSize))) + 4, h: lines.length * fontSize * 1.25 };
}

/** Plain text of an element (labels, notes, frame names) for describe, find and comments. */
export const elementText = (el) => (el.type === "frame" ? el.name || "" : el.text || "");

// ---------------------------------------------------------------------------------------------- describe

/** Small model-only summary for Vibe (office_describe, board_describe) and the system prompt. */
export function describeBoard(model, { page = null, limit = 80 } = {}) {
  const pages = sortedPages(model);
  const counts = {};
  for (const e of Object.values(model.elements)) counts[e.type] = (counts[e.type] || 0) + 1;
  const pick = page ? pages.filter((p) => p.id === page) : pages;
  const items = [];
  for (const p of pick) {
    for (const e of pageElements(model, p.id)) {
      if (items.length >= limit) break;
      const it = { id: e.id, type: e.type, page: p.id, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h) };
      const txt = elementText(e);
      if (txt) it.text = txt.slice(0, 120);
      if (e.start || e.end) Object.assign(it, { from: e.start?.id || null, to: e.end?.id || null });
      if (e.group) it.group = e.group;
      if (e.frame) it.frame = e.frame;
      if (e.fill && e.type !== "sticky") it.fill = e.fill;
      items.push(it);
    }
  }
  const total = Object.keys(model.elements).length;
  return { kind: "board", title: model.title || "", pages: pages.map((p) => ({ id: p.id, name: p.name, paper: p.paper, elements: Object.values(model.elements).filter((e) => e.page === p.id).length })), elements: total, types: counts, items, ...(total > items.length ? { truncated: total - items.length } : {}) };
}

// ---------------------------------------------------------------------------------------------- templates

const sticky = (page, x, y, text, fill = STICKY_COLORS[0], extra = {}) => makeElement("sticky", { page, x, y, text, fill, ...extra });
const shape = (type, page, x, y, w, h, text, extra = {}) => makeElement(type, { page, x, y, w, h, text, ...extra });
const link = (type, from, to, extra = {}) => makeElement(type, { page: from.page, points: [center(from), center(to)].map(([x, y]) => [x, y]), start: { id: from.id }, end: { id: to.id }, ...extra });

/** A new board model from a template id of the manifest. */
export function templateBoard(template = "blank", { title = "" } = {}) {
  let m = emptyModel({ title, paper: template === "brainstorm" ? "dots" : template === "notebook" ? "lines" : "plain" });
  const p = m.pages[0].id;
  const els = [];
  if (template === "brainstorm") {
    const topic = shape("ellipse", p, 380, 260, 240, 130, "Main topic", { fill: "#d0ebff", fontSize: 28 });
    els.push(topic);
    const ideas = ["Idea", "Question", "Risk", "Opportunity", "Next step", "Who to ask"];
    ideas.forEach((txt, i) => {
      const a = (i / ideas.length) * Math.PI * 2 - Math.PI / 2;
      const s = sticky(p, 500 + Math.cos(a) * 360 - 90, 325 + Math.sin(a) * 250 - 90, txt, STICKY_COLORS[i % STICKY_COLORS.length], { w: 180, h: 180 });
      els.push(s, link("line", topic, s, { stroke: "#868e96" }));
    });
  } else if (template === "kanban") {
    ["To do", "Doing", "Done"].forEach((name, i) => {
      const f = makeElement("frame", { page: p, name, x: 40 + i * 340, y: 40, w: 300, h: 640 });
      els.push(f);
      const notes = i === 0 ? ["First task", "Second task", "Third task"] : i === 1 ? ["In progress"] : ["Finished"];
      notes.forEach((t, k) => els.push(sticky(p, f.x + 40, f.y + 30 + k * 200, t, STICKY_COLORS[i], { w: 220, h: 170, frame: f.id })));
    });
  } else if (template === "flowchart") {
    const start = shape("ellipse", p, 340, 40, 200, 80, "Start", { fill: "#c8f0d0" });
    const step = shape("rect", p, 330, 190, 220, 90, "Do something", { round: true });
    const q = shape("diamond", p, 320, 350, 240, 140, "Decision?", { fill: "#fff3a0" });
    const yes = shape("rect", p, 90, 560, 220, 90, "Yes: continue", { round: true });
    const no = shape("rect", p, 570, 560, 220, 90, "No: try again", { round: true });
    const end = shape("ellipse", p, 340, 730, 200, 80, "End", { fill: "#ffd1dc" });
    els.push(start, step, q, yes, no, end, link("arrow", start, step), link("arrow", step, q), link("arrow", q, yes, { text: "yes" }), link("arrow", q, no, { text: "no" }), link("arrow", yes, end), link("arrow", no, step));
  } else if (template === "notebook") {
    els.push(makeElement("text", { page: p, x: 60, y: 40, text: "Notes", fontSize: 40, w: 140, h: 50 }));
    m = { ...m, pages: [...m.pages, { id: "p2", name: "Page 2", z: keyBetween(m.pages[0].z, null), paper: "lines" }] };
    m = { ...m, pages: [...m.pages, { id: "p3", name: "Page 3", z: keyBetween(m.pages[1].z, null), paper: "grid" }] };
  }
  return addElements(m, els);
}

// ---------------------------------------------------------------------------------------------- collaboration

const b64 = (bytes) => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
export { b64 as toBase64, unb64 as fromBase64 };

const MEDIA_INLINE = 46 * 1024; // bytes; base64 stays under the 64 KiB record limit

/**
 * collabAdapter.records: one record per element ("el:<id>", last writer wins per element), per page ("page:<id>"),
 * per image ("media:<id>", inline up to ~46 KiB) and the board settings ("meta:board").
 */
export function boardRecords(model) {
  const out = { "meta:board": { title: model.title || "", background: model.background || "#ffffff" } };
  for (const p of model.pages) out[`page:${p.id}`] = { name: p.name, z: p.z, paper: p.paper };
  for (const e of Object.values(model.elements)) out[`el:${e.id}`] = e;
  for (const [id, md] of Object.entries(model.media || {})) {
    const small = md.bytes && md.bytes.length <= MEDIA_INLINE;
    out[`media:${id}`] = { mime: md.mime, name: md.name || "", w: md.w || 0, h: md.h || 0, ...(small ? { data: b64(md.bytes) } : { missing: true }) };
  }
  return out;
}

/** collabAdapter.applyRecords: applies { key: value | null } and returns the new model. */
export function applyBoardRecords(model, changes) {
  let pages = [...model.pages];
  const elements = { ...model.elements };
  const media = { ...(model.media || {}) };
  let meta = null;
  for (const [k, v] of Object.entries(changes)) {
    const i = k.indexOf(":");
    const kind = k.slice(0, i);
    const id = k.slice(i + 1);
    if (kind === "meta" && v) meta = v;
    else if (kind === "page" && isId(id)) {
      pages = pages.filter((p) => p.id !== id);
      if (v) pages.push({ id, name: String(v.name || "Page"), z: isKey(v.z) ? v.z : keyBetween(null, null), paper: PAPERS.includes(v.paper) ? v.paper : "plain" });
    } else if (kind === "el" && isId(id)) {
      if (v && TYPES.includes(v.type)) elements[id] = { ...v, id };
      else delete elements[id];
    } else if (kind === "media" && isId(id)) {
      if (!v) delete media[id];
      else if (v.data && !media[id]?.bytes) media[id] = { id, mime: v.mime, name: v.name || "", w: v.w, h: v.h, bytes: unb64(v.data) };
      else if (!media[id]) media[id] = { id, mime: v.mime, name: v.name || "", w: v.w, h: v.h, missing: true };
    }
  }
  if (!pages.length) pages = model.pages;
  const pageIds = new Set(pages.map((p) => p.id));
  for (const [id, e] of Object.entries(elements)) if (!pageIds.has(e.page)) delete elements[id];
  return { ...model, ...(meta ? { title: String(meta.title || ""), background: meta.background || "#ffffff" } : {}), pages, elements, media };
}
