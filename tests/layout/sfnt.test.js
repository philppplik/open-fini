import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zlibSync } from '../../app/vendor/fflate/fflate.js';
import { parseFont, codePointCount } from '../../app/src/engine/layout/sfnt.js';

// ---------------------------------------------------------------------------------------------------------------
// a tiny synthetic TrueType font builder
// ---------------------------------------------------------------------------------------------------------------

class BW {
  constructor() {
    this.a = [];
  }
  u8(v) {
    this.a.push(v & 255);
    return this;
  }
  u16(v) {
    this.a.push((v >> 8) & 255, v & 255);
    return this;
  }
  i16(v) {
    return this.u16(v & 0xffff);
  }
  u32(v) {
    this.a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    return this;
  }
  str(s) {
    for (const c of s) this.a.push(c.charCodeAt(0));
    return this;
  }
  bytes(b) {
    for (const x of b) this.a.push(x);
    return this;
  }
  get length() {
    return this.a.length;
  }
  done() {
    return new Uint8Array(this.a);
  }
}

function rectGlyph(xMin, yMin, xMax, yMax) {
  const w = new BW();
  w.i16(1).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  w.u16(3); // endPtsOfContours
  w.u16(0); // instruction length
  for (let i = 0; i < 4; i++) w.u8(1); // on curve, 16 bit deltas
  const xs = [xMin, xMax - xMin, 0, xMin - xMax];
  const ys = [yMin, 0, yMax - yMin, 0];
  for (const x of xs) w.i16(x);
  for (const y of ys) w.i16(y);
  return w.done();
}

function compositeGlyph(parts) {
  const w = new BW();
  w.i16(-1).i16(0).i16(0).i16(700).i16(800);
  parts.forEach(([gid, dx, dy], i) => {
    const more = i < parts.length - 1 ? 0x20 : 0;
    w.u16(more | 0x01 | 0x02).u16(gid).i16(dx).i16(dy);
  });
  return w.done();
}

function pad4(b) {
  const out = new Uint8Array((b.length + 3) & ~3);
  out.set(b);
  return out;
}

function assemble(tables, flavor = 0x00010000) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const w = new BW();
  w.u32(flavor).u16(n).u16(0).u16(0).u16(0);
  let off = 12 + 16 * n;
  const blobs = [];
  for (const t of tags) {
    const data = tables[t];
    w.str(t).u32(0).u32(off).u32(data.length);
    const p = pad4(data);
    blobs.push(p);
    off += p.length;
  }
  for (const b of blobs) w.bytes(b);
  return w.done();
}

const GLYPHS = [
  { name: '.notdef', adv: 500, data: rectGlyph(50, 0, 450, 700) },
  { name: 'A', adv: 700, data: rectGlyph(10, 0, 690, 700) },
  { name: 'V', adv: 650, data: rectGlyph(10, 0, 640, 720) },
  { name: 'B', adv: 600, data: rectGlyph(20, 0, 580, 700) },
  { name: 'a', adv: 450, data: rectGlyph(30, 0, 420, 500) },
  { name: 'b', adv: 460, data: rectGlyph(30, 0, 430, 720) },
  { name: 'space', adv: 250, data: new Uint8Array(0) },
  { name: 'euro', adv: 800, data: rectGlyph(10, 0, 790, 700) },
  { name: 'smile', adv: 1000, data: rectGlyph(0, 0, 1000, 800) },
  { name: 'Aacute', adv: 700, data: compositeGlyph([[1, 0, 0], [2, 100, 0]]) },
];
const NUM_HMETRICS = 8;

