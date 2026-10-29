// Office Suite framework: registry contract, file routing, kind persistence in .ofini, document app and Vibe tools.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerOfficeApp, unregisterOfficeApp, officeApps, officeApp, appForFile, loadOfficeApp, loadedOfficeApp, officeKindOf, checkImpl, officeOpenExtensions } from "../../app/src/office/index.js";
import { OfficeProject, officeMediaDir, commitOffice } from "../../app/src/core/office.js";
import { Doc } from "../../app/src/core/doc.js";
import { migrateDocumentJson } from "../../app/src/core/ofini-migrate.js";
import { OFFICE_ONLY_EXTS, detectOfficeFormat, officeGuidance } from "../../app/src/engine/office/index.js";
import { canSaveAsSource } from "../../app/src/core/source-format.js";
import { officeSuiteTools } from "../../app/src/vibe/tools/office-suite.js";
import { officeSummary } from "../../app/src/office/ai.js";
import { menuVisible } from "../../app/src/ui/menubar-select.js";
import * as M from "../../app/src/engine/office/model.js";

const sheetImpl = {
  create: () => ({ cells: {} }),
  mount: () => ({}),
  open: async (bytes) => ({ model: { cells: { A1: new TextDecoder().decode(bytes) } } }),
  save: async (model) => ({ bytes: new TextEncoder().encode(model.cells.A1 || "") }),
  describe: (m) => ({ cells: Object.keys(m.cells).length }),
  collabAdapter: { records: (m) => ({ ...m.cells }), applyRecords: (m, ch) => ({ cells: { ...m.cells, ...ch } }) },
};
const SHEET = { kind: "test-sheet", label: "Test sheet", icon: "table", order: 20, formats: [{ id: "tcsv", label: "Test CSV", ext: ["tcsv"], read: true, write: true }], templates: [{ id: "budget", label: "Budget" }], aiNote: "note", load: async () => ({ default: sheetImpl }) };

test("the document app is registered from the manifest and its impl loads lazily", async () => {
  assert.equal(officeApp("document").label, "Document");
  assert.equal(appForFile("Letter.DOCX").app.kind, "document");
  assert.equal(appForFile("form.dotx").format.template, true);
  assert.equal(appForFile("a.fodt").format.id, "odt");
  assert.equal(appForFile("x.doc"), null, "legacy .doc keeps the convert-first dialog");
  assert.equal(loadedOfficeApp("document"), null);
  const impl = await loadOfficeApp("document");
  assert.equal(typeof impl.mount, "function");
  assert.equal(loadedOfficeApp("document"), impl);
  const model = await impl.create({ template: "invoice", title: "Inv" });
  assert.ok(model.blocks.some((b) => b.type === "table"));
  assert.equal(impl.describe(model).kind, "document");
});

test("registry: validation, ordering, duplicate extensions, unregister", async () => {
  assert.throws(() => registerOfficeApp({ kind: "X", label: "x", load() {} }), /invalid kind/);
  assert.throws(() => registerOfficeApp({ kind: "nolabel", load() {} }), /label/);
  assert.throws(() => registerOfficeApp({ kind: "noload", label: "x" }), /load/);
  assert.throws(() => registerOfficeApp({ kind: "dupe", label: "x", load() {}, formats: [{ id: "d", ext: ["docx"], read: true }] }), /already opened/);
  registerOfficeApp(SHEET);
  try {
    assert.throws(() => registerOfficeApp(SHEET), /already registered/);
    assert.deepEqual(officeApps().map((m) => m.kind).slice(0, 3), ["document", "sheet", "test-sheet"], "same order: registration order");
    assert.ok(officeOpenExtensions().includes("tcsv"));
    assert.equal(appForFile("b.tcsv").app.kind, "test-sheet");
    const impl = await loadOfficeApp("test-sheet");
    assert.equal(impl, sheetImpl);
    assert.throws(() => checkImpl("bad", { default: { create() {} } }), /mount/);
    assert.throws(() => checkImpl("bad", { create() {}, mount() {}, collabAdapter: {} }), /records/);
  } finally {
    unregisterOfficeApp("test-sheet");
  }
  assert.equal(officeApp("test-sheet"), null);
});

