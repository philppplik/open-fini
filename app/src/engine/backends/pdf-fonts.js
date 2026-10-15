/**
 * Font handling for the PDF writer: base-14 fonts (WinAnsi, standard metrics), embedded TrueType fonts
 * (Type0 / CIDFontType2, Identity-H, glyph-id preserving subsets) and embedded OpenType/CFF fonts
 * (Type0 / CIDFontType0 with the complete font file). Every embedded font gets a /W widths array and a ToUnicode CMap,
 * so text stays searchable and copyable.
 *
 * @module pdf-fonts
 */

import { parseFont, buildSfnt } from '../layout/sfnt.js';
import { std14Name, std14Widths, winAnsiCode } from '../layout/std14.js';
import { num, pdfName } from './pdf-writer.js';

/**
 * Code points that never produce a glyph (zero-width, format and control characters).
 * @param {number} cp
 * @returns {boolean}
 */
export function isIgnorable(cp) {
  return (
    cp < 32 ||
    cp === 0x7f ||
    cp === 0xad ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff
  );
}

/**
 * @typedef {Object} FontEntry
 * @property {'std'|'ttf'|'cff'} kind
 * @property {number} ref object number of the font dictionary
 * @property {string} [ps]            base-14 name
 * @property {import('../layout/sfnt.js').FontInfo} [info]
 * @property {Map<number, number>} [used]  glyph id -> first code point that used it
 */

/** Creates and writes the font objects of a document. */
export class FontManager {
  /**
   * @param {import('./pdf-writer.js').PdfWriter} writer
   * @param {((font: object) => (Uint8Array|null|undefined))|undefined} provider
   */
  constructor(writer, provider) {
    this.w = writer;
    this.provider = provider;
    /** @type {Map<string, FontEntry>} */
    this.entries = new Map();
    /** @type {Map<string, FontEntry|null>} */
    this.providerCache = new Map();
  }

  /**
   * Returns the font entry for a display-list font (embedded when the provider supplies a usable font file,
   * otherwise the closest base-14 font).
   * @param {{family:string, size:number, weight:number, style:string}} font
   * @returns {FontEntry}
   */
  get(font) {
    if (this.provider) {
      const key = `${font.family}\u0000${font.weight}\u0000${font.style}`;
      let e = this.providerCache.get(key);
      if (e === undefined) {
        e = null;
        try {
          const bytes = this.provider(font);
          const info = bytes ? parseFont(bytes) : null;
          if (info && info.embeddable && (info.outline === 'glyf' || info.outline === 'cff')) {
            e = { kind: info.outline === 'glyf' ? 'ttf' : 'cff', ref: this.w.reserve(), info, used: new Map() };
            this.entries.set(`emb:${key}`, e);
          }
        } catch (_) {
          e = null;
        }
        this.providerCache.set(key, e);
      }
      if (e) return e;
    }
    const ps = std14Name(font.family, font.weight, font.style);
    let e = this.entries.get(ps);
    if (!e) {
      e = { kind: 'std', ref: this.w.reserve(), ps };
      this.entries.set(ps, e);
    }
    return e;
  }

