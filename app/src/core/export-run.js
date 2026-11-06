// Runs an export described by the options schema (engine/export/options.js): renders every planned file and saves it
// (one file directly, several as a ZIP archive) or hands the files to a callback (Send by email). Lazy: loaded by the
// Export dialog, the File ▸ Export as … commands and the Vibe export tools. See docs/export.md.
//
// Public API
//   detectEncoders()                 -> Promise<Set<mime>>  image types the browser can encode (WebP, AVIF vary)
//   exportEnv(app)                   -> env for normalizeExportSettings / visibleOptions (document facts)
//   exportInfo(app)                  -> info for planExport (pages, selection, layers)
//   renderExport(app, settings)      -> { files: [{ name, bytes, mime }], warnings, preflight }
//   runExport(app, settings)         -> renders and saves; single flight per document (a double click joins the run)
// Invariants
//   * Settings are normalized first, so partial, legacy and preset settings all work, and nothing outside the schema
//     reaches the encoders.
//   * The document is never changed: layer exports render a temporary page that holds only that layer.
import { zipSync } from "../../vendor/fflate/fflate.js";
import { t } from "../i18n/index.js";
import { platform } from "../platform/index.js";
import { formatBytes, uid } from "./util.js";
import { createCanvas, ctx2d } from "./doc.js";
import { pageBoundsOf } from "./transform.js";
import { canvasToBytes } from "./ofini.js";
import { singleFlight } from "./single-flight.js";
import { exportRaster, prepareVectorDL, pdfPageLists, writePdf } from "./io.js";
import { buildPageDL, ensureHyphenation } from "../engine/dl.js";
import { displayListToSVGResult } from "../engine/backends/svg.js";
import { normalizeExportSettings, planExport, formatInfo, spreadGroups } from "../engine/export/options.js";
import { xmpPacket, keywordList } from "../engine/export/bytes.js";
import { combineSpread, imagePlacements, downsampleTarget, replaceImage } from "../engine/export/pdf-prep.js";

