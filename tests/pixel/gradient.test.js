import test from "node:test";
import assert from "node:assert/strict";
import { gradientParam, fillGradient } from "../../app/src/engine/pixel/gradient.js";

const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test("linear, reflected and radial parameters", () => {
  close(gradientParam("linear", [0, 0], [10, 0], 5, 3), 0.5);
  close(gradientParam("linear", [0, 0], [10, 0], -4, 0), 0);
  close(gradientParam("reflected", [10, 10], [20, 10], 5, 40), 0.5);
  close(gradientParam("reflected", [10, 10], [20, 10], 15, 0), 0.5);
  close(gradientParam("radial", [0, 0], [10, 0], 0, 5), 0.5);
  close(gradientParam("radial", [0, 0], [10, 0], 30, 30), 1);
});

test("diamond and angular follow the drag direction", () => {
  close(gradientParam("diamond", [0, 0], [10, 0], 5, 0), 0.5);
  close(gradientParam("diamond", [0, 0], [10, 0], 2.5, 2.5), 0.5);
  close(gradientParam("diamond", [0, 0], [0, 10], 2.5, 2.5), 0.5);
  close(gradientParam("conic", [0, 0], [10, 0], 5, 0), 0);
  close(gradientParam("conic", [0, 0], [10, 0], 0, 5), 0.25);
  close(gradientParam("conic", [0, 0], [10, 0], -5, 0), 0.5);
});

test("fillGradient interpolates colors including alpha", () => {
  const out = fillGradient(4, 1, "linear", [0, 0], [4, 0], "#000000", "#ff000000");
  assert.ok(out[3] > 200);
  assert.ok(out[4 * 3 + 3] < out[3]);
  assert.ok(out[4 * 3] > out[0]);
});
