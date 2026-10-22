// VS Code snippets -> CodeMirror snippet templates. Pure (no DOM), unit-tested in tests/vscode.
//
// Public API
//   parseSnippetBody(text)          -> AST nodes of the VS Code snippet syntax:
//                                      { t: "text", v } | { t: "tab", n, kids } | { t: "choice", n, options } | { t: "var", name, kids }
//   toCodeMirror(text, vars?)       -> a CodeMirror template (`${1:default}`, `${0}`) with variables resolved
//   parseSnippetFile(text, language) -> [{ prefix: string[], label, body, description, language }]
//   snippetVariables(ctx)           -> values for TM_FILENAME, TM_SELECTED_TEXT, CURRENT_YEAR, … (VS Code names)
//
// Supported syntax: `$1`, `${1}`, `${1:default}` (nested placeholders become text), `${1|a,b|}` (first option as
// default), `$0` (final cursor), `$NAME` / `${NAME}` / `${NAME:default}` variables, `\$ \} \\` escapes.
// Not supported: regex transforms (`${TM_FILENAME/(.*)/${1:/upcase}/}`: the variable value is used unchanged).
// CodeMirror placeholders cannot contain braces, so braces inside defaults are dropped; literal braces in text are
// escaped (`\{`), which CodeMirror turns back into braces.
import { parseJsonc } from "./jsonc.js";

const VAR_RE = /^[_a-zA-Z][_a-zA-Z0-9]*/;

/** Parses VS Code snippet syntax into nodes. Never throws: malformed parts are kept as text. */
export function parseSnippetBody(text) {
  const s = String(text ?? "");
  let i = 0;
  const parse = (stop) => {
    const out = [];
    let buf = "";
    const flush = () => {
      if (buf) out.push({ t: "text", v: buf });
      buf = "";
    };
    while (i < s.length) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length && "$}\\,|".includes(s[i + 1])) {
        buf += s[i + 1];
        i += 2;
        continue;
      }
      if (stop && stop.includes(c)) break;
      if (c !== "$") {
        buf += c;
        i++;
        continue;
      }
      const rest = s.slice(i + 1);
      let m;
      if ((m = /^\d+/.exec(rest))) {
        flush();
        out.push({ t: "tab", n: +m[0], kids: [] });
        i += 1 + m[0].length;
      } else if ((m = VAR_RE.exec(rest))) {
        flush();
        out.push({ t: "var", name: m[0], kids: null });
        i += 1 + m[0].length;
      } else if (rest[0] === "{") {
        const start = i;
        i += 2;
        const num = /^\d+/.exec(s.slice(i));
        const name = num ? null : VAR_RE.exec(s.slice(i));
        if (!num && !name) {
          i = start + 1;
          buf += "$";
          continue;
        }
        i += (num || name)[0].length;
        const node = num ? { t: "tab", n: +num[0], kids: [] } : { t: "var", name: name[0], kids: null };
        if (s[i] === "}") i++;
        else if (s[i] === ":") {
          i++;
          node.kids = parse("}");
          i++;
        } else if (num && s[i] === "|") {
          const end = s.indexOf("|}", i + 1);
          if (end < 0) {
            i = start + 1;
            buf += "$";
            continue;
          }
          node.t = "choice";
          node.options = s.slice(i + 1, end).split(/(?<!\\),/).map((o) => o.replace(/\\(.)/g, "$1"));
          delete node.kids;
          i = end + 2;
        } else if (s[i] === "/") {
          // a transform: skip to the closing brace (three slashes and options), the value is used unchanged
          let depth = 1;
          while (i < s.length && depth) {
            if (s[i] === "\\") i++;
            else if (s[i] === "{") depth++;
            else if (s[i] === "}") depth--;
            i++;
          }
        } else {
          i = start + 1;
          buf += "$";
          continue;
        }
        flush();
        out.push(node);
      } else {
        buf += c;
        i++;
      }
    }
    flush();
    return out;
  };
  return parse(null);
}

const plain = (nodes, vars) => nodes.map((n) => (n.t === "text" ? n.v : n.t === "choice" ? n.options[0] || "" : n.t === "var" ? (vars[n.name] ?? (n.kids ? plain(n.kids, vars) : "")) : plain(n.kids || [], vars))).join("");
const escText = (t) => t.replace(/[{}]/g, (b) => `\\${b}`);
const noBraces = (t) => t.replace(/[{}\n]/g, "");

