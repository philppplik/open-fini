// Vibe composer mentions: trigger detection, fuzzy ranking and the structured context blocks sent with a message.
// Pure (no DOM): the composer UI lives in composer-mentions.js, tests in tests/ui/vibe-mentions.test.js.
//
// Three triggers, each only at the start of a whitespace-separated token (start of text, after a space or newline):
//   @  mentions: project files, open documents, layers of the active document, @selection, attachments, members
//   /  skills and built-in commands (/new, /undo, /clear, /create-skill) and recent prompts
//   !  tools: "use this tool" chips (the model is told it MUST call the tool first when it applies)
//
// Public API
//   detectTrigger(text, caret, { composing })   -> { trigger, query, start, end } | null
//   fuzzyMatch(query, text)                     -> { score, ranges: [[from, to], ...] } | null
//   rankItems(query, items, { text, limit })    -> [{ item, score, ranges }] (best first, stable for ties)
//   groupResults(ranked, groupOf, order)        -> [{ group, items }] (groups by their best score when there is a query)
//   buildContextBlocks(chips, opts)             -> string (the "[Vibe context]" section appended to the user text)
//   composeMessage(text, chips, opts)           -> string (text + context section)
//   parseContextBlocks(message)                 -> { text, chips: [{ kind, label }] } (to render sent messages)
//
// Invariants
//   - Chips are atomic: one chip = one block line (plus an optional fenced excerpt for files).
//   - The context section always starts with CONTEXT_MARKER on its own line, so parsing never confuses user text.
//   - File excerpts are capped (maxFileChars) and say so when cut; layers carry id, name, type and rounded bounds.

export const TRIGGERS = ["@", "/", "!"];
export const CONTEXT_MARKER = "[Vibe context]";
const MAX_QUERY = 80;

/**
 * Finds the active trigger token that ends at `caret`.
 * @param {string} text
 * @param {number} caret
 * @param {{composing?: boolean, triggers?: string[]}} [o]
 */
export function detectTrigger(text, caret = text.length, { composing = false, triggers = TRIGGERS } = {}) {
  if (composing || typeof text !== "string") return null;
  caret = Math.max(0, Math.min(caret, text.length));
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  const token = text.slice(start, caret);
  if (!token || !triggers.includes(token[0])) return null;
  const query = token.slice(1);
  if (query.length > MAX_QUERY) return null;
  const trigger = token[0];
  // "!!" or "@@" are not mentions; "/" queries never contain another slash (that is a path the user types)
  if (query[0] === trigger) return null;
  if (trigger === "/" && query.includes("/")) return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { trigger, query, start, end };
}

const isBoundary = (t, i) => i === 0 || /[\s\-_/.:]/.test(t[i - 1]) || (/[a-z0-9]/.test(t[i - 1]) && /[A-Z]/.test(t[i]));

/** Fuzzy subsequence match (case-insensitive). Substrings and word starts score higher. */
export function fuzzyMatch(query, text) {
  text = String(text ?? "");
  if (!query) return { score: 0, ranges: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) {
    // prefer a substring that starts at a word boundary
    let best = idx;
    for (let i = idx; i >= 0 && i < t.length; i = t.indexOf(q, i + 1)) {
      if (isBoundary(text, i)) {
        best = i;
        break;
      }
    }
    const score = 100 + (best === 0 ? 40 : 0) + (isBoundary(text, best) ? 25 : 0) - best * 0.5 - (t.length - q.length) * 0.05 + (t.length === q.length ? 30 : 0);
    return { score, ranges: [[best, best + q.length]] };
  }
  let score = 0;
  let ti = 0;
  let prev = -2;
  const ranges = [];
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    // look ahead for a word-start occurrence before taking the first plain one
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] !== ch) continue;
      if (found < 0) found = j;
      if (isBoundary(text, j)) {
        found = j;
        break;
      }
      if (j === prev + 1) break;
    }
    if (found < 0) return null;
    score += 1;
    if (found === prev + 1) score += 5;
    if (isBoundary(text, found)) score += 8;
    score -= Math.min(5, (found - ti) * 0.2);
    if (ranges.length && ranges[ranges.length - 1][1] === found) ranges[ranges.length - 1][1] = found + 1;
    else ranges.push([found, found + 1]);
    prev = found;
    ti = found + 1;
  }
  return { score: score - t.length * 0.02, ranges };
}

/**
 * Ranks items by the fuzzy score of their text (items without a match are dropped when there is a query).
 * @template T
 * @param {string} query
 * @param {T[]} items
 * @param {{text?: (item: T) => string, limit?: number}} [o]
 */
export function rankItems(query, items, { text = (x) => x.label, limit = 50 } = {}) {
  const out = [];
  items.forEach((item, i) => {
    const m = fuzzyMatch(query, text(item));
    if (m) out.push({ item, score: m.score, ranges: m.ranges, i });
  });
  if (query) out.sort((a, b) => b.score - a.score || a.i - b.i);
  return out.slice(0, limit).map(({ item, score, ranges }) => ({ item, score, ranges }));
}

/** Groups ranked results. Without a query the given group order is kept; with one, the best group comes first. */
export function groupResults(ranked, groupOf, order = [], query = "") {
  const groups = new Map();
  for (const r of ranked) {
    const g = groupOf(r.item);
    if (!groups.has(g)) groups.set(g, { group: g, items: [], best: -Infinity });
    const e = groups.get(g);
    e.items.push(r);
    e.best = Math.max(e.best, r.score);
  }
  const rank = (g) => (order.includes(g) ? order.indexOf(g) : order.length);
  return [...groups.values()].sort((a, b) => (query ? b.best - a.best : 0) || rank(a.group) - rank(b.group)).map(({ group, items }) => ({ group, items }));
}

