// Loads PDFs through the vendored pdf.js (lazy: nothing is fetched until a PDF is opened) and turns pages into the
// DOM-free page IR of engine/formats/pdf-content.js. Works in the browser and in Node (tests).
import { interpretPage } from "../engine/formats/pdf-content.js";

let pdfjsPromise = null;

/** Lazily imports pdf.js and points it at the vendored worker, WebAssembly decoders and ICC profile. */
export function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const lib = await import("../../vendor/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
    return lib;
  })().catch((e) => {
    pdfjsPromise = null;
    throw new Error(`The PDF engine could not be loaded (${e.message}).`);
  });
  return pdfjsPromise;
}

const WASM_URL = () => new URL("../../vendor/pdfjs/wasm/", import.meta.url).href;
const ICC_URL = () => new URL("../../vendor/pdfjs/iccs/", import.meta.url).href;

export class PdfPasswordError extends Error {
  constructor(incorrect) {
    super(incorrect ? "That password is not correct." : "This PDF is password protected.");
    this.name = "PdfPasswordError";
    this.incorrect = !!incorrect;
  }
}

/**
 * Opens PDF bytes. Throws PdfPasswordError when a password is needed (call again with `password`).
 * @param {Uint8Array} bytes
 * @param {{password?: string}} [opt]
 */
export async function openPdf(bytes, { password } = {}) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: bytes.slice(), // pdf.js transfers the buffer to its worker
    password,
    isEvalSupported: false,
    useSystemFonts: typeof document !== "undefined", // page images use installed fonts for fonts that are not embedded
    fontExtraProperties: true,
    wasmUrl: WASM_URL(),
    iccUrl: ICC_URL(),
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    task.destroy?.();
    if (e && e.name === "PasswordException") throw new PdfPasswordError(e.code === 2);
    if (e && e.name === "InvalidPDFException") throw new Error("This file is not a valid PDF (or it is damaged beyond repair).");
    throw new Error(`The PDF could not be read: ${e?.message || e}`);
  }
  let permissions = null;
  try {
    permissions = await doc.getPermissions();
  } catch {
    /* ignore */
  }
  let metadata = {};
  try {
    metadata = (await doc.getMetadata())?.info || {};
  } catch {
    /* ignore */
  }
  let occ = null;
  try {
    occ = await doc.getOptionalContentConfig();
  } catch {
    /* ignore */
  }
  return { lib, doc, pages: doc.numPages, permissions, metadata, occ, encrypted: !!permissions, destroy: () => task.destroy?.() };
}

/** Sizes (px = pt, rotation applied) of the given pages. */
export async function pageSizes(src, which = null) {
  const out = [];
  for (let n = 1; n <= src.pages; n++) {
    if (which && !which.includes(n)) continue;
    const p = await src.doc.getPage(n);
    const v = p.getViewport({ scale: 1 });
    out.push({ n, w: v.width, h: v.height });
    p.cleanup?.();
  }
  return out;
}

/** "1-3, 5, 8-" -> [1,2,3,5,8,...]; empty = all pages. Returns null for invalid input. */
export function parsePageRange(text, total) {
  const t = String(text || "").trim();
  if (!t) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set();
  for (const part of t.split(/[,;]\s*/)) {
    const m = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(part.trim());
    if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) return null;
    const a = m[1] === "" ? 1 : parseInt(m[1], 10);
    const b = m[2] === undefined ? a : m[2] === "" ? total : parseInt(m[2], 10);
    if (a < 1 || b < a) return null;
    for (let i = a; i <= Math.min(b, total); i++) set.add(i);
  }
  return [...set].sort((x, y) => x - y);
}

/** 1bpp / RGB / RGBA pdf.js image data to RGBA. `mask`: stencil mask, painted bits become `color`. */
export function imageDataToRGBA(img, { mask = false, color = "#000000" } = {}) {
  const w = img.width;
  const h = img.height;
  const out = new Uint8ClampedArray(w * h * 4);
  const d = img.data;
  if (!d) return null;
  if (mask) {
    const r = parseInt(color.slice(1, 3), 16) || 0;
    const g = parseInt(color.slice(3, 5), 16) || 0;
    const b = parseInt(color.slice(5, 7), 16) || 0;
    const rowBytes = (w + 7) >> 3;
    const packed = d.length >= rowBytes * h && (img.kind === 1 || img.kind === undefined);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on;
        if (packed) on = !((d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1);
        else on = d[y * w + x] === 0;
        const o = (y * w + x) * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = on ? 255 : 0;
      }
    }
    return out;
  }
  if (img.kind === 1) {
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = (d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
        const o = (y * w + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
  } else if (img.kind === 2) {
    for (let i = 0, n = w * h; i < n; i++) {
      out[i * 4] = d[i * 3];
      out[i * 4 + 1] = d[i * 3 + 1];
      out[i * 4 + 2] = d[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  } else if (img.kind === 3) out.set(d.subarray ? d.subarray(0, w * h * 4) : d);
  else return null;
  return out;
}

function waitObj(objs, id, ms = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => !done && ((done = true), resolve(null)), ms);
    try {
      objs.get(id, (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v || null);
      });
    } catch {
      clearTimeout(t);
      resolve(null);
    }
  });
}

/**
 * Reads one page into the page IR.
 * @returns {Promise<{n:number, w:number, h:number, items:object[], warnings:Set<string>, fontUse:Map, stats:object, fonts:Map, images:Map, links:number, view:number[]}>}
 */
export async function readPage(src, n, { images = true, scale = 1 } = {}) {
  const { lib, doc } = src;
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const ol = await page.getOperatorList({ annotationMode: lib.AnnotationMode.ENABLE_STORAGE });
  const fonts = new Map();
  const getFont = (id) => {
    if (fonts.has(id)) return fonts.get(id);
    let f = null;
    try {
      f = page.commonObjs.get(id) || null;
    } catch {
      f = null;
    }
    fonts.set(id, f);
    return f;
  };
  const getPattern = (id) => {
    try {
      return page.objs.get(id);
    } catch {
      return null;
    }
  };
  const isVisible = src.occ
    ? (p) => {
        const g = typeof p === "string" ? { type: "OCG", id: p } : p;
        return src.occ.isVisible(g);
      }
    : null;
  const res = interpretPage(ol, { OPS: lib.OPS, viewTransform: vp.transform, page: { w: vp.width, h: vp.height }, getFont, getPattern, isVisible });
  const imgs = new Map();
  if (images) {
    for (const it of res.items) {
      if (it.k !== "image" || it.data || imgs.has(it.id)) continue;
      imgs.set(it.id, (await waitObj(page.objs, it.id)) || (await waitObj(page.commonObjs, it.id, 200)));
    }
  }
  let links = 0;
  try {
    for (const a of await page.getAnnotations()) if (a.subtype === "Link") links++;
  } catch {
    /* ignore */
  }
  return { n, w: vp.width, h: vp.height, ...res, fonts, images: imgs, links, view: vp.transform, page };
}
