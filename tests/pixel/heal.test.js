import test from "node:test";
import assert from "node:assert/strict";
import { createImage } from "../../app/src/engine/pixel/image.js";
import { patchTransfer, detectHorizon, extendEdges } from "../../app/src/engine/pixel/heal.js";
import { levelAngle } from "../../app/src/engine/pixel/crop.js";
import { runJob, JOB_NAMES } from "../../app/src/core/workers/jobs.js";

const px = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const setPx = (img, x, y, [r, g, b, a = 255]) => img.data.set([r, g, b, a], (y * img.width + x) * 4);

/** A sky/sea photo stand-in: bright above a line through (0, y0) with the given tilt, dark below, plus mild noise. */
function horizonImage(w, h, y0, deg, seed = 1) {
  const img = createImage(w, h);
  const t = Math.tan((deg * Math.PI) / 180);
  let s = seed;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Math.imul: an exact 32-bit LCG. `s * 1103515245` overflows 2^53 in a double, drops low bits and falls into a
    // short cycle (about 11 000 steps), so the noise was not the sequence the seed promised.
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const n = (s % 9) - 4;
    const v = y < y0 + x * t ? 200 : 70;
    setPx(img, x, y, [v + n, v + n, v + 20 + n]);
  }
  return img;
}

test("patchTransfer heal: moves texture but adopts the surrounding light", () => {
  // left half: stripes on gray 100, right half: the same stripes on gray 180; a stain in the left half
  const img = createImage(80, 40);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) {
    const base = x < 40 ? 100 : 180;
    const v = base + ((y >> 1) & 1 ? 20 : -20);
    setPx(img, x, y, [v, v, v]);
  }
  for (let y = 15; y < 25; y++) for (let x = 12; x < 22; x++) setPx(img, x, y, [255, 0, 0]);
  const mask = new Uint8Array(80 * 40);
  for (let y = 14; y < 26; y++) for (let x = 11; x < 23; x++) mask[y * 80 + x] = 255;
  const r = patchTransfer(img, mask, 40, 0);
  assert.deepEqual(r, { x: 11, y: 14, width: 12, height: 12 });
  let worst = 0;
  for (let y = 15; y < 25; y++) for (let x = 12; x < 22; x++) {
    const want = 100 + ((y >> 1) & 1 ? 20 : -20);
    const [R, G, B] = px(img, x, y);
    worst = Math.max(worst, Math.abs(R - want), Math.abs(G - want), Math.abs(B - want));
  }
  assert.ok(worst <= 14, `stripes at the local brightness, worst ${worst}`);
  assert.deepEqual(px(img, 2, 2), [120, 120, 120, 255], "outside the mask nothing changes");
});

test("patchTransfer copy and edge cases", () => {
  const img = createImage(20, 10);
  for (let x = 0; x < 20; x++) for (let y = 0; y < 10; y++) setPx(img, x, y, [x * 10, 0, 0]);
  const mask = new Uint8Array(200);
  mask[5 * 20 + 3] = 255;
  mask[5 * 20 + 4] = 128;
  patchTransfer(img, mask, 10, 0, { mode: "copy" });
  assert.equal(px(img, 3, 5)[0], 130);
  assert.equal(px(img, 4, 5)[0], Math.round(40 + (140 - 40) * (128 / 255)));
  // source beyond the edge is clamped
  const m2 = new Uint8Array(200);
  m2[0] = 255;
  patchTransfer(img, m2, 100, 0, { mode: "copy" });
  assert.equal(px(img, 0, 0)[0], 190);
  assert.equal(patchTransfer(img, new Uint8Array(200), 3, 3).width, 0);
  assert.equal(patchTransfer(img, mask, 0, 0).width, 0);
  assert.throws(() => patchTransfer(img, new Uint8Array(3), 1, 1));
});

test("detectHorizon finds tilted horizons and agrees with the crop tool's levelAngle", () => {
  for (const deg of [-6, -2.5, 0, 3, 8]) {
    const img = horizonImage(320, 200, 90, deg);
    const r = detectHorizon(img);
    assert.ok(r, `found at ${deg}°`);
    assert.equal(r.kind, "horizon");
    assert.ok(Math.abs(r.angle - deg) <= 0.35, `angle ${r.angle} for ${deg}`);
    assert.ok(Math.abs(levelAngle(...r.line) - r.angle) < 0.05);
    const midY = (r.line[0][1] + r.line[1][1]) / 2;
    assert.ok(Math.abs(midY - (90 + 160 * Math.tan((deg * Math.PI) / 180))) < 3, `line position ${midY}`);
  }
});

