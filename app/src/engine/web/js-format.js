// JavaScript beautifier and minifier of the Code studio. Pure, no dependencies, no AST: a tokenizer that knows strings,
// template literals (with nested ${}), comments, regex literals and numbers, and a printer that only changes the
// whitespace between tokens.
//
// Public API
//   tokenizeJs(source)            [{ t, v, nl, ws }]  t: word | str | tmpl | regex | line | block | punct; nl = newlines
//                                 before the token, ws = any whitespace before it
//   beautifyJs(source, opts)      formatted text, or null when the result could not be proven safe (the caller falls back
//                                 to re-indenting)
//   minifyJs(source, opts)        minified text, or null when unsafe
//
// Safety rules, checked after printing by re-tokenizing the output (any difference returns null):
//   * the sequence of tokens is unchanged (only string quotes may change, and only when the body has no quote at all);
//   * a newline between two tokens in the source stays a newline (so automatic semicolon insertion, `return` and
//     postfix `++` keep their meaning); the beautifier only adds newlines after `;`, `{`, `,` in broken objects and
//     around `}`, where a line break never changes the program.
// Options (beautify): indentUnit ("  "), lineWidth (100), jsBraceStyle ("collapse" | "allman"), jsQuote ("keep" |
// "double" | "single"), jsSpaceBeforeFunctionParen (false), jsObjectInline (true: short objects stay on one line),
// maxBlankLines (1), baseDepth (0). Options (minify): keepLicense (true: /*! ... */ and @license comments stay).

const KEYWORDS = new Set("break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield await async of static get set".split(" "));
const BEFORE_EXPR = new Set("return typeof instanceof in of new delete void throw case do else yield await extends".split(" "));
const CONTROL = new Set("if for while switch catch with".split(" "));
const PUNCT = [">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"];
const isIdStart = (c) => /[A-Za-z_$\u00c0-\uffff\\]/.test(c);
const isId = (c) => /[\w$\u00c0-\uffff\\]/.test(c);
const isDigit = (c) => c >= "0" && c <= "9";

/**
 * @param {string} source
 * @returns {{ t: string, v: string, nl: number, ws: boolean }[] | null} null for input it cannot tokenize safely
 */
export function tokenizeJs(source) {
  const s = String(source ?? "").replace(/\r\n?/g, "\n");
  const n = s.length;
  const FAIL = -2;

  /** End of a quoted string starting at i (index after the closing quote), or -1. */
  const strEnd = (i) => {
    const q = s[i];
    let j = i + 1;
    while (j < n && s[j] !== q) {
      if (s[j] === "\\") j++;
      else if (s[j] === "\n") return -1;
      j++;
    }
    return j < n ? j + 1 : -1;
  };
  /** End of a template literal starting at i; every ${ } inside is lexed like code (regex literals included). */
  const tmplEnd = (i) => {
    let j = i + 1;
    while (j < n) {
      const c = s[j];
      if (c === "\\") j += 2;
      else if (c === "`") return j + 1;
      else if (c === "$" && s[j + 1] === "{") {
        const e = lex(j + 2, [], true);
        if (e < 0) return -1;
        j = e + 1;
      } else j++;
    }
    return -1;
  };

  /**
   * Lexes from `start` into `out`. Top level: returns n, or FAIL. Nested (inside ${ }): returns the index of the closing
   * brace, or FAIL.
   */
  function lex(start, out, nested) {
    let i = start;
    let nl = 0;
    let ws = false;
    let depth = 0;
    const prevSig = () => {
      for (let k = out.length - 1; k >= 0; k--) if (out[k].t !== "line" && out[k].t !== "block") return out[k];
      return null;
    };
    const push = (t, v) => {
      out.push({ t, v, nl, ws });
      nl = 0;
      ws = false;
    };
    while (i < n) {
      const c = s[i];
      if (c === "\n") {
        nl++;
        ws = true;
        i++;
        continue;
      }
      if (c === " " || c === " ") return FAIL; // line terminators we do not track: leave such files alone
      if (c === " " || c === "\t" || c === "\f" || c === "\v" || c === " " || c === "﻿") {
        ws = true;
        i++;
        continue;
      }
      if (c === "/" && s[i + 1] === "/") {
        const e = s.indexOf("\n", i);
        const end = e < 0 ? n : e;
        push("line", s.slice(i, end).replace(/[ \t]+$/, ""));
        i = end;
        continue;
      }
      if (c === "/" && s[i + 1] === "*") {
        const e = s.indexOf("*/", i + 2);
        if (e < 0) return FAIL;
        push("block", s.slice(i, e + 2));
        i = e + 2;
        continue;
      }
      if (c === "<" && s.startsWith("<!--", i)) return FAIL; // HTML-like comments: not worth the risk
      if (c === '"' || c === "'") {
        const e = strEnd(i);
        if (e < 0) return FAIL;
        push("str", s.slice(i, e));
        i = e;
        continue;
      }
      if (c === "`") {
        const e = tmplEnd(i);
        if (e < 0) return FAIL;
        push("tmpl", s.slice(i, e));
        i = e;
        continue;
      }
      if (isDigit(c) || (c === "." && isDigit(s[i + 1] || ""))) {
        let j = i + 1;
        while (j < n && (isId(s[j]) || s[j] === "." || ((s[j] === "+" || s[j] === "-") && /[eE]/.test(s[j - 1]) && !/^0[xX]/.test(s.slice(i, j))))) j++;
        push("word", s.slice(i, j));
        i = j;
        continue;
      }
      if (isIdStart(c) || (c === "#" && isIdStart(s[i + 1] || ""))) {
        let j = i + 1;
        while (j < n && isId(s[j])) j++;
        push("word", s.slice(i, j));
        i = j;
        continue;
      }
      if (c === "/") {
        const p = prevSig();
        const regexOk = !p || (p.t === "punct" && p.v !== ")" && p.v !== "]" && p.v !== "}" && p.v !== "++" && p.v !== "--") || (p.t === "word" && BEFORE_EXPR.has(p.v)) || (p.t === "punct" && p.v === "}" && !nested);
        if (regexOk) {
          let j = i + 1;
          let cls = false;
          let ok = false;
          while (j < n && s[j] !== "\n") {
            if (s[j] === "\\") j++;
            else if (s[j] === "[") cls = true;
            else if (s[j] === "]") cls = false;
            else if (s[j] === "/" && !cls) {
              ok = true;
              break;
            }
            j++;
          }
          if (!ok) return FAIL;
          j++;
          while (j < n && isId(s[j])) j++;
          push("regex", s.slice(i, j));
          i = j;
          continue;
        }
      }
      let p = PUNCT.find((x) => s.startsWith(x, i));
      if (p === "?." && isDigit(s[i + 2] || "")) p = undefined; // a?.5:1 is a ternary
      p ||= c;
      if (nested && p === "}" && depth === 0) return i;
      if (p === "{") depth++;
      else if (p === "}") depth--;
      push("punct", p);
      i += p.length;
    }
    if (nested) return FAIL;
    if (nl && out.length) out.push({ t: "eof", v: "", nl, ws: true });
    return n;
  }

  const out = [];
  return lex(0, out, false) === FAIL ? null : out;
}

const sig = (tokens) => tokens.filter((t) => t.t !== "eof");

/** Token values for the safety check: string bodies without their quotes when quotes may have changed. */
function shape(tokens, dropComments) {
  const out = [];
  for (const t of sig(tokens)) {
    if (dropComments && (t.t === "line" || t.t === "block")) continue;
    out.push(t.t === "str" ? `s:${t.v.slice(1, -1)}` : `${t.t}:${t.v}`);
  }
  return out;
}

function sameProgram(a, b, dropComments) {
  const x = shape(a, dropComments);
  const y = shape(b, dropComments);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  // every newline between two tokens of the source is still there (comments may move only with their newlines)
  const keepA = sig(a).filter((t) => !dropComments || (t.t !== "line" && t.t !== "block"));
  const keepB = sig(b).filter((t) => !dropComments || (t.t !== "line" && t.t !== "block"));
  if (dropComments) return true; // minify: newline preservation is checked while printing
  for (let i = 1; i < keepA.length; i++) if (keepA[i].nl && !keepB[i].nl) return false;
  return true;
}

const isBinary = (v) => /^(?:[-+*/%=&|^<>!?:]|\*\*|<<|>>>?|[!=]==?|[<>]=|&&|\|\||\?\?|=>|[-+*/%&|^]=|\*\*=|<<=|>>>?=|&&=|\|\|=|\?\?=|instanceof|in|of)$/.test(v);

/**
 * Pretty prints JavaScript. Returns null when the source cannot be tokenized or the result fails the safety check.
 * @param {string} source
 * @param {object} [opts]
 * @returns {string | null}
 */
export function beautifyJs(source, opts = {}) {
  const unit = opts.indentUnit ?? "  ";
  const width = opts.lineWidth || 100;
  const allman = opts.jsBraceStyle === "allman";
  const quote = opts.jsQuote || "keep";
  const fnSpace = !!opts.jsSpaceBeforeFunctionParen;
  const inlineObjects = opts.jsObjectInline !== false;
  const maxBlank = Math.max(0, Math.min(3, opts.maxBlankLines ?? 1));
  const base = opts.baseDepth || 0;
  const toks = tokenizeJs(source);
  if (!toks) return null;
  const tokens = sig(toks);
  if (!tokens.length) return "";

  const lines = [];
  let line = "";
  let lineIndent = base;
  let started = false; // something is written on the current line
  let pendingIndent = null; // indentation of the next line when it differs from the frame's
  let rootTernary = 0;
  /** @type {{ kind: string, inner: number, broken: boolean, empty: boolean, ternary: number, isDo: boolean, inCase: boolean }[]} */
  const frames = [];
  const top = () => frames[frames.length - 1];
  const pad = (d) => unit.repeat(Math.max(0, d));
  const curIndent = () => (top() ? top().inner + (top().inCase ? 1 : 0) : base);
  const newline = (blank = 0) => {
    if (started) lines.push(pad(lineIndent) + line.replace(/\s+$/, ""));
    for (let b = 0; b < blank; b++) if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    line = "";
    started = false;
  };
  const write = (text, space) => {
    if (!started) {
      lineIndent = pendingIndent ?? curIndent();
      pendingIndent = null;
      line = text;
      started = true;
    } else line += (space ? " " : "") + text;
  };
  const matchClose = (k) => {
    let depth = 0;
    for (let j = k; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.t !== "punct") continue;
      if (t.v === "{" || t.v === "(" || t.v === "[") depth++;
      else if (t.v === "}" || t.v === ")" || t.v === "]") if (!--depth) return j;
    }
    return -1;
  };
  let caseColon = null; // the `:` token of the current `case`, after which `{` opens a block
  const isObjectBrace = (p) => {
    if (!p || p === caseColon) return false;
    if (p.t === "punct") return !/^(\)|=>|;|\{|\}|\])$/.test(p.v);
    return p.t === "word" && ((BEFORE_EXPR.has(p.v) && !/^(else|do|extends)$/.test(p.v)) || /^(import|export|const|let|var)$/.test(p.v));
  };
  const operand = (p) => !!p && ((p.t === "word" && !BEFORE_EXPR.has(p.v)) || p.t === "str" || p.t === "tmpl" || p.t === "regex" || (p.t === "punct" && /^[)\]}]$/.test(p.v)));
  const isCloser = (t) => t.t === "punct" && /^[)\]}]$/.test(t.v);

  let prev = null; // previous token that is not a comment
  let glue = false; // the previous token sticks to the next one (prefix operators, `.`, `(`, `...`)
  let starGen = false; // `function*` / `yield*`: a space after the star

  /** Space between `prev` and `tok` on the same line. */
  const spaceBefore = (tok, k) => {
    const v = tok.v;
    const pv = prev.t === "punct" ? prev.v : null;
    if (glue) return false;
    if (tok.t === "punct") {
      if (/^[,;)\]]$/.test(v) || v === "." || v === "?.") return false;
      if (v === "(") {
        if (prev.t === "word") {
          if (prev.v === "function") return true;
          if (tokens[k - 2]?.v === "function" || (tokens[k - 2]?.v === "*" && tokens[k - 3]?.v === "function")) return fnSpace;
          if (tokens[k - 2]?.v === "." || tokens[k - 2]?.v === "?.") return false; // promise.catch(), map.delete()
          return CONTROL.has(prev.v) || BEFORE_EXPR.has(prev.v) || prev.v === "async";
        }
        return !(pv === ")" || pv === "]" || prev.t === "str" || prev.t === "tmpl");
      }
      if (v === "[") return !(operand(prev) && pv !== "}") || (prev.t === "word" && KEYWORDS.has(prev.v) && prev.v !== "this" && prev.v !== "super");
      if ((v === "++" || v === "--") && operand(prev) && !tok.nl) return false; // postfix
      if (v === ":") {
        const f = top();
        if (f ? f.ternary > 0 : rootTernary > 0) {
          if (f) f.ternary--;
          else rootTernary--;
          return true;
        }
        return false;
      }
      if (v === "*" && prev.t === "word" && (prev.v === "function" || prev.v === "yield")) return false;
      return true;
    }
    if (pv === "#" || pv === "@") return false;
    if (tok.t === "tmpl" && prev.t === "word" && !KEYWORDS.has(prev.v)) return tok.ws; // tagged template
    return true;
  };

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    const next = tokens[k + 1];
    let v = tok.v;
    // a structural line break waits for a comment that follows on the same source line
    const breakLine = () => (next && next.t === "line" && !next.nl ? undefined : newline());

    // newlines kept from the source
    if (tok.nl) {
      const afterOpen = prev && prev.t === "punct" && /^[{([]$/.test(prev.v);
      const blank = afterOpen || isCloser(tok) ? 0 : Math.min(maxBlank, tok.nl - 1);
      if (started) {
        newline(blank);
        const f = top();
        const startsCont = tok.t === "punct" && (v === "." || v === "?." || (isBinary(v) && v !== "!" && !(v === ":" && f && f.kind === "object" && !f.ternary)));
        const endsCont = prev && prev !== caseColon && !(prev.v === ":" && f?.kind === "object") && ((prev.t === "punct" && isBinary(prev.v)) || (prev.t === "word" && BEFORE_EXPR.has(prev.v) && prev.v !== "else" && prev.v !== "do"));
        if ((startsCont || endsCont) && !isCloser(tok)) pendingIndent = curIndent() + 1;
      } else if (lines.length) for (let b = 0; b < blank; b++) if (lines[lines.length - 1] !== "") lines.push("");
    }

    if (tok.t === "line") {
      write(v, true);
      newline();
      continue;
    }
    if (tok.t === "block") {
      write(v, started);
      if (next?.nl) newline();
      continue;
    }
    if (tok.t === "str" && quote !== "keep") {
      const body = v.slice(1, -1);
      const q = quote === "double" ? '"' : "'";
      if (!/["'\\]/.test(body) && v[0] !== q) v = q + body + q;
    }

    // closing brackets
    if (isCloser(tok)) {
      const f = frames.pop();
      const multi = !!f && (f.kind === "block" ? !f.empty : f.broken);
      if (multi && started) newline();
      if (!started) pendingIndent = f ? f.inner - 1 : base;
      write(v, !!f && f.kind === "object" && !f.broken && !f.empty);
      prev = tok;
      glue = false;
      starGen = false;
      if (f && f.kind === "block" && v === "}" && next) {
        const attach = next.t === "punct" && /^([)\],;.]|\?\.)$/.test(next.v);
        const sameLine = !allman && next.t === "word" && (/^(else|catch|finally)$/.test(next.v) || (next.v === "while" && f.isDo));
        if (!attach && !sameLine) breakLine();
      }
      continue;
    }

    const space = started && prev ? (starGen ? true : spaceBefore(tok, k)) : false;
    starGen = false;

    // `case x:` and `default:` start a level that their statements are indented in
    if (tok.t === "word" && (v === "case" || (v === "default" && next?.v === ":")) && !started && top()?.kind === "block") {
      top().inCase = true;
      pendingIndent = top().inner;
    }

    // opening brackets
    if (tok.t === "punct" && (v === "{" || v === "(" || v === "[")) {
      const close = matchClose(k);
      if (v === "{") {
        const object = isObjectBrace(prev);
        const empty = close === k + 1;
        if (!object && allman && started && !empty) newline(), (pendingIndent = lineIndent);
        write("{", space);
        const f = { kind: object ? "object" : "block", inner: lineIndent + 1, broken: false, empty, ternary: 0, isDo: prev?.v === "do", inCase: false };
        if (object && !empty) {
          let fits = inlineObjects && close > 0;
          let len = pad(lineIndent).length + line.length;
          for (let j = k + 1; fits && j <= close; j++) {
            const t = tokens[j];
            if (t.nl || t.t === "line" || t.t === "block" || t.v === "function" || (t.v === "{" && !isObjectBrace(tokens[j - 1]))) fits = false;
            len += t.v.length + 1;
          }
          f.broken = !fits || len > width;
        }
        frames.push(f);
        prev = tok;
        glue = false;
        if (f.kind === "block" ? !empty : f.broken) breakLine();
        continue;
      }
      write(v, space);
      frames.push({ kind: v === "(" ? "paren" : "array", inner: lineIndent + 1, broken: false, empty: close === k + 1, ternary: 0, isDo: false, inCase: false });
      prev = tok;
      glue = true;
      continue;
    }

    if (tok.t === "punct" && v === "?") {
      if (top()) top().ternary++;
      else rootTernary++;
    }
    write(v, space);
    const prefix = tok.t === "punct" && (v === "!" || v === "~" || v === "..." || v === "#" || v === "@" || v === "." || v === "?." || ((v === "++" || v === "--" || v === "+" || v === "-") && !(operand(prev) && !((v === "++" || v === "--") && tok.nl))));
    glue = prefix;
    if (tok.t === "punct" && v === "*" && prev?.t === "word" && (prev.v === "function" || prev.v === "yield")) starGen = true;
    const wasTernary = tok.t === "punct" && v === ":" && space;
    prev = tok;
    if (tok.t === "punct" && v === ";") {
      const f = top();
      if (!f || f.kind === "block") breakLine();
    } else if (tok.t === "punct" && v === "," && top()?.broken) breakLine();
    else if (tok.t === "punct" && v === ":" && !wasTernary && top()?.inCase && next && !next.nl && next.v !== "{") {
      // `case x: foo();` puts the statement on its own line
      const f = top();
      let j = k - 1;
      while (j >= 0 && !(tokens[j].t === "word" && (tokens[j].v === "case" || tokens[j].v === "default")) && tokens[j].v !== ";" && tokens[j].v !== "{" && tokens[j].v !== "}") j--;
      if (j >= 0 && tokens[j].t === "word" && f) breakLine();
    }
    if (tok.t === "punct" && v === ":" && !wasTernary && top()?.inCase) caseColon = tok;
  }
  newline();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const text = lines.join("\n") + "\n";
  const check = tokenizeJs(text);
  if (!check || !sameProgram(toks, check, false)) return null;
  return text;
}

const CAN_END = (t) => t.t === "word" || t.t === "str" || t.t === "tmpl" || t.t === "regex" || (t.t === "punct" && /^(\)|\]|\}|\+\+|--)$/.test(t.v));
const CAN_START = (t) => t.t === "word" || t.t === "str" || t.t === "tmpl" || t.t === "regex" || (t.t === "punct" && /^(\(|\[|\{|\+|-|!|~|\+\+|--|\/|@|#|\.\.\.|<)$/.test(t.v));

/**
 * Removes comments (except license comments with keepLicense) and whitespace. A source newline stays where both sides
 * could end and start a statement, so automatic semicolon insertion cannot change the program.
 * @returns {string | null}
 */
export function minifyJs(source, { keepLicense = true } = {}) {
  const toks = tokenizeJs(source);
  if (!toks) return null;
  let out = "";
  let prev = null;
  let pendingNl = false;
  for (const t of sig(toks)) {
    if (t.t === "line" || t.t === "block") {
      if (t.nl) pendingNl = true;
      if (keepLicense && t.t === "block" && /^\/\*!|@license|@preserve/.test(t.v)) {
        out += (out && !out.endsWith("\n") ? "\n" : "") + t.v + "\n";
        prev = null;
        pendingNl = false;
      }
      continue;
    }
    if (t.nl) pendingNl = true;
    if (prev) {
      const a = out[out.length - 1];
      const b = t.v[0];
      let sep = "";
      if (pendingNl && CAN_END(prev) && CAN_START(t)) sep = "\n";
      else if ((isId(a) && isId(b)) || (isDigit(a) && b === ".") || (prev.t === "word" && /^\d/.test(prev.v) && b === ".")) sep = " ";
      else if ((a === "+" && b === "+") || (a === "-" && b === "-") || (a === "/" && (b === "/" || b === "*")) || (a === "<" && b === "!") || (a === "-" && b === ">")) sep = " ";
      else if (/^\d+$/.test(prev.v) && t.v === ".") sep = " ";
      out += sep;
    }
    out += t.v;
    prev = t;
    pendingNl = false;
  }
  const check = tokenizeJs(out);
  if (!check || !sameProgram(toks, check, true)) return null;
  return out;
}
