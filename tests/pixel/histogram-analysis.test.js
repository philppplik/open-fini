import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysis, accumulate, analyzeImage, channelHistogram, rebin, percentileOfLevel, readout, summarize, tonalShares,
  displayCurve, clipFlags, assess, autoCorrectSuggestion, describeHistogram, exposureToMidtone,
} from "../../app/src/engine/pixel/histogram-analysis.js";
import {
  gammaToMidPos, midPosToGamma, levelsSets, levelsParams, editLevels, eyedropperLevels, mapHistogram, levelsLUT,
  isIdentityCurve, addCurvePoint, moveCurvePoint, removeCurvePoint, curveAt, CURVE_PRESETS,
} from "../../app/src/engine/pixel/tone-tools.js";
import { applyAdjustment, ADJUSTMENTS } from "../../app/src/engine/pixel/adjustments.js";
import { createImage } from "../../app/src/engine/pixel/image.js";
import { solid, ramp, setPx, noise } from "./_util.js";

function range(w, h, lo, hi, cast = [0, 0, 0]) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = lo + ((hi - lo) * x) / (w - 1);
    setPx(img, x, y, [v + cast[0], v + cast[1], v + cast[2], 255]);
  }
  return img;
}

test("analyzeImage counts channels, skips transparent pixels and applies masks", () => {
  const img = solid(4, 4, [10, 20, 30, 255]);
  setPx(img, 0, 0, [0, 0, 0, 0]);
  const a = analyzeImage(img);
  assert.equal(a.count, 15);
  assert.equal(a.total, 15);
  assert.equal(a.r[10], 15);
  assert.equal(a.sampled, false);
  const mask = { width: 4, height: 4, data: new Uint8Array(16) };
  mask.data.fill(255, 0, 8);
  assert.equal(analyzeImage(img, { mask }).count, 7);
});

test("sampling above maxPixels strides and estimates the total", () => {
  const img = solid(100, 100, [200, 100, 50, 255]);
  const a = analyzeImage(img, { maxPixels: 2500 });
  assert.equal(a.sampled, true);
  assert.equal(a.step, 2);
  assert.equal(a.count, 2500);
  assert.equal(a.total, 10000);
  assert.equal(summarize(a, "luma").pixels, 10000);
});

test("strips accumulate to the same result as one pass", () => {
  const img = noise(20, 30, 4);
  const whole = analyzeImage(img);
  const acc = createAnalysis();
  for (let y0 = 0; y0 < 30; y0 += 10) {
    const strip = { width: 20, height: 10, data: img.data.slice(y0 * 20 * 4, (y0 + 10) * 20 * 4) };
    accumulate(acc, strip, { rowOffset: y0 });
  }
  assert.deepEqual(acc.r, whole.r);
  assert.deepEqual(acc.lab, whole.lab);
  assert.equal(acc.count, whole.count);
  assert.equal(acc.clipLow, whole.clipLow);
});

test("strips honor a mask at page resolution", () => {
  const img = solid(4, 8, [9, 9, 9, 255]);
  const mask = { width: 4, height: 8, data: new Uint8Array(32) };
  mask.data.fill(255, 16, 32); // bottom half
  const acc = createAnalysis();
  for (let y0 = 0; y0 < 8; y0 += 4) accumulate(acc, { width: 4, height: 4, data: img.data.slice(y0 * 16, (y0 + 4) * 16) }, { mask, rowOffset: y0, maskStride: 4 });
  assert.equal(acc.count, 16);
});

test("Lab L* histogram: black, mid gray and white", () => {
  const img = createImage(3, 1);
  setPx(img, 0, 0, [0, 0, 0, 255]);
  setPx(img, 1, 0, [119, 119, 119, 255]); // L* ~ 50
  setPx(img, 2, 0, [255, 255, 255, 255]);
  const a = analyzeImage(img);
  assert.equal(a.lab[0], 1);
  assert.equal(a.lab[255], 1);
  const mid = a.lab.findIndex((v, i) => v && i > 0 && i < 255);
  assert.ok(Math.abs(mid - 127) <= 2, `L* of mid gray was ${mid}`);
});

