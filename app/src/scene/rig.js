// Scene Studio motion rigging (docs/scene-studio.md ▸ Motion tools): parenting and null objects, behaviors (the
// expressions-lite presets wiggle, loop and spin), sequence layers (stagger), audio-driven keyframes and beat
// markers. Pure and deterministic (frame = f(model, time)); unit-tested in tests/scene/rig.test.js.
//
// Clip fields (scene format 3, all optional):
//   parent   id of a picture clip of the same sequence: this clip's transform is relative to the parent's (its x, y
//            are in the parent's layer space, measured from the parent's content center); the parent need not be
//            on screen. No cycles (setParent refuses them, normalizeParents drops them).
//   beh      [{ id, type: "wiggle" | "loop" | "spin", prop, … }] behaviors on top of keyframes:
//              wiggle { amount, freq (per second), seed }   smooth deterministic noise added to the value
//              loop   { mode: "cycle" | "pingpong" | "offset" }   repeats the keyframes after the last one
//              spin   { rate (units per second) }              adds rate × time (rotation, position, …)
//   mblur    true = motion blur for this layer (the compositor averages sub-frames over a 180° shutter)
import { valueAt, isTrack } from "./keyframes.js";

export const BEHAVIOR_TYPES = ["wiggle", "loop", "spin"];
export const BEHAVIOR_PROPS = ["x", "y", "sx", "sy", "rot", "opacity", "ax", "ay"];
const LOOP_MODES = ["cycle", "pingpong", "offset"];
const num = (v, d = 0) => (Number.isFinite(+v) && v !== null && v !== "" ? +v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isId = (id) => typeof id === "string" && /^[\w-]{1,64}$/.test(id);

// ---------------------------------------------------------------------------------------------- behaviors

/** Valid behaviors from untrusted input (at most 16 per clip). */
export function normBehaviors(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const b of list.slice(0, 16)) {
    if (!b || !BEHAVIOR_TYPES.includes(b.type) || !BEHAVIOR_PROPS.includes(b.prop)) continue;
    const id = isId(b.id) ? b.id : `b${out.length}${Math.round(num(b.seed, out.length) * 7)}`;
    if (b.type === "wiggle") out.push({ id, type: "wiggle", prop: b.prop, amount: clamp(num(b.amount, 10), 0, 100000), freq: clamp(num(b.freq, 2), 0.01, 60), seed: Math.round(clamp(num(b.seed, 1), 0, 1e6)) });
    else if (b.type === "loop") out.push({ id, type: "loop", prop: b.prop, mode: LOOP_MODES.includes(b.mode) ? b.mode : "cycle" });
    else out.push({ id, type: "spin", prop: b.prop, rate: clamp(num(b.rate, 90), -1e6, 1e6) });
  }
  return out.length ? out : undefined;
}

