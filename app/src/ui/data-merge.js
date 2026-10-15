// Data Merge dialog: load a CSV file, preview records in the document, export one PDF with a copy of the
// document per record. `<<Field Name>>` markers in any text are replaced by the record's values.
import { h, empty, downloadName } from "../core/util.js";
import { openDialog } from "./dialogs.js";
import { button, numField } from "./controls.js";
import { parseCSV, mergeFields, listFields } from "../engine/layout/data-merge.js";
import { platform } from "../platform/index.js";
import { pdfPageLists, writePdf } from "../core/io.js";

export function dataMergeDialog(app) {
  const doc = app.doc;
  const st = { table: null, index: 0, delimiter: "auto" };
  const originals = new Map(); // storyId → original story (to restore after previews/exports)

  function collectStories() {
    const ids = new Set();
    doc.walkAll((n) => n.type === "text" && n.storyId && ids.add(n.storyId), { masters: true });
    return ids;
  }
  function docFields() {
    const out = new Set();
    for (const id of collectStories()) for (const f of listFields(doc.stories[id].story)) out.add(f);
    return [...out];
  }

  function applyRecord(rec) {
    for (const id of collectStories()) {
      const entry = doc.stories[id];
      if (!originals.has(id)) originals.set(id, entry.story);
      entry.story = mergeFields(originals.get(id), rec, { missing: "keep" });
      for (const f of doc.framesOfStory(id)) doc.touch(f);
    }
    app.requestRender();
  }
  function restore() {
    for (const [id, story] of originals) {
      if (doc.stories[id]) {
        doc.stories[id].story = story;
        for (const f of doc.framesOfStory(id)) doc.touch(f);
      }
    }
    originals.clear();
    app.requestRender();
  }

  const info = h("div.of-hint");
  const fieldsBox = h("div.of-fieldchips");
  const recBox = h("div.of-form");
  const status = h("div.of-hint");

  function render() {
    empty(recBox);
    empty(fieldsBox);
    const used = docFields();
    info.textContent = used.length ? `The document uses ${used.length} merge field${used.length > 1 ? "s" : ""}. Type <<Field Name>> into any text to add more.` : "Add markers like <<First Name>> to your text first, then load a CSV file with matching column names.";
    for (const f of used) fieldsBox.append(h("span.of-fieldchip", { class: st.table && !st.table.headers.includes(f) ? "missing" : "" }, `<<${f}>>`));
    if (!st.table) return;
    const t = st.table;
    status.textContent = `${t.records.length} record${t.records.length === 1 ? "" : "s"} · columns: ${t.headers.join(", ")}`;
    const idx = numField({ label: "Preview record", value: st.index + 1, min: 1, max: Math.max(1, t.records.length), precision: 0, wide: true, onChange: (v) => {
      st.index = Math.round(v) - 1;
      applyRecord(t.records[st.index]);
    } });
    recBox.append(idx.el, h("div.of-row", button("Reset preview", restore)));
  }

  const loadBtn = button("Load CSV file…", async () => {
    const files = await platform.openFiles({ accept: [{ name: "Data files", extensions: ["csv", "tsv", "txt"] }], multiple: false });
    if (!files.length) return;
    const text = new TextDecoder().decode(files[0].bytes);
    try {
      st.table = parseCSV(text, { delimiter: "auto" });
      st.index = 0;
      if (!st.table.records.length) throw new Error("The file has no data rows.");
      applyRecord(st.table.records[0]);
      render();
    } catch (err) {
      app.toast(err.message, "danger");
    }
  });

  async function exportAll(close) {
    if (!st.table?.records.length) return app.toast("Load a CSV file first.", "warning");
    close();
    app.status("Merging…");
    try {
      const all = [];
      for (const rec of st.table.records) {
        applyRecord(rec);
        all.push(...pdfPageLists(app, doc.pages));
      }
      restore();
      const bytes = await writePdf(app, all, {});
      const r = await platform.saveFile({ suggestedName: downloadName(`${doc.name}-merged`, "pdf"), bytes, mime: "application/pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (r) app.toast(`Exported ${st.table.records.length} merged copies to ${r.name}.`, "success");
    } catch (err) {
      restore();
      app.toast(err.message || "Merge export failed.", "danger", 6000);
    } finally {
      app.status("");
    }
  }

  render();
  openDialog({
    title: "Data Merge",
    width: 540,
    body: h("div.of-form", info, fieldsBox, loadBtn, status, recBox),
    onClose: restore,
    buttons: [
      { label: "Close", onClick: (c) => c() },
      { label: "Export merged PDF", variant: "primary", onClick: (close) => exportAll(close) },
    ],
  });
}
