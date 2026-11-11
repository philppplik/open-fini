// Scene Studio motion presets and timeline automation behind the assistant's tools (docs/scene-studio.md ▸
// Assistant): animate a clip, title animations, lower thirds, slideshows with Ken Burns, beat-synced cuts, reframing
// to another aspect ratio and highlight reels. Pure (model in, { model, result } out); unit-tested in
// tests/scene/motion.test.js. Everything is plain keyframe data, so the user can edit the result by hand.
import * as M from "./model.js";
import { valueAt, isTrack } from "./keyframes.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (v === undefined || v === null || v === "" ? undefined : +v);
const hex = (c, d) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : d);

// ---------------------------------------------------------------------------------------------- animate a clip

export const CLIP_ANIMATIONS = ["fade", "slide-from-left", "slide-from-right", "slide-from-top", "slide-from-bottom", "zoom", "pop", "spin", "blur", "ken-burns", "shake", "pulse", "float"];

// keyframes of `prop` at clip-local times [[local, value, easing?]] merged into what the clip already has
function keys(m, id, prop, list) {
  let next = m;
  const c = m.clips[id];
  for (const [local, v, e] of list) next = M.setKeyframe(next, id, prop, c.start + Math.max(0, Math.min(c.dur, local)), v, e);
  return next;
}

/**
 * A motion preset on a clip: entrance ("in"), exit ("out") or both, over `dur` seconds. Continuous presets
 * (ken-burns, shake, pulse, float) cover the whole clip. `amount` scales the movement.
 */
