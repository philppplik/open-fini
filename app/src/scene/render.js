// Scene Studio compositor (docs/scene-studio.md ▸ Render pipeline): draws the layer list of scene/evaluate.js onto a
// 2D canvas. One compositor serves the viewer, thumbnails, the exporter and the assistant's render_frame; where the
// pixels of a source come from is the provider's business (scene/media.js: playing <video> elements in the viewer,
// decoded frames in the exporter).
//
//   const comp = createCompositor({ provider });           provider.source(mediaId, time) → CanvasImageSource | null
//   comp.render(ctx, model, t, { seq, scale, frame })      ctx: a 2D context of a canvas sized width*scale × height*scale
//
// Per layer: content (video frame, image, text, shape, solid, pre-composition) is drawn with its transform. Layers
// that only need canvas features (opacity, blend mode, CSS filters) go straight to the target. Layers with pixel
// effects, glow, a mask or a wipe are drawn into a scratch canvas first, processed (WebGL pass of scene/gl.js, or
// the CPU path of scene/effects.js) and then composited. An adjustment layer processes the picture below it.
// Compositions (nested to any depth up to MAX_NESTING) render into a canvas of their own size, which is then drawn
// like a picture; frames of compositions without video are cached (CACHE_SIZE per compositor). A composition clip
// with `collapse` instead draws its layers straight into the target with its transform (crisp, not clipped).
// Invariants: render() never throws for a missing source (the layer is skipped); it restores the context state.
import { frameState, layerAt, withParent } from "./evaluate.js";
import { layerSize, sequence, MAX_NESTING } from "./model.js";
import { cssFilter, stageEffects, applyPixel } from "./effects.js";
import { ease } from "./keyframes.js";
import { createPixelPass } from "./gl.js";

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const FALLBACK = '"Inter", "Segoe UI", system-ui, sans-serif';
export const fontOf = (tx) => `${tx.italic ? "italic " : ""}${tx.weight} ${tx.size}px "${String(tx.font).replace(/["\\]/g, "")}", ${FALLBACK}`;

/**
 * Lines of a text block: explicit line breaks, plus word wrap when `boxW` is set. `measure(str)` → width in pixels.
 * @returns {{ lines: { text: string, w: number }[], w: number, h: number, lh: number }}
 */
export function layoutText(measure, tx) {
  const lh = tx.size * tx.lineHeight;
  const lines = [];
  for (const raw of String(tx.text).split("\n")) {
    if (!(tx.boxW > 0)) {
      lines.push(raw);
      continue;
    }
    let cur = "";
    for (const word of raw.split(/(\s+)/)) {
      if (cur && measure(cur + word) > tx.boxW && word.trim()) {
        lines.push(cur.trimEnd());
        cur = word;
      } else cur += word;
    }
    lines.push(cur.trimEnd());
  }
  const out = lines.map((text) => ({ text, w: measure(text) }));
  return { lines: out, w: Math.max(1, ...out.map((l) => l.w)), h: Math.max(lh, lh * out.length), lh };
}

let mctx = null;
/** Size of a text block (shared by the compositor, the viewer's selection box and layerSize). */
export function textSize(tx) {
  mctx ||= makeCanvas(2, 2).getContext("2d");
  mctx.font = fontOf(tx);
  if ("letterSpacing" in mctx) mctx.letterSpacing = `${tx.tracking}px`;
  const L = layoutText((s) => mctx.measureText(s).width, tx);
  const pad = tx.bg ? tx.bgPad * 2 : 0;
  return { w: L.w + pad, h: L.h + pad };
}

function roundRect(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (k && ctx.roundRect) ctx.roundRect(x, y, w, h, k);
  else ctx.rect(x, y, w, h);
}

