// `ofini proto …` and `ofini new proto` (cli/lib/proto.mjs, docs/cli.md ▸ Proto, task T13): every command runs
// in-process through main() on the sample design and the geometry fixtures, with exit codes, JSON shapes and files.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "../../app/vendor/fflate/fflate.js";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject } from "../../app/src/core/office.js";
import * as S from "../../app/src/engine/proto/schema.js";
import { storeModel, loadModel } from "../../app/src/engine/proto/format.js";
import { exportTokens, tokensCss, tokensTailwind, tokensSwift } from "../../app/src/engine/proto/tokens.js";
import { layoutNode } from "../../app/src/engine/proto/layout.js";
import { main, COMMANDS } from "../../cli/lib/main.mjs";
import { writeOfini } from "../../cli/lib/project.mjs";
import { completionScript } from "../../cli/lib/completion.mjs";
import { complete } from "../../cli/lib/repl.mjs";
import { renderSvg } from "../../cli/lib/proto-svg.mjs";
import { lintModel, LINT_RULES } from "../../cli/lib/proto-lint.mjs";
import { PROTO_COMMANDS } from "../../cli/lib/proto.mjs";

const SAMPLE = JSON.parse(readFileSync(new URL("../proto/fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const GEOMETRY = new URL("../proto/fixtures/geometry/", import.meta.url);
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "ofini-proto-cli-"));
  const model = { ...structuredClone(SAMPLE), media: { m3: { ...SAMPLE.media.m3, bytes: PNG } } };
  writeFileSync(join(dir, "sample.ofini"), designBytes(model));
  writeFileSync(join(dir, "sample.json"), JSON.stringify(SAMPLE));
});
after(() => rmSync(dir, { recursive: true, force: true }));

function designBytes(model, title = "Checkout") {
  const doc = new Doc({ name: title, studio: "proto", width: 1440, height: 1024, pages: 1 });
  doc.office = new OfficeProject(storeModel(model), S.KIND);
  return writeOfini(doc);
}
function sink() {
  const chunks = [];
  return { isTTY: false, write: (s) => (chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8")), true), text: () => chunks.join("") };
}
async function ofini(argv, { stdin } = {}) {
  const stdout = sink();
  const stderr = sink();
  const io = { stdout, stderr, env: {}, cwd: dir, tmpdir: dir };
  if (stdin !== undefined) io.readStdin = () => Buffer.from(stdin);
  const code = await main(argv, io);
  return { code, out: stdout.text(), err: stderr.text() };
}
const run = (...argv) => ofini(argv);
const json = (r) => JSON.parse(r.out);
const p = (name) => join(dir, name);
const modelOf = (file) => {
  const bytes = readFileSync(p(file));
  if (file.endsWith(".json")) return loadModel(JSON.parse(bytes.toString("utf8"))).model;
  const office = JSON.parse(strFromU8(unzipSync(bytes)["document.json"])).office;
  return loadModel(office).model;
};
const fixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, GEOMETRY), "utf8"));

/** A design with one frame and the given children (absolute layers unless they say otherwise). */
function designWith(frame, kids) {
  const m = S.emptyDocument({ title: "Lint", created: "2026-01-01T00:00:00Z", pageId: "p1" });
  m.nodes.f = { id: "f", type: "frame", name: "Screen", page: "p1", parent: null, ord: "V", x: 0, y: 0, w: { mode: "fixed", value: 200 }, h: { mode: "fixed", value: 200 }, layout: { type: "none" }, clip: true, fills: [{ type: "solid", color: "#ffffff" }], ...frame };
  const ords = ["V", "k", "r", "t", "u", "v", "w"];
  kids.forEach((k, i) => (m.nodes[k.id] = { page: "p1", parent: "f", ord: ords[i], ...k }));
  return m;
}

// ------------------------------------------------------------------------------------------------ new, info, tree

