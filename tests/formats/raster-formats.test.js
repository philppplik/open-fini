// GIF, ICO, ORA and palette formats against synthetic files built by independent writers in this file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readGif, isGif } from '../../app/src/engine/formats/gif.js';
import { readIco, isIco } from '../../app/src/engine/formats/ico.js';
import { readOra, writeOra, isOra } from '../../app/src/engine/formats/ora.js';
import { readGpl, writeGpl, readAse, writeAse, readAco, writeAco, readHexList, readPalette } from '../../app/src/engine/formats/palette.js';

// ---- GIF writer: emits every pixel as a literal code and resets the table often (valid, uncompressed LZW)
function gifBlocks(indices, minCode) {
  const bytes = [];
  let buf = 0;
  let cnt = 0;
  let bits = minCode + 1;
  const clear = 1 << minCode;
  const put = (c) => {
    buf |= c << cnt;
    cnt += bits;
    while (cnt >= 8) {
      bytes.push(buf & 255);
      buf >>>= 8;
      cnt -= 8;
    }
  };
  put(clear);
  let sinceClear = 0;
  for (const v of indices) {
    put(v);
    if (++sinceClear >= clear - 2) {
      put(clear);
      sinceClear = 0;
    }
  }
  put(clear + 1);
  if (cnt) bytes.push(buf & 255);
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const c = bytes.slice(i, i + 255);
    out.push(c.length, ...c);
  }
  out.push(0);
  return out;
}
function buildGif(w, h, frames, { palette = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]], loops = 0 } = {}) {
  const o = [...'GIF89a'].map((c) => c.charCodeAt(0));
  o.push(w & 255, w >> 8, h & 255, h >> 8, 0x80 | 1, 0, 0);
  for (const c of palette) o.push(...c);
  o.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, loops & 255, loops >> 8, 0);
  for (const f of frames) {
    o.push(0x21, 0xf9, 4, (f.disposal ?? 0) << 2 | (f.transparent !== undefined ? 1 : 0), (f.delay ?? 10) & 255, 0, f.transparent ?? 0, 0);
    const fw = f.w ?? w;
    const fh = f.h ?? h;
    o.push(0x2c, (f.x ?? 0) & 255, 0, (f.y ?? 0) & 255, 0, fw & 255, 0, fh & 255, 0, 0, 2);
    o.push(...gifBlocks(f.idx, 2));
  }
  o.push(0x3b);
  return Uint8Array.from(o);
}

describe('GIF', () => {
  it('decodes frames, delays, transparency and disposal', () => {
    const g = buildGif(2, 2, [
      { idx: [1, 1, 1, 1], delay: 20 },
      { idx: [2], x: 1, y: 1, w: 1, h: 1, delay: 30, disposal: 2 },
      { idx: [0], transparent: 0, x: 0, y: 0, w: 1, h: 1 },
    ]);
    assert.ok(isGif(g));
    const r = readGif(g);
    assert.equal(r.frames.length, 3);
    assert.equal(r.loops, 0);
    assert.deepEqual([r.frames[0].delay, r.frames[1].delay], [200, 300]);
    assert.deepEqual([...r.frames[0].rgba.slice(0, 4)], [255, 0, 0, 255]);
    assert.deepEqual([...r.frames[1].rgba.slice(12, 16)], [0, 255, 0, 255]);
    // frame 2 disposed to background (transparent) before frame 3 draws; frame 3 pixel is transparent so stays empty
    assert.equal(r.frames[2].rgba[15], 0);
    assert.deepEqual([...r.frames[2].rgba.slice(0, 4)], [255, 0, 0, 255]);
  });
  it('survives garbage and limits frames', () => {
    assert.throws(() => readGif(Uint8Array.of(1, 2, 3)), /not a GIF/);
    const g = buildGif(2, 2, Array.from({ length: 5 }, () => ({ idx: [1, 2, 3, 1] })));
    assert.equal(readGif(g, { maxFrames: 2 }).frames.length, 2);
    for (let s = 0; s < 30; s++) {
      const m = Uint8Array.from(g);
      m[20 + ((s * 13) % (m.length - 21))] ^= 0xff;
      try {
        readGif(m);
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    }
    assert.throws(() => readGif(g.subarray(0, 14)), /truncated/);
  });
});

// ---- ICO
function buildIco(entries, cur = false) {
  const head = [0, 0, cur ? 2 : 1, 0, entries.length, 0];
  let off = 6 + entries.length * 16;
  const dir = [];
  for (const e of entries) {
    dir.push(e.w & 255, e.h & 255, 0, 0, 1, 0, 32, 0, ...le32(e.data.length), ...le32(off));
    off += e.data.length;
  }
  return Uint8Array.from([...head, ...dir, ...entries.flatMap((e) => [...e.data])]);
}
const le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
function dib32(w, h, rgbaRows) {
  const px = [];
  for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) px.push(rgbaRows[y][x][2], rgbaRows[y][x][1], rgbaRows[y][x][0], rgbaRows[y][x][3]);
  const mask = new Array(h * (((w + 31) >> 5) << 2)).fill(0);
  return Uint8Array.from([...le32(40), ...le32(w), ...le32(h * 2), 1, 0, 32, 0, ...le32(0), ...le32(0), ...le32(0), ...le32(0), ...le32(0), ...le32(0), ...px, ...mask]);
}

