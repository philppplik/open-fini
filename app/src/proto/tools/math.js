// Geometry of the Proto Studio tools (docs/concepts/proto-studio.md §5.2): resize and rotate handles, constraints,
// drawing rectangles and lines, insertion points in auto layout, padding and gap handles, grid tracks and text runs.
// Pure: no DOM, unit tested (tests/proto/tools-math.test.js). Every rect is { x, y, w, h }; world units unless noted.
//
// Public API
//   HANDLES, handlePoints(rect) / hitHandle(rect, x, y, tol) / cursorFor(handle, rot)
//   resizeRect(rect, handle, dx, dy, { ratio, center, min }) → rect
//   rotationAt(center, from, to, base, { snap }) / snapAngle(deg, step)
//   applyConstraints(child, from, to) → { x, y, w, h }       how an absolute child follows its resized parent
//   scaleInto(box, from, to) → box                           a box of a multiple selection resized with its bounds
//   dragRect(x0, y0, x1, y1, { square, center }) / lineFrom(x0, y0, x1, y1, { snap })
//   insertionAt(boxes, point, dir) → { index, line }         where a dragged layer lands in an auto layout
//   padHandles(box, pad, scale) / gapHandles(boxes, dir, scale) / dragPad(pad, side, delta, { all, mirror })
//   nextSizeMode(mode, { fill, hug }) / parseTracks(text) / formatTracks(tracks) / editRuns(runs, text)
//   guessDirection(boxes) → "row" | "column"

export const HANDLES = Object.freeze(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

/** The eight handle points of a rect: [{ id, x, y }]. */
export function handlePoints(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  return [
    { id: "nw", x: r.x, y: r.y },
    { id: "n", x: cx, y: r.y },
    { id: "ne", x: x1, y: r.y },
    { id: "e", x: x1, y: cy },
    { id: "se", x: x1, y: y1 },
    { id: "s", x: cx, y: y1 },
    { id: "sw", x: r.x, y: y1 },
    { id: "w", x: r.x, y: cy },
  ];
}

/**
 * The handle under (x, y) for a rect in the same units (stage pixels): a corner or edge handle within `tol`, a rotate
 * zone just outside a corner ("rot-nw" …), or null. Edge handles cover the whole edge, so thin layers stay resizable.
 */
export function hitHandle(r, x, y, tol = 5, { rotate = true, edges = true } = {}) {
  const pts = handlePoints(r);
  for (const id of ["nw", "ne", "se", "sw"]) {
    const p = pts.find((q) => q.id === id);
    if (Math.abs(x - p.x) <= tol && Math.abs(y - p.y) <= tol) return id;
  }
  if (edges) {
    const inX = x > r.x + tol && x < r.x + r.w - tol;
    const inY = y > r.y + tol && y < r.y + r.h - tol;
    if (inX && Math.abs(y - r.y) <= tol) return "n";
    if (inX && Math.abs(y - (r.y + r.h)) <= tol) return "s";
    if (inY && Math.abs(x - r.x) <= tol) return "w";
    if (inY && Math.abs(x - (r.x + r.w)) <= tol) return "e";
  }
  if (rotate) {
    const out = tol * 3.5;
    for (const id of ["nw", "ne", "se", "sw"]) {
      const p = pts.find((q) => q.id === id);
      const sx = id.includes("w") ? -1 : 1;
      const sy = id.includes("n") ? -1 : 1;
      const dx = (x - p.x) * sx;
      const dy = (y - p.y) * sy;
      if (dx >= -tol && dy >= -tol && dx <= out && dy <= out && (dx > tol || dy > tol)) return `rot-${id}`;
    }
  }
  return null;
}

const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];
const ANGLES = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
/** The CSS cursor of a handle, turned with the layer's rotation. */
export function cursorFor(handle, rot = 0) {
  if (!handle) return "";
  if (handle.startsWith("rot-")) return "crosshair";
  const a = (((ANGLES[handle] + rot) % 180) + 180) % 180;
  return CURSORS[Math.round(a / 45) % 4];
}

