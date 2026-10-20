import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8, zlibSync } from '../../app/vendor/fflate/fflate.js';
import { readSketch, isSketch, findPdfStart, findEmbeddedPreview, sniffFormat, readPsd, readIdml, writePsd } from '../../app/src/engine/formats/index.js';
import { ImportReport } from '../../app/src/core/import-report.js';
import { foreignFormatInfo } from '../../app/src/core/foreign.js';
import { documentPagesText } from '../../app/src/core/doc-text.js';
import { openPdf, readPage } from '../../app/src/core/pdf-source.js';
import { simplePdf, latin1, concat } from './_pdf-fixture.js';

// ---- Sketch -------------------------------------------------------------------------------------------------

const rgb = (r, g, b, a = 1) => ({ _class: 'color', red: r, green: g, blue: b, alpha: a });
function sketchFile() {
  const page = {
    _class: 'page', name: 'Page 1',
    layers: [{
      _class: 'artboard', name: 'Home', frame: { x: 0, y: 0, width: 375, height: 667 }, hasBackgroundColor: true, backgroundColor: rgb(1, 1, 1),
      layers: [
        { _class: 'rectangle', name: 'Card', frame: { x: 10, y: 20, width: 100, height: 50 }, fixedRadius: 8, style: { fills: [{ isEnabled: true, fillType: 0, color: rgb(1, 0, 0) }], borders: [{ isEnabled: true, color: rgb(0, 0, 1), thickness: 2, position: 0 }] } },
        { _class: 'oval', name: 'Dot', frame: { x: 0, y: 0, width: 20, height: 20 }, rotation: 30, style: { fills: [{ isEnabled: true, fillType: 1, gradient: { gradientType: 0, from: '{0.5, 0}', to: '{0.5, 1}', stops: [{ position: 0, color: rgb(0, 0, 0) }, { position: 1, color: rgb(1, 1, 1) }] } }] } },
        { _class: 'text', name: 'Title', frame: { x: 20, y: 100, width: 200, height: 30 }, textBehaviour: 1, attributedString: { string: 'Hello Sketch', attributes: [{ location: 0, length: 12, attributes: { MSAttributedStringFontAttribute: { attributes: { name: 'Helvetica-Bold', size: 24 } }, MSAttributedStringColorAttribute: rgb(0, 0, 0) } }] } },
        { _class: 'group', name: 'G', frame: { x: 50, y: 200, width: 100, height: 100 }, layers: [{ _class: 'shapePath', name: 'Tri', frame: { x: 0, y: 0, width: 40, height: 40 }, isClosed: true, points: [{ point: '{0.5, 0}' }, { point: '{1, 1}' }, { point: '{0, 1}' }], style: { fills: [{ isEnabled: true, fillType: 0, color: rgb(0, 1, 0) }] } }] },
        { _class: 'bitmap', name: 'Photo', frame: { x: 0, y: 300, width: 64, height: 64 }, image: { _class: 'MSJSONFileReference', _ref: 'images/abc.png' } },
        { _class: 'symbolInstance', name: 'Sym', frame: { x: 0, y: 0, width: 5, height: 5 } },
        { _class: 'weirdLayer', name: 'W', frame: { x: 0, y: 0, width: 5, height: 5 } },
      ],
    }],
  };
  return zipSync({
    'document.json': strToU8(JSON.stringify({ _class: 'document', pages: [{ _class: 'MSJSONFileReference', _ref: 'pages/p1' }] })),
    'meta.json': strToU8(JSON.stringify({ version: 136 })),
    'pages/p1.json': strToU8(JSON.stringify(page)),
    'images/abc.png': Uint8Array.from([1, 2, 3]),
  });
}

