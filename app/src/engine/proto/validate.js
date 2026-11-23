// Validation of a Proto model, schema 1 (docs/concepts/proto-studio.md §3). Pure.
//
// Used on open and import, by every operation (ops.js checks the nodes it touched), and later by the MCP server and
// for every remote collaboration record. It checks types and enumerations, references (pages, parents, components,
// variables, styles, media, collections and modes), cycles (parents, component instances, variable aliases, extending
// collections) and the limits of §3.6.
//
// Problems are { severity: "error"|"warning", code, path, message } with English messages. Errors make a model
// invalid; warnings are things a model may contain while it is edited (an interaction that targets a removed frame,
// a fill whose media is missing). Fields the schema does not know are kept and not reported (forward compatibility
// within a schema; the collaboration validator of T10 is stricter for remote records).
//
// Public API
//   validate(model, { limits?, maxProblems? }) → { ok, errors, warnings, truncated }
//   nodeProblems(model, node, { limits? }) → Problem[]   checks of one node against the model (used by ops.js)
//   pageProblems(model, page) → Problem[]
//   isBinding(v) / isColor(v)
import { isKey } from "../../collab/fractional.js";
import { isId } from "./ids.js";
import * as S from "./schema.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;
const PATH_D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const LIB_RE = /^lib:[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
const OVER_PATH_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z][A-Za-z0-9_-]{0,63}){0,31}$/;
const BIND_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}\.[A-Za-z][A-Za-z0-9]{0,31}$/;
const PROP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_ -]{0,63}$/;

/** A variable binding `{ "$var": "<id>" }`. */
export const isBinding = (v) => isObj(v) && typeof v.$var === "string" && Object.keys(v).length === 1;
/** A literal hex color (#rgb, #rgba, #rrggbb, #rrggbbaa). */
export const isColor = (v) => typeof v === "string" && HEX_RE.test(v);

class Report {
  constructor(max) {
    this.errors = [];
    this.warnings = [];
    this.max = max;
    this.truncated = false;
  }
  add(severity, path, code, message) {
    if (this.errors.length + this.warnings.length >= this.max) {
      this.truncated = true;
      return;
    }
    (severity === "error" ? this.errors : this.warnings).push({ severity, code, path, message });
  }
  err(path, code, message) {
    this.add("error", path, code, message);
  }
  warn(path, code, message) {
    this.add("warning", path, code, message);
  }
  get full() {
    return this.truncated;
  }
}

// ------------------------------------------------------------------------------------------------- values

function checkBinding(C, path, v, type) {
  const item = C.model?.vars?.items?.[v.$var];
  if (!isObj(item)) return C.r.err(path, "missing-variable", `The variable “${v.$var}” does not exist.`);
  if (type && item.type !== type) C.r.err(path, "binding-type", `The variable “${v.$var}” is a ${item.type} variable, not a ${type} variable.`);
}

function num(C, path, v, { min = -Infinity, max = Infinity, int = false, binding = true } = {}) {
  if (binding && isBinding(v)) return checkBinding(C, path, v, "number");
  if (!finite(v)) return C.r.err(path, "number", "Expected a finite number.");
  if (v < min || v > max) C.r.err(path, "range", `Expected a number from ${min} to ${max}.`);
  if (int && !Number.isInteger(v)) C.r.err(path, "integer", "Expected a whole number.");
}

function color(C, path, v) {
  if (isBinding(v)) return checkBinding(C, path, v, "color");
  if (!isColor(v)) C.r.err(path, "color", "Expected a hex color (#rrggbb or #rrggbbaa) or a variable binding.");
}

function oneOf(C, path, v, list) {
  if (!list.includes(v)) C.r.err(path, "enum", `Expected one of: ${list.join(", ")}.`);
}

function bool(C, path, v) {
  if (typeof v !== "boolean") C.r.err(path, "bool", "Expected true or false.");
}

function str(C, path, v, { max = 100000, nullable = false } = {}) {
  if (nullable && v === null) return;
  if (typeof v !== "string") return C.r.err(path, "string", "Expected text.");
  if (v.length > max) C.r.err(path, "length", `Text longer than ${max} characters.`);
}

function list(C, path, v, max = C.limits.listItems) {
  if (!Array.isArray(v)) {
    C.r.err(path, "array", "Expected a list.");
    return false;
  }
  if (v.length > max) C.r.err(path, "length", `More than ${max} entries.`);
  return true;
}

function obj(C, path, v) {
  if (!isObj(v)) {
    C.r.err(path, "object", "Expected an object.");
    return false;
  }
  return true;
}

function sizing(C, path, v) {
  if (!obj(C, path, v)) return;
  oneOf(C, `${path}.mode`, v.mode, S.SIZE_MODES);
  if (v.mode === "fixed") num(C, `${path}.value`, v.value, { min: 0 });
  else if (v.mode === "rel") num(C, `${path}.value`, v.value, { min: 0, max: 100, binding: false });
  for (const k of ["min", "max"]) if (v[k] !== undefined && v[k] !== null) num(C, `${path}.${k}`, v[k], { min: 0 });
  if (finite(v.min) && finite(v.max) && v.min > v.max) C.r.err(path, "min-max", "The minimum is larger than the maximum.");
}

function sides(C, path, v, { min = 0 } = {}) {
  if (!Array.isArray(v) || v.length !== 4) return C.r.err(path, "sides", "Expected four values (top, right, bottom, left).");
  v.forEach((x, i) => num(C, `${path}[${i}]`, x, { min }));
}

