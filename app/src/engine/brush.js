// Brush engine: stamps soft/hard round dabs along a stroke into a pixel layer canvas.
//
// To get true "stroke opacity" (overlapping dabs never exceed the chosen opacity) without copying
// the whole layer, painting is tile based: every 256×256 tile touched by the stroke keeps a
// snapshot of its original pixels and a transparent stroke buffer; after each segment only the
// dirty tiles are recomposited (snapshot + stroke × opacity). The snapshots also provide the
// "before" image for undo.
import { createCanvas } from "../core/doc.js";
import { parseColor } from "../core/color.js";

const TILE = 256;
const spriteCache = new Map();

/** Round brush sprite: opaque core up to `hardness`, smooth falloff to the edge. */
function sprite(d, hardness, color, flow) {
  d = Math.max(2, Math.round(d));
  const key = `${d}|${hardness.toFixed(2)}|${color}|${flow.toFixed(3)}`;
  let s = spriteCache.get(key);
  if (s) return s;
  const c = createCanvas(d, d);
  const x = c.getContext("2d");
  const { r, g, b } = parseColor(color);
  const rad = d / 2;
  const g2 = x.createRadialGradient(rad, rad, 0, rad, rad, rad);
  const h = Math.min(0.995, Math.max(0, hardness));
  const stops = 8;
  for (let i = 0; i <= stops; i++) {
    const t = h + ((1 - h) * i) / stops; // 0..1 across the soft band
    const u = i / stops; // 0..1 inside the soft band
    const a = (1 - u * u * (3 - 2 * u)) * flow; // smoothstep falloff
    g2.addColorStop(Math.min(1, t), `rgba(${r},${g},${b},${a.toFixed(4)})`);
  }
  g2.addColorStop(0, `rgba(${r},${g},${b},${flow.toFixed(4)})`);
  x.fillStyle = g2;
  x.fillRect(0, 0, d, d);
  if (spriteCache.size > 120) spriteCache.delete(spriteCache.keys().next().value);
  spriteCache.set(key, c);
  return c;
}

export class StrokeEngine {
  /**
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas pixel layer canvas
   * @param {{size:number, hardness:number, opacity:number, flow:number, spacing:number, color:string, erase?:boolean, smoothing?:number,
   *          mask?:HTMLCanvasElement|null, pressureSize?:boolean, pressureOpacity?:boolean, minSize?:number}} o
   *   size is the brush diameter in LAYER pixels; mask is a layer-space selection canvas (alpha)
   */
  constructor(canvas, o) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.o = { smoothing: 0, erase: false, pressureSize: true, pressureOpacity: false, minSize: 0.08, ...o };
    this.W = canvas.width;
    this.H = canvas.height;
    this.cols = Math.ceil(this.W / TILE);
    this.tiles = new Map();
    this.dirty = new Set();
    this.rect = null; // overall dirty rect
    this.last = null;
    this.smooth = null;
    this.carry = 0;
  }

  #tile(tx, ty) {
    const k = ty * this.cols + tx;
    let t = this.tiles.get(k);
    if (!t) {
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const w = Math.min(TILE, this.W - x0);
      const h = Math.min(TILE, this.H - y0);
      const snap = createCanvas(w, h);
      snap.getContext("2d").drawImage(this.canvas, x0, y0, w, h, 0, 0, w, h);
      const stroke = createCanvas(w, h);
      t = { x0, y0, w, h, snap, stroke, sctx: stroke.getContext("2d") };
      this.tiles.set(k, t);
    }
    return t;
  }

  #dab(x, y, p) {
    const o = this.o;
    const sizeK = o.pressureSize ? o.minSize + (1 - o.minSize) * p : 1;
    const d = Math.max(1, o.size * sizeK);
    const flow = Math.max(0.02, o.flow * (o.pressureOpacity ? 0.2 + 0.8 * p : 1));
    const spr = sprite(d < 4 ? 4 : d, o.hardness, o.erase ? "#000000" : o.color, o.erase ? Math.min(1, flow) : flow);
    const half = d / 2;
    const x0 = x - half;
    const y0 = y - half;
    const x1 = x0 + d;
    const y1 = y0 + d;
    const tx0 = Math.max(0, Math.floor(x0 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(this.cols - 1, Math.floor(x1 / TILE));
    const ty1 = Math.min(Math.ceil(this.H / TILE) - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.#tile(tx, ty);
        t.sctx.drawImage(spr, x0 - t.x0, y0 - t.y0, d, d);
        this.dirty.add(ty * this.cols + tx);
      }
    }
    const rx = Math.max(0, Math.floor(x0) - 1);
    const ry = Math.max(0, Math.floor(y0) - 1);
    const rr = Math.min(this.W, Math.ceil(x1) + 1);
    const rb = Math.min(this.H, Math.ceil(y1) + 1);
    if (rr > rx && rb > ry) {
      if (!this.rect) this.rect = { x: rx, y: ry, r: rr, b: rb };
      else {
        this.rect.x = Math.min(this.rect.x, rx);
        this.rect.y = Math.min(this.rect.y, ry);
        this.rect.r = Math.max(this.rect.r, rr);
        this.rect.b = Math.max(this.rect.b, rb);
      }
    }
  }

  /** Recomposites the tiles touched since the last flush. */
  #flush() {
    const o = this.o;
    const ctx = this.ctx;
    for (const k of this.dirty) {
      const t = this.tiles.get(k);
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x0, t.y0, t.w, t.h);
      ctx.clip();
      ctx.globalCompositeOperation = "copy";
      ctx.drawImage(t.snap, t.x0, t.y0);
      ctx.globalCompositeOperation = "source-over";
      let src = t.stroke;
      if (o.mask) {
        if (!t.tmp) {
          t.tmp = createCanvas(t.w, t.h);
          t.tctx = t.tmp.getContext("2d");
        }
        t.tctx.globalCompositeOperation = "copy";
        t.tctx.drawImage(t.stroke, 0, 0);
        t.tctx.globalCompositeOperation = "destination-in";
        t.tctx.drawImage(o.mask, t.x0, t.y0, t.w, t.h, 0, 0, t.w, t.h);
        src = t.tmp;
      }
      ctx.globalAlpha = o.opacity;
      ctx.globalCompositeOperation = o.erase ? "destination-out" : "source-over";
      ctx.drawImage(src, t.x0, t.y0);
      ctx.restore();
    }
    this.dirty.clear();
  }

  begin(x, y, p = 1) {
    this.smooth = [x, y];
    this.last = [x, y, p];
    this.carry = 0;
    this.#dab(x, y, p);
    this.#flush();
    return this.rect;
  }

  /** Adds a point; interpolates dabs at `spacing`. Returns the dirty rect after the update. */
  move(x, y, p = 1) {
    if (!this.last) return this.begin(x, y, p);
    const sm = this.o.smoothing;
    if (sm > 0) {
      const k = 1 - Math.min(0.92, sm);
      this.smooth[0] += (x - this.smooth[0]) * k;
      this.smooth[1] += (y - this.smooth[1]) * k;
      x = this.smooth[0];
      y = this.smooth[1];
    }
    const [lx, ly, lp] = this.last;
    const dx = x - lx;
    const dy = y - ly;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return this.rect;
    const step = Math.max(1, this.o.size * this.o.spacing);
    // `next` = distance from the segment start to the next dab; `carry` = distance walked since the last dab
    let next = step - this.carry;
    while (next <= dist) {
      const t = next / dist;
      this.#dab(lx + dx * t, ly + dy * t, lp + (p - lp) * t);
      next += step;
    }
    this.carry = step - (next - dist);
    this.last = [x, y, p];
    this.#flush();
    return this.rect;
  }

  /**
   * Finishes the stroke. Returns {x, y, before, after} (ImageData of the dirty rect) or null when nothing changed.
   */
  end() {
    const r = this.rect;
    if (!r) return null;
    const w = r.r - r.x;
    const h = r.b - r.y;
    // "before": current layer with the snapshot tiles laid back over it
    const tmp = createCanvas(w, h);
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(this.canvas, r.x, r.y, w, h, 0, 0, w, h);
    for (const t of this.tiles.values()) {
      tctx.save();
      tctx.globalCompositeOperation = "copy";
      // clear the tile area then draw the snapshot (copy only affects the drawn region when clipped)
      tctx.beginPath();
      tctx.rect(t.x0 - r.x, t.y0 - r.y, t.w, t.h);
      tctx.clip();
      tctx.clearRect(t.x0 - r.x, t.y0 - r.y, t.w, t.h);
      tctx.globalCompositeOperation = "source-over";
      tctx.drawImage(t.snap, t.x0 - r.x, t.y0 - r.y);
      tctx.restore();
    }
    const before = tctx.getImageData(0, 0, w, h);
    const after = this.ctx.getImageData(r.x, r.y, w, h);
    this.tiles.clear();
    return { x: r.x, y: r.y, before, after };
  }
}

