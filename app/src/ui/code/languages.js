// Syntax highlighting for every language of engine/web/code-langs.js. The web languages come from the main CodeMirror
// bundle; the others are stream modes from the on-demand bundle vendor/codemirror-modes/modes.js (loaded on first use,
// cached by the service worker afterwards) or the small modes below (batch files, PHP, logs, ignore files).
//
// languageSupport(path) is synchronous: while the mode bundle loads it returns [] and `whenModesLoaded()` resolves once
// a second call can return the real highlighter (ui/code/editor.js then reconfigures its language compartment).
// Offline before the first use, the bundle cannot load and such files stay plain text.
import * as CM from "../../../vendor/codemirror/codemirror.js";
import { codeLanguageOf } from "../../engine/web/code-langs.js";

let modes = null; // the loaded bundle
let loading = null;
const defined = new Map(); // mode name -> StreamLanguage (defined once, shared by all editors)

/** Loads the stream-mode bundle once. Resolves with true when it is available. */
export function whenModesLoaded() {
  loading ||= import("../../../vendor/codemirror-modes/modes.js").then(
    (m) => ((modes = m), true),
    (err) => {
      console.warn("[code] extra language modes are not available", err);
      return false;
    },
  );
  return loading;
}

const words = (s) => new Set(s.split(" "));

// Windows batch files: comments (REM, ::), labels, %variables%, keywords and strings.
const BATCH_KEYWORDS = words("if else goto call exit set setlocal endlocal echo for in do not exist defined errorlevel equ neq lss leq gtr geq shift pause start cd pushd popd title cls rem choice copy del move mkdir rmdir type nul");
const batchMode = {
  name: "batch",
  token(stream) {
    if (stream.sol()) {
      stream.eatSpace();
      if (stream.match(/^(rem\b|::)/i)) return stream.skipToEnd(), "comment";
      if (stream.match(/^:[\w.-]+/)) return "labelName";
      if (stream.match(/^@/)) return "meta";
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^%~?[\w]*%?|^%%\w|^!\w+!/)) return "variableName.special";
    if (stream.match(/^"(?:[^"])*"?/)) return "string";
    if (stream.match(/^\d+\b/)) return "number";
    if (stream.match(/^[\w.-]+/)) return BATCH_KEYWORDS.has(stream.current().toLowerCase()) ? "keyword" : null;
    stream.next();
    return /[|&<>()=]/.test(stream.current()) ? "operator" : null;
  },
  languageData: { commentTokens: { line: "REM" } },
};

// Log files: timestamps, levels, quoted strings and numbers.
const logMode = {
  name: "log",
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\d{4}-\d\d-\d\d[T ][\d:.,]+Z?|^\d\d:\d\d:\d\d(?:[.,]\d+)?|^\[\d[^\]]*\]/)) return "number";
    if (stream.match(/^\b(?:ERROR|ERR|FATAL|CRITICAL|SEVERE|FAIL(?:ED|URE)?|PANIC)\b/i)) return "invalid";
    if (stream.match(/^\b(?:WARN(?:ING)?)\b/i)) return "keyword";
    if (stream.match(/^\b(?:INFO|NOTICE|DEBUG|TRACE|VERBOSE|OK|SUCCESS)\b/i)) return "atom";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?|^'(?:[^'\\]|\\.)*'?/)) return "string";
    if (stream.match(/^https?:\/\/\S+/)) return "link";
    if (stream.match(/^\d+(?:\.\d+)?\b/)) return "number";
    stream.match(/^[^\s"'\d]+/) || stream.next();
    return null;
  },
};

