// Scene Studio frame-accurate rendering: the frame at time t with every video source seeked exactly (the viewer
// draws what its playing elements show; the exporter, thumbnails of the sequence and the assistant's tools need the
// exact frame). Shared by scene/export.js, scene/analysis.js and vibe/tools/scene.js.
//
//   renderExact(store, model, t, { seq, scale, ... }) → Promise<canvas>
//   createExactRenderer(store) → { render(model, t, opts) → Promise<canvas>, canvas }   reuses one canvas (export loop)
// Invariant: sources are captured as bitmaps per clip before drawing, so two clips of the same media item at
// different times (picture in picture, a dissolve into the same file) each get their own frame.
import { frameState } from "./evaluate.js";
import { sequence } from "./model.js";
import { createCompositor, makeCanvas } from "./render.js";

// Collects every media layer of the frame (through pre-compositions) as { clip id → { media, time } }.
function wanted(model, t, seq, out = new Map(), depth = 0) {
  for (const layer of frameState(model, t, { seq }).layers) {
    const c = layer.clip;
    if (c.type === "video" || c.type === "image") out.set(c.id, { media: c.media, time: layer.time ?? 0 });
    else if (c.type === "comp" && depth < 4 && model.comps[c.comp]) wanted(model, layer.time, c.comp, out, depth + 1);
  }
  return out;
}

export function createExactRenderer(store) {
  const frames = new Map(); // clip id → bitmap for the frame being drawn
  const owned = new Set();
  const comp = createCompositor({ provider: { source: (_media, _time, clip) => frames.get(clip?.id) || null } });
  let canvas = null;
  return {
    get canvas() {
      return canvas;
    },
    async render(model, t, opts = {}) {
      const scale = opts.scale || 1;
      const m = sequence(model, opts.seq);
      const w = Math.max(1, Math.round(m.width * scale));
      const h = Math.max(1, Math.round(m.height * scale));
      if (!canvas || canvas.width !== w || canvas.height !== h) canvas = makeCanvas(w, h);
      for (const b of owned) b.close?.(); // only bitmaps captured here; images belong to the store
      owned.clear();
      frames.clear();
      // sequential on purpose: one element per media item serves all its clips
      for (const [id, need] of wanted(model, t, opts.seq)) {
        const src = await store.frameAt(need.media, need.time);
        if (!src) continue;
        try {
          if (src instanceof ImageBitmap || src instanceof HTMLImageElement) frames.set(id, src);
          else {
            const bmp = await createImageBitmap(src);
            owned.add(bmp);
            frames.set(id, bmp);
          }
        } catch {
          /* a frame that cannot be captured is skipped like a missing source */
        }
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      comp.render(ctx, model, t, { ...opts, scale, frame: Math.round(t * model.fps) });
      return canvas;
    },
  };
}

/** One exact frame on a fresh canvas. */
export async function renderExact(store, model, t, opts = {}) {
  return createExactRenderer(store).render(model, t, opts);
}
