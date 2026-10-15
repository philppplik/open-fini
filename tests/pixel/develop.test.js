import test from "node:test";
import assert from "node:assert/strict";
import { DEVELOP, TONEMAP } from "../../app/src/engine/pixel/develop.js";
import { createImage, cloneImage } from "../../app/src/engine/pixel/image.js";
import { solid, noise, ramp, scene, px, setPx, maxDiff, mean, near, rng } from "./_util.js";

const ctx = { scale: 1 };
const dev = (img, p) => DEVELOP.apply(img, p, ctx);

function variance(img, c = 0) {
  const m = mean(img, c);
  let s = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) s += (img.data[i * 4 + c] - m) ** 2;
  return s / n;
}

function halves(w, h, a, b) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(img, x, y, x < w / 2 ? [a, a, a] : [b, b, b]);
  return img;
}

const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

test("Develop module exposes a valid schema; defaults are an exact identity", () => {
  assert.equal(DEVELOP.id, "develop");
  const keys = new Set();
  for (const c of DEVELOP.controls) {
    assert.ok(!keys.has(c.key), "duplicate " + c.key);
    keys.add(c.key);
    assert.deepEqual(DEVELOP.defaults[c.key], c.default);
    assert.ok(["range", "int", "curve"].includes(c.type));
    if (c.type === "range") assert.ok(c.min <= c.default && c.default <= c.max, c.key);
  }
  for (const k of ["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "vibrance", "saturation", "clarity", "dehaze", "sharpenAmount", "sharpenRadius", "luminanceNR", "colorNR", "vignetteAmount", "vignetteMidpoint", "vignetteFeather", "grainAmount", "toneCurve"]) {
    assert.ok(keys.has(k), "missing control " + k);
  }
  assert.ok(DEVELOP.controls.some((c) => c.type === "curve"));
  assert.ok(DEVELOP.controls.some((c) => /^hsl/.test(c.key)), "per-band HSL controls");
  const img = noise(30, 30, 3, false);
  assert.equal(maxDiff(dev(cloneImage(img), {}), img), 0);
  assert.equal(maxDiff(dev(cloneImage(img), { toneCurve: [[0, 0], [1, 1]] }), img), 0);
});

test("exposure acts in linear light and white balance shifts channels", () => {
  const out = dev(solid(2, 2, [100, 100, 100]), { exposure: 1 });
  near(px(out, 0, 0)[0], Math.round(enc(lin(100 / 255) * 2) * 255), 1);
  const down = dev(solid(2, 2, [200, 200, 200]), { exposure: -2 });
  near(px(down, 0, 0)[0], Math.round(enc(lin(200 / 255) / 4) * 255), 1);
  const warm = px(dev(solid(1, 1, [128, 128, 128]), { temperature: 50 }), 0, 0);
  assert.ok(warm[0] > 128 && warm[2] < 128);
  const mag = px(dev(solid(1, 1, [128, 128, 128]), { tint: 50 }), 0, 0);
  assert.ok(mag[1] < 128);
});

test("highlights / shadows are local, whites / blacks move the end points", () => {
  const img = halves(64, 32, 30, 225);
  const hl = dev(cloneImage(img), { highlights: -100 });
  assert.ok(px(hl, 50, 16)[0] < 200, "highlights pulled down: " + px(hl, 50, 16)[0]);
  assert.ok(Math.abs(px(hl, 5, 16)[0] - 30) <= 2);
  const sh = dev(cloneImage(img), { shadows: 100 });
  assert.ok(px(sh, 5, 16)[0] > 55, "shadows lifted: " + px(sh, 5, 16)[0]);
  assert.ok(Math.abs(px(sh, 60, 16)[0] - 225) <= 4);
  const lift = dev(solid(1, 1, [0, 0, 0]), { blacks: 50 });
  assert.ok(px(lift, 0, 0)[0] > 20);
  const crush = dev(solid(1, 1, [20, 20, 20]), { blacks: -100 });
  assert.equal(px(crush, 0, 0)[0], 0);
  const white = dev(solid(1, 1, [230, 230, 230]), { whites: 100 });
  assert.equal(px(white, 0, 0)[0], 255);
  const dimmer = dev(solid(1, 1, [255, 255, 255]), { whites: -100 });
  assert.ok(px(dimmer, 0, 0)[0] < 230);
});

test("contrast and tone curve", () => {
  const r = ramp(256, 2);
  const hi = dev(cloneImage(r), { contrast: 60 });
  const lo = dev(cloneImage(r), { contrast: -60 });
  assert.ok(variance(hi) > variance(r) && variance(lo) < variance(r));
  assert.ok(px(hi, 40, 0)[0] < 40 && px(hi, 215, 0)[0] > 215);
  for (let x = 1; x < 256; x++) assert.ok(px(hi, x, 0)[0] >= px(hi, x - 1, 0)[0], "monotone");
  assert.equal(px(hi, 0, 0)[0], 0);
  assert.equal(px(hi, 255, 0)[0], 255);
  const curved = dev(cloneImage(r), { toneCurve: [[0, 0], [0.5, 0.25], [1, 1]] });
  assert.ok(px(curved, 128, 0)[0] < 90);
  assert.equal(px(curved, 0, 0)[0], 0);
  assert.equal(px(curved, 255, 0)[0], 255);
  const inverted = dev(cloneImage(r), { toneCurve: [[0, 1], [1, 0]] });
  assert.equal(px(inverted, 0, 0)[0], 255);
  assert.equal(px(inverted, 255, 0)[0], 0);
});

test("clarity, dehaze, sharpening and noise reduction change local detail", () => {
  const base = scene(96, 64);
  const cl = dev(cloneImage(base), { clarity: 100 });
  assert.ok(variance(cl) > variance(base));
  assert.ok(variance(dev(cloneImage(base), { clarity: -100 })) < variance(base));
  // a hazy (low contrast, bright) image regains contrast
  const hazy = createImage(80, 40);
  const r = rng(2);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) {
    const v = 170 + (x < 40 ? 0 : 25) + (r() - 0.5) * 6;
    setPx(hazy, x, y, [v, v + 5, v + 12]);
  }
  const dh = dev(cloneImage(hazy), { dehaze: 80 });
  assert.ok(variance(dh) > variance(hazy) * 1.5, "dehaze contrast: " + variance(dh) + " vs " + variance(hazy));
  const more = dev(cloneImage(hazy), { dehaze: -80 });
  assert.ok(mean(more, 0) > 0);
  // sharpening overshoots at a soft edge
  const soft = createImage(40, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) setPx(soft, x, y, x < 20 ? [100, 100, 100] : [140, 140, 140]);
  const sh = dev(cloneImage(soft), { sharpenAmount: 120, sharpenRadius: 1.5 });
  assert.ok(px(sh, 20, 5)[0] > 140);
  assert.ok(px(sh, 19, 5)[0] < 100);
  assert.deepEqual(px(sh, 3, 5), [100, 100, 100, 255]);
  const masked = dev(cloneImage(soft), { sharpenAmount: 120, sharpenRadius: 1.5, sharpenMasking: 100 });
  assert.ok(px(masked, 20, 5)[0] <= px(sh, 20, 5)[0]);
  // noise reduction lowers the noise level of a flat patch but keeps its mean
  const noisy = createImage(64, 64);
  const g = rng(5);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const n = (g() + g() + g() - 1.5) * 30;
    setPx(noisy, x, y, [128 + n, 128 + n, 128 + n]);
  }
  const nr = dev(cloneImage(noisy), { luminanceNR: 80, colorNR: 80 });
  assert.ok(variance(nr) < variance(noisy) * 0.4, `variance ${variance(nr)} vs ${variance(noisy)}`);
  near(mean(nr, 0), mean(noisy, 0), 3);
});

