import test from "node:test";
import assert from "node:assert/strict";
import {
  ADJUSTMENTS, applyAdjustment, buildLevelsLUT, buildCurveLUT, buildBrightnessContrastLUT, buildExposureLUT, buildPosterizeLUT,
  buildGradientLUT, identityLUT, composeLUTs, whiteBalanceGains, whiteBalanceFromColor, applyLUT, isIdentityLUT,
} from "../../app/src/engine/pixel/adjustments.js";
import { createImage, cloneImage, luma8 } from "../../app/src/engine/pixel/image.js";
import { solid, noise, ramp, px, setPx, maxDiff, mean, near } from "./_util.js";

const ctx = { scale: 1 };
const run = (id, img, params = {}) => ADJUSTMENTS[id].apply(img, params, ctx);

test("registry contains the required ids with schema-valid controls", () => {
  const required = [
    "brightness-contrast", "levels", "curves", "hsl", "vibrance", "exposure", "white-balance", "color-balance", "black-white",
    "channel-mixer", "invert", "threshold", "posterize", "gradient-map", "shadows-highlights", "photo-filter", "selective-color", "recolor",
  ];
  for (const id of required) assert.ok(ADJUSTMENTS[id], "missing " + id);
  const types = new Set(["range", "int", "bool", "select", "color", "angle", "curve", "point"]);
  for (const [id, m] of Object.entries(ADJUSTMENTS)) {
    assert.equal(m.id, id);
    assert.ok(m.label && m.category, id);
    const keys = new Set();
    for (const c of m.controls) {
      assert.ok(!keys.has(c.key), `${id}: duplicate key ${c.key}`);
      keys.add(c.key);
      assert.ok(types.has(c.type), `${id}.${c.key}: bad type ${c.type}`);
      assert.ok(c.label, `${id}.${c.key}: label`);
      assert.notEqual(c.default, undefined, `${id}.${c.key}: default`);
      assert.deepEqual(m.defaults[c.key], c.default);
      if (c.type === "range" || c.type === "int") {
        assert.ok(c.min <= c.default && c.default <= c.max, `${id}.${c.key}: default outside range`);
      }
      if (c.type === "select") assert.ok(c.options.some((o) => o.value === c.default), `${id}.${c.key}: default not in options`);
      if (c.type === "curve") {
        assert.equal(c.default[0][0], 0);
        assert.equal(c.default[c.default.length - 1][0], 1);
      }
    }
  }
});

test("default parameters are an exact identity for neutral adjustments", () => {
  const neutral = ["brightness-contrast", "levels", "curves", "hsl", "vibrance", "exposure", "white-balance", "color-balance", "channel-mixer", "selective-color", "invert-none"];
  for (const id of neutral) {
    if (id === "invert-none") continue;
    const img = noise(24, 24, 3, false);
    const out = run(id, cloneImage(img));
    assert.equal(maxDiff(out, img), 0, id);
  }
});

test("every adjustment keeps alpha and leaves transparent pixels untouched", () => {
  const params = {
    "brightness-contrast": { brightness: 40, contrast: 30 }, levels: { inBlack: 30, inWhite: 220, gamma: 1.4 },
    curves: { master: [[0, 0.1], [0.5, 0.7], [1, 1]] }, hsl: { hue: 40, saturation: 30, lightness: 10 }, vibrance: { vibrance: 60, saturation: 10 },
    exposure: { exposure: 1, offset: 0.05, gamma: 1.2 }, "white-balance": { temperature: 40, tint: -20 },
    "color-balance": { shadowsCyanRed: 50, midtonesYellowBlue: -40, highlightsMagentaGreen: 30 }, "black-white": { tint: true },
    "channel-mixer": { rr: 50, rg: 50, bb: 120, rc: 10 }, invert: {}, threshold: {}, posterize: { levels: 3 }, "gradient-map": {},
    "shadows-highlights": { shadows: 80, highlights: 50 }, "photo-filter": { filter: "cooling-80", density: 60 },
    "selective-color": { redsCyan: 50, blacksBlack: 40, whitesYellow: -30, neutralsMagenta: 20 }, recolor: { source: "#808080", target: "#2060c0", satRange: 100, lightRange: 100, hueRange: 180 },
  };
  for (const id of Object.keys(ADJUSTMENTS)) {
    const img = noise(20, 20, 7, false);
    for (let i = 0; i < 40; i++) img.data[i * 4 + 3] = 0; // transparent block with random colors
    const before = cloneImage(img);
    run(id, img, params[id] || {});
    for (let i = 0; i < img.width * img.height; i++) {
      assert.equal(img.data[i * 4 + 3], before.data[i * 4 + 3], `${id}: alpha changed at ${i}`);
      if (before.data[i * 4 + 3] === 0) {
        for (let c = 0; c < 3; c++) assert.equal(img.data[i * 4 + c], before.data[i * 4 + c], `${id}: transparent pixel ${i} modified`);
      }
    }
  }
});

