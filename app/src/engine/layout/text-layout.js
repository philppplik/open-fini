/**
 * Text layout engine behind the Layout studio: flows a {@link Story} through a chain of frames (with columns,
 * insets, exclusion rects and baseline grids) and returns positioned lines and runs.
 *
 * The engine is pure (no DOM / canvas). The host supplies text measurement through `opts.measure` /
 * `opts.metrics`; {@link approxMeasurer} and {@link makeSfntMeasurer} are provided for tests, Node and
 * font-file based hosts.
 *
 * ### Coordinates
 * All coordinates in the result (line.x, line.y, run.x, caret rects, ...) are in the SAME space as the frame
 * rectangles passed in (`frames[i].x/y`). Pass frames with `x = y = 0` to obtain frame-local coordinates. `line.y`
 * is the top of the line box, `line.baseline` the baseline; `run.x` is the origin of the first glyph.
 *
 * ### Offsets
 * Every offset is a story offset (see text-model.js). `line.charStart/charEnd` delimit the characters a line
 * shows: `charEnd` is exclusive. The paragraph break between paragraphs belongs to no line; consecutive lines of the
 * same paragraph satisfy `next.charStart === prev.charEnd`, and the first line of the next paragraph starts at
 * `charEnd + 1` of the last line of the previous one.
 *
 * ### Runs
 * `line.runs` carry what a host needs to emit display-list text runs directly. Runs with an empty `text` are
 * placeholders (tab gaps, zero-width characters) that keep character offsets exact: a host skips them when painting.
 * A hyphen added at a hyphenation break is a separate run with `hyphen: true` and no source characters
 * (`charStart === charEnd`); tab leaders are runs with `leader: true`. Justified lines are emitted as word runs and
 * space runs (spaces carry the expansion in their `width`), so no word spacing property is needed to paint them.
 *
 * ### Approximations (documented on purpose)
 * - Line breaking is greedy (first fit), not Knuth-Plass; it gives predictable results with exclusions, drop caps
 *   and chained frames. Hyphenation (`opts.hyphenate`) is applied only when a word would overflow the line.
 * - Kerning across fragment boundaries (word / space / run edges) is not applied; inside a run the measurer decides.
 * - Widow/orphan control is exact between columns/frames; when the text overflows the last frame only the orphan
 *   rule and `keepLinesTogether` can be applied (the number of overflowed lines is unknown).
 * - Bidirectional text and complex shaping (ligatures, Indic reordering) are not handled.
 *
 * @module text-layout
 */

import { createStyleResolver, DEFAULTS, storyLength } from './text-model.js';
import { findBreaks, isBreakingSpace, isExpandableSpace, isClusterStart, nextCluster } from './line-break.js';
import { approxMeasurer, makeSfntMeasurer } from './measurers.js';

export { approxMeasurer, makeSfntMeasurer, findBreaks };
export {
  offsetToCaret,
  hitTest,
  hitTestEx,
  selectionRects,
  moveCaretVertical,
  lineStart,
  lineEnd,
  wordBoundary,
} from './text-caret.js';

/**
 * @typedef {Object} Frame
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} [columns=1]
 * @property {number} [gutter=12]
 * @property {{top?:number,right?:number,bottom?:number,left?:number}} [insets]
 * @property {{offset:number, spacing:number}} [baselineGrid] grid lines at `frame.y + offset + k*spacing`
 * @property {{x:number,y:number,w:number,h:number,margin?:number,jump?:boolean}[]} [exclusions] text wraps around
 *   these rects; `jump: true` keeps the whole column width free beside the rect (text jumps over it)
 * @property {'top'|'center'|'bottom'|'justify'} [verticalAlign='top'] ignored for frames with exclusions
 * @property {boolean} [autoHeight] the frame grows to fit the text (single column stream, no vertical flow)
 */

/**
 * @typedef {Object} LayoutOptions
 * @property {(font: import('./measurers.js').FontSpec, text: string) => number} [measure]
 * @property {(font: import('./measurers.js').FontSpec) => import('./measurers.js').FontMetrics} [metrics]
 * @property {object} [styles] document styles
 * @property {object} [defaults] resolution defaults (see text-model DEFAULTS)
 * @property {Record<string, string|number>} [fields] values for `attrs.field` runs
 * @property {(word: string) => string[]} [hyphenate] e.g. `createHyphenator()`; used for paragraphs with `hyphenate: true`
 * @property {number} [defaultTabWidth=48] spacing of the implicit tab grid in px
 * @property {number} [hyphenMinWord=5] shortest word that is hyphenated
 * @property {number} [maxConsecutiveHyphens=3]
 * @property {number} [smallCapsScale=0.8] size of small capitals relative to the text size
 */

/**
 * @typedef {Object} LayoutRun
 * @property {string} text
 * @property {number} x
 * @property {number} width
 * @property {{family:string,size:number,weight:number,style:'normal'|'italic'}} font
 * @property {string} color
 * @property {boolean} underline
 * @property {boolean} strike
 * @property {number} tracking       1/1000 em
 * @property {number} letterSpacing  px (tracking converted for the font size)
 * @property {number} baselineShift  px, positive = up
 * @property {number} charStart      story offset
 * @property {number} charEnd        story offset (exclusive); equals charStart for synthetic runs
 */

/**
 * @typedef {Object} LayoutLine
 * @property {number} x
 * @property {number} y        top of the line box
 * @property {number} baseline
 * @property {number} width    visible width (trailing spaces excluded)
 * @property {number} left     x of the left end of everything on the line (the drop cap starts left of `x`)
 * @property {number} right    x of the right end of everything on the line, hanging spaces included
 * @property {number} height
 * @property {number} ascent   baseline - y
 * @property {number} descent  y + height - baseline
 * @property {number} para     paragraph index
 * @property {number} charStart
 * @property {number} charEnd
 * @property {LayoutRun[]} runs
 * @property {LayoutRun} [bullet]
 * @property {boolean} justified
 * @property {boolean} last    last line of its paragraph
 * @property {boolean} hard    ends with a forced line break (U+2028)
 * @property {number} hang     number of hanging trailing space characters
 * @property {number} lineInPara
 * @property {number} frame
 * @property {number} column
 */

/**
 * @typedef {Object} LayoutFrameResult
 * @property {number} index
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h            grown to fit for `autoHeight` frames
 * @property {LayoutLine[]} lines
 * @property {number} usedHeight   extent of the text below the top inset
 * @property {boolean} overflow    story text remains after this frame
 * @property {number} firstChar    story offset of the first character shown here
 * @property {number} lastChar     story offset right after the last character shown here
 * @property {{x:number,w:number,top:number,bottom:number,first:number,count:number}[]} columns
 */

/**
 * @typedef {Object} LayoutResult
 * @property {LayoutFrameResult[]} frames
 * @property {number} endOffset  story offset of the first character that was not laid out (`storyLength` if all fit)
 * @property {boolean} overflow  true if story text remains after the last frame
 */

const K_TEXT = 0;
const K_SPACE = 1;
const K_TAB = 2;
const K_LS = 3;
const K_ZW = 4;
const EPS = 1e-4;
const NBSP = '\u{a0}';
const RE_LETTER = /^\p{L}$/u;

/** @type {WeakMap<Function, Map<string, number>>} */
let widthCaches = new WeakMap();
/** @type {WeakMap<object, any>} */
let prepCache = new WeakMap();

/**
 * Drops all caches kept between layout calls (measured widths and prepared paragraphs). Call this when fonts load or
 * change without the `measure`/`metrics` functions changing identity.
 */
export function clearLayoutCaches() {
  widthCaches = new WeakMap();
  prepCache = new WeakMap();
}

// ---------------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------------

/** @param {string} s */
function cpCount(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        n--;
        i++;
      }
    }
  }
  return n;
}

/** @param {any} f */
function fontKey(f) {
  return f.family + '|' + f.size + '|' + f.weight + '|' + f.style;
}

/** @param {number} cp */
function kindOf(cp) {
  if (cp === 9) return K_TAB;
  if (cp === 0x2028 || cp === 10 || cp === 13 || cp === 11 || cp === 12 || cp === 0x2029 || cp === 0x85) return K_LS;
  if (cp === 0xad || cp === 0x200b || cp === 0x2060 || cp === 0xfeff || cp < 32 || cp === 0x7f) return K_ZW;
  if (isBreakingSpace(cp)) return K_SPACE;
  return K_TEXT;
}

/**
 * Uppercases without changing the string length (characters whose uppercase form has a different length keep their
 * original form), so offsets stay valid.
 * @param {string} text
 */
function upperKeep(text) {
  const u = text.toUpperCase();
  if (u.length === text.length) return u;
  let out = '';
  for (const ch of text) {
    const U = ch.toUpperCase();
    out += U.length === ch.length ? U : ch;
  }
  return out;
}

/** @param {number} n @param {boolean} upper */
function toAlpha(n, upper) {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return upper ? s.toUpperCase() : s;
}

/** @param {number} n @param {boolean} upper */
function toRoman(n, upper) {
  if (n <= 0 || n >= 4000) return String(n);
  const t = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let s = '';
  for (const [v, r] of t) {
    while (n >= v) {
      s += r;
      n -= v;
    }
  }
  return upper ? s.toUpperCase() : s;
}

