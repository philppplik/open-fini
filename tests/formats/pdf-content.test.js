import test from 'node:test';
import assert from 'node:assert/strict';
import { openPdf, readPage, parsePageRange, pageSizes, PdfPasswordError, imageDataToRGBA } from '../../app/src/core/pdf-source.js';
import { buildBlocks, buildLines, pageText } from '../../app/src/engine/formats/pdf-layout.js';
import { PdfBuilder, simplePdf, helvetica } from './_pdf-fixture.js';
import { createPDF } from '../../app/src/engine/backends/pdf.js';

const near = (a, b, e = 0.6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

async function read(bytes, n = 1, opt) {
  const src = await openPdf(bytes, opt);
  try {
    return { src, page: await readPage(src, n), sizes: null };
  } catch (e) {
    src.destroy();
    throw e;
  }
}

test('page range parser', () => {
  assert.deepEqual(parsePageRange('', 4), [1, 2, 3, 4]);
  assert.deepEqual(parsePageRange('1-2, 4', 6), [1, 2, 4]);
  assert.deepEqual(parsePageRange('3-', 5), [3, 4, 5]);
  assert.deepEqual(parsePageRange('2, 2, 9', 5), [2]);
  assert.equal(parsePageRange('x', 5), null);
  assert.equal(parsePageRange('4-2', 5), null);
});

test('text: positions, size, color, spacing and TJ gaps', async () => {
  const bytes = simplePdf(`BT /F1 12 Tf 0 0.5 1 rg 1 0 0 1 20 150 Tm (Hello World) Tj 0 -14 Td [(Ke) 120 (rn) -300 (ing)] TJ ET
BT /F2 10 Tf 1 0 0 rg 50 100 Td 2 Tc (Wide) Tj ET`);
  const { src, page } = await read(bytes);
  try {
    assert.equal(page.w, 200);
    assert.equal(page.h, 200);
    const t = page.items.filter((i) => i.k === 'text');
    assert.equal(t.length, 3);
    assert.equal(t[0].text, 'Hello World');
    near(t[0].x, 20);
    near(t[0].y, 50); // PDF y 150 -> page y 200-150
    near(t[0].size, 12);
    assert.equal(t[0].color, '#0080ff');
    near(t[0].advance, ((722 + 556 + 222 + 222 + 556 + 278 + 944 + 556 + 333 + 222 + 556) / 1000) * 12, 0.05);
    assert.equal(t[1].text, 'Kern ing', 'small TJ gaps stay inside a word, large ones become spaces');
    assert.ok(t[1].advance > 0);
    assert.equal(t[2].color, '#ff0000');
    assert.equal(t[2].text, 'Wide');
    near(t[2].advance, ((1000 + 278 + 556 + 444) / 1000) * 10 + 4 * 2, 0.1);
  } finally {
    src.destroy();
  }
});

test('text line grouping and paragraph blocks', async () => {
  const lines = [];
  for (let i = 0; i < 4; i++) lines.push(`BT /F1 11 Tf 40 ${180 - i * 14} Td (Line number ${i + 1} of the paragraph) Tj ET`);
  lines.push('BT /F2 20 Tf 40 100 Td (Title) Tj ET');
  lines.push('BT /F1 11 Tf 40 60 Td (Part one ) Tj ET BT /F1 11 Tf 85 60 Td (part two) Tj ET');
  const { src, page } = await read(simplePdf(lines.join('\n')));
  try {
    const text = page.items.filter((i) => i.k === 'text');
    const blocks = buildBlocks(text);
    assert.equal(blocks.length, 3);
    const para = blocks.find((b) => b.lines.length === 4);
    assert.ok(para, 'four lines form one paragraph');
    near(para.pitch, 14, 0.2);
    assert.equal(para.lines[1].text, 'Line number 2 of the paragraph');
    const one = blocks.find((b) => b.lines.length === 1 && b.size < 12);
    assert.equal(one.lines[0].text.replace(/\s+/g, ' '), 'Part one part two');
    assert.ok(pageText(text).startsWith('Line number 1'));
    // reflow mode splits at short lines only
    assert.equal(buildBlocks(text, { reflow: true }).filter((b) => b.lines.length > 1).length >= 1, true);
    assert.equal(buildLines([]).length, 0);
  } finally {
    src.destroy();
  }
});

test('vector paths: fill, stroke, dash, even-odd, curves, clipping, alpha', async () => {
  const content = `q 1 0 0 RG 2 w [3 1] 0 d 1 J 1 j 10 10 80 40 re S Q
q 0.5 g 20 20 m 60 20 l 40 60 l h f* Q
q 0 0 50 50 re W n 0 0 1 rg 0 0 100 100 re f Q
q /GS1 gs 0 1 0 rg 100 100 m 120 100 150 120 150 150 c f Q`;
  const bytes = simplePdf(content, { resourcesExtra: '/ExtGState << /GS1 << /ca 0.4 >> >>' });
  const { src, page } = await read(bytes);
  try {
    const paths = page.items.filter((i) => i.k === 'path');
    assert.equal(paths.length, 4);
    const [stroke, tri, clipped, curve] = paths;
    assert.equal(stroke.stroke.color, '#ff0000');
    near(stroke.stroke.width, 2, 0.01);
    assert.deepEqual(stroke.stroke.dash, [3, 1]);
    assert.equal(stroke.stroke.cap, 'round');
    assert.equal(stroke.stroke.join, 'round');
    assert.equal(stroke.fill, null);
    assert.equal(tri.rule, 'evenodd');
    assert.equal(tri.fill.color, '#808080');
    assert.equal(clipped.clip.length, 1, 'clip path is kept');
    assert.deepEqual(clipped.clip[0].bbox, { x: 0, y: 150, w: 50, h: 50 });
    assert.equal(tri.clip.length, 0);
    assert.ok(curve.d.some((c) => c[0] === 'C'));
    near(curve.alpha, 0.4, 0.001);
    near(stroke.d[0][2], 200 - 10, 0.01); // y flipped
  } finally {
    src.destroy();
  }
});

test('axial and radial shadings become gradients', async () => {
  const b = new PdfBuilder();
  const fn = b.add('<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>');
  const ax = b.add(`<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 200 0] /Function ${fn} 0 R /Extend [true true] >>`);
  const rd = b.add(`<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [100 100 0 100 100 50] /Function ${fn} 0 R /Extend [true true] >>`);
  const pat = b.add(`<< /Type /Pattern /PatternType 2 /Shading ${rd} 0 R >>`);
  b.addPage({ content: '/Sh1 sh\n/Pattern cs /P1 scn 20 20 100 100 re f', resources: `<< /Shading << /Sh1 ${ax} 0 R >> /Pattern << /P1 ${pat} 0 R >> >>` });
  const { src, page } = await read(b.finish());
  try {
    const g = page.items.filter((i) => i.k === 'path');
    assert.equal(g.length, 2);
    assert.equal(g[0].fill.grad.type, 'linear');
    near(g[0].fill.grad.x1, 200, 0.01);
    assert.equal(g[0].fill.grad.stops[0].color, '#ff0000');
    assert.equal(g[1].fill.grad.type, 'radial');
    near(g[1].fill.grad.r1, 50, 0.01);
    near(g[1].fill.grad.y1, 100, 0.01);
  } finally {
    src.destroy();
  }
});

test('images: Flate RGB, gray, inline and stencil mask', async () => {
  const b = new PdfBuilder();
  const rgb = b.addStream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8', Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]), { flate: true });
  const gray = b.addStream('/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', Uint8Array.from([0, 200]));
  const mask = b.addStream('/Type /XObject /Subtype /Image /Width 8 /Height 1 /ImageMask true /BitsPerComponent 1', Uint8Array.from([0b10101010]));
  b.addPage({ content: '1 0 0 rg q 40 0 0 40 120 20 cm /Im1 Do Q q 20 0 0 10 10 10 cm /Im2 Do Q q 80 0 0 10 10 60 cm /Im3 Do Q q 10 0 0 10 0 0 cm BI /W 1 /H 1 /CS /G /BPC 8 ID \x80 EI Q', resources: `<< /XObject << /Im1 ${rgb} 0 R /Im2 ${gray} 0 R /Im3 ${mask} 0 R >> >>` });
  const { src, page } = await read(b.finish());
  try {
    const im = page.items.filter((i) => i.k === 'image');
    assert.equal(im.length, 4);
    const rgba = imageDataToRGBA(page.images.get(im[0].id));
    assert.deepEqual([...rgba.slice(0, 8)], [255, 0, 0, 255, 0, 255, 0, 255]);
    near(im[0].m[0] * im[0].w, 40, 0.01); // 2 px image drawn 40 wide
    const g = imageDataToRGBA(page.images.get(im[1].id));
    assert.deepEqual([...g.slice(0, 8)], [0, 0, 0, 255, 200, 200, 200, 255]);
    assert.equal(im[2].mask, true);
    const m = imageDataToRGBA(page.images.get(im[2].id), { mask: true, color: im[2].color });
    assert.notEqual(m[3], m[7], 'alternating stencil bits give alternating alpha');
    assert.equal(im[3].data.width, 1);
  } finally {
    src.destroy();
  }
});

test('page geometry: MediaBox, CropBox and rotation', async () => {
  const bytes = simplePdf('BT /F1 10 Tf 30 60 Td (Rot) Tj ET', { mediaBox: [10, 20, 210, 320], cropBox: [20, 30, 200, 300], rotate: 90 });
  const { src, page } = await read(bytes);
  try {
    assert.equal(page.w, 270);
    assert.equal(page.h, 180);
    const t = page.items.find((i) => i.k === 'text');
    near(Math.abs(t.angle), Math.PI / 2, 0.01); // the text turns with the page
  } finally {
    src.destroy();
  }
});

test('object streams and cross-reference streams', async () => {
  const { src, page } = await read(simplePdf('BT /F1 14 Tf 10 100 Td (Packed objects) Tj ET', { objStm: true }));
  try {
    assert.equal(page.items.find((i) => i.k === 'text').text, 'Packed objects');
  } finally {
    src.destroy();
  }
});

test('RC4-40 encryption: empty user password opens, user password is requested', async () => {
  const empty = simplePdf('BT /F1 14 Tf 10 100 Td (Secret text) Tj ET', { encrypt: { user: '' } });
  const a = await read(empty);
  try {
    assert.equal(a.page.items.find((i) => i.k === 'text').text, 'Secret text');
    assert.ok(a.src.encrypted || a.src.permissions !== undefined);
  } finally {
    a.src.destroy();
  }
  const locked = simplePdf('BT /F1 14 Tf 10 100 Td (Locked text) Tj ET', { encrypt: { user: 'open sesame', owner: 'boss' } });
  await assert.rejects(() => openPdf(locked), (e) => e instanceof PdfPasswordError && !e.incorrect);
  await assert.rejects(() => openPdf(locked, { password: 'nope' }), (e) => e instanceof PdfPasswordError && e.incorrect);
  const ok = await read(locked, 1, { password: 'open sesame' });
  try {
    assert.equal(ok.page.items.find((i) => i.k === 'text').text, 'Locked text');
  } finally {
    ok.src.destroy();
  }
});

test('invalid input gives a clear error', async () => {
  await assert.rejects(() => openPdf(new TextEncoder().encode('%PDF-1.4 not really a pdf')), /PDF|read/i);
});

test('multi-page documents report sizes', async () => {
  const b = new PdfBuilder();
  const f = helvetica(b);
  for (const [w, h] of [[100, 200], [300, 150], [50, 50]]) b.addPage({ mediaBox: [0, 0, w, h], content: 'BT /F1 8 Tf 5 5 Td (x) Tj ET', resources: `<< /Font << /F1 ${f} 0 R >> >>` });
  const src = await openPdf(b.finish());
  try {
    assert.equal(src.pages, 3);
    assert.deepEqual((await pageSizes(src, [2, 3])).map((p) => [p.w, p.h]), [[300, 150], [50, 50]]);
  } finally {
    src.destroy();
  }
});

test('round trip: text and geometry of OpenFini PDF export survive the import', async () => {
  const IDM = [1, 0, 0, 1, 0, 0];
  const solid = (color, alpha = 1) => ({ type: 'solid', color, alpha });
  const runs = [
    { text: 'Quarterly Report', x: 30, y: 60, width: 150, font: { family: 'Helvetica', size: 24, weight: 700, style: 'normal' }, fill: solid('#112233'), stroke: null, letterSpacing: 0, underline: false, strike: false },
    { text: 'Revenue grew by twelve percent.', x: 30, y: 100, width: 180, font: { family: 'Times New Roman', size: 12, weight: 400, style: 'italic' }, fill: solid('#444444'), stroke: null, letterSpacing: 0, underline: false, strike: false },
  ];
  const items = [
    { t: 'path', d: [['M', 20, 20], ['L', 220, 20], ['L', 220, 120], ['L', 20, 120], ['Z']], rule: 'nonzero', fill: solid('#eeeeee'), stroke: null, m: IDM },
    { t: 'text', runs, m: IDM },
  ];
  const bytes = createPDF([{ width: 300, height: 200, items }], { compress: true });
  const { src, page } = await read(bytes);
  try {
    // the writer uses 96 px per inch, so one OpenFini px is 0.75 pt
    near(page.w, 225, 0.01);
    const t = page.items.filter((i) => i.k === 'text');
    assert.deepEqual(t.map((i) => i.text), ['Quarterly Report', 'Revenue grew by twelve percent.']);
    near(t[0].x, 30 * 0.75, 0.05);
    near(t[0].y, 60 * 0.75, 0.05);
    near(t[0].size, 24 * 0.75, 0.01);
    assert.equal(t[0].color, '#112233');
    const r = page.items.find((i) => i.k === 'path');
    assert.equal(r.fill.color, '#eeeeee');
    near(r.d[0][1], 15, 0.01);
    assert.match(t[0].fontName, /Helvetica/);
  } finally {
    src.destroy();
  }
});

// ---- embedded fonts -------------------------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { parseFont } from '../../app/src/engine/layout/index.js';
import { remapFontCmap, substituteFont, stripSubset } from '../../app/src/engine/formats/pdf-fonts.js';

const FONT_DIR = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : '/usr/share/fonts/truetype/msttcorefonts';
const arialPath = path.join(FONT_DIR, 'arial.ttf');

test('font substitution names', () => {
  assert.equal(stripSubset('ABCDEF+Arial-BoldMT'), 'Arial-BoldMT');
  assert.deepEqual(substituteFont('ABCDEF+Arial-BoldMT'), { family: 'Helvetica', weight: 700, style: 'normal', known: true });
  assert.deepEqual(substituteFont('TimesNewRomanPS-ItalicMT').style, 'italic');
  assert.equal(substituteFont('Foo-Regular', { serif: true }).family, 'Times New Roman');
  assert.equal(substituteFont('SomethingMono').family, 'Courier New');
  assert.equal(substituteFont('Unknown-Light').weight, 300);
});

test('embedded TrueType fonts are extracted and remapped to Unicode', { skip: !fs.existsSync(arialPath) }, async () => {
  const IDM = [1, 0, 0, 1, 0, 0];
  const ttf = new Uint8Array(fs.readFileSync(arialPath));
  const items = [{ t: 'text', runs: [{ text: 'Hello Wörld Ä', x: 20, y: 40, width: 80, font: { family: 'Arial', size: 16, weight: 400, style: 'normal' }, fill: { type: 'solid', color: '#0000ff', alpha: 1 }, stroke: null, letterSpacing: 0, underline: false, strike: false }], m: IDM }];
  const bytes = createPDF([{ width: 200, height: 100, items }], { fontProvider: () => ttf });
  const { src, page } = await read(bytes);
  try {
    const t = page.items.find((i) => i.k === 'text');
    assert.equal(t.text, 'Hello Wörld Ä');
    const font = page.fonts.get(t.fontId);
    assert.ok(font.data && font.data.length > 1000, 'font program is available');
    const pairs = page.fontUse.get(t.fontId);
    assert.ok(pairs.size >= 8);
    const fixed = remapFontCmap(font.data, pairs);
    const info = parseFont(fixed);
    assert.ok(info, 'rebuilt font parses');
    for (const ch of 'HeloWördÄ') assert.ok(info.glyphForCodePoint(ch.codePointAt(0)) > 0, `glyph for ${ch}`);
    assert.equal(info.glyphForCodePoint('Q'.codePointAt(0)), 0, 'subset has no glyph for unused characters');
  } finally {
    src.destroy();
  }
});
