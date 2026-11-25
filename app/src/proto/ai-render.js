// Images of Proto layers for the assistant (proto_screenshot, docs/concepts/proto-studio.md §7, task T11).
//
// The canvas draws the real DOM, which cannot be turned into pixels portably (an SVG foreignObject taints the canvas
// in WebKit and loses the app's fonts). The assistant therefore looks at a render of the pure layout solver
// (engine/proto/layout.js): a display list built here (pure, tested in Node) and painted on a 2D canvas in the app
// (the document's fonts apply). It is labeled approximate, like every solver result.
//
//   paintList(model, id, { measurer?, modes? }) → { w, h, items, approximate: true }        pure
//     items: { k: "layer", key, type, x, y, w, h, rot, alpha, radius, fills, strokes, effects, text?, d?, rule? }
//            { k: "clip", x, y, w, h, radius } … { k: "unclip" }
//   paintCanvas(ctx, list, { scale, images, background }) draws a list (images: Map media id → CanvasImageSource)
import { createResolver } from "../engine/proto/resolve.js";
import { layout } from "../engine/proto/layout.js";
import { field } from "../engine/proto/schema.js";
import { textStyleOf, fontStack } from "../engine/proto/css.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const radii = (r) => (Array.isArray(r) ? r.map((x) => num(x)) : [num(r), num(r), num(r), num(r)]);

/** The display list of a layer and its subtree (see the header). */
export function paintList(model, id, { measurer, modes } = {}) {
  if (!model.nodes[id]) throw new Error(`There is no layer “${id}”. Call proto_describe for the ids.`);
  const root = createResolver(model, modes ? { modes } : {}).tree(id);
  const { boxes } = layout(root, { measurer, origin: true });
  const rb = boxes.get(root.key) || { w: 0, h: 0 };
  const items = [];
  const visit = (r, alpha) => {
    const n = r.node;
    if (field(n, "visible") === false) return;
    const b = boxes.get(r.key);
    if (!b) return;
    const a = alpha * num(field(n, "opacity"), 1);
    const item = { k: "layer", key: r.key, type: r.type, x: b.x, y: b.y, w: b.w, h: b.h, rot: num(b.rot), alpha: a, radius: radii(field(n, "radius")), fills: (n.fills || []).filter((f) => isObj(f) && f.visible !== false), strokes: (n.strokes || []).filter(isObj), effects: (n.effects || []).filter((e) => isObj(e) && e.visible !== false) };
    if (r.type === "text") {
      const style = textStyleOf(n);
      const runs = Array.isArray(n.text?.runs) ? n.text.runs : [];
      item.fills = [];
      item.text = (b.lines || []).map((l) => ({
        x: l.x,
        y: l.y,
        baseline: l.baseline,
        segs: l.segs.map((s) => {
          const st = { ...style, ...(isObj(runs[s.run]?.s) ? runs[s.run].s : {}) };
          const t = st.case === "upper" ? s.text.toUpperCase() : st.case === "lower" ? s.text.toLowerCase() : s.text;
          return { text: t, x: s.x, font: { family: st.font, size: num(st.size, 16), weight: num(st.weight, 400), italic: !!st.italic }, color: typeof st.color === "string" ? st.color : "#18181b", tracking: num(st.tracking), decoration: st.decoration || "none" };
        }),
      }));
    }
    if (r.type === "vector") Object.assign(item, { d: typeof n.d === "string" ? n.d : "", rule: n.rule === "evenodd" ? "evenodd" : "nonzero" });
    items.push(item);
    const clip = field(n, "clip") === true && r.children.length;
    if (clip) items.push({ k: "clip", x: b.x, y: b.y, w: b.w, h: b.h, radius: item.radius, ellipse: r.type === "ellipse" });
    for (const c of r.children) visit(c, a);
    if (clip) items.push({ k: "unclip" });
  };
  if (root) visit(root, 1);
  return { w: Math.max(1, Math.ceil(rb.w)), h: Math.max(1, Math.ceil(rb.h)), items, approximate: true };
}

// ------------------------------------------------------------------------------------------------- canvas

function shape(ctx, it, inset = 0) {
  const x = it.x + inset;
  const y = it.y + inset;
  const w = Math.max(0, it.w - inset * 2);
  const h = Math.max(0, it.h - inset * 2);
  ctx.beginPath();
  if (it.type === "ellipse" || it.ellipse) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (it.radius?.some((r) => r > 0) && ctx.roundRect) ctx.roundRect(x, y, w, h, it.radius.map((r) => Math.max(0, Math.min(r - inset, w / 2, h / 2))));
  else ctx.rect(x, y, w, h);
}

function paintOf(ctx, f, it) {
  if (f.type === "solid") return typeof f.color === "string" ? f.color : "#000000";
  const stops = (f.stops || []).filter((s) => typeof s?.color === "string");
  if (stops.length < 2) return null;
  const cx = it.x + it.w * num(f.center?.[0], 0.5);
  const cy = it.y + it.h * num(f.center?.[1], 0.5);
  let g;
  if (f.type === "linear") {
    const a = (num(f.angle, 180) * Math.PI) / 180;
    const len = Math.abs(it.w * Math.sin(a)) + Math.abs(it.h * Math.cos(a));
    const dx = (Math.sin(a) * len) / 2;
    const dy = (-Math.cos(a) * len) / 2;
    g = ctx.createLinearGradient(it.x + it.w / 2 - dx, it.y + it.h / 2 - dy, it.x + it.w / 2 + dx, it.y + it.h / 2 + dy);
  } else if (f.type === "radial") g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(Math.max(cx - it.x, it.x + it.w - cx), Math.max(cy - it.y, it.y + it.h - cy)));
  else if (f.type === "conic" && ctx.createConicGradient) g = ctx.createConicGradient(((num(f.angle) - 90) * Math.PI) / 180, cx, cy);
  else return stops[0].color;
  for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, num(s.at))), s.color);
  return g;
}

