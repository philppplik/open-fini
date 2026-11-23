// Truevision TGA reader (public format: 18-byte header, optional image ID and color map, raw or RLE pixel data).
//
// Public API:  readTga(bytes) -> { width, height, rgba, warnings }   isTgaName(name)
// Supports:    true-color (2, 10), grayscale (3, 11) and color-mapped (1, 9) images; 8, 15, 16, 24 and 32 bit pixels;
//              bottom-up and top-down origins. Pure, no DOM; every read is bounds checked and sizes are limited.

const MAX_SIDE = 16384;

export const isTgaName = (name) => /\.(tga|icb|vda|vst|tpic)$/i.test(String(name || ""));

/** @param {Uint8Array} b */
export function readTga(b) {
  if (!b || b.length < 18) throw new Error("This is not a TGA file.");
  const idLen = b[0];
  const mapType = b[1];
  const type = b[2];
  const mapFirst = b[3] | (b[4] << 8);
  const mapLen = b[5] | (b[6] << 8);
  const mapDepth = b[7];
  const width = b[12] | (b[13] << 8);
  const height = b[14] | (b[15] << 8);
  const depth = b[16];
  const desc = b[17];
  const warnings = [];
  if (![1, 2, 3, 9, 10, 11].includes(type)) throw new Error(type === 0 ? "This TGA file contains no image." : `TGA image type ${type} is not supported.`);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) throw new Error("The TGA image size is invalid.");
  const mapped = type === 1 || type === 9;
  const gray = type === 3 || type === 11;
  const rle = type >= 9;
  if (mapped ? ![8, 16].includes(depth) : gray ? depth !== 8 && depth !== 16 : ![15, 16, 24, 32].includes(depth)) throw new Error(`TGA images with ${depth} bits per pixel are not supported.`);
  let at = 18 + idLen;
  // color map: entries of mapDepth bits, stored as BGR(A)
  let palette = null;
  if (mapType === 1) {
    const eb = Math.ceil(mapDepth / 8);
    if (at + mapLen * eb > b.length) throw new Error("The TGA color map is truncated.");
    palette = new Uint8Array((mapFirst + mapLen) * 4);
    for (let i = 0; i < mapLen; i++) readColor(b, at + i * eb, mapDepth, palette, (mapFirst + i) * 4);
    at += mapLen * eb;
  } else if (mapped) throw new Error("The color-mapped TGA file has no color map.");
  const alphaBits = desc & 0x0f;
  const bpp = Math.ceil(depth / 8);
  const n = width * height;
  const px = new Uint8Array(n * bpp); // raw pixel bytes after RLE decoding
  if (rle) {
    let o = 0;
    while (o < px.length) {
      if (at >= b.length) {
        warnings.push("The TGA pixel data ends early; the rest of the image is transparent.");
        break;
      }
      const head = b[at++];
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {
        if (at + bpp > b.length) break;
        for (let k = 0; k < count && o < px.length; k++, o += bpp) px.set(b.subarray(at, at + bpp), o);
        at += bpp;
      } else {
        const len = Math.min(count * bpp, px.length - o, b.length - at);
        px.set(b.subarray(at, at + len), o);
        at += count * bpp;
        o += len;
      }
    }
  } else {
    const len = Math.min(px.length, b.length - at);
    if (len < px.length) warnings.push("The TGA pixel data ends early; the rest of the image is transparent.");
    px.set(b.subarray(at, at + len));
  }
  const rgba = new Uint8ClampedArray(n * 4);
  const topDown = (desc & 0x20) !== 0;
  const rightToLeft = (desc & 0x10) !== 0;
  const tmp = new Uint8Array(4);
  let sawAlpha = false;
  for (let y = 0; y < height; y++) {
    const dy = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const dx = rightToLeft ? width - 1 - x : x;
      const s = (y * width + x) * bpp;
      const d = (dy * width + dx) * 4;
      if (mapped) {
        const idx = depth === 16 ? px[s] | (px[s + 1] << 8) : px[s];
        if (palette && idx * 4 + 3 < palette.length) rgba.set(palette.subarray(idx * 4, idx * 4 + 4), d);
      } else if (gray) {
        rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s];
        rgba[d + 3] = depth === 16 ? px[s + 1] : 255;
      } else {
        readColor(px, s, depth, tmp, 0);
        rgba[d] = tmp[0];
        rgba[d + 1] = tmp[1];
        rgba[d + 2] = tmp[2];
        rgba[d + 3] = depth === 32 && alphaBits ? tmp[3] : depth === 16 && alphaBits ? tmp[3] : 255;
        if (rgba[d + 3]) sawAlpha = true;
      }
    }
  }
  // many writers set 32-bit pixels with alpha 0 everywhere: such files are opaque
  if (!mapped && !gray && depth === 32 && alphaBits && !sawAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width, height, rgba, warnings };
}

/** Reads one BGR(A) / 15-16 bit color into out[o..o+3] as RGBA. */
function readColor(b, at, depth, out, o) {
  if (depth === 15 || depth === 16) {
    const v = b[at] | (b[at + 1] << 8);
    out[o] = (((v >> 10) & 31) * 255) / 31;
    out[o + 1] = (((v >> 5) & 31) * 255) / 31;
    out[o + 2] = ((v & 31) * 255) / 31;
    out[o + 3] = depth === 16 && !(v & 0x8000) ? 0 : 255;
  } else {
    out[o] = b[at + 2];
    out[o + 1] = b[at + 1];
    out[o + 2] = b[at];
    out[o + 3] = depth === 32 ? b[at + 3] : 255;
  }
}
