import test from "node:test";
import assert from "node:assert/strict";
import {
  createImage, cloneImage, copyRegion, blit, fillImage, cropImage, flipImage, lerpWithMask, parseColor, toHex,
  clamp, clamp01, clampByte, lerp, smoothstep, div255, premultiplyInPlace, unpremultiplyInPlace, toPremultipliedFloat,
  fromPremultipliedFloat, isOpaque, luma8, imageFromData, clipRect, unionRect,
} from "../../app/src/engine/pixel/image.js";
import { Mask } from "../../app/src/engine/pixel/selection.js";
import { solid, noise, px, setPx, maxDiff } from "./_util.js";

test("createImage / cloneImage allocate independent RGBA buffers", () => {
  const a = createImage(3, 2);
  assert.equal(a.width, 3);
  assert.equal(a.height, 2);
  assert.equal(a.data.length, 24);
  assert.ok(a.data instanceof Uint8ClampedArray);
  a.data[5] = 77;
  const b = cloneImage(a);
  b.data[5] = 1;
  assert.equal(a.data[5], 77);
  assert.equal(b.width, 3);
  assert.throws(() => imageFromData(2, 2, new Uint8ClampedArray(3)));
});

test("scalar helpers", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp01(1.2), 1);
  assert.equal(clampByte(254.5), 255);
  assert.equal(clampByte(-3), 0);
  assert.equal(clampByte(NaN), 0);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, 2), 1);
  for (const [a, b] of [[0, 0], [255, 255], [255, 128], [37, 201], [255, 1]]) assert.equal(div255(a * b), Math.round((a * b) / 255));
  assert.equal(luma8(255, 255, 255), 255);
  assert.equal(luma8(0, 0, 0), 0);
});

test("parseColor / toHex round trip", () => {
  assert.deepEqual(parseColor("#ff8000"), [255, 128, 0, 255]);
  assert.deepEqual(parseColor("#f80"), [255, 136, 0, 255]);
  assert.deepEqual(parseColor("#11223344"), [17, 34, 51, 68]);
  assert.deepEqual(parseColor([1, 2, 3]), [1, 2, 3, 255]);
  assert.deepEqual(parseColor({ r: 9, g: 8, b: 7, a: 6 }), [9, 8, 7, 6]);
  assert.equal(toHex(255, 128, 0), "#ff8000");
  assert.equal(toHex(1, 2, 3, 4), "#01020304");
  assert.throws(() => parseColor("nope"));
});

test("fillImage fills every pixel", () => {
  const img = createImage(4, 4);
  fillImage(img, "#102030");
  assert.deepEqual(px(img, 3, 3), [16, 32, 48, 255]);
  fillImage(img, [0, 0, 0, 0]);
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 0]);
});

