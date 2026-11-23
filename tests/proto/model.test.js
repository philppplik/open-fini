// Proto Studio document model (docs/concepts/proto-studio.md §3, task T1): schema factories, ids, the tree index,
// validation (every malformed variant of the sample is rejected), migrations and stable serialization.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../../app/src/engine/proto/schema.js";
import { newId, isId, seededRandom, ID_PREFIX } from "../../app/src/engine/proto/ids.js";
import * as T from "../../app/src/engine/proto/tree.js";
import { validate, nodeProblems, pageProblems, isBinding, isColor } from "../../app/src/engine/proto/validate.js";
import { migrate, MIGRATIONS } from "../../app/src/engine/proto/migrate.js";
import { canonical, stringify, parse } from "../../app/src/engine/proto/serialize.js";
import { loadModel, storeModel, MEDIA_DIR, KIND } from "../../app/src/engine/proto/format.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const sample = () => structuredClone(SAMPLE);
const codes = (r) => r.errors.map((e) => e.code);

test("the engine imports in plain Node without a DOM", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(S.SCHEMA_VERSION, 1);
  assert.equal(KIND, "proto");
  assert.equal(MEDIA_DIR, "office/proto/media/");
});

test("ids: prefix plus 8 base-36 characters, unique against a map, deterministic with a seed", () => {
  const a = newId("n", null, seededRandom(7));
  assert.match(a, /^n[0-9a-z]{8}$/);
  assert.equal(newId("n", null, seededRandom(7)), a);
  const taken = { [a]: true };
  assert.notEqual(newId("n", taken, seededRandom(7)), a);
  assert.notEqual(newId("n", new Set([a]), seededRandom(7)), a);
  assert.ok(isId("n7") && isId("p1") && isId(a));
  for (const bad of ["", "7n", "n.1", "a/b", "x".repeat(65), 5, null]) assert.equal(isId(bad), false, String(bad));
  assert.equal(ID_PREFIX.node, "n");
});

test("emptyDocument is valid, has one page and the default breakpoints", () => {
  const m = S.emptyDocument({ title: "T", created: "2026-01-01T00:00:00Z", random: seededRandom(1) });
  assert.equal(m.schema, 1);
  assert.equal(Object.keys(m.pages).length, 1);
  assert.deepEqual(m.breakpoints.map((b) => b.id), ["base", "md", "sm"]);
  assert.deepEqual(validate(m), { ok: true, errors: [], warnings: [], truncated: false });
  assert.match(S.emptyDocument().meta.created, /^\d{4}-/);
});

test("nodeDefaults covers every node type and field() falls back to defaults", () => {
  for (const t of S.NODE_TYPES) assert.equal(typeof S.nodeDefaults(t).name, "string", t);
  assert.throws(() => S.nodeDefaults("nope"));
  assert.equal(S.field({}, "opacity"), 1);
  assert.equal(S.field({ opacity: 0.5 }, "opacity"), 0.5);
  assert.deepEqual(S.field({}, "layout"), { type: "none" });
  assert.ok(S.UPDATABLE_FIELDS.includes("fills") && !S.UPDATABLE_FIELDS.includes("parent") && !S.UPDATABLE_FIELDS.includes("type"));
});

test("the sample (every schema area) validates without errors or warnings", () => {
  const r = validate(sample());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
});

test("tree: children sorted by ord then id, top level, ancestors, descendants, walk, pages", () => {
  const m = sample();
  assert.deepEqual(T.topLevel(m, "p1"), ["n1", "n40"]);
  assert.deepEqual(T.children(m, "n1"), ["n2", "n3", "n5"]);
  assert.deepEqual(T.children(m, "n21"), ["n23", "n22"]);
  assert.deepEqual(T.siblings(m, "n3"), ["n2", "n3", "n5"]);
  assert.deepEqual(T.ancestors(m, "n4"), ["n3", "n1"]);
  assert.equal(T.depthOf(m, "n4"), 2);
  assert.ok(T.isInside(m, "n4", "n1") && T.isInside(m, "n1", "n1") && !T.isInside(m, "n1", "n4"));
  assert.deepEqual(T.descendants(m, "n1"), ["n2", "n3", "n4", "n5"]);
  assert.deepEqual(T.roots(m, ["n4", "n3", "n40"]), ["n3", "n40"]);
  assert.deepEqual(T.subtree(m, ["n3", "n4"]), ["n3", "n4"]);
  const seen = [];
  T.walk(m, "p1", (n, d) => seen.push(`${n.id}:${d}`));
  assert.deepEqual(seen, ["n1:0", "n2:1", "n3:1", "n4:2", "n5:1", "n40:0", "n6:1"]);
  const skipped = [];
  T.walk(m, "p1", (n) => (skipped.push(n.id), n.id !== "n1"));
  assert.deepEqual(skipped, ["n1", "n40", "n6"]);
  assert.deepEqual(T.pageList(m).map((p) => p.id), ["p1", "p2"]);
  // equal keys are ordered by id
  m.nodes.n3 = { ...m.nodes.n3, ord: "V" };
  m.nodes = { ...m.nodes };
  assert.deepEqual(T.children(m, "n1"), ["n2", "n3", "n5"]);
  // the index is cached per nodes object
  assert.equal(T.indexOf(m), T.indexOf(m));
});

