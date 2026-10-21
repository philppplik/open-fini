// Formatters and minifiers for HTML, CSS, JavaScript and JSON. Pure string functions, no dependencies.
// Packed together with lib.js (the packer prepends every src/lib*.js file), so: no imports, no top-level side effects.

const WS = /\s/;

// ===================================================================== CSS

/** Parses CSS into a small tree: comment | decl | rule | at nodes. Tolerant: never throws. */
export function parseCss(src) {
  let i = 0;
  const n = src.length;
  const readString = (q) => {
    let s = src[i++];
    while (i < n && src[i] !== q) {
      if (src[i] === "\\") s += src[i++];
      s += src[i++] ?? "";
    }
    return s + (src[i++] ?? "");
  };
  function block(top) {
    const nodes = [];
    for (;;) {
      while (i < n && WS.test(src[i])) i++;
      if (i >= n) return nodes;
      if (src[i] === "}") {
        i++;
        if (top) continue;
        return nodes;
      }
      if (src.startsWith("/*", i)) {
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        nodes.push({ t: "comment", text: src.slice(i, stop) });
        i = stop;
        continue;
      }
      let pre = "";
      let paren = 0;
      let end = "";
      while (i < n) {
        const c = src[i];
        if (c === '"' || c === "'") pre += readString(c);
        else if (src.startsWith("/*", i)) {
          const e = src.indexOf("*/", i + 2);
          i = e < 0 ? n : e + 2;
        } else if (c === "(") (paren++, (pre += c), i++);
        else if (c === ")") (paren--, (pre += c), i++);
        else if (paren <= 0 && (c === "{" || c === ";" || c === "}")) {
          end = c;
          break;
        } else (pre += c, i++);
      }
      pre = pre.trim().replace(/\s+/g, " ");
      if (end === "{") {
        i++;
        const children = block(false);
        nodes.push(pre.startsWith("@") ? { t: "at", name: pre, children } : { t: "rule", sel: pre, children });
      } else {
        if (end === ";") i++;
        if (!pre) continue;
        if (pre.startsWith("@")) nodes.push({ t: "at", name: pre, children: null });
        else {
          const k = pre.indexOf(":");
          nodes.push(k < 0 ? { t: "decl", prop: pre, value: "" } : { t: "decl", prop: pre.slice(0, k).trim(), value: pre.slice(k + 1).trim() });
        }
      }
    }
  }
  return block(true);
}

