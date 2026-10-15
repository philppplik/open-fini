// Canvas2D display-list backend: used for the on-screen viewport, PNG/JPEG/WebP export and thumbnails.
// Only needs a CanvasRenderingContext2D (or OffscreenCanvas context) — no WebGL.
import { cssColor } from "../../core/color.js";
import { dataToPath2D } from "../vector/path.js";
import { fontCss } from "../../core/fonts.js";
import { getEffect } from "../pixel/index.js";
import { createCanvas } from "../../core/doc.js";

export const BLEND = {
  normal: "source-over", multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten",
  "color-dodge": "color-dodge", "color-burn": "color-burn", "hard-light": "hard-light", "soft-light": "soft-light",
  difference: "difference", exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity",
};

const IDENT = [1, 0, 0, 1, 0, 0];

/** Reusable temporary canvases — avoids allocating on every frame (important on weak devices). */
export class CanvasPool {
  constructor({ cpu = false } = {}) {
    this.cpu = cpu;
    this.free = [];
  }
  get(w, h) {
    w = Math.max(1, Math.ceil(w));
    h = Math.max(1, Math.ceil(h));
    for (let i = 0; i < this.free.length; i++) {
      const c = this.free[i];
      if (c.width >= w && c.height >= h && c.width * c.height <= w * h * 4 + 4096) {
        this.free.splice(i, 1);
        const ctx = c.getContext("2d", this.cpu ? { willReadFrequently: true } : undefined);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, w, h);
        return c;
      }
    }
    const c = createCanvas(w, h);
    c.getContext("2d", this.cpu ? { willReadFrequently: true } : undefined);
    return c;
  }
  release(c) {
    if (!c) return;
    this.free.push(c);
    if (this.free.length > 12) this.free.shift();
  }
  ctx(c) {
    return c.getContext("2d", this.cpu ? { willReadFrequently: true } : undefined);
  }
  clear() {
    this.free.length = 0;
  }
}

