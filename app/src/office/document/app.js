// Document app (word processor) implementation of the Office Suite contract (docs/office-suite.md). A thin adapter:
// the editor lives in ui/office/ (workspace, editor, dialogs) and the codecs in engine/office/ (DOCX, ODT, RTF, HTML,
// Markdown, text, PDF). Loaded on first use by office/apps.js ▸ loadOfficeApp("document").
//
// Contract members implemented here: create, open, save, mount, describe, find (through the workspace's own bar),
// aiAdapter (describe + system note; its tools are the static office_* group in vibe/tools/office.js), commentAnchors
// (text ranges, collab/anchors.js ▸ officeAnchor). No collabAdapter: word-processing documents are shared as copies.
import * as M from "../../engine/office/model.js";

/** Normalizes a stored model once (files from disk, older versions, Vibe edits). */
export function ensureModel(prj) {
  if (prj.model._raw || prj.model.version !== M.OFFICE_VERSION || !Array.isArray(prj.model.blocks)) prj.model = M.normalizeDoc(prj.model);
  return prj.model;
}

/** Short, model-only summary for Vibe and the launcher (no DOM). */
export function describe(model) {
  const m = model.version === M.OFFICE_VERSION && Array.isArray(model.blocks) ? model : M.normalizeDoc(model);
  const s = M.stats(m);
  return { kind: "document", title: m.meta?.title || "", page: `${m.page.size} ${m.page.orientation}`, words: s.words, blocks: m.blocks.length, outline: M.outline(m).slice(0, 30).map((o) => `${"#".repeat(o.level)} ${o.text}`) };
}

export default {
  kind: "document",

  /** A new model from a template id (manifest.templates) and page options. */
  async create({ template = "blank", size = "A4", orientation = "portrait", title = "" } = {}) {
    const { templateModel } = await import("../../ui/office/dialogs.js");
    const model = templateModel(template, size, orientation);
    if (title) model.meta.title = title;
    return model;
  },

  /**
   * Reads a file. Templates (.dotx, .dotm, .ott) open as a new untitled document (`asNew`).
   * @returns {{ model: object, format: object, asNew: boolean }}
   */
  async open(bytes, name, { report } = {}) {
    const { importOffice } = await import("../../engine/office/index.js");
    const res = importOffice(name, bytes, { report });
    const asNew = /\.(dotx|dotm|ott)$/i.test(name);
    return { model: res.doc, format: res.format, asNew };
  },

  /**
   * Writes the model in a format id of the manifest ("docx", "odt", "rtf", "html", "md", "txt", "pdf").
   * @returns {Promise<{ bytes: Uint8Array, mime: string, ext: string, notes?: string[] }>}
   */
  async save(model, format, { title = "" } = {}) {
    const { rasterize } = await import("../../ui/office/dialogs.js");
    if (format === "pdf") {
      const images = await rasterize(model.media, { rgba: true });
      const { exportPdf } = await import("../../engine/office/pdf.js");
      return { bytes: exportPdf(model, { images, title: model.meta?.title || title }), mime: "application/pdf", ext: "pdf" };
    }
    const svgFallbacks = format === "docx" || format === "rtf" ? await rasterize(model.media) : {};
    const { exportOffice } = await import("../../engine/office/index.js");
    const { officeFidelityNotes } = await import("../../core/source-format.js");
    const out = exportOffice(model, format, { svgFallbacks, title: model.meta?.title || title });
    return { ...out, notes: officeFidelityNotes(model, format) };
  },

  /** Mounts the word processor. Returns the instance that becomes `app.officeUI`. */
  async mount(host, doc, app) {
    ensureModel(doc.office);
    const { OfficeWorkspace } = await import("../../ui/office/workspace.js");
    const ws = new OfficeWorkspace(app, doc);
    host.replaceChildren(ws.el);
    ws.kind = "document";
    ws.destroy = () => ws.el.remove();
    ws.exportDialog = () => import("../../ui/office/dialogs.js").then((m) => m.exportOfficeDialog(app, ws));
    return ws;
  },

  describe,
  aiAdapter: { describe },
};

