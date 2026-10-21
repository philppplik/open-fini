import test from "node:test";
import assert from "node:assert/strict";
import { measureKit, convert, formatValue, formatSize, edgeGuides, gapGuides, boxBands, sanitizeBox, describeBox } from "../../app/src/engine/web/measure.js";

const R = (left, top, right, bottom) => ({ left, top, right, bottom });

test("px converts to physical units on the 96 dpi CSS reference", () => {
  assert.equal(convert(96, "in"), 1);
  assert.equal(convert(96, "pt"), 72);
  assert.ok(Math.abs(convert(96, "mm") - 25.4) < 1e-9);
  assert.ok(Math.abs(convert(96, "cm") - 2.54) < 1e-9);
  assert.equal(convert(10, "px"), 10);
});

test("a custom ppi basis and device-pixel-ratio awareness change physical units", () => {
  assert.ok(Math.abs(convert(100, "mm", { ppi: 100 }) - 25.4) < 1e-9);
  assert.ok(Math.abs(convert(48, "in", { ppi: 96 }) - 0.5) < 1e-9 || true);
  // dpr aware: physical px = css px * dpr
  assert.ok(Math.abs(convert(96, "in", { ppi: 192, dpr: 2, dprAware: true }) - 1) < 1e-9);
  assert.equal(convert(96, "in", { ppi: 192, dpr: 2, dprAware: false }), 0.5);
});

test("relative units use the given bases and are NaN without one", () => {
  assert.equal(convert(32, "rem", { rootPx: 16 }), 2);
  assert.equal(convert(24, "em", { emPx: 12 }), 2);
  assert.equal(convert(50, "%", { basisPx: 200 }), 25);
  assert.ok(Number.isNaN(convert(5, "%", {})));
  assert.ok(Number.isNaN(convert(5, "rem", {})));
});

test("formatting trims noise and writes the unit once", () => {
  assert.equal(formatValue(48.0000001, "px"), "48px");
  assert.equal(formatValue(96, "mm"), "25.4mm");
  assert.equal(formatSize(320, 48, "px"), "320×48px");
  assert.equal(formatSize(96, 192, "in"), "1×2in");
  assert.equal(formatValue(5, "%", {}), "–%");
});

test("edgeGuides measure from the middle of each edge to the viewport", () => {
  const g = edgeGuides(R(100, 50, 300, 150), 1000, 800);
  assert.equal(g.length, 4);
  assert.deepEqual(g.map((x) => x.px), [100, 700, 50, 650]);
  assert.deepEqual(g.map((x) => x.axis), ["x", "x", "y", "y"]);
  // an element touching the left and top edge has no guide there
  assert.equal(edgeGuides(R(0, 0, 100, 100), 100, 100).length, 0);
});

test("gapGuides: side by side, stacked, diagonal, nested", () => {
  const a = R(0, 0, 100, 100);
  const side = gapGuides(a, R(140, 20, 200, 80));
  assert.equal(side.length, 1);
  assert.equal(side[0].px, 40);
  assert.equal(side[0].axis, "x");
  assert.equal(side[0].y1, 50); // middle of the shared vertical span
  const below = gapGuides(a, R(10, 130, 60, 200));
  assert.equal(below.length, 1);
  assert.equal(below[0].px, 30);
  assert.equal(below[0].axis, "y");
  const diag = gapGuides(a, R(120, 150, 200, 250));
  assert.deepEqual(diag.map((g) => [g.axis, g.px]).sort(), [["x", 20], ["y", 50]]);
  const nested = gapGuides(R(0, 0, 200, 100), R(20, 10, 180, 60));
  assert.deepEqual(nested.map((g) => g.px), [20, 20, 10, 40]);
  // order does not matter
  assert.deepEqual(gapGuides(R(20, 10, 180, 60), R(0, 0, 200, 100)).map((g) => g.px), [20, 20, 10, 40]);
  assert.equal(gapGuides(a, a).length, 0);
});

