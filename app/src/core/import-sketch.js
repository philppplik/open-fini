// Opens Sketch (.sketch) files: every artboard becomes a page of a Vector-studio document.
import { Doc } from "./doc.js";
import { createNode, solid, defaultStroke } from "./nodes.js";
import { translate, mul, rotateAbout } from "./math.js";
import { storyFromPlain } from "../engine/layout/text-model.js";
import { svgDToPath } from "../engine/vector/path.js";
import { makeAsset, sniffMime } from "./io.js";
import { ImportReport, attachReport } from "./import-report.js";

function fillOf(f) {
  if (!f) return null;
  if (f.type === "solid") return solid(f.color, f.alpha);
  const stops = f.stops.map((s) => ({ o: s.o, color: s.color, alpha: s.alpha }));
  if (f.type === "linear") return { type: "linear", x0: f.from[0], y0: f.from[1], x1: f.to[0], y1: f.to[1], stops };
  return { type: "radial", cx: f.from[0], cy: f.from[1], r: Math.max(0.01, Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1])), fx: f.from[0], fy: f.from[1], stops };
}

function strokeOf(b) {
  if (!b) return null;
  const s = defaultStroke(b.color, b.width);
  s.fill = solid(b.color, b.alpha);
  s.align = b.position;
  s.cap = b.cap;
  s.join = b.join;
  if (b.dash) s.dash = b.dash.slice();
  return s;
}

async function itemNode(doc, it, sk, stats) {
  const common = { name: it.name, visible: it.visible, locked: it.locked, opacity: it.opacity };
  const fill = fillOf(it.fills?.[it.fills.length - 1]);
  const stroke = strokeOf(it.borders?.[0]);
  const w = Math.max(0.01, it.width);
  const h = Math.max(0.01, it.height);
  let node = null;
  switch (it.kind) {
    case "group":
      node = createNode("group", common);
      for (const c of it.children) {
        const n = await itemNode(doc, c, sk, stats);
        if (n) node.children.push(n);
      }
      break;
    case "rect":
      node = createNode("rect", { ...common, w, h, r: [it.radius || 0, it.radius || 0, it.radius || 0, it.radius || 0], fill, stroke });
      stats.shapes++;
      break;
    case "ellipse":
      node = createNode("ellipse", { ...common, w, h, fill, stroke });
      stats.shapes++;
      break;
    case "path":
      node = createNode("path", { ...common, path: svgDToPath(it.d), fill: it.closed ? fill : null, stroke: stroke || (it.closed ? null : defaultStroke("#000000", 1)) });
      stats.shapes++;
      break;
    case "text": {
      const t = it.text;
      const storyId = doc.createStory(storyFromPlain(t.string || " "));
      doc.stories[storyId].defaults = { char: { fontFamily: t.fontFamily, fontSize: t.fontSize, fontWeight: /bold|black|heavy/i.test(t.fontPostScript) ? 700 : 400, fontStyle: /italic|oblique/i.test(t.fontPostScript) ? "italic" : "normal" }, para: { align: t.align, lineHeight: 1.25 } };
      node = createNode("text", { ...common, name: t.string.slice(0, 24) || "Text", storyId, w: t.fixedWidth ? w : null, h: t.fixedWidth ? h : null, mode: t.fixedWidth ? "frame" : "artistic", flowIndex: 0, fill: solid(t.color) });
      stats.text++;
      break;
    }
    case "image": {
      const bytes = sk.images[it.imageRef];
      if (!bytes) {
        stats.missingImages++;
        return null;
      }
      try {
        const mime = sniffMime(bytes, it.imageRef);
        const a = await makeAsset(doc, { name: it.name, bytes, mime });
        node = createNode("image", { ...common, assetId: a.id, w, h });
        stats.images++;
      } catch {
        stats.missingImages++;
        return null;
      }
      break;
    }
    default:
      return null;
  }
  let m = translate(it.x, it.y);
  if (it.rotation) m = mul(rotateAbout((it.rotation * Math.PI) / 180, it.x + w / 2, it.y + h / 2), m);
  node.m = m;
  return node;
}

export async function openSketch(app, file) {
  const { readSketch } = await import("../engine/formats/index.js");
  const sk = readSketch(file.bytes);
  const report = new ImportReport("Sketch", file.name);
  report.warnings(sk.warnings);
  const stats = { shapes: 0, text: 0, images: 0, missingImages: 0, artboards: 0 };
  const first = sk.pages[0].artboards[0];
  const doc = new Doc({ name: String(file.name).replace(/\.[^.]+$/, ""), width: Math.round(first.width), height: Math.round(first.height), dpi: 72, studio: "vector", pages: 1, bg: "#ffffff" });
  let i = 0;
  for (const pg of sk.pages) {
    for (const ab of pg.artboards) {
      const page = i === 0 ? doc.pages[0] : doc.addPage({ w: Math.round(ab.width), h: Math.round(ab.height), name: ab.name }, i);
      page.name = sk.pages.length > 1 ? `${pg.name} / ${ab.name}` : ab.name;
      page.w = Math.round(ab.width);
      page.h = Math.round(ab.height);
      page.bg = ab.background || "#ffffff";
      for (const it of ab.items) {
        const n = await itemNode(doc, it, sk, stats);
        if (n) page.root.children.push(n);
      }
      stats.artboards++;
      i++;
    }
  }
  doc.relink();
  report.kept(`${stats.artboards} artboard${stats.artboards === 1 ? "" : "s"} as pages.`);
  if (stats.shapes) report.kept(`${stats.shapes} shape${stats.shapes === 1 ? "" : "s"} (rectangles, ovals and paths) with fills, gradients and borders.`);
  if (stats.text) report.kept(`${stats.text} text layer${stats.text === 1 ? "" : "s"} as editable text (first style of each layer only).`);
  if (stats.images) report.kept(`${stats.images} bitmap${stats.images === 1 ? "" : "s"}.`);
  if (stats.missingImages) report.dropped(`${stats.missingImages} bitmap${stats.missingImages === 1 ? "" : "s"} could not be read.`);
  report.note("The Sketch reader follows the documented JSON structure and was verified with synthetic files, not with files from every Sketch version.");
  attachReport(doc, report);
  return { doc, report };
}