function cmap4() {
  // segments sorted by end code; the 'a'..'b' segment uses idRangeOffset
  const segs = [
    { s: 0x20, e: 0x20, delta: 6 - 0x20 },
    { s: 0x41, e: 0x41, delta: 1 - 0x41 },
    { s: 0x42, e: 0x42, delta: 3 - 0x42 },
    { s: 0x56, e: 0x56, delta: 2 - 0x56 },
    { s: 0x61, e: 0x62, delta: 0, range: [4, 5] },
    { s: 0x20ac, e: 0x20ac, delta: 7 - 0x20ac },
    { s: 0xffff, e: 0xffff, delta: 1 },
  ];
  const n = segs.length;
  const w = new BW();
  w.u16(4).u16(0).u16(0).u16(n * 2).u16(0).u16(0).u16(0);
  for (const s of segs) w.u16(s.e);
  w.u16(0);
  for (const s of segs) w.u16(s.s);
  for (const s of segs) w.i16(s.delta);
  // idRangeOffset: offset from the entry itself to the glyph array element
  const glyphArray = [];
  const rangeOffsets = [];
  segs.forEach((s, i) => {
    if (s.range) {
      rangeOffsets.push((n - i) * 2 + glyphArray.length * 2);
      glyphArray.push(...s.range);
    } else rangeOffsets.push(0);
  });
  for (const r of rangeOffsets) w.u16(r);
  for (const g of glyphArray) w.u16(g);
  const b = w.done();
  new DataView(b.buffer).setUint16(2, b.length);
  return b;
}

function cmap12() {
  const groups = [
    [0x20, 0x20, 6],
    [0x41, 0x41, 1],
    [0x42, 0x42, 3],
    [0x56, 0x56, 2],
    [0x61, 0x62, 4],
    [0x20ac, 0x20ac, 7],
    [0x1f600, 0x1f600, 8],
  ];
  const w = new BW();
  w.u16(12).u16(0).u32(16 + groups.length * 12).u32(0).u32(groups.length);
  for (const [s, e, g] of groups) w.u32(s).u32(e).u32(g);
  return w.done();
}

function cmap0() {
  const w = new BW();
  w.u16(0).u16(262).u16(0);
  const arr = new Array(256).fill(0);
  arr[0x41] = 1;
  arr[0x56] = 2;
  arr[0x42] = 3;
  arr[0x61] = 4;
  arr[0x20] = 6;
  for (const v of arr) w.u8(v);
  return w.done();
}

function cmap6() {
  const w = new BW();
  w.u16(6).u16(10 + 6).u16(0).u16(0x41).u16(3).u16(1).u16(3).u16(0);
  return w.done();
}

function cmapTable(subtables) {
  // subtables: [{platform, enc, data}]
  const w = new BW();
  w.u16(0).u16(subtables.length);
  let off = 4 + subtables.length * 8;
  for (const s of subtables) {
    w.u16(s.platform).u16(s.enc).u32(off);
    off += s.data.length;
  }
  for (const s of subtables) w.bytes(s.data);
  return w.done();
}

function kernTable() {
  const pairs = [
    [1, 2, -80],
    [2, 1, -90],
  ];
  const w = new BW();
  w.u16(0).u16(1);
  w.u16(0).u16(14 + pairs.length * 6).u16(0x0001);
  w.u16(pairs.length).u16(0).u16(0).u16(0);
  for (const [l, r, v] of pairs) w.u16(l).u16(r).i16(v);
  return w.done();
}

function gposTable(fmt) {
  // header: version, scriptList, featureList, lookupList
  const feature = new BW().u16(0).u16(1).u16(0).done();
  const featureList = new BW().u16(1).str('kern').u16(8).bytes(feature).done();
  let sub;
  if (fmt === 1) {
    const cov = new BW().u16(1).u16(2).u16(1).u16(2).done();
    const ps1 = new BW().u16(1).u16(2).i16(-80).done(); // A: V -> -80
    const ps2 = new BW().u16(1).u16(1).i16(-90).done(); // V: A -> -90
    const head = 10 + 2 * 2;
    sub = new BW()
      .u16(1)
      .u16(head + 0)
      .u16(0x0004)
      .u16(0)
      .u16(2)
      .u16(head + cov.length)
      .u16(head + cov.length + ps1.length)
      .bytes(cov)
      .bytes(ps1)
      .bytes(ps2)
      .done();
    // coverage offset is relative to the subtable start
    new DataView(sub.buffer).setUint16(2, 14);
  } else {
    const cov = new BW().u16(1).u16(2).u16(1).u16(2).done();
    const cd1 = new BW().u16(2).u16(1).u16(1).u16(2).u16(1).done(); // glyphs 1..2 are class 1
    const cd2 = new BW().u16(2).u16(1).u16(1).u16(2).u16(1).done();
    const records = new BW().i16(0).i16(0).i16(0).i16(-70).done();
    const headLen = 16;
    const w = new BW().u16(2).u16(headLen + records.length).u16(0x0004).u16(0).u16(headLen + records.length + cov.length).u16(headLen + records.length + cov.length + cd1.length).u16(2).u16(2).bytes(records).bytes(cov).bytes(cd1).bytes(cd2);
    sub = w.done();
  }
  const lookup = new BW().u16(2).u16(0).u16(1).u16(8).bytes(sub).done();
  const lookupList = new BW().u16(1).u16(4).bytes(lookup).done();
  const scriptList = new BW().u16(0).done();
  const headerLen = 10;
  const w = new BW();
  w.u32(0x00010000).u16(headerLen).u16(headerLen + scriptList.length).u16(headerLen + scriptList.length + featureList.length);
  w.bytes(scriptList).bytes(featureList).bytes(lookupList);
  return w.done();
}

