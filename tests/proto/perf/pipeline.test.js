// Performance of the pure renderer pipeline on the 5,000-layer fixture (docs/concepts/proto-studio.md §4.3, task T3):
// resolve → css.js → render description → keyed patch plan, for a first render and for a property edit. The browser
// numbers (frame times while panning, edit to paint, first paint) come from scripts/proto-perf.mjs; this test keeps the
// pure part honest in CI with generous limits (CI machines are slow and shared) and prints what it measured.
import test from "node:test";
import assert from "node:assert/strict";
import { perfDesign } from "./fixture.js";
import { validate } from "../../../app/src/engine/proto/validate.js";
import { apply } from "../../../app/src/engine/proto/ops.js";
import { createResolver } from "../../../app/src/engine/proto/resolve.js";
import { treeCss } from "../../../app/src/engine/proto/css.js";
import { indexOf, pageKey } from "../../../app/src/engine/proto/tree.js";
import { changedRoots, entriesFor, planPatch } from "../../../app/src/proto/patch.js";

const ms = (t0) => Math.round((performance.now() - t0) * 10) / 10;

function describe(model, ids) {
  const r = createResolver(model);
  const out = new Map();
  for (const id of ids) {
    const tree = r.tree(id);
    out.set(id, entriesFor(tree, treeCss(tree, { resolver: r, model, vars: "css", root: "origin" })));
  }
  return out;
}

test("the 5,000-layer fixture is valid and the pipeline is fast enough", () => {
  const { model, page, nodes } = perfDesign({ frames: 50 });
  assert.equal(nodes, 5000);
  const v = validate(model);
  assert.deepEqual(v.errors.slice(0, 3), [], "the fixture is a valid design");
  const roots = indexOf(model).get(pageKey(page));
  assert.equal(roots.length, 50);

  // first render: every frame
  let t0 = performance.now();
  const first = describe(model, roots);
  let ops = 0;
  for (const [, e] of first) ops += planPatch(null, e).length;
  const firstMs = ms(t0);

  // a property edit: one fill in one frame
  const target = Object.values(model.nodes).find((n) => n.name === "Badge" && n.page === page);
  const edited = apply(model, { op: "node.update", id: target.id, set: { fills: [{ type: "solid", color: "#000000" }] } }).model;
  t0 = performance.now();
  const ch = changedRoots(model, edited, page);
  const again = describe(edited, [...ch.roots]);
  const plan = planPatch(first.get([...ch.roots][0]), again.get([...ch.roots][0]));
  const editMs = ms(t0);

  assert.deepEqual([...ch.roots].length, 1, "one frame is re-resolved");
  assert.deepEqual(plan.map((o) => o.t), ["style"], "one element is patched");
  console.log(`proto pipeline, 5,000 layers: first render ${firstMs} ms (${ops} DOM operations planned), property edit ${editMs} ms`);
  assert.ok(firstMs < 3000, `first render took ${firstMs} ms`);
  assert.ok(editMs < 100, `a property edit took ${editMs} ms`);
});