function track(C, path, t, nested = false) {
  if (!obj(C, path, t)) return;
  const keys = Object.keys(t).filter((k) => ["fr", "px", "auto", "minmax"].includes(k));
  if (keys.length !== 1) return C.r.err(path, "track", "A grid track is one of { fr }, { px }, { auto: true } or { minmax: [min, max] }.");
  const k = keys[0];
  if (k === "fr") num(C, `${path}.fr`, t.fr, { min: 0, binding: false });
  else if (k === "px") num(C, `${path}.px`, t.px, { min: 0 });
  else if (k === "auto") {
    if (t.auto !== true) C.r.err(`${path}.auto`, "track", "Expected true.");
  } else {
    if (nested) return C.r.err(path, "track", "minmax cannot be nested.");
    if (!Array.isArray(t.minmax) || t.minmax.length !== 2) return C.r.err(`${path}.minmax`, "track", "Expected [min, max].");
    t.minmax.forEach((x, i) => (finite(x) ? num(C, `${path}.minmax[${i}]`, x, { min: 0 }) : track(C, `${path}.minmax[${i}]`, x, true)));
  }
}

function layout(C, path, v) {
  if (!obj(C, path, v)) return;
  oneOf(C, `${path}.type`, v.type, S.LAYOUT_TYPES);
  if (v.dir !== undefined) oneOf(C, `${path}.dir`, v.dir, S.DIRECTIONS);
  if (v.wrap !== undefined) bool(C, `${path}.wrap`, v.wrap);
  if (v.reverseZ !== undefined) bool(C, `${path}.reverseZ`, v.reverseZ);
  for (const k of ["gap", "rowGap"]) if (v[k] !== undefined) num(C, `${path}.${k}`, v[k], { min: 0 });
  if (v.pad !== undefined) sides(C, `${path}.pad`, v.pad);
  if (v.align !== undefined) oneOf(C, `${path}.align`, v.align, S.ALIGN);
  if (v.justify !== undefined) oneOf(C, `${path}.justify`, v.justify, S.JUSTIFY);
  if (v.alignContent !== undefined) oneOf(C, `${path}.alignContent`, v.alignContent, S.ALIGN_CONTENT);
  if (v.grid !== undefined && v.grid !== null) {
    const g = v.grid;
    if (!obj(C, `${path}.grid`, g)) return;
    for (const k of ["cols", "rows"]) if (g[k] !== undefined && list(C, `${path}.grid.${k}`, g[k], 1000)) g[k].forEach((t, i) => track(C, `${path}.grid.${k}[${i}]`, t));
    if (g.areas !== undefined && g.areas !== null && list(C, `${path}.grid.areas`, g.areas, 1000)) g.areas.forEach((a, i) => str(C, `${path}.grid.areas[${i}]`, a, { max: 1000 }));
    if (g.autoFlow !== undefined) oneOf(C, `${path}.grid.autoFlow`, g.autoFlow, S.AUTO_FLOW);
    if (g.dense !== undefined) bool(C, `${path}.grid.dense`, g.dense);
  }
  if (v.type === "grid" && !isObj(v.grid)) C.r.err(`${path}.grid`, "grid", "A grid layout needs a grid definition.");
}

function cell(C, path, v) {
  if (v === null) return;
  if (!obj(C, path, v)) return;
  for (const k of ["col", "colSpan", "row", "rowSpan"]) if (v[k] !== undefined) num(C, `${path}.${k}`, v[k], { min: 1, max: 1000, int: true, binding: false });
  for (const k of ["alignSelf", "justifySelf"]) if (v[k] !== undefined) oneOf(C, `${path}.${k}`, v[k], S.SELF_ALIGN);
}

function stops(C, path, v) {
  if (!list(C, path, v, 64)) return;
  if (v.length < 2) C.r.err(path, "stops", "A gradient needs at least two stops.");
  v.forEach((s, i) => {
    if (!obj(C, `${path}[${i}]`, s)) return;
    num(C, `${path}[${i}].at`, s.at, { min: 0, max: 1, binding: false });
    color(C, `${path}[${i}].color`, s.color);
  });
}

function fill(C, path, f) {
  if (!obj(C, path, f)) return;
  oneOf(C, `${path}.type`, f.type, S.FILL_TYPES);
  if (f.opacity !== undefined) num(C, `${path}.opacity`, f.opacity, { min: 0, max: 1 });
  if (f.visible !== undefined) bool(C, `${path}.visible`, f.visible);
  if (f.type === "solid") color(C, `${path}.color`, f.color);
  else if (f.type === "linear" || f.type === "radial" || f.type === "conic") {
    if (f.angle !== undefined) num(C, `${path}.angle`, f.angle, { binding: false });
    if (f.center !== undefined) pair(C, `${path}.center`, f.center);
    stops(C, `${path}.stops`, f.stops);
  } else if (f.type === "image") {
    if (typeof f.media !== "string") C.r.err(`${path}.media`, "string", "Expected a media id.");
    else if (!isObj(C.model?.media?.[f.media])) C.r.warn(`${path}.media`, "missing-media", `The media “${f.media}” is not in the document.`);
    if (f.fit !== undefined) oneOf(C, `${path}.fit`, f.fit, S.IMAGE_FIT);
    if (f.pos !== undefined) pair(C, `${path}.pos`, f.pos);
  }
}

function pair(C, path, v) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(finite)) C.r.err(path, "pair", "Expected two numbers.");
}

function stroke(C, path, s) {
  if (!obj(C, path, s)) return;
  color(C, `${path}.color`, s.color);
  num(C, `${path}.w`, s.w, { min: 0, max: 10000 });
  if (s.align !== undefined) oneOf(C, `${path}.align`, s.align, S.STROKE_ALIGN);
  if (s.dash !== undefined && s.dash !== null && list(C, `${path}.dash`, s.dash, 16)) s.dash.forEach((d, i) => num(C, `${path}.dash[${i}]`, d, { min: 0, binding: false }));
  if (s.sides !== undefined && s.sides !== null) sides(C, `${path}.sides`, s.sides);
}

