// Operations of the Proto Studio tools and panels (docs/concepts/proto-studio.md §5): every edit the canvas, the
// Layers panel, the Design panel and the commands make is built here as ONE operation of engine/proto/ops.js (a batch
// when it changes several layers), which the workspace runs as one undo step. Pure: no DOM; world boxes of layers come
// in as a function (the geometry cache), so tests pass plain rects (tests/proto/tools-math.test.js).
//
// Public API (`box(id)` → the measured world box { x, y, w, h } of a layer, or null)
//   batch(ops) → op | null                             one op, a batch, or null for nothing
//   isFlow(model, id) / layoutOf(model, id) / fixedSize(node, axis)
//   setFields(model, ids, set, unset?) → op            the same fields on every layer (Design panel)
//   moveBy(model, ids, dx, dy) → op                    absolute layers and top-level layers
//   resizeTo(model, id, box, { from, measured, constraints }) → op   box relative to the parent; children follow
//                                                                    their constraints
//   sizeMode(model, ids, axis, mode, box) → op         hug, fill, fixed (with the measured size) or rel
//   autoLayout(model, ids, kind, box) / removeAutoLayout(model, id, box)
//   group(model, ids) / ungroup(model, id, box)
//   reorder(model, ids, where)                         "forward" | "backward" | "front" | "back"
//   reparent(model, ids, parent, { page, index, before, after }, box) → op   keeps world positions
//   flowMove(model, ids, parent, index) → op           reorder inside (or into) an auto layout
//   copyNodes(model, ids) → payload / pasteNodes(model, payload, { parent, page, offset, random }) → { op, ids }
//   editText(model, id, text) → op / align(model, ids, edge, box) → op
//   toParent(model, parentId, wx, wy, box) → { x, y }  a world point in the parent's coordinates
import { field, isContainer } from "../../engine/proto/schema.js";
import { indexOf, parentKey, pageKey, roots as rootIds, descendants } from "../../engine/proto/tree.js";
import { keysBetween } from "../../collab/fractional.js";
import { newId } from "../../engine/proto/ids.js";
import { applyConstraints, guessDirection, editRuns } from "./math.js";

const r2 = (v) => Math.round(v * 100) / 100 || 0;
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** One operation for a list (null when empty). */
export function batch(ops) {
  const list = ops.filter(Boolean);
  if (!list.length) return null;
  return list.length === 1 ? list[0] : { op: "batch", ops: list };
}

/** The layout type of a layer ("none" for layers without one). */
export const layoutOf = (model, id) => (id != null ? field(model.nodes[id], "layout")?.type || "none" : "none");
/** True when a layer is laid out by its parent's flex or grid layout. */
export function isFlow(model, id) {
  const n = model.nodes[id];
  if (!n || n.parent == null) return false;
  const lt = layoutOf(model, n.parent);
  return (lt === "flex" || lt === "grid") && field(n, "pos") === "flow";
}
/** The fixed size of a layer on an axis ("w" | "h"), or null. */
export function fixedSize(n, axis) {
  const s = field(n, axis);
  return s?.mode === "fixed" && Number.isFinite(s.value) ? s.value : null;
}

/** The stored update of one layer when the values in `set` differ from its fields (else null). */
function update(n, set, unset = []) {
  const s = {};
  for (const [k, v] of Object.entries(set)) {
    const cur = k.includes(".") ? k.split(".").reduce((o, p) => (o == null ? undefined : o[p]), n) : field(n, k);
    if (!same(cur, v)) s[k] = v;
  }
  const u = unset.filter((k) => n[k] !== undefined);
  if (!Object.keys(s).length && !u.length) return null;
  return { op: "node.update", id: n.id, set: s, ...(u.length ? { unset: u } : {}) };
}

/** The same fields on every layer of `ids` (one batch). */
export function setFields(model, ids, set, unset = []) {
  return batch(ids.map((id) => model.nodes[id]).filter(Boolean).map((n) => update(n, set, unset)));
}