/**
 * Copy-on-first-touch snapshot of a canvas, tile by tile. Call `touch(rect)` BEFORE modifying a region;
 * `before(rect)` later reconstructs the original pixels of any rect for undo.
 */
export class TileSnapshot {
  constructor(canvas) {
    this.canvas = canvas;
    this.W = canvas.width;
    this.H = canvas.height;
    this.cols = Math.ceil(this.W / TILE);
    this.tiles = new Map();
  }
  touch(x, y, w, h) {
    const tx0 = Math.max(0, Math.floor(x / TILE));
    const ty0 = Math.max(0, Math.floor(y / TILE));
    const tx1 = Math.min(this.cols - 1, Math.floor((x + w) / TILE));
    const ty1 = Math.min(Math.ceil(this.H / TILE) - 1, Math.floor((y + h) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const k = ty * this.cols + tx;
        if (this.tiles.has(k)) continue;
        const x0 = tx * TILE;
        const y0 = ty * TILE;
        const tw = Math.min(TILE, this.W - x0);
        const th = Math.min(TILE, this.H - y0);
        const c = createCanvas(tw, th);
        c.getContext("2d").drawImage(this.canvas, x0, y0, tw, th, 0, 0, tw, th);
        this.tiles.set(k, { x0, y0, tw, th, c });
      }
    }
  }
  /** Original pixels of a rect (ImageData). */
  before(x, y, w, h) {
    const tmp = createCanvas(w, h);
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(this.canvas, x, y, w, h, 0, 0, w, h);
    for (const t of this.tiles.values()) {
      if (t.x0 >= x + w || t.y0 >= y + h || t.x0 + t.tw <= x || t.y0 + t.th <= y) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x0 - x, t.y0 - y, t.tw, t.th);
      ctx.clip();
      ctx.clearRect(t.x0 - x, t.y0 - y, t.tw, t.th);
      ctx.drawImage(t.c, t.x0 - x, t.y0 - y);
      ctx.restore();
    }
    return ctx.getImageData(0, 0, w, h);
  }
}

export { TILE };
