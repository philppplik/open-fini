// Photoshop PSD / PSB reader and writer.
//
// Clean-room implementation from Adobe's published "Adobe Photoshop File Formats Specification".
// Pure module: no DOM, no Canvas, no ImageData. Runs in Node 20+, browsers and workers.
//
// Reader: PSD (version 1) and PSB (version 2), 1/8/16/32 bit, bitmap / grayscale / indexed / RGB / CMYK / Lab,
// raw / RLE / ZIP / ZIP-with-prediction channels, layers, groups, masks, text layers, merged composite.
// Writer: 8-bit RGB PSD with layers, groups, unicode names, blend modes, opacity, visibility and a composite.

import { unzlibSync } from '../../../vendor/fflate/fflate.js';
import { cmykToRgb, labToRgb } from './color.js';

/**
 * @typedef {Object} PsdMask
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data 0..255 alpha, width*height
 * @property {boolean} [disabled] the mask is switched off in the source file
 *
 * @typedef {Object} PsdText
 * @property {string} content
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [fontSize]
 * @property {string} [color]
 *
 * @typedef {Object} PsdLayer
 * @property {string} name
 * @property {'pixel'|'group'|'text'|'adjustment'|'other'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray|null} rgba
 * @property {number} opacity 0..1 (opacity * fill opacity)
 * @property {string} blend
 * @property {boolean} visible
 * @property {boolean} [locked]
 * @property {boolean} clipping
 * @property {PsdMask|null} mask
 * @property {number} groupDepth
 * @property {number} parentIndex
 * @property {PsdText} [text]
 *
 * @typedef {Object} PsdDocument
 * @property {number} width
 * @property {number} height
 * @property {number} depth
 * @property {'rgb'|'grayscale'|'cmyk'|'indexed'|'lab'|'bitmap'|'other'} colorMode
 * @property {1|2} version
 * @property {PsdLayer[]} layers
 * @property {{width:number,height:number,data:Uint8ClampedArray}|null} composite
 * @property {string[]} warnings
 */

const MODE_NAMES = { 0: 'bitmap', 1: 'grayscale', 2: 'indexed', 3: 'rgb', 4: 'cmyk', 7: 'other', 8: 'other', 9: 'lab' };
const MODE_COLOR_CHANNELS = { 0: 1, 1: 1, 2: 1, 3: 3, 4: 4, 7: 1, 8: 1, 9: 3 };

const BLEND_BY_KEY = {
  norm: 'normal', mul: 'multiply', scrn: 'screen', over: 'overlay', dark: 'darken', lite: 'lighten',
  div: 'color-dodge', idiv: 'color-burn', hLit: 'hard-light', sLit: 'soft-light', diff: 'difference',
  smud: 'exclusion', hue: 'hue', sat: 'saturation', colr: 'color', lum: 'luminosity', pass: 'pass-through',
  diss: 'dissolve', lbrn: 'linear-burn', lddg: 'linear-dodge', vLit: 'vivid-light', lLit: 'linear-light',
  pLit: 'pin-light', hMix: 'hard-mix', fsub: 'subtract', fdiv: 'divide', dkCl: 'darker-color', lgCl: 'lighter-color',
};
const KEY_BY_BLEND = {};
for (const k of Object.keys(BLEND_BY_KEY)) KEY_BY_BLEND[BLEND_BY_KEY[k]] = k.length < 4 ? k + ' ' : k;

/** Additional-info keys whose length field is 8 bytes in a PSB. */
const PSB_LONG_KEYS = new Set(['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD']);
const ADJUSTMENT_KEYS = new Set([
  'brit', 'levl', 'curv', 'expA', 'vibA', 'hue ', 'hue2', 'blnc', 'blwh', 'phfl', 'mixr', 'clrL', 'nvrt', 'post', 'thrs',
  'grdm', 'selc', 'SoCo', 'GdFl', 'PtFl',
]);
const SMART_KEYS = new Set(['SoLd', 'SoLE', 'PlLd', 'plLd']);
const EFFECT_KEYS = new Set(['lrFX', 'lfx2', 'lmfx', 'lfxs']);

// ---------------------------------------------------------------------------------------------------------------
// binary reader
// ---------------------------------------------------------------------------------------------------------------

class Reader {
  /** @param {Uint8Array} b */
  constructor(b) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.p = 0;
    this.len = b.length;
  }
  need(n) {
    if (n < 0 || this.p + n > this.len) throw new Error(`PSD: unexpected end of file at offset ${this.p} (need ${n} more bytes)`);
  }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  i16() { this.need(2); const v = this.dv.getInt16(this.p); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p); this.p += 4; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.p); this.p += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p); this.p += 8; return v; }
  u64() {
    this.need(8);
    const hi = this.dv.getUint32(this.p);
    const lo = this.dv.getUint32(this.p + 4);
    this.p += 8;
    return hi * 4294967296 + lo;
  }
  skip(n) { this.need(n); this.p += n; }
  bytes(n) { this.need(n); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  ascii(n) {
    this.need(n);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.p + i]);
    this.p += n;
    return s;
  }
}

/** Decodes `n` UTF-16BE code units at the reader position. */
function readUtf16(r, n) {
  if (n * 2 > r.len - r.p) throw new Error('PSD: string exceeds block');
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(r.u16());
  let e = s.length;
  while (e > 0 && s.charCodeAt(e - 1) === 0) e--;
  return s.slice(0, e);
}