function mulM(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

const setT = (ctx, base, m) => {
  ctx.setTransform(
    base[0] * m[0] + base[2] * m[1], base[1] * m[0] + base[3] * m[1],
    base[0] * m[2] + base[2] * m[3], base[1] * m[2] + base[3] * m[3],
    base[0] * m[4] + base[2] * m[5] + base[4], base[1] * m[4] + base[3] * m[5] + base[5],
  );
};

function paintStyle(ctx, p) {
  switch (p.type) {
    case "solid":
      return p._css || (p._css = cssColor(p.color, p.alpha));
    case "linear": {
      const g = ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
      for (const s of p.stops) g.addColorStop(Math.min(1, Math.max(0, s.o)), cssColor(s.color, s.alpha));
      return g;
    }
    case "radial": {
      const g = ctx.createRadialGradient(p.fx ?? p.cx, p.fy ?? p.cy, 0, p.cx, p.cy, p.r);
      for (const s of p.stops) g.addColorStop(Math.min(1, Math.max(0, s.o)), cssColor(s.color, s.alpha));
      return g;
    }
    case "conic": {
      if (!ctx.createConicGradient) return cssColor(p.stops[0]?.color || "#000000", p.stops[0]?.alpha ?? 1);
      const g = ctx.createConicGradient(p.angle || 0, p.cx, p.cy);
      for (const s of p.stops) g.addColorStop(Math.min(1, Math.max(0, s.o)), cssColor(s.color, s.alpha));
      return g;
    }
    default:
      return "#000";
  }
}

const p2d = (o) => o._p2d || (o._p2d = dataToPath2D(o.d));

function scaleOf(m) {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

function rectOfTransformed(b, m) {
  const xs = [];
  const ys = [];
  for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bt > y ? { x, y, w: r - x, h: bt - y } : null;
}

// ------------------------------------------------------------------ public API

/**
 * Draws a display list.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{items:any[]}} dl
 * @param {{base?:number[], region?:{x,y,w,h}, pool:CanvasPool, draft?:boolean}} o
 *   base   – matrix from document space to ctx pixel space
 *   region – visible area in ctx pixels (used to size temporary canvases)
 */
export function drawDisplayList(ctx, dl, o) {
  const base = o.base || IDENT;
  const st = { pool: o.pool, region: o.region || { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height }, scale: scaleOf(base), draft: !!o.draft, fastAdjust: !!o.fastAdjust };
  drawItems(ctx, dl.items, base, st);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function dlHasAdjust(items) {
  for (const it of items) {
    if (it.t === "adjust") return true;
    if (it.t === "group") {
      if (it._ha === undefined) it._ha = dlHasAdjust(it.items);
      if (it._ha) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ drawing

function drawItems(ctx, items, base, st) {
  for (let i = 0; i < items.length; i++) drawItem(ctx, items[i], base, st);
}

function drawItem(ctx, it, base, st) {
  switch (it.t) {
    case "path": {
      setT(ctx, base, it.m);
      const p = p2d(it);
      if (it.fill) {
        ctx.fillStyle = paintStyle(ctx, it.fill);
        ctx.fill(p, it.rule);
      }
      if (it.stroke) {
        const s = it.stroke;
        ctx.lineWidth = s.width;
        ctx.lineCap = s.cap;
        ctx.lineJoin = s.join;
        ctx.miterLimit = s.miterLimit;
        ctx.setLineDash(s.dash || []);
        ctx.lineDashOffset = s.dashOffset;
        ctx.strokeStyle = paintStyle(ctx, s.paint);
        ctx.stroke(p);
        if (s.dash) ctx.setLineDash([]);
      }
      break;
    }
    case "image": {
      const src = it.img.source;
      if (!src) break;
      setT(ctx, base, it.m);
      const crisp = it.img.pixel && st.scale * (it.m[0] || 1) > 3;
      ctx.imageSmoothingEnabled = it.smooth && !crisp;
      ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(src, 0, 0);
      break;
    }
    case "text":
      drawText(ctx, it, base);
      break;
    case "group":
      drawGroup(ctx, it, base, st);
      break;
    case "adjust":
      drawAdjust(ctx, it, base, st);
      break;
  }
}

const hasLetterSpacing = typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;

function drawText(ctx, it, base) {
  setT(ctx, base, it.m);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const r of it.runs) {
    ctx.font = fontCss(r.font);
    const ls = r.letterSpacing || 0;
    if (hasLetterSpacing) ctx.letterSpacing = ls ? `${ls}px` : "0px";
    const fill = r.fill ? paintStyle(ctx, r.fill) : null;
    const spaced = ls && !hasLetterSpacing;
    if (r.stroke) {
      ctx.lineWidth = r.stroke.width;
      ctx.lineJoin = r.stroke.join;
      ctx.strokeStyle = paintStyle(ctx, r.stroke.paint);
    }
    if (spaced) {
      let x = r.x;
      for (const ch of r.text) {
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillText(ch, x, r.y);
        }
        if (r.stroke) ctx.strokeText(ch, x, r.y);
        x += ctx.measureText(ch).width + ls;
      }
    } else {
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillText(r.text, r.x, r.y);
      }
      if (r.stroke) ctx.strokeText(r.text, r.x, r.y);
    }
    if (fill && (r.underline || r.strike)) {
      const th = Math.max(1, r.font.size / 16);
      if (r.underline) ctx.fillRect(r.x, r.y + r.font.size * 0.12, r.width, th);
      if (r.strike) ctx.fillRect(r.x, r.y - r.font.size * 0.3, r.width, th);
    }
  }
  if (hasLetterSpacing) ctx.letterSpacing = "0px";
}

function drawGroup(ctx, g, base, st) {
  const m2 = mulM(base, g.m);
  const simple = !g.isolate && !g.fx && !g.mask && g.opacity === 1 && g.blend === "normal";
  if (g.clip) {
    ctx.save();
    setT(ctx, m2, g.clip.m);
    ctx.clip(p2d(g.clip), g.clip.rule);
  }
  if (simple) drawItems(ctx, g.items, m2, st);
  else drawIsolated(ctx, g, m2, st);
  if (g.clip) ctx.restore();
}

function drawIsolated(ctx, g, m2, st) {
  // Device-space bounds of the group, limited to the visible region.
  let dev = st.region;
  const interior = g._ib || (g._ib = interiorBounds(g));
  if (interior) {
    const r = rectOfTransformed(interior, m2);
    const pad = 2;
    dev = intersectRect({ x: Math.floor(r.x) - pad, y: Math.floor(r.y) - pad, w: Math.ceil(r.w) + pad * 2, h: Math.ceil(r.h) + pad * 2 }, st.region);
  }
  if (!dev) return;
  const x = Math.floor(dev.x);
  const y = Math.floor(dev.y);
  const w = Math.max(1, Math.ceil(dev.x + dev.w) - x);
  const h = Math.max(1, Math.ceil(dev.y + dev.h) - y);
  if (w * h > 64e6) return;
  const off = st.pool.get(w, h);
  const octx = st.pool.ctx(off);
  const base2 = [m2[0], m2[1], m2[2], m2[3], m2[4] - x, m2[5] - y];
  const inner = { ...st, region: { x: 0, y: 0, w, h } };
  drawItems(octx, g.items, base2, inner);
  octx.setTransform(1, 0, 0, 1, 0, 0);

  if (g.mask) {
    const mc = st.pool.get(w, h);
    const mctx = st.pool.ctx(mc);
    drawItems(mctx, g.mask, base2, inner);
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(mc, 0, 0, w, h, 0, 0, w, h);
    octx.globalCompositeOperation = "source-over";
    st.pool.release(mc);
  }

  let result = off;
  if (g.fx && !st.draft) result = applyFx(off, w, h, g.fx, scaleOf(m2), st.pool);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = g.opacity;
  ctx.globalCompositeOperation = BLEND[g.blend] || "source-over";
  ctx.drawImage(result, 0, 0, w, h, x, y, w, h);
  ctx.restore();
  if (result !== off) st.pool.release(result);
  st.pool.release(off);
}

/** Bounds of an isolated group's content in its interior space (includes fx growth). */
function interiorBounds(g) {
  let b = null;
  const add = (r) => {
    if (!r) return;
    if (!b) b = { x: r.x, y: r.y, w: r.w, h: r.h };
    else {
      const x0 = Math.min(b.x, r.x);
      const y0 = Math.min(b.y, r.y);
      const x1 = Math.max(b.x + b.w, r.x + r.w);
      const y1 = Math.max(b.y + b.h, r.y + r.h);
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  };
  for (const it of g.items) add(itemBounds(it));
  if (b && g.fx) {
    let grow = 0;
    for (const f of g.fx) {
      if (f.type === "dropShadow") grow = Math.max(grow, (f.blur || 0) * 2.5 + Math.max(Math.abs(f.dx || 0), Math.abs(f.dy || 0)) + (f.spread || 0));
      else if (f.type === "outerGlow") grow = Math.max(grow, (f.radius || 0) * 2.5 + (f.spread || 0));
      else if (f.type === "blur") grow = Math.max(grow, (f.radius || 0) * 3);
      else if (f.type === "outline") grow = Math.max(grow, f.width || 0);
    }
    b = { x: b.x - grow, y: b.y - grow, w: b.w + 2 * grow, h: b.h + 2 * grow };
  }
  return b;
}

/** Bounds of an item in its PARENT space (conservative). */
export function itemBounds(it) {
  if (it._bb !== undefined) return it._bb;
  let b = null;
  switch (it.t) {
    case "path": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of it.d) {
        for (let i = 1; i < c.length; i += 2) {
          if (c[i] < minX) minX = c[i];
          if (c[i] > maxX) maxX = c[i];
          if (c[i + 1] < minY) minY = c[i + 1];
          if (c[i + 1] > maxY) maxY = c[i + 1];
        }
      }
      if (minX !== Infinity) {
        const sw = it.stroke ? it.stroke.width * (it.stroke.join === "miter" ? Math.max(1, Math.min(it.stroke.miterLimit, 10)) / 2 + 0.5 : 0.75) : 0;
        b = rectOfTransformed({ x: minX - sw, y: minY - sw, w: maxX - minX + 2 * sw, h: maxY - minY + 2 * sw }, it.m);
      }
      break;
    }
    case "image":
      b = rectOfTransformed({ x: 0, y: 0, w: it.img.width, h: it.img.height }, it.m);
      break;
    case "text": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const r of it.runs) {
        minX = Math.min(minX, r.x);
        maxX = Math.max(maxX, r.x + r.width);
        minY = Math.min(minY, r.y - r.font.size * 1.1);
        maxY = Math.max(maxY, r.y + r.font.size * 0.4);
      }
      if (minX !== Infinity) b = rectOfTransformed({ x: minX - 4, y: minY, w: maxX - minX + 8, h: maxY - minY }, it.m);
      break;
    }
    case "group": {
      let u = null;
      for (const c of it.items) {
        const cb = itemBounds(c);
        if (!cb) continue;
        if (!u) u = { ...cb };
        else {
          const x0 = Math.min(u.x, cb.x);
          const y0 = Math.min(u.y, cb.y);
          const x1 = Math.max(u.x + u.w, cb.x + cb.w);
          const y1 = Math.max(u.y + u.h, cb.y + cb.h);
          u = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
      }
      if (u) {
        if (it.fx) {
          const ib = interiorBounds(it);
          if (ib) u = ib;
        }
        b = rectOfTransformed(u, it.m);
      }
      break;
    }
    case "adjust":
      b = null;
      break;
  }
  it._bb = b;
  return b;
}

// ------------------------------------------------------------------ adjustments

function drawAdjust(ctx, it, base, st) {
  const eff = getEffect(it.effect.group, it.effect.id);
  if (!eff) return;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const reg = intersectRect({ x: 0, y: 0, w: cw, h: ch }, st.region);
  if (!reg) return;
  const rx = Math.floor(reg.x);
  const ry = Math.floor(reg.y);
  const rw = Math.min(cw - rx, Math.ceil(reg.w));
  const rh = Math.min(ch - ry, Math.ceil(reg.h));
  if (rw < 1 || rh < 1) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // draft quality while the user drags/paints: run the effect at half resolution (≈4× faster), the full-quality
  // frame follows as soon as the interaction ends
  if (st.fastAdjust && !it.mask && rw * rh > 300000) return drawAdjustHalf(ctx, it, eff, st, rx, ry, rw, rh);
  const img = ctx.getImageData(rx, ry, rw, rh);
  const k = it.opacity;
  let weights = null;
  const blended = !!it.mask || k < 0.999;
  const orig = blended ? new Uint8ClampedArray(img.data) : null;
  const params = { ...eff.defaults, ...it.params };
  const res = eff.apply({ width: rw, height: rh, data: img.data }, params, { scale: st.scale });
  const out = res && res.data ? res.data : img.data;
  if (it.mask) {
    const mc = st.pool.get(rw, rh);
    const mctx = st.pool.ctx(mc);
    const mb = [base[0], base[1], base[2], base[3], base[4] - rx, base[5] - ry];
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    drawItems(mctx, it.mask, mulM(mb, it.m), { ...st, region: { x: 0, y: 0, w: rw, h: rh } });
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    weights = mctx.getImageData(0, 0, rw, rh).data;
    st.pool.release(mc);
  }
  if (!blended) {
    if (out !== img.data) img.data.set(out);
  } else {
    const n = rw * rh;
    const d = img.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const wgt = weights ? (weights[p + 3] / 255) * k : k;
      d[p] = orig[p] + (out[p] - orig[p]) * wgt;
      d[p + 1] = orig[p + 1] + (out[p + 1] - orig[p + 1]) * wgt;
      d[p + 2] = orig[p + 2] + (out[p + 2] - orig[p + 2]) * wgt;
      d[p + 3] = orig[p + 3] + (out[p + 3] - orig[p + 3]) * wgt;
    }
  }
  ctx.putImageData(img, rx, ry);
}