test('sketch: artboards, shapes, gradients, text, groups and warnings', () => {
  const bytes = sketchFile();
  assert.equal(sniffFormat(bytes, 'x.sketch'), 'sketch');
  assert.equal(sniffFormat(bytes, 'x.zip'), 'sketch');
  const s = readSketch(bytes);
  assert.equal(s.pages.length, 1);
  const ab = s.pages[0].artboards[0];
  assert.equal(ab.name, 'Home');
  assert.equal(ab.width, 375);
  assert.equal(ab.background, '#ffffff');
  const [card, dot, title, group, photo] = ab.items;
  assert.equal(card.kind, 'rect');
  assert.equal(card.radius, 8);
  assert.equal(card.fills[0].color, '#ff0000');
  assert.equal(card.borders[0].width, 2);
  assert.equal(dot.kind, 'ellipse');
  assert.equal(dot.rotation, -30);
  assert.equal(dot.fills[0].type, 'linear');
  assert.equal(title.text.string, 'Hello Sketch');
  assert.equal(title.text.fontSize, 24);
  assert.equal(title.text.fontPostScript, 'Helvetica-Bold');
  assert.equal(group.children[0].kind, 'path');
  assert.match(group.children[0].d, /^M20 0 L40 40 L0 40 .*Z$/);
  assert.equal(photo.imageRef, 'images/abc.png');
  assert.ok(s.images['images/abc.png']);
  assert.ok(s.warnings.some((w) => /Symbol instances/.test(w)));
  assert.ok(s.warnings.some((w) => /weirdLayer/.test(w)));
});

test('sketch: invalid archives give clear errors', () => {
  assert.throws(() => readSketch(strToU8('nope')), /not a valid Sketch/);
  assert.throws(() => readSketch(zipSync({ 'a.txt': strToU8('x') })), /not a Sketch/);
  assert.equal(isSketch({}), false);
  assert.throws(() => readSketch(zipSync({ 'document.json': strToU8('{}'), 'pages/p.json': strToU8('{"layers":[]}') })), /no artboards/);
});

// ---- AI / EPS: PDF content inside other containers ---------------------------------------------------------

test('PDF content inside AI and EPS wrappers is located and opens', async () => {
  const pdf = simplePdf('BT /F1 12 Tf 10 100 Td (Inside AI) Tj ET');
  const eps = concat([Uint8Array.from([0xc5, 0xd0, 0xd3, 0xc6]), latin1('%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: test\n'), pdf]);
  const at = findPdfStart(eps);
  assert.ok(at > 20);
  const src = await openPdf(eps.subarray(at));
  try {
    assert.equal((await readPage(src, 1)).items.find((i) => i.k === 'text').text, 'Inside AI');
  } finally {
    src.destroy();
  }
  assert.equal(findPdfStart(latin1('%!PS-Adobe-3.0\n1 0 0 setrgbcolor')), -1);
  assert.equal(sniffFormat(pdf, 'art.ai'), 'ai');
  assert.equal(foreignFormatInfo('legacy.ai').title, 'This Illustrator file has no PDF content');
  assert.match(foreignFormatInfo('x.eps').message, /PostScript/);
});

// ---- Affinity / InDesign guidance and embedded preview scan ----------------------------------------------------

