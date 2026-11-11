// Word processor depth (docs/office-studio.md ▸ Design and review): rich text boxes and wrapped images as floating
// objects in DOCX and ODT, tracked format, paragraph, split and join changes (engine/office/track.js), Vibe edits
// tracked as "Vibe (AI)", and sections with columns in ODT.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/engine/office/model.js";
import * as D from "../../app/src/engine/office/design.js";
import { readDocx, writeDocx } from "../../app/src/engine/office/docx.js";
import { readOdt, writeOdt } from "../../app/src/engine/office/odt.js";
import { readZip, text as zipText } from "../../app/src/engine/office/zip.js";
import { exportOffice } from "../../app/src/engine/office/index.js";
import { officeDesignTools } from "../../app/src/vibe/tools/office-design.js";
import { officeTools } from "../../app/src/vibe/tools/office.js";

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

function doc(blocks, extra = {}) {
  const d = M.createDocument({ title: "T" });
  return M.normalizeDoc({ ...d, ...extra, blocks });
}
const box = () =>
  D.textBox({
    paras: [
      { runs: [{ text: "Note ", b: true }, { text: "red", color: "#ff0000", size: 14 }] },
      { align: "center", runs: [{ text: "second", i: true, u: true }] },
    ],
    width: 150,
    wrap: "left",
    fill: "#eef4ff",
    border: "#336699",
  });

test("text boxes hold formatted paragraphs; plain text and older boxes still work", () => {
  const b = box();
  assert.equal(b.text, "Note red\nsecond");
  assert.deepEqual(b.paras[0].runs[1], { text: "red", color: "#ff0000", size: 14 });
  assert.equal(b.paras[1].align, "center");
  const old = M.normalizeDoc({ blocks: [{ type: "paragraph", runs: [{ type: "textbox", text: "a\nb", width: 100 }] }] }).blocks[0].runs[0];
  assert.deepEqual(old.paras.map((p) => p.runs.map((r) => r.text).join("")), ["a", "b"]);
  // links and revision marks never enter a box
  const clean = D.textBox({ paras: [{ runs: [{ text: "x", link: "https://a.b", ins: "Ann", b: true }] }] });
  assert.deepEqual(clean.paras[0].runs, [{ text: "x", b: true }]);
  assert.ok(M.boxHeight(b) > 20);
});

test("DOCX writes text boxes and wrapped images as floating objects and reads them back", () => {
  const d = doc([M.para([box(), { text: "Body text wraps." }]), M.para([{ type: "image", media: "img1", width: 40, height: 30, wrap: "right", alt: "Logo" }, { text: "More." }])], { media: { img1: { id: "img1", mime: "image/png", name: "a.png", bytes: PNG } } });
  const bytes = writeDocx(d);
  const xml = zipText(readZip(bytes).entries, "word/document.xml");
  assert.match(xml, /<mc:Choice Requires="wps"><w:drawing><wp:anchor[^>]*>.*<wp:align>left<\/wp:align>.*<wp:wrapSquare wrapText="bothSides"\/>.*<wps:txbx><w:txbxContent>/s);
  assert.match(xml, /<mc:Fallback><w:pict><v:shape[^>]*fillcolor="#eef4ff"/);
  assert.match(xml, /<wp:anchor[^>]*>.*<wp:align>right<\/wp:align>.*pic:pic/s);
  const back = readDocx(bytes).doc;
  const tb = back.blocks[0].runs.find((r) => r.type === "textbox");
  assert.ok(tb, "the text box is read back as a text box");
  assert.equal(tb.wrap, "left");
  assert.equal(tb.fill, "#eef4ff");
  assert.equal(tb.border, "#336699");
  assert.equal(Math.round(tb.width), 150);
  assert.deepEqual(tb.paras[0].runs.map((r) => [r.text, !!r.b, r.color || null]), [["Note ", true, null], ["red", false, "#ff0000"]]);
  assert.equal(tb.paras[1].align, "center");
  assert.equal(M.paraText(back.blocks[0]).replace(/￼/g, ""), "Body text wraps.");
  const img = back.blocks[1].runs.find((r) => r.type === "image");
  assert.equal(img.wrap, "right");
  assert.equal(img.alt, "Logo");
});

