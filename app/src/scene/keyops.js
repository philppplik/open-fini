// Scene Studio keyframe selections (docs/scene-studio.md ▸ Keyframes in the timeline): operations on keyframes of
// several clips and properties at once, as the timeline's keyframe rows, their context menu and the assistant use
// them. Pure (model in, model out); unit-tested in tests/scene/keyops.test.js.
//
// A selection is a list of keys { id (clip id), path (property path, scene/model.js ▸ propValue), t (clip-local
// seconds of the keyframe) }. Keys that no longer exist are ignored.
import * as M from "./model.js";
import { isTrack, valueAt, applyEasing, removeKeys, normalizeValue, EASINGS } from "./keyframes.js";

const EPS = 1e-4;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** Groups a selection by clip and path: Map(`id|path` → { id, path, times[] }). */
export function groupKeys(sel) {
  const out = new Map();
  for (const k of sel || []) {
    const key = `${k.id}|${k.path}`;
    if (!out.has(key)) out.set(key, { id: k.id, path: k.path, times: [] });
    out.get(key).times.push(k.t);
  }
  return out;
}

const indicesOf = (track, times) => track.kf.map((k, i) => (times.some((t) => Math.abs(k.t - t) < EPS) ? i : -1)).filter((i) => i >= 0);

// Applies fn(track, idx, clip) → track to every (clip, path) of the selection that is animated.
function eachTrack(m, sel, fn) {
  let next = m;
  for (const g of groupKeys(sel).values()) {
    const c = next.clips[g.id];
    if (!c) continue;
    const v = M.propValue(c, g.path);
    if (!isTrack(v)) continue;
    const idx = indicesOf(v, g.times);
    if (!idx.length) continue;
    next = M.editKeyframes(next, g.id, g.path, (tr) => fn(tr, idx, c));
  }
  return next;
}

/** Every keyframe of a clip (all animated paths), or of one path. */
export function keysOfClip(c, path = null) {
  const out = [];
  for (const p of path ? [path] : M.animatedPaths(c)) {
    const v = M.propValue(c, p);
    if (isTrack(v)) for (const k of v.kf) out.push({ id: c.id, path: p, t: k.t });
  }
  return out;
}

/** Deletes the selected keyframes (a property left without keyframes keeps the value of the first one). */
export const deleteKeys = (m, sel) => eachTrack(m, sel, (tr, idx) => removeKeys(tr, idx));

/** Applies an easing preset (keyframes.js ▸ EASING_PRESETS or [x1, y1, x2, y2]) to the selected keyframes. */
export const easeKeys = (m, sel, preset) => eachTrack(m, sel, (tr, idx) => applyEasing(tr, idx, preset));

/** Sets the value of the selected keyframes. */
export const setKeyValue = (m, sel, value) =>
  eachTrack(m, sel, (tr, idx) => {
    const kf = tr.kf.slice();
    for (const i of idx) kf[i] = { ...kf[i], v: value };
    return normalizeValue({ kf }, tr);
  });

/**
 * Retimes the selected keyframes: t' = pivot + (t − pivot) × factor + dt (clip-local seconds, pivot in timeline
 * seconds), snapped to frames and kept inside the clip. A moved keyframe that lands on one that stays replaces it;
 * tangent speeds are divided by the factor so curves keep their shape. Returns { model, sel } with the new times.
 */
export function retimeKeys(m, sel, { dt = 0, factor = 1, pivot = 0 } = {}) {
  let next = m;
  const out = [];
  const f = Number.isFinite(factor) ? factor : 1;
  for (const g of groupKeys(sel).values()) {
    const c = next.clips[g.id];
    if (!c) continue;
    const v = M.propValue(c, g.path);
    if (!isTrack(v)) continue;
    const idx = new Set(indicesOf(v, g.times));
    if (!idx.size) continue;
    const pl = pivot - c.start;
    const moved = [];
    const still = [];
    v.kf.forEach((k, i) => {
      if (!idx.has(i)) return still.push(k);
      const t = Math.max(0, Math.min(c.dur, Math.round((pl + (k.t - pl) * f + dt) * m.fps) / m.fps));
      const n = { ...k, t };
      const sc = (tg) => [tg[0] / (Math.abs(f) || 1), tg[1]];
      if (f !== 1 && k.i) n.i = sc(k.i);
      if (f !== 1 && k.o) n.o = sc(k.o);
      moved.push(n);
    });
    // two moved keyframes on the same frame: the later one wins
    const uniq = [];
    for (const k of moved) {
      const j = uniq.findIndex((x) => Math.abs(x.t - k.t) < EPS);
      if (j >= 0) uniq[j] = k;
      else uniq.push(k);
    }
    const kf = [...still.filter((k) => !uniq.some((x) => Math.abs(x.t - k.t) < EPS)), ...uniq].sort((a, b) => a.t - b.t);
    next = M.editKeyframes(next, g.id, g.path, () => ({ kf }));
    for (const k of uniq) out.push({ id: g.id, path: g.path, t: k.t });
  }
  return { model: next, sel: out };
}