test("summarize: mean, median, stddev and clipping per channel and for RGB", () => {
  const img = createImage(4, 1);
  setPx(img, 0, 0, [0, 100, 100, 255]);
  setPx(img, 1, 0, [100, 100, 100, 255]);
  setPx(img, 2, 0, [255, 100, 100, 255]);
  setPx(img, 3, 0, [100, 100, 100, 255]);
  const a = analyzeImage(img);
  const r = summarize(a, "r");
  assert.equal(r.mean, 113.75);
  assert.equal(r.median, 100);
  assert.equal(r.shadowsClipped, 25);
  assert.equal(r.highlightsClipped, 25);
  const g = summarize(a, "g");
  assert.equal(g.stddev, 0);
  assert.equal(g.shadowsClipped, 0);
  const rgb = summarize(a, "rgb");
  assert.equal(rgb.pixels, 4);
  assert.equal(rgb.shadowsClipped, 25); // pixels where ANY channel is 0
  assert.equal(rgb.highlightsClipped, 25);
});

test("percentileOfLevel and readout", () => {
  const h = new Uint32Array(256);
  h[10] = 25;
  h[100] = 50;
  h[200] = 25;
  assert.equal(percentileOfLevel(h, 9), 0);
  assert.equal(percentileOfLevel(h, 10), 25);
  assert.equal(percentileOfLevel(h, 150), 75);
  assert.equal(percentileOfLevel(h, 255), 100);
  const r = readout(h, 100.4);
  assert.deepEqual(r, { level: 100, count: 50, percentile: 75, share: 50 });
  assert.equal(readout(new Uint32Array(256), 5).percentile, 0);
  assert.equal(readout(h, 999).level, 255);
});

test("rebin sums bins; tonalShares sums to 100", () => {
  const h = new Uint32Array(256).fill(2);
  const b = rebin(h, 64);
  assert.equal(b.length, 64);
  assert.ok(b.every((v) => v === 8));
  const t = tonalShares(h);
  assert.ok(Math.abs(t.reduce((s, v) => s + v, 0) - 100) < 1e-9);
  assert.ok(t.every((v) => Math.abs(v - 25) < 1e-9));
});

test("displayCurve ignores the end bins for the scale, supports log and clips at 1", () => {
  const h = new Uint32Array(256);
  h[0] = 10000;
  h[100] = 10;
  h[101] = 5;
  const lin = displayCurve(h);
  assert.equal(lin.max, 10);
  assert.equal(lin.values[0], 1);
  assert.equal(lin.values[100], 1);
  assert.equal(lin.values[101], 0.5);
  const log = displayCurve(h, { log: true });
  assert.ok(log.values[101] > 0.5 && log.values[101] < 1);
  const solidWhite = new Uint32Array(256);
  solidWhite[255] = 50;
  assert.equal(displayCurve(solidWhite).values[255], 1);
  const sm = displayCurve(h, { smooth: 2 });
  assert.ok(sm.values.every((v) => v >= 0 && v <= 1));
});

test("clipFlags marks shadow and highlight pixels, never transparent ones", () => {
  const img = createImage(4, 1);
  setPx(img, 0, 0, [0, 50, 50, 255]);
  setPx(img, 1, 0, [255, 50, 50, 255]);
  setPx(img, 2, 0, [0, 255, 50, 255]);
  setPx(img, 3, 0, [0, 0, 0, 0]);
  assert.deepEqual([...clipFlags(img)], [1, 2, 3, 0]);
  assert.deepEqual([...clipFlags(img, { low: 5, high: 250 })], [1, 2, 3, 0]);
});

test("assess: dark image is underexposed and suggests a positive exposure", () => {
  const a = analyzeImage(range(64, 8, 5, 90));
  const r = assess(a);
  assert.equal(r.exposure, "underexposed");
  const s = r.suggestions.find((x) => x.id === "exposure");
  assert.ok(s && s.params.exposure > 0);
  assert.match(r.summary, /dark/);
});

test("assess: bright image is overexposed and suggests a negative exposure", () => {
  const a = analyzeImage(range(64, 8, 150, 255));
  const r = assess(a);
  assert.equal(r.exposure, "overexposed");
  assert.ok(r.suggestions.find((x) => x.id === "exposure").params.exposure < 0);
});

