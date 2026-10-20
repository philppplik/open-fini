// Studio registry: the one place that knows which studios exist. Pure (no DOM, no tool imports), so it is unit tested.
//
// A new studio is ONE call:
//
//   registerStudio({ id: "office", label: "Office", icon: "office", blurb: "Documents, sheets and slides", order: 60, workspace: true });
//
// Everything else (header switcher, "More" menu, Studio menu, Alt+N shortcuts, welcome cards, New document dialog,
// command palette, Settings > Studios) is derived from the registry. The header shows at most MAX_VISIBLE_STUDIOS
// studios; the rest live in the "More" menu, so no studio is ever unreachable.

/** Hard limit of studios shown side by side in the header. */
export const MAX_VISIBLE_STUDIOS = 5;

/** The studios shown by default (a fresh install, or after "Reset"). Studios registered later start in "More". */
export const DEFAULT_VISIBLE_STUDIOS = ["vector", "pixel", "layout", "code", "vibe"];

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * @typedef {Object} StudioDef
 * @property {string} id            Lowercase id, also used in `studio.<id>` commands and `doc.studio`.
 * @property {string} label         Header label ("Vector").
 * @property {string} [icon]        Icon name of the `of` library (assets/icons/<icon>.svg); defaults to the id.
 * @property {string} [systemIcon]  A Shoelace/Bootstrap icon name to use instead of an `of` icon file (e.g. "file-earmark-text").
 * @property {string} [blurb]       One-line description (tooltips, welcome cards, settings).
 * @property {number} [order]       Sort key; lower comes first. Default: after everything registered before.
 * @property {boolean} [workspace]  True for studios that own the whole stage (Code, Vibe, Office ...): no canvas tools.
 * @property {boolean} [document]   True when "New document" creates a canvas document for it (Vector, Pixel, Layout).
 * @property {(string|string[])[]} [tools]  Toolbox layout (nested arrays are flyouts).
 * @property {string[]} [top]       Panels of the upper dock.
 * @property {string[]} [bottom]    Panels of the lower dock.
 */

/** Creates an independent registry (the app uses the shared one below; tests create their own). */
export function createStudioRegistry() {
  /** @type {Record<string, StudioDef & { order: number, seq: number }>} id -> definition (same object the dock reads) */
  const studios = {};
  const listeners = new Set();
  let seq = 0;

  function registerStudio(def) {
    if (!def || typeof def !== "object") throw new TypeError("registerStudio() needs a studio definition");
    const { id, label } = def;
    if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`Invalid studio id “${id}”: use lowercase letters, digits and dashes.`);
    if (typeof label !== "string" || !label.trim()) throw new Error(`Studio “${id}” needs a label.`);
    if (studios[id]) throw new Error(`Studio “${id}” is already registered.`);
    const entry = {
      icon: id,
      blurb: "",
      tools: [],
      top: [],
      bottom: [],
      ...def,
      order: Number.isFinite(def.order) ? def.order : 1000 + seq,
      seq: seq++,
    };
    studios[id] = entry;
    for (const fn of [...listeners]) fn(entry);
    return entry;
  }

  /** All studios, sorted by `order` (ties by registration). */
  const listStudios = () => Object.values(studios).sort((a, b) => a.order - b.order || a.seq - b.seq);

  return {
    studios,
    registerStudio,
    listStudios,
    studioIds: () => listStudios().map((s) => s.id),
    getStudio: (id) => studios[id] || null,
    hasStudio: (id) => Object.hasOwn(studios, id),
    /** Calls `fn(entry)` after every registration; returns an unsubscribe function. */
    onStudioRegistered(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------------------------------------------------------------- selection logic (pure functions over id arrays)

/**
 * Turns a saved `visibleStudios` preference into a valid list: known ids only, no duplicates, at most `max`,
 * never empty (falls back to the defaults that exist, then to the first registered studio).
 * @param {unknown} pref
 * @param {string[]} registered ids in registry order
 */
export function resolveVisibleStudios(pref, registered, { max = MAX_VISIBLE_STUDIOS, defaults = DEFAULT_VISIBLE_STUDIOS } = {}) {
  const known = new Set(registered);
  const out = [];
  for (const id of Array.isArray(pref) ? pref : defaults) {
    if (known.has(id) && !out.includes(id) && out.length < max) out.push(id);
  }
  if (out.length) return out;
  const fallback = defaults.filter((id) => known.has(id)).slice(0, max);
  return fallback.length ? fallback : registered.slice(0, 1);
}

/** Studios that are registered but not in the header: they are listed in the "More" menu. */
export function overflowStudios(visible, registered) {
  const shown = new Set(visible);
  return registered.filter((id) => !shown.has(id));
}

/**
 * Adds or removes a studio from the header list.
 * @returns {{ visible: string[], error: string|null }} `error` explains why nothing changed (limit reached / last one).
 */
export function toggleVisibleStudio(visible, id, { max = MAX_VISIBLE_STUDIOS } = {}) {
  if (visible.includes(id)) {
    if (visible.length <= 1) return { visible, error: "At least one studio must stay in the header." };
    return { visible: visible.filter((x) => x !== id), error: null };
  }
  if (visible.length >= max) return { visible, error: `The header shows at most ${max} studios. Remove one first; the others stay available in the More menu.` };
  return { visible: [...visible, id], error: null };
}

/** Moves a visible studio by `delta` positions (-1 = left, +1 = right). Out-of-range moves are ignored. */
export function moveVisibleStudio(visible, id, delta) {
  const from = visible.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= visible.length) return visible;
  const next = visible.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Moves `id` to the position of `targetId` (drag and drop). */
export function reorderVisibleStudio(visible, id, targetId) {
  const from = visible.indexOf(id);
  const to = visible.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return visible;
  const next = visible.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Studio for the shortcut Alt+<digit>: the n-th visible studio (digits are 1-based), or null. */
export function studioForDigit(visible, digit) {
  return Number.isInteger(digit) && digit >= 1 && digit <= visible.length ? visible[digit - 1] : null;
}

/** Icon spec for ui/toolbox.js iconEl(): the studio's own glyph ("of:<icon>") or a system icon. */
export const studioIconSpec = (s) => (s.systemIcon ? s.systemIcon : `of:${s.icon}`);

// ---------------------------------------------------------------- shared instance used by the app

const shared = createStudioRegistry();

/** id -> definition of every registered studio (mutated by registerStudio; panels are read from here). */
export const STUDIOS = shared.studios;
export const registerStudio = shared.registerStudio;
export const listStudios = shared.listStudios;
export const studioIds = shared.studioIds;
export const getStudio = shared.getStudio;
export const hasStudio = shared.hasStudio;
export const onStudioRegistered = shared.onStudioRegistered;
