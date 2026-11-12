// Scene Studio evaluation (docs/scene-studio.md ▸ Render pipeline): the frame at time t as plain data. Pure and
// deterministic (frame = f(model, time)): the viewer, the exporter, thumbnails and the assistant's render_frame all
// draw the SAME layer list, so what is previewed is what is exported. Unit-tested in tests/scene/evaluate.test.js.
//
//   frameState(model, t, { seq }) → { width, height, background, t, layers: Layer[] }   bottom layer first
//   Layer { clip, type, local (seconds since the clip start), time (source seconds for media / comp clips),
//           x, y, sx, sy, rot, opacity (already multiplied by transition alpha), blend, crop, mask,
//           effects: [{ type, p }] (parameters resolved to numbers), fx: transition modifiers
//           { dx, dy (frame fractions), wipe: [l, t, r, b] | null, scale, blur, dip: { color, a } | null },
//           textAnim: { type, p, edge } | null }
import { valueAt, ease, isTrack } from "./keyframes.js";
import { sequence, clipList, clipEnd, videoTracks, resolveClip, MAX_NESTING } from "./model.js";
import { propAt, parentMatrix } from "./rig.js";

const NO_FX = Object.freeze({ dx: 0, dy: 0, wipe: null, scale: 1, blur: 0, dip: null, alpha: 1 });

/**
 * Modifiers of a transition at presence p (0 = the clip is fully out, 1 = fully in). `edge` is "in" or "out".
 * Exported for tests and for the timeline's transition preview.
 */
export function transitionState(type, p, edge = "in") {
  const q = ease("easeInOut", Math.max(0, Math.min(1, p)));
  const out = edge === "out";
  switch (type) {
    case "fade":
    case "dissolve":
      return { ...NO_FX, alpha: q };
    case "dip-black":
    case "dip-white":
      return { ...NO_FX, dip: { color: type === "dip-black" ? "#000000" : "#ffffff", a: 1 - q } };
    case "slide-left":
      return { ...NO_FX, dx: out ? -(1 - q) : 1 - q };
    case "slide-right":
      return { ...NO_FX, dx: out ? 1 - q : -(1 - q) };
    case "slide-up":
      return { ...NO_FX, dy: out ? -(1 - q) : 1 - q };
    case "slide-down":
      return { ...NO_FX, dy: out ? 1 - q : -(1 - q) };
    case "wipe-left":
      return { ...NO_FX, wipe: [1 - q, 0, 1, 1] };
    case "wipe-right":
      return { ...NO_FX, wipe: [0, 0, q, 1] };
    case "wipe-up":
      return { ...NO_FX, wipe: [0, 1 - q, 1, 1] };
    case "wipe-down":
      return { ...NO_FX, wipe: [0, 0, 1, q] };
    case "zoom":
      return { ...NO_FX, alpha: q, scale: out ? 1 + 0.4 * (1 - q) : 0.6 + 0.4 * q };
    case "blur":
      return { ...NO_FX, alpha: q, blur: (1 - q) * 40 };
    default:
      return NO_FX;
  }
}

/** Text animation phase at clip-local time: the "in" animation, the "out" animation or none. */
export function textAnimState(anim, local, dur) {
  if (!anim) return null;
  if (anim.in !== "none" && local < anim.inDur) return { type: anim.in, p: Math.max(0, local / anim.inDur), edge: "in" };
  if (anim.out !== "none" && local > dur - anim.outDur) return { type: anim.out, p: Math.max(0, (dur - local) / anim.outDur), edge: "out" };
  return null;
}

function combine(a, b) {
  if (a === NO_FX) return b;
  if (b === NO_FX) return a;
  return { dx: a.dx + b.dx, dy: a.dy + b.dy, wipe: a.wipe || b.wipe, scale: a.scale * b.scale, blur: a.blur + b.blur, dip: a.dip || b.dip, alpha: a.alpha * b.alpha };
}

