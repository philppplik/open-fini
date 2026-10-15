import test from "node:test";
import assert from "node:assert/strict";
import {
  makeBrushFalloff, brushSize, cloneDab, smudgeDab, createSmudgeState, blurDab, sharpenDab, dodgeBurnDab, spongeDab, healPatch,
  spotHeal, inpaintMask, removeRedEye,
} from "../../app/src/engine/pixel/retouch.js";
import { Mask } from "../../app/src/engine/pixel/selection.js";
import { createImage, cloneImage } from "../../app/src/engine/pixel/image.js";
import { solid, noise, px, setPx, maxDiff, near, rng } from "./_util.js";

function chroma(p) {
  return Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
}

test("makeBrushFalloff: size, hardness and monotone falloff", () => {
  const hard = makeBrushFalloff(20, 1);
  assert.equal(hard.length, 400);
  assert.equal(brushSize(hard), 20);
  assert.equal(hard[10 * 20 + 10], 1);
  assert.equal(hard[0], 0);
  let area = 0;
  for (const v of hard) area += v;
  near(area, Math.PI * 100, 8);
  const soft = makeBrushFalloff(40, 0);
  assert.equal(soft[20 * 40 + 20] > 0.95, true);
  for (let x = 20; x < 39; x++) assert.ok(soft[20 * 40 + x + 1] <= soft[20 * 40 + x] + 1e-6, "monotone at " + x);
  assert.ok(soft[20 * 40 + 39] < 0.02, "reaches 0 at the rim");
  const mid = makeBrushFalloff(40, 0.5);
  assert.equal(mid[20 * 40 + 22], 1, "inside the hard core");
  assert.ok(mid[20 * 40 + 36] < 1 && mid[20 * 40 + 36] > 0);
  assert.equal(makeBrushFalloff(1, 1).length, 1);
});

test("cloneDab copies the source area weighted by falloff and opacity", () => {
  const img = solid(60, 30, [10, 10, 10]);
  for (let y = 0; y < 30; y++) for (let x = 40; x < 60; x++) setPx(img, x, y, [200, 100, 50]);
  const fo = makeBrushFalloff(10, 1);
  const rect = cloneDab(img, img, 50, 15, 15, 15, fo, 10, 1);
  assert.deepEqual(rect, { x: 10, y: 10, width: 10, height: 10 });
  assert.deepEqual(px(img, 15, 15), [200, 100, 50, 255]);
  assert.deepEqual(px(img, 30, 15), [10, 10, 10, 255], "outside the dab untouched");
  assert.deepEqual(px(img, 10, 10), [10, 10, 10, 255], "corner of the brush square has zero falloff");
  const half = solid(60, 30, [0, 0, 0]);
  const src = solid(60, 30, [200, 200, 200]);
  cloneDab(half, src, 30, 15, 30, 15, fo, 10, 0.5);
  assert.ok(Math.abs(px(half, 30, 15)[0] - 100) <= 1);
  // a source area outside the image is skipped, not blended as transparent
  const edge = solid(20, 20, [50, 50, 50]);
  cloneDab(edge, edge, -30, 10, 10, 10, fo, 10, 1);
  assert.deepEqual(px(edge, 10, 10), [50, 50, 50, 255]);
  assert.equal(cloneDab(edge, edge, 5, 5, 100, 100, fo, 10, 1).width, 0);
});

test("smudgeDab drags color along the stroke", () => {
  const img = solid(80, 20, [0, 0, 255]);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setPx(img, x, y, [255, 0, 0]);
  const fo = makeBrushFalloff(12, 1);
  const st = createSmudgeState();
  const first = smudgeDab(img, 14, 10, fo, 12, 0.9, st);
  assert.equal(first.width, 0, "first dab only picks up color");
  for (let x = 16; x <= 40; x += 2) smudgeDab(img, x, 10, fo, 12, 0.9, st);
  const trail = px(img, 30, 10);
  assert.ok(trail[0] > 80, "red dragged into the blue area: " + trail);
  assert.deepEqual(px(img, 70, 10), [0, 0, 255, 255], "far area untouched");
  assert.deepEqual(px(img, 30, 2), [0, 0, 255, 255], "outside the brush rows untouched");
});

