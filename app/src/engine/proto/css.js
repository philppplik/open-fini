// The CSS compiler of the Proto model (docs/concepts/proto-studio.md §3.2, §4.1; ADR 0034 decision 4). Pure: no DOM.
//
// css.js is the single source of CSS: it turns a *resolved* node (resolve.js) into an ordered list of declarations.
// The canvas renderer applies them with `style.setProperty`, the code exporter prints them, and the pure layout
// solver (layout.js) implements exactly the layout these declarations produce (it reads the same box model below).
// Only properties of an allow-list are emitted, and every value is built from numbers, enumerations, hex colors,
// sanitized font names and media URLs, so no declaration can carry markup, script or an external resource.
//
// Public API
//   nodeCss(r, opts?) → { decls: [[property, value]], attrs, text?, svg? }
//       r       a resolved node;  opts.parent: the resolved parent (null for a root), opts.index / opts.count: the
//               position among the parent's children (z order with `reverseZ`)
//       text    { runs: [{ text, decls }] } for text layers (decls of a run hold only what differs from the layer)
//       svg     { kind: "path"|"line", … } presentation attributes for vector and line layers (drawn as inline SVG)
//       attrs   element attributes: `data-mode-<collection>` where the layer switches a variable mode
//   treeCss(root, opts?) → Map<key, result>     every node of a resolved tree
//   boxModel(r, parent, opts?) → { pos, w, h, pad, border, layout, place }   the geometry css.js emits; layout.js uses it
//   declsToText(decls) / declsToObject(decls)
//   PROPERTIES                                   the allow-list
//
// Options
//   vars        "value" (default): bound values as literals; "css": `var(--name, literal)` (needs `resolver`)
//   resolver    the resolver the tree came from (variable names for "css")
//   root        "canvas" (default: a root is absolutely placed at its x and y), "origin" (at 0, 0) or "none"
//   scroll      true: `scroll` becomes scrollable overflow (player, export); false (default, the canvas): clipped
//   mediaUrl    (mediaId, media) → URL of an image fill (default "media/<id>.<ext>")
//   designSize  (r) → { w, h } design-time size of a layer for constraints (default: its fixed sizes)
//
// Mapping decisions (beyond the table in the concept):
//   * Every element is `box-sizing: border-box`. Flow children get explicit minimum sizes (`min-width: <min or 0>`),
//     fixed and hug children do not shrink (`flex: 0 0 auto`) and fill children are `flex: 1 1 0px` on the main axis
//     and `align-self: stretch` on the cross axis, so no CSS automatic minimum size ever applies; that keeps the
//     canvas, the export and the pure solver in agreement.
//   * `gap` is the space between items along the main axis (between columns in a grid); `rowGap` the space between
//     lines of a wrapping flex layout (between rows in a grid) and defaults to `gap`.
//   * `rel` sizes are percentages (0 to 100, as validate.js checks): `{ mode: "rel", value: 50 }` → `50%`.
//   * The first `inside` stroke is the CSS `border` (it takes layout space, as in CSS), the first `center` stroke an
//     `outline` with a negative offset, further strokes are box-shadow rings. `sides` are per-side widths.
//   * Fills are listed bottom to top (the last fill paints on top); CSS backgrounds are listed top to bottom.
//   * Constraints other than left/top need the design-time size of the parent and of the layer on that axis; when
//     one is not fixed they fall back to left/top.
import { field, DEFAULT_TEXT_STYLE } from "./schema.js";
import { slug } from "./resolve.js";

/** Every property css.js may emit. */
export const PROPERTIES = Object.freeze(
  new Set([
    "box-sizing", "position", "left", "top", "right", "bottom", "z-index", "display",
    "width", "height", "min-width", "max-width", "min-height", "max-height",
    "flex", "align-self", "justify-self", "grid-column", "grid-row",
    "flex-direction", "flex-wrap", "column-gap", "row-gap", "align-items", "justify-content", "align-content", "justify-items",
    "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-auto-flow",
    "padding", "overflow", "overflow-x", "overflow-y",
    "opacity", "mix-blend-mode", "transform",
    "background-color", "background-image", "background-position", "background-size", "background-repeat",
    "border-width", "border-style", "border-color", "border-radius", "outline", "outline-offset", "box-shadow",
    "filter", "backdrop-filter",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform",
    "text-decoration-line", "color", "white-space", "overflow-wrap", "text-shadow", "-webkit-text-stroke",
    "-webkit-box-orient", "-webkit-line-clamp",
  ]),
);

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const numOr = (v, d) => (finite(v) ? v : d);
const BOX_TYPES = new Set(["frame", "rect", "ellipse", "image", "instance", "component", "componentSet", "slot"]);
const CONTAINERS = new Set(["frame", "component", "componentSet", "instance", "slot"]);

