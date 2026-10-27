// Change sets of Vibe tool calls: before/after snapshots of layers, website/text files and Office paragraphs, and the
// diffs the chat shows ("View changes", the run summary, the Canvas before/after). Pure: no DOM, no app access.
// The app-bound recorder (snapshots around each mutating tool call, thumbnails, revert) is change-recorder.js.
//
// Public API
//   snapshotNode(node, { parentId, prevId })   -> LayerSnap { id, type, name, parentId, prevId, props: { key: json }, ref }
//   snapshotNodes(iterable, { limit })        -> { map: Map<id, LayerSnap>, truncated }
//   diffLayers(beforeMap, afterMap)           -> LayerChange[] ({ id, name, type, kind: added|removed|changed, props, before, after })
//   describeProp(key, beforeJson, afterJson)  -> string[] human lines ("fill #ffffff → #0a84ff", "x 40 → 80")
//   describeLayerChange(change)               -> "Rectangle “Hero”: fill #ffffff → #0a84ff, x 40 → 80"
//   diffFiles(beforeMap, afterMap, opts)      -> FileChange[] ({ path, kind, before, after, add, del, binary, tooLarge })
//   officeParagraphs(model)                   -> string[] (one entry per paragraph / table cell)
//   diffParagraphs(a, b)                      -> { rows: [{ t: "ctx"|"del"|"add", text }], add, del }
//   revertBlock(beforeText, afterText, k)     -> text with the k-th change block of after reverted to before
//   textBlocks(beforeText, afterText)         -> change blocks (diffBlocks over lines)
//   combineCalls(calls)                       -> one change set for a whole run (first before, last after per key)
//   statOf(set)                               -> { add, del, layers, files, paragraphs } and badgeText(stat) -> "+12 −3"
//
// Invariants
//   - Snapshots keep JSON strings of property values (cheap to compare, safe against later mutation). Values larger
//     than MAX_PROP_JSON are replaced by a hash marker and are not revertible ("too large").
//   - Binary values (pixel canvases, image bytes) are never serialized: pixel/image layers record their render
//     revision instead, so a pixel change shows up as "pixels changed" (thumbnails only).
//   - Text files above MAX_DIFF_CHARS are reported as tooLarge (no line diff), never diffed.
import { diffBlocks, splitLines } from "../../engine/git/diff.js";

export const MAX_PROP_JSON = 20000;
export const MAX_DIFF_CHARS = 400000;
export const MAX_LAYERS = 5000;

const HASH = "#hash:";
const isBinary = (v) => v && typeof v === "object" && (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || typeof v.getContext === "function" || (typeof v.width === "number" && v.data && ArrayBuffer.isView(v.data)));

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (x >>> 0).toString(36);
}

/** JSON of a property value; binary → null (skipped); huge → hash marker. */
export function propJson(v) {
  if (v === undefined || typeof v === "function" || isBinary(v)) return null;
  let s;
  try {
    s = JSON.stringify(v, (k, x) => (isBinary(x) ? "<binary>" : x));
  } catch {
    return null;
  }
  if (s === undefined) return null;
  return s.length > MAX_PROP_JSON ? `${HASH}${hash(s)}:${s.length}` : s;
}

/** Snapshot of one layer's own properties (children, masks and internal `_` fields excluded). */
export function snapshotNode(node, { parentId = null, prevId = null } = {}) {
  const props = {};
  for (const k of Object.keys(node)) {
    if (k === "children" || k === "mask" || k === "id" || k.startsWith("_")) continue;
    const j = propJson(node[k]);
    if (j != null) props[k] = j;
  }
  if (node.type === "pixel" || node.type === "image") props.pixels = JSON.stringify(node._rev | 0);
  return { id: node.id, type: node.type, name: node.name || "", parentId, prevId, props, ref: node };
}

/** Walks node trees (`roots` are page roots or nodes); returns a Map id → snapshot. */
export function snapshotNodes(roots, { limit = MAX_LAYERS } = {}) {
  const map = new Map();
  let truncated = false;
  const visit = (n, parent, prev) => {
    if (map.size >= limit) {
      truncated = true;
      return;
    }
    if (parent) map.set(n.id, snapshotNode(n, { parentId: parent.id, prevId: prev?.id ?? null }));
    (n.children || []).forEach((c, j) => visit(c, n, j ? n.children[j - 1] : null));
  };
  for (const r of roots) visit(r, null, null);
  return { map, truncated };
}

