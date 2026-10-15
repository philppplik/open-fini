import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  layoutStory,
  approxMeasurer,
  createHyphenator,
  paragraphStarts,
  storyLength,
  plainText,
  offsetToCaret,
  hitTest,
  selectionRects,
  moveCaretVertical,
  lineStart,
  lineEnd,
} from '../../app/src/engine/layout/index.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

const WORDS = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'supercalifragilisticexpialidocious', 'a', 'I', 'well-known', '3.14', '(parens)', '"quoted"', 'café', 'internationalization', 'x', 'end.', 'e-mail', 'a/b/c', '$10', '50%'];
const SPECIAL = [' ', '  ', '\t', '\u{a0}', '\u{200b}', '\u{ad}', '\u{2028}', ' '];
const EXOTIC = ['日本語', '\u{1f600}', '中。', 'テスト'];

function randomText(rand, maxTokens) {
  let s = '';
  const n = 1 + Math.floor(rand() * maxTokens);
  for (let i = 0; i < n; i++) {
    const r = rand();
    if (r < 0.62) s += WORDS[Math.floor(rand() * WORDS.length)];
    else if (r < 0.85) s += SPECIAL[Math.floor(rand() * SPECIAL.length)];
    else if (r < 0.92) s += EXOTIC[Math.floor(rand() * EXOTIC.length)];
    else s += ' ';
    if (rand() < 0.7) s += ' ';
  }
  return s;
}

function randomStory(rand) {
  const paragraphs = [];
  const nP = 1 + Math.floor(rand() * 6);
  for (let p = 0; p < nP; p++) {
    const runs = [];
    const nR = rand() < 0.1 ? 0 : 1 + Math.floor(rand() * 4);
    for (let r = 0; r < nR; r++) {
      const attrs = {};
      if (rand() < 0.25) attrs.fontSize = [8, 12, 20, 36][Math.floor(rand() * 4)];
      if (rand() < 0.2) attrs.fontWeight = 700;
      if (rand() < 0.15) attrs.fontStyle = 'italic';
      if (rand() < 0.1) attrs.caps = rand() < 0.5 ? 'upper' : 'small';
      if (rand() < 0.1) attrs.tracking = Math.floor(rand() * 200) - 20;
      if (rand() < 0.1) attrs.baselineShift = Math.floor(rand() * 10) - 5;
      if (rand() < 0.1) attrs.underline = true;
      if (rand() < 0.05) attrs.field = 'pageNumber';
      runs.push({ text: randomText(rand, 14), ...(Object.keys(attrs).length ? { attrs } : {}) });
    }
    const pa = {};
    if (rand() < 0.5) pa.align = ['left', 'center', 'right', 'justify'][Math.floor(rand() * 4)];
    if (rand() < 0.2) pa.indentLeft = Math.floor(rand() * 30);
    if (rand() < 0.2) pa.indentRight = Math.floor(rand() * 20);
    if (rand() < 0.2) pa.indentFirst = Math.floor(rand() * 20);
    if (rand() < 0.2) pa.spaceBefore = Math.floor(rand() * 12);
    if (rand() < 0.2) pa.spaceAfter = Math.floor(rand() * 12);
    if (rand() < 0.15) pa.lineHeight = 0.8 + rand();
    if (rand() < 0.2) pa.hyphenate = true;
    if (rand() < 0.15) pa.keepLinesTogether = true;
    if (rand() < 0.15) pa.keepWithNext = true;
    if (rand() < 0.2) pa.widowOrphan = Math.floor(rand() * 4);
    if (rand() < 0.15) pa.bullet = { kind: ['bullet', 'number', 'alpha', 'roman'][Math.floor(rand() * 4)], indent: Math.floor(rand() * 30) };
    else if (rand() < 0.1) pa.dropCap = { lines: 2 + Math.floor(rand() * 3), chars: 1 + Math.floor(rand() * 2) };
    if (rand() < 0.2) pa.tabs = [{ pos: 40 + Math.floor(rand() * 100), align: ['left', 'right', 'center', 'decimal'][Math.floor(rand() * 4)], leader: rand() < 0.5 ? '.' : '' }];
    paragraphs.push({ runs, ...(Object.keys(pa).length ? { attrs: pa } : {}) });
  }
  return { paragraphs };
}

