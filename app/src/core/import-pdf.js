// Builds OpenFini documents from PDF pages: native text frames, image nodes, vector paths with clipping, gradients and
// opacity. The PDF itself is read by core/pdf-source.js (pdf.js) and engine/formats/pdf-content.js.
import { Doc, createCanvas, ctx2d } from "./doc.js";
import { createNode, solid, defaultStroke } from "./nodes.js";
import { translate, mul, rotate, scale as scaleM } from "./math.js";
import { uid } from "./util.js";
import { dlState, getStoryLayout } from "../engine/dl.js";
import { svgDToPath } from "../engine/vector/path.js";
import { canvasToBytes } from "./ofini.js";
import { measure, registerFont, bumpFonts } from "./fonts.js";
import { openPdf, readPage, parsePageRange, imageDataToRGBA, PdfPasswordError } from "./pdf-source.js";
import { buildBlocks } from "../engine/formats/pdf-layout.js";
import { pathBounds } from "../engine/formats/pdf-content.js";
import { substituteFont, remapFontCmap, embeddedFamilyName } from "../engine/formats/pdf-fonts.js";
import { ImportReport, attachReport } from "./import-report.js";

export { PdfPasswordError, openPdf, parsePageRange };

export const PDF_DEFAULTS = { mode: "objects", pages: "", imageDpi: 0, pageDpi: 150, embedFonts: true, reflow: false, maxNodes: 12000 };

const BLEND = { multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten", colordodge: "color-dodge", colorburn: "color-burn", hardlight: "hard-light", softlight: "soft-light", difference: "difference", exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity" };
const blendOf = (b) => BLEND[String(b || "").toLowerCase().replace(/[-_ ]/g, "")] || "normal";
const MAX_IMG_PIXELS = 40e6;
const baseName = (n) => String(n || "PDF").replace(/\.[^.]+$/, "");

const dFromCmds = (d) => d.map((c) => (c[0] === "Z" ? "Z" : `${c[0]}${c.slice(1).map((v) => Math.round(v * 1000) / 1000).join(" ")}`)).join(" ");

// ------------------------------------------------------------------ fonts

class FontBook {
  constructor(app, opt, report) {
    this.app = app;
    this.opt = opt;
    this.report = report;
    this.map = new Map(); // fontId -> { family, weight, style, embedded, pairsSeen, face, bytes }
    this.serial = 0;
    this.embeddedCount = 0;
    this.substituted = new Set();
  }

  async resolve(fontId, fontObj, pairs) {
    let e = this.map.get(fontId);
    const canEmbed = this.opt.embedFonts && fontObj && fontObj.data && fontObj.data.length > 64 && !fontObj.missingFile && fontObj.type !== "Type3" && typeof document !== "undefined";
    if (e && (!e.embedded || !pairs || pairs.size <= e.pairsSeen)) return e;
    if (canEmbed && (!e || e.embedded)) {
      try {
        const fixed = remapFontCmap(fontObj.data, pairs || new Map());
        if (fixed) {
          const family = e?.family || embeddedFamilyName(fontObj.name, ++this.serial);
          const buf = fixed.buffer.slice(fixed.byteOffset, fixed.byteOffset + fixed.byteLength);
          const face = await registerFont(family, buf);
          if (e?.face) {
            try {
              document.fonts.delete(e.face);
              bumpFonts();
            } catch {
              /* ignore */
            }
          }
          this.app?.fonts?.set(family, fixed);
          if (!e) this.embeddedCount++;
          e = { family, weight: 400, style: "normal", embedded: true, pairsSeen: pairs?.size || 0, face };
          this.map.set(fontId, e);
          return e;
        }
      } catch {
        /* fall through to substitution */
      }
    }
    if (e) return e;
    const sub = substituteFont(fontObj?.name || "", { serif: !!fontObj?.isSerifFont, mono: !!fontObj?.isMonospace });
    e = { family: sub.family, weight: sub.weight, style: sub.style, embedded: false, pairsSeen: 0 };
    this.map.set(fontId, e);
    if (!sub.known) this.substituted.add(`${String(fontObj?.name || "font").replace(/^[A-Z]{6}\+/, "")} → ${sub.family}`);
    return e;
  }
}

// ------------------------------------------------------------------ images

