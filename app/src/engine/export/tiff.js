// TIFF 6.0 writer for export (clean-room, from the public Adobe TIFF 6.0 specification). Pure, no DOM.
//
// Public API:
//   encodeTiff({ width, height, data }, options) -> Uint8Array   (one page, little endian, chunky, 8 bits per sample)
//     data         RGBA, not premultiplied
//     options      color        "rgb" | "rgba" | "gray" | "cmyk"   (default "rgb")
//                  toCmyk       (rgb: Uint8Array) -> Uint8Array   converts packed RGB to packed CMYK (needed for "cmyk")
//                  compression  "none" | "lzw" | "deflate" | "packbits"   (default "lzw")
//                  predictor    horizontal differencing for LZW and Deflate (default true)
//                  ppi          XResolution / YResolution in pixels per inch (default 72)
//                  icc          ICC profile bytes (tag 34675); must match the color space (RGB or CMYK)
//                  meta         { title, description, author, rights, software, date, xmp }   (xmp: XMP packet text, tag 700)
//   lzwEncode(bytes) -> Uint8Array   TIFF-flavored LZW (MSB first, early code-width change)
//   packBitsEncode(bytes) -> Uint8Array
// Invariants: strips of about 64 KiB; alpha is written as unassociated (ExtraSamples = 2), as getImageData returns it.
import { zlibSync } from "../../../vendor/fflate/fflate.js";
import { latin1, concat } from "./bytes.js";
import { luma } from "./png.js";

const COMPRESSION = { none: 1, lzw: 5, deflate: 8, packbits: 32773 };

/** TIFF LZW: 9..12-bit codes, Clear = 256, EOI = 257, code width grows one code early (as libtiff and the spec's decoder expect). */
export function lzwEncode(src) {
  const out = [];
  let acc = 0;
  let nbits = 0;
  let width = 9;
  const put = (code) => {
    acc = (acc << width) | code;
    nbits += width;
    while (nbits >= 8) {
      nbits -= 8;
      out.push((acc >>> nbits) & 255);
    }
    acc &= (1 << nbits) - 1;
  };
  let dict = new Map();
  let next = 258;
  put(256);
  if (!src.length) {
    put(257);
    if (nbits) out.push((acc << (8 - nbits)) & 255);
    return Uint8Array.from(out);
  }
  let w = src[0];
  const grow = () => {
    next++;
    if (next === 4094) {
      put(256);
      dict = new Map();
      next = 258;
      width = 9;
    } else if (next === 1 << width && width < 12) width++;
  };
  for (let i = 1; i < src.length; i++) {
    const k = src[i];
    const key = w * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      w = hit;
      continue;
    }
    put(w);
    dict.set(key, next);
    grow();
    w = k;
  }
  put(w);
  // the decoder adds one more entry after the last code; follow it so EOI is written with the width it expects
  next++;
  if (next === 1 << width && width < 12) width++;
  put(257);
  if (nbits) out.push((acc << (8 - nbits)) & 255);
  return Uint8Array.from(out);
}

/** PackBits run-length encoding (Apple / TIFF 6.0 section 9). */
export function packBitsEncode(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) {
      out.push(257 - run, src[i]);
      i += run;
      continue;
    }
    let lit = 1;
    while (i + lit < src.length && lit < 128 && !(i + lit + 1 < src.length && src[i + lit] === src[i + lit + 1])) lit++;
    out.push(lit - 1);
    for (let k = 0; k < lit; k++) out.push(src[i + k]);
    i += lit;
  }
  return Uint8Array.from(out);
}

function samplesOf(data, n, color, toCmyk) {
  if (color === "rgba") return Uint8Array.from(data.subarray(0, n * 4));
  if (color === "gray") {
    const out = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = luma(data[j], data[j + 1], data[j + 2]);
    return out;
  }
  const rgb = new Uint8Array(n * 3);
  for (let i = 0, j = 0, o = 0; i < n; i++, j += 4, o += 3) {
    rgb[o] = data[j];
    rgb[o + 1] = data[j + 1];
    rgb[o + 2] = data[j + 2];
  }
  if (color !== "cmyk") return rgb;
  if (typeof toCmyk !== "function") throw new Error("encodeTiff: CMYK output needs a toCmyk converter.");
  return toCmyk(rgb);
}

