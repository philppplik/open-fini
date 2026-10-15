import test from "node:test";
import assert from "node:assert/strict";
import { FILTERS, applyFilter } from "../../app/src/engine/pixel/filters.js";
import { createImage, cloneImage, luma8 } from "../../app/src/engine/pixel/image.js";
import { resizeImage } from "../../app/src/engine/pixel/transform.js";
import { solid, noise, scene, px, setPx, maxDiff, mean, near, rng } from "./_util.js";

const ctx = { scale: 1 };
const run = (id, img, params = {}, c = ctx) => FILTERS[id].apply(img, params, c);

function variance(img, c = 0) {
  const m = mean(img, c);
  let s = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) s += (img.data[i * 4 + c] - m) ** 2;
  return s / n;
}

function stepImage(w, h, left, right, edgeX = w >> 1) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(img, x, y, x < edgeX ? left : right);
  return img;
}

test("registry has at least 16 filters with valid control schemas", () => {
  const ids = Object.keys(FILTERS);
  assert.ok(ids.length >= 16, "filters: " + ids.length);
  for (const id of ["gaussian-blur", "box-blur", "motion-blur", "radial-blur", "zoom-blur", "unsharp-mask", "sharpen", "clarity", "high-pass", "median", "noise-add", "denoise", "pixelate", "emboss", "edge-detect", "vignette", "oil-paint", "halftone", "bloom", "tilt-shift", "defocus", "glitch"]) {
    assert.ok(FILTERS[id], "missing " + id);
  }
  const types = new Set(["range", "int", "bool", "select", "color", "angle", "curve", "point"]);
  for (const [id, m] of Object.entries(FILTERS)) {
    assert.equal(m.id, id);
    assert.ok(m.label && m.category);
    for (const c of m.controls) {
      assert.ok(types.has(c.type), `${id}.${c.key}`);
      assert.deepEqual(m.defaults[c.key], c.default);
      if (c.type === "range" || c.type === "int") assert.ok(c.min <= c.default && c.default <= c.max, `${id}.${c.key} default outside [min,max]`);
      if (c.type === "select") assert.ok(c.options.some((o) => o.value === c.default));
      if (c.type === "point") assert.ok(c.default.x >= 0 && c.default.x <= 1);
    }
  }
});

test("every filter runs with defaults, keeps the size and does not corrupt alpha bounds", () => {
  for (const id of Object.keys(FILTERS)) {
    const img = noise(40, 30, 5, false);
    const out = applyFilter(img, { kind: id, params: {} }, ctx);
    assert.equal(out.width, 40, id);
    assert.equal(out.height, 30, id);
    assert.equal(out.data.length, 40 * 30 * 4, id);
    for (let i = 0; i < out.data.length; i++) assert.ok(Number.isFinite(out.data[i]), id);
  }
  assert.throws(() => applyFilter(solid(2, 2, [0, 0, 0]), { kind: "nope" }), /Unknown filter/);
});

test("filters that keep alpha leave it (and transparent pixels) untouched", () => {
  const keep = ["unsharp-mask", "sharpen", "clarity", "high-pass", "median", "noise-add", "denoise", "emboss", "edge-detect", "vignette", "oil-paint", "halftone", "bloom"];
  for (const id of keep) {
    const img = noise(30, 30, 11, true);
    for (let i = 0; i < img.width * img.height; i++) img.data[i * 4 + 3] = i % 7 === 0 ? 0 : i % 3 === 0 ? 120 : 255;
    const before = cloneImage(img);
    run(id, img, FILTERS[id].defaults);
    for (let i = 0; i < img.width * img.height; i++) {
      assert.equal(img.data[i * 4 + 3], before.data[i * 4 + 3], `${id}: alpha changed`);
      if (before.data[i * 4 + 3] === 0) for (let c = 0; c < 3; c++) assert.equal(img.data[i * 4 + c], before.data[i * 4 + c], `${id}: transparent pixel modified`);
    }
  }
});

