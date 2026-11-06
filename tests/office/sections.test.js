// Semantic document structure (engine/office/sections.js), the semantic / cross-app Vibe tools and the
// spreadsheet's data bars (docs/vibe-studio.md ▸ Office, docs/office-sheet.md).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/engine/office/model.js";
import * as X from "../../app/src/engine/office/sections.js";
import * as SM from "../../app/src/office/sheet/model.js";
import { readXlsx, writeXlsx } from "../../app/src/office/sheet/xlsx.js";
import { createCalc } from "../../app/src/office/sheet/formula.js";
import { officeSemanticTools } from "../../app/src/vibe/tools/office-semantic.js";
import { OFFICE_SKILLS } from "../../app/src/ai/skills-office.js";
import { parseSkill } from "../../app/src/ai/skills.js";

function sample() {
  const d = M.createDocument({ title: "Plan" });
  const t = M.createTable(2, 2, 400, { header: true });
  t.rows[0].cells[0].blocks = [M.para("Item")];
  t.rows[0].cells[1].blocks = [M.para("Cost")];
  t.rows[1].cells[0].blocks = [M.para("Rent")];
  t.rows[1].cells[1].blocks = [M.para("1,200")];
  d.blocks = [
    M.para("Plan 2027", "Title"),
    M.heading(1, "1. Introduction"),
    { ...M.para("We start. More text follows."), props: { align: "justify" } },
    M.heading(2, "Scope"),
    M.para("Scope text."),
    M.heading(1, "Costs"),
    M.para("Budget table:"),
    t,
    M.heading(1, "Next steps"),
    M.para("Ship it.", "Normal", { list: { kind: "bullet", level: 0, id: "l1" } }),
  ];
  return d;
}

test("sections: ranges include subsections; find by heading ignores case and numbering", () => {
  const d = sample();
  const s = X.sections(d);
  assert.deepEqual(s.map((x) => [x.index, x.level, x.end]), [[1, 1, 5], [3, 2, 5], [5, 1, 8], [8, 1, 10]]);
  assert.equal(X.findSection(d, "introduction").index, 1);
  assert.equal(X.findSection(d, "Next").index, 8);
  assert.throws(() => X.findSection(d, "Missing"), /Headings: “1. Introduction”/);
  assert.throws(() => X.findSection(M.createDocument(), "x"), /no headings/);
});

test("replaceSectionBody keeps the heading and the body paragraph formatting", () => {
  const d = sample();
  const sec = X.findSection(d, "Introduction");
  const r = X.replaceSectionBody(d, sec, [M.para("New intro."), M.para("Point", "Normal", { list: { kind: "bullet", level: 0 } })], { keepSubsections: true });
  assert.equal(M.paraText(r.doc.blocks[1]), "1. Introduction");
  assert.equal(M.paraText(r.doc.blocks[2]), "New intro.");
  assert.deepEqual(r.doc.blocks[2].props, { align: "justify" });
  assert.equal(r.doc.blocks[3].props, undefined, "list items keep their own formatting");
  assert.equal(M.paraText(r.doc.blocks[4]), "Scope", "subsection kept");
  const all = X.replaceSectionBody(d, sec, [M.para("Only.")]);
  assert.equal(all.doc.blocks.length, d.blocks.length - 2);
});

test("moveSection and shiftSectionLevel restructure the outline", () => {
  const d = sample();
  const moved = X.moveSection(d, X.findSection(d, "Next steps"), X.findSection(d, "Introduction"), "before");
  assert.deepEqual(X.sections(moved).map((s) => s.text), ["Next steps", "1. Introduction", "Scope", "Costs"]);
  assert.equal(moved.blocks.length, d.blocks.length);
  const back = X.moveSection(moved, X.findSection(moved, "Next steps"), X.findSection(moved, "Costs"), "after");
  assert.deepEqual(back.blocks, d.blocks);
  assert.throws(() => X.moveSection(d, X.findSection(d, "Introduction"), X.findSection(d, "Scope")), /into itself/);
  const demoted = X.shiftSectionLevel(d, X.findSection(d, "Introduction"), 1);
  assert.deepEqual(X.sections(demoted).slice(0, 2).map((s) => s.level), [2, 3]);
});

