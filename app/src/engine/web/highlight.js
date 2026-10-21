// Small syntax highlighter for rendered Markdown code blocks and LaTeX listings. Pure: no DOM. It is intentionally
// simple (a tokenizer per language family built from sticky regular expressions), not a parser: good enough to make
// code readable in a preview. The editor itself uses CodeMirror. Class names follow CodeMirror's classHighlighter
// (`tok-keyword`, `tok-string`, ...), so one stylesheet can serve both.

/** @param {string} s */
export function escapeCode(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const JS_KEYWORDS = words(`break case catch class const continue debugger default delete do else export extends finally for function if
  import in instanceof let new of return static super switch this throw try typeof var void while with yield async await from as
  get set interface type enum implements public private protected readonly declare namespace abstract keyof satisfies`);
const JS_ATOMS = words("true false null undefined NaN Infinity");
const PY_KEYWORDS = words(`and as assert async await break class continue def del elif else except finally for from global if import in is
  lambda nonlocal not or pass raise return try while with yield match case`);
const PY_ATOMS = words("True False None self cls");
const SH_KEYWORDS = words("if then else elif fi for while until do done case esac function in select time return exit export local readonly unset source alias echo cd set");
const SQL_KEYWORDS = words(`select from where insert into values update set delete create table alter drop index view join left right inner outer full
  on as and or not null is in like between group by order having limit offset union all distinct primary key foreign references default
  case when then else end count sum avg min max asc desc with`);
const GO_KEYWORDS = words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var");
const RUST_KEYWORDS = words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while");
const C_KEYWORDS = words(`auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed
  sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected new delete using bool true false nullptr`);

/** A language is a list of [className, RegExp(sticky)] rules plus an optional identifier classifier. */
const sticky = (re) => new RegExp(re.source, re.flags.includes("y") ? re.flags : re.flags + "y");

const JS_RULES = [
  ["tok-comment", sticky(/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/)],
  ["tok-string", sticky(/"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\[\s\S])*`?/)],
  ["tok-number", sticky(/0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?|\.\d+/)],
  ["tok-regexp", sticky(/\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuvy]*(?=\s*(?:[,;)\].]|$))/)],
];
const PY_RULES = [
  ["tok-comment", sticky(/#[^\n]*/)],
  ["tok-string", sticky(/(?:[rbfuRBFU]{0,2})(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/)],
  ["tok-number", sticky(/0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?j?/)],
  ["tok-meta", sticky(/@[A-Za-z_][\w.]*/)],
];
const SH_RULES = [
  ["tok-comment", sticky(/#[^\n]*/)],
  ["tok-string", sticky(/"(?:[^"\\]|\\[\s\S])*"?|'[^']*'?/)],
  ["tok-variable", sticky(/\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9@#?$!*-])/)],
  ["tok-number", sticky(/\b\d+\b/)],
];
const SQL_RULES = [
  ["tok-comment", sticky(/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/)],
  ["tok-string", sticky(/'(?:[^']|'')*'?/)],
  ["tok-number", sticky(/\d+(?:\.\d+)?/)],
];
const CSS_RULES = [
  ["tok-comment", sticky(/\/\*[\s\S]*?(?:\*\/|$)/)],
  ["tok-string", sticky(/"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/)],
  ["tok-keyword", sticky(/@[\w-]+/)],
  ["tok-number", sticky(/#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch|vmin|vmax)?/)],
  ["tok-propertyName", sticky(/--?[A-Za-z][\w-]*(?=\s*:)/)],
];
const YAML_RULES = [
  ["tok-comment", sticky(/#[^\n]*/)],
  ["tok-string", sticky(/"(?:[^"\\\n]|\\.)*"?|'(?:[^'\n]|'')*'?/)],
  ["tok-propertyName", sticky(/[A-Za-z_][\w. -]*(?=:(?:\s|$))/)],
  ["tok-number", sticky(/-?\d+(?:\.\d+)?\b/)],
  ["tok-keyword", sticky(/(?:true|false|null|yes|no|on|off)\b/)],
  ["tok-operator", sticky(/^\s*-(?=\s)/)],
];
const TOML_RULES = [
  ["tok-comment", sticky(/#[^\n]*/)],
  ["tok-string", sticky(/"""[\s\S]*?(?:"""|$)|"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?/)],
  ["tok-heading", sticky(/\[\[?[^\]\n]+\]\]?/)],
  ["tok-propertyName", sticky(/[A-Za-z_][\w.-]*(?=\s*=)/)],
  ["tok-number", sticky(/-?\d[\d_]*(?:\.\d+)?/)],
  ["tok-keyword", sticky(/(?:true|false)\b/)],
];
const JSON_RULES = [
  ["tok-propertyName", sticky(/"(?:[^"\\\n]|\\.)*"(?=\s*:)/)],
  ["tok-string", sticky(/"(?:[^"\\\n]|\\.)*"?/)],
  ["tok-number", sticky(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)],
  ["tok-keyword", sticky(/(?:true|false|null)\b/)],
];
const DIFF_LINE = [
  ["tok-inserted", /^\+(?!\+\+)/],
  ["tok-deleted", /^-(?!--)/],
  ["tok-heading", /^@@/],
  ["tok-meta", /^(?:diff |index |\+\+\+ |--- )/],
];
const C_RULES = [
  ["tok-comment", sticky(/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/)],
  ["tok-string", sticky(/"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/)],
  ["tok-meta", sticky(/#\s*[a-z]+/)],
  ["tok-number", sticky(/0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?[fFuUlL]*/)],
];

const LANGS = {
  js: { rules: JS_RULES, keywords: JS_KEYWORDS, atoms: JS_ATOMS },
  python: { rules: PY_RULES, keywords: PY_KEYWORDS, atoms: PY_ATOMS },
  bash: { rules: SH_RULES, keywords: SH_KEYWORDS, atoms: new Set(), dashIdent: true },
  sql: { rules: SQL_RULES, keywords: SQL_KEYWORDS, atoms: new Set(), ci: true },
  css: { rules: CSS_RULES, keywords: new Set(), atoms: new Set() },
  yaml: { rules: YAML_RULES, keywords: new Set(), atoms: new Set() },
  toml: { rules: TOML_RULES, keywords: new Set(), atoms: new Set() },
  json: { rules: JSON_RULES, keywords: new Set(), atoms: new Set() },
  go: { rules: JS_RULES.slice(0, 3), keywords: GO_KEYWORDS, atoms: words("true false nil iota") },
  rust: { rules: JS_RULES.slice(0, 3), keywords: RUST_KEYWORDS, atoms: words("true false None Some Ok Err") },
  c: { rules: C_RULES, keywords: C_KEYWORDS, atoms: new Set() },
};

const ALIASES = {
  js: "js", javascript: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", typescript: "js", tsx: "js", node: "js",
  json: "json", jsonc: "json", json5: "json",
  py: "python", python: "python", python3: "python",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash", console: "bash", shellsession: "bash",
  sql: "sql", css: "css", scss: "css", less: "css",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "toml", conf: "toml",
  go: "go", golang: "go", rust: "rust", rs: "rust",
  c: "c", cpp: "c", "c++": "c", h: "c", hpp: "c", cs: "c", csharp: "c", java: "c", kotlin: "c", swift: "c",
  html: "html", htm: "html", xml: "html", svg: "html", vue: "html", xhtml: "html", markup: "html",
  diff: "diff", patch: "diff",
  tex: "tex", latex: "tex", bibtex: "tex", bib: "tex",
};

/**
 * Normalizes a fence info string or file extension to a supported language id, or null.
 * @param {string} lang
 * @returns {string|null}
 */
export function languageId(lang) {
  const key = String(lang || "").trim().toLowerCase().split(/[\s{,]/)[0];
  return ALIASES[key] || null;
}

const span = (cls, text) => (cls ? `<span class="${cls}">${escapeCode(text)}</span>` : escapeCode(text));

function highlightWith(code, def) {
  let out = "";
  let i = 0;
  const n = code.length;
  let plain = "";
  const flush = () => {
    if (plain) out += escapeCode(plain);
    plain = "";
  };
  while (i < n) {
    let hit = null;
    for (const [cls, re] of def.rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length) {
        hit = [cls, m[0]];
        break;
      }
    }
    if (hit) {
      flush();
      out += span(hit[0], hit[1]);
      i += hit[1].length;
      continue;
    }
    const ch = code[i];
    if (/[A-Za-z_$\u0080-￿]/.test(ch)) {
      let j = i + 1;
      while (j < n && (/[\w$\u0080-￿]/.test(code[j]) || (def.dashIdent && code[j] === "-" && /[A-Za-z]/.test(code[j + 1] || "")))) j++;
      const word = code.slice(i, j);
      const key = def.ci ? word.toLowerCase() : word;
      flush();
      if (def.keywords.has(key)) out += span("tok-keyword", word);
      else if (def.atoms.has(key)) out += span("tok-atom", word);
      else if (code[j] === "(" ) out += span("tok-function", word);
      else if (/^[A-Z][A-Za-z0-9]*$/.test(word) && def.keywords.size) out += span("tok-typeName", word);
      else out += escapeCode(word);
      i = j;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

function highlightHtml(code) {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    if (code.startsWith("<!--", i)) {
      const e = code.indexOf("-->", i + 4);
      const end = e < 0 ? n : e + 3;
      out += span("tok-comment", code.slice(i, end));
      i = end;
    } else if (code[i] === "<" && /[A-Za-z/!?]/.test(code[i + 1] || "")) {
      let j = i + 1;
      const head = /^<\/?[A-Za-z0-9:-]*|^<[!?][^\s>]*/.exec(code.slice(i, i + 80));
      out += span("tok-tag", head[0]);
      j = i + head[0].length;
      // attributes until '>'
      while (j < n && code[j] !== ">") {
        const rest = code.slice(j, j + 400);
        let m;
        if ((m = /^\s+/.exec(rest))) {
          out += escapeCode(m[0]);
          j += m[0].length;
        } else if ((m = /^(?:"[^"]*"?|'[^']*'?)/.exec(rest))) {
          out += span("tok-string", m[0]);
          j += m[0].length;
        } else if ((m = /^[^\s=>/"']+/.exec(rest))) {
          out += span("tok-attributeName", m[0]);
          j += m[0].length;
        } else {
          out += escapeCode(code[j]);
          j++;
        }
      }
      if (j < n) {
        out += span("tok-tag", ">");
        j++;
      }
      i = j;
    } else {
      let j = code.indexOf("<", i + 1);
      if (j < 0) j = n;
      out += escapeCode(code.slice(i, j));
      i = j;
    }
  }
  return out;
}

function highlightDiff(code) {
  return code
    .split("\n")
    .map((line) => {
      for (const [cls, re] of DIFF_LINE) if (re.test(line)) return span(cls, line);
      return escapeCode(line);
    })
    .join("\n");
}

function highlightTex(code) {
  let out = "";
  const re = /%[^\n]*|\\[A-Za-z@]+\*?|\\[^A-Za-z]|\$\$?|[{}[\]&]/y;
  let i = 0;
  let plain = "";
  while (i < code.length) {
    re.lastIndex = i;
    const m = re.exec(code);
    if (m && m.index === i) {
      if (plain) out += escapeCode(plain);
      plain = "";
      const t = m[0];
      const cls = t[0] === "%" ? "tok-comment" : t[0] === "\\" ? "tok-keyword" : t[0] === "$" ? "tok-string" : "tok-bracket";
      out += span(cls, t);
      i += t.length;
    } else {
      plain += code[i++];
    }
  }
  if (plain) out += escapeCode(plain);
  return out;
}

/**
 * Highlights `code` as HTML (always escaped). Unknown languages are returned escaped without spans.
 * Inputs above 200 000 characters are not highlighted to keep the preview responsive.
 * @param {string} code
 * @param {string} [lang] fence info string, extension or language name
 * @returns {string}
 */
export function highlight(code, lang) {
  const text = String(code ?? "");
  const id = languageId(lang);
  if (!id || text.length > 200000) return escapeCode(text);
  try {
    if (id === "html") return highlightHtml(text);
    if (id === "diff") return highlightDiff(text);
    if (id === "tex") return highlightTex(text);
    return highlightWith(text, LANGS[id]);
  } catch {
    return escapeCode(text);
  }
}
