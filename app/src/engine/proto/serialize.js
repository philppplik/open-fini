// Stable serialization of the Proto model (docs/concepts/proto-studio.md §12). Pure.
//
// `canonical(model)` returns an equal model whose keys are in a fixed order: top-level fields as in TOP_FIELDS, the
// id maps (pages, nodes, collections, variables, styles, media) sorted by id, node and page fields in the schema's
// order, every other object's keys sorted alphabetically, unknown fields after the known ones. JSON.stringify of a
// canonical model is therefore the same for equal models, which keeps `ofini unpack --pretty` diffs small, and
// serialize → parse → serialize is byte-identical. Arrays keep their order (it is meaningful). Binary media bytes
// (typed arrays) are kept as they are by `canonical` and left out by `stringify`: they travel as archive entries.
//
// Public API
//   canonical(model) → model      stringify(model, { pretty? }) → string      parse(text) → model
import { NODE_FIELDS, PAGE_FIELDS, TOP_FIELDS } from "./schema.js";

const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer);

function ordered(o, first, each = sortDeep) {
  const out = {};
  for (const k of first) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = each(o[k], k);
  for (const k of Object.keys(o).sort()) if (!first.includes(k)) out[k] = each(o[k], k);
  return out;
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (!isPlain(v)) return v;
  return ordered(v, []);
}

const byId = (map, each) => {
  if (!isPlain(map)) return sortDeep(map);
  const out = {};
  for (const k of Object.keys(map).sort()) out[k] = each(map[k]);
  return out;
};

const node = (n) => (isPlain(n) ? ordered(n, NODE_FIELDS) : sortDeep(n));
const page = (p) => (isPlain(p) ? ordered(p, PAGE_FIELDS) : sortDeep(p));
const named = (x) => (isPlain(x) ? ordered(x, ["id", "name", "kind", "coll", "type", "unit", "modes", "default", "extends", "values", "ext", "value", "scopes", "code", "description"]) : sortDeep(x));
const mediaItem = (m) => (isPlain(m) ? ordered(m, ["id", "mime", "name", "w", "h", "file", "bytes"]) : m);

/** An equal model with keys in the canonical order (see the header). */
export function canonical(model) {
  if (!isPlain(model)) return model;
  return ordered(model, TOP_FIELDS, (v, k) => {
    if (k === "pages") return byId(v, page);
    if (k === "nodes") return byId(v, node);
    if (k === "styles") return byId(v, named);
    if (k === "media") return byId(v, mediaItem);
    if (k === "vars" && isPlain(v)) return ordered(v, ["collections", "items"], (x) => byId(x, named));
    if (k === "meta" && isPlain(v)) return ordered(v, ["title", "created", "unit", "app"]);
    return sortDeep(v);
  });
}

/** Canonical JSON text of a model (media bytes left out). */
export function stringify(model, { pretty = false } = {}) {
  return JSON.stringify(canonical(model), (k, v) => (ArrayBuffer.isView(v) ? undefined : v), pretty ? 2 : undefined);
}

/** Parses JSON text into a model (no migration or validation: see migrate.js and validate.js). */
export function parse(text) {
  return JSON.parse(text);
}