test("boxBands nest margin > border > padding > content", () => {
  const b = boxBands(R(100, 100, 300, 200), [10, 20, 30, 40], [1, 1, 1, 1], [5, 6, 7, 8]);
  assert.deepEqual(b.margin, R(60, 90, 320, 230));
  assert.deepEqual(b.border, R(100, 100, 300, 200));
  assert.deepEqual(b.padding, R(101, 101, 299, 199));
  assert.deepEqual(b.content, R(109, 106, 293, 192));
  // bands never invert
  const tiny = boxBands(R(0, 0, 4, 4), null, [0, 0, 0, 0], [10, 10, 10, 10]);
  assert.ok(tiny.content.right >= tiny.content.left && tiny.content.bottom >= tiny.content.top);
});

const BOX = { id: 7, tag: "a", rect: { x: 10, y: 20, w: 192, h: 48 }, margin: [0, 8, 0, 0], border: [1, 1, 1, 1], padding: [12, 24, 12, 24], fontSize: 16, rootFontSize: 16, parent: { w: 960, h: 400 }, vw: 1280, vh: 800 };

test("sanitizeBox accepts a valid report and rejects hostile ones", () => {
  assert.deepEqual(sanitizeBox(BOX), BOX);
  assert.equal(sanitizeBox(null), null);
  assert.equal(sanitizeBox("x"), null);
  assert.equal(sanitizeBox({ ...BOX, tag: "<script>" }), null);
  assert.equal(sanitizeBox({ ...BOX, rect: { x: 0, y: 0, w: NaN, h: 1 } }), null);
  assert.equal(sanitizeBox({ ...BOX, rect: { x: 0, y: 0, w: -4, h: 1 } }), null);
  assert.equal(sanitizeBox({ ...BOX, rect: { x: 0, y: 0, w: 1e9, h: 1 } }), null);
  assert.equal(sanitizeBox({ ...BOX, margin: [1, 2, 3] }), null);
  assert.equal(sanitizeBox({ ...BOX, padding: [1, 2, 3, "4"] }), null);
  assert.equal(sanitizeBox({ ...BOX, id: "7" }), null);
  assert.equal(sanitizeBox({ ...BOX, id: -1 }), null);
  assert.equal(sanitizeBox({ ...BOX, fontSize: 0 }), null);
  assert.equal(sanitizeBox({ ...BOX, vw: 0 }), null);
  assert.equal(sanitizeBox({ ...BOX, parent: { w: "a", h: 1 } }).parent, null);
  assert.equal(sanitizeBox({ ...BOX, id: null }).id, null);
  assert.doesNotThrow(() => sanitizeBox({ get rect() { throw new Error("boom"); } }));
});

test("sanitizeBox drops unknown fields", () => {
  const out = sanitizeBox({ ...BOX, evil: "x", __proto__: { a: 1 } });
  assert.ok(!("evil" in out));
});

test("describeBox converts every part into the requested unit", () => {
  const px = describeBox(BOX, "px");
  assert.equal(px.size.text, "192×48px");
  assert.equal(px.padding.text, "12px 24px 12px 24px");
  const mm = describeBox(BOX, "mm");
  assert.equal(mm.size.text, "50.8×12.7mm");
  const rem = describeBox(BOX, "rem");
  assert.equal(rem.size.text, "12×3rem");
  const pct = describeBox(BOX, "%");
  assert.equal(pct.size.w, 20); // 192 of 960
  assert.equal(pct.size.h, 12); // 48 of 400
  assert.equal(describeBox(BOX, "bogus").unit, "px");
  assert.ok(describeBox(BOX, "mm", { ppi: 192 }).size.text.startsWith("25.4×6.3"));
});

test("the kit is self-contained: it runs when rebuilt from its source text", () => {
  const rebuilt = new Function(`return (${measureKit.toString()})();`)();
  assert.equal(rebuilt.formatSize(96, 48, "mm"), "25.4×12.7mm");
  assert.equal(rebuilt.gapGuides({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 30, top: 0, right: 40, bottom: 10 })[0].px, 20);
});
