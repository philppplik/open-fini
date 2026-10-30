// Whiteboard app (Office Suite kind "board"): implementation of the Office Suite contract (docs/office-suite.md,
// user and engineering guide docs/office-board.md). Loaded on first use by office/apps.js ▸ loadOfficeApp("board").
//
// Contract members: create (templates), open (.excalidraw, .tldraw), save (excalidraw, tldraw, png, svg, pdf),
// mount (office/board/view.js), describe, aiAdapter (describe; the tools are the static board_* group in
// vibe/tools/office-board.js), collabAdapter (one record per element, page, image: last writer wins per element).
import { templateBoard, normalizeBoard, describeBoard, boardRecords, applyBoardRecords, sortedPages } from "./model.js";
import { FONT_FAMILY } from "./render.js";

/** The model as stored; normalized once when a document opens (older files, Vibe edits, collaborators). */
export function ensureBoard(prj) {
  if (prj.model?._raw || prj.model?.version !== 1 || !Array.isArray(prj.model?.pages)) {
    const { _raw, ...rest } = prj.model || {};
    prj.model = normalizeBoard(rest);
  }
  return prj.model;
}

export const describe = (model) => describeBoard(model?.version === 1 ? model : normalizeBoard(model), { limit: 40 });

/** Text measurement with a canvas when there is one (browser), else the model's approximation. */
let mctx = null;
export function measureText(text, size, font = "hand") {
  if (mctx === null) {
    try {
      mctx = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1).getContext("2d") : typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : false;
    } catch {
      mctx = false;
    }
  }
  if (!mctx) return String(text).length * size * 0.56;
  const fam = FONT_FAMILY[font] || FONT_FAMILY.sans;
  mctx.font = `400 ${size}px "${fam}", ${font === "mono" ? "monospace" : font === "serif" ? "serif" : "sans-serif"}`;
  return mctx.measureText(String(text)).width;
}

const currentPage = (model, doc) => {
  const id = doc?.office?.view?.boardPage;
  return model.pages.some((p) => p.id === id) ? id : sortedPages(model)[0].id;
};

export default {
  kind: "board",

  create({ template = "blank", title = "" } = {}) {
    return templateBoard(template, { title });
  },

  /** Reads .excalidraw and .tldraw files (content first: a renamed file still opens). */
  async open(bytes, name, { report } = {}) {
    const F = await import("./formats.js");
    const json = F.parseJson(bytes);
    const tl = json && (json.tldrawFileFormatVersion !== undefined || Array.isArray(json.records));
    const model = tl ? F.readTldraw(json, report) : F.readExcalidraw(json, report);
    model.title = String(name || "").replace(/\.[^.]+$/, "");
    return { model };
  },

  /**
   * Writes the board: "excalidraw" | "tldraw" (all pages), "png" | "svg" (the current page), "pdf" (one page per board
   * page). Returns { bytes, mime, ext, notes } (notes: what the format cannot keep).
   */
  async save(model, format, { title = "", doc = null } = {}) {
    model = model?.version === 1 && Array.isArray(model.pages) ? model : normalizeBoard(model);
    const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));
    if (format === "excalidraw" || format === "tldraw") {
      const F = await import("./formats.js");
      const { json, notes } = format === "excalidraw" ? F.writeExcalidraw(model) : F.writeTldraw(model);
      return { bytes: enc(json), mime: format === "excalidraw" ? "application/vnd.excalidraw+json" : "application/vnd.tldraw+json", ext: format, notes };
    }
    if (["png", "svg", "pdf"].includes(format)) {
      const { exportBoard } = await import("./export.js");
      return exportBoard(model, format, { page: currentPage(model, doc), title, measure: measureText });
    }
    throw new Error(`Whiteboards cannot be saved as “${format}”.`);
  },

  async mount(host, doc, app) {
    ensureBoard(doc.office);
    const { mountBoard } = await import("./view.js");
    return mountBoard(host, doc, app);
  },

  describe,
  aiAdapter: { describe },
  collabAdapter: {
    records: (model) => boardRecords(model?.version === 1 ? model : normalizeBoard(model)),
    applyRecords: (model, changes) => applyBoardRecords(model?.version === 1 ? model : normalizeBoard(model), changes),
  },
};
