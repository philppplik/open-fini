import test from "node:test";
import assert from "node:assert/strict";
import { parseColor, toHex, contrastRatio, wcagLevel, suggestFix, harmony, shades, colorsFromLayers, dominantColors, assignPalette, rgbToHsl, hslToRgb } from "../../extensions/palette-pro/src/lib.js";

test("parseColor handles hex, short hex, rgb() and alpha suffixes", () => {
  assert.deepEqual(parseColor("#ff8800"), [255, 136, 0]);
  assert.deepEqual(parseColor("#f80"), [255, 136, 0]);
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.deepEqual(parseColor("#112233 @0.5"), [17, 34, 51]);
  assert.equal(parseColor("nonsense"), null);
  assert.equal(parseColor(null), null);
});

test("contrast ratio matches the WCAG reference values", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff") * 100) / 100, 21);
  assert.equal(Math.round(contrastRatio("#777777", "#ffffff") * 100) / 100, 4.48);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.equal(contrastRatio("x", "#fff"), null);
});

test("wcagLevel thresholds", () => {
  assert.equal(wcagLevel(21).level, "AAA");
  assert.equal(wcagLevel(4.5).level, "AA");
  assert.equal(wcagLevel(3.2).level, "AA large text only");
  assert.equal(wcagLevel(2).level, "Fail");
});

test("suggestFix finds a passing color near the original, smallest change first", () => {
  const fixes = suggestFix("#777777", "#ffffff", 4.5);
  assert.ok(fixes.length >= 1);
  assert.equal(fixes[0].direction, "darker");
  assert.ok(contrastRatio(fixes[0].color, "#ffffff") >= 4.5);
  assert.ok(fixes[0].delta <= 5);
  assert.equal(suggestFix("#000000", "#ffffff", 4.5)[0].delta, 0);
});

test("hsl round trip", () => {
  for (const hex of ["#3b82f6", "#ef4444", "#10b981", "#808080"]) assert.equal(toHex(hslToRgb(rgbToHsl(parseColor(hex)))), hex);
});

test("harmonies have the expected sizes and hues", () => {
  assert.equal(harmony("#ff0000", "complementary").length, 2);
  assert.equal(harmony("#ff0000", "triadic").length, 3);
  assert.equal(harmony("#ff0000", "tetradic").length, 4);
  assert.deepEqual(harmony("#ff0000", "complementary"), ["#ff0000", "#00ffff"]);
  assert.deepEqual(harmony("#ff0000", "triadic"), ["#ff0000", "#00ff00", "#0000ff"]);
  assert.equal(harmony("#ff0000", "analogous").length, 3);
  assert.equal(shades("#3b82f6", 5).length, 5);
  assert.deepEqual(harmony("bad", "triadic"), []);
});

test("colorsFromLayers collects unique fills and strokes, including children", () => {
  const layers = [{ fill: "#FF0000" }, { fill: "#ff0000 @0.5", stroke: "#00ff00 2px" }, { type: "group", children: [{ fill: "rgb(0,0,255)" }] }, { fill: "linear-gradient(#000, #fff)" }];
  assert.deepEqual(colorsFromLayers(layers), ["#ff0000", "#00ff00", "#0000ff"]);
});

test("dominantColors finds the main colors of an image, most frequent first", () => {
  const px = [];
  for (let i = 0; i < 300; i++) px.push(255, 0, 0, 255);
  for (let i = 0; i < 100; i++) px.push(0, 0, 255, 255);
  for (let i = 0; i < 50; i++) px.push(0, 255, 0, 0); // transparent: ignored
  const colors = dominantColors(new Uint8Array(px), 3);
  assert.equal(colors[0], "#ff0000");
  assert.ok(colors.includes("#0000ff"));
  assert.equal(colors.length, 2);
  assert.deepEqual(dominantColors(new Uint8Array(0), 3), []);
});

test("assignPalette cycles colors over ids", () => {
  assert.deepEqual(assignPalette(["a", "b", "c"], ["#111111", "#222222"]), [{ ids: ["a", "c"], fill: "#111111" }, { ids: ["b"], fill: "#222222" }]);
  assert.deepEqual(assignPalette(["a"], []), []);
});