let encoders = null;
/** Image types this browser encodes for real (Safari, for example, silently returns PNG for WebP). */
export async function detectEncoders() {
  if (encoders) return encoders;
  const set = new Set(["image/png", "image/jpeg"]);
  try {
    const c = createCanvas(2, 2);
    ctx2d(c).fillRect(0, 0, 1, 1);
    const sig = { "image/webp": (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, "image/avif": (b) => String.fromCharCode(...b.subarray(4, 12)) === "ftypavif" };
    for (const [type, ok] of Object.entries(sig)) {
      const b = await canvasToBytes(c, type, 0.8).catch(() => null);
      if (b && b.length > 12 && ok(b)) set.add(type);
    }
  } catch {
    set.add("image/webp"); // no canvas: assume the common case
  }
  return (encoders = set);
}

/** Top-level visible layers of a page with their bounds. */
function topLayers(page) {
  return page.root.children.filter((n) => n.visible !== false).map((n) => ({ node: n, name: n.name || "Layer", bounds: pageBoundsOf([n]) }));
}

/** Document facts the options depend on. */
export function exportEnv(app) {
  const doc = app.doc;
  let hasText = false;
  doc.walkAll((n) => {
    if (n.type === "text") hasText = true;
  }, { masters: true });
  const color = doc.settings?.color || {};
  return {
    pages: doc.pages.length,
    hasSelection: app.selection.length > 0,
    layers: app.page ? topLayers(app.page).filter((l) => l.bounds).length : 0,
    facing: !!doc.settings?.facing,
    cmykDoc: color.mode === "cmyk",
    wideGamut: !!color.rgb && color.rgb !== "srgb",
    encoders: encoders || new Set(["image/png", "image/jpeg", "image/webp"]),
    userFonts: (app.fonts?.size || 0) > 0,
    hasText,
    studio: app.studio,
  };
}

/** What planExport needs to know about the document. */
export function exportInfo(app) {
  const doc = app.doc;
  return {
    name: doc.name || "Untitled",
    dpi: doc.dpi || 96,
    current: Math.max(0, doc.pages.indexOf(app.page)),
    pages: doc.pages.map((p) => ({ name: p.name, w: p.w, h: p.h })),
    selection: app.selection.length ? pageBoundsOf(app.selection) : null,
    layers: app.page ? topLayers(app.page) : [],
    facing: !!doc.settings?.facing,
    date: new Date(),
  };
}

/** Metadata of these settings, or null when metadata is off. */
function metaOf(app, st) {
  if (!st.metadata) return null;
  return { title: st.metaTitle || app.doc.name || "", author: st.metaAuthor, rights: st.metaCopyright, description: st.metaDescription, keywords: keywordList(st.metaKeywords), creatorTool: "OpenFini", date: new Date() };
}

const colorDoc = () => import("./color-doc.js");

// ------------------------------------------------------------------ raster

function backgroundOf(st) {
  if (st.background === "transparent") return null;
  if (st.background === "white") return "#ffffff";
  if (st.background === "custom") return st.bgColor;
  return undefined; // page color (white for formats without alpha)
}

async function rasterFile(app, st, job, info, meta) {
  const doc = app.doc;
  const f = formatInfo(st.format);
  const page = doc.pages[job.page];
  const renderPage = job.layer === null ? page : { ...page, root: { ...page.root, children: [info.layers[job.layer].node] } };
  const alpha = st.background === "transparent";
  const canvasFormat = f.alpha ? "png" : "jpeg"; // decides only the fallback background of the render
  const r = await exportRaster(app, { page: renderPage, format: canvasFormat, area: job.area, width: job.size.width, height: job.size.height, background: backgroundOf(st), encode: false });
  const { canvas, width, height } = r;
  const ctx = ctx2d(canvas);
  const img = ctx.getImageData(0, 0, width, height);
  const gray = st.colorMode === "gray";
  const ppi = job.size.ppi;
  const cd = st.embedProfile && !gray ? await colorDoc() : null;
  const rgbIcc = cd ? { name: doc.settings.color?.rgb || "sRGB", bytes: cd.getColorContext(doc).rgbIcc() } : null;

  if (st.format === "png") {
    const { encodePng } = await import("../engine/export/png.js");
    const color = st.colorMode === "indexed" ? "indexed" : gray ? (alpha ? "graya" : "gray") : alpha ? "rgba" : "rgb";
    const text = meta ? { Title: meta.title, Author: meta.author, Copyright: meta.rights, Description: meta.description, Software: "OpenFini", "Creation Time": meta.date.toUTCString(), "XML:com.adobe.xmp": xmpPacket(meta) } : {};
    return encodePng(img, { color, colors: st.colors, dither: st.dither, interlace: st.interlace, level: st.pngLevel, ppi, icc: rgbIcc, text });
  }
  if (st.format === "tiff") {
    const { encodeTiff } = await import("../engine/export/tiff.js");
    let toCmyk = null;
    let icc = rgbIcc?.bytes || null;
    if (st.colorMode === "cmyk") {
      const ctxColor = (await colorDoc()).getColorContext(doc);
      toCmyk = ctxColor.imageToCmyk;
      icc = st.embedProfile ? ctxColor.cmykIcc || null : null; // the built-in approximation has no profile to embed
    }
    const color = st.colorMode === "cmyk" ? "cmyk" : gray ? "gray" : alpha ? "rgba" : "rgb";
    return encodeTiff(img, { color, toCmyk, compression: st.tiffCompression, ppi, icc, meta: meta ? { title: meta.title, description: meta.description, author: meta.author, rights: meta.rights, software: "OpenFini", date: meta.date, xmp: xmpPacket(meta) } : { software: "OpenFini" } });
  }
  // canvas encoders: JPEG, WebP, AVIF
  if (gray) {
    const { luma } = await import("../engine/export/png.js");
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]);
    ctx.putImageData(img, 0, 0);
  }
  let bytes = await canvasToBytes(canvas, f.mime, st.quality / 100);
  if (f.mime === "image/webp" && !(bytes[8] === 0x57 && bytes[9] === 0x45)) throw new Error(t("This browser cannot write WebP files."));
  if (f.mime === "image/avif" && String.fromCharCode(...bytes.subarray(4, 12)) !== "ftypavif") throw new Error(t("This browser cannot write AVIF files."));
  if (st.format === "jpeg") {
    const { jpegSetDensity, jpegAddXmp } = await import("../engine/export/jpeg-meta.js");
    bytes = jpegSetDensity(bytes, ppi);
    if (meta) bytes = jpegAddXmp(bytes, xmpPacket(meta));
    if (rgbIcc) bytes = (await import("../engine/color/embed.js")).embedIccJpeg(bytes, rgbIcc.bytes);
  }
  return bytes;
}

