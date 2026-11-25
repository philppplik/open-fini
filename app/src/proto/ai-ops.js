// Proto Studio assistant operations (docs/concepts/proto-studio.md §7, task T11): the pure part of the Vibe tools of
// group "Proto" (vibe/tools/proto.js). Pure: no DOM, no app; tests drive it with plain models.
//
// Reading
//   describe(model, { page?, root?, depth?, maxLines? }) → { title, pages, page, lines, components, variables, styles }
//       one line per layer: id, type, name, size modes, position, layout, key styles, text, bindings, instance values
//   nodeLine(model, node) → string
//   getNodes(model, ids, { resolved? }) → [stored node | resolved subtree as plain JSON]
//   search(model, { query?, type?, component?, variable?, unbound?, page?, limit? }) → { matches: [line], more }
// Writing (operations for engine/proto/ops.js; the caller applies them as ONE batch = one undo step)
//   createOps(model, specs, { parent?, page, index?, before?, after?, random? }) → { ops, ids, refs }
//       compact nested layer specs with shorthands (see SPEC_HELP) → node.create / instance.create operations with
//       pre-assigned ids, so the result can name every created layer
//   updateOps(model, updates) → ops        [{ id, set?, unset?, bind? }] with the same shorthands as dotted field sets
//   fieldsOf(model, spec, { nested, type }) / names(model): name → id lookups for variables, styles, components
//   renameOps(model, ids, { deep?, tags?, force? }) → { ops, changes }
//   contentOps(model, ids, { kind?, values?, seed? }) → { ops, filled }
// Checking
//   responsive(model, id, { widths?, measurer? }) → [{ width, height, overflow, clipped }]
import { NODE_TYPES, UPDATABLE_FIELDS, field, isContainer } from "../engine/proto/schema.js";
import { newId, isId } from "../engine/proto/ids.js";
import { indexOf, pageList, pageKey, ancestors } from "../engine/proto/tree.js";
import { createResolver, walkResolved } from "../engine/proto/resolve.js";
import { layout } from "../engine/proto/layout.js";
import { textStyleOf } from "../engine/proto/css.js";
import { bindingsIn, isBinding, slug } from "../engine/proto/variables.js";
import { variantAxes, propsOfTarget } from "../engine/proto/components.js";
import { suggestName, suggestTag } from "../engine/proto/lint.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const r1 = (n) => Math.round(n * 10) / 10;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const textOf = (node) => (Array.isArray(node?.text?.runs) ? node.text.runs.map((r) => (typeof r?.t === "string" ? r.t : "")).join("") : "");

/** Help text for the layer spec of proto_create (kept next to the code that reads it). */
export const SPEC_HELP =
  "A layer spec is { type, name?, ref?, …fields, children? }. type: frame (a box: also div/stack/row/column), text, rect, ellipse, line, vector (d = SVG path), image, slot, component, instance (with of = component name or id, variant, props). Shorthands: w/h = number (fixed px), \"hug\", \"fill\" or \"50%\"; minW/maxW/minH/maxH; layout = \"row\" | \"column\" | \"grid\" | { dir, gap, rowGap, pad (number, [vertical, horizontal] or [top, right, bottom, left]), align (start|center|end|stretch|baseline), justify (start|center|end|between|around|evenly), wrap, cols/rows (a number or tracks such as [\"1fr\", 240, \"auto\"]) }; gap, pad, dir, justify also work at the top level; fill = color; stroke = color or { color, w, align }; radius; shadow = sm|md|lg; opacity; text = \"string\" with font, size, weight (number or bold/semibold/medium), color, align (text), lineHeight (px number or { pct }), tracking, autoSize (width|height|fixed), maxLines; tag (button, nav, h1…); alt; x, y (only for absolute layers). Colors are #hex or { \"$var\": \"variable name\" }; any number or color may be { \"$var\": name }. Children of a flex or grid frame flow in its layout. Nested frames default to a transparent column that hugs its content.";

// ------------------------------------------------------------------------------------------------- names

/** Name → id lookups (exact, then case-insensitive, then by slug) for variables, styles and components. */
export function names(model) {
  const items = isObj(model.vars?.items) ? model.vars.items : {};
  const colls = isObj(model.vars?.collections) ? model.vars.collections : {};
  const styles = isObj(model.styles) ? model.styles : {};
  const find = (map, key, label, filter = () => true) => {
    if (key == null) return null;
    const k = String(key);
    if (isObj(map[k]) && filter(map[k])) return k;
    const list = Object.entries(map).filter(([, v]) => isObj(v) && filter(v));
    const hit = list.find(([, v]) => v.name === k) || list.find(([, v]) => String(v.name).toLowerCase() === k.toLowerCase()) || list.find(([, v]) => slug(v.name) === slug(k));
    if (!hit) throw new Error(`There is no ${label} “${k}”. Call proto_describe to see the names.`);
    return hit[0];
  };
  return {
    variable: (k) => find(items, k, "variable"),
    collection: (k) => find(colls, k, "variable collection"),
    mode(coll, k) {
      const c = colls[coll];
      const m = (c?.modes || []).find((x) => x.id === k) || (c?.modes || []).find((x) => String(x.name).toLowerCase() === String(k).toLowerCase());
      if (!m) throw new Error(`The collection “${c?.name || coll}” has no mode “${k}” (modes: ${(c?.modes || []).map((x) => x.name).join(", ")}).`);
      return m.id;
    },
    style: (k, kind) => find(styles, k, kind ? `${kind} style` : "style", (s) => !kind || s.kind === kind),
    component: (k) => find(model.nodes, k, "component", (n) => n.type === "component" || n.type === "componentSet"),
  };
}

/** Replaces { $var: name } by { $var: id } everywhere in a value. */
function bindNames(value, N) {
  if (isBinding(value)) return { $var: N.variable(value.$var) };
  if (Array.isArray(value)) return value.map((v) => bindNames(v, N));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bindNames(v, N)]));
  return value;
}

