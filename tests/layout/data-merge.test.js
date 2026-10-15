import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCSV,
  parseDelimited,
  detectDelimiter,
  mergeFields,
  listFields,
  buildTOC,
  layoutStory,
  storyFromPlain,
  plainText,
} from '../../app/src/engine/layout/index.js';

const BOM = String.fromCharCode(0xfeff);
const LS = '\u{2028}';

test('parseDelimited: RFC 4180 basics', () => {
  assert.deepEqual(parseDelimited('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseDelimited('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseDelimited('a,b\r1,2'), [['a', 'b'], ['1', '2']], 'a lone CR ends a row');
  assert.deepEqual(parseDelimited('a,b\n1,2'), [['a', 'b'], ['1', '2']], 'no trailing newline');
  assert.deepEqual(parseDelimited('"a,b",c'), [['a,b', 'c']]);
  assert.deepEqual(parseDelimited('"he said ""hi""",x'), [['he said "hi"', 'x']]);
  assert.deepEqual(parseDelimited('"line1\nline2",x\n"c\r\nd",y'), [['line1\nline2', 'x'], ['c\r\nd', 'y']], 'embedded newlines are kept as they are');
  assert.deepEqual(parseDelimited(BOM + 'a,b\n1,2'), [['a', 'b'], ['1', '2']], 'byte order mark');
  assert.deepEqual(parseDelimited('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(parseDelimited(',,'), [['', '', '']]);
  assert.deepEqual(parseDelimited('a,b,'), [['a', 'b', '']]);
  assert.deepEqual(parseDelimited('""'), [['']], 'an empty quoted field is a row');
  assert.deepEqual(parseDelimited('"",""\nx,y'), [['', ''], ['x', 'y']]);
  assert.deepEqual(parseDelimited('a\n\n\nb\n'), [['a'], ['b']], 'blank lines are skipped by default');
  assert.deepEqual(parseDelimited('a\n\nb', { skipEmptyLines: false }), [['a'], [''], ['b']]);
  assert.deepEqual(parseDelimited(''), []);
  assert.deepEqual(parseDelimited('\n\n'), []);
  assert.deepEqual(parseDelimited(null), []);
  assert.deepEqual(parseDelimited('"abc,def\nxyz'), [['abc,def\nxyz']], 'an unterminated quote runs to the end');
  assert.deepEqual(parseDelimited('ab"c,d'), [['ab"c', 'd']], 'a quote inside an unquoted field is literal');
  assert.deepEqual(parseDelimited('a,"b"c'), [['a', 'bc']]);
  assert.deepEqual(parseDelimited('  a , b '), [['  a ', ' b ']], 'whitespace is preserved');
  assert.deepEqual(parseDelimited('"a""",b'), [['a"', 'b']]);
  assert.deepEqual(parseDelimited('"""",b'), [['"', 'b']]);
  assert.deepEqual(parseDelimited('äö,\u{1f600},中'), [['äö', '\u{1f600}', '中']]);
});

test('parseDelimited: delimiters and quote characters', () => {
  assert.deepEqual(parseDelimited('a;b;"c;d"\n1;2;3', { delimiter: ';' }), [['a', 'b', 'c;d'], ['1', '2', '3']]);
  assert.deepEqual(parseDelimited('a\tb\n"x\ty"\tz', { delimiter: '\t' }), [['a', 'b'], ['x\ty', 'z']]);
  assert.deepEqual(parseDelimited("a|'b|c'|d", { delimiter: '|', quote: "'" }), [['a', 'b|c', 'd']]);
  assert.deepEqual(parseDelimited('a,b', { delimiter: ',,' }), [['a', 'b']], 'invalid delimiters fall back to a comma');
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n4;5;6'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a|b\n1|2'), '|');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('plain text without delimiters'), ',');
  assert.equal(detectDelimiter('"a;b",c,d\n"e;f",g,h'), ',', 'delimiters inside quotes do not count');
  assert.deepEqual(parseDelimited('x;y\n1;2', { delimiter: 'auto' }), [['x', 'y'], ['1', '2']]);
});

