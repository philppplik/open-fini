// Windows ICO / CUR reader (public format: ICONDIR + ICONDIRENTRY, entries are PNG streams or BMP DIBs).
//
// Public API:  readIco(bytes) -> { cursor, images: [{ width, height, bpp, png?, rgba? }], warnings }
//              Entries stored as PNG are returned as `png` bytes (the host decodes them); BMP entries are decoded here
//              to `rgba` (1, 4, 8, 24 and 32 bit with the AND mask).
//              isIco(bytes)
// Invariants:  pure, no DOM; entry offsets and sizes are bounds checked; at most 256 entries.

export function isIco(b) {
  return !!b && b.length >= 22 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0 && b[4] > 0;
}

function decodeDib(b, at, len) {
  const dv = new DataView(b.buffer, b.byteOffset + at, len);
  const hdr = dv.getUint32(0, true);
  if (hdr < 40 || hdr > len) throw new Error('bad DIB header');
  const w = dv.getInt32(4, true);
  const hh = dv.getInt32(8, true); // height includes the AND mask: twice the image height
  const bpp = dv.getUint16(14, true);
  const comp = dv.getUint32(16, true);
  let used = dv.getUint32(32, true);
  const h = Math.abs(hh) >> 1;
  if (w <= 0 || w > 1024 || h <= 0 || h > 1024) throw new Error('bad DIB size');
  if (comp !== 0 && comp !== 3) throw new Error('compressed DIB');
  if (![1, 4, 8, 24, 32].includes(bpp)) throw new Error('unsupported depth');
  if (bpp <= 8 && !used) used = 1 << bpp;
  const palAt = hdr;
  const pixAt = hdr + (bpp <= 8 ? used * 4 : 0);
  const stride = (((w * bpp + 31) >> 5) << 2);
  const maskStride = (((w + 31) >> 5) << 2);
  if (pixAt + stride * h > len) throw new Error('truncated DIB');
  const rgba = new Uint8ClampedArray(w * h * 4);
  const maskAt = pixAt + stride * h;
  const hasMask = maskAt + maskStride * h <= len;
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y; // DIB rows are bottom-up
    const row = pixAt + sy * stride;
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      let r;
      let g;
      let bl;
      let a = 255;
      if (bpp === 32) {
        bl = dv.getUint8(row + x * 4);
        g = dv.getUint8(row + x * 4 + 1);
        r = dv.getUint8(row + x * 4 + 2);
        a = dv.getUint8(row + x * 4 + 3);
        if (a) anyAlpha = true;
      } else if (bpp === 24) {
        bl = dv.getUint8(row + x * 3);
        g = dv.getUint8(row + x * 3 + 1);
        r = dv.getUint8(row + x * 3 + 2);
      } else {
        const bit = x * bpp;
        const v = (dv.getUint8(row + (bit >> 3)) >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const pa = palAt + v * 4;
        bl = pa + 3 <= len ? dv.getUint8(pa) : 0;
        g = pa + 3 <= len ? dv.getUint8(pa + 1) : 0;
        r = pa + 3 <= len ? dv.getUint8(pa + 2) : 0;
      }
      if (hasMask && bpp !== 32 && (dv.getUint8(maskAt + sy * maskStride + (x >> 3)) >> (7 - (x & 7))) & 1) a = 0;
      rgba[d] = r;
      rgba[d + 1] = g;
      rgba[d + 2] = bl;
      rgba[d + 3] = a;
    }
  }
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; // 32-bit without alpha data
  return { width: w, height: h, bpp, rgba };
}

/** @param {Uint8Array} b */
export function readIco(b) {
  if (!isIco(b)) throw new Error('This is not an ICO or CUR file.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const cursor = dv.getUint16(2, true) === 2;
  const n = Math.min(dv.getUint16(4, true), 256);
  const images = [];
  const warnings = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + i * 16;
    if (e + 16 > b.length) {
      warnings.push('The icon directory is truncated.');
      break;
    }
    const size = dv.getUint32(e + 8, true);
    const off = dv.getUint32(e + 12, true);
    if (off + size > b.length || size < 8) {
      warnings.push(`Icon image ${i + 1} is outside the file and was skipped.`);
      continue;
    }
    const png = b[off] === 0x89 && b[off + 1] === 0x50 && b[off + 2] === 0x4e && b[off + 3] === 0x47;
    const dw = b[e] || 256;
    const dh = b[e + 1] || 256;
    if (png) images.push({ width: dw, height: dh, bpp: dv.getUint16(e + 6, true) || 32, png: b.slice(off, off + size) });
    else {
      try {
        images.push(decodeDib(b, off, size));
      } catch (err) {
        warnings.push(`Icon image ${i + 1} could not be decoded (${err.message}).`);
      }
    }
  }
  if (!images.length) throw new Error('This icon file contains no readable image.');
  images.sort((a, c) => c.width * c.height - a.width * a.height);
  return { cursor, images, warnings };
}