/** One clip resolved at clip-local time `local` (which may lie past its end for a dissolve tail). */
export function layerAt(c, local) {
  const kt = Math.max(0, Math.min(c.dur, local));
  let fx = NO_FX;
  if (c.tin && local < c.tin.dur) fx = combine(fx, transitionState(c.tin.type, local / c.tin.dur, "in"));
  if (c.tout && local > c.dur - c.tout.dur) fx = combine(fx, transitionState(c.tout.type, (c.dur - local) / c.tout.dur, "out"));
  // format 3: keyframes inside crop / mask / text / shape are resolved here, so the compositor sees plain values
  const rc = resolveClip(c, kt);
  const layer = {
    clip: rc,
    type: c.type,
    local,
    // behaviors (scene/rig.js: wiggle, loop, spin) apply on top of the keyframes
    x: propAt(c, "x", kt),
    y: propAt(c, "y", kt),
    sx: propAt(c, "sx", kt),
    sy: propAt(c, "sy", kt),
    rot: propAt(c, "rot", kt),
    ax: c.ax === undefined && !c.beh ? 0 : propAt(c, "ax", kt) || 0,
    ay: c.ay === undefined && !c.beh ? 0 : propAt(c, "ay", kt) || 0,
    opacity: Math.max(0, Math.min(1, propAt(c, "opacity", kt) * fx.alpha)),
    blend: c.blend,
    crop: rc.crop,
    mask: rc.mask,
    effects: c.effects.filter((e) => e.on).map((e) => ({ type: e.type, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, kt)])) })),
    fx,
    textAnim: c.type === "text" ? textAnimState(c.text.anim, local, c.dur) : null,
  };
  if (c.in !== undefined) layer.time = sourceTime(c, local);
  return layer;
}

/** A layer of a parented clip carries its parents' matrix `pm` (scene/rig.js ▸ parentMatrix). */
export function withParent(m, layer, c, t) {
  if (c.parent && m.clips[c.parent]) layer.pm = parentMatrix(m, c, t);
  return layer;
}

/** Source time of a media or composition clip at clip-local time: in + local × speed, or the time remap. */
export function sourceTime(c, local) {
  if (c.remap !== undefined) return Math.max(0, valueAt(c.remap, Math.max(0, Math.min(c.dur, local))));
  return c.in + local * c.speed;
}

/**
 * The picture layers of a sequence at time t, bottom first. Hidden tracks are skipped. A clip whose successor on
 * the same track starts with a "dissolve" stays visible under it for the length of that transition (cross dissolve).
 */
export function frameState(model, t, { seq = "main" } = {}) {
  const m = sequence(model, seq);
  const layers = [];
  const eps = 1e-6;
  const byTrack = new Map();
  for (const c of clipList(m)) {
    if (c.type === "audio" || c.off) continue;
    if (!byTrack.has(c.track)) byTrack.set(c.track, []);
    byTrack.get(c.track).push(c);
  }
  const tracks = videoTracks(m);
  const solo = tracks.some((k) => k.solo);
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tk = tracks[i];
    if (tk.hidden || (solo && !tk.solo)) continue;
    const list = byTrack.get(tk.id) || [];
    for (let j = 0; j < list.length; j++) {
      const c = list[j];
      if (t >= c.start - eps && t < clipEnd(c) - eps) {
        // the outgoing clip of a cross dissolve is drawn first (below)
        const prev = list[j - 1];
        if (prev && c.tin?.type === "dissolve" && Math.abs(clipEnd(prev) - c.start) < eps && t - c.start < c.tin.dur) layers.push(withParent(m, layerAt({ ...prev, tout: null }, t - prev.start), prev, t));
        layers.push(withParent(m, layerAt(c, t - c.start), c, t));
      }
    }
  }
  return { width: m.width, height: m.height, background: seq === "main" || !seq ? model.background : null, t, layers };
}

