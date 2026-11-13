// Export in Node (`ofini export`, `ofini convert`): only writers that are pure ES modules. Design pages go through the
// app's display list (engine/dl.js) into its SVG and PDF writers; Office projects through their app's save();
// website projects as a ZIP of their files. Raster output (PNG, JPEG, WebP), video and anything with pictures in a
// PDF needs a canvas, so it is reported as "needs the app" instead of being rendered differently here.
import { buildPageDL } from "../../app/src/engine/dl.js";
import { displayListToSVGResult } from "../../app/src/engine/backends/svg.js";
import { dlHasAdjust } from "../../app/src/engine/backends/canvas.js";
import { documentPagesText } from "../../app/src/core/doc-text.js";
import { writeZip } from "../../app/src/engine/office/zip.js";
import { loadOfficeApp, officeApp } from "../../app/src/office/apps.js";
import { CliError, EXIT, projectKind, officeModel, writeOfini } from "./project.mjs";

/** Formats per project kind: [id, description]. "ofini" and "json" are available for every kind. */
const DESIGN = [["svg", "SVG, one file per page"], ["pdf", "PDF (vector pages; pages with pictures need the app)"], ["txt", "Plain text of all text layers"]];
const WEBSITE = [["zip", "ZIP of the website files"]];
const COMMON = [["ofini", "OpenFini project"], ["json", "The document content (document.json), indented"]];
const NOT_HEADLESS = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif", "tif", "tiff", "mp4", "webm", "mov", "psd"]);

/** Formats an open project can be exported to: [{ id, label }]. */
export function formatsFor(doc) {
  const kind = projectKind(doc);
  let list;
  if (kind === "design") list = DESIGN;
  else if (kind === "website") list = WEBSITE;
  else if (kind === "scene") list = [];
  else {
    const m = officeApp(kind);
    list = (m?.formats || []).filter((f) => f.write && !NOT_HEADLESS.has(f.id)).map((f) => [f.id, f.label]);
  }
  return [...list, ...COMMON].map(([id, label]) => ({ id, label }));
}

/** Format id from a file name ("out.md" → "md"; "report.markdown" → "md"). */
export function formatFromName(name) {
  const ext = (/\.([a-z0-9]+)$/i.exec(String(name)) || [])[1]?.toLowerCase() || "";
  return { markdown: "md", htm: "html", text: "txt", jpeg: "jpg" }[ext] || ext;
}

function encodeImage(ref) {
  const src = ref?.source;
  if (!src?._bytes) return null;
  return `data:${src._mime || "image/png"};base64,${Buffer.from(src._bytes).toString("base64")}`;
}

function hasImages(items) {
  for (const it of items) {
    if (it.t === "image") return true;
    if (it.items && hasImages(it.items)) return true;
  }
  return false;
}

/**
 * Exports a project. Returns one or more outputs: [{ suffix, bytes, ext, warnings }]. `suffix` is "" for a single
 * output and "-<page>" when a design exports several SVG pages.
 * @param {import("../../app/src/core/doc.js").Doc} doc
 * @param {string} format
 * @param {{ pages?: number[], entries?: object, background?: boolean }} [o]
 */
