import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zlibSync } from '../../app/vendor/fflate/fflate.js';
import { createPDF } from '../../app/src/engine/backends/pdf.js';
import { jpegInfo } from '../../app/src/engine/backends/jpeg-info.js';
import { parseFont, layoutStory, makeSfntMeasurer, storyFromPlain, plainText } from '../../app/src/engine/layout/index.js';
import { parsePdf, checkPdf, streamBytes, pageObjects, pageContent, latin1Str } from './pdf-structure.js';

const IDM = [1, 0, 0, 1, 0, 0];
const solid = (color, alpha = 1) => ({ type: 'solid', color, alpha });
const rectD = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
const stroke = (paint, width, extra) => ({ paint, width, cap: 'butt', join: 'miter', miterLimit: 10, dash: null, dashOffset: 0, ...(extra || {}) });
const DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
const pathItem = (extra) => ({ t: 'path', d: rectD(0, 0, 10, 10), rule: 'nonzero', fill: solid('#000000'), stroke: null, m: IDM, ...extra });

/** Builds a one page PDF (200x100 px = 150x75 pt) and returns parsed pieces. */
function build(items, options, size) {
  const w = (size && size[0]) || 200;
  const h = (size && size[1]) || 100;
  const bytes = createPDF([{ width: w, height: h, items }], { creationDate: DATE, compress: false, ...(options || {}) });
  const parsed = checkPdf(bytes);
  const page = pageObjects(parsed.objects, parsed.trailer)[0];
  return { bytes, parsed, page, content: pageContent(parsed.objects, page), objects: parsed.objects };
}

function findObjects(objects, re) {
  return [...objects.values()].filter((o) => re.test(o.dict));
}
function numbers(s) {
  return s.trim().split(/\s+/).map(Number);
}
function boxOf(dict, name) {
  const m = new RegExp(`/${name} \\[([^\\]]*)\\]`).exec(dict);
  return numbers(m[1]);
}
function near(a, b, eps = 1e-3) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `${a} vs ${b}`);
}

// ---------------------------------------------------------------------------------------------------------------

test('structure: header, xref, trailer, page tree, metadata, determinism', () => {
  const pages = [
    { width: 960, height: 480, items: [pathItem()] },
    { width: 100, height: 100, items: [] },
    { width: 100, height: 100, items: [pathItem({ fill: solid('#ff0000') })] },
  ];
  const opts = { title: 'Caf\u00e9 \u201cTitle\u201d', author: 'A (B)', subject: 'S', keywords: ['one', 'two'], creationDate: DATE };
  const a = createPDF(pages, opts);
  const b = createPDF(pages, opts);
  assert.deepEqual(a, b, 'output is deterministic for a fixed creation date');
  const { objects, trailer, size } = checkPdf(a);
  assert.ok(size > 10);
  const ps = pageObjects(objects, trailer);
  assert.equal(ps.length, 3);
  const info = objects.get(parseInt(/\/Info (\d+) 0 R/.exec(trailer)[1], 10));
  assert.ok(info.dict.includes('/Producer (OpenFini)'));
  assert.ok(info.dict.includes('/Creator (OpenFini)'));
  assert.ok(info.dict.includes('/Author (A \\(B\\))'), 'literal strings are escaped');
  assert.ok(/\/Title <FEFF[0-9A-F]+>/.test(info.dict), 'non-ASCII text is UTF-16BE');
  assert.ok(info.dict.includes('/Keywords (one, two)'));
  assert.ok(info.dict.includes('/CreationDate (D:20260102030405Z)'));
  const meta = findObjects(objects, /\/Type \/Metadata/)[0];
  const xmp = new TextDecoder().decode(meta.stream);
  assert.ok(xmp.includes('<?xpacket begin='));
  assert.ok(xmp.includes('Caf\u00e9 \u201cTitle\u201d'));
  assert.ok(xmp.includes('<dc:creator><rdf:Seq><rdf:li>A (B)</rdf:li>'));
  assert.ok(xmp.includes('<xmp:CreateDate>2026-01-02T03:04:05Z</xmp:CreateDate>'));
  assert.ok(findObjects(objects, /\/Type \/Catalog/)[0].dict.includes('/Metadata'));
  const c = createPDF([{ ...pages[0], items: [pathItem({ fill: solid('#00ff00') })] }], opts);
  assert.notDeepEqual(a, c);
  // custom producer / creator, no metadata fields when none given
  const d = checkPdf(createPDF([pages[1]], { producer: 'Acme', creator: 'Tool', creationDate: DATE }));
  const dinfo = d.objects.get(parseInt(/\/Info (\d+) 0 R/.exec(d.trailer)[1], 10));
  assert.ok(dinfo.dict.includes('/Producer (Acme)') && dinfo.dict.includes('/Creator (Tool)'));
  assert.ok(!dinfo.dict.includes('/Title'));
  // no pages: a blank A4 page
  const e = checkPdf(createPDF([], {}));
  const ep = pageObjects(e.objects, e.trailer);
  assert.equal(ep.length, 1);
  near(boxOf(ep[0].dict, 'MediaBox'), [0, 0, 446.4567, 631.4167], 0.01);
});

test('page boxes: pxPerInch, bleed and crop marks', () => {
  const mk = (options, size = [960, 480]) => {
    const r = build([pathItem()], { compress: true, ...options }, size);
    return { dict: r.page.dict, content: r.content };
  };
  let r = mk({});
  assert.deepEqual(boxOf(r.dict, 'MediaBox'), [0, 0, 720, 360]);
  assert.deepEqual(boxOf(r.dict, 'TrimBox'), [0, 0, 720, 360]);
  assert.deepEqual(boxOf(r.dict, 'BleedBox'), [0, 0, 720, 360]);
  assert.ok(r.content.includes('0.75 0 0 -0.75 0 360 cm'));
  r = mk({ pxPerInch: 72 });
  assert.deepEqual(boxOf(r.dict, 'MediaBox'), [0, 0, 960, 480]);
  assert.ok(r.content.includes('1 0 0 -1 0 480 cm'));
  r = mk({ bleed: 12 });
  assert.deepEqual(boxOf(r.dict, 'MediaBox'), [0, 0, 738, 378]);
  assert.deepEqual(boxOf(r.dict, 'TrimBox'), [9, 9, 729, 369]);
  assert.deepEqual(boxOf(r.dict, 'BleedBox'), [0, 0, 738, 378]);
  assert.ok(r.content.includes('0.75 0 0 -0.75 9 369 cm'));
  assert.ok(!r.content.includes('0.25 w'), 'no crop marks requested');
  r = mk({ bleed: 12, cropMarks: true });
  near(boxOf(r.dict, 'MediaBox'), [0, 0, 772.016, 412.016]);
  near(boxOf(r.dict, 'TrimBox'), [26.008, 26.008, 746.008, 386.008]);
  near(boxOf(r.dict, 'BleedBox'), [17.008, 17.008, 755.008, 395.008]);
  const marks = r.content.slice(r.content.indexOf('0.25 w'));
  assert.equal((marks.match(/ l S/g) || []).length, 8, 'two marks per corner');
  assert.ok(/17\.008 17\.008 738 378 re W n/.test(r.content), 'artwork is clipped to the bleed box');
  // negative / invalid options are ignored
  r = mk({ pxPerInch: -5, bleed: -3 });
  assert.deepEqual(boxOf(r.dict, 'MediaBox'), [0, 0, 720, 360]);
});