function effect(C, path, e) {
  if (!obj(C, path, e)) return;
  oneOf(C, `${path}.type`, e.type, S.EFFECT_TYPES);
  if (e.visible !== undefined) bool(C, `${path}.visible`, e.visible);
  if (e.type === "shadow") {
    for (const k of ["x", "y", "spread"]) if (e[k] !== undefined) num(C, `${path}.${k}`, e[k]);
    num(C, `${path}.blur`, e.blur ?? 0, { min: 0 });
    color(C, `${path}.color`, e.color);
    if (e.inset !== undefined) bool(C, `${path}.inset`, e.inset);
  } else if (e.type === "blur" || e.type === "backgroundBlur") num(C, `${path}.radius`, e.radius, { min: 0 });
}

function radius(C, path, v) {
  if (Array.isArray(v)) sides(C, path, v);
  else num(C, path, v, { min: 0 });
}

function textStyle(C, path, s, partial) {
  if (!obj(C, path, s)) return;
  if (s.font !== undefined) str(C, `${path}.font`, s.font, { max: 256 });
  if (s.size !== undefined) num(C, `${path}.size`, s.size, { min: 0.5, max: 10000 });
  if (s.weight !== undefined) num(C, `${path}.weight`, s.weight, { min: 1, max: 1000 });
  if (s.italic !== undefined) bool(C, `${path}.italic`, s.italic);
  if (s.lineHeight !== undefined && s.lineHeight !== "auto") {
    const lh = s.lineHeight;
    if (isObj(lh) && finite(lh.pct)) num(C, `${path}.lineHeight.pct`, lh.pct, { min: 0, max: 1000, binding: false });
    else if (isObj(lh) && lh.px !== undefined) num(C, `${path}.lineHeight.px`, lh.px, { min: 0 });
    else C.r.err(`${path}.lineHeight`, "line-height", "Expected \"auto\", { pct } or { px }.");
  }
  if (s.tracking !== undefined) num(C, `${path}.tracking`, s.tracking);
  if (s.align !== undefined) oneOf(C, `${path}.align`, s.align, S.TEXT_ALIGN);
  if (s.case !== undefined) oneOf(C, `${path}.case`, s.case, S.TEXT_CASE);
  if (s.decoration !== undefined) oneOf(C, `${path}.decoration`, s.decoration, S.TEXT_DECORATION);
  if (s.color !== undefined) color(C, `${path}.color`, s.color);
  if (!partial && s.font === undefined) C.r.err(`${path}.font`, "required", "A text style needs a font.");
}

function text(C, path, t) {
  if (!obj(C, path, t)) return;
  if (list(C, `${path}.runs`, t.runs, 10000))
    t.runs.forEach((r, i) => {
      if (!obj(C, `${path}.runs[${i}]`, r)) return;
      if (isBinding(r.t)) checkBinding(C, `${path}.runs[${i}].t`, r.t, "string");
      else str(C, `${path}.runs[${i}].t`, r.t);
      if (r.s !== undefined) textStyle(C, `${path}.runs[${i}].s`, r.s, true);
    });
  if (t.style !== undefined) textStyle(C, `${path}.style`, t.style, false);
  if (t.autoSize !== undefined) oneOf(C, `${path}.autoSize`, t.autoSize, S.TEXT_AUTOSIZE);
  if (t.maxLines !== undefined && t.maxLines !== null) num(C, `${path}.maxLines`, t.maxLines, { min: 1, max: 10000, int: true, binding: false });
}

function styleRefs(C, path, v) {
  if (v === null) return;
  if (!obj(C, path, v)) return;
  for (const [slot, id] of Object.entries(v)) {
    const kind = S.STYLE_SLOTS[slot];
    if (!kind) continue;
    if (id === null) continue;
    const s = C.model?.styles?.[id];
    if (!isObj(s)) C.r.err(`${path}.${slot}`, "missing-style", `The style “${id}” does not exist.`);
    else if (s.kind !== kind) C.r.err(`${path}.${slot}`, "style-kind", `The style “${id}” is a ${s.kind} style, not a ${kind} style.`);
  }
}

function modesMap(C, path, v) {
  if (v === null) return;
  if (!obj(C, path, v)) return;
  for (const [coll, mode] of Object.entries(v)) {
    const c = C.model?.vars?.collections?.[coll];
    if (!isObj(c)) C.r.err(`${path}.${coll}`, "missing-collection", `The variable collection “${coll}” does not exist.`);
    else if (!Array.isArray(c.modes) || !c.modes.some((m) => m?.id === mode)) C.r.err(`${path}.${coll}`, "missing-mode", `The collection “${coll}” has no mode “${mode}”.`);
  }
}

function interactions(C, path, v) {
  if (!list(C, path, v, 256)) return;
  v.forEach((it, i) => {
    const p = `${path}[${i}]`;
    if (!obj(C, p, it)) return;
    if (obj(C, `${p}.on`, it.on)) oneOf(C, `${p}.on.type`, it.on.type, S.TRIGGERS);
    actions(C, `${p}.do`, it.do, 0);
  });
}

function actions(C, path, v, depth) {
  if (!list(C, path, v, 64)) return;
  if (depth > 16) return C.r.err(path, "depth", "Conditions are nested too deeply.");
  v.forEach((a, i) => {
    const p = `${path}[${i}]`;
    if (!obj(C, p, a)) return;
    oneOf(C, `${p}.act`, a.act, S.ACTIONS);
    if (typeof a.to === "string" && !isObj(C.model?.nodes?.[a.to])) C.r.warn(`${p}.to`, "missing-target", `The interaction target “${a.to}” does not exist.`);
    if (a.act === "if") {
      actions(C, `${p}.then`, a.then ?? [], depth + 1);
      actions(C, `${p}.else`, a.else ?? [], depth + 1);
    }
  });
}

