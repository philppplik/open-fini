// Comment anchor model per studio (pure, no DOM): builds the `anchor` of a thread from a click or selection and
// resolves it again for display. The anchor shape itself is validated by `ANCHOR` in protocol.js; the rationale is in
// docs/collaboration.md ("Comment anchoring model").
//
// Public API
//   canvasAnchor({ pageId, node, bounds, point, quote }) → anchor     Vector / Pixel / Layout click
//   resolvePin(anchor, { bounds, page }) → {x, y} | null              page coordinates where the pin is drawn
//   moveAnchor(anchor, { node, bounds, point }) → anchor              result of dragging a pin to a new place
//   codeAnchor({ path, from, to, quote }) → anchor                    from/to = { line (1-based), col (0-based) }
//   codeRange(anchor, lineAt) → { from, to } | null                   absolute offsets; lineAt(n) → { from, to } | null
//   officeAnchor({ path, from, to, quote }) → anchor
//   officeItemAnchor({ item, quote, label }) → anchor                 Office Suite cells / slide objects / board items
//   elementAnchor({ elem, box, point, quote, page }) → anchor         website preview (box/point in the same space)
//   pinNumbers(threads) → Map<threadId, number>                        creation order, 1-based, stable
//   stepThread(ids, current, dir) → id | null                          "]" / "[" navigation, wraps around
//   popoverPosition({ x, y, w, h, vw, vh, margin }) → { left, top, flipped }  keeps a popover inside the viewport
// Invariants: a node anchor always carries `pin` (page coordinates) next to `off`, so a pin keeps its place when the
// layer was deleted and follows the layer (via `off`) while it exists. Coordinates are finite numbers.
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const round = (v) => Math.round(v * 100) / 100;
const clip = (s, n = 200) => String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, n);

/** Fraction of `v` inside [start, start+size]; 0.5 when the box has no extent. */
const frac = (v, start, size) => (size > 0 ? round((v - start) / size) : 0.5);

export function canvasAnchor({ pageId, node = null, bounds = null, point, quote }) {
  const x = num(point?.x);
  const y = num(point?.y);
  const base = { page: pageId, pin: { x: round(x), y: round(y) }, rect: { x: round(x), y: round(y), w: 0, h: 0 } };
  if (node && bounds && (bounds.w > 0 || bounds.h > 0)) {
    return { kind: "node", node: node.id, ...base, off: { x: frac(x, bounds.x, bounds.w), y: frac(y, bounds.y, bounds.h) }, quote: clip(quote ?? node.name ?? node.type) };
  }
  return { kind: "region", ...base, ...(quote ? { quote: clip(quote) } : {}) };
}

export function resolvePin(anchor, { bounds = null, page = null } = {}) {
  if (!anchor) return null;
  if (anchor.kind === "node") {
    if (bounds && anchor.off) return { x: bounds.x + anchor.off.x * bounds.w, y: bounds.y + anchor.off.y * bounds.h };
    if (bounds && !anchor.pin) return { x: bounds.x + bounds.w, y: bounds.y }; // comments made before pins: top right corner
    if (anchor.pin) return { ...anchor.pin }; // the layer is gone: the pin stays where it was
    return null;
  }
  if (anchor.kind === "region" || anchor.kind === "page" || anchor.kind === "element") {
    if (anchor.pin) return { ...anchor.pin };
    if (anchor.rect) return { x: anchor.rect.x + anchor.rect.w, y: anchor.rect.y };
    return page ? { x: num(page.w), y: 0 } : null;
  }
  return null;
}

/** Dragging a pin: same thread, new place. Re-binds to the layer under the new point (or to none). */
export function moveAnchor(anchor, { node = null, bounds = null, point }) {
  return canvasAnchor({ pageId: anchor.page, node, bounds, point, quote: anchor.quote });
}

export function codeAnchor({ path, from, to, quote }) {
  const a = { line: Math.max(1, Math.floor(num(from?.line, 1))), col: Math.max(0, Math.floor(num(from?.col))) };
  const b = to ? { line: Math.max(1, Math.floor(num(to.line, a.line))), col: Math.max(0, Math.floor(num(to.col))) } : null;
  const out = { kind: "line", path: clip(path, 512), line: a.line, col: a.col };
  if (b && (b.line !== a.line || b.col !== a.col)) {
    const swap = b.line < a.line || (b.line === a.line && b.col < a.col);
    const [s, e] = swap ? [b, a] : [a, b];
    out.line = s.line;
    out.col = s.col;
    out.endLine = e.line;
    out.endCol = e.col;
  }
  if (quote) out.quote = clip(quote);
  return out;
}

/** Absolute document offsets of a code anchor (a caret becomes the whole line). `lineAt(n)` → { from, to } of line n. */
export function codeRange(anchor, lineAt) {
  if (!anchor || anchor.kind !== "line") return null;
  const a = lineAt(anchor.line);
  if (!a) return null;
  const hasRange = anchor.endLine !== undefined || anchor.endCol !== undefined;
  if (!hasRange) return { from: a.from, to: a.to, whole: true };
  const b = lineAt(anchor.endLine ?? anchor.line) || a;
  const from = Math.min(a.to, a.from + num(anchor.col));
  const to = Math.min(b.to, b.from + num(anchor.endCol, b.to - b.from));
  return to >= from ? { from, to, whole: false } : { from: to, to: from, whole: false };
}

export function officeAnchor({ path, from, to, quote }) {
  const a = Math.max(0, Math.floor(num(from)));
  const b = Math.max(a, Math.floor(num(to, a)));
  return { kind: "text", path: typeof path === "string" ? path.slice(0, 512) : JSON.stringify(path || []).slice(0, 512), from: a, to: b, ...(quote ? { quote: clip(quote) } : {}) };
}

/**
 * Office Suite apps other than the word processor: a comment on a cell, slide object or board item, identified by the
 * same stable record key the app uses for live editing (collab/office-records.js). `label` is shown when the item is
 * gone ("B3", "Slide 2 · Title").
 */
export function officeItemAnchor({ item, quote, label }) {
  const key = clip(item, 256);
  if (!key) return { kind: "doc" };
  const q = quote || label;
  return { kind: "item", item: key, ...(q ? { quote: clip(q) } : {}) };
}

export function elementAnchor({ elem, sel, path, box = null, point = null, quote, page }) {
  const out = { kind: "element", elem: clip(elem, 256) };
  if (sel) out.sel = clip(sel, 256); // "0/1/3": element-sibling indexes, resolved with engine/web/html.js elementAtPath
  if (path) out.path = clip(path, 512); // the HTML file
  if (page) out.page = page;
  if (box && point) out.off = { x: frac(point.x, box.x, box.w), y: frac(point.y, box.y, box.h) };
  if (quote) out.quote = clip(quote);
  return out;
}

export function pinNumbers(threads) {
  const sorted = [...threads].sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));
  return new Map(sorted.map((t, i) => [t.id, i + 1]));
}

export function stepThread(ids, current, dir = 1) {
  if (!ids.length) return null;
  const i = ids.indexOf(current);
  if (i < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(i + (dir > 0 ? 1 : ids.length - 1)) % ids.length];
}

export function popoverPosition({ x, y, w, h, vw, vh, margin = 8 }) {
  let left = x + 12;
  let top = y + 12;
  let flipped = false;
  if (left + w > vw - margin) left = Math.max(margin, x - w - 12);
  if (top + h > vh - margin) {
    top = Math.max(margin, y - h - 12);
    flipped = true;
  }
  return { left: Math.round(Math.max(margin, left)), top: Math.round(Math.max(margin, top)), flipped };
}
