// Editing operations on the document/selection. Used by tools, menus, panels and shortcuts.
// Every function groups its changes into one undoable step.
import { clone, uid } from "./util.js";
import { createNode, shapeGeometry, isShape, localBounds, worldMatrix, solid, defaultStroke, walk, remapLinks } from "./nodes.js";
import { mul, invert, translate, scaleAbout, apply, ident, rectUnion, rectTransform, isIdentity } from "./math.js";
import { pageBounds, pageBoundsOf, nudge } from "./transform.js";
import { booleanPaths, expandStroke } from "../engine/vector/boolean.js";
import { transformPath, pathToData } from "../engine/vector/path.js";

export const LABELS = { rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", star: "Star", path: "Curve", text: "Text", image: "Image", pixel: "Pixel Layer", group: "Group", adjust: "Adjustment" };

// ---------------------------------------------------------------- creation

/** Default style for new vector objects, from the app's current fill/stroke. */
export function applyStyle(app, node, { closed = true } = {}) {
  if (node.type === "text") return node;
  if (closed) {
    node.fill = app.style.fill ? clone(app.style.fill) : null;
    node.stroke = app.style.stroke ? clone(app.style.stroke) : null;
  } else {
    node.fill = null;
    node.stroke = app.style.stroke ? clone(app.style.stroke) : defaultStroke("#000000", 2);
    if (node.stroke && !node.stroke.width) node.stroke.width = 2;
  }
  return node;
}

/** Inserts nodes into `parent` (default: the editing context) on top, selects them. */
export function addNodes(app, nodes, { parent = app.context, label = "Add", select = true, index } = {}) {
  const doc = app.doc;
  const list = Array.isArray(nodes) ? nodes : [nodes];
  doc.tx(label, () => {
    for (const n of list) doc.insert(n, parent, index ?? parent.children.length);
  });
  if (select) app.select(list);
  return list;
}

export function topLevelSelection(app) {
  // selected nodes whose ancestors are not also selected
  const set = new Set(app.selection);
  return app.selection.filter((n) => {
    for (let p = n._parent; p; p = p._parent) if (set.has(p)) return false;
    return true;
  });
}

// ---------------------------------------------------------------- delete / duplicate

export function deleteSelection(app) {
  const doc = app.doc;
  const nodes = topLevelSelection(app).filter((n) => !n.locked);
  if (!nodes.length) return false;
  doc.tx("Delete", () => nodes.forEach((n) => doc.remove(n)));
  app.clearSelection();
  return true;
}

export function duplicateSelection(app, { offset = 0 } = {}) {
  const doc = app.doc;
  const nodes = topLevelSelection(app);
  if (!nodes.length) return [];
  const copies = [];
  doc.tx("Duplicate", () => {
    for (const n of nodes) {
      const c = doc.cloneNode(n);
      c.name = n.name;
      if (offset) c.m = mul(translate(offset, offset), c.m);
      doc.insert(c, n._parent, n._parent.children.indexOf(n) + 1);
      copies.push(c);
    }
    remapLinks(nodes, copies);
  });
  app.select(copies);
  return copies;
}

// ---------------------------------------------------------------- reparenting

/** Moves `node` under `parent` at `index`, keeping its on-page appearance. */
export function reparent(doc, node, parent, index = parent.children.length) {
  const oldW = node._parent ? worldMatrix(node._parent) : ident();
  const newW = worldMatrix(parent);
  const inv = invert(newW) || ident();
  const m = mul(inv, mul(oldW, node.m));
  doc.set(node, { m });
  doc.move(node, parent, index);
}

// ---------------------------------------------------------------- grouping & arrangement

export function groupSelection(app, { name } = {}) {
  const doc = app.doc;
  const nodes = topLevelSelection(app);
  if (nodes.length < 1) return null;
  const parent = nodes[0]._parent;
  let group;
  doc.tx("Group", () => {
    const sorted = nodes.slice().sort((a, b) => (a._parent === parent ? a._parent.children.indexOf(a) : 1e9) - (b._parent === parent ? b._parent.children.indexOf(b) : 1e9));
    const topIndex = Math.max(...sorted.map((n) => (n._parent === parent ? parent.children.indexOf(n) : 0)));
    group = createNode("group", { name: name || "Group" });
    doc.insert(group, parent, topIndex + 1);
    for (const n of sorted) reparent(doc, n, group, group.children.length);
  });
  app.select([group]);
  return group;
}

export function ungroupSelection(app) {
  const doc = app.doc;
  const groups = topLevelSelection(app).filter((n) => n.type === "group");
  if (!groups.length) return false;
  const out = [];
  doc.tx("Ungroup", () => {
    for (const g of groups) {
      const parent = g._parent;
      let at = parent.children.indexOf(g);
      const kids = g.children.slice();
      for (const k of kids) {
        // fold the group's own transform/opacity into the children so appearance is unchanged
        const W = worldMatrix(g);
        const pw = worldMatrix(parent);
        const m = mul(invert(pw) || ident(), mul(W, k.m));
        doc.set(k, { m, opacity: k.opacity * g.opacity });
        doc.move(k, parent, ++at);
        out.push(k);
      }
      doc.remove(g);
    }
  });
  app.select(out);
  return true;
}

export function arrange(app, mode) {
  const doc = app.doc;
  const nodes = topLevelSelection(app);
  if (!nodes.length) return false;
  doc.tx("Arrange", () => {
    const byParent = new Map();
    for (const n of nodes) {
      if (!byParent.has(n._parent)) byParent.set(n._parent, []);
      byParent.get(n._parent).push(n);
    }
    for (const [parent, list] of byParent) {
      const order = list.slice().sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b));
      const len = parent.children.length;
      if (mode === "front") order.forEach((n) => doc.move(n, parent, len));
      else if (mode === "back") order.reverse().forEach((n) => doc.move(n, parent, 0));
      else if (mode === "forward") {
        for (const n of order.slice().reverse()) {
          const i = parent.children.indexOf(n);
          if (i < parent.children.length - 1 && !list.includes(parent.children[i + 1])) doc.move(n, parent, i + 2);
        }
      } else if (mode === "backward") {
        for (const n of order) {
          const i = parent.children.indexOf(n);
          if (i > 0 && !list.includes(parent.children[i - 1])) doc.move(n, parent, i - 1);
        }
      }
    }
  });
  return true;
}

