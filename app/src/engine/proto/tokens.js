// Design tokens: W3C Design Tokens Community Group (DTCG) format 2025.10 import and export, and the CSS custom
// properties, Tailwind v4 `@theme` and Swift exports of a Proto design's variables and styles
// (docs/concepts/proto-studio.md §3.4, task T5). Pure: no DOM, imports in plain Node.
//
// Export (`exportTokens`): one JSON document. Variable names become token paths ("color/bg/surface" →
// color.bg.surface); a name that is also a group ("color/brand" next to "color/brand/bright") is the group's `$root`
// token. `$value` holds the value in the collection's default mode; the other modes are in
// `$extensions["org.openfini.modes"]` (by mode id) and the overrides of extending collections in
// `$extensions["org.openfini"].ext`. Collections and their modes are listed in the root group's
// `$extensions["org.openfini"].collections`, so an export imports back into the same variables (the round trip is
// tested). Aliases are `"{color.brand}"` references. Types: color → `color` (sRGB object with hex), number with px →
// `dimension`, with ms → `duration`, without a unit → `number`; strings and booleans have no DTCG type and carry
// `$extensions["org.openfini"].type`. Styles are composite tokens: text → `typography`, shadows → `shadow`, one
// linear gradient → `gradient`, one solid fill → `color`; the exact style is always in
// `$extensions["org.openfini"].style` (blur effects and grid styles have no DTCG type). `{ mode }` exports one mode
// per file (plain DTCG for other tools: no mode extensions).
//
// Import (`importTokens`, operation `tokens.import`): any DTCG file (2025.10 objects or the older string forms such as
// "#ff0000", "16px", "200ms"), `$type` inherited from groups, `$root` tokens, group `$extends`, `{a.b}` and
// `{ "$ref": "#/a/b" }` aliases. Tokens merge by name into a collection: the collection of the OpenFini extensions,
// else `opts.collection` (default "Tokens"), created when missing; values go to `opts.mode` (created when missing; one
// file per mode imports as one call per file) or to the collection's default mode. Types without a variable or style
// meaning (cubicBezier, strokeStyle, border, transition), colors in spaces other than sRGB without a hex fallback and
// unresolvable aliases are skipped and listed in the report.
//
// Public API
//   exportTokens(model, { mode? }) → object       importTokens(model, json, opts?) → { plan, report }
//   tokensCss(model, opts?) → string               tokensTailwind(model) → string        tokensSwift(model) → string
//   tokenOps(kit)                                  the `tokens.import` operation (registered in ops.js)
import { newId, isId, ID_PREFIX } from "./ids.js";
import { slug, cssVarName, chainOf, rawValue, variableValue, modeIdsOf, isBinding } from "./variables.js";
import { varSheet, fmt, cssLiteral } from "./css.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const EXT = "org.openfini";
const EXT_MODES = "org.openfini.modes";
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------------------------------------- colors

/** "#rgb(a)" / "#rrggbb(aa)" → [r, g, b, a] in 0..1. */
function hexParts(hex) {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
const to2 = (x) =>
  Math.round(Math.max(0, Math.min(1, x)) * 255)
    .toString(16)
    .padStart(2, "0");
const partsHex = ([r, g, b, a = 1]) => `#${to2(r)}${to2(g)}${to2(b)}${a < 1 ? to2(a) : ""}`;

/** A model color (hex) as a DTCG 2025.10 color value. */
function colorOut(hex) {
  const [r, g, b, a] = hexParts(hex);
  const out = { colorSpace: "srgb", components: [round(r), round(g), round(b)] };
  if (a < 1) out.alpha = round(a);
  out.hex = partsHex([r, g, b]);
  return out;
}

const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** A DTCG color value (object or string) as a hex color, or null. */
function colorIn(v) {
  if (typeof v === "string") return HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : null;
  if (!isObj(v)) return null;
  const comps = Array.isArray(v.components) ? v.components.map((c) => (c === "none" ? 0 : c)) : null;
  const alpha = finite(v.alpha) ? v.alpha : 1;
  if (comps && comps.length === 3 && comps.every(finite)) {
    if (v.colorSpace === "srgb") return partsHex([...comps, alpha]);
    if (v.colorSpace === "srgb-linear") return partsHex([...comps.map(linToSrgb), alpha]);
    if (v.colorSpace === "hsl") return partsHex([...hslToRgb(comps[0], comps[1], comps[2]), alpha]);
  }
  if (typeof v.hex === "string" && HEX_RE.test(v.hex)) {
    const [r, g, b] = hexParts(v.hex);
    return partsHex([r, g, b, alpha]);
  }
  return null;
}

// ------------------------------------------------------------------------------------------------- export

const SEG_BAD = /[{}.$]/g;
/** Token path segments of a variable or style name. */
const segsOf = (name) =>
  String(name ?? "")
    .split("/")
    .map((s) => s.trim().replace(SEG_BAD, "_"))
    .filter(Boolean);

/** Places every variable and style and returns the reference of each ("v1" → "color.brand.$root"). */
function layout(model) {
  const items = model.vars?.items || {};
  const colls = model.vars?.collections || {};
  const styles = isObj(model.styles) ? model.styles : {};
  const order = [...Object.keys(items).sort().map((id) => ["v", id, items[id].name, colls[items[id].coll]?.name]), ...Object.keys(styles).sort().map((id) => ["s", id, styles[id].name, "styles"])];
  // groups first, so that a later token below an existing token moves it to $root deterministically: shorter names first
  order.sort((a, b) => segsOf(a[2]).length - segsOf(b[2]).length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const refs = new Map();
  const used = new Set();
  for (const [kind, id, name, group] of order) {
    let segs = segsOf(name);
    if (!segs.length) segs = [kind === "v" ? id : `style-${id}`];
    const key = segs.join(".");
    if (used.has(key)) {
      const g = slug(group) || "group";
      segs = [g, ...segs];
      for (let i = 2; used.has(segs.join(".")); i++) segs = [g, ...segsOf(name).slice(0, -1), `${segsOf(name).slice(-1)[0] || id}-${i}`];
    }
    used.add(segs.join("."));
    refs.set(`${kind}:${id}`, segs);
  }
  // a path that is a prefix of another path is a $root token
  const all = [...refs.values()].map((s) => s.join("."));
  const ref = new Map();
  for (const [k, segs] of refs) {
    const p = segs.join(".");
    ref.set(k, all.some((x) => x.startsWith(`${p}.`)) ? `${p}.$root` : p);
  }
  return ref;
}

function setAt(root, dotted, token) {
  const segs = dotted.split(".");
  let g = root;
  for (const s of segs.slice(0, -1)) {
    if (!isObj(g[s])) g[s] = {};
    g = g[s];
  }
  g[segs[segs.length - 1]] = token;
}

/** A model value of a variable of `item`'s type in DTCG form (aliases as references). */
function valueOut(item, v, refOf) {
  if (isBinding(v)) {
    const r = refOf(v.$var);
    return r ? `{${r}}` : null;
  }
  if (item.type === "color") return HEX_RE.test(v) ? colorOut(v) : null;
  if (item.type === "number") {
    if (!finite(v)) return null;
    if (item.unit === "px") return { value: v, unit: "px" };
    if (item.unit === "ms") return { value: v, unit: "ms" };
    return v;
  }
  return v;
}
const typeOut = (item) => (item.type === "color" ? "color" : item.type === "number" ? (item.unit === "px" ? "dimension" : item.unit === "ms" ? "duration" : "number") : null);

/** A style value with its bindings as `{ "$alias": "{path}" }` (for the exact style extension). */
const aliasDeep = (v, refOf) => {
  if (isBinding(v)) {
    const r = refOf(v.$var);
    return r ? { $alias: `{${r}}` } : null;
  }
  if (Array.isArray(v)) return v.map((x) => aliasDeep(x, refOf));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aliasDeep(x, refOf)]));
  return v;
};