const pad2 = (v) => String(v).padStart(2, "0");
const tiffDate = (d) => `${d.getFullYear()}:${pad2(d.getMonth() + 1)}:${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

/**
 * @param {{width:number, height:number, data:Uint8Array|Uint8ClampedArray}} img
 * @param {{color?:string, toCmyk?:(rgb:Uint8Array)=>Uint8Array, compression?:string, predictor?:boolean, ppi?:number, icc?:Uint8Array|null, meta?:{title?:string, description?:string, author?:string, rights?:string, software?:string, date?:Date, xmp?:string}}} [o]
 */
export function encodeTiff(img, o = {}) {
  const { width: w, height: h, data } = img;
  if (!(w > 0 && h > 0) || data.length < w * h * 4) throw new Error("encodeTiff: the pixel data does not match the size.");
  const color = ["rgb", "rgba", "gray", "cmyk"].includes(o.color) ? o.color : "rgb";
  const spp = { gray: 1, rgb: 3, rgba: 4, cmyk: 4 }[color];
  const comp = COMPRESSION[o.compression] || COMPRESSION.lzw;
  const predictor = (comp === 5 || comp === 8) && o.predictor !== false;
  const samples = samplesOf(data, w * h, color, o.toCmyk);
  const rowBytes = w * spp;
  const rps = Math.max(1, Math.min(h, Math.floor(65536 / rowBytes)));
  const strips = [];
  for (let y = 0; y < h; y += rps) {
    const rows = Math.min(rps, h - y);
    let raw = samples.slice(y * rowBytes, (y + rows) * rowBytes);
    if (predictor) {
      for (let r = 0; r < rows; r++) {
        const base = r * rowBytes;
        for (let i = rowBytes - 1; i >= spp; i--) raw[base + i] = (raw[base + i] - raw[base + i - spp]) & 255;
      }
    }
    if (comp === 5) raw = lzwEncode(raw);
    else if (comp === 8) raw = zlibSync(raw, { level: 6 });
    else if (comp === COMPRESSION.packbits) {
      const parts = [];
      for (let r = 0; r < rows; r++) parts.push(packBitsEncode(raw.subarray(r * rowBytes, (r + 1) * rowBytes))); // one run per row (spec)
      raw = concat(parts);
    }
    strips.push(raw);
  }

  // entries: [tag, type, count, value | bytes]; types 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 7 UNDEFINED
  const entries = [];
  const add = (tag, type, values) => entries.push({ tag, type, values });
  const ascii = (tag, s) => s && add(tag, 2, Uint8Array.from([...latin1(s), 0]));
  const meta = o.meta || {};
  add(256, 4, [w]);
  add(257, 4, [h]);
  add(258, 3, new Array(spp).fill(8));
  add(259, 3, [comp]);
  add(262, 3, [color === "gray" ? 1 : color === "cmyk" ? 5 : 2]);
  ascii(269, meta.title);
  ascii(270, meta.description);
  add(273, 4, new Array(strips.length).fill(0)); // patched below
  add(277, 3, [spp]);
  add(278, 4, [rps]);
  add(279, 4, strips.map((s) => s.length));
  const ppi = o.ppi > 0 ? o.ppi : 72;
  add(282, 5, [Math.round(ppi * 100), 100]);
  add(283, 5, [Math.round(ppi * 100), 100]);
  add(284, 3, [1]);
  add(296, 3, [2]);
  ascii(305, meta.software);
  if (meta.date instanceof Date && !isNaN(+meta.date)) ascii(306, tiffDate(meta.date));
  ascii(315, meta.author);
  if (predictor) add(317, 3, [2]);
  if (color === "cmyk") add(332, 3, [1]);
  if (color === "rgba") add(338, 3, [2]);
  if (meta.xmp) add(700, 1, new TextEncoder().encode(meta.xmp));
  ascii(33432, meta.rights);
  if (o.icc?.length) add(34675, 7, o.icc);

  entries.sort((a, b) => a.tag - b.tag); // the IFD must list tags in ascending order
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
  const ifdSize = 2 + entries.length * 12 + 4;
  let at = 8 + ifdSize;
  const extra = [];
  for (const e of entries) {
    const bytes = e.values.length * size[e.type] / (e.type === 5 ? 2 : 1);
    if (bytes > 4) {
      if (at & 1) at++;
      e.offset = at;
      extra.push(e);
      at += bytes;
    }
  }
  if (at & 1) at++;
  const stripAt = [];
  for (const s of strips) {
    stripAt.push(at);
    at += s.length;
  }
  entries.find((e) => e.tag === 273).values = stripAt;

  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  const writeValues = (e, pos) => {
    if (e.type === 1 || e.type === 2 || e.type === 7) out.set(e.values, pos);
    else if (e.type === 3) e.values.forEach((v, i) => dv.setUint16(pos + i * 2, v, true));
    else e.values.forEach((v, i) => dv.setUint32(pos + i * 4, v, true)); // LONG and RATIONAL (pairs of LONG)
  };
  entries.forEach((e, i) => {
    const p = 10 + i * 12;
    const count = e.type === 5 ? e.values.length / 2 : e.values.length;
    dv.setUint16(p, e.tag, true);
    dv.setUint16(p + 2, e.type, true);
    dv.setUint32(p + 4, count, true);
    if (e.offset !== undefined) dv.setUint32(p + 8, e.offset, true);
    else writeValues(e, p + 8);
  });
  dv.setUint32(10 + entries.length * 12, 0, true);
  for (const e of extra) writeValues(e, e.offset);
  strips.forEach((s, i) => out.set(s, stripAt[i]));
  return out;
}
