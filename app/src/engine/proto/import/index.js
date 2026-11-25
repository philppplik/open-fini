// Entry point of the Proto importers (docs/concepts/proto-studio.md §10.4 and §11, task T8). Pure.
//
//   detectFormat(name, bytes) → "html" | "svg" | "sketch" | "penpot" | "image" | null
//   importInto(model, { name, bytes?, text?, from?, probe?, width?, random?, pages? }) → import result (common.js)
//   importImage(model, { bytes, mime?, name?, maxSize?, random? }) → import result: one image layer at its pixel size
//   applyImport(model, result, { page, parent?, at?: [x, y], flow? }) → the operations to apply (one batch), placed
//   designFromImport(result, { title }) → a new model with the import (`ofini proto import`)
//
// Formats: HTML (with CSS), SVG, Sketch (.sketch), Penpot exports (.penpot) and images (PNG, JPEG, GIF, WebP, AVIF).
// Figma `.fig` files are refused with the reason (concept §11: no public specification).
import { importHtml } from "./html.js";
import { importSvg } from "./svg.js";
import { importSketch } from "./sketch.js";
import { importPenpot } from "./penpot.js";
import { createBuilder, spec, ImportReport, ImportError, sniffImage, imageSize, offsetOps, intoParent, r2, cleanName, IMPORT_LIMITS } from "./common.js";
import { applyAll } from "../ops.js";
import { emptyDocument } from "../schema.js";

export { ImportError, IMPORT_LIMITS };
export const FORMATS = Object.freeze(["html", "svg", "sketch", "penpot", "image"]);
/** File extensions per format (file pickers, drag and drop, the CLI). */
export const EXTENSIONS = Object.freeze({ html: ["html", "htm", "xhtml"], svg: ["svg"], sketch: ["sketch"], penpot: ["penpot"], image: ["png", "jpg", "jpeg", "gif", "webp", "avif"] });

const decode = (bytes) => new TextDecoder().decode(bytes);

/** The format of a file from its name and first bytes. */
export function detectFormat(name = "", bytes = null) {
  const ext = String(name).toLowerCase().split(".").pop();
  if (ext === "fig") return "fig";
  for (const [f, exts] of Object.entries(EXTENSIONS)) if (exts.includes(ext)) return f;
  if (!bytes || !bytes.length) return null;
  const mime = sniffImage(bytes);
  if (mime === "image/svg+xml") return "svg";
  if (mime) return "image";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const head = decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    if (head.includes("manifest.json")) return "penpot";
    if (head.includes("document.json")) return "sketch";
    return null;
  }
  const text = decode(bytes.subarray(0, Math.min(bytes.length, 2048))).trimStart().toLowerCase();
  if (text.startsWith("<!doctype html") || text.startsWith("<html") || /^<(div|body|main|section|header|p|span|h[1-6]|style)\b/.test(text)) return "html";
  return null;
}

/**
 * Imports a file or text into `model` (nothing is applied: use applyImport for the operations).
 * @param {object} model
 * @param {{ name?: string, bytes?: Uint8Array, text?: string, from?: string, probe?: object, width?: number, random?: () => number, pages?: "new"|"current" }} o
 */
export function importInto(model, { name = "", bytes = null, text = null, from = null, probe = null, width = 1280, random, pages = "new" } = {}) {
  const fmt = from || detectFormat(name, bytes || (text != null ? new TextEncoder().encode(text.slice(0, 4096)) : null));
  if (fmt === "fig") throw new ImportError("Figma .fig files cannot be imported: the format has no public specification. In Figma, copy the frames as SVG, export them as SVG, or use Penpot's or Figma's own export.", "format");
  if (!fmt) throw new ImportError(`The format of “${name || "the input"}” is not recognized. Proto imports HTML, SVG, Sketch, Penpot exports and images.`, "format");
  const textOf = () => (text != null ? String(text) : decode(bytes));
  switch (fmt) {
    case "html":
      return importHtml(textOf(), { model, width, probe, name: name || "HTML", random });
    case "svg":
      return importSvg(textOf(), { model, name: name || "SVG", random });
    case "sketch":
      return importSketch(bytes, { model, name: name || "Sketch", random, pages });
    case "penpot":
      return importPenpot(bytes, { model, name: name || "Penpot", random, pages });
    case "image":
      return importImage(model, { bytes, name, random });
    default:
      throw new ImportError(`Unknown import format “${fmt}”.`, "format");
  }
}

/** One image layer at the picture's pixel size (scaled down to `maxSize` on its longer side). */
export function importImage(model, { bytes, mime = null, name = "Image", maxSize = 4096, random } = {}) {
  const report = new ImportReport("Image", name);
  const b = createBuilder(model, { random, report });
  const type = mime || sniffImage(bytes);
  const media = b.media({ bytes, mime: type, name });
  if (!media) throw new ImportError("This image type is not supported (PNG, JPEG, GIF, WebP, AVIF and SVG are).", "format");
  const size = imageSize(bytes, type) || { w: 200, h: 150 };
  const k = Math.min(1, maxSize / Math.max(size.w, size.h, 1));
  const w = r2(Math.max(1, size.w * k));
  const h = r2(Math.max(1, size.h * k));
  const t = spec(b, "image", { name: cleanName(String(name).replace(/\.[a-z0-9]+$/i, ""), "Image"), x: 0, y: 0, w: { mode: "fixed", value: w }, h: { mode: "fixed", value: h }, fills: [{ type: "image", media, fit: "fill" }], alt: "" });
  b.add(t, { page: null });
  report.kept("The image as an image layer.");
  return { ops: b.ops(), roots: [t.id], pages: [], report, size: { w, h } };
}

/**
 * The operations of an import, placed: top-level layers go to `page` (pages the import created keep theirs), are
 * moved so their top-left corner is at `at`, or go into `parent` (as flow children when `flow`).
 */
export function applyImport(result, { page, parent = null, at = null, flow = false } = {}) {
  let ops = result.ops.map((o) => (o.op === "node.create" && !o.parent && !o.page ? { ...o, page } : o));
  const onTarget = (o) => o.op === "node.create" && !o.parent && o.page === page;
  if (at && !(parent && flow)) {
    const top = ops.filter(onTarget);
    const x0 = Math.min(...top.map((o) => o.fields?.x ?? 0));
    const y0 = Math.min(...top.map((o) => o.fields?.y ?? 0));
    if (Number.isFinite(x0) && Number.isFinite(y0)) ops = ops.map((o) => (onTarget(o) ? offsetOps([o], at[0] - x0, at[1] - y0)[0] : o));
  }
  if (parent) ops = ops.map((o) => (onTarget(o) ? intoParent([o], parent, flow)[0] : o));
  return ops;
}

/**
 * A new design holding an import (`ofini proto import`). `model` is the empty design the import was made for
 * (emptyDocument), so the ids cannot collide; when the import made pages, the empty first page is removed.
 */
export function designFromImport(model, result) {
  const first = Object.keys(model.pages)[0];
  let out = applyAll(model, applyImport(result, { page: first })).model;
  if (result.pages.length && !Object.values(out.nodes).some((n) => n.page === first)) out = applyAll(out, [{ op: "page.delete", id: first }]).model;
  return out;
}

export { emptyDocument };