test('paths: operators, fill rules, strokes, dashes, quadratic conversion, matrices', () => {
  const d = [['M', 10, 20], ['L', 30, 40], ['Q', 50, 60, 70, 80], ['C', 1, 2, 3, 4, 5, 6], ['Z']];
  let r = build([pathItem({ d, fill: solid('#ff8000'), m: [2, 0, 0, 2, 5, 6] })]);
  assert.ok(r.content.includes('0.75 0 0 -0.75 0 75 cm'));
  assert.ok(r.content.includes('2 0 0 2 5 6 cm'));
  assert.ok(r.content.includes('1 0.502 0 rg'));
  assert.ok(r.content.includes('10 20 m\n30 40 l\n43.3333 53.3333 56.6667 66.6667 70 80 c\n1 2 3 4 5 6 c\nh\nf'));
  r = build([pathItem({ rule: 'evenodd' })]);
  assert.ok(/\nf\*\n/.test(r.content));
  r = build([pathItem({ fill: solid('#000000'), stroke: stroke(solid('#0000ff'), 3, { cap: 'round', join: 'bevel', miterLimit: 4, dash: [6, 3], dashOffset: 1 }) })]);
  for (const op of ['0 0 1 RG', '3 w', '1 J', '2 j', '4 M', '[6 3] 1 d']) assert.ok(r.content.includes(op), op);
  assert.ok(/\nB\n/.test(r.content), 'fill and stroke in one operator');
  r = build([pathItem({ fill: solid('#000000'), rule: 'evenodd', stroke: stroke(solid('#0000ff'), 1) })]);
  assert.ok(/\nB\*\n/.test(r.content));
  assert.ok(r.content.includes('[] 0 d'));
  r = build([pathItem({ fill: null, stroke: stroke(solid('#0000ff'), 2, { cap: 'square' }) })]);
  assert.ok(/\nS\n/.test(r.content) && r.content.includes('2 J'));
  // nothing to paint
  r = build([pathItem({ fill: null, stroke: null }), pathItem({ fill: null, stroke: stroke(solid('#000000'), 0) }), pathItem({ d: [] })]);
  assert.ok(!/ m\n/.test(r.content));
  // L before M starts a subpath instead of producing invalid PDF
  r = build([pathItem({ d: [['L', 1, 1], ['L', 5, 5]] })]);
  assert.ok(r.content.includes('1 1 m\n5 5 l'));
});

test('solid paint with alpha uses ExtGState ca / CA', () => {
  let r = build([pathItem({ fill: solid('#112233', 0.5), stroke: stroke(solid('#000000', 0.25), 2) })]);
  assert.ok(/\/ca 0\.5/.test(r.page.dict) && /\/CA 0\.25/.test(r.page.dict));
  assert.ok(/\/G1 gs/.test(r.content));
  r = build([pathItem({ fill: solid('#11223380') })]);
  assert.ok(/\/ca 0\.502/.test(r.page.dict), 'alpha from #rrggbbaa is honored');
  r = build([pathItem({ fill: solid('#112233', 1) })]);
  assert.ok(!/ExtGState/.test(r.page.dict), 'opaque paint needs no ExtGState');
});

