// Whiteboard renderer: board elements → engine display lists (docs/engine-contracts.md ▸ Display list). One pipeline
// for every output: the screen (engine/backends/canvas.js), SVG (backends/svg.js), PDF (backends/pdf.js through
// toolkit/export.js) and PNG. Pure apart from the optional `measure` and `image` hooks the caller passes.
//
// Public API
//   elementItems(el, ctx) → DLItem[]                 cached per element object (models are immutable)
//   pageDisplayList(model, pageId, { region?, padding?, measure?, image?, background? }) → { width, height, items, origin }
//   inkOutline(points, width) → [[x, y]]              variable-width outline of a pressure stroke (polygon)
//   smoothPath(points, closed?) → PathData           quadratic smoothing through midpoints
//   wrapText(text, width, size, measure) → string[]
//   FONT_FAMILY                                       board font id → CSS family
// ctx: { measure(text, size, font) → px, image(mediaId) → ImageRef | null }
import { roughRect, roughEllipse, roughPolygon, roughPolyline, roughLine, hachure } from "../toolkit/rough.js";
import { pageElements, unionBounds, absPoints, INK, LINEAR, approxWidth } from "./model.js";

export const FONT_FAMILY = { hand: "Comic Sans MS", sans: "Helvetica", serif: "Georgia", mono: "Courier New" };
const IDENT = [1, 0, 0, 1, 0, 0];
const solid = (color, alpha = 1) => (color ? { type: "solid", color: hex(color), alpha } : null);
const DASH = { solid: null, dashed: [8, 6], dotted: [1.5, 6] };
const stroke = (color, width, dash = "solid", w = width) => (color && width > 0 ? { paint: solid(color), width, cap: "round", join: "round", miterLimit: 10, dash: DASH[dash] ? DASH[dash].map((d) => (d * Math.max(1, w)) / 2) : null, dashOffset: 0 } : null);

/** Normalizes CSS colors the backends understand (#rgb, #rrggbb; named colors fall back to black). */
function hex(c) {
  if (typeof c !== "string") return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7).toLowerCase();
  return NAMED[c] || "#000000";
}
const NAMED = { black: "#000000", white: "#ffffff", red: "#e03131", green: "#2f9e44", blue: "#1971c2", yellow: "#f08c00", transparent: null };

const polyD = (pts, close = false) => {
  const d = pts.map(([x, y], i) => [i ? "L" : "M", x, y]);
  if (close && d.length) d.push(["Z"]);
  return d;
};
const strokesD = (strokes) => strokes.flatMap((s) => polyD(s));
const path = (d, fill, strk, m = IDENT, rule = "nonzero") => ({ t: "path", d, rule, fill, stroke: strk, m });

/** Quadratic smoothing through segment midpoints (pen strokes, curved lines). */
export function smoothPath(pts, closed = false) {
  if (pts.length < 3) return polyD(pts, closed);
  const d = [["M", pts[0][0], pts[0][1]]];
  if (closed) d[0] = ["M", (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 1; i < last; i++) {
    const p = pts[i % n];
    const q = pts[(i + 1) % n];
    d.push(["Q", p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  }
  if (closed) {
    d.push(["Q", pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]);
    d.push(["Z"]);
  } else d.push(["L", pts[n - 1][0], pts[n - 1][1]]);
  return d;
}

/**
 * Outline polygon of a pressure-sensitive stroke: each point gets a radius from its pressure (0..1; 0.5 = mouse), the
 * left and right offsets along the averaged normal are joined with round caps. Clean-room, no third-party code.
 */
export function inkOutline(points, width) {
  const pts = [];
  for (const p of points) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.5) pts.push(p);
  const rad = (p) => (width / 2) * (0.35 + 1.3 * (p[2] ?? 0.5));
  if (pts.length < 2) {
    const [x, y] = pts[0] || points[0] || [0, 0];
    const r = rad(pts[0] || [0, 0, 0.5]);
    return Array.from({ length: 12 }, (_, i) => [x + Math.cos((i / 12) * Math.PI * 2) * r, y + Math.sin((i / 12) * Math.PI * 2) * r]);
  }
  const left = [];
  const right = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // taper the ends a little, like a real pen
    const taper = Math.min(1, 0.55 + 0.45 * Math.min(i, n - 1 - i) / 3);
    const r = rad(pts[i]) * taper;
    left.push([pts[i][0] - dy * r, pts[i][1] + dx * r]);
    right.push([pts[i][0] + dy * r, pts[i][1] - dx * r]);
  }
  const cap = (p, from, to, r) => {
    const out = [];
    for (let k = 1; k < 6; k++) {
      const t = from + ((to - from) * k) / 6;
      out.push([p[0] + Math.cos(t) * r, p[1] + Math.sin(t) * r]);
    }
    return out;
  };
  const end = pts[n - 1];
  const start = pts[0];
  const ae = Math.atan2(left[n - 1][1] - end[1], left[n - 1][0] - end[0]);
  const as = Math.atan2(right[0][1] - start[1], right[0][0] - start[0]);
  return [...left, ...cap(end, ae, ae - Math.PI, rad(end) * 0.55), ...right.reverse(), ...cap(start, as, as - Math.PI, rad(start) * 0.55)];
}

/** Greedy word wrap to a width (long words break by characters). */
export function wrapText(text, width, size, measure) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    if (width <= 0) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (!line || measure(next, size) <= width) {
        line = next;
        continue;
      }
      out.push(line.trimEnd());
      line = word.trimStart();
      while (measure(line, size) > width && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && measure(line.slice(0, k), size) > width) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line);
  }
  return out;
}

