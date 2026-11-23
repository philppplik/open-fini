// Proto CSS compiler (docs/concepts/proto-studio.md §3.2, §4.1, task T2): every schema field has a CSS mapping test
// (or a test that it has none), the property allow-list, sanitizing, and variable references.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NODE_FIELDS } from "../../app/src/engine/proto/schema.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { nodeCss, treeCss, declsToText, declsToObject, PROPERTIES, boxModel, hexAlpha, fontStack, fmt, layoutOf, placementOf } from "../../app/src/engine/proto/css.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
const fx = (value) => ({ mode: "fixed", value });

/** A model with a parent "par" and one child "n"; returns the compiled child (d = declarations as an object). */
function compile(child, { parent = {}, vars = null, styles = {}, media = {}, opts = {}, extra = {} } = {}) {
  const nodes = {
    par: { id: "par", type: "frame", name: "Parent", page: "p1", parent: null, ord: "V", w: fx(400), h: fx(300), layout: { type: "none" }, ...parent },
    n: { id: "n", type: "rect", name: "Child", page: "p1", parent: "par", ord: "V", w: fx(100), h: fx(50), ...child },
    ...extra,
  };
  const model = {
    schema: 1,
    meta: { title: "t", created: "2026-11-23T00:00:00Z", unit: "px", app: "OpenFini" },
    pages: { p1: { id: "p1", name: "Page", ord: "V", bg: "#ffffff", flows: [] } },
    nodes,
    vars: vars || { collections: {}, items: {} },
    styles,
    breakpoints: [],
    code: { links: {}, tokensFile: null },
    media,
  };
  const resolver = createResolver(model);
  const tree = resolver.tree("par");
  const css = treeCss(tree, { resolver, ...opts });
  const c = css.get("n");
  return { d: declsToObject(c.decls), c, p: declsToObject(css.get("par").decls), css, tree, model };
}
const flexParent = (l = {}) => ({ parent: { layout: { type: "flex", dir: "row", ...l } }, });
const gridParent = (g = {}, l = {}) => ({ parent: { layout: { type: "grid", grid: { cols: [{ fr: 1 }], ...g }, ...l } } });

