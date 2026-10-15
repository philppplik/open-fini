/**
 * SFNT font parsing (TrueType / OpenType / WOFF1 / TTC) for the layout engine and the PDF backend.
 *
 * Pure ES module: no DOM, no Node APIs. Every entry point is defensive — malformed input yields
 * `null` (from {@link parseFont}) or neutral values (0) from the lookup functions, never an exception.
 *
 * Units: unless stated otherwise, all metrics on {@link FontInfo} are in font design units
 * (`unitsPerEm` per em). `ascent` and `descent` are BOTH POSITIVE distances from the baseline
 * (descent is the magnitude below the baseline). `measure()` returns pixels.
 *
 * @module sfnt
 */

import { unzlibSync } from '../../../vendor/fflate/fflate.js';

/**
 * @typedef {Object} FontInfo
 * @property {string} family            Typographic family (name ID 16) or family (name ID 1).
 * @property {string} subfamily         Typographic subfamily (17) or subfamily (2), e.g. "Bold Italic".
 * @property {string} fullName          Name ID 4.
 * @property {string} postscriptName    Name ID 6, falls back to the full name without spaces.
 * @property {number} weight            usWeightClass (100..900), derived from macStyle if OS/2 is missing.
 * @property {boolean} italic           Italic/oblique flag.
 * @property {number} unitsPerEm
 * @property {number} ascent            Positive, design units.
 * @property {number} descent           Positive magnitude, design units.
 * @property {number} lineGap           Design units (>= 0).
 * @property {number} capHeight         Design units (estimated when the font does not say).
 * @property {number} xHeight           Design units (estimated when the font does not say).
 * @property {number} numGlyphs
 * @property {boolean} isCFF            True when outlines are CFF/CFF2 (OpenType PostScript flavor).
 * @property {'glyf'|'cff'|'cff2'|'none'} outline
 * @property {number} flags             PDF FontDescriptor /Flags value.
 * @property {number} italicAngle       Degrees (negative = leaning right).
 * @property {number[]} bbox            [xMin, yMin, xMax, yMax] in design units.
 * @property {number} fsType            OS/2 embedding permissions (0 when missing).
 * @property {boolean} embeddable       False when the license bits forbid embedding or outlines are unsupported.
 * @property {Uint8Array} bytes         A standalone sfnt (rebuilt for WOFF and TTC input).
 * @property {string[]} tableTags       All tables present.
 * @property {(cp: number) => number} glyphForCodePoint   0 when the code point is not mapped (.notdef).
 * @property {(gid: number) => number} advanceWidth       Design units.
 * @property {(left: number, right: number) => number} kerning  Pair adjustment in design units (0 if none).
 * @property {(text: string, size: number, opts?: {tracking?: number, kerning?: boolean}) => number} measure
 *   Advance width of `text` in pixels at `size` px. `tracking` is in 1/1000 em added after each code point.
 * @property {(tag: string) => (Uint8Array|null)} getTable    Raw table bytes (a view into `bytes`).
 * @property {(gid: number) => (number[]|null)} glyphBounds   [xMin,yMin,xMax,yMax] (TrueType outlines only).
 */

const TAG_TTF = 0x00010000;
const TAG_TRUE = 0x74727565; // 'true'
const TAG_OTTO = 0x4f54544f; // 'OTTO'
const TAG_TTCF = 0x74746366; // 'ttcf'
const TAG_WOFF = 0x774f4646; // 'wOFF'
const TAG_WOFF2 = 0x774f4632; // 'wOF2'

const MAX_TABLES = 512;
const MAX_TABLE_SIZE = 96 * 1024 * 1024;

const MAC_ROMAN_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

