// Tools for documents that were imported from other formats (PDF, AI, PSD, IDML, Sketch, SVG): the import report and the
// text of every page. The assistant has no file access of its own; the user opens attachments with "Open as document".
import { tool, S } from "./helpers.js";
import { documentPagesText } from "../../core/doc-text.js";
import { parsePageRange } from "../../core/pdf-source.js";

export function importTools(app) {
  const pagesOf = (doc, range) => {
    const nums = range ? parsePageRange(range, doc.pages.length) : null;
    if (range && !nums) throw new Error(`The page range "${range}" is not valid (1-${doc.pages.length}).`);
    return nums;
  };
  const needDoc = () => {
    if (!app.doc) throw new Error("No document is open. Ask the user to open the file (the attachment chip has an “Open as document” button).");
    return app.doc;
  };
  return [
    tool("get_import_report", "Returns what the importer kept editable, flattened and dropped when the active document was opened from another file format (PDF, Illustrator, Photoshop, InDesign IDML, Sketch, SVG). Null when the document was not imported.", {}, [], () => {
      const doc = needDoc();
      return doc.importReport ? doc.importReport.toJSON() : { report: null, message: "The active document was not imported from another format." };
    }, { readOnly: true }),

    tool("list_pdf_pages", "Lists the pages of the active document with size, number of text blocks and a short text excerpt. Meant for documents opened from a PDF.", {}, [], () => {
      const doc = needDoc();
      return { document: doc.name, source: doc.importReport?.format || null, pages: documentPagesText(doc, { maxChars: 20000 }).map((p) => ({ page: p.index, name: p.name, width: p.width, height: p.height, textBlocks: p.blocks, excerpt: p.text.slice(0, 160) })) };
    }, { readOnly: true }),

    tool("describe_document_pages", "Returns the text of the pages of the active document in reading order, for summarizing, translating or checking content. Use `pages` such as \"1-3, 5\" for a subset.", { pages: S.str("Page range, e.g. \"1-3, 5\". Default: all pages.") }, [], ({ pages }) => {
      const doc = needDoc();
      return { document: doc.name, pages: documentPagesText(doc, { pages: pagesOf(doc, pages), maxChars: 60000 }).map((p) => ({ page: p.index, name: p.name, text: p.text })) };
    }, { readOnly: true }),

    tool("extract_pdf_text", "Extracts the plain text of the active document that was opened from a PDF (or Illustrator file), page by page, in reading order.", { pages: S.str("Page range, e.g. \"1-3, 5\". Default: all pages.") }, [], ({ pages }) => {
      const doc = needDoc();
      const fmt = doc.importReport?.format || "";
      if (!/PDF|Illustrator|EPS/i.test(fmt)) throw new Error("The active document was not opened from a PDF. Use describe_document_pages for any document.");
      const list = documentPagesText(doc, { pages: pagesOf(doc, pages), maxChars: 120000 });
      return { document: doc.name, text: list.map((p) => `--- Page ${p.index} ---\n${p.text}`).join("\n\n") };
    }, { readOnly: true }),
  ];
}
