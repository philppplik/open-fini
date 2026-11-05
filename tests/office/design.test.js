// Document design and review (engine/office/design.js): themes, style sets, update style from a paragraph, table
// style gallery, sections with columns, text boxes, table of contents, tracked changes, export conversions, DOCX round
// trip, designed templates and the design Vibe tools (docs/office-studio.md ▸ Design and review).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/engine/office/model.js";
import * as D from "../../app/src/engine/office/design.js";
import { readDocx, writeDocx } from "../../app/src/engine/office/docx.js";
import { exportOffice } from "../../app/src/engine/office/index.js";
import { officeDesignTools } from "../../app/src/vibe/tools/office-design.js";

function sample() {
  const d = M.createDocument({ title: "Plan" });
  const t = M.createTable(3, 2, 400, { header: true });
  t.rows[0].cells[0].blocks = [M.para("Item")];
  t.rows[1].cells[0].blocks = [M.para("Rent")];
  d.blocks = [M.para("Plan", "Title"), M.heading(1, "Intro"), M.para("Hello world."), M.heading(2, "Scope"), M.para("Scope text."), t, M.para("")];
  return M.normalizeDoc(d);
}

test("normalize keeps the design blocks, marks and objects and clamps them", () => {
  const d = M.normalizeDoc({
    ...sample(),
    theme: { id: "modern", fonts: { heading: "Inter", body: "Inter<x>" }, colors: { heading: "#0f766e", accent: "bad", text: "#111" } },
    trackChanges: 1,
    blocks: [
      { type: "sectionBreak", columns: 9, start: "page" },
      { type: "toc", levels: 0 },
      { type: "paragraph", runs: [{ type: "textbox", text: "Box", width: 5, wrap: "x" }, { text: "a", ins: "Ann" }, { text: "b", del: " Bob " }] },
    ],
  });
  assert.deepEqual(d.blocks[0], { type: "sectionBreak", columns: 4, columnGap: 36, start: "page" });
  assert.equal(d.blocks[1].levels, 1);
  assert.equal(d.blocks[2].runs[0].width, 36);
  assert.equal(d.blocks[2].runs[0].wrap, "right");
  assert.equal(d.blocks[2].runs[1].ins, "Ann");
  assert.equal(d.blocks[2].runs[2].del, "Bob");
  assert.equal(d.theme.colors.accent, "#000000");
  assert.equal(d.theme.fonts.body, "Interx");
  assert.equal(d.trackChanges, true);
});

test("themes and style sets restyle the built-in styles; update style adopts direct formatting", () => {
  let d = D.applyTheme(sample(), "classic");
  assert.equal(d.styles.Normal.run.font, "Cambria");
  assert.equal(d.styles.Heading1.run.font, "Georgia");
  assert.equal(d.theme.id, "classic");
  assert.throws(() => D.applyTheme(d, "nope"), /Unknown theme/);
  d = D.applyStyleSet(d, "formal");
  assert.equal(d.styles.Normal.para.align, "justify");
  assert.equal(d.styles.Title.para.align, "center");
  d = M.setBlock(d, [2], { ...d.blocks[2], props: { spaceAfter: 20 }, runs: [{ text: "Hello world.", color: "#ff0000", b: true }] });
  const u = D.updateStyleFromParagraph(d, [2]);
  assert.equal(u.styles.Normal.run.color, "#ff0000");
  assert.equal(u.styles.Normal.para.spaceAfter, 20);
  assert.equal(u.blocks[2].props, undefined);
  assert.deepEqual(u.blocks[2].runs, [{ text: "Hello world." }]);
});

test("table styles bake header, bands and total row and re-styling removes the old look", () => {
  const d = sample();
  const t = D.applyTableStyle(d.blocks[5], "blue", { header: true, banded: true, total: true });
  assert.equal(t.rows[0].cells[0].shading, "#4472c4");
  assert.equal(t.rows[0].cells[0].blocks[0].runs[0].color, "#ffffff");
  assert.equal(t.rows[2].cells[0].blocks[0].runs.length, 0); // empty cell
  assert.equal(t.design.style, "blue");
  const plain = D.applyTableStyle(t, "plain", { header: false, banded: false });
  assert.equal(plain.rows[0].cells[0].shading, undefined);
  assert.deepEqual(plain.rows[0].cells[0].blocks[0].runs, [{ text: "Item" }]);
  const accent = D.applyTableStyle(d.blocks[5], "accent", {}, { colors: { accent: "#000080" } });
  assert.equal(accent.rows[0].cells[0].shading, "#000080");
});