export function animateClip(m, { id, preset, edge = "in", dur = 0.5, amount = 1 }) {
  const c = m.clips[id];
  if (!c) throw new Error(`There is no clip “${id}”.`);
  if (c.type === "audio") throw new Error("Audio clips have no picture to animate; use scene_audio for fades.");
  if (!CLIP_ANIMATIONS.includes(preset)) throw new Error(`Unknown animation “${preset}”. Presets: ${CLIP_ANIMATIONS.join(", ")}.`);
  const d = Math.max(1 / m.fps, Math.min(+dur || 0.5, c.dur / (edge === "both" ? 2 : 1)));
  const at = (prop, local) => valueAt(c[prop], local);
  const k = +amount || 1;
  let next = m;
  const edges = edge === "both" ? ["in", "out"] : [edge === "out" ? "out" : "in"];
  for (const e of edges) {
    const a = e === "in" ? 0 : c.dur - d; // segment start (clip-local)
    const b = e === "in" ? d : c.dur;
    const still = e === "in" ? b : a; // where the clip is at rest
    const pair = (prop, away, ease = e === "in" ? "easeOut" : "easeIn") => (e === "in" ? [[a, away, ease], [b, at(prop, still)]] : [[a, at(prop, still), ease], [b, away]]);
    const fade = () => (next = keys(next, id, "opacity", pair("opacity", 0, "linear")));
    if (preset === "fade") fade();
    else if (preset.startsWith("slide-from-")) {
      const side = preset.slice(11);
      const prop = side === "left" || side === "right" ? "x" : "y";
      const dist = (prop === "x" ? m.width : m.height) * 0.35 * k * (side === "left" || side === "top" ? -1 : 1);
      next = keys(next, id, prop, pair(prop, at(prop, still) + dist, e === "in" ? [0.16, 1, 0.3, 1] : [0.7, 0, 0.84, 0]));
      fade();
    } else if (preset === "zoom") {
      const f = e === "in" ? 1 - 0.35 * k : 1 + 0.3 * k;
      for (const p of ["sx", "sy"]) next = keys(next, id, p, pair(p, at(p, still) * f));
      fade();
    } else if (preset === "pop") {
      for (const p of ["sx", "sy"]) next = keys(next, id, p, pair(p, 0.01, e === "in" ? "back" : "easeIn"));
    } else if (preset === "spin") {
      next = keys(next, id, "rot", pair("rot", at("rot", still) + (e === "in" ? -180 : 180) * k));
      for (const p of ["sx", "sy"]) next = keys(next, id, p, pair(p, at(p, still) * 0.5));
      fade();
    } else if (preset === "blur") {
      const r = M.addEffect(next, id, "blur", { radius: e === "in" ? { kf: [{ t: a, v: 24 * k, e: "easeOut" }, { t: b, v: 0 }] } : { kf: [{ t: a, v: 0, e: "easeIn" }, { t: b, v: 24 * k }] } });
      next = r.model;
      fade();
    } else break; // continuous presets below
  }
  if (["ken-burns", "shake", "pulse", "float"].includes(preset)) {
    const s = at("sx", 0);
    const x = at("x", 0);
    const y = at("y", 0);
    if (preset === "ken-burns") {
      for (const p of ["sx", "sy"]) next = keys(next, id, p, [[0, at(p, 0), "easeInOut"], [c.dur, at(p, 0) * (1 + 0.12 * k)]]);
      next = keys(next, id, "x", [[0, x - m.width * 0.02 * k, "easeInOut"], [c.dur, x + m.width * 0.02 * k]]);
    } else {
      const step = preset === "shake" ? 0.05 : preset === "pulse" ? 0.5 : 1;
      const n = Math.min(400, Math.floor(c.dur / step));
      const list = { x: [], y: [], s: [] };
      for (let i = 0; i <= n; i++) {
        const t = i * step;
        if (preset === "shake") {
          // deterministic pseudo-random offsets (frame = f(model, time))
          const rx = Math.sin(i * 12.9898) * 43758.5453;
          const ry = Math.sin(i * 78.233) * 12543.123;
          list.x.push([t, x + (rx - Math.floor(rx) - 0.5) * 16 * k]);
          list.y.push([t, y + (ry - Math.floor(ry) - 0.5) * 16 * k]);
        } else if (preset === "pulse") list.s.push([t, i % 2 ? s * (1 + 0.06 * k) : s, "easeInOut"]);
        else list.y.push([t, y + Math.sin((i * Math.PI) / 2) * 12 * k, "easeInOut"]);
      }
      if (list.x.length) next = keys(next, id, "x", list.x);
      if (list.y.length) next = keys(next, id, "y", list.y);
      if (list.s.length) for (const p of ["sx", "sy"]) next = keys(next, id, p, list.s);
    }
  }
  return { model: next, result: { id, preset, edge } };
}

// ---------------------------------------------------------------------------------------------- titles and lower thirds

export const TITLE_PRESETS = {
  "fade-up": { anim: "slide-up", out: "fade", weight: 800 },
  pop: { anim: "pop", out: "fade", weight: 900 },
  typewriter: { anim: "typewriter", out: "fade", weight: 600, font: "Courier New" },
  letters: { anim: "chars", out: "fade", weight: 800 },
  words: { anim: "words", out: "fade", weight: 800 },
  "blur-in": { anim: "blur", out: "blur", weight: 700 },
  "zoom-through": { anim: "fade", out: "fade", weight: 900, zoom: true },
  underline: { anim: "slide-up", out: "fade", weight: 800, underline: true },
  boxed: { anim: "pop", out: "fade", weight: 800, box: true },
};

const estWidth = (text, size, weight = 700) => Math.max(...String(text).split("\n").map((l) => l.length)) * size * (weight >= 800 ? 0.6 : 0.55);

/**
 * An animated title (and optional subtitle) built from text, shape and solid clips with keyframes. Returns the ids.
 * position: center, top, bottom; background: a color for a full-frame solid behind the title (null = none).
 */
