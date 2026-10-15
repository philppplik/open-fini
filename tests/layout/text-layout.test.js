import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutStory,
  approxMeasurer,
  makeSfntMeasurer,
  findBreaks,
  createHyphenator,
  storyFromPlain,
  plainText,
  storyLength,
  DEFAULTS,
} from '../../app/src/engine/layout/index.js';

/** Monospace measurer: every code point is size/2 px wide, ascent 0.8 em, descent 0.2 em. */
const mono = {
  measure(font, text) {
    let n = 0;
    for (const _ of text) n++;
    return (n * font.size) / 2;
  },
  metrics(font) {
    return { ascent: font.size * 0.8, descent: font.size * 0.2, capHeight: font.size * 0.7 };
  },
};
/** Defaults used by most tests: 20 px text (10 px per character), line height 25. */
const defaults = {
  char: { fontFamily: 'Mono', fontSize: 20, fontWeight: 400, fontStyle: 'normal', color: '#000000' },
  para: { align: 'left', lineHeight: 1.25, widowOrphan: 2 },
};
const opts = (extra) => ({ ...mono, defaults, ...(extra || {}) });
const LS = '\u{2028}';

/** Text of a line according to the story offsets. */
function lineText(story, line) {
  return plainText(story).slice(line.charStart, line.charEnd);
}
function allLines(res) {
  return res.frames.flatMap((f) => f.lines);
}
function texts(story, res) {
  return allLines(res).map((l) => lineText(story, l));
}
/** Concatenation of the visible text of all runs of the lines (no synthetic runs). */
function runText(line) {
  return line.runs.filter((r) => r.charEnd > r.charStart && !r.leader).map((r) => r.text).join('');
}
const frame100 = { x: 0, y: 0, w: 100, h: 1000 };

test('greedy wrapping: line boxes, offsets and text reconstruction', () => {
  const s = storyFromPlain('aaa bbb ccc ddd eee');
  const res = layoutStory(s, [frame100], opts());
  assert.deepEqual(texts(s, res), ['aaa bbb ', 'ccc ddd ', 'eee']);
  const lines = res.frames[0].lines;
  assert.deepEqual(lines.map((l) => [l.charStart, l.charEnd]), [[0, 8], [8, 16], [16, 19]]);
  assert.deepEqual(lines.map((l) => l.y), [0, 25, 50]);
  assert.equal(lines[0].height, 25);
  assert.ok(Math.abs(lines[0].baseline - 18.5) < 1e-9);
  assert.equal(res.endOffset, 19);
  assert.equal(res.overflow, false);
  assert.equal(lines[0].hang, 1);
  assert.equal(lines[0].width, 70, 'trailing space hangs and is not part of the visible width');
  assert.equal(runText(lines[0]), 'aaa bbb ');
  for (const l of lines) assert.ok(l.width <= 100 + 1e-9);
  assert.equal(lines.at(-1).last, true);
  assert.equal(lines[0].last, false);
});

test('break opportunities: hyphen, NBSP, ZWSP, CJK, closing punctuation, overlong words', () => {
  const run = (text, w) => {
    const s = storyFromPlain(text);
    return texts(s, layoutStory(s, [{ x: 0, y: 0, w, h: 1000 }], opts()));
  };
  assert.deepEqual(run('well-known fact', 60), ['well-', 'known ', 'fact']);
  assert.deepEqual(run('xx aaa\u{a0}bbb cc', 100), ['xx aaa\u{a0}bbb ', 'cc']);
  assert.deepEqual(run('xx aaa\u{a0}bbb cc', 90), ['xx ', 'aaa\u{a0}bbb ', 'cc']);
  assert.deepEqual(run('abcdef\u{200b}ghijkl', 70), ['abcdef\u{200b}', 'ghijkl']);
  assert.deepEqual(run('日本語のテキスト', 50), ['日本語のテ', 'キスト']);
  assert.deepEqual(run('日本語日。', 40), ['日本語', '日。']);
  assert.deepEqual(run('abcdefghijklmnopqrstuvwxyz', 100), ['abcdefghij', 'klmnopqrst', 'uvwxyz']);
  assert.deepEqual(run('ab (cd) ef', 50), ['ab ', '(cd) ', 'ef']);
  assert.deepEqual(run('-5 and 3-4', 40), ['-5 ', 'and ', '3-4']);
});