function decodePascal(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// channel decoding
// ---------------------------------------------------------------------------------------------------------------

function rowBytes(w, depth) {
  return depth === 1 ? (w + 7) >> 3 : (w * depth) >> 3;
}

/** PackBits decode of one scanline. */
function unpackBits(src, sp, spEnd, dst, dp, dpEnd) {
  while (sp < spEnd && dp < dpEnd) {
    const n = src[sp++];
    if (n < 128) {
      let c = n + 1;
      if (sp + c > spEnd) c = spEnd - sp;
      if (dp + c > dpEnd) c = dpEnd - dp;
      dst.set(src.subarray(sp, sp + c), dp);
      sp += c;
      dp += c;
    } else if (n > 128) {
      if (sp >= spEnd) break;
      const v = src[sp++];
      let c = 257 - n;
      if (dp + c > dpEnd) c = dpEnd - dp;
      dst.fill(v, dp, dp + c);
      dp += c;
    }
  }
}

function undoPrediction(out, w, h, depth) {
  const rb = rowBytes(w, depth);
  if (depth === 16) {
    for (let y = 0; y < h; y++) {
      let o = y * rb;
      let prev = (out[o] << 8) | out[o + 1];
      for (let x = 1; x < w; x++) {
        o += 2;
        prev = (prev + ((out[o] << 8) | out[o + 1])) & 0xffff;
        out[o] = prev >> 8;
        out[o + 1] = prev & 255;
      }
    }
  } else if (depth === 32) {
    const tmp = new Uint8Array(rb);
    for (let y = 0; y < h; y++) {
      const o = y * rb;
      for (let x = 1; x < rb; x++) out[o + x] = (out[o + x] + out[o + x - 1]) & 255;
      for (let x = 0; x < w; x++) {
        tmp[4 * x] = out[o + x];
        tmp[4 * x + 1] = out[o + w + x];
        tmp[4 * x + 2] = out[o + 2 * w + x];
        tmp[4 * x + 3] = out[o + 3 * w + x];
      }
      out.set(tmp, o);
    }
  } else {
    for (let y = 0; y < h; y++) {
      const o = y * rb;
      for (let x = 1; x < rb; x++) out[o + x] = (out[o + x] + out[o + x - 1]) & 255;
    }
  }
}

/**
 * Decodes one channel plane (without the 2-byte compression field) to its raw big-endian samples.
 * @returns {Uint8Array} rowBytes(w)*h bytes
 */
function decodeRaw(data, comp, w, h, depth, psb) {
  const rb = rowBytes(w, depth);
  const total = rb * h;
  if (comp === 0) {
    if (data.length < total) throw new Error('truncated raw channel data');
    return data.subarray(0, total);
  }
  if (comp === 1) {
    const tsz = h * (psb ? 4 : 2);
    if (data.length < tsz) throw new Error('truncated RLE row table');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let sum = 0;
    for (let y = 0; y < h; y++) sum += psb ? dv.getUint32(y * 4) : dv.getUint16(y * 2);
    if (sum > data.length - tsz) throw new Error('truncated RLE channel data');
    if (total > sum * 64) throw new Error('RLE channel data is smaller than the image requires');
    const out = new Uint8Array(total);
    let pos = tsz;
    for (let y = 0; y < h; y++) {
      const cnt = psb ? dv.getUint32(y * 4) : dv.getUint16(y * 2);
      unpackBits(data, pos, pos + cnt, out, y * rb, (y + 1) * rb);
      pos += cnt;
    }
    return out;
  }
  if (comp === 2 || comp === 3) {
    if (total > data.length * 1100 + 1024) throw new Error('ZIP channel data is smaller than the image requires');
    const out = new Uint8Array(total);
    let res;
    try {
      res = unzlibSync(data, { out });
    } catch (e) {
      throw new Error('invalid ZIP channel data: ' + (e && e.message ? e.message : e));
    }
    const full = res.length === total ? res : out;
    if (comp === 3) undoPrediction(full, w, h, depth);
    return full;
  }
  throw new Error('unknown compression method ' + comp);
}

/** Converts raw samples of any depth to 8 bit, w*h bytes. */
function to8(raw, w, h, depth) {
  if (depth === 8) return raw;
  const out = new Uint8Array(w * h);
  if (depth === 16) {
    for (let i = 0, j = 0; i < out.length; i++, j += 2) {
      const v = ((raw[j] << 8) | raw[j + 1]) + 128;
      out[i] = v >= 65536 ? 255 : v >> 8;
    }
  } else if (depth === 32) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < out.length; i++) {
      const v = dv.getFloat32(i * 4);
      out[i] = v >= 1 ? 255 : v > 0 ? Math.round(v * 255) : 0;
    }
  } else if (depth === 1) {
    const rb = (w + 7) >> 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] = (raw[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
    }
  } else {
    throw new Error('unsupported depth ' + depth);
  }
  return out;
}

/**
 * Builds a non-premultiplied RGBA image from per-channel 8-bit planes.
 * @param {Record<number, Uint8Array>} ch channel id -> plane
 */