export function titleAnimation(m, a) {
  const p = TITLE_PRESETS[a.preset || "fade-up"];
  if (!p) throw new Error(`Unknown title preset “${a.preset}”. Presets: ${Object.keys(TITLE_PRESETS).join(", ")}.`);
  if (!String(a.text || "").trim()) throw new Error("A title needs text.");
  const start = Math.max(0, num(a.start) ?? 0);
  const dur = Math.max(0.5, num(a.dur) ?? 4);
  const size = num(a.size) ?? Math.round(m.height * 0.12);
  const color = hex(a.color, "#ffffff");
  const accent = hex(a.accent, "#3b82f6");
  const y = a.position === "top" ? m.height * 0.22 : a.position === "bottom" ? m.height * 0.75 : m.height * 0.46;
  const ids = [];
  let next = m;
  const add = (props) => {
    const r = M.addClip(next, props);
    next = r.model;
    ids.push(r.id);
    return r.id;
  };
  if (a.background) add({ type: "solid", start, dur, color: hex(a.background, "#111827"), name: "Title background" });
  const anim = { in: p.anim, inDur: Math.min(1.2, dur / 3), out: p.out, outDur: Math.min(0.5, dur / 4) };
  const textStyle = { text: String(a.text), size, weight: p.weight, color, font: a.font || p.font || "Inter", anim, ...(p.box ? { bg: accent, bgPad: Math.round(size * 0.3), bgRadius: Math.round(size * 0.15) } : {}) };
  const title = add({ type: "text", start, dur, x: m.width / 2, y, text: textStyle, name: "Title" });
  if (p.zoom) for (const prop of ["sx", "sy"]) next = M.setKeyframe(M.setKeyframe(next, title, prop, start, 0.85, "easeOut"), title, prop, start + dur, 1.08);
  if (p.underline) {
    const w = Math.min(m.width * 0.9, estWidth(a.text, size, p.weight));
    const bar = add({ type: "shape", start: start + 0.2, dur: Math.max(0.2, dur - 0.2), x: m.width / 2, y: y + size * 0.75, shape: { kind: "rect", w, h: Math.max(4, Math.round(size * 0.08)), fill: accent, radius: 4 }, name: "Underline" });
    next = M.setKeyframe(M.setKeyframe(next, bar, "sx", start + 0.2, 0, [0.16, 1, 0.3, 1]), bar, "sx", start + 0.9, 1);
  }
  if (a.subtitle) {
    add({ type: "text", start: start + 0.3, dur: Math.max(0.2, dur - 0.3), x: m.width / 2, y: y + size * (p.underline ? 1.35 : 1.05), text: { text: String(a.subtitle), size: Math.round(size * 0.42), weight: 500, color, font: a.font || "Inter", anim: { in: "fade", inDur: 0.6, out: "fade", outDur: anim.outDur } }, name: "Subtitle" });
  }
  return { model: next, result: { ids, start: r3(start), end: r3(start + dur) } };
}

export const LOWER_THIRD_STYLES = ["bar", "box", "line", "minimal"];

