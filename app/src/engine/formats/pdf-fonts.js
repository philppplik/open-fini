// Font handling for PDF import (pure): name cleanup, substitution by family class, and rebuilding the character map
// of an extracted font program so it maps Unicode (the text the user edits) to the glyphs of the PDF's subset.
import { parseFont, buildSfnt } from '../layout/sfnt.js';

const KNOWN = [
  [/^(arial|helvetica|arimo|liberationsans|nimbussans)/i, 'Helvetica'],
  [/^(times|timesnewroman|liberationserif|nimbusroman|tinos)/i, 'Times New Roman'],
  [/^(courier|couriernew|liberationmono|nimbusmono|cousine)/i, 'Courier New'],
  [/^(calibri|carlito)/i, 'Calibri'],
  [/^(cambria|caladea)/i, 'Cambria'],
  [/^georgia/i, 'Georgia'],
  [/^verdana/i, 'Verdana'],
  [/^tahoma/i, 'Tahoma'],
  [/^trebuchet/i, 'Trebuchet MS'],
  [/^segoeui/i, 'Segoe UI'],
  [/^(garamond|eb ?garamond)/i, 'Garamond'],
  [/^(palatino|bookantiqua)/i, 'Palatino Linotype'],
  [/^(consolas)/i, 'Consolas'],
  [/^(inter)(?![a-z])/i, 'Inter'],
  [/^(futura)/i, 'Futura'],
  [/^(gillsans)/i, 'Gill Sans'],
  [/^(symbol|zapfdingbats)/i, 'Helvetica'],
];

/** `ABCDEF+Arial-BoldMT` -> `Arial-BoldMT` */
export const stripSubset = (name) => String(name || '').replace(/^[A-Z]{6}\+/, '');

/**
 * Closest OpenFini family for a PDF base font name.
 * @param {string} name PDF BaseFont (with or without subset prefix)
 * @param {{serif?: boolean, mono?: boolean}} [flags]
 * @returns {{family: string, weight: number, style: 'normal'|'italic', known: boolean}}
 */
export function substituteFont(name, flags = {}) {
  const raw = stripSubset(name);
  const compact = raw.replace(/[\s_]/g, '');
  const bold = /(bold|black|heavy|extrabold|ultra)/i.test(compact) || /[-,]Bd\b/.test(raw);
  const semi = /(semibold|demi)/i.test(compact);
  const light = /(light|thin)/i.test(compact);
  const italic = /(italic|oblique|ital\b|[-,]It\b)/i.test(compact);
  const base = compact.replace(/[-,].*$/, '').replace(/(MT|PS|Std|Pro)$/i, '');
  let family = null;
  for (const [re, fam] of KNOWN) if (re.test(base)) {
    family = fam;
    break;
  }
  const known = !!family;
  if (!family) {
    if (flags.mono || /(mono|courier|consol|typewriter|code)/i.test(compact)) family = 'Courier New';
    else if (flags.serif || /(serif|roman|times|garamond|georgia|palatino|bodoni|didot|minion|caslon|baskerville|book)/i.test(compact)) family = 'Times New Roman';
    else family = 'Helvetica';
  }
  return { family, weight: bold ? 700 : semi ? 600 : light ? 300 : 400, style: italic ? 'italic' : 'normal', known };
}

/** Human readable family label of an embedded font: `ABCDEF+Arial-BoldMT` -> `Arial-BoldMT (PDF)` */
export const embeddedFamilyName = (name, serial) => `${stripSubset(name).replace(/[^\w .+-]/g, '') || 'Font'} (PDF ${serial})`;

function cmapTable(map) {
  // map: Map<codepoint, gid>; writes (3,1) format 4 for the BMP and (3,10) format 12 for everything
  const bmp = [...map.entries()].filter(([c]) => c < 0xffff).sort((a, b) => a[0] - b[0]);
  const all = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const hasAstral = all.some(([c]) => c > 0xffff);
  const segCount = bmp.length + 1;
  const f4 = new Uint8Array(16 + segCount * 8);
  const v4 = new DataView(f4.buffer);
  v4.setUint16(0, 4);
  v4.setUint16(2, f4.length);
  v4.setUint16(6, segCount * 2);
  let es = 0;
  while (1 << (es + 1) <= segCount) es++;
  v4.setUint16(8, (1 << es) * 2);
  v4.setUint16(10, es);
  v4.setUint16(12, segCount * 2 - (1 << es) * 2);
  const endO = 14;
  const startO = 16 + segCount * 2;
  const deltaO = startO + segCount * 2;
  const rangeO = deltaO + segCount * 2;
  bmp.forEach(([c, g], i) => {
    v4.setUint16(endO + i * 2, c);
    v4.setUint16(startO + i * 2, c);
    v4.setUint16(deltaO + i * 2, (g - c) & 0xffff);
    v4.setUint16(rangeO + i * 2, 0);
  });
  v4.setUint16(endO + bmp.length * 2, 0xffff);
  v4.setUint16(startO + bmp.length * 2, 0xffff);
  v4.setUint16(deltaO + bmp.length * 2, 1);
  v4.setUint16(rangeO + bmp.length * 2, 0);
  let f12 = null;
  if (hasAstral) {
    f12 = new Uint8Array(16 + all.length * 12);
    const v12 = new DataView(f12.buffer);
    v12.setUint16(0, 12);
    v12.setUint32(4, f12.length);
    v12.setUint32(12, all.length);
    all.forEach(([c, g], i) => {
      v12.setUint32(16 + i * 12, c);
      v12.setUint32(20 + i * 12, c);
      v12.setUint32(24 + i * 12, g);
    });
  }
  const n = f12 ? 2 : 1;
  const head = 4 + n * 8;
  const out = new Uint8Array(head + f4.length + (f12 ? f12.length : 0));
  const v = new DataView(out.buffer);
  v.setUint16(0, 0);
  v.setUint16(2, n);
  v.setUint16(4, 3);
  v.setUint16(6, 1);
  v.setUint32(8, head);
  out.set(f4, head);
  if (f12) {
    v.setUint16(12, 3);
    v.setUint16(14, 10);
    v.setUint32(16, head + f4.length);
    out.set(f12, head + f4.length);
  }
  return out;
}

/**
 * pdf.js hands out repaired font programs whose character map uses private code points ("font chars"). This builds a
 * copy whose cmap also maps the real Unicode characters of the text to the same glyphs.
 * @param {Uint8Array} data font program (sfnt with `glyf` or `CFF `)
 * @param {Map<string, number>} pairs text character -> font char code point (as seen in the operator list)
 * @returns {Uint8Array|null} null when the font cannot be parsed or no glyph could be mapped
 */
export function remapFontCmap(data, pairs) {
  const info = parseFont(data);
  if (!info) return null;
  const map = new Map();
  for (const [ch, fc] of pairs) {
    const gid = info.glyphForCodePoint(fc);
    if (!gid) continue;
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || (cp >= 0xd800 && cp < 0xe000)) continue;
    if (!map.has(cp)) map.set(cp, gid);
    if (!map.has(fc)) map.set(fc, gid);
  }
  if (!map.size) return null;
  const tables = new Map();
  for (const tag of info.tableTags) {
    const t = info.getTable(tag);
    if (t) tables.set(tag, tag === 'cmap' ? cmapTable(map) : t);
  }
  if (!tables.has('cmap')) tables.set('cmap', cmapTable(map));
  return buildSfnt(tables.has('CFF ') ? 0x4f54544f : 0x00010000, tables);
}
