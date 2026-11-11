// Presentation app: slides as display lists (docs/engine-contracts.md ▸ Display list) for PDF and PNG export. Browser
// only (decodes pictures and measures text with a canvas); loaded lazily by app.js ▸ save(). The on-screen editor and
// the presenter use the DOM renderer in view.js with the same geometry (model.js ▸ shapePath) and text metrics
// (TEXT_PAD, LINE_HEIGHT, bullet indent), so exports match the screen closely.
//
// Public API
//   layoutText(deck, element, measureFn?) → { lines: [{ text, x, y, size, bullet }], font }   pure given measureFn
//   slideDisplayList(deck, slide, images) → DisplayList
//   deckToPdf(deck, { title }) → Promise<Uint8Array>
//   slideToPng(deck, slide, { width }) → Promise<Uint8Array>
//   deckToPngZip(deck, { width }) → Promise<Uint8Array>   one PNG per visible slide
import * as M from "./model.js";
import { renderChart } from "../../engine/layout/chart-render.js";

export const TEXT_PAD = { x: 9.6, y: 4.8 };
export const LINE_HEIGHT = 1.2;
export const BULLET_INDENT = 1.1; // em
export const LEVEL_INDENT = 1.4; // em per list level

const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];

/** Local (0..w, 0..h) → slide space, with rotation and flips around the center. */
export function elementMatrix(e) {
  const r = ((e.rot || 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  let m = [c, s, -s, c, e.x + e.w / 2, e.y + e.h / 2];
  m = mul(m, [e.flipH ? -1 : 1, 0, 0, e.flipV ? -1 : 1, 0, 0]);
  return mul(m, [1, 0, 0, 1, -e.w / 2, -e.h / 2]);
}

const solid = (color, alpha = 1) => (color ? { type: "solid", color, alpha } : null);
const strokeOf = (color, width) => (color && width ? { paint: solid(color), width, cap: "butt", join: "miter", miterLimit: 4, dash: null, dashOffset: 0 } : null);

/** Bullet characters by list level (all in the PDF standard fonts' character set). */
export const BULLETS = ["•", "–", "»"];

/** Font of a span format over the box look (mixed bold, italic, typeface and size). */
const fontOf = (look, f = {}) => ({ family: f.font || look.font, size: (f.size ?? look.size) * M.PT, weight: (f.bold ?? look.bold) ? 700 : 400, style: (f.italic ?? look.italic) ? "italic" : "normal" });

/**
 * Wraps an element's text into lines inside its box (greedy, words longer than a line break by characters). Lines
 * carry their source offset, list level and bullet position; mixed sizes give a line the height of its largest text.
 */
export function layoutText(deck, e, measureFn, box = { w: e.w, h: e.h }) {
  const look = M.textLook(deck, e);
  const size = look.size * M.PT;
  const font = fontOf(look);
  const text = String(e.text || "");
  const spans = e.spans?.length && e.spans.some((s) => s.font || s.size || s.bold !== undefined || s.italic !== undefined) ? e.spans : null;
  const widthOf = (a, b) => (spans ? M.spanSegments(text, spans, a, b).reduce((w, s) => w + measureFn(fontOf(look, s.fmt), s.text), 0) : measureFn(font, text.slice(a, b)));
  const sizeOf = (a, b) => (spans ? M.spanSegments(text, spans, a, Math.max(b, a + 1)).reduce((m, s) => Math.max(m, (s.fmt.size ?? look.size) * M.PT), size) : size);
  const levels = M.paragraphLevels(e);
  const lines = [];
  let paraStart = 0;
  text.split("\n").forEach((para, pi) => {
    const level = levels[pi] || 0;
    const lead = level * size * LEVEL_INDENT;
    const indent = lead + (look.bullets ? size * BULLET_INDENT : 0);
    const maxW = Math.max(1, box.w - TEXT_PAD.x * 2 - indent);
    const end = paraStart + para.length;
    let first = true;
    const push = (a, b) => {
      while (b > a && /\s/.test(text[b - 1])) b--;
      lines.push({ text: text.slice(a, b), start: a, width: widthOf(a, b), size: sizeOf(a, b), bullet: look.bullets && first && para.trim() !== "", level, indent, lead, maxW });
      first = false;
    };
    let a = paraStart, b = paraStart; // current line [a, b)
    const re = /\s+|\S+/g;
    for (let m; (m = re.exec(para));) {
      const ts = paraStart + m.index, te = ts + m[0].length;
      if (a === b) {
        if (/\S/.test(m[0]) && widthOf(ts, te) > maxW) {
          let p = ts;
          for (let k = ts + 1; k <= te; k++) if (k - p > 1 && widthOf(p, k) > maxW) {
            push(p, k - 1);
            p = k - 1;
          }
          [a, b] = [p, te];
        } else [a, b] = [ts, te];
      } else if (widthOf(a, /\S/.test(m[0]) ? te : b) <= maxW) b = te;
      else {
        push(a, b);
        if (/\S/.test(m[0])) [a, b] = [ts, te];
        else [a, b] = [te, te];
      }
    }
    push(a, b);
    paraStart = end + 1;
  });
  const total = lines.reduce((t, l) => t + l.size * LINE_HEIGHT, 0);
  const inner = box.h - TEXT_PAD.y * 2;
  let top = TEXT_PAD.y + (look.valign === "middle" ? (inner - total) / 2 : look.valign === "bottom" ? inner - total : 0);
  for (const l of lines) {
    const dx = look.align === "center" ? (l.maxW - l.width) / 2 : look.align === "right" ? l.maxW - l.width : 0;
    l.x = TEXT_PAD.x + l.indent + dx;
    l.bx = TEXT_PAD.x + l.lead; // bullet position
    l.y = top + l.size * 0.95; // baseline
    top += l.size * LINE_HEIGHT;
  }
  return { lines, font, look };
}

function textRuns(deck, e, measureFn, box) {
  if (!e.text) return [];
  const { lines, font, look } = layoutText(deck, e, measureFn, box);
  const runs = [];
  const fill = solid(look.color);
  for (const l of lines) {
    if (l.bullet) {
      const ch = BULLETS[l.level % BULLETS.length];
      runs.push({ text: ch, x: l.bx, y: l.y, width: measureFn(font, ch), font, fill, stroke: null, letterSpacing: 0, underline: false, strike: false });
    }
    if (!l.text) continue;
    if (!e.spans?.length) {
      runs.push({ text: l.text, x: l.x, y: l.y, width: l.width, font, fill, stroke: null, letterSpacing: 0, underline: !!look.underline, strike: false });
      continue;
    }
    let x = l.x;
    for (const seg of M.spanSegments(e.text, e.spans, l.start, l.start + l.text.length)) {
      const f = seg.fmt;
      const sf = fontOf(look, f);
      const width = measureFn(sf, seg.text);
      runs.push({ text: seg.text, x, y: l.y, width, font: sf, fill: f.color ? solid(f.color) : fill, stroke: null, letterSpacing: 0, underline: !!(f.underline ?? look.underline), strike: false });
      x += width;
    }
  }
  return runs;
}

/** One slide as a display list in slide px. `images`: Map media id → ImageRef. */
export function slideDisplayList(deck, slide, images, measureFn) {
  const { w: W, h: H } = deck.size;
  const items = [{ t: "path", d: M.shapePath("rect", W, H), rule: "nonzero", fill: solid(slide.background?.color || deck.theme.bg), stroke: null, m: [1, 0, 0, 1, 0, 0] }];
  const bgImg = slide.background?.media && images.get(slide.background.media);
  if (bgImg) items.push({ t: "image", img: bgImg, m: [W / bgImg.width, 0, 0, H / bgImg.height, 0, 0], smooth: true });
  for (const e of M.renderElements(deck, slide)) {
    const m = elementMatrix(e);
    if (e.type === "chart") {
      for (const it of chartItems(deck, e, measureFn)) items.push({ ...it, m: mul(m, it.m) });
      continue;
    }
    if (e.type === "image") {
      const img = images.get(e.media);
      if (img) items.push({ t: "image", img, m: mul(m, [e.w / img.width, 0, 0, e.h / img.height, 0, 0]), smooth: true });
      continue;
    }
    if (e.type === "table") {
      const rows = e.rows.length, cols = e.rows[0].length;
      const cw = e.w / cols, rh = e.h / rows;
      e.rows.forEach((r, ri) => r.forEach((text, ci) => {
        const cm = mul(m, [1, 0, 0, 1, ci * cw, ri * rh]);
        const head = e.header && ri === 0;
        items.push({ t: "path", d: M.shapePath("rect", cw, rh), rule: "nonzero", fill: solid(head ? deck.theme.accent : e.fill), stroke: strokeOf(e.stroke, 1), m: cm });
        const cell = { ...e, text, ph: undefined, w: cw, h: rh, style: { ...e.style, bullets: false, valign: "middle", bold: head || e.style.bold, color: head ? "#ffffff" : e.style.color } };
        const runs = textRuns(deck, cell, measureFn, { w: cw, h: rh });
        if (runs.length) items.push({ t: "text", runs, m: cm });
      }));
      continue;
    }
    if (e.type === "shape" || e.fill || (e.stroke && e.strokeWidth)) {
      const shape = e.type === "shape" ? e.shape : "rect";
      items.push({ t: "path", d: M.shapePath(shape, e.w, e.h), rule: "nonzero", fill: shape === "line" ? null : solid(e.fill), stroke: strokeOf(e.stroke, e.strokeWidth), m });
    }
    const runs = textRuns(deck, e, measureFn, e);
    if (runs.length) items.push({ t: "text", runs, m });
  }
  return { width: W, height: H, items };
}

/** Display-list items of a chart element in its local box (0..w, 0..h). `measureFn(font, text)` measures text. */
export function chartItems(deck, e, measureFn) {
  const chart = M.slideChart(deck, e);
  const measurer = { measure: (font, text) => measureFn(font, text) };
  return renderChart(chart, chart.data, e.w, e.h, measurer).items;
}

/** Decodes the deck's pictures once: Map id → ImageRef with a canvas source (screen/PNG) and RGBA or JPEG (PDF). */

export async function decodeImages(deck, { rgba = false } = {}) {
  const out = new Map();
  for (const [id, m] of Object.entries(deck.media || {})) {
    if (!m.bytes) continue;
    try {
      const url = URL.createObjectURL(new Blob([m.bytes], { type: m.mime }));
      const img = new Image();
      img.src = url;
      await img.decode();
      URL.revokeObjectURL(url);
      let w = img.naturalWidth || m.w || 512, h = img.naturalHeight || m.h || 512;
      const k = Math.min(1, 2048 / Math.max(w, h));
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: rgba });
      ctx.drawImage(img, 0, 0, w, h);
      const ref = { id, width: w, height: h, source: c };
      if (m.mime === "image/jpeg" && k === 1) ref.jpeg = m.bytes;
      else if (rgba) ref.rgba = ctx.getImageData(0, 0, w, h).data;
      out.set(id, ref);
    } catch {
      /* an undecodable picture is left out of the export */
    }
  }
  return out;
}

