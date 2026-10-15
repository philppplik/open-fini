import test from "node:test";
import assert from "node:assert/strict";
import { histogram, stats, channelStats, percentile, autoLevels, autoContrast, autoColor, averageColor } from "../../app/src/engine/pixel/histogram.js";
import { applyAdjustment } from "../../app/src/engine/pixel/adjustments.js";
import { Mask } from "../../app/src/engine/pixel/selection.js";
import { createImage, cloneImage } from "../../app/src/engine/pixel/image.js";
import { solid, ramp, px, setPx, mean, near } from "./_util.js";

function lowContrastRamp(w, h, lo, hi, cast = [0, 0, 0]) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = lo + ((hi - lo) * x) / (w - 1);
    setPx(img, x, y, [v + cast[0], v + cast[1], v + cast[2]]);
  }
  return img;
}

test("histogram counts channels and luma, skipping transparent pixels and masked-out pixels", () => {
  const img = createImage(4, 1);
  setPx(img, 0, 0, [10, 20, 30, 255]);
  setPx(img, 1, 0, [10, 20, 30, 255]);
  setPx(img, 2, 0, [200, 200, 200, 255]);
  setPx(img, 3, 0, [99, 99, 99, 0]);
  const h = histogram(img);
  assert.equal(h.count, 3);
  assert.equal(h.r[10], 2);
  assert.equal(h.g[20], 2);
  assert.equal(h.b[30], 2);
  assert.equal(h.r[200], 1);
  assert.equal(h.r[99], 0);
  assert.equal(h.luma[200], 1);
  assert.equal(h.luma.reduce((a, b) => a + b, 0), 3);
  for (const a of [h.r, h.g, h.b, h.luma]) assert.ok(a instanceof Uint32Array && a.length === 256);
  const mask = new Mask(4, 1);
  mask.data.set([255, 0, 255, 255]);
  const hm = histogram(img, { mask });
  assert.equal(hm.count, 2);
  assert.equal(hm.r[10], 1);
  assert.throws(() => histogram(img, { mask: Mask.empty(2, 2) }));
});

test("stats, channelStats and percentile", () => {
  const h = histogram(ramp(256, 2));
  const s = stats(h);
  assert.equal(s.count, 512);
  assert.equal(s.r.min, 0);
  assert.equal(s.r.max, 255);
  near(s.r.mean, 127.5, 0.01);
  assert.equal(s.r.median, 127);
  near(s.luma.stddev, 73.9, 0.2);
  assert.equal(stats(solid(3, 3, [5, 6, 7])).g.mean, 6);
  assert.equal(channelStats(new Uint32Array(256)).count, 0);
  assert.equal(percentile(h.r, 0.5), 128);
  assert.equal(percentile(h.r, 0), 0);
  assert.equal(percentile(h.r, 0.999), 255);
  assert.equal(percentile(new Uint32Array(256), 0.5), 0);
});

test("autoLevels stretches a low-contrast ramp to the full range", () => {
  const img = lowContrastRamp(256, 4, 80, 160);
  const params = autoLevels(img, { clip: 0 });
  assert.equal(params.channel, "rgb");
  for (const c of ["red", "green", "blue"]) {
    assert.equal(params.channels[c].inBlack, 80);
    assert.equal(params.channels[c].inWhite, 160);
  }
  const out = applyAdjustment(cloneImage(img), { kind: "levels", params }, { scale: 1 });
  assert.equal(px(out, 0, 0)[0], 0);
  assert.equal(px(out, 255, 0)[0], 255);
  near(px(out, 128, 0)[0], 127.5, 4);
  // clipping ignores outliers: one white pixel in a dark image does not set the white point
  const dark = lowContrastRamp(100, 100, 20, 60);
  setPx(dark, 0, 0, [255, 255, 255]);
  const strict = autoLevels(dark, { clip: 0 });
  const clipped = autoLevels(dark, { clip: 0.5 });
  assert.equal(strict.channels.red.inWhite, 255);
  assert.ok(clipped.channels.red.inWhite < 70);
  // identity for an already full-range image
  const full = autoLevels(ramp(256, 1), { clip: 0 });
  assert.equal(full.channels.red.inBlack, 0);
  assert.equal(full.channels.red.inWhite, 255);
  // accepts a histogram as input
  assert.deepEqual(autoLevels(histogram(img), { clip: 0 }).channels.red, params.channels.red);
});

