// The keymap model: default bindings of commands and tools plus the user's overrides. Pure (no DOM).
//
// An *entry* describes one rebindable thing: { id, kind: "command" | "tool", label, group, studios?, defaults: string[], singleKey? }.
// *Overrides* are { [id]: string[] }: the complete list (0-2 chords) that replaces the defaults; [] means "unassigned".
import { normalizeChord, isSingleKeyChord } from "./chords.js";

export const MAX_CHORDS = 2;
export const GENERAL_RE = /^(file|studio|help|vibe)\.|^edit\.(preferences)$|^view\.(theme|lowPower)$/;
const DESIGN = ["vector", "pixel", "layout"];
const ID_RE = /^[A-Za-z0-9_.:@-]{1,120}$/;

/** Builds entries from plain command and tool descriptions. */
export function buildEntries({ commands = [], tools = [] } = {}) {
  const out = [];
  for (const c of commands) {
    if (!c.label) continue;
    const defaults = [c.defaults?.[0] ?? c.shortcut, c.defaults?.[1] ?? c.altShortcut].filter(Boolean).map(normalizeChord).filter(Boolean);
    // general commands only run in the design studios, except the few the Code and Vibe studios allow (see ui/shortcuts.js)
    const studios = c.studios || (GENERAL_RE.test(c.id) ? null : DESIGN);
    out.push({ id: c.id, kind: "command", label: c.label, group: c.group || String(c.id).split(".")[0], studios, scoped: !!c.studios, defaults });
  }
  for (const t of tools) {
    const d = t.defaults?.[0] ?? t.shortcut;
    out.push({ id: t.id, kind: "tool", label: t.label, group: "Tools", studios: t.studios || null, defaults: d ? [normalizeChord(d)].filter(Boolean) : [], singleKey: true });
  }
  return out;
}

/** The chords in effect for an entry. */
export function effective(entry, overrides = {}) {
  const o = Object.prototype.hasOwnProperty.call(overrides, entry.id) ? overrides[entry.id] : null;
  return o ? o.slice(0, MAX_CHORDS) : entry.defaults.slice(0, MAX_CHORDS);
}

export const isOverridden = (entry, overrides = {}) => Object.prototype.hasOwnProperty.call(overrides, entry.id);

const overlap = (a, b) => !a.studios || !b.studios || a.studios.some((s) => b.studios.includes(s));

/** Entries (other than `id`) that would also react to `chord` in a studio where `id` is active. Tools sharing a key cycle, so they never conflict with each other. */
export function conflictsFor(entries, overrides, id, chord) {
  const self = entries.find((e) => e.id === id);
  if (!self || !chord) return [];
  return entries.filter((e) => e.id !== id && overlap(e, self) && !(e.kind === "tool" && self.kind === "tool") && effective(e, overrides).includes(chord));
}

/** Every chord used by more than one entry in an overlapping scope: [{chord, entries}]. */
export function allConflicts(entries, overrides) {
  const byChord = new Map();
  for (const e of entries) for (const c of effective(e, overrides)) (byChord.get(c) || byChord.set(c, []).get(c)).push(e);
  const out = [];
  for (const [chord, list] of byChord) {
    // A studio-specific command deliberately wins over a general one in its studio (ui/shortcuts.js), so that pair is not reported.
    const shadow = (a, b) => a.kind === "command" && b.kind === "command" && !!a.scoped !== !!b.scoped;
    const clash = list.filter((a) => list.some((b) => b !== a && overlap(a, b) && !(a.kind === "tool" && b.kind === "tool") && !shadow(a, b)));
    if (clash.length > 1) out.push({ chord, entries: clash });
  }
  return out;
}

function store(overrides, entry, chords) {
  const next = { ...overrides };
  const same = chords.length === entry.defaults.length && chords.every((c, i) => c === entry.defaults[i]);
  if (same) delete next[entry.id];
  else next[entry.id] = chords.slice(0, MAX_CHORDS);
  return next;
}

/**
 * Sets the complete chord list of `id`.
 * `conflict` decides what happens to entries that already use one of the new chords:
 * "unassign" removes the chord from them, "swap" gives them the chord(s) `id` gave up (falls back to unassign), "keep" leaves both bound.
 * @returns {{overrides:object, affected:string[], error?:string}}
 */
export function setChords(entries, overrides, id, chords, { conflict = "unassign" } = {}) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return { overrides, affected: [], error: `Unknown command “${id}”.` };
  const clean = [];
  for (const raw of chords) {
    const c = normalizeChord(raw);
    if (!c) return { overrides, affected: [], error: `“${raw}” is not a valid shortcut.` };
    if (entry.singleKey && !isSingleKeyChord(c)) return { overrides, affected: [], error: "Tool shortcuts are a single key without modifiers (for example B or F2)." };
    if (!clean.includes(c)) clean.push(c);
  }
  if (clean.length > MAX_CHORDS) return { overrides, affected: [], error: `At most ${MAX_CHORDS} shortcuts per command.` };
  const before = effective(entry, overrides);
  const lost = before.filter((c) => !clean.includes(c));
  let next = store(overrides, entry, clean);
  const affected = [];
  if (conflict !== "keep") {
    let giveBack = lost.slice();
    for (const c of clean) {
      for (const other of conflictsFor(entries, next, id, c)) {
        const cur = effective(other, next).filter((x) => x !== c);
        if (conflict === "swap") {
          const back = giveBack.find((g) => !(other.singleKey && !isSingleKeyChord(g)) && !cur.includes(g));
          if (back) {
            cur.push(back);
            giveBack = giveBack.filter((g) => g !== back);
          }
        }
        next = store(next, other, cur.slice(0, MAX_CHORDS));
        affected.push(other.id);
      }
    }
  }
  return { overrides: next, affected };
}

