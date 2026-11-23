// Proto documents in the .ofini container (docs/file-format.md ▸ Proto, task T1): an empty and a sample design are
// written and read back through the CLI's project layer, checked by the Doctor, and recognized by `ofini info`,
// `ofini validate`, `ofini formats` and `ofini extract --text`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "../../app/vendor/fflate/fflate.js";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { diagnoseFile } from "../../app/src/core/doctor/file.js";
import { readOfini, writeOfini } from "../../cli/lib/project.mjs";
import { projectText, formatsFor } from "../../cli/lib/export.mjs";
import { main } from "../../cli/lib/main.mjs";
import * as S from "../../app/src/engine/proto/schema.js";
import { loadModel, storeModel, MEDIA_DIR } from "../../app/src/engine/proto/format.js";
import { stringify } from "../../app/src/engine/proto/serialize.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/schema-1/sample.json", import.meta.url), "utf8"));
// a 1×1 PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

function protoDoc(model, title = "Design") {
  const doc = new Doc({ name: title, studio: "proto", width: 1280, height: 800, pages: 1 });
  doc.office = new OfficeProject(storeModel(model), S.KIND);
  return doc;
}
const withMedia = () => ({ ...structuredClone(SAMPLE), media: { m3: { ...SAMPLE.media.m3, bytes: PNG } } });

let dir;
before(() => (dir = mkdtempSync(join(tmpdir(), "ofini-proto-"))));
after(() => rmSync(dir, { recursive: true, force: true }));

function sink() {
  const chunks = [];
  return { isTTY: false, write: (s) => (chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8")), true), text: () => chunks.join("") };
}
async function ofini(...argv) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { stdout, stderr, env: {}, cwd: dir, tmpdir: dir });
  return { code, out: stdout.text(), err: stderr.text() };
}

test("an empty and a sample design survive save and load through .ofini", () => {
  for (const model of [S.emptyDocument({ title: "Empty", created: "2026-01-01T00:00:00Z" }), withMedia()]) {
    const bytes = writeOfini(protoDoc(model));
    const zip = unzipSync(bytes);
    const json = JSON.parse(strFromU8(zip["document.json"]));
    assert.equal(json.studio, "proto");
    assert.equal(json.office.kind, "proto");
    assert.equal(json.version, 2, "a kind other than document stamps version 2");
    const { doc } = readOfini(bytes, "x.ofini");
    assert.equal(doc.office.kind, "proto");
    assert.equal(doc.studio, "proto");
    const r = loadModel(doc.office.model);
    assert.deepEqual(r.errors, []);
    assert.equal(r.readOnly, false);
    assert.deepEqual(r.model, model);
  }
  const zip = unzipSync(writeOfini(protoDoc(withMedia())));
  assert.deepEqual([...zip[`${MEDIA_DIR}m3.png`]], [...PNG]);
});

test("the stored model is canonical, so saving twice gives the same design JSON", () => {
  const shuffled = Object.fromEntries(Object.entries(withMedia()).reverse());
  const a = JSON.parse(strFromU8(unzipSync(writeOfini(protoDoc(withMedia())))["document.json"])).office;
  const b = JSON.parse(strFromU8(unzipSync(writeOfini(protoDoc(shuffled)))["document.json"])).office;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const { kind, ...rest } = a;
  assert.equal(kind, "proto");
  assert.equal(stringify(loadModel(rest).model), stringify(SAMPLE));
});

test("the Doctor validates the design and summarizes it", () => {
  const ok = diagnoseFile(writeOfini(protoDoc(withMedia())), { name: "d.ofini" });
  assert.equal(ok.counts.error, 0, JSON.stringify(ok.findings));
  assert.equal(ok.info.kind, "proto");
  assert.equal(ok.info.proto.nodes, 14);
  assert.equal(ok.info.proto.components, 4);
  const broken = withMedia();
  broken.nodes.n2.opacity = 9;
  broken.nodes.n5.of = "n404";
  const bad = diagnoseFile(writeOfini(protoDoc(broken)), { name: "d.ofini" });
  assert.ok(bad.counts.error >= 2);
  assert.ok(bad.findings.some((f) => f.code === "proto-invalid" && f.params.where === "nodes.n2.opacity"));
  const newer = diagnoseFile(writeOfini(protoDoc({ ...withMedia(), schema: 7 })), { name: "d.ofini" });
  assert.equal(newer.counts.error, 0);
  assert.ok(newer.findings.some((f) => f.code === "proto-newer"));
  const unreadable = diagnoseFile(writeOfini(protoDoc({ title: "no schema", nodes: {} })), { name: "d.ofini" });
  assert.ok(unreadable.findings.some((f) => f.code === "proto-invalid"));
});

test("ofini info, validate, formats and extract recognize Proto documents", async () => {
  writeFileSync(join(dir, "empty.ofini"), writeOfini(protoDoc(S.emptyDocument({ title: "Empty" }))));
  writeFileSync(join(dir, "sample.ofini"), writeOfini(protoDoc(withMedia(), "Checkout")));
  const broken = withMedia();
  broken.nodes.n2.opacity = 9;
  writeFileSync(join(dir, "broken.ofini"), writeOfini(protoDoc(broken)));

  const info = await ofini("info", "sample.ofini", "--json");
  assert.equal(info.code, 0, info.err);
  const i = JSON.parse(info.out).info;
  assert.equal(i.kind, "proto");
  assert.equal(i.studio, "proto");
  assert.deepEqual([i.proto.pages, i.proto.frames, i.proto.variables, i.proto.flows], [2, 2, 7, 1]);
  const text = await ofini("info", "sample.ofini");
  assert.match(text.out, /kind\s+proto/);
  assert.match(text.out, /design\s+2 pages, 2 frames, 14 layers, 4 components, 2 instances \(Proto schema 1\)/);
  assert.match(text.out, /tokens\s+7 variables in 3 collections, 2 styles, 1 flow/);

  for (const f of ["empty.ofini", "sample.ofini"]) {
    const v = await ofini("validate", f, "--json");
    assert.equal(v.code, 0, v.out);
    assert.equal(JSON.parse(v.out).ok, true);
  }
  const v = await ofini("validate", "broken.ofini");
  assert.equal(v.code, 1);
  assert.match(v.out, /Proto design, nodes\.n2\.opacity: Expected a number from 0 to 1\./);

  const formats = await ofini("formats", "sample.ofini", "--json");
  assert.equal(JSON.parse(formats.out).kind, "proto");
  assert.deepEqual(JSON.parse(formats.out).formats.map((x) => x.id), ["ofini", "json"]);

  const { doc } = readOfini(readFileSync(join(dir, "sample.ofini")), "sample.ofini");
  assert.deepEqual(formatsFor(doc).map((x) => x.id), ["ofini", "json"]);
  assert.equal(await projectText(doc), "Total $42.00\nButton");
  const ex = await ofini("extract", "sample.ofini", "--text");
  assert.equal(ex.code, 0, ex.err);
  assert.match(ex.out, /Total \$42\.00/);
  // a copy written by the CLI keeps the design unchanged
  const conv = await ofini("convert", "sample.ofini", "copy.ofini");
  assert.equal(conv.code, 0, conv.err);
  const copy = readOfini(readFileSync(join(dir, "copy.ofini")), "copy.ofini").doc;
  assert.deepEqual(loadModel(copy.office.model).model, withMedia());
});