/** The DTCG composite of a style, or null when it has none. */
function styleOut(s, refOf) {
  const col = (c) => (isBinding(c) ? `{${refOf(c.$var)}}` : HEX_RE.test(c) ? colorOut(c) : null);
  const dim = (n) => (isBinding(n) ? `{${refOf(n.$var)}}` : finite(n) ? { value: n, unit: "px" } : undefined);
  const v = s.value;
  if (s.kind === "text" && isObj(v)) {
    const t = {};
    if (typeof v.font === "string") t.fontFamily = v.font;
    if (v.size !== undefined) t.fontSize = dim(v.size);
    if (v.weight !== undefined) t.fontWeight = isBinding(v.weight) ? `{${refOf(v.weight.$var)}}` : v.weight;
    if (v.tracking !== undefined) t.letterSpacing = dim(v.tracking);
    if (isObj(v.lineHeight) && finite(v.lineHeight.pct)) t.lineHeight = round(v.lineHeight.pct / 100);
    return { $type: "typography", $value: t };
  }
  if (s.kind === "effect" && Array.isArray(v) && v.length && v.every((e) => isObj(e) && e.type === "shadow")) {
    const list = v.map((e) => ({ color: col(e.color), offsetX: dim(e.x ?? 0), offsetY: dim(e.y ?? 0), blur: dim(e.blur ?? 0), spread: dim(e.spread ?? 0), ...(e.inset ? { inset: true } : {}) }));
    return { $type: "shadow", $value: list.length === 1 ? list[0] : list };
  }
  if (s.kind === "fill" && Array.isArray(v) && v.length === 1) {
    const f = v[0];
    if (f?.type === "solid" && (f.opacity ?? 1) === 1) return { $type: "color", $value: col(f.color) };
    if (f?.type === "linear" && Array.isArray(f.stops)) return { $type: "gradient", $value: f.stops.map((x) => ({ color: col(x.color), position: x.at })) };
  }
  return null;
}

/**
 * Variables and styles as one DTCG document (see the header).
 * @param {object} model
 * @param {{ mode?: Record<string, string> | null }} [opts]   one mode per collection (a plain single-mode file)
 */