function propDefs(C, path, v) {
  if (!obj(C, path, v)) return;
  const names = Object.keys(v);
  if (names.length > 256) C.r.err(path, "length", "More than 256 properties.");
  for (const name of names) {
    const p = `${path}.${name}`;
    const d = v[name];
    if (!PROP_NAME_RE.test(name)) C.r.err(p, "prop-name", "Property names are letters, digits, spaces, “-” and “_” (up to 64).");
    if (!obj(C, p, d)) continue;
    oneOf(C, `${p}.type`, d.type, S.PROP_TYPES);
    if (d.type === "variant") {
      if (list(C, `${p}.options`, d.options, C.limits.variantOptions)) {
        if (!d.options.length) C.r.err(`${p}.options`, "options", "A variant property needs at least one option.");
        d.options.forEach((o, i) => str(C, `${p}.options[${i}]`, o, { max: 128 }));
        if (new Set(d.options).size !== d.options.length) C.r.err(`${p}.options`, "duplicate", "Variant options must be unique.");
        if (d.default !== undefined && !d.options.includes(d.default)) C.r.err(`${p}.default`, "enum", "The default is not one of the options.");
      }
    } else if (d.type === "text" && d.default !== undefined) str(C, `${p}.default`, d.default);
    else if (d.type === "bool" && d.default !== undefined) bool(C, `${p}.default`, d.default);
    else if (d.type === "number" && d.default !== undefined) num(C, `${p}.default`, d.default, { binding: false });
    else if (d.type === "swap") {
      for (const id of [d.default, ...(Array.isArray(d.preferred) ? d.preferred : [])]) if (id !== undefined && id !== null && !isComponentRef(C.model, id)) C.r.err(`${p}`, "missing-component", `The component “${id}” does not exist.`);
      if (d.preferred !== undefined) list(C, `${p}.preferred`, d.preferred, 256);
    }
  }
}

const isComponentRef = (model, id) => {
  if (typeof id !== "string") return false;
  if (LIB_RE.test(id)) return true;
  const n = model?.nodes?.[id];
  return isObj(n) && (n.type === "component" || n.type === "componentSet");
};

/** The property definitions an instance of `of` (a component or set) can set. */
function propsOfTarget(model, id) {
  const n = model?.nodes?.[id];
  if (!isObj(n)) return null;
  if (n.type === "componentSet") return isObj(n.props) ? n.props : {};
  if (n.type === "component") {
    const set = n.parent != null ? model.nodes[n.parent] : null;
    if (isObj(set) && set.type === "componentSet") return isObj(set.props) ? set.props : {};
    return isObj(n.props) ? n.props : {};
  }
  return null;
}

function variantValues(C, path, v, defs) {
  if (!obj(C, path, v)) return;
  for (const [axis, value] of Object.entries(v)) {
    const d = defs?.[axis];
    if (!isObj(d) || d.type !== "variant") C.r.err(`${path}.${axis}`, "missing-prop", `There is no variant property “${axis}”.`);
    else if (!Array.isArray(d.options) || !d.options.includes(value)) C.r.err(`${path}.${axis}`, "enum", `“${value}” is not an option of “${axis}”.`);
  }
}

function componentFields(C, path, n) {
  if (n.props !== undefined) {
    if (n.type === "componentSet" || n.type === "component") propDefs(C, `${path}.props`, n.props);
    else if (n.type === "instance") {
      if (obj(C, `${path}.props`, n.props)) {
        const defs = propsOfTarget(C.model, n.of);
        if (defs)
          for (const [k, val] of Object.entries(n.props)) {
            const d = defs[k];
            if (!isObj(d)) C.r.err(`${path}.props.${k}`, "missing-prop", `The component has no property “${k}”.`);
            else if (d.type === "text" && !isBinding(val)) str(C, `${path}.props.${k}`, val);
            else if (d.type === "bool" && !isBinding(val)) bool(C, `${path}.props.${k}`, val);
            else if (d.type === "number") num(C, `${path}.props.${k}`, val);
            else if (d.type === "swap" && !isComponentRef(C.model, val)) C.r.err(`${path}.props.${k}`, "missing-component", `The component “${val}” does not exist.`);
            else if (d.type === "variant") C.r.err(`${path}.props.${k}`, "variant-prop", "Variant values belong in `variant`.");
          }
      }
    } else C.r.err(`${path}.props`, "props", "Only components, component sets and instances have properties.");
  }
  if (n.variant !== undefined) {
    if (n.type === "component") {
      const set = n.parent != null ? C.model.nodes[n.parent] : null;
      if (!isObj(set) || set.type !== "componentSet") C.r.err(`${path}.variant`, "variant", "Only a component inside a component set has variant values.");
      else variantValues(C, `${path}.variant`, n.variant, set.props);
    } else if (n.type === "instance") {
      const defs = propsOfTarget(C.model, n.of);
      if (defs) variantValues(C, `${path}.variant`, n.variant, defs);
    }
    else C.r.err(`${path}.variant`, "variant", "Only components and instances have variant values.");
  }
  if (n.bind !== undefined) {
    if (n.type !== "component" && n.type !== "componentSet") C.r.err(`${path}.bind`, "bind", "Only components bind properties.");
    else if (obj(C, `${path}.bind`, n.bind)) {
      const defs = propsOfTarget(C.model, n.id) || {};
      for (const [key, prop] of Object.entries(n.bind)) {
        if (!BIND_KEY_RE.test(key)) C.r.err(`${path}.bind`, "bind-key", `“${key}” is not a <nodeId>.<field> key.`);
        if (!isObj(defs[prop])) C.r.err(`${path}.bind.${key}`, "missing-prop", `There is no property “${prop}”.`);
      }
    }
  }
  if (n.type === "instance") {
    if (!isComponentRef(C.model, n.of)) C.r.err(`${path}.of`, "missing-component", `The component “${n.of}” does not exist.`);
  } else if (n.of !== undefined) C.r.err(`${path}.of`, "of", "Only instances reference a component.");
  if (n.over !== undefined) {
    if (n.type !== "instance") C.r.err(`${path}.over`, "over", "Only instances have overrides.");
    else if (obj(C, `${path}.over`, n.over))
      for (const [k, val] of Object.entries(n.over)) {
        if (!OVER_PATH_RE.test(k)) C.r.err(`${path}.over`, "over-path", `“${k}” is not a path of node ids.`);
        if (!isObj(val)) C.r.err(`${path}.over.${k}`, "object", "Expected an object of overridden fields.");
        else for (const f of Object.keys(val)) if (S.STRUCTURE_FIELDS.includes(f)) C.r.err(`${path}.over.${k}.${f}`, "over-field", `“${f}” cannot be overridden.`);
      }
  }
}

