// Your own code snippets (Settings > Code studio > Suggestions). Pure: validation and lookup; the editor offers them as
// completions (ui/code/assist.js). A body uses the CodeMirror snippet syntax: ${1:name} or ${name} fields, ${} for the
// final caret position; Tab moves between fields.
//
// Shape: [{ lang: "*"|"html"|"css"|"javascript"|"markdown"|"json"|"latex", prefix, description, body }]

export const SNIPPET_LANGS = Object.freeze(["*", "html", "css", "javascript", "markdown", "json", "latex"]);
export const MAX_SNIPPETS = 200;
const PREFIX = /^[\w:.>@#!+-]{1,40}$/;

/**
 * Keeps valid snippets only (stored preferences and profiles are untrusted): known language, a prefix of word
 * characters (and `: . > @ # ! + -`), a body of at most 4000 characters, at most MAX_SNIPPETS entries.
 * @returns {{ lang: string, prefix: string, description: string, body: string }[]}
 */
export function sanitizeSnippets(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const s of value) {
    if (!s || typeof s !== "object") continue;
    const prefix = String(s.prefix ?? "").trim();
    const body = String(s.body ?? "");
    if (!PREFIX.test(prefix) || !body.trim() || body.length > 4000) continue;
    out.push({ lang: SNIPPET_LANGS.includes(s.lang) ? s.lang : "*", prefix, description: String(s.description ?? "").slice(0, 80), body });
    if (out.length >= MAX_SNIPPETS) break;
  }
  return out;
}

/** Snippets that apply to a language id (`languageOf`): its own plus the "*" ones. */
export function snippetsFor(list, lang) {
  return sanitizeSnippets(list).filter((s) => s.lang === "*" || s.lang === lang);
}