function buildTables(o = {}) {
  const glyphs = GLYPHS;
  const nG = glyphs.length;
  // glyf / loca (short format)
  const glyfParts = glyphs.map((g) => pad4(g.data));
  const loca = new BW();
  let pos = 0;
  for (let i = 0; i < nG; i++) {
    loca.u16(pos / 2);
    pos += glyfParts[i].length;
  }
  loca.u16(pos / 2);
  const glyf = new BW();
  for (const p of glyfParts) glyf.bytes(p);
  const head = new BW()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0)
    .u32(0x5f0f3cf5)
    .u16(0)
    .u16(1000)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .i16(0)
    .i16(-200)
    .i16(1000)
    .i16(900)
    .u16(o.macStyle || 0)
    .u16(8)
    .i16(2)
    .i16(0)
    .i16(0)
    .done();
  const hhea = new BW().u32(0x00010000).i16(o.hheaAscent ?? 800).i16(o.hheaDescent ?? -200).i16(90).u16(1000).i16(0).i16(0).i16(1000).i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(NUM_HMETRICS).done();
  const maxp = new BW().u32(0x00010000).u16(nG);
  for (let i = 0; i < 13; i++) maxp.u16(0);
  const hmtx = new BW();
  for (let i = 0; i < NUM_HMETRICS; i++) hmtx.u16(glyphs[i].adv).i16(5);
  for (let i = NUM_HMETRICS; i < nG; i++) hmtx.i16(7);
  const names = [
    [3, 1, 0x409, 1, 'Test Sans'],
    [3, 1, 0x409, 2, 'Regular'],
    [3, 1, 0x409, 4, 'Test Sans Regular'],
    [3, 1, 0x409, 6, 'TestSans-Regular'],
    [3, 1, 0x409, 16, o.typoFamily || 'Test Family'],
    [3, 1, 0x409, 17, 'Display'],
    [1, 0, 0, 1, 'Mac Name'],
  ];
  const strings = names.map((n) => {
    if (n[0] === 1) return new BW().str(n[4]).done();
    const b = new BW();
    for (const c of n[4]) b.u16(c.charCodeAt(0));
    return b.done();
  });
  const nameW = new BW().u16(0).u16(names.length).u16(6 + names.length * 12);
  let so = 0;
  names.forEach((n, i) => {
    nameW.u16(n[0]).u16(n[1]).u16(n[2]).u16(n[3]).u16(strings[i].length).u16(so);
    so += strings[i].length;
  });
  for (const s of strings) nameW.bytes(s);
  const os2 = new BW();
  os2.u16(4).i16(500).u16(o.weight ?? 400).u16(5).u16(o.fsType ?? 0);
  for (let i = 0; i < 10; i++) os2.u16(0); // 10..29 subscript etc.
  os2.i16(0); // sFamilyClass at 30
  os2.u8(2).u8(o.serif ?? 11);
  for (let i = 0; i < 8; i++) os2.u8(0); // rest of panose
  for (let i = 0; i < 4; i++) os2.u32(0); // unicode ranges 42..57
  os2.str('TEST').u16(o.fsSelection ?? 0).u16(0x20).u16(0xffff);
  os2.i16(o.typoAscender ?? 750).i16(o.typoDescender ?? -250).i16(o.typoGap ?? 100).u16(900).u16(300);
  os2.u32(0).u32(0).i16(500).i16(700).u16(0).u16(0).u16(0);
  const post = new BW().u32(0x00030000).u32(Math.round((o.italicAngle || 0) * 65536)).i16(-100).i16(50).u32(o.fixed ? 1 : 0).u32(0).u32(0).u32(0).u32(0).done();
  let cmap;
  switch (o.cmap || '4') {
    case '12':
      cmap = cmapTable([{ platform: 3, enc: 10, data: cmap12() }]);
      break;
    case 'both':
      cmap = cmapTable([{ platform: 3, enc: 1, data: cmap4() }, { platform: 3, enc: 10, data: cmap12() }]);
      break;
    case '0':
      cmap = cmapTable([{ platform: 1, enc: 0, data: cmap0() }]);
      break;
    case '6':
      cmap = cmapTable([{ platform: 1, enc: 0, data: cmap6() }]);
      break;
    case 'symbol': {
      // symbol cmap: codes live in the F000 range
      const w = new BW();
      w.u16(4).u16(32).u16(0).u16(4).u16(0).u16(0).u16(0).u16(0xf041).u16(0xffff).u16(0).u16(0xf041).u16(0xffff).i16(1 - 0xf041).i16(1).u16(0).u16(0);
      const b = w.done();
      new DataView(b.buffer).setUint16(2, b.length);
      cmap = cmapTable([{ platform: 3, enc: 0, data: b }]);
      break;
    }
    default:
      cmap = cmapTable([{ platform: 3, enc: 1, data: cmap4() }]);
  }
  const t = { head, hhea, maxp: maxp.done(), hmtx: hmtx.done(), loca: loca.done(), glyf: glyf.done(), name: nameW.done(), post, cmap };
  if (!o.noOS2) t['OS/2'] = os2.done();
  if (o.kern === 'kern') t.kern = kernTable();
  if (o.kern === 'gpos1') t.GPOS = gposTable(1);
  if (o.kern === 'gpos2') t.GPOS = gposTable(2);
  return t;
}

