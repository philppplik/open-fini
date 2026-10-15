import test from "node:test";
import assert from "node:assert/strict";
import { Mask, rectMask, ellipseMask, magicWand, colorRange } from "../../app/src/engine/pixel/selection.js";
import { createImage } from "../../app/src/engine/pixel/image.js";
import { solid, setPx, maskArea, ringArea, near } from "./_util.js";

const hardRect = (w, h, x, y, rw, rh) => Mask.rect(w, h, x, y, rw, rh);

test("rect and ellipse masks have exact, anti-aliased areas", () => {
  assert.equal(maskArea(hardRect(40, 40, 10, 10, 10, 10)), 100);
  near(maskArea(Mask.rect(40, 40, 10.5, 10.25, 10, 10)), 100, 0.5);
  assert.equal(Mask.rect(40, 40, 10.5, 10, 10, 10).get(10, 12), 128);
  assert.equal(maskArea(Mask.rect(10, 10, -5, -5, 8, 8)), 9); // clipped
  assert.equal(maskArea(Mask.rect(10, 10, 5, 5, 0, 3)), 0);
  assert.equal(rectMask(20, 20, 2, 2, 4, 4).get(3, 3), 255);
  const e = Mask.ellipse(100, 100, 10, 10, 80, 60);
  near(maskArea(e), Math.PI * 40 * 30, 12);
  assert.equal(e.get(50, 40), 255);
  assert.equal(e.get(2, 2), 0);
  near(maskArea(ellipseMask(60, 60, 5, 5, 40, 40)), Math.PI * 400, 8);
  const c = Mask.ellipse(11, 11, 0, 0, 11, 11);
  assert.equal(c.get(5, 5), 255);
  assert.equal(c.get(0, 0), 0);
  assert.ok(c.get(5, 0) > 0 && c.get(5, 0) < 255 || c.get(5, 0) === 255);
});

test("polygon mask: area, fill rules, holes and winding independence", () => {
  assert.equal(maskArea(Mask.polygon(50, 50, [10, 10, 40, 10, 40, 40, 10, 40])), 900);
  near(maskArea(Mask.polygon(50, 50, [10, 10, 40, 10, 10, 40])), 450, 0.5);
  near(maskArea(Mask.polygon(50, 50, [[10, 10], [40, 10], [10, 40]])), 450, 0.5);
  near(maskArea(Mask.polygon(50, 50, [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 10, y: 40 }])), 450, 0.5);
  // clockwise and counter-clockwise rings give the same mask
  near(maskArea(Mask.polygon(50, 50, [10, 10, 10, 40, 40, 10])), 450, 0.5);
  // outer square with an inner square of the same winding: even-odd punches the hole, nonzero fills
  const rings = [[5, 5, 45, 5, 45, 45, 5, 45], [15, 15, 35, 15, 35, 35, 15, 35]];
  assert.equal(maskArea(Mask.polygon(50, 50, rings, { fillRule: "evenodd" })), 1600 - 400);
  assert.equal(maskArea(Mask.polygon(50, 50, rings, { fillRule: "nonzero" })), 1600);
  // polygon partly outside the mask is clipped
  assert.equal(maskArea(Mask.polygon(20, 20, [-10, -10, 10, -10, 10, 10, -10, 10])), 100);
  assert.equal(Mask.polygon(20, 20, []).isEmpty(), true);
  // triangle edge is anti-aliased
  const t = Mask.polygon(20, 20, [0, 0, 20, 0, 0, 20]);
  const v = t.get(10, 9);
  assert.ok(v > 0 && v < 255, "diagonal pixel partial: " + v);
});

test("fromAlpha / fromLuma / fromImage", () => {
  const img = createImage(3, 1);
  setPx(img, 0, 0, [255, 255, 255, 40]);
  setPx(img, 1, 0, [0, 0, 0, 255]);
  setPx(img, 2, 0, [255, 0, 0, 255]);
  assert.deepEqual(Array.from(Mask.fromAlpha(img).data), [40, 255, 255]);
  assert.deepEqual(Array.from(Mask.fromLuma(img).data), [255, 0, 76]);
  assert.deepEqual(Array.from(Mask.fromImage(img, { channel: "red" }).data), [255, 0, 255]);
  assert.deepEqual(Array.from(Mask.fromImage(img, { channel: "red", invert: true }).data), [0, 255, 0]);
  assert.throws(() => Mask.fromImage(img, { channel: "nope" }));
});