function buildRgba(ch, w, h, mode, palette, warned) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const a = ch[-1];
  const c0 = ch[0], c1 = ch[1], c2 = ch[2], c3 = ch[3];
  if (!c0) return out;
  if (mode === 3) {
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      out[o] = c0[i];
      out[o + 1] = c1 ? c1[i] : 0;
      out[o + 2] = c2 ? c2[i] : 0;
      out[o + 3] = a ? a[i] : 255;
    }
  } else if (mode === 4) {
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      // Photoshop stores CMYK inverted: 255 means no ink.
      const k = c3 ? c3[i] : 255;
      out[o] = (c0[i] * k + 127) / 255;
      out[o + 1] = ((c1 ? c1[i] : 255) * k + 127) / 255;
      out[o + 2] = ((c2 ? c2[i] : 255) * k + 127) / 255;
      out[o + 3] = a ? a[i] : 255;
    }
  } else if (mode === 2) {
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const p = c0[i] * 3;
      out[o] = palette ? palette[p] : c0[i];
      out[o + 1] = palette ? palette[p + 1] : c0[i];
      out[o + 2] = palette ? palette[p + 2] : c0[i];
      out[o + 3] = a ? a[i] : 255;
    }
  } else if (mode === 9) {
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const rgb = labToRgb((c0[i] * 100) / 255, (c1 ? c1[i] : 128) - 128, (c2 ? c2[i] : 128) - 128);
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = a ? a[i] : 255;
    }
  } else {
    if (mode !== 1 && mode !== 0 && warned && !warned.done) {
      warned.done = true;
      warned.list.push('Multichannel/duotone image: only the first channel is shown as grayscale.');
    }
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const g = c0[i];
      out[o] = g;
      out[o + 1] = g;
      out[o + 2] = g;
      out[o + 3] = a ? a[i] : 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// descriptors (used by text layers)
// ---------------------------------------------------------------------------------------------------------------

function readId(r) {
  const n = r.u32();
  return r.ascii(n === 0 ? 4 : n);
}

function readUniString(r) {
  return readUtf16(r, r.u32());
}

function readDescriptor(r, depth) {
  if (depth > 12) throw new Error('descriptor nesting too deep');
  const name = readUniString(r);
  const classId = readId(r);
  const count = r.u32();
  if (count > r.len - r.p) throw new Error('descriptor item count exceeds block');
  /** @type {Record<string, any>} */
  const items = {};
  for (let i = 0; i < count; i++) {
    const key = readId(r);
    const type = r.ascii(4);
    items[key] = readDescValue(r, type, depth + 1);
  }
  return { name, classId, items };
}

function readDescValue(r, type, depth) {
  switch (type) {
    case 'Objc':
    case 'GlbO':
      return readDescriptor(r, depth);
    case 'VlLs': {
      const n = r.u32();
      if (n > r.len - r.p) throw new Error('list count exceeds block');
      const list = [];
      for (let i = 0; i < n; i++) list.push(readDescValue(r, r.ascii(4), depth + 1));
      return list;
    }
    case 'doub': return r.f64();
    case 'UntF': { r.ascii(4); return r.f64(); }
    case 'long': case 'Idnt': case 'indx': return r.i32();
    case 'comp': { r.skip(8); return 0; }
    case 'bool': return r.u8() !== 0;
    case 'TEXT': return readUniString(r);
    case 'enum': { const t = readId(r); const v = readId(r); return t + '.' + v; }
    case 'tdta': { const n = r.u32(); return r.bytes(n); }
    case 'alis': case 'Pth ': { const n = r.u32(); r.skip(n); return null; }
    case 'type': case 'GlbC': case 'Clss': { readUniString(r); return readId(r); }
    case 'prop': { readUniString(r); readId(r); return readId(r); }
    case 'Enmr': { readUniString(r); readId(r); return readId(r); }
    case 'rele': { readUniString(r); readId(r); return r.u32(); }
    case 'name': { readUniString(r); readId(r); return readUniString(r); }
    case 'obj ': {
      const n = r.u32();
      if (n > r.len - r.p) throw new Error('reference count exceeds block');
      for (let i = 0; i < n; i++) readDescValue(r, r.ascii(4), depth + 1);
      return null;
    }
    default:
      throw new Error('unknown descriptor type ' + type);
  }
}

/** Extracts a UTF-16BE `(\xFE\xFF....)` string following the `/Text` key from engine data. */
function engineText(s) {
  const m = /\/Text\s*\(/.exec(s);
  if (!m) return '';
  let i = m.index + m[0].length;
  const bytes = [];
  while (i < s.length) {
    let c = s.charCodeAt(i++);
    if (c === 0x29) break;
    if (c === 0x5c) {
      c = s.charCodeAt(i++);
      if (c === 110) c = 10;
      else if (c === 114) c = 13;
      else if (c === 116) c = 9;
    }
    bytes.push(c & 255);
  }
  let out = '';
  let st = 0;
  if (bytes[0] === 0xfe && bytes[1] === 0xff) st = 2;
  for (let k = st; k + 1 < bytes.length; k += 2) out += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]);
  return out;
}

/** Parses the 'TySh' / 'tySh' block. Best effort, throws on malformed data. */
function parseTypeTool(data) {
  const r = new Reader(data);
  r.u16(); // version
  const xx = r.f64(), xy = r.f64(), yx = r.f64(), yy = r.f64(), tx = r.f64(), ty = r.f64();
  void xy; void yx;
  r.u16(); // text version
  r.u32(); // descriptor version
  const d = readDescriptor(r, 0);
  let content = typeof d.items['Txt '] === 'string' ? d.items['Txt '] : '';
  const eng = d.items.EngineData;
  /** @type {PsdText} */
  const text = { content: '' };
  if (eng instanceof Uint8Array) {
    let s = '';
    const lim = Math.min(eng.length, 1 << 20);
    for (let i = 0; i < lim; i++) s += String.fromCharCode(eng[i]);
    if (!content) content = engineText(s);
    const fs = /\/FontSize\s+(-?[\d.]+)/.exec(s);
    if (fs) {
      const size = parseFloat(fs[1]);
      const scale = Math.abs(yy) > 0 && isFinite(yy) ? Math.abs(yy) : 1;
      if (isFinite(size)) text.fontSize = Math.round(size * scale * 100) / 100;
    }
    const fc = /\/FillColor\s*<<[^>]*?\/Values\s*\[\s*([^\]]+)\]/.exec(s);
    if (fc) {
      const v = fc[1].trim().split(/\s+/).map(Number);
      if (v.length >= 4 && v.every(isFinite)) {
        const h = (f) => Math.max(0, Math.min(255, Math.round(f * 255))).toString(16).padStart(2, '0');
        text.color = '#' + h(v[1]) + h(v[2]) + h(v[3]);
      }
    }
  }
  text.content = content.replace(/\r\n?/g, '\n');
  if (isFinite(tx)) text.x = tx;
  if (isFinite(ty)) text.y = ty;
  void xx;
  return text;
}

// ---------------------------------------------------------------------------------------------------------------
// reader
// ---------------------------------------------------------------------------------------------------------------

/**
 * Reads a PSD or PSB file.
 * @param {Uint8Array} bytes
 * @param {{maxPixels?: number, readComposite?: boolean}} [opts]
 * @returns {PsdDocument}
 */