/** A lower third (name and role) that slides in and out: bar, box, line or minimal style, left or right. */
export function lowerThird(m, a) {
  const style = a.style || "bar";
  if (!LOWER_THIRD_STYLES.includes(style)) throw new Error(`Unknown lower-third style “${style}”. Styles: ${LOWER_THIRD_STYLES.join(", ")}.`);
  if (!String(a.name || "").trim()) throw new Error("A lower third needs a name.");
  const start = Math.max(0, num(a.start) ?? 0);
  const dur = Math.max(1, num(a.dur) ?? 5);
  const accent = hex(a.color, "#2563eb");
  const textColor = hex(a.textColor, "#ffffff");
  const right = a.side === "right";
  const margin = m.width * 0.06;
  const size = Math.round(m.height * 0.05);
  const subSize = Math.round(size * 0.62);
  const yName = m.height * 0.8;
  const ySub = yName + size * 0.95;
  const textW = Math.max(estWidth(a.name, size, 800), a.title ? estWidth(a.title, subSize, 500) : 0);
  const pad = size * 0.5;
  const left = right ? m.width - margin - textW : margin + (style === "line" ? size * 0.4 : 0);
  const textX = (w) => (right ? m.width - margin - w / 2 : left + w / 2);
  const ids = [];
  let next = m;
  const add = (props) => {
    const r = M.addClip(next, props);
    next = r.model;
    ids.push(r.id);
    return r.id;
  };
  const off = right ? m.width + textW : -textW; // where the panel waits off-frame
  if (style === "bar" || style === "box") {
    const w = textW + pad * 2;
    const h = (a.title ? size + subSize * 1.3 : size) + pad * 1.2;
    const cx = right ? m.width - margin - w / 2 + pad : margin + w / 2 - pad;
    const panel = add({ type: "shape", start, dur, y: (a.title ? (yName + ySub) / 2 : yName), x: cx, opacity: style === "box" ? 0.88 : 1, shape: { kind: "rect", w, h, fill: style === "box" ? hex(a.boxColor, "#111827") : accent, radius: style === "box" ? 10 : 4 }, name: "Lower third panel" });
    next = M.setKeyframe(next, panel, "x", start, off, [0.16, 1, 0.3, 1]);
    next = M.setKeyframe(next, panel, "x", start + 0.5, cx);
    next = M.setKeyframe(next, panel, "x", start + dur - 0.45, cx, [0.7, 0, 0.84, 0]);
    next = M.setKeyframe(next, panel, "x", start + dur, off);
    if (style === "box") add({ type: "shape", start, dur, x: right ? cx + w / 2 - 3 : cx - w / 2 + 3, y: (a.title ? (yName + ySub) / 2 : yName), shape: { kind: "rect", w: 6, h, fill: accent }, name: "Lower third accent" });
  } else if (style === "line") {
    const h = a.title ? size + subSize * 1.4 : size * 1.2;
    const bar = add({ type: "shape", start, dur, x: right ? m.width - margin + size * 0.2 : margin, y: (a.title ? (yName + ySub) / 2 : yName), shape: { kind: "rect", w: Math.max(4, size * 0.1), h, fill: accent }, name: "Lower third line" });
    next = M.setKeyframe(M.setKeyframe(next, bar, "sy", start, 0, "easeOut"), bar, "sy", start + 0.4, 1);
  }
  const shadow = style === "minimal" || style === "line";
  add({ type: "text", start: start + 0.25, dur: dur - 0.35, x: textX(estWidth(a.name, size, 800)), y: yName, text: { text: String(a.name), size, weight: 800, color: textColor, align: right ? "right" : "left", shadow, anim: { in: style === "minimal" ? "fade" : "slide-up", inDur: 0.4, out: "fade", outDur: 0.3 } }, name: "Lower third name" });
  if (a.title) add({ type: "text", start: start + 0.4, dur: dur - 0.5, x: textX(estWidth(a.title, subSize, 500)), y: ySub, text: { text: String(a.title), size: subSize, weight: 500, color: textColor, align: right ? "right" : "left", shadow, anim: { in: "fade", inDur: 0.4, out: "fade", outDur: 0.3 } }, name: "Lower third title" });
  return { model: next, result: { ids, start: r3(start), end: r3(start + dur) } };
}

// ---------------------------------------------------------------------------------------------- slideshow and beat cuts

// fill scale of a media item in the frame
const fillScale = (m, md) => (md?.w && md?.h ? Math.max(m.width / md.w, m.height / md.h) : 1);

