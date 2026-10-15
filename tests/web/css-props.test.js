import test from "node:test";
import assert from "node:assert/strict";
import {
  STYLE_SECTIONS, parseLength, formatLength, expandBox, collapseBox, parseColor, formatColor, parseShadowList, formatShadowList, parseGradient,
  formatGradient, parseTransition, formatTransition, FONT_STACKS, BREAKPOINTS, mediaForBreakpoint, breakpointForWidth, breakpointForMedia,
  getPropDef, isPropVisible,
} from "../../app/src/engine/web/css-props.js";
import { parseCss } from "../../app/src/engine/web/css.js";

test("STYLE_SECTIONS covers the required properties in the required order", () => {
  assert.deepEqual(STYLE_SECTIONS.map((s) => s.id), ["layout", "spacing", "size", "position", "typography", "backgrounds", "borders", "effects"]);
  const all = new Map();
  for (const s of STYLE_SECTIONS) for (const p of s.props) all.set(p.prop, p);
  const required = [
    "display", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "gap", "row-gap", "column-gap", "grid-template-columns",
    "grid-template-rows", "flex-grow", "flex-shrink", "flex-basis", "align-self", "order", "overflow", "margin", "padding", "width", "height", "min-width",
    "min-height", "max-width", "max-height", "aspect-ratio", "object-fit", "position", "top", "right", "bottom", "left", "z-index", "float", "clear",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "text-align", "font-style", "text-decoration", "text-transform",
    "white-space", "text-overflow", "text-shadow", "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "background-attachment", "border-style", "border-width", "border-color", "border-radius", "outline", "opacity", "box-shadow", "transform", "transition",
    "filter", "backdrop-filter", "cursor", "mix-blend-mode", "pointer-events", "visibility",
  ];
  for (const p of required) assert.ok(all.has(p), `missing ${p}`);
  const types = new Set(["keyword", "segmented", "length", "number", "color", "box", "font-family", "font-weight", "shadow", "gradient", "text", "toggle"]);
  for (const def of all.values()) {
    assert.ok(def.label && types.has(def.type), def.prop);
    if (def.type === "keyword" || def.type === "segmented") assert.ok(def.options && def.options.length >= 2, def.prop);
    if (def.type === "box" && def.prop !== "border-style" && def.prop !== "border-color") assert.equal(def.longhands.length, 4);
    if (def.type === "box") assert.equal(def.longhands.length, 4, def.prop);
    for (const o of def.options || []) assert.ok(o.value && o.label);
    if (def.when) assert.ok(all.has(def.when.prop) && def.when.in.length);
  }
  assert.deepEqual(all.get("display").options.map((o) => o.value), ["block", "flex", "grid", "inline-block", "inline", "none"]);
  assert.deepEqual(all.get("flex-direction").when, { prop: "display", in: ["flex", "inline-flex"] });
  assert.equal(getPropDef("margin-left").prop, "margin");
  assert.equal(getPropDef("nope"), null);
  assert.equal(isPropVisible(all.get("flex-direction"), (p) => (p === "display" ? "flex" : null)), true);
  assert.equal(isPropVisible(all.get("flex-direction"), (p) => (p === "display" ? "block" : null)), false);
  assert.equal(isPropVisible(all.get("flex-direction"), () => null), false);
  assert.equal(isPropVisible(all.get("width"), () => null), true);
});

