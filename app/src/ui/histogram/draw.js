// Canvas drawing for histograms: used by the Histogram panel and as the backdrop of the Levels / Curves widgets.
import { displayCurve, channelHistogram } from "../../engine/pixel/histogram-analysis.js";

const CH_COLORS = { r: "#ef4444", g: "#22c55e", b: "#3b82f6" };

/** Sizes a canvas to its CSS box in device pixels. @returns {{W:number,H:number,dpr:number,css:CSSStyleDeclaration}|null} */
export function fitCanvas(canvas, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || 240;
  const ch = cssH || canvas.clientHeight || 100;
  const W = Math.max(1, Math.round(cw * dpr));
  const H = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  return { W, H, dpr, css: getComputedStyle(canvas) };
}

const v = (css, name, fb) => css.getPropertyValue(name).trim() || fb;

/** Series (normalized curves + colors) for a channel of an analysis. */
export function seriesFor(a, channel, { log = false, smooth = 0 } = {}) {
  const css = (h) => displayCurve(h, { log, smooth }).values;
  if (channel === "rgb") return [["r", a.r], ["g", a.g], ["b", a.b]].map(([k, h]) => ({ values: css(h), color: CH_COLORS[k] }));
  if (channel === "r" || channel === "g" || channel === "b") return [{ values: css(a[channel]), color: CH_COLORS[channel] }];
  return [{ values: css(channelHistogram(a, channel)), color: null }];
}

/**
 * Draws the histogram.
 * @param {HTMLCanvasElement} canvas
 * @param {{series:{values:Float32Array,color:string|null}[], style?:'smooth'|'bars', hover?:number|null, marks?:{low?:boolean,high?:boolean}, lines?:{values:Float32Array,color?:string}[], size?:{W:number,H:number,dpr:number,css:CSSStyleDeclaration}, transparent?:boolean, grid?:boolean}} o
 */
export function drawHistogram(canvas, o) {
  const { W, H, dpr, css } = o.size || fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  const text = v(css, "--of-text-dim", "#999");
  if (!o.transparent) {
    ctx.fillStyle = v(css, "--of-bg-input", "#111");
    ctx.fillRect(0, 0, W, H);
  }
  if (o.grid !== false) {
    ctx.strokeStyle = v(css, "--of-border-soft", "#333");
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const x = Math.round((W * i) / 4) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    ctx.stroke();
  }
  const pad = 2 * dpr;
  const ph = H - pad;
  const bars = o.style === "bars";
  for (const s of o.series) {
    const col = s.color || text;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.globalAlpha = s.color ? 0.4 : 0.55;
    ctx.beginPath();
    if (bars) {
      const bw = W / 256;
      for (let i = 0; i < 256; i++) {
        const hh = s.values[i] * ph;
        if (hh > 0) ctx.rect(i * bw, H - hh, Math.max(1, bw), hh);
      }
      ctx.fill();
    } else {
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - s.values[i] * ph);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) ctx[i ? "lineTo" : "moveTo"]((i / 255) * W, H - s.values[i] * ph);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (const l of o.lines || []) {
    ctx.strokeStyle = l.color || v(css, "--of-accent", "#8b7cf6");
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.beginPath();
    for (let i = 0; i < 256; i++) ctx[i ? "lineTo" : "moveTo"]((i / 255) * W, H - l.values[i] * ph);
    ctx.stroke();
  }
  const mark = (x0, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x0, 0, 3 * dpr, H);
  };
  if (o.marks?.low) mark(0, "#3b82f6");
  if (o.marks?.high) mark(W - 3 * dpr, "#ef4444");
  if (o.hover != null) {
    const x = Math.round((o.hover / 255) * (W - 1)) + 0.5;
    ctx.strokeStyle = v(css, "--of-text", "#fff");
    ctx.lineWidth = dpr;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Calls `fn` when the element's size changes (histogram canvases re-render sharply on resize / zoom). */
export function onResize(el, fn) {
  if (typeof ResizeObserver === "undefined") return () => {};
  const ro = new ResizeObserver(() => fn());
  ro.observe(el);
  return () => ro.disconnect();
}
