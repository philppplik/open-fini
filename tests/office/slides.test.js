// Presentation app (Office Suite kind "slides"): model operations, collaboration records, PPTX and ODP round trips,
// hostile input, the manifest and the Vibe tools' contract.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/office/slides/model.js";
import { readPptx, writePptx } from "../../app/src/office/slides/pptx.js";
import { readOdp, writeOdp } from "../../app/src/office/slides/odp.js";
import { readZip, writeZip } from "../../app/src/engine/office/zip.js";
import { ImportReport } from "../../app/src/core/import-report.js";
import { officeApp, appForFile, loadOfficeApp } from "../../app/src/office/index.js";
import { detectOfficeFormat } from "../../app/src/engine/office/index.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { slidesTools } from "../../app/src/vibe/tools/office-slides.js";

// 1x1 transparent PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

function sampleDeck() {
  let d = M.createDeck({ template: "pitch", title: "Pitch" });
  const s0 = d.slides[0].id;
  let r = M.addElement(d, s0, { type: "shape", shape: "ellipse", x: 10, y: 20, w: 100, h: 50, fill: "#ff0000", stroke: "#000000", strokeWidth: 2, rot: 30, text: "Hi", style: { size: 20, bold: true, color: "#00ff00", align: "center", valign: "middle" } });
  d = r.deck;
  const m = M.addMedia(d, { bytes: PNG, mime: "image/png", name: "p.png", w: 1, h: 1 });
  d = M.addElement(m.deck, s0, { type: "image", media: m.id, x: 300, y: 300, w: 120, h: 80 }).deck;
  d = M.addElement(d, s0, { type: "table", x: 40, y: 400, w: 400, h: 100, rows: [["A", "B"], ["1", "2"]] }).deck;
  d = M.updateSlide(d, s0, { notes: "Say hello\nThen continue", transition: { type: "fade", duration: 0.75 }, background: { color: "#123456" } });
  d = M.updateSlide(d, d.slides[1].id, { hidden: true, transition: { type: "slide", duration: 0.5 } });
  return d;
}

test("create: templates, layouts and normalization", () => {
  const blank = M.createDeck({ template: "blank" });
  assert.equal(blank.slides.length, 1);
  assert.deepEqual(blank.size, { w: 960, h: 540 });
  assert.equal(M.createDeck({ template: "pitch" }).slides.length, 8);
  const report = M.createDeck({ template: "report" });
  assert.ok(report.slides.some((s) => s.elements.some((e) => e.type === "table")));
  for (const s of report.slides) assert.ok(s.ord, "slides have order keys");
  const n = M.normalizeDeck({ slides: [{ elements: [{ type: "weird", x: "5", w: -3 }] }], theme: { id: "nope", bg: "red" } });
  assert.equal(n.slides[0].elements[0].type, "text");
  assert.equal(n.slides[0].elements[0].w, 1);
  assert.equal(n.theme.id, "office");
  assert.equal(n.theme.bg, "#ffffff", "invalid colors fall back to the theme");
});

test("slide operations: add, duplicate, move, delete keep order keys increasing", () => {
  let d = M.createDeck({ template: "report" });
  const ids = d.slides.map((s) => s.id);
  const added = M.addSlide(d, { layout: "two-content", after: ids[0] });
  d = added.deck;
  assert.equal(d.slides[1].id, added.id);
  assert.equal(d.slides[1].elements.filter((e) => e.ph).length, 3);
  const dup = M.duplicateSlide(d, ids[0]);
  d = dup.deck;
  assert.equal(d.slides[1].id, dup.id);
  assert.notEqual(d.slides[1].elements[0].id, d.slides[0].elements[0].id, "duplicated elements get new ids");
  d = M.moveSlides(d, [ids[0]], 3);
  assert.equal(d.slides[3].id, ids[0]);
  const ords = d.slides.map((s) => s.ord);
  assert.deepEqual([...ords].sort(), ords, "order keys follow the list");
  d = M.deleteSlides(d, d.slides.map((s) => s.id));
  assert.equal(d.slides.length, 1, "deleting everything leaves one blank slide");
});