// ------------------------------------------------------------------------------------------------- nodes and pages

/**
 * Problems of one node in the context of `model` (references are looked up there). Does not check cycles and depth,
 * which need the whole tree (validate) or are prevented by the operation itself (ops.js).
 */
export function nodeProblems(model, n, { limits = S.LIMITS } = {}) {
  const r = new Report(200);
  checkNode({ model, r, limits }, n, `nodes.${n?.id}`);
  return [...r.errors, ...r.warnings];
}

function checkNode(C, n, path) {
  if (!isObj(n)) return C.r.err(path, "object", "Expected a node object.");
  if (!isId(n.id)) C.r.err(`${path}.id`, "id", "Expected a node id.");
  if (!S.NODE_TYPES.includes(n.type)) return C.r.err(`${path}.type`, "enum", `Unknown node type “${n.type}”.`);
  str(C, `${path}.name`, n.name, { max: C.limits.nameLength });
  if (!isObj(C.model?.pages?.[n.page])) C.r.err(`${path}.page`, "missing-page", `The page “${n.page}” does not exist.`);
  if (n.parent !== null) {
    const p = C.model?.nodes?.[n.parent];
    if (typeof n.parent !== "string" || !isObj(p)) C.r.err(`${path}.parent`, "missing-parent", `The parent “${n.parent}” does not exist.`);
    else {
      if (!S.isContainer(p.type)) C.r.err(`${path}.parent`, "parent-type", `A ${p.type} cannot contain other layers.`);
      if (p.page !== n.page) C.r.err(`${path}.page`, "page-mismatch", "A layer must be on the page of its parent.");
      if (p.type === "componentSet" && n.type !== "component") C.r.err(`${path}.parent`, "set-child", "A component set contains only components.");
    }
  }
  if (!isKey(n.ord)) C.r.err(`${path}.ord`, "ord", "Expected a fractional order key.");
  if (n.visible !== undefined) bool(C, `${path}.visible`, n.visible);
  if (n.locked !== undefined) bool(C, `${path}.locked`, n.locked);
  if (n.opacity !== undefined) num(C, `${path}.opacity`, n.opacity, { min: 0, max: 1 });
  if (n.blend !== undefined) oneOf(C, `${path}.blend`, n.blend, S.BLENDS);
  for (const k of ["x", "y", "rot"]) if (n[k] !== undefined) num(C, `${path}.${k}`, n[k], { min: -1e7, max: 1e7, binding: false });
  for (const k of ["w", "h"]) if (n[k] !== undefined) sizing(C, `${path}.${k}`, n[k]);
  if (n.pos !== undefined) oneOf(C, `${path}.pos`, n.pos, S.POSITIONS);
  if (n.cx !== undefined) oneOf(C, `${path}.cx`, n.cx, S.CONSTRAINTS_X);
  if (n.cy !== undefined) oneOf(C, `${path}.cy`, n.cy, S.CONSTRAINTS_Y);
  if (n.cell !== undefined) cell(C, `${path}.cell`, n.cell);
  if (n.sticky !== undefined && n.sticky !== null) oneOf(C, `${path}.sticky`, n.sticky, S.STICKY);
  if (n.tag !== undefined && n.tag !== null && (typeof n.tag !== "string" || !TAG_RE.test(n.tag))) C.r.err(`${path}.tag`, "tag", "Expected an HTML element name.");
  if (n.a11y !== undefined && n.a11y !== null && obj(C, `${path}.a11y`, n.a11y)) {
    if (n.a11y.label !== undefined) str(C, `${path}.a11y.label`, n.a11y.label, { max: 1000, nullable: true });
    if (n.a11y.role !== undefined) str(C, `${path}.a11y.role`, n.a11y.role, { max: 64, nullable: true });
  }
  if (n.modes !== undefined) modesMap(C, `${path}.modes`, n.modes);
  if (n.layout !== undefined) {
    if (!S.isContainer(n.type)) C.r.err(`${path}.layout`, "layout", `A ${n.type} has no layout.`);
    else layout(C, `${path}.layout`, n.layout);
  }
  if (n.clip !== undefined) bool(C, `${path}.clip`, n.clip);
  if (n.scroll !== undefined) oneOf(C, `${path}.scroll`, n.scroll, S.SCROLL);
  if (n.fills !== undefined && list(C, `${path}.fills`, n.fills)) n.fills.forEach((f, i) => fill(C, `${path}.fills[${i}]`, f));
  if (n.strokes !== undefined && list(C, `${path}.strokes`, n.strokes)) n.strokes.forEach((s, i) => stroke(C, `${path}.strokes[${i}]`, s));
  if (n.radius !== undefined) radius(C, `${path}.radius`, n.radius);
  if (n.effects !== undefined && list(C, `${path}.effects`, n.effects)) n.effects.forEach((e, i) => effect(C, `${path}.effects[${i}]`, e));
  if (n.style !== undefined) styleRefs(C, `${path}.style`, n.style);
  if (n.text !== undefined) {
    if (n.type !== "text") C.r.err(`${path}.text`, "text", "Only text layers have text.");
    else text(C, `${path}.text`, n.text);
  } else if (n.type === "text") C.r.err(`${path}.text`, "required", "A text layer needs text.");
  if (n.d !== undefined || n.rule !== undefined) {
    if (n.type !== "vector") C.r.err(`${path}.d`, "vector", "Only vector layers have path data.");
    if (n.d !== undefined) {
      str(C, `${path}.d`, n.d, { max: 1000000 });
      if (typeof n.d === "string" && !PATH_D_RE.test(n.d)) C.r.err(`${path}.d`, "path", "Path data may contain only SVG path commands and numbers.");
    }
    if (n.rule !== undefined) oneOf(C, `${path}.rule`, n.rule, S.FILL_RULES);
  }
  if (n.alt !== undefined) str(C, `${path}.alt`, n.alt, { max: 1000 });
  componentFields(C, path, n);
  if (n.code !== undefined && n.code !== null) obj(C, `${path}.code`, n.code);
  if (n.proto !== undefined) interactions(C, `${path}.proto`, n.proto);
  // collaboration records carry a node's fields in a few groups; one node must stay well below the record limit
  const json = JSON.stringify(n);
  if (json.length * 3 > C.limits.recordBytes && new TextEncoder().encode(json).length > C.limits.recordBytes) C.r.err(path, "too-large", `The layer is larger than ${Math.round(C.limits.recordBytes / 1024)} KiB.`);
}