export function readPsd(bytes, opts = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Error('readPsd: input must be a Uint8Array');
  const maxPixels = opts.maxPixels > 0 ? opts.maxPixels : 150e6;
  const readComposite = opts.readComposite !== false;
  /** @type {string[]} */
  const warnings = [];
  const r = new Reader(bytes);

  if (bytes.length < 26) throw new Error('Not a PSD file: file is too short');
  if (r.ascii(4) !== '8BPS') throw new Error('Not a PSD file: missing 8BPS signature');
  const version = r.u16();
  if (version !== 1 && version !== 2) throw new Error('Unsupported PSD version ' + version);
  const psb = version === 2;
  r.skip(6);
  const channelCount = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const modeId = r.u16();
  const maxDim = psb ? 300000 : 30000;
  if (channelCount < 1 || channelCount > 56) throw new Error('Invalid PSD: bad channel count ' + channelCount);
  if (width < 1 || height < 1 || width > maxDim || height > maxDim) throw new Error(`Invalid PSD: bad dimensions ${width}x${height}`);
  if (depth !== 1 && depth !== 8 && depth !== 16 && depth !== 32) throw new Error('Unsupported PSD bit depth ' + depth);
  if (!(modeId in MODE_NAMES)) throw new Error('Unsupported PSD color mode ' + modeId);
  if (width * height > maxPixels) throw new Error(`PSD canvas ${width}x${height} exceeds the pixel limit (${maxPixels})`);
  const colorMode = MODE_NAMES[modeId];
  if (depth === 32) warnings.push('32-bit float image converted to 8 bit without tone mapping.');
  if (modeId === 7 || modeId === 8) warnings.push(`Color mode ${modeId === 7 ? 'multichannel' : 'duotone'} is read as grayscale.`);

  // color mode data
  const cmLen = r.u32();
  if (cmLen > r.len - r.p) throw new Error('Corrupt PSD: color mode data exceeds file');
  /** @type {Uint8Array|null} */
  let palette = null;
  if (modeId === 2 && cmLen >= 768) {
    const raw = bytes.subarray(r.p, r.p + 768);
    palette = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      palette[i * 3] = raw[i];
      palette[i * 3 + 1] = raw[256 + i];
      palette[i * 3 + 2] = raw[512 + i];
    }
  }
  r.p += cmLen;

  // image resources (skipped)
  const irLen = r.u32();
  if (irLen > r.len - r.p) throw new Error('Corrupt PSD: image resources exceed file');
  r.p += irLen;

  const ctx = { psb, depth, modeId, width, height, palette, maxPixels, warnings, nColor: MODE_COLOR_CHANNELS[modeId] };

  // layer and mask information
  let layers = [];
  let mergedAlpha = false;
  const lmLen = psb ? r.u64() : r.u32();
  let lmEnd = r.p + lmLen;
  let sectionOk = true;
  if (lmEnd > r.len) {
    warnings.push('Layer section is truncated; the file may be incomplete.');
    lmEnd = r.len;
    sectionOk = false;
  }
  if (lmLen > 0) {
    try {
      const liLen = psb ? r.u64() : r.u32();
      let liEnd = r.p + liLen;
      if (liEnd > lmEnd) {
        warnings.push('Layer info length exceeds the layer section; clamped.');
        liEnd = lmEnd;
      }
      /** @type {any[]} */
      let parsed = [];
      if (liLen > 0) {
        const res = parseLayerInfo(r, liEnd, ctx);
        parsed = res.layers;
        mergedAlpha = res.mergedAlpha;
      }
      r.p = liEnd;
      if (r.p + 4 <= lmEnd) {
        const gmLen = r.u32();
        r.p = Math.min(lmEnd, r.p + gmLen);
        // additional layer info at global level (Lr16 / Lr32 / Layr hold the layers for 16/32-bit files)
        while (r.p + 12 <= lmEnd) {
          const sig = r.ascii(4);
          if (sig !== '8BIM' && sig !== '8B64') break;
          const key = r.ascii(4);
          const long = sig === '8B64' || (psb && PSB_LONG_KEYS.has(key));
          const len = long ? r.u64() : r.u32();
          const start = r.p;
          if (start + len > lmEnd) {
            warnings.push(`Global block '${key}' is truncated.`);
            break;
          }
          if ((key === 'Lr16' || key === 'Lr32' || key === 'Layr') && parsed.length === 0 && len > 2) {
            try {
              const res = parseLayerInfo(r, start + len, ctx);
              parsed = res.layers;
              mergedAlpha = res.mergedAlpha;
            } catch (e) {
              warnings.push(`Layer data in '${key}' could not be read: ${e.message}`);
            }
          }
          r.p = nextBlock(bytes, start, len, lmEnd);
        }
      }
      layers = buildLayerList(parsed, ctx);
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      warnings.push('Layer data could not be fully read: ' + e.message);
      sectionOk = false;
    }
  }

  // merged image data
  /** @type {{width:number,height:number,data:Uint8ClampedArray}|null} */
  let composite = null;
  if (readComposite) {
    if (!sectionOk) {
      warnings.push('Composite image skipped because the preceding data is damaged.');
    } else {
      r.p = lmEnd;
      try {
        composite = readCompositeImage(r, ctx, mergedAlpha, channelCount);
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        warnings.push('Composite image could not be read: ' + e.message);
      }
    }
  }

  return { width, height, depth, colorMode, version: /** @type {1|2} */ (version), layers, composite, warnings };
}

/** Picks the start of the next additional-info block, tolerating 1/2/4 byte padding. */
function nextBlock(bytes, start, len, end) {
  const cands = [len, len + (len & 1), (len + 3) & ~3];
  for (const c of cands) {
    const p = start + c;
    if (p > end) continue;
    if (p === end) return p;
    if (p + 4 <= bytes.length && bytes[p] === 0x38 && (bytes[p + 1] === 0x42) && (bytes[p + 2] === 0x49 || bytes[p + 2] === 0x36) && (bytes[p + 3] === 0x4d || bytes[p + 3] === 0x34)) return p;
  }
  return Math.min(end, start + cands[2]);
}

