// Git object model: SHA-1, blob/tree/commit/tag encoding and parsing, loose object (zlib) framing.
// Pure: no DOM, no Node-only APIs; compression comes from the vendored fflate.
import { zlibSync, unzlibSync } from "../../../vendor/fflate/fflate.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8 = (s) => enc.encode(s);
export const text = (b) => dec.decode(b);

export function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] >> 4).toString(16) + (bytes[i] & 15).toString(16);
  return s;
}
export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ------------------------------------------------------------------ SHA-1 (synchronous, RFC 3174)

const rol = (n, s) => (n << s) | (n >>> (32 - s));

/** @param {Uint8Array} data @returns {Uint8Array} 20-byte digest */
export function sha1(data) {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89 | 0;
  let h2 = 0x98badcfe | 0;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0 | 0;
  const w = new Int32Array(80);
  const block = (b, o) => {
    for (let i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let bb = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = (bb & c) | (~bb & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = bb ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (bb & c) | (bb & d) | (c & d);
        k = 0x8f1bbcdc | 0;
      } else {
        f = bb ^ c ^ d;
        k = 0xca62c1d6 | 0;
      }
      const t = (rol(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rol(bb, 30);
      bb = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + bb) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  };
  const full = Math.floor(data.length / 64);
  for (let i = 0; i < full; i++) block(data, i * 64);
  const rem = data.length - full * 64;
  const tailLen = rem + 9 <= 64 ? 64 : 128;
  const tail = new Uint8Array(tailLen);
  tail.set(data.subarray(full * 64));
  tail[rem] = 0x80;
  const bits = data.length * 8;
  const dv = new DataView(tail.buffer);
  dv.setUint32(tailLen - 8, Math.floor(bits / 4294967296));
  dv.setUint32(tailLen - 4, bits >>> 0);
  block(tail, 0);
  if (tailLen === 128) block(tail, 64);
  const out = new Uint8Array(20);
  const o = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((v, i) => o.setUint32(i * 4, v >>> 0));
  return out;
}
export const sha1Hex = (data) => toHex(sha1(data));

// ------------------------------------------------------------------ objects

export const TYPES = ["commit", "tree", "blob", "tag"];

/** Git's object id of `content` as `type`: sha1("<type> <size>\0" + content). */
export function hashObject(type, content) {
  return sha1Hex(concat(utf8(`${type} ${content.length}\0`), content));
}

/** Loose-object bytes (zlib of header + content). */
export function packLoose(type, content) {
  return zlibSync(concat(utf8(`${type} ${content.length}\0`), content), { level: 6 });
}

/** @returns {{type: string, content: Uint8Array}} */
export function unpackLoose(bytes) {
  const raw = unzlibSync(bytes);
  const nul = raw.indexOf(0);
  const header = text(raw.subarray(0, nul));
  const m = /^(blob|tree|commit|tag) (\d+)$/.exec(header);
  if (!m) throw new Error("Corrupt Git object header.");
  const content = raw.subarray(nul + 1);
  if (content.length !== Number(m[2])) throw new Error("Corrupt Git object (size mismatch).");
  return { type: m[1], content };
}

// ---- trees

const byteCompare = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** @param {{mode: string, name: string, oid: string}[]} entries (mode "100644" | "100755" | "120000" | "40000" | "160000") */
export function serializeTree(entries) {
  const list = entries.map((e) => ({ ...e, key: utf8(e.mode === "40000" ? `${e.name}/` : e.name), nameBytes: utf8(e.name) }));
  list.sort((a, b) => byteCompare(a.key, b.key));
  const parts = [];
  for (const e of list) parts.push(utf8(`${e.mode} `), e.nameBytes, new Uint8Array([0]), fromHex(e.oid));
  return concat(...parts);
}

export function parseTree(content) {
  const out = [];
  let i = 0;
  while (i < content.length) {
    const sp = content.indexOf(32, i);
    const nul = content.indexOf(0, sp);
    out.push({ mode: text(content.subarray(i, sp)), name: text(content.subarray(sp + 1, nul)), oid: toHex(content.subarray(nul + 1, nul + 21)) });
    i = nul + 21;
  }
  return out;
}

// ---- commits and tags

export const formatTz = (offsetMinutes) => {
  const sign = offsetMinutes <= 0 ? "+" : "-"; // Date#getTimezoneOffset is positive west of UTC
  const a = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}${String(a % 60).padStart(2, "0")}`;
};

/** @typedef {{name: string, email: string, ts: number, tz: string}} Person */
const person = (p) => `${p.name.replace(/[<>\n]/g, "")} <${p.email.replace(/[<>\n]/g, "")}> ${p.ts} ${p.tz}`;

export function serializeCommit({ tree, parents = [], author, committer = author, message }) {
  let s = `tree ${tree}\n`;
  for (const p of parents) s += `parent ${p}\n`;
  s += `author ${person(author)}\ncommitter ${person(committer)}\n\n`;
  s += message.endsWith("\n") ? message : `${message}\n`;
  return utf8(s);
}

const parsePerson = (s) => {
  const m = /^(.*?) ?<([^>]*)> (\d+) ([+-]\d{4})$/.exec(s || "");
  return m ? { name: m[1], email: m[2], ts: Number(m[3]), tz: m[4] } : { name: s || "", email: "", ts: 0, tz: "+0000" };
};

export function parseCommit(content) {
  const s = text(content);
  const split = s.indexOf("\n\n");
  const head = split < 0 ? s : s.slice(0, split);
  const message = split < 0 ? "" : s.slice(split + 2);
  const c = { tree: "", parents: [], author: null, committer: null, message, extra: [] };
  let last = null;
  for (const line of head.split("\n")) {
    if (line.startsWith(" ") && last) {
      last.value += `\n${line.slice(1)}`;
      continue;
    }
    const sp = line.indexOf(" ");
    const key = sp < 0 ? line : line.slice(0, sp);
    const value = sp < 0 ? "" : line.slice(sp + 1);
    if (key === "tree") c.tree = value;
    else if (key === "parent") c.parents.push(value);
    else if (key === "author") c.author = parsePerson(value);
    else if (key === "committer") c.committer = parsePerson(value);
    else c.extra.push((last = { key, value }));
  }
  c.author ||= parsePerson("");
  c.committer ||= c.author;
  return c;
}

export function serializeTag({ object, type = "commit", tag, tagger, message }) {
  return utf8(`object ${object}\ntype ${type}\ntag ${tag}\ntagger ${person(tagger)}\n\n${message.endsWith("\n") ? message : `${message}\n`}`);
}
export function parseTag(content) {
  const s = text(content);
  const split = s.indexOf("\n\n");
  const out = { object: "", type: "commit", tag: "", tagger: null, message: split < 0 ? "" : s.slice(split + 2) };
  for (const line of (split < 0 ? s : s.slice(0, split)).split("\n")) {
    const sp = line.indexOf(" ");
    const k = line.slice(0, sp);
    const v = line.slice(sp + 1);
    if (k === "object") out.object = v;
    else if (k === "type") out.type = v;
    else if (k === "tag") out.tag = v;
    else if (k === "tagger") out.tagger = parsePerson(v);
  }
  return out;
}

/** First line of a commit message. */
export const subject = (message) => (message || "").split("\n", 1)[0].trim();

/** True when the bytes look binary (a NUL in the first 8000 bytes, like Git). */
export function isBinary(bytes) {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}