test("blur-like filters keep constant images constant (opaque and translucent)", () => {
  const configs = [
    ["gaussian-blur", { radius: 6 }], ["box-blur", { radius: 4, passes: 3 }], ["motion-blur", { angle: 33, distance: 15 }],
    ["radial-blur", { angle: 30 }], ["zoom-blur", { amount: 40 }], ["defocus", { radius: 4 }], ["tilt-shift", { blur: 6, saturation: 0 }],
    ["unsharp-mask", { amount: 300 }], ["sharpen", { amount: 200 }], ["clarity", { amount: 100 }], ["median", { radius: 2 }],
    ["denoise", { strength: 80, colorStrength: 80 }], ["pixelate", { size: 5 }], ["oil-paint", { radius: 3 }],
  ];
  for (const alpha of [255, 140]) {
    for (const [id, params] of configs) {
      const img = solid(37, 29, [90, 160, 210, alpha]);
      const out = run(id, cloneImage(img), params);
      assert.ok(maxDiff(out, img) <= 1, `${id} alpha ${alpha}: constant image changed by ${maxDiff(out, img)}`);
    }
  }
  const hp = run("high-pass", solid(20, 20, [10, 200, 90]), { radius: 3 });
  assert.deepEqual(px(hp, 5, 5), [128, 128, 128, 255]);
});

test("gaussian blur: mean preserved, noise flattened, radius scales with ctx.scale", () => {
  const img = noise(48, 48, 2);
  const out = run("gaussian-blur", cloneImage(img), { radius: 2 });
  near(mean(out, 1), mean(img, 1), 1.5);
  assert.ok(variance(out) < variance(img) * 0.2);
  const zero = run("gaussian-blur", cloneImage(img), { radius: 0 });
  assert.equal(maxDiff(zero, img), 0);
  // preview at half resolution matches the full resolution result downscaled
  const big = scene(128, 128);
  const full = run("gaussian-blur", cloneImage(big), { radius: 8 });
  const half = run("gaussian-blur", resizeImage(big, 64, 64, { filter: "box" }), { radius: 8 }, { scale: 0.5 });
  const ref = resizeImage(full, 64, 64, { filter: "box" });
  let sum = 0;
  for (let i = 0; i < ref.data.length; i++) sum += Math.abs(ref.data[i] - half.data[i]);
  assert.ok(sum / ref.data.length < 2.5, "mean abs diff " + sum / ref.data.length);
});

test("box blur: whole-radius box over a bright pixel", () => {
  const img = solid(9, 1, [0, 0, 0]);
  setPx(img, 4, 0, [255, 255, 255]);
  const out = run("box-blur", img, { radius: 1, passes: 1 });
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((x) => px(out, x, 0)[0]), [0, 0, 0, 85, 85, 85, 0, 0, 0]);
});

test("motion blur follows the angle", () => {
  // vertical 1-px line blurred horizontally over 5 px -> 5 px of 51
  const img = solid(31, 11, [0, 0, 0]);
  for (let y = 0; y < 11; y++) setPx(img, 15, y, [255, 255, 255]);
  const h = run("motion-blur", cloneImage(img), { angle: 0, distance: 5 });
  for (let x = 13; x <= 17; x++) assert.equal(px(h, x, 5)[0], 51, "x=" + x);
  assert.equal(px(h, 12, 5)[0], 0);
  assert.equal(px(h, 18, 5)[0], 0);
  // vertical blur leaves the vertical line alone (interior rows)
  const v = run("motion-blur", cloneImage(img), { angle: 90, distance: 5 });
  assert.equal(px(v, 15, 5)[0], 255);
  assert.equal(px(v, 14, 5)[0], 0);
  // 45 degrees: impulse smears along the up-right diagonal only
  const d = solid(41, 41, [0, 0, 0]);
  setPx(d, 20, 20, [255, 255, 255]);
  const dg = run("motion-blur", d, { angle: 45, distance: 9 });
  assert.ok(px(dg, 22, 18)[0] > 10, "up-right is lit");
  assert.ok(px(dg, 18, 22)[0] > 10, "down-left is lit");
  assert.equal(px(dg, 22, 22)[0], 0, "down-right stays dark");
  assert.equal(px(dg, 18, 18)[0], 0, "up-left stays dark");
  // energy is preserved
  let sum = 0;
  for (let i = 0; i < 41 * 41; i++) sum += dg.data[i * 4];
  near(sum, 255, 6);
  // distance <= 1 is a no-op, linear ramps stay put
  const ramp = createImage(40, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) setPx(ramp, x, y, [x * 6, x * 6, x * 6]);
  const r = run("motion-blur", cloneImage(ramp), { angle: 0, distance: 9 });
  for (let x = 6; x < 34; x++) near(px(r, x, 5)[0], x * 6, 1);
  assert.equal(maxDiff(run("motion-blur", cloneImage(ramp), { distance: 1 }), ramp), 0);
});

