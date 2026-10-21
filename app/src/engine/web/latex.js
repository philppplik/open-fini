// LaTeX-subset to HTML converter for the Code studio's live preview. Pure: no DOM.
//
// THIS IS A PREVIEW, NOT A TeX ENGINE. It understands the commands and environments that typical articles, notes and
// reports use (sections, text styles, lists, tables, figures, theorems, citations, cross references, footnotes, simple
// \newcommand macros) and leaves math to KaTeX: formulas become `<span class="tex-math" data-tex="...">` placeholders
// that the UI renders. Anything it does not understand is shown as a visible `tex-unsupported` marker and reported in
// `diagnostics`/`unsupported`; nothing is dropped silently. Page layout (margins, fonts, page breaks) is not modeled.
//
// Safety: all text and attributes are escaped, URLs are filtered, images come only from `options.resolveImage`.
import { escapeText } from "./html.js";

/** Attribute-safe text: & < > and the double quote are escaped. */
const escapeAttr = (text) => escapeText(text).replace(/"/g, "&quot;");
import { safeUrl } from "./markdown.js";
import { highlight } from "./highlight.js";

/**
 * @typedef {{ key: string, type: string, fields: Record<string,string>, line: number }} BibEntry
 * @typedef {{ severity: 'error'|'warning'|'info', code: string, message: string, line: number, command?: string }} LatexDiagnostic
 * @typedef {{
 *   bib?: string, readFile?: (path: string) => string|null, resolveImage?: (path: string) => string|null,
 *   maxInclude?: number, today?: string
 * }} LatexOptions
 * @typedef {{
 *   html: string, title: string, author: string, date: string,
 *   outline: { level: number, number: string, title: string, id: string, line: number }[],
 *   labels: Record<string, { number: string, id: string, kind: 'section'|'figure'|'table'|'equation'|'item'|'other' }>,
 *   citations: string[], bibliography: { key: string, text: string, number: number }[],
 *   diagnostics: LatexDiagnostic[], unsupported: string[], stats: { words: number, math: number }
 * }} LatexResult
 */

// ------------------------------------------------------------------------------------------------ BibTeX

const ACCENTS = { "'": "\u0301", "`": "\u0300", "^": "\u0302", '"': "\u0308", "~": "\u0303", "=": "\u0304", ".": "\u0307", u: "\u0306", v: "\u030c", H: "\u030b", c: "\u0327", k: "\u0328", r: "\u030a" };
const SYMBOLS = {
  ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı", j: "ȷ", dag: "†", ddag: "‡", S: "§", P: "¶",
  copyright: "©", pounds: "£", textregistered: "®", texttrademark: "™", textbullet: "•", ldots: "…", dots: "…", textellipsis: "…", textdegree: "°",
  texteuro: "€", LaTeX: "LaTeX", TeX: "TeX", LaTeXe: "LaTeX2ε", textbackslash: "\\", textasciitilde: "~", textasciicircum: "^", textunderscore: "_",
  textless: "<", textgreater: ">", textbar: "|", guillemotleft: "«", guillemotright: "»", textendash: "–", textemdash: "—", textquoteleft: "‘",
  textquoteright: "’", textquotedblleft: "“", textquotedblright: "”", slash: "/", checkmark: "✓", textperiodcentered: "·", eacute: "é",
};

/** Applies a TeX accent (`\"`, `\'`, `\c` …) to a base letter. */
function accent(cmd, base) {
  const b = base === "i" ? "i" : base === "j" ? "j" : base;
  return (b + ACCENTS[cmd]).normalize("NFC");
}

/** Plain-text cleanup of BibTeX/LaTeX field values: accents, escapes, braces, dashes, quotes. */
function cleanTex(v) {
  let s = String(v ?? "");
  s = s.replace(/\\([`'^"~=.uvHckr])\s*\{\\?([A-Za-z])\}|\\([`'^"~=.])\s*\\?([A-Za-z])/g, (m, c1, l1, c2, l2) => accent(c1 || c2, l1 || l2));
  s = s.replace(/\\([A-Za-z]+)\s*(\{\})?/g, (m, name) => (Object.prototype.hasOwnProperty.call(SYMBOLS, name) ? SYMBOLS[name] : name === "and" ? "and" : ""));
  s = s.replace(/\\([&%$#_{}])/g, "$1").replace(/---/g, "\u2014").replace(/--/g, "\u2013").replace(/``/g, "\u201c").replace(/''/g, "\u201d");
  s = s.replace(/[{}]/g, "").replace(/~/g, "\u00a0").replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Parses BibTeX text. Tolerant: garbage is skipped, `@string`, `@comment` and `@preamble` are ignored.
 * @param {string} text
 * @returns {BibEntry[]}
 */
export function parseBib(text) {
  const src = String(text ?? "");
  const out = [];
  const re = /@([A-Za-z]+)\s*([({])/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase();
    const open = m[2];
    const close = open === "{" ? "}" : ")";
    const line = src.slice(0, m.index).split("\n").length;
    // find the matching closing delimiter
    let depth = 1;
    let j = re.lastIndex;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === "\\") j++;
      else if (c === open) depth++;
      else if (c === close) depth--;
      j++;
    }
    if (depth > 0) {
      // unterminated entry: stop at the next entry that starts a line
      const next = /\n@[A-Za-z]+\s*[({]/g;
      next.lastIndex = re.lastIndex;
      const nm = next.exec(src);
      j = nm ? nm.index + 1 : src.length;
    }
    const body = src.slice(re.lastIndex, depth === 0 ? j - 1 : j);
    re.lastIndex = Math.max(re.lastIndex, j);
    if (type === "string" || type === "comment" || type === "preamble") continue;
    const comma = body.indexOf(",");
    const key = (comma < 0 ? body : body.slice(0, comma)).trim();
    if (!key || /\s/.test(key)) continue;
    const fields = {};
    const rest = comma < 0 ? "" : body.slice(comma + 1);
    let i = 0;
    while (i < rest.length) {
      const fm = /\s*,?\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/y;
      fm.lastIndex = i;
      const f = fm.exec(rest);
      if (!f) {
        i++;
        continue;
      }
      i = fm.lastIndex;
      let value = "";
      for (;;) {
        while (/\s/.test(rest[i] || "")) i++;
        const c = rest[i];
        if (c === "{") {
          let d = 1;
          let k = i + 1;
          while (k < rest.length && d > 0) {
            if (rest[k] === "\\") k++;
            else if (rest[k] === "{") d++;
            else if (rest[k] === "}") d--;
            k++;
          }
          value += rest.slice(i + 1, d === 0 ? k - 1 : k);
          i = k;
        } else if (c === '"') {
          let d = 0;
          let k = i + 1;
          while (k < rest.length && !(rest[k] === '"' && d === 0)) {
            if (rest[k] === "\\") k++;
            else if (rest[k] === "{") d++;
            else if (rest[k] === "}") d--;
            k++;
          }
          value += rest.slice(i + 1, k);
          i = k + 1;
        } else {
          const nm = /[^\s,#]+/y;
          nm.lastIndex = i;
          const t = nm.exec(rest);
          if (t) {
            value += t[0];
            i = nm.lastIndex;
          }
        }
        while (/\s/.test(rest[i] || "")) i++;
        if (rest[i] === "#") i++;
        else break;
      }
      fields[f[1].toLowerCase()] = cleanTex(value);
    }
    out.push({ key, type, fields, line });
  }
  return out;
}

function authorsOf(entry) {
  const raw = entry.fields.author || entry.fields.editor || "";
  if (!raw) return [];
  return raw.split(/\s+and\s+/i).map((a) => {
    a = a.trim();
    if (a.includes(",")) return a.split(",")[0].trim();
    const parts = a.split(/\s+/);
    return parts[parts.length - 1];
  });
}

/** In-text author-year form: "Knuth (1984)", "Knuth & Lamport (1990)", "Knuth et al. (1990)". */
export function formatCitation(entry) {
  const a = authorsOf(entry);
  const year = entry.fields.year || entry.fields.date?.slice(0, 4) || "n.d.";
  if (!a.length) return `${entry.key} (${year})`;
  const who = a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} & ${a[1]}` : `${a[0]} et al.`;
  return `${who} (${year})`;
}

/** One bibliography line as plain text. */
export function formatReference(entry) {
  const f = entry.fields;
  const names = (f.author || f.editor || "").split(/\s+and\s+/i).map((a) => a.trim()).filter(Boolean);
  const who = names.length > 3 ? `${names[0]} et al.` : names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names[0] || "";
  const venue = f.journal || f.booktitle || f.publisher || f.school || f.institution || f.howpublished || "";
  const vol = f.volume ? `, ${f.volume}${f.number ? `(${f.number})` : ""}` : "";
  const pages = f.pages ? `, ${f.pages}` : "";
  const parts = [];
  if (who) parts.push(`${who}.`);
  parts.push(`(${f.year || "n.d."}).`);
  if (f.title) parts.push(`${f.title}.`);
  if (venue) parts.push(`${venue}${vol}${pages}.`);
  if (f.doi) parts.push(`doi:${f.doi}`);
  else if (f.url) parts.push(f.url);
  return parts.join(" ");
}

// ------------------------------------------------------------------------------------------------ tables of commands

const SILENT_ARGS = {
  usepackage: 1, documentclass: 1, geometry: 1, setlength: 2, addtolength: 2, setcounter: 2, addtocounter: 2, pagestyle: 1, thispagestyle: 1,
  hypersetup: 1, bibliographystyle: 1, graphicspath: 1, linespread: 1, pagenumbering: 1, setstretch: 1, usetikzlibrary: 1, RequirePackage: 1,
  numberwithin: 2, theoremstyle: 1, captionsetup: 1, DeclareMathOperator: 2, selectlanguage: 1, fancyhf: 0, fancyhead: 1, fancyfoot: 1, titleformat: 4,
  titlespacing: 4, definecolor: 3, setmainfont: 1, setlist: 1, lstset: 1, pdfinfo: 1, newgeometry: 1, restoregeometry: 0, makeatletter: 0, makeatother: 0,
  frenchspacing: 0, raggedbottom: 0, flushbottom: 0, onecolumn: 0, twocolumn: 0, maketitle_: 0, printindex: 0, makeindex: 0, index: 1, glossary: 1,
};
const SILENT_PLAIN = new Set(
  `centering raggedright raggedleft noindent indent par relax protect nobreak sloppy fussy hfill vfill strut bigskip medskip smallskip allowbreak
  nolinebreak nopagebreak normalfont rmfamily sffamily ttfamily mdseries upshape normalsize hrulefill dotfill selectfont leavevmode ignorespaces
  unskip null phantom hss vss newblock displaystyle textstyle limits nolimits`.split(/\s+/),
);
const SILENT_PACKAGES_INFO = new Set(["geometry", "hyperref", "amsmath", "amssymb", "amsthm", "graphicx", "babel", "inputenc", "fontenc", "microtype", "xcolor", "booktabs", "lmodern", "setspace", "parskip", "fancyhdr", "enumitem", "caption", "float", "url", "natbib", "mathtools", "color", "tikz", "listings"]);
const DECLARATIONS = {
  bf: "strong", bfseries: "strong", it: "em", itshape: "em", em: "em", sl: "em", slshape: "em", tt: "code", sc: "span.tex-sc", scshape: "span.tex-sc",
  sf: "span.tex-sf", rm: "span", large: "span.tex-large", Large: "span.tex-Large", LARGE: "span.tex-LARGE", huge: "span.tex-huge", Huge: "span.tex-Huge",
  small: "small", footnotesize: "span.tex-footnotesize", scriptsize: "span.tex-scriptsize", tiny: "span.tex-tiny",
};
const TEXT_STYLES = {
  textbf: "strong", textit: "em", emph: "em", textsl: "em", texttt: "code", textsc: "span.tex-sc", textsf: "span.tex-sf", textrm: "span", textnormal: "span",
  underline: "u", textsuperscript: "sup", textsubscript: "sub", mbox: "span", hbox: "span", textup: "span", textmd: "span", uline: "u", sout: "s",
};
const SECTION_LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const MATH_ENVS = new Set(["equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*", "eqnarray", "eqnarray*", "flalign", "flalign*", "displaymath", "math"]);
const THEOREM_PLAIN = /theorem|lemma|proposition|corollary|conjecture|claim|fact/i;

const slug = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const idSafe = (s) => String(s).replace(/[^A-Za-z0-9_.:-]/g, "_");
/** Removes tags until nothing changes, so nested fragments such as `<scr<b>ipt>` cannot reassemble into a tag. */
const stripTags = (h) => {
  let s = h;
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);
  return s;
};
const unesc = (h) => h.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function alpha(n) {
  return String.fromCharCode(64 + n);
}

// ------------------------------------------------------------------------------------------------ converter

const MAX_SOURCE = 1_000_000;
const MAX_STEPS = 200_000;
const MAX_DEPTH = 60;

/** Removes comments (keeps line structure by leaving \u0001 for every removed newline). */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      out += src.substr(i, 2);
      i += 2;
    } else if (c === "%") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      i = j < n ? j + 1 : j;
      out += "\u0001";
      // a comment at the start of a line removes the whole line; otherwise the line break is swallowed
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

class Converter {
  constructor(options, prev) {
    this.o = options;
    this.prev = prev || null; // result of the first pass (labels, outline, citations)
    this.diagnostics = [];
    this.unsupportedSet = new Set();
    this.infoSeen = new Set();
    this.macros = new Map();
    this.envs = new Map();
    this.theorems = new Map();
    this.counters = { part: 0, chapter: 0, section: 0, subsection: 0, subsubsection: 0, paragraph: 0, figure: 0, table: 0, equation: 0 };
    this.thmCounters = new Map();
    this.appendix = false;
    this.hasChapter = false;
    this.outline = [];
    this.labels = {};
    this.cur = { number: "", id: "", kind: "other" };
    this.citations = [];
    this.footnotes = [];
    this.bibEntries = new Map();
    this.bibItems = [];
    this.title = "";
    this.author = "";
    this.date = "";
    this.math = 0;
    this.steps = 0;
    this.depth = 0;
    this.includeDepth = 0;
    this.listDepth = 0;
    this.file = "";
    this.line = 1;
    this.idUsed = new Set();
    this.bibCommandSeen = false;
    this.nocite = [];
    this.stopped = false;
  }

  diag(severity, code, message, command) {
    if (this.diagnostics.length > 500) return;
    const d = { severity, code, message: this.file ? `${message} (in ${this.file})` : message, line: this.line };
    if (command) d.command = command;
    this.diagnostics.push(d);
  }
  info(key, message) {
    if (this.infoSeen.has(key)) return;
    this.infoSeen.add(key);
    this.diag("info", "latex/ignored", message);
  }
  unsupported(name, kind = "command") {
    this.unsupportedSet.add(name);
    this.diag("warning", kind === "command" ? "latex/unsupported-command" : "latex/unsupported-environment", `Unsupported ${kind}: ${kind === "command" ? "\\" : ""}${name}`, name);
  }
  uid(base) {
    let id = base || "x";
    let k = 1;
    while (this.idUsed.has(id)) id = `${base}-${++k}`;
    this.idUsed.add(id);
    return id;
  }

  // ------------------------------------------------------------ source helpers

  lineIn(str, idx, base) {
    let n = base;
    for (let i = 0; i < idx && i < str.length; i++) if (str[i] === "\n" || str[i] === "\u0001") n++;
    return n;
  }

  /** Index after the balanced group that starts at str[i] === "{"; -1 when unbalanced. */
  matchBrace(str, i, open = "{", close = "}") {
    let d = 0;
    for (let j = i; j < str.length; j++) {
      const c = str[j];
      if (c === "\\") j++;
      else if (c === open) d++;
      else if (c === close && --d === 0) return j + 1;
    }
    return -1;
  }

  /** Reads a mandatory argument at i (skipping spaces): { text, next } or null. */
  arg(str, i) {
    let j = i;
    while (j < str.length && /[ \t\n\u0001]/.test(str[j])) j++;
    if (str[j] === "{") {
      const e = this.matchBrace(str, j);
      if (e < 0) return { text: str.slice(j + 1), next: str.length, unbalanced: true };
      return { text: str.slice(j + 1, e - 1), next: e };
    }
    if (str[j] === "\\") {
      const m = /^\\([A-Za-z]+|.)/s.exec(str.slice(j, j + 40));
      if (m) return { text: m[0], next: j + m[0].length };
    }
    if (j < str.length) return { text: str[j], next: j + 1 };
    return null;
  }

  /** Reads an optional [..] argument at i (no whitespace skipping beyond spaces). */
  opt(str, i) {
    let j = i;
    while (j < str.length && /[ \t]/.test(str[j])) j++;
    if (str[j] !== "[") return null;
    const e = this.matchBrace(str, j, "[", "]");
    if (e < 0) return null;
    return { text: str.slice(j + 1, e - 1), next: e };
  }

  /** Finds the end of \begin{name} ... \end{name} starting at `from` (after the \begin{name}); returns { end, after } or null. */
  findEnd(str, from, name) {
    const re = new RegExp(`\\\\(begin|end)\\s*\\{${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g");
    re.lastIndex = from;
    let d = 1;
    let m;
    while ((m = re.exec(str))) {
      if (m[1] === "begin") d++;
      else if (--d === 0) return { end: m.index, after: m.index + m[0].length };
    }
    return null;
  }

  // ------------------------------------------------------------ macros

  defineMacro(name, nargs, optDefault, body) {
    this.macros.set(name, { nargs, optDefault, body });
  }

  expandMacro(def, str, i, line) {
    const args = [];
    let j = i;
    let k = 0;
    if (def.optDefault !== null && def.nargs > 0) {
      const o = this.opt(str, j);
      if (o) {
        args.push(o.text);
        j = o.next;
      } else args.push(def.optDefault);
      k = 1;
    }
    for (; k < def.nargs; k++) {
      const a = this.arg(str, j);
      if (!a) {
        args.push("");
        continue;
      }
      args.push(a.text);
      j = a.next;
    }
    const text = def.body.replace(/#([1-9#])/g, (m, d) => (d === "#" ? "#" : args[Number(d) - 1] ?? ""));
    return { text, next: j };
  }

  /** User macros are also substituted inside math because KaTeX does not know them. */
  expandInMath(tex) {
    if (!this.macros.size) return tex;
    let s = tex;
    for (let round = 0; round < 50; round++) {
      let changed = false;
      s = s.replace(/\\([A-Za-z]+)/g, (m, name, offset) => {
        const def = this.macros.get(name);
        if (!def) return m;
        changed = true;
        return m;
      });
      // expand properly (needs argument parsing): do a manual pass
      let out = "";
      let i = 0;
      let did = false;
      while (i < s.length) {
        if (s[i] === "\\") {
          const m = /^\\([A-Za-z]+)/.exec(s.slice(i, i + 80));
          if (m && this.macros.has(m[1]) && ++this.steps < MAX_STEPS) {
            const r = this.expandMacro(this.macros.get(m[1]), s, i + m[0].length);
            out += `{${r.text}}`;
            i = r.next;
            did = true;
            continue;
          }
          out += s.substr(i, 2);
          i += 2;
          continue;
        }
        out += s[i++];
      }
      s = out;
      void changed;
      if (!did || s.length > 100000) break;
    }
    return s;
  }

  // ------------------------------------------------------------ numbering

  secNumber(level) {
    const c = this.counters;
    const top = this.hasChapter ? 1 : 2;
    const first = (n) => (this.appendix && level === top ? alpha(n) : String(n));
    if (level === 0) return String(c.part);
    if (level === 1) return first(c.chapter);
    if (level === 2) return this.hasChapter ? `${first(c.chapter)}.${c.section}` : first(c.section);
    const base = this.hasChapter ? `${first(c.chapter)}.${c.section}` : first(c.section);
    if (level === 3) return `${base}.${c.subsection}`;
    if (level === 4) return `${base}.${c.subsection}.${c.subsubsection}`;
    return "";
  }

  setLabel(kind, number, id) {
    this.cur = { kind, number, id };
  }

  // ------------------------------------------------------------ the scanner

  /**
   * Converts `str`. mode "block" makes paragraphs and block elements; "inline" returns inline HTML.
   */
  run(str, mode, line0) {
    if (this.depth > MAX_DEPTH) {
      this.diag("error", "latex/too-deep", "Nesting is too deep; the rest was shown as plain text.");
      return escapeText(str.replace(/\u0001/g, ""));
    }
    this.depth++;
    try {
      return this.scan(str, mode, line0);
    } finally {
      this.depth--;
    }
  }

  scan(str, mode, line0) {
    const blocks = [];
    let para = "";
    // line numbers are computed incrementally (scanning moves forward), so hostile input stays linear
    let cacheI = 0;
    let cacheL = line0;
    const lineAt = (i) => {
      if (i < cacheI) {
        cacheI = 0;
        cacheL = line0;
      }
      for (; cacheI < i && cacheI < str.length; cacheI++) if (str[cacheI] === "\n" || str[cacheI] === "\u0001") cacheL++;
      return cacheL;
    };
    const flush = () => {
      if (mode !== "block") return;
      const t = para.replace(/\u0001/g, "").trim();
      if (t) blocks.push(`<p>${para.replace(/\u0001/g, "").trim()}</p>`);
      para = "";
    };
    const block = (html) => {
      if (mode === "block") {
        flush();
        blocks.push(html);
      } else para += html;
    };
    const n = str.length;
    let i = 0;
    let text = "";
    const emitText = () => {
      if (!text) return;
      para += this.texText(text);
      text = "";
    };
    while (i < n) {
      if (++this.steps > MAX_STEPS) {
        if (!this.stopped) this.diag("error", "latex/too-complex", "The document is too complex for the preview; conversion stopped.");
        this.stopped = true;
        break;
      }
      const c = str[i];
      if (c === "\\") {
        const m = /^\\([A-Za-z@]+)(\*?)/.exec(str.slice(i, i + 120));
        if (!m) {
          // control symbol
          const sym = str[i + 1];
          if (sym === undefined) {
            i++;
            continue;
          }
          emitText();
          this.line = lineAt(i);
          if (sym === "\\") {
            const o = /^\*?(?:\[[^\]]*\])?/.exec(str.slice(i + 2, i + 40));
            para += mode === "block" && !para.trim() ? "" : "<br>";
            i += 2 + (o ? o[0].length : 0);
          } else if (sym === "(" || sym === "[") {
            const closer = sym === "(" ? "\\)" : "\\]";
            const e = str.indexOf(closer, i + 2);
            if (e < 0) {
              this.diag("error", "latex/unclosed-math", `Missing ${closer}`);
              i += 2;
            } else {
              const tex = str.slice(i + 2, e);
              if (sym === "(") para += this.mathInline(tex);
              else block(this.mathDisplay(tex, false, null));
              i = e + 2;
            }
          } else if (ACCENTS[sym] !== undefined) {
            const a = this.arg(str, i + 2);
            if (a) {
              const base = a.text.replace(/^\\(i|j)$/, "$1").replace(/[{}]/g, "")[0] || "";
              para += escapeText(accent(sym, base) + a.text.replace(/[{}]/g, "").replace(/^\\(i|j)$/, "$1").slice(1));
              i = a.next;
            } else i += 2;
          } else if (sym === ",") {
            para += "&thinsp;";
            i += 2;
          } else if (sym === " " || sym === "\n") {
            para += " ";
            i += 2;
          } else if (sym === ";" || sym === ":" || sym === ">") {
            para += "&ensp;";
            i += 2;
          } else if (sym === "!" || sym === "-" || sym === "/" || sym === "@") {
            i += 2;
          } else if (sym === "&" || sym === "%" || sym === "$" || sym === "#" || sym === "_" || sym === "{" || sym === "}") {
            para += escapeText(sym);
            i += 2;
          } else {
            para += this.marker(`\\${sym}`);
            this.unsupported(sym);
            i += 2;
          }
          continue;
        }
        emitText();
        const name = m[1];
        const star = m[2] === "*";
        this.line = lineAt(i);
        i += m[0].length;
        const r = this.command(name, star, str, i, mode, line0, { para: (h) => (para += h), block, flush, getPara: () => para, setPara: (v) => (para = v) });
        i = r;
        continue;
      }
      if (c === "{") {
        emitText();
        const e = this.matchBrace(str, i);
        const inner = e < 0 ? str.slice(i + 1) : str.slice(i + 1, e - 1);
        if (e < 0) {
          this.line = lineAt(i);
          this.diag("error", "latex/unbalanced-braces", "Missing closing brace }");
        }
        para += this.run(inner, "inline", lineAt(i));
        i = e < 0 ? n : e;
        continue;
      }
      if (c === "}") {
        this.line = lineAt(i);
        this.diag("warning", "latex/unbalanced-braces", "Unexpected closing brace }");
        i++;
        continue;
      }
      if (c === "$") {
        emitText();
        this.line = lineAt(i);
        if (str[i + 1] === "$") {
          const e = str.indexOf("$$", i + 2);
          if (e < 0) {
            this.diag("error", "latex/unclosed-math", "Missing closing $$");
            i += 2;
          } else {
            block(this.mathDisplay(str.slice(i + 2, e), false, null));
            i = e + 2;
          }
        } else {
          let e = i + 1;
          while (e < n && str[e] !== "$") e += str[e] === "\\" ? 2 : 1;
          if (e >= n) {
            this.diag("error", "latex/unclosed-math", "Missing closing $");
            i++;
          } else {
            para += this.mathInline(str.slice(i + 1, e));
            i = e + 1;
          }
        }
        continue;
      }
      if (c === "\n" && mode === "block") {
        const m = /^\n[ \t\u0001]*\n[\s\u0001]*/.exec(str.slice(i, i + 4000));
        if (m) {
          emitText();
          flush();
          i += m[0].length;
          continue;
        }
      }
      if (c === "\n" && mode === "inline" && /^\n[ \t\u0001]*\n/.test(str.slice(i, i + 200))) {
        emitText();
        para += "<br><br>";
        i++;
        continue;
      }
      if (c === "&" || c === "#" || c === "^" || c === "_") {
        // stray alignment/math characters in text: show them
        text += c;
        i++;
        continue;
      }
      text += c;
      i++;
    }
    emitText();
    flush();
    return mode === "block" ? blocks.join("\n") : para.replace(/\u0001/g, "");
  }

  marker(src) {
    return `<span class="tex-unsupported" title="${escapeAttr(`Unsupported command: ${src}`)}">${escapeText(src)}</span>`;
  }

  /** Typographic text: ligature-like dashes and quotes, nbsp; HTML escaped. */
  texText(t) {
    let s = t.replace(/\u0001/g, "");
    s = s.replace(/[ \t]*\n[ \t]*/g, " ").replace(/[ \t]{2,}/g, " ");
    s = s.replace(/---/g, "\u2014").replace(/--/g, "\u2013").replace(/``/g, "\u201c").replace(/''/g, "\u201d").replace(/`/g, "\u2018").replace(/'/g, "\u2019").replace(/~/g, "\u00a0");
    s = s.replace(/!`/g, "\u00a1").replace(/\?`/g, "\u00bf");
    return escapeText(s);
  }

  mathInline(tex) {
    this.math++;
    const e = escapeAttr(this.expandInMath(tex.trim()));
    return `<span class="tex-math" data-display="false" data-tex="${e}">${escapeText(tex.trim())}</span>`;
  }

  mathDisplay(tex, numbered, label, wrapEnv) {
    this.math++;
    let t = tex.replace(/\\label\s*\{([^}]*)\}/g, (m, k) => {
      label = label || k;
      return "";
    });
    t = t.replace(/\\(?:nonumber|notag)\b/g, "").trim();
    if (wrapEnv) t = `\\begin{${wrapEnv}}${t}\\end{${wrapEnv}}`;
    t = this.expandInMath(t);
    let id = "";
    let no = "";
    if (numbered) {
      const num = ++this.counters.equation;
      no = `<span class="tex-eqno">(${num})</span>`;
      id = this.uid(`eq-${num}`);
      this.setLabel("equation", String(num), id);
    }
    if (label) this.registerLabel(label, "equation");
    const body = `<div class="tex-math tex-display" data-display="true" data-tex="${escapeAttr(t)}">${escapeText(t)}</div>`;
    return numbered ? `<div class="tex-equation"${id ? ` id="${id}"` : ""}>${body}${no}</div>` : body;
  }

  registerLabel(key, kind) {
    const cur = this.cur;
    const id = cur.id || this.uid(`lbl-${idSafe(key)}`);
    if (!cur.id) {
      this.idUsed.add(id);
    }
    this.labels[key] = { number: cur.number, id: cur.id ? cur.id : id, kind: kind || cur.kind };
    if (!cur.id) {
      // label without a numbered target: still give it an anchor
      this.labels[key].id = id;
    }
  }

  // ------------------------------------------------------------ commands

  /** Handles \name at str[i..] (after the name). Returns the new index. */
  command(name, star, str, i, mode, line0, out) {
    const { para, block } = out;
    // user macros first
    const mac = this.macros.get(name);
    if (mac) {
      const r = this.expandMacro(mac, str, i);
      if (this.depth < MAX_DEPTH && this.steps < MAX_STEPS) para(this.run(r.text, "inline", this.line));
      return r.next;
    }
    if (Object.prototype.hasOwnProperty.call(SECTION_LEVELS, name)) return this.section(name, star, str, i, block);
    if (Object.prototype.hasOwnProperty.call(TEXT_STYLES, name)) {
      const a = this.arg(str, i);
      if (!a) return i;
      const inner = this.run(a.text, "inline", this.line);
      para(this.wrap(TEXT_STYLES[name], inner));
      return a.next;
    }
    if (name.length === 1 && "cvuHkr".includes(name)) {
      const a = this.arg(str, i);
      if (!a) return i;
      const plain = a.text.replace(/[{}]/g, "");
      para(escapeText(accent(name, plain[0] || " ") + plain.slice(1)));
      return a.next;
    }
    if (Object.prototype.hasOwnProperty.call(DECLARATIONS, name)) {
      // applies to the rest of the current group
      const rest = str.slice(i).replace(/^[ \t]+/, "");
      const inner = this.run(rest, mode === "block" ? "inline" : "inline", this.line);
      if (mode === "block") {
        // declarations in block context apply to the following text; keep the content as a paragraph
        para(this.wrap(DECLARATIONS[name], inner));
      } else para(this.wrap(DECLARATIONS[name], inner));
      return str.length;
    }
    if (Object.prototype.hasOwnProperty.call(SYMBOLS, name)) {
      para(escapeText(SYMBOLS[name]));
      // swallow an optional "{}" and one space used to terminate the command
      if (str.startsWith("{}", i)) return i + 2;
      return i;
    }
    if (Object.prototype.hasOwnProperty.call(SILENT_ARGS, name)) {
      let j = i;
      if (name === "usepackage" || name === "RequirePackage" || name === "documentclass") {
        const o = this.opt(str, j);
        if (o) j = o.next;
        const a = this.arg(str, j);
        if (a) {
          j = a.next;
          const pk = a.text.split(",").map((x) => x.trim());
          for (const p of pk) if (name !== "documentclass" && SILENT_PACKAGES_INFO.has(p)) this.info(`pkg:${p}`, `Package "${p}" is ignored in the preview (layout and fonts are not modeled).`);
        }
        return j;
      }
      for (let k = 0; k < SILENT_ARGS[name]; k++) {
        const o = k === 0 ? this.opt(str, j) : null;
        if (o) j = o.next;
        const a = this.arg(str, j);
        if (!a) break;
        j = a.next;
      }
      this.info(`cmd:${name}`, `\\${name} is ignored in the preview.`);
      return j;
    }
    if (SILENT_PLAIN.has(name)) return i;
    switch (name) {
      case "begin":
        return this.environment(str, i, mode, line0, out);
      case "end":
        this.diag("error", "latex/unmatched-end", `\\end without matching \\begin`);
        return this.arg(str, i)?.next ?? i;
      case "newcommand":
      case "renewcommand":
      case "providecommand":
      case "DeclareRobustCommand":
        return this.newCommand(str, i);
      case "def":
        return this.defCommand(str, i);
      case "newenvironment":
      case "renewenvironment": {
        const nm = this.arg(str, i);
        if (!nm) return i;
        let j = nm.next;
        let nargs = 0;
        const o = this.opt(str, j);
        if (o) {
          nargs = parseInt(o.text, 10) || 0;
          j = o.next;
        }
        const b = this.arg(str, j);
        const e = b && this.arg(str, b.next);
        if (b && e) {
          this.envs.set(nm.text.trim(), { nargs, begin: b.text, end: e.text });
          return e.next;
        }
        return j;
      }
      case "newtheorem": {
        let j = i;
        const st = str[j] === "*";
        if (st) j++;
        const nm = this.arg(str, j);
        if (!nm) return i;
        j = nm.next;
        const shared = this.opt(str, j);
        if (shared) j = shared.next;
        const title = this.arg(str, j);
        if (!title) return j;
        j = title.next;
        const within = this.opt(str, j);
        if (within) j = within.next;
        this.theorems.set(nm.text.trim(), { title: this.run(title.text, "inline", this.line), plain: THEOREM_PLAIN.test(title.text), star: st, shared: shared ? shared.text.trim() : null, within: within ? within.text.trim() : null });
        return j;
      }
      case "title":
      case "author":
      case "date": {
        const a = this.arg(str, i);
        if (!a) return i;
        const html = this.run(a.text.replace(/\\thanks\s*\{[^}]*\}/g, ""), "inline", this.line);
        if (name === "date") this.dateSet = true;
        this[name] = name === "author" ? html.replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim() : html.trim();
        return a.next;
      }
      case "and":
        para(", ");
        return i;
      case "thanks": {
        const a = this.arg(str, i);
        return a ? a.next : i;
      }
      case "today":
        para(escapeText(this.today()));
        return i;
      case "maketitle":
        block(this.titleBlock());
        return i;
      case "tableofcontents":
        block(this.tocBlock());
        return i;
      case "appendix":
        this.appendix = true;
        this.counters.section = 0;
        this.counters.chapter = 0;
        return i;
      case "label": {
        const a = this.arg(str, i);
        if (a) this.registerLabel(a.text.trim());
        return a ? a.next : i;
      }
      case "ref":
      case "eqref":
      case "autoref":
      case "cref":
      case "Cref":
      case "nameref":
      case "pageref":
        return this.reference(name, str, i, para);
      case "cite":
      case "citep":
      case "citet":
      case "citeauthor":
      case "citeyear":
      case "parencite":
      case "textcite":
      case "autocite":
      case "citealp":
        return this.cite(name, str, i, para);
      case "nocite": {
        const a = this.arg(str, i);
        if (a) for (const k of a.text.split(",")) this.nocite.push(k.trim());
        return a ? a.next : i;
      }
      case "bibliography":
      case "addbibresource": {
        const a = this.arg(str, i);
        if (!a) return i;
        if (name === "addbibresource") {
          this.loadBib(a.text);
          return a.next;
        }
        for (const f of a.text.split(",")) this.loadBib(f.trim());
        this.bibCommandSeen = true;
        block(this.bibliographyBlock());
        return a.next;
      }
      case "printbibliography":
        this.bibCommandSeen = true;
        block(this.bibliographyBlock());
        return i;
      case "footnote":
      case "footnotetext": {
        const o = this.opt(str, i);
        const a = this.arg(str, o ? o.next : i);
        if (!a) return i;
        const num = this.footnotes.length + 1;
        const body = this.run(a.text, "inline", this.line);
        this.footnotes.push(body);
        para(`<sup class="tex-fnref"><a id="fnref-${num}" href="#fn-${num}">${num}</a></sup>`);
        return a.next;
      }
      case "url": {
        const a = this.arg(str, i);
        if (!a) return i;
        const u = a.text.replace(/\\([%#&_])/g, "$1").trim();
        para(this.link(u, escapeText(u)));
        return a.next;
      }
      case "href": {
        const u = this.arg(str, i);
        const t = u && this.arg(str, u.next);
        if (!u || !t) return u ? u.next : i;
        para(this.link(u.text.replace(/\\([%#&_])/g, "$1").trim(), this.run(t.text, "inline", this.line)));
        return t.next;
      }
      case "textcolor":
      case "colorbox":
      case "fcolorbox": {
        const k = name === "fcolorbox" ? 2 : 1;
        let j = i;
        for (let x = 0; x < k; x++) {
          const a = this.arg(str, j);
          if (a) j = a.next;
        }
        const t = this.arg(str, j);
        if (!t) return j;
        para(this.run(t.text, "inline", this.line));
        return t.next;
      }
      case "color": {
        const a = this.arg(str, i);
        return a ? a.next : i;
      }
      case "hspace":
      case "vspace":
      case "hskip":
      case "vskip": {
        const a = this.arg(str, str[i] === "*" ? i + 1 : i);
        if (name === "hspace" || name === "hskip") para("&ensp;");
        return a ? a.next : i;
      }
      case "quad":
        para("&emsp;");
        return i;
      case "qquad":
        para("&emsp;&emsp;");
        return i;
      case "newline":
      case "linebreak":
        para("<br>");
        return i;
      case "newpage":
      case "clearpage":
      case "pagebreak":
      case "cleardoublepage":
        block('<div class="tex-page-break" role="separator"></div>');
        return i;
      case "verb": {
        const d = str[i];
        if (!d) return i;
        const e = str.indexOf(d, i + 1);
        if (e < 0) return i + 1;
        para(`<code class="tex-verb">${escapeText(str.slice(i + 1, e))}</code>`);
        return e + 1;
      }
      case "includegraphics":
        return this.includeGraphics(str, i, para);
      case "caption":
      case "captionof": {
        const a = this.arg(str, i + (name === "caption" && str[i] === "*" ? 1 : 0));
        if (!a) return i;
        if (name === "captionof") {
          const b = this.arg(str, a.next);
          if (b) return b.next;
        }
        para(this.captionHtml(a.text));
        return a.next;
      }
      case "item":
        this.diag("warning", "latex/item-outside-list", "\\item outside a list");
        return i;
      case "input":
      case "include":
        return this.includeFile(name, str, i, mode, out);
      case "bibitem": {
        const o = this.opt(str, i);
        const a = this.arg(str, o ? o.next : i);
        return a ? a.next : i;
      }
      case "text":
      case "textnormal_": {
        const a = this.arg(str, i);
        if (!a) return i;
        para(this.run(a.text, "inline", this.line));
        return a.next;
      }
      case "hline":
      case "toprule":
      case "midrule":
      case "bottomrule":
      case "cline":
      case "cmidrule":
        this.diag("info", "latex/outside-table", `\\${name} outside a table`);
        return i;
      case "end_": {
        return i;
      }
      default: {
        // styles that only wrap one argument and are harmless: keep the text
        this.unsupported(name);
        para(this.marker(`\\${name}`));
        return i;
      }
    }
  }

  wrap(spec, inner) {
    const [tag, cls] = spec.split(".");
    return `<${tag}${cls ? ` class="${cls}"` : ""}>${inner}</${tag}>`;
  }

  link(url, innerHtml) {
    if (/^(https?:|mailto:)/i.test(url)) {
      const ok = safeUrl(url, "link");
      if (ok) return `<a href="${escapeAttr(ok)}" rel="noopener noreferrer">${innerHtml}</a>`;
    }
    if (url.startsWith("#")) return `<a href="${escapeAttr(url)}">${innerHtml}</a>`;
    this.diag("warning", "latex/unsafe-link", `Link was not made clickable: only http, https and mailto links are allowed.`);
    return innerHtml;
  }

  today() {
    if (this.o.today) return this.o.today;
    const d = new Date();
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  titleBlock() {
    const title = this.title || "";
    const parts = [];
    if (title) parts.push(`<h1 class="tex-title">${title}</h1>`);
    if (this.author) parts.push(`<div class="tex-author">${this.author}</div>`);
    const date = this.dateSet ? this.date : escapeText(this.today());
    if (date) parts.push(`<div class="tex-date">${date}</div>`);
    return `<header class="tex-titleblock">${parts.join("")}</header>`;
  }

  tocBlock() {
    const items = (this.prev ? this.prev.outline : []).filter((o) => o.level >= 2 || (this.hasChapter && o.level >= 1));
    if (!items.length) return '<nav class="tex-toc"><h2>Contents</h2><p class="tex-note">The table of contents is empty (no sections yet).</p></nav>';
    const li = items
      .map((o) => `<li class="tex-toc-l${o.level}"><a href="#${escapeAttr(o.id)}">${o.number ? `<span class="tex-secno">${escapeText(o.number)}</span> ` : ""}${escapeText(o.title)}</a></li>`)
      .join("");
    return `<nav class="tex-toc"><h2>Contents</h2><ul>${li}</ul></nav>`;
  }

  section(name, star, str, i, block) {
    const level = SECTION_LEVELS[name];
    let j = i;
    const o = this.opt(str, j);
    if (o) j = o.next;
    const a = this.arg(str, j);
    if (!a) return j;
    const titleHtml = this.run(a.text, "inline", this.line);
    const plain = unesc(stripTags(titleHtml)).replace(/\s+/g, " ").trim();
    let number = "";
    if (!star && level <= 4) {
      const c = this.counters;
      if (level === 0) {
        c.part++;
        number = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][c.part] || String(c.part);
      } else if (level === 1) {
        c.chapter++;
        c.section = c.subsection = c.subsubsection = 0;
        number = this.secNumber(1);
      } else if (level === 2) {
        c.section++;
        c.subsection = c.subsubsection = 0;
        number = this.secNumber(2);
      } else if (level === 3) {
        c.subsection++;
        c.subsubsection = 0;
        number = this.secNumber(3);
      } else {
        c.subsubsection++;
        number = this.secNumber(4);
      }
      if (level <= 2) this.resetThmWithin(level === 1 ? "chapter" : "section");
    }
    const id = this.uid(number && /^\d|^[A-Z]/.test(number) ? `sec-${number.replace(/\./g, "-")}` : `sec-${slug(plain) || "section"}`);
    this.setLabel("section", number, id);
    if (level <= 4) this.outline.push({ level, number, title: plain, id, line: this.line });
    const tag = level <= 1 ? "h1" : `h${Math.min(6, level)}`;
    const cls = level === 0 ? "tex-part" : level === 1 ? "tex-chapter" : "";
    block(`<${tag}${cls ? ` class="${cls}"` : ""} id="${id}">${number ? `<span class="tex-secno">${escapeText(number)}</span> ` : ""}${titleHtml}</${tag}>`);
    return a.next;
  }

  resetThmWithin(kind) {
    for (const [name, th] of this.theorems) if (th.within === kind || (kind === "chapter" && th.within === "chapter")) this.thmCounters.set(th.shared || name, 0);
  }

  reference(name, str, i, para) {
    const a = this.arg(str, i);
    if (!a) return i;
    const keys = a.text.split(",").map((k) => k.trim());
    const html = keys.map((key) => {
      const lab = (this.prev ? this.prev.labels : this.labels)[key];
      if (name === "pageref") return `<a class="tex-ref" href="#${escapeAttr(lab ? lab.id : "")}">1</a>`;
      if (!lab) {
        if (this.prev) this.diag("warning", "latex/undefined-reference", `Undefined reference "${key}"`, name);
        return `<span class="tex-ref tex-undefined" title="Undefined reference">??</span>`;
      }
      const num = lab.number || "?";
      let text = num;
      if (name === "eqref") text = `(${num})`;
      else if (name === "autoref" || name === "cref" || name === "Cref") {
        const kindName = { section: "Section", figure: "Figure", table: "Table", equation: "Equation", item: "Item", other: "" }[lab.kind] || "";
        text = lab.kind === "equation" ? `${name === "cref" ? "equation" : "Equation"} (${num})` : `${kindName}${kindName ? "\u00a0" : ""}${num}`;
        if (name === "cref" && lab.kind !== "equation") text = text.charAt(0).toLowerCase() + text.slice(1);
      } else if (name === "nameref") text = (this.prev?.outline.find((o) => o.id === lab.id)?.title) || num;
      return `<a class="tex-ref" href="#${escapeAttr(lab.id)}">${escapeText(text)}</a>`;
    });
    para(html.join(", "));
    return a.next;
  }

  entry(key) {
    return this.bibEntries.get(key) || null;
  }

  cite(name, str, i, para) {
    let j = i;
    while (/[ \t]/.test(str[j] || "")) j++;
    for (let k = 0; k < 2; k++) {
      const o = this.opt(str, j);
      if (o) j = o.next;
    }
    const a = this.arg(str, j);
    if (!a) return i;
    const keys = a.text.split(",").map((k) => k.trim()).filter(Boolean);
    for (const key of keys) if (!this.citations.includes(key)) this.citations.push(key);
    const nums = (this.prev ? this.prev.citations : this.citations);
    const parts = keys.map((key) => {
      const e = this.entry(key) || (this.bibItems.find((b) => b.key === key) ? { key, fields: {}, item: true } : null);
      if (!e && this.prev) this.diag("warning", "latex/undefined-citation", `Undefined citation "${key}"`, name);
      const n = nums.indexOf(key) + 1;
      if (name === "citet" || name === "textcite") return e && !e.item ? `<a class="tex-cite" href="#bib-${escapeAttr(idSafe(key))}">${escapeText(formatCitation(e))}</a>` : `<span class="tex-cite tex-undefined">${escapeText(key)}</span>`;
      if (name === "citeauthor") return e && !e.item ? escapeText(authorsOf(e).join(" & ") || key) : escapeText(key);
      if (name === "citeyear") return e && !e.item ? escapeText(e.fields.year || "n.d.") : "?";
      return e ? `<a class="tex-cite" href="#bib-${escapeAttr(idSafe(key))}">${n || "?"}</a>` : `<span class="tex-cite tex-undefined" title="Undefined citation">?</span>`;
    });
    if (name === "citet" || name === "textcite" || name === "citeauthor" || name === "citeyear") para(parts.join(", "));
    else para(`[${parts.join(", ")}]`);
    return a.next;
  }

  loadBib(path) {
    const rd = this.o.readFile;
    if (!path || !rd) return;
    const text = rd(path) ?? rd(`${path}.bib`);
    if (text == null) {
      this.diag("warning", "latex/missing-file", `Bibliography file "${path}" was not found.`);
      return;
    }
    for (const e of parseBib(text)) if (!this.bibEntries.has(e.key)) this.bibEntries.set(e.key, e);
  }

  bibliographyBlock() {
    const cited = (this.prev ? this.prev.citations : this.citations).slice();
    for (const k of this.nocite) {
      if (k === "*") {
        for (const key of this.bibEntries.keys()) if (!cited.includes(key)) cited.push(key);
      } else if (!cited.includes(k)) cited.push(k);
    }
    const items = [];
    let n = 0;
    for (const key of cited) {
      const e = this.entry(key);
      if (!e) continue;
      n++;
      items.push({ key, text: formatReference(e), number: n });
    }
    this.bibResult = items;
    if (!items.length) return '<section class="tex-bibliography"><h2>References</h2><p class="tex-note">No references were cited, or the bibliography file has no matching entries.</p></section>';
    return `<section class="tex-bibliography"><h2>References</h2><ol class="tex-bib">${items.map((b) => `<li id="bib-${escapeAttr(idSafe(b.key))}">${escapeText(b.text)}</li>`).join("")}</ol></section>`;
  }

  includeGraphics(str, i, para) {
    const o = this.opt(str, i);
    const a = this.arg(str, o ? o.next : i);
    if (!a) return i;
    const file = a.text.trim();
    let style = "";
    let alt = file.split("/").pop();
    if (o) {
      for (const kv of o.text.split(",")) {
        const [k, v] = kv.split("=").map((x) => x.trim());
        if (k === "width" && v) {
          const f = /^([\d.]+)\\(?:textwidth|linewidth|columnwidth)$/.exec(v);
          const u = /^([\d.]+)(cm|mm|in|pt|px|em|%)$/.exec(v);
          if (f) style = `width:${Math.min(100, Math.round(parseFloat(f[1]) * 1000) / 10)}%`;
          else if (/^\\(?:textwidth|linewidth|columnwidth)$/.test(v)) style = "width:100%";
          else if (u) style = `width:${u[1]}${u[2]}`;
        } else if (k === "alt" && v) alt = v;
      }
    }
    let url = null;
    const tries = /\.[A-Za-z0-9]{2,4}$/.test(file) ? [file] : [file, `${file}.png`, `${file}.jpg`, `${file}.jpeg`, `${file}.svg`, `${file}.webp`, `${file}.gif`];
    if (this.o.resolveImage) for (const t of tries) {
      url = this.o.resolveImage(t);
      if (url) break;
    }
    const safe = url ? safeUrl(url, "image") : null;
    if (!safe) {
      this.diag("warning", "latex/missing-image", `Image "${file}" was not found in the project.`, "includegraphics");
      para(`<span class="tex-missing-image" title="Image not found">[image: ${escapeText(file)}]</span>`);
    } else para(`<img src="${escapeAttr(safe)}" alt="${escapeAttr(alt)}"${style ? ` style="${escapeAttr(`${style};max-width:100%`)}"` : ' style="max-width:100%"'}>`);
    return a.next;
  }

  captionHtml(text) {
    const kind = this.floatKind || "figure";
    const num = ++this.counters[kind === "table" ? "table" : "figure"];
    const id = this.floatId || this.uid(`${kind}-${num}`);
    this.floatId = id;
    this.setLabel(kind === "table" ? "table" : "figure", String(num), id);
    return `<figcaption><span class="tex-caplabel">${kind === "table" ? "Table" : "Figure"} ${num}:</span> ${this.run(text, "inline", this.line)}</figcaption>`;
  }

  includeFile(name, str, i, mode, out) {
    const a = this.arg(str, i);
    if (!a) return i;
    const path = a.text.trim();
    const rd = this.o.readFile;
    const max = this.o.maxInclude ?? 20;
    if (!rd) {
      this.diag("warning", "latex/missing-file", `Cannot include "${path}": no file access in this preview.`, name);
      return a.next;
    }
    if (this.includeDepth >= max) {
      this.diag("error", "latex/include-depth", `\\${name} nesting is deeper than ${max}; "${path}" was skipped (circular include?).`, name);
      return a.next;
    }
    const text = rd(path) ?? rd(`${path}.tex`);
    if (text == null) {
      this.diag("warning", "latex/missing-file", `Included file "${path}" was not found.`, name);
      return a.next;
    }
    const saveFile = this.file;
    const saveLine = this.line;
    this.includeDepth++;
    this.file = path;
    const html = this.run(stripComments(String(text).slice(0, MAX_SOURCE)), mode === "block" ? "block" : "inline", 1);
    this.includeDepth--;
    this.file = saveFile;
    this.line = saveLine;
    if (mode === "block") out.block(html);
    else out.para(html);
    return a.next;
  }

  newCommand(str, i) {
    let j = i;
    if (str[j] === "*") j++;
    let nm = this.arg(str, j);
    if (!nm) return i;
    const name = nm.text.replace(/^\\/, "").trim();
    j = nm.next;
    let nargs = 0;
    let optDefault = null;
    const o = this.opt(str, j);
    if (o) {
      nargs = parseInt(o.text, 10) || 0;
      j = o.next;
      const d = this.opt(str, j);
      if (d) {
        optDefault = d.text;
        j = d.next;
      }
    }
    const body = this.arg(str, j);
    if (!body) return j;
    if (name) this.defineMacro(name, nargs, optDefault, body.text);
    return body.next;
  }

  defCommand(str, i) {
    const m = /^\s*\\([A-Za-z]+)((?:#[1-9])*)\s*/.exec(str.slice(i, i + 200));
    if (!m) return i;
    const j = i + m[0].length;
    const body = this.arg(str, j);
    if (!body) return j;
    this.defineMacro(m[1], m[2].length / 2, null, body.text);
    return body.next;
  }

  // ------------------------------------------------------------ environments

  environment(str, i, mode, line0, out) {
    const nm = this.arg(str, i);
    if (!nm) return i;
    const name = nm.text.trim();
    let j = nm.next;
    const end = this.findEnd(str, j, name);
    const startLine = this.line;
    if (!end) {
      this.diag("error", "latex/unclosed-environment", `Missing \\end{${name}}`, name);
    }
    const bodyEnd = end ? end.end : str.length;
    const after = end ? end.after : str.length;
    let body = str.slice(j, bodyEnd);
    const emit = (html) => (mode === "block" ? out.block(html) : out.para(html));
    const blockBody = (b, ln = startLine) => this.run(b, "block", ln);
    this.line = startLine;

    if (name === "document") {
      emit(this.run(body, "block", this.lineIn(str, j, line0)));
      return after;
    }
    if (MATH_ENVS.has(name)) {
      const numbered = !name.endsWith("*") && !["displaymath", "math"].includes(name);
      const wrap = name.startsWith("align") || name.startsWith("flalign") || name.startsWith("eqnarray") ? "aligned" : name.startsWith("gather") || name.startsWith("multline") ? "gathered" : null;
      if (name === "math") out.para(this.mathInline(body));
      else emit(this.mathDisplay(body, numbered, null, wrap));
      return after;
    }
    const th = this.theorems.get(name);
    if (th) {
      emit(this.theoremEnv(name, th, body));
      return after;
    }
    const custom = this.envs.get(name);
    if (custom) {
      const o = str.slice(j);
      void o;
      let b = body;
      const args = [];
      for (let k = 0; k < custom.nargs; k++) {
        const a = this.arg(b, 0);
        if (!a) break;
        args.push(a.text);
        b = b.slice(a.next);
      }
      const sub = (s) => s.replace(/#([1-9])/g, (m, d) => args[Number(d) - 1] ?? "");
      emit(this.run(`${sub(custom.begin)}${b}${sub(custom.end)}`, mode === "block" ? "block" : "inline", startLine));
      return after;
    }
    switch (name) {
      case "itemize":
      case "enumerate":
      case "description":
      case "compactitem":
      case "compactenum":
        emit(this.list(name, body, startLine));
        return after;
      case "abstract":
        emit(`<section class="tex-abstract"><h2>Abstract</h2>${blockBody(body)}</section>`);
        return after;
      case "quote":
      case "quotation":
        emit(`<blockquote class="tex-quote">${blockBody(body)}</blockquote>`);
        return after;
      case "verse":
        emit(`<blockquote class="tex-verse">${this.run(body.replace(/\\\\\s*/g, "\n"), "inline", startLine).replace(/\n/g, "<br>")}</blockquote>`);
        return after;
      case "center":
      case "flushleft":
      case "flushright":
        emit(`<div class="tex-${name}">${blockBody(body)}</div>`);
        return after;
      case "verbatim":
      case "verbatim*":
      case "lstlisting":
      case "minted":
      case "Verbatim": {
        let lang = "";
        let b = body;
        if (name === "minted") {
          const a = this.arg(b, 0);
          if (a) {
            lang = a.text;
            b = b.slice(a.next);
          }
        } else if (name === "lstlisting") {
          const o = this.opt(b, 0);
          if (o) {
            lang = /language\s*=\s*([\w+#-]+)/.exec(o.text)?.[1] || "";
            b = b.slice(o.next);
          }
        }
        b = b.replace(/^\n/, "").replace(/\n\s*$/, "");
        emit(`<pre class="tex-verbatim"><code>${highlight(b.replace(/\u0001/g, ""), lang)}</code></pre>`);
        return after;
      }
      case "tabular":
      case "tabular*":
      case "tabularx":
      case "array":
        emit(this.tabular(name, body, startLine));
        return after;
      case "table":
      case "table*":
      case "figure":
      case "figure*":
      case "wrapfigure":
      case "subfigure": {
        const kind = name.startsWith("table") ? "table" : "figure";
        const saveKind = this.floatKind;
        const saveId = this.floatId;
        const savedCur = this.cur;
        this.floatKind = kind;
        this.floatId = null;
        let b = body;
        const o = this.opt(b, 0);
        if (o) b = b.slice(o.next);
        if (name === "wrapfigure" || name === "subfigure") {
          const a = this.arg(b, 0);
          if (a) b = b.slice(a.next);
          const a2 = name === "wrapfigure" ? this.arg(b, 0) : null;
          if (a2) b = b.slice(a2.next);
        }
        const inner = blockBody(b);
        const id = this.floatId;
        this.floatKind = saveKind;
        this.floatId = saveId;
        if (!id) this.cur = savedCur;
        emit(`<figure class="tex-float tex-${kind}"${id ? ` id="${id}"` : ""}>${inner}</figure>`);
        return after;
      }
      case "proof":
        emit(`<div class="tex-proof"><em>Proof.</em> ${blockBody(body)}<span class="tex-qed" aria-hidden="true">\u220e</span></div>`);
        return after;
      case "thebibliography": {
        let b = body;
        const a = this.arg(b, 0);
        if (a) b = b.slice(a.next);
        emit(this.thebibliography(b, startLine));
        return after;
      }
      case "minipage":
      case "spacing":
      case "sloppypar":
      case "singlespace":
      case "doublespace":
      case "onehalfspace":
      case "small":
      case "footnotesize":
      case "large": {
        let b = body;
        if (name === "minipage") {
          const o = this.opt(b, 0);
          if (o) b = b.slice(o.next);
          const a = this.arg(b, 0);
          if (a) b = b.slice(a.next);
        }
        emit(`<div class="tex-group">${blockBody(b)}</div>`);
        return after;
      }
      case "multicols": {
        let b = body;
        const a = this.arg(b, 0);
        if (a) b = b.slice(a.next);
        emit(`<div class="tex-group">${blockBody(b)}</div>`);
        return after;
      }
      default:
        this.unsupported(name, "environment");
        emit(`<div class="tex-unsupported-env" data-env="${escapeAttr(name)}" title="${escapeAttr(`Unsupported environment: ${name}`)}">${blockBody(body)}</div>`);
        return after;
    }
  }

  theoremEnv(name, th, body) {
    let label = "";
    let num = "";
    if (!th.star) {
      const key = th.shared || name;
      const n = (this.thmCounters.get(key) || 0) + 1;
      this.thmCounters.set(key, n);
      const within = th.shared ? this.theorems.get(th.shared)?.within ?? th.within : th.within;
      const sec = within ? (within === "chapter" ? this.counters.chapter : this.secNumber(2)) : "";
      num = within ? `${sec}.${n}` : String(n);
      const id = this.uid(`thm-${name}-${num.replace(/\./g, "-")}`);
      this.setLabel("other", num, id);
      this.thmId = id;
    }
    let b = body;
    const o = this.opt(b, 0);
    let note = "";
    if (o) {
      note = ` (${this.run(o.text, "inline", this.line)})`;
      b = b.slice(o.next);
    }
    label = `<strong class="tex-thm-head">${th.title}${num ? ` ${num}` : ""}${note}.</strong>`;
    const id = !th.star ? this.cur.id : "";
    return `<div class="tex-theorem ${th.plain ? "tex-thm-plain" : "tex-thm-def"}"${id ? ` id="${id}"` : ""}>${label} ${this.run(b, "block", this.line)}</div>`;
  }

  /** Splits a list body at its own \item commands (skipping nested environments). */
  splitItems(body) {
    const items = [];
    let depth = 0;
    let cur = -1;
    const re = /\\(begin|end)\s*\{[^}]*\}|\\item\b/g;
    let m;
    const marks = [];
    while ((m = re.exec(body))) {
      if (m[1] === "begin") depth++;
      else if (m[1] === "end") depth--;
      else if (depth === 0) marks.push([m.index, m.index + m[0].length]);
    }
    for (let k = 0; k < marks.length; k++) {
      const end = k + 1 < marks.length ? marks[k + 1][0] : body.length;
      items.push({ text: body.slice(marks[k][1], end), offset: marks[k][1] });
      cur = k;
    }
    void cur;
    return { head: marks.length ? body.slice(0, marks[0][0]) : body, items };
  }

  list(name, body, line) {
    this.listDepth++;
    const { head, items } = this.splitItems(body);
    let out = "";
    if (head.replace(/\u0001/g, "").trim()) this.diag("warning", "latex/text-before-item", "Text before the first \\item is ignored.");
    let k = 0;
    const tag = name === "enumerate" || name === "compactenum" ? "ol" : name === "description" ? "dl" : "ul";
    const styles = ["decimal", "lower-alpha", "lower-roman", "upper-alpha"];
    for (const it of items) {
      k++;
      let t = it.text;
      let label = "";
      const o = this.opt(t, 0);
      if (o) {
        label = this.run(o.text, "inline", line);
        t = t.slice(o.next);
      }
      const startCur = this.cur;
      if (tag === "ol") this.setLabel("item", String(k), "");
      const inner = this.run(t, "block", line + this.lineIn(body, it.offset, 0) - 1);
      const idAttr = tag === "ol" && this.cur !== startCur ? "" : "";
      void idAttr;
      const single = inner.match(/^<p>([\s\S]*)<\/p>$/);
      let content = single && !/<p>/.test(single[1]) ? single[1] : inner;
      content = content.replace(/^<p>([\s\S]*?)<\/p>\n(?=<(?:ul|ol|dl)\b)/, "$1\n");
      if (tag === "dl") out += `<dt>${label}</dt><dd>${content}</dd>`;
      else out += `<li${label ? ` data-label="${escapeAttr(unesc(stripTags(label)))}"` : ""}>${content}</li>`;
    }
    this.listDepth--;
    if (tag === "ol") return `<ol class="tex-enumerate" style="list-style-type:${styles[Math.min(3, this.listDepth)]}">${out}</ol>`;
    return tag === "dl" ? `<dl class="tex-description">${out}</dl>` : `<ul class="tex-itemize">${out}</ul>`;
  }

  thebibliography(body, line) {
    const re = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
    const marks = [];
    let m;
    while ((m = re.exec(body))) marks.push({ key: m[1].trim(), start: m.index + m[0].length, from: m.index });
    const items = [];
    marks.forEach((mk, idx) => {
      const end = idx + 1 < marks.length ? marks[idx + 1].from : body.length;
      const html = this.run(body.slice(mk.start, end), "inline", line).trim();
      items.push({ key: mk.key, html, number: idx + 1 });
      if (!this.bibItems.find((b) => b.key === mk.key)) this.bibItems.push({ key: mk.key, html });
    });
    this.bibResult = items.map((b) => ({ key: b.key, text: unesc(stripTags(b.html)), number: b.number }));
    // citations numbered by their position in thebibliography
    for (const b of items) if (!this.citations.includes(b.key) && false) this.citations.push(b.key);
    this.bibCommandSeen = true;
    return `<section class="tex-bibliography"><h2>References</h2><ol class="tex-bib">${items.map((b) => `<li id="bib-${escapeAttr(idSafe(b.key))}">${b.html}</li>`).join("")}</ol></section>`;
  }

  tabular(name, body, line) {
    let b = body;
    if (name === "tabular*" || name === "tabularx") {
      const w = this.arg(b, 0);
      if (w) b = b.slice(w.next);
    }
    const po = this.opt(b, 0);
    if (po) b = b.slice(po.next);
    const spec = this.arg(b, 0);
    let aligns = [];
    if (spec) {
      b = b.slice(spec.next);
      const cleaned = spec.text.replace(/@\{[^}]*\}|!\{[^}]*\}|\*\{(\d+)\}\{([^}]*)\}/g, (m, n, s) => (n ? s.repeat(Number(n)) : "")).replace(/[pmb]\{[^}]*\}/g, "l").replace(/[XL]/g, "l").replace(/C/g, "c").replace(/R/g, "r");
      aligns = [...cleaned].filter((ch) => /[lcr]/.test(ch));
    }
    // split into rows at top-level \\
    const rows = [];
    let cur = "";
    let d = 0;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c === "\\" && b[i + 1] === "\\" && d === 0) {
        rows.push(cur);
        cur = "";
        i++;
        const o = /^\*?\s*\[[^\]]*\]/.exec(b.slice(i + 1, i + 30));
        if (o) i += o[0].length;
      } else {
        if (c === "{") d++;
        else if (c === "}") d--;
        else if (c === "\\") {
          cur += c + (b[i + 1] ?? "");
          i++;
          continue;
        }
        cur += c;
      }
    }
    if (cur.replace(/\s|\u0001/g, "")) rows.push(cur);
    let html = "";
    let pendingTop = false;
    const lastRule = [];
    rows.forEach((row, r) => {
      let rowText = row;
      let top = pendingTop;
      let bottom = false;
      // strip rules at the start / end of the row
      for (;;) {
        const m = /^[\s\u0001]*\\(hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\}|cmidrule(?:\([^)]*\))?\s*\{[^}]*\})/.exec(rowText);
        if (!m) break;
        top = true;
        rowText = rowText.slice(m[0].length);
      }
      for (;;) {
        const m = /\\(hline|bottomrule|midrule)[\s\u0001]*$/.exec(rowText);
        if (!m) break;
        bottom = true;
        rowText = rowText.slice(0, m.index);
      }
      pendingTop = false;
      // cells at top-level &
      const cells = [];
      let c = "";
      let dd = 0;
      for (let i = 0; i < rowText.length; i++) {
        const ch = rowText[i];
        if (ch === "\\") {
          c += ch + (rowText[i + 1] ?? "");
          i++;
        } else if (ch === "{") {
          dd++;
          c += ch;
        } else if (ch === "}") {
          dd--;
          c += ch;
        } else if (ch === "&" && dd === 0) {
          cells.push(c);
          c = "";
        } else c += ch;
      }
      cells.push(c);
      let col = 0;
      const tds = cells
        .map((cell) => {
          let text = cell.replace(/\u0001/g, "").trim();
          let span = 1;
          let rowspan = 1;
          let al = aligns[col] || "l";
          const mc = /^\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*/.exec(text);
          if (mc) {
            span = Math.max(1, parseInt(mc[1], 10));
            al = (mc[2].match(/[lcr]/) || [al])[0];
            const rest = this.arg(text, mc[0].length - 1 + 0);
            text = rest ? rest.text : text.slice(mc[0].length);
          }
          const mr = /^\\multirow\s*\{(\d+)\}\s*\{[^}]*\}\s*/.exec(text);
          if (mr) {
            rowspan = Math.max(1, parseInt(mr[1], 10));
            const rest = this.arg(text, mr[0].length - 1);
            text = rest ? rest.text : text.slice(mr[0].length);
          }
          col += span;
          const tag = "td";
          return `<${tag}${span > 1 ? ` colspan="${span}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}${al !== "l" ? ` style="text-align:${al === "c" ? "center" : "right"}"` : ""}>${this.run(text, "inline", line)}</${tag}>`;
        })
        .join("");
      if (!cells.join("").trim() && !top && !bottom) return;
      if (rowText.trim() === "" && cells.length === 1) {
        pendingTop = top || bottom;
        lastRule[r] = true;
        return;
      }
      html += `<tr${top ? ' class="tex-rule-top"' : ""}${bottom ? ' data-rule-bottom="true"' : ""}>${tds}</tr>`;
      if (bottom) pendingTop = true;
    });
    return `<table class="tex-tabular"><tbody>${html}</tbody></table>`;
  }
}

/**
 * Converts LaTeX source to preview HTML. Never throws.
 * @param {string} source
 * @param {LatexOptions} [options]
 * @returns {LatexResult}
 */
export function convertLatex(source, options = {}) {
  let src = String(source ?? "");
  const truncated = src.length > MAX_SOURCE;
  if (truncated) src = src.slice(0, MAX_SOURCE);
  const normalized = src.replace(/\r\n?/g, "\n");
  // verbatim-like environments must not lose '%' signs: protect them before stripping comments
  const protectedBlocks = [];
  const guarded = normalized.replace(/\\begin\{(verbatim\*?|lstlisting|minted|Verbatim)\}([\s\S]*?)\\end\{\1\}/g, (m) => {
    protectedBlocks.push(m);
    return `\u0002${protectedBlocks.length - 1}\u0002`;
  }).replace(/\\verb(\*?)([^A-Za-z\s*])([^\n]*?)\2/g, (m) => {
    protectedBlocks.push(m);
    return `\u0002${protectedBlocks.length - 1}\u0002`;
  });
  const stripped = stripComments(guarded).replace(/\u0002(\d+)\u0002/g, (m, k) => protectedBlocks[Number(k)]);

  const hasChapter = /\\chapter\b/.test(stripped);
  const run = (prev) => {
    const cv = new Converter(options, prev);
    cv.hasChapter = hasChapter;
    for (const e of parseBib(options.bib || "")) if (!cv.bibEntries.has(e.key)) cv.bibEntries.set(e.key, e);
    for (const m of stripped.matchAll(/\\(?:bibliography|addbibresource)\s*\{([^}]*)\}/g)) for (const f of m[1].split(",")) cv.loadBib(f.trim());
    if (truncated) cv.diag("warning", "latex/too-large", "The document is larger than 1 MB; only the first megabyte is shown.");
    let body = stripped;
    // content before \begin{document} only defines things; the converter scans it for definitions
    const docStart = body.search(/\\begin\s*\{document\}/);
    const hasDoc = docStart >= 0;
    let html;
    if (hasDoc) {
      const pre = body.slice(0, docStart);
      cv.run(pre, "inline", 1); // definitions, \title, \author; text output is discarded
      const rest = body.slice(docStart);
      const end = rest.search(/\\end\s*\{document\}/);
      if (end < 0) cv.diag("error", "latex/missing-end-document", "Missing \\end{document}");
      html = cv.run(rest, "block", cv.lineIn(body, docStart, 1));
      const trailing = end >= 0 ? rest.slice(end + "\\end{document}".length).replace(/[\s\u0001]/g, "") : "";
      if (trailing) cv.diag("info", "latex/after-document", "Text after \\end{document} is ignored.");
    } else {
      html = cv.run(body, "block", 1);
    }
    return { cv, html };
  };
  let first;
  try {
    first = run(null);
  } catch (err) {
    return emptyResult(`Internal error: ${err?.message || err}`);
  }
  const prev = { labels: first.cv.labels, outline: first.cv.outline, citations: first.cv.citations };
  let second = first;
  try {
    second = run(prev);
  } catch (err) {
    return emptyResult(`Internal error: ${err?.message || err}`);
  }
  const cv = second.cv;
  let html = second.html;
  if (cv.footnotes.length) {
    html += `\n<section class="tex-footnotes"><hr><ol>${cv.footnotes.map((f, k) => `<li id="fn-${k + 1}">${f} <a class="tex-fnback" href="#fnref-${k + 1}" aria-label="Back to text">\u21a9</a></li>`).join("")}</ol></section>`;
  }
  // \maketitle was rendered with the title known at that point; titles defined later are not applied (as in LaTeX)
  const text = html.replace(/<[^>]*>/g, " ");
  const words = (text.replace(/&[a-z#0-9]+;/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || []).length;
  return {
    html,
    title: unesc(stripTags(cv.title)).trim(),
    author: unesc(stripTags(cv.author)).trim(),
    date: unesc(stripTags(cv.date)).trim(),
    outline: cv.outline,
    labels: cv.labels,
    citations: cv.citations,
    bibliography: cv.bibResult || [],
    diagnostics: dedupe(cv.diagnostics),
    unsupported: [...cv.unsupportedSet],
    stats: { words, math: cv.math },
  };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((d) => {
    const k = `${d.code}|${d.line}|${d.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function emptyResult(message) {
  return { html: `<p class="tex-unsupported">${escapeText(message)}</p>`, title: "", author: "", date: "", outline: [], labels: {}, citations: [], bibliography: [], diagnostics: [{ severity: "error", code: "latex/internal", message, line: 1 }], unsupported: [], stats: { words: 0, math: 0 } };
}

/** CSS for the preview (`.tex-doc` container) and the exported page. */
export const LATEX_PREVIEW_CSS = `.tex-doc{font-family:"Latin Modern Roman","Computer Modern","Times New Roman",Georgia,serif;font-size:1.05rem;line-height:1.6;max-width:44rem;margin:0 auto}
.tex-doc h1,.tex-doc h2,.tex-doc h3,.tex-doc h4,.tex-doc h5{font-weight:700;line-height:1.25;margin:1.6em 0 .5em}
.tex-doc h2{font-size:1.45em}.tex-doc h3{font-size:1.2em}.tex-doc h4,.tex-doc h5{font-size:1em}.tex-doc h5{font-style:italic}
.tex-secno{margin-right:.6em}
.tex-titleblock{text-align:center;margin:0 0 2.2em}.tex-title{font-size:1.9em;margin:0 0 .4em}.tex-author{font-size:1.15em}.tex-date{margin-top:.4em}
.tex-abstract{margin:1.5em 2.5em}.tex-abstract h2{font-size:1em;text-align:center}
.tex-doc p{margin:0 0 .9em;text-align:justify;hyphens:auto}
.tex-doc img{max-width:100%;height:auto}
.tex-float{margin:1.4em 0;text-align:center}.tex-float figcaption{margin-top:.5em;font-size:.95em}.tex-caplabel{font-weight:700}
.tex-tabular{border-collapse:collapse;margin:0 auto}.tex-tabular td{padding:.2em .7em}.tex-tabular tr.tex-rule-top td{border-top:1px solid currentColor}.tex-tabular tr[data-rule-bottom] td{border-bottom:1px solid currentColor}
.tex-equation{display:flex;align-items:center;justify-content:center;gap:1em;margin:1em 0}.tex-equation .tex-math{flex:1}.tex-eqno{white-space:nowrap}
.tex-display{display:block;text-align:center;margin:1em 0;overflow-x:auto}
.tex-theorem{margin:1em 0}.tex-thm-plain{font-style:italic}.tex-thm-plain .tex-thm-head{font-style:normal}.tex-proof{margin:1em 0}.tex-qed{float:right}
.tex-verbatim{background:rgba(127,127,127,.12);padding:.7em 1em;border-radius:6px;overflow:auto;font-size:.9em}
.tex-quote{margin:1em 2em}.tex-center{text-align:center}.tex-flushright{text-align:right}
.tex-sc{font-variant:small-caps}.tex-sf{font-family:system-ui,sans-serif}.tex-large{font-size:1.2em}.tex-Large{font-size:1.44em}.tex-LARGE{font-size:1.73em}.tex-huge{font-size:2.07em}.tex-Huge{font-size:2.49em}.tex-footnotesize{font-size:.8em}.tex-scriptsize{font-size:.7em}.tex-tiny{font-size:.5em}
.tex-footnotes{font-size:.9em;margin-top:2.5em}.tex-bib{padding-left:1.6em}.tex-page-break{border-top:1px dashed rgba(127,127,127,.5);margin:1.5em 0}
.tex-unsupported,.tex-unsupported-env{background:rgba(255,170,0,.18);outline:1px dashed rgba(220,140,0,.8);border-radius:3px;padding:0 .2em;font-family:ui-monospace,Consolas,monospace;font-size:.85em}
.tex-unsupported-env{display:block;padding:.3em .6em;margin:.8em 0}
.tex-undefined,.tex-missing-image{color:#b45309;font-weight:700}.tex-toc ul{list-style:none;padding-left:0}.tex-toc-l3{padding-left:1.2em}.tex-toc-l4{padding-left:2.4em}.tex-note{opacity:.7}
@media print{.tex-unsupported{background:none;outline:none}.tex-page-break{break-after:page;border:0}}`;