function buildFont(o) {
  return assemble(buildTables(o));
}

// ---------------------------------------------------------------------------------------------------------------

test('synthetic TrueType: names, metrics and flags', () => {
  const f = parseFont(buildFont({ italicAngle: -12, macStyle: 3, weight: 700, fsSelection: 0x01 }));
  assert.ok(f);
  assert.equal(f.family, 'Test Family', 'typographic family (ID 16) wins over family (ID 1)');
  assert.equal(f.subfamily, 'Display');
  assert.equal(f.fullName, 'Test Sans Regular');
  assert.equal(f.postscriptName, 'TestSans-Regular');
  assert.equal(f.weight, 700);
  assert.equal(f.italic, true);
  assert.equal(f.unitsPerEm, 1000);
  assert.equal(f.numGlyphs, GLYPHS.length);
  assert.equal(f.outline, 'glyf');
  assert.equal(f.isCFF, false);
  assert.equal(f.embeddable, true);
  assert.equal(f.italicAngle, -12);
  assert.deepEqual(f.bbox, [0, -200, 1000, 900]);
  // hhea metrics (the font does not set USE_TYPO_METRICS)
  assert.equal(f.ascent, 800);
  assert.equal(f.descent, 200, 'descent is a positive magnitude');
  assert.equal(f.lineGap, 90);
  assert.equal(f.capHeight, 700);
  assert.equal(f.xHeight, 500);
  assert.ok(f.flags & 32 && f.flags & 64 && !(f.flags & 1) && !(f.flags & 2));
  assert.ok(f.tableTags.includes('glyf') && f.tableTags.includes('OS/2'));
  assert.ok(f.bytes instanceof Uint8Array);
  // typographic metrics when requested
  const t = parseFont(buildFont({ fsSelection: 0x80 }));
  assert.deepEqual([t.ascent, t.descent, t.lineGap], [750, 250, 100]);
  // serif and fixed pitch flags
  const s = parseFont(buildFont({ serif: 4, fixed: true }));
  assert.ok(s.flags & 2 && s.flags & 1);
  assert.equal(parseFont(buildFont({ weight: 0, macStyle: 1 })).weight, 700, 'weight falls back to macStyle');
  // no OS/2: weight and italic from macStyle, metrics from hhea, estimated cap / x height from glyph bounds
  const n = parseFont(buildFont({ noOS2: true, macStyle: 2 }));
  assert.equal(n.weight, 400);
  assert.equal(n.italic, true);
  assert.equal(n.capHeight, 700, "measured from the glyph 'H' fallback (missing: estimated)");
  assert.equal(n.xHeight, 500);
  // a font license that forbids embedding
  assert.equal(parseFont(buildFont({ fsType: 2 })).embeddable, false);
  assert.equal(parseFont(buildFont({ fsType: 8 })).embeddable, true);
});