test("applyAdjustment dispatches by kind and rejects unknown kinds", () => {
  const a = solid(2, 2, [10, 20, 30]);
  const out = applyAdjustment(a, { kind: "invert", params: {} });
  assert.deepEqual(px(out, 0, 0), [245, 235, 225, 255]);
  assert.throws(() => applyAdjustment(a, { kind: "nope" }), /Unknown adjustment/);
  const b = applyAdjustment(solid(1, 1, [0, 0, 0]), { kind: "brightness-contrast", params: { brightness: 100, legacy: true } });
  assert.equal(px(b, 0, 0)[0], 255);
});

test("invert: twice is identity, flags select channels", () => {
  const img = noise(16, 16, 5, false);
  const twice = run("invert", run("invert", cloneImage(img)));
  assert.equal(maxDiff(twice, img), 0);
  const one = run("invert", solid(1, 1, [10, 20, 30]), { red: true, green: false, blue: true });
  assert.deepEqual(px(one, 0, 0), [245, 20, 225, 255]);
});

test("levels: endpoints, gamma, output range and channel selection", () => {
  const lut = buildLevelsLUT({ inBlack: 50, inWhite: 200 });
  assert.equal(lut[0], 0);
  assert.equal(lut[50], 0);
  assert.equal(lut[200], 255);
  assert.equal(lut[255], 255);
  near(lut[125], 127.5, 1);
  const g2 = buildLevelsLUT({ gamma: 2 });
  assert.equal(g2[0], 0);
  assert.equal(g2[255], 255);
  near(g2[128], Math.round(Math.sqrt(128 / 255) * 255), 1);
  const out = buildLevelsLUT({ outBlack: 40, outWhite: 100 });
  assert.equal(out[0], 40);
  assert.equal(out[255], 100);
  const img = solid(1, 1, [50, 100, 200]);
  const r = run("levels", cloneImage(img), { channel: "red", inBlack: 50, inWhite: 150 });
  assert.deepEqual(px(r, 0, 0), [0, 100, 200, 255]);
  const per = run("levels", cloneImage(img), { channels: { blue: { inBlack: 100, inWhite: 200 } } });
  assert.deepEqual(px(per, 0, 0), [50, 100, 255, 255]);
  // per-channel first, then master
  const both = run("levels", solid(1, 1, [100, 100, 100]), { outWhite: 128, channels: { green: { inBlack: 100, inWhite: 200 } } });
  assert.equal(px(both, 0, 0)[1], 0);
  assert.ok(px(both, 0, 0)[0] > 40 && px(both, 0, 0)[0] < 60);
});

test("curves: monotone spline hits its control points and never overshoots", () => {
  const id = buildCurveLUT([[0, 0], [1, 1]]);
  assert.ok(isIdentityLUT(id));
  const lift = buildCurveLUT([[0, 0.2], [1, 0.8]]);
  assert.equal(lift[0], 51);
  assert.equal(lift[255], 204);
  const pts = [[0, 0], [0.25, 0.5], [0.75, 0.5], [1, 1]];
  const f = buildCurveLUT(pts);
  for (let i = 1; i < 256; i++) assert.ok(f[i] >= f[i - 1], "monotone at " + i);
  near(f[64], 128, 2); // x = 0.25 -> 0.5
  near(f[191], 128, 2); // x = 0.75 -> 0.5
  for (let i = 0; i < 256; i++) assert.ok(f[i] >= 0 && f[i] <= 255);
  const bump = buildCurveLUT([[0, 0], [0.5, 0.7], [1, 1]]);
  near(bump[128], 0.7 * 255, 2);
  assert.ok(bump[128] > 128);
  assert.deepEqual(Array.from(buildCurveLUT([[1, 1], [0, 0]])), Array.from(id)); // unsorted input
  assert.equal(buildCurveLUT([[0.5, 0.25]])[200], 64); // single point -> constant
  assert.deepEqual(Array.from(buildCurveLUT([])), Array.from(id)); // no points -> identity
  // master composes after the channel curve
  const out = run("curves", solid(1, 1, [100, 100, 100]), { red: [[0, 1], [1, 1]], master: [[0, 0], [1, 0.5]] });
  assert.equal(px(out, 0, 0)[0], 128);
  assert.equal(px(out, 0, 0)[1], Math.round((100 / 255) * 0.5 * 255));
});

