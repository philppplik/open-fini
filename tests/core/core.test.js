import test from "node:test";
import assert from "node:assert/strict";
import { Doc } from "../../app/src/core/doc.js";
import { App } from "../../app/src/core/app.js";
import { createNode, solid, defaultStroke, localBounds, worldMatrix } from "../../app/src/core/nodes.js";
import * as ops from "../../app/src/core/ops.js";
import { translate, scale, rotate, mul, decompose, invert } from "../../app/src/core/math.js";
import { captureTransform, applyPageDelta, pageBounds } from "../../app/src/core/transform.js";
import { buildPageDL } from "../../app/src/engine/dl.js";
import { History } from "../../app/src/core/history.js";
import { parseColor, toHex6, rgbToHsv, hsvToRgb, hslToRgb, rgbToHsl } from "../../app/src/core/color.js";
import { clone, equal } from "../../app/src/core/util.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const rect = (x, y, w, h, extra = {}) => createNode("rect", { w, h, m: translate(x, y), ...extra });

function makeApp() {
  const app = new App();
  const doc = new Doc({ name: "T", width: 400, height: 300 });
  app.openDoc(doc);
  return { app, doc };
}

test("transactions group edits and undo/redo restore them", () => {
  const { doc } = makeApp();
  const r = rect(10, 10, 50, 50);
  doc.tx("Add", () => doc.insert(r, doc.pages[0].root));
  assert.equal(doc.pages[0].root.children.length, 1);
  doc.set(r, { w: 80 }, "Resize");
  assert.equal(r.w, 80);
  doc.undo();
  assert.equal(r.w, 50);
  doc.undo();
  assert.equal(doc.pages[0].root.children.length, 0);
  assert.equal(doc.find(r.id), null);
  doc.redo();
  doc.redo();
  assert.equal(r.w, 80);
  assert.equal(doc.find(r.id), r);
});

test("failed transactions roll back", () => {
  const { doc } = makeApp();
  const r = rect(0, 0, 10, 10);
  assert.throws(() =>
    doc.tx("Boom", () => {
      doc.insert(r, doc.pages[0].root);
      throw new Error("x");
    }),
  );
  assert.equal(doc.pages[0].root.children.length, 0);
});

test("coalesced transactions merge into one history entry", () => {
  const { doc } = makeApp();
  const r = rect(0, 0, 10, 10);
  doc.tx("Add", () => doc.insert(r, doc.pages[0].root));
  for (let i = 1; i <= 5; i++) doc.tx("Opacity", () => doc.set(r, { opacity: 1 - i * 0.1 }), { coalesce: "op" });
  assert.equal(doc.history.entries.length, 2);
  doc.undo();
  assert.equal(r.opacity, 1);
});

test("history trims by entry count and reports bytes", () => {
  const h = new History({ limitEntries: 3 });
  for (let i = 0; i < 6; i++) h.push({ label: String(i), ops: [{ undo() {}, redo() {} }], bytes: 10 });
  assert.equal(h.entries.length, 3);
  assert.equal(h.bytes, 30);
  assert.equal(h.entries[0].label, "3");
});

test("move/remove keep parent pointers and the id index consistent", () => {
  const { doc } = makeApp();
  const root = doc.pages[0].root;
  const g = createNode("group");
  const a = rect(0, 0, 10, 10);
  doc.tx("Add", () => {
    doc.insert(g, root);
    doc.insert(a, root);
  });
  doc.move(a, g, 0);
  assert.equal(a._parent, g);
  assert.deepEqual(g.children, [a]);
  doc.undo();
  assert.equal(a._parent, root);
  doc.redo();
  doc.remove(g);
  assert.equal(doc.find(a.id), null);
  doc.undo();
  assert.equal(doc.find(a.id), a);
});

test("JSON round trip keeps structure, styles and stories but drops runtime fields", () => {
  const { doc } = makeApp();
  const r = rect(5, 6, 7, 8, { fill: solid("#123456"), stroke: defaultStroke("#abcdef", 3) });
  doc.tx("Add", () => doc.insert(r, doc.pages[0].root));
  r._rev = 99;
  const sid = doc.createStory({ paragraphs: [{ runs: [{ text: "hello" }] }] });
  doc.insert(createNode("text", { storyId: sid }), doc.pages[0].root);
  const json = JSON.parse(JSON.stringify(doc.toJSON()));
  assert.equal(json.format, "openfini");
  assert.ok(!JSON.stringify(json).includes("_rev"));
  const back = Doc.fromJSON(json);
  const r2 = back.pages[0].root.children[0];
  assert.equal(r2.w, 7);
  assert.equal(r2.stroke.width, 3);
  assert.equal(back.find(r2.id), r2);
  assert.equal(back.stories[sid].story.paragraphs[0].runs[0].text, "hello");
  assert.throws(() => Doc.fromJSON({ format: "other" }));
});