// a gentle Ken Burns move on a clip (alternating zoom in / out and pan direction by `i`)
function kenBurns(m, id, i, strength = 1) {
  const c = m.clips[id];
  const s = valueAt(c.sx, 0);
  const zoomIn = i % 2 === 0;
  const [s0, s1] = zoomIn ? [s, s * (1 + 0.12 * strength)] : [s * (1 + 0.12 * strength), s];
  const dx = m.width * 0.025 * strength * (i % 4 < 2 ? 1 : -1);
  const dy = m.height * 0.02 * strength * (i % 3 === 0 ? 1 : -1);
  let next = m;
  for (const p of ["sx", "sy"]) next = M.setKeyframe(M.setKeyframe(next, id, p, c.start, s0, "easeInOut"), id, p, M.clipEnd(c), s1);
  next = M.setKeyframe(M.setKeyframe(next, id, "x", c.start, m.width / 2 - dx, "easeInOut"), id, "x", M.clipEnd(c), m.width / 2 + dx);
  next = M.setKeyframe(M.setKeyframe(next, id, "y", c.start, m.height / 2 - dy, "easeInOut"), id, "y", M.clipEnd(c), m.height / 2 + dy);
  return next;
}

function newTrack(m, kind, name) {
  const r = M.addTrack(m, kind, { name });
  return { model: r.model, id: r.id };
}

/**
 * Images (and videos) one after another on a new track, each `dur` seconds (or `beats` beats of the music's beat
 * grid), with a transition between them and Ken Burns moves; optional music under it with a fade-out.
 */
export function slideshow(m, a) {
  const list = (a.media || []).map((id) => {
    const md = m.media[id];
    if (!md) throw new Error(`There is no media item “${id}”.`);
    if (md.kind === "audio") throw new Error(`${id} is audio; pass it as music.`);
    return md;
  });
  if (!list.length) throw new Error("Pass media: the image (or video) ids in order.");
  const start = Math.max(0, num(a.start) ?? M.duration(m));
  let durs = list.map(() => Math.max(0.3, num(a.dur) ?? 3));
  const music = a.music ? m.media[a.music] : null;
  if (a.music && !(music && (music.kind === "audio" || (music.kind === "video" && music.hasAudio)))) throw new Error(`Music “${a.music}” is not an item with sound.`);
  const beatTimes = music && a.beats ? m.analysis?.[music.id]?.beats?.times : null;
  if (a.beats && music && !beatTimes?.length) throw new Error(`The music has no beat grid yet. Call scene_analyze_audio for ${music.id} first.`);
  if (beatTimes?.length) {
    const every = Math.max(1, Math.round(+a.beats));
    const cuts = beatTimes.filter((_, i) => i % every === 0);
    durs = list.map((_, i) => (cuts[i + 1] !== undefined ? cuts[i + 1] - cuts[i] : durs[i]));
  }
  let { model: next, id: track } = newTrack(m, "video", a.trackName || "Slideshow");
  const ids = [];
  let pos = beatTimes?.length ? start + beatTimes[0] : start;
  const tr = a.transition === "none" ? null : a.transition || "dissolve";
  if (tr && !M.TRANSITION_TYPES.includes(tr)) throw new Error(`Unknown transition “${tr}”. Use one of: ${M.TRANSITION_TYPES.join(", ")}.`);
  list.forEach((md, i) => {
    const s = a.fit === "fit" ? Math.min(m.width / (md.w || m.width), m.height / (md.h || m.height)) : fillScale(m, md);
    const r = M.addClip(next, { type: md.kind, media: md.id, track, start: pos, dur: durs[i], sx: s, sy: s, ...(md.kind === "video" ? { in: 0, speed: 1 } : {}) });
    next = r.model;
    ids.push(r.id);
    const placed = next.clips[r.id];
    if (a.kenBurns !== false && md.kind === "image") next = kenBurns(next, r.id, i, num(a.strength) ?? 1);
    if (tr && i > 0) next = M.setTransition(next, r.id, "in", tr, Math.min(num(a.transitionDur) ?? 0.6, placed.dur / 2));
    pos = M.clipEnd(placed);
  });
  if (tr) {
    next = M.setTransition(next, ids[0], "in", "fade", 0.5);
    next = M.setTransition(next, ids[ids.length - 1], "out", "fade", 0.6);
  }
  let musicId = null;
  if (music) {
    const total = pos - start;
    const r = M.addClip(next, { type: "audio", media: music.id, start, dur: total, fadeOut: Math.min(2, total / 4) });
    next = r.model;
    musicId = r.id;
  }
  return { model: next, result: { track: M.trackOf(next, track).name, clips: ids, ...(musicId ? { music: musicId } : {}), start: r3(start), end: r3(pos) } };
}

