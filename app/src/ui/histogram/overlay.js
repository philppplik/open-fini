// Clipping overlay: marks pixels with a clipped channel on the canvas (shadows blue, highlights red).
// Computed from a bounded composite render (<= 4 MP), cached until the document changes.
import { buildPageDL } from "../../engine/dl.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { clipFlags } from "../../engine/pixel/histogram-analysis.js";
import { renderItems } from "./source.js";
import { debounce } from "../../core/util.js";

const MAX_PIXELS = 4_000_000;
let installed = null;

/** Installs the overlay once; it draws only while one of the two preferences is on. */
export function ensureClipOverlay(app) {
  if (installed) return installed;
  let cache = null; // { key, canvas, scale }
  let counts = { low: 0, high: 0 };
  const wanted = () => !!(app.prefs.histClipShadows || app.prefs.histClipHighlights);

  const build = () => {
    const page = app.page;
    if (!app.doc || !page || !wanted()) return;
    const key = `${app.doc.id}|${app.doc.rev}|${page.id}`;
    if (cache && cache.key === key) return;
    const W = Math.max(1, Math.round(page.w));
    const H = Math.max(1, Math.round(page.h));
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (W * H)));
    const img = renderItems(page, buildPageDL(app.doc, page).items, { scale, bg: page.bg });
    const flags = clipFlags(img);
    const lowImg = new ImageData(img.width, img.height);
    const highImg = new ImageData(img.width, img.height);
    let low = 0, high = 0;
    for (let i = 0, j = 0; i < flags.length; i++, j += 4) {
      const f = flags[i];
      if (f & 2) {
        high++;
        highImg.data.set([255, 40, 40, 215], j);
      }
      if (f & 1) {
        low++;
        lowImg.data.set([40, 110, 255, 215], j);
      }
    }
    const mk = (id) => {
      const c = createCanvas(img.width, img.height);
      ctx2d(c).putImageData(id, 0, 0);
      return c;
    };
    cache = { key, low: mk(lowImg), high: mk(highImg), pageId: page.id };
    counts = { low, high };
    app.requestOverlay();
  };
  const later = debounce(build, 250);
  for (const ev of ["docchange", "doc", "page", "prefs"]) app.on(ev, () => wanted() && later());

  app.on("overlay-extra", (ctx) => {
    if (!wanted() || !cache || !app.state || cache.pageId !== app.page.id) return;
    const page = app.page;
    const [x, y] = app.pageToScreen(0, 0, page);
    const z = app.view.zoom;
    const wantLow = !!app.prefs.histClipShadows, wantHigh = !!app.prefs.histClipHighlights;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (wantLow) ctx.drawImage(cache.low, x, y, page.w * z, page.h * z);
    if (wantHigh) ctx.drawImage(cache.high, x, y, page.w * z, page.h * z);
    ctx.restore();
  });
  installed = { rebuild: () => { cache = null; build(); }, counts: () => counts };
  build();
  return installed;
}
