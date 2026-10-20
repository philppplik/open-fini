// Git packfiles: reading (with OFS/REF deltas, needed for clone/fetch and for importing real repositories) and
// writing (undeltified; every object zlib-compressed). Includes a small inflater that reports where a zlib
// stream ends, which packfiles require because object boundaries are not stored. Pure.
import { zlibSync } from "../../../vendor/fflate/fflate.js";
import { concat, hashObject, sha1, toHex, fromHex } from "./objects.js";

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function construct(lengths, n) {
  const count = new Uint16Array(16);
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

let fixedTables = null;
function fixed() {
  if (fixedTables) return fixedTables;
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  const d = new Uint8Array(30).fill(5);
  return (fixedTables = { lit: construct(l, 288), dist: construct(d, 30) });
}

/**
 * Inflates one zlib stream that starts at `pos` inside `src`.
 * @returns {{ out: Uint8Array, end: number }} `end` is the offset just after the stream (including its Adler-32)
 */
export function inflateAt(src, pos, size) {
  let p = pos + 2; // zlib header
  if (((src[pos] << 8) | src[pos + 1]) % 31 !== 0 || (src[pos] & 15) !== 8 || src[pos + 1] & 0x20) throw new Error("Bad zlib header in pack.");
  let buf = 0;
  let cnt = 0;
  const bits = (need) => {
    let v = buf;
    while (cnt < need) {
      if (p >= src.length) throw new Error("Truncated pack.");
      v |= src[p++] << cnt;
      cnt += 8;
    }
    buf = v >>> need;
    cnt -= need;
    return v & ((1 << need) - 1);
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first += c;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("Bad Huffman code in pack.");
  };
  let out = new Uint8Array(Math.max(size, 16));
  let o = 0;
  const ensure = (n) => {
    if (o + n > out.length) {
      const bigger = new Uint8Array(Math.max(out.length * 2, o + n));
      bigger.set(out);
      out = bigger;
    }
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      buf = 0;
      cnt = 0;
      const len = src[p] | (src[p + 1] << 8);
      p += 4;
      ensure(len);
      out.set(src.subarray(p, p + len), o);
      p += len;
      o += len;
    } else if (type === 1 || type === 2) {
      let lit;
      let dist;
      if (type === 1) ({ lit, dist } = fixed());
      else {
        const nlen = bits(5) + 257;
        const ndist = bits(5) + 1;
        const ncode = bits(4) + 4;
        const lengths = new Uint8Array(320);
        for (let i = 0; i < ncode; i++) lengths[CLORDER[i]] = bits(3);
        const lencode = construct(lengths, 19);
        let idx = 0;
        const all = new Uint8Array(320);
        while (idx < nlen + ndist) {
          let sym = decode(lencode);
          if (sym < 16) all[idx++] = sym;
          else {
            let prev = 0;
            let rep;
            if (sym === 16) {
              prev = all[idx - 1];
              rep = 3 + bits(2);
            } else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            while (rep--) all[idx++] = prev;
          }
        }
        lit = construct(all.subarray(0, nlen), nlen);
        dist = construct(all.subarray(nlen, nlen + ndist), ndist);
      }
      for (;;) {
        let sym = decode(lit);
        if (sym < 256) {
          ensure(1);
          out[o++] = sym;
        } else if (sym === 256) break;
        else {
          sym -= 257;
          if (sym >= 29) throw new Error("Bad length code in pack.");
          const len = LBASE[sym] + bits(LEXT[sym]);
          const ds = decode(dist);
          const d = DBASE[ds] + bits(DEXT[ds]);
          if (d > o) throw new Error("Bad distance in pack.");
          ensure(len);
          for (let i = 0; i < len; i++, o++) out[o] = out[o - d];
        }
      }
    } else throw new Error("Bad block type in pack.");
  } while (!last);
  return { out: out.subarray(0, o), end: p + 4 };
}

