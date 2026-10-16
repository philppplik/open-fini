import test from 'node:test';
import assert from 'node:assert/strict';
import { readPsd, writePsd } from '../../app/src/engine/formats/index.js';
import { B, enc, buildPsd, sectionBlock, fill } from './_psd-fixture.js';

// deterministic PRNG
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const rgbaOf = (w, h, f) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = f(i);
    d.set([r, g, b, a], i * 4);
  }
  return d;
};

/** Standard 4-channel layer (alpha, R, G, B) from flat colors. */
function solidChans(w, h, [r, g, b], alpha, e = 'rle', psb = false) {
  const n = w * h;
  const mk = (v) => (e === 'raw' ? enc.raw(fill(n, v)) : e === 'rle' ? enc.rle(fill(n, v), h, psb) : enc.zip(fill(n, v)));
  return [{ id: -1, data: mk(alpha) }, { id: 0, data: mk(r) }, { id: 1, data: mk(g) }, { id: 2, data: mk(b) }];
}

test('composite only: raw RGB 8-bit, no layers', () => {
  const planes = [[255, 0, 0, 10], [0, 255, 0, 20], [0, 0, 255, 30]];
  const comp = [0, 0, ...planes.flat()];
  const doc = readPsd(buildPsd({ width: 2, height: 2, composite: comp }));
  assert.equal(doc.version, 1);
  assert.equal(doc.colorMode, 'rgb');
  assert.equal(doc.depth, 8);
  assert.equal(doc.layers.length, 0);
  assert.deepEqual([...doc.composite.data.slice(0, 8)], [255, 0, 0, 255, 0, 255, 0, 255]);
  assert.deepEqual([...doc.composite.data.slice(8, 12)], [0, 0, 255, 255]);
});

test('composite only: RLE compressed with row table', () => {
  const planes = [fill(6, 200), fill(6, 100), [1, 2, 3, 4, 5, 6]];
  const rows = [];
  for (const p of planes) for (let y = 0; y < 2; y++) rows.push(p.slice(y * 3, y * 3 + 3));
  const { packRow } = { packRow: (r) => (new Set(r).size === 1 ? [257 - r.length, r[0]] : [r.length - 1, ...r]) };
  const packed = rows.map(packRow);
  const b = new B().u16(1);
  for (const p of packed) b.u16(p.length);
  for (const p of packed) b.bytes(p);
  const doc = readPsd(buildPsd({ width: 3, height: 2, composite: b.a }));
  assert.deepEqual([...doc.composite.data.slice(0, 4)], [200, 100, 1, 255]);
  assert.deepEqual([...doc.composite.data.slice(20, 24)], [200, 100, 6, 255]);
});

