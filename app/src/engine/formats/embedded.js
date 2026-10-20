// Helpers for files that wrap or embed standard formats (no proprietary parsing):
//  - findPdfStart: the "%PDF-" header inside an Illustrator (.ai) or EPS file (PDF-compatible files)
//  - findEmbeddedPreview: scans a binary file for plain PNG / JPEG images using only their public signatures
//    (used for Affinity files, whose container format is not documented). It reads nothing but standard image streams.

/** Offset of a PDF header within the first `limit` bytes, or -1. */
export function findPdfStart(bytes, limit = 4 * 1024 * 1024) {
  const end = Math.min(bytes.length - 5, limit);
  for (let i = 0; i <= end; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return i;
  }
  return -1;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
let CRC = null;
function crc32(b, from, to) {
  CRC ??= crcTable();
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Walks the chunks of a PNG at `at`; returns { end, width, height } for a structurally valid PNG (CRC checked). */
function readPng(b, at) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = at + 8;
  let width = 0;
  let height = 0;
  let idat = 0;
  for (let guard = 0; guard < 100000; guard++) {
    if (p + 12 > b.length) return null;
    const len = dv.getUint32(p);
    if (len > 0x7fffffff || p + 12 + len > b.length) return null;
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (crc32(b, p + 4, p + 8 + len) !== dv.getUint32(p + 8 + len)) return null;
    if (type === 'IHDR') {
      if (len !== 13) return null;
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
    } else if (type === 'IDAT') idat++;
    p += 12 + len;
    if (type === 'IEND') return width > 0 && height > 0 && idat > 0 ? { end: p, width, height } : null;
  }
  return null;
}

/** Walks the segments of a JPEG at `at`; returns { end, width, height } or null. */
function readJpeg(b, at) {
  let p = at + 2;
  let width = 0;
  let height = 0;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const m = b[p + 1];
    if (m === 0xff) {
      p++;
      continue;
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      p += 2;
      continue;
    }
    if (m === 0xd9) return width ? { end: p + 2, width, height } : null;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2 || p + 2 + len > b.length) return null;
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      height = (b[p + 5] << 8) | b[p + 6];
      width = (b[p + 7] << 8) | b[p + 8];
    }
    if (m === 0xda) {
      // entropy coded data: ends at the first marker that is not a restart marker or a stuffed 0xFF
      p += 2 + len;
      while (p + 1 < b.length) {
        if (b[p] === 0xff && b[p + 1] !== 0 && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7) && b[p + 1] !== 0xff) break;
        p++;
      }
      continue;
    }
    p += 2 + len;
  }
  return null;
}

/**
 * Finds the largest complete PNG or JPEG image stored as plain bytes inside `bytes`.
 * @param {Uint8Array} bytes
 * @param {{minSide?: number, maxScanBytes?: number}} [opt]
 * @returns {{mime: string, bytes: Uint8Array, width: number, height: number, offset: number} | null}
 */
export function findEmbeddedPreview(bytes, { minSide = 48, maxScanBytes = 512 * 1024 * 1024 } = {}) {
  let best = null;
  const n = Math.min(bytes.length, maxScanBytes);
  for (let i = 0; i < n - 12; i++) {
    const c = bytes[i];
    let found = null;
    let mime = '';
    if (c === 0x89 && PNG_SIG.every((v, k) => bytes[i + k] === v)) {
      found = readPng(bytes, i);
      mime = 'image/png';
    } else if (c === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      found = readJpeg(bytes, i);
      mime = 'image/jpeg';
    }
    if (found && Math.min(found.width, found.height) >= minSide) {
      if (!best || found.width * found.height > best.width * best.height) best = { mime, bytes: bytes.slice(i, found.end), width: found.width, height: found.height, offset: i };
      i = found.end - 1;
    }
  }
  return best;
}
