// Office Suite export service: writes the active Office document in any format its app declares (`formats[].write`)
// and asks where to save it. Used by the office.export command, the Vibe tools and apps that want a one-call export.
//
// Public API
//   exportFormats(kind) → OfficeFormat[]                      writable formats of an app (manifest order)
//   renderOfficeFile(doc, formatId) → { bytes, mime, ext, notes }   no UI: the app's save()
//   exportOfficeDoc(app, doc, formatId) → platform.saveFile result | null
//   officeExportDialog(app)                                   the app's own dialog (inst.exportDialog) or a generic one
// Invariants: never writes over the source file (that is File ▸ Save, commands/save-source.js); the suggested name is
// the document name with the format's first extension.
import { downloadName, h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { officeApp, loadOfficeApp, officeKindOf } from "../index.js";

export function exportFormats(kind) {
  return (officeApp(kind)?.formats || []).filter((f) => f.write);
}

export async function renderOfficeFile(doc, formatId) {
  const kind = officeKindOf(doc);
  if (!kind) throw new Error(t("The active document is not an Office document."));
  const format = exportFormats(kind).find((f) => f.id === formatId);
  if (!format) throw new Error(t("{app} documents cannot be exported as “{format}”.", { app: officeApp(kind)?.label || kind, format: formatId }));
  const impl = await loadOfficeApp(kind);
  if (typeof impl.save !== "function") throw new Error(t("This app cannot export files."));
  const out = await impl.save(doc.office.model, formatId, { title: doc.name, doc });
  return { mime: format.mime || "application/octet-stream", ext: format.ext[0], notes: [], ...out };
}

export async function exportOfficeDoc(app, doc, formatId) {
  const { platform } = await import("../../platform/index.js");
  app.status(t("Exporting {format}…", { format: formatId.toUpperCase() }));
  try {
    const out = await renderOfficeFile(doc, formatId);
    const base = String(doc.name || "Document").replace(/\.[a-z0-9]{2,5}$/i, "");
    const res = await platform.saveFile({ suggestedName: downloadName(base, out.ext), bytes: out.bytes, mime: out.mime, filters: [{ name: formatId.toUpperCase(), extensions: [out.ext] }] });
    if (res) app.toast(out.notes?.length ? `${t("Exported {name}.", { name: res.name })} ${out.notes.join(" ")}` : t("Exported {name}.", { name: res.name }), "success", out.notes?.length ? 6000 : 2200);
    return res;
  } finally {
    app.status("");
  }
}

export async function officeExportDialog(app) {
  const inst = app.officeUI;
  if (inst?.exportDialog) return inst.exportDialog();
  const doc = app.doc;
  const formats = exportFormats(officeKindOf(doc));
  if (!formats.length) return app.toast(t("This document has no export formats."), "warning");
  const { openDialog } = await import("../../ui/dialogs.js");
  const sel = h("select.of-oinput", { "aria-label": t("Format") }, formats.map((f) => h("option", { value: f.id }, `${t(f.label)} (.${f.ext[0]})`)));
  const hint = h("p.of-hint", t("The OpenFini document (.ofini, File ▸ Save) keeps everything; exports are copies in other formats."));
  openDialog({
    title: t("Export"),
    body: h("div.of-oform", h("label.of-ofield", h("span", t("Format")), sel), hint),
    width: 480,
    buttons: [
      { label: t("Cancel"), onClick: (c) => c() },
      { label: t("Export…"), variant: "primary", onClick: (c) => (c(), exportOfficeDoc(app, doc, sel.value).catch((e) => app.toast(e.message, "danger", 6000))) },
    ],
  });
}