test("detectHorizon searches ±30° by default (was ±20°)", () => {
  for (const deg of [-28, -24, 25, 29]) {
    const r = detectHorizon(horizonImage(640, 480, deg > 0 ? 60 : 420, deg));
    assert.ok(r && r.kind === "horizon", `found at ${deg}°`);
    assert.ok(Math.abs(r.angle - deg) <= 0.35, `angle ${r.angle} for ${deg}`);
  }
  assert.equal(detectHorizon(horizonImage(640, 480, 60, 25), { maxAngle: 20 }), null, "maxAngle still narrows the search");
});

test("detectHorizon: plumb lines, flat images and large images", () => {
  // a building edge leaning 4 degrees: bright left, dark right
  const img = createImage(200, 300);
  const t = Math.tan((4 * Math.PI) / 180);
  for (let y = 0; y < 300; y++) for (let x = 0; x < 200; x++) { const v = x < 90 + y * t ? 210 : 60; setPx(img, x, y, [v, v, v]); }
  const r = detectHorizon(img);
  assert.equal(r.kind, "vertical");
  assert.ok(Math.abs(r.angle - levelAngle(...r.line)) < 0.05);
  assert.ok(Math.abs(Math.abs(r.angle) - 4) < 0.4, `angle ${r.angle}`);
  const flat = createImage(100, 100);
  flat.data.fill(128);
  assert.equal(detectHorizon(flat), null);
  const big = horizonImage(1600, 900, 400, 2);
  const rb = detectHorizon(big);
  assert.ok(Math.abs(rb.angle - 2) < 0.4, `downscaled analysis ${rb.angle}`);
  assert.ok(Math.abs(rb.line[1][0] - 1600) < 1e-9, "line in full-size pixels");
});

test("extendEdges fills only outside the source, clamping its edge pixels", () => {
  const src = createImage(10, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setPx(src, x, y, [x * 20, y * 20, 7]);
  // output 20 x 20, source placed at (5, 5)
  const out = extendEdges(src, [1, 0, 0, 1, -5, -5], 20, 20);
  assert.equal(out.width, 20);
  assert.equal(px(out, 10, 10)[3], 0, "inside stays transparent");
  assert.deepEqual(px(out, 0, 10), [0, 100, 7, 255], "left of the source: its left column");
  assert.deepEqual(px(out, 19, 0), [180, 0, 7, 255], "corner: the corner pixel");
  assert.ok(px(out, 5, 10)[3] > 0 && px(out, 5, 10)[3] < 255, "one pixel overlap at the seam");
});

test("worker jobs: inpaint, patch, horizon and extend", async () => {
  for (const n of ["pixel.inpaint", "pixel.patch", "pixel.horizon", "pixel.extend"]) assert.ok(JOB_NAMES.includes(n), n);
  const img = createImage(30, 30);
  img.data.fill(90);
  const mask = new Uint8Array(900);
  for (let y = 10; y < 15; y++) for (let x = 10; x < 15; x++) { mask[y * 30 + x] = 255; setPx(img, x, y, [255, 0, 0]); }
  const { r } = await runJob("pixel.inpaint", { img, mask, opts: { method: "patch" } });
  assert.deepEqual(px(r, 12, 12), [90, 90, 90, 90]);
  const p = await runJob("pixel.patch", { img: { width: 30, height: 30, data: new Uint8ClampedArray(900 * 4).fill(50) }, mask, dx: 5, dy: 0 });
  assert.equal(p.r.width, 30);
  const hImg = horizonImage(200, 120, 60, 3);
  const direct = detectHorizon(hImg);
  const h = await runJob("pixel.horizon", { img: hImg });
  assert.ok(h.r && Math.abs(h.r.angle - 3) < 0.4, JSON.stringify(h.r));
  assert.deepEqual(h.r, direct, "the job is the same pure function");
  // other byte views of the same pixels give the same answer (asImage reads bytes, not elements)
  const u16 = new Uint16Array(hImg.data.buffer.slice(0));
  assert.deepEqual((await runJob("pixel.horizon", { img: { width: 200, height: 120, data: u16 } })).r, direct);
  assert.deepEqual((await runJob("pixel.horizon", { img: { width: 200, height: 120, data: Array.from(hImg.data) } })).r, direct);
  await assert.rejects(runJob("pixel.horizon", { img: { width: 200, height: 120, data: new Uint8Array(10) } }), /too short/);
  const e = await runJob("pixel.extend", { img, inv: [1, 0, 0, 1, -2, -2], width: 34, height: 34 });
  assert.equal(e.r.width, 34);
});
