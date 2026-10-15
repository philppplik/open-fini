/**
 * Liang-style hyphenation (the algorithm of TeX) with the en-US pattern set.
 *
 * `createHyphenator()` returns a function `(word) => string[]` that splits a word into syllables whose
 * concatenation is the original word. It plugs directly into `layoutStory(..., {hyphenate})`.
 *
 * @module hyphenation
 */

import { PATTERNS, EXCEPTIONS } from './hyphenation-en-us.js';

/**
 * @typedef {Object} HyphenatorOptions
 * @property {string} [patterns]    Space separated TeX patterns (default: en-US).
 * @property {string} [exceptions]  Space separated exception words with '-' at the break positions.
 * @property {number} [leftMin=2]   Minimum letters before the first break.
 * @property {number} [rightMin=3]  Minimum letters after the last break.
 * @property {number} [minLength=5] Words shorter than this are never split.
 */

/** @type {{map: Map<string, Uint8Array>, max: number, exc: Map<string, number[]>}|null} */
let defaultTables = null;

/**
 * @param {string} patterns
 * @param {string} exceptions
 */
function buildTables(patterns, exceptions) {
  /** @type {Map<string, Uint8Array>} */
  const map = new Map();
  let max = 0;
  for (const p of patterns.split(/\s+/)) {
    if (!p) continue;
    let letters = '';
    /** @type {number[]} */
    const vals = [0];
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      if (c >= 48 && c <= 57) vals[vals.length - 1] = c - 48;
      else {
        letters += p[i];
        vals.push(0);
      }
    }
    if (!letters) continue;
    map.set(letters, Uint8Array.from(vals));
    if (letters.length > max) max = letters.length;
  }
  /** @type {Map<string, number[]>} */
  const exc = new Map();
  for (const w of exceptions.split(/\s+/)) {
    if (!w) continue;
    const pts = [];
    let plain = '';
    for (const ch of w) {
      if (ch === '-') pts.push(plain.length);
      else plain += ch;
    }
    exc.set(plain.toLowerCase(), pts);
  }
  return { map, max, exc };
}

/**
 * Creates a hyphenator. Word lookups are cached, so repeated words are free.
 *
 * Only words made of ASCII letters are hyphenated (anything else is returned whole), which is what the en-US
 * patterns are defined for. Hyphenating a word never changes its characters: `result.join('') === word`.
 *
 * @param {HyphenatorOptions} [opts]
 * @returns {(word: string) => string[]}
 */
export function createHyphenator(opts) {
  const o = opts || {};
  let tables;
  if (o.patterns !== undefined) {
    tables = buildTables(o.patterns, o.exceptions || '');
  } else {
    if (!defaultTables) defaultTables = buildTables(PATTERNS, EXCEPTIONS);
    tables = defaultTables;
    if (o.exceptions) {
      const extra = buildTables('', o.exceptions);
      tables = { map: tables.map, max: tables.max, exc: new Map([...tables.exc, ...extra.exc]) };
    }
  }
  const { map, max, exc } = tables;
  const leftMin = o.leftMin === undefined ? 2 : o.leftMin;
  const rightMin = o.rightMin === undefined ? 3 : o.rightMin;
  const minLength = o.minLength === undefined ? 5 : o.minLength;
  /** @type {Map<string, string[]>} */
  const cache = new Map();

  /**
   * @param {string} word
   * @returns {string[]}
   */
  return function hyphenate(word) {
    const hit = cache.get(word);
    if (hit) return hit.slice();
    const n = word.length;
    let result = [word];
    if (n >= minLength && /^[A-Za-z]+$/.test(word)) {
      const lower = word.toLowerCase();
      /** @type {number[]} */
      let points = [];
      const ex = exc.get(lower);
      if (ex) {
        points = ex.filter((p) => p >= 1 && p < n);
      } else {
        const w = '.' + lower + '.';
        const h = new Uint8Array(w.length + 1);
        for (let i = 0; i < w.length; i++) {
          const lim = Math.min(w.length, i + max);
          for (let j = i + 1; j <= lim; j++) {
            const vals = map.get(w.substring(i, j));
            if (vals) {
              for (let k = 0; k < vals.length; k++) if (vals[k] > h[i + k]) h[i + k] = vals[k];
            }
          }
        }
        // h[k] is the value before w[k]; word index p (break before word[p]) maps to h[p + 1]
        for (let p = leftMin; p <= n - rightMin; p++) if (p >= 1 && h[p + 1] & 1) points.push(p);
      }
      if (points.length) {
        result = [];
        let prev = 0;
        for (const p of points) {
          if (p <= prev || p >= n) continue;
          result.push(word.slice(prev, p));
          prev = p;
        }
        result.push(word.slice(prev));
      }
    }
    if (cache.size > 20000) cache.clear();
    cache.set(word, result);
    return result.slice();
  };
}
