// PDF loader for the knowledge base (rag-loader engine "pdf", registered by platform/builtin-engines.js). Lazy: pdf.js
// loads only when a PDF is indexed. Reads the text layer page by page; pages without one (scans) go to the first
// registered OCR engine when there is one, otherwise they are reported as skipped. Nothing leaves the device unless the
// user installed an OCR engine that is not local (its label says so).
//
//   itemsToText(items) -> string               pdf.js text items to lines (pure, tested)
//   loadPdfText(bytes, { signal, ocr, maxPages, renderPage }) -> { text, pages: [{ n, char }], skipped: [{ page, reason }] }

export const PDF_CAPS = Object.freeze({ maxPages: 1000, minTextChars: 16, ocrScale: 2 });

/** Joins pdf.js text items into lines: a new line on `hasEOL` or when the baseline moves. */
export function itemsToText(items) {
  let out = "";
  let lastY = null;
  for (const it of items || []) {
    if (typeof it?.str !== "string") continue;
    const y = Array.isArray(it.transform) ? Math.round(it.transform[5]) : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
    else if (out && !out.endsWith("\n") && !out.endsWith(" ") && it.str && !it.str.startsWith(" ")) out += " ";
    out += it.str;
    if (it.hasEOL) out += "\n";
    if (y !== null) lastY = y;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Renders a pdf.js page to RGBA pixels (browser only; the OCR input). */
async function renderToPixels(page, scale) {
  if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") throw new Error("Pages cannot be rendered here.");
  const vp = page.getViewport({ scale });
  const w = Math.ceil(vp.width);
  const h = Math.ceil(vp.height);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/**
 * @param {Uint8Array} bytes
 * @param {{signal?:AbortSignal, ocr?:{recognize:Function,label:string}|null, lang?:string, maxPages?:number, renderPage?:Function}} [o]
 */
export async function loadPdfText(bytes, { signal, ocr = null, lang = "en", maxPages = PDF_CAPS.maxPages, renderPage = renderToPixels } = {}) {
  const { openPdf, PdfPasswordError } = await import("../core/pdf-source.js");
  let src;
  try {
    src = await openPdf(bytes);
  } catch (err) {
    if (err instanceof PdfPasswordError) throw new Error("The PDF is password protected; open it and save an unprotected copy to index it.");
    throw err;
  }
  try {
    let text = "";
    const pages = [];
    const skipped = [];
    const last = Math.min(src.pages, maxPages);
    for (let n = 1; n <= last; n++) {
      if (signal?.aborted) throw signal.reason || new Error("Aborted.");
      const page = await src.doc.getPage(n);
      let t = itemsToText((await page.getTextContent()).items);
      if (t.replace(/\s/g, "").length < PDF_CAPS.minTextChars) {
        if (ocr) {
          try {
            t = String((await ocr.recognize(await renderPage(page, PDF_CAPS.ocrScale), { lang, signal }))?.text ?? "").trim();
          } catch (err) {
            skipped.push({ page: n, reason: `OCR (${ocr.label}) failed: ${String(err?.message || err).slice(0, 120)}` });
            t = "";
          }
        } else if (!t.trim()) skipped.push({ page: n, reason: "no text layer (a scanned page needs an OCR engine)" });
      }
      page.cleanup?.();
      if (!t.trim()) continue;
      if (text) text += "\n\n";
      pages.push({ n, char: text.length });
      text += t;
    }
    if (src.pages > last) skipped.push({ page: last + 1, reason: `only the first ${last} pages are indexed` });
    return { text, pages, skipped };
  } finally {
    src.destroy();
  }
}
