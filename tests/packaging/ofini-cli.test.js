import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../../app/vendor/fflate/fflate.js";
import { run, inspect } from "../../scripts/ofini.mjs";

const doc = {
  format: "openfini",
  version: 2,
  name: "Poster",
  studio: "vector",
  unit: "px",
  pages: [{ id: "p1", name: "Page 1", w: 1080, h: 1350, children: [{ id: "a", type: "rect" }, { id: "g", type: "group", children: [{ id: "t", type: "text" }, { id: "r2", type: "rect" }] }] }],
  assets: { img1: { id: "img1", mime: "image/png", name: "logo.png" } },
};
const ofini = (json, extra = {}) => zipSync({ mimetype: strToU8("application/vnd.openfini+zip"), "document.json": strToU8(JSON.stringify(json)), ...extra });

test("info summarizes pages, layers and assets", () => {
  const r = inspect(ofini(doc, { "assets/img1.png": new Uint8Array([1]) }), "poster.ofini");
  assert.deepEqual(r.errors, []);
  assert.equal(r.info.title, "Poster");
  assert.deepEqual(r.info.pages, [{ name: "Page 1", width: 1080, height: 1350 }]);
  assert.deepEqual(r.info.layers, { total: 4, byType: { rect: 2, group: 1, text: 1 } });
  const files = { "x.ofini": ofini(doc, { "assets/img1.png": new Uint8Array([1]) }) };
  const out = run(["info", "x.ofini"], { readFile: (f) => files[f] });
  assert.equal(out.code, 0);
  assert.match(out.out, /1 page\(s\): 1080×1350/);
  assert.match(out.out, /4 layer\(s\): 2 rect/);
});

test("validate reports errors with exit code 1 and warnings with 0", () => {
  const files = {
    "ok.ofini": ofini(doc),
    "bad.ofini": new Uint8Array([1, 2, 3]),
    "nojson.ofini": zipSync({ mimetype: strToU8("application/vnd.openfini+zip") }),
    "nopages.ofini": ofini({ ...doc, pages: [] }),
  };
  const readFile = (f) => {
    if (!files[f]) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files[f];
  };
  const ok = run(["validate", "ok.ofini"], { readFile });
  assert.equal(ok.code, 0);
  assert.match(ok.out, /ok \(1 warning/, "the asset without bytes is a warning");
  assert.equal(run(["validate", "bad.ofini"], { readFile }).code, 1);
  assert.match(run(["validate", "nojson.ofini", "--json"], { readFile }).out, /document\.json\) is missing/);
  assert.equal(JSON.parse(run(["validate", "nopages.ofini", "--json"], { readFile }).out).ok, false);
  assert.equal(run(["validate", "gone.ofini"], { readFile }).code, 1);
  assert.equal(run(["frobnicate", "x"]).code, 2);
  assert.equal(run([]).code, 2);
  assert.equal(run(["--version"], { version: "1.2.3" }).out, "ofini 1.2.3");
});
