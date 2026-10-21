// File transfer over a room: allow-list, chunking and verified reassembly. Pure (no DOM).
//
// A sender announces a file with `file-offer` { fid, name, mime, size, chunks, sha } and then sends `file-chunk`
// { fid, i, data(base64) } frames (every frame is encrypted and signed like any other message). Receivers accept only
// allow-listed types up to LIMITS.fileBytes, reassemble in memory, and check the SHA-256 before the file is shown.
// Received files are never opened automatically: the UI shows a card and asks before "Open as document" or "Save".
//
// Public API
//   FILE_TYPES                 allowed extensions → mime
//   checkFile(name, size)      → { ok, ext, mime, name, error? }
//   chunkCount(size, chunk)    number of chunks
//   sliceChunk(bytes, i)       base64 of chunk i
//   class Assembler            receives offers and chunks: .offer(sender, offer) .chunk(sender, chunk) → progress/done
import { LIMITS, sanitizeFileName } from "./protocol.js";
import { bytesToBase64, base64ToBytes } from "../ai/util.js";

/** Types members may send each other. Everything else is refused on both ends. */
export const FILE_TYPES = Object.freeze({
  ofini: "application/vnd.openfini+zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ora: "image/openraster",
  psd: "image/vnd.adobe.photoshop",
  zip: "application/zip",
});

/** Validates a file name and size against the allow-list. */
export function checkFile(name, size) {
  const clean = sanitizeFileName(name);
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot + 1).toLowerCase() : "";
  if (!Number.isInteger(size) || size < 0) return { ok: false, error: "The file size is invalid." };
  if (size > LIMITS.fileBytes) return { ok: false, error: `Files can be at most ${Math.round(LIMITS.fileBytes / 1048576)} MB.` };
  if (!FILE_TYPES[ext]) return { ok: false, error: `Files of type “.${ext || "?"}” cannot be sent. Allowed: ${Object.keys(FILE_TYPES).map((e) => `.${e}`).join(" ")}` };
  return { ok: true, ext, mime: FILE_TYPES[ext], name: clean };
}

export const chunkCount = (size, chunk = LIMITS.chunkBytes) => Math.max(1, Math.ceil(size / chunk));

export function sliceChunk(bytes, i, chunk = LIMITS.chunkBytes) {
  return bytesToBase64(bytes.subarray(i * chunk, Math.min(bytes.length, (i + 1) * chunk)));
}

/**
 * Reassembles incoming files. Limits: one active transfer per file id, MAX_ACTIVE transfers at once, total buffered
 * bytes capped, chunks must arrive for a known offer of the same sender and fit the announced size.
 */
export class Assembler {
  static MAX_ACTIVE = 6;
  static MAX_BUFFERED = 64 * 1024 * 1024;
  constructor({ verify } = {}) {
    this.active = new Map(); // fid → transfer
    this.verify = verify; // async (bytes, sha) => boolean
  }

  get buffered() {
    let n = 0;
    for (const t of this.active.values()) n += t.size;
    return n;
  }

  /** @returns {{ok:boolean, error?:string, transfer?:any}} */
  offer(sender, o) {
    const chk = checkFile(o.name, o.size);
    if (!chk.ok) return { ok: false, error: chk.error };
    if (o.chunks !== chunkCount(o.size)) return { ok: false, error: "The chunk count does not match the size." };
    if (this.active.has(o.fid)) return { ok: false, error: "Duplicate transfer." };
    if (this.active.size >= Assembler.MAX_ACTIVE || this.buffered + o.size > Assembler.MAX_BUFFERED) return { ok: false, error: "Too many files at once." };
    const t = { fid: o.fid, from: sender, name: chk.name, ext: chk.ext, mime: chk.mime, size: o.size, chunks: o.chunks, sha: o.sha, purpose: o.purpose || "file", doc: o.doc, note: o.note, bytes: new Uint8Array(o.size), got: new Set(), received: 0 };
    this.active.set(o.fid, t);
    return { ok: true, transfer: t };
  }

  /** @returns {Promise<{ok:boolean, error?:string, transfer?:any, done?:boolean}>} */
  async chunk(sender, c) {
    const t = this.active.get(c.fid);
    if (!t || t.from !== sender) return { ok: false, error: "Chunk for an unknown transfer." };
    if (c.i >= t.chunks || t.got.has(c.i)) return { ok: false, error: "Unexpected chunk." };
    let data;
    try {
      data = base64ToBytes(c.data);
    } catch {
      return this.#abort(t, "Damaged chunk.");
    }
    const start = c.i * LIMITS.chunkBytes;
    const expected = Math.min(LIMITS.chunkBytes, t.size - start);
    if (data.length !== expected) return this.#abort(t, "Chunk size mismatch.");
    t.bytes.set(data, start);
    t.got.add(c.i);
    t.received += data.length;
    if (t.got.size < t.chunks) return { ok: true, transfer: t, done: false };
    this.active.delete(t.fid);
    if (this.verify && !(await this.verify(t.bytes, t.sha))) return { ok: false, error: "The file does not match its checksum.", transfer: t };
    return { ok: true, transfer: t, done: true };
  }

  #abort(t, error) {
    this.active.delete(t.fid);
    return { ok: false, error, transfer: t };
  }

  /** Drops transfers of a member (left or removed). */
  dropFrom(sender) {
    for (const [fid, t] of this.active) if (t.from === sender) this.active.delete(fid);
  }
}
