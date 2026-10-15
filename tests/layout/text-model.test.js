import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStory,
  storyFromPlain,
  storyFromPlainWithTabs,
  plainText,
  storyLength,
  normalizeStory,
  insertText,
  deleteRange,
  sliceStory,
  insertStory,
  getAttrsAt,
  getStyleAt,
  applyCharAttrs,
  applyCharStyle,
  applyParaAttrs,
  applyParaStyle,
  paragraphAt,
  paragraphStarts,
  wordRange,
  resolveRun,
  resolveParagraph,
  createStyleResolver,
  storyToJSON,
  storyFromJSON,
  validateStory,
  storyToHTML,
  normalizeInputText,
  DEFAULTS,
} from '../../app/src/engine/layout/text-model.js';

/** Deterministic PRNG so failures are reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const B = { fontWeight: 700 };
const I = { fontStyle: 'italic' };

test('emptyStory / storyFromPlain / plainText round trip', () => {
  assert.deepEqual(emptyStory(), { paragraphs: [{ runs: [] }] });
  assert.equal(storyLength(emptyStory()), 0);
  const s = storyFromPlain('Hello\nWorld\r\n\nEnd');
  assert.equal(s.paragraphs.length, 4);
  assert.equal(plainText(s), 'Hello\nWorld\n\nEnd');
  assert.equal(storyLength(s), 'Hello\nWorld\n\nEnd'.length);
  assert.deepEqual(s.paragraphs[2], { runs: [] });
  const t = storyFromPlain('x', { fontWeight: 700 }, { align: 'center' });
  assert.deepEqual(t, { paragraphs: [{ runs: [{ text: 'x', attrs: { fontWeight: 700 } }], attrs: { align: 'center' } }] });
});

test('storyFromPlainWithTabs sets tab stops and keeps tab characters', () => {
  const s = storyFromPlainWithTabs('a\tb\nc\td', [{ pos: 200, align: 'right', leader: '.' }, { pos: 100, align: 'left' }]);
  assert.equal(plainText(s), 'a\tb\nc\td');
  assert.deepEqual(s.paragraphs[0].attrs.tabs.map((t) => t.pos), [100, 200]);
  const g = storyFromPlainWithTabs('x\ty', 50);
  assert.equal(g.paragraphs[0].attrs.tabs.length, 20);
  assert.equal(g.paragraphs[0].attrs.tabs[1].pos, 100);
});

test('normalizeInputText', () => {
  assert.equal(normalizeInputText('a\r\nb\rc\u{2029}d'), 'a\nb\nc\nd');
  assert.equal(normalizeInputText('a\u000bb'), 'a\u{2028}b');
  assert.equal(normalizeInputText('a\u0000b\u0007c\td'), 'abc\td');
});

test('normalizeStory merges, drops empties, keeps one paragraph and preserves identity', () => {
  const s = normalizeStory({
    paragraphs: [
      { runs: [{ text: 'ab', attrs: B }, { text: '' }, { text: 'cd', attrs: { fontWeight: 700 } }, { text: 'e', attrs: {} }, { text: 'f', attrs: { color: undefined } }] },
    ],
  });
  assert.deepEqual(s, { paragraphs: [{ runs: [{ text: 'abcd', attrs: B }, { text: 'ef' }] }] });
  assert.deepEqual(normalizeStory({ paragraphs: [] }), { paragraphs: [{ runs: [] }] });
  const n = normalizeStory(s);
  assert.equal(n, s, 'already canonical story is returned as is');
  const edited = insertText(s, 0, 'Z');
  assert.equal(edited.paragraphs.length, 1);
  const two = storyFromPlain('one\ntwo');
  const three = insertText(two, 0, 'X');
  assert.notEqual(three.paragraphs[0], two.paragraphs[0]);
  assert.equal(three.paragraphs[1], two.paragraphs[1], 'untouched paragraph keeps identity');
});

test('insertText: inheritance from the left neighbor, explicit attrs, newlines', () => {
  let s = { paragraphs: [{ runs: [{ text: 'bold', attrs: B }, { text: 'plain' }] }] };
  let r = insertText(s, 4, 'X');
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'boldX', attrs: B }, { text: 'plain' }]);
  r = insertText(s, 0, 'X');
  assert.deepEqual(r.paragraphs[0].runs[0], { text: 'Xbold', attrs: B }, 'at paragraph start the first run is inherited');
  r = insertText(s, 9, 'Y');
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'bold', attrs: B }, { text: 'plainY' }]);
  r = insertText(s, 4, 'X', I);
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'bold', attrs: B }, { text: 'X', attrs: I }, { text: 'plain' }]);
  r = insertText(s, 2, 'X', {});
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'bo', attrs: B }, { text: 'X' }, { text: 'ld', attrs: B }, { text: 'plain' }]);
  // newline splitting
  r = insertText(s, 4, 'a\nb\nc');
  assert.equal(r.paragraphs.length, 3);
  assert.equal(plainText(r), 'bolda\nb\ncplain');
  assert.deepEqual(r.paragraphs[2].runs, [{ text: 'c', attrs: B }, { text: 'plain' }]);
  // paragraph attrs preserved on both halves
  const p = storyFromPlain('hello world', undefined, { align: 'center' });
  const sp = insertText(p, 5, '\n');
  assert.deepEqual(sp.paragraphs.map((x) => x.attrs), [{ align: 'center' }, { align: 'center' }]);
  assert.equal(plainText(sp), 'hello\n world');
  // empty paragraph inherits from the previous non-empty paragraph
  let e = { paragraphs: [{ runs: [{ text: 'a', attrs: B }] }, { runs: [] }] };
  e = insertText(e, 2, 'z');
  assert.deepEqual(e.paragraphs[1].runs, [{ text: 'z', attrs: B }]);
  assert.equal(insertText(s, 3, ''), s);
  // clamping
  assert.equal(plainText(insertText(s, 999, '!')), 'boldplain!');
  assert.equal(plainText(insertText(s, -5, '!')), '!boldplain');
});

test('insertText applies the next paragraph style when breaking at the end of a paragraph', () => {
  const styles = { paragraph: { h1: { name: 'H1', next: 'body' }, body: { name: 'Body' } }, character: {} };
  let s = { paragraphs: [{ runs: [{ text: 'Title' }], styleId: 'h1' }] };
  let r = insertText(s, 5, '\nText', undefined, { styles });
  assert.equal(r.paragraphs[0].styleId, 'h1');
  assert.equal(r.paragraphs[1].styleId, 'body');
  r = insertText(s, 2, '\n', undefined, { styles });
  assert.equal(r.paragraphs[1].styleId, 'h1', 'only applies at the very end');
});

test('deleteRange merges paragraphs and keeps the right attributes', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: 'abc' }], attrs: { align: 'left' } },
      { runs: [{ text: 'def', attrs: B }], attrs: { align: 'right' } },
      { runs: [{ text: 'ghi' }], attrs: { align: 'center' } },
    ],
  };
  let r = deleteRange(s, 2, 5);
  assert.equal(plainText(r), 'abef\nghi');
  assert.deepEqual(r.paragraphs[0].attrs, { align: 'left' });
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'ab' }, { text: 'ef', attrs: B }]);
  r = deleteRange(s, 3, 4); // just the break
  assert.equal(plainText(r), 'abcdef\nghi');
  r = deleteRange(s, 0, storyLength(s));
  assert.deepEqual(r, { paragraphs: [{ runs: [], attrs: { align: 'left' } }] });
  r = deleteRange(s, 5, 2); // reversed
  assert.equal(plainText(r), 'abef\nghi');
  // first paragraph empty -> takes the attrs of the last
  const e = { paragraphs: [{ runs: [], attrs: { align: 'left' } }, { runs: [{ text: 'x' }], attrs: { align: 'right' } }] };
  r = deleteRange(e, 0, 1);
  assert.deepEqual(r, { paragraphs: [{ runs: [{ text: 'x' }], attrs: { align: 'right' } }] });
  assert.equal(deleteRange(s, 3, 3), s);
});

test('sliceStory / insertStory (paste) round trip text', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: 'one ', attrs: B }, { text: 'two' }], attrs: { align: 'left' } },
      { runs: [{ text: 'three' }], attrs: { align: 'right' } },
      { runs: [{ text: 'four', attrs: I }] },
    ],
  };
  const sl = sliceStory(s, 2, 12);
  assert.equal(plainText(sl), plainText(s).slice(2, 12));
  assert.deepEqual(sl.paragraphs[0].attrs, { align: 'left' });
  const base = storyFromPlain('HEAD|TAIL');
  const pasted = insertStory(base, 5, sl);
  assert.equal(plainText(pasted), 'HEAD|' + plainText(s).slice(2, 12) + 'TAIL');
  // single paragraph paste merges into the target paragraph
  const one = sliceStory(s, 0, 3);
  const p1 = insertStory(base, 4, one);
  assert.equal(plainText(p1), 'HEADone|TAIL');
  assert.equal(p1.paragraphs.length, 1);
  // empty slice
  assert.equal(insertStory(base, 2, emptyStory()), base);
  // paragraph attrs for multi paragraph paste
  const tgt = storyFromPlain('ab', undefined, { align: 'center' });
  const other = { paragraphs: [{ runs: [{ text: 'X' }], attrs: { align: 'left' } }, { runs: [{ text: 'Y' }], attrs: { align: 'right' } }] };
  const res = insertStory(tgt, 1, other);
  assert.equal(plainText(res), 'aX\nYb');
  assert.deepEqual(res.paragraphs.map((p) => p.attrs), [{ align: 'center' }, { align: 'right' }]);
  const other2 = { paragraphs: [{ runs: [{ text: 'X' }] }, { runs: [] , attrs: { align: 'right' } }] };
  const res2 = insertStory(tgt, 1, other2);
  assert.equal(plainText(res2), 'aX\nb');
  assert.deepEqual(res2.paragraphs.map((p) => p.attrs), [{ align: 'center' }, { align: 'center' }]);
});

test('getAttrsAt / getStyleAt', () => {
  const s = { paragraphs: [{ runs: [{ text: 'ab', attrs: B, styleId: 'c1' }, { text: 'cd', attrs: I }] }, { runs: [] }] };
  assert.deepEqual(getAttrsAt(s, 1), B);
  assert.deepEqual(getAttrsAt(s, 2), B);
  assert.deepEqual(getAttrsAt(s, 3), I);
  assert.deepEqual(getAttrsAt(s, 0), B);
  assert.deepEqual(getAttrsAt(s, 5), I, 'empty paragraph inherits from the previous');
  assert.deepEqual(getStyleAt(s, 1), { attrs: B, styleId: 'c1' });
  assert.deepEqual(getAttrsAt(emptyStory(), 0), {});
  const a = getAttrsAt(s, 1);
  a.fontWeight = 100;
  assert.equal(s.paragraphs[0].runs[0].attrs.fontWeight, 700, 'returned attrs are a copy');
});

test('applyCharAttrs / applyCharStyle / applyParaAttrs / applyParaStyle', () => {
  const s = storyFromPlain('hello world\nsecond line');
  let r = applyCharAttrs(s, 2, 8, B);
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'he' }, { text: 'llo wo', attrs: B }, { text: 'rld' }]);
  assert.equal(r.paragraphs[1], s.paragraphs[1]);
  r = applyCharAttrs(r, 4, 6, { fontWeight: undefined, color: '#ff0000' });
  assert.deepEqual(r.paragraphs[0].runs, [
    { text: 'he' },
    { text: 'll', attrs: B },
    { text: 'o ', attrs: { color: '#ff0000' } },
    { text: 'wo', attrs: B },
    { text: 'rld' },
  ]);
  // across paragraphs
  r = applyCharAttrs(s, 6, 15, I);
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'hello ' }, { text: 'world', attrs: I }]);
  assert.deepEqual(r.paragraphs[1].runs, [{ text: 'sec', attrs: I }, { text: 'ond line' }]);
  assert.equal(plainText(r), plainText(s));
  // removing an override makes runs mergeable again
  r = applyCharAttrs(applyCharAttrs(s, 0, 5, B), 0, 5, { fontWeight: undefined });
  assert.deepEqual(r.paragraphs[0], s.paragraphs[0]);
  assert.equal(applyCharAttrs(s, 3, 3, B), s);
  r = applyCharStyle(s, 0, 5, 'emph');
  assert.deepEqual(r.paragraphs[0].runs[0], { text: 'hello', styleId: 'emph' });
  r = applyCharStyle(r, 0, 5, null);
  assert.deepEqual(r.paragraphs[0], s.paragraphs[0]);

  // paragraph attrs
  r = applyParaAttrs(s, 3, 3, { align: 'center' });
  assert.deepEqual(r.paragraphs.map((p) => p.attrs), [{ align: 'center' }, undefined]);
  r = applyParaAttrs(s, 0, storyLength(s), { align: 'right' });
  assert.deepEqual(r.paragraphs.map((p) => p.attrs), [{ align: 'right' }, { align: 'right' }]);
  r = applyParaAttrs(s, 0, 12, { align: 'right' }); // ends exactly at the start of paragraph 2
  assert.deepEqual(r.paragraphs.map((p) => p.attrs), [{ align: 'right' }, undefined]);
  r = applyParaAttrs(s, 0, 13, { align: 'right' });
  assert.deepEqual(r.paragraphs.map((p) => p.attrs), [{ align: 'right' }, { align: 'right' }]);
  r = applyParaAttrs(r, 12, 12, { align: undefined, bullet: null });
  assert.deepEqual(r.paragraphs[1].attrs, { bullet: null });
  r = applyParaStyle(s, 0, 0, 'h1');
  assert.equal(r.paragraphs[0].styleId, 'h1');
  r = applyParaStyle(applyParaAttrs(r, 0, 0, { align: 'center' }), 0, 0, 'h2', { clearOverrides: true });
  assert.deepEqual(r.paragraphs[0], { runs: s.paragraphs[0].runs, styleId: 'h2' });
  // empty paragraph at the end of the selection
  const e = { paragraphs: [{ runs: [{ text: 'a' }] }, { runs: [] }, { runs: [{ text: 'b' }] }] };
  assert.deepEqual(applyParaAttrs(e, 2, 2, { align: 'center' }).paragraphs.map((p) => p.attrs), [undefined, { align: 'center' }, undefined]);
});

test('paragraphAt / paragraphStarts', () => {
  const s = storyFromPlain('ab\n\ncde');
  assert.deepEqual(paragraphAt(s, 0), { index: 0, start: 0, end: 2 });
  assert.deepEqual(paragraphAt(s, 2), { index: 0, start: 0, end: 2 });
  assert.deepEqual(paragraphAt(s, 3), { index: 1, start: 3, end: 3 });
  assert.deepEqual(paragraphAt(s, 4), { index: 2, start: 4, end: 7 });
  assert.deepEqual(paragraphAt(s, 99), { index: 2, start: 4, end: 7 });
  assert.deepEqual(paragraphStarts(s), [0, 3, 4]);
});

test('wordRange', () => {
  const s = storyFromPlain("Hello, wörld don't  stop\nnext 日本語 end");
  const txt = plainText(s);
  const w = (o) => {
    const r = wordRange(s, o);
    return txt.slice(r.from, r.to);
  };
  assert.equal(w(0), 'Hello');
  assert.equal(w(3), 'Hello');
  assert.equal(w(5), ',');
  assert.equal(w(7), 'wörld');
  assert.equal(w(13), 'don\'t');
  assert.equal(w(txt.indexOf("don't") + 2), "don't");
  assert.equal(w(txt.indexOf('  stop') + 1), '  ');
  assert.equal(w(txt.indexOf('stop') + 4), 'stop', 'at the paragraph end the left char is used');
  assert.equal(w(txt.indexOf('日')), '日');
  assert.equal(w(txt.indexOf('本')), '本');
  assert.deepEqual(wordRange(emptyStory(), 0), { from: 0, to: 0 });
  const emoji = storyFromPlain('a😀b');
  assert.deepEqual(wordRange(emoji, 1), { from: 1, to: 3 }, 'surrogate pairs stay together');
});

test('style resolution order and basedOn chains', () => {
  const styles = {
    paragraph: {
      base: { name: 'Base', attrs: { align: 'justify', spaceAfter: 6 }, char: { fontFamily: 'Georgia', fontSize: 11 } },
      head: { name: 'Head', basedOn: 'base', attrs: { align: 'left', spaceBefore: 12 }, char: { fontSize: 20, fontWeight: 700 } },
    },
    character: {
      emph: { name: 'Emph', attrs: { fontStyle: 'italic', color: '#112233' } },
      strong: { name: 'Strong', basedOn: 'emph', attrs: { fontWeight: 900, color: '#445566' } },
    },
  };
  const defaults = { char: { fontFamily: 'Arial', fontSize: 14, fontWeight: 400, fontStyle: 'normal', color: '#000000' }, para: { align: 'right', lineHeight: 1.4 } };
  const para = { runs: [], styleId: 'head', attrs: { spaceAfter: 99 } };
  const pa = resolveParagraph(para, styles, defaults);
  assert.deepEqual(pa, { align: 'left', lineHeight: 1.4, spaceAfter: 99, spaceBefore: 12 });
  // run: defaults -> para style chain char -> char style chain -> run attrs
  const run = { text: 'x', styleId: 'strong', attrs: { fontSize: 33 } };
  const ra = resolveRun(run, para, styles, defaults);
  assert.deepEqual(ra, {
    fontFamily: 'Georgia', // from base
    fontSize: 33, // run attrs win
    fontWeight: 900, // char style strong beats para style head (700)
    fontStyle: 'italic', // inherited from emph through basedOn
    color: '#445566', // strong overrides emph
  });
  assert.equal(resolveRun({ text: 'y' }, { runs: [] }, styles, defaults).fontSize, 14);
  // unknown ids and prototype names must not crash or leak
  assert.deepEqual(resolveRun({ text: 'y', styleId: '__proto__' }, { runs: [], styleId: 'constructor' }, styles, defaults), defaults.char);
  // defaults fallback
  assert.equal(resolveRun({ text: 'q' }, { runs: [] }).fontFamily, DEFAULTS.char.fontFamily);
  // resolver agrees with the plain functions
  const rs = createStyleResolver(styles, defaults);
  assert.deepEqual(rs.run(run, para), ra);
  assert.deepEqual(rs.para(para), pa);
});

test('style resolution survives basedOn cycles', () => {
  const styles = {
    paragraph: {
      a: { name: 'A', basedOn: 'b', attrs: { align: 'center' } },
      b: { name: 'B', basedOn: 'a', attrs: { align: 'right', spaceBefore: 3 } },
      self: { name: 'S', basedOn: 'self', attrs: { spaceAfter: 4 } },
    },
    character: { c1: { name: 'c1', basedOn: 'c2', attrs: { fontWeight: 600 } }, c2: { name: 'c2', basedOn: 'c1', attrs: { fontWeight: 300, fontSize: 9 } } },
  };
  const defaults = DEFAULTS;
  const pa = resolveParagraph({ runs: [], styleId: 'a' }, styles, defaults);
  assert.equal(pa.align, 'center');
  assert.equal(pa.spaceBefore, 3);
  assert.equal(resolveParagraph({ runs: [], styleId: 'self' }, styles, defaults).spaceAfter, 4);
  const ra = resolveRun({ text: 'x', styleId: 'c1' }, { runs: [] }, styles, defaults);
  assert.equal(ra.fontWeight, 600);
  assert.equal(ra.fontSize, 9);
});

test('JSON round trip and sanitizing of untrusted input', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: 'a\tb', attrs: { fontWeight: 700, color: '#FF00AA', tracking: 20 } }, { text: 'c\u{2028}d' }], attrs: { align: 'justify', tabs: [{ pos: 10, align: 'right', leader: '.' }], bullet: { kind: 'number' }, dropCap: { lines: 3, chars: 1 } }, styleId: 'p' },
      { runs: [] },
    ],
  };
  const j = storyToJSON(s);
  const back = storyFromJSON(JSON.parse(JSON.stringify(j)));
  assert.deepEqual(back.paragraphs[0].runs[0].attrs, { fontWeight: 700, color: '#ff00aa', tracking: 20 });
  assert.deepEqual(back.paragraphs[0].attrs, s.paragraphs[0].attrs);
  assert.equal(plainText(back), plainText(s));
  assert.deepEqual(storyFromJSON(JSON.stringify(j)), back);

  // hostile / broken input never throws
  for (const bad of [null, undefined, 5, 'nope', '{', {}, { paragraphs: 5 }, { paragraphs: [] }, [], { paragraphs: [null, 7, 'x'] }]) {
    const r = storyFromJSON(bad);
    assert.ok(r.paragraphs.length >= 1);
  }
  const evil = storyFromJSON({
    paragraphs: [
      {
        runs: [
          { text: 'x\ny\r\nz\u0000q', attrs: { fontSize: 1e9, fontWeight: 'bold', color: 'url(javascript:1)', fontFamily: 'A\u0000B', evil: 1, __proto__: { polluted: true }, underline: 'yes', tracking: NaN, field: 'bad name!' } },
          { text: 5 },
          { attrs: {} },
        ],
        attrs: { align: 'diagonal', lineHeight: -3, tabs: [{ pos: 'x' }, { pos: 5, align: 'weird' }], bullet: { kind: 'nope' }, dropCap: { lines: 99, chars: 'x' }, widowOrphan: 1e9 },
      },
    ],
  });
  const run = evil.paragraphs[0].runs[0];
  assert.equal(run.text, 'x\u{2028}y\u{2028}zq');
  assert.deepEqual(run.attrs, { fontSize: 4000, fontFamily: 'AB' });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(evil.paragraphs[0].attrs, { lineHeight: 0.1, widowOrphan: 20, tabs: [{ pos: 5, align: 'left' }] });
  assert.deepEqual(validateStory({ paragraphs: [{ runs: [{ text: 'ok' }] }] }), []);
  assert.ok(validateStory({ paragraphs: [{ runs: [{ text: 'a\nb' }] }] }).length > 0);
  assert.ok(validateStory(3).length > 0);
});

test('storyToHTML escapes everything and renders structure', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: '<b>&"\'', attrs: { fontWeight: 700, color: '#ff0000', underline: true, strike: true, fontFamily: "Ev'il\"; x:", tracking: 100, caps: 'small' } }, { text: 'a\tb\u{2028}c' }], attrs: { align: 'center' } },
      { runs: [{ text: 'item 1' }], attrs: { bullet: { kind: 'bullet' } } },
      { runs: [{ text: 'item 2' }], attrs: { bullet: { kind: 'bullet' } } },
      { runs: [{ text: 'first' }], attrs: { bullet: { kind: 'roman', upper: true } } },
      { runs: [] },
    ],
  };
  const html = storyToHTML(s);
  assert.ok(html.includes('&lt;b&gt;&amp;&quot;&#39;'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('font-weight:700'));
  assert.ok(html.includes('color:#ff0000'));
  assert.ok(html.includes('text-decoration:underline line-through'));
  assert.ok(html.includes('letter-spacing:0.1em'));
  assert.ok(html.includes('font-variant:small-caps'));
  assert.ok(html.includes('&#9;'));
  assert.ok(html.includes('<br>'));
  assert.ok(html.includes('text-align:center'));
  assert.equal((html.match(/<ul>/g) || []).length, 1);
  assert.equal((html.match(/<li /g) || []).length, 3);
  assert.ok(html.includes('<ol type="I">'));
  assert.ok(!/font-family:'Ev'il/.test(html));
  assert.ok(html.endsWith('<br></p>'));
  const styled = storyToHTML({ paragraphs: [{ runs: [{ text: 'x', styleId: 'e' }], styleId: 'h' }] }, {
    paragraph: { h: { name: 'H', attrs: { align: 'right' }, char: { fontSize: 30 } } },
    character: { e: { name: 'E', attrs: { fontStyle: 'italic' } } },
  });
  assert.ok(styled.includes('text-align:right'));
  assert.ok(styled.includes('font-size:30px'));
  assert.ok(styled.includes('font-style:italic'));
});

// ---- fuzz against oracles -------------------------------------------------------------------------------------

/** Per-character attribute list of a story (paragraph breaks use null). */
function charList(story) {
  const out = [];
  story.paragraphs.forEach((p, i) => {
    if (i > 0) out.push({ ch: '\n', a: null });
    for (const r of p.runs) for (const ch of r.text) for (let k = 0; k < ch.length; k++) out.push({ ch: ch[k], a: r.attrs ? JSON.stringify(r.attrs) : '' });
  });
  return out;
}

