import test from "node:test";
import assert from "node:assert/strict";
import { resizeImage, affineWarp, perspectiveWarp, rotateImage } from "../../app/src/engine/pixel/transform.js";
import { createImage, cloneImage } from "../../app/src/engine/pixel/image.js";
import { solid, noise, ramp, scene, px, setPx, maxDiff, mean, near } from "./_util.js";

const FILTERS = ["nearest", "bilinear", "bicubic", "lanczos3", "box"];

test("resize of a constant image stays constant for every filter, up and down, with alpha", () => {
  for (const alpha of [255, 130]) {
    const img = solid(23, 17, [90, 160, 210, alpha]);
    for (const filter of FILTERS) {
      for (const [w, h] of [[7, 5], [23, 17], [60, 40], [11, 40], [90, 3]]) {
        const out = resizeImage(img, w, h, { filter });
        assert.equal(out.width, w);
        assert.equal(out.height, h);
        for (let i = 0; i < w * h; i++) {
          assert.ok(Math.abs(out.data[i * 4] - 90) <= 1 && Math.abs(out.data[i * 4 + 1] - 160) <= 1 && Math.abs(out.data[i * 4 + 2] - 210) <= 1, `${filter} ${w}x${h} a=${alpha}`);
          assert.ok(Math.abs(out.data[i * 4 + 3] - alpha) <= 1, `${filter} alpha`);
        }
      }
    }
  }
});

test("same-size resize copies, nearest replicates pixels", () => {
  const img = noise(9, 7, 4);
  const same = resizeImage(img, 9, 7);
  assert.equal(maxDiff(same, img), 0);
  assert.notEqual(same.data, img.data);
  const up = resizeImage(img, 18, 14, { filter: "nearest" });
  for (const [x, y] of [[0, 0], [5, 3], [17, 13], [10, 9]]) assert.deepEqual(px(up, x, y), px(img, x >> 1, y >> 1));
  const down = resizeImage(img, 3, 7, { filter: "nearest" });
  assert.equal(down.width, 3);
});

test("box downscale is an exact area average; antialiased filters average a checkerboard", () => {
  const img = createImage(8, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPx(img, x, y, [(x % 2) * 255 + (y % 2) * 0, 0, 0]);
  const half = resizeImage(img, 4, 4, { filter: "box" });
  for (let i = 0; i < 16; i++) near(half.data[i * 4], 127.5, 0.51);
  const cell = createImage(4, 4);
  const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];
  vals.forEach((v, i) => setPx(cell, i % 4, (i / 4) | 0, [v, v, v]));
  const two = resizeImage(cell, 2, 2, { filter: "box" });
  assert.equal(px(two, 0, 0)[0], (10 + 20 + 50 + 60) / 4);
  assert.equal(px(two, 1, 1)[0], (110 + 120 + 150 + 160) / 4);
  const third = resizeImage(solid(9, 9, [0, 0, 0]), 3, 3, { filter: "box" });
  assert.equal(px(third, 1, 1)[0], 0);
  // checkerboard 1px: stretched kernels average to mid gray, nearest aliases
  const check = createImage(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const v = (x + y) % 2 ? 255 : 0; setPx(check, x, y, [v, v, v]); }
  for (const filter of ["bilinear", "bicubic", "lanczos3", "box"]) {
    const o = resizeImage(check, 8, 8, { filter });
    for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) near(px(o, x, y)[0], 127.5, 14, filter);
  }
  const alias = resizeImage(check, 16, 16, { filter: "nearest" });
  assert.ok(Math.abs(px(alias, 3, 3)[0] - 127.5) > 100, "nearest aliases");
});

test("resize is premultiplied: no dark fringe at transparent edges", () => {
  const img = createImage(20, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) setPx(img, x, y, [255, 255, 255, 255]);
  for (const filter of ["bilinear", "bicubic", "lanczos3", "box"]) {
    const up = resizeImage(img, 41, 41, { filter });
    for (let x = 18; x <= 22; x++) {
      const p = px(up, x, 20);
      if (p[3] > 0) assert.ok(p[0] >= 250 && p[1] >= 250, `${filter}: x=${x} ${p}`);
    }
    const down = resizeImage(img, 7, 7, { filter });
    const e = px(down, 3, 3);
    if (e[3] > 0) assert.ok(e[0] >= 250, `${filter} down: ${e}`);
  }
});