test('findBreaks classifies boundaries', () => {
  const b = findBreaks('a b-c d\u{2028}e');
  assert.equal(b[0], 0);
  assert.equal(b[1], 0, 'no break before a space');
  assert.equal(b[2], 1, 'break after a space');
  assert.equal(b[4], 1, 'break after a hyphen between letters');
  assert.equal(b[7], 0);
  assert.equal(b[8], 2, 'mandatory break after a forced line break');
  assert.equal(b[b.length - 1], 2);
  const e = findBreaks('a😀b');
  assert.equal(e[2], 0, 'never inside a surrogate pair');
});

test('forced line breaks end a line without justification', () => {
  const s = storyFromPlain(`ab${LS}cd`, undefined, { align: 'justify' });
  const res = layoutStory(s, [frame100], opts());
  const l = res.frames[0].lines;
  assert.equal(l.length, 2);
  assert.equal(l[0].hard, true);
  assert.deepEqual([l[0].charStart, l[0].charEnd, l[1].charStart, l[1].charEnd], [0, 3, 3, 5]);
  assert.equal(runText(l[0]), 'ab', 'the break character is not emitted');
  assert.equal(l[0].justified, false);
  // a paragraph ending with a forced break gets an empty last line
  const t = storyFromPlain(`ab${LS}`);
  const r2 = layoutStory(t, [frame100], opts());
  assert.equal(r2.frames[0].lines.length, 2);
  assert.equal(r2.frames[0].lines[1].charStart, 3);
  assert.equal(r2.endOffset, 3);
});

test('alignment and justification', () => {
  const mk = (align, text) => layoutStory(storyFromPlain(text, undefined, { align }), [frame100], opts()).frames[0].lines;
  assert.equal(mk('center', 'abc')[0].x, 35);
  assert.equal(mk('right', 'abc')[0].x, 70);
  assert.equal(mk('left', 'abc')[0].x, 0);
  const j = mk('justify', 'aa bb cc dd ee ff gg');
  assert.equal(j[0].justified, true);
  assert.ok(Math.abs(j[0].width - 100) < 1e-9, 'justified lines fill the measure exactly');
  assert.ok(Math.abs(j[0].runs.reduce((a, r) => (r.hang ? a : a + r.width), 0) - 100) < 1e-9);
  for (const l of j.slice(0, -1)) assert.ok(Math.abs(l.width - 100) < 1e-9);
  assert.equal(j.at(-1).justified, false);
  assert.equal(j.at(-1).x, 0, 'the last line is left aligned');
  // spaces carry the expansion, runs tile the line without gaps
  const first = j[0].runs;
  for (let i = 1; i < first.length; i++) assert.ok(Math.abs(first[i].x - (first[i - 1].x + first[i - 1].width)) < 1e-9);
  assert.ok(first.some((r) => r.text === ' ' && r.wordSpacing > 0));
  // indents
  const ind = layoutStory(storyFromPlain('aaa bbb ccc ddd', undefined, { indentLeft: 20, indentRight: 10, indentFirst: 30 }), [frame100], opts()).frames[0].lines;
  assert.equal(ind[0].x, 50);
  assert.equal(ind[1].x, 20);
  for (const l of ind) assert.ok(l.x + l.width <= 90 + 1e-9);
});