function drawAdjustHalf(ctx, it, eff, st, rx, ry, rw, rh) {
  const hw = Math.max(1, Math.ceil(rw / 2));
  const hh = Math.max(1, Math.ceil(rh / 2));
  const small = st.pool.get(hw, hh);
  const sctx = st.pool.ctx(small);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = "copy";
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "low";
  sctx.drawImage(ctx.canvas, rx, ry, rw, rh, 0, 0, hw, hh);
  const img = sctx.getImageData(0, 0, hw, hh);
  const res = eff.apply({ width: hw, height: hh, data: img.data }, { ...eff.defaults, ...it.params }, { scale: st.scale * 0.5 });
  if (res && res.data && res.data !== img.data) img.data.set(res.data);
  sctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = it.opacity;
  ctx.globalCompositeOperation = it.opacity >= 0.999 ? "copy" : "source-over";
  ctx.drawImage(small, 0, 0, hw, hh, rx, ry, rw, rh);
  ctx.restore();
  st.pool.release(small);
}

// ------------------------------------------------------------------ layer effects

let ctxFilterOk = null;
function supportsCtxFilter() {
  if (ctxFilterOk !== null) return ctxFilterOk;
  try {
    const c = createCanvas(9, 9);
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff";
    x.fillRect(4, 4, 1, 1);
    const t = createCanvas(9, 9);
    const tx = t.getContext("2d", { willReadFrequently: true });
    tx.filter = "blur(1px)";
    tx.drawImage(c, 0, 0);
    ctxFilterOk = tx.getImageData(3, 4, 1, 1).data[3] > 0;
  } catch {
    ctxFilterOk = false;
  }
  return ctxFilterOk;
}

