/**
 * Structural PDF checker used by the PDF tests (not a test file itself).
 *
 * Verifies: header and EOF marker, startxref -> xref table, one 20-byte xref entry per object, every offset points at
 * "N 0 obj", every stream /Length is exact and followed by endstream/endobj, every indirect reference resolves, the
 * trailer (/Size, /Root, /Info, /ID), and the page tree (/Count equals the number of /Page leaves, every /Parent is
 * right).
 */
import { unzlibSync } from '../../app/vendor/fflate/fflate.js';

/** @param {Uint8Array} b */
export function latin1Str(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return s;
}

/**
 * @typedef {{num:number, offset:number, dict:string, stream:Uint8Array|null, filter:string|null}} PdfObj
 */

/**
 * @param {Uint8Array} bytes
 * @returns {{objects: Map<number, PdfObj>, trailer: string, errors: string[], size: number, text: string}}
 */
export function parsePdf(bytes) {
  const errors = [];
  const text = latin1Str(bytes);
  const err = (m) => errors.push(m);
  if (!/^%PDF-1\.[3-7]\n/.test(text)) err('missing %PDF-1.x header');
  if (!text.endsWith('%%EOF\n')) err('missing %%EOF');
  const sx = text.lastIndexOf('startxref');
  const objects = new Map();
  let trailer = '';
  let size = 0;
  if (sx < 0) {
    err('no startxref');
    return { objects, trailer, errors, size, text };
  }
  const xrefOffset = parseInt(text.slice(sx + 10), 10);
  if (text.slice(xrefOffset, xrefOffset + 5) !== 'xref\n') err('startxref does not point at "xref"');
  const m = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset, xrefOffset + 40));
  if (!m) {
    err('bad xref subsection header');
    return { objects, trailer, errors, size, text };
  }
  size = parseInt(m[1], 10);
  let p = xrefOffset + m[0].length;
  const offsets = [];
  for (let i = 0; i < size; i++) {
    const entry = text.slice(p, p + 20);
    if (!/^\d{10} \d{5} [nf] \n$/.test(entry)) err(`xref entry ${i} malformed: ${JSON.stringify(entry)}`);
    offsets.push({ off: parseInt(entry.slice(0, 10), 10), type: entry[17] });
    p += 20;
  }
  if (offsets[0].type !== 'f') err('xref entry 0 must be free');
  if (!text.startsWith('trailer\n', p)) err('trailer keyword not directly after the xref table');
  trailer = text.slice(p + 8, sx);
  if (!/\/Size (\d+)/.test(trailer) || parseInt(/\/Size (\d+)/.exec(trailer)[1], 10) !== size) err('trailer /Size mismatch');
  for (let i = 1; i < size; i++) {
    const { off, type } = offsets[i];
    if (type !== 'n') err(`object ${i} not in use`);
    const head = `${i} 0 obj\n`;
    if (!text.startsWith(head, off)) {
      err(`offset of object ${i} (${off}) does not point at "${i} 0 obj"`);
      continue;
    }
    const bodyStart = off + head.length;
    const sm = text.indexOf('\nstream\n', bodyStart);
    const em = text.indexOf('\nendobj\n', bodyStart);
    let dict;
    let stream = null;
    let filter = null;
    if (sm >= 0 && (em < 0 || sm < em)) {
      dict = text.slice(bodyStart, sm);
      const lm = /\/Length (\d+)/.exec(dict);
      if (!lm) {
        err(`stream object ${i} has no direct /Length`);
        continue;
      }
      const len = parseInt(lm[1], 10);
      const dataStart = sm + 8;
      if (text.slice(dataStart + len, dataStart + len + 18) !== '\nendstream\nendobj\n') err(`stream object ${i}: /Length ${len} does not end at endstream`);
      stream = bytes.subarray(dataStart, dataStart + len);
      const fm = /\/Filter (\/\w+)/.exec(dict);
      filter = fm ? fm[1] : null;
    } else {
      if (em < 0) {
        err(`object ${i} has no endobj`);
        continue;
      }
      dict = text.slice(bodyStart, em);
    }
    objects.set(i, { num: i, offset: off, dict, stream, filter });
  }
  // references
  const checkRefs = (s, where) => {
    const re = /(\d+) 0 R/g;
    let r;
    while ((r = re.exec(s))) {
      const n = parseInt(r[1], 10);
      if (n < 1 || n >= size) err(`${where}: reference ${n} 0 R out of range`);
    }
  };
  for (const o of objects.values()) checkRefs(o.dict, `object ${o.num}`);
  checkRefs(trailer, 'trailer');
  for (const key of ['Root', 'Info']) if (!new RegExp(`/${key} \\d+ 0 R`).test(trailer)) err(`trailer lacks /${key}`);
  if (!/\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/.test(trailer)) err('trailer /ID malformed');
  // page tree
  const rootM = /\/Root (\d+) 0 R/.exec(trailer);
  if (rootM) {
    const cat = objects.get(parseInt(rootM[1], 10));
    if (!cat || !/\/Type \/Catalog/.test(cat.dict)) err('Root is not a Catalog');
    else {
      const pm = /\/Pages (\d+) 0 R/.exec(cat.dict);
      const pages = pm && objects.get(parseInt(pm[1], 10));
      if (!pages) err('Catalog has no Pages');
      else {
        const kids = [...(/\/Kids \[([^\]]*)\]/.exec(pages.dict) || [, ''])[1].matchAll(/(\d+) 0 R/g)].map((k) => parseInt(k[1], 10));
        const cnt = parseInt((/\/Count (\d+)/.exec(pages.dict) || [, '-1'])[1], 10);
        if (cnt !== kids.length) err(`/Count ${cnt} != ${kids.length} kids`);
        for (const k of kids) {
          const pg = objects.get(k);
          if (!pg || !/\/Type \/Page\b/.test(pg.dict)) err(`kid ${k} is not a Page`);
          else if (!new RegExp(`/Parent ${pages.num} 0 R`).test(pg.dict)) err(`page ${k} has the wrong /Parent`);
        }
      }
    }
  }
  return { objects, trailer, errors, size, text };
}

