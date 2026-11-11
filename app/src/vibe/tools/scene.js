// Vibe tools of the Scene Studio, group "Scene" (docs/scene-studio.md ▸ Assistant, ADR 0029): inspect, edit,
// animate, caption, look at frames and export. Static definitions; the logic loads on the first call
// (scene/ai-ops.js, pure and unit-tested; scene/ai-runtime.js for frames, media and export). Every write tool is ONE
// undoable step ("Vibe: …") on the active scene document. Understanding and automation tools: scene-understand.js.
import { tool, S } from "./helpers.js";

const rt = () => import("../../scene/ai-runtime.js");
const ops = () => import("../../scene/ai-ops.js");

/** Runs `fn(model, ctx)` → { model, result } on the active scene and commits it as one undo step. */
export async function sceneEdit(app, label, fn) {
  const ctx = await (await rt()).sceneTarget(app);
  const { model, result } = await fn(ctx.model(), ctx);
  ctx.commit(label, model);
  return result;
}

export const T = (d) => ({ anyOf: [{ type: "number" }, { type: "string" }], description: `${d} (seconds or a time code such as 1:05.5)` });
export const IDS = (d = "Clip ids from scene_describe") => ({ type: "array", items: { type: "string" }, minItems: 1, description: d });
const OBJ = (d, props) => ({ type: "object", description: d, ...(props ? { properties: props } : {}) });
const TEXT_STYLE = OBJ("Text style: font, size, weight (100-900), italic, color, align (left, center, right), lineHeight, tracking, stroke, strokeW, bg (box color), bgPad, bgRadius, shadow, boxW (wrap width, 0 = none), anim { in, inDur, out, outDur } with in/out from scene_catalog textAnimations");
const PROPS = OBJ("Clip properties: name, x, y (layer center in sequence pixels), scale, sx, sy, rot (degrees), opacity (0-1), blend, crop { l, t, r, b } (fractions), mask { shape: rect|ellipse, x, y, w, h (fractions of the layer), feather, invert } or null, text (string), style (text style), shape { kind, w, h, fill, stroke, strokeW, radius, points }, color (solid), volume, pan, fadeIn, fadeOut, muted. A number replaces keyframes of that property.");