test("assess: low contrast, clipping levels and color cast", () => {
  const flat = assess(analyzeImage(range(64, 8, 100, 150)));
  assert.equal(flat.contrast, "low");
  const lv = flat.suggestions.find((x) => x.id === "levels");
  assert.ok(lv.params.inBlack > 80 && lv.params.inWhite < 170);

  const clipped = createImage(100, 1);
  for (let x = 0; x < 100; x++) setPx(clipped, x, 0, x < 8 ? [255, 255, 255, 255] : x < 12 ? [0, 0, 0, 255] : [120, 120, 120, 255]);
  const c = assess(analyzeImage(clipped));
  assert.equal(c.clipping.highlightsLevel, "heavy");
  assert.equal(c.clipping.shadowsLevel, "some");
  assert.ok(c.suggestions.some((x) => x.id === "shadows-highlights" && x.params.highlights > 0));

  const warm = assess(analyzeImage(range(64, 8, 40, 200, [25, 0, -25])));
  assert.match(warm.cast, /warm/);
  assert.ok(warm.suggestions.some((x) => x.params.channels));
});

test("assess: a balanced image has no issues, an empty one does not throw", () => {
  const a = analyzeImage(ramp(256, 4));
  const r = assess(a);
  assert.equal(r.exposure, "balanced");
  assert.equal(r.contrast, "normal");
  assert.equal(r.cast, null);
  assert.equal(r.suggestions.length, 0);
  assert.match(assess(createAnalysis()).summary, /no visible pixels/);
});