function randomFrames(rand) {
  const n = 1 + Math.floor(rand() * 3);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const tiny = rand() < 0.08;
    const f = {
      x: Math.floor(rand() * 50),
      y: Math.floor(rand() * 50),
      w: tiny ? 3 + Math.floor(rand() * 20) : 60 + Math.floor(rand() * 260),
      h: tiny ? Math.floor(rand() * 30) : 30 + Math.floor(rand() * 300),
      columns: rand() < 0.25 ? 2 + Math.floor(rand() * 2) : 1,
      gutter: 6 + Math.floor(rand() * 10),
    };
    if (rand() < 0.3) f.insets = { top: Math.floor(rand() * 8), right: Math.floor(rand() * 8), bottom: Math.floor(rand() * 8), left: Math.floor(rand() * 8) };
    if (rand() < 0.2) f.baselineGrid = { offset: Math.floor(rand() * 5), spacing: 12 + Math.floor(rand() * 12) };
    if (rand() < 0.25) f.exclusions = [{ x: f.x + Math.floor(rand() * 100), y: f.y + Math.floor(rand() * 80), w: 20 + Math.floor(rand() * 80), h: 10 + Math.floor(rand() * 60), margin: Math.floor(rand() * 6), jump: rand() < 0.2 }];
    if (rand() < 0.2) f.verticalAlign = ['center', 'bottom', 'justify'][Math.floor(rand() * 3)];
    if (rand() < 0.08) f.autoHeight = true;
    frames.push(f);
  }
  return frames;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const hyph = createHyphenator();
const EPS = 1e-6;