/** Moves absolutely positioned and top-level layers by (dx, dy). Layers in an auto layout are left alone. */
export function moveBy(model, ids, dx, dy) {
  return batch(
    rootIds(model, ids)
      .filter((id) => model.nodes[id] && !isFlow(model, id) && !model.nodes[id].locked)
      .map((id) => {
        const n = model.nodes[id];
        return update(n, { x: r2(field(n, "x") + dx), y: r2(field(n, "y") + dy) });
      }),
  );
}

const sizeWith = (old, value) => {
  const s = { mode: "fixed", value: Math.max(0, r2(value)) };
  if (old && Number.isFinite(old.min)) s.min = old.min;
  if (old && Number.isFinite(old.max)) s.max = old.max;
  return s;
};

/**
 * Resizes (and moves) one layer to `box` ({ x, y, w, h } relative to its parent; x and y are ignored for layers in
 * an auto layout). Changed axes become fixed sizes; a text layer made narrower or wider wraps (autoSize "height"),
 * one made taller or shorter gets a fixed box. With `constraints`, the absolutely positioned children follow their
 * constraints (cx, cy) from the old size `from` ({ w, h }) to the new one; `measured(id)` gives their current size
 * when it is not fixed.
 */
export function resizeTo(model, id, box, { from = null, measured = () => null, constraints = true } = {}) {
  const n = model.nodes[id];
  if (!n || n.locked) return null;
  const ops = [];
  const set = {};
  const oldW = from?.w ?? fixedSize(n, "w");
  const oldH = from?.h ?? fixedSize(n, "h");
  const dw = oldW == null || Math.abs(box.w - oldW) > 0.004;
  const dh = oldH == null || Math.abs(box.h - oldH) > 0.004;
  if (!isFlow(model, id)) {
    set.x = r2(box.x);
    set.y = r2(box.y);
  }
  if (dw) set.w = sizeWith(field(n, "w"), box.w);
  if (dh) set.h = sizeWith(field(n, "h"), box.h);
  if (n.type === "text" && n.text && (dw || dh)) {
    const auto = dh ? "fixed" : "height";
    if (n.text.autoSize !== auto && !(auto === "height" && n.text.autoSize === "fixed")) set["text.autoSize"] = auto;
    if (dh && !dw && oldW != null && field(n, "w")?.mode !== "fixed") set.w = sizeWith(field(n, "w"), oldW);
  }
  ops.push(update(n, set));
  if (constraints && from && isContainer(n.type)) {
    const lt = layoutOf(model, id);
    for (const cid of indexOf(model).get(id)) {
      const c = model.nodes[cid];
      if (!c || ((lt === "flex" || lt === "grid") && field(c, "pos") === "flow")) continue;
      const m = measured(cid) || {};
      const cw = fixedSize(c, "w") ?? m.w ?? 0;
      const ch = fixedSize(c, "h") ?? m.h ?? 0;
      const next = applyConstraints({ x: field(c, "x"), y: field(c, "y"), w: cw, h: ch, cx: field(c, "cx"), cy: field(c, "cy") }, from, { w: box.w, h: box.h });
      const cs = { x: next.x, y: next.y };
      if (Math.abs(next.w - cw) > 0.004) cs.w = sizeWith(field(c, "w"), next.w);
      if (Math.abs(next.h - ch) > 0.004) cs.h = sizeWith(field(c, "h"), next.h);
      ops.push(update(c, cs));
    }
  }
  return batch(ops);
}

/** Sets the sizing mode of an axis on layers; "fixed" and "rel" take the measured size (`box(id)`). */
export function sizeMode(model, ids, axis, mode, box = () => null) {
  return batch(
    ids.map((id) => {
      const n = model.nodes[id];
      if (!n) return null;
      const old = field(n, axis) || {};
      const next = { mode };
      if (mode === "fixed") next.value = r2(old.mode === "fixed" ? old.value : box(id)?.[axis] ?? 100);
      if (mode === "rel") next.value = old.mode === "rel" ? old.value : 100;
      if (Number.isFinite(old.min)) next.min = old.min;
      if (Number.isFinite(old.max)) next.max = old.max;
      const set = { [axis]: next };
      // a hugging text layer is one that sizes itself
      if (n.type === "text" && n.text) {
        if (axis === "w" && mode === "hug") set["text.autoSize"] = "width";
        else if (axis === "w" && n.text.autoSize === "width") set["text.autoSize"] = "height";
        if (axis === "h" && mode === "hug" && n.text.autoSize === "fixed") set["text.autoSize"] = "height";
        else if (axis === "h" && mode === "fixed") set["text.autoSize"] = "fixed";
      }
      return update(n, set);
    }),
  );
}

