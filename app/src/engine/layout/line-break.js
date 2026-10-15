/**
 * UAX#14-style line break opportunities.
 *
 * This is a compact subset of the Unicode line breaking algorithm that covers what page layout needs:
 * breaking after spaces, hyphens and dashes, zero width spaces, soft hyphens, between CJK ideographs and kana, never
 * before closing punctuation, never after opening punctuation, no break inside no-break (NBSP-like) characters,
 * quotes, numbers with separators and currency symbols, combining marks and emoji sequences.
 *
 * @module line-break
 */

// character classes (subset of the UAX#14 classes)
const AL = 0; // alphabetic, default
const NU = 1; // digits
const SP = 2; // breaking space
const ZW = 3; // zero width space
const GL = 4; // non-breaking glue
const WJ = 5; // word joiner
const BK = 6; // mandatory break
const HY = 7; // hyphen-minus
const BA = 8; // break after (dashes, soft hyphen)
const B2 = 9; // break before and after (em dash)
const CL = 10; // closing punctuation (non-parenthesis)
const CP = 11; // closing parenthesis
const EX = 12; // exclamation / question
const IS = 13; // infix separator , . : ;
const SY = 14; // symbol allowing break after: /
const OP = 15; // opening punctuation
const QU = 16; // quotation
const ID = 17; // ideographic
const NS = 18; // non-starter
const CM = 19; // combining mark
const PR = 20; // prefix numeric (currency)
const PO = 21; // postfix numeric (percent)

/** @type {Uint8Array} */
const ASCII = new Uint8Array(128).fill(AL);
(() => {
  for (let c = 48; c <= 57; c++) ASCII[c] = NU;
  ASCII[0x20] = SP;
  ASCII[0x0a] = BK;
  ASCII[0x0d] = BK;
  ASCII[0x0b] = BK;
  ASCII[0x0c] = BK;
  ASCII[0x09] = SP; // tabs are handled by the caller
  ASCII[0x2d] = HY;
  ASCII[0x29] = CP;
  ASCII[0x5d] = CP;
  ASCII[0x7d] = CL;
  ASCII[0x21] = EX;
  ASCII[0x3f] = EX;
  ASCII[0x2c] = IS;
  ASCII[0x2e] = IS;
  ASCII[0x3a] = IS;
  ASCII[0x3b] = IS;
  ASCII[0x2f] = SY;
  ASCII[0x28] = OP;
  ASCII[0x5b] = OP;
  ASCII[0x7b] = OP;
  ASCII[0x22] = QU;
  ASCII[0x27] = QU;
  ASCII[0x24] = PR;
  ASCII[0x25] = PO;
})();

/** @param {number} cp */
function classify(cp) {
  if (cp < 128) return ASCII[cp];
  if (cp === 0xa0 || cp === 0x202f || cp === 0x2007 || cp === 0x2011) return GL;
  if (cp === 0xad) return BA;
  if (cp === 0x200b) return ZW;
  if (cp === 0x2060 || cp === 0xfeff) return WJ;
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x85) return BK;
  if (cp === 0x200d || cp === 0x200c || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0100 && cp <= 0xe01ef) || (cp >= 0x3099 && cp <= 0x309a)) return CM;
  if (cp === 0x2010 || cp === 0x2012 || cp === 0x2013 || cp === 0x058a || cp === 0x2027 || cp === 0x1680 || cp === 0x2e17) return BA;
  if (cp === 0x2014) return B2;
  if ((cp >= 0x2000 && cp <= 0x200a) || cp === 0x205f || cp === 0x3000) return SP;
  if (cp === 0xa1 || cp === 0xbf) return OP;
  if (cp === 0xab || cp === 0xbb || cp === 0x2018 || cp === 0x2019 || cp === 0x201a || cp === 0x201b || cp === 0x201c || cp === 0x201d || cp === 0x201e || cp === 0x201f || cp === 0x2039 || cp === 0x203a) return QU;
  if (cp === 0xa2 || cp === 0xb0 || cp === 0x2030 || cp === 0x2031 || cp === 0x2032 || cp === 0x2033 || cp === 0x2103 || cp === 0x2109) return PO;
  if (cp === 0xa3 || cp === 0xa5 || cp === 0x20a0 || (cp >= 0x20a1 && cp <= 0x20c0) || cp === 0xa4) return PR;
  if (cp === 0x203c || cp === 0x203d || cp === 0x2047 || cp === 0x2048 || cp === 0x2049 || cp === 0xff01 || cp === 0xff1f) return EX;
  if (cp === 0x2044 || cp === 0x2215) return SY;
  // CJK punctuation
  if (cp === 0x3001 || cp === 0x3002 || cp === 0xff0c || cp === 0xff0e || cp === 0xff1a || cp === 0xff1b) return CL;
  if (cp === 0x3009 || cp === 0x300b || cp === 0x300d || cp === 0x300f || cp === 0x3011 || cp === 0x3015 || cp === 0x3017 || cp === 0x3019 || cp === 0x301b || cp === 0xff09 || cp === 0xff3d || cp === 0xff5d) return CL;
  if (cp === 0x3008 || cp === 0x300a || cp === 0x300c || cp === 0x300e || cp === 0x3010 || cp === 0x3014 || cp === 0x3016 || cp === 0x3018 || cp === 0x301a || cp === 0xff08 || cp === 0xff3b || cp === 0xff5b || cp === 0x2045 || cp === 0x2329) return OP;
  // non-starters: small kana, prolonged sound mark, iteration marks
  if (cp === 0x30fc || cp === 0x3005 || cp === 0x303b || cp === 0x309d || cp === 0x309e || cp === 0x30fd || cp === 0x30fe || cp === 0x30fb || cp === 0x2026 || cp === 0x2025) return NS;
  if ((cp >= 0x3041 && cp <= 0x3096 && (cp & 1) === 1 && cp <= 0x3049) || cp === 0x3063 || cp === 0x3083 || cp === 0x3085 || cp === 0x3087 || cp === 0x308e || cp === 0x30a1 || cp === 0x30a3 || cp === 0x30a5 || cp === 0x30a7 || cp === 0x30a9 || cp === 0x30c3 || cp === 0x30e3 || cp === 0x30e5 || cp === 0x30e7 || cp === 0x30ee || cp === 0x30f5 || cp === 0x30f6) return NS;
  if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0x2fdf) ||
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0x31c0 && cp <= 0x31ff) ||
    (cp >= 0x3200 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    (cp >= 0x2600 && cp <= 0x27bf)
  ) {
    return ID;
  }
  return AL;
}