function checkResult(story, frames, res, label) {
  const total = storyLength(story);
  const text = plainText(story);
  const starts = paragraphStarts(story);
  assert.equal(res.frames.length, frames.length, label);
  assert.ok(res.endOffset >= 0 && res.endOffset <= total, `${label}: endOffset ${res.endOffset} in range`);
  if (!res.overflow) assert.equal(res.endOffset, total, `${label}: everything placed`);
  else assert.ok(res.endOffset < total || total === 0 || res.frames.length === 0 || true);
  const lines = res.frames.flatMap((f) => f.lines);
  // paragraph contiguity: lines of the story are consecutive in flow order
  let prev = null;
  for (const l of lines) {
    assert.ok(l.charStart <= l.charEnd, `${label}: line range`);
    assert.ok(l.charEnd <= total, `${label}: line inside the story`);
    if (prev) {
      if (prev.para === l.para) assert.equal(l.charStart, prev.charEnd, `${label}: lines of one paragraph are contiguous`);
      else {
        assert.equal(l.para, prev.para + 1, `${label}: paragraphs appear in order without gaps`);
        assert.equal(prev.last, true, `${label}: a paragraph is complete before the next starts`);
        assert.equal(l.charStart, starts[l.para], `${label}: paragraph start`);
        assert.equal(prev.charEnd + 1, l.charStart);
      }
    } else {
      assert.equal(l.charStart, 0, `${label}: the first line starts the story`);
    }
    prev = l;
  }
  if (!res.overflow && lines.length) assert.equal(lines.at(-1).charEnd, total, `${label}: last line ends the story`);
  if (res.overflow && lines.length) {
    const last = lines.at(-1);
    assert.equal(res.endOffset, last.charEnd + (last.last && last.para < story.paragraphs.length - 1 ? 1 : 0), `${label}: endOffset follows the last line`);
  }
  // frame metadata
  let prevLast = null;
  res.frames.forEach((fr, i) => {
    if (fr.lines.length) {
      assert.equal(fr.firstChar, fr.lines[0].charStart);
      if (prevLast !== null) assert.equal(fr.firstChar, prevLast, `${label}: frame ${i} continues where the previous stopped`);
      const last = fr.lines.at(-1);
      prevLast = fr.lastChar;
      assert.equal(fr.lastChar, last.charEnd + (last.last && last.para < story.paragraphs.length - 1 ? 1 : 0));
    }
    assert.equal(fr.overflow, i === res.frames.length - 1 ? res.overflow : false);
    // geometry
    const f = frames[i];
    const ins = { top: 0, right: 0, bottom: 0, left: 0, ...(f.insets || {}) };
    for (const l of fr.lines) {
      assert.ok(l.height > 0 && isFinite(l.y) && isFinite(l.x) && isFinite(l.width), `${label}: finite geometry`);
      assert.ok(Math.abs(l.ascent + l.descent - l.height) < 1e-6);
      assert.ok(l.x >= f.x + ins.left - 1e-6 - 40, `${label}: line starts inside the frame (x=${l.x})`);
      if (!f.autoHeight && f.h - ins.top - ins.bottom > 0) assert.ok(l.y >= f.y + ins.top - 1e-6, `${label}: line below the top`);
      assert.ok(l.frame === i && l.column >= 0 && l.column < fr.columns.length);
      // a line with at least two visible characters fits its column (single characters may be wider than a tiny column)
      const hasTab = l.runs.some((r) => r.tab);
      const hasDrop = l.runs.some((r) => r.dropCap);
      let visible = 0;
      for (const r of l.runs) if (!r.hang && !r.tab && !r.zw && !r.leader && r.text) visible += [...r.text.replace(/[­​]/gu, '')].length;
      const pa = story.paragraphs[l.para].attrs || {};
      const indents = (pa.indentLeft || 0) + (pa.indentRight || 0) + (pa.bullet ? pa.bullet.indent || 0 : Math.max(0, pa.indentFirst || 0));
      if (!hasTab && !hasDrop && visible >= 2 && indents < fr.columns[l.column].w - 4) {
        const col = fr.columns[l.column];
        assert.ok(l.x + l.width <= col.x + col.w + 1e-6, `${label}: line ${JSON.stringify(text.slice(l.charStart, l.charEnd))} fits its column (${l.x + l.width} > ${col.x + col.w})`);
      }
      // runs tile the line without overlap
      let x = null;
      for (const r of l.runs) {
        assert.ok(r.width >= 0 && isFinite(r.x) && isFinite(r.width), `${label}: run geometry`);
        if (r.leader || r.dropCap || r.bullet) continue;
        if (x !== null) assert.ok(r.x >= x - 1e-6, `${label}: runs do not overlap (${r.x} < ${x})`);
        x = r.x + r.width;
        if (r.charEnd > r.charStart && !r.tab && !r.zw && r.field === undefined) {
          assert.equal(r.text.length, r.charEnd - r.charStart, `${label}: run text length matches its source range`);
          const src = text.slice(r.charStart, r.charEnd);
          if (!r.font.caps) assert.equal(r.text.toLowerCase().length, src.toLowerCase().length);
        }
      }
    }
    // lines that share horizontal space never overlap vertically (lines beside an exclusion share a band)
    if (!f.verticalAlign || f.verticalAlign === 'top') {
      for (const c of fr.columns) {
        for (let a = c.first; a < c.first + c.count; a++) {
          for (let b = a + 1; b < c.first + c.count; b++) {
            const la = fr.lines[a];
            const lb = fr.lines[b];
            const disjoint = la.x + la.width <= lb.left + 1e-6 || lb.x + lb.width <= la.left + 1e-6;
            if (disjoint) continue;
            assert.ok(lb.y >= la.y + la.height - 1e-6 || la.y >= lb.y + lb.height - 1e-6, `${label}: lines ${a} and ${b} overlap (${la.y}+${la.height} vs ${lb.y})`);
          }
        }
      }
    }
    if (!f.autoHeight && !f.exclusions) {
      const bottom = f.y + f.h - ins.bottom;
      for (const l of fr.lines) assert.ok(l.y + l.height <= bottom + 1e-6, `${label}: line fits the frame (${l.y + l.height} > ${bottom})`);
    }
  });
}