function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  let q = "";
  for (const c of s) {
    if (q) {
      cur += c;
      if (c === q) q = "";
    } else if (c === '"' || c === "'") (q = c, (cur += c));
    else if (c === "(" || c === "[") (depth++, (cur += c));
    else if (c === ")" || c === "]") (depth--, (cur += c));
    else if (c === sep && depth === 0) (out.push(cur.trim()), (cur = ""));
    else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const declText = (d) => (d.value === "" ? `${d.prop};` : `${d.prop}: ${d.value};`);

export function formatCss(src, { indent = "  " } = {}) {
  const lines = [];
  const emit = (nodes, depth) => {
    nodes.forEach((nd, idx) => {
      const pad = indent.repeat(depth);
      if (nd.t === "comment") lines.push(...nd.text.split("\n").map((l, k) => (k ? l : pad + l.trimStart())));
      else if (nd.t === "decl") lines.push(`${pad}${declText(nd)}`);
      else {
        const head = nd.t === "rule" ? splitTop(nd.sel, ",").join(`,\n${pad}`) : nd.name;
        if (nd.children === null) lines.push(`${pad}${head};`);
        else if (!nd.children.length) lines.push(`${pad}${head} {}`);
        else {
          lines.push(`${pad}${head} {`);
          emit(nd.children, depth + 1);
          lines.push(`${pad}}`);
        }
        if (depth === 0 && idx < nodes.length - 1) lines.push("");
      }
    });
  };
  emit(parseCss(src), 0);
  return `${lines.join("\n")}\n`.replace(/^\n+/, "");
}

export function minifyCss(src) {
  const out = (nodes) =>
    nodes
      .filter((nd) => nd.t !== "comment" || /^\/\*!/.test(nd.text))
      .map((nd) => {
        if (nd.t === "comment") return nd.text;
        if (nd.t === "decl") return nd.value === "" ? nd.prop : `${nd.prop}:${nd.value.replace(/\s*,\s*/g, ",")}`;
        const head = nd.t === "rule" ? splitTop(nd.sel, ",").map((s) => s.replace(/\s*([>+~])\s*/g, "$1")).join(",") : nd.name;
        if (nd.children === null) return `${head};`;
        const body = nd.children.some((c) => c.t !== "decl") ? out(nd.children) : nd.children.filter((c) => c.t !== "comment").map((c) => (c.value === "" ? c.prop : `${c.prop}:${c.value.replace(/\s*,\s*/g, ",")}`)).join(";");
        return `${head}{${body}}`;
      })
      .join(nodes.every((c) => c.t === "decl") ? ";" : "");
  return out(parseCss(src));
}

/** Sorts declarations alphabetically inside every rule (vendor prefixes sort with their base property). */
export function sortCssProperties(src) {
  const key = (p) => p.replace(/^-(webkit|moz|ms|o)-/, "") + (/^-/.test(p) ? "~" : "");
  const sortNodes = (nodes) => {
    const out = [];
    let run = [];
    const flush = () => {
      out.push(...run.sort((a, b) => (key(a.prop) < key(b.prop) ? -1 : key(a.prop) > key(b.prop) ? 1 : 0)));
      run = [];
    };
    for (const nd of nodes) {
      if (nd.t === "decl") run.push(nd);
      else {
        flush();
        out.push(nd.children ? { ...nd, children: sortNodes(nd.children) } : nd);
      }
    }
    flush();
    return out;
  };
  const nodes = sortNodes(parseCss(src));
  return formatCssNodes(nodes);
}

function formatCssNodes(nodes) {
  // Re-print through formatCss by serializing minimally first (keeps the formatter the single source of layout).
  const ser = (list) => list.map((nd) => (nd.t === "comment" ? nd.text : nd.t === "decl" ? declText(nd) : nd.children === null ? `${nd.name};` : `${nd.t === "rule" ? nd.sel : nd.name}{${ser(nd.children)}}`)).join("\n");
  return formatCss(ser(nodes));
}

// ===================================================================== JSON

export function formatJson(src, { indent = 2, sortKeys = false } = {}) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  const v = JSON.parse(src);
  return `${JSON.stringify(sortKeys ? sort(v) : v, null, indent)}\n`;
}
export const minifyJson = (src) => JSON.stringify(JSON.parse(src));

// ===================================================================== JavaScript

const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const isWord = (s) => /^[A-Za-z0-9_$\\]/.test(s) || s.charCodeAt(0) > 127;