test('cmap formats 4, 12, 0 and 6 and symbol fonts', () => {
  const check4 = (f, skipAstral) => {
    assert.equal(f.glyphForCodePoint(0x41), 1);
    assert.equal(f.glyphForCodePoint(0x56), 2);
    assert.equal(f.glyphForCodePoint(0x42), 3);
    assert.equal(f.glyphForCodePoint(0x61), 4, 'idRangeOffset segment');
    assert.equal(f.glyphForCodePoint(0x62), 5);
    assert.equal(f.glyphForCodePoint(0x20), 6);
    assert.equal(f.glyphForCodePoint(0x20ac), 7);
    for (const cp of [0x43, 0x63, 0x0, 0x7f, 0xffff, 0x10ffff, -1, 1e9, NaN, ...(skipAstral ? [] : [0x1f600])]) assert.equal(f.glyphForCodePoint(cp), 0, `U+${cp} is unmapped`);
  };
  check4(parseFont(buildFont({ cmap: '4' })));
  const f12 = parseFont(buildFont({ cmap: '12' }));
  check4(f12, true);
  assert.equal(f12.glyphForCodePoint(0x1f600), 8, 'format 12 reaches beyond the BMP');
  const both = parseFont(buildFont({ cmap: 'both' }));
  assert.equal(both.glyphForCodePoint(0x1f600), 8, 'format 12 is preferred');
  assert.equal(both.glyphForCodePoint(0x41), 1);
  const f0 = parseFont(buildFont({ cmap: '0' }));
  assert.deepEqual([0x41, 0x56, 0x42, 0x61, 0x20, 0x43].map((c) => f0.glyphForCodePoint(c)), [1, 2, 3, 4, 6, 0]);
  assert.equal(f0.glyphForCodePoint(0xe9), 0, 'legacy Mac cmaps only serve ASCII');
  const f6 = parseFont(buildFont({ cmap: '6' }));
  assert.deepEqual([0x41, 0x42, 0x43, 0x44].map((c) => f6.glyphForCodePoint(c)), [1, 3, 0, 0]);
  const sym = parseFont(buildFont({ cmap: 'symbol' }));
  assert.equal(sym.glyphForCodePoint(0xf041), 1);
  assert.equal(sym.glyphForCodePoint(0x41), 1, 'symbol fonts are reached through the F000 range');
  assert.ok(sym.flags & 4 && !(sym.flags & 32), 'symbolic flag');
});