/**
 * Cuts to the beat: the beat grid of `music` (its beats analysis, placed at `start` unless a clip of it is already on
 * the timeline) cut every `every` beats; the intervals are filled with the `sources` in turn (media ids, each
 * continuing where it left off), on a new video track. Optional `from` / `to` limit the timeline range.
 */
export function beatCuts(m, a) {
  const music = m.media[a.music];
  if (!music) throw new Error(`There is no media item “${a.music}”.`);
  const beats = m.analysis?.[music.id]?.beats?.times;
  if (!beats?.length) throw new Error(`“${music.name}” has no beat grid yet. Call scene_analyze_audio for ${music.id} first.`);
  const sources = (a.sources || []).map((id) => {
    const md = m.media[id];
    if (!md || md.kind === "audio") throw new Error(`Source “${id}” is not a video or image item.`);
    return md;
  });
  if (!sources.length) throw new Error("Pass sources: video or image media ids to cut between.");
  let next = m;
  // where the music sits on the timeline: an existing clip, or a new one at start
  let mclip = M.clipList(m).find((c) => c.type === "audio" && c.media === music.id);
  if (!mclip) {
    const r = M.addClip(next, { type: "audio", media: music.id, start: Math.max(0, num(a.start) ?? 0), dur: music.duration || 30 });
    next = r.model;
    mclip = next.clips[r.id];
  }
  const toTl = (s) => mclip.start + (s - mclip.in) / mclip.speed;
  const from = num(a.from) ?? mclip.start;
  const to = Math.min(num(a.to) ?? M.clipEnd(mclip), M.clipEnd(mclip));
  const every = Math.max(1, Math.round(num(a.every) ?? 2));
  const grid = beats.map(toTl).filter((t) => t >= from - 1e-6 && t <= to + 1e-6).filter((_, i) => i % every === 0);
  if (grid.length < 2) throw new Error("Fewer than two beats fall into that range; lower `every` or widen from/to.");
  if (grid[grid.length - 1] < to - 0.05) grid.push(to);
  const tk = newTrack(next, "video", a.trackName || "Beat cuts");
  next = tk.model;
  const cursor = sources.map((md) => num(a.sourceIn) ?? Math.min(md.duration ? md.duration * 0.1 : 0, 2));
  const ids = [];
  for (let i = 0; i + 1 < grid.length; i++) {
    const k = i % sources.length;
    const md = sources[k];
    const dur = grid[i + 1] - grid[i];
    if (md.duration && cursor[k] + dur > md.duration) cursor[k] = 0; // loop the source
    const s = fillScale(next, md);
    const r = M.addClip(next, { type: md.kind, media: md.id, track: tk.id, start: grid[i], dur, sx: s, sy: s, ...(md.kind === "video" ? { in: cursor[k], speed: 1 } : {}) });
    next = r.model;
    ids.push(r.id);
    if (md.kind === "video") cursor[k] += dur;
    else if (a.kenBurns !== false) next = kenBurns(next, r.id, i, 0.6);
  }
  return { model: next, result: { track: M.trackOf(next, tk.id).name, clips: ids.length, cuts: grid.slice(0, 200).map(r3), music: mclip.id } };
}

// ---------------------------------------------------------------------------------------------- reframe

export const ASPECTS = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "4:3": [4, 3], "21:9": [21, 9] };

