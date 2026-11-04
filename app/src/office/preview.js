// Office preview for the Vibe Studio canvas tab (ui/vibe/panel-canvas.js): one PNG of a "page" of an Office document,
// rendered with each app's own render helpers (loaded lazily, nothing at start-up):
//   document  word-processor pages (engine/office/pdf.js ▸ layoutPages)       pages = laid-out pages
//   sheet     the grid snapshot of one sheet (office/sheet/render.js)         pages = sheets
//   slides    one slide (office/slides/render.js)                             pages = visible slides
//   board     one whiteboard page (office/board/export.js)                    pages = board pages
// Public API: officePreview(doc, { index, maxPx }) → { bytes, width, height, count, labels }
// The returned width/height are the logical page size (for zoom/fit), the PNG is at most maxPx on its longest side.
import { officeKindOf } from "./apps.js";

async function pngOf(dl, maxPx, bg = "#ffffff") {
  const [{ renderToCanvas }, { canvasToPng }] = await Promise.all([import("../engine/backends/canvas.js"), import("./toolkit/export.js")]);
  const scale = Math.min(2, maxPx / Math.max(1, dl.width, dl.height));
  return canvasToPng(renderToCanvas(dl, { scale, bg }));
}

/** Renders one page of an Office document as PNG bytes. */
export async function officePreview(doc, { index = 0, maxPx = 1600 } = {}) {
  const kind = officeKindOf(doc);
  const model = doc.office?.model;
  if (!model) return null;
  if (kind === "sheet") {
    const [{ sheetPages }, { measurer }, { calcFor }] = await Promise.all([import("./sheet/render.js"), import("../core/fonts.js"), import("./sheet/app.js")]);
    const calc = calcFor(doc); // also normalizes doc.office.model
    const m = doc.office.model;
    const sheets = m.sheets || [];
    const i = Math.max(0, Math.min(sheets.length - 1, index));
    const [pg] = sheetPages(m, sheets[i].id, calc, { measurer, single: true });
    return { bytes: await pngOf(pg, maxPx), width: pg.width, height: pg.height, count: sheets.length, labels: sheets.map((s) => s.name), index: i };
  }
  if (kind === "slides") {
    const [M, R, { measure }] = await Promise.all([import("./slides/model.js"), import("./slides/render.js"), import("../core/fonts.js")]);
    const deck = model.version === M.SLIDES_VERSION ? model : M.normalizeDeck(model);
    const i = Math.max(0, Math.min(deck.slides.length - 1, index));
    const dl = R.slideDisplayList(deck, deck.slides[i], await R.decodeImages(deck), measure);
    return { bytes: await pngOf(dl, maxPx), width: deck.size.w, height: deck.size.h, count: deck.slides.length, labels: deck.slides.map((_, n) => `Slide ${n + 1}`), index: i };
  }
  if (kind === "board") {
    const [{ sortedPages }, { pageDisplayList }, { measureText }, { exportImages }] = await Promise.all([import("./board/model.js"), import("./board/render.js"), import("./board/app.js"), import("./board/export.js")]);
    const pages = sortedPages(model);
    const i = Math.max(0, Math.min(pages.length - 1, index));
    const images = await exportImages(model);
    let dl;
    let bytes;
    try {
      dl = pageDisplayList(model, pages[i].id, { measure: measureText, image: (id) => images.get(id) || null });
      bytes = await pngOf(dl, maxPx, null);
    } finally {
      for (const ref of images.values()) ref.source?.close?.();
    }
    return { bytes, width: dl.width, height: dl.height, count: pages.length, labels: pages.map((p, n) => p.name || `Page ${n + 1}`), index: i };
  }
  // word processor
  const [{ layoutPages }, { rasterize }] = await Promise.all([import("../engine/office/pdf.js"), import("../ui/office/dialogs.js")]);
  const pages = layoutPages(model, { images: await rasterize(model.media, { rgba: true }) });
  const i = Math.max(0, Math.min(pages.length - 1, index));
  const pg = pages[i];
  return { bytes: await pngOf(pg, maxPx), width: pg.width, height: pg.height, count: pages.length, labels: pages.map((_, n) => `Page ${n + 1}`), index: i };
}