test("resize keeps the mean, monotone ramps and endpoints", () => {
  const sc = scene(80, 60);
  for (const filter of FILTERS) {
    const out = resizeImage(sc, 40, 30, { filter });
    near(mean(out, 0), mean(sc, 0), 2.5, filter);
    near(mean(out, 2), mean(sc, 2), 2.5, filter);
  }
  const r = resizeImage(ramp(16, 1), 64, 1, { filter: "bilinear" });
  for (let x = 1; x < 64; x++) assert.ok(px(r, x, 0)[0] >= px(r, x - 1, 0)[0]);
  assert.equal(px(r, 0, 0)[0], 0);
  assert.equal(px(r, 63, 0)[0], 255);
  // bicubic / lanczos may overshoot internally but the output is clamped to bytes
  const sharp = createImage(8, 1);
  for (let x = 0; x < 8; x++) setPx(sharp, x, 0, x < 4 ? [0, 0, 0] : [255, 255, 255]);
  const lz = resizeImage(sharp, 32, 1, { filter: "lanczos3" });
  for (let x = 0; x < 32; x++) assert.ok(px(lz, x, 0)[0] >= 0 && px(lz, x, 0)[0] <= 255);
  assert.deepEqual(resizeImage(createImage(0, 0), 4, 4).data.length, 64);
});

test("resize speed: 2 MP down to 1 MP", () => {
  const big = noise(1600, 1250, 1);
  const t0 = performance.now();
  const out = resizeImage(big, 1131, 884, { filter: "bicubic" });
  const dt = performance.now() - t0;
  assert.equal(out.width, 1131);
  assert.ok(dt < 1500, "resize ms " + dt);
});

test("rotateImage: multiples of 90 degrees are lossless", () => {
  const img = noise(7, 5, 3);
  const r90 = rotateImage(img, 90);
  assert.equal(r90.width, 5);
  assert.equal(r90.height, 7);
  // clockwise: the top-left pixel ends up at the top-right corner
  assert.deepEqual(px(r90, 4, 0), px(img, 0, 0));
  assert.deepEqual(px(r90, 0, 0), px(img, 0, 4));
  assert.deepEqual(px(r90, 4, 6), px(img, 6, 0));
  const r180 = rotateImage(img, 180);
  assert.deepEqual(px(r180, 0, 0), px(img, 6, 4));
  assert.equal(maxDiff(rotateImage(rotateImage(img, 90), -90), img), 0);
  assert.equal(maxDiff(rotateImage(rotateImage(img, 180), 180), img), 0);
  assert.equal(maxDiff(rotateImage(img, 270), rotateImage(img, -90)), 0);
  assert.equal(maxDiff(rotateImage(img, 0), img), 0);
  assert.equal(maxDiff(rotateImage(rotateImage(rotateImage(rotateImage(img, 90), 90), 90), 90), img), 0);
  assert.equal(maxDiff(rotateImage(img, 360), img), 0);
});