/**
 * Resizes `r` by dragging `handle` by (dx, dy).
 *   ratio    keep the aspect ratio (Shift)
 *   center   resize around the center (Alt)
 *   min      the smallest width and height
 * The result is normalized (a drag across the opposite edge flips into a positive rect).
 */
export function resizeRect(r, handle, dx, dy, { ratio = false, center = false, min = 1 } = {}) {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  const hasW = handle.includes("w");
  const hasE = handle.includes("e");
  const hasN = handle.includes("n");
  const hasS = handle.includes("s");
  if (hasW) x0 += dx;
  if (hasE) x1 += dx;
  if (hasN) y0 += dy;
  if (hasS) y1 += dy;
  if (center) {
    if (hasW) x1 -= dx;
    if (hasE) x0 -= dx;
    if (hasN) y1 -= dy;
    if (hasS) y0 -= dy;
  }
  if (ratio && r.w > 0 && r.h > 0) {
    const aspect = r.w / r.h;
    let w = Math.abs(x1 - x0);
    let h = Math.abs(y1 - y0);
    const corner = (hasW || hasE) && (hasN || hasS);
    if (corner) {
      if (w / aspect >= h) h = w / aspect;
      else w = h * aspect;
    } else if (hasW || hasE) h = w / aspect;
    else w = h * aspect;
    const cx = (r.x + r.x + r.w) / 2;
    const cy = (r.y + r.y + r.h) / 2;
    // the fixed side stays where it is; edges grow symmetrically on the other axis
    if (center) {
      x0 = cx - w / 2;
      x1 = cx + w / 2;
      y0 = cy - h / 2;
      y1 = cy + h / 2;
    } else {
      if (hasW) x0 = x1 - w * Math.sign(x1 - x0 || 1);
      else if (hasE) x1 = x0 + w * Math.sign(x1 - x0 || 1);
      else (x0 = cx - w / 2), (x1 = cx + w / 2);
      if (hasN) y0 = y1 - h * Math.sign(y1 - y0 || 1);
      else if (hasS) y1 = y0 + h * Math.sign(y1 - y0 || 1);
      else (y0 = cy - h / 2), (y1 = cy + h / 2);
    }
  }
  const out = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  if (out.w < min) {
    if (hasW && !center) out.x = Math.max(x0, x1) - min;
    out.w = min;
  }
  if (out.h < min) {
    if (hasN && !center) out.y = Math.max(y0, y1) - min;
    out.h = min;
  }
  return out;
}

/** `deg` rounded to the nearest multiple of `step`. */
export const snapAngle = (deg, step = 15) => Math.round(deg / step) * step;