function readCompositeImage(r, ctx, mergedAlpha, channelCount) {
  const { width, height, depth, psb, modeId } = ctx;
  if (r.p + 2 > r.len) throw new Error('no image data section');
  const comp = r.u16();
  const nColor = ctx.nColor;
  if (channelCount < nColor) throw new Error('image has fewer channels than its color mode requires');
  const wantAlpha = mergedAlpha && channelCount > nColor;
  const use = nColor + (wantAlpha ? 1 : 0);
  const rb = rowBytes(width, depth);
  const plane = rb * height;
  const data = r.b.subarray(r.p, r.len);
  /** @type {Uint8Array[]} */
  const planes = [];
  if (comp === 0) {
    if (data.length < plane * use) throw new Error('truncated raw image data');
    for (let c = 0; c < use; c++) planes.push(data.subarray(c * plane, (c + 1) * plane));
  } else if (comp === 1) {
    const tsz = height * channelCount * (psb ? 4 : 2);
    if (data.length < tsz) throw new Error('truncated RLE row table');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const counts = new Array(height * channelCount);
    let sum = 0;
    for (let i = 0; i < counts.length; i++) {
      counts[i] = psb ? dv.getUint32(i * 4) : dv.getUint16(i * 2);
      sum += counts[i];
    }
    if (sum > data.length - tsz) throw new Error('truncated RLE image data');
    if (plane * channelCount > sum * 64) throw new Error('RLE image data is smaller than the image requires');
    let pos = tsz;
    for (let c = 0; c < channelCount; c++) {
      const out = c < use ? new Uint8Array(plane) : null;
      for (let y = 0; y < height; y++) {
        const cnt = counts[c * height + y];
        if (out) unpackBits(data, pos, pos + cnt, out, y * rb, (y + 1) * rb);
        pos += cnt;
      }
      if (out) planes.push(out);
    }
  } else if (comp === 2 || comp === 3) {
    const total = plane * channelCount;
    if (total > data.length * 1100 + 1024) throw new Error('ZIP image data is smaller than the image requires');
    const out = new Uint8Array(total);
    try {
      unzlibSync(data, { out });
    } catch (e) {
      throw new Error('invalid ZIP image data');
    }
    for (let c = 0; c < use; c++) {
      const pl = out.subarray(c * plane, (c + 1) * plane);
      if (comp === 3) undoPrediction(pl, width, height, depth);
      planes.push(pl);
    }
  } else {
    throw new Error('unknown compression method ' + comp);
  }
  /** @type {Record<number, Uint8Array>} */
  const ch = {};
  for (let c = 0; c < nColor; c++) ch[c] = to8(planes[c], width, height, depth);
  if (wantAlpha) ch[-1] = to8(planes[nColor], width, height, depth);
  const wl = { done: false, list: ctx.warnings };
  const rgba = buildRgba(ch, width, height, modeId, ctx.palette, wl);
  return { width, height, data: rgba };
}

/**
 * Parses 'layer count + records + channel image data' (the body of the layer info or of 'Lr16' / 'Lr32').
 */
function parseLayerInfo(r, end, ctx) {
  const { psb, warnings } = ctx;
  const savedLen = r.len;
  r.len = Math.min(end, savedLen);
  try {
    let count = r.i16();
    const mergedAlpha = count < 0;
    count = Math.abs(count);
    if (count * 34 > r.len - r.p) throw new Error('layer count exceeds the available data');
    const recs = [];
    for (let i = 0; i < count; i++) recs.push(readLayerRecord(r, ctx));
    // channel image data
    let truncated = false;
    for (const L of recs) {
      L.planes = {};
      L.maskPlane = null;
      for (const c of L.channels) {
        if (truncated) break;
        const start = r.p;
        if (start + c.len > r.len) {
          warnings.push(`Pixel data of layer '${L.name}' is truncated.`);
          truncated = true;
          break;
        }
        if (c.len < 2) {
          r.p = start + c.len;
          continue;
        }
        r.p = start + c.len;
        const needed = c.id === -2 ? !!L.mask : c.id === -1 || (c.id >= 0 && c.id < ctx.nColor);
        if (!needed) continue;
        const dims = c.id === -2 ? L.mask : L;
        const w = dims.width, h = dims.height;
        if (w * h === 0) continue;
        if (w * h > ctx.maxPixels) {
          if (!L.sizeWarned) warnings.push(`Layer '${L.name}' exceeds the pixel limit; pixel data skipped.`);
          L.sizeWarned = true;
          continue;
        }
        try {
          const comp = (r.b[start] << 8) | r.b[start + 1];
          const raw = decodeRaw(r.b.subarray(start + 2, start + c.len), comp, w, h, ctx.depth, psb);
          const p8 = to8(raw, w, h, ctx.depth);
          if (c.id === -2) L.maskPlane = p8;
          else L.planes[c.id] = p8;
        } catch (e) {
          warnings.push(`Channel ${c.id} of layer '${L.name}' could not be decoded: ${e.message}`);
        }
      }
      if (truncated) break;
    }
    return { layers: recs, mergedAlpha };
  } finally {
    r.len = savedLen;
  }
}

function readLayerRecord(r, ctx) {
  const { psb, warnings } = ctx;
  const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
  const nch = r.u16();
  if (nch > 64) throw new Error('layer record has too many channels');
  const channels = [];
  for (let i = 0; i < nch; i++) {
    const id = r.i16();
    const len = psb ? r.u64() : r.u32();
    channels.push({ id, len });
  }
  if (r.ascii(4) !== '8BIM') throw new Error('bad blend mode signature in layer record');
  const blendKey = r.ascii(4);
  const opacity = r.u8();
  const clipping = r.u8();
  const flags = r.u8();
  r.u8();
  const extraLen = r.u32();
  const extraEnd = r.p + extraLen;
  if (extraEnd > r.len) throw new Error('layer record extra data exceeds file');

  let width = right - left, height = bottom - top;
  if (width < 0 || height < 0) {
    width = 0;
    height = 0;
  }
  /** @type {any} */
  const L = {
    name: '', x: left, y: top, width, height, channels, blendKey, opacity, clipping: clipping === 1,
    visible: (flags & 2) === 0, section: 0, fill: 255, locked: false, text: null, adj: false, smart: false,
    effects: false, mask: null, uni: null,
  };

  // layer mask / adjustment data
  const maskLen = r.u32();
  if (maskLen > extraEnd - r.p) throw new Error('layer mask data exceeds record');
  if (maskLen >= 18) {
    const mTop = r.i32(), mLeft = r.i32(), mBottom = r.i32(), mRight = r.i32();
    const def = r.u8();
    const mflags = r.u8();
    let mw = mRight - mLeft, mh = mBottom - mTop;
    if (mw < 0 || mh < 0) { mw = 0; mh = 0; }
    L.mask = { x: mLeft, y: mTop, width: mw, height: mh, def, flags: mflags };
    r.p += maskLen - 18;
  } else {
    r.p += maskLen;
  }
  // blending ranges
  const brLen = r.u32();
  if (brLen > extraEnd - r.p) throw new Error('blending ranges exceed record');
  r.p += brLen;
  // name
  if (r.p < extraEnd) {
    const nl = r.u8();
    const nb = r.bytes(Math.min(nl, extraEnd - r.p));
    L.name = decodePascal(nb);
    const pad = (4 - ((1 + nl) & 3)) & 3;
    r.p = Math.min(extraEnd, r.p + pad);
  }
  // additional layer info
  while (r.p + 12 <= extraEnd) {
    const sig = r.ascii(4);
    if (sig !== '8BIM' && sig !== '8B64') break;
    const key = r.ascii(4);
    const long = sig === '8B64' || (psb && PSB_LONG_KEYS.has(key));
    const len = long ? r.u64() : r.u32();
    const start = r.p;
    if (start + len > extraEnd) {
      warnings.push(`Block '${key}' of layer '${L.name}' is truncated.`);
      break;
    }
    const data = r.b.subarray(start, start + len);
    try {
      handleLayerBlock(L, key, data, warnings);
    } catch (e) {
      warnings.push(`Block '${key}' of layer '${L.name}' could not be read: ${e.message}`);
    }
    r.p = nextBlock(r.b, start, len, extraEnd);
  }
  r.p = extraEnd;
  if (L.uni !== null && L.uni !== '') L.name = L.uni;
  return L;
}