test("element operations: update, arrange, align, layout and theme", () => {
  let d = M.createDeck({ template: "blank" });
  const sid = d.slides[0].id;
  const a = M.addElement(d, sid, { type: "shape", x: 0, y: 0, w: 100, h: 100 });
  const b = M.addElement(a.deck, sid, { type: "shape", x: 200, y: 50, w: 50, h: 50 });
  d = b.deck;
  d = M.updateElements(d, sid, [a.id], { fill: "#abcdef", style: { bold: true } });
  const el = M.slideById(d, sid).elements.find((e) => e.id === a.id);
  assert.equal(el.fill, "#abcdef");
  assert.equal(el.style.bold, true);
  d = M.arrange(d, sid, [a.id], "front");
  assert.equal(M.slideById(d, sid).elements.at(-1).id, a.id);
  d = M.arrange(d, sid, [a.id], "backward");
  assert.equal(M.slideById(d, sid).elements.at(-2).id, a.id);
  d = M.align(d, sid, [a.id, b.id], "right");
  for (const e of M.slideById(d, sid).elements.filter((x) => !x.ph)) assert.equal(e.x + e.w, 250);
  d = M.align(d, sid, [b.id], "center");
  assert.equal(M.slideById(d, sid).elements.find((e) => e.id === b.id).x, 455);
  // layout: title text survives, body placeholder appears
  d = M.updateElements(d, sid, [M.slideById(d, sid).elements.find((e) => e.ph === "title").id], { text: "Hello" });
  d = M.applyLayout(d, sid, "title-content");
  const s = M.slideById(d, sid);
  assert.equal(s.layout, "title-content");
  assert.equal(s.elements.find((e) => e.ph === "title").text, "Hello");
  assert.ok(s.elements.some((e) => e.ph === "body"));
  assert.ok(s.elements.some((e) => e.id === b.id), "free elements stay");
  d = M.applyTheme(d, "midnight");
  assert.equal(d.theme.bg, "#0f172a");
  d = M.deleteElements(d, sid, [b.id]);
  assert.ok(!M.slideById(d, sid).elements.some((e) => e.id === b.id));
  const desc = M.describeDeck(d, { full: true });
  assert.equal(desc.kind, "slides");
  assert.equal(desc.slides[0].title, "Hello");
});

test("collaboration records round trip and merge", () => {
  const d = sampleDeck();
  const recs = M.deckRecords(d);
  assert.ok(recs["meta:deck"]);
  assert.ok(Object.keys(recs).some((k) => k.startsWith("obj:")));
  for (const v of Object.values(recs)) assert.ok(JSON.stringify(v).length < 64 * 1024);
  const base = M.createDeck();
  const back = M.applyDeckRecords(base, { ...Object.fromEntries(Object.keys(M.deckRecords(base)).map((k) => [k, null])), ...recs });
  assert.deepEqual(back.slides.map((s) => s.id), d.slides.map((s) => s.id));
  assert.deepEqual(back.slides[0].elements.map((e) => e.id), d.slides[0].elements.map((e) => e.id));
  assert.equal(Object.values(back.media)[0].bytes.length, PNG.length);
  // a remote edit of one element and a deleted slide
  const s0 = d.slides[0];
  const e0 = s0.elements[0];
  const next = M.applyDeckRecords(d, { [`obj:${s0.id}/${e0.id}`]: { ...e0, text: "Remote" }, [`slide:${d.slides[2].id}`]: null });
  assert.equal(next.slides[0].elements[0].text, "Remote");
  assert.equal(next.slides.length, d.slides.length - 1);
});

