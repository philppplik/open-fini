// Proto design tokens (docs/concepts/proto-studio.md §3.4, task T5): W3C DTCG 2025.10 export and import with golden
// files, the round trip with modes, aliases, extending collections and composite tokens, one file per mode, the
// tokens.import operation, and the CSS, Tailwind v4 and Swift exports.
//
// Golden files: UPDATE_GOLDEN=1 npm test -- --test-name-pattern=golden rewrites them (review the diff).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { exportTokens, importTokens, tokensCss, tokensTailwind, tokensSwift } from "../../app/src/engine/proto/tokens.js";
import * as O from "../../app/src/engine/proto/ops.js";
import { emptyDocument } from "../../app/src/engine/proto/schema.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const SAMPLE = read("./fixtures/schema-1/sample.json");
const sample = () => structuredClone(SAMPLE);
const EXAMPLES = read("./fixtures/tokens/dtcg-examples.tokens.json");
const empty = () => emptyDocument({ created: "2026-01-01T00:00:00Z", pageId: "p1" });
const noTokens = (m) => ({ ...m, vars: { collections: {}, items: {} }, styles: {} });
const opts = (seed = 1) => ({ random: seededRandom(seed) });

function golden(name, value) {
  const url = new URL(`./fixtures/tokens/${name}`, import.meta.url);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN) writeFileSync(url, text);
  assert.equal(text, readFileSync(url, "utf8").replace(/\r\n/g, "\n"), `${name} differs from the golden file`);
}

test("golden: the sample design exports as the recorded DTCG document", () => {
  golden("sample.tokens.json", exportTokens(sample()));
});

test("golden: the DTCG examples import into the recorded variables, styles and report", () => {
  const r = O.apply(empty(), { op: "tokens.import", tokens: EXAMPLES }, opts());
  assert.deepEqual(validate(r.model).errors, []);
  golden("dtcg-examples.expected.json", { vars: r.model.vars, styles: r.model.styles, report: r.report });
});

