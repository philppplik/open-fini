// Docking layout model (ADR 0033, docs/workspaces.md). Pure data and pure functions: no DOM, safe in Node and workers.
//
// A layout has three dock regions around the canvas (left, right, bottom) and a list of floating groups:
//
//   { v: 1,
//     regions: { left|right|bottom: { root: Node|null, size: px, collapsed: bool } },
//     floating: [{ x, y, w, h, group: Group }],
//     maximized: groupId | null }
//
//   Node  = Split | Group
//   Split = { type: "split", dir: "row" | "column", children: Node[], sizes: number[] }   (sizes are fractions, sum 1)
//   Group = { type: "group", id: string, panels: string[], active: string }              (a tabbed stack of panels)
//
// Every operation returns a new, normalized layout and never mutates its input. Panel ids are opaque strings; the
// renderer (view.js) maps them to the panel registry (ui/panels/index.js).

export const REGIONS = ["left", "right", "bottom"];
export const SIDES = ["left", "right", "top", "bottom"];
export const LIMITS = {
  side: { min: 160, max: 900, def: 304 }, // left and right region width (px)
  bottom: { min: 90, max: 700, def: 220 }, // bottom region height (px)
  float: { minW: 180, minH: 120, maxCount: 20 },
  minFraction: 0.05, // smallest share of a split child
  depth: 8, // deepest split nesting accepted from JSON
};
const ID_RE = /^[\w-]{1,24}$/;
const PANEL_RE = /^[\w.:-]{1,80}$/;

const clone = (x) => JSON.parse(JSON.stringify(x));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);
const sizeLimits = (region) => (region === "bottom" ? LIMITS.bottom : LIMITS.side);

/** An empty layout: no panels anywhere. */
export function emptyLayout() {
  const regions = {};
  for (const r of REGIONS) regions[r] = { root: null, size: sizeLimits(r).def, collapsed: false };
  return { v: 1, regions, floating: [], maximized: null };
}

/** A new group node. `id` is filled in by normalize when missing. */
export const group = (panels, active = panels[0], id) => ({ type: "group", id, panels: [...panels], active });
/** A new split node with equal sizes unless given. */
export const split = (dir, children, sizes) => ({ type: "split", dir, children, sizes: sizes || children.map(() => 1 / children.length) });

// ------------------------------------------------------------------ walking

/** Calls fn(group, info) for every group; info = { region, floatIndex, path } (path = child indices from the region root). */
export function eachGroup(layout, fn) {
  const walk = (node, region, path) => {
    if (!node) return;
    if (node.type === "group") fn(node, { region, floatIndex: -1, path });
    else node.children.forEach((c, i) => walk(c, region, [...path, i]));
  };
  for (const r of REGIONS) walk(layout.regions[r].root, r, []);
  layout.floating.forEach((f, i) => fn(f.group, { region: null, floatIndex: i, path: [] }));
}

/** Every panel id in the layout, in document order (regions left, right, bottom, then floating). */
export function panelIds(layout) {
  const out = [];
  eachGroup(layout, (g) => out.push(...g.panels));
  return out;
}

export function findPanel(layout, pid) {
  let hit = null;
  eachGroup(layout, (g, info) => {
    if (!hit && g.panels.includes(pid)) hit = { group: g, ...info };
  });
  return hit;
}

export function findGroup(layout, gid) {
  let hit = null;
  eachGroup(layout, (g, info) => {
    if (!hit && g.id === gid) hit = { group: g, ...info };
  });
  return hit;
}

/** The node at `path` inside a region (path = child indices). */
export function nodeAt(layout, region, path) {
  let n = layout.regions[region]?.root;
  for (const i of path) n = n?.type === "split" ? n.children[i] : null;
  return n || null;
}

// ------------------------------------------------------------------ normalize (also the JSON loader)

/**
 * Repairs any layout-like value: drops unknown or duplicate panels, empty groups and one-child splits, flattens nested
 * splits of the same direction, fixes sizes, ids and rectangles. Returns null when nothing usable is left.
 * @param {any} raw
 * @param {{ known?: Iterable<string>, viewport?: {w:number,h:number} }} [opts] known = panel ids that may appear
 */
