// Generated performance fixture of the Proto renderer (docs/concepts/proto-studio.md §4.3, task T3). Pure: used by
// the Node pipeline test (pipeline.test.js) and by the browser benchmark (bench.html, scripts/proto-perf.mjs).
//
//   perfDesign({ frames = 50, cards = 14, cols = 10 }) → { model, page, nodes }
// Every frame is a 720 px wide card grid (CSS grid, two columns) with a heading and `cards` cards; a card is a flex row
// with an avatar, a text column with two lines and two badges: 1 + 1 + cards × 7 = 100 layers per frame by default,
// so 50 frames are 5,000 layers. Frames sit on a grid of `cols` columns, 760 × 660 px apart.
import * as S from "../../../app/src/engine/proto/schema.js";
import { apply } from "../../../app/src/engine/proto/ops.js";
import { seededRandom } from "../../../app/src/engine/proto/ids.js";

const PALETTE = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#ef4444"];

const fixed = (value) => ({ mode: "fixed", value });
const text = (t, size, weight, color) => ({ type: "text", fields: { name: t, text: { runs: [{ t, s: {} }], style: { font: "Inter", size, weight, lineHeight: { pct: 140 }, color }, autoSize: "width", maxLines: null }, pos: "flow" } });

function card(i, j) {
  const c = PALETTE[(i + j) % PALETTE.length];
  return {
    type: "frame",
    fields: { name: `Card ${j + 1}`, pos: "flow", w: { mode: "fill" }, h: { mode: "hug" }, layout: { type: "flex", dir: "row", gap: 12, pad: [12, 12, 12, 12], align: "center" }, fills: [{ type: "solid", color: "#ffffff" }], strokes: [{ color: "#e4e4e7", w: 1, align: "inside" }], radius: [10, 10, 10, 10], clip: false },
    children: [
      { type: "ellipse", fields: { name: "Avatar", pos: "flow", w: fixed(40), h: fixed(40), fills: [{ type: "solid", color: c }] } },
      { type: "frame", fields: { name: "Copy", pos: "flow", w: { mode: "fill" }, h: { mode: "hug" }, layout: { type: "flex", dir: "column", gap: 2 }, fills: [], clip: false }, children: [text(`Item ${i * 100 + j}`, 14, 600, "#18181b"), text("Secondary line", 12, 400, "#71717a")] },
      { type: "rect", fields: { name: "Badge", pos: "flow", w: fixed(20), h: fixed(20), radius: [6, 6, 6, 6], fills: [{ type: "solid", color: c }], opacity: 0.6 } },
      { type: "rect", fields: { name: "Dot", pos: "flow", w: fixed(8), h: fixed(8), radius: [4, 4, 4, 4], fills: [{ type: "solid", color: "#22c55e" }] } },
    ],
  };
}

export function perfDesign({ frames = 50, cards = 14, cols = 10, seed = 42 } = {}) {
  const page = "p1";
  let model = S.emptyDocument({ title: "Performance fixture", created: "2026-01-01T00:00:00Z", pageId: page });
  const ops = [];
  for (let i = 0; i < frames; i++) {
    ops.push({
      op: "node.create",
      type: "frame",
      page,
      fields: {
        name: `Screen ${i + 1}`,
        x: (i % cols) * 760,
        y: Math.floor(i / cols) * 660,
        w: fixed(720),
        h: { mode: "hug" },
        layout: { type: "grid", gap: 8, rowGap: 8, pad: [16, 16, 16, 16], grid: { cols: [{ fr: 1 }, { fr: 1 }], rows: [], autoFlow: "row" } },
        fills: [{ type: "solid", color: "#f8fafc" }],
        radius: [16, 16, 16, 16],
      },
      children: [{ ...text(`Screen ${i + 1}`, 20, 700, "#0f172a"), fields: { ...text(`Screen ${i + 1}`, 20, 700, "#0f172a").fields, cell: { col: 1, colSpan: 2 } } }, ...Array.from({ length: cards }, (_, j) => card(i, j))],
    });
  }
  model = apply(model, { op: "batch", ops }, { random: seededRandom(seed) }).model;
  return { model, page, nodes: Object.keys(model.nodes).length };
}