test('space before / after, line height multiplier and per-run line height', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: 'one' }], attrs: { spaceAfter: 10 } },
      { runs: [{ text: 'two' }], attrs: { spaceBefore: 5, lineHeight: 2 } },
      { runs: [{ text: 'big', attrs: { fontSize: 40 } }, { text: ' small' }] },
    ],
  };
  const res = layoutStory(s, [{ x: 0, y: 0, w: 500, h: 1000 }], opts());
  const l = res.frames[0].lines;
  assert.equal(l[0].y, 0);
  assert.equal(l[1].y, 25 + 10 + 5, 'space after and space before add up');
  assert.equal(l[1].height, 40);
  assert.equal(l[2].y, 80, 'plain stacking below the previous line');
  assert.equal(l[2].height, 50, 'the tallest run decides the line height');
  assert.ok(l[2].ascent > l[2].descent);
  // space before is dropped at the top of a frame
  const t = layoutStory({ paragraphs: [{ runs: [{ text: 'x' }], attrs: { spaceBefore: 30 } }] }, [frame100], opts());
  assert.equal(t.frames[0].lines[0].y, 0);
});

test('tabs: left, right, center, decimal and leaders', () => {
  const wide = { x: 0, y: 0, w: 400, h: 1000 };
  const lay = (text, tab) => layoutStory(storyFromPlain(text, undefined, { tabs: [tab] }), [wide], opts()).frames[0].lines[0];
  const find = (line, t) => line.runs.find((r) => r.text === t);
  let line = lay('ab\tcd', { pos: 100, align: 'left' });
  assert.equal(find(line, 'cd').x, 100);
  assert.equal(line.runs.find((r) => r.tab).width, 80);
  line = lay('ab\tcd', { pos: 100, align: 'right' });
  assert.equal(find(line, 'cd').x + find(line, 'cd').width, 100);
  line = lay('ab\tcd', { pos: 100, align: 'center' });
  assert.equal(find(line, 'cd').x, 90);
  line = lay('ab\t12.50', { pos: 100, align: 'decimal' });
  assert.equal(find(line, '12.50').x + 20, 100, 'the decimal point sits on the stop');
  line = lay('Chapter\t12', { pos: 200, align: 'right', leader: '.' });
  const leader = line.runs.find((r) => r.leader);
  assert.equal(leader.text, '.'.repeat(11));
  assert.equal(leader.x, 70);
  assert.equal(leader.charStart, leader.charEnd, 'leaders are synthetic');
  assert.equal(find(line, '12').x + find(line, '12').width, 200);
  // default tab grid (48 px) when no stop is defined
  const d = layoutStory(storyFromPlain('a\tb'), [wide], opts()).frames[0].lines[0];
  assert.equal(d.runs.find((r) => r.text === 'b').x, 48);
  // tab gap runs keep offsets exact
  const gap = d.runs.find((r) => r.tab);
  assert.equal(gap.charEnd - gap.charStart, 1);
  assert.equal(runText(d), 'ab');
  // tab stops are measured from the column edge, not from the indent
  const ind = layoutStory(storyFromPlain('a\tb', undefined, { indentLeft: 30, tabs: [{ pos: 100, align: 'left' }] }), [wide], opts()).frames[0].lines[0];
  assert.equal(ind.runs.find((r) => r.text === 'b').x, 100);
});

test('bullets and numbering with hanging indent', () => {
  const para = (text, bullet) => ({ runs: [{ text }], attrs: bullet === undefined ? undefined : { bullet } });
  const s = {
    paragraphs: [
      para('one', { kind: 'number', indent: 30 }),
      para('two is a long entry for wrapping', { kind: 'number', indent: 30 }),
      para('three', { kind: 'number', indent: 30 }),
      para('plain'),
      para('again', { kind: 'number', indent: 30 }),
      para('item', { kind: 'bullet', indent: 30 }),
      para('a', { kind: 'alpha', indent: 30 }),
      para('b', { kind: 'alpha', indent: 30, upper: true }),
      para('i', { kind: 'roman', indent: 30 }),
      para('ii', { kind: 'roman', indent: 30, upper: true }),
      para('p', { kind: 'number', indent: 30, char: '#)' }),
    ],
  };
  const res = layoutStory(s, [{ x: 10, y: 0, w: 200, h: 2000 }], opts());
  const lines = allLines(res);
  const markers = lines.filter((l) => l.bullet).map((l) => l.bullet.text);
  assert.deepEqual(markers, ['1.', '2.', '3.', '1.', '\u{2022}', 'a.', 'B.', 'i.', 'II.', '1)']);
  const two = lines.filter((l) => l.para === 1);
  assert.ok(two.length >= 2);
  assert.equal(two[0].bullet.x, 10);
  assert.equal(two[0].runs[0].x, 40, 'text starts after the hanging indent');
  assert.equal(two[1].runs[0].x, 40, 'wrapped lines keep the hanging indent');
  assert.equal(two[1].bullet, undefined);
});