export function setProp(app, key, value, label = "Edit") {
  const doc = app.doc;
  const nodes = topLevelSelection(app);
  if (!nodes.length) return;
  doc.tx(label, () => nodes.forEach((n) => doc.set(n, { [key]: value })), { coalesce: `prop:${key}` });
}

export function toggleFlag(app, key) {
  const doc = app.doc;
  const nodes = topLevelSelection(app);
  if (!nodes.length) return;
  const val = !nodes.every((n) => n[key]);
  doc.tx(key === "locked" ? (val ? "Lock" : "Unlock") : val ? "Hide" : "Show", () => nodes.forEach((n) => doc.set(n, { [key]: val })));
}

// ---------------------------------------------------------------- align / distribute / flip

export function align(app, mode, { toPage = false } = {}) {
  const doc = app.doc;
  const nodes = topLevelSelection(app).filter((n) => !n.locked);
  if (!nodes.length) return;
  const page = app.page;
  const ref = toPage || nodes.length === 1 ? { x: 0, y: 0, w: page.w, h: page.h } : pageBoundsOf(nodes);
  doc.tx("Align", () => {
    for (const n of nodes) {
      const b = pageBounds(n);
      if (!b) continue;
      let dx = 0;
      let dy = 0;
      if (mode === "left") dx = ref.x - b.x;
      else if (mode === "centerH") dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      else if (mode === "right") dx = ref.x + ref.w - (b.x + b.w);
      else if (mode === "top") dy = ref.y - b.y;
      else if (mode === "centerV") dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      else if (mode === "bottom") dy = ref.y + ref.h - (b.y + b.h);
      if (!dx && !dy) continue;
      const before = doc.snapshot(n, ["m"]);
      nudge(n, dx, dy);
      doc.touch(n);
      doc.recordSet(n, before, "Align");
    }
  });
}

