// Opening and creating Office documents of every kind (Office Suite: docs/office-suite.md). File ▸ Open, drag and drop,
// "Open with" and Vibe's open_attachment reach openOfficeFile through commands/file.js; the registry
// (office/apps.js) decides which app opens a file. Formats without a registered app (yet), Google Drive shortcuts,
// Apple iWork and legacy binary formats get an honest guidance dialog instead of a broken import.
//
// Public API
//   openOfficeModel(app, model, { kind, name, report, saved }) → doc     wraps a model in a new OpenFini document
//   createOfficeDocument(app, kind, { template, title, ... }) → doc       new document from an app template
//   openOfficeFile(app, file) → doc | null                                routing + import report + recents
//   guidanceDialog(app, info, fmt, file)
import { Doc } from "../../core/doc.js";
import { OfficeProject } from "../../core/office.js";
import { ImportReport, attachReport } from "../../core/import-report.js";
import { addRecent } from "../../core/storage.js";
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { openDialog } from "../dialogs.js";

const PX = 96 / 72;
/** Engine format kinds (engine/office/index.js FORMATS) → Office app kinds. */
const KIND_OF_FORMAT = { document: "document", spreadsheet: "sheet", presentation: "slides", whiteboard: "board" };

/** Opens an Office model as a new OpenFini document in the Office Studio. */
export function openOfficeModel(app, model, { kind = "document", name = "Untitled", report = null, saved = true } = {}) {
  const page = model?.page;
  const w = page?.width ? Math.round(page.width * PX) : 1280;
  const hgt = page?.height ? Math.round(page.height * PX) : 720;
  const doc = new Doc({ name, studio: "office", width: w, height: hgt, pages: 1 });
  doc.office = new OfficeProject(model, kind);
  if (report) attachReport(doc, report);
  doc.history.clear();
  doc.saved = saved;
  app.officeHome = false;
  app.setStudio("office");
  app.openDoc(doc);
  return doc;
}

/** Creates a new document of an Office app kind from one of its templates. */
export async function createOfficeDocument(app, kind = "document", opts = {}) {
  const { officeApp, loadOfficeApp } = await import("../../office/index.js");
  const m = officeApp(kind);
  if (!m) throw new Error(t("No Office app is available for “{kind}”.", { kind }));
  const impl = await loadOfficeApp(kind);
  const tpl = m.templates.find((x) => x.id === opts.template);
  const title = opts.title || (tpl && tpl.id !== "blank" ? t(tpl.label) : t("Untitled {app}", { app: t(m.label).toLowerCase() }));
  const model = await impl.create({ ...opts, title });
  return openOfficeModel(app, model, { kind, name: title, saved: false });
}

/** File ▸ Open, drag and drop and "Open with" for Office files. */
export async function openOfficeFile(app, file) {
  const [{ detectOfficeFormat, officeGuidance }, suite] = await Promise.all([import("../../engine/office/index.js"), import("../../office/index.js")]);
  const fmt = detectOfficeFormat(file.name, file.bytes); // content first: a renamed .xlsx is still a workbook
  const byName = suite.appForFile(file.name);
  const kind = (fmt && KIND_OF_FORMAT[fmt.kind]) || byName?.app.kind || null;
  const hit = kind && byName?.app.kind === kind ? byName : kind ? appFormatFor(suite, kind, fmt) : null;
  if (!hit) {
    if (!fmt) throw new Error(t("“{name}” is not a document Office Studio can open.", { name: file.name }));
    guidanceDialog(app, officeGuidance(fmt, { name: file.name, bytes: file.bytes }), fmt, file);
    return null;
  }
  const impl = await suite.loadOfficeApp(hit.app.kind);
  if (typeof impl.open !== "function") throw new Error(t("The {app} app cannot open files.", { app: hit.app.label }));
  const report = new ImportReport(hit.format.label, file.name);
  app.status(t("Opening {name}…", { name: file.name }));
  let res;
  try {
    res = await impl.open(file.bytes, file.name, { report, app });
  } finally {
    app.status("");
  }
  const base = file.name.replace(/\.[^.]+$/, "") || t("Document");
  const asNew = !!(res.asNew || hit.format.template);
  const doc = openOfficeModel(app, res.model, { kind: hit.app.kind, name: asNew ? t("{name} (new)", { name: base }) : base, report, saved: !asNew });
  // other kinds record their save-back target here; the word processor keeps core/source-format.js describeSource
  if (!asNew && hit.app.kind !== "document") {
    const ext = (/\.([^./\\]+)$/.exec(file.name)?.[1] || "").toLowerCase();
    if (hit.format.write) doc.source = { name: file.name, ...(file.path ? { path: file.path } : {}), ...(file.handle ? { handle: file.handle } : {}), format: ext, kind: "office", officeKind: hit.app.kind, officeId: hit.format.id, lossy: !!hit.format.lossy };
  }
  if (!asNew) addRecent({ name: file.name, bytes: file.bytes, path: file.path }).then((r) => app.emit("recents", r)).catch(() => {});
  if (report.attention) app.toast(t("Opened {name}: {summary}.", { name: file.name, summary: report.summary() }), "primary", 6000, { label: t("Details"), run: () => import("../import-dialogs.js").then((m) => m.showImportReport(report, app)) });
  return doc;
}

/** The app format that reads a detected engine format (content-sniffed files with an unexpected extension). */
function appFormatFor(suite, kind, fmt) {
  const m = suite.officeApp(kind);
  const format = m?.formats.find((f) => f.read && (f.id === fmt?.id || fmt?.ext?.some((e) => f.ext.includes(e))));
  return format ? { app: m, format } : null;
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