test('drop caps', () => {
  const s = storyFromPlain('Hello world, this is a paragraph that is long enough to wrap over several lines in this frame width.', undefined, { dropCap: { lines: 3, chars: 1 } });
  const res = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 1000 }], opts());
  const lines = res.frames[0].lines;
  assert.ok(lines.length >= 5);
  const cap = lines[0].runs[0];
  assert.equal(cap.dropCap, true);
  assert.equal(cap.text, 'H');
  assert.equal(cap.charStart, 0);
  assert.equal(cap.charEnd, 1);
  assert.ok(cap.font.size > 80 && cap.font.size < 100, 'sized to span three lines: ' + cap.font.size);
  const indent = lines[0].runs[1].x;
  assert.ok(indent > 45);
  assert.equal(lines[1].runs[0].x, indent);
  assert.equal(lines[2].runs[0].x, indent);
  assert.equal(lines[3].runs[0].x, 0, 'text wraps back under the drop cap');
  assert.equal(cap.baselineShift, lines[0].baseline - lines[2].baseline);
  assert.equal(lines[0].runs[1].charStart, 1);
  assert.equal(lines[0].charStart, 0);
  assert.equal(runText(lines[0])[0], 'H');
  // a one line paragraph still reserves the vertical space of the cap
  const t = layoutStory({ paragraphs: [{ runs: [{ text: 'Hi' }], attrs: { dropCap: { lines: 3, chars: 1 } } }, { runs: [{ text: 'next' }] }] }, [frame100], opts());
  assert.ok(t.frames[0].lines[1].y >= 75 - 1e-9);
});

test('small caps, upper caps, baseline shift, tracking and fields keep offsets exact', () => {
  const s = {
    paragraphs: [
      {
        runs: [
          { text: 'aBc', attrs: { caps: 'small' } },
          { text: 'xy', attrs: { caps: 'upper', tracking: 100 } },
          { text: '#', attrs: { field: 'pageNumber', baselineShift: 4 } },
          { text: 'ß', attrs: { caps: 'upper' } },
        ],
      },
    ],
  };
  const res = layoutStory(s, [{ x: 0, y: 0, w: 500, h: 100 }], opts({ fields: { pageNumber: 12 } }));
  const l = res.frames[0].lines[0];
  const rr = l.runs;
  assert.equal(rr[0].text, 'A');
  assert.equal(rr[0].font.size, 16, 'small capitals are 0.8 of the size');
  assert.equal(rr[1].text, 'B');
  assert.equal(rr[1].font.size, 20);
  assert.equal(rr[2].text, 'C');
  assert.equal(rr[3].text, 'XY');
  assert.equal(rr[3].letterSpacing, 2, 'tracking 100/1000 em at 20px');
  assert.equal(rr[3].width, 2 * 10 + 2 * 2);
  const f = rr.find((r) => r.field === 'pageNumber');
  assert.equal(f.text, '12');
  assert.equal(f.baselineShift, 4);
  assert.equal(f.charEnd - f.charStart, 1, 'a field counts as its placeholder text');
  assert.equal(rr.at(-1).text, 'ß', 'characters whose uppercase has another length are kept');
  assert.equal(l.charEnd, storyLength(s));
  // upper case run width uses the transformed text
  assert.equal(rr[0].width, 8);
});