/**
 * Reverses the selected keyframes in time (per property, within the span they cover): values play backwards,
 * easings and tangents are mirrored (what left a keyframe now enters it).
 */
export function reverseKeys(m, sel) {
  return eachTrack(m, sel, (tr, idx) => {
    if (idx.length < 2) return tr;
    const sorted = [...idx].sort((a, b) => a - b);
    const a = tr.kf[sorted[0]].t;
    const b = tr.kf[sorted[sorted.length - 1]].t;
    const picked = sorted.map((i) => tr.kf[i]);
    // segment easings belong to the segment that leaves a keyframe: after reversal segment j → j+1 is the old
    // segment (n-2-j) → (n-1-j) played backwards, so it takes that segment's easing mirrored where it is a curve
    const n = picked.length;
    const flip = (e) => {
      const b = Array.isArray(e) ? e : EASINGS[e];
      return b ? [1 - b[2], 1 - b[3], 1 - b[0], 1 - b[1]].map(r6) : e;
    };
    const rev = picked
      .slice()
      .reverse()
      .map((k, j) => {
        const src = picked[n - 2 - j]; // old keyframe whose leaving segment becomes this keyframe's leaving segment
        const out = { t: r6(a + b - k.t), v: k.v };
        if (k.o) out.i = [-k.o[0], k.o[1]];
        if (k.i) out.o = [-k.i[0], k.i[1]];
        if (k.b) out.b = true;
        const e = src?.e === "hold" ? null : src?.e;
        if (e && j < n - 1) out.e = flip(e);
        return out;
      });
    const keep = tr.kf.filter((_, i) => !sorted.includes(i));
    return { kf: [...keep, ...rev].sort((x, y) => x.t - y.t) };
  });
}

/**
 * Copies the selected keyframes: { items: [{ path, keys }] } with times relative to the earliest selected keyframe
 * (all properties keep their timing to each other).
 */
export function copyKeySel(m, sel) {
  const groups = [...groupKeys(sel).values()];
  let t0 = Infinity;
  const items = [];
  for (const g of groups) {
    const c = m.clips[g.id];
    const v = c && M.propValue(c, g.path);
    if (!isTrack(v)) continue;
    const keys = indicesOf(v, g.times).map((i) => ({ ...v.kf[i], t: c.start + v.kf[i].t }));
    if (!keys.length) continue;
    t0 = Math.min(t0, ...keys.map((k) => k.t));
    const fx = /^fx:([\w-]+):/.exec(g.path);
    items.push({ path: g.path, ...(fx ? { type: c.effects.find((e) => e.id === fx[1])?.type } : {}), keys });
  }
  return { items: items.map((it) => ({ ...it, keys: it.keys.map((k) => ({ ...k, t: r6(k.t - t0) })) })) };
}

/**
 * Pastes copied keyframes into a clip at timeline time `at`. Properties the clip does not have are skipped (effect
 * paths match by effect type when the ids differ). Returns { model, sel } with the pasted keys.
 */
export function pasteKeySel(m, id, clip, at) {
  const c = m.clips[id];
  if (!c || !clip?.items?.length) return { model: m, sel: [] };
  let next = m;
  const sel = [];
  for (const it of clip.items) {
    const path = matchPath(c, it.path, it.type);
    if (!path) continue;
    if (it.keys.some((k) => typeof k.v !== typeof valueAt(M.propValue(c, path), 0))) continue; // a color into a number
    const before = next;
    try {
      next = M.pasteKeyframes(next, id, path, it.keys, at);
    } catch {
      continue;
    }
    if (next === before) continue;
    const local = Math.max(0, Math.min(c.dur, M.snapT(m, at) - c.start));
    for (const k of it.keys) if (local + k.t <= c.dur + 1e-6) sel.push({ id, path, t: r6(local + k.t) });
  }
  return { model: next, sel };
}

// A copied path on another clip: the same path, or for an effect parameter the first effect of the same type
// (the type is part of the clipboard entry: { path, type }).
function matchPath(c, path, type = null) {
  if (M.propValue(c, path) !== undefined) return path;
  const fx = /^fx:([\w-]+):([\w-]+)$/.exec(path);
  if (!fx || !type) return null;
  const e = c.effects.find((x) => x.type === type);
  return e ? `fx:${e.id}:${fx[2]}` : null;
}

/** Times (timeline seconds) of all keyframes of a clip, sorted and unique: next / previous keyframe navigation. */
export function keyTimesOf(c, path = null) {
  const set = new Set();
  for (const k of keysOfClip(c, path)) set.add(r6(c.start + k.t));
  return [...set].sort((a, b) => a - b);
}

/**
 * The stopwatch: turns the animation of a property on (one keyframe with the current value at timeline time `t`) or
 * off (all keyframes removed; the value at `t` stays).
 */
export function toggleAnimation(m, id, path, t) {
  const c = m.clips[id];
  if (!c) return m;
  const v = M.propValue(c, path);
  if (v === undefined) return m;
  const local = Math.max(0, Math.min(c.dur, t - c.start));
  if (isTrack(v)) return M.setProp(m, id, path, valueAt(v, local));
  return M.setKeyframe(m, id, path, t, v);
}