test("autoContrast uses one shared range and keeps hues", () => {
  const img = lowContrastRamp(256, 4, 60, 140, [0, 10, 20]);
  const p = autoContrast(img, { clip: 0 });
  assert.equal(p.channels, null);
  assert.equal(p.inBlack, 60);
  assert.equal(p.inWhite, 160);
  const out = applyAdjustment(cloneImage(img), { kind: "levels", params: p }, { scale: 1 });
  const a = px(out, 128, 0);
  // the cast (g - r about 10 levels, b - r about 20) is scaled by the same factor
  near(a[1] - a[0], (10 * 255) / 100, 3);
  near(a[2] - a[0], (20 * 255) / 100, 3);
  const flat = autoContrast(solid(8, 8, [100, 100, 100]));
  assert.equal(flat.inBlack, 0);
  assert.equal(flat.inWhite, 255);
});

test("autoColor removes a global color cast", () => {
  const img = lowContrastRamp(256, 8, 30, 220);
  for (let i = 0; i < img.width * img.height; i++) {
    img.data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2] * 0.55); // strong yellow cast: blue channel is weak
  }
  const spread = (im) => Math.max(mean(im, 0), mean(im, 1), mean(im, 2)) - Math.min(mean(im, 0), mean(im, 1), mean(im, 2));
  const before = spread(img);
  const params = autoColor(img, { clip: 0 });
  const out = applyAdjustment(cloneImage(img), { kind: "levels", params }, { scale: 1 });
  assert.ok(before > 30);
  assert.ok(spread(out) < before * 0.25, `spread ${spread(out)} vs ${before}`);
  assert.ok(params.channels.blue.gamma !== 1 || params.channels.blue.inBlack !== params.channels.red.inBlack);
  for (const c of ["red", "green", "blue"]) assert.ok(params.channels[c].gamma >= 0.5 && params.channels[c].gamma <= 2);
  const plain = autoColor(img, { clip: 0, neutralize: false });
  assert.equal(plain.channels.red.gamma, 1);
});

test("averageColor is alpha weighted and clips its rectangle", () => {
  const img = createImage(4, 2);
  for (let y = 0; y < 2; y++) {
    setPx(img, 0, y, [255, 0, 0, 255]);
    setPx(img, 1, y, [0, 0, 255, 255]);
    setPx(img, 2, y, [0, 255, 0, 0]);
    setPx(img, 3, y, [0, 255, 0, 0]);
  }
  const a = averageColor(img);
  assert.equal(a.r, 128);
  assert.equal(a.b, 128);
  assert.equal(a.g, 0, "transparent green does not count");
  assert.equal(a.a, 128);
  assert.equal(a.hex, "#800080");
  const left = averageColor(img, { x: 0, y: 0, width: 1, height: 2 });
  assert.deepEqual([left.r, left.g, left.b, left.a], [255, 0, 0, 255]);
  const clipped = averageColor(img, { x: -10, y: -10, width: 11, height: 11 });
  assert.equal(clipped.r, 255);
  assert.deepEqual(averageColor(img, { x: 2, y: 0, width: 2, height: 2 }), { r: 0, g: 0, b: 0, a: 0, hex: "#000000" });
  assert.deepEqual(averageColor(solid(3, 3, [10, 20, 30])).hex, "#0a141e");
  assert.equal(averageColor(img, { x: 50, y: 50, width: 3, height: 3 }).a, 0);
});