// ------------------------------------------------------------------------------------------------- shorthands

const NAMED = { black: "#000000", white: "#ffffff", transparent: "#00000000", red: "#ef4444", green: "#22c55e", blue: "#3b82f6", gray: "#71717a", grey: "#71717a" };
/** A CSS color string as a hex literal the schema accepts (#rrggbb or #rrggbbaa). */
export function hexColor(c) {
  if (typeof c !== "string") return c;
  const s = c.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return s;
  const h = /^#([0-9a-f]{3,4})$/.exec(s);
  if (h) return `#${[...h[1]].map((x) => x + x).join("")}`;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const hx = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${hx(+m[1])}${hx(+m[2])}${hx(+m[3])}${a < 1 ? hx(a * 255) : ""}`;
  }
  throw new Error(`“${c}” is not a color; use #rrggbb, #rrggbbaa or rgb().`);
}
const color = (v) => (isBinding(v) ? v : hexColor(v));

/** Normalizes color strings in known color positions of a field value. */
function colors(key, v) {
  if (Array.isArray(v)) return v.map((x) => colors(key, x));
  if (!isObj(v) || isBinding(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = (k === "color" || k === "bg") && typeof x === "string" ? hexColor(x) : colors(k, x);
  return out;
}

const size = (v) => {
  if (typeof v === "number" || isBinding(v)) return { mode: "fixed", value: v };
  if (v === "hug" || v === "fill") return { mode: v };
  if (typeof v === "string" && /^\d+(\.\d+)?%$/.test(v)) return { mode: "rel", value: parseFloat(v) };
  if (typeof v === "string" && /^\d+(\.\d+)?(px)?$/.test(v)) return { mode: "fixed", value: parseFloat(v) };
  if (isObj(v)) return v;
  throw new Error(`“${JSON.stringify(v)}” is not a size; use a number, "hug", "fill" or "50%".`);
};
const pad = (v) => {
  if (typeof v === "number" || isBinding(v)) return [v, v, v, v];
  if (Array.isArray(v) && v.length === 2) return [v[0], v[1], v[0], v[1]];
  if (Array.isArray(v) && v.length === 3) return [v[0], v[1], v[2], v[1]];
  return v;
};
const JUSTIFY = { between: "space-between", around: "space-around", evenly: "space-evenly", "flex-start": "start", "flex-end": "end" };
const ALIGN = { "flex-start": "start", "flex-end": "end" };
const track = (t) => {
  if (isObj(t)) return t;
  if (typeof t === "number") return { px: t };
  const s = String(t).trim();
  if (s === "auto") return { auto: true };
  if (/^[\d.]+fr$/.test(s)) return { fr: parseFloat(s) };
  if (/^[\d.]+(px)?$/.test(s)) return { px: parseFloat(s) };
  const m = /^minmax\(\s*([^,]+),\s*([^)]+)\)$/.exec(s);
  if (m) return { minmax: [track(m[1]), track(m[2])].map((x) => (x.px !== undefined ? x.px : x)) };
  throw new Error(`“${t}” is not a grid track; use 1fr, 240, auto or minmax(120, 1fr).`);
};
const tracks = (v) => (typeof v === "number" ? Array.from({ length: Math.max(1, Math.min(64, Math.round(v))) }, () => ({ fr: 1 })) : Array.isArray(v) ? v.map(track) : v);

/** A layout value from a shorthand (string or partial object). `partial` keeps only the given keys (updates). */
function layoutOf(v, partial = false) {
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "row" || s === "column" || s === "col") return { type: "flex", dir: s === "row" ? "row" : "column" };
    if (s === "grid") return { type: "grid", grid: { cols: [{ fr: 1 }] } };
    if (s === "flex") return { type: "flex", dir: "row" };
    if (s === "none") return { type: "none" };
    throw new Error(`“${v}” is not a layout; use row, column, grid or none.`);
  }
  if (!isObj(v)) return v;
  const out = { ...v };
  if (out.dir === "col" || out.dir === "vertical") out.dir = "column";
  if (out.dir === "horizontal") out.dir = "row";
  if (out.direction) {
    out.dir = out.direction === "column" || out.direction === "vertical" ? "column" : "row";
    delete out.direction;
  }
  if (out.padding !== undefined) {
    out.pad = out.padding;
    delete out.padding;
  }
  if (out.pad !== undefined) out.pad = pad(out.pad);
  if (out.justify !== undefined) out.justify = JUSTIFY[out.justify] || out.justify;
  if (out.align !== undefined) out.align = ALIGN[out.align] || out.align;
  if (out.cols !== undefined || out.rows !== undefined) {
    out.grid = { ...(isObj(out.grid) ? out.grid : {}), ...(out.cols !== undefined ? { cols: tracks(out.cols) } : {}), ...(out.rows !== undefined ? { rows: tracks(out.rows) } : {}) };
    delete out.cols;
    delete out.rows;
  }
  if (isObj(out.grid)) out.grid = { ...out.grid, ...(out.grid.cols !== undefined ? { cols: tracks(out.grid.cols) } : {}), ...(out.grid.rows !== undefined ? { rows: tracks(out.grid.rows) } : {}) };
  if (!partial && out.type === undefined) out.type = out.grid ? "grid" : "flex";
  if (!partial && out.type === "flex" && out.dir === undefined) out.dir = "column";
  if (!partial && out.type === "grid" && !isObj(out.grid)) out.grid = { cols: [{ fr: 1 }] };
  return out;
}