test("pages: add, remove, move and facing layout", () => {
  const { doc } = makeApp();
  doc.addPage();
  doc.addPage();
  assert.equal(doc.pages.length, 3);
  const [p1, p2, p3] = doc.pages;
  doc.relayoutPages(true);
  assert.equal(p1.x, p1.w); // lone right-hand page
  assert.equal(p3.x, p2.x + p2.w); // pair shares a spread
  doc.movePage(p3, 0);
  assert.equal(doc.pages[0], p3);
  doc.undo();
  assert.equal(doc.pages[0], p1);
  assert.equal(doc.removePage(doc.pages[1]), true);
  assert.equal(doc.pages.length, 2);
});

test("group, arrange, align and distribute", () => {
  const { app, doc } = makeApp();
  const root = doc.pages[0].root;
  const [a, b, c] = [rect(0, 0, 20, 20), rect(100, 50, 20, 20), rect(300, 90, 20, 20)];
  ops.addNodes(app, [a, b, c], { select: false });
  app.select([a, b, c]);
  ops.align(app, "left");
  for (const n of [a, b, c]) near(pageBounds(n).x, 0);
  ops.align(app, "top");
  for (const n of [a, b, c]) near(pageBounds(n).y, 0);
  doc.undo();
  doc.undo();
  app.select([a, b, c]);
  ops.distribute(app, "h");
  const gap1 = pageBounds(b).x - (pageBounds(a).x + 20);
  const gap2 = pageBounds(c).x - (pageBounds(b).x + 20);
  near(gap1, gap2);
  ops.arrange(app, "back");
  assert.equal(root.children.length, 3);
  app.select([a, b]);
  const g = ops.groupSelection(app);
  assert.equal(g.children.length, 2);
  assert.equal(root.children.includes(g), true);
  ops.ungroupSelection(app);
  assert.equal(root.children.some((n) => n.type === "group"), false);
});

test("duplicate, delete, copy/paste produce independent nodes", () => {
  const { app, doc } = makeApp();
  const a = rect(10, 10, 20, 20, { fill: solid("#ff0000") });
  ops.addNodes(app, a);
  const [copy] = ops.duplicateSelection(app, { offset: 12 });
  assert.notEqual(copy.id, a.id);
  copy.fill.color = "#00ff00";
  assert.equal(a.fill.color, "#ff0000");
  ops.copySelection(app);
  ops.pasteClipboard(app);
  assert.equal(doc.pages[0].root.children.length, 3);
  ops.deleteSelection(app);
  assert.equal(doc.pages[0].root.children.length, 2);
});

test("convert to curves and boolean ops on shapes", () => {
  const { app, doc } = makeApp();
  const a = rect(0, 0, 100, 100);
  const e = createNode("ellipse", { w: 100, h: 100, m: translate(50, 0) });
  ops.addNodes(app, [a, e], { select: false });
  app.select([a]);
  ops.convertToCurves(app);
  assert.equal(a.type, "path");
  assert.equal(a.w, undefined);
  app.select([a, e]);
  assert.equal(ops.booleanOp(app, "subtract"), true);
  const res = doc.pages[0].root.children;
  assert.equal(res.length, 1);
  assert.equal(res[0].type, "path");
  const b = pageBounds(res[0]);
  near(b.x, 0, 0.1);
  assert.ok(b.w < 150);
});