test("radial and zoom blur leave the center alone and smear far pixels", () => {
  const img = noise(61, 61, 4);
  const spin = run("radial-blur", cloneImage(img), { angle: 40, center: { x: 0.5, y: 0.5 }, quality: "best" });
  assert.deepEqual(px(spin, 30, 30), px(img, 30, 30));
  assert.ok(variance(spin) < variance(img));
  // pixels on the same circle get averaged: the spin blur of a ring pattern keeps the ring
  const ring = solid(61, 61, [0, 0, 0]);
  for (let y = 0; y < 61; y++) for (let x = 0; x < 61; x++) if (Math.abs(Math.hypot(x - 30, y - 30) - 20) < 1.2) setPx(ring, x, y, [255, 255, 255]);
  const sr = run("radial-blur", cloneImage(ring), { angle: 20, quality: "best" });
  assert.ok(px(sr, 50, 30)[0] > 150, "ring survives spin: " + px(sr, 50, 30)[0]);
  const zm = run("zoom-blur", cloneImage(ring), { amount: 30, quality: "best" });
  assert.ok(px(zm, 50, 30)[0] < 200, "ring is smeared radially");
  const zero = run("zoom-blur", cloneImage(img), { amount: 0 });
  assert.equal(maxDiff(zero, img), 0);
  // draft quality is allowed and finite
  const dr = run("zoom-blur", cloneImage(img), { amount: 30, quality: "draft" });
  assert.ok(Number.isFinite(mean(dr, 0)));
});

test("defocus uses a disc kernel", () => {
  const img = solid(21, 21, [0, 0, 0]);
  setPx(img, 10, 10, [255, 255, 255]);
  const out = run("defocus", img, { radius: 3 });
  assert.equal(px(out, 13, 10)[0], 9); // 255 / 29 taps
  assert.equal(px(out, 10, 13)[0], 9);
  assert.equal(px(out, 14, 10)[0], 0);
  assert.equal(px(out, 13, 11)[0], 0, "outside the disc");
  assert.equal(px(out, 12, 12)[0], 9);
  let sum = 0;
  for (let i = 0; i < 441; i++) sum += out.data[i * 4];
  near(sum, 255, 10);
});

test("tilt-shift keeps the focus band sharp and blurs the rest", () => {
  const img = noise(64, 64, 8);
  const out = run("tilt-shift", cloneImage(img), { focus: { x: 0.5, y: 0.5 }, band: 20, transition: 20, blur: 5, saturation: 0 });
  for (let y = 28; y <= 36; y++) for (let x = 0; x < 64; x += 5) assert.deepEqual(px(out, x, y), px(img, x, y));
  const rowVar = (im, y0, y1) => {
    let s = 0, c = 0;
    for (let y = y0; y < y1; y++) for (let x = 1; x < 64; x++) { s += (im.data[(y * 64 + x) * 4] - im.data[(y * 64 + x - 1) * 4]) ** 2; c++; }
    return s / c;
  };
  assert.ok(rowVar(out, 0, 6) < rowVar(img, 0, 6) * 0.3, "top is blurred");
  assert.ok(rowVar(out, 58, 64) < rowVar(img, 58, 64) * 0.3, "bottom is blurred");
});