const WEIGHTS = { thin: 100, extralight: 200, light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const SHADOWS = {
  sm: [{ type: "shadow", x: 0, y: 1, blur: 2, spread: 0, color: "#0000001a" }],
  md: [{ type: "shadow", x: 0, y: 4, blur: 12, spread: -2, color: "#00000026" }],
  lg: [{ type: "shadow", x: 0, y: 12, blur: 32, spread: -8, color: "#00000033" }],
};
const TEXT_KEYS = { font: "font", fontFamily: "font", size: "size", fontSize: "size", weight: "weight", fontWeight: "weight", color: "color", lineHeight: "lineHeight", tracking: "tracking", letterSpacing: "tracking", italic: "italic", case: "case", decoration: "decoration", textAlign: "align" };
const textValue = (k, v) => {
  if (k === "weight" && typeof v === "string") return WEIGHTS[v.toLowerCase().replace(/[\s-]/g, "")] ?? (Number(v) || 400);
  if (k === "color") return color(v);
  if (k === "lineHeight" && typeof v === "number") return v <= 4 ? { pct: Math.round(v * 100) } : { px: v };
  if (k === "lineHeight" && typeof v === "string" && /%$/.test(v)) return { pct: parseFloat(v) };
  return v;
};
// keys a spec may carry besides schema fields
const SPEC_KEYS = new Set(["type", "children", "ref", "id", "of", "variant", "props", "fill", "stroke", "shadow", "minW", "maxW", "minH", "maxH", "gap", "rowGap", "pad", "padding", "dir", "justify", "wrap", "autoSize", "maxLines", "align", ...Object.keys(TEXT_KEYS)]);

/**
 * Schema fields from a spec with shorthands (see SPEC_HELP). `nested`: the layer has a parent (frames then default to
 * a transparent hugging column). Names of variables and styles become ids.
 */
export function fieldsOf(model, spec, { nested = false, type = spec.type } = {}) {
  const N = names(model);
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (SPEC_KEYS.has(k) || k === "name") continue;
    if (!UPDATABLE_FIELDS.includes(k) && k !== "text") throw new Error(`Unknown layer field “${k}”. ${SPEC_HELP}`);
    if (k === "text") continue;
    out[k] = v;
  }
  if (spec.name !== undefined) out.name = String(spec.name).slice(0, 256);
  if (out.w !== undefined) out.w = size(out.w);
  if (out.h !== undefined) out.h = size(out.h);
  for (const [k, axis, bound] of [["minW", "w", "min"], ["maxW", "w", "max"], ["minH", "h", "min"], ["maxH", "h", "max"]]) if (spec[k] !== undefined) out[axis] = { ...(out[axis] || (type === "text" || nested ? { mode: "hug" } : { mode: "fixed", value: 100 })), [bound]: spec[k] };
  // layout
  const flat = {};
  for (const k of ["gap", "rowGap", "pad", "padding", "dir", "justify", "wrap"]) if (spec[k] !== undefined) flat[k] = spec[k];
  if (spec.align !== undefined && type !== "text") flat.align = spec.align;
  if (out.layout !== undefined || Object.keys(flat).length) {
    const base = typeof out.layout === "string" ? layoutOf(out.layout) : isObj(out.layout) ? out.layout : {};
    out.layout = layoutOf({ ...base, ...flat });
  }
  if (spec.fill !== undefined) out.fills = spec.fill === null || spec.fill === "none" ? [] : [{ type: "solid", color: color(spec.fill) }];
  if (spec.stroke !== undefined) out.strokes = spec.stroke === null || spec.stroke === "none" ? [] : [isObj(spec.stroke) && !isBinding(spec.stroke) ? { w: 1, align: "inside", ...spec.stroke } : { color: spec.stroke, w: 1, align: "inside" }];
  if (spec.shadow !== undefined) out.effects = spec.shadow === null || spec.shadow === false || spec.shadow === "none" ? [] : isObj(spec.shadow) ? [{ type: "shadow", x: 0, y: 2, blur: 8, spread: 0, color: "#00000026", ...spec.shadow }] : structuredClone(SHADOWS[spec.shadow] || SHADOWS.md);
  // text
  if (type === "text") {
    const style = {};
    for (const [k, key] of Object.entries(TEXT_KEYS)) if (spec[k] !== undefined) style[key] = textValue(key, spec[k]);
    if (spec.align !== undefined) style.align = spec.align;
    const t = isObj(spec.text) ? { ...spec.text } : {};
    if (typeof spec.text === "string" || typeof spec.text === "number") t.runs = [{ t: String(spec.text), s: {} }];
    if (Object.keys(style).length) t.style = { ...textStyleOf({}), ...(isObj(t.style) ? t.style : {}), ...style };
    if (spec.autoSize !== undefined) t.autoSize = spec.autoSize;
    if (spec.maxLines !== undefined) t.maxLines = spec.maxLines;
    const wmode = out.w?.mode;
    if (t.autoSize === undefined && (wmode === "fill" || wmode === "fixed" || wmode === "rel")) t.autoSize = out.h?.mode === "fixed" ? "fixed" : "height";
    if (Object.keys(t).length) out.text = { ...(t.runs ? {} : { runs: [{ t: "Text", s: {} }] }), ...t };
  } else if (spec.text !== undefined) throw new Error(`Only text layers have text; put a { type: "text" } child inside the ${type}.`);
  // nested boxes behave like a div: transparent column that hugs its content
  if (nested && type === "frame") {
    if (out.w === undefined) out.w = { mode: "hug" };
    if (out.h === undefined) out.h = { mode: "hug" };
    if (out.fills === undefined) out.fills = [];
    if (out.clip === undefined) out.clip = false;
    if (out.layout === undefined) out.layout = { type: "flex", dir: "column", gap: 0 };
  }
  if (isObj(out.style)) out.style = Object.fromEntries(Object.entries(out.style).map(([slot, s]) => [slot, s == null ? s : N.style(s, slot === "stroke" ? "fill" : slot)]));
  return bindNames(colors("", out), N);
}

