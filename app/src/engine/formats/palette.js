// Color palette formats: GIMP `.gpl` (text), Adobe Swatch Exchange `.ase` and Photoshop swatches `.aco` (binary).
//
// Clean-room: the ACO layout is documented in Adobe's "Photoshop File Formats" specification; the ASE layout has no
// official Adobe document and follows the widely published community description (big-endian blocks, UTF-16 names,
// float color values). Only the color data is read; nothing else in the files is interpreted.
//
// Public API (all pure, no DOM):
//   readGpl(text) / writeGpl(colors, name) / readHexList(text)
//   readAse(bytes) / writeAse(colors) / readAco(bytes) / writeAco(colors)
//   readPalette(bytes, fileName) -> { name, colors: [{ name, color: '#rrggbb' }], warnings }  (by extension / magic)
// Invariants: counts are capped (4096 colors); every read is bounds checked; malformed files throw an Error with
// a readable message, never hang.

const MAX_COLORS = 4096;
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const toHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const fromHex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const cmykToHex = (c, m, y, k) => toHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));

/** CIE Lab (D50, L 0..100) to sRGB hex. */
function labToHex(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.9642 * f(fx);
  const Y = f(fy);
  const Z = 0.8249 * f(fz);
  const lin = [3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z, 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z];
  const g = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);
  return toHex(g(lin[0]), g(lin[1]), g(lin[2]));
}

function hsbToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return toHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

// ------------------------------------------------------------------ GPL

export function readGpl(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  if (!/^GIMP Palette/i.test(lines[0] || '')) throw new Error('This is not a GIMP palette (.gpl) file.');
  let name = '';
  const colors = [];
  for (const line of lines.slice(1)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const nm = /^Name:\s*(.*)$/i.exec(l);
    if (nm) {
      name = nm[1].trim();
      continue;
    }
    if (/^Columns:/i.test(l)) continue;
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/.exec(l);
    if (!m) continue;
    colors.push({ name: (m[4] || '').trim() || toHex(+m[1], +m[2], +m[3]), color: toHex(+m[1], +m[2], +m[3]) });
    if (colors.length >= MAX_COLORS) break;
  }
  if (!colors.length) throw new Error('This palette file contains no colors.');
  return { name: name || 'Palette', colors, warnings: [] };
}

export function writeGpl(colors, name = 'OpenFini') {
  const rows = colors.map((c) => {
    const rgb = fromHex(c.color) || [0, 0, 0];
    return `${String(rgb[0]).padStart(3)} ${String(rgb[1]).padStart(3)} ${String(rgb[2]).padStart(3)}\t${String(c.name || c.color).replace(/[\r\n]+/g, ' ')}`;
  });
  return `GIMP Palette\nName: ${String(name).replace(/[\r\n]+/g, ' ')}\nColumns: 8\n#\n${rows.join('\n')}\n`;
}

