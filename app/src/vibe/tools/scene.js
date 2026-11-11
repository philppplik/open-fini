// Vibe tools of the Scene Studio (docs/scene-studio.md ▸ Assistant; group "Scene editing"): the assistant edits a
// scene natively through the same pure operations as the timeline (scene/model.js). Every change is ONE undoable
// commitOffice step ("Vibe: …"). The tools work on the scene document whether or not its workspace is on screen
// (the assistant usually runs from the Vibe studio); pictures are rendered with exactly seeked sources.
//
// Times are seconds on the timeline unless a parameter says "source". Positions are sequence pixels, (0, 0) is the
// top left corner, x / y of a clip is its CENTER. Understanding tools live in scene-understand.js.
import { tool, S } from "./helpers.js";

const stores = new WeakMap(); // doc → media store for documents whose workspace is not mounted

/** The scene to work on: the active document when it is a scene, else the most recently opened scene. */
export async function sceneCtx(app, { need = true } = {}) {
  const isScene = (d) => d?.office?.kind === "scene";
  const doc = isScene(app.doc) ? app.doc : [...(app.docs || [])].reverse().find(isScene) || null;
  if (!doc) {
    if (!need) return null;
    throw new Error("No scene is open. Create one with scene_new (or ask the user to open a scene document).");
  }
  const [M, { commitOffice }] = await Promise.all([import("../../scene/model.js"), import("../../core/office.js")]);
  if (doc.office.model?._raw || doc.office.model?.version !== M.SCENE_VERSION) {
    const { _raw, ...rest } = doc.office.model || {};
    doc.office.model = M.normalizeScene(rest);
  }
  const ui = app.sceneUI?.doc === doc ? app.sceneUI : null;
  return {
    doc,
    M,
    ui,
    model: () => doc.office.model,
    commit(label, next) {
      if (next && next !== doc.office.model) commitOffice(doc, `Vibe: ${label}`, next);
      return doc.office.model;
    },
    async store() {
      if (ui) return ui.store;
      if (!stores.has(doc)) {
        const { createMediaStore } = await import("../../scene/media.js");
        stores.set(doc, createMediaStore(() => doc.office.model));
      }
      return stores.get(doc);
    },
    playhead: () => ui?.state.t ?? 0,
  };
}

const ids = (d) => ({ type: "array", items: { type: "string" }, description: d, minItems: 1 });
const SEQ = S.str('Sequence: "main" (default) or a composition id from scene_describe');
const anim = (d) => ({ description: `${d}: a number, or { "keyframes": [{ "t": seconds from the clip start, "v": value, "e": easing }] }`, anyOf: [{ type: "number" }, { type: "object" }] });
const toValue = (v) => (v && typeof v === "object" && Array.isArray(v.keyframes) ? { kf: v.keyframes } : v);
const r3 = (v) => Math.round(v * 1000) / 1000;

const CLIP_PROPS = {
  name: S.str("Name shown on the clip"),
  x: anim("Horizontal center in sequence pixels"),
  y: anim("Vertical center in sequence pixels"),
  scale: anim("Uniform scale, 1 = 100 %"),
  sx: anim("Horizontal scale"),
  sy: anim("Vertical scale"),
  rot: anim("Rotation in degrees, clockwise"),
  opacity: anim("Opacity 0..1"),
  volume: anim("Gain of an audio clip, 1 = unchanged"),
  pan: anim("Stereo position -1 (left) .. 1 (right)"),
  blend: S.str("Blend mode: normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity, lighter"),
  crop: { type: "object", description: "Fractions 0..1 cut from each side of the source: { l, t, r, b }" },
  mask: { description: 'Mask in fractions of the layer box: { shape: "rect" | "ellipse", x, y, w, h, feather, invert }, or null to remove it', anyOf: [{ type: "object" }, { type: "null" }] },
  fadeIn: S.num("Audio fade in, seconds"),
  fadeOut: S.num("Audio fade out, seconds"),
  muted: S.bool("Mute an audio clip"),
  text: S.str("Text of a text clip (\\n for a line break)"),
  style: { type: "object", description: "Text style: { font, size (px), weight (100..900), italic, color (#rrggbb), align (left|center|right), lineHeight, tracking, stroke (#rrggbb or null), strokeW, bg (#rrggbb or null), bgPad, bgRadius, shadow (bool), boxW (wrap width px, 0 = no wrap), anim: { in, inDur, out, outDur } with in / out one of none, fade, slide-up, slide-down, slide-left, slide-right, pop, typewriter, chars, words, blur }" },
  shape: { type: "object", description: "Shape: { kind (rect|ellipse|line|polygon|star), w, h, fill (#rrggbb or null), stroke, strokeW, radius, points }" },
  color: S.str("Color of a solid (#rrggbb)"),
};

// tool arguments → clip properties of scene/model.js
function clipPatch(a) {
  const p = {};
  for (const k of ["name", "blend", "crop", "fadeIn", "fadeOut", "muted", "color", "shape"]) if (a[k] !== undefined) p[k] = a[k];
  for (const k of ["x", "y", "sx", "sy", "rot", "opacity", "volume", "pan"]) if (a[k] !== undefined) p[k] = toValue(a[k]);
  if (a.scale !== undefined) p.sx = p.sy = toValue(a.scale);
  if (a.mask !== undefined) p.mask = a.mask;
  if (a.text !== undefined || a.style !== undefined) p.text = { ...(a.style || {}), ...(a.text !== undefined ? { text: a.text } : {}) };
  return p;
}