test('layers: RLE, groups, mask, luni, opacity/fill, blend, hidden, clipping', () => {
  const W = 4, H = 4;
  const bg = { top: 0, left: 0, bottom: 4, right: 4, name: 'Background', chans: solidChans(4, 4, [10, 20, 30], 255) };
  const divider = {
    top: 0, left: 0, bottom: 0, right: 0, name: '</Layer group>',
    chans: [{ id: -1, data: [0, 0] }, { id: 0, data: [0, 0] }, { id: 1, data: [0, 0] }, { id: 2, data: [0, 0] }],
    blocks: [['lsct', sectionBlock(3)]],
  };
  const maskPlane = [0, 100];
  const child = {
    top: 1, left: 1, bottom: 3, right: 3, name: 'chld', blend: 'mul ', opacity: 128, clip: 1, flags: 2,
    chans: [...solidChans(2, 2, [200, 100, 50], 128), { id: -2, data: enc.rle(maskPlane, 1) }],
    mask: { top: 1, left: 1, bottom: 2, right: 3, def: 255 },
    blocks: [['luni', new B().utf16('Ünï').a]],
  };
  const header = {
    top: 0, left: 0, bottom: 0, right: 0, name: 'Folder', blend: 'pass', opacity: 200,
    chans: [{ id: -1, data: [0, 0] }, { id: 0, data: [0, 0] }, { id: 1, data: [0, 0] }, { id: 2, data: [0, 0] }],
    blocks: [['lsct', sectionBlock(1, 'pass')]],
  };
  const top = {
    top: 2, left: 2, bottom: 4, right: 4, name: 'top', opacity: 255,
    chans: solidChans(2, 2, [1, 2, 3], 255, 'raw'), blocks: [['iOpa', [128]], ['lspf', [0, 0, 0, 1]]],
  };
  const doc = readPsd(buildPsd({ width: W, height: H, layers: [bg, divider, child, header, top], negativeCount: true, blockPad: 2 }));
  assert.equal(doc.layers.length, 4);
  const [L0, G, C, T] = doc.layers;
  assert.equal(L0.name, 'Background');
  assert.equal(L0.kind, 'pixel');
  assert.equal(L0.parentIndex, -1);
  assert.deepEqual([...L0.rgba.slice(0, 4)], [10, 20, 30, 255]);
  assert.equal(G.kind, 'group');
  assert.equal(G.name, 'Folder');
  assert.equal(G.blend, 'pass-through');
  assert.ok(Math.abs(G.opacity - 200 / 255) < 1e-9);
  assert.equal(G.parentIndex, -1);
  assert.equal(C.name, 'Ünï');
  assert.equal(C.parentIndex, 1);
  assert.equal(C.groupDepth, 1);
  assert.equal(C.blend, 'multiply');
  assert.equal(C.visible, false);
  assert.equal(C.clipping, true);
  assert.equal(C.x, 1);
  assert.equal(C.width, 2);
  assert.deepEqual([...C.rgba.slice(0, 4)], [200, 100, 50, 128]);
  assert.ok(Math.abs(C.opacity - 128 / 255) < 1e-9);
  assert.deepEqual([...C.mask.data], [0, 100, 255, 255]);
  assert.equal(C.mask.width, 2);
  assert.equal(T.parentIndex, -1);
  assert.equal(T.groupDepth, 0);
  assert.ok(Math.abs(T.opacity - 128 / 255) < 1e-9);
  assert.equal(T.locked, true);
  assert.equal(doc.composite, null);
});

test('ZIP and ZIP-with-prediction channels (8 and 16 bit)', () => {
  // 8-bit
  const plane = [5, 9, 20, 200, 201, 202];
  const mk = (e) => ({
    top: 0, left: 0, bottom: 2, right: 3, name: 'z',
    chans: [
      { id: 0, data: e(plane) }, { id: 1, data: e(plane.map((v) => 255 - v)) }, { id: 2, data: e(fill(6, 7)) },
    ],
  });
  for (const e of [enc.zip, (p) => enc.zipPred(p, 3, 2, 8)]) {
    const doc = readPsd(buildPsd({ width: 3, height: 2, layers: [mk(e)] }), { readComposite: false });
    assert.deepEqual([...doc.layers[0].rgba.slice(0, 12)], [5, 250, 7, 255, 9, 246, 7, 255, 20, 235, 7, 255]);
    assert.equal(doc.warnings.length, 0);
  }
  // 16-bit with prediction
  const p16 = [0x00, 0x00, 0x80, 0x00, 0xff, 0xff, 0x12, 0x34, 0x00, 0x01, 0xff, 0x00];
  const l16 = {
    top: 0, left: 0, bottom: 2, right: 3, name: '16',
    chans: [0, 1, 2].map((id) => ({ id, data: enc.zipPred(p16, 3, 2, 16) })),
  };
  const doc = readPsd(buildPsd({ width: 3, height: 2, depth: 16, layers: [l16] }));
  const px = [...doc.layers[0].rgba];
  assert.deepEqual([px[0], px[4], px[8], px[12], px[16], px[20]], [0, 128, 255, 18, 0, 255]);
  assert.equal(doc.depth, 16);
});

test('16-bit raw layer data and Lr16 layer container', () => {
  const plane = [0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x40, 0x00];
  const layer = {
    top: 0, left: 0, bottom: 2, right: 2, name: 'sixteen',
    chans: [-1, 0, 1, 2].map((id) => ({ id, data: enc.raw(plane) })),
  };
  const doc = readPsd(buildPsd({ width: 2, height: 2, depth: 16, layers: [layer], layerKey: 'Lr16' }));
  assert.equal(doc.layers.length, 1);
  assert.equal(doc.layers[0].name, 'sixteen');
  assert.deepEqual([...doc.layers[0].rgba.slice(0, 8)], [255, 255, 255, 255, 128, 128, 128, 128]);
});

