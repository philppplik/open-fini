// Geometry measurement of the Proto canvas (docs/concepts/proto-studio.md §4.1): reads the border boxes of the
// rendered layers of one top-level layer and converts them into world coordinates for the geometry cache
// (proto/geometry.js). Called by proto/view.js inside requestAnimationFrame after all patches of a frame were applied,
// so every read happens in one read phase (no layout thrashing).
//
//   measureRoot({ rootId, entries, els, cam, origin, base }) → geometry entries (paint order)
//     entries   the render description of the layer (proto/patch.js ▸ entriesFor), Map key → entry
//     els       Map key → element
//     cam       the camera the DOM is shown with; origin: the stage's client rect left/top
//     base      paint order offset of this top-level layer (its index on the page × 1e6)
import { clipRect } from "./geometry.js";

const CLIPS = new Set(["hidden", "clip", "auto", "scroll"]);
const clips = (entry) => entry.decls.some(([p, v]) => (p === "overflow" || p === "overflow-x" || p === "overflow-y") && CLIPS.has(v));
const round = (v) => Math.round(v * 100) / 100 || 0;
const hidden = (entry) => entry.decls.some(([p, v]) => p === "display" && v === "none");

export function measureRoot({ rootId, entries, els, cam, origin, base = 0 }) {
  const out = [];
  let order = base;
  const root = [...entries.values()].find((e) => e.parent == null);
  if (!root) return out;
  const visit = (key, clip, sel) => {
    const e = entries.get(key);
    const el = els.get(key);
    if (!e || !el || hidden(e)) return;
    const r = el.getBoundingClientRect();
    // client rects are in stage pixels: dividing by the zoom brings float noise, rounded to 1/100 px
    const box = {
      x: round((r.left - origin.left - cam.x) / cam.zoom),
      y: round((r.top - origin.top - cam.y) / cam.zoom),
      w: round(r.width / cam.zoom),
      h: round(r.height / cam.zoom),
    };
    // inside an instance a click selects the outermost instance (its key is the first path segment)
    const s = sel || (e.type === "instance" ? e.id : null);
    out.push({ key, id: e.id, sel: s || e.id, root: rootId, parent: e.parent, type: e.type, name: e.name, ...box, order: order++, clip, paint: e.paint });
    const inner = clips(e) ? clipRect(clip, box) : clip;
    for (const k of e.children) visit(k, inner, s);
  };
  visit(root.key, null, null);
  return out;
}
