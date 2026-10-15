import test from "node:test";
import assert from "node:assert/strict";
import { quantizeColors, traceImage } from "../../app/src/engine/pixel/trace.js";
import { createImage } from "../../app/src/engine/pixel/image.js";
import { solid, noise, setPx, ringArea, near } from "./_util.js";

function fillRect(img, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(img, x, y, c);
}

function bbox(points) {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

test("quantizeColors finds the dominant colors and ignores transparent pixels", () => {
  const img = solid(60, 20, [255, 0, 0]);
  fillRect(img, 20, 0, 20, 20, [0, 255, 0]);
  fillRect(img, 40, 0, 20, 20, [0, 0, 255]);
  const pal = quantizeColors(img, 3);
  assert.equal(pal.length, 3);
  assert.deepEqual(pal.map((p) => p.hex).sort(), ["#0000ff", "#00ff00", "#ff0000"]);
  near(pal.reduce((a, p) => a + p.weight, 0), 1, 1e-9);
  for (const p of pal) near(p.weight, 1 / 3, 0.02);
  assert.equal(quantizeColors(img, 1).length, 1);
  const one = quantizeColors(img, 1)[0];
  near(one.r, 85, 2);
  assert.equal(quantizeColors(img, 8).length, 3, "never more colors than exist");
  const t = solid(10, 10, [9, 9, 9, 0]);
  setPx(t, 5, 5, [200, 100, 50, 255]);
  const tp = quantizeColors(t, 4);
  assert.equal(tp.length, 1);
  assert.equal(tp[0].hex, "#c86432");
  assert.deepEqual(quantizeColors(solid(4, 4, [1, 2, 3, 0]), 4), []);
  // deterministic for a given seed
  const n = noise(40, 40, 6);
  assert.deepEqual(quantizeColors(n, 6, { seed: 2 }), quantizeColors(n, 6, { seed: 2 }));
  assert.equal(quantizeColors(n, 6).length, 6);
});

test("mono trace outlines a black square exactly", () => {
  const img = solid(60, 60, [255, 255, 255]);
  fillRect(img, 10, 15, 20, 20, [0, 0, 0]);
  const t = traceImage(img, { mode: "mono", threshold: 128, smoothing: 0 });
  assert.equal(t.width, 60);
  assert.equal(t.height, 60);
  assert.equal(t.layers.length, 1);
  assert.equal(t.layers[0].color, "#000000");
  assert.equal(t.layers[0].contours.length, 1);
  const c = t.layers[0].contours[0];
  assert.equal(c.hole, false);
  const [x0, y0, x1, y1] = bbox(c.points);
  near(x0, 10, 0.05);
  near(y0, 15, 0.05);
  near(x1, 30, 0.05);
  near(y1, 35, 0.05);
  near(ringArea(c.points), 400, 1);
  // ink color option and inverted threshold
  const colored = traceImage(img, { mode: "mono", color: "#ff0000", smoothing: 0 });
  assert.equal(colored.layers[0].color, "#ff0000");
  const light = traceImage(img, { mode: "mono", threshold: 0, smoothing: 0 });
  assert.equal(light.layers.length, 0, "nothing is darker than 0");
});

test("mono trace reports holes", () => {
  const img = solid(80, 80, [255, 255, 255]);
  fillRect(img, 10, 10, 60, 60, [0, 0, 0]);
  fillRect(img, 30, 30, 20, 20, [255, 255, 255]);
  const t = traceImage(img, { mode: "mono", smoothing: 0 });
  const cs = t.layers[0].contours;
  assert.equal(cs.length, 2);
  const outer = cs.find((c) => !c.hole);
  const hole = cs.find((c) => c.hole);
  near(ringArea(outer.points), 3600, 2);
  near(ringArea(hole.points), -400, 2);
});

test("color trace stacks layers by decreasing area", () => {
  const img = solid(80, 60, [255, 255, 255]);
  fillRect(img, 10, 10, 40, 40, [220, 30, 30]);
  fillRect(img, 20, 20, 10, 10, [30, 30, 220]);
  const t = traceImage(img, { mode: "color", colors: 3, smoothing: 0 });
  assert.deepEqual(t.layers.map((l) => l.color), ["#ffffff", "#dc1e1e", "#1e1edc"]);
  const area = (l) => l.contours.reduce((a, c) => a + ringArea(c.points), 0);
  near(area(t.layers[0]), 80 * 60, 3); // bottom layer covers everything
  near(area(t.layers[1]), 40 * 40, 3); // red covers itself plus the blue it sits under
  near(area(t.layers[2]), 100, 1);
  for (const l of t.layers) assert.ok(l.contours.every((c) => !c.hole), "stacked layers need no holes here");
  // cutout mode produces disjoint regions with holes
  const cut = traceImage(img, { mode: "color", colors: 3, smoothing: 0, stacking: "cutout" });
  const red = cut.layers.find((l) => l.color === "#dc1e1e");
  assert.equal(red.contours.length, 2);
  assert.equal(red.contours.filter((c) => c.hole).length, 1);
  near(area(red), 1600 - 100, 3);
  near(area(cut.layers.find((l) => l.color === "#ffffff")), 80 * 60 - 1600, 4);
});

test("transparent pixels are excluded and speckles are removed", () => {
  const img = createImage(50, 50);
  fillRect(img, 10, 10, 20, 20, [255, 0, 0, 255]);
  const t = traceImage(img, { mode: "color", colors: 2, smoothing: 0 });
  assert.equal(t.layers.length, 1);
  assert.equal(t.layers[0].color, "#ff0000");
  near(ringArea(t.layers[0].contours[0].points), 400, 1);

  const spk = solid(60, 60, [255, 255, 255]);
  fillRect(spk, 10, 10, 25, 25, [0, 0, 0]);
  setPx(spk, 50, 50, [0, 0, 0]);
  fillRect(spk, 45, 10, 2, 2, [0, 0, 0]);
  const keep = traceImage(spk, { mode: "mono", speckle: 0, smoothing: 0 });
  assert.equal(keep.layers[0].contours.length, 3);
  const clean = traceImage(spk, { mode: "mono", speckle: 6, smoothing: 0 });
  assert.equal(clean.layers[0].contours.length, 1, "1 px and 4 px specks removed");
  // also holes: a tiny white speck inside a black shape is filled
  const hole = solid(40, 40, [0, 0, 0]);
  setPx(hole, 20, 20, [255, 255, 255]);
  const filled = traceImage(hole, { mode: "mono", speckle: 4, smoothing: 0 });
  assert.equal(filled.layers[0].contours.length, 1);
  assert.equal(filled.layers[0].contours[0].hole, false);
});

test("smoothing rounds corners and blur removes noise before tracing", () => {
  const img = solid(60, 60, [255, 255, 255]);
  fillRect(img, 10, 10, 30, 30, [0, 0, 0]);
  const sharp = traceImage(img, { mode: "mono", smoothing: 0 }).layers[0].contours[0];
  const round = traceImage(img, { mode: "mono", smoothing: 4 }).layers[0].contours[0];
  assert.ok(round.points.length > sharp.points.length, "rounded corners need more vertices");
  assert.ok(ringArea(round.points) < ringArea(sharp.points) - 5);
  // noisy gray image: without blur there are many contours, with blur far fewer
  const n = noise(60, 60, 3);
  const raw = traceImage(n, { mode: "mono", speckle: 0, smoothing: 0 }).layers[0].contours.length;
  const smooth = traceImage(n, { mode: "mono", speckle: 0, smoothing: 0, blur: 3 }).layers[0].contours.length;
  assert.ok(smooth < raw * 0.3, `${smooth} vs ${raw}`);
  assert.deepEqual(traceImage(createImage(0, 0), {}).layers, []);
});

test("trace of a larger image stays quick", () => {
  const img = solid(400, 300, [255, 255, 255]);
  for (let k = 0; k < 20; k++) {
    for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
      if (Math.hypot(x - (30 + k * 17), y - (40 + k * 11)) < 25) setPx(img, x, y, [(k * 40) % 256, (k * 90) % 256, (k * 150) % 256]);
    }
  }
  const t0 = performance.now();
  const t = traceImage(img, { colors: 8 });
  const dt = performance.now() - t0;
  assert.ok(t.layers.length >= 4 && t.layers.length <= 8);
  assert.ok(dt < 4000, "trace time " + dt);
});
