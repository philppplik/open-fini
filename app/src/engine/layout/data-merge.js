/**
 * Data merge helpers: CSV / delimited text parsing (RFC 4180) and `<<Field Name>>` placeholder merging for stories.
 *
 * @module data-merge
 */

import { normalizeInputText, normalizeStory } from './text-model.js';

/**
 * @typedef {Object} DelimitedOptions
 * @property {string} [delimiter=','] a single character, or `'auto'` to detect one of , ; tab |
 * @property {string} [quote='"'] quote character
 * @property {boolean} [skipEmptyLines=true] ignore lines that contain no characters at all
 */

/**
 * Guesses the delimiter of a delimited text by counting candidates (outside quotes) in the first lines.
 * @param {string} text
 * @returns {string} one of ',', ';', '\t', '|' (',' when nothing is found)
 */
export function detectDelimiter(text) {
  const sample = text.replace(/^\u{feff}/u, '').slice(0, 8192);
  const cands = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = 0;
  for (const c of cands) {
    // average count per line over the first lines, requiring consistency
    const rows = parseDelimited(sample, { delimiter: c, skipEmptyLines: true }).slice(0, 12);
    if (rows.length < 1) continue;
    const counts = rows.map((r) => r.length - 1);
    const first = counts[0];
    if (first <= 0) continue;
    const consistent = counts.filter((n) => n === first).length / counts.length;
    const score = first * (0.5 + consistent);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Parses delimited text into rows of fields (RFC 4180): quoted fields may contain delimiters, line breaks and
 * doubled quotes (`""` is one quote); rows end with CRLF, LF or CR; a leading UTF-8 byte order mark is ignored. A
 * quote in the middle of an unquoted field is kept literally. An unterminated quoted field extends to the end of the
 * input. A final line break does not produce an extra row.
 * @param {string} text
 * @param {DelimitedOptions} [opts]
 * @returns {string[][]}
 */
export function parseDelimited(text, opts) {
  const o = opts || {};
  let src = String(text == null ? '' : text);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  let delimiter = o.delimiter === undefined ? ',' : o.delimiter;
  if (delimiter === 'auto') delimiter = detectDelimiter(src);
  if (typeof delimiter !== 'string' || delimiter.length !== 1) delimiter = ',';
  const quote = typeof o.quote === 'string' && o.quote.length === 1 ? o.quote : '"';
  const skipEmpty = o.skipEmptyLines !== false;
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false; // the current row has content (even an empty quoted field)
  let atFieldStart = true;
  const n = src.length;
  const endField = () => {
    row.push(field);
    field = '';
    atFieldStart = true;
  };
  const endRow = () => {
    endField();
    if (!(skipEmpty && row.length === 1 && row[0] === '' && !fieldStarted)) rows.push(row);
    row = [];
    fieldStarted = false;
  };
  for (let i = 0; i < n; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === quote) {
        if (src[i + 1] === quote) {
          field += quote;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === quote && atFieldStart) {
      inQuotes = true;
      fieldStarted = true;
      atFieldStart = false;
    } else if (c === delimiter) {
      fieldStarted = true;
      endField();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
      fieldStarted = true;
      atFieldStart = false;
    }
  }
  if (inQuotes || field !== '' || row.length > 0 || fieldStarted) endRow();
  return rows;
}

/**
 * @typedef {Object} ParsedTable
 * @property {string[]} headers
 * @property {string[][]} rows    data rows (without the header row)
 * @property {Record<string,string>[]} records  one object per data row keyed by header (missing cells are '')
 */

/**
 * Parses CSV text with a header row. Header names are trimmed; duplicate names get a numeric suffix (`name_2`).
 * With `header: false` the headers are `Column 1`, `Column 2`, ...
 * @param {string} text
 * @param {DelimitedOptions & {header?: boolean}} [opts]
 * @returns {ParsedTable}
 */
export function parseCSV(text, opts) {
  const o = opts || {};
  const all = parseDelimited(text, o);
  const useHeader = o.header !== false;
  const width = all.reduce((m, r) => Math.max(m, r.length), 0);
  /** @type {string[]} */
  let headers;
  let rows;
  if (useHeader && all.length) {
    const seen = new Map();
    headers = all[0].map((h, i) => {
      let name = h.trim() || `Column ${i + 1}`;
      const k = name.toLowerCase();
      const cnt = (seen.get(k) || 0) + 1;
      seen.set(k, cnt);
      if (cnt > 1) name = `${name}_${cnt}`;
      return name;
    });
    for (let i = headers.length; i < width; i++) headers.push(`Column ${i + 1}`);
    rows = all.slice(1);
  } else {
    headers = [];
    for (let i = 0; i < width; i++) headers.push(`Column ${i + 1}`);
    rows = all;
  }
  const records = rows.map((r) => {
    /** @type {Record<string,string>} */
    const rec = Object.create(null);
    for (let i = 0; i < headers.length; i++) rec[headers[i]] = r[i] === undefined ? '' : r[i];
    return rec;
  });
  return { headers, rows, records };
}

const MARKER = /<<([^<>]{1,200}?)>>/g;

/**
 * Lists the distinct field names used by `<<Field Name>>` markers in a story, in order of first appearance.
 * Markers that span several runs are recognized.
 * @param {import('./text-model.js').Story} story
 * @returns {string[]}
 */
export function listFields(story) {
  const seen = new Set();
  const out = [];
  for (const p of story.paragraphs) {
    let text = '';
    for (const r of p.runs) text += r.text;
    if (text.indexOf('<<') < 0) continue;
    MARKER.lastIndex = 0;
    let m;
    while ((m = MARKER.exec(text))) {
      const name = m[1].trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        out.push(name);
      }
    }
  }
  return out;
}

/**
 * Looks a field up case-insensitively (names are trimmed).
 * @param {any} record plain object or Map
 * @returns {(name: string) => (string|undefined)}
 */
function makeLookup(record) {
  /** @type {Map<string,string>} */
  const m = new Map();
  if (record instanceof Map) {
    for (const [k, v] of record) m.set(String(k).trim().toLowerCase(), v == null ? '' : String(v));
  } else if (record && typeof record === 'object') {
    for (const k of Object.keys(record)) m.set(k.trim().toLowerCase(), record[k] == null ? '' : String(record[k]));
  }
  return (name) => m.get(name.trim().toLowerCase());
}

/**
 * Replaces `<<Field Name>>` markers with values from `record`, keeping the styling of the run that contains the
 * marker's first character (a marker split over several runs is merged into the first one). Line breaks inside values
 * become forced line breaks (U+2028); control characters are removed. Paragraph structure is untouched, and paragraphs
 * without markers keep their object identity.
 *
 * @param {import('./text-model.js').Story} story
 * @param {Record<string, any>|Map<string, any>} record
 * @param {{missing?: 'keep'|'empty'}} [opts] what to do with markers that have no value: keep them (default) or remove them
 * @returns {import('./text-model.js').Story}
 */
export function mergeFields(story, record, opts) {
  const get = makeLookup(record);
  const missing = opts && opts.missing === 'empty' ? 'empty' : 'keep';
  let changed = false;
  const paragraphs = story.paragraphs.map((p) => {
    let text = '';
    for (const r of p.runs) text += r.text;
    if (text.indexOf('<<') < 0) return p;
    /** @type {{from:number, to:number, value:string}[]} */
    const hits = [];
    MARKER.lastIndex = 0;
    let m;
    while ((m = MARKER.exec(text))) {
      if (!m[1].trim()) continue; // a blank name is not a field
      const v = get(m[1]);
      if (v === undefined) {
        if (missing === 'keep') continue;
        hits.push({ from: m.index, to: m.index + m[0].length, value: '' });
      } else {
        hits.push({ from: m.index, to: m.index + m[0].length, value: normalizeInputText(v).replace(/\n+/g, '\u{2028}') });
      }
    }
    if (!hits.length) return p;
    changed = true;
    const runs = [];
    let pos = 0;
    let h = 0;
    for (const r of p.runs) {
      const rs = pos;
      const re = pos + r.text.length;
      let cur = rs;
      let out = '';
      while (cur < re) {
        while (h < hits.length && hits[h].to <= cur) h++;
        const hit = h < hits.length ? hits[h] : null;
        if (!hit || hit.from >= re) {
          out += r.text.slice(cur - rs);
          cur = re;
        } else if (cur < hit.from) {
          out += r.text.slice(cur - rs, hit.from - rs);
          cur = hit.from;
        } else {
          // inside a marker: the run holding the marker start emits the value
          if (hit.from >= rs) out += hit.value;
          cur = Math.min(re, hit.to);
        }
      }
      if (out) runs.push({ ...r, text: out });
      pos = re;
    }
    return { ...p, runs };
  });
  return changed ? normalizeStory({ paragraphs }) : story;
}