test('linear gradients: shading, stitching function, pattern matrix, alpha soft mask', () => {
  const stops = [{ o: 0, color: '#ff0000', alpha: 1 }, { o: 0.5, color: '#00ff00', alpha: 1 }, { o: 1, color: '#0000ff', alpha: 1 }];
  let r = build([pathItem({ d: rectD(0, 0, 100, 50), fill: { type: 'linear', x0: 0, y0: 0, x1: 100, y1: 0, stops }, m: [2, 0, 0, 2, 10, 10] })]);
  const sh = findObjects(r.objects, /\/ShadingType 2/)[0];
  assert.ok(sh, 'axial shading');
  assert.ok(sh.dict.includes('/Coords [0 0 100 0]') && sh.dict.includes('/Extend [true true]') && sh.dict.includes('/DeviceRGB'));
  const fn = r.objects.get(parseInt(/\/Function (\d+) 0 R/.exec(sh.dict)[1], 10));
  assert.ok(fn.dict.includes('/FunctionType 3') && fn.dict.includes('/Bounds [0.5]') && fn.dict.includes('/Encode [0 1 0 1]'));
  const seg = r.objects.get(parseInt(/\/Functions \[(\d+) 0 R/.exec(fn.dict)[1], 10));
  assert.ok(seg.dict.includes('/FunctionType 2') && seg.dict.includes('/C0 [1 0 0]') && seg.dict.includes('/C1 [0 1 0]'));
  const pat = findObjects(r.objects, /\/PatternType 2/)[0];
  near(numbers(/\/Matrix \[([^\]]*)\]/.exec(pat.dict)[1]), [1.5, 0, 0, -1.5, 7.5, 67.5]);
  assert.ok(/\/Pattern cs \/P1 scn/.test(r.content));
  assert.ok(!findObjects(r.objects, /\/SMask/).length, 'opaque stops need no soft mask');
  // two stops: single exponential function
  r = build([pathItem({ fill: { type: 'linear', x0: 0, y0: 0, x1: 1, y1: 1, stops: [stops[0], { ...stops[2], o: 1 }] } })]);
  const sh2 = findObjects(r.objects, /\/ShadingType 2/)[0];
  assert.ok(r.objects.get(parseInt(/\/Function (\d+) 0 R/.exec(sh2.dict)[1], 10)).dict.includes('/FunctionType 2'));
  // implicit end stops
  r = build([pathItem({ fill: { type: 'linear', x0: 0, y0: 0, x1: 10, y1: 0, stops: [{ o: 0.25, color: '#000000', alpha: 1 }, { o: 0.75, color: '#ffffff', alpha: 1 }] } })]);
  const sh3 = findObjects(r.objects, /\/ShadingType 2/)[0];
  assert.ok(r.objects.get(parseInt(/\/Function (\d+) 0 R/.exec(sh3.dict)[1], 10)).dict.includes('/Bounds [0.25 0.75]'));
  // alpha stops: luminosity soft mask
  const astops = [{ o: 0, color: '#ff0000', alpha: 1 }, { o: 1, color: '#ff0000', alpha: 0 }];
  r = build([pathItem({ d: rectD(0, 0, 80, 40), fill: { type: 'linear', x0: 0, y0: 0, x1: 80, y1: 0, stops: astops } })]);
  const alphaSh = findObjects(r.objects, /\/ShadingType 2[^]*\/DeviceGray/)[0];
  assert.ok(alphaSh, 'gray alpha shading');
  const mask = findObjects(r.objects, /\/Type \/Mask/)[0];
  assert.ok(mask.dict.includes('/S /Luminosity'));
  const form = r.objects.get(parseInt(/\/G (\d+) 0 R/.exec(mask.dict)[1], 10));
  assert.ok(form.dict.includes('/Group') && form.dict.includes('/DeviceGray') && form.dict.includes('/BBox'));
  assert.equal(latin1Str(form.stream).trim(), '/Sh0 sh');
  assert.ok(new RegExp(`/SMask ${mask.num} 0 R`).test(r.page.dict));
  // degenerate gradients become solid colors
  r = build([pathItem({ fill: { type: 'linear', x0: 5, y0: 5, x1: 5, y1: 5, stops } }), pathItem({ fill: { type: 'linear', x0: 0, y0: 0, x1: 1, y1: 0, stops: [stops[0]] } })]);
  assert.ok(!findObjects(r.objects, /\/ShadingType/).length);
  assert.ok(r.content.includes('0 0 1 rg') && r.content.includes('1 0 0 rg'));
  // gradient strokes use pattern colors too
  r = build([pathItem({ fill: null, stroke: stroke({ type: 'linear', x0: 0, y0: 0, x1: 10, y1: 0, stops }, 4) })]);
  assert.ok(/\/Pattern CS \/P1 SCN/.test(r.content));
});

test('radial and conic gradients', () => {
  const stops = [{ o: 0, color: '#ffffff', alpha: 1 }, { o: 1, color: '#336699', alpha: 1 }];
  let r = build([pathItem({ fill: { type: 'radial', cx: 50, cy: 50, r: 40, fx: 40, fy: 45, stops } })]);
  const sh = findObjects(r.objects, /\/ShadingType 3/)[0];
  assert.ok(sh.dict.includes('/Coords [40 45 0 50 50 40]'));
  // a focal point outside the circle is pulled inside
  r = build([pathItem({ fill: { type: 'radial', cx: 0, cy: 0, r: 10, fx: 100, fy: 0, stops } })]);
  const c2 = numbers(/\/Coords \[([^\]]*)\]/.exec(findObjects(r.objects, /\/ShadingType 3/)[0].dict)[1]);
  assert.ok(Math.hypot(c2[0] - c2[3], c2[1] - c2[4]) < c2[5]);
  // invalid radius -> solid
  r = build([pathItem({ fill: { type: 'radial', cx: 0, cy: 0, r: 0, stops } })]);
  assert.ok(!findObjects(r.objects, /\/ShadingType/).length);
  // conic: wedges clipped to the shape
  r = build([pathItem({ d: rectD(10, 10, 60, 60), fill: { type: 'conic', cx: 40, cy: 40, angle: 0, stops: [{ o: 0, color: '#ff0000', alpha: 1 }, { o: 1, color: '#0000ff', alpha: 1 }] } })]);
  assert.equal((r.content.match(/ l h f\n/g) || []).length, 120);
  assert.ok(/W n\n/.test(r.content));
  assert.ok(!findObjects(r.objects, /\/ShadingType/).length);
  // the first wedge is red-ish, the last blue-ish
  const rgs = [...r.content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg\n(?:\/G\d+ gs\n)?[\d. -]+ m /g)];
  assert.ok(Number(rgs[0][1]) > 0.95 && Number(rgs.at(-1)[3]) > 0.95);
  // conic strokes fall back to the average color
  r = build([pathItem({ fill: null, stroke: stroke({ type: 'conic', cx: 0, cy: 0, angle: 0, stops: [{ o: 0, color: '#000000', alpha: 1 }, { o: 1, color: '#ffffff', alpha: 1 }] }, 3) })]);
  assert.ok(/0\.5 0\.5 0\.5 RG/.test(r.content));
});

// ---------------------------------------------------------------------------------------------------------------