// ---------------------------------------------------------------------------------------------------------------
// layout context
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {LayoutOptions} opts
 */
function makeCtx(opts) {
  const measureFn = typeof opts.measure === 'function' ? opts.measure : approxMeasurer.measure;
  const metricsFn = typeof opts.metrics === 'function' ? opts.metrics : approxMeasurer.metrics;
  let wc = widthCaches.get(measureFn);
  if (!wc) {
    wc = new Map();
    widthCaches.set(measureFn, wc);
  }
  if (wc.size > 200000) wc.clear();
  const defaults = opts.defaults || DEFAULTS;
  /** @type {Map<string, any>} */
  const mc = new Map();
  const ctx = {
    measureFn,
    metricsFn,
    styles: opts.styles,
    defaults,
    resolver: createStyleResolver(opts.styles, defaults),
    fields: opts.fields || null,
    hyphenate: typeof opts.hyphenate === 'function' ? opts.hyphenate : null,
    hyphMinWord: opts.hyphenMinWord > 0 ? opts.hyphenMinWord : 5,
    maxHyph: opts.maxConsecutiveHyphens > 0 ? opts.maxConsecutiveHyphens : 3,
    defaultTab: opts.defaultTabWidth > 0 ? opts.defaultTabWidth : 48,
    smallCaps: opts.smallCapsScale > 0 ? opts.smallCapsScale : 0.8,
    /** @type {{valid:boolean, ei:number, esub:number, x:number, vis:number, nspVis:number, hyph:boolean, hyphF:number, tabN:number, pRec:any, pSegW:number, pSegVis:number, pDec:number}} */
    cand: { valid: false, ei: 0, esub: 0, x: 0, vis: 0, nspVis: 0, hyph: false, hyphF: -1, tabN: 0, pRec: null, pSegW: 0, pSegVis: 0, pDec: -1 },
    /**
     * Cached text width.
     * @param {any} font
     * @param {string} fkey
     * @param {string} text
     */
    width(font, fkey, text) {
      const key = fkey + '\u0001' + text;
      let v = wc.get(key);
      if (v === undefined) {
        v = measureFn(font, text);
        if (!(v >= 0) || !isFinite(v)) v = 0;
        wc.set(key, v);
      }
      return v;
    },
    /**
     * Cached font metrics.
     * @param {any} font
     * @param {string} fkey
     */
    metrics(font, fkey) {
      let m = mc.get(fkey);
      if (!m) {
        const r = metricsFn(font) || {};
        const asc = isFinite(r.ascent) ? r.ascent : font.size * 0.9;
        const dsc = isFinite(r.descent) ? Math.abs(r.descent) : font.size * 0.2;
        m = { ascent: asc, descent: dsc, capHeight: r.capHeight > 0 ? r.capHeight : font.size * 0.7 };
        mc.set(fkey, m);
      }
      return m;
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------------------------------------------
// paragraph preparation
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Chunk
 * @property {number} ss source start (paragraph-local)
 * @property {number} se source end
 * @property {number} ds display start
 * @property {number} de display end
 * @property {boolean} atomic
 * @property {any} font
 * @property {string} fkey
 * @property {string} color
 * @property {boolean} underline
 * @property {boolean} strike
 * @property {number} tracking
 * @property {number} trackPx
 * @property {number} shift
 * @property {number} asc
 * @property {number} desc
 * @property {string} text
 * @property {string|undefined} field
 */

/**
 * @param {any} ctx
 * @param {number} ss
 * @param {number} se
 * @param {string} text
 * @param {any} font render font
 * @param {any} nominal font used for metrics (full size)
 * @param {any} ra resolved attrs
 * @param {number} lhMult
 * @param {boolean} atomic
 * @returns {Chunk}
 */
function makeChunk(ctx, ss, se, text, font, nominal, ra, lhMult, atomic) {
  const fkey = fontKey(font);
  const m = ctx.metrics(nominal, fontKey(nominal));
  const lineH = nominal.size * lhMult;
  const half = (lineH - (m.ascent + m.descent)) / 2;
  const shift = Number(ra.baselineShift) || 0;
  const tracking = Number(ra.tracking) || 0;
  return {
    ss,
    se,
    ds: 0,
    de: 0,
    atomic,
    font,
    fkey,
    color: typeof ra.color === 'string' ? ra.color : '#000000',
    underline: !!ra.underline,
    strike: !!ra.strike,
    tracking,
    trackPx: (tracking / 1000) * font.size,
    shift,
    asc: m.ascent + half + shift,
    desc: m.descent + half - shift,
    text,
    field: ra.field,
  };
}

/**
 * Prepares a paragraph: resolves styles, builds display chunks (caps transforms, fields), splits the text into
 * measured fragments (words, spaces, tabs, ...). The result depends only on the paragraph and the measuring
 * context, so it is cached per paragraph object.
 * @param {any} para
 * @param {any} ctx
 */
function prepare(para, ctx) {
  const cached = prepCache.get(para);
  if (
    cached &&
    cached.measure === ctx.measureFn &&
    cached.metrics === ctx.metricsFn &&
    cached.styles === ctx.styles &&
    cached.defaults === ctx.defaults &&
    cached.sc === ctx.smallCaps
  ) {
    return cached.P;
  }
  const pa = ctx.resolver.para(para);
  const lhMult = pa.lineHeight > 0 ? pa.lineHeight : 1.25;
  /** @type {Chunk[]} */
  const chunks = [];
  let D = '';
  let srcPos = 0;
  let hasField = false;

  /**
   * @param {Chunk} ch
   */
  const push = (ch) => {
    ch.ds = D.length;
    D += ch.text;
    ch.de = D.length;
    chunks.push(ch);
  };

  for (const run of para.runs || []) {
    const text = typeof run.text === 'string' ? run.text : '';
    if (!text) continue;
    const ss = srcPos;
    srcPos += text.length;
    const ra = ctx.resolver.run(run, para);
    const size = ra.fontSize > 0 && isFinite(ra.fontSize) ? ra.fontSize : 12;
    const nominal = {
      family: typeof ra.fontFamily === 'string' && ra.fontFamily ? ra.fontFamily : 'Helvetica',
      size,
      weight: ra.fontWeight > 0 ? ra.fontWeight : 400,
      style: ra.fontStyle === 'italic' ? 'italic' : 'normal',
    };
    const caps = ra.caps;
    if (ra.field !== undefined && ra.field !== null) {
      hasField = true;
      let disp = ctx.fields && ctx.fields[ra.field] !== undefined && ctx.fields[ra.field] !== null ? String(ctx.fields[ra.field]) : text;
      if (caps === 'upper' || caps === 'small') disp = upperKeep(disp);
      disp = disp.replace(/[\r\n\u{2028}\u{2029}\t]/gu, ' ');
      if (!disp) disp = '\u{2060}';
      push(makeChunk(ctx, ss, srcPos, disp, nominal, nominal, ra, lhMult, true));
    } else if (caps === 'upper') {
      push(makeChunk(ctx, ss, srcPos, upperKeep(text), nominal, nominal, ra, lhMult, false));
    } else if (caps === 'small') {
      // split into lower case letters (shown as reduced capitals) and everything else
      let segStart = 0;
      let segSmall = false;
      let first = true;
      const flush = (end) => {
        if (end <= segStart) return;
        const piece = text.slice(segStart, end);
        if (segSmall) {
          const f = { ...nominal, size: size * ctx.smallCaps };
          push(makeChunk(ctx, ss + segStart, ss + end, upperKeep(piece), f, nominal, ra, lhMult, false));
        } else {
          push(makeChunk(ctx, ss + segStart, ss + end, piece, nominal, nominal, ra, lhMult, false));
        }
      };
      let i = 0;
      while (i < text.length) {
        const cp = text.codePointAt(i);
        const w = cp > 0xffff ? 2 : 1;
        const ch = text.slice(i, i + w);
        const up = ch.toUpperCase();
        const isSmall = up !== ch && up.length === ch.length;
        if (first) {
          segSmall = isSmall;
          first = false;
        } else if (isSmall !== segSmall) {
          flush(i);
          segStart = i;
          segSmall = isSmall;
        }
        i += w;
      }
      flush(text.length);
    } else {
      push(makeChunk(ctx, ss, srcPos, text, nominal, nominal, ra, lhMult, false));
    }
  }

  // base chunk (empty paragraphs and metrics fallback)
  let base;
  if (chunks.length) base = chunks[chunks.length - 1];
  else {
    const ra = ctx.resolver.baseChar(para, undefined);
    const size = ra.fontSize > 0 && isFinite(ra.fontSize) ? ra.fontSize : 12;
    const font = {
      family: typeof ra.fontFamily === 'string' && ra.fontFamily ? ra.fontFamily : 'Helvetica',
      size,
      weight: ra.fontWeight > 0 ? ra.fontWeight : 400,
      style: ra.fontStyle === 'italic' ? 'italic' : 'normal',
    };
    base = makeChunk(ctx, 0, 0, '', font, font, ra, lhMult, false);
  }

  // drop cap
  let drop = null;
  const dc = pa.dropCap;
  const hasBullet = pa.bullet && typeof pa.bullet === 'object' && pa.bullet.kind;
  if (dc && typeof dc === 'object' && !hasBullet && chunks.length && !chunks[0].atomic) {
    const L = Math.min(12, Math.max(0, Math.floor(dc.lines)));
    const nChars = Math.min(8, Math.max(1, Math.floor(dc.chars) || 1));
    if (L >= 2) {
      const c0 = chunks[0];
      let k = 0;
      let count = 0;
      while (k < c0.de && count < nChars) {
        const cp = D.codePointAt(k);
        if (kindOf(cp) !== K_TEXT && kindOf(cp) !== K_SPACE) break;
        k += cp > 0xffff ? 2 : 1;
        count++;
      }
      if (k > 0) {
        const m = ctx.metrics(c0.font, c0.fkey);
        const bodySize = c0.font.size;
        const capRatio = m.capHeight / bodySize > 0.3 ? m.capHeight / bodySize : 0.7;
        const bodyLH = c0.asc + c0.desc;
        const size = ((L - 1) * bodyLH + capRatio * bodySize) / capRatio;
        const font = { ...c0.font, size };
        const fkey = fontKey(font);
        const text = D.slice(0, k);
        const trackPx = (c0.tracking / 1000) * size;
        const w = ctx.width(font, fkey, text) + trackPx * cpCount(text);
        drop = {
          k,
          L,
          text,
          font,
          fkey,
          w,
          indent: w + Math.max(1, size * 0.06),
          lineH: bodyLH,
          chunk: c0,
          trackPx,
        };
      }
    }
  }

  // fragments
  /** @type {any[]} */
  const frags = [];
  const n = D.length;
  if (n > 0) {
    const breaks = findBreaks(D);
    for (const ch of chunks) {
      if (ch.atomic) for (let i = ch.ds + 1; i < ch.de; i++) breaks[i] = 0;
    }
    let ci = 0;
    let i = drop ? drop.k : 0;
    while (i < n) {
      while (ci < chunks.length - 1 && i >= chunks[ci].de) ci++;
      const ch = chunks[ci];
      const cp0 = D.codePointAt(i);
      let kind = ch.atomic ? K_TEXT : kindOf(cp0);
      let j = i + (cp0 > 0xffff ? 2 : 1);
      let shy = false;
      if (ch.atomic) {
        j = ch.de;
      } else if (kind === K_TEXT) {
        while (j < ch.de && breaks[j] === 0) {
          const cp = D.codePointAt(j);
          if (kindOf(cp) !== K_TEXT) break;
          j += cp > 0xffff ? 2 : 1;
        }
      } else if (kind === K_SPACE) {
        while (j < ch.de && kindOf(D.codePointAt(j)) === K_SPACE) j++;
      } else if (kind === K_ZW) {
        shy = cp0 === 0xad;
      }
      /** @type {any} */
      const f = { k: kind, ds: i, de: j, ci, w: 0, brk: j < n ? breaks[j] : 2, nsp: 0, shy, hyW: 0 };
      if (kind === K_LS) f.brk = 2;
      if (kind === K_TEXT || kind === K_SPACE) {
        const text = D.substring(i, j);
        let w = ctx.width(ch.font, ch.fkey, text);
        if (ch.trackPx) w += ch.trackPx * cpCount(text);
        f.w = w;
        if (kind === K_SPACE) {
          for (let q = 0; q < text.length; q++) if (text.charCodeAt(q) === 0x20) f.nsp++;
        } else if (text.indexOf(NBSP) >= 0) {
          for (let q = 0; q < text.length; q++) if (text.charCodeAt(q) === 0xa0) f.nsp++;
        }
      } else if (kind === K_ZW && shy) {
        f.brk = 1;
        f.hyW = ctx.width(ch.font, ch.fkey, '-') + ch.trackPx;
      }
      frags.push(f);
      i = j;
    }
  }

  // tab stops
  /** @type {{pos:number, align:string, leader:string}[]} */
  const tabStops = [];
  if (Array.isArray(pa.tabs)) {
    for (const t of pa.tabs) {
      if (t && typeof t.pos === 'number' && isFinite(t.pos)) {
        tabStops.push({ pos: t.pos, align: t.align === 'right' || t.align === 'center' || t.align === 'decimal' ? t.align : 'left', leader: typeof t.leader === 'string' ? t.leader : '' });
      }
    }
    tabStops.sort((a, b) => a.pos - b.pos);
  }

  let hEst = base.asc + base.desc;
  for (const c of chunks) hEst = Math.max(hEst, c.asc + c.desc);
  if (drop) hEst = Math.max(hEst, drop.lineH);

  const P = {
    pa,
    D,
    chunks,
    frags,
    drop,
    srcLen: srcPos,
    base,
    hEst,
    hasField,
    tabStops,
    bullet: hasBullet ? pa.bullet : null,
  };
  if (!hasField) {
    prepCache.set(para, { P, measure: ctx.measureFn, metrics: ctx.metricsFn, styles: ctx.styles, defaults: ctx.defaults, sc: ctx.smallCaps });
  }
  return P;
}

/**
 * Source offset (paragraph-local) of a point inside a fragment.
 * @param {any} P
 * @param {number} fi fragment index (>= frags.length means the paragraph end)
 * @param {number} sub display offset inside the fragment
 */
function srcAt(P, fi, sub) {
  if (fi >= P.frags.length) return P.srcLen;
  const f = P.frags[fi];
  const ch = P.chunks[f.ci];
  if (ch.atomic) return sub > 0 ? ch.se : ch.ss;
  return ch.ss + (f.ds + sub - ch.ds);
}

// ---------------------------------------------------------------------------------------------------------------
// line breaking
// ---------------------------------------------------------------------------------------------------------------

/**
 * Effective end x of a pending (right / center / decimal) tab segment.
 * @param {any} rec
 * @param {number} segW
 * @param {number} dec
 */
function effPend(rec, segW, dec) {
  const off = rec.align === 'right' ? segW : rec.align === 'center' ? segW / 2 : dec >= 0 ? dec : segW;
  const start = rec.S - off;
  return (start > rec.x0 ? start : rec.x0) + segW;
}

/**
 * Finds the next tab stop after `x`.
 * @param {any} P
 * @param {number} x position relative to the line start
 * @param {number} tabOff distance from the column's left edge to the line start
 * @param {any} ctx
 * @returns {{S:number, align:string, leader:string}}
 */
function nextStop(P, x, tabOff, ctx) {
  const stops = P.tabStops;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].pos - tabOff > x + 0.01) return { S: stops[i].pos - tabOff, align: stops[i].align, leader: stops[i].leader };
  }
  const dt = ctx.defaultTab;
  const pos = (Math.floor((x + tabOff + 0.01) / dt) + 1) * dt;
  return { S: pos - tabOff, align: 'left', leader: '' };
}