/** Splits `text` into [{ text, hit }] parts for highlighting the matched ranges. */
export function highlightParts(text, ranges = []) {
  const parts = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) parts.push({ text: text.slice(at, a), hit: false });
    parts.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

const round = (v) => (Number.isFinite(v) ? Math.round(v) : "?");
const oneLine = (s) => String(s ?? "").replace(/[\r\n\]]+/g, " ").trim();

/**
 * One line (plus an optional excerpt) per chip.
 * Chip shapes: { kind: "file", path, content?, size? } | { kind: "document", name, id?, studio?, pages? }
 *   | { kind: "layer", id, name, type, bounds?: {x,y,w,h} } | { kind: "attachment", index, name }
 *   | { kind: "member", name } | { kind: "tool", name } | { kind: "skill", name, args? } | { kind: "selection", layers: [...] }
 */
export function buildContextBlocks(chips, { maxFileChars = 8000, maxTotalChars = 40000 } = {}) {
  const lines = [];
  let budget = maxTotalChars;
  for (const c of chips || []) {
    switch (c.kind) {
      case "file": {
        lines.push(`[@file: ${oneLine(c.path)}]`);
        if (typeof c.content === "string" && budget > 0) {
          const cap = Math.min(maxFileChars, budget);
          const cut = c.content.length > cap;
          const body = cut ? c.content.slice(0, cap) : c.content;
          budget -= body.length;
          lines.push("```", body.replace(/```/g, "``​`"), "```");
          if (cut) lines.push(`(excerpt: first ${cap} of ${c.content.length} characters; call read_file for the rest)`);
        } else if (c.content == null) lines.push("(binary or not loaded: use the project tools to inspect it)");
        break;
      }
      case "document":
        lines.push(`[@document: ${oneLine(c.name)}${c.id ? ` (id ${c.id})` : ""}${c.studio ? `, ${c.studio}` : ""}${c.pages ? `, ${c.pages} page${c.pages === 1 ? "" : "s"}` : ""}]`);
        break;
      case "layer":
        lines.push(layerLine(c));
        break;
      case "selection":
        if (!c.layers?.length) lines.push("[@selection: nothing selected]");
        else for (const l of c.layers.slice(0, 50)) lines.push(layerLine(l, "@selection"));
        break;
      case "attachment":
        lines.push(`[@attachment: ${c.index}. ${oneLine(c.name)}]`);
        break;
      case "member":
        lines.push(`[@member: ${oneLine(c.name)}]`);
        break;
      case "tool":
        lines.push(`[!tool: ${oneLine(c.name)}] You MUST call the tool “${oneLine(c.name)}” first (or as soon as it applies) for this request.`);
        break;
      case "skill":
        lines.push(`[/skill: ${oneLine(c.name)}${c.args && Object.keys(c.args).length ? ` args ${JSON.stringify(c.args)}` : ""}] Load it with use_skill and follow it.`);
        break;
      default:
        break;
    }
  }
  return lines.join("\n");
}

function layerLine(l, tag = "@layer") {
  const b = l.bounds;
  return `[${tag}: id ${l.id} “${oneLine(l.name) || l.type}” ${l.type}${b ? ` at ${round(b.x)},${round(b.y)} size ${round(b.w)}×${round(b.h)}` : ""}${l.page ? ` on page “${oneLine(l.page)}”` : ""}]`;
}

/** The message as sent: the user's text, then the context section (when there are chips). */
export function composeMessage(text, chips, opts) {
  const blocks = buildContextBlocks(chips, opts);
  const t = String(text || "").trim();
  if (!blocks) return t;
  return `${t || "See the context below."}\n\n${CONTEXT_MARKER}\n${blocks}`;
}

const CHIP_RE = /^\[(@file|@document|@layer|@selection|@attachment|@member|!tool|\/skill): ([^\]]*)\]/;
const KIND = { "@file": "file", "@document": "document", "@layer": "layer", "@selection": "layer", "@attachment": "attachment", "@member": "member", "!tool": "tool", "/skill": "skill" };

/** Splits a sent message into the user's text and the chips of its context section. */
export function parseContextBlocks(message) {
  const s = String(message ?? "");
  const at = s.indexOf(`\n\n${CONTEXT_MARKER}\n`);
  if (at < 0) return { text: s, chips: [] };
  const chips = [];
  let fence = false;
  for (const line of s.slice(at + CONTEXT_MARKER.length + 3).split("\n")) {
    if (line.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = CHIP_RE.exec(line);
    if (!m) continue;
    let label = m[2];
    if (m[1] === "@layer" || m[1] === "@selection") label = /“([^”]*)”/.exec(label)?.[1] || label;
    else if (m[1] === "/skill") label = label.replace(/ args .*$/, "");
    chips.push({ kind: KIND[m[1]], label: label.trim(), selection: m[1] === "@selection" || undefined });
  }
  return { text: s.slice(0, at), chips };
}

/** A short chip text for the composer and the transcript. */
export function chipLabel(c) {
  switch (c.kind) {
    case "file":
      return `@${c.path}`;
    case "document":
      return `@${c.name}`;
    case "layer":
      return `@${c.name || c.type}`;
    case "selection":
      return "@selection";
    case "attachment":
      return `@${c.name}`;
    case "member":
      return `@${c.name}`;
    case "tool":
      return `!${c.name}`;
    case "skill":
      return `/${c.name}`;
    default:
      return c.label || "?";
  }
}