const TYPE_ALIASES = { box: "frame", div: "frame", group: "frame", stack: "frame", row: "frame", column: "frame", col: "frame", rectangle: "rect", circle: "ellipse", oval: "ellipse", path: "vector", icon: "vector", img: "image", label: "text", heading: "text", paragraph: "text" };

function normType(spec) {
  const raw = String(spec?.type || "").trim();
  const t = TYPE_ALIASES[raw.toLowerCase()] || raw;
  if (!NODE_TYPES.includes(t) || t === "componentSet") throw new Error(`Unknown layer type “${spec?.type}”. ${SPEC_HELP}`);
  const extra = {};
  if (["row", "column", "col", "stack"].includes(raw.toLowerCase()) && spec.layout === undefined && spec.dir === undefined) extra.dir = raw.toLowerCase() === "row" ? "row" : "column";
  return { type: t, extra };
}

/** Where a new top-level layer goes: right of the page's layers (100 px apart), top-aligned. */
function freeSpot(model, page) {
  let x = 0;
  let y = null;
  for (const id of indexOf(model).get(pageKey(page))) {
    const n = model.nodes[id];
    const w = n?.w?.mode === "fixed" && typeof n.w.value === "number" ? n.w.value : 400;
    x = Math.max(x, (typeof n.x === "number" ? n.x : 0) + w + 100);
    y = y === null ? (typeof n.y === "number" ? n.y : 0) : Math.min(y, typeof n.y === "number" ? n.y : 0);
  }
  return { x, y: y ?? 0 };
}

/**
 * Operations that create nested layer specs (see SPEC_HELP) under `parent` (or at the top level of `page`). Ids are
 * assigned here, so the caller can return them; `refs` maps each spec's `ref` to its id.
 */
export function createOps(model, specs, { parent = null, page = null, index, before, after, random = Math.random } = {}) {
  const list = Array.isArray(specs) ? specs : [specs];
  if (!list.length) throw new Error("Pass at least one layer spec.");
  const N = names(model);
  const pnode = parent != null ? model.nodes[parent] : null;
  if (parent != null && !pnode) throw new Error(`There is no layer “${parent}”. Call proto_describe for the ids.`);
  if (pnode && !isContainer(pnode.type)) throw new Error(`A ${pnode.type} cannot contain layers; pick a frame.`);
  const pg = pnode ? pnode.page : page || pageList(model)[0]?.id;
  if (!model.pages?.[pg]) throw new Error(`There is no page “${page}”.`);
  const taken = new Set(Object.keys(model.nodes));
  const fresh = () => {
    const id = newId("n", (x) => taken.has(x), random);
    taken.add(id);
    return id;
  };
  const ops = [];
  const ids = [];
  const refs = {};
  let spot = null;
  let count = 0;
  const visit = (spec, parentId, root) => {
    if (!isObj(spec)) throw new Error(`A layer spec must be an object. ${SPEC_HELP}`);
    if (++count > 2000) throw new Error("At most 2,000 layers per call; split the work.");
    const { type, extra } = normType(spec);
    const id = isId(spec.id) && !taken.has(spec.id) ? (taken.add(spec.id), spec.id) : fresh();
    const fields = fieldsOf(model, { ...extra, ...spec, type }, { nested: parentId != null, type });
    // a text layer without a name is named by its first words (the Layers panel and code read better)
    if (type === "text" && fields.name === undefined && fields.text?.runs) fields.name = clip(fields.text.runs.map((x) => x.t).join("").replace(/\s+/g, " ").trim(), 40) || "Text";
    if (parentId == null && type !== "instance") {
      spot ||= freeSpot(model, pg);
      if (fields.x === undefined) fields.x = spot.x;
      if (fields.y === undefined) fields.y = spot.y;
      spot.x = fields.x + (fields.w?.mode === "fixed" && typeof fields.w.value === "number" ? fields.w.value : 400) + 100;
    }
    const pos = root ? { ...(index !== undefined ? { index } : {}), ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) } : {};
    if (type === "instance") {
      if (spec.of == null) throw new Error("An instance needs of (a component name or id).");
      ops.push({ op: "instance.create", of: N.component(spec.of), parent: parentId, page: pg, id, fields, ...(isObj(spec.variant) ? { variant: spec.variant } : {}), ...(isObj(spec.props) ? { props: bindNames(spec.props, N) } : {}), ...pos });
    } else ops.push({ op: "node.create", type, parent: parentId, page: pg, id, fields, ...pos });
    ids.push(id);
    if (spec.ref != null) refs[String(spec.ref)] = id;
    const kids = spec.children ?? [];
    if (!Array.isArray(kids)) throw new Error("children must be a list of layer specs.");
    if (kids.length && !isContainer(type)) throw new Error(`A ${type} cannot have children; use a frame.`);
    for (const c of kids) visit(c, id, false);
  };
  for (const s of list) visit(s, parent ?? null, true);
  return { ops, ids, refs };
}