describe('ICO', () => {
  it('reads 32-bit BMP and PNG entries, largest first', () => {
    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 128];
    const small = dib32(2, 2, [[red, blue], [blue, red]]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
    const ico = buildIco([{ w: 2, h: 2, data: small }, { w: 16, h: 16, data: png }]);
    assert.ok(isIco(ico));
    const r = readIco(ico);
    assert.equal(r.images.length, 2);
    assert.equal(r.images[0].width, 16);
    assert.ok(r.images[0].png);
    assert.deepEqual([...r.images[1].rgba.slice(0, 4)], red);
    assert.deepEqual([...r.images[1].rgba.slice(4, 8)], blue);
    assert.equal(readIco(buildIco([{ w: 2, h: 2, data: small }], true)).cursor, true);
  });
  it('rejects bad entries', () => {
    assert.throws(() => readIco(Uint8Array.of(1, 2, 3)), /not an ICO/);
    const bad = buildIco([{ w: 4, h: 4, data: Uint8Array.from({ length: 20 }, () => 0) }]);
    assert.throws(() => readIco(bad), /no readable image/);
    const out = buildIco([{ w: 4, h: 4, data: new Uint8Array(20) }]);
    out[6 + 12] = 255; // offset beyond file
    assert.throws(() => readIco(out), /no readable image/);
  });
});

// ---- ORA
describe('OpenRaster', () => {
  const png = (n) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, n, n, n]);
  it('round-trips layers with opacity, blend, visibility and offsets', () => {
    const bytes = writeOra({
      width: 40,
      height: 30,
      layers: [
        { name: 'Back & <1>', x: 0, y: 0, opacity: 1, blend: 'normal', png: png(1) },
        { name: 'Top', x: 5, y: 6, opacity: 0.5, blend: 'multiply', visible: false, png: png(2) },
      ],
      mergedPng: png(9),
    });
    assert.ok(isOra(bytes));
    const r = readOra(bytes);
    assert.equal(r.width, 40);
    assert.deepEqual(r.layers.map((l) => l.name), ['Back & <1>', 'Top']);
    assert.equal(r.layers[1].opacity, 0.5);
    assert.equal(r.layers[1].blend, 'multiply');
    assert.equal(r.layers[1].visible, false);
    assert.deepEqual([r.layers[1].x, r.layers[1].y], [5, 6]);
    assert.deepEqual([...r.layers[0].png], [...png(1)]);
    assert.deepEqual([...r.mergedPng], [...png(9)]);
  });
  it('reads nested stacks and reports unknown blend modes and missing images', async () => {
    const { zipSync, strToU8 } = await import('../../app/vendor/fflate/fflate.js');
    const xml = `<?xml version="1.0"?><image w="10" h="10"><stack name="root"><layer name="a" src="data/a.png" composite-op="svg:weird"/><stack name="G" opacity="0.8"><layer name="b" src="data/b.png"/><layer name="gone" src="data/none.png"/></stack><layer name="evil" src="../x.png"/></stack></image>`;
    const z = zipSync({ mimetype: [strToU8('image/openraster'), { level: 0 }], 'stack.xml': strToU8(xml), 'data/a.png': png(1), 'data/b.png': png(2) });
    const r = readOra(z);
    assert.deepEqual(r.layers.map((l) => [l.name, l.kind, l.parentIndex]), [['G', 'group', -1], ['b', 'pixel', 0], ['a', 'pixel', -1]]);
    assert.equal(r.layers[2].blend, 'normal');
    assert.ok(r.warnings.some((w) => /weird/.test(w)));
    assert.ok(r.warnings.some((w) => /gone/.test(w)));
    assert.ok(r.warnings.some((w) => /evil/.test(w)));
  });
  it('rejects damaged files', () => {
    assert.throws(() => readOra(Uint8Array.from({ length: 100 }, () => 1)), /valid OpenRaster/);
  });
});

