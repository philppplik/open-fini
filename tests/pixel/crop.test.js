import test from "node:test";
import assert from "node:assert/strict";
import { ratioValue, parseRatio, resizeRect, applyRatio, rotatedCorners, fitRotatedInside, largestInscribed, cropMatrix, levelAngle, overlayLines, nextOverlay, trimBounds } from "../../app/src/engine/pixel/crop.js";
import { createImage } from "../../app/src/engine/pixel/image.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("ratio parsing and presets", () => {
  close(parseRatio("16:9"), 16 / 9);
  close(parseRatio("3/2"), 1.5);
  close(parseRatio("2"), 2);
  assert.equal(parseRatio("x"), null);
  assert.equal(parseRatio("0:4"), null);
  assert.equal(ratioValue("free", { w: 10, h: 5 }), null);
  close(ratioValue("original", { w: 200, h: 100 }), 2);
  close(ratioValue("custom", { w: 1, h: 1 }, "5:7"), 5 / 7);
  close(ratioValue("4:3", { w: 1, h: 1 }), 4 / 3);
});

test("resizeRect free and bounded", () => {
  const r = { x: 10, y: 10, w: 50, h: 40 };
  assert.deepEqual(resizeRect(r, "se", 100, 90, null, { w: 80, h: 80 }), { x: 10, y: 10, w: 70, h: 70 });
  assert.deepEqual(resizeRect(r, "nw", -5, 0, null, { w: 80, h: 80 }), { x: 0, y: 0, w: 60, h: 50 });
  const w = resizeRect(r, "e", 5, 20, null, null, 1);
  assert.equal(w.w, 1);
});

test("resizeRect keeps the ratio and the bounds", () => {
  const r = { x: 20, y: 20, w: 40, h: 40 };
  for (const [handle, px, py] of [["se", 90, 50], ["nw", 0, 10], ["e", 100, 40], ["s", 40, 100], ["ne", 90, 0], ["w", -30, 40]]) {
    const out = resizeRect(r, handle, px, py, 2, { w: 100, h: 100 });
    close(out.w / out.h, 2);
    assert.ok(out.x >= -1e-9 && out.y >= -1e-9 && out.x + out.w <= 100 + 1e-9 && out.y + out.h <= 100 + 1e-9, `${handle} ${JSON.stringify(out)}`);
  }
  const se = resizeRect(r, "se", 60, 60, 2, null);
  assert.equal(se.x, 20);
  assert.equal(se.y, 20);
});

test("applyRatio shrinks around the center", () => {
  const out = applyRatio({ x: 0, y: 0, w: 100, h: 100 }, 2, { w: 100, h: 100 });
  close(out.w, 100);
  close(out.h, 50);
  close(out.y, 25);
  assert.deepEqual(applyRatio({ x: 1, y: 2, w: 3, h: 4 }, null), { x: 1, y: 2, w: 3, h: 4 });
});

test("rotated crops fit inside the page", () => {
  const rect = { x: 0, y: 0, w: 200, h: 100 };
  const fit = fitRotatedInside(rect, 10, 200, 100);
  for (const [x, y] of rotatedCorners(fit, 10)) assert.ok(x >= -1e-6 && x <= 200 + 1e-6 && y >= -1e-6 && y <= 100 + 1e-6);
  assert.ok(fit.w < 200 && fit.w > 100);
  const same = fitRotatedInside({ x: 50, y: 25, w: 20, h: 10 }, 0, 200, 100);
  close(same.w, 20);
  const big = largestInscribed(300, 200, 7, 1.5);
  close(big.w / big.h, 1.5);
  for (const [x, y] of rotatedCorners(big, 7)) assert.ok(x >= -1e-6 && x <= 300 + 1e-6 && y >= -1e-6 && y <= 200 + 1e-6);
  // 0 degrees: the whole page
  const whole = largestInscribed(300, 200, 0, 1.5);
  close(whole.w, 300);
  close(whole.h, 200);
});

test("cropMatrix maps the crop center to the new page center and undoes the rotation", () => {
  const rect = { x: 40, y: 30, w: 100, h: 60 };
  const m = cropMatrix(rect, 0);
  assert.deepEqual(m.map((v) => Math.round(v * 1e9) / 1e9), [1, 0, 0, 1, -40, -30]);
  const rot = cropMatrix(rect, 30);
  const map = (x, y) => [rot[0] * x + rot[2] * y + rot[4], rot[1] * x + rot[3] * y + rot[5]];
  const [cx, cy] = map(90, 60);
  close(cx, 50);
  close(cy, 30);
  // the rotated corners land on the corners of the new page
  const [c0, c1, , c3] = rotatedCorners(rect, 30).map(([x, y]) => map(x, y));
  close(c0[0], 0); close(c0[1], 0);
  close(c1[0], 100); close(c1[1], 0);
  close(c3[0], 0); close(c3[1], 60);
});

test("levelAngle levels a tilted horizon", () => {
  close(levelAngle([0, 0], [100, 10]), (Math.atan(0.1) * 180) / Math.PI, 0.01);
  close(levelAngle([0, 0], [100, 0]), 0);
  assert.ok(Math.abs(levelAngle([0, 0], [10, 100])) < 45);
  close(levelAngle([0, 0], [-100, -10]), (Math.atan(0.1) * 180) / Math.PI, 0.01);
});

test("overlays", () => {
  assert.equal(overlayLines("thirds").length, 4);
  assert.equal(overlayLines("none").length, 0);
  let k = "thirds";
  const seen = new Set();
  for (let i = 0; i < 8; i++) { seen.add(k); k = nextOverlay(k); }
  assert.equal(seen.size, 6);
  for (const kind of seen) for (const l of overlayLines(kind)) assert.ok(l.every((v) => v >= 0 && v <= 1));
});

test("trimBounds finds the content of transparent and solid borders", () => {
  const img = createImage(10, 8);
  for (let y = 2; y < 6; y++) for (let x = 3; x < 8; x++) img.data.set([200, 10, 10, 255], (y * 10 + x) * 4);
  assert.deepEqual(trimBounds(img), { x: 3, y: 2, w: 5, h: 4 });
  assert.deepEqual(trimBounds(img, { sides: { left: false, top: false } }), { x: 0, y: 0, w: 8, h: 6 });
  assert.equal(trimBounds(createImage(4, 4)), null);
  const solid = createImage(6, 6);
  for (let i = 0; i < 36; i++) solid.data.set([255, 255, 255, 255], i * 4);
  solid.data.set([0, 0, 0, 255], (2 * 6 + 3) * 4);
  assert.deepEqual(trimBounds(solid, { mode: "topleft" }), { x: 3, y: 2, w: 1, h: 1 });
  assert.deepEqual(trimBounds(solid, { mode: "bottomright", tolerance: 5 }), { x: 3, y: 2, w: 1, h: 1 });
});

test("quadSize averages opposite edges", async () => {
  const { quadSize } = await import("../../app/src/engine/pixel/crop.js");
  assert.deepEqual(quadSize([[0, 0], [100, 0], [100, 50], [0, 50]]), { w: 100, h: 50 });
  assert.deepEqual(quadSize([[0, 0], [100, 0], [80, 50], [20, 50]]), { w: 80, h: 54 });
});