/** A text item: lines laid out in a box (align left/center/right, vertically centered when `middle`). */
function textItem(lines, { x, y, w, h, size, font, color, align = "left", middle = false, measure }) {
  const lh = size * 1.25;
  const total = lines.length * lh;
  let top = middle ? y + (h - total) / 2 : y;
  const family = FONT_FAMILY[font] || FONT_FAMILY.sans;
  const runs = [];
  for (const line of lines) {
    const width = measure(line, size, font);
    const lx = align === "center" ? x + (w - width) / 2 : align === "right" ? x + w - width : x;
    if (line) runs.push({ text: line, x: lx, y: top + size * 0.96, width, font: { family, size, weight: 400, style: "normal" }, fill: solid(color), stroke: null, letterSpacing: 0, underline: false, strike: false });
    top += lh;
  }
  return runs.length ? { t: "text", runs, m: IDENT } : null;
}

const cache = new WeakMap(); // element object → items (models are immutable; a changed element is a new object)

/** Display list items of one element in world coordinates. */
export function elementItems(el, ctx = {}) {
  const hit = cache.get(el);
  if (hit && hit.ctxKey === ctx.key) return hit.items;
  const items = build(el, { measure: ctx.measure || ((s, size) => approxWidth(s, size)), image: ctx.image || (() => null) });
  if (!el.media || ctx.image?.(el.media)) cache.set(el, { items, ctxKey: ctx.key });
  return items;
}