/**
 * Stream content of an object, decompressed when it uses FlateDecode.
 * @param {PdfObj} o
 * @returns {Uint8Array}
 */
export function streamBytes(o) {
  if (!o.stream) throw new Error('not a stream');
  return o.filter === '/FlateDecode' ? unzlibSync(o.stream) : o.stream;
}

/**
 * @param {Map<number, PdfObj>} objects
 * @param {string} trailer
 * @returns {PdfObj[]} page objects in order
 */
export function pageObjects(objects, trailer) {
  const root = objects.get(parseInt(/\/Root (\d+) 0 R/.exec(trailer)[1], 10));
  const pages = objects.get(parseInt(/\/Pages (\d+) 0 R/.exec(root.dict)[1], 10));
  return [...(/\/Kids \[([^\]]*)\]/.exec(pages.dict)[1]).matchAll(/(\d+) 0 R/g)].map((k) => objects.get(parseInt(k[1], 10)));
}

/**
 * Content stream text of a page (all /Contents streams joined).
 * @param {Map<number, PdfObj>} objects
 * @param {PdfObj} page
 * @returns {string}
 */
export function pageContent(objects, page) {
  const c = /\/Contents (\d+) 0 R/.exec(page.dict);
  return latin1Str(streamBytes(objects.get(parseInt(c[1], 10))));
}

/**
 * Asserts a structurally valid PDF and returns the parsed form.
 * @param {Uint8Array} bytes
 */
export function checkPdf(bytes) {
  const r = parsePdf(bytes);
  if (r.errors.length) throw new Error('PDF structure errors:\n' + r.errors.join('\n'));
  return r;
}