test('chained frames: exact endOffset and continuity', () => {
  const words = [];
  for (let i = 0; i < 60; i++) words.push('w' + String(i % 10).repeat(2));
  const s = storyFromPlain(words.join(' '));
  const tall = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 5000 }], opts());
  const tallLines = tall.frames[0].lines;
  assert.ok(tallLines.length > 12);
  const three = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 200, y: 0, w: 100, h: 100 },
    { x: 400, y: 0, w: 100, h: 100 },
  ];
  const res = layoutStory(s, three, opts());
  assert.equal(res.overflow, true);
  assert.equal(res.endOffset, tallLines[11].charEnd, 'endOffset is the first character that did not fit');
  assert.deepEqual(res.frames.map((f) => f.lines.length), [4, 4, 4]);
  assert.deepEqual(res.frames.map((f) => [f.firstChar, f.lastChar]), [[0, tallLines[3].charEnd], [tallLines[4].charStart, tallLines[7].charEnd], [tallLines[8].charStart, tallLines[11].charEnd]]);
  assert.equal(res.frames[0].lastChar, res.frames[1].firstChar);
  assert.equal(res.frames[1].lastChar, res.frames[2].firstChar);
  assert.deepEqual(res.frames.map((f) => f.overflow), [false, false, true]);
  assert.equal(res.frames[1].lines[0].x, 200, 'coordinates are in the frame space');
  // the chain reproduces the single-frame line breaks
  assert.deepEqual(allLines(res).map((l) => [l.charStart, l.charEnd]), tallLines.slice(0, 12).map((l) => [l.charStart, l.charEnd]));
  // enough room: no overflow and endOffset = story length
  const fit = layoutStory(s, [...three, { x: 600, y: 0, w: 100, h: 5000 }], opts());
  assert.equal(fit.overflow, false);
  assert.equal(fit.endOffset, storyLength(s));
  assert.equal(fit.frames[3].lastChar, storyLength(s));
  // paragraph boundary at the overflow point
  const p = storyFromPlain('aaaa bbbb\ncccc dddd\neeee ffff');
  const r2 = layoutStory(p, [{ x: 0, y: 0, w: 100, h: 50 }], opts());
  assert.equal(r2.overflow, true);
  assert.equal(r2.endOffset, 20, 'start of the third paragraph');
  // no frames at all
  const none = layoutStory(p, [], opts());
  assert.equal(none.overflow, true);
  assert.equal(none.endOffset, 0);
  assert.equal(layoutStory(storyFromPlain(''), [], opts()).overflow, false);
});

test('empty story and empty paragraphs produce lines', () => {
  const e = layoutStory({ paragraphs: [{ runs: [] }] }, [frame100], opts());
  assert.equal(e.frames[0].lines.length, 1);
  assert.equal(e.frames[0].lines[0].height, 25);
  assert.equal(e.endOffset, 0);
  assert.equal(e.overflow, false);
  const s = storyFromPlain('a\n\nb');
  const res = layoutStory(s, [frame100], opts());
  assert.deepEqual(res.frames[0].lines.map((l) => [l.charStart, l.charEnd]), [[0, 1], [2, 2], [3, 4]]);
  assert.equal(res.endOffset, 4);
});

test('columns flow left to right inside a frame', () => {
  const words = [];
  for (let i = 0; i < 30; i++) words.push('abcd');
  const s = storyFromPlain(words.join(' '));
  const res = layoutStory(s, [{ x: 0, y: 0, w: 210, h: 100, columns: 2, gutter: 10 }], opts());
  const f = res.frames[0];
  assert.equal(f.columns.length, 2);
  assert.equal(f.columns[0].w, 100);
  assert.equal(f.columns[1].x, 110);
  assert.deepEqual(f.columns.map((c) => c.count), [4, 4]);
  assert.ok(f.lines.slice(0, 4).every((l) => l.x === 0 && l.column === 0));
  assert.ok(f.lines.slice(4).every((l) => l.x === 110 && l.column === 1));
  assert.equal(res.overflow, true);
  assert.equal(f.lines[4].y, 0, 'the second column restarts at the top');
});