test('32-bit float data converts with a warning', () => {
  const f = new B();
  for (const v of [0, 0.5, 1, 2]) {
    const d = new DataView(new ArrayBuffer(4));
    d.setFloat32(0, v);
    f.bytes([d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)]);
  }
  const layer = { top: 0, left: 0, bottom: 2, right: 2, name: 'f', chans: [0, 1, 2].map((id) => ({ id, data: enc.raw(f.a) })) };
  const doc = readPsd(buildPsd({ width: 2, height: 2, depth: 32, layers: [layer] }));
  assert.deepEqual([doc.layers[0].rgba[0], doc.layers[0].rgba[4], doc.layers[0].rgba[8], doc.layers[0].rgba[12]], [0, 128, 255, 255]);
  assert.ok(doc.warnings.some((w) => /32-bit/.test(w)));
});

test('grayscale, CMYK, indexed, Lab, bitmap', () => {
  // grayscale layer + alpha
  const g = { top: 0, left: 0, bottom: 1, right: 2, name: 'g', chans: [{ id: -1, data: enc.raw([255, 128]) }, { id: 0, data: enc.raw([10, 200]) }] };
  let doc = readPsd(buildPsd({ width: 2, height: 1, mode: 1, nch: 1, layers: [g] }));
  assert.equal(doc.colorMode, 'grayscale');
  assert.deepEqual([...doc.layers[0].rgba], [10, 10, 10, 255, 200, 200, 200, 128]);

  // CMYK: 255 = no ink. First pixel white, second pure cyan (C ink full: stored 0)
  const cm = { top: 0, left: 0, bottom: 1, right: 2, name: 'c', chans: [0, 1, 2, 3].map((id) => ({ id, data: enc.raw(id === 0 ? [255, 0] : [255, 255]) })) };
  doc = readPsd(buildPsd({ width: 2, height: 1, mode: 4, nch: 4, layers: [cm] }));
  assert.equal(doc.colorMode, 'cmyk');
  assert.deepEqual([...doc.layers[0].rgba], [255, 255, 255, 255, 0, 255, 255, 255]);

  // indexed
  const pal = [...fill(256, 0), ...fill(256, 0), ...fill(256, 0)];
  pal[1] = 255; // index 1 = red
  pal[256 + 2] = 255; // index 2 = green
  const ix = { top: 0, left: 0, bottom: 1, right: 2, name: 'i', chans: [{ id: 0, data: enc.raw([1, 2]) }] };
  doc = readPsd(buildPsd({ width: 2, height: 1, mode: 2, nch: 1, colorModeData: pal, layers: [ix] }));
  assert.equal(doc.colorMode, 'indexed');
  assert.deepEqual([...doc.layers[0].rgba], [255, 0, 0, 255, 0, 255, 0, 255]);

  // Lab: L=255 (100), a=b=128 (0) -> white; L=0 -> black
  const lab = { top: 0, left: 0, bottom: 1, right: 2, name: 'l', chans: [{ id: 0, data: enc.raw([255, 0]) }, { id: 1, data: enc.raw([128, 128]) }, { id: 2, data: enc.raw([128, 128]) }] };
  doc = readPsd(buildPsd({ width: 2, height: 1, mode: 9, nch: 3, layers: [lab] }));
  assert.equal(doc.colorMode, 'lab');
  const lp = doc.layers[0].rgba;
  assert.ok(lp[0] > 250 && lp[1] > 250 && lp[2] > 250);
  assert.ok(lp[4] < 5 && lp[5] < 5 && lp[6] < 5);

  // bitmap composite: 1 = black, 10 pixels wide -> 2 bytes per row
  doc = readPsd(buildPsd({ width: 10, height: 1, depth: 1, mode: 0, nch: 1, composite: [0, 0, 0b10100000, 0b01000000] }));
  assert.equal(doc.colorMode, 'bitmap');
  const bp = doc.composite.data;
  assert.equal(bp[0], 0); // pixel 0 black
  assert.equal(bp[4], 255); // pixel 1 white
  assert.equal(bp[8], 0); // pixel 2 black
  assert.equal(bp[8 * 4], 255); // pixel 8 white
  assert.equal(bp[9 * 4], 0); // pixel 9 black (second byte 0b01000000)
});

