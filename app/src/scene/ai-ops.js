// Scene Studio operations behind the assistant's tools (vibe/tools/scene.js, docs/scene-studio.md ▸ Assistant).
// Pure: each op takes the model and the tool's arguments and returns { model, result } (or a plain result for
// reads), throwing a readable Error for bad input. The tool layer turns one call into ONE undo step. Unit-tested in
// tests/scene/ai-ops.test.js.
//
//   summary(model, opts)  compact structured description (one line per clip, or full detail for chosen clips)
//   addLayer, placeMedia, moveClips, trimClip, split, deleteClips, setSpeed, updateClips, setTransitions,
//   keyframes, effects, audio, markers, tracks, sequenceFormat, cutTimeline, captions, captionsText, catalog
// Times may be seconds or time codes ("1:23.5", "00:01:23:12"); tracks may be ids or names ("V1", "Captions").
import * as M from "./model.js";
import { EFFECTS } from "./effects.js";
import { EASING_NAMES, isTrack, valueAt } from "./keyframes.js";
import { CAPTION_STYLES, captionCues, captionsToClips, formatSrt, formatVtt, parseSubtitles } from "./captions.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (v === undefined || v === null || v === "" ? undefined : +v);

/** Seconds from a number or time code; throws for anything else. */
export function time(m, v, what = "time") {
  const t = M.parseTime(m, v);
  if (!Number.isFinite(t)) throw new Error(`“${v}” is not a ${what}. Use seconds (12.5) or a time code (0:12.5 or 00:00:12:15).`);
  return Math.max(0, t);
}

/** A track by id or name (case-insensitive), optionally of one kind. */
export function findTrack(m, ref, kind = null) {
  if (ref === undefined || ref === null || ref === "") return null;
  const s = String(ref);
  const tk = m.tracks.find((t) => t.id === s) || m.tracks.find((t) => t.name.toLowerCase() === s.toLowerCase());
  if (!tk) throw new Error(`There is no track “${s}”. Tracks: ${m.tracks.map((t) => `${t.name} (${t.kind}, ${t.id})`).join(", ")}.`);
  if (kind && tk.kind !== kind) throw new Error(`Track ${tk.name} is a ${tk.kind} track; this needs a ${kind} track.`);
  return tk;
}

export function clipOf(m, id) {
  const c = m.clips[id];
  if (!c) throw new Error(`There is no clip “${id}”. Call scene_describe for the current clip ids.`);
  return c;
}

const ids = (m, list) => {
  const out = [...new Set((Array.isArray(list) ? list : [list]).filter(Boolean).map(String))];
  if (!out.length) throw new Error("Pass at least one clip id.");
  out.forEach((id) => clipOf(m, id));
  return out;
};

// ---------------------------------------------------------------------------------------------- reading

const kfOf = (c) => [...M.ANIMATABLE.filter((k) => isTrack(c[k])), ...(c.effects || []).flatMap((e) => Object.entries(e.p).filter(([, v]) => isTrack(v)).map(([p]) => `fx:${e.id}:${p}`))];

