import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { zlibSync } from '../../app/vendor/fflate/fflate.js';
import { fontContainer, woffToSfnt, ttcFonts, unwrapFont } from '../../app/src/engine/formats/fontwrap.js';

const u32 = (v) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

function sfnt(tables) {
  let off = 12 + tables.length * 16;
  const dir = [];
  const body = [];
  for (const [t, d] of tables) {
    dir.push(...ascii(t), ...u32(0), ...u32(off), ...u32(d.length));
    const padded = [...d, ...Array((4 - (d.length % 4)) % 4).fill(0)];
    body.push(...padded);
    off += padded.length;
  }
  return Uint8Array.from([0, 1, 0, 0, 0, tables.length, 0, 0, 0, 0, 0, 0, ...dir, ...body]);
}
function woff(tables, compress = true) {
  let off = 44 + tables.length * 20;
  const dir = [];
  const body = [];
  for (const [t, d] of tables) {
    const c = compress ? zlibSync(Uint8Array.from(d)) : Uint8Array.from(d);
    const use = c.length < d.length ? c : Uint8Array.from(d);
    dir.push(...ascii(t), ...u32(off), ...u32(use.length), ...u32(d.length), ...u32(0));
    body.push(...use, ...Array((4 - (use.length % 4)) % 4).fill(0));
    off += use.length + ((4 - (use.length % 4)) % 4);
  }
  return Uint8Array.from([...ascii('wOFF'), 0, 1, 0, 0, ...u32(off), 0, tables.length, 0, 0, ...Array(28).fill(0), ...dir, ...body]);
}
const tables = [['cmap', Array(200).fill(7)], ['head', [1, 2, 3, 4, 5]], ['glyf', Array.from({ length: 50 }, (_, i) => i)]];

describe('font containers', () => {
  it('detects containers', () => {
    assert.equal(fontContainer(sfnt(tables)), 'sfnt');
    assert.equal(fontContainer(woff(tables)), 'woff');
    assert.equal(fontContainer(Uint8Array.from([...ascii('wOF2'), ...Array(20).fill(0)])), 'woff2');
    assert.equal(fontContainer(Uint8Array.from(Array(20).fill(9))), 'unknown');
  });
  it('unwraps WOFF into an sfnt with identical tables', () => {
    const out = woffToSfnt(woff(tables));
    assert.equal(fontContainer(out), 'sfnt');
    const dv = new DataView(out.buffer);
    assert.equal(dv.getUint16(4), 3);
    const found = {};
    for (let i = 0; i < 3; i++) {
      const e = 12 + i * 16;
      const t = String.fromCharCode(...out.subarray(e, e + 4));
      found[t] = [...out.subarray(dv.getUint32(e + 8), dv.getUint32(e + 8) + dv.getUint32(e + 12))];
    }
    for (const [t, d] of tables) assert.deepEqual(found[t], d);
  });
  it('rejects damaged WOFF', () => {
    const w = woff(tables);
    assert.throws(() => woffToSfnt(w.subarray(0, 60)), /damaged|truncated/);
    const bad = Uint8Array.from(w);
    bad[44 + 8 + 3] = 255; // compressed length beyond the file
    assert.throws(() => woffToSfnt(bad), /truncated|damaged/);
  });
  it('splits a TrueType collection', () => {
    const a = sfnt(tables);
    const b2 = sfnt([['head', [9, 9, 9, 9]]]);
    const headLen = 12 + 8;
    // collection: header, two offsets, then the two fonts with their directory offsets rebased
    const rebase = (f, base) => {
      const c = Uint8Array.from(f);
      const dv = new DataView(c.buffer);
      for (let i = 0; i < dv.getUint16(4); i++) dv.setUint32(12 + i * 16 + 8, dv.getUint32(12 + i * 16 + 8) + base);
      return c;
    };
    const fa = rebase(a, headLen);
    const fb = rebase(b2, headLen + a.length);
    const ttc = Uint8Array.from([...ascii('ttcf'), 0, 1, 0, 0, ...u32(2), ...u32(headLen), ...u32(headLen + a.length), ...fa, ...fb]);
    const fonts = ttcFonts(ttc);
    assert.equal(fonts.length, 2);
    assert.equal(new DataView(fonts[1].buffer).getUint16(4), 1);
    assert.equal(unwrapFont(ttc).note.includes('2 fonts'), true);
  });
  it('passes sfnt and woff2 through and rejects others', () => {
    assert.equal(unwrapFont(sfnt(tables)).fonts.length, 1);
    assert.match(unwrapFont(Uint8Array.from([...ascii('wOF2'), ...Array(20).fill(0)])).note, /PDF/);
    assert.throws(() => unwrapFont(Uint8Array.from(Array(30).fill(1))), /not a TrueType/);
  });
});
