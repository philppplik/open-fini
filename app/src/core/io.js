// Image/SVG import and raster/SVG/PDF export.
import { createNode } from "./nodes.js";
import { Doc, createCanvas, ctx2d } from "./doc.js";
import { translate, scale as scaleM, mul } from "./math.js";
import { uid } from "./util.js";
import { dlState, buildPageDL } from "../engine/dl.js";
import { renderToCanvas, itemBounds, dlHasAdjust, CanvasPool } from "../engine/backends/canvas.js";
import { displayListToSVGResult } from "../engine/backends/svg.js";
import { importSVG } from "../engine/vector/svg-import.js";
import { addNodes } from "./ops.js";
import { addImportedText } from "./text-ops.js";
import { canvasToBytes } from "./ofini.js";
import { ImportReport, attachReport } from "./import-report.js";

import { TEXT_DOC_EXTS } from "./text-docs.js";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
export const MORE_IMAGE_EXTS = ["tif", "tiff", "ora", "kra", "ico", "cur"];
export const PALETTE_EXTS = ["gpl", "ase", "aco"];
/** Word processor files the Office Studio opens (plus the files it explains: Google Docs shortcuts, .doc, .pages). */
export const OFFICE_DOC_EXTS = ["docx", "odt", "rtf", "dotx", "ott", "fodt", "doc", "pages", "gdoc"];
/** Spreadsheets, presentations, whiteboards and their cloud shortcuts (opened by the Office Suite registry). */
export const OFFICE_SUITE_EXTS = ["xlsx", "xlsm", "xltx", "ods", "ots", "csv", "tsv", "pptx", "potx", "odp", "otp", "excalidraw", "tldraw", "gsheet", "gslides"];
export const OPEN_FILTERS = [
  { name: "All supported files", extensions: ["ofini", "pdf", "ai", "psd", "psb", "idml", "sketch", "svg", ...IMAGE_EXTS, ...MORE_IMAGE_EXTS, ...PALETTE_EXTS, ...TEXT_DOC_EXTS, ...OFFICE_DOC_EXTS, ...OFFICE_SUITE_EXTS] },
  { name: "Word and text documents (DOCX, ODT, RTF)", extensions: OFFICE_DOC_EXTS },
  { name: "Spreadsheets, presentations, whiteboards", extensions: OFFICE_SUITE_EXTS },
  { name: "Text and code (Markdown, LaTeX, JSON, YAML, …)", extensions: TEXT_DOC_EXTS },
  { name: "OpenFini documents", extensions: ["ofini"] },
  { name: "Photoshop (PSD, PSB)", extensions: ["psd", "psb"] },
  { name: "InDesign (IDML)", extensions: ["idml"] },
  { name: "PDF and Illustrator (PDF, AI)", extensions: ["pdf", "ai"] },
  { name: "Sketch", extensions: ["sketch"] },
  { name: "Images", extensions: IMAGE_EXTS },
  { name: "TIFF, OpenRaster, Krita, ICO", extensions: MORE_IMAGE_EXTS },
  { name: "Color palettes (GPL, ASE, ACO)", extensions: PALETTE_EXTS },
  { name: "SVG graphics", extensions: ["svg"] },
];
export const PLACE_FILTERS = [{ name: "Images and SVG", extensions: ["svg", ...IMAGE_EXTS] }];

export function sniffMime(bytes, name = "") {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && /avif|avis/.test(String.fromCharCode(b[8], b[9], b[10], b[11]))) return "image/avif";
  if (b[0] === 0x50 && b[1] === 0x4b) return "application/vnd.openfini+zip";
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || /\.svg$/i.test(name)) return "image/svg+xml";
  return "application/octet-stream";
}

export async function decodeBitmap(bytes, mime) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  return bmp;
}

// ------------------------------------------------------------------ import

/** Registers raw image bytes as a document asset (inside the current transaction if any). */
export async function makeAsset(doc, { name, bytes, mime }) {
  const bmp = await decodeBitmap(bytes, mime);
  const id = doc.addAsset({ name, mime, w: bmp.width, h: bmp.height, bytes, _bitmap: bmp });
  dlState.version++;
  return { id, w: bmp.width, h: bmp.height, bitmap: bmp };
}

/** Keeps a placed object comfortably inside the page. */
function fitInto(page, w, h, max = 0.9) {
  const s = Math.min(1, (page.w * max) / w, (page.h * max) / h);
  return s;
}