test("brightness / contrast extremes", () => {
  const flat = buildBrightnessContrastLUT(0, -100);
  assert.ok(flat.every((v) => v === 128));
  const hard = buildBrightnessContrastLUT(0, 100);
  assert.equal(hard[10], 0);
  assert.equal(hard[245], 255);
  const bright = buildBrightnessContrastLUT(100, 0);
  assert.equal(bright[0], 0);
  assert.equal(bright[255], 255);
  assert.ok(bright[100] > 100);
  const dark = buildBrightnessContrastLUT(-100, 0);
  assert.ok(dark[200] < 200);
  const legacy = buildBrightnessContrastLUT(100, 0, true);
  assert.equal(legacy[0], 255);
  for (let i = 1; i < 256; i++) assert.ok(bright[i] >= bright[i - 1]);
});

test("hsl: hue rotation, desaturation, lightness extremes, grays are stable", () => {
  assert.deepEqual(px(run("hsl", solid(1, 1, [255, 0, 0]), { hue: 180 }), 0, 0).slice(0, 3), [0, 255, 255]);
  const g = px(run("hsl", solid(1, 1, [255, 0, 0]), { saturation: -100 }), 0, 0);
  assert.equal(g[0], g[1]);
  assert.equal(g[1], g[2]);
  near(g[0], 128, 1);
  assert.deepEqual(px(run("hsl", solid(1, 1, [200, 50, 30]), { lightness: 100 }), 0, 0).slice(0, 3), [255, 255, 255]);
  assert.deepEqual(px(run("hsl", solid(1, 1, [200, 50, 30]), { lightness: -100 }), 0, 0).slice(0, 3), [0, 0, 0]);
  assert.deepEqual(px(run("hsl", solid(1, 1, [90, 90, 90]), { hue: 100, saturation: 80 }), 0, 0).slice(0, 3), [90, 90, 90]);
  const sat = px(run("hsl", solid(1, 1, [150, 100, 100]), { saturation: 100 }), 0, 0);
  assert.ok(sat[0] - sat[1] > 50, "saturation boost increases chroma");
});

test("vibrance boosts muted colors more than saturated ones and never colors grays", () => {
  const chroma = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const muted = [150, 130, 110];
  const vivid = [255, 40, 40];
  const mo = px(run("vibrance", solid(1, 1, muted), { vibrance: 100, protectSkin: false }), 0, 0);
  const vo = px(run("vibrance", solid(1, 1, vivid), { vibrance: 100, protectSkin: false }), 0, 0);
  const gainMuted = chroma(mo) / chroma(muted);
  const gainVivid = chroma(vo) / chroma(vivid);
  assert.ok(gainMuted > 1.5 * gainVivid, `muted gain ${gainMuted} vs vivid ${gainVivid}`);
  assert.deepEqual(px(run("vibrance", solid(1, 1, [120, 120, 120]), { vibrance: 100, saturation: 50 }), 0, 0).slice(0, 3), [120, 120, 120]);
  const skin = px(run("vibrance", solid(1, 1, [230, 170, 140]), { vibrance: 100, protectSkin: true }), 0, 0);
  const noSkin = px(run("vibrance", solid(1, 1, [230, 170, 140]), { vibrance: 100, protectSkin: false }), 0, 0);
  assert.ok(chroma(skin) < chroma(noSkin));
  const less = px(run("vibrance", solid(1, 1, vivid), { vibrance: -100 }), 0, 0);
  assert.ok(chroma(less) < chroma(vivid));
});

test("exposure works in linear light", () => {
  const lut = buildExposureLUT(1, 0, 1);
  // sRGB 188 is about 0.5 linear; +1 EV gives 1.0 -> 255
  assert.equal(lut[255], 255);
  assert.equal(lut[0], 0);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  near(lut[100], Math.round(enc(Math.min(1, lin(100 / 255) * 2)) * 255), 1);
  const down = buildExposureLUT(-1, 0, 1);
  near(down[200], Math.round(enc(lin(200 / 255) / 2) * 255), 1);
  const off = buildExposureLUT(0, 0.1, 1);
  assert.ok(off[0] > 0);
  const gam = buildExposureLUT(0, 0, 2);
  assert.ok(gam[100] > 100);
  assert.ok(isIdentityLUT(buildExposureLUT(0, 0, 1)));
});