test("export: DTCG 2025.10 shapes (sRGB objects with hex, dimensions, $root groups, aliases, modes)", () => {
  const t = exportTokens(sample());
  assert.deepEqual(t.color.bg.surface.$value, { colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" });
  assert.equal(t.color.bg.surface.$type, "color");
  // "color/brand" is a token and the group of "color/brand/bright"
  assert.equal(t.color.brand.$root.$extensions["org.openfini.modes"].dark, "{color.brand.bright}");
  assert.deepEqual(t.space["4"].$value, { value: 16, unit: "px" });
  assert.equal(t.space["4"].$type, "dimension");
  assert.equal(t.shadow.color.$value.alpha, 0.1216);
  // booleans have no DTCG type
  assert.equal(t.state.paid.$type, undefined);
  assert.equal(t.state.paid.$extensions["org.openfini"].type, "bool");
  // styles are composite tokens with the exact style kept in the extension
  assert.equal(t.Body.Regular.$type, "typography");
  assert.deepEqual(t.Body.Regular.$value, { fontFamily: "Inter", fontSize: { value: 16, unit: "px" }, fontWeight: 400, lineHeight: 1.5 });
  assert.equal(t.Elevation["2"].$type, "shadow");
  assert.equal(t.Elevation["2"].$value.color, "{shadow.color}");
  assert.deepEqual(t.Elevation["2"].$extensions["org.openfini"].style.value[0].color, { $alias: "{shadow.color}" });
  assert.deepEqual(Object.keys(t.$extensions["org.openfini"].collections), ["c1", "c2", "c3"]);
  assert.equal(t.$extensions["org.openfini"].collections.c2.extends, "c1");
});

test("round trip: export → import → export is stable and restores the same variables and styles", () => {
  const m = sample();
  m.vars.items.v1.ext = { c2: { light: "#fef3c7", dark: { $var: "v3" } } };
  m.vars.items.v9.description = "Default spacing";
  m.styles.sg = { name: "Grid/12", kind: "grid", value: { cols: [{ fr: 1 }, { px: 240 }], gap: { $var: "v9" } } };
  m.styles.sf = { name: "Fill/Glow", kind: "fill", value: [{ type: "linear", angle: 90, stops: [{ at: 0, color: "#ff0000" }, { at: 1, color: { $var: "v2" } }] }] };
  m.styles.sb = { name: "Blur", kind: "effect", value: [{ type: "blur", radius: 4 }] };
  assert.deepEqual(validate(m).errors, []);
  const t = exportTokens(m);
  const r = O.apply(noTokens(m), { op: "tokens.import", tokens: t }, opts(5));
  assert.deepEqual(r.model.vars, m.vars);
  assert.deepEqual(r.model.styles, m.styles);
  assert.deepEqual(r.report.skipped, []);
  assert.deepEqual(exportTokens(r.model), t);
  // the examples: import → export → import gives the same model
  const a = O.apply(empty(), { op: "tokens.import", tokens: EXAMPLES }, opts(1)).model;
  const b = O.apply(empty(), { op: "tokens.import", tokens: exportTokens(a) }, opts(9)).model;
  assert.deepEqual(b.vars, a.vars);
  assert.deepEqual(b.styles, a.styles);
});

test("import: types, conversions, references and what is skipped", () => {
  const { plan, report } = importTokens(empty(), EXAMPLES, opts());
  const byName = Object.fromEntries(Object.values(plan.items).map((v) => [v.name, v]));
  const id = (name) => Object.keys(plan.items).find((k) => plan.items[k].name === name);
  assert.equal(byName["base/blue/900"].values.default, "#1e3a8a", "the older string form");
  assert.equal(byName["base/green"].values.default, "#21c45d", "HSL converted");
  assert.equal(byName["base/glass"].values.default, "#ffffff80", "alpha kept");
  assert.equal(byName["base/oklch-hex"].values.default, "#b3261e", "the hex fallback");
  assert.equal(byName["base/oklch-only"], undefined);
  assert.deepEqual(byName.brand.values.default, { $var: id("base/blue/500") }, "a $root token with an alias");
  assert.deepEqual(byName["brand/soft"].values.default, { $var: id("base/blue/100") }, "a $ref alias takes its target's type");
  assert.equal(byName["space/md"].values.default, 16, "rem → px");
  assert.equal(byName["space/md"].unit, "px");
  assert.equal(byName["motion/slow"].values.default, 500, "s → ms");
  assert.equal(byName["font/weight/semi"].values.default, 600, "weight keywords");
  assert.equal(byName["font/family"].values.default, "Inter, Helvetica, sans-serif");
  assert.equal(byName["theme/sm"].values.default, 8, "group $extends copies tokens the group does not define");
  assert.equal(byName["theme/lg"].values.default, 32, "local tokens win over the extended group");
  const skipped = report.skipped.map((s) => s.path).sort();
  assert.deepEqual(skipped, ["base.oklch-only", "border.thin", "broken", "motion.ease"]);
  assert.ok(report.converted.some((c) => c.startsWith("space.md")));
  const styles = Object.values(plan.styles);
  const body = styles.find((s) => s.name === "type/body");
  assert.equal(body.value.font, "JetBrains Mono", "a font family alias is followed");
  assert.deepEqual(body.value.lineHeight, { pct: 150 });
  assert.equal(styles.find((s) => s.name === "shadow/layered").value[1].inset, true);
  assert.deepEqual(styles.find((s) => s.name === "gradient/sunrise").value[0].stops[1].color, { $var: id("brand") });
  assert.throws(() => importTokens(empty(), "nope"), /JSON object/);
});

test("one file per mode: plain single-mode files merge into one collection with two modes", () => {
  const m = sample();
  const light = exportTokens(m, { mode: { c1: "light" } });
  const dark = exportTokens(m, { mode: { c1: "dark" } });
  assert.equal(light.$extensions, undefined, "plain files have no OpenFini collections");
  assert.equal(dark.color.bg.surface.$value.hex, "#18181b");
  assert.equal(dark.color.brand.$root.$value, "{color.brand.bright}");
  let x = O.apply(empty(), { op: "tokens.import", tokens: light, collection: "Color", mode: "Light" }, opts()).model;
  x = O.apply(x, { op: "tokens.import", tokens: dark, collection: "Color", mode: "Dark" }, opts(2)).model;
  assert.deepEqual(validate(x).errors, []);
  const colls = Object.values(x.vars.collections);
  assert.equal(colls.length, 1);
  assert.deepEqual(colls[0].modes.map((m) => m.name), ["Light", "Dark"]);
  const r = createResolver(x);
  const surface = Object.keys(x.vars.items).find((k) => x.vars.items[k].name === "color/bg/surface");
  const cid = Object.keys(x.vars.collections)[0];
  assert.equal(r.variable(surface, {}), "#ffffff");
  assert.equal(r.variable(surface, { [cid]: "dark" }), "#18181b");
  const brand = Object.keys(x.vars.items).find((k) => x.vars.items[k].name === "color/brand");
  assert.equal(r.variable(brand, { [cid]: "dark" }), "#818cf8", "the alias of the dark file");
});

test("tokens.import is one undo step and merges by name", () => {
  const m = sample();
  const t = exportTokens(m);
  t.color.text.$value = "#000000";
  t.extra = { $type: "number", $value: 3 };
  const r = O.apply(m, { op: "tokens.import", tokens: t }, opts());
  assert.equal(r.model.vars.items.v3.values.light, "#000000", "an existing variable is updated in place");
  assert.equal(r.report.updated, 7);
  assert.equal(r.report.created, 1);
  assert.deepEqual(validate(r.model).errors, []);
  assert.deepEqual(O.apply(r.model, r.inverse).model, m);
  assert.throws(() => O.apply(m, { op: "tokens.import", tokens: 5 }), (e) => e instanceof O.OpError && e.code === "tokens");
});

test("CSS, Tailwind v4 and Swift exports", () => {
  const m = sample();
  m.vars.items.v1.ext = { c2: { light: "#fef3c7" } };
  const css = tokensCss(m);
  assert.match(css, /:root \{\n {2}--color-bg-surface: #ffffff;/);
  assert.match(css, /\[data-mode-color="dark"\] \{[^}]*--color-bg-surface: #18181b;/);
  assert.match(css, /\[data-mode-brand-b="light"\] \{[^}]*--color-bg-surface: #fef3c7;/);
  assert.match(css, /--shadow-elevation-2: 0px 4px 16px -2px var\(--shadow-color\);/);
  assert.match(css, /--font-body-regular: 400 16px\/1.5 "Inter", sans-serif;/);
  const tw = tokensTailwind(m);
  assert.match(tw, /^@theme \{\n/);
  assert.match(tw, /--color-bg-surface: #ffffff;/);
  assert.match(tw, /--spacing-4: 16px;/);
  assert.match(tw, /--text-body-regular--line-height: 1.5;/);
  assert.match(tw, /\[data-mode-color="dark"\] \{[^}]*--color-brand: var\(--color-brand-bright\);/);
  const swift = tokensSwift(m);
  assert.match(swift, /^\/\/ Generated by OpenFini Proto/);
  assert.match(swift, /enum Tokens \{\n {2}enum Color \{\n {4}enum Light \{/);
  assert.match(swift, /static let colorBgSurface = SwiftUI\.Color\(\.sRGB, red: 1, green: 1, blue: 1, opacity: 1\)/);
  assert.match(swift, /enum BrandB \{[\s\S]*static let colorBgSurface = SwiftUI\.Color\(\.sRGB, red: 0\.9961, green: 0\.9529, blue: 0\.7804, opacity: 1\)/);
  assert.match(swift, /static let space4 = CGFloat\(16\)/);
  assert.match(swift, /static let statePaid = false/);
  // the exports are deterministic
  assert.equal(tokensSwift(structuredClone(m)), swift);
  assert.equal(tokensTailwind(structuredClone(m)), tw);
});
