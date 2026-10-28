// Office file recognition and the word processor's import / export entry points. Pure.
// FORMATS is the content-sniffing table of every Office-family file (documents, spreadsheets, presentations,
// whiteboards, cloud shortcuts, legacy formats). Which app OPENS a format is decided by the Office Suite registry
// (office/apps.js): the `read`/`write` flags below only describe this module's word-processor codecs. Formats
// whose app is not registered get officeGuidance() (docs/office-suite.md ▸ File routing).
import { readDocx, writeDocx } from "./docx.js";
import { readOdt, writeOdt, ODT_MIME } from "./odt.js";
import { readRtf, writeRtf } from "./rtf.js";
import { readHtml, writeHtml } from "./html.js";
import { readMarkdown, writeMarkdown, readText, writeText } from "./markdown.js";
import { isZip, readZip } from "./zip.js";
import { createReport } from "./report.js";

/**
 * @typedef {{ id: string, kind: "document"|"spreadsheet"|"presentation"|"whiteboard"|"cloud"|"legacy", label: string, ext: string[],
 *   mime?: string, read: boolean, write: boolean }} OfficeFormat
 */
/** @type {OfficeFormat[]} */
export const FORMATS = [
  { id: "docx", kind: "document", label: "Word document", ext: ["docx", "docm", "dotx", "dotm"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", read: true, write: true },
  { id: "odt", kind: "document", label: "OpenDocument text", ext: ["odt", "ott", "fodt"], mime: ODT_MIME, read: true, write: true },
  { id: "rtf", kind: "document", label: "Rich Text", ext: ["rtf"], mime: "application/rtf", read: true, write: true },
  { id: "html", kind: "document", label: "Web page (HTML)", ext: ["html", "htm", "xhtml"], mime: "text/html", read: true, write: true },
  { id: "md", kind: "document", label: "Markdown", ext: ["md", "markdown"], mime: "text/markdown", read: true, write: true },
  { id: "txt", kind: "document", label: "Plain text", ext: ["txt", "text"], mime: "text/plain", read: true, write: true },
  { id: "pdf", kind: "document", label: "PDF", ext: ["pdf"], mime: "application/pdf", read: false, write: true },
  // opened by other Office Suite apps when they are registered (office/index.js); guidance otherwise
  { id: "xlsx", kind: "spreadsheet", label: "Excel workbook", ext: ["xlsx", "xlsm", "xls", "xltx"], read: false, write: false },
  { id: "ods", kind: "spreadsheet", label: "OpenDocument spreadsheet", ext: ["ods", "fods", "ots"], read: false, write: false },
  { id: "csv", kind: "spreadsheet", label: "CSV table", ext: ["csv", "tsv"], read: false, write: false },
  { id: "numbers", kind: "spreadsheet", label: "Apple Numbers", ext: ["numbers"], read: false, write: false },
  { id: "pptx", kind: "presentation", label: "PowerPoint presentation", ext: ["pptx", "ppt", "ppsx", "potx"], read: false, write: false },
  { id: "odp", kind: "presentation", label: "OpenDocument presentation", ext: ["odp", "fodp", "otp"], read: false, write: false },
  { id: "key", kind: "presentation", label: "Apple Keynote", ext: ["key"], read: false, write: false },
  { id: "excalidraw", kind: "whiteboard", label: "Excalidraw drawing", ext: ["excalidraw"], read: false, write: false },
  { id: "tldraw", kind: "whiteboard", label: "tldraw drawing", ext: ["tldraw"], read: false, write: false },
  // guidance only
  { id: "gdoc", kind: "cloud", label: "Google Docs shortcut", ext: ["gdoc", "gsheet", "gslides"], read: false, write: false },
  { id: "pages", kind: "legacy", label: "Apple Pages", ext: ["pages"], read: false, write: false },
  { id: "doc", kind: "legacy", label: "Word 97-2003 document", ext: ["doc", "dot", "wps", "wpd"], read: false, write: false },
];

export const EXPORT_FORMATS = FORMATS.filter((f) => f.write);
/** Extensions Office Studio opens as documents. */
export const OFFICE_OPEN_EXTS = FORMATS.filter((f) => f.read).flatMap((f) => f.ext);
/** Extensions that only Office Studio claims (word processor files and the guidance formats). */
export const OFFICE_ONLY_EXTS = ["docx", "docm", "dotx", "dotm", "odt", "ott", "fodt", "rtf", "doc", "dot", "wps", "wpd", "pages", "gdoc", "gsheet", "gslides", "xlsx", "xlsm", "xls", "xltx", "ods", "fods", "ots", "numbers", "pptx", "ppt", "ppsx", "potx", "odp", "fodp", "otp", "key", "excalidraw", "tldraw"];

const extOf = (name) => (/\.([^./\\]+)$/.exec(String(name || ""))?.[1] || "").toLowerCase();

/** The format of a file from its content first and its name second, or null. */
export function detectOfficeFormat(name = "", bytes = null) {
  const ext = extOf(name);
  const byExt = FORMATS.find((f) => f.ext.includes(ext)) || null;
  if (bytes && bytes.length >= 4) {
    if (isZip(bytes)) {
      const { entries } = readZip(bytes, { want: (n) => n === "mimetype" || n === "[Content_Types].xml" || n === "word/document.xml" || n === "xl/workbook.xml" || n === "ppt/presentation.xml" || n === "index.xml" || n.startsWith("Index/Document"), limits: { maxEntryBytes: 64 * 1024 * 1024 } });
      if (entries["word/document.xml"]) return FORMATS[0];
      if (entries["xl/workbook.xml"]) return FORMATS.find((f) => f.id === "xlsx");
      if (entries["ppt/presentation.xml"]) return FORMATS.find((f) => f.id === "pptx");
      const mime = entries.mimetype ? new TextDecoder().decode(entries.mimetype).trim() : "";
      if (/opendocument\.text/.test(mime)) return FORMATS.find((f) => f.id === "odt");
      if (/opendocument\.spreadsheet/.test(mime)) return FORMATS.find((f) => f.id === "ods");
      if (/opendocument\.presentation/.test(mime)) return FORMATS.find((f) => f.id === "odp");
      if (ext === "pages" || ext === "numbers" || ext === "key" || Object.keys(entries).some((k) => k.startsWith("Index/"))) return byExt?.kind === "spreadsheet" || byExt?.kind === "presentation" ? byExt : FORMATS.find((f) => f.id === "pages");
      return byExt?.read ? null : byExt; // an .ofini or another ZIP: not ours
    }
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      // OLE compound file: Word 97-2003, Excel 97-2003 or PowerPoint 97-2003
      if (byExt && byExt.kind !== "document") return byExt;
      return FORMATS.find((f) => f.id === "doc");
    }
    const head = new TextDecoder().decode(bytes.subarray(0, 256)).replace(/^\uFEFF/, "").trimStart();
    if (head.startsWith("{\\rtf")) return FORMATS.find((f) => f.id === "rtf");
    if (ext === "gdoc" || ext === "gsheet" || ext === "gslides") return byExt;
    if (/^<\?xml[^>]*>\s*<office:document/.test(head)) return FORMATS.find((f) => f.id === "odt");
  }
  return byExt;
}

/**
 * Reads a Google Drive shortcut (.gdoc / .gsheet / .gslides): a small JSON file with the document URL and id.
 * @returns {{ url: string|null, id: string|null, kind: string }}
 */
export function parseGdoc(bytes, name = "") {
  const kind = extOf(name) === "gsheet" ? "spreadsheet" : extOf(name) === "gslides" ? "presentation" : "document";
  let json = null;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(0, 64 * 1024)));
  } catch {
    json = null;
  }
  const id = typeof json?.doc_id === "string" && /^[\w-]{10,200}$/.test(json.doc_id) ? json.doc_id : null;
  let url = typeof json?.url === "string" ? json.url : null;
  try {
    const u = url ? new URL(url) : null;
    if (!u || u.protocol !== "https:" || !/(^|\.)google\.com$/.test(u.hostname)) url = null;
  } catch {
    url = null;
  }
  if (!url && id) url = `https://docs.google.com/${kind === "spreadsheet" ? "spreadsheets" : kind === "presentation" ? "presentation" : "document"}/d/${id}/edit`;
  return { url, id, kind };
}

