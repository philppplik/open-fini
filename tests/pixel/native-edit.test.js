import test from "node:test";
import assert from "node:assert/strict";
import { backgroundMask, subjectMask, removeBackground, autoWhiteBalance, colorReplace, applyEdit, NATIVE_EDITS } from "../../app/src/engine/pixel/native-edit.js";
import { createImage } from "../../app/src/engine/pixel/image.js";
import * as fx from "../../app/src/engine/pixel/native-edit-fx.js";

/** w x h image with a `bg` background and a `fg` disc of radius r in the center. */
function disc(w, h, r, bg, fg) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = Math.hypot(x - w / 2 + 0.5, y - h / 2 + 0.5) < r ? fg : bg;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  return img;
}
const at = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test("background mask grows from the border and stops at the subject", () => {
  const img = disc(40, 30, 9, [240, 240, 235], [30, 90, 200]);
  const bg = backgroundMask(img, { feather: 0 });
  assert.equal(bg[0], 255);
  assert.equal(bg[15 * 40 + 20], 0);
  const fg = subjectMask(img, { feather: 0 });
  assert.equal(fg[15 * 40 + 20], 255);
  assert.equal(fg[0], 0);
});

test("background of similar color inside the subject is kept when it is not connected to the border", () => {
  const img = disc(40, 40, 12, [250, 250, 250], [200, 30, 30]);
  // a white "eye" inside the subject
  for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) img.data.set([250, 250, 250, 255], (y * 40 + x) * 4);
  const fg = subjectMask(img, { feather: 0 });
  assert.equal(fg[20 * 40 + 20], 255);
});

test("remove background makes the border transparent with a feathered edge", () => {
  const img = disc(40, 30, 9, [240, 240, 235], [30, 90, 200]);
  removeBackground(img, { feather: 1.5 });
  assert.equal(at(img, 0, 0)[3], 0);
  assert.equal(at(img, 20, 15)[3], 255);
  const alphas = new Set();
  for (let x = 0; x < 40; x++) alphas.add(at(img, x, 15)[3]);
  assert.ok([...alphas].some((a) => a > 0 && a < 255), "feathered edge has partial alpha");
});

test("auto white balance neutralizes a color cast", () => {
  const img = disc(20, 20, 5, [180, 150, 120], [120, 100, 80]);
  autoWhiteBalance(img);
  const [r, g, b] = at(img, 0, 0);
  assert.ok(Math.abs(r - b) < 6 && Math.abs(r - g) < 6, `${r},${g},${b}`);
});

test("color replace takes the new color and keeps the shading", () => {
  const img = disc(20, 20, 6, [255, 255, 255], [200, 0, 0]);
  img.data.set([120, 0, 0, 255], 0); // a darker red in the corner
  const n = colorReplace(img, "#c80000", "#00a000", 200);
  assert.ok(n > 0);
  const [r, g] = at(img, 10, 10);
  assert.ok(g > 80 && r < 30, `${r},${g}`);
  const [r2, g2] = at(img, 0, 0);
  assert.ok(g2 > r2 && g2 < g, "darker pixel stays darker");
  assert.deepEqual(at(img, 1, 19), [255, 255, 255, 255]);
});

test("applyEdit runs every listed edit and upscale enlarges", () => {
  for (const name of Object.keys(NATIVE_EDITS)) {
    const img = disc(24, 16, 5, [200, 180, 160], [40, 60, 90]);
    const out = applyEdit(name, img, {}, fx);
    assert.ok(out.width >= 24 && out.data.length === out.width * out.height * 4, name);
  }
  const up = applyEdit("upscale", disc(10, 8, 3, [0, 0, 0], [255, 255, 255]), { factor: 3 }, fx);
  assert.equal(up.width, 30);
  assert.equal(up.height, 24);
  assert.throws(() => applyEdit("nope", createImage(2, 2)));
});

test("auto contrast stretches a flat image", () => {
  const img = disc(20, 20, 6, [100, 100, 100], [150, 150, 150]);
  applyEdit("auto_contrast", img, { clip: 0 }, fx);
  assert.equal(at(img, 0, 0)[0], 0);
  assert.equal(at(img, 10, 10)[0], 255);
});
