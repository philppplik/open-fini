// Embeds an ICC profile into exported PNG (iCCP chunk) and JPEG (APP2 ICC_PROFILE segments) files. Pure, lazy.
import { zlibSync } from "../../../vendor/fflate/fflate.js";

let CRC = null;
function crc32(bytes, start, end) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** PNG with an iCCP chunk after IHDR; existing iCCP / sRGB / gAMA / cHRM chunks are dropped. */
export function embedIccPng(png, icc, name = "ICC profile") {
  if (png.length < 33 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) throw new Error("Not a PNG file.");
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const label = [...name.slice(0, 79)].map((c) => c.charCodeAt(0) & 0x7f || 63);
  const body = new Uint8Array([...[..."iCCP"].map((c) => c.charCodeAt(0)), ...label, 0, 0, ...zlibSync(icc, { level: 9 })]);
  const chunk = concat([new Uint8Array(be32(body.length - 4)), body, new Uint8Array(be32(crc32(body, 0, body.length)))]);
  const parts = [png.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const end = o + 12 + len;
    if (end > png.length) throw new Error("The PNG file is truncated.");
    if (!["iCCP", "sRGB", "gAMA", "cHRM"].includes(type)) parts.push(png.subarray(o, end));
    if (type === "IHDR") parts.push(chunk);
    o = end;
  }
  return concat(parts);
}

/** JPEG with APP2 ICC_PROFILE segments (split at 65519 bytes) right after SOI / APP0 / APP1. */
export function embedIccJpeg(jpg, icc) {
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) throw new Error("Not a JPEG file.");
  let o = 2;
  while (o + 4 <= jpg.length && jpg[o] === 0xff && (jpg[o + 1] === 0xe0 || jpg[o + 1] === 0xe1)) o += 2 + ((jpg[o + 2] << 8) | jpg[o + 3]);
  const MAX = 65519;
  const count = Math.ceil(icc.length / MAX);
  if (count > 255) throw new Error("The ICC profile is too large for a JPEG file.");
  const segs = [];
  const sig = [..."ICC_PROFILE"].map((c) => c.charCodeAt(0));
  for (let i = 0; i < count; i++) {
    const data = icc.subarray(i * MAX, Math.min(icc.length, (i + 1) * MAX));
    const len = 2 + 12 + 2 + data.length;
    segs.push(new Uint8Array([0xff, 0xe2, len >> 8, len & 255, ...sig, 0, i + 1, count]), data);
  }
  return concat([jpg.subarray(0, o), ...segs, jpg.subarray(o)]);
}