test("saturation, vibrance and per-band HSL", () => {
  const gray = px(dev(solid(1, 1, [200, 90, 60]), { saturation: -100 }), 0, 0);
  assert.ok(Math.abs(gray[0] - gray[1]) <= 1 && Math.abs(gray[1] - gray[2]) <= 1);
  const chroma = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const muted = [150, 130, 120];
  assert.ok(chroma(px(dev(solid(1, 1, muted), { vibrance: 100 }), 0, 0)) > chroma(muted) + 10);
  assert.deepEqual(px(dev(solid(1, 1, [90, 90, 90]), { vibrance: 100, saturation: 100 }), 0, 0).slice(0, 3), [90, 90, 90]);
  // blue band desaturated, red band untouched
  const blue = px(dev(solid(1, 1, [40, 60, 220]), { hslBlueSat: -100 }), 0, 0);
  assert.ok(chroma(blue) < chroma([40, 60, 220]) * 0.5, "blue desaturated: " + blue);
  assert.deepEqual(px(dev(solid(1, 1, [220, 40, 40]), { hslBlueSat: -100 }), 0, 0).slice(0, 3), [220, 40, 40]);
  const shifted = px(dev(solid(1, 1, [220, 40, 40]), { hslRedHue: 100 }), 0, 0);
  assert.ok(shifted[1] > 80, "red hue pushed toward orange/yellow: " + shifted);
  const lum = px(dev(solid(1, 1, [60, 200, 60]), { hslGreenLum: 100 }), 0, 0);
  assert.ok(lum[0] + lum[1] + lum[2] > 60 + 200 + 60 + 40);
});