/**
 * Text for the guidance dialog of formats Office Studio does not open (yet).
 * @returns {{ title: string, message: string, steps: string[], url?: string|null }|null}
 */
export function officeGuidance(format, { name = "", bytes = null } = {}) {
  if (!format) return null;
  const file = name || "This file";
  switch (format.kind) {
    case "cloud": {
      const g = bytes ? parseGdoc(bytes, name) : { url: null, kind: "document" };
      const what = g.kind === "spreadsheet" ? "Google Sheets" : g.kind === "presentation" ? "Google Slides" : "Google Docs";
      const fmt = g.kind === "spreadsheet" ? "Microsoft Excel (.xlsx) or OpenDocument (.ods)" : g.kind === "presentation" ? "Microsoft PowerPoint (.pptx) or ODP" : "Microsoft Word (.docx) or OpenDocument (.odt)";
      return {
        title: `${what} files live in the cloud`,
        message: `${file} is only a shortcut to a document stored in Google Drive; it contains no text. Download a copy from ${what} and open that file here:`,
        steps: [`Open the document in ${what}${g.url ? " (the button below opens it in your browser)" : ""}.`, `Choose File ▸ Download ▸ ${fmt}.`, "Open the downloaded file here with File ▸ Open. To send changes back, export it in the same format and upload it to Google Drive (Google opens and converts .docx, .xlsx and .pptx files)."],
        url: g.url,
      };
    }
    case "legacy":
      if (format.id === "pages")
        return { title: "Apple Pages files cannot be opened directly", message: "The .pages format is proprietary. Export a copy from Pages and open it here:", steps: ["In Pages choose File ▸ Export To ▸ Word… (or Rich Text / Plain Text).", "Open the exported .docx file here with File ▸ Open."] };
      return { title: "Word 97-2003 documents (.doc) are not supported", message: `${file} uses the old binary Word format, which Office Studio does not read. Save it in the current format first:`, steps: ["Open it in Microsoft Word, LibreOffice or Google Docs.", "Choose File ▸ Save As… ▸ Word Document (.docx) (LibreOffice: File ▸ Save As ▸ Word 2007-365 or ODF Text Document).", "Open the .docx or .odt file here."] };
    case "spreadsheet":
      return {
        title: "Spreadsheets are not supported in this version",
        message: `Spreadsheets (${format.label}) open in the Office Suite's Spreadsheet app, which this version does not include.`,
        steps: format.id === "csv" ? ["CSV files open today as an editable table in the Layout studio: switch to Layout and use Table ▸ Import Table…, or open the file in the Code studio to edit it as text."] : ["Save the sheet as CSV in your spreadsheet app, then use Table ▸ Import Table… in the Layout studio for an editable table, or export it as PDF and open the PDF."],
      };
    case "presentation":
      return { title: "Presentations are not supported in this version", message: `Presentations (${format.label}) open in the Office Suite's Presentation app, which this version does not include.`, steps: ["Export the presentation as PDF from PowerPoint, Keynote, Impress or Google Slides and open the PDF: every slide becomes an editable page in the Layout studio."] };
    case "whiteboard":
      return { title: "Whiteboards are not supported in this version", message: `Whiteboard files (${format.label}) open in the Office Suite's Whiteboard app, which this version does not include.`, steps: ["Export the drawing as SVG or PNG from Excalidraw or tldraw and open that file: SVG stays editable in the Vector studio."] };
  }
  return null;
}