async function imageCanvas(img, item, dpiCap, pageScale) {
  // img: pdf.js object ({data,kind} | {bitmap}) -> canvas, optionally downsampled
  let w = img.width || item.w;
  let h = img.height || item.h;
  let src;
  if (img.bitmap) {
    src = img.bitmap;
    w = src.width;
    h = src.height;
  } else {
    const rgba = imageDataToRGBA(img, { mask: !!item.mask, color: item.color });
    if (!rgba) return null;
    src = createCanvas(w, h);
    ctx2d(src).putImageData(new ImageData(rgba, w, h), 0, 0);
  }
  let k = 1;
  if (dpiCap > 0) {
    const widthInches = Math.hypot(item.m[0] * w, item.m[1] * w) / pageScale / 72;
    const dpi = widthInches > 0 ? w / widthInches : 0;
    if (dpi > dpiCap) k = dpiCap / dpi;
  }
  if (w * h * k * k > MAX_IMG_PIXELS) k = Math.sqrt(MAX_IMG_PIXELS / (w * h));
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));
  if (src instanceof HTMLCanvasElement && tw === w && th === h) return src;
  const c = createCanvas(tw, th);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, tw, th);
  img.bitmap?.close?.();
  return c;
}

function hasAlpha(canvas) {
  const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height, { colorSpace: "srgb" }).data;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 255) return true;
  return false;
}

async function addCanvasAsset(doc, canvas, name) {
  const png = canvas.width * canvas.height < 90000 || hasAlpha(canvas);
  const mime = png ? "image/png" : "image/jpeg";
  const bytes = await canvasToBytes(canvas, mime, 0.92);
  const id = uid("a");
  doc.assets[id] = { id, name, mime, w: canvas.width, h: canvas.height, bytes, _bitmap: canvas };
  return id;
}

// ------------------------------------------------------------------ nodes

function fillOf(f, d) {
  if (!f) return null;
  if (!f.grad) return solid(f.color || "#000000");
  const b = pathBounds(d) || { x: 0, y: 0, w: 1, h: 1 };
  const w = b.w || 1;
  const h = b.h || 1;
  const g = f.grad;
  const stops = g.stops.map((s) => ({ o: Math.max(0, Math.min(1, s.o)), color: s.color, alpha: 1 }));
  if (g.type === "linear") return { type: "linear", x0: (g.x0 - b.x) / w, y0: (g.y0 - b.y) / h, x1: (g.x1 - b.x) / w, y1: (g.y1 - b.y) / h, stops };
  const R = Math.max(w, h);
  return { type: "radial", cx: (g.x1 - b.x) / w, cy: (g.y1 - b.y) / h, r: Math.max(0.001, g.r1 / R), fx: (g.x0 - b.x) / w, fy: (g.y0 - b.y) / h, stops };
}

function pathNode(it) {
  const d = it.d;
  const fill = fillOf(it.fill, d);
  let stroke = null;
  if (it.stroke) {
    stroke = defaultStroke(it.stroke.color, it.stroke.width);
    if (it.stroke.grad) stroke.fill = fillOf({ grad: it.stroke.grad }, d);
    stroke.cap = it.stroke.cap;
    stroke.join = it.stroke.join;
    stroke.miterLimit = it.stroke.miter || 10;
    if (it.stroke.dash) {
      stroke.dash = it.stroke.dash.map((v) => Math.max(0.01, v));
      if (stroke.dash.length % 2) stroke.dash = stroke.dash.concat(stroke.dash);
      stroke.dashOffset = it.stroke.phase || 0;
    }
  }
  if (!fill && !stroke) return null;
  const common = { opacity: Math.max(0, Math.min(1, it.alpha ?? 1)), blend: blendOf(it.blend) };
  const b = pathBounds(d);
  if (!b) return null;
  // axis-aligned rectangles become rectangle objects (live corners, easy resizing)
  const pts = d.filter((c) => c[0] === "M" || c[0] === "L");
  const simple = d.every((c) => c[0] === "M" || c[0] === "L" || c[0] === "Z") && (pts.length === 4 || (pts.length === 5 && pts[0][1] === pts[4][1] && pts[0][2] === pts[4][2]));
  if (simple && pts.length >= 4) {
    const xs = new Set(pts.map((p) => Math.round(p[1] * 100)));
    const ys = new Set(pts.map((p) => Math.round(p[2] * 100)));
    if (xs.size === 2 && ys.size === 2 && b.w > 0.01 && b.h > 0.01) {
      return createNode("rect", { name: "Rectangle", ...common, w: b.w, h: b.h, m: translate(b.x, b.y), fill: it.fill?.grad ? fillOf({ grad: translateGrad(it.fill.grad, -b.x, -b.y) }, [["M", 0, 0], ["L", b.w, b.h]]) : fill, stroke });
    }
  }
  return createNode("path", { name: stroke && !fill ? "Line" : "Shape", ...common, path: svgDToPath(dFromCmds(d)), rule: it.rule || "nonzero", fill, stroke });
}

