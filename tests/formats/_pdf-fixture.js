// Hand-built PDF files for the import tests. Independent of OpenFini's PDF writer on purpose: the importer is
// exercised against separately written bytes (classic xref, object streams + xref streams, Flate, RC4-40).
import { createHash } from 'node:crypto';
import { zlibSync } from '../../app/vendor/fflate/fflate.js';

const enc = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
};
const concat = (parts) => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 255;
    b = (b + s[a]) & 255;
    [s[a], s[b]] = [s[b], s[a]];
    out[k] = data[k] ^ s[(s[a] + s[b]) & 255];
  }
  return out;
}

const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
const md5 = (b) => new Uint8Array(createHash('md5').update(b).digest());
const padPw = (pw) => concat([enc(pw), PAD]).subarray(0, 32);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Standard security handler, revision 2 (RC4, 40 bit). */
function makeRc4Encryption(userPw, ownerPw, id) {
  const P = -4;
  const O = rc4(md5(padPw(ownerPw || userPw)).subarray(0, 5), padPw(userPw));
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, P, true);
  const key = md5(concat([padPw(userPw), O, p, id])).subarray(0, 5);
  const U = rc4(key, PAD);
  return {
    dict: `<< /Filter /Standard /V 1 /R 2 /O <${hex(O)}> /U <${hex(U)}> /P ${P} >>`,
    encryptStream(num, gen, data) {
      const k = md5(concat([key, Uint8Array.of(num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255)])).subarray(0, 10);
      return rc4(k, data);
    },
  };
}

/**
 * Minimal PDF assembler.
 *   const b = new PdfBuilder();
 *   const font = b.add('<< /Type /Font ... >>');
 *   const pg = b.addPage({ mediaBox: [0,0,200,200], content: '...', resources: '<< ... >>' });
 *   const bytes = b.finish({ objStm: true, encrypt: { user: '' } });
 */