test('insets, vertical alignment and autoHeight', () => {
  const s = storyFromPlain('aa\nbb');
  const base = { x: 10, y: 20, w: 100, h: 200, insets: { top: 10, left: 5, right: 5, bottom: 10 } };
  const top = layoutStory(s, [base], opts()).frames[0];
  assert.equal(top.lines[0].x, 15);
  assert.equal(top.lines[0].y, 30);
  assert.equal(top.usedHeight, 50);
  const bottom = layoutStory(s, [{ ...base, verticalAlign: 'bottom' }], opts()).frames[0];
  assert.equal(bottom.lines[1].y + bottom.lines[1].height, 20 + 200 - 10);
  const center = layoutStory(s, [{ ...base, verticalAlign: 'center' }], opts()).frames[0];
  assert.equal(center.lines[0].y, 30 + (180 - 50) / 2);
  const just = layoutStory(s, [{ ...base, verticalAlign: 'justify' }], opts()).frames[0];
  assert.equal(just.lines[0].y, 30);
  assert.equal(just.lines[1].y + just.lines[1].height, 20 + 200 - 10, 'extra space goes between the paragraphs');
  const auto = layoutStory(s, [{ ...base, h: 10, autoHeight: true }], opts());
  assert.equal(auto.overflow, false);
  assert.equal(auto.frames[0].h, 50 + 10 + 10);
  assert.equal(auto.frames[0].usedHeight, 50);
});

test('baseline grid snapping', () => {
  const s = storyFromPlain('aa\nbb\ncc');
  const res = layoutStory(s, [{ x: 0, y: 3, w: 100, h: 1000, baselineGrid: { offset: 0, spacing: 20 } }], opts());
  for (const l of res.frames[0].lines) {
    const rel = l.baseline - 3;
    assert.ok(Math.abs(rel / 20 - Math.round(rel / 20)) < 1e-9, `baseline ${l.baseline} is on the grid`);
  }
  const l = res.frames[0].lines;
  assert.ok(l[1].y >= l[0].y + l[0].height - 1e-9, 'lines never overlap');
});

test('text wrap around exclusion rectangles', () => {
  const words = [];
  for (let i = 0; i < 80; i++) words.push('ab');
  const s = storyFromPlain(words.join(' '));
  const ex = { x: 100, y: 50, w: 100, h: 50, margin: 0 };
  const res = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 400, exclusions: [ex] }], opts());
  const lines = res.frames[0].lines;
  let bandLeft = 0;
  let bandRight = 0;
  for (const l of lines) {
    const overlapsY = l.y < ex.y + ex.h - 1e-9 && l.y + l.height > ex.y + 1e-9;
    if (!overlapsY) continue;
    const x1 = l.x + l.width;
    assert.ok(x1 <= ex.x + 1e-9 || l.x >= ex.x + ex.w - 1e-9, `line at y=${l.y} avoids the rect (x=${l.x}, w=${l.width})`);
    if (x1 <= ex.x + 1e-9) bandLeft++;
    else bandRight++;
  }
  assert.ok(bandLeft >= 2 && bandRight >= 2, 'text flows on both sides of the rectangle');
  // reading order is preserved: every line continues where the previous one ended
  for (let i = 1; i < lines.length; i++) assert.equal(lines[i].charStart, lines[i - 1].charEnd);
  assert.equal(lines[0].charStart, 0);
  // a margin widens the hole
  const m = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 400, exclusions: [{ ...ex, margin: 10 }] }], opts()).frames[0].lines;
  for (const l of m) {
    if (l.y < 110 - 1e-9 && l.y + l.height > 40 + 1e-9) assert.ok(l.x + l.width <= 90 + 1e-9 || l.x >= 210 - 1e-9);
  }
  // jump: no text beside the rect
  const j = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 400, exclusions: [{ ...ex, jump: true }] }], opts()).frames[0].lines;
  for (const l of j) assert.ok(l.y + l.height <= 50 + 1e-9 || l.y >= 100 - 1e-9);
  // an exclusion covering the full width pushes the text below it
  const full = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 400, exclusions: [{ x: 0, y: 0, w: 300, h: 60 }] }], opts()).frames[0].lines;
  assert.ok(full[0].y >= 60 - 1e-9);
});