const norm180 = (d) => {
  let a = ((d % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return Math.round(a * 100) / 100 || 0;
};

/** The rotation (degrees, -180..180) after dragging from `from` to `to` around `center`, starting at `base`. */
export function rotationAt(center, from, to, base = 0, { snap = false } = {}) {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  let deg = base + ((a1 - a0) * 180) / Math.PI;
  if (snap) deg = snapAngle(deg);
  return norm180(deg);
}

/**
 * How an absolutely positioned child follows its parent's resize (the layer's `cx` and `cy`, concept §3.2): the
 * stored box of `child` ({ x, y, w, h, cx, cy }, relative to the parent) for a parent resized from `from` to `to`
 * ({ w, h }). Left/top keep the offset; right/bottom keep the distance to the far edge; left-right and top-bottom
 * stretch; center keeps the offset from the center; scale scales position and size.
 */
export function applyConstraints(child, from, to) {
  const axis = (pos, size, c, f, t, startC, endC, bothC) => {
    const d = t - f;
    if (c === endC) return [pos + d, size];
    if (c === bothC) return [pos, Math.max(0, size + d)];
    if (c === "center") return [pos + d / 2, size];
    if (c === "scale" && f > 0) return [(pos * t) / f, (size * t) / f];
    return [pos, size];
  };
  const [x, w] = axis(child.x || 0, child.w || 0, child.cx || "left", from.w, to.w, "left", "right", "leftRight");
  const [y, h] = axis(child.y || 0, child.h || 0, child.cy || "top", from.h, to.h, "top", "bottom", "topBottom");
  const r = (v) => Math.round(v * 100) / 100;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

/** A box inside the bounds `from` mapped into the bounds `to` (resizing a multiple selection). */
export function scaleInto(box, from, to) {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  return { x: to.x + (box.x - from.x) * sx, y: to.y + (box.y - from.y) * sy, w: box.w * sx, h: box.h * sy };
}

/** The rect of a drawing drag: Shift draws a square (circle), Alt draws from the center. */
export function dragRect(x0, y0, x1, y1, { square = false, center = false } = {}) {
  let dx = x1 - x0;
  let dy = y1 - y0;
  if (square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = s * (Math.sign(dx) || 1);
    dy = s * (Math.sign(dy) || 1);
  }
  if (center) return { x: x0 - Math.abs(dx), y: y0 - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  return { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/**
 * A line layer from (x0, y0) to (x1, y1): lines are stored horizontal ({ w: length, h: 0 }) and turned with `rot`
 * around their center, so `x`, `y` is the left end of the unrotated line. `snap` (Shift) keeps 45° steps.
 */
export function lineFrom(x0, y0, x1, y1, { snap = false } = {}) {
  let dx = x1 - x0;
  let dy = y1 - y0;
  let len = Math.hypot(dx, dy);
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (snap) {
    deg = snapAngle(deg, 45);
    dx = Math.cos((deg * Math.PI) / 180) * len;
    dy = Math.sin((deg * Math.PI) / 180) * len;
  }
  const cx = x0 + dx / 2;
  const cy = y0 + dy / 2;
  const r = (v) => Math.round(v * 100) / 100;
  len = r(len);
  return { x: r(cx - len / 2), y: r(cy), w: len, rot: norm180(deg), end: { x: x0 + dx, y: y0 + dy } };
}

/**
 * Where a layer dragged to `point` lands among the flow children `boxes` (in order) of an auto layout with direction
 * `dir`: { index, line } where `line` is the insertion marker ({ x, y, w, h }, zero width or height).
 */
export function insertionAt(boxes, point, dir = "row") {
  const main = dir === "row" ? "x" : "y";
  const size = dir === "row" ? "w" : "h";
  const v = point[main];
  let index = boxes.length;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (v < b[main] + b[size] / 2) {
      index = i;
      break;
    }
  }
  if (!boxes.length) return { index: 0, line: null };
  let at;
  if (index === 0) at = boxes[0][main];
  else if (index === boxes.length) at = boxes[index - 1][main] + boxes[index - 1][size];
  else at = (boxes[index - 1][main] + boxes[index - 1][size] + boxes[index][main]) / 2;
  const ref = boxes[Math.min(index, boxes.length - 1)];
  const line = dir === "row" ? { x: at, y: ref.y, w: 0, h: ref.h } : { x: ref.x, y: at, w: ref.w, h: 0 };
  return { index, line };
}

/**
 * Padding handles of an auto layout container `box` (border box, world units) with padding `pad` [t, r, b, l]:
 * [{ side, index, area, grip }] where `area` is the padding strip and `grip` a small bar in its middle. `scale` is
 * the zoom, so grips keep a usable size on screen.
 */
export function padHandles(box, pad, scale = 1, border = [0, 0, 0, 0]) {
  const [t, r, b, l] = pad.map((v) => (Number.isFinite(v) ? v : 0));
  const ix = box.x + border[3];
  const iy = box.y + border[0];
  const iw = box.w - border[1] - border[3];
  const ih = box.h - border[0] - border[2];
  const gl = 16 / scale;
  const gt = 4 / scale;
  const areas = [
    { side: "top", index: 0, area: { x: ix, y: iy, w: iw, h: t } },
    { side: "right", index: 1, area: { x: ix + iw - r, y: iy, w: r, h: ih } },
    { side: "bottom", index: 2, area: { x: ix, y: iy + ih - b, w: iw, h: b } },
    { side: "left", index: 3, area: { x: ix, y: iy, w: l, h: ih } },
  ];
  return areas.map((a) => {
    const vertical = a.side === "left" || a.side === "right";
    const cx = a.area.x + a.area.w / 2;
    const cy = a.area.y + a.area.h / 2;
    const grip = vertical ? { x: cx - gt / 2, y: cy - gl / 2, w: gt, h: gl } : { x: cx - gl / 2, y: cy - gt / 2, w: gl, h: gt };
    return { ...a, grip };
  });
}

/** Gap handles between consecutive flow children (single-line auto layout): [{ index, area, grip }]. */
export function gapHandles(boxes, dir = "row", scale = 1) {
  const out = [];
  const gl = 16 / scale;
  const gt = 4 / scale;
  for (let i = 1; i < boxes.length; i++) {
    const a = boxes[i - 1];
    const b = boxes[i];
    let area;
    if (dir === "row") {
      const x = a.x + a.w;
      const y = Math.min(a.y, b.y);
      area = { x, y, w: Math.max(0, b.x - x), h: Math.max(a.y + a.h, b.y + b.h) - y };
    } else {
      const y = a.y + a.h;
      const x = Math.min(a.x, b.x);
      area = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(0, b.y - y) };
    }
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const grip = dir === "row" ? { x: cx - gt / 2, y: cy - gl / 2, w: gt, h: gl } : { x: cx - gl / 2, y: cy - gt / 2, w: gl, h: gt };
    out.push({ index: i, area, grip });
  }
  return out;
}

/**
 * New padding after dragging the handle of `side` (0 top, 1 right, 2 bottom, 3 left) by `delta` (inward positive).
 * `all` (Alt) sets every side, `mirror` (Shift) the opposite side too. Values are whole pixels, never negative.
 */
export function dragPad(pad, side, delta, { all = false, mirror = false } = {}) {
  const next = pad.slice();
  const v = Math.max(0, Math.round((pad[side] || 0) + delta));
  if (all) return [v, v, v, v];
  next[side] = v;
  if (mirror) next[(side + 2) % 4] = v;
  return next;
}

/** The sizing mode after `mode` when cycling hug → fill → fixed (skipping modes the layer cannot use). */
export function nextSizeMode(mode, { fill = true, hug = true } = {}) {
  const order = ["hug", "fill", "fixed"].filter((m) => (m === "fill" ? fill : m === "hug" ? hug : true));
  const i = order.indexOf(mode);
  return order[(i + 1) % order.length];
}

/** The direction an auto layout most likely has for children at `boxes`: spread wider than tall → row. */
export function guessDirection(boxes) {
  if (boxes.length < 2) return "column";
  const cx = boxes.map((b) => b.x + b.w / 2);
  const cy = boxes.map((b) => b.y + b.h / 2);
  return Math.max(...cx) - Math.min(...cx) > Math.max(...cy) - Math.min(...cy) ? "row" : "column";
}

/**
 * Grid tracks from CSS-like text ("1fr 240px auto minmax(200px, 1fr)"; a bare number is pixels; "repeat(3, 1fr)"
 * expands). Returns null when the text is not a track list.
 */
export function parseTracks(text) {
  const src = String(text || "").trim();
  if (!src) return [];
  const one = (tok) => {
    const s = tok.trim();
    let m;
    if ((m = /^(\d*\.?\d+)fr$/i.exec(s))) return { fr: +m[1] };
    if ((m = /^(\d*\.?\d+)(px)?$/i.exec(s))) return { px: +m[1] };
    if (/^auto$/i.test(s)) return { auto: true };
    if ((m = /^minmax\(\s*([^,]+),\s*([^)]+)\)$/i.exec(s))) {
      const a = one(m[1]);
      const b = one(m[2]);
      if (!a || !b || a.minmax || b.minmax) return null;
      return { minmax: [a.px !== undefined ? a.px : a, b.px !== undefined ? b.px : b] };
    }
    return null;
  };
  // split on whitespace outside parentheses
  const toks = [];
  let depth = 0;
  let cur = "";
  for (const ch of src) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) toks.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) toks.push(cur);
  const out = [];
  for (const tok of toks) {
    const rep = /^repeat\(\s*(\d+)\s*,\s*(.+)\)$/i.exec(tok);
    if (rep) {
      const inner = parseTracks(rep[2]);
      const n = Math.min(100, +rep[1]);
      if (!inner || !n) return null;
      for (let i = 0; i < n; i++) out.push(...inner.map((x) => ({ ...x })));
      continue;
    }
    const t = one(tok);
    if (!t) return null;
    out.push(t);
  }
  return out.length > 1000 ? null : out;
}

const trackText = (t) => {
  if (typeof t === "number") return `${t}px`;
  if (!t || typeof t !== "object") return "auto";
  if (t.fr !== undefined) return `${t.fr}fr`;
  if (t.px !== undefined) return typeof t.px === "number" ? `${t.px}px` : "auto";
  if (t.auto) return "auto";
  if (Array.isArray(t.minmax)) return `minmax(${trackText(t.minmax[0])}, ${trackText(t.minmax[1])})`;
  return "auto";
};
/** Text for grid tracks (the inverse of parseTracks). */
export const formatTracks = (tracks) => (Array.isArray(tracks) ? tracks.map(trackText).join(" ") : "");

/**
 * Text runs after the plain text of a layer was edited to `text`: the unchanged start and end keep their runs and
 * styles, the replaced middle takes the style of the run where the edit starts. Bound runs (`{ $var }`) are kept as
 * they are (their text comes from the variable).
 */
export function editRuns(runs, text) {
  const list = (Array.isArray(runs) ? runs : []).map((r) => ({ t: typeof r?.t === "string" ? r.t : "", s: r?.s || {} }));
  const old = list.map((r) => r.t).join("");
  if (old === text) return runs;
  if (!list.length) return [{ t: text, s: {} }];
  let pre = 0;
  while (pre < old.length && pre < text.length && old[pre] === text[pre]) pre++;
  let suf = 0;
  while (suf < old.length - pre && suf < text.length - pre && old[old.length - 1 - suf] === text[text.length - 1 - suf]) suf++;
  const inserted = text.slice(pre, text.length - suf);
  const cutEnd = old.length - suf;
  // the run that receives the inserted text: the one the edit starts in (typing at a boundary extends the run before)
  let pos = 0;
  let k = list.length - 1;
  for (let i = 0; i < list.length; i++) {
    const b = pos + list[i].t.length;
    if (pre <= b && list[i].t.length) {
      k = i;
      break;
    }
    pos = b;
  }
  const clamp = (v, n) => Math.max(0, Math.min(n, v));
  const out = [];
  pos = 0;
  list.forEach((r, i) => {
    const a = pos;
    const n = r.t.length;
    pos += n;
    if (typeof runs[i]?.t !== "string") return void out.push(runs[i]); // bound text stays bound (T6 edits bindings)
    const head = r.t.slice(0, clamp(pre - a, n));
    const tail = r.t.slice(clamp(cutEnd - a, n));
    const t = head + (i === k ? inserted : "") + tail;
    if (t.length) out.push(t === r.t ? runs[i] : { t, s: r.s });
  });
  return out.length ? out : [{ t: "", s: list[0].s }];
}
