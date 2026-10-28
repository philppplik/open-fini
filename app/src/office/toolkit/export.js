// Office Toolkit: PDF and PNG export helpers shared by the Office apps. They reuse the app's existing engines: PDF
// pages are display lists written by engine/backends/pdf.js (the same writer core/io.js uses for design documents),
// PNGs come from a canvas the app renders (core/ofini.js ▸ canvasToBytes). Lazy: import it from your app's save().
//
// Public API
//   displayListsToPdf(pages, { title, pxPerInch = 96 }) → Uint8Array
//      pages: [{ width, height, items }] display lists in px, y down (docs/engine-contracts.md)
//   canvasToPng(canvas) → Promise<Uint8Array>
//   svgToPng(svgText, { width, height, scale = 2, background }) → Promise<Uint8Array>   (rasterizes in the browser)
// Invariants: never touches the network; fonts fall back to the PDF standard fonts like every PDF export.
import { canvasToBytes } from "../../core/ofini.js";

export async function displayListsToPdf(pages, { title = "", pxPerInch = 96 } = {}) {
  const { createPDF } = await import("../../engine/backends/pdf.js");
  return createPDF(pages, { pxPerInch, title, creator: "OpenFini", producer: "OpenFini" });
}

export const canvasToPng = (canvas) => canvasToBytes(canvas, "image/png");

export async function svgToPng(svgText, { width, height, scale = 2, background = null } = {}) {
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  const bmp = await createImageBitmap(blob);
  const w = Math.max(1, Math.round((width || bmp.width) * scale));
  const hh = Math.max(1, Math.round((height || bmp.height) * scale));
  const c = new OffscreenCanvas(w, hh);
  const ctx = c.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, hh);
  }
  ctx.drawImage(bmp, 0, 0, w, hh);
  bmp.close?.();
  return canvasToPng(c);
}