/** Gain of an audio-carrying clip at clip-local time: volume keyframes times the fades. */
export function gainAt(c, local) {
  if (c.muted) return 0;
  let g = Math.max(0, valueAt(c.volume ?? 1, Math.max(0, Math.min(c.dur, local))));
  if (c.fadeIn > 0 && local < c.fadeIn) g *= Math.max(0, local / c.fadeIn);
  if (c.fadeOut > 0 && local > c.dur - c.fadeOut) g *= Math.max(0, (c.dur - local) / c.fadeOut);
  return g;
}

/** The clips that produce sound at time t (audio clips and comp clips are resolved by the audio engine). */
export function audibleAt(model, t, { seq = "main" } = {}) {
  const m = sequence(model, seq);
  const muted = silentTracks(m);
  return clipList(m).filter((c) => (c.type === "audio" || c.type === "comp") && !c.off && !muted.has(c.track) && t >= c.start && t < clipEnd(c));
}

/** Ids of the tracks that are not heard: muted ones, and the others of a kind when a track of that kind is soloed. */
export function silentTracks(m) {
  const out = new Set();
  for (const kind of ["video", "audio"]) {
    const list = m.tracks.filter((k) => k.kind === kind);
    const solo = list.some((k) => k.solo);
    for (const k of list) if (k.muted || (solo && !k.solo)) out.add(k.id);
  }
  return out;
}

/**
 * The sound of a sequence as flat voices, compositions resolved (their sound passes through): one voice per audio
 * clip that is heard, in the time of sequence `seq`:
 *   { id, media, start, dur, in, speed, effects, gain(local) → number, pan(local) → -1..1, animated }
 * `id` is the path of clip ids ("comp clip/inner clip"), `local` is seconds since the voice's start. A composition
 * clip's speed multiplies, its trim cuts, its volume, fades and pan apply on top. Composition clips with time
 * remapping are silent (their picture is remapped; the sound would need resampling). Pure (unit-tested).
 */
export function flattenAudio(model, { seq = "main", depth = 0 } = {}) {
  const m = sequence(model, seq);
  const muted = silentTracks(m);
  const out = [];
  for (const c of clipList(m)) {
    if (c.muted || c.off || muted.has(c.track)) continue;
    if (c.type === "audio") {
      out.push({
        id: c.id,
        media: c.media,
        start: c.start,
        dur: c.dur,
        in: c.in,
        speed: c.speed,
        effects: c.effects,
        gain: (l) => gainAt(c, l),
        pan: (l) => Math.max(-1, Math.min(1, valueAt(c.pan, Math.max(0, Math.min(c.dur, l))))),
        animated: isTrack(c.volume) || isTrack(c.pan) || !!c.fadeIn || !!c.fadeOut,
      });
    } else if (c.type === "comp" && c.remap === undefined && depth < MAX_NESTING && model.comps?.[c.comp]) {
      for (const v of flattenAudio(model, { seq: c.comp, depth: depth + 1 })) {
        // the voice in composition time [v.start, v.start + v.dur) seen through the clip's window [in, in + dur·speed)
        const a = Math.max(v.start, c.in);
        const b = Math.min(v.start + v.dur, c.in + c.dur * c.speed);
        if (b - a <= 1e-6) continue;
        const head = a - v.start; // composition seconds cut from the voice's start
        const start = c.start + (a - c.in) / c.speed;
        const speed = v.speed * c.speed;
        out.push({
          id: `${c.id}/${v.id}`,
          media: v.media,
          start,
          dur: (b - a) / c.speed,
          in: v.in + head * v.speed,
          speed,
          effects: v.effects,
          gain: (l) => v.gain(head + l * c.speed) * gainAt(c, start - c.start + l),
          pan: (l) => Math.max(-1, Math.min(1, v.pan(head + l * c.speed) + valueAt(c.pan, Math.max(0, Math.min(c.dur, start - c.start + l))))),
          animated: v.animated || isTrack(c.volume) || isTrack(c.pan) || !!c.fadeIn || !!c.fadeOut || c.volume !== 1 || c.pan !== 0,
        });
      }
    }
  }
  return out;
}