test("rotateImage: arbitrary angles expand the canvas and keep content", () => {
  const img = solid(40, 20, [200, 100, 50]);
  const r = rotateImage(img, 45);
  assert.equal(r.width, Math.ceil((40 + 20) / Math.SQRT2));
  assert.equal(r.height, r.width);
  assert.deepEqual(px(r, r.width >> 1, r.height >> 1), [200, 100, 50, 255]);
  assert.equal(px(r, 0, 0)[3], 0, "corner is transparent");
  const kept = rotateImage(img, 30, { expand: false });
  assert.equal(kept.width, 40);
  assert.equal(kept.height, 20);
  const bg = rotateImage(img, 45, { background: "#0000ff" });
  assert.deepEqual(px(bg, 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(px(bg, bg.width >> 1, bg.height >> 1), [200, 100, 50, 255]);
  // rotating a gradient scene by an angle and back stays close in the interior
  const sc = scene(64, 64);
  const back = rotateImage(rotateImage(sc, 20, { filter: "bicubic" }), -20, { filter: "bicubic" });
  let sum = 0, n = 0;
  const ox = (back.width - 64) >> 1, oy = (back.height - 64) >> 1;
  for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) { sum += Math.abs(px(back, x + ox, y + oy)[0] - px(sc, x, y)[0]); n++; }
  assert.ok(sum / n < 12, "round trip error " + sum / n);
});

test("affineWarp: exact integer translation, scaling and background", () => {
  const img = noise(10, 8, 5);
  const moved = affineWarp(img, [1, 0, 0, 1, 3, 2], 10, 8, { filter: "bilinear" });
  assert.deepEqual(px(moved, 5, 4), px(img, 2, 2));
  assert.deepEqual(px(moved, 9, 7), px(img, 6, 5));
  assert.equal(px(moved, 0, 0)[3], 0);
  assert.equal(px(moved, 2, 5)[3], 0);
  const same = affineWarp(img, [1, 0, 0, 1, 0, 0], 10, 8, { filter: "bicubic" });
  assert.ok(maxDiff(same, img) <= 1);
  const up = affineWarp(img, [2, 0, 0, 2, 0, 0], 20, 16, { filter: "nearest" });
  assert.deepEqual(px(up, 7, 5), px(img, 3, 2));
  const bg = affineWarp(img, [1, 0, 0, 1, 5, 5], 10, 8, { background: "#112233" });
  assert.deepEqual(px(bg, 0, 0), [17, 34, 51, 255]);
  const degenerate = affineWarp(img, [0, 0, 0, 0, 0, 0], 4, 4);
  assert.equal(degenerate.data.every((v) => v === 0), true);
  // strong minification is pre-filtered: mean is preserved instead of aliasing
  const big = noise(200, 200, 2);
  const tiny = affineWarp(big, [0.1, 0, 0, 0.1, 0, 0], 20, 20, { filter: "bilinear" });
  near(mean(tiny, 0), mean(big, 0), 6);
  let sd = 0;
  for (let i = 0; i < 400; i++) sd += (tiny.data[i * 4] - mean(tiny, 0)) ** 2;
  assert.ok(Math.sqrt(sd / 400) < 20, "noise averaged out, std " + Math.sqrt(sd / 400));
});

test("perspectiveWarp: identity quad, crops and keystone", () => {
  const sc = scene(60, 40);
  const id = perspectiveWarp(sc, [0, 0, 60, 0, 60, 40, 0, 40], 60, 40, { filter: "bilinear" });
  assert.ok(maxDiff(id, sc) <= 1);
  const crop = perspectiveWarp(sc, [[10, 5], [40, 5], [40, 25], [10, 25]], 30, 20, { filter: "bilinear" });
  for (const [x, y] of [[0, 0], [15, 10], [29, 19]]) assert.ok(Math.abs(px(crop, x, y)[0] - px(sc, x + 10, y + 5)[0]) <= 1);
  const flat = solid(50, 50, [30, 90, 150]);
  const key = perspectiveWarp(flat, [{ x: 10, y: 5 }, { x: 40, y: 12 }, { x: 44, y: 38 }, { x: 6, y: 45 }], 24, 24);
  assert.deepEqual(px(key, 12, 12), [30, 90, 150, 255]);
  assert.deepEqual(px(key, 0, 0), [30, 90, 150, 255]);
  // keystone: the output top row samples a shorter source edge than the bottom row
  const stripes = createImage(100, 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) setPx(stripes, x, y, [x % 20 < 10 ? 255 : 0, 0, 0]);
  const kst = perspectiveWarp(stripes, [30, 10, 70, 10, 100, 90, 0, 90], 100, 80, { filter: "nearest" });
  const transitions = (y) => {
    let n = 0;
    for (let x = 1; x < 100; x++) if (px(kst, x, y)[0] !== px(kst, x - 1, y)[0]) n++;
    return n;
  };
  assert.ok(transitions(2) < transitions(77), `top ${transitions(2)} vs bottom ${transitions(77)}`);
  assert.throws(() => perspectiveWarp(sc, [0, 0, 1, 1], 4, 4));
  // numbers-only quad works too
  assert.equal(perspectiveWarp(sc, [0, 0, 60, 0, 60, 40, 0, 40], 30, 20).width, 30);
});