test("tables, slide plan and accessibility check", () => {
  const d = sample();
  assert.deepEqual(X.listTables(d), [{ index: 7, rows: 2, columns: 2, header: true, caption: "Budget table:" }]);
  assert.deepEqual(X.tableRows(d.blocks[7]), [["Item", "Cost"], ["Rent", "1,200"]]);
  const plan = X.slidePlan(d, { level: 1 });
  assert.equal(plan[0].layout, "title");
  assert.equal(plan[0].title, "Plan 2027");
  assert.deepEqual(plan[1], { layout: "title-content", title: "1. Introduction", bullets: ["We start.", "Scope", "Scope text."] });
  assert.deepEqual(plan[2].bullets, ["Budget table:", "[table: 2 rows]"]);
  assert.equal(X.accessibilityCheck(d).count, 0);
  const bad = { ...d, meta: { ...d.meta, title: "" }, blocks: [M.heading(1, "A"), M.heading(3, "B"), M.para([{ text: "here", link: "https://x.test" }, { text: " grey", color: "#bbbbbb" }]), { ...d.blocks[7], rows: d.blocks[7].rows.map((r) => ({ ...r, header: false })) }] };
  assert.deepEqual(X.accessibilityCheck(bad).issues.map((i) => i.rule).sort(), ["contrast", "heading-order", "link-text", "table-header", "title"]);
  assert.ok(X.contrast("#000000", "#ffffff") > 20);
});

test("semantic Vibe tools: rewrite and move sections on the active document, with undo-able commits", async () => {
  const { OfficeProject } = await import("../../app/src/core/office.js");
  const doc = { name: "Plan", office: new OfficeProject(sample()), history: null };
  const app = { doc, docs: [doc], emit() {}, on() {} };
  const tools = Object.fromEntries(officeSemanticTools(app).map((t) => [t.name, t]));
  let committed = null;
  const core = await import("../../app/src/core/office.js");
  // run against a fake editor so the test does not depend on the history implementation
  app.officeUI = { doc, editor: { commit: (next, o) => ((committed = o.label), (doc.office.model = next)) } };
  const list = await tools.office_list_sections.run({});
  assert.equal(list.sections.length, 4);
  assert.equal(list.sections[0].words, 8);
  await assert.rejects(tools.office_rewrite_section.run({ heading: "Costs", markdown: "# Costs\n\nx" }), /body only/);
  const r = await tools.office_rewrite_section.run({ heading: "Costs", markdown: "Costs rose **8%**.\n\n- Rent\n- Staff" });
  assert.equal(committed, "Vibe: Rewrite Section");
  assert.equal(r.replacedBlocks, 3);
  const sec = await tools.office_read_section.run({ heading: "costs" });
  assert.deepEqual(sec.blocks.map((b) => b.text), ["Costs rose 8%.", "Rent", "Staff"]);
  const mv = await tools.office_move_section.run({ heading: "Next steps", target: "Introduction", where: "before" });
  assert.equal(mv.outline[0], "Next steps");
  assert.equal((await tools.office_check_accessibility.run({})).count, 0);
  assert.ok(core.commitOffice);
  for (const t of Object.values(tools)) assert.match(t.description, /Watch out/, `${t.name} explains pitfalls`);
});

test("office skills parse and each has Watch out and Verify sections", () => {
  for (const md of OFFICE_SKILLS) {
    const s = parseSkill(md);
    assert.ok(s.allowedTools.length > 3, s.id);
    assert.match(s.body, /## Watch out/, s.id);
    assert.match(s.body, /## Verify/, s.id);
  }
  assert.equal(OFFICE_SKILLS.length, 14);
});

test("sheet data bars: lengths from the range extent, negatives left of zero, xlsx round trip", () => {
  let m = SM.newWorkbook();
  const sid = m.active;
  m = SM.setCells(m, sid, { A1: { v: -5 }, A2: { v: 5 }, A3: { v: 15 } });
  m = SM.updateSheet(m, sid, (s) => ({ ...s, cf: [{ id: "cf1", range: "A1:A3", type: "bar", colors: ["#123456"] }] }));
  const rules = SM.sheetById(m, sid).cf;
  const stats = () => ({ min: -5, max: 15 });
  assert.deepEqual(SM.cfStyle(rules, 0, 0, -5, stats).bar, { from: 0, to: 0.25, color: "#123456" });
  assert.deepEqual(SM.cfStyle(rules, 2, 0, 15, stats).bar, { from: 0.25, to: 1, color: "#123456" });
  assert.equal(SM.cfStyle(rules, 0, 0, "text", stats), null);
  const back = readXlsx(writeXlsx(m, { calc: createCalc(m) }));
  assert.deepEqual(back.sheets[0].cf.map((r) => [r.type, r.range, r.colors[0]]), [["bar", "A1:A3", "#123456"]]);
});
