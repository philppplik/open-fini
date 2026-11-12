// Vibe tools of the Scene Studio, group "Scene motion" (docs/scene-studio.md ▸ Assistant): parenting and null
// objects, behaviors (wiggle, loop, spin), sequence layers, keyframe edits, clip time (reverse, freeze, remap),
// links, effect order, sound-driven animation and beat markers. Static definitions; the logic loads on the first call
// (scene/ai-motion.js and scene/rig.js, pure and unit-tested). Every write tool is ONE undoable step ("Vibe: …").
import { tool, S } from "./helpers.js";
import { sceneEdit, T, IDS } from "./scene.js";

const mo = () => import("../../scene/ai-motion.js");
const PROP = S.str("Property: x, y, sx, sy, rot, opacity, ax, ay (anchor); position (x and y) or scale (sx and sy) for add", { enum: ["x", "y", "sx", "sy", "rot", "opacity", "ax", "ay", "position", "scale"] });

export function sceneMotionTools(app) {
  return [
    tool("scene_parent", "Parents clips to another picture clip so they move, turn and scale with it (After Effects parenting). parent: a clip id, null to unparent; nullObject: true creates an invisible null object over the clips' time and parents them to it (animate the null to move them all). Nothing jumps: values are converted at `at`.", {
      ids: IDS(), parent: S.str("Parent clip id; empty to unparent"), nullObject: S.bool("Create a null object and parent the clips to it"),
      name: S.str("Name of the null object"), x: S.num("Null position x (default: frame center)"), y: S.num("Null position y"), at: T("Time at which the look is kept (default: the clips' start)"),
    }, ["ids"], (a) => sceneEdit(app, "Parent", async (m) => (await mo()).parent(m, a))),

    tool("scene_behavior", "Expression-like behaviors on a clip property without keyframes: wiggle (smooth random motion: amount, freq per second, seed), loop (repeat the keyframes after the last one: mode cycle, pingpong or offset), spin (rate units per second, e.g. degrees for rot). action add (prop position / scale adds to both axes), update or remove (behavior id from the result or scene_describe clips detail).", {
      id: S.str("Clip id"), action: S.str("add, update or remove", { enum: ["add", "update", "remove"] }), type: S.str("wiggle, loop or spin (add)", { enum: ["wiggle", "loop", "spin"] }), prop: PROP,
      amount: S.num("Wiggle amount in the property's units (pixels, degrees, 0.05 = 5 % scale)"), freq: S.num("Wiggle frequency per second"), seed: S.num("Wiggle seed (different seeds move differently)"),
      mode: S.str("Loop mode", { enum: ["cycle", "pingpong", "offset"] }), rate: S.num("Spin: units per second"), behavior: S.str("Behavior id (update, remove)"),
    }, ["id"], (a) => sceneEdit(app, "Behavior", async (m) => (await mo()).behavior(m, { action: "add", ...a }))),

    tool("scene_stagger", "Sequence layers: places the clips one after another on their tracks, each `step` seconds after the previous one's start, or (overlap) each at the previous one's end minus `overlap` seconds. order: selection (as given), track (top to bottom) or time.", {
      ids: IDS(), step: S.num("Delay between starts in seconds (default 0.2)"), overlap: S.num("Instead of step: overlap with the previous clip's end, seconds (0 = end to end)"),
      order: S.str("selection, track or time", { enum: ["selection", "track", "time"] }), from: T("Start of the first clip (default: where it is)"),
    }, ["ids"], (a) => sceneEdit(app, "Sequence Layers", async (m) => (await mo()).stagger(m, a))),

    tool("scene_keyframe_edit", "Edits keyframes of a clip as a selection: paths (default all animated, e.g. opacity, x, text.size, mask.feather, fx:<effect id>:<param>) and at (timeline times; default all). action move (by seconds), scale (factor around pivot: 2 = twice as slow), reverse (play the animation backwards), delete, ease (preset: linear, easyEase, easyEaseIn, easyEaseOut, hold, ease, easeIn, easeOut, easeInOut, back, bounce, elastic) or value.", {
      id: S.str("Clip id"), action: S.str("move, scale, reverse, delete, ease or value", { enum: ["move", "scale", "reverse", "delete", "ease", "value"] }),
      paths: { type: "array", items: { type: "string" }, description: "Property paths" }, at: { type: "array", items: { anyOf: [{ type: "number" }, { type: "string" }] }, description: "Timeline times of the keyframes" },
      by: S.num("move: seconds (negative = earlier)"), factor: S.num("scale: time factor"), pivot: T("scale: fixed time"), preset: S.str("ease: easing preset"), value: { description: "value: the new value (number or #rrggbb)" },
    }, ["id", "action"], (a) => sceneEdit(app, "Keyframes", async (m) => (await mo()).keyframeEdit(m, a))),

    tool("scene_clip_time", "Clip time of a video or composition clip: reverse (plays backwards), freeze (holds the frame at `at` for the rest of the clip; splits there), remap (on: time remapping keyframes you can then edit with scene_keyframes path remap for speed ramps; on: false turns it off).", {
      id: S.str("Clip id"), action: S.str("reverse, freeze or remap", { enum: ["reverse", "freeze", "remap"] }), at: T("freeze: timeline time of the held frame"), on: S.bool("remap: on (default) or off"),
    }, ["id", "action"], (a) => sceneEdit(app, "Clip Time", async (m) => (await mo()).clipTime(m, a))),

    tool("scene_link", "Links clips (they are selected, moved and trimmed together in the timeline; a placed video and its sound start linked) or unlinks them (detach audio).", {
      ids: IDS(), action: S.str("link or unlink", { enum: ["link", "unlink"] }),
    }, ["ids", "action"], (a) => sceneEdit(app, a.action === "unlink" ? "Unlink" : "Link", async (m) => (await mo()).link(m, a))),

    tool("scene_effect_order", "Effect stack of a clip: moves an effect (id or type) to index (0 = applied first) and / or resets its parameters to the defaults (removes their keyframes).", {
      id: S.str("Clip id"), effect: S.str("Effect id or type"), index: S.num("New position, 0 = first"), reset: S.bool("Reset the parameters"),
    }, ["id", "effect"], (a) => sceneEdit(app, "Effect Order", async (m) => (await mo()).effectOrder(m, a))),

    tool("scene_animate_with_sound", "Animates a property of a picture clip with the loudness of a sound clip (After Effects' audio to keyframes): one keyframe per frame from `min` (quiet) to `max` (loud), smoothed (0..0.95). prop scale, opacity, rot, x or y. The keyframes replace the property's animation and stay editable.", {
      id: S.str("Picture clip to animate"), audio: S.str("Audio clip (or video clip with sound) that drives it"), prop: S.str("scale, opacity, rot, x or y", { enum: ["scale", "opacity", "rot", "x", "y"] }),
      min: S.num("Value when quiet (scale 1 = 100 %)"), max: S.num("Value when loud"), smooth: S.num("Smoothing 0..0.95 (default 0.6)"),
    }, ["id", "audio"], async (a) => {
      const [rt, R, AN, M] = await Promise.all([import("../../scene/ai-runtime.js"), import("../../scene/rig.js"), import("../../scene/analysis.js"), import("../../scene/model.js")]);
      const ctx = await rt.sceneTarget(app);
      const m = ctx.model();
      const src = m.clips[a.audio];
      if (!src?.media) throw new Error(`There is no audio clip “${a.audio}”.`);
      const { channels, rate } = await rt.channelsOf(ctx, src.media, 16000);
      const levels = AN.levelsDb(AN.mixMono(channels), rate, { hop: 1 / Math.max(25, m.fps), win: 2 / Math.max(25, m.fps) });
      const prop = a.prop || "scale";
      const def = { scale: [1, 1.25], opacity: [0.3, 1], rot: [0, 15], x: [0, 40], y: [0, -40] }[prop] || [0, 1];
      const r = R.audioToKeyframes(ctx.model(), { id: a.id, prop, audio: a.audio, levels, min: a.min ?? def[0], max: a.max ?? def[1], smooth: a.smooth ?? 0.6 }, { setProp: M.setProp });
      ctx.commit("Animate with Sound", r.model);
      return { ok: true, keyframes: r.keys, prop };
    }),

    tool("scene_beat_markers", "Adds markers at the beats of a clip's sound (analyses it first when scene_analyze_audio has not), for cutting or animating on the beat. every: 2 = every second beat.", {
      id: S.str("Audio or video clip with sound"), every: S.num("Every n-th beat (default 1)"),
    }, ["id"], async (a) => {
      const [rt, R, M] = await Promise.all([import("../../scene/ai-runtime.js"), import("../../scene/rig.js"), import("../../scene/model.js")]);
      const ctx = await rt.sceneTarget(app);
      const c = ctx.model().clips[a.id];
      if (!c?.media) throw new Error(`There is no clip with sound “${a.id}”.`);
      if (!ctx.model().analysis?.[c.media]?.beats) {
        const res = await rt.analyzeAudioOf(ctx, c.media, { beats: true });
        ctx.commit("Analyze Sound", M.setAnalysis(ctx.model(), c.media, { silence: res.silence, loudness: res.loudness, beats: res.beats }));
      }
      const times = R.beatMarkerTimes(ctx.model(), c.media, { every: a.every || 1 });
      if (!times.length) return { ok: false, note: "No beats were found in this sound." };
      let next = ctx.model();
      for (const t of times) if (!next.markers.some((k) => Math.abs(k.t - t) < 0.5 / next.fps)) next = M.addMarker(next, t, "", "#22c55e").model;
      ctx.commit("Beat Markers", next);
      return { ok: true, markers: times.length, bpm: ctx.model().analysis[c.media].beats.bpm };
    }),
  ];
}
