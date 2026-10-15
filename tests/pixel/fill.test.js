import test from "node:test";
import assert from "node:assert/strict";
import { floodFill, fillMask } from "../../app/src/engine/pixel/fill.js";
import { Mask } from "../../app/src/engine/pixel/selection.js";
import { createImage, cloneImage } from "../../app/src/engine/pixel/image.js";
import { solid, px, setPx, maxDiff } from "./_util.js";

function countColor(img, [r, g, b]) {
  let n = 0;
  for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4] === r && img.data[i * 4 + 1] === g && img.data[i * 4 + 2] === b) n++;
  return n;
}

test("floodFill fills the contiguous region and returns its bounds", () => {
  const img = solid(20, 10, [255, 255, 255]);
  for (let y = 0; y < 10; y++) setPx(img, 10, y, [0, 0, 0]); // wall
  const rect = floodFill(img, 2, 3, "#ff0000", { tolerance: 0, antialias: false });
  assert.deepEqual(rect, { x: 0, y: 0, width: 10, height: 10 });
  assert.equal(countColor(img, [255, 0, 0]), 100);
  assert.deepEqual(px(img, 15, 5), [255, 255, 255, 255], "other side untouched");
  assert.deepEqual(px(img, 10, 5), [0, 0, 0, 255], "wall untouched");
  // seed outside the image or fully transparent color does nothing
  assert.equal(floodFill(img, 99, 99, "#00ff00").width, 0);
  assert.equal(floodFill(img, 15, 5, "#00ff0000", { antialias: false }).width, 0);
});

test("floodFill tolerance grows the filled area monotonically", () => {
  const img = createImage(32, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 32; x++) setPx(img, x, y, [x * 4, x * 4, x * 4]); // gradient 0..124
  let prev = -1;
  for (const tol of [0, 3, 8, 20, 60, 255]) {
    const copy = cloneImage(img);
    const rect = floodFill(copy, 0, 1, "#ff00ff", { tolerance: tol, antialias: false });
    const filled = countColor(copy, [255, 0, 255]);
    assert.ok(filled >= prev, `tolerance ${tol}: ${filled} < ${prev}`);
    prev = filled;
    if (tol === 0) assert.equal(rect.width, 1);
    if (tol === 8) assert.equal(rect.width, 3, "x*4 within 8 of 0 -> columns 0..2"); // 0, 4, 8
    if (tol === 255) assert.equal(filled, 128);
  }
});

test("floodFill contiguous vs global, mask restriction, grow and opacity", () => {
  const img = solid(12, 6, [200, 200, 200]);
  for (let y = 0; y < 6; y++) setPx(img, 6, y, [10, 10, 10]);
  const a = cloneImage(img);
  floodFill(a, 1, 1, "#0000ff", { tolerance: 0, contiguous: false, antialias: false });
  assert.equal(countColor(a, [0, 0, 255]), 66, "both halves");
  const mask = Mask.rect(12, 6, 0, 0, 3, 6);
  const b = cloneImage(img);
  const r = floodFill(b, 1, 1, "#0000ff", { tolerance: 0, antialias: false, mask });
  assert.equal(countColor(b, [0, 0, 255]), 18);
  assert.equal(r.width, 3);
  const c = cloneImage(img);
  floodFill(c, 1, 1, "#0000ff", { tolerance: 0, antialias: false, grow: 1 });
  assert.equal(px(c, 6, 3)[2], 255, "grow reaches over the divider");
  const d = cloneImage(img);
  floodFill(d, 1, 1, "#000000", { tolerance: 0, antialias: false, opacity: 0.5 });
  assert.equal(px(d, 1, 1)[0], 100);
  assert.throws(() => floodFill(img, 0, 0, "#fff", { mask: Mask.empty(3, 3) }));
});

test("floodFill anti-aliasing softens the rim of the fill", () => {
  const img = solid(20, 20, [255, 255, 255]);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (Math.hypot(x - 10, y - 10) < 6) setPx(img, x, y, [0, 0, 0]);
  const hard = cloneImage(img);
  floodFill(hard, 10, 10, "#ff0000", { tolerance: 0, antialias: false });
  const soft = cloneImage(img);
  floodFill(soft, 10, 10, "#ff0000", { tolerance: 0, antialias: true });
  assert.equal(px(hard, 10, 10)[0], 255);
  assert.equal(px(hard, 10, 10)[1], 0);
  // rim pixel: hard fill is fully red, soft fill blends red into the neighboring white
  let blended = 0;
  for (let i = 0; i < 400; i++) {
    const s = soft.data[i * 4 + 1], h = hard.data[i * 4 + 1];
    if (s !== h && s > 0 && s < 255) blended++;
  }
  assert.ok(blended > 10, "blended rim pixels: " + blended);
  assert.deepEqual(px(soft, 10, 10).slice(0, 3), [255, 0, 0]);
});

test("fillMask composites with coverage and alpha", () => {
  const img = solid(4, 1, [0, 0, 0]);
  const mask = new Mask(4, 1);
  mask.data.set([0, 64, 128, 255]);
  const rect = fillMask(img, mask, "#ffffff");
  assert.deepEqual(rect, { x: 1, y: 0, width: 3, height: 1 });
  assert.equal(px(img, 0, 0)[0], 0);
  assert.ok(Math.abs(px(img, 1, 0)[0] - 64) <= 1);
  assert.ok(Math.abs(px(img, 2, 0)[0] - 128) <= 1);
  assert.equal(px(img, 3, 0)[0], 255);
  // painting onto a transparent pixel takes the paint color with the covered alpha
  const t = createImage(2, 1);
  const m2 = new Mask(2, 1);
  m2.data.set([255, 128]);
  fillMask(t, m2, "#336699");
  assert.deepEqual(px(t, 0, 0), [51, 102, 153, 255]);
  assert.deepEqual(px(t, 1, 0).slice(0, 3), [51, 102, 153]);
  assert.ok(Math.abs(px(t, 1, 0)[3] - 128) <= 1);
  // semi-transparent paint
  const s = solid(1, 1, [0, 0, 0]);
  fillMask(s, Mask.full(1, 1), "#ffffff80");
  assert.ok(Math.abs(px(s, 0, 0)[0] - 128) <= 1);
  assert.throws(() => fillMask(s, Mask.full(2, 2), "#fff"));
  assert.equal(maxDiff(s, s), 0);
});