/** @param {number} n @returns {string} */
function tagToString(n) {
  return String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

/**
 * Builds a standalone sfnt from a table map.
 * @param {number} flavor
 * @param {Map<string, Uint8Array>} tables
 * @returns {Uint8Array}
 */
export function buildSfnt(flavor, tables) {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= n) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = n * 16 - searchRange;
  let size = 12 + 16 * n;
  for (const t of tags) size += (tables.get(t).length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  dv.setUint16(6, searchRange);
  dv.setUint16(8, entrySelector);
  dv.setUint16(10, rangeShift);
  let off = 12 + 16 * n;
  for (let i = 0; i < n; i++) {
    const t = tags[i];
    const data = tables.get(t);
    const rec = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[rec + k] = t.charCodeAt(k);
    let sum = 0;
    const padded = (data.length + 3) & ~3;
    out.set(data, off);
    for (let p = 0; p < padded; p += 4) sum = (sum + dv.getUint32(off + p)) >>> 0;
    dv.setUint32(rec + 4, sum);
    dv.setUint32(rec + 8, off);
    dv.setUint32(rec + 12, data.length);
    off += padded;
  }
  return out;
}

/**
 * Reads the table directory of an sfnt starting at `base`.
 * @param {DataView} dv
 * @param {Uint8Array} bytes
 * @param {number} base
 * @returns {{flavor:number, tables:Map<string,{offset:number,length:number}>}|null}
 */
function readDirectory(dv, bytes, base) {
  if (base + 12 > bytes.length) return null;
  const flavor = dv.getUint32(base);
  if (flavor !== TAG_TTF && flavor !== TAG_TRUE && flavor !== TAG_OTTO) return null;
  const n = dv.getUint16(base + 4);
  if (n === 0 || n > MAX_TABLES || base + 12 + n * 16 > bytes.length) return null;
  /** @type {Map<string,{offset:number,length:number}>} */
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const rec = base + 12 + i * 16;
    const tag = tagToString(dv.getUint32(rec));
    const offset = dv.getUint32(rec + 8);
    let length = dv.getUint32(rec + 12);
    if (offset >= bytes.length) continue;
    if (offset + length > bytes.length) length = bytes.length - offset;
    if (length > MAX_TABLE_SIZE) continue;
    if (!tables.has(tag)) tables.set(tag, { offset, length });
  }
  return { flavor, tables };
}

/**
 * Unwraps WOFF 1.0 into a standalone sfnt.
 * @param {Uint8Array} bytes
 * @param {DataView} dv
 * @returns {Uint8Array|null}
 */
function unwrapWoff(bytes, dv) {
  if (bytes.length < 44) return null;
  const flavor = dv.getUint32(4);
  const n = dv.getUint16(12);
  if (n === 0 || n > MAX_TABLES || 44 + n * 20 > bytes.length) return null;
  /** @type {Map<string, Uint8Array>} */
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const rec = 44 + i * 20;
    const tag = tagToString(dv.getUint32(rec));
    const offset = dv.getUint32(rec + 4);
    const compLength = dv.getUint32(rec + 8);
    const origLength = dv.getUint32(rec + 12);
    if (offset + compLength > bytes.length || origLength > MAX_TABLE_SIZE) return null;
    const raw = bytes.subarray(offset, offset + compLength);
    let data;
    if (compLength < origLength) {
      data = unzlibSync(raw, { out: new Uint8Array(origLength) });
      if (data.length !== origLength) return null;
    } else if (compLength === origLength) {
      data = raw;
    } else {
      return null;
    }
    tables.set(tag, data);
  }
  return buildSfnt(flavor, tables);
}

/**
 * Copies one font of a TTC into a standalone sfnt.
 * @param {Uint8Array} bytes
 * @param {DataView} dv
 * @param {number} index
 * @returns {Uint8Array|null}
 */
function extractFromCollection(bytes, dv, index) {
  if (bytes.length < 16) return null;
  const count = dv.getUint32(8);
  if (index < 0 || index >= count || 12 + count * 4 > bytes.length) return null;
  const base = dv.getUint32(12 + index * 4);
  const dir = readDirectory(dv, bytes, base);
  if (!dir) return null;
  /** @type {Map<string, Uint8Array>} */
  const tables = new Map();
  for (const [tag, t] of dir.tables) tables.set(tag, bytes.subarray(t.offset, t.offset + t.length));
  return buildSfnt(dir.flavor, tables);
}

/**
 * Decodes a name record string.
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} len
 * @param {number} platform
 * @returns {string}
 */