// ------------------------------------------------------------------ SVG

const FONT_MIME = (b) => (b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32 ? "font/woff2" : b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x46 ? "font/woff" : b[0] === 0x4f && b[1] === 0x54 ? "font/otf" : "font/ttf");
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function svgFile(app, st, job, info, meta) {
  const doc = app.doc;
  const page = doc.pages[job.page];
  const renderPage = job.layer === null ? page : { ...page, root: { ...page.root, children: [info.layers[job.layer].node] } };
  const dl = prepareVectorDL(buildPageDL(doc, renderPage), { rasterScale: Math.max(1, st.rasterDpi / (doc.dpi || 96)) });
  const cache = new Map();
  const encodeImage = (ref) => {
    if (cache.has(ref)) return cache.get(ref);
    let url = null;
    if (ref.source) {
      const c = createCanvas(ref.width, ref.height);
      ctx2d(c).drawImage(ref.source, 0, 0);
      let opaque = st.svgImages === "jpeg";
      if (opaque && ref.rgba) for (let i = 3; i < ref.rgba.length; i += 4) if (ref.rgba[i] !== 255) { opaque = false; break; }
      url = c.toDataURL ? c.toDataURL(opaque ? "image/jpeg" : "image/png", st.quality / 100) : null;
    }
    cache.set(ref, url);
    return url;
  };
  const fontFace = st.svgFonts === "embed" ? (font) => {
    const bytes = app.fontBytes?.(font);
    return bytes ? `data:${FONT_MIME(bytes)};base64,${base64(bytes)}` : null;
  } : null;
  const unitK = { px: 1, pt: 72, mm: 25.4, cm: 2.54, in: 1 }[st.svgUnit] / (st.svgUnit === "px" ? 1 : doc.dpi || 96);
  const whole = job.area.x === 0 && job.area.y === 0 && job.area.w === page.w && job.area.h === page.h;
  const r = displayListToSVGResult(dl, {
    background: st.svgBackground && job.layer === null ? page.bg : null,
    encodeImage,
    title: meta?.title || "",
    description: meta?.description || "",
    metadata: meta && (meta.author || meta.rights || meta.keywords.length) ? xmpPacket(meta, { wrapper: false }) : "",
    precision: st.svgPrecision,
    responsive: st.svgResponsive,
    unit: st.svgUnit === "px" ? "" : st.svgUnit,
    pxPerUnit: unitK,
    viewBox: whole ? undefined : job.area,
    fontFace,
  });
  return { bytes: new TextEncoder().encode(r.svg), warnings: r.warnings };
}

// ------------------------------------------------------------------ PDF

async function resampled(ref, width, height) {
  const c = createCanvas(width, height);
  const g = ctx2d(c);
  g.imageSmoothingQuality = "high";
  if (ref.source) g.drawImage(ref.source, 0, 0, width, height);
  else {
    const src = createCanvas(ref.width, ref.height);
    ctx2d(src).putImageData(new ImageData(new Uint8ClampedArray(ref.rgba), ref.width, ref.height), 0, 0);
    g.drawImage(src, 0, 0, width, height);
  }
  return { id: uid("r"), width, height, source: c, rgba: g.getImageData(0, 0, width, height).data, flat: true };
}

const opaque = (rgba) => {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
};