test("blurDab / sharpenDab affect only the dab", () => {
  const img = noise(60, 60, 2);
  const before = cloneImage(img);
  const fo = makeBrushFalloff(24, 1);
  const rect = blurDab(img, 30, 30, fo, 24, 1);
  assert.deepEqual(rect, { x: 18, y: 18, width: 24, height: 24 });
  let a = 0, b = 0;
  for (let y = 22; y < 38; y++) for (let x = 23; x < 37; x++) {
    a += Math.abs(img.data[(y * 60 + x) * 4] - img.data[(y * 60 + x + 1) * 4]);
    b += Math.abs(before.data[(y * 60 + x) * 4] - before.data[(y * 60 + x + 1) * 4]);
  }
  assert.ok(a < b * 0.5, "blurred: " + a + " vs " + b);
  assert.deepEqual(px(img, 3, 3), px(before, 3, 3));
  // blur next to the border does not fade alpha
  const edge = solid(20, 20, [100, 100, 100]);
  blurDab(edge, 2, 2, makeBrushFalloff(12, 1), 12, 1);
  assert.equal(px(edge, 0, 0)[3], 255);
  // sharpen increases contrast over a soft edge
  const soft = solid(40, 10, [100, 100, 100]);
  for (let y = 0; y < 10; y++) for (let x = 20; x < 40; x++) setPx(soft, x, y, [140, 140, 140]);
  const ref = cloneImage(soft);
  sharpenDab(soft, 20, 5, makeBrushFalloff(16, 1), 16, 1);
  assert.ok(px(soft, 20, 5)[0] > 140, "overshoot on the bright side: " + px(soft, 20, 5)[0]);
  assert.ok(px(soft, 19, 5)[0] < 100, "undershoot on the dark side: " + px(soft, 19, 5)[0]);
  assert.deepEqual(px(soft, 2, 5), px(ref, 2, 5));
});

test("dodge / burn respect mode and tonal range", () => {
  const fo = makeBrushFalloff(10, 1);
  const mk = (v) => solid(20, 20, [v, v, v]);
  const dodge = mk(100);
  dodgeBurnDab(dodge, 10, 10, fo, 10, { mode: "dodge", range: "midtones", exposure: 1 });
  assert.ok(px(dodge, 10, 10)[0] > 110);
  const burn = mk(100);
  dodgeBurnDab(burn, 10, 10, fo, 10, { mode: "burn", range: "midtones", exposure: 1 });
  assert.ok(px(burn, 10, 10)[0] < 90);
  assert.deepEqual(px(burn, 0, 0), [100, 100, 100, 255]);
  const sDark = mk(30), sBright = mk(230);
  dodgeBurnDab(sDark, 10, 10, fo, 10, { mode: "dodge", range: "shadows", exposure: 1 });
  dodgeBurnDab(sBright, 10, 10, fo, 10, { mode: "dodge", range: "shadows", exposure: 1 });
  assert.ok(px(sDark, 10, 10)[0] - 30 > px(sBright, 10, 10)[0] - 230 + 10, "shadows range prefers dark pixels");
  const hl = mk(230);
  dodgeBurnDab(hl, 10, 10, fo, 10, { mode: "burn", range: "highlights", exposure: 1 });
  assert.ok(px(hl, 10, 10)[0] < 200);
  const zero = mk(100);
  dodgeBurnDab(zero, 10, 10, fo, 10, { exposure: 0 });
  assert.equal(px(zero, 10, 10)[0], 100);
});

test("sponge saturates or desaturates", () => {
  const fo = makeBrushFalloff(10, 1);
  const base = [180, 120, 100];
  const sat = solid(20, 20, base);
  spongeDab(sat, 10, 10, fo, 10, { mode: "saturate", flow: 1 });
  const des = solid(20, 20, base);
  spongeDab(des, 10, 10, fo, 10, { mode: "desaturate", flow: 1 });
  assert.ok(chroma(px(sat, 10, 10)) > chroma(base));
  assert.ok(chroma(px(des, 10, 10)) < chroma(base));
  assert.deepEqual(px(des, 0, 0).slice(0, 3), base);
  const gray = solid(20, 20, [90, 90, 90]);
  spongeDab(gray, 10, 10, fo, 10, { mode: "saturate", flow: 1 });
  assert.deepEqual(px(gray, 10, 10).slice(0, 3), [90, 90, 90]);
});

test("healPatch matches the destination tone while keeping the source texture", () => {
  const w = 100, h = 40;
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x < 50 ? 100 : 160 + ((x + y) % 2 ? 12 : -12);
    setPx(img, x, y, [v, v, v]);
  }
  const fo = makeBrushFalloff(20, 1);
  const cloned = cloneImage(img);
  cloneDab(cloned, img, 75, 20, 25, 20, fo, 20, 1);
  const healed = cloneImage(img);
  healPatch(healed, img, 75, 20, 25, 20, fo, 20, 1);
  const avg = (im) => {
    let s = 0, n = 0;
    for (let y = 15; y < 25; y++) for (let x = 20; x < 30; x++) { s += px(im, x, y)[0]; n++; }
    return s / n;
  };
  near(avg(cloned), 160, 3);
  near(avg(healed), 100, 6, "healed tone follows the surroundings");
  // texture survives
  let lo = 255, hi = 0;
  for (let y = 15; y < 25; y++) for (let x = 20; x < 30; x++) { lo = Math.min(lo, px(healed, x, y)[0]); hi = Math.max(hi, px(healed, x, y)[0]); }
  assert.ok(hi - lo >= 18, "texture amplitude " + (hi - lo));
  assert.deepEqual(px(healed, 70, 20), px(img, 70, 20), "source untouched");
});