/** Splits JavaScript into tokens: {k: "ws"|"nl"|"comment"|"line"|"str"|"tpl"|"re"|"word"|"punc", v}. Tolerant. */
export function tokenizeJs(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const lastSig = () => {
    for (let j = toks.length - 1; j >= 0; j--) if (toks[j].k !== "ws" && toks[j].k !== "nl" && toks[j].k !== "comment" && toks[j].k !== "line") return toks[j];
    return null;
  };
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      toks.push({ k: "nl", v: "\n" });
      i++;
    } else if (/\s/.test(c)) {
      let j = i;
      while (j < n && src[j] !== "\n" && /\s/.test(src[j])) j++;
      toks.push({ k: "ws", v: src.slice(i, j) });
      i = j;
    } else if (c === "/" && src[i + 1] === "/") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      toks.push({ k: "line", v: src.slice(i, j).trimEnd() });
      i = j;
    } else if (c === "/" && src[i + 1] === "*") {
      const j = src.indexOf("*/", i + 2);
      const stop = j < 0 ? n : j + 2;
      toks.push({ k: "comment", v: src.slice(i, stop) });
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      toks.push({ k: "str", v: src.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "$" && src[j + 1] === "{") (depth++, (j += 2));
        else if (src[j] === "}" && depth) (depth--, j++);
        else if (src[j] === "`" && !depth) break;
        else j++;
      }
      toks.push({ k: "tpl", v: src.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "/") {
      const p = lastSig();
      const regexOk = !p || (p.k === "punc" && ![")", "]", "}"].includes(p.v)) || (p.k === "word" && KEYWORDS_BEFORE_REGEX.has(p.v));
      if (regexOk) {
        let j = i + 1;
        let cls = false;
        while (j < n && src[j] !== "\n") {
          if (src[j] === "\\") j++;
          else if (src[j] === "[") cls = true;
          else if (src[j] === "]") cls = false;
          else if (src[j] === "/" && !cls) break;
          j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        toks.push({ k: "re", v: src.slice(i, j) });
        i = j;
      } else {
        const m = /^(\/=|\/)/.exec(src.slice(i, i + 2));
        toks.push({ k: "punc", v: m[1] });
        i += m[1].length;
      }
    } else if (/[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127 || (c === "." && /\d/.test(src[i + 1] || ""))) {
      let j = i;
      while (j < n && (/[A-Za-z0-9_$.]/.test(src[j]) && !(src[j] === "." && !/\d/.test(src.slice(i, j))) || src.charCodeAt(j) > 127)) j++;
      if (j === i) j++;
      toks.push({ k: "word", v: src.slice(i, j) });
      i = j;
    } else {
      const m = /^(>>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|%=|&=|\|=|\^=|<<|>>|\*\*|.)/s.exec(src.slice(i, i + 4));
      toks.push({ k: "punc", v: m[1] });
      i += m[1].length;
    }
  }
  return toks;
}

const BINARY = new Set(["=", "==", "===", "!=", "!==", "<", ">", "<=", ">=", "+", "-", "*", "/", "%", "**", "&&", "||", "??", "&", "|", "^", "<<", ">>", ">>>", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "&&=", "||=", "??=", "=>", "?"]);
const CONTROL = new Set(["if", "for", "while", "switch", "catch", "with"]);

/**
 * Pretty-prints JavaScript. Conservative: never adds or removes tokens, only whitespace; original line breaks outside
 * parentheses are kept so code that relies on automatic semicolon insertion keeps working.
 */
export function formatJs(src, { indent = "  " } = {}) {
  const toks = tokenizeJs(src).filter((t) => t.k !== "ws");
  const out = [];
  let line = "";
  let depth = 0;
  const stack = []; // "{" "(" "["
  let ternary = 0;
  let caseColon = false;
  const caseOpen = [];
  let blank = false;
  let prev = null; // previous significant token
  let sawNl = false;
  const pushLine = () => {
    if (line.trim()) out.push(line.replace(/\s+$/, ""));
    line = "";
  };
  const newline = () => {
    pushLine();
  };
  const write = (s) => {
    if (!line) line = indent.repeat(Math.max(0, depth));
    line += s;
  };
  const inParen = () => stack.includes("(") || stack[stack.length - 1] === "[";
  const needSpace = (t) => {
    if (!prev || !line.trim()) return false;
    const a = prev.v;
    const b = t.v;
    if (prev.k === "punc" && ["(", "[", "!", "~", ".", "?.", "..."].includes(a)) return false;
    if (a === "{") return !line.trimEnd().endsWith("${");
    if (t.k === "punc" && [")", "]", ".", "?.", ",", ";", "++", "--", ":"].includes(b)) return b === ":" ? ternary > 0 : false;
    if (t.k === "punc" && b === "(") return prev.k === "word" ? CONTROL.has(a) || a === "function" || a === "return" || a === "await" || a === "typeof" || a === "else" || a === "in" || a === "of" : prev.k === "punc" && (BINARY.has(a) || a === ":" || a === ",") ;
    if (t.k === "punc" && b === "[") return (prev.k === "word" && ["return", "typeof", "in", "of", "case", "else"].includes(a)) || (prev.k === "punc" && (BINARY.has(a) || a === "," || a === ":"));
    if (t.k === "punc" && b === "{") return true;
    if (prev.k === "punc" && (a === "++" || a === "--")) return t.k === "word" && false;
    if (prev.k === "punc" && (a === "+" || a === "-") && prev.unary) return false;
    if (prev.k === "punc" && (a === ")" || a === "]")) return !(t.k === "punc" && [")", "]", ".", "?.", ",", ";", "(", "["].includes(b));
    if (prev.k === "punc" && (a === "," || a === ";")) return true;
    if (prev.k === "punc" && a === ":") return true;
    if (prev.k === "punc" && BINARY.has(a)) return true;
    if (t.k === "punc" && BINARY.has(b)) return !(t.unary);
    if (prev.k === "punc" && a === "}") return true;
    if (prev.k !== "punc" && t.k !== "punc") return true;
    if (prev.k !== "punc" && t.k === "punc" && (b === "=>" )) return true;
    if (t.k === "punc" && !BINARY.has(b) && b !== "{") return false;
    if (prev.k !== "punc" && t.k === "punc") return false;
    return t.k !== "punc" || BINARY.has(b);
  };
  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.k === "nl") {
      if (sawNl) blank = true;
      sawNl = true;
      continue;
    }
    // original newline handling
    if (sawNl && !inParen() && line.trim() && !(prev && prev.k === "punc" && ["{", "(", "[", ",", ".", "?.", "=>", "=", "?", ":"].includes(prev.v) && prev.v !== ":" )) {
      const next = t;
      const continues = next.k === "punc" && [".", "?.", ",", ")", "]", "}", "?", ":", "=>", "&&", "||", "??", "+", "*", "/", "%", "=", "==", "===", "!=", "!==", "<", ">", "<=", ">="].includes(next.v);
      if (!continues && !(prev && prev.k === "punc" && BINARY.has(prev.v))) newline();
    }
    if (blank && !line.trim() && out.length && out[out.length - 1] !== "") out.push("");
    blank = false;
    const sawNlBefore = sawNl;
    sawNl = false;
    if (t.k === "comment") {
      if (line.trim()) line += " ";
      else write("");
      line += t.v;
      continue;
    }
    if (t.k === "line") {
      if (line.trim()) line += " ";
      else write("");
      line += t.v;
      newline();
      continue;
    }
    if (t.k === "punc") {
      const v = t.v;
      if ((v === "+" || v === "-") && (!prev || (prev.k === "punc" && ![")", "]", "}", "++", "--"].includes(prev.v)) || (prev.k === "word" && KEYWORDS_BEFORE_REGEX.has(prev.v)))) t.unary = true;
      if (v === "{") {
        if (needSpace(t)) line += " ";
        else if (!line) write("");
        write("{");
        const next = toks.slice(idx + 1).find((x) => x.k !== "nl");
        stack.push("{");
        caseOpen.push(false);
        depth++;
        if (next && next.k === "punc" && next.v === "}") {
          // empty block: keep "{}" together
          depth--;
          stack.pop();
          caseOpen.pop();
          line += "}";
          idx = toks.indexOf(next, idx + 1);
          prev = next;
          continue;
        }
        newline();
        prev = t;
        continue;
      }
      if (v === "}") {
        if (stack[stack.length - 1] === "{") {
          stack.pop();
          if (caseOpen.pop()) depth = Math.max(0, depth - 1);
        }
        depth = Math.max(0, depth - 1);
        newline();
        write("}");
        const next = toks.slice(idx + 1).find((x) => x.k !== "nl");
        const same = next && ((next.k === "word" && ["else", "catch", "finally", "while"].includes(next.v)) || (next.k === "punc" && [")", ",", ";", ".", "]", "?.", "(" ].includes(next.v)));
        if (!same) newline();
        prev = t;
        continue;
      }
      if (v === ";") {
        line += ";";
        if (stack[stack.length - 1] !== "(") newline();
        prev = t;
        continue;
      }
      if (v === ",") {
        line += ",";
        if (stack[stack.length - 1] === "{") newline();
        prev = t;
        continue;
      }
      if (v === "(" || v === "[") {
        if (needSpace(t)) line += " ";
        else if (!line) write("");
        line += v;
        stack.push(v);
        prev = t;
        continue;
      }
      if (v === ")" || v === "]") {
        stack.pop();
        line += v;
        prev = t;
        continue;
      }
      if (v === "?") ternary++;
      if (v === ":") {
        if (caseColon && stack[stack.length - 1] === "{") {
          line += ":";
          caseColon = false;
          caseOpen[caseOpen.length - 1] = true;
          depth++;
          newline();
          prev = t;
          continue;
        }
        if (ternary > 0) {
          ternary--;
          line += " :";
        } else line += ":";
        prev = t;
        continue;
      }
      if (needSpace(t)) line += " ";
      else if (!line) write("");
      line += v;
      prev = t;
      continue;
    }
    // words, strings, templates, regex
    if (t.k === "word" && (t.v === "case" || t.v === "default") && stack[stack.length - 1] === "{" && (!prev || (prev.k === "punc" && ["{", "}", ":", ";"].includes(prev.v)) || sawNlBefore)) {
      caseColon = true;
      if (caseOpen[caseOpen.length - 1]) {
        caseOpen[caseOpen.length - 1] = false;
        depth = Math.max(0, depth - 1);
        newline();
      }
    }
    if (needSpace(t)) line += " ";
    else if (!line) write("");
    line += t.v;
    prev = t;
  }
  newline();
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** Removes comments and unneeded whitespace. Keeps line breaks that automatic semicolon insertion may depend on. */
export function minifyJs(src) {
  const toks = tokenizeJs(src);
  let out = "";
  let prev = null;
  let nl = false;
  let space = false;
  for (const t of toks) {
    if (t.k === "comment" || t.k === "line") {
      if (t.k === "comment" && /\n/.test(t.v)) nl = true;
      else space = true;
      continue;
    }
    if (t.k === "nl") (nl = true, (space = true));
    else if (t.k === "ws") space = true;
    else {
      if (prev) {
        const a = prev.v;
        const asi = nl && !(prev.k === "punc" && [";", "{", ",", "(", "[", "=", ":", "?", "+", "-", "*", "/", "&&", "||", "=>", "."].includes(a)) && !(t.k === "punc" && [")", "]", "}", ".", ",", ";", "?", ":", "=", "+", "*", "&&", "||", "=>"].includes(t.v));
        if (asi) out += "\n";
        else if (space && ((isWord(a[a.length - 1]) || ["str", "tpl", "re"].includes(prev.k)) && (isWord(t.v[0]) || ["str", "tpl", "re"].includes(t.k)) || (prev.k === "punc" && t.k === "punc" && /^[+\-]$/.test(a) && /^[+\-]/.test(t.v) && a[0] === t.v[0]) || (prev.k === "punc" && a === "/" && t.k === "re"))) out += " ";
        else if (prev.k === "word" && t.k === "word") out += " ";
      }
      out += t.v;
      prev = t;
      nl = false;
      space = false;
    }
  }
  return out;
}

// ===================================================================== HTML

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "label", "button", "select", "textarea", "img", "input", "br", "wbr"]);
const RAW = new Set(["pre", "script", "style", "textarea"]);