test("applyPageDelta bakes scale into rects and keeps rotation in the matrix", () => {
  const { app } = makeApp();
  const r = rect(100, 100, 50, 20, { m: mul(translate(100, 100), rotate(Math.PI / 6)) });
  ops.addNodes(app, r);
  const snap = captureTransform(r);
  // scale handles work in the object's own frame: D = W · S · W⁻¹ (skew free for rotated objects)
  const W = worldMatrix(r);
  applyPageDelta(r, mul(W, mul(scale(2, 3), invert(W))), snap);
  near(r.w, 100, 1e-6);
  near(r.h, 60, 1e-6);
  const d = decompose(r.m);
  near(d.sx, 1);
  near(d.sy, 1);
  // groups keep the scale in their matrix instead
  const g = createNode("group");
  g.children.push(rect(0, 0, 10, 10));
  ops.addNodes(app, g);
  const gs = captureTransform(g);
  applyPageDelta(g, scale(2, 2), gs);
  near(decompose(g.m).sx, 2);
});

test("display list compiler: shapes, strokes, groups, opacity, effects, adjustments", () => {
  const { doc } = makeApp();
  const root = doc.pages[0].root;
  const plain = rect(0, 0, 10, 10, { fill: solid("#ff0000") });
  const faded = rect(20, 0, 10, 10, { fill: solid("#00ff00"), opacity: 0.5 });
  const shadow = createNode("ellipse", { w: 10, h: 10, fill: solid("#0000ff"), fx: [{ type: "dropShadow", enabled: true, color: "#000000", alpha: 0.5, blur: 4, dx: 0, dy: 2 }] });
  const inside = rect(40, 0, 10, 10, { fill: solid("#000000"), stroke: { ...defaultStroke("#ffffff", 4), align: "inside" } });
  const adj = createNode("adjust", { effect: { group: "adjustment", id: "invert" } });
  for (const n of [plain, faded, shadow, inside, adj]) doc.insert(n, root);
  const dl = buildPageDL(doc, doc.pages[0]);
  assert.equal(dl.items.length, 5);
  assert.equal(dl.items[0].t, "path");
  assert.equal(dl.items[0].fill.color, "#ff0000");
  assert.equal(dl.items[1].t, "group");
  assert.equal(dl.items[1].opacity, 0.5);
  assert.equal(dl.items[2].fx.length, 1);
  assert.equal(dl.items[3].t, "group"); // fill + clipped doubled stroke
  assert.equal(dl.items[3].items[1].clip.rule, "nonzero");
  assert.equal(dl.items[4].t, "adjust");
  // cache: unchanged nodes reuse their items; a change rebuilds only that node
  const again = buildPageDL(doc, doc.pages[0]);
  assert.equal(again.items[0], dl.items[0]);
  doc.set(plain, { w: 99 });
  assert.notEqual(buildPageDL(doc, doc.pages[0]).items[0], dl.items[0]);
});

test("nested children are clipped and do not grow the bounds of painted parents", () => {
  const { doc } = makeApp();
  const parent = rect(0, 0, 100, 100, { fill: solid("#ffffff") });
  const child = rect(80, 80, 100, 100, { fill: solid("#ff0000") });
  parent.children = [child];
  doc.insert(parent, doc.pages[0].root);
  assert.deepEqual(localBounds(parent), { x: 0, y: 0, w: 100, h: 100 });
  const dl = buildPageDL(doc, doc.pages[0]);
  assert.equal(dl.items[0].t, "group");
  assert.ok(dl.items[0].items.some((i) => i.t === "group" && i.clip));
  const grp = createNode("group");
  grp.children = [rect(0, 0, 10, 10), rect(50, 50, 10, 10)];
  assert.deepEqual(localBounds(grp), { x: 0, y: 0, w: 60, h: 60 });
  assert.deepEqual(worldMatrix(parent).slice(4), [0, 0]);
});

test("color helpers", () => {
  assert.deepEqual(parseColor("#f80"), { r: 255, g: 136, b: 0, a: 1 });
  assert.equal(toHex6("rgba(10, 20, 30, 0.5)"), "#0a141e");
  const hsv = rgbToHsv(255, 0, 0);
  assert.deepEqual(hsvToRgb(hsv.h, hsv.s, hsv.v), { r: 255, g: 0, b: 0 });
  const hsl = rgbToHsl(0, 128, 255);
  const back = hslToRgb(hsl.h, hsl.s, hsl.l);
  assert.ok(Math.abs(back.g - 128) <= 1 && back.b === 255);
});

test("clone/equal ignore runtime keys", () => {
  const a = { x: 1, _tmp: {}, n: [1, { y: 2 }] };
  const b = clone(a);
  assert.equal(b._tmp, undefined);
  assert.ok(equal(a, { x: 1, n: [1, { y: 2 }] }));
});
