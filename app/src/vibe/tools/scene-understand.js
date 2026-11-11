// Vibe tools that let the assistant UNDERSTAND footage and edit by meaning (docs/scene-studio.md ▸ Assistant; group
// "Scene understanding"): sound analysis (silence, loudness, beats), shot detection, frames to look at, a
// transcript with time stamps, notes on what is in the picture, one search over all of it, and the edits built on
// top: remove silences and filler words, cut by transcript, captions, music ducking, beat-synced cuts, slideshows
// and reframing. Analysis results are stored in the scene (model.analysis), so they survive saving and are found by
// scene_search. Source times belong to a media item; timeline times to the sequence. The tools say which is which.
import { tool, S } from "./helpers.js";
import { sceneCtx } from "./scene.js";

const r2 = (v) => Math.round(v * 100) / 100;
const MEDIA = S.str("Media id from scene_describe ▸ media");

export function sceneUnderstandTools(app) {
  const ctx = () => sceneCtx(app);
  const media = (c, id, kinds = null) => {
    const m = c.model();
    const md = id ? m.media[id] : Object.values(m.media).find((x) => !kinds || kinds.includes(x.kind));
    if (!md) throw new Error(id ? `There is no media item “${id}”. Media: ${Object.values(m.media).map((x) => `${x.id} (${x.name})`).join(", ") || "none"}.` : "The scene has no suitable media item.");
    if (kinds && !kinds.includes(md.kind)) throw new Error(`“${md.name}” is ${md.kind}; this needs ${kinds.join(" or ")}.`);
    return md;
  };
  const transcriptOf = (c, md) => {
    const tr = c.model().analysis?.[md.id]?.transcript;
    if (!tr?.words?.length) throw new Error(`“${md.name}” has no transcript yet. Run scene_transcribe, or provide one with scene_set_transcript (words, cues or subtitle text).`);
    return tr;
  };
  // timeline ranges in which source range [s0, s1) of a media item is on screen or audible
  const onTimeline = (c, id, s0, s1) => c.M.timelineRangesOf(c.model(), id, s0, s1);

  return [
    tool("scene_analyze", "Analyzes a media item and stores the result in the scene: sound (silent stretches, loudness per second, tempo and beat times) and, for video, shot changes. Returns a summary in SOURCE seconds. Run it once per item before scene_remove_silence, scene_duck_music, scene_beat_edit or when you need to know where the cuts and the quiet parts are.", {
      media: MEDIA,
      what: { type: "array", items: { type: "string", enum: ["audio", "shots"] }, description: "What to analyze (default: audio, plus shots for video)" },
      silenceDb: S.num("Level below which sound counts as silence, in dBFS (default -38)"),
      minSilence: S.num("Shortest silence to report, seconds (default 0.45)"),
      shotStep: S.num("Sampling step for shot detection, seconds (default 0.5)"),
    }, [], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "audio"]);
      const U = await import("../../scene/understand.js");
      const store = await c.store();
      const what = a.what?.length ? a.what : md.kind === "video" ? ["audio", "shots"] : ["audio"];
      const patch = {};
      const notes = [];
      if (what.includes("audio")) {
        try {
          const r = await U.analyzeAudio(store, md.id, { thresholdDb: a.silenceDb, minDur: a.minSilence });
          Object.assign(patch, { silence: r.silence, loudness: r.loudness, beats: r.beats });
        } catch (err) {
          notes.push(err.message);
        }
      }
      if (what.includes("shots") && md.kind === "video") patch.shots = await U.detectShots(store, c.model(), md.id, { step: a.shotStep || 0.5 });
      if (Object.keys(patch).length) c.commit("Analyze Media", c.M.setAnalysis(c.model(), md.id, patch));
      const quiet = (patch.silence || []).reduce((n, [x, y]) => n + (y - x), 0);
      return {
        ok: true,
        media: md.id,
        duration: r2(md.duration),
        ...(patch.silence ? { silence: { count: patch.silence.length, total: r2(quiet), ranges: patch.silence.slice(0, 80) } } : {}),
        ...(patch.loudness ? { loudness: { peakDb: patch.loudness.peakDb, rmsDb: patch.loudness.rmsDb } } : {}),
        ...(patch.beats ? { beats: { bpm: patch.beats.bpm, count: patch.beats.times.length, first: patch.beats.times.slice(0, 16) } } : {}),
        ...(patch.shots ? { shots: { count: patch.shots.length + 1, cuts: patch.shots.slice(0, 120) } } : {}),
        ...(notes.length ? { notes } : {}),
      };
    }, { exclusive: true }),

    tool("scene_sample_frames", "Shows you frames of a media item (the SOURCE footage, whether or not it is on the timeline) as one contact sheet with the source time printed on each frame, so you can see what happens when. Use it to find scenes, people, objects, text on screen, good and bad takes. Afterwards store what you saw with scene_annotate so it can be searched.", {
      media: MEDIA,
      times: { type: "array", items: { type: "number" }, description: "Source times in seconds (max 20)", maxItems: 20 },
      from: S.num("Start of a range in source seconds (default 0)"),
      to: S.num("End of the range (default: the end)"),
      count: S.num("Number of evenly spaced frames in the range (default 12, max 20)"),
      atShots: S.bool("One frame per detected shot instead of even spacing (needs scene_analyze with shots)"),
    }, [], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "image"]);
      const U = await import("../../scene/understand.js");
      const store = await c.store();
      let times = a.times?.length ? a.times : null;
      if (!times && a.atShots) {
        const cuts = c.model().analysis?.[md.id]?.shots;
        if (!cuts) throw new Error("No shots are known for this item. Run scene_analyze with what: [\"shots\"] first.");
        const edges = [0, ...cuts, md.duration];
        times = edges.slice(0, -1).map((t, i) => (t + edges[i + 1]) / 2).slice(0, 20);
      }
      if (!times) {
        const from = a.from ?? 0;
        const to = a.to ?? (md.duration || 0);
        const n = md.kind === "image" ? 1 : Math.max(1, Math.min(20, a.count || 12));
        times = Array.from({ length: n }, (_, i) => (n === 1 ? from : from + ((to - from) * (i + 0.5)) / n));
      }
      const sheet = await U.contactSheet((t) => store.frameAt(md.id, Math.max(0, Math.min((md.duration || 1) - 0.02, t))), times, { cols: times.length <= 3 ? times.length : 4, cellW: 320, aspect: (md.w || 16) / (md.h || 9) });
      const img = await U.canvasToBase64(sheet);
      return [{ type: "text", text: `Frames of “${md.name}” (${md.id}) at source seconds ${times.map(r2).join(", ")} (left to right, top to bottom).` }, { type: "image", mime: img.mime, data: img.data }];
    }, { readOnly: true, exclusive: true }),

    tool("scene_annotate", "Stores notes about what is in the picture of a media item at source times (what you saw in scene_sample_frames: people, actions, places, text on screen, quality). The notes are saved with the scene and found by scene_search.", {
      media: MEDIA,
      notes: { type: "array", description: "[{ t, text }]: what is visible at source time t", items: { type: "object", properties: { t: { type: "number", description: "Source time in seconds" }, text: { type: "string" } }, required: ["t", "text"] }, minItems: 1 },
      replace: S.bool("Replace the item's existing notes (default: add)"),
    }, ["notes"], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "image"]);
      const old = a.replace ? [] : c.model().analysis?.[md.id]?.notes || [];
      const notes = [...old, ...a.notes.filter((n) => Number.isFinite(+n.t) && String(n.text || "").trim()).map((n) => ({ t: r2(+n.t), text: String(n.text).trim().slice(0, 600) }))].sort((x, y) => x.t - y.t).slice(0, 2000);
      c.commit("Annotate Media", c.M.setAnalysis(c.model(), md.id, { notes }));
      return { ok: true, media: md.id, notes: notes.length };
    }),

    tool("scene_transcribe", "Turns the speech of a media item into a transcript with time stamps and stores it in the scene. Engines: a local engine when one is installed, else the browser's speech recognizer, which listens to the item's sound in REAL TIME (a five-minute clip takes five minutes) and, unless on-device recognition is installed, sends the audio to the browser vendor's service. If no engine works here, ask the user for subtitles (.srt / .vtt) or the text and use scene_set_transcript.", {
      media: MEDIA,
      language: S.str("BCP 47 language of the speech, e.g. en-US, de-DE (default en-US)"),
      from: S.num("Start in source seconds (default 0)"),
      to: S.num("End in source seconds (default: the end)"),
      engine: S.str("Engine id (default: the best available)"),
    }, [], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "audio"]);
      const U = await import("../../scene/understand.js");
      const tr = await U.transcribeMedia(await c.store(), md.id, { engine: a.engine || null, lang: a.language || "en-US", from: a.from, to: a.to });
      if (!tr.words.length) return { ok: false, note: "No speech was recognized. The item may have no speech, the language may be wrong, or the engine heard nothing. Engines: " + JSON.stringify(U.listTranscribers()) };
      c.commit("Transcribe", c.M.setAnalysis(c.model(), md.id, { transcript: tr }));
      return { ok: true, media: md.id, engine: tr.source, words: tr.words.length, segments: tr.segments.length, preview: tr.segments.slice(0, 8).map((s) => ({ t0: r2(s.t0), t1: r2(s.t1), text: s.text })) };
    }, { needsApproval: (a) => `Transcribe the speech${a.media ? ` of ${a.media}` : ""}? The browser's speech recognizer runs in real time and may send the audio to the browser vendor's speech service.`, alwaysAsk: true, exclusive: true }),

    tool("scene_set_transcript", "Stores a transcript for a media item from what you have: word timings, cues (phrases with start and end) or the text of a subtitle file (SRT / WebVTT). Times are SOURCE seconds. Use it when the user provides subtitles or a transcript, or to correct a recognized one.", {
      media: MEDIA,
      words: { type: "array", items: { type: "object", properties: { t0: { type: "number" }, t1: { type: "number" }, w: { type: "string" } }, required: ["t0", "w"] }, description: "[{ t0, t1, w }]" },
      cues: { type: "array", items: { type: "object", properties: { t0: { type: "number" }, t1: { type: "number" }, text: { type: "string" } }, required: ["t0", "t1", "text"] }, description: "[{ t0, t1, text }]" },
      subtitles: S.str("Content of an .srt or .vtt file"),
      language: S.str("Language of the speech, e.g. en or de"),
    }, [], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "audio"]);
      const [A, C] = await Promise.all([import("../../scene/analysis.js"), import("../../scene/captions.js")]);
      const cues = a.subtitles ? C.parseSubtitles(a.subtitles) : a.cues;
      if (!a.words?.length && !cues?.length) throw new Error("Give words, cues or subtitles.");
      const tr = A.makeTranscript({ words: a.words, cues, lang: a.language || "", source: a.subtitles ? "subtitles" : "provided" });
      c.commit("Set Transcript", c.M.setAnalysis(c.model(), md.id, { transcript: tr }));
      return { ok: true, media: md.id, words: tr.words.length, segments: tr.segments.length };
    }),

    tool("scene_get_transcript", "Reads the transcript of a media item: sentences with their SOURCE times, word index ranges and where each one currently sits on the TIMELINE (empty when it was cut). Page through long transcripts with from / to or offset.", {
      media: MEDIA,
      from: S.num("Only segments that end after this source time"),
      to: S.num("Only segments that start before this source time"),
      offset: S.num("Skip this many segments (paging)"),
      limit: S.num("Maximum number of segments (default 60)"),
      words: S.bool("Include the words with their times (default false)"),
    }, [], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "audio"]);
      const tr = transcriptOf(c, md);
      const all = tr.segments.filter((s) => s.t1 > (a.from ?? 0) && s.t0 < (a.to ?? Infinity));
      const page = all.slice(a.offset || 0, (a.offset || 0) + Math.max(1, Math.min(300, a.limit || 60)));
      return {
        media: md.id,
        language: tr.lang,
        source: tr.source,
        totalSegments: all.length,
        segments: page.map((s, i) => ({ index: (a.offset || 0) + i, t0: r2(s.t0), t1: r2(s.t1), text: s.text, words: [s.from, s.to], timeline: onTimeline(c, md.id, s.t0, s.t1).map(([x, y]) => [r2(x), r2(y)]), ...(a.words ? { wordTimes: tr.words.slice(s.from, s.to + 1).map((w) => [r2(w.t0), r2(w.t1), w.w]) } : {}) })),
        ...(all.length > (a.offset || 0) + page.length ? { next: { offset: (a.offset || 0) + page.length } } : {}),
      };
    }, { readOnly: true }),

    tool("scene_search", "Searches everything known about the scene for words: what is said (transcripts), what is seen (your notes from scene_annotate), markers, clip names and text clips. Answers \"where does X happen\". Media hits are in SOURCE seconds with their TIMELINE positions; marker and clip hits are timeline seconds.", {
      query: S.str("Words to look for"),
      limit: S.num("Maximum number of hits (default 20)"),
    }, ["query"], async (a) => {
      const c = await ctx();
      const A = await import("../../scene/analysis.js");
      const m = c.model();
      const hits = A.searchIndex(m, a.query, { limit: Math.max(1, Math.min(100, a.limit || 20)) });
      // exact phrase positions inside transcripts, for precise cuts
      const phrases = [];
      for (const [id, an] of Object.entries(m.analysis || {})) for (const p of an.transcript?.words ? A.findPhrase(an.transcript.words, a.query).slice(0, 20) : []) phrases.push({ media: id, t0: r2(p.t0), t1: r2(p.t1), text: p.text, timeline: onTimeline(c, id, p.t0, p.t1).map(([x, y]) => [r2(x), r2(y)]) });
      return {
        query: a.query,
        hits: hits.map((h) => ({ kind: h.kind, ...(h.media ? { media: h.media, sourceTime: r2(h.t), ...(h.t1 ? { sourceEnd: r2(h.t1) } : {}), timeline: onTimeline(c, h.media, h.t, h.t1 ?? h.t + 0.5).map(([x, y]) => [r2(x), r2(y)]) } : { timelineTime: r2(h.t), ...(h.clip ? { clip: h.clip } : {}) }), text: h.text.slice(0, 300), score: r2(h.score) })),
        exactPhrases: phrases,
        ...(hits.length || phrases.length ? {} : { note: "Nothing found. Transcripts come from scene_transcribe or scene_set_transcript; picture notes from scene_sample_frames plus scene_annotate." }),
      };
    }, { readOnly: true }),

    tool("scene_remove_silence", "Cuts the silent stretches of a media item out of the timeline and closes the gaps (all tracks stay in sync). Needs scene_analyze first. Keeps `keep` seconds of each pause so speech does not sound chopped. With preview: true nothing changes and you get the ranges that would be cut.", {
      media: MEDIA,
      minSilence: S.num("Only pauses longer than this, seconds (default 0.6)"),
      keep: S.num("Seconds of each pause to keep (default 0.15)"),
      preview: S.bool("Only report what would be cut"),
    }, [], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "audio"]);
      const sil = c.model().analysis?.[md.id]?.silence;
      if (!sil) throw new Error(`“${md.name}” has not been analyzed. Run scene_analyze first.`);
      const keep = Math.max(0, a.keep ?? 0.15);
      const min = a.minSilence ?? 0.6;
      const ranges = [];
      for (const [s0, s1] of sil) {
        if (s1 - s0 < min) continue;
        for (const [x, y] of onTimeline(c, md.id, s0 + keep / 2, s1 - keep / 2)) if (y - x > 0.05) ranges.push([x, y]);
      }
      const total = ranges.reduce((n, [x, y]) => n + (y - x), 0);
      if (a.preview || !ranges.length) return { ok: true, preview: true, cuts: ranges.length, seconds: r2(total), ranges: ranges.slice(0, 100).map(([x, y]) => [r2(x), r2(y)]) };
      const before = c.M.duration(c.model());
      c.commit("Remove Silence", c.M.cutRanges(c.model(), ranges));
      return { ok: true, cuts: ranges.length, removed: r2(before - c.M.duration(c.model())), duration: r2(c.M.duration(c.model())) };
    }),

    tool("scene_cut_transcript", "Edits the timeline by what is said (needs a transcript). Modes: fillers (remove um, uh, äh … and extra words you list), phrases (remove every occurrence of the given phrases), segments (remove the transcript segments with these indices from scene_get_transcript), keep_segments (keep only these segments, in timeline order: a rough cut or a highlight reel). Cuts close their gaps on all tracks. With preview: true nothing changes.", {
      media: MEDIA,
      mode: S.str("fillers, phrases, segments or keep_segments", { enum: ["fillers", "phrases", "segments", "keep_segments"] }),
      phrases: { type: "array", items: { type: "string" }, description: "phrases mode: the phrases; fillers mode: extra filler words" },
      segments: { type: "array", items: { type: "number" }, description: "Segment indices" },
      aggressive: S.bool("fillers: also remove words that are sometimes real words (like, also, halt)"),
      pad: S.num("Seconds kept around each removed part (default 0.04) or added around each kept segment (default 0.15)"),
      preview: S.bool("Only report what would change"),
    }, ["mode"], async (a) => {
      const c = await ctx();
      const md = media(c, a.media, ["video", "audio"]);
      const tr = transcriptOf(c, md);
      const A = await import("../../scene/analysis.js");
      let source = [];
      if (a.mode === "fillers") source = A.fillerRanges(tr.words, { lang: tr.lang || "en", extra: a.phrases || [], aggressive: !!a.aggressive }).map((f) => [f.t0, f.t1, f.text]);
      else if (a.mode === "phrases") {
        if (!a.phrases?.length) throw new Error("phrases mode needs phrases.");
        for (const p of a.phrases) for (const h of A.findPhrase(tr.words, p)) source.push([h.t0, h.t1, h.text]);
      } else {
        if (!a.segments?.length) throw new Error(`${a.mode} needs segment indices from scene_get_transcript.`);
        for (const i of a.segments) {
          const s = tr.segments[i];
          if (!s) throw new Error(`There is no segment ${i} (the transcript has ${tr.segments.length}).`);
          source.push([s.t0, s.t1, s.text]);
        }
      }
      const keepMode = a.mode === "keep_segments";
      const pad = a.pad ?? (keepMode ? 0.15 : 0.04);
      const ranges = [];
      for (const [s0, s1] of source) for (const [x, y] of onTimeline(c, md.id, keepMode ? s0 - pad : s0 + pad, keepMode ? s1 + pad : s1 - pad)) if (y - x > 0.03) ranges.push([x, y]);
      const total = c.M.mergeRanges(ranges).reduce((n, [x, y]) => n + (y - x), 0);
      if (a.preview || !ranges.length) return { ok: true, preview: true, matches: source.length, seconds: r2(total), texts: source.slice(0, 40).map((s) => s[2]), ranges: ranges.slice(0, 100).map(([x, y]) => [r2(x), r2(y)]), ...(ranges.length ? {} : { note: "Nothing matched on the timeline." }) };
      const before = c.M.duration(c.model());
      c.commit(keepMode ? "Keep Transcript Segments" : "Cut by Transcript", keepMode ? c.M.keepRanges(c.model(), ranges) : c.M.cutRanges(c.model(), ranges));
      return { ok: true, matches: source.length, durationBefore: r2(before), duration: r2(c.M.duration(c.model())) };
    }),

    tool("scene_captions", "Captions (subtitles) on the timeline. Actions: create (from the transcript of a media item, following the current cut: words that were cut out do not appear), style (restyle all caption clips), export (returns the captions as SRT or WebVTT text), clear. Styles: classic (white on a dark box), outline, bold (large yellow), minimal. Captions are text clips on a \"Captions\" track and can be edited like any clip.", {
      action: S.str("create, style, export or clear", { enum: ["create", "style", "export", "clear"] }),
      media: MEDIA,
      style: S.str("classic, outline, bold or minimal"),
      maxChars: S.num("Characters per line (default 42; use about 18 for vertical video)"),
      lines: S.num("Lines per caption, 1 or 2 (default 1)"),
      y: S.num("Vertical position as a fraction of the frame height (default 0.86)"),
      animation: S.str("Text animation of each caption: none, fade, pop, words, chars …"),
      textStyle: { type: "object", description: "style action: text style properties to set on every caption (size, color, font, weight, bg, stroke …)" },
      format: S.str("export: srt (default) or vtt", { enum: ["srt", "vtt"] }),
    }, ["action"], async (a) => {
      const c = await ctx();
      const C = await import("../../scene/captions.js");
      const m = c.model();
      if (a.action === "export") {
        const cues = C.captionCues(m);
        if (!cues.length) throw new Error("The scene has no captions. Create them with action create.");
        return { format: a.format || "srt", captions: cues.length, text: a.format === "vtt" ? C.formatVtt(cues) : C.formatSrt(cues) };
      }
      if (a.action === "clear") {
        const idsNow = C.captionCues(m).map((x) => x.id);
        c.commit("Remove Captions", c.M.deleteClips(m, idsNow));
        return { ok: true, removed: idsNow.length };
      }
      if (a.action === "style") {
        const idsNow = C.captionCues(m).map((x) => x.id);
        if (!idsNow.length) throw new Error("The scene has no captions.");
        const st = { ...(a.style ? C.CAPTION_STYLES[a.style] : {}), ...(a.textStyle || {}), ...(a.animation ? { anim: { in: a.animation } } : {}) };
        c.commit("Style Captions", idsNow.reduce((mm, id) => c.M.updateClip(mm, id, { text: st, ...(a.y !== undefined ? { y: mm.height * a.y } : {}) }), m));
        return { ok: true, styled: idsNow.length };
      }
      const md = media(c, a.media, ["video", "audio"]);
      const tr = transcriptOf(c, md);
      // words → timeline: each word goes where its source time is on the timeline now (cut words disappear)
      const words = [];
      for (const w of tr.words) {
        // a word counts as present when its middle survived the cuts (slivers left by cut padding do not)
        const mid = (w.t0 + w.t1) / 2;
        if (!onTimeline(c, md.id, mid - 0.005, mid + 0.005).length) continue;
        const r = onTimeline(c, md.id, w.t0, w.t1).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        if (r) words.push({ t0: r[0], t1: r[1], w: w.w });
      }
      words.sort((x, y) => x.t0 - y.t0);
      const cues = C.wordsToCues(words, { maxChars: a.maxChars || 42, lines: a.lines || 1 });
      const r = C.captionsToClips(m, cues, { style: a.style || "classic", replace: true, y: a.y ?? 0.86, anim: a.animation || "none" });
      c.commit("Add Captions", r.model);
      return { ok: true, captions: r.ids.length, first: cues.slice(0, 5).map((q) => ({ t0: r2(q.t0), t1: r2(q.t1), text: q.text })) };
    }),

    tool("scene_duck_music", "Lowers music clips while someone speaks and brings them back up in the pauses (volume keyframes). Speech comes from the transcript or, without one, from the analyzed sound (everything that is not silence) of the voice media item.", {
      music: { type: "array", items: { type: "string" }, description: "Audio clip ids of the music", minItems: 1 },
      voice: S.str("Media id of the speech (default: the first item with a transcript or an audio analysis)"),
      level: S.num("Music gain while speech plays (default 0.25)"),
      ramp: S.num("Seconds to fade down and up (default 0.3)"),
    }, ["music"], async (a) => {
      const c = await ctx();
      const A = await import("../../scene/analysis.js");
      const m = c.model();
      const vid = a.voice || Object.keys(m.analysis || {}).find((id) => m.analysis[id].transcript?.words?.length || m.analysis[id].silence);
      const an = vid && m.analysis?.[vid];
      if (!an) throw new Error("No speech is known. Run scene_analyze (or scene_transcribe) on the voice recording first.");
      const md = m.media[vid];
      const src = an.transcript?.segments?.length ? an.transcript.segments.map((s) => [s.t0, s.t1]) : A.invertRanges(an.silence || [], md.duration);
      const speech = c.M.mergeRanges(src.flatMap(([s0, s1]) => onTimeline(c, vid, s0, s1)));
      let next = m;
      for (const id of a.music) {
        const cl = next.clips[id];
        if (!cl || cl.type !== "audio") throw new Error(`“${id}” is not an audio clip.`);
        next = c.M.updateClip(next, id, { volume: A.duckingTrack(speech, cl.start, cl.dur, { ducked: a.level ?? 0.25, ramp: a.ramp ?? 0.3 }) });
      }
      c.commit("Duck Music", next);
      return { ok: true, speechRanges: speech.length, clips: a.music.length };
    }),

    tool("scene_beat_edit", "Builds a beat-synced edit: places the given media items one after another, each lasting a number of beats of the analyzed music (scene_analyze on the music first), on the first free video track. The music clip itself is not moved. Returns the new clip ids.", {
      music: S.str("Media id of the music (analyzed)"),
      media: { type: "array", items: { type: "string" }, description: "Media ids (videos or images) in the order they should appear", minItems: 1 },
      beats: S.num("Beats per clip (default 4)"),
      start: S.num("Timeline time where the music's first beat is (default: where the music clip starts, else 0)"),
      transition: S.str("Transition between the clips: none (default, hard cuts on the beat), dissolve, fade, zoom …"),
      motion: S.str("Motion preset for stills, e.g. ken-burns"),
      fit: S.str("fit or fill (default fill)", { enum: ["fit", "fill"] }),
    }, ["music", "media"], async (a) => {
      const c = await ctx();
      let m = c.model();
      const beats = m.analysis?.[a.music]?.beats?.times;
      if (!beats?.length) throw new Error("The music has no beats yet. Run scene_analyze on it first (it needs a clear rhythm).");
      const musicClip = c.M.clipList(m).find((x) => x.media === a.music && x.type === "audio");
      const t0 = a.start ?? musicClip?.start ?? 0;
      const src0 = musicClip?.in ?? 0;
      const per = Math.max(1, Math.round(a.beats || 4));
      const marks = beats.filter((b) => b >= src0).map((b) => t0 + (b - src0) / (musicClip?.speed || 1));
      const ids = [];
      let tk = null;
      for (let i = 0; i < a.media.length; i++) {
        const s = marks[i * per];
        const e = marks[(i + 1) * per];
        if (s === undefined || e === undefined) break;
        const r = c.M.placeMedia(m, a.media[i], { start: s, dur: e - s, fit: a.fit || "fill", withAudio: false, track: tk });
        m = r.model;
        tk = m.clips[r.ids[0]].track;
        if (a.transition && a.transition !== "none" && i > 0) m = c.M.setTransition(m, r.ids[0], "in", a.transition, Math.min(0.4, (e - s) / 3));
        ids.push(r.ids[0]);
      }
      c.commit("Beat Edit", m);
      const out = { ok: true, ids, placed: ids.length, of: a.media.length, bpm: m.analysis[a.music].beats.bpm };
      if (a.motion && ids.length) out.next = `Apply the motion with scene_animate { ids, motion: "${a.motion}" }.`;
      return out;
    }),

    tool("scene_slideshow", "Builds a slideshow from images (or videos): each item for `seconds`, one after another from `start`, with an optional transition and a slow Ken Burns move on stills. Returns the clip ids.", {
      media: { type: "array", items: { type: "string" }, description: "Media ids in order", minItems: 1 },
      seconds: S.num("Seconds per item (default 4)"),
      start: S.num("Timeline start (default: the end of the sequence)"),
      transition: S.str("dissolve (default), fade, slide-left, zoom, none …"),
      kenBurns: S.bool("Slow zoom and drift on stills (default true)"),
      fit: S.str("fit or fill (default fill)", { enum: ["fit", "fill"] }),
    }, ["media"], async (a) => {
      const c = await ctx();
      const { MOTIONS } = await import("./scene.js");
      const { valueAt } = await import("../../scene/keyframes.js");
      let m = c.model();
      const dur = Math.max(0.5, a.seconds || 4);
      let t = a.start ?? c.M.duration(m);
      let tk = null;
      const ids = [];
      for (const id of a.media) {
        const r = c.M.placeMedia(m, id, { start: t, dur, fit: a.fit || "fill", withAudio: false, track: tk });
        m = r.model;
        const cid = r.ids[0];
        tk = m.clips[cid].track;
        const tr = a.transition || "dissolve";
        if (tr !== "none" && ids.length) m = c.M.setTransition(m, cid, "in", tr, Math.min(0.8, dur / 3));
        if (a.kenBurns !== false && m.media[id].kind === "image") {
          const cl = m.clips[cid];
          const base = { x: valueAt(cl.x, 0), y: valueAt(cl.y, 0), sx: valueAt(cl.sx, 0), sy: valueAt(cl.sy, 0), rot: 0, opacity: 1 };
          const tracks = MOTIONS["ken-burns"]({ dur: cl.dur, k: 1, base, W: m.width, H: m.height });
          // every second still runs the move backwards (zoom out, drift the other way), so the show does not pump
          const back = ids.length % 2 === 1;
          m = c.M.updateClip(m, cid, Object.fromEntries(Object.entries(tracks).map(([p, kf]) => [p, { kf: back ? kf.map((q, i) => ({ ...q, v: kf[kf.length - 1 - i].v })) : kf }])));
        }
        ids.push(cid);
        t += m.clips[cid].dur;
      }
      c.commit("Slideshow", m);
      return { ok: true, ids, duration: r2(c.M.duration(c.model())) };
    }),

    tool("scene_reframe", "Changes the format of the scene for another platform (for example 16:9 to vertical 9:16 or square) and re-fits the picture clips: fill (crop to cover the new frame, default) or fit (show everything, with bars). Text, shapes and captions keep their relative position. Check the result with scene_render_frame and move subjects with scene_update_clips (x) where the crop cuts them off.", {
      preset: S.str("1080p, 720p, 4k, vertical, square or portrait"),
      width: S.num("Custom width"),
      height: S.num("Custom height"),
      mode: S.str("fill (default) or fit", { enum: ["fill", "fit"] }),
    }, [], async (a) => {
      const c = await ctx();
      let m = c.model();
      const p = c.M.PRESETS[a.preset];
      const w = a.width || p?.width;
      const h = a.height || p?.height;
      if (!w || !h) throw new Error("Give a preset or width and height.");
      const fx = w / m.width;
      const fy = h / m.height;
      const k = Math.min(fx, fy);
      const sc = (v, f) => (v && typeof v === "object" ? { kf: v.kf.map((q) => ({ ...q, v: q.v * f })) } : v * f);
      const clips = {};
      for (const [id, cl] of Object.entries(m.clips)) {
        if (cl.type === "audio") clips[id] = cl;
        else if ((cl.type === "video" || cl.type === "image") && m.media[cl.media]?.w) {
          const md = m.media[cl.media];
          const sw = md.w * (1 - cl.crop.l - cl.crop.r);
          const sh = md.h * (1 - cl.crop.t - cl.crop.b);
          const s = a.mode === "fit" ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
          clips[id] = { ...cl, x: w / 2, y: h / 2, sx: s, sy: s };
        } else clips[id] = { ...cl, x: sc(cl.x, fx), y: sc(cl.y, fy), sx: sc(cl.sx, k), sy: sc(cl.sy, k) };
      }
      m = c.M.normalizeScene({ ...m, width: w, height: h, clips });
      c.commit("Reframe", m);
      return { ok: true, width: m.width, height: m.height, refitted: Object.values(m.clips).filter((x) => x.type === "video" || x.type === "image").length };
    }),
  ];
}
