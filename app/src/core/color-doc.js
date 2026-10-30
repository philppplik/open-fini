// Document color management glue (lazy): the document's color context, color conversion of layers and swatches,
// and print PDF export (PDF/X-1a, PDF/X-4, CMYK documents) with its preflight. See docs/color-management.md.
import { createColorContext, normalizeColorSettings } from "../engine/color/context.js";
import { preflight, hasTransparency } from "../engine/color/preflight.js";
import { pdfPageLists, writePdf, rasterizeList } from "./io.js";

const cache = new WeakMap();

/** The normalized color settings of a document (document.json -> settings.color). */
export const colorSettings = (doc) => normalizeColorSettings(doc?.settings?.color);

/** The cached color context of a document; falls back to the approximation when the profile asset is unusable. */
export function getColorContext(doc) {
  const s = colorSettings(doc);
  const bytes = s.cmyk ? doc.assets?.[s.cmyk]?.bytes || null : null;
  const key = JSON.stringify(s) + (bytes ? bytes.length : 0);
  const hit = cache.get(doc);
  if (hit && hit.key === key) return hit.ctx;
  let ctx;
  try {
    ctx = createColorContext(s, bytes);
  } catch {
    ctx = createColorContext({ ...s, cmyk: null }, null);
  }
  cache.set(doc, { key, ctx });
  return ctx;
}

/** Visits every paint holder of the document: { owner, key } pairs whose owner[key] is a paint. */
function eachPaint(doc, nodes, fn) {
  const visit = (n) => {
    if (n.fill) fn(n, "fill");
    if (n.stroke?.fill) fn(n, "stroke");
  };
  if (nodes) nodes.forEach(visit);
  else doc.walkAll(visit, { masters: true });
}

/** Converted copy of one paint: to native CMYK ("cmyk") or back to plain RGB ("rgb"). */
export function convertPaint(ctx, paint, to) {
  const one = (p) => {
    const q = { ...p };
    if (to === "rgb") {
      delete q.cmyk;
      delete q.spot;
      return q;
    }
    q.cmyk = Array.isArray(p.cmyk) && p.cmyk.length === 4 ? p.cmyk.slice() : ctx.rgbToCmyk(p.color);
    q.color = ctx.cmykToHex(q.cmyk);
    return q;
  };
  if (paint.type === "solid") return one(paint);
  if (Array.isArray(paint.stops)) return { ...paint, stops: paint.stops.map(one) };
  return paint;
}

/**
 * Converts the colors of layers (or of the whole document and its swatches) in one undo step.
 * @returns {number} how many paints changed
 */
export function convertColors(doc, { nodes = null, to = "cmyk", swatches = !nodes } = {}) {
  const ctx = getColorContext(doc);
  let n = 0;
  doc.tx(to === "cmyk" ? "Convert Colors to CMYK" : "Convert Colors to RGB", () => {
    eachPaint(doc, nodes, (node, key) => {
      if (key === "fill") n += doc.set(node, { fill: convertPaint(ctx, node.fill, to) }) ? 1 : 0;
      else n += doc.set(node, { stroke: { ...node.stroke, fill: convertPaint(ctx, node.stroke.fill, to) } }) ? 1 : 0;
    });
    if (swatches) {
      for (const sw of doc.swatches) {
        // eslint-disable-next-line no-unused-vars
        const { type, ...p } = convertPaint(ctx, { type: "solid", ...sw }, to);
        if (to === "rgb") Object.assign(p, { cmyk: undefined, spot: undefined });
        n += doc.set(sw, p) ? 1 : 0;
      }
    }
  });
  return n;
}

/** Recomputes the RGB previews of native CMYK paints (after the profile or intent changed). Call inside a tx. */
export function refreshCmykPreviews(doc) {
  const ctx = getColorContext(doc);
  const fix = (p) => {
    if (p?.type === "solid" && Array.isArray(p.cmyk)) return { ...p, color: ctx.cmykToHex(p.cmyk) };
    if (Array.isArray(p?.stops) && p.stops.some((s) => s.cmyk)) return { ...p, stops: p.stops.map((s) => (s.cmyk ? { ...s, color: ctx.cmykToHex(s.cmyk) } : s)) };
    return p;
  };
  eachPaint(doc, null, (node, key) => {
    if (key === "fill") doc.set(node, { fill: fix(node.fill) });
    else doc.set(node, { stroke: { ...node.stroke, fill: fix(node.stroke.fill) } });
  });
  for (const sw of doc.swatches) if (Array.isArray(sw.cmyk)) doc.set(sw, { color: ctx.cmykToHex(sw.cmyk) });
}

/**
 * Print PDF: converts to DeviceCMYK for PDF/X and CMYK documents, flattens transparent pages for PDF/X-1a, writes the
 * OutputIntent and returns the preflight of exactly what was written.
 * @param {{standard?:'x1a'|'x4'|null, bleed?:boolean, cropMarks?:boolean, rasterDpi?:number, dryRun?:boolean}} o
 */
export async function printPdf(app, pages, { standard = null, bleed = false, cropMarks = false, rasterDpi = 300, dryRun = false } = {}) {
  const doc = app.doc;
  const ctx = getColorContext(doc);
  const lists = pdfPageLists(app, pages, { rasterDpi });
  const flattened = [];
  if (standard === "x1a") {
    lists.forEach((dl, i) => {
      if (!hasTransparency(dl.items)) return;
      lists[i] = rasterizeList(dl, rasterDpi / doc.dpi, pages[i].bg || "#ffffff");
      flattened.push(i);
    });
  }
  const convert = !!standard || ctx.settings.mode === "cmyk";
  const report = {};
  const name = ctx.approximate ? "Custom" : doc.settings.color?.cmykName || ctx.profileName;
  const bytes = await writePdf(app, lists, {
    bleed: bleed ? Math.max(...pages.map((p) => p.bleed || 0)) : 0,
    cropMarks,
    color: convert ? { toCmyk: ctx.toCmyk, imageToCmyk: ctx.imageToCmyk } : null,
    pdfx: standard ? { version: standard, profile: ctx.cmykIcc, identifier: name, condition: ctx.profileName, info: ctx.approximate ? "OpenFini approximate CMYK, not a characterized printing condition" : ctx.profileName } : null,
    report,
  });
  const pf = preflight(lists, { standard, pages: pages.map((p) => ({ bleed: bleed ? p.bleed : 0 })), dpi: doc.dpi, fonts: report.fonts, approximate: ctx.approximate, flattened });
  return { bytes: dryRun ? null : bytes, preflight: pf, approximate: ctx.approximate };
}

/** Tags exported PNG / JPEG bytes with the RGB working space when it is not sRGB (sRGB files stay untagged). */
export async function tagRaster(doc, bytes, format) {
  const s = colorSettings(doc);
  if (s.rgb === "srgb" || (format !== "png" && format !== "jpeg")) return bytes;
  const { embedIccPng, embedIccJpeg } = await import("../engine/color/embed.js");
  const icc = getColorContext(doc).rgbIcc();
  return format === "png" ? embedIccPng(bytes, icc, s.rgb) : embedIccJpeg(bytes, icc);
}
