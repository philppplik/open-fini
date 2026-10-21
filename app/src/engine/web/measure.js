// Measuring helpers of the Code studio: unit conversion, distance guides and box-model geometry.
//
// Pure (no DOM). The core lives in `measureKit()`, a self-contained factory with NO references to anything outside
// of its own body: the preview bridge (ui/code/bridge.js) serializes it with Function#toString and runs the very same
// code inside the sandboxed preview frame, so the overlay drawn in the frame and the numbers shown by the host can never
// disagree. Everything exported below the kit (`sanitizeBox`, `describeBox`, ...) runs on the host side only.
//
// Public API
//   UNITS                                   the supported length units
//   convert(px, unit, ctx)                  CSS px -> unit
//   formatValue(px, unit, ctx) / formatSize(w, h, unit, ctxW, ctxH)   "12.7mm", "320×48px"
//   edgeGuides(rect, vw, vh)                distance lines from a rect to the viewport edges
//   gapGuides(a, b)                         distance lines between two rects (or a inside b)
//   boxBands(rect, margin, border, padding) the four nested boxes of the box model
//   sanitizeBox(raw)                        strict validation of a box reported by the preview frame
//   describeBox(box, unit, opts)            the whole box model of a validated box in a unit
//
// Units: 1in = 96 CSS px by definition (CSS reference pixel). `ctx.ppi` overrides that basis; with `ctx.dprAware` the
// value is first multiplied by the device pixel ratio (physical pixels) so it matches a real screen of `ppi` dots/inch.
// Invariants: rects are { left, top, right, bottom } in CSS px; guide `px` values are always > 0.

export const UNITS = ["px", "mm", "cm", "in", "pt", "rem", "em", "%"];

