/**
 * Caret, hit-testing and selection helpers on a layout result (see `layoutStory`). The host builds its in-canvas
 * text editor on these functions.
 *
 * Conventions:
 * - Offsets are story offsets (text-model.js). Rectangles and points use the coordinate space of the frames that were
 *   passed to `layoutStory`.
 * - An offset that is the end of a soft-wrapped line and the start of the next line is displayed at the start of the
 *   next line (`'downstream'` affinity, the default). `'upstream'` places it at the end of the previous line (what a host
 *   shows after the End key or after clicking right of a wrapped line; see {@link hitTestEx}).
 * - Trailing spaces hang: they occupy x positions beyond the visible end of a wrapped line, so every offset on a line
 *   has its own caret x.
 * - Measuring uses the `measure` function the layout was built with (kept on the result as a non-enumerable property);
 *   pass `opts.measure` when the result went through structured cloning.
 *
 * @module text-caret
 */

import { charClass } from './text-model.js';
import { approxMeasurer } from './measurers.js';

/**
 * @typedef {'downstream'|'upstream'} Affinity
 * @typedef {{frame:number, x:number, y:number, height:number, baseline:number, line:any, lineIndex:number}} CaretInfo
 */

/** @type {WeakMap<object, {lines:any[], frameStart:number[]}>} */
const flatCache = new WeakMap();

/**
 * Flat list of all lines of a result in flow order (cached per result object).
 * @param {any} result
 */
function flatten(result) {
  let c = flatCache.get(result);
  if (!c) {
    /** @type {any[]} */
    const lines = [];
    const frameStart = [];
    for (let fi = 0; fi < result.frames.length; fi++) {
      frameStart.push(lines.length);
      const fl = result.frames[fi].lines;
      for (let i = 0; i < fl.length; i++) lines.push(fl[i]);
    }
    c = { lines, frameStart };
    flatCache.set(result, c);
  }
  return c;
}

/**
 * @param {any} result
 * @param {{measure?: Function}} [opts]
 */
function measureOf(result, opts) {
  return (opts && opts.measure) || result._measure || approxMeasurer.measure;
}

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

/**
 * Index (into the flat list) of the line that shows `offset`, or -1.
 * @param {any[]} lines
 * @param {number} offset
 * @param {Affinity} affinity
 */
function lineIndexFor(lines, offset, affinity) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].charStart <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  const line = lines[found];
  if (offset > line.charEnd) return -1;
  if (affinity === 'upstream' && found > 0 && offset === line.charStart && line.lineInPara > 0 && lines[found - 1].para === line.para) {
    return found - 1;
  }
  return found;
}

/**
 * Caret x of an offset on a line.
 * @param {any} line
 * @param {number} off
 * @param {Function} measure
 */
function xAtOffset(line, off, measure) {
  const runs = line.runs;
  let last = null;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.charEnd <= r.charStart) continue; // synthetic (leader, hyphen)
    last = r;
    if (off <= r.charEnd) return xInRun(r, off, measure);
  }
  return last ? last.x + last.width : line.x;
}

/**
 * @param {any} r
 * @param {number} off
 * @param {Function} measure
 */
function xInRun(r, off, measure) {
  const k = off - r.charStart;
  const sl = r.charEnd - r.charStart;
  if (k <= 0) return r.x;
  if (k >= sl) return r.x + r.width;
  if (r.tab || r.zw || r.field !== undefined) return k * 2 < sl ? r.x : r.x + r.width;
  const prefix = r.text.slice(0, k);
  let w = measure(r.font, prefix);
  if (!(w >= 0) || !isFinite(w)) w = 0;
  if (r.letterSpacing) w += r.letterSpacing * cpCount(prefix);
  if (r.wordSpacing) {
    let n = 0;
    for (let i = 0; i < prefix.length; i++) {
      const c = prefix.charCodeAt(i);
      if (c === 0x20 || c === 0xa0) n++;
    }
    w += n * r.wordSpacing;
  }
  return r.x + w;
}

