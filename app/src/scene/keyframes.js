// Scene Studio keyframes (docs/scene-studio.md ▸ Animation). Pure: no DOM; unit-tested in tests/scene/keyframes.test.js.
//
// An animatable value is either a constant (number, [numbers], "#rrggbb") or a track
//   { kf: [{ t, v, e?, i?, o?, b? }] }
//     t = seconds from the clip start, sorted ascending; v = the value at t;
//     e = easing of the segment that LEAVES this keyframe:
//         "linear" (default) | "hold" | "ease" | "easeIn" | "easeOut" | "easeInOut" | "back" | "bounce" | "elastic" |
//         [x1, y1, x2, y2] (a CSS cubic-bezier, y may overshoot)
//     i, o = Bezier tangents (scene format 2, numeric values only): [speed, influence] of the handle that enters (i)
//         or leaves (o) the keyframe; speed in value units per second, influence 0..1 of the neighbouring segment's
//         length (After Effects' model, so tangents survive moving keyframes in time). A segment a → b with a.o or
//         b.i is a 2D cubic Bezier through (a.t, a.v), (a.t + fa·span, a.v + sa·fa·span),
//         (b.t − fb·span, b.v − sb·fb·span), (b.t, b.v); a missing side is derived from a.e. When fa + fb > 1 both
//         are scaled down so time stays monotonic. "hold" wins over tangents.
//     b = true: broken tangents (the editors move i and o independently); unified otherwise.
// Before the first keyframe the first value holds, after the last one the last value holds. Files without i / o
// evaluate exactly as before (format 1).
// Invariant: valueAt() is deterministic: the same track and time always give the same value (frame = f(time)).

export const EASINGS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  back: [0.34, 1.56, 0.64, 1],
};
// Easings that are not one cubic: functions of the progress p (0..1), exact at both ends.
const C4 = (2 * Math.PI) / 3;
export const EASE_FUNCS = {
  bounce(p) {
    const n = 7.5625;
    const d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
  },
  elastic: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * C4) + 1),
};
export const EASING_NAMES = [...Object.keys(EASINGS), ...Object.keys(EASE_FUNCS), "hold"];
const isEasing = (e) => e === "hold" || !!EASINGS[e] || !!EASE_FUNCS[e];

// Curve parameter s of the cubic x(s) through 0, x1, x2, 1 where x(s) = x (Newton steps, then bisection).
function solveX(x1, x2, x) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  let t = x;
  for (let i = 0; i < 6; i++) {
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    const nt = t - (fx(t) - x) / d;
    if (Math.abs(nt - t) < 1e-6) {
      t = nt;
      break;
    }
    t = nt;
  }
  if (!(t >= 0 && t <= 1) || Math.abs(fx(t) - x) > 1e-4) {
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = fx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return t;
}

const cubic = (y0, y1, y2, y3, s) => {
  const u = 1 - s;
  return u * u * u * y0 + 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s * y3;
};

/** y of the cubic bezier (0,0) (x1,y1) (x2,y2) (1,1) at x (Newton steps, then bisection). */
export function bezierAt(x1, y1, x2, y2, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x;
  return cubic(0, y1, y2, 1, solveX(x1, x2, x));
}

/** Eased progress 0..1 (may overshoot) of a segment with easing `e`. */
export function ease(e, p) {
  if (e === "hold") return p >= 1 ? 1 : 0;
  if (typeof e === "string" && EASE_FUNCS[e]) return p <= 0 ? 0 : p >= 1 ? 1 : EASE_FUNCS[e](p);
  const b = Array.isArray(e) && e.length === 4 ? e : EASINGS[e] || EASINGS.linear;
  return bezierAt(+b[0] || 0, +b[1] || 0, +b[2] || 0, +b[3] || 0, p);
}

const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const rgba = (s) => {
  const m = HEX.exec(s);
  if (!m) return null;
  const n = m[1];
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), n.length === 8 ? parseInt(n.slice(6, 8), 16) : 255];
};
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