/** Tokenizes HTML into {k: "text"|"open"|"close"|"self"|"comment"|"doctype"|"raw", v, tag}. */
export function tokenizeHtml(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] !== "<") {
      let j = src.indexOf("<", i);
      if (j < 0) j = n;
      toks.push({ k: "text", v: src.slice(i, j) });
      i = j;
    } else if (src.startsWith("<!--", i)) {
      const j = src.indexOf("-->", i + 4);
      const stop = j < 0 ? n : j + 3;
      toks.push({ k: "comment", v: src.slice(i, stop) });
      i = stop;
    } else if (/^<!doctype/i.test(src.slice(i, i + 9))) {
      const j = src.indexOf(">", i);
      const stop = j < 0 ? n : j + 1;
      toks.push({ k: "doctype", v: src.slice(i, stop).replace(/\s+/g, " ") });
      i = stop;
    } else {
      const m = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(src.slice(i, i + 80));
      if (!m) {
        toks.push({ k: "text", v: "<" });
        i++;
        continue;
      }
      let j = i + m[0].length;
      let q = "";
      while (j < n && !(src[j] === ">" && !q)) {
        if (q) {
          if (src[j] === q) q = "";
        } else if (src[j] === '"' || src[j] === "'") q = src[j];
        j++;
      }
      const raw = src.slice(i, j + 1);
      const tag = m[2].toLowerCase();
      const attrs = raw.slice(m[0].length, raw.length - 1).replace(/\/\s*$/, "").trim().replace(/\s+/g, " ");
      const selfClose = /\/\s*>$/.test(raw);
      i = j + 1;
      if (m[1]) toks.push({ k: "close", tag, v: `</${tag}>` });
      else {
        const open = `<${m[2]}${attrs ? ` ${attrs}` : ""}${selfClose ? " /" : ""}>`;
        if (RAW.has(tag) && !selfClose) {
          const re = new RegExp(`</${tag}\\s*>`, "i");
          const mm = re.exec(src.slice(i));
          const stop = mm ? i + mm.index : n;
          toks.push({ k: "raw", tag, open, body: src.slice(i, stop), v: `</${tag}>` });
          i = mm ? stop + mm[0].length : n;
        } else toks.push({ k: selfClose || VOID.has(tag) ? "self" : "open", tag, v: open });
      }
    }
  }
  return toks;
}