/** Downsampling and image compression on prepared lists (new image references; the document's stay untouched). */
async function optimizeImages(lists, st, dpi, cmyk) {
  const cache = new Map();
  const target = st.downsample ? st.downsamplePpi : 0;
  for (const dl of lists) {
    for (const pl of imagePlacements(dl, dpi)) {
      const img = pl.item.img;
      const size = downsampleTarget(img, pl.ppi, target);
      const mode = st.imageCompression === "jpeg" && !cmyk ? "jpeg" : st.imageCompression;
      if (!size && mode === "auto") continue;
      if (!size && mode === "jpeg" && img.jpeg) continue; // already JPEG: re-encoding would only lose quality
      const key = `${img.id}|${size ? `${size.width}x${size.height}` : "-"}|${mode}`;
      let ref = cache.get(key);
      if (!ref) {
        ref = size ? await resampled(img, size.width, size.height) : { ...img, id: uid("r"), jpeg: undefined };
        if (!ref.rgba && img.rgba) ref.rgba = img.rgba;
        const wantJpeg = mode === "jpeg" || (mode === "auto" && !!img.jpeg); // auto keeps photos (JPEG) as JPEG
        if (wantJpeg && ref.rgba && opaque(ref.rgba) && ref.source) ref.jpeg = await canvasToBytes(ref.source, "image/jpeg", mode === "jpeg" ? st.imageQuality / 100 : 0.9);
        else ref.jpeg = undefined;
        cache.set(key, ref);
      }
      pl.parent.items[pl.index] = replaceImage(pl.item, ref);
    }
  }
}

/** Copies the item tree down to the image items, so replacing images never touches shared display-list objects. */
function cloneTree(dl) {
  const walk = (items) => items.map((it) => (it.t === "group" && Array.isArray(it.items) ? { ...it, items: walk(it.items) } : it));
  return { ...dl, items: walk(dl.items) };
}

async function pdfFile(app, st, job, meta) {
  const doc = app.doc;
  const dpi = doc.dpi || 96;
  await ensureHyphenation();
  const pageObjs = job.pages.map((i) => doc.pages[i]);
  let lists = pdfPageLists(app, pageObjs, { rasterDpi: st.rasterDpi }).map(cloneTree);
  let groups = job.groups || pageObjs.map((_, k) => [job.pages[k]]);
  if (st.spreads) {
    const byIndex = new Map(job.pages.map((p, k) => [p, lists[k]]));
    groups = spreadGroups(job.pages, !!doc.settings?.facing);
    lists = groups.map((g) => combineSpread(g.map((p) => byIndex.get(p))));
  }
  const groupPages = groups.map((g) => doc.pages[g[0]]);
  const std = st.standard !== "none" ? st.standard : null;
  const cmyk = !!std || st.pdfColor === "cmyk" || doc.settings.color?.mode === "cmyk";
  if (st.downsample || st.imageCompression !== "auto") await optimizeImages(lists, st, dpi, cmyk);
  const bleedPx = st.bleed === "custom" ? (st.bleedMm / 25.4) * dpi : st.bleed === "document" ? undefined : 0;
  const fileName = `${job.name}.pdf`;
  const date = new Date();
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const pdf = {
    title: meta ? meta.title : "",
    author: meta?.author || undefined,
    subject: meta?.description || undefined,
    keywords: meta?.keywords.length ? meta.keywords : undefined,
    rights: meta?.rights || undefined,
    compress: st.compress,
    registrationMarks: st.registrationMarks,
    colorBars: st.colorBars,
    pageInfo: st.pageInfo && !std ? groups.map((g) => `${fileName}   ${g.length > 1 ? t("Pages {a}–{b}", { a: g[0] + 1, b: g[g.length - 1] + 1 }) : t("Page {n}", { n: g[0] + 1 })}   ${stamp}`) : undefined,
    pageLayout: st.pageLayout === "default" ? undefined : st.pageLayout,
    ...(st.embedFonts || std ? {} : { fontProvider: null }),
  };
  if (cmyk) {
    const r = await (await colorDoc()).printPdf(app, groupPages, { standard: std, bleed: st.bleed === "document", bleedPx, cropMarks: st.cropMarks, rasterDpi: st.rasterDpi, lists, pdf });
    return { bytes: r.bytes, preflight: r.preflight };
  }
  const bleed = bleedPx !== undefined ? bleedPx : Math.max(...groupPages.map((p) => p.bleed || 0));
  return { bytes: await writePdf(app, lists, { ...pdf, bleed, cropMarks: st.cropMarks }), preflight: null };
}