test('fuzz: randomized insert / delete / format against a plain-string and per-char oracle', () => {
  const rand = rng(12345);
  const alphabet = ['a', 'b', 'c', ' ', 'x', 'é', '\n', '\t', '\u{2028}', '😀', 'Z', '.'];
  const attrChoices = [undefined, {}, B, I, { fontWeight: 700, color: '#ff0000' }, { underline: true }];
  for (let round = 0; round < 40; round++) {
    let story = emptyStory();
    /** oracle: array of {ch, a} for each char; '\n' paragraph break with a=null */
    let oracle = [];
    for (let step = 0; step < 120; step++) {
      const len = oracle.length;
      const op = rand();
      if (op < 0.5) {
        const off = Math.floor(rand() * (len + 1));
        let text = '';
        const n = 1 + Math.floor(rand() * 5);
        for (let i = 0; i < n; i++) text += alphabet[Math.floor(rand() * alphabet.length)];
        const attrs = attrChoices[1 + Math.floor(rand() * (attrChoices.length - 1))];
        story = insertText(story, off, text, attrs);
        const a = attrs && Object.keys(attrs).length ? JSON.stringify(attrs) : '';
        const items = [];
        for (let i = 0; i < text.length; i++) items.push({ ch: text[i], a: text[i] === '\n' ? null : a });
        oracle.splice(off, 0, ...items);
      } else if (op < 0.75 && len > 0) {
        let a = Math.floor(rand() * (len + 1));
        let b = Math.floor(rand() * (len + 1));
        if (a > b) [a, b] = [b, a];
        story = deleteRange(story, a, b);
        oracle.splice(a, b - a);
      } else if (op < 0.9 && len > 0) {
        let a = Math.floor(rand() * (len + 1));
        let b = Math.floor(rand() * (len + 1));
        if (a > b) [a, b] = [b, a];
        const patch = { fontWeight: 700 };
        story = applyCharAttrs(story, a, b, patch);
        for (let i = a; i < b; i++) {
          if (oracle[i].a === null) continue;
          const cur = oracle[i].a ? JSON.parse(oracle[i].a) : {};
          cur.fontWeight = 700;
          oracle[i] = { ch: oracle[i].ch, a: JSON.stringify(sortKeys(cur)) };
        }
      } else if (len > 0) {
        // copy a slice and paste it somewhere else
        let a = Math.floor(rand() * (len + 1));
        let b = Math.floor(rand() * (len + 1));
        if (a > b) [a, b] = [b, a];
        const piece = sliceStory(story, a, b);
        assert.equal(plainText(piece), oracle.slice(a, b).map((c) => c.ch).join(''));
        const off = Math.floor(rand() * (len + 1));
        story = insertStory(story, off, piece);
        oracle.splice(off, 0, ...oracle.slice(a, b).map((c) => ({ ...c })));
      }
      // invariants
      const expected = oracle.map((c) => c.ch).join('');
      assert.equal(plainText(story), expected, `text mismatch (round ${round} step ${step})`);
      assert.equal(storyLength(story), expected.length);
      assert.equal(normalizeStory(story), story, 'result is canonical');
      const got = charList(story).map((c) => ({ ch: c.ch, a: c.a === null ? null : normAttrs(c.a) }));
      const want = oracle.map((c) => ({ ch: c.ch, a: c.a === null ? null : normAttrs(c.a) }));
      assert.deepEqual(got, want, `attrs mismatch (round ${round} step ${step})`);
      // paragraph geometry agrees with the text
      const starts = paragraphStarts(story);
      const lines = expected.split('\n');
      let acc = 0;
      lines.forEach((l, i) => {
        assert.equal(starts[i], acc);
        const pa = paragraphAt(story, acc + l.length);
        assert.deepEqual(pa, { index: i, start: acc, end: acc + l.length });
        acc += l.length + 1;
      });
    }
  }
});

function sortKeys(o) {
  const r = {};
  for (const k of Object.keys(o).sort()) r[k] = o[k];
  return r;
}
function normAttrs(s) {
  return s ? JSON.stringify(sortKeys(JSON.parse(s))) : '';
}