test('parseCSV: headers, records, ragged rows, duplicates', () => {
  const t = parseCSV(' First Name ,Last,,Last\nAnna,Smith,x,y\nBob\n');
  assert.deepEqual(t.headers, ['First Name', 'Last', 'Column 3', 'Last_2']);
  assert.deepEqual(t.rows, [['Anna', 'Smith', 'x', 'y'], ['Bob']]);
  assert.equal(t.records.length, 2);
  assert.equal(t.records[0]['First Name'], 'Anna');
  assert.equal(t.records[0].Last_2, 'y');
  assert.equal(t.records[1].Last, '', 'missing cells are empty strings');
  assert.deepEqual(Object.keys(t.records[1]), t.headers);
  const nh = parseCSV('1,2,3\n4,5', { header: false });
  assert.deepEqual(nh.headers, ['Column 1', 'Column 2', 'Column 3']);
  assert.equal(nh.rows.length, 2);
  assert.equal(nh.records[1]['Column 3'], '');
  assert.deepEqual(parseCSV('').records, []);
  assert.deepEqual(parseCSV('only,header').rows, []);
  const semi = parseCSV('a;b\n1;2', { delimiter: 'auto' });
  assert.equal(semi.records[0].b, '2');
  // records have no prototype: hostile headers cannot pollute
  const evil = parseCSV('__proto__,constructor\nx,y');
  assert.equal(evil.records[0].constructor, 'y');
  assert.equal({}.polluted, undefined);
});

test('parseDelimited handles large inputs quickly', () => {
  const lines = [];
  for (let i = 0; i < 50000; i++) lines.push(`${i},"name ${i}","quoted ""text"" ${i}",${i * 2}`);
  const t0 = performance.now();
  const rows = parseDelimited(lines.join('\r\n'));
  const dt = performance.now() - t0;
  assert.equal(rows.length, 50000);
  assert.deepEqual(rows[49999], ['49999', 'name 49999', 'quoted "text" 49999', '99998']);
  assert.ok(dt < 1500, `parsing took ${dt}ms`);
});

// ---------------------------------------------------------------------------------------------------------------

const B = { fontWeight: 700 };
const I = { fontStyle: 'italic' };

test('mergeFields keeps the styling of the run that holds the marker', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: 'Dear <<First Name>>,', attrs: B }], attrs: { align: 'center' } },
      { runs: [{ text: 'Hello ' }, { text: '<<Name>>', attrs: B }, { text: '!', attrs: I }], styleId: 'p' },
    ],
  };
  const r = mergeFields(s, { 'First Name': 'Anna', Name: 'Bob' });
  assert.deepEqual(r.paragraphs[0], { runs: [{ text: 'Dear Anna,', attrs: B }], attrs: { align: 'center' } });
  assert.deepEqual(r.paragraphs[1].runs, [{ text: 'Hello ' }, { text: 'Bob', attrs: B }, { text: '!', attrs: I }]);
  assert.equal(r.paragraphs[1].styleId, 'p');
  // inputs are not mutated
  assert.equal(s.paragraphs[0].runs[0].text, 'Dear <<First Name>>,');
});

test('mergeFields: markers split over runs, repeated markers, names are trimmed and case-insensitive', () => {
  const split = { paragraphs: [{ runs: [{ text: 'x <<Na', attrs: B }, { text: 'me>> y', attrs: I }] }] };
  const r = mergeFields(split, { name: 'Zed' });
  assert.equal(plainText(r), 'x Zed y');
  assert.deepEqual(r.paragraphs[0].runs, [{ text: 'x Zed', attrs: B }, { text: ' y', attrs: I }], 'the first run keeps its style, the tail run loses the marker');
  const multi = { paragraphs: [{ runs: [{ text: '<<A>> and <<a>> and << A >> and <<B>>' }] }, { runs: [{ text: '<<A>>' }] }] };
  const m = mergeFields(multi, { A: '1', b: '2' });
  assert.equal(plainText(m), '1 and 1 and 1 and 2\n1');
  // a marker that is a whole run disappears into a neighbor when merged text is identical
  const whole = mergeFields({ paragraphs: [{ runs: [{ text: '<<X>>' }, { text: ' tail', attrs: B }] }] }, { X: 'head' });
  assert.deepEqual(whole.paragraphs[0].runs, [{ text: 'head' }, { text: ' tail', attrs: B }]);
  // empty value removes the run
  const empty = mergeFields({ paragraphs: [{ runs: [{ text: 'a' }, { text: '<<X>>', attrs: B }, { text: 'b' }] }] }, { X: '' });
  assert.deepEqual(empty.paragraphs[0].runs, [{ text: 'ab' }]);
});

