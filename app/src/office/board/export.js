// Whiteboard image and print exports (PNG, SVG: the current page; PDF: every page), loaded by office/board/app.js
// save(). The engine backends are imported statically here so they stay in the chunks they already live in (a
// dynamic import of a start-up module would split it into a file of its own).
import { displayListToSVGResult } from "../../engine/backends/svg.js";
import { renderToCanvas } from "../../engine/backends/canvas.js";
import { canvasToPng, displayListsToPdf } from "../toolkit/export.js";
import { pageDisplayList } from "./render.js";
import { sortedPages, toBase64 } from "./model.js";

/** Decodes the model's images once for an export: ImageRefs for canvas (source), SVG (href) and PDF (rgba / jpeg). */
async function exportImages(model, { rgba = false } = {}) {
  const out = new Map();
  for (const [id, md] of Object.entries(model.media || {})) {
    if (!md?.bytes) continue;
    try {
      const bmp = await createImageBitmap(new Blob([md.bytes], { type: md.mime }));
      const ref = { id, width: bmp.width, height: bmp.height, source: bmp, href: `data:${md.mime};base64,${toBase64(md.bytes)}` };
      if (md.mime === "image/jpeg") ref.jpeg = md.bytes;
      else if (rgba) {
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = c.getContext("2d");
        cx.drawImage(bmp, 0, 0);
        ref.rgba = cx.getImageData(0, 0, bmp.width, bmp.height).data;
      }
      out.set(id, ref);
    } catch {
      /* an undecodable image stays a placeholder */
    }
  }
  return out;
}

/** @returns {Promise<{ bytes: Uint8Array, mime: string, ext: string, notes?: string[] }>} */
export async function exportBoard(model, format, { page, title, measure }) {
  const images = await exportImages(model, { rgba: format === "pdf" });
  const opts = { measure, image: (id) => images.get(id) || null };
  try {
    if (format === "svg") {
      const { svg, warnings } = displayListToSVGResult(pageDisplayList(model, page, opts), { title: model.title || title, encodeImage: (img) => img.href || null });
      return { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml", ext: "svg", notes: warnings };
    }
    if (format === "png") {
      const dl = pageDisplayList(model, page, opts);
      const scale = Math.min(2, 8000 / Math.max(dl.width, dl.height));
      return { bytes: await canvasToPng(renderToCanvas(dl, { scale })), mime: "image/png", ext: "png" };
    }
    const pages = sortedPages(model).map((p) => pageDisplayList(model, p.id, opts));
    return { bytes: await displayListsToPdf(pages, { title: model.title || title }), mime: "application/pdf", ext: "pdf", notes: ["Fonts fall back to the PDF standard fonts."] };
  } finally {
    for (const ref of images.values()) ref.source?.close?.();
  }
}