/** Problems of one page. */
export function pageProblems(model, page, { limits = S.LIMITS } = {}) {
  const r = new Report(200);
  checkPage({ model, r, limits }, page, `pages.${page?.id}`);
  return [...r.errors, ...r.warnings];
}

function checkPage(C, p, path) {
  if (!isObj(p)) return C.r.err(path, "object", "Expected a page object.");
  if (!isId(p.id)) C.r.err(`${path}.id`, "id", "Expected a page id.");
  str(C, `${path}.name`, p.name, { max: C.limits.nameLength });
  if (!isKey(p.ord)) C.r.err(`${path}.ord`, "ord", "Expected a fractional order key.");
  if (p.bg !== undefined && p.bg !== null) color(C, `${path}.bg`, p.bg);
  if (p.modes !== undefined) modesMap(C, `${path}.modes`, p.modes);
  if (p.flows !== undefined && list(C, `${path}.flows`, p.flows, 256)) {
    const ids = new Set();
    p.flows.forEach((f, i) => {
      const fp = `${path}.flows[${i}]`;
      if (!obj(C, fp, f)) return;
      if (!isId(f.id)) C.r.err(`${fp}.id`, "id", "Expected a flow id.");
      else if (ids.has(f.id)) C.r.err(`${fp}.id`, "duplicate", `The flow id “${f.id}” is used twice.`);
      ids.add(f.id);
      str(C, `${fp}.name`, f.name, { max: C.limits.nameLength });
      const start = C.model?.nodes?.[f.start];
      if (!isObj(start)) C.r.warn(`${fp}.start`, "missing-target", `The flow starts at “${f.start}”, which does not exist.`);
      else if (start.page !== p.id) C.r.warn(`${fp}.start`, "flow-page", "The flow starts on another page.");
    });
  }
}

// ------------------------------------------------------------------------------------------------- whole model

/**
 * Validates a whole model.
 * @param {object} model
 * @param {{ limits?: typeof S.LIMITS, maxProblems?: number }} [o]
 * @returns {{ ok: boolean, errors: object[], warnings: object[], truncated: boolean }}
 */
