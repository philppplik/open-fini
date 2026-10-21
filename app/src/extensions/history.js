// Folds the undo entries an extension command created into ONE history step, so "Undo" reverts the whole command.
// Works on the plain History object of core/history.js (entries[], index); pure and unit-tested.

/** Remember where we are before running a command. */
export function historyMark(history) {
  return { index: history.index, before: history.entries[history.index - 1] || null, count: history.entries.length };
}

/**
 * Merges every entry added since `mark` into one entry labeled `label`.
 * @returns {number} how many entries were folded (0 when nothing was merged)
 */
export function mergeSince(history, mark, label) {
  const { entries } = history;
  let start = 0;
  if (mark.before) {
    start = entries.indexOf(mark.before) + 1;
    if (start === 0) return 0; // the old entry was trimmed away: do not guess
  } else if (entries.length - history.index !== 0) return 0;
  const end = history.index;
  const n = end - start;
  if (n < 1 || end !== entries.length) return 0;
  const group = entries.slice(start, end);
  const merged = { label, ops: group.flatMap((e) => e.ops), bytes: group.reduce((s, e) => s + (e.bytes || 0), 0), key: null, touched: new Set(), structure: false, meta: false, time: Date.now() };
  for (const e of group) {
    for (const t of e.touched || []) merged.touched.add(t);
    merged.structure ||= !!e.structure;
    merged.meta ||= !!e.meta;
  }
  if (n === 1) {
    group[0].label = label;
    group[0].key = null;
    return 0;
  }
  entries.splice(start, n, merged);
  history.index = start + 1;
  history.emit?.("change", history);
  return n;
}