function handleLayerBlock(L, key, data, warnings) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (key) {
    case 'luni': {
      const rr = new Reader(data);
      L.uni = readUtf16(rr, rr.u32());
      break;
    }
    case 'lsct':
    case 'lsdk': {
      if (data.length >= 4) {
        L.section = dv.getUint32(0);
        if (data.length >= 12) {
          let k = '';
          for (let i = 8; i < 12; i++) k += String.fromCharCode(data[i]);
          L.sectionBlend = k;
        }
      }
      break;
    }
    case 'iOpa':
      if (data.length >= 1) L.fill = data[0];
      break;
    case 'lspf':
      if (data.length >= 4) L.locked = dv.getUint32(0) !== 0;
      break;
    case 'TySh':
    case 'tySh':
      try {
        L.text = parseTypeTool(data);
      } catch (e) {
        L.text = { content: '' };
        warnings.push(`Text of layer '${L.name}' could not be read (${e.message}); showing the stored raster.`);
      }
      break;
    default:
      if (ADJUSTMENT_KEYS.has(key)) L.adj = key;
      else if (SMART_KEYS.has(key)) L.smart = true;
      else if (EFFECT_KEYS.has(key)) L.effects = true;
  }
}

function buildLayerList(parsed, ctx) {
  const warnings = ctx.warnings;
  /** @type {PsdLayer[]} */
  const out = [];
  /** @type {number[]} */
  const stack = [];
  const applyCommon = (L, target) => {
    target.opacity = (L.opacity / 255) * (L.fill / 255);
    target.blend = BLEND_BY_KEY[L.blendKey.trim()] || (warnings.push(`Unknown blend mode '${L.blendKey}' on layer '${L.name}'; using normal.`), 'normal');
    target.visible = L.visible;
    target.locked = L.locked;
    target.clipping = L.clipping;
  };
  for (const L of parsed) {
    if (L.section === 3) {
      const idx = out.length;
      out.push({
        name: 'Group', kind: 'group', x: 0, y: 0, width: 0, height: 0, rgba: null, opacity: 1, blend: 'pass-through',
        visible: true, locked: false, clipping: false, mask: null, groupDepth: stack.length,
        parentIndex: stack.length ? stack[stack.length - 1] : -1,
      });
      stack.push(idx);
      continue;
    }
    if (L.section === 1 || L.section === 2) {
      let g;
      if (stack.length) {
        g = out[stack.pop()];
      } else {
        warnings.push(`Group '${L.name}' has no matching end marker.`);
        g = { name: '', kind: 'group', x: 0, y: 0, width: 0, height: 0, rgba: null, opacity: 1, blend: 'pass-through', visible: true, locked: false, clipping: false, mask: null, groupDepth: 0, parentIndex: -1 };
        out.push(g);
      }
      g.name = L.name;
      applyCommon(L, g);
      g.mask = buildMask(L, g.x, g.y, 0, 0);
      continue;
    }
    const depthN = stack.length;
    const layer = {
      name: L.name, kind: 'pixel', x: L.x, y: L.y, width: L.width, height: L.height, rgba: null,
      opacity: 1, blend: 'normal', visible: true, locked: false, clipping: false, mask: null,
      groupDepth: depthN, parentIndex: depthN ? stack[depthN - 1] : -1,
    };
    applyCommon(L, layer);
    if (L.adj) {
      layer.kind = 'adjustment';
      warnings.push(`Adjustment/fill layer '${L.name}' (${L.adj}) is not rendered.`);
    } else if (L.text) {
      layer.kind = 'text';
      layer.text = L.text;
    } else if (L.smart) {
      layer.kind = 'other';
      warnings.push(`Smart object '${L.name}' is not live; using its stored raster.`);
    }
    if (L.effects) warnings.push(`Layer effects on '${L.name}' are not rendered.`);
    if (layer.kind !== 'adjustment' && layer.width * layer.height > 0 && Object.keys(L.planes).length > 0) {
      layer.rgba = buildRgba(L.planes, layer.width, layer.height, ctx.modeId, ctx.palette, null);
    }
    layer.mask = buildMask(L, layer.x, layer.y, layer.width, layer.height);
    out.push(layer);
  }
  if (stack.length) warnings.push('Unterminated layer group(s) found; contents were kept.');
  return out;
}

/** Produces a mask aligned to the layer bounds (or to its own rectangle for empty layers / groups). */
function buildMask(L, lx, ly, lw, lh) {
  const m = L.mask;
  if (!m || !L.maskPlane || m.width * m.height === 0) return null;
  const disabled = (m.flags & 2) !== 0;
  const invert = (m.flags & 4) !== 0;
  let res;
  if (lw * lh > 0) {
    const data = new Uint8Array(lw * lh);
    data.fill(m.def);
    for (let y = 0; y < lh; y++) {
      const my = ly + y - m.y;
      if (my < 0 || my >= m.height) continue;
      for (let x = 0; x < lw; x++) {
        const mx = lx + x - m.x;
        if (mx >= 0 && mx < m.width) data[y * lw + x] = L.maskPlane[my * m.width + mx];
      }
    }
    res = { x: lx, y: ly, width: lw, height: lh, data };
  } else {
    res = { x: m.x, y: m.y, width: m.width, height: m.height, data: L.maskPlane };
  }
  if (invert) {
    const d = new Uint8Array(res.data.length);
    for (let i = 0; i < d.length; i++) d[i] = 255 - res.data[i];
    res.data = d;
  }
  if (disabled) res.disabled = true;
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// writer
// ---------------------------------------------------------------------------------------------------------------

class Writer {
  constructor(cap = 1024) {
    this.b = new Uint8Array(cap);
    this.p = 0;
  }
  ensure(n) {
    if (this.p + n > this.b.length) {
      const nb = new Uint8Array(Math.max(this.b.length * 2, this.p + n));
      nb.set(this.b.subarray(0, this.p));
      this.b = nb;
    }
  }
  u8(v) { this.ensure(1); this.b[this.p++] = v & 255; return this; }
  u16(v) { this.ensure(2); this.b[this.p++] = (v >> 8) & 255; this.b[this.p++] = v & 255; return this; }
  u32(v) {
    this.ensure(4);
    this.b[this.p++] = (v >>> 24) & 255;
    this.b[this.p++] = (v >>> 16) & 255;
    this.b[this.p++] = (v >>> 8) & 255;
    this.b[this.p++] = v & 255;
    return this;
  }
  i32(v) { return this.u32(v | 0); }
  ascii(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); return this; }
  bytes(a) { this.ensure(a.length); this.b.set(a, this.p); this.p += a.length; return this; }
  pad4() { while (this.p & 3) this.u8(0); return this; }
  result() { return this.b.subarray(0, this.p); }
}

