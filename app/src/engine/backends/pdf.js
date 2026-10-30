/**
 * PDF 1.7 backend: turns display lists (see docs/engine-contracts.md) into a PDF file.
 *
 * Features: page tree with MediaBox / TrimBox / BleedBox, optional crop marks, Flate compressed content streams,
 * path fill / stroke (nonzero and even-odd, caps, joins, miter limit, dashes), clipping, matrices, solid paint with
 * alpha (ExtGState), linear and radial gradients (shading types 2 and 3 with stitching functions; alpha stops through a
 * luminosity soft mask), conic gradients, images (Flate RGB with soft mask for RGBA, JPEG pass-through with the proper
 * color space), transparency groups (opacity, blend modes, isolation) as Form XObjects, text (base-14 fonts with
 * WinAnsi encoding or embedded TrueType / OpenType fonts with ToUnicode), document info and XMP metadata.
 *
 * Approximations:
 * - Conic gradients are drawn as 120 thin wedges clipped to the shape (with per-stop alpha, wedges are painted with
 *   constant alpha and may show hairline seams). Conic strokes and conic text fill use the average gradient color.
 * - Characters that a base-14 font cannot encode (outside WinAnsi) print as '?'. Without a `fontProvider` text is set in
 *   Helvetica / Times / Courier chosen by family-name heuristics; widths then follow the standard metrics, not the
 *   widths that the layout measured.
 * - Fonts whose license bits forbid embedding (OS/2 fsType restricted) and CFF2 / variable-CFF fonts fall back to base-14.
 *   TrueType fonts are subset (glyph ids kept); OpenType/CFF fonts are embedded whole.
 * - Underline and strike-through are drawn as rectangles from fixed proportions of the font size.
 * - Colors are DeviceRGB unless a paint carries native CMYK (`cmyk: [c,m,y,k]` in percent: DeviceCMYK) or a spot color
 *   (`spot: "Name"`: a Separation with a DeviceCMYK alternate, always painted at 100 % tint). With `color` every RGB
 *   color, gradient and image is converted to DeviceCMYK. Blend modes other than Normal need transparency support.
 * - `pdfx` writes the PDF/X-1a:2003 or PDF/X-4 identification (version header, GTS_PDFXVersion, Trapped, XMP, an
 *   OutputIntent with the given ICC profile). It does not make content conformant by itself: the caller flattens
 *   transparency for X-1a and runs the preflight (engine/color/preflight.js). Not validated by a PDF/X validator.
 *
 * @module pdf
 */

import { PdfWriter, num, pdfText, pdfDate, pdfName, latin1 } from './pdf-writer.js';
import { FontManager } from './pdf-fonts.js';
import { jpegInfo } from './jpeg-info.js';

/**
 * @typedef {Object} PdfOptions
 * @property {number} [pxPerInch=96]  display-list pixels per inch
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [subject]
 * @property {string|string[]} [keywords]
 * @property {string} [creator='OpenFini']   the application that created the document
 * @property {string} [producer='OpenFini']
 * @property {boolean} [compress=true]       Flate-compress streams
 * @property {(font: {family:string,size:number,weight:number,style:string}) => (Uint8Array|null|undefined)} [fontProvider]
 *   returns the TrueType / OpenType / WOFF file for a font, or null to use a base-14 font
 * @property {number} [bleed=0]              bleed in px: sets BleedBox / TrimBox and enlarges the MediaBox
 * @property {boolean} [cropMarks=false]     draw crop marks outside the bleed area (adds a slug to the MediaBox)
 * @property {Date} [creationDate]           defaults to now (pass a fixed date for reproducible output)
 * @property {{toCmyk:(r:number,g:number,b:number)=>number[], imageToCmyk:(rgb:Uint8Array)=>Uint8Array}} [color]
 *   convert all RGB colors and images to DeviceCMYK with these functions (0..1 values / bytes)
 * @property {{version:'x1a'|'x4', profile?:Uint8Array|null, identifier?:string, condition?:string, info?:string}} [pdfx]
 * @property {{fonts?:any[]}} [report] filled with the fonts used ({family, weight, style, embedded, kind})
 */

const BLEND = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

const CONIC_WEDGES = 120;
const MARK_GAP = 2.835; // 1 mm beyond the bleed
const MARK_LEN = 14.173; // 5 mm

// ---------------------------------------------------------------------------------------------------------------
// matrices and colors
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {[number, number, number, number, number, number]} Mat */
/** @type {Mat} */
const IDENT = [1, 0, 0, 1, 0, 0];

/**
 * Matrix product: the result applies `b` first and then `a` (canvas convention).
 * @param {Mat} a
 * @param {Mat} b
 * @returns {Mat}
 */
function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** @param {any} m @returns {Mat} */
function cleanMat(m) {
  if (!Array.isArray(m) || m.length < 6) return IDENT;
  const r = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    const v = Number(m[i]);
    if (!isFinite(v)) return IDENT;
    r[i] = v;
  }
  return /** @type {Mat} */ (r);
}