export function normalize(raw, opts = {}) {
  if (!raw || typeof raw !== "object") return null;
  const known = opts.known ? new Set(opts.known) : null;
  const seen = new Set();
  const ids = new Set();
  const out = emptyLayout();
  let next = 1;
  const freshId = () => {
    while (ids.has(`g${next}`)) next++;
    return `g${next++}`;
  };
  // ids are assigned in a second pass so a valid id later in the tree is never renamed because of an earlier clash
  const pending = [];

  const fixGroup = (g) => {
    const panels = [];
    for (const p of Array.isArray(g.panels) ? g.panels : []) {
      if (typeof p !== "string" || !PANEL_RE.test(p) || seen.has(p) || (known && !known.has(p))) continue;
      seen.add(p);
      panels.push(p);
    }
    if (!panels.length) return null;
    const n = { type: "group", id: typeof g.id === "string" && ID_RE.test(g.id) && !ids.has(g.id) ? g.id : null, panels, active: panels.includes(g.active) ? g.active : panels[0] };
    if (n.id) ids.add(n.id);
    else pending.push(n);
    return n;
  };
  const fixNode = (node, depth) => {
    if (!node || typeof node !== "object" || depth > LIMITS.depth) return null;
    if (node.type === "group") return fixGroup(node);
    if (node.type !== "split" || !Array.isArray(node.children)) return null;
    const dir = node.dir === "row" ? "row" : "column";
    const kids = [];
    const sizes = [];
    node.children.forEach((c, i) => {
      const k = fixNode(c, depth + 1);
      if (!k) return;
      const s = Array.isArray(node.sizes) && Number.isFinite(node.sizes[i]) && node.sizes[i] > 0 ? node.sizes[i] : null;
      if (k.type === "split" && k.dir === dir) {
        // flatten: the child's children share the child's slot
        const total = s ?? 1 / node.children.length;
        k.children.forEach((cc, j) => (kids.push(cc), sizes.push(total * k.sizes[j])));
      } else kids.push(k), sizes.push(s);
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    return { type: "split", dir, children: kids, sizes: fixSizes(sizes) };
  };

  const regions = raw.regions && typeof raw.regions === "object" ? raw.regions : {};
  for (const r of REGIONS) {
    const src = regions[r] && typeof regions[r] === "object" ? regions[r] : {};
    const lim = sizeLimits(r);
    out.regions[r] = { root: fixNode(src.root, 0), size: Math.round(clamp(num(src.size, lim.def), lim.min, lim.max)), collapsed: src.collapsed === true };
  }
  const vw = num(opts.viewport?.w, Infinity); // without a viewport only the size limits apply
  const vh = num(opts.viewport?.h, Infinity);
  for (const f of Array.isArray(raw.floating) ? raw.floating.slice(0, LIMITS.float.maxCount) : []) {
    if (!f || typeof f !== "object" || !f.group || f.group.type !== "group") continue;
    const g = fixGroup(f.group);
    if (!g) continue;
    out.floating.push({ ...clampRect(f, vw, vh), group: g });
  }
  for (const g of pending) {
    g.id = freshId();
    ids.add(g.id);
  }
  out.maximized = typeof raw.maximized === "string" && findGroup(out, raw.maximized)?.region ? raw.maximized : null;
  if (!panelIds(out).length) return null;
  return out;
}

/** Shares: positive, at least LIMITS.minFraction each, summing to 1. Missing entries get an equal share. */
export function fixSizes(sizes) {
  const n = sizes.length;
  if (!n) return [];
  const filled = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 1 / n));
  const total = filled.reduce((a, b) => a + b, 0);
  let out = filled.map((s) => Math.max(LIMITS.minFraction, s / total));
  const t2 = out.reduce((a, b) => a + b, 0);
  out = out.map((s) => s / t2);
  return out.map((s) => Math.round(s * 10000) / 10000);
}