test("kind persistence: additive field, own media folder, version 2 only for other kinds", () => {
  const doc = new Doc({ name: "S", studio: "office" });
  doc.office = new OfficeProject({ cells: { A1: 1 }, media: { m1: { id: "m1", mime: "image/png", bytes: new Uint8Array([1, 2]) } } }, "sheet");
  const json = JSON.parse(JSON.stringify(doc.toJSON()));
  assert.equal(json.office.kind, "sheet");
  assert.equal(json.version, 2, "old readers must see a sheet as a newer file");
  assert.equal(officeMediaDir("sheet"), "office/sheet/media/");
  const entries = doc.office.entries();
  assert.deepEqual(Object.keys(entries), ["office/sheet/media/m1.png"]);
  const back = OfficeProject.fromManifest(migrateDocumentJson(json).json.office, entries);
  assert.equal(back.kind, "sheet");
  assert.equal(back.model.cells.A1, 1);
  assert.deepEqual([...back.model.media.m1.bytes], [1, 2]);
  assert.equal(back.model.kind, undefined, "kind is not part of the model");
  // documents stay exactly as before: no kind field, version 1, office/media/
  const d2 = new Doc({ name: "D", studio: "office" });
  d2.office = new OfficeProject(M.createDocument());
  const j2 = d2.toJSON();
  assert.equal(j2.office.kind, undefined);
  assert.equal(j2.version, 1);
  assert.equal(OfficeProject.fromManifest(j2.office, {}).kind, "document");
  assert.equal(officeKindOf(d2), "document");
  assert.equal(officeKindOf(new Doc({})), null);
  // a media path outside the kind's folder is ignored
  assert.equal(OfficeProject.fromManifest({ kind: "sheet", media: { x: { mime: "image/png", file: "office/media/x.png" } } }, { "office/media/x.png": new Uint8Array(1) }).model.media.x, undefined);
});

test("undo works for every kind through commitOffice", () => {
  const doc = new Doc({ name: "S", studio: "office" });
  doc.office = new OfficeProject({ cells: {} }, "sheet");
  commitOffice(doc, "Edit", { cells: { A1: 5 } });
  assert.equal(doc.office.model.cells.A1, 5);
  doc.undo();
  assert.deepEqual(doc.office.model.cells, {});
});

test("routing: File ▸ Open regex, format detection and guidance for kinds without an app", () => {
  const src = readFileSync(new URL("../../app/src/commands/file.js", import.meta.url), "utf8");
  const m = /const OFFICE_FILE = \/\\\.\(([^)]*)\)\$\/i;/.exec(src);
  assert.deepEqual(m[1].split("|").sort(), [...OFFICE_ONLY_EXTS].sort());
  for (const e of ["xlsx", "ods", "pptx", "odp", "excalidraw", "tldraw", "ots", "otp"]) assert.ok(OFFICE_ONLY_EXTS.includes(e), e);
  assert.equal(detectOfficeFormat("a.excalidraw").kind, "whiteboard");
  assert.match(officeGuidance(detectOfficeFormat("a.tldraw")).title, /Whiteboards/);
  assert.match(officeGuidance(detectOfficeFormat("a.xlsx")).message, /Spreadsheet app/);
});

test("save in the original format: other kinds use their recorded app format", () => {
  const doc = new Doc({ name: "S", studio: "office" });
  doc.office = new OfficeProject({ cells: {} }, "sheet");
  doc.source = { name: "b.xlsx", format: "xlsx", kind: "office", officeKind: "sheet", officeId: "xlsx" };
  assert.equal(canSaveAsSource(doc).ok, true);
  assert.equal(canSaveAsSource(doc).name, "b.xlsx");
  doc.office = null;
  assert.equal(canSaveAsSource(doc).ask, true);
});

test("menus with officeKinds show only while that app is mounted", () => {
  const entry = { label: "Table", studios: ["office"], officeKinds: ["document"] };
  assert.equal(menuVisible(entry, { doc: {}, studio: "office", officeKind: "document" }), true);
  assert.equal(menuVisible(entry, { doc: {}, studio: "office", officeKind: "sheet" }), false);
  assert.equal(menuVisible(entry, { doc: {}, studio: "office", officeKind: null }), false);
});

test("Vibe: suite tools and the prompt summary are kind-aware", async () => {
  registerOfficeApp(SHEET);
  try {
    const doc = new Doc({ name: "Budget", studio: "office" });
    doc.office = new OfficeProject({ cells: { A1: "x" } }, "test-sheet");
    const app = { doc, docs: [doc], prefs: {}, on() {}, emit() {} };
    const tools = Object.fromEntries(officeSuiteTools(app).map((t) => [t.name, t]));
    assert.ok(tools.office_formats.readOnly && tools.office_describe.readOnly && tools.office_list_documents.readOnly);
    const f = await tools.office_formats.run({});
    assert.ok(f.apps.find((a) => a.kind === "test-sheet").templates.some((t) => t.id === "budget"));
    assert.deepEqual((await tools.office_list_documents.run({})).documents[0], { name: "Budget", kind: "test-sheet", active: true, saved: true, source: null });
    const d = await tools.office_describe.run({});
    assert.deepEqual(d.summary, { cells: 1 });
    assert.deepEqual(d.exports, ["tcsv"]);
    assert.match(officeSummary(doc), /Test sheet \(kind test-sheet\)\. \{"cells":1\} note/);
    await assert.rejects(tools.office_new.run({ kind: "nope" }), /No Office app/);
    await assert.rejects(tools.office_new.run({ kind: "test-sheet", template: "zzz" }), /Unknown template/);
  } finally {
    unregisterOfficeApp("test-sheet");
  }
});
