// Interprets a pdf.js operator list into a flat, DOM-free description of one page ("page IR"):
// paths, images and text runs in page pixels (y down, 1 pt = 1 px), with clipping chains, alpha and gradients.
// pdf.js does the hard parsing (xref, filters, fonts, color spaces, encryption); this module only walks the
// already decoded operator list, so it runs in Node for tests. The numeric operator codes are passed in (`OPS`).
//
// Page IR items:
//   { k: 'path',  d, rule, fill, stroke, alpha, clip, blend }
//   { k: 'image', id | data, w, h, m, mask, color, alpha, clip }
//   { k: 'text',  text, x, y, angle, size, advance, color, alpha, fontId, hidden, clip }
// `fill` is { color } or { grad } (see below), `stroke` is { color, width, cap, join, miter, dash, phase }.
// `clip` is an array of { d, rule, bbox } shared between items (identity comparison groups them).

const DRAW = { move: 0, line: 1, curve: 2, quad: 3, close: 4 };

export const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const IDENT = [1, 0, 0, 1, 0, 0];
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

function bboxOf(d) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of d) {
    for (let i = 1; i < c.length; i += 2) {
      if (c[i] < x0) x0 = c[i];
      if (c[i] > x1) x1 = c[i];
      if (c[i + 1] < y0) y0 = c[i + 1];
      if (c[i + 1] > y1) y1 = c[i + 1];
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export { bboxOf as pathBounds };

/** True when `d` is a single axis-aligned rectangle; returns it or null. */
function asRect(d) {
  const pts = [];
  for (const c of d) {
    if (c[0] === 'M' || c[0] === 'L') pts.push([c[1], c[2]]);
    else if (c[0] !== 'Z') return null;
  }
  if (pts.length === 5 && pts[0][0] === pts[4][0] && pts[0][1] === pts[4][1]) pts.pop();
  if (pts.length !== 4) return null;
  const e = 0.01;
  const ok = (a, b) => Math.abs(a - b) < e;
  const h1 = ok(pts[0][1], pts[1][1]) && ok(pts[1][0], pts[2][0]) && ok(pts[2][1], pts[3][1]) && ok(pts[3][0], pts[0][0]);
  const h2 = ok(pts[0][0], pts[1][0]) && ok(pts[1][1], pts[2][1]) && ok(pts[2][0], pts[3][0]) && ok(pts[3][1], pts[0][1]);
  if (!h1 && !h2) return null;
  return bboxOf(d);
}

/** Converts a pdf.js shading IR (`['RadialAxial', 'axial'|'radial', bbox, stops, p0, p1, r0, r1]`) to page pixels. */
export function gradientFromIR(ir, m) {
  if (!ir || ir[0] !== 'RadialAxial') return null;
  const stops = (ir[3] || []).map(([o, color]) => ({ o: num(o), color: typeof color === 'string' && color[0] === '#' ? color.slice(0, 7) : '#808080' }));
  if (stops.length < 2) return null;
  const p0 = apply(m, ir[4][0], ir[4][1]);
  const p1 = apply(m, ir[5][0], ir[5][1]);
  const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  if (ir[1] === 'axial') return { type: 'linear', x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1], stops };
  return { type: 'radial', x0: p0[0], y0: p0[1], r0: num(ir[6]) * sc, x1: p1[0], y1: p1[1], r1: num(ir[7]) * sc, stops };
}

function colorToFill(c) {
  return typeof c === 'string' ? { color: c.slice(0, 7) } : c || { color: '#000000' };
}

/**
 * @param {{fnArray: number[], argsArray: any[]}} ol operator list from pdf.js
 * @param {object} o
 * @param {Record<string, number>} o.OPS pdf.js OPS table
 * @param {number[]} o.viewTransform viewport transform (PDF user space to page px, y down)
 * @param {{w:number,h:number}} o.page page size in px
 * @param {(id:string)=>object|null} [o.getFont]
 * @param {(id:string)=>any} [o.getPattern] shading IR of a pattern / shading object
 * @param {(props:any)=>boolean} [o.isVisible] optional content visibility (marked content arguments)
 * @returns {{items: object[], warnings: Set<string>, fontUse: Map<string, Map<string, number>>, stats: object}}
 */
export function interpretPage(ol, o) {
  const OPS = o.OPS;
  const warnings = new Set();
  const items = [];
  const fontUse = new Map();
  const stats = { paths: 0, images: 0, textRuns: 0, hiddenText: 0, softMasks: 0, tilings: 0, type3: 0, blend: 0, shadings: 0 };
  const P = o.page;
  const view = o.viewTransform || IDENT;

  let gs = { ctm: view.slice(), fill: { color: '#000000' }, stroke: { color: '#000000' }, fillAlpha: 1, strokeAlpha: 1, blend: 'normal', lw: 1, cap: 'butt', join: 'miter', miter: 10, dash: null, phase: 0, clip: [], font: null, fs: 0, Tc: 0, Tw: 0, Th: 1, Tl: 0, rise: 0, mode: 0 };
  const stack = [];
  let Tm = IDENT.slice();
  let Tlm = IDENT.slice();
  let pendingClip = null;
  const mcStack = [];
  let hidden = 0;
  const formStack = [];

  const isFull = (r) => r && r.x <= 1.5 && r.y <= 1.5 && r.x + r.w >= P.w - 1.5 && r.y + r.h >= P.h - 1.5;
  const sc = () => Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) || 1;

  function pathFrom(args) {
    const chunks = ArrayBuffer.isView(args[1]) ? [args[1]] : args[1] || [];
    const d = [];
    let cx = 0;
    let cy = 0;
    const T = (x, y) => apply(gs.ctm, x, y);
    for (const data of chunks) {
      for (let i = 0; i < data.length; ) {
        const op = data[i++];
        if (op === DRAW.move) {
          const p = T(data[i], data[i + 1]);
          cx = data[i];
          cy = data[i + 1];
          i += 2;
          d.push(['M', p[0], p[1]]);
        } else if (op === DRAW.line) {
          const p = T(data[i], data[i + 1]);
          cx = data[i];
          cy = data[i + 1];
          i += 2;
          d.push(['L', p[0], p[1]]);
        } else if (op === DRAW.curve) {
          const a = T(data[i], data[i + 1]);
          const b = T(data[i + 2], data[i + 3]);
          const c = T(data[i + 4], data[i + 5]);
          cx = data[i + 4];
          cy = data[i + 5];
          i += 6;
          d.push(['C', a[0], a[1], b[0], b[1], c[0], c[1]]);
        } else if (op === DRAW.quad) {
          const a = T(data[i], data[i + 1]);
          const c = T(data[i + 2], data[i + 3]);
          cx = data[i + 2];
          cy = data[i + 3];
          i += 4;
          d.push(['Q', a[0], a[1], c[0], c[1]]);
        } else if (op === DRAW.close) d.push(['Z']);
        else break; // unknown opcode: stop rather than mis-parse
      }
    }
    void cx;
    void cy;
    return d;
  }

  function strokeSpec() {
    const k = sc();
    return { color: gs.stroke.color || '#000000', grad: gs.stroke.grad || null, width: Math.max(0.01, gs.lw * k), cap: gs.cap, join: gs.join, miter: gs.miter, dash: gs.dash && gs.dash.length ? gs.dash.map((v) => v * k) : null, phase: gs.phase * k };
  }

  function emitPath(d, rule, doFill, doStroke) {
    if (!d.length || hidden) return;
    stats.paths++;
    items.push({
      k: 'path', d, rule,
      fill: doFill ? { ...gs.fill } : null,
      stroke: doStroke ? strokeSpec() : null,
      alpha: doFill ? gs.fillAlpha : gs.strokeAlpha,
      strokeAlpha: gs.strokeAlpha,
      blend: gs.blend,
      clip: gs.clip,
    });
  }

  function addClip(d, rule) {
    if (!d.length) return;
    const bbox = bboxOf(d);
    if (!bbox) return;
    const r = asRect(d);
    if (isFull(r)) return; // a clip that covers the whole page changes nothing
    gs.clip = [...gs.clip, { d, rule, bbox, rect: !!r }];
  }

  function imageMatrix(w, h) {
    // image pixel space (top-left origin, y down) to page px
    return mul([1 / w, 0, 0, -1 / h, 0, 1], gs.ctm);
  }

  function emitImage(img) {
    if (hidden) return;
    stats.images++;
    items.push({ k: 'image', alpha: gs.fillAlpha, clip: gs.clip, blend: gs.blend, ...img });
  }

  function showText(args) {
    const glyphs = args[0];
    if (!Array.isArray(glyphs) || !gs.font) return;
    const M0 = mul(Tm, gs.ctm);
    const sy = Math.hypot(M0[2], M0[3]) || 1;
    const sx = Math.hypot(M0[0], M0[1]) || 1;
    const size = gs.fs * sy;
    let tx = 0; // advance in text space units (not yet multiplied by Th for gaps)
    let text = '';
    const font = o.getFont ? o.getFont(gs.font) : null;
    const pairs = fontUse.get(gs.font) || fontUse.set(gs.font, new Map()).get(gs.font);
    let type3 = false;
    const startM = M0;
    for (const g of glyphs) {
      if (typeof g === 'number') {
        const adj = (-g / 1000) * gs.fs * gs.Th;
        if (-g >= 200 && text && !/\s$/.test(text)) text += ' ';
        tx += adj;
        continue;
      }
      if (!g) continue;
      if (g.operatorList) type3 = true;
      const w = (num(g.width) / 1000) * gs.fs;
      let u = typeof g.unicode === 'string' ? g.unicode : '';
      const fc = typeof g.fontChar === 'string' ? g.fontChar : '';
      if (!u || u === '\u0000' || /^[\u0000-\u001f]$/.test(u)) u = fc && fc.codePointAt(0) > 0x1f ? fc : u;
      if (u && fc && [...fc].length === 1 && ([...u].length === 1)) {
        if (!pairs.has(u)) pairs.set(u, fc.codePointAt(0));
        if (!pairs.has(fc)) pairs.set(fc, fc.codePointAt(0));
      }
      if (u) text += u;
      const space = g.isSpace || (g.originalCharCode === 32 && u === ' ');
      tx += (w + gs.Tc + (space ? gs.Tw : 0)) * gs.Th;
    }
    const origin = apply(mul([1, 0, 0, 1, 0, gs.rise], mul(Tm, gs.ctm)), 0, 0);
    // advance the text matrix for the next show operator
    Tm = mul([1, 0, 0, 1, tx, 0], Tm);
    if (type3) {
      stats.type3++;
      warnings.add('Text set in Type 3 fonts was approximated by its Unicode mapping.');
    }
    if (!text.trim() || hidden) return;
    const mode = gs.mode;
    const invisible = mode === 3;
    if (invisible) stats.hiddenText++;
    if (mode >= 4) return; // clipping-only modes
    const angle = Math.atan2(startM[1], startM[0]);
    stats.textRuns++;
    const col = mode === 1 || mode === 5 ? gs.stroke : gs.fill;
    items.push({
      k: 'text', text, x: origin[0], y: origin[1], angle, size,
      advance: tx * sx, color: col.color || (col.grad ? col.grad.stops?.[0]?.color : null) || '#000000',
      alpha: gs.fillAlpha, fontId: gs.font, fontName: font?.name || null, hidden: invisible, clip: gs.clip, blend: gs.blend,
    });
  }

  function setPaint(which, args) {
    // setFillColorN / setStrokeColorN: pattern arguments
    const a0 = args && args[0];
    if (a0 === 'Shading' || (Array.isArray(a0) && a0[0] === 'RadialAxial')) {
      let ir = null;
      let pm = IDENT;
      if (a0 === 'Shading') {
        ir = o.getPattern ? o.getPattern(args[1]) : null;
        pm = Array.isArray(args[2]) ? args[2] : IDENT;
      } else ir = a0;
      const g = ir && ir[0] === 'RadialAxial' ? gradientFromIR(ir, mul(pm, view)) : null;
      if (g) {
        stats.shadings++;
        gs[which] = { grad: g, color: g.stops[0].color };
      } else {
        warnings.add('A mesh or function shading was replaced by a flat color.');
        stats.shadings++;
        gs[which] = { color: '#808080' };
      }
    } else if (a0 === 'TilingPattern' || (Array.isArray(a0) && a0[0] === 'TilingPattern')) {
      stats.tilings++;
      warnings.add('Tiling patterns were replaced by a flat color.');
      const c = Array.isArray(args) && typeof args[1] === 'string' && args[1][0] === '#' ? args[1] : '#bbbbbb';
      gs[which] = { color: c.slice(0, 7) };
    } else if (typeof a0 === 'string' && a0[0] === '#') gs[which] = { color: a0.slice(0, 7) };
  }

  const fn = ol.fnArray;
  const ar = ol.argsArray;
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    const a = ar[i] || [];
    switch (op) {
      case OPS.save:
        stack.push({ ...gs, dash: gs.dash });
        break;
      case OPS.restore:
        if (stack.length) gs = stack.pop();
        break;
      case OPS.transform:
        gs.ctm = mul(a, gs.ctm);
        break;
      case OPS.setLineWidth:
        gs.lw = num(a[0], 1);
        break;
      case OPS.setLineCap:
        gs.cap = ['butt', 'round', 'square'][a[0]] || 'butt';
        break;
      case OPS.setLineJoin:
        gs.join = ['miter', 'round', 'bevel'][a[0]] || 'miter';
        break;
      case OPS.setMiterLimit:
        gs.miter = num(a[0], 10);
        break;
      case OPS.setDash:
        gs.dash = Array.isArray(a[0]) ? a[0].slice() : null;
        gs.phase = num(a[1]);
        break;
      case OPS.setGState:
        for (const [k, v] of a[0] || []) {
          if (k === 'ca') gs.fillAlpha = num(v, 1);
          else if (k === 'CA') gs.strokeAlpha = num(v, 1);
          else if (k === 'LW') gs.lw = num(v, 1);
          else if (k === 'BM') {
            gs.blend = typeof v === 'string' ? v : Array.isArray(v) ? v[0] : 'normal';
            if (gs.blend !== 'normal') stats.blend++;
          } else if (k === 'SMask' && v && v !== true) stats.softMasks++;
        }
        break;
      case OPS.setFillRGBColor:
      case OPS.setFillGray:
      case OPS.setFillCMYKColor:
      case OPS.setFillColor:
        if (typeof a[0] === 'string') gs.fill = colorToFill(a[0]);
        break;
      case OPS.setStrokeRGBColor:
      case OPS.setStrokeGray:
      case OPS.setStrokeCMYKColor:
      case OPS.setStrokeColor:
        if (typeof a[0] === 'string') gs.stroke = colorToFill(a[0]);
        break;
      case OPS.setFillColorN:
        setPaint('fill', a);
        break;
      case OPS.setStrokeColorN:
        setPaint('stroke', a);
        break;
      case OPS.clip:
        pendingClip = 'nonzero';
        break;
      case OPS.eoClip:
        pendingClip = 'evenodd';
        break;
      case OPS.constructPath: {
        const paintOp = a[0];
        const d = pathFrom(a);
        const eo = paintOp === OPS.eoFill || paintOp === OPS.eoFillStroke || paintOp === OPS.closeEOFillStroke;
        const doFill = paintOp === OPS.fill || paintOp === OPS.eoFill || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke || paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke;
        const doStroke = paintOp === OPS.stroke || paintOp === OPS.closeStroke || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke || paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke;
        if (doFill || doStroke) emitPath(d, eo ? 'evenodd' : 'nonzero', doFill, doStroke);
        if (pendingClip) {
          addClip(d, pendingClip);
          pendingClip = null;
        }
        break;
      }
      case OPS.endPath:
        pendingClip = null;
        break;
      case OPS.beginText:
        Tm = IDENT.slice();
        Tlm = IDENT.slice();
        break;
      case OPS.endText:
        break;
      case OPS.setCharSpacing:
        gs.Tc = num(a[0]);
        break;
      case OPS.setWordSpacing:
        gs.Tw = num(a[0]);
        break;
      case OPS.setHScale:
        gs.Th = num(a[0], 100) / 100;
        break;
      case OPS.setLeading:
        gs.Tl = num(a[0]);
        break;
      case OPS.setFont:
        gs.font = a[0];
        gs.fs = num(a[1], 12);
        break;
      case OPS.setTextRenderingMode:
        gs.mode = num(a[0]);
        break;
      case OPS.setTextRise:
        gs.rise = num(a[0]);
        break;
      case OPS.moveText:
        Tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], Tlm);
        Tm = Tlm.slice();
        break;
      case OPS.setLeadingMoveText:
        gs.Tl = -num(a[1]);
        Tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], Tlm);
        Tm = Tlm.slice();
        break;
      case OPS.setTextMatrix:
        {
          const tm = a[0] && typeof a[0] === "object" ? a[0] : a;
          Tm = tm.length >= 6 ? Array.from(tm).slice(0, 6) : IDENT.slice();
        }
        Tlm = Tm.slice();
        break;
      case OPS.nextLine:
        Tlm = mul([1, 0, 0, 1, 0, -gs.Tl], Tlm);
        Tm = Tlm.slice();
        break;
      case OPS.showText:
        showText(a);
        break;
      case OPS.showSpacedText:
        showText([a[0]]);
        break;
      case OPS.nextLineShowText:
        Tlm = mul([1, 0, 0, 1, 0, -gs.Tl], Tlm);
        Tm = Tlm.slice();
        showText(a);
        break;
      case OPS.nextLineSetSpacingShowText:
        gs.Tw = num(a[0]);
        gs.Tc = num(a[1]);
        Tlm = mul([1, 0, 0, 1, 0, -gs.Tl], Tlm);
        Tm = Tlm.slice();
        showText([a[2]]);
        break;
      case OPS.shadingFill: {
        const ir = o.getPattern ? o.getPattern(a[0]) : null;
        const g = ir && ir[0] === 'RadialAxial' ? gradientFromIR(ir, gs.ctm) : null;
        stats.shadings++;
        if (!g) {
          warnings.add('A mesh or function shading was not imported.');
          break;
        }
        const cb = gs.clip.length ? gs.clip[gs.clip.length - 1].bbox : { x: 0, y: 0, w: P.w, h: P.h };
        const d = [['M', cb.x, cb.y], ['L', cb.x + cb.w, cb.y], ['L', cb.x + cb.w, cb.y + cb.h], ['L', cb.x, cb.y + cb.h], ['Z']];
        if (!hidden) {
          stats.paths++;
          items.push({ k: 'path', d, rule: 'nonzero', fill: { grad: g, color: g.stops[0].color }, stroke: null, alpha: gs.fillAlpha, blend: gs.blend, clip: gs.clip });
        }
        break;
      }
      case OPS.paintImageXObject:
        emitImage({ id: a[0], w: a[1], h: a[2], m: imageMatrix(a[1], a[2]) });
        break;
      case OPS.paintImageMaskXObject: {
        const im = a[0] && typeof a[0] === 'object' ? a[0] : { data: a[0], width: a[1], height: a[2] };
        const base = { w: im.width, h: im.height, m: imageMatrix(im.width, im.height), mask: true, color: gs.fill.color || '#000000' };
        if (typeof im.data === 'string') emitImage({ id: im.data, ...base });
        else emitImage({ data: im, ...base });
        break;
      }
      case OPS.paintInlineImageXObject:
        if (a[0] && a[0].data) emitImage({ data: a[0], w: a[0].width, h: a[0].height, m: imageMatrix(a[0].width, a[0].height), mask: !!a[0].imageMask, color: gs.fill.color || '#000000' });
        break;
      case OPS.paintImageXObjectRepeat: {
        // [id, w, h, scaleX, scaleY, positions]
        const pos = a[5] || [];
        for (let k = 0; k + 1 < pos.length; k += 2) {
          const save = gs.ctm;
          gs.ctm = mul([a[3], 0, 0, a[4], pos[k], pos[k + 1]], gs.ctm);
          emitImage({ id: a[0], w: a[1], h: a[2], m: imageMatrix(a[1], a[2]) });
          gs.ctm = save;
        }
        break;
      }
      case OPS.paintImageMaskXObjectGroup:
        for (const im of a[0] || []) {
          const save = gs.ctm;
          gs.ctm = mul(im.transform || IDENT, gs.ctm);
          emitImage({ id: im.objId, w: im.width, h: im.height, m: imageMatrix(im.width, im.height), mask: true, color: gs.fill.color || '#000000' });
          gs.ctm = save;
        }
        break;
      case OPS.paintSolidColorImageMask: {
        const d = [['M', ...apply(gs.ctm, 0, 0)], ['L', ...apply(gs.ctm, 1, 0)], ['L', ...apply(gs.ctm, 1, 1)], ['L', ...apply(gs.ctm, 0, 1)], ['Z']];
        emitPath(d, 'nonzero', true, false);
        break;
      }
      case OPS.paintFormXObjectBegin:
        stack.push({ ...gs });
        formStack.push(stack.length);
        if (Array.isArray(a[0]) && a[0].length >= 6) gs.ctm = mul(a[0], gs.ctm);
        if (a[1] && a[1].length >= 4) {
          const [x0, y0, x1, y1] = a[1];
          const d = [['M', ...apply(gs.ctm, x0, y0)], ['L', ...apply(gs.ctm, x1, y0)], ['L', ...apply(gs.ctm, x1, y1)], ['L', ...apply(gs.ctm, x0, y1)], ['Z']];
          addClip(d, 'nonzero');
        }
        break;
      case OPS.paintFormXObjectEnd:
        if (formStack.length) {
          formStack.pop();
          if (stack.length) gs = stack.pop();
        }
        break;
      case OPS.beginGroup:
        if (a[0] && a[0].smask) warnings.add('Soft masks (transparency masks) were not kept; masked content appears unmasked.');
        break;
      case OPS.beginMarkedContent:
        mcStack.push(false);
        break;
      case OPS.beginMarkedContentProps: {
        let hide = false;
        if (a[0] === 'OC' && o.isVisible) {
          try {
            hide = !o.isVisible(a[1]);
          } catch {
            hide = false;
          }
        }
        mcStack.push(hide);
        if (hide) hidden++;
        break;
      }
      case OPS.endMarkedContent:
        if (mcStack.length && mcStack.pop()) hidden--;
        break;
      default:
        break;
    }
  }
  items.forEach((it, i) => (it.z = i));
  if (stats.softMasks) warnings.add('Soft masks (transparency masks) were not kept; masked content appears unmasked.');
  if (stats.blend) warnings.add('Some blend modes were kept; knockout and isolated group behavior is approximated.');
  return { items, warnings, fontUse, stats };
}
