// Toolbox, menu and panel customization: pure functions over plain data (no DOM).
//
// A toolbox *entry* is { id, group: string[] | null } as returned by studios/index.js `toolboxFor`. Its `key` is the id of the
// first member and identifies the slot when ordering. The per-studio config is { hidden: toolId[], order: key[], ungroup: key[] }.

const norm = (cfg) => ({ hidden: cfg?.hidden || [], order: cfg?.order || [], ungroup: cfg?.ungroup || [] });

/** Applies "show as separate buttons" to the groups listed in cfg.ungroup. */
export function expandEntries(entries, cfg) {
  const { ungroup } = norm(cfg);
  const out = [];
  for (const e of entries) {
    if (e.group && ungroup.includes(e.group[0])) for (const id of e.group) out.push({ key: id, id, group: null, origin: e.group[0] });
    else out.push({ key: e.group ? e.group[0] : e.id, id: e.id, group: e.group, origin: e.group ? e.group[0] : e.id });
  }
  return out;
}

function sortByOrder(list, order) {
  if (!order.length) return list;
  const rank = new Map(order.map((k, i) => [k, i]));
  const known = list.filter((e) => rank.has(e.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
  const rest = list.filter((e) => !rank.has(e.key));
  return [...known, ...rest];
}

/**
 * The entries the toolbox shows: groups expanded, hidden tools removed, user order applied.
 * `isAvailable(id)` filters tools that are not registered.
 */
export function arrangeToolbox(entries, cfg, isAvailable = () => true) {
  const c = norm(cfg);
  const out = [];
  for (const e of sortByOrder(expandEntries(entries, c), c.order)) {
    if (!e.group) {
      if (!c.hidden.includes(e.id) && isAvailable(e.id)) out.push(e);
      continue;
    }
    const members = e.group.filter((id) => !c.hidden.includes(id) && isAvailable(id));
    if (members.length) out.push({ ...e, id: members[0], group: members });
  }
  return out;
}

/** Rows for the editor: every slot in the effective order with the visibility of each member. */
export function editorRows(entries, cfg, isAvailable = () => true) {
  const c = norm(cfg);
  return sortByOrder(expandEntries(entries, c), c.order)
    .map((e) => {
      const ids = (e.group || [e.id]).filter(isAvailable);
      return { key: e.key, ids, grouped: !!e.group && ids.length > 1, canUngroup: !!e.group && ids.length > 1, ungrouped: c.ungroup.includes(e.origin) && !e.group, hidden: ids.filter((id) => c.hidden.includes(id)), origin: e.origin };
    })
    .filter((r) => r.ids.length);
}

/** Moves `key` by `delta` slots in the full order of `keys`. Returns the new order. */
export function moveKey(keys, order, key, delta) {
  const base = sortByOrder(keys.map((k) => ({ key: k })), order).map((e) => e.key);
  const i = base.indexOf(key);
  if (i < 0) return base;
  const j = Math.max(0, Math.min(base.length - 1, i + delta));
  base.splice(j, 0, base.splice(i, 1)[0]);
  return base;
}

/** Moves `key` right before `beforeKey` (drag and drop); null = to the end. */
export function moveKeyBefore(keys, order, key, beforeKey) {
  const base = sortByOrder(keys.map((k) => ({ key: k })), order).map((e) => e.key).filter((k) => k !== key);
  const at = beforeKey == null ? base.length : base.indexOf(beforeKey);
  base.splice(at < 0 ? base.length : at, 0, key);
  return base;
}

export function setToolVisible(cfg, id, visible) {
  const c = norm(cfg);
  const hidden = c.hidden.filter((x) => x !== id);
  if (!visible) hidden.push(id);
  return prune({ ...c, hidden });
}

export function setUngrouped(cfg, origin, ungrouped) {
  const c = norm(cfg);
  const ungroup = c.ungroup.filter((x) => x !== origin);
  if (ungrouped) ungroup.push(origin);
  return prune({ ...c, ungroup });
}

/** Drops empty lists so a default config is `{}`. */
export function prune(cfg) {
  const out = {};
  for (const k of ["hidden", "order", "ungroup"]) if (cfg[k]?.length) out[k] = cfg[k];
  return out;
}

// ------------------------------------------------------------------ menus

/**
 * Removes hidden commands and submenus from a menu item list (MENUS format: "-", command id, {label, items}, {dynamic}).
 * Hidden menus are handled by the caller with `isMenuHidden`.
 */
export function filterMenuItems(items, hiddenItems) {
  if (!hiddenItems?.length) return items;
  const hide = new Set(hiddenItems);
  const out = [];
  for (const it of items) {
    if (typeof it === "string") {
      if (it === "-" || !hide.has(it)) out.push(it);
    } else if (it.items) {
      const inner = filterMenuItems(it.items, hiddenItems);
      if (inner.some((x) => x !== "-")) out.push({ ...it, items: inner });
    } else out.push(it);
  }
  return out;
}

export const isMenuHidden = (menus, label) => !!menus?.menus?.includes(label);

/** Flat list of the command ids a menu offers (for the editor). */
export function menuCommandIds(items) {
  const ids = [];
  for (const it of items) {
    if (typeof it === "string") {
      if (it !== "-") ids.push(it);
    } else if (it.items) ids.push(...menuCommandIds(it.items));
  }
  return ids;
}

// ------------------------------------------------------------------ panels and workspaces

/** Panels of an area minus the hidden ones. */
export const visiblePanels = (ids, hidden) => (hidden?.length ? ids.filter((id) => !hidden.includes(id)) : ids);

/**
 * Built-in workspaces of a studio. `panels` = { top: id[], bottom: id[] } of the studio.
 * Each workspace lists the panels to keep visible ("show"); every other panel of the studio is hidden.
 */
export function builtinWorkspaces(studio, panels) {
  const all = [...panels.top, ...panels.bottom];
  const closed = panels.closed || [];
  // `preset` names the arrangement in ui/docking/presets.js (loaded with the dock); without one the panels keep the Essentials places
  const only = (preset, ...ids) => ({ hidden: all.filter((p) => !ids.includes(p)), side: "right", width: null, ...(preset ? { preset } : {}) });
  const out = [{ name: "Essentials", description: closed.length ? "Every panel of the studio; the panels you open on demand start closed." : "Every panel of the studio.", state: { hidden: closed.slice(), side: "right", width: null } }];
  const add = (name, description, state) => out.push({ name, description, state });
  if (studio === "vector") {
    add("Typography", "Type, appearance, layers and history.", only("typography", "type", "appearance", "layers", "history"));
    add("Minimal", "Layers only.", only("", "layers"));
  } else if (studio === "pixel") {
    add("Photography", "Histogram, info, adjustments, color, layers and history.", only("photography", "histogram", "info", "navigator", "adjustments", "color", "layers", "history"));
    add("Painting", "Brush on the left; color, layers and history on the right.", only("painting", "brush", "color", "layers", "history"));
  } else if (studio === "layout") {
    add("Typography", "Type, styles, pages and layers.", only("typography", "type", "styles", "pages", "layers"));
    add("Data", "Data, color and layers.", only("data", "data", "color", "layers"));
    add("Review", "Comments, pages and history.", only("review", "comments", "pages", "history"));
  } else if (studio === "code") {
    add("Review", "Explorer and Source Control, comments first, then style and settings; Problems below.", only("review", "code-explorer", "code-git", "code-problems", "comments", "style", "element"));
    add("Focus", "The editor with the Explorer, no other panels.", only("focus", "code-explorer"));
  } else if (studio === "scene") {
    add("Motion", "Effects and Inspector.", only("motion", "scene-effects", "scene-inspector"));
    add("Audio", "Media and Inspector, a wider Inspector for levels and mixing.", only("audio", "scene-media", "scene-inspector"));
  } else if (studio === "office:document") {
    add("Review", "The outline on the left; styles hidden.", only("review", "doc-outline"));
  } else if (studio === "office:board") {
    add("Review", "Comments and outline, open on the right.", only("review", "board-comments", "board-outline"));
  }
  return out;
}

/** Combines built-in and user workspaces (a user workspace with the same name wins). */
export function allWorkspaces(studio, panels, saved = {}) {
  const list = builtinWorkspaces(studio, panels).map((w) => ({ ...w, builtin: true }));
  for (const [name, state] of Object.entries(saved || {})) {
    const i = list.findIndex((w) => w.name === name);
    const w = { name, description: "Saved by you.", state, builtin: false };
    if (i >= 0) list[i] = w;
    else list.push(w);
  }
  return list;
}

/**
 * What a workspace stores: hidden panels, dock side and dock width, and optionally the preset arrangement (`preset`)
 * and the full docking layout (`dock`, ui/docking/model.js; validated again when it is shown).
 */
export function snapshotLayout(layout) {
  const s = { hidden: (layout?.hidden || []).slice(), side: layout?.side === "left" ? "left" : "right" };
  s.width = Number.isFinite(layout?.width) ? layout.width : null;
  if (typeof layout?.preset === "string" && layout.preset) s.preset = layout.preset;
  if (layout?.dock && typeof layout.dock === "object") s.dock = JSON.parse(JSON.stringify(layout.dock));
  return s;
}

export function cleanWorkspaceName(name) {
  const n = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
  return n && n !== "__proto__" ? n : "";
}