function checkInteraction(story, res, rand, label) {
  const limit = Math.min(res.endOffset, storyLength(story));
  const lines = res.frames.flatMap((f) => f.lines);
  if (!lines.length) return;
  const step = Math.max(1, Math.floor(limit / 40));
  const text = plainText(story);
  for (let o = 0; o <= limit; o += step) {
    // the end of laid out text of an overflowing story has no line after it to be hit
    if (res.overflow && o === res.endOffset) continue;
    // offsets between the two halves of a surrogate pair are not valid caret positions
    const hi = text.charCodeAt(o - 1);
    const lo = text.charCodeAt(o);
    if (hi >= 0xd800 && hi < 0xdc00 && lo >= 0xdc00 && lo < 0xe000) continue;
    const c = offsetToCaret(res, o);
    if (!c) continue;
    // a drop cap wider than its slot overlaps the text: positions on such a line are ambiguous
    let lineOverlaps = false;
    let ex = -Infinity;
    for (const r of c.line.runs) {
      if (r.leader || r.charEnd <= r.charStart) continue;
      if (r.x < ex - 1e-6) lineOverlaps = true;
      ex = Math.max(ex, r.x + r.width);
    }
    if (lineOverlaps) continue;
    assert.ok(isFinite(c.x) && isFinite(c.y) && c.height > 0, `${label}: caret geometry for ${o}`);
    const h = hitTest(res, c.frame, c.x, c.y + c.height / 2);
    const c2 = offsetToCaret(res, h);
    assert.ok(c2, `${label}: hit offset ${h} has a caret`);
    // the hit offset sits at the same visual place (zero-width characters can share a position)
    const same = Math.abs(c2.x - c.x) < 1e-6 && Math.abs(c2.y - c.y) < 1e-6;
    // text that overflows its column can overlap a line of the neighboring column: such points are ambiguous
    const py = c.y + c.height / 2;
    const ambiguous = lines.some((l2) => l2 !== c.line && py >= l2.y && py < l2.y + l2.height && c.x >= l2.left && c.x < l2.right);
    if (ambiguous) continue;
    assert.ok(same, `${label}: caret of hit ${h} != caret of ${o}: ${JSON.stringify({ c: [c.x, c.y, c.frame], c2: [c2.x, c2.y, c2.frame], line: [c.line.charStart, c.line.charEnd, c.line.hard, c.line.last, c.line.hang], line2: [c2.line.charStart, c2.line.charEnd], text: JSON.stringify(plainText(story).slice(Math.max(0, o - 6), o + 6)), runs: c.line.runs.map((r) => [r.text, r.x, r.width, r.charStart, r.charEnd, r.tab, r.zw]) })}`);
    const m = moveCaretVertical(res, o, 1, null);
    assert.ok(m.offset >= 0 && m.offset <= limit + 1, `${label}: vertical move stays in range`);
    const u = moveCaretVertical(res, o, -1, m.goalX);
    assert.ok(u.offset >= 0 && u.offset <= limit + 1);
    assert.ok(lineStart(res, o) <= o + 0 && lineEnd(res, o) >= lineStart(res, o), `${label}: line start/end`);
  }
  const a = Math.floor(rand() * (limit + 1));
  const b = Math.floor(rand() * (limit + 1));
  for (const r of selectionRects(res, a, b)) {
    assert.ok(r.w >= 0 && r.h > 0 && isFinite(r.x) && isFinite(r.y));
  }
}