/** Dotted `set` paths of an update from shorthands; `node` is the stored layer. */
function setOf(model, node, set) {
  const out = {};
  const N = names(model);
  const short = {};
  for (const [k, v] of Object.entries(set || {})) {
    if (k.includes(".")) out[k] = bindNames(typeof v === "string" && /(^|\.)color$/.test(k) ? hexColor(v) : colors(k, v), N);
    else short[k] = v;
  }
  if (!Object.keys(short).length) return out;
  const type = node.type;
  const text = {};
  if (type === "text") {
    for (const [k, key] of Object.entries(TEXT_KEYS)) if (short[k] !== undefined) {
      text[`text.style.${key}`] = textValue(key, short[k]);
      delete short[k];
    }
    if (short.align !== undefined) {
      text["text.style.align"] = short.align;
      delete short.align;
    }
    if (typeof short.text === "string" || typeof short.text === "number") {
      // keep the first run's style
      const s0 = isObj(node.text?.runs?.[0]?.s) ? node.text.runs[0].s : {};
      text["text.runs"] = [{ t: String(short.text), s: s0 }];
      delete short.text;
    }
    for (const k of ["autoSize", "maxLines"]) if (short[k] !== undefined) {
      text[`text.${k}`] = short[k];
      delete short[k];
    }
  }
  // layout keys merge into the existing layout
  const flat = {};
  for (const k of ["gap", "rowGap", "pad", "padding", "dir", "justify", "wrap", "align"]) if (short[k] !== undefined) {
    flat[k] = short[k];
    delete short[k];
  }
  if (short.layout !== undefined || Object.keys(flat).length) {
    const given = short.layout;
    delete short.layout;
    if (typeof given === "string" || (isObj(given) && given.type !== undefined && given.type !== (node.layout?.type || "none"))) out.layout = fieldsOf(model, { type: "frame", layout: given, ...flat }, { type: "frame" }).layout;
    else {
      const lay = layoutOf({ ...(isObj(given) ? given : {}), ...flat }, true);
      if ((node.layout?.type || "none") === "none" && lay.type === undefined) Object.assign(out, { layout: layoutOf({ type: "flex", ...lay }) });
      else for (const [k, v] of Object.entries(lay)) out[`layout.${k}`] = bindNames(v, N);
    }
  }
  const f = fieldsOf(model, { type, ...short }, { type });
  delete f.text;
  // a text that gets a fixed or fill width wraps from then on
  if (type === "text" && f.w && f.w.mode !== "hug" && text["text.autoSize"] === undefined && (node.text?.autoSize || "width") === "width") text["text.autoSize"] = "height";
  return { ...out, ...f, ...text };
}

/**
 * Operations for a list of updates: [{ id, set?, unset?, bind? }]. `set` takes the spec shorthands and dotted paths
 * ("layout.gap"); `bind` maps field paths to variable names or ids (null unbinds, keeping the value).
 */
export function updateOps(model, updates) {
  const N = names(model);
  const ops = [];
  for (const u of updates || []) {
    const node = model.nodes[u?.id];
    if (!node) throw new Error(`There is no layer “${u?.id}”. Call proto_describe for the ids.`);
    const set = setOf(model, node, u.set);
    const unset = Array.isArray(u.unset) ? u.unset : [];
    if (Object.keys(set).length || unset.length) ops.push({ op: "node.update", id: node.id, set, unset });
    for (const [path, v] of Object.entries(u.bind || {})) ops.push({ op: "node.bind", id: node.id, path, var: v == null ? null : N.variable(v) });
  }
  if (!ops.length) throw new Error("Nothing to change: pass set, unset or bind.");
  return ops;
}

// ------------------------------------------------------------------------------------------------- reading

const fmtNum = (v, vars) => (isBinding(v) ? `$${vars[v.$var]?.name || v.$var}` : typeof v === "number" ? String(r1(v)) : String(v));
function fmtSize(s, vars) {
  if (!isObj(s)) return "?";
  const base = s.mode === "fixed" ? fmtNum(s.value, vars) : s.mode === "rel" ? `${s.value}%` : s.mode;
  return `${base}${s.min != null ? `≥${fmtNum(s.min, vars)}` : ""}${s.max != null ? `≤${fmtNum(s.max, vars)}` : ""}`;
}
function fmtPad(p, vars) {
  if (!Array.isArray(p)) return "";
  const f = p.map((x) => fmtNum(x, vars));
  if (f.every((x) => x === f[0])) return f[0];
  if (f[0] === f[2] && f[1] === f[3]) return `${f[0]},${f[1]}`;
  return f.join(",");
}
function fmtPaint(f, vars, media) {
  if (!isObj(f)) return "";
  if (f.type === "solid") return `${fmtNum(f.color, vars)}${f.opacity != null && f.opacity < 1 ? `@${r1(f.opacity)}` : ""}`;
  if (f.type === "image") return `image(${media?.[f.media]?.name || f.media})`;
  return `${f.type}(${(f.stops || []).map((s) => fmtNum(s.color, vars)).join(",")})`;
}

