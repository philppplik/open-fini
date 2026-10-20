// Routes files of other applications to their importers: PDF, Illustrator (PDF-compatible), PDF-wrapped EPS, Sketch,
// and the guidance dialogs for formats OpenFini cannot read (Affinity, InDesign, Figma, XD, ...).
// `openForeign` returns the opened document, `null` when it handled the file without opening a document (dialog,
// cancel) and `undefined` when the file is not one of its formats.
import { foreignFormatInfo } from "./foreign.js";

export const FOREIGN_EXT = /\.(pdf|ai|eps|sketch|afdesign|afphoto|afpub|aftemplate|afpackage|indd|indt|fig|xd|cdr|pxd|kra|xcf)$/i;

const isPdfMagic = (b) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** Shows the import report: automatically when something was flattened or dropped, otherwise as a toast. */
export async function announceImport(app, doc, report, what) {
  if (report.by("flattened").length || report.by("dropped").length) {
    const { showImportReport } = await import("../ui/import-dialogs.js");
    showImportReport(report, app);
  } else app.toast(`${what} opened (${report.summary()}). File ▸ Import Report… shows details.`, "success", 4200);
}

function present(app, doc, studio) {
  doc.history.clear();
  doc.saved = true;
  app.setStudio(studio);
  app.openDoc(doc);
  requestAnimationFrame(() => app.cv?.fitPage());
}

/** Opens PDF bytes (also used for Illustrator and EPS files that contain a PDF). */
export async function openPdfFile(app, file, { format = "PDF", offset = 0 } = {}) {
  const imp = await import("../core/import-pdf.js");
  const dialogs = await import("../ui/import-dialogs.js");
  const bytes = offset ? file.bytes.subarray(offset) : file.bytes;
  app.status("Reading PDF…");
  let src;
  try {
    src = await imp.openPdfWithPassword(bytes, dialogs.askPdfPassword);
  } finally {
    app.status("");
  }
  const options = await dialogs.pdfImportDialog({ name: file.name, pages: src.pages, encrypted: src.encrypted });
  if (!options) {
    src.destroy();
    return null;
  }
  const progress = dialogs.progressDialog(`Importing ${file.name}`);
  try {
    const { doc, report } = await imp.openPdfDocument(app, { ...file, bytes }, { ...options, src, progress, format });
    if (format !== "PDF") report.note("Only what the PDF-compatible part of the file contains was imported: artboards, layers, live effects and other Illustrator-specific data are not available.");
    present(app, doc, "layout");
    progress.close();
    announceImport(app, doc, report, `“${file.name}”`);
    return doc;
  } catch (e) {
    progress.close();
    src.destroy?.();
    throw e;
  }
}

/** File ▸ Insert Pages from PDF… */
export async function insertPdfFromFile(app, file) {
  const imp = await import("../core/import-pdf.js");
  const dialogs = await import("../ui/import-dialogs.js");
  app.status("Reading PDF…");
  let src;
  try {
    src = await imp.openPdfWithPassword(file.bytes, dialogs.askPdfPassword);
  } finally {
    app.status("");
  }
  const options = await dialogs.pdfImportDialog({ name: file.name, pages: src.pages, encrypted: src.encrypted, insert: true });
  if (!options) {
    src.destroy();
    return null;
  }
  const progress = dialogs.progressDialog(`Inserting pages from ${file.name}`);
  try {
    const doc = app.doc;
    const res = await imp.insertPdfPages(app, doc, file, { ...options, src, progress, afterIndex: doc.pages.indexOf(app.page) });
    progress.close();
    app.emit("docchange", {});
    app.requestRender?.();
    app.toast(`Inserted ${res.count} page${res.count === 1 ? "" : "s"} from “${file.name}”.`, "success", 3000);
    return res;
  } catch (e) {
    progress.close();
    src.destroy?.();
    throw e;
  }
}

async function openAffinityPreview(app, file, preview) {
  const { openImageAsDocument } = await import("./io.js");
  const ext = preview.mime === "image/png" ? "png" : "jpg";
  const doc = await openImageAsDocument(app, { name: `${file.name.replace(/\.[^.]+$/, "")} (embedded preview).${ext}`, bytes: preview.bytes });
  doc.name = `${file.name.replace(/\.[^.]+$/, "")} (preview only)`;
  app.toast("Opened the low-resolution preview image that was found inside the file. It is flattened; the editable content could not be read.", "warning", 8000);
  return doc;
}

export async function openForeign(app, file) {
  const name = file.name || "";
  const bytes = file.bytes;
  const dialogs = () => import("../ui/import-dialogs.js");
  if (isPdfMagic(bytes) || /\.pdf$/i.test(name) || /\.ai$/i.test(name) || /\.eps$/i.test(name)) {
    const { findPdfStart } = await import("../engine/formats/index.js");
    const isAi = /\.ai$/i.test(name);
    const at = isPdfMagic(bytes) ? 0 : findPdfStart(bytes);
    if (at >= 0) return openPdfFile(app, file, { format: isAi ? "Illustrator (AI)" : /\.eps$/i.test(name) ? "EPS (PDF inside)" : "PDF", offset: at });
    const info = foreignFormatInfo(name);
    if (info) {
      (await dialogs()).foreignFormatDialog(info, { app });
      return null;
    }
    throw new Error(`“${name}” does not look like a PDF file.`);
  }
  if (/\.sketch$/i.test(name)) {
    const { openSketch } = await import("./import-sketch.js");
    const { doc, report } = await openSketch(app, file);
    present(app, doc, "vector");
    announceImport(app, doc, report, `“${name}”`);
    return doc;
  }
  const info = foreignFormatInfo(name);
  if (info) {
    const { findEmbeddedPreview } = await import("../engine/formats/index.js");
    const extra = [];
    if (info.preview) {
      let preview = null;
      try {
        preview = findEmbeddedPreview(bytes, { maxScanBytes: 256 * 1024 * 1024 });
      } catch {
        preview = null;
      }
      if (preview) extra.push({ label: `Open embedded preview (${preview.width} × ${preview.height})`, run: () => openAffinityPreview(app, file, preview).catch((e) => app.toast(e.message, "danger", 6000)) });
      else info.message += " No plain preview image could be found inside this file either.";
    }
    (await dialogs()).foreignFormatDialog(info, { app, extra });
    return null;
  }
  return undefined;
}