/** Layer-level diff of two snapshot maps. */
export function diffLayers(before, after) {
  const out = [];
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) {
      out.push({ id, name: a.name, type: a.type, kind: "added", props: [], before: null, after: a });
      continue;
    }
    const keys = new Set([...Object.keys(b.props), ...Object.keys(a.props)]);
    const props = [];
    for (const k of keys) if (b.props[k] !== a.props[k]) props.push({ key: k, before: b.props[k] ?? null, after: a.props[k] ?? null });
    // a new or deleted neighbour changes prevId without moving this layer: not a move
    const neighbourOnly = (a.prevId && !before.has(a.prevId)) || (b.prevId && !after.has(b.prevId));
    const moved = b.parentId !== a.parentId || (b.prevId !== a.prevId && !neighbourOnly);
    if (props.length || moved) out.push({ id, name: a.name || b.name, type: a.type, kind: "changed", props, moved, before: b, after: a });
  }
  for (const [id, b] of before) if (!after.has(id)) out.push({ id, name: b.name, type: b.type, kind: "removed", props: [], before: b, after: null });
  return out;
}

const parse = (j) => {
  if (j == null || j.startsWith(HASH)) return undefined;
  try {
    return JSON.parse(j);
  } catch {
    return undefined;
  }
};
const num = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "—");
const colorOf = (p) => {
  if (!p || typeof p !== "object") return null;
  if (p.type === "solid") return `${p.color}${p.alpha != null && p.alpha < 1 ? ` ${Math.round(p.alpha * 100)}%` : ""}`;
  if (p.stops) return `${p.type} gradient`;
  if (p.fill) return colorOf(p.fill);
  return null;
};
function fmt(key, v) {
  if (v === undefined) return "—";
  if (v === null) return "none";
  if (typeof v === "number") return key === "opacity" ? `${Math.round(v * 100)}%` : num(v);
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string") return v.length > 40 ? `“${v.slice(0, 37)}…”` : `“${v}”`;
  if (key === "stroke" && v && typeof v === "object") return `${colorOf(v) || "stroke"} ${num(v.width)} px`;
  const c = colorOf(v);
  if (c) return c;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  return "changed";
}
const decompose = (m) => {
  if (!Array.isArray(m) || m.length < 6) return null;
  const [a, b, c, d, e, f] = m;
  return { x: e, y: f, rotation: (Math.atan2(b, a) * 180) / Math.PI, sx: Math.hypot(a, b), sy: Math.hypot(c, d) };
};

/** Human lines for one property change. The transform `m` expands into x / y / rotation / scale. */
export function describeProp(key, beforeJson, afterJson) {
  if (key === "pixels") return ["pixels changed"];
  if ((beforeJson || "").startsWith(HASH) || (afterJson || "").startsWith(HASH)) return [`${key} changed (large value)`];
  const a = parse(beforeJson);
  const b = parse(afterJson);
  if (key === "m") {
    const p = decompose(a);
    const q = decompose(b);
    if (!p || !q) return ["transform changed"];
    const lines = [];
    const near = (u, v, eps) => Math.abs(u - v) < eps;
    if (!near(p.x, q.x, 0.01)) lines.push(`x ${num(p.x)} → ${num(q.x)}`);
    if (!near(p.y, q.y, 0.01)) lines.push(`y ${num(p.y)} → ${num(q.y)}`);
    if (!near(p.rotation, q.rotation, 0.01)) lines.push(`rotation ${num(p.rotation)}° → ${num(q.rotation)}°`);
    if (!near(p.sx, q.sx, 0.001) || !near(p.sy, q.sy, 0.001)) lines.push(`scale ${num(p.sx)}×${num(p.sy)} → ${num(q.sx)}×${num(q.sy)}`);
    return lines.length ? lines : ["transform changed"];
  }
  if (key === "path" || key === "points" || key === "d") return ["shape changed"];
  if (a === undefined && beforeJson == null) return [`${key} set to ${fmt(key, b)}`];
  if (b === undefined && afterJson == null) return [`${key} removed`];
  return [`${key} ${fmt(key, a)} → ${fmt(key, b)}`];
}