function build(el, ctx) {
  const { w, h } = el;
  const a = el.angle || 0;
  const cx = el.x + w / 2;
  const cy = el.y + h / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // local box (0..w, 0..h) → world, rotated about the center
  const m = [c, s, -s, c, cx - c * (w / 2) + s * (h / 2), cy - s * (w / 2) - c * (h / 2)];
  const rough = el.rough || 0;
  const ro = { seed: el.seed || 1, roughness: rough, bowing: 1 };
  const sw = el.width ?? 2;
  const items = [];
  const fillItems = (poly) => {
    if (!el.fill) return;
    if (el.fillStyle === "hachure" || el.fillStyle === "cross") {
      const gap = Math.max(5, sw * 3);
      const lines = hachure(poly, { ...ro, roughness: Math.max(rough, 0.3), gap });
      if (el.fillStyle === "cross") lines.push(...hachure(poly, { ...ro, roughness: Math.max(rough, 0.3), gap, angle: 49, seed: ro.seed + 3 }));
      items.push(path(strokesD(lines), null, stroke(el.fill, Math.max(1, sw / 2)), m));
    } else items.push(path(polyD(poly, true), solid(el.fill), null, m));
  };
  const label = (box) => {
    if (!el.text) return;
    const size = el.fontSize || 20;
    const lines = wrapText(el.text, box.w, size, (t, sz) => ctx.measure(t, sz, el.font));
    const it = textItem(lines, { ...box, size, font: el.font, color: el.type === "sticky" ? "#1e1e1e" : el.stroke || "#1e1e1e", align: el.align || "center", middle: true, measure: (t, sz) => ctx.measure(t, sz, el.font) });
    if (it) items.push({ ...it, m });
  };
  switch (el.type) {
    case "rect": {
      const r = el.round ? Math.min(16, w / 4, h / 4) : 0;
      const poly = r ? roundedPoly(w, h, r) : [[0, 0], [w, 0], [w, h], [0, h]];
      fillItems(poly);
      const outline = rough ? strokesD(r ? roughPolygon(poly, ro) : roughRect(0, 0, w, h, ro)) : polyD(poly, true);
      items.push(path(outline, null, stroke(el.stroke, sw, el.dash), m));
      label({ x: 8, y: 6, w: w - 16, h: h - 12 });
      break;
    }
    case "ellipse": {
      const poly = Array.from({ length: 48 }, (_, i) => [w / 2 + Math.cos((i / 48) * Math.PI * 2) * (w / 2), h / 2 + Math.sin((i / 48) * Math.PI * 2) * (h / 2)]);
      fillItems(poly);
      const outline = rough ? strokesD(roughEllipse(w / 2, h / 2, w / 2, h / 2, ro)) : polyD(poly, true);
      items.push(path(outline, null, stroke(el.stroke, sw, el.dash), m));
      label({ x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 });
      break;
    }
    case "diamond": {
      const poly = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
      fillItems(poly);
      items.push(path(rough ? strokesD(roughPolygon(poly, ro)) : polyD(poly, true), null, stroke(el.stroke, sw, el.dash), m));
      label({ x: w * 0.22, y: h * 0.22, w: w * 0.56, h: h * 0.56 });
      break;
    }
    case "line":
    case "arrow": {
      const pts = absPoints(el);
      const d = rough ? strokesD(roughPolyline(pts, ro)) : el.curve && pts.length > 2 ? smoothPath(pts) : polyD(pts);
      items.push(path(d, null, stroke(el.stroke, sw, el.dash), IDENT));
      const heads = el.heads || {};
      if (pts.length >= 2) {
        if (heads.end && heads.end !== "none") items.push(...arrowHead(pts[pts.length - 1], pts[pts.length - 2], heads.end, el, ro));
        if (heads.start && heads.start !== "none") items.push(...arrowHead(pts[0], pts[1], heads.start, el, ro));
      }
      if (el.text) {
        const mid = midpointOf(pts);
        const size = el.fontSize || 18;
        const tw = ctx.measure(el.text, size, el.font);
        const box = { x: mid[0] - tw / 2 - 4, y: mid[1] - size * 0.7, w: tw + 8, h: size * 1.4 };
        items.push(path(polyD([[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]], true), solid("#ffffff"), null, IDENT));
        const it = textItem([el.text], { ...box, size, font: el.font || "hand", color: el.stroke, align: "center", middle: true, measure: (t, sz) => ctx.measure(t, sz, el.font) });
        if (it) items.push(it);
      }
      break;
    }
    case "pen":
    case "highlighter": {
      const pts = absPoints(el).map((p, i) => [p[0], p[1], el.type === "highlighter" ? 0.5 : (el.points[i][2] ?? 0.5)]);
      if (el.type === "highlighter") items.push(path(pts.length > 2 ? smoothPath(pts) : polyD(pts), null, { ...stroke(el.stroke, sw), cap: "round" }, IDENT));
      else items.push(path(smoothPath(inkOutline(pts, sw), true), solid(el.stroke), null, IDENT));
      break;
    }
    case "text": {
      const size = el.fontSize || 24;
      const it = textItem(String(el.text || "").split("\n"), { x: 2, y: 0, w: w - 4, h, size, font: el.font, color: el.stroke, align: el.align || "left", measure: (t, sz) => ctx.measure(t, sz, el.font) });
      if (it) items.push({ ...it, m });
      break;
    }
    case "sticky": {
      items.push(path(polyD([[3, 5], [w + 3, 5], [w + 3, h + 5], [3, h + 5]], true), solid("#000000", 0.12), null, m));
      const poly = rough ? [[0, 0], [w, 0], [w, h - 2], [w - 2, h], [0, h]] : [[0, 0], [w, 0], [w, h], [0, h]];
      items.push(path(polyD(poly, true), solid(el.fill || "#fff3a0"), null, m));
      label({ x: 12, y: 12, w: w - 24, h: h - 24 });
      break;
    }
    case "image": {
      const img = el.media ? ctx.image(el.media) : null;
      if (img && img.width && img.height) items.push({ t: "image", img, m: mul(m, [w / img.width, 0, 0, h / img.height, 0, 0]), smooth: true });
      else {
        items.push(path(polyD([[0, 0], [w, 0], [w, h], [0, h]], true), solid("#e9ecef"), stroke("#adb5bd", 1, "dashed"), m));
        items.push(path(polyD([[0, 0], [w, h]]).concat(polyD([[w, 0], [0, h]])), null, stroke("#adb5bd", 1), m));
      }
      if (el.stroke && el.width && el.frameImage) items.push(path(polyD([[0, 0], [w, 0], [w, h], [0, h]], true), null, stroke(el.stroke, sw), m));
      break;
    }
    case "frame": {
      items.push(path(polyD([[0, 0], [w, 0], [w, h], [0, h]], true), el.fill ? solid(el.fill) : null, stroke(el.stroke || "#868e96", 1), m));
      const it = textItem([el.name || "Frame"], { x: 0, y: -20, w, h: 18, size: 14, font: "sans", color: "#868e96", align: "left", measure: (t, sz) => ctx.measure(t, sz, "sans") });
      if (it) items.push({ ...it, m });
      break;
    }
  }
  if (el.opacity < 1 || el.type === "highlighter") return [{ t: "group", items, m: IDENT, opacity: el.opacity ?? 1, blend: el.type === "highlighter" ? "multiply" : "normal", clip: null, isolate: false }];
  return items;
}

