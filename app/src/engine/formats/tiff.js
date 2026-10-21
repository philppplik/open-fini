// TIFF 6.0 reader (clean-room, from the public Adobe TIFF 6.0 specification; no library code).
//
// Public API:  readTiff(bytes, { maxPixels = 150e6, maxPages = 64 }) -> { pages: [{ width, height, rgba, name }], warnings }
//              isTiff(bytes)
// Supported:   little and big endian, multiple pages (IFD chain), strips and tiles, planar configuration 1,
//              compression none / LZW / PackBits / Deflate (8 and 32946), horizontal predictor 2,
//              1/2/4/8/16-bit gray and palette, 8/16-bit RGB, CMYK (naive formula, no ICC), alpha (extra samples).
// Not supported (clear error): BigTIFF, JPEG-in-TIFF, CCITT fax, planar configuration 2, YCbCr, CIE Lab.
// Invariants:  pure, no DOM; every offset and length is bounds checked; output size is capped by maxPixels (summed
//              over all pages); the decoders never write past the expected byte count.
import { unzlibSync } from '../../../vendor/fflate/fflate.js';

export function isTiff(b) {
  return !!b && b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a));
}

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/** Decodes PackBits (TIFF compression 32773) into exactly `expected` bytes at most. */
export function packBitsDecode(src, expected) {
  const out = new Uint8Array(expected);
  let i = 0;
  let o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) {
      const c = Math.min(n + 1, src.length - i, expected - o);
      out.set(src.subarray(i, i + c), o);
      i += n + 1;
      o += c;
    } else if (n !== -128) {
      const c = Math.min(1 - n, expected - o);
      out.fill(src[i++], o, o + c);
      o += c;
    }
  }
  return out;
}

/** Decodes TIFF LZW (MSB first, "early change") into at most `expected` bytes. */
export function lzwDecode(src, expected) {
  const out = new Uint8Array(expected);
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let next = 258;
  let bits = 9;
  let prev = -1;
  let buf = 0;
  let cnt = 0;
  let sp = 0;
  let o = 0;
  const emit = (code) => {
    const L = length[code];
    const n = Math.min(L, expected - o);
    // the string is stored back to front through the prefix chain
    let c = code;
    for (let k = L - 1; k >= 0; k--) {
      if (k < n) out[o + k] = suffix[c];
      c = prefix[c];
    }
    o += n;
  };
  while (o < expected) {
    while (cnt < bits && sp < src.length) {
      buf = ((buf << 8) | src[sp++]) >>> 0;
      cnt += 8;
      if (cnt > 24) break;
    }
    if (cnt < bits) break;
    const code = (buf >>> (cnt - bits)) & ((1 << bits) - 1);
    cnt -= bits;
    buf &= (1 << cnt) - 1;
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      bits = 9;
      prev = -1;
      continue;
    }
    if (prev === -1) {
      if (code > 255) break;
      out[o++] = code;
      prev = code;
      continue;
    }
    let f;
    if (code < next) f = first[code];
    else if (code === next) f = first[prev];
    else break;
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = f;
      first[next] = first[prev];
      length[next] = length[prev] + 1;
      next++;
    }
    emit(code);
    prev = code;
    bits = next >= 2047 ? 12 : next >= 1023 ? 11 : next >= 511 ? 10 : 9;
  }
  return out;
}

class Rd {
  constructor(b, le) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.le = le;
  }
  u16(o) {
    if (o < 0 || o + 2 > this.b.length) throw new Error('The TIFF file is truncated or damaged.');
    return this.dv.getUint16(o, this.le);
  }
  u32(o) {
    if (o < 0 || o + 4 > this.b.length) throw new Error('The TIFF file is truncated or damaged.');
    return this.dv.getUint32(o, this.le);
  }
}

function readIfd(r, at) {
  const n = r.u16(at);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    const tag = r.u16(e);
    const type = r.u16(e + 2);
    const count = r.u32(e + 4);
    const size = TYPE_SIZE[type];
    if (!size || count > 1e7) continue;
    const bytes = size * count;
    const dataAt = bytes <= 4 ? e + 8 : r.u32(e + 8);
    if (dataAt + bytes > r.b.length) continue;
    const vals = [];
    const take = Math.min(count, 1e6);
    for (let k = 0; k < take; k++) {
      if (type === 3) vals.push(r.u16(dataAt + k * 2));
      else if (type === 4 || type === 13) vals.push(r.u32(dataAt + k * 4));
      else if (type === 1 || type === 2 || type === 6 || type === 7) vals.push(r.b[dataAt + k]);
      else if (type === 8) vals.push((r.u16(dataAt + k * 2) << 16) >> 16);
      else vals.push(0);
    }
    tags.set(tag, vals);
  }
  return { tags, next: r.u32(at + 2 + n * 12) };
}

