// Byte-level PSD/PSB fixture assembler for tests. Deliberately independent of the engine's writer so the
// reader is exercised against separately written bytes.
import { zlibSync } from '../../app/vendor/fflate/fflate.js';

export class B {
  constructor() {
    this.a = [];
  }
  get length() { return this.a.length; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { return this.u8(v >> 8).u8(v); }
  i16(v) { return this.u16(v & 0xffff); }
  u32(v) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
  i32(v) { return this.u32(v | 0); }
  u64(v) { return this.u32(Math.floor(v / 4294967296)).u32(v >>> 0); }
  f64(v) {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.u8(d.getUint8(i));
    return this;
  }
  ascii(s) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  bytes(arr) { for (const v of arr) this.a.push(v); return this; }
  utf16(s) { this.u32(s.length); for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i)); return this; }
  pad(n) { while (this.a.length % n) this.u8(0); return this; }
  done() { return Uint8Array.from(this.a); }
}

/** Simple independent PackBits encoder. */
export function packRow(row) {
  const out = [];
  let i = 0;
  while (i < row.length) {
    let run = 1;
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 2) {
      out.push(257 - run, row[i]);
      i += run;
    } else {
      const lit = [row[i]];
      i++;
      while (i < row.length && lit.length < 128 && !(i + 1 < row.length && row[i] === row[i + 1])) lit.push(row[i++]);
      out.push(lit.length - 1, ...lit);
    }
  }
  return out;
}

/** Channel data (compression field included) encoders. `plane` is raw big-endian sample bytes, rb bytes per row. */
export const enc = {
  raw: (plane) => [0, 0, ...plane],
  rle: (plane, h, psb = false) => {
    const rb = plane.length / h;
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(packRow(plane.slice(y * rb, (y + 1) * rb)));
    const b = new B().u16(1);
    for (const r of rows) psb ? b.u32(r.length) : b.u16(r.length);
    for (const r of rows) b.bytes(r);
    return b.a;
  },
  zip: (plane) => [0, 2, ...zlibSync(Uint8Array.from(plane))],
  /** ZIP with prediction. depth 8: byte deltas; depth 16: 16-bit word deltas. */
  zipPred: (plane, w, h, depth) => {
    const rb = plane.length / h;
    const out = new Uint8Array(plane.length);
    for (let y = 0; y < h; y++) {
      const o = y * rb;
      if (depth === 16) {
        let prev = 0;
        for (let x = 0; x < w; x++) {
          const v = (plane[o + 2 * x] << 8) | plane[o + 2 * x + 1];
          const d = (v - prev) & 0xffff;
          out[o + 2 * x] = d >> 8;
          out[o + 2 * x + 1] = d & 255;
          prev = v;
        }
      } else {
        let prev = 0;
        for (let x = 0; x < rb; x++) {
          out[o + x] = (plane[o + x] - prev) & 255;
          prev = plane[o + x];
        }
      }
    }
    return [0, 3, ...zlibSync(out)];
  },
};

/**
 * Builds a layer record + returns its channel payloads.
 * L: {top,left,bottom,right, chans:[{id, data:number[] (with compression field)}], blend, opacity, clip, flags, name,
 *     blocks:[[key, bytes]], mask:{top,left,bottom,right,def,flags}|null}
 */
function layerRecord(b, L, psb, blockPad) {
  b.i32(L.top).i32(L.left).i32(L.bottom).i32(L.right);
  b.u16(L.chans.length);
  for (const c of L.chans) {
    b.i16(c.id);
    psb ? b.u64(c.data.length) : b.u32(c.data.length);
  }
  b.ascii('8BIM').ascii(L.blend || 'norm').u8(L.opacity ?? 255).u8(L.clip || 0).u8(L.flags || 0).u8(0);
  const x = new B();
  if (L.mask) {
    const m = L.mask;
    x.u32(20).i32(m.top).i32(m.left).i32(m.bottom).i32(m.right).u8(m.def).u8(m.flags || 0).u8(0).u8(0);
  } else {
    x.u32(0);
  }
  x.u32(0); // blending ranges
  const name = L.name || '';
  x.u8(name.length).ascii(name);
  while (x.length % 4) x.u8(0);
  for (const [key, data] of L.blocks || []) {
    const long = psb && ['LMsk', 'Lr16', 'Lr32', 'Layr'].includes(key);
    x.ascii('8BIM').ascii(key);
    const padded = blockPad === 1 ? data.length : data.length + ((blockPad - (data.length % blockPad)) % blockPad);
    long ? x.u64(padded) : x.u32(padded);
    x.bytes(data);
    for (let i = data.length; i < padded; i++) x.u8(0);
  }
  b.u32(x.length).bytes(x.a);
}

export function sectionBlock(type, blendKey) {
  const b = new B().u32(type);
  if (blendKey) b.ascii('8BIM').ascii(blendKey);
  return b.a;
}

/**
 * Assembles a complete PSD/PSB.
 * @param {object} o {psb,width,height,depth,mode,nch,colorModeData:number[],layers:[],composite:number[]|null,
 *                    blockPad,layerKey:'Lr16'|null, negativeCount}
 */
export function buildPsd(o) {
  const psb = !!o.psb;
  const b = new B();
  b.ascii('8BPS').u16(psb ? 2 : 1).bytes([0, 0, 0, 0, 0, 0]).u16(o.nch ?? 3).u32(o.height).u32(o.width).u16(o.depth ?? 8).u16(o.mode ?? 3);
  const cm = o.colorModeData || [];
  b.u32(cm.length).bytes(cm);
  b.u32(0); // image resources
  const layers = o.layers || [];
  const li = new B();
  if (layers.length) {
    li.i16(o.negativeCount ? -layers.length : layers.length);
    for (const L of layers) layerRecord(li, L, psb, o.blockPad ?? 4);
    for (const L of layers) for (const c of L.chans) li.bytes(c.data);
    li.pad(2);
  }
  const lm = new B();
  if (o.layerKey) {
    psb ? lm.u64(0) : lm.u32(0);
    lm.u32(0); // global mask info
    const blk = li.a;
    lm.ascii('8BIM').ascii(o.layerKey);
    psb ? lm.u64(blk.length) : lm.u32(blk.length);
    lm.bytes(blk);
  } else {
    psb ? lm.u64(li.length) : lm.u32(li.length);
    lm.bytes(li.a);
    lm.u32(0);
  }
  if (layers.length || o.layerKey || o.forceSection) {
    psb ? b.u64(lm.length) : b.u32(lm.length);
    b.bytes(lm.a);
  } else {
    psb ? b.u64(0) : b.u32(0);
  }
  if (o.composite) b.bytes(o.composite);
  return b.done();
}

/** 8-bit planes helper. */
export const fill = (n, v) => new Array(n).fill(v);