/** One compact line for a stored layer. */
export function nodeLine(model, n) {
  const vars = model.vars?.items || {};
  const parts = [n.id, n.type, JSON.stringify(n.name || "")];
  if (n.type !== "text" || n.w?.mode !== "hug" || n.h?.mode !== "hug") parts.push(`${fmtSize(field(n, "w"), vars)}×${fmtSize(field(n, "h"), vars)}`);
  if (field(n, "pos") === "abs") parts.push(`@${fmtNum(field(n, "x"), vars)},${fmtNum(field(n, "y"), vars)}`);
  if (n.rot) parts.push(`rot ${n.rot}`);
  const L = field(n, "layout");
  if (L?.type === "flex") parts.push(`flex ${L.dir === "column" ? "col" : "row"}${L.wrap ? " wrap" : ""}${L.gap !== undefined ? ` gap ${fmtNum(L.gap, vars)}` : ""}${L.pad ? ` pad ${fmtPad(L.pad, vars)}` : ""}${L.align ? ` align ${L.align}` : ""}${L.justify ? ` justify ${L.justify}` : ""}`);
  else if (L?.type === "grid") parts.push(`grid ${L.grid?.cols?.length || 1}col${L.grid?.rows ? `×${L.grid.rows.length}row` : ""}${L.gap !== undefined ? ` gap ${fmtNum(L.gap, vars)}` : ""}${L.pad ? ` pad ${fmtPad(L.pad, vars)}` : ""}`);
  if (n.tag) parts.push(`<${n.tag}>`);
  const fills = (n.fills || []).filter((f) => f?.visible !== false);
  if (fills.length && n.type !== "text") parts.push(`fill ${fills.map((f) => fmtPaint(f, vars, model.media)).join("+")}`);
  if (n.strokes?.length) parts.push(`stroke ${fmtNum(n.strokes[0].color, vars)} ${fmtNum(n.strokes[0].w, vars)}`);
  if (n.radius) parts.push(`r ${Array.isArray(n.radius) ? fmtPad(n.radius, vars) : fmtNum(n.radius, vars)}`);
  if (n.effects?.length) parts.push(n.effects.map((e) => e.type).join("+"));
  if (n.opacity != null && n.opacity !== 1) parts.push(`opacity ${fmtNum(n.opacity, vars)}`);
  if (n.clip && n.parent != null) parts.push("clip");
  if (n.type === "text") {
    const s = textStyleOf(n);
    parts.push(`${JSON.stringify(clip(textOf(n), 60))} ${fmtNum(s.size, vars)}/${fmtNum(s.weight, vars)} ${fmtNum(s.color, vars)}${s.align && s.align !== "left" ? ` ${s.align}` : ""}${n.text?.autoSize && n.text.autoSize !== "width" ? ` auto-${n.text.autoSize}` : ""}`);
  }
  if (n.type === "instance") {
    const target = model.nodes[n.of];
    parts.push(`of ${JSON.stringify(target?.name || n.of)}`);
    if (isObj(n.variant) && Object.keys(n.variant).length) parts.push(`{${Object.entries(n.variant).map(([k, v]) => `${k}=${v}`).join(", ")}}`);
    if (isObj(n.props) && Object.keys(n.props).length) parts.push(`props ${clip(JSON.stringify(n.props), 120)}`);
    if (isObj(n.over) && Object.keys(n.over).length) parts.push(`${Object.keys(n.over).length} overrides`);
  }
  if ((n.type === "component" || n.type === "componentSet") && isObj(n.props) && Object.keys(n.props).length) parts.push(`props ${Object.entries(n.props).map(([k, d]) => `${k}:${d.type}${d.type === "variant" ? `(${(d.options || []).join("|")})` : ""}`).join(", ")}`);
  if (n.type === "component" && isObj(n.variant)) parts.push(`{${Object.entries(n.variant).map(([k, v]) => `${k}=${v}`).join(", ")}}`);
  if (isObj(n.style)) parts.push(`style ${Object.entries(n.style).map(([k, s]) => `${k}:${JSON.stringify(model.styles?.[s]?.name || s)}`).join(" ")}`);
  if (isObj(n.modes)) parts.push(`modes ${Object.entries(n.modes).map(([c, m]) => `${model.vars?.collections?.[c]?.name || c}=${(model.vars?.collections?.[c]?.modes || []).find((x) => x.id === m)?.name || m}`).join(" ")}`);
  if (n.visible === false) parts.push("hidden");
  if (n.locked) parts.push("locked");
  return parts.join(" ");
}

/** Outline of the document or a subtree (see the header). */
export function describe(model, { page = null, root = null, depth = 6, maxLines = 400 } = {}) {
  const ix = indexOf(model);
  const pages = pageList(model);
  const pg = root ? model.nodes[root]?.page : page && model.pages[page] ? page : pages[0]?.id;
  if (root && !model.nodes[root]) throw new Error(`There is no layer “${root}”. Call proto_describe without root for the ids.`);
  const lines = [];
  let more = 0;
  const visit = (id, d) => {
    const n = model.nodes[id];
    if (!n) return;
    if (lines.length >= maxLines) {
      more++;
      return;
    }
    lines.push(`${"  ".repeat(d)}${nodeLine(model, n)}`);
    const kids = ix.get(id);
    if (d + 1 >= depth && kids.length) {
      lines.push(`${"  ".repeat(d + 1)}… ${kids.length} more layer${kids.length === 1 ? "" : "s"} (proto_describe root=${id})`);
      return;
    }
    for (const k of kids) visit(k, d + 1);
  };
  if (root) visit(root, 0);
  else for (const id of ix.get(pageKey(pg))) visit(id, 0);
  if (more) lines.push(`… ${more} more layers (pass root or a larger maxLines)`);
  const vars = model.vars?.items || {};
  const colls = model.vars?.collections || {};
  const counts = new Map();
  for (const n of Object.values(model.nodes)) if (n?.type === "instance") counts.set(n.of, (counts.get(n.of) || 0) + 1);
  const components = Object.values(model.nodes)
    .filter((n) => n?.type === "componentSet" || (n?.type === "component" && model.nodes[n.parent]?.type !== "componentSet"))
    .slice(0, 100)
    .map((n) => {
      const axes = variantAxes(model, n.id);
      const props = Object.entries(propsOfTarget(model, n.id) || {}).filter(([, d]) => d?.type !== "variant").map(([k, d]) => `${k}:${d.type}`);
      return `${n.id} ${n.type === "componentSet" ? "set" : "component"} ${JSON.stringify(n.name)}${Object.keys(axes).length ? ` variants ${Object.entries(axes).map(([k, a]) => `${k}=${a.options.join("|")}`).join(" ")}` : ""}${props.length ? ` props ${props.join(", ")}` : ""} instances ${counts.get(n.id) || 0}`;
    });
  const variables = Object.entries(colls).map(([cid, c]) => {
    const list = Object.entries(vars).filter(([, v]) => v?.coll === cid);
    const modes = (c.modes || []).map((m) => m.name);
    const fmtV = (v) => (isBinding(v) ? `→${vars[v.$var]?.name || v.$var}` : JSON.stringify(v));
    return {
      id: cid,
      name: c.name,
      modes,
      ...(c.extends ? { extends: colls[c.extends]?.name || c.extends } : {}),
      variables: list.slice(0, 60).map(([vid, v]) => `${vid} ${v.type} ${v.name} = ${(c.modes || []).map((m) => fmtV(v.values?.[m.id])).join(" | ")}`),
      ...(list.length > 60 ? { more: list.length - 60 } : {}),
    };
  });
  const styles = Object.entries(model.styles || {}).slice(0, 100).map(([sid, s]) => `${sid} ${s.kind} ${JSON.stringify(s.name)}`);
  return {
    title: model.meta?.title || "",
    pages: pages.map((p) => `${p.id} ${JSON.stringify(p.name)} ${ix.get(pageKey(p.id)).length} top-level layers${p.id === pg ? " (shown)" : ""}`),
    page: pg,
    lines,
    components,
    variables,
    styles,
  };
}