/** Removes the override of one entry (back to its default). */
export function resetChords(entries, overrides, id) {
  const next = { ...overrides };
  delete next[id];
  return next;
}

/** Checks an overrides object (from a profile or an imported file). Unknown command ids are kept: an extension may not be installed right now. */
export function validateOverrides(raw) {
  const errors = [];
  const overrides = {};
  if (raw == null) return { ok: true, overrides, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, overrides, errors: ["Shortcuts must be an object of command id to a list of shortcuts."] };
  const keys = Object.keys(raw);
  if (keys.length > 2000) errors.push("Too many shortcut entries.");
  for (const id of keys.slice(0, 2000)) {
    if (!ID_RE.test(id) || id === "__proto__") {
      errors.push(`“${id.slice(0, 40)}” is not a valid command id.`);
      continue;
    }
    const v = raw[id];
    if (!Array.isArray(v) || v.length > MAX_CHORDS) {
      errors.push(`${id}: expected a list of at most ${MAX_CHORDS} shortcuts.`);
      continue;
    }
    const list = [];
    for (const c of v) {
      const n = typeof c === "string" ? normalizeChord(c) : null;
      if (!n) errors.push(`${id}: “${String(c).slice(0, 30)}” is not a valid shortcut.`);
      else if (!list.includes(n)) list.push(n);
    }
    overrides[id] = list;
  }
  return { ok: errors.length === 0, overrides, errors };
}

/** Filters entries for the editor. */
export function filterEntries(entries, overrides, { query = "", studio = "", changed = false, conflicts = false, group = "" } = {}) {
  const q = query.trim().toLowerCase();
  const clash = conflicts ? new Set(allConflicts(entries, overrides).flatMap((c) => c.entries.map((e) => e.id))) : null;
  return entries.filter((e) => {
    if (studio && e.studios && !e.studios.includes(studio)) return false;
    if (group && e.group !== group) return false;
    if (changed && !isOverridden(e, overrides)) return false;
    if (clash && !clash.has(e.id)) return false;
    if (!q) return true;
    const hay = `${e.label} ${e.id} ${e.group} ${effective(e, overrides).join(" ").replace(/Mod/g, "Ctrl Cmd")}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

// ------------------------------------------------------------------ presets
// Neutral layouts built from generic key names. They only name command ids; ids that do not exist are skipped.

export const KEYMAP_PRESETS = [
  { id: "default", name: "Default", description: "OpenFini's own shortcuts.", shortcuts: {} },
  {
    id: "classic",
    name: "Classic",
    description: "Ctrl+Y for redo, Ctrl+D duplicates, Ctrl+Shift+A deselects, Ctrl+Alt+Shift variants for the rarer file and layer commands.",
    shortcuts: {
      "edit.redo": ["Mod+Y", "Mod+Shift+Z"],
      "edit.duplicate": ["Mod+D"],
      "edit.deselect": ["Mod+Shift+A"],
      "file.saveAll": ["Mod+Alt+Shift+S"],
      "layer.newPixel": ["Mod+Alt+Shift+N"],
    },
  },
  {
    id: "compact",
    name: "Compact",
    description: "Function keys for view and file actions, so one hand can stay on the mouse.",
    shortcuts: {
      "view.fit": ["F2"],
      "view.fitAll": ["F3"],
      "view.zoom100": ["F4"],
      "view.rulers": ["F6"],
      "view.grid": ["F7"],
      "view.guides": ["F8"],
      "file.export": ["F9"],
    },
  },
  {
    id: "editor",
    name: "Editor-style",
    description: "For the Code studio: familiar text-editor keys such as Ctrl+Shift+K for delete, Ctrl+Shift+D for duplicate and Ctrl+Shift+I for format.",
    shortcuts: {
      "code.deleteElement": ["Delete", "Mod+Shift+K"],
      "code.duplicateElement": ["Mod+Shift+D"],
      "code.format": ["Mod+Shift+I"],
      "code.toggleSidebar": ["Mod+B"],
      "code.toggleBottom": ["Mod+Alt+B"],
      "code.gotoLine": ["Mod+L"],
      "code.gotoElement": ["Mod+T"],
    },
  },
];

export const presetById = (id) => KEYMAP_PRESETS.find((p) => p.id === id) || null;

/** Overrides for a preset restricted to ids that exist (`known` = Set of ids; omit to keep all). Shortcuts equal to the default are dropped. */
export function presetOverrides(id, entries = null) {
  const p = presetById(id);
  if (!p) return null;
  const out = {};
  for (const [cid, chords] of Object.entries(p.shortcuts)) {
    const e = entries?.find((x) => x.id === cid);
    if (entries && !e) continue;
    if (e && chords.length === e.defaults.length && chords.every((c, i) => c === e.defaults[i])) continue;
    out[cid] = chords.slice();
  }
  return out;
}

// ------------------------------------------------------------------ import / export of a keymap file

export function exportKeymap(overrides) {
  return JSON.stringify({ format: "openfini-keymap", version: 1, shortcuts: overrides }, null, 2);
}

/** Parses the text of a keymap file; also accepts a bare overrides object. */
export function parseKeymap(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, overrides: {}, errors: ["The file is not valid JSON."] };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, overrides: {}, errors: ["The file does not contain a keymap."] };
  if (json.format !== undefined && json.format !== "openfini-keymap") return { ok: false, overrides: {}, errors: [`Unsupported file format “${String(json.format).slice(0, 30)}”.`] };
  return validateOverrides(json.format ? json.shortcuts : json);
}
