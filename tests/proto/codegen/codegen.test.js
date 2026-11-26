// Proto code export (docs/concepts/proto-studio.md §10.1, task T7): the lowering to one IR, golden files of every
// emitter (HTML + CSS, React with CSS Modules and with Tailwind, HTML + Tailwind, SwiftUI) for two designs,
// determinism, syntax checks of the generated TSX and CSS (Lezer parsers of the Code studio), the Tailwind class
// mapping, tag inference, wrapper collapsing, components with variants, props and slots, responsive breakpoint merges.
// The browser round trip (exported HTML against the recorded geometry) is tests/proto/codegen/roundtrip.test.js.
//
// Golden files: UPDATE_GOLDEN=1 npm test -- --test-name-pattern=golden rewrites them (review the diff).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { parser as jsParser } from "@lezer/javascript";
import { parser as cssParser } from "@lezer/css";
import { exportCode, lower, FORMATS, zipEntries } from "../../../app/src/engine/proto/codegen/index.js";
import { twClasses } from "../../../app/src/engine/proto/codegen/tailwind.js";
import { shortBox } from "../../../app/src/engine/proto/codegen/lower.js";
import { kebab, pascal, camel } from "../../../app/src/engine/proto/codegen/util.js";
import { createResolver } from "../../../app/src/engine/proto/resolve.js";
import { treeCss } from "../../../app/src/engine/proto/css.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const SAMPLE = read("../fixtures/schema-1/sample.json");
const KIT = read("../fixtures/codegen/kit.json");
const DESIGNS = { sample: SAMPLE, kit: KIT };

const dump = (res) => res.files.map((f) => `===== ${f.path}\n${typeof f.text === "string" ? f.text : `[${f.mime}, ${f.bytes.length} bytes]\n`}`).join("");

function golden(name, text) {
  const url = new URL(`../fixtures/codegen/${name}`, import.meta.url);
  if (process.env.UPDATE_GOLDEN) writeFileSync(url, text);
  assert.equal(text, readFileSync(url, "utf8").replace(/\r\n/g, "\n"), `${name} differs from the golden file`);
}

for (const [design, model] of Object.entries(DESIGNS))
  for (const format of FORMATS)
    test(`golden: ${design} as ${format}`, async () => {
      golden(`${design}.${format}.txt`, dump(await exportCode(structuredClone(model), { format })));
    });

test("every golden file belongs to a design and a format", () => {
  const names = readdirSync(new URL("../fixtures/codegen/", import.meta.url)).filter((f) => f.endsWith(".txt"));
  for (const n of names) {
    const [d, f] = n.replace(/\.txt$/, "").split(".");
    assert.ok(DESIGNS[d] && FORMATS.includes(f), n);
  }
});

test("exports are deterministic (same model and options, same bytes)", async () => {
  for (const format of FORMATS) {
    const a = dump(await exportCode(structuredClone(KIT), { format }));
    const b = dump(await exportCode(structuredClone(KIT), { format }));
    assert.equal(a, b, format);
  }
});

function syntaxErrors(parser, text) {
  const errs = [];
  parser.parse(text).iterate({
    enter(n) {
      if (n.type.isError) errs.push(`${n.from}: ${JSON.stringify(text.slice(Math.max(0, n.from - 40), n.to + 40))}`);
    },
  });
  return errs;
}

test("generated React (TSX and JSX) and CSS parse without syntax errors", async () => {
  const tsx = jsParser.configure({ dialect: "ts jsx" });
  const jsx = jsParser.configure({ dialect: "jsx" });
  for (const model of Object.values(DESIGNS))
    for (const format of ["react", "react-tailwind"])
      for (const ts of [true, false]) {
        const res = await exportCode(structuredClone(model), { format, ts });
        for (const f of res.files) {
          if (/\.(tsx|ts)$/.test(f.path)) assert.deepEqual(syntaxErrors(tsx, f.text), [], f.path);
          else if (/\.(jsx|js)$/.test(f.path)) assert.deepEqual(syntaxErrors(jsx, f.text), [], f.path);
          else if (f.path.endsWith(".css")) assert.deepEqual(syntaxErrors(cssParser, f.text), [], f.path);
        }
        if (!ts) assert.ok(!res.files.some((f) => /\.tsx?$/.test(f.path)), "JavaScript output has no TypeScript files");
      }
  for (const model of Object.values(DESIGNS)) {
    const res = await exportCode(structuredClone(model), { format: "html" });
    for (const f of res.files.filter((x) => x.path.endsWith(".css"))) assert.deepEqual(syntaxErrors(cssParser, f.text), [], f.path);
  }
});

test("SwiftUI output has balanced braces and parentheses", async () => {
  for (const model of Object.values(DESIGNS)) {
    const res = await exportCode(structuredClone(model), { format: "swiftui" });
    for (const f of res.files.filter((x) => x.path.endsWith(".swift"))) {
      const code = f.text.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*$/gm, "");
      for (const [o, c] of [["{", "}"], ["(", ")"], ["[", "]"]]) assert.equal(code.split(o).length, code.split(c).length, `${f.path} ${o}${c}`);
    }
  }
});