/** Keeps a floating rectangle on screen: at least its title strip stays reachable. */
export function clampRect(r, vw, vh) {
  const w = Math.round(clamp(num(r.w, 280), LIMITS.float.minW, Math.max(LIMITS.float.minW, vw)));
  const h = Math.round(clamp(num(r.h, 320), LIMITS.float.minH, Math.max(LIMITS.float.minH, vh)));
  const x = Math.round(clamp(num(r.x, 80), 0, Math.max(0, vw - w)));
  const y = Math.round(clamp(num(r.y, 80), 0, Math.max(0, vh - h)));
  return { x, y, w, h };
}

/** JSON for storage (normalized, so ids and sizes are always valid). */
export function serialize(layout) {
  return clone(layout);
}

// ------------------------------------------------------------------ removing

/** Removes panels everywhere; empty groups and splits disappear. */
export function removePanels(layout, pids) {
  const drop = new Set(pids);
  const L = clone(layout);
  eachGroup(L, (g) => {
    g.panels = g.panels.filter((p) => !drop.has(p));
    if (!g.panels.includes(g.active)) g.active = g.panels[0];
  });
  return repair(L);
}
export const removePanel = (layout, pid) => removePanels(layout, [pid]);

// normalize without a known-set; keeps an emptied layout empty instead of returning null
function repair(L) {
  return normalize(L) || emptyLayout();
}

// ------------------------------------------------------------------ inserting

/**
 * Where something can be dropped:
 *   { group: id, zone: "center", index? }          as tabs of that group (index = tab position)
 *   { group: id, zone: "left"|"right"|"top"|"bottom" }  split next to that group
 *   { region: "left"|"right"|"bottom", edge?: "outer"|"inner"|"stack" }  a new column at the window edge (outer) or
 *                                                  next to the canvas (inner), or one more group in the region (stack)
 *   { float: { x, y, w, h } }                      a floating group
 */
function insertGroup(L, g, target) {
  if (target.float) {
    L.floating.push({ ...clampRect(target.float, Infinity, Infinity), group: g });
    return L;
  }
  if (target.group) {
    const hit = findGroup(L, target.group);
    if (!hit) return insertGroup(L, g, { region: "right" });
    const zone = SIDES.includes(target.zone) && hit.region ? target.zone : "center";
    if (zone === "center") {
      const tabs = hit.group.panels;
      const at = clamp(Number.isInteger(target.index) ? target.index : tabs.length, 0, tabs.length);
      tabs.splice(at, 0, ...g.panels);
      hit.group.active = g.active;
      return L;
    }
    const dir = zone === "left" || zone === "right" ? "row" : "column";
    const before = zone === "left" || zone === "top";
    replaceNode(L, hit.region, hit.path, (old) => split(dir, before ? [g, old] : [old, g]));
    return L;
  }
  const region = REGIONS.includes(target.region) ? target.region : "right";
  const R = L.regions[region];
  R.collapsed = false;
  if (!R.root) {
    R.root = g;
    return L;
  }
  if (target.edge === "stack") {
    // one more group under (left/right) or beside (bottom) the others, with an even share
    const dir = region === "bottom" ? "row" : "column";
    const k = R.root.type === "split" && R.root.dir === dir ? R.root.children.length : 1;
    R.root = split(dir, [R.root, g], [k / (k + 1), 1 / (k + 1)]);
    return L;
  }
  // regions left/right grow a new column at the window edge (outer) or next to the canvas (inner); bottom grows a row
  const outer = target.edge !== "inner";
  if (region === "bottom") {
    R.root = split("column", outer ? [R.root, g] : [g, R.root]);
  } else {
    const first = region === "left" ? outer : !outer;
    const cols = R.root.type === "split" && R.root.dir === "row" ? R.root.children.length + 1 : 2;
    R.root = split("row", first ? [g, R.root] : [R.root, g], first ? [1 / cols, 1 - 1 / cols] : [1 - 1 / cols, 1 / cols]);
    R.size = Math.min(LIMITS.side.max, R.size + 240);
  }
  return L;
}

