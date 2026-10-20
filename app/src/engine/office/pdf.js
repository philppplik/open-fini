// PDF export of office documents: flows the document through the Layout studio's text engine (line breaking,
// alignment, indents) onto pages and writes them with the PDF backend. Pure: the host supplies decoded images.
//
// Fidelity (documented in docs/office-studio.md): text uses the PDF base-14 fonts (Helvetica, Times, Courier chosen
// from the font family; measured with the same metrics, so lines fit exactly; characters outside Windows-1252 print
// as "?"), table rows do not split across pages, footnotes are printed as endnotes, links are not clickable.
import { layoutStory, approxMeasurer } from "../layout/text-layout.js";
import { createPDF } from "../backends/pdf.js";
import { normalizeDoc, effectivePara, effectiveRun, tableGrid, isText, headingLevel, listLabel } from "./model.js";

export { listLabel };
import { imageSize } from "./media.js";

const BLACK = (c) => ({ type: "solid", color: c || "#000000", alpha: 1 });
const IDENT = [1, 0, 0, 1, 0, 0];
const rect = (x, y, w, h) => [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
/**
 * Lays the document out on pages.
 * @param {object} input office model
 * @param {{ images?: Record<string, {width:number,height:number,rgba?:Uint8ClampedArray,jpeg?:Uint8Array}> }} [o]
 * @returns {{ width:number, height:number, items:any[] }[]} display lists in points
 */
export function layoutPages(input, o = {}) {
  const doc = normalizeDoc(input);
  const pg = doc.page;
  const M = pg.margins;
  const W = pg.width;
  const H = pg.height;
  const cw = Math.max(36, W - M.left - M.right);
  const top = M.top;
  const bottom = H - M.bottom;
  const pages = [];
  let items = null;
  let y = 0;
  const newPage = () => {
    items = [];
    pages.push({ width: W, height: H, items });
    y = top;
  };
  newPage();
  const measure = { measure: approxMeasurer.measure, metrics: approxMeasurer.metrics };
  const notes = [];
  const counters = new Map();

  const imageFor = (id) => {
    const m = doc.media[id];
    const host = o.images?.[id];
    if (host) return host;
    if (m?.mime === "image/jpeg" && m.bytes) {
      const s = imageSize(m.bytes, m.mime);
      if (s) return { width: s.w, height: s.h, jpeg: m.bytes };
    }
    return null;
  };
  const drawImage = (r, x, yTop) => {
    const img = imageFor(r.media);
    if (img) items.push({ t: "image", img: { id: r.media, ...img }, m: [r.width / img.width, 0, 0, r.height / img.height, x, yTop], smooth: true });
    else {
      items.push({ t: "path", d: rect(x, yTop, r.width, r.height), rule: "nonzero", fill: BLACK("#eeeeee"), stroke: { paint: BLACK("#999999"), width: 0.5, cap: "butt", join: "miter", miterLimit: 4, dash: null, dashOffset: 0 }, m: IDENT });
    }
  };

  /** Converts a paragraph into layout-engine runs; inline objects are returned separately. */
  const storyOf = (p, fields = {}) => {
    const runs = [];
    const images = [];
    for (const r of p.runs) {
      if (isText(r) || r.type === "field" || r.type === "footnote") {
        const m = effectiveRun(doc, p, isText(r) ? r : {});
        let text = isText(r) ? r.text : r.type === "field" ? String(fields[r.field] ?? (r.field === "date" ? new Date().toISOString().slice(0, 10) : "#")) : "";
        let va = m.va;
        if (r.type === "footnote") {
          notes.push(r.id);
          text = String(notes.length);
          va = "super";
        }
        const size = (m.size || 11) * (va ? 0.65 : 1);
        runs.push({ text, attrs: { fontFamily: m.font || "Calibri", fontSize: size, fontWeight: m.b ? 700 : 400, fontStyle: m.i ? "italic" : "normal", color: m.link ? m.color || "#0563c1" : m.color || "#000000", underline: !!m.u || !!m.link, strike: !!m.s, baselineShift: va === "super" ? (m.size || 11) * 0.33 : va === "sub" ? -(m.size || 11) * 0.12 : 0, _hl: m.highlight } });
      } else if (r.type === "break") runs.push({ text: "\u2028", attrs: {} });
      else if (r.type === "image") images.push(r);
    }
    return { runs, images };
  };

  const layoutPara = (p, width, fields) => {
    const pp = effectivePara(doc, p);
    const { runs, images } = storyOf(p, fields);
    let indentLeft = pp.indentLeft || 0;
    let indentFirst = pp.indentFirst || 0;
    let label = null;
    if (p.list) {
      const L = p.list.level || 0;
      indentLeft = 36 * (L + 1);
      indentFirst = 0;
      const key = `${p.list.id || p.list.kind}`;
      const arr = counters.get(key) || [];
      arr.length = L + 1;
      arr[L] = (arr[L] || 0) + 1;
      counters.set(key, arr);
      label = listLabel(p.list.kind, L, arr[L]);
    }
    const attrs = { align: pp.align || "left", lineHeight: (pp.lineHeight || 1.15) * 1.17, indentLeft, indentRight: pp.indentRight || 0, indentFirst, widowOrphan: 1 };
    const res = layoutStory({ paragraphs: [{ runs: runs.length ? runs.map((r) => ({ text: r.text, attrs: r.attrs })) : [{ text: "", attrs: effRunAttrs(doc, p) }], attrs }] }, [{ x: 0, y: 0, w: width, h: 1e7 }], measure);
    const lines = res.frames[0]?.lines || [];
    // carry highlight colors through (the engine copies only known attributes)
    const hl = [];
    let off = 0;
    for (const r of runs) {
      hl.push({ from: off, to: off + r.text.length, color: r.attrs._hl });
      off += r.text.length;
    }
    return { pp, lines, images, label, hl, firstSize: runs[0]?.attrs.fontSize || effRunAttrs(doc, p).fontSize };
  };

  const emitLine = (line, dx, dy, hl) => {
    const out = [];
    for (const r of line.runs) {
      if (!r.text || r.text === "\u2028") continue;
      const h = hl.find((x) => r.charStart >= x.from && r.charStart < x.to)?.color;
      if (h) items.push({ t: "path", d: rect(dx + r.x, dy + line.y, r.width, line.height), rule: "nonzero", fill: BLACK(h), stroke: null, m: IDENT });
      out.push({ text: r.text, x: dx + r.x, y: dy + line.baseline - (r.baselineShift || 0), width: r.width, font: r.font, fill: BLACK(r.color), stroke: null, letterSpacing: r.letterSpacing || 0, underline: !!r.underline, strike: !!r.strike });
    }
    if (out.length) items.push({ t: "text", runs: out, m: IDENT });
  };

  const placePara = (p, x0, width, { keepNext = false } = {}) => {
    const L = layoutPara(p, width);
    const pp = L.pp;
    if (pp.pageBreakBefore && y > top) newPage();
    const before = y > top ? pp.spaceBefore || 0 : 0;
    y += before;
    const total = L.lines.reduce((a, l) => a + l.height, 0);
    if (keepNext && y + total + 40 > bottom && y > top + before) {
      newPage();
    }
    let first = true;
    for (const line of L.lines) {
      if (y + line.height > bottom && y > top) newPage();
      const dy = y - line.y;
      emitLine(line, x0, dy, L.hl);
      if (first && L.label) {
        const size = L.firstSize || 11;
        const font = { family: "Helvetica", size, weight: 400, style: "normal" };
        const w = approxMeasurer.measure(font, L.label);
        items.push({ t: "text", runs: [{ text: L.label, x: x0 + (pp.indentLeft !== undefined && !p.list ? pp.indentLeft : 36 * ((p.list?.level || 0) + 1)) - 18, y: dy + line.baseline, width: w, font, fill: BLACK("#000000"), stroke: null, letterSpacing: 0, underline: false, strike: false }], m: IDENT });
      }
      first = false;
      y += line.height;
    }
    for (const img of L.images) {
      const w = Math.min(img.width, width);
      const h = img.height * (w / img.width);
      if (y + h > bottom && y > top) newPage();
      const ax = pp.align === "center" ? x0 + (width - w) / 2 : pp.align === "right" ? x0 + width - w : x0 + (pp.indentLeft || 0);
      drawImage({ ...img, width: w, height: Math.min(h, bottom - top) }, ax, y);
      y += Math.min(h, bottom - top) + 2;
    }
    y += pp.spaceAfter || 0;
  };

  const placeTable = (t) => {
    const total = t.cols.reduce((a, c) => a + c, 0) || 1;
    const scale = total > cw ? cw / total : 1;
    const cols = t.cols.map((c) => c * scale);
    const xs = [M.left];
    for (const c of cols) xs.push(xs[xs.length - 1] + c);
    const grid = tableGrid(t);
    const pad = 4;
    const border = t.borders.style === "none" ? null : { paint: BLACK(t.borders.color), width: t.borders.width, cap: "butt", join: "miter", miterLimit: 4, dash: null, dashOffset: 0 };
    // measure every origin cell
    const cellLayouts = t.rows.map((row, r) =>
      row.cells.map((cell, ci) => {
        const g = grid[r].find((x) => x && x.r === r && x.ci === ci);
        const w = g ? xs[g.col + g.colspan] - xs[g.col] : cols[0];
        const paras = cell.blocks.map((p) => layoutPara(p, Math.max(10, w - 2 * pad)));
        const h = paras.reduce((a, L) => a + (L.pp.spaceBefore || 0) * 0 + L.lines.reduce((s, l) => s + l.height, 0) + Math.min(L.pp.spaceAfter || 0, 4) + L.images.reduce((s, im) => s + im.height, 0), 0) + 2 * pad;
        return { g, paras, h };
      }),
    );
    const rowH = t.rows.map((row, r) => Math.max(14, ...cellLayouts[r].filter((c) => c.g && c.g.rowspan === 1).map((c) => c.h)));
    // rows that span grow the last row they cover when needed
    t.rows.forEach((row, r) => {
      for (const c of cellLayouts[r]) {
        if (!c.g || c.g.rowspan === 1) continue;
        const have = rowH.slice(r, r + c.g.rowspan).reduce((a, v) => a + v, 0);
        if (c.h > have) rowH[r + c.g.rowspan - 1] += c.h - have;
      }
    });
    const headerRows = [];
    for (const row of t.rows) if (row.header) headerRows.push(row);
    const rowTop = [];
    const drawRow = (r) => {
      const ry = y;
      rowTop[r] = { y: ry, page: items };
      for (const c of cellLayouts[r]) {
        if (!c.g) continue;
        const cell = t.rows[r].cells[c.g.ci];
        const x = xs[c.g.col];
        const w = xs[c.g.col + c.g.colspan] - x;
        const h = rowH.slice(r, r + c.g.rowspan).reduce((a, v) => a + v, 0);
        if (cell.shading) items.push({ t: "path", d: rect(x, ry, w, h), rule: "nonzero", fill: BLACK(cell.shading), stroke: null, m: IDENT });
        if (border) items.push({ t: "path", d: rect(x, ry, w, h), rule: "nonzero", fill: null, stroke: border, m: IDENT });
        const content = c.h - 2 * pad;
        let cy = ry + pad + (cell.vAlign === "middle" ? (h - 2 * pad - content) / 2 : cell.vAlign === "bottom" ? h - 2 * pad - content : 0);
        for (const L of c.paras) {
          for (const line of L.lines) {
            emitLine(line, x + pad, cy - line.y, L.hl);
            cy += line.height;
          }
          for (const im of L.images) {
            const iw = Math.min(im.width, w - 2 * pad);
            const ih = im.height * (iw / im.width);
            drawImage({ ...im, width: iw, height: ih }, x + pad, cy);
            cy += ih;
          }
          cy += Math.min(L.pp.spaceAfter || 0, 4);
        }
      }
      y += rowH[r];
    };
    y += 4;
    t.rows.forEach((row, r) => {
      const span = Math.max(1, ...cellLayouts[r].filter((c) => c.g).map((c) => c.g.rowspan));
      const need = rowH.slice(r, r + span).reduce((a, v) => a + v, 0);
      if (y + Math.min(need, bottom - top) > bottom && y > top) {
        newPage();
        // repeat header rows on the new page
        if (!row.header) t.rows.forEach((hr, k) => hr.header && drawRow(k));
      }
      drawRow(r);
    });
    y += 6;
  };

  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.type === "paragraph") placePara(b, M.left, cw, { keepNext: !!effectivePara(doc, b).keepWithNext || headingLevel(doc, b) > 0 });
    else if (b.type === "table") placeTable(b);
    else if (b.type === "pageBreak") newPage();
    else if (b.type === "rule") {
      if (y + 8 > bottom) newPage();
      items.push({ t: "path", d: [["M", M.left, y + 4], ["L", M.left + cw, y + 4]], rule: "nonzero", fill: null, stroke: { paint: BLACK("#808080"), width: 0.75, cap: "butt", join: "miter", miterLimit: 4, dash: null, dashOffset: 0 }, m: IDENT });
      y += 10;
    }
  }
  // footnotes as endnotes
  if (notes.length) {
    y += 12;
    if (y + 30 > bottom) newPage();
    items.push({ t: "path", d: [["M", M.left, y], ["L", M.left + 120, y]], rule: "nonzero", fill: null, stroke: { paint: BLACK("#808080"), width: 0.5, cap: "butt", join: "miter", miterLimit: 4, dash: null, dashOffset: 0 }, m: IDENT });
    y += 6;
    const ids = notes.slice();
    ids.forEach((id, k) => {
      const paras = doc.footnotes[id] || [];
      paras.forEach((p, j) => {
        const runs = [...(j === 0 ? [{ text: `${k + 1}. `, size: 9 }] : []), ...p.runs.filter((r) => r.type !== "footnote").map((r) => (isText(r) ? { ...r, size: r.size || 9 } : r))];
        placePara({ ...p, runs, props: { ...(p.props || {}), spaceAfter: 2 } }, M.left, cw);
      });
    });
  }
  // headers and footers with page numbers
  const n = pages.length;
  pages.forEach((page, k) => {
    items = page.items;
    const fields = { page: k + 1, pages: n };
    for (const [kind, list] of [["header", doc.header], ["footer", doc.footer]]) {
      if (!list.length) continue;
      const laid = list.map((p) => layoutPara(p, cw, fields));
      const h = laid.reduce((a, L) => a + L.lines.reduce((s, l) => s + l.height, 0), 0);
      let hy = kind === "header" ? M.header : H - M.footer - h;
      for (const L of laid)
        for (const line of L.lines) {
          emitLine(line, M.left, hy - line.y, L.hl);
          hy += line.height;
        }
    }
  });
  return pages;
}

function effRunAttrs(doc, p) {
  const m = effectiveRun(doc, p, {});
  return { fontFamily: m.font || "Calibri", fontSize: m.size || 11, fontWeight: m.b ? 700 : 400, fontStyle: m.i ? "italic" : "normal", color: m.color || "#000000" };
}

/**
 * Exports a document as PDF.
 * @param {object} doc office model
 * @param {{ images?: object, title?: string }} [o]
 * @returns {Uint8Array}
 */
export function exportPdf(doc, o = {}) {
  const pages = layoutPages(doc, o);
  const meta = doc.meta || {};
  return createPDF(pages, { pxPerInch: 72, title: o.title || meta.title || undefined, author: meta.author || undefined, subject: meta.subject || undefined, keywords: meta.keywords || undefined, creationDate: o.creationDate });
}