/** Hex colors from free text ("#ff0000, 00ff00 ..." or one per line, optionally "name #hex"). */
export function readHexList(text) {
  const colors = [];
  for (const line of String(text).split(/\r?\n/)) {
    const hexes = [...line.matchAll(/#?\b([0-9a-f]{6})\b/gi)];
    if (!hexes.length) continue;
    if (hexes.length === 1) {
      const nm = line.replace(hexes[0][0], '').replace(/[,;:=\-]+/g, ' ').trim();
      colors.push({ name: nm || `#${hexes[0][1].toLowerCase()}`, color: `#${hexes[0][1].toLowerCase()}` });
    } else for (const m of hexes) colors.push({ name: `#${m[1].toLowerCase()}`, color: `#${m[1].toLowerCase()}` });
    if (colors.length >= MAX_COLORS) break;
  }
  return colors.slice(0, MAX_COLORS);
}

// ------------------------------------------------------------------ ACO

function utf16be(dv, at, chars) {
  let s = '';
  for (let i = 0; i < chars; i++) {
    const c = dv.getUint16(at + i * 2, false);
    if (c) s += String.fromCharCode(c);
  }
  return s;
}

function acoColor(space, w) {
  const f = (v) => v / 65535;
  switch (space) {
    case 0: return toHex(w[0] / 257, w[1] / 257, w[2] / 257);
    case 1: return hsbToHex(f(w[0]), f(w[1]), f(w[2]));
    case 2: return cmykToHex(1 - f(w[0]), 1 - f(w[1]), 1 - f(w[2]), 1 - f(w[3]));
    case 7: return labToHex(w[0] / 100, ((w[1] << 16) >> 16) / 100, ((w[2] << 16) >> 16) / 100);
    case 8: {
      const g = (1 - Math.min(10000, w[0]) / 10000) * 255; // 10000 = black
      return toHex(g, g, g);
    }
    default: return null;
  }
}

/** Reads the colors of one ACO section; returns { colors, end }. */
function acoSection(b, at, named, warnings) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getUint16(at + 2, false);
  let p = at + 4;
  const colors = [];
  for (let i = 0; i < count && i < MAX_COLORS; i++) {
    if (p + 10 > b.length) throw new Error('The swatch file is truncated.');
    const space = dv.getUint16(p, false);
    const w = [dv.getUint16(p + 2, false), dv.getUint16(p + 4, false), dv.getUint16(p + 6, false), dv.getUint16(p + 8, false)];
    p += 10;
    let name = '';
    if (named) {
      if (p + 4 > b.length) throw new Error('The swatch file is truncated.');
      const len = dv.getUint16(p + 2, false);
      p += 4;
      if (p + len * 2 > b.length) throw new Error('The swatch file is truncated.');
      name = utf16be(dv, p, len);
      p += len * 2;
    }
    const color = acoColor(space, w);
    if (color) colors.push({ name: name || color, color });
    else warnings.push('Swatches in an unsupported color space (for example a spot or custom color book) were skipped.');
  }
  return { colors, end: p };
}

export function readAco(b) {
  if (!b || b.length < 4) throw new Error('This is not a Photoshop swatch (.aco) file.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const v1 = dv.getUint16(0, false);
  if (v1 !== 1 && v1 !== 2) throw new Error('This is not a Photoshop swatch (.aco) file.');
  const warnings = [];
  let sec;
  if (v1 === 1) {
    sec = acoSection(b, 0, false, warnings);
    if (sec.end + 4 <= b.length && dv.getUint16(sec.end, false) === 2) sec = acoSection(b, sec.end, true, warnings);
  } else sec = acoSection(b, 0, true, warnings);
  if (!sec.colors.length) throw new Error('This swatch file contains no colors.');
  return { name: 'Swatches', colors: sec.colors, warnings: [...new Set(warnings)] };
}

/** Writes ACO version 1 followed by version 2 (names), RGB only, like Photoshop does. */
export function writeAco(colors) {
  const list = colors.slice(0, 65535).map((c) => ({ rgb: fromHex(c.color) || [0, 0, 0], name: String(c.name || c.color) }));
  const size1 = 4 + list.length * 10;
  const size2 = 4 + list.reduce((s, c) => s + 14 + (c.name.length + 1) * 2, 0);
  const out = new Uint8Array(size1 + size2);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint16(p, 1);
  dv.setUint16(p + 2, list.length);
  p += 4;
  for (const c of list) {
    dv.setUint16(p, 0);
    for (let k = 0; k < 3; k++) dv.setUint16(p + 2 + k * 2, c.rgb[k] * 257);
    p += 10;
  }
  dv.setUint16(p, 2);
  dv.setUint16(p + 2, list.length);
  p += 4;
  for (const c of list) {
    dv.setUint16(p, 0);
    for (let k = 0; k < 3; k++) dv.setUint16(p + 2 + k * 2, c.rgb[k] * 257);
    dv.setUint16(p + 10, 0);
    dv.setUint16(p + 12, c.name.length + 1);
    p += 14;
    for (let i = 0; i < c.name.length; i++) dv.setUint16(p + i * 2, c.name.charCodeAt(i));
    p += (c.name.length + 1) * 2;
  }
  return out;
}

// ------------------------------------------------------------------ ASE

export function readAse(b) {
  if (!b || b.length < 12 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'ASEF') throw new Error('This is not an Adobe Swatch Exchange (.ase) file.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const blocks = dv.getUint32(8, false);
  let p = 12;
  const colors = [];
  const warnings = [];
  for (let i = 0; i < blocks && i < 100000 && p + 6 <= b.length; i++) {
    const type = dv.getUint16(p, false);
    const len = dv.getUint32(p + 2, false);
    const body = p + 6;
    if (body + len > b.length) throw new Error('The swatch file is truncated.');
    if (type === 0x0001 && len >= 2 + 4) {
      const nchars = dv.getUint16(body, false);
      let q = body + 2;
      if (q + nchars * 2 + 4 > body + len) throw new Error('The swatch file is damaged.');
      const name = utf16be(dv, q, nchars);
      q += nchars * 2;
      const model = String.fromCharCode(b[q], b[q + 1], b[q + 2], b[q + 3]);
      q += 4;
      const n = model === 'CMYK' ? 4 : model === 'Gray' ? 1 : 3;
      if (q + n * 4 <= body + len) {
        const v = [];
        for (let k = 0; k < n; k++) v.push(dv.getFloat32(q + k * 4, false));
        let color = null;
        if (model === 'RGB ') color = toHex(v[0] * 255, v[1] * 255, v[2] * 255);
        else if (model === 'CMYK') color = cmykToHex(v[0], v[1], v[2], v[3]);
        else if (model === 'Gray') color = toHex(v[0] * 255, v[0] * 255, v[0] * 255);
        else if (model === 'LAB ') color = labToHex(v[0] * 100, v[1], v[2]);
        if (color) colors.push({ name: name || color, color });
      }
    } else if (type !== 0xc001 && type !== 0xc002 && type !== 0x0001) warnings.push('Unknown blocks in the swatch file were skipped.');
    p = body + len;
    if (colors.length >= MAX_COLORS) break;
  }
  if (!colors.length) throw new Error('This swatch file contains no colors.');
  return { name: 'Swatches', colors, warnings: [...new Set(warnings)] };
}

export function writeAse(colors) {
  const list = colors.slice(0, 65535).map((c) => ({ rgb: fromHex(c.color) || [0, 0, 0], name: String(c.name || c.color) }));
  const size = 12 + list.reduce((s, c) => s + 6 + 2 + (c.name.length + 1) * 2 + 4 + 12 + 2, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x41, 0x53, 0x45, 0x46]);
  dv.setUint16(4, 1);
  dv.setUint16(6, 0);
  dv.setUint32(8, list.length);
  let p = 12;
  for (const c of list) {
    const len = 2 + (c.name.length + 1) * 2 + 4 + 12 + 2;
    dv.setUint16(p, 0x0001);
    dv.setUint32(p + 2, len);
    p += 6;
    dv.setUint16(p, c.name.length + 1);
    p += 2;
    for (let i = 0; i < c.name.length; i++) dv.setUint16(p + i * 2, c.name.charCodeAt(i));
    p += (c.name.length + 1) * 2;
    out.set([0x52, 0x47, 0x42, 0x20], p);
    p += 4;
    for (let k = 0; k < 3; k++) dv.setFloat32(p + k * 4, c.rgb[k] / 255);
    p += 12;
    dv.setUint16(p, 2);
    p += 2;
  }
  return out;
}

/** Reads any supported palette by file extension (falls back to the magic bytes). */
export function readPalette(bytes, fileName = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName) || [, ''])[1].toLowerCase();
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Palette';
  let res;
  if (ext === 'ase' || head === 'ASEF') res = readAse(bytes);
  else if (ext === 'aco') res = readAco(bytes);
  else if (ext === 'gpl' || head === 'GIMP') res = readGpl(new TextDecoder().decode(bytes));
  else throw new Error('Unsupported palette format (supported: .gpl, .ase, .aco).');
  if (res.name === 'Swatches' || res.name === 'Palette') res.name = base;
  return res;
}