export function validate(model, { limits = S.LIMITS, maxProblems = 1000 } = {}) {
  const r = new Report(maxProblems);
  const C = { model, r, limits };
  const done = () => ({ ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings, truncated: r.truncated });
  if (!isObj(model)) {
    r.err("", "object", "The design is not an object.");
    return done();
  }
  if (model.schema !== S.SCHEMA_VERSION) r.err("schema", "schema", `Expected schema ${S.SCHEMA_VERSION}, found ${JSON.stringify(model.schema)} (migrate first).`);
  if (obj(C, "meta", model.meta)) {
    for (const k of ["title", "created", "unit", "app"]) if (model.meta[k] !== undefined) str(C, `meta.${k}`, model.meta[k], { max: 1000 });
    if (model.meta.unit !== undefined && model.meta.unit !== "px") r.err("meta.unit", "enum", "The unit of schema 1 is px.");
  }
  // pages
  if (obj(C, "pages", model.pages)) {
    const ids = Object.keys(model.pages);
    if (!ids.length) r.err("pages", "no-pages", "A design needs at least one page.");
    if (ids.length > limits.pages) r.err("pages", "limit", `More than ${limits.pages} pages.`);
    for (const id of ids) {
      if (model.pages[id]?.id !== id) r.err(`pages.${id}.id`, "id-key", "The page id does not match its key.");
      checkPage(C, model.pages[id], `pages.${id}`);
    }
  }
  vars(C);
  styles(C);
  if (model.breakpoints !== undefined && list(C, "breakpoints", model.breakpoints, 32)) {
    const ids = new Set();
    model.breakpoints.forEach((b, i) => {
      if (!obj(C, `breakpoints[${i}]`, b)) return;
      if (!isId(b.id)) r.err(`breakpoints[${i}].id`, "id", "Expected a breakpoint id.");
      else if (ids.has(b.id)) r.err(`breakpoints[${i}].id`, "duplicate", `The breakpoint “${b.id}” is listed twice.`);
      ids.add(b.id);
      num(C, `breakpoints[${i}].w`, b.w, { min: 1, max: 100000, binding: false });
    });
  }
  if (model.code !== undefined && obj(C, "code", model.code)) {
    if (model.code.links !== undefined) obj(C, "code.links", model.code.links);
    if (model.code.tokensFile !== undefined) str(C, "code.tokensFile", model.code.tokensFile, { max: 4096, nullable: true });
  }
  media(C);
  // nodes
  if (!obj(C, "nodes", model.nodes)) return done();
  const ids = Object.keys(model.nodes);
  if (ids.length > limits.nodes) {
    r.err("nodes", "limit", `More than ${limits.nodes} layers.`);
    return done();
  }
  for (const id of ids) {
    if (r.full) break;
    const n = model.nodes[id];
    if (isObj(n) && n.id !== id) r.err(`nodes.${id}.id`, "id-key", "The layer id does not match its key.");
    checkNode(C, n, `nodes.${id}`);
  }
  tree(C, ids);
  componentCycles(C, ids);
  return done();
}

/** Parent cycles and nesting depth, in O(n) with memoized depths. */
function tree(C, ids) {
  const nodes = C.model.nodes;
  const depth = new Map();
  for (const id of ids) {
    if (depth.has(id)) continue;
    const chain = [];
    const onChain = new Set();
    let cur = id;
    let base = -1;
    while (true) {
      if (depth.has(cur)) {
        base = depth.get(cur);
        break;
      }
      if (onChain.has(cur)) {
        C.r.err(`nodes.${cur}.parent`, "cycle", "The layer is inside itself (a parent cycle).");
        for (const c of chain) depth.set(c, Infinity);
        chain.length = 0;
        break;
      }
      const n = nodes[cur];
      if (!isObj(n)) break;
      chain.push(cur);
      onChain.add(cur);
      if (n.parent == null || !isObj(nodes[n.parent])) break;
      cur = n.parent;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      base = base === Infinity ? Infinity : base + 1;
      depth.set(chain[i], base);
      if (base === C.limits.depth) C.r.err(`nodes.${chain[i]}`, "depth", `Layers are nested more than ${C.limits.depth} levels deep.`);
    }
  }
}

/** Component cycle problems of a whole model (used by ops.js after changes to components and instances). */
export function componentCycleProblems(model) {
  const r = new Report(20);
  if (isObj(model?.nodes)) componentCycles({ model, r, limits: S.LIMITS }, Object.keys(model.nodes));
  return r.errors;
}

/** Instances must not (directly or through other components) contain the component they show. */
function componentCycles(C, ids) {
  const nodes = C.model.nodes;
  const edges = new Map();
  for (const id of ids) {
    const n = nodes[id];
    if (!isObj(n) || n.type !== "instance" || typeof n.of !== "string" || !isObj(nodes[n.of])) continue;
    const seen = new Set([id]);
    let p = n.parent;
    while (p != null && isObj(nodes[p]) && !seen.has(p)) {
      seen.add(p);
      const a = nodes[p];
      if (a.type === "component" || a.type === "componentSet") {
        if (!edges.has(p)) edges.set(p, new Set());
        edges.get(p).add(n.of);
      }
      p = a.parent;
    }
  }
  // a set is an owner of every instance inside its variants, so an instance of the set inside one of them is a loop
  const targets = (id) => edges.get(id) || [];
  const state = new Map();
  const visit = (id, stack) => {
    state.set(id, 1);
    for (const t of targets(id)) {
      if (state.get(t) === 1) {
        C.r.err(`nodes.${stack[0] ?? id}`, "component-cycle", `The component “${t}” contains an instance of itself.`);
        continue;
      }
      if (!state.has(t)) visit(t, [...stack, t]);
    }
    state.set(id, 2);
  };
  for (const id of edges.keys()) if (!state.has(id)) visit(id, [id]);
}

