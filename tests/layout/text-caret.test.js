import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutStory,
  approxMeasurer,
  createHyphenator,
  storyFromPlain,
  plainText,
  storyLength,
  offsetToCaret,
  hitTest,
  hitTestEx,
  selectionRects,
  moveCaretVertical,
  lineStart,
  lineEnd,
  wordBoundary,
} from '../../app/src/engine/layout/index.js';

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
const defaults = {
  char: { fontFamily: 'Mono', fontSize: 20, fontWeight: 400, fontStyle: 'normal', color: '#000000' },
  para: { align: 'left', lineHeight: 1.25, widowOrphan: 2 },
};
const monoOpts = (extra) => ({ ...mono, defaults, ...(extra || {}) });
const LS = '\u{2028}';

/** offsetToCaret followed by hitTest must return the same offset, for every offset that was laid out. */
function checkRoundTrip(story, res, label) {
  const total = Math.min(storyLength(story), res.endOffset);
  let checked = 0;
  for (let o = 0; o <= total; o++) {
    const c = offsetToCaret(res, o);
    assert.ok(c, `${label}: caret for offset ${o}`);
    const hit = hitTest(res, c.frame, c.x, c.y + c.height / 2);
    assert.equal(hit, o, `${label}: hitTest(offsetToCaret(${o})) -> ${hit} (caret ${c.x.toFixed(2)},${c.y.toFixed(2)})`);
    checked++;
  }
  assert.ok(checked > 3);
}

const lorem = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! ';

test('offsetToCaret and hitTest are inverse at every offset (left aligned, monospace)', () => {
  const s = storyFromPlain(lorem);
  const res = layoutStory(s, [{ x: 7, y: 11, w: 230, h: 800 }], monoOpts());
  checkRoundTrip(s, res, 'left');
  assert.ok(res.frames[0].lines.length > 4);
});

test('round trip with justification, centered and right aligned text', () => {
  for (const align of ['justify', 'center', 'right']) {
    const s = storyFromPlain(lorem + lorem, undefined, { align });
    const res = layoutStory(s, [{ x: 0, y: 0, w: 250, h: 900 }], monoOpts());
    checkRoundTrip(s, res, align);
  }
});

test('round trip with the approximate proportional measurer, mixed fonts and several paragraphs', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: 'Proportional ' }, { text: 'bold words', attrs: { fontWeight: 700 } }, { text: ' and ' }, { text: 'italic text', attrs: { fontStyle: 'italic', fontSize: 18 } }, { text: ' wrap around nicely in this narrow column of text.' }] },
      { runs: [] },
      { runs: [{ text: 'Second paragraph with Small Caps', attrs: { caps: 'small' } }, { text: ' and ', attrs: {} }, { text: 'tracked', attrs: { tracking: 80 } }, { text: ' text that keeps going for a while.' }], attrs: { align: 'justify' } },
      { runs: [{ text: 'tail' }] },
    ],
  };
  const res = layoutStory(s, [{ x: 3, y: 5, w: 200, h: 900 }], { ...approxMeasurer });
  assert.equal(res.overflow, false);
  checkRoundTrip(s, res, 'proportional');
});

test('round trip with tabs, bullets, hard line breaks and hyphenation', () => {
  const tabs = layoutStory(storyFromPlain('Name\tQty\tPrice\nApples\t12\t3.50', undefined, { tabs: [{ pos: 120, align: 'left' }, { pos: 220, align: 'right', leader: '.' }] }), [{ x: 0, y: 0, w: 400, h: 400 }], monoOpts());
  checkRoundTrip(storyFromPlain('Name\tQty\tPrice\nApples\t12\t3.50'), tabs, 'tabs');
  const bs = {
    paragraphs: [
      { runs: [{ text: 'first item that wraps over a couple of lines' }], attrs: { bullet: { kind: 'number', indent: 30 } } },
      { runs: [{ text: `line one${LS}line two` }], attrs: { bullet: { kind: 'bullet', indent: 30 } } },
    ],
  };
  checkRoundTrip(bs, layoutStory(bs, [{ x: 0, y: 0, w: 200, h: 500 }], monoOpts()), 'bullets and breaks');
  const hy = storyFromPlain('internationalization hyphenation difficulties interesting', undefined, { hyphenate: true });
  checkRoundTrip(hy, layoutStory(hy, [{ x: 0, y: 0, w: 100, h: 500 }], monoOpts({ hyphenate: createHyphenator() })), 'hyphenation');
  const dc = storyFromPlain('Drop cap paragraph that needs a few lines of text to wrap around the big letter.', undefined, { dropCap: { lines: 3, chars: 2 } });
  checkRoundTrip(dc, layoutStory(dc, [{ x: 0, y: 0, w: 260, h: 500 }], monoOpts()), 'drop cap');
});