test("unsharp mask / sharpen: identity at zero, overshoot at edges, threshold respected", () => {
  const img = stepImage(40, 10, [100, 100, 100], [150, 150, 150]);
  assert.equal(maxDiff(run("unsharp-mask", cloneImage(img), { amount: 0 }), img), 0);
  const u = run("unsharp-mask", cloneImage(img), { amount: 200, radius: 2 });
  assert.ok(px(u, 20, 5)[0] > 155, "bright side overshoots: " + px(u, 20, 5));
  assert.ok(px(u, 19, 5)[0] < 95, "dark side undershoots: " + px(u, 19, 5));
  assert.deepEqual(px(u, 2, 5), [100, 100, 100, 255]);
  const th = run("unsharp-mask", cloneImage(img), { amount: 200, radius: 2, threshold: 100 });
  assert.equal(maxDiff(th, img), 0, "all differences below the threshold");
  assert.equal(maxDiff(run("sharpen", cloneImage(img), { amount: 0 }), img), 0);
  const s = run("sharpen", cloneImage(img), { amount: 100 });
  assert.equal(px(s, 20, 5)[0], 150 + 50);
  assert.equal(px(s, 19, 5)[0], 100 - 50);
  assert.deepEqual(px(s, 10, 5), [100, 100, 100, 255]);
  // radius scales: radius 4 at scale 0.5 == radius 2 at scale 1
  const a = run("unsharp-mask", cloneImage(img), { amount: 150, radius: 2 }, { scale: 1 });
  const b = run("unsharp-mask", cloneImage(img), { amount: 150, radius: 4 }, { scale: 0.5 });
  assert.equal(maxDiff(a, b), 0);
});

test("sharpen does not darken edges next to transparent pixels", () => {
  const img = createImage(10, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 10; x++) setPx(img, x, y, x < 5 ? [0, 0, 0, 0] : [200, 200, 200, 255]);
  const out = run("sharpen", img, { amount: 100 });
  assert.equal(px(out, 5, 1)[0], 200);
  assert.equal(px(out, 5, 1)[3], 255);
});

test("clarity raises or lowers local contrast", () => {
  const img = noise(48, 48, 6);
  // soften noise to a mid-tone texture first so the weighting does not saturate
  const base = run("gaussian-blur", cloneImage(img), { radius: 1.2 });
  const up = run("clarity", cloneImage(base), { amount: 100, radius: 10 });
  const down = run("clarity", cloneImage(base), { amount: -100, radius: 10 });
  assert.ok(variance(up) > variance(base));
  assert.ok(variance(down) < variance(base));
  assert.equal(maxDiff(run("clarity", cloneImage(base), { amount: 0 }), base), 0);
});

test("high pass is centered on 128", () => {
  const img = noise(32, 32, 3);
  const out = run("high-pass", cloneImage(img), { radius: 4 });
  near(mean(out, 0), 128, 3);
  const mono = run("high-pass", cloneImage(img), { radius: 4, monochrome: true });
  assert.equal(px(mono, 5, 5)[0], px(mono, 5, 5)[1]);
});

test("median removes impulse noise and preserves edges and transparency borders", () => {
  const img = solid(15, 15, [100, 100, 100]);
  setPx(img, 7, 7, [255, 255, 255]);
  const out = run("median", img, { radius: 1 });
  assert.deepEqual(px(out, 7, 7), [100, 100, 100, 255]);
  const step = stepImage(20, 8, [20, 20, 20], [220, 220, 220]);
  assert.equal(maxDiff(run("median", cloneImage(step), { radius: 2 }), step), 0);
  const edge = createImage(8, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 8; x++) setPx(edge, x, y, x < 4 ? [0, 0, 0, 0] : [200, 100, 50, 255]);
  const e = run("median", edge, { radius: 1 });
  assert.deepEqual(px(e, 4, 1), [200, 100, 50, 255]);
  assert.deepEqual(px(e, 0, 1), [0, 0, 0, 0]);
  // classic 3x3 median of a known neighborhood
  const k = createImage(3, 3);
  [9, 1, 5, 4, 8, 2, 7, 3, 6].forEach((v, i) => setPx(k, i % 3, (i / 3) | 0, [v * 10, v * 10, v * 10]));
  assert.equal(px(run("median", k, { radius: 1 }), 1, 1)[0], 50);
});

