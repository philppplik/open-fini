// Office Toolkit: find / replace over any app's text items (cells, slide text boxes, sticky notes, paragraphs). The
// app flattens its model into `{ id, text }` items; this module finds matches and computes replacements; the app
// commits the new texts as ONE undoable step. Pure; tests in tests/office/toolkit.test.js.
//
// Public API
//   compileQuery(query, { caseSensitive, wholeWord, regex }) → RegExp | null   (null: empty or invalid pattern)
//   findMatches(items, query, opts) → [{ id, from, to, text }]                 in item order, at most opts.limit (5000)
//   replaceMatches(items, query, replacement, opts) → Map<id, newText>          `$1` groups work with regex
// Invariants: never throws on user input (an invalid regex finds nothing); zero-length matches are skipped.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compileQuery(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  const q = String(query ?? "");
  if (!q) return null;
  let src = regex ? q : escapeRe(q);
  if (wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, `gu${caseSensitive ? "" : "i"}`);
  } catch {
    return null;
  }
}

export function findMatches(items, query, opts = {}) {
  const re = compileQuery(query, opts);
  const limit = opts.limit ?? 5000;
  const out = [];
  if (!re) return out;
  for (const it of items) {
    const text = String(it.text ?? "");
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ id: it.id, from: m.index, to: m.index + m[0].length, text: m[0] });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function replaceMatches(items, query, replacement, opts = {}) {
  const re = compileQuery(query, opts);
  const out = new Map();
  if (!re) return out;
  const rep = opts.regex ? String(replacement ?? "") : String(replacement ?? "").replace(/\$/g, "$$$$");
  for (const it of items) {
    const text = String(it.text ?? "");
    re.lastIndex = 0;
    const next = text.replace(re, rep);
    if (next !== text) out.set(it.id, next);
  }
  return out;
}