test("the IR carries exactly the canvas declarations (css.js), minus box-sizing", () => {
  const ir = lower(structuredClone(KIT), { ids: ["settings"] });
  const resolver = createResolver(KIT);
  const css = treeCss(resolver.tree("settings"), { resolver, vars: "css", root: "none", scroll: true, model: KIT, mediaUrl: () => "assets/avatar.png" });
  const visit = (n) => {
    if (n.el !== "img") {
      const want = css.get(n.key).decls.filter(([p]) => p !== "box-sizing").map(([p, v]) => [p, ["padding", "border-radius", "border-width"].includes(p) ? shortBox(v) : v]);
      const got = n.decls.filter(([p, v]) => !(p === "position" && v === "relative" && !n.r.parent) && !(n.svg && p === "overflow"));
      assert.deepEqual(got, want, n.key);
    }
    n.children.forEach(visit);
  };
  visit(ir.screens[0].root);
});

test("lowering: elements, accessibility, images, vectors, components and assets", () => {
  const ir = lower(structuredClone(KIT));
  assert.deepEqual(ir.screens.map((s) => s.name), ["Home", "Settings"]);
  const settings = ir.screens.find((s) => s.name === "Settings").root;
  assert.equal(settings.attrs["data-mode-theme"], "dark");
  const [badge, photo, icon, note] = settings.children;
  assert.deepEqual([badge.attrs["aria-label"], badge.attrs.role], ["New", "status"]);
  assert.equal(photo.el, "img");
  assert.equal(photo.image.alt, "Profile photo");
  assert.equal(photo.image.asset.url, "assets/avatar.png");
  assert.equal(icon.el, "svg");
  assert.equal(note.el, "p");
  assert.deepEqual(ir.assets.map((a) => a.file), ["avatar.png"]);
  assert.deepEqual(ir.components.map((c) => c.name), ["Button", "Card"]);
  const btn = ir.components[0];
  assert.deepEqual(btn.axes.map((a) => [a.prop, a.options, a.default]), [["size", ["sm", "lg"], "sm"]]);
  assert.deepEqual(btn.props.map((p) => [p.prop, p.type]), [["label", "text"], ["showIcon", "bool"]]);
  assert.ok(btn.shared, "both variants have the same layers");
  const card = ir.components[1];
  assert.deepEqual(card.props.map((p) => p.prop).sort(), ["children", "title"], "a single slot is children");
  assert.equal(card.variants[0].root.el, "article");
  assert.equal(card.variants[0].root.children[1].slot, "body");
  // the screen uses the components
  const home = ir.screens[0].root;
  const bar = home.children[0];
  assert.equal(bar.el, "header", "named Top bar");
  const cta = bar.children[1];
  assert.equal(cta.key, "homeCta", "the wrapper that adds nothing is gone");
  assert.equal(cta.el, "a", "a click that navigates is a link");
  assert.deepEqual(cta.href, { screen: "settings" });
  assert.deepEqual([cta.instance.comp, cta.instance.variant, cta.instance.props], ["set", { size: "lg" }, { label: "Sign up", showIcon: false }]);
  const first = home.children[2].children[0];
  assert.deepEqual(Object.keys(first.instance.slots), ["body"]);
  assert.equal(first.instance.slots.body[0].key, "homeC1b");
});

test("lowering: collapse can be turned off; dataIds marks elements", () => {
  const ir = lower(structuredClone(KIT), { ids: ["home"], collapse: false, dataIds: true });
  const bar = ir.screens[0].root.children[0];
  assert.equal(bar.children[1].key, "homeWrap");
  assert.equal(bar.children[1].attrs["data-proto-id"], "homeWrap");
});