export function exportTokens(model, { mode = null } = {}) {
  const items = model.vars?.items || {};
  const colls = model.vars?.collections || {};
  const styles = isObj(model.styles) ? model.styles : {};
  const refs = layout(model);
  const refOf = (id) => refs.get(`v:${id}`) || null;
  const doc = {};
  const plain = isObj(mode);
  for (const id of Object.keys(items).sort()) {
    const item = items[id];
    const c = colls[item.coll];
    if (!isObj(c)) continue;
    const modes = modeIdsOf(colls, item.coll);
    const def = c.default !== undefined && modes.includes(c.default) ? c.default : modes[0];
    const tok = {};
    const t = typeOut(item);
    if (t) tok.$type = t;
    if (plain) {
      const v = rawValue(model, id, mode);
      tok.$value = valueOut(item, isBinding(v) && !refOf(v.$var) ? variableValue(model, id, mode) : v, refOf);
    } else tok.$value = valueOut(item, item.values?.[def], refOf);
    if (typeof item.description === "string") tok.$description = item.description;
    if (!plain) {
      const x = { id, collection: item.coll };
      if (!t) x.type = item.type;
      if (item.unit === "%") x.unit = "%";
      if (segsOf(item.name).join("/") !== item.name) x.name = item.name;
      if (Array.isArray(item.scopes)) x.scopes = [...item.scopes];
      if (isObj(item.code)) x.code = structuredClone(item.code);
      if (isObj(item.ext)) {
        x.ext = {};
        for (const [cid, vals] of Object.entries(item.ext)) x.ext[cid] = Object.fromEntries(Object.entries(isObj(vals) ? vals : {}).map(([m, v]) => [m, valueOut(item, v, refOf)]));
      }
      const others = modes.filter((m) => m !== def && item.values?.[m] !== undefined);
      tok.$extensions = { [EXT]: x };
      if (others.length) tok.$extensions[EXT_MODES] = Object.fromEntries(others.map((m) => [m, valueOut(item, item.values[m], refOf)]));
    } else if (item.type === "string" || item.type === "bool") tok.$extensions = { [EXT]: { type: item.type } };
    setAt(doc, refs.get(`v:${id}`), tok);
  }
  for (const id of Object.keys(styles).sort()) {
    const s = styles[id];
    if (!isObj(s)) continue;
    const comp = styleOut(s, refOf);
    const tok = comp ? { ...comp } : { $value: aliasDeep(s.value, refOf) };
    if (typeof s.description === "string") tok.$description = s.description;
    const x = { style: { kind: s.kind, value: aliasDeep(s.value, refOf) } };
    if (!plain) x.id = id;
    if (segsOf(s.name).join("/") !== s.name) x.name = s.name;
    tok.$extensions = { [EXT]: x };
    setAt(doc, refs.get(`s:${id}`), tok);
  }
  if (!plain && Object.keys(colls).length) {
    const out = {};
    for (const id of Object.keys(colls).sort()) {
      const c = colls[id];
      out[id] = { name: c.name, modes: (c.modes || []).map((m) => ({ id: m.id, name: m.name })) };
      if (c.default !== undefined) out[id].default = c.default;
      if (c.extends != null) out[id].extends = c.extends;
      if (typeof c.description === "string") out[id].description = c.description;
    }
    return { $extensions: { [EXT]: { collections: out } }, ...doc };
  }
  return doc;
}

// ------------------------------------------------------------------------------------------------- import

const REF_RE = /^\{([^{}]+)\}$/;
const WEIGHTS = { thin: 100, hairline: 100, "extra-light": 200, "ultra-light": 200, light: 300, normal: 400, regular: 400, book: 400, medium: 500, "semi-bold": 600, "demi-bold": 600, bold: 700, "extra-bold": 800, "ultra-bold": 800, black: 900, heavy: 900, "extra-black": 950, "ultra-black": 950 };

/** Collects the tokens of a DTCG document: Map dotted path → { path, type, value, ext, description }. */
function collect(doc, report) {
  const tokens = new Map();
  const groups = new Map();
  const visit = (g, path, type) => {
    if (!isObj(g)) return;
    groups.set(path.join("."), g);
    const t = typeof g.$type === "string" ? g.$type : type;
    if (own(g, "$root") && isObj(g.$root)) addToken(g.$root, path, t, true);
    for (const [k, v] of Object.entries(g)) {
      if (k.startsWith("$")) continue;
      if (!isObj(v)) continue;
      if (own(v, "$value") || own(v, "$ref")) addToken(v, [...path, k], t, false);
      else visit(v, [...path, k], t);
    }
  };
  const addToken = (v, path, type, root) => {
    const key = path.join(".");
    tokens.set(key, { path, root, type: typeof v.$type === "string" ? v.$type : type, value: own(v, "$value") ? v.$value : { $ref: v.$ref }, ext: isObj(v.$extensions) ? v.$extensions : {}, description: typeof v.$description === "string" ? v.$description : undefined });
  };
  visit(doc, [], undefined);
  // group $extends: tokens of the referenced group that this group does not define itself
  for (const [gp, g] of groups) {
    const m = typeof g.$extends === "string" ? REF_RE.exec(g.$extends) : null;
    if (!m) continue;
    const src = m[1];
    for (const [k, tok] of [...tokens]) {
      if (!k.startsWith(`${src}.`) && k !== src) continue;
      const rest = k.slice(src.length + 1);
      const nk = gp ? (rest ? `${gp}.${rest}` : gp) : rest;
      if (!nk || tokens.has(nk)) continue;
      tokens.set(nk, { ...tok, path: nk.split(".") });
    }
  }
  if (!tokens.size) report.warnings.push("The file contains no tokens.");
  return tokens;
}