test("white balance: warm raises red and lowers blue, keeps luminance, eyedropper neutralizes", () => {
  const out = px(run("white-balance", solid(1, 1, [128, 128, 128]), { temperature: 50 }), 0, 0);
  assert.ok(out[0] > 128 && out[2] < 128);
  const cool = px(run("white-balance", solid(1, 1, [128, 128, 128]), { temperature: -50 }), 0, 0);
  assert.ok(cool[0] < 128 && cool[2] > 128);
  const mag = px(run("white-balance", solid(1, 1, [128, 128, 128]), { tint: 60 }), 0, 0);
  assert.ok(mag[1] < 128 && mag[0] > 128);
  const g = whiteBalanceGains(40, 20);
  near(0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2], 1, 1e-9);
  const cast = [200, 180, 150];
  const wb = whiteBalanceFromColor(...cast);
  assert.ok(wb.temperature < 0, "warm cast needs cooling");
  const fixed = px(run("white-balance", solid(1, 1, cast), wb), 0, 0);
  assert.ok(Math.max(fixed[0], fixed[1], fixed[2]) - Math.min(fixed[0], fixed[1], fixed[2]) <= 12, "neutralized: " + fixed);
});

test("color balance shifts zones and can preserve luminosity", () => {
  const dark = px(run("color-balance", solid(1, 1, [30, 30, 30]), { shadowsCyanRed: 100, preserveLuminosity: false }), 0, 0);
  const bright = px(run("color-balance", solid(1, 1, [230, 230, 230]), { shadowsCyanRed: 100, preserveLuminosity: false }), 0, 0);
  assert.ok(dark[0] - 30 > 40, "shadow red shift " + dark);
  assert.ok(bright[0] - 230 < 3, "highlights barely affected by shadow slider");
  const keep = px(run("color-balance", solid(1, 1, [128, 128, 128]), { midtonesYellowBlue: 60, preserveLuminosity: true }), 0, 0);
  assert.ok(keep[2] > keep[0]);
  near(luma8(keep[0], keep[1], keep[2]), 128, 2);
  const lose = px(run("color-balance", solid(1, 1, [128, 128, 128]), { midtonesYellowBlue: 60, preserveLuminosity: false }), 0, 0);
  assert.ok(luma8(lose[0], lose[1], lose[2]) > luma8(keep[0], keep[1], keep[2]) + 5);
});

test("black & white: hue weights and tint", () => {
  const red = px(run("black-white", solid(1, 1, [255, 0, 0])), 0, 0);
  assert.deepEqual(red.slice(0, 3), [102, 102, 102]);
  const yellow = px(run("black-white", solid(1, 1, [255, 255, 0])), 0, 0);
  assert.deepEqual(yellow.slice(0, 3), [153, 153, 153]);
  const gray = px(run("black-white", solid(1, 1, [77, 77, 77])), 0, 0);
  assert.deepEqual(gray.slice(0, 3), [77, 77, 77]);
  const boosted = px(run("black-white", solid(1, 1, [255, 0, 0]), { reds: 100 }), 0, 0);
  assert.equal(boosted[0], 255);
  const tinted = px(run("black-white", solid(1, 1, [128, 128, 128]), { tint: true, tintColor: "#d09040", tintAmount: 100 }), 0, 0);
  assert.ok(tinted[0] > tinted[2] + 20);
  // interpolation between yellow (60) and green (40) weights at hue 90
  const lime = px(run("black-white", solid(1, 1, [128, 255, 0])), 0, 0);
  near(lime[0], 255 * 0.5, 1); // min = 0, max 255, hue 90 -> weight 0.5 (60..40 interpolated -> 0.5)
});

test("channel mixer: identity, swap, monochrome, constant", () => {
  const swap = run("channel-mixer", solid(1, 1, [10, 20, 30]), { rr: 0, rb: 100, bb: 0, br: 100 });
  assert.deepEqual(px(swap, 0, 0), [30, 20, 10, 255]);
  const mono = px(run("channel-mixer", solid(1, 1, [100, 100, 100]), { monochrome: true, grayR: 50, grayG: 30, grayB: 20 }), 0, 0);
  assert.deepEqual(mono.slice(0, 3), [100, 100, 100]);
  const mono2 = px(run("channel-mixer", solid(1, 1, [200, 100, 0]), { monochrome: true, grayR: 50, grayG: 50, grayB: 0 }), 0, 0);
  assert.deepEqual(mono2.slice(0, 3), [150, 150, 150]);
  const cst = px(run("channel-mixer", solid(1, 1, [10, 10, 10]), { rc: 10 }), 0, 0);
  near(cst[0], 10 + 25.5, 1);
});

