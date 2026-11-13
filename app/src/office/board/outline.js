// Whiteboard outline (the Outline tab of the board sidebar, docs/office-board.md ▸ Sidebar). Pure: no DOM; unit
// tested in tests/office/board-outline.test.js.
//
// Public API
//   boardOutline(model, page, { query }) → [{ id, type, label, depth, frame, locked, hidden, group, match }]
//       the elements of a page, top-most first (like a layers list); frames are followed by the elements inside them
//       (depth 1, also top-most first). With a query only matching rows stay, plus the frames that contain a match.
//   moveInZOrder(model, ids, targetId, where) → model   where = "above" (in front of the target) | "below"
//       drag-and-drop reordering: the moved elements keep their relative order and get fractional keys between the
//       target and its neighbor (collab/fractional.js), so concurrent reorders by collaborators merge.
import { keyBetween } from "../../collab/fractional.js";
import { pageElements, byZ, updateElements } from "./model.js";
import { elementLabel } from "./comments.js";

export function boardOutline(model, page, { query = "" } = {}) {
  const els = pageElements(model, page).reverse(); // top-most first
  const ids = new Set(els.map((e) => e.id));
  const q = String(query || "").trim().toLowerCase();
  const matches = (el) => !q || elementLabel(el).toLowerCase().includes(q) || el.type.includes(q);
  const row = (el, depth) => ({ id: el.id, type: el.type, label: elementLabel(el), depth, frame: el.type === "frame", locked: !!el.locked, hidden: !!el.hidden, group: el.group || null, match: !!q && matches(el) });
  const out = [];
  for (const el of els) {
    if (el.frame && ids.has(el.frame) && el.type !== "frame") continue; // listed under its frame
    if (el.type === "frame") {
      const kids = els.filter((k) => k.frame === el.id && k.type !== "frame");
      const shownKids = kids.filter(matches);
      if (q && !matches(el) && !shownKids.length) continue;
      out.push(row(el, 0));
      for (const k of q && !matches(el) ? shownKids : kids) out.push(row(k, 1));
    } else if (matches(el)) out.push(row(el, 0));
  }
  return out;
}

export function moveInZOrder(model, ids, targetId, where = "above") {
  const target = model.elements[targetId];
  const set = new Set(ids.filter((id) => id !== targetId && model.elements[id]?.page === target?.page));
  if (!target || !set.size) return model;
  const all = pageElements(model, target.page);
  const moving = all.filter((e) => set.has(e.id));
  const rest = all.filter((e) => !set.has(e.id));
  const i = rest.findIndex((e) => e.id === targetId);
  let [lo, hi] = where === "below" ? [rest[i - 1]?.z ?? null, target.z] : [target.z, rest[i + 1]?.z ?? null];
  if (lo !== null && hi !== null && lo >= hi) [lo, hi] = where === "below" ? [null, hi] : [lo, null]; // equal keys: open the range
  const patches = {};
  let prev = lo;
  for (const e of moving.sort(byZ)) {
    const z = keyBetween(prev, hi);
    patches[e.id] = { z };
    prev = z;
  }
  return updateElements(model, patches);
}