function decodeName(bytes, start, len, platform) {
  let s = '';
  if (platform === 1) {
    for (let i = 0; i < len; i++) {
      const c = bytes[start + i];
      s += c < 128 ? String.fromCharCode(c) : MAC_ROMAN_HIGH[c - 128] || '?';
    }
    return s;
  }
  const end = start + (len & ~1);
  for (let i = start; i < end; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return s;
}

/**
 * Parses the `name` table and returns the best string for each wanted ID.
 * @param {Uint8Array} tbl
 * @returns {Map<number,string>}
 */
function parseNames(tbl) {
  const out = new Map();
  const best = new Map();
  if (!tbl || tbl.length < 6) return out;
  const dv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  const count = dv.getUint16(2);
  const strOff = dv.getUint16(4);
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > tbl.length) break;
    const platform = dv.getUint16(r);
    const enc = dv.getUint16(r + 2);
    const lang = dv.getUint16(r + 4);
    const id = dv.getUint16(r + 6);
    const len = dv.getUint16(r + 8);
    const off = dv.getUint16(r + 10);
    if (id !== 1 && id !== 2 && id !== 4 && id !== 6 && id !== 16 && id !== 17) continue;
    const s = strOff + off;
    if (s + len > tbl.length) continue;
    let score = 0;
    if (platform === 3 && (enc === 1 || enc === 10)) score = lang === 0x409 ? 6 : 5;
    else if (platform === 0) score = 4;
    else if (platform === 1 && lang === 0) score = 3;
    else if (platform === 3) score = 2;
    else continue;
    if (score > (best.get(id) || 0)) {
      best.set(id, score);
      out.set(id, decodeName(tbl, s, len, platform === 1 ? 1 : 0).replace(/\0/g, ''));
    }
  }
  return out;
}

/**
 * Builds a code point -> glyph lookup from the cmap table.
 * @param {Uint8Array|null} tbl
 * @returns {{lookup:(cp:number)=>number, symbol:boolean}}
 */
function buildCmap(tbl) {
  const none = { lookup: () => 0, symbol: false };
  if (!tbl || tbl.length < 4) return none;
  const dv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  const n = dv.getUint16(2);
  let pick = null;
  let pickScore = -1;
  for (let i = 0; i < n; i++) {
    const r = 4 + i * 8;
    if (r + 8 > tbl.length) break;
    const platform = dv.getUint16(r);
    const enc = dv.getUint16(r + 2);
    const offset = dv.getUint32(r + 4);
    if (offset + 4 > tbl.length) continue;
    const format = dv.getUint16(offset);
    if (format !== 0 && format !== 4 && format !== 6 && format !== 12 && format !== 13) continue;
    let score = 0;
    if (platform === 3 && enc === 10) score = 10;
    else if (platform === 0 && (enc === 4 || enc === 6)) score = 9;
    else if (platform === 3 && enc === 1) score = 8;
    else if (platform === 0) score = 7;
    else if (platform === 3 && enc === 0) score = 5;
    else if (platform === 1 && enc === 0) score = 2;
    else continue;
    if (format === 12 && score >= 7) score += 1;
    if (score > pickScore) {
      pickScore = score;
      pick = { platform, enc, offset, format };
    }
  }
  if (!pick) return none;
  const { offset: o, format } = pick;
  const symbol = pick.platform === 3 && pick.enc === 0;
  const macOnly = pick.platform === 1;
  let raw;
  if (format === 4) {
    const segX2 = dv.getUint16(o + 6);
    const segCount = segX2 >> 1;
    const endO = o + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    if (rangeO + segX2 > tbl.length) return none;
    raw = (cp) => {
      if (cp > 0xffff) return 0;
      let lo = 0;
      let hi = segCount - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (dv.getUint16(endO + mid * 2) < cp) lo = mid + 1;
        else hi = mid;
      }
      if (lo >= segCount) return 0;
      const end = dv.getUint16(endO + lo * 2);
      const start = dv.getUint16(startO + lo * 2);
      if (cp < start || cp > end) return 0;
      const delta = dv.getUint16(deltaO + lo * 2);
      const ro = dv.getUint16(rangeO + lo * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const addr = rangeO + lo * 2 + ro + (cp - start) * 2;
      if (addr + 2 > tbl.length) return 0;
      const g = dv.getUint16(addr);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    };
  } else if (format === 12 || format === 13) {
    const nGroups = dv.getUint32(o + 12);
    if (o + 16 + nGroups * 12 > tbl.length) return none;
    const many = format === 13;
    raw = (cp) => {
      let lo = 0;
      let hi = nGroups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = o + 16 + mid * 12;
        const start = dv.getUint32(g);
        if (cp < start) hi = mid - 1;
        else if (cp > dv.getUint32(g + 4)) lo = mid + 1;
        else return many ? dv.getUint32(g + 8) : dv.getUint32(g + 8) + (cp - start);
      }
      return 0;
    };
  } else if (format === 6) {
    const first = dv.getUint16(o + 6);
    const count = dv.getUint16(o + 8);
    if (o + 10 + count * 2 > tbl.length) return none;
    raw = (cp) => (cp >= first && cp < first + count ? dv.getUint16(o + 10 + (cp - first) * 2) : 0);
  } else {
    // format 0
    if (o + 6 + 256 > tbl.length) return none;
    raw = (cp) => (cp < 256 ? tbl[o + 6 + cp] : 0);
  }
  let lookup = raw;
  if (symbol) {
    lookup = (cp) => raw(cp) || (cp < 256 ? raw(0xf000 + cp) : 0);
  } else if (macOnly) {
    lookup = (cp) => (cp < 128 ? raw(cp) : 0);
  }
  return { lookup, symbol };
}