test("tree: ancestors stop at a parent cycle of an invalid model", () => {
  const m = sample();
  m.nodes.n1 = { ...m.nodes.n1, parent: "n4" };
  assert.ok(T.ancestors(m, "n4").length <= 3);
  assert.equal(T.isInside(m, "n2", "n40"), false);
});

test("summarize counts pages, layers, components, variables, styles, flows and media", () => {
  const s = T.summarize(sample());
  assert.equal(s.pages, 2);
  assert.equal(s.nodes, 14);
  assert.equal(s.frames, 2);
  assert.equal(s.components, 4);
  assert.equal(s.instances, 2);
  assert.equal(s.collections, 3);
  assert.equal(s.variables, 7);
  assert.equal(s.styles, 2);
  assert.equal(s.flows, 1);
  assert.equal(s.media, 1);
  assert.equal(s.byType.text, 2);
  assert.equal(T.summarize(null).nodes, 0);
});

/** Malformed variants of the sample: [name, mutate, expected error code]. */
const MALFORMED = [
  ["not an object", () => ({ replaceModel: 5 }), "object"],
  ["schema missing", (m) => delete m.schema, "schema"],
  ["no pages", (m) => (m.pages = {}), "no-pages"],
  ["page id mismatch", (m) => (m.pages.p1.id = "p9"), "id-key"],
  ["page ord invalid", (m) => (m.pages.p1.ord = "a0"), "ord"],
  ["page bg not a color", (m) => (m.pages.p1.bg = "red"), "color"],
  ["duplicate flow ids", (m) => m.pages.p1.flows.push({ id: "f1", name: "x", start: "n1" }), "duplicate"],
  ["unit not px", (m) => (m.meta.unit = "mm"), "enum"],
  ["nodes not an object", (m) => (m.nodes = []), "object"],
  ["node id mismatch", (m) => (m.nodes.n2.id = "n99"), "id-key"],
  ["unknown node type", (m) => (m.nodes.n2.type = "blob"), "enum"],
  ["missing page", (m) => (m.nodes.n40.page = "p9"), "missing-page"],
  ["missing parent", (m) => (m.nodes.n2.parent = "n404"), "missing-parent"],
  ["leaf as parent", (m) => (m.nodes.n3.parent = "n2"), "parent-type"],
  ["page differs from parent", (m) => (m.nodes.n2.page = "p2"), "page-mismatch"],
  ["frame inside a component set", (m) => (m.nodes.n40.parent = "n20", (m.nodes.n40.page = "p2")), "set-child"],
  ["parent cycle", (m) => (m.nodes.n1.parent = "n3"), "cycle"],
  ["ord ending in zero", (m) => (m.nodes.n2.ord = "a0"), "ord"],
  ["opacity out of range", (m) => (m.nodes.n2.opacity = 2), "range"],
  ["NaN position", (m) => (m.nodes.n40.x = NaN), "number"],
  ["unknown blend", (m) => (m.nodes.n2.blend = "plus"), "enum"],
  ["sizing mode", (m) => (m.nodes.n2.w = { mode: "auto" }), "enum"],
  ["fixed size without value", (m) => (m.nodes.n40.w = { mode: "fixed" }), "number"],
  ["negative size", (m) => (m.nodes.n40.w = { mode: "fixed", value: -1 }), "range"],
  ["min larger than max", (m) => (m.nodes.n3.w = { mode: "fill", min: 500, max: 100 }), "min-max"],
  ["position", (m) => (m.nodes.n2.pos = "fixed"), "enum"],
  ["constraint", (m) => (m.nodes.n6.cx = "middle"), "enum"],
  ["tag", (m) => (m.nodes.n1.tag = "<script>"), "tag"],
  ["mode of a missing collection", (m) => (m.nodes.n1.modes = { c9: "light" }), "missing-collection"],
  ["missing mode", (m) => (m.nodes.n1.modes = { c1: "sepia" }), "missing-mode"],
  ["layout on a leaf", (m) => (m.nodes.n2.layout = { type: "flex" }), "layout"],
  ["layout type", (m) => (m.nodes.n1.layout.type = "table"), "enum"],
  ["padding needs four values", (m) => (m.nodes.n1.layout.pad = [1, 2]), "sides"],
  ["grid without definition", (m) => delete m.nodes.n3.layout.grid, "grid"],
  ["grid track", (m) => (m.nodes.n3.layout.grid.cols = [{ fr: 1, px: 2 }]), "track"],
  ["cell span", (m) => (m.nodes.n4.cell.colSpan = 0), "range"],
  ["scroll", (m) => (m.nodes.n1.scroll = "auto"), "enum"],
  ["fill type", (m) => (m.nodes.n40.fills = [{ type: "pattern" }]), "enum"],
  ["fill color", (m) => (m.nodes.n40.fills = [{ type: "solid", color: "rgb(0,0,0)" }]), "color"],
  ["gradient with one stop", (m) => (m.nodes.n3.fills[0].stops = [{ at: 0, color: "#000000" }]), "stops"],
  ["binding to a missing variable", (m) => (m.nodes.n1.fills[0].color = { $var: "v404" }), "missing-variable"],
  ["binding of the wrong type", (m) => (m.nodes.n1.fills[0].color = { $var: "v9" }), "binding-type"],
  ["stroke width", (m) => (m.nodes.n3.strokes[0].w = -1), "range"],
  ["stroke align", (m) => (m.nodes.n3.strokes[0].align = "middle"), "enum"],
  ["effect type", (m) => (m.nodes.n3.effects = [{ type: "glow" }]), "enum"],
  ["radius", (m) => (m.nodes.n3.radius = [1, 2, 3]), "sides"],
  ["missing style", (m) => (m.nodes.n2.style = { text: "s404" }), "missing-style"],
  ["style of the wrong kind", (m) => (m.nodes.n2.style = { text: "s9" }), "style-kind"],
  ["text on a frame", (m) => (m.nodes.n1.text = { runs: [] }), "text"],
  ["text layer without text", (m) => delete m.nodes.n2.text, "required"],
  ["text run", (m) => (m.nodes.n2.text.runs = [{ t: 5 }]), "string"],
  ["text align", (m) => (m.nodes.n2.text.style.align = "middle"), "enum"],
  ["line height", (m) => (m.nodes.n2.text.style.lineHeight = 1.5), "line-height"],
  ["max lines", (m) => (m.nodes.n2.text.maxLines = 0), "range"],
  ["path data with script", (m) => (m.nodes.n6.d = "M0 0 javascript:alert(1)"), "path"],
  ["path data on a frame", (m) => (m.nodes.n1.d = "M0 0"), "vector"],
  ["instance of a missing component", (m) => (m.nodes.n5.of = "n404"), "missing-component"],
  ["variant value", (m) => (m.nodes.n5.variant = { size: "xl" }), "enum"],
  ["unknown variant axis", (m) => (m.nodes.n5.variant = { color: "red" }), "missing-prop"],
  ["unknown instance property", (m) => (m.nodes.n5.props = { nope: 1 }), "missing-prop"],
  ["text property not text", (m) => (m.nodes.n5.props = { label: 5 }), "string"],
  ["variant outside a set", (m) => (m.nodes.n90.variant = { size: "md" }), "variant"],
  ["variant property without options", (m) => (m.nodes.n20.props.size.options = []), "options"],
  ["duplicate options", (m) => (m.nodes.n20.props.size.options = ["sm", "sm"]), "duplicate"],
  ["default not an option", (m) => (m.nodes.n20.props.size.default = "xl"), "enum"],
  ["too many options", (m) => (m.nodes.n20.props.size.options = Array.from({ length: 65 }, (_, i) => `o${i}`)), "length"],
  ["swap default missing", (m) => (m.nodes.n20.props.icon.default = "n404"), "missing-component"],
  ["bind to a missing property", (m) => (m.nodes.n21.bind = { "n22.text": "title" }), "missing-prop"],
  ["bind key", (m) => (m.nodes.n21.bind = { n22: "label" }), "bind-key"],
  ["overrides on a frame", (m) => (m.nodes.n1.over = {}), "over"],
  ["override path", (m) => (m.nodes.n5.over = { "n22/../x": {} }), "over-path"],
  ["override of a structure field", (m) => (m.nodes.n5.over = { n22: { parent: "n1" } }), "over-field"],
  ["of on a frame", (m) => (m.nodes.n1.of = "n20"), "of"],
  ["component cycle", (m) => (m.nodes.n22 = { ...m.nodes.n23, id: "n22", ord: "k", of: "n20" }), "component-cycle"],
  ["interaction trigger", (m) => (m.nodes.n5.proto = [{ on: { type: "shake" }, do: [] }]), "enum"],
  ["interaction action", (m) => (m.nodes.n5.proto = [{ on: { type: "click" }, do: [{ act: "eval" }] }]), "enum"],
  ["collection without modes", (m) => (m.vars.collections.c3.modes = []), "modes"],
  ["too many modes", (m) => (m.vars.collections.c3.modes = Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, name: "x" }))), "length"],
  ["default mode missing", (m) => (m.vars.collections.c1.default = "sepia"), "missing-mode"],
  ["extends a missing collection", (m) => (m.vars.collections.c2.extends = "c9"), "missing-collection"],
  ["extends cycle", (m) => (m.vars.collections.c1.extends = "c2"), "cycle"],
  ["variable type", (m) => (m.vars.items.v1.type = "gradient"), "enum"],
  ["variable in a missing collection", (m) => (m.vars.items.v1.coll = "c9"), "missing-collection"],
  ["variable value of the wrong type", (m) => (m.vars.items.v9.values.base = "16px"), "number"],
  ["alias of the wrong type", (m) => (m.vars.items.v2.values.dark = { $var: "v9" }), "binding-type"],
  ["alias cycle", (m) => (m.vars.items.v7.values.dark = { $var: "v2" }), "alias-cycle"],
  ["style kind", (m) => (m.styles.s2.kind = "color"), "enum"],
  ["effect style value", (m) => (m.styles.s9.value = [{ type: "glow" }]), "enum"],
  ["duplicate breakpoint", (m) => m.breakpoints.push({ id: "md", w: 10 }), "duplicate"],
  ["breakpoint width", (m) => (m.breakpoints[0].w = 0), "range"],
  ["media type", (m) => (m.media.m3.mime = "text/html"), "mime"],
  ["media too large", (m) => (m.media.m3.bytes = { length: 17 * 1048576 }), "limit"],
  ["record too large", (m) => (m.nodes.n2.name = "x".repeat(200), (m.nodes.n2.text.runs = [{ t: "x".repeat(70000), s: {} }])), "too-large"],
  ["name too long", (m) => (m.nodes.n2.name = "x".repeat(300)), "length"],
  ["tokens file", (m) => (m.code.tokensFile = 5), "string"],
];