/** Stored layers, or resolved subtrees (styles, instances and variables applied) as plain JSON. */
export function getNodes(model, ids, { resolved = false, modes } = {}) {
  const res = resolved ? createResolver(model, modes ? { modes } : {}) : null;
  return ids.map((id) => {
    const n = model.nodes[id];
    if (!n) throw new Error(`There is no layer “${id}”. Call proto_describe for the ids.`);
    if (!resolved) return n;
    const plain = (r) => ({ key: r.key, ...r.node, ...(r.bound ? { bound: r.bound } : {}), ...(r.children.length ? { children: r.children.map(plain) } : {}) });
    return plain(res.tree(id));
  });
}

/** Finds layers. Every filter given must match. */
export function search(model, { query = null, type = null, component = null, variable = null, unbound = null, page = null, limit = 100 } = {}) {
  const N = names(model);
  const comp = component != null ? N.component(component) : null;
  const v = variable != null ? N.variable(variable) : null;
  const q = query ? String(query).toLowerCase() : null;
  const out = [];
  let more = 0;
  for (const n of Object.values(model.nodes)) {
    if (!isObj(n) || (page && n.page !== page) || (type && n.type !== type)) continue;
    if (q && !String(n.name || "").toLowerCase().includes(q) && !textOf(n).toLowerCase().includes(q)) continue;
    if (comp && !(n.type === "instance" && (n.of === comp || model.nodes[n.of]?.parent === comp))) continue;
    if (v && !Object.keys(n).some((k) => !["id", "type", "page", "parent", "ord"].includes(k) && bindingsIn(n[k]).some(([, x]) => x === v))) continue;
    if (unbound === "color" && !hasLiteralColor(n)) continue;
    if (unbound === "spacing" && !hasLiteralSpacing(n)) continue;
    if (out.length >= limit) {
      more++;
      continue;
    }
    out.push(nodeLine(model, n));
  }
  return { matches: out, ...(more ? { more } : {}) };
}

const hasLiteralColor = (n) => (n.fills || []).some((f) => typeof f?.color === "string") || (n.strokes || []).some((s) => typeof s?.color === "string") || typeof n.text?.style?.color === "string";
const hasLiteralSpacing = (n) => {
  const L = n.layout;
  return isObj(L) && L.type !== "none" && (typeof L.gap === "number" || (Array.isArray(L.pad) && L.pad.some((x) => typeof x === "number" && x !== 0)));
};

// ------------------------------------------------------------------------------------------------- rename, content

/** Semantic names (and with `tags`, HTML tags) for layers; `deep` includes their descendants. */
export function renameOps(model, ids, { deep = true, tags = true, force = false } = {}) {
  const ix = indexOf(model);
  const all = [];
  const add = (id) => {
    all.push(id);
    if (deep && model.nodes[id]?.type !== "instance") for (const k of ix.get(id)) add(k);
  };
  for (const id of ids) {
    if (!model.nodes[id]) throw new Error(`There is no layer “${id}”.`);
    add(id);
  }
  const DEFAULT = /^(Frame|Rectangle|Ellipse|Line|Vector|Text|Image|Instance|Component|Slot|Group)( \d+)?$/;
  const ops = [];
  const changes = [];
  for (const id of all) {
    const n = model.nodes[id];
    if (!n || ancestors(model, id).some((a) => model.nodes[a]?.type === "instance")) continue;
    const set = {};
    if (force || DEFAULT.test(n.name || "") || !n.name) {
      const name = suggestName(model, id);
      if (name && name !== n.name) set.name = name;
    }
    if (tags && !n.tag) {
      const tag = suggestTag(model, id);
      if (tag) set.tag = tag;
    }
    if (Object.keys(set).length) {
      ops.push({ op: "node.update", id, set });
      changes.push(`${id}: ${set.name ? `${JSON.stringify(n.name)} → ${JSON.stringify(set.name)}` : ""}${set.tag ? ` <${set.tag}>` : ""}`.trim());
    }
  }
  return { ops, changes };
}

const DATA = {
  name: ["Ava Thompson", "Liam Carter", "Maya Patel", "Noah Kim", "Sofia Rossi", "Ethan Brooks", "Lena Fischer", "Omar Haddad", "Chloe Martin", "Lucas Silva", "Hana Sato", "Jonas Berg"],
  first: ["Ava", "Liam", "Maya", "Noah", "Sofia", "Ethan", "Lena", "Omar", "Chloe", "Lucas", "Hana", "Jonas"],
  email: ["ava@example.com", "liam.carter@example.com", "maya@example.org", "noah.kim@example.net", "sofia@example.com", "ethan@example.org"],
  company: ["Northwind Labs", "Bluepeak", "Juniper & Co.", "Atlas Studio", "Brightline", "Copper Field", "Harbor Health", "Lumen Works"],
  city: ["Lisbon", "Toronto", "Melbourne", "Berlin", "Seoul", "Austin", "Oslo", "Cape Town", "Montreal", "Kyoto"],
  title: ["Weekly summary", "Getting started", "Project Aurora", "Quarterly review", "New arrivals", "Team updates", "Your next trip", "Saved items"],
  sentence: ["Everything you need to get started in one place.", "Track progress and share updates with your team.", "Fast, private and works offline.", "Plan the week ahead in a few minutes.", "Pick up right where you left off."],
  price: ["$12.00", "$24.99", "$49.00", "$7.50", "$129.00", "$18.25", "$64.90", "$3.99"],
  date: ["Mar 4, 2027", "Jan 18, 2027", "Nov 30, 2026", "Feb 9, 2027", "Apr 22, 2027", "Dec 12, 2026"],
  time: ["9:30 AM", "11:15 AM", "1:45 PM", "4:00 PM", "6:20 PM", "8:05 AM"],
  phone: ["+1 415 555 0132", "+44 20 7946 0958", "+49 30 901820", "+1 212 555 0198"],
  number: ["12", "248", "1,024", "36", "7", "580", "93"],
  percent: ["12%", "48%", "73%", "5%", "91%", "36%"],
  url: ["example.com", "studio.example.org", "docs.example.net"],
  username: ["@ava", "@liamc", "@maya.p", "@noahk", "@sofia_r", "@ethanb"],
};
const KINDS = Object.keys(DATA);
export const CONTENT_KINDS = Object.freeze(KINDS);