test("autoCorrectSuggestion produces parameters the effects accept and improves a flat image", () => {
  const img = range(64, 8, 90, 160);
  const a = analyzeImage(img);
  const s = autoCorrectSuggestion(a);
  assert.ok(s.levels.inBlack >= 85 && s.levels.inWhite <= 165);
  const out = applyAdjustment(structuredClone(img), { kind: "levels", params: s.levels });
  const after = summarize(analyzeImage(out), "luma");
  assert.ok(after.p99 - after.p1 > 200, "range should be stretched");
  const curved = applyAdjustment(structuredClone(img), { kind: "curves", params: s.curves });
  assert.ok(summarize(analyzeImage(curved), "luma").stddev > summarize(a, "luma").stddev);
  assert.ok(s.curves.master.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
  assert.ok(s.notes.length >= 2);
});

test("exposureToMidtone is signed and clamped", () => {
  assert.ok(exposureToMidtone(40) > 0);
  assert.ok(exposureToMidtone(220) < 0);
  assert.ok(Math.abs(exposureToMidtone(118)) < 0.01);
  assert.equal(exposureToMidtone(0), 3);
});

test("describeHistogram gives an accessible summary", () => {
  const t = describeHistogram(analyzeImage(ramp(256, 4)), "luma", "composite");
  assert.match(t, /^Luminosity histogram of composite\./);
  assert.match(t, /Shadows clipped/);
  assert.match(describeHistogram(createAnalysis(), "rgb"), /no pixels/);
  assert.equal(channelHistogram(analyzeImage(solid(2, 2, [1, 2, 3, 255])), "rgb")[2], 4);
});

// ------------------------------------------------------------------ tone tools

test("gamma <-> midtone slider position are inverse and gamma 1 sits at one half", () => {
  assert.equal(gammaToMidPos(1), 0.5);
  for (const g of [0.3, 0.8, 1, 1.7, 4]) assert.ok(Math.abs(midPosToGamma(gammaToMidPos(g)) - g) < 1e-9);
  assert.equal(midPosToGamma(0.99999), 0.1);
  assert.ok(gammaToMidPos(2) < 0.5 && gammaToMidPos(0.5) > 0.5);
});

test("levelsSets / levelsParams round trip and legacy channel params are migrated", () => {
  const p = { inBlack: 10, inWhite: 240, gamma: 1.2, outBlack: 0, outWhite: 255, channel: "rgb", channels: { red: { inBlack: 5, inWhite: 250, gamma: 1 } } };
  const s = levelsSets(p);
  assert.equal(s.rgb.inBlack, 10);
  assert.equal(s.red.inWhite, 250);
  assert.equal(s.green.inWhite, 255);
  const back = levelsParams(s);
  assert.equal(back.channel, "rgb");
  assert.equal(back.channels.red.inBlack, 5);
  assert.equal(levelsParams(levelsSets({})).channels, null);
  const legacy = levelsSets({ channel: "green", inBlack: 30, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 });
  assert.equal(legacy.green.inBlack, 30);
  assert.equal(legacy.rgb.inBlack, 0);
});

test("editLevels keeps black below white and rounds", () => {
  const s = levelsSets({}).rgb;
  assert.equal(editLevels(s, { inBlack: 300 }).inBlack, 254);
  assert.equal(editLevels({ ...s, inBlack: 100 }, { inWhite: 50 }).inWhite, 101);
  assert.equal(editLevels(s, { inBlack: 20.4 }).inBlack, 20);
  assert.equal(editLevels(s, { gamma: 9 }).gamma, 5);
  assert.equal(editLevels(s, { gamma: 1.234 }).gamma, 1.23);
});

test("eyedropperLevels: black and white points, per-channel and gray neutralization", () => {
  const sets = levelsSets({});
  const b = eyedropperLevels(sets, "rgb", "black", [20, 20, 20]);
  assert.equal(b.rgb.inBlack, 20);
  const w = eyedropperLevels(sets, "rgb", "white", [240, 240, 240]);
  assert.equal(w.rgb.inWhite, 240);
  const r = eyedropperLevels(sets, "red", "black", [33, 90, 90]);
  assert.equal(r.red.inBlack, 33);
  assert.equal(r.rgb.inBlack, 0);
  // a sample that is too warm becomes neutral after the gray dropper
  const gray = eyedropperLevels(sets, "rgb", "gray", [180, 128, 90]);
  const img = solid(1, 1, [180, 128, 90, 255]);
  const out = applyAdjustment(img, { kind: "levels", params: levelsParams(gray) });
  const [R, G, B] = out.data;
  assert.ok(Math.max(R, G, B) - Math.min(R, G, B) <= 2, `not neutral: ${R},${G},${B}`);
  // single channel gray: sample maps to mid
  const gr = eyedropperLevels(sets, "blue", "gray", [10, 10, 64]);
  const lut = levelsLUT(gr.blue);
  assert.ok(Math.abs(lut[64] - 128) <= 1);
});

test("mapHistogram moves counts through a table", () => {
  const h = new Uint32Array(256);
  h[10] = 5;
  h[20] = 3;
  const lut = levelsLUT({ inBlack: 10, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
  const o = mapHistogram(h, lut);
  assert.equal(o[0], 5);
  assert.equal(o.reduce((s, v) => s + v, 0), 8);
});

test("curve point editing", () => {
  const id = [[0, 0], [1, 1]];
  assert.equal(isIdentityCurve(id), true);
  assert.equal(isIdentityCurve([[0, 0], [0.5, 0.6], [1, 1]]), false);
  const a = addCurvePoint(id, 0.5, 0.7);
  assert.deepEqual(a.points, [[0, 0], [0.5, 0.7], [1, 1]]);
  assert.equal(a.index, 1);
  const again = addCurvePoint(a.points, 0.5, 0.2);
  assert.equal(again.points.length, 3);
  assert.equal(again.points[1][1], 0.2);
  const m = moveCurvePoint(a.points, 1, 2, -1);
  assert.ok(m[1][0] < 1 && m[1][0] > 0.99);
  assert.equal(m[1][1], 0);
  assert.equal(moveCurvePoint(a.points, 0, 0.9, 0.1)[0][0] < 0.5, true);
  assert.equal(removeCurvePoint(a.points, 1).length, 2);
  assert.equal(removeCurvePoint(id, 0).length, 2);
  assert.ok(Math.abs(curveAt(a.points, 0.5) - 0.7) < 0.01);
});

test("curve presets are valid curve parameters", () => {
  for (const p of CURVE_PRESETS) {
    const out = applyAdjustment(ramp(16, 1), { kind: "curves", params: { master: p.points } });
    assert.equal(out.data.length, 64);
    assert.ok(p.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1), p.id);
  }
  assert.equal(isIdentityCurve(CURVE_PRESETS[0].points), true);
  assert.ok(ADJUSTMENTS.curves);
});

import { colorInfo, deltaE } from "../../app/src/engine/pixel/color-info.js";

test("colorInfo: hex, HSL, HSB and Lab of known colors", () => {
  const red = colorInfo(255, 0, 0);
  assert.equal(red.hex, "#ff0000");
  assert.deepEqual(red.hsl.map(Math.round), [0, 100, 50]);
  assert.deepEqual(red.hsb.map(Math.round), [0, 100, 100]);
  assert.deepEqual(red.lab.map(Math.round), [53, 80, 67]);
  const white = colorInfo(255, 255, 255);
  assert.equal(Math.round(white.lab[0]), 100);
  assert.ok(Math.abs(white.lab[1]) < 0.1 && Math.abs(white.lab[2]) < 0.1);
  const gray = colorInfo(128, 128, 128);
  assert.equal(gray.hsl[1], 0);
  assert.equal(colorInfo(0, 0, 0).lab[0], 0);
  assert.equal(deltaE(white, white), 0);
  assert.ok(deltaE(red, white) > 50);
});
