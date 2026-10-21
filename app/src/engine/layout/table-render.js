/**
 * Table layout and display-list generation (pure). Cell text is laid out with the regular text engine, so
 * wrapping, fonts, alignment and line height behave like text frames; lines, fills and text become ordinary
 * display-list items and therefore export to SVG, PDF and PNG as vectors.
 *
 * @module table-render
 */

import { layoutStory } from './text-layout.js';
import { evalTable, cellDisplay, normalizeMerges } from './table-model.js';
import { resolveStyle } from './table-styles.js';

const IDM = [1, 0, 0, 1, 0, 0];

/** `#rgb | #rrggbb | #rrggbbaa` → display-list paint (or null). */
export function solidPaint(color, alphaMul = 1) {
  if (!color || typeof color !== 'string') return null;
  let h = color.trim().toLowerCase();
  if (!h.startsWith('#')) return null;
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
  const alpha = (h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1) * alphaMul;
  return { type: 'solid', color: `#${h.slice(0, 6)}`, alpha };
}

/** The effective style of one cell: table style, header / first column / zebra rules, then cell overrides. */
export function cellStyle(t, r, c, base) {
  const st = base || resolveStyle(t.tstyle);
  const cell = t.cells[r][c];
  const head = r < t.headerRows;
  const firstCol = !head && c < t.headerCols;
  let fill = st.fill;
  let color = st.color;
  let weight = st.weight;
  if (head) {
    fill = st.headFill;
    color = st.headColor;
    weight = st.headWeight;
  } else {
    if (st.zebra && (r - t.headerRows) % 2 === 1) fill = st.altFill;
    if (firstCol) {
      if (st.firstColFill) fill = st.firstColFill;
      weight = st.firstColWeight;
    }
  }
  if (head && c < t.headerCols && st.firstColFill && !st.headFill) fill = st.firstColFill;
  const padAll = Number.isFinite(cell.pad) ? cell.pad : null;
  return {
    family: cell.family || st.family,
    size: cell.size || st.size,
    weight: cell.bold === true ? 700 : cell.bold === false ? 400 : weight,
    italic: !!cell.italic,
    underline: !!cell.underline,
    strike: !!cell.strike,
    color: cell.color || color,
    fill: cell.fill !== undefined ? cell.fill : fill,
    align: cell.align || null,
    valign: cell.valign || 'middle',
    padX: padAll ?? st.padX,
    padY: padAll ?? st.padY,
    lineHeight: cell.lineHeight || st.lineHeight,
  };
}

function storyOf(text) {
  return { paragraphs: String(text).split('\n').map((line) => ({ runs: line ? [{ text: line }] : [] })) };
}

/**
 * Lays out a table. `measurer` is a `{measure, metrics}` pair (see measurers.js).
 * @param {object} t table model
 * @param {{measure:Function, metrics:Function}} measurer
 * @param {{fields?:object}} [o]
 */
export function layoutTable(t, measurer, o = {}) {
  const R = t.rows.length;
  const C = t.cols.length;
  const st = resolveStyle(t.tstyle);
  const sheet = evalTable(t);
  const colX = [0];
  for (let c = 0; c < C; c++) colX.push(colX[c] + t.cols[c]);
  // header cells follow the alignment of their column: right-aligned when most body cells are numbers
  const numericCol = Array.from({ length: C }, (_, c) => {
    let n = 0;
    let tot = 0;
    for (let r = t.headerRows; r < R; r++) {
      if (t.cells[r][c].m) continue;
      const v = sheet.value(r, c);
      if (v == null || v === '') continue;
      tot++;
      if (typeof v === 'number') n++;
    }
    return tot > 0 && n / tot > 0.5;
  });
  const cells = [];
  const eff = t.rows.slice();
  const spanNeeds = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const cell = t.cells[r][c];
      if (cell.m) continue;
      const rs = cell.rs || 1;
      const cs = cell.cs || 1;
      const style = cellStyle(t, r, c, st);
      const d = cellDisplay(t, sheet, r, c);
      const w = colX[Math.min(C, c + cs)] - colX[c];
      const align = style.align || ((r >= t.headerRows ? d.number : numericCol[c]) ? 'right' : 'left');
      let lines = [];
      let textH = 0;
      if (d.text !== '') {
        const opts = {
          measure: measurer.measure,
          metrics: measurer.metrics,
          defaults: {
            char: { fontFamily: style.family, fontSize: style.size, fontWeight: style.weight, fontStyle: style.italic ? 'italic' : 'normal', color: d.error ? '#b91c1c' : style.color, underline: style.underline, strike: style.strike },
            para: { align: align === 'right' ? 'right' : align === 'center' ? 'center' : align === 'justify' ? 'justify' : 'left', lineHeight: style.lineHeight },
          },
          fields: o.fields || {},
        };
        const res = layoutStory(storyOf(d.text), [{ x: 0, y: 0, w: Math.max(4, w), h: 1e7, insets: { top: style.padY, right: style.padX, bottom: style.padY, left: style.padX } }], opts);
        const fr = res.frames[0];
        lines = fr.lines;
        textH = fr.usedHeight;
      }
      const need = (d.text !== '' ? textH + style.padY : 0) + (d.text !== '' ? style.padY : 2 * style.padY);
      const entry = { r, c, rs, cs, w, style, text: d.text, error: d.error, number: d.number, align, lines, textH, need, x: colX[c], y: 0, h: 0 };
      cells.push(entry);
      if (t.autoHeight !== false) {
        if (rs === 1) eff[r] = Math.max(eff[r], need);
        else spanNeeds.push(entry);
      }
    }
  }
  for (const e of spanNeeds) {
    const end = Math.min(R, e.r + e.rs) - 1;
    let sum = 0;
    for (let k = e.r; k <= end; k++) sum += eff[k];
    if (e.need > sum) eff[end] += e.need - sum;
  }
  const rowY = [0];
  for (let r = 0; r < R; r++) rowY.push(rowY[r] + eff[r]);
  for (const e of cells) {
    e.y = rowY[e.r];
    e.h = rowY[Math.min(R, e.r + e.rs)] - rowY[e.r];
  }
  return { colX, rowY, w: colX[C], h: rowY[R], rowHeights: eff, cells, style: st };
}