/** @param {number} v @returns {number} number of set bits (16-bit) */
function popcount16(v) {
  v = v - ((v >> 1) & 0x5555);
  v = (v & 0x3333) + ((v >> 2) & 0x3333);
  v = (v + (v >> 4)) & 0x0f0f;
  return (v + (v >> 8)) & 0x1f;
}

/**
 * Builds a kerning function from the legacy `kern` table (format 0 subtables).
 * @param {Uint8Array|null} tbl
 * @returns {((l:number,r:number)=>number)|null}
 */
function buildKernTable(tbl) {
  if (!tbl || tbl.length < 4) return null;
  const dv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  if (dv.getUint16(0) !== 0) return null; // Apple-style kern (version 1.0) unsupported
  const nTables = dv.getUint16(2);
  /** @type {{o:number,n:number}[]} */
  const subs = [];
  let p = 4;
  for (let i = 0; i < nTables; i++) {
    if (p + 14 > tbl.length) break;
    const length = dv.getUint16(p + 2);
    const coverage = dv.getUint16(p + 4);
    const format = coverage >> 8;
    const horizontal = coverage & 1;
    const minimum = coverage & 2;
    if (format === 0 && horizontal && !minimum) {
      const nPairs = dv.getUint16(p + 6);
      if (p + 14 + nPairs * 6 <= tbl.length) subs.push({ o: p + 14, n: nPairs });
    }
    if (length < 6) break;
    p += length;
  }
  if (!subs.length) return null;
  return (l, r) => {
    const key = ((l << 16) | r) >>> 0;
    let sum = 0;
    for (const s of subs) {
      let lo = 0;
      let hi = s.n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const q = s.o + mid * 6;
        const k = dv.getUint32(q);
        if (key < k) hi = mid - 1;
        else if (key > k) lo = mid + 1;
        else {
          sum += dv.getInt16(q + 4);
          break;
        }
      }
    }
    return sum;
  };
}

/**
 * Coverage table lookup: returns the coverage index of `gid` or -1.
 * @param {DataView} dv
 * @param {number} o
 * @param {number} gid
 */
function coverageIndex(dv, o, gid) {
  const fmt = dv.getUint16(o);
  const cnt = dv.getUint16(o + 2);
  if (fmt === 1) {
    let lo = 0;
    let hi = cnt - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = dv.getUint16(o + 4 + mid * 2);
      if (gid < g) hi = mid - 1;
      else if (gid > g) lo = mid + 1;
      else return mid;
    }
    return -1;
  }
  if (fmt === 2) {
    let lo = 0;
    let hi = cnt - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = o + 4 + mid * 6;
      const s = dv.getUint16(r);
      const e = dv.getUint16(r + 2);
      if (gid < s) hi = mid - 1;
      else if (gid > e) lo = mid + 1;
      else return dv.getUint16(r + 4) + (gid - s);
    }
  }
  return -1;
}

/**
 * ClassDef lookup.
 * @param {DataView} dv
 * @param {number} o
 * @param {number} gid
 */