test("validate rejects every malformed fixture with the expected error", () => {
  for (const [name, mutate, code] of MALFORMED) {
    let m = sample();
    const out = mutate(m);
    if (out && Object.hasOwn(Object(out), "replaceModel")) m = out.replaceModel;
    const r = validate(m);
    assert.equal(r.ok, false, `${name}: expected errors`);
    assert.ok(codes(r).includes(code), `${name}: expected ${code}, got ${codes(r).join(", ")}`);
    for (const e of r.errors) assert.ok(typeof e.message === "string" && typeof e.path === "string" && e.severity === "error");
  }
});

test("validate warns, but accepts, dangling interaction targets, flow starts and media", () => {
  const m = sample();
  m.nodes.n5.proto[0].do[0].to = "n404";
  m.pages.p1.flows[0].start = "n404";
  delete m.media.m3;
  const r = validate(m);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.code).sort(), ["missing-media", "missing-target", "missing-target"]);
});

test("validate keeps unknown fields (forward compatibility) and limits nesting depth and node count", () => {
  const m = sample();
  m.nodes.n2.futureField = { a: 1 };
  m.future = true;
  assert.equal(validate(m).ok, true);
  // depth: a chain of 66 frames
  const deep = S.emptyDocument({ pageId: "p1", created: "x" });
  let parent = null;
  for (let i = 0; i < 66; i++) {
    deep.nodes[`n${i}`] = { id: `n${i}`, type: "frame", name: "f", page: "p1", parent, ord: "V" };
    parent = `n${i}`;
  }
  assert.ok(codes(validate(deep)).includes("depth"));
  const r = validate(sample(), { limits: { ...S.LIMITS, nodes: 3 } });
  assert.ok(codes(r).includes("limit"));
  const capped = validate(5, { maxProblems: 1 });
  assert.equal(capped.errors.length, 1);
  const many = sample();
  for (const n of Object.values(many.nodes)) n.opacity = 9;
  const t = validate(many, { maxProblems: 5 });
  assert.equal(t.truncated, true);
  assert.equal(t.errors.length, 5);
});