export function sceneTools(app, session = {}) {
  const ctx = (o) => sceneCtx(app, o);
  return [
    tool("scene_describe", "Describes the open scene: frame size, frame rate, duration, tracks (top video track is in front), every clip (id, type, track, start, end, source in-point, speed, transform, keyframes, effects, transitions, text), media items (id, kind, duration, which analyses exist), markers, In / Out range, compositions, and the playhead. Call it before editing; ids come from here.", {
      seq: SEQ,
      from: S.num("Only clips that end after this time (seconds)"),
      to: S.num("Only clips that start before this time (seconds)"),
      limit: S.num("Maximum number of clips (default 200)"),
    }, [], async (a) => {
      const c = await ctx();
      return { document: c.doc.name, ...c.M.describeScene(c.model(), { seq: a.seq || "main", from: a.from ?? 0, to: a.to ?? Infinity, limit: Math.max(1, Math.min(1000, a.limit || 200)) }), playhead: r3(c.playhead()), selection: c.ui ? c.ui.selection() : [] };
    }, { readOnly: true }),

    tool("scene_list_options", "Lists what the Scene Studio offers: effect types with their parameters and ranges, transitions, text animations, easings, blend modes, sequence presets, templates, caption styles and motion presets (scene_animate).", {}, [], async () => {
      const [M, E, K, C] = await Promise.all([import("../../scene/model.js"), import("../../scene/effects.js"), import("../../scene/keyframes.js"), import("../../scene/captions.js")]);
      return {
        effects: E.effectCatalog().map((e) => ({ type: e.type, label: e.label, for: e.stage === "audio" ? "audio clips" : "picture clips", params: Object.fromEntries(e.params.map((p) => [p.name, p.color ? `color, default ${p.def}` : p.options ? `0..${p.options.length - 1}: ${p.options.join(", ")}` : `${p.min}..${p.max}, default ${p.def}`])) })),
        transitions: M.TRANSITION_TYPES,
        textAnimations: M.TEXT_ANIMS,
        easings: [...K.EASING_NAMES, "[x1, y1, x2, y2] (cubic bezier)"],
        blendModes: M.BLEND_MODES,
        presets: Object.fromEntries(Object.entries(M.PRESETS).map(([k, p]) => [k, `${p.width} × ${p.height}, ${p.fps} fps`])),
        templates: M.TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
        captionStyles: Object.keys(C.CAPTION_STYLES),
        motionPresets: Object.keys(MOTIONS),
      };
    }, { readOnly: true }),

    tool("scene_new", "Creates a new scene document and opens it in the Scene Studio. Presets: 1080p (default), 4k, 720p, vertical (9:16), square, portrait (4:5). Templates: blank, vertical, square, title (animated title card), lower-third.", {
      title: S.str("Document name"),
      template: S.str("Template id (default blank)"),
      preset: S.str("Frame preset when the template is blank"),
      width: S.num("Custom frame width in px"),
      height: S.num("Custom frame height in px"),
      fps: S.num("Frames per second (default 30)"),
    }, [], async (a) => {
      const [{ newScene }, M, { commitOffice }] = await Promise.all([import("../../scene/host.js"), import("../../scene/model.js"), import("../../core/office.js")]);
      const doc = newScene(app, { template: a.template || "blank", title: a.title || "" });
      if (a.preset || a.width || a.height || a.fps) {
        const p = M.PRESETS[a.preset] || {};
        commitOffice(doc, "Vibe: Set Format", M.normalizeScene({ ...doc.office.model, width: a.width || p.width || doc.office.model.width, height: a.height || p.height || doc.office.model.height, fps: a.fps || p.fps || doc.office.model.fps }));
      }
      return { ok: true, document: doc.name, ...M.describeScene(doc.office.model, { limit: 50 }) };
    }),

    tool("scene_set_sequence", "Changes the sequence: frame size (layers keep their place relative to the frame), frame rate, background color, title, or the In / Out range used by lift, extract and export.", {
      width: S.num("Frame width in px"),
      height: S.num("Frame height in px"),
      preset: S.str("Frame preset instead of width and height: 1080p, 4k, 720p, vertical, square, portrait"),
      fps: S.num("Frames per second"),
      background: S.str("Background color (#rrggbb)"),
      rangeIn: S.num("In point in seconds (with rangeOut)"),
      rangeOut: S.num("Out point in seconds"),
      clearRange: S.bool("Remove the In / Out range"),
    }, [], async (a) => {
      const c = await ctx();
      let m = c.model();
      const p = c.M.PRESETS[a.preset];
      const w = a.width || p?.width || m.width;
      const h = a.height || p?.height || m.height;
      if (w !== m.width || h !== m.height) {
        const fx = w / m.width;
        const fy = h / m.height;
        const k = Math.min(fx, fy);
        const sc = (v, f) => (v && typeof v === "object" ? { kf: v.kf.map((q) => ({ ...q, v: q.v * f })) } : v * f);
        m = { ...m, width: w, height: h, clips: Object.fromEntries(Object.entries(m.clips).map(([id, cl]) => [id, cl.type === "audio" ? cl : { ...cl, x: sc(cl.x, fx), y: sc(cl.y, fy), sx: sc(cl.sx, k), sy: sc(cl.sy, k) }])) };
      }
      if (a.fps) m = { ...m, fps: a.fps };
      if (a.background) m = { ...m, background: a.background };
      m = c.M.normalizeScene(m);
      if (a.clearRange) m = c.M.setRange(m, null, null);
      else if (a.rangeIn !== undefined && a.rangeOut !== undefined) m = c.M.setRange(m, a.rangeIn, a.rangeOut);
      c.commit("Change Sequence", m);
      return { ok: true, width: m.width, height: m.height, fps: m.fps, background: m.background, range: m.range };
    }),

    tool("scene_add_clip", "Adds a clip to the timeline and returns its id. Types: media (a video, audio or image item from scene_describe ▸ media; a video with sound also gets its audio clip), text, shape, solid, adjustment (its effects apply to everything below) or comp (a composition). Whatever the clip covers on its track is overwritten; without a track the first free one is used. For media, `fit` places the picture: fit (default), fill or none.", {
      type: S.str("media, text, shape, solid, adjustment or comp", { enum: ["media", "text", "shape", "solid", "adjustment", "comp"] }),
      media: S.str("Media id (type media)"),
      comp: S.str("Composition id (type comp)"),
      start: S.num("Start on the timeline in seconds (default: the end of the sequence for media, else the playhead)"),
      dur: S.num("Duration in seconds (default: the media's length, 5 for the others)"),
      sourceIn: S.num("Source offset in seconds for video and audio (default 0)"),
      track: S.str("Track id or name (V1, A2 …)"),
      fit: S.str("fit, fill or none (media pictures)", { enum: ["fit", "fill", "none"] }),
      withAudio: S.bool("Also add the sound of a video (default true)"),
      seq: SEQ,
      ...CLIP_PROPS,
    }, ["type"], async (a) => {
      const c = await ctx();
      const out = { ids: [] };
      const next = c.M.inSequence(c.model(), a.seq, (m) => {
        const trackId = a.track ? (m.tracks.find((t) => t.id === a.track || t.name.toLowerCase() === String(a.track).toLowerCase())?.id ?? (() => { throw new Error(`There is no track “${a.track}”. Tracks: ${m.tracks.map((t) => t.name).join(", ")}.`); })()) : undefined;
        const patch = clipPatch(a);
        if (a.type === "media") {
          const md = m.media[a.media];
          if (!md) throw new Error(`There is no media item “${a.media}”. Media: ${Object.values(m.media).map((x) => `${x.id} (${x.name})`).join(", ") || "none: import files first"}.`);
          const r = c.M.placeMedia(m, a.media, { start: a.start ?? null, track: trackId ?? null, dur: a.dur ?? null, fit: a.fit || "fit", withAudio: a.withAudio !== false });
          let mm = r.model;
          out.ids = r.ids;
          for (const id of r.ids) {
            const cl = mm.clips[id];
            const own = cl.type === "audio" ? Object.fromEntries(Object.entries(patch).filter(([k]) => ["volume", "pan", "fadeIn", "fadeOut", "muted", "name"].includes(k))) : Object.fromEntries(Object.entries(patch).filter(([k]) => !["volume", "pan", "fadeIn", "fadeOut", "muted"].includes(k)));
            if (a.sourceIn) own.in = a.sourceIn;
            if (Object.keys(own).length) mm = c.M.updateClip(mm, id, own);
          }
          return mm;
        }
        const r = c.M.addClip(m, { type: a.type, comp: a.comp, start: a.start ?? c.playhead(), dur: a.dur ?? 5, track: trackId, ...patch });
        out.ids = [r.id];
        return r.model;
      });
      c.commit("Add Clip", next);
      const m = c.M.sequence(c.model(), a.seq);
      return { ok: true, ids: out.ids, clips: out.ids.map((id) => c.M.describeClip(m, m.clips[id])) };
    }),

    tool("scene_update_clips", "Changes properties of one or more clips: transform (x, y, scale, rot, opacity; each a constant or keyframes), text and its style, shape, color, crop, mask, blend mode, sound (volume, pan, fades, muted), name. Only the given properties change. To move, trim or split clips use scene_arrange.", {
      ids: ids("Clip ids"),
      seq: SEQ,
      ...CLIP_PROPS,
    }, ["ids"], async (a) => {
      const c = await ctx();
      const patch = clipPatch(a);
      if (!Object.keys(patch).length) throw new Error("Give at least one property to change.");
      const next = c.M.inSequence(c.model(), a.seq, (m) => a.ids.reduce((mm, id) => {
        const cl = mm.clips[id];
        if (!cl) throw new Error(`There is no clip “${id}”.`);
        const own = Object.fromEntries(Object.entries(patch).filter(([k]) => (cl.type === "audio" ? !["x", "y", "sx", "sy", "rot", "opacity", "blend", "crop", "mask", "text", "shape", "color"].includes(k) : true)));
        return c.M.updateClip(mm, id, own);
      }, m));
      c.commit("Change Clip", next);
      const m = c.M.sequence(c.model(), a.seq);
      return { ok: true, clips: a.ids.map((id) => c.M.describeClip(m, m.clips[id])) };
    }),

    tool("scene_arrange", "Edits clips in time, one action per call: move (to a start time and / or track), trim (an edge to a time; ripple pulls the later clips of the track along), split (at a time; without ids every clip under that time), delete (ripple closes the gap), duplicate, slip (shift the source under the clip by delta seconds), speed (ripple optional), closeGaps (one track or all).", {
      action: S.str("move, trim, split, delete, duplicate, slip, speed or closeGaps", { enum: ["move", "trim", "split", "delete", "duplicate", "slip", "speed", "closeGaps"] }),
      ids: { type: "array", items: { type: "string" }, description: "Clip ids (not needed for closeGaps, optional for split)" },
      start: S.num("move: new start of the FIRST clip (the others keep their offsets); duplicate: where the copies start"),
      track: S.str("move: target track id or name; closeGaps: only this track"),
      edge: S.str("trim: start or end", { enum: ["start", "end"] }),
      to: S.num("trim: the timeline time the edge moves to"),
      at: S.num("split: timeline time"),
      delta: S.num("slip: seconds"),
      speed: S.num("speed: 1 = normal, 2 = double, 0.5 = half"),
      ripple: S.bool("trim, delete, speed: later clips of the track follow"),
      seq: SEQ,
    }, ["action"], async (a) => {
      const c = await ctx();
      const out = {};
      const next = c.M.inSequence(c.model(), a.seq, (m) => {
        const need = () => {
          if (!a.ids?.length) throw new Error(`“${a.action}” needs clip ids.`);
          for (const id of a.ids) if (!m.clips[id]) throw new Error(`There is no clip “${id}”.`);
          return a.ids;
        };
        const trackId = a.track ? m.tracks.find((t) => t.id === a.track || t.name.toLowerCase() === String(a.track).toLowerCase())?.id : undefined;
        if (a.track && !trackId) throw new Error(`There is no track “${a.track}”.`);
        switch (a.action) {
          case "move": {
            const list = need().map((id) => m.clips[id]).sort((x, y) => x.start - y.start);
            const dt = a.start === undefined ? 0 : a.start - list[0].start;
            if (trackId && list.length === 1) return c.M.moveClip(m, list[0].id, { start: a.start, track: trackId });
            return c.M.moveClips(m, a.ids, dt, 0);
          }
          case "trim":
            if (!a.edge || a.to === undefined) throw new Error("trim needs edge and to.");
            return need().reduce((mm, id) => c.M.trimClip(mm, id, a.edge, a.to, { ripple: !!a.ripple }), m);
          case "split": {
            if (a.at === undefined) throw new Error("split needs at.");
            if (!a.ids?.length) {
              const r = c.M.splitAll(m, a.at);
              out.newIds = r.ids;
              return r.model;
            }
            out.newIds = [];
            return need().reduce((mm, id) => {
              const r = c.M.splitClip(mm, id, a.at);
              if (r.id) out.newIds.push(r.id);
              return r.model;
            }, m);
          }
          case "delete":
            return c.M.deleteClips(m, need(), { ripple: !!a.ripple });
          case "duplicate": {
            const r = c.M.duplicateClips(m, need(), a.start ?? null);
            out.newIds = r.ids;
            return r.model;
          }
          case "slip":
            return need().reduce((mm, id) => c.M.slipClip(mm, id, a.delta || 0), m);
          case "speed":
            if (!(a.speed > 0)) throw new Error("speed needs a positive speed.");
            return need().reduce((mm, id) => c.M.setSpeed(mm, id, a.speed, { ripple: !!a.ripple }), m);
          case "closeGaps":
            return c.M.closeGaps(m, trackId || null);
          default:
            throw new Error(`Unknown action “${a.action}”.`);
        }
      });
      c.commit({ move: "Move Clip", trim: "Trim Clip", split: "Split Clip", delete: "Delete Clip", duplicate: "Duplicate Clip", slip: "Slip Clip", speed: "Change Speed", closeGaps: "Close Gaps" }[a.action], next);
      const m = c.M.sequence(c.model(), a.seq);
      return { ok: true, ...out, duration: r3(c.M.duration(m)), clips: [...(a.ids || []), ...(out.newIds || [])].filter((id) => m.clips[id]).map((id) => ({ id, start: r3(m.clips[id].start), end: r3(c.M.clipEnd(m.clips[id])), track: c.M.trackOf(m, m.clips[id].track).name })) };
    }),

    tool("scene_cut_ranges", "Removes time ranges from the WHOLE sequence and closes the gaps (ripple delete across all unlocked tracks), or keeps only the given ranges (mode keep): the tool for cutting out mistakes, pauses and off-topic parts, and for building a highlight reel. Ranges are timeline seconds and may overlap. Returns the new duration.", {
      ranges: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: "[[start, end], …] in timeline seconds", minItems: 1 },
      mode: S.str("remove (default) or keep", { enum: ["remove", "keep"] }),
    }, ["ranges"], async (a) => {
      const c = await ctx();
      const before = c.M.duration(c.model());
      const next = a.mode === "keep" ? c.M.keepRanges(c.model(), a.ranges) : c.M.cutRanges(c.model(), a.ranges);
      c.commit(a.mode === "keep" ? "Keep Ranges" : "Cut Ranges", next);
      return { ok: true, durationBefore: r3(before), duration: r3(c.M.duration(c.model())), removed: r3(before - c.M.duration(c.model())) };
    }),

    tool("scene_set_keyframes", "Animates a property of a clip: replaces its keyframes (or clears the animation with a constant value). Properties: x, y, sx, sy, scale (sets sx and sy), rot, opacity, volume, pan, or fx:<effect id>:<parameter>. Keyframe times are seconds from the clip start; `e` is the easing of the segment that leaves the keyframe: linear, ease, easeIn, easeOut, easeInOut, back (overshoot), hold, or [x1, y1, x2, y2].", {
      id: S.str("Clip id"),
      property: S.str("Property path"),
      keyframes: { type: "array", items: { type: "object", properties: { t: { type: "number" }, v: {}, e: {} }, required: ["t", "v"] }, description: "[{ t, v, e }] sorted by time; omit to clear the animation" },
      value: { description: "Constant value when keyframes are omitted" },
      seq: SEQ,
    }, ["id", "property"], async (a) => {
      const c = await ctx();
      const paths = a.property === "scale" ? ["sx", "sy"] : [a.property];
      const next = c.M.inSequence(c.model(), a.seq, (m) => paths.reduce((mm, path) => {
        const cl = mm.clips[a.id];
        if (!cl) throw new Error(`There is no clip “${a.id}”.`);
        if (a.keyframes?.length) {
          // set through the model so the path is validated, then install the whole track
          const first = a.keyframes[0];
          let x = c.M.setProp(mm, a.id, path, first.v);
          for (const k of a.keyframes) x = c.M.setKeyframe(x, a.id, path, cl.start + Math.max(0, Math.min(cl.dur, k.t)), k.v, k.e);
          return x;
        }
        if (a.value === undefined) throw new Error("Give keyframes or a constant value.");
        return c.M.setProp(mm, a.id, path, a.value);
      }, m));
      c.commit("Animate", next);
      const m = c.M.sequence(c.model(), a.seq);
      return { ok: true, clip: c.M.describeClip(m, m.clips[a.id]) };
    }),

    tool("scene_animate", "Applies a ready-made motion to clips by writing keyframes (see scene_list_options ▸ motionPresets): fade-in, fade-out, slide-in (from: left|right|top|bottom), slide-out, pop-in, zoom-in, zoom-out, ken-burns (slow zoom and drift for stills), drift, pulse, shake, spin, float. `dur` is the length of the motion in seconds (default: sensible per preset, the whole clip for ken-burns, drift, pulse, float); `at` is start (default) or end of the clip.", {
      ids: ids("Clip ids"),
      motion: S.str("Motion preset"),
      dur: S.num("Length of the motion in seconds"),
      from: S.str("Direction for slide-in / slide-out: left, right, top, bottom", { enum: ["left", "right", "top", "bottom"] }),
      amount: S.num("Strength, 1 = default"),
      seq: SEQ,
    }, ["ids", "motion"], async (a) => {
      const c = await ctx();
      const fn = MOTIONS[a.motion];
      if (!fn) throw new Error(`Unknown motion “${a.motion}”. Use one of: ${Object.keys(MOTIONS).join(", ")}.`);
      const { valueAt } = await import("../../scene/keyframes.js");
      const next = c.M.inSequence(c.model(), a.seq, (m) => a.ids.reduce((mm, id) => {
        const cl = mm.clips[id];
        if (!cl) throw new Error(`There is no clip “${id}”.`);
        if (cl.type === "audio") throw new Error("Motions are for picture clips. For sound use fadeIn / fadeOut or volume keyframes.");
        const base = { x: valueAt(cl.x, 0), y: valueAt(cl.y, 0), sx: valueAt(cl.sx, 0), sy: valueAt(cl.sy, 0), rot: valueAt(cl.rot, 0), opacity: valueAt(cl.opacity, 0) };
        const size = c.M.layerSize(mm, cl);
        const tracks = fn({ dur: cl.dur, len: a.dur, from: a.from, k: a.amount || 1, base, W: mm.width, H: mm.height, w: size.w * base.sx, h: size.h * base.sy });
        return c.M.updateClip(mm, id, Object.fromEntries(Object.entries(tracks).map(([p, kf]) => [p, { kf }])));
      }, m));
      c.commit("Animate", next);
      return { ok: true, animated: a.ids.length, motion: a.motion };
    }),

    tool("scene_effects", "Adds, changes or removes effects of a clip (types and parameters: scene_list_options). Picture effects: blur, brightness, saturation, grayscale, sepia, invert, shadow, grade, look, chroma-key, duotone, vignette, posterize, grain, glow. Audio effects: eq, compressor, highpass, lowpass, gate. Numeric parameters can be animated afterwards with scene_set_keyframes (fx:<effect id>:<parameter>).", {
      id: S.str("Clip id"),
      action: S.str("add, update or remove", { enum: ["add", "update", "remove"] }),
      type: S.str("Effect type (add)"),
      effect: S.str("Effect id from scene_describe (update, remove)"),
      params: { type: "object", description: "Parameter values" },
      on: S.bool("Switch the effect on or off (update)"),
      seq: SEQ,
    }, ["id", "action"], async (a) => {
      const c = await ctx();
      const E = await import("../../scene/effects.js");
      const out = {};
      const next = c.M.inSequence(c.model(), a.seq, (m) => {
        const cl = m.clips[a.id];
        if (!cl) throw new Error(`There is no clip “${a.id}”.`);
        if (a.action === "add") {
          const def = E.EFFECTS[a.type];
          if (!def) throw new Error(`“${a.type}” is not an effect. Use one of: ${Object.keys(E.EFFECTS).join(", ")}.`);
          if ((def.stage === "audio") !== (cl.type === "audio")) throw new Error(`“${a.type}” is ${def.stage === "audio" ? "an audio" : "a picture"} effect; this clip is ${cl.type === "audio" ? "an audio" : "a picture"} clip.`);
          const r = c.M.addEffect(m, a.id, a.type, E.effectParams(a.type, a.params || {}));
          out.effect = r.id;
          return r.model;
        }
        if (!a.effect) throw new Error(`${a.action} needs the effect id.`);
        if (a.action === "remove") return c.M.removeEffect(m, a.id, a.effect);
        return c.M.updateEffect(m, a.id, a.effect, { p: a.params || {}, ...(a.on === undefined ? {} : { on: a.on }) });
      });
      c.commit({ add: "Add Effect", update: "Change Effect", remove: "Remove Effect" }[a.action], next);
      const m = c.M.sequence(c.model(), a.seq);
      return { ok: true, ...out, effects: c.M.describeClip(m, m.clips[a.id]).effects || [] };
    }),

    tool("scene_set_transition", "Sets or removes the transition at the start (in) or end (out) of picture clips: fade, dissolve (cross dissolve from the previous clip of the same track), dip-black, dip-white, slide-left / right / up / down, wipe-left / right / up / down, zoom, blur. Pass type \"none\" to remove.", {
      ids: ids("Clip ids"),
      edge: S.str("in or out", { enum: ["in", "out"] }),
      type: S.str("Transition type or none"),
      dur: S.num("Duration in seconds (default 0.5)"),
      seq: SEQ,
    }, ["ids", "edge", "type"], async (a) => {
      const c = await ctx();
      const next = c.M.inSequence(c.model(), a.seq, (m) => a.ids.reduce((mm, id) => c.M.setTransition(mm, id, a.edge, a.type === "none" ? null : a.type, a.dur ?? 0.5), m));
      c.commit("Set Transition", next);
      return { ok: true, clips: a.ids.length };
    }),

    tool("scene_tracks", "Adds, removes, renames, reorders, hides, mutes or locks tracks. New video tracks go on top (in front), new audio tracks at the bottom.", {
      action: S.str("add, remove, update or move", { enum: ["add", "remove", "update", "move"] }),
      kind: S.str("add: video or audio", { enum: ["video", "audio"] }),
      track: S.str("Track id or name (remove, update, move)"),
      name: S.str("New name (add, update)"),
      hidden: S.bool("Hide a video track"),
      muted: S.bool("Mute an audio track"),
      locked: S.bool("Lock a track against edits"),
      delta: S.num("move: positions up (negative) or down among the tracks of its kind"),
      seq: SEQ,
    }, ["action"], async (a) => {
      const c = await ctx();
      const out = {};
      const next = c.M.inSequence(c.model(), a.seq, (m) => {
        const tk = a.track ? m.tracks.find((t) => t.id === a.track || t.name.toLowerCase() === String(a.track).toLowerCase()) : null;
        if (a.action !== "add" && !tk) throw new Error(`There is no track “${a.track}”. Tracks: ${m.tracks.map((t) => t.name).join(", ")}.`);
        if (a.action === "add") {
          const r = c.M.addTrack(m, a.kind || "video", { name: a.name || "" });
          out.id = r.id;
          return r.model;
        }
        if (a.action === "remove") return c.M.removeTrack(m, tk.id);
        if (a.action === "move") return c.M.moveTrack(m, tk.id, a.delta || 0);
        return c.M.updateTrack(m, tk.id, { name: a.name, hidden: a.hidden, muted: a.muted, locked: a.locked });
      });
      c.commit("Change Tracks", next);
      const m = c.M.sequence(c.model(), a.seq);
      return { ok: true, ...out, tracks: m.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, hidden: t.hidden, muted: t.muted, locked: t.locked })) };
    }),

    tool("scene_markers", "Adds or removes markers (named points on the timeline, used for navigation and snapping), or replaces all of them.", {
      action: S.str("add, remove or clear", { enum: ["add", "remove", "clear"] }),
      markers: { type: "array", items: { type: "object", properties: { t: { type: "number" }, name: { type: "string" }, color: { type: "string" } }, required: ["t"] }, description: "add: [{ t, name, color }]" },
      ids: { type: "array", items: { type: "string" }, description: "remove: marker ids" },
    }, ["action"], async (a) => {
      const c = await ctx();
      let m = c.model();
      if (a.action === "clear") m = { ...m, markers: [] };
      else if (a.action === "remove") for (const id of a.ids || []) m = c.M.removeMarker(m, id);
      else for (const k of a.markers || []) m = c.M.addMarker(m, k.t, k.name || "", k.color).model;
      c.commit("Change Markers", m);
      return { ok: true, markers: c.model().markers.map((k) => ({ id: k.id, t: r3(k.t), name: k.name })) };
    }),

    tool("scene_precompose", "Moves clips into a new composition and puts one composition clip in their place, so they can be transformed, animated and given effects as one layer. Returns the composition id (use it as `seq` to edit inside).", {
      ids: ids("Picture clip ids"),
      name: S.str("Composition name"),
    }, ["ids"], async (a) => {
      const c = await ctx();
      const r = c.M.precompose(c.model(), a.ids, a.name || "Composition");
      c.commit("Pre-compose", r.model);
      return { ok: true, clip: r.id, composition: r.comp };
    }),

    tool("scene_import_media", "Adds media to the scene's bin from a file attached in this chat (by name or index, see list_attachments) or from a page of another open OpenFini document (a vector, pixel or layout design rendered as an image: `document` name, `page` number). Returns the media id; place it with scene_add_clip. Subtitle files (.srt, .vtt) become caption clips.", {
      attachment: S.str("Attachment name (or part of it)"),
      index: S.num("1-based attachment position"),
      document: S.str("Name of an open design document to use as a picture"),
      page: S.num("Page of that document, from 1 (default 1)"),
      scale: S.num("Render scale for a document page (default 2, max 4)"),
    }, [], async (a) => {
      const c = await ctx();
      const { probeMedia, mimeOf } = await import("../../scene/media.js");
      let file = null;
      if (a.document) {
        const d = (app.docs || []).find((x) => x.name === a.document) || (app.docs || []).find((x) => x.name.toLowerCase().includes(String(a.document).toLowerCase()));
        if (!d || !d.pages?.length || d.office || d === c.doc) throw new Error(`There is no open design document “${a.document}”.`);
        const page = d.pages[Math.max(0, (a.page || 1) - 1)] || d.pages[0];
        const [{ buildPageDL }, { renderToCanvas }, { canvasToBytes }] = await Promise.all([import("../../engine/dl.js"), import("../../engine/backends/canvas.js"), import("../../core/ofini.js")]).catch(() => { throw new Error("Rendering a document page is not available here."); });
        const cv = renderToCanvas(buildPageDL(d, page), { scale: Math.max(0.25, Math.min(4, a.scale || 2)), bg: null });
        file = { name: `${d.name} p${(a.page || 1)}.png`, mime: "image/png", bytes: await canvasToBytes(cv) };
      } else {
        const all = session.attachments?.() || [];
        if (!all.length) throw new Error("No files are attached in this chat. Ask the user to attach the video, sound or image with the paperclip button, or to drop it into the Scene Studio's Media panel.");
        const f = a.index != null ? all[a.index - 1] : a.attachment ? all.find((x) => x.name === a.attachment) || all.find((x) => x.name.toLowerCase().includes(String(a.attachment).toLowerCase())) : all.length === 1 ? all[0] : null;
        if (!f) throw new Error(`No attachment matches. Attached: ${all.map((x, i) => `${i + 1}. ${x.name}`).join(", ")}.`);
        file = { name: f.name, mime: f.type || mimeOf(f.name), bytes: new Uint8Array(await f.file.arrayBuffer()) };
      }
      if (/\.(srt|vtt)$/i.test(file.name)) {
        const { parseSubtitles, captionsToClips } = await import("../../scene/captions.js");
        const r = captionsToClips(c.model(), parseSubtitles(new TextDecoder().decode(file.bytes)));
        c.commit("Import Captions", r.model);
        return { ok: true, captions: r.ids.length };
      }
      const item = await probeMedia(file.bytes, file.name, file.mime);
      const r = c.M.addMedia(c.model(), item);
      c.commit("Import Media", r.model);
      const md = c.model().media[r.id];
      return { ok: true, media: { id: r.id, kind: md.kind, name: md.name, duration: r3(md.duration), w: md.w, h: md.h, hasAudio: md.hasAudio } };
    }),

    tool("scene_render_frame", "Renders the picture of the scene at a time so you can SEE your work (exactly seeked sources, all effects). Look after every significant change. With `times` you get one contact sheet of several frames with their time printed on each, which shows motion and cuts at a glance.", {
      t: S.num("Timeline time in seconds (default: the playhead)"),
      times: { type: "array", items: { type: "number" }, description: "Several times for a contact sheet (max 16)", maxItems: 16 },
      from: S.num("Contact sheet over a range: start (with to and count)"),
      to: S.num("Contact sheet over a range: end"),
      count: S.num("Number of evenly spaced frames in the range (default 8, max 16)"),
      maxSize: S.num("Longest side in px of a single frame (default 960, max 1600)"),
      seq: SEQ,
    }, [], async (a) => {
      const c = await ctx();
      const [{ createExactRenderer }, U] = await Promise.all([import("../../scene/frames.js"), import("../../scene/understand.js")]);
      const m = c.M.sequence(c.model(), a.seq);
      const store = await c.store();
      const renderer = createExactRenderer(store);
      let times = a.times?.length ? a.times : null;
      if (!times && a.from !== undefined && a.to !== undefined) {
        const n = Math.max(2, Math.min(16, a.count || 8));
        times = Array.from({ length: n }, (_, i) => a.from + ((a.to - a.from) * i) / (n - 1));
      }
      if (times) {
        const cell = 320;
        const sheet = await U.contactSheet(async (t) => {
          const cv = await renderer.render(c.model(), t, { seq: a.seq, scale: cell / m.width });
          return createImageBitmap(cv);
        }, times, { cols: times.length <= 4 ? times.length : 4, cellW: cell, aspect: m.width / m.height });
        const img = await U.canvasToBase64(sheet);
        return [{ type: "text", text: `Contact sheet of “${c.doc.name}”: ${times.length} frames at ${times.map((t) => `${r3(t)} s`).join(", ")} (left to right, top to bottom).` }, { type: "image", mime: img.mime, data: img.data }];
      }
      const t = a.t ?? c.playhead();
      const scale = Math.min(1, Math.max(200, Math.min(1600, a.maxSize || 960)) / Math.max(m.width, m.height));
      const cv = await renderer.render(c.model(), t, { seq: a.seq, scale });
      const img = await U.canvasToBase64(cv);
      const { frameState } = await import("../../scene/evaluate.js");
      const layers = frameState(c.model(), t, { seq: a.seq }).layers.map((l) => `${l.clip.id} (${l.type}${l.type === "text" ? `: “${l.clip.text.text.slice(0, 40)}”` : ""})`);
      return [{ type: "text", text: `“${c.doc.name}” at ${r3(t)} s (${c.M.timecode(c.model(), t)}), ${img.width} × ${img.height} px. Layers, bottom first: ${layers.join(", ") || "none (background only)"}.` }, { type: "image", mime: img.mime, data: img.data }];
    }, { readOnly: true, exclusive: true }),

    tool("scene_playback", "Moves the playhead, selects clips or starts / stops playback in the Scene Studio so the user sees what you mean. Has no effect on the document.", {
      seek: S.num("Move the playhead to this time (seconds)"),
      select: { type: "array", items: { type: "string" }, description: "Clip ids to select" },
      play: S.bool("true starts playback, false stops it"),
      show: S.bool("Switch to the Scene Studio (default false)"),
    }, [], async (a) => {
      const c = await ctx();
      if (a.show && app.studio !== "scene") {
        if (app.doc !== c.doc) app.activateDoc?.(c.doc);
        app.setStudio("scene");
        await new Promise((r) => setTimeout(r, 400));
      }
      const ui = app.sceneUI?.doc === c.doc ? app.sceneUI : null;
      if (!ui) return { ok: false, note: "The scene's workspace is not on screen. Pass show: true to switch to the Scene Studio." };
      if (a.seek !== undefined) ui.seek(a.seek);
      if (a.select) ui.select(a.select.filter((id) => c.model().clips[id]));
      if (a.play === true) ui.play();
      if (a.play === false) ui.pause();
      return { ok: true, playhead: r3(ui.state.t), playing: ui.playing, selection: ui.selection() };
    }, { readOnly: true }),

    tool("scene_export", "Exports the scene to a file the user saves: mp4 (H.264 with sound), webm, gif, frames (PNG sequence as ZIP), wav (sound only) or png (one frame). Asks the user, renders with progress, then opens the save dialog. Check scene_render_frame first; exporting takes about as long as the video plays.", {
      format: S.str("mp4 (default), webm, gif, frames, wav or png", { enum: ["mp4", "webm", "gif", "frames", "wav", "png"] }),
      scale: S.num("Size factor 0.1..1 (default 1)"),
      fps: S.num("Frames per second (default: the sequence's; GIF 15)"),
      quality: S.num("0.1..1 (default 0.7)"),
      useRange: S.bool("Export only the In / Out range"),
      t: S.num("png: the time of the frame"),
    }, [], async (a) => {
      const c = await ctx();
      const [{ exportScene, exportSupport }, { platform }, { downloadName }] = await Promise.all([import("../../scene/export.js"), import("../../platform/index.js"), import("../../core/util.js")]);
      const format = a.format || "mp4";
      const sup = await exportSupport();
      if ((format === "mp4" && !sup.mp4) || (format === "webm" && !sup.webm)) throw new Error(`This browser cannot encode ${format}. Available: ${["mp4", "webm"].filter((f) => sup[f]).concat(["gif", "frames", "wav", "png"]).join(", ")}.`);
      const m = c.model();
      const res = await exportScene(await c.store(), m, { format, scale: a.scale || 1, fps: a.fps, quality: a.quality, range: format === "png" ? { in: a.t ?? c.playhead(), out: (a.t ?? c.playhead()) + 1 } : a.useRange && m.range ? m.range : null });
      const saved = await platform.saveFile({ suggestedName: downloadName(c.doc.name, res.ext), bytes: res.bytes, mime: res.mime, filters: [{ name: res.ext.toUpperCase(), extensions: [res.ext] }] }).catch(() => null);
      return { ok: !!saved, saved: saved?.name || null, format: res.ext, bytes: res.bytes.length, width: res.width, height: res.height, codec: res.codec, audioCodec: res.audioCodec, notes: res.notes, ...(saved ? {} : { note: "The user cancelled the save dialog." }) };
    }, { needsApproval: (a) => `Export the scene as ${a.format || "mp4"}? Rendering takes about as long as the video plays.`, alwaysAsk: true, exclusive: true }),
  ];
}

