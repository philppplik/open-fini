// Proto Studio document model, schema 1: vocabulary, limits, defaults and factories (docs/concepts/proto-studio.md §3,
// ADR 0034). Pure: no DOM, imports in plain Node.
//
// The model is one immutable JSON value:
//   { schema, meta, pages: { id: page }, nodes: { id: node }, vars: { collections, items }, styles, breakpoints,
//     code: { links, tokensFile }, media }
// Nodes live in a flat map; each has `page`, `parent` (a node id, or null for a top-level node on its page) and `ord`
// (a fractional order key, collab/fractional.js). Children lists are derived (engine/proto/tree.js). Every field has
// one CSS meaning (the table in the concept, §3.2); a value the CSS mapping cannot express is not in the schema.
//
// Fields with a default may be omitted; FIELD_DEFAULTS lists them and `field(node, key)` reads a field with its default.
// Every change goes through engine/proto/ops.js; validate.js checks a model, migrate.js upgrades older schemas.
import { initialKey } from "../../collab/fractional.js";
import { newId } from "./ids.js";

/** The schema this code reads and writes. */
export const SCHEMA_VERSION = 1;
/** The `doc.office` kind of a Proto document (its `.ofini` media live under `office/proto/media/`). */
export const KIND = "proto";

/** Limits (concept §3.6), checked by validate.js on open, import, MCP writes and collaboration records. */
export const LIMITS = Object.freeze({
  nodes: 200000,
  recordBytes: 65536,
  depth: 64,
  variantOptions: 64,
  varsPerCollection: 2000,
  modesPerCollection: 20,
  mediaBytes: 16 * 1048576,
  pages: 1000,
  nameLength: 256,
  listItems: 64,
});

export const NODE_TYPES = Object.freeze(["frame", "rect", "ellipse", "line", "vector", "text", "image", "instance", "component", "componentSet", "slot"]);
/** Types that may have children. A componentSet's children are its variant components. */
export const CONTAINER_TYPES = Object.freeze(["frame", "component", "componentSet", "instance", "slot"]);
export const isContainer = (type) => CONTAINER_TYPES.includes(type);

