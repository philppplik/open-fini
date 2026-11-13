// Projects in Node: reading and writing .ofini files, importing Office files and creating new projects with the app's
// own pure modules (docs/adr/0032-ofini-cli.md). What needs a browser (decoding pictures, rendering pixels, fonts) is
// replaced by placeholders that keep the original bytes, so a project read here and written back keeps every part.
import { strFromU8, strToU8 } from "../../app/vendor/fflate/fflate.js";
import { setTextMeasurer } from "../../app/src/core/fonts.js";
import { approxMeasurer } from "../../app/src/engine/layout/measurers.js";
import { Doc } from "../../app/src/core/doc.js";
import { WebProject, attachWeb, ensureWeb } from "../../app/src/core/web.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { walk } from "../../app/src/core/nodes.js";
import { migrateDocumentJson } from "../../app/src/core/ofini-migrate.js";
import { readZipStrict, writeOfiniZip, DOCTOR_LIMITS, looksLikeZip } from "../../app/src/core/doctor/zip.js";
import { pngSize } from "../../app/src/core/doctor/file.js";
import "../../app/src/office/index.js";
import { officeApp, officeApps, appForFile, loadOfficeApp } from "../../app/src/office/apps.js";

// Text layout in Node measures with the AFM widths of the PDF base-14 fonts (engine/layout/measurers.js).
setTextMeasurer(approxMeasurer);

