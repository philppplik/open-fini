/**
 * Low-level PDF file writer: numbered objects, streams (optionally Flate compressed), cross-reference table and
 * trailer. Pure ES module, no DOM / Node APIs.
 *
 * @module pdf-writer
 */

import { zlibSync } from '../../../vendor/fflate/fflate.js';

/**
 * Converts a string whose code units are all < 256 to bytes.
 * @param {string} s
 * @returns {Uint8Array}
 */
export function latin1(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Formats a number for PDF content (no exponent, at most 4 decimals, no trailing zeros).
 * @param {number} x
 * @returns {string}
 */
export function num(x) {
  if (!isFinite(x)) return '0';
  if (Number.isInteger(x)) return String(x);
  let s = x.toFixed(4);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Escapes a PDF name (without the leading slash).
 * @param {string} s
 * @returns {string}
 */
export function pdfName(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 32 && c < 127 && '()<>[]{}/%#'.indexOf(s[i]) < 0) out += s[i];
    else out += '#' + (c & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * PDF text string: a literal string for ASCII text, otherwise UTF-16BE with a byte order mark as a hex string.
 * @param {string} s
 * @returns {string}
 */
export function pdfText(s) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, '\\$&') + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return '<' + hex.toUpperCase() + '>';
}

/**
 * Formats a Date as a PDF date string (UTC).
 * @param {Date} d
 * @returns {string}
 */
export function pdfDate(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

const HEADER = latin1('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

/** Collects PDF objects and serializes them with a correct xref table. */
export class PdfWriter {
  constructor() {
    /** @type {(Array<string|Uint8Array>|null)[]} object bodies by number (index 0 unused) */
    this.objs = [null];
  }

  /**
   * Reserves an object number.
   * @returns {number}
   */
  reserve() {
    this.objs.push(null);
    return this.objs.length - 1;
  }

  /**
   * Stores the body of an object (everything between `N 0 obj` and `endobj`).
   * @param {number} n
   * @param {string|Uint8Array|Array<string|Uint8Array>} body
   */
  set(n, body) {
    this.objs[n] = Array.isArray(body) ? body : [body];
  }

  /**
   * Adds an object and returns its number.
   * @param {string|Uint8Array|Array<string|Uint8Array>} body
   * @returns {number}
   */
  add(body) {
    const n = this.reserve();
    this.set(n, body);
    return n;
  }

  /**
   * Builds the body of a stream object.
   * @param {string} dictBody dictionary entries without `<<` `>>` and without /Length /Filter
   * @param {Uint8Array|string} data
   * @param {{compress?: boolean, filter?: string}} [opts] `compress` applies Flate; `filter` marks data that is
   *   already encoded (e.g. `/DCTDecode`)
   * @returns {Array<string|Uint8Array>}
   */
  streamBody(dictBody, data, opts) {
    let bytes = typeof data === 'string' ? latin1(data) : data;
    let filter = opts && opts.filter ? opts.filter : '';
    if (opts && opts.compress && !filter && bytes.length > 32) {
      const z = zlibSync(bytes, { level: 6 });
      if (z.length < bytes.length) {
        bytes = z;
        filter = '/FlateDecode';
      }
    }
    const head = `<<${dictBody ? ' ' + dictBody : ''}${filter ? ' /Filter ' + filter : ''} /Length ${bytes.length} >>\nstream\n`;
    return [head, bytes, '\nendstream'];
  }

  /**
   * Adds a stream object and returns its number.
   * @param {string} dictBody
   * @param {Uint8Array|string} data
   * @param {{compress?: boolean, filter?: string}} [opts]
   * @returns {number}
   */
  addStream(dictBody, data, opts) {
    return this.add(this.streamBody(dictBody, data, opts));
  }

  /**
   * Serializes the document.
   * @param {string} trailerBody trailer dictionary entries besides /Size (e.g. `/Root 1 0 R /Info 2 0 R`)
   * @returns {Uint8Array}
   */
  finish(trailerBody) {
    const parts = [HEADER];
    let pos = HEADER.length;
    const n = this.objs.length;
    const offsets = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const body = this.objs[i];
      if (!body) throw new Error('PDF object ' + i + ' was reserved but never written');
      offsets[i] = pos;
      const head = latin1(`${i} 0 obj\n`);
      parts.push(head);
      pos += head.length;
      for (const piece of body) {
        const b = typeof piece === 'string' ? latin1(piece) : piece;
        parts.push(b);
        pos += b.length;
      }
      const tail = latin1('\nendobj\n');
      parts.push(tail);
      pos += tail.length;
    }
    let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
    for (let i = 1; i < n; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    const idHex = fingerprint(parts);
    xref += `trailer\n<< /Size ${n} ${trailerBody} /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(latin1(xref));
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/**
 * 128 bit FNV-style fingerprint of the file content (used for the trailer /ID so output is deterministic).
 * @param {Uint8Array[]} parts
 * @returns {string} 32 hex digits
 */
function fingerprint(parts) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0xdeadbeef;
  let h4 = 0x12345678;
  for (const p of parts) {
    const step = p.length > 4096 ? 7 : 1;
    for (let i = 0; i < p.length; i += step) {
      const c = p[i];
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
      h3 = Math.imul(h3 ^ (c + i), 3266489917);
      h4 = (Math.imul(h4, 668265263) + c) | 0;
    }
    h1 ^= p.length;
  }
  const hex = (v) => (v >>> 0).toString(16).padStart(8, '0');
  return (hex(h1) + hex(h2) + hex(h3) + hex(h4)).toUpperCase();
}