test('advance widths, glyph bounds and measuring', () => {
  const f = parseFont(buildFont({ kern: 'kern' }));
  assert.deepEqual([0, 1, 2, 3, 7].map((g) => f.advanceWidth(g)), [500, 700, 650, 600, 800]);
  assert.equal(f.advanceWidth(8), 800, 'glyphs past numberOfHMetrics share the last advance');
  assert.equal(f.advanceWidth(9), 800);
  assert.equal(f.advanceWidth(10), 0);
  assert.equal(f.advanceWidth(-1), 0);
  assert.equal(f.advanceWidth(NaN), 0);
  assert.deepEqual(f.glyphBounds(1), [10, 0, 690, 700]);
  assert.deepEqual(f.glyphBounds(2), [10, 0, 640, 720]);
  assert.equal(f.glyphBounds(6), null, 'the space has no outline');
  assert.equal(f.glyphBounds(99), null);
  // measure: advances + kerning + tracking, code points not code units
  assert.equal(f.measure('AB', 100), (700 + 600) * 0.1);
  assert.equal(f.measure('AV', 100), (700 + 650 - 80) * 0.1);
  assert.equal(f.measure('AV', 100, { kerning: false }), (700 + 650) * 0.1);
  assert.equal(f.measure('AV', 100, { tracking: 100 }), (700 + 650 - 80) * 0.1 + 2 * 10);
  assert.equal(f.measure('', 12), 0);
  const astral = parseFont(buildFont({ cmap: '12' }));
  assert.equal(astral.measure('\u{1f600}', 10), 8, 'a surrogate pair is one glyph (advance shared past numberOfHMetrics)');
  assert.equal(astral.measure('\u{1f600}', 10, { tracking: 1000 }), 18, 'and one tracking unit');
  assert.equal(f.measure('Q', 10), 5, 'unmapped characters use the .notdef advance');
  assert.equal(codePointCount('a\u{1f600}b'), 3);
});

test('kerning from the kern table and GPOS pair adjustment (formats 1 and 2)', () => {
  const none = parseFont(buildFont({}));
  assert.equal(none.kerning(1, 2), 0);
  const kern = parseFont(buildFont({ kern: 'kern' }));
  assert.equal(kern.kerning(1, 2), -80);
  assert.equal(kern.kerning(2, 1), -90);
  assert.equal(kern.kerning(1, 3), 0);
  assert.equal(kern.kerning(0, 1), 0);
  const g1 = parseFont(buildFont({ kern: 'gpos1' }));
  assert.equal(g1.kerning(1, 2), -80);
  assert.equal(g1.kerning(2, 1), -90);
  assert.equal(g1.kerning(1, 1), 0);
  assert.equal(g1.kerning(3, 2), 0, 'glyph not covered');
  const g2 = parseFont(buildFont({ kern: 'gpos2' }));
  assert.equal(g2.kerning(1, 2), -70, 'class based adjustment');
  assert.equal(g2.kerning(2, 1), -70);
  assert.equal(g2.kerning(1, 1), -70, 'any pair of the two classes');
  assert.equal(g2.kerning(3, 2), 0, 'glyph not covered');
  assert.equal(g2.measure('AV', 100), (700 + 650 - 70) * 0.1);
});

