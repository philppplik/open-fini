import test from "node:test";
import assert from "node:assert/strict";
import {
  rectPath, ellipsePath, polygonPath, starPath, pathBBox, flattenPath, pathToData, dataToPath,
  svgDToPath, pathToSvgD, nearestOnPath, insertNodeAt, nodeCount, transformPath, pathLength,
} from "../../app/src/engine/vector/path.js";
import { fitSubpath } from "../../app/src/engine/vector/fit.js";
import { booleanPaths, expandStroke } from "../../app/src/engine/vector/boolean.js";
import * as M from "../../app/src/core/math.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test("rectPath has exact bounds with and without radii", () => {
  for (const r of [0, 8, [4, 0, 12, 20]]) {
    const b = pathBBox(rectPath(100, 60, r));
    near(b.x, 0); near(b.y, 0); near(b.w, 100); near(b.h, 60);
  }
  assert.equal(nodeCount(rectPath(10, 10, 0)), 4);
  assert.equal(nodeCount(rectPath(10, 10, 3)), 8);
});

test("ellipse bbox and area from flattening", () => {
  const e = ellipsePath(100, 60);
  const b = pathBBox(e);
  near(b.w, 100, 1e-3); near(b.h, 60, 1e-3);
  const f = flattenPath(e, 0.01)[0].pts;
  let a = 0;
  for (let i = 0; i < f.length; i += 2) {
    const j = (i + 2) % f.length;
    a += f[i] * f[j + 1] - f[j] * f[i + 1];
  }
  near(Math.abs(a) / 2, Math.PI * 50 * 30, 15);
});

test("polygon and star fit their box", () => {
  for (const p of [polygonPath(80, 70, 6, 0), starPath(80, 80, 5, 0.4, 0)]) {
    const b = pathBBox(p);
    near(b.x, 0, 1e-6); near(b.y, 0, 1e-6); near(b.w, 80, 1e-3);
  }
  // rounding shaves the corners, so the outline sits inside the box
  const r = pathBBox(polygonPath(80, 70, 5, 6));
  assert.ok(r.x >= 0 && r.w <= 80 && r.w > 70);
});

test("svg path round trip incl. arcs and relative commands", () => {
  const p = svgDToPath("M10 10 h20 v20 h-20 z M50 50 a10 10 0 1 1 20 0 a10 10 0 1 1 -20 0z");
  assert.equal(p.subpaths.length, 2);
  assert.ok(p.subpaths[0].closed);
  const b = pathBBox(p);
  near(b.x, 10); near(b.y, 10);
  const circle = svgDToPath("M50 50 a10 10 0 1 1 20 0 a10 10 0 1 1 -20 0z");
  const cb = pathBBox(circle);
  near(cb.w, 20, 1e-3); near(cb.h, 20, 1e-3);
  const d = pathToSvgD(rectPath(10, 10, 0));
  assert.match(d, /^M0 0/);
  assert.deepEqual(pathToData(dataToPath(pathToData(rectPath(10, 10, 2)))), pathToData(rectPath(10, 10, 2)));
});

test("insertNodeAt keeps the curve shape", () => {
  const p = ellipsePath(100, 100);
  const before = pathBBox(p);
  const hit = nearestOnPath(p, 50, 0);
  assert.ok(hit.d < 1e-3);
  insertNodeAt(p, 0, hit.seg, 0.5);
  assert.equal(p.subpaths[0].nodes.length, 5);
  const after = pathBBox(p);
  near(before.w, after.w, 1e-6);
  near(pathLength(p, 0.01), Math.PI * 100, 0.5);
});

test("transformPath moves handles too", () => {
  const p = transformPath(ellipsePath(10, 10), M.scale(2, 3));
  const b = pathBBox(p);
  near(b.w, 20, 1e-6); near(b.h, 30, 1e-6);
});

test("curve fitting recovers a circle with few nodes and keeps corners", () => {
  const pts = [];
  for (let i = 0; i < 120; i++) pts.push([50 + 40 * Math.cos((i / 120) * Math.PI * 2), 50 + 40 * Math.sin((i / 120) * Math.PI * 2)]);
  const s = fitSubpath(pts, { closed: true, tolerance: 0.3 });
  assert.ok(s.nodes.length <= 10, `nodes: ${s.nodes.length}`);
  const b = pathBBox({ subpaths: [s] });
  near(b.w, 80, 0.6);
  const sq = fitSubpath([[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]], { closed: true });
  assert.equal(sq.nodes.length, 4);
  assert.ok(sq.nodes.every((n) => n.ox == null && n.ix == null));
});

test("boolean union/subtract/intersect/xor areas", () => {
  const A = { path: rectPath(100, 100), rule: "nonzero" };
  const B = { path: transformPath(rectPath(100, 100), M.translate(50, 50)), rule: "nonzero" };
  const area = (p) => {
    let tot = 0;
    for (const f of flattenPath(p, 0.01)) {
      let a = 0;
      const q = f.pts;
      for (let i = 0; i < q.length; i += 2) {
        const j = (i + 2) % q.length;
        a += q[i] * q[j + 1] - q[j] * q[i + 1];
      }
      tot += a / 2;
    }
    return Math.abs(tot);
  };
  const outer = (op) => booleanPaths(op, [A, B])[0];
  near(area(outer("union")), 17500, 1);
  near(area(outer("subtract")), 7500, 1);
  near(area(outer("intersect")), 2500, 1);
  near(area(outer("xor")), 15000, 1);
  const pieces = booleanPaths("divide", [A, B]);
  assert.equal(pieces.length, 3);
  assert.equal(booleanPaths("intersect", [A, { path: transformPath(rectPath(10, 10), M.translate(500, 500)), rule: "nonzero" }]).length, 0);
});

test("boolean on circles stays curved and compact", () => {
  const C1 = { path: ellipsePath(100, 100) };
  const C2 = { path: transformPath(ellipsePath(100, 100), M.translate(60, 0)) };
  const u = booleanPaths("union", [C1, C2])[0];
  const b = pathBBox(u);
  near(b.w, 160, 0.5);
  assert.ok(nodeCount(u) < 30, `nodeCount ${nodeCount(u)}`);
  assert.ok(u.subpaths[0].nodes.some((n) => n.ox != null));
});

test("expandStroke produces an outline whose bounds match width", () => {
  const line = { subpaths: [{ closed: false, nodes: [{ x: 0, y: 0, ix: null, iy: null, ox: null, oy: null }, { x: 100, y: 0, ix: null, iy: null, ox: null, oy: null }] }] };
  const o = expandStroke(line, { width: 10, cap: "butt" });
  const b = pathBBox(o);
  near(b.w, 100, 1e-6); near(b.h, 10, 1e-6);
  const rc = expandStroke(line, { width: 10, cap: "round" });
  near(pathBBox(rc).w, 110, 0.1);
  const dashed = expandStroke(line, { width: 4, cap: "butt", dash: [10, 10] });
  assert.equal(dashed.subpaths.length, 5);
});

test("matrix helpers", () => {
  const m = M.mulAll(M.translate(10, 20), M.rotate(Math.PI / 6), M.scale(2, 3));
  const inv = M.invert(m);
  const [x, y] = M.apply(inv, ...M.apply(m, 7, -3));
  near(x, 7); near(y, -3);
  const d = M.decompose(m);
  near(d.sx, 2); near(d.sy, 3); near(d.rotation, Math.PI / 6); near(d.tx, 10);
  const back = M.compose(d);
  for (let i = 0; i < 6; i++) near(back[i], m[i]);
});
