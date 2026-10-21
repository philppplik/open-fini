// Fuzzy search and ranking for the command palette. Pure functions (no DOM), unit tested in tests/ui.

/** Score of one query word against `text` (lowercase); -1 when it does not match. Substrings beat scattered letters. */
function wordScore(w, t) {
  const idx = t.indexOf(w);
  if (idx >= 0) {
    const boundary = idx === 0 || /[^a-z0-9]/.test(t[idx - 1]);
    return 100 - Math.min(idx, 40) * 0.5 + (boundary ? 30 : 0) + w.length * 2 - (t.length - w.length) * 0.1;
  }
  // scattered letters in order ("tgl thm" style), rewarding consecutive runs and word starts
  let score = 10;
  let pos = 0;
  let prev = -2;
  for (const ch of w) {
    const at = t.indexOf(ch, pos);
    if (at < 0) return -1;
    score += at === prev + 1 ? 6 : 1;
    if (at === 0 || /[^a-z0-9]/.test(t[at - 1])) score += 5;
    score -= Math.min(at - pos, 8) * 0.3;
    prev = at;
    pos = at + 1;
  }
  return Math.max(1, score);
}

/** Fuzzy score of `query` (space separated words, all must match) against `text`; -1 = no match, 0 = empty query. */
export function fuzzyScore(query, text) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return 0;
  const t = String(text || "").toLowerCase();
  let total = 0;
  for (const w of q.split(/\s+/)) {
    const s = wordScore(w, t);
    if (s < 0) return -1;
    total += s;
  }
  return total;
}

const SECTIONS = { file: "File", edit: "Edit", arrange: "Arrange", align: "Arrange", distribute: "Arrange", shape: "Shape", bool: "Shape", view: "View", studio: "Studio", help: "Help", code: "Code", vibe: "Vibe", pixel: "Pixel", select: "Select", layer: "Layer", layout: "Layout", text: "Text", doc: "Document", filter: "Filter", adjust: "Adjust" };

/** "file.saveAs" → "File"; unknown prefixes are capitalized. */
export function sectionOf(id) {
  const p = String(id).split(".")[0];
  return SECTIONS[p] || p.charAt(0).toUpperCase() + p.slice(1);
}

/** "view.fitAll" → "view fit all": ids contribute as a weaker search field (so "toggle theme" finds view.theme). */
const idWords = (id) => String(id).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]/g, " ");

const normShortcut = (s) => String(s || "").toLowerCase().replace(/\bmod\b|\bctrl\b|\bcmd\b|\bcontrol\b|\bmeta\b/g, "mod").replace(/\s+/g, "");

/**
 * Ranks command entries for the palette.
 * @param {{id:string,label:string,shortcut?:string,studios?:string[]}[]} entries
 * @param {string} query
 * @param {{studio?:string, recent?:string[], limit?:number}} [opts] `recent` lists command ids, most recent first
 * @returns {Array<{id:string,label:string,shortcut?:string,section:string,score:number,recent:boolean}>}
 */
export function rankCommands(entries, query, { studio = "", recent = [], limit = 80 } = {}) {
  const q = String(query || "").trim();
  const recentIndex = new Map(recent.map((id, i) => [id, i]));
  const out = [];
  for (const e of entries) {
    if (!e.label) continue;
    if (e.studios && studio && !e.studios.includes(studio)) continue; // other studios' commands are not offered
    let score = 0;
    if (q) {
      const byLabel = fuzzyScore(q, e.label);
      const byId = fuzzyScore(q, idWords(e.id));
      const bySection = fuzzyScore(q, `${sectionOf(e.id)} ${e.label}`);
      const byShortcut = e.shortcut && normShortcut(e.shortcut).includes(normShortcut(q)) && q.length > 1 ? 40 : -1;
      const best = Math.max(byLabel, byId * 0.6, bySection * 0.8, byShortcut);
      if (best < 0) continue;
      score = best;
    }
    const r = recentIndex.get(e.id);
    if (r !== undefined) score += Math.max(0, 24 - r * 2);
    if (e.studios && e.studios.includes(studio)) score += q ? 12 : 30; // this studio's own commands first
    out.push({ id: e.id, label: e.label, shortcut: e.shortcut, section: sectionOf(e.id), score, recent: r !== undefined });
  }
  out.sort((a, b) => b.score - a.score || (q ? 0 : a.section.localeCompare(b.section)) || a.label.localeCompare(b.label));
  return out.slice(0, limit);
}

/** Moves `id` to the front of a recent list (max 8, no duplicates). */
export function pushRecent(list, id, max = 8) {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