test("add noise is seeded, honors amount and modes", () => {
  const base = solid(64, 64, [128, 128, 128]);
  const a = run("noise-add", cloneImage(base), { amount: 20, seed: 3 });
  const b = run("noise-add", cloneImage(base), { amount: 20, seed: 3 });
  const c = run("noise-add", cloneImage(base), { amount: 20, seed: 4 });
  assert.equal(maxDiff(a, b), 0);
  assert.ok(maxDiff(a, c) > 5);
  assert.equal(maxDiff(run("noise-add", cloneImage(base), { amount: 0 }), base), 0);
  near(mean(a, 0), 128, 2.5);
  const sd = Math.sqrt(variance(a, 0));
  near(sd, 12, 2.5); // amount 20 % -> sigma 12
  const mono = run("noise-add", cloneImage(base), { amount: 30, monochrome: true, seed: 1 });
  for (let i = 0; i < 100; i++) assert.equal(mono.data[i * 4], mono.data[i * 4 + 1]);
  const col = run("noise-add", cloneImage(base), { amount: 30, monochrome: false, seed: 1 });
  let differs = 0;
  for (let i = 0; i < 100; i++) if (col.data[i * 4] !== col.data[i * 4 + 1]) differs++;
  assert.ok(differs > 80);
  const uni = run("noise-add", cloneImage(base), { amount: 10, distribution: "uniform", monochrome: true, seed: 2 });
  let mn = 255, mx = 0;
  for (let i = 0; i < 64 * 64; i++) { mn = Math.min(mn, uni.data[i * 4]); mx = Math.max(mx, uni.data[i * 4]); }
  const amp = 6 * 1.7320508;
  assert.ok(mn >= 128 - amp - 1 && mx <= 128 + amp + 1 && mx - mn > amp, `uniform range ${mn}..${mx}`);
  assert.ok(Math.abs(Math.sqrt(variance(uni, 0)) - 6) < 1);
});

test("denoise reduces noise but keeps edges", () => {
  const w = 64, h = 32;
  const img = createImage(w, h);
  const r = rng(5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const base = x < 32 ? 60 : 200;
    const n = (r() + r() + r() - 1.5) * 24;
    setPx(img, x, y, [base + n, base + n, base + n]);
  }
  const out = run("denoise", cloneImage(img), { strength: 60, colorStrength: 60, radius: 3, detail: 0 });
  const region = (im, x0, x1) => {
    let m = 0, c = 0;
    for (let y = 4; y < h - 4; y++) for (let x = x0; x < x1; x++) { m += im.data[(y * w + x) * 4]; c++; }
    m /= c;
    let s = 0;
    for (let y = 4; y < h - 4; y++) for (let x = x0; x < x1; x++) s += (im.data[(y * w + x) * 4] - m) ** 2;
    return Math.sqrt(s / c);
  };
  assert.ok(region(out, 6, 26) < region(img, 6, 26) * 0.5, `std ${region(out, 6, 26)} vs ${region(img, 6, 26)}`);
  const row = 16;
  assert.ok(px(out, 34, row)[0] - px(out, 29, row)[0] > 100, "edge preserved");
  assert.equal(maxDiff(run("denoise", cloneImage(img), { strength: 0, colorStrength: 0 }), img), 0);
});