/** `{x, y, w, h}` of any cell (covered cells give their merged origin's rectangle). */
export function cellRect(layout, t, r, c) {
  const cell = t.cells[r][c];
  const or = cell.m ? cell.m[0] : r;
  const oc = cell.m ? cell.m[1] : c;
  const o = t.cells[or][oc];
  const r1 = Math.min(t.rows.length, or + (o.rs || 1));
  const c1 = Math.min(t.cols.length, oc + (o.cs || 1));
  return { x: layout.colX[oc], y: layout.rowY[or], w: layout.colX[c1] - layout.colX[oc], h: layout.rowY[r1] - layout.rowY[or], r: or, c: oc };
}

/** Which cell contains the local point? Returns `{r, c}` (clamped to the table) or null when outside by more than `tol`. */
export function cellAt(layout, x, y, tol = 0) {
  if (x < -tol || y < -tol || x > layout.w + tol || y > layout.h + tol) return null;
  let c = 0;
  while (c < layout.colX.length - 2 && x >= layout.colX[c + 1]) c++;
  let r = 0;
  while (r < layout.rowY.length - 2 && y >= layout.rowY[r + 1]) r++;
  return { r, c };
}

// ------------------------------------------------------------------------------------------------ display list

const rectD = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];

/**
 * Builds the border edge grid: `H[r][c]` (above row r), `V[r][c]` (left of column c); entries `{w, c}` or null.
 */
function borderGrid(t, layout) {
  const R = t.rows.length;
  const C = t.cols.length;
  const st = layout.style;
  const line = st.borderWidth > 0 ? { w: st.borderWidth, c: st.borderColor } : null;
  const H = Array.from({ length: R + 1 }, () => Array(C).fill(null));
  const V = Array.from({ length: R }, () => Array(C + 1).fill(null));
  for (let r = 0; r <= R; r++) {
    for (let c = 0; c < C; c++) {
      const outer = r === 0 || r === R;
      if (outer ? st.outer : st.hLines) H[r][c] = line;
      if (t.headerRows > 0 && r === t.headerRows && st.headLine) H[r][c] = { w: st.headLine.width, c: st.headLine.color };
    }
  }
  for (let r = 0; r < R; r++) {
    for (let c = 0; c <= C; c++) {
      const outer = c === 0 || c === C;
      if (outer ? st.outer : st.vLines) V[r][c] = line;
    }
  }
  const edge = (v) => (v && v.w > 0 ? { w: v.w, c: v.c || '#000000' } : null);
  for (const e of layout.cells) {
    const b = t.cells[e.r][e.c].borders;
    if (!b) continue;
    const r1 = Math.min(R, e.r + e.rs);
    const c1 = Math.min(C, e.c + e.cs);
    if (b.t !== undefined) for (let c = e.c; c < c1; c++) H[e.r][c] = edge(b.t);
    if (b.b !== undefined) for (let c = e.c; c < c1; c++) H[r1][c] = edge(b.b);
    if (b.l !== undefined) for (let r = e.r; r < r1; r++) V[r][e.c] = edge(b.l);
    if (b.r !== undefined) for (let r = e.r; r < r1; r++) V[r][c1] = edge(b.r);
  }
  for (const e of layout.cells) {
    if (e.rs === 1 && e.cs === 1) continue;
    const r1 = Math.min(R, e.r + e.rs);
    const c1 = Math.min(C, e.c + e.cs);
    for (let r = e.r + 1; r < r1; r++) for (let c = e.c; c < c1; c++) H[r][c] = null;
    for (let r = e.r; r < r1; r++) for (let c = e.c + 1; c < c1; c++) V[r][c] = null;
  }
  return { H, V };
}