/**
 * Width of the remainder of a fragment starting at `sub` (display offset inside the fragment).
 * @param {any} P
 * @param {any} f
 * @param {number} sub
 * @param {number} end
 * @param {any} ctx
 */
function partialWidth(P, f, sub, end, ctx) {
  const ch = P.chunks[f.ci];
  const text = P.D.substring(f.ds + sub, f.ds + end);
  let w = ctx.width(ch.font, ch.fkey, text);
  if (ch.trackPx) w += ch.trackPx * cpCount(text);
  return w;
}

/**
 * Looks for a hyphenation point of the word in fragment `f` so that the prefix plus a hyphen fits `room`.
 * @returns {{sub:number, w:number, hyW:number}|null}
 */
function tryHyphenate(P, f, sub0, room, ctx) {
  if (f.k !== K_TEXT) return null;
  const ch = P.chunks[f.ci];
  if (ch.atomic) return null;
  const text = P.D.substring(f.ds + sub0, f.de);
  let a = 0;
  while (a < text.length && !RE_LETTER.test(text[a])) a++;
  let b = text.length;
  while (b > a && !RE_LETTER.test(text[b - 1])) b--;
  const core = text.slice(a, b);
  if (core.length < ctx.hyphMinWord) return null;
  for (let i = 0; i < core.length; i++) if (!RE_LETTER.test(core[i])) return null;
  let syl;
  try {
    syl = ctx.hyphenate(core);
  } catch (_) {
    return null;
  }
  if (!Array.isArray(syl) || syl.length < 2 || syl.join('') !== core) return null;
  const hyW = ctx.width(ch.font, ch.fkey, '-') + ch.trackPx;
  // try the longest prefix first
  let cut = core.length;
  for (let s = syl.length - 1; s >= 1; s--) {
    cut -= syl[s].length;
    if (cut <= 0) break;
    const prefix = text.slice(0, a + cut);
    let w = ctx.width(ch.font, ch.fkey, prefix);
    if (ch.trackPx) w += ch.trackPx * cpCount(prefix);
    if (w + hyW <= room + EPS) return { sub: sub0 + a + cut, w, hyW };
  }
  return null;
}

/**
 * Largest cluster boundary inside fragment `f` (absolute display offset > sub0) such that the text from `sub0` to
 * that boundary fits `room`; returns `sub0` when not even one cluster fits.
 */