export async function placeFile(app, file, { x, y } = {}) {
  const doc = app.doc;
  const page = app.page;
  const mime = sniffMime(file.bytes, file.name);
  if (mime === "image/svg+xml") return placeSvg(app, new TextDecoder().decode(file.bytes), file.name, { x, y });
  if (!mime.startsWith("image/")) throw new Error(`“${file.name}” is not an image or SVG file.`);
  const base = file.name.replace(/\.[^.]+$/, "");
  if (app.studio === "pixel") {
    const bmp = await decodeBitmap(file.bytes, mime);
    const node = createNode("pixel", { name: base, w: bmp.width, h: bmp.height });
    const canvas = createCanvas(bmp.width, bmp.height);
    ctx2d(canvas).drawImage(bmp, 0, 0);
    bmp.close?.();
    doc.pixels.set(node.id, canvas);
    const s = fitInto(page, node.w, node.h);
    const cx = x ?? page.w / 2;
    const cy = y ?? page.h / 2;
    node.m = mul(translate(cx - (node.w * s) / 2, cy - (node.h * s) / 2), scaleM(s, s));
    addNodes(app, node, { label: "Place Image" });
    return node;
  }
  let node;
  const asset = await makeAsset(doc, { name: file.name, bytes: file.bytes, mime });
  // an image frame selected (or under the drop point) takes the picture, cropped to fill the frame
  const frame = app.selection.length === 1 && app.selection[0].imageFrame ? app.selection[0] : null;
  if (frame) {
    const k = Math.max(frame.w / asset.w, frame.h / asset.h);
    const iw = asset.w * k;
    const ih = asset.h * k;
    node = createNode("image", { name: base, assetId: asset.id, w: iw, h: ih, m: translate((frame.w - iw) / 2, (frame.h - ih) / 2) });
    doc.tx("Place Image in Frame", () => {
      for (const old of [...(frame.children || [])]) if (old.type === "image") doc.remove(old);
      doc.insert(node, frame, 0);
      if (frame.fill) doc.set(frame, { fill: null });
    });
    app.select([frame]);
    return node;
  }
  const s = fitInto(page, asset.w, asset.h);
  const w = asset.w * s;
  const h = asset.h * s;
  node = createNode("image", { name: base, assetId: asset.id, w, h, m: translate((x ?? page.w / 2) - w / 2, (y ?? page.h / 2) - h / 2) });
  addNodes(app, node, { label: "Place Image" });
  return node;
}

/** Imports SVG markup into the active document as an editable group. */
export function placeSvg(app, text, name = "SVG", { x, y, asNewDoc = false } = {}) {
  const res = importSVG(text, { name: name.replace(/\.svg$/i, "") });
  let doc = app.doc;
  let target = app.context;
  let page = app.page;
  if (asNewDoc || !doc) {
    doc = new Doc({ name: res.root.name, width: Math.max(1, Math.round(res.width)), height: Math.max(1, Math.round(res.height)), studio: "vector" });
    app.openDoc(doc);
    target = doc.pages[0].root;
    page = doc.pages[0];
  }
  const group = res.root;
  doc.tx("Place SVG", () => {
    for (const t of res.texts) addImportedText(doc, t, t._svgText);
    doc.insert(group, target, target.children.length);
  });
  // embedded raster images decode asynchronously
  (async () => {
    for (const n of res.pendingImages) {
      try {
        const resp = await fetch(n._dataUrl);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const mime = sniffMime(bytes);
        const a = await makeAsset(doc, { name: "Embedded image", bytes, mime });
        n.assetId = a.id;
        delete n._dataUrl;
        doc.touch(n);
        app.requestRender();
      } catch {
        /* ignore undecodable embedded image */
      }
    }
  })();
  if (!asNewDoc && doc === app.doc) {
    const s = fitInto(page, res.width, res.height);
    const w = res.width * s;
    const h = res.height * s;
    const cx = x ?? page.w / 2;
    const cy = y ?? page.h / 2;
    group.m = mul(translate(cx - w / 2, cy - h / 2), mul(scaleM(s, s), group.m));
    doc.touch(group);
  }
  app.select([group]);
  if (asNewDoc) {
    const report = new ImportReport("SVG", name).kept("Shapes, paths, text and gradients as editable objects.");
    for (const w of res.warnings) report.dropped(w);
    attachReport(doc, report);
  }
  if (res.warnings.length) app.toast(`SVG imported with notes: ${res.warnings.join(" ")} File ▸ Import Report… lists them.`, "warning", 6000);
  return group;
}