/**
 * Whether `off` lies between the two halves of a surrogate pair on the line.
 * @param {any} line
 * @param {number} off
 */
function insideSurrogate(line, off) {
  for (const r of line.runs) {
    if (r.charEnd <= r.charStart || r.tab || r.zw || r.field !== undefined) continue;
    if (off > r.charStart && off < r.charEnd) {
      const k = off - r.charStart;
      const h = r.text.charCodeAt(k - 1);
      const l = r.text.charCodeAt(k);
      return h >= 0xd800 && h < 0xdc00 && l >= 0xdc00 && l < 0xe000;
    }
  }
  return false;
}

/**
 * Nearest offset on a line for a given x. Returns the offset and the affinity to display it with.
 * @param {any} line
 * @param {number} x
 * @param {Function} measure
 * @returns {{offset:number, affinity:Affinity}}
 */
function offsetAtX(line, x, measure) {
  const lo = line.charStart;
  let hi = line.charEnd;
  // the offset at the very end of a soft-wrapped line shows at the start of the next line, so it can only be hit
  // when nothing hangs behind the line (a line that was broken inside a word or after a hyphen)
  if (!line.last && (line.hard || line.hang > 0)) hi = Math.max(lo, line.charEnd - 1);
  if (hi <= lo) return { offset: lo, affinity: 'downstream' };
  // smallest k in [lo, hi] with xAt(k) >= x
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (xAtOffset(line, mid, measure) >= x) b = mid;
    else a = mid + 1;
  }
  let k = a;
  if (k > lo) {
    const xk = xAtOffset(line, k, measure);
    const xp = xAtOffset(line, k - 1, measure);
    if (x - xp <= xk - x) k = k - 1; // ties go to the smaller offset
  }
  if (insideSurrogate(line, k)) {
    const xl = xAtOffset(line, k - 1, measure);
    const xr = xAtOffset(line, k + 1, measure);
    k = x - xl < xr - x ? k - 1 : k + 1;
  }
  const affinity = k === line.charEnd && !line.last && !(line.hard) && k > lo ? 'upstream' : 'downstream';
  return { offset: k, affinity };
}

/**
 * Caret geometry for a story offset.
 *
 * @param {import('./text-layout.js').LayoutResult} result
 * @param {number} offset
 * @param {Affinity} [affinity='downstream'] which line to use at a soft line wrap
 * @param {{measure?: Function}} [opts]
 * @returns {CaretInfo|null} `null` when the offset was not laid out (overflow / outside the story)
 */
export function offsetToCaret(result, offset, affinity, opts) {
  const { lines } = flatten(result);
  const idx = lineIndexFor(lines, offset, affinity === 'upstream' ? 'upstream' : 'downstream');
  if (idx < 0) return null;
  const line = lines[idx];
  const x = xAtOffset(line, offset, measureOf(result, opts));
  return { frame: line.frame, x, y: line.y, height: line.height, baseline: line.baseline, line, lineIndex: idx };
}

/**
 * Finds the line of a frame under a point (column by x, line by y; points outside snap to the nearest line).
 * @param {any} frame
 * @param {number} x
 * @param {number} y
 * @returns {any|null}
 */