function fitChars(P, f, sub0, room, ctx) {
  const ch = P.chunks[f.ci];
  const text = P.D.substring(f.ds, f.de);
  const len = text.length;
  let lo = sub0; // known to fit (zero chars)
  let hi = len; // exclusive upper bound candidate
  // binary search on the raw index, then snap to a cluster start
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    let w = ctx.width(ch.font, ch.fkey, text.substring(sub0, mid));
    if (ch.trackPx) w += ch.trackPx * cpCount(text.substring(sub0, mid));
    if (w <= room + EPS) lo = mid;
    else hi = mid;
  }
  let k = lo;
  while (k > sub0 && !isClusterStart(text, k)) k--;
  return k;
}

/**
 * @typedef {Object} LineDesc
 * @property {number} si start fragment
 * @property {number} ssub display offset inside the start fragment
 * @property {number} ei end fragment (exclusive unless esub > 0)
 * @property {number} esub chars of fragment `ei` that belong to this line
 * @property {boolean} hyph a hyphen is added at the end
 * @property {number} hyphF fragment whose font the hyphen uses
 * @property {boolean} hard the line ends with a forced break
 * @property {boolean} last last line of the paragraph
 * @property {number} vis visible width
 * @property {number} nsp expandable spaces inside the visible part
 * @property {any[]|null} tabs tab records
 */

/**
 * Greedy line breaking from fragment (si, ssub) with `avail` px of room.
 * @param {any} P
 * @param {number} si
 * @param {number} ssub
 * @param {number} avail
 * @param {number} tabOff
 * @param {any} ctx
 * @param {boolean} hyphOK
 * @returns {LineDesc}
 */
function breakLine(P, si, ssub, avail, tabOff, ctx, hyphOK) {
  const F = P.frags;
  const n = F.length;
  const cand = ctx.cand;
  cand.valid = false;
  let x = 0;
  let visX = 0;
  let nsp = 0;
  let nspVis = 0;
  /** @type {any[]|null} */
  let tabs = null;
  /** @type {any|null} */
  let pend = null;

  const record = (ei, hyph, hyphF, cx, cvis) => {
    cand.valid = true;
    cand.ei = ei;
    cand.esub = 0;
    cand.x = cx;
    cand.vis = cvis;
    cand.nspVis = nspVis;
    cand.hyph = hyph;
    cand.hyphF = hyphF;
    cand.tabN = tabs ? tabs.length : 0;
    cand.pRec = pend;
    if (pend) {
      cand.pSegW = pend.segW;
      cand.pSegVis = pend.segVis;
      cand.pDec = pend.dec;
    }
  };

  /**
   * @param {number} ei
   * @param {number} esub
   * @param {boolean} hyph
   * @param {number} hyphF
   * @param {number} vis
   * @param {number} nspV
   * @param {boolean} hard
   * @param {boolean} last
   * @param {any[]|null} tabList
   * @returns {LineDesc}
   */
  const make = (ei, esub, hyph, hyphF, vis, nspV, hard, last, tabList) => ({ si, ssub, ei, esub, hyph, hyphF, hard, last, vis, nsp: nspV, tabs: tabList && tabList.length ? tabList : null });

  const fromCand = () => {
    if (tabs) tabs.length = cand.tabN;
    if (cand.pRec) {
      cand.pRec.segW = cand.pSegW;
      cand.pRec.segVis = cand.pSegVis;
      cand.pRec.dec = cand.pDec;
      cand.pRec.open = true;
    }
    return make(cand.ei, cand.esub, cand.hyph, cand.hyphF, cand.vis, cand.nspVis, false, false, tabs);
  };

  for (let i = si; i < n; i++) {
    const f = F[i];
    const kind = f.k;
    let w = f.w;
    let nspf = f.nsp;
    let sub0 = 0;
    if (i === si && ssub > 0 && kind === K_TEXT) {
      // the line starts inside a word (an overlong word or a hyphenated word continues here)
      sub0 = ssub;
      w = partialWidth(P, f, ssub, f.de - f.ds, ctx);
      nspf = 0;
      if (f.nsp) {
        const t = P.D.substring(f.ds + ssub, f.de);
        for (let q = 0; q < t.length; q++) if (t.charCodeAt(q) === 0xa0) nspf++;
      }
    }

    if (kind === K_LS) {
      return make(i + 1, 0, false, -1, visWith(pend, visX), nspVis, true, false, tabs);
    }
    if (kind === K_ZW) {
      if (f.shy) {
        // soft hyphen: a break here shows a hyphen
        if (!pend && x + f.hyW <= avail + EPS) record(i + 1, true, i, x + f.hyW, x + f.hyW);
      } else if (f.brk === 1) {
        record(i + 1, false, -1, x, visX);
      }
      continue;
    }
    if (kind === K_TAB) {
      if (pend) {
        x = effPend(pend, pend.segW, pend.dec);
        pend.segVis = pend.segW;
        pend.open = false;
        pend = null;
      }
      const stop = nextStop(P, x, tabOff, ctx);
      // tab stops beyond the right edge are pinned to it (the text after such a tab wraps to the next line)
      if (stop.S > avail) stop.S = Math.max(x, avail);
      if (!tabs) tabs = [];
      const rec = { fi: i, x0: x, S: stop.S, align: stop.align, leader: stop.leader, segW: 0, segVis: 0, dec: -1, open: false };
      tabs.push(rec);
      if (stop.align === 'left') {
        x = stop.S;
        visX = x;
      } else {
        pend = rec;
        rec.open = true;
      }
      // a tab behaves like a space: a break may follow it
      const tx = pend ? effPend(pend, 0, -1) : x;
      record(i + 1, false, -1, tx, tx);
      continue;
    }
    if (kind === K_SPACE) {
      if (pend) {
        pend.segW += w;
        x = effPend(pend, pend.segW, pend.dec);
      } else {
        x += w;
      }
      nsp += nspf;
      if (f.brk === 1) record(i + 1, false, -1, x, visX);
      continue;
    }

    // K_TEXT
    const xNew = pend ? effPend(pend, pend.segW + w, pend.dec) : x + w;
    if (xNew <= avail + EPS) {
      if (pend) {
        if (pend.align === 'decimal' && pend.dec < 0) {
          const t = P.D.substring(f.ds + sub0, f.de);
          let p = t.indexOf('.');
          const p2 = t.indexOf(',');
          if (p < 0 || (p2 >= 0 && p2 < p)) p = p2;
          if (p >= 0) pend.dec = pend.segW + partialWidth(P, f, sub0, sub0 + p, ctx);
        }
        pend.segW += w;
        pend.segVis = pend.segW;
        x = effPend(pend, pend.segW, pend.dec);
      } else {
        x += w;
      }
      visX = x;
      nsp += nspf;
      nspVis = nsp;
      if (f.brk === 1) record(i + 1, false, -1, x, visX);
      continue;
    }

    // overflow
    if (hyphOK && !pend) {
      const h = tryHyphenate(P, f, sub0, avail - x, ctx);
      if (h && (h.sub > sub0 || i > si)) {
        // the part of the word that stays makes every space before it an inner space
        return make(i, h.sub, true, i, x + h.w + h.hyW, nsp, false, false, tabs);
      }
    }
    if (cand.valid) return fromCand();
    // an unbreakable word that is wider than the line: break between characters
    let k = fitChars(P, f, sub0, avail - x, ctx);
    if (k <= sub0) {
      // not even one character fits next to the content before it: wrap before this fragment
      if (i > si) return make(i, 0, false, -1, visX, nspVis, false, false, tabs);
      // at the start of a line at least one cluster is placed, which guarantees progress
      k = nextCluster(P.D.substring(f.ds, f.de), sub0);
    }
    if (k >= f.de - f.ds) {
      // the whole fragment fits after all (can happen when only a single cluster remains)
      const wAll = partialWidth(P, f, sub0, f.de - f.ds, ctx);
      return make(i + 1, 0, false, -1, x + wAll, nspVis, false, false, tabs);
    }
    const wk = partialWidth(P, f, sub0, k, ctx);
    return make(i, k, false, -1, x + wk, nsp, false, false, tabs);
  }
  // paragraph end
  return make(n, 0, false, -1, visWith(pend, visX), nspVis, false, true, tabs);
}

/**
 * Visible width given a pending tab record.
 * @param {any|null} pend
 * @param {number} visX
 */
function visWith(pend, visX) {
  if (!pend) return visX;
  return effPend(pend, pend.segVis, pend.dec);
}

/**
 * Ascent and descent of a line (max over the chunks it touches).
 * @param {any} P
 * @param {LineDesc} d
 * @returns {{asc:number, dsc:number}}
 */
function lineAscDesc(P, d) {
  const F = P.frags;
  let asc = -Infinity;
  let dsc = -Infinity;
  const hasFrags = d.ei > d.si || d.esub > 0;
  if (hasFrags) {
    const lastIdx = d.esub > 0 ? d.ei : d.ei - 1;
    const c0 = F[d.si].ci;
    const c1 = F[Math.min(lastIdx, F.length - 1)].ci;
    for (let c = c0; c <= c1; c++) {
      const ch = P.chunks[c];
      if (ch.asc > asc) asc = ch.asc;
      if (ch.desc > dsc) dsc = ch.desc;
    }
  }
  if (d.hyph && d.hyphF >= 0) {
    const ch = P.chunks[F[d.hyphF].ci];
    if (ch.asc > asc) asc = ch.asc;
    if (ch.desc > dsc) dsc = ch.desc;
  }
  if (asc === -Infinity) {
    const ch = d.si >= F.length && P.chunks.length ? P.chunks[P.chunks.length - 1] : P.base;
    asc = ch.asc;
    dsc = ch.desc;
  }
  return { asc, dsc };
}