export class PdfBuilder {
  constructor() {
    this.objs = [null];
    this.pages = [];
    this.pagesNum = this.reserve();
  }
  reserve() {
    this.objs.push(null);
    return this.objs.length - 1;
  }
  set(num, body) {
    this.objs[num] = { body };
    return num;
  }
  /** Adds a dictionary / array / number object given as PDF syntax. */
  add(body) {
    return this.set(this.reserve(), body);
  }
  /** Adds a stream. `dict` is the extra dictionary entries (without << >>). */
  addStream(dict, data, { flate = false } = {}) {
    const raw = typeof data === 'string' ? enc(data) : data;
    const body = flate ? zlibSync(raw) : raw;
    const num = this.reserve();
    this.objs[num] = { dict: `${dict || ''}${flate ? ' /Filter /FlateDecode' : ''}`, stream: body };
    return num;
  }
  addPage({ mediaBox = [0, 0, 200, 200], cropBox = null, rotate = 0, content = '', resources = '<< >>', extra = '', flate = true } = {}) {
    const c = this.addStream('', content, { flate });
    const pg = this.add(
      `<< /Type /Page /Parent ${this.pagesNum} 0 R /MediaBox [${mediaBox.join(' ')}]${cropBox ? ` /CropBox [${cropBox.join(' ')}]` : ''}${rotate ? ` /Rotate ${rotate}` : ''} /Resources ${resources} /Contents ${c} 0 R ${extra} >>`,
    );
    this.pages.push(pg);
    return pg;
  }
  finish({ objStm = false, encrypt = null, info = null } = {}) {
    this.set(this.pagesNum, `<< /Type /Pages /Kids [${this.pages.map((p) => `${p} 0 R`).join(' ')}] /Count ${this.pages.length} >>`);
    const root = this.add(`<< /Type /Catalog /Pages ${this.pagesNum} 0 R >>`);
    const id = enc('OpenFiniTestId000');
    let enc_ = null;
    let encNum = 0;
    if (encrypt) {
      enc_ = makeRc4Encryption(encrypt.user || '', encrypt.owner || 'owner', id);
      encNum = this.add(enc_.dict);
    }
    const infoNum = info ? this.add(info) : 0;
    const total = this.objs.length;
    const out = [enc('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n')];
    let pos = out[0].length;
    const offsets = new Array(total).fill(0);
    const writeObj = (num) => {
      const o = this.objs[num];
      offsets[num] = pos;
      let bytes;
      if (o.stream) {
        const data = enc_ && num !== encNum ? enc_.encryptStream(num, 0, o.stream) : o.stream;
        bytes = concat([enc(`${num} 0 obj\n<< ${o.dict} /Length ${data.length} >>\nstream\n`), data, enc('\nendstream\nendobj\n')]);
      } else bytes = enc(`${num} 0 obj\n${o.body}\nendobj\n`);
      out.push(bytes);
      pos += bytes.length;
    };
    if (!objStm) {
      for (let n = 1; n < total; n++) writeObj(n);
      const xrefPos = pos;
      let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
      for (let n = 1; n < total; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
      x += `trailer\n<< /Size ${total} /Root ${root} 0 R${encNum ? ` /Encrypt ${encNum} 0 R` : ''}${infoNum ? ` /Info ${infoNum} 0 R` : ''} /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${xrefPos}\n%%EOF\n`;
      out.push(enc(x));
      return concat(out);
    }
    // object streams: pack every non-stream object (except the encryption dictionary) into one ObjStm
    const packed = [];
    for (let n = 1; n < total; n++) if (!this.objs[n].stream && n !== encNum) packed.push(n);
    for (let n = 1; n < total; n++) if (this.objs[n].stream || n === encNum) writeObj(n);
    const osNum = total;
    const header = [];
    let body = '';
    for (const n of packed) {
      header.push(`${n} ${body.length}`);
      body += `${this.objs[n].body}\n`;
    }
    const head = `${header.join(' ')}\n`;
    const osData = zlibSync(enc(head + body));
    offsets[osNum] = pos;
    const osObj = concat([enc(`${osNum} 0 obj\n<< /Type /ObjStm /N ${packed.length} /First ${head.length} /Filter /FlateDecode /Length ${osData.length} >>\nstream\n`), osData, enc('\nendstream\nendobj\n')]);
    out.push(osObj);
    pos += osObj.length;
    const xrefNum = osNum + 1;
    const xrefPos = pos;
    const size = xrefNum + 1;
    const rows = new Uint8Array(size * 6);
    const dv2 = new DataView(rows.buffer);
    const put = (n, t, a, b) => {
      dv2.setUint8(n * 6, t);
      dv2.setUint32(n * 6 + 1, a);
      dv2.setUint8(n * 6 + 5, b);
    };
    put(0, 0, 0, 255);
    for (let n = 1; n < total; n++) {
      const idx = packed.indexOf(n);
      if (idx >= 0) put(n, 2, osNum, idx);
      else put(n, 1, offsets[n], 0);
    }
    put(osNum, 1, offsets[osNum], 0);
    put(xrefNum, 1, xrefPos, 0);
    const xdata = zlibSync(rows);
    out.push(
      concat([
        enc(`${xrefNum} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 1] /Root ${root} 0 R${encNum ? ` /Encrypt ${encNum} 0 R` : ''}${infoNum ? ` /Info ${infoNum} 0 R` : ''} /ID [<${hex(id)}> <${hex(id)}>] /Filter /FlateDecode /Length ${xdata.length} >>\nstream\n`),
        xdata,
        enc(`\nendstream\nendobj\nstartxref\n${xrefPos}\n%%EOF\n`),
      ]),
    );
    return concat(out);
  }
}

/** A standard Helvetica font dictionary (WinAnsi). */
export function helvetica(b, name = 'Helvetica') {
  return b.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
}

/** Convenience: one page, one standard font F1, plus raw content. */
export function simplePdf(content, { mediaBox, rotate, cropBox, resourcesExtra = '', objStm = false, encrypt = null, setup = null } = {}) {
  const b = new PdfBuilder();
  const f1 = helvetica(b);
  const f2 = helvetica(b, 'Times-Bold');
  const extra = setup ? setup(b) : '';
  b.addPage({ mediaBox, rotate, cropBox, content, resources: `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> ${resourcesExtra} ${extra || ''} >>` });
  return b.finish({ objStm, encrypt });
}

export { enc as latin1, concat };