/** Applies a Git delta (copy/insert instructions) to `base`. */
export function applyDelta(base, delta) {
  let i = 0;
  const varint = () => {
    let v = 0;
    let shift = 0;
    let b;
    do {
      b = delta[i++];
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return v;
  };
  const srcSize = varint();
  const dstSize = varint();
  if (srcSize !== base.length) throw new Error("Delta does not match its base object.");
  const out = new Uint8Array(dstSize);
  let o = 0;
  while (i < delta.length) {
    const op = delta[i++];
    if (op & 0x80) {
      let off = 0;
      let len = 0;
      if (op & 1) off = delta[i++];
      if (op & 2) off |= delta[i++] << 8;
      if (op & 4) off |= delta[i++] << 16;
      if (op & 8) off |= delta[i++] * 2 ** 24;
      if (op & 16) len = delta[i++];
      if (op & 32) len |= delta[i++] << 8;
      if (op & 64) len |= delta[i++] << 16;
      if (!len) len = 0x10000;
      out.set(base.subarray(off, off + len), o);
      o += len;
    } else if (op) {
      out.set(delta.subarray(i, i + op), o);
      i += op;
      o += op;
    } else throw new Error("Bad delta instruction.");
  }
  if (o !== dstSize) throw new Error("Delta produced the wrong size.");
  return out;
}

const NAMES = [null, "commit", "tree", "blob", "tag"];

/**
 * Reads a packfile. `external(oid)` supplies base objects of thin packs ({type, content} or null).
 * @returns {{ oid: string, type: string, content: Uint8Array }[]}
 */
export function readPack(pack, { external = () => null, verify = true } = {}) {
  if (pack.length < 32 || pack[0] !== 0x50 || pack[1] !== 0x41 || pack[2] !== 0x43 || pack[3] !== 0x4b) throw new Error("Not a Git packfile.");
  const dv = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  if (dv.getUint32(4) !== 2) throw new Error("Unsupported pack version.");
  const count = dv.getUint32(8);
  if (verify && toHex(sha1(pack.subarray(0, pack.length - 20))) !== toHex(pack.subarray(pack.length - 20))) throw new Error("Pack checksum mismatch.");
  const entries = [];
  const byOffset = new Map();
  let p = 12;
  for (let n = 0; n < count; n++) {
    const start = p;
    let c = pack[p++];
    const type = (c >> 4) & 7;
    let size = c & 15;
    let shift = 4;
    while (c & 0x80) {
      c = pack[p++];
      size += (c & 0x7f) * 2 ** shift;
      shift += 7;
    }
    const e = { offset: start, type, size };
    if (type === 6) {
      c = pack[p++];
      let off = c & 0x7f;
      while (c & 0x80) {
        c = pack[p++];
        off = ((off + 1) << 7) | (c & 0x7f);
      }
      e.baseOffset = start - off;
    } else if (type === 7) {
      e.baseOid = toHex(pack.subarray(p, p + 20));
      p += 20;
    } else if (!NAMES[type]) throw new Error("Bad object type in pack.");
    const r = inflateAt(pack, p, size);
    if (r.out.length !== size) throw new Error("Pack object size mismatch.");
    e.data = r.out;
    p = r.end;
    entries.push(e);
    byOffset.set(start, e);
  }
  const resolved = new Map(); // entry -> {type, content}
  const byOid = new Map();
  const resolve = (e, depth = 0) => {
    if (resolved.has(e)) return resolved.get(e);
    if (depth > 4000) throw new Error("Delta chain too deep.");
    let r;
    if (e.type <= 4) r = { type: NAMES[e.type], content: e.data };
    else {
      let base;
      if (e.type === 6) {
        const be = byOffset.get(e.baseOffset);
        if (!be) throw new Error("Missing delta base in pack.");
        base = resolve(be, depth + 1);
      } else {
        const be = byOid.get(e.baseOid) || null;
        base = be ? resolve(be, depth + 1) : external(e.baseOid);
        if (!base) throw new Error(`Pack needs object ${e.baseOid.slice(0, 7)} that is not available (thin pack).`);
      }
      r = { type: base.type, content: applyDelta(base.content, e.data) };
    }
    resolved.set(e, r);
    if (!e.oid) {
      e.oid = hashObject(r.type, r.content);
      byOid.set(e.oid, e);
    }
    return r;
  };
  // non-delta objects first so ref-deltas can find their base by id
  for (const e of entries) if (e.type <= 4) resolve(e);
  const out = [];
  for (const e of entries) {
    const r = resolve(e);
    out.push({ oid: e.oid, type: r.type, content: r.content });
  }
  return out;
}

/** Writes an undeltified packfile of `objects` ([{type, content}]). */
export function writePack(objects) {
  const head = new Uint8Array(12);
  const dv = new DataView(head.buffer);
  head.set([0x50, 0x41, 0x43, 0x4b]);
  dv.setUint32(4, 2);
  dv.setUint32(8, objects.length);
  const parts = [head];
  for (const o of objects) {
    const code = NAMES.indexOf(o.type);
    let size = o.content.length;
    const hdr = [(code << 4) | (size & 15)];
    size = Math.floor(size / 16);
    while (size > 0) {
      hdr[hdr.length - 1] |= 0x80;
      hdr.push(size & 0x7f);
      size = Math.floor(size / 128);
    }
    parts.push(new Uint8Array(hdr), zlibSync(o.content, { level: 6 }));
  }
  const body = concat(...parts);
  return concat(body, sha1(body));
}

// ------------------------------------------------------------------ pkt-line (smart HTTP framing)

export const FLUSH = new Uint8Array([0x30, 0x30, 0x30, 0x30]);
export function pktLine(data) {
  const b = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return concat(new TextEncoder().encode((b.length + 4).toString(16).padStart(4, "0")), b);
}
/** Splits pkt-lines; flush packets are returned as `null`. */
export function readPktLines(bytes, from = 0) {
  const out = [];
  let p = from;
  while (p + 4 <= bytes.length) {
    const len = parseInt(new TextDecoder().decode(bytes.subarray(p, p + 4)), 16);
    if (Number.isNaN(len)) throw new Error("Bad pkt-line.");
    if (len === 0) {
      out.push(null);
      p += 4;
    } else if (len < 4) {
      p += 4; // delimiter / response-end packets are not used by protocol v0
    } else {
      out.push(bytes.subarray(p + 4, p + len));
      p += len;
    }
  }
  return { lines: out, end: p };
}
export { fromHex };