const crcT = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(latin1(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
function makePng(w, h) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = new Uint8Array((w * 3 + 1) * h);
  return concat([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

test('affinity preview scan finds plain PNG streams in a synthetic container and ignores damaged ones', () => {
  const small = makePng(16, 16);
  const big = makePng(200, 100);
  const damaged = big.slice();
  damaged[damaged.length - 20] ^= 0xff; // breaks a CRC
  const noise = new Uint8Array(5000).map((_, i) => (i * 37) & 255);
  const file = concat([latin1('AFFINITY-TEST'), noise, small, noise, big, noise]);
  const p = findEmbeddedPreview(file);
  assert.equal(p.mime, 'image/png');
  assert.equal(p.width, 200);
  assert.equal(p.height, 100);
  assert.deepEqual(p.bytes, big);
  assert.equal(findEmbeddedPreview(concat([noise, damaged, noise])), null);
  assert.equal(findEmbeddedPreview(noise), null);
  // minimal JPEG: SOI, SOF0 (48x32), SOS, data, EOI
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 32, 0, 48, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 3, 0xff, 0x00, 4, 0xff, 0xd9]);
  const q = findEmbeddedPreview(concat([noise, jpg, noise]), { minSide: 16 });
  assert.equal(q.mime, 'image/jpeg');
  assert.equal(q.width, 48);
  assert.deepEqual(q.bytes, jpg);
});

test('foreign format guidance names the export route', () => {
  const af = foreignFormatInfo('Poster.afdesign');
  assert.equal(af.preview, true);
  assert.ok(af.steps.some((s) => /PDF/.test(s)));
  assert.ok(foreignFormatInfo('doc.indd').steps.some((s) => /IDML/.test(s)));
  assert.match(foreignFormatInfo('x.fig').message, /proprietary/);
  assert.match(foreignFormatInfo('x.xd').title, /XD/);
  assert.equal(foreignFormatInfo('photo.png'), null);
});

// ---- report and text helpers -------------------------------------------------------------------------------------

test('import report collects, de-duplicates and summarizes', () => {
  const r = new ImportReport('PDF', 'a.pdf');
  r.kept('3 text blocks').kept('3 text blocks').flattened('Fonts replaced').dropped('Links').note('Form fields are static');
  assert.equal(r.items.length, 4);
  assert.equal(r.attention, true);
  assert.equal(r.summary(), '1 kept editable, 1 flattened, 1 not imported, 1 note');
  assert.match(r.toText(), /Kept editable:\n- 3 text blocks/);
  assert.equal(new ImportReport('SVG').kept('x').attention, false);
  assert.equal(r.toJSON().format, 'PDF');
});

test('documentPagesText returns reading order per page', () => {
  const stories = { s1: { story: { paragraphs: [{ runs: [{ text: 'Second' }] }] } }, s2: { story: { paragraphs: [{ runs: [{ text: 'First' }] }] } } };
  const node = (id, storyId, x, y) => ({ id, type: 'text', storyId, visible: true, m: [1, 0, 0, 1, x, y], _parent: null });
  const doc = { stories, pages: [{ name: 'P1', w: 100, h: 100, root: { type: 'group', m: [1, 0, 0, 1, 0, 0], _parent: null, children: [node('a', 's1', 10, 80), node('b', 's2', 10, 20)] } }] };
  const [p] = documentPagesText(doc);
  assert.equal(p.text, 'First\n\nSecond');
  assert.equal(p.blocks, 2);
  assert.deepEqual(documentPagesText(doc, { pages: [2] }), []);
});

// ---- robustness of the existing readers (audit) -------------------------------------------------------------------

test('PSD and IDML readers throw only Error on truncated or corrupt input', () => {
  const psd = writePsd({ width: 8, height: 8, layers: [{ name: 'L', x: 0, y: 0, width: 8, height: 8, rgba: new Uint8ClampedArray(8 * 8 * 4).fill(200), opacity: 1, visible: true, blend: 'normal' }] });
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 60; i++) {
    const cut = psd.slice(0, Math.floor(rnd() * psd.length));
    try {
      readPsd(cut);
    } catch (e) {
      assert.ok(e instanceof Error, 'PSD: only Error instances are thrown');
    }
    const bad = psd.slice();
    for (let k = 0; k < 6; k++) bad[Math.floor(rnd() * bad.length)] = Math.floor(rnd() * 256);
    try {
      readPsd(bad);
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  }
  const idml = zipSync({ 'designmap.xml': strToU8('<Document><Spread src="Spreads/S.xml"/></Document>'), 'Spreads/S.xml': strToU8('<Spread><Page Name="1" GeometricBounds="0 0 100 100"/>') });
  for (let i = 0; i < 40; i++) {
    const bad = idml.slice(0, Math.floor(rnd() * idml.length));
    try {
      readIdml(bad);
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  }
});