test("PPTX round trip keeps slides, text, shapes, images, tables, notes, transitions", () => {
  const d = sampleDeck();
  const bytes = writePptx(d);
  const z = readZip(bytes);
  assert.ok(z.entries["ppt/presentation.xml"] && z.entries["[Content_Types].xml"] && z.entries["ppt/notesSlides/notesSlide1.xml"]);
  assert.equal(detectOfficeFormat("x.pptx", bytes).id, "pptx");
  const report = new ImportReport("PowerPoint", "x.pptx");
  const r = readPptx(bytes, { report });
  assert.equal(r.slides.length, d.slides.length);
  assert.deepEqual(r.size, d.size);
  assert.equal(r.theme.bg, d.theme.bg);
  assert.equal(r.theme.heading, d.theme.heading);
  const [s0, s1] = r.slides;
  assert.equal(s0.layout, "title");
  assert.equal(s0.notes, "Say hello\nThen continue");
  assert.equal(s0.transition.type, "fade");
  assert.deepEqual(s0.background, { color: "#123456" });
  assert.equal(s1.hidden, true);
  assert.equal(s1.transition.type, "slide");
  assert.equal(s0.elements.find((e) => e.ph === "title").text, "Company name");
  const shape = s0.elements.find((e) => e.type === "shape");
  assert.equal(shape.shape, "ellipse");
  assert.equal(shape.fill, "#ff0000");
  assert.equal(shape.rot, 30);
  assert.equal(shape.text, "Hi");
  assert.equal(shape.style.size, 20);
  assert.equal(shape.style.color, "#00ff00");
  assert.equal(shape.style.bold, true);
  assert.equal(shape.style.align, "center");
  assert.deepEqual([shape.x, shape.y, shape.w, shape.h], [10, 20, 100, 50]);
  const img = s0.elements.find((e) => e.type === "image");
  assert.deepEqual(r.media[img.media].bytes, PNG);
  assert.deepEqual(s0.elements.find((e) => e.type === "table").rows, [["A", "B"], ["1", "2"]]);
  const body = r.slides[1].elements.find((e) => e.ph === "body");
  assert.equal(body.text, "Who has it\nHow they solve it today\nWhy that is not good enough");
  assert.equal(body.style.bullets, true);
  assert.ok(report.by("kept").length);
});

test("ODP round trip keeps slides, text, shapes, images, tables, notes, transitions and the theme", () => {
  const d = sampleDeck();
  const bytes = writeOdp(d);
  const z = readZip(bytes);
  assert.equal(new TextDecoder().decode(z.entries.mimetype), "application/vnd.oasis.opendocument.presentation");
  assert.equal(detectOfficeFormat("x.odp", bytes).id, "odp");
  const r = readOdp(bytes, { report: new ImportReport("ODP") });
  assert.equal(r.slides.length, d.slides.length);
  assert.deepEqual(r.size, d.size);
  assert.equal(r.theme.id, d.theme.id);
  const [s0, s1] = r.slides;
  assert.equal(s0.notes, "Say hello\nThen continue");
  assert.equal(s0.transition.type, "fade");
  assert.deepEqual(s0.background, { color: "#123456" });
  assert.equal(s1.hidden, true);
  const shape = s0.elements.find((e) => e.type === "shape");
  assert.equal(shape.shape, "ellipse");
  assert.equal(shape.fill, "#ff0000");
  assert.ok(Math.abs(shape.rot - 30) < 0.01, `rotation ${shape.rot}`);
  assert.ok(Math.abs(shape.x - 10) < 1 && Math.abs(shape.y - 20) < 1, `position ${shape.x},${shape.y}`);
  assert.equal(shape.text, "Hi");
  assert.equal(shape.style.bold, true);
  assert.equal(shape.style.color, "#00ff00");
  assert.equal(s0.elements.find((e) => e.ph === "title").text, "Company name");
  assert.deepEqual(s0.elements.find((e) => e.type === "table").rows, [["A", "B"], ["1", "2"]]);
  const img = s0.elements.find((e) => e.type === "image");
  assert.deepEqual(r.media[img.media].bytes, PNG);
  assert.equal(r.slides[1].elements.find((e) => e.ph === "body").style.bullets, true);
});

