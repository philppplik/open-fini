// TextMate grammars (contributes.grammars of VS Code extensions) as CodeMirror stream parsers: syntax highlighting
// for languages the Code studio has no mode for. Pure (no DOM), tested in tests/vscode/textmate.test.js.
//
// Public API
//   compileGrammar(json, { lookup? })   -> grammar | null    (lookup(scopeName) resolves `include: "source.x"`)
//   tokenizeLine(grammar, line, stack)  -> { tokens: [{ from, to, scope }], stack }
//   tmStreamParser(grammar)             -> a CodeMirror StreamParser ({ name, startState, token, copyState })
//   styleOfScope(scope)                 -> a CodeMirror highlight tag name ("keyword", "string", "variableName.function" …) or null
//
// What is supported: match rules with captures, begin/end rules (back-references from begin in end, contentName,
// beginCaptures/endCaptures), begin/while rules, `include` of #repository entries, $self, $base and other loaded
// grammars, nested patterns, the tie and priority rules of TextMate (earliest match wins, then rule order, the end
// pattern before inner patterns unless applyEndPatternLast). Oniguruma syntax is translated to JavaScript where it
// has an equivalent (\h, \A, \z, possessive quantifiers, atomic groups, POSIX classes, (?i)); a rule whose regular
// expression still cannot be compiled is skipped. Not supported: injections and injection grammars, \G anchoring
// across tokens (treated as "at the current position"), embedded languages of other extensions' grammars.
// Limits: 4000 rules per grammar, 2000 characters per tokenized line (the rest is left unstyled), 1000 matches per line.

const MAX_RULES = 4000;
const MAX_LINE = 2000;
const MAX_STEPS = 1000;

const POSIX = { alpha: "a-zA-Z", digit: "0-9", alnum: "a-zA-Z0-9", upper: "A-Z", lower: "a-z", space: "\\s", xdigit: "0-9A-Fa-f", word: "\\w", punct: "!-\\/:-@\\[-`{-~", blank: " \\t", cntrl: "\\x00-\\x1f", print: "\\x20-\\x7e", graph: "\\x21-\\x7e" };

/** Oniguruma -> JavaScript source, or null when it uses something JavaScript has no equivalent for. */
export function toJsRegex(src) {
  let s = String(src);
  let flags = "";
  if (s.startsWith("(?i)")) {
    flags = "i";
    s = s.slice(4);
  }
  // inline option changes in the middle, conditionals, \K, grapheme clusters, absent operators: no JavaScript equivalent
  if (/\(\?[imx-]+\)|\(\?\(|\\[KXRy]|\(\?~/.test(s.replace(/\\\\/g, ""))) return null;
  s = s
    .replace(/\\G/g, "")
    .replace(/\[\[:(\w+):\]\]/g, (m, n) => (POSIX[n] ? `[${POSIX[n]}]` : m))
    .replace(/\[:(\w+):\]/g, (m, n) => POSIX[n] || m)
    .replace(/\\h/g, "[0-9A-Fa-f]")
    .replace(/\\H/g, "[^0-9A-Fa-f]")
    .replace(/\\A/g, "^")
    .replace(/\\[zZ]/g, "$")
    .replace(/\(\?>/g, "(?:")
    .replace(/\(\?[imx]+(-[imx]+)?:/g, "(?:")
    .replace(/([*+?}])\+/g, "$1")
    .replace(/\\o\{([0-7]+)\}/g, (m, o) => `\\x${parseInt(o, 8).toString(16).padStart(2, "0")}`)
    .replace(/\\x\{([0-9a-fA-F]+)\}/g, (m, x) => `\\u{${x}}`);
  return { source: s, flags };
}

function compileRe(src) {
  const t = toJsRegex(src);
  if (!t) return null;
  for (const extra of ["u", ""]) {
    try {
      return new RegExp(t.source, `dg${t.flags}${extra}`);
    } catch {
      /* try without the unicode flag */
    }
  }
  return null;
}

/**
 * Compiles a TextMate grammar (the parsed .tmLanguage.json). Returns null when it has no usable patterns.
 * @param {object} json
 * @param {{ lookup?: (scopeName: string) => object | null }} [o]
 */
export function compileGrammar(json, { lookup = null } = {}) {
  if (!json || typeof json !== "object" || !Array.isArray(json.patterns)) return null;
  let count = 0;
  const repo = json.repository && typeof json.repository === "object" ? json.repository : {};
  const g = { scopeName: String(json.scopeName || ""), name: String(json.name || json.scopeName || "grammar"), root: null, lookup };
  const cache = new Map();
  const rule = (r) => {
    if (!r || typeof r !== "object") return null;
    if (cache.has(r)) return cache.get(r);
    if (++count > MAX_RULES) return null;
    const out = { name: typeof r.name === "string" ? r.name : null, contentName: typeof r.contentName === "string" ? r.contentName : null };
    cache.set(r, out);
    if (typeof r.include === "string") out.include = r.include;
    if (typeof r.match === "string") out.match = compileRe(r.match);
    else if (typeof r.begin === "string") {
      out.begin = compileRe(r.begin);
      out.endSrc = typeof r.end === "string" ? r.end : null;
      out.whileSrc = typeof r.while === "string" ? r.while : null;
      out.endLast = !!r.applyEndPatternLast;
      out.beginCaptures = captures(r.beginCaptures || r.captures);
      out.endCaptures = captures(r.endCaptures || r.captures);
      if (!out.begin || (!out.endSrc && !out.whileSrc)) out.begin = null;
    }
    out.captures = captures(r.captures);
    out.patterns = Array.isArray(r.patterns) ? r.patterns.map(rule).filter(Boolean) : [];
    if (!out.include && !out.match && !out.begin && !out.patterns.length) return out; // a name-only rule (a repository container)
    return out;
  };
  const captures = (c) => {
    if (!c || typeof c !== "object") return null;
    const out = [];
    for (const [k, v] of Object.entries(c)) if (/^\d+$/.test(k) && v && typeof v === "object") out[+k] = { name: typeof v.name === "string" ? v.name : null, patterns: Array.isArray(v.patterns) ? v.patterns.map(rule).filter(Boolean) : [] };
    return out;
  };
  g.repo = {};
  for (const [k, v] of Object.entries(repo)) g.repo[k] = rule(v);
  g.root = { patterns: json.patterns.map(rule).filter(Boolean) };
  return g.root.patterns.length ? g : null;
}

/** The match and begin rules a pattern list stands for (includes resolved, cycles cut). */
function flatten(g, patterns, seen = new Set(), out = [], depth = 0) {
  if (depth > 30) return out;
  for (const r of patterns) {
    if (r.include) {
      const inc = r.include;
      let target = null;
      let tg = g;
      if (inc.startsWith("#")) target = g.repo[inc.slice(1)];
      else if (inc === "$self" || inc === "$base") target = g.root;
      else if (g.lookup) {
        const [scope, frag] = inc.split("#");
        const other = g.lookup(scope);
        if (other) {
          tg = other;
          target = frag ? other.repo[frag] : other.root;
        }
      }
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (target.match || target.begin) out.push({ g: tg, r: target });
      else flatten(tg, target.patterns || [], seen, out, depth + 1);
      continue;
    }
    if (r.match || r.begin) out.push({ g, r });
    else if (r.patterns.length && !seen.has(r)) {
      seen.add(r);
      flatten(g, r.patterns, seen, out, depth + 1);
    }
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Pushes tokens for a match: the rule's scope with its capture groups on top. */
function emitMatch(tokens, m, base, caps, ctxScope) {
  const from = m.index;
  const to = m.index + m[0].length;
  if (to <= from) return;
  const scope = [ctxScope, base].filter(Boolean).join(" ");
  const parts = [];
  if (caps && m.indices) {
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      const span = m.indices[i];
      if (!c?.name || !span || span[1] <= span[0]) continue;
      parts.push({ from: span[0], to: span[1], scope: `${scope} ${c.name}` });
    }
  }
  parts.sort((a, b) => a.from - b.from || b.to - a.to);
  let p = from;
  for (const part of parts) {
    if (part.from < p) continue; // nested or overlapping capture: the outer one wins
    if (part.from > p) tokens.push({ from: p, to: part.from, scope });
    tokens.push({ from: part.from, to: Math.min(part.to, to), scope: part.scope });
    p = Math.min(part.to, to);
  }
  if (p < to) tokens.push({ from: p, to, scope });
}

/**
 * Tokenizes one line. `stack` is the list of open begin/end rules (from the previous line); returns the new stack.
 * @returns {{ tokens: { from: number, to: number, scope: string }[], stack: object[] }}
 */
export function tokenizeLine(g, line, stack = []) {
  const text = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
  const tokens = [];
  let st = stack.slice();
  // begin/while rules continue only while their `while` pattern matches at the start of the line
  for (let i = 0; i < st.length; i++) {
    if (!st[i].whileRe) continue;
    st[i].whileRe.lastIndex = 0;
    const m = st[i].whileRe.exec(text);
    if (!m || m.index !== 0) {
      st = st.slice(0, i);
      break;
    }
  }
  const ctxScope = () => st.map((f) => [f.r.name, f.r.contentName].filter(Boolean).join(" ")).filter(Boolean).join(" ");
  let pos = 0;
  let stalls = 0;
  for (let steps = 0; steps < MAX_STEPS && pos <= text.length; steps++) {
    const top = st[st.length - 1];
    const cands = flatten(top ? top.g : g, top ? top.r.patterns : g.root.patterns);
    let best = null;
    const consider = (m, kind, c) => {
      if (!m) return;
      if (!best || m.index < best.m.index || (m.index === best.m.index && kind === "end" && !top.r.endLast)) best = { m, kind, c };
    };
    let endM = null;
    if (top?.endRe) {
      top.endRe.lastIndex = pos;
      endM = top.endRe.exec(text);
    }
    if (endM && !top.r.endLast) consider(endM, "end");
    for (const c of cands) {
      const re = c.r.match || c.r.begin;
      re.lastIndex = pos;
      const m = re.exec(text);
      if (!m) continue;
      if (!best || m.index < best.m.index) best = { m, kind: c.r.match ? "match" : "begin", c };
      if (m.index === pos) break; // nothing can come earlier; earlier rules win ties
    }
    if (endM && top.r.endLast) consider(endM, "end");
    if (!best) break;
    const { m, kind, c } = best;
    const ctx = ctxScope();
    if (m.index > pos) tokens.push({ from: pos, to: m.index, scope: ctx });
    const end = m.index + m[0].length;
    if (kind === "match") {
      emitMatch(tokens, m, c.r.name, c.r.captures, ctx);
    } else if (kind === "begin") {
      emitMatch(tokens, m, c.r.name, c.r.beginCaptures, ctx);
      const sub = (src) => compileRe(src.replace(/\\(\d)/g, (x, n) => escapeRe(m[+n] ?? "")));
      const frame = { g: c.g, r: c.r, endRe: c.r.endSrc ? sub(c.r.endSrc) : null, whileRe: c.r.whileSrc ? sub(c.r.whileSrc) : null };
      if (frame.endRe || frame.whileRe) st.push(frame);
    } else {
      const ctxOuter = st.slice(0, -1).map((f) => [f.r.name, f.r.contentName].filter(Boolean).join(" ")).filter(Boolean).join(" ");
      emitMatch(tokens, m, top.r.name, top.r.endCaptures, ctxOuter);
      st.pop();
    }
    if (end === pos && (kind === "match" || ++stalls > 2)) {
      // an empty match that changes nothing (or empty begin/end pairs that keep cycling): step over one character so
      // the loop always advances
      if (pos < text.length) tokens.push({ from: pos, to: pos + 1, scope: ctx });
      pos++;
      stalls = 0;
      continue;
    }
    if (end > pos) stalls = 0;
    pos = end;
    if (pos >= text.length) break;
  }
  if (pos < line.length) tokens.push({ from: pos, to: line.length, scope: pos < text.length ? ctxScope() : "" });
  return { tokens: tokens.filter((t) => t.to > t.from), stack: st.slice(-64) };
}

// TextMate scope -> CodeMirror highlight tag, most specific first
const SCOPE_TAGS = [
  [/^comment/, "comment"],
  [/^punctuation\.definition\.comment/, "comment"],
  [/^string\.regexp/, "regexp"],
  [/^punctuation\.definition\.string/, "string"],
  [/^string/, "string"],
  [/^constant\.character\.escape/, "escape"],
  [/^constant\.numeric/, "number"],
  [/^constant\.language/, "bool"],
  [/^constant/, "atom"],
  [/^keyword\.operator/, "operator"],
  [/^keyword/, "keyword"],
  [/^storage\.type/, "keyword"],
  [/^storage/, "modifier"],
  [/^entity\.name\.function|^support\.function|^meta\.function-call\.generic|^variable\.function/, "variableName.function"],
  [/^entity\.name\.(type|class|struct|enum|interface|namespace)|^support\.(type|class)|^entity\.other\.inherited-class/, "typeName"],
  [/^entity\.name\.tag/, "tagName"],
  [/^entity\.other\.attribute-name/, "attributeName"],
  [/^entity\.name/, "variableName.definition"],
  [/^variable\.parameter/, "variableName"],
  [/^variable\.language/, "self"],
  [/^variable\.other\.(property|member)|^support\.variable\.property|^meta\.property-name|^support\.type\.property-name/, "propertyName"],
  [/^variable\.other\.constant/, "constant"],
  [/^variable/, "variableName"],
  [/^support\.constant/, "atom"],
  [/^support/, "variableName.standard"],
  [/^markup\.heading/, "heading"],
  [/^markup\.bold/, "strong"],
  [/^markup\.italic/, "emphasis"],
  [/^markup\.underline\.link|^markup\.link/, "link"],
  [/^markup\.(inline\.raw|fenced_code|raw)/, "monospace"],
  [/^markup\.quote/, "quote"],
  [/^markup\.(inserted)/, "inserted"],
  [/^markup\.(deleted)/, "deleted"],
  [/^markup\.list/, "list"],
  [/^invalid/, "invalid"],
  [/^punctuation\.(section|bracket)|^meta\.brace/, "bracket"],
  [/^punctuation/, "punctuation"],
];

/** The highlight tag of a (space-separated, innermost last) scope list, or null. */
export function styleOfScope(scope) {
  const list = String(scope || "").split(/\s+/).filter(Boolean);
  for (let i = list.length - 1; i >= 0; i--) for (const [re, tag] of SCOPE_TAGS) if (re.test(list[i])) return tag;
  return null;
}

/** A CodeMirror StreamParser that highlights with the grammar (one tokenizeLine call per line). */
export function tmStreamParser(g) {
  return {
    name: g.name,
    startState: () => ({ stack: [], tokens: null, i: 0 }),
    copyState: (s) => ({ stack: s.stack.slice(), tokens: s.tokens, i: s.i }),
    token(stream, state) {
      if (stream.sol() || !state.tokens) {
        const r = tokenizeLine(g, stream.string, state.stack);
        state.stack = r.stack;
        state.tokens = r.tokens;
        state.i = 0;
      }
      const t = state.tokens;
      while (state.i < t.length && t[state.i].to <= stream.pos) state.i++;
      const tok = t[state.i];
      if (!tok) {
        stream.skipToEnd();
        return null;
      }
      if (tok.from > stream.pos) {
        stream.pos = tok.from;
        return null;
      }
      stream.pos = tok.to;
      state.i++;
      return styleOfScope(tok.scope);
    },
    blankLine(state) {
      // a blank line still ends `while` rules and runs begin/end bookkeeping
      state.stack = tokenizeLine(g, "", state.stack).stack;
    },
  };
}