test('round trip across chained frames and columns', () => {
  const s = storyFromPlain(lorem + lorem);
  const res = layoutStory(s, [{ x: 0, y: 0, w: 210, h: 100, columns: 2, gutter: 10 }, { x: 300, y: 50, w: 150, h: 400 }], monoOpts());
  assert.ok(res.frames[0].lines.length >= 6 && res.frames[1].lines.length > 0);
  checkRoundTrip(s, res, 'chain');
  // carets of the second frame are reported in that frame
  const first = res.frames[1].firstChar;
  assert.equal(offsetToCaret(res, first).frame, 1);
  assert.equal(offsetToCaret(res, first).x, 300);
});

test('round trip around an exclusion', () => {
  const s = storyFromPlain(lorem + lorem + lorem);
  const res = layoutStory(s, [{ x: 0, y: 0, w: 300, h: 400, exclusions: [{ x: 100, y: 40, w: 100, h: 60 }] }], monoOpts());
  checkRoundTrip(s, res, 'exclusion');
});

test('offsetToCaret: affinity at soft wraps, end of story, unlaid offsets', () => {
  const s = storyFromPlain('aaa bbb ccc ddd');
  const res = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 1000 }], monoOpts());
  const lines = res.frames[0].lines;
  assert.equal(lines.length, 2);
  const boundary = lines[0].charEnd; // 8
  const down = offsetToCaret(res, boundary);
  const up = offsetToCaret(res, boundary, 'upstream');
  assert.equal(down.y, lines[1].y);
  assert.equal(down.x, 0);
  assert.equal(up.y, lines[0].y);
  assert.equal(up.x, 80, 'upstream: the caret hangs behind the trailing space');
  assert.equal(offsetToCaret(res, boundary - 1).x, 70);
  // end of story
  const end = offsetToCaret(res, 15);
  assert.equal(end.y, lines[1].y);
  assert.equal(end.x, 70);
  assert.equal(end.height, 25);
  assert.equal(offsetToCaret(res, 99), null);
  // overflow: offsets after endOffset are not available
  const small = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 25 }], monoOpts());
  assert.equal(small.overflow, true);
  assert.equal(offsetToCaret(small, small.endOffset + 1), null);
  assert.ok(offsetToCaret(small, small.endOffset - 1));
  // empty story and empty paragraphs
  const e = layoutStory(storyFromPlain(''), [{ x: 4, y: 6, w: 100, h: 100 }], monoOpts());
  const ec = offsetToCaret(e, 0);
  assert.deepEqual([ec.x, ec.y, ec.height], [4, 6, 25]);
  const p = storyFromPlain('ab\n\ncd');
  const pr = layoutStory(p, [{ x: 0, y: 0, w: 100, h: 100 }], monoOpts());
  assert.equal(offsetToCaret(pr, 3).y, 25);
  assert.equal(offsetToCaret(pr, 3).x, 0);
  assert.equal(offsetToCaret(pr, 4).y, 50);
  // centered empty paragraph puts the caret in the middle
  const c = layoutStory(storyFromPlain('', undefined, { align: 'center' }), [{ x: 0, y: 0, w: 100, h: 100 }], monoOpts());
  assert.equal(offsetToCaret(c, 0).x, 50);
});