/** VS Code snippet body (string or array of lines) -> CodeMirror template. `vars` resolves variables. */
export function toCodeMirror(body, vars = {}) {
  const text = Array.isArray(body) ? body.join("\n") : String(body ?? "");
  const nodes = parseSnippetBody(text);
  const render = (list) =>
    list
      .map((n) => {
        if (n.t === "text") return escText(n.v);
        if (n.t === "tab") {
          const def = noBraces(plain(n.kids, vars));
          return n.n === 0 ? "${0}" : def ? `\${${n.n}:${def}}` : `\${${n.n}}`;
        }
        if (n.t === "choice") return `\${${n.n}:${noBraces(n.options[0] || "")}}`;
        // variables: known value, else the default, else (like VS Code) the name as a placeholder
        if (Object.prototype.hasOwnProperty.call(vars, n.name)) return escText(String(vars[n.name]));
        if (n.kids) return render(n.kids);
        return `\${${noBraces(n.name)}}`;
      })
      .join("");
  return render(nodes);
}

/** Values of the VS Code snippet variables for a file and selection. */
export function snippetVariables({ path = "", selection = "", line = "", word = "", now = new Date(), lineComment = "//", blockComment = ["/*", "*/"], random = Math.random } = {}) {
  const file = String(path).split("/").pop();
  const pad = (n) => String(n).padStart(2, "0");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const hexd = (n) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join("");
  return {
    TM_FILENAME: file,
    TM_FILENAME_BASE: file.replace(/\.[^.]*$/, ""),
    TM_DIRECTORY: String(path).split("/").slice(0, -1).join("/"),
    TM_FILEPATH: String(path),
    RELATIVE_FILEPATH: String(path),
    TM_SELECTED_TEXT: selection,
    TM_CURRENT_LINE: line,
    TM_CURRENT_WORD: word,
    TM_LINE_INDEX: "0",
    TM_LINE_NUMBER: "1",
    WORKSPACE_NAME: "",
    CLIPBOARD: "",
    CURRENT_YEAR: String(now.getFullYear()),
    CURRENT_YEAR_SHORT: String(now.getFullYear()).slice(-2),
    CURRENT_MONTH: pad(now.getMonth() + 1),
    CURRENT_MONTH_NAME: months[now.getMonth()],
    CURRENT_MONTH_NAME_SHORT: months[now.getMonth()].slice(0, 3),
    CURRENT_DATE: pad(now.getDate()),
    CURRENT_DAY_NAME: days[now.getDay()],
    CURRENT_DAY_NAME_SHORT: days[now.getDay()].slice(0, 3),
    CURRENT_HOUR: pad(now.getHours()),
    CURRENT_MINUTE: pad(now.getMinutes()),
    CURRENT_SECOND: pad(now.getSeconds()),
    CURRENT_SECONDS_UNIX: String(Math.floor(now.getTime() / 1000)),
    RANDOM: String(Math.floor(random() * 1e6)).padStart(6, "0"),
    RANDOM_HEX: hexd(6),
    UUID: `${hexd(8)}-${hexd(4)}-4${hexd(3)}-${"89ab"[Math.floor(random() * 4)]}${hexd(3)}-${hexd(12)}`,
    LINE_COMMENT: lineComment,
    BLOCK_COMMENT_START: blockComment[0],
    BLOCK_COMMENT_END: blockComment[1],
  };
}

/**
 * Parses a VS Code snippet file ({ name: { prefix, body, description, scope } }).
 * @param {string} text JSONC
 * @param {string} language the language from contributes.snippets ("" = every language, or the `scope` field)
 */
export function parseSnippetFile(text, language) {
  const json = parseJsonc(text);
  const out = [];
  if (!json || typeof json !== "object") return out;
  for (const [name, s] of Object.entries(json).slice(0, 2000)) {
    if (!s || typeof s !== "object" || s.body === undefined) continue;
    const prefix = (Array.isArray(s.prefix) ? s.prefix : [s.prefix ?? name]).map((p) => String(p).slice(0, 80)).filter(Boolean);
    const body = Array.isArray(s.body) ? s.body.map(String).join("\n") : String(s.body);
    if (!prefix.length || body.length > 20000) continue;
    const langs = language ? [language] : typeof s.scope === "string" && s.scope.trim() ? s.scope.split(",").map((x) => x.trim()) : ["*"];
    out.push({ prefix, label: String(name).slice(0, 120), body, description: typeof s.description === "string" ? s.description.slice(0, 300) : Array.isArray(s.description) ? s.description.join("\n").slice(0, 300) : "", languages: langs });
  }
  return out;
}