function packBitsRow(src, off, len, out, op) {
  let i = 0;
  while (i < len) {
    const v = src[off + i];
    let run = 1;
    while (i + run < len && run < 128 && src[off + i + run] === v) run++;
    if (run >= 3) {
      out[op++] = 257 - run;
      out[op++] = v;
      i += run;
    } else {
      let j = i;
      while (j < len && j - i < 128) {
        if (j + 2 < len && src[off + j] === src[off + j + 1] && src[off + j] === src[off + j + 2]) break;
        j++;
      }
      if (j === i) j = i + 1;
      out[op++] = j - i - 1;
      for (let k = i; k < j; k++) out[op++] = src[off + k];
      i = j;
    }
  }
  return op;
}

/** Encodes planes (array of w*h byte planes) with PackBits. Returns [rowCountTable..., data]. */
function rleEncodePlanes(planes, w, h) {
  const counts = new Writer(planes.length * h * 2 + 2);
  const data = new Writer(Math.max(256, planes.length * w * h / 2));
  const tmp = new Uint8Array(w + (w >> 6) + 4);
  for (const pl of planes) {
    for (let y = 0; y < h; y++) {
      const n = packBitsRow(pl, y * w, w, tmp, 0);
      counts.u16(n);
      data.bytes(tmp.subarray(0, n));
    }
  }
  return { counts: counts.result(), data: data.result() };
}

function utf16Block(str) {
  const w = new Writer(str.length * 2 + 8);
  w.u32(str.length);
  for (let i = 0; i < str.length; i++) w.u16(str.charCodeAt(i));
  w.pad4();
  return w.result();
}

function pascalName(name) {
  let s = '';
  for (let i = 0; i < name.length && s.length < 255; i++) {
    const c = name.charCodeAt(i);
    s += c >= 32 && c < 127 ? name[i] : '?';
  }
  return s;
}

function blockBytes(key, data) {
  const w = new Writer(data.length + 16);
  w.ascii('8BIM').ascii(key);
  const padded = (data.length + 3) & ~3;
  w.u32(padded);
  w.bytes(data);
  while ((w.p - 12) < padded) w.u8(0);
  return w.result();
}

function blendKeyOf(blend, isGroup) {
  if (blend === undefined || blend === null) return isGroup ? 'pass' : 'norm';
  const k = KEY_BY_BLEND[blend];
  return k ? k : 'norm';
}

/**
 * Writes an 8-bit RGB PSD (version 1).
 * @param {{width:number,height:number,layers?:Array<{name?:string,x?:number,y?:number,width?:number,height?:number,rgba?:Uint8ClampedArray|Uint8Array|null,opacity?:number,blend?:string,visible?:boolean,clipping?:boolean,parentIndex?:number,kind?:string}>,composite?:{data:Uint8ClampedArray|Uint8Array}}} doc
 * @param {{compress?: 'rle'|'raw'}} [opts]
 * @returns {Uint8Array}
 */