/** Opens an image file as a new Pixel-studio document. */
export async function openImageAsDocument(app, file) {
  const mime = sniffMime(file.bytes, file.name);
  const bmp = await decodeBitmap(file.bytes, mime);
  const name = file.name.replace(/\.[^.]+$/, "");
  const doc = new Doc({ name, width: bmp.width, height: bmp.height, dpi: 72, studio: "pixel", bg: null });
  const node = createNode("pixel", { name: "Background", w: bmp.width, h: bmp.height });
  const canvas = createCanvas(bmp.width, bmp.height);
  ctx2d(canvas).drawImage(bmp, 0, 0);
  bmp.close?.();
  doc.pixels.set(node.id, canvas);
  doc.pages[0].root.children.push(node);
  doc.relink();
  doc.history.clear();
  doc.saved = true;
  app.setStudio("pixel");
  app.openDoc(doc);
  requestAnimationFrame(() => app.cv?.fitPage());
  return doc;
}

// ------------------------------------------------------------------ export

export const RASTER_FORMATS = {
  png: { mime: "image/png", ext: "png", label: "PNG", alpha: true },
  jpeg: { mime: "image/jpeg", ext: "jpg", label: "JPEG", alpha: false },
  webp: { mime: "image/webp", ext: "webp", label: "WebP", alpha: true },
};

const MAX_SIDE = 16384;
const MAX_PIXELS = 140e6;

/**
 * Renders a page (or part of it) to a raster image.
 * @param {{page?:object, format?:string, scale?:number, quality?:number, background?:string|null, area?:{x,y,w,h}, width?:number, height?:number}} o
 */
export async function exportRaster(app, o = {}) {
  const doc = app.doc;
  const page = o.page || app.page;
  const fmt = RASTER_FORMATS[o.format || "png"];
  const area = o.area || { x: 0, y: 0, w: page.w, h: page.h };
  const scale = o.scale ?? 1;
  const w = Math.max(1, Math.round(o.width ?? area.w * scale));
  const h = Math.max(1, Math.round(o.height ?? area.h * scale));
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) throw new Error(`The export would be ${w} × ${h} px — too large. Use a smaller scale.`);
  let bg = o.background === undefined ? page.bg : o.background;
  if (!fmt.alpha && !bg) bg = "#ffffff";
  const dl = buildPageDL(doc, page);
  const canvas = renderToCanvas(dl, { crop: area, width: w, height: h, bg, pool: new CanvasPool({ cpu: true }) });
  const bytes = await canvasToBytes(canvas, fmt.mime, o.quality ?? 0.92);
  return { bytes, mime: fmt.mime, ext: fmt.ext, width: w, height: h, canvas };
}

function ensureRgba(ref) {
  if (ref.rgba || !ref.source) return;
  const c = createCanvas(ref.width, ref.height);
  const ctx = ctx2d(c);
  ctx.drawImage(ref.source, 0, 0);
  ref.rgba = ctx.getImageData(0, 0, ref.width, ref.height).data;
}

function groupHasUnsupported(g) {
  if (g.fx || g.mask) return true;
  for (const it of g.items) {
    if (it.t === "adjust") return true;
    if (it.t === "group" && groupHasUnsupported(it)) return true;
  }
  return false;
}

/**
 * Prepares a page display list for vector backends (SVG/PDF): groups with live effects, masks or
 * adjustments are rasterized at `rasterScale`; pixel data is made available as RGBA.
 */