/** Path of a shape centered on the origin. */
export function shapePath(ctx, s) {
  const { w, h } = s;
  ctx.beginPath();
  if (s.kind === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (s.kind === "line") {
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
  } else if (s.kind === "polygon" || s.kind === "star") {
    const n = s.points * (s.kind === "star" ? 2 : 1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const k = s.kind === "star" && i % 2 ? 0.45 : 1;
      ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * (w / 2) * k, Math.sin(a) * (h / 2) * k);
    }
    ctx.closePath();
  } else roundRect(ctx, -w / 2, -h / 2, w, h, s.radius);
}

function drawShape(ctx, s) {
  shapePath(ctx, s);
  if (s.fill && s.kind !== "line") {
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  const stroke = s.stroke || (s.kind === "line" ? s.fill : null);
  const sw = s.strokeW || (s.kind === "line" ? Math.max(1, s.h) : 0);
  if (stroke && sw > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

// Draws a text block centered on the origin, with its animation phase (scene/evaluate.js ▸ textAnimState).
function drawText(ctx, tx, anim) {
  ctx.font = fontOf(tx);
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${tx.tracking}px`;
  const L = layoutText((s) => ctx.measureText(s).width, tx);
  const p = anim ? Math.max(0, Math.min(1, anim.p)) : 1;
  const q = ease("easeOut", p);
  const type = anim?.type || "none";
  ctx.save();
  // block animations
  if (type === "fade" || type === "blur") ctx.globalAlpha *= q;
  if (type === "blur" && p < 1) ctx.filter = `${ctx.filter && ctx.filter !== "none" ? ctx.filter + " " : ""}blur(${(1 - q) * tx.size * 0.25}px)`;
  if (type.startsWith("slide-")) {
    const d = (1 - q) * tx.size * 0.9;
    ctx.translate(type === "slide-left" ? d : type === "slide-right" ? -d : 0, type === "slide-up" ? d : type === "slide-down" ? -d : 0);
    ctx.globalAlpha *= Math.min(1, p * 2);
  }
  if (type === "pop") {
    const s = Math.max(0.001, ease("back", p));
    ctx.scale(s, s);
    ctx.globalAlpha *= Math.min(1, p * 3);
  }
  if (tx.bg) {
    ctx.fillStyle = tx.bg;
    roundRect(ctx, -L.w / 2 - tx.bgPad, -L.h / 2 - tx.bgPad, L.w + tx.bgPad * 2, L.h + tx.bgPad * 2, tx.bgRadius);
    ctx.fill();
  }
  if (tx.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = tx.size * 0.12;
    ctx.shadowOffsetY = tx.size * 0.04;
  }
  const unit = type === "chars" || type === "typewriter" ? "char" : type === "words" ? "word" : null;
  const total = unit ? L.lines.reduce((n, l) => n + (unit === "char" ? [...l.text].length : l.text.split(/\s+/).filter(Boolean).length), 0) : 0;
  const stagger = Math.max(3, total * 0.35);
  let index = 0;
  const paint = (str, x, y) => {
    if (tx.stroke && tx.strokeW > 0) {
      ctx.strokeStyle = tx.stroke;
      ctx.lineWidth = tx.strokeW;
      ctx.lineJoin = "round";
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = tx.color;
    ctx.fillText(str, x, y);
  };
  L.lines.forEach((line, i) => {
    const y = -L.h / 2 + L.lh * i + L.lh / 2 + tx.size * 0.35;
    const x0 = tx.align === "left" ? -L.w / 2 : tx.align === "right" ? L.w / 2 - line.w : -line.w / 2;
    if (!unit) return paint(line.text, x0, y);
    // unit animations: every character or word has its own progress, staggered along the text
    const parts = unit === "char" ? [...line.text] : line.text.split(/(\s+)/);
    let x = x0;
    for (const part of parts) {
      const w = ctx.measureText(part).width + (unit === "char" ? tx.tracking : 0);
      if (part.trim()) {
        const up = Math.max(0, Math.min(1, (p * (total + stagger) - index) / stagger));
        index++;
        if (type === "typewriter") {
          if (up > 0) paint(part, x, y);
        } else if (up > 0) {
          const e = ease("easeOut", up);
          ctx.save();
          ctx.globalAlpha *= e;
          paint(part, x, y + (1 - e) * tx.size * 0.5);
          ctx.restore();
        }
      }
      x += w;
    }
  });
  ctx.restore();
}

// Compositions whose picture depends only on the model (no video inside, also through nesting): their rendered
// frames can be cached. A video frame shown by the viewer may lag the requested time, so video never is.
const staticComps = new WeakMap(); // model.comps → Map(comp id → boolean)
function isStaticComp(comps, id, seen = new Set()) {
  let memo = staticComps.get(comps);
  if (!memo) staticComps.set(comps, (memo = new Map()));
  if (memo.has(id)) return memo.get(id);
  if (seen.has(id)) return false;
  seen.add(id);
  const k = comps[id];
  const ok = !!k && Object.values(k.clips).every((c) => c.type !== "video" && (c.type !== "comp" || isStaticComp(comps, c.comp, seen)));
  memo.set(id, ok);
  return ok;
}

const CACHE_SIZE = 4; // rendered composition frames kept per compositor
const MBLUR_SAMPLES = 8; // sub-frames of a motion-blurred layer

export function createCompositor({ provider }) {
  let scratch = null;
  let scratch2 = null;
  let pixelPass;
  // render cache of composition frames: key → canvas, oldest first; cleared when the compositions or media change
  const cache = new Map();
  let cacheComps = null;
  let cacheMedia = null;
  const pool = [];
  const getScratch = (which, w, h) => {
    let c = which === 1 ? scratch : scratch2;
    if (!c || c.width !== w || c.height !== h) {
      c = makeCanvas(w, h);
      if (which === 1) scratch = c;
      else scratch2 = c;
    }
    return c;
  };
  const takeCanvas = (w, h) => {
    const i = pool.findIndex((c) => c.width === w && c.height === h);
    return i >= 0 ? pool.splice(i, 1)[0] : makeCanvas(w, h);
  };

  // A composition's frame at its own size (times the scale), from the cache when it is there.
  function compFrame(model, c, layer, opts, depth) {
    const k = model.comps[c.comp];
    const s = opts.scale;
    const cw = Math.max(1, Math.round(k.width * s));
    const ch = Math.max(1, Math.round(k.height * s));
    if (cacheComps !== model.comps || cacheMedia !== model.media) {
      for (const cv of cache.values()) pool.push(cv);
      cache.clear();
      cacheComps = model.comps;
      cacheMedia = model.media;
    }
    const cacheable = isStaticComp(model.comps, c.comp);
    const key = `${c.comp}|${Math.round(layer.time * 1e5)}|${cw}x${ch}|${opts.frame || 0}|${opts.gpu === false ? 0 : 1}`;
    if (cacheable && cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit); // most recently used last
      return hit;
    }
    const cv = takeCanvas(cw, ch);
    const cctx = cv.getContext("2d");
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, cw, ch);
    const stat = { miss: false };
    renderInto(cctx, model, layer.time, { ...opts, seq: c.comp, base: null, alpha: 1, only: null, stat }, depth + 1);
    if (opts.stat && stat.miss) opts.stat.miss = true;
    if (cacheable && !stat.miss) {
      cache.set(key, cv);
      while (cache.size > CACHE_SIZE) {
        const oldest = cache.keys().next().value;
        pool.push(cache.get(oldest));
        cache.delete(oldest);
      }
    } else pool.push(cv); // drawn right away by the caller, then free again
    if (pool.length > CACHE_SIZE) pool.splice(0, pool.length - CACHE_SIZE);
    return cv;
  }

  // The content of a layer in sequence coordinates (the context is already set to sequence pixels).
  function paintContent(ctx, model, m, layer, opts, depth) {
    const c = layer.clip;
    const W = m.width;
    const H = m.height;
    if (layer.pm) ctx.transform(...layer.pm); // parented (scene/rig.js)
    ctx.translate(layer.x + layer.fx.dx * W, layer.y + layer.fx.dy * H);
    if (layer.rot) ctx.rotate((layer.rot * Math.PI) / 180);
    ctx.scale(layer.sx * layer.fx.scale, layer.sy * layer.fx.scale);
    if (layer.ax || layer.ay) ctx.translate(-(layer.ax || 0), -(layer.ay || 0)); // anchor point (format 3)
    if (c.type === "solid") {
      ctx.fillStyle = c.color;
      ctx.fillRect(-W / 2, -H / 2, W, H);
      return true;
    }
    if (c.type === "shape") {
      drawShape(ctx, c.shape);
      return true;
    }
    if (c.type === "text") {
      drawText(ctx, c.text, layer.textAnim);
      return true;
    }
    let src = null;
    let sw = 0;
    let sh = 0;
    if (c.type === "comp") {
      const k = model.comps[c.comp];
      if (!k || depth >= MAX_NESTING) return false;
      if (c.collapse) {
        // collapsed transformations: the nested layers go straight into this canvas with the clip's transform, at
        // this canvas's resolution and not clipped to the composition's frame
        const base = ctx.getTransform().translate(-k.width / 2, -k.height / 2);
        renderInto(ctx, model, layer.time, { ...opts, seq: c.comp, base, alpha: 1, only: null, background: false }, depth + 1);
        return true;
      }
      src = compFrame(model, c, layer, opts, depth);
      sw = src.width;
      sh = src.height;
    } else {
      src = provider.source(c.media, layer.time ?? 0, c);
      if (!src) {
        if (opts.stat) opts.stat.miss = true;
        return false;
      }
      sw = src.videoWidth || src.displayWidth || src.naturalWidth || src.width;
      sh = src.videoHeight || src.displayHeight || src.naturalHeight || src.height;
      if (!sw || !sh) return false;
    }
    const size = layerSize(m, c);
    const cr = c.crop;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, cr.l * sw, cr.t * sh, sw * (1 - cr.l - cr.r), sh * (1 - cr.t - cr.b), -size.w / 2, -size.h / 2, size.w, size.h);
    return true;
  }

  // Pixel effects and glow on a device-pixel canvas, in place.
  function process(cv, effects, opts) {
    const px = stageEffects(effects, "pixel");
    const ctx = cv.getContext("2d");
    if (px.length) {
      if (pixelPass === undefined) pixelPass = opts.gpu === false ? null : createPixelPass();
      const out = pixelPass?.apply(cv, px, opts.frame || 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (out) {
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(out, 0, 0);
      } else {
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        applyPixel(img.data, cv.width, cv.height, px, opts.frame || 0);
        ctx.putImageData(img, 0, 0);
      }
      ctx.restore();
    }
    for (const g of stageEffects(effects, "glow")) {
      const tmp = getScratch(2, cv.width, cv.height);
      const t = tmp.getContext("2d");
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.clearRect(0, 0, tmp.width, tmp.height);
      // bright parts only: raise contrast around the threshold, then blur
      t.filter = `brightness(${1 + g.p.intensity}) contrast(${1 + g.p.threshold * 2}) blur(${g.p.radius * opts.scale}px)`;
      t.drawImage(cv, 0, 0);
      t.filter = "none";
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, g.p.intensity);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    }
  }

  // A CSS filter over a whole device-pixel canvas, in place (collapsed compositions: their layers set their own).
  function filterInPlace(cv, filter) {
    const tmp = getScratch(2, cv.width, cv.height);
    const t = tmp.getContext("2d");
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, tmp.width, tmp.height);
    t.filter = filter;
    t.drawImage(cv, 0, 0);
    t.filter = "none";
    const ctx = cv.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  // Sequence pixels → device pixels of the target: the scale, or the transform of a collapsed parent.
  const setBase = (ctx, opts) => (opts.base ? ctx.setTransform(opts.base) : ctx.setTransform(opts.scale, 0, 0, opts.scale, 0, 0));

  // Cuts a device-pixel canvas down to a mask (layer box coordinates) and / or a wipe rectangle (frame fractions).
  function cut(cv, m, layer, opts) {
    const ctx = cv.getContext("2d");
    const s = opts.scale;
    if (layer.mask) {
      const k = layer.mask;
      const size = layerSize(m, layer.clip, textSize);
      ctx.save();
      setBase(ctx, opts);
      ctx.globalCompositeOperation = k.invert ? "destination-out" : "destination-in";
      if (k.feather > 0) ctx.filter = `blur(${k.feather * s}px)`;
      if (layer.pm) ctx.transform(...layer.pm);
      ctx.translate(layer.x + layer.fx.dx * m.width, layer.y + layer.fx.dy * m.height);
      if (layer.rot) ctx.rotate((layer.rot * Math.PI) / 180);
      ctx.scale(layer.sx * layer.fx.scale, layer.sy * layer.fx.scale);
      if (layer.ax || layer.ay) ctx.translate(-(layer.ax || 0), -(layer.ay || 0));
      const bx = -size.w / 2 + k.x * size.w;
      const by = -size.h / 2 + k.y * size.h;
      ctx.beginPath();
      if (k.shape === "ellipse") ctx.ellipse(bx + (k.w * size.w) / 2, by + (k.h * size.h) / 2, (k.w * size.w) / 2, (k.h * size.h) / 2, 0, 0, Math.PI * 2);
      else ctx.rect(bx, by, k.w * size.w, k.h * size.h);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
    }
    if (layer.fx.wipe) {
      const [l, t, r, b] = layer.fx.wipe;
      ctx.save();
      setBase(ctx, opts);
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "#000";
      ctx.fillRect(l * m.width, t * m.height, (r - l) * m.width, (b - t) * m.height);
      ctx.restore();
    }
  }

  // Sub-frame layers of a motion-blurred layer (MBLUR_SAMPLES over half a frame around t), or null when the layer
  // does not move during the shutter (then it is drawn once, sharp).
  function subframes(model, m, layer, t) {
    const c = m.clips[layer.clip.id];
    if (!c) return null;
    const shutter = 0.5 / model.fps;
    const list = [];
    for (let i = 0; i < MBLUR_SAMPLES; i++) {
      const tt = t + (i / (MBLUR_SAMPLES - 1) - 0.5) * shutter;
      list.push(withParent(m, layerAt(c, tt - c.start), c, tt));
    }
    const key = (L) => [L.x, L.y, L.sx, L.sy, L.rot, L.ax, L.ay, ...(L.pm || [])].map((v) => Math.round((v || 0) * 1000)).join();
    return key(list[0]) === key(list[list.length - 1]) ? null : list;
  }

  function renderInto(ctx, model, t, opts, depth) {
    const m = sequence(model, opts.seq);
    const state = frameState(model, t, { seq: opts.seq });
    const s = opts.scale;
    const alpha = opts.alpha ?? 1;
    // buffers match the target canvas (for a collapsed composition that is the parent's canvas)
    const dw = ctx.canvas.width;
    const dh = ctx.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (state.background && opts.background !== false && !opts.base) {
      ctx.fillStyle = state.background;
      ctx.fillRect(0, 0, dw, dh);
    }
    for (const layer of state.layers) {
      if (opts.only && !opts.only.includes(layer.clip.id)) continue;
      if (layer.opacity <= 0 && !layer.fx.dip) continue;
      const fl = cssFilter(layer.effects, s);
      const blur = layer.fx.blur > 0 ? `blur(${layer.fx.blur * s}px)` : "";
      const filter = [fl, blur].filter(Boolean).join(" ") || "none";
      const collapse = layer.type === "comp" && !!layer.clip.collapse;
      const heavy = collapse || layer.type === "adjustment" || layer.mask || layer.fx.wipe || layer.effects.some((e) => stageEffects([e], "pixel").length || stageEffects([e], "glow").length);
      const blurred = layer.clip.mblur && layer.type !== "adjustment" && !collapse && opts.motionBlur !== false ? subframes(model, m, layer, t) : null;
      try {
        if (blurred) {
          // motion blur: the average of sub-frames over a 180° shutter, each painted like a heavy layer and added
          // with 1 / n of its opacity ("lighter" sums premultiplied colors, so the result is the mean)
          const acc = makeCanvas(dw, dh);
          const a = acc.getContext("2d");
          const one = depth ? makeCanvas(dw, dh) : getScratch(1, dw, dh);
          const b = one.getContext("2d");
          for (const L of blurred) {
            b.setTransform(1, 0, 0, 1, 0, 0);
            b.clearRect(0, 0, dw, dh);
            b.save();
            setBase(b, opts);
            b.filter = filter;
            const ok = paintContent(b, model, m, L, opts, depth);
            b.restore();
            if (!ok) continue;
            process(one, L.effects, opts);
            cut(one, m, L, opts);
            a.globalCompositeOperation = "lighter";
            a.globalAlpha = L.opacity / blurred.length;
            a.drawImage(one, 0, 0);
          }
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = alpha;
          ctx.globalCompositeOperation = layer.blend === "normal" ? "source-over" : layer.blend;
          ctx.drawImage(acc, 0, 0);
          ctx.restore();
        } else if (!heavy) {
          ctx.save();
          setBase(ctx, opts);
          ctx.globalAlpha = layer.opacity * alpha;
          ctx.globalCompositeOperation = layer.blend === "normal" ? "source-over" : layer.blend;
          ctx.filter = filter;
          paintContent(ctx, model, m, layer, opts, depth);
          ctx.restore();
        } else {
          // nested compositions own the scratch canvases while they render: take fresh ones per depth
          const buf = depth ? makeCanvas(dw, dh) : getScratch(1, dw, dh);
          const b = buf.getContext("2d");
          b.setTransform(1, 0, 0, 1, 0, 0);
          b.clearRect(0, 0, dw, dh);
          let ok = true;
          if (layer.type === "adjustment") {
            b.filter = filter;
            b.drawImage(ctx.canvas, 0, 0);
            b.filter = "none";
          } else {
            b.save();
            setBase(b, opts);
            b.filter = collapse ? "none" : filter;
            ok = paintContent(b, model, m, layer, opts, depth);
            b.restore();
            if (ok && collapse && filter !== "none") filterInPlace(buf, filter);
          }
          if (ok) {
            process(buf, layer.effects, opts);
            cut(buf, m, layer, opts);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = layer.opacity * alpha;
            ctx.globalCompositeOperation = layer.blend === "normal" ? "source-over" : layer.blend;
            ctx.drawImage(buf, 0, 0);
            ctx.restore();
          }
        }
      } catch (err) {
        if (opts.onError) opts.onError(err, layer);
      }
      if (layer.fx.dip) {
        ctx.save();
        setBase(ctx, opts);
        ctx.globalAlpha = layer.fx.dip.a * alpha;
        ctx.fillStyle = layer.fx.dip.color;
        ctx.fillRect(0, 0, m.width, m.height);
        ctx.restore();
      }
    }
    ctx.restore();
    return state;
  }

  return {
    /**
     * Draws the frame at time t. Options: seq ("main" or a composition id), scale (device pixels per sequence
     * pixel), frame (frame number, for grain), gpu (false = CPU effects), only (clip ids), background (false = keep
     * the target transparent), onError(err, layer).
     * @returns the frame state that was drawn
     */
    render(ctx, model, t, opts = {}) {
      return renderInto(ctx, model, t, { seq: "main", scale: 1, ...opts, base: null, alpha: 1 }, 0);
    },
    /** True when pixel effects run on the GPU (after the first frame that used one). */
    get gpu() {
      return !!pixelPass;
    },
  };
}
