// Vibe tools of the Scene Studio that understand footage and edit from that understanding (docs/scene-studio.md ▸
// Assistant). Group "Scene understanding": transcript (speech engines of platform/engines.js), shots, sound analysis,
// sampled frames for your eyes, the searchable index and the notes you write into it. Group "Scene automation":
// transcript-driven cuts, silences, filler words, auto-captions, highlight reels, reframing and motion presets.
// Logic: scene/analysis.js, scene/ai-auto.js, scene/motion.js (pure, unit-tested) and scene/ai-runtime.js.
import { tool, S } from "./helpers.js";
import { sceneEdit, T } from "./scene.js";
import { engines } from "../../platform/engines.js";
import { ensureBuiltinEngines } from "../../platform/builtin-engines.js";

const rt = () => import("../../scene/ai-runtime.js");
const auto = () => import("../../scene/ai-auto.js");
const motion = () => import("../../scene/motion.js");
const RANGES = (d) => ({ type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: d });
const r2 = (v) => Math.round(v * 100) / 100;

// which recognizer a transcription would use (sync, for the approval text)
function pickStt(id) {
  ensureBuiltinEngines();
  const all = engines.list("stt");
  return id ? all.find((e) => e.id === id) : all.filter((e) => typeof e.transcribe === "function").find((e) => e.local) || all.find((e) => typeof e.transcribe === "function");
}

/** Media ids to analyse: the given one, or every item of `kinds` that is used on the timeline. */
function mediaList(m, id, kinds) {
  if (id) {
    if (!m.media[id]) throw new Error(`There is no media item “${id}”. Call scene_describe for the media ids.`);
    return [id];
  }
  const used = new Set(Object.values(m.clips).map((c) => c.media).filter(Boolean));
  const out = [...used].filter((x) => kinds.includes(m.media[x]?.kind) && (m.media[x].kind !== "video" || kinds.length === 1 || m.media[x].hasAudio));
  if (!out.length) throw new Error("No matching media item is on the timeline. Pass media (an id from scene_describe).");
  return out;
}