/** The token path an alias value refers to, or null. */
function aliasOf(v) {
  if (typeof v === "string") {
    const m = REF_RE.exec(v.trim());
    return m ? m[1].replace(/\.\$root$/, "") : null;
  }
  if (isObj(v) && typeof v.$ref === "string" && Object.keys(v).length === 1) {
    const p = v.$ref.replace(/^#\/?/, "").split("/").filter(Boolean);
    // a reference into a value ("#/a/b/$value/components/0") counts as a reference to the token
    const at = p.indexOf("$value");
    if (at >= 0) p.length = at;
    if (p[p.length - 1] === "$root") p.pop();
    return p.length ? p.join(".") : null;
  }
  return null;
}

/** dimension (object or "16px"/"1rem") → px number, or null. */
function dimIn(v, report, path) {
  let value;
  let unit;
  if (isObj(v)) ({ value, unit } = v);
  else if (typeof v === "string") {
    const m = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*(px|rem|em)?\s*$/i.exec(v);
    if (!m) return null;
    value = Number(m[1]);
    unit = (m[2] || "px").toLowerCase();
  } else if (finite(v)) return v;
  if (!finite(value)) return null;
  if (unit === "rem" || unit === "em") {
    report.converted.push(`${path}: ${value}${unit} → ${value * 16}px`);
    return value * 16;
  }
  return value;
}
function durIn(v) {
  let value;
  let unit;
  if (isObj(v)) ({ value, unit } = v);
  else if (typeof v === "string") {
    const m = /^\s*(-?\d*\.?\d+)\s*(ms|s)\s*$/i.exec(v);
    if (!m) return null;
    value = Number(m[1]);
    unit = m[2].toLowerCase();
  } else if (finite(v)) return v;
  if (!finite(value)) return null;
  return unit === "s" ? value * 1000 : value;
}
const weightIn = (v) => (finite(v) ? v : typeof v === "string" ? WEIGHTS[v.toLowerCase().replace(/\s+/g, "-")] ?? (finite(Number(v)) ? Number(v) : null) : null);

const VAR_KIND = { color: ["color", ""], dimension: ["number", "px"], number: ["number", ""], duration: ["number", "ms"], fontWeight: ["number", ""], fontFamily: ["string", ""] };
const STYLE_KIND = { typography: "text", shadow: "effect", gradient: "fill" };
const SKIPPED = new Set(["cubicBezier", "strokeStyle", "border", "transition"]);

/**
 * Plans the import of a DTCG document into `model` (see the header). Pure: the model is not changed.
 * @param {object} model
 * @param {object} json
 * @param {{ collection?: string, mode?: string, random?: () => number }} [opts]
 * @returns {{ plan: { collections: object, items: object, styles: object, modes: { coll: string, id: string, name: string }[] }, report: { created: number, updated: number, styles: number, skipped: { path: string, reason: string }[], converted: string[], warnings: string[] } }}
 */
export function importTokens(model, json, { collection = "Tokens", mode = null, random = Math.random } = {}) {
  const report = { created: 0, updated: 0, styles: 0, skipped: [], converted: [], warnings: [] };
  if (!isObj(json)) throw new Error("A DTCG token file is a JSON object.");
  const tokens = collect(json, report);
  const colls = structuredClone(model.vars?.collections || {});
  const items = model.vars?.items || {};
  const outItems = {};
  const outStyles = {};
  const newModes = [];
  const taken = (map, extra) => (x) => own(map, x) || own(extra, x);
  const skip = (path, reason) => report.skipped.push({ path, reason });

  // collections of the OpenFini extensions: matched by id (same file) or name, else created
  const collMap = new Map();
  const extColls = isObj(json.$extensions?.[EXT]?.collections) ? json.$extensions[EXT].collections : {};
  const byName = (name) => Object.keys(colls).find((id) => colls[id]?.name === name);
  const ensureColl = (key, spec) => {
    if (collMap.has(key)) return collMap.get(key);
    let id = own(colls, key) && colls[key].name === spec.name ? key : byName(spec.name);
    if (!id) {
      id = isId(key) && !own(colls, key) ? key : newId(ID_PREFIX.collection, (x) => own(colls, x), random);
      const modes = Array.isArray(spec.modes) && spec.modes.length ? spec.modes.filter((m) => isObj(m) && isId(m.id)).map((m) => ({ id: m.id, name: String(m.name ?? m.id) })) : [{ id: "default", name: "Default" }];
      colls[id] = { name: String(spec.name), modes, default: modes.some((m) => m.id === spec.default) ? spec.default : modes[0].id };
      if (typeof spec.description === "string") colls[id].description = spec.description;
      if (spec.extends != null) colls[id].pendingExtends = spec.extends;
    }
    collMap.set(key, id);
    return id;
  };
  for (const [key, spec] of Object.entries(extColls)) if (isObj(spec) && typeof spec.name === "string") ensureColl(key, spec);
  for (const id of collMap.values()) {
    const c = colls[id];
    if (c.pendingExtends != null) {
      const base = collMap.get(c.pendingExtends) ?? (own(colls, c.pendingExtends) ? c.pendingExtends : null);
      delete c.pendingExtends;
      if (base && base !== id) {
        c.extends = base;
        c.modes = structuredClone(colls[base].modes);
        if (!c.modes.some((m) => m.id === c.default)) c.default = colls[base].default;
      }
    }
  }
  // the collection for tokens without OpenFini extensions
  let plainColl = null;
  const plainCollId = () => {
    if (plainColl) return plainColl;
    plainColl = byName(collection) || ensureColl(`#${collection}`, { name: collection, modes: mode ? [{ id: slug(mode) || "default", name: mode }] : undefined });
    return plainColl;
  };
  const modeFor = (cid) => {
    const c = colls[cid];
    if (!mode) return c.default ?? c.modes[0].id;
    const hit = c.modes.find((m) => m.id === mode || m.name === mode);
    if (hit) return hit.id;
    let id = slug(mode);
    if (!isId(id) || c.modes.some((m) => m.id === id)) id = newId("m", (x) => c.modes.some((m) => m.id === x), random);
    c.modes.push({ id, name: mode });
    newModes.push({ coll: cid, id, name: mode });
    return id;
  };

  // pass 1: decide what each token becomes
  const plans = new Map(); // path → { kind: "var", id, item, raw: { mode: value } } | { kind: "style", … }
  const pathOfName = new Map();
  for (const [path, t] of tokens) {
    const x = isObj(t.ext[EXT]) ? t.ext[EXT] : {};
    const name = typeof x.name === "string" ? x.name : t.path.join("/");
    if (isObj(x.style) && typeof x.style.kind === "string") {
      plans.set(path, { kind: "style", name, styleKind: x.style.kind, exact: x.style.value, t, x });
      continue;
    }
    let type = t.type;
    if (!type && aliasOf(t.value)) type = null; // resolved through the alias target below
    if (type && STYLE_KIND[type]) {
      plans.set(path, { kind: "style", name, styleKind: STYLE_KIND[type], t, x });
      continue;
    }
    if (type && SKIPPED.has(type)) {
      skip(path, `${type} tokens have no variable or style in Proto.`);
      continue;
    }
    let vtype;
    let unit;
    if (typeof x.type === "string") [vtype, unit] = [x.type, ""];
    else if (type && VAR_KIND[type]) [vtype, unit] = VAR_KIND[type];
    else if (!type) vtype = null;
    else {
      skip(path, `Unknown token type “${type}”.`);
      continue;
    }
    if (x.unit === "%") unit = "%";
    const cid = typeof x.collection === "string" && collMap.has(x.collection) ? collMap.get(x.collection) : typeof x.collection === "string" && own(colls, x.collection) ? x.collection : plainCollId();
    plans.set(path, { kind: "var", name, vtype, unit, cid, t, x });
    pathOfName.set(path, name);
  }
  // untyped aliases take the type of their target
  for (let round_ = 0; round_ < 8; round_++)
    for (const [path, p] of plans) {
      if (p.kind !== "var" || p.vtype) continue;
      const target = plans.get(aliasOf(p.t.value));
      if (target?.kind === "var" && target.vtype) [p.vtype, p.unit] = [target.vtype, target.unit];
    }
  for (const [path, p] of [...plans]) {
    if (p.kind === "var" && !p.vtype) {
      skip(path, "The token has no type and is not an alias of a typed token.");
      plans.delete(path);
    }
  }
  // ids: existing variable of the same name in the collection, else the exported id when free, else a new one
  const usedIds = new Set();
  for (const p of plans.values()) {
    if (p.kind !== "var") continue;
    const hit = Object.keys(items).find((id) => items[id]?.coll === p.cid && items[id].name === p.name);
    if (hit) p.id = hit;
    else if (typeof p.x.id === "string" && isId(p.x.id) && !own(items, p.x.id) && !usedIds.has(p.x.id)) p.id = p.x.id;
    else p.id = newId(ID_PREFIX.variable, (x) => own(items, x) || usedIds.has(x), random);
    usedIds.add(p.id);
  }
  const varAt = (path) => {
    const p = plans.get(path);
    return p?.kind === "var" ? p.id : null;
  };

  // pass 2: values
  const valueIn = (p, v, where) => {
    const a = aliasOf(v);
    if (a !== null) {
      const id = varAt(a);
      if (!id) {
        skip(where, `The alias {${a}} does not point to a variable.`);
        return undefined;
      }
      return { $var: id };
    }
    switch (p.vtype) {
      case "color": {
        const c = colorIn(v);
        if (c === null) skip(where, "The color cannot be read (only sRGB, sRGB linear and HSL, or a hex fallback).");
        return c ?? undefined;
      }
      case "number": {
        const t = p.t.type;
        const n = t === "dimension" || p.unit === "px" ? dimIn(v, report, where) : t === "duration" || p.unit === "ms" ? durIn(v) : t === "fontWeight" ? weightIn(v) : finite(v) ? v : null;
        if (n === null || n === undefined) skip(where, "The number cannot be read.");
        return n ?? undefined;
      }
      case "string":
        return Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : v == null ? undefined : String(v);
      case "bool":
        return typeof v === "boolean" ? v : undefined;
      default:
        return undefined;
    }
  };
  for (const [path, p] of plans) {
    if (p.kind !== "var") continue;
    const c = colls[p.cid];
    const existing = items[p.id];
    const item = existing ? structuredClone(existing) : { name: p.name, coll: p.cid, type: p.vtype, values: {} };
    if (existing && existing.type !== p.vtype) {
      skip(path, `The variable “${p.name}” exists with the type ${existing.type}.`);
      continue;
    }
    if (p.unit && p.vtype === "number") item.unit = p.unit;
    const hasModes = isObj(p.t.ext[EXT_MODES]);
    const mainMode = hasModes || own(p.x, "collection") ? (c.default ?? c.modes[0].id) : modeFor(p.cid);
    const v = valueIn(p, p.t.value, path);
    if (v === undefined && !hasModes && !existing) {
      plans.delete(path);
      continue;
    }
    if (v !== undefined) item.values[mainMode] = v;
    if (hasModes) for (const [m, mv] of Object.entries(p.t.ext[EXT_MODES])) if (c.modes.some((x) => x.id === m)) { const x = valueIn(p, mv, `${path} (${m})`); if (x !== undefined) item.values[m] = x; }
    if (isObj(p.x.ext))
      for (const [ec, vals] of Object.entries(p.x.ext)) {
        const cid = collMap.get(ec) ?? ec;
        if (!isObj(colls[cid]) || !isObj(vals)) continue;
        item.ext = item.ext || {};
        item.ext[cid] = {};
        for (const [m, mv] of Object.entries(vals)) {
          const x = valueIn(p, mv, `${path} (${ec}/${m})`);
          if (x !== undefined) item.ext[cid][m] = x;
        }
      }
    for (const m of c.modes.map((x) => x.id)) if (item.values[m] === undefined) item.values[m] = item.values[mainMode] ?? (p.vtype === "color" ? "#000000" : p.vtype === "number" ? 0 : p.vtype === "bool" ? false : "");
    if (Array.isArray(p.x.scopes)) item.scopes = p.x.scopes.filter((s) => typeof s === "string");
    if (isObj(p.x.code)) item.code = structuredClone(p.x.code);
    if (p.t.description !== undefined) item.description = p.t.description;
    outItems[p.id] = item;
    if (existing) report.updated++;
    else report.created++;
  }

  // aliases to tokens that were skipped above become neutral values
  const exists = (id) => own(outItems, id) || own(items, id);
  for (const [id, item] of Object.entries(outItems)) {
    const fix = (v, where) => {
      if (!isBinding(v) || exists(v.$var)) return v;
      skip(where, "The alias points to a token that was skipped.");
      return item.type === "color" ? "#000000" : item.type === "number" ? 0 : item.type === "bool" ? false : "";
    };
    for (const m of Object.keys(item.values)) item.values[m] = fix(item.values[m], item.name);
    if (isObj(item.ext)) for (const o of Object.values(item.ext)) for (const m of Object.keys(o)) o[m] = fix(o[m], item.name);
  }

  // pass 3: styles
  const styles = isObj(model.styles) ? model.styles : {};
  const fromAlias = (v, where) => {
    if (isObj(v) && typeof v.$alias === "string") {
      const id = varAt(aliasOf(v.$alias));
      if (!id) skip(where, `The alias ${v.$alias} does not point to a variable.`);
      return id ? { $var: id } : undefined;
    }
    if (Array.isArray(v)) return v.map((x) => fromAlias(x, where));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromAlias(x, where)]).filter(([, x]) => x !== undefined));
    return v;
  };
  const colorOrVar = (v, where) => {
    const a = aliasOf(v);
    if (a !== null) {
      const id = varAt(a);
      return id ? { $var: id } : undefined;
    }
    return colorIn(v) ?? undefined;
  };
  const numOrVar = (v, where, read = (x) => dimIn(x, report, where)) => {
    const a = aliasOf(v);
    if (a !== null) {
      const id = varAt(a);
      return id ? { $var: id } : undefined;
    }
    const n = read(v);
    return n === null ? undefined : n;
  };
  for (const [path, p] of plans) {
    if (p.kind !== "style") continue;
    let value;
    let kind = p.styleKind;
    if (p.exact !== undefined) value = fromAlias(p.exact, path);
    else {
      let v = p.t.value;
      const a = aliasOf(v);
      if (a !== null) v = tokens.get(a)?.value;
      if (p.t.type === "typography" && isObj(v)) {
        value = {};
        // a font family alias is followed to its value (text styles hold the family name itself)
        let fam = v.fontFamily;
        for (let i = 0; i < 16 && aliasOf(fam) !== null; i++) fam = tokens.get(aliasOf(fam))?.value;
        if (fam !== undefined && fam !== null) value.font = Array.isArray(fam) ? String(fam[0]) : String(fam);
        if (v.fontSize !== undefined) value.size = numOrVar(v.fontSize, path);
        if (v.fontWeight !== undefined) value.weight = numOrVar(v.fontWeight, path, weightIn);
        if (v.letterSpacing !== undefined) value.tracking = numOrVar(v.letterSpacing, path);
        if (finite(v.lineHeight)) value.lineHeight = { pct: round(v.lineHeight * 100, 2) };
        for (const k of Object.keys(value)) if (value[k] === undefined) delete value[k];
      } else if (p.t.type === "shadow") {
        const list = Array.isArray(v) ? v : [v];
        value = list.filter(isObj).map((s) => {
          const e = { type: "shadow", x: numOrVar(s.offsetX ?? 0, path) ?? 0, y: numOrVar(s.offsetY ?? 0, path) ?? 0, blur: numOrVar(s.blur ?? 0, path) ?? 0, spread: numOrVar(s.spread ?? 0, path) ?? 0, color: colorOrVar(s.color, path) ?? "#000000" };
          if (s.inset === true) e.inset = true;
          return e;
        });
      } else if (p.t.type === "gradient" && Array.isArray(v)) {
        value = [{ type: "linear", angle: 180, stops: v.filter(isObj).map((s) => ({ at: Math.max(0, Math.min(1, finite(s.position) ? s.position : 0)), color: colorOrVar(s.color, path) ?? "#000000" })) }];
      } else {
        skip(path, "The style value cannot be read.");
        continue;
      }
    }
    const hit = Object.keys(styles).find((id) => styles[id]?.name === p.name && styles[id].kind === kind);
    let id = hit;
    if (!id) id = typeof p.x.id === "string" && isId(p.x.id) && !own(styles, p.x.id) && !own(outStyles, p.x.id) ? p.x.id : newId(ID_PREFIX.style, taken(styles, outStyles), random);
    const s = { name: p.name, kind, value };
    if (p.t.description !== undefined) s.description = p.t.description;
    outStyles[id] = s;
    report.styles++;
  }
  // collections that changed or were created
  const outColls = {};
  for (const [id, c] of Object.entries(colls)) if (JSON.stringify(c) !== JSON.stringify(model.vars?.collections?.[id])) outColls[id] = c;
  return { plan: { collections: outColls, items: outItems, styles: outStyles, modes: newModes }, report };
}