test('PSB: 8-byte lengths and 4-byte RLE counts', () => {
  const layer = { top: 0, left: 0, bottom: 2, right: 2, name: 'big', chans: solidChans(2, 2, [9, 8, 7], 255, 'rle', true) };
  const doc = readPsd(buildPsd({ psb: true, width: 2, height: 2, layers: [layer] }));
  assert.equal(doc.version, 2);
  assert.equal(doc.layers.length, 1);
  assert.deepEqual([...doc.layers[0].rgba.slice(0, 4)], [9, 8, 7, 255]);
  // PSB composite with RLE (4-byte counts)
  const planes = [[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]];
  const b = new B().u16(1);
  const rows = [];
  for (const p of planes) for (let y = 0; y < 2; y++) rows.push([255, p[0]]);
  for (const r of rows) b.u32(r.length);
  for (const r of rows) b.bytes(r);
  const d2 = readPsd(buildPsd({ psb: true, width: 2, height: 2, composite: b.a }));
  assert.deepEqual([...d2.composite.data.slice(0, 4)], [1, 2, 3, 255]);
});

test('text layer: TySh descriptor, engine data size and color', () => {
  const eng = '<<\n/EngineDict <<\n/StyleRun << /RunArray [ << /StyleSheet << /StyleSheetData << /FontSize 24.0 /FillColor << /Type 1\n/Values [ 1.0 1.0 0.0 0.0 ] >> >> >> >> ] >> >> >>';
  const d = new B().u16(1);
  d.f64(1).f64(0).f64(0).f64(1).f64(12.5).f64(40.25);
  d.u16(50).u32(16);
  d.u32(0).u32(0).ascii('TxLr').u32(2);
  d.u32(0).ascii('Txt ').ascii('TEXT').utf16('Hello\rWorld');
  d.u32(10).ascii('EngineData').ascii('tdta').u32(eng.length).ascii(eng);
  const layer = {
    top: 0, left: 0, bottom: 1, right: 1, name: 'T', chans: solidChans(1, 1, [0, 0, 0], 255),
    blocks: [['TySh', d.a]],
  };
  const doc = readPsd(buildPsd({ width: 2, height: 2, layers: [layer] }));
  const L = doc.layers[0];
  assert.equal(L.kind, 'text');
  assert.equal(L.text.content, 'Hello\nWorld');
  assert.equal(L.text.fontSize, 24);
  assert.equal(L.text.color, '#ff0000');
  assert.equal(L.text.x, 12.5);
  assert.equal(L.text.y, 40.25);
  assert.ok(L.rgba);
});

test('adjustment, smart object and effects produce kinds and warnings', () => {
  const adj = { top: 0, left: 0, bottom: 0, right: 0, name: 'Curves 1', chans: [{ id: 0, data: [0, 0] }], blocks: [['curv', [0, 0, 0, 1]]] };
  const smart = { top: 0, left: 0, bottom: 1, right: 1, name: 'Smart', chans: solidChans(1, 1, [1, 2, 3], 255), blocks: [['SoLd', [1, 2, 3, 4]], ['lrFX', [0, 0, 0, 0]], ['xxxx', [9, 9, 9, 9]]] };
  const doc = readPsd(buildPsd({ width: 2, height: 2, layers: [adj, smart] }));
  assert.equal(doc.layers[0].kind, 'adjustment');
  assert.equal(doc.layers[0].rgba, null);
  assert.equal(doc.layers[1].kind, 'other');
  assert.ok(doc.layers[1].rgba);
  assert.equal(doc.warnings.filter((w) => /Curves 1|Smart|effects/.test(w)).length, 3);
});