/** A world point in the coordinates of a parent (its border box), or the page's for a top-level layer. */
export function toParent(model, parentId, wx, wy, box = () => null) {
  if (parentId == null) return { x: r2(wx), y: r2(wy) };
  const b = box(parentId);
  return b ? { x: r2(wx - b.x), y: r2(wy - b.y) } : { x: r2(wx), y: r2(wy) };
}

const avg = (list) => (list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : 0);

/**
 * Auto layout (Shift+A) or grid (Ctrl+Alt+G): a selected frame without layout gets one (its children become flow
 * children in reading order, direction, gap and padding guessed from where they are); anything else is wrapped in a
 * new frame with that layout.
 */
export function autoLayout(model, ids, kind = "flex", box = () => null) {
  const list = rootIds(model, ids).filter((id) => model.nodes[id]);
  if (!list.length) return null;
  const n = model.nodes[list[0]];
  const kids = list.length === 1 && isContainer(n.type) && n.type !== "instance" ? indexOf(model).get(n.id) : [];
  if (list.length === 1 && isContainer(n.type) && n.type !== "instance" && layoutOf(model, n.id) === "none") {
    const own = box(n.id);
    const boxes = new Map(kids.map((id) => [id, box(id) || { x: field(model.nodes[id], "x"), y: field(model.nodes[id], "y"), w: fixedSize(model.nodes[id], "w") || 0, h: fixedSize(model.nodes[id], "h") || 0 }]));
    const bs = [...boxes.values()];
    let layout;
    let order = kids.slice();
    if (kind === "grid") {
      const xs = [...new Set(bs.map((b) => Math.round(b.x)))];
      const cols = Math.max(1, Math.min(12, xs.length || 2));
      order.sort((a, b) => boxes.get(a).y - boxes.get(b).y || boxes.get(a).x - boxes.get(b).x);
      layout = { type: "grid", gap: 16, rowGap: 16, pad: [16, 16, 16, 16], grid: { cols: Array.from({ length: cols }, () => ({ fr: 1 })), rows: [], autoFlow: "row" } };
    } else {
      const dir = guessDirection(bs);
      const start = (id) => (dir === "row" ? boxes.get(id).x : boxes.get(id).y);
      const len = (id) => (dir === "row" ? boxes.get(id).w : boxes.get(id).h);
      order.sort((a, b) => start(a) - start(b));
      const gaps = order.slice(1).map((id, i) => Math.max(0, start(id) - (start(order[i]) + len(order[i]))));
      let pad = [0, 0, 0, 0];
      if (own && bs.length) {
        const minX = Math.min(...bs.map((b) => b.x));
        const minY = Math.min(...bs.map((b) => b.y));
        const maxX = Math.max(...bs.map((b) => b.x + b.w));
        const maxY = Math.max(...bs.map((b) => b.y + b.h));
        pad = [minY - own.y, own.x + own.w - maxX, own.y + own.h - maxY, minX - own.x].map((v) => Math.max(0, Math.round(v)));
      }
      layout = { type: "flex", dir, gap: kids.length > 1 ? avg(gaps) : 10, pad: kids.length ? pad : [16, 16, 16, 16], align: "start", justify: "start" };
    }
    const ops = [];
    const set = { layout };
    if (kids.length && kind !== "grid") {
      set.w = { mode: "hug" };
      set.h = { mode: "hug" };
    }
    ops.push(update(n, set));
    if (order.length > 1 && order.some((id, i) => id !== kids[i])) ops.push({ op: "node.move", ids: order, parent: n.id, index: 0 });
    for (const id of order) ops.push(update(model.nodes[id], { pos: "flow" }));
    return batch(ops);
  }
  return { op: "node.wrap", ids: list, layout: kind };
}