test("lowering: breakpoint variants of a screen become @media differences", async () => {
  const ir = lower(structuredClone(KIT));
  const home = ir.screens[0];
  assert.equal(ir.screens.filter((s) => s.name.startsWith("Home")).length, 1, "the phone frame merged into Home");
  assert.deepEqual(home.media.map((m) => m.query), ["(max-width: 478px)"]);
  const css = (await exportCode(structuredClone(KIT), { format: "html" })).files.find((f) => f.path === "styles.css").text;
  assert.match(css, /@media \(max-width: 478px\) \{\n {2}\.home \{\n {4}width: 390px;/);
  const tw = (await exportCode(structuredClone(KIT), { format: "tailwind" })).files.find((f) => f.path === "home.html").text;
  assert.match(tw, /max-\[478px\]:grid-cols-\[1fr\]/);
  // frames with the same name but other layers stay separate screens
  const m = structuredClone(KIT);
  m.nodes.homeSmH.type = "rect";
  delete m.nodes.homeSmH.text;
  const ir2 = lower(m);
  assert.equal(ir2.screens.length, 3);
  assert.ok(ir2.warnings.some((w) => w.code === "breakpoint"));
});

test("lowering: tags from the model win; phrasing parents get spans; unknown tags warn", () => {
  const m = structuredClone(KIT);
  m.nodes.homeLogo.tag = "strong";
  m.nodes.homeGrid.tag = "section";
  m.nodes.homeNav.tag = "blink";
  const ir = lower(m, { ids: ["home"] });
  const [bar, , grid] = ir.screens[0].root.children;
  assert.equal(bar.el, "header", "an unknown tag falls back to the inferred element");
  assert.equal(bar.children[0].el, "strong");
  assert.equal(grid.el, "section");
  assert.ok(ir.warnings.some((w) => w.code === "tag" && w.key === "homeNav"));
  // the label inside the inlined button link is a span
  const cta = bar.children[1];
  assert.ok(cta.children.every((c) => c.el === "span"));
});

test("React: instances with overrides inside are written out; code links import existing components", async () => {
  const m = structuredClone(KIT);
  m.nodes.homeC2.over = { cardt: { fills: [{ type: "solid", color: "#ff0000" }] } };
  m.nodes.card.code = { react: { path: "src/ui/Card.tsx", export: "UiCard" } };
  const res = await exportCode(m, { format: "react", ids: ["home"] });
  const home = res.files.find((f) => f.path === "src/screens/Home.tsx").text;
  assert.match(home, /import \{ UiCard as Card \} from "src\/ui\/Card";/);
  assert.equal(home.match(/<Card /g).length, 1, "the overridden card is written out");
  assert.ok(!res.files.some((f) => f.path === "src/components/Card.tsx"), "linked components are not generated");
  assert.ok(res.warnings.some((w) => w.code === "overrides"));
});

test("Tailwind: declarations map to v4 utilities, everything else to arbitrary values", () => {
  assert.deepEqual(twClasses([["display", "flex"], ["flex-direction", "column"], ["column-gap", "16px"], ["row-gap", "16px"], ["padding", "8px 12px"], ["width", "320px"], ["height", "fit-content"]]), ["flex", "flex-col", "gap-4", "py-2", "px-3", "w-80", "h-fit"]);
  assert.deepEqual(twClasses([["width", "1280px"], ["left", "-8px"], ["top", "7px"], ["min-width", "0px"], ["flex", "1 1 0px"], ["flex", "0 0 auto"]]).slice(0, 4), ["w-[1280px]", "-left-2", "top-[7px]", "min-w-0"]);
  assert.deepEqual(twClasses([["background-color", "var(--color-brand, #4f46e5)"], ["color", "#ffffff"], ["font-size", "calc(var(--x, 2) * 1px)"], ["font-weight", "600"], ["border-radius", "50%"]]), ["bg-[color:var(--color-brand,#4f46e5)]", "text-[#ffffff]", "text-[length:calc(var(--x,2)_*_1px)]", "font-semibold", "rounded-[50%]"]);
  assert.deepEqual(twClasses([["display", "-webkit-box"], ["-webkit-box-orient", "vertical"], ["-webkit-line-clamp", "2"], ["overflow", "hidden"]]), ["line-clamp-2"]);
  assert.deepEqual(twClasses([["font-family", '"Times New Roman", serif'], ["background-image", "url(\"a_b.png\")"]]), ["[font-family:'Times_New_Roman',serif]", "[background-image:url('a\\_b.png')]"]);
  assert.deepEqual(twClasses([["transform", "rotate(-15deg)"], ["opacity", "0.5"], ["grid-column", "1 / span 2"]]), ["-rotate-[15deg]", "opacity-50", "col-[1_/_span_2]"]);
});

test("names: kebab, Pascal and camel identifiers are safe", () => {
  assert.equal(kebab("Pay button 2"), "pay-button-2");
  assert.equal(kebab("2 columns"), "layer-2-columns");
  assert.equal(kebab("✓"), "layer");
  assert.equal(pascal("size=md, state=hover"), "SizeMdStateHover");
  assert.equal(pascal("über card"), "UberCard");
  assert.equal(camel("Show icon"), "showIcon");
  assert.equal(camel("default"), "defaultProp");
  assert.equal(shortBox("1px 2px 1px 2px"), "1px 2px");
  assert.equal(shortBox("var(--a, 4px) 4px var(--a, 4px) 4px"), "var(--a, 4px) 4px");
});

test("exportCode: unknown formats are refused; ZIP entries cover every file", async () => {
  await assert.rejects(exportCode(KIT, { format: "vue" }), /Unknown export format/);
  const m = structuredClone(KIT);
  m.media.mAvatar.bytes = new Uint8Array([137, 80, 78, 71]);
  const res = await exportCode(m, { format: "html" });
  const z = zipEntries(res);
  assert.deepEqual(Object.keys(z).sort(), res.files.map((f) => f.path).sort());
  assert.deepEqual([...z["assets/avatar.png"]], [137, 80, 78, 71]);
  assert.ok(!res.warnings.some((w) => w.code === "media-bytes"));
});
