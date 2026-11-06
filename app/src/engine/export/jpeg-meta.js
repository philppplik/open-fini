// JPEG post-processing for export: resolution (JFIF density) and XMP metadata (APP1). Pure, no DOM.
// Browsers encode JPEG with a JFIF APP0 segment at 1:1 aspect and no unit; these helpers rewrite or add segments
// without touching the entropy-coded data.
//
// Public API:
//   jpegSetDensity(bytes, ppi) -> Uint8Array   JFIF APP0 with units = dots per inch (an APP0 is added when missing)
//   jpegAddXmp(bytes, xmp)     -> Uint8Array   APP1 "http://ns.adobe.com/xap/1.0/" right after APP0 (packet < 64 KiB)
import { concat, utf8, latin1 } from "./bytes.js";

function check(b) {
  if (!(b && b[0] === 0xff && b[1] === 0xd8)) throw new Error("Not a JPEG file.");
}

/** Offset just after SOI and the APP0 (JFIF) segments. */
function afterApp0(b) {
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff && b[o + 1] === 0xe0) o += 2 + ((b[o + 2] << 8) | b[o + 3]);
  return o;
}

const segment = (marker, body) => {
  const len = body.length + 2;
  if (len > 0xffff) throw new Error("JPEG segment too large.");
  return concat([Uint8Array.of(0xff, marker, len >> 8, len & 255), body]);
};

export function jpegSetDensity(b, ppi) {
  check(b);
  const d = Math.max(1, Math.min(65535, Math.round(ppi)));
  if (b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46 && b[10] === 0) {
    const out = b.slice();
    out[13] = 1;
    out[14] = d >> 8;
    out[15] = d & 255;
    out[16] = d >> 8;
    out[17] = d & 255;
    return out;
  }
  const jfif = Uint8Array.of(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0);
  return concat([b.subarray(0, 2), segment(0xe0, jfif), b.subarray(2)]);
}

export function jpegAddXmp(b, xmp) {
  check(b);
  const at = afterApp0(b);
  return concat([b.subarray(0, at), segment(0xe1, concat([latin1("http://ns.adobe.com/xap/1.0/"), Uint8Array.of(0), utf8(xmp)])), b.subarray(at)]);
}

