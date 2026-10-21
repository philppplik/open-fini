// Opening files in the Office Studio: DOCX / ODT / RTF / HTML / Markdown / text become office documents with an import
// report; Google Docs shortcuts, Pages, legacy .doc, spreadsheets and presentations get an honest guidance dialog.
import { Doc } from "../../core/doc.js";
import { OfficeProject } from "../../core/office.js";
import { ImportReport, attachReport } from "../../core/import-report.js";
import { addRecent } from "../../core/storage.js";
import { h } from "../../core/util.js";
import { openDialog } from "../dialogs.js";

const PX = 96 / 72;

/** Opens an office model as a new OpenFini document in the Office Studio. */
export function openOfficeModel(app, model, { name = "Untitled", report = null, saved = true } = {}) {
  const doc = new Doc({ name, studio: "office", width: Math.round(model.page.width * PX), height: Math.round(model.page.height * PX), pages: 1 });
  doc.office = new OfficeProject(model);
  if (report) attachReport(doc, report);
  doc.history.clear();
  doc.saved = saved;
  app.setStudio("office");
  app.openDoc(doc);
  return doc;
}

/** File ▸ Open, drag and drop and "Open with" for office files. */
export async function openOfficeFile(app, file) {
  const { detectOfficeFormat, officeGuidance, importOffice } = await import("../../engine/office/index.js");
  const fmt = detectOfficeFormat(file.name, file.bytes);
  if (!fmt) throw new Error(`“${file.name}” is not a document Office Studio can open.`);
  if (!fmt.read) {
    guidanceDialog(app, officeGuidance(fmt, { name: file.name, bytes: file.bytes }), fmt, file);
    return null;
  }
  const report = new ImportReport(fmt.label, file.name);
  app.status(`Opening ${file.name}…`);
  let res;
  try {
    res = importOffice(file.name, file.bytes, { report });
  } finally {
    app.status("");
  }
  const doc = openOfficeModel(app, res.doc, { name: file.name.replace(/\.[^.]+$/, "") || "Document", report });
  addRecent({ name: file.name, bytes: file.bytes, path: file.path }).then((r) => app.emit("recents", r)).catch(() => {});
  if (report.attention) app.toast(`Opened ${file.name}: ${report.summary()}.`, "primary", 6000, { label: "Details", run: () => import("../import-dialogs.js").then((m) => m.showImportReport(report, app)) });
  return doc;
}

/** Explains formats Office Studio does not open (yet), with a button to the cloud document where there is one. */
export function guidanceDialog(app, info, fmt, file) {
  if (!info) return;
  const body = h("div.of-foreign", h("p.of-dialog__text", info.message));
  if (info.steps?.length) body.append(h("ol.of-foreign__steps", ...info.steps.map((s) => h("li", s))));
  const buttons = [];
  if (info.url) buttons.push({ label: "Open in browser", onClick: (close) => (close(), import("../links.js").then((m) => m.openLink(info.url, { app }))) });
  if (fmt?.id === "csv" && file) buttons.push({ label: "Open as text (Code studio)", onClick: (close) => (close(), import("../code/open-document.js").then((m) => m.openTextDocument(app, file))) });
  buttons.push({ label: "Open converted file…", onClick: (close) => (close(), app.run("file.open")) });
  buttons.push({ label: "Close", variant: "primary", onClick: (close) => close() });
  return openDialog({ title: info.title, body, width: 540, buttons });
}