export function sceneUnderstandTools(app) {
  return [
    // ------------------------------------------------------------------------------------------ understanding
    tool("scene_transcribe", "Transcribes the speech of a video or audio item with word timestamps through a speech engine (a local batch recognizer from an extension is preferred; the built-in system recognizer can only listen to the microphone, so without a batch engine this says what to install). Stores the transcript for scene_transcript, scene_search, scene_cut_transcript, scene_remove_fillers and scene_auto_captions.", {
      media: S.str("Media id (default: every item with sound on the timeline)"), lang: S.str("Language code such as en or de (helps the recognizer)"), engine: S.str("Speech engine id (default: the first local batch engine)"),
    }, [], async (a, c) => {
      const R = await rt();
      const ctx = await R.sceneTarget(app);
      const ids = mediaList(ctx.model(), a.media, ["video", "audio"]);
      const done = [];
      for (const id of ids) {
        const tr = await R.transcribeMedia(ctx, id, { engine: a.engine || null, lang: a.lang || app.i18n?.locale?.() || "", signal: c?.signal, report: c?.report });
        const { setAnalysis } = await import("../../scene/model.js");
        ctx.commit("Transcribe", setAnalysis(ctx.model(), id, { transcript: tr }));
        done.push({ media: id, words: tr.words.length, segments: tr.segments.length, engine: tr.engine, ...(tr.estimated ? { note: "The engine returned no word times; they are estimated." } : {}) });
      }
      return { transcribed: done, next: "Read it with scene_transcript." };
    }, { needsApproval: (a) => {
      const e = pickStt(a.engine);
      return e && !e.local && typeof e.transcribe === "function" ? `Send the sound of the scene to “${e.label}” for transcription? This engine is not local: the audio leaves this device.` : false;
    } }),

    tool("scene_set_transcript", "Stores a transcript you were given (or wrote) for a media item: SRT or WebVTT text (subtitles), segments [{ t0, t1, text }] or words [{ t0, t1, w }] in source seconds. Use it when no speech engine is available but the user has a transcript or subtitle file.", {
      media: S.str("Media id"), subtitles: S.str("SRT or WebVTT text"), lang: S.str("Language code"),
      segments: { type: "array", items: { type: "object", properties: { t0: S.num("Start seconds"), t1: S.num("End seconds"), text: S.str("Text") }, required: ["t0", "t1", "text"] }, description: "Segments" },
      words: { type: "array", items: { type: "object", properties: { t0: S.num("Start seconds"), t1: S.num("End seconds"), w: S.str("Word") }, required: ["t0", "t1", "w"] }, description: "Words" },
    }, ["media"], (a) => sceneEdit(app, "Set Transcript", async (m) => {
      const A = await auto();
      let raw = { engine: "manual", lang: a.lang || "", segments: a.segments, words: a.words };
      if (a.subtitles) raw = { ...raw, segments: (await import("../../scene/captions.js")).parseSubtitles(a.subtitles).map((q) => ({ t0: q.t0, t1: q.t1, text: q.text.replace(/\n/g, " ") })) };
      return A.setTranscript(m, a.media, raw);
    })),

    tool("scene_transcript", "Reads a transcript with source and timeline times: numbered segments (or words), limited to a timeline window. The numbers are what scene_cut_transcript takes. Shows whether word times are estimated.", {
      media: S.str("Media id (default: the transcribed item on the timeline)"), from: S.num("Timeline start"), to: S.num("Timeline end"), words: S.bool("Words instead of segments"), limit: S.num("Maximum rows (default 400)"),
    }, [], async (a) => {
      const ctx = await (await rt()).sceneTarget(app);
      return (await auto()).transcriptView(ctx.model(), { media: a.media, from: a.from ?? 0, to: a.to ?? Infinity, words: !!a.words, limit: a.limit || 400 });
    }, { readOnly: true }),

    tool("scene_detect_shots", "Finds the shots (scene cuts) of a video by comparing color histograms and pixels of sampled frames in a background worker. Stores them for scene_sample_frames (one frame per shot), scene_search and the index.", {
      media: S.str("Video media id (default: every video on the timeline)"), fps: S.num("Frames sampled per second (default 4, 2 for long videos; max 10)"), threshold: S.num("Cut threshold 0-1 (default automatic)"), minShot: S.num("Shortest shot in seconds (default 0.6)"),
    }, [], async (a, c) => {
      const R = await rt();
      const ctx = await R.sceneTarget(app);
      const out = [];
      for (const id of mediaList(ctx.model(), a.media, ["video"])) {
        const shots = await R.detectShotsOf(ctx, id, { fps: a.fps, threshold: a.threshold ?? "auto", minShot: a.minShot ?? 0.6, signal: c?.signal, report: c?.report });
        const { setAnalysis } = await import("../../scene/model.js");
        ctx.commit("Detect Shots", setAnalysis(ctx.model(), id, { shots }));
        out.push({ media: id, shots: shots.length, list: shots.slice(0, 60).map((s, i) => `${i + 1}: ${s.t0}–${s.t1}s (cut ${s.score})`) });
      }
      return out.length === 1 ? out[0] : { media: out };
    }),

    tool("scene_analyze_audio", "Analyses the sound of a media item in a background worker: silent ranges (threshold auto or dB), integrated loudness (LUFS) and peak, tempo (BPM), beat grid and onsets. Stores it for scene_remove_silences, scene_audio normalize, scene_beat_cuts and slideshows on the beat.", {
      media: S.str("Media id (default: every item with sound on the timeline)"), thresholdDb: S.num("Silence threshold in dBFS (default automatic)"), minSilence: S.num("Shortest silence in seconds (default 0.5)"), beats: S.bool("Detect tempo and beats (default true)"),
    }, [], async (a, c) => {
      const R = await rt();
      const ctx = await R.sceneTarget(app);
      const out = [];
      for (const id of mediaList(ctx.model(), a.media, ["video", "audio"])) {
        const r = await R.analyzeAudioOf(ctx, id, { thresholdDb: a.thresholdDb ?? "auto", minSilence: a.minSilence ?? 0.5, beats: a.beats !== false }, c?.signal);
        const { setAnalysis } = await import("../../scene/model.js");
        ctx.commit("Analyze Audio", setAnalysis(ctx.model(), id, { silence: r.silence, loudness: r.loudness, ...(r.beats ? { beats: r.beats } : {}) }));
        out.push({ media: id, duration: r.duration, loudness: r.loudness, silentRanges: r.silence.length, silentSeconds: r2(r.silence.reduce((s, [x, y]) => s + y - x, 0)), ...(r.beats ? { bpm: r.beats.bpm, beats: r.beats.times.length, tempoConfidence: r.beats.confidence } : {}) });
      }
      return out.length === 1 ? out[0] : { media: out };
    }),

    tool("scene_sample_frames", "Shows you frames of a video item (source seconds) or of the edited sequence (timeline: true) as a numbered contact sheet with times, to understand what happens. Pick times, count (evenly spread) or perShot (the middle of each detected shot). Then write what you see into the index with scene_index_note.", {
      media: S.str("Video or image media id (default: the first video)"), timeline: S.bool("Frames of the edited sequence instead of one source"),
      times: { type: "array", items: { type: "number" }, maxItems: 24, description: "Times in seconds" }, count: S.num("Evenly spread frames (default 12, max 24)"),
      perShot: S.bool("One frame per detected shot"), from: S.num("Window start seconds"), to: S.num("Window end seconds"), maxSize: S.num("Longest side of the sheet in pixels (default 1280)"),
    }, [], async (a) => {
      const R = await rt();
      const ctx = await R.sceneTarget(app);
      const m = ctx.model();
      const M = await import("../../scene/model.js");
      const media = a.timeline ? null : a.media || Object.values(m.media).find((x) => x.kind === "video")?.id;
      if (!a.timeline && !media) throw new Error("There is no video in the scene. Pass media or timeline: true.");
      const total = a.timeline ? M.duration(m) : m.media[media]?.duration || 0;
      const from = Math.max(0, a.from ?? 0);
      const to = Math.min(total || Infinity, a.to ?? total);
      let times = a.times?.length ? a.times : [];
      if (!times.length && a.perShot) {
        const shots = a.timeline ? null : m.analysis?.[media]?.shots;
        if (!shots?.length) throw new Error("No shots are detected for this item yet. Call scene_detect_shots first.");
        times = shots.filter((s) => s.t1 > from && s.t0 < to).map((s) => (s.t0 + s.t1) / 2);
        if (times.length > 24) times = Array.from({ length: 24 }, (_, i) => times[Math.floor((i * times.length) / 24)]);
      }
      if (!times.length) {
        const n = Math.max(1, Math.min(24, a.count || 12));
        times = Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n);
      }
      times = times.slice(0, 24).map((t) => Math.max(0, Math.min(t, Math.max(0, (total || t) - 0.04))));
      const maxSize = Math.min(1600, Math.max(320, a.maxSize || 1280));
      const img = a.timeline ? await R.renderFrames(ctx, times, { maxSize }) : await R.sampleSourceFrames(ctx, media, times, { maxSize });
      const where = a.timeline ? "timeline" : `source of ${media}`;
      return [{ type: "text", text: `${times.length} frame${times.length === 1 ? "" : "s"} (${where} seconds): ${times.map((t, i) => `${i + 1} = ${r2(t)}s`).join(", ")}. Describe what you see with scene_index_note (media ${media || "timeline: true"}).` }, { type: "image", mime: img.mime, data: img.data }];
    }, { readOnly: true, exclusive: true }),

    tool("scene_index_note", "Writes descriptions of what is seen into the scene's searchable index (after scene_sample_frames): notes [{ t0, t1, text }] in source seconds of a media item, or timeline seconds with timeline: true. Short, concrete, searchable words: who, what, where, on-screen text, shot type.", {
      media: S.str("Media id the times refer to"), timeline: S.bool("Times are timeline seconds"), replace: S.bool("Replace notes that start at the same times"),
      notes: { type: "array", minItems: 1, items: { type: "object", properties: { t0: S.num("Start seconds"), t1: S.num("End seconds"), text: S.str("What is seen") }, required: ["t0", "text"] }, description: "Notes" },
    }, ["notes"], (a) => sceneEdit(app, "Index Notes", async (m) => (await auto()).addNotes(m, a))),

    tool("scene_search", "Answers \"where does X happen\" in the scene: searches the transcript, your visual notes, markers and captions and returns ranked hits with source and timeline times. Index first with scene_transcribe and scene_sample_frames + scene_index_note.", {
      query: S.str("What to find"), limit: S.num("Maximum hits (default 10)"),
      kinds: { type: "array", items: { type: "string", enum: ["speech", "visual", "shot", "marker", "caption"] }, description: "Only these kinds" },
    }, ["query"], async (a) => {
      const ctx = await (await rt()).sceneTarget(app);
      return (await auto()).sceneSearch(ctx.model(), a.query, { limit: Math.max(1, Math.min(50, a.limit || 10)), kinds: a.kinds || null });
    }, { readOnly: true }),

    // ------------------------------------------------------------------------------------------ automation
    tool("scene_cut_transcript", "Edits by transcript: removes (mode cut) or keeps only (mode keep) what was said in the selected parts, on all unlocked tracks (picture and sound stay in sync). Select by phrases (every occurrence), segment numbers [first, last] or word numbers from scene_transcript, or source ranges.", {
      media: S.str("Media id of the transcript (default: the transcribed item)"), mode: S.str("cut (default) or keep", { enum: ["cut", "keep"] }),
      phrases: { type: "array", items: { type: "string" }, description: "Exact phrases to select" },
      segments: { type: "array", items: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" } }] }, description: "Segment numbers or [first, last] ranges" },
      words: { type: "array", items: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" } }] }, description: "Word numbers or [first, last] ranges" },
      ranges: RANGES("Source ranges [[t0, t1], …]"), pad: S.num("Seconds of air added into the pauses (default 0.08)"),
    }, [], (a) => sceneEdit(app, a.mode === "keep" ? "Keep by Transcript" : "Cut by Transcript", async (m) => (await auto()).cutByTranscript(m, a))),

    tool("scene_remove_silences", "Removes the silent parts of the edit (where no analysed sound plays; run scene_analyze_audio first) and closes the gaps on all unlocked tracks. dryRun lists the ranges without cutting.", {
      minDur: S.num("Shortest silence to remove in seconds (default 0.6)"), pad: S.num("Seconds of air kept on each side (default 0.12)"),
      media: S.str("Only this item's sound decides"), ignoreUnanalysed: S.bool("Treat sound without analysis (music) as silent"), dryRun: S.bool("Only list the ranges"),
    }, [], (a) => sceneEdit(app, "Remove Silences", async (m) => (await auto()).removeSilences(m, a))),

    tool("scene_remove_fillers", "Removes filler words (um, uh, äh, ähm, euh …; soft adds words like \"like\", \"also\", \"halt\") found in the transcript, with picture and sound. dryRun lists them first.", {
      media: S.str("Media id of the transcript"), lang: S.str("Language code (default: the transcript's)"), soft: S.bool("Also soft fillers"),
      extra: { type: "array", items: { type: "string" }, description: "More words or phrases to remove" }, dryRun: S.bool("Only list them"),
    }, [], (a) => sceneEdit(app, "Remove Filler Words", async (m) => (await auto()).removeFillers(m, a))),

    tool("scene_auto_captions", "Creates captions from the transcript as it plays in the edit (cut parts stay out): style classic, outline, bold (social) or minimal, characters per caption, lines, position, an entrance animation, uppercase. Replaces existing captions unless replace is false.", {
      media: S.str("Media id of the transcript"), style: S.str("classic, outline, bold or minimal", { enum: ["classic", "outline", "bold", "minimal"] }),
      maxChars: S.num("Characters per line (default 42, 24 for vertical video)"), lines: S.num("Lines per caption (default 1)"), maxDur: S.num("Longest caption in seconds (default 4)"),
      y: S.num("Vertical position as a fraction of the height"), anim: S.str("Entrance animation: none, pop, fade, words …"), uppercase: S.bool("Upper-case text"), replace: S.bool("Replace existing captions (default true)"),
    }, [], (a) => sceneEdit(app, "Auto Captions", async (m) => (await auto()).autoCaptions(m, a))),

    tool("scene_highlight_reel", "Builds a highlight reel from timeline ranges in the order given (repeats allowed): everything in each range is copied one after another, with a transition between picture parts and short sound fades. newDocument: true keeps this scene and opens the reel as a new one.", {
      ranges: RANGES("[[start, end], …] timeline seconds in play order"), transition: S.str("Transition between parts (default none), e.g. dissolve"), transitionDur: S.num("Seconds (default 0.4)"),
      newDocument: S.bool("Create a new scene instead of changing this one"), title: S.str("Name of the new scene"),
    }, ["ranges"], async (a) => runOrCopy(app, a, "Highlight Reel", async (m) => (await motion()).highlightReel(m, a))),

    tool("scene_reframe", "Changes the aspect ratio (9:16, 1:1, 4:5, 16:9, 4:3, 21:9) and keeps the subject in frame: pictures fill the new frame around a focus point (fractions of the old frame) or a moving focus track [{ t, x, y }] (timeline seconds), text and graphics keep their relative place, captions rewrap. newDocument: true makes a reframed copy (for social cutdowns).", {
      aspect: S.str("Target aspect", { enum: ["9:16", "1:1", "4:5", "16:9", "4:3", "21:9"] }), focus: { type: "object", properties: { x: S.num("0 = left, 1 = right"), y: S.num("0 = top, 1 = bottom") }, description: "Focus point (default center)" },
      track: { type: "array", items: { type: "object", properties: { t: S.num("Timeline seconds"), x: S.num("0-1"), y: S.num("0-1") }, required: ["t", "x", "y"] }, description: "Moving focus" },
      mode: S.str("fill (default, crops) or fit (letterbox)", { enum: ["fill", "fit"] }), newDocument: S.bool("Create a reframed copy"), title: S.str("Name of the copy"),
    }, ["aspect"], async (a) => runOrCopy(app, a, `Reframe ${a.aspect}`, async (m) => (await motion()).reframe(m, a))),

    tool("scene_animate_clip", "Applies a motion preset to a picture clip as editable keyframes: entrance / exit fade, slide-from-left/right/top/bottom, zoom, pop, spin, blur; or continuous ken-burns, shake, pulse, float.", {
      id: S.str("Clip id"), preset: S.str("Preset", { enum: ["fade", "slide-from-left", "slide-from-right", "slide-from-top", "slide-from-bottom", "zoom", "pop", "spin", "blur", "ken-burns", "shake", "pulse", "float"] }),
      edge: S.str("in (default), out or both", { enum: ["in", "out", "both"] }), dur: S.num("Seconds of the entrance / exit (default 0.5)"), amount: S.num("Strength, 1 = default"),
    }, ["id", "preset"], (a) => sceneEdit(app, "Animate Clip", async (m) => (await motion()).animateClip(m, a))),

    tool("scene_title", "Adds an animated title (and subtitle): presets fade-up, pop, typewriter, letters, words, blur-in, zoom-through, underline, boxed; position center, top or bottom; optional background color; accent color for underline and box.", {
      text: S.str("Title text"), subtitle: S.str("Second line"), preset: S.str("Preset (default fade-up)"), start: S.num("Timeline start (default 0)"), dur: S.num("Seconds (default 4)"),
      position: S.str("center, top or bottom", { enum: ["center", "top", "bottom"] }), color: S.str("Text color"), accent: S.str("Accent color"), background: S.str("Full-frame background color (default none)"),
      font: S.str("Font family"), size: S.num("Font size in pixels (default 12 % of the height)"),
    }, ["text"], (a) => sceneEdit(app, "Title", async (m) => (await motion()).titleAnimation(m, a))),

    tool("scene_lower_third", "Adds a lower third (name and role) that slides in and out: style bar, box, line or minimal, left or right side, accent and text colors.", {
      name: S.str("Name"), title: S.str("Role or second line"), style: S.str("bar (default), box, line or minimal", { enum: ["bar", "box", "line", "minimal"] }),
      side: S.str("left (default) or right", { enum: ["left", "right"] }), start: S.num("Timeline start"), dur: S.num("Seconds (default 5)"),
      color: S.str("Accent color"), textColor: S.str("Text color"), boxColor: S.str("Panel color (box style)"),
    }, ["name"], (a) => sceneEdit(app, "Lower Third", async (m) => (await motion()).lowerThird(m, a))),

    tool("scene_slideshow", "Builds a slideshow on a new track from images (and videos) in order: duration per item or every n beats of the music (after scene_analyze_audio), transitions, Ken Burns moves, optional music with a fade-out.", {
      media: { type: "array", items: { type: "string" }, minItems: 1, description: "Image or video media ids in order" }, dur: S.num("Seconds per item (default 3)"),
      music: S.str("Audio media id"), beats: S.num("Change every n beats of the music instead of dur"), transition: S.str("Transition (default dissolve, none for hard cuts)"),
      transitionDur: S.num("Seconds (default 0.6)"), kenBurns: S.bool("Ken Burns moves on images (default true)"), strength: S.num("Ken Burns strength (default 1)"),
      fit: S.str("fill (default) or fit", { enum: ["fill", "fit"] }), start: S.num("Timeline start (default: the end)"),
    }, ["media"], (a) => sceneEdit(app, "Slideshow", async (m) => (await motion()).slideshow(m, a))),

    tool("scene_beat_cuts", "Cuts footage to the music: the beat grid of the music item (scene_analyze_audio first) is cut every n beats and the intervals are filled with the source videos / images in turn, on a new track. The music is placed at start when it is not on the timeline yet.", {
      music: S.str("Music media id"), sources: { type: "array", items: { type: "string" }, minItems: 1, description: "Video or image media ids to cut between" },
      every: S.num("Beats per cut (default 2)"), start: S.num("Timeline start of the music if it is placed now"), from: S.num("Timeline start of the cut range"), to: S.num("Timeline end of the cut range"),
      sourceIn: S.num("Source start of the videos (default 10 % in, at most 2 s)"), kenBurns: S.bool("Moves on images (default true)"),
    }, ["music", "sources"], (a) => sceneEdit(app, "Beat Cuts", async (m) => (await motion()).beatCuts(m, a))),
  ];
}

// edits in place, or (newDocument) opens the result as a new scene document
async function runOrCopy(app, a, label, fn) {
  if (!a.newDocument) return sceneEdit(app, label, fn);
  const R = await rt();
  const ctx = await R.sceneTarget(app);
  const { model, result } = await fn(ctx.model(), ctx);
  const doc = await R.openSceneCopy(app, model, a.title || `${ctx.doc.name} (${label})`);
  return { ...result, newDocument: doc.name };
}