test("ODT writes text boxes, wrapped images and sections with columns and reads them back", () => {
  const d = doc([M.para("Intro"), D.sectionBreak({ columns: 3, columnGap: 24 }), M.para([box(), { text: "In columns." }]), M.para([{ type: "image", media: "img1", width: 40, height: 30, wrap: "left" }]), D.sectionBreak({ columns: 1 }), M.para("After")], { media: { img1: { id: "img1", mime: "image/png", name: "a.png", bytes: PNG } } });
  const { bytes, notes } = exportOffice(d, "odt");
  assert.ok(!notes.some((n) => /Text boxes|Multi-column/.test(n)), notes.join(" "));
  const content = zipText(readZip(bytes).entries, "content.xml");
  assert.match(content, /<style:columns fo:column-count="3" fo:column-gap="24pt"\/>/);
  assert.match(content, /<text:section [^>]*>.*In columns.*<\/text:section>/s);
  assert.match(content, /<draw:text-box/);
  const back = readOdt(bytes).doc;
  const kinds = back.blocks.map((b) => (b.type === "sectionBreak" ? `s${b.columns}` : b.type[0]));
  assert.deepEqual(kinds.filter((k) => k[0] === "s"), ["s3", "s1"]);
  assert.equal(back.blocks.find((b) => b.type === "sectionBreak").columnGap, 24);
  const runs = back.blocks.flatMap((b) => (b.type === "paragraph" ? b.runs : []));
  const tb = runs.find((r) => r.type === "textbox");
  assert.equal(tb.wrap, "left");
  assert.equal(tb.fill, "#eef4ff");
  assert.equal(tb.paras[0].runs[0].b, true);
  assert.equal(runs.find((r) => r.type === "image").wrap, "left");
  // a document that starts with a multi-column section keeps it as the first section's columns
  const first = readOdt(writeOdt(doc([M.para("a"), D.sectionBreak({ columns: 1 }), M.para("b")], { page: { ...M.defaultPage(), columns: 2 } }))).doc;
  assert.equal(first.page.columns, 2);
  assert.equal(first.blocks.filter((b) => b.type === "sectionBreak").length, 1);
});

test("other formats get text box paragraphs with their formatting", () => {
  const d = doc([M.para([box(), { text: "x" }])]);
  const ex = D.prepareForExport(d, "html");
  const boxParas = ex.doc.blocks.slice(1);
  assert.equal(boxParas.length, 2);
  assert.equal(boxParas[0].runs[0].b, true);
  assert.equal(boxParas[1].props.align, "center");
});

test("format and paragraph changes are tracked, accepted and rejected", () => {
  const d0 = doc([M.para("Hello world"), M.para("Second")]);
  let d = M.formatRange(d0, { path: [0], offset: 0 }, { path: [0], offset: 5 }, { b: true });
  d = M.setParagraphStyle(d, { path: [1], offset: 0 }, { path: [1], offset: 0 }, "Heading1");
  const t = D.trackDiff(d0, d, "Ann");
  assert.deepEqual(t.blocks[0].runs[0], { text: "Hello", b: true, fmt: { author: "Ann", old: {} } });
  assert.deepEqual(t.blocks[1].pchg, { author: "Ann", style: "Normal" });
  const revs = D.revisions(t);
  assert.deepEqual(revs.map((r) => r.kind), ["format", "paragraph"]);
  const rejected = D.resolveRevisions(t, { accept: false }).doc;
  assert.deepEqual(rejected.blocks[0].runs, [{ text: "Hello world" }]);
  assert.equal(rejected.blocks[1].style, "Normal");
  assert.ok(!rejected.blocks[1].pchg);
  const accepted = D.acceptAll(t);
  assert.deepEqual(accepted.blocks[0].runs[0], { text: "Hello", b: true });
  assert.equal(accepted.blocks[1].style, "Heading1");
  // formatting back to the original clears the change; typed text never inherits it
  const undone = D.trackDiff(t, M.formatRange(t, { path: [0], offset: 0 }, { path: [0], offset: 5 }, { b: null }), "Ann");
  assert.equal(D.revisions(undone).length, 1);
  assert.deepEqual(M.marksAt(t.blocks[0].runs, 3), { b: true });
});

test("paragraph splits and joins are tracked", () => {
  const d0 = doc([M.para("OneTwo"), M.para("Three")]);
  const s = D.trackSplit(d0, { path: [0], offset: 3 }, "Ann");
  assert.deepEqual(s.doc.blocks.map((b) => [M.paraText(b), b.pins || null]), [["One", "Ann"], ["Two", null], ["Three", null]]);
  assert.deepEqual(D.revisions(s.doc).map((r) => r.kind), ["split"]);
  assert.equal(M.paraText(D.resolveRevisions(s.doc, { accept: false }).doc.blocks[0]), "OneTwo");
  // Backspace at the start of "Two" removes Ann's own split outright
  const own = D.trackJoin(s.doc, [1], "Ann");
  assert.equal(M.paraText(own.doc.blocks[0]), "OneTwo");
  // someone else's join is a deleted paragraph mark until accepted
  const j = D.trackJoin(d0, [1], "Bob");
  assert.equal(j.doc.blocks[0].pdel, "Bob");
  assert.deepEqual(j.pos, { path: [0], offset: 6 });
  assert.deepEqual(D.revisions(j.doc).map((r) => r.kind), ["join"]);
  assert.equal(M.paraText(D.acceptAll(j.doc).blocks[0]), "OneTwoThree");
  assert.equal(D.resolveRevisions(j.doc, { accept: false }).doc.blocks.length, d0.blocks.length);
});