function decompress(comp, src, expected, predictor, rowBytes, bytesPerSample, spp, le) {
  let out;
  if (comp === 1) {
    out = new Uint8Array(expected);
    out.set(src.subarray(0, expected));
  } else if (comp === 5) out = lzwDecode(src, expected);
  else if (comp === 32773) out = packBitsDecode(src, expected);
  else if (comp === 8 || comp === 32946) {
    let raw;
    try {
      raw = unzlibSync(src, { out: new Uint8Array(expected) });
    } catch {
      raw = new Uint8Array(expected);
    }
    out = raw.length === expected ? raw : raw.subarray(0, expected);
    if (out.length < expected) {
      const full = new Uint8Array(expected);
      full.set(out);
      out = full;
    }
  } else throw new Error(`This TIFF uses compression type ${comp}, which OpenFini cannot read (supported: none, LZW, PackBits, Deflate).`);
  if (predictor === 2 && rowBytes > 0) {
    const rows = Math.floor(expected / rowBytes);
    for (let y = 0; y < rows; y++) {
      const base = y * rowBytes;
      if (bytesPerSample === 1) {
        for (let x = spp; x < rowBytes; x++) out[base + x] = (out[base + x] + out[base + x - spp]) & 255;
      } else if (bytesPerSample === 2) {
        const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
        for (let x = spp; x < rowBytes / 2; x++) dv.setUint16(base + x * 2, (dv.getUint16(base + x * 2, le) + dv.getUint16(base + (x - spp) * 2, le)) & 0xffff, le);
      }
    }
  }
  return out;
}

function decodePage(r, tags, budget, warnings) {
  const one = (t, d) => (tags.get(t) ? tags.get(t)[0] : d);
  const width = one(256, 0);
  const height = one(257, 0);
  if (!width || !height) throw new Error('A TIFF page has no size.');
  if (width * height > budget.left) throw new Error(`The TIFF image is too large (${width} × ${height} pixels; the limit for this import is ${Math.round(budget.max / 1e6)} megapixels).`);
  budget.left -= width * height;
  const spp = one(277, 1);
  const bpsList = tags.get(258) || [1];
  const bps = bpsList[0];
  if (!bpsList.every((v) => v === bps)) throw new Error('This TIFF mixes different bit depths per channel, which is not supported.');
  if (![1, 2, 4, 8, 16].includes(bps)) throw new Error(`This TIFF uses ${bps} bits per sample, which is not supported (supported: 1, 2, 4, 8, 16).`);
  const comp = one(259, 1);
  const photo = one(262, 1);
  const planar = one(284, 1);
  const predictor = one(317, 1);
  const fmt = one(339, 1);
  if (planar !== 1) throw new Error('This TIFF stores its channels in separate planes (PlanarConfiguration 2), which is not supported.');
  if (fmt === 3) throw new Error('Floating point TIFF images are not supported.');
  if (![0, 1, 2, 3, 5].includes(photo)) throw new Error(`This TIFF uses photometric interpretation ${photo} (YCbCr, Lab or transparency mask), which is not supported.`);
  if (comp === 7 || comp === 6) throw new Error('JPEG compressed TIFF images are not supported. Re-save the file with LZW or ZIP compression.');
  if (bps > 8 && photo === 3) throw new Error('Palette TIFF images must use at most 8 bits.');
  const baseSamples = photo === 2 ? 3 : photo === 5 ? 4 : 1;
  if (spp < baseSamples) throw new Error('This TIFF declares fewer samples per pixel than its color model needs.');
  if (bps < 8 && spp !== 1) throw new Error('Multi-channel TIFF images below 8 bits per sample are not supported.');
  const extra = tags.get(338) || [];
  const extraCount = spp - baseSamples;
  const hasAlpha = extraCount > 0 && (extra[0] === 1 || extra[0] === 2);
  const premult = hasAlpha && extra[0] === 1;
  if (extraCount > 0 && !hasAlpha) warnings.push('Unassociated extra channels in the TIFF were ignored.');
  const cmap = tags.get(320);
  if (photo === 3 && (!cmap || cmap.length < 3 * (1 << bps))) throw new Error('This palette TIFF has no (or an incomplete) color map.');

  const tiled = tags.has(322);
  const offsets = tiled ? tags.get(324) : tags.get(273);
  const counts = tiled ? tags.get(325) : tags.get(279);
  if (!offsets || !offsets.length) throw new Error('This TIFF has no image data.');
  const tw = tiled ? one(322, 0) : width;
  const th = tiled ? one(323, 0) : Math.min(one(278, height) || height, height);
  if (!tw || !th) throw new Error('This TIFF has invalid tile or strip sizes.');
  const across = Math.ceil(width / tw);
  const down = Math.ceil(height / th);
  const bytesPerSample = bps === 16 ? 2 : 1;
  const rowBytes = Math.ceil((tw * spp * bps) / 8);
  const expected = rowBytes * th;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const le = r.le;
  const ps = [0, 0, 0, 0];
  const maxv = (1 << Math.min(bps, 8)) - 1;
  const total = across * down;
  for (let ci = 0; ci < total && ci < offsets.length; ci++) {
    const off = offsets[ci];
    const len = counts ? counts[ci] ?? 0 : r.b.length - off;
    if (off + len > r.b.length || off < 0) throw new Error('The TIFF file is truncated or damaged.');
    const src = r.b.subarray(off, off + len);
    const data = decompress(comp, src, expected, predictor, rowBytes, bytesPerSample, spp, le);
    const x0 = (ci % across) * tw;
    const y0 = Math.floor(ci / across) * th;
    const rows = Math.min(th, height - y0);
    const cols = Math.min(tw, width - x0);
    for (let y = 0; y < rows; y++) {
      const rowStart = y * rowBytes;
      let dst = ((y0 + y) * width + x0) * 4;
      for (let x = 0; x < cols; x++, dst += 4) {
        if (spp === 1 && bps < 8) {
          const bitPos = x * bps;
          const v = (data[rowStart + (bitPos >> 3)] >> (8 - bps - (bitPos & 7))) & maxv;
          if (photo === 3) {
            const n = 1 << bps;
            rgba[dst] = cmap[v] >> 8;
            rgba[dst + 1] = cmap[n + v] >> 8;
            rgba[dst + 2] = cmap[2 * n + v] >> 8;
          } else {
            const g = Math.round(((photo === 0 ? maxv - v : v) * 255) / maxv);
            rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = g;
          }
          rgba[dst + 3] = 255;
          continue;
        }
        const at8 = (k) => (bps === 8 ? data[rowStart + x * spp + k] : data[rowStart + (x * spp + k) * 2 + (le ? 1 : 0)]);
        for (let k = 0; k < baseSamples; k++) ps[k] = at8(k);
        const a = hasAlpha ? at8(baseSamples) : 255;
        if (photo === 2) {
          rgba[dst] = ps[0];
          rgba[dst + 1] = ps[1];
          rgba[dst + 2] = ps[2];
        } else if (photo === 5) {
          const k = 255 - ps[3];
          rgba[dst] = ((255 - ps[0]) * k) / 255;
          rgba[dst + 1] = ((255 - ps[1]) * k) / 255;
          rgba[dst + 2] = ((255 - ps[2]) * k) / 255;
        } else if (photo === 3) {
          const n = 1 << bps;
          const v = ps[0];
          rgba[dst] = cmap[v] >> 8;
          rgba[dst + 1] = cmap[n + v] >> 8;
          rgba[dst + 2] = cmap[2 * n + v] >> 8;
        } else {
          const g = photo === 0 ? 255 - ps[0] : ps[0];
          rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = g;
        }
        if (premult && a > 0 && a < 255) {
          rgba[dst] = (rgba[dst] * 255) / a;
          rgba[dst + 1] = (rgba[dst + 1] * 255) / a;
          rgba[dst + 2] = (rgba[dst + 2] * 255) / a;
        }
        rgba[dst + 3] = a;
      }
    }
  }
  if (photo === 5) warnings.push('CMYK TIFF colors were converted with a simple formula (no ICC profile), so they can look different from the original.');
  if (bps === 16) warnings.push('16-bit TIFF data was reduced to 8 bits per channel.');
  return { width, height, rgba };
}