test("clone, isEmpty, bounds, fill, get", () => {
  const m = hardRect(30, 20, 5, 4, 10, 6);
  const c = m.clone();
  c.data[0] = 255;
  assert.equal(m.data[0], 0);
  assert.equal(m.isEmpty(), false);
  assert.equal(Mask.empty(5, 5).isEmpty(), true);
  assert.deepEqual(m.bounds(), { x: 5, y: 4, width: 10, height: 6 });
  assert.deepEqual(Mask.empty(5, 5).bounds(), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(Mask.full(4, 3).bounds(), { x: 0, y: 0, width: 4, height: 3 });
  assert.equal(m.get(-1, 0), 0);
  assert.equal(m.get(5, 4), 255);
  // wrapping existing MaskData
  const w = new Mask({ width: 2, height: 2, data: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(w.get(1, 1), 4);
  assert.throws(() => new Mask(2, 2, new Uint8Array(3)));
});

test("combine implements replace/add/subtract/intersect/xor", () => {
  const a = hardRect(20, 10, 0, 0, 10, 10);
  const b = hardRect(20, 10, 5, 0, 10, 10);
  const area = (op) => maskArea(a.clone().combine(b, op));
  assert.equal(area("replace"), 100);
  assert.equal(area("add"), 150);
  assert.equal(area("subtract"), 50);
  assert.equal(area("intersect"), 50);
  assert.equal(area("xor"), 100);
  assert.equal(a.clone().combine(b, "add").get(12, 5), 255);
  assert.equal(a.clone().combine(b, "xor").get(7, 5), 0);
  assert.equal(a.clone().combine(b, "subtract").get(7, 5), 0);
  assert.equal(a.clone().combine(b, "subtract").get(2, 5), 255);
  const half = new Mask(1, 1, new Uint8Array([128]));
  const q = new Mask(1, 1, new Uint8Array([128]));
  near(half.clone().combine(q, "intersect").data[0], 64, 1);
  near(half.clone().combine(q, "add").data[0], 192, 1);
  const x = a.clone();
  assert.equal(x.combine(b, "add"), x, "combine returns this");
  assert.throws(() => a.clone().combine(Mask.empty(3, 3), "add"));
  assert.throws(() => a.clone().combine(b, "bogus"));
});

test("invert flips coverage", () => {
  const m = hardRect(10, 10, 2, 2, 4, 4);
  m.invert();
  assert.equal(maskArea(m), 100 - 16);
  assert.equal(m.get(3, 3), 0);
  assert.equal(m.get(0, 0), 255);
  m.invert().invert();
  assert.equal(m.get(3, 3), 0);
});

test("feather blurs the edge symmetrically and keeps the 50 % contour in place", () => {
  const m = hardRect(100, 60, 30, 10, 40, 40);
  const before = maskArea(m);
  m.feather(8);
  near(maskArea(m), before, 8, "area is preserved");
  const row = (x) => m.get(x, 30);
  assert.equal(row(50), 255);
  assert.equal(row(5), 0);
  assert.ok(row(30) > 100 && row(30) < 155, "50 % at the old edge: " + row(30));
  assert.ok(row(26) > 0 && row(26) < row(30) && row(34) > row(30) && row(34) < 255);
  near(row(30 - 5) + row(30 + 4), 255, 25); // mirror symmetric around the edge
  assert.equal(Mask.empty(5, 5).feather(3).isEmpty(), true);
  const same = hardRect(20, 20, 5, 5, 5, 5);
  same.feather(0);
  assert.equal(maskArea(same), 25);
  // border-touching masks do not fade at the image border
  const full = Mask.full(30, 30).feather(6);
  assert.equal(full.get(0, 0), 255);
});

test("grow and shrink use a disc and anti-alias the rim", () => {
  const g = hardRect(40, 40, 15, 15, 10, 10).grow(3);
  assert.equal(g.get(14, 20), 255);
  assert.equal(g.get(12, 20), 255);
  assert.equal(g.get(11, 20), 0);
  assert.equal(g.get(20, 12), 255);
  near(maskArea(g), 10 * 10 + 4 * 10 * 3 + Math.PI * 9, 3);
  assert.ok(g.get(12, 12) < 255, "rounded corner");
  const s = hardRect(40, 40, 10, 10, 20, 20).shrink(4);
  assert.deepEqual(s.bounds(), { x: 14, y: 14, width: 12, height: 12 });
  assert.equal(maskArea(s), 144);
  // shrink does not erode from the image border
  const full = Mask.full(10, 10).shrink(3);
  assert.equal(maskArea(full), 100);
  const touching = hardRect(20, 20, 0, 0, 10, 10).shrink(2);
  assert.equal(touching.get(0, 0), 255);
  assert.equal(touching.get(9, 5), 0);
  assert.equal(touching.get(7, 5), 255);
  // fractional distances give partial coverage
  const f = hardRect(40, 40, 10, 10, 20, 20).grow(2.5);
  assert.ok(f.get(7, 20) > 100 && f.get(7, 20) < 160, "half pixel: " + f.get(7, 20));
  assert.equal(Mask.empty(5, 5).grow(3).isEmpty(), true);
});

test("smooth rounds corners, border selects a band, translate shifts", () => {
  const sq = hardRect(60, 60, 20, 20, 20, 20);
  const sm = sq.clone().smooth(4);
  assert.ok(sm.get(20, 20) < 128, "corner pixel rounded off");
  assert.equal(sm.get(30, 30), 255);
  assert.ok(sm.get(30, 20) > 100, "straight edge stays");
  near(maskArea(sm), 400, 25);
  const b = hardRect(60, 60, 20, 20, 20, 20).border(6);
  assert.equal(b.get(30, 30), 0, "center excluded");
  assert.equal(b.get(20, 30), 255, "on the edge");
  assert.equal(b.get(17, 30), 255, "outside band half");
  assert.equal(b.get(15, 30), 0, "outside band");
  near(maskArea(b), (26 * 26 - 14 * 14), 40);
  const t = hardRect(20, 20, 2, 2, 4, 4).translate(5, 3);
  assert.deepEqual(t.bounds(), { x: 7, y: 5, width: 4, height: 4 });
  const out = hardRect(20, 20, 15, 15, 4, 4).translate(10, 0);
  assert.equal(out.isEmpty(), true);
  const neg = hardRect(20, 20, 2, 2, 4, 4).translate(-3, -3);
  assert.deepEqual(neg.bounds(), { x: 0, y: 0, width: 3, height: 3 });
});

test("toContours: rectangle gives one exact clockwise outline", () => {
  const cs = hardRect(40, 40, 10, 10, 10, 10).toContours();
  assert.equal(cs.length, 1);
  assert.equal(cs[0].hole, false);
  const p = cs[0].points;
  assert.equal(p.length, 8);
  const xs = p.filter((_, i) => i % 2 === 0);
  const ys = p.filter((_, i) => i % 2 === 1);
  near(Math.min(...xs), 10, 0.01);
  near(Math.max(...xs), 20, 0.01);
  near(Math.min(...ys), 10, 0.01);
  near(Math.max(...ys), 20, 0.01);
  near(ringArea(p), 100, 0.1);
  // raw marching squares output (no simplification) has many more vertices
  const raw = hardRect(40, 40, 10, 10, 10, 10).toContours({ simplify: 0 });
  assert.ok(raw[0].points.length > p.length);
  near(ringArea(raw[0].points), 100, 1);
});

test("toContours: a ring yields an outer contour and a hole with the right areas", () => {
  const outer = Mask.ellipse(200, 200, 20, 20, 160, 160);
  const inner = Mask.ellipse(200, 200, 60, 60, 80, 80);
  const ring = outer.clone().combine(inner, "subtract");
  for (const simplify of [0, 0.5]) {
    const cs = ring.toContours({ simplify });
    assert.equal(cs.length, 2);
    const o = cs.find((c) => !c.hole);
    const h = cs.find((c) => c.hole);
    assert.ok(o && h);
    const ao = ringArea(o.points), ah = ringArea(h.points);
    assert.ok(ao > 0 && ah < 0, "outer positive, hole negative");
    near(ao, Math.PI * 80 * 80, simplify ? 150 : 40);
    near(-ah, Math.PI * 40 * 40, simplify ? 60 : 30);
    near(ao + ah, Math.PI * (6400 - 1600), simplify ? 200 : 60);
  }
  assert.ok(ring.toContours({ simplify: 0.5 })[0].points.length < 200, "simplification removes vertices");
});

test("toContours: several shapes, touching the border, empty masks and thresholds", () => {
  const m = hardRect(60, 30, 5, 5, 10, 10).combine(hardRect(60, 30, 30, 5, 8, 8), "add");
  assert.equal(m.toContours().length, 2);
  const edge = Mask.full(10, 8).toContours();
  assert.equal(edge.length, 1);
  near(ringArea(edge[0].points), 80, 0.1);
  assert.deepEqual(Mask.empty(10, 10).toContours(), []);
  // anti-aliased edge: the contour sits at the 50 % crossing (sub-pixel accurate)
  const aa = Mask.rect(40, 40, 10.25, 10, 10, 10).toContours({ simplify: 0 })[0].points;
  const xs = aa.filter((_, i) => i % 2 === 0);
  near(Math.min(...xs), 10.25, 0.1);
  near(Math.max(...xs), 20.25, 0.1);
  // threshold changes the outline
  const soft = hardRect(40, 40, 10, 10, 10, 10).feather(6);
  const lo = ringArea(soft.toContours({ threshold: 30 })[0].points);
  const hi = ringArea(soft.toContours({ threshold: 180 })[0].points);
  assert.ok(lo > hi);
  // an L shape keeps its concave corner
  const l = hardRect(40, 40, 5, 5, 20, 8).combine(hardRect(40, 40, 5, 5, 8, 20), "add");
  const lp = l.toContours()[0].points;
  assert.equal(lp.length, 12);
  near(ringArea(lp), 20 * 8 + 8 * 20 - 64, 0.5);
});

test("toContours is fast on a 4000 x 4000 mask", () => {
  const big = Mask.ellipse(4000, 4000, 200, 200, 3600, 3600);
  const hole = Mask.ellipse(4000, 4000, 1500, 1500, 1000, 1000);
  big.combine(hole, "subtract");
  const t0 = performance.now();
  const cs = big.toContours();
  const dt = performance.now() - t0;
  assert.equal(cs.length, 2);
  assert.ok(dt < 1500, "contour time " + dt + " ms");
  const o = cs.find((c) => !c.hole);
  near(ringArea(o.points), Math.PI * 1800 * 1800, 8000);
});

test("magic wand: tolerance, contiguity and anti-aliasing", () => {
  const img = solid(20, 10, [100, 100, 100]);
  for (let y = 0; y < 10; y++) for (let x = 10; x < 20; x++) setPx(img, x, y, [110, 100, 100]);
  for (let y = 0; y < 10; y++) setPx(img, 9, y, [255, 0, 0]); // separator column
  const exact = magicWand(img, 2, 5, { tolerance: 0, antialias: false });
  assert.equal(maskArea(exact), 9 * 10);
  assert.equal(exact.get(12, 5), 0);
  const loose = magicWand(img, 2, 5, { tolerance: 12, antialias: false });
  assert.equal(maskArea(loose), 9 * 10, "contiguous: separator blocks the fill");
  const noncontig = magicWand(img, 2, 5, { tolerance: 12, contiguous: false, antialias: false });
  assert.equal(maskArea(noncontig), 190, "non-contiguous also takes the right half");
  const tight = magicWand(img, 12, 5, { tolerance: 9, contiguous: false, antialias: false });
  assert.equal(maskArea(tight), 100, "only the right half: the left differs by 10 > 9");
  const aa = magicWand(img, 2, 5, { tolerance: 0, antialias: true });
  assert.ok(aa.get(8, 5) > 128 && aa.get(8, 5) < 255, "edge softened: " + aa.get(8, 5));
  assert.ok(aa.get(9, 5) > 0 && aa.get(9, 5) < 128);
  assert.equal(aa.get(2, 5), 255);
  assert.equal(magicWand(img, -1, 0).isEmpty(), true);
  // wrap-around spiral: scanline fill reaches every pixel of a winding corridor without recursion
  const maze = solid(60, 60, [0, 0, 0]);
  for (let y = 0; y < 60; y += 2) for (let x = 0; x < 60; x++) setPx(maze, x, y, [255, 255, 255]);
  for (let y = 1; y < 60; y += 4) setPx(maze, 59, y, [255, 255, 255]);
  for (let y = 3; y < 60; y += 4) setPx(maze, 0, y, [255, 255, 255]);
  const mz = magicWand(maze, 0, 0, { tolerance: 0, antialias: false });
  assert.equal(mz.get(30, 58), 255, "reaches the end of the corridor");
  // transparent pixels match each other but not opaque ones
  const tr = createImage(4, 1);
  setPx(tr, 0, 0, [9, 9, 9, 0]);
  setPx(tr, 1, 0, [200, 0, 0, 0]);
  setPx(tr, 2, 0, [9, 9, 9, 255]);
  const tw = magicWand(tr, 0, 0, { tolerance: 0, antialias: false });
  assert.equal(tw.get(1, 0), 255);
  assert.equal(tw.get(2, 0), 0);
});

test("color range selects by color with fuzziness", () => {
  const img = solid(4, 1, [10, 10, 10]);
  setPx(img, 1, 0, [200, 50, 50]);
  setPx(img, 2, 0, [215, 50, 50]);
  setPx(img, 3, 0, [240, 50, 50]);
  const m = colorRange(img, "#c83232", { tolerance: 10, fuzziness: 0 });
  assert.deepEqual(Array.from(m.data), [0, 255, 0, 0]);
  const soft = colorRange(img, [200, 50, 50], { tolerance: 10, fuzziness: 20 });
  assert.equal(soft.get(1, 0), 255);
  assert.ok(soft.get(2, 0) > 0 && soft.get(2, 0) < 255, "partial: " + soft.get(2, 0));
  assert.equal(soft.get(3, 0), 0);
  assert.equal(soft.get(0, 0), 0);
});
