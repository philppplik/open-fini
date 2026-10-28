// The list of text transforms without their implementations (pure data, no imports). The command palette registers
// one `code.<id>` command per entry at start-up and needs only ids and labels; the implementations in texttools.js
// pull in the character codec and its HTML entity table, so they load on first use.
//
// Invariant: every id here has exactly one implementation in texttools.js (`APPLY`); texttools.js throws at load time
// when the two lists disagree, and tests/web/texttools.test.js checks it too. To add a transform, add a row here and an
// `APPLY` entry there.

/**
 * @typedef {object} TransformInfo
 * @property {string} id camelCase id (also the command id `code.<id>` and the Vibe tool's `transform` value)
 * @property {string} label
 * @property {"encode"|"decode"|"convert"|"case"|"lines"|"wrap"|"json"|"color"} group
 * @property {"word"|"line"|"file"|"color"} scope what an empty selection operates on
 * @property {boolean} [fileOnly] only offered for the whole file (not as a palette command)
 * @property {string} [needsArg] prompt for an argument
 */
const I = (id, label, group, scope, extra = {}) => ({ id, label, group, scope, ...extra });

/** @type {TransformInfo[]} */
export const TRANSFORM_INFO = [
  I("encodeEntitiesNamed", "HTML named entities (&eacute;)", "encode", "line"),
  I("encodeEntitiesDecimal", "HTML decimal (&#233;)", "encode", "line"),
  I("encodeEntitiesHex", "HTML hexadecimal (&#xE9;)", "encode", "line"),
  I("encodeJsEscapes", "JavaScript / JSON (\\u00e9)", "encode", "line"),
  I("encodeJsBraces", "JavaScript with \\u{…} for astral characters", "encode", "line"),
  I("encodeCssEscapes", "CSS escapes (\\E9 )", "encode", "line"),
  I("encodePercent", "URL percent-encoding (UTF-8)", "encode", "line"),
  I("encodeCodePoints", "Unicode code points (<U+00E9>)", "encode", "line"),
  I("escapeHtml", "Escape markup characters (& < > \" ')", "encode", "line"),
  I("unescapeHtml", "Unescape HTML entities", "decode", "line"),
  I("decodeEntities", "HTML entities (named, decimal, hex)", "decode", "line"),
  I("decodeJsEscapes", "JavaScript / JSON \\u escapes", "decode", "line"),
  I("decodeCssEscapes", "CSS escapes", "decode", "line"),
  I("decodePercent", "URL percent-encoding", "decode", "line"),
  I("decodeCodePoints", "Unicode code points", "decode", "line"),
  I("decodeAuto", "Auto (entities and \\u escapes)", "decode", "line"),
  I("base64Encode", "Base64 encode", "convert", "line"),
  I("base64Decode", "Base64 decode", "convert", "line"),
  I("urlEncode", "URL encode (component)", "convert", "line"),
  I("urlDecode", "URL decode (component)", "convert", "line"),
  I("upperCase", "UPPER CASE", "case", "word"),
  I("lowerCase", "lower case", "case", "word"),
  I("titleCase", "Title Case", "case", "word"),
  I("camelCase", "camelCase", "case", "word"),
  I("snakeCase", "snake_case", "case", "word"),
  I("kebabCase", "kebab-case", "case", "word"),
  I("constantCase", "CONSTANT_CASE", "case", "word"),
  I("sortLinesAsc", "Sort lines ascending", "lines", "file"),
  I("sortLinesDesc", "Sort lines descending", "lines", "file"),
  I("sortLinesNumeric", "Sort lines numerically", "lines", "file"),
  I("sortLinesUnique", "Sort lines and remove duplicates", "lines", "file"),
  I("reverseLines", "Reverse lines", "lines", "file"),
  I("joinLines", "Join lines", "lines", "file"),
  I("trimLines", "Trim lines", "lines", "file"),
  I("trimTrailing", "Trim trailing whitespace", "lines", "file"),
  I("normalizeWhitespace", "Normalize whitespace", "lines", "file"),
  I("removeBlankLines", "Remove blank lines", "lines", "file"),
  I("tabsToSpaces", "Tabs to spaces", "lines", "file"),
  I("spacesToTabs", "Spaces to tabs", "lines", "file"),
  I("lineEndingsLf", "Line endings: LF", "lines", "file", { fileOnly: true }),
  I("lineEndingsCrlf", "Line endings: CRLF", "lines", "file", { fileOnly: true }),
  I("wrapTag", "Wrap in tag…", "wrap", "word", { needsArg: "Tag (for example div or a href=\"#\")" }),
  I("wrapDoubleQuotes", "Wrap in double quotes", "wrap", "word"),
  I("wrapSingleQuotes", "Wrap in single quotes", "wrap", "word"),
  I("wrapParens", "Wrap in parentheses", "wrap", "word"),
  I("wrapBrackets", "Wrap in brackets", "wrap", "word"),
  I("wrapComment", "Wrap in comment", "wrap", "line"),
  I("jsonPrettify", "Prettify JSON", "json", "file"),
  I("jsonMinify", "Minify JSON", "json", "file"),
  I("colorToHex", "Color to hex", "color", "color"),
  I("colorToRgb", "Color to rgb()", "color", "color"),
  I("colorToHsl", "Color to hsl()", "color", "color"),
];
