import test from "node:test";
import assert from "node:assert/strict";
import {
  boxForVariance, boxBlurPlane, gaussianBlurPlane, gaussianBlurImage, boxBlurImage, guidedFilterSelf, guidedFilter, transposePlane, lumaPlane,
} from "../../app/src/engine/pixel/blur.js";
import { createImage } from "../../app/src/engine/pixel/image.js";
import { solid, noise, px, setPx, rng, near, mean } from "./_util.js";

function impulse(w, h, x, y, v = 1000) {
  const p = new Float32Array(w * h);
  p[y * w + x] = v;
  return p;
}

function stdOf(p, w, h, cx, cy) {
  let sum = 0, vx = 0, vy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = p[y * w + x];
    sum += v;
    vx += v * (x - cx) * (x - cx);
    vy += v * (y - cy) * (y - cy);
  }
  return { sum, sx: Math.sqrt(vx / sum), sy: Math.sqrt(vy / sum) };
}

test("boxForVariance matches the requested variance exactly", () => {
  for (const v of [0.01, 0.2, 0.5, 1, 2.7, 10, 33.3, 120]) {
    const { k, f } = boxForVariance(v);
    // variance of taps: weight 1 on -k..k, weight f at +-(k+1)
    let wsum = 0, m2 = 0;
    for (let i = -k; i <= k; i++) { wsum += 1; m2 += i * i; }
    wsum += 2 * f;
    m2 += 2 * f * (k + 1) * (k + 1);
    near(m2 / wsum, v, 1e-9, "variance for " + v);
    assert.ok(f >= 0 && f <= 1);
  }
  assert.deepEqual(boxForVariance(0), { k: 0, f: 0 });
});

test("gaussian blur of an impulse: mass is kept and the spread equals sigma (fractional sigma included)", () => {
  const w = 161, h = 161;
  const stds = [];
  for (const sigma of [0.6, 1, 2.4, 2.5, 2.6, 5.25, 11.3]) {
    const p = impulse(w, h, 80, 80);
    gaussianBlurPlane(p, new Float32Array(w * h), w, h, sigma, sigma);
    const s = stdOf(p, w, h, 80, 80);
    near(s.sum, 1000, 0.01, "mass at sigma " + sigma);
    near(s.sx, sigma, 0.01, "sx at sigma " + sigma);
    near(s.sy, sigma, 0.01, "sy at sigma " + sigma);
    stds.push(s.sx);
  }
  assert.ok(stds[2] < stds[3] && stds[3] < stds[4], "fractional radii change the blur smoothly");
  // anisotropic
  const p = impulse(w, h, 80, 80);
  gaussianBlurPlane(p, new Float32Array(w * h), w, h, 6, 2);
  const s = stdOf(p, w, h, 80, 80);
  near(s.sx, 6, 0.02);
  near(s.sy, 2, 0.02);
});

test("blurring a constant plane leaves it constant (edges replicate)", () => {
  const w = 37, h = 23;
  const p = new Float32Array(w * h).fill(123.5);
  gaussianBlurPlane(p, new Float32Array(w * h), w, h, 9, 4);
  for (let i = 0; i < p.length; i++) near(p[i], 123.5, 1e-3);
  const q = new Float32Array(w * h).fill(7);
  boxBlurPlane(q, new Float32Array(w * h), w, h, 3.5, 100, 2);
  for (let i = 0; i < q.length; i++) near(q[i], 7, 1e-3);
});

test("box blur plane: exact values with whole and fractional radius", () => {
  const w = 9, h = 1;
  const p = new Float32Array(w);
  p[4] = 255;
  boxBlurPlane(p, new Float32Array(w), w, h, 1, 0);
  assert.deepEqual(Array.from(p).map((v) => Math.round(v)), [0, 0, 0, 85, 85, 85, 0, 0, 0]);
  const q = new Float32Array(w);
  q[4] = 255;
  boxBlurPlane(q, new Float32Array(w), w, h, 1.5, 0);
  assert.deepEqual(Array.from(q).map((v) => +v.toFixed(2)), [0, 0, 31.88, 63.75, 63.75, 63.75, 31.88, 0, 0]);
  // vertical
  const v = new Float32Array(9);
  v[4] = 255;
  boxBlurPlane(v, new Float32Array(9), 1, 9, 0, 1);
  assert.deepEqual(Array.from(v).map((x) => Math.round(x)), [0, 0, 0, 85, 85, 85, 0, 0, 0]);
});

test("replicated edges keep a blurred ramp inside its range", () => {
  const w = 50;
  const p = new Float32Array(w);
  for (let i = 0; i < w; i++) p[i] = i * 5;
  gaussianBlurPlane(p, new Float32Array(w), w, 1, 4, 0);
  assert.ok(p[0] >= 0 && p[w - 1] <= 245);
  for (let i = 1; i < w; i++) assert.ok(p[i] >= p[i - 1] - 1e-4, "monotone");
});