/**
 * Whether a character is a breaking space (a SPACE in the layout sense: collapsible at line ends, never a
 * line start).
 * @param {number} cp
 * @returns {boolean}
 */
export function isBreakingSpace(cp) {
  return cp === 0x20 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x2006) || (cp >= 0x2008 && cp <= 0x200a) || cp === 0x205f || cp === 0x3000;
}

/**
 * Whether a space character stretches when a line is justified.
 * @param {number} cp
 * @returns {boolean}
 */
export function isExpandableSpace(cp) {
  return cp === 0x20 || cp === 0xa0;
}

/**
 * Finds the line break opportunities of `text`.
 *
 * `result[i]` describes the boundary BEFORE UTF-16 index `i` (1 <= i < text.length): `0` no break, `1` a break is
 * allowed, `2` a break is mandatory (the previous character is a hard line break). `result[0]` and
 * `result[text.length]` are always 0 and 2 respectively. Boundaries inside surrogate pairs are never breakable.
 *
 * @param {string} text
 * @returns {Uint8Array} length text.length + 1
 */
export function findBreaks(text) {
  const n = text.length;
  const out = new Uint8Array(n + 1);
  out[n] = 2;
  if (n < 2) return out;
  // classify code points, remember the start index of each
  /** @type {number[]} */
  const cls = [];
  /** @type {number[]} */
  const idx = [];
  /** @type {boolean[]} */
  const isCM = [];
  let prevBase = AL;
  for (let i = 0; i < n; i++) {
    let cp = text.charCodeAt(i);
    const start = i;
    if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < n) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        cp = ((cp - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
        i++;
      }
    }
    let c = classify(cp);
    const cm = c === CM && cls.length > 0;
    if (cm) c = prevBase;
    else if (c === CM) c = AL;
    else prevBase = c;
    cls.push(c);
    idx.push(start);
    isCM.push(cm);
  }
  const m = cls.length;
  for (let k = 1; k < m; k++) {
    const i = idx[k];
    const a = cls[k - 1];
    const b = cls[k];
    out[i] = decide(cls, k, a, b, isCM[k]);
  }
  return out;
}

/**
 * Class of the last non-space character before position k-1 (skipping spaces).
 * @param {number[]} cls
 * @param {number} k index of the first char after the space run
 */
function beforeSpaces(cls, k) {
  let j = k - 1;
  while (j >= 0 && cls[j] === SP) j--;
  return j >= 0 ? cls[j] : -1;
}

/**
 * @param {number[]} cls
 * @param {number} k boundary before cls[k]
 * @param {number} a class before the boundary
 * @param {number} b class after the boundary
 * @param {boolean} cm whether cls[k] is a combining mark attached to its base
 * @returns {number} 0, 1 or 2
 */