export const SIZE_MODES = Object.freeze(["fixed", "hug", "fill", "rel"]);
export const POSITIONS = Object.freeze(["flow", "abs"]);
export const CONSTRAINTS_X = Object.freeze(["left", "right", "leftRight", "center", "scale"]);
export const CONSTRAINTS_Y = Object.freeze(["top", "bottom", "topBottom", "center", "scale"]);
export const BLENDS = Object.freeze(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
export const LAYOUT_TYPES = Object.freeze(["none", "flex", "grid"]);
export const DIRECTIONS = Object.freeze(["row", "column"]);
export const ALIGN = Object.freeze(["start", "center", "end", "stretch", "baseline"]);
export const JUSTIFY = Object.freeze(["start", "center", "end", "space-between", "space-around", "space-evenly"]);
export const ALIGN_CONTENT = Object.freeze(["start", "center", "end", "stretch", "space-between", "space-around", "space-evenly"]);
export const SELF_ALIGN = Object.freeze(["auto", "start", "center", "end", "stretch"]);
export const AUTO_FLOW = Object.freeze(["row", "column"]);
export const SCROLL = Object.freeze(["none", "x", "y", "both"]);
export const STICKY = Object.freeze(["top", "bottom", "left", "right"]);
export const FILL_TYPES = Object.freeze(["solid", "linear", "radial", "conic", "image"]);
export const IMAGE_FIT = Object.freeze(["cover", "contain", "fill", "tile", "none"]);
export const STROKE_ALIGN = Object.freeze(["inside", "center", "outside"]);
export const EFFECT_TYPES = Object.freeze(["shadow", "blur", "backgroundBlur"]);
export const TEXT_ALIGN = Object.freeze(["left", "center", "right", "justify"]);
export const TEXT_CASE = Object.freeze(["none", "upper", "lower", "title"]);
export const TEXT_DECORATION = Object.freeze(["none", "underline", "strike"]);
export const TEXT_AUTOSIZE = Object.freeze(["width", "height", "fixed"]);
export const FILL_RULES = Object.freeze(["nonzero", "evenodd"]);
export const PROP_TYPES = Object.freeze(["variant", "text", "bool", "swap", "number", "slot"]);
export const VAR_TYPES = Object.freeze(["color", "number", "string", "bool"]);
export const VAR_UNITS = Object.freeze(["px", "%", "ms", ""]);
export const STYLE_KINDS = Object.freeze(["text", "effect", "fill", "grid"]);
/** Node `style` references: slot → style kind. */
export const STYLE_SLOTS = Object.freeze({ fill: "fill", stroke: "fill", effect: "effect", text: "text", grid: "grid" });
export const MEDIA_TYPES = Object.freeze(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);
/** Prototype triggers and actions (concept §6.1); T9 adds their full semantics. */
export const TRIGGERS = Object.freeze(["click", "doubleClick", "press", "hover", "mouseEnter", "mouseLeave", "drag", "key", "afterDelay", "variableChange"]);
export const ACTIONS = Object.freeze(["navigate", "back", "scrollTo", "openOverlay", "swapOverlay", "closeOverlay", "variant", "set", "if", "openUrl", "media"]);

/** Canonical order of node fields (serialize.js); also the list of fields this schema knows. */
export const NODE_FIELDS = Object.freeze([
  "id", "type", "name", "page", "parent", "ord",
  "visible", "locked", "opacity", "blend",
  "x", "y", "rot", "w", "h", "pos", "cx", "cy", "cell", "sticky",
  "tag", "a11y", "modes",
  "layout", "clip", "scroll",
  "fills", "strokes", "radius", "effects", "style",
  "text", "d", "rule", "alt",
  "props", "variant", "bind", "of", "over", "code",
  "proto",
]);
/** Fields that structure the tree: changed only by moves (ops.js `node.move` / `node.place`), never by updates. */
export const STRUCTURE_FIELDS = Object.freeze(["id", "type", "page", "parent", "ord"]);
/** Fields `node.update` may change (the allow-list of the operation layer). */
export const UPDATABLE_FIELDS = Object.freeze(NODE_FIELDS.filter((f) => !STRUCTURE_FIELDS.includes(f)));
/** Page fields `page.update` may change. */
export const PAGE_UPDATABLE = Object.freeze(["name", "bg", "flows", "modes"]);
export const PAGE_FIELDS = Object.freeze(["id", "name", "ord", "bg", "modes", "flows"]);
export const TOP_FIELDS = Object.freeze(["schema", "meta", "pages", "nodes", "vars", "styles", "breakpoints", "code", "media"]);

/** Values of omitted fields. */
export const FIELD_DEFAULTS = Object.freeze({
  visible: true,
  locked: false,
  opacity: 1,
  blend: "normal",
  x: 0,
  y: 0,
  rot: 0,
  w: Object.freeze({ mode: "fixed", value: 100 }),
  h: Object.freeze({ mode: "fixed", value: 100 }),
  pos: "abs",
  cx: "left",
  cy: "top",
  cell: null,
  sticky: null,
  tag: null,
  a11y: null,
  modes: null,
  layout: Object.freeze({ type: "none" }),
  clip: false,
  scroll: "none",
  fills: Object.freeze([]),
  strokes: Object.freeze([]),
  radius: 0,
  effects: Object.freeze([]),
  style: null,
  proto: Object.freeze([]),
});

/** A node field with its default. */
export const field = (node, key) => (node?.[key] !== undefined ? node[key] : FIELD_DEFAULTS[key]);

export const DEFAULT_BREAKPOINTS = Object.freeze([
  Object.freeze({ id: "base", w: 1280 }),
  Object.freeze({ id: "md", w: 991 }),
  Object.freeze({ id: "sm", w: 478 }),
]);

const TYPE_NAMES = { frame: "Frame", rect: "Rectangle", ellipse: "Ellipse", line: "Line", vector: "Vector", text: "Text", image: "Image", instance: "Instance", component: "Component", componentSet: "Component Set", slot: "Slot" };

/** Default text style of a new text node. */
export const DEFAULT_TEXT_STYLE = Object.freeze({ font: "Inter", size: 16, weight: 400, lineHeight: Object.freeze({ pct: 150 }), tracking: 0, align: "left", color: "#18181b" });

/**
 * Fields a new node of `type` starts with (besides id, type, page, parent and ord). Plain, fresh objects.
 * @param {string} type
 */
export function nodeDefaults(type) {
  const fixed = (value) => ({ mode: "fixed", value });
  switch (type) {
    case "frame":
      return { name: TYPE_NAMES.frame, w: fixed(390), h: fixed(844), layout: { type: "none" }, clip: true, fills: [{ type: "solid", color: "#ffffff" }] };
    case "component":
      return { name: TYPE_NAMES.component, w: { mode: "hug" }, h: { mode: "hug" }, layout: { type: "flex", dir: "row", gap: 8, pad: [8, 16, 8, 16], align: "center", justify: "center" } };
    case "componentSet":
      return { name: TYPE_NAMES.componentSet, w: { mode: "hug" }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: 16, pad: [16, 16, 16, 16] }, props: {} };
    case "instance":
      return { name: TYPE_NAMES.instance, w: { mode: "hug" }, h: { mode: "hug" } };
    case "slot":
      return { name: TYPE_NAMES.slot, w: { mode: "fill" }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: 0 } };
    case "rect":
      return { name: TYPE_NAMES.rect, w: fixed(100), h: fixed(100), fills: [{ type: "solid", color: "#d4d4d8" }] };
    case "ellipse":
      return { name: TYPE_NAMES.ellipse, w: fixed(100), h: fixed(100), fills: [{ type: "solid", color: "#d4d4d8" }] };
    case "line":
      return { name: TYPE_NAMES.line, w: fixed(100), h: fixed(0), strokes: [{ color: "#18181b", w: 1, align: "center" }] };
    case "vector":
      return { name: TYPE_NAMES.vector, w: fixed(24), h: fixed(24), d: "", rule: "nonzero", fills: [{ type: "solid", color: "#18181b" }] };
    case "text":
      return { name: TYPE_NAMES.text, w: { mode: "hug" }, h: { mode: "hug" }, text: { runs: [{ t: "Text", s: {} }], style: { ...DEFAULT_TEXT_STYLE, lineHeight: { pct: 150 } }, autoSize: "width", maxLines: null } };
    case "image":
      return { name: TYPE_NAMES.image, w: fixed(200), h: fixed(150), fills: [], alt: "" };
    default:
      throw new Error(`Unknown Proto node type “${type}”.`);
  }
}

/** A new page object. */
export function newPage({ id, name = "Page 1", ord = initialKey(0, 1), bg = "#f4f4f5", flows = [] } = {}) {
  return { id, name, ord, bg, flows };
}

/**
 * A new, empty Proto model with one page.
 * @param {{ title?: string, created?: string|null, app?: string, pageName?: string, pageId?: string, random?: () => number }} [o]
 */
export function emptyDocument({ title = "Untitled design", created = null, app = "OpenFini", pageName = "Page 1", pageId = null, random = Math.random } = {}) {
  const id = pageId || newId("p", null, random);
  return {
    schema: SCHEMA_VERSION,
    meta: { title, created: created || new Date().toISOString(), unit: "px", app },
    pages: { [id]: newPage({ id, name: pageName }) },
    nodes: {},
    vars: { collections: {}, items: {} },
    styles: {},
    breakpoints: DEFAULT_BREAKPOINTS.map((b) => ({ ...b })),
    code: { links: {}, tokensFile: null },
    media: {},
  };
}
