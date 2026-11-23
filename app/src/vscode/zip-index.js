// A defensive ZIP reader for large .vsix packages: reads the central directory without decompressing anything, then
// inflates only the entries the caller selects, in chunks, and stops the moment an entry produces more bytes than its
// header declares or than the limits allow. A 500 MB package therefore costs one pass over the directory and the
// few small files OpenFini uses, and a zip bomb cannot expand past the per-file and total caps. Pure (no DOM).
//
// Public API
//   readZipIndex(bytes, { maxEntries })        -> [{ name, method, size, csize, offset, flags }]   (throws a readable Error)
//   readZipEntry(bytes, entry, { maxBytes })    -> Uint8Array   (stored or deflate; size-checked while inflating)
//
// Invariants
// - Every offset and length is bounds-checked against the archive before it is used; encrypted entries, unknown
//   compression methods and spanned archives are refused.
// - ZIP64 end records are understood (archives larger than 4 GB or with more than 65535 entries are still refused by
//   the caller's limits, but a ZIP64 writer's normal output opens).
// - Output never exceeds min(declared size, maxBytes); a stream that inflates further aborts with an Error.
import { Inflate } from "../../vendor/fflate/fflate.js";

// small input chunks bound the memory one push can produce even at the maximum deflate ratio (about 1:1032)
const CHUNK = 16 * 1024;

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;

function bad(msg) {
  return new Error(msg || "This is not a valid ZIP archive.");
}

/** Finds the end of central directory record (it sits in the last 64 KiB + 22 bytes). */
function findEocd(b) {
  const min = Math.max(0, b.length - 0xffff - 22);
  for (let i = b.length - 22; i >= min; i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) return i;
  return -1;
}

/**
 * Lists the entries of a ZIP archive from its central directory.
 * @param {Uint8Array} b
 * @param {{ maxEntries?: number }} [o]
 */
export function readZipIndex(b, { maxEntries = 50_000 } = {}) {
  if (!(b instanceof Uint8Array) || b.length < 22) throw bad();
  const e = findEocd(b);
  if (e < 0) throw bad();
  if (u16(b, e + 4) !== 0 || u16(b, e + 6) !== 0) throw bad("Spanned (multi-part) ZIP archives are not supported.");
  let count = u16(b, e + 10);
  let cdSize = u32(b, e + 12);
  let cdOff = u32(b, e + 16);
  // ZIP64: a locator 20 bytes before the end record points at the ZIP64 end record
  if ((count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && e >= 20 && u32(b, e - 20) === 0x07064b50) {
    const z = u64(b, e - 12);
    if (z + 56 > b.length || u32(b, z) !== 0x06064b50) throw bad();
    count = u64(b, z + 32);
    cdSize = u64(b, z + 40);
    cdOff = u64(b, z + 48);
  }
  if (count > maxEntries) throw new Error(`The package has more than ${maxEntries} entries.`);
  if (cdOff + cdSize > b.length) throw bad();
  const dec = new TextDecoder();
  const out = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw bad();
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    let csize = u32(b, p + 20);
    let size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    let offset = u32(b, p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > b.length) throw bad();
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 extra field (id 1): the 64-bit values replace the 0xffffffff placeholders, in this order
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(b, x);
      const len = u16(b, x + 2);
      if (id === 1) {
        let q = x + 4;
        if (size === 0xffffffff && q + 8 <= x + 4 + len) (size = u64(b, q)), (q += 8);
        if (csize === 0xffffffff && q + 8 <= x + 4 + len) (csize = u64(b, q)), (q += 8);
        if (offset === 0xffffffff && q + 8 <= x + 4 + len) offset = u64(b, q);
      }
      x += 4 + len;
    }
    out.push({ name, method, size, csize, offset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Decompresses one entry. Stops with an Error as soon as the data would exceed `maxBytes` or the declared size.
 * @param {Uint8Array} b archive
 * @param {{ name: string, method: number, size: number, csize: number, offset: number, flags: number }} entry
 * @param {{ maxBytes?: number }} [o]
 */
export function readZipEntry(b, entry, { maxBytes = 32 * 1024 * 1024 } = {}) {
  if (entry.flags & 1) throw new Error(`“${entry.name}” is encrypted.`);
  const h = entry.offset;
  if (h + 30 > b.length || u32(b, h) !== 0x04034b50) throw bad();
  const start = h + 30 + u16(b, h + 26) + u16(b, h + 28);
  const end = start + entry.csize;
  if (end > b.length) throw bad();
  const limit = Math.min(entry.size, maxBytes);
  if (entry.size > maxBytes) throw new Error(`“${entry.name}” is larger than ${Math.round(maxBytes / 1048576)} MB when unpacked.`);
  if (entry.method === 0) {
    if (entry.csize !== entry.size) throw bad();
    return b.slice(start, end);
  }
  if (entry.method !== 8) throw new Error(`“${entry.name}” uses a compression method OpenFini does not read (${entry.method}).`);
  const out = new Uint8Array(limit);
  let n = 0;
  let over = false;
  const inf = new Inflate((chunk) => {
    if (n + chunk.length > limit) {
      over = true;
      return;
    }
    out.set(chunk, n);
    n += chunk.length;
  });
  for (let p = start; p < end && !over; p += CHUNK) inf.push(b.subarray(p, Math.min(end, p + CHUNK)), p + CHUNK >= end);
  if (over) throw new Error(`“${entry.name}” unpacks to more than its header says (possible zip bomb).`);
  if (n !== entry.size) throw new Error(`“${entry.name}” is damaged (it unpacks to ${n} bytes instead of ${entry.size}).`);
  return out;
}