test("hostile and foreign input fails with a clear message", () => {
  assert.throws(() => readPptx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), /97-2003/);
  assert.throws(() => readPptx(new TextEncoder().encode("not a zip")), /not a ZIP/);
  assert.throws(() => readPptx(writeZip([["a.txt", "x"]])), /presentation\.xml/);
  assert.throws(() => readOdp(writeZip([["mimetype", "application/vnd.oasis.opendocument.text"]])), /not a presentation/);
  // a slide that points outside the package and an entity bomb do not escape or explode
  const evil = writeZip([
    ["ppt/presentation.xml", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>'],
    ["ppt/_rels/presentation.xml.rels", '<Relationships><Relationship Id="rId1" Type="x/slide" Target="../../../etc/passwd"/></Relationships>'],
  ]);
  const deck = readPptx(evil);
  assert.equal(deck.slides.length, 1, "an unreadable deck still opens with one blank slide");
});

test("manifest, routing and the implementation contract", async () => {
  const m = officeApp("slides");
  assert.ok(m, "the Presentation app is registered");
  assert.equal(appForFile("deck.pptx").app.kind, "slides");
  assert.equal(appForFile("deck.odp").format.id, "odp");
  assert.equal(appForFile("deck.potx").format.template, true);
  assert.equal(appForFile("old.ppt"), null, "legacy .ppt keeps the convert-first dialog");
  const impl = await loadOfficeApp("slides");
  const model = await impl.create({ template: "pitch", title: "T" });
  const prj = new OfficeProject(model, "slides");
  const back = OfficeProject.fromManifest(JSON.parse(JSON.stringify(prj.manifest())), prj.entries());
  assert.equal(back.kind, "slides");
  const saved = await impl.save(model, "pptx", { title: "T" });
  const opened = await impl.open(saved.bytes, "T.pptx", { report: new ImportReport("PowerPoint") });
  assert.equal(opened.model.slides.length, 8);
  const odp = await impl.save(model, "odp", {});
  assert.equal((await impl.open(odp.bytes, "T.odp", {})).model.slides.length, 8);
  assert.equal(impl.aiAdapter.describe(model).slideCount, 8);
  const recs = impl.collabAdapter.records(model);
  assert.equal(impl.collabAdapter.applyRecords(model, {}).slides.length, 8);
  assert.ok(Object.keys(recs).length > 8);
});

test("Vibe slide tools edit the active deck as undoable steps", async () => {
  const impl = await loadOfficeApp("slides");
  const doc = { office: new OfficeProject(await impl.create({ template: "blank" }), "slides"), tx: (label, fn) => fn(), _do: (op) => op.redo() };
  const app = { doc, docs: [doc], officeUI: null };
  const tools = Object.fromEntries(slidesTools(app).map((t) => [t.name, t]));
  for (const t of Object.values(tools)) assert.match(t.name, /^slides_/);
  const add = await tools.slides_add_slide.run({ layout: "title-content", title: "Agenda", body: "One\nTwo" });
  assert.equal(doc.office.model.slides.length, 2);
  await tools.slides_set_text.run({ slide: 1, placeholder: "title", text: "Welcome" });
  assert.equal(M.slideTitle(doc.office.model.slides[0]), "Welcome");
  await tools.slides_add_shape.run({ slide: add.slide, shape: "rect", x: 10, y: 10, w: 50, h: 50, fill: "#ff0000", text: "Box" });
  assert.ok(doc.office.model.slides[1].elements.some((e) => e.type === "shape" && e.text === "Box"));
  await tools.slides_reorder.run({ slide: 2, to: 1 });
  assert.equal(M.slideTitle(doc.office.model.slides[0]), "Agenda");
  await tools.slides_set_notes.run({ slide: 1, notes: "Talk" });
  assert.equal(doc.office.model.slides[0].notes, "Talk");
  await tools.slides_apply_theme.run({ theme: "paper" });
  assert.equal(doc.office.model.theme.id, "paper");
  await tools.slides_apply_layout.run({ slide: 2, layout: "title-only" });
  assert.equal(doc.office.model.slides[1].layout, "title-only");
  const d = await tools.slides_describe.run({});
  assert.equal(d.slideCount, 2);
  await assert.rejects(async () => tools.slides_set_text.run({ slide: 9, placeholder: "title", text: "x" }), /slide/i);
});
