// File ▸ Save for documents that were opened from a file: write the file again in its own format (a .txt stays a .txt,
// a .docx stays a .docx) instead of an .ofini. The decision logic is pure (core/source-format.js); this module does the
// I/O and the one dialog that appears when edits made the document too rich for its source format.
//
// Public API
//   saveBySource(app, doc, forceDialog) -> "done" | "ofini"
//       "done": handled (saved, copy saved or cancelled); "ofini": the caller writes an .ofini instead.
//   askLostFormat(app, doc, decision)   -> "ofini" | "copy" | "cancel"   (the dialog)
//   sourceSaveFilters(doc, decision)    -> filters for Save As: the source format first, .ofini as the alternative
//   produceSource(app, doc, decision)   -> { bytes, notes[] }   bytes of the document in its source format
// Invariants
//   * Never overwrites the source file with something that loses data silently: raster, PSD, PDF ... sources are
//     "ofini-only" and never reach the write path; Save As offers them as an export.
//   * doc.path stays reserved for .ofini files; the source location lives in doc.source (path | handle).
import { platform } from "../platform/index.js";
import { t } from "../i18n/index.js";
import { h } from "../core/util.js";
import { saveOfini, OFINI_MIME } from "../core/ofini.js";
import { addRecent } from "../core/storage.js";
import { canSaveAsSource, encodeText, officeFidelityNotes, extOf, baseOf } from "../core/source-format.js";
import { openDialog } from "../ui/dialogs.js";

const OFINI_FILTER = { name: "OpenFini document", extensions: ["ofini"] };
const MIMES = { txt: "text/plain", md: "text/markdown", html: "text/html", htm: "text/html", json: "application/json", csv: "text/csv", svg: "image/svg+xml", rtf: "application/rtf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", odt: "application/vnd.oasis.opendocument.text" };
const RASTER_EXPORT = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" };

/** Filters for the Save As dialog: the original format first, .ofini as the alternative. */
export function sourceSaveFilters(doc, decision) {
  const ext = extOf(decision.name || doc.source?.name) || doc.source?.format;
  if (decision.ok) return [{ name: `${ext.toUpperCase()} (original format)`, extensions: [ext] }, OFINI_FILTER];
  if (doc.source && RASTER_EXPORT[doc.source.format]) return [OFINI_FILTER, { name: `${doc.source.format.toUpperCase()} (flattened copy)`, extensions: [doc.source.format] }];
  return [OFINI_FILTER];
}

/** The document in its source format. */
export async function produceSource(app, doc, decision) {
  const s = doc.source;
  switch (s.kind) {
    case "text": {
      const f = [...doc.web.files.values()][0];
      return { bytes: encodeText(f.text, s), notes: [] };
    }
    case "office": {
      const model = doc.office.model;
      const { exportOffice } = await import("../engine/office/index.js");
      let svgFallbacks = {};
      if (s.officeId === "docx" || s.officeId === "rtf") svgFallbacks = await (await import("../ui/office/dialogs.js")).rasterize(model.media);
      const out = exportOffice(model, s.officeId, { svgFallbacks, title: model.meta?.title || baseOf(s.name) });
      return { bytes: out.bytes, notes: officeFidelityNotes(model, s.officeId) };
    }
    case "vector": {
      const { exportSvg } = await import("../core/io.js");
      const r = exportSvg(app, doc.pages[0]);
      return { bytes: new TextEncoder().encode(r.svg), notes: r.warnings || [] };
    }
    default:
      throw new Error(`Cannot write ${decision?.format || "this format"}.`);
  }
}

/** A flattened copy for the "Save a copy" choice: the original file's content (text) or the vector drawing as SVG. */
async function produceCopy(app, doc) {
  const s = doc.source;
  if (s.kind === "text") {
    const f = doc.web.files.get(s.entry) || [...doc.web.files.values()].find((x) => typeof x.text === "string");
    return { bytes: encodeText(f?.text || "", { ...s, original: null }), notes: [] };
  }
  if (s.kind === "vector") {
    const { exportSvg } = await import("../core/io.js");
    const r = exportSvg(app, doc.pages[0]);
    return { bytes: new TextEncoder().encode(r.svg), notes: r.warnings || [] };
  }
  return produceSource(app, doc, null);
}

