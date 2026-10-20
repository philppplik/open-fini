// ICU-lite message formatting (pure, no DOM, unit-tested in tests/i18n/format.test.js).
//
// Supported syntax:
//   {name}                                   named placeholder
//   {n, plural, =0 {none} one {# file} other {# files}}   plural (CLDR categories via Intl.PluralRules; "#" = the number)
//   {kind, select, a {…} b {…} other {…}}    select on a string value
//   \{  \}  \\                               literal braces / backslash (apostrophes are always literal)
//
// Public API: parseMessage(text) -> AST, formatMessage(text, params, locale) -> string,
//             placeholders(text) -> sorted unique argument names, validateMessage(text) -> error string | null.
// Invariants: never throws from formatMessage (a broken message is returned verbatim); parse results are cached.

const cache = new Map();

class ParseError extends Error {}

/** Parses `text` into [string | {arg} | {arg, type, options}] nodes. Throws ParseError on bad syntax. */
export function parseMessage(text) {
  const hit = cache.get(text);
  if (hit) return hit;
  let i = 0;
  const peek = () => text[i];

  function parseNodes(depth) {
    const out = [];
    let buf = "";
    const flush = () => {
      if (buf) out.push(buf), (buf = "");
    };
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\" && (text[i + 1] === "{" || text[i + 1] === "}" || text[i + 1] === "\\")) {
        buf += text[i + 1];
        i += 2;
      } else if (ch === "{") {
        flush();
        i++;
        out.push(parseArg(depth + 1));
      } else if (ch === "}") {
        if (depth === 0) throw new ParseError("Unmatched }");
        break;
      } else if (ch === "#" && depth > 0 && inPlural) {
        flush();
        out.push({ hash: true });
        i++;
      } else {
        buf += ch;
        i++;
      }
    }
    flush();
    return out;
  }

  let inPlural = false;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const word = () => {
    const s = i;
    while (i < text.length && /[^\s,{}]/.test(text[i])) i++;
    return text.slice(s, i);
  };

  function parseArg(depth) {
    ws();
    const arg = word();
    if (!arg) throw new ParseError("Empty placeholder");
    ws();
    if (peek() === "}") {
      i++;
      return { arg };
    }
    if (peek() !== ",") throw new ParseError(`Unexpected "${peek() ?? "end"}" after ${arg}`);
    i++;
    ws();
    const type = word();
    if (type !== "plural" && type !== "select") throw new ParseError(`Unknown argument type "${type}"`);
    ws();
    if (peek() !== ",") throw new ParseError(`Expected "," after ${type}`);
    i++;
    const options = {};
    for (;;) {
      ws();
      if (peek() === "}") {
        i++;
        break;
      }
      const key = word();
      if (!key) throw new ParseError("Missing option name");
      ws();
      if (peek() !== "{") throw new ParseError(`Expected "{" after ${key}`);
      i++;
      const saved = inPlural;
      inPlural = type === "plural";
      options[key] = parseNodes(depth);
      inPlural = saved;
      if (peek() !== "}") throw new ParseError(`Unclosed option ${key}`);
      i++;
    }
    if (!("other" in options)) throw new ParseError(`${type} of "${arg}" needs an "other" option`);
    return { arg, type, options };
  }

  const ast = parseNodes(0);
  if (i < text.length) throw new ParseError("Unmatched }");
  cache.size > 5000 && cache.clear();
  cache.set(text, ast);
  return ast;
}

/** Returns null when `text` is valid, otherwise a short error message. */
export function validateMessage(text) {
  try {
    parseMessage(text);
    return null;
  } catch (err) {
    return err instanceof ParseError ? err.message : String(err);
  }
}

/** Sorted unique argument names used by a message (including inside plural/select branches). */
export function placeholders(text) {
  const names = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (typeof n === "string" || n.hash) continue;
      names.add(n.arg);
      if (n.options) for (const k of Object.keys(n.options)) walk(n.options[k]);
    }
  };
  try {
    walk(parseMessage(text));
  } catch {
    /* invalid message: reported by validateMessage */
  }
  return [...names].sort();
}

const rulesCache = new Map();
function pluralCategory(n, locale) {
  try {
    let r = rulesCache.get(locale);
    if (!r) rulesCache.set(locale, (r = new Intl.PluralRules(locale)));
    return r.select(n);
  } catch {
    return n === 1 ? "one" : "other";
  }
}

function render(nodes, params, locale, num) {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") out += n;
    else if (n.hash) out += num;
    else if (!n.type) out += n.arg in params ? String(params[n.arg]) : `{${n.arg}}`;
    else if (n.type === "plural") {
      const v = Number(params[n.arg]);
      const formatted = Number.isFinite(v) ? new Intl.NumberFormat(locale).format(v) : String(params[n.arg]);
      const opts = n.options;
      const branch = opts[`=${v}`] || opts[pluralCategory(v, locale)] || opts.other;
      out += render(branch, params, locale, formatted);
    } else {
      const v = String(params[n.arg]);
      out += render(n.options[v] || n.options.other, params, locale, num);
    }
  }
  return out;
}

/** Formats `text` with `params` for `locale`. Plain text without `{` or `\` is returned untouched. */
export function formatMessage(text, params, locale = "en") {
  if (typeof text !== "string") return String(text ?? "");
  if (!text.includes("{") && !text.includes("\\")) return text;
  try {
    return render(parseMessage(text), params || {}, locale, "");
  } catch {
    return text;
  }
}
