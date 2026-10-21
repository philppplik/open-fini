/**
 * Chart math (pure): scales, nice ticks, stacking, pie angles and path builders returning display-list
 * path data (`['M', x, y]`, `['L', ...]`, `['C', ...]`, `['Z']`).
 *
 * @module chart-geometry
 */

const TAU = Math.PI * 2;

/** "Nice" number at or above `range` (rounded when `round`), 1-2-5 sequence. */
function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/**
 * Computes axis ticks. `min` / `max` may be pinned (`fixedMin` / `fixedMax`); otherwise the domain is expanded to
 * the nearest tick. Always returns at least two ticks and a positive step.
 * @param {number} min data minimum
 * @param {number} max data maximum
 * @param {number} [count=5] desired number of intervals
 * @param {{fixedMin?:number|null, fixedMax?:number|null}} [o]
 * @returns {{min:number, max:number, step:number, ticks:number[]}}
 */
export function niceTicks(min, max, count = 5, o = {}) {
  let lo = Number.isFinite(o.fixedMin) ? o.fixedMin : min;
  let hi = Number.isFinite(o.fixedMax) ? o.fixedMax : max;
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = lo + 1;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) {
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    if (!Number.isFinite(o.fixedMin)) lo -= pad;
    if (!Number.isFinite(o.fixedMax)) hi += pad;
    if (hi === lo) hi = lo + 1;
  }
  count = Math.max(2, Math.min(12, Math.round(count)));
  const step = niceNum(niceNum(hi - lo, false) / count, true);
  const nmin = Number.isFinite(o.fixedMin) ? lo : Math.floor(lo / step + 1e-9) * step;
  const nmax = Number.isFinite(o.fixedMax) ? hi : Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  const first = Math.ceil(nmin / step - 1e-9) * step;
  for (let v = first, i = 0; v <= nmax + step * 1e-9 && i < 200; v += step, i++) ticks.push(+v.toPrecision(12));
  if (ticks.length < 2) ticks.push(nmin, nmax);
  return { min: nmin, max: nmax, step, ticks };
}

/** Powers of ten covering `[min, max]` (both > 0) for a logarithmic axis. */
export function logTicks(min, max) {
  const lo = Math.floor(Math.log10(Math.max(min, 1e-12)));
  const hi = Math.ceil(Math.log10(Math.max(max, min * 1.0001)));
  const ticks = [];
  for (let e = lo; e <= hi && ticks.length < 40; e++) ticks.push(10 ** e);
  if (ticks.length < 2) ticks.push(ticks[0] * 10);
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks, step: 0 };
}

/**
 * Linear (or logarithmic) scale from a data domain to a pixel range.
 * @param {number} d0 @param {number} d1 @param {number} r0 @param {number} r1
 * @param {boolean} [log]
 */
export function makeScale(d0, d1, r0, r1, log = false) {
  const f = log ? Math.log10 : (x) => x;
  const a = f(d0);
  const b = f(d1);
  const k = b === a ? 0 : (r1 - r0) / (b - a);
  const fn = (v) => r0 + (f(Math.max(v, log ? 1e-12 : -Infinity)) - a) * k;
  fn.invert = (p) => {
    const t = k === 0 ? a : a + (p - r0) / k;
    return log ? 10 ** t : t;
  };
  return fn;
}

/**
 * Stacks series values. Positive and negative values stack separately away from zero. With `percent` every
 * category sums to 100 (negatives count as their absolute value).
 * @param {(number|null)[][]} series series x categories
 * @param {{percent?:boolean}} [o]
 * @returns {{y0:number, y1:number, v:number}[][]} series x categories
 */
export function stackSeries(series, o = {}) {
  const cats = Math.max(0, ...series.map((s) => s.length));
  const out = series.map(() => []);
  for (let c = 0; c < cats; c++) {
    let pos = 0;
    let neg = 0;
    let total = 0;
    if (o.percent) for (const s of series) total += Math.abs(Number.isFinite(s[c]) ? s[c] : 0);
    series.forEach((s, i) => {
      const raw = Number.isFinite(s[c]) ? s[c] : 0;
      const v = o.percent ? (total ? (raw / total) * 100 : 0) : raw;
      if (v >= 0) {
        out[i][c] = { y0: pos, y1: pos + v, v: raw };
        pos += v;
      } else {
        out[i][c] = { y0: neg, y1: neg + v, v: raw };
        neg += v;
      }
    });
  }
  return out;
}

/**
 * Angles of pie slices. Starts at 12 o'clock (`start` in radians, 0 = 3 o'clock; default -π/2) and runs
 * clockwise. Non-positive and non-finite values get no slice (but keep their index).
 * @param {(number|null)[]} values
 * @param {{start?:number}} [o]
 * @returns {{index:number, a0:number, a1:number, value:number, frac:number}[]}
 */
export function pieAngles(values, o = {}) {
  const start = Number.isFinite(o.start) ? o.start : -Math.PI / 2;
  const pos = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = pos.reduce((a, b) => a + b, 0);
  const out = [];
  if (!total) return out;
  let a = start;
  pos.forEach((v, index) => {
    if (!v) return;
    const frac = v / total;
    out.push({ index, a0: a, a1: a + frac * TAU, value: v, frac });
    a += frac * TAU;
  });
  return out;
}