test('mergeFields: missing fields, odd values and identity', () => {
  const s = { paragraphs: [{ runs: [{ text: 'a <<Known>> b <<Unknown>> c' }] }, { runs: [{ text: 'no markers' }] }] };
  const keep = mergeFields(s, { Known: 'K' });
  assert.equal(plainText(keep), 'a K b <<Unknown>> c\nno markers');
  assert.equal(keep.paragraphs[1], s.paragraphs[1], 'untouched paragraphs keep their identity');
  const drop = mergeFields(s, { Known: 'K' }, { missing: 'empty' });
  assert.equal(plainText(drop), 'a K b  c\nno markers');
  assert.equal(mergeFields(s, {}), s, 'nothing to replace: same story object');
  assert.equal(mergeFields(storyFromPlain('plain'), { a: 1 }).paragraphs.length, 1);
  // values: numbers, null, newlines, regexp specials and values that look like markers
  const v = mergeFields({ paragraphs: [{ runs: [{ text: '<<n>>|<<z>>|<<m>>|<<s>>|<<t>>' }] }] }, { n: 42, z: null, m: 'l1\nl2\r\nl3', s: '$& $1 \\', t: '<<n>>' });
  assert.equal(plainText(v), `42||l1${LS}l2${LS}l3|$& $1 \\|<<n>>`);
  // Map records and hostile keys
  assert.equal(plainText(mergeFields(storyFromPlain('<<a>>'), new Map([['a', 'mapped']]))), 'mapped');
  const hostile = mergeFields(storyFromPlain('<<__proto__>> <<constructor>> <<toString>>'), { a: 1 });
  assert.equal(plainText(hostile), '<<__proto__>> <<constructor>> <<toString>>');
  const own = JSON.parse('{"__proto__": "own"}');
  assert.equal(plainText(mergeFields(storyFromPlain('<<__proto__>>'), own)), 'own');
  // incomplete markers are left alone
  assert.equal(plainText(mergeFields(storyFromPlain('<<oops> <<>> << >> <<a'), { a: 'x', '': 'e' })), '<<oops> <<>> << >> <<a');
});

test('listFields', () => {
  const s = {
    paragraphs: [
      { runs: [{ text: 'Hi <<First Name>> <<Last>>' }] },
      { runs: [{ text: '<<last>> and <<Sp' }, { text: 'lit>> and <<First Name>>', attrs: B }] },
      { runs: [] },
    ],
  };
  assert.deepEqual(listFields(s), ['First Name', 'Last', 'Split']);
  assert.deepEqual(listFields(storyFromPlain('nothing here')), []);
  assert.deepEqual(listFields({ paragraphs: [{ runs: [] }] }), []);
});

test('buildTOC produces right aligned page numbers with leaders', () => {
  const toc = buildTOC(
    [
      { title: 'Introduction', page: 1 },
      { title: 'Getting started', page: 12, level: 2 },
      { title: 'Appendix', page: 'A-1', level: 1 },
    ],
    { width: 300, leader: '.', indent: 20, levelCharAttrs: { 1: { fontWeight: 700 } }, spaceAfter: 4 },
  );
  assert.equal(toc.paragraphs.length, 3);
  assert.equal(plainText(toc), 'Introduction\t1\nGetting started\t12\nAppendix\tA-1');
  assert.deepEqual(toc.paragraphs[0].attrs.tabs, [{ pos: 300, align: 'right', leader: '.' }]);
  assert.equal(toc.paragraphs[1].attrs.indentLeft, 20);
  assert.deepEqual(toc.paragraphs[0].runs[0].attrs, { fontWeight: 700 });
  assert.equal(toc.paragraphs[1].runs[0].attrs, undefined);
  assert.equal(toc.paragraphs[0].attrs.spaceAfter, 4);
  // laid out: the number ends exactly at the tab stop and a leader fills the gap
  const mono = { measure: (f, t) => ([...t].length * f.size) / 2, metrics: (f) => ({ ascent: f.size * 0.8, descent: f.size * 0.2 }) };
  const res = layoutStory(toc, [{ x: 0, y: 0, w: 400, h: 400 }], { ...mono, defaults: { char: { fontFamily: 'M', fontSize: 20, fontWeight: 400, fontStyle: 'normal', color: '#000000' }, para: {} } });
  const lines = res.frames[0].lines;
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const page = line.runs.filter((r) => r.text && !r.leader && !r.tab).at(-1);
    assert.equal(page.x + page.width, 300, 'right aligned at the stop');
    const leader = line.runs.find((r) => r.leader);
    assert.ok(leader && /^\.+$/.test(leader.text));
    assert.ok(leader.x + leader.width <= page.x + 1e-9);
  }
  assert.equal(lines[1].runs[0].x, 20, 'level 2 is indented');
  assert.deepEqual(buildTOC([], { width: 100 }), { paragraphs: [{ runs: [] }] });
  const clean = buildTOC([{ title: 'Tab\tand\nbreak', page: 3 }], { width: 100, leader: '' });
  assert.equal(plainText(clean), 'Tab and break\t3');
  assert.equal(clean.paragraphs[0].attrs.tabs[0].leader, undefined);
});
