// The word-processing document of the Office Studio inside an OpenFini document (doc.office). Kept tiny on purpose
// (it is part of the startup bundle through ofini.js): the model itself is plain JSON described in
// engine/office/model.js, which is only loaded with the studio.
//
// Stored in the .ofini archive as document.json → "office" (the model without image bytes) plus office/media/<file>.
import { Emitter } from "./util.js";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };

export class OfficeProject extends Emitter {
  constructor(model) {
    super();
    this.model = model;
    this.rev = 0;
    /** Per-session view state (not saved): zoom, layout, panels. */
    this.view = { zoom: 1, layout: "print", panel: "outline" };
  }

  /** Replaces the model (callers go through commitOffice for undo). */
  set(model, info = {}) {
    this.model = model;
    this.rev++;
    this.emit("change", info);
  }

  /** JSON stored in document.json (image bytes are separate archive entries). */
  manifest() {
    const media = {};
    for (const [id, m] of Object.entries(this.model.media || {})) media[id] = { id, mime: m.mime, name: m.name || "", ...(m.w ? { w: m.w, h: m.h } : {}), file: `office/media/${id}.${EXT[m.mime] || "bin"}` };
    return { ...this.model, media };
  }

  /** Archive entries: { "office/media/<id>.<ext>": Uint8Array } */
  entries() {
    const out = {};
    for (const [id, m] of Object.entries(this.model.media || {})) if (m.bytes) out[`office/media/${id}.${EXT[m.mime] || "bin"}`] = m.bytes;
    return out;
  }

  static fromManifest(json, entries) {
    const media = {};
    for (const [id, m] of Object.entries(json?.media || {})) {
      const bytes = typeof m?.file === "string" && m.file.startsWith("office/media/") ? entries[m.file] : null;
      if (bytes) media[id] = { id, mime: m.mime, name: m.name || "", bytes, ...(m.w ? { w: m.w, h: m.h } : {}) };
    }
    // the model is validated (engine/office/model.js normalizeDoc) when the studio loads it
    return new OfficeProject({ ...json, media, _raw: true });
  }
}

/** Gives a document an office model. */
export function ensureOffice(doc, model) {
  if (!doc.office) doc.office = new OfficeProject(model);
  return doc.office;
}

/**
 * Applies a new model as one undoable step of the document's history (Ctrl+Z, the History panel and Vibe's undo all
 * see it). `coalesce` merges consecutive typing into one step.
 */
export function commitOffice(doc, label, next, { coalesce = null, sel = null, selBefore = null } = {}) {
  const prj = doc.office;
  const before = prj.model;
  if (next === before) return;
  doc.tx(
    label,
    () =>
      doc._do({
        redo: () => prj.set(next, { sel, origin: "redo", label }),
        undo: () => prj.set(before, { sel: selBefore, origin: "undo", label }),
        meta: true,
        bytes: 256,
      }),
    coalesce ? { coalesce } : {},
  );
}
