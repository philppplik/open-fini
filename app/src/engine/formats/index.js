// File-format engines: Photoshop PSD/PSB, InDesign IDML, and format sniffing.
export { readPsd, writePsd } from './psd.js';
export { readIdml, parseXml } from './idml.js';

const INDD_MAGIC = [0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d];

function startsWith(bytes, str, at = 0) {
  if (bytes.length < at + str.length) return false;
  for (let i = 0; i < str.length; i++) if (bytes[at + i] !== str.charCodeAt(i)) return false;
  return true;
}

/** Finds an ASCII needle in bytes[from..to). */
function findAscii(bytes, needle, from, to) {
  const n = needle.length;
  const c0 = needle.charCodeAt(0);
  to = Math.min(to, bytes.length) - n;
  for (let i = Math.max(0, from); i <= to; i++) {
    if (bytes[i] !== c0) continue;
    let k = 1;
    while (k < n && bytes[i + k] === needle.charCodeAt(k)) k++;
    if (k === n) return i;
  }
  return -1;
}

/**
 * Detects a document format from magic bytes and, where there is no magic, from the file name.
 * @param {Uint8Array} bytes
 * @param {string} [name] file name (only the extension is used)
 * @returns {'psd'|'psb'|'idml'|'ai'|'indd'|'afdesign'|'afphoto'|'afpub'|'pdf'|'svg'|'unknown'}
 */
export function sniffFormat(bytes, name = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(String(name || '')) || [, ''])[1].toLowerCase();
  if (bytes && bytes.length >= 4) {
    if (startsWith(bytes, '8BPS')) {
      const v = bytes.length >= 6 ? (bytes[4] << 8) | bytes[5] : 1;
      return v === 2 ? 'psb' : 'psd';
    }
    if (bytes.length >= 16 && INDD_MAGIC.every((b, i) => bytes[i] === b)) return 'indd';
    if (startsWith(bytes, '%PDF')) {
      if (ext === 'ai' || findAscii(bytes, 'Adobe Illustrator', 0, 8192) >= 0) return 'ai';
      return 'pdf';
    }
    if (startsWith(bytes, '%!PS-Adobe')) {
      if (ext === 'ai' || findAscii(bytes, 'Illustrator', 0, 2048) >= 0) return 'ai';
      return 'unknown';
    }
    if (startsWith(bytes, 'PK')) {
      if (ext === 'idml') return 'idml';
      const mime = 'application/vnd.adobe.indesign-idml-package';
      if (startsWith(bytes, 'mimetype', 30) && startsWith(bytes, mime, 38)) return 'idml';
      if (findAscii(bytes, 'designmap.xml', 0, 65536) >= 0 || findAscii(bytes, 'designmap.xml', bytes.length - 262144, bytes.length) >= 0) return 'idml';
    }
  }
  if (ext === 'afdesign' || ext === 'afphoto' || ext === 'afpub') return ext;
  if (ext === 'svg') return 'svg';
  if (bytes && bytes.length >= 4) {
    // text sniffing for SVG
    let i = 0;
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
    const head = bytes.subarray(i, Math.min(bytes.length, i + 2048));
    let s = '';
    for (let k = 0; k < head.length; k++) s += String.fromCharCode(head[k]);
    s = s.trimStart();
    if ((s.startsWith('<?xml') || s.startsWith('<svg') || s.startsWith('<!--') || s.startsWith('<!DOCTYPE svg')) && /<svg[\s>]/.test(s)) return 'svg';
  }
  return 'unknown';
}