export class CliError extends Error {
  /** @param {string} message @param {number} code exit code (docs/cli.md ▸ Exit codes) */
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const EXIT = Object.freeze({ OK: 0, PROBLEMS: 1, USAGE: 2, IO: 3, UNSUPPORTED: 4, INTERNAL: 5, INTERRUPTED: 130 });

const ASSET_EXT = { "application/vnd.iccprofile": "icc", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg" };
const PX = 96 / 72;

/** Kinds `ofini new` creates, in help order. */
export const NEW_KINDS = ["vector", "pixel", "layout", "code", "document", "sheet", "slides", "board", "scene"];
export const DESIGN_STUDIOS = new Set(["vector", "pixel", "layout"]);

/** The kind of an open project: "document"|"sheet"|"slides"|"board"|"scene" (Office kinds), "website", or "design". */
export function projectKind(doc) {
  if (doc.office) return doc.office.kind;
  if (doc.web) return "website";
  return "design";
}

/**
 * Reads .ofini bytes into a Doc. Pictures and pixel layers become placeholders that carry their original bytes.
 * @returns {{ doc: Doc, entries: Record<string, Uint8Array>, notes: string[], newer: boolean }}
 */
export function readOfini(bytes, name = "document.ofini") {
  if (!looksLikeZip(bytes)) throw new CliError(`${name} is not an OpenFini document (not a ZIP container). Run “ofini doctor ${name}” for details.`, EXIT.PROBLEMS);
  const z = readZipStrict(bytes, DOCTOR_LIMITS);
  if (z.overLimit) throw new CliError(`${name} unpacks to more than OpenFini opens (2 GiB, 100,000 parts).`, EXIT.PROBLEMS);
  if (!z.ok) throw new CliError(`${name} is damaged (${z.error}). Try “ofini doctor --fix ${name}”.`, EXIT.PROBLEMS);
  const entries = z.entries;
  if (!entries["document.json"]) throw new CliError(`${name} has no document content (document.json). Try “ofini doctor ${name}”.`, EXIT.PROBLEMS);
  let json;
  try {
    json = JSON.parse(strFromU8(entries["document.json"]));
  } catch {
    throw new CliError(`The document content of ${name} is damaged. Try “ofini doctor --fix ${name}”.`, EXIT.PROBLEMS);
  }
  let mig;
  try {
    mig = migrateDocumentJson(json);
  } catch (e) {
    throw new CliError(`${name}: ${e.message}`, EXIT.PROBLEMS);
  }
  const doc = Doc.fromJSON(mig.json);
  for (const a of Object.values(doc.assets)) {
    const key = Object.keys(entries).find((k) => k.startsWith(`assets/${a.id}.`));
    if (!key) continue;
    a.bytes = entries[key];
    if (a.mime?.startsWith("image/")) a._bitmap = { width: a.w || 1, height: a.h || 1, _bytes: a.bytes, _mime: a.mime };
  }
  const pixel = (n) => {
    const png = entries[`pixels/${n.id}.png`];
    if (!png) return;
    const size = pngSize(png) || { width: Math.max(1, Math.round(n.w || 1)), height: Math.max(1, Math.round(n.h || 1)) };
    doc.pixels.set(n.id, { ...size, _bytes: png, _mime: "image/png" });
  };
  doc.walkAll((n) => {
    if (n.type === "pixel") pixel(n);
    if (n.mask) walk(n.mask, (m) => m.type === "pixel" && pixel(m));
  }, { masters: true });
  if (mig.json.web) {
    doc.web = WebProject.fromManifest(mig.json.web, (path) => entries[`web/files/${path}`]);
    attachWeb(doc);
    const git = new Map();
    for (const [k, b] of Object.entries(entries)) if (k.startsWith("web/git/")) git.set(k.slice(8), b);
    if (git.has("HEAD")) doc.web.gitFiles = git;
  }
  if (mig.json.office && typeof mig.json.office === "object") doc.office = OfficeProject.fromManifest(mig.json.office, entries);
  return { doc, entries, notes: mig.notes, newer: mig.newer };
}

/** Normalizes the Office model of a project the way its app does when it opens it. */
export async function officeModel(doc) {
  const prj = doc.office;
  if (!prj) return null;
  if (prj.kind === "scene") return prj.model;
  const mod = await import(`../../app/src/office/${prj.kind}/app.js`).catch(() => null);
  const ensure = mod?.ensureModel || mod?.ensureDeck || mod?.ensureBoard;
  if (ensure) ensure(prj);
  return prj.model;
}

/**
 * Writes a Doc as .ofini bytes (same layout as core/ofini.js ▸ saveOfini). Pixel layers and the preview image come
 * from the original file (`entries`); nothing is rendered in Node, so a new project has no preview until the app saves it.
 */
export function writeOfini(doc, entries = {}) {
  const files = {};
  files["document.json"] = strToU8(JSON.stringify(doc.toJSON()));
  for (const a of Object.values(doc.assets)) if (a.bytes) files[`assets/${a.id}.${ASSET_EXT[a.mime] || "bin"}`] = a.bytes;
  const seen = new Set();
  const pix = (n) => {
    if (n.type !== "pixel" || seen.has(n.id)) return;
    seen.add(n.id);
    const p = doc.pixels.get(n.id);
    const b = p?._bytes || entries[`pixels/${n.id}.png`];
    if (b) files[`pixels/${n.id}.png`] = b;
  };
  doc.walkAll((n) => {
    pix(n);
    if (n.mask) walk(n.mask, pix);
  }, { masters: true });
  if (doc.web) for (const [k, b] of Object.entries(doc.web.entries())) files[k] = b;
  if (doc.web?.gitFiles) for (const [k, b] of Object.entries(doc.web.gitEntries())) files[k] = b;
  if (doc.office) for (const [k, b] of Object.entries(doc.office.entries())) files[k] = b;
  if (entries["thumbnail.png"]) files["thumbnail.png"] = entries["thumbnail.png"];
  return writeOfiniZip(files);
}

/** Office file extensions the CLI imports (from the Office apps' manifests: formats they read). */
export function importableExtensions() {
  const out = [];
  for (const m of officeApps()) for (const f of m.formats) if (f.read && !f.template) out.push(...f.ext.map((e) => [e, m.kind, f.label]));
  return out;
}

/**
 * Opens any supported input: .ofini, or an Office file (DOCX, ODT, RTF, HTML, Markdown, text, XLSX, ODS, CSV, PPTX,
 * ODP, Excalidraw, tldraw) through the Office app that reads it.
 */
export async function openInput(bytes, name) {
  if (/\.ofini$/i.test(name) || (looksLikeZip(bytes) && !appForFile(name) && hasDocumentJson(bytes))) return { ...readOfini(bytes, name), imported: null };
  const hit = appForFile(name);
  if (!hit) throw new CliError(`${name}: this file type cannot be opened by the command line tool (supported: .ofini and ${[...new Set(importableExtensions().map((e) => `.${e[0]}`))].join(", ")}).`, EXIT.UNSUPPORTED);
  const impl = await loadOfficeApp(hit.app.kind);
  let res;
  try {
    res = await impl.open(bytes, name, {});
  } catch (e) {
    throw new CliError(`${name}: ${e.message}`, EXIT.PROBLEMS);
  }
  const model = res.model || res;
  const title = name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return { doc: wrapOffice(model, hit.app.kind, title), entries: {}, notes: [], newer: false, imported: hit.format?.label || hit.app.label };
}

function hasDocumentJson(bytes) {
  const z = readZipStrict(bytes, DOCTOR_LIMITS);
  return !!z.entries?.["document.json"];
}

function wrapOffice(model, kind, name) {
  const page = model?.page;
  const w = page?.width ? Math.round(page.width * PX) : model?.width || 1280;
  const h = page?.height ? Math.round(page.height * PX) : model?.height || 720;
  const doc = new Doc({ name, studio: kind === "scene" ? "scene" : "office", width: w, height: h, pages: 1 });
  doc.office = new OfficeProject(model, kind);
  return doc;
}

const PRESETS = {
  "full-hd": [1920, 1080, "px", 96], hd: [1280, 720, "px", 96], "4k": [3840, 2160, "px", 96], mobile: [390, 844, "px", 96], tablet: [1024, 768, "px", 96],
  a3: [297, 420, "mm", 300], a4: [210, 297, "mm", 300], a5: [148, 210, "mm", 300], letter: [8.5, 11, "in", 300], legal: [8.5, 14, "in", 300], tabloid: [11, 17, "in", 300],
  "business-card": [3.5, 2, "in", 300], postcard: [6, 4, "in", 300], square: [1080, 1080, "px", 72], story: [1080, 1920, "px", 72], "open-graph": [1200, 630, "px", 72], icon: [1024, 1024, "px", 72],
};
export const SIZE_PRESETS = Object.keys(PRESETS);

const toPx = (v, unit, dpi) => (unit === "mm" ? (v / 25.4) * dpi : unit === "in" ? v * dpi : unit === "pt" ? (v / 72) * dpi : v);

/** Parses --size: a preset name ("a4") or "W×H[unit]" ("1920x1080", "210x297mm", "8.5x11in"). */
export function parseSize(spec, studio) {
  const def = studio === "layout" ? "a4" : studio === "pixel" ? "full-hd" : "full-hd";
  const s = String(spec || def).toLowerCase().replace(/\s+/g, "");
  if (PRESETS[s]) {
    const [w, h, unit, dpi] = PRESETS[s];
    return { width: Math.round(toPx(w, unit, dpi)), height: Math.round(toPx(h, unit, dpi)), unit, dpi };
  }
  const m = /^(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)(px|mm|in|pt)?$/.exec(s);
  if (!m) throw new CliError(`Invalid size “${spec}”. Use a preset (${SIZE_PRESETS.join(", ")}) or WIDTHxHEIGHT with px, mm, in or pt.`, EXIT.USAGE);
  const unit = m[3] || "px";
  const dpi = unit === "px" ? 96 : 300;
  const width = Math.round(toPx(Number(m[1]), unit, dpi));
  const height = Math.round(toPx(Number(m[2]), unit, dpi));
  if (!(width > 0 && height > 0 && width <= 100000 && height <= 100000)) throw new CliError(`The size “${spec}” is out of range (1 to 100,000 pixels per side).`, EXIT.USAGE);
  return { width, height, unit, dpi };
}

/** Templates per kind: [{ id, label }]. */
export async function templatesFor(kind) {
  if (DESIGN_STUDIOS.has(kind)) return [{ id: "blank", label: "Blank" }];
  if (kind === "code") {
    const [{ TEMPLATES }, { STARTERS }] = await Promise.all([import("../../app/src/engine/web/templates.js"), import("../../app/src/engine/web/starters.js")]);
    return [...TEMPLATES.map((t) => ({ id: t.id, label: t.name })), ...STARTERS.filter((s) => !TEMPLATES.some((t) => t.id === s.id)).map((s) => ({ id: s.id, label: s.name }))];
  }
  if (kind === "scene") return (await import("../../app/src/scene/model.js")).TEMPLATES.map((t) => ({ id: t.id, label: t.label }));
  const m = officeApp(kind);
  if (!m) throw new CliError(`Unknown kind “${kind}”. Kinds: ${NEW_KINDS.join(", ")}.`, EXIT.USAGE);
  return (m.templates || []).map((t) => ({ id: t.id, label: t.label }));
}

/** Creates a new project of a kind (`ofini new`). */
export async function createProject(kind, { template = "blank", title = "", size = null, pages = 1 } = {}) {
  if (!NEW_KINDS.includes(kind)) throw new CliError(`Unknown kind “${kind}”. Kinds: ${NEW_KINDS.join(", ")}.`, EXIT.USAGE);
  const list = await templatesFor(kind);
  if (!list.some((t) => t.id === template)) throw new CliError(`Unknown template “${template}” for ${kind}. Templates: ${list.map((t) => t.id).join(", ")}.`, EXIT.USAGE);
  const n = Math.max(1, Math.min(1000, Number(pages) || 1));
  if (DESIGN_STUDIOS.has(kind)) {
    const sz = parseSize(size, kind);
    const doc = new Doc({ name: title || "Untitled", width: sz.width, height: sz.height, dpi: sz.dpi, unit: sz.unit, studio: kind, pages: n });
    if (kind === "layout") {
      const m = Math.round(toPx(12, "mm", sz.dpi));
      for (const p of doc.pages) p.margins = { top: m, right: m, bottom: m, left: m };
    }
    return doc;
  }
  if (kind === "code") {
    const { getTemplate } = await import("../../app/src/engine/web/templates.js");
    let t = getTemplate(template);
    if (!t) t = await (await import("../../app/src/engine/web/starters.js")).loadStarter(template);
    if (!t?.files) throw new CliError(`The template “${template}” is not available.`, EXIT.UNSUPPORTED);
    const doc = new Doc({ name: title || t.name, width: 1280, height: 800, studio: "code" });
    ensureWeb(doc, { ...t.files });
    return doc;
  }
  if (kind === "scene") {
    const { templateScene } = await import("../../app/src/scene/model.js");
    const model = templateScene(template, { title });
    return wrapOffice(model, "scene", title || "Untitled scene");
  }
  const impl = await loadOfficeApp(kind);
  const label = officeApp(kind).label.toLowerCase();
  const name = title || (template !== "blank" ? list.find((t) => t.id === template).label : `Untitled ${label}`);
  const model = await impl.create({ template, title: name });
  return wrapOffice(model, kind, name);
}