/** The single dialog that appears when the document cannot be written in its source format any more. */
export function askLostFormat(app, doc, decision) {
  const fmt = `.${extOf(decision.name) || decision.format}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    openDialog({
      title: t("Save as .ofini?"),
      body: h("div", h("p.of-dialog__text", t("This document now has features that {format} cannot hold.", { format: fmt })), h("p.of-dialog__text", { style: "opacity:.75" }, t("Why: {reason}.", { reason: t(decision.reason) }))),
      width: 500,
      buttons: [
        { label: t("Cancel"), onClick: (close) => (finish("cancel"), close()) },
        { label: t("Save a copy as {format} (flattened)", { format: fmt }), onClick: (close) => (finish("copy"), close()) },
        { label: t("Save as .ofini (keeps everything)"), variant: "primary", onClick: (close) => (finish("ofini"), close()) },
      ],
      onClose: () => finish("cancel"),
    });
  });
}

function afterSourceWrite(app, doc, res, bytes, decision) {
  const s = doc.source;
  s.name = res.name || s.name;
  if (res.path) s.path = res.path;
  if (res.handle) s.handle = res.handle;
  if (s.kind === "text") {
    s.original = bytes;
    s.snapshot = [...doc.web.files.values()][0].text;
  }
  doc.name = baseOf(s.name) || doc.name;
  doc.saved = true;
  app.emit("saved");
  app.emit("docchange", {});
  addRecent({ name: s.name, bytes, path: res.path }).then((r) => app.emit("recents", r)).catch(() => {});
}

async function writeSource(app, doc, decision, forceDialog) {
  const s = doc.source;
  const { bytes, notes } = await produceSource(app, doc, decision);
  const sameName = decision.name === s.name; // a variant such as .docm is written under its canonical name: ask where
  let res = null;
  if (!forceDialog && sameName) {
    try {
      if (s.path && platform.isDesktop) res = await platform.saveFileTo(s.path, bytes);
      else if (s.handle && !platform.isDesktop) res = await platform.saveFileTo(s.handle, bytes);
    } catch (err) {
      if (platform.isDesktop) throw err; // desktop: a real write error must be seen, not hidden by a dialog
      s.handle = null; // browser: permission denied or the file moved: fall back to the save dialog
    }
  }
  if (!res) {
    res = await platform.saveFile({
      suggestedName: decision.name,
      mime: MIMES[extOf(decision.name)],
      filters: sourceSaveFilters(doc, decision),
      // the picked type decides: the original format, or .ofini as the alternative
      bytesFor: async (name) => (extOf(name) === "ofini" ? saveOfini(doc) : (await produceSource(app, doc, decision)).bytes),
    });
  }
  if (!res) return;
  if (extOf(res.name) === "ofini") {
    // the user chose .ofini in the dialog: the document becomes an .ofini document
    doc.source = null;
    doc.path = res.path || doc.path;
    doc.name = baseOf(res.name) || doc.name;
    doc.saved = true;
    app.emit("saved");
    app.emit("docchange", {});
    app.toast(t("Saved as {name}", { name: res.name }), "success", 1800);
    return;
  }
  afterSourceWrite(app, doc, res, bytes, decision);
  if (notes.length && s.kind === "office") {
    app.toast(t("Saved as {name}. {notes}", { name: res.name, notes: notes.join(" ") }), "warning", 9000, { label: t("Save as .ofini"), run: () => app.run("file.saveAsOfini") });
  } else {
    if (notes.length) app.toast(t("Saved as {name}. {notes}", { name: res.name, notes: notes.join(" ") }), "warning", 6000);
    else app.toast(t("Saved as {name}", { name: res.name }), "success", 1800);
  }
}

async function saveCopy(app, doc, decision) {
  const { bytes, notes } = await produceCopy(app, doc);
  const res = await platform.saveFile({ suggestedName: doc.source.name, bytes, mime: MIMES[doc.source.format], filters: [{ name: `${doc.source.format.toUpperCase()}`, extensions: [doc.source.format] }] });
  if (res) app.toast(notes.length ? t("Saved a copy as {name}. {notes}", { name: res.name, notes: notes.join(" ") }) : t("Saved a copy as {name}", { name: res.name }), notes.length ? "warning" : "success", 3500);
}

/** Save As for sources that are never written back (raster images, PSD ...): .ofini first, the original format as a flattened export. */
async function saveAsWithExport(app, doc, decision) {
  const fmt = RASTER_EXPORT[doc.source.format];
  const bytesFor = async (name) => {
    const ext = extOf(name);
    if (ext === "ofini" || !RASTER_EXPORT[ext]) return saveOfini(doc);
    return (await (await import("../core/io.js")).exportRaster(app, { page: doc.pages[0], format: RASTER_EXPORT[ext] })).bytes;
  };
  const res = await platform.saveFile({ suggestedName: `${doc.name}.ofini`, mime: OFINI_MIME, filters: sourceSaveFilters(doc, decision), bytesFor });
  if (!res) return null;
  if (extOf(res.name) === "ofini") return res;
  app.toast(t("Exported a flattened copy as {name}. The document itself is unchanged.", { name: res.name }), "success", 3500);
  return fmt ? "exported" : null;
}

/**
 * The source-format branch of File ▸ Save / Save As. See the header for the return value.
 * @param {import("../core/app.js").App} app
 */
export async function saveBySource(app, doc, forceDialog) {
  const s = doc.source;
  if (!s) return "ofini";
  const decision = canSaveAsSource(doc, { enabled: app.prefs.saveOriginalFormat !== false });
  if (decision.ok) {
    await writeSource(app, doc, decision, forceDialog);
    return "done";
  }
  if (!decision.ask) {
    // raster / PSD / PDF sources and the setting turned off: .ofini; Save As may export the original format
    if (forceDialog && app.prefs.saveOriginalFormat !== false && RASTER_EXPORT[s.format]) {
      const r = await saveAsWithExport(app, doc, decision);
      if (r === "exported" || !r) return "done";
      finishOfini(app, doc, r);
      return "done";
    }
    return "ofini";
  }
  if (forceDialog) return "ofini"; // Save As on a document that outgrew its format: plain .ofini dialog
  const choice = await askLostFormat(app, doc, decision);
  if (choice === "cancel") return "done";
  if (choice === "copy") {
    await saveCopy(app, doc, decision);
    return "done";
  }
  doc.source = null; // remembered: this document is an .ofini document from now on
  doc.path = null;
  app.emit("docchange", {});
  return "ofini";
}

function finishOfini(app, doc, res) {
  if (res.path) doc.path = res.path;
  doc.name = baseOf(res.name) || doc.name;
  doc.saved = true;
  app.emit("saved");
  app.emit("docchange", {});
  app.toast(t("Saved as {name}", { name: res.name }), "success", 1800);
}
