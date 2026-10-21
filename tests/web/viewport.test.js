import test from "node:test";
import assert from "node:assert/strict";
import {
  VIEWPORT_LIMITS, DEVICE_PRESETS, LAYOUTS, clampSize, parseSizeInput, nudgeSize, matchPreset, breakpointMarkers, snapWidth, rulerTicks,
  resolveLayout, isStacked, codeFirst, clampRatio, ratioFromPointer, stepRatio, breakpointForWidth, BREAKPOINTS,
} from "../../app/src/engine/web/index.js";

test("size input is parsed strictly and clamped", () => {
  assert.equal(parseSizeInput("834"), 834);
  assert.equal(parseSizeInput(" 834 px "), 834);
  assert.equal(parseSizeInput("12"), VIEWPORT_LIMITS.min);
  assert.equal(parseSizeInput("99999"), VIEWPORT_LIMITS.max);
  assert.equal(parseSizeInput("abc"), null);
  assert.equal(parseSizeInput("10 20"), null);
  assert.equal(parseSizeInput("-5"), null);
  assert.equal(parseSizeInput(""), null);
  assert.equal(clampSize(NaN, "w"), 1280);
  assert.equal(nudgeSize(500, 1), 501);
  assert.equal(nudgeSize(500, -1, true), 490);
  assert.equal(nudgeSize(VIEWPORT_LIMITS.min, -1), VIEWPORT_LIMITS.min);
});

test("presets use generic names and are all inside the limits", () => {
  assert.ok(DEVICE_PRESETS.length >= 9);
  for (const p of DEVICE_PRESETS) {
    assert.ok(p.w >= VIEWPORT_LIMITS.min && p.w <= VIEWPORT_LIMITS.max, p.id);
    assert.ok(!/iphone|ipad|galaxy|pixel|macbook|surface/i.test(p.label), p.label);
  }
  assert.equal(matchPreset(390, 844).label, "Phone 390");
  assert.equal(matchPreset(390).id, "phone-390");
  assert.equal(matchPreset(391), null);
});

test("breakpoint markers merge the config with parsed media queries", () => {
  const css = `
    /* @media (max-width: 111px) { } */
    @media (max-width: 767px) { .a { color: red } }
    @media screen and (min-width: 1100px) and (max-width: 1500px) { .b { } }
    @media (max-width: 40em) { }
    @media (width <= 600px) { }
    @media (width > 900px) { }
    @media (prefers-color-scheme: dark) { }
    @media (max-width: 99999px) { }`;
  const m = breakpointMarkers([css]);
  const px = m.map((x) => x.px);
  assert.deepEqual(px, [478, 600, 640, 767, 901, 991, 1100, 1440, 1500, 1920]);
  assert.equal(m.find((x) => x.px === 767).source, "config"); // config label wins over the css duplicate
  assert.equal(m.find((x) => x.px === 600).kind, "max");
  assert.equal(m.find((x) => x.px === 1100).kind, "min");
  assert.equal(m.find((x) => x.px === 640).source, "css"); // 40em
  assert.ok(!px.includes(111)); // commented out
  assert.ok(!px.includes(1280)); // base desktop is not a boundary
  assert.deepEqual(breakpointMarkers([]).map((x) => x.px), [478, 767, 991, 1440, 1920]);
  assert.doesNotThrow(() => breakpointMarkers([null, undefined, 5]));
});

test("snapWidth snaps within the tolerance only", () => {
  const markers = breakpointMarkers([]);
  assert.deepEqual(snapWidth(770, markers, 6).width, 767);
  assert.equal(snapWidth(770, markers, 6).marker.px, 767);
  assert.equal(snapWidth(780, markers, 6).width, 780);
  assert.equal(snapWidth(780, markers, 6).marker, null);
  assert.equal(snapWidth(500, [], 6).width, 500);
  // nearest wins
  assert.equal(snapWidth(103, [{ px: 100 }, { px: 105 }], 6).width, 105);
});