test("spotHeal removes a blemish using nearby texture", () => {
  const w = 80, h = 80;
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 120 + x * 0.5 + y * 0.25;
    setPx(img, x, y, [v, v * 0.9, v * 0.8]);
  }
  const clean = cloneImage(img);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 40, y - 40) < 4) setPx(img, x, y, [20, 20, 20]);
  const rect = spotHeal(img, 40, 40, 6);
  assert.ok(rect.width > 0 && rect.x <= 36 && rect.x + rect.width >= 44);
  let worst = 0;
  for (let y = 36; y <= 44; y++) for (let x = 36; x <= 44; x++) if (Math.hypot(x - 40, y - 40) < 4) worst = Math.max(worst, Math.abs(px(img, x, y)[0] - px(clean, x, y)[0]));
  assert.ok(worst < 12, "blemish removed, worst deviation " + worst);
  assert.deepEqual(px(img, 5, 5), px(clean, 5, 5));
});

test("inpaintMask: diffusion reproduces smooth gradients, patch synthesis continues stripes", () => {
  const grad = createImage(64, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) setPx(grad, x, y, [x * 4, 100, 255 - x * 4]);
  const gClean = cloneImage(grad);
  const hole = Mask.rect(64, 32, 24, 10, 12, 12);
  for (let y = 10; y < 22; y++) for (let x = 24; x < 36; x++) setPx(grad, x, y, [255, 0, 255]);
  const rect = inpaintMask(grad, hole, { method: "diffuse", texture: false });
  assert.ok(rect.width >= 12 && rect.height >= 12);
  let worst = 0;
  for (let y = 10; y < 22; y++) for (let x = 24; x < 36; x++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(px(grad, x, y)[c] - px(gClean, x, y)[c]));
  assert.ok(worst <= 14, "diffusion error " + worst);
  assert.deepEqual(px(grad, 2, 2), px(gClean, 2, 2));

  const stripes = createImage(64, 48);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) { const v = ((x >> 2) & 1) ? 210 : 50; setPx(stripes, x, y, [v, v, v]); }
  const sClean = cloneImage(stripes);
  const h2 = Mask.rect(64, 48, 26, 18, 10, 10);
  for (let y = 18; y < 28; y++) for (let x = 26; x < 36; x++) setPx(stripes, x, y, [255, 0, 0]);
  inpaintMask(stripes, h2, { method: "patch", seed: 3 });
  let good = 0;
  for (let y = 18; y < 28; y++) for (let x = 26; x < 36; x++) if (Math.abs(px(stripes, x, y)[0] - px(sClean, x, y)[0]) < 40 && px(stripes, x, y)[1] === px(stripes, x, y)[0]) good++;
  assert.ok(good >= 85, "patch fill matches the stripes at " + good + " of 100 pixels");
  // auto picks a method and never leaves the marker color behind
  const t = noise(40, 40, 3);
  const hm = Mask.rect(40, 40, 15, 15, 8, 8);
  for (let y = 15; y < 23; y++) for (let x = 15; x < 23; x++) setPx(t, x, y, [255, 0, 255]);
  inpaintMask(t, hm);
  let marker = 0;
  for (let y = 15; y < 23; y++) for (let x = 15; x < 23; x++) if (px(t, x, y)[0] === 255 && px(t, x, y)[1] === 0 && px(t, x, y)[2] === 255) marker++;
  assert.ok(marker < 3);
  assert.equal(inpaintMask(t, Mask.empty(40, 40)).width, 0);
  assert.throws(() => inpaintMask(t, Mask.empty(3, 3)));
});

test("removeRedEye neutralizes red pupils only", () => {
  const img = solid(40, 40, [200, 160, 140]);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (Math.hypot(x - 20, y - 20) < 5) setPx(img, x, y, [230, 40, 40]);
  const skin = px(img, 2, 2);
  const rect = removeRedEye(img, { x: 10, y: 10, width: 20, height: 20 }, { threshold: 50 });
  assert.ok(rect.width >= 9 && rect.width <= 11, "bounds " + JSON.stringify(rect));
  const p = px(img, 20, 20);
  assert.ok(p[0] < 120, "pupil no longer red: " + p);
  assert.ok(p[0] - Math.max(p[1], p[2]) < 40);
  assert.deepEqual(px(img, 2, 2), skin);
  assert.deepEqual(px(img, 12, 12), [200, 160, 140, 255], "skin inside the rect is unchanged");
  const none = solid(10, 10, [200, 160, 140]);
  assert.equal(removeRedEye(none, { x: 0, y: 0, width: 10, height: 10 }).width, 0);
  const strict = solid(10, 10, [230, 40, 40]);
  assert.equal(removeRedEye(strict, { x: 0, y: 0, width: 10, height: 10 }, { threshold: 250 }).width, 0);
  assert.equal(maxDiff(none, solid(10, 10, [200, 160, 140])), 0);
});