const LABELS = { rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", star: "Star", path: "Curve", text: "Text", image: "Image", pixel: "Pixel layer", group: "Group", adjust: "Adjustment", table: "Table", chart: "Chart" };
export const typeLabel = (t) => LABELS[t] || t || "Layer";

/** One readable line per layer change. */
export function describeLayerChange(c) {
  const head = `${typeLabel(c.type)}${c.name ? ` “${c.name}”` : ""}`;
  if (c.kind === "added") return `${head}: added`;
  if (c.kind === "removed") return `${head}: removed`;
  const lines = c.props.flatMap((p) => describeProp(p.key, p.before, p.after));
  if (c.moved) lines.push("moved in the layer order");
  return `${head}: ${lines.join(", ") || "changed"}`;
}

/** Can this layer change be reverted from its snapshots? */
export function canRevertLayer(c) {
  if (c.kind === "changed") return c.props.every((p) => !(p.before || "").startsWith(HASH) && p.key !== "pixels");
  return c.kind === "added" || (c.kind === "removed" && !!c.before?.ref);
}

/** The property patch that restores a changed layer (keys missing before → undefined). */
export function revertPatch(c) {
  const patch = {};
  for (const p of c.props) if (p.key !== "pixels") patch[p.key] = parse(p.before);
  return patch;
}

/**
 * File-level diff of two maps path → text (string) or { binary: true, size }.
 * @returns {{path, kind: "added"|"removed"|"modified", before, after, add, del, binary, tooLarge}[]}
 */
export function diffFiles(before, after, { maxChars = MAX_DIFF_CHARS } = {}) {
  const out = [];
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const path of paths) {
    const a = before.get(path);
    const b = after.get(path);
    if (a === b) continue;
    const kind = a === undefined ? "added" : b === undefined ? "removed" : "modified";
    const binary = (a != null && typeof a !== "string") || (b != null && typeof b !== "string");
    if (binary) {
      if (kind === "modified" && a.size === b.size && a.rev === b.rev) continue;
      out.push({ path, kind, before: a ?? null, after: b ?? null, add: 0, del: 0, binary: true, tooLarge: false });
      continue;
    }
    const tooLarge = (a?.length || 0) > maxChars || (b?.length || 0) > maxChars;
    let add = 0;
    let del = 0;
    if (tooLarge) {
      add = kind === "removed" ? 0 : splitLines(b).length;
      del = kind === "added" ? 0 : splitLines(a).length;
    } else {
      for (const k of diffBlocks(splitLines(a ?? ""), splitLines(b ?? ""))) {
        add += k.bLen;
        del += k.aLen;
      }
    }
    out.push({ path, kind, before: a ?? null, after: b ?? null, add, del, binary: false, tooLarge });
  }
  return out;
}

/** Change blocks between two texts (line based). */
export function textBlocks(beforeText, afterText) {
  return diffBlocks(splitLines(beforeText ?? ""), splitLines(afterText ?? ""));
}

/** `afterText` with its k-th change block replaced by the lines it had in `beforeText` (per-hunk revert). */
export function revertBlock(beforeText, afterText, k) {
  const a = splitLines(beforeText ?? "");
  const b = splitLines(afterText ?? "");
  const blk = diffBlocks(a, b)[k];
  if (!blk) return afterText;
  return [...b.slice(0, blk.bStart), ...a.slice(blk.aStart, blk.aStart + blk.aLen), ...b.slice(blk.bStart + blk.bLen)].join("");
}

const runsText = (runs) => (runs || []).map((r) => (typeof r.text === "string" ? r.text : "")).join("").replace(/￼/g, "");

/** Paragraph texts of an Office model (tables: one entry per cell, prefixed with its position). */
export function officeParagraphs(model) {
  const out = [];
  const walk = (blocks, prefix = "") => {
    for (const b of blocks || []) {
      if (b.type === "paragraph") out.push(prefix + runsText(b.runs));
      else if (b.type === "table") (b.rows || []).forEach((row, r) => (row.cells || row || []).forEach?.((cell, c) => walk(cell.blocks || cell.content || [], `${prefix}[${r + 1},${c + 1}] `)));
      else if (Array.isArray(b.blocks)) walk(b.blocks, prefix);
    }
  };
  walk(model?.blocks);
  return out;
}

