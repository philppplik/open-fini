// ZIP reading for the Doctor (docs/doctor.md): a strict read with the .ofini limits (core/ofini.js ▸ OFINI_LIMITS,
// docs/security.md ▸ ZIP files) and, when the central directory is broken or the file is truncated, a recovery scan
// over the local file headers that keeps every entry whose bytes still inflate and match their CRC-32.
// Pure: no DOM, no storage; runs in the browser, in workers and in Node (the `ofini` command line tool).
import { unzipSync, inflateSync, zipSync } from "../../../vendor/fflate/fflate.js";

/** Same caps as core/ofini.js ▸ OFINI_LIMITS (kept here so the Doctor does not pull the renderer into its chunk). */
export const DOCTOR_LIMITS = Object.freeze({ entries: 100000, entry: 1024 * 1048576, total: 2048 * 1048576 });

let CRC_TABLE = null;
/** CRC-32 (the ZIP / PNG polynomial). */
export function crc32(bytes, crc = 0) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** True for a safe relative entry name ("assets/a.png"); false for "../x", "/x", "C:\x", NUL bytes and the like. */
export function safeEntryName(name) {
  if (typeof name !== "string" || !name || name.length > 512) return false;
  if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name)) return false;
  return !name.split("/").some((seg) => seg === ".." || seg === ".");
}

export const looksLikeZip = (b) => !!b && b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Offset of the end-of-central-directory record, or -1. */
export function findEocd(b) {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) return i;
  return -1;
}

/**
 * Strict read within limits. Never throws.
 * @returns {{ ok: boolean, entries: Record<string, Uint8Array>, order: string[], unsafe: string[], stored: Record<string, boolean>,
 *   overLimit: null|"entries"|"entry"|"total", error: string|null, count: number, total: number }}
 */
export function readZipStrict(bytes, limits = DOCTOR_LIMITS) {
  const unsafe = [];
  const order = [];
  const stored = {};
  let count = 0;
  let total = 0;
  let overLimit = null;
  const res = { ok: false, entries: {}, order, unsafe, stored, overLimit, error: null, count: 0, total: 0 };
  if (!looksLikeZip(bytes)) return { ...res, error: "not-zip" };
  let entries;
  try {
    entries = unzipSync(bytes, {
      filter(f) {
        count++;
        if (count > limits.entries) {
          overLimit ||= "entries";
          return false;
        }
        if (f.originalSize > limits.entry) {
          overLimit ||= "entry";
          return false;
        }
        total += f.originalSize;
        if (total > limits.total) {
          overLimit ||= "total";
          return false;
        }
        if (!safeEntryName(f.name)) {
          unsafe.push(String(f.name).slice(0, 200));
          return false;
        }
        if (f.name.endsWith("/")) return false;
        order.push(f.name);
        stored[f.name] = f.compression === 0;
        return true;
      },
    });
  } catch (e) {
    return { ...res, count, total, overLimit, error: String(e?.message || e || "unreadable") };
  }
  for (const [k, v] of Object.entries(entries)) if (!(v instanceof Uint8Array) || v.length > limits.entry) delete entries[k];
  return { ok: true, entries, order: order.filter((n) => entries[n]), unsafe, stored, overLimit, error: null, count, total };
}

/**
 * Recovery scan: walks the local file headers ("PK\3\4") from the start of the file and keeps every entry whose
 * data inflates and whose CRC-32 matches (or, for entries written with a data descriptor, whose stream ends cleanly).
 * Used when the central directory is missing (truncated download) or damaged.
 * @returns {{ entries: Record<string, Uint8Array>, order: string[], damaged: string[], unsafe: string[] }}
 */
export function scanLocalHeaders(bytes, limits = DOCTOR_LIMITS) {
  const entries = {};
  const order = [];
  const damaged = [];
  const unsafe = [];
  let total = 0;
  let i = 0;
  const n = bytes.length;
  const nextSig = (from) => {
    for (let j = from; j + 3 < n; j++) if (bytes[j] === 0x50 && bytes[j + 1] === 0x4b && ((bytes[j + 2] === 3 && bytes[j + 3] === 4) || (bytes[j + 2] === 1 && bytes[j + 3] === 2))) return j;
    return n;
  };
  while (i + 30 <= n && order.length + damaged.length < limits.entries) {
    if (!(bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 3 && bytes[i + 3] === 4)) {
      const j = nextSig(i + 1);
      if (j >= n || (bytes[j + 2] === 1 && bytes[j + 3] === 2)) break; // central directory reached: done
      i = j;
      continue;
    }
    const flags = u16(bytes, i + 6);
    const method = u16(bytes, i + 8);
    const crc = u32(bytes, i + 14);
    let csize = u32(bytes, i + 18);
    const usize = u32(bytes, i + 22);
    const nlen = u16(bytes, i + 26);
    const xlen = u16(bytes, i + 28);
    const nameStart = i + 30;
    const dataStart = nameStart + nlen + xlen;
    if (dataStart > n) break;
    let name = "";
    try {
      name = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(nameStart, nameStart + nlen));
    } catch {
      name = "";
    }
    const descriptor = (flags & 8) !== 0;
    if (descriptor && (csize === 0 || csize === 0xffffffff)) csize = nextSig(dataStart) - dataStart;
    const end = Math.min(n, dataStart + csize);
    const raw = bytes.subarray(dataStart, end);
    const advance = end > dataStart ? end : dataStart;
    if (!safeEntryName(name)) {
      if (name) unsafe.push(name.slice(0, 200));
      i = advance;
      continue;
    }
    if (name.endsWith("/")) {
      i = advance;
      continue;
    }
    let data = null;
    if (!(usize > limits.entry) && end - dataStart === csize) {
      try {
        if (method === 0) data = raw.slice();
        else if (method === 8) data = inflateSync(raw, descriptor ? undefined : { out: new Uint8Array(usize) });
      } catch {
        data = null;
      }
    }
    // with a data descriptor the header CRC is 0: the descriptor after the data carries it
    let want = crc;
    if (descriptor && data) {
      const d = end;
      const off = d + 4 <= n && u32(bytes, d) === 0x08074b50 ? d + 4 : d;
      if (off + 4 <= n) want = u32(bytes, off);
    }
    if (data && crc32(data) === want && total + data.length <= limits.total) {
      total += data.length;
      if (!entries[name]) order.push(name);
      entries[name] = data;
    } else damaged.push(name);
    i = advance;
  }
  return { entries, order, damaged, unsafe };
}

/** Writes an .ofini container: `mimetype` first and stored, small and already-compressed parts stored. */
export function writeOfiniZip(entries, mime = "application/vnd.openfini+zip") {
  const files = { mimetype: [new TextEncoder().encode(mime), { level: 0 }] };
  for (const [name, bytes] of Object.entries(entries)) {
    if (name === "mimetype") continue;
    const compress = name === "document.json" || name.startsWith("web/files/") || /\.(json|svg|txt|md|html|css|js|xml)$/i.test(name);
    files[name] = [bytes, { level: compress && bytes.length > 512 ? 6 : 0 }];
  }
  return zipSync(files);
}
