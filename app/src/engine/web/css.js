// Offset-preserving, error tolerant CSS parser plus selector/media helpers, formatter and minifier.
// See docs/web-engine.md. Pure string code, no DOM.

/**
 * @typedef {{ severity: 'error'|'warning'|'info', code: string, message: string, start: number, end: number }} Diagnostic
 * @typedef {{ prop: string, value: string, important: boolean, start: number, end: number, nameStart: number, nameEnd: number,
 *   valueStart: number, valueEnd: number }} Decl
 * @typedef {{ type: 'style', selector: string, selectorStart: number, selectorEnd: number, block: {start:number,end:number},
 *   start: number, end: number, decls: Decl[], parent: AtRule|null, outer: StyleRule|null, rules: CssRule[] }} StyleRule
 * @typedef {{ type: 'at', name: string, prelude: string, preludeStart: number, preludeEnd: number, block: {start:number,end:number}|null,
 *   start: number, end: number, rules: CssRule[], decls: Decl[], parent: AtRule|null, outer: StyleRule|null }} AtRule
 * @typedef {StyleRule|AtRule} CssRule
 * @typedef {{ source: string, rules: CssRule[], errors: Diagnostic[] }} ParsedCss
 */

// ------------------------------------------------------------------------------------------------ lexer

const WS = 1;
const COMMENT = 2;
const STRING = 3;
const OPEN = 4;
const CLOSE = 5;
const SEMI = 6;
const TEXT = 7;

const isWsCode = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;

/**
 * Tokenizes CSS into typed arrays. `;`, `{` and `}` inside parentheses are plain text (so `url(a;b)` works),
 * but a brace always ends the parenthesis level so one unbalanced `(` cannot swallow the file.
 * @param {string} s
 */
function lex(s) {
  const n = s.length;
  let cap = Math.max(64, (n >> 2) + 16);
  let type = new Uint8Array(cap);
  let ts = new Int32Array(cap);
  let te = new Int32Array(cap);
  let count = 0;
  /** @type {Diagnostic[]} */
  const diags = [];
  const push = (t, a, b) => {
    if (count === cap) {
      cap *= 2;
      const t2 = new Uint8Array(cap);
      t2.set(type);
      type = t2;
      const a2 = new Int32Array(cap);
      a2.set(ts);
      ts = a2;
      const b2 = new Int32Array(cap);
      b2.set(te);
      te = b2;
    }
    type[count] = t;
    ts[count] = a;
    te[count] = b;
    count++;
  };
  let i = 0;
  let depth = 0;
  let parenStart = 0;
  const closeParens = (at) => {
    if (depth > 0) diags.push({ severity: "warning", code: "css/unclosed-paren", message: "This parenthesis is never closed.", start: parenStart, end: Math.min(n, parenStart + 1) });
    depth = 0;
    void at;
  };
  while (i < n) {
    const c = s.charCodeAt(i);
    if (isWsCode(c)) {
      let j = i + 1;
      while (j < n && isWsCode(s.charCodeAt(j))) j++;
      push(WS, i, j);
      i = j;
    } else if (c === 47 && s.charCodeAt(i + 1) === 42) {
      let e = s.indexOf("*/", i + 2);
      if (e < 0) {
        e = n;
        diags.push({ severity: "warning", code: "css/unclosed-comment", message: "This comment is never closed.", start: i, end: n });
      } else e += 2;
      push(COMMENT, i, e);
      i = e;
    } else if (c === 34 || c === 39) {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = s.charCodeAt(j);
        if (d === 92) j += 2;
        else if (d === c) {
          j++;
          closed = true;
          break;
        } else if (d === 10) break;
        else j++;
      }
      if (j > n) j = n;
      if (!closed) diags.push({ severity: "warning", code: "css/unclosed-string", message: "This string is not closed.", start: i, end: j });
      push(STRING, i, j);
      i = j;
    } else if (c === 123) {
      closeParens(i);
      push(OPEN, i, i + 1);
      i++;
    } else if (c === 125) {
      closeParens(i);
      push(CLOSE, i, i + 1);
      i++;
    } else if (c === 59 && depth === 0) {
      push(SEMI, i, i + 1);
      i++;
    } else {
      let j = i;
      while (j < n) {
        const d = s.charCodeAt(j);
        if (isWsCode(d) || d === 34 || d === 39 || d === 123 || d === 125) break;
        if (d === 47 && s.charCodeAt(j + 1) === 42) break;
        if (d === 59 && depth === 0) break;
        if (d === 40) {
          if (depth === 0) parenStart = j;
          depth++;
        } else if (d === 41) {
          if (depth > 0) depth--;
        } else if (d === 92) j++;
        j++;
      }
      if (j > n) j = n;
      if (j === i) j = i + 1;
      push(TEXT, i, j);
      i = j;
    }
  }
  closeParens(n);
  return { type, ts, te, count, diags };
}

/** Removes comments (outside strings) from a snippet and trims it. */
function stripComments(text) {
  if (text.indexOf("/*") < 0) return text;
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      let e = text.indexOf("*/", i + 2);
      e = e < 0 ? n : e + 2;
      const prev = out.length ? out.charCodeAt(out.length - 1) : 32;
      const next = e < n ? text.charCodeAt(e) : 32;
      if (!isWsCode(prev) && !isWsCode(next)) out += " ";
      i = e;
    } else if (c === 34 || c === 39) {
      let j = i + 1;
      while (j < n && text.charCodeAt(j) !== c && text.charCodeAt(j) !== 10) j += text.charCodeAt(j) === 92 ? 2 : 1;
      if (j < n && text.charCodeAt(j) === c) j++;
      out += text.slice(i, Math.min(j, n));
      i = j;
    } else {
      out += text[i++];
    }
  }
  return out.trim();
}

// ------------------------------------------------------------------------------------------------ parser

const isIdentCode = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c > 127;

/**
 * Parses CSS into an offset-preserving rule tree. Never throws.
 * @param {string} source
 * @returns {ParsedCss}
 */
export function parseCss(source) {
  const s = String(source ?? "");
  const n = s.length;
  const { type, ts, te, count, diags } = lex(s);
  /** @type {Diagnostic[]} */
  const errors = diags.slice();
  /** @type {CssRule[]} */
  const rules = [];
  /** @type {{ node: CssRule|null, rules: CssRule[], decls: Decl[]|null }[]} */
  const frames = [{ node: null, rules, decls: null }];
  const diag = (severity, code, message, start, end) => errors.push({ severity, code, message, start, end });

  /** index of the last token in [a, b) that is not whitespace/comment, or -1 */
  const lastSig = (a, b) => {
    for (let k = b - 1; k >= a; k--) if (type[k] !== WS && type[k] !== COMMENT) return k;
    return -1;
  };

  let i = 0;
  while (i < count) {
    const t = type[i];
    if (t === WS || t === COMMENT) {
      i++;
      continue;
    }
    const frame = frames[frames.length - 1];
    if (t === CLOSE) {
      if (frames.length > 1) {
        const f = frames.pop();
        f.node.block.end = ts[i];
        f.node.end = ts[i] + 1;
      } else diag("error", "css/stray-brace", "This closing brace has no matching opening brace.", ts[i], ts[i] + 1);
      i++;
      continue;
    }
    if (t === SEMI) {
      i++;
      continue;
    }
    if (t === TEXT) {
      const len = te[i] - ts[i];
      if ((len === 4 && s.startsWith("<!--", ts[i])) || (len === 3 && s.startsWith("-->", ts[i]))) {
        i++;
        continue;
      }
    }
    const stmtStart = ts[i];
    // find the end of the statement; braces after a custom property name belong to its value
    let j = i;
    const custom = frame.node !== null && s.charCodeAt(stmtStart) === 45 && s.charCodeAt(stmtStart + 1) === 45 && /^--[^\s:;{}()]*\s*:/.test(s.slice(stmtStart, stmtStart + 256));
    for (;;) {
      while (j < count && type[j] !== OPEN && type[j] !== CLOSE && type[j] !== SEMI) j++;
      if (custom && j < count && type[j] === OPEN) {
        let d = 0;
        while (j < count) {
          if (type[j] === OPEN) d++;
          else if (type[j] === CLOSE && --d === 0) {
            j++;
            break;
          }
          j++;
        }
        continue;
      }
      break;
    }
    const term = j < count ? type[j] : 0;
    const ls = j > i ? lastSig(i, j) : -1;
    const sigEnd = ls >= 0 ? te[ls] : stmtStart;

    if (term === OPEN) {
      const open = ts[j];
      let node;
      if (s.charCodeAt(stmtStart) === 64) {
        let q = stmtStart + 1;
        while (q < sigEnd && isIdentCode(s.charCodeAt(q))) q++;
        const name = s.slice(stmtStart + 1, q).toLowerCase();
        const ps = skipTrivia(s, q, sigEnd);
        node = {
          type: "at", name, prelude: stripComments(s.slice(ps, sigEnd)), preludeStart: ps, preludeEnd: Math.max(ps, sigEnd),
          block: { start: open + 1, end: n }, start: stmtStart, end: n, rules: [], decls: [],
          parent: frame.node && frame.node.type === "at" ? frame.node : null,
          outer: frame.node && frame.node.type === "style" ? frame.node : null,
        };
      } else {
        const selStart = j > i ? stmtStart : open;
        const selEnd = j > i ? sigEnd : open;
        node = {
          type: "style", selector: stripComments(s.slice(selStart, selEnd)), selectorStart: selStart, selectorEnd: selEnd,
          block: { start: open + 1, end: n }, start: selStart, end: n, decls: [],
          parent: frame.node && frame.node.type === "at" ? frame.node : null,
          outer: frame.node && frame.node.type === "style" ? frame.node : null, rules: [],
        };
      }
      frame.rules.push(node);
      frames.push({ node, rules: node.rules, decls: node.decls });
      i = j + 1;
      continue;
    }

    // statement ended by ';', '}' or the end of the file
    const hasSemi = term === SEMI;
    if (s.charCodeAt(stmtStart) === 64) {
      let q = stmtStart + 1;
      while (q < sigEnd && isIdentCode(s.charCodeAt(q))) q++;
      const ps = skipTrivia(s, q, sigEnd);
      frame.rules.push({
        type: "at", name: s.slice(stmtStart + 1, q).toLowerCase(), prelude: stripComments(s.slice(ps, sigEnd)), preludeStart: ps,
        preludeEnd: Math.max(ps, sigEnd), block: null, start: stmtStart, end: hasSemi ? ts[j] + 1 : sigEnd, rules: [], decls: [],
        parent: frame.node && frame.node.type === "at" ? frame.node : null,
        outer: frame.node && frame.node.type === "style" ? frame.node : null,
      });
    } else if (frame.node === null) {
      diag("warning", "css/invalid-statement", "Declarations are not allowed outside of a rule.", stmtStart, Math.max(stmtStart, sigEnd));
    } else {
      // declaration: find the first ':' in a text token
      let colon = -1;
      for (let k = i; k < j; k++) {
        if (type[k] !== TEXT) continue;
        const idx = s.indexOf(":", ts[k]);
        if (idx >= 0 && idx < te[k]) {
          colon = idx;
          break;
        }
      }
      let nameEnd = colon;
      while (nameEnd > stmtStart && isWsCode(s.charCodeAt(nameEnd - 1))) nameEnd--;
      if (colon < 0 || nameEnd <= stmtStart || /\s/.test(s.slice(stmtStart, nameEnd))) {
        diag("warning", "css/invalid-declaration", "This declaration has no valid property name or colon.", stmtStart, Math.max(stmtStart, sigEnd));
      } else {
        const valueStart = skipTrivia(s, colon + 1, sigEnd);
        let ve = Math.max(valueStart, sigEnd);
        const rawEnd = ve;
        let important = false;
        if (ve - valueStart >= 9 && s.substr(ve - 9, 9).toLowerCase() === "important") {
          let b = ve - 9;
          while (b > valueStart && isWsCode(s.charCodeAt(b - 1))) b--;
          if (b > valueStart && s.charCodeAt(b - 1) === 33) {
            important = true;
            ve = b - 1;
            while (ve > valueStart && isWsCode(s.charCodeAt(ve - 1))) ve--;
          }
        }
        const name = s.slice(stmtStart, nameEnd);
        const decl = {
          prop: name.startsWith("--") ? name : name.toLowerCase(), value: stripComments(s.slice(valueStart, ve)), important,
          start: stmtStart, end: hasSemi ? ts[j] + 1 : rawEnd, nameStart: stmtStart, nameEnd, valueStart, valueEnd: ve,
        };
        frame.decls.push(decl);
      }
    }
    i = hasSemi ? j + 1 : j;
  }

  for (let k = frames.length - 1; k >= 1; k--) {
    const node = frames[k].node;
    diag("error", "css/unbalanced-brace", "This opening brace is never closed.", node.block.start - 1, node.block.start);
  }
  return { source: s, rules, errors };
}

/** Skips whitespace and comments in [from, to). */
function skipTrivia(s, from, to) {
  let q = from;
  for (;;) {
    while (q < to && isWsCode(s.charCodeAt(q))) q++;
    if (q + 1 < to && s.charCodeAt(q) === 47 && s.charCodeAt(q + 1) === 42) {
      const e = s.indexOf("*/", q + 2);
      q = e < 0 ? to : Math.min(e + 2, to);
    } else break;
  }
  return q;
}

/**
 * Parses a bare declaration list such as the content of a style="" attribute. Offsets are relative to `text`.
 * @param {string} text
 * @returns {Decl[]}
 */
export function parseDeclarationList(text) {
  const t = String(text ?? "");
  const parsed = parseCss("x{" + t);
  const rule = parsed.rules[0];
  if (!rule || rule.type !== "style") return [];
  return rule.decls.map((d) => ({
    ...d, start: d.start - 2, end: d.end - 2, nameStart: d.nameStart - 2, nameEnd: d.nameEnd - 2, valueStart: d.valueStart - 2, valueEnd: d.valueEnd - 2,
  }));
}

// ------------------------------------------------------------------------------------------------ tree helpers

/**
 * All style rules, depth first (including those inside at-rules and nested style rules).
 * @param {ParsedCss} parsed
 * @returns {StyleRule[]}
 */
export function flattenRules(parsed) {
  const out = [];
  const stack = [[parsed.rules, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top[1] >= top[0].length) {
      stack.pop();
      continue;
    }
    const r = top[0][top[1]++];
    if (r.type === "style") out.push(r);
    if (r.rules.length) stack.push([r.rules, 0]);
  }
  return out;
}

/** Direct container of a rule: its parent at-rule, its outer style rule or null. */
export function containerOf(rule) {
  return rule.parent || rule.outer || null;
}

/**
 * Splits a selector list at top-level commas.
 * @param {string} selector
 * @returns {string[]}
 */
export function splitSelectorList(selector) {
  return splitSelectorListRaw(selector).filter(Boolean);
}

/** Like splitSelectorList but keeps empty members (an empty member makes the whole selector invalid). */
function splitSelectorListRaw(selector) {
  const s = String(selector ?? "");
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < s.length && s[i] !== c) i += s[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/**
 * Normalizes whitespace and combinator spacing so selectors can be compared: 'a>b ,c' becomes 'a > b, c'.
 * @param {string} selector
 * @returns {string}
 */
export function normalizeSelector(selector) {
  return splitSelectorList(stripComments(String(selector ?? ""))).map(normalizeComplex).join(", ");
}

function normalizeComplex(sel) {
  let out = "";
  let sp = false;
  let depth = 0;
  const n = sel.length;
  let i = 0;
  while (i < n) {
    const ch = sel[i];
    const code = sel.charCodeAt(i);
    if (isWsCode(code)) {
      sp = true;
      i++;
      continue;
    }
    if (ch === ",") {
      out = out.trimEnd() + ", ";
      sp = false;
      i++;
      continue;
    }
    if (ch === ")") {
      out = out.trimEnd() + ")";
      depth = Math.max(0, depth - 1);
      sp = false;
      i++;
      continue;
    }
    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      out = out.trimEnd();
      out += (out ? " " : "") + ch + " ";
      sp = false;
      i++;
      continue;
    }
    let tok;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && sel[j] !== ch) j += sel[j] === "\\" ? 2 : 1;
      tok = sel.slice(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (ch === "[") {
      let j = i + 1;
      while (j < n && sel[j] !== "]") {
        if (sel[j] === '"' || sel[j] === "'") {
          const q = sel[j++];
          while (j < n && sel[j] !== q) j += sel[j] === "\\" ? 2 : 1;
        }
        j++;
      }
      tok = sel.slice(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (ch === "(") {
      tok = "(";
      depth++;
      i++;
    } else {
      let j = i;
      while (j < n) {
        const d = sel[j];
        if (isWsCode(sel.charCodeAt(j)) || d === "," || d === "(" || d === ")" || d === "[" || d === '"' || d === "'") break;
        if (depth === 0 && (d === ">" || d === "+" || d === "~")) break;
        if (d === "\\") j++;
        j++;
      }
      if (j === i) j = i + 1;
      tok = sel.slice(i, Math.min(j, n));
      i = j;
    }
    if (sp && out !== "" && !out.endsWith(" ") && !out.endsWith("(")) out += " ";
    out += tok;
    sp = false;
  }
  return out.trim();
}

/** Unescapes CSS escapes in an identifier. */
export function unescapeCss(text) {
  return String(text).replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([\s\S])/g, (m, hex, ch) => {
    if (hex) {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
    }
    return ch;
  });
}

/** Escapes a string for use as a CSS identifier (class name). */
export function cssEscapeIdent(text) {
  const t = String(text);
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    const ch = t[i];
    if ((c >= 48 && c <= 57 && i === 0) || (c >= 48 && c <= 57 && i === 1 && t[0] === "-")) out += "\\" + c.toString(16) + " ";
    else if (isIdentCode(c) && !(i === 0 && ch === "-" && t.length === 1)) out += ch;
    else out += "\\" + ch;
  }
  return out;
}

/**
 * Finds `.class` tokens in selector text (outside strings, attribute selectors and comments).
 * @param {string} text
 * @returns {{ start: number, end: number, raw: string, name: string }[]}
 */
export function scanClassTokens(text) {
  const s = String(text);
  const n = s.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === "\\") i += 2;
    else if (c === "/" && s[i + 1] === "*") {
      const e = s.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < n && s[i] !== c) i += s[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "[") {
      i++;
      while (i < n && s[i] !== "]") {
        if (s[i] === '"' || s[i] === "'") {
          const q = s[i++];
          while (i < n && s[i] !== q) i += s[i] === "\\" ? 2 : 1;
        }
        i++;
      }
      i++;
    } else if (c === ".") {
      let j = i + 1;
      while (j < n) {
        const code = s.charCodeAt(j);
        if (s[j] === "\\") j += 2;
        else if (isIdentCode(code)) j++;
        else break;
      }
      if (j > i + 1) {
        const end = Math.min(j, n);
        const raw = s.slice(i + 1, end);
        out.push({ start: i + 1, end, raw, name: unescapeCss(raw) });
      }
      i = Math.max(j, i + 1);
    } else i++;
  }
  return out;
}

/**
 * Class names used in a selector, in order of appearance, without duplicates.
 * @param {string} selector
 * @returns {string[]}
 */
export function classesInSelector(selector) {
  const seen = new Set();
  for (const t of scanClassTokens(selector)) seen.add(t.name);
  return [...seen];
}

const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/**
 * Specificity [ids, classes, types] of a selector (the most specific member of a list).
 * @param {string} selector
 * @returns {[number, number, number]}
 */
export function selectorSpecificity(selector) {
  let best = [0, 0, 0];
  for (const part of splitSelectorList(stripComments(String(selector ?? "")))) {
    const sp = specificityOfComplex(part);
    if (sp[0] > best[0] || (sp[0] === best[0] && (sp[1] > best[1] || (sp[1] === best[1] && sp[2] > best[2])))) best = sp;
  }
  return /** @type {[number, number, number]} */ (best);
}

function specificityOfComplex(sel) {
  let a = 0;
  let b = 0;
  let c = 0;
  const n = sel.length;
  const ident = (from) => {
    let j = from;
    while (j < n) {
      if (sel[j] === "\\") j += 2;
      else if (isIdentCode(sel.charCodeAt(j))) j++;
      else break;
    }
    return Math.min(j, n);
  };
  const group = (from) => {
    // from points at '('; returns the index after the matching ')'
    let d = 0;
    let j = from;
    while (j < n) {
      const ch = sel[j];
      if (ch === "\\") j++;
      else if (ch === '"' || ch === "'") {
        j++;
        while (j < n && sel[j] !== ch) j += sel[j] === "\\" ? 2 : 1;
      } else if (ch === "(") d++;
      else if (ch === ")" && --d === 0) return j + 1;
      j++;
    }
    return n;
  };
  const add = (sp) => {
    a += sp[0];
    b += sp[1];
    c += sp[2];
  };
  let i = 0;
  while (i < n) {
    const ch = sel[i];
    if (ch === "#") {
      a++;
      i = ident(i + 1);
    } else if (ch === ".") {
      b++;
      i = ident(i + 1);
    } else if (ch === "[") {
      b++;
      let j = i + 1;
      while (j < n && sel[j] !== "]") {
        if (sel[j] === '"' || sel[j] === "'") {
          const q = sel[j++];
          while (j < n && sel[j] !== q) j += sel[j] === "\\" ? 2 : 1;
        }
        j++;
      }
      i = j + 1;
    } else if (ch === ":") {
      if (sel[i + 1] === ":") {
        c++;
        i = ident(i + 2);
        if (sel[i] === "(") i = group(i);
      } else {
        const e = ident(i + 1);
        const name = sel.slice(i + 1, e).toLowerCase();
        i = e;
        if (sel[i] === "(") {
          const g = group(i);
          const inner = sel.slice(i + 1, Math.max(i + 1, g - 1));
          if (name === "is" || name === "not" || name === "has" || name === "matches" || name === "-webkit-any" || name === "-moz-any") add(selectorSpecificity(inner));
          else if (name === "where") {
            /* zero */
          } else if (name === "nth-child" || name === "nth-last-child") {
            b++;
            const k = inner.search(/\sof\s/i);
            if (k >= 0) add(selectorSpecificity(inner.slice(k + 4)));
          } else b++;
          i = g;
        } else if (LEGACY_PSEUDO_ELEMENTS.has(name)) c++;
        else b++;
      }
    } else if (ch === "\\" || isIdentCode(sel.charCodeAt(i))) {
      c++;
      i = Math.max(ident(i), i + 1);
      if (sel[i] === "|" && sel[i + 1] !== "=") i++;
    } else i++;
  }
  return [a, b, c];
}

/**
 * Normalizes a media query prelude for comparison: lower-case, collapsed whitespace, '(feature: value)' spacing.
 * @param {string} prelude
 * @returns {string}
 */
export function normalizeMedia(prelude) {
  return stripComments(String(prelude ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s*,\s*/g, ", ")
    .toLowerCase();
}

/**
 * Innermost enclosing @media prelude (normalized) or null.
 * @param {CssRule} rule
 * @returns {string|null}
 */
export function mediaOf(rule) {
  for (let c = containerOf(rule); c; c = containerOf(c)) if (c.type === "at" && c.name === "media") return normalizeMedia(c.prelude);
  return null;
}

/**
 * Reads a width-based media query (px only). `other` is true when the query contains anything else.
 * @param {string} prelude
 * @returns {{ minWidth: number|null, maxWidth: number|null, other: boolean }}
 */
export function parseMediaQuery(prelude) {
  const t = normalizeMedia(prelude);
  const res = { minWidth: null, maxWidth: null, other: false };
  if (!t || t.includes(",") || /^(not|only)\b/.test(t)) {
    res.other = true;
    return res;
  }
  for (const part of t.split(/\s+and\s+/)) {
    let m = /^\((min|max)-width: (-?\d*\.?\d+)(px)?\)$/.exec(part);
    if (m && (m[3] || Number(m[2]) === 0)) {
      if (m[1] === "min") res.minWidth = Number(m[2]);
      else res.maxWidth = Number(m[2]);
      continue;
    }
    m = /^\(width ?(<=|>=|<|>) ?(-?\d*\.?\d+)px\)$/.exec(part);
    if (m) {
      if (m[1][0] === "<") res.maxWidth = Number(m[2]);
      else res.minWidth = Number(m[2]);
      continue;
    }
    res.other = true;
  }
  return res;
}

// ------------------------------------------------------------------------------------------------ url() and @import

/**
 * Finds url(...) tokens outside comments and strings.
 * @param {string} source
 * @returns {{ start: number, end: number, url: string, urlStart: number, urlEnd: number, quote: '"'|"'"|'' }[]}
 */
export function cssUrls(source) {
  const s = String(source ?? "");
  const n = s.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 47 && s.charCodeAt(i + 1) === 42) {
      const e = s.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === 34 || c === 39) {
      i++;
      while (i < n && s.charCodeAt(i) !== c && s.charCodeAt(i) !== 10) i += s.charCodeAt(i) === 92 ? 2 : 1;
      i++;
    } else if (c === 92) i += 2;
    else if ((c === 117 || c === 85) && s.substr(i, 4).toLowerCase() === "url(" && (i === 0 || !isIdentCode(s.charCodeAt(i - 1)))) {
      let p = i + 4;
      while (p < n && isWsCode(s.charCodeAt(p))) p++;
      const q = s.charCodeAt(p);
      let urlStart;
      let urlEnd;
      let quote = "";
      if (q === 34 || q === 39) {
        quote = q === 34 ? '"' : "'";
        urlStart = p + 1;
        let j = urlStart;
        while (j < n && s.charCodeAt(j) !== q && s.charCodeAt(j) !== 10) j += s.charCodeAt(j) === 92 ? 2 : 1;
        urlEnd = Math.min(j, n);
        p = urlEnd + 1;
      } else {
        urlStart = p;
        let j = p;
        while (j < n && !isWsCode(s.charCodeAt(j)) && s.charCodeAt(j) !== 41) j += s.charCodeAt(j) === 92 ? 2 : 1;
        urlEnd = Math.min(j, n);
        p = urlEnd;
      }
      while (p < n && isWsCode(s.charCodeAt(p))) p++;
      if (s.charCodeAt(p) === 41) {
        const raw = s.slice(urlStart, urlEnd);
        out.push({ start: i, end: p + 1, url: quote ? unescapeCss(raw) : raw, urlStart, urlEnd, quote });
        i = p + 1;
      } else i += 4;
    } else i++;
  }
  return out;
}

/**
 * Splits the prelude of an @import rule into its URL and the remaining conditions (media, layer, supports).
 * @param {string} prelude
 * @returns {{ url: string, rest: string }|null}
 */
export function parseImport(prelude) {
  const p = String(prelude ?? "").trim();
  if (!p) return null;
  const q = p.charCodeAt(0);
  if (q === 34 || q === 39) {
    let j = 1;
    while (j < p.length && p.charCodeAt(j) !== q) j += p.charCodeAt(j) === 92 ? 2 : 1;
    return { url: unescapeCss(p.slice(1, j)), rest: p.slice(j + 1).trim() };
  }
  const u = cssUrls(p)[0];
  if (u && u.start === 0) return { url: u.url, rest: p.slice(u.end).trim() };
  return null;
}

// ------------------------------------------------------------------------------------------------ formatter

const CUSTOM_START = /^\s*--[^\s:;{}()]*\s*:/;

/** Index of the CLOSE token that matches the OPEN token at k (the last token when the block is never closed). */
function matchingClose(type, count, k) {
  let d = 0;
  for (let j = k; j < count; j++) {
    if (type[j] === OPEN) d++;
    else if (type[j] === CLOSE && --d === 0) return j;
  }
  return count - 1;
}

/** Splits a statement at the first top-level ':' outside strings and parentheses. -1 when absent. */
function topLevelColon(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

/** Applies `fn` to the parts of `text` outside strings and comments. */
function outside(text, fn) {
  let out = "";
  let last = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    let end = -1;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      end = Math.min(j + 1, n);
    } else if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      end = e < 0 ? n : e + 2;
    } else if (c === "\\") {
      i += 2;
      continue;
    }
    if (end >= 0) {
      out += fn(text.slice(last, i)) + text.slice(i, end);
      last = i = end;
    } else i++;
  }
  return out + fn(text.slice(last));
}

// The statement buffers handed to these two functions already have whitespace collapsed outside strings.
function formatPrelude(text) {
  let t = outside(trimCss(text), (x) => x.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")"));
  if (/^@(media|container|supports)\b/i.test(t) && !/selector\(/i.test(t)) t = outside(t, (x) => x.replace(/\(\s*([a-zA-Z-]+)\s*:\s*/g, "($1: "));
  return t;
}

function formatDeclText(text) {
  const t = trimCss(text);
  if (t.startsWith("@")) return t;
  const c = topLevelColon(t);
  if (c < 0) return t;
  const prop = t.slice(0, c).trim();
  let value = trimCss(t.slice(c + 1)).replace(/\s*!\s*important\s*$/i, " !important");
  value = outside(value, (x) => x.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")"));
  return value ? `${prop}: ${value}` : `${prop}:`;
}

/**
 * Pretty prints CSS: one declaration per line, a blank line between rules, comments kept.
 * @param {string} source
 * @param {{ indent?: string }} [options]
 * @returns {string}
 */
export function formatCss(source, { indent = "  " } = {}) {
  const s = String(source ?? "");
  const { type, ts, te, count } = lex(s);
  const lines = [];
  let depth = 0;
  let buf = "";
  let last = "start"; // start | open | decl | rule-end | comment | stmt
  let nl = 0; // newlines seen since the previous emitted item
  const pad = () => indent.repeat(Math.min(depth, 24));
  const gap = (kind) => {
    if (last === "start" || last === "open") return;
    if (last === "comment" && nl <= 1) return;
    if (kind === "rule" || last === "rule-end") lines.push("");
    else if (nl >= 2) lines.push("");
  };
  const emitStatement = (text, withSemi) => {
    const stmt = formatDeclText(text);
    if (!stmt) return;
    const kind = stmt.startsWith("@") ? "stmt" : "decl";
    gap(kind);
    lines.push(pad() + stmt + (withSemi ? ";" : ""));
    last = kind;
    nl = 0;
  };
  for (let k = 0; k < count; k++) {
    const t = type[k];
    const text = s.slice(ts[k], te[k]);
    if (t === WS) {
      if (buf) buf += " ";
      else for (let q = 0; q < text.length; q++) if (text.charCodeAt(q) === 10) nl++;
    } else if (t === COMMENT) {
      if (buf) {
        buf += text;
        continue;
      }
      const single = text.indexOf("\n") < 0;
      if (single && nl === 0 && lines.length && (last === "decl" || last === "open" || last === "rule-end" || last === "stmt")) {
        lines[lines.length - 1] += " " + text;
      } else {
        gap("comment");
        lines.push(pad() + text.replace(/[ \t]+$/gm, ""));
      }
      last = "comment";
      nl = 0;
    } else if (t === TEXT || t === STRING) {
      if ((t === TEXT && (text === "<!--" || text === "-->")) && !buf) continue;
      buf += text;
    } else if (t === OPEN) {
      if (depth > 0 && CUSTOM_START.test(buf)) {
        // braces inside a custom property value belong to the value
        const m = matchingClose(type, count, k);
        buf += s.slice(ts[k], te[m]);
        k = m;
        continue;
      }
      const prelude = trimCss(buf);
      buf = "";
      gap("rule");
      if (prelude.startsWith("@")) lines.push(pad() + formatPrelude(prelude) + " {");
      else {
        const raw = splitSelectorListRaw(prelude);
        // an empty member invalidates the selector in browsers: keep the text as written instead of repairing it
        const sels = raw.some((x) => x === "") ? [prelude] : raw.map(normalizeComplex);
        const joined = sels.length ? sels.join(",\n" + pad()) : "";
        lines.push(pad() + (joined ? joined + " {" : "{"));
      }
      depth++;
      last = "open";
      nl = 0;
    } else if (t === SEMI) {
      const stmt = trimCss(buf);
      buf = "";
      if (stmt) emitStatement(stmt, true);
    } else if (t === CLOSE) {
      const stmt = trimCss(buf);
      buf = "";
      if (stmt) emitStatement(stmt, true);
      depth = Math.max(0, depth - 1);
      if (last === "open") lines[lines.length - 1] += "}"; // empty block: keep '{' and '}' together
      else lines.push(pad() + "}");
      last = "rule-end";
      nl = 0;
    }
  }
  if (buf.trim()) emitStatement(trimCss(buf), depth > 0);
  return lines.join("\n") + (lines.length ? "\n" : "");
}

// ------------------------------------------------------------------------------------------------ minifier

/** Removes whitespace that is never significant: around commas, after '(' and before ')', before '!'. Strings are kept. */
function squeeze(text, extraBefore = "", extraAfter = "") {
  let out = "";
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (c === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
    } else if (isWsCode(text.charCodeAt(i))) {
      let j = i + 1;
      while (j < n && isWsCode(text.charCodeAt(j))) j++;
      const prev = out[out.length - 1];
      const next = text[j];
      const drop = !prev || next === undefined || prev === "," || prev === "(" || next === "," || next === ")" || next === "!" ||
        (extraBefore && extraBefore.includes(next)) || (extraAfter && extraAfter.includes(prev));
      if (!drop) out += " ";
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function minDecl(text) {
  const t = trimCss(text);
  if (t.startsWith("@")) return squeeze(t);
  const c = topLevelColon(t);
  if (c < 0) return squeeze(t);
  const prop = t.slice(0, c).trim();
  let value = squeeze(t.slice(c + 1)).replace(/\s*!\s*important$/i, "!important");
  if (prop.startsWith("--")) value = t.slice(c + 1).trim().replace(/\s+/g, " ");
  return prop + ":" + value;
}

/** True when the last character of `text` is escaped by an odd number of backslashes. */
function endsEscaped(text) {
  let n = 0;
  for (let i = text.length - 2; i >= 0 && text[i] === "\\"; i--) n++;
  return n % 2 === 1;
}

function minPrelude(text) {
  const t = trimCss(text);
  if (t.startsWith("@")) {
    let r = squeeze(t);
    if (/^@(media|container|supports)\b/i.test(r) && !/selector\(/i.test(r)) r = outside(r, (x) => x.replace(/\(\s*([a-zA-Z-]+)\s*:\s*/g, "($1:"));
    return r;
  }
  return squeeze(t, ">+~", ">+~");
}

/**
 * Removes comments and insignificant whitespace. Strings, url(), custom property values and calc() operators are preserved.
 * @param {string} source
 * @returns {string}
 */
export function minifyCss(source) {
  const s = String(source ?? "");
  const { type, ts, te, count } = lex(s);
  const out = [];
  let buf = "";
  let bufSpace = false; // buf ends with a space (kept as a flag: endsWith would flatten the string every time)
  let depth = 0;
  let pendingSemi = false; // the last piece ends with a terminator that is dropped before a closing brace
  const flushDecl = (semi) => {
    const stmt = minDecl(buf);
    buf = "";
    bufSpace = false;
    if (stmt) {
      out.push(semi ? stmt + ";" : stmt);
      pendingSemi = semi;
    }
  };
  for (let k = 0; k < count; k++) {
    const t = type[k];
    if (t === WS || t === COMMENT) {
      if (buf && !bufSpace) {
        buf += " ";
        bufSpace = true;
      }
    } else if (t === TEXT || t === STRING) {
      const text = s.slice(ts[k], te[k]);
      if (t === TEXT && (text === "<!--" || text === "-->") && !buf.trim()) continue;
      buf += text;
      bufSpace = false;
    } else if (t === OPEN) {
      if (depth > 0 && CUSTOM_START.test(buf)) {
        const m = matchingClose(type, count, k);
        buf += s.slice(ts[k], te[m]);
        bufSpace = false;
        k = m;
        continue;
      }
      depth++;
      out.push(minPrelude(buf) + "{");
      buf = "";
      bufSpace = false;
      pendingSemi = false;
    } else if (t === SEMI) {
      if (buf.trim()) flushDecl(true);
      buf = "";
      bufSpace = false;
    } else if (t === CLOSE) {
      depth = Math.max(0, depth - 1);
      if (buf.trim()) flushDecl(false);
      buf = "";
      bufSpace = false;
      if (pendingSemi && out.length) out[out.length - 1] = out[out.length - 1].slice(0, -1);
      out.push("}");
      pendingSemi = false;
    }
  }
  if (buf.trim()) flushDecl(false);
  return out.join("");
}

/** trim() that keeps a whitespace character that is escaped by a trailing backslash (`.a\ ` is a class name). */
function trimCss(text) {
  const head = text.trimStart();
  const t = head.trimEnd();
  if (t.length < head.length) {
    let n = 0;
    for (let i = t.length - 1; i >= 0 && t[i] === "\\"; i--) n++;
    if (n % 2 === 1) return t + head[t.length];
  }
  return t;
}