test("ofini new proto creates designs from the starters that validate cleanly", async () => {
  const list = json(await run("new", "--list", "--json"));
  assert.deepEqual(list.proto.map((t) => t.id), ["blank", "desktop", "phone"]);
  for (const [template, frames] of [["blank", 0], ["desktop", 1], ["phone", 1]]) {
    const r = await run("new", "proto", `new-${template}.ofini`, "--template", template, "--title", "Starter");
    assert.equal(r.code, 0, r.err);
    assert.equal((await run("validate", `new-${template}.ofini`)).code, 0);
    const i = json(await run("proto", "info", `new-${template}.ofini`, "--json"));
    assert.equal(i.title, "Starter");
    assert.equal(i.summary.frames, frames);
    assert.equal(i.errors, 0);
  }
  const phone = json(await run("proto", "info", "new-phone.ofini", "--json"));
  assert.equal(phone.pages[0].frames[0].size, "390×844");
  assert.equal((await run("new", "proto", "sized.ofini", "--size", "mobile")).code, 0);
  assert.equal(json(await run("proto", "info", "sized.ofini", "--json")).pages[0].frames[0].size, "390×844");
  assert.equal((await run("new", "proto", "x.ofini", "--template", "tablet")).code, 2);
  assert.equal(json(await run("info", "new-desktop.ofini", "--json")).info.kind, "proto");
});

test("proto info and tree describe the design; --json shapes", async () => {
  const i = json(await run("proto", "info", "sample.ofini", "--json"));
  assert.equal(i.file, "sample.ofini");
  assert.equal(i.title, "Checkout");
  assert.equal(i.schema, 1);
  assert.deepEqual(i.pages.map((x) => x.id), ["p1", "p2"]);
  assert.deepEqual(i.pages[0].frames.map((f) => f.id), ["n1", "n40"]);
  assert.ok(i.components.some((c) => c.id === "n20" && c.type === "componentSet" && c.variants === 2 && c.instances === 1));
  assert.ok(i.collections.length >= 1 && i.collections.every((c) => Array.isArray(c.modes) && typeof c.variables === "number"));
  assert.deepEqual(i.media, [{ id: "m3", name: SAMPLE.media.m3.name || "", mime: SAMPLE.media.m3.mime, bytes: PNG.length }]);
  assert.deepEqual(i.flows, [{ page: "p1", id: "f1", name: "Checkout", start: "n1" }]);
  assert.equal(i.summary.nodes, Object.keys(SAMPLE.nodes).length);
  // the bare model JSON works the same
  assert.equal(json(await run("proto", "info", "sample.json", "--json")).summary.nodes, i.summary.nodes);
  const text = await run("proto", "info", "sample.ofini");
  assert.match(text.out, /Checkout/);
  assert.match(text.out, /components/);
  // several files with a wildcard: an array
  assert.equal(json(await run("proto", "info", "sample.*", "--json")).length, 2);

  const t = json(await run("proto", "tree", "sample.ofini", "--json"));
  assert.deepEqual(t.pages.map((x) => x.page), ["p1", "p2"]);
  const n1 = t.pages[0].layers[0];
  assert.equal(n1.id, "n1");
  assert.deepEqual(n1.children.map((c) => c.id), ["n2", "n3", "n5"]);
  assert.equal(n1.size, "390×844");
  const shallow = json(await run("proto", "tree", "sample.ofini", "--page", "Screens", "--depth", "0", "--json"));
  assert.equal(shallow.pages.length, 1);
  assert.deepEqual(shallow.pages[0].layers[0].children, []);
  assert.equal(shallow.pages[0].layers[0].more, 3);
  const sub = json(await run("proto", "tree", "sample.ofini", "--node", "Card", "--boxes", "--json"));
  assert.equal(sub.approximate, true);
  assert.equal(sub.pages[0].layers[0].id, "n3");
  assert.equal(sub.pages[0].layers[0].box.approximate, true);
  assert.equal(sub.pages[0].layers[0].children[0].box.w, 320);
  const plain = await run("proto", "tree", "sample.ofini");
  assert.match(plain.out, /n5 instance “Pay button” hug×hug .*of n20 \{size=lg\}/);
  assert.equal((await run("proto", "tree", "sample.ofini", "--page", "nope")).code, 2);
  assert.equal((await run("proto", "tree", "sample.ofini", "--node", "n999")).code, 2);
});

test("proto inspect shows raw and resolved layers, CSS and the solver box", async () => {
  const one = json(await run("proto", "inspect", "sample.ofini", "--node", "n5", "--resolved", "--css", "--json"));
  assert.equal(one.key, "n5");
  assert.equal(one.node.of, "n20");
  assert.equal(one.box.approximate, true);
  assert.equal(one.resolved.type, "instance");
  assert.equal(typeof one.css["box-sizing"], "string");
  const two = json(await run("proto", "inspect", "sample.ofini", "--node", "n2,n3", "--json"));
  assert.deepEqual(two.map((x) => x.key), ["n2", "n3"]);
  assert.equal(two[0].resolved, undefined);
  assert.equal((await run("proto", "inspect", "sample.ofini")).code, 2, "--node is required");
});

// ------------------------------------------------------------------------------------------------ validate, lint

test("proto validate: exit 1 on errors, --strict for warnings, newer schemas are refused", async () => {
  const ok = json(await run("proto", "validate", "sample.ofini", "--json"));
  assert.deepEqual([ok.ok, ok.errors.length], [true, 0]);
  const bad = structuredClone(SAMPLE);
  bad.nodes.n2.parent = "nope";
  writeFileSync(p("bad.json"), JSON.stringify(bad));
  const r = await run("proto", "validate", "bad.json", "--json");
  assert.equal(r.code, 1);
  assert.ok(json(r).errors.length > 0 && json(r).errors.every((e) => e.code && e.message));
  const warn = structuredClone(SAMPLE);
  warn.pages.p1.flows[0].start = "n999";
  writeFileSync(p("warn.json"), JSON.stringify(warn));
  assert.equal((await run("proto", "validate", "warn.json")).code, 0);
  assert.equal((await run("proto", "validate", "warn.json", "--strict")).code, 1);
  writeFileSync(p("newer.json"), JSON.stringify({ ...SAMPLE, schema: 99 }));
  assert.equal((await run("proto", "validate", "newer.json")).code, 1);
  writeFileSync(p("vector.ofini"), readFileSync(p("new-blank.ofini")));
  assert.equal((await run("new", "vector", "plain.ofini")).code, 0);
  const notProto = await run("proto", "validate", "plain.ofini");
  assert.equal(notProto.code, 1);
  assert.match(notProto.err, /not a Proto design/);
  assert.equal((await run("proto", "validate", "missing.ofini")).code, 3);
});

test("lint rules find their problems and stay quiet on clean layers", () => {
  const m = designWith({}, [
    { id: "t1", type: "text", name: "Long", x: 0, y: 0, w: { mode: "fixed", value: 60 }, h: { mode: "fixed", value: 20 }, text: { runs: [{ t: "A very long caption that wraps", s: {} }], style: { ...S.DEFAULT_TEXT_STYLE }, autoSize: "fixed", maxLines: null } },
    { id: "b1", type: "rect", name: "Tiny button", x: 10, y: 150, w: { mode: "fixed", value: 16 }, h: { mode: "fixed", value: 16 }, proto: [{ on: { type: "click" }, do: [{ act: "back" }] }] },
    { id: "out", type: "rect", name: "Overhang", x: 150, y: 150, w: { mode: "fixed", value: 100 }, h: { mode: "fixed", value: 20 } },
    { id: "e1", type: "frame", name: "Empty", x: 0, y: 100, w: { mode: "fixed", value: 10 }, h: { mode: "fixed", value: 10 }, layout: { type: "none" } },
    { id: "ok", type: "rect", name: "Fine", x: 100, y: 0, w: { mode: "fixed", value: 48 }, h: { mode: "fixed", value: 48 }, proto: [{ on: { type: "click" }, do: [{ act: "back" }] }] },
  ]);
  const found = lintModel(m);
  const by = (rule) => found.filter((x) => x.rule === rule).map((x) => x.id);
  assert.deepEqual(by("text-overflow"), ["t1"]);
  assert.deepEqual(by("touch-target"), ["b1"]);
  assert.deepEqual(by("clipped"), ["out"]);
  assert.deepEqual(by("empty-frame"), ["e1"]);
  assert.ok(found.filter((x) => ["text-overflow", "touch-target", "clipped"].includes(x.rule)).every((x) => x.approximate));
  assert.deepEqual(by("schema"), []);
  // negative: the sample has none of the geometry problems
  assert.deepEqual(lintModel(SAMPLE, { rules: ["text-overflow", "touch-target", "empty-frame"] }), []);
  // a rule subset
  assert.deepEqual([...new Set(lintModel(m, { rules: ["empty-frame"] }).map((x) => x.rule))], ["empty-frame"]);
  assert.ok(Object.keys(LINT_RULES).includes("stale-override"));
});