export function writePsd(doc, opts = {}) {
  if (!doc || typeof doc !== 'object') throw new Error('writePsd: document is required');
  const { width, height } = doc;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 30000 || height > 30000) {
    throw new Error(`writePsd: canvas must be 1..30000 px per side (got ${width}x${height})`);
  }
  const rle = (opts.compress || 'rle') !== 'raw';
  const input = doc.layers || [];
  if (input.length > 30000) throw new Error('writePsd: too many layers');

  // normalize
  const L = input.map((l, i) => {
    const isGroup = l.kind === 'group';
    const w = isGroup ? 0 : l.width | 0;
    const h = isGroup ? 0 : l.height | 0;
    if (w < 0 || h < 0 || w > 30000 || h > 30000) throw new Error(`writePsd: layer ${i} has invalid size`);
    if (!isGroup && w * h > 0) {
      if (!l.rgba || l.rgba.length !== w * h * 4) throw new Error(`writePsd: layer ${i} rgba length does not match ${w}x${h}`);
    }
    const parent = l.parentIndex === undefined || l.parentIndex === null ? -1 : l.parentIndex;
    if (parent !== -1) {
      if (!Number.isInteger(parent) || parent < 0 || parent >= i || input[parent].kind !== 'group') {
        throw new Error(`writePsd: layer ${i} has an invalid parentIndex`);
      }
    }
    return {
      i, isGroup, w, h, x: Math.round(l.x || 0), y: Math.round(l.y || 0), rgba: l.rgba || null,
      name: typeof l.name === 'string' ? l.name : isGroup ? 'Group ' + (i + 1) : 'Layer ' + (i + 1),
      opacity: l.opacity === undefined ? 1 : Math.max(0, Math.min(1, l.opacity)),
      blend: l.blend, visible: l.visible !== false, clipping: !!l.clipping, parent,
    };
  });
  /** @type {number[][]} */
  const children = L.map(() => []);
  /** @type {number[]} */
  const roots = [];
  for (const l of L) (l.parent === -1 ? roots : children[l.parent]).push(l.i);

  // flatten to file order (bottom-to-top, group closing divider first)
  /** @type {{layer:any, section:number}[]} */
  const order = [];
  const emit = (i) => {
    const l = L[i];
    if (l.isGroup) {
      order.push({ layer: l, section: 3 });
      for (const c of children[i]) emit(c);
      order.push({ layer: l, section: 1 });
    } else {
      order.push({ layer: l, section: 0 });
    }
  };
  for (const r of roots) emit(r);
  if (order.length > 32767) throw new Error('writePsd: too many layers');

  // records + channel data
  const rec = new Writer(4096);
  const chanData = [];
  let layerId = 1;
  for (const { layer: l, section } of order) {
    const isDivider = section === 3;
    const hasPixels = !l.isGroup && l.w * l.h > 0;
    // channel payloads
    const ids = [-1, 0, 1, 2];
    const payloads = [];
    if (hasPixels) {
      const n = l.w * l.h;
      const planes = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
      const src = l.rgba;
      for (let p = 0, o = 0; p < n; p++, o += 4) {
        planes[0][p] = src[o + 3];
        planes[1][p] = src[o];
        planes[2][p] = src[o + 1];
        planes[3][p] = src[o + 2];
      }
      if (rle) {
        for (const pl of planes) {
          const e = rleEncodePlanes([pl], l.w, l.h);
          const w = new Writer(2 + e.counts.length + e.data.length);
          w.u16(1).bytes(e.counts).bytes(e.data);
          payloads.push(w.result());
        }
      } else {
        for (const pl of planes) payloads.push(new Writer(2 + pl.length).u16(0).bytes(pl).result());
      }
    } else {
      for (let k = 0; k < 4; k++) payloads.push(new Uint8Array([0, 0]));
    }
    // record
    rec.i32(hasPixels ? l.y : 0).i32(hasPixels ? l.x : 0).i32(hasPixels ? l.y + l.h : 0).i32(hasPixels ? l.x + l.w : 0);
    rec.u16(4);
    for (let k = 0; k < 4; k++) rec.u16(ids[k] & 0xffff).u32(payloads[k].length);
    rec.ascii('8BIM').ascii(isDivider ? 'norm' : blendKeyOf(l.blend, l.isGroup));
    rec.u8(isDivider ? 255 : Math.round(l.opacity * 255));
    rec.u8(!isDivider && l.clipping ? 1 : 0);
    rec.u8(!isDivider && !l.visible ? 2 : 0);
    rec.u8(0);
    // extra data
    const extra = new Writer(256);
    extra.u32(0); // layer mask data
    extra.u32(0); // blending ranges
    const pn = isDivider ? '</Layer group>' : pascalName(l.name);
    extra.u8(pn.length).ascii(pn);
    while ((extra.p & 3) !== 0) extra.u8(0);
    if (!isDivider) extra.bytes(blockBytes('luni', utf16Block(l.name)));
    extra.bytes(blockBytes('lyid', new Uint8Array([0, 0, (layerId >> 8) & 255, layerId & 255])));
    layerId++;
    if (l.isGroup) {
      const sct = new Writer(12);
      sct.u32(section === 3 ? 3 : 1).ascii('8BIM').ascii(blendKeyOf(l.blend, true));
      extra.bytes(blockBytes('lsct', section === 3 ? sct.result().subarray(0, 4) : sct.result()));
    }
    rec.u32(extra.p).bytes(extra.result());
    chanData.push(...payloads);
  }
  const body = new Writer(rec.p + 16);
  body.u16((-order.length) & 0xffff); // negative: first alpha channel of the merged image is transparency
  body.bytes(rec.result());
  for (const p of chanData) body.bytes(p);
  body.pad4();
  const layerInfo = body.result();

  // composite
  let comp = doc.composite && doc.composite.data;
  if (comp && comp.length !== width * height * 4) throw new Error('writePsd: composite data length does not match the canvas');
  if (!comp) comp = compositeLayers(width, height, L);

  const out = new Writer(layerInfo.length + width * height + 4096);
  out.ascii('8BPS').u16(1).bytes(new Uint8Array(6)).u16(4).u32(height).u32(width).u16(8).u16(3);
  out.u32(0); // color mode data
  // image resources: resolution info 72 dpi
  const res = new Writer(40);
  res.ascii('8BIM').u16(0x03ed).u16(0).u32(16).u32(72 << 16).u16(1).u16(1).u32(72 << 16).u16(1).u16(1);
  out.u32(res.p).bytes(res.result());
  out.u32(4 + layerInfo.length + 4);
  out.u32(layerInfo.length).bytes(layerInfo);
  out.u32(0); // global layer mask info
  // merged image
  const n = width * height;
  const planes = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    planes[0][p] = comp[o];
    planes[1][p] = comp[o + 1];
    planes[2][p] = comp[o + 2];
    planes[3][p] = comp[o + 3];
  }
  if (rle) {
    const e = rleEncodePlanes(planes, width, height);
    out.u16(1).bytes(e.counts).bytes(e.data);
  } else {
    out.u16(0);
    for (const pl of planes) out.bytes(pl);
  }
  return out.result().slice();
}

/** Simple source-over compositing of visible layers (blend modes and clipping are ignored). */
function compositeLayers(width, height, L) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const l of L) {
    if (l.isGroup || !l.rgba || l.w * l.h === 0) continue;
    let op = l.opacity;
    let vis = l.visible;
    for (let p = l.parent; p !== -1 && vis; p = L[p].parent) {
      vis = L[p].visible;
      op *= L[p].opacity;
    }
    if (!vis || op <= 0) continue;
    const x0 = Math.max(0, l.x), x1 = Math.min(width, l.x + l.w);
    const y0 = Math.max(0, l.y), y1 = Math.min(height, l.y + l.h);
    for (let y = y0; y < y1; y++) {
      let s = ((y - l.y) * l.w + (x0 - l.x)) * 4;
      let d = (y * width + x0) * 4;
      for (let x = x0; x < x1; x++, s += 4, d += 4) {
        const sa = (l.rgba[s + 3] / 255) * op;
        if (sa <= 0) continue;
        const da = out[d + 3] / 255;
        const oa = sa + da * (1 - sa);
        const k = da * (1 - sa);
        out[d] = (l.rgba[s] * sa + out[d] * k) / oa;
        out[d + 1] = (l.rgba[s + 1] * sa + out[d + 1] * k) / oa;
        out[d + 2] = (l.rgba[s + 2] * sa + out[d + 2] * k) / oa;
        out[d + 3] = oa * 255;
      }
    }
  }
  return out;
}
