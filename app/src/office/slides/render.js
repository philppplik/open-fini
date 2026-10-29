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

export const TEXT_PAD = { x: 9.6, y: 4.8 };
export const LINE_HEIGHT = 1.2;
export const BULLET_INDENT = 1.1; // em

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

/** Wraps an element's text into lines inside its box (greedy, words longer than a line break by characters). */
export function layoutText(deck, e, measureFn, box = { w: e.w, h: e.h }) {
  const look = M.textLook(deck, e);
  const size = look.size * M.PT;
  const font = { family: look.font, size, weight: look.bold ? 700 : 400, style: look.italic ? "italic" : "normal" };
  const indent = look.bullets ? size * BULLET_INDENT : 0;
  const maxW = Math.max(1, box.w - TEXT_PAD.x * 2 - indent);
  const lines = [];
  for (const para of String(e.text || "").split("\n")) {
    const words = para.split(/(\s+)/);
    let cur = "";
    let first = true;
    const push = (text) => {
      lines.push({ text, bullet: look.bullets && first && para.trim() !== "", width: measureFn(font, text) });
      first = false;
    };
    for (const w of words) {
      const tryLine = cur + w;
      if (!cur || measureFn(font, tryLine.trimEnd()) <= maxW) {
        if (!cur && measureFn(font, w) > maxW && w.trim()) {
          let part = "";
          for (const ch of w) {
            if (part && measureFn(font, part + ch) > maxW) {
              push(part);
              part = "";
            }
            part += ch;
          }
          cur = part;
        } else cur = tryLine;
      } else {
        push(cur.trimEnd());
        cur = w.trimStart();
      }
    }
    push(cur.trimEnd());
  }
  const lh = size * LINE_HEIGHT;
  const total = lines.length * lh;
  const inner = box.h - TEXT_PAD.y * 2;
  let top = TEXT_PAD.y + (look.valign === "middle" ? (inner - total) / 2 : look.valign === "bottom" ? inner - total : 0);
  for (const l of lines) {
    const avail = maxW;
    const dx = look.align === "center" ? (avail - l.width) / 2 : look.align === "right" ? avail - l.width : 0;
    l.x = TEXT_PAD.x + indent + dx;
    l.y = top + size * 0.95; // baseline
    l.size = size;
    top += lh;
  }
  return { lines, font, look, indent };
}

function textRuns(deck, e, measureFn, box) {
  if (!e.text) return [];
  const { lines, font, look, indent } = layoutText(deck, e, measureFn, box);
  const runs = [];
  const fill = solid(look.color);
  for (const l of lines) {
    if (l.bullet) runs.push({ text: "•", x: l.x - indent, y: l.y, width: measureFn(font, "•"), font, fill, stroke: null, letterSpacing: 0, underline: false, strike: false });
    if (l.text) runs.push({ text: l.text, x: l.x, y: l.y, width: l.width, font, fill, stroke: null, letterSpacing: 0, underline: !!look.underline, strike: false });
  }
  return runs;
}

/** One slide as a display list in slide px. `images`: Map media id → ImageRef. */
export function slideDisplayList(deck, slide, images, measureFn) {
  const { w: W, h: H } = deck.size;
  const items = [{ t: "path", d: M.shapePath("rect", W, H), rule: "nonzero", fill: solid(slide.background?.color || deck.theme.bg), stroke: null, m: [1, 0, 0, 1, 0, 0] }];
  const bgImg = slide.background?.media && images.get(slide.background.media);
  if (bgImg) items.push({ t: "image", img: bgImg, m: [W / bgImg.width, 0, 0, H / bgImg.height, 0, 0], smooth: true });
  for (const e of slide.elements) {
    const m = elementMatrix(e);
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
