import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readTiff, isTiff, lzwDecode, packBitsDecode } from '../../app/src/engine/formats/tiff.js';
import { buildTiff, lzwEncode, packBitsEncode } from './_tiff-fixture.js';

const W = 7;
const H = 5;
const rgbData = () => {
  const d = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    d[i * 3] = (i * 9) & 255;
    d[i * 3 + 1] = i < 12 ? 40 : 200;
    d[i * 3 + 2] = 255 - i;
  }
  return d;
};
const check = (page) => {
  assert.equal(page.width, W);
  assert.equal(page.height, H);
  const d = rgbData();
  for (let i = 0; i < W * H; i++) {
    assert.equal(page.rgba[i * 4], d[i * 3]);
    assert.equal(page.rgba[i * 4 + 1], d[i * 3 + 1]);
    assert.equal(page.rgba[i * 4 + 2], d[i * 3 + 2]);
    assert.equal(page.rgba[i * 4 + 3], 255);
  }
};

describe('TIFF reader', () => {
  it('codecs round-trip', () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i % 7 === 0 ? 0 : (i * 31) & 255));
    assert.deepEqual(lzwDecode(lzwEncode(data), data.length), data);
    assert.deepEqual(packBitsDecode(packBitsEncode(data), data.length), data);
  });

  for (const [name, comp] of [['uncompressed', 1], ['LZW', 5], ['PackBits', 32773], ['Deflate', 8]]) {
    for (const le of [true, false]) {
      it(`reads ${name} RGB (${le ? 'II' : 'MM'}), several strips`, () => {
        const t = buildTiff([{ width: W, height: H, spp: 3, bps: 8, photo: 2, data: rgbData(), comp, rowsPerStrip: 2 }], { le });
        assert.ok(isTiff(t));
        const r = readTiff(t);
        assert.equal(r.pages.length, 1);
        check(r.pages[0]);
      });
    }
  }

  it('applies the horizontal predictor', () => {
    const t = buildTiff([{ width: W, height: H, spp: 3, bps: 8, photo: 2, data: rgbData(), comp: 5, predictor: 2 }]);
    check(readTiff(t).pages[0]);
  });

  it('reads multiple pages and skips reduced-resolution pages', () => {
    const page = { width: W, height: H, spp: 3, bps: 8, photo: 2, data: rgbData() };
    const t = buildTiff([page, { ...page, subfile: 1 }, page]);
    assert.equal(readTiff(t).pages.length, 2);
  });

  it('reads gray, white-is-zero, 1-bit, palette, CMYK, RGBA and 16-bit', () => {
    const gray = readTiff(buildTiff([{ width: 2, height: 1, spp: 1, bps: 8, photo: 1, data: Uint8Array.of(0, 200) }])).pages[0];
    assert.deepEqual([...gray.rgba.slice(0, 8)], [0, 0, 0, 255, 200, 200, 200, 255]);
    const wiz = readTiff(buildTiff([{ width: 2, height: 1, spp: 1, bps: 8, photo: 0, data: Uint8Array.of(0, 255) }])).pages[0];
    assert.deepEqual([...wiz.rgba.slice(0, 8)], [255, 255, 255, 255, 0, 0, 0, 255]);
    const bit = readTiff(buildTiff([{ width: 3, height: 1, spp: 1, bps: 1, photo: 1, data: Uint8Array.of(0b10100000) }])).pages[0];
    assert.deepEqual([...bit.rgba].filter((_, i) => i % 4 === 0), [255, 0, 255]);
    const cmap = new Array(768).fill(0);
    cmap[1] = 65535; // index 1 red
    const pal = readTiff(buildTiff([{ width: 2, height: 1, spp: 1, bps: 8, photo: 3, data: Uint8Array.of(0, 1), cmap }])).pages[0];
    assert.deepEqual([...pal.rgba.slice(4, 8)], [255, 0, 0, 255]);
    const cmyk = readTiff(buildTiff([{ width: 1, height: 1, spp: 4, bps: 8, photo: 5, data: Uint8Array.of(0, 0, 0, 0) }])).pages[0];
    assert.deepEqual([...cmyk.rgba], [255, 255, 255, 255]);
    const rgba = readTiff(buildTiff([{ width: 1, height: 1, spp: 4, bps: 8, photo: 2, extra: 2, data: Uint8Array.of(10, 20, 30, 128) }])).pages[0];
    assert.deepEqual([...rgba.rgba], [10, 20, 30, 128]);
    const d16 = Uint8Array.of(0x12, 0x34, 0xab, 0xcd, 0x00, 0xff);
    // little endian 16-bit: high byte is the second byte of each sample
    const r16 = readTiff(buildTiff([{ width: 1, height: 1, spp: 3, bps: 16, photo: 2, data: d16 }])).pages[0];
    assert.deepEqual([...r16.rgba.slice(0, 3)], [0x34, 0xcd, 0xff]);
    assert.ok(readTiff(buildTiff([{ width: 1, height: 1, spp: 3, bps: 16, photo: 2, data: d16 }])).warnings.some((w) => /16-bit/.test(w)));
  });

  it('rejects hostile or unsupported input with clear errors', () => {
    assert.throws(() => readTiff(Uint8Array.of(1, 2, 3)), /not a TIFF/);
    assert.throws(() => readTiff(Uint8Array.of(0x49, 0x49, 0x2b, 0, 8, 0, 8, 0, 0, 0)), /BigTIFF/);
    const t = buildTiff([{ width: W, height: H, spp: 3, bps: 8, photo: 2, data: rgbData() }]);
    assert.throws(() => readTiff(t.subarray(0, 60)), /truncated|damaged|no image/);
    assert.throws(() => readTiff(t, { maxPixels: 10 }), /too large/);
    const loop = Uint8Array.from(t);
    // point the next-IFD pointer back at the first IFD: must terminate
    const ifd = new DataView(loop.buffer).getUint32(4, true);
    const n = new DataView(loop.buffer).getUint16(ifd, true);
    new DataView(loop.buffer).setUint32(ifd + 2 + n * 12, ifd, true);
    assert.equal(readTiff(loop).pages.length, 1);
    const jpeg = buildTiff([{ width: 1, height: 1, spp: 3, bps: 8, photo: 2, data: Uint8Array.of(1, 2, 3), comp: 7 }]);
    assert.throws(() => readTiff(jpeg), /JPEG/);
    // random garbage after a valid header never throws anything but Error and never hangs
    for (let s = 0; s < 40; s++) {
      const g = Uint8Array.from(t);
      for (let k = 0; k < 8; k++) g[8 + ((s * 37 + k * 53) % (g.length - 8))] ^= 0xff;
      try {
        readTiff(g);
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    }
  });
});