function vars(C) {
  const { model, r } = C;
  if (model.vars === undefined) return;
  if (!obj(C, "vars", model.vars)) return;
  const colls = model.vars.collections ?? {};
  const items = model.vars.items ?? {};
  if (!obj(C, "vars.collections", colls) || !obj(C, "vars.items", items)) return;
  for (const [id, c] of Object.entries(colls)) {
    const p = `vars.collections.${id}`;
    if (!isId(id)) r.err(p, "id", "Expected a collection id.");
    if (!obj(C, p, c)) continue;
    str(C, `${p}.name`, c.name, { max: C.limits.nameLength });
    if (list(C, `${p}.modes`, c.modes, C.limits.modesPerCollection)) {
      if (!c.modes.length) r.err(`${p}.modes`, "modes", "A collection needs at least one mode.");
      const ids = new Set();
      c.modes.forEach((m, i) => {
        if (!obj(C, `${p}.modes[${i}]`, m)) return;
        if (!isId(m.id)) r.err(`${p}.modes[${i}].id`, "id", "Expected a mode id.");
        else if (ids.has(m.id)) r.err(`${p}.modes[${i}].id`, "duplicate", `The mode “${m.id}” is listed twice.`);
        ids.add(m.id);
        str(C, `${p}.modes[${i}].name`, m.name, { max: C.limits.nameLength });
      });
      if (c.default !== undefined && !ids.has(c.default)) r.err(`${p}.default`, "missing-mode", `The default mode “${c.default}” does not exist.`);
    }
    if (c.extends !== undefined && c.extends !== null) {
      if (!isObj(colls[c.extends])) r.err(`${p}.extends`, "missing-collection", `The collection “${c.extends}” does not exist.`);
      else {
        const seen = new Set([id]);
        let cur = c.extends;
        while (cur != null && isObj(colls[cur])) {
          if (seen.has(cur)) {
            r.err(`${p}.extends`, "cycle", "Collections extend each other in a cycle.");
            break;
          }
          seen.add(cur);
          cur = colls[cur].extends;
        }
      }
    }
  }
  const perColl = {};
  for (const [id, v] of Object.entries(items)) {
    const p = `vars.items.${id}`;
    if (!isId(id)) r.err(p, "id", "Expected a variable id.");
    if (!obj(C, p, v)) continue;
    str(C, `${p}.name`, v.name, { max: C.limits.nameLength });
    oneOf(C, `${p}.type`, v.type, S.VAR_TYPES);
    if (v.unit !== undefined && v.unit !== null) oneOf(C, `${p}.unit`, v.unit, S.VAR_UNITS);
    if (v.scopes !== undefined && list(C, `${p}.scopes`, v.scopes, 32)) v.scopes.forEach((s, i) => str(C, `${p}.scopes[${i}]`, s, { max: 64 }));
    if (v.code !== undefined && v.code !== null) obj(C, `${p}.code`, v.code);
    const c = colls[v.coll];
    if (!isObj(c)) {
      r.err(`${p}.coll`, "missing-collection", `The collection “${v.coll}” does not exist.`);
      continue;
    }
    perColl[v.coll] = (perColl[v.coll] || 0) + 1;
    if (!obj(C, `${p}.values`, v.values)) continue;
    const modes = new Set(Array.isArray(c.modes) ? c.modes.map((m) => m?.id) : []);
    for (const [mode, val] of Object.entries(v.values)) {
      const vp = `${p}.values.${mode}`;
      if (!modes.has(mode)) r.warn(vp, "missing-mode", `The collection has no mode “${mode}”.`);
      if (isBinding(val)) {
        const t = items[val.$var];
        if (!isObj(t)) r.err(vp, "missing-variable", `The variable “${val.$var}” does not exist.`);
        else if (t.type !== v.type) r.err(vp, "binding-type", `An alias must point to a ${v.type} variable.`);
      } else if (v.type === "color") color(C, vp, val);
      else if (v.type === "number") num(C, vp, val, { binding: false });
      else if (v.type === "string") str(C, vp, val);
      else if (v.type === "bool") bool(C, vp, val);
    }
  }
  for (const [coll, n] of Object.entries(perColl)) if (n > C.limits.varsPerCollection) r.err(`vars.collections.${coll}`, "limit", `More than ${C.limits.varsPerCollection} variables in one collection.`);
  // alias cycles
  const state = new Map();
  const visit = (id) => {
    state.set(id, 1);
    for (const val of Object.values(isObj(items[id]?.values) ? items[id].values : {})) {
      if (!isBinding(val) || !isObj(items[val.$var])) continue;
      const t = val.$var;
      if (state.get(t) === 1) r.err(`vars.items.${id}`, "alias-cycle", `The variable “${id}” is an alias of itself (through “${t}”).`);
      else if (!state.has(t)) visit(t);
    }
    state.set(id, 2);
  };
  for (const id of Object.keys(items)) if (!state.has(id)) visit(id);
}

function styles(C) {
  const { model, r } = C;
  if (model.styles === undefined) return;
  if (!obj(C, "styles", model.styles)) return;
  for (const [id, s] of Object.entries(model.styles)) {
    const p = `styles.${id}`;
    if (!isId(id)) r.err(p, "id", "Expected a style id.");
    if (!obj(C, p, s)) continue;
    str(C, `${p}.name`, s.name, { max: C.limits.nameLength });
    oneOf(C, `${p}.kind`, s.kind, S.STYLE_KINDS);
    if (s.kind === "text") textStyle(C, `${p}.value`, s.value, true);
    else if (s.kind === "effect" && list(C, `${p}.value`, s.value)) s.value.forEach((e, i) => effect(C, `${p}.value[${i}]`, e));
    else if (s.kind === "fill" && list(C, `${p}.value`, s.value)) s.value.forEach((f, i) => fill(C, `${p}.value[${i}]`, f));
    else if (s.kind === "grid") obj(C, `${p}.value`, s.value);
  }
}

function media(C) {
  const { model, r } = C;
  if (model.media === undefined) return;
  if (!obj(C, "media", model.media)) return;
  for (const [id, m] of Object.entries(model.media)) {
    const p = `media.${id}`;
    if (!isId(id)) r.err(p, "id", "Expected a media id.");
    if (!obj(C, p, m)) continue;
    if (!S.MEDIA_TYPES.includes(m.mime)) r.err(`${p}.mime`, "mime", `Media of type “${m.mime}” is not supported.`);
    if (m.name !== undefined) str(C, `${p}.name`, m.name, { max: 1000 });
    for (const k of ["w", "h"]) if (m[k] !== undefined) num(C, `${p}.${k}`, m[k], { min: 0, max: 100000, binding: false });
    if (m.bytes && typeof m.bytes.length === "number" && m.bytes.length > C.limits.mediaBytes) r.err(`${p}.bytes`, "limit", `The media is larger than ${C.limits.mediaBytes / 1048576} MiB.`);
  }
}