/**
 * Display-list items of a laid-out table, in the node's local space (origin top-left).
 * @returns {any[]}
 */
export function tableItems(t, layout) {
  const items = [];
  const R = t.rows.length;
  const C = t.cols.length;
  // fills: one path per color
  const fills = new Map();
  for (const e of layout.cells) {
    if (!e.style.fill) continue;
    const key = e.style.fill;
    if (!fills.has(key)) fills.set(key, []);
    fills.get(key).push(...rectD(e.x, e.y, layout.colX[Math.min(C, e.c + e.cs)] - e.x, e.h));
  }
  for (const [color, d] of fills) {
    const paint = solidPaint(color);
    if (paint && paint.alpha > 0) items.push({ t: 'path', d, rule: 'nonzero', fill: paint, stroke: null, m: IDM });
  }
  // borders: one path per (color, width)
  const { H, V } = borderGrid(t, layout);
  const lines = new Map();
  const add = (edge, d) => {
    const key = `${edge.c}|${edge.w}`;
    if (!lines.has(key)) lines.set(key, { edge, d: [] });
    lines.get(key).d.push(...d);
  };
  const same = (a, b) => (a === b) || (a && b && a.w === b.w && a.c === b.c);
  for (let r = 0; r <= R; r++) {
    let c = 0;
    while (c < C) {
      const e = H[r][c];
      if (!e) {
        c++;
        continue;
      }
      let c1 = c;
      while (c1 + 1 < C && same(H[r][c1 + 1], e)) c1++;
      add(e, [['M', layout.colX[c], layout.rowY[r]], ['L', layout.colX[c1 + 1], layout.rowY[r]]]);
      c = c1 + 1;
    }
  }
  for (let c = 0; c <= C; c++) {
    let r = 0;
    while (r < R) {
      const e = V[r][c];
      if (!e) {
        r++;
        continue;
      }
      let r1 = r;
      while (r1 + 1 < R && same(V[r1 + 1][c], e)) r1++;
      add(e, [['M', layout.colX[c], layout.rowY[r]], ['L', layout.colX[c], layout.rowY[r1 + 1]]]);
      r = r1 + 1;
    }
  }
  for (const { edge, d } of lines.values()) {
    const paint = solidPaint(edge.c);
    if (!paint) continue;
    items.push({ t: 'path', d, rule: 'nonzero', fill: null, stroke: { paint, width: edge.w, cap: 'square', join: 'miter', miterLimit: 4, dash: null, dashOffset: 0 }, m: IDM });
  }
  // text
  const runs = [];
  for (const e of layout.cells) {
    if (!e.lines.length) continue;
    let off = 0;
    if (e.style.valign === 'middle') off = (e.h - (e.textH + 2 * e.style.padY)) / 2;
    else if (e.style.valign === 'bottom') off = e.h - (e.textH + 2 * e.style.padY);
    off = Math.max(0, off);
    for (const line of e.lines) {
      for (const run of line.runs) {
        if (!run.text) continue;
        runs.push({
          text: run.text,
          x: e.x + run.x,
          y: e.y + off + line.baseline - (run.baselineShift || 0),
          width: run.width,
          font: { family: run.font.family, size: run.font.size, weight: run.font.weight, style: run.font.style },
          fill: solidPaint(run.color || e.style.color),
          stroke: null,
          letterSpacing: run.tracking ? (run.tracking / 1000) * run.font.size : 0,
          underline: !!run.underline,
          strike: !!run.strike,
        });
      }
    }
  }
  if (runs.length) items.push({ t: 'text', runs, m: IDM });
  return items;
}

/** Convenience: layout + items, repairing the model first. */
export function renderTable(t, measurer, o) {
  normalizeMerges(t);
  const layout = layoutTable(t, measurer, o);
  return { layout, items: tableItems(t, layout) };
}