function blurCanvas(src, w, h, sigma, pool) {
  if (sigma < 0.3) return src;
  const out = pool.get(w, h);
  const octx = pool.ctx(out);
  if (supportsCtxFilter()) {
    octx.filter = `blur(${sigma.toFixed(2)}px)`;
    octx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
    octx.filter = "none";
  } else {
    const sctx = pool.ctx(src);
    const img = sctx.getImageData(0, 0, w, h);
    const f = getEffect("filter", "gaussian-blur");
    const r = f ? f.apply({ width: w, height: h, data: img.data }, { ...f.defaults, radius: sigma }, { scale: 1 }) : img;
    octx.putImageData(new ImageData(r.data, w, h), 0, 0);
  }
  return out;
}

function tinted(src, w, h, color, alpha, pool) {
  const t = pool.get(w, h);
  const c = pool.ctx(t);
  c.drawImage(src, 0, 0, w, h, 0, 0, w, h);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = cssColor(color, alpha);
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = "source-over";
  return t;
}

/** Draws only the shadow of `src` (offset+blur) into `dst` using the canvas shadow engine. */
function drawShadowOnly(dst, src, w, h, { color, alpha, blur, dx, dy }, scale, pool) {
  const far = w + h + Math.ceil(blur * scale * 4) + 64;
  const c = pool.ctx(dst);
  c.save();
  c.shadowColor = cssColor(color, alpha);
  c.shadowBlur = blur * scale;
  c.shadowOffsetX = far + dx * scale;
  c.shadowOffsetY = dy * scale;
  c.drawImage(src, 0, 0, w, h, -far, 0, w, h);
  c.restore();
}

