// Opens layered / multi-frame raster formats as Pixel documents and handles color palette files.
//   TIFF (pages -> layers), animated GIF (frames -> layers), OpenRaster (.ora, layers, groups, blend modes),
//   ICO / CUR (largest image), and GPL / ASE / ACO palettes (-> document swatches).
// The decoders are pure engines in engine/formats (loaded lazily); this module only builds documents from their output.
// Public API: openTiff, openGif, openOra, openIco, importPaletteFile, addSwatches, exportPaletteText, exportOraFile.
import { Doc, createCanvas, ctx2d } from "./doc.js";
import { createNode } from "./nodes.js";
import { translate } from "./math.js";
import { dlState } from "../engine/dl.js";
import { ImportReport, attachReport } from "./import-report.js";
import { announceImport } from "./open-foreign.js";

const baseName = (n) => String(n || "Untitled").replace(/\.[^.]+$/, "");
const MAX_SWATCHES = 512;

function rgbaCanvas(rgba, w, h) {
  const c = createCanvas(w, h);
  ctx2d(c).putImageData(new ImageData(rgba, w, h), 0, 0);
  return c;
}

async function pngCanvas(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const c = createCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

function present(app, doc, report, what) {
  doc.relink();
  doc.history.clear();
  doc.saved = true;
  dlState.version++;
  attachReport(doc, report);
  app.setStudio("pixel");
  app.openDoc(doc);
  requestAnimationFrame(() => app.cv?.fitPage());
  announceImport(app, doc, report, what);
  return doc;
}

const pixelLayer = (doc, canvas, props) => {
  const node = createNode("pixel", { w: canvas.width, h: canvas.height, ...props });
  doc.pixels.set(node.id, canvas);
  return node;
};

/** Stacks frames / pages as layers: the first is visible, the others hidden (a Pixel document has no timeline). */
function stackLayers(doc, items) {
  const root = doc.pages[0].root;
  items.forEach((it, i) => root.children.push(pixelLayer(doc, it.canvas, { name: it.name, visible: i === 0, m: translate(0, 0) })));
}

export async function openTiff(app, file, { format = "TIFF", note = "" } = {}) {
  const { readTiff } = await import("../engine/formats/tiff.js");
  const tiff = readTiff(file.bytes);
  const report = new ImportReport(format, file.name);
  const w = Math.max(...tiff.pages.map((p) => p.width));
  const h = Math.max(...tiff.pages.map((p) => p.height));
  const doc = new Doc({ name: baseName(file.name), width: w, height: h, dpi: 72, studio: "pixel", bg: null });
  stackLayers(doc, tiff.pages.map((p) => ({ name: p.name, canvas: rgbaCanvas(p.rgba, p.width, p.height) })));
  report.kept(`${tiff.pages.length} page${tiff.pages.length === 1 ? "" : "s"} as pixel layer${tiff.pages.length === 1 ? "" : "s"}${tiff.pages.length > 1 ? " (only the first is visible)" : ""}.`);
  report.note("The resolution (DPI) and embedded color profile of the TIFF are not applied.");
  if (note) report.flattened(note);
  report.warnings(tiff.warnings);
  return present(app, doc, report, `“${file.name}”`);
}

/** Opens a GIF with its frames as layers. Returns undefined for a still GIF (the caller then opens it as a normal image). */
export async function openGif(app, file) {
  const { readGif } = await import("../engine/formats/gif.js");
  const gif = readGif(file.bytes);
  if (gif.frames.length < 2) return undefined;
  const report = new ImportReport("Animated GIF", file.name);
  const doc = new Doc({ name: baseName(file.name), width: gif.width, height: gif.height, dpi: 72, studio: "pixel", bg: null });
  stackLayers(doc, gif.frames.map((f, i) => ({ name: `Frame ${i + 1} (${f.delay} ms)`, canvas: rgbaCanvas(f.rgba, gif.width, gif.height) })));
  report.kept(`${gif.frames.length} frames as pixel layers (only the first is visible; each layer name shows the frame delay).`);
  report.note("OpenFini has no animation timeline yet: export the frames individually or switch layer visibility to preview them.");
  report.warnings(gif.warnings);
  return present(app, doc, report, `“${file.name}”`);
}

export async function openOra(app, file) {
  const { readOra } = await import("../engine/formats/ora.js");
  const ora = readOra(file.bytes);
  const report = new ImportReport("OpenRaster (ORA)", file.name);
  const doc = new Doc({ name: baseName(file.name), width: ora.width, height: ora.height, dpi: 72, studio: "pixel", bg: null });
  const root = doc.pages[0].root;
  const nodes = [];
  let pixels = 0;
  let groups = 0;
  for (let i = 0; i < ora.layers.length; i++) {
    const l = ora.layers[i];
    let node;
    if (l.kind === "group") {
      node = createNode("group", { name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend });
      groups++;
    } else {
      let canvas;
      try {
        canvas = await pngCanvas(l.png);
      } catch {
        report.dropped(`Layer “${l.name}” has an image that could not be decoded.`);
        nodes.push(null);
        continue;
      }
      node = pixelLayer(doc, canvas, { name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, m: translate(l.x, l.y) });
      pixels++;
    }
    nodes.push(node);
    const parent = l.parentIndex >= 0 && nodes[l.parentIndex] ? nodes[l.parentIndex] : root;
    parent.children.push(node);
  }
  if (!pixels && ora.mergedPng) {
    root.children.push(pixelLayer(doc, await pngCanvas(ora.mergedPng), { name: "Merged image", m: translate(0, 0) }));
    report.flattened("No layers could be read; the merged image of the file was opened instead.");
  } else if (!pixels) throw new Error("This OpenRaster file has no readable layers.");
  if (pixels) report.kept(`${pixels} pixel layer${pixels === 1 ? "" : "s"}${groups ? ` in ${groups} group${groups === 1 ? "" : "s"}` : ""} with opacity, visibility, blend mode and position.`);
  for (const w of ora.warnings) report.note(w);
  return present(app, doc, report, `“${file.name}”`);
}

export async function openIco(app, file) {
  const { readIco } = await import("../engine/formats/ico.js");
  const ico = readIco(file.bytes);
  const best = ico.images[0];
  const canvas = best.png ? await pngCanvas(best.png) : rgbaCanvas(best.rgba, best.width, best.height);
  const report = new ImportReport(ico.cursor ? "Windows cursor (CUR)" : "Windows icon (ICO)", file.name);
  const doc = new Doc({ name: baseName(file.name), width: canvas.width, height: canvas.height, dpi: 72, studio: "pixel", bg: null });
  doc.pages[0].root.children.push(pixelLayer(doc, canvas, { name: `${canvas.width} × ${canvas.height}`, m: translate(0, 0) }));
  report.kept(`The largest image (${canvas.width} × ${canvas.height}).`);
  if (ico.images.length > 1) report.dropped(`${ico.images.length - 1} smaller size${ico.images.length === 2 ? "" : "s"} in the file (${ico.images.slice(1).map((i) => `${i.width}`).join(", ")} px) were not imported.`);
  report.warnings(ico.warnings);
  return present(app, doc, report, `“${file.name}”`);
}

// ------------------------------------------------------------------ palettes

/** Adds colors to the document swatches (one undo step, duplicates skipped). Returns how many were added. */
export function addSwatches(app, colors) {
  const doc = app.doc;
  const known = new Set(doc.swatches.map((s) => String(s.color).toLowerCase()));
  const fresh = [];
  for (const c of colors) {
    const k = String(c.color).toLowerCase();
    if (known.has(k)) continue;
    known.add(k);
    fresh.push(c);
  }
  const room = Math.max(0, MAX_SWATCHES - doc.swatches.length);
  const take = fresh.slice(0, room);
  doc.tx("Import Palette", () => take.forEach((c, i) => doc.arrayInsert(doc.swatches, { id: `sw${Date.now().toString(36)}${i}`, name: String(c.name || c.color).slice(0, 60), color: c.color }, doc.swatches.length, "Import Palette")));
  app.emit("swatches", doc);
  return { added: take.length, duplicates: colors.length - fresh.length, dropped: fresh.length - take.length };
}

/** Reads a .gpl / .ase / .aco file into the swatches of the active document. */
export async function importPaletteFile(app, file) {
  const { readPalette } = await import("../engine/formats/palette.js");
  if (!app.doc) throw new Error("Open or create a document first, then import the palette into its swatches.");
  const pal = readPalette(file.bytes, file.name);
  const r = addSwatches(app, pal.colors);
  const parts = [`${r.added} color${r.added === 1 ? "" : "s"} added to the swatches`];
  if (r.duplicates) parts.push(`${r.duplicates} already present`);
  if (r.dropped) parts.push(`${r.dropped} skipped (limit ${MAX_SWATCHES})`);
  app.toast(`${pal.name}: ${parts.join(", ")}.`, r.added ? "success" : "warning", 4200);
  for (const w of pal.warnings) app.toast(w, "warning", 5000);
  return null;
}

/** The swatches of the active document as palette text / bytes in the chosen format. */
export async function exportPaletteText(app, format = "gpl") {
  const E = await import("../engine/formats/palette.js");
  const colors = app.doc.swatches.map((s) => ({ name: s.name, color: s.color }));
  if (format === "ase") return E.writeAse(colors);
  if (format === "aco") return E.writeAco(colors);
  return new TextEncoder().encode(E.writeGpl(colors, app.doc.name));
}

// ------------------------------------------------------------------ OpenRaster export

/** Writes the top-level pixel layers of the active Pixel document as an OpenRaster file. */
export async function exportOraFile(app) {
  const doc = app.doc;
  const page = app.page;
  const { canvasToBytes } = await import("./ofini.js");
  const { exportRaster } = await import("./io.js");
  const { writeOra } = await import("../engine/formats/ora.js");
  const layers = [];
  let skipped = 0;
  for (const n of page.root.children) {
    const c = n.type === "pixel" ? doc.pixels.get(n.id) : null;
    const m = n.m || [1, 0, 0, 1, 0, 0];
    if (!c || Math.abs(m[0] - 1) > 1e-6 || Math.abs(m[3] - 1) > 1e-6 || m[1] || m[2]) {
      skipped++;
      continue;
    }
    layers.push({ name: n.name, x: m[4], y: m[5], opacity: n.opacity ?? 1, visible: n.visible !== false, blend: n.blend || "normal", png: await canvasToBytes(c) });
  }
  if (!layers.length) throw new Error("This document has no plain pixel layers to write (shapes, text and transformed layers are not exported as ORA layers).");
  const merged = await exportRaster(app, { format: "png" });
  const bytes = writeOra({ width: Math.round(page.w), height: Math.round(page.h), layers, mergedPng: merged.bytes });
  return { bytes, layers: layers.length, skipped };
}

// ------------------------------------------------------------------ Krita (flattened) and routing

export async function openKra(app, file) {
  const { readKraMerged } = await import("../engine/formats/kra.js");
  const k = readKraMerged(file.bytes);
  const report = new ImportReport("Krita (KRA)", file.name);
  const canvas = await pngCanvas(k.png);
  const doc = new Doc({ name: baseName(file.name), width: canvas.width, height: canvas.height, dpi: 72, studio: "pixel", bg: null });
  doc.pages[0].root.children.push(pixelLayer(doc, canvas, { name: k.kind === "merged" ? "Merged image" : "Preview image", m: translate(0, 0) }));
  report.flattened(k.warnings[0]);
  report.warnings(k.warnings.slice(1));
  return present(app, doc, report, `“${file.name}”`);
}

export const RASTER_FORMAT_EXT = /\.(tiff?|gif|ora|kra|ico|cur|gpl|ase|aco)$/i;
const magic = (b, ...v) => v.every((x, i) => b[i] === x);

/**
 * Opens the file when it is one of the formats of this module. Returns the document, null when handled without a
 * document (palettes) and undefined when the file is not one of these formats (the caller continues).
 */
export async function openRasterFormat(app, file) {
  const b = file.bytes;
  const name = file.name || "";
  const isTiff = magic(b, 0x49, 0x49, 0x2a, 0) || magic(b, 0x4d, 0x4d, 0, 0x2a);
  if (isTiff || /\.tiff?$/i.test(name)) return openTiff(app, file);
  if (/\.(gpl|ase|aco)$/i.test(name) || magic(b, 0x41, 0x53, 0x45, 0x46)) return importPaletteFile(app, file);
  if (magic(b, 0x47, 0x49, 0x46, 0x38)) {
    try {
      return await openGif(app, file); // undefined for a still GIF: the normal image path handles it
    } catch {
      return undefined;
    }
  }
  if (/\.ora$/i.test(name)) return openOra(app, file);
  if (/\.kra$/i.test(name)) return openKra(app, file);
  if (/\.(ico|cur)$/i.test(name)) return openIco(app, file);
  return undefined;
}