function makeJpegHeader(width, height, components, extra = {}) {
  const bytes = [0xff, 0xd8];
  if (extra.adobe) bytes.push(0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, extra.transform || 0);
  const sof = extra.progressive ? 0xc2 : extra.marker || 0xc0;
  const len = 8 + 3 * components;
  bytes.push(0xff, sof, len >> 8, len & 255, extra.bits || 8, height >> 8, height & 255, width >> 8, width & 255, components);
  for (let i = 0; i < components; i++) bytes.push(i + 1, 0x11, 0);
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

test('jpegInfo reads dimensions, components and Adobe flags', () => {
  assert.deepEqual(jpegInfo(makeJpegHeader(640, 480, 3)), { width: 640, height: 480, components: 3, bits: 8, progressive: false, adobe: false, adobeTransform: -1, invertedCMYK: false });
  assert.equal(jpegInfo(makeJpegHeader(10, 20, 1)).components, 1);
  const cmyk = jpegInfo(makeJpegHeader(10, 20, 4, { adobe: true, transform: 2 }));
  assert.equal(cmyk.invertedCMYK, true);
  assert.equal(cmyk.adobeTransform, 2);
  assert.equal(jpegInfo(makeJpegHeader(10, 20, 3, { progressive: true })).progressive, true);
  assert.equal(jpegInfo(makeJpegHeader(10, 20, 4)).invertedCMYK, false);
  assert.equal(jpegInfo(makeJpegHeader(10, 20, 3, { marker: 0xc3 })), null, 'lossless is not supported');
  assert.equal(jpegInfo(makeJpegHeader(10, 20, 3, { bits: 12 })), null);
  assert.equal(jpegInfo(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(jpegInfo(new Uint8Array([0xff, 0xd8, 0xff])), null);
  assert.equal(jpegInfo(null), null);
});

test('images: RGBA with soft mask, opaque RGB, de-duplication, JPEG pass-through', () => {
  const rgba = new Uint8ClampedArray(2 * 2 * 4);
  rgba.set([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255]);
  const opaque = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  const items = [
    { t: 'image', img: { id: 'a', width: 2, height: 2, rgba }, m: [20, 0, 0, 20, 5, 6], smooth: true },
    { t: 'image', img: { id: 'a', width: 2, height: 2, rgba }, m: [10, 0, 0, 10, 50, 6], smooth: true },
    { t: 'image', img: { id: 'b', width: 2, height: 2, rgba: opaque }, m: IDM, smooth: false },
    { t: 'image', img: { id: 'c', width: 2, height: 2 }, m: IDM, smooth: false },
  ];
  const r = build(items);
  const imgs = findObjects(r.objects, /\/Subtype \/Image/);
  const rgbImgs = imgs.filter((o) => /\/DeviceRGB/.test(o.dict));
  assert.equal(rgbImgs.length, 2, 'ids a and b; the image without pixel data is skipped; a is shared');
  const a = rgbImgs.find((o) => /\/SMask/.test(o.dict));
  assert.ok(a && a.dict.includes('/Interpolate true'));
  assert.deepEqual([...streamBytes(a)], [255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
  const sm = r.objects.get(parseInt(/\/SMask (\d+) 0 R/.exec(a.dict)[1], 10));
  assert.ok(sm.dict.includes('/DeviceGray') && sm.dict.includes('/BitsPerComponent 8'));
  assert.deepEqual([...streamBytes(sm)], [255, 128, 0, 255]);
  const b = rgbImgs.find((o) => !/\/SMask/.test(o.dict));
  assert.ok(!b.dict.includes('/Interpolate'));
  // the image matrix maps the pixel grid: unit square -> pixels -> parent
  assert.ok(r.content.includes('40 0 0 -40 5 46 cm'), r.content);
  assert.equal((r.content.match(/\/Im1 Do/g) || []).length, 2, 'the shared image is painted twice with one XObject');
  // JPEG pass-through
  const jpeg = makeJpegHeader(32, 16, 3);
  const j = build([{ t: 'image', img: { id: 'j', width: 32, height: 16, jpeg, rgba: opaque }, m: IDM, smooth: false }]);
  const jo = findObjects(j.objects, /\/DCTDecode/)[0];
  assert.ok(jo.dict.includes('/Width 32') && jo.dict.includes('/Height 16') && jo.dict.includes('/DeviceRGB'));
  assert.deepEqual([...jo.stream], [...jpeg], 'bytes are passed through unchanged');
  assert.ok(!j.page.dict.includes('FlateDecode'));
  const gray = build([{ t: 'image', img: { id: 'g', width: 4, height: 4, jpeg: makeJpegHeader(4, 4, 1) }, m: IDM, smooth: true }]);
  assert.ok(findObjects(gray.objects, /\/DCTDecode/)[0].dict.includes('/DeviceGray'));
  const k = build([{ t: 'image', img: { id: 'k', width: 4, height: 4, jpeg: makeJpegHeader(4, 4, 4, { adobe: true, transform: 2 }) }, m: IDM, smooth: false }]);
  const ko = findObjects(k.objects, /\/DCTDecode/)[0];
  assert.ok(ko.dict.includes('/DeviceCMYK') && ko.dict.includes('/Decode [1 0 1 0 1 0 1 0]'));
  const k2 = build([{ t: 'image', img: { id: 'k2', width: 4, height: 4, jpeg: makeJpegHeader(4, 4, 4) }, m: IDM, smooth: false }]);
  assert.ok(!findObjects(k2.objects, /\/DCTDecode/)[0].dict.includes('/Decode'));
  // a broken JPEG falls back to the raw pixels when present, otherwise the image is skipped
  const fb = build([{ t: 'image', img: { id: 'x', width: 2, height: 2, jpeg: new Uint8Array([1, 2, 3]), rgba: opaque }, m: IDM, smooth: false }]);
  assert.equal(findObjects(fb.objects, /\/Subtype \/Image/).length, 1);
  assert.ok(!findObjects(fb.objects, /\/DCTDecode/).length);
  const none = build([{ t: 'image', img: { id: 'y', width: 2, height: 2, jpeg: new Uint8Array([1, 2, 3]) }, m: IDM, smooth: false }]);
  assert.equal(findObjects(none.objects, /\/Subtype \/Image/).length, 0);
});

test('groups: opacity, blend modes, isolation, clipping and nesting', () => {
  const inner = [pathItem({ fill: solid('#ff0000') })];
  const group = (extra) => ({ t: 'group', items: inner, m: IDM, opacity: 1, blend: 'normal', clip: null, isolate: false, ...extra });
  // plain group: no form
  let r = build([group({})]);
  assert.equal(findObjects(r.objects, /\/Subtype \/Form/).length, 0);
  assert.ok(r.content.includes('1 0 0 rg'));
  // opacity -> form with a transparency group
  r = build([group({ opacity: 0.4 })]);
  const form = findObjects(r.objects, /\/Subtype \/Form/)[0];
  assert.ok(form.dict.includes('/Group << /S /Transparency /I false /K false >>'));
  assert.ok(/\/ca 0\.4 \/CA 0\.4 \/BM \/Normal/.test(r.page.dict));
  assert.ok(latin1Str(form.stream).includes('1 0 0 rg'));
  assert.ok(/\/Fm1 Do/.test(r.content));
  // isolated group even without opacity
  r = build([group({ isolate: true })]);
  assert.ok(findObjects(r.objects, /\/Subtype \/Form/)[0].dict.includes('/I true'));
  // every blend mode maps to its PDF name
  const modes = {
    multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn',
    'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
  };
  for (const [css, pdf] of Object.entries(modes)) {
    r = build([group({ blend: css })]);
    assert.ok(r.page.dict.includes(`/BM /${pdf}`), css);
  }
  // clip path with its own matrix (applied to the coordinates), inside the form
  r = build([group({ opacity: 0.5, clip: { d: rectD(0, 0, 10, 10), rule: 'evenodd', m: [2, 0, 0, 2, 1, 1] } })]);
  const f2 = findObjects(r.objects, /\/Subtype \/Form/)[0];
  assert.ok(latin1Str(f2.stream).startsWith('1 1 m\n21 1 l\n21 21 l\n1 21 l\nh\nW* n'));
  assert.deepEqual(boxOf(f2.dict, 'BBox'), [-1, -1, 23, 23]);
  // inline clip, group matrix
  r = build([group({ clip: { d: rectD(0, 0, 5, 5), rule: 'nonzero', m: IDM }, m: [1, 0, 0, 1, 7, 8] })]);
  assert.ok(r.content.includes('1 0 0 1 7 8 cm') && /W n\n/.test(r.content));
  // nested groups get their own form each; resources stay separate
  r = build([group({ opacity: 0.5, items: [group({ opacity: 0.5, blend: 'screen' })] })]);
  assert.equal(findObjects(r.objects, /\/Subtype \/Form/).length, 2);
  // fully transparent normal groups draw nothing
  r = build([group({ opacity: 0 })]);
  assert.equal(findObjects(r.objects, /\/Subtype \/Form/).length, 0);
  assert.ok(!r.content.includes('rg'));
});

test('text with base-14 fonts: mapping, WinAnsi, escapes, spacing, render modes, decorations', () => {
  const run = (text, font, extra) => ({ text, x: 10, y: 50, width: 40, font: { size: 12, weight: 400, style: 'normal', ...font }, fill: solid('#000000'), stroke: null, letterSpacing: 0, underline: false, strike: false, ...(extra || {}) });
  const r = build([
    {
      t: 'text',
      runs: [
        run('Hi', { family: 'Arial', weight: 700, style: 'italic' }),
        run('Hi', { family: 'Times New Roman' }),
        run('Hi', { family: 'Courier New' }),
        run('a(b)c\\ d \u00e9\u20ac\u201c \u4e2d', { family: 'Helvetica' }, { letterSpacing: 1.5, underline: true, strike: true }),
        run('Out', { family: 'Georgia' }, { stroke: stroke(solid('#ff0000'), 2), letterSpacing: 0 }),
        run('Only', { family: 'x' }, { fill: null, stroke: stroke(solid('#00ff00'), 1) }),
        run('', { family: 'x' }),
        run('skip', { family: 'x' }, { fill: null, stroke: null }),
      ],
      m: IDM,
    },
  ]);
  const fonts = findObjects(r.objects, /\/Type \/Font/).map((o) => /\/BaseFont \/([\w-]+)/.exec(o.dict)[1]).sort();
  assert.deepEqual(fonts, ['Courier', 'Helvetica', 'Helvetica-BoldOblique', 'Times-Roman']);
  const helv = findObjects(r.objects, /\/BaseFont \/Helvetica /)[0];
  assert.ok(helv.dict.includes('/Encoding /WinAnsiEncoding') && helv.dict.includes('/FirstChar 32 /LastChar 255'));
  const widths = numbers(/\/Widths \[([^\]]*)\]/.exec(helv.dict)[1]);
  assert.equal(widths.length, 224);
  assert.equal(widths[65 - 32], 667, 'Helvetica A');
  assert.equal(widths[32 - 32], 278);
  const courier = findObjects(r.objects, /\/BaseFont \/Courier /)[0];
  assert.ok(numbers(/\/Widths \[([^\]]*)\]/.exec(courier.dict)[1]).every((w) => w === 600));
  // text object: flipped text matrix, size, strings
  assert.ok(r.content.includes('1 0 0 -1 10 50 Tm'));
  assert.ok(/\/F\d+ 12 Tf/.test(r.content));
  assert.ok(r.content.includes('(a\\(b\\)c\\\\ d \\351\\200\\223 ?) Tj'), 'WinAnsi codes: e-acute 351, euro 200, quotedblleft 223, CJK -> ?');
  assert.ok(r.content.includes('1.5 Tc'));
  assert.ok(r.content.includes('2 Tr') && r.content.includes('1 Tr'));
  assert.ok(r.content.includes('1 0 0 RG') && r.content.includes('2 w'));
  // underline and strike as rectangles in the text color
  assert.ok(/10 51\.2 40 0\.72 re f/.test(r.content), 'underline at baseline + 0.1 em');
  assert.ok(/10 46\.28 40 0\.72 re f/.test(r.content), 'strike through above the baseline');
  assert.ok(!r.content.includes('(skip)'));
  // text inside an item matrix keeps its transform
  const t = build([{ t: 'text', runs: [run('Z', { family: 'Arial' })], m: [1, 0, 0, 1, 20, 30] }]);
  assert.ok(t.content.includes('1 0 0 1 20 30 cm'));
});

test('text with a gradient fill uses a pattern, with alpha a soft mask', () => {
  const stops = [{ o: 0, color: '#ff0000', alpha: 1 }, { o: 1, color: '#0000ff', alpha: 0.5 }];
  const r = build([
    { t: 'text', runs: [{ text: 'Grad', x: 0, y: 40, width: 50, font: { family: 'Arial', size: 30, weight: 400, style: 'normal' }, fill: { type: 'linear', x0: 0, y0: 0, x1: 50, y1: 0, stops }, stroke: null, letterSpacing: 0, underline: false, strike: false }], m: IDM },
  ]);
  assert.ok(/\/Pattern cs \/P1 scn/.test(r.content));
  assert.ok(findObjects(r.objects, /\/Type \/Mask/).length === 1);
});

// ---------------------------------------------------------------------------------------------------------------
// embedded fonts

const FONT_DIR = 'C:\\Windows\\Fonts';
const arialPath = path.join(FONT_DIR, 'arial.ttf');
const haveArial = fs.existsSync(arialPath);

/** Wraps an sfnt into WOFF 1.0 (per table zlib compression). */
function makeWOFF(ttf) {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const n = dv.getUint16(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(...ttf.subarray(r, r + 4));
    const off = dv.getUint32(r + 8);
    const len = dv.getUint32(r + 12);
    const data = ttf.subarray(off, off + len);
    const z = zlibSync(data);
    tables.push({ tag, orig: len, comp: z.length < len ? z : data, checksum: dv.getUint32(r + 4) });
  }
  let offset = 44 + n * 20;
  const parts = [];
  const dir = new Uint8Array(n * 20);
  const ddv = new DataView(dir.buffer);
  tables.forEach((t, i) => {
    for (let k = 0; k < 4; k++) dir[i * 20 + k] = t.tag.charCodeAt(k);
    ddv.setUint32(i * 20 + 4, offset);
    ddv.setUint32(i * 20 + 8, t.comp.length);
    ddv.setUint32(i * 20 + 12, t.orig);
    ddv.setUint32(i * 20 + 16, t.checksum);
    const padded = (t.comp.length + 3) & ~3;
    const buf = new Uint8Array(padded);
    buf.set(t.comp);
    parts.push(buf);
    offset += padded;
  });
  const header = new Uint8Array(44);
  const hdv = new DataView(header.buffer);
  hdv.setUint32(0, 0x774f4646);
  hdv.setUint32(4, dv.getUint32(0));
  hdv.setUint32(8, offset);
  hdv.setUint16(12, n);
  hdv.setUint32(16, ttf.length);
  const out = new Uint8Array(offset);
  out.set(header);
  out.set(dir, 44);
  let p = 44 + n * 20;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

function compositeComponents(info, gid) {
  const loca = info.getTable('loca');
  const glyf = info.getTable('glyf');
  const lv = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  const fmt = new DataView(info.getTable('head').buffer, info.getTable('head').byteOffset).getInt16(50);
  const off = (g) => (fmt === 0 ? lv.getUint16(g * 2) * 2 : lv.getUint32(g * 4));
  const gv = new DataView(glyf.buffer, glyf.byteOffset, glyf.byteLength);
  const a = off(gid);
  if (off(gid + 1) <= a || gv.getInt16(a) >= 0) return [];
  const out = [];
  let p = a + 10;
  for (;;) {
    const flags = gv.getUint16(p);
    out.push(gv.getUint16(p + 2));
    p += 4 + (flags & 1 ? 4 : 2);
    if (flags & 8) p += 2;
    else if (flags & 0x40) p += 4;
    else if (flags & 0x80) p += 8;
    if (!(flags & 0x20)) break;
  }
  return out;
}

test('embedded TrueType: Type0 / CIDFontType2, subset, widths, ToUnicode', { skip: !haveArial && 'Arial is not installed' }, () => {
  const bytes = new Uint8Array(fs.readFileSync(arialPath));
  const orig = parseFont(bytes);
  const text = 'H\u00e9llo, W\u00f6rld \u20ac (fi) \u00a0end';
  const run = { text, x: 10, y: 40, width: 100, font: { family: 'Arial', size: 16, weight: 400, style: 'normal' }, fill: solid('#000000'), stroke: null, letterSpacing: 0, underline: false, strike: false };
  const calls = [];
  const r = build([{ t: 'text', runs: [run, { ...run, y: 60, text: 'Hello again' }], m: IDM }], {
    compress: true,
    fontProvider: (f) => {
      calls.push(f.family);
      return bytes;
    },
  });
  assert.equal(findObjects(r.objects, /\/Subtype \/Type0/).length, 1, 'one font object for both runs');
  assert.equal(calls.filter((c) => c === 'Arial').length, 1, 'the provider is asked once per font');
  const t0 = findObjects(r.objects, /\/Subtype \/Type0/)[0];
  assert.ok(t0.dict.includes('/Encoding /Identity-H') && t0.dict.includes('/ToUnicode'));
  assert.ok(/\/BaseFont \/[A-Z]{6}\+ArialMT/.test(t0.dict), t0.dict);
  const cid = findObjects(r.objects, /\/Subtype \/CIDFontType2/)[0];
  assert.ok(cid.dict.includes('/CIDToGIDMap /Identity') && cid.dict.includes('/Ordering (Identity)') && cid.dict.includes('/DW 1000'));
  const desc = findObjects(r.objects, /\/Type \/FontDescriptor/)[0];
  assert.ok(/\/Ascent 905/.test(desc.dict) && /\/Descent -212/.test(desc.dict) && /\/CapHeight 716/.test(desc.dict));
  assert.ok(/\/Flags 32/.test(desc.dict));
  const ff = r.objects.get(parseInt(/\/FontFile2 (\d+) 0 R/.exec(desc.dict)[1], 10));
  const sub = streamBytes(ff);
  assert.equal(parseInt(/\/Length1 (\d+)/.exec(ff.dict)[1], 10), sub.length);
  assert.ok(sub.length < bytes.length / 10, `subset is small: ${sub.length} vs ${bytes.length}`);
  const si = parseFont(sub);
  assert.ok(si, 'the subset parses as a font');
  const usedCps = [...new Set([...text + 'Hello again'].map((c) => c.codePointAt(0)))];
  const usedGids = new Set(usedCps.map((cp) => orig.glyphForCodePoint(cp)));
  usedGids.add(0);
  const maxGid = Math.max(...usedGids);
  assert.equal(si.numGlyphs, maxGid + 1, 'glyph table is truncated after the highest used glyph');
  for (const g of usedGids) {
    assert.deepEqual(si.glyphBounds(g), orig.glyphBounds(g), `outline of glyph ${g} is kept`);
    assert.equal(si.advanceWidth(g), orig.advanceWidth(g));
    for (const comp of compositeComponents(orig, g)) assert.deepEqual(si.glyphBounds(comp), orig.glyphBounds(comp), `component ${comp} of glyph ${g}`);
  }
  assert.ok(compositeComponents(orig, orig.glyphForCodePoint(0xe9)).length >= 2, 'e-acute is a composite glyph in Arial');
  let unusedCount = 0;
  for (let g = 1; g <= maxGid; g++) {
    if (!usedGids.has(g)) {
      const isComponent = [...usedGids].some((u) => compositeComponents(orig, u).includes(g));
      if (!isComponent) {
        assert.equal(si.glyphBounds(g), null, `unused glyph ${g} has no outline`);
        unusedCount++;
      }
    }
  }
  assert.ok(unusedCount > 20);
  // text string: 2 byte glyph ids
  const hex = [...text].map((c) => orig.glyphForCodePoint(c.codePointAt(0)).toString(16).padStart(4, '0')).join('');
  assert.ok(r.content.includes(`<${hex}> Tj`), 'glyph ids in the content stream');
  // /W array matches the font advances (design units scaled to 1000)
  const wStart = cid.dict.indexOf('/W [') + 4;
  let depth = 1;
  let wEnd = wStart;
  while (depth > 0) {
    const ch = cid.dict[wEnd++];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
  }
  const W = cid.dict.slice(wStart, wEnd - 1);
  const widths = new Map();
  for (const m of W.matchAll(/(\d+) \[([^\]]*)\]/g)) numbers(m[2]).forEach((w, i) => widths.set(parseInt(m[1], 10) + i, w));
  for (const cp of usedCps) {
    const g = orig.glyphForCodePoint(cp);
    assert.equal(widths.get(g), Math.round((orig.advanceWidth(g) * 1000) / 2048), `width of glyph ${g} (U+${cp.toString(16)})`);
  }
  // ToUnicode
  const tu = latin1Str(streamBytes(r.objects.get(parseInt(/\/ToUnicode (\d+) 0 R/.exec(t0.dict)[1], 10))));
  assert.ok(tu.includes('begincmap') && tu.includes('beginbfchar') && tu.includes('<0000> <FFFF>'));
  const hexOf = (cp) => cp.toString(16).padStart(4, '0');
  assert.ok(tu.includes(`<${orig.glyphForCodePoint(0x48).toString(16).padStart(4, '0')}> <${hexOf(0x48)}>`));
  assert.ok(tu.includes(`<${orig.glyphForCodePoint(0x20ac).toString(16).padStart(4, '0')}> <20ac>`));
  assert.ok(tu.includes(`<${orig.glyphForCodePoint(0xe9).toString(16).padStart(4, '0')}> <00e9>`));
});

test('embedded fonts: WOFF input, license bits, bad providers and ignorable characters', { skip: !haveArial && 'Arial is not installed' }, () => {
  const ttf = new Uint8Array(fs.readFileSync(arialPath));
  const woff = makeWOFF(ttf);
  const wi = parseFont(woff);
  const ti = parseFont(ttf);
  assert.ok(wi, 'WOFF unwraps');
  assert.equal(wi.numGlyphs, ti.numGlyphs);
  assert.equal(wi.glyphForCodePoint(0x41), ti.glyphForCodePoint(0x41));
  const run = (text) => ({ text, x: 0, y: 20, width: 50, font: { family: 'Arial', size: 12, weight: 400, style: 'normal' }, fill: solid('#000000'), stroke: null, letterSpacing: 0, underline: false, strike: false });
  const items = [{ t: 'text', runs: [run('A\u200bB\u00adC')], m: IDM }];
  let r = build(items, { fontProvider: () => woff });
  assert.equal(findObjects(r.objects, /\/Subtype \/Type0/).length, 1);
  const hex = [0x41, 0x42, 0x43].map((cp) => ti.glyphForCodePoint(cp).toString(16).padStart(4, '0')).join('');
  assert.ok(r.content.includes(`<${hex}> Tj`), 'zero-width characters are not encoded');
  // restricted license -> base-14 fallback
  const restricted = ttf.slice();
  const rd = new DataView(restricted.buffer);
  for (let i = 0; i < rd.getUint16(4); i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...restricted.subarray(rec, rec + 4)) === 'OS/2') rd.setUint16(rd.getUint32(rec + 8) + 8, 2);
  }
  assert.equal(parseFont(restricted).embeddable, false);
  r = build(items, { fontProvider: () => restricted });
  assert.equal(findObjects(r.objects, /\/Subtype \/Type0/).length, 0);
  assert.equal(findObjects(r.objects, /\/BaseFont \/Helvetica /).length, 1);
  // garbage / null / throwing providers fall back to base-14 fonts
  for (const provider of [() => new Uint8Array([1, 2, 3, 4]), () => null, () => undefined, () => { throw new Error('boom'); }]) {
    r = build(items, { fontProvider: provider });
    assert.equal(findObjects(r.objects, /\/Subtype \/Type0/).length, 0);
    assert.equal(findObjects(r.objects, /\/Subtype \/Type1/).length, 1);
  }
  // different weights are different font requests
  r = build([{ t: 'text', runs: [run('x'), { ...run('y'), font: { family: 'Arial', size: 12, weight: 700, style: 'normal' } }], m: IDM }], { fontProvider: (f) => (f.weight === 700 ? woff : ttf) });
  assert.equal(findObjects(r.objects, /\/Subtype \/Type0/).length, 2);
});

test('layout output flows into the PDF: embedded fonts, searchable text', { skip: !haveArial && 'Arial is not installed' }, () => {
  const arial = parseFont(new Uint8Array(fs.readFileSync(arialPath)));
  const meas = makeSfntMeasurer((f) => (f.family === 'Arial' ? arial : null));
  const story = storyFromPlain('Typography with embedded fonts keeps text searchable and copyable in the exported file.', undefined, { align: 'justify' });
  const res = layoutStory(story, [{ x: 20, y: 20, w: 200, h: 200 }], { ...meas, defaults: { char: { fontFamily: 'Arial', fontSize: 14, fontWeight: 400, fontStyle: 'normal', color: '#102030' }, para: { lineHeight: 1.3 } } });
  const runs = [];
  for (const line of res.frames[0].lines) {
    for (const r of line.runs) {
      if (!r.text) continue;
      runs.push({ text: r.text, x: r.x, y: line.baseline - r.baselineShift, width: r.width, font: r.font, fill: solid(r.color), stroke: null, letterSpacing: r.letterSpacing, underline: r.underline, strike: r.strike });
    }
  }
  const out = build([{ t: 'text', runs, m: IDM }], { compress: true, fontProvider: () => fs.readFileSync(arialPath) }, [240, 240]);
  // decode every Tj back to text through the font's glyph map and compare with the story
  const gidToCp = new Map();
  for (let cp = 32; cp < 127; cp++) gidToCp.set(arial.glyphForCodePoint(cp), cp);
  const decoded = [...out.content.matchAll(/<([0-9a-f]+)> Tj/g)].map((m) => {
    let s = '';
    for (let i = 0; i < m[1].length; i += 4) s += String.fromCodePoint(gidToCp.get(parseInt(m[1].slice(i, i + 4), 16)));
    return s;
  });
  assert.equal(decoded.join(''), plainText(story), 'all runs are present in order');
});

test('robustness: unknown items, malformed data and adjust items never break the file', () => {
  const garbage = [
    null,
    undefined,
    5,
    { t: 'adjust', kind: 'levels', params: {} },
    { t: 'path' },
    { t: 'path', d: 'nope', fill: solid('#000'), m: 'x' },
    { t: 'path', d: [['M', NaN, 1], ['L', Infinity, 2], ['Z'], ['X', 1]], fill: solid('red'), stroke: stroke(solid('#00000'), NaN), m: [1, 2] },
    { t: 'text', runs: [{ text: 'x' }, null, { text: 5 }, { text: 'ok', x: NaN, y: undefined, font: { size: 0 } }], m: IDM },
    { t: 'text' },
    { t: 'image', img: { id: 'z', width: 0, height: 0 }, m: IDM },
    { t: 'image', img: null },
    { t: 'group' },
    { t: 'group', items: [{ t: 'group', items: 'x', opacity: 'a', blend: 'weird', clip: { d: 'x' } }], opacity: 0.5 },
    { t: 'mystery' },
  ];
  const r = build(garbage);
  assert.ok(r.bytes.length > 500);
  // dimensions that are not numbers still give a valid page
  const pdf = createPDF([{ width: 'a', height: -1, items: [] }, null, {}]);
  checkPdf(pdf);
});

test('compression: Flate when enabled, readable content when disabled', () => {
  const items = [];
  for (let i = 0; i < 50; i++) items.push(pathItem({ d: rectD(i, i, 10, 10) }));
  const plain = createPDF([{ width: 100, height: 100, items }], { compress: false, creationDate: DATE });
  const packed = createPDF([{ width: 100, height: 100, items }], { creationDate: DATE });
  assert.ok(packed.length < plain.length);
  const pp = checkPdf(packed);
  const content = pageContent(pp.objects, pageObjects(pp.objects, pp.trailer)[0]);
  assert.ok(content.includes('49 49 m'));
  assert.ok(latin1Str(plain).includes('49 49 m'));
  assert.ok(!latin1Str(packed).includes('49 49 m'));
  assert.ok(/\/Filter \/FlateDecode/.test(pp.text));
});

test('structure checker catches broken files', () => {
  const good = createPDF([{ width: 10, height: 10, items: [pathItem()] }], { creationDate: DATE });
  assert.deepEqual(parsePdf(good).errors, []);
  const text = latin1Str(good);
  // corrupt an xref offset
  const bad = new Uint8Array(good);
  const at = text.indexOf('xref\n0 ') + 'xref\n0 12\n'.length + 20 + 3;
  bad[at] = bad[at] === 0x39 ? 0x31 : bad[at] + 1;
  assert.ok(parsePdf(bad).errors.length > 0);
  // truncated file
  assert.ok(parsePdf(good.subarray(0, good.length - 40)).errors.length > 0);
});

// ---------------------------------------------------------------------------------------------------------------
// optional: validation with pdf.js (set OPENFINI_PDFJS to a directory with node_modules/pdfjs-dist)

const pdfjsDir = process.env.OPENFINI_PDFJS;

test('pdf.js can open, interpret and extract text (set OPENFINI_PDFJS to enable)', { skip: !pdfjsDir && 'OPENFINI_PDFJS is not set' }, async () => {
  const pdfjs = await import(pathToFileURL(path.join(pdfjsDir, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const std = path.join(pdfjsDir, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/') + '/';
  const run = (text, family, y, extra) => ({ text, x: 20, y, width: 300, font: { family, size: 16, weight: 400, style: 'normal' }, fill: solid('#000000'), stroke: null, letterSpacing: 0, underline: false, strike: false, ...(extra || {}) });
  const items = [
    { t: 'path', d: rectD(0, 0, 400, 300), rule: 'nonzero', fill: { type: 'linear', x0: 0, y0: 0, x1: 400, y1: 0, stops: [{ o: 0, color: '#ffffff', alpha: 1 }, { o: 1, color: '#ccddff', alpha: 0.6 }] }, stroke: null, m: IDM },
    { t: 'text', runs: [run('Standard font line', 'Helvetica', 40), run('Serif line (parens) \u00e9\u00e8 \u20ac', 'Times New Roman', 70), run('Monospaced text', 'Courier New', 100)], m: IDM },
    { t: 'group', opacity: 0.5, blend: 'multiply', isolate: true, clip: null, m: IDM, items: [pathItem({ d: rectD(20, 150, 100, 100), fill: solid('#ff0000') })] },
  ];
  const withFont = haveArial
    ? [{ t: 'text', runs: [run('Embedded Arial text H\u00e9llo', 'Arial', 140)], m: IDM }]
    : [];
  const bytes = createPDF([{ width: 400, height: 300, items: [...items, ...withFont] }], {
    title: 'pdf.js check',
    creationDate: DATE,
    fontProvider: (f) => (haveArial && f.family === 'Arial' ? fs.readFileSync(arialPath) : null),
  });
  checkPdf(bytes);
  const warnings = [];
  const realLog = console.log;
  console.log = (...a) => {
    const s = a.join(' ');
    if (/^(Warning|Error)/.test(s)) warnings.push(s);
    else realLog(...a);
  };
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 1, useSystemFonts: false, standardFontDataUrl: std });
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1);
    assert.deepEqual(page.view, [0, 0, 300, 225]);
    const ops = await page.getOperatorList();
    assert.ok(ops.fnArray.length > 10);
    const tc = await page.getTextContent();
    const text = tc.items.map((t) => t.str).join('');
    assert.ok(text.includes('Standard font line'));
    assert.ok(text.includes('Serif line (parens) \u00e9\u00e8 \u20ac'));
    assert.ok(text.includes('Monospaced text'));
    if (haveArial) assert.ok(text.includes('Embedded Arial text H\u00e9llo'));
    const meta = await pdf.getMetadata();
    assert.equal(meta.info.Title, 'pdf.js check');
    await task.destroy();
  } finally {
    console.log = realLog;
  }
  assert.deepEqual(warnings, []);
});
