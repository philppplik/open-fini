// Office Studio wiring: file routing stays consistent, and the Vibe tools edit the document through undoable steps.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OFFICE_ONLY_EXTS } from "../../app/src/engine/office/index.js";
import { FILE_TYPES } from "../../app/src/platform/file-types.js";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject } from "../../app/src/core/office.js";
import * as M from "../../app/src/engine/office/model.js";
import { officeTools } from "../../app/src/vibe/tools/office.js";

test("File ▸ Open routes exactly the office-only extensions to the Office Studio", () => {
  const src = readFileSync(new URL("../../app/src/commands/file.js", import.meta.url), "utf8");
  const m = /const OFFICE_FILE = \/\\\.\(([^)]*)\)\$\/i;/.exec(src);
  assert.ok(m, "OFFICE_FILE not found");
  assert.deepEqual(m[1].split("|").sort(), [...OFFICE_ONLY_EXTS].sort());
  for (const ext of ["docx", "odt", "rtf"]) assert.equal(FILE_TYPES.find((t) => t.ext.includes(ext))?.kind, "office", ext);
});

test("Vibe office tools edit the model as undoable steps", async () => {
  const doc = new Doc({ name: "T", studio: "office" });
  doc.office = new OfficeProject(M.createDocument());
  const app = { doc, officeUI: null, prefs: {}, on() {}, emit() {} };
  const tools = Object.fromEntries(officeTools(app).map((t) => [t.name, t]));
  const r = await tools.office_insert_blocks.run({ blocks: [{ type: "heading", text: "Intro", level: 1 }, { type: "paragraph", text: "Hello **world**" }, { type: "bullet", text: "a" }, { type: "bullet", text: "b" }] });
  assert.equal(r.inserted, 4);
  let m = doc.office.model;
  assert.equal(M.headingLevel(m, m.blocks[0]), 1);
  assert.ok(m.blocks[1].runs.find((x) => x.text === "world").b);
  assert.equal(m.blocks[2].list.id, m.blocks[3].list.id);
  assert.deepEqual(tools.office_replace_text.run({ find: "Hello", replace: "Hi" }), { replaced: 1 });
  tools.office_apply_format.run({ find: "Hi", marks: { color: "#ff0000", underline: true }, paragraph: { align: "center" } });
  m = doc.office.model;
  assert.equal(m.blocks[1].runs[0].color, "#ff0000");
  assert.equal(m.blocks[1].props.align, "center");
  tools.office_insert_table.run({ rows: [["a", "b"], ["1", "2"]] });
  tools.office_insert_table.run({ rows: [["x"]] });
  m = doc.office.model;
  const ti = m.blocks.findIndex((b) => b.type === "table");
  assert.equal(m.blocks[ti + 1].type, "paragraph", "tables are kept apart");
  const read = tools.office_read_document.run({});
  assert.equal(read.outline[0].text, "Intro");
  assert.equal(tools.office_find.run({ query: "world" }).count, 1);
  await tools.office_set_style.run({ style: "Callout", define: { name: "Callout", bold: true, color: "#0000ff" }, paragraphs: [1] });
  assert.equal(doc.office.model.blocks[1].style, "Callout");
  assert.ok(M.resolveStyle(doc.office.model, "Callout").run.b);
  // every call was one history step; undo walks back to the empty document
  while (doc.history.canUndo) doc.undo();
  assert.equal(M.paraText(doc.office.model.blocks[0]), "");
  assert.throws(() => officeTools({ doc: new Doc({}), prefs: {} }).find((t) => t.name === "office_read_document").run({}), /not an Office document/);
  assert.ok(tools.office_export.needsApproval({ format: "pdf" }));
});
