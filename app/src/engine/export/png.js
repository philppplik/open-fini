// PNG encoder for export (clean-room, from the W3C PNG specification). Pure, no DOM.
//
// Public API:
//   encodePng({ width, height, data }, options) -> Uint8Array
//     data     RGBA, 8 bits per channel, not premultiplied (what getImageData returns)
//     options  color      "rgba" | "rgb" | "gray" | "graya" | "indexed"   (default "rgba")
//              colors     palette size for "indexed", 2..256 (default 256); bit depth 1/2/4/8 follows the palette size
//              dither     Floyd-Steinberg dithering for "indexed"
//              interlace  Adam7 interlacing (progressive display while loading)
//              level      zlib level 0..9 (default 6)
//              ppi        written as pHYs (pixels per meter); omitted when not given
//              icc        { name, bytes } ICC profile written as iCCP (RGB modes only: an RGB profile is invalid in gray PNGs)
//              text       { Title, Author, Copyright, Description, Software, "Creation Time", ... } written as iTXt (UTF-8)
// Invariants: rows are filtered adaptively for truecolor/gray (minimum sum of absolute differences) and with filter 0
//             for indexed and sub-byte depths, as the specification recommends.
import { zlibSync } from "../../../vendor/fflate/fflate.js";
import { crc32, concat, utf8, latin1 } from "./bytes.js";
import { quantize } from "./quantize.js";