// smooth value noise in [-1, 1]: a hash per integer step, cosine-free smoothstep between them (deterministic)
function hash(i, seed) {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
/** Smooth deterministic noise in [-1, 1] at position `x` (two octaves). */
export function noise1(x, seed = 0) {
  const oct = (p, sd) => {
    const i = Math.floor(p);
    const f = p - i;
    const u = f * f * (3 - 2 * f);
    return hash(i, sd) * (1 - u) + hash(i + 1, sd) * u;
  };
  return (oct(x, seed) * 2 + oct(x * 2.03, seed + 17) * 0.75) / 2.75;
}

// clip-local time folded by a loop behavior (only after the last keyframe), plus the value offset of "offset" loops
function loopTime(v, b, t) {
  if (!isTrack(v) || v.kf.length < 2) return { t, add: 0 };
  const a = v.kf[0].t;
  const z = v.kf[v.kf.length - 1].t;
  const span = z - a;
  if (t <= z || span <= 1e-9) return { t, add: 0 };
  const k = (t - a) / span;
  const n = Math.floor(k);
  const f = (t - a) - n * span;
  if (b.mode === "pingpong") return { t: n % 2 ? z - f : a + f, add: 0 };
  if (b.mode === "offset") {
    const dv = typeof v.kf[0].v === "number" ? v.kf[v.kf.length - 1].v - v.kf[0].v : 0;
    return { t: a + f, add: dv * n };
  }
  return { t: a + f, add: 0 };
}

/**
 * The value of a transform property of clip `c` at clip-local time `kt` with its behaviors applied (loop first, then
 * spin and wiggle add to the keyframed value). Without behaviors this is valueAt(c[prop], kt).
 */
export function propAt(c, prop, kt) {
  const v = c[prop] ?? (prop === "ax" || prop === "ay" ? 0 : undefined);
  const list = c.beh?.filter((b) => b.prop === prop);
  if (!list?.length) return valueAt(v, kt);
  let t = kt;
  let add = 0;
  for (const b of list) if (b.type === "loop") ({ t, add } = loopTime(v, b, t));
  let out = valueAt(v, t);
  if (typeof out !== "number") return out;
  out += add;
  for (const b of list) {
    if (b.type === "spin") out += b.rate * kt;
    else if (b.type === "wiggle") out += b.amount * noise1(kt * b.freq, b.seed + BEHAVIOR_PROPS.indexOf(prop) * 101);
  }
  return out;
}

/** Adds a behavior to a clip. @returns {{ model, id }} */
export function addBehavior(m, id, b) {
  const c = m.clips[id];
  if (!c) throw new Error(`There is no clip “${id}”.`);
  if (c.type === "audio") throw new Error("Behaviors animate pictures; audio clips have no transform.");
  const bid = `b${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const list = normBehaviors([...(c.beh || []), { ...b, id: bid }]);
  if (!list || list.length === (c.beh?.length || 0)) throw new Error(`A behavior needs a type (${BEHAVIOR_TYPES.join(", ")}) and a property (${BEHAVIOR_PROPS.join(", ")}).`);
  return { model: { ...m, clips: { ...m.clips, [id]: { ...c, beh: list } } }, id: list[list.length - 1].id };
}

/** Changes (patch) or removes (patch = null) a behavior of a clip. */
export function updateBehavior(m, id, bid, patch) {
  const c = m.clips[id];
  if (!c?.beh?.some((b) => b.id === bid)) throw new Error(`Clip “${id}” has no behavior “${bid}”.`);
  const list = patch === null ? c.beh.filter((b) => b.id !== bid) : normBehaviors(c.beh.map((b) => (b.id === bid ? { ...b, ...patch, id: bid, type: b.type } : b)));
  const n = { ...c };
  if (list?.length) n.beh = list;
  else delete n.beh;
  return { ...m, clips: { ...m.clips, [id]: n } };
}

// ---------------------------------------------------------------------------------------------- parenting

/** 2D affine matrices [a, b, c, d, e, f] (as in DOMMatrix / canvas setTransform). */
export const mul = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
export function invert(p) {
  const det = p[0] * p[3] - p[1] * p[2] || 1e-12;
  return [p[3] / det, -p[1] / det, -p[2] / det, p[0] / det, (p[2] * p[5] - p[3] * p[4]) / det, (p[1] * p[4] - p[0] * p[5]) / det];
}
export const apply = (p, x, y) => [p[0] * x + p[2] * y + p[4], p[1] * x + p[3] * y + p[5]];

/** The local transform of a clip at clip-local time: translate(x, y) · rotate · scale · translate(−anchor). */
export function localMatrix(c, kt) {
  const x = propAt(c, "x", kt);
  const y = propAt(c, "y", kt);
  const r = ((propAt(c, "rot", kt) || 0) * Math.PI) / 180;
  const sx = propAt(c, "sx", kt);
  const sy = propAt(c, "sy", kt);
  const ax = propAt(c, "ax", kt) || 0;
  const ay = propAt(c, "ay", kt) || 0;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const L = [cos * sx, sin * sx, -sin * sy, cos * sy, x, y];
  return ax || ay ? mul(L, [1, 0, 0, 1, -ax, -ay]) : L;
}

/**
 * The matrix of a clip's parents at timeline time t (identity without a parent): parent's world matrix, which maps
 * the parent's layer space (content center = 0, 0) to sequence pixels. Parents are evaluated at their clamped local
 * time, so a parent off screen still carries its children.
 */
export function parentMatrix(m, c, t, depth = 0) {
  const p = c.parent && m.clips[c.parent];
  if (!p || depth > 32) return [1, 0, 0, 1, 0, 0];
  const kt = clamp(t - p.start, 0, p.dur);
  return mul(parentMatrix(m, p, t, depth + 1), localMatrix(p, kt));
}

/** True when `parentId` is `id` or has `id` among its parents (a cycle). */
export function parentCycle(m, id, parentId) {
  for (let p = parentId, n = 0; p && n < 64; p = m.clips[p]?.parent, n++) if (p === id) return true;
  return false;
}

/** Drops parent links that point nowhere, to audio clips, or around in a circle (normalizeScene calls it). */
export function normalizeParents(clips) {
  for (const c of Object.values(clips)) {
    if (c.parent === undefined) continue;
    const p = clips[c.parent];
    if (!p || p.type === "audio" || c.type === "audio" || p.id === c.id) delete c.parent;
  }
  for (const c of Object.values(clips)) if (c.parent && parentCycle({ clips }, c.id, c.parent)) delete c.parent;
  return clips;
}

// decomposes an affine matrix into translation, rotation (degrees) and scale (skew is dropped)
function decompose(p) {
  const sx = Math.hypot(p[0], p[1]);
  const rot = (Math.atan2(p[1], p[0]) * 180) / Math.PI;
  const det = p[0] * p[3] - p[1] * p[2];
  const sy = sx ? det / sx : Math.hypot(p[2], p[3]);
  return { x: p[4], y: p[5], rot, sx, sy };
}

/**
 * Parents a clip to another (or unparents it with parentId = null) without a jump at timeline time t: the child's
 * position, rotation and scale (constants or every keyframe) are converted into the new space as seen at t.
 */
export function setParent(m, id, parentId, t) {
  const c = m.clips[id];
  if (!c) throw new Error(`There is no clip “${id}”.`);
  if (c.type === "audio") throw new Error("Audio clips cannot be parented.");
  if (parentId) {
    const p = m.clips[parentId];
    if (!p || p.type === "audio") throw new Error(`There is no picture clip “${parentId}” to parent to.`);
    if (parentCycle(m, id, parentId)) throw new Error("A clip cannot be parented to itself or to one of its children.");
  }
  if ((c.parent || null) === (parentId || null)) return m;
  const from = parentMatrix(m, c, t);
  const next = { ...c };
  if (parentId) next.parent = parentId;
  else delete next.parent;
  const to = parentMatrix({ ...m, clips: { ...m.clips, [id]: next } }, next, t);
  const conv = mul(invert(to), from); // old parent space → new parent space
  const d = decompose(conv);
  const local = clamp(t - c.start, 0, c.dur);
  // converts one keyframe time's transform
  const at = (kt) => {
    const [x, y] = apply(conv, valueAt(c.x, kt), valueAt(c.y, kt));
    return { x, y, rot: valueAt(c.rot, kt) + d.rot, sx: valueAt(c.sx, kt) * d.sx, sy: valueAt(c.sy, kt) * d.sy };
  };
  for (const k of ["x", "y", "rot", "sx", "sy"]) {
    const v = c[k];
    next[k] = isTrack(v) ? { kf: v.kf.map((f) => ({ ...f, v: at(f.t)[k], ...(f.i ? { i: [f.i[0] * (k === "sx" ? d.sx : k === "sy" ? d.sy : 1), f.i[1]] } : {}), ...(f.o ? { o: [f.o[0] * (k === "sx" ? d.sx : k === "sy" ? d.sy : 1), f.o[1]] } : {}) })) } : at(local)[k];
  }
  // position tangents are only exact without rotation between the spaces; drop them when a rotation is involved
  if (Math.abs(d.rot) > 1e-6) for (const k of ["x", "y"]) if (isTrack(next[k])) next[k] = { kf: next[k].kf.map(({ i: _i, o: _o, b: _b, ...f }) => f) };
  return { ...m, clips: { ...m.clips, [id]: next } };
}

// ---------------------------------------------------------------------------------------------- sequence layers

/**
 * Sequence layers (After Effects' Keyframe Assistant ▸ Sequence Layers): the clips start one after another, each
 * `step` seconds after the previous one's start (offset mode), or each after the previous one's end minus `overlap`
 * seconds (overlap mode). Order: as given ("selection"), by track from top ("track") or by current start ("time").
 * Clips stay on their tracks; what they land on is overwritten. Returns the model.
 */
export function staggerClips(m, ids, { step = 0.2, overlap = null, order = "selection", from = null, moveClip }) {
  let list = ids.map((id) => m.clips[id]).filter(Boolean);
  if (list.length < 2) return m;
  if (order === "track") list = list.slice().sort((a, b) => m.tracks.findIndex((k) => k.id === a.track) - m.tracks.findIndex((k) => k.id === b.track) || a.start - b.start);
  if (order === "time") list = list.slice().sort((a, b) => a.start - b.start);
  let t = from === null ? list[0].start : Math.max(0, num(from));
  let next = m;
  for (const c of list) {
    next = moveClip(next, c.id, { start: t });
    t = overlap === null || overlap === undefined ? t + num(step, 0.2) : t + c.dur - num(overlap, 0);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------- audio-driven animation

/**
 * Keyframes of a property driven by the loudness of an audio clip (After Effects' Convert Audio to Keyframes plus
 * a linear map): `levels` = { hop (seconds), db (dBFS per hop) } of the audio clip's MEDIA (scene/analysis.js ▸
 * levelsDb). Every `every` frames of the target clip gets a keyframe whose value maps the level between `floor` and
 * the loudest level in the span to `min` … `max`. `smooth` (0..1) softens the envelope (fast attack, slow release).
 * The keyframes replace the property's animation. Returns { model, keys }.
 */
export function audioToKeyframes(m, { id, prop, audio, levels, min = 1, max = 1.3, floor = -50, smooth = 0.5, every = 1 }, { setProp }) {
  const c = m.clips[id];
  const a = m.clips[audio];
  if (!c) throw new Error(`There is no clip “${id}”.`);
  if (!a || (a.type !== "audio" && a.type !== "video")) throw new Error("Choose an audio clip (or a video clip with sound) to drive the animation.");
  if (!levels?.db?.length || !(levels.hop > 0)) throw new Error("The sound levels are missing.");
  const fps = m.fps;
  const n0 = Math.max(1, Math.round(num(every, 1)));
  const frames = Math.round(c.dur * fps);
  const stepF = Math.max(n0, Math.ceil(frames / 1500)); // keyframe tracks keep at most 2000 keyframes
  const lvl = (srcT) => {
    const i = Math.floor(srcT / levels.hop);
    return i >= 0 && i < levels.db.length ? levels.db[i] : -120;
  };
  const raw = [];
  for (let f = 0; f <= frames; f += stepF) {
    const T = c.start + f / fps;
    const inside = T >= a.start && T < a.start + a.dur;
    const src = inside ? (a.in || 0) + (T - a.start) * (a.speed || 1) : -1;
    raw.push({ t: f / fps, db: inside ? lvl(src) : -120 });
  }
  const peak = Math.max(floor + 1, ...raw.map((r) => r.db));
  const k = clamp(num(smooth, 0.5), 0, 0.98);
  let env = 0;
  const kf = raw.map((r) => {
    const x = clamp((r.db - floor) / (peak - floor), 0, 1);
    env = x > env ? x : env * k + x * (1 - k); // attack at once, release smoothly
    return { t: Math.round(r.t * 1e6) / 1e6, v: Math.round((min + (max - min) * env) * 1e4) / 1e4 };
  });
  let next = m;
  const paths = prop === "scale" ? ["sx", "sy"] : [prop];
  for (const p of paths) next = setProp(next, id, p, { kf });
  return { model: next, keys: kf.length };
}

/** Markers at the beats of a media item's analysis (model.analysis[media].beats), mapped through the clips that use it. */
export function beatMarkerTimes(m, mediaId, { every = 1, limit = 500 } = {}) {
  const beats = m.analysis?.[mediaId]?.beats?.times;
  if (!Array.isArray(beats) || !beats.length) return [];
  const out = new Set();
  for (const c of Object.values(m.clips)) {
    if (c.media !== mediaId || c.in === undefined) continue;
    beats.forEach((b, i) => {
      if (i % Math.max(1, Math.round(every))) return;
      const tt = c.start + (b - c.in) / (c.speed || 1);
      if (tt >= c.start - 1e-6 && tt < c.start + c.dur) out.add(Math.round(tt * m.fps) / m.fps);
    });
  }
  return [...out].sort((x, y) => x - y).slice(0, limit);
}

/** A null object: an invisible shape layer (no fill, no outline) used as a parent or a handle for motion. */
export const nullProps = () => ({ type: "shape", name: "Null", shape: { kind: "rect", w: 100, h: 100, fill: null, stroke: null, strokeW: 0 } });