/** Formats a number for CSS: at most 3 decimals, no trailing zeros, no "-0". */
export function fmt(n) {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

// ------------------------------------------------------------------------------------------------- box model

/** Layout of a container with every default filled in (numbers concrete; resolver bindings already replaced). */
export function layoutOf(node) {
  const l = isObj(node?.layout) ? node.layout : {};
  const type = l.type === "flex" || l.type === "grid" ? l.type : "none";
  const gap = Math.max(0, numOr(l.gap, 0));
  const pad = Array.isArray(l.pad) && l.pad.length === 4 ? l.pad.map((p) => Math.max(0, numOr(p, 0))) : [0, 0, 0, 0];
  const g = isObj(l.grid) ? l.grid : {};
  return {
    type,
    dir: l.dir === "column" ? "column" : "row",
    wrap: l.wrap === true,
    gap,
    rowGap: Math.max(0, numOr(l.rowGap, gap)),
    pad,
    align: l.align || "start",
    justify: l.justify || "start",
    alignContent: l.alignContent || "start",
    reverseZ: l.reverseZ === true,
    grid: {
      cols: Array.isArray(g.cols) && g.cols.length ? g.cols : [{ fr: 1 }],
      rows: Array.isArray(g.rows) ? g.rows : [],
      areas: Array.isArray(g.areas) ? g.areas : null,
      autoFlow: g.autoFlow === "column" ? "column" : "row",
      dense: g.dense === true,
    },
  };
}

/** Border widths [top, right, bottom, left] of a layer: its first visible `inside` stroke (box layers only). */
export function bordersOf(r) {
  if (!BOX_TYPES.has(r.type)) return [0, 0, 0, 0];
  const s = insideStroke(r.node);
  if (!s) return [0, 0, 0, 0];
  if (Array.isArray(s.sides) && s.sides.length === 4) return s.sides.map((x) => Math.max(0, numOr(x, 0)));
  const w = Math.max(0, numOr(s.w, 0));
  return [w, w, w, w];
}

const visibleStrokes = (node) => (Array.isArray(node.strokes) ? node.strokes.filter((s) => isObj(s) && s.visible !== false && numOr(s.w, 0) > 0 && typeof s.color === "string") : []);
const strokeAlign = (s) => (s.align === "center" || s.align === "outside" ? s.align : "inside");
const insideStroke = (node) => visibleStrokes(node).find((s) => strokeAlign(s) === "inside") || null;

const SIZE = (s, fallback) => {
  if (!isObj(s)) return { ...fallback };
  const mode = ["fixed", "hug", "fill", "rel"].includes(s.mode) ? s.mode : "fixed";
  const out = { mode, value: numOr(s.value, mode === "rel" ? 100 : 0) };
  if (finite(s.min)) out.min = s.min;
  if (finite(s.max)) out.max = s.max;
  return out;
};

/** Sizing of a layer after the text auto-size rules (`width` hugs both axes, `height` hugs the height). */
export function sizingOf(r) {
  const node = r.node;
  let w = SIZE(field(node, "w"), { mode: "fixed", value: 100 });
  let h = SIZE(field(node, "h"), { mode: "fixed", value: 100 });
  if (r.type === "text") {
    const a = node.text?.autoSize || "width";
    if (a === "width") (w = { ...w, mode: "hug" }), (h = { ...h, mode: "hug" });
    else if (a === "height") h = { ...h, mode: "hug" };
  }
  return { w, h };
}

/** Whether `r` is laid out by its parent's flex or grid layout (else it is absolutely positioned). */
export function positionOf(r, parent) {
  if (!parent) return "root";
  const lt = layoutOf(parent.node).type;
  return (lt === "flex" || lt === "grid") && field(r.node, "pos") === "flow" ? "flow" : "abs";
}

const defaultDesignSize = (r) => {
  const { w, h } = sizingOf(r);
  return { w: w.mode === "fixed" ? w.value : null, h: h.mode === "fixed" ? h.value : null };
};

/**
 * How an absolutely positioned layer is placed on one axis, relative to its parent's padding box.
 *   { mode: "start", start }                  left/top
 *   { mode: "end", end }                      right/bottom
 *   { mode: "both", start, end }              left and right (the size follows the parent)
 *   { mode: "center", offset }                left: calc(50% + offset)  (the layer's size is fixed)
 *   { mode: "scale", start: pct, size: pct }  percentages of the padding box
 */
export function placementOf(r, parent, { designSize = defaultDesignSize } = {}) {
  const node = r.node;
  const own = designSize(r) || {};
  const pd = parent ? designSize(parent) || {} : {};
  const pb = parent ? bordersOf(parent) : [0, 0, 0, 0];
  const axis = (pos, c, size, psize, b0, b1) => {
    const start = pos - b0;
    if (c === "left" || c === "top" || !finite(size) || !finite(psize)) return { mode: "start", start };
    const inner = psize - b0 - b1;
    const end = inner - start - size;
    if (c === "right" || c === "bottom") return { mode: "end", end };
    if (c === "leftRight" || c === "topBottom") return { mode: "both", start, end };
    if (c === "center") return { mode: "center", offset: start - inner / 2 };
    if (c === "scale" && inner > 0) return { mode: "scale", start: (start / inner) * 100, size: (size / inner) * 100 };
    return { mode: "start", start };
  };
  return {
    x: axis(numOr(field(node, "x"), 0), field(node, "cx"), own.w, pd.w, pb[3], pb[1]),
    y: axis(numOr(field(node, "y"), 0), field(node, "cy"), own.h, pd.h, pb[0], pb[2]),
  };
}

/** The geometry css.js emits for a layer; layout.js implements it. */
export function boxModel(r, parent, opts = {}) {
  const pos = positionOf(r, parent);
  const { w, h } = sizingOf(r);
  const isContainer = CONTAINERS.has(r.type);
  const layout = isContainer ? layoutOf(r.node) : layoutOf(null);
  return {
    pos,
    w,
    h,
    pad: isContainer ? layout.pad : [0, 0, 0, 0],
    border: bordersOf(r),
    layout,
    place: pos === "abs" ? placementOf(r, parent, opts) : null,
  };
}

// ------------------------------------------------------------------------------------------------- values

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** A hex color with its alpha multiplied by `opacity` (#rrggbbaa); null for an invalid color. */
export function hexAlpha(hex, opacity = 1) {
  if (typeof hex !== "string" || !HEX_RE.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  const a = Math.round(parseInt(h.slice(6, 8), 16) * Math.max(0, Math.min(1, opacity)));
  const out = `#${h.slice(0, 6)}${a.toString(16).padStart(2, "0")}`.toLowerCase();
  return out.endsWith("ff") ? out.slice(0, 7) : out;
}

const FONT_SERIF = /^(times|georgia|garamond|palatino|baskerville|bodoni|cambria|book antiqua|didot|minion|playfair|lora|merriweather|source serif|serif$)/i;
const FONT_MONO = /^(courier|consolas|menlo|monaco|lucida console|jetbrains|fira code|source code|sf mono|ibm plex mono|cascadia|monospace$)/i;
const GENERIC = /^(serif|sans-serif|monospace|system-ui|cursive|fantasy)$/i;

/** A CSS font-family stack for a family name (quoted, sanitized, with a generic fallback). */
export function fontStack(family) {
  const f = String(family || DEFAULT_TEXT_STYLE.font).replace(/["\\;{}<>\n\r]/g, "").trim() || DEFAULT_TEXT_STYLE.font;
  if (GENERIC.test(f)) return f.toLowerCase();
  const generic = FONT_MONO.test(f) ? "monospace" : FONT_SERIF.test(f) ? "serif" : "sans-serif";
  return `"${f}", ${generic}`;
}

const UNSAFE = /[;{}<>\\]|\/\*|expression\s*\(|javascript:|@import/i;
const URL_SAFE = /^[A-Za-z0-9._~:/?#@!$&*+,=%-]+$/;
const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg" };
const defaultMediaUrl = (id, media) => `media/${id}.${MIME_EXT[media?.mime] || "bin"}`;

// ------------------------------------------------------------------------------------------------- compiler

class Out {
  constructor() {
    this.decls = [];
  }
  add(p, v) {
    if (!PROPERTIES.has(p)) throw new Error(`css.js: “${p}” is not an allowed property.`);
    if (v === undefined || v === null || v === "") return;
    const s = String(v);
    if (UNSAFE.test(s.replace(/url\("[^"]*"\)/g, ""))) return;
    const i = this.decls.findIndex((d) => d[0] === p);
    if (i >= 0) this.decls[i] = [p, s];
    else this.decls.push([p, s]);
  }
  remove(p) {
    this.decls = this.decls.filter((d) => d[0] !== p);
  }
}

/**
 * Value printers for one node: a literal, or `var(--name, literal)` where the field was bound (vars: "css").
 */
function printers(r, opts) {
  const bound = r.bound || {};
  const css = opts.vars === "css" && opts.resolver;
  const ref = (path, literal) => (css && bound[path] ? `var(${opts.resolver.cssName(bound[path])}, ${literal})` : literal);
  return {
    px: (path, v) => ref(path, `${fmt(numOr(v, 0))}px`),
    num: (path, v) => ref(path, fmt(numOr(v, 0))),
    color(path, v, opacity = 1) {
      const lit = hexAlpha(v, 1);
      if (!lit) return null;
      if (opacity >= 1) return ref(path, lit);
      if (css && bound[path]) return `color-mix(in srgb, ${ref(path, lit)} ${fmt(opacity * 100)}%, transparent)`;
      return hexAlpha(v, opacity);
    },
  };
}

const ALIGN_FLEX = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
const JUSTIFY_FLEX = { start: "flex-start", center: "center", end: "flex-end", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" };
const SELF = { auto: null, start: "start", center: "center", end: "end", stretch: "stretch" };

function track(t, P, path) {
  if (!isObj(t)) return "auto";
  if (finite(t.fr)) return `${fmt(Math.max(0, t.fr))}fr`;
  if (t.px !== undefined) return P.px(`${path}.px`, t.px);
  if (t.auto === true) return "auto";
  if (Array.isArray(t.minmax) && t.minmax.length === 2) {
    const part = (x, i) => (finite(x) ? P.px(`${path}.minmax.${i}`, x) : track(x, P, `${path}.minmax.${i}`));
    return `minmax(${part(t.minmax[0], 0)}, ${part(t.minmax[1], 1)})`;
  }
  return "auto";
}

function sizeDecls(o, r, parent, box, P, opts) {
  const { pos, w, h } = box;
  const pl = parent ? layoutOf(parent.node) : null;
  const minmax = (axis, s, path) => {
    const [minP, maxP] = axis === "w" ? ["min-width", "max-width"] : ["min-height", "max-height"];
    if (s.min !== undefined) o.add(minP, P.px(`${path}.min`, s.min));
    else if (pos === "flow") o.add(minP, "0px");
    if (s.max !== undefined) o.add(maxP, P.px(`${path}.max`, s.max));
  };
  const prop = (axis) => (axis === "w" ? "width" : "height");
  const plain = (axis, s, path) => {
    if (s.mode === "fixed") o.add(prop(axis), P.px(`${path}.value`, s.value));
    else if (s.mode === "hug") o.add(prop(axis), axis === "w" ? "fit-content" : "auto");
    else if (s.mode === "rel") o.add(prop(axis), `${fmt(s.value)}%`);
    else if (s.mode === "fill") o.add(prop(axis), "100%");
  };
  if (pos === "flow" && pl.type === "flex") {
    const mainAxis = pl.dir === "row" ? "w" : "h";
    const crossAxis = mainAxis === "w" ? "h" : "w";
    const main = box[mainAxis];
    const cross = box[crossAxis];
    if (main.mode === "fill") o.add("flex", "1 1 0px");
    else {
      plain(mainAxis, main, mainAxis);
      o.add("flex", "0 0 auto");
    }
    if (cross.mode === "fill") o.add("align-self", "stretch");
    else {
      plain(crossAxis, cross, crossAxis);
      // hug and fixed layers never stretch, whatever the container's alignment
      if (pl.align === "stretch") o.add("align-self", "flex-start");
    }
  } else if (pos === "flow" && pl.type === "grid") {
    const cell = isObj(r.node.cell) ? r.node.cell : null;
    if (w.mode === "fill") o.add("justify-self", "stretch");
    else {
      plain("w", w, "w");
      if (cell && SELF[cell.justifySelf]) o.add("justify-self", SELF[cell.justifySelf]);
    }
    if (h.mode === "fill") o.add("align-self", "stretch");
    else {
      plain("h", h, "h");
      if (cell && SELF[cell.alignSelf]) o.add("align-self", SELF[cell.alignSelf]);
      else if (pl.align === "stretch") o.add("align-self", "start");
    }
    if (cell) {
      const line = (start, span) => {
        const s = finite(start) ? Math.round(start) : null;
        const n = finite(span) && span > 1 ? Math.round(span) : null;
        if (s !== null) return n ? `${s} / span ${n}` : `${s}`;
        return n ? `span ${n}` : null;
      };
      o.add("grid-column", line(cell.col, cell.colSpan));
      o.add("grid-row", line(cell.row, cell.rowSpan));
    }
  } else {
    // absolutely positioned layers and roots
    const pl2 = box.place;
    if (!(pl2 && pl2.x.mode === "both")) {
      if (pl2 && pl2.x.mode === "scale") o.add("width", `${fmt(pl2.x.size)}%`);
      else plain("w", w, "w");
    }
    if (!(pl2 && pl2.y.mode === "both")) {
      if (pl2 && pl2.y.mode === "scale") o.add("height", `${fmt(pl2.y.size)}%`);
      else plain("h", h, "h");
    }
  }
  minmax("w", w, "w");
  minmax("h", h, "h");
}

function positionDecls(o, r, parent, box, opts) {
  if (box.pos === "root") {
    if (opts.root === "none") return;
    o.add("position", "absolute");
    o.add("left", `${fmt(opts.root === "origin" ? 0 : numOr(field(r.node, "x"), 0))}px`);
    o.add("top", `${fmt(opts.root === "origin" ? 0 : numOr(field(r.node, "y"), 0))}px`);
    return;
  }
  if (box.pos === "flow") {
    o.add("position", r.node.sticky ? "sticky" : "relative");
    if (r.node.sticky) o.add(r.node.sticky, "0px");
    return;
  }
  o.add("position", "absolute");
  const edge = (a, [s, e]) => {
    if (a.mode === "start") o.add(s, `${fmt(a.start)}px`);
    else if (a.mode === "end") o.add(e, `${fmt(a.end)}px`);
    else if (a.mode === "both") o.add(s, `${fmt(a.start)}px`), o.add(e, `${fmt(a.end)}px`);
    else if (a.mode === "center") o.add(s, `calc(50% + ${fmt(a.offset)}px)`);
    else if (a.mode === "scale") o.add(s, `${fmt(a.start)}%`);
  };
  edge(box.place.x, ["left", "right"]);
  edge(box.place.y, ["top", "bottom"]);
}

function layoutDecls(o, r, box, P) {
  const L = box.layout;
  const raw = isObj(r.node.layout) ? r.node.layout : {};
  const gapPath = raw.gap !== undefined ? "layout.gap" : null;
  const rowGapLit = () => (raw.rowGap !== undefined ? P.px("layout.rowGap", L.rowGap) : gapPath ? P.px(gapPath, L.gap) : `${fmt(L.rowGap)}px`);
  if (L.type === "flex") {
    o.add("display", "flex");
    o.add("flex-direction", L.dir);
    if (L.wrap) o.add("flex-wrap", "wrap");
    const mainGap = P.px("layout.gap", L.gap);
    if (L.dir === "row") o.add("column-gap", mainGap), o.add("row-gap", rowGapLit());
    else o.add("row-gap", mainGap), o.add("column-gap", rowGapLit());
    o.add("align-items", ALIGN_FLEX[L.align] || "flex-start");
    o.add("justify-content", JUSTIFY_FLEX[L.justify] || "flex-start");
    if (L.wrap) o.add("align-content", L.alignContent === "start" ? "flex-start" : L.alignContent === "end" ? "flex-end" : L.alignContent);
  } else if (L.type === "grid") {
    o.add("display", "grid");
    o.add("grid-template-columns", L.grid.cols.map((t, i) => track(t, P, `layout.grid.cols.${i}`)).join(" "));
    if (L.grid.rows.length) o.add("grid-template-rows", L.grid.rows.map((t, i) => track(t, P, `layout.grid.rows.${i}`)).join(" "));
    if (L.grid.areas && L.grid.areas.length) o.add("grid-template-areas", L.grid.areas.map((a) => `"${String(a).replace(/[^A-Za-z0-9_. -]/g, "")}"`).join(" "));
    o.add("grid-auto-flow", `${L.grid.autoFlow}${L.grid.dense ? " dense" : ""}`);
    o.add("column-gap", P.px("layout.gap", L.gap));
    o.add("row-gap", rowGapLit());
    o.add("align-items", L.align === "baseline" ? "baseline" : SELF[L.align] || "start");
    if (L.justify === "center" || L.justify === "end") o.add("justify-items", L.justify);
    else o.add("justify-items", "start");
    if (L.justify.startsWith("space-")) o.add("justify-content", L.justify);
    if (raw.alignContent !== undefined && L.alignContent !== "start") o.add("align-content", L.alignContent);
  }
  if (L.pad.some((p) => p > 0) || (r.bound && Object.keys(r.bound).some((k) => k.startsWith("layout.pad.")))) {
    o.add("padding", L.pad.map((p, i) => P.px(`layout.pad.${i}`, p)).join(" "));
  }
}

function fillDecls(o, r, P, opts) {
  const fills = Array.isArray(r.node.fills) ? r.node.fills.map((f, i) => [f, i]).filter(([f]) => isObj(f) && f.visible !== false) : [];
  if (!fills.length) return;
  const layers = []; // top first
  let bg = null;
  const stops = (f, i) =>
    (Array.isArray(f.stops) ? f.stops : [])
      .map((s, j) => {
        const c = P.color(`fills.${i}.stops.${j}.color`, s?.color, numOr(f.opacity, 1));
        return c ? `${c} ${fmt(Math.max(0, Math.min(1, numOr(s.at, 0))) * 100)}%` : null;
      })
      .filter(Boolean)
      .join(", ");
  const center = (f) => (Array.isArray(f.center) ? `${fmt(numOr(f.center[0], 0.5) * 100)}% ${fmt(numOr(f.center[1], 0.5) * 100)}%` : "50% 50%");
  for (let k = fills.length - 1; k >= 0; k--) {
    const [f, i] = fills[k];
    const op = numOr(f.opacity, 1);
    if (f.type === "solid") {
      const c = P.color(`fills.${i}.color`, f.color, op);
      if (!c) continue;
      if (k === 0) bg = c;
      else layers.push({ image: `linear-gradient(${c}, ${c})` });
    } else if (f.type === "linear") {
      const s = stops(f, i);
      if (s) layers.push({ image: `linear-gradient(${fmt(numOr(f.angle, 180))}deg, ${s})` });
    } else if (f.type === "radial") {
      const s = stops(f, i);
      if (s) layers.push({ image: `radial-gradient(at ${center(f)}, ${s})` });
    } else if (f.type === "conic") {
      const s = stops(f, i);
      if (s) layers.push({ image: `conic-gradient(from ${fmt(numOr(f.angle, 0))}deg at ${center(f)}, ${s})` });
    } else if (f.type === "image") {
      const media = opts.model?.media?.[f.media];
      const url = (opts.mediaUrl || defaultMediaUrl)(f.media, media);
      if (typeof url !== "string" || !URL_SAFE.test(url)) continue;
      const fit = f.fit || "cover";
      const p = Array.isArray(f.pos) ? f.pos : [0.5, 0.5];
      layers.push({
        image: `url("${url}")`,
        position: `${fmt(numOr(p[0], 0.5) * 100)}% ${fmt(numOr(p[1], 0.5) * 100)}%`,
        size: fit === "cover" || fit === "contain" ? fit : fit === "fill" ? "100% 100%" : "auto",
        repeat: fit === "tile" ? "repeat" : "no-repeat",
      });
    }
  }
  if (bg) o.add("background-color", bg);
  if (layers.length) {
    o.add("background-image", layers.map((l) => l.image).join(", "));
    if (layers.some((l) => l.position)) {
      o.add("background-position", layers.map((l) => l.position || "0% 0%").join(", "));
      o.add("background-size", layers.map((l) => l.size || "auto").join(", "));
      o.add("background-repeat", layers.map((l) => l.repeat || "repeat").join(", "));
    }
  }
}

function strokeIndex(node, s) {
  return node.strokes.indexOf(s);
}

function shadowDecls(o, r, P) {
  const node = r.node;
  const rings = [];
  if (BOX_TYPES.has(r.type)) {
    const strokes = visibleStrokes(node);
    const inside = strokes.find((s) => strokeAlign(s) === "inside");
    const center = strokes.find((s) => strokeAlign(s) === "center");
    if (inside) {
      const i = strokeIndex(node, inside);
      if (Array.isArray(inside.sides) && inside.sides.length === 4) o.add("border-width", inside.sides.map((x, j) => P.px(`strokes.${i}.sides.${j}`, x)).join(" "));
      else o.add("border-width", P.px(`strokes.${i}.w`, inside.w));
      o.add("border-style", Array.isArray(inside.dash) && inside.dash.length ? "dashed" : "solid");
      o.add("border-color", P.color(`strokes.${i}.color`, inside.color));
    }
    if (center) {
      const i = strokeIndex(node, center);
      o.add("outline", `${P.px(`strokes.${i}.w`, center.w)} ${Array.isArray(center.dash) && center.dash.length ? "dashed" : "solid"} ${P.color(`strokes.${i}.color`, center.color)}`);
      o.add("outline-offset", `${fmt(-numOr(center.w, 0) / 2)}px`);
    }
    let outside = 0;
    for (const s of strokes) {
      if (s === inside || s === center) continue;
      const i = strokeIndex(node, s);
      const c = P.color(`strokes.${i}.color`, s.color);
      if (!c) continue;
      if (strokeAlign(s) === "inside") rings.push(`inset 0 0 0 ${fmt(s.w)}px ${c}`);
      else {
        outside += numOr(s.w, 0);
        rings.push(`0 0 0 ${fmt(outside)}px ${c}`);
      }
    }
  }
  const effects = Array.isArray(node.effects) ? node.effects.map((e, i) => [e, i]).filter(([e]) => isObj(e) && e.visible !== false) : [];
  const shadows = [];
  const drop = [];
  const filters = [];
  const backdrop = [];
  for (let k = effects.length - 1; k >= 0; k--) {
    const [e, i] = effects[k];
    if (e.type === "shadow") {
      const c = P.color(`effects.${i}.color`, e.color);
      if (!c) continue;
      const x = P.px(`effects.${i}.x`, numOr(e.x, 0));
      const y = P.px(`effects.${i}.y`, numOr(e.y, 0));
      const blur = P.px(`effects.${i}.blur`, Math.max(0, numOr(e.blur, 0)));
      if (r.type === "text") {
        if (!e.inset) shadows.push(`${x} ${y} ${blur} ${c}`);
      } else if (r.type === "vector" || r.type === "line") {
        if (!e.inset) drop.push(`drop-shadow(${x} ${y} ${blur} ${c})`);
      } else shadows.push(`${e.inset ? "inset " : ""}${x} ${y} ${blur} ${P.px(`effects.${i}.spread`, numOr(e.spread, 0))} ${c}`);
    } else if (e.type === "blur") filters.push(`blur(${P.px(`effects.${i}.radius`, Math.max(0, numOr(e.radius, 0)))})`);
    else if (e.type === "backgroundBlur") backdrop.push(`blur(${P.px(`effects.${i}.radius`, Math.max(0, numOr(e.radius, 0)))})`);
  }
  if (r.type === "text") {
    if (shadows.length) o.add("text-shadow", shadows.join(", "));
  } else if (rings.length || shadows.length) o.add("box-shadow", [...rings, ...shadows].join(", "));
  if (drop.length || filters.length) o.add("filter", [...drop, ...filters].join(" "));
  if (backdrop.length) o.add("backdrop-filter", backdrop.join(" "));
}

function radiusDecls(o, r, P) {
  if (r.type === "ellipse") return o.add("border-radius", "50%");
  if (!BOX_TYPES.has(r.type)) return;
  const v = r.node.radius;
  if (Array.isArray(v) && v.length === 4) {
    if (v.some((x) => numOr(x, 0) > 0)) o.add("border-radius", v.map((x, i) => P.px(`radius.${i}`, Math.max(0, numOr(x, 0)))).join(" "));
  } else if (numOr(v, 0) > 0 || r.bound?.radius) o.add("border-radius", P.px("radius", Math.max(0, numOr(v, 0))));
}

const CASE = { upper: "uppercase", lower: "lowercase", title: "capitalize", none: "none" };
const DECORATION = { underline: "underline", strike: "line-through", none: "none" };

function textStyleDecls(o, s, P, base, prefix) {
  const has = (k) => s[k] !== undefined;
  if (has("font")) o.add("font-family", fontStack(s.font));
  if (has("size")) o.add("font-size", P.px(`${prefix}.size`, Math.max(0.5, numOr(s.size, 16))));
  if (has("weight")) o.add("font-weight", P.num(`${prefix}.weight`, numOr(s.weight, 400)));
  if (has("italic")) o.add("font-style", s.italic ? "italic" : "normal");
  if (has("lineHeight")) {
    const lh = s.lineHeight;
    if (lh === "auto" || !isObj(lh)) o.add("line-height", "normal");
    else if (finite(lh.pct)) o.add("line-height", `${fmt(lh.pct)}%`);
    else if (lh.px !== undefined) o.add("line-height", P.px(`${prefix}.lineHeight.px`, lh.px));
  }
  if (has("tracking") && (numOr(s.tracking, 0) !== 0 || !base)) o.add("letter-spacing", P.px(`${prefix}.tracking`, numOr(s.tracking, 0)));
  if (has("align") && base) o.add("text-align", s.align === "justify" ? "justify" : s.align === "center" ? "center" : s.align === "right" ? "right" : "left");
  if (has("case") && (s.case !== "none" || !base)) o.add("text-transform", CASE[s.case] || "none");
  if (has("decoration") && (s.decoration !== "none" || !base)) o.add("text-decoration-line", DECORATION[s.decoration] || "none");
  if (has("color")) o.add("color", P.color(`${prefix}.color`, s.color));
}

/** The text style of a text layer with defaults: DEFAULT_TEXT_STYLE under the layer's style. */
export function textStyleOf(node) {
  return { ...DEFAULT_TEXT_STYLE, ...(isObj(node?.text?.style) ? node.text.style : {}) };
}

function textDecls(o, r, P) {
  const t = isObj(r.node.text) ? r.node.text : {};
  const style = textStyleOf(r.node);
  textStyleDecls(o, style, P, true, "text.style");
  const auto = t.autoSize || "width";
  o.add("white-space", auto === "width" ? "pre" : "pre-wrap");
  if (auto !== "width") o.add("overflow-wrap", "break-word");
  if (finite(t.maxLines) && t.maxLines >= 1) {
    o.add("display", "-webkit-box");
    o.add("-webkit-box-orient", "vertical");
    o.add("-webkit-line-clamp", String(Math.round(t.maxLines)));
    o.add("overflow", "hidden");
  }
  const strokes = visibleStrokes(r.node);
  if (strokes.length) {
    const i = strokeIndex(r.node, strokes[0]);
    o.add("-webkit-text-stroke", `${P.px(`strokes.${i}.w`, strokes[0].w)} ${P.color(`strokes.${i}.color`, strokes[0].color)}`);
  }
  const runs = (Array.isArray(t.runs) ? t.runs : []).map((run, i) => {
    const ro = new Out();
    const s = isObj(run?.s) ? run.s : {};
    const diff = {};
    for (const [k, v] of Object.entries(s)) if (JSON.stringify(v) !== JSON.stringify(style[k])) diff[k] = v;
    textStyleDecls(ro, diff, P, false, `text.runs.${i}.s`);
    return { text: typeof run?.t === "string" ? run.t : run?.t == null ? "" : String(run.t), decls: ro.decls };
  });
  return { runs };
}

function svgOf(r, P) {
  const node = r.node;
  const fills = Array.isArray(node.fills) ? node.fills.filter((f) => isObj(f) && f.visible !== false) : [];
  const solid = [...fills].reverse().find((f) => f.type === "solid");
  const strokes = visibleStrokes(node);
  const s = strokes[0];
  const si = s ? strokeIndex(node, s) : -1;
  const base = {
    fill: solid ? P.color(`fills.${node.fills.indexOf(solid)}.color`, solid.color, numOr(solid.opacity, 1)) || "none" : "none",
    stroke: s ? P.color(`strokes.${si}.color`, s.color) : "none",
    strokeWidth: s ? fmt(numOr(s.w, 1)) : "0",
    dash: s && Array.isArray(s.dash) && s.dash.length ? s.dash.map((d) => fmt(numOr(d, 0))).join(" ") : null,
  };
  if (r.type === "line") return { kind: "line", x1: "0", y1: "0", x2: "100%", y2: "100%", ...base, fill: "none" };
  return { kind: "path", d: typeof node.d === "string" ? node.d : "", rule: node.rule === "evenodd" ? "evenodd" : "nonzero", ...base };
}

/**
 * Compiles one resolved node.
 * @param {object} r a resolved node
 * @param {{ parent?: object|null, index?: number, count?: number, vars?: "value"|"css", resolver?: object, root?: "canvas"|"origin"|"none", scroll?: boolean, mediaUrl?: Function, designSize?: Function, model?: object }} [opts]
 */
export function nodeCss(r, opts = {}) {
  const parent = opts.parent || null;
  const o = new Out();
  const P = printers(r, opts);
  const node = r.node;
  const box = boxModel(r, parent, opts);
  o.add("box-sizing", "border-box");
  positionDecls(o, r, parent, box, opts);
  sizeDecls(o, r, parent, box, P, opts);
  if (parent && layoutOf(parent.node).reverseZ) o.add("z-index", String(Math.max(0, (opts.count ?? 1) - (opts.index ?? 0))));
  if (CONTAINERS.has(r.type)) layoutDecls(o, r, box, P);
  const scroll = field(node, "scroll");
  if (opts.scroll && scroll !== "none") {
    o.add("overflow-x", scroll === "x" || scroll === "both" ? "auto" : "hidden");
    o.add("overflow-y", scroll === "y" || scroll === "both" ? "auto" : "hidden");
  } else if (field(node, "clip") === true || (scroll !== "none" && CONTAINERS.has(r.type))) o.add("overflow", "hidden");
  const opacity = numOr(field(node, "opacity"), 1);
  if (opacity < 1 || r.bound?.opacity) o.add("opacity", P.num("opacity", Math.max(0, Math.min(1, opacity))));
  const blend = field(node, "blend");
  if (blend && blend !== "normal") o.add("mix-blend-mode", blend);
  const rot = numOr(field(node, "rot"), 0);
  if (rot) o.add("transform", `rotate(${fmt(rot)}deg)`);
  const isPath = r.type === "vector" || r.type === "line";
  if (!isPath) fillDecls(o, r, P, opts);
  radiusDecls(o, r, P);
  shadowDecls(o, r, P);
  let text;
  if (r.type === "text") text = textDecls(o, r, P);
  const attrs = {};
  if (isObj(node.modes)) {
    const colls = opts.model?.vars?.collections || opts.resolver?.model?.vars?.collections || {};
    for (const [coll, mode] of Object.entries(node.modes)) attrs[`data-mode-${slug(colls[coll]?.name) || slug(coll)}`] = String(mode);
  }
  if (field(node, "visible") === false) {
    o.remove("display");
    o.add("display", "none");
  }
  const out = { decls: o.decls, attrs };
  if (text) out.text = text;
  if (isPath) out.svg = svgOf(r, P);
  return out;
}

/** Compiles every node of a resolved tree: Map key → nodeCss result. */
export function treeCss(root, opts = {}) {
  const out = new Map();
  const model = opts.model || opts.resolver?.model;
  const visit = (r, parent, index, count) => {
    out.set(r.key, nodeCss(r, { ...opts, model, parent, index, count }));
    r.children.forEach((c, i) => visit(c, r, i, r.children.length));
  };
  if (root) visit(root, opts.parent || null, 0, 1);
  return out;
}

/** "property: value; …" */
export const declsToText = (decls) => decls.map(([p, v]) => `${p}: ${v};`).join(" ");
/** { property: value } with CSS property names (for style.setProperty). */
export const declsToObject = (decls) => Object.fromEntries(decls);