// ---------------------------------------------------------------------------------------------------------------
// building lines (runs, alignment, justification, tabs, bullets, drop caps)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Piece
 * @property {'T'|'S'|'B'|'Z'} t
 * @property {Chunk} ch
 * @property {string} text
 * @property {number} ss paragraph-local source start
 * @property {number} sl source length
 * @property {number} exp expandable space count
 * @property {boolean} hang
 * @property {boolean} synth synthetic (hyphen)
 * @property {number} w
 * @property {number} [fw] summed measured fragment widths, when the piece consists of whole fragments
 * @property {any} [tab]
 */

/**
 * Collects pieces (merged text/space segments, tabs, zero-width characters) of a line.
 * @param {any} P
 * @param {LineDesc} d
 * @returns {Piece[]}
 */
function collectPieces(P, d) {
  const F = P.frags;
  /** @type {Piece[]} */
  const out = [];
  const D = P.D;
  let tabIdx = 0;
  const lastFi = d.esub > 0 ? d.ei : d.ei - 1;
  for (let i = d.si; i <= lastFi && i < F.length; i++) {
    const f = F[i];
    const ch = P.chunks[f.ci];
    const from = i === d.si ? d.ssub : 0;
    const to = i === d.ei && d.esub > 0 ? d.esub : f.de - f.ds;
    if (f.k === K_LS) continue;
    if (f.k === K_TAB) {
      out.push({ t: 'B', ch, text: '', ss: srcAt(P, i, 0), sl: 1, exp: 0, hang: false, synth: false, w: 0, tab: d.tabs ? d.tabs[tabIdx++] : null });
      continue;
    }
    if (f.k === K_ZW) {
      // zero-width characters (including a soft hyphen that ends the line) keep their source slot
      out.push({ t: 'Z', ch, text: '', ss: srcAt(P, i, 0), sl: 1, exp: 0, hang: false, synth: false, w: 0 });
      continue;
    }
    const text = D.substring(f.ds + from, f.ds + to);
    const t = f.k === K_SPACE ? 'S' : 'T';
    const ss = ch.atomic ? ch.ss : ch.ss + (f.ds + from - ch.ds);
    const sl = ch.atomic ? ch.se - ch.ss : text.length;
    // whole fragments carry their measured width (tracking included); partial ones are measured later
    const fw = from === 0 && to === f.de - f.ds ? f.w : undefined;
    const prev = out[out.length - 1];
    if (prev && prev.t === t && prev.ch === ch && !ch.atomic && prev.ss + prev.sl === ss) {
      prev.text += text;
      prev.sl += sl;
      prev.fw = prev.fw !== undefined && fw !== undefined ? prev.fw + fw : undefined;
    } else {
      out.push({ t, ch, text, ss, sl, exp: 0, hang: false, synth: false, w: 0, fw });
    }
  }
  return out;
}

/**
 * Builds the final line (runs with exact positions).
 * @param {any} P
 * @param {any} pl placed line descriptor
 * @param {number} pStart story offset of the paragraph
 * @param {number} pi paragraph index
 * @param {any} ctx
 * @param {{marker?:string}} extra
 * @returns {LayoutLine}
 */
function buildLine(P, pl, pStart, pi, ctx, extra) {
  const d = pl.d;
  const pa = P.pa;
  const pieces = collectPieces(P, d);
  const hasTab = pieces.some((p) => p.t === 'B');

  // trailing spaces hang
  let lastVisible = -1;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.t === 'T' || p.t === 'B') {
      lastVisible = i;
      break;
    }
  }
  let hang = 0;
  for (let i = lastVisible + 1; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.t === 'S') {
      p.hang = true;
      hang += p.sl;
    } else if (p.t === 'Z' && hang > 0) {
      // zero-width characters behind hanging spaces hang as well
      p.hang = true;
      hang += p.sl;
    }
  }

  // hyphen piece
  if (d.hyph && d.hyphF >= 0) {
    const ch = P.chunks[P.frags[d.hyphF].ci];
    // insert after the last visible piece (before hanging pieces, which cannot exist at a hyphen break)
    pieces.push({ t: 'T', ch, text: '-', ss: srcAt(P, d.ei, d.esub), sl: 0, exp: 0, hang: false, synth: true, w: 0 });
  }

  // justification
  const align = pa.align === 'center' || pa.align === 'right' || pa.align === 'justify' ? pa.align : 'left';
  const justify = align === 'justify' && !d.last && !d.hard && !hasTab && d.nsp > 0 && d.vis < pl.avail - 0.01;
  const extra1 = justify ? (pl.avail - d.vis) / d.nsp : 0;
  /** @type {Piece[]} */
  let list = pieces;
  if (!justify) {
    // merge words and the spaces between them into single runs (hanging spaces stay separate)
    list = [];
    for (const p of pieces) {
      const prev = list[list.length - 1];
      if (
        prev &&
        (p.t === 'T' || p.t === 'S') &&
        (prev.t === 'T' || prev.t === 'S') &&
        prev.hang === p.hang &&
        prev.ch === p.ch &&
        !p.ch.atomic &&
        !p.synth &&
        !prev.synth &&
        prev.ss + prev.sl === p.ss
      ) {
        prev.text += p.text;
        prev.sl += p.sl;
        prev.fw = prev.fw !== undefined && p.fw !== undefined ? prev.fw + p.fw : undefined;
        if (p.t === 'T') prev.t = 'T';
      } else {
        list.push(p);
      }
    }
  } else {
    list = [];
    for (const p of pieces) {
      if ((p.t !== 'T' && p.t !== 'S') || p.hang || p.ch.atomic || p.synth) {
        list.push(p);
        continue;
      }
      const text = p.text;
      if (!text) {
        list.push(p);
        continue;
      }
      // split at expandable spaces; a piece that is uniform keeps its measured width
      let segExp = isExpandableSpace(text.charCodeAt(0));
      let uniform = true;
      for (let i = 1; i < text.length; i++) {
        if (isExpandableSpace(text.charCodeAt(i)) !== segExp) {
          uniform = false;
          break;
        }
      }
      if (uniform) {
        if (segExp) {
          p.t = 'S';
          p.exp = text.length;
        }
        list.push(p);
        continue;
      }
      let segStart = 0;
      for (let i = 1; i <= text.length; i++) {
        const e = i < text.length ? isExpandableSpace(text.charCodeAt(i)) : !segExp;
        if (e !== segExp || i === text.length) {
          const piece = text.slice(segStart, i);
          list.push({ t: segExp ? 'S' : p.t, ch: p.ch, text: piece, ss: p.ss + segStart, sl: piece.length, exp: segExp ? piece.length : 0, hang: false, synth: false, w: 0, fw: undefined });
          segStart = i;
          segExp = e;
        }
      }
    }
  }

  // widths
  for (const p of list) {
    if (p.t === 'T' || p.t === 'S') {
      if (!p.text) {
        p.w = 0;
        continue;
      }
      const ch = p.ch;
      let w;
      if (p.fw !== undefined) w = p.fw;
      else {
        w = ctx.width(ch.font, ch.fkey, p.text);
        if (ch.trackPx) w += ch.trackPx * cpCount(p.text);
      }
      if (p.exp) w += p.exp * extra1;
      p.w = w;
    }
  }

  // positions (relative to the line start), tabs resolved against their stops
  let cursor = 0;
  /** @type {{piece:Piece, x:number, w:number, leaderW?:number}[]} */
  const placed = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.t === 'B') {
      const rec = p.tab;
      const S = rec ? rec.S : cursor;
      let gap;
      if (!rec || rec.align === 'left') {
        gap = Math.max(0, S - cursor);
      } else {
        // measure the segment up to the next tab / end of line
        let segW = 0;
        let dec = -1;
        for (let j = i + 1; j < list.length && list[j].t !== 'B'; j++) {
          const q = list[j];
          if (q.hang) break;
          if (rec.align === 'decimal' && dec < 0 && q.t === 'T' && !q.ch.atomic) {
            let pidx = q.text.indexOf('.');
            const p2 = q.text.indexOf(',');
            if (pidx < 0 || (p2 >= 0 && p2 < pidx)) pidx = p2;
            if (pidx >= 0) {
              const pre = q.text.slice(0, pidx);
              dec = segW + ctx.width(q.ch.font, q.ch.fkey, pre) + (q.ch.trackPx ? q.ch.trackPx * cpCount(pre) : 0);
            }
          }
          segW += q.w;
        }
        const off = rec.align === 'right' ? segW : rec.align === 'center' ? segW / 2 : dec >= 0 ? dec : segW;
        gap = Math.max(0, S - off - cursor);
      }
      placed.push({ piece: p, x: cursor, w: gap });
      cursor += gap;
      continue;
    }
    placed.push({ piece: p, x: cursor, w: p.w });
    cursor += p.w;
  }
  // visible width: end of the last non-hanging piece
  let W = 0;
  for (let i = placed.length - 1; i >= 0; i--) {
    const pp = placed[i];
    if (!pp.piece.hang) {
      W = pp.x + pp.w;
      break;
    }
  }

  // alignment
  let x0 = pl.left;
  if (!hasTab && !justify) {
    if (align === 'center') x0 = pl.left + Math.max(0, (pl.avail - W) / 2);
    else if (align === 'right') x0 = pl.left + Math.max(0, pl.avail - W);
  }

  // runs
  /** @type {LayoutRun[]} */
  const runs = [];
  const baseSrc = pStart;
  for (let i = 0; i < placed.length; i++) {
    const { piece: p, x, w } = placed[i];
    const ch = p.ch;
    if (p.t === 'B') {
      const rx = x0 + x;
      runs.push(mkRun('', rx, w, ch, false, false, baseSrc + p.ss, baseSrc + p.ss + 1, { tab: true }));
      const rec = p.tab;
      if (rec && rec.leader && w > 0) {
        const unit = rec.leader;
        const unitW = ctx.width(ch.font, ch.fkey, unit) + (ch.trackPx ? ch.trackPx * cpCount(unit) : 0);
        if (unitW > 0) {
          const colX = pl.colX;
          const absStart = rx;
          const absEnd = rx + w;
          const first = colX + Math.ceil((absStart - colX) / unitW - 1e-6) * unitW;
          const count = Math.floor((absEnd - first) / unitW + 1e-6);
          if (count >= 1) {
            runs.push(mkRun(unit.repeat(count), first, count * unitW, ch, false, false, baseSrc + p.ss, baseSrc + p.ss, { leader: true }));
          }
        }
      }
      continue;
    }
    if (p.t === 'Z') {
      runs.push(mkRun('', x0 + x, 0, ch, false, false, baseSrc + p.ss, baseSrc + p.ss + p.sl, { zw: true }));
      continue;
    }
    const flags = {};
    if (p.hang) flags.hang = true;
    if (p.synth) flags.hyphen = true;
    if (ch.field !== undefined && ch.field !== null) flags.field = ch.field;
    if (p.exp && extra1) flags.wordSpacing = extra1;
    const showDeco = !p.hang;
    runs.push(mkRun(p.text, x0 + x, w, ch, showDeco && ch.underline, showDeco && ch.strike, baseSrc + p.ss, baseSrc + p.ss + p.sl, flags));
  }

  // source extent of the line
  const lineIdx = pl.lineIdx;
  const startSrc = lineIdx === 0 ? 0 : srcAt(P, d.si, d.ssub);
  const endSrc = d.last ? P.srcLen : srcAt(P, d.ei, d.esub);
  const charStart = pStart + startSrc;
  const charEnd = pStart + endSrc;

  // drop cap
  /** @type {any} */
  let dropRun = null;
  if (P.drop && lineIdx === 0) {
    const dr = P.drop;
    dropRun = {
      text: dr.text,
      x: pl.dropX,
      width: dr.w,
      font: dr.font,
      color: dr.chunk.color,
      underline: dr.chunk.underline,
      strike: dr.chunk.strike,
      tracking: dr.chunk.tracking,
      letterSpacing: dr.trackPx,
      baselineShift: -((dr.L - 1) * dr.lineH),
      charStart: pStart,
      charEnd: pStart + dr.k,
      dropCap: true,
    };
    runs.unshift(dropRun);
  }

  // horizontal extent of everything on the line (drop cap and hanging spaces included, bullet excluded)
  let left = x0;
  let right = x0 + W;
  for (const r of runs) {
    if (r.x < left) left = r.x;
    if (r.x + r.width > right) right = r.x + r.width;
  }

  /** @type {any} */
  const line = {
    x: x0,
    left,
    right,
    y: pl.top,
    baseline: pl.baseline,
    width: W,
    height: pl.h,
    ascent: pl.baseline - pl.top,
    descent: pl.top + pl.h - pl.baseline,
    para: pi,
    charStart,
    charEnd,
    runs,
    justified: justify,
    last: d.last,
    hard: d.hard,
    hang,
    lineInPara: lineIdx,
    frame: pl.fi,
    column: pl.ci,
  };
  if (d.hyph) line.hyphenated = true;
  if (dropRun) line.dropCap = { lines: P.drop.L, run: dropRun, lastLine: null };

  // bullet / number marker on the first line
  if (lineIdx === 0 && P.bullet && extra && extra.marker !== undefined) {
    const ch = P.chunks.length ? P.chunks[0] : P.base;
    const text = extra.marker;
    const width = ctx.width(ch.font, ch.fkey, text) + (ch.trackPx ? ch.trackPx * cpCount(text) : 0);
    line.bullet = mkRun(text, pl.markerX, width, ch, false, false, pStart, pStart, { bullet: true });
  }
  return line;
}

