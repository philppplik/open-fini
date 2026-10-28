// The Office document inside an OpenFini document (doc.office): one model of one Office app kind. Kept tiny on purpose
// (it is part of the startup bundle through ofini.js): the models themselves are plain JSON described by their apps
// (word processor: engine/office/model.js; the suite contract: docs/office-suite.md), loaded with the Office studio.
//
// Storage in the .ofini archive (docs/file-format.md ▸ Office):
//   document.json → "office"   the model without binary media, plus `kind` when it is not "document" (additive field;
//                              absent = "document", so every file written before the suite reads unchanged)
//   office/media/<id>.<ext>          media of a "document" (word processor) model (unchanged path)
//   office/<kind>/media/<id>.<ext>   media of every other kind ("sheet", "slides", "board" …)
// Every model may carry `media: { <id>: { id, mime, name?, w?, h?, bytes } }`; bytes travel as archive entries.
// Invariants: `kind` never changes for the life of a project; `set()` is the only way the model changes (callers
// use commitOffice for undo); models are treated as immutable values (a new object per change).
import { Emitter } from "./util.js";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };
const KIND_RE = /^[a-z][a-z0-9-]{1,23}$/;

/** Archive folder of an Office kind's media. */
export const officeMediaDir = (kind) => (!kind || kind === "document" ? "office/media/" : `office/${kind}/media/`);

export class OfficeProject extends Emitter {
  constructor(model, kind = "document") {
    super();
    this.kind = KIND_RE.test(String(kind)) ? kind : "document";
    this.model = model;
    this.rev = 0;
    /** Per-session view state (not saved): zoom, layout, panels. Apps may add their own keys. */
    this.view = { zoom: 1, layout: "print", panel: "outline" };
  }

  /** Replaces the model (callers go through commitOffice for undo). */
  set(model, info = {}) {
    this.model = model;
    this.rev++;
    this.emit("change", info);
  }

  /** JSON stored in document.json (media bytes are separate archive entries). */
  manifest() {
    const dir = officeMediaDir(this.kind);
    const media = {};
    for (const [id, m] of Object.entries(this.model.media || {})) media[id] = { id, mime: m.mime, name: m.name || "", ...(m.w ? { w: m.w, h: m.h } : {}), file: `${dir}${id}.${EXT[m.mime] || "bin"}` };
    const { _raw, ...rest } = this.model;
    return this.kind === "document" ? { ...rest, media } : { ...rest, kind: this.kind, media };
  }

  /** Archive entries: { "<media dir><id>.<ext>": Uint8Array } */
  entries() {
    const dir = officeMediaDir(this.kind);
    const out = {};
    for (const [id, m] of Object.entries(this.model.media || {})) if (m.bytes) out[`${dir}${id}.${EXT[m.mime] || "bin"}`] = m.bytes;
    return out;
  }

  static fromManifest(json, entries) {
    const kind = typeof json?.kind === "string" && KIND_RE.test(json.kind) ? json.kind : "document";
    const dir = officeMediaDir(kind);
    const media = {};
    for (const [id, m] of Object.entries(json?.media || {})) {
      const bytes = typeof m?.file === "string" && m.file.startsWith(dir) && !m.file.includes("..") ? entries[m.file] : null;
      if (bytes) media[id] = { id, mime: m.mime, name: m.name || "", bytes, ...(m.w ? { w: m.w, h: m.h } : {}) };
    }
    const { kind: _k, ...model } = json || {};
    // the model is validated by its app (word processor: engine/office/model.js normalizeDoc) when the app loads it
    return new OfficeProject({ ...model, media, _raw: true }, kind);
  }
}

/**
 * Applies a new model as one undoable step of the document's history (Ctrl+Z, the History panel and Vibe's undo all
 * see it). `coalesce` merges consecutive typing into one step. Works for every Office kind.
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