test("pixelate averages cells", () => {
  const img = createImage(8, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPx(img, x, y, [(x % 4) * 60, 0, 0]);
  const out = run("pixelate", cloneImage(img), { size: 4 });
  // average of 0,60,120,180 = 90 in every cell
  for (const [x, y] of [[0, 0], [3, 3], [4, 0], [7, 7]]) assert.equal(px(out, x, y)[0], 90);
  const c = run("pixelate", cloneImage(img), { size: 4, mode: "center" });
  assert.equal(px(c, 0, 0)[0], 120);
  assert.equal(maxDiff(run("pixelate", cloneImage(img), { size: 1 }), img), 0);
  // translucent cells keep average alpha and color of visible pixels only
  const t = createImage(2, 2);
  setPx(t, 0, 0, [200, 0, 0, 255]);
  setPx(t, 1, 0, [0, 0, 255, 0]);
  setPx(t, 0, 1, [200, 0, 0, 255]);
  setPx(t, 1, 1, [0, 0, 255, 0]);
  const tp = run("pixelate", t, { size: 2 });
  assert.deepEqual(px(tp, 1, 1), [200, 0, 0, 128]);
});

test("emboss and edge detect respond to edges only", () => {
  const flat = solid(20, 20, [90, 90, 90]);
  assert.deepEqual(px(run("emboss", cloneImage(flat), {}), 10, 10), [128, 128, 128, 255]);
  assert.deepEqual(px(run("edge-detect", cloneImage(flat), {}), 10, 10), [0, 0, 0, 255]);
  assert.deepEqual(px(run("edge-detect", cloneImage(flat), { invert: true }), 10, 10), [255, 255, 255, 255]);
  const step = stepImage(20, 20, [50, 50, 50], [200, 200, 200]);
  const e = run("edge-detect", cloneImage(step), {});
  assert.ok(px(e, 10, 10)[0] >= 148, "edge line: " + px(e, 10, 10)[0]);
  assert.equal(px(e, 3, 10)[0], 0);
  const colored = run("edge-detect", cloneImage(stepImage(20, 20, [0, 0, 0], [255, 0, 0])), { mode: "color" });
  assert.ok(px(colored, 10, 10)[0] > 200 && px(colored, 10, 10)[1] === 0);
  // light direction flips the sign of the relief
  const left = run("emboss", cloneImage(step), { angle: 180, height: 2 });
  const right = run("emboss", cloneImage(step), { angle: 0, height: 2 });
  assert.ok((px(left, 10, 10)[0] - 128) * (px(right, 10, 10)[0] - 128) < 0);
  assert.ok(Math.abs(px(left, 10, 10)[0] - 128) > 20);
  const keep = run("emboss", cloneImage(step), { mode: "color", angle: 180 });
  assert.ok(px(keep, 3, 10)[0] === 50);
});

test("vignette darkens corners, lightens when positive, identity at zero", () => {
  const img = solid(60, 40, [200, 200, 200]);
  const dark = run("vignette", cloneImage(img), { amount: -60, midpoint: 40, feather: 40 });
  assert.deepEqual(px(dark, 30, 20), [200, 200, 200, 255]);
  assert.ok(px(dark, 0, 0)[0] < 100, "corner: " + px(dark, 0, 0)[0]);
  assert.ok(px(dark, 59, 39)[0] < 100);
  const light = run("vignette", solid(60, 40, [100, 100, 100]), { amount: 80 });
  assert.ok(px(light, 0, 0)[0] > 180);
  assert.equal(maxDiff(run("vignette", cloneImage(img), { amount: 0 }), img), 0);
  const round = run("vignette", cloneImage(img), { amount: -100, roundness: 100, midpoint: 30 });
  assert.ok(px(round, 0, 20)[0] < px(round, 30, 0)[0] + 200);
});

test("oil paint flattens texture but keeps hard edges", () => {
  const step = stepImage(30, 10, [20, 40, 60], [220, 200, 180]);
  const out = run("oil-paint", cloneImage(step), { radius: 3, levels: 10 });
  assert.deepEqual(px(out, 3, 5), [20, 40, 60, 255]);
  assert.deepEqual(px(out, 26, 5), [220, 200, 180, 255]);
  const colors = (im) => {
    const s = new Set();
    for (let i = 0; i < im.width * im.height; i++) s.add(im.data[i * 4] + "," + im.data[i * 4 + 1] + "," + im.data[i * 4 + 2]);
    return s.size;
  };
  const n = noise(30, 30, 3);
  const oil = run("oil-paint", cloneImage(n), { radius: 3, levels: 6 });
  assert.ok(variance(oil) < variance(n) * 0.5, "texture flattened: " + variance(oil) + " vs " + variance(n));
  assert.ok(colors(oil) < colors(n));
});

test("halftone produces dots with the right average tone", () => {
  const white = run("halftone", solid(48, 48, [255, 255, 255]), { size: 8, mode: "gray" });
  assert.ok(maxDiff(white, solid(48, 48, [255, 255, 255])) <= 1);
  const black = run("halftone", solid(48, 48, [0, 0, 0]), { size: 8, mode: "gray" });
  assert.ok(mean(black, 0) < 8);
  const mid = run("halftone", solid(96, 96, [128, 128, 128]), { size: 8, mode: "gray", angle: 45 });
  near(mean(mid, 0), 128, 22, "mid gray average");
  // dots, not flat: both dark and light pixels exist
  let lo = 255, hi = 0;
  for (let i = 0; i < 96 * 96; i++) { lo = Math.min(lo, mid.data[i * 4]); hi = Math.max(hi, mid.data[i * 4]); }
  assert.ok(lo < 40 && hi > 215);
  const cmyk = run("halftone", solid(64, 64, [255, 0, 0]), { size: 6, mode: "cmyk" });
  // pure red = magenta + yellow ink: average green and blue are low, red is high
  assert.ok(mean(cmyk, 0) > 200);
  assert.ok(mean(cmyk, 1) < 90);
  const mix = run("halftone", solid(32, 32, [128, 128, 128]), { size: 8, mix: 0 });
  assert.equal(px(mix, 5, 5)[0], 128);
});

test("bloom glows around bright areas only", () => {
  const img = solid(64, 64, [10, 10, 10]);
  for (let y = 28; y < 36; y++) for (let x = 28; x < 36; x++) setPx(img, x, y, [255, 255, 255]);
  const out = run("bloom", cloneImage(img), { threshold: 200, radius: 6, intensity: 100 });
  assert.ok(px(out, 38, 32)[0] > 25, "halo next to the highlight: " + px(out, 38, 32)[0]);
  assert.ok(px(out, 2, 2)[0] <= 11, "far pixels untouched");
  assert.equal(px(out, 31, 31)[0], 255);
  const dark = solid(32, 32, [60, 60, 60]);
  assert.equal(maxDiff(run("bloom", cloneImage(dark), { threshold: 200 }), dark), 0);
  assert.equal(maxDiff(run("bloom", cloneImage(img), { intensity: 0 }), img), 0);
});

test("glitch is seeded and only moves pixels when channel shift is off", () => {
  const img = noise(48, 32, 3);
  const a = run("glitch", cloneImage(img), { seed: 5 });
  const b = run("glitch", cloneImage(img), { seed: 5 });
  const c = run("glitch", cloneImage(img), { seed: 6 });
  assert.equal(maxDiff(a, b), 0);
  assert.ok(maxDiff(a, c) > 0);
  assert.equal(maxDiff(run("glitch", cloneImage(img), { amount: 0, channelShift: 0 }), img), 0);
  const moved = run("glitch", cloneImage(img), { seed: 9, amount: 100, channelShift: 0, displacement: 20 });
  for (let y = 0; y < 32; y++) {
    const row = (im) => Array.from({ length: 48 }, (_, x) => px(im, x, y).join(",")).sort();
    assert.deepEqual(row(moved), row(img), "row " + y + " is a permutation");
  }
  assert.ok(maxDiff(moved, img) > 0);
});