// ---------------------------------------------------------------------------------------------- motion presets
// Each returns { <property>: [{ t, v, e }] } in clip-local seconds from: dur (clip length), len (requested motion
// length), from (direction), k (strength), base (current values), W / H (frame), w / h (layer size on screen).
const edge = (o, dir) => {
  const d = dir || "left";
  if (d === "left") return { x: -o.w / 2 - 20 };
  if (d === "right") return { x: o.W + o.w / 2 + 20 };
  if (d === "top") return { y: -o.h / 2 - 20 };
  return { y: o.H + o.h / 2 + 20 };
};
export const MOTIONS = {
  "fade-in": (o) => ({ opacity: [{ t: 0, v: 0, e: "easeOut" }, { t: Math.min(o.dur, o.len || 0.6), v: o.base.opacity }] }),
  "fade-out": (o) => ({ opacity: [{ t: Math.max(0, o.dur - (o.len || 0.6)), v: o.base.opacity, e: "easeIn" }, { t: o.dur, v: 0 }] }),
  "slide-in": (o) => {
    const s = edge(o, o.from);
    const L = Math.min(o.dur, o.len || 0.6);
    return Object.fromEntries(Object.entries(s).map(([p, v]) => [p, [{ t: 0, v, e: "easeOut" }, { t: L, v: o.base[p] }]]));
  },
  "slide-out": (o) => {
    const s = edge(o, o.from || "right");
    const L = Math.min(o.dur, o.len || 0.6);
    return Object.fromEntries(Object.entries(s).map(([p, v]) => [p, [{ t: o.dur - L, v: o.base[p], e: "easeIn" }, { t: o.dur, v }]]));
  },
  "pop-in": (o) => {
    const L = Math.min(o.dur, o.len || 0.45);
    return { sx: [{ t: 0, v: 0, e: "back" }, { t: L, v: o.base.sx }], sy: [{ t: 0, v: 0, e: "back" }, { t: L, v: o.base.sy }], opacity: [{ t: 0, v: 0 }, { t: L * 0.4, v: o.base.opacity }] };
  },
  "zoom-in": (o) => {
    const L = Math.min(o.dur, o.len || o.dur);
    const f = 1 + 0.25 * o.k;
    return { sx: [{ t: 0, v: o.base.sx, e: "easeInOut" }, { t: L, v: o.base.sx * f }], sy: [{ t: 0, v: o.base.sy, e: "easeInOut" }, { t: L, v: o.base.sy * f }] };
  },
  "zoom-out": (o) => {
    const L = Math.min(o.dur, o.len || o.dur);
    const f = 1 + 0.25 * o.k;
    return { sx: [{ t: 0, v: o.base.sx * f, e: "easeInOut" }, { t: L, v: o.base.sx }], sy: [{ t: 0, v: o.base.sy * f, e: "easeInOut" }, { t: L, v: o.base.sy }] };
  },
  "ken-burns": (o) => {
    const f = 1 + 0.12 * o.k;
    const dx = o.W * 0.03 * o.k;
    return { sx: [{ t: 0, v: o.base.sx, e: "linear" }, { t: o.dur, v: o.base.sx * f }], sy: [{ t: 0, v: o.base.sy, e: "linear" }, { t: o.dur, v: o.base.sy * f }], x: [{ t: 0, v: o.base.x - dx }, { t: o.dur, v: o.base.x + dx }] };
  },
  drift: (o) => ({ x: [{ t: 0, v: o.base.x - o.W * 0.04 * o.k }, { t: o.dur, v: o.base.x + o.W * 0.04 * o.k }] }),
  pulse: (o) => {
    const n = Math.max(1, Math.round(o.dur / (o.len || 1)));
    const kf = (b) => Array.from({ length: n * 2 + 1 }, (_, i) => ({ t: (o.dur * i) / (n * 2), v: i % 2 ? b * (1 + 0.08 * o.k) : b, e: "easeInOut" }));
    return { sx: kf(o.base.sx), sy: kf(o.base.sy) };
  },
  shake: (o) => {
    const L = Math.min(o.dur, o.len || 0.5);
    const n = Math.max(4, Math.round(L * 24));
    // deterministic offsets: the same clip always shakes the same way
    const off = (i, s) => Math.sin(i * 12.9898 + s) * 43758.5453 % 1;
    const amp = 14 * o.k;
    return { x: Array.from({ length: n + 1 }, (_, i) => ({ t: (L * i) / n, v: o.base.x + (i === n ? 0 : off(i, 1) * amp) })), y: Array.from({ length: n + 1 }, (_, i) => ({ t: (L * i) / n, v: o.base.y + (i === n ? 0 : off(i, 2) * amp) })) };
  },
  spin: (o) => ({ rot: [{ t: 0, v: o.base.rot, e: o.len ? "easeInOut" : "linear" }, { t: Math.min(o.dur, o.len || o.dur), v: o.base.rot + 360 * o.k }] }),
  float: (o) => {
    const n = Math.max(1, Math.round(o.dur / (o.len || 2)));
    return { y: Array.from({ length: n * 2 + 1 }, (_, i) => ({ t: (o.dur * i) / (n * 2), v: o.base.y + (i % 2 ? -10 * o.k : 10 * o.k), e: "easeInOut" })) };
  },
};