test("trackDiff turns rewritten, inserted and removed paragraphs into revisions", () => {
  const d0 = doc([M.para("Keep this."), M.para("The cat sat."), M.para("Remove me."), M.para("End.")]);
  const next = { ...d0, blocks: [M.para("Keep this."), M.para("The dog sat."), M.para("Brand new."), M.para("End.")] };
  const t = D.trackDiff(d0, M.normalizeDoc(next), D.VIBE_AUTHOR);
  const kinds = D.revisions(t).map((r) => `${r.kind}:${r.text}`);
  assert.ok(kinds.includes("del:cat") && kinds.includes("ins:dog"), kinds.join(" | "));
  assert.ok(D.revisions(t).every((r) => r.author === "Vibe (AI)"));
  assert.deepEqual(D.acceptAll(t).blocks.map(M.paraText).filter(Boolean), ["Keep this.", "The dog sat.", "Brand new.", "End."]);
  assert.deepEqual(D.resolveRevisions(t, { accept: false }).doc.blocks.map(M.paraText).filter(Boolean), ["Keep this.", "The cat sat.", "Remove me.", "End."]);
});

test("DOCX writes and reads format, paragraph, split and join revisions", () => {
  let d = doc([M.para([{ text: "Bold", b: true, fmt: { author: "Ann", old: { i: true } } }, { text: " plain" }]), { ...M.para("Head", "Heading1"), pchg: { author: "Bob", style: "Normal", props: { align: "center" } } }, { ...M.para("A"), pins: "Ann" }, { ...M.para("B"), pdel: "Cy" }, M.para("C")]);
  const bytes = writeDocx(d);
  const xml = zipText(readZip(bytes).entries, "word/document.xml");
  assert.match(xml, /<w:rPrChange w:id="\d+" w:author="Ann"[^>]*><w:rPr><w:i\/><w:iCs\/><\/w:rPr><\/w:rPrChange><\/w:rPr>/);
  assert.match(xml, /<w:pPrChange w:id="\d+" w:author="Bob"[^>]*><w:pPr><w:jc w:val="center"\/><\/w:pPr><\/w:pPrChange><\/w:pPr>/);
  assert.match(xml, /<w:rPr><w:ins w:id="\d+" w:author="Ann"[^/]*\/><\/w:rPr>/);
  assert.match(xml, /<w:rPr><w:del w:id="\d+" w:author="Cy"[^/]*\/><\/w:rPr>/);
  const back = readDocx(bytes).doc;
  assert.deepEqual(back.blocks[0].runs[0].fmt, { author: "Ann", old: { i: true } });
  assert.deepEqual(back.blocks[1].pchg, { author: "Bob", style: "Normal", props: { align: "center" } });
  assert.equal(back.blocks[2].pins, "Ann");
  assert.equal(back.blocks[3].pdel, "Cy");
  assert.deepEqual(D.revisions(back).map((r) => r.kind), ["format", "paragraph", "split", "join"]);
  // other formats accept them
  const html = exportOffice(back, "html");
  assert.ok(html.notes.some((n) => /Tracked changes were accepted/.test(n)));
});

test("Vibe edits are tracked as Vibe (AI) while Track changes is on", async () => {
  const doc = { name: "T", office: { kind: "document", model: M.normalizeDoc({ ...M.createDocument(), trackChanges: true, blocks: [M.para("Body paragraph that is long enough.")] }) } };
  const labels = [];
  const app = { doc, prefs: {}, officeUI: { doc, editor: { commit: (next, o) => (labels.push(o.label), (doc.office.model = next)) } } };
  const design = Object.fromEntries(officeDesignTools(app).map((t) => [t.name, t]));
  await design.office_insert_text_box.run({ index: 0, paragraphs: [{ align: "center", runs: [{ text: "Hi", bold: true }] }] });
  const tb = doc.office.model.blocks[0].runs[0];
  assert.equal(tb.type, "textbox");
  assert.deepEqual(tb.paras[0], { runs: [{ text: "Hi", b: true }], align: "center" });
  const word = Object.fromEntries(officeTools(app).map((t) => [t.name, t]));
  assert.deepEqual(await word.office_replace_text.run({ find: "Body", replace: "Main" }), { replaced: 1 });
  const revs = D.revisions(doc.office.model);
  assert.deepEqual(revs.map((r) => `${r.kind}:${r.text}:${r.author}`), ["del:Body:Vibe (AI)", "ins:Main:Vibe (AI)"]);
  // accepting through the tool is not itself tracked
  await design.office_track_changes.run({ action: "accept" });
  assert.equal(D.revisions(doc.office.model).length, 0);
  assert.equal(M.paraText(doc.office.model.blocks[0]).replace(/\uFFFC/g, ""), "Main paragraph that is long enough.");
  assert.ok(labels.every((l) => l.startsWith("Vibe: ")));
});