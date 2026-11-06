// Built-in formatters of the Code studio: HTML, CSS, JavaScript, JSON and Markdown, without dependencies.
//
// Pure (no DOM). The formatters only change WHITESPACE where whitespace does not matter for the result:
//   * HTML: block-level structure is re-indented, runs of inline content are re-wrapped at spaces (a newline between
//     inline atoms equals a space), long start tags wrap one attribute per line. `<pre>`, `<textarea>`, `<title>`,
//     comments, attribute values and the text inside inline elements keep their exact characters. Elements whose end
//     tag is optional and missing in the source stay without one. Limit: CSS `white-space: pre*` on a normal element
//     is not known to the formatter.
//   * CSS: delegates to `formatCss` (css.js).
//   * JavaScript: the token-based beautifier of js-format.js (spacing, one statement per line, blocks and long objects
//     broken over lines, source line breaks kept). When its result cannot be proven to be the same program, and for
//     TypeScript / JSX files or with `jsStyle: "reindent"`, the older line re-indentation is used: re-indentation by
//     bracket depth, trailing whitespace, blank-line collapsing; strings, templates, comments and regex never touched.
//   * JSON: parse + pretty print (fails on comments/trailing commas: the caller gets { ok: false }).
//   * Markdown: trailing whitespace, blank lines around headings, `#Title` -> `# Title`; fenced code is untouched.
//
// Public API
//   DEFAULT_FORMAT_OPTIONS   every option with its default (below); FORMAT_PRESETS   named option sets
//   formatHtml / formatJs / formatJson / formatMarkdown (text, opts) -> string   (formatJson throws on invalid input)
//   formatText(lang, text, opts) -> { ok, text, error? }    lang is a `languageOf` id ("html", "css", "javascript", ...)
//   formatRange(lang, text, from, to, opts) -> { ok, from, to, insert, error? }   whole lines covering the selection
//   minifyText(lang, text, opts) -> { ok, text, error? }    HTML, CSS, JavaScript and JSON
//   canFormat(lang), canMinify(lang)
// Options: indentSize, useTabs, lineWidth, quote (HTML attributes), maxBlankLines; per language htmlIndentSize,
// cssIndentSize, jsIndentSize (0 = indentSize); HTML htmlWrapAttributes (auto | force | never), htmlVoidStyle (keep |
// html | xhtml), htmlIndentRoot; CSS cssSelectorsPerLine, cssBlankLines, cssHexCase (keep | lower | upper); JavaScript
// jsStyle (beautify | reindent), jsBraceStyle (collapse | allman), jsQuote (keep | double | single),
// jsSpaceBeforeFunctionParen, jsObjectInline; path (a .ts / .tsx / .jsx path keeps the re-indentation).
// Minify: keepLicense, minifyInlineScripts.
// Invariants: format(format(x)) === format(x); output ends with exactly one "\n" (empty input stays empty).
import { formatCss, minifyCss } from "./css.js";
import { minifyHtml } from "./site.js";
import { beautifyJs, minifyJs } from "./js-format.js";

export const DEFAULT_FORMAT_OPTIONS = Object.freeze({
  indentSize: 2, useTabs: false, lineWidth: 100, quote: "keep", maxBlankLines: 1,
  htmlIndentSize: 0, cssIndentSize: 0, jsIndentSize: 0,
  htmlWrapAttributes: "auto", htmlVoidStyle: "keep", htmlIndentRoot: true,
  cssSelectorsPerLine: true, cssBlankLines: true, cssHexCase: "keep",
  jsStyle: "beautify", jsBraceStyle: "collapse", jsQuote: "keep", jsSpaceBeforeFunctionParen: false, jsObjectInline: true,
  keepLicense: true, minifyInlineScripts: true,
});

/** Named option sets (Code > Formatting Options). Each preset only lists what differs from DEFAULT_FORMAT_OPTIONS. */
export const FORMAT_PRESETS = Object.freeze({
  default: {},
  prettier: { lineWidth: 80, quote: "double", htmlVoidStyle: "xhtml", cssHexCase: "lower", jsQuote: "double" },
  standard: { jsQuote: "single", jsSpaceBeforeFunctionParen: true, cssHexCase: "lower" },
  compact: { lineWidth: 140, maxBlankLines: 0, htmlWrapAttributes: "never", htmlIndentRoot: false, cssSelectorsPerLine: false, cssBlankLines: false },
  spacious: { indentSize: 4, maxBlankLines: 2, htmlWrapAttributes: "force", jsBraceStyle: "allman" },
});

/** Options of a language: its own indentation size when set (htmlIndentSize, cssIndentSize, jsIndentSize). */
function forLang(opts, lang) {
  const key = lang === "javascript" ? "jsIndentSize" : lang === "html" ? "htmlIndentSize" : lang === "css" ? "cssIndentSize" : null;
  const own = key && Number(opts?.[key]);
  return own ? { ...opts, indentSize: own } : opts;
}

function norm(opts) {
  const o = { ...DEFAULT_FORMAT_OPTIONS, ...(opts || {}) };
  o.indentSize = Math.max(1, Math.min(8, Math.round(Number(o.indentSize)) || 2));
  o.maxBlankLines = Number.isFinite(Number(o.maxBlankLines)) ? Math.max(0, Math.min(3, Math.round(Number(o.maxBlankLines)))) : 1;
  o.lineWidth = Math.max(40, Math.min(240, Math.round(Number(o.lineWidth)) || 100));
  o.useTabs = !!o.useTabs;
  o.unit = o.useTabs ? "\t" : " ".repeat(o.indentSize);
  o.baseDepth = Math.max(0, Math.round(Number(o.baseDepth)) || 0);
  return o;
}
const eol = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
const isWs = (c) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

// ------------------------------------------------------------------------------------------------ HTML

const BLOCK = new Set([
  "html", "head", "body", "title", "meta", "link", "base", "style", "script", "noscript", "template", "address", "article", "aside",
  "blockquote", "details", "dialog", "div", "dl", "dt", "dd", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "ul", "li", "p", "pre", "section", "summary", "table",
  "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "td", "th", "option", "optgroup", "select", "datalist", "legend",
  "source", "track", "param", "video", "audio", "picture", "iframe", "canvas", "svg", "object", "map", "area", "center",
]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "pre"]);
/** open element tag -> tags closed implicitly when it starts (a small subset of the HTML rules) */
const IMPLIED = {
  li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"], optgroup: ["optgroup", "option"],
};
for (const t of ["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]) IMPLIED[t] = ["p"];

const alpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

function tokenizeHtml(s) {
  const out = [];
  const n = s.length;
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) out.push({ k: "text", v: text });
    text = "";
  };
  while (i < n) {
    const c = s[i];
    if (c !== "<") {
      text += c;
      i++;
      continue;
    }
    if (s.startsWith("<!--", i)) {
      flush();
      const e = s.indexOf("-->", i + 4);
      const end = e < 0 ? n : e + 3;
      out.push({ k: "comment", v: s.slice(i, end) });
      i = end;
    } else if (s[i + 1] === "!" || s[i + 1] === "?") {
      flush();
      const e = s.indexOf(">", i);
      const end = e < 0 ? n : e + 1;
      out.push({ k: "decl", v: s.slice(i, end) });
      i = end;
    } else if (s[i + 1] === "/" && alpha(s[i + 2] || "")) {
      flush();
      const e = s.indexOf(">", i);
      const end = e < 0 ? n : e + 1;
      out.push({ k: "close", tag: s.slice(i + 2, end - 1).trim().split(/\s/)[0].toLowerCase() });
      i = end;
    } else if (alpha(s[i + 1] || "")) {
      flush();
      let j = i + 1;
      while (j < n && !isWs(s[j]) && s[j] !== ">" && s[j] !== "/") j++;
      const tag = s.slice(i + 1, j);
      const attrs = [];
      let selfClose = false;
      let closed = false;
      while (j < n) {
        while (j < n && isWs(s[j])) j++;
        if (s[j] === ">") {
          j++;
          closed = true;
          break;
        }
        if (s[j] === "/" && s[j + 1] === ">") {
          selfClose = true;
          j += 2;
          closed = true;
          break;
        }
        if (s[j] === "/") {
          j++;
          continue;
        }
        let a = j;
        while (j < n && !isWs(s[j]) && s[j] !== "=" && s[j] !== ">" && !(s[j] === "/" && s[j + 1] === ">")) j++;
        const name = s.slice(a, j);
        let k = j;
        while (k < n && isWs(s[k])) k++;
        if (s[k] === "=") {
          k++;
          while (k < n && isWs(s[k])) k++;
          let value;
          let quote = "";
          if (s[k] === '"' || s[k] === "'") {
            quote = s[k];
            const e = s.indexOf(quote, k + 1);
            const end = e < 0 ? n : e;
            value = s.slice(k + 1, end);
            j = e < 0 ? n : e + 1;
          } else {
            a = k;
            while (k < n && !isWs(s[k]) && s[k] !== ">") k++;
            value = s.slice(a, k);
            j = k;
          }
          attrs.push({ name, value, quote });
        } else attrs.push({ name, value: null, quote: "" });
        if (j <= a) j = a + 1; // never stall
      }
      if (!closed) {
        // unterminated tag: keep the rest verbatim as text, never lose input
        text += s.slice(i);
        i = n;
        continue;
      }
      const lower = tag.toLowerCase();
      const tok = { k: "open", tag: lower, rawTag: tag, attrs, selfClose };
      out.push(tok);
      i = j;
      if (RAW.has(lower) && !selfClose) {
        const re = new RegExp(`</${lower}(?=[\\s/>])`, "i");
        const m = re.exec(s.slice(i));
        const end = m ? i + m.index : n;
        tok.raw = s.slice(i, end);
        i = end;
      }
    } else {
      text += c;
      i++;
    }
  }
  flush();
  return out;
}

function buildTree(tokens) {
  const root = { tag: "#root", children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  for (const t of tokens) {
    if (t.k === "open") {
      const implied = IMPLIED[t.tag];
      if (implied) {
        // close the nearest open implied element when it is a direct "scope" sibling (li in li, p in p ...)
        for (let q = stack.length - 1; q > 0; q--) {
          const e = stack[q];
          if (implied.includes(e.tag) && !e.explicit) {
            stack.length = q;
            break;
          }
          if (!["a", "span", "b", "i", "em", "strong", "small", "u", "code", "font", "label"].includes(e.tag)) break;
        }
      }
      const el = { tag: t.tag, rawTag: t.rawTag, attrs: t.attrs, selfClose: t.selfClose, raw: t.raw, children: [], explicit: false, hasClose: false };
      top().children.push(el);
      if (!VOID.has(t.tag) && !t.selfClose && t.raw === undefined) stack.push(el);
      else if (t.raw !== undefined) el.pendingRawClose = true;
    } else if (t.k === "close") {
      // raw elements: their close tag follows the open token directly
      const last = top().children[top().children.length - 1];
      if (last && last.pendingRawClose && last.tag === t.tag) {
        last.pendingRawClose = false;
        last.hasClose = true;
        continue;
      }
      let q = stack.length - 1;
      while (q > 0 && stack[q].tag !== t.tag) q--;
      if (q > 0) {
        stack[q].hasClose = true;
        stack[q].explicit = true;
        stack.length = q;
      } else top().children.push({ stray: `</${t.tag}>`, tag: "#stray", children: [] }); // keep stray end tags
    } else top().children.push(t);
  }
  return root;
}

function formatHtmlImpl(source, o) {
  const s = eol(source);
  if (!s.trim()) return "";
  const tree = buildTree(tokenizeHtml(s));
  const lines = [];
  const pad = (d) => o.unit.repeat(d);
  const q = (a) => {
    if (a.value === null) return a.name;
    let quote = a.quote;
    if (o.quote === "double" && quote === "'" && !a.value.includes('"')) quote = '"';
    else if (o.quote === "single" && quote === '"' && !a.value.includes("'")) quote = "'";
    return `${a.name}=${quote}${a.value}${quote}`;
  };
  let atomDepth = 0; // indentation of the line an inline atom starts on (for wrapping long start tags inside runs)
  // `<br>` or `<br />`: void elements follow htmlVoidStyle, other self-closing tags (SVG) stay as written
  const ending = (el) => (VOID.has(el.tag) && o.htmlVoidStyle !== "keep" ? (o.htmlVoidStyle === "xhtml" ? " />" : ">") : el.selfClose ? " />" : ">");
  const wrapAttrs = (el, width) => el.attrs.length >= 2 && o.htmlWrapAttributes !== "never" && (o.htmlWrapAttributes === "force" || width > o.lineWidth);
  const inlineOpen = (el) => {
    const one = openTag(el);
    if (!wrapAttrs(el, pad(atomDepth).length + one.length)) return one;
    return `<${el.rawTag}${el.attrs.map((a) => "\n" + pad(atomDepth + 1) + q(a)).join("")}${ending(el)}`;
  };
  const openTag = (el) => `<${el.rawTag}${el.attrs.map((a) => " " + q(a)).join("")}${ending(el)}`;

  const isBlockish = (el) => {
    if (el.tag === "#stray") return false;
    if (el.k === "comment" || el.k === "decl") return true;
    if (el.k === "text") return false;
    if (BLOCK.has(el.tag)) return true;
    return el.children.some(isBlockish);
  };
  /** Atoms of an inline subtree: [{ s, sp }] where sp = whitespace before the atom in the source. */
  function atoms(children, out, pendingSpace) {
    let sp = pendingSpace;
    for (const c of children) {
      if (c.k === "text") {
        for (const part of c.v.split(/(\s+)/)) {
          if (part === "") continue;
          if (/^\s+$/.test(part)) sp = true;
          else {
            out.push({ s: part, sp });
            sp = false;
          }
        }
      } else if (c.k === "comment" || c.k === "decl") {
        out.push({ s: c.v, sp });
        sp = false;
      } else if (c.tag === "#stray") {
        out.push({ s: c.stray, sp });
        sp = false;
      } else {
        out.push({ s: inlineOpen(c), sp });
        sp = false;
        if (c.raw !== undefined) {
          out.push({ s: c.raw, sp: false });
          if (c.hasClose) out.push({ s: `</${c.rawTag}>`, sp: false });
        } else {
          sp = atoms(c.children, out, false);
          const ct = VOID.has(c.tag) || c.selfClose ? "" : c.hasClose ? `</${c.rawTag}>` : "";
          if (ct) out.push({ s: ct, sp: false });
        }
      }
    }
    return sp;
  }
  const join = (list) => list.map((a, i) => (i && a.sp ? " " : "") + a.s).join("");
  /** Greedy wrapping of atoms at spaces; an atom with newlines (raw content) is never split. */
  function wrap(list, depth) {
    const res = [];
    let cur = "";
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const piece = (cur && a.sp ? " " : "") + a.s;
      if (cur && a.sp && (pad(depth) + cur + piece).length > o.lineWidth && !cur.includes("\n")) {
        res.push(pad(depth) + cur);
        cur = a.s;
      } else cur += piece;
    }
    if (cur) res.push(pad(depth) + cur);
    return res;
  }
  const hasNl = (list) => list.some((a) => a.s.includes("\n"));
  function emitTag(el, depth) {
    const one = openTag(el);
    if (!wrapAttrs(el, pad(depth).length + one.length)) return [pad(depth) + one];
    const out = [`${pad(depth)}<${el.rawTag}`];
    for (const a of el.attrs) out.push(pad(depth + 1) + q(a));
    out[out.length - 1] += ending(el);
    return out;
  }
  function rawBody(el, depth) {
    // script / style: re-indent known languages; everything else (pre, textarea, title) is verbatim
    const body = el.raw;
    if (el.tag === "style" && body.trim()) return { text: "\n" + formatCssLines(body, depth + 1, o) + pad(depth), block: true };
    if (el.tag === "script" && body.trim()) {
      const type = (el.attrs.find((a) => a.name.toLowerCase() === "type")?.value || "").toLowerCase();
      if (type === "" || type.includes("javascript") || type === "module") return { text: "\n" + formatJsSmart(body, { ...o, baseDepth: depth + 1 }) + pad(depth), block: true };
      if (type.includes("json")) {
        try {
          return { text: "\n" + indentAll(JSON.stringify(JSON.parse(body), null, o.unit), pad(depth + 1)) + "\n" + pad(depth), block: true };
        } catch {
          return { text: body, block: false };
        }
      }
    }
    return { text: body, block: false };
  }
  function emitBlock(el, depth, out) {
    if (el.k === "comment" || el.k === "decl") {
      out.push(...el.v.split("\n").map((l, i) => (i === 0 ? pad(depth) + l : l)));
      return;
    }
    if (el.tag === "#stray") {
      out.push(pad(depth) + el.stray);
      return;
    }
    if (el.raw !== undefined) {
      const { text, block } = rawBody(el, depth);
      const head = emitTag(el, depth);
      const close = el.hasClose ? `</${el.rawTag}>` : "";
      out.push(...head.slice(0, -1), head[head.length - 1] + text + close); // the text may span lines: it is kept as is
      void block;
      return;
    }
    const close = VOID.has(el.tag) || el.selfClose ? "" : el.hasClose ? `</${el.rawTag}>` : "";
    if (!el.children.length) {
      const head = emitTag(el, depth);
      head[head.length - 1] += close;
      out.push(...head);
      return;
    }
    if (!el.children.some(isBlockish)) {
      const list = [];
      atomDepth = depth + 1;
      atoms(el.children, list, false);
      const inner = join(list);
      const single = pad(depth) + openTag(el) + inner + close;
      if (!hasNl(list) && single.length <= o.lineWidth && !/\n/.test(single)) {
        out.push(single);
        return;
      }
      out.push(...emitTag(el, depth));
      out.push(...wrap(list, depth + 1));
      if (close) out.push(pad(depth) + close);
      return;
    }
    out.push(...emitTag(el, depth));
    emitChildren(el.children, el.tag === "html" && !o.htmlIndentRoot ? depth : depth + 1, out);
    if (close) out.push(pad(depth) + close);
  }
  function emitChildren(children, depth, out) {
    atomDepth = depth;
    let run = [];
    let sp = false;
    let blank = false;
    let emitted = false; // something was written for this list of children (a blank line is never the first thing)
    const flushRun = () => {
      if (!run.length) return;
      if (blank && emitted) out.push("");
      blank = false;
      out.push(...wrap(run, depth));
      emitted = true;
      run = [];
    };
    for (const c of children) {
      if (c.k === "text" && !c.v.trim()) {
        if ((c.v.match(/\n/g) || []).length >= 2) blank = true;
        sp = true;
        continue;
      }
      if (isBlockish(c) || c.tag === "#stray") {
        flushRun();
        if (blank && emitted) out.push("");
        blank = false;
        emitBlock(c, depth, out);
        emitted = true;
        sp = false;
      } else {
        const first = run.length === 0;
        const before = run.length;
        sp = atoms([c], run, first ? false : sp);
        if (first && run[before]) run[before].sp = false;
      }
    }
    flushRun();
  }
  const out = [];
  emitChildren(tree.children, o.baseDepth, out);
  return out.join("\n") + "\n";
}

const indentAll = (text, p) => text.split("\n").map((l) => (l ? p + l : l)).join("\n");

const cssOptions = (o) => ({ indent: o.unit, selectorsPerLine: o.cssSelectorsPerLine !== false, blankLines: o.cssBlankLines !== false, hexCase: o.cssHexCase });

function formatCssLines(body, depth, o) {
  const css = formatCss(body, cssOptions(o)).replace(/\n+$/, "");
  return indentAll(css, o.unit.repeat(depth)) + "\n";
}

/** Formats an HTML document or fragment. */
export function formatHtml(text, opts) {
  return formatHtmlImpl(text, norm(opts));
}

// ------------------------------------------------------------------------------------------------ JavaScript

/**
 * Line-based re-indentation. The scanner follows strings, template literals, comments and regex literals across lines so
 * that only lines starting in plain code are touched.
 */
function formatJsImpl(source, o, fragment = false) {
  const s = eol(source);
  if (!s.trim()) return "";
  const rows = s.split("\n");
  const out = [];
  let depth = o.baseDepth || 0;
  const base = depth;
  const frames = []; // { switch, inCase, open: depth before }
  let state = "code"; // code | block (comment) | template
  let tmplDepth = []; // brace depth stack for ${ } inside templates


  let blanks = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    const raw = rows[ri];
    if (state !== "code") {
      // inside a block comment or template literal: keep the line as is (except trailing whitespace of comments)
      out.push(state === "block" ? raw.replace(/[ \t]+$/, "") : raw);
      blanks = 0;
      scanLine(raw, 0);
      continue;
    }
    const line = raw.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!line) {
      if (blanks === 0 && out.length) out.push("");
      blanks++;
      continue;
    }
    blanks = 0;
    // leading closers reduce the indentation of this line
    let lead = 0;
    while (lead < line.length && (line[lead] === "}" || line[lead] === ")" || line[lead] === "]")) lead++;
    let d = depth;
    const top = frames[frames.length - 1];
    if (lead) {
      // each leading closer returns to the depth at which its frame was opened (walking down the frame stack)
      let fi = frames.length - 1;
      for (let k = 0; k < lead; k++, fi--) d = fi >= 0 ? frames[fi].open : Math.max(base, d - 1);
    } else if (top && top.switch) {
      if (/^(case\b|default\s*:)/.test(line)) {
        d = top.open + 1;
        top.inCase = true;
      } else if (top.inCase) d += 1;
    }
    const cont = !lead && /^(\.[A-Za-z_$]|\?\.|&&|\|\||\?\s|\+\s|:\s|\?$)/.test(line) && !/^(case\b|default\b)/.test(line);
    // only leading `.chain`, `&&`, `||`, `?` lines get one extra level; continuation after a trailing operator is left alone
    out.push(o.unit.repeat(Math.max(0, d + (cont ? 1 : 0))) + line);
    // update the depth by scanning the line
    scanLine(line, 1);

  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";

  /** Scans a line, updating state/depth/frames. mode 1: line in code state; mode 0: continuing a multi-line token. */
  function scanLine(line, mode) {
    let i = 0;
    const n = line.length;
    // depth bookkeeping: `}` pops a frame (restoring its opening depth), other closers lower depth by one
    while (i < n) {
      const c = line[i];
      if (state === "block") {
        const e = line.indexOf("*/", i);
        if (e < 0) return;
        i = e + 2;
        state = "code";
        continue;
      }
      if (state === "template") {
        while (i < n) {
          if (line[i] === "\\") i += 2;
          else if (line[i] === "`") {
            state = "code";
            i++;
            break;
          } else if (line[i] === "$" && line[i + 1] === "{") {
            tmplDepth.push(frames.length);
            state = "code";
            i += 2;
            pushFrame(false);
            break;
          } else i++;
        }
        continue;
      }
      if (c === "/" && line[i + 1] === "/") return;
      if (c === "/" && line[i + 1] === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i++;
        while (i < n && line[i] !== c) i += line[i] === "\\" ? 2 : 1;
        i++;

        continue;
      }
      if (c === "`") {
        state = "template";
        i++;
        continue;
      }
      if (c === "/" && /[(,=:[!&|?{};]|^$|return|typeof/.test(lastSig(line, i))) {
        // regex literal
        let j = i + 1;
        let cls = false;
        while (j < n && (line[j] !== "/" || cls)) {
          if (line[j] === "\\") j++;
          else if (line[j] === "[") cls = true;
          else if (line[j] === "]") cls = false;
          j++;
        }
        i = j + 1;
        continue;
      }
      if (c === "{") {
        pushFrame(/^\s*switch\b[^{]*$/.test(line.slice(0, i)) || /\bswitch\s*\([^)]*\)\s*$/.test(line.slice(0, i)));
      } else if (c === "}") {
        if (tmplDepth.length && tmplDepth[tmplDepth.length - 1] === frames.length - 1) {
          tmplDepth.pop();
          popFrame();
          state = "template";
          i++;
          continue;
        }
        popFrame();
      } else if (c === "(" || c === "[") {
        pushFrame(false);
      } else if (c === ")" || c === "]") popFrame();
      i++;
    }
    void mode;
  }
  function lastSig(line, i) {
    let j = i - 1;
    while (j >= 0 && (line[j] === " " || line[j] === "\t")) j--;
    if (j < 0) return "";
    // a keyword before the slash
    const m = /(return|typeof)$/.exec(line.slice(0, j + 1));
    return m ? m[1] : line[j];
  }
  function pushFrame(isSwitch) {
    frames.push({ switch: isSwitch, inCase: false, open: depth });
    depth++;

  }
  function popFrame() {
    const f = frames.pop();
    if (f) depth = f.open;
    else depth = Math.max(base, depth - 1);
  }
}

/** The beautifier, or the line re-indentation for TypeScript / JSX, `jsStyle: "reindent"` and unprovable results. */
function formatJsSmart(source, o) {
  if (o.jsStyle !== "reindent" && !/\.(tsx?|jsx|mts|cts)$/i.test(o.path || "")) {
    const r = beautifyJs(eol(source), { ...o, indentUnit: o.unit });
    if (r != null) return r;
  }
  return formatJsImpl(source, o, true);
}

/** Formats JavaScript (TypeScript and JSX: re-indentation at the line level). */
export function formatJs(text, opts) {
  return formatJsSmart(text, norm(forLang(opts, "javascript")));
}

// ------------------------------------------------------------------------------------------------ JSON, Markdown

/** Pretty-prints JSON. Throws a SyntaxError for invalid JSON (comments and trailing commas are not JSON). */
export function formatJson(text, opts) {
  const o = norm(opts);
  const s = eol(text);
  if (!s.trim()) return "";
  return JSON.stringify(JSON.parse(s), null, o.useTabs ? "\t" : o.indentSize) + "\n";
}

export function formatMarkdown(text) {
  const s = eol(text);
  if (!s.trim()) return "";
  const rows = s.split("\n");
  const out = [];
  let fence = null;
  const pushBlank = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };
  for (const raw of rows) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      out.push(raw);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^\s{0,3}[`~]+\s*$/.test(raw)) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      out.push(raw.replace(/[ \t]+$/, ""));
      continue;
    }
    const hard = / {2,}$/.test(raw) && raw.trim() !== "";
    let line = raw.replace(/[ \t]+$/, "");
    if (hard) line += "  ";
    const isHeading = /^#{1,6} /.test(line);
    if (isHeading) pushBlank();
    if (line === "") {
      pushBlank();
      continue;
    }
    out.push(line);
    if (isHeading) out.push("");
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  while (out.length && out[0] === "") out.shift();
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------------------------------------ dispatch

const LANGS = new Set(["html", "css", "javascript", "json", "markdown"]);
export const canFormat = (lang) => LANGS.has(lang);

/** @returns {{ ok: boolean, text: string, error?: string }} */
export function formatText(lang, text, opts) {
  const o = norm(forLang(opts, lang));
  const src = String(text ?? "");
  try {
    switch (lang) {
      case "html": return { ok: true, text: formatHtmlImpl(src, o) };
      case "css": return { ok: true, text: formatCss(eol(src), cssOptions(o)) };
      case "javascript": return { ok: true, text: formatJsSmart(src, o) };
      case "json": return { ok: true, text: formatJson(src, o) };
      case "markdown": return { ok: true, text: formatMarkdown(src) };
      default: return { ok: false, text: src, error: "No formatter for this file type." };
    }
  } catch (err) {
    return { ok: false, text: src, error: err.message };
  }
}

/**
 * Formats the lines covered by the selection [from, to] of `text`: returns the replacement for exactly those lines.
 * HTML and JavaScript start at the indentation of the first selected line; CSS and JSON are indented afterwards.
 */
export function formatRange(lang, text, from, to, opts) {
  opts = forLang(opts, lang);
  const o = norm(opts);
  const s = String(text ?? "");
  const a = s.lastIndexOf("\n", Math.max(0, from) - 1) + 1;
  let b = s.indexOf("\n", Math.max(from, to - (to > from && s[to - 1] === "\n" ? 1 : 0)));
  if (b < 0) b = s.length;
  const slice = s.slice(a, b);
  if (!slice.trim()) return { ok: true, from: a, to: b, insert: slice };
  const lead = /^[ \t]*/.exec(slice)[0];
  const depth = o.useTabs ? lead.replace(/ /g, "").length || Math.floor(lead.length / o.indentSize) : Math.floor(lead.replace(/\t/g, o.unit).length / o.indentSize);
  let r;
  if (lang === "html" || lang === "javascript") r = formatText(lang, slice, { ...opts, baseDepth: depth });
  else if (lang === "css" || lang === "json") {
    r = formatText(lang, slice, opts);
    if (r.ok) r.text = indentAll(r.text.replace(/\n$/, ""), o.unit.repeat(depth)) + "\n";
  } else r = formatText(lang, slice, opts);
  if (!r.ok) return { ok: false, from: a, to: b, insert: slice, error: r.error };
  const insert = r.text.replace(/\n$/, "");
  return { ok: true, from: a, to: b, insert };
}

// ------------------------------------------------------------------------------------------------ minify

const MIN_LANGS = new Set(["html", "css", "javascript", "json"]);
export const canMinify = (lang) => MIN_LANGS.has(lang);

/**
 * Minifies a file. HTML: comments and insignificant whitespace (site.js minifyHtml), inline styles, and inline scripts
 * with `minifyInlineScripts`; CSS: minifyCss; JavaScript: minifyJs (license comments stay with `keepLicense`); JSON:
 * without whitespace. A script that cannot be minified safely is left as it is.
 * @returns {{ ok: boolean, text: string, error?: string }}
 */
export function minifyText(lang, text, opts) {
  const o = { ...DEFAULT_FORMAT_OPTIONS, ...(opts || {}) };
  const src = eol(text);
  try {
    switch (lang) {
      case "css": return { ok: true, text: minifyCss(src) };
      case "json": return { ok: true, text: JSON.stringify(JSON.parse(src)) };
      case "javascript": {
        if (/\.(tsx?|jsx|mts|cts)$/i.test(o.path || "")) return { ok: false, text: src, error: "TypeScript and JSX files are not minified." };
        const out = minifyJs(src, { keepLicense: o.keepLicense !== false });
        return out == null ? { ok: false, text: src, error: "This script could not be minified safely." } : { ok: true, text: out };
      }
      case "html": {
        let out = minifyHtml(src);
        if (o.minifyInlineScripts !== false) {
          out = out.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi, (all, open, attrs, body, close) => {
            if (/\bsrc\s*=/i.test(attrs) || !body.trim()) return all;
            const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] || "").toLowerCase();
            if (type && type !== "module" && !type.includes("javascript")) return all;
            const js = minifyJs(body, { keepLicense: o.keepLicense !== false });
            return js == null || /<\/script/i.test(js) ? all : open + js + close;
          });
        }
        return { ok: true, text: out };
      }
      default: return { ok: false, text: src, error: "No minifier for this file type." };
    }
  } catch (err) {
    return { ok: false, text: src, error: err.message };
  }
}