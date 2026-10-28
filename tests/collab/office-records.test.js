// Office Suite live editing: keyed last-writer-wins records converge in any order.
import test from "node:test";
import assert from "node:assert/strict";
import { RecordsCRDT, validateRecordOp } from "../../app/src/collab/office-records.js";

test("concurrent edits converge; different records merge, same record goes to the higher clock/site", () => {
  const base = { "cell:A1": 1, "cell:A2": 2 };
  const a = RecordsCRDT.fromRecords(base, "a");
  const b = RecordsCRDT.fromRecords(base, "b");
  const opsA = a.applyLocal(a.diff({ "cell:A1": 10, "cell:A2": 2, "cell:B1": "x" }));
  const opsB = b.applyLocal(b.diff({ "cell:A1": 20 })); // also deletes A2
  for (const op of opsB) a.apply(validateRecordOp(op));
  for (const op of [...opsA].reverse()) b.apply(validateRecordOp(op));
  assert.deepEqual(a.view(), b.view());
  assert.equal(a.view()["cell:A1"], 20, "same clock: site b > a wins");
  assert.equal(a.view()["cell:A2"], undefined);
  assert.equal(a.view()["cell:B1"], "x");
  // idempotent
  for (const op of opsA) assert.equal(b.apply(op).changed, false);
});

test("state round trip, changesTo and validation", () => {
  const a = RecordsCRDT.fromRecords({ k: 1 }, "a");
  a.applyLocal([{ k: "k", v: 2 }]);
  const b = RecordsCRDT.fromJSON(JSON.parse(JSON.stringify(a.toJSON())), "b");
  assert.deepEqual(b.view(), { k: 2 });
  assert.deepEqual(b.changesTo({ k: 1, z: 0 }), { k: 2, z: null });
  assert.throws(() => validateRecordOp({ k: "__proto__", c: 1, s: "a" }), /key/);
  assert.throws(() => validateRecordOp({ k: "k", c: -1, s: "a" }), /clock/);
  assert.throws(() => validateRecordOp({ k: "k", c: 1, s: "a", v: "x".repeat(70000) }), /large/);
  const r = a.apply({ k: "k", v: 3, c: 99, s: "z" });
  assert.deepEqual(r.overwrote, { site: "a", c: 1 });
});