test("nodeProblems and pageProblems check single records against the model", () => {
  const m = sample();
  assert.deepEqual(nodeProblems(m, m.nodes.n5), []);
  assert.equal(nodeProblems(m, { ...m.nodes.n5, of: "n404" })[0].code, "missing-component");
  assert.deepEqual(pageProblems(m, m.pages.p1), []);
  assert.equal(pageProblems(m, { ...m.pages.p1, ord: "" })[0].code, "ord");
  assert.ok(isBinding({ $var: "v1" }) && !isBinding({ $var: "v1", x: 1 }) && !isBinding("v1"));
  assert.ok(isColor("#fff") && isColor("#ffffff80") && !isColor("#ggg") && !isColor("white"));
});

test("migrate: current schema unchanged, newer read-only, older through the step table", () => {
  const m = sample();
  const cur = migrate(m);
  assert.equal(cur.model, m);
  assert.deepEqual([cur.from, cur.to, cur.newer, cur.readOnly], [1, 1, false, false]);
  const newer = migrate({ ...m, schema: 2 });
  assert.equal(newer.newer, true);
  assert.equal(newer.readOnly, true);
  assert.match(newer.notes[0], /newer version/);
  assert.deepEqual(MIGRATIONS, {});
  // a scaffolded step 1 -> 2 that renames a field, the way a future migration will
  const steps = { 1: (x, notes) => (notes.push("renamed"), { ...x, meta: { ...x.meta, name: x.meta.title } }) };
  const up = migrate(m, { migrations: steps, target: 2 });
  assert.equal(up.model.schema, 2);
  assert.equal(up.model.meta.name, "Checkout");
  assert.deepEqual(up.notes, ["renamed"]);
  assert.equal(m.schema, 1, "the input is not changed");
  assert.throws(() => migrate(m, { migrations: {}, target: 2 }), /No migration/);
  assert.throws(() => migrate({ schema: "1" }), /schema/);
  assert.throws(() => migrate(null), /not an object/);
});

