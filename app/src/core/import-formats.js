// Opens third-party documents (Photoshop PSD / PSB, InDesign IDML) as OpenFini documents.
// The readers are the pure engines in engine/formats; this module builds the document from their output.
import { Doc, createCanvas, ctx2d } from "./doc.js";
import { createNode, solid, defaultStroke } from "./nodes.js";
import { translate, mul, rotateAbout } from "./math.js";
import { storyFromPlain } from "../engine/layout/text-model.js";
import { dlState } from "../engine/dl.js";
import { svgDToPath, rectPath } from "../engine/vector/path.js";
import { ImportReport, attachReport } from "./import-report.js";
import { announceImport } from "./open-foreign.js";

const BLEND = new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
const blendOf = (b) => (BLEND.has(b) ? b : "normal");
const baseName = (n) => String(n || "Untitled").replace(/\.[^.]+$/, "");

function finish(app, doc, studio, report, what) {
  doc.history.clear();
  doc.saved = true;
  dlState.version++;
  attachReport(doc, report);
  app.setStudio(studio);
  app.openDoc(doc);
  requestAnimationFrame(() => app.cv?.fitPage());
  announceImport(app, doc, report, what);
  return doc;
}

// ------------------------------------------------------------------ Photoshop

function layerCanvas(layer) {
  const c = createCanvas(layer.width, layer.height);
  const rgba = layer.rgba;
  if (layer.mask && layer.mask.width === layer.width && layer.mask.height === layer.height && layer.mask.data.length === layer.width * layer.height) {
    const copy = new Uint8ClampedArray(rgba);
    for (let i = 0, n = layer.width * layer.height; i < n; i++) copy[i * 4 + 3] = (copy[i * 4 + 3] * layer.mask.data[i]) / 255;
    ctx2d(c).putImageData(new ImageData(copy, layer.width, layer.height), 0, 0);
  } else ctx2d(c).putImageData(new ImageData(rgba, layer.width, layer.height), 0, 0);
  return c;
}

export async function openPsd(app, file) {
  const { readPsd } = await import("../engine/formats/index.js");
  const psd = readPsd(file.bytes);
  const warnings = [...psd.warnings];
  const report = new ImportReport(psd.version === 2 ? "Photoshop (PSB)" : "Photoshop (PSD)", file.name);
  const stats = { pixel: 0, text: 0, smart: 0, groups: 0 };
  const doc = new Doc({ name: baseName(file.name), width: psd.width, height: psd.height, dpi: 72, studio: "pixel", bg: null });
  const root = doc.pages[0].root;
  const nodes = new Array(psd.layers.length).fill(null);
  let pixelLayers = 0;
  psd.layers.forEach((l, i) => {
    const common = { name: l.name || (l.kind === "group" ? "Group" : "Layer"), visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1, blend: blendOf(l.blend) };
    let node = null;
    let textNode = null;
    if (l.kind === "group") {
      node = createNode("group", { ...common, blend: "normal" });
      stats.groups++;
    } else if (l.rgba && l.width > 0 && l.height > 0) {
      node = createNode("pixel", { ...common, w: l.width, h: l.height, m: translate(l.x, l.y) });
      doc.pixels.set(node.id, layerCanvas(l));
      pixelLayers++;
      if (l.kind === "text" && l.text?.content) {
        // editable text on top; the original raster stays underneath (hidden) as a reference
        const content = String(l.text.content);
        const size = l.text.fontSize > 0 ? l.text.fontSize : 24;
        const storyId = doc.createStory(storyFromPlain(content));
        doc.stories[storyId].defaults = { char: { fontFamily: "Inter", fontSize: Math.round(size * 10) / 10, fontWeight: 400, fontStyle: "normal" }, para: { align: "left", lineHeight: 1.2 } };
        textNode = createNode("text", { ...common, name: l.name || content.slice(0, 24), storyId, w: Math.max(l.width * 1.1, size), h: null, mode: "frame", flowIndex: 0, fill: solid(l.text.color || "#000000"), m: translate(l.x, l.y) });
        node.visible = false;
        node.name = `${node.name} (original raster)`;
        stats.text++;
      } else if (l.kind === "other") {
        stats.smart++;
        report.flattened(`Smart object “${l.name}” is imported as its flattened preview (not live).`);
      } else stats.pixel++;
    } else if (l.kind === "adjustment") report.dropped(`Adjustment layer “${l.name}” was not imported.`);
    if (l.clipping && node) report.dropped("Clipping masks were not kept (the layer is imported unclipped).");
    nodes[i] = node;
    if (!node) return;
    const parent = l.parentIndex >= 0 && nodes[l.parentIndex] ? nodes[l.parentIndex] : root;
    if (parent.type === "group" || parent === root) {
      parent.children.push(node);
      if (textNode) parent.children.push(textNode);
    }
  });
  if (!pixelLayers && psd.composite) {
    const node = createNode("pixel", { name: "Background", w: psd.composite.width, h: psd.composite.height });
    const c = createCanvas(node.w, node.h);
    ctx2d(c).putImageData(new ImageData(psd.composite.data, node.w, node.h), 0, 0);
    doc.pixels.set(node.id, c);
    root.children.push(node);
    report.flattened("The file has no layers that could be read; its flattened image was opened instead.");
  }
  doc.relink();
  if (stats.pixel) report.kept(`${stats.pixel} pixel layer${stats.pixel === 1 ? "" : "s"} with opacity, blend mode and masks.`);
  if (stats.groups) report.kept(`${stats.groups} group${stats.groups === 1 ? "" : "s"}.`);
  if (stats.text) report.kept(`${stats.text} text layer${stats.text === 1 ? "" : "s"} as editable text (position and size from the file; the font is replaced by Inter, the original raster is kept hidden).`);
  for (const w of warnings) (/effects|not rendered|adjustment|smart object/i.test(w) ? report.dropped(w) : report.note(w));
  return finish(app, doc, "pixel", report, `“${file.name}”`);
}