test('writePsd -> readPsd round trip with random pixels, groups, masks of names', () => {
  const rand = rng(42);
  const mk = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < d.length; i++) d[i] = Math.floor(rand() * 256);
    return d;
  };
  const layers = [
    { name: 'Hintergrund', x: 0, y: 0, width: 13, height: 9, rgba: mk(13, 9) },
    { name: 'Gruppe äö 日本', kind: 'group', opacity: 0.5, blend: 'pass-through' },
    { name: 'in group', x: 2, y: -1, width: 5, height: 4, rgba: mk(5, 4), parentIndex: 1, blend: 'screen', opacity: 0.25, visible: false, clipping: true },
    { name: 'nested', kind: 'group', parentIndex: 1, blend: 'multiply', visible: false },
    { name: 'deep', x: 3, y: 3, width: 2, height: 2, rgba: mk(2, 2), parentIndex: 3 },
    { name: 'empty', x: 0, y: 0, width: 0, height: 0, rgba: null },
    { name: 'last', x: 1, y: 1, width: 1, height: 1, rgba: mk(1, 1), blend: 'color-dodge' },
  ];
  for (const compress of ['rle', 'raw']) {
    const bytes = writePsd({ width: 13, height: 9, layers }, { compress });
    const doc = readPsd(bytes);
    assert.equal(doc.version, 1);
    assert.equal(doc.width, 13);
    assert.equal(doc.depth, 8);
    assert.equal(doc.layers.length, layers.length);
    assert.deepEqual(doc.warnings, []);
    layers.forEach((src, i) => {
      const got = doc.layers[i];
      assert.equal(got.name, src.name);
      assert.equal(got.kind, src.kind === 'group' ? 'group' : 'pixel');
      assert.equal(got.parentIndex, src.parentIndex ?? -1);
      assert.equal(got.visible, src.visible !== false);
      assert.equal(got.clipping, !!src.clipping);
      assert.ok(Math.abs(got.opacity - (src.opacity ?? 1)) < 0.003);
      assert.equal(got.blend, src.blend || (src.kind === 'group' ? 'pass-through' : 'normal'));
      if (src.rgba) {
        assert.equal(got.x, src.x);
        assert.equal(got.y, src.y);
        assert.equal(got.width, src.width);
        assert.deepEqual([...got.rgba], [...src.rgba]);
      } else {
        assert.equal(got.rgba, null);
      }
    });
    assert.equal(doc.layers[2].groupDepth, 1);
    assert.equal(doc.layers[4].groupDepth, 2);
    assert.equal(doc.layers[4].parentIndex, 3);
    assert.equal(doc.composite.width, 13);
    assert.equal(doc.composite.data.length, 13 * 9 * 4);
  }
});

test('writePsd composite: supplied, computed and source-over', () => {
  const red = new Uint8ClampedArray([255, 0, 0, 255]);
  const half = new Uint8ClampedArray([0, 0, 255, 255]);
  const bytes = writePsd({
    width: 2, height: 1,
    layers: [
      { name: 'a', x: 0, y: 0, width: 1, height: 1, rgba: red },
      { name: 'b', x: 0, y: 0, width: 1, height: 1, rgba: half, opacity: 0.5 },
      { name: 'hidden', x: 1, y: 0, width: 1, height: 1, rgba: red, visible: false },
    ],
  });
  const doc = readPsd(bytes);
  const c = doc.composite.data;
  assert.ok(Math.abs(c[0] - 127.5) <= 1 && c[1] === 0 && Math.abs(c[2] - 127.5) <= 1 && c[3] === 255);
  assert.equal(c[7], 0); // hidden layer does not show
  const supplied = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  const d2 = readPsd(writePsd({ width: 2, height: 1, layers: [], composite: { data: supplied } }));
  assert.equal(d2.layers.length, 0);
  assert.deepEqual([...d2.composite.data.slice(0, 3)], [1, 2, 3]);
});

test('writePsd validation', () => {
  assert.throws(() => writePsd({ width: 30001, height: 1, layers: [] }), Error);
  assert.throws(() => writePsd({ width: 0, height: 5, layers: [] }), /canvas/);
  assert.throws(() => writePsd({ width: 2, height: 2, layers: [{ name: 'x', x: 0, y: 0, width: 2, height: 2, rgba: new Uint8ClampedArray(3) }] }), /rgba/);
  assert.throws(() => writePsd({ width: 2, height: 2, layers: [{ name: 'x', width: 0, height: 0, parentIndex: 5 }] }), /parentIndex/);
  assert.throws(() => writePsd({ width: 2, height: 2, layers: [], composite: { data: new Uint8ClampedArray(4) } }), /composite/);
});

