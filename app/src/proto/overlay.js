// The Canvas 2D overlay above the Proto stage (docs/concepts/proto-studio.md §4.1, §4.2): frame names, hover and
// selection outlines, the marquee, and the simplified drawing of top-level layers that are zoomed out too far to keep
// their DOM (level of detail). Everything is drawn from the geometry cache in stage pixels; nothing reads the DOM.
// Tools (T4) add guides, handles and redlines with addLayer(draw) → remove.
//
//   createOverlay(canvas) → { draw(state), addLayer(fn) → off, resize(w, h, dpr) }
//   state: { cam, selection: entries, hover: entry|null, marquee: world rect|null, frames: [{ id, name, box, state,
//            entries }], accent, text, muted }
import { toScreen } from "./camera.js";
import { unionRect } from "./geometry.js";

const LABEL_FONT = "11px Inter, system-ui, sans-serif";

export function createOverlay(canvas) {
  const ctx = canvas.getContext("2d");
  const layers = new Set();
  let W = 0;
  let H = 0;
  let DPR = 1;

  const rectOf = (cam, b) => {
    const p = toScreen(cam, b.x, b.y);
    return { x: p.x, y: p.y, w: b.w * cam.zoom, h: b.h * cam.zoom };
  };
  const visible = (r) => r.x < W && r.y < H && r.x + r.w > 0 && r.y + r.h > 0;

  /** Simplified drawing of a top-level layer: its box and fill, and blocks for its children (lines for text). */
  function drawLod(cam, f, color) {
    const r = rectOf(cam, f.box);
    if (!visible(r)) return;
    if (f.state === "block" || !f.entries.length) {
      const root = f.entries[0];
      ctx.fillStyle = root?.paint?.fill || "#ffffff";
      ctx.fillRect(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h));
      ctx.strokeStyle = color.muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)));
      return;
    }
    for (const e of f.entries) {
      const b = rectOf(cam, e);
      if (b.w < 0.5 && b.h < 0.5) continue;
      if (e.paint?.text) {
        ctx.fillStyle = "rgba(120,120,130,0.55)";
        const lines = Math.max(1, Math.min(40, Math.round(e.h / 20))); // about one block per 20 px line
        const lh = b.h / lines;
        for (let i = 0; i < lines; i++) ctx.fillRect(b.x, b.y + i * lh + lh * 0.25, b.w * (i === lines - 1 && lines > 1 ? 0.6 : 1), Math.max(0.5, lh * 0.5));
      } else if (e.paint?.fill) {
        ctx.fillStyle = e.paint.fill;
        if (e.paint.ellipse && b.w > 2 && b.h > 2) {
          ctx.beginPath();
          ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(b.x, b.y, Math.max(0.5, b.w), Math.max(0.5, b.h));
      }
    }
  }

  function draw(s) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { cam } = s;
    const color = { accent: s.accent || "#0d99ff", text: s.text || "#71717a", muted: s.muted || "rgba(0,0,0,0.18)" };
    // level of detail first: these layers have no DOM below the overlay
    for (const f of s.frames) if (f.state === "lod" || f.state === "block") drawLod(cam, f, color);
    // frame names above the top-level frames
    ctx.font = LABEL_FONT;
    ctx.textBaseline = "bottom";
    const selected = new Set(s.selection.map((e) => e.key));
    for (const f of s.frames) {
      if (f.type !== "frame" && f.type !== "component" && f.type !== "componentSet") continue;
      const r = rectOf(cam, f.box);
      if (!visible({ x: r.x, y: r.y - 16, w: r.w, h: r.h + 16 }) || r.w < 24) continue;
      ctx.fillStyle = selected.has(f.id) ? color.accent : color.text;
      const name = f.name || "";
      let label = name;
      if (ctx.measureText(label).width > r.w) {
        while (label.length > 1 && ctx.measureText(label + "…").width > r.w) label = label.slice(0, -1);
        label += "…";
      }
      ctx.fillText(label, r.x, r.y - 4);
    }
    // hover outline
    if (s.hover && !selected.has(s.hover.key)) {
      const r = rectOf(cam, s.hover);
      ctx.strokeStyle = color.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    // selection: each layer, and the bounds of a multiple selection with corner handles
    if (s.selection.length) {
      ctx.strokeStyle = color.accent;
      ctx.lineWidth = 1;
      for (const e of s.selection) {
        const r = rectOf(cam, e);
        ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      }
      const u = unionRect(s.selection);
      if (u) {
        const r = rectOf(cam, u);
        if (s.selection.length > 1) ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
        ctx.fillStyle = "#ffffff";
        for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
          ctx.fillRect(Math.round(hx) - 3, Math.round(hy) - 3, 7, 7);
          ctx.strokeRect(Math.round(hx) - 2.5, Math.round(hy) - 2.5, 6, 6);
        }
        // size badge under the selection
        const label = `${Math.round(u.w)} × ${Math.round(u.h)}`;
        ctx.font = LABEL_FONT;
        const tw = ctx.measureText(label).width + 10;
        const bx = r.x + r.w / 2 - tw / 2;
        const by = r.y + r.h + 6;
        ctx.fillStyle = color.accent;
        ctx.fillRect(bx, by, tw, 16);
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, bx + 5, by + 8.5);
      }
    }
    // marquee
    if (s.marquee) {
      const r = rectOf(cam, s.marquee);
      ctx.fillStyle = "rgba(13,153,255,0.08)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = color.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    }
    for (const fn of layers) {
      try {
        ctx.save();
        fn(ctx, s);
      } finally {
        ctx.restore();
      }
    }
  }

  return {
    draw,
    resize(w, h, dpr = 1) {
      W = w;
      H = h;
      DPR = dpr;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    },
    /** Adds a drawing layer (tools: guides, handles): `fn(ctx, state)` in stage pixels. Returns a remove function. */
    addLayer(fn) {
      layers.add(fn);
      return () => layers.delete(fn);
    },
  };
}