function applyFx(off, w, h, fx, scale, pool) {
  let src = off;
  const temps = [];
  for (const f of fx) {
    if (f.type === "blur") {
      const b = blurCanvas(src, w, h, f.radius * scale, pool);
      if (b !== src) temps.push(b);
      src = b;
    }
  }
  const out = pool.get(w, h);
  const octx = pool.ctx(out);
  // effects underneath the content
  for (const f of fx) {
    if (f.type === "dropShadow") {
      drawShadowOnly(out, src, w, h, { color: f.color, alpha: f.alpha ?? 0.5, blur: f.blur ?? 8, dx: f.dx ?? 0, dy: f.dy ?? 4 }, scale, pool);
    } else if (f.type === "outerGlow") {
      const passes = 1 + Math.round((f.spread || 0) * 2);
      for (let i = 0; i < passes; i++) drawShadowOnly(out, src, w, h, { color: f.color, alpha: f.alpha ?? 0.7, blur: f.radius ?? 10, dx: 0, dy: 0 }, scale, pool);
    } else if (f.type === "outline") {
      const r = (f.width || 2) * scale;
      const t = tinted(src, w, h, f.color || "#000000", f.alpha ?? 1, pool);
      const steps = Math.min(64, Math.max(10, Math.ceil(r * 4)));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        octx.drawImage(t, 0, 0, w, h, Math.cos(a) * r, Math.sin(a) * r, w, h);
      }
      pool.release(t);
    }
  }
  octx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
  // effects on top of the content, clipped to its alpha
  for (const f of fx) {
    if (f.type === "colorOverlay") {
      const t = tinted(src, w, h, f.color || "#000000", f.alpha ?? 1, pool);
      octx.drawImage(t, 0, 0, w, h, 0, 0, w, h);
      pool.release(t);
    } else if (f.type === "innerShadow" || f.type === "innerGlow") {
      const inv = pool.get(w, h);
      const ictx = pool.ctx(inv);
      ictx.fillStyle = "#000";
      ictx.fillRect(0, 0, w, h);
      ictx.globalCompositeOperation = "destination-out";
      ictx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
      ictx.globalCompositeOperation = "source-over";
      const sh = pool.get(w, h);
      drawShadowOnly(sh, inv, w, h, { color: f.color, alpha: f.alpha ?? 0.6, blur: f.type === "innerGlow" ? f.radius ?? 10 : f.blur ?? 8, dx: f.type === "innerGlow" ? 0 : f.dx ?? 0, dy: f.type === "innerGlow" ? 0 : f.dy ?? 3 }, scale, pool);
      const sctx = pool.ctx(sh);
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
      sctx.globalCompositeOperation = "source-over";
      octx.drawImage(sh, 0, 0, w, h, 0, 0, w, h);
      pool.release(inv);
      pool.release(sh);
    }
  }
  for (const t of temps) pool.release(t);
  return out;
}

// ------------------------------------------------------------------ convenience

/**
 * Renders a display list into a new canvas at `scale` (output pixels per document unit).
 * `bg` fills the page background (null keeps transparency). `crop` selects a document-space rect.
 */
export function renderToCanvas(dl, { scale = 1, bg = null, crop = null, pool = new CanvasPool({ cpu: true }), width, height } = {}) {
  const cx = crop?.x ?? 0;
  const cy = crop?.y ?? 0;
  const cw = crop?.w ?? dl.width;
  const chh = crop?.h ?? dl.height;
  const w = Math.max(1, Math.round(width ?? cw * scale));
  const h = Math.max(1, Math.round(height ?? chh * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  const sx = w / cw;
  const sy = h / chh;
  drawDisplayList(ctx, dl, { base: [sx, 0, 0, sy, -cx * sx, -cy * sy], region: { x: 0, y: 0, w, h }, pool });
  return canvas;
}