test('invalid input throws Error with a clear message', () => {
  assert.throws(() => readPsd(new Uint8Array(0)), /too short/);
  assert.throws(() => readPsd(new Uint8Array(40)), /8BPS/);
  const ok = writePsd({ width: 2, height: 2, layers: [] });
  const bad = ok.slice();
  bad[4] = 0; bad[5] = 9;
  assert.throws(() => readPsd(bad), /version/);
  assert.throws(() => readPsd('nope'), /Uint8Array/);
  const big = writePsd({ width: 300, height: 300, layers: [] });
  assert.throws(() => readPsd(big, { maxPixels: 1000 }), /pixel limit/);
  const hdr = ok.slice();
  hdr[12 + 0] = 0; hdr[13] = 0; hdr[14] = 0; hdr[15] = 0; // channels/height tweak: height = 0
  assert.throws(() => readPsd(hdr), Error);
});

test('readComposite false skips the merged image', () => {
  const bytes = writePsd({ width: 2, height: 2, layers: [{ name: 'a', x: 0, y: 0, width: 2, height: 2, rgba: new Uint8ClampedArray(16).fill(9) }] });
  assert.equal(readPsd(bytes, { readComposite: false }).composite, null);
  assert.ok(readPsd(bytes).composite);
});

test('layer pixel data larger than maxPixels is skipped with a warning', () => {
  const layer = { top: 0, left: 0, bottom: 4, right: 4, name: 'huge', chans: solidChans(4, 4, [1, 2, 3], 255) };
  const doc = readPsd(buildPsd({ width: 2, height: 2, layers: [layer] }), { maxPixels: 10, readComposite: false });
  assert.equal(doc.layers[0].rgba, null);
  assert.ok(doc.warnings.some((w) => /pixel limit/.test(w)));
});

test('fuzz: truncation and random byte flips never hang or throw non-Error', () => {
  const rand = rng(7);
  const px = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < d.length; i++) d[i] = Math.floor(rand() * 4) * 60;
    return d;
  };
  const generated = writePsd({
    width: 12, height: 8,
    layers: [
      { name: 'a', x: 0, y: 0, width: 12, height: 8, rgba: px(12, 8) },
      { name: 'grp', kind: 'group' },
      { name: 'b', x: 1, y: 1, width: 4, height: 4, rgba: px(4, 4), parentIndex: 1 },
    ],
  });
  const child = {
    top: 1, left: 1, bottom: 3, right: 3, name: 'chld', blend: 'mul ', mask: { top: 1, left: 1, bottom: 2, right: 3, def: 255 },
    chans: [...solidChans(2, 2, [200, 100, 50], 128), { id: -2, data: enc.rle([0, 100], 1) }],
    blocks: [['luni', new B().utf16('xy').a], ['TySh', [0, 1, 0, 2, 3]]],
  };
  const zl = { top: 0, left: 0, bottom: 2, right: 3, name: 'z', chans: [0, 1, 2].map((id) => ({ id, data: enc.zipPred([1, 2, 3, 4, 5, 6], 3, 2, 8) })) };
  const hand = buildPsd({ width: 4, height: 4, layers: [child, zl], composite: [0, 0, ...fill(48, 5)] });
  const psb = buildPsd({ psb: true, width: 2, height: 2, layers: [{ top: 0, left: 0, bottom: 2, right: 2, name: 'p', chans: solidChans(2, 2, [1, 2, 3], 255, 'rle', true) }] });
  const t0 = Date.now();
  let calls = 0;
  const run = (bytes) => {
    calls++;
    try {
      const d = readPsd(bytes, { maxPixels: 1e6 });
      assert.ok(Array.isArray(d.layers));
    } catch (e) {
      assert.ok(e instanceof Error, 'must throw Error instances only: ' + e);
    }
  };
  for (const src of [generated, hand, psb]) {
    const step = Math.max(1, Math.floor(src.length / 150));
    for (let n = 0; n < src.length; n += step) run(src.subarray(0, n));
    for (let k = 0; k < 250; k++) {
      const copy = src.slice();
      const flips = 1 + Math.floor(rand() * 3);
      for (let f = 0; f < flips; f++) copy[Math.floor(rand() * copy.length)] = Math.floor(rand() * 256);
      run(copy);
    }
  }
  assert.ok(calls > 800);
  assert.ok(Date.now() - t0 < 4000, 'fuzz must stay fast');
});