test("copyRegion clips against both images", () => {
  const src = solid(4, 4, [200, 0, 0]);
  const dst = createImage(6, 6);
  const r = copyRegion(dst, src, 0, 0, 4, 4, 4, 4); // only 2x2 fits
  assert.deepEqual(r, { x: 4, y: 4, width: 2, height: 2 });
  assert.deepEqual(px(dst, 5, 5), [200, 0, 0, 255]);
  assert.deepEqual(px(dst, 3, 3), [0, 0, 0, 0]);
  const r2 = copyRegion(dst, src, 0, 0, 2, 2, -1, -1); // negative destination clips the source part
  assert.deepEqual(r2, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(copyRegion(dst, src, 0, 0, 2, 2, 10, 10).width, 0);
});

test("blit 'over' composites with source-over and opacity", () => {
  const dst = solid(2, 2, [0, 0, 255]);
  const src = solid(2, 2, [255, 0, 0, 128]);
  blit(dst, src, 0, 0, { mode: "over" });
  const p = px(dst, 0, 0);
  assert.ok(Math.abs(p[0] - 128) <= 1 && Math.abs(p[2] - 127) <= 1, "50% blend of red over blue: " + p);
  assert.equal(p[3], 255);
  const d2 = solid(2, 2, [0, 0, 255]);
  blit(d2, solid(2, 2, [255, 0, 0]), 0, 0, { mode: "over", opacity: 0.25 });
  assert.ok(Math.abs(px(d2, 1, 1)[0] - 64) <= 1);
  const d3 = solid(3, 3, [9, 9, 9]);
  blit(d3, solid(1, 1, [1, 2, 3]), 1, 1);
  assert.deepEqual(px(d3, 1, 1), [1, 2, 3, 255]);
});

test("cropImage returns the region and pads outside areas transparent", () => {
  const img = createImage(4, 4);
  setPx(img, 2, 1, [9, 8, 7, 255]);
  const c = cropImage(img, 1, 1, 3, 2);
  assert.equal(c.width, 3);
  assert.deepEqual(px(c, 1, 0), [9, 8, 7, 255]);
  const big = cropImage(img, -1, -1, 3, 3);
  assert.deepEqual(px(big, 0, 0), [0, 0, 0, 0]);
});

test("flipImage mirrors without touching the source; flip twice is identity", () => {
  const img = noise(5, 3, 4);
  const h = flipImage(img, true, false);
  assert.deepEqual(px(h, 0, 0), px(img, 4, 0));
  assert.deepEqual(px(h, 4, 2), px(img, 0, 2));
  const v = flipImage(img, false, true);
  assert.deepEqual(px(v, 2, 0), px(img, 2, 2));
  assert.equal(maxDiff(flipImage(flipImage(img, "both"), { horizontal: true, vertical: true }), img), 0);
  assert.equal(maxDiff(flipImage(img, false, false), img), 0);
});

test("premultiply helpers", () => {
  const img = createImage(1, 2);
  setPx(img, 0, 0, [200, 100, 50, 128]);
  setPx(img, 0, 1, [200, 100, 50, 255]);
  const f = toPremultipliedFloat(img);
  assert.ok(Math.abs(f[0] - (200 * 128) / 255) < 1e-3);
  assert.equal(f[3], 128);
  assert.equal(f[4], 200);
  const back = createImage(1, 2);
  fromPremultipliedFloat(f, back);
  assert.deepEqual(px(back, 0, 0), [200, 100, 50, 128]);
  const p = cloneImage(img);
  premultiplyInPlace(p);
  assert.equal(px(p, 0, 0)[0], 100);
  unpremultiplyInPlace(p);
  assert.ok(Math.abs(px(p, 0, 0)[0] - 200) <= 2);
  assert.equal(isOpaque(img), false);
  assert.equal(isOpaque(solid(2, 2, [1, 2, 3])), true);
});

test("lerpWithMask blends through the mask and amount", () => {
  const orig = solid(4, 1, [0, 0, 0]);
  const proc = solid(4, 1, [200, 100, 50]);
  const mask = new Mask(4, 1);
  mask.data.set([0, 255, 128, 64]);
  const out = lerpWithMask(orig, cloneImage(proc), mask, 1);
  assert.deepEqual(px(out, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(out, 1, 0), [200, 100, 50, 255]);
  assert.ok(Math.abs(px(out, 2, 0)[0] - 100) <= 1);
  assert.ok(Math.abs(px(out, 3, 0)[0] - 50) <= 1);
  const half = lerpWithMask(orig, cloneImage(proc), mask, 0.5);
  assert.ok(Math.abs(px(half, 1, 0)[0] - 100) <= 1);
  assert.deepEqual(px(half, 0, 0), [0, 0, 0, 255]);
  // no mask: global amount
  const g = lerpWithMask(orig, cloneImage(proc), null, 0.25);
  assert.ok(Math.abs(px(g, 2, 0)[0] - 50) <= 1);
  // amount 0 returns the original
  assert.equal(maxDiff(lerpWithMask(orig, cloneImage(proc), mask, 0), orig), 0);
  // writing into a separate output leaves inputs intact
  const target = createImage(4, 1);
  lerpWithMask(orig, proc, mask, 1, target);
  assert.deepEqual(px(target, 1, 0), [200, 100, 50, 255]);
  assert.deepEqual(px(proc, 0, 0), [200, 100, 50, 255]);
  assert.throws(() => lerpWithMask(orig, solid(3, 1, [0, 0, 0]), mask));
});

test("lerpWithMask interpolates in premultiplied space when alpha differs", () => {
  const orig = solid(1, 1, [255, 0, 0, 0]); // fully transparent red
  const proc = solid(1, 1, [0, 0, 255, 255]); // opaque blue
  const out = lerpWithMask(orig, cloneImage(proc), null, 0.5);
  // 50 % mix: alpha 127.5, color must stay pure blue (no red leaking from the transparent pixel)
  const p = px(out, 0, 0);
  assert.equal(p[0], 0);
  assert.equal(p[2], 255);
  assert.ok(Math.abs(p[3] - 128) <= 1);
});

test("rect helpers", () => {
  assert.deepEqual(clipRect({ x: -5, y: -5, width: 10, height: 10 }, 20, 20), { x: 0, y: 0, width: 5, height: 5 });
  assert.equal(clipRect({ x: 30, y: 0, width: 5, height: 5 }, 20, 20).width, 0);
  assert.deepEqual(unionRect({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 5, width: 1, height: 1 }), { x: 0, y: 0, width: 6, height: 6 });
  assert.deepEqual(unionRect({ x: 0, y: 0, width: 0, height: 0 }, { x: 1, y: 1, width: 2, height: 2 }), { x: 1, y: 1, width: 2, height: 2 });
});