function lineAtPoint(frame, x, y) {
  if (!frame || !frame.lines.length) return null;
  // a line whose box contains the point wins, whatever column it is in (content may exceed its column)
  let edge = null;
  for (let i = 0; i < frame.lines.length; i++) {
    const l = frame.lines[i];
    const left = l.left !== undefined ? l.left : l.x;
    if (y < l.y || y >= l.y + l.height || x < left - 1e-9) continue;
    const right = l.right !== undefined ? l.right : l.x + l.width;
    if (x < right - 1e-9) return l;
    if (x <= right + 1e-9 && !edge) edge = l; // exactly at the end of a line: only if no line contains the point
  }
  if (edge) return edge;
  // column
  let best = -1;
  let bestD = Infinity;
  for (let ci = 0; ci < frame.columns.length; ci++) {
    const c = frame.columns[ci];
    if (!c.count) continue;
    const d = x < c.x ? c.x - x : x > c.x + c.w ? x - (c.x + c.w) : 0;
    if (d < bestD) {
      bestD = d;
      best = ci;
    }
  }
  if (best < 0) return null;
  const col = frame.columns[best];
  let pick = null;
  let pickV = Infinity;
  let pickH = Infinity;
  for (let i = col.first; i < col.first + col.count; i++) {
    const l = frame.lines[i];
    const v = y < l.y ? l.y - y : y >= l.y + l.height ? y - (l.y + l.height) + 1e-6 : 0;
    const lx0 = l.left !== undefined ? l.left : l.x;
    const lx1 = l.right !== undefined ? l.right : l.x + Math.max(l.width, 0);
    const h = x < lx0 ? lx0 - x : x > lx1 ? x - lx1 : 0;
    if (v < pickV - 1e-9 || (Math.abs(v - pickV) <= 1e-9 && h < pickH)) {
      pick = l;
      pickV = v;
      pickH = h;
    }
  }
  return pick;
}

/**
 * Like {@link hitTest}, but also returns the affinity to display the caret with (a click right of a soft-wrapped line
 * yields the line's end offset with `'upstream'` affinity).
 * @param {import('./text-layout.js').LayoutResult} result
 * @param {number} frameIndex
 * @param {number} x
 * @param {number} y
 * @param {{measure?: Function}} [opts]
 * @returns {{offset:number, affinity:Affinity}}
 */
export function hitTestEx(result, frameIndex, x, y, opts) {
  const frame = result.frames[frameIndex];
  if (!frame) return { offset: 0, affinity: 'downstream' };
  const line = lineAtPoint(frame, x, y);
  if (!line) return { offset: frame.firstChar, affinity: 'downstream' };
  return offsetAtX(line, x, measureOf(result, opts));
}

/**
 * Maps a point inside a frame to the nearest story offset.
 * `offsetToCaret(hitTest(p))` and `hitTest(offsetToCaret(o))` are inverse to each other for every offset that has a
 * visible caret position.
 * @param {import('./text-layout.js').LayoutResult} result
 * @param {number} frameIndex
 * @param {number} x
 * @param {number} y
 * @param {{measure?: Function}} [opts]
 * @returns {number}
 */
export function hitTest(result, frameIndex, x, y, opts) {
  return hitTestEx(result, frameIndex, x, y, opts).offset;
}

/**
 * Selection rectangles (one per line) for the range [from, to). A selected paragraph break or forced line break
 * extends the rectangle of its line by a small stub, and a selected empty paragraph yields a stub rectangle.
 * @param {import('./text-layout.js').LayoutResult} result
 * @param {number} from
 * @param {number} to
 * @param {{measure?: Function}} [opts]
 * @returns {{frame:number, x:number, y:number, w:number, h:number}[]}
 */
export function selectionRects(result, from, to, opts) {
  if (from > to) [from, to] = [to, from];
  const out = [];
  if (!(to > from)) return out;
  const { lines } = flatten(result);
  if (!lines.length) return out;
  const measure = measureOf(result, opts);
  let start = lineIndexFor(lines, from, 'downstream');
  if (start < 0) start = from < lines[0].charStart ? 0 : lines.length;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.charStart > to) break;
    const a = Math.max(from, line.charStart);
    const b = Math.min(to, line.charEnd);
    const empty = line.charStart === line.charEnd;
    if (!(a < b) && !(empty && from <= line.charStart && to > line.charStart)) continue;
    const stub = Math.max(2, line.height * 0.25);
    const breakSelected = (line.last && to > line.charEnd) || (line.hard && to >= line.charEnd && from < line.charEnd);
    let x0 = xAtOffset(line, a, measure);
    let x1 = xAtOffset(line, b, measure);
    if (empty) {
      x0 = line.x;
      x1 = line.x;
    }
    if (x1 < x0) [x0, x1] = [x1, x0];
    out.push({ frame: line.frame, x: x0, y: line.y, w: x1 - x0 + (breakSelected || empty ? stub : 0), h: line.height });
  }
  return out;
}