test('hitTest: points outside the text snap to the nearest line and column', () => {
  const s = storyFromPlain('aaa bbb ccc ddd');
  const res = layoutStory(s, [{ x: 10, y: 10, w: 100, h: 200 }], monoOpts());
  assert.equal(hitTest(res, 0, -50, -50), 0, 'above and left of the text');
  assert.equal(hitTest(res, 0, 500, 500), 15, 'below and right of the text');
  assert.equal(hitTest(res, 0, 10, 40), 8, 'start of the second line');
  assert.equal(hitTest(res, 0, 1000, 20), 7, 'right of a wrapped line puts the caret before the hanging space');
  const ex = hitTestEx(res, 0, 1000, 20);
  assert.equal(ex.offset, 7);
  // a line without a trailing space that wraps in the middle of a word reports upstream affinity
  const w = layoutStory(storyFromPlain('abcdefghijklmno'), [{ x: 0, y: 0, w: 100, h: 200 }], monoOpts());
  const r = hitTestEx(w, 0, 1000, 5);
  assert.deepEqual(r, { offset: 10, affinity: 'upstream' });
  assert.equal(offsetToCaret(w, r.offset, r.affinity).y, 0);
  // unknown frame
  assert.equal(hitTest(res, 5, 0, 0), 0);
  // an empty frame returns the first offset of that frame
  const chain = layoutStory(storyFromPlain('aa'), [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 }], monoOpts());
  assert.equal(hitTest(chain, 1, 5, 5), 2);
});

test('selectionRects', () => {
  const s = storyFromPlain('aaa bbb ccc ddd\nxx');
  const res = layoutStory(s, [{ x: 5, y: 5, w: 100, h: 500 }], monoOpts());
  const lines = res.frames[0].lines;
  // inside one line
  let r = selectionRects(res, 1, 6);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].x, r[0].w, r[0].y, r[0].h, r[0].frame], [15, 50, 5, 25, 0]);
  // empty and reversed ranges
  assert.deepEqual(selectionRects(res, 3, 3), []);
  assert.deepEqual(selectionRects(res, 6, 1), r);
  // across lines: one rectangle per line
  r = selectionRects(res, 4, 12);
  assert.equal(r.length, 2);
  assert.equal(r[0].x, 5 + 40);
  assert.equal(r[0].w, 70 - 40 + 10, 'includes the trailing space up to the wrap');
  assert.equal(r[1].x, 5);
  assert.equal(r[1].w, 40);
  assert.equal(r[1].y, lines[1].y);
  // a selected paragraph break is shown as a stub on the line
  r = selectionRects(res, 13, 17);
  assert.equal(r.length, 2);
  assert.ok(r[0].w > 2 * 10 && r[0].w < 2 * 10 + 10, 'two characters plus the break stub');
  // selecting an empty paragraph
  const e = layoutStory(storyFromPlain('a\n\nb'), [{ x: 0, y: 0, w: 100, h: 100 }], monoOpts());
  const er = selectionRects(e, 2, 3);
  assert.equal(er.length, 1);
  assert.equal(er[0].y, 25);
  assert.ok(er[0].w > 0);
  // everything
  const all = selectionRects(res, 0, storyLength(s));
  assert.equal(all.length, lines.length);
  // rectangles of different frames carry their frame index
  const chain = layoutStory(storyFromPlain('aaa bbb ccc ddd eee fff'), [{ x: 0, y: 0, w: 100, h: 25 }, { x: 200, y: 0, w: 100, h: 100 }], monoOpts());
  const cr = selectionRects(chain, 0, 23);
  assert.deepEqual([...new Set(cr.map((q) => q.frame))].sort(), [0, 1]);
});