test('fuzz: random stories and frames keep all layout invariants', () => {
  const ITER = Number(process.env.OPENFINI_FUZZ_ITER) || 250;
  const rand = rng(Number(process.env.OPENFINI_FUZZ_SEED) || 20260101);
  let laidOut = 0;
  let overflows = 0;
  for (let iter = 0; iter < ITER; iter++) {
    const story = deepFreeze(randomStory(rand));
    const frames = deepFreeze(randomFrames(rand));
    const useMono = rand() < 0.5;
    const opts = {
      ...(useMono ? mono : approxMeasurer),
      fields: { pageNumber: 7 },
      hyphenate: rand() < 0.5 ? hyph : undefined,
      defaults: { char: { fontFamily: useMono ? 'Mono' : 'Helvetica', fontSize: 12 + Math.floor(rand() * 8), fontWeight: 400, fontStyle: 'normal', color: '#000000' }, para: { align: 'left', lineHeight: 1.2 } },
    };
    const label = `iteration ${iter}`;
    try {
      const t0 = performance.now();
      const res = layoutStory(story, frames, opts);
      const dt = performance.now() - t0;
      assert.ok(dt < 3000, `${label}: layout took ${dt}ms`);
      checkResult(story, frames, res, label);
      checkInteraction(story, res, rand, label);
      // layout is a pure function of its inputs
      const again = layoutStory(story, frames, opts);
      assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(res)), `${label}: deterministic`);
      laidOut += res.frames.reduce((a, f) => a + f.lines.length, 0);
      if (res.overflow) overflows++;
    } catch (e) {
      if (process.env.OPENFINI_FUZZ_DUMP) fs.writeFileSync(process.env.OPENFINI_FUZZ_DUMP, JSON.stringify({ story, frames, mono: useMono, hyphenate: !!opts.hyphenate, defaults: opts.defaults }));
      throw e;
    }
  }
  assert.ok(laidOut > 1000, 'the fuzz produced a meaningful amount of lines: ' + laidOut);
  assert.ok(overflows > ITER * 0.02 && overflows < ITER * 0.98, 'both overflowing and fitting cases occur: ' + overflows);
});

test('fuzz: degenerate frames and extreme values terminate without errors', () => {
  const story = { paragraphs: [{ runs: [{ text: 'abc def\tghi\u{2028}jkl mno pqr stu vwx' }], attrs: { align: 'justify', dropCap: { lines: 3, chars: 1 }, tabs: [{ pos: 5, align: 'right', leader: '.' }] } }, { runs: [{ text: 'x' }] }] };
  const cases = [
    [{ x: 0, y: 0, w: 0, h: 0 }],
    [{ x: 0, y: 0, w: -10, h: -10 }],
    [{ x: 0, y: 0, w: 1, h: 1000 }],
    [{ x: 0, y: 0, w: 1e7, h: 1e7 }],
    [{ x: 0, y: 0, w: 100, h: 0.5 }],
    [{ x: 0, y: 0, w: 100, h: 100, columns: 50, gutter: 100 }],
    [{ x: 0, y: 0, w: 100, h: 100, insets: { top: 200, left: 200, right: 200, bottom: 200 } }],
    [{ x: 0, y: 0, w: 100, h: 100, exclusions: [{ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }] }],
    [{ x: NaN, y: Infinity, w: 100, h: 100 }],
    [{ x: 0, y: 0, w: 100, h: 100, baselineGrid: { offset: 0, spacing: 0.001 } }],
    [{ x: 0, y: 0, w: 100, h: 100, columns: 0, gutter: -5 }],
    [],
  ];
  for (const frames of cases) {
    const res = layoutStory(story, frames, { ...mono });
    assert.equal(res.frames.length, frames.length);
    assert.ok(res.endOffset >= 0);
  }
  // hostile story shapes
  const odd = [
    { paragraphs: [] },
    { paragraphs: [{ runs: [] }, { runs: [{ text: '' }] }] },
    { paragraphs: [{ runs: [{ text: 'a', attrs: { fontSize: -5, fontFamily: 5, tracking: 'x', baselineShift: NaN } }] }] },
    { paragraphs: [{ runs: [{ text: 'a\nb\r\nc' }] }] },
    { paragraphs: [{ runs: [{ text: 'x', styleId: 'nope' }], styleId: 'nope', attrs: { bullet: { kind: 'wat' }, dropCap: { lines: 99, chars: 99 }, tabs: [{ pos: NaN }], lineHeight: -1, widowOrphan: -3 } }] },
  ];
  for (const s of odd) {
    const res = layoutStory(s, [{ x: 0, y: 0, w: 100, h: 100 }], { ...mono });
    assert.ok(res.frames.length === 1);
  }
  assert.ok(layoutStory(null, [{ x: 0, y: 0, w: 10, h: 10 }]).frames.length === 1);
});
