// Reads a version's section from CHANGELOG.md (Keep a Changelog) for the "What is new" block on the home page.

/**
 * @param {string} text CHANGELOG.md
 * @returns {{ version: string, title: string, body: string }[]} released versions, newest first
 */
export function parseChangelog(text) {
  const out = [];
  const re = /^## \[(\d+\.\d+\.\d+[^\]]*)\]\s*(?:[—–-]\s*(.*))?$/gm;
  const heads = [...String(text).matchAll(re)];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const next = text.slice(m.index + m[0].length, end).search(/^## /m);
    const body = text.slice(m.index + m[0].length, next < 0 ? end : m.index + m[0].length + next);
    out.push({ version: m[1], title: (m[2] ?? "").trim(), body });
  });
  return out;
}

/** Plain text of a Markdown snippet: links, emphasis and code marks removed. */
export function plain(s) {
  return String(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The headline items of a version: the bold lead of each "Added" bullet (or its first clause).
 * @param {{ body: string }} section
 * @param {number} max
 * @returns {string[]}
 */
export function highlights(section, max = 4) {
  const added = /^### Added\s*$([\s\S]*?)(?=^### |(?![\s\S]))/m.exec(section.body)?.[1] ?? section.body;
  const items = [];
  for (const line of added.split(/\r?\n/)) {
    const m = /^- (.*)$/.exec(line);
    if (!m) continue;
    const bold = /^\*\*(.+?)\*\*/.exec(m[1]);
    let text = bold ? bold[1] : m[1].split(/:\s|\s\(/)[0];
    text = plain(text).replace(/[.:]$/, "");
    if (text.length > 90) text = `${text.slice(0, 88).replace(/\s+\S*$/, "")}…`;
    items.push(text);
    if (items.length >= max) break;
  }
  return items;
}