test("lengths", () => {
  assert.deepEqual(parseLength("12px"), { n: 12, unit: "px" });
  assert.deepEqual(parseLength(" 1.5rem "), { n: 1.5, unit: "rem" });
  assert.deepEqual(parseLength("50%"), { n: 50, unit: "%" });
  assert.deepEqual(parseLength("0"), { n: 0, unit: "" });
  assert.deepEqual(parseLength("-.5em"), { n: -0.5, unit: "em" });
  assert.deepEqual(parseLength("1.5"), { n: 1.5, unit: "" });
  assert.deepEqual(parseLength("10VW"), { n: 10, unit: "vw" });
  assert.deepEqual(parseLength("auto"), { keyword: "auto" });
  assert.deepEqual(parseLength("Fit-Content"), { keyword: "fit-content" });
  assert.deepEqual(parseLength("calc(100% - 20px)"), { keyword: "calc(100% - 20px)" });
  assert.deepEqual(parseLength("var(--gap)"), { keyword: "var(--gap)" });
  assert.deepEqual(parseLength("clamp(1rem, 2vw, 3rem)"), { keyword: "clamp(1rem, 2vw, 3rem)" });
  assert.equal(parseLength(""), null);
  assert.equal(parseLength("12 px"), null);
  assert.equal(parseLength("#fff"), null);
  assert.equal(formatLength({ n: 0, unit: "px" }), "0");
  assert.equal(formatLength({ n: 0, unit: "deg" }), "0deg");
  assert.equal(formatLength({ n: 1.5, unit: "rem" }), "1.5rem");
  assert.equal(formatLength({ n: 1.50004, unit: "rem" }), "1.5rem");
  assert.equal(formatLength({ n: 12, unit: "px" }), "12px");
  assert.equal(formatLength({ n: 1.25, unit: "" }), "1.25");
  assert.equal(formatLength({ keyword: "auto" }), "auto");
  for (const v of ["12px", "1.5rem", "50%", "0", "auto", "calc(1px + 2px)", "-3em"]) assert.equal(formatLength(parseLength(v)), v);
});

test("boxes", () => {
  assert.deepEqual(expandBox("1px"), ["1px", "1px", "1px", "1px"]);
  assert.deepEqual(expandBox("1px 2px"), ["1px", "2px", "1px", "2px"]);
  assert.deepEqual(expandBox("1px 2px 3px"), ["1px", "2px", "3px", "2px"]);
  assert.deepEqual(expandBox("1px 2px 3px 4px"), ["1px", "2px", "3px", "4px"]);
  assert.deepEqual(expandBox("calc(1px + 2px) auto"), ["calc(1px + 2px)", "auto", "calc(1px + 2px)", "auto"]);
  assert.deepEqual(expandBox(""), ["", "", "", ""]);
  assert.equal(collapseBox(["1px", "1px", "1px", "1px"]), "1px");
  assert.equal(collapseBox(["1px", "2px", "1px", "2px"]), "1px 2px");
  assert.equal(collapseBox(["1px", "2px", "3px", "2px"]), "1px 2px 3px");
  assert.equal(collapseBox(["1px", "2px", "3px", "4px"]), "1px 2px 3px 4px");
  for (const v of ["0", "4px 8px", "1px 2px 3px", "1px 2px 3px 4px"]) assert.equal(collapseBox(expandBox(v)), v);
});

