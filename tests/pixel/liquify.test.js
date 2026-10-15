import test from "node:test";
import assert from "node:assert/strict";
import { Liquify } from "../../app/src/engine/pixel/liquify.js";
import { createImage, cloneImage } from "../../app/src/engine/pixel/image.js";
import { px, setPx, maxDiff, near } from "./_util.js";

function gradient(w, h) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(img, x, y, [x * 2, y * 2, 128]);
  return img;
}

test("an untouched Liquify renders the source exactly", () => {
  const src = gradient(60, 40);
  const lq = new Liquify(src);
  assert.equal(maxDiff(lq.render(), src), 0);
  const out = createImage(60, 40);
  assert.equal(lq.render(out), out);
  assert.equal(maxDiff(out, src), 0);
  assert.throws(() => lq.render(createImage(3, 3)));
});

test("push drags pixels along the stroke and leaves distant pixels alone", () => {
  const src = gradient(100, 60);
  const lq = new Liquify(src);
  const rect = lq.applyBrush({ mode: "push", x: 50, y: 30, radius: 20, strength: 1, dx: 8, dy: 0 });
  assert.ok(rect.width > 0 && rect.x <= 30 && rect.x + rect.width >= 70, "dirty rect covers the brush: " + JSON.stringify(rect));
  const out = lq.render();
  // at the brush center the content moved 8 px to the right: output(50) == source(42)
  assert.equal(px(out, 50, 30)[0], 42 * 2);
  assert.equal(px(out, 5, 30)[0], 5 * 2);
  assert.equal(px(out, 95, 30)[0], 95 * 2);
  assert.equal(px(out, 50, 5)[1], 5 * 2, "rows above the brush untouched");
  const d = lq.displacementAt(50, 30);
  near(d.u, -8, 0.5);
  near(d.v, 0, 1e-6);
  // strength scales the displacement
  const half = new Liquify(src);
  half.applyBrush({ mode: "push", x: 50, y: 30, radius: 20, strength: 0.5, dx: 8, dy: 0 });
  near(half.displacementAt(50, 30).u, -4, 0.3);
  // region rendering: only the requested rectangle is rewritten
  const target = cloneImage(src);
  lq.renderRegion(target, { x: 40, y: 20, width: 20, height: 20 });
  assert.equal(px(target, 50, 30)[0], 84);
  assert.equal(px(target, 30, 30)[0], 60);
  const other = lq.renderRegion({ x: 40, y: 20, width: 20, height: 20 }, cloneImage(src));
  assert.equal(px(other, 50, 30)[0], 84);
});

test("twirl rotates around the center, pinch and bloat move pixels radially", () => {
  const src = gradient(100, 100);
  const cw = new Liquify(src);
  const ccw = new Liquify(src);
  cw.applyBrush({ mode: "twirl-cw", x: 50, y: 50, radius: 30, strength: 1 });
  ccw.applyBrush({ mode: "twirl-ccw", x: 50, y: 50, radius: 30, strength: 1 });
  const a = cw.displacementAt(60, 50);
  const b = ccw.displacementAt(60, 50);
  assert.ok(Math.abs(a.v) > 0.3 && a.v * b.v < 0, "opposite directions: " + a.v + " / " + b.v);
  // pixel to the right of the center moves down for a clockwise twirl: sample position is above
  assert.ok(a.v < 0);
  const c = cw.displacementAt(50, 50);
  near(c.u, 0, 0.3);
  near(c.v, 0, 0.3);
  assert.equal(px(cw.render(), 5, 5)[0], px(src, 5, 5)[0]);
  const pinch = new Liquify(src);
  pinch.applyBrush({ mode: "pinch", x: 50, y: 50, radius: 30, strength: 1 });
  assert.ok(pinch.displacementAt(60, 50).u > 0, "pinch samples farther out");
  const bloat = new Liquify(src);
  bloat.applyBrush({ mode: "bloat", x: 50, y: 50, radius: 30, strength: 1 });
  assert.ok(bloat.displacementAt(60, 50).u < 0, "bloat samples closer to the center");
  assert.throws(() => bloat.applyBrush({ mode: "nope", x: 50, y: 50, radius: 10 }));
});

test("reconstruct relaxes the field, reset clears it", () => {
  const src = gradient(80, 60);
  const lq = new Liquify(src);
  lq.applyBrush({ mode: "push", x: 40, y: 30, radius: 20, strength: 1, dx: 10, dy: 5 });
  assert.ok(Math.abs(lq.displacementAt(40, 30).u) > 5);
  lq.applyBrush({ mode: "reconstruct", x: 40, y: 30, radius: 25, strength: 1 });
  near(lq.displacementAt(40, 30).u, 0, 0.1);
  lq.applyBrush({ mode: "push", x: 40, y: 30, radius: 20, strength: 1, dx: 10, dy: 0 });
  const dirty = lq.reset();
  assert.ok(dirty.width > 0);
  assert.equal(lq.displacementAt(40, 30).u, 0);
  assert.equal(maxDiff(lq.render(), src), 0);
  assert.equal(lq.reset().width, 0);
});

test("alpha is warped premultiplied; large images use a coarser field grid", () => {
  const src = createImage(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (x < 32) setPx(src, x, y, [255, 0, 0, 255]);
  const lq = new Liquify(src);
  lq.applyBrush({ mode: "push", x: 32, y: 32, radius: 20, strength: 1, dx: 6, dy: 0 });
  const out = lq.render();
  const edge = px(out, 36, 32);
  assert.ok(edge[3] > 200 && edge[0] === 255, "edge moved right and stays pure red: " + edge);
  const gap = px(out, 45, 32);
  assert.equal(gap[3], 0);
  const big = createImage(2400, 1200);
  const lb = new Liquify(big);
  assert.ok(lb.step >= 2);
  lb.applyBrush({ mode: "twirl-cw", x: 1200, y: 600, radius: 100, strength: 1 });
  assert.ok(lb.displacementAt(1250, 600).v !== 0);
  const forced = new Liquify(src, { step: 4, copy: true });
  assert.equal(forced.step, 4);
});

test("dispose releases the buffers", () => {
  const lq = new Liquify(gradient(10, 10));
  lq.dispose();
  assert.throws(() => lq.render(), /dispose/);
  assert.throws(() => lq.applyBrush({ mode: "push", x: 1, y: 1, radius: 3 }), /dispose/);
});

test("rendering a full 2 MP distortion stays fast", () => {
  const src = createImage(1600, 1250);
  const lq = new Liquify(src);
  lq.applyBrush({ mode: "push", x: 800, y: 600, radius: 600, strength: 1, dx: 40, dy: 10 });
  const t0 = performance.now();
  lq.render();
  assert.ok(performance.now() - t0 < 1500);
});