function classOf(dv, o, gid) {
  const fmt = dv.getUint16(o);
  if (fmt === 1) {
    const start = dv.getUint16(o + 2);
    const cnt = dv.getUint16(o + 4);
    return gid >= start && gid < start + cnt ? dv.getUint16(o + 6 + (gid - start) * 2) : 0;
  }
  if (fmt === 2) {
    const cnt = dv.getUint16(o + 2);
    let lo = 0;
    let hi = cnt - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = o + 4 + mid * 6;
      const s = dv.getUint16(r);
      const e = dv.getUint16(r + 2);
      if (gid < s) hi = mid - 1;
      else if (gid > e) lo = mid + 1;
      else return dv.getUint16(r + 4);
    }
  }
  return 0;
}

/**
 * Builds a kerning function from the GPOS table (pair adjustment lookups of 'kern' features).
 * Script/language selection is ignored: all 'kern' lookups are applied.
 * @param {Uint8Array|null} tbl
 * @returns {((l:number,r:number)=>number)|null}
 */
function buildGposKern(tbl) {
  if (!tbl || tbl.length < 10) return null;
  const dv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  if (dv.getUint16(0) !== 1) return null;
  const featListO = dv.getUint16(6);
  const lookupListO = dv.getUint16(8);
  if (!featListO || !lookupListO) return null;
  const featCount = dv.getUint16(featListO);
  const lookupIdx = new Set();
  for (let i = 0; i < featCount; i++) {
    const r = featListO + 2 + i * 6;
    const tag = String.fromCharCode(tbl[r], tbl[r + 1], tbl[r + 2], tbl[r + 3]);
    if (tag !== 'kern') continue;
    const ft = featListO + dv.getUint16(r + 4);
    const n = dv.getUint16(ft + 2);
    for (let k = 0; k < n; k++) lookupIdx.add(dv.getUint16(ft + 4 + k * 2));
  }
  if (!lookupIdx.size) return null;
  const lookupCount = dv.getUint16(lookupListO);
  /** @type {{o:number, fmt:number}[][]} */
  const lookups = [];
  for (const li of [...lookupIdx].sort((a, b) => a - b)) {
    if (li >= lookupCount) continue;
    const lo = lookupListO + dv.getUint16(lookupListO + 2 + li * 2);
    let type = dv.getUint16(lo);
    const subCount = dv.getUint16(lo + 4);
    const subs = [];
    for (let s = 0; s < subCount; s++) {
      let so = lo + dv.getUint16(lo + 6 + s * 2);
      let t = type;
      if (t === 9) {
        t = dv.getUint16(so + 2);
        so = so + dv.getUint32(so + 4);
      }
      if (t !== 2) continue;
      const fmt = dv.getUint16(so);
      if (fmt === 1 || fmt === 2) subs.push({ o: so, fmt });
    }
    if (subs.length) lookups.push(subs);
  }
  if (!lookups.length) return null;
  const valueSize = (vf) => popcount16(vf) * 2;
  const xAdvOffset = (vf) => popcount16(vf & 3) * 2;

  const pairInSub = (sub, l, r) => {
    const o = sub.o;
    const covO = o + dv.getUint16(o + 2);
    const ci = coverageIndex(dv, covO, l);
    if (ci < 0) return null;
    const vf1 = dv.getUint16(o + 4);
    const vf2 = dv.getUint16(o + 6);
    const s1 = valueSize(vf1);
    const s2 = valueSize(vf2);
    const hasX = (vf1 & 4) !== 0;
    if (sub.fmt === 1) {
      const psCount = dv.getUint16(o + 8);
      if (ci >= psCount) return null;
      const ps = o + dv.getUint16(o + 10 + ci * 2);
      const pc = dv.getUint16(ps);
      const rec = 2 + s1 + s2;
      let lo = 0;
      let hi = pc - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const q = ps + 2 + mid * rec;
        const g2 = dv.getUint16(q);
        if (r < g2) hi = mid - 1;
        else if (r > g2) lo = mid + 1;
        else return hasX ? dv.getInt16(q + 2 + xAdvOffset(vf1)) : 0;
      }
      return null;
    }
    const cd1 = o + dv.getUint16(o + 8);
    const cd2 = o + dv.getUint16(o + 10);
    const c1n = dv.getUint16(o + 12);
    const c2n = dv.getUint16(o + 14);
    const c1 = classOf(dv, cd1, l);
    const c2 = classOf(dv, cd2, r);
    if (c1 >= c1n || c2 >= c2n) return null;
    const rec = s1 + s2;
    const q = o + 16 + (c1 * c2n + c2) * rec;
    return hasX ? dv.getInt16(q + xAdvOffset(vf1)) : 0;
  };

  return (l, r) => {
    let sum = 0;
    for (const subs of lookups) {
      for (const sub of subs) {
        const v = pairInSub(sub, l, r);
        if (v !== null) {
          sum += v;
          break;
        }
      }
    }
    return sum;
  };
}