function drawImage(ctx, img, f, it) {
  const iw = img.width || 1;
  const ih = img.height || 1;
  const fit = f.fit || "cover";
  let w = it.w;
  let h = it.h;
  if (fit === "cover" || fit === "contain") {
    const s = (fit === "cover" ? Math.max : Math.min)(it.w / iw, it.h / ih);
    w = iw * s;
    h = ih * s;
  } else if (fit === "none" || fit === "tile") {
    w = iw;
    h = ih;
  }
  ctx.save();
  shape(ctx, it);
  ctx.clip();
  ctx.drawImage(img, it.x + (it.w - w) / 2, it.y + (it.h - h) / 2, w, h);
  ctx.restore();
}

/** Paints a display list on a 2D context (the context's transform maps design pixels; `scale` is applied here). */
export function paintCanvas(ctx, list, { scale = 1, images = new Map(), background = null } = {}) {
  ctx.save();
  ctx.scale(scale, scale);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, list.w, list.h);
  }
  for (const it of list.items) {
    if (it.k === "clip") {
      ctx.save();
      shape(ctx, it);
      ctx.clip();
      continue;
    }
    if (it.k === "unclip") {
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.globalAlpha = it.alpha;
    if (it.rot) {
      ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
      ctx.rotate((it.rot * Math.PI) / 180);
      ctx.translate(-(it.x + it.w / 2), -(it.y + it.h / 2));
    }
    const blur = it.effects.find((e) => e.type === "blur");
    if (blur && "filter" in ctx) ctx.filter = `blur(${num(blur.radius)}px)`;
    // drop shadows: the shape drawn far away, only its shadow lands here (so a transparent layer still casts one)
    for (const e of it.effects) {
      if (e.type !== "shadow" || e.inset || typeof e.color !== "string") continue;
      ctx.save();
      ctx.shadowColor = e.color;
      ctx.shadowBlur = num(e.blur);
      ctx.shadowOffsetX = num(e.x) * scale + 100000 * scale;
      ctx.shadowOffsetY = num(e.y) * scale;
      ctx.translate(-100000, 0);
      shape(ctx, it, -num(e.spread));
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
    }
    if (it.type === "vector" && it.d && typeof Path2D !== "undefined") {
      const p = new Path2D(it.d);
      ctx.translate(it.x, it.y);
      for (const f of it.fills) {
        const paint = paintOf(ctx, f, { ...it, x: 0, y: 0 });
        if (!paint) continue;
        ctx.globalAlpha = it.alpha * num(f.opacity, 1);
        ctx.fillStyle = paint;
        ctx.fill(p, it.rule);
      }
      for (const s of it.strokes) {
        ctx.strokeStyle = typeof s.color === "string" ? s.color : "#000";
        ctx.lineWidth = num(s.w, 1);
        ctx.stroke(p);
      }
    } else if (it.type === "line") {
      for (const s of it.strokes) {
        ctx.beginPath();
        ctx.moveTo(it.x, it.y);
        ctx.lineTo(it.x + it.w, it.y + it.h);
        ctx.strokeStyle = typeof s.color === "string" ? s.color : "#000";
        ctx.lineWidth = num(s.w, 1);
        if (Array.isArray(s.dash)) ctx.setLineDash(s.dash);
        ctx.stroke();
      }
    } else {
      for (const f of it.fills) {
        ctx.globalAlpha = it.alpha * num(f.opacity, 1);
        if (f.type === "image") {
          const img = images.get(f.media);
          if (img) drawImage(ctx, img, f, it);
          else {
            shape(ctx, it);
            ctx.fillStyle = "#e4e4e7";
            ctx.fill();
          }
          continue;
        }
        const paint = paintOf(ctx, f, it);
        if (!paint) continue;
        shape(ctx, it);
        ctx.fillStyle = paint;
        ctx.fill();
      }
      ctx.globalAlpha = it.alpha;
      for (const s of it.strokes) {
        if (typeof s.color !== "string") continue;
        const w = Math.max(...(Array.isArray(s.sides) ? s.sides.map((x) => num(x)) : [num(s.w, 1)]));
        if (!w) continue;
        const align = s.align || "inside";
        shape(ctx, it, align === "inside" ? w / 2 : align === "outside" ? -w / 2 : 0);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = w;
        ctx.setLineDash(Array.isArray(s.dash) ? s.dash : []);
        ctx.stroke();
      }
    }
    if (it.text) {
      ctx.textBaseline = "alphabetic";
      for (const l of it.text)
        for (const s of l.segs) {
          ctx.font = `${s.font.italic ? "italic " : ""}${s.font.weight} ${s.font.size}px ${fontStack(s.font.family)}`;
          if ("letterSpacing" in ctx) ctx.letterSpacing = `${s.tracking}px`;
          ctx.fillStyle = s.color;
          const x = it.x + l.x + s.x;
          const y = it.y + l.baseline;
          ctx.fillText(s.text, x, y);
          if (s.decoration === "underline" || s.decoration === "strike") {
            const w = ctx.measureText(s.text).width;
            const dy = s.decoration === "underline" ? s.font.size * 0.12 : -s.font.size * 0.3;
            ctx.fillRect(x, y + dy, w, Math.max(1, s.font.size / 14));
          }
        }
    }
    ctx.restore();
  }
  ctx.restore();
}