function translateGrad(g, dx, dy) {
  return { ...g, x0: g.x0 + dx, y0: g.y0 + dy, x1: g.x1 + dx, y1: g.y1 + dy };
}

/** Wraps consecutive nodes with the same clipping chain into clip containers (path nodes that clip their children). */
function placeWithClips(root, entries) {
  /** @type {{entry:any, node:any}[]} */
  let stack = [];
  const clipNode = (entry) => createNode("path", { name: "Clip", path: svgDToPath(dFromCmds(entry.d)), rule: entry.rule || "nonzero", fill: null, stroke: null, children: [] });
  for (const { node, clip } of entries) {
    const chain = clip || [];
    let k = 0;
    while (k < stack.length && k < chain.length && stack[k].entry === chain[k]) k++;
    stack = stack.slice(0, k);
    for (let i = k; i < chain.length; i++) {
      const c = { entry: chain[i], node: clipNode(chain[i]) };
      (stack.length ? stack[stack.length - 1].node : root).children.push(c.node);
      stack.push(c);
    }
    (stack.length ? stack[stack.length - 1].node : root).children.push(node);
  }
}

function runAttrs(run, e, base) {
  const a = {};
  if (e.family !== base.fontFamily) a.fontFamily = e.family;
  if (Math.abs(run.size - base.fontSize) > 0.01) a.fontSize = round2(run.size);
  if (e.weight !== base.fontWeight) a.fontWeight = e.weight;
  if (e.style !== base.fontStyle) a.fontStyle = e.style;
  if (run.color && run.color !== base.color) a.color = run.color;
  return a;
}
const round2 = (v) => Math.round(v * 100) / 100;

async function textNode(doc, block, fontsFor, o) {
  const lines = block.lines;
  const resolved = new Map();
  for (const l of lines) for (const r of l.runs) if (!resolved.has(r.fontId)) resolved.set(r.fontId, await fontsFor(r.fontId));
  const first = lines[0].runs[0];
  const f0 = resolved.get(first.fontId);
  const base = { fontFamily: f0.family, fontSize: round2(first.size), fontWeight: f0.weight, fontStyle: f0.style, color: first.color };
  /** @type {{text:string, attrs:object}[]} */
  const runs = [];
  const pushRun = (text, r, e) => {
    const attrs = runAttrs(r, e, base);
    // tracking so the line has the width of the original, whatever the substituted font measures
    const natural = measure({ family: e.family, size: r.size, weight: e.weight, style: e.style }, r.text);
    const nChars = [...r.text].length;
    if (natural > 0 && nChars > 1 && r.advance > 0) {
      const delta = (r.advance - natural) / nChars;
      if (Math.abs(r.advance - natural) > Math.max(0.4, r.advance * 0.004)) attrs.tracking = Math.round(Math.max(-150, Math.min(400, (delta / r.size) * 1000)));
    }
    const prev = runs[runs.length - 1];
    if (prev && JSON.stringify(prev.attrs) === JSON.stringify(attrs)) prev.text += text;
    else runs.push({ text, attrs });
  };
  lines.forEach((l, li) => {
    l.runs.forEach((r, ri) => {
      let text = r.text;
      if (ri === l.runs.length - 1 && li < lines.length - 1) {
        if (o.reflow) text = /[A-Za-zÀ-ɏ]-$/.test(text) ? text.slice(0, -1) : `${text} `;
        else text += String.fromCharCode(0x2028);
      }
      pushRun(text, r, resolved.get(r.fontId));
    });
  });
  const pitch = block.pitch || first.size * 1.25;
  const story = { paragraphs: [{ runs: runs.map((r) => (Object.keys(r.attrs).length ? r : { text: r.text })), attrs: {} }] };
  const storyId = uid("s");
  const defaults = { char: { ...base }, para: { align: "left", lineHeight: 1 } };
  doc.stories[storyId] = { id: storyId, story, defaults };
  const nLines = o.reflow ? 1 : lines.length;
  const w = o.reflow ? block.width + first.size * 0.6 : block.width * 1.08 + 4;
  const plain = lines.map((l) => l.text).join(" ");
  const node = createNode("text", {
    name: plain.slice(0, 28).trim() || "Text", storyId, w, h: Math.max(first.size * 1.3, (nLines - 1) * pitch + first.size * 1.4), mode: "frame", flowIndex: 0,
    fill: solid(base.color), opacity: Math.max(0, Math.min(1, first.alpha ?? 1)), visible: !block.hidden || o.showHidden,
  });
  // calibrate line height and the first baseline against the real text layout
  if (!o.reflow && lines.length > 1) {
    const k = baselineGap(doc, node, 1);
    if (k > 0) defaults.para.lineHeight = Math.round((pitch / k) * 1000) / 1000;
  } else defaults.para.lineHeight = Math.round((pitch / first.size) * 1000) / 1000 || 1.25;
  doc.stories[storyId].defaults = { ...defaults };
  node._rev = (node._rev | 0) + 1;
  const b0 = firstBaseline(doc, node);
  const x = block.x;
  node.m = block.angle ? mul(translate(x, block.baseline), mul(rotate(block.angle), translate(0, -b0))) : translate(x, block.baseline - b0);
  return node;
}

