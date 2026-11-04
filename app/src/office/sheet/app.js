// Spreadsheet app implementation of the Office Suite contract (docs/office-suite.md, docs/office-sheet.md). Loaded on
// first use by office/apps.js ▸ loadOfficeApp("sheet"). The codecs load behind their own import() in open()/save();
// the grid UI (view.js) loads in mount().
//
// Contract members: create, open, save, mount, describe, aiAdapter, collabAdapter. Shared helpers for the commands
// and Vibe tools: calcFor(doc) (one recalculation engine per document), ensureModel(prj).
import { templateWorkbook, normalizeWorkbook, describeWorkbook, toRecords, applyRecords, MODEL_VERSION } from "./model.js";
import { createCalc } from "./formula.js";

const calcs = new WeakMap(); // doc → calc

/** Normalizes a stored model once (files from disk, older versions, remote copies). */
export function ensureModel(prj) {
  if (prj.model?._raw || prj.model?.version !== MODEL_VERSION || !Array.isArray(prj.model?.sheets)) prj.model = normalizeWorkbook(prj.model);
  return prj.model;
}

/** The recalculation engine of a document, updated to its current model. */
export function calcFor(doc) {
  const model = ensureModel(doc.office);
  let c = calcs.get(doc);
  if (!c) {
    c = createCalc(model);
    calcs.set(doc, c);
  } else c.update(model);
  return c;
}

export function describe(model) {
  const m = model?.version === MODEL_VERSION && Array.isArray(model.sheets) ? model : normalizeWorkbook(model);
  return describeWorkbook(m);
}

const NOTES = {
  csv: "CSV keeps the values of the active sheet only (no styles, formulas, other sheets or charts).",
  ods: "Charts and conditional formatting are not written to OpenDocument files yet.",
};

export default {
  kind: "sheet",

  create({ template = "blank", title = "" } = {}) {
    return templateWorkbook(template, title);
  },

  async open(bytes, name, { report } = {}) {
    const ext = (/\.([^./\\]+)$/.exec(name)?.[1] || "").toLowerCase();
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    let model;
    if (zip && ext !== "ods" && ext !== "ots" && ext !== "fods") {
      const { entries } = (await import("../../engine/office/zip.js")).readZip(bytes, { want: (n) => n === "mimetype" });
      if (entries.mimetype) model = (await import("./ods.js")).readOds(bytes, { report });
      else model = (await import("./xlsx.js")).readXlsx(bytes, { report });
    } else if (zip || ext === "fods" || /^\s*<\?xml/.test(new TextDecoder().decode(bytes.subarray(0, 64)))) model = (await import("./ods.js")).readOds(bytes, { report });
    else if (ext === "xls" || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) throw new Error("Excel 97-2003 (.xls) files cannot be opened. Save the file as .xlsx in Excel or LibreOffice first.");
    else {
      model = (await import("./csv.js")).readDelimitedSheet(bytes, name);
      report?.kept?.("Values and formulas of one sheet");
    }
    return { model, asNew: ext === "xltx" || ext === "ots" };
  },

  async save(model, format, { title = "", doc = null } = {}) {
    const m = normalizeWorkbook(model);
    const calc = doc ? calcFor(doc) : createCalc(m);
    if (format === "xlsx") return { bytes: (await import("./xlsx.js")).writeXlsx(m, { calc, title }), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    if (format === "ods") {
      const notes = m.sheets.some((s) => s.charts.length || s.cf.length) ? [NOTES.ods] : [];
      return { bytes: (await import("./ods.js")).writeOds(m, { calc, title }), mime: "application/vnd.oasis.opendocument.spreadsheet", ext: "ods", notes };
    }
    if (format === "csv" || format === "tsv") {
      const bytes = (await import("./csv.js")).writeDelimitedSheet(m, { calc, sep: format === "tsv" ? "\t" : "," });
      return { bytes, mime: format === "tsv" ? "text/tab-separated-values" : "text/csv", ext: format, notes: m.sheets.length > 1 || m.sheets.some((s) => s.charts.length) ? [NOTES.csv] : [] };
    }
    if (format === "pdf" || format === "png") {
      const [{ sheetPages }, { measurer }, tk] = await Promise.all([import("./render.js"), import("../../core/fonts.js"), import("../toolkit/export.js")]);
      const sid = m.active;
      if (format === "pdf") {
        const pages = m.sheets.flatMap((s) => sheetPages(m, s.id, calc, { measurer }));
        return { bytes: await tk.displayListsToPdf(pages, { title: title || m.meta?.title || "" }), mime: "application/pdf", ext: "pdf" };
      }
      const [pg] = sheetPages(m, sid, calc, { measurer, single: true });
      const { renderToCanvas } = await import("../../engine/backends/canvas.js");
      const canvas = renderToCanvas(pg, { scale: 2, bg: "#ffffff", width: Math.min(16000, pg.width * 2), height: Math.min(16000, pg.height * 2) });
      return { bytes: await tk.canvasToPng(canvas), mime: "image/png", ext: "png", notes: ["PNG shows the active sheet."] };
    }
    throw new Error(`Spreadsheets cannot be saved as “${format}”.`);
  },

  async mount(host, doc, app) {
    ensureModel(doc.office);
    const { mountSheet } = await import("./view.js");
    return mountSheet(host, doc, app);
  },

  describe,
  aiAdapter: { describe },
  collabAdapter: { records: (m) => toRecords(ensureModel({ model: m })), applyRecords: (m, ch) => applyRecords(normalizeWorkbook(m), ch) },
};