/** One line per clip: id, type, name, track, start–end, and what is not default. */
export function clipLine(m, c) {
  const parts = [`${c.id} ${c.type}`, JSON.stringify(c.name || ""), M.trackOf(m, c.track)?.name || c.track, `${r3(c.start)}–${r3(M.clipEnd(c))}s`];
  if (c.media) parts.push(`media=${c.media}`);
  if (c.in !== undefined && (c.in || c.speed !== 1)) parts.push(`in=${r3(c.in)}${c.speed !== 1 ? ` speed=${c.speed}` : ""}`);
  if (c.type === "text") parts.push(`text=${JSON.stringify(c.text.text.slice(0, 80))}${c.caption ? " caption" : ""}`);
  if (c.type === "shape") parts.push(`shape=${c.shape.kind} ${c.shape.w}×${c.shape.h} ${c.shape.fill || "none"}`);
  if (c.type === "solid") parts.push(`color=${c.color}`);
  if (c.type !== "audio") {
    const at = (k) => (isTrack(c[k]) ? "kf" : r3(c[k]));
    if (c.x !== m.width / 2 || c.y !== m.height / 2) parts.push(`pos=${at("x")},${at("y")}`);
    if (c.sx !== 1 || c.sy !== 1) parts.push(`scale=${at("sx")}${c.sy !== c.sx ? `,${at("sy")}` : ""}`);
    if (c.rot !== 0) parts.push(`rot=${at("rot")}`);
    if (c.opacity !== 1) parts.push(`opacity=${at("opacity")}`);
    if (c.blend !== "normal") parts.push(`blend=${c.blend}`);
    if (c.mask) parts.push(`mask=${c.mask.shape}`);
    if (c.tin) parts.push(`in:${c.tin.type}/${c.tin.dur}`);
    if (c.tout) parts.push(`out:${c.tout.type}/${c.tout.dur}`);
  }
  if (c.volume !== undefined) {
    if (c.volume !== 1) parts.push(`vol=${isTrack(c.volume) ? "kf" : r3(c.volume)}`);
    if (c.pan !== 0) parts.push(`pan=${isTrack(c.pan) ? "kf" : r3(c.pan)}`);
    if (c.fadeIn || c.fadeOut) parts.push(`fades=${c.fadeIn}/${c.fadeOut}`);
    if (c.muted) parts.push("muted");
  }
  if (c.effects?.length) parts.push(`fx=${c.effects.map((e) => `${e.type}#${e.id}${e.on ? "" : "(off)"}`).join(",")}`);
  const kf = kfOf(c);
  if (kf.length) parts.push(`keyframes=${kf.join(",")}`);
  return parts.join(" ");
}

/** What the analysis of each media item holds, in a few numbers. */
export function analysisSummary(model) {
  const out = {};
  for (const [id, a] of Object.entries(model.analysis || {})) {
    const o = {};
    if (a.transcript) o.transcript = { words: a.transcript.words.length, segments: a.transcript.segments.length, engine: a.transcript.engine, ...(a.transcript.estimated ? { estimatedTimes: true } : {}) };
    if (a.shots) o.shots = a.shots.length;
    if (a.silence) o.silentRanges = a.silence.length;
    if (a.loudness) o.loudness = a.loudness;
    if (a.beats) o.beats = { bpm: a.beats.bpm, count: a.beats.times.length };
    if (a.notes) o.notes = a.notes.length;
    out[id] = o;
  }
  return out;
}

/**
 * Compact structured summary of the sequence (`seq`), limited to [from, to]. `clips` lists ids to describe in full
 * detail (keyframes, effect parameters, text style); the others are one line each.
 */
export function summary(model, { seq = "main", from = 0, to = Infinity, clips = [], limit = 200 } = {}) {
  const m = M.sequence(model, seq);
  const list = M.clipList(m).filter((c) => M.clipEnd(c) > from && c.start < to);
  const full = new Set(clips || []);
  return {
    title: model.title,
    sequence: seq || "main",
    format: `${m.width}×${m.height} @ ${model.fps} fps`,
    duration: r3(M.duration(m)),
    background: model.background,
    tracks: m.tracks.map((t) => `${t.id} ${t.name} ${t.kind}${t.muted ? " muted" : ""}${t.hidden ? " hidden" : ""}${t.locked ? " locked" : ""} (${list.filter((c) => c.track === t.id).length} clips)`),
    clips: list.slice(0, limit).map((c) => clipLine(m, c)),
    ...(list.length > limit ? { truncated: `${list.length - limit} more clips; pass from/to to see them` } : {}),
    ...(full.size ? { detail: [...full].map((id) => (m.clips[id] ? M.describeClip(m, m.clips[id]) : { id, error: "no such clip" })) } : {}),
    markers: m.markers.map((k) => `${k.id} ${r3(k.t)}s ${JSON.stringify(k.name)}`),
    ...((seq === "main" || !seq) && model.range ? { range: model.range } : {}),
    media: Object.values(model.media).map((x) => `${x.id} ${x.kind} ${JSON.stringify(x.name)}${x.duration ? ` ${r3(x.duration)}s` : ""}${x.w ? ` ${x.w}×${x.h}` : ""}${x.kind === "video" && !x.hasAudio ? " no-sound" : ""}`),
    analysis: analysisSummary(model),
    captions: M.clipList(m).filter((c) => c.caption).length,
    compositions: Object.values(model.comps).map((k) => `${k.id} ${JSON.stringify(k.name)} ${k.width}×${k.height} ${r3(M.duration(k))}s`),
  };
}

/** Effects, transitions, blend modes, easings, text animations, caption styles and presets the tools accept. */
export function catalog() {
  return {
    effects: Object.fromEntries(Object.entries(EFFECTS).map(([id, e]) => [id, { stage: e.stage, params: Object.fromEntries(Object.entries(e.params).map(([k, p]) => [k, p.options ? `0..${p.options.length - 1} (${p.options.join(", ")})` : p.color ? "#rrggbb" : `${p.min}..${p.max} (default ${p.def})`])) }])),
    transitions: M.TRANSITION_TYPES,
    blendModes: M.BLEND_MODES,
    easings: [...EASING_NAMES, "[x1, y1, x2, y2] cubic bezier"],
    textAnimations: M.TEXT_ANIMS,
    shapes: M.SHAPE_KINDS,
    captionStyles: Object.keys(CAPTION_STYLES),
    animatable: [...M.ANIMATABLE, "fx:<effect id>:<parameter>"],
    sizePresets: Object.fromEntries(Object.entries(M.PRESETS).map(([k, p]) => [k, `${p.width}×${p.height}`])),
  };
}

// ---------------------------------------------------------------------------------------------- clips

const TEXT_KEYS = ["text", "font", "size", "weight", "italic", "color", "align", "lineHeight", "tracking", "stroke", "strokeW", "bg", "bgPad", "bgRadius", "shadow", "boxW", "anim"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/** Clip properties from tool arguments (transform, look, text, shape, sound); `scale` sets sx and sy. */
export function clipProps(a = {}) {
  const p = pick(a, ["name", "x", "y", "sx", "sy", "rot", "opacity", "blend", "crop", "mask", "color", "volume", "pan", "fadeIn", "fadeOut", "muted"]);
  if (a.scale !== undefined) p.sx = p.sy = a.scale;
  if (a.blend !== undefined && !M.BLEND_MODES.includes(a.blend)) throw new Error(`“${a.blend}” is not a blend mode. Use one of: ${M.BLEND_MODES.join(", ")}.`);
  if (a.text !== undefined) p.text = typeof a.text === "string" ? { text: a.text } : pick(a.text, TEXT_KEYS);
  if (a.style) p.text = { ...(p.text || {}), ...pick(a.style, TEXT_KEYS) };
  if (a.shape) p.shape = a.shape;
  if (p.mask && p.mask !== null && !["rect", "ellipse"].includes(p.mask.shape)) throw new Error("mask.shape is rect or ellipse.");
  return p;
}

/** Adds a text, shape, solid, adjustment or image layer. */
export function addLayer(m, a) {
  const type = a.type;
  if (!["text", "shape", "solid", "adjustment", "image"].includes(type)) throw new Error("type is text, shape, solid, adjustment or image.");
  if (type === "image" && !m.media[a.media]) throw new Error(`There is no image media “${a.media}”. Import it with scene_import_media first.`);
  const start = time(m, a.start ?? 0, "start time");
  const dur = a.end !== undefined ? time(m, a.end) - start : num(a.dur) ?? 5;
  if (!(dur > 0)) throw new Error("The layer needs a positive duration (dur, or end after start).");
  const tk = findTrack(m, a.track, "video");
  const props = { ...clipProps(a), type, start, dur, track: tk?.id, ...(type === "image" ? { media: a.media } : {}) };
  if (type === "text" && !props.text?.text) throw new Error("A text layer needs text.");
  if (type === "adjustment" && !props.name) props.name = "Adjustment layer";
  const r = M.addClip(m, props);
  let next = r.model;
  for (const fx of a.effects || []) next = M.addEffect(next, r.id, fx.type, fx.params || {}).model;
  return { model: next, result: { id: r.id, track: M.trackOf(next, next.clips[r.id].track).name, start: r3(next.clips[r.id].start), end: r3(M.clipEnd(next.clips[r.id])) } };
}

/** Places a media item: a source range (sourceIn / sourceOut) at a timeline time, video with its sound. */
export function placeMedia(m, a) {
  const md = m.media[a.media];
  if (!md) throw new Error(`There is no media item “${a.media}”. Media: ${Object.values(m.media).map((x) => `${x.id} (${x.name})`).join(", ") || "none, import some first"}.`);
  const start = a.start === undefined || a.start === null ? M.duration(m) : time(m, a.start);
  const sIn = num(a.sourceIn) ?? 0;
  const sOut = num(a.sourceOut);
  if (md.duration && sIn >= md.duration) throw new Error(`sourceIn ${sIn} is past the end of “${md.name}” (${r3(md.duration)} s).`);
  const speed = num(a.speed) ?? 1;
  if (!(speed >= 0.05 && speed <= 20)) throw new Error("speed is between 0.05 and 20 (1 = normal).");
  const srcLen = md.kind === "image" ? null : Math.min(sOut ?? md.duration, md.duration || Infinity) - sIn;
  if (srcLen !== null && !(srcLen > 0)) throw new Error("sourceOut must be after sourceIn.");
  const tk = findTrack(m, a.track, md.kind === "audio" ? "audio" : "video");
  // placed at speed 1 from sourceIn, then sped up or slowed down (the duration follows), then cut to dur
  const r = M.placeMedia(m, a.media, { start, track: tk?.id || null, dur: md.kind === "image" ? num(a.dur) ?? 5 : srcLen, fit: a.fit || "fit", withAudio: a.withAudio !== false });
  let next = r.model;
  if (md.kind !== "image") {
    for (const id of r.ids) {
      if (sIn) next = { ...next, clips: { ...next.clips, [id]: { ...next.clips[id], in: sIn } } };
      if (speed !== 1) next = M.setSpeed(next, id, speed);
      if (num(a.dur) !== undefined) next = M.trimClip(next, id, "end", start + num(a.dur));
    }
  }
  return { model: next, result: { ids: r.ids, clips: r.ids.map((id) => clipLine(next, next.clips[id])) } };
}

/** Moves clips to a start time (the first one; the others keep their offsets), by a delta, and / or to a track. */
export function moveClips(m, a) {
  const list = ids(m, a.ids);
  if (list.length === 1 && (a.track !== undefined || a.start !== undefined)) {
    const c = clipOf(m, list[0]);
    const tk = findTrack(m, a.track, c.type === "audio" ? "audio" : "video");
    const start = a.start !== undefined ? time(m, a.start) : c.start + (num(a.by) || 0);
    return { model: M.moveClip(m, c.id, { start, track: tk?.id }), result: { moved: 1 } };
  }
  if (a.track !== undefined) throw new Error("Moving several clips to a track is not supported; move them one by one or use trackDelta.");
  const first = Math.min(...list.map((id) => m.clips[id].start));
  const dt = a.start !== undefined ? time(m, a.start) - first : num(a.by) || 0;
  return { model: M.moveClips(m, list, dt, num(a.trackDelta) || 0), result: { moved: list.length } };
}

/** Trims a clip edge to a time (or by a delta); `ripple` moves the later clips of the track along. */
export function trimClip(m, a) {
  const c = clipOf(m, a.id);
  const edge = a.edge === "start" ? "start" : "end";
  const base = edge === "start" ? c.start : M.clipEnd(c);
  const to = a.to !== undefined ? time(m, a.to) : base + (num(a.by) ?? NaN);
  if (!Number.isFinite(to)) throw new Error("Pass to (a time) or by (seconds, negative shortens the end).");
  const next = M.trimClip(m, c.id, edge, to, { ripple: !!a.ripple });
  const n = next.clips[c.id];
  const note = edge === "end" && to > M.clipEnd(n) + 1e-6 ? `The clip cannot grow past its source; it ends at ${r3(M.clipEnd(n))} s.` : undefined;
  return { model: next, result: { clip: clipLine(next, n), ...(note ? { note } : {}) } };
}

/** Splits clips (or every clip under the time, optionally only on some tracks) at a time. */
export function split(m, a) {
  const at = time(m, a.at);
  if (a.ids?.length) {
    let next = m;
    const made = [];
    for (const id of ids(m, a.ids)) {
      const r = M.splitClip(next, id, at);
      next = r.model;
      if (r.id) made.push(r.id);
    }
    if (!made.length) throw new Error(`No clip of ${a.ids.join(", ")} spans ${at} s.`);
    return { model: next, result: { newClips: made } };
  }
  const tracks = a.tracks?.length ? a.tracks.map((x) => findTrack(m, x).id) : null;
  const r = M.splitAll(m, at, tracks);
  if (!r.ids.length) throw new Error(`Nothing to split at ${at} s.`);
  return { model: r.model, result: { newClips: r.ids } };
}

export function deleteClips(m, a) {
  const list = ids(m, a.ids);
  return { model: M.deleteClips(m, list, { ripple: !!a.ripple }), result: { deleted: list.length } };
}

export function setSpeed(m, a) {
  const c = clipOf(m, a.id);
  const speed = +a.speed;
  if (!(speed >= 0.05 && speed <= 20)) throw new Error("speed is between 0.05 and 20 (1 = normal).");
  let next = M.setSpeed(m, c.id, speed, { ripple: !!a.ripple });
  // the linked sound follows a video clip
  const linked = c.type === "video" ? M.clipList(m).find((x) => x.type === "audio" && x.media === c.media && Math.abs(x.start - c.start) < 1e-6 && Math.abs(x.dur - c.dur) < 1e-6) : null;
  if (linked && a.withAudio !== false) next = M.setSpeed(next, linked.id, speed, { ripple: !!a.ripple });
  return { model: next, result: { clip: clipLine(next, next.clips[c.id]), ...(linked ? { audio: linked.id } : {}) } };
}

/** Changes properties of clips (one patch for all). Animated properties set to a number lose their keyframes. */
export function updateClips(m, a) {
  let next = m;
  const list = ids(m, a.ids);
  const patch = clipProps(a.props || {});
  if (!Object.keys(patch).length) throw new Error("props is empty. Pass e.g. { x, y, scale, opacity, blend, text, style, shape, color, crop, mask }.");
  for (const id of list) next = M.updateClip(next, id, patch);
  return { model: next, result: { clips: list.map((id) => clipLine(next, next.clips[id])) } };
}

export function setTransitions(m, a) {
  let next = m;
  const list = ids(m, a.ids);
  const edges = a.edge === "both" ? ["in", "out"] : [a.edge === "out" ? "out" : "in"];
  const type = a.type === "none" ? null : a.type;
  for (const id of list) for (const e of edges) next = M.setTransition(next, id, e, type, num(a.dur) ?? 0.5);
  return { model: next, result: { clips: list.map((id) => clipLine(next, next.clips[id])) } };
}

// ---------------------------------------------------------------------------------------------- animation

const easingOk = (e) => e === undefined || EASING_NAMES.includes(e) || (Array.isArray(e) && e.length === 4 && e.every(Number.isFinite));

/**
 * Sets, replaces, removes or clears keyframes of one property. Key times are seconds from the clip start
 * (timeBase "clip", default) or timeline seconds (timeBase "timeline").
 */
export function keyframes(m, a) {
  const c = clipOf(m, a.id);
  const prop = String(a.prop || "");
  const mode = a.mode || "set";
  const keys = Array.isArray(a.keys) ? a.keys : [];
  for (const k of keys) if (!easingOk(k.easing)) throw new Error(`Unknown easing ${JSON.stringify(k.easing)}. Use ${EASING_NAMES.join(", ")} or [x1, y1, x2, y2].`);
  const abs = (k) => (a.timeBase === "timeline" ? time(m, k.t) : c.start + time(m, k.t));
  let next = m;
  if (mode === "clear") {
    const cur = prop.startsWith("fx:") ? describeFx(c, prop) : c[prop];
    if (cur === undefined) throw new Error(`Clip ${c.id} has no property “${prop}”.`);
    next = M.setProp(m, c.id, prop, a.value ?? (isTrack(cur) ? valueAt(cur, 0) : cur));
  } else if (mode === "remove") {
    for (const k of keys) next = M.removeKeyframe(next, c.id, prop, abs(k));
  } else {
    if (!keys.length) throw new Error("Pass keys: [{ t, v, easing? }].");
    if (mode === "replace") next = M.setProp(next, c.id, prop, keys[0].v);
    for (const k of keys) next = M.setKeyframe(next, c.id, prop, abs(k), k.v, k.easing);
  }
  const n = next.clips[c.id];
  return { model: next, result: { clip: c.id, prop, value: prop.startsWith("fx:") ? describeFx(n, prop) : n[prop] } };
}

function describeFx(c, prop) {
  const m = /^fx:([\w-]+):([\w-]+)$/.exec(prop);
  const fx = m && c.effects.find((e) => e.id === m[1]);
  return fx ? fx.p[m[2]] : undefined;
}

/** Adds, updates or removes an effect on clips. */
export function effects(m, a) {
  const list = ids(m, a.ids);
  let next = m;
  const made = [];
  if (a.action === "add") {
    if (!EFFECTS[a.type]) throw new Error(`“${a.type}” is not an effect. Effects: ${Object.keys(EFFECTS).join(", ")} (scene_catalog lists their parameters).`);
    for (const id of list) {
      const c = next.clips[id];
      if (EFFECTS[a.type].stage === "audio" && c.volume === undefined) throw new Error(`${a.type} is an audio effect; clip ${id} has no sound (use its audio clip).`);
      if (EFFECTS[a.type].stage !== "audio" && c.type === "audio") throw new Error(`${a.type} is a picture effect; ${id} is an audio clip.`);
      const r = M.addEffect(next, id, a.type, a.params || {});
      next = r.model;
      made.push(r.id);
    }
  } else if (a.action === "update" || a.action === "remove") {
    if (!a.effect) throw new Error("Pass effect: the effect id (fx=…#<id> in scene_describe) or its type.");
    for (const id of list) {
      const c = next.clips[id];
      const fx = c.effects.find((e) => e.id === a.effect) || c.effects.find((e) => e.type === a.effect);
      if (!fx) throw new Error(`Clip ${id} has no effect “${a.effect}”.`);
      next = a.action === "remove" ? M.removeEffect(next, id, fx.id) : M.updateEffect(next, id, fx.id, { p: a.params || {}, ...(a.on !== undefined ? { on: !!a.on } : {}) });
    }
  } else throw new Error("action is add, update or remove.");
  return { model: next, result: { ...(made.length ? { effectIds: made } : {}), clips: list.map((id) => clipLine(next, next.clips[id])) } };
}

// ---------------------------------------------------------------------------------------------- sound

/** The audio clip linked to a video clip (same media, same position), or the clip itself when it carries sound. */
export function soundClip(m, c) {
  if (c.volume !== undefined) return c;
  if (c.type !== "video") return null;
  return M.clipList(m).find((x) => x.type === "audio" && x.media === c.media && Math.abs(x.start - c.start) < 1e-6) || null;
}

export const dbToGain = (db) => 10 ** (db / 20);

/**
 * Volume (gain or dB), pan, fades, mute and the three-band EQ of clips; `normalize` sets the volume so the clip's
 * media reaches that integrated loudness (needs scene_analyze_audio). Video clips address their linked sound.
 */
export function audio(m, a) {
  let next = m;
  const done = [];
  for (const id of ids(m, a.ids)) {
    const c = soundClip(next, next.clips[id]);
    if (!c) throw new Error(`Clip ${id} has no sound. Use the audio clip (scene_describe lists it on an audio track).`);
    const patch = {};
    if (a.volumeDb !== undefined) patch.volume = dbToGain(+a.volumeDb);
    if (a.volume !== undefined) patch.volume = +a.volume;
    if (a.normalize !== undefined) {
      const lu = next.analysis?.[c.media]?.loudness?.integrated;
      if (!Number.isFinite(lu)) throw new Error(`Media ${c.media} has no loudness measurement yet. Call scene_analyze_audio first.`);
      patch.volume = Math.min(8, dbToGain(+a.normalize - lu));
    }
    if (a.pan !== undefined) patch.pan = Math.max(-1, Math.min(1, +a.pan));
    if (a.fadeIn !== undefined) patch.fadeIn = +a.fadeIn;
    if (a.fadeOut !== undefined) patch.fadeOut = +a.fadeOut;
    if (a.muted !== undefined) patch.muted = !!a.muted;
    if (Object.keys(patch).length) next = M.updateClip(next, c.id, patch);
    if (a.eq) {
      const fx = next.clips[c.id].effects.find((e) => e.type === "eq");
      next = fx ? M.updateEffect(next, c.id, fx.id, { p: pick(a.eq, ["low", "mid", "high"]) }) : M.addEffect(next, c.id, "eq", pick(a.eq, ["low", "mid", "high"])).model;
    }
    done.push(c.id);
  }
  return { model: next, result: { clips: done.map((id) => clipLine(next, next.clips[id])) } };
}

// ---------------------------------------------------------------------------------------------- tracks, markers, format

export function markers(m, a) {
  if (a.action === "add") {
    const r = M.addMarker(m, time(m, a.t), a.name || "", a.color);
    return { model: r.model, result: { id: r.id } };
  }
  if (a.action === "remove") {
    if (!m.markers.some((k) => k.id === a.id)) throw new Error(`There is no marker “${a.id}”.`);
    return { model: M.removeMarker(m, a.id), result: { removed: a.id } };
  }
  if (a.action === "clear") return { model: { ...m, markers: [] }, result: { removed: m.markers.length } };
  if (a.action === "range") {
    if (a.in === undefined || a.in === null) return { model: M.setRange(m, null, null), result: { range: null } };
    const next = M.setRange(m, time(m, a.in), time(m, a.out));
    return { model: next, result: { range: next.range } };
  }
  throw new Error("action is add, remove, clear or range.");
}

export function tracks(m, a) {
  if (a.action === "add") {
    const r = M.addTrack(m, a.kind, { name: a.name || "", index: num(a.index) ?? null });
    return { model: r.model, result: { id: r.id, name: M.trackOf(r.model, r.id).name } };
  }
  const tk = findTrack(m, a.track);
  if (!tk) throw new Error("Pass track (id or name).");
  if (a.action === "remove") return { model: M.removeTrack(m, tk.id), result: { removed: tk.name } };
  if (a.action === "move") return { model: M.moveTrack(m, tk.id, num(a.delta) || 0), result: { moved: tk.name } };
  if (a.action === "update") return { model: M.updateTrack(m, tk.id, pick(a, ["name", "muted", "hidden", "locked"])), result: { updated: tk.id } };
  throw new Error("action is add, remove, update or move.");
}

/** Positions and scales follow a size change, so the picture keeps its composition. */
export function resize(m, w, h) {
  const fx = w / m.width;
  const fy = h / m.height;
  const k = Math.min(fx, fy);
  const scaleV = (v, f) => (isTrack(v) ? { kf: v.kf.map((q) => ({ ...q, v: q.v * f })) } : v * f);
  const clips = Object.fromEntries(Object.entries(m.clips).map(([id, c]) => [id, c.type === "audio" ? c : { ...c, x: scaleV(c.x, fx), y: scaleV(c.y, fy), sx: scaleV(c.sx, k), sy: scaleV(c.sy, k) }]));
  return M.normalizeScene({ ...m, width: w, height: h, clips });
}

export function sequenceFormat(m, a) {
  let next = m;
  const p = a.preset ? M.PRESETS[a.preset] : null;
  if (a.preset && !p) throw new Error(`Unknown preset “${a.preset}”. Presets: ${Object.keys(M.PRESETS).join(", ")}.`);
  const w = Math.round(num(a.width) ?? p?.width ?? m.width);
  const h = Math.round(num(a.height) ?? p?.height ?? m.height);
  if (w !== m.width || h !== m.height) {
    if (!(w >= 16 && w <= 8192 && h >= 16 && h <= 8192)) throw new Error("width and height are 16 to 8192 pixels.");
    next = resize(next, w, h);
  }
  if (a.fps !== undefined) next = M.normalizeScene({ ...next, fps: +a.fps });
  if (a.background !== undefined) next = { ...next, background: /^#[0-9a-f]{6}$/i.test(a.background) ? a.background : next.background };
  if (a.title !== undefined) next = { ...next, title: String(a.title).slice(0, 200) };
  return { model: next, result: { format: `${next.width}×${next.height} @ ${next.fps} fps`, background: next.background, title: next.title } };
}

/** Removes (cut: closes the gaps), keeps (keep) or blanks (lift: leaves gaps) timeline ranges. */
export function cutTimeline(m, a) {
  const rs = (a.ranges || []).map(([x, y]) => [time(m, x), time(m, y)]).filter(([x, y]) => y > x);
  if (!rs.length) throw new Error("Pass ranges: [[start, end], …] in timeline seconds.");
  const before = M.duration(m);
  let next;
  if (a.mode === "keep") next = M.keepRanges(m, rs);
  else if (a.mode === "lift") {
    next = m;
    for (const [x, y] of M.mergeRanges(rs)) {
      next = M.splitAll(M.splitAll(next, x).model, y).model;
      next = M.deleteClips(next, M.clipList(next).filter((c) => !M.trackOf(next, c.track)?.locked && c.start >= x - 1e-6 && M.clipEnd(c) <= y + 1e-6).map((c) => c.id));
    }
  } else next = M.cutRanges(m, rs);
  return { model: next, result: { before: r3(before), after: r3(M.duration(next)), removed: r3(before - M.duration(next)) } };
}

// ---------------------------------------------------------------------------------------------- captions

/**
 * create (cues or SRT / VTT text), edit (one caption's text or times), style (preset and / or style overrides for
 * all captions), delete (ids or all).
 */
export function captions(m, a) {
  const list = () => M.clipList(m).filter((c) => c.caption);
  if (a.action === "create" || a.action === "import") {
    const cues = a.subtitles ? parseSubtitles(a.subtitles) : (a.cues || []).map((c) => ({ t0: time(m, c.start), t1: time(m, c.end), text: String(c.text || "") }));
    if (!cues.length) throw new Error(a.subtitles ? "No cues found in the subtitle text (SRT or WebVTT expected)." : "Pass cues: [{ start, end, text }] or subtitles (SRT / VTT text).");
    if (a.style && !CAPTION_STYLES[a.style]) throw new Error(`Unknown caption style “${a.style}”. Styles: ${Object.keys(CAPTION_STYLES).join(", ")}.`);
    const r = captionsToClips(m, cues, { style: a.style || "classic", replace: !!a.replace, y: num(a.y) ?? 0.86, offset: num(a.offset) || 0, anim: a.anim || "none" });
    let next = r.model;
    if (a.overrides) for (const id of r.ids) next = M.updateClip(next, id, { text: pick(a.overrides, TEXT_KEYS) });
    return { model: next, result: { created: r.ids.length } };
  }
  if (a.action === "edit") {
    const c = clipOf(m, a.id);
    if (!c.caption) throw new Error(`${a.id} is not a caption.`);
    let next = m;
    if (a.text !== undefined) next = M.updateClip(next, c.id, { text: { text: String(a.text) } });
    if (a.start !== undefined) next = M.trimClip(next, c.id, "start", time(m, a.start));
    if (a.end !== undefined) next = M.trimClip(next, c.id, "end", time(m, a.end));
    return { model: next, result: { clip: clipLine(next, next.clips[c.id]) } };
  }
  if (a.action === "style") {
    if (a.style && !CAPTION_STYLES[a.style]) throw new Error(`Unknown caption style “${a.style}”. Styles: ${Object.keys(CAPTION_STYLES).join(", ")}.`);
    const patch = { ...(a.style ? CAPTION_STYLES[a.style] : {}), ...pick(a.overrides || {}, TEXT_KEYS) };
    let next = m;
    const caps = list();
    if (!caps.length) throw new Error("There are no captions.");
    for (const c of caps) {
      next = M.updateClip(next, c.id, { text: patch });
      if (a.y !== undefined) next = M.updateClip(next, c.id, { y: m.height * +a.y });
    }
    return { model: next, result: { styled: caps.length } };
  }
  if (a.action === "delete") {
    const del = a.ids?.length ? a.ids : list().map((c) => c.id);
    return { model: M.deleteClips(m, del), result: { deleted: del.length } };
  }
  throw new Error("action is create, import, edit, style or delete.");
}

/** The captions as SRT or WebVTT text. */
export function captionsText(m, format = "srt") {
  const cues = captionCues(m);
  return { format, cues: cues.length, text: format === "vtt" ? formatVtt(cues) : formatSrt(cues) };
}