  /**
   * Encodes text for a `Tj` operand with the given font entry.
   * @param {FontEntry} e
   * @param {string} text
   * @returns {string} a PDF string (literal for base-14, hex for embedded fonts); empty text yields `''`
   */
  encode(e, text) {
    if (e.kind === 'std') {
      let s = '';
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (isIgnorable(cp)) continue;
        let code = winAnsiCode(cp);
        if (code < 0) code = 63;
        if (code === 40 || code === 41 || code === 92) s += '\\' + String.fromCharCode(code);
        else if (code < 32 || code > 126) s += '\\' + code.toString(8).padStart(3, '0');
        else s += String.fromCharCode(code);
      }
      return s ? '(' + s + ')' : '';
    }
    const info = /** @type {any} */ (e.info);
    const used = /** @type {Map<number, number>} */ (e.used);
    let hex = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (isIgnorable(cp)) continue;
      let gid = info.glyphForCodePoint(cp);
      if (!gid && /\s/u.test(ch)) gid = info.glyphForCodePoint(0x20);
      if (!used.has(gid)) used.set(gid, cp);
      hex += gid.toString(16).padStart(4, '0');
    }
    return hex ? '<' + hex + '>' : '';
  }

  /**
   * Advance of a text string in 1/1000 em (used for underline lengths of fallback measuring; not needed for `Tj`).
   * @param {FontEntry} e
   * @param {number} cp
   * @returns {number}
   */
  advance(e, cp) {
    if (e.kind === 'std') {
      const code = winAnsiCode(cp);
      return std14Widths(/** @type {string} */ (e.ps))[(code < 0 ? 63 : code) - 32];
    }
    const info = /** @type {any} */ (e.info);
    return (info.advanceWidth(info.glyphForCodePoint(cp)) * 1000) / info.unitsPerEm;
  }

  /** Writes all font objects. Call once after every page has been generated. */
  finish() {
    for (const e of this.entries.values()) {
      if (e.kind === 'std') this.writeStd(e);
      else this.writeEmbedded(e);
    }
  }

  /** @param {FontEntry} e */
  writeStd(e) {
    const ps = /** @type {string} */ (e.ps);
    const widths = std14Widths(ps);
    this.w.set(
      e.ref,
      `<< /Type /Font /Subtype /Type1 /BaseFont /${pdfName(ps)} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${Array.from(widths).join(' ')}] >>`,
    );
  }

  /** @param {FontEntry} e */
  writeEmbedded(e) {
    const w = this.w;
    const info = /** @type {any} */ (e.info);
    const used = /** @type {Map<number, number>} */ (e.used);
    const gids = [...used.keys()].sort((a, b) => a - b);
    const scale = 1000 / info.unitsPerEm;
    let fontFile;
    let baseName = sanitizeName(info.postscriptName || info.family || 'Font');
    let fileDict;
    if (e.kind === 'ttf') {
      const sub = subsetTrueType(info, gids);
      const bytes = sub || info.bytes;
      if (sub) baseName = subsetTag(baseName, gids) + '+' + baseName;
      fontFile = w.addStream(`/Length1 ${bytes.length}`, bytes, { compress: true });
      fileDict = `/FontFile2 ${fontFile} 0 R`;
    } else {
      fontFile = w.addStream('/Subtype /OpenType', info.bytes, { compress: true });
      fileDict = `/FontFile3 ${fontFile} 0 R`;
    }
    const bb = info.bbox.map((v) => Math.round(v * scale));
    const desc = w.add(
      `<< /Type /FontDescriptor /FontName /${pdfName(baseName)} /Flags ${info.flags} /FontBBox [${bb.join(' ')}] /ItalicAngle ${num(info.italicAngle)} /Ascent ${Math.round(info.ascent * scale)} /Descent ${-Math.round(info.descent * scale)} /CapHeight ${Math.round(info.capHeight * scale)} /StemV ${Math.round(50 + Math.pow(info.weight / 65, 2))} ${fileDict} >>`,
    );
    // /W: group consecutive glyph ids
    let W = '';
    let i = 0;
    while (i < gids.length) {
      let j = i;
      while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) j++;
      const list = [];
      for (let k = i; k <= j; k++) list.push(Math.round(info.advanceWidth(gids[k]) * scale));
      W += `${gids[i]} [${list.join(' ')}] `;
      i = j + 1;
    }
    const cidType = e.kind === 'ttf' ? 'CIDFontType2' : 'CIDFontType0';
    const cidDict = w.add(
      `<< /Type /Font /Subtype /${cidType} /BaseFont /${pdfName(baseName)} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [${W.trim()}]${e.kind === 'ttf' ? ' /CIDToGIDMap /Identity' : ''} >>`,
    );
    const toUni = w.addStream('', toUnicodeCMap(used), { compress: true });
    w.set(
      e.ref,
      `<< /Type /Font /Subtype /Type0 /BaseFont /${pdfName(baseName)} /Encoding /Identity-H /DescendantFonts [${cidDict} 0 R] /ToUnicode ${toUni} 0 R >>`,
    );
  }
}

/**
 * Builds a ToUnicode CMap mapping glyph ids (2 byte codes) to the code points that used them.
 * @param {Map<number, number>} used glyph id -> code point
 * @returns {string}
 */
export function toUnicodeCMap(used) {
  const pairs = [...used.entries()].sort((a, b) => a[0] - b[0]);
  let body = '';
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    body += `${chunk.length} beginbfchar\n`;
    for (const [gid, cp] of chunk) body += `<${gid.toString(16).padStart(4, '0')}> <${utf16Hex(cp)}>\n`;
    body += 'endbfchar\n';
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    body +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
  );
}

/** @param {number} cp */
function utf16Hex(cp) {
  if (cp > 0xffff) {
    const c = cp - 0x10000;
    return (0xd800 + (c >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (c & 0x3ff)).toString(16).padStart(4, '0');
  }
  return cp.toString(16).padStart(4, '0');
}

/** @param {string} s */
function sanitizeName(s) {
  const t = s.replace(/[^A-Za-z0-9\-_.]/g, '');
  return t || 'Font';
}

/**
 * Six uppercase letters derived from the font name and glyph set (the subset prefix required by the PDF spec).
 * @param {string} name
 * @param {number[]} gids
 * @returns {string}
 */
function subsetTag(name, gids) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  for (const g of gids) h = Math.imul(h ^ g, 16777619);
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h >>> 0) % 26);
    h = Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9;
  }
  return tag;
}

/** @param {Uint8Array} t */
function copyBytes(t) {
  const o = new Uint8Array(t.length);
  o.set(t);
  return o;
}