test('moveCaretVertical keeps the goal column and crosses frames', () => {
  const s = storyFromPlain('aaaa bbbb cccc dddd eeee ffff');
  const res = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 1000 }], monoOpts());
  assert.equal(res.frames[0].lines.length, 3);
  // line starts: 0, 10, 20
  let m = moveCaretVertical(res, 3, 1, null);
  assert.deepEqual([m.offset, m.goalX], [13, 30]);
  m = moveCaretVertical(res, m.offset, 1, m.goalX);
  assert.equal(m.offset, 23);
  // at the last line: go to the end
  m = moveCaretVertical(res, 23, 1, 30);
  assert.equal(m.offset, 29);
  // and back up
  m = moveCaretVertical(res, 23, -1, 30);
  assert.equal(m.offset, 13);
  m = moveCaretVertical(res, 3, -1, 30);
  assert.equal(m.offset, 0, 'up on the first line goes to the start');
  // goal column is kept over a short line
  const t = storyFromPlain('aaaaaaaaa\nbb\ncccccccc');
  const tr = layoutStory(t, [{ x: 0, y: 0, w: 200, h: 1000 }], monoOpts());
  let g = moveCaretVertical(tr, 8, 1, null);
  assert.equal(g.offset, 12, 'clamped to the end of the short line');
  g = moveCaretVertical(tr, g.offset, 1, g.goalX);
  assert.equal(g.offset, 13 + 8);
  // across chained frames
  const chain = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 200 }], monoOpts());
  const lastOfFirst = chain.frames[0].lines.at(-1);
  const x = moveCaretVertical(chain, lastOfFirst.charStart + 2, 1, null);
  assert.equal(x.offset, chain.frames[1].lines[0].charStart + 2);
  assert.equal(offsetToCaret(chain, x.offset).frame, 1);
  const back = moveCaretVertical(chain, x.offset, -1, x.goalX);
  assert.equal(back.offset, lastOfFirst.charStart + 2);
  // columns
  const col = layoutStory(storyFromPlain('aaa bbb ccc ddd eee fff ggg hhh iii jjj'), [{ x: 0, y: 0, w: 210, h: 50, columns: 2, gutter: 10 }], monoOpts());
  const f = col.frames[0];
  const endOfCol0 = f.lines[f.columns[0].first + f.columns[0].count - 1];
  const nxt = moveCaretVertical(col, endOfCol0.charStart, 1, null);
  assert.equal(nxt.offset, f.lines[f.columns[1].first].charStart);
});

test('lineStart and lineEnd', () => {
  const s = storyFromPlain(`aaa bbb ccc ddd\nxy${LS}zw`);
  const res = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 500 }], monoOpts());
  assert.equal(lineStart(res, 5), 0);
  assert.equal(lineEnd(res, 5), 7, 'in front of the hanging space');
  assert.equal(lineStart(res, 9), 8);
  assert.equal(lineEnd(res, 9), 15, 'paragraph end');
  assert.equal(lineStart(res, 17), 16);
  assert.equal(lineEnd(res, 17), 18, 'in front of the forced line break');
  assert.equal(lineStart(res, 20), 19);
  assert.equal(lineEnd(res, 20), 21);
  assert.equal(lineStart(res, 999), 999);
  const w = layoutStory(storyFromPlain('abcdefghijklmno'), [{ x: 0, y: 0, w: 100, h: 200 }], monoOpts());
  assert.equal(lineEnd(w, 3), 10, 'no hanging space: the line end itself');
});

test('wordBoundary moves word by word and across paragraphs', () => {
  const s = storyFromPlain('Hello, wörld  foo-bar\nnext 日本 end');
  const t = plainText(s);
  const fwd = (o) => wordBoundary(s, o, 1);
  const back = (o) => wordBoundary(s, o, -1);
  assert.equal(fwd(0), 5, 'Hello -> comma');
  assert.equal(fwd(5), 7, 'comma and space are skipped');
  assert.equal(fwd(7), 14);
  assert.equal(t.slice(14, 17), 'foo');
  assert.equal(fwd(14), 17);
  assert.equal(fwd(21), 22, 'paragraph end moves into the next paragraph');
  assert.equal(back(22), 21, 'paragraph start moves to the previous paragraph end');
  assert.equal(back(14), 7);
  assert.equal(back(7), 5);
  assert.equal(back(5), 0);
  assert.equal(back(0), 0);
  assert.equal(fwd(t.length), t.length);
  const j = t.indexOf('日');
  assert.equal(fwd(j), j + 1, 'every ideograph is a word');
  assert.equal(back(j + 2), j + 1);
  assert.equal(wordBoundary(storyFromPlain('a😀 b'), 1, 1), 4);
});

test('caret positions after cloning need an explicit measurer', () => {
  const s = storyFromPlain('aaa bbb ccc');
  const res = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 100 }], monoOpts());
  const clone = structuredClone(res);
  assert.equal(offsetToCaret(clone, 2, 'downstream', { measure: mono.measure }).x, 20);
  assert.equal(hitTest(clone, 0, 21, 5, { measure: mono.measure }), 2);
});