/** Paragraph-level diff rows. */
export function diffParagraphs(a, b) {
  const rows = [];
  let add = 0;
  let del = 0;
  let ai = 0;
  for (const k of diffBlocks(a, b)) {
    for (; ai < k.aStart; ai++) rows.push({ t: "ctx", text: a[ai] });
    for (let i = 0; i < k.aLen; i++) rows.push({ t: "del", text: a[k.aStart + i] });
    for (let i = 0; i < k.bLen; i++) rows.push({ t: "add", text: b[k.bStart + i] });
    add += k.bLen;
    del += k.aLen;
    ai = k.aStart + k.aLen;
  }
  for (; ai < a.length; ai++) rows.push({ t: "ctx", text: a[ai] });
  return { rows, add, del };
}

/**
 * Change set of one call: { layers: { before: Map, after: Map }, files: { before: Map, after: Map },
 * office: { before: string[], after: string[], model? } } → computed diffs. Snap maps only hold touched keys.
 */
export function computeSet(raw) {
  const layers = raw.layers ? diffLayers(raw.layers.before, raw.layers.after) : [];
  const files = raw.files ? diffFiles(raw.files.before, raw.files.after) : [];
  const office = raw.office ? diffParagraphs(raw.office.before, raw.office.after) : null;
  return { layers, files, office: office && (office.add || office.del) ? office : null };
}

/** Merges per-call raw snapshots into one raw run set: the earliest "before" and latest "after" per key win. */
export function combineCalls(raws) {
  const out = { layers: { before: new Map(), after: new Map() }, files: { before: new Map(), after: new Map() }, office: null };
  const seenL = new Set();
  const seenF = new Set();
  for (const r of raws) {
    if (r.layers) {
      const keys = new Set([...r.layers.before.keys(), ...r.layers.after.keys()]);
      for (const k of keys) {
        if (!seenL.has(k)) {
          seenL.add(k);
          if (r.layers.before.has(k)) out.layers.before.set(k, r.layers.before.get(k));
        }
        if (r.layers.after.has(k)) out.layers.after.set(k, r.layers.after.get(k));
        else out.layers.after.delete(k);
      }
    }
    if (r.files) {
      const keys = new Set([...r.files.before.keys(), ...r.files.after.keys()]);
      for (const k of keys) {
        if (!seenF.has(k)) {
          seenF.add(k);
          if (r.files.before.has(k)) out.files.before.set(k, r.files.before.get(k));
        }
        if (r.files.after.has(k)) out.files.after.set(k, r.files.after.get(k));
        else out.files.after.delete(k);
      }
    }
    if (r.office) out.office = { before: out.office?.before ?? r.office.before, after: r.office.after, model: out.office?.model ?? r.office.model };
  }
  return out;
}

/** Restricts a before/after snapshot pair to the keys that differ (keeps run aggregation small). */
export function touchedOnly(before, after, same = (a, b) => a === b) {
  const b = new Map();
  const a = new Map();
  for (const [k, v] of before) if (!after.has(k) || !same(v, after.get(k))) b.set(k, v);
  for (const [k, v] of after) if (!before.has(k) || !same(before.get(k), v)) a.set(k, v);
  return { before: b, after: a };
}

/** Compares two layer snapshots (same properties, parent and position). */
export const sameLayer = (x, y) => x.parentId === y.parentId && x.prevId === y.prevId && Object.keys(x.props).length === Object.keys(y.props).length && Object.keys(x.props).every((k) => x.props[k] === y.props[k]);

/** Totals of a computed set. */
export function statOf(set) {
  let add = 0;
  let del = 0;
  for (const f of set.files || []) {
    add += f.add;
    del += f.del;
  }
  if (set.office) {
    add += set.office.add;
    del += set.office.del;
  }
  const layers = (set.layers || []).length;
  return { add, del, layers, files: (set.files || []).length, paragraphs: set.office ? set.office.add + set.office.del : 0, empty: !layers && !(set.files || []).length && !set.office };
}

/** Compact badge: "+12 −3" for text, "3 layers" for designs, both when mixed. */
export function badgeText(st) {
  const parts = [];
  if (st.add || st.del) parts.push(`+${st.add} −${st.del}`);
  if (st.layers) parts.push(`${st.layers} layer${st.layers === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