test("threshold and posterize quantize as specified", () => {
  const t = run("threshold", solid(2, 1, [127, 127, 127]), { level: 128 });
  assert.equal(px(t, 0, 0)[0], 0);
  const t2 = run("threshold", solid(1, 1, [128, 128, 128]), { level: 128 });
  assert.equal(px(t2, 0, 0)[0], 255);
  const inv = run("threshold", solid(1, 1, [200, 200, 200]), { level: 128, invert: true });
  assert.equal(px(inv, 0, 0)[0], 0);
  const soft = run("threshold", solid(1, 1, [128, 128, 128]), { level: 128, softness: 64 });
  near(px(soft, 0, 0)[0], 128, 5);
  const p2 = buildPosterizeLUT(2);
  assert.deepEqual([...new Set(p2)].sort((a, b) => a - b), [0, 255]);
  const p4 = buildPosterizeLUT(4);
  assert.deepEqual([...new Set(p4)].sort((a, b) => a - b), [0, 85, 170, 255]);
  assert.ok(isIdentityLUT(buildPosterizeLUT(256)));
  const out = run("posterize", ramp(64, 1), { levels: 3 });
  const vals = new Set();
  for (let x = 0; x < 64; x++) vals.add(px(out, x, 0)[0]);
  assert.deepEqual([...vals].sort((a, b) => a - b), [0, 128, 255]);
});

test("gradient map recolors by luma", () => {
  const params = { preset: "custom", shadow: "#ff0000", highlight: "#0000ff", useMidtone: false };
  const dark = px(run("gradient-map", solid(1, 1, [0, 0, 0]), params), 0, 0);
  const light = px(run("gradient-map", solid(1, 1, [255, 255, 255]), params), 0, 0);
  const mid = px(run("gradient-map", solid(1, 1, [128, 128, 128]), params), 0, 0);
  assert.deepEqual(dark.slice(0, 3), [255, 0, 0]);
  assert.deepEqual(light.slice(0, 3), [0, 0, 255]);
  near(mid[0], 127, 2);
  near(mid[2], 128, 2);
  const rev = px(run("gradient-map", solid(1, 1, [0, 0, 0]), { ...params, reverse: true }), 0, 0);
  assert.deepEqual(rev.slice(0, 3), [0, 0, 255]);
  const half = px(run("gradient-map", solid(1, 1, [0, 0, 0]), { ...params, amount: 50 }), 0, 0);
  near(half[0], 128, 1);
  assert.equal(maxDiff(run("gradient-map", noise(8, 8, 2), { amount: 0 }), noise(8, 8, 2)), 0);
  const gl = buildGradientLUT([{ o: 0, color: "#000000" }, { o: 1, color: "#ffffff" }]);
  assert.equal(gl[255 * 3], 255);
  assert.equal(gl[128 * 3], 128);
  const gray = px(run("gradient-map", solid(1, 1, [100, 100, 100]), { preset: "grayscale" }), 0, 0);
  near(gray[0], 100, 1);
});

test("shadows / highlights recover tone locally", () => {
  const img = createImage(64, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) setPx(img, x, y, x < 32 ? [25, 25, 25] : [235, 235, 235]);
  const lifted = run("shadows-highlights", cloneImage(img), { shadows: 100, highlights: 0, shadowRadius: 8, colorCorrection: 0 });
  assert.ok(px(lifted, 8, 16)[0] > 70, "shadows lifted: " + px(lifted, 8, 16));
  assert.ok(Math.abs(px(lifted, 56, 16)[0] - 235) <= 3, "highlights untouched: " + px(lifted, 56, 16));
  const pulled = run("shadows-highlights", cloneImage(img), { shadows: 0, highlights: 100, highlightRadius: 8, colorCorrection: 0 });
  assert.ok(px(pulled, 56, 16)[0] < 190, "highlights pulled down: " + px(pulled, 56, 16));
  assert.ok(Math.abs(px(pulled, 8, 16)[0] - 25) <= 3);
  assert.equal(maxDiff(run("shadows-highlights", cloneImage(img), { shadows: 0, highlights: 0 }), img), 0);
  // length params scale: radius 16 at scale 1 == radius 32 at scale 0.5 on the same image
  const a = ADJUSTMENTS["shadows-highlights"].apply(cloneImage(img), { shadows: 80, shadowRadius: 16 }, { scale: 1 });
  const b = ADJUSTMENTS["shadows-highlights"].apply(cloneImage(img), { shadows: 80, shadowRadius: 32 }, { scale: 0.5 });
  assert.ok(maxDiff(a, b) <= 1);
});

