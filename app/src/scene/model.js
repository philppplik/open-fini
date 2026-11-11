// Scene Studio model (docs/scene-studio.md ▸ Data model). Pure: no DOM, no app state; unit-tested in
// tests/scene/model.test.js. Models are immutable values: every operation returns a new model and keeps unchanged
// clips (the renderer and the timeline cache by object identity).
//
// Model (a sequence plus its media and pre-compositions)
//   { version: 2, title, width, height, fps, background: "#000000",
//     tracks: [{ id, kind: "video"|"audio", name, muted, hidden, locked }]   display order, top first; the LAST video
//                                                                           track is the bottom layer of the picture
//     clips: { <id>: Clip }, markers: [{ id, t, name, color }], range: { in, out } | null (I/O marks),
//     comps: { <id>: { id, name, width, height, tracks, clips, markers } }   pre-compositions: the same shape as a
//                                                    sequence; their clips may use other compositions (nesting) but
//                                                    never themselves (cycles are refused and repaired on load)
//     media: { <id>: { id, kind: "video"|"audio"|"image", mime, name, duration, w, h, hasAudio, bytes } },
//     analysis: { <mediaId>: { transcript?, shots?, silence?, beats?, loudness? } }   see scene/analysis.js }
// Clip
//   { id, track, type: "video"|"audio"|"image"|"text"|"shape"|"solid"|"adjustment"|"comp", name,
//     start, dur          seconds on the timeline (always on the frame grid)
//     in, speed           source offset in seconds and playback rate (media and comp clips)
//     media | comp        id of the source
//     x, y                center of the layer in sequence pixels      ┐
//     sx, sy              scale (1 = 100 %)                           │ animatable: a constant or a keyframe track
//     rot                 degrees clockwise                           │ (scene/keyframes.js); keyframe times are
//     opacity             0..1                                        │ seconds from the clip start
//     volume, pan         gain (1 = unchanged) and -1..1              │
//     remap               composition clips only, optional: source    ┘
//                         time in seconds (time remapping; replaces in + local × speed; a constant freezes a frame)
//     collapse            composition clips: true = collapse transformations (the nested layers are drawn straight
//                         into this sequence at its resolution, not clipped to the composition's frame); default off
//     crop: { l, t, r, b }  fractions of the source cut away, blend: canvas blend mode,
//     effects: [{ id, type, on, p: { <param>: animatable } }]   (scene/effects.js),
//     mask: { shape: "rect"|"ellipse", x, y, w, h (fractions of the layer box), feather, invert } | null,
//     tin, tout: { type, dur } | null   transitions at the clip's edges (scene/evaluate.js ▸ TRANSITIONS),
//     fadeIn, fadeOut     audio fades in seconds, muted,
//     text: { text, font, size, weight, italic, color, align, lineHeight, tracking, stroke, strokeW, bg, bgPad,
//             bgRadius, shadow, boxW, anim: { in, inDur, out, outDur } }, caption: true for subtitle clips,
//     shape: { kind: "rect"|"ellipse"|"line"|"polygon"|"star", w, h, fill, stroke, strokeW, radius, points },
//     color               solid color }
// Invariants: clips of one track never overlap (placing a clip overwrites what it covers); `start` and `dur` are
// multiples of 1 / fps; a media clip never reads past its source (`in + dur * speed <= duration`); ids are unique in
// their sequence; the root sequence is addressed as "main", a pre-composition by its id; no composition reaches
// itself through its clips.
// Format history (normalizeScene migrates): 1 = first release; 2 = Bezier tangents on keyframes (i, o, b), the
// bounce and elastic easings, nested compositions, remap and collapse on composition clips, sound of compositions.
// Every addition is optional, so a version 1 file loads unchanged and evaluates to the same frames.
import { valueAt, isTrack, setKeyframe as kfSet, removeKeyframe as kfRemove, retime, normalizeValue, applyEasing, setTangents as kfTangents, tangentsOf, moveKeys } from "./keyframes.js";

export const SCENE_VERSION = 2;
export const CLIP_TYPES = ["video", "audio", "image", "text", "shape", "solid", "adjustment", "comp"];
export const VISUAL_TYPES = ["video", "image", "text", "shape", "solid", "adjustment", "comp"];
export const ANIMATABLE = ["x", "y", "sx", "sy", "rot", "opacity", "volume", "pan", "remap"];
/** Deepest nesting of compositions that is rendered (a guard; cycles are impossible). */
export const MAX_NESTING = 16;
export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "lighter"];
export const TRANSITION_TYPES = ["fade", "dissolve", "dip-black", "dip-white", "slide-left", "slide-right", "slide-up", "slide-down", "wipe-left", "wipe-right", "wipe-up", "wipe-down", "zoom", "blur"];
export const TEXT_ANIMS = ["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "typewriter", "chars", "words", "blur"];
export const SHAPE_KINDS = ["rect", "ellipse", "line", "polygon", "star"];
export const PRESETS = {
  "1080p": { width: 1920, height: 1080, fps: 30, label: "Full HD 16:9 (1920 × 1080)" },
  "4k": { width: 3840, height: 2160, fps: 30, label: "4K UHD 16:9 (3840 × 2160)" },
  "720p": { width: 1280, height: 720, fps: 30, label: "HD 16:9 (1280 × 720)" },
  vertical: { width: 1080, height: 1920, fps: 30, label: "Vertical 9:16 (1080 × 1920)" },
  square: { width: 1080, height: 1080, fps: 30, label: "Square 1:1 (1080 × 1080)" },
  portrait: { width: 1080, height: 1350, fps: 30, label: "Portrait 4:5 (1080 × 1350)" },
};
const ID_RE = /^[\w-]{1,64}$/;
const MAX_CLIPS = 20000;

let seq = 0;
/** A short random id (unique enough across collaborators). */
export function newId(prefix = "c") {
  let r = "";
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(2);
    c.getRandomValues(a);
    r = a[0].toString(36) + a[1].toString(36).slice(0, 3);
  } else r = Math.random().toString(36).slice(2, 11);
  return `${prefix}${r}${(seq++ % 36).toString(36)}`;
}
export const isId = (id) => typeof id === "string" && ID_RE.test(id);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hex = (c, d) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : d);

// ---------------------------------------------------------------------------------------------- basics

/** Snaps a time to the frame grid of the sequence. */
export const snapT = (m, t) => Math.max(0, Math.round(num(t) * m.fps) / m.fps);
export const frameOf = (m, t) => Math.round(num(t) * m.fps);
export const clipEnd = (c) => c.start + c.dur;