test('WOFF 1.0 is unwrapped, WOFF2 and garbage are rejected, TTC picks a font', () => {
  const ttf = buildFont({ kern: 'kern' });
  const dv = new DataView(ttf.buffer);
  const n = dv.getUint16(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(...ttf.subarray(r, r + 4));
    const off = dv.getUint32(r + 8);
    const len = dv.getUint32(r + 12);
    tables.push({ tag, data: ttf.subarray(off, off + len) });
  }
  const wrap = (compressAll) => {
    let offset = 44 + n * 20;
    const blobs = [];
    const dir = new BW();
    for (const t of tables) {
      const z = zlibSync(t.data);
      const useZ = compressAll && z.length < t.data.length;
      const body = useZ ? z : t.data;
      dir.str(t.tag).u32(offset).u32(body.length).u32(t.data.length).u32(0);
      const p = pad4(body);
      blobs.push(p);
      offset += p.length;
    }
    const w = new BW();
    w.u32(0x774f4646).u32(0x00010000).u32(offset).u16(n).u16(0).u32(ttf.length).u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
    w.bytes(dir.done());
    for (const b of blobs) w.bytes(b);
    return w.done();
  };
  const ref = parseFont(ttf);
  for (const compressed of [true, false]) {
    const w = parseFont(wrap(compressed));
    assert.ok(w, `woff (compressed tables: ${compressed})`);
    assert.equal(w.family, ref.family);
    assert.equal(w.numGlyphs, ref.numGlyphs);
    assert.equal(w.glyphForCodePoint(0x41), 1);
    assert.equal(w.kerning(1, 2), -80);
    assert.deepEqual(w.glyphBounds(1), ref.glyphBounds(1));
    // `bytes` is a standalone sfnt that parses again
    const again = parseFont(w.bytes);
    assert.equal(again.family, 'Test Family');
    assert.equal(again.measure('AV', 100), ref.measure('AV', 100));
  }
  // table length that does not match the inflated size, truncated data
  const bad = wrap(true);
  new DataView(bad.buffer).setUint32(44 + 12, 99999); // origLength of table 0
  assert.equal(parseFont(bad), null);
  assert.equal(parseFont(wrap(true).subarray(0, 120)), null);
  // WOFF2
  const w2 = wrap(true);
  new DataView(w2.buffer).setUint32(0, 0x774f4632);
  assert.equal(parseFont(w2), null);
  // TTC with two fonts
  const a = buildFont({});
  const b = buildFont({ typoFamily: 'Second Family' });
  const ttcHeaderLen = 12 + 8;
  const copy = (f, base) => {
    // rewrite the table directory offsets for the position inside the collection
    const out = f.slice();
    const odv = new DataView(out.buffer);
    for (let i = 0; i < odv.getUint16(4); i++) odv.setUint32(12 + i * 16 + 8, odv.getUint32(12 + i * 16 + 8) + base);
    return out;
  };
  const ttc = new BW();
  ttc.str('ttcf').u32(0x00010000).u32(2).u32(ttcHeaderLen).u32(ttcHeaderLen + a.length);
  ttc.bytes(copy(a, ttcHeaderLen)).bytes(copy(b, ttcHeaderLen + a.length));
  const tbytes = ttc.done();
  assert.equal(parseFont(tbytes).family, 'Test Family');
  assert.equal(parseFont(tbytes, { index: 1 }).family, 'Second Family');
  assert.equal(parseFont(tbytes, { index: 2 }), null);
  assert.equal(parseFont(tbytes, { index: 1 }).glyphForCodePoint(0x41), 1);
  // CFF flavored fonts are recognized (outlines are not parsed), CFF2 cannot be embedded
  const cffTables = buildTables({});
  delete cffTables.glyf;
  delete cffTables.loca;
  cffTables['CFF '] = new Uint8Array(32);
  const cff = parseFont(assemble(cffTables, 0x4f54544f));
  assert.equal(cff.outline, 'cff');
  assert.equal(cff.isCFF, true);
  assert.equal(cff.embeddable, true);
  assert.equal(cff.glyphBounds(1), null);
  const cff2Tables = { ...cffTables };
  delete cff2Tables['CFF '];
  cff2Tables.CFF2 = new Uint8Array(32);
  const cff2 = parseFont(assemble(cff2Tables, 0x4f54544f));
  assert.equal(cff2.outline, 'cff2');
  assert.equal(cff2.embeddable, false);
  // no outlines at all
  const empty = buildTables({});
  delete empty.glyf;
  delete empty.loca;
  assert.equal(parseFont(assemble(empty)), null);
});

