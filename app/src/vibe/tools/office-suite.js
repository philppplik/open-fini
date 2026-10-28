// Vibe tools common to every Office Suite app (docs/office-suite.md ▸ Vibe): what apps and templates exist, what the
// open Office documents are, a kind-aware description of the active one (the app's aiAdapter.describe), and creating
// a new document of any kind. Opening files goes through open_attachment / File ▸ Open, which route Office files to
// the suite registry; exporting is office_export (kind-aware). App-specific editing tools live in their own files
// (office.js for text documents; office-<kind>.js for the other apps).
import { tool, S } from "./helpers.js";

const suite = () => import("../../office/index.js");

export function officeSuiteTools(app) {
  return [
    tool("office_formats", "Lists the Office apps available in this version (document, sheet, slides, board …) with the file formats each opens and writes and its templates.", {}, [], async () => {
      const { officeApps } = await suite();
      return {
        apps: officeApps().map((m) => ({
          kind: m.kind,
          label: m.label,
          opens: m.formats.filter((f) => f.read).flatMap((f) => f.ext.map((e) => `.${e}`)),
          writes: m.formats.filter((f) => f.write).map((f) => f.id),
          templates: m.templates.map((t) => ({ id: t.id, label: t.label })),
        })),
        note: "Google Docs/Sheets/Slides files (.gdoc, .gsheet, .gslides) are cloud links: the user must download a .docx/.xlsx/.pptx copy first.",
      };
    }, { readOnly: true }),

    tool("office_list_documents", "Lists the open Office documents (name, kind, whether it is active and saved).", {}, [], async () => {
      const { officeKindOf } = await suite();
      return { documents: app.docs.filter((d) => d.office).map((d) => ({ name: d.name, kind: officeKindOf(d), active: d === app.doc, saved: !!d.saved, source: d.source?.name || null })) };
    }, { readOnly: true }),

    tool("office_describe", "Describes the active Office document for its kind: title, size, structure (outline, sheets, slides or board items, as the app reports it) and the formats it can export.", {}, [], async () => {
      const { officeKindOf, officeApp, loadOfficeApp } = await suite();
      const d = app.doc;
      const kind = officeKindOf(d);
      if (!kind) throw new Error("The active document is not an Office document. Use office_new to create one or office_list_documents to find one.");
      const m = officeApp(kind);
      if (!m) return { name: d.name, kind, note: "This version has no app for this kind; the document is kept unchanged." };
      const impl = await loadOfficeApp(kind);
      const describe = impl.aiAdapter?.describe || impl.describe;
      return { name: d.name, kind, app: m.label, exports: m.formats.filter((f) => f.write).map((f) => f.id), ...(describe ? { summary: describe(d.office.model) } : {}) };
    }, { readOnly: true }),

    tool("office_new", "Creates a new Office document of a kind (document, sheet, slides, board — see office_formats) from a template, opens it in the Office studio and makes it active.", {
      kind: S.str("App kind, e.g. document, sheet, slides, board"),
      template: S.str("Template id from office_formats (default blank)"),
      title: S.str("Document name"),
    }, ["kind"], async ({ kind, template = "blank", title }) => {
      const { officeApp } = await suite();
      const m = officeApp(kind);
      if (!m) throw new Error(`No Office app for "${kind}" in this version. Call office_formats for the available kinds.`);
      if (template !== "blank" && !m.templates.some((t) => t.id === template)) throw new Error(`Unknown template "${template}" for ${kind}. Templates: ${m.templates.map((t) => t.id).join(", ")}.`);
      const { createOfficeDocument } = await import("../../ui/office/open.js");
      const doc = await createOfficeDocument(app, kind, { template, title });
      return { ok: true, name: doc.name, kind };
    }),
  ];
}