/** @param {Mat} m */
function isIdent(m) {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** @param {Mat} m */
function matStr(m) {
  return m.map(num).join(' ');
}

/**
 * @param {any} hex
 * @returns {{r:number,g:number,b:number,a:number}} components in 0..1
 */
function parseColor(hex) {
  let s = typeof hex === 'string' ? hex.trim().toLowerCase() : '';
  if (/^#[0-9a-f]{3,4}$/.test(s)) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/** @param {number} v */
const clamp01 = (v) => (v > 1 ? 1 : v >= 0 ? v : 0);
/** @param {{r:number,g:number,b:number}} c */
const rgbStr = (c) => `${num(c.r)} ${num(c.g)} ${num(c.b)}`;
const r4 = (v) => num(Math.round(v * 10000) / 10000);

/**
 * CMYK components (0..1) of a color: its native `cmyk` (percent), else the converted RGB when the document converts.
 * @param {Doc} doc
 * @param {{r:number,g:number,b:number,cmyk?:any}} p
 * @returns {number[]|null}
 */
function cmykOf(doc, p) {
  if (Array.isArray(p.cmyk) && p.cmyk.length === 4) return p.cmyk.map((v) => clamp01((Number(v) || 0) / 100));
  return doc.opts.color ? doc.opts.color.toCmyk(p.r, p.g, p.b).map(clamp01) : null;
}

/**
 * The fill or stroke color operator for a solid color (DeviceRGB, DeviceCMYK or a Separation).
 * @param {Content} c
 * @param {{r:number,g:number,b:number,cmyk?:any,spot?:any}} p
 * @param {boolean} stroke
 */
function colorOp(c, p, stroke) {
  const cm = cmykOf(c.doc, p);
  if (cm && typeof p.spot === 'string' && p.spot) {
    const name = c.colorspace(spotSpace(c.doc, p.spot, cm));
    return stroke ? `/${name} CS 1 SCN` : `/${name} cs 1 scn`;
  }
  if (cm) return `${cm.map(r4).join(' ')} ${stroke ? 'K' : 'k'}`;
  return `${rgbStr(p)} ${stroke ? 'RG' : 'rg'}`;
}

/**
 * A Separation color space with a DeviceCMYK alternate (cached by name).
 * @param {Doc} doc
 * @param {string} name
 * @param {number[]} cmyk
 */
function spotSpace(doc, name, cmyk) {
  let ref = doc.spots.get(name);
  if (!ref) {
    ref = doc.w.add(`[/Separation /${pdfName(name)} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${cmyk.map(r4).join(' ')}] /N 1 >>]`);
    doc.spots.set(name, ref);
  }
  return ref;
}

// ---------------------------------------------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------------------------------------------

/**
 * Serializes display-list path commands as PDF path operators (quadratics become cubics).
 * @param {any[]} d
 * @param {Mat} [tf] optional matrix applied to all coordinates
 * @returns {string}
 */
function pathOps(d, tf) {
  const out = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let open = false;
  const P = tf && !isIdent(tf) ? tf : null;
  const px = (x, y) => (P ? P[0] * x + P[2] * y + P[4] : x);
  const py = (x, y) => (P ? P[1] * x + P[3] * y + P[5] : y);
  const pt = (x, y) => `${num(px(x, y))} ${num(py(x, y))}`;
  for (const c of d || []) {
    switch (c[0]) {
      case 'M':
        cx = sx = +c[1];
        cy = sy = +c[2];
        out.push(`${pt(cx, cy)} m`);
        open = true;
        break;
      case 'L':
        if (!open) {
          cx = sx = +c[1];
          cy = sy = +c[2];
          out.push(`${pt(cx, cy)} m`);
          open = true;
        } else {
          cx = +c[1];
          cy = +c[2];
          out.push(`${pt(cx, cy)} l`);
        }
        break;
      case 'C':
        if (!open) {
          cx = sx = +c[1];
          cy = sy = +c[2];
          out.push(`${pt(cx, cy)} m`);
          open = true;
        }
        out.push(`${pt(+c[1], +c[2])} ${pt(+c[3], +c[4])} ${pt(+c[5], +c[6])} c`);
        cx = +c[5];
        cy = +c[6];
        break;
      case 'Q': {
        if (!open) {
          cx = sx = +c[1];
          cy = sy = +c[2];
          out.push(`${pt(cx, cy)} m`);
          open = true;
        }
        const qx = +c[1];
        const qy = +c[2];
        const x = +c[3];
        const y = +c[4];
        out.push(`${pt(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy))} ${pt(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y))} ${pt(x, y)} c`);
        cx = x;
        cy = y;
        break;
      }
      case 'Z':
        if (open) {
          out.push('h');
          cx = sx;
          cy = sy;
        }
        break;
      default:
        break;
    }
  }
  return out.join('\n');
}

/**
 * Bounding box of the control points of a path (optionally transformed).
 * @param {any[]} d
 * @param {Mat} [tf]
 * @returns {[number, number, number, number]|null}
 */
function pathBounds(d, tf) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const P = tf || IDENT;
  const add = (x, y) => {
    const tx = P[0] * x + P[2] * y + P[4];
    const ty = P[1] * x + P[3] * y + P[5];
    if (tx < x0) x0 = tx;
    if (tx > x1) x1 = tx;
    if (ty < y0) y0 = ty;
    if (ty > y1) y1 = ty;
  };
  for (const c of d || []) {
    for (let i = 1; i + 1 < c.length; i += 2) add(+c[i], +c[i + 1]);
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/**
 * @param {[number,number,number,number]|null} a
 * @param {[number,number,number,number]|null} b
 */
function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Transforms a bounding box by a matrix.
 * @param {[number,number,number,number]|null} b
 * @param {Mat} m
 */
function transformBounds(b, m) {
  if (!b) return null;
  const pts = [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    const tx = m[0] * x + m[2] * y + m[4];
    const ty = m[1] * x + m[3] * y + m[5];
    x0 = Math.min(x0, tx);
    x1 = Math.max(x1, tx);
    y0 = Math.min(y0, ty);
    y1 = Math.max(y1, ty);
  }
  return [x0, y0, x1, y1];
}

/**
 * Rough local bounds of a display-list item (used for group / soft mask boxes).
 * @param {any} it
 * @returns {[number,number,number,number]|null}
 */
function itemBounds(it) {
  if (!it) return null;
  const m = cleanMat(it.m);
  if (it.t === 'path') {
    const b = pathBounds(it.d);
    if (!b) return null;
    const pad = it.stroke ? Math.max(0, Number(it.stroke.width) || 0) * Math.max(1, Number(it.stroke.miterLimit) || 1) : 0;
    return transformBounds([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], m);
  }
  if (it.t === 'image' && it.img) return transformBounds([0, 0, it.img.width, it.img.height], m);
  if (it.t === 'text') {
    let b = null;
    for (const r of it.runs || []) {
      const s = Number(r.font && r.font.size) || 12;
      b = unionBounds(b, [r.x - s, r.y - s * 1.4, r.x + (Number(r.width) || 0) + s, r.y + s * 0.6]);
    }
    return transformBounds(b, m);
  }
  if (it.t === 'group') {
    let b = null;
    for (const c of it.items || []) b = unionBounds(b, itemBounds(c));
    if (it.clip) b = pathBounds(it.clip.d, cleanMat(it.clip.m)) || b;
    return transformBounds(b, m);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// content streams
// ---------------------------------------------------------------------------------------------------------------

/** One content stream with its own resource dictionary and a tracked current transformation matrix. */
class Content {
  /**
   * @param {Doc} doc
   */
  constructor(doc) {
    this.doc = doc;
    /** @type {string[]} */
    this.ops = [];
    /** @type {Map<string, string>} */
    this.gsMap = new Map();
    /** @type {Map<number, string>} */
    this.fontMap = new Map();
    /** @type {Map<number, string>} */
    this.xoMap = new Map();
    /** @type {Map<number, string>} */
    this.patMap = new Map();
    /** @type {Map<number, string>} */
    this.csMap = new Map();
    /** @type {Mat} */
    this.ctm = IDENT;
    /** @type {Mat[]} */
    this.stack = [];
  }

  q() {
    this.ops.push('q');
    this.stack.push(this.ctm);
  }

  Q() {
    this.ops.push('Q');
    this.ctm = this.stack.pop() || IDENT;
  }

  /** @param {Mat} m */
  cm(m) {
    if (isIdent(m)) return;
    this.ops.push(`${matStr(m)} cm`);
    this.ctm = mul(this.ctm, m);
  }

  /**
   * ExtGState name for a dictionary body.
   * @param {string} body
   */
  gs(body) {
    let n = this.gsMap.get(body);
    if (!n) {
      n = 'G' + (this.gsMap.size + 1);
      this.gsMap.set(body, n);
    }
    return n;
  }

  /** @param {number} ref */
  font(ref) {
    let n = this.fontMap.get(ref);
    if (!n) {
      n = 'F' + (this.fontMap.size + 1);
      this.fontMap.set(ref, n);
    }
    return n;
  }

  /** @param {number} ref @param {string} prefix */
  xobject(ref, prefix) {
    let n = this.xoMap.get(ref);
    if (!n) {
      n = prefix + (this.xoMap.size + 1);
      this.xoMap.set(ref, n);
    }
    return n;
  }

  /** @param {number} ref */
  pattern(ref) {
    let n = this.patMap.get(ref);
    if (!n) {
      n = 'P' + (this.patMap.size + 1);
      this.patMap.set(ref, n);
    }
    return n;
  }

  /** @param {number} ref */
  colorspace(ref) {
    let n = this.csMap.get(ref);
    if (!n) {
      n = 'CS' + (this.csMap.size + 1);
      this.csMap.set(ref, n);
    }
    return n;
  }

  /** Resource dictionary (direct). */
  resources() {
    let s = '<< /ProcSet [/PDF /Text /ImageB /ImageC /ImageI]';
    if (this.gsMap.size) s += ' /ExtGState << ' + [...this.gsMap].map(([b, n]) => `/${n} << ${b} >>`).join(' ') + ' >>';
    if (this.fontMap.size) s += ' /Font << ' + [...this.fontMap].map(([r, n]) => `/${n} ${r} 0 R`).join(' ') + ' >>';
    if (this.xoMap.size) s += ' /XObject << ' + [...this.xoMap].map(([r, n]) => `/${n} ${r} 0 R`).join(' ') + ' >>';
    if (this.patMap.size) s += ' /Pattern << ' + [...this.patMap].map(([r, n]) => `/${n} ${r} 0 R`).join(' ') + ' >>';
    if (this.csMap.size) s += ' /ColorSpace << ' + [...this.csMap].map(([r, n]) => `/${n} ${r} 0 R`).join(' ') + ' >>';
    return s + ' >>';
  }

  /** @returns {Uint8Array} */
  bytes() {
    return latin1(this.ops.join('\n') + '\n');
  }
}

/** Document-wide state shared by all pages. */
class Doc {
  /**
   * @param {PdfWriter} w
   * @param {ReturnType<typeof normalizeOptions>} opts
   */
  constructor(w, opts) {
    this.w = w;
    this.opts = opts;
    this.fonts = new FontManager(w, opts.fontProvider);
    /** @type {Map<string, {ref:number}|null>} */
    this.images = new Map();
    /** @type {Map<string, any>} */
    this.shadings = new Map();
    /** @type {Map<string, number>} */
    this.patterns = new Map();
    /** @type {Map<string, number>} */
    this.spots = new Map();
  }

  /**
   * @param {string} dictBody
   * @param {Uint8Array|string} data
   * @param {{filter?: string, compress?: boolean}} [o]
   */
  stream(dictBody, data, o) {
    return this.w.addStream(dictBody, data, { compress: this.opts.compress, ...(o || {}) });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// gradients
// ---------------------------------------------------------------------------------------------------------------

/**
 * Normalizes gradient stops (sorted, clamped, with implicit end stops).
 * @param {any[]} stops
 * @returns {{o:number, r:number, g:number, b:number, a:number}[]}
 */
function normStops(stops) {
  const s = (Array.isArray(stops) ? stops : [])
    .map((st) => {
      const c = parseColor(st && st.color);
      const al = st && st.alpha !== undefined && st.alpha !== null ? clamp01(Number(st.alpha)) : 1;
      const cmyk = st && Array.isArray(st.cmyk) && st.cmyk.length === 4 ? st.cmyk : undefined;
      return { o: clamp01(Number(st && st.o)), r: c.r, g: c.g, b: c.b, a: al * c.a, cmyk };
    })
    .sort((a, b) => a.o - b.o);
  if (!s.length) return s;
  if (s[0].o > 0) s.unshift({ ...s[0], o: 0 });
  if (s[s.length - 1].o < 1) s.push({ ...s[s.length - 1], o: 1 });
  return s;
}

/**
 * Color of the gradient at offset t.
 * @param {{o:number, r:number, g:number, b:number, a:number}[]} s
 * @param {number} t
 */
function colorAt(s, t) {
  if (t <= s[0].o) return s[0];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].o) {
      const a = s[i - 1];
      const b = s[i];
      const span = b.o - a.o;
      const k = span > 0 ? (t - a.o) / span : 1;
      return { o: t, r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k };
    }
  }
  return s[s.length - 1];
}

/**
 * Creates a PDF function (type 2 or a type 3 stitching function) over [0,1] for the given component lists.
 * @param {PdfWriter} w
 * @param {number[]} offsets ascending, first 0 and last 1
 * @param {number[][]} values component values per stop
 * @returns {number} object number
 */
function makeFunction(w, offsets, values) {
  const segs = [];
  for (let i = 0; i + 1 < offsets.length; i++) {
    segs.push(w.add(`<< /FunctionType 2 /Domain [0 1] /C0 [${values[i].map(num).join(' ')}] /C1 [${values[i + 1].map(num).join(' ')}] /N 1 >>`));
  }
  if (segs.length === 1) return segs[0];
  // interior bounds must increase strictly (hard color stops are nudged apart by a negligible amount)
  const k = offsets.length - 2;
  const eps = 0.0002;
  const bounds = [];
  let prev = 0;
  for (let i = 0; i < k; i++) {
    const b = Math.min(Math.max(offsets[i + 1], prev + eps), 1 - eps * (k - i));
    bounds.push(b);
    prev = b;
  }
  return w.add(
    `<< /FunctionType 3 /Domain [0 1] /Functions [${segs.map((r) => r + ' 0 R').join(' ')}] /Bounds [${bounds.map(num).join(' ')}] /Encode [${segs.map(() => '0 1').join(' ')}] >>`,
  );
}

/**
 * Builds (and caches) the shading objects of a gradient paint.
 * @param {Doc} doc
 * @param {any} paint
 * @returns {{sh:number, alphaSh:number|null}|{solid:{r:number,g:number,b:number,a:number}}|null}
 */
function makeShading(doc, paint) {
  const stops = normStops(paint.stops);
  if (!stops.length) return null;
  const last = stops[stops.length - 1];
  const solid = { r: last.r, g: last.g, b: last.b, a: last.a };
  if (!Array.isArray(paint.stops) || paint.stops.length < 2) return { solid };
  let coords;
  let type;
  if (paint.type === 'linear') {
    const { x0, y0, x1, y1 } = paint;
    if (![x0, y0, x1, y1].every(isFinite) || (x0 === x1 && y0 === y1)) return { solid };
    type = 2;
    coords = [x0, y0, x1, y1];
  } else {
    let { cx, cy, r, fx, fy } = paint;
    if (![cx, cy, r].every(isFinite) || !(r > 0)) return { solid };
    if (!isFinite(fx)) fx = cx;
    if (!isFinite(fy)) fy = cy;
    const dist = Math.hypot(fx - cx, fy - cy);
    if (dist >= r) {
      const k = (r * 0.999) / dist;
      fx = cx + (fx - cx) * k;
      fy = cy + (fy - cy) * k;
    }
    type = 3;
    coords = [fx, fy, 0, cx, cy, r];
  }
  const key = JSON.stringify([type, coords, stops]);
  const hit = doc.shadings.get(key);
  if (hit) return hit;
  const w = doc.w;
  const offs = stops.map((s) => s.o);
  const cmyk = doc.opts.color || stops.every((s) => s.cmyk);
  const colorFn = makeFunction(w, offs, stops.map((s) => (cmyk ? /** @type {number[]} */ (cmykOf(doc, s)) : [s.r, s.g, s.b])));
  const sh = w.add(`<< /ShadingType ${type} /ColorSpace /Device${cmyk ? 'CMYK' : 'RGB'} /Coords [${coords.map(num).join(' ')}] /Function ${colorFn} 0 R /Extend [true true] >>`);
  let alphaSh = null;
  if (stops.some((s) => s.a < 0.999)) {
    const alphaFn = makeFunction(w, offs, stops.map((s) => [s.a]));
    alphaSh = w.add(`<< /ShadingType ${type} /ColorSpace /DeviceGray /Coords [${coords.map(num).join(' ')}] /Function ${alphaFn} 0 R /Extend [true true] >>`);
  }
  const res = { sh, alphaSh };
  doc.shadings.set(key, res);
  return res;
}

/**
 * @typedef {{kind:'solid', r:number,g:number,b:number, alpha:number}
 *   | {kind:'pattern', name:string, smask:number|null}
 *   | {kind:'conic', stops:any[], cx:number, cy:number, angle:number}} PaintPrep
 */

/**
 * Prepares a paint for use in content stream `c` (creates shading, pattern and soft-mask objects).
 * @param {Content} c
 * @param {any} paint
 * @param {[number,number,number,number]|null} bounds local bounds of what will be painted
 * @param {boolean} forStroke conic paints cannot be used for strokes
 * @returns {PaintPrep|null}
 */
function preparePaint(c, paint, bounds, forStroke) {
  if (!paint) return null;
  if (paint.type === 'solid' || !paint.type) {
    const col = parseColor(paint.color);
    const a = clamp01((paint.alpha === undefined || paint.alpha === null ? 1 : Number(paint.alpha)) * col.a);
    return { kind: 'solid', r: col.r, g: col.g, b: col.b, alpha: isFinite(a) ? a : 1, cmyk: paint.cmyk, spot: paint.spot };
  }
  if (paint.type === 'conic') {
    const stops = normStops(paint.stops);
    if (!stops.length) return null;
    if (forStroke || stops.length < 2 || !bounds) {
      const avg = colorAt(stops, 0.5);
      return { kind: 'solid', r: avg.r, g: avg.g, b: avg.b, alpha: clamp01(avg.a) };
    }
    return { kind: 'conic', stops, cx: Number(paint.cx) || 0, cy: Number(paint.cy) || 0, angle: Number(paint.angle) || 0 };
  }
  if (paint.type === 'linear' || paint.type === 'radial') {
    const s = makeShading(c.doc, paint);
    if (!s) return null;
    if ('solid' in s) return { kind: 'solid', r: s.solid.r, g: s.solid.g, b: s.solid.b, alpha: clamp01(s.solid.a) };
    const m = c.ctm;
    const pkey = `${s.sh}|${matStr(m)}`;
    let pref = c.doc.patterns.get(pkey);
    if (!pref) {
      pref = c.doc.w.add(`<< /Type /Pattern /PatternType 2 /Shading ${s.sh} 0 R /Matrix [${matStr(m)}] >>`);
      c.doc.patterns.set(pkey, pref);
    }
    let smask = null;
    if (s.alphaSh !== null) {
      const b = bounds || [-1e5, -1e5, 1e5, 1e5];
      const bb = [b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2];
      const form = c.doc.w.addStream(
        `/Type /XObject /Subtype /Form /FormType 1 /BBox [${bb.map(num).join(' ')}] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Shading << /Sh0 ${s.alphaSh} 0 R >> >>`,
        '/Sh0 sh\n',
        { compress: false },
      );
      smask = c.doc.w.add(`<< /Type /Mask /S /Luminosity /G ${form} 0 R >>`);
    }
    return { kind: 'pattern', name: c.pattern(pref), smask };
  }
  return null;
}

/**
 * Emits the color-setting operator of a prepared paint.
 * @param {Content} c
 * @param {PaintPrep} p
 * @param {boolean} stroke
 */
function setColor(c, p, stroke) {
  if (p.kind === 'solid') c.ops.push(colorOp(c, p, stroke));
  else if (p.kind === 'pattern') c.ops.push(`/Pattern ${stroke ? 'CS' : 'cs'} /${p.name} ${stroke ? 'SCN' : 'scn'}`);
}

/**
 * Emits an ExtGState for alpha / soft mask when needed.
 * @param {Content} c
 * @param {number} ca fill alpha
 * @param {number} CA stroke alpha
 * @param {number|null} smask
 */
function setAlpha(c, ca, CA, smask) {
  if (ca >= 0.9999 && CA >= 0.9999 && smask === null) return;
  let body = '/Type /ExtGState';
  if (ca < 0.9999) body += ` /ca ${num(Math.round(ca * 10000) / 10000)}`;
  if (CA < 0.9999) body += ` /CA ${num(Math.round(CA * 10000) / 10000)}`;
  if (smask !== null) body += ` /SMask ${smask} 0 R`;
  c.ops.push(`/${c.gs(body)} gs`);
}

/**
 * Emits the line style operators.
 * @param {Content} c
 * @param {any} st stroke definition
 */
function setStrokeStyle(c, st) {
  const w = Number(st.width);
  c.ops.push(`${num(w > 0 ? w : 0)} w`);
  c.ops.push(`${st.cap === 'round' ? 1 : st.cap === 'square' ? 2 : 0} J`);
  c.ops.push(`${st.join === 'round' ? 1 : st.join === 'bevel' ? 2 : 0} j`);
  const ml = Number(st.miterLimit);
  c.ops.push(`${num(ml >= 1 ? ml : 10)} M`);
  const dash = Array.isArray(st.dash) ? st.dash.map(Number).filter((v) => isFinite(v) && v >= 0) : [];
  if (dash.length && dash.some((v) => v > 0)) c.ops.push(`[${dash.map(num).join(' ')}] ${num(Number(st.dashOffset) || 0)} d`);
  else c.ops.push('[] 0 d');
}

/**
 * Paints a conic gradient as wedges clipped to the path already emitted by `emitClip`.
 * @param {Content} c
 * @param {Extract<PaintPrep, {kind:'conic'}>} p
 * @param {[number,number,number,number]} bounds
 */
function paintConic(c, p, bounds) {
  const { cx, cy, angle, stops } = p;
  const R = Math.max(
    Math.hypot(bounds[0] - cx, bounds[1] - cy),
    Math.hypot(bounds[2] - cx, bounds[1] - cy),
    Math.hypot(bounds[2] - cx, bounds[3] - cy),
    Math.hypot(bounds[0] - cx, bounds[3] - cy),
  ) + 2;
  const N = CONIC_WEDGES;
  const step = (Math.PI * 2) / N;
  const rr = R / Math.cos(step / 2);
  const hasAlpha = stops.some((s) => s.a < 0.999);
  const over = hasAlpha ? 0 : step * 0.5;
  for (let i = 0; i < N; i++) {
    const col = colorAt(stops, (i + 0.5) / N);
    const a0 = angle + i * step;
    const a1 = a0 + step + over;
    c.ops.push('q');
    c.ops.push(colorOp(c, col, false));
    if (col.a < 0.9999) setAlpha(c, clamp01(col.a), clamp01(col.a), null);
    c.ops.push(`${num(cx)} ${num(cy)} m ${num(cx + rr * Math.cos(a0))} ${num(cy + rr * Math.sin(a0))} l ${num(cx + rr * Math.cos(a1))} ${num(cy + rr * Math.sin(a1))} l h f`);
    c.ops.push('Q');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {Content} c
 * @param {any[]} items
 */
function drawItems(c, items) {
  if (!Array.isArray(items)) return;
  for (const it of items) {
    if (!it) continue;
    if (it.t === 'path') drawPath(c, it);
    else if (it.t === 'text') drawText(c, it);
    else if (it.t === 'image') drawImage(c, it);
    else if (it.t === 'group') drawGroup(c, it);
    // 'adjust' items are raster only and never reach the PDF
  }
}

/**
 * @param {Content} c
 * @param {any} it
 */
function drawPath(c, it) {
  const stroke = it.stroke && it.stroke.paint && Number(it.stroke.width) > 0 ? it.stroke : null;
  if (!it.fill && !stroke) return;
  const d = it.d;
  if (!Array.isArray(d) || !d.length) return;
  const rule = it.rule === 'evenodd';
  const bounds = pathBounds(d);
  if (!bounds) return;
  const pad = stroke ? Number(stroke.width) * Math.max(1, Number(stroke.miterLimit) || 1) + 1 : 1;
  const sbounds = /** @type {[number,number,number,number]} */ ([bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad]);
  c.q();
  c.cm(cleanMat(it.m));
  const fp = it.fill ? preparePaint(c, it.fill, bounds, false) : null;
  const sp = stroke ? preparePaint(c, stroke.paint, sbounds, true) : null;
  const ops = pathOps(d);
  const fillOp = rule ? 'f*' : 'f';
  const bothOp = rule ? 'B*' : 'B';
  const simpleFill = !fp || fp.kind === 'solid';
  const simpleStroke = !sp || sp.kind === 'solid';
  if (simpleFill && simpleStroke) {
    if (fp) setColor(c, fp, false);
    if (sp) {
      setColor(c, sp, true);
      setStrokeStyle(c, stroke);
    }
    setAlpha(c, fp ? /** @type {any} */ (fp).alpha : 1, sp ? /** @type {any} */ (sp).alpha : 1, null);
    c.ops.push(ops);
    c.ops.push(fp && sp ? bothOp : fp ? fillOp : 'S');
  } else {
    if (fp) {
      c.q();
      if (fp.kind === 'conic') {
        c.ops.push(ops);
        c.ops.push(rule ? 'W* n' : 'W n');
        paintConic(c, fp, bounds);
      } else {
        setColor(c, fp, false);
        if (fp.kind === 'solid') setAlpha(c, fp.alpha, fp.alpha, null);
        else setAlpha(c, 1, 1, fp.smask);
        c.ops.push(ops);
        c.ops.push(fillOp);
      }
      c.Q();
    }
    if (sp) {
      c.q();
      setColor(c, sp, true);
      setStrokeStyle(c, stroke);
      if (sp.kind === 'solid') setAlpha(c, sp.alpha, sp.alpha, null);
      else if (sp.kind === 'pattern') setAlpha(c, 1, 1, sp.smask);
      c.ops.push(ops);
      c.ops.push('S');
      c.Q();
    }
  }
  c.Q();
}

/**
 * @param {Content} c
 * @param {any} it
 */
function drawText(c, it) {
  const runs = Array.isArray(it.runs) ? it.runs : [];
  if (!runs.length) return;
  const doc = c.doc;
  c.q();
  c.cm(cleanMat(it.m));
  for (const run of runs) {
    if (!run || typeof run.text !== 'string' || !run.text) continue;
    const font = run.font || { family: 'Helvetica', size: 12, weight: 400, style: 'normal' };
    const size = Number(font.size);
    if (!(size > 0) || !isFinite(size)) continue;
    const x = Number(run.x) || 0;
    const y = Number(run.y) || 0;
    const width = Number(run.width) || 0;
    const stroke = run.stroke && run.stroke.paint && Number(run.stroke.width) > 0 ? run.stroke : null;
    if (!run.fill && !stroke) continue;
    const bounds = /** @type {[number,number,number,number]} */ ([x - size, y - size * 1.4, x + width + size, y + size * 0.6]);
    const entry = doc.fonts.get(font);
    const str = doc.fonts.encode(entry, run.text);
    c.q();
    const fp = run.fill ? preparePaint(c, run.fill, bounds, true) : null;
    const sp = stroke ? preparePaint(c, stroke.paint, bounds, true) : null;
    const smask = (fp && fp.kind === 'pattern' && fp.smask) || (sp && sp.kind === 'pattern' && sp.smask) || null;
    const fa = fp && fp.kind === 'solid' ? fp.alpha : 1;
    const sa = sp && sp.kind === 'solid' ? sp.alpha : 1;
    if (fp) setColor(c, fp, false);
    if (sp) {
      setColor(c, sp, true);
      setStrokeStyle(c, stroke);
    }
    setAlpha(c, fa, sp ? sa : fa, smask);
    if (str) {
      const ls = Number(run.letterSpacing) || 0;
      const mode = fp && sp ? 2 : sp ? 1 : 0;
      c.ops.push('BT');
      c.ops.push(`/${c.font(entry.ref)} ${num(size)} Tf`);
      if (ls) c.ops.push(`${num(ls)} Tc`);
      if (mode) c.ops.push(`${mode} Tr`);
      c.ops.push(`1 0 0 -1 ${num(x)} ${num(y)} Tm`);
      c.ops.push(`${str} Tj`);
      c.ops.push('ET');
    }
    if ((run.underline || run.strike) && width > 0) {
      const deco = fp || sp;
      if (deco) {
        if (!fp && sp) setColor(c, sp, false);
        const th = Math.max(size * 0.06, 0.5);
        if (run.underline) c.ops.push(`${num(x)} ${num(y + size * 0.1)} ${num(width)} ${num(th)} re f`);
        if (run.strike) c.ops.push(`${num(x)} ${num(y - size * 0.28 - th / 2)} ${num(width)} ${num(th)} re f`);
      }
    }
    c.Q();
  }
  c.Q();
}

/**
 * Builds (and caches by image id) an image XObject.
 * @param {Doc} doc
 * @param {any} img
 * @param {boolean} smooth
 * @returns {number|null} object number
 */
function getImage(doc, img, smooth) {
  const key = `${img.id}|${smooth ? 1 : 0}`;
  if (doc.images.has(key)) {
    const e = doc.images.get(key);
    return e ? e.ref : null;
  }
  let ref = null;
  const interp = smooth ? ' /Interpolate true' : '';
  const conv = doc.opts.color;
  if (img.jpeg instanceof Uint8Array) {
    const info = jpegInfo(img.jpeg);
    // when converting to CMYK, RGB JPEGs are decoded pixels below (img.rgba) instead of passed through
    if (info && !(conv && info.components === 3 && img.rgba)) {
      const cs = info.components === 1 ? '/DeviceGray' : info.components === 3 ? '/DeviceRGB' : '/DeviceCMYK';
      const decode = info.invertedCMYK ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      ref = doc.w.addStream(
        `/Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8${decode}${interp}`,
        img.jpeg,
        { filter: '/DCTDecode', compress: false },
      );
    }
  }
  if (ref === null && img.rgba && img.width > 0 && img.height > 0 && img.rgba.length >= img.width * img.height * 4) {
    const n = img.width * img.height;
    const rgb = new Uint8Array(n * 3);
    const alpha = new Uint8Array(n);
    const src = img.rgba;
    let translucent = false;
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
      rgb[k] = src[j];
      rgb[k + 1] = src[j + 1];
      rgb[k + 2] = src[j + 2];
      const a = src[j + 3];
      alpha[i] = a;
      if (a !== 255) translucent = true;
    }
    let smaskRef = '';
    if (translucent) {
      const sm = doc.stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8${interp}`, alpha);
      smaskRef = ` /SMask ${sm} 0 R`;
    }
    const data = conv ? conv.imageToCmyk(rgb) : rgb;
    ref = doc.stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /Device${conv ? 'CMYK' : 'RGB'} /BitsPerComponent 8${interp}${smaskRef}`, data);
  }
  doc.images.set(key, ref === null ? null : { ref });
  return ref;
}

/**
 * @param {Content} c
 * @param {any} it
 */
function drawImage(c, it) {
  const img = it.img;
  if (!img || !(img.width > 0) || !(img.height > 0)) return;
  const ref = getImage(c.doc, img, !!it.smooth);
  if (ref === null) return;
  c.q();
  c.cm(mul(cleanMat(it.m), [img.width, 0, 0, -img.height, 0, img.height]));
  c.ops.push(`/${c.xobject(ref, 'Im')} Do`);
  c.Q();
}

/**
 * @param {Content} c
 * @param {any} it
 */
function drawGroup(c, it) {
  const items = Array.isArray(it.items) ? it.items : [];
  const opacity = it.opacity === undefined || it.opacity === null ? 1 : clamp01(Number(it.opacity));
  const blend = BLEND[it.blend] || 'Normal';
  const needForm = opacity < 0.9999 || blend !== 'Normal' || !!it.isolate;
  const clip = it.clip && Array.isArray(it.clip.d) && it.clip.d.length ? it.clip : null;
  const clipOps = clip ? pathOps(clip.d, cleanMat(clip.m)) + '\n' + (clip.rule === 'evenodd' ? 'W* n' : 'W n') : '';
  c.q();
  c.cm(cleanMat(it.m));
  if (!needForm) {
    if (clipOps) c.ops.push(clipOps);
    drawItems(c, items);
  } else {
    if (opacity <= 0.0001 && blend === 'Normal') {
      c.Q();
      return;
    }
    const f = new Content(c.doc);
    if (clipOps) f.ops.push(clipOps);
    drawItems(f, items);
    let bounds = clip ? pathBounds(clip.d, cleanMat(clip.m)) : null;
    if (!bounds) {
      for (const child of items) bounds = unionBounds(bounds, itemBounds(child));
    }
    const b = bounds || [-1e5, -1e5, 1e5, 1e5];
    const bb = [b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2];
    const form = c.doc.stream(
      `/Type /XObject /Subtype /Form /FormType 1 /BBox [${bb.map(num).join(' ')}] /Group << /S /Transparency /I ${it.isolate ? 'true' : 'false'} /K false >> /Resources ${f.resources()}`,
      f.bytes(),
    );
    let gsBody = '/Type /ExtGState';
    if (opacity < 0.9999) gsBody += ` /ca ${num(Math.round(opacity * 10000) / 10000)} /CA ${num(Math.round(opacity * 10000) / 10000)}`;
    gsBody += ` /BM /${blend} /AIS false`;
    c.ops.push(`/${c.gs(gsBody)} gs`);
    c.ops.push(`/${c.xobject(form, 'Fm')} Do`);
  }
  c.Q();
}

// ---------------------------------------------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {PdfOptions} o
 */
function normalizeOptions(o) {
  const opts = o || {};
  const ppi = Number(opts.pxPerInch) > 0 ? Number(opts.pxPerInch) : 96;
  const kw = Array.isArray(opts.keywords) ? opts.keywords.join(', ') : opts.keywords;
  return {
    ppi,
    scale: 72 / ppi,
    title: opts.title,
    author: opts.author,
    subject: opts.subject,
    keywords: kw,
    creator: opts.creator === undefined ? 'OpenFini' : opts.creator,
    producer: opts.producer === undefined ? 'OpenFini' : opts.producer,
    compress: opts.compress !== false,
    fontProvider: typeof opts.fontProvider === 'function' ? opts.fontProvider : undefined,
    bleed: Number(opts.bleed) > 0 ? Number(opts.bleed) : 0,
    cropMarks: !!opts.cropMarks,
    creationDate: opts.creationDate instanceof Date && !isNaN(+opts.creationDate) ? opts.creationDate : new Date(),
    color: opts.color && typeof opts.color.toCmyk === 'function' ? opts.color : null,
    pdfx: opts.pdfx && (opts.pdfx.version === 'x1a' || opts.pdfx.version === 'x4') ? opts.pdfx : null,
    report: opts.report && typeof opts.report === 'object' ? opts.report : null,
  };
}

/** @param {string} s */
const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] || c);

/**
 * Minimal XMP packet (UTF-8).
 * @param {ReturnType<typeof normalizeOptions>} o
 * @returns {Uint8Array}
 */
function buildXMP(o) {
  const iso = o.creationDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bom = String.fromCharCode(0xfeff);
  const alt = (v) => `<rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(v)}</rdf:li></rdf:Alt>`;
  let desc = '';
  if (o.title) desc += `<dc:title>${alt(o.title)}</dc:title>`;
  if (o.author) desc += `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(o.author)}</rdf:li></rdf:Seq></dc:creator>`;
  if (o.subject) desc += `<dc:description>${alt(o.subject)}</dc:description>`;
  if (o.keywords) desc += `<pdf:Keywords>${xmlEscape(o.keywords)}</pdf:Keywords>`;
  if (o.producer) desc += `<pdf:Producer>${xmlEscape(o.producer)}</pdf:Producer>`;
  if (o.creator) desc += `<xmp:CreatorTool>${xmlEscape(o.creator)}</xmp:CreatorTool>`;
  desc += `<xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:MetadataDate>${iso}</xmp:MetadataDate>`;
  if (o.pdfx) {
    const id = pdfxId(o);
    desc += `<pdf:Trapped>False</pdf:Trapped><pdfxid:GTS_PDFXVersion>${PDFX[o.pdfx.version].version}</pdfxid:GTS_PDFXVersion>`;
    if (o.pdfx.version === 'x1a') desc += `<pdfx:GTS_PDFXVersion>${PDFX.x1a.version}</pdfx:GTS_PDFXVersion><pdfx:GTS_PDFXConformance>${PDFX.x1a.conformance}</pdfx:GTS_PDFXConformance>`;
    desc += `<xmpMM:DocumentID>uuid:${id}</xmpMM:DocumentID><xmpMM:InstanceID>uuid:${id}</xmpMM:InstanceID><xmpMM:VersionID>1</xmpMM:VersionID><xmpMM:RenditionClass>default</xmpMM:RenditionClass>`;
  }
  const xml =
    `<?xpacket begin="${bom}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"' +
    (o.pdfx ? ' xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"' : '') +
    '>' +
    desc +
    '</rdf:Description></rdf:RDF></x:xmpmeta>\n' +
    ' '.repeat(64) +
    '\n<?xpacket end="w"?>';
  return new TextEncoder().encode(xml);
}

/** PDF/X identification per version: header version, GTS_PDFXVersion, GTS_PDFXConformance. */
const PDFX = {
  x1a: { pdf: '1.4', version: 'PDF/X-1:2003', conformance: 'PDF/X-1a:2003' },
  x4: { pdf: '1.6', version: 'PDF/X-4', conformance: '' },
};

/** Deterministic UUID-shaped document id (from title and date). @param {ReturnType<typeof normalizeOptions>} o */
function pdfxId(o) {
  let h = 0x811c9dc5;
  let hex = '';
  const src = `${o.title || ''}|${o.creationDate.toISOString()}`;
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < src.length; i++) h = Math.imul(h ^ (src.charCodeAt(i) + r), 16777619);
    hex += (h >>> 0).toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Creates a PDF from display lists, one page per list.
 *
 * Page size is the display list size converted with `options.pxPerInch` (default 96, so 96 px = 1 inch = 72 pt).
 * With `bleed` the MediaBox grows by the bleed on every side and TrimBox marks the original page; BleedBox is the
 * trim plus the bleed. With `cropMarks` a further slug holding the marks is added around the bleed box and artwork
 * is clipped to the bleed box.
 *
 * @param {{width:number, height:number, items:any[]}[]} pages display lists, y down (see docs/engine-contracts.md)
 * @param {PdfOptions} [options]
 * @returns {Uint8Array} the PDF file
 */
export function createPDF(pages, options) {
  const opts = normalizeOptions(options || {});
  const w = new PdfWriter(opts.pdfx ? PDFX[opts.pdfx.version].pdf : undefined);
  const doc = new Doc(w, opts);
  const list = Array.isArray(pages) && pages.length ? pages : [{ width: 595.2756, height: 841.8898, items: [] }];

  const catalogRef = w.reserve();
  const pagesRef = w.reserve();
  const infoRef = w.reserve();
  const metaRef = w.reserve();
  const pageRefs = [];

  for (const dl of list) {
    const s = opts.scale;
    const trimW = Math.max(1, Number(dl && dl.width) || 1) * s;
    const trimH = Math.max(1, Number(dl && dl.height) || 1) * s;
    const bleedPt = opts.bleed * s;
    const slug = opts.cropMarks ? bleedPt + MARK_GAP + MARK_LEN : bleedPt;
    const mediaW = trimW + 2 * slug;
    const mediaH = trimH + 2 * slug;
    const c = new Content(doc);
    if (opts.cropMarks) {
      // keep artwork inside the bleed box, away from the marks
      c.q();
      c.ops.push(`${num(slug - bleedPt)} ${num(slug - bleedPt)} ${num(trimW + 2 * bleedPt)} ${num(trimH + 2 * bleedPt)} re W n`);
    }
    c.q();
    c.cm([s, 0, 0, -s, slug, slug + trimH]);
    drawItems(c, dl && dl.items);
    c.Q();
    if (opts.cropMarks) {
      c.Q();
      const gap = bleedPt + MARK_GAP;
      c.ops.push(opts.color ? 'q 0.25 w 1 1 1 1 K' : 'q 0.25 w 0 G');
      for (const cx of [slug, slug + trimW]) {
        for (const cy of [slug, slug + trimH]) {
          const sx = cx === slug ? -1 : 1;
          const sy = cy === slug ? -1 : 1;
          c.ops.push(`${num(cx + sx * gap)} ${num(cy)} m ${num(cx + sx * (gap + MARK_LEN))} ${num(cy)} l S`);
          c.ops.push(`${num(cx)} ${num(cy + sy * gap)} m ${num(cx)} ${num(cy + sy * (gap + MARK_LEN))} l S`);
        }
      }
      c.ops.push('Q');
    }
    const content = doc.stream('', c.bytes());
    const box = (a, b, cc, d) => `[${num(a)} ${num(b)} ${num(cc)} ${num(d)}]`;
    const page = w.add(
      `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox ${box(0, 0, mediaW, mediaH)} /TrimBox ${box(slug, slug, slug + trimW, slug + trimH)} /BleedBox ${box(slug - bleedPt, slug - bleedPt, slug + trimW + bleedPt, slug + trimH + bleedPt)} /Resources ${c.resources()} /Contents ${content} 0 R${opts.pdfx && opts.pdfx.version === 'x1a' ? '' : ` /Group << /S /Transparency /CS /Device${opts.color ? 'CMYK' : 'RGB'} >>`} >>`,
    );
    pageRefs.push(page);
  }

  doc.fonts.finish();
  if (opts.report) {
    opts.report.fonts = [...doc.fonts.providerCache].map(([k, e]) => {
      const [family, weight, style] = k.split('\u0000');
      return { family, weight: Number(weight), style, embedded: !!e, kind: e ? e.kind : 'std' };
    });
    if (!doc.fonts.provider) for (const e of doc.fonts.entries.values()) if (e.kind === 'std') opts.report.fonts.push({ family: e.ps, embedded: false, kind: 'std' });
  }

  w.set(pagesRef, `<< /Type /Pages /Kids [${pageRefs.map((r) => r + ' 0 R').join(' ')}] /Count ${pageRefs.length} >>`);
  let info = '<<';
  if (opts.title) info += ` /Title ${pdfText(opts.title)}`;
  if (opts.author) info += ` /Author ${pdfText(opts.author)}`;
  if (opts.subject) info += ` /Subject ${pdfText(opts.subject)}`;
  if (opts.keywords) info += ` /Keywords ${pdfText(opts.keywords)}`;
  if (opts.creator) info += ` /Creator ${pdfText(opts.creator)}`;
  if (opts.producer) info += ` /Producer ${pdfText(opts.producer)}`;
  const date = pdfDate(opts.creationDate);
  info += ` /CreationDate (${date}) /ModDate (${date})`;
  let intents = '';
  if (opts.pdfx) {
    const x = opts.pdfx;
    const id = PDFX[x.version];
    info += ` /GTS_PDFXVersion (${id.version})${id.conformance ? ` /GTS_PDFXConformance (${id.conformance})` : ''} /Trapped /False`;
    let oi = `<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${pdfText(x.identifier || 'Custom')}`;
    if (x.condition) oi += ` /OutputCondition ${pdfText(x.condition)}`;
    if (x.info) oi += ` /Info ${pdfText(x.info)}`;
    oi += ' /RegistryName (http://www.color.org)';
    if (x.profile instanceof Uint8Array && x.profile.length) oi += ` /DestOutputProfile ${doc.stream('/N 4', x.profile)} 0 R`;
    intents = ` /OutputIntents [${w.add(oi + ' >>')} 0 R]`;
  }
  w.set(infoRef, info + ' >>');
  w.set(metaRef, w.streamBody('/Type /Metadata /Subtype /XML', buildXMP(opts), { compress: false }));
  w.set(catalogRef, `<< /Type /Catalog /Pages ${pagesRef} 0 R /Metadata ${metaRef} 0 R${intents} >>`);
  return w.finish(`/Root ${catalogRef} 0 R /Info ${infoRef} 0 R`);
}