/** Removes the auto layout of a container: its children keep their places as absolutely positioned layers. */
export function removeAutoLayout(model, id, box = () => null) {
  const n = model.nodes[id];
  if (!n || layoutOf(model, id) === "none") return null;
  const own = box(id);
  const ops = [];
  const set = { layout: { type: "none" } };
  for (const axis of ["w", "h"]) if (field(n, axis)?.mode === "hug" && own) set[axis] = sizeWith(field(n, axis), own[axis]);
  ops.push(update(n, set));
  for (const cid of indexOf(model).get(id)) {
    const c = model.nodes[cid];
    const b = box(cid);
    const cs = { pos: "abs" };
    if (b && own) {
      cs.x = r2(b.x - own.x);
      cs.y = r2(b.y - own.y);
    }
    for (const axis of ["w", "h"]) if (field(c, axis)?.mode === "fill" && b) cs[axis] = sizeWith(field(c, axis), b[axis]);
    ops.push(update(c, cs));
  }
  return batch(ops);
}

/** Groups siblings in a frame without layout (Ctrl+G). */
export function group(model, ids) {
  const list = rootIds(model, ids).filter((id) => model.nodes[id]);
  if (!list.length) return null;
  return { op: "node.wrap", ids: list, layout: "none", fields: { name: "Group" } };
}

/** Ungroups a frame: its children move to its parent at their places, and the frame is deleted. */
export function ungroup(model, id, box = () => null) {
  const n = model.nodes[id];
  if (!n || !isContainer(n.type) || n.type === "instance" || n.type === "componentSet") return null;
  const kids = indexOf(model).get(id).slice();
  if (!kids.length) return null;
  const ops = [{ op: "node.move", ids: kids, parent: n.parent, page: n.page, after: id }];
  const plt = layoutOf(model, n.parent);
  const flowParent = plt === "flex" || plt === "grid";
  const pbox = n.parent != null ? box(n.parent) : null;
  for (const cid of kids) {
    const c = model.nodes[cid];
    const b = box(cid);
    const cs = { pos: flowParent ? "flow" : "abs" };
    if (!flowParent) {
      if (b) {
        cs.x = r2(b.x - (pbox ? pbox.x : 0));
        cs.y = r2(b.y - (pbox ? pbox.y : 0));
      } else {
        cs.x = r2(field(c, "x") + field(n, "x"));
        cs.y = r2(field(c, "y") + field(n, "y"));
      }
    }
    ops.push({ op: "node.update", id: cid, set: cs });
  }
  ops.push({ op: "node.delete", ids: [id] });
  return batch(ops);
}

/** Bring forward / to front, send backward / to back among siblings (paint order = child order). */
export function reorder(model, ids, where) {
  const list = rootIds(model, ids).filter((id) => model.nodes[id]);
  if (!list.length) return null;
  const ix = indexOf(model);
  const byParent = new Map();
  for (const id of list) {
    const k = parentKey(model.nodes[id]);
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(id);
  }
  const ops = [];
  for (const [k, group] of byParent) {
    const sibs = ix.get(k);
    const moving = new Set(group);
    const sorted = group.slice().sort((a, b) => sibs.indexOf(a) - sibs.indexOf(b));
    const rest = sibs.filter((s) => !moving.has(s));
    const first = model.nodes[sorted[0]];
    const dest = { parent: first.parent, page: first.page };
    if (where === "front") ops.push({ op: "node.move", ids: sorted, ...dest, index: rest.length });
    else if (where === "back") ops.push({ op: "node.move", ids: sorted, ...dest, index: 0 });
    else {
      const last = sibs.indexOf(sorted[sorted.length - 1]);
      const firstI = sibs.indexOf(sorted[0]);
      if (where === "forward") {
        const next = sibs.slice(last + 1).find((s) => !moving.has(s));
        if (next) ops.push({ op: "node.move", ids: sorted, ...dest, after: next });
      } else {
        const prev = sibs.slice(0, firstI).reverse().find((s) => !moving.has(s));
        if (prev) ops.push({ op: "node.move", ids: sorted, ...dest, before: prev });
      }
    }
  }
  return batch(ops);
}