function replaceNode(L, region, path, fn) {
  if (!path.length) {
    L.regions[region].root = fn(L.regions[region].root);
    return;
  }
  const parent = nodeAt(L, region, path.slice(0, -1));
  const i = path[path.length - 1];
  const fresh = fn(parent.children[i]);
  if (fresh.type === "split" && fresh.dir === parent.dir) {
    // keep the parent's share for the pair instead of nesting a split of the same direction
    const share = parent.sizes[i];
    parent.children.splice(i, 1, ...fresh.children);
    parent.sizes.splice(i, 1, share / 2, share / 2);
  } else parent.children[i] = fresh;
}

function newGroupId(L) {
  const used = new Set();
  eachGroup(L, (g) => used.add(g.id));
  let n = 1;
  while (used.has(`g${n}`)) n++;
  return `g${n}`;
}

/** Adds panels that are not in the layout yet as one new group at `target`. */
export function addPanels(layout, pids, target = { region: "right" }) {
  const present = new Set(panelIds(layout));
  const list = pids.filter((p) => !present.has(p));
  if (!list.length) return layout;
  const L = clone(layout);
  const g = group(list, list[0], newGroupId(L));
  return repair(insertGroup(L, g, target));
}

/** Moves one panel (a tab) to `target`. Dropping a panel on its own single-panel group is a no-op. */
export function movePanel(layout, pid, target) {
  const from = findPanel(layout, pid);
  if (!from) return layout;
  if (target.group === from.group.id && (from.group.panels.length === 1 || target.zone === "center")) {
    if (target.zone !== "center" || !Number.isInteger(target.index)) return layout;
    return reorderTab(layout, pid, target.index);
  }
  let L = clone(layout);
  const src = findPanel(L, pid).group;
  src.panels = src.panels.filter((p) => p !== pid);
  if (src.active === pid) src.active = src.panels[0];
  const g = group([pid], pid, newGroupId(L));
  L = insertGroup(L, g, target);
  return repair(L);
}

/** Moves a whole group (all its tabs, keeping the active one). */
export function moveGroup(layout, gid, target) {
  const from = findGroup(layout, gid);
  if (!from || target.group === gid) return layout;
  let L = clone(layout);
  const src = findGroup(L, gid);
  const g = group(src.group.panels, src.group.active, gid);
  src.group.panels = [];
  if (src.floatIndex >= 0) L.floating.splice(src.floatIndex, 1);
  if (L.maximized === gid) L.maximized = null;
  L = repair(L); // the old slot disappears before the group lands (its id is free again)
  return repair(insertGroup(L, g, target));
}

/** Changes the position of a tab inside its group. */
export function reorderTab(layout, pid, index) {
  const L = clone(layout);
  const hit = findPanel(L, pid);
  if (!hit) return layout;
  const tabs = hit.group.panels;
  const from = tabs.indexOf(pid);
  tabs.splice(from, 1);
  tabs.splice(clamp(index > from ? index - 1 : index, 0, tabs.length), 0, pid);
  hit.group.active = pid;
  return L;
}

// ------------------------------------------------------------------ small state changes

export function setActive(layout, pid) {
  const L = clone(layout);
  const hit = findPanel(L, pid);
  if (hit) hit.group.active = pid;
  return L;
}

/** New shares for the split at `path` in `region`. */
export function setSizes(layout, region, path, sizes) {
  const L = clone(layout);
  const n = nodeAt(L, region, path);
  if (n?.type !== "split" || sizes.length !== n.children.length) return layout;
  n.sizes = fixSizes(sizes);
  return L;
}

export function setRegionSize(layout, region, px) {
  if (!REGIONS.includes(region)) return layout;
  const L = clone(layout);
  const lim = sizeLimits(region);
  L.regions[region].size = Math.round(clamp(num(px, lim.def), lim.min, lim.max));
  return L;
}

