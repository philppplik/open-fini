// Snapping and smart guides of the Proto Studio tools (task T4, app/src/proto/tools/snap.js).
import test from "node:test";
import assert from "node:assert/strict";
import { snapTargets, snapRect, edgesFor, distances, roundRect } from "../../app/src/proto/tools/snap.js";

const R = (x, y, w, h) => ({ x, y, w, h });

test("snapRect snaps the nearest edge or center within the tolerance", () => {
  const t = snapTargets([R(100, 0, 50, 50)]);
  // left edge 97 → 100
  let s = snapRect(R(97, 80, 20, 20), t, 5);
  assert.equal(s.dx, 3);
  assert.equal(s.dy, 0);
  assert.ok(s.guides.some((g) => g.axis === "x" && g.v === 100 && g.from === 0 && g.to === 100));
  // center 126 → 125
  s = snapRect(R(116, 80, 20, 20), t, 5);
  assert.equal(s.dx, -1);
  // too far: no snap, no guides on that axis
  s = snapRect(R(60, 200, 20, 20), t, 5);
  assert.deepEqual([s.dx, s.dy, s.guides.length], [0, 0, 0]);
  // bottom edge 52 → 50
  s = snapRect(R(0, 32, 20, 20), t, 5);
  assert.equal(s.dy, -2);
});

test("snapRect with resize edges only moves those edges", () => {
  const t = snapTargets([R(100, 0, 50, 50)]);
  const e = edgesFor("e");
  assert.deepEqual(e, { x: ["end"], y: [] });
  const s = snapRect(R(0, 0, 98, 10), t, 5, e);
  assert.equal(s.dx, 2);
  assert.equal(s.dy, 0);
  assert.deepEqual(edgesFor("nw"), { x: ["start"], y: ["start"] });
  assert.equal(snapRect(R(97, 0, 10, 10), t, 5, { x: [], y: [] }).dx, 0);
});

test("distances to the nearest neighbors and to the parent", () => {
  const parent = R(0, 0, 300, 200);
  const d = distances(R(100, 50, 50, 50), [R(10, 60, 40, 20), R(200, 0, 20, 300)], parent);
  const by = Object.fromEntries(d.map((x) => [x.side, x.value]));
  assert.equal(by.left, 50);
  assert.equal(by.right, 50);
  assert.equal(by.top, 50); // parent edge
  assert.equal(by.bottom, 100);
  assert.deepEqual(distances(R(0, 0, 10, 10), [], null), []);
});

test("roundRect puts a rect on the pixel grid", () => {
  assert.deepEqual(roundRect(R(1.4, 2.6, 10.5, 0.2)), R(1, 3, 11, 0));
});