export function prepareVectorDL(dl, { rasterScale = 2 } = {}) {
  if (dlHasAdjust(dl.items)) {
    const c = renderToCanvas(dl, { scale: rasterScale, bg: null });
    const ref = { id: uid("r"), width: c.width, height: c.height, source: c, flat: true };
    ensureRgba(ref);
    return { width: dl.width, height: dl.height, items: [{ t: "image", img: ref, m: [1 / rasterScale, 0, 0, 1 / rasterScale, 0, 0], smooth: true }] };
  }
  const walk = (items) =>
    items.map((it) => {
      if (it.t === "group") {
        if (groupHasUnsupported(it)) {
          const b = itemBounds(it);
          if (!b || b.w < 0.5 || b.h < 0.5) return null;
          const w = Math.min(MAX_SIDE, Math.ceil(b.w * rasterScale));
          const h = Math.min(MAX_SIDE, Math.ceil(b.h * rasterScale));
          const c = renderToCanvas({ width: dl.width, height: dl.height, items: [it] }, { crop: b, width: w, height: h, bg: null });
          const ref = { id: uid("r"), width: w, height: h, source: c, flat: true };
          ensureRgba(ref);
          return { t: "image", img: ref, m: [b.w / w, 0, 0, b.h / h, b.x, b.y], smooth: true };
        }
        return { ...it, _p2d: undefined, _bb: undefined, _ib: undefined, items: walk(it.items).filter(Boolean) };
      }
      if (it.t === "image") {
        ensureRgba(it.img);
        return it;
      }
      return it;
    });
  return { width: dl.width, height: dl.height, items: walk(dl.items).filter(Boolean) };
}

const imageDataUrlCache = new WeakMap();
function encodeImage(ref) {
  if (imageDataUrlCache.has(ref)) return imageDataUrlCache.get(ref);
  let url = null;
  if (ref.source) {
    const c = createCanvas(ref.width, ref.height);
    ctx2d(c).drawImage(ref.source, 0, 0);
    url = c.toDataURL ? c.toDataURL("image/png") : null;
  }
  imageDataUrlCache.set(ref, url);
  return url;
}

export function exportSvg(app, page = app.page, { background = true } = {}) {
  const dl = prepareVectorDL(buildPageDL(app.doc, page), { rasterScale: 2 });
  return displayListToSVGResult(dl, { background: background ? page.bg : null, encodeImage, title: app.doc.name });
}

/** Display lists of pages prepared for PDF (effects flattened, page color painted behind content). */
export function pdfPageLists(app, pages, { rasterDpi = 200 } = {}) {
  const doc = app.doc;
  const rasterScale = Math.max(1, rasterDpi / doc.dpi);
  return pages.map((p) => {
    const dl = prepareVectorDL(buildPageDL(doc, p), { rasterScale });
    if (p.bg) dl.items.unshift({ t: "path", d: [["M", 0, 0], ["L", p.w, 0], ["L", p.w, p.h], ["L", 0, p.h], ["Z"]], rule: "nonzero", fill: { type: "solid", color: p.bg.slice(0, 7), alpha: 1 }, stroke: null, m: [1, 0, 0, 1, 0, 0], pageBg: true });
    return dl;
  });
}

/** Rasterizes a whole display list into one opaque image item (PDF/X-1a transparency flattening). */
export function rasterizeList(dl, scale, bg = "#ffffff") {
  const w = Math.min(MAX_SIDE, Math.ceil(dl.width * scale));
  const h = Math.min(MAX_SIDE, Math.ceil(dl.height * scale));
  const c = renderToCanvas(dl, { crop: { x: 0, y: 0, w: dl.width, h: dl.height }, width: w, height: h, bg, pool: new CanvasPool({ cpu: true }) });
  const ref = { id: uid("r"), width: w, height: h, source: c, flat: true };
  ensureRgba(ref);
  return { width: dl.width, height: dl.height, items: [{ t: "image", img: ref, m: [dl.width / w, 0, 0, dl.height / h, 0, 0], smooth: true }] };
}

/** Writes PDF bytes from prepared page display lists (`extra`: color, pdfx and report options of createPDF). */
export async function writePdf(app, lists, { bleed = 0, cropMarks = false, ...extra } = {}) {
  const { createPDF } = await import("../engine/backends/pdf.js");
  return createPDF(lists, {
    pxPerInch: app.doc.dpi,
    title: app.doc.name,
    creator: "OpenFini",
    producer: "OpenFini",
    bleed,
    cropMarks,
    fontProvider: (font) => app.fontBytes?.(font) || null,
    ...extra,
  });
}

export async function exportPdf(app, pages = app.doc.pages, { bleed = false, cropMarks = false, rasterDpi = 200 } = {}) {
  const lists = pdfPageLists(app, pages, { rasterDpi });
  return writePdf(app, lists, { bleed: bleed ? Math.max(...pages.map((p) => p.bleed || 0)) : 0, cropMarks });
}