test('malformed input never throws: truncation, bit flips and random bytes', () => {
  const rand = (() => {
    let s = 7;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  })();
  const exercise = (info) => {
    if (!info) return;
    for (const cp of [0x41, 0x61, 0x20ac, 0x1f600, 0, -3, 0xffffff]) info.glyphForCodePoint(cp);
    for (const g of [0, 1, 2, 9, 1000, -1]) {
      info.advanceWidth(g);
      info.glyphBounds(g);
      info.kerning(g, 1);
    }
    info.measure('AVAV \u00e9\u20ac\u{1f600}', 12, { tracking: 10 });
    for (const t of info.tableTags.slice(0, 20)) info.getTable(t);
  };
  const bases = [buildFont({ kern: 'kern', cmap: 'both' }), buildFont({ kern: 'gpos1' }), buildFont({ kern: 'gpos2', cmap: '0' })];
  const arialPath = 'C:\\Windows\\Fonts\\arial.ttf';
  if (fs.existsSync(arialPath)) bases.push(new Uint8Array(fs.readFileSync(arialPath)));
  let parsedOk = 0;
  for (const base of bases) {
    for (let i = 0; i < 150; i++) {
      const b = base.slice();
      const mode = i % 3;
      if (mode === 0) {
        const cut = Math.floor(rand() * b.length);
        const info = parseFont(b.subarray(0, cut));
        exercise(info);
        if (info) parsedOk++;
      } else {
        const flips = 1 + Math.floor(rand() * 12);
        const limit = mode === 1 ? Math.min(b.length, 600) : b.length;
        for (let k = 0; k < flips; k++) b[Math.floor(rand() * limit)] = Math.floor(rand() * 256);
        const info = parseFont(b);
        exercise(info);
        if (info) parsedOk++;
      }
    }
  }
  assert.ok(parsedOk > 0);
  for (let i = 0; i < 200; i++) {
    const r = new Uint8Array(Math.floor(rand() * 300));
    for (let k = 0; k < r.length; k++) r[k] = Math.floor(rand() * 256);
    assert.equal(parseFont(r), null);
  }
  for (const v of [null, undefined, 5, 'str', {}, [], new Uint8Array(0), new Uint8Array(11), new ArrayBuffer(4)]) assert.equal(parseFont(v), null);
  // an ArrayBuffer and a Node Buffer both work
  const font = buildFont({});
  assert.ok(parseFont(font.buffer.slice(0)));
  assert.ok(parseFont(Buffer.from(font)));
});

const FONT_DIR = 'C:\\Windows\\Fonts';
const real = (name) => path.join(FONT_DIR, name);

test('real fonts from the system (skipped when not installed)', { skip: !fs.existsSync(real('arial.ttf')) && 'Arial is not installed' }, () => {
  const arial = parseFont(new Uint8Array(fs.readFileSync(real('arial.ttf'))));
  assert.equal(arial.family, 'Arial');
  assert.equal(arial.weight, 400);
  assert.equal(arial.italic, false);
  assert.equal(arial.unitsPerEm, 2048);
  assert.equal(arial.postscriptName, 'ArialMT');
  assert.equal(arial.outline, 'glyf');
  assert.ok(arial.numGlyphs > 3000);
  assert.equal(arial.advanceWidth(arial.glyphForCodePoint(0x41)), 1366);
  assert.equal(arial.advanceWidth(arial.glyphForCodePoint(0x20)), 569);
  assert.ok(arial.kerning(arial.glyphForCodePoint(0x41), arial.glyphForCodePoint(0x56)) < 0, 'AV is kerned');
  assert.equal(arial.glyphForCodePoint(0x1f600), 0);
  assert.ok(arial.glyphForCodePoint(0x20ac) > 0);
  assert.ok(arial.glyphForCodePoint(0xe9) > 0);
  assert.ok(Math.abs(arial.measure('Hello', 16) - (1479 + 1139 + 455 + 455 + 1139) * 16 / 2048) < 1.5);
  for (const [file, weight, italic] of [['arialbd.ttf', 700, false], ['ariali.ttf', 400, true], ['arialbi.ttf', 700, true]]) {
    if (!fs.existsSync(real(file))) continue;
    const f = parseFont(new Uint8Array(fs.readFileSync(real(file))));
    assert.equal(f.family, 'Arial');
    assert.equal(f.weight, weight, file);
    assert.equal(f.italic, italic, file);
  }
  if (fs.existsSync(real('consola.ttf'))) {
    const c = parseFont(new Uint8Array(fs.readFileSync(real('consola.ttf'))));
    assert.ok(c.flags & 1, 'Consolas is fixed pitch');
    assert.equal(c.advanceWidth(c.glyphForCodePoint(0x69)), c.advanceWidth(c.glyphForCodePoint(0x57)));
  }
  if (fs.existsSync(real('cambria.ttc'))) {
    const c0 = parseFont(new Uint8Array(fs.readFileSync(real('cambria.ttc'))));
    const c1 = parseFont(new Uint8Array(fs.readFileSync(real('cambria.ttc'))), { index: 1 });
    assert.equal(c0.family, 'Cambria');
    assert.ok(c1 && c1.family.startsWith('Cambria'));
  }
});
