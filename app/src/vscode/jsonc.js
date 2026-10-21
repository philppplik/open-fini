// JSON with comments (JSONC), the format VS Code uses for themes, snippets and language configurations.
// Pure: strips // and /* */ comments and trailing commas outside of strings, then uses JSON.parse.
//
// Public API: parseJsonc(text) -> value (throws SyntaxError with a readable message).
// Invariant: string contents are never modified (comment markers inside strings are kept).

/** Removes comments and trailing commas from JSONC text (string contents are preserved). */
export function stripJsonc(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < n && s[i] !== "\n") i++;
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === ",") {
      // a trailing comma: the next significant character (after whitespace and comments) closes the container
      let j = i + 1;
      for (;;) {
        while (j < n && /\s/.test(s[j])) j++;
        if (s[j] === "/" && s[j + 1] === "/") while (j < n && s[j] !== "\n") j++;
        else if (s[j] === "/" && s[j + 1] === "*") {
          const end = s.indexOf("*/", j + 2);
          j = end < 0 ? n : end + 2;
        } else break;
      }
      if (s[j] !== "}" && s[j] !== "]") out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Parses JSONC. Throws a SyntaxError that names the problem. */
export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}