/**
 * Moves layers into `parent` (a node id, or null for the page's top level) at a position ({ index | before | after },
 * default: in front), keeping their places on the canvas: absolutely positioned layers get coordinates in the new
 * parent; in a flex or grid parent they become flow children.
 */
export function reparent(model, ids, parent, where = {}, box = () => null) {
  const list = rootIds(model, ids).filter((id) => model.nodes[id] && id !== parent);
  if (!list.length) return null;
  const page = where.page ?? (parent != null ? model.nodes[parent]?.page : model.nodes[list[0]].page);
  const plt = layoutOf(model, parent);
  const flow = plt === "flex" || plt === "grid";
  const pos = {};
  if (where.index !== undefined) pos.index = where.index;
  else if (where.before !== undefined) pos.before = where.before;
  else if (where.after !== undefined) pos.after = where.after;
  else pos.index = indexOf(model).get(parent != null ? parent : pageKey(page)).filter((id) => !list.includes(id)).length;
  const ops = [{ op: "node.move", ids: list, parent, page, ...pos }];
  const pb = parent != null ? box(parent) : { x: 0, y: 0 };
  for (const id of list) {
    const n = model.nodes[id];
    const set = { pos: flow ? "flow" : "abs" };
    if (!flow) {
      const b = box(id);
      if (b && pb) {
        // the stored position is the unrotated top-left: keep the center where it is
        const w = fixedSize(n, "w") ?? b.w;
        const h = fixedSize(n, "h") ?? b.h;
        set.x = r2(b.x + b.w / 2 - w / 2 - pb.x);
        set.y = r2(b.y + b.h / 2 - h / 2 - pb.y);
      }
    }
    if (n.parent == null && parent == null && !flow) continue;
    ops.push(update({ ...n, pos: field(n, "pos") }, set));
  }
  return batch(ops);
}

/** Reorders flow children: `ids` land at `index` among the other children of `parent`. */
export function flowMove(model, ids, parent, index) {
  const list = rootIds(model, ids).filter((id) => model.nodes[id]);
  if (!list.length) return null;
  const sibs = indexOf(model).get(parent).filter((id) => !list.includes(id));
  const i = Math.max(0, Math.min(sibs.length, index));
  const pos = list.map((id) => update({ ...model.nodes[id], pos: field(model.nodes[id], "pos") }, { pos: "flow" }));
  // a move that changes nothing is no step
  const cur = indexOf(model).get(parent);
  const next = [...sibs.slice(0, i), ...list, ...sibs.slice(i)];
  if (next.length === cur.length && next.every((id, k) => id === cur[k])) return batch(pos);
  return batch([{ op: "node.move", ids: list, parent, index: i }, ...pos]);
}

/** The clipboard payload of layers: their subtrees as plain JSON. */
export function copyNodes(model, ids) {
  const list = rootIds(model, ids).filter((id) => model.nodes[id]);
  const ix = indexOf(model);
  const order = (id) => {
    const k = parentKey(model.nodes[id]);
    return ix.get(k).indexOf(id);
  };
  list.sort((a, b) => order(a) - order(b));
  const nodes = [];
  for (const id of list) for (const x of [id, ...descendants(model, id)]) nodes.push(clone(model.nodes[x]));
  return { kind: "openfini/proto-layers", version: 1, roots: list, nodes };
}

/**
 * Pastes a clipboard payload into `parent` (null: the page's top level of `page`) in front of its children: new ids,
 * the original relative structure, positions moved by `offset` [dx, dy]. Returns { op, ids } (ids of the pasted roots).
 */