/** "00:01:23:12" (hours:minutes:seconds:frames) of a time. */
export function timecode(m, t) {
  const fps = Math.round(m.fps) || 30;
  const f = Math.max(0, Math.round(num(t) * m.fps));
  const p = (n) => String(n).padStart(2, "0");
  const s = Math.floor(f / fps);
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f % fps)}`;
}

/** Parses "1:23", "83.5", "00:01:23:12" (the last part is frames when there are four) into seconds. */
export function parseTime(m, s) {
  if (typeof s === "number") return Math.max(0, s);
  const parts = String(s).trim().split(":").map((x) => +x);
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return NaN;
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / m.fps;
  return parts.reduce((a, x) => a * 60 + x, 0);
}

function track(kind, n) {
  return { id: newId("t"), kind, name: `${kind === "video" ? "V" : "A"}${n}`, muted: false, hidden: false, locked: false };
}

export function emptyScene({ title = "", preset = "1080p", width, height, fps } = {}) {
  const p = PRESETS[preset] || PRESETS["1080p"];
  return {
    version: SCENE_VERSION,
    title,
    width: clamp(Math.round(num(width, p.width)), 16, 8192),
    height: clamp(Math.round(num(height, p.height)), 16, 8192),
    fps: clamp(num(fps, p.fps), 1, 120),
    background: "#000000",
    tracks: [track("video", 2), track("video", 1), track("audio", 1), track("audio", 2)],
    clips: {},
    markers: [],
    range: null,
    comps: {},
    media: {},
    analysis: {},
  };
}

/** The sequence addressed by `seqId`: the model itself for "main" (or nothing), else a pre-composition. */
export function sequence(model, seqId = "main") {
  if (!seqId || seqId === "main") return model;
  const c = model.comps?.[seqId];
  if (!c) throw new Error(`There is no composition “${seqId}”.`);
  return { ...c, fps: model.fps, media: model.media, comps: model.comps };
}

/** Applies `fn(sequence) → sequence` to the root or to a pre-composition and returns the new model. */
export function inSequence(model, seqId, fn) {
  if (!seqId || seqId === "main") return fn(model);
  return commitSequence(model, seqId, fn(sequence(model, seqId)));
}

/**
 * Writes an edited sequence (from sequence(model, seqId) and the operations below) back into the model. Media and
 * compositions the operation added or removed (import, pre-compose inside a composition) are kept.
 */
export function commitSequence(model, seqId, next) {
  if (!seqId || seqId === "main") return next;
  const { fps: _f, media, comps, analysis: _a, version: _v, title: _t, background: _b, range: _r, ...comp } = next;
  return { ...model, media: media || model.media, comps: { ...(comps || model.comps), [seqId]: comp } };
}

// ---------------------------------------------------------------------------------------------- compositions

/** Ids of the compositions the clips of a sequence (or composition) use directly. */
export const compRefs = (s) => [...new Set(Object.values(s?.clips || {}).filter((c) => c.type === "comp").map((c) => c.comp))];

/** True when composition `compId` is `target` or uses it, directly or through nested compositions. */
export function compReaches(comps, compId, target) {
  const seen = new Set();
  const stack = [compId];
  while (stack.length) {
    const id = stack.pop();
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...compRefs(comps?.[id]));
  }
  return false;
}

/** True when placing composition `compId` into sequence `seqId` ("main" or a composition id) would make a cycle. */
export const wouldCycle = (model, seqId, compId) => !!seqId && seqId !== "main" && compReaches(model.comps, compId, seqId);

/** Where a composition is used: [{ seq, clip }] over the root and every composition. */
export function compUsage(model, compId) {
  const out = [];
  for (const [seq, s] of [["main", model], ...Object.entries(model.comps || {})]) for (const c of Object.values(s.clips)) if (c.type === "comp" && c.comp === compId) out.push({ seq, clip: c.id });
  return out;
}

/** A new, empty composition (one video and one audio track). Sizes default to the sequence's. @returns {{ model, id }} */
export function addComp(model, { name = "Composition", width, height } = {}) {
  const id = newId("k");
  const comp = {
    id,
    name: String(name).slice(0, 120) || "Composition",
    width: clamp(Math.round(num(width, model.width)), 16, 8192),
    height: clamp(Math.round(num(height, model.height)), 16, 8192),
    tracks: [track("video", 1), track("audio", 1)],
    clips: {},
    markers: [],
  };
  return { model: { ...model, comps: { ...model.comps, [id]: comp } }, id };
}

/** Renames or resizes a composition. */
export function updateComp(model, id, patch = {}) {
  const k = model.comps?.[id];
  if (!k) throw new Error(`There is no composition “${id}”.`);
  const n = { ...k };
  if (patch.name !== undefined) n.name = String(patch.name).slice(0, 120) || k.name;
  if (patch.width !== undefined) n.width = clamp(Math.round(num(patch.width, k.width)), 16, 8192);
  if (patch.height !== undefined) n.height = clamp(Math.round(num(patch.height, k.height)), 16, 8192);
  return { ...model, comps: { ...model.comps, [id]: n } };
}

/** Deletes a composition and every clip that uses it (in all sequences). */
export function removeComp(model, id) {
  if (!model.comps?.[id]) return model;
  const strip = (clips) => Object.fromEntries(Object.entries(clips).filter(([, c]) => !(c.type === "comp" && c.comp === id)));
  const { [id]: _gone, ...rest } = model.comps;
  return { ...model, clips: strip(model.clips), comps: Object.fromEntries(Object.entries(rest).map(([k, c]) => [k, { ...c, clips: strip(c.clips) }])) };
}

/** Places a composition as a clip (its full length) in a sequence. @returns {{ model, id }} */
export function placeComp(m, compId, { start = null, track: trackId = null } = {}) {
  const k = m.comps?.[compId];
  if (!k) throw new Error(`There is no composition “${compId}”.`);
  return addClip(m, { type: "comp", comp: compId, start: start === null ? duration(m) : start, dur: duration(k) || 5, track: trackId || undefined, name: k.name });
}

export const clipList = (m) => Object.values(m.clips).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
export const trackClips = (m, trackId) => clipList(m).filter((c) => c.track === trackId);
export const trackOf = (m, id) => m.tracks.find((t) => t.id === id) || null;
export const videoTracks = (m) => m.tracks.filter((t) => t.kind === "video");
export const audioTracks = (m) => m.tracks.filter((t) => t.kind === "audio");

/** End of the last clip (0 for an empty sequence). */
export function duration(m) {
  let d = 0;
  for (const c of Object.values(m.clips)) if (clipEnd(c) > d) d = clipEnd(c);
  return d;
}

const isAudioType = (type) => type === "audio";
const trackKindFor = (type) => (isAudioType(type) ? "audio" : "video");

// ---------------------------------------------------------------------------------------------- clips

const TEXT_DEFAULTS = { text: "Text", font: "Inter", size: 96, weight: 700, italic: false, color: "#ffffff", align: "center", lineHeight: 1.15, tracking: 0, stroke: null, strokeW: 0, bg: null, bgPad: 16, bgRadius: 8, shadow: false, boxW: 0, anim: { in: "none", inDur: 0.5, out: "none", outDur: 0.5 } };
const SHAPE_DEFAULTS = { kind: "rect", w: 400, h: 240, fill: "#3b82f6", stroke: null, strokeW: 0, radius: 0, points: 5 };

function normText(tx = {}) {
  const a = tx.anim || {};
  return {
    text: String(tx.text ?? TEXT_DEFAULTS.text).slice(0, 5000),
    font: String(tx.font || TEXT_DEFAULTS.font).slice(0, 80),
    size: clamp(num(tx.size, TEXT_DEFAULTS.size), 4, 2000),
    weight: clamp(Math.round(num(tx.weight, TEXT_DEFAULTS.weight) / 100) * 100, 100, 900),
    italic: !!tx.italic,
    color: hex(tx.color, TEXT_DEFAULTS.color),
    align: ["left", "center", "right"].includes(tx.align) ? tx.align : "center",
    lineHeight: clamp(num(tx.lineHeight, 1.15), 0.6, 4),
    tracking: clamp(num(tx.tracking, 0), -50, 400),
    stroke: hex(tx.stroke, null),
    strokeW: clamp(num(tx.strokeW, 0), 0, 200),
    bg: hex(tx.bg, null),
    bgPad: clamp(num(tx.bgPad, 16), 0, 400),
    bgRadius: clamp(num(tx.bgRadius, 8), 0, 400),
    shadow: !!tx.shadow,
    boxW: clamp(num(tx.boxW, 0), 0, 16000),
    anim: {
      in: TEXT_ANIMS.includes(a.in) ? a.in : "none",
      inDur: clamp(num(a.inDur, 0.5), 0.05, 20),
      out: TEXT_ANIMS.includes(a.out) ? a.out : "none",
      outDur: clamp(num(a.outDur, 0.5), 0.05, 20),
    },
  };
}

function normShape(s = {}) {
  return {
    kind: SHAPE_KINDS.includes(s.kind) ? s.kind : "rect",
    w: clamp(num(s.w, 400), 1, 16000),
    h: clamp(num(s.h, 240), 1, 16000),
    fill: s.fill === null ? null : hex(s.fill, SHAPE_DEFAULTS.fill),
    stroke: hex(s.stroke, null),
    strokeW: clamp(num(s.strokeW, 0), 0, 400),
    radius: clamp(num(s.radius, 0), 0, 8000),
    points: clamp(Math.round(num(s.points, 5)), 3, 64),
  };
}

function normTransition(tr) {
  if (!tr || !TRANSITION_TYPES.includes(tr.type)) return null;
  return { type: tr.type, dur: clamp(num(tr.dur, 0.5), 0.04, 30) };
}

function normEffect(e) {
  if (!e || typeof e.type !== "string" || !/^[a-z][\w-]{0,31}$/.test(e.type)) return null;
  const p = {};
  for (const [k, v] of Object.entries(e.p || {}).slice(0, 32)) {
    const nv = normalizeValue(v, undefined);
    if (nv !== undefined && /^[\w-]{1,32}$/.test(k)) p[k] = nv;
  }
  return { id: isId(e.id) ? e.id : newId("fx"), type: e.type, on: e.on !== false, p };
}

function normMask(k) {
  if (!k || !["rect", "ellipse"].includes(k.shape)) return null;
  return { shape: k.shape, x: clamp(num(k.x, 0), -2, 2), y: clamp(num(k.y, 0), -2, 2), w: clamp(num(k.w, 1), 0.001, 4), h: clamp(num(k.h, 1), 0.001, 4), feather: clamp(num(k.feather, 0), 0, 500), invert: !!k.invert };
}

/** A complete, valid clip from partial or untrusted props (does not check the track or the source). */
export function normalizeClip(m, c) {
  const type = CLIP_TYPES.includes(c.type) ? c.type : "solid";
  const out = {
    id: isId(c.id) ? c.id : newId("c"),
    track: String(c.track || ""),
    type,
    name: String(c.name || "").slice(0, 200),
    start: snapT(m, c.start),
    dur: Math.max(1 / m.fps, snapT(m, num(c.dur, 5))),
  };
  if (["video", "audio", "comp"].includes(type)) {
    out.in = Math.max(0, num(c.in, 0));
    out.speed = clamp(num(c.speed, 1), 0.05, 20);
  }
  if (type === "video" || type === "audio" || type === "image") out.media = String(c.media || "");
  if (type === "comp") {
    out.comp = String(c.comp || "");
    const remap = c.remap === undefined || c.remap === null ? undefined : normalizeValue(c.remap, undefined);
    if (typeof remap === "number" || isTrack(remap)) out.remap = typeof remap === "number" ? Math.max(0, remap) : remap;
    if (c.collapse) out.collapse = true;
  }
  if (type !== "audio") {
    out.x = normalizeValue(c.x, m.width / 2);
    out.y = normalizeValue(c.y, m.height / 2);
    out.sx = normalizeValue(c.sx, 1);
    out.sy = normalizeValue(c.sy, 1);
    out.rot = normalizeValue(c.rot, 0);
    out.opacity = normalizeValue(c.opacity, 1);
    out.blend = BLEND_MODES.includes(c.blend) ? c.blend : "normal";
    const cr = c.crop || {};
    out.crop = { l: clamp(num(cr.l), 0, 0.99), t: clamp(num(cr.t), 0, 0.99), r: clamp(num(cr.r), 0, 0.99), b: clamp(num(cr.b), 0, 0.99) };
    out.mask = normMask(c.mask);
    out.tin = normTransition(c.tin);
    out.tout = normTransition(c.tout);
  }
  out.effects = (Array.isArray(c.effects) ? c.effects : []).slice(0, 32).map(normEffect).filter(Boolean);
  if (type === "audio" || type === "comp") {
    out.volume = normalizeValue(c.volume, 1);
    out.pan = normalizeValue(c.pan, 0);
    out.fadeIn = clamp(num(c.fadeIn, 0), 0, 600);
    out.fadeOut = clamp(num(c.fadeOut, 0), 0, 600);
    out.muted = !!c.muted;
  }
  if (type === "text") {
    out.text = normText(c.text);
    if (c.caption) out.caption = true;
  }
  if (type === "shape") out.shape = normShape(c.shape);
  if (type === "solid") out.color = hex(c.color, "#1f2937");
  return out;
}

/** Normalizes a stored or foreign model: drops what is invalid, never throws on bad input. */
export function normalizeScene(raw) {
  const base = emptyScene({ title: String(raw?.title || ""), width: raw?.width, height: raw?.height, fps: raw?.fps });
  const media = {};
  for (const [id, x] of Object.entries(raw?.media || {})) {
    if (!isId(id) || !x) continue;
    const kind = ["video", "audio", "image"].includes(x.kind) ? x.kind : /^video\//.test(x.mime) ? "video" : /^audio\//.test(x.mime) ? "audio" : "image";
    media[id] = { id, kind, mime: String(x.mime || ""), name: String(x.name || ""), duration: Math.max(0, num(x.duration)), w: Math.max(0, num(x.w)), h: Math.max(0, num(x.h)), hasAudio: x.hasAudio ?? kind !== "image", ...(x.bytes ? { bytes: x.bytes } : {}) };
  }
  const normSeq = (s, shell) => {
    const m = { ...shell, fps: base.fps, media };
    const tracks = (Array.isArray(s?.tracks) ? s.tracks : [])
      .filter((t) => t && isId(t.id) && ["video", "audio"].includes(t.kind))
      .map((t) => ({ id: t.id, kind: t.kind, name: String(t.name || "").slice(0, 40) || (t.kind === "video" ? "V" : "A"), muted: !!t.muted, hidden: !!t.hidden, locked: !!t.locked }));
    const useTracks = tracks.length ? [...tracks.filter((t) => t.kind === "video"), ...tracks.filter((t) => t.kind === "audio")] : base.tracks;
    const ids = new Set(useTracks.map((t) => t.id));
    const clips = {};
    for (const c of Object.values(s?.clips || {}).slice(0, MAX_CLIPS)) {
      if (!c || !ids.has(c.track)) continue;
      const n = normalizeClip(m, c);
      const tk = useTracks.find((t) => t.id === n.track);
      if (tk.kind !== trackKindFor(n.type) || clips[n.id]) continue;
      if (n.media !== undefined && !media[n.media]) continue;
      clips[n.id] = n;
    }
    const markers = (Array.isArray(s?.markers) ? s.markers : [])
      .filter((k) => k && Number.isFinite(+k.t))
      .slice(0, 2000)
      .map((k) => ({ id: isId(k.id) ? k.id : newId("m"), t: Math.max(0, +k.t), name: String(k.name || "").slice(0, 200), color: hex(k.color, "#f59e0b") }))
      .sort((a, b) => a.t - b.t);
    return { tracks: useTracks, clips, markers };
  };
  const root = normSeq(raw, { width: base.width, height: base.height });
  const comps = {};
  for (const [id, c] of Object.entries(raw?.comps || {})) {
    if (!isId(id) || !c) continue;
    const width = clamp(Math.round(num(c.width, base.width)), 16, 8192);
    const height = clamp(Math.round(num(c.height, base.height)), 16, 8192);
    comps[id] = { id, name: String(c.name || "Composition").slice(0, 120), width, height, ...normSeq(c, { width, height }) };
  }
  for (const s of [root, ...Object.values(comps)]) for (const c of Object.values(s.clips)) if (c.type === "comp" && !comps[c.comp]) delete s.clips[c.id];
  // format 2: compositions may nest, but a composition never reaches itself; a foreign file with a cycle loses the
  // clips that close it (in a stable order, so every collaborator repairs it the same way)
  for (const k of Object.values(comps).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const c of Object.values(k.clips).sort((a, b) => (a.id < b.id ? -1 : 1))) if (c.type === "comp" && compReaches(comps, c.comp, k.id)) delete k.clips[c.id];
  }
  const analysis = {};
  for (const [id, a] of Object.entries(raw?.analysis || {})) if (media[id] && a && typeof a === "object") analysis[id] = a;
  const r = raw?.range;
  return {
    ...base,
    background: hex(raw?.background, "#000000"),
    ...root,
    range: r && Number.isFinite(+r.in) && Number.isFinite(+r.out) && +r.out > +r.in ? { in: +r.in, out: +r.out } : null,
    comps,
    media,
    analysis,
  };
}

/** Natural size of a clip's layer before scaling (media pixels after crop, shape box, sequence for solids). */
export function layerSize(m, c, textSize) {
  if (c.type === "video" || c.type === "image") {
    const md = m.media[c.media];
    const w = md?.w || m.width;
    const h = md?.h || m.height;
    return { w: w * (1 - c.crop.l - c.crop.r), h: h * (1 - c.crop.t - c.crop.b) };
  }
  if (c.type === "comp") {
    const k = m.comps?.[c.comp];
    return { w: k?.width || m.width, h: k?.height || m.height };
  }
  if (c.type === "shape") return { w: c.shape.w, h: c.shape.h };
  if (c.type === "text") return textSize ? textSize(c.text) : { w: c.text.size * 0.55 * Math.max(1, ...c.text.text.split("\n").map((l) => l.length)), h: c.text.size * c.text.lineHeight * c.text.text.split("\n").length };
  return { w: m.width, h: m.height };
}

/** The clips of `trackId` that overlap [start, end), except `skip`. */
export function overlapping(m, trackId, start, end, skip = null) {
  const eps = 0.5 / m.fps;
  return trackClips(m, trackId).filter((c) => c.id !== skip && c.start < end - eps && clipEnd(c) > start + eps);
}

/** First track of `kind` that is free in [start, end), or null. */
export function freeTrack(m, kind, start, end) {
  const list = kind === "video" ? videoTracks(m).slice().reverse() : audioTracks(m);
  return list.find((t) => !t.locked && !overlapping(m, t.id, start, end).length) || null;
}

/** Maximum timeline duration a media or comp clip can have with its `in` and `speed` (Infinity for the others). */
export function maxDur(m, c) {
  if (c.type === "video" || c.type === "audio") {
    const d = m.media[c.media]?.duration;
    return d > 0 ? Math.max(1 / m.fps, (d - c.in) / c.speed) : Infinity;
  }
  if (c.type === "comp") {
    if (c.remap !== undefined) return Infinity; // time remapping decides what is shown (it holds at the ends)
    const k = m.comps?.[c.comp];
    const d = k ? duration({ clips: k.clips }) : 0;
    return d > 0 ? Math.max(1 / m.fps, (d - c.in) / c.speed) : Infinity;
  }
  return Infinity;
}

// Cuts a hole [start, end) into a track: clips inside are removed, clips that reach in are trimmed, a clip that
// spans the hole is split in two. `skip` is left alone.
function carve(m, trackId, start, end, skip) {
  let clips = m.clips;
  for (const o of overlapping(m, trackId, start, end, skip)) {
    const oe = clipEnd(o);
    clips = { ...clips };
    if (o.start >= start - 1e-6 && oe <= end + 1e-6) delete clips[o.id];
    else if (o.start < start && oe > end) {
      const [a, b] = cutAt(m, o, start);
      const [, tail] = cutAt(m, b, end);
      clips[a.id] = a;
      clips[tail.id] = tail;
    } else if (o.start < start) clips[o.id] = cutAt(m, o, start)[0];
    else {
      const tail = cutAt(m, o, end)[1];
      delete clips[o.id];
      clips[o.id] = { ...tail, id: o.id };
    }
  }
  return clips === m.clips ? m : { ...m, clips };
}

// Both halves of a clip cut at timeline time `t` (the first keeps the id). Keyframes are split with the value at the cut.
function cutAt(m, c, t) {
  const local = t - c.start;
  const a = { ...c, dur: local };
  const b = { ...c, id: newId("c"), start: t, dur: c.dur - local };
  if (c.in !== undefined) b.in = c.in + local * c.speed;
  if (c.tout) a.tout = null;
  if (c.tin) b.tin = null;
  if (c.fadeOut) a.fadeOut = 0;
  if (c.fadeIn) b.fadeIn = 0;
  const split = (v) => {
    if (!isTrack(v)) return [v, v];
    const at = valueAt(v, local);
    const left = v.kf.filter((k) => k.t < local - 1e-6);
    const right = v.kf.filter((k) => k.t > local + 1e-6).map((k) => ({ ...k, t: k.t - local }));
    const lastE = [...v.kf].reverse().find((k) => k.t <= local + 1e-6)?.e;
    const L = left.length ? { kf: [...left, { t: local, v: at }] } : at;
    const R = right.length ? { kf: [{ t: 0, v: at, ...(lastE ? { e: lastE } : {}) }, ...right] } : at;
    return [L, R];
  };
  for (const k of ANIMATABLE) if (c[k] !== undefined) [a[k], b[k]] = split(c[k]);
  if (c.effects?.length) {
    a.effects = c.effects.map((e) => ({ ...e, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, split(v)[0]])) }));
    b.effects = c.effects.map((e) => ({ ...e, id: newId("fx"), p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, split(v)[1]])) }));
  }
  return [a, b];
}

const must = (m, id) => {
  const c = m.clips[id];
  if (!c) throw new Error(`There is no clip “${id}”.`);
  return c;
};

/**
 * Adds a clip. `props.track` may be a track id; without it the first free track of the right kind is used (a new
 * one is added when all are busy). Whatever the clip covers on its track is overwritten.
 * @returns {{ model, id }}
 */
export function addClip(m, props) {
  if (Object.keys(m.clips).length >= MAX_CLIPS) throw new Error("This sequence has too many clips.");
  let c = normalizeClip(m, { ...props, id: props.id && !m.clips[props.id] ? props.id : undefined });
  if (c.media !== undefined && !m.media[c.media]) throw new Error(`There is no media item “${c.media}”. Import it first.`);
  if (c.type === "comp" && !m.comps?.[c.comp]) throw new Error(`There is no composition “${c.comp}”.`);
  if (c.type === "comp" && m.id && m.comps?.[m.id] && compReaches(m.comps, c.comp, m.id)) throw new Error(`“${m.comps[c.comp].name}” cannot be placed here: it contains this composition (a composition cannot contain itself).`);
  const kind = trackKindFor(c.type);
  let next = m;
  let tk = trackOf(m, c.track);
  if (tk && tk.kind !== kind) throw new Error(`A ${c.type} clip cannot go on ${kind === "video" ? "an audio" : "a video"} track.`);
  if (tk?.locked) throw new Error(`Track ${tk.name} is locked.`);
  c = { ...c, dur: Math.min(c.dur, snapT(m, maxDur(m, c)) || c.dur) };
  if (!tk) {
    tk = freeTrack(m, kind, c.start, clipEnd(c));
    if (!tk) {
      const r = addTrack(m, kind);
      next = r.model;
      tk = trackOf(next, r.id);
    }
  }
  c.track = tk.id;
  if (!c.name) c.name = m.media[c.media]?.name || (c.type === "text" ? c.text.text.split("\n")[0].slice(0, 40) : c.type === "comp" ? m.comps[c.comp].name : c.type[0].toUpperCase() + c.type.slice(1));
  next = carve(next, tk.id, c.start, clipEnd(c), null);
  return { model: { ...next, clips: { ...next.clips, [c.id]: c } }, id: c.id };
}

/** Changes properties of a clip (not its position: use moveClip / trimClip). */
export function updateClip(m, id, patch) {
  const c = must(m, id);
  const { id: _i, track: _t, start: _s, dur: _d, type: _y, ...rest } = patch || {};
  const merged = { ...c, ...rest };
  if (rest.text) merged.text = { ...c.text, ...rest.text, anim: { ...c.text?.anim, ...rest.text.anim } };
  if (rest.shape) merged.shape = { ...c.shape, ...rest.shape };
  if (rest.crop) merged.crop = { ...c.crop, ...rest.crop };
  const n = normalizeClip(m, merged);
  if (n.in !== undefined) n.dur = Math.min(n.dur, snapT(m, maxDur(m, n)) || n.dur);
  return { ...m, clips: { ...m.clips, [id]: n } };
}

/** Moves a clip in time and / or to another track of the same kind; what it lands on is overwritten. */
export function moveClip(m, id, { start, track: trackId } = {}) {
  const c = must(m, id);
  const tk = trackId ? trackOf(m, trackId) : trackOf(m, c.track);
  if (!tk) throw new Error(`There is no track “${trackId}”.`);
  if (tk.kind !== trackKindFor(c.type)) throw new Error("A clip can only move to a track of its own kind.");
  if (tk.locked) throw new Error(`Track ${tk.name} is locked.`);
  const moved = { ...c, track: tk.id, start: start === undefined ? c.start : snapT(m, start) };
  if (moved.start === c.start && moved.track === c.track) return m;
  const next = carve(m, tk.id, moved.start, clipEnd(moved), id);
  return { ...next, clips: { ...next.clips, [id]: moved } };
}

/**
 * Trims one edge of a clip to timeline time `to`. The start edge also moves the source in-point and the keyframes
 * so the picture stays in place. With `ripple` the later clips of the track follow (no gap, no overwrite).
 */
export function trimClip(m, id, edge, to, { ripple = false } = {}) {
  const c = must(m, id);
  const frame = 1 / m.fps;
  let n;
  let delta = 0; // how far the clip's end moved (ripple)
  if (edge === "start") {
    let s = snapT(m, to);
    s = Math.min(s, clipEnd(c) - frame);
    if (c.in !== undefined) s = Math.max(s, c.start - c.in / c.speed); // cannot reveal source before 0
    s = snapT(m, Math.max(0, s));
    const shift = s - c.start;
    if (!shift) return m;
    n = { ...c, dur: c.dur - shift, start: ripple ? c.start : s };
    if (c.in !== undefined) n.in = Math.max(0, c.in + shift * c.speed);
    for (const k of ANIMATABLE) if (n[k] !== undefined) n[k] = retime(n[k], { shift: -shift });
    n.effects = n.effects.map((e) => ({ ...e, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, retime(v, { shift: -shift })])) }));
    delta = ripple ? -shift : 0;
  } else {
    let e = Math.max(snapT(m, to), c.start + frame);
    e = Math.min(e, c.start + (snapT(m, maxDur(m, c)) || Infinity));
    if (e === clipEnd(c)) return m;
    n = { ...c, dur: snapT(m, e - c.start) };
    delta = ripple ? clipEnd(n) - clipEnd(c) : 0;
  }
  let clips = { ...m.clips, [id]: n };
  if (ripple && delta) {
    for (const o of trackClips(m, c.track)) if (o.id !== id && o.start >= clipEnd(c) - 1e-6) clips[o.id] = { ...o, start: snapT(m, o.start + delta) };
    return { ...m, clips };
  }
  const next = carve({ ...m, clips }, c.track, n.start, clipEnd(n), id);
  return next;
}

/** Splits a clip at timeline time `t`. Returns the model and the id of the new second half (null when `t` is outside). */
export function splitClip(m, id, t) {
  const c = must(m, id);
  const at = snapT(m, t);
  if (at <= c.start + 1e-6 || at >= clipEnd(c) - 1e-6) return { model: m, id: null };
  const [a, b] = cutAt(m, c, at);
  return { model: { ...m, clips: { ...m.clips, [a.id]: a, [b.id]: b } }, id: b.id };
}

/** Splits every clip under `t` (optionally only on some tracks). Returns the ids of the new halves. */
export function splitAll(m, t, trackIds = null) {
  const ids = [];
  let next = m;
  for (const c of clipList(m)) {
    if (trackIds && !trackIds.includes(c.track)) continue;
    if (trackOf(m, c.track)?.locked) continue;
    const r = splitClip(next, c.id, t);
    next = r.model;
    if (r.id) ids.push(r.id);
  }
  return { model: next, ids };
}

/** Deletes clips. With `ripple` the later clips of each track close the gap. */
export function deleteClips(m, ids, { ripple = false } = {}) {
  const gone = ids.map((id) => m.clips[id]).filter(Boolean);
  if (!gone.length) return m;
  const clips = { ...m.clips };
  for (const c of gone) delete clips[c.id];
  if (ripple) {
    for (const c of gone.sort((a, b) => b.start - a.start)) {
      for (const o of Object.values(clips)) if (o.track === c.track && o.start >= clipEnd(c) - 1e-6) clips[o.id] = { ...o, start: snapT(m, o.start - c.dur) };
    }
  }
  return { ...m, clips };
}

/**
 * Removes time ranges from the whole sequence and closes the gaps (ripple delete across all unlocked tracks):
 * the core of "cut the silences", "remove this sentence" and Extract. Ranges may be unsorted and overlapping.
 * @param {[number, number][]} ranges
 */
export function cutRanges(m, ranges) {
  const rs = mergeRanges(ranges.map(([a, b]) => [snapT(m, a), snapT(m, b)]).filter(([a, b]) => b > a));
  let next = m;
  for (const [a, b] of rs.slice().reverse()) {
    next = splitAll(splitAll(next, a).model, b).model;
    const clips = {};
    for (const c of Object.values(next.clips)) {
      if (trackOf(next, c.track)?.locked) clips[c.id] = c;
      else if (c.start >= a - 1e-6 && clipEnd(c) <= b + 1e-6) continue;
      else if (c.start >= b - 1e-6) clips[c.id] = { ...c, start: snapT(m, c.start - (b - a)) };
      else clips[c.id] = c;
    }
    const markers = next.markers.filter((k) => k.t < a || k.t >= b).map((k) => (k.t >= b ? { ...k, t: k.t - (b - a) } : k));
    next = { ...next, clips, markers };
  }
  return next;
}

/** Sorted, non-overlapping union of ranges. */
export function mergeRanges(ranges) {
  const s = ranges.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Keeps only the given ranges (the inverse of cutRanges): highlights, "keep what I marked". */
export function keepRanges(m, ranges) {
  const total = duration(m);
  const keep = mergeRanges(ranges.map(([a, b]) => [clamp(a, 0, total), clamp(b, 0, total)]).filter(([a, b]) => b > a));
  const cut = [];
  let pos = 0;
  for (const [a, b] of keep) {
    if (a > pos) cut.push([pos, a]);
    pos = b;
  }
  if (pos < total) cut.push([pos, total]);
  return cutRanges(m, cut);
}

/** Opens a gap of `dur` seconds at `t` on all unlocked tracks (clips under `t` are split). */
export function insertGap(m, t, dur) {
  const at = snapT(m, t);
  const d = snapT(m, dur);
  if (!(d > 0)) return m;
  const next = splitAll(m, at).model;
  const clips = {};
  for (const c of Object.values(next.clips)) clips[c.id] = c.start >= at - 1e-6 && !trackOf(next, c.track)?.locked ? { ...c, start: c.start + d } : c;
  return { ...next, clips, markers: next.markers.map((k) => (k.t >= at ? { ...k, t: k.t + d } : k)) };
}

/** Closes every gap on a track (or on all unlocked tracks) from `from` on. */
export function closeGaps(m, trackId = null, from = 0) {
  const clips = { ...m.clips };
  for (const tk of m.tracks) {
    if ((trackId && tk.id !== trackId) || tk.locked) continue;
    let pos = null;
    for (const c of trackClips(m, tk.id)) {
      if (clipEnd(c) <= from) continue;
      if (pos === null) pos = c.start < from ? clipEnd(c) : Math.min(c.start, from);
      if (c.start >= from) {
        clips[c.id] = { ...c, start: snapT(m, pos) };
        pos = pos + c.dur;
      }
    }
  }
  return { ...m, clips };
}

/** Slips a clip: moves the source under the clip by `delta` seconds without moving the clip. */
export function slipClip(m, id, delta) {
  const c = must(m, id);
  if (c.in === undefined) return m;
  const max = Math.max(0, (m.media[c.media]?.duration ?? Infinity) - c.dur * c.speed);
  return { ...m, clips: { ...m.clips, [id]: { ...c, in: clamp(c.in + num(delta), 0, max) } } };
}

/** Changes the speed of a clip; the duration follows (and with `ripple` the later clips of the track too). */
export function setSpeed(m, id, speed, { ripple = false } = {}) {
  const c = must(m, id);
  if (c.speed === undefined) throw new Error("Only video, audio and composition clips have a speed.");
  const s = clamp(num(speed, 1), 0.05, 20);
  const dur = Math.max(1 / m.fps, snapT(m, (c.dur * c.speed) / s));
  const scale = dur / c.dur;
  const n = { ...c, speed: s, dur };
  for (const k of ANIMATABLE) if (n[k] !== undefined) n[k] = retime(n[k], { scale });
  n.effects = n.effects.map((e) => ({ ...e, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, retime(v, { scale })])) }));
  let clips = { ...m.clips, [id]: n };
  if (ripple) {
    const d = dur - c.dur;
    for (const o of trackClips(m, c.track)) if (o.id !== id && o.start >= clipEnd(c) - 1e-6) clips[o.id] = { ...o, start: snapT(m, o.start + d) };
    return { ...m, clips };
  }
  return carve({ ...m, clips }, c.track, n.start, clipEnd(n), id);
}

/** Copies of clips placed at `at` (default: right after the last original), keeping their relative offsets. */
export function duplicateClips(m, ids, at = null) {
  const src = ids.map((id) => m.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start);
  if (!src.length) return { model: m, ids: [] };
  const first = src[0].start;
  const base = at === null ? Math.max(...src.map(clipEnd)) : snapT(m, at);
  let next = m;
  const out = [];
  for (const c of src) {
    const r = addClip(next, { ...c, id: undefined, start: base + (c.start - first), effects: c.effects.map((e) => ({ ...e, id: undefined })) });
    next = r.model;
    out.push(r.id);
  }
  return { model: next, ids: out };
}

// ---------------------------------------------------------------------------------------------- animation and effects

// "x" | "opacity" … or "fx:<effect id>:<param>"
function propRef(c, path) {
  if (ANIMATABLE.includes(path)) {
    if (c[path] === undefined && !(path === "remap" && c.type === "comp")) throw new Error(`A ${c.type} clip has no “${path}” property.`);
    return { get: () => c[path], set: (v) => ({ ...c, [path]: v }) };
  }
  const m = /^fx:([\w-]+):([\w-]+)$/.exec(path);
  const fx = m && c.effects.find((e) => e.id === m[1]);
  if (!fx) throw new Error(`Unknown property “${path}”. Use one of ${ANIMATABLE.join(", ")} or fx:<effect id>:<parameter>.`);
  return { get: () => fx.p[m[2]], set: (v) => ({ ...c, effects: c.effects.map((e) => (e === fx ? { ...e, p: { ...e.p, [m[2]]: v } } : e)) }) };
}

/** Sets a keyframe of a clip property at timeline time `t` (clamped into the clip). */
export function setKeyframe(m, id, path, t, value, easing) {
  const c = must(m, id);
  const ref = propRef(c, path);
  const local = clamp(snapT(m, t) - c.start, 0, c.dur);
  return { ...m, clips: { ...m.clips, [id]: ref.set(kfSet(ref.get(), local, value, easing)) } };
}

export function removeKeyframe(m, id, path, t) {
  const c = must(m, id);
  const ref = propRef(c, path);
  return { ...m, clips: { ...m.clips, [id]: ref.set(kfRemove(ref.get(), clamp(snapT(m, t) - c.start, 0, c.dur))) } };
}

/** Sets a property to a constant (removes its animation) or, when it is animated, sets the keyframe at `t`. */
export function setProp(m, id, path, value, t = null) {
  const c = must(m, id);
  const ref = propRef(c, path);
  if (isTrack(ref.get()) && t !== null) return setKeyframe(m, id, path, t, value);
  return { ...m, clips: { ...m.clips, [id]: ref.set(value) } };
}

export function addEffect(m, id, type, params = {}) {
  const c = must(m, id);
  const fx = normEffect({ type, p: params });
  if (!fx) throw new Error(`“${type}” is not an effect.`);
  return { model: { ...m, clips: { ...m.clips, [id]: { ...c, effects: [...c.effects, fx] } } }, id: fx.id };
}

export function updateEffect(m, id, fxId, patch) {
  const c = must(m, id);
  if (!c.effects.some((e) => e.id === fxId)) throw new Error(`Clip “${id}” has no effect “${fxId}”.`);
  const effects = c.effects.map((e) => (e.id === fxId ? normEffect({ ...e, ...(patch.on === undefined ? {} : { on: patch.on }), p: { ...e.p, ...patch.p } }) : e));
  return { ...m, clips: { ...m.clips, [id]: { ...c, effects } } };
}

export function removeEffect(m, id, fxId) {
  const c = must(m, id);
  return { ...m, clips: { ...m.clips, [id]: { ...c, effects: c.effects.filter((e) => e.id !== fxId) } } };
}

/** Sets or clears (`type` = null) the transition at a clip's "in" or "out" edge. */
export function setTransition(m, id, edge, type, dur = 0.5) {
  const c = must(m, id);
  if (c.type === "audio") throw new Error("Audio clips use fadeIn and fadeOut instead of transitions.");
  const tr = type ? normTransition({ type, dur: Math.min(dur, c.dur) }) : null;
  if (type && !tr) throw new Error(`“${type}” is not a transition. Use one of: ${TRANSITION_TYPES.join(", ")}.`);
  return { ...m, clips: { ...m.clips, [id]: { ...c, [edge === "out" ? "tout" : "tin"]: tr } } };
}

// ---------------------------------------------------------------------------------------------- curves (graph editor, assistant)

/** The animated property paths of a clip ("x", …, "fx:<effect id>:<param>"), in panel order. */
export function animatedPaths(c) {
  const out = ANIMATABLE.filter((k) => isTrack(c[k]));
  for (const e of c.effects || []) for (const [k, v] of Object.entries(e.p)) if (isTrack(v)) out.push(`fx:${e.id}:${k}`);
  return out;
}

/** Applies `fn(track, clip) → track` to one animated property of a clip. */
export function editKeyframes(m, id, path, fn) {
  const c = must(m, id);
  const ref = propRef(c, path);
  const cur = ref.get();
  if (!isTrack(cur)) throw new Error(`“${path}” of clip “${id}” has no keyframes.`);
  const next = fn(cur, c);
  return next === cur ? m : { ...m, clips: { ...m.clips, [id]: ref.set(next) } };
}

// Indices of the keyframes at timeline times `at` (half a frame tolerance), or all keyframes for null.
function keyIndices(m, c, track, at) {
  if (at === null || at === undefined) return track.kf.map((_, i) => i);
  const list = (Array.isArray(at) ? at : [at]).map((x) => +x - c.start);
  const idx = track.kf.map((k, i) => (list.some((x) => Math.abs(k.t - x) < 0.5 / m.fps + 1e-6) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) throw new Error(`No keyframe of “${c.name || c.id}” at ${list.map((x) => +(x + c.start).toFixed(3)).join(", ")} s.`);
  return idx;
}

/**
 * Sets the easing of keyframes of a clip property: a preset (keyframes.js ▸ EASING_PRESETS: linear, easyEase,
 * easyEaseIn, easyEaseOut, hold, ease, easeIn, easeOut, easeInOut, back, bounce, elastic) or a cubic-bezier
 * [x1, y1, x2, y2]. `at` = timeline time(s) of the keyframes; null = every keyframe of the property.
 */
export function setEasing(m, id, path, preset, { at = null } = {}) {
  return editKeyframes(m, id, path, (tr, c) => applyEasing(tr, keyIndices(m, c, tr, at), preset));
}

/**
 * Sets the Bezier tangents of the keyframe at timeline time `t`: { in, out: [speed (units per second), influence
 * 0..1], broken }. Unified keyframes mirror the speed to the other side.
 */
export function setKeyframeTangents(m, id, path, t, tangents) {
  return editKeyframes(m, id, path, (tr, c) => {
    const [i] = keyIndices(m, c, tr, t);
    return kfTangents(tr, i, tangents);
  });
}

/** Moves the keyframes at timeline times `at` (null = all) by dt seconds (snapped to frames) and dv value units. */
export function moveKeyframes(m, id, path, at, dt = 0, dv = 0) {
  return editKeyframes(m, id, path, (tr, c) => {
    const d = Math.round(num(dt) * m.fps) / m.fps;
    return moveKeys(tr, keyIndices(m, c, tr, at), d, num(dv)).track;
  });
}

/** The keyframes of a clip property as plain data with timeline times and effective tangents. */
export function keyframesOf(m, id, path) {
  const c = must(m, id);
  const v = propRef(c, path).get();
  if (!isTrack(v)) return [];
  return v.kf.map((k, i) => {
    const tg = tangentsOf(v, i);
    return { t: r3(c.start + k.t), v: k.v, ...(k.e ? { e: k.e } : {}), ...(tg ? { in: tg.in && tg.in.map(r3), out: tg.out && tg.out.map(r3), ...(tg.broken ? { broken: true } : {}) } : {}) };
  });
}

/**
 * Turns time remapping of a composition clip on (keyframes at both ends reproduce its current timing) or off.
 * While on, the clip's source time is the "remap" property: keyframe it for speed ramps, freezes and reverse play.
 */
export function setTimeRemap(m, id, on) {
  const c = must(m, id);
  if (c.type !== "comp") throw new Error("Time remapping is available on composition clips.");
  if (!on) {
    const { remap: _r, ...rest } = c;
    return { ...m, clips: { ...m.clips, [id]: rest } };
  }
  if (c.remap !== undefined) return m;
  return { ...m, clips: { ...m.clips, [id]: { ...c, remap: { kf: [{ t: 0, v: c.in }, { t: c.dur, v: c.in + c.dur * c.speed }] } } } };
}

// ---------------------------------------------------------------------------------------------- tracks, markers, media

export function addTrack(m, kind, { name = "", index = null } = {}) {
  if (!["video", "audio"].includes(kind)) throw new Error("A track is “video” or “audio”.");
  if (m.tracks.length >= 99) throw new Error("A sequence has at most 99 tracks.");
  const same = m.tracks.filter((t) => t.kind === kind);
  const tk = { ...track(kind, same.length + 1), ...(name ? { name: String(name).slice(0, 40) } : {}) };
  const v = videoTracks(m);
  const a = audioTracks(m);
  // new video tracks go on top (index 0), new audio tracks at the bottom, unless an index within the kind is given
  if (kind === "video") v.splice(index === null ? 0 : clamp(index, 0, v.length), 0, tk);
  else a.splice(index === null ? a.length : clamp(index, 0, a.length), 0, tk);
  return { model: { ...m, tracks: [...v, ...a] }, id: tk.id };
}

export function removeTrack(m, id) {
  const tk = trackOf(m, id);
  if (!tk) return m;
  if (m.tracks.filter((t) => t.kind === tk.kind).length <= 1) throw new Error(`A sequence keeps at least one ${tk.kind} track.`);
  const clips = Object.fromEntries(Object.entries(m.clips).filter(([, c]) => c.track !== id));
  return { ...m, tracks: m.tracks.filter((t) => t.id !== id), clips };
}

export function updateTrack(m, id, patch) {
  if (!trackOf(m, id)) throw new Error(`There is no track “${id}”.`);
  const p = {};
  if (patch.name !== undefined) p.name = String(patch.name).slice(0, 40) || "Track";
  for (const k of ["muted", "hidden", "locked"]) if (patch[k] !== undefined) p[k] = !!patch[k];
  return { ...m, tracks: m.tracks.map((t) => (t.id === id ? { ...t, ...p } : t)) };
}

/** Moves a track by `delta` positions among the tracks of its kind. */
export function moveTrack(m, id, delta) {
  const tk = trackOf(m, id);
  if (!tk) return m;
  const same = m.tracks.filter((t) => t.kind === tk.kind);
  const i = same.indexOf(tk);
  const j = clamp(i + delta, 0, same.length - 1);
  if (i === j) return m;
  same.splice(i, 1);
  same.splice(j, 0, tk);
  return { ...m, tracks: tk.kind === "video" ? [...same, ...audioTracks(m)] : [...videoTracks(m), ...same] };
}

export function addMarker(m, t, name = "", color = "#f59e0b") {
  const k = { id: newId("m"), t: snapT(m, t), name: String(name).slice(0, 200), color: hex(color, "#f59e0b") };
  return { model: { ...m, markers: [...m.markers, k].sort((a, b) => a.t - b.t) }, id: k.id };
}
export const removeMarker = (m, id) => ({ ...m, markers: m.markers.filter((k) => k.id !== id) });

/** Sets or clears the In / Out range. */
export function setRange(m, a, b) {
  if (a === null || b === null || !(b > a)) return { ...m, range: null };
  return { ...m, range: { in: snapT(m, a), out: snapT(m, b) } };
}

/** Adds a media item (probed by scene/media.js). */
export function addMedia(m, item) {
  const id = isId(item.id) && !m.media[item.id] ? item.id : newId("md");
  const kind = ["video", "audio", "image"].includes(item.kind) ? item.kind : "image";
  const md = { id, kind, mime: String(item.mime || ""), name: String(item.name || "Media").slice(0, 200), duration: Math.max(0, num(item.duration)), w: Math.max(0, num(item.w)), h: Math.max(0, num(item.h)), hasAudio: item.hasAudio ?? kind !== "image", ...(item.bytes ? { bytes: item.bytes } : {}) };
  return { model: { ...m, media: { ...m.media, [id]: md } }, id };
}

/** Removes a media item and every clip that uses it (in all sequences). */
export function removeMedia(m, id) {
  if (!m.media[id]) return m;
  const strip = (clips) => Object.fromEntries(Object.entries(clips).filter(([, c]) => c.media !== id));
  const { [id]: _g, ...media } = m.media;
  const { [id]: _a, ...analysis } = m.analysis || {};
  return { ...m, media, analysis, clips: strip(m.clips), comps: Object.fromEntries(Object.entries(m.comps).map(([k, c]) => [k, { ...c, clips: strip(c.clips) }])) };
}

/** Stores analysis results of a media item (merged per key). */
export const setAnalysis = (m, mediaId, patch) => ({ ...m, analysis: { ...m.analysis, [mediaId]: { ...m.analysis?.[mediaId], ...patch } } });

/**
 * Places media on the timeline: a video clip (plus its sound on an audio track, linked by name), an audio clip or
 * a still image (5 s). The picture is fitted into the frame ("fit"), fills it ("fill") or keeps its size ("none").
 * @returns {{ model, ids }}
 */
export function placeMedia(m, mediaId, { start = null, track: trackId = null, dur = null, fit = "fit", withAudio = true } = {}) {
  const md = m.media[mediaId];
  if (!md) throw new Error(`There is no media item “${mediaId}”.`);
  const at = start === null ? duration(m) : snapT(m, start);
  const length = dur ?? (md.kind === "image" ? 5 : md.duration || 5);
  const ids = [];
  let next = m;
  if (md.kind === "audio") {
    const r = addClip(next, { type: "audio", media: mediaId, start: at, dur: length, track: trackId || undefined });
    return { model: r.model, ids: [r.id] };
  }
  const s = fit === "none" || !md.w || !md.h ? 1 : fit === "fill" ? Math.max(m.width / md.w, m.height / md.h) : Math.min(m.width / md.w, m.height / md.h);
  const r = addClip(next, { type: md.kind, media: mediaId, start: at, dur: length, sx: s, sy: s, track: trackId || undefined });
  next = r.model;
  ids.push(r.id);
  if (md.kind === "video" && md.hasAudio && withAudio) {
    const a = addClip(next, { type: "audio", media: mediaId, start: at, dur: next.clips[r.id].dur, name: md.name });
    next = a.model;
    ids.push(a.id);
  }
  return { model: next, ids };
}

/**
 * Moves clips of a sequence (the root or a composition, see sequence()) into a new composition and puts one
 * composition clip in their place, on the topmost video track they used. Their sound goes along (compositions play
 * it). Works inside compositions too (nesting); write the result back with commitSequence.
 * @returns {{ model, id, comp }}
 */
export function precompose(m, ids, name = "Composition") {
  const src = ids.map((id) => m.clips[id]).filter(Boolean);
  if (!src.length) throw new Error("Select clips to pre-compose.");
  const start = Math.min(...src.map((c) => c.start));
  const end = Math.max(...src.map(clipEnd));
  const used = m.tracks.filter((t) => src.some((c) => c.track === t.id));
  const tmap = new Map(used.map((t) => [t.id, newId("t")]));
  const tracks = used.map((t) => ({ ...t, id: tmap.get(t.id), locked: false, hidden: false, muted: false }));
  if (!tracks.some((t) => t.kind === "video")) tracks.unshift(track("video", 1));
  if (!tracks.some((t) => t.kind === "audio")) tracks.push(track("audio", 1));
  const comp = {
    id: newId("k"),
    name: String(name).slice(0, 120) || "Composition",
    width: m.width,
    height: m.height,
    tracks,
    clips: Object.fromEntries(src.map((c) => [c.id, { ...c, track: tmap.get(c.track), start: snapT(m, c.start - start) }])),
    markers: [],
  };
  const clips = { ...m.clips };
  for (const c of src) delete clips[c.id];
  const base = { ...m, clips, comps: { ...m.comps, [comp.id]: comp } };
  const top = videoTracks(m).find((t) => tmap.has(t.id) && !t.locked);
  const r = addClip(base, { type: "comp", comp: comp.id, start, dur: end - start, track: top && !overlapping(base, top.id, start, end).length ? top.id : undefined, name: comp.name });
  return { model: r.model, id: r.id, comp: comp.id };
}

// ---------------------------------------------------------------------------------------------- reading (Vibe, status bar)

const r3 = (v) => Math.round(v * 1000) / 1000;
const brief = (v) => (isTrack(v) ? { keyframes: v.kf.map((k) => ({ t: r3(k.t), v: k.v, ...(k.e ? { e: k.e } : {}), ...(k.i ? { in: k.i.map(r3) } : {}), ...(k.o ? { out: k.o.map(r3) } : {}) })) } : typeof v === "number" ? r3(v) : v);

/** A compact, complete description of one clip for the assistant. */
export function describeClip(m, c) {
  const o = { id: c.id, type: c.type, name: c.name, track: trackOf(m, c.track)?.name || c.track, start: r3(c.start), end: r3(clipEnd(c)), dur: r3(c.dur) };
  if (c.in !== undefined) Object.assign(o, { sourceIn: r3(c.in), speed: c.speed });
  if (c.media) o.media = c.media;
  if (c.comp) o.comp = c.comp;
  if (c.remap !== undefined) o.remap = brief(c.remap);
  if (c.collapse) o.collapse = true;
  if (c.type !== "audio") {
    for (const k of ["x", "y", "sx", "sy", "rot", "opacity"]) {
      const d = k === "x" ? m.width / 2 : k === "y" ? m.height / 2 : k === "rot" ? 0 : 1;
      if (c[k] !== d) o[k] = brief(c[k]);
    }
    if (c.blend !== "normal") o.blend = c.blend;
    if (c.crop.l || c.crop.t || c.crop.r || c.crop.b) o.crop = c.crop;
    if (c.mask) o.mask = c.mask;
    if (c.tin) o.transitionIn = c.tin;
    if (c.tout) o.transitionOut = c.tout;
  }
  if (c.volume !== undefined) {
    if (c.volume !== 1) o.volume = brief(c.volume);
    if (c.pan !== 0) o.pan = brief(c.pan);
    if (c.fadeIn) o.fadeIn = c.fadeIn;
    if (c.fadeOut) o.fadeOut = c.fadeOut;
    if (c.muted) o.muted = true;
  }
  if (c.effects.length) o.effects = c.effects.map((e) => ({ id: e.id, type: e.type, ...(e.on ? {} : { on: false }), params: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, brief(v)])) }));
  if (c.type === "text") {
    o.text = c.text.text;
    o.style = { font: c.text.font, size: c.text.size, weight: c.text.weight, color: c.text.color, align: c.text.align, ...(c.text.bg ? { bg: c.text.bg } : {}), ...(c.text.stroke ? { stroke: c.text.stroke, strokeW: c.text.strokeW } : {}), ...(c.text.anim.in !== "none" || c.text.anim.out !== "none" ? { anim: c.text.anim } : {}) };
    if (c.caption) o.caption = true;
  }
  if (c.type === "shape") o.shape = c.shape;
  if (c.type === "solid") o.color = c.color;
  return o;
}

/** Overview of a scene: format, tracks with their clips, media, markers, compositions. */
export function describeScene(model, { seq: seqId = "main", from = 0, to = Infinity, limit = 300 } = {}) {
  const m = sequence(model, seqId);
  const list = clipList(m).filter((c) => clipEnd(c) > from && c.start < to);
  return {
    title: model.title,
    sequence: seqId || "main",
    width: m.width,
    height: m.height,
    fps: model.fps,
    duration: r3(duration(m)),
    timecode: timecode(model, duration(m)),
    tracks: m.tracks.map((t, i) => ({ id: t.id, name: t.name, kind: t.kind, order: i, ...(t.muted ? { muted: true } : {}), ...(t.hidden ? { hidden: true } : {}), ...(t.locked ? { locked: true } : {}), clips: list.filter((c) => c.track === t.id).length })),
    clips: list.slice(0, limit).map((c) => describeClip(m, c)),
    ...(list.length > limit ? { truncated: list.length - limit } : {}),
    markers: m.markers.map((k) => ({ id: k.id, t: r3(k.t), name: k.name })),
    range: seqId === "main" || !seqId ? model.range : null,
    media: Object.values(model.media).map((x) => ({ id: x.id, kind: x.kind, name: x.name, ...(x.duration ? { duration: r3(x.duration) } : {}), ...(x.w ? { w: x.w, h: x.h } : {}), analysed: Object.keys(model.analysis?.[x.id] || {}) })),
    compositions: Object.values(model.comps).map((k) => ({ id: k.id, name: k.name, width: k.width, height: k.height, duration: r3(duration(k)), ...(compRefs(k).length ? { uses: compRefs(k) } : {}) })),
  };
}

/** Maps a timeline time of the root sequence to the source time of a media item (first matching clip), or null. */
export function sourceTimeAt(m, mediaId, t) {
  const c = clipList(m).find((x) => x.media === mediaId && t >= x.start && t < clipEnd(x));
  return c ? c.in + (t - c.start) * c.speed : null;
}

/** All timeline ranges in which source range [s0, s1) of a media item is visible or audible. */
export function timelineRangesOf(m, mediaId, s0, s1) {
  const out = [];
  for (const c of clipList(m)) {
    if (c.media !== mediaId) continue;
    const a = c.start + (Math.max(s0, c.in) - c.in) / c.speed;
    const b = c.start + (Math.min(s1, c.in + c.dur * c.speed) - c.in) / c.speed;
    if (b > a) out.push([a, b]);
  }
  return mergeRanges(out);
}

// ---------------------------------------------------------------------------------------------- templates

export const TEMPLATES = [
  { id: "blank", label: "Blank sequence", description: "Full HD, 30 frames per second", icon: "file-earmark-play", category: "Basic" },
  { id: "vertical", label: "Vertical video", description: "9:16 for Reels, Shorts and TikTok", icon: "phone", category: "Basic" },
  { id: "square", label: "Square video", description: "1:1 for feeds", icon: "square", category: "Basic" },
  { id: "title", label: "Animated title", description: "A title card with animated text on a color background", icon: "fonts", category: "Motion" },
  { id: "lower-third", label: "Lower third", description: "A name bar that slides in over your footage", icon: "card-text", category: "Motion" },
];

export function templateScene(id = "blank", { title = "" } = {}) {
  if (id === "vertical" || id === "square") return emptyScene({ title, preset: id });
  let m = emptyScene({ title });
  const v1 = videoTracks(m)[1].id;
  const v2 = videoTracks(m)[0].id;
  if (id === "title") {
    m = addClip(m, { type: "solid", track: v1, start: 0, dur: 5, color: "#111827" }).model;
    m = addClip(m, { type: "text", track: v2, start: 0.3, dur: 4.4, text: { text: title || "Your title", size: 140, anim: { in: "chars", inDur: 0.9, out: "fade", outDur: 0.5 } }, sx: { kf: [{ t: 0, v: 0.96, e: "easeOut" }, { t: 4.4, v: 1.04 }] }, sy: { kf: [{ t: 0, v: 0.96, e: "easeOut" }, { t: 4.4, v: 1.04 }] } }).model;
  } else if (id === "lower-third") {
    const y = m.height - 190;
    m = addClip(m, { type: "shape", track: v1, start: 0.5, dur: 4.5, shape: { kind: "rect", w: 720, h: 120, fill: "#2563eb", radius: 12 }, x: { kf: [{ t: 0, v: -400, e: "easeOut" }, { t: 0.5, v: 460 }, { t: 4, v: 460, e: "easeIn" }, { t: 4.5, v: -400 }] }, y }).model;
    m = addClip(m, { type: "text", track: v2, start: 0.8, dur: 3.9, text: { text: title || "Name Surname", size: 56, align: "left", anim: { in: "slide-up", inDur: 0.4, out: "fade", outDur: 0.3 } }, x: 460, y }).model;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------- timeline helpers

/**
 * Moves several clips together by `dt` seconds and `dTrack` rows (within the tracks of each clip's kind). The
 * group keeps its shape: the move is clamped so nothing starts before 0 or leaves the track list. What the clips
 * land on is overwritten.
 */
export function moveClips(m, ids, dt, dTrack = 0) {
  const src = ids.map((id) => m.clips[id]).filter((c) => c && !trackOf(m, c.track)?.locked);
  if (!src.length) return m;
  const shift = Math.max(snapT(m, dt) - 0, -Math.min(...src.map((c) => c.start)));
  const rows = { video: videoTracks(m), audio: audioTracks(m) };
  const rowOf = (c) => rows[trackKindFor(c.type)].findIndex((t) => t.id === c.track);
  let dr = Math.round(dTrack);
  for (const c of src) {
    const list = rows[trackKindFor(c.type)];
    dr = clamp(dr, -rowOf(c), list.length - 1 - rowOf(c));
  }
  if (!shift && !dr) return m;
  const moving = new Set(src.map((c) => c.id));
  let next = { ...m, clips: Object.fromEntries(Object.entries(m.clips).filter(([id]) => !moving.has(id))) };
  const placed = src.map((c) => ({ ...c, start: snapT(m, c.start + shift), track: rows[trackKindFor(c.type)][rowOf(c) + dr].id }));
  for (const c of placed) {
    if (trackOf(m, c.track).locked) return m;
    next = carve(next, c.track, c.start, clipEnd(c), null);
  }
  return { ...next, clips: { ...next.clips, ...Object.fromEntries(placed.map((c) => [c.id, c])) } };
}

/** Sorted times where something starts or ends (clip edges, markers, In / Out, 0): snapping and "next edit". */
export function editPoints(m, skip = null) {
  const set = new Set([0]);
  for (const c of Object.values(m.clips)) {
    if (skip?.has(c.id)) continue;
    set.add(c.start);
    set.add(clipEnd(c));
  }
  for (const k of m.markers) set.add(k.t);
  if (m.range) {
    set.add(m.range.in);
    set.add(m.range.out);
  }
  return [...set].sort((a, b) => a - b);
}

/** The value in sorted `points` closest to `t` within `tol`, else null. */
export function snapTo(points, t, tol) {
  let best = null;
  let bd = tol;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