/**
 * @param {string} text
 * @param {number} x
 * @param {number} width
 * @param {Chunk} ch
 * @param {boolean} underline
 * @param {boolean} strike
 * @param {number} charStart
 * @param {number} charEnd
 * @param {object} flags
 * @returns {LayoutRun}
 */
function mkRun(text, x, width, ch, underline, strike, charStart, charEnd, flags) {
  /** @type {any} */
  const r = {
    text,
    x,
    width,
    font: ch.font,
    color: ch.color,
    underline,
    strike,
    tracking: ch.tracking,
    letterSpacing: ch.trackPx,
    baselineShift: ch.shift,
    charStart,
    charEnd,
  };
  for (const k in flags) r[k] = flags[k];
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// frames, columns, exclusions
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {Frame} f
 * @param {number} index
 */
function normalizeFrame(f, index) {
  const ins = f.insets || {};
  const top = Number(ins.top) || 0;
  const right = Number(ins.right) || 0;
  const bottom = Number(ins.bottom) || 0;
  const left = Number(ins.left) || 0;
  const columns = Math.max(1, Math.floor(Number(f.columns) || 1));
  const gutter = f.gutter === undefined ? 12 : Math.max(0, Number(f.gutter) || 0);
  const x = Number(f.x) || 0;
  const y = Number(f.y) || 0;
  const w = Math.max(0, Number(f.w) || 0);
  const h = Math.max(0, Number(f.h) || 0);
  const cx = x + left;
  const cw = Math.max(0, w - left - right);
  const ctop = y + top;
  const auto = !!f.autoHeight;
  const ch = auto ? Infinity : Math.max(0, h - top - bottom);
  let colW = (cw - gutter * (columns - 1)) / columns;
  let gut = gutter;
  if (colW < 1) {
    colW = Math.max(1, cw / columns);
    gut = 0;
  }
  const cols = [];
  for (let k = 0; k < columns; k++) cols.push({ x: cx + k * (colW + gut), w: colW, top: ctop, bottom: ctop + ch });
  /** @type {{x0:number,x1:number,y0:number,y1:number,jump:boolean}[]|null} */
  let exc = null;
  if (Array.isArray(f.exclusions) && f.exclusions.length) {
    exc = [];
    for (const e of f.exclusions) {
      if (!e) continue;
      const m = Number(e.margin) || 0;
      const ex = Number(e.x) || 0;
      const ey = Number(e.y) || 0;
      exc.push({ x0: ex - m, x1: ex + (Number(e.w) || 0) + m, y0: ey - m, y1: ey + (Number(e.h) || 0) + m, jump: !!e.jump });
    }
    if (!exc.length) exc = null;
  }
  const bg = f.baselineGrid;
  const grid = bg && Number(bg.spacing) > 0 ? { offset: Number(bg.offset) || 0, spacing: Number(bg.spacing) } : null;
  const va = f.verticalAlign === 'center' || f.verticalAlign === 'bottom' || f.verticalAlign === 'justify' ? f.verticalAlign : 'top';
  return { index, x, y, w, h, insets: { top, right, bottom, left }, cols, exc, grid, valign: va, auto };
}

/**
 * Free horizontal intervals of a column for a band [y, y+h); flat array [x0,x1,x0,x1,...].
 * @param {{x:number,w:number}} col
 * @param {any[]} exc
 * @param {number} y
 * @param {number} h
 * @param {number} minW
 * @returns {number[]}
 */
function freeSlots(col, exc, y, h, minW) {
  let ints = [col.x, col.x + col.w];
  let touched = false;
  for (const e of exc) {
    if (!(e.y1 > y + EPS && e.y0 < y + h - EPS)) continue;
    touched = true;
    if (e.jump) return [];
    const next = [];
    for (let i = 0; i < ints.length; i += 2) {
      const a0 = ints[i];
      const a1 = ints[i + 1];
      if (e.x1 <= a0 || e.x0 >= a1) {
        next.push(a0, a1);
        continue;
      }
      if (e.x0 > a0) next.push(a0, e.x0);
      if (e.x1 < a1) next.push(e.x1, a1);
    }
    ints = next;
  }
  if (!touched) return ints;
  const out = [];
  for (let i = 0; i < ints.length; i += 2) if (ints[i + 1] - ints[i] >= minW) out.push(ints[i], ints[i + 1]);
  return out;
}

/**
 * Smallest y below `y` where the set of overlapping exclusions changes.
 * @param {any[]} exc
 * @param {number} y
 * @param {number} h
 */
function nextClearY(exc, y, h) {
  let best = Infinity;
  for (const e of exc) {
    if (e.y1 > y + EPS && e.y0 < y + h - EPS && e.y1 < best) best = e.y1;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// flowing paragraphs through frames
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} FlowState
 * @property {number} fi
 * @property {number} ci
 * @property {number} y
 * @property {number} slot
 * @property {number} band
 * @property {boolean} atTop
 * @property {number} prevAfter
 */

/**
 * Places the lines of a paragraph starting from state `S0` without committing anything.
 * @param {any} P
 * @param {FlowState} S0
 * @param {{before:boolean, after:Set<number>}} brk forced column breaks
 * @param {any} flow
 */
function placeParagraph(P, S0, brk, flow) {
  const { geoms, ctx } = flow;
  /** @type {FlowState} */
  const S = { fi: S0.fi, ci: S0.ci, y: S0.y, slot: S0.slot, band: S0.band, atTop: S0.atTop, prevAfter: S0.prevAfter };
  const pa = P.pa;
  /** @type {any[]} */
  const lines = [];
  let overflow = false;
  const advance = () => {
    S.ci++;
    if (S.fi >= geoms.length) return false;
    if (S.ci >= geoms[S.fi].cols.length) {
      S.fi++;
      S.ci = 0;
    }
    if (S.fi >= geoms.length) return false;
    const col = geoms[S.fi].cols[S.ci];
    S.y = col.top;
    S.slot = 0;
    S.band = col.top;
    S.atTop = true;
    S.prevAfter = 0;
    return true;
  };
  const closeBand = () => {
    if (S.slot > 0) {
      S.y = Math.max(S.y, S.band);
      S.slot = 0;
    }
    S.band = S.y;
  };
  const result = (startedAtTop) => ({ lines, S1: S, overflow, startedAtTop });

  if (S.fi >= geoms.length) {
    overflow = true;
    return result(false);
  }
  let startedAtTop;
  if (brk.before) {
    if (!advance()) {
      overflow = true;
      return result(false);
    }
    startedAtTop = true;
  } else {
    startedAtTop = S.atTop;
    if (!S.atTop) {
      closeBand();
      S.y += S.prevAfter + (pa.spaceBefore > 0 ? pa.spaceBefore : 0);
      S.band = S.y;
    }
  }

  const indentLeft = Number(pa.indentLeft) || 0;
  const indentRight = Number(pa.indentRight) || 0;
  const indentFirst = Number(pa.indentFirst) || 0;
  const bullet = P.bullet;
  let bulletIndent = 0;
  if (bullet) {
    const ch = P.chunks.length ? P.chunks[0] : P.base;
    bulletIndent = bullet.indent > 0 ? bullet.indent : Math.max(12, ch.font.size * 1.5);
  }
  const drop = P.drop;
  const minHyphOK = !!(ctx.hyphenate && pa.hyphenate);

  let si = 0;
  let ssub = 0;
  let lineIdx = 0;
  let hyphRun = 0;
  let guard = 0;
  let dropSlotX = 0;
  outer: for (;;) {
    for (;;) {
      if (++guard > 200000) {
        overflow = true;
        break outer;
      }
      const g = geoms[S.fi];
      const col = g.cols[S.ci];
      let x0;
      let x1;
      let nSlots = 1;
      if (g.exc) {
        const list = freeSlots(col, g.exc, S.y, P.hEst, Math.min(col.w, Math.max(P.hEst, 6)));
        if (list.length === 0) {
          const ny = nextClearY(g.exc, S.y, P.hEst);
          if (isFinite(ny) && ny > S.y + EPS) {
            S.y = ny;
            S.slot = 0;
            S.band = ny;
          } else if (!advance()) {
            overflow = true;
            break outer;
          }
          continue;
        }
        nSlots = list.length / 2;
        if (S.slot >= nSlots) {
          S.y = Math.max(S.band, S.y + 0.5);
          S.slot = 0;
          S.band = S.y;
          continue;
        }
        x0 = list[S.slot * 2];
        x1 = list[S.slot * 2 + 1];
      } else {
        x0 = col.x;
        x1 = col.x + col.w;
      }
      // horizontal geometry of this line
      let left;
      let markerX = 0;
      let dropX = 0;
      let dropApplied = false;
      if (bullet) {
        left = x0 + indentLeft + bulletIndent;
        markerX = x0 + indentLeft + indentFirst;
      } else {
        left = x0 + indentLeft + (lineIdx === 0 ? indentFirst : 0);
        if (drop && lineIdx < drop.L) {
          if (lineIdx === 0) dropSlotX = x0;
          dropX = left;
          // the text only makes room for the drop cap beside it (the slot of the first line)
          if (Math.abs(x0 - dropSlotX) < 1e-6) {
            left += drop.indent;
            dropApplied = true;
          }
        }
      }
      let avail = x1 - indentRight - left;
      if (dropApplied && avail < P.hEst) {
        // the drop cap is wider than the slot: let the text overlap it instead of leaving the slot
        left -= drop.indent;
        avail = x1 - indentRight - left;
      }
      if (avail < 1) {
        // the indents leave no room at all: ignore them so the text stays inside the slot
        left = x0;
        avail = Math.max(1, x1 - x0);
      }
      const d = breakLine(P, si, ssub, avail, left - col.x, ctx, minHyphOK && hyphRun < ctx.maxHyph);
      const { asc, dsc } = lineAscDesc(P, d);
      const h = asc + dsc;
      let top = S.y;
      let baseline = top + asc;
      if (g.grid) {
        const k = Math.ceil((baseline - g.y - g.grid.offset - 1e-6) / g.grid.spacing);
        const snapped = g.y + g.grid.offset + k * g.grid.spacing;
        top += snapped - baseline;
        baseline = snapped;
      }
      if (top + h > col.bottom + EPS) {
        if (!advance()) {
          overflow = true;
          break outer;
        }
        continue;
      }
      lines.push({ d, fi: S.fi, ci: S.ci, lineIdx, left, avail, top, baseline, asc, dsc, h, colX: col.x, markerX, dropX, x0, x1 });
      const bottom = top + h;
      S.band = Math.max(S.band, bottom);
      if (nSlots > 1 && S.slot + 1 < nSlots) {
        S.slot++;
      } else {
        S.y = S.band;
        S.slot = 0;
      }
      S.atTop = false;
      si = d.ei;
      ssub = d.esub;
      lineIdx++;
      hyphRun = d.hyph ? hyphRun + 1 : 0;
      if (d.last) break outer;
      if (brk.after.has(lineIdx - 1)) {
        closeBand();
        if (!advance()) {
          overflow = true;
          break outer;
        }
      }
      break;
    }
  }
  if (!overflow) {
    closeBand();
    if (drop && lines.length && lines.length < drop.L) {
      const need = lines[0].top + drop.L * drop.lineH;
      if (need > S.y) {
        S.y = need;
        S.band = need;
      }
    }
    S.prevAfter = pa.spaceAfter > 0 ? pa.spaceAfter : 0;
  } else {
    closeBand();
  }
  return result(startedAtTop);
}

/**
 * Splits placed lines into column segments.
 * @param {any[]} lines
 */
function segments(lines) {
  const segs = [];
  let cur = null;
  for (const l of lines) {
    if (!cur || cur.fi !== l.fi || cur.ci !== l.ci) {
      cur = { fi: l.fi, ci: l.ci, count: 0 };
      segs.push(cur);
    }
    cur.count++;
  }
  return segs;
}

/**
 * Places a paragraph applying widow/orphan, keep-lines-together and drop cap rules by re-flowing with forced
 * column breaks.
 * @param {number} pi
 * @param {FlowState} S
 * @param {any} flow
 * @param {boolean} forceBefore
 */
function placeWithRules(pi, S, flow, forceBefore) {
  const P = flow.prep(pi);
  const wo = P.pa.widowOrphan;
  const minL = wo === undefined || wo === null ? 2 : Math.max(1, Math.floor(wo));
  const keepTog = !!P.pa.keepLinesTogether;
  const dropL = P.drop ? P.drop.L : 0;
  const brk = { before: !!forceBefore, after: new Set() };
  let res = placeParagraph(P, S, brk, flow);
  for (let attempt = 0; attempt < 8; attempt++) {
    const lines = res.lines;
    if (!lines.length) break;
    const segs = segments(lines);
    const m = segs.length;
    const N = lines.length;
    const atTop = res.startedAtTop;
    let redo = false;
    if (res.overflow) {
      if (!atTop && !brk.before && ((m === 1 && segs[0].count < minL) || keepTog || (dropL && segs[0].count < dropL))) {
        brk.before = true;
        redo = true;
      }
    } else if (m > 1) {
      if (!atTop && !brk.before && (keepTog || segs[0].count < Math.min(minL, N) || (dropL && segs[0].count < Math.min(dropL, N)))) {
        brk.before = true;
        redo = true;
      } else {
        const last = segs[m - 1].count;
        const needTotal = Math.min(minL, N);
        if (last < needTotal) {
          const need = needTotal - last;
          const prevCount = segs[m - 2].count;
          const keepPrev = m - 2 === 0 ? Math.min(minL, N) : 1;
          if (prevCount - need >= keepPrev) {
            const idx = N - last - need - 1;
            if (!brk.after.has(idx)) {
              brk.after.add(idx);
              redo = true;
            }
          } else if (!atTop && m - 2 === 0 && !brk.before) {
            brk.before = true;
            redo = true;
          }
        }
      }
    }
    if (!redo) break;
    res = placeParagraph(P, S, brk, flow);
  }
  return res;
}

/**
 * keep-with-next: checks whether the first lines of the following paragraph(s) share a column with the last line of
 * the paragraph that has just been placed.
 * @param {number} pi
 * @param {any} res placement of paragraph `pi`
 * @param {any} flow
 * @returns {boolean} true when the chain is broken
 */
function chainBroken(pi, res, flow) {
  let prevRes = res;
  let idx = pi;
  const noBrk = { before: false, after: new Set() };
  for (let step = 0; step < 6; step++) {
    const Pc = flow.prep(idx);
    if (!Pc.pa.keepWithNext || idx + 1 >= flow.nP) return false;
    const lastLine = prevRes.lines[prevRes.lines.length - 1];
    if (!lastLine) return false;
    const Q = flow.prep(idx + 1);
    const dry = placeParagraph(Q, prevRes.S1, noBrk, flow);
    if (!dry.lines.length) return true;
    const wo = Q.pa.widowOrphan;
    const minL = wo === undefined || wo === null ? 2 : Math.max(1, Math.floor(wo));
    const N = dry.overflow ? Infinity : dry.lines.length;
    const need = Q.pa.keepLinesTogether ? N : Math.min(minL, N);
    if (need === Infinity) return true;
    const first = dry.lines[0];
    if (first.fi !== lastLine.fi || first.ci !== lastLine.ci) return true;
    let c0 = 0;
    for (const l of dry.lines) {
      if (l.fi === first.fi && l.ci === first.ci) c0++;
      else break;
    }
    if (c0 < need) return true;
    prevRes = dry;
    idx++;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------------------------------------------

/**
 * Lays a story out in a chain of frames.
 *
 * Frames are chained: text that does not fit frame `i` continues in frame `i + 1`; inside a frame text flows through
 * its columns left to right. See the module header for coordinate and offset conventions.
 *
 * @param {import('./text-model.js').Story} story
 * @param {Frame[]} frames
 * @param {LayoutOptions} [opts]
 * @returns {LayoutResult}
 */
export function layoutStory(story, frames, opts) {
  const o = opts || {};
  const ctx = makeCtx(o);
  const paragraphs = story && Array.isArray(story.paragraphs) && story.paragraphs.length ? story.paragraphs : [{ runs: [] }];
  const nP = paragraphs.length;
  const geoms = (Array.isArray(frames) ? frames : []).map(normalizeFrame);
  const total = storyLength({ paragraphs });

  // paragraph start offsets
  const pStart = new Array(nP);
  {
    let s = 0;
    for (let i = 0; i < nP; i++) {
      pStart[i] = s;
      let len = 0;
      const runs = paragraphs[i].runs || [];
      for (let k = 0; k < runs.length; k++) len += (runs[k].text || '').length;
      s += len + 1;
    }
  }

  /** @type {any[]} */
  const preps = new Array(nP);
  const flow = {
    ctx,
    geoms,
    nP,
    prep(pi) {
      return preps[pi] || (preps[pi] = prepare(paragraphs[pi], ctx));
    },
  };

  /** @type {LayoutFrameResult[]} */
  const out = geoms.map((g) => ({
    index: g.index,
    x: g.x,
    y: g.y,
    w: g.w,
    h: g.h,
    lines: [],
    usedHeight: 0,
    overflow: false,
    firstChar: 0,
    lastChar: 0,
    columns: g.cols.map((c) => ({ x: c.x, w: c.w, top: c.top, bottom: c.bottom, first: 0, count: 0 })),
  }));

  const result = { frames: out, endOffset: 0, overflow: false };
  Object.defineProperty(result, '_measure', { value: ctx.measureFn, enumerable: false, writable: true });
  if (!geoms.length) {
    result.overflow = total > 0;
    return result;
  }

  const col0 = geoms[0].cols[0];
  /** @type {FlowState} */
  let S = { fi: 0, ci: 0, y: col0.top, slot: 0, band: col0.top, atTop: true, prevAfter: 0 };
  let overflow = false;
  let lastLine = null;
  // list numbering
  let listKind = null;
  let listCount = 0;

  for (let pi = 0; pi < nP; pi++) {
    const P = flow.prep(pi);
    let res = placeWithRules(pi, S, flow, false);
    if (!res.overflow && P.pa.keepWithNext && pi + 1 < nP && !res.startedAtTop && res.lines.length && chainBroken(pi, res, flow)) {
      res = placeWithRules(pi, S, flow, true);
    }
    // numbering state (committed paragraphs only, in order)
    let marker;
    const b = P.bullet;
    if (b) {
      if (b.kind === 'bullet') {
        marker = typeof b.char === 'string' && b.char ? b.char : '\u{2022}';
        listKind = 'bullet';
        listCount = 0;
      } else {
        if (listKind === b.kind) listCount++;
        else {
          listKind = b.kind;
          listCount = 1;
        }
        const num = b.kind === 'number' ? String(listCount) : b.kind === 'alpha' ? toAlpha(listCount, !!b.upper) : toRoman(listCount, !!b.upper);
        const pat = typeof b.char === 'string' && b.char ? (b.char.indexOf('#') >= 0 ? b.char : '#' + b.char) : '#.';
        marker = pat.replace('#', num);
      }
    } else {
      listKind = null;
      listCount = 0;
    }
    // commit
    for (const pl of res.lines) {
      const line = buildLine(P, pl, pStart[pi], pi, ctx, { marker });
      const fr = out[pl.fi];
      const colRec = fr.columns[pl.ci];
      if (colRec.count === 0) colRec.first = fr.lines.length;
      colRec.count++;
      fr.lines.push(line);
      lastLine = line;
    }
    S = res.S1;
    if (res.overflow) {
      overflow = true;
      break;
    }
  }

  // drop cap baselines and vertical alignment
  for (let fi = 0; fi < out.length; fi++) {
    const fr = out[fi];
    fixVertical(fr, geoms[fi]);
    const lines = fr.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.dropCap) continue;
      // the drop cap sits on the baseline of the L-th line of its paragraph (in the same column)
      let target = line;
      for (let k = 1; k < line.dropCap.lines; k++) {
        const nl = lines[i + k];
        if (!nl || nl.para !== line.para || nl.column !== line.column) break;
        target = nl;
      }
      line.dropCap.run.baselineShift = line.baseline - target.baseline;
    }
  }

  // frame metadata
  const nPm1 = nP - 1;
  let prevLast = 0;
  for (let fi = 0; fi < out.length; fi++) {
    const fr = out[fi];
    const g = geoms[fi];
    if (fr.lines.length) {
      const first = fr.lines[0];
      const last = fr.lines[fr.lines.length - 1];
      fr.firstChar = first.charStart;
      fr.lastChar = last.charEnd + (last.last && last.para < nPm1 ? 1 : 0);
      let bottom = g.cols[0].top;
      for (const l of fr.lines) bottom = Math.max(bottom, l.y + l.height);
      fr.usedHeight = bottom - g.cols[0].top;
      prevLast = fr.lastChar;
    } else {
      fr.firstChar = prevLast;
      fr.lastChar = prevLast;
    }
    if (g.auto) {
      fr.h = fr.usedHeight + g.insets.top + g.insets.bottom;
      for (const c of fr.columns) c.bottom = c.top + fr.usedHeight;
    }
  }
  if (!overflow) result.endOffset = total;
  else result.endOffset = lastLine ? lastLine.charEnd + (lastLine.last && lastLine.para < nPm1 ? 1 : 0) : 0;
  result.overflow = overflow;
  // only the last frame of the chain shows the overflow indicator
  if (out.length) out[out.length - 1].overflow = overflow;
  return result;
}

/**
 * Applies the frame's vertical alignment to each column.
 * @param {LayoutFrameResult} fr
 * @param {any} g
 */
function fixVertical(fr, g) {
  if (g.valign === 'top' || g.auto || g.exc || !fr.lines.length) return;
  for (let ci = 0; ci < fr.columns.length; ci++) {
    const c = fr.columns[ci];
    if (c.count === 0) continue;
    const lines = fr.lines.slice(c.first, c.first + c.count);
    const col = g.cols[ci];
    const last = lines[lines.length - 1];
    const free = col.bottom - (last.y + last.height);
    if (!(free > EPS)) continue;
    if (g.valign === 'center' || g.valign === 'bottom') {
      const sh = g.valign === 'center' ? free / 2 : free;
      for (const l of lines) shiftLine(l, sh);
    } else {
      // justify: distribute between paragraphs, or between lines when there is a single paragraph
      let gaps = [];
      for (let i = 1; i < lines.length; i++) if (lines[i].para !== lines[i - 1].para) gaps.push(i);
      if (!gaps.length) for (let i = 1; i < lines.length; i++) gaps.push(i);
      if (!gaps.length) continue;
      const per = free / gaps.length;
      let acc = 0;
      let gi = 0;
      for (let i = 0; i < lines.length; i++) {
        if (gi < gaps.length && gaps[gi] === i) {
          acc += per;
          gi++;
        }
        if (acc) shiftLine(lines[i], acc);
      }
    }
  }
}

/**
 * @param {any} l
 * @param {number} dy
 */
function shiftLine(l, dy) {
  l.y += dy;
  l.baseline += dy;
}