/** The kind of content a text layer looks like it holds (from its text and name). */
export function contentKind(n) {
  const s = `${n.name || ""} ${textOf(n)}`.toLowerCase();
  if (/@[a-z0-9-]+\.[a-z]/.test(s) || /\bemail\b/.test(s)) return "email";
  if (/[$€£]\s?\d|\bprice\b|\btotal\b/.test(s)) return "price";
  if (/\d{1,2}:\d{2}|\btime\b/.test(s)) return "time";
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d|\bdate\b|\d{4}-\d{2}-\d{2}/.test(s)) return "date";
  if (/\d+%|\bpercent\b/.test(s)) return "percent";
  if (/\bphone\b|\+\d/.test(s)) return "phone";
  if (/\b(user ?name|handle)\b|^@/.test(s)) return "username";
  if (/\b(company|organization)\b/.test(s)) return "company";
  if (/\b(city|location)\b/.test(s)) return "city";
  if (/\b(name|author|user)\b/.test(s)) return "name";
  if (/\b(title|heading)\b/.test(s)) return "title";
  if (/^\s*[\d,.]+\s*$/.test(textOf(n))) return "number";
  return textOf(n).split(" ").length > 6 ? "sentence" : "title";
}

/**
 * Fills text layers (the given ones and the text layers inside given frames) with realistic content: `values` in
 * order, or generated data of `kind` (auto: guessed per layer). Deterministic for a `seed`.
 */
export function contentOps(model, ids, { kind = "auto", values = null, seed = 0 } = {}) {
  const ix = indexOf(model);
  const texts = [];
  const add = (id) => {
    const n = model.nodes[id];
    if (!n) throw new Error(`There is no layer “${id}”.`);
    if (n.type === "text") texts.push(id);
    else if (n.type !== "instance") for (const k of ix.get(id)) add(k);
  };
  for (const id of ids) add(id);
  if (!texts.length) throw new Error("No text layers in these layers (text inside instances is changed with proto_component action set or override).");
  if (kind !== "auto" && !DATA[kind]) throw new Error(`Unknown content kind “${kind}”; use auto, ${KINDS.join(", ")}.`);
  const used = new Map();
  const ops = [];
  const filled = [];
  texts.forEach((id, i) => {
    const n = model.nodes[id];
    let t;
    if (Array.isArray(values)) {
      if (i >= values.length) return;
      t = String(values[i] ?? "");
    } else {
      const k = kind === "auto" ? contentKind(n) : kind;
      const list = DATA[k];
      const j = used.get(k) || 0;
      used.set(k, j + 1);
      t = list[(j + seed) % list.length];
    }
    const s0 = isObj(n.text?.runs?.[0]?.s) ? n.text.runs[0].s : {};
    ops.push({ op: "node.update", id, set: { "text.runs": [{ t, s: s0 }] } });
    filled.push(`${id}: ${JSON.stringify(t)}`);
  });
  return { ops, filled };
}

// ------------------------------------------------------------------------------------------------- responsive

/**
 * Lays a frame out at several widths (default: the design's breakpoints and the frame's own width) and reports what
 * overflows the frame horizontally, and text that is cut off. Approximate (the pure solver).
 */
export function responsive(model, id, { widths = null, measurer } = {}) {
  const n = model.nodes[id];
  if (!n) throw new Error(`There is no layer “${id}”.`);
  if (!isContainer(n.type)) throw new Error("Pass a frame or component.");
  const own = n.w?.mode === "fixed" && typeof n.w.value === "number" ? n.w.value : null;
  const list = (widths?.length ? widths : [...new Set([...(model.breakpoints || []).map((b) => b.w), own].filter((x) => typeof x === "number"))]).map(Number).filter((w) => w > 0 && w <= 10000);
  const res = createResolver(model);
  return list.sort((a, b) => b - a).map((width) => {
    const root = res.tree(id);
    root.node = { ...root.node, w: { mode: "fixed", value: width } };
    const { boxes } = layout(root, { measurer, origin: true });
    const overflow = [];
    const clipped = [];
    const rb = boxes.get(root.key);
    walkResolved(root, (r) => {
      const b = boxes.get(r.key);
      if (!b || r === root) return;
      const over = b.x + b.w - (rb.x + rb.w);
      if (over > 1) overflow.push(`${r.key} ${JSON.stringify(r.node.name || r.type)} by ${Math.round(over)} px`);
      if (r.type === "text" && b.lines) {
        const used = b.lines.reduce((s, l) => s + l.h, 0);
        const widest = Math.max(0, ...b.lines.map((l) => l.x + l.w));
        if ((r.node.text?.autoSize === "fixed" && used > b.h + 0.5) || widest > b.w + 1) clipped.push(`${r.key} ${JSON.stringify(clip(textOf(r.node), 30))}`);
      }
      if (overflow.length + clipped.length > 60) return false;
    });
    return { width, height: Math.round(rb?.h || 0), overflow, clipped, ok: !overflow.length && !clipped.length };
  });
}