function roundedPoly(w, h, r) {
  const out = [];
  const corner = (cx, cy, from) => {
    for (let k = 0; k <= 4; k++) {
      const t = from + (k / 4) * (Math.PI / 2);
      out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
  };
  corner(w - r, r, -Math.PI / 2);
  corner(w - r, h - r, 0);
  corner(r, h - r, Math.PI / 2);
  corner(r, r, Math.PI);
  return out;
}

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

function midpointOf(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (half <= l && l > 0) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * half) / l, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * half) / l];
    half -= l;
  }
  return pts[0];
}

function arrowHead(tip, from, kind, el, ro) {
  const sw = el.width ?? 2;
  const len = Math.max(12, sw * 4.5);
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (da) => [tip[0] - Math.cos(ang + da) * len, tip[1] - Math.sin(ang + da) * len];
  const st = stroke(el.stroke, sw);
  if (kind === "dot") {
    const r = Math.max(3, sw * 1.6);
    return [path(polyD(Array.from({ length: 16 }, (_, i) => [tip[0] + Math.cos((i / 16) * Math.PI * 2) * r, tip[1] + Math.sin((i / 16) * Math.PI * 2) * r]), true), solid(el.stroke), null)];
  }
  if (kind === "bar") {
    const a = [tip[0] + Math.cos(ang + Math.PI / 2) * len * 0.5, tip[1] + Math.sin(ang + Math.PI / 2) * len * 0.5];
    const b = [tip[0] - Math.cos(ang + Math.PI / 2) * len * 0.5, tip[1] - Math.sin(ang + Math.PI / 2) * len * 0.5];
    return [path(polyD([a, b]), null, st)];
  }
  if (kind === "triangle") return [path(polyD([tip, wing(0.42), wing(-0.42)], true), solid(el.stroke), st)];
  const l = wing(0.5);
  const r = wing(-0.5);
  if (el.rough) return [path(strokesD([...roughLine(l[0], l[1], tip[0], tip[1], { ...ro, seed: ro.seed + 11, passes: 1 }), ...roughLine(r[0], r[1], tip[0], tip[1], { ...ro, seed: ro.seed + 13, passes: 1 })]), null, st)];
  return [path(polyD([l, tip, r]), null, st)];
}

/**
 * The display list of a page: every element, translated so the content (or `region`) starts at 0, 0 with `padding`.
 * `origin` is the world point at (0, 0) of the list.
 */
export function pageDisplayList(model, pageId, { region = null, padding = 32, measure, image, background = model.background } = {}) {
  const els = pageElements(model, pageId);
  const box = region || unionBounds(els) || { x: 0, y: 0, w: 800, h: 600 };
  const x0 = box.x - (region ? 0 : padding);
  const y0 = box.y - (region ? 0 : padding);
  const width = Math.ceil(box.w + (region ? 0 : padding * 2));
  const height = Math.ceil(box.h + (region ? 0 : padding * 2));
  const ctx = { measure, image, key: "export" };
  const items = [];
  if (background) items.push(path(polyD([[0, 0], [width, 0], [width, height], [0, height]], true), solid(background), null));
  items.push({ t: "group", items: els.flatMap((e) => elementItems(e, ctx)), m: [1, 0, 0, 1, -x0, -y0], opacity: 1, blend: "normal", clip: null, isolate: false });
  return { width, height, items, origin: [x0, y0] };
}

export { INK, LINEAR };