export async function exportProject(doc, format, { pages = null, entries = {}, background = true } = {}) {
  const fmt = format.toLowerCase();
  const kind = projectKind(doc);
  const ids = formatsFor(doc).map((f) => f.id);
  if (!ids.includes(fmt)) {
    const why = NOT_HEADLESS.has(fmt) ? `${fmt.toUpperCase()} needs rendering, which only the app does (File ▸ Export)` : `${kind === "design" ? "a design" : `a ${kind}`} project cannot be exported as ${fmt.toUpperCase()} here`;
    throw new CliError(`${why}. Formats for this project: ${ids.join(", ")}.`, EXIT.UNSUPPORTED);
  }
  if (fmt === "ofini") return [{ suffix: "", ext: "ofini", bytes: writeOfini(doc, entries), warnings: [] }];
  if (fmt === "json") return [{ suffix: "", ext: "json", bytes: Buffer.from(`${JSON.stringify(doc.toJSON(), null, 2)}\n`), warnings: [] }];

  if (kind === "design") {
    const sel = pages || doc.pages.map((_, i) => i);
    if (fmt === "txt") {
      const text = documentPagesText(doc, { pages: sel.map((i) => i + 1), maxChars: 50000000 }).map((p) => p.text).filter(Boolean).join("\n\n");
      return [{ suffix: "", ext: "txt", bytes: Buffer.from(text ? `${text}\n` : ""), warnings: [] }];
    }
    const lists = sel.map((i) => {
      const page = doc.pages[i];
      const dl = buildPageDL(doc, page);
      if (dlHasAdjust(dl.items)) throw new CliError(`Page ${i + 1} uses adjustment layers, which need raster rendering. Export it in the app (File ▸ Export).`, EXIT.UNSUPPORTED);
      return { page, dl, index: i };
    });
    if (fmt === "svg") {
      return lists.map(({ page, dl, index }) => {
        const r = displayListToSVGResult(dl, { background: background ? page.bg : null, encodeImage, title: doc.name });
        return { suffix: lists.length > 1 ? `-${index + 1}` : "", ext: "svg", bytes: Buffer.from(r.svg), warnings: r.warnings };
      });
    }
    if (fmt === "pdf") {
      if (lists.some((l) => hasImages(l.dl.items))) throw new CliError("These pages contain pictures or pixel layers; a PDF with pictures needs the app (File ▸ Export ▸ PDF). SVG export keeps the pictures.", EXIT.UNSUPPORTED);
      const { createPDF } = await import("../../app/src/engine/backends/pdf.js");
      const prepared = lists.map(({ page, dl }) => {
        if (page.bg) dl.items.unshift({ t: "path", d: [["M", 0, 0], ["L", page.w, 0], ["L", page.w, page.h], ["L", 0, page.h], ["Z"]], rule: "nonzero", fill: { type: "solid", color: page.bg.slice(0, 7), alpha: 1 }, stroke: null, m: [1, 0, 0, 1, 0, 0], pageBg: true });
        return dl;
      });
      const bytes = await createPDF(prepared, { pxPerInch: doc.dpi, title: doc.name, creator: "OpenFini", producer: "OpenFini ofini" });
      return [{ suffix: "", ext: "pdf", bytes, warnings: ["Text uses the PDF base fonts (Helvetica, Times, Courier); the app embeds the real fonts."] }];
    }
  }
  if (kind === "website") {
    const files = Object.entries(doc.web.entries()).map(([k, b]) => [k.slice("web/files/".length), b]);
    return [{ suffix: "", ext: "zip", bytes: writeZip(files), warnings: [] }];
  }
  // Office projects
  const impl = await loadOfficeApp(kind);
  const model = await officeModel(doc);
  let out;
  try {
    out = await impl.save(model, fmt, { title: doc.name });
  } catch (e) {
    const canvas = /OffscreenCanvas|document is not defined|createImageBitmap|Image is not defined/.test(String(e?.message));
    throw new CliError(canvas ? `Exporting this ${kind} as ${fmt.toUpperCase()} needs rendering (pictures or charts); use the app (File ▸ Export).` : `Export failed: ${e.message}`, canvas ? EXIT.UNSUPPORTED : EXIT.PROBLEMS);
  }
  return [{ suffix: "", ext: out.ext || fmt, bytes: out.bytes instanceof Uint8Array ? out.bytes : Buffer.from(String(out.bytes ?? "")), warnings: out.notes || [] }];
}

/** Plain text of any project (`ofini extract --text`). */
export async function projectText(doc) {
  const kind = projectKind(doc);
  if (kind === "design") return documentPagesText(doc).map((p) => p.text).filter(Boolean).join("\n\n");
  if (kind === "website") return doc.web.paths.filter((p) => /\.(html?|md|txt)$/i.test(p)).map((p) => `== ${p}\n${doc.web.files.get(p).text ?? ""}`).join("\n\n");
  if (kind === "document") return String(new TextDecoder().decode((await exportProject(doc, "txt"))[0].bytes));
  if (kind === "sheet") {
    const model = await officeModel(doc);
    const impl = await loadOfficeApp("sheet");
    const parts = [];
    for (let i = 0; i < (model.sheets || []).length; i++) {
      const out = await impl.save({ ...model, active: i }, "csv", { title: doc.name });
      parts.push(`== ${model.sheets[i].name || `Sheet ${i + 1}`}\n${new TextDecoder().decode(out.bytes)}`);
    }
    return parts.join("\n\n");
  }
  // slides, boards, scenes: every text string in the model, in order
  const model = await officeModel(doc);
  const out = [];
  const visit = (v, key) => {
    if (out.length > 100000) return;
    if (typeof v === "string") {
      if ((key === "text" || key === "title" || key === "notes" || key === "label") && v.trim()) out.push(v.trim());
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "media" && k !== "bytes") visit(x, k);
  };
  visit(model, "");
  return out.join("\n");
}