/** Self-contained measuring kit (see the file header: it is serialized into the preview frame). */
export function measureKit() {
  var UNIT_LIST = ["px", "mm", "cm", "in", "pt", "rem", "em", "%"];
  var DECIMALS = { px: 1, mm: 1, cm: 2, in: 3, pt: 1, rem: 2, em: 2, "%": 1 };
  // millimeters per inch, centimeters per inch, points per inch
  var PER_INCH = { mm: 25.4, cm: 2.54, in: 1, pt: 72 };

  function num(n, d) {
    if (!isFinite(n)) return "–";
    var s = Number(n.toFixed(d)).toString();
    return s === "-0" ? "0" : s;
  }
  /** CSS px -> unit. ctx: { ppi, dpr, dprAware, rootPx, emPx, basisPx }. Returns NaN when the unit needs a missing basis. */
  function convert(px, unit, ctx) {
    ctx = ctx || {};
    if (unit === "px" || !unit) return px;
    if (unit === "rem") return ctx.rootPx > 0 ? px / ctx.rootPx : NaN;
    if (unit === "em") return ctx.emPx > 0 ? px / ctx.emPx : NaN;
    if (unit === "%") return ctx.basisPx > 0 ? (px / ctx.basisPx) * 100 : NaN;
    var per = PER_INCH[unit];
    if (!per) return px;
    var ppi = ctx.ppi > 0 ? ctx.ppi : 96;
    var scale = ctx.dprAware && ctx.dpr > 0 ? ctx.dpr : 1;
    return ((px * scale) / ppi) * per;
  }
  function formatValue(px, unit, ctx) {
    var u = unit || "px";
    return num(convert(px, u, ctx), DECIMALS[u] == null ? 1 : DECIMALS[u]) + u;
  }
  /** "320×48px": both axes in one unit; the unit suffix is written once. */
  function formatSize(w, h, unit, ctxW, ctxH) {
    var u = unit || "px";
    var d = DECIMALS[u] == null ? 1 : DECIMALS[u];
    return num(convert(w, u, ctxW), d) + "×" + num(convert(h, u, ctxH || ctxW), d) + u;
  }

  function guide(x1, y1, x2, y2, axis) {
    var px = axis === "x" ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    return { x1: x1, y1: y1, x2: x2, y2: y2, px: px, axis: axis };
  }
  /** Lines from the four edges of `r` to the viewport edges, drawn from the middle of each edge. */
  function edgeGuides(r, vw, vh) {
    var cx = (r.left + r.right) / 2;
    var cy = (r.top + r.bottom) / 2;
    var out = [];
    if (r.left > 0.5) out.push(guide(0, cy, r.left, cy, "x"));
    if (vw - r.right > 0.5) out.push(guide(r.right, cy, vw, cy, "x"));
    if (r.top > 0.5) out.push(guide(cx, 0, cx, r.top, "y"));
    if (vh - r.bottom > 0.5) out.push(guide(cx, r.bottom, cx, vh, "y"));
    return out;
  }
  function overlap(a0, a1, b0, b1) {
    var lo = Math.max(a0, b0);
    var hi = Math.min(a1, b1);
    return hi > lo ? [lo, hi] : null;
  }
  /**
   * Distance lines between two rects, like the "smart guides" of design tools:
   *  - b inside a (or a inside b): the four inner offsets;
   *  - side by side: one line across the gap, at the middle of the shared span;
   *  - diagonal: one horizontal and one vertical line.
   */
  function gapGuides(a, b) {
    var out = [];
    var inside = function (i, o) {
      return i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom;
    };
    if (inside(b, a) || inside(a, b)) {
      var o = inside(b, a) ? a : b;
      var i = inside(b, a) ? b : a;
      var cx = (i.left + i.right) / 2;
      var cy = (i.top + i.bottom) / 2;
      if (i.left - o.left > 0.5) out.push(guide(o.left, cy, i.left, cy, "x"));
      if (o.right - i.right > 0.5) out.push(guide(i.right, cy, o.right, cy, "x"));
      if (i.top - o.top > 0.5) out.push(guide(cx, o.top, cx, i.top, "y"));
      if (o.bottom - i.bottom > 0.5) out.push(guide(cx, i.bottom, cx, o.bottom, "y"));
      return out;
    }
    var xs = overlap(a.left, a.right, b.left, b.right); // shared horizontal span -> a vertical gap is measurable
    var ys = overlap(a.top, a.bottom, b.top, b.bottom);
    var xm = xs ? (xs[0] + xs[1]) / 2 : null;
    var ym = ys ? (ys[0] + ys[1]) / 2 : null;
    var left = a.right <= b.left ? a : b.right <= a.left ? b : null; // the one on the left (when they do not overlap in x)
    var right = left === a ? b : left === b ? a : null;
    var top = a.bottom <= b.top ? a : b.bottom <= a.top ? b : null;
    var bottom = top === a ? b : top === b ? a : null;
    if (left && right) {
      var y = ym != null ? ym : (top ? (top.bottom + bottom.top) / 2 : (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2);
      out.push(guide(left.right, y, right.left, y, "x"));
    }
    if (top && bottom) {
      var x = xm != null ? xm : (left ? (left.right + right.left) / 2 : (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2);
      out.push(guide(x, top.bottom, x, bottom.top, "y"));
    }
    return out;
  }

  /** Nested boxes of the box model. `rect` is the border box; margin/border/padding are [top, right, bottom, left]. */
  function boxBands(rect, margin, border, padding) {
    var m = margin || [0, 0, 0, 0];
    var b = border || [0, 0, 0, 0];
    var p = padding || [0, 0, 0, 0];
    var grow = function (r, v, sign) {
      return { left: r.left - sign * v[3], top: r.top - sign * v[0], right: r.right + sign * v[1], bottom: r.bottom + sign * v[2] };
    };
    var border_ = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    var padding_ = grow(border_, b, -1);
    var content = grow(padding_, p, -1);
    // negative margins shrink the margin box; never let a band invert
    var margin_ = grow(border_, m, 1);
    var fix = function (r) {
      return { left: r.left, top: r.top, right: Math.max(r.left, r.right), bottom: Math.max(r.top, r.bottom) };
    };
    return { margin: fix(margin_), border: border_, padding: fix(padding_), content: fix(content) };
  }

  return { UNITS: UNIT_LIST, convert: convert, formatValue: formatValue, formatSize: formatSize, edgeGuides: edgeGuides, gapGuides: gapGuides, boxBands: boxBands, num: num };
}

const kit = measureKit();
export const { convert, formatValue, formatSize, edgeGuides, gapGuides, boxBands } = kit;

// ------------------------------------------------------------------------------------------------ host side

const MAX = 1e6;
const fin = (n) => (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX ? n : null);
const quad = (a) => {
  if (!Array.isArray(a) || a.length !== 4) return null;
  const out = a.map(fin);
  return out.every((v) => v !== null) ? out : null;
};

/**
 * Validates a box-model report received from the preview frame (untrusted: the page can post anything).
 * Returns a normalized box or null. Never throws.
 * Wire format: { id, tag, rect: {x,y,w,h}, margin: [t,r,b,l], border: [...], padding: [...], fontSize, rootFontSize,
 *   parent: {w,h}|null, vw, vh }
 */
export function sanitizeBox(raw) {
  try {
    if (!raw || typeof raw !== "object") return null;
    const id = raw.id === null || raw.id === undefined ? null : Number.isInteger(raw.id) && raw.id >= 0 && raw.id < 1e7 ? raw.id : undefined;
    if (id === undefined) return null;
    const tag = typeof raw.tag === "string" && /^[a-z][a-z0-9:-]{0,31}$/i.test(raw.tag) ? raw.tag.toLowerCase() : null;
    const r = raw.rect;
    if (!tag || !r || typeof r !== "object") return null;
    const rect = { x: fin(r.x), y: fin(r.y), w: fin(r.w), h: fin(r.h) };
    if (Object.values(rect).some((v) => v === null) || rect.w < 0 || rect.h < 0) return null;
    const margin = quad(raw.margin);
    const border = quad(raw.border);
    const padding = quad(raw.padding);
    if (!margin || !border || !padding) return null;
    const fontSize = fin(raw.fontSize);
    const rootFontSize = fin(raw.rootFontSize);
    if (!(fontSize > 0) || !(rootFontSize > 0)) return null;
    let parent = null;
    if (raw.parent && typeof raw.parent === "object") {
      const pw = fin(raw.parent.w);
      const ph = fin(raw.parent.h);
      if (pw !== null && ph !== null && pw >= 0 && ph >= 0) parent = { w: pw, h: ph };
    }
    const vw = fin(raw.vw);
    const vh = fin(raw.vh);
    if (!(vw > 0) || !(vh > 0)) return null;
    return { id, tag, rect, margin, border, padding, fontSize, rootFontSize, parent, vw, vh };
  } catch {
    return null;
  }
}

/** Unit context for a validated box along an axis ("x" = widths, "y" = heights). */
export function unitContext(box, axis, opts = {}) {
  return {
    ppi: opts.ppi > 0 ? opts.ppi : 96,
    dpr: opts.dpr > 0 ? opts.dpr : 1,
    dprAware: !!opts.dprAware,
    rootPx: box.rootFontSize,
    emPx: box.fontSize,
    basisPx: box.parent ? (axis === "x" ? box.parent.w : box.parent.h) : axis === "x" ? box.vw : box.vh,
  };
}

/**
 * The whole box model of a box in one unit: { unit, size: {w,h,text}, margin: {top,right,bottom,left}, ... , text }.
 * Percentages are relative to the parent's border box (the viewport for the root element).
 * @param {object} box a result of sanitizeBox
 * @param {string} unit one of UNITS (anything else falls back to px)
 * @param {{ppi?: number, dpr?: number, dprAware?: boolean}} [opts]
 */
export function describeBox(box, unit = "px", opts = {}) {
  const u = UNITS.includes(unit) ? unit : "px";
  const cx = unitContext(box, "x", opts);
  const cy = unitContext(box, "y", opts);
  const side = (q) => {
    // top/bottom are vertical lengths, left/right horizontal
    const f = (v, c) => kit.formatValue(v, u, c);
    const raw = (v, c) => kit.convert(v, u, c);
    return {
      top: raw(q[0], cy), right: raw(q[1], cx), bottom: raw(q[2], cy), left: raw(q[3], cx),
      text: `${f(q[0], cy)} ${f(q[1], cx)} ${f(q[2], cy)} ${f(q[3], cx)}`,
    };
  };
  return {
    unit: u,
    tag: box.tag,
    id: box.id,
    size: { w: kit.convert(box.rect.w, u, cx), h: kit.convert(box.rect.h, u, cy), text: kit.formatSize(box.rect.w, box.rect.h, u, cx, cy) },
    margin: side(box.margin),
    border: side(box.border),
    padding: side(box.padding),
    px: { w: box.rect.w, h: box.rect.h, x: box.rect.x, y: box.rect.y },
  };
}
