// Proto importers (task T8): HTML (static path and browser probe trees), the sanitizer, SVG, Sketch, Penpot, images,
// placement and the input limits. Fixtures are synthetic (tests/proto/import/fixtures.js).
import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../../../app/vendor/fflate/fflate.js";
import { emptyDocument } from "../../../app/src/engine/proto/schema.js";
import { applyAll, apply } from "../../../app/src/engine/proto/ops.js";
import { validate } from "../../../app/src/engine/proto/validate.js";
import { seededRandom } from "../../../app/src/engine/proto/ids.js";
import { createResolver } from "../../../app/src/engine/proto/resolve.js";
import { readSketch } from "../../../app/src/engine/formats/sketch.js";
import { importInto, importImage, applyImport, designFromImport, detectFormat } from "../../../app/src/engine/proto/import/index.js";
import { importHtml, mapProbe, tracks } from "../../../app/src/engine/proto/import/html.js";
import { sanitizeHtml } from "../../../app/src/engine/proto/import/sanitize.js";
import { importSvg } from "../../../app/src/engine/proto/import/svg.js";
import { safeUnzip, createBuilder, ImportReport, IMPORT_LIMITS } from "../../../app/src/engine/proto/import/common.js";
import { exportHtml } from "./_export.js";
import { sketchFixture, penpotFixture, PNG } from "./fixtures.js";

const blank = () => emptyDocument({ pageId: "p1", created: "2026-01-01T00:00:00Z" });
/** Applies an import to a blank design; checks validity; returns { model, result }. */
function run(result, model = blank()) {
  const out = applyAll(model, applyImport(result, { page: "p1" })).model;
  const v = validate(out);
  assert.deepEqual(v.errors, [], "the imported design is valid");
  return out;
}
const kids = (m, id) => Object.values(m.nodes).filter((n) => n.parent === id).sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0));
const byName = (m, name) => Object.values(m.nodes).find((n) => n.name === name);
const textOf = (n) => n.text.runs.map((r) => r.t).join("");

// ------------------------------------------------------------------------------------------------ sanitizer

test("sanitizer: scripts, event handlers, javascript: URLs, embeds and remote resources are removed", () => {
  const dirty = `<div onclick="steal()" onmouseover='x()'>Hi<script>alert(1)</script><a href="javascript:alert(2)">a</a><a href="https://example.com">b</a>
<img src="https://tracker.example/p.png" onerror="x()"><img src="data:image/png;base64,AAAA"><iframe src="https://x"></iframe><object data="x"></object>
<style>@import url(https://evil/x.css); .a{background:url(https://evil/b.png);width:expression(alert(1))}</style><svg onload="x()"><foreignObject><p>x</p></foreignObject><use href="https://evil/s.svg#a"/></svg>
<base href="https://evil/"><meta http-equiv="refresh" content="0;url=https://evil"><form action="https://evil"><button formaction="https://evil">x</button></form><SCRIPT>bad()</SCRIPT></div>`;
  const report = new ImportReport("HTML");
  const { html, removed } = sanitizeHtml(dirty, { report });
  for (const bad of ["<script", "<SCRIPT", "onclick", "onmouseover", "onerror", "onload", "javascript:", "iframe", "<object", "@import", "https://evil", "https://tracker", "expression(", "foreignObject", "<base", "http-equiv", "formaction", "action="]) assert.ok(!html.toLowerCase().includes(bad.toLowerCase()), `removed: ${bad}`);
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'), "embedded images stay");
  assert.ok(html.includes('data-href="https://example.com"'), "remote links become inert data");
  assert.ok(removed.scripts >= 2 && removed.handlers >= 4 && removed.urls >= 1 && removed.embeds >= 3 && removed.remote >= 3);
  assert.ok(report.by("dropped").some((t) => /Scripts were removed/.test(t)));
});

test("sanitizer: entity-encoded and mixed-case tricks do not survive", () => {
  const { html } = sanitizeHtml(`<a href="&#106;avascript:alert(1)">x</a><a href=" JaVaScRiPt:alert(1)">y</a><img src="data:text/html,<script>alert(1)</script>"><div OnClIcK="x()">z</div>`);
  assert.ok(!/javascript/i.test(html));
  assert.ok(!/onclick/i.test(html));
  assert.ok(!/text\/html/i.test(html));
});

