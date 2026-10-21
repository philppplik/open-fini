// Pure logic of the recent-files list (no storage, no DOM), unit tested in tests/core/recents.test.js.
//
// Public API
//   clampRecentLimit(v)            -> integer 0..50 (default 12 for junk input)
//   pushRecent(list, entry, limit) -> new list: entry first, same file de-duplicated, capped at `limit`
//   dropRecent(list, id)           -> new list without `id`
//   visibleRecents(list, show, n)  -> what the start page shows ([] when the pref is off)
// Invariants: inputs are never mutated; a limit of 0 always yields an empty list.

export const DEFAULT_RECENT_LIMIT = 12;
export const MAX_RECENT_LIMIT = 50;

export function clampRecentLimit(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_RECENT_LIMIT;
  return Math.min(MAX_RECENT_LIMIT, Math.max(0, n));
}

/** Same file: equal path, or (web, no path) equal name. */
const sameFile = (a, b) => a.id === b.id || (b.path ? a.path === b.path : !a.path && a.name === b.name);

export function pushRecent(list, entry, limit = DEFAULT_RECENT_LIMIT) {
  const max = clampRecentLimit(limit);
  if (max === 0) return [];
  return [entry, ...list.filter((r) => !sameFile(r, entry))].slice(0, max);
}

export const dropRecent = (list, id) => list.filter((r) => r.id !== id);

export function visibleRecents(list, show = true, count = 6) {
  return show === false ? [] : (list || []).slice(0, count);
}