test("RGBA blur is premultiplied: no dark fringe around an opaque shape on a transparent background", () => {
  const img = createImage(40, 40);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) setPx(img, x, y, [255, 255, 255, 255]);
  // transparent pixels carry black color information that must not leak
  gaussianBlurImage(img, 3);
  const edge = px(img, 9, 20);
  assert.ok(edge[3] > 20 && edge[3] < 200, "partially transparent edge alpha " + edge[3]);
  assert.ok(edge[0] >= 253 && edge[1] >= 253 && edge[2] >= 253, "edge stays white: " + edge);
  const far = px(img, 2, 2);
  assert.equal(far[3] <= 2, true);
  // alpha mass is preserved
  let sum = 0;
  for (let i = 0; i < 1600; i++) sum += img.data[i * 4 + 3];
  near(sum / 255, 400, 3);
  const c = solid(8, 8, [200, 100, 50, 100]);
  gaussianBlurImage(c, 2);
  assert.deepEqual(px(c, 3, 3), [200, 100, 50, 100]);
});

test("opaque blur: mean is preserved and output differs from input", () => {
  const img = noise(64, 64, 9);
  const before = [mean(img, 0), mean(img, 1), mean(img, 2)];
  const out = gaussianBlurImage(img, 3, 3, createImage(64, 64));
  for (let c = 0; c < 3; c++) near(mean(out, c), before[c], 1.5);
  assert.equal(mean(out, 3), 255);
  // noise variance drops a lot
  const v = (im) => {
    const m = mean(im, 0);
    let s = 0;
    for (let i = 0; i < 64 * 64; i++) s += (im.data[i * 4] - m) ** 2;
    return s / (64 * 64);
  };
  assert.ok(v(out) < v(img) * 0.1);
  const same = gaussianBlurImage(noise(8, 8, 1), 0);
  assert.equal(px(same, 0, 0)[0], px(noise(8, 8, 1), 0, 0)[0]);
});

test("boxBlurImage / gaussianBlurImage write to a separate destination when asked", () => {
  const src = noise(16, 16, 5);
  const copy = new Uint8ClampedArray(src.data);
  const dst = createImage(16, 16);
  boxBlurImage(src, 2, 2, 1, dst);
  assert.deepEqual(Array.from(src.data), Array.from(copy));
  assert.notDeepEqual(Array.from(dst.data), Array.from(copy));
});

test("guided filter smooths noise but keeps a strong edge", () => {
  const w = 64, h = 32;
  const r = rng(3);
  const I = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) I[y * w + x] = (x < 32 ? 50 : 200) + (r() - 0.5) * 12;
  const out = new Float32Array(w * h);
  guidedFilterSelf(I, w, h, 3, 40 * 40 / 4, out, new Float32Array(w * h));
  const sd = (p, x0, x1) => {
    let m = 0, c = 0;
    for (let y = 4; y < h - 4; y++) for (let x = x0; x < x1; x++) { m += p[y * w + x]; c++; }
    m /= c;
    let s = 0;
    for (let y = 4; y < h - 4; y++) for (let x = x0; x < x1; x++) s += (p[y * w + x] - m) ** 2;
    return Math.sqrt(s / c);
  };
  assert.ok(sd(out, 6, 26) < sd(I, 6, 26) * 0.5, "flat area smoothed");
  const row = 16 * w;
  assert.ok(out[row + 33] - out[row + 30] > 120, "edge kept: " + (out[row + 33] - out[row + 30]));
  // cross guided version runs and returns finite numbers
  const P = new Float32Array(w * h).fill(10);
  const o2 = guidedFilter(I, P, w, h, 2, 100, new Float32Array(w * h), new Float32Array(w * h));
  assert.ok(Number.isFinite(o2[100]));
  near(o2[100], 10, 1e-2);
});

test("transposePlane and lumaPlane", () => {
  const w = 70, h = 45;
  const src = new Float32Array(w * h).map((_, i) => i);
  const dst = new Float32Array(w * h);
  transposePlane(src, dst, w, h);
  for (const [x, y] of [[0, 0], [69, 44], [10, 33], [64, 1]]) assert.equal(dst[x * h + y], src[y * w + x]);
  const img = createImage(3, 1);
  setPx(img, 0, 0, [100, 100, 100, 255]);
  setPx(img, 1, 0, [0, 0, 0, 0]);
  setPx(img, 2, 0, [200, 200, 200, 255]);
  const L = lumaPlane(img, new Float32Array(3));
  near(L[0], 100, 0.01);
  assert.equal(L[1], 100); // transparent pixel borrows its left neighbor
  near(L[2], 200, 0.01);
});