test("sections, table of contents and floating objects", () => {
  let d = sample();
  d = { ...d, blocks: [d.blocks[0], D.tocBlock({ levels: 1 }), ...d.blocks.slice(1, 3), D.sectionBreak({ columns: 2 }), ...d.blocks.slice(3)] };
  const secs = D.sectionsOf(d);
  assert.deepEqual(secs.map((s) => [s.from, s.to, s.columns]), [[0, 4, 1], [4, d.blocks.length, 2]]);
  assert.deepEqual(D.tocEntries(d, 1).map((e) => e.text), ["Intro"]);
  assert.equal(D.tocParagraphs(d, d.blocks[1]).length, 2);
  d = M.setBlock(d, [3], { ...d.blocks[3], runs: [D.textBox({ text: "Side" }), ...d.blocks[3].runs] });
  assert.equal(D.floatingObjects(d)[0].kind, "textbox");
  const ex = D.prepareForExport(d, "odt");
  assert.ok(!ex.doc.blocks.some((b) => b.type === "toc" || b.type === "sectionBreak"));
  assert.ok(ex.notes.some((n) => /Text boxes/.test(n)));
  assert.equal(D.prepareForExport(d, "docx").doc.blocks.filter((b) => b.type === "toc").length, 1);
  // Backspace after an atom block removes it
  const j = M.joinBackward(d, [2]);
  assert.equal(j.doc.blocks[1].type, "paragraph");
});

test("tracked changes: deletes mark text, own insertions vanish, accept and reject", () => {
  let d = sample();
  const p = [2];
  d = M.insertText(d, { path: p, offset: 5 }, " big", { ins: "Ann" }).doc;
  assert.equal(M.paraText(M.getBlock(d, p)), "Hello big world.");
  // Ann deletes " big" (hers, removed) and "Hello" (marked)
  let r = D.trackDelete(d, { path: p, offset: 5 }, { path: p, offset: 9 }, "Ann");
  assert.equal(M.paraText(M.getBlock(r.doc, p)), "Hello world.");
  r = D.trackDelete(r.doc, { path: p, offset: 0 }, { path: p, offset: 5 }, "Ann");
  d = M.insertText(r.doc, { path: p, offset: 12 }, " Bye", { ins: "Bob" }).doc;
  const revs = D.revisions(d);
  assert.deepEqual(revs.map((x) => [x.kind, x.author, x.text]), [["del", "Ann", "Hello"], ["ins", "Bob", " Bye"]]);
  const rejected = D.resolveRevisions(d, { accept: false, author: "Bob" });
  assert.equal(rejected.count, 1);
  assert.equal(M.paraText(M.getBlock(rejected.doc, p)), "Hello world.");
  const accepted = D.resolveRevisions(d, { accept: true });
  assert.equal(M.paraText(M.getBlock(accepted.doc, p)), " world. Bye");
  assert.equal(D.revisions(accepted.doc).length, 0);
  // non-Word exports accept the changes
  const html = new TextDecoder().decode(exportOffice(d, "txt").bytes);
  assert.ok(!html.includes("Hello") && html.includes("Bye"));
});

test("DOCX keeps tracked changes, sections with columns and writes a TOC field", () => {
  let d = sample();
  d = M.insertText(d, { path: [2], offset: 5 }, " new", { ins: "Ann" }).doc;
  d = D.trackDelete(d, { path: [2], offset: 0 }, { path: [2], offset: 5 }, "Bob").doc;
  d = { ...d, blocks: [d.blocks[0], D.tocBlock(), d.blocks[1], d.blocks[2], D.sectionBreak({ columns: 3, start: "continuous" }), ...d.blocks.slice(3)] };
  const bytes = writeDocx(d);
  const back = readDocx(bytes).doc;
  const sb = back.blocks.filter((b) => b.type === "sectionBreak");
  assert.equal(sb.length, 1);
  assert.equal(sb[0].columns, 3);
  assert.equal(sb[0].start, "continuous");
  const revs = D.revisions(back);
  assert.ok(revs.some((r) => r.kind === "ins" && r.author === "Ann" && r.text === " new"));
  assert.ok(revs.some((r) => r.kind === "del" && r.author === "Bob" && r.text === "Hello"));
  assert.ok(back.blocks.some((b) => b.type === "paragraph" && M.paraText(b) === "Contents"));
});

test("design Vibe tools edit the active document as undoable steps", async () => {
  const doc = { name: "Plan", office: { kind: "document", model: sample() } };
  const commits = [];
  const app = { doc, officeUI: { doc, editor: { commit: (next, o) => (commits.push(o.label), (doc.office.model = next)) } } };
  const tools = Object.fromEntries(officeDesignTools(app).map((t) => [t.name, t]));
  for (const t of Object.values(tools)) assert.match(t.description, /Watch out/, t.name);
  await tools.office_apply_design.run({ theme: "ocean", styleSet: "airy" });
  assert.equal(doc.office.model.theme.id, "ocean");
  await tools.office_table_style.run({ index: 5, style: "accent" });
  assert.equal(doc.office.model.blocks[5].design.style, "accent");
  await assert.rejects(tools.office_table_style.run({ index: 2, style: "blue" }), /not a table/);
  const toc = await tools.office_insert_toc.run({});
  assert.equal(toc.at, 1);
  await assert.rejects(tools.office_insert_toc.run({}), /already/);
  await tools.office_insert_section_break.run({ index: 3, columns: 2 });
  await tools.office_insert_text_box.run({ index: 4, text: "Note" });
  assert.equal(doc.office.model.blocks[4].runs[0].type, "textbox");
  await tools.office_track_changes.run({ action: "on" });
  assert.equal(doc.office.model.trackChanges, true);
  assert.deepEqual((await tools.office_track_changes.run({ action: "list" })).changes, []);
  assert.ok(commits.every((l) => l.startsWith("Vibe: ")));
});