// ------------------------------------------------------------------------------------------------ HTML (static path)

test("HTML static path: flex, grid, text runs, decorated text, variables and a report", () => {
  const html = `<!doctype html><html><head><title>Login</title><style>
    :root { --brand: #4f46e5; --space-4: 16px }
    body { margin: 0; font-family: Inter, sans-serif }
    .card { display: flex; flex-direction: column; gap: 12px; padding: 24px; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; width: 360px; box-shadow: 0 4px 16px rgba(0,0,0,.1) }
    .row { display: flex; justify-content: space-between; align-items: center }
    .btn { background: var(--brand); color: #fff; padding: 8px 16px; border: 0; border-radius: 8px }
    .grid { display: grid; grid-template-columns: 1fr repeat(2, 120px) minmax(80px, 1fr); gap: 8px 4px }
    .grow { flex: 1 }
    a:hover { color: red }
  </style></head><body><main class="card"><h1>Sign <b style="color:#4f46e5">in</b></h1><p>Welcome back</p>
  <div class="row"><span>Remember</span><span class="grow">x</span><button class="btn" onclick="alert(1)">Go</button></div>
  <div class="grid"><div>A</div><div>B</div></div><script>alert(2)</script></main></body></html>`;
  const r = importHtml(html, { model: blank(), width: 800, random: seededRandom(3) });
  const m = run(r);
  const page = m.nodes[r.roots[0]];
  assert.equal(page.name, "Login");
  assert.equal(page.w.value, 800);
  const card = byName(m, "Card");
  assert.equal(card.tag, "main");
  assert.deepEqual([card.layout.type, card.layout.dir, card.layout.gap, card.layout.pad], ["flex", "column", 12, [24, 24, 24, 24]]);
  assert.deepEqual(card.w, { mode: "fixed", value: 360 });
  assert.equal(card.radius, 12);
  assert.deepEqual(card.strokes, [{ color: "#e4e4e7", w: 1, align: "inside" }]);
  assert.equal(card.effects[0].type, "shadow");
  assert.equal(card.effects[0].color, "#0000001a");
  const title = kids(m, card.id)[0];
  assert.equal(title.type, "text");
  assert.equal(title.tag, "h1");
  assert.deepEqual(title.text.runs.map((x) => x.t), ["Sign ", "in"]);
  assert.equal(title.text.style.size, 32);
  assert.equal(title.text.style.weight, 700);
  assert.ok(title.text.runs[1].s.color, "the second run has its own color");
  const row = byName(m, "Row");
  assert.deepEqual([row.layout.justify, row.layout.align], ["space-between", "center"]);
  const [remember, grow, btn] = kids(m, row.id);
  assert.deepEqual(remember.w, { mode: "hug" });
  assert.equal(grow.w.mode, "fill", "flex: 1 fills the main axis");
  assert.equal(btn.type, "frame", "decorated text becomes a frame around a text layer");
  assert.deepEqual(btn.fills, [{ type: "solid", color: { $var: Object.keys(m.vars.items).find((k) => m.vars.items[k].name === "brand") } }], "the color equal to --brand is bound");
  assert.equal(textOf(kids(m, btn.id)[0]), "Go");
  const grid = Object.values(m.nodes).find((n) => n.layout?.type === "grid");
  assert.deepEqual(grid.layout.grid.cols, [{ fr: 1 }, { px: 120 }, { px: 120 }, { minmax: [80, { fr: 1 }] }]);
  assert.deepEqual([grid.layout.gap, grid.layout.rowGap], [4, 8]);
  assert.equal(Object.values(m.vars.items).length, 2);
  assert.ok(r.report.by("dropped").some((t) => /Scripts/.test(t)));
  assert.ok(r.report.by("note").some((t) => /static path/.test(t)));
  assert.ok(r.report.by("note").some((t) => /selector/.test(t)), "the :hover rule is reported");
});

test("HTML: export → import → export is stable for the fixtures (data-proto-id keeps the ids)", () => {
  let m = blank();
  m = apply(m, {
    op: "node.create", type: "frame", page: "p1", id: "n1",
    fields: { name: "Card", x: 40, y: 60, w: { mode: "fixed", value: 360 }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: 12, pad: [24, 24, 24, 24], align: "stretch", justify: "start" }, fills: [{ type: "solid", color: "#ffffff" }], radius: 12, strokes: [{ color: "#e4e4e7", w: 1, align: "inside" }], effects: [{ type: "shadow", x: 0, y: 4, blur: 16, spread: -2, color: "#0000001f" }] },
    children: [
      { type: "text", id: "n2", fields: { name: "Title", w: { mode: "fill" }, text: { runs: [{ t: "Hello ", s: {} }, { t: "world", s: { weight: 700, color: "#4f46e5" } }], style: { font: "Inter", size: 24, weight: 400, lineHeight: { pct: 150 }, tracking: 0, align: "left", color: "#18181b" }, autoSize: "height", maxLines: null } } },
      { type: "frame", id: "n3", fields: { name: "Row", w: { mode: "fill" }, h: { mode: "hug" }, layout: { type: "flex", dir: "row", gap: 8, pad: [0, 0, 0, 0], align: "center", justify: "space-between" }, fills: [], clip: false }, children: [
        { type: "rect", id: "n4", fields: { name: "Dot", w: { mode: "fixed", value: 12 }, h: { mode: "fixed", value: 12 }, fills: [{ type: "solid", color: "#22c55e" }], radius: 6 } },
        { type: "text", id: "n5", fields: { name: "Label", text: { runs: [{ t: "Online", s: {} }], style: { font: "Inter", size: 14, weight: 500, lineHeight: { pct: 150 }, tracking: 0, align: "left", color: "#52525b" }, autoSize: "width", maxLines: null } } },
        { type: "frame", id: "n6", fields: { name: "Grow", w: { mode: "fill" }, h: { mode: "fixed", value: 4 }, fills: [{ type: "linear", angle: 90, stops: [{ at: 0, color: "#6366f1" }, { at: 1, color: "#a855f7" }] }], clip: false, layout: { type: "none" } } },
      ] },
      { type: "frame", id: "n7", fields: { name: "Grid", w: { mode: "fill" }, h: { mode: "hug" }, layout: { type: "grid", gap: 8, rowGap: 4, pad: [0, 0, 0, 0], align: "start", justify: "start", grid: { cols: [{ fr: 1 }, { px: 120 }], rows: [], autoFlow: "row" } }, fills: [], clip: false }, children: [
        { type: "rect", id: "n8", fields: { name: "A", w: { mode: "fill" }, h: { mode: "fixed", value: 20 }, fills: [{ type: "solid", color: "#e4e4e7" }] } },
        { type: "rect", id: "n9", fields: { name: "B", w: { mode: "fixed", value: 60 }, h: { mode: "fixed", value: 20 }, fills: [{ type: "solid", color: "#d4d4d8" }], opacity: 0.5 } },
      ] },
      { type: "ellipse", id: "n10", fields: { name: "Badge", pos: "abs", x: 300, y: 8, w: { mode: "fixed", value: 16 }, h: { mode: "fixed", value: 16 }, fills: [{ type: "solid", color: "#ef4444" }] } },
    ],
  }).model;
  m = apply(m, { op: "node.create", type: "frame", page: "p1", id: "n20", fields: { name: "Second", x: 500, y: 60, w: { mode: "fixed", value: 200 }, h: { mode: "fixed", value: 100 }, layout: { type: "none" }, fills: [{ type: "solid", color: "#fafafa" }], clip: true } }).model;
  const first = exportHtml(m);
  const r = importHtml(first, { model: blank(), random: seededRandom(1) });
  const m2 = run(r);
  assert.deepEqual(r.roots, ["n1", "n20"], "both top-level layers keep their ids");
  const second = exportHtml(m2);
  assert.equal(second, first);
  // and once more: a fixed point
  const m3 = run(importHtml(second, { model: blank(), random: seededRandom(2) }));
  assert.equal(exportHtml(m3), first);
});

test("HTML: margins become gaps and padding; absolute children keep their positions", () => {
  const r = importHtml(`<body style="margin:0"><section style="width:400px;padding:10px;position:relative"><p style="margin:8px 0">One</p><p style="margin:8px 0">Two</p><div style="position:absolute;left:20px;top:30px;width:50px;height:40px;background:red"></div></section></body>`, { model: blank(), random: seededRandom(5) });
  const m = run(r);
  const sec = byName(m, "Section");
  assert.deepEqual([sec.layout.type, sec.layout.dir, sec.layout.gap], ["flex", "column", 8]);
  assert.deepEqual(sec.layout.pad, [18, 10, 18, 10]);
  const abs = kids(m, sec.id).find((n) => n.pos === "abs");
  assert.deepEqual([abs.x, abs.y, abs.w.value, abs.h.value, abs.fills[0].color], [20, 30, 50, 40, "#ff0000"]);
});

// ------------------------------------------------------------------------------------------------ HTML (probe trees)

test("HTML probe path: computed styles and boxes from the sandboxed preview map exactly", () => {
  const s = (o) => ({ display: "block", position: "static", "font-family": "Inter", "font-size": "16px", "font-weight": "400", color: "rgb(24, 24, 27)", "line-height": "24px", ...o });
  const probe = {
    tag: "body", attrs: {}, style: s({ "background-color": "rgb(250, 250, 250)" }), decl: {}, box: { x: 0, y: 0, w: 800, h: 300 }, title: "Probe", viewport: { w: 800, h: 600 },
    kids: [
      {
        tag: "nav", attrs: { "aria-label": "Main" }, style: s({ display: "flex", "flex-direction": "row", "column-gap": "16px", "row-gap": "normal", "align-items": "center", "justify-content": "flex-start", "padding-top": "8px", "padding-right": "8px", "padding-bottom": "8px", "padding-left": "8px" }), decl: { height: "56px" }, box: { x: 0, y: 0, w: 800, h: 56 },
        kids: [
          { tag: "a", attrs: {}, style: s({ display: "inline" }), decl: {}, box: { x: 8, y: 16, w: 40, h: 24 }, kids: [{ text: "Home" }] },
          { tag: "img", attrs: { src: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, alt: "Logo" }, style: s({ display: "inline-block", "object-fit": "contain" }), decl: { width: "32px" }, box: { x: 64, y: 12, w: 32, h: 32 }, kids: [] },
          { tag: "span", attrs: {}, style: s({ display: "inline", position: "absolute", "font-weight": "700" }), decl: {}, box: { x: 700, y: 20, w: 50, h: 24 }, kids: [{ text: "Abs" }] },
        ],
      },
      { tag: "svg", attrs: {}, style: s({ display: "inline" }), decl: { width: "24px", height: "24px" }, box: { x: 0, y: 60, w: 24, h: 24 }, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h20v20H2z" fill="#111"/></svg>', kids: [] },
    ],
  };
  const report = new ImportReport("HTML");
  const b = createBuilder(blank(), { random: seededRandom(9), report });
  const roots = mapProbe(probe, { builder: b, report, width: 800, exact: true });
  roots.forEach((t) => b.add(t, { page: null }));
  const m = run({ ops: b.ops(), roots: roots.map((x) => x.id), pages: [], report });
  const page = m.nodes[roots[0].id];
  assert.deepEqual([page.w.value, page.h.value], [800, 600]);
  const nav = byName(m, "Main");
  assert.equal(nav.tag, "nav");
  assert.deepEqual([nav.layout.dir, nav.layout.gap, nav.layout.align], ["row", 16, "center"]);
  assert.deepEqual(nav.h, { mode: "fixed", value: 56 });
  const [home, logo, abs] = kids(m, nav.id);
  assert.equal(textOf(home), "Home");
  assert.equal(logo.type, "image");
  assert.equal(logo.fills.at(-1).type, "image");
  assert.equal(logo.fills.at(-1).fit, "contain");
  assert.equal(Object.keys(m.media).length, 1);
  assert.deepEqual([abs.pos, abs.x, abs.y], ["abs", 700, 20]);
  const svg = kids(m, page.id).find((n) => n.type === "frame" && n.name !== "Main");
  assert.equal(kids(m, svg.id)[0].type, "vector");
  assert.equal(kids(m, svg.id)[0].fills[0].color, "#111111");
});

test("grid tracks parse fr, px, auto, minmax and repeat", () => {
  assert.deepEqual(tracks("repeat(2, 1fr) 200px auto minmax(100px, 2fr)"), [{ fr: 1 }, { fr: 1 }, { px: 200 }, { auto: true }, { minmax: [100, { fr: 2 }] }]);
  assert.deepEqual(tracks("none"), []);
});

// ------------------------------------------------------------------------------------------------ SVG

test("SVG: shapes, groups, gradients, text, images; scripts and filters are reported", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" width="200" height="100">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff0000"/><stop offset="100%" stop-color="blue" stop-opacity=".5"/></linearGradient>
    <symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="green"/></symbol><style>.st{stroke:#333;stroke-width:2}</style></defs>
    <rect id="bg" x="10" y="10" width="20" height="10" rx="2" fill="url(#g)" class="st"/>
    <g id="pair" transform="rotate(45 50 25)" opacity="0.5" filter="url(#f)"><circle cx="50" cy="25" r="5" fill="green"/><path d="M0 0L10 10" stroke="red" fill="none"/></g>
    <use xlink:href="#dot" x="80" y="0" width="10" height="10"/>
    <text x="5" y="45" font-size="8" font-weight="bold">Hi there</text>
    <image href="data:image/png;base64,${Buffer.from(PNG).toString("base64")}" x="60" y="30" width="10" height="10"/>
    <image href="https://example.com/a.png" x="0" y="0" width="1" height="1"/>
    <script>alert(1)</script></svg>`;
  const r = importSvg(svg, { model: blank(), name: "icons.svg", random: seededRandom(4) });
  const m = run(r);
  const root = m.nodes[r.roots[0]];
  assert.deepEqual([root.name, root.w.value, root.h.value, root.layout.type], ["icons", 200, 100, "none"]);
  const bg = byName(m, "bg");
  assert.equal(bg.type, "rect");
  assert.deepEqual([bg.x, bg.y, bg.w.value, bg.h.value, bg.radius], [20, 20, 40, 20, 4]);
  assert.equal(bg.fills[0].type, "linear");
  assert.equal(bg.fills[0].angle, 180);
  assert.equal(bg.fills[0].stops[1].color, "#0000ff80");
  assert.deepEqual(bg.strokes, [{ color: "#333333", w: 4, align: "center" }]);
  const pair = byName(m, "pair");
  assert.equal(pair.type, "frame");
  assert.equal(pair.opacity, 0.5);
  assert.ok(kids(m, pair.id).every((n) => n.type === "vector" && n.d.startsWith("M")), "rotated shapes become vectors with the transform applied");
  const text = Object.values(m.nodes).find((n) => n.type === "text");
  assert.equal(textOf(text), "Hi there");
  assert.equal(text.text.style.weight, 700);
  assert.equal(Object.values(m.nodes).filter((n) => n.type === "image").length, 1);
  assert.ok(Object.values(m.nodes).some((n) => n.type === "ellipse" && n.fills[0].color === "#008000" && n.x === 160), "a <use> of a symbol is expanded");
  const dropped = r.report.by("dropped").join(" ");
  assert.match(dropped, /Scripts/);
  assert.match(dropped, /filters/);
  assert.match(dropped, /External/);
});

test("SVG: invalid input is refused with a message", () => {
  assert.throws(() => importSvg("<html></html>", { model: blank() }), /not a valid SVG/);
});

// ------------------------------------------------------------------------------------------------ Sketch

test("Sketch: symbols become components, instances keep overrides, stacks become auto layout", () => {
  const r = importInto(blank(), { name: "kit.sketch", bytes: sketchFixture(), random: seededRandom(7) });
  const m = run(r);
  assert.equal(r.pages.length, 2);
  assert.deepEqual(Object.values(m.pages).map((p) => p.name).sort(), ["Page 1", "Screens", "Symbols"]);
  const comps = Object.values(m.nodes).filter((n) => n.type === "component");
  assert.deepEqual(comps.map((c) => c.name).sort(), ["Button", "Icon/Heart", "Icon/Star"]);
  const btn = comps.find((c) => c.name === "Button");
  assert.deepEqual([btn.layout.type, btn.layout.dir, btn.layout.gap, btn.layout.pad, btn.layout.justify, btn.layout.align], ["flex", "row", 8, [8, 16, 8, 16], "center", "center"]);
  assert.equal(btn.fills[0].color, "#4f46e5");
  const label = kids(m, btn.id).find((n) => n.type === "text");
  assert.deepEqual(label.w, { mode: "hug" }, "fit sizing in a stack hugs");
  const primary = byName(m, "Primary");
  assert.equal(primary.type, "instance");
  assert.equal(primary.of, btn.id);
  const iconInBtn = kids(m, btn.id).find((n) => n.type === "instance");
  assert.equal(primary.over[label.id].text.runs[0].t, "Sign in");
  assert.equal(primary.over[iconInBtn.id].of, comps.find((c) => c.name === "Icon/Heart").id, "a nested symbol swap becomes `of`");
  const secondary = byName(m, "Secondary");
  assert.equal(secondary.over[iconInBtn.id].visible, false, "an empty symbol override hides the layer");
  // the resolver applies the overrides
  const tree = createResolver(m).tree(primary.id);
  const resolvedLabel = tree.children.find((c) => c.type === "text");
  assert.equal(textOf(resolvedLabel.node), "Sign in");
  const card = byName(m, "Card");
  assert.deepEqual([card.type, card.radius, card.strokes[0].align, card.effects[0].type], ["rect", 12, "inside", "shadow"]);
  const photo = byName(m, "Photo");
  assert.equal(photo.fills[0].type, "image");
  assert.ok(m.media[photo.fills[0].media].bytes.length > 0);
  assert.match(byName(m, "Library thing (missing symbol)").name, /missing/);
  assert.match(r.report.by("dropped").join(" "), /override/);
  assert.match(r.report.by("kept").join(" "), /3 symbols as components and 3 symbol instances/);
});

test("Sketch: the Vector studio's reading is unchanged without the symbols option", () => {
  const s = readSketch(sketchFixture());
  assert.ok(s.warnings.some((w) => /Symbol instances were not expanded/.test(w)));
  assert.ok(s.warnings.some((w) => /Symbol masters were imported as artboards/.test(w)));
  const screen = s.pages[0].artboards[0];
  assert.equal(screen.items.find((i) => i.kind === "text").id, undefined, "no Proto-only fields");
});

test("Sketch: everything on the current page side by side", () => {
  const r = importInto(blank(), { name: "kit.sketch", bytes: sketchFixture(), random: seededRandom(8), pages: "current" });
  const m = run(r);
  assert.equal(r.pages.length, 0);
  assert.ok(Object.values(m.nodes).every((n) => n.page === "p1"));
});

// ------------------------------------------------------------------------------------------------ Penpot

test("Penpot: boards with flex layout, text runs, images, a component and its copy with overrides", () => {
  const r = importInto(blank(), { name: "login.penpot", bytes: penpotFixture(), random: seededRandom(11) });
  const m = run(r);
  assert.equal(r.pages.length, 1);
  const page = Object.values(m.pages).find((p) => p.name === "Screens");
  assert.ok(page);
  const login = byName(m, "Login");
  assert.deepEqual([login.x, login.y, login.layout.type, login.layout.dir, login.layout.gap, login.layout.pad, login.radius], [100, 50, "flex", "column", 12, [24, 24, 24, 24], 16]);
  assert.equal(login.effects[0].color, "#00000026");
  const title = byName(m, "Title");
  assert.deepEqual(title.text.runs.map((x) => x.t), ["Hello ", "Penpot"]);
  assert.deepEqual(title.text.runs[1].s, { weight: 700, color: "#6d28d9" });
  assert.deepEqual(title.w, { mode: "fill" });
  assert.equal(title.text.autoSize, "height");
  const comp = Object.values(m.nodes).find((n) => n.type === "component");
  assert.equal(comp.name, "Button");
  const copy = Object.values(m.nodes).find((n) => n.type === "instance");
  assert.equal(copy.of, comp.id);
  assert.equal(copy.pos, "flow");
  const mainLabel = kids(m, comp.id)[0];
  assert.equal(copy.over[mainLabel.id].text.runs[0].t, "Continue");
  const logo = byName(m, "Logo");
  assert.equal(logo.fills[0].type, "image");
  assert.ok(m.media[logo.fills[0].media]);
  assert.ok(r.report.by("note").some((t) => /tokens\.json/.test(t)));
});

test("Penpot: other archives and the old binary format are refused", () => {
  assert.throws(() => importInto(blank(), { name: "x.penpot", bytes: strToU8("not a zip") }), /current format/);
  assert.throws(() => importInto(blank(), { name: "x.penpot", bytes: zipSync({ "a.txt": strToU8("x") }) }), /not a Penpot export/);
});

// ------------------------------------------------------------------------------------------------ images, placement, CLI model

test("images: one image layer at the pixel size; placement into a parent and at a point", () => {
  let m = blank();
  m = apply(m, { op: "node.create", type: "frame", page: "p1", id: "nf", fields: { layout: { type: "flex", dir: "row", gap: 0 } } }).model;
  const r = importImage(m, { bytes: PNG, name: "dot.png", random: seededRandom(2) });
  assert.equal(r.size.w, 1);
  const inFlex = applyAll(m, applyImport(r, { page: "p1", parent: "nf", flow: true })).model;
  const img = inFlex.nodes[r.roots[0]];
  assert.deepEqual([img.parent, img.pos, img.x], ["nf", "flow", undefined]);
  const placed = applyAll(m, applyImport(r, { page: "p1", at: [300, 40] })).model;
  assert.deepEqual([placed.nodes[r.roots[0]].x, placed.nodes[r.roots[0]].y], [300, 40]);
  assert.throws(() => importImage(m, { bytes: strToU8("nope") }), /not supported/);
});

test("designFromImport builds a new design (the CLI path) and drops the empty first page", () => {
  const model = emptyDocument({ title: "kit", random: seededRandom(1) });
  const r = importInto(model, { name: "kit.sketch", bytes: sketchFixture(), random: seededRandom(1) });
  const out = designFromImport(model, r);
  assert.equal(Object.keys(out.pages).length, 2);
  assert.deepEqual(validate(out).errors, []);
});

test("formats: detection and the .fig refusal", () => {
  assert.equal(detectFormat("a.html"), "html");
  assert.equal(detectFormat("x", strToU8("<svg xmlns='http://www.w3.org/2000/svg'/>")), "svg");
  assert.equal(detectFormat("x", PNG), "image");
  assert.equal(detectFormat("x", sketchFixture()), "sketch");
  assert.equal(detectFormat("x", penpotFixture()), "penpot");
  assert.equal(detectFormat("x", strToU8("<!doctype html><p>x")), "html");
  assert.throws(() => importInto(blank(), { name: "design.fig", bytes: strToU8("fig-kiwi") }), /no public specification/);
  assert.throws(() => importInto(blank(), { name: "a.xyz", bytes: strToU8("??") }), /not recognized/);
});

// ------------------------------------------------------------------------------------------------ limits

test("limits: oversized inputs, zip bombs and too many layers are refused", () => {
  assert.throws(() => importHtml("x".repeat(IMPORT_LIMITS.html + 1), { model: blank() }), /larger than/);
  assert.throws(() => importSvg(`<svg>${" ".repeat(IMPORT_LIMITS.svg)}</svg>`, { model: blank() }), /larger than/);
  // a highly compressible entry: 12 MiB of zeros in an archive of a few KiB
  const bomb = zipSync({ "document.json": new Uint8Array(1024), "pages/a.json": new Uint8Array(12 * 1048576) }, { level: 9 });
  assert.throws(() => safeUnzip(bomb, { limits: { ...IMPORT_LIMITS, ratioFloor: 1048576, ratio: 50 } }), /hostile/);
  assert.throws(() => safeUnzip(bomb, { limits: { ...IMPORT_LIMITS, entry: 1048576 } }), /hostile/);
  const many = `<body>${"<div style='display:flex'><span>x</span></div>".repeat(300)}</body>`;
  const b = createBuilder(blank(), { maxNodes: 100 });
  assert.throws(() => importHtml(many, { model: blank(), builder: b }), /more than 100 layers/);
});