const pt = (cx, cy, r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];

/** Cubic segments approximating an arc from `a0` to `a1` (radians, clockwise on screen). Appends to `d`. */
function arcSegments(d, cx, cy, r, a0, a1) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const step = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step;
    const e = s + step;
    const [x0, y0] = pt(cx, cy, r, s);
    const [x1, y1] = pt(cx, cy, r, e);
    d.push(['C', x0 - Math.sin(s) * r * k, y0 + Math.cos(s) * r * k, x1 + Math.sin(e) * r * k, y1 - Math.cos(e) * r * k, x1, y1]);
  }
}

/**
 * Ring segment / wedge path. `r0 = 0` gives a pie wedge. A full circle (|a1 - a0| ≥ 2π) is drawn as a closed ring.
 * @returns {any[]} path data
 */
export function arcPath(cx, cy, r0, r1, a0, a1) {
  const full = Math.abs(a1 - a0) >= TAU - 1e-6;
  const end = full ? a0 + TAU : a1;
  const d = [];
  const [sx, sy] = pt(cx, cy, r1, a0);
  d.push(['M', sx, sy]);
  arcSegments(d, cx, cy, r1, a0, end);
  if (r0 > 0.01) {
    if (full) {
      d.push(['Z']);
      const [ix, iy] = pt(cx, cy, r0, end);
      d.push(['M', ix, iy]);
    } else {
      const [ix, iy] = pt(cx, cy, r0, end);
      d.push(['L', ix, iy]);
    }
    arcSegments(d, cx, cy, r0, end, a0);
  } else if (!full) d.push(['L', cx, cy]);
  d.push(['Z']);
  return d;
}

/** Rounded rectangle path; `r` is a number or `[tl, tr, br, bl]`. */
export function roundRectPath(x, y, w, h, r = 0) {
  const lim = Math.max(0, Math.min(w, h) / 2);
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0, Math.min(lim, v || 0)));
  if (!tl && !tr && !br && !bl) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  const K = 0.5522847498;
  return [
    ['M', x + tl, y],
    ['L', x + w - tr, y],
    ['C', x + w - tr + tr * K, y, x + w, y + tr - tr * K, x + w, y + tr],
    ['L', x + w, y + h - br],
    ['C', x + w, y + h - br + br * K, x + w - br + br * K, y + h, x + w - br, y + h],
    ['L', x + bl, y + h],
    ['C', x + bl - bl * K, y + h, x, y + h - bl + bl * K, x, y + h - bl],
    ['L', x, y + tl],
    ['C', x, y + tl - tl * K, x + tl - tl * K, y, x + tl, y],
    ['Z'],
  ];
}

/** Full circle path. */
export function circlePath(cx, cy, r) {
  return arcPath(cx, cy, 0, r, 0, TAU);
}

/** Polyline path through points (skips null points by starting a new subpath). */
export function linePathData(points) {
  const d = [];
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d.push([pen ? 'L' : 'M', p[0], p[1]]);
    pen = true;
  }
  return d;
}

/**
 * Smooth (monotone cubic, no overshoot between points) path through points sorted by x. Null points break the
 * line. Falls back to straight segments for two points.
 */
export function smoothPathData(points) {
  const d = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    d.push(['M', run[0][0], run[0][1]]);
    const n = run.length;
    if (n === 2) d.push(['L', run[1][0], run[1][1]]);
    else if (n > 2) {
      const dx = [];
      const m = [];
      for (let i = 0; i < n - 1; i++) {
        dx[i] = run[i + 1][0] - run[i][0] || 1e-9;
        m[i] = (run[i + 1][1] - run[i][1]) / dx[i];
      }
      const t = [m[0]];
      for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
      t[n - 1] = m[n - 2];
      for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) {
          t[i] = 0;
          t[i + 1] = 0;
          continue;
        }
        const a = t[i] / m[i];
        const b = t[i + 1] / m[i];
        const s = a * a + b * b;
        if (s > 9) {
          const k = 3 / Math.sqrt(s);
          t[i] = k * a * m[i];
          t[i + 1] = k * b * m[i];
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const h = dx[i] / 3;
        d.push(['C', run[i][0] + h, run[i][1] + t[i] * h, run[i + 1][0] - h, run[i + 1][1] - t[i + 1] * h, run[i + 1][0], run[i + 1][1]]);
      }
    }
    run = [];
  };
  for (const p of points) {
    if (!p) flush();
    else run.push(p);
  }
  flush();
  return d;
}

/** Radar vertex of axis `i` of `n` at normalized radius `t` (0..1); axis 0 points up. */
export function radarPoint(cx, cy, R, i, n, t) {
  const a = -Math.PI / 2 + (i / n) * TAU;
  return [cx + Math.cos(a) * R * t, cy + Math.sin(a) * R * t];
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex) {
  const h = String(hex).replace('#', '');
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

/** Black or white, whichever reads better on `bg`. */
export const readableOn = (bg) => (luminance(bg) > 0.4 ? '#111827' : '#ffffff');