/**
 * Imports a document file.
 * @param {string} name
 * @param {Uint8Array} bytes
 * @param {{ report?: object, format?: string }} [o]
 * @returns {{ doc: object, report: object, format: OfficeFormat }}
 */
export function importOffice(name, bytes, o = {}) {
  const format = o.format ? FORMATS.find((f) => f.id === o.format) : detectOfficeFormat(name, bytes);
  if (!format || !format.read) throw new Error(`“${name}” is not a document Office Studio can open.`);
  const report = o.report || createReport(format.label, name);
  const text = () => new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  let res;
  switch (format.id) {
    case "docx":
      res = readDocx(bytes, { report, name });
      break;
    case "odt":
      res = readOdt(bytes, { report, name });
      break;
    case "rtf":
      res = readRtf(bytes, { report, name });
      break;
    case "html":
      res = readHtml(text(), { report, name });
      break;
    case "md":
      res = readMarkdown(text(), { report, name });
      break;
    default:
      res = readText(text(), { report, name });
  }
  if (!res.doc.meta.title) res.doc.meta.title = String(name).replace(/\.[^.]+$/, "");
  return { doc: res.doc, report, format };
}

/**
 * Exports to a format other than PDF (PDF needs the layout engine: see pdf.js).
 * @returns {{ bytes: Uint8Array, mime: string, ext: string }}
 */
export function exportOffice(doc, id, o = {}) {
  const f = FORMATS.find((x) => x.id === id && x.write);
  if (!f || id === "pdf") throw new Error(`Cannot export to ${id} here.`);
  const enc = (s) => new TextEncoder().encode(s);
  let bytes;
  switch (id) {
    case "docx":
      bytes = writeDocx(doc, o);
      break;
    case "odt":
      bytes = writeOdt(doc, o);
      break;
    case "rtf":
      bytes = enc(writeRtf(doc, o));
      break;
    case "html":
      bytes = enc(writeHtml(doc, o));
      break;
    case "md":
      bytes = enc(writeMarkdown(doc, o));
      break;
    default:
      bytes = enc(writeText(doc, o));
  }
  return { bytes, mime: f.mime, ext: f.ext[0] };
}

export { readDocx, writeDocx, readOdt, writeOdt, readRtf, writeRtf, readHtml, writeHtml, readMarkdown, writeMarkdown, readText, writeText };
