// Markup removal for plain-text output (search snippets, readable page text, release-note summaries, dependency scans).
// A single regex pass is not enough: removing one match can join the text around it into a new match, for example
// `<scr<script></script>ipt>` or `<!<!---->--`. Every helper here repeats its replacement until the text is stable.
// For HTML that is rendered, use `sanitizeHtml` (markdown.js) instead; these helpers only produce text.
// Pure: no DOM.

/**
 * Applies `s.replace(re, replacement)` until the text no longer changes. `re` should be global.
 * @param {string} s
 * @param {RegExp} re
 * @param {string} [replacement]
 * @returns {string}
 */
export function replaceUntilStable(s, re, replacement = "") {
  let out = String(s ?? "");
  let prev;
  do {
    prev = out;
    out = out.replace(re, replacement);
  } while (out !== prev);
  return out;
}

/**
 * Removes HTML comments, including nested fragments and an unclosed `<!--` (which, as in HTML, runs to the end).
 * @param {string} s
 */
export function stripComments(s) {
  return replaceUntilStable(s, /<!--[\s\S]*?-->/g).replace(/<!--[\s\S]*$/, "");
}

/**
 * Removes whole elements with their content (`<script>…</script>`), repeatedly, so nested fragments cannot
 * reassemble into one of these elements. Closing tags may carry whitespace and junk (`</script\t foo>`).
 * @param {string} s
 * @param {string[]} names lowercase tag names (letters and digits only)
 */
export function stripElements(s, names) {
  const list = names.filter((n) => /^[a-z][a-z0-9]*$/.test(n)).join("|");
  if (!list) return String(s ?? "");
  return replaceUntilStable(s, new RegExp(`<(${list})\\b[\\s\\S]*?<\\/\\1\\b[^>]*>`, "gi"));
}

/**
 * Plain text of a fragment: removes every tag until none is left, then any `<` that could still start one (a `<`
 * before a space or a digit, as in `a < b`, stays). The result is text, not HTML: escape it before inserting it
 * into markup.
 * @param {string} s
 */
export function stripTags(s) {
  return replaceUntilStable(stripComments(s), /<[A-Za-z!/?][^<>]*>/g).replace(/<(?=[A-Za-z!/?])/g, "");
}