/** One test (or a statement that there is no CSS) per schema field. */
const FIELD_TESTS = {
  id: () => assert.ok(compile({}).c, "identity only; keys the element"),
  type() {
    assert.equal(compile({ type: "ellipse" }).d["border-radius"], "50%");
    assert.equal(compile({ type: "vector", d: "M0 0L10 10" }).c.svg.kind, "path");
    assert.equal(compile({ type: "line", strokes: [{ color: "#000000", w: 2 }] }).c.svg.kind, "line");
    assert.ok(compile({ type: "text", text: { runs: [{ t: "Hi" }], style: { font: "Inter" } } }).c.text);
  },
  name: () => assert.deepEqual(compile({ name: "A" }).c.decls, compile({ name: "B" }).c.decls),
  page: () => assert.ok(true, "structure: places the layer on a page, no declarations"),
  parent() {
    // the parent's layout decides how the child is positioned
    assert.equal(compile({ pos: "flow" }).d.position, "absolute");
    assert.equal(compile({ pos: "flow" }, flexParent()).d.position, "relative");
  },
  ord() {
    const { css } = compile({}, { parent: { layout: { type: "flex", dir: "row", reverseZ: true } }, extra: { m: { id: "m", type: "rect", name: "M", page: "p1", parent: "par", ord: "k", pos: "flow" } } });
    assert.equal(declsToObject(css.get("n").decls)["z-index"], "2", "order decides z-index with reverseZ");
    assert.equal(declsToObject(css.get("m").decls)["z-index"], "1");
  },
  visible: () => assert.equal(compile({ visible: false }).d.display, "none"),
  locked: () => assert.deepEqual(compile({ locked: true }).c.decls, compile({}).c.decls),
  opacity() {
    assert.equal(compile({ opacity: 0.5 }).d.opacity, "0.5");
    assert.equal(compile({ opacity: 1 }).d.opacity, undefined);
  },
  blend() {
    assert.equal(compile({ blend: "multiply" }).d["mix-blend-mode"], "multiply");
    assert.equal(compile({ blend: "normal" }).d["mix-blend-mode"], undefined);
  },
  x: () => assert.equal(compile({ x: 12 }).d.left, "12px"),
  y: () => assert.equal(compile({ y: 7 }).d.top, "7px"),
  rot: () => assert.equal(compile({ rot: 15 }).d.transform, "rotate(15deg)"),
  w() {
    assert.equal(compile({ w: fx(120) }).d.width, "120px");
    assert.equal(compile({ w: { mode: "hug" } }).d.width, "fit-content");
    assert.equal(compile({ w: { mode: "rel", value: 50 } }).d.width, "50%");
    assert.equal(compile({ w: { mode: "fill" } }).d.width, "100%");
    const f = compile({ pos: "flow", w: { mode: "fill", min: 20, max: 200 } }, flexParent()).d;
    assert.equal(f.flex, "1 1 0px");
    assert.equal(f["min-width"], "20px");
    assert.equal(f["max-width"], "200px");
    const fixed = compile({ pos: "flow", w: fx(80) }, flexParent()).d;
    assert.equal(fixed.flex, "0 0 auto");
    assert.equal(fixed["min-width"], "0px", "flow layers never get a content-based minimum");
    assert.equal(compile({ pos: "flow", w: { mode: "fill" } }, flexParent({ dir: "column" })).d["align-self"], "stretch");
    assert.equal(compile({ pos: "flow", w: { mode: "fill" } }, gridParent()).d["justify-self"], "stretch");
  },
  h() {
    assert.equal(compile({ h: fx(30) }).d.height, "30px");
    assert.equal(compile({ pos: "flow", h: { mode: "hug" } }, flexParent()).d.height, "auto");
    assert.equal(compile({ pos: "flow", h: { mode: "fill" } }, flexParent()).d["align-self"], "stretch");
    assert.equal(compile({ pos: "flow", h: { mode: "fill" } }, flexParent({ dir: "column" })).d.flex, "1 1 0px");
    assert.equal(compile({ pos: "flow", h: { mode: "rel", value: 25 } }, flexParent()).d.height, "25%");
    assert.equal(compile({ pos: "flow", h: fx(10) }, flexParent({ align: "stretch" })).d["align-self"], "flex-start", "fixed layers do not stretch");
    assert.equal(compile({ pos: "flow", h: { mode: "fill" } }, gridParent()).d["align-self"], "stretch");
    assert.equal(compile({ pos: "flow", h: { mode: "hug", min: 5, max: 9 } }, gridParent()).d["max-height"], "9px");
  },
  pos() {
    assert.equal(compile({ pos: "abs" }, flexParent()).d.position, "absolute");
    assert.equal(compile({ pos: "flow" }, gridParent()).d.position, "relative");
  },
  cx() {
    const at = (cx, w = fx(100)) => compile({ x: 50, cx, w }).d;
    assert.equal(at("left").left, "50px");
    assert.equal(at("right").right, "250px");
    assert.deepEqual([at("leftRight").left, at("leftRight").right, at("leftRight").width], ["50px", "250px", undefined]);
    assert.equal(at("center").left, "calc(50% + -150px)");
    assert.deepEqual([at("scale").left, at("scale").width], ["12.5%", "25%"]);
    assert.equal(at("right", { mode: "hug" }).left, "50px", "falls back to left without a fixed design size");
    // the parent's inside stroke (CSS border) shifts the padding box
    assert.equal(compile({ x: 50 }, { parent: { strokes: [{ color: "#000000", w: 4 }] } }).d.left, "46px");
  },
  cy() {
    const at = (cy) => compile({ y: 30, cy }).d;
    assert.equal(at("top").top, "30px");
    assert.equal(at("bottom").bottom, "220px");
    assert.deepEqual([at("topBottom").top, at("topBottom").bottom], ["30px", "220px"]);
    assert.equal(at("center").top, "calc(50% + -120px)");
    assert.deepEqual([at("scale").top, at("scale").height], ["10%", "16.667%"]);
  },
  cell() {
    const d = compile({ pos: "flow", cell: { col: 2, colSpan: 3, row: 1, justifySelf: "center", alignSelf: "end" } }, gridParent()).d;
    assert.equal(d["grid-column"], "2 / span 3");
    assert.equal(d["grid-row"], "1");
    assert.equal(d["justify-self"], "center");
    assert.equal(d["align-self"], "end");
    assert.equal(compile({ pos: "flow", cell: { rowSpan: 2 } }, gridParent()).d["grid-row"], "span 2");
  },
  sticky() {
    const d = compile({ pos: "flow", sticky: "top" }, flexParent()).d;
    assert.equal(d.position, "sticky");
    assert.equal(d.top, "0px");
  },
  tag: () => assert.deepEqual(compile({ tag: "button" }).c.decls, compile({}).c.decls, "code export only"),
  a11y: () => assert.deepEqual(compile({ a11y: { label: "x", role: "img" } }).c.decls, compile({}).c.decls, "code export only"),
  modes() {
    const vars = { collections: { c1: { name: "Color Scheme", modes: [{ id: "light", name: "L" }, { id: "dark", name: "D" }], default: "light" } }, items: {} };
    assert.deepEqual(compile({ modes: { c1: "dark" } }, { vars }).c.attrs, { "data-mode-color-scheme": "dark" });
  },
  layout() {
    const flex = compile({ type: "frame", layout: { type: "flex", dir: "column", wrap: true, gap: 8, rowGap: 4, pad: [1, 2, 3, 4], align: "center", justify: "space-between", alignContent: "end" } }).d;
    assert.equal(flex.display, "flex");
    assert.equal(flex["flex-direction"], "column");
    assert.equal(flex["flex-wrap"], "wrap");
    assert.equal(flex["row-gap"], "8px", "gap is the main-axis gap");
    assert.equal(flex["column-gap"], "4px", "rowGap is the gap between lines");
    assert.equal(flex.padding, "1px 2px 3px 4px");
    assert.equal(flex["align-items"], "center");
    assert.equal(flex["justify-content"], "space-between");
    assert.equal(flex["align-content"], "flex-end");
    const row = compile({ type: "frame", layout: { type: "flex", gap: 6 } }).d;
    assert.deepEqual([row["column-gap"], row["row-gap"], row["align-items"], row["justify-content"]], ["6px", "6px", "flex-start", "flex-start"]);
    const grid = compile({ type: "frame", layout: { type: "grid", gap: 10, rowGap: 5, align: "end", justify: "space-around", alignContent: "center", grid: { cols: [{ fr: 1 }, { px: 240 }, { auto: true }, { minmax: [200, { fr: 1 }] }], rows: [{ auto: true }, { px: 40 }], areas: ["a b", "c d"], autoFlow: "column", dense: true } } }).d;
    assert.equal(grid.display, "grid");
    assert.equal(grid["grid-template-columns"], "1fr 240px auto minmax(200px, 1fr)");
    assert.equal(grid["grid-template-rows"], "auto 40px");
    assert.equal(grid["grid-template-areas"], '"a b" "c d"');
    assert.equal(grid["grid-auto-flow"], "column dense");
    assert.deepEqual([grid["column-gap"], grid["row-gap"]], ["10px", "5px"]);
    assert.equal(grid["align-items"], "end");
    assert.equal(grid["justify-content"], "space-around");
    assert.equal(grid["align-content"], "center");
    assert.equal(compile({ type: "frame", layout: { type: "none" } }).d.display, undefined);
  },
  clip() {
    assert.equal(compile({ type: "frame", clip: true }).d.overflow, "hidden");
    assert.equal(compile({ type: "frame", clip: false }).d.overflow, undefined);
  },
  scroll() {
    assert.equal(compile({ type: "frame", scroll: "y" }).d.overflow, "hidden", "the canvas clips");
    const d = compile({ type: "frame", scroll: "y" }, { opts: { scroll: true } }).d;
    assert.deepEqual([d["overflow-x"], d["overflow-y"]], ["hidden", "auto"]);
  },
  fills() {
    assert.equal(compile({ fills: [{ type: "solid", color: "#ff0000" }] }).d["background-color"], "#ff0000");
    assert.equal(compile({ fills: [{ type: "solid", color: "#ff0000", opacity: 0.5 }] }).d["background-color"], "#ff000080");
    assert.equal(compile({ fills: [{ type: "solid", color: "#ff0000", visible: false }] }).d["background-color"], undefined);
    const layered = compile({ fills: [{ type: "solid", color: "#000000" }, { type: "linear", angle: 90, stops: [{ at: 0, color: "#fff" }, { at: 1, color: "#00000080" }] }, { type: "solid", color: "#00ff00", opacity: 0.25 }] }).d;
    assert.equal(layered["background-color"], "#000000", "the bottom fill");
    assert.equal(layered["background-image"], "linear-gradient(#00ff0040, #00ff0040), linear-gradient(90deg, #ffffff 0%, #00000080 100%)", "top first");
    assert.equal(compile({ fills: [{ type: "radial", center: [0.25, 0.75], stops: [{ at: 0, color: "#000" }, { at: 0.5, color: "#fff" }] }] }).d["background-image"], "radial-gradient(at 25% 75%, #000000 0%, #ffffff 50%)");
    assert.equal(compile({ fills: [{ type: "conic", angle: 45, stops: [{ at: 0, color: "#000" }, { at: 1, color: "#fff" }] }] }).d["background-image"], "conic-gradient(from 45deg at 50% 50%, #000000 0%, #ffffff 100%)");
    const img = compile({ fills: [{ type: "image", media: "m1", fit: "contain", pos: [0, 1] }] }, { media: { m1: { id: "m1", mime: "image/webp", name: "a.webp" } } }).d;
    assert.equal(img["background-image"], 'url("media/m1.webp")');
    assert.equal(img["background-position"], "0% 100%");
    assert.equal(img["background-size"], "contain");
    assert.equal(img["background-repeat"], "no-repeat");
    assert.equal(compile({ fills: [{ type: "image", media: "m1", fit: "tile" }] }).d["background-repeat"], "repeat");
    assert.equal(compile({ fills: [{ type: "image", media: "m1", fit: "fill" }] }).d["background-size"], "100% 100%");
  },
  strokes() {
    const inside = compile({ strokes: [{ color: "#111111", w: 2 }] }).d;
    assert.deepEqual([inside["border-width"], inside["border-style"], inside["border-color"]], ["2px", "solid", "#111111"]);
    assert.equal(compile({ strokes: [{ color: "#111111", w: 1, sides: [1, 0, 2, 0] }] }).d["border-width"], "1px 0px 2px 0px");
    assert.equal(compile({ strokes: [{ color: "#111111", w: 1, dash: [4, 2] }] }).d["border-style"], "dashed");
    const center = compile({ strokes: [{ color: "#111111", w: 4, align: "center" }] }).d;
    assert.deepEqual([center.outline, center["outline-offset"]], ["4px solid #111111", "-2px"]);
    assert.equal(compile({ strokes: [{ color: "#111111", w: 3, align: "outside" }, { color: "#222222", w: 2, align: "outside" }] }).d["box-shadow"], "0 0 0 3px #111111, 0 0 0 5px #222222");
    assert.equal(compile({ type: "text", text: { runs: [{ t: "a" }], style: { font: "Inter" } }, strokes: [{ color: "#111111", w: 1 }] }).d["-webkit-text-stroke"], "1px #111111");
    const svg = compile({ type: "vector", d: "M0 0", strokes: [{ color: "#111111", w: 1.5, dash: [2, 1] }] }).c.svg;
    assert.deepEqual([svg.stroke, svg.strokeWidth, svg.dash], ["#111111", "1.5", "2 1"]);
  },
  radius() {
    assert.equal(compile({ radius: 8 }).d["border-radius"], "8px");
    assert.equal(compile({ radius: [1, 2, 3, 4] }).d["border-radius"], "1px 2px 3px 4px");
    assert.equal(compile({ radius: 0 }).d["border-radius"], undefined);
  },
  effects() {
    const d = compile({ effects: [{ type: "shadow", x: 0, y: 4, blur: 16, spread: -2, color: "#0000001f" }, { type: "shadow", y: 1, blur: 2, color: "#000000", inset: true }, { type: "blur", radius: 3 }, { type: "backgroundBlur", radius: 8 }, { type: "shadow", blur: 9, color: "#ff0000", visible: false }] }).d;
    assert.equal(d["box-shadow"], "inset 0px 1px 2px 0px #000000, 0px 4px 16px -2px #0000001f", "the last effect paints on top");
    assert.equal(d.filter, "blur(3px)");
    assert.equal(d["backdrop-filter"], "blur(8px)");
    assert.equal(compile({ type: "text", text: { runs: [{ t: "a" }], style: { font: "Inter" } }, effects: [{ type: "shadow", x: 1, y: 1, blur: 0, color: "#000" }] }).d["text-shadow"], "1px 1px 0px #000000");
    assert.equal(compile({ type: "vector", d: "M0 0", effects: [{ type: "shadow", x: 1, y: 2, blur: 3, color: "#000" }] }).d.filter, "drop-shadow(1px 2px 3px #000000)");
  },
  style() {
    const styles = { s1: { name: "Shadow", kind: "effect", value: [{ type: "shadow", y: 2, blur: 4, color: "#000000" }] } };
    assert.equal(compile({ style: { effect: "s1" } }, { styles }).d["box-shadow"], "0px 2px 4px 0px #000000");
  },
  text() {
    const t = (text) => compile({ type: "text", w: { mode: "hug" }, h: { mode: "hug" }, text }).c;
    const c = t({ runs: [{ t: "Total " }, { t: "$4", s: { weight: 700, italic: true, color: "#ff0000", size: 20, lineHeight: { px: 30 }, tracking: 1, case: "upper", decoration: "underline", font: "Georgia" } }], style: { font: "Inter", size: 16, weight: 400, lineHeight: { pct: 150 }, tracking: -0.5, align: "center", case: "title", decoration: "strike", color: "#18181b" }, autoSize: "width" });
    const d = declsToObject(c.decls);
    assert.equal(d["font-family"], '"Inter", sans-serif');
    assert.equal(d["font-size"], "16px");
    assert.equal(d["font-weight"], "400");
    assert.equal(d["line-height"], "150%");
    assert.equal(d["letter-spacing"], "-0.5px");
    assert.equal(d["text-align"], "center");
    assert.equal(d["text-transform"], "capitalize");
    assert.equal(d["text-decoration-line"], "line-through");
    assert.equal(d.color, "#18181b");
    assert.equal(d["white-space"], "pre");
    assert.equal(d.width, "fit-content", "auto width hugs");
    assert.deepEqual(c.text.runs[0], { text: "Total ", decls: [] });
    assert.deepEqual(declsToObject(c.text.runs[1].decls), { "font-family": '"Georgia", serif', "font-size": "20px", "font-weight": "700", "font-style": "italic", "line-height": "30px", "letter-spacing": "1px", "text-transform": "uppercase", "text-decoration-line": "underline", color: "#ff0000" });
    const wrap = declsToObject(compile({ type: "text", w: fx(120), h: fx(10), text: { runs: [{ t: "x" }], style: { font: "Courier New", lineHeight: "auto" }, autoSize: "height", maxLines: 2 } }).c.decls);
    assert.deepEqual([wrap.width, wrap.height, wrap["white-space"], wrap["line-height"], wrap["font-family"]], ["120px", "auto", "pre-wrap", "normal", '"Courier New", monospace']);
    assert.deepEqual([wrap.display, wrap["-webkit-line-clamp"], wrap["-webkit-box-orient"], wrap.overflow], ["-webkit-box", "2", "vertical", "hidden"]);
    const fixed = declsToObject(compile({ type: "text", w: fx(80), h: fx(40), text: { runs: [{ t: "x" }], style: { font: "Inter" }, autoSize: "fixed" } }).c.decls);
    assert.deepEqual([fixed.width, fixed.height], ["80px", "40px"]);
  },
  d: () => assert.equal(compile({ type: "vector", d: "M4 12l5 5L20 6" }).c.svg.d, "M4 12l5 5L20 6"),
  rule: () => assert.equal(compile({ type: "vector", d: "M0 0", rule: "evenodd" }).c.svg.rule, "evenodd"),
  alt: () => assert.deepEqual(compile({ type: "image", alt: "A bag" }).c.decls, compile({ type: "image", alt: "" }).c.decls, "code export only"),
  props: () => assert.ok(true, "component properties are resolved into the expanded layers (resolve.js, T5)"),
  variant: () => instanceTest(),
  bind: () => assert.ok(true, "property bindings are resolved into the expanded layers (resolve.js, T5)"),
  of: () => instanceTest(),
  over: () => instanceTest(),
  code: () => assert.deepEqual(compile({ code: { react: { path: "x" } } }).c.decls, compile({}).c.decls, "code links do not change CSS"),
  proto: () => assert.deepEqual(compile({ proto: [{ on: { type: "click" }, do: [{ act: "back" }] }] }).c.decls, compile({}).c.decls, "interactions do not change CSS"),
};

function instanceTest() {
  const res = createResolver(SAMPLE);
  const css = treeCss(res.tree("n5"), { resolver: res });
  const root = declsToObject(css.get("n5").decls);
  assert.equal(root.padding, "12px 24px 12px 24px", "the picked variant's layout (size=lg)");
  assert.equal(root["background-color"], "#4f46e5");
}

test("css imports in plain Node without a DOM", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.ok(PROPERTIES.has("display"));
});

test("every schema field has a CSS mapping test", () => {
  for (const f of NODE_FIELDS) assert.ok(FIELD_TESTS[f], `no CSS mapping test for “${f}”`);
});

for (const [f, fn] of Object.entries(FIELD_TESTS)) test(`field ${f}`, fn);

test("every declaration is on the allow-list and safe for every node of the sample", () => {
  for (const vars of ["value", "css"]) {
    const res = createResolver(SAMPLE);
    for (const page of ["p1", "p2"]) {
      for (const root of res.page(page)) {
        for (const [, c] of treeCss(root, { resolver: res, vars, scroll: true })) {
          for (const [p, v] of [...c.decls, ...(c.text?.runs.flatMap((r) => r.decls) || [])]) {
            assert.ok(PROPERTIES.has(p), p);
            assert.doesNotMatch(v, /[;{}<>]|javascript:/);
          }
        }
      }
    }
  }
});

test("roots: canvas position, origin or none", () => {
  const res = createResolver(SAMPLE);
  const r = res.tree("n40");
  assert.equal(declsToObject(nodeCss(r).decls).left, "440px");
  assert.equal(declsToObject(nodeCss(r, { root: "origin" }).decls).left, "0px");
  assert.equal(declsToObject(nodeCss(r, { root: "none" }).decls).position, undefined);
});

test("variable references: var(--name, value) in css mode, literals otherwise; opacity through color-mix", () => {
  const res = createResolver(SAMPLE);
  const t = res.tree("n1");
  const css = treeCss(t, { resolver: res, vars: "css" });
  const root = declsToObject(css.get("n1").decls);
  assert.equal(root["background-color"], "var(--color-bg-surface, #ffffff)");
  assert.equal(root["row-gap"], "var(--space-4, 16px)");
  assert.deepEqual(css.get("n1").attrs, { "data-mode-color": "light" });
  assert.equal(declsToObject(css.get("n2").decls).color, "var(--color-text, #18181b)");
  assert.equal(declsToObject(treeCss(t, { resolver: res }).get("n1").decls)["background-color"], "#ffffff");
  const m = structuredClone(SAMPLE);
  m.nodes.n1.fills[0].opacity = 0.5;
  const r2 = createResolver(m);
  assert.equal(declsToObject(nodeCss(r2.tree("n1"), { resolver: r2, vars: "css" }).decls)["background-color"], "color-mix(in srgb, var(--color-bg-surface, #ffffff) 50%, transparent)");
  // css mode without a resolver falls back to literals
  assert.equal(declsToObject(nodeCss(r2.tree("n1"), { vars: "css" }).decls)["background-color"], "#ffffff80");
});

test("sanitizing: font names, media URLs and unknown properties", () => {
  assert.equal(fontStack('Evil"; } body { x: url(javascript:1)'), '"Evil  body  x: url(javascript:1)", sans-serif');
  const d = compile({ type: "text", text: { runs: [{ t: "a" }], style: { font: 'Evil"; } body {' } } }).d;
  assert.equal(d["font-family"], '"Evil  body", sans-serif');
  const bad = compile({ fills: [{ type: "image", media: "m1" }] }, { opts: { mediaUrl: () => 'x"); background: url(http://evil' } }).d;
  assert.equal(bad["background-image"], undefined);
  const js = compile({ fills: [{ type: "image", media: "m1" }] }, { opts: { mediaUrl: () => "javascript:alert(1)" } }).d;
  assert.equal(js["background-image"], undefined);
  const ok = compile({ fills: [{ type: "image", media: "m1" }] }, { opts: { mediaUrl: (id) => `blob:https://app.local/${id}` } }).d;
  assert.equal(ok["background-image"], 'url("blob:https://app.local/m1")');
  assert.equal(fontStack("monospace"), "monospace");
  assert.equal(fontStack(""), '"Inter", sans-serif');
});

test("helpers: number formatting, colors, layout defaults, placements and the box model", () => {
  assert.equal(fmt(1 / 3), "0.333");
  assert.equal(fmt(-0.0001), "0");
  assert.equal(hexAlpha("#abc"), "#aabbcc");
  assert.equal(hexAlpha("#aabbcc80", 0.5), "#aabbcc40");
  assert.equal(hexAlpha("red"), null);
  assert.deepEqual(layoutOf({ layout: { type: "flex", gap: 4 } }), { type: "flex", dir: "row", wrap: false, gap: 4, rowGap: 4, pad: [0, 0, 0, 0], align: "start", justify: "start", alignContent: "start", reverseZ: false, grid: { cols: [{ fr: 1 }], rows: [], areas: null, autoFlow: "row", dense: false } });
  const { tree } = compile({ x: 10, y: 20, cx: "right", cy: "center" });
  const child = tree.children[0];
  assert.deepEqual(placementOf(child, tree), { x: { mode: "end", end: 290 }, y: { mode: "center", offset: -130 } });
  const bm = boxModel(child, tree);
  assert.equal(bm.pos, "abs");
  assert.equal(boxModel(tree, null).pos, "root");
  assert.deepEqual(declsToText([["width", "1px"], ["height", "2px"]]), "width: 1px; height: 2px;");
});