export function pasteNodes(model, payload, { parent = null, page, offset = [0, 0], random = Math.random } = {}) {
  if (!payload || payload.kind !== "openfini/proto-layers" || !Array.isArray(payload.nodes) || !payload.nodes.length) return null;
  const pg = parent != null ? model.nodes[parent]?.page : page;
  if (!pg || !model.pages[pg]) return null;
  const taken = new Set(Object.keys(model.nodes));
  const map = new Map();
  for (const n of payload.nodes) {
    const id = newId("n", (x) => taken.has(x), random);
    taken.add(id);
    map.set(n.id, id);
  }
  const sibs = indexOf(model).get(parent != null ? parent : pageKey(pg));
  const last = sibs.length ? model.nodes[sibs[sibs.length - 1]].ord : null;
  const rootSet = new Set(payload.roots);
  const keys = keysBetween(last, null, payload.roots.length);
  const plt = layoutOf(model, parent);
  const flow = plt === "flex" || plt === "grid";
  const nodes = payload.nodes.map((src) => {
    const n = clone(src);
    n.id = map.get(src.id);
    n.page = pg;
    if (rootSet.has(src.id)) {
      n.parent = parent;
      n.ord = keys[payload.roots.indexOf(src.id)];
      if (parent != null) {
        if (flow) n.pos = "flow";
        else if (n.pos === "flow") n.pos = "abs";
      } else delete n.pos;
      if (!(flow && parent != null)) {
        n.x = r2((typeof n.x === "number" ? n.x : 0) + offset[0]);
        n.y = r2((typeof n.y === "number" ? n.y : 0) + offset[1]);
      }
    } else n.parent = map.get(src.parent);
    if (Array.isArray(n.proto)) n.proto = JSON.parse(JSON.stringify(n.proto).replace(/"to":"([^"]+)"/g, (m, id) => (map.has(id) ? `"to":"${map.get(id)}"` : m)));
    return n;
  });
  return { op: { op: "node.insert", nodes }, ids: payload.roots.map((id) => map.get(id)) };
}

/** The plain text of a text layer changed to `text` (runs keep their styles where the text did not change). */
export function editText(model, id, text) {
  const n = model.nodes[id];
  if (!n || n.type !== "text" || !n.text) return null;
  const runs = editRuns(n.text.runs, text);
  if (runs === n.text.runs) return null;
  return { op: "node.update", id, set: { "text.runs": runs } };
}

/** The plain text of a text layer. */
export const plainText = (n) => (Array.isArray(n?.text?.runs) ? n.text.runs.map((r) => (typeof r.t === "string" ? r.t : "")).join("") : "");

/**
 * Aligns layers: several to the bounds of the selection, one to its parent ("left", "hcenter", "right", "top",
 * "vcenter", "bottom"). Layers in an auto layout keep their places (their parent's alignment decides).
 */
export function align(model, ids, edge, box = () => null) {
  const list = rootIds(model, ids).filter((id) => model.nodes[id] && !isFlow(model, id) && box(id));
  if (!list.length) return null;
  let bounds;
  if (list.length > 1) {
    const bs = list.map(box);
    const x0 = Math.min(...bs.map((b) => b.x));
    const y0 = Math.min(...bs.map((b) => b.y));
    bounds = { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
  } else {
    const p = model.nodes[list[0]].parent;
    bounds = p != null ? box(p) : null;
  }
  if (!bounds) return null;
  return batch(
    list.map((id) => {
      const b = box(id);
      let dx = 0;
      let dy = 0;
      if (edge === "left") dx = bounds.x - b.x;
      else if (edge === "hcenter") dx = bounds.x + bounds.w / 2 - (b.x + b.w / 2);
      else if (edge === "right") dx = bounds.x + bounds.w - (b.x + b.w);
      else if (edge === "top") dy = bounds.y - b.y;
      else if (edge === "vcenter") dy = bounds.y + bounds.h / 2 - (b.y + b.h / 2);
      else if (edge === "bottom") dy = bounds.y + bounds.h - (b.y + b.h);
      const n = model.nodes[id];
      return dx || dy ? update(n, { x: r2(field(n, "x") + dx), y: r2(field(n, "y") + dy) }) : null;
    }),
  );
}