// ---- palettes
describe('palettes', () => {
  const colors = [{ name: 'Red', color: '#ff0000' }, { name: 'Ocean “blue”', color: '#0a4b9c' }, { name: 'Gray', color: '#808080' }];
  it('round-trips GPL, ASE and ACO', () => {
    assert.deepEqual(readGpl(writeGpl(colors, 'Test')).colors, colors);
    assert.equal(readGpl(writeGpl(colors, 'Test')).name, 'Test');
    assert.deepEqual(readAse(writeAse(colors)).colors, colors);
    assert.deepEqual(readAco(writeAco(colors)).colors, colors);
  });
  it('reads ACO version 1 only files, CMYK and gray', () => {
    const b = new Uint8Array(4 + 20);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, 1);
    dv.setUint16(2, 2);
    dv.setUint16(4, 2); // CMYK: stored inverted, 65535 = no ink
    [65535, 65535, 65535, 65535].forEach((v, i) => dv.setUint16(6 + i * 2, v));
    dv.setUint16(14, 8); // gray: 10000 = black
    dv.setUint16(16, 10000);
    const r = readAco(b);
    assert.deepEqual(r.colors.map((c) => c.color), ['#ffffff', '#000000']);
  });
  it('reads ASE CMYK, gray and ignores groups', () => {
    const name = 'c';
    const body = (model, vals) => {
      const u = new Uint8Array(2 + 4 + 2 + 4 + vals.length * 4 + 2);
      const d = new DataView(u.buffer);
      d.setUint16(0, 2);
      d.setUint16(2, name.charCodeAt(0));
      u.set([...model].map((c) => c.charCodeAt(0)), 6);
      vals.forEach((v, i) => d.setFloat32(10 + i * 4, v));
      return u;
    };
    const blocks = [[0xc001, new Uint8Array([0, 2, 0, 71, 0, 0])], [1, body('CMYK', [0, 0, 0, 1])], [1, body('Gray', [0.5])], [0xc002, new Uint8Array(0)]];
    const total = 12 + blocks.reduce((s, [, u]) => s + 6 + u.length, 0);
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    out.set([0x41, 0x53, 0x45, 0x46]);
    dv.setUint16(4, 1);
    dv.setUint32(8, blocks.length);
    let p = 12;
    for (const [t, u] of blocks) {
      dv.setUint16(p, t);
      dv.setUint32(p + 2, u.length);
      out.set(u, p + 6);
      p += 6 + u.length;
    }
    assert.deepEqual(readAse(out).colors.map((c) => c.color), ['#000000', '#808080']);
  });
  it('parses hex lists and detects formats', () => {
    assert.deepEqual(readHexList('#FF0000, 00ff00\nbrand: #123456').map((c) => c.color), ['#ff0000', '#00ff00', '#123456']);
    assert.equal(readHexList('brand #123456')[0].name, 'brand');
    assert.equal(readPalette(new TextEncoder().encode(writeGpl(colors, 'X')), 'my.gpl').colors.length, 3);
    assert.equal(readPalette(writeAse(colors), 'a.ase').name, 'a');
  });
  it('rejects truncated and foreign data', () => {
    assert.throws(() => readAse(writeAse(colors).subarray(0, 30)), /truncated|damaged/);
    assert.throws(() => readAco(writeAco(colors).subarray(0, 12)), /truncated/);
    assert.throws(() => readGpl('hello'), /not a GIMP/);
    assert.throws(() => readPalette(Uint8Array.of(1, 2, 3, 4, 5), 'x.bin'), /Unsupported/);
  });
});

// ---- DOS EPS header, Krita, verdict table
import { dosEpsParts } from '../../app/src/engine/formats/embedded.js';
import { readKraMerged, isKra } from '../../app/src/engine/formats/kra.js';
import { zipSync, strToU8 } from '../../app/vendor/fflate/fflate.js';
import { FORMAT_VERDICTS, verdictForExtension } from '../../app/src/platform/format-verdicts.js';
import { FILE_TYPES } from '../../app/src/platform/file-types.js';

describe('EPS header, Krita and verdicts', () => {
  it('parses a DOS EPS binary header and rejects out-of-range parts', () => {
    const head = new Uint8Array(30);
    const dv = new DataView(head.buffer);
    head.set([0xc5, 0xd0, 0xd3, 0xc6]);
    dv.setUint32(4, 30, true);
    dv.setUint32(8, 10, true);
    dv.setUint32(20, 40, true);
    dv.setUint32(24, 10, true);
    const file = new Uint8Array(60);
    file.set(head);
    const p = dosEpsParts(file);
    assert.deepEqual(p.ps, [30, 10]);
    assert.deepEqual(p.tiff, [40, 10]);
    assert.equal(p.wmf, null);
    dv.setUint32(24, 5000, true);
    file.set(head);
    assert.equal(dosEpsParts(file).tiff, null);
    assert.equal(dosEpsParts(Uint8Array.of(1, 2, 3)), null);
  });
  it('reads the merged image of a Krita file', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const z = zipSync({ mimetype: [strToU8('application/x-krita'), { level: 0 }], 'maindoc.xml': strToU8('<DOC/>'), 'mergedimage.png': png });
    assert.ok(isKra(z));
    const k = readKraMerged(z);
    assert.equal(k.kind, 'merged');
    assert.deepEqual([...k.png], [...png]);
    assert.throws(() => readKraMerged(zipSync({ 'maindoc.xml': strToU8('<DOC/>') })), /no flattened image/);
  });
  it('keeps the verdict table consistent', () => {
    const ids = FORMAT_VERDICTS.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const v of FORMAT_VERDICTS) assert.ok(['supported', 'partial', 'export-route', 'not-possible'].includes(v.status), v.id);
    assert.equal(verdictForExtension('.AFDESIGN').status, 'export-route');
    assert.equal(verdictForExtension('nope'), null);
    // every registered import type that this branch added has a verdict
    for (const id of ['tiff', 'ico', 'ora', 'kra', 'gpl', 'ase', 'aco']) {
      const t = FILE_TYPES.find((x) => x.id === id);
      assert.ok(t.ext.every((e) => verdictForExtension(e)), id);
    }
  });
});