test("stable serialization: canonical order, byte-identical round trip, independent of key order", () => {
  const m = sample();
  const text = stringify(m);
  assert.equal(stringify(parse(text)), text);
  assert.deepEqual(parse(text), m);
  // shuffle key order everywhere: same bytes
  const shuffle = (v) => (Array.isArray(v) ? v.map(shuffle) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffle(x)])) : v);
  assert.equal(stringify(shuffle(m)), text);
  const c = canonical(m);
  assert.deepEqual(Object.keys(c), S.TOP_FIELDS);
  assert.deepEqual(Object.keys(c.nodes), Object.keys(m.nodes).sort());
  assert.deepEqual(Object.keys(c.nodes.n2).slice(0, 6), ["id", "type", "name", "page", "parent", "ord"]);
  // pretty output for diffs; media bytes stay out of the JSON but are kept by canonical()
  assert.match(stringify(m, { pretty: true }), /\n {2}"schema": 1,/);
  const withBytes = { ...m, media: { m3: { ...m.media.m3, bytes: new Uint8Array([1, 2, 3]) } } };
  assert.ok(canonical(withBytes).media.m3.bytes instanceof Uint8Array);
  assert.equal(stringify(withBytes), text);
});

test("format: loadModel strips container fields, migrates and validates; storeModel is canonical", () => {
  const manifest = { ...sample(), kind: "proto", _raw: true, media: { m3: { ...SAMPLE.media.m3, file: "office/proto/media/m3.png" } } };
  const r = loadModel(manifest);
  assert.equal(r.readOnly, false);
  assert.deepEqual(r.errors, []);
  assert.equal(r.model.kind, undefined);
  assert.equal(r.model._raw, undefined);
  assert.equal(r.model.media.m3.file, undefined);
  assert.deepEqual(r.model, sample());
  const bad = loadModel({ ...sample(), nodes: { ...SAMPLE.nodes, n2: { ...SAMPLE.nodes.n2, opacity: 7 } } });
  assert.equal(bad.readOnly, true);
  assert.equal(bad.errors[0].code, "range");
  const newer = loadModel({ ...sample(), schema: 9 });
  assert.equal(newer.newer && newer.readOnly, true);
  assert.throws(() => loadModel(null));
  assert.equal(JSON.stringify(storeModel(sample())), stringify(sample()));
});