/**
 * Counts code points (a surrogate pair counts once).
 * @param {string} s
 */
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
 * Parses a font file.
 *
 * Supports TrueType (`0x00010000`, `true`), OpenType/CFF (`OTTO`), TrueType Collections (first font, or
 * `opts.index`) and WOFF 1.0. WOFF2 is explicitly unsupported and returns `null`, as does anything malformed.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{index?: number}} [opts]
 * @returns {FontInfo|null}
 */
export function parseFont(bytes, opts) {
  try {
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
    // Node Buffers are Uint8Array subclasses whose slice() shares memory: always work on a plain view
    if (bytes.constructor !== Uint8Array) bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sig = dv.getUint32(0);
    let sfnt = bytes;
    if (sig === TAG_WOFF2) return null;
    if (sig === TAG_WOFF) {
      sfnt = unwrapWoff(bytes, dv);
    } else if (sig === TAG_TTCF) {
      sfnt = extractFromCollection(bytes, dv, (opts && opts.index) | 0);
    } else if (sig !== TAG_TTF && sig !== TAG_TRUE && sig !== TAG_OTTO) {
      return null;
    }
    if (!sfnt) return null;
    dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
    const dir = readDirectory(dv, sfnt, 0);
    if (!dir) return null;
    const dirTables = dir.tables;
    /** @param {string} tag */
    const getTable = (tag) => {
      const t = dirTables.get(tag);
      return t ? sfnt.subarray(t.offset, t.offset + t.length) : null;
    };

    const head = getTable('head');
    const hhea = getTable('hhea');
    const maxp = getTable('maxp');
    if (!head || head.length < 54 || !hhea || hhea.length < 36 || !maxp || maxp.length < 6) return null;
    const hdv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const unitsPerEm = hdv.getUint16(18);
    if (unitsPerEm < 16 || unitsPerEm > 16384) return null;
    const bbox = [hdv.getInt16(36), hdv.getInt16(38), hdv.getInt16(40), hdv.getInt16(42)];
    const macStyle = hdv.getUint16(44);
    const locaFormat = hdv.getInt16(50);
    const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4);
    const hv = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength);
    const hheaAscent = hv.getInt16(4);
    const hheaDescent = hv.getInt16(6);
    const hheaGap = hv.getInt16(8);
    let numHMetrics = hv.getUint16(34);

    const hasGlyf = dirTables.has('glyf') && dirTables.has('loca');
    const hasCFF = dirTables.has('CFF ');
    const hasCFF2 = dirTables.has('CFF2');
    /** @type {'glyf'|'cff'|'cff2'|'none'} */
    const outline = hasGlyf ? 'glyf' : hasCFF ? 'cff' : hasCFF2 ? 'cff2' : 'none';
    if (outline === 'none') return null;

    const hmtx = getTable('hmtx');
    if (!hmtx) return null;
    if (numHMetrics * 4 > hmtx.length) numHMetrics = Math.floor(hmtx.length / 4);
    if (numHMetrics < 1) return null;
    const mv = new DataView(hmtx.buffer, hmtx.byteOffset, hmtx.byteLength);

    // OS/2
    const os2 = getTable('OS/2');
    let weight = 0;
    let fsSelection = 0;
    let fsType = 0;
    let typoAsc = 0;
    let typoDesc = 0;
    let typoGap = 0;
    let winAsc = 0;
    let winDesc = 0;
    let xHeight = 0;
    let capHeight = 0;
    let panoseFamily = 0;
    let panoseSerif = 0;
    if (os2 && os2.length >= 78) {
      const ov = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
      const ver = ov.getUint16(0);
      weight = ov.getUint16(4);
      fsType = ov.getUint16(8);
      panoseFamily = os2[32];
      panoseSerif = os2[33];
      fsSelection = ov.getUint16(62);
      typoAsc = ov.getInt16(68);
      typoDesc = ov.getInt16(70);
      typoGap = ov.getInt16(72);
      if (os2.length >= 78) {
        winAsc = ov.getUint16(74);
        winDesc = ov.getUint16(76);
      }
      if (ver >= 2 && os2.length >= 90) {
        xHeight = ov.getInt16(86);
        capHeight = ov.getInt16(88);
      }
    }
    if (!weight) weight = macStyle & 1 ? 700 : 400;
    if (weight < 1) weight = 400;
    const italic = os2 ? (fsSelection & 1) !== 0 || (macStyle & 2) !== 0 : (macStyle & 2) !== 0;

    let ascent;
    let descent;
    let lineGap;
    if (os2 && fsSelection & 128 && (typoAsc || typoDesc)) {
      ascent = typoAsc;
      descent = -typoDesc;
      lineGap = typoGap;
    } else if (hheaAscent || hheaDescent) {
      ascent = hheaAscent;
      descent = -hheaDescent;
      lineGap = hheaGap;
    } else if (winAsc || winDesc) {
      ascent = winAsc;
      descent = winDesc;
      lineGap = 0;
    } else {
      ascent = Math.round(unitsPerEm * 0.8);
      descent = Math.round(unitsPerEm * 0.2);
      lineGap = 0;
    }
    descent = Math.abs(descent);
    if (lineGap < 0) lineGap = 0;

    // post
    const post = getTable('post');
    let italicAngle = 0;
    let isFixedPitch = false;
    if (post && post.length >= 16) {
      const pv = new DataView(post.buffer, post.byteOffset, post.byteLength);
      italicAngle = pv.getInt32(4) / 65536;
      isFixedPitch = pv.getUint32(12) !== 0;
    }

    // names
    const names = parseNames(getTable('name'));
    const family = names.get(16) || names.get(1) || '';
    const subfamily = names.get(17) || names.get(2) || '';
    const fullName = names.get(4) || (family + (subfamily ? ' ' + subfamily : '')).trim();
    const postscriptName = (names.get(6) || fullName || family).replace(/\s+/g, '');

    const cmap = buildCmap(getTable('cmap'));

    // glyph lookup caches
    const gidCacheSize = 0x800;
    const gidCache = new Int32Array(gidCacheSize).fill(-1);
    /** @type {Map<number, number>} */
    const gidMap = new Map();
    /** @param {number} cp */
    const glyphForCodePoint = (cp) => {
      try {
        if (cp < gidCacheSize && cp >= 0) {
          const c = gidCache[cp];
          if (c >= 0) return c;
          let g = cmap.lookup(cp);
          if (g >= numGlyphs) g = 0;
          gidCache[cp] = g;
          return g;
        }
        let g = gidMap.get(cp);
        if (g === undefined) {
          g = cp >= 0 && cp <= 0x10ffff ? cmap.lookup(cp) : 0;
          if (g >= numGlyphs) g = 0;
          if (gidMap.size > 20000) gidMap.clear();
          gidMap.set(cp, g);
        }
        return g;
      } catch (_) {
        return 0;
      }
    };

    /** @param {number} gid */
    const advanceWidth = (gid) => {
      try {
        if (!(gid >= 0) || gid >= numGlyphs) return 0;
        const i = gid < numHMetrics ? gid : numHMetrics - 1;
        return mv.getUint16(i * 4);
      } catch (_) {
        return 0;
      }
    };

    // kerning
    let kernFn = null;
    try {
      kernFn = buildGposKern(getTable('GPOS')) || buildKernTable(getTable('kern'));
    } catch (_) {
      kernFn = null;
    }
    /** @type {Map<number, number>} */
    const kernCache = new Map();
    /** @param {number} l @param {number} r */
    const kerning = (l, r) => {
      if (!kernFn || l <= 0 || r <= 0) return 0;
      const key = l * 65536 + r;
      let v = kernCache.get(key);
      if (v === undefined) {
        try {
          v = kernFn(l, r) || 0;
        } catch (_) {
          v = 0;
        }
        if (kernCache.size > 60000) kernCache.clear();
        kernCache.set(key, v);
      }
      return v;
    };

    /**
     * @param {string} text
     * @param {number} size
     * @param {{tracking?: number, kerning?: boolean}} [o]
     */
    const measure = (text, size, o) => {
      let units = 0;
      let prev = 0;
      let count = 0;
      const useKern = !(o && o.kerning === false) && kernFn !== null;
      for (let i = 0; i < text.length; i++) {
        let cp = text.charCodeAt(i);
        if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < text.length) {
          const d = text.charCodeAt(i + 1);
          if (d >= 0xdc00 && d < 0xe000) {
            cp = ((cp - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
            i++;
          }
        }
        const g = glyphForCodePoint(cp);
        units += advanceWidth(g);
        if (useKern && prev) units += kerning(prev, g);
        prev = g;
        count++;
      }
      const tr = o && o.tracking ? o.tracking : 0;
      return (units * size) / unitsPerEm + (tr * size * count) / 1000;
    };

    // glyph bounds (TrueType)
    const locaTbl = outline === 'glyf' ? getTable('loca') : null;
    const glyfTbl = outline === 'glyf' ? getTable('glyf') : null;
    /** @param {number} gid */
    const glyphBounds = (gid) => {
      try {
        if (!locaTbl || !glyfTbl || !(gid >= 0) || gid >= numGlyphs) return null;
        const lv = new DataView(locaTbl.buffer, locaTbl.byteOffset, locaTbl.byteLength);
        let a;
        let b;
        if (locaFormat === 0) {
          if ((gid + 2) * 2 > locaTbl.length) return null;
          a = lv.getUint16(gid * 2) * 2;
          b = lv.getUint16(gid * 2 + 2) * 2;
        } else {
          if ((gid + 2) * 4 > locaTbl.length) return null;
          a = lv.getUint32(gid * 4);
          b = lv.getUint32(gid * 4 + 4);
        }
        if (b <= a || a + 10 > glyfTbl.length) return null;
        const gv = new DataView(glyfTbl.buffer, glyfTbl.byteOffset, glyfTbl.byteLength);
        return [gv.getInt16(a + 2), gv.getInt16(a + 4), gv.getInt16(a + 6), gv.getInt16(a + 8)];
      } catch (_) {
        return null;
      }
    };

    if (!capHeight) {
      const gH = glyphForCodePoint(0x48);
      const hb = gH ? glyphBounds(gH) : null;
      capHeight = hb && hb[3] > 0 ? hb[3] : Math.round(unitsPerEm * 0.7);
    }
    if (!xHeight) {
      const gx = glyphForCodePoint(0x78);
      const xb = gx ? glyphBounds(gx) : null;
      xHeight = xb && xb[3] > 0 ? xb[3] : Math.round(unitsPerEm * 0.5);
    }

    // PDF descriptor flags
    let flags = 0;
    if (isFixedPitch) flags |= 1;
    if (panoseFamily === 2 && panoseSerif >= 2 && panoseSerif <= 10) flags |= 2;
    if (panoseFamily === 3) flags |= 8;
    flags |= cmap.symbol ? 4 : 32;
    if (italic) flags |= 64;

    const embeddable = (fsType & 2) === 0 && outline !== 'cff2';

    return {
      family,
      subfamily,
      fullName,
      postscriptName,
      weight,
      italic,
      unitsPerEm,
      ascent,
      descent,
      lineGap,
      capHeight,
      xHeight,
      numGlyphs,
      isCFF: outline === 'cff' || outline === 'cff2',
      outline,
      flags,
      italicAngle,
      bbox,
      fsType,
      embeddable,
      bytes: sfnt,
      tableTags: [...dirTables.keys()],
      glyphForCodePoint,
      advanceWidth,
      kerning,
      measure,
      getTable,
      glyphBounds,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Counts code points of a string (surrogate pairs count once). Exposed for the layout and PDF modules.
 * @param {string} s
 * @returns {number}
 */
export function codePointCount(s) {
  return cpCount(s);
}