test('widow and orphan control across frames', () => {
  const five = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
  const frames = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 0, y: 0, w: 100, h: 300 },
  ];
  const lay = (attrs) => layoutStory({ paragraphs: [{ runs: [{ text: five }], attrs }] }, frames, opts());
  const def = lay({});
  assert.deepEqual(def.frames.map((f) => f.lines.length), [3, 2], 'two line minimum at both ends');
  const off = lay({ widowOrphan: 1 });
  assert.deepEqual(off.frames.map((f) => f.lines.length), [4, 1]);
  // text is complete and ordered either way
  assert.equal(def.endOffset, five.length);
  assert.equal(allLines(def).map((l) => five.slice(l.charStart, l.charEnd)).join(''), five);
  // orphan control moves the whole paragraph when only one line would stay behind
  const s = {
    paragraphs: [
      { runs: [{ text: 'aaaa bbbb cccc dddd eeee ffff' }] },
      { runs: [{ text: five }] },
    ],
  };
  const r = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 500 }], opts());
  assert.equal(r.frames[0].lines.filter((l) => l.para === 1).length, 0, 'a single orphan line is not left behind');
  assert.equal(r.frames[1].lines.filter((l) => l.para === 1).length, 5);
});

test('keepLinesTogether and keepWithNext', () => {
  const five = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
  const frames = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 0, y: 0, w: 100, h: 500 },
  ];
  const keep = layoutStory(
    { paragraphs: [{ runs: [{ text: 'aaaa bbbb' }] }, { runs: [{ text: five }], attrs: { keepLinesTogether: true } }] },
    frames,
    opts(),
  );
  assert.deepEqual(keep.frames.map((f) => f.lines.length), [1, 5], 'the paragraph moves as a whole');
  assert.equal(keep.frames[1].lines[0].y, 0);
  // a paragraph taller than the frame cannot be kept together when it starts at the top
  const tall = layoutStory({ paragraphs: [{ runs: [{ text: five }], attrs: { keepLinesTogether: true } }] }, frames, opts());
  assert.equal(tall.frames[0].lines.length, 3);
  // keepWithNext: the heading follows its body paragraph into the next frame
  const withNext = layoutStory(
    {
      paragraphs: [
        { runs: [{ text: 'aaaa bbbb cccc dddd' }] },
        { runs: [{ text: 'HEAD' }], attrs: { keepWithNext: true } },
        { runs: [{ text: five }] },
      ],
    },
    [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 500 }],
    opts(),
  );
  assert.deepEqual(withNext.frames[0].lines.map((l) => l.para), [0, 0], 'only the first paragraph stays');
  assert.equal(withNext.frames[1].lines[0].para, 1);
  const noKeep = layoutStory(
    {
      paragraphs: [
        { runs: [{ text: 'aaaa bbbb cccc dddd' }] },
        { runs: [{ text: 'HEAD' }] },
        { runs: [{ text: five }] },
      ],
    },
    [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 500 }],
    opts(),
  );
  assert.deepEqual(noKeep.frames[0].lines.map((l) => l.para), [0, 0, 1], 'without the rule the heading is stranded');
});

test('hyphenation inserts hyphen runs and keeps offsets exact', () => {
  const s = storyFromPlain('internationalization hyphenation difficulties are interesting', undefined, { hyphenate: true });
  const res = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 1000 }], opts({ hyphenate: createHyphenator() }));
  const lines = allLines(res);
  const hy = lines.filter((l) => l.hyphenated);
  assert.ok(hy.length >= 2, 'some lines end with a hyphen');
  for (const l of hy) {
    const last = l.runs.at(-1);
    assert.equal(last.text, '-');
    assert.equal(last.hyphen, true);
    assert.equal(last.charStart, last.charEnd);
    assert.ok(l.runs.at(-2).charEnd === l.charEnd, 'the hyphen follows the last source character');
  }
  for (const l of lines) assert.ok(l.width <= 100 + 1e-9, `line fits: ${l.width}`);
  const rebuilt = lines.map((l) => l.runs.filter((r) => r.charEnd > r.charStart).map((r) => r.text).join('')).join('');
  assert.equal(rebuilt.replace(/ /g, ''), plainText(s).replace(/ /g, ''));
  assert.equal(res.endOffset, storyLength(s));
  // without hyphenation the long word is broken by characters (no hyphens)
  const plain = layoutStory(storyFromPlain('internationalization'), [{ x: 0, y: 0, w: 100, h: 1000 }], opts());
  assert.ok(allLines(plain).every((l) => !l.hyphenated));
  // soft hyphens are honored
  const soft = layoutStory(storyFromPlain('abcd\u{ad}efgh ij'), [{ x: 0, y: 0, w: 60, h: 1000 }], opts());
  const sl = allLines(soft);
  assert.equal(sl[0].hyphenated, true);
  assert.equal(sl[0].runs.at(-1).text, '-');
  assert.equal(runText(sl[0]), 'abcd');
  assert.equal(sl[0].charEnd, 5);
  assert.equal(sl[1].charStart, 5);
});