// ------------------------------------------------------------------ run

/**
 * Renders every file of an export.
 * @returns {Promise<{files:{name:string, bytes:Uint8Array, mime:string}[], warnings:string[], preflight:object|null, ext:string, mime:string}>}
 */
export async function renderExport(app, settings) {
  const doc = app.doc;
  if (!doc?.pages?.length) throw new Error(t("There is nothing to export."));
  await detectEncoders();
  const st = normalizeExportSettings(settings, exportEnv(app));
  const info = exportInfo(app);
  const plan = planExport(st, info);
  if (plan.warningKeys.length) throw new Error(plan.warningKeys.map(([k, p]) => t(k, p)).join(" "));
  const f = formatInfo(st.format);
  const meta = metaOf(app, st);
  const files = [];
  const warnings = [];
  let preflight = null;
  for (const job of plan.jobs) {
    const name = `${job.name}.${f.ext}`;
    if (f.kind === "pdf") {
      const r = await pdfFile(app, st, job, meta);
      preflight = r.preflight;
      files.push({ name, bytes: r.bytes, mime: f.mime });
    } else if (f.kind === "svg") {
      const r = svgFile(app, st, job, info, meta);
      warnings.push(...r.warnings);
      files.push({ name, bytes: r.bytes, mime: f.mime });
    } else if (f.kind === "psd") {
      const { exportPsd } = await import("./export-psd.js");
      const r = await exportPsd(app, doc.pages[job.page]);
      warnings.push(...r.warnings);
      files.push({ name, bytes: r.bytes, mime: f.mime });
    } else files.push({ name, bytes: await rasterFile(app, st, job, info, meta), mime: f.mime });
  }
  return { files, warnings: [...new Set(warnings)], preflight, ext: f.ext, mime: f.mime, label: f.id.toUpperCase() };
}

/**
 * Renders and saves an export. `settings.deliver(files)` replaces saving (Send by email). One run per document at a
 * time: a double click on Export or a repeated shortcut joins the running export instead of opening a second dialog.
 * @returns {Promise<{saved:string|null, files:number, bytes:number}>}
 */
export const runExport = singleFlight((app, settings) => runExportNow(app, settings), (app) => app.doc);

async function runExportNow(app, settings) {
  app.status?.(t("Exporting…"));
  try {
    const out = await renderExport(app, settings);
    if (out.warnings.length) app.toast(out.warnings.join(" "), "warning", 6000);
    if (settings.deliver) {
      await settings.deliver(out.files);
      return { saved: null, files: out.files.length, bytes: out.files.reduce((a, f) => a + f.bytes.length, 0) };
    }
    let r;
    let size;
    if (out.files.length === 1) {
      const file = out.files[0];
      size = file.bytes.length;
      r = await platform.saveFile({ suggestedName: file.name, bytes: file.bytes, mime: file.mime, filters: [{ name: out.label, extensions: [out.ext] }] });
      if (r) app.toast(t("Exported {name} ({size})", { name: r.name, size: formatBytes(size) }), "success");
    } else {
      const zip = {};
      for (const file of out.files) zip[file.name] = [file.bytes, { level: 0 }];
      const bytes = zipSync(zip);
      size = bytes.length;
      r = await platform.saveFile({ suggestedName: `${(app.doc.name || "Untitled").replace(/[\\/:*?"<>|]+/g, "_")}.zip`, bytes, mime: "application/zip", filters: [{ name: t("ZIP archive"), extensions: ["zip"] }] });
      if (r) app.toast(t("Exported {n} files to {name}", { n: out.files.length, name: r.name }), "success");
    }
    if (r && out.preflight?.issues.some((i) => i.severity !== "info")) (await import("../ui/color-settings.js")).showPreflightReport(out.preflight);
    return { saved: r ? r.name : null, files: out.files.length, bytes: size };
  } finally {
    app.status?.("");
  }
}
