// The Office document inside an OpenFini document (doc.office): one model of one Office app kind. Kept tiny on purpose
// (it is part of the startup bundle through ofini.js): the models themselves are plain JSON described by their apps
// (word processor: engine/office/model.js; the suite contract: docs/office-suite.md), loaded with the Office studio.
//
// Storage in the .ofini archive (docs/file-format.md ▸ Office):
//   document.json → "office"   the model without binary media, plus `kind` when it is not "document" (additive field;
//                              absent = "document", so every file written before the suite reads unchanged)
//   office/media/<id>.<ext>          media of a "document" (word processor) model (unchanged path)
//   office/<kind>/media/<id>.<ext>   media of every other kind ("sheet", "slides", "board", "scene" …)
// Every model may carry `media: { <id>: { id, mime, name?, w?, h?, bytes } }`; bytes travel as archive entries.
// Referenced media (Scene Studio on the desktop, scene/media-refs.js): an item with a `path` stores the path, `size`,
// `hash` and `rel` (path relative to the saved file) instead of an archive entry; it loads without bytes and the
// app reads the file. `saving = { base, embed }` is set by saveOfini for one save: `embed` writes the bytes of
// every item that has them and drops the paths (copies sent to other people).
// Invariants: `kind` never changes for the life of a project; `set()` is the only way the model changes (callers
// use commitOffice for undo); models are treated as immutable values (a new object per change).
import { Emitter } from "./util.js";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/flac": "flac" };
// Media fields an app may add (the Scene Studio: kind, duration, hasAudio, and path, size, hash of referenced
// media); plain values only, kept as they are.
const extra = (m) => {
  const out = {};
  for (const k of ["kind", "duration", "hasAudio", "path", "size", "hash", "rel"]) if (m[k] !== undefined && typeof m[k] !== "object") out[k] = m[k];
  return out;
};
const linked = (m, embed) => typeof m.path === "string" && m.path && !(embed && m.bytes);
const isWinPath = (p) => /^[a-zA-Z]:[\\/]|^\\\\/.test(p);
const segs = (p) => (isWinPath(p) ? p.slice(2) : p).split(/[\\/]+/).filter(Boolean);

/** `to` relative to the folder `dir` with "/" separators, or null across drives (referenced media, `rel`). */
export function relativeTo(dir, to) {
  if (!dir || !to || isWinPath(dir) !== isWinPath(to) || (isWinPath(dir) && dir.slice(0, 2).toLowerCase() !== to.slice(0, 2).toLowerCase())) return null;
  const a = segs(dir);
  const b = segs(to);
  const eq = isWinPath(to) ? (x, y) => x.toLowerCase() === y.toLowerCase() : (x, y) => x === y;
  let i = 0;
  while (i < a.length && i < b.length - 1 && eq(a[i], b[i])) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}
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
    /** Set by a live-editing binding: (current, from, to) → model that applies the step from → to on top of current. */
    this.rebase = null;
    /** Options of the save in progress ({ base: folder of the file, embed }), set by core/ofini.js ▸ saveOfini. */
    this.saving = null;
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
    const { base = null, embed = false } = this.saving || {};
    const media = {};
    for (const [id, m] of Object.entries(this.model.media || {})) {
      const { path: _p, size: _s, hash: _h, rel: _r, ...plain } = extra(m);
      if (linked(m, embed)) {
        const rel = relativeTo(base, m.path);
        media[id] = { id, mime: m.mime, name: m.name || "", ...(m.w ? { w: m.w, h: m.h } : {}), ...plain, path: m.path, ...(m.size ? { size: m.size } : {}), ...(m.hash ? { hash: m.hash } : {}), ...(rel ? { rel } : {}) };
      } else media[id] = { id, mime: m.mime, name: m.name || "", ...(m.w ? { w: m.w, h: m.h } : {}), ...plain, file: `${dir}${id}.${EXT[m.mime] || "bin"}` };
    }
    const { _raw, ...rest } = this.model;
    return this.kind === "document" ? { ...rest, media } : { ...rest, kind: this.kind, media };
  }

  /** Archive entries: { "<media dir><id>.<ext>": Uint8Array } */
  entries() {
    const dir = officeMediaDir(this.kind);
    const out = {};
    const embed = !!this.saving?.embed;
    for (const [id, m] of Object.entries(this.model.media || {})) if (m.bytes && !linked(m, embed)) out[`${dir}${id}.${EXT[m.mime] || "bin"}`] = m.bytes;
    return out;
  }

  static fromManifest(json, entries) {
    const kind = typeof json?.kind === "string" && KIND_RE.test(json.kind) ? json.kind : "document";
    const dir = officeMediaDir(kind);
    const media = {};
    for (const [id, m] of Object.entries(json?.media || {})) {
      const bytes = typeof m?.file === "string" && m.file.startsWith(dir) && !m.file.includes("..") ? entries[m.file] : null;
      if (bytes) {
        const { path: _p, size: _s, hash: _h, rel: _r, ...plain } = extra(m);
        media[id] = { id, mime: m.mime, name: m.name || "", bytes, ...(m.w ? { w: m.w, h: m.h } : {}), ...plain };
      } else if (typeof m?.path === "string" && m.path) media[id] = { id, mime: m.mime, name: m.name || "", ...(m.w ? { w: m.w, h: m.h } : {}), ...extra(m) }; // referenced: the app reads the file
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
        // while the document is edited together (ui/collab/live.js), `prj.rebase` applies only this step on top of
        // the current model, so Undo/Redo keep the edits other people made in between
        redo: () => prj.set(prj.rebase && prj.model !== before ? prj.rebase(prj.model, before, next) : next, { sel, origin: "redo", label }),
        undo: () => prj.set(prj.rebase && prj.model !== next ? prj.rebase(prj.model, next, before) : before, { sel: selBefore, origin: "undo", label }),
        meta: true,
        bytes: 256,
      }),
    coalesce ? { coalesce } : {},
  );
}
