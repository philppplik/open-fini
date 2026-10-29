// Presentation app (Office Suite kind "slides"): implementation of the suite contract (docs/office-suite.md) loaded on
// first use by office/apps.js ▸ loadOfficeApp("slides"). The model and its operations live in model.js, the codecs in
// pptx.js / odp.js, the PDF and PNG renderer in render.js and the UI in view.js (all lazy). Guide: docs/office-slides.md.
//
// Contract members: create, open, save, mount, describe, aiAdapter (describe; the tools are the static slides_* group
// in vibe/tools/office-slides.js), collabAdapter (records meta:deck, slide:<id>, obj:<slide>/<element>, media:<id>).
import * as M from "./model.js";

const extOf = (name) => (/\.([^./\\]+)$/.exec(String(name || ""))?.[1] || "").toLowerCase();

/** Normalizes a stored model once (files from disk, older versions, Vibe edits, collaborators). */
export function ensureDeck(prj) {
  if (prj.model?._raw || prj.model?.version !== M.SLIDES_VERSION || !Array.isArray(prj.model?.slides)) prj.model = M.normalizeDeck(prj.model || {});
  return prj.model;
}

const describe = (model) => M.describeDeck(model?.version === M.SLIDES_VERSION ? model : M.normalizeDeck(model || {}));

/** What PowerPoint and OpenDocument files cannot keep from a deck (shown after Export and Save). */
function fidelityNotes(model, format) {
  const notes = [];
  if (format === "pptx" || format === "odp") {
    const bad = Object.values(model.media || {}).filter((m) => m.mime === "image/webp" || (format === "pptx" && m.mime === "image/svg+xml"));
    if (bad.length) notes.push(format === "pptx" ? "WebP and SVG pictures may not show in older PowerPoint versions." : "WebP pictures may not show in older Impress versions.");
  }
  return notes;
}

let commandsReady = null;
const registerCommands = (app) => (commandsReady ||= import("../../commands/office-slides.js").then((m) => m.registerSlidesCommands(app)));

export default {
  kind: "slides",

  create({ template = "blank", title = "", ratio = "16:9" } = {}) {
    return M.createDeck({ template, title, ratio });
  },

  /** Reads .pptx/.ppsx/.potx, .odp/.otp and flat .fodp. Templates open as new decks. */
  async open(bytes, name, { report } = {}) {
    const ext = extOf(name);
    const isZip = bytes?.[0] === 0x50 && bytes[1] === 0x4b;
    let model;
    if (ext === "fodp" || (!isZip && /^\s*</.test(new TextDecoder().decode(bytes.subarray(0, 64))))) model = (await import("./odp.js")).readOdp(bytes, { report, flat: true });
    else {
      // content first: an ODF package has a "mimetype" entry, everything else (and OLE .ppt for its message) is PowerPoint
      const { readZip } = await import("../../engine/office/zip.js");
      const isOdf = isZip && /opendocument/.test(new TextDecoder().decode(readZip(bytes, { want: (n) => n === "mimetype" }).entries.mimetype || new Uint8Array()));
      model = !isOdf ? (await import("./pptx.js")).readPptx(bytes, { report }) : (await import("./odp.js")).readOdp(bytes, { report });
    }
    if (!model.meta.title) model.meta.title = String(name || "").replace(/\.[^.]+$/, "");
    return { model, asNew: ext === "potx" || ext === "otp" };
  },

  /** Writes "pptx", "odp", "pdf" or "png" (a ZIP with one PNG per slide). */
  async save(model, format, { title = "" } = {}) {
    const deck = M.pruneMedia(model.version === M.SLIDES_VERSION ? model : M.normalizeDeck(model));
    if (format === "pptx") return { bytes: (await import("./pptx.js")).writePptx(deck, { title }), mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx", notes: fidelityNotes(deck, "pptx") };
    if (format === "odp") return { bytes: (await import("./odp.js")).writeOdp(deck, { title }), mime: "application/vnd.oasis.opendocument.presentation", ext: "odp", notes: fidelityNotes(deck, "odp") };
    const R = await import("./render.js");
    if (format === "pdf") return { bytes: await R.deckToPdf(deck, { title: deck.meta.title || title }), mime: "application/pdf", ext: "pdf" };
    if (format === "png") return { bytes: await R.deckToPngZip(deck), mime: "application/zip", ext: "zip" };
    throw new Error(`Presentations cannot be saved as "${format}".`);
  },

  /** Mounts the editor (thumbnails, canvas, notes, ribbon). Returns the instance that becomes `app.officeUI`. */
  async mount(host, doc, app) {
    ensureDeck(doc.office);
    const [{ SlidesView }] = await Promise.all([import("./view.js"), registerCommands(app)]);
    return new SlidesView(host, doc, app);
  },

  describe,
  aiAdapter: { describe },
  collabAdapter: {
    records: (model) => M.deckRecords(model.version === M.SLIDES_VERSION ? model : M.normalizeDeck(model)),
    applyRecords: (model, changes) => M.applyDeckRecords(model.version === M.SLIDES_VERSION ? model : M.normalizeDeck(model), changes),
  },
};