export function distribute(app, axis) {
  const doc = app.doc;
  const nodes = topLevelSelection(app).filter((n) => !n.locked);
  if (nodes.length < 3) return;
  const items = nodes.map((n) => ({ n, b: pageBounds(n) })).filter((i) => i.b);
  const horiz = axis === "h";
  items.sort((a, b) => (horiz ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const total = horiz ? last.x + last.w - first.x : last.y + last.h - first.y;
  const sizes = items.reduce((s, i) => s + (horiz ? i.b.w : i.b.h), 0);
  const gap = (total - sizes) / (items.length - 1);
  let pos = horiz ? first.x : first.y;
  doc.tx("Distribute", () => {
    for (const it of items) {
      const cur = horiz ? it.b.x : it.b.y;
      const d = pos - cur;
      if (Math.abs(d) > 1e-6) {
        const before = doc.snapshot(it.n, ["m"]);
        nudge(it.n, horiz ? d : 0, horiz ? 0 : d);
        doc.touch(it.n);
        doc.recordSet(it.n, before, "Distribute");
      }
      pos += (horiz ? it.b.w : it.b.h) + gap;
    }
  });
}

export function flip(app, axis) {
  const doc = app.doc;
  const nodes = topLevelSelection(app).filter((n) => !n.locked);
  if (!nodes.length) return;
  const b = pageBoundsOf(nodes);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const D = axis === "h" ? scaleAbout(-1, 1, cx, cy) : scaleAbout(1, -1, cx, cy);
  doc.tx(axis === "h" ? "Flip Horizontal" : "Flip Vertical", () => {
    for (const n of nodes) {
      const P = n._parent ? worldMatrix(n._parent) : ident();
      const m = mul(invert(P) || ident(), mul(D, mul(P, n.m)));
      doc.set(n, { m });
    }
  });
}

export function rotateSelection(app, degrees) {
  const doc = app.doc;
  const nodes = topLevelSelection(app).filter((n) => !n.locked);
  if (!nodes.length) return;
  const b = pageBoundsOf(nodes);
  const a = (degrees * Math.PI) / 180;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const D = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
  doc.tx("Rotate", () => {
    for (const n of nodes) {
      const P = n._parent ? worldMatrix(n._parent) : ident();
      doc.set(n, { m: mul(invert(P) || ident(), mul(D, mul(P, n.m))) });
    }
  });
}

// ---------------------------------------------------------------- curves & booleans

export function convertToCurves(app, nodes = topLevelSelection(app)) {
  const doc = app.doc;
  const targets = nodes.filter((n) => isShape(n) && n.type !== "path");
  if (!targets.length) return false;
  doc.tx("Convert to Curves", () => {
    for (const n of targets) {
      const path = clone(shapeGeometry(n));
      const keep = { path, rule: n.rule || "nonzero", type: "path", name: n.name === LABELS[n.type] ? "Curve" : n.name };
      doc.set(n, keep);
      for (const k of ["w", "h", "r", "sides", "points", "ratio", "cr"]) if (n[k] !== undefined) doc.set(n, { [k]: undefined });
    }
  });
  return true;
}

/** Applies a boolean operation to the selected shapes. */
export function booleanOp(app, op) {
  const doc = app.doc;
  const nodes = topLevelSelection(app).filter(isShape);
  if (nodes.length < 2) {
    app.toast("Select at least two shapes first.", "warning");
    return false;
  }
  const ordered = nodes.slice().sort(compareOrder); // bottom → top
  const bottom = ordered[0];
  const parent = bottom._parent;
  const Pinv = invert(worldMatrix(parent)) || ident();
  const items = ordered.map((n) => {
    const M = mul(Pinv, worldMatrix(n));
    return { path: transformPath(shapeGeometry(n), M), rule: n.rule || "nonzero" };
  });
  const results = booleanPaths(op, items);
  if (!results.length) {
    app.toast("The result is empty.", "warning");
    return false;
  }
  const created = [];
  doc.tx(`Boolean ${op}`, () => {
    const at = parent.children.indexOf(bottom);
    results.forEach((path, i) => {
      const node = createNode("path", { name: op === "divide" ? `Piece ${i + 1}` : "Curve", path, rule: "evenodd" });
      node.fill = clone(bottom.fill);
      node.stroke = clone(bottom.stroke);
      node.opacity = bottom.opacity;
      node.blend = bottom.blend;
      node.fx = clone(bottom.fx || []);
      doc.insert(node, parent, at + i);
      created.push(node);
    });
    for (const n of ordered) doc.remove(n);
  });
  app.select(created);
  return true;
}

/** Document (paint) order comparator: lower = further back. */
export function compareOrder(a, b) {
  const chain = (n) => {
    const c = [];
    for (let x = n; x && x._parent; x = x._parent) c.push(x._parent.children.indexOf(x));
    return c.reverse();
  };
  const ca = chain(a);
  const cb = chain(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) if (ca[i] !== cb[i]) return ca[i] - cb[i];
  return ca.length - cb.length;
}

export function expandStrokeOp(app) {
  const doc = app.doc;
  const nodes = topLevelSelection(app).filter((n) => isShape(n) && n.stroke && n.stroke.width > 0);
  if (!nodes.length) {
    app.toast("Select a shape with a stroke.", "warning");
    return false;
  }
  const created = [];
  doc.tx("Expand Stroke", () => {
    for (const n of nodes) {
      const geo = shapeGeometry(n);
      const outline = expandStroke(geo, n.stroke);
      if (!outline.subpaths.length) continue;
      const out = createNode("path", { name: `${n.name} Outline`, path: outline, rule: "nonzero", m: n.m.slice() });
      out.fill = clone(n.stroke.fill);
      out.stroke = null;
      out.opacity = n.opacity;
      doc.insert(out, n._parent, n._parent.children.indexOf(n) + 1);
      created.push(out);
      if (n.fill) doc.set(n, { stroke: null });
      else doc.remove(n);
    }
  });
  if (created.length) app.select(created);
  return true;
}

// ---------------------------------------------------------------- clipboard

export function copySelection(app) {
  const doc = app.doc;
  const nodes = topLevelSelection(app);
  if (!nodes.length) return false;
  app.clip = { nodes: nodes.map((n) => doc.cloneNode(n)), page: app.page.id, stories: Object.fromEntries(nodes.flatMap((n) => storyRefs(doc, n))) };
  app.emit("clipboard");
  return true;
}

function storyRefs(doc, node) {
  const out = [];
  walk(node, (n) => {
    if (n.type === "text" && n.storyId && doc.stories[n.storyId]) out.push([n.storyId, clone(doc.stories[n.storyId])]);
  });
  return out;
}

export function pasteClipboard(app, { inPlace = false } = {}) {
  const doc = app.doc;
  const clip = app.clip;
  if (!clip || !clip.nodes.length) return false;
  const created = [];
  doc.tx("Paste", () => {
    for (const [id, entry] of Object.entries(clip.stories || {})) if (!doc.stories[id]) doc.createStory(clone(entry.story), id);
    for (const n of clip.nodes) {
      const c = doc.cloneNode(n);
      // pasted text frames get their own story copy so edits stay independent
      walk(c, (t) => {
        if (t.type === "text" && t.storyId) {
          const src = doc.stories[t.storyId];
          if (src) {
            const sid = doc.createStory(clone(src.story), uid("s"));
            doc.stories[sid].defaults = clone(src.defaults);
            t.storyId = sid;
            t.linked = false;
            t.flowIndex = 0;
          }
        }
      });
      if (!inPlace) c.m = mul(translate(16, 16), c.m);
      doc.insert(c, app.context, app.context.children.length);
      created.push(c);
    }
    remapLinks(clip.nodes, created);
  });
  app.select(created);
  return true;
}

// ---------------------------------------------------------------- misc

/** Centers content/selection in the viewport-independent sense: returns union bounds for ops needing it. */
export function selectionBounds(app) {
  return pageBoundsOf(app.selection);
}

export { localBounds, rectUnion, rectTransform, apply, isIdentity, pathToData, solid };