// .gitignore and friends: comments, negation and glob characters.
const ignoreMode = {
  name: "ignore",
  token(stream) {
    if (stream.sol() && stream.match(/^\s*#/)) return stream.skipToEnd(), "comment";
    if (stream.sol() && stream.match(/^!/)) return "operator";
    if (stream.match(/^[*?[\]]+|^\*\*/)) return "keyword";
    if (stream.match(/^\//)) return "punctuation";
    stream.match(/^[^*?[\]/]+/) || stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};

const PHP_KEYWORDS = "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield";

/** A PHP mode built on the C-like parser of the bundle: keywords, $variables, # comments, heredocs as strings. */
function phpMode(m) {
  const kw = Object.fromEntries(PHP_KEYWORDS.split(" ").map((w) => [w, true]));
  return m.clike({
    name: "php",
    keywords: kw,
    blockKeywords: Object.fromEntries("catch do else elseif for foreach if switch try while finally".split(" ").map((w) => [w, true])),
    defKeywords: { class: true, function: true, interface: true, namespace: true, trait: true, enum: true },
    atoms: { true: true, false: true, null: true, TRUE: true, FALSE: true, NULL: true, __CLASS__: true, __DIR__: true, __FILE__: true, __FUNCTION__: true, __LINE__: true, __METHOD__: true, __NAMESPACE__: true },
    hooks: {
      $: (stream) => (stream.eatWhile(/[\w$]/), "variableName.special"),
      "#": (stream) => (stream.skipToEnd(), "comment"),
      "<": (stream) => (stream.match(/^\?(php|=)?/) ? "meta" : false),
      "?": (stream) => (stream.match(/^>/) ? "meta" : false),
    },
  });
}

function streamLanguage(name) {
  let lang = defined.get(name);
  if (lang) return lang;
  let parser = null;
  if (name === "app:batch") parser = batchMode;
  else if (name === "app:log") parser = logMode;
  else if (name === "app:ignore") parser = ignoreMode;
  else if (modes && name === "app:php") parser = phpMode(modes);
  else if (modes?.[name]) parser = modes[name];
  if (!parser) return null;
  lang = CM.StreamLanguage.define(parser);
  defined.set(name, lang);
  return lang;
}

/** Does this mode need the on-demand bundle? */
const needsBundle = (mode) => !!mode && !mode.startsWith("builtin:") && !["app:batch", "app:log", "app:ignore"].includes(mode);

/**
 * The CodeMirror extension that highlights `path` ([] for plain text or while the mode bundle is loading).
 * @param {string} path
 */
export function languageSupport(path) {
  const mode = codeLanguageOf(path)?.mode;
  if (!mode) return [];
  switch (mode) {
    case "builtin:html":
      return CM.html({ autoCloseTags: true, matchClosingTags: true });
    case "builtin:css":
      return CM.css();
    case "builtin:javascript":
      return CM.javascript();
    case "builtin:jsx":
      return CM.javascript({ jsx: true });
    case "builtin:typescript":
      return CM.javascript({ typescript: true });
    case "builtin:tsx":
      return CM.javascript({ typescript: true, jsx: true });
    case "builtin:json":
      return CM.json();
    case "builtin:markdown":
      return CM.markdown();
    case "builtin:xml":
      return CM.xml();
    case "builtin:latex":
      return defineBuiltin("stex", CM.stex);
    case "builtin:yaml":
      return defineBuiltin("yaml", CM.yaml);
    case "builtin:toml":
      return defineBuiltin("toml", CM.toml);
    case "builtin:properties":
      return defineBuiltin("properties", CM.properties);
    default:
      break;
  }
  if (needsBundle(mode) && !modes) {
    whenModesLoaded();
    return [];
  }
  return streamLanguage(mode) || [];
}

function defineBuiltin(name, parser) {
  const key = `builtin:${name}`;
  let lang = defined.get(key);
  if (!lang) defined.set(key, (lang = CM.StreamLanguage.define(parser)));
  return lang;
}

/** True when highlighting `path` waits for the mode bundle (the caller reconfigures after whenModesLoaded()). */
export function waitsForModes(path) {
  return !modes && needsBundle(codeLanguageOf(path)?.mode);
}
