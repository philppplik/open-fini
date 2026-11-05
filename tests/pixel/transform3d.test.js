import { test } from "node:test";
import assert from "node:assert/strict";
import { projectRect, homography, applyH, meshFromQuad, warpMesh, pointsBounds } from "../../app/src/engine/pixel/transform3d.js";
import { runJob } from "../../app/src/core/workers/jobs.js";

const img = (w, h, f) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("projectRect: no rotation keeps the rectangle; rotateZ 90 swaps it; rotateY makes one side shorter", () => {
  const q = projectRect(40, 20);
  assert.deepEqual(q.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)), [[0, 0], [40, 0], [40, 20], [0, 20]]);
  const z = projectRect(40, 20, { rotateZ: 90 });
  near(z[0][0], 30); near(z[0][1], -10);
  const y = projectRect(40, 20, { rotateY: 40, distance: 1.5 });
  const left = y[3][1] - y[0][1], right = y[2][1] - y[1][1];
  assert.ok(Math.abs(left - right) > 1, "perspective foreshortens one side");
  const sk = projectRect(40, 20, { skewX: 45 });
  near(sk[3][0] - sk[0][0], 20, 1e-9);
});

test("homography maps the four points and round-trips", () => {
  const from = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const to = [[2, 1], [14, 3], [12, 15], [-1, 9]];
  const H = homography(from, to);
  for (let i = 0; i < 4; i++) {
    const [u, v] = applyH(H, ...from[i]);
    near(u, to[i][0], 1e-9); near(v, to[i][1], 1e-9);
  }
  assert.equal(homography(from, [[0, 0], [0, 0], [0, 0], [0, 0]]), null);
});

test("meshFromQuad and pointsBounds", () => {
  const m = meshFromQuad([[0, 0], [10, 0], [10, 10], [0, 10]], 2);
  assert.equal(m.length, 9);
  assert.deepEqual(m[4], [5, 5]);
  assert.deepEqual(pointsBounds([[0.5, -1.2], [3.1, 2]]), { x: 0, y: -2, w: 4, h: 4 });
});

test("warpMesh: identity keeps pixels, a translated corner pin moves them, a 2x2 mesh matches the 1x1 pin", () => {
  const src = img(8, 6, (x, y) => [x * 30, y * 40, 0, 255]);
  const id = warpMesh(src, 1, meshFromQuad([[0, 0], [8, 0], [8, 6], [0, 6]]), { filter: "nearest" });
  assert.equal(id.x, 0); assert.equal(id.img.width, 8);
  assert.deepEqual([...id.img.data], [...src.data]);
  const moved = warpMesh(src, 1, meshFromQuad([[3, 2], [11, 2], [11, 8], [3, 8]]), { filter: "nearest" });
  assert.equal(moved.x, 3); assert.equal(moved.y, 2);
  assert.deepEqual([...moved.img.data.subarray(0, 8)], [...src.data.subarray(0, 8)]);
  const quad = [[0, 0], [16, 2], [14, 12], [1, 10]];
  const a = warpMesh(src, 1, meshFromQuad(quad), { filter: "bilinear" });
  const b = warpMesh(src, 2, meshFromQuad(quad, 2), { filter: "bilinear" });
  let opaque = 0;
  for (let i = 3; i < a.img.data.length; i += 4) opaque += a.img.data[i] > 0;
  assert.ok(opaque > 100);
  assert.throws(() => warpMesh(src, 2, meshFromQuad(quad)), RangeError);
  assert.equal(b.img.width, a.img.width);
});

test("pixel.warpMesh job (in-thread fallback)", async () => {
  const src = img(4, 4, () => [255, 0, 0, 255]);
  const { r } = await runJob("pixel.warpMesh", { img: src, n: 1, points: meshFromQuad(projectRect(4, 4, { rotateZ: 45 })), filter: "bicubic" });
  assert.ok(r.img.width >= 5 && r.img.data[((r.img.height >> 1) * r.img.width + (r.img.width >> 1)) * 4] > 200);
});