test("colors", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#4F46E5"), { r: 79, g: 70, b: 229, a: 1 });
  assert.deepEqual(parseColor("#f008"), { r: 255, g: 0, b: 0, a: 0.533 });
  assert.deepEqual(parseColor("#ff000080"), { r: 255, g: 0, b: 0, a: 0.502 });
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseColor("rgba(10,20,30,.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor("rgb(10 20 30 / 25%)"), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.deepEqual(parseColor("rgb(100% 0% 0%)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor("hsl(0, 100%, 50%)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor("hsl(120deg 100% 25% / 0.5)"), { r: 0, g: 128, b: 0, a: 0.5 });
  assert.deepEqual(parseColor("hsla(240, 100%, 50%, 1)"), { r: 0, g: 0, b: 255, a: 1 });
  assert.deepEqual(parseColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseColor("Rebeccapurple"), { r: 102, g: 51, b: 153, a: 1 });
  assert.deepEqual(parseColor("navy"), { r: 0, g: 0, b: 128, a: 1 });
  for (const bad of ["", "#12", "#ggg", "rgb(1,2)", "rgb(a,b,c)", "hsl(1,2,3)", "notacolor", "currentcolor", "var(--x)"]) assert.equal(parseColor(bad), null, bad);
  assert.equal(formatColor({ r: 79, g: 70, b: 229, a: 1 }), "#4f46e5");
  assert.equal(formatColor({ r: 0, g: 0, b: 0 }), "#000000");
  assert.equal(formatColor({ r: 1, g: 2, b: 3, a: 0.5 }), "rgba(1, 2, 3, 0.5)");
  assert.equal(formatColor({ r: 300, g: -4, b: 3.4, a: 0 }), "rgba(255, 0, 3, 0)");
  for (const h of ["#4f46e5", "#000000", "#ffffff", "#0ea5e9"]) assert.equal(formatColor(parseColor(h)), h);
});

test("shadows", () => {
  assert.deepEqual(parseShadowList("none"), []);
  assert.deepEqual(parseShadowList(""), []);
  assert.deepEqual(parseShadowList("0 4px 12px rgba(0,0,0,.2)"), [{ inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "rgba(0,0,0,.2)" }]);
  assert.deepEqual(parseShadowList("inset 1px 2px 3px 4px #fff, 0 0 0 1px red"), [
    { inset: true, x: 1, y: 2, blur: 3, spread: 4, color: "#fff" },
    { inset: false, x: 0, y: 0, blur: 0, spread: 1, color: "red" },
  ]);
  assert.deepEqual(parseShadowList("rgba(0, 0, 0, 0.1) 0px 1px 2px"), [{ inset: false, x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0, 0, 0, 0.1)" }]);
  assert.deepEqual(parseShadowList("2px 2px"), [{ inset: false, x: 2, y: 2, blur: 0, spread: 0, color: "currentcolor" }]);
  assert.deepEqual(parseShadowList("0 0 1rem red"), []);
  assert.deepEqual(parseShadowList("var(--shadow)"), []);
  assert.equal(formatShadowList([]), "none");
  assert.equal(formatShadowList([{ inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "rgba(0, 0, 0, 0.2)" }]), "0 4px 12px rgba(0, 0, 0, 0.2)");
  assert.equal(formatShadowList([{ inset: true, x: 1, y: 2, blur: 3, spread: 4, color: "#fff" }, { x: 0, y: 0, color: "red" }]), "inset 1px 2px 3px 4px #fff, 0 0 0 red");
  for (const v of ["0 4px 12px rgba(0, 0, 0, 0.2)", "inset 0 1px 0 #fff", "0 0 0 1px #4f46e5"]) assert.equal(formatShadowList(parseShadowList(v)), v.replace("inset 0 1px 0 #fff", "inset 0 1px 0 #fff"));
});

test("gradients", () => {
  assert.deepEqual(parseGradient("linear-gradient(135deg, #4f46e5 0%, rgba(14, 165, 233, 0.8) 100%)"), {
    kind: "linear", angle: 135, stops: [{ color: "#4f46e5", pos: 0 }, { color: "rgba(14, 165, 233, 0.8)", pos: 100 }],
  });
  assert.deepEqual(parseGradient("linear-gradient(to right, red, blue)"), { kind: "linear", angle: 90, stops: [{ color: "red", pos: null }, { color: "blue", pos: null }] });
  assert.deepEqual(parseGradient("linear-gradient(red, blue)").angle, 180);
  assert.equal(parseGradient("linear-gradient(to top right, red, blue)").angle, 45);
  assert.equal(parseGradient("linear-gradient(to right top, red, blue)").angle, 45);
  assert.equal(parseGradient("linear-gradient(0.25turn, red, blue)").angle, 90);
  assert.deepEqual(parseGradient("radial-gradient(circle at top, #fff 10%, #000)"), { kind: "radial", shape: "circle at top", stops: [{ color: "#fff", pos: 10 }, { color: "#000", pos: null }] });
  assert.deepEqual(parseGradient("radial-gradient(#fff, #000)").stops.length, 2);
  assert.equal(parseGradient("repeating-linear-gradient(red, blue)"), null);
  assert.equal(parseGradient("conic-gradient(red, blue)"), null);
  assert.equal(parseGradient("linear-gradient(red 10px, blue)"), null);
  assert.equal(parseGradient("linear-gradient(red)"), null);
  assert.equal(parseGradient("url(a.png)"), null);
  assert.equal(formatGradient({ kind: "linear", angle: 135, stops: [{ color: "#4f46e5", pos: 0 }, { color: "#0ea5e9", pos: 100 }] }), "linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%)");
  assert.equal(formatGradient({ kind: "radial", stops: [{ color: "red", pos: null }, { color: "blue" }] }), "radial-gradient(circle, red, blue)");
  const v = "linear-gradient(90deg, #fff 0%, #000 100%)";
  assert.equal(formatGradient(parseGradient(v)), v);
});

test("transitions", () => {
  assert.deepEqual(parseTransition("none"), []);
  assert.deepEqual(parseTransition("opacity 0.2s ease-in 100ms, transform 300ms cubic-bezier(.4, 0, .2, 1)"), [
    { property: "opacity", duration: 200, timing: "ease-in", delay: 100 },
    { property: "transform", duration: 300, timing: "cubic-bezier(.4, 0, .2, 1)", delay: 0 },
  ]);
  assert.deepEqual(parseTransition("all 1s"), [{ property: "all", duration: 1000, timing: "ease", delay: 0 }]);
  assert.deepEqual(parseTransition("ease 2s color"), [{ property: "color", duration: 2000, timing: "ease", delay: 0 }]);
  assert.equal(formatTransition([]), "none");
  assert.equal(formatTransition([{ property: "opacity", duration: 200, timing: "ease-in", delay: 100 }, { property: "all", duration: 1000, timing: "linear", delay: 0 }]), "opacity 200ms ease-in 100ms, all 1s linear");
  assert.equal(formatTransition(parseTransition("color 150ms ease")), "color 150ms ease");
  assert.equal(formatTransition([{ property: "x", duration: 0 }]), "x 0s ease");
});

test("font stacks and breakpoints", () => {
  assert.deepEqual(FONT_STACKS.map((f) => f.label), ["Sans", "Serif", "Mono", "Rounded", "Humanist", "Geometric"]);
  for (const f of FONT_STACKS) {
    assert.ok(/(sans-serif|serif|monospace)$/.test(f.value), f.label);
    assert.ok(!/url\(|http/.test(f.value));
  }
  assert.deepEqual(BREAKPOINTS.map((b) => b.id), ["desktop", "desktop-xl", "desktop-2xl", "tablet", "mobile-landscape", "mobile-portrait"]);
  assert.equal(mediaForBreakpoint("desktop"), null);
  assert.equal(mediaForBreakpoint("tablet"), "(max-width: 991px)");
  assert.equal(mediaForBreakpoint("mobile-landscape"), "(max-width: 767px)");
  assert.equal(mediaForBreakpoint("mobile-portrait"), "(max-width: 478px)");
  assert.equal(mediaForBreakpoint("desktop-xl"), "(min-width: 1440px)");
  assert.equal(mediaForBreakpoint("desktop-2xl"), "(min-width: 1920px)");
  assert.equal(mediaForBreakpoint("nope"), null);
  assert.equal(BREAKPOINTS[0].width, 1280);
  assert.equal(BREAKPOINTS[3].width, 991);
  const id = (w) => breakpointForWidth(w).id;
  assert.equal(id(1280), "desktop");
  assert.equal(id(1439), "desktop");
  assert.equal(id(1440), "desktop-xl");
  assert.equal(id(1920), "desktop-2xl");
  assert.equal(id(992), "desktop");
  assert.equal(id(991), "tablet");
  assert.equal(id(768), "tablet");
  assert.equal(id(767), "mobile-landscape");
  assert.equal(id(479), "mobile-landscape");
  assert.equal(id(478), "mobile-portrait");
  assert.equal(id(320), "mobile-portrait");
  assert.equal(breakpointForMedia("(max-width:991px)"), "tablet");
  assert.equal(breakpointForMedia(null), "desktop");
  assert.equal(breakpointForMedia("print"), null);
  // the media strings are valid for the CSS parser
  for (const b of BREAKPOINTS.filter((x) => x.media)) assert.equal(parseCss(`@media ${b.media}{a{b:c}}`).errors.length, 0);
});
