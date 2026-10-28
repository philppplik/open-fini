import test from "node:test";
import assert from "node:assert/strict";
import { migrateDocumentJson, FORMAT_VERSION, MIGRATIONS, writeVersion } from "../../app/src/core/ofini-migrate.js";
import { Doc } from "../../app/src/core/doc.js";

test("the current writer stamps the oldest version that represents the file, and it reads back without notes", () => {
  const doc = new Doc({ name: "x", width: 100, height: 100 });
  const json = doc.toJSON();
  assert.equal(json.version, 1, "plain documents stay readable by 0.5 .. 0.9 without a warning");
  assert.equal(writeVersion({ office: { kind: "sheet" } }), FORMAT_VERSION);
  assert.equal(writeVersion({ office: {} }), 1);
  const r = migrateDocumentJson(JSON.parse(JSON.stringify(json)));
  assert.equal(r.from, 1);
  assert.equal(r.to, FORMAT_VERSION);
  assert.equal(r.newer, false);
  assert.deepEqual(r.notes, []);
});

// Frozen sample of a version 1 document.json (written by OpenFini 0.5): it must keep opening in every later version.
const V1 = {
  format: "openfini", version: 1, id: "d_frozen", name: "Frozen v1", dpi: 96, unit: "px", studio: "vector",
  createdAt: 1760000000000, modifiedAt: 1760000000001,
  pages: [{ id: "p_1", name: "Page 1", x: 0, y: 0, w: 400, h: 300, bg: "#ffffff", masterId: null, guides: { h: [], v: [] }, root: { id: "n_root", type: "group", name: "root", children: [] } }],
  masters: [], assets: [], stories: {}, styles: { paragraph: {}, character: {} }, swatches: [{ id: "sw0", name: "#000000", color: "#000000" }], slices: [], settings: { snap: true },
};

test("a frozen version 1 document still loads", () => {
  const r = migrateDocumentJson(JSON.parse(JSON.stringify(V1)));
  const doc = Doc.fromJSON(r.json);
  assert.equal(doc.name, "Frozen v1");
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.pages[0].root.type, "group");
});

test("files without a version (format 0) are upgraded with defaults", () => {
  const old = { format: "openfini", name: "Ancient", dpi: 72 };
  const r = migrateDocumentJson(old);
  assert.equal(r.from, 0);
  assert.equal(r.to, FORMAT_VERSION);
  assert.ok(r.notes.length >= 1);
  assert.deepEqual(r.json.pages, []);
  assert.equal(r.json.version, FORMAT_VERSION);
});

test("newer files open best-effort and are flagged, never rewritten", () => {
  const future = { ...V1, version: FORMAT_VERSION + 3, shinyNewField: { a: 1 } };
  const r = migrateDocumentJson(future);
  assert.equal(r.newer, true);
  assert.equal(r.json.version, FORMAT_VERSION + 3);
  assert.equal(r.json.shinyNewField.a, 1);
  assert.match(r.notes[0], /newer version/);
  assert.equal(Doc.fromJSON(r.json).name, "Frozen v1");
});

test("steps run in order, one version at a time", () => {
  const calls = [];
  const steps = {
    1: (j, n) => (calls.push(1), n.push("one"), { ...j, a: 1 }),
    2: (j) => (calls.push(2), { ...j, b: j.a + 1 }),
  };
  const r = migrateDocumentJson({ format: "openfini", version: 1 }, { target: 3, steps });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(r.json.b, 2);
  assert.equal(r.json.version, 3);
  assert.equal(r.to, 3);
});

test("a missing step is a clear error, not a corrupt document", () => {
  assert.throws(() => migrateDocumentJson({ format: "openfini", version: 1 }, { target: 2, steps: {} }), /No upgrade path/);
});

test("garbage is rejected with friendly errors", () => {
  assert.throws(() => migrateDocumentJson(null), /not valid/);
  assert.throws(() => migrateDocumentJson([]), /not valid/);
  assert.throws(() => migrateDocumentJson({ format: "other" }), /not an OpenFini/);
  assert.throws(() => migrateDocumentJson({ format: "openfini", version: "x" }), /version/);
  assert.throws(() => migrateDocumentJson({ format: "openfini", version: -1 }), /version/);
});

test("every version below FORMAT_VERSION has a migration step", () => {
  for (let v = 0; v < FORMAT_VERSION; v++) assert.equal(typeof MIGRATIONS[v], "function", `missing step ${v} -> ${v + 1}`);
});