const CHANNELS = { gray: 1, graya: 2, rgb: 3, rgba: 4, indexed: 1 };
const COLOR_TYPE = { gray: 0, rgb: 2, indexed: 3, graya: 4, rgba: 6 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

function chunk(type, body) {
  const t = latin1(type);
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  out.set(t, 4);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/** Luma (Rec. 601 weights, the usual grayscale conversion of image editors). */
export const luma = (r, g, b) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

function toSamples(data, n, mode) {
  const ch = CHANNELS[mode];
  const out = new Uint8Array(n * ch);
  for (let i = 0, j = 0, o = 0; i < n; i++, j += 4, o += ch) {
    if (mode === "rgba") {
      out[o] = data[j];
      out[o + 1] = data[j + 1];
      out[o + 2] = data[j + 2];
      out[o + 3] = data[j + 3];
    } else if (mode === "rgb") {
      out[o] = data[j];
      out[o + 1] = data[j + 1];
      out[o + 2] = data[j + 2];
    } else {
      out[o] = luma(data[j], data[j + 1], data[j + 2]);
      if (mode === "graya") out[o + 1] = data[j + 3];
    }
  }
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Writes row filtered with `type` into out[1..] and returns the sum of absolute (signed) values. */
function applyFilter(type, row, prev, bpp, out) {
  const n = row.length;
  let sum = 0;
  out[0] = type;
  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev[i];
    let p = 0;
    if (type === 1) p = a;
    else if (type === 2) p = b;
    else if (type === 3) p = (a + b) >> 1;
    else if (type === 4) p = paeth(a, b, i >= bpp ? prev[i - bpp] : 0);
    const v = (row[i] - p) & 255;
    out[i + 1] = v;
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}

/** The filtered row (filter byte first): the filter type with the smallest sum of absolute values, or 0. */
function filterRow(row, prev, bpp, adaptive) {
  let best = new Uint8Array(row.length + 1);
  let bestSum = applyFilter(0, row, prev, bpp, best);
  if (!adaptive) return best;
  let tmp = new Uint8Array(row.length + 1);
  for (let type = 1; type < 5; type++) {
    const sum = applyFilter(type, row, prev, bpp, tmp);
    if (sum < bestSum) {
      bestSum = sum;
      [best, tmp] = [tmp, best];
    }
  }
  return best;
}

/**
 * @param {{width:number, height:number, data:Uint8Array|Uint8ClampedArray}} img
 * @param {{color?:string, colors?:number, dither?:boolean, interlace?:boolean, level?:number, ppi?:number, icc?:{name?:string, bytes:Uint8Array}|null, text?:Record<string,string>}} [o]
 */
export function encodePng(img, o = {}) {
  const { width: w, height: h, data } = img;
  if (!(w > 0 && h > 0) || data.length < w * h * 4) throw new Error("encodePng: the pixel data does not match the size.");
  const mode = COLOR_TYPE[o.color] !== undefined ? o.color : "rgba";
  const ch = CHANNELS[mode];
  let samples;
  let palette = null;
  let depth = 8;
  if (mode === "indexed") {
    const q = quantize(data, w, h, { colors: o.colors ?? 256, dither: !!o.dither });
    samples = q.indices;
    palette = q.palette;
    const count = palette.length / 4;
    depth = count <= 2 ? 1 : count <= 4 ? 2 : count <= 16 ? 4 : 8;
  } else samples = toSamples(data, w * h, mode);
  const bpp = Math.max(1, (ch * depth) >> 3);
  const adaptive = !palette && depth === 8;
  const rows = [];
  for (const [x0, y0, dx, dy] of o.interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((w - x0) / dx);
    if (pw <= 0 || y0 >= h) continue;
    const rowBytes = Math.ceil((pw * ch * depth) / 8);
    let prev = new Uint8Array(rowBytes);
    for (let y = y0; y < h; y += dy) {
      const row = new Uint8Array(rowBytes);
      if (depth === 8) {
        let k = 0;
        for (let x = x0; x < w; x += dx) {
          const s = (y * w + x) * ch;
          for (let c = 0; c < ch; c++) row[k++] = samples[s + c];
        }
      } else {
        for (let i = 0, x = x0; x < w; x += dx, i++) {
          const bit = i * depth;
          row[bit >> 3] |= samples[y * w + x] << (8 - depth - (bit & 7));
        }
      }
      rows.push(filterRow(row, prev, bpp, adaptive));
      prev = row;
    }
  }
  const level = Math.max(0, Math.min(9, Math.round(o.level ?? 6)));
  const idat = zlibSync(concat(rows), { level });

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = depth;
  ihdr[9] = COLOR_TYPE[mode];
  ihdr[12] = o.interlace ? 1 : 0;
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr)];
  if (o.icc?.bytes?.length && (mode === "rgb" || mode === "rgba" || mode === "indexed")) {
    const name = latin1(String(o.icc.name || "ICC profile").replace(/[^\x20-\x7e]/g, "").slice(0, 79) || "ICC profile");
    parts.push(chunk("iCCP", concat([name, Uint8Array.of(0, 0), zlibSync(o.icc.bytes, { level: 9 })])));
  }
  if (o.ppi > 0) {
    const ppm = Math.round(o.ppi / 0.0254);
    const b = new Uint8Array(9);
    const v = new DataView(b.buffer);
    v.setUint32(0, ppm);
    v.setUint32(4, ppm);
    b[8] = 1;
    parts.push(chunk("pHYs", b));
  }
  if (palette) {
    const count = palette.length / 4;
    const plte = new Uint8Array(count * 3);
    let trns = 0;
    for (let i = 0; i < count; i++) {
      plte.set(palette.subarray(i * 4, i * 4 + 3), i * 3);
      if (palette[i * 4 + 3] !== 255) trns = i + 1;
    }
    parts.push(chunk("PLTE", plte));
    if (trns) parts.push(chunk("tRNS", Uint8Array.from({ length: trns }, (_, i) => palette[i * 4 + 3])));
  }
  for (const [key, value] of Object.entries(o.text || {})) {
    if (!value) continue;
    // iTXt: keyword, 0, compression flag 0, method 0, empty language tag, 0, empty translated keyword, 0, UTF-8 text
    parts.push(chunk("iTXt", concat([latin1(key.slice(0, 79)), Uint8Array.of(0, 0, 0, 0, 0), utf8(value)])));
  }
  parts.push(chunk("IDAT", idat), chunk("IEND", new Uint8Array(0)));
  return concat(parts);
}