export function setCollapsed(layout, region, collapsed) {
  if (!REGIONS.includes(region)) return layout;
  const L = clone(layout);
  L.regions[region].collapsed = !!collapsed && !!L.regions[region].root;
  return L;
}

/** Maximizes a docked group inside its region (the other groups of the region step aside); null restores. */
export function setMaximized(layout, gid) {
  const L = clone(layout);
  L.maximized = gid && findGroup(L, gid)?.region ? gid : null;
  return L;
}

export function setFloatRect(layout, gid, rect, viewport = { w: Infinity, h: Infinity }) {
  const L = clone(layout);
  const f = L.floating.find((x) => x.group.id === gid);
  if (f) Object.assign(f, clampRect({ ...f, ...rect }, viewport.w, viewport.h));
  return L;
}

/** Brings a floating group to the front (last = topmost). */
export function raiseFloat(layout, gid) {
  const i = layout.floating.findIndex((x) => x.group.id === gid);
  if (i < 0 || i === layout.floating.length - 1) return layout;
  const L = clone(layout);
  L.floating.push(...L.floating.splice(i, 1));
  return L;
}

/** Swaps the left and right regions (dock side setting). */
export function mirror(layout) {
  const L = clone(layout);
  [L.regions.left, L.regions.right] = [L.regions.right, L.regions.left];
  const flip = (n) => {
    if (n?.type !== "split") return;
    if (n.dir === "row") n.children.reverse(), n.sizes.reverse();
    n.children.forEach(flip);
  };
  flip(L.regions.left.root);
  flip(L.regions.right.root);
  return L;
}

// ------------------------------------------------------------------ presets and reconciling

/**
 * Builds a layout from a compact spec: { right: [["color","brush"], ["layers"]], left: [...], bottom: [...],
 * sizes: { right: 304 }, shares: { right: [0.5, 0.5] } }. Left and right regions stack their groups in a column,
 * bottom lays them out in a row.
 */
export function fromSpec(spec) {
  const L = emptyLayout();
  for (const r of REGIONS) {
    const groups = (spec[r] || []).filter((g) => g.length).map((g) => group(g));
    if (!groups.length) continue;
    L.regions[r].root = groups.length === 1 ? groups[0] : split(r === "bottom" ? "row" : "column", groups, spec.shares?.[r]);
    if (Number.isFinite(spec.sizes?.[r])) L.regions[r].size = spec.sizes[r];
  }
  return normalize(L) || emptyLayout();
}

/**
 * The layout to show: `layout` limited to `visible` panels, plus every visible panel it lacks, placed where `base`
 * (the workspace preset) keeps it: as a tab next to a panel it shares a group with, or in the same region.
 */
export function reconcile(layout, visible, base) {
  const want = new Set(visible);
  let L = normalize(layout, { known: want }) || emptyLayout();
  const have = new Set(panelIds(L));
  for (const pid of visible) {
    if (have.has(pid)) continue;
    const home = base && findPanel(base, pid);
    let target = { region: "right", edge: "stack" };
    if (home) {
      const mate = home.group.panels.find((p) => p !== pid && have.has(p));
      const mateGroup = mate && findPanel(L, mate);
      if (mateGroup) target = { group: mateGroup.group.id, zone: "center" };
      else if (home.region) target = { region: home.region, edge: "stack" };
    }
    const active = target.zone === "center" ? findGroup(L, target.group).group.active : null;
    L = addPanels(L, [pid], target);
    if (active) L = setActive(L, active); // a panel coming back does not steal the front tab
    have.add(pid);
  }
  return L;
}

/** Equal arrangements: ignores group ids (arbitrary) and which tab is in front. */
export function sameLayout(a, b) {
  const strip = (L) => {
    const ids = [];
    eachGroup(L, (g) => ids.push(g.id));
    const max = ids.indexOf(L.maximized);
    return JSON.stringify(L, (k, v) => (k === "id" || k === "active" ? undefined : k === "maximized" ? max : v));
  };
  return strip(a) === strip(b);
}
