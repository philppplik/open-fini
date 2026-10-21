// Font container helpers: WOFF 1.0 -> plain sfnt (TTF/OTF), TrueType Collections (.ttc/.otc) -> standalone fonts, and
// WOFF2 detection. Public formats (W3C WOFF 1.0, OpenType spec); no font data is interpreted beyond the table directory.
//
// Public API (pure, no DOM):
//   fontContainer(bytes) -> 'sfnt' | 'woff' | 'woff2' | 'ttc' | 'unknown'
//   woffToSfnt(bytes) -> Uint8Array
//   ttcFonts(bytes) -> Uint8Array[]          standalone sfnt files, one per collection member (max 64)
//   unwrapFont(bytes) -> { container, fonts: Uint8Array[], note? }   what the Type panel registers
// WOFF2 is Brotli compressed with a glyph transform and is not decoded here: browsers load it natively, so it is passed
// through unchanged (the PDF exporter can only embed fonts that are plain sfnt, see docs/file-compat.md).
// Invariants: table counts, offsets and sizes are bounds checked; decompressed table sizes must match the directory.
import { unzlibSync } from '../../../vendor/fflate/fflate.js';

const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const MAX_FONT = 64 * 1024 * 1024;

export function fontContainer(b) {
  if (!b || b.length < 12) return 'unknown';
  const t = tag(b, 0);
  if (t === 'wOFF') return 'woff';
  if (t === 'wOF2') return 'woff2';
  if (t === 'ttcf') return 'ttc';
  if (t === 'true' || t === 'OTTO' || t === 'typ1' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'sfnt';
  return 'unknown';
}

const pad4 = (n) => (n + 3) & ~3;

function buildSfnt(flavor, tables) {
  const n = tables.length;
  let off = 12 + n * 16;
  for (const t of tables) off += pad4(t.data.length);
  if (off > MAX_FONT) throw new Error('The font is too large.');
  const out = new Uint8Array(off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log++;
  }
  dv.setUint16(6, pow * 16);
  dv.setUint16(8, log);
  dv.setUint16(10, n * 16 - pow * 16);
  let p = 12 + n * 16;
  tables.forEach((t, i) => {
    const e = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[e + k] = t.tag.charCodeAt(k);
    dv.setUint32(e + 4, t.checksum >>> 0);
    dv.setUint32(e + 8, p);
    dv.setUint32(e + 12, t.data.length);
    out.set(t.data, p);
    p += pad4(t.data.length);
  });
  return out;
}

function checksum(data) {
  let sum = 0;
  const n = pad4(data.length);
  for (let i = 0; i < n; i += 4) sum = (sum + (((data[i] << 24) | ((data[i + 1] || 0) << 16) | ((data[i + 2] || 0) << 8) | (data[i + 3] || 0)) >>> 0)) >>> 0;
  return sum;
}

export function woffToSfnt(b) {
  if (fontContainer(b) !== 'woff' || b.length < 44) throw new Error('This is not a WOFF font.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = dv.getUint32(4);
  const n = dv.getUint16(12);
  if (!n || n > 512 || 44 + n * 20 > b.length) throw new Error('The WOFF font table directory is damaged.');
  const tables = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const off = dv.getUint32(e + 4);
    const comp = dv.getUint32(e + 8);
    const orig = dv.getUint32(e + 12);
    if (off + comp > b.length || orig > MAX_FONT) throw new Error('The WOFF font is truncated or damaged.');
    total += orig;
    if (total > MAX_FONT) throw new Error('The font is too large.');
    const src = b.subarray(off, off + comp);
    let data;
    if (comp === orig) data = src.slice();
    else {
      try {
        data = unzlibSync(src, { out: new Uint8Array(orig) });
      } catch {
        throw new Error('A table of the WOFF font could not be decompressed.');
      }
      if (data.length !== orig) throw new Error('A table of the WOFF font has the wrong size.');
    }
    tables.push({ tag: tag(b, e), checksum: dv.getUint32(e + 8 + 8), data, orig: dv.getUint32(e + 16) });
  }
  tables.forEach((t) => (t.checksum = checksum(t.data)));
  tables.sort((a, c) => (a.tag < c.tag ? -1 : 1));
  return buildSfnt(flavor, tables);
}

export function ttcFonts(b) {
  if (fontContainer(b) !== 'ttc') throw new Error('This is not a font collection.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = Math.min(dv.getUint32(8), 64);
  const fonts = [];
  for (let i = 0; i < count; i++) {
    if (12 + i * 4 + 4 > b.length) break;
    const at = dv.getUint32(12 + i * 4);
    if (at + 12 > b.length) continue;
    const n = dv.getUint16(at + 4);
    if (!n || n > 512 || at + 12 + n * 16 > b.length) continue;
    const tables = [];
    let ok = true;
    for (let k = 0; k < n; k++) {
      const e = at + 12 + k * 16;
      const off = dv.getUint32(e + 8);
      const len = dv.getUint32(e + 12);
      if (off + len > b.length || len > MAX_FONT) {
        ok = false;
        break;
      }
      tables.push({ tag: tag(b, e), checksum: dv.getUint32(e + 4), data: b.slice(off, off + len) });
    }
    if (ok) fonts.push(buildSfnt(dv.getUint32(at), tables));
  }
  if (!fonts.length) throw new Error('This font collection has no readable fonts.');
  return fonts;
}

export function unwrapFont(bytes) {
  const container = fontContainer(bytes);
  if (container === 'woff') return { container, fonts: [woffToSfnt(bytes)] };
  if (container === 'ttc') {
    const fonts = ttcFonts(bytes);
    return { container, fonts, note: fonts.length > 1 ? `The collection holds ${fonts.length} fonts; the first one was added.` : undefined };
  }
  if (container === 'woff2') return { container, fonts: [bytes], note: 'WOFF2 fonts work on screen; PDF export falls back to a standard font for them. Use a TTF or OTF file when you need the font embedded in PDFs.' };
  if (container === 'sfnt') return { container, fonts: [bytes] };
  throw new Error('This is not a TrueType, OpenType, WOFF or WOFF2 font.');
}
