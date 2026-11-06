// Whiteboard diagram generators (Vibe board_add_diagram): structured input → shapes, sticky notes and bound
// connectors, already laid out. Pure; returns element props for model.addElements (connectors use start/end ids, so
// they follow the shapes when people move them). Tested in tests/office/board-objects.test.js.
//
//   items: [{ text, children?: items }]      (strings are accepted as { text })
//   mindmap   title in the center, branches around it, children fanned out beyond each branch
//   tree      title at the top, levels downward (org charts, decision trees, outlines)
//   timeline  a line with one dot and label per item, labels alternating above and below
//   cycle     items on a circle, arrows from each to the next
//   matrix    a 2 × 2 grid of frames (first four items), children as sticky notes inside
import { makeElement, STICKY_COLORS } from "./model.js";

export const DIAGRAM_KINDS = ["mindmap", "tree", "timeline", "cycle", "matrix"];
const COLORS = ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffc9c9", "#d0bfff", "#99e9f2", "#ffd8a8"];

const norm = (items, depth = 0) => (Array.isArray(items) ? items : []).slice(0, 40).map((it) => (typeof it === "string" ? { text: it, children: [] } : { text: String(it?.text ?? "").slice(0, 300), children: depth < 3 ? norm(it?.children, depth + 1) : [] })).filter((it) => it.text.trim());

/** Builds a diagram; `at` is its top-left corner. Returns { elements, ids: { root, items } }. */
export function buildDiagram(kind, { title = "", items = [], page, at = [0, 0], style = {} } = {}) {
  const list = norm(items);
  if (!DIAGRAM_KINDS.includes(kind)) throw new Error(`Unknown diagram "${kind}". Kinds: ${DIAGRAM_KINDS.join(", ")}.`);
  if (!list.length && kind !== "mindmap") throw new Error("Give at least one item.");
  const els = [];
  const base = { page, rough: style.rough ?? 1 };
  const shape = (type, x, y, w, h, text, extra = {}) => {
    const e = makeElement(type, { ...base, x: Math.round(at[0] + x), y: Math.round(at[1] + y), w, h, text, ...extra });
    els.push(e);
    return e;
  };
  const link = (a, b, type = "arrow", extra = {}) => els.push(makeElement(type, { ...base, points: [[a.x + a.w / 2, a.y + a.h / 2], [b.x + b.w / 2, b.y + b.h / 2]], start: { id: a.id }, end: { id: b.id }, ...extra }));
  if (kind === "mindmap") {
    const R = 260 + list.length * 12;
    const cx = R + 120, cy = R + 60;
    const center = shape("ellipse", cx - 110, cy - 50, 220, 100, title || "Topic", { fill: "#ffe066", fontSize: 24 });
    list.forEach((it, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      const b = shape("rect", cx + Math.cos(a) * R - 90, cy + Math.sin(a) * R * 0.75 - 35, 180, 70, it.text, { fill: COLORS[i % COLORS.length], round: true });
      link(center, b, "line");
      it.children.forEach((c, j) => {
        const spread = (j - (it.children.length - 1) / 2) * 0.32;
        const r2 = R + 230;
        const s = shape("sticky", cx + Math.cos(a + spread) * r2 - 70, cy + Math.sin(a + spread) * r2 * 0.75 - 50, 140, 100, c.text, { fill: STICKY_COLORS[i % STICKY_COLORS.length], fontSize: 16 });
        link(b, s, "line");
      });
    });
    return { elements: els, ids: { root: center.id } };
  }
  if (kind === "tree") {
    const W = 170, H = 70, GX = 30, GY = 90;
    const leaves = (n) => (n.children.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1);
    const top = { text: title || "Root", children: list };
    const place = (n, depth, x0) => {
      const span = leaves(n) * (W + GX);
      const e = shape("rect", x0 + span / 2 - W / 2, depth * (H + GY), W, H, n.text, { fill: COLORS[depth % COLORS.length], round: true });
      let x = x0;
      for (const c of n.children) {
        const ce = place(c, depth + 1, x);
        link(e, ce);
        x += leaves(c) * (W + GX);
      }
      return e;
    };
    const r = place(top, 0, 0);
    return { elements: els, ids: { root: r.id } };
  }
  if (kind === "timeline") {
    const step = 220, y = 200;
    const width = Math.max(1, list.length) * step;
    if (title) shape("text", 0, 0, 600, 40, title, { fontSize: 32, font: "sans" });
    els.push(makeElement("arrow", { ...base, points: [[at[0], at[1] + y], [at[0] + width + 40, at[1] + y]], width: 3 }));
    list.forEach((it, i) => {
      const x = 60 + i * step;
      const dot = shape("ellipse", x - 12, y - 12, 24, 24, "", { fill: COLORS[i % COLORS.length] });
      const above = i % 2 === 0;
      const note = shape("sticky", x - 85, above ? y - 170 : y + 50, 170, 120, it.children.length ? `${it.text}\n${it.children.map((c) => c.text).join("\n")}` : it.text, { fill: STICKY_COLORS[i % STICKY_COLORS.length], fontSize: 16 });
      link(note, dot, "line", { dash: "dotted" });
    });
    return { elements: els, ids: {} };
  }
  if (kind === "cycle") {
    const n = list.length, R = 140 + n * 30, cx = R + 100, cy = R + 60;
    if (title) shape("text", cx - 150, cy - 20, 300, 40, title, { fontSize: 26, align: "center", font: "sans" });
    const nodes = list.map((it, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return shape("ellipse", cx + Math.cos(a) * R - 85, cy + Math.sin(a) * R - 45, 170, 90, it.text, { fill: COLORS[i % COLORS.length] });
    });
    if (n > 1) nodes.forEach((a, i) => link(a, nodes[(i + 1) % n], "arrow", { curve: true }));
    return { elements: els, ids: {} };
  }
  // matrix
  const Q = 360;
  if (title) shape("text", 0, -60, 2 * Q, 40, title, { fontSize: 30, font: "sans" });
  list.slice(0, 4).forEach((it, i) => {
    const fx = (i % 2) * (Q + 20), fy = Math.floor(i / 2) * (Q + 20);
    els.push(makeElement("frame", { ...base, rough: 0, x: Math.round(at[0] + fx), y: Math.round(at[1] + fy), w: Q, h: Q, name: it.text }));
    const frame = els[els.length - 1];
    it.children.slice(0, 6).forEach((c, j) => {
      const s = shape("sticky", fx + 16 + (j % 2) * 170, fy + 16 + Math.floor(j / 2) * 110, 150, 96, c.text, { fill: STICKY_COLORS[i % STICKY_COLORS.length], fontSize: 15 });
      s.frame = frame.id;
    });
  });
  return { elements: els, ids: {} };
}