// ------------------------------------------------------------------ InDesign (IDML)

function itemNode(doc, it, warnings) {
  const common = { name: it.kind === "text" ? "Text" : it.kind, opacity: it.opacity ?? 1 };
  const fill = it.fill ? solid(it.fill) : null;
  const stroke = it.stroke ? defaultStroke(it.stroke, it.strokeWidth ?? 1) : null;
  const w = Math.max(0.01, it.width || 0);
  const h = Math.max(0.01, it.height || 0);
  let node = null;
  let rotatedAboutCenter = true;
  if (it.kind === "rect") node = createNode("rect", { ...common, w, h, fill, stroke });
  else if (it.kind === "ellipse") node = createNode("ellipse", { ...common, w, h, fill, stroke });
  else if (it.kind === "polygon" || it.kind === "line") {
    rotatedAboutCenter = false;
    const d = (it.path || []).map((sp) => `${sp.points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ")}${sp.closed ? " Z" : ""}`).join(" ");
    if (!d) return null;
    node = createNode("path", { ...common, path: svgDToPath(d), fill: it.kind === "line" ? null : fill, stroke: stroke || (it.kind === "line" ? defaultStroke("#000000", 1) : null) });
  } else if (it.kind === "text") {
    const paras = it.text?.paragraphs || [];
    const content = paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
    const first = paras[0]?.runs[0] || {};
    const storyId = doc.createStory(storyFromPlain(content));
    doc.stories[storyId].defaults = { char: { fontFamily: first.fontFamily || "Inter", fontSize: first.fontSize || 12, fontWeight: first.fontWeight || 400, fontStyle: first.fontStyle || "normal" }, para: { align: paras[0]?.align || "left", lineHeight: 1.25 } };
    node = createNode("text", { ...common, name: content.slice(0, 24) || "Text", storyId, w, h, mode: "frame", flowIndex: 0, fill: solid(first.color || "#111111") });
  } else if (it.kind === "image") {
    node = createNode("rect", { ...common, name: it.link ? `Image: ${String(it.link).split("/").pop()}` : "Image", w, h, fill: solid("#d7d8de"), stroke: null });
    warnings.push("Linked images are not embedded in IDML files; placeholders were added.");
  } else if (it.kind === "group") {
    node = createNode("group", { ...common, name: "Group" });
    for (const c of it.children || []) {
      const cn = itemNode(doc, c, warnings);
      if (cn) node.children.push(cn);
    }
    return node;
  }
  if (!node) return null;
  if (rotatedAboutCenter) {
    let m = translate(it.x || 0, it.y || 0);
    if (it.rotation) m = mul(rotateAbout((it.rotation * Math.PI) / 180, (it.x || 0) + w / 2, (it.y || 0) + h / 2), m);
    node.m = m;
  }
  return node;
}

export async function openIdml(app, file) {
  const { readIdml } = await import("../engine/formats/index.js");
  const idml = readIdml(file.bytes);
  const warnings = [...idml.warnings];
  const report = new ImportReport("InDesign (IDML)", file.name);
  if (!idml.pages.length) throw new Error("That IDML file has no pages.");
  const p0 = idml.pages[0];
  const doc = new Doc({ name: idml.name || baseName(file.name), width: Math.round(p0.width), height: Math.round(p0.height), dpi: 72, studio: "layout", pages: 1, bg: "#ffffff" });
  idml.pages.forEach((pg, i) => {
    const page = i === 0 ? doc.pages[0] : doc.addPage({ w: Math.round(pg.width), h: Math.round(pg.height), name: pg.name || `Page ${i + 1}` }, i);
    if (pg.name) page.name = pg.name;
    for (const it of pg.items) {
      const n = itemNode(doc, it, warnings);
      if (n) page.root.children.push(n);
    }
  });
  doc.relink();
  report.kept(`${idml.pages.length} page${idml.pages.length === 1 ? "" : "s"} with shapes, lines, text frames and colors.`);
  for (const w of warnings) (/placeholder|skipped|not supported|dropped|off every page/i.test(w) ? report.dropped(w) : report.note(w));
  return finish(app, doc, "layout", report, `“${file.name}”`);
}
