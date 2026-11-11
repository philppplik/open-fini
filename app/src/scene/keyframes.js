// Scene Studio keyframes (docs/scene-studio.md ▸ Animation). Pure: no DOM; unit-tested in tests/scene/keyframes.test.js.
//
// An animatable value is either a constant (number, [numbers], "#rrggbb") or a track
//   { kf: [{ t, v, e? }] }   t = seconds from the clip start, sorted ascending; v = the value at t;
//                            e = easing of the segment that LEAVES this keyframe:
//                                "linear" (default) | "hold" | "ease" | "easeIn" | "easeOut" | "easeInOut" | "back" |
//                                [x1, y1, x2, y2] (a CSS cubic-bezier, y may overshoot)
// Before the first keyframe the first value holds, after the last one the last value holds.
// Invariant: valueAt() is deterministic: the same track and time always give the same value (frame = f(time)).

export const EASINGS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  back: [0.34, 1.56, 0.64, 1],
};
export const EASING_NAMES = [...Object.keys(EASINGS), "hold"];

/** y of the cubic bezier (0,0) (x1,y1) (x2,y2) (1,1) at x (Newton steps, then bisection). */
export function bezierAt(x1, y1, x2, y2, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
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
  return ((ay * t + by) * t + cy) * t;
}

/** Eased progress 0..1 (may overshoot) of a segment with easing `e`. */
export function ease(e, p) {
  if (e === "hold") return p >= 1 ? 1 : 0;
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
  const a = kf[lo];
  const b = kf[hi];
  const span = b.t - a.t;
  return lerpValue(a.v, b.v, span > 0 ? ease(a.e, (t - a.t) / span) : 1);
}

const EPS = 1e-4;

/** Sets (adds or replaces) the keyframe at `t`; a constant becomes a track that starts with this keyframe. */
export function setKeyframe(v, t, value, e) {
  const kf = isTrack(v) ? v.kf.slice() : [];
  const i = kf.findIndex((k) => Math.abs(k.t - t) < EPS);
  const k = { t: Math.max(0, +t || 0), v: value, ...(e && e !== "linear" ? { e } : i >= 0 && kf[i].e ? { e: kf[i].e } : {}) };
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

/** Shifts and scales a track's keyframe times (trimming the clip head, changing its duration). */
export function retime(v, { shift = 0, scale = 1 } = {}) {
  if (!isTrack(v)) return v;
  return { kf: v.kf.map((k) => ({ ...k, t: Math.max(0, (k.t + shift) * scale) })).sort((a, b) => a.t - b.t) };
}

/** A valid animatable value from untrusted input, or `fallback`. */
export function normalizeValue(v, fallback) {
  const ok = (x) => (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && x.length < 64) || (Array.isArray(x) && x.length <= 8 && x.every((n) => typeof n === "number" && Number.isFinite(n)));
  if (isTrack(v)) {
    const kf = v.kf
      .filter((k) => k && Number.isFinite(+k.t) && ok(k.v))
      .slice(0, 2000)
      .map((k) => {
        const e = k.e === "hold" || EASINGS[k.e] ? k.e : Array.isArray(k.e) && k.e.length === 4 && k.e.every((n) => Number.isFinite(+n)) ? k.e.map((n, i) => (i % 2 ? +n : Math.max(0, Math.min(1, +n)))) : null;
        return { t: Math.max(0, +k.t), v: k.v, ...(e && e !== "linear" ? { e } : {}) };
      })
      .sort((a, b) => a.t - b.t);
    return kf.length ? { kf } : fallback;
  }
  return ok(v) ? v : fallback;
}