export function sceneTools(app, ctxS = {}) {
  return [
    tool("scene_describe", "Describes the active scene compactly: format, duration, tracks, one line per clip (id, type, name, track, start–end, source, transform, transitions, effects, keyframed properties), markers, media items with their analysis (transcript, shots, silence, loudness, beats, notes), captions, playhead and selection. Call it first and after edits. Pass clips for full detail of some clips.", {
      from: T("Only clips after this timeline time"), to: T("Only clips before this timeline time"),
      clips: { type: "array", items: { type: "string" }, description: "Clip ids to describe in full (keyframes, effect parameters, text style)" },
      seq: S.str("Composition id to describe instead of the main sequence"),
    }, [], async (a) => {
      const [{ summary, time }, ctx] = await Promise.all([ops(), rt().then((r) => r.sceneTarget(app))]);
      const m = ctx.model();
      return { ...summary(m, { seq: a.seq || "main", from: a.from === undefined ? 0 : time(m, a.from), to: a.to === undefined ? Infinity : time(m, a.to), clips: a.clips }), playhead: ctx.ui ? Math.round(ctx.ui.state.t * 1000) / 1000 : null, selection: ctx.ui?.selection?.() || [] };
    }, { readOnly: true }),

    tool("scene_catalog", "Lists what the scene tools accept: effects with their parameters and ranges, transitions, blend modes, easings, text animations, shapes, caption styles, animatable property paths and size presets.", {}, [], async () => (await ops()).catalog(), { readOnly: true }),

    tool("scene_new", "Creates a new scene (video) document and opens it in the Scene Studio: template blank, vertical (9:16), square, title or lower-third, optional size and frame rate.", {
      template: S.str("blank (default), vertical, square, title or lower-third", { enum: ["blank", "vertical", "square", "title", "lower-third"] }),
      title: S.str("Document name"), width: S.num("Width in pixels"), height: S.num("Height in pixels"), fps: S.num("Frames per second (default 30)"),
    }, [], async (a) => {
      const { newScene } = await import("../../scene/host.js");
      const doc = newScene(app, { template: a.template || "blank", title: a.title || "" });
      if (a.width || a.height || a.fps) await sceneEdit(app, "Sequence Format", async (m) => (await ops()).sequenceFormat(m, a));
      return { ok: true, name: doc.name, format: `${doc.office.model.width}×${doc.office.model.height} @ ${doc.office.model.fps} fps` };
    }),

    tool("scene_set_format", "Changes the sequence: size (width/height or a preset: 1080p, 4k, 720p, vertical, square, portrait; clip positions and scales follow), frame rate, background color, title. To change the aspect ratio while keeping the subject in frame use scene_reframe.", {
      width: S.num("Width in pixels"), height: S.num("Height in pixels"), preset: S.str("Size preset", { enum: ["1080p", "4k", "720p", "vertical", "square", "portrait"] }),
      fps: S.num("Frames per second"), background: S.str("Background color #rrggbb"), title: S.str("Scene title"),
    }, [], (a) => sceneEdit(app, "Sequence Format", async (m) => (await ops()).sequenceFormat(m, a))),

    tool("scene_track", "Adds, removes, renames, mutes, hides, locks or reorders a track. Video tracks: the upper track is in front. Removing a track removes its clips.", {
      action: S.str("add, remove, update or move", { enum: ["add", "remove", "update", "move"] }),
      kind: S.str("video or audio (add)", { enum: ["video", "audio"] }), track: S.str("Track id or name (remove, update, move)"),
      name: S.str("New name"), muted: S.bool("Mute (update)"), hidden: S.bool("Hide (update)"), locked: S.bool("Lock (update)"),
      delta: S.num("Positions to move among tracks of its kind, negative = up (move)"), index: S.num("Position among tracks of its kind (add)"),
    }, ["action"], (a) => sceneEdit(app, "Track", async (m) => (await ops()).tracks(m, a))),

    tool("scene_import_media", "Imports video, audio, image or subtitle (.srt/.vtt) files into the scene's media bin: a file attached in this chat, or a direct URL (web access must be on; asks per domain). place: true also puts it at the end of the timeline. Returns media ids for scene_place_media.", {
      attachment: S.str("Name of a file attached in this chat"), url: S.str("Direct address of a media file (https)"),
      place: S.bool("Also place it on the timeline"), start: T("Timeline time when placing (default: the end)"),
    }, [], async (a, c) => {
      const R = await rt();
      const ctx = await R.sceneTarget(app);
      let file;
      if (a.attachment) {
        const list = ctxS.attachments?.() || [];
        const f = list.find((x) => x.name === a.attachment) || list.find((x) => x.name.toLowerCase().includes(String(a.attachment).toLowerCase()));
        if (!f) throw new Error(`No attached file matches “${a.attachment}”. Use list_attachments.`);
        file = { name: f.name, mime: f.type || f.file?.type || "", bytes: new Uint8Array(await f.file.arrayBuffer()) };
      } else if (a.url) {
        const [{ vibeStore }, W] = await Promise.all([import("../store.js"), import("../web-access.js")]);
        const web = W.normalizeWeb(vibeStore.settings.webAccess || {});
        if (!web.enabled) throw new Error("Web access is switched off. Ask the user to turn it on under Settings ▸ Artificial intelligence ▸ Web access, or to attach the file.");
        app.network?.assert("other");
        const r = await W.guardedFetch(a.url, web, { signal: c?.signal, maxBytes: 400 * 1048576, accept: "video/*,audio/*,image/*,text/vtt,application/x-subrip" });
        if (r.truncated) throw new Error("The file is larger than 400 MiB.");
        const name = decodeURIComponent(new URL(r.url || a.url).pathname.split("/").pop() || "media") || "media";
        file = { name, mime: (r.type || "").split(";")[0], bytes: r.bytes };
      } else throw new Error("Pass attachment or url.");
      return R.importFiles(ctx, [file], { place: !!a.place, start: a.start === undefined ? null : (await ops()).time(ctx.model(), a.start) });
    }, { alwaysAsk: true, needsApproval: (a) => (a.url ? `Download ${String(a.url).slice(0, 140)} into the scene? Only this one request is sent, with no cookies.` : false) }),

    tool("scene_place_media", "Places a media item on the timeline: a source range (sourceIn/sourceOut) at a timeline start (default: the end), on a track (default: the first free one), with speed. A video with sound also gets its audio clip. What it lands on is overwritten.", {
      media: S.str("Media id"), start: T("Timeline start"), sourceIn: S.num("Source start in seconds (default 0)"), sourceOut: S.num("Source end in seconds (default: the end)"),
      dur: S.num("Timeline duration (default: the source range; images 5 s)"), track: S.str("Track id or name"), speed: S.num("Playback rate, 1 = normal"),
      fit: S.str("fit (default, whole picture visible), fill (cover the frame) or none", { enum: ["fit", "fill", "none"] }), withAudio: S.bool("Place the sound of a video too (default true)"),
    }, ["media"], (a) => sceneEdit(app, "Place Media", async (m) => (await ops()).placeMedia(m, a))),

    tool("scene_add_layer", "Adds a text, shape, solid color, adjustment (effects apply to everything below) or image layer from start for dur seconds, with properties and effects. Returns its id.", {
      type: S.str("text, shape, solid, adjustment or image", { enum: ["text", "shape", "solid", "adjustment", "image"] }),
      start: T("Timeline start (default 0)"), dur: S.num("Duration in seconds (default 5)"), end: T("Timeline end instead of dur"),
      track: S.str("Video track id or name"), media: S.str("Image media id (type image)"),
      text: S.str("Text (type text)"), style: TEXT_STYLE, shape: OBJ("Shape: kind rect|ellipse|line|polygon|star, w, h, fill, stroke, strokeW, radius, points"),
      color: S.str("Solid color #rrggbb"), x: S.num("Center x in pixels"), y: S.num("Center y in pixels"), scale: S.num("Scale, 1 = 100 %"),
      rot: S.num("Rotation in degrees"), opacity: S.num("Opacity 0-1"), blend: S.str("Blend mode (scene_catalog)"), name: S.str("Layer name"),
      effects: { type: "array", items: { type: "object", properties: { type: S.str("Effect type"), params: OBJ("Parameters") }, required: ["type"] }, description: "Effects to add, e.g. [{ type: \"look\", params: { look: 1 } }]" },
    }, ["type"], (a) => sceneEdit(app, "Add Layer", async (m) => (await ops()).addLayer(m, a))),

    tool("scene_move_clips", "Moves clips in time (start = new start of the first clip, or by = seconds) and, for one clip, to another track (trackDelta moves several by rows). What they land on is overwritten.", {
      ids: IDS(), start: T("New start of the earliest clip"), by: S.num("Seconds to move (negative = earlier)"), track: S.str("Target track id or name (one clip)"), trackDelta: S.num("Rows to move several clips (negative = up)"),
    }, ["ids"], (a) => sceneEdit(app, "Move Clips", async (m) => (await ops()).moveClips(m, a))),

    tool("scene_trim_clip", "Trims a clip's start or end edge to a timeline time (or by seconds). ripple: later clips of the track follow. A media clip cannot grow past its source.", {
      id: S.str("Clip id"), edge: S.str("start or end", { enum: ["start", "end"] }), to: T("New edge time"), by: S.num("Seconds to move the edge"), ripple: S.bool("Close or open the gap (later clips follow)"),
    }, ["id", "edge"], (a) => sceneEdit(app, "Trim Clip", async (m) => (await ops()).trimClip(m, a))),

    tool("scene_split", "Splits clips at a timeline time: the given ids, or every clip under that time (optionally only on some tracks). Returns the ids of the new second halves.", {
      at: T("Split time"), ids: { type: "array", items: { type: "string" }, description: "Clip ids (default: all clips under the time)" }, tracks: { type: "array", items: { type: "string" }, description: "Only these tracks (ids or names)" },
    }, ["at"], (a) => sceneEdit(app, "Split", async (m) => (await ops()).split(m, a))),

    tool("scene_delete_clips", "Deletes clips. ripple: the later clips of each track close the gap (ripple delete).", {
      ids: IDS(), ripple: S.bool("Close the gaps"),
    }, ["ids"], (a) => sceneEdit(app, a.ripple ? "Ripple Delete" : "Delete Clips", async (m) => (await ops()).deleteClips(m, a))),

    tool("scene_set_speed", "Changes a video, audio or composition clip's playback rate (0.05-20; the duration follows, and a video's linked sound too). ripple: later clips follow.", {
      id: S.str("Clip id"), speed: S.num("Rate, 1 = normal, 2 = twice as fast"), ripple: S.bool("Later clips follow"), withAudio: S.bool("Change the linked sound too (default true)"),
    }, ["id", "speed"], (a) => sceneEdit(app, "Set Speed", async (m) => (await ops()).setSpeed(m, a))),

    tool("scene_update_clips", "Changes properties of one or more clips: transform, opacity, blend mode, crop, mask, text and its style, shape, color, sound. For animation use scene_keyframes; a plain number replaces that property's keyframes.", {
      ids: IDS(), props: PROPS,
    }, ["ids", "props"], (a) => sceneEdit(app, "Change Clips", async (m) => (await ops()).updateClips(m, a))),

    tool("scene_transition", "Sets or removes (type none) the transition at the in, out or both edges of picture clips: fade, dissolve (cross dissolve with the previous clip), dip-black, dip-white, slide-*, wipe-*, zoom, blur. Audio clips use scene_audio fades.", {
      ids: IDS(), edge: S.str("in, out or both", { enum: ["in", "out", "both"] }), type: S.str("Transition type or none"), dur: S.num("Seconds (default 0.5)"),
    }, ["ids", "type"], (a) => sceneEdit(app, "Transition", async (m) => (await ops()).setTransitions(m, a))),

    tool("scene_keyframes", "Animates one property of a clip with keyframes: x, y, sx, sy, rot, opacity, volume, pan or fx:<effect id>:<parameter>. keys [{ t, v, easing }] with t in seconds from the clip start (timeBase clip) or on the timeline; easing leaves the key: linear, ease, easeIn, easeOut, easeInOut, back, hold or [x1,y1,x2,y2]. mode set (add or change keys), replace (only these keys), remove (keys at those times), clear (constant value).", {
      id: S.str("Clip id"), prop: S.str("Property path"),
      keys: { type: "array", items: { type: "object", properties: { t: T("Key time"), v: { description: "Value: number, [numbers] or #rrggbb" }, easing: { description: "Easing name or [x1, y1, x2, y2]" } }, required: ["t"] }, description: "Keyframes" },
      mode: S.str("set (default), replace, remove or clear", { enum: ["set", "replace", "remove", "clear"] }), timeBase: S.str("clip (default) or timeline", { enum: ["clip", "timeline"] }),
      value: { description: "Constant value for mode clear (default: the value at the clip start)" },
    }, ["id", "prop"], (a) => sceneEdit(app, "Keyframes", async (m) => (await ops()).keyframes(m, a))),

    tool("scene_effect", "Adds, updates (parameters, on/off) or removes an effect on clips: color (brightness, saturation, color grade, look), keying (chroma-key), blur, stylize (shadow, glow, duotone, vignette, posterize, grain) or audio (eq, compressor, highpass, lowpass, gate). scene_catalog lists types and parameters; animate a parameter with scene_keyframes prop fx:<id>:<param>.", {
      ids: IDS(), action: S.str("add, update or remove", { enum: ["add", "update", "remove"] }), type: S.str("Effect type (add)"),
      effect: S.str("Effect id or type (update, remove)"), params: OBJ("Parameter values"), on: S.bool("Switch on or off (update)"),
    }, ["ids", "action"], (a) => sceneEdit(app, "Effect", async (m) => (await ops()).effects(m, a))),

    tool("scene_audio", "Sets the sound of clips (a video clip addresses its linked audio clip): volume as gain or dB, pan (-1 left … 1 right), fade in / out seconds, mute, three-band EQ in dB, or normalize to a loudness in LUFS (after scene_analyze_audio; -14 for social, -16 for podcasts, -23 broadcast). Animate volume with scene_keyframes.", {
      ids: IDS(), volume: S.num("Gain, 1 = unchanged"), volumeDb: S.num("Gain in dB (0 = unchanged, -6 = half)"), pan: S.num("-1 to 1"),
      fadeIn: S.num("Seconds"), fadeOut: S.num("Seconds"), muted: S.bool("Mute"), normalize: S.num("Target integrated loudness in LUFS"),
      eq: OBJ("Equalizer gains in dB", { low: S.num("Low shelf dB"), mid: S.num("Mid dB"), high: S.num("High shelf dB") }),
    }, ["ids"], (a) => sceneEdit(app, "Audio", async (m) => (await ops()).audio(m, a))),

    tool("scene_markers", "Adds, removes or clears timeline markers, or sets the In / Out range (action range with in and out; without in it clears the range).", {
      action: S.str("add, remove, clear or range", { enum: ["add", "remove", "clear", "range"] }), t: T("Marker time (add)"), name: S.str("Marker name"),
      color: S.str("#rrggbb"), id: S.str("Marker id (remove)"), in: T("Range start"), out: T("Range end"),
    }, ["action"], (a) => sceneEdit(app, "Markers", async (m) => (await ops()).markers(m, a))),

    tool("scene_cut_ranges", "Edits timeline ranges on all unlocked tracks: cut (remove and close the gaps), keep (keep only these ranges) or lift (remove and leave gaps). For transcript-based cuts use scene_cut_transcript.", {
      ranges: { type: "array", items: { type: "array", items: { anyOf: [{ type: "number" }, { type: "string" }] }, minItems: 2, maxItems: 2 }, minItems: 1, description: "[[start, end], …] in timeline seconds or time codes" },
      mode: S.str("cut (default), keep or lift", { enum: ["cut", "keep", "lift"] }),
    }, ["ranges"], (a) => sceneEdit(app, a.mode === "keep" ? "Keep Ranges" : "Cut Ranges", async (m) => (await ops()).cutTimeline(m, a))),

    tool("scene_captions", "Captions (subtitle clips on the Captions track, burned into the picture and exportable as SRT/VTT): create from cues [{ start, end, text }] or import SRT/VTT text (subtitles), edit one caption (id, text, start, end), style all (style classic|outline|bold|minimal plus overrides, y as a fraction of the height), or delete. For captions from speech use scene_auto_captions.", {
      action: S.str("create, import, edit, style or delete", { enum: ["create", "import", "edit", "style", "delete"] }),
      cues: { type: "array", items: { type: "object", properties: { start: T("Start"), end: T("End"), text: S.str("Caption text") }, required: ["start", "end", "text"] }, description: "Cues (create)" },
      subtitles: S.str("SRT or WebVTT text (import)"), style: S.str("classic, outline, bold or minimal"), overrides: TEXT_STYLE,
      replace: S.bool("Replace existing captions (create, import)"), y: S.num("Vertical position as a fraction of the height (default 0.86)"), offset: S.num("Seconds added to every cue time"),
      anim: S.str("Text animation of each caption, e.g. pop or fade"), id: S.str("Caption clip id (edit)"), text: S.str("New text (edit)"), start: T("New start (edit)"), end: T("New end (edit)"),
      ids: { type: "array", items: { type: "string" }, description: "Caption ids to delete (default: all)" },
    }, ["action"], (a) => sceneEdit(app, "Captions", async (m) => (await ops()).captions(m, a))),

    tool("scene_captions_export", "Returns the captions of the sequence as SRT or WebVTT text (to show, translate or save with the export dialog).", {
      format: S.str("srt (default) or vtt", { enum: ["srt", "vtt"] }),
    }, [], async (a) => {
      const ctx = await (await rt()).sceneTarget(app);
      return (await ops()).captionsText(ctx.model(), a.format || "srt");
    }, { readOnly: true }),

    tool("scene_render_frame", "Renders the sequence at timeline times to an image you can SEE (exactly as exported): one time gives one frame; several times give a numbered contact sheet with time codes (up to 24). Use it after edits to check framing, text, colors and transitions.", {
      times: { type: "array", items: { anyOf: [{ type: "number" }, { type: "string" }] }, minItems: 1, maxItems: 24, description: "Timeline times (default: the playhead)" },
      every: S.num("Instead of times: one frame every n seconds over the sequence (at most 24)"), maxSize: S.num("Longest side of the image in pixels (default 1280)"), seq: S.str("Composition id instead of the main sequence"),
    }, [], async (a) => {
      const [R, O] = await Promise.all([rt(), ops()]);
      const ctx = await R.sceneTarget(app);
      const m = ctx.model();
      let times = (a.times || []).map((t) => O.time(m, t));
      if (!times.length && a.every > 0) {
        const total = (await import("../../scene/model.js")).duration(m);
        for (let t = 0; t < total && times.length < 24; t += a.every) times.push(t);
      }
      if (!times.length) times = [ctx.ui?.state.t || 0];
      const img = await R.renderFrames(ctx, times.slice(0, 24), { seq: a.seq || "main", maxSize: Math.min(1600, Math.max(320, a.maxSize || 1280)) });
      return [{ type: "text", text: times.length === 1 ? `Frame at ${times[0]} s (${img.width}×${img.height}).` : `${times.length} frames, numbered left to right, top to bottom: ${times.map((t, i) => `${i + 1} = ${Math.round(t * 100) / 100}s`).join(", ")}.` }, { type: "image", mime: img.mime, data: img.data }];
    }, { readOnly: true, exclusive: true }),

    tool("scene_show", "Shows the user a moment: moves the playhead to a time and / or selects clips in the Scene Studio (nothing in the document changes).", {
      t: T("Playhead time"), ids: { type: "array", items: { type: "string" }, description: "Clips to select" },
    }, [], async (a) => {
      const ctx = await (await rt()).sceneTarget(app);
      if (!ctx.ui) return { ok: false, note: "The scene is not open in the Scene Studio." };
      if (a.t !== undefined) ctx.ui.seek((await ops()).time(ctx.model(), a.t));
      if (a.ids) ctx.ui.select(a.ids.filter((id) => ctx.model().clips[id]));
      return { ok: true, playhead: ctx.ui.state.t, selection: ctx.ui.selection() };
    }, { readOnly: true }),

    tool("scene_export", "Exports the sequence as MP4, WebM, GIF, PNG frames (ZIP), a PNG still (at range.in) or WAV sound; the user approves and picks the file. Only formats this browser can encode work (the error says which).", {
      format: S.str("mp4, webm, gif, frames, png or wav", { enum: ["mp4", "webm", "gif", "frames", "png", "wav"] }),
      scale: S.num("Size factor 0.25-1 (default 1)"), fps: S.num("Frames per second (default: the sequence)"), quality: S.num("0.1-1 (default 0.7)"),
      audio: S.bool("Include sound (default true)"), range: OBJ("Timeline range { in, out } (default: everything)", { in: S.num("Start seconds"), out: S.num("End seconds") }),
    }, ["format"], async (a, c) => {
      const R = await rt();
      const ctx = await R.sceneTarget(app);
      const range = a.range ? { in: +a.range.in || 0, out: +a.range.out || (+a.range.in || 0) + 1 / ctx.model().fps } : null;
      return R.exportFile(app, ctx, { format: a.format, scale: a.scale || 1, fps: a.fps, quality: a.quality ?? 0.7, audio: a.audio !== false, range, signal: c?.signal, report: c?.report });
    }, { needsApproval: (a) => `Export the scene as ${String(a.format || "mp4").toUpperCase()} (a save dialog opens; rendering takes about real time)?` }),
  ];
}