/** Output size of an aspect ratio that keeps the short side of the current frame (even numbers). */
export function aspectSize(m, aspect) {
  const r = ASPECTS[aspect];
  if (!r) throw new Error(`Unknown aspect ratio “${aspect}”. Use ${Object.keys(ASPECTS).join(", ")}.`);
  const short = Math.min(m.width, m.height);
  const even = (v) => Math.round(v / 2) * 2;
  return r[0] >= r[1] ? { width: even((short * r[0]) / r[1]), height: short } : { width: short, height: even((short * r[1]) / r[0]) };
}

/**
 * Changes the aspect ratio and keeps the subject in frame: picture clips (video, image, composition) are scaled to
 * fill the new frame and moved so `focus` ({ x, y } as fractions of the old frame, default the center) or the
 * keyframed `track` ([{ t, x, y }] in timeline seconds) stays in the middle; text and shapes keep their relative
 * place; solids and adjustment layers fill the new frame; captions are rewrapped.
 */
export function reframe(m, a) {
  const { width: W, height: H } = a.width && a.height ? { width: Math.round(+a.width), height: Math.round(+a.height) } : aspectSize(m, a.aspect);
  const s = a.mode === "fit" ? Math.min(W / m.width, H / m.height) : Math.max(W / m.width, H / m.height);
  const keysIn = (a.track || []).map((k) => ({ t: +k.t, x: Math.min(1, Math.max(0, +k.x)), y: Math.min(1, Math.max(0, +k.y)) })).filter((k) => Number.isFinite(k.t)).sort((p, q) => p.t - q.t);
  const focus = { x: Math.min(1, Math.max(0, num(a.focus?.x) ?? 0.5)), y: Math.min(1, Math.max(0, num(a.focus?.y) ?? 0.5)) };
  // focus at timeline time t, eased between keys; the window is clamped so it never shows outside the old frame
  const fAt = (t) => {
    let f = focus;
    if (keysIn.length) {
      const kf = { kf: keysIn.map((k, i) => ({ t: k.t, v: [k.x, k.y], ...(i < keysIn.length - 1 ? { e: "easeInOut" } : {}) })) };
      const [x, y] = valueAt(kf, t);
      f = { x, y };
    }
    const hw = W / s / 2 / m.width;
    const hh = H / s / 2 / m.height;
    return { x: a.mode === "fit" ? f.x : Math.min(1 - hw, Math.max(hw, f.x)), y: a.mode === "fit" ? f.y : Math.min(1 - hh, Math.max(hh, f.y)) };
  };
  const mapX = (x, f) => W / 2 + (x - f.x * m.width) * s;
  const mapY = (y, f) => H / 2 + (y - f.y * m.height) * s;
  const clips = {};
  for (const c of Object.values(m.clips)) {
    if (c.type === "audio") {
      clips[c.id] = c;
      continue;
    }
    if (c.type === "solid" || c.type === "adjustment") {
      clips[c.id] = { ...c, x: W / 2, y: H / 2 };
      continue;
    }
    if (c.type === "text" || c.type === "shape") {
      const rel = (v, from, to) => (isTrack(v) ? { kf: v.kf.map((q) => ({ ...q, v: (q.v / from) * to })) } : (v / from) * to);
      const n = { ...c, x: rel(c.x, m.width, W), y: rel(c.y, m.height, H) };
      if (c.type === "text") {
        const boxW = c.caption ? Math.round(W * 0.86) : c.text.boxW ? Math.min(c.text.boxW, Math.round(W * 0.9)) : 0;
        const est = estWidth(c.text.text, c.text.size, c.text.weight);
        n.text = { ...c.text, boxW: boxW || (est > W * 0.9 ? Math.round(W * 0.9) : 0) };
      }
      clips[c.id] = n;
      continue;
    }
    // picture clips: sample the clip's own keyframes and the focus keys inside it
    const times = new Set([0, c.dur]);
    for (const p of ["x", "y", "sx", "sy"]) if (isTrack(c[p])) c[p].kf.forEach((k) => times.add(k.t));
    for (const k of keysIn) if (k.t > c.start && k.t < M.clipEnd(c)) times.add(k.t - c.start);
    const ts = [...times].sort((p, q) => p - q);
    const animated = ts.length > 2 || keysIn.length > 0;
    const val = (p) => (local) => {
      const fo = fAt(c.start + local);
      return p === "x" ? mapX(valueAt(c.x, local), fo) : p === "y" ? mapY(valueAt(c.y, local), fo) : valueAt(c[p], local) * s;
    };
    const out = { ...c };
    for (const p of ["x", "y", "sx", "sy"]) {
      const fn = val(p);
      if (!animated || (!isTrack(c[p]) && (p === "sx" || p === "sy"))) out[p] = fn(0);
      else out[p] = { kf: ts.map((t, i) => ({ t, v: fn(t), ...(i < ts.length - 1 ? { e: keysIn.length ? "easeInOut" : "linear" } : {}) })) };
    }
    clips[c.id] = out;
  }
  const next = M.normalizeScene({ ...m, width: W, height: H, clips });
  return { model: next, result: { format: `${W}×${H}`, scale: r3(s), focus: keysIn.length ? `${keysIn.length} keys` : focus } };
}

