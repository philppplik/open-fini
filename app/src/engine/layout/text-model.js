/**
 * Rich-text model helpers (Story / Paragraph / Run) for the Layout studio.
 *
 * All functions are immutable-style: inputs are never mutated, untouched paragraphs keep their object
 * identity (so layout caches keyed on paragraph objects stay valid), and results are normalized to a canonical
 * form (no empty runs, no adjacent identical runs, no empty `attrs` objects, at least one paragraph).
 *
 * Addressing: a story is addressed by a single character offset in UTF-16 code units. A paragraph break counts as
 * one character, so `storyLength(story) = sum(paragraph text lengths) + paragraphs - 1`. The offset right after
 * the last character of paragraph `i` is still inside paragraph `i`; the next offset is the start of paragraph `i+1`.
 *
 * Text conventions: runs never contain '\n'. '\t' is a tab and U+2028 is a forced line break. Input text passed to
 * {@link insertText} is normalized by {@link normalizeInputText}.
 *
 * Types (see docs/engine-contracts.md section 3): CharAttrs, ParaAttrs, Run, Paragraph, Story, Styles, Defaults.
 *
 * @module text-model
 */

/**
 * @typedef {Object} CharAttrs
 * @property {string} [fontFamily]
 * @property {number} [fontSize] px
 * @property {number} [fontWeight]
 * @property {'normal'|'italic'} [fontStyle]
 * @property {string} [color]
 * @property {boolean} [underline]
 * @property {boolean} [strike]
 * @property {number} [tracking] 1/1000 em added after each glyph
 * @property {number} [baselineShift] px, positive = up
 * @property {'none'|'upper'|'small'} [caps]
 * @property {string} [field]
 */
/**
 * @typedef {Object} ParaAttrs
 * @property {'left'|'center'|'right'|'justify'} [align]
 * @property {number} [lineHeight]
 * @property {number} [spaceBefore]
 * @property {number} [spaceAfter]
 * @property {number} [indentFirst]
 * @property {number} [indentLeft]
 * @property {number} [indentRight]
 * @property {boolean} [hyphenate]
 * @property {boolean} [keepLinesTogether]
 * @property {boolean} [keepWithNext]
 * @property {number} [widowOrphan]
 * @property {null|{kind:'bullet'|'number'|'alpha'|'roman', char?:string, indent?:number, upper?:boolean}} [bullet]
 * @property {null|{lines:number, chars:number}} [dropCap]
 * @property {{pos:number, align:'left'|'right'|'center'|'decimal', leader?:string}[]} [tabs]
 */
/** @typedef {{text: string, attrs?: CharAttrs, styleId?: string}} Run */
/** @typedef {{runs: Run[], attrs?: ParaAttrs, styleId?: string}} Paragraph */
/** @typedef {{paragraphs: Paragraph[]}} Story */

const hasOwn = Object.prototype.hasOwnProperty;

/** Default resolution base used when the host passes no `defaults`. */
export const DEFAULTS = Object.freeze({
  char: Object.freeze({ fontFamily: 'Helvetica', fontSize: 12, fontWeight: 400, fontStyle: 'normal', color: '#000000' }),
  para: Object.freeze({ align: 'left', lineHeight: 1.25, widowOrphan: 2 }),
});

/** @param {any} v */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------
// canonical form
// ---------------------------------------------------------------------------------------------------------------

/**
 * Deep structural equality for attribute values (primitives, arrays, plain objects).
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  let n = 0;
  for (const k in a) {
    if (a[k] === undefined) continue;
    if (!deepEqual(a[k], b[k])) return false;
    n++;
  }
  let m = 0;
  for (const k in b) if (b[k] !== undefined) m++;
  return n === m;
}

/**
 * Returns `a` when it is already canonical, a cleaned copy otherwise, or `undefined` when it carries no values.
 * @param {object|undefined|null} a
 * @returns {object|undefined}
 */
function canonAttrs(a) {
  if (!a || typeof a !== 'object') return undefined;
  let n = 0;
  let bad = false;
  for (const k in a) {
    n++;
    if (a[k] === undefined) bad = true;
  }
  if (n === 0) return undefined;
  if (!bad) return a;
  /** @type {any} */
  const o = {};
  let c = 0;
  for (const k in a) {
    if (a[k] !== undefined) {
      o[k] = a[k];
      c++;
    }
  }
  return c ? o : undefined;
}

/**
 * @param {string} text
 * @param {object|undefined} attrs canonical
 * @param {string|undefined} styleId canonical
 */
function mkRun(text, attrs, styleId) {
  /** @type {any} */
  const r = { text };
  if (attrs) r.attrs = attrs;
  if (styleId) r.styleId = styleId;
  return r;
}

/**
 * @param {any[]} runs
 * @param {object|undefined} attrs
 * @param {string|undefined} styleId
 */
function mkPara(runs, attrs, styleId) {
  /** @type {any} */
  const p = { runs };
  const ca = canonAttrs(attrs);
  if (ca) p.attrs = ca;
  if (styleId) p.styleId = styleId;
  return p;
}

/** @param {any} p */
function isCanonicalPara(p) {
  if (!p || !Array.isArray(p.runs)) return false;
  if (p.attrs !== undefined && canonAttrs(p.attrs) !== p.attrs) return false;
  if ('attrs' in p && p.attrs === undefined) return false;
  if ('styleId' in p && !p.styleId) return false;
  let prev = null;
  for (let i = 0; i < p.runs.length; i++) {
    const r = p.runs[i];
    if (!r || typeof r.text !== 'string' || r.text.length === 0) return false;
    if (r.attrs !== undefined && canonAttrs(r.attrs) !== r.attrs) return false;
    if ('attrs' in r && r.attrs === undefined) return false;
    if ('styleId' in r && !r.styleId) return false;
    if (prev && prev.styleId === r.styleId && deepEqual(prev.attrs, r.attrs)) return false;
    prev = r;
  }
  return true;
}

/**
 * Canonicalizes one paragraph (drops empty runs, merges identical neighbors). Returns the same object when it is
 * already canonical.
 * @param {any} p
 * @returns {any}
 */
function normalizePara(p) {
  if (isCanonicalPara(p)) return p;
  /** @type {any[]} */
  const runs = [];
  const src = Array.isArray(p && p.runs) ? p.runs : [];
  for (let i = 0; i < src.length; i++) {
    const r = src[i];
    if (!r || typeof r.text !== 'string' || r.text.length === 0) continue;
    const ca = canonAttrs(r.attrs);
    const sid = r.styleId || undefined;
    const prev = runs[runs.length - 1];
    if (prev && prev.styleId === sid && deepEqual(prev.attrs, ca)) {
      runs[runs.length - 1] = mkRun(prev.text + r.text, ca, sid);
    } else {
      runs.push(mkRun(r.text, ca, sid));
    }
  }
  return mkPara(runs, p && p.attrs, p && p.styleId);
}

/**
 * Normalizes a story: drops empty runs, merges adjacent runs with identical attributes and style, removes empty
 * `attrs` objects and guarantees at least one paragraph. Paragraphs that are already canonical keep their identity.
 * @param {Story} story
 * @returns {Story}
 */
export function normalizeStory(story) {
  const src = story && Array.isArray(story.paragraphs) ? story.paragraphs : [];
  let changed = !story || src.length === 0;
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = normalizePara(src[i]);
    if (out[i] !== src[i]) changed = true;
  }
  if (src.length === 0) out.push({ runs: [] });
  return changed ? { paragraphs: out } : story;
}

// ---------------------------------------------------------------------------------------------------------------
// lengths and offsets
// ---------------------------------------------------------------------------------------------------------------

/** @type {WeakMap<object, number>} */
const lenCache = new WeakMap();

/**
 * Text length of a paragraph in UTF-16 code units (cached per paragraph object).
 * @param {any} p
 * @returns {number}
 */
function plen(p) {
  let n = lenCache.get(p);
  if (n === undefined) {
    n = 0;
    const runs = p.runs;
    for (let i = 0; i < runs.length; i++) n += runs[i].text.length;
    lenCache.set(p, n);
  }
  return n;
}

/**
 * Total length of the story in characters (paragraph breaks count as one).
 * @param {Story} story
 * @returns {number}
 */
export function storyLength(story) {
  const ps = story.paragraphs;
  let n = ps.length - 1;
  for (let i = 0; i < ps.length; i++) n += plen(ps[i]);
  return n < 0 ? 0 : n;
}

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
  v = Math.trunc(Number(v));
  if (!(v >= lo)) return lo;
  return v > hi ? hi : v;
}

/**
 * Maps a story offset to paragraph coordinates.
 * @param {Story} story
 * @param {number} offset
 * @returns {{pi:number, start:number, local:number, len:number}}
 */
function locate(story, offset) {
  const ps = story.paragraphs;
  let start = 0;
  if (!(offset > 0)) offset = 0;
  for (let i = 0; i < ps.length; i++) {
    const len = plen(ps[i]);
    if (offset <= start + len) return { pi: i, start, local: offset - start, len };
    start += len + 1;
  }
  const last = ps.length - 1;
  const len = plen(ps[last]);
  return { pi: last, start: start - len - 1, local: len, len };
}

/**
 * Finds the paragraph that contains `offset`.
 * @param {Story} story
 * @param {number} offset
 * @returns {{index:number, start:number, end:number}} `end` is the offset of the paragraph break (exclusive of it).
 */
export function paragraphAt(story, offset) {
  const l = locate(story, offset);
  return { index: l.pi, start: l.start, end: l.start + l.len };
}

/**
 * Start offset of every paragraph.
 * @param {Story} story
 * @returns {number[]}
 */
export function paragraphStarts(story) {
  const out = [];
  let s = 0;
  for (const p of story.paragraphs) {
    out.push(s);
    s += plen(p) + 1;
  }
  return out;
}

/**
 * Returns the sub-runs covering [a, b) of a run list (new run objects, empty results omitted).
 * @param {any[]} runs
 * @param {number} a
 * @param {number} b
 * @returns {any[]}
 */
function sliceRuns(runs, a, b) {
  const out = [];
  let pos = 0;
  for (let i = 0; i < runs.length && pos < b; i++) {
    const r = runs[i];
    const len = r.text.length;
    const s = Math.max(a, pos);
    const e = Math.min(b, pos + len);
    if (s < e) {
      out.push(s === pos && e === pos + len ? r : mkRun(r.text.slice(s - pos, e - pos), r.attrs, r.styleId));
    }
    pos += len;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// text input normalization
// ---------------------------------------------------------------------------------------------------------------

/**
 * Normalizes text typed or pasted into a story: CRLF, CR, LF and U+2029 become '\n' (paragraph break),
 * vertical tab becomes U+2028 (forced line break), and other C0 control characters (except '\t') and DEL are removed.
 * @param {string} text
 * @returns {string}
 */
export function normalizeInputText(text) {
  let s = String(text == null ? '' : text);
  // eslint-disable-next-line no-control-regex
  if (!/[\u0000-\u0008\u000b-\u001f\u007f\u{2029}]/u.test(s)) return s;
  s = s.replace(/\r\n?|\u{2029}/gu, '\n').replace(/\u000b/g, '\u{2028}');
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000c\u000e-\u001f\u007f]/g, '');
}

// ---------------------------------------------------------------------------------------------------------------
// construction / extraction
// ---------------------------------------------------------------------------------------------------------------

/**
 * A story with one empty paragraph.
 * @returns {Story}
 */
export function emptyStory() {
  return { paragraphs: [{ runs: [] }] };
}

/**
 * Builds a story from plain text. Newlines start new paragraphs; every non-empty paragraph is one run.
 * @param {string} text
 * @param {object} [attrs] CharAttrs for every run
 * @param {object} [paraAttrs] ParaAttrs for every paragraph
 * @returns {Story}
 */
export function storyFromPlain(text, attrs, paraAttrs) {
  const lines = normalizeInputText(text).split('\n');
  const ca = canonAttrs(attrs ? { ...attrs } : undefined);
  const pa = paraAttrs ? { ...paraAttrs } : undefined;
  return {
    paragraphs: lines.map((l) =>
      mkPara(l ? [mkRun(l, ca ? { ...ca } : undefined, undefined)] : [], pa ? { ...pa } : undefined, undefined),
    ),
  };
}

/**
 * Like {@link storyFromPlain}, but also sets tab stops on every paragraph. `tabs` is either an array of tab stops
 * (`{pos, align, leader?}`) or a number: a regular left-tab interval in px (20 stops are generated).
 * Tab characters in `text` are kept as '\t' characters.
 * @param {string} text
 * @param {{pos:number, align:'left'|'right'|'center'|'decimal', leader?:string}[]|number} tabs
 * @param {object} [attrs]
 * @param {object} [paraAttrs]
 * @returns {Story}
 */
export function storyFromPlainWithTabs(text, tabs, attrs, paraAttrs) {
  /** @type {any[]} */
  let stops;
  if (Array.isArray(tabs)) {
    stops = tabs.map((t) => ({ ...t }));
  } else {
    const step = Number(tabs);
    stops = [];
    if (step > 0 && isFinite(step)) for (let i = 1; i <= 20; i++) stops.push({ pos: i * step, align: 'left' });
  }
  stops.sort((a, b) => a.pos - b.pos);
  return storyFromPlain(text, attrs, { ...(paraAttrs || {}), tabs: stops });
}

/**
 * Plain text of a story; paragraphs are joined with '\n'. Forced line breaks stay U+2028.
 * @param {Story} story
 * @returns {string}
 */
export function plainText(story) {
  const ps = story.paragraphs;
  const parts = new Array(ps.length);
  for (let i = 0; i < ps.length; i++) {
    let s = '';
    const runs = ps[i].runs;
    for (let k = 0; k < runs.length; k++) s += runs[k].text;
    parts[i] = s;
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// style lookup at a position
// ---------------------------------------------------------------------------------------------------------------

/**
 * The run that new text typed at paragraph-local position `local` should inherit from: the character to the left,
 * else the first run of the paragraph, else the last run of the nearest preceding non-empty paragraph.
 * @param {Story} story
 * @param {number} pi
 * @param {number} local
 * @returns {any|null}
 */
function inheritRun(story, pi, local) {
  const runs = story.paragraphs[pi].runs;
  if (runs.length) {
    if (local === 0) return runs[0];
    let pos = 0;
    for (let i = 0; i < runs.length; i++) {
      pos += runs[i].text.length;
      if (local <= pos) return runs[i];
    }
    return runs[runs.length - 1];
  }
  for (let i = pi - 1; i >= 0; i--) {
    const r = story.paragraphs[i].runs;
    if (r.length) return r[r.length - 1];
  }
  return null;
}

/**
 * The character attributes new text at `offset` would inherit (copy; `{}` when there is nothing to inherit).
 * @param {Story} story
 * @param {number} offset
 * @returns {object}
 */
export function getAttrsAt(story, offset) {
  const l = locate(story, offset);
  const r = inheritRun(story, l.pi, l.local);
  return r && r.attrs ? { ...r.attrs } : {};
}

/**
 * Like {@link getAttrsAt}, but also returns the character style id.
 * @param {Story} story
 * @param {number} offset
 * @returns {{attrs:object, styleId?:string}}
 */
export function getStyleAt(story, offset) {
  const l = locate(story, offset);
  const r = inheritRun(story, l.pi, l.local);
  /** @type {any} */
  const out = { attrs: r && r.attrs ? { ...r.attrs } : {} };
  if (r && r.styleId) out.styleId = r.styleId;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// editing
// ---------------------------------------------------------------------------------------------------------------

/**
 * Inserts text at `offset`.
 *
 * - '\n' (and CRLF/CR/U+2029) splits paragraphs; both halves keep the paragraph attributes. When the break is
 *   inserted at the very end of a paragraph and `opts.styles` defines a `next` style for the paragraph's style, the
 *   new paragraphs use that style.
 * - Without `attrs`, the text inherits attributes and character style from its left neighbor (see
 *   {@link getAttrsAt}). When `attrs` is given it is used exactly (no inheritance).
 * - Input is passed through {@link normalizeInputText}; the inserted length is the length of the normalized text.
 *
 * @param {Story} story
 * @param {number} offset
 * @param {string} text
 * @param {object} [attrs]
 * @param {{styles?: object}} [opts]
 * @returns {Story}
 */
export function insertText(story, offset, text, attrs, opts) {
  text = normalizeInputText(text);
  if (!text) return story;
  const total = storyLength(story);
  offset = clamp(offset, 0, total);
  const { pi, local } = locate(story, offset);
  const p = story.paragraphs[pi];
  let ca;
  let sid;
  if (attrs === undefined || attrs === null) {
    const r = inheritRun(story, pi, local);
    ca = r ? r.attrs : undefined;
    sid = r ? r.styleId : undefined;
  } else {
    ca = canonAttrs({ ...attrs });
    sid = undefined;
  }
  const left = sliceRuns(p.runs, 0, local);
  const right = sliceRuns(p.runs, local, plen(p));
  const pieces = text.split('\n');
  let paragraphs;
  if (pieces.length === 1) {
    const np = normalizePara(mkPara([...left, mkRun(text, ca, sid), ...right], p.attrs, p.styleId));
    paragraphs = story.paragraphs.slice();
    paragraphs[pi] = np;
  } else {
    let nextStyle;
    if (local === plen(p) && opts && opts.styles && p.styleId) {
      const t = opts.styles.paragraph;
      const def = t && hasOwn.call(t, p.styleId) ? t[p.styleId] : null;
      if (def && typeof def.next === 'string' && def.next) nextStyle = def.next;
    }
    const added = [];
    const first = normalizePara(
      mkPara(pieces[0] ? [...left, mkRun(pieces[0], ca, sid)] : left, p.attrs, p.styleId),
    );
    added.push(first);
    for (let i = 1; i < pieces.length; i++) {
      const piece = pieces[i];
      const isLast = i === pieces.length - 1;
      const runs = [];
      if (piece) runs.push(mkRun(piece, ca, sid));
      if (isLast) for (const r of right) runs.push(r);
      const np = nextStyle ? mkPara(runs, undefined, nextStyle) : mkPara(runs, p.attrs, p.styleId);
      added.push(normalizePara(np));
    }
    paragraphs = story.paragraphs.slice(0, pi).concat(added, story.paragraphs.slice(pi + 1));
  }
  return { paragraphs };
}

/**
 * Deletes the characters in [from, to). Deleting across paragraph breaks merges paragraphs: the merged paragraph
 * keeps the attributes of the first paragraph, unless the first paragraph was empty, in which case it takes those
 * of the last one.
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @returns {Story}
 */
export function deleteRange(story, from, to) {
  const total = storyLength(story);
  from = clamp(from, 0, total);
  to = clamp(to, 0, total);
  if (from > to) [from, to] = [to, from];
  if (from === to) return story;
  const lo = locate(story, from);
  const hi = locate(story, to);
  const ps = story.paragraphs;
  if (lo.pi === hi.pi) {
    const p = ps[lo.pi];
    const np = normalizePara(mkPara([...sliceRuns(p.runs, 0, lo.local), ...sliceRuns(p.runs, hi.local, lo.len)], p.attrs, p.styleId));
    const paragraphs = ps.slice();
    paragraphs[lo.pi] = np;
    return { paragraphs };
  }
  const first = ps[lo.pi];
  const last = ps[hi.pi];
  const src = lo.len === 0 ? last : first;
  const merged = normalizePara(
    mkPara([...sliceRuns(first.runs, 0, lo.local), ...sliceRuns(last.runs, hi.local, hi.len)], src.attrs, src.styleId),
  );
  return { paragraphs: ps.slice(0, lo.pi).concat([merged], ps.slice(hi.pi + 1)) };
}

/**
 * Extracts [from, to) as a new story. Partially covered first/last paragraphs keep their paragraph attributes.
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @returns {Story}
 */
export function sliceStory(story, from, to) {
  const total = storyLength(story);
  from = clamp(from, 0, total);
  to = clamp(to, 0, total);
  if (from > to) [from, to] = [to, from];
  const lo = locate(story, from);
  const hi = locate(story, to);
  const ps = story.paragraphs;
  if (lo.pi === hi.pi) {
    const p = ps[lo.pi];
    return { paragraphs: [normalizePara(mkPara(sliceRuns(p.runs, lo.local, hi.local), p.attrs, p.styleId))] };
  }
  const out = [];
  const f = ps[lo.pi];
  out.push(normalizePara(mkPara(sliceRuns(f.runs, lo.local, lo.len), f.attrs, f.styleId)));
  for (let i = lo.pi + 1; i < hi.pi; i++) out.push(ps[i]);
  const l = ps[hi.pi];
  out.push(normalizePara(mkPara(sliceRuns(l.runs, 0, hi.local), l.attrs, l.styleId)));
  return { paragraphs: out };
}

/**
 * Inserts a whole story (paste). The first pasted paragraph merges into the paragraph at `offset` (which keeps its
 * attributes); further pasted paragraphs keep their own attributes. The last pasted paragraph is joined with the
 * remainder of the target paragraph; it brings its own attributes unless it is empty, in which case the target's
 * attributes are kept.
 * @param {Story} story
 * @param {number} offset
 * @param {Story} other
 * @returns {Story}
 */
export function insertStory(story, offset, other) {
  const os = other && Array.isArray(other.paragraphs) ? other.paragraphs : [];
  if (!os.length) return story;
  const total = storyLength(story);
  offset = clamp(offset, 0, total);
  const { pi, local } = locate(story, offset);
  const p = story.paragraphs[pi];
  const left = sliceRuns(p.runs, 0, local);
  const right = sliceRuns(p.runs, local, plen(p));
  if (os.length === 1) {
    if (!os[0].runs.length) return story;
    const np = normalizePara(mkPara([...left, ...os[0].runs, ...right], p.attrs, p.styleId));
    const paragraphs = story.paragraphs.slice();
    paragraphs[pi] = np;
    return { paragraphs };
  }
  const added = [];
  added.push(normalizePara(mkPara([...left, ...os[0].runs], p.attrs, p.styleId)));
  for (let i = 1; i < os.length - 1; i++) added.push(normalizePara(os[i]));
  const tail = os[os.length - 1];
  const tailEmpty = plen(tail) === 0;
  const src = tailEmpty ? p : tail;
  added.push(normalizePara(mkPara([...tail.runs, ...right], src.attrs, src.styleId)));
  return { paragraphs: story.paragraphs.slice(0, pi).concat(added, story.paragraphs.slice(pi + 1)) };
}

/**
 * Applies a patch to the attributes of the characters in [from, to). A patch value of `undefined` removes the
 * override. A collapsed range changes nothing (hosts keep "typing attributes" themselves).
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @param {object} patch CharAttrs patch
 * @returns {Story}
 */
export function applyCharAttrs(story, from, to, patch) {
  return mapRange(story, from, to, (run) => {
    /** @type {any} */
    const a = { ...(run.attrs || {}) };
    for (const k of Object.keys(patch)) {
      if (patch[k] === undefined) delete a[k];
      else a[k] = patch[k];
    }
    return mkRun(run.text, canonAttrs(a), run.styleId);
  });
}

/**
 * Sets (or with a falsy id, clears) the character style of the characters in [from, to).
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @param {string|null|undefined} styleId
 * @returns {Story}
 */
export function applyCharStyle(story, from, to, styleId) {
  return mapRange(story, from, to, (run) => mkRun(run.text, run.attrs, styleId || undefined));
}

/**
 * Splits runs at the range boundaries and maps the runs inside the range.
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @param {(run:any)=>any} fn
 * @returns {Story}
 */
function mapRange(story, from, to, fn) {
  const total = storyLength(story);
  from = clamp(from, 0, total);
  to = clamp(to, 0, total);
  if (from > to) [from, to] = [to, from];
  if (from === to) return story;
  const lo = locate(story, from);
  const hi = locate(story, to);
  const paragraphs = story.paragraphs.slice();
  for (let i = lo.pi; i <= hi.pi; i++) {
    const p = paragraphs[i];
    const len = plen(p);
    const a = i === lo.pi ? lo.local : 0;
    const b = i === hi.pi ? hi.local : len;
    if (a >= b) continue;
    const runs = [...sliceRuns(p.runs, 0, a), ...sliceRuns(p.runs, a, b).map(fn), ...sliceRuns(p.runs, b, len)];
    paragraphs[i] = normalizePara(mkPara(runs, p.attrs, p.styleId));
  }
  return { paragraphs };
}

/**
 * Applies a patch to the paragraph attributes of every paragraph touched by [from, to] (a collapsed range touches
 * the paragraph containing it; a range that ends exactly at the start of a paragraph does not touch that paragraph).
 * A patch value of `undefined` removes the override; `null` is stored (it explicitly disables e.g. `bullet`).
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @param {object} patch ParaAttrs patch
 * @returns {Story}
 */
export function applyParaAttrs(story, from, to, patch) {
  return mapParas(story, from, to, (p) => {
    /** @type {any} */
    const a = { ...(p.attrs || {}) };
    for (const k of Object.keys(patch)) {
      if (patch[k] === undefined) delete a[k];
      else a[k] = patch[k];
    }
    return mkPara(p.runs, a, p.styleId);
  });
}

/**
 * Sets (or with a falsy id, clears) the paragraph style of the touched paragraphs.
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @param {string|null|undefined} styleId
 * @param {{clearOverrides?: boolean}} [opts] also drop the paragraph's local attribute overrides
 * @returns {Story}
 */
export function applyParaStyle(story, from, to, styleId, opts) {
  return mapParas(story, from, to, (p) => mkPara(p.runs, opts && opts.clearOverrides ? undefined : p.attrs, styleId || undefined));
}

/**
 * @param {Story} story
 * @param {number} from
 * @param {number} to
 * @param {(p:any)=>any} fn
 * @returns {Story}
 */
function mapParas(story, from, to, fn) {
  const total = storyLength(story);
  from = clamp(from, 0, total);
  to = clamp(to, 0, total);
  if (from > to) [from, to] = [to, from];
  const ps = story.paragraphs;
  const paragraphs = ps.slice();
  let start = 0;
  for (let i = 0; i < ps.length; i++) {
    const end = start + plen(ps[i]);
    if (start > to && start !== from) break;
    if (end >= from && (start < to || start === from)) paragraphs[i] = fn(ps[i]);
    start = end + 1;
  }
  return { paragraphs };
}

// ---------------------------------------------------------------------------------------------------------------
// character classes / words
// ---------------------------------------------------------------------------------------------------------------

const RE_WORD = /[\p{L}\p{N}\p{M}_]/u;
const RE_SPACE = /[\s\u{a0}\u{2028}\u{200b}]/u;

/**
 * Coarse character classification for word navigation.
 * `'w'` word character (letters, digits, marks, underscore), `'s'` whitespace, `'c'` CJK ideograph or kana (each is a
 * word on its own), `'p'` punctuation/symbol.
 * @param {number} cp
 * @returns {'w'|'s'|'c'|'p'}
 */
export function charClass(cp) {
  if (cp <= 0x7f) {
    if ((cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95) return 'w';
    if (cp === 32 || cp === 9 || cp === 10 || cp === 13) return 's';
    return 'p';
  }
  if (
    (cp >= 0x3040 && cp <= 0x30ff && cp !== 0x30fb) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f)
  ) {
    return 'c';
  }
  const ch = String.fromCodePoint(cp);
  if (RE_SPACE.test(ch)) return 's';
  return RE_WORD.test(ch) ? 'w' : 'p';
}

/**
 * Code point starting at index `i` and its UTF-16 length.
 * @param {string} s
 * @param {number} i
 * @returns {number} code point (use `cp > 0xffff ? 2 : 1` for the length)
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
 * Code point ending right before index `i` (i > 0).
 * @param {string} s
 * @param {number} i
 * @returns {number}
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
 * Text of paragraph `pi` and its start offset.
 * @param {Story} story
 * @param {number} pi
 */
function paraText(story, pi) {
  let s = '';
  const runs = story.paragraphs[pi].runs;
  for (let i = 0; i < runs.length; i++) s += runs[i].text;
  return s;
}

/**
 * The word around `offset` (double-click selection). Looks at the character to the right of `offset` (to the left at
 * the end of a paragraph). Words are runs of word characters (apostrophes between letters stay inside the word);
 * whitespace runs and punctuation runs select as units; every CJK ideograph or kana is its own word.
 * A collapsed result is returned for an empty paragraph.
 * @param {Story} story
 * @param {number} offset
 * @returns {{from:number, to:number}}
 */
export function wordRange(story, offset) {
  const total = storyLength(story);
  offset = clamp(offset, 0, total);
  const { pi, start, local, len } = locate(story, offset);
  if (len === 0) return { from: offset, to: offset };
  const text = paraText(story, pi);
  let pivot = local < len ? local : local - (cpBefore(text, local) > 0xffff ? 2 : 1);
  const pcp = cpAt(text, pivot);
  const cls = charClass(pcp);
  let a = pivot;
  let b = pivot + (pcp > 0xffff ? 2 : 1);
  if (cls === 'c') return { from: start + a, to: start + b };
  const isApos = (cp) => cp === 0x27 || cp === 0x2019;
  // expand left
  while (a > 0) {
    const cp = cpBefore(text, a);
    const w = cp > 0xffff ? 2 : 1;
    if (charClass(cp) === cls) {
      a -= w;
    } else if (cls === 'w' && isApos(cp) && a - w > 0 && charClass(cpBefore(text, a - w)) === 'w') {
      a -= w;
    } else break;
  }
  // expand right
  while (b < len) {
    const cp = cpAt(text, b);
    const w = cp > 0xffff ? 2 : 1;
    if (charClass(cp) === cls) b += w;
    else if (cls === 'w' && isApos(cp) && b + w < len && charClass(cpAt(text, b + w)) === 'w') b += w;
    else break;
  }
  return { from: start + a, to: start + b };
}

// ---------------------------------------------------------------------------------------------------------------
// style resolution
// ---------------------------------------------------------------------------------------------------------------

/**
 * Shallow merge that skips `undefined` source values.
 * @param {any} target
 * @param {any} src
 */
function mergeDefined(target, src) {
  if (!src || typeof src !== 'object') return target;
  for (const k in src) {
    if (hasOwn.call(src, k) && src[k] !== undefined) target[k] = src[k];
  }
  return target;
}

/**
 * Style definitions from root ancestor to leaf following `basedOn`. Missing styles end the chain and cycles are
 * cut at the first repeated style.
 * @param {Record<string, any>|undefined} table
 * @param {string|undefined} id
 * @returns {any[]}
 */
function styleChain(table, id) {
  const out = [];
  if (!table || typeof id !== 'string') return out;
  const seen = new Set();
  let cur = id;
  while (typeof cur === 'string' && !seen.has(cur) && hasOwn.call(table, cur)) {
    seen.add(cur);
    const s = table[cur];
    if (!isObj(s)) break;
    out.push(s);
    cur = s.basedOn;
  }
  return out.reverse();
}

/**
 * Resolves the paragraph attributes of `para`: defaults, then the paragraph style chain, then the paragraph's own
 * attributes.
 * @param {object} para
 * @param {object} [styles] Styles
 * @param {object} [defaults] Defaults (falls back to {@link DEFAULTS})
 * @returns {object} ParaAttrs
 */
export function resolveParagraph(para, styles, defaults) {
  const d = defaults || DEFAULTS;
  const res = mergeDefined({}, d.para);
  const chain = styleChain(styles && styles.paragraph, para && para.styleId);
  for (const s of chain) mergeDefined(res, s.attrs);
  mergeDefined(res, para && para.attrs);
  return res;
}

/**
 * Resolves the character attributes of a run following the contract order (later wins): defaults, paragraph
 * style chain (its `char` part), character style chain, run attributes. Paragraph attribute overrides carry no
 * character attributes, so they do not take part here.
 * @param {object} run
 * @param {object} para the owning paragraph
 * @param {object} [styles] Styles
 * @param {object} [defaults] Defaults (falls back to {@link DEFAULTS})
 * @returns {object} complete CharAttrs
 */
export function resolveRun(run, para, styles, defaults) {
  const d = defaults || DEFAULTS;
  const res = mergeDefined({}, d.char);
  const pchain = styleChain(styles && styles.paragraph, para && para.styleId);
  for (const s of pchain) mergeDefined(res, s.char);
  const cchain = styleChain(styles && styles.character, run && run.styleId);
  for (const s of cchain) mergeDefined(res, s.attrs);
  mergeDefined(res, run && run.attrs);
  return res;
}

/**
 * Creates a resolver that caches style chains; use it when resolving many runs with the same styles (e.g. while
 * laying out). The cache assumes `styles` and `defaults` are not mutated while the resolver is in use.
 * @param {object} [styles]
 * @param {object} [defaults]
 * @returns {{run:(run:object, para:object)=>object, para:(para:object)=>object, baseChar:(para:object, charStyleId?:string)=>object}}
 */
export function createStyleResolver(styles, defaults) {
  const d = defaults || DEFAULTS;
  /** @type {Map<string, any>} */
  const baseCache = new Map();
  /** @type {Map<string, any>} */
  const paraCache = new Map();
  /**
   * @param {any} para
   * @param {string} [csid]
   */
  const baseChar = (para, csid) => {
    const psid = (para && para.styleId) || '';
    const key = psid + '\u0000' + (csid || '');
    let b = baseCache.get(key);
    if (!b) {
      b = mergeDefined({}, d.char);
      for (const s of styleChain(styles && styles.paragraph, psid)) mergeDefined(b, s.char);
      for (const s of styleChain(styles && styles.character, csid)) mergeDefined(b, s.attrs);
      baseCache.set(key, b);
    }
    return b;
  };
  return {
    baseChar,
    run(run, para) {
      const res = { ...baseChar(para, run && run.styleId) };
      return mergeDefined(res, run && run.attrs);
    },
    para(para) {
      const psid = (para && para.styleId) || '';
      let b = paraCache.get(psid);
      if (!b) {
        b = mergeDefined({}, d.para);
        for (const s of styleChain(styles && styles.paragraph, psid)) mergeDefined(b, s.attrs);
        paraCache.set(psid, b);
      }
      return mergeDefined({ ...b }, para && para.attrs);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// JSON (de)serialization with sanitizing
// ---------------------------------------------------------------------------------------------------------------

const ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const TAB_ALIGNS = new Set(['left', 'right', 'center', 'decimal']);
const BULLET_KINDS = new Set(['bullet', 'number', 'alpha', 'roman']);
const MAX_PARAGRAPHS = 1000000;
const MAX_RUNS = 200000;

/**
 * @param {any} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number|undefined}
 */
function num(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return undefined;
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {any} v @param {number} max */
function cleanString(v, max) {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s || undefined;
}

/**
 * @param {any} v
 * @returns {string|undefined} lower-case '#rrggbb' or '#rrggbbaa'
 */
function cleanColor(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) return '#' + [...m[1]].map((c) => c + c).join('');
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  return m ? '#' + m[1] : undefined;
}

/**
 * Whitelists and validates character attributes from untrusted input.
 * @param {any} a
 * @returns {object|undefined}
 */
export function sanitizeCharAttrs(a) {
  if (!isObj(a)) return undefined;
  /** @type {any} */
  const o = {};
  let v;
  if ((v = cleanString(a.fontFamily, 128)) !== undefined) o.fontFamily = v;
  if ((v = num(a.fontSize, 0.5, 4000)) !== undefined) o.fontSize = v;
  if ((v = num(a.fontWeight, 1, 1000)) !== undefined) o.fontWeight = Math.round(v);
  if (a.fontStyle === 'normal' || a.fontStyle === 'italic') o.fontStyle = a.fontStyle;
  else if (a.fontStyle === 'oblique') o.fontStyle = 'italic';
  if ((v = cleanColor(a.color)) !== undefined) o.color = v;
  if (typeof a.underline === 'boolean') o.underline = a.underline;
  if (typeof a.strike === 'boolean') o.strike = a.strike;
  if ((v = num(a.tracking, -1000, 10000)) !== undefined) o.tracking = v;
  if ((v = num(a.baselineShift, -10000, 10000)) !== undefined) o.baselineShift = v;
  if (a.caps === 'none' || a.caps === 'upper' || a.caps === 'small') o.caps = a.caps;
  if (typeof a.field === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(a.field)) o.field = a.field;
  return Object.keys(o).length ? o : undefined;
}

/**
 * Whitelists and validates paragraph attributes from untrusted input.
 * @param {any} a
 * @returns {object|undefined}
 */
export function sanitizeParaAttrs(a) {
  if (!isObj(a)) return undefined;
  /** @type {any} */
  const o = {};
  let v;
  if (ALIGNS.has(a.align)) o.align = a.align;
  if ((v = num(a.lineHeight, 0.1, 20)) !== undefined) o.lineHeight = v;
  if ((v = num(a.spaceBefore, 0, 100000)) !== undefined) o.spaceBefore = v;
  if ((v = num(a.spaceAfter, 0, 100000)) !== undefined) o.spaceAfter = v;
  if ((v = num(a.indentFirst, -100000, 100000)) !== undefined) o.indentFirst = v;
  if ((v = num(a.indentLeft, -100000, 100000)) !== undefined) o.indentLeft = v;
  if ((v = num(a.indentRight, -100000, 100000)) !== undefined) o.indentRight = v;
  if (typeof a.hyphenate === 'boolean') o.hyphenate = a.hyphenate;
  if (typeof a.keepLinesTogether === 'boolean') o.keepLinesTogether = a.keepLinesTogether;
  if (typeof a.keepWithNext === 'boolean') o.keepWithNext = a.keepWithNext;
  if ((v = num(a.widowOrphan, 0, 20)) !== undefined) o.widowOrphan = Math.round(v);
  if (a.bullet === null) o.bullet = null;
  else if (isObj(a.bullet) && BULLET_KINDS.has(a.bullet.kind)) {
    /** @type {any} */
    const b = { kind: a.bullet.kind };
    const ch = typeof a.bullet.char === 'string' ? a.bullet.char.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16) : '';
    if (ch) b.char = ch;
    if ((v = num(a.bullet.indent, 0, 10000)) !== undefined) b.indent = v;
    if (typeof a.bullet.upper === 'boolean') b.upper = a.bullet.upper;
    o.bullet = b;
  }
  if (a.dropCap === null) o.dropCap = null;
  else if (isObj(a.dropCap)) {
    const lines = num(a.dropCap.lines, 1, 12);
    const chars = num(a.dropCap.chars, 1, 8);
    if (lines !== undefined && chars !== undefined) o.dropCap = { lines: Math.round(lines), chars: Math.round(chars) };
  }
  if (Array.isArray(a.tabs)) {
    const tabs = [];
    for (let i = 0; i < a.tabs.length && tabs.length < 128; i++) {
      const t = a.tabs[i];
      if (!isObj(t)) continue;
      const pos = num(t.pos, -100000, 100000);
      if (pos === undefined) continue;
      /** @type {any} */
      const tab = { pos, align: TAB_ALIGNS.has(t.align) ? t.align : 'left' };
      const leader = typeof t.leader === 'string' ? t.leader.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 8) : '';
      if (leader) tab.leader = leader;
      tabs.push(tab);
    }
    o.tabs = tabs;
  }
  return Object.keys(o).length ? o : undefined;
}

/**
 * Plain-object deep copy of a story that is safe to `JSON.stringify` (only known fields are kept).
 * @param {Story} story
 * @returns {object}
 */
export function storyToJSON(story) {
  const norm = normalizeStory(story);
  return {
    paragraphs: norm.paragraphs.map((p) => {
      /** @type {any} */
      const o = {
        runs: p.runs.map((r) => {
          /** @type {any} */
          const ro = { text: r.text };
          if (r.attrs) ro.attrs = JSON.parse(JSON.stringify(r.attrs));
          if (r.styleId) ro.styleId = r.styleId;
          return ro;
        }),
      };
      if (p.attrs) o.attrs = JSON.parse(JSON.stringify(p.attrs));
      if (p.styleId) o.styleId = p.styleId;
      return o;
    }),
  };
}

/**
 * Builds a valid, normalized story from untrusted JSON (an object or a JSON string). Unknown fields are dropped,
 * attribute values are validated and clamped, run text is stripped of control characters (newlines inside run text
 * become U+2028). Garbage input yields an empty story; this function never throws.
 * @param {any} json
 * @returns {Story}
 */
export function storyFromJSON(json) {
  try {
    let raw = json;
    if (typeof raw === 'string') raw = JSON.parse(raw);
    if (!isObj(raw) || !Array.isArray(raw.paragraphs)) return emptyStory();
    const paragraphs = [];
    const n = Math.min(raw.paragraphs.length, MAX_PARAGRAPHS);
    for (let i = 0; i < n; i++) {
      const rp = raw.paragraphs[i];
      /** @type {any[]} */
      const runs = [];
      if (isObj(rp) && Array.isArray(rp.runs)) {
        const m = Math.min(rp.runs.length, MAX_RUNS);
        for (let k = 0; k < m; k++) {
          const rr = rp.runs[k];
          if (!isObj(rr) || typeof rr.text !== 'string') continue;
          const text = normalizeInputText(rr.text).replace(/\n+/g, '\u{2028}');
          if (!text) continue;
          runs.push(mkRun(text, sanitizeCharAttrs(rr.attrs), cleanString(rr.styleId, 128)));
        }
      }
      paragraphs.push(
        mkPara(runs, isObj(rp) ? sanitizeParaAttrs(rp.attrs) : undefined, isObj(rp) ? cleanString(rp.styleId, 128) : undefined),
      );
    }
    if (!paragraphs.length) return emptyStory();
    return normalizeStory({ paragraphs });
  } catch (_) {
    return emptyStory();
  }
}

/**
 * Lists structural problems of untrusted story JSON (empty array = valid). Diagnostic helper; {@link storyFromJSON}
 * always repairs instead of failing.
 * @param {any} raw
 * @returns {string[]}
 */
export function validateStory(raw) {
  const errs = [];
  if (!isObj(raw) || !Array.isArray(raw.paragraphs)) return ['story must be an object with a paragraphs array'];
  if (raw.paragraphs.length === 0) errs.push('story has no paragraphs');
  raw.paragraphs.forEach((p, i) => {
    if (!isObj(p) || !Array.isArray(p.runs)) {
      errs.push(`paragraph ${i}: runs must be an array`);
      return;
    }
    p.runs.forEach((r, k) => {
      if (!isObj(r) || typeof r.text !== 'string') errs.push(`paragraph ${i} run ${k}: text must be a string`);
      else if (/[\n\r]/.test(r.text)) errs.push(`paragraph ${i} run ${k}: text contains a newline`);
    });
  });
  return errs;
}

// ---------------------------------------------------------------------------------------------------------------
// HTML export
// ---------------------------------------------------------------------------------------------------------------

/** @param {string} s */
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

/** @param {number} n */
const fmtNum = (n) => String(Math.round(n * 1000) / 1000);

/**
 * CSS for resolved character attributes (values are validated; nothing user-controlled is emitted verbatim).
 * @param {any} a
 */
function charCSS(a) {
  const s = sanitizeCharAttrs(a) || {};
  const css = [];
  if (s.fontFamily) {
    const fam = s.fontFamily.replace(/[^\p{L}\p{N} _.,-]/gu, '');
    if (fam) css.push(`font-family:'${fam}'`);
  }
  if (s.fontSize !== undefined) css.push(`font-size:${fmtNum(s.fontSize)}px`);
  if (s.fontWeight !== undefined) css.push(`font-weight:${s.fontWeight}`);
  if (s.fontStyle) css.push(`font-style:${s.fontStyle}`);
  if (s.color) css.push(`color:${s.color}`);
  const deco = [];
  if (s.underline) deco.push('underline');
  if (s.strike) deco.push('line-through');
  if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
  if (s.tracking) css.push(`letter-spacing:${fmtNum(s.tracking / 1000)}em`);
  if (s.baselineShift) css.push(`position:relative;top:${fmtNum(-s.baselineShift)}px`);
  if (s.caps === 'upper') css.push('text-transform:uppercase');
  else if (s.caps === 'small') css.push('font-variant:small-caps');
  return css.join(';');
}

/**
 * CSS for resolved paragraph attributes.
 * @param {any} a
 */
function paraCSS(a) {
  const s = sanitizeParaAttrs(a) || {};
  const css = ['margin:0', 'white-space:pre-wrap'];
  if (s.align) css.push(`text-align:${s.align}`);
  if (s.lineHeight !== undefined) css.push(`line-height:${fmtNum(s.lineHeight)}`);
  if (s.spaceBefore) css.push(`margin-top:${fmtNum(s.spaceBefore)}px`);
  if (s.spaceAfter) css.push(`margin-bottom:${fmtNum(s.spaceAfter)}px`);
  if (s.indentLeft) css.push(`margin-left:${fmtNum(s.indentLeft)}px`);
  if (s.indentRight) css.push(`margin-right:${fmtNum(s.indentRight)}px`);
  if (s.indentFirst) css.push(`text-indent:${fmtNum(s.indentFirst)}px`);
  if (s.hyphenate) css.push('hyphens:auto');
  return css.join(';');
}

/**
 * Serializes a story to an HTML fragment for clipboard interop (`text/html`). Everything is escaped; styles are
 * emitted as inline CSS from validated values only. Paragraphs become `<p>`; consecutive bulleted/numbered
 * paragraphs become `<ul>` / `<ol type="1|a|A|i|I">` lists. Tabs are preserved (`white-space:pre-wrap`) and
 * U+2028 becomes `<br>`. Run `field` attributes are exposed as `data-field`.
 * @param {Story} story
 * @param {object} [styles] Styles used to resolve style ids
 * @param {{defaults?: object}} [opts] when `defaults` is given, fully resolved attributes are emitted; otherwise only
 *   the explicit attributes of the style chain and the run are emitted
 * @returns {string}
 */
export function storyToHTML(story, styles, opts) {
  const defaults = (opts && opts.defaults) || { char: {}, para: {} };
  const out = [];
  let list = null; // 'ul' | 'ol:type'
  const closeList = () => {
    if (list) {
      out.push(list.startsWith('ul') ? '</ul>' : '</ol>');
      list = null;
    }
  };
  for (const p of story.paragraphs) {
    const pa = resolveParagraph(p, styles, defaults);
    let inner = '';
    for (const r of p.runs) {
      const ra = resolveRun(r, p, styles, defaults);
      const css = charCSS(ra);
      const body = escapeHTML(r.text)
        .replace(/\t/g, '&#9;')
        .replace(/\u{2028}/gu, '<br>');
      const field = ra.field && /^[A-Za-z0-9_.:-]{1,64}$/.test(ra.field) ? ` data-field="${escapeHTML(ra.field)}"` : '';
      inner += css || field ? `<span${css ? ` style="${escapeHTML(css)}"` : ''}${field}>${body}</span>` : body;
    }
    const b = pa.bullet;
    if (b && isObj(b) && BULLET_KINDS.has(b.kind)) {
      const tag = b.kind === 'bullet' ? 'ul' : 'ol:' + (b.kind === 'number' ? '1' : b.kind === 'alpha' ? (b.upper ? 'A' : 'a') : b.upper ? 'I' : 'i');
      if (list !== tag) {
        closeList();
        out.push(tag === 'ul' ? '<ul>' : `<ol type="${tag.slice(3)}">`);
        list = tag;
      }
      out.push(`<li style="${escapeHTML(paraCSS(pa))}">${inner}</li>`);
    } else {
      closeList();
      out.push(`<p style="${escapeHTML(paraCSS(pa))}">${inner || '<br>'}</p>`);
    }
  }
  closeList();
  return out.join('');
}