test("the matching breakpoint follows the width (style panel highlight)", () => {
  assert.equal(breakpointForWidth(390).id, "mobile-portrait");
  assert.equal(breakpointForWidth(478).id, "mobile-portrait");
  assert.equal(breakpointForWidth(479).id, "mobile-landscape");
  assert.equal(breakpointForWidth(820).id, "tablet");
  assert.equal(breakpointForWidth(1100).id, "desktop");
  assert.equal(breakpointForWidth(1440).id, "desktop-xl");
  // every config width maps back onto its own breakpoint, so presets round-trip
  for (const b of BREAKPOINTS) assert.equal(breakpointForWidth(b.width).id, b.id);
});

test("ruler ticks adapt to the zoom", () => {
  const a = rulerTicks(0, 400, 1);
  assert.equal(a.minor, 10);
  assert.equal(a.major, 50);
  assert.deepEqual(a.ticks.filter((t) => t.major).map((t) => t.label), ["0", "50", "100", "150", "200", "250", "300", "350", "400"]);
  const b = rulerTicks(0, 100, 4);
  assert.equal(b.minor, 2);
  const c = rulerTicks(0, 4000, 0.25);
  assert.equal(c.minor, 50);
  assert.ok(c.major >= 200 && c.major % c.minor === 0);
  const d = rulerTicks(250, 450, 1);
  assert.ok(d.ticks[0].v >= 250);
  assert.ok(d.ticks.length < 100);
  assert.ok(rulerTicks(0, 1e9, 1).ticks.length <= 4000);
});

test("layout resolution: explicit wins, auto stacks below 900 px", () => {
  for (const l of LAYOUTS) assert.equal(resolveLayout(l, 400), l);
  assert.equal(resolveLayout("auto", 1200), "codeLeft");
  assert.equal(resolveLayout(null, 899), "codeTop");
  assert.equal(resolveLayout(undefined, 900), "codeLeft");
  assert.equal(resolveLayout("bogus", 0), "codeLeft");
  assert.ok(isStacked("codeTop") && isStacked("codeBottom") && !isStacked("codeLeft"));
  assert.ok(codeFirst("codeLeft") && codeFirst("codeTop") && !codeFirst("codeRight") && !codeFirst("codeBottom"));
});

test("ratios are clamped and mapped from the pointer for every arrangement", () => {
  assert.equal(clampRatio(0.5, 1000, 240), 0.5);
  assert.equal(clampRatio(0.05, 1000, 240), 0.24);
  assert.equal(clampRatio(0.99, 1000, 240), 0.76);
  assert.equal(clampRatio(0.01, 100000, 240), 0.1);
  assert.equal(clampRatio(NaN, 1000), 0.5);
  assert.equal(clampRatio(0.05, 300, 240), 0.1); // too small for min sizes: only the 10..90 % rule applies
  assert.equal(ratioFromPointer("codeLeft", 300, 1000), 0.3);
  assert.equal(ratioFromPointer("codeTop", 300, 1000), 0.3);
  assert.equal(ratioFromPointer("codeRight", 300, 1000), 0.7);
  assert.equal(ratioFromPointer("codeBottom", 300, 1000), 0.7);
  assert.equal(ratioFromPointer("codeLeft", 5, 0), 0.5);
});

test("splitter keys move the bar the way the arrow points", () => {
  assert.ok(Math.abs(stepRatio(0.5, "ArrowRight", "codeLeft") - 0.52) < 1e-9);
  assert.ok(Math.abs(stepRatio(0.5, "ArrowLeft", "codeLeft") - 0.48) < 1e-9);
  // code on the right: the bar moving right shrinks the code pane
  assert.ok(Math.abs(stepRatio(0.5, "ArrowRight", "codeRight") - 0.48) < 1e-9);
  assert.ok(Math.abs(stepRatio(0.5, "ArrowDown", "codeTop") - 0.52) < 1e-9);
  assert.ok(Math.abs(stepRatio(0.5, "ArrowDown", "codeBottom") - 0.48) < 1e-9);
  assert.ok(Math.abs(stepRatio(0.5, "ArrowDown", "codeTop", true) - 0.6) < 1e-9);
  assert.equal(stepRatio(0.5, "ArrowUp", "codeLeft"), null); // wrong axis
  assert.equal(stepRatio(0.5, "a", "codeLeft"), null);
  assert.equal(stepRatio(0.5, "Home", "codeLeft"), 0.1);
  assert.equal(stepRatio(0.5, "End", "codeLeft"), 0.9);
});