test('styles and defaults feed the layout (paragraph style, character style, size)', () => {
  const styles = {
    paragraph: { big: { name: 'Big', attrs: { align: 'center' }, char: { fontSize: 40 } } },
    character: { b: { name: 'B', attrs: { fontWeight: 700 } } },
  };
  const s = { paragraphs: [{ runs: [{ text: 'ab' }, { text: 'cd', styleId: 'b' }], styleId: 'big' }] };
  const res = layoutStory(s, [{ x: 0, y: 0, w: 400, h: 100 }], opts({ styles }));
  const l = res.frames[0].lines[0];
  assert.equal(l.height, 50);
  assert.equal(l.runs[0].font.size, 40);
  assert.equal(l.runs[1].font.weight, 700);
  assert.equal(l.x, (400 - 80) / 2);
  assert.equal(l.width, 80);
});

test('approxMeasurer is deterministic and sfnt measurer falls back without fonts', () => {
  const f = { family: 'Helvetica', size: 10, weight: 400, style: 'normal' };
  assert.equal(approxMeasurer.measure(f, 'Hello World'), 51.67);
  const bold = approxMeasurer.measure({ ...f, weight: 700 }, 'Hello World');
  assert.ok(bold > 51.67);
  assert.equal(approxMeasurer.measure({ ...f, family: 'Courier New' }, 'abc'), 18);
  const m = makeSfntMeasurer(() => null);
  assert.equal(m.measure(f, 'Hello World'), 51.67);
  assert.ok(m.metrics(f).ascent > 8);
  const withInfo = makeSfntMeasurer(() => ({ unitsPerEm: 1000, ascent: 800, descent: 200, lineGap: 0, capHeight: 700, xHeight: 500, measure: (t, size) => t.length * size }));
  assert.equal(withInfo.measure(f, 'abc'), 30);
  assert.deepEqual(withInfo.metrics(f), { ascent: 8, descent: 2, lineGap: 0, capHeight: 7, xHeight: 5 });
});

test('layout without a measurer uses the approximate one, and results are reproducible', () => {
  const s = storyFromPlain('The quick brown fox jumps over the lazy dog. '.repeat(8));
  const a = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 500 }]);
  const b = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 500 }], { ...approxMeasurer, defaults: DEFAULTS });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  for (const l of a.frames[0].lines) assert.ok(l.width <= 300 + 1e-6);
  // the cached preparation does not change results when frames change
  const c = layoutStory(s, [{ x: 0, y: 0, w: 200, h: 500 }]);
  const d = layoutStory(s, [{ x: 0, y: 0, w: 200, h: 500 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(c)), JSON.parse(JSON.stringify(d)));
  assert.ok(c.frames[0].lines.length > a.frames[0].lines.length);
});

test('performance sanity: a long story lays out quickly and overflow stops early', () => {
  const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
  const s = { paragraphs: [] };
  for (let i = 0; i < 2000; i++) s.paragraphs.push({ runs: [{ text: para + i }] });
  const t0 = performance.now();
  const res = layoutStory(s, [{ x: 0, y: 0, w: 400, h: 600 }], { ...approxMeasurer });
  const dt = performance.now() - t0;
  assert.equal(res.overflow, true);
  assert.ok(res.frames[0].lines.length > 20);
  assert.ok(dt < 1500, `layout of the visible part took ${dt}ms`);
});