function formatEmbedded(tag, open, body, indentStr, depth) {
  const pad = indentStr.repeat(depth + 1);
  if (tag === "pre" || tag === "textarea") return null;
  const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(open)?.[1] || "";
  let text = body;
  try {
    if (tag === "style") text = formatCss(body, { indent: indentStr });
    else if (tag === "script" && (!type || /javascript|module/.test(type))) text = formatJs(body, { indent: indentStr });
    else if (tag === "script" && /json/.test(type)) text = formatJson(body, { indent: indentStr.length });
    else return body.trim() ? body : "";
  } catch {
    return body;
  }
  return text.trim() ? text.trimEnd().split("\n").map((l) => (l ? pad + l : l)).join("\n") : "";
}

/** When a block element holds only text and inline elements, returns its markup as one line and the index of its end tag. */
function oneLine(toks, i) {
  const tag = toks[i].tag;
  let text = toks[i].v;
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t.k === "text") text += t.v.replace(/\s+/g, " ");
    else if (t.k === "close" && t.tag === tag) return { text: (text + t.v).replace(/^(<[^>]+>)\s+/, "$1").replace(/\s+(<\/[^>]+>)$/, "$1"), end: j };
    else if (INLINE.has(t.tag) && t.k !== "raw") text += t.v;
    else return null;
  }
  return null;
}