/**
 * Moves the caret one visual line up (`dir < 0`) or down (`dir > 0`), keeping the horizontal goal position.
 * Movement follows the flow: past the last line of a column it continues in the next column / frame. At the very
 * first / last line the caret moves to the start / end of the laid out text.
 * @param {import('./text-layout.js').LayoutResult} result
 * @param {number} offset
 * @param {number} dir negative = up, positive = down
 * @param {number|null|undefined} goalX horizontal goal (defaults to the current caret x)
 * @param {{measure?: Function}} [opts]
 * @returns {{offset:number, goalX:number, affinity:Affinity}}
 */
export function moveCaretVertical(result, offset, dir, goalX, opts) {
  const { lines } = flatten(result);
  const measure = measureOf(result, opts);
  const idx = lineIndexFor(lines, offset, 'downstream');
  if (idx < 0) return { offset, goalX: goalX === null || goalX === undefined ? 0 : goalX, affinity: 'downstream' };
  const cur = lines[idx];
  const gx = goalX === null || goalX === undefined || !isFinite(goalX) ? xAtOffset(cur, offset, measure) : goalX;
  const up = dir < 0;
  const E = 0.5;

  const colX = (l) => {
    const c = result.frames[l.frame] && result.frames[l.frame].columns[l.column];
    return c ? c.x : 0;
  };
  /** goal x expressed in the column of line `l` (the goal is kept relative to the column's left edge) */
  const goalIn = (l) => (l.frame === cur.frame && l.column === cur.column ? gx : gx - colX(cur) + colX(l));

  /** pick the line of the band that starts at flat index `j` (moving in `step` direction) closest to the goal */
  const pickBand = (j, step) => {
    const gx = goalIn(lines[j]);
    const y0 = lines[j].y;
    const col = lines[j].column;
    const fr = lines[j].frame;
    let best = lines[j];
    let bestD = Infinity;
    for (let q = j; q >= 0 && q < lines.length; q += step) {
      const l = lines[q];
      if (Math.abs(l.y - y0) > E || l.column !== col || l.frame !== fr) break;
      const x1 = l.x + Math.max(l.width, 0);
      const d = gx < l.x ? l.x - gx : gx > x1 ? gx - x1 : 0;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best;
  };

  let target = null;
  if (!up) {
    const bottom = cur.y + cur.height;
    let j = idx + 1;
    while (j < lines.length && lines[j].frame === cur.frame && lines[j].column === cur.column && lines[j].y < bottom - E) j++;
    if (j < lines.length) target = pickBand(j, 1);
  } else {
    let j = idx - 1;
    while (j >= 0 && lines[j].frame === cur.frame && lines[j].column === cur.column && lines[j].y + lines[j].height > cur.y + E) j--;
    if (j >= 0) {
      // the band is the group of lines that share the bottom-most y found
      let top = j;
      while (top - 1 >= 0 && Math.abs(lines[top - 1].y - lines[j].y) <= E && lines[top - 1].column === lines[j].column && lines[top - 1].frame === lines[j].frame) top--;
      target = pickBand(top, 1);
    }
  }
  if (!target) {
    const edge = up ? lines[0] : lines[lines.length - 1];
    return { offset: up ? edge.charStart : edge.charEnd, goalX: gx, affinity: 'downstream' };
  }
  const gxT = goalIn(target);
  const r = offsetAtX(target, gxT, measure);
  return { offset: r.offset, goalX: gxT, affinity: r.affinity };
}

/**
 * Start offset of the line that shows `offset` (the Home key).
 * @param {import('./text-layout.js').LayoutResult} result
 * @param {number} offset
 * @returns {number}
 */
export function lineStart(result, offset) {
  const { lines } = flatten(result);
  const idx = lineIndexFor(lines, offset, 'downstream');
  return idx < 0 ? offset : lines[idx].charStart;
}

/**
 * End offset of the line that shows `offset` (the End key). For the last line of a paragraph this is the paragraph
 * end; for a soft-wrapped line it is the offset in front of the hanging trailing spaces (or the line end itself when
 * there are none, which a host should display with `'upstream'` affinity); for a line that ends in a forced line break
 * it is the offset in front of the break.
 * @param {import('./text-layout.js').LayoutResult} result
 * @param {number} offset
 * @returns {number}
 */
export function lineEnd(result, offset) {
  const { lines } = flatten(result);
  const idx = lineIndexFor(lines, offset, 'downstream');
  if (idx < 0) return offset;
  const l = lines[idx];
  if (l.last) return l.charEnd;
  if (l.hard) return Math.max(l.charStart, l.charEnd - 1);
  return l.hang > 0 ? l.charEnd - l.hang : l.charEnd;
}

/**
 * @param {string} s
 * @param {number} i
 */
function cpAt(s, i) {
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d < 0xe000) return ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
  }
  return c;
}

/**
 * @param {string} s
 * @param {number} i
 */
function cpBefore(s, i) {
  const c = s.charCodeAt(i - 1);
  if (c >= 0xdc00 && c < 0xe000 && i >= 2) {
    const h = s.charCodeAt(i - 2);
    if (h >= 0xd800 && h < 0xdc00) return ((h - 0xd800) << 10) + (c - 0xdc00) + 0x10000;
  }
  return c;
}

/**
 * Next word boundary for Ctrl+Left / Ctrl+Right (Windows style): moving forward lands on the start of the next word,
 * moving backward on the start of the current / previous word. Punctuation runs count as words, every CJK character is
 * its own word, and a move at a paragraph edge crosses into the neighboring paragraph.
 * @param {import('./text-model.js').Story} story
 * @param {number} offset
 * @param {number} dir negative = backward, positive = forward
 * @returns {number}
 */
export function wordBoundary(story, offset, dir) {
  const ps = story.paragraphs;
  let start = 0;
  let pi = 0;
  let text = '';
  let len = 0;
  offset = Math.max(0, Math.trunc(offset) || 0);
  for (; pi < ps.length; pi++) {
    text = '';
    for (const r of ps[pi].runs) text += r.text;
    len = text.length;
    if (offset <= start + len) break;
    start += len + 1;
  }
  if (pi >= ps.length) return start - 1 >= 0 && ps.length ? start - 1 : 0; // beyond the end: clamp to the end
  let local = offset - start;
  if (dir >= 0) {
    if (local >= len) return pi + 1 < ps.length ? start + len + 1 : start + len;
    const cls = charClass(cpAt(text, local));
    if (cls !== 's') {
      if (cls === 'c') local += cpAt(text, local) > 0xffff ? 2 : 1;
      else {
        while (local < len) {
          const cp = cpAt(text, local);
          if (charClass(cp) !== cls) break;
          local += cp > 0xffff ? 2 : 1;
        }
      }
    }
    while (local < len) {
      const cp = cpAt(text, local);
      if (charClass(cp) !== 's') break;
      local += cp > 0xffff ? 2 : 1;
    }
    return start + local;
  }
  if (local <= 0) return pi > 0 ? start - 1 : 0;
  while (local > 0) {
    const cp = cpBefore(text, local);
    if (charClass(cp) !== 's') break;
    local -= cp > 0xffff ? 2 : 1;
  }
  if (local <= 0) return start;
  const cls = charClass(cpBefore(text, local));
  if (cls === 'c') return start + local - (cpBefore(text, local) > 0xffff ? 2 : 1);
  while (local > 0) {
    const cp = cpBefore(text, local);
    if (charClass(cp) !== cls) break;
    local -= cp > 0xffff ? 2 : 1;
  }
  return start + local;
}