test("proto lint: exit codes, --fix writes a fixed copy, SARIF for CI", async () => {
  const r = await run("proto", "lint", "sample.ofini", "--json");
  assert.equal(r.code, 0, r.err);
  const res = json(r);
  const stale = res.findings.find((x) => x.rule === "stale-override");
  assert.ok(stale, "the sample overrides a layer the lg variant does not have");
  assert.deepEqual(stale.fix, { op: "instance.reset", id: "n5", paths: ["n22"] });
  assert.equal(res.counts.fixable, 1);
  assert.equal((await run("proto", "lint", "sample.ofini", "--strict")).code, 1, "warnings fail with --strict");
  const fixed = await run("proto", "lint", "sample.ofini", "--fix", "--json");
  assert.equal(fixed.code, 0, fixed.err);
  assert.equal(json(fixed).fixed.written, "sample.fixed.ofini");
  assert.ok(existsSync(p("sample.fixed.ofini")));
  assert.deepEqual(Object.keys(modelOf("sample.fixed.ofini").nodes.n5.over || {}), []);
  assert.equal(json(await run("proto", "lint", "sample.fixed.ofini", "--json")).counts.fixable, 0);
  assert.equal((await run("proto", "lint", "sample.ofini", "--fix")).code, 3, "the fixed copy exists: --force");
  const sarif = json(await run("proto", "lint", "sample.ofini", "--format", "sarif"));
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].tool.driver.name, "ofini proto lint");
  assert.ok(sarif.runs[0].tool.driver.rules.some((x) => x.id === "touch-target"));
  const hit = sarif.runs[0].results.find((x) => x.ruleId === "stale-override");
  assert.equal(hit.level, "warning");
  assert.equal(hit.locations[0].physicalLocation.artifactLocation.uri, "sample.ofini");
  assert.equal(hit.locations[0].logicalLocations[0].name, "n5");
  assert.equal((await run("proto", "lint", "bad.json")).code, 1, "schema errors fail");
  assert.equal((await run("proto", "lint", "sample.ofini", "--rules", "nope")).code, 2);
  assert.equal((await run("proto", "lint", "sample.ofini", "--format", "xml")).code, 2);
  assert.equal((await run("proto", "lint", "sample.ofini", "--in-place")).code, 2, "--in-place needs --fix");
});

// ------------------------------------------------------------------------------------------------ render, assets

/** Start and end tags balance (a small well-formedness check without an XML parser). */
function balanced(svg) {
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]);
  }
  return stack.length === 0;
}

test("renderSvg draws every laid-out layer of the geometry fixtures with the solver's boxes", () => {
  for (const name of readdirSync(GEOMETRY).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))) {
    const fx = fixture(name);
    const res = renderSvg(fx.model, fx.root);
    assert.equal(res.approximate, true);
    assert.ok(balanced(res.svg), `${name}: tags balance`);
    const L = layoutNode(fx.model, fx.root);
    const root = L.boxes.get(fx.root);
    assert.equal(res.width, Math.max(1, root.w), name);
    for (const key of L.boxes.keys()) assert.ok(res.svg.includes(`data-key="${key}"`), `${name}: ${key} is drawn`);
    if (fx.text) assert.match(res.svg, /<tspan /, `${name}: text`);
  }
  // a layer inside a frame is laid out in its frame: the fill width of the sample's card is 342
  const card = renderSvg(SAMPLE, "n3");
  assert.match(card.svg, /width="342"/);
  assert.match(card.svg, /<linearGradient/);
  assert.match(card.svg, /stroke="#e4e4e7"/);
  // hidden layers cannot be rendered
  const hidden = structuredClone(SAMPLE);
  hidden.nodes.n2.visible = false;
  assert.throws(() => renderSvg(hidden, "n2"), /hidden/);
  // modes switch variable values
  const dark = renderSvg(SAMPLE, "n1", { modes: { c1: "dark" } });
  const light = renderSvg(SAMPLE, "n1");
  assert.notEqual(dark.svg, light.svg);
});