export function formatHtml(src, { indent = "  " } = {}) {
  const toks = tokenizeHtml(src);
  const lines = [];
  let depth = 0;
  let inline = "";
  const flush = () => {
    const t = inline.replace(/\s+/g, " ").trim();
    if (t) lines.push(indent.repeat(depth) + t);
    inline = "";
  };
  let skipTo = -1;
  for (const [ti, t] of toks.entries()) {
    if (ti <= skipTo) continue;
    if (t.k === "text") inline += t.v;
    else if (t.k === "comment" || t.k === "doctype") (flush(), lines.push(indent.repeat(depth) + t.v));
    else if (t.k === "raw") {
      flush();
      const body = formatEmbedded(t.tag, t.open, t.body, indent, depth);
      if (body === null) lines.push(indent.repeat(depth) + t.open + t.body + t.v);
      else if (!body.trim()) lines.push(indent.repeat(depth) + t.open + t.v);
      else lines.push(indent.repeat(depth) + t.open, body.replace(/\n+$/, ""), indent.repeat(depth) + t.v);
    } else if (INLINE.has(t.tag)) inline += t.v;
    else if (t.k === "open") {
      flush();
      const single = oneLine(toks, ti);
      if (single && indent.repeat(depth).length + single.text.length <= 100) {
        lines.push(indent.repeat(depth) + single.text);
        skipTo = single.end;
      } else (lines.push(indent.repeat(depth) + t.v), depth++);
    }
    else if (t.k === "close") (flush(), (depth = Math.max(0, depth - 1)), lines.push(indent.repeat(depth) + t.v));
    else (flush(), lines.push(indent.repeat(depth) + t.v));
  }
  flush();
  return `${lines.join("\n")}\n`;
}

export function minifyHtml(src) {
  const toks = tokenizeHtml(src);
  let out = "";
  for (const t of toks) {
    if (t.k === "comment" && !/^<!--\[if/.test(t.v)) continue;
    if (t.k === "text") out += t.v.replace(/\s+/g, " ");
    else if (t.k === "raw") {
      let body = t.body;
      try {
        if (t.tag === "style") body = minifyCss(body);
        else if (t.tag === "script" && !/json|template/.test(t.open) ) body = minifyJs(body);
      } catch { /* keep */ }
      out += t.open + (t.tag === "pre" || t.tag === "textarea" ? t.body : body) + t.v;
    } else out += t.v;
  }
  return out.replace(/>\s+</g, "><").trim();
}

// ===================================================================== dispatch

/** "html" | "css" | "js" | "json" | null from a file path. */
export function detectLanguage(path) {
  const e = String(path).split(".").pop().toLowerCase();
  return { html: "html", htm: "html", css: "css", js: "js", mjs: "js", cjs: "js", json: "json", webmanifest: "json", svg: "html" }[e] || null;
}

export function formatCode(lang, text, o) {
  return { html: formatHtml, css: formatCss, js: formatJs, json: formatJson }[lang](text, o);
}
export function minifyCode(lang, text) {
  return { html: minifyHtml, css: minifyCss, js: minifyJs, json: minifyJson }[lang](text);
}