function decide(cls, k, a, b, cm) {
  if (a === BK) return 2; // mandatory
  if (b === BK) return 0;
  if (cm) return 0; // never break before a combining mark / ZWJ / variation selector
  if (b === SP || b === ZW) return 0;
  if (a === ZW) return 1;
  if (a === WJ || b === WJ) return 0;
  if (a === GL) return 0;
  if (b === GL && a !== SP && a !== BA && a !== HY) return 0;
  if (b === CL || b === CP || b === EX || b === IS || b === SY) return 0;
  if (a === SP) {
    const bs = beforeSpaces(cls, k);
    if (bs === OP) return 0;
    if (bs === QU && b === OP) return 0;
    if ((bs === CL || bs === CP) && b === NS) return 0;
    if (bs === B2 && b === B2) return 0;
    return 1;
  }
  if (b === QU || a === QU) return 0;
  if (a === OP) return 0;
  if (b === NS || b === BA || b === HY) return 0;
  if (a === B2) return b === B2 ? 0 : 1;
  if (b === B2) return 1;
  if (a === HY) {
    if (b === NU) return 0;
    // a hyphen only offers a break when it joins two word parts ("well-known"), not at a word start
    const pp = k - 2 >= 0 ? cls[k - 2] : -1;
    if (pp === -1 || pp === SP || pp === BK || pp === OP || pp === HY || pp === QU || pp === ZW) return 0;
    return 1;
  }
  if (a === BA) return 1;
  if (a === SY) return b === NU ? 0 : 1;
  if (a === IS) return b === NU || b === AL ? 0 : 1;
  if ((a === AL || a === NU) && (b === AL || b === NU)) return 0;
  if ((a === PR || a === PO) && (b === AL || b === NU || b === OP)) return 0;
  if ((a === AL || a === NU || a === CP) && (b === PR || b === PO)) return 0;
  if (a === NU && b === OP) return 0;
  if (a === AL && b === OP) return 0;
  if (a === CP && (b === AL || b === NU)) return 0;
  if (a === PR && b === ID) return 0;
  if (a === ID && b === PO) return 0;
  return 1;
}

/**
 * Whether index `i` is a legal place to split a word between characters: not inside a surrogate pair and not
 * before a combining mark, variation selector or ZWJ.
 * @param {string} text
 * @param {number} i
 * @returns {boolean}
 */
export function isClusterStart(text, i) {
  if (i <= 0 || i >= text.length) return true;
  const c = text.charCodeAt(i);
  if (c >= 0xdc00 && c < 0xe000) {
    const h = text.charCodeAt(i - 1);
    if (h >= 0xd800 && h < 0xdc00) return false;
  }
  let cp = c;
  if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
    const d = text.charCodeAt(i + 1);
    if (d >= 0xdc00 && d < 0xe000) cp = ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
  }
  return classify(cp) !== CM;
}

/**
 * Index of the next grapheme-ish cluster boundary after `i`: skips a surrogate pair, following combining marks,
 * variation selectors and ZWJ sequences. Used when a word must be broken between characters.
 * @param {string} text
 * @param {number} i index of the first code unit of a cluster
 * @returns {number} index just after the cluster (<= text.length)
 */
export function nextCluster(text, i) {
  const n = text.length;
  if (i >= n) return n;
  let cp = text.charCodeAt(i);
  let j = i + 1;
  if (cp >= 0xd800 && cp < 0xdc00 && j < n) {
    const d = text.charCodeAt(j);
    if (d >= 0xdc00 && d < 0xe000) {
      cp = ((cp - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
      j++;
    }
  }
  while (j < n) {
    let c = text.charCodeAt(j);
    let w = 1;
    if (c >= 0xd800 && c < 0xdc00 && j + 1 < n) {
      const d = text.charCodeAt(j + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
        w = 2;
      }
    }
    if (classify(c) === CM) {
      j += w;
      // after a ZWJ the next pictograph joins the sequence
      if (c === 0x200d && j < n) {
        let e = text.charCodeAt(j);
        let ew = 1;
        if (e >= 0xd800 && e < 0xdc00 && j + 1 < n) {
          const d = text.charCodeAt(j + 1);
          if (d >= 0xdc00 && d < 0xe000) {
            e = ((e - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
            ew = 2;
          }
        }
        if (e >= 0x1f000 || (e >= 0x2600 && e <= 0x27bf)) j += ew;
      }
    } else break;
  }
  return j;
}

/**
 * Index of the previous cluster boundary before `i` (the inverse of {@link nextCluster}, simplified: steps over
 * a surrogate pair and preceding combining marks).
 * @param {string} text
 * @param {number} i
 * @returns {number}
 */
export function prevCluster(text, i) {
  if (i <= 0) return 0;
  let j = i;
  for (;;) {
    j--;
    let c = text.charCodeAt(j);
    if (c >= 0xdc00 && c < 0xe000 && j > 0) {
      const h = text.charCodeAt(j - 1);
      if (h >= 0xd800 && h < 0xdc00) {
        c = ((h - 0xd800) << 10) + (c - 0xdc00) + 0x10000;
        j--;
      }
    }
    if (classify(c) === CM && j > 0) continue;
    return j;
  }
}