test("proto render writes SVG files; PNG needs the app (exit 4)", async () => {
  const all = await run("proto", "render", "sample.ofini", "--json");
  assert.equal(all.code, 0, all.err);
  const r = json(all);
  assert.equal(r.approximate, true);
  assert.deepEqual(r.renders.map((x) => x.key), ["n1", "n40"]);
  assert.deepEqual(r.renders.map((x) => x.written), ["sample-Checkout.svg", "sample-Done.svg"]);
  const svg = readFileSync(p("sample-Checkout.svg"), "utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="390" height="844"/);
  assert.match(svg, /data-approximate="true"/);
  assert.match(svg, /data:image\/png;base64,/, "pictures are embedded");
  assert.ok(balanced(svg));
  assert.equal((await run("proto", "render", "sample.ofini")).code, 3, "existing files need --force");
  const one = await run("proto", "render", "sample.ofini", "--node", "Checkout", "-o", "out/check.svg", "--scale", "2", "--media", "link");
  assert.equal(one.code, 0, one.err);
  const scaled = readFileSync(p("out/check.svg"), "utf8");
  assert.match(scaled, /width="780" height="1688"/);
  assert.match(scaled, /href="media\/m3.png"/);
  const folder = await run("proto", "render", "sample.ofini", "--page", "2", "-o", "shots/");
  assert.equal(folder.code, 0, folder.err);
  assert.deepEqual(readdirSync(p("shots")).sort(), ["sample-Button.svg", "sample-Icon_Check.svg"]);
  const stdout = json(await run("proto", "render", "sample.ofini", "--node", "n40", "-o", "-", "--json"));
  assert.match(stdout.renders[0].svg, /^<svg /);
  const raw = await run("proto", "render", "sample.ofini", "--node", "n40", "-o", "-");
  assert.match(raw.out, /^<svg /);
  assert.equal((await run("proto", "render", "sample.ofini", "--format", "png")).code, 4);
  assert.equal((await run("proto", "render", "sample.ofini", "-o", "x.png")).code, 4);
  assert.equal((await run("proto", "render", "sample.ofini", "--node", "n1,n40", "-o", "two.svg")).code, 2);
  assert.equal((await run("proto", "render", "sample.ofini", "--mode", "Nope=dark")).code, 2);
});

test("proto assets writes vector layers as SVG and embedded media as files", async () => {
  const r = await run("proto", "assets", "sample.ofini", "--json");
  assert.equal(r.code, 0, r.err);
  const a = json(r);
  assert.equal(a.dir, "sample-assets");
  assert.deepEqual(a.files.filter((x) => x.kind === "svg").map((x) => x.key).sort(), ["n6", "n91"]);
  const media = a.files.find((x) => x.kind === "media");
  assert.deepEqual([...readFileSync(join(dir, "sample-assets", media.file))], [...PNG]);
  assert.match(readFileSync(join(dir, "sample-assets", a.files[0].file), "utf8"), /<path /);
  assert.equal((await run("proto", "assets", "sample.ofini")).code, 3, "a non-empty folder needs --force");
  const chosen = json(await run("proto", "assets", "sample.ofini", "--node", "n3", "-o", "chosen", "--json"));
  assert.deepEqual(chosen.files.map((x) => x.file), ["Card.svg"]);
  assert.equal((await run("proto", "assets", "sample.ofini", "--format", "png", "-o", "png")).code, 4);
});

// ------------------------------------------------------------------------------------------------ tokens

test("proto tokens exports the engine's formats and imports DTCG", async () => {
  const model = loadModel(SAMPLE).model;
  const dtcg = json(await run("proto", "tokens", "sample.ofini"));
  assert.deepEqual(dtcg, JSON.parse(JSON.stringify(exportTokens(model))));
  const fmt = async (f) => (await run("proto", "tokens", "sample.ofini", "--format", f)).out;
  assert.equal((await fmt("css")).trimEnd(), tokensCss(model).trimEnd());
  assert.equal((await fmt("tailwind")).trimEnd(), tokensTailwind(model).trimEnd());
  assert.equal((await fmt("swift")).trimEnd(), tokensSwift(model).trimEnd());
  const light = JSON.parse(await fmt("json"));
  const dark = json(await run("proto", "tokens", "sample.ofini", "--format", "json", "--mode", "Color=dark"));
  assert.equal(typeof light["color/bg/surface"], "string");
  assert.notEqual(light["color/bg/surface"], dark["color/bg/surface"]);
  const wrapped = json(await run("proto", "tokens", "sample.ofini", "-t", "css", "--json"));
  assert.equal(wrapped.format, "css");
  assert.equal(typeof wrapped.tokens, "string");
  assert.equal((await run("proto", "tokens", "sample.ofini", "-o", "tokens.json")).code, 0);
  assert.equal((await run("proto", "tokens", "sample.ofini", "--format", "scss")).code, 2);
  // import into an empty design: the variables come back
  assert.equal((await run("new", "proto", "themed.ofini")).code, 0);
  assert.equal((await run("proto", "tokens", "import", "themed.ofini", "tokens.json")).code, 2, "choose --out, --in-place or --dry-run");
  const dry = json(await run("proto", "tokens", "import", "themed.ofini", "tokens.json", "--dry-run", "--json"));
  assert.equal(dry.written, null);
  assert.equal(dry.report.created, Object.keys(SAMPLE.vars.items).length);
  const r = await run("proto", "tokens", "import", "themed.ofini", "tokens.json", "--in-place");
  assert.equal(r.code, 0, r.err);
  const after = modelOf("themed.ofini");
  assert.equal(Object.keys(after.vars.items).length, Object.keys(SAMPLE.vars.items).length);
  assert.equal(json(await run("proto", "validate", "themed.ofini", "--json")).ok, true);
  // from standard input, into a named collection and mode
  const tok = JSON.stringify({ brand: { $type: "color", $value: "#ff0000" } });
  const s = await ofini(["proto", "tokens", "import", "themed.ofini", "-", "--collection", "Brand", "--mode", "Loud", "-o", "brand.ofini", "--json"], { stdin: tok });
  assert.equal(s.code, 0, s.err);
  const b = modelOf("brand.ofini");
  const coll = Object.values(b.vars.collections).find((c) => c.name === "Brand");
  assert.ok(coll.modes.some((m) => m.name === "Loud"));
  writeFileSync(p("broken.tokens.json"), "{");
  assert.equal((await run("proto", "tokens", "import", "themed.ofini", "broken.tokens.json", "--dry-run")).code, 1);
});

// ------------------------------------------------------------------------------------------------ diff, apply

test("proto diff lists added, removed and changed layers, variables and styles", async () => {
  assert.equal((await run("proto", "diff", "sample.ofini", "sample.json")).code, 1, "media bytes differ");
  writeFileSync(p("copy.json"), JSON.stringify(SAMPLE));
  const same = await run("proto", "diff", "sample.json", "copy.json", "--json");
  assert.equal(same.code, 0);
  assert.equal(json(same).same, true);
  const b = structuredClone(SAMPLE);
  delete b.nodes.n4;
  b.nodes.n2.name = "Sum";
  b.nodes.n99 = { ...b.nodes.n40, id: "n99", name: "Extra", ord: "z" };
  const vid = Object.keys(b.vars.items)[0];
  b.vars.items[vid] = { ...b.vars.items[vid], name: "renamed" };
  writeFileSync(p("changed.json"), JSON.stringify(b));
  const r = await run("proto", "diff", "sample.json", "changed.json", "--json");
  assert.equal(r.code, 1);
  const d = json(r);
  assert.deepEqual(d.counts, { added: 1, removed: 1, changed: 2 });
  assert.ok(d.changes.some((x) => x.kind === "+" && x.what === "layer" && x.id === "n99"));
  assert.ok(d.changes.some((x) => x.kind === "-" && x.what === "layer" && x.id === "n4"));
  assert.ok(d.changes.some((x) => x.kind === "~" && x.what === "layer" && x.id === "n2" && /name/.test(x.detail)));
  assert.ok(d.changes.some((x) => x.kind === "~" && x.what === "variable" && x.id === vid));
});

test("proto apply runs operations from a file, standard input or --ops, all or nothing", async () => {
  const ops = [
    { op: "node.update", id: "n2", set: { name: "Grand total" } },
    { op: "node.create", type: "rect", parent: "n40", fields: { name: "Badge", x: 10, y: 10 } },
  ];
  writeFileSync(p("ops.json"), JSON.stringify(ops));
  assert.equal((await run("proto", "apply", "sample.ofini", "ops.json")).code, 2, "choose a destination");
  const dry = json(await run("proto", "apply", "sample.ofini", "ops.json", "--dry-run", "--json"));
  assert.deepEqual([dry.ops, dry.changed, dry.written], [2, true, null]);
  const a = json(await run("proto", "apply", "sample.ofini", "ops.json", "-o", "applied.ofini", "--seed", "7", "--json"));
  const b = json(await run("proto", "apply", "sample.ofini", "ops.json", "-o", "applied2.ofini", "--seed", "7", "--json"));
  assert.deepEqual(a.ids, b.ids, "a seed makes new ids reproducible");
  const m = modelOf("applied.ofini");
  assert.equal(m.nodes.n2.name, "Grand total");
  assert.ok(Object.values(m.nodes).some((n) => n.name === "Badge" && n.parent === "n40"));
  assert.equal(modelOf("sample.ofini").nodes.n2.name, "Total", "the input is unchanged");
  // the rest of the file is kept (media bytes)
  assert.deepEqual([...unzipSync(readFileSync(p("applied.ofini")))["office/proto/media/m3.png"]], [...PNG]);
  // standard input and { ops: [...] }
  const s = await ofini(["proto", "apply", "sample.json", "-", "-o", "applied.json"], { stdin: JSON.stringify({ ops: [{ op: "meta.update", set: { title: "Piped" } }] }) });
  assert.equal(s.code, 0, s.err);
  assert.equal(modelOf("applied.json").meta.title, "Piped");
  // --ops and --in-place
  writeFileSync(p("edit.json"), JSON.stringify(SAMPLE));
  const inl = await run("proto", "apply", "edit.json", "--ops", '{"op":"node.delete","ids":["n4"]}', "--in-place");
  assert.equal(inl.code, 0, inl.err);
  assert.equal(modelOf("edit.json").nodes.n4, undefined);
  // a failing operation changes nothing
  const bad = await run("proto", "apply", "sample.ofini", "--ops", '[{"op":"node.update","id":"n2","set":{"name":"X"}},{"op":"node.delete","ids":["nope"]}]', "-o", "never.ofini");
  assert.equal(bad.code, 1);
  assert.ok(!existsSync(p("never.ofini")));
  assert.equal((await run("proto", "apply", "sample.ofini", "--ops", '{"op":"no.such"}', "--dry-run")).code, 1);
  assert.equal((await run("proto", "apply", "sample.ofini", "--ops", "{", "--dry-run")).code, 1);
  assert.equal((await run("proto", "apply", "bad.json", "--ops", '{"op":"meta.update","set":{"title":"x"}}', "--dry-run")).code, 1, "an invalid design is not edited");
});

// ------------------------------------------------------------------------------------------------ help, completion

test("help, completion and the interactive mode know the proto commands", async () => {
  assert.ok(COMMANDS.proto.subcommands === PROTO_COMMANDS);
  const h = await run("help", "proto");
  assert.equal(h.code, 0);
  for (const sub of Object.keys(PROTO_COMMANDS)) assert.match(h.out, new RegExp(`\\b${sub}\\b`));
  assert.match((await run("proto", "--help")).out, /Commands/);
  assert.match((await run("proto", "help", "lint")).out, /stale-override/);
  assert.match((await run("proto", "render", "--help")).out, /--node/);
  assert.equal(json(await run("help", "proto", "tokens", "--json")).command, "proto tokens");
  assert.deepEqual(Object.keys(json(await run("help", "proto", "--json")).subcommands), Object.keys(PROTO_COMMANDS));
  assert.equal((await run("proto")).code, 2);
  assert.equal((await run("proto", "rendr", "x")).code, 2);
  assert.equal((await run("help", "proto", "nope")).code, 2);
  assert.equal((await run("proto", "tree", "sample.ofini", "--nope")).code, 2);
  for (const sh of ["bash", "zsh", "fish", "powershell"]) {
    const s = completionScript(sh, COMMANDS);
    assert.ok(s.includes("render") && s.includes("tokens"), sh);
    assert.ok(s.includes(sh === "fish" ? "__fish_seen_subcommand_from tree\" -l boxes" : "--boxes"), `${sh}: subcommand options`);
    assert.ok(s.includes("proto"), `${sh}: new proto`);
  }
  assert.deepEqual(complete("proto re", { commands: COMMANDS, cwd: dir })[0], ["render"]);
  assert.deepEqual(complete("proto render --no", { commands: COMMANDS, cwd: dir })[0], ["--node", "--no-color"]);
  assert.deepEqual(complete("help proto li", { commands: COMMANDS, cwd: dir })[0], ["lint"]);
  assert.ok(complete("new pr", { commands: COMMANDS, cwd: dir })[0].includes("proto"));
});