/** Interpolates two values of the same shape: numbers, arrays of numbers, hex colors; anything else switches at p = 1. */
export function lerpValue(a, b, p) {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => lerpValue(x, b[i], p));
  if (typeof a === "string" && typeof b === "string") {
    const ca = rgba(a);
    const cb = rgba(b);
    if (ca && cb) {
      const c = ca.map((x, i) => x + (cb[i] - x) * p);
      return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}${ca[3] === 255 && cb[3] === 255 ? "" : hex2(c[3])}`;
    }
  }
  return p >= 1 ? b : a;
}

export const isTrack = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.kf);

const DEFAULT_INFLUENCE = 1 / 3;
const isNum = (x) => typeof x === "number";

/**
 * The control values of the Bezier segment a → b: { fa, fb, y1, y2 } = handle times a.t + fa·span and b.t − fb·span
 * (fa, fb in 0..1, fa + fb <= 1) and handle values y1, y2. Sides without a tangent follow a.e (a cubic-bezier easing
 * maps exactly onto handles; bounce and elastic become a linear third). Numbers only.
 */
export function segmentHandles(a, b) {
  const span = b.t - a.t;
  const dv = b.v - a.v;
  const css = Array.isArray(a.e) && a.e.length === 4 ? a.e : EASINGS[a.e] || (EASE_FUNCS[a.e] ? null : EASINGS.linear);
  let fa;
  let y1;
  let fb;
  let y2;
  if (a.o) {
    fa = a.o[1];
    y1 = a.v + a.o[0] * fa * span;
  } else if (css) {
    fa = css[0];
    y1 = a.v + css[1] * dv;
  } else {
    fa = DEFAULT_INFLUENCE;
    y1 = a.v + dv * DEFAULT_INFLUENCE;
  }
  if (b.i) {
    fb = b.i[1];
    y2 = b.v - b.i[0] * fb * span;
  } else if (css) {
    fb = 1 - css[2];
    y2 = a.v + css[3] * dv;
  } else {
    fb = DEFAULT_INFLUENCE;
    y2 = b.v - dv * DEFAULT_INFLUENCE;
  }
  if (fa + fb > 1) {
    // keep time monotonic: shorten both handles along their direction
    const k = 1 / (fa + fb);
    y1 = a.v + (y1 - a.v) * k;
    y2 = b.v + (y2 - b.v) * k;
    fa *= k;
    fb *= k;
  }
  return { fa, fb, y1, y2 };
}

/** True when the segment a → b is drawn with Bezier tangents (scene format 2). */
export const isBezierSegment = (a, b) => !!(a.o || b.i) && a.e !== "hold" && isNum(a.v) && isNum(b.v);

/** The value between two keyframes at time t (a.t <= t <= b.t). */
export function segmentValue(a, b, t) {
  const span = b.t - a.t;
  if (!(span > 0)) return b.v;
  const p = (t - a.t) / span;
  if (isBezierSegment(a, b)) {
    if (p <= 0) return a.v;
    if (p >= 1) return b.v;
    const h = segmentHandles(a, b);
    return cubic(a.v, h.y1, h.y2, b.v, solveX(h.fa, 1 - h.fb, p));
  }
  return lerpValue(a.v, b.v, ease(a.e, p));
}

/** The value of a constant or a keyframe track at clip-local time `t` (seconds). */
export function valueAt(v, t) {
  if (!isTrack(v)) return v;
  const kf = v.kf;
  const n = kf.length;
  if (!n) return undefined;
  if (n === 1 || t <= kf[0].t) return kf[0].v;
  if (t >= kf[n - 1].t) return kf[n - 1].v;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kf[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return segmentValue(kf[lo], kf[hi], t);
}

/** Rate of change (value units per second) of a numeric track at t: the speed graph. Central difference. */
export function speedAt(v, t, h = 1 / 480) {
  if (!isTrack(v)) return 0;
  const a = valueAt(v, t - h);
  const b = valueAt(v, t + h);
  return isNum(a) && isNum(b) ? (b - a) / (2 * h) : 0;
}

const EPS = 1e-4;
const keepTangents = (k) => {
  const o = {};
  if (k?.i) o.i = k.i;
  if (k?.o) o.o = k.o;
  if (k?.b) o.b = true;
  return o;
};

/** Sets (adds or replaces) the keyframe at `t`; a constant becomes a track that starts with this keyframe. */
export function setKeyframe(v, t, value, e) {
  const kf = isTrack(v) ? v.kf.slice() : [];
  const i = kf.findIndex((k) => Math.abs(k.t - t) < EPS);
  const k = { t: Math.max(0, +t || 0), v: value, ...(e && e !== "linear" ? { e } : i >= 0 && kf[i].e ? { e: kf[i].e } : {}), ...(isNum(value) ? keepTangents(kf[i]) : {}) };
  if (i >= 0) kf[i] = k;
  else kf.push(k);
  kf.sort((a, b) => a.t - b.t);
  return { kf };
}

/** Removes the keyframe at `t`. The last keyframe turns the track back into its constant value. */
export function removeKeyframe(v, t) {
  if (!isTrack(v)) return v;
  const kf = v.kf.filter((k) => Math.abs(k.t - t) >= EPS);
  if (kf.length === v.kf.length) return v;
  return kf.length ? { kf } : v.kf[0].v;
}

/** Keyframe times of a value (empty for constants). */
export const keyTimes = (v) => (isTrack(v) ? v.kf.map((k) => k.t) : []);

/** Shifts and scales a track's keyframe times (trimming the clip head, changing its duration). Tangent speeds
 * (value per second) are divided by the scale so the curve keeps its shape. */
export function retime(v, { shift = 0, scale = 1 } = {}) {
  if (!isTrack(v)) return v;
  const sc = (tg) => [tg[0] / (scale || 1), tg[1]];
  return {
    kf: v.kf
      .map((k) => {
        const n = { ...k, t: Math.max(0, (k.t + shift) * scale) };
        if (scale !== 1 && k.i) n.i = sc(k.i);
        if (scale !== 1 && k.o) n.o = sc(k.o);
        return n;
      })
      .sort((a, b) => a.t - b.t),
  };
}

const normTangent = (x) => (Array.isArray(x) && x.length === 2 && Number.isFinite(+x[0]) && Number.isFinite(+x[1]) ? [Math.max(-1e7, Math.min(1e7, +x[0])), Math.max(0, Math.min(1, +x[1]))] : null);

/** A valid easing (`e` of a keyframe) from untrusted input, or null (= linear). */
export function normalizeEasing(e) {
  if (typeof e === "string") return isEasing(e) && e !== "linear" ? e : null;
  if (Array.isArray(e) && e.length === 4 && e.every((n) => Number.isFinite(+n))) return e.map((n, i) => (i % 2 ? Math.max(-10, Math.min(10, +n)) : Math.max(0, Math.min(1, +n))));
  return null;
}

/** A valid animatable value from untrusted input, or `fallback`. Keeps tangents (format 2) on numeric keyframes. */
export function normalizeValue(v, fallback) {
  const ok = (x) => (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && x.length < 64) || (Array.isArray(x) && x.length <= 8 && x.every((n) => typeof n === "number" && Number.isFinite(n)));
  if (isTrack(v)) {
    const kf = v.kf
      .filter((k) => k && Number.isFinite(+k.t) && ok(k.v))
      .slice(0, 2000)
      .map((k) => {
        const e = normalizeEasing(k.e);
        const out = { t: Math.max(0, +k.t), v: k.v, ...(e ? { e } : {}) };
        if (isNum(k.v)) {
          const i = normTangent(k.i);
          const o = normTangent(k.o);
          if (i) out.i = i;
          if (o) out.o = o;
          if (k.b === true && (i || o)) out.b = true;
        }
        return out;
      })
      .sort((a, b) => a.t - b.t);
    return kf.length ? { kf } : fallback;
  }
  return ok(v) ? v : fallback;
}

// ---------------------------------------------------------------------------------------------- track editing
// Pure helpers for the graph editor (scene/graph.js) and the model operations (scene/model.js ▸ setEasing …).
// Keyframes are addressed by their index in track.kf; every helper returns a new track and never mutates.

/** Easing presets of the graph editor and the assistant (besides a custom [x1, y1, x2, y2]). */
export const EASING_PRESETS = ["linear", "easyEase", "easyEaseIn", "easyEaseOut", "hold", "ease", "easeIn", "easeOut", "easeInOut", "back", "bounce", "elastic"];

const without = (k, ...keys) => {
  const n = { ...k };
  for (const x of keys) delete n[x];
  return n;
};

/**
 * Applies an easing preset to keyframes `idx` of a track:
 *   "linear"                                   both sides linear (tangents and easing cleared)
 *   "easyEase" | "easyEaseIn" | "easyEaseOut"  speed 0 with 33 % influence on both sides / entering / leaving
 *   "hold"                                     the value holds until the next keyframe
 *   a named easing or [x1, y1, x2, y2]         the curve of the segment that leaves the keyframe; its outgoing and the
 *                                              next keyframe's incoming tangent are cleared so the curve applies as is
 */
export function applyEasing(v, idx, preset) {
  if (!isTrack(v)) return v;
  const custom = Array.isArray(preset) ? normalizeEasing(preset) : null;
  if (!custom && !EASING_PRESETS.includes(preset)) throw new Error(`Unknown easing “${preset}”. Use one of ${EASING_PRESETS.join(", ")} or [x1, y1, x2, y2].`);
  const kf = v.kf.slice();
  const flat = [0, DEFAULT_INFLUENCE];
  for (const i of new Set(idx)) {
    const k = kf[i];
    if (!k) continue;
    const num = isNum(k.v);
    if (preset === "linear") kf[i] = without(k, "e", "i", "o", "b");
    else if (preset === "easyEase") kf[i] = num ? { ...without(k, "e"), i: flat, o: flat } : without(k, "e");
    else if (preset === "easyEaseIn") kf[i] = num ? { ...k, i: flat } : k;
    else if (preset === "easyEaseOut") kf[i] = num ? { ...without(k, "e"), o: flat } : k;
    else if (preset === "hold") kf[i] = { ...without(k, "o"), e: "hold" };
    else {
      kf[i] = { ...without(k, "o"), e: custom || preset };
      if (kf[i + 1]?.i) kf[i + 1] = without(kf[i + 1], "i");
    }
  }
  return { kf };
}

/**
 * Sets the tangents of keyframe `i`: { in?: [speed, influence], out?: [speed, influence], broken? }. A unified
 * (not broken) keyframe copies the speed of the side that was set to the other side, so the curve stays smooth
 * through it; influences stay independent (as in After Effects). Hold and named easings of the keyframe give way.
 */
export function setTangents(v, i, tangents = {}) {
  if (!isTrack(v) || !v.kf[i] || !isNum(v.kf[i].v)) return v;
  const kf = v.kf.slice();
  let k = { ...kf[i] };
  if (tangents.broken !== undefined) {
    if (tangents.broken) k.b = true;
    else delete k.b;
  }
  const tin = normTangent(tangents.in);
  const tout = normTangent(tangents.out);
  if (tin) k.i = tin;
  if (tout) k.o = tout;
  if (!k.b && (tin || tout) && !(tin && tout)) {
    const cur = tangentsOf(v, i);
    const s = (tin || tout)[0];
    if (tin && i < kf.length - 1) k.o = [s, k.o?.[1] ?? cur?.out?.[1] ?? DEFAULT_INFLUENCE];
    if (tout && i > 0) k.i = [s, k.i?.[1] ?? cur?.in?.[1] ?? DEFAULT_INFLUENCE];
  }
  if (k.o && k.e) k = without(k, "e");
  kf[i] = k;
  return { kf };
}

/** The effective tangents of keyframe `i` (explicit, or derived from the easings around it): { in, out, broken } or
 * null for non-numeric keyframes; `in` / `out` are null at the ends of the track. */
export function tangentsOf(v, i) {
  if (!isTrack(v)) return null;
  const kf = v.kf;
  const k = kf[i];
  if (!k || !isNum(k.v)) return null;
  const out = { in: null, out: null, broken: !!k.b };
  const prev = kf[i - 1];
  const next = kf[i + 1];
  if (prev && isNum(prev.v)) {
    const span = k.t - prev.t;
    const h = segmentHandles(prev, k);
    out.in = k.i ? k.i.slice() : [h.fb > 0 && span > 0 ? (k.v - h.y2) / (h.fb * span) : 0, h.fb];
  }
  if (next && isNum(next.v)) {
    const span = next.t - k.t;
    const h = segmentHandles(k, next);
    out.out = k.o ? k.o.slice() : [h.fa > 0 && span > 0 ? (h.y1 - k.v) / (h.fa * span) : 0, h.fa];
  }
  return out;
}

/**
 * Moves keyframes `idx` by dt seconds and dv value units (numbers only). A moved keyframe that lands on one that did
 * not move replaces it. Returns { track, idx } with the new indices of the moved keyframes.
 */
export function moveKeys(v, idx, dt = 0, dv = 0) {
  if (!isTrack(v)) return { track: v, idx: [] };
  const set = new Set(idx);
  const moved = [];
  const still = [];
  v.kf.forEach((k, i) => {
    if (set.has(i)) moved.push({ ...k, t: Math.max(0, k.t + dt), v: isNum(k.v) ? k.v + dv : k.v });
    else still.push(k);
  });
  const kept = still.filter((k) => !moved.some((x) => Math.abs(x.t - k.t) < EPS));
  const kf = [...kept, ...moved].sort((a, b) => a.t - b.t);
  return { track: { kf }, idx: moved.map((x) => kf.indexOf(x)) };
}

/** Removes keyframes `idx`; removing all of them leaves the value of the first one as a constant. */
export function removeKeys(v, idx) {
  if (!isTrack(v)) return v;
  const set = new Set(idx);
  const kf = v.kf.filter((_, i) => !set.has(i));
  return kf.length ? { kf } : v.kf[0].v;
}

/** Copies keyframes `idx` with times relative to the first one (the graph editor's clipboard). */
export function copyKeys(v, idx) {
  if (!isTrack(v)) return [];
  const list = [...new Set(idx)].sort((a, b) => a - b).map((i) => v.kf[i]).filter(Boolean);
  if (!list.length) return [];
  const t0 = list[0].t;
  return list.map((k) => ({ ...k, t: k.t - t0 }));
}

/** Pastes copied keyframes at time `at`, replacing keyframes at the same times; a constant becomes a track. */
export function pasteKeys(v, keys, at) {
  let kf = isTrack(v) ? v.kf.slice() : [];
  for (const k of keys) {
    const n = { ...k, t: Math.max(0, at + k.t) };
    kf = kf.filter((x) => Math.abs(x.t - n.t) >= EPS);
    kf.push(n);
  }
  kf.sort((a, b) => a.t - b.t);
  return kf.length ? normalizeValue({ kf }, v) : v;
}