test("vignette, grain and alpha handling", () => {
  const flat = solid(80, 60, [180, 180, 180]);
  const vg = dev(cloneImage(flat), { vignetteAmount: -80 });
  assert.deepEqual(px(vg, 40, 30), [180, 180, 180, 255]);
  assert.ok(px(vg, 0, 0)[0] < 110);
  assert.ok(px(dev(solid(80, 60, [100, 100, 100]), { vignetteAmount: 80 }), 0, 0)[0] > 170);
  const a = dev(cloneImage(flat), { grainAmount: 40, grainSeed: 3 });
  const b = dev(cloneImage(flat), { grainAmount: 40, grainSeed: 3 });
  const c = dev(cloneImage(flat), { grainAmount: 40, grainSeed: 4 });
  assert.equal(maxDiff(a, b), 0);
  assert.ok(maxDiff(a, c) > 0);
  assert.ok(variance(a) > 4);
  near(mean(a, 0), 180, 2);
  const coarse = dev(cloneImage(flat), { grainAmount: 40, grainSize: 100, grainRoughness: 0, grainSeed: 3 });
  assert.ok(variance(coarse) > 1);
  assert.equal(maxDiff(dev(cloneImage(flat), { grainAmount: 0 }), flat), 0);
  const img = noise(24, 24, 9, false);
  for (let i = 0; i < 30; i++) img.data[i * 4 + 3] = 0;
  const before = cloneImage(img);
  dev(img, { exposure: 0.8, contrast: 20, clarity: 30, dehaze: 20, vibrance: 40, grainAmount: 30, vignetteAmount: -50, sharpenAmount: 50, hslRedHue: 30 });
  for (let i = 0; i < 576; i++) {
    assert.equal(img.data[i * 4 + 3], before.data[i * 4 + 3]);
    if (before.data[i * 4 + 3] === 0) for (let c = 0; c < 3; c++) assert.equal(img.data[i * 4 + c], before.data[i * 4 + c]);
  }
});

test("scale multiplies pixel radii (sharpening radius 3 at scale 0.5 == radius 1.5 at scale 1)", () => {
  const soft = createImage(40, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) setPx(soft, x, y, x < 20 ? [100, 100, 100] : [140, 140, 140]);
  const a = DEVELOP.apply(cloneImage(soft), { sharpenAmount: 100, sharpenRadius: 1.5 }, { scale: 1 });
  const b = DEVELOP.apply(cloneImage(soft), { sharpenAmount: 100, sharpenRadius: 3 }, { scale: 0.5 });
  assert.equal(maxDiff(a, b), 0);
});

test("tone mapping compresses broad contrast and keeps neutral params identical", () => {
  assert.equal(TONEMAP.id, "tone-mapping");
  for (const c of TONEMAP.controls) assert.deepEqual(TONEMAP.defaults[c.key], c.default);
  const img = noise(20, 20, 4, false);
  assert.equal(maxDiff(TONEMAP.apply(cloneImage(img), { strength: 0, detail: 0, contrast: 0, saturation: 0 }, ctx), img), 0);
  // dark and bright halves: strong compression pulls them together
  const hdr = halves(96, 48, 15, 245);
  const out = TONEMAP.apply(cloneImage(hdr), { strength: 100, smoothing: 30 }, ctx);
  const gapBefore = px(hdr, 80, 24)[0] - px(hdr, 10, 24)[0];
  const gapAfter = px(out, 80, 24)[0] - px(out, 10, 24)[0];
  assert.ok(gapAfter < gapBefore * 0.7, `range ${gapAfter} vs ${gapBefore}`);
  assert.ok(px(out, 10, 24)[0] > 15, "dark side lifted");
  assert.ok(px(out, 80, 24)[0] < 245, "bright side lowered");
  // fine texture on the bright side keeps (and with detail boost gains) local contrast
  const tex = halves(96, 48, 40, 200);
  const r = rng(8);
  for (let y = 0; y < 48; y++) for (let x = 48; x < 96; x++) { const v = 200 + (r() - 0.5) * 30; setPx(tex, x, y, [v, v, v]); }
  const flat = TONEMAP.apply(cloneImage(tex), { strength: 60, detail: 0 }, ctx);
  const boosted = TONEMAP.apply(cloneImage(tex), { strength: 60, detail: 80 }, ctx);
  const region = (im) => {
    let m = 0, c = 0;
    for (let y = 8; y < 40; y++) for (let x = 56; x < 90; x++) { m += im.data[(y * 96 + x) * 4]; c++; }
    m /= c;
    let s = 0;
    for (let y = 8; y < 40; y++) for (let x = 56; x < 90; x++) s += (im.data[(y * 96 + x) * 4] - m) ** 2;
    return s / c;
  };
  assert.ok(region(boosted) > region(flat) * 1.4, `detail ${region(boosted)} vs ${region(flat)}`);
  const sat = TONEMAP.apply(solid(8, 8, [200, 100, 50]), { strength: 0, saturation: 100 }, ctx);
  const chroma = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  assert.ok(chroma(px(sat, 0, 0)) > chroma([200, 100, 50]));
  const withAlpha = noise(16, 16, 2, false);
  for (let i = 0; i < 16; i++) withAlpha.data[i * 4 + 3] = 0;
  const b2 = cloneImage(withAlpha);
  TONEMAP.apply(withAlpha, { strength: 90, contrast: 30 }, ctx);
  for (let i = 0; i < 256; i++) assert.equal(withAlpha.data[i * 4 + 3], b2.data[i * 4 + 3]);
  for (let i = 0; i < 16; i++) assert.equal(withAlpha.data[i * 4], b2.data[i * 4]);
});