function layoutLines(doc, node) {
  const lay = getStoryLayout(doc, node, 1);
  return lay?.result?.frames?.[0]?.lines || [];
}
function firstBaseline(doc, node) {
  return layoutLines(doc, node)[0]?.baseline ?? 0;
}
/** Line gap of the story laid out with a line height factor of 1 (the host font's natural spacing at factor 1). */
function baselineGap(doc, node) {
  const ls = layoutLines(doc, node);
  return ls.length > 1 ? ls[1].baseline - ls[0].baseline : 0;
}

// ------------------------------------------------------------------ pages

async function renderPageImage(src, page, scale, hideText) {
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(vp.width, vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const opts = { canvasContext: ctx, canvas, viewport: vp, annotationMode: src.lib.AnnotationMode.ENABLE_STORAGE };
  if (hideText) {
    const ol = await page.getOperatorList({ annotationMode: src.lib.AnnotationMode.ENABLE_STORAGE });
    const O = src.lib.OPS;
    const textOps = new Set([O.showText, O.showSpacedText, O.nextLineShowText, O.nextLineSetSpacingShowText]);
    opts.operationsFilter = (i) => !textOps.has(ol.fnArray[i]);
  }
  // pdf.js paces rendering with requestAnimationFrame, which does not fire in a hidden or unfocused window;
  // an import must finish regardless, so frames are driven by timers while the page renders
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
  try {
    await page.render(opts).promise;
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
  return canvas;
}

/**
 * Converts the selected pages of an opened PDF into pages of `doc`.
 * @param {{reuseFirst?: boolean, index?: number}} place
 */
async function buildPages(app, doc, src, pageNums, opt, report, place, progress) {
  const fonts = new FontBook(app, opt, report);
  const imageAssets = new Map();
  const k = opt.unitScale || 1;
  const stats = { text: 0, shapes: 0, images: 0, hidden: 0, flattenedPages: 0, links: 0, softMasks: 0, tilings: 0 };
  const warnings = new Set();
  let done = 0;
  for (const n of pageNums) {
    if (progress?.cancelled) {
      report.note(`Import was cancelled after ${done} of ${pageNums.length} pages.`);
      break;
    }
    progress?.update(done, pageNums.length, n);
    await new Promise((r) => setTimeout(r, 0)); // keep the UI alive between pages
    const raw = await src.doc.getPage(n);
    const vp = raw.getViewport({ scale: k });
    const w = Math.max(1, Math.round(vp.width * 100) / 100);
    const h = Math.max(1, Math.round(vp.height * 100) / 100);
    let page;
    if (place.reuseFirst && done === 0) {
      page = doc.pages[0];
      page.w = w;
      page.h = h;
    } else page = doc.addPage({ w, h, name: `Page ${n}`, bg: "#ffffff" }, place.index + done);
    page.name = `Page ${n}`;
    page.bg = "#ffffff";
    const entries = [];
    const ir = await readPage(src, n, { images: opt.mode === "objects", scale: k });
    const textItems = ir.items.filter((i) => i.k === "text");
    let mode = opt.mode;
    if (mode === "objects" && ir.items.length > opt.maxNodes) {
      mode = "images";
      report.flattened(`Page ${n} is very complex (${ir.items.length} objects); it was flattened to an image with an editable text overlay.`);
    }
    for (const x of ir.warnings) warnings.add(x);
    stats.softMasks += ir.stats.softMasks;
    stats.tilings += ir.stats.tilings;
    stats.links += ir.links;
    const fontFor = async (fontId) => fonts.resolve(fontId, ir.fonts.get(fontId), ir.fontUse.get(fontId));

    if (mode === "images") {
      stats.flattenedPages++;
      const dpi = Math.max(36, Math.min(600, opt.pageDpi || 150));
      let scale = dpi / 72;
      while ((vp.width / k) * scale * (vp.height / k) * scale > 60e6) scale *= 0.8;
      const canvas = await renderPageImage(src, raw, scale, textItems.length > 0);
      const id = await addCanvasAsset(doc, canvas, `Page ${n}`);
      entries.push({ node: createNode("image", { name: `Page ${n} image`, assetId: id, w, h, m: translate(0, 0) }), clip: null });
      stats.images++;
    }
    if (mode === "objects") {
      for (const it of ir.items) {
        if (it.k === "path") {
          const node = pathNode(it);
          if (node) {
            entries.push({ node, clip: it.clip, z: it.z });
            stats.shapes++;
          }
        } else if (it.k === "image") {
          const img = it.data || ir.images.get(it.id);
          if (!img) {
            warnings.add("Some images could not be decoded and were left out.");
            continue;
          }
          const key = it.mask ? null : it.id;
          let ref = key && imageAssets.get(key);
          if (!ref) {
            const canvas = await imageCanvas(img, it, opt.imageDpi, k);
            if (!canvas) {
              warnings.add("An image in an unsupported pixel format was left out.");
              continue;
            }
            ref = { id: await addCanvasAsset(doc, canvas, `Image ${stats.images + 1}`), w: canvas.width, h: canvas.height, ow: img.width || img.bitmap?.width || it.w, oh: img.height || img.bitmap?.height || it.h };
            if (key) imageAssets.set(key, ref);
          }
          const m = mul(it.m, scaleM(ref.ow / ref.w, ref.oh / ref.h));
          // `it.m` maps the original pixel grid; re-express for the (possibly downsampled) asset
          const node = createNode("image", { name: it.mask ? "Stencil image" : "Image", assetId: ref.id, w: ref.w, h: ref.h, m, opacity: Math.max(0, Math.min(1, it.alpha ?? 1)), blend: blendOf(it.blend) });
          entries.push({ node, clip: it.clip, z: it.z });
          stats.images++;
        }
      }
    }
    if (mode === "objects" || mode === "images" || mode === "text") {
      const blocks = buildBlocks(textItems, { reflow: opt.reflow });
      for (const b of blocks) {
        try {
          const node = await textNode(doc, b, fontFor, { reflow: opt.reflow, showHidden: opt.mode === "text" });
          const visibleHidden = b.hidden && opt.mode !== "text";
          if (visibleHidden) {
            node.name = `OCR text: ${node.name}`;
            stats.hidden++;
          }
          entries.push({ node, clip: mode === "objects" ? b.clip : null, z: mode === "images" ? 1e9 + (b.z || 0) : b.z ?? 0 });
          stats.text++;
        } catch (e) {
          warnings.add(`A text block could not be converted (${e.message}).`);
        }
      }
    }
    // paint order: path/image items carry the operator index; text blocks the index of their first run
    if (mode === "objects") {
      entries.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    }
    placeWithClips(page.root, entries);
    raw.cleanup?.();
    done++;
  }
  progress?.update(done, pageNums.length, null);
  // report
  const nodes = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;
  if (stats.text) report.kept(`${nodes(stats.text, "text block")} as editable text frames (${fonts.embeddedCount} embedded font${fonts.embeddedCount === 1 ? "" : "s"} reused).`);
  if (stats.shapes) report.kept(`${nodes(stats.shapes, "vector shape")} with fills, strokes, gradients and clipping.`);
  if (stats.images) report.kept(`${nodes(stats.images, "image")}${stats.flattenedPages ? " (including flattened page images)" : ""}.`);
  if (stats.flattenedPages && opt.mode === "images") report.flattened(`${nodes(stats.flattenedPages, "page")} flattened to a background image at ${opt.pageDpi || 150} dpi; text is an editable overlay.`);
  if (stats.hidden) report.note(`${nodes(stats.hidden, "invisible text block")} (for example the OCR layer of a scan) was added as hidden text. Show it in the Layers panel if you need it.`);
  if (fonts.substituted.size) report.flattened(`Fonts that could not be embedded were replaced: ${[...fonts.substituted].slice(0, 6).join("; ")}${fonts.substituted.size > 6 ? `; and ${fonts.substituted.size - 6} more` : ""}. Letter spacing was adjusted to keep line widths.`);
  if (stats.softMasks) report.dropped(`${nodes(stats.softMasks, "soft mask")} (transparency masks) were not kept.`);
  if (stats.tilings) report.dropped("Tiling patterns were replaced by flat colors.");
  if (stats.links) report.dropped(`${nodes(stats.links, "link annotation")} (clickable links) were not kept.`);
  for (const w of warnings) report.note(w);
  return stats;
}

function finishDoc(app, doc, warnings) {
  doc.relink();
  dlState.version++;
  void warnings;
}

/** Asks pdf.js for the document, prompting for a password when needed. */
export async function openPdfWithPassword(bytes, askPassword) {
  let password;
  for (let tries = 0; tries < 6; tries++) {
    try {
      return await openPdf(bytes, { password });
    } catch (e) {
      if (!(e instanceof PdfPasswordError)) throw e;
      password = await askPassword(e.incorrect);
      if (password == null) throw new Error("Opening was cancelled: no password was entered.");
    }
  }
  throw new Error("Too many wrong passwords.");
}

function permissionNotice(src, report) {
  if (src.permissions) report.note("This PDF has permission restrictions (printing, copying or editing may be limited by its owner). OpenFini opens and converts it anyway; respecting the owner's restrictions and applicable rights is your responsibility.");
  else if (src.encrypted) report.note("This PDF is encrypted.");
}

/**
 * Opens a PDF as a new Layout document.
 * @param {*} app
 * @param {{name:string, bytes:Uint8Array}} file
 * @param {Partial<typeof PDF_DEFAULTS> & {src?: any, progress?: any}} [options]
 */
export async function openPdfDocument(app, file, options = {}) {
  const opt = { ...PDF_DEFAULTS, ...options };
  const src = options.src || (await openPdfWithPassword(file.bytes, options.askPassword || (async () => null)));
  const report = new ImportReport(options.format || "PDF", file.name);
  try {
    const nums = parsePageRange(opt.pages, src.pages);
    if (!nums || !nums.length) throw new Error("The page range is not valid for this PDF.");
    const doc = new Doc({ name: src.metadata?.Title?.trim() || baseName(file.name), width: 612, height: 792, dpi: 72, studio: "layout", pages: 1, bg: "#ffffff" });
    permissionNotice(src, report);
    await buildPages(app, doc, src, nums, { ...opt, unitScale: 1 }, report, { reuseFirst: true, index: 0 }, options.progress);
    if (nums.length < src.pages) report.note(`Pages ${options.pages} of ${src.pages} were imported.`);
    report.note("Form fields are imported as static content; they are not interactive.");
    finishDoc(app, doc);
    attachReport(doc, report);
    doc.history.clear();
    doc.saved = true;
    return { doc, report };
  } finally {
    src.destroy();
  }
}

/** Inserts the selected pages of a PDF into an existing document after page `afterIndex` (0-based, default: end). */
export async function insertPdfPages(app, doc, file, options = {}) {
  const opt = { ...PDF_DEFAULTS, ...options };
  const src = options.src || (await openPdfWithPassword(file.bytes, options.askPassword || (async () => null)));
  const report = new ImportReport("PDF", file.name);
  try {
    const nums = parsePageRange(opt.pages, src.pages);
    if (!nums || !nums.length) throw new Error("The page range is not valid for this PDF.");
    const index = Math.min(doc.pages.length, (options.afterIndex ?? doc.pages.length - 1) + 1);
    permissionNotice(src, report);
    // built in a scratch document first so that the insertion is a single undo step
    const tmp = new Doc({ name: "tmp", width: 100, height: 100, dpi: doc.dpi, studio: "layout", pages: 1, bg: "#ffffff" });
    const stats = await buildPages(app, tmp, src, nums, { ...opt, unitScale: doc.dpi / 72 }, report, { reuseFirst: true, index: 0 }, options.progress);
    Object.assign(doc.assets, tmp.assets);
    Object.assign(doc.stories, tmp.stories);
    doc.tx("Insert PDF Pages", () => {
      tmp.pages.forEach((tp, i) => {
        const p = doc.addPage({ w: tp.w, h: tp.h, name: tp.name, bg: "#ffffff" }, index + i);
        p.root.children = tp.root.children;
      });
    });
    finishDoc(app, doc);
    attachReport(doc, report);
    return { report, count: nums.length, stats };
  } finally {
    src.destroy();
  }
}