/**
 * Creates a subset of a TrueType (glyf) font that keeps glyph ids: outlines of unused glyphs are removed, composite
 * glyph components are kept, and the glyph table is truncated after the highest used glyph id (together with
 * `maxp`, `hhea`, `hmtx` and `loca`). Tables not needed by a PDF CID font (cmap, name, OS/2, post, GPOS, ...) are
 * dropped.
 *
 * @param {import('../layout/sfnt.js').FontInfo} info
 * @param {Iterable<number>} gids glyph ids in use
 * @returns {Uint8Array|null} the subset font, or `null` if the font could not be subset (embed it whole instead)
 */
export function subsetTrueType(info, gids) {
  try {
    const head = info.getTable('head');
    const maxp = info.getTable('maxp');
    const hhea = info.getTable('hhea');
    const hmtx = info.getTable('hmtx');
    const loca = info.getTable('loca');
    const glyf = info.getTable('glyf');
    if (!head || !maxp || !hhea || !hmtx || !loca || !glyf) return null;
    const oldN = info.numGlyphs;
    const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const locaFmt = hv.getInt16(50);
    const lv = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
    if ((oldN + 1) * (locaFmt === 0 ? 2 : 4) > loca.length) return null;
    const off = (g) => (locaFmt === 0 ? lv.getUint16(g * 2) * 2 : lv.getUint32(g * 4));
    const gv = new DataView(glyf.buffer, glyf.byteOffset, glyf.byteLength);
    const set = new Set(gids);
    set.add(0);
    const queue = [...set];
    while (queue.length) {
      const g = /** @type {number} */ (queue.pop());
      if (g >= oldN) return null;
      const a = off(g);
      const b = off(g + 1);
      if (b <= a) continue;
      if (b > glyf.length || a + 10 > glyf.length) return null;
      if (gv.getInt16(a) < 0) {
        let p = a + 10;
        for (;;) {
          if (p + 4 > b) return null;
          const flags = gv.getUint16(p);
          const gi = gv.getUint16(p + 2);
          p += 4 + (flags & 1 ? 4 : 2);
          if (flags & 8) p += 2;
          else if (flags & 0x40) p += 4;
          else if (flags & 0x80) p += 8;
          if (gi >= oldN) return null;
          if (!set.has(gi)) {
            set.add(gi);
            queue.push(gi);
          }
          if (!(flags & 0x20)) break;
        }
      }
    }
    let maxGid = 0;
    for (const g of set) if (g > maxGid) maxGid = g;
    const newN = maxGid + 1;
    // glyf + loca (long format)
    const chunks = [];
    const newLoca = new Uint8Array((newN + 1) * 4);
    const nlv = new DataView(newLoca.buffer);
    let pos = 0;
    for (let g = 0; g < newN; g++) {
      nlv.setUint32(g * 4, pos);
      if (!set.has(g)) continue;
      const a = off(g);
      const b = off(g + 1);
      const len = b - a;
      if (len <= 0) continue;
      const pad = (4 - (len & 3)) & 3;
      const c = new Uint8Array(len + pad);
      c.set(glyf.subarray(a, b));
      chunks.push(c);
      pos += c.length;
    }
    nlv.setUint32(newN * 4, pos);
    const newGlyf = new Uint8Array(pos);
    let o = 0;
    for (const c of chunks) {
      newGlyf.set(c, o);
      o += c.length;
    }
    // head / maxp / hhea
    const nhead = copyBytes(head);
    const nhv = new DataView(nhead.buffer);
    nhv.setInt16(50, 1);
    nhv.setUint32(8, 0);
    const nmaxp = copyBytes(maxp);
    new DataView(nmaxp.buffer).setUint16(4, newN);
    const nhhea = copyBytes(hhea);
    const oldNH = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34);
    const nh = Math.min(oldNH, newN);
    new DataView(nhhea.buffer).setUint16(34, nh);
    // hmtx
    const newHmtx = new Uint8Array(nh * 4 + (newN - nh) * 2);
    newHmtx.set(hmtx.subarray(0, nh * 4));
    if (newN > nh) {
      for (let g = nh; g < newN; g++) {
        const so = oldNH * 4 + (g - oldNH) * 2;
        if (so + 2 <= hmtx.length) newHmtx.set(hmtx.subarray(so, so + 2), nh * 4 + (g - nh) * 2);
      }
    }
    /** @type {Map<string, Uint8Array>} */
    const tables = new Map([
      ['head', nhead],
      ['hhea', nhhea],
      ['maxp', nmaxp],
      ['hmtx', newHmtx],
      ['loca', newLoca],
      ['glyf', newGlyf],
    ]);
    for (const t of ['cvt ', 'fpgm', 'prep']) {
      const tb = info.getTable(t);
      if (tb) tables.set(t, tb);
    }
    return buildSfnt(0x00010000, tables);
  } catch (_) {
    return null;
  }
}