/**
 * @param {Uint8Array} bytes
 * @param {{ maxPixels?: number, maxPages?: number }} [opts]
 * @returns {{ pages: { width: number, height: number, rgba: Uint8ClampedArray, name: string }[], warnings: string[] }}
 */
export function readTiff(bytes, { maxPixels = 150e6, maxPages = 64 } = {}) {
  if (!isTiff(bytes)) {
    if (bytes && bytes.length > 3 && (bytes[2] === 0x2b || bytes[3] === 0x2b)) throw new Error('BigTIFF files (larger than 4 GB) are not supported.');
    throw new Error('This is not a TIFF file.');
  }
  const r = new Rd(bytes, bytes[0] === 0x49);
  const warnings = [];
  const pages = [];
  const budget = { left: maxPixels, max: maxPixels };
  const seen = new Set();
  let at = r.u32(4);
  while (at && !seen.has(at) && pages.length < maxPages) {
    seen.add(at);
    const { tags, next } = readIfd(r, at);
    const sub = (tags.get(254) || [0])[0];
    if (sub & 1 && pages.length) {
      // reduced resolution versions of the previous page: skip
      at = next;
      continue;
    }
    try {
      const page = decodePage(r, tags, budget, warnings);
      pages.push({ ...page, name: `Page ${pages.length + 1}` });
    } catch (e) {
      if (!pages.length) throw e;
      warnings.push(`Page ${pages.length + 1} was skipped: ${e.message}`);
    }
    at = next;
  }
  if (at && pages.length >= maxPages) warnings.push(`Only the first ${maxPages} pages were read.`);
  if (!pages.length) throw new Error('This TIFF file contains no readable image.');
  return { pages, warnings: [...new Set(warnings)] };
}
