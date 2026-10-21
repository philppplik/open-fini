// PDF page commands: insert pages from a PDF, extract pages as a PDF, show the import report of the document.
import { downloadName } from "../core/util.js";
import { platform } from "../platform/index.js";

const hasDoc = (a) => !!a.doc;
const PDF_FILTERS = [{ name: "PDF documents", extensions: ["pdf"] }];

export function registerPdfCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });

  def("file.insertPdf", "Insert Pages from PDF…", async (a) => {
    const files = await platform.openFiles({ accept: PDF_FILTERS, multiple: false });
    if (!files.length) return;
    try {
      await (await import("../core/open-foreign.js")).insertPdfFromFile(a, files[0]);
    } catch (err) {
      a.toast(err.message, "danger", 6000);
    }
  }, { enabled: hasDoc, icon: "file-earmark-pdf" });

  def("file.extractPages", "Extract Pages as PDF…", async (a) => {
    const doc = a.doc;
    if (!doc) return;
    const { promptDialog } = await import("../ui/dialogs.js");
    const { parsePageRange } = await import("../core/pdf-source.js");
    const text = await promptDialog({ title: "Extract pages", label: `Pages to extract (1-${doc.pages.length}), for example 1-3, 5`, value: doc.pages.length > 1 ? `${doc.pages.indexOf(a.page) + 1}` : "1", ok: "Extract" });
    if (text == null) return;
    const nums = parsePageRange(text, doc.pages.length);
    if (!nums || !nums.length) return a.toast("That page range is not valid.", "warning");
    try {
      a.status("Writing PDF…");
      const { exportPdf } = await import("../core/io.js");
      const bytes = await exportPdf(a, nums.map((n) => doc.pages[n - 1]));
      const res = await platform.saveFile({ suggestedName: downloadName(`${doc.name} pages ${text.replace(/\s+/g, "")}`, "pdf"), bytes, mime: "application/pdf", filters: PDF_FILTERS });
      if (res) a.toast(`Extracted ${nums.length} page${nums.length === 1 ? "" : "s"} to ${res.name}.`, "success", 2400);
    } catch (err) {
      a.toast(err.message, "danger", 6000);
    } finally {
      a.status("");
    }
  }, { enabled: hasDoc });

  def("file.importReport", "Import Report…", async (a) => {
    const report = a.doc?.importReport;
    if (!report) return a.toast("This document was not imported from another file format.", "primary", 2600);
    (await import("../ui/import-dialogs.js")).showImportReport(report, a);
  }, { enabled: (a) => !!a.doc?.importReport });
}