/** The `tokens.import` operation: { tokens, collection?, mode? } → the plan of importTokens, as one undo step. */
export function tokenOps(kit) {
  const { OpError } = kit;
  return {
    "tokens.import": (d, op) => {
      let res;
      try {
        res = importTokens(d.m, op.tokens, { collection: op.collection ?? "Tokens", mode: op.mode ?? null, random: d.random });
      } catch (e) {
        throw new OpError("tokens", e.message);
      }
      const r = d.record(() => {
        const items = d.m.vars?.items || {};
        // new modes of existing collections: give every variable of their family a value first
        for (const m of res.plan.modes) {
          const coll = d.m.vars?.collections?.[m.coll];
          if (!coll) continue;
          for (const [vid, item] of Object.entries(items)) if (item.coll === m.coll && item.values?.[m.id] === undefined) d.putItem(vid, { ...item, values: { ...item.values, [m.id]: item.values[coll.default] ?? Object.values(item.values)[0] } });
        }
        for (const [id, c] of Object.entries(res.plan.collections)) {
          d.putColl(id, c);
          // extending collections mirror the modes of their base
          for (const [eid, e] of Object.entries(d.m.vars.collections)) if (e.extends === id && JSON.stringify(e.modes) !== JSON.stringify(c.modes)) d.putColl(eid, { ...e, modes: structuredClone(c.modes) });
        }
        for (const [id, v] of Object.entries(res.plan.items)) d.putItem(id, v);
        for (const [id, s] of Object.entries(res.plan.styles)) d.putStyle(id, s);
        return [...Object.keys(res.plan.items), ...Object.keys(res.plan.styles)];
      });
      return { ...r, report: res.report };
    },
  };
}

// ------------------------------------------------------------------------------------------------- code exports

/** Variables and styles as CSS custom properties (the canvas rules, plus one property per style). */
export function tokensCss(model, opts = {}) {
  const lines = [varSheet(model, opts)];
  const styles = isObj(model.styles) ? model.styles : {};
  const decls = [];
  for (const id of Object.keys(styles).sort()) {
    const s = styles[id];
    const v = styleCss(model, s);
    if (v) decls.push(`  --${s.kind === "effect" ? "shadow" : s.kind === "text" ? "font" : "fill"}-${slug(s.name) || id}: ${v};`);
  }
  if (decls.length) lines.push(`${opts.root || ":root"} {\n${decls.join("\n")}\n}`);
  return lines.filter(Boolean).join("\n") + "\n";
}

/** A style as one CSS value (font shorthand, box-shadow list, background), variables as var() references. */
function styleCss(model, s) {
  const items = model.vars?.items || {};
  const ref = (v, lit) => (isBinding(v) ? `var(${cssVarName(items[v.$var], v.$var)})` : lit(v));
  const px = (v) => ref(v, (x) => `${fmt(finite(x) ? x : 0)}px`);
  const col = (v) => ref(v, (x) => (HEX_RE.test(x) ? x : "#000000"));
  const v = s?.value;
  if (s?.kind === "text" && isObj(v)) {
    const lh = isObj(v.lineHeight) && finite(v.lineHeight.pct) ? `/${fmt(v.lineHeight.pct / 100)}` : "";
    const fam = String(v.font || "Inter").replace(/["\\;{}<>\n\r]/g, "");
    return `${ref(v.weight ?? 400, (x) => fmt(finite(x) ? x : 400))} ${px(v.size ?? 16)}${lh} "${fam}", sans-serif`;
  }
  if (s?.kind === "effect" && Array.isArray(v)) {
    const sh = v.filter((e) => isObj(e) && e.type === "shadow").map((e) => `${e.inset ? "inset " : ""}${px(e.x ?? 0)} ${px(e.y ?? 0)} ${px(e.blur ?? 0)} ${px(e.spread ?? 0)} ${col(e.color)}`);
    return sh.length ? sh.join(", ") : null;
  }
  if (s?.kind === "fill" && Array.isArray(v) && v.length) {
    const f = v[v.length - 1];
    if (f?.type === "solid") return col(f.color);
    if (f?.type === "linear" && Array.isArray(f.stops)) return `linear-gradient(${fmt(finite(f.angle) ? f.angle : 180)}deg, ${f.stops.map((x) => `${col(x.color)} ${fmt((x.at ?? 0) * 100)}%`).join(", ")})`;
  }
  return null;
}

const TW_NS = [
  [/^(color|colors)\b/, "color"],
  [/^(space|spacing|gap|padding|margin|size)\b/, "spacing"],
  [/^(radius|radii|rounded|corner)/, "radius"],
  [/^(font-size|text)\b/, "text"],
  [/^(font-weight|weight)\b/, "font-weight"],
  [/^(shadow|elevation)/, "shadow"],
  [/^(breakpoint|screen)/, "breakpoint"],
  [/^(ease|easing)/, "ease"],
];

/** The Tailwind v4 theme variable of a variable: namespace from its type, scopes or first name segment. */
function twName(item, id) {
  const s = slug(item.name) || slug(id);
  for (const [re, ns] of TW_NS) if (re.test(s)) return `--${ns}-${s.replace(re, "").replace(/^-+/, "") || s}`;
  if (item.type === "color") return `--color-${s}`;
  const sc = Array.isArray(item.scopes) ? item.scopes : [];
  if (sc.includes("radius")) return `--radius-${s}`;
  if (sc.includes("gap") || sc.includes("padding") || sc.includes("size")) return `--spacing-${s}`;
  if (sc.includes("fontSize")) return `--text-${s}`;
  return `--${s}`;
}

/** Variables and styles as a Tailwind v4 `@theme` (default modes), plus mode rules for the other modes. */
export function tokensTailwind(model) {
  const items = model.vars?.items || {};
  const colls = model.vars?.collections || {};
  const ids = Object.keys(items)
    .filter((id) => colls[items[id]?.coll] && items[id].type !== "bool")
    .sort((a, b) => (twName(items[a], a) < twName(items[b], b) ? -1 : 1));
  const name = new Map(ids.map((id) => [id, twName(items[id], id)]));
  const val = (id, modes) => {
    const raw = rawValue(model, id, modes);
    if (isBinding(raw) && name.has(raw.$var)) return `var(${name.get(raw.$var)})`;
    return cssLiteral(items[id], variableValue(model, id, modes));
  };
  const theme = [];
  for (const id of ids) {
    const v = val(id, {});
    if (v !== null) theme.push(`  ${name.get(id)}: ${v};`);
  }
  const styles = isObj(model.styles) ? model.styles : {};
  for (const sid of Object.keys(styles).sort()) {
    const s = styles[sid];
    const n = slug(s.name) || sid;
    if (s.kind === "effect") {
      const v = styleCss(model, s);
      if (v) theme.push(`  --shadow-${n}: ${v};`);
    } else if (s.kind === "text" && isObj(s.value)) {
      const t = s.value;
      if (finite(t.size)) theme.push(`  --text-${n}: ${fmt(t.size)}px;`);
      if (isObj(t.lineHeight) && finite(t.lineHeight.pct)) theme.push(`  --text-${n}--line-height: ${fmt(t.lineHeight.pct / 100)};`);
      if (finite(t.weight)) theme.push(`  --text-${n}--font-weight: ${fmt(t.weight)};`);
      if (finite(t.tracking) && t.tracking) theme.push(`  --text-${n}--letter-spacing: ${fmt(t.tracking)}px;`);
    }
  }
  const out = [`@theme {\n${theme.join("\n")}\n}`];
  const rules = [];
  for (const c of Object.keys(colls).sort((a, b) => chainOf(colls, a).length - chainOf(colls, b).length || (a < b ? -1 : 1))) {
    const modes = modeIdsOf(colls, c);
    const def = colls[c].default ?? modes[0];
    for (const m of modes) {
      if (m === def && colls[c].extends == null) continue;
      const decls = ids.filter((id) => chainOf(colls, items[id].coll).slice(-1)[0] === chainOf(colls, c).slice(-1)[0]).map((id) => [name.get(id), val(id, { [c]: m })]).filter(([, v]) => v !== null && v !== undefined);
      if (decls.length) rules.push(`  [data-mode-${slug(colls[c].name) || slug(c)}="${m}"] {\n${decls.map(([k, v]) => `    ${k}: ${v};`).join("\n")}\n  }`);
    }
  }
  if (rules.length) out.push(`@layer theme {\n${rules.join("\n")}\n}`);
  return out.join("\n") + "\n";
}

const swiftId = (s, upper = false) => {
  const parts = String(s ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let id = parts.map((p, i) => (i === 0 && !upper ? p[0].toLowerCase() + p.slice(1) : p[0].toUpperCase() + p.slice(1))).join("") || "token";
  if (/^\d/.test(id)) id = `_${id}`;
  return id;
};
const swiftString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/** Variables as Swift (SwiftUI): one enum per collection, a nested enum per mode, static constants. */
export function tokensSwift(model) {
  const items = model.vars?.items || {};
  const colls = model.vars?.collections || {};
  const lit = (item, v) => {
    if (item.type === "color" && HEX_RE.test(v)) {
      const [r, g, b, a] = hexParts(v);
      return `SwiftUI.Color(.sRGB, red: ${round(r)}, green: ${round(g)}, blue: ${round(b)}, opacity: ${round(a)})`;
    }
    if (item.type === "number" && finite(v)) return item.unit === "ms" ? `Double(${fmt(v / 1000)})` : `CGFloat(${fmt(v)})`;
    if (item.type === "string" && typeof v === "string") return swiftString(v);
    if (item.type === "bool" && typeof v === "boolean") return String(v);
    return null;
  };
  const out = ["// Generated by OpenFini Proto from the design's variables. Do not edit by hand.", "import SwiftUI", "", "enum Tokens {"];
  const used = new Set();
  for (const c of Object.keys(colls).sort()) {
    const coll = colls[c];
    const ids = Object.keys(items)
      .filter((id) => items[id]?.coll === c || (coll.extends != null && chainOf(colls, c).includes(items[id]?.coll)))
      .sort((a, b) => (items[a].name < items[b].name ? -1 : 1));
    if (!ids.length) continue;
    let en = swiftId(coll.name, true);
    for (let i = 2; used.has(en); i++) en = `${swiftId(coll.name, true)}${i}`;
    used.add(en);
    out.push(`  enum ${en} {`);
    const modes = modeIdsOf(colls, c);
    modes.forEach((m, mi) => {
      const mname = swiftId(coll.modes[mi]?.name || m, true);
      out.push(`    enum ${mname} {`);
      const names = new Set();
      for (const id of ids) {
        let n = swiftId(items[id].name);
        for (let i = 2; names.has(n); i++) n = `${swiftId(items[id].name)}${i}`;
        names.add(n);
        const v = lit(items[id], variableValue(model, id, { [c]: m }));
        if (v !== null) out.push(`      static let ${n} = ${v}`);
      }
      out.push("    }");
    });
    out.push("  }");
  }
  out.push("}", "");
  return out.join("\n");
}
