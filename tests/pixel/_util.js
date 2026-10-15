// Shared helpers for the pixel engine tests (not a test file itself).

import assert from "node:assert/strict";
import { createImage } from "../../app/src/engine/pixel/image.js";

/** Deterministic PRNG in [0, 1). */
export function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Image filled with one RGBA color. */
export function solid(w, h, [r, g, b, a = 255]) {
  const img = createImage(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  }
  return img;
}

/** Opaque random-noise image. */
export function noise(w, h, seed = 1, opaque = true) {
  const rnd = rng(seed);
  const img = createImage(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (rnd() * 256) | 0;
    d[i + 1] = (rnd() * 256) | 0;
    d[i + 2] = (rnd() * 256) | 0;
    d[i + 3] = opaque ? 255 : (rnd() * 256) | 0;
  }
  return img;
}

/** Horizontal gray ramp 0..255 across the width. */
export function ramp(w, h) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / Math.max(1, w - 1)) * 255);
      const j = (y * w + x) * 4;
      img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
      img.data[j + 3] = 255;
    }
  }
  return img;
}

/** Colorful smooth test scene (opaque). */
export function scene(w, h) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const cx = x - w / 2;
      const cy = y - h / 2;
      img.data[j] = 128 + 100 * Math.sin(x / 7);
      img.data[j + 1] = 128 + 100 * Math.cos(y / 9);
      img.data[j + 2] = cx * cx + cy * cy < (h / 3) * (h / 3) ? 230 : 60;
      img.data[j + 3] = 255;
    }
  }
  return img;
}

/** Largest absolute per-byte difference of two images. */
export function maxDiff(a, b) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let m = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > m) m = d;
  }
  return m;
}

/** Mean of one channel (0 = r, 1 = g, 2 = b, 3 = a). */
export function mean(img, c) {
  let s = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) s += img.data[i * 4 + c];
  return s / n;
}

/** Reads pixel (x, y) as [r, g, b, a]. */
export function px(img, x, y) {
  const j = (y * img.width + x) * 4;
  return [img.data[j], img.data[j + 1], img.data[j + 2], img.data[j + 3]];
}

/** Sets pixel (x, y). */
export function setPx(img, x, y, [r, g, b, a = 255]) {
  const j = (y * img.width + x) * 4;
  img.data[j] = r;
  img.data[j + 1] = g;
  img.data[j + 2] = b;
  img.data[j + 3] = a;
}

/** Sum of mask coverage / 255 (area in pixels). */
export function maskArea(m) {
  let s = 0;
  for (let i = 0; i < m.data.length; i++) s += m.data[i];
  return s / 255;
}

/** Signed shoelace area of a flat polyline (x0,y0,x1,y1,...). */
export function ringArea(p) {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}

/** Asserts |a - b| <= tol. */
export function near(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, (msg ? msg + ": " : "") + `expected ${a} to be within ${tol} of ${b}`);
}