// ---------------------------------------------------------------------------------------------- highlight reel

/**
 * A new arrangement of the sequence from timeline ranges in the given order (repeats allowed): everything in each
 * range (all unlocked tracks) is copied one after another; picture joins get `transition`, sound joins short fades.
 * Markers inside a range move with it.
 */
export function highlightReel(m, a) {
  const ranges = (a.ranges || []).map(([x, y]) => [Math.max(0, +x), +y]).filter(([x, y]) => Number.isFinite(x) && y > x);
  if (!ranges.length) throw new Error("Pass ranges: [[start, end], …] in timeline seconds, in the order they should play.");
  const tr = a.transition && a.transition !== "none" ? a.transition : null;
  if (tr && !M.TRANSITION_TYPES.includes(tr)) throw new Error(`Unknown transition “${tr}”. Use one of: ${M.TRANSITION_TYPES.join(", ")}.`);
  const locked = new Set(m.tracks.filter((t) => t.locked).map((t) => t.id));
  const clips = Object.fromEntries(Object.entries(m.clips).filter(([, c]) => locked.has(c.track)));
  const markers = [];
  let pos = 0;
  let work = m;
  ranges.forEach(([x0, y0], ri) => {
    const x = M.snapT(m, x0);
    const y = M.snapT(m, Math.min(y0, M.duration(m)));
    if (y <= x) return;
    work = M.splitAll(M.splitAll(m, x).model, y).model;
    for (const c of M.clipList(work)) {
      if (locked.has(c.track) || c.start < x - 1e-6 || M.clipEnd(c) > y + 1e-6) continue;
      const id = M.newId("c");
      const n = { ...c, id, start: M.snapT(m, pos + (c.start - x)), effects: c.effects.map((e) => ({ ...e, id: M.newId("fx") })) };
      if (ri > 0 && Math.abs(c.start - x) < 1e-6) {
        if (c.type === "audio") n.fadeIn = Math.max(n.fadeIn || 0, 0.04);
        else if (tr) n.tin = { type: tr, dur: Math.min(+a.transitionDur || 0.4, n.dur / 2) };
      }
      if (ri < ranges.length - 1 && Math.abs(M.clipEnd(c) - y) < 1e-6 && c.type === "audio") n.fadeOut = Math.max(n.fadeOut || 0, 0.04);
      clips[id] = n;
    }
    for (const k of m.markers) if (k.t >= x && k.t < y) markers.push({ ...k, id: M.newId("m"), t: M.snapT(m, pos + k.t - x) });
    pos = M.snapT(m, pos + (y - x));
  });
  const next = { ...m, clips, markers, range: null };
  return { model: next, result: { duration: r3(M.duration(next)), ranges: ranges.length } };
}