test("photo filter tints and can preserve luminosity", () => {
  const warm = px(run("photo-filter", solid(1, 1, [128, 128, 128]), { filter: "warming-85", density: 50, preserveLuminosity: false }), 0, 0);
  assert.ok(warm[0] > warm[2]);
  const keep = px(run("photo-filter", solid(1, 1, [128, 128, 128]), { filter: "warming-85", density: 50, preserveLuminosity: true }), 0, 0);
  near(luma8(keep[0], keep[1], keep[2]), 128, 2);
  assert.equal(maxDiff(run("photo-filter", noise(8, 8, 3), { density: 0 }), noise(8, 8, 3)), 0);
  const custom = px(run("photo-filter", solid(1, 1, [200, 200, 200]), { filter: "custom", color: "#0000ff", density: 100, preserveLuminosity: false }), 0, 0);
  assert.deepEqual(custom.slice(0, 3), [0, 0, 200]);
});

test("selective color affects only its band", () => {
  const redLess = px(run("selective-color", solid(1, 1, [220, 30, 30]), { redsCyan: 100, method: "relative" }), 0, 0);
  assert.ok(redLess[0] < 200, "relative cyan lowers red a little: " + redLess);
  const redGone = px(run("selective-color", solid(1, 1, [220, 30, 30]), { redsCyan: 100, method: "absolute" }), 0, 0);
  assert.ok(redGone[0] < 5, "absolute cyan removes the red: " + redGone);
  const blue = px(run("selective-color", solid(1, 1, [30, 30, 220]), { redsCyan: 100 }), 0, 0);
  assert.deepEqual(blue.slice(0, 3), [30, 30, 220]);
  const blacks = px(run("selective-color", solid(1, 1, [10, 10, 10]), { blacksBlack: 100, method: "absolute" }), 0, 0);
  assert.ok(blacks[0] < 5);
  const whites = px(run("selective-color", solid(1, 1, [250, 250, 250]), { whitesYellow: 100, method: "absolute" }), 0, 0);
  assert.ok(whites[2] < whites[0] - 100, "whites got yellow: " + whites);
  const gray = px(run("selective-color", solid(1, 1, [128, 128, 128]), { redsCyan: 100, bluesMagenta: 100 }), 0, 0);
  assert.deepEqual(gray.slice(0, 3), [128, 128, 128]);
});

test("recolor maps the source color onto the target color", () => {
  const out = px(run("recolor", solid(1, 1, [208, 48, 48]), { source: "#d03030", target: "#2a6fd0" }), 0, 0);
  assert.ok(out[2] > out[0] + 60, "became blue: " + out);
  near(out[0], 0x2a, 12);
  near(out[2], 0xd0, 12);
  const green = px(run("recolor", solid(1, 1, [40, 200, 40]), { source: "#d03030", target: "#2a6fd0" }), 0, 0);
  assert.deepEqual(green.slice(0, 3), [40, 200, 40]);
  const none = px(run("recolor", solid(1, 1, [208, 48, 48]), { source: "#d03030", target: "#2a6fd0", strength: 0 }), 0, 0);
  assert.deepEqual(none.slice(0, 3), [208, 48, 48]);
  // a slightly different red is shifted along
  const near2 = px(run("recolor", solid(1, 1, [190, 60, 50]), { source: "#d03030", target: "#2a6fd0", hueRange: 40 }), 0, 0);
  assert.ok(near2[2] > near2[0]);
});

test("LUT helpers", () => {
  const a = identityLUT();
  assert.ok(isIdentityLUT(a));
  const inv = new Uint8Array(256).map((_, i) => 255 - i);
  assert.ok(isIdentityLUT(composeLUTs(inv, inv)));
  const img = solid(1, 1, [10, 20, 30]);
  applyLUT(img, inv);
  assert.deepEqual(px(img, 0, 0), [245, 235, 225, 255]);
  // performance sanity: a 1 MP table lookup is fast
  const big = noise(1000, 1000, 1);
  const t0 = performance.now();
  applyLUT(big, inv);
  assert.ok(performance.now() - t0 < 200);
  assert.ok(mean(big, 0) > 0);
});