const visible = (deck) => deck.slides.filter((s) => !s.hidden);

export async function deckToPdf(deck, { title = "" } = {}) {
  const [{ measure }, { displayListsToPdf }] = await Promise.all([import("../../core/fonts.js"), import("../toolkit/export.js")]);
  const images = await decodeImages(deck, { rgba: true });
  const pages = visible(deck).map((s) => slideDisplayList(deck, s, images, measure));
  return displayListsToPdf(pages.length ? pages : [slideDisplayList(deck, deck.slides[0], images, measure)], { title });
}

async function pngOf(deck, slide, images, width) {
  const [{ measure }, { renderToCanvas }, { canvasToPng }] = await Promise.all([import("../../core/fonts.js"), import("../../engine/backends/canvas.js"), import("../toolkit/export.js")]);
  const dl = slideDisplayList(deck, slide, images, measure);
  return canvasToPng(renderToCanvas(dl, { scale: width / deck.size.w }));
}

export async function slideToPng(deck, slide, { width = 1920 } = {}) {
  return pngOf(deck, slide, await decodeImages(deck), width);
}

export async function deckToPngZip(deck, { width = 1920 } = {}) {
  const images = await decodeImages(deck);
  const { writeZip } = await import("../../engine/office/zip.js");
  const files = [];
  let i = 0;
  for (const s of visible(deck)) files.push([`slide-${String(++i).padStart(2, "0")}.png`, await pngOf(deck, s, images, width), { store: true }]);
  return writeZip(files);
}
