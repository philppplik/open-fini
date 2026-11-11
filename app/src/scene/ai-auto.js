// Scene Studio transcript- and analysis-driven editing behind the assistant's tools (docs/scene-studio.md ▸
// Assistant): read the transcript on the timeline, cut by transcript, remove silences and filler words, captions
// from the transcript, the searchable index and the notes the assistant writes back. Pure (model in, { model, result }
// out); unit-tested in tests/scene/ai-auto.test.js. Analysis data is in source seconds of a media item
// (scene/analysis.js); these functions map it through the clips that use the item.
import * as M from "./model.js";
import { findPhrase, fillerRanges, buildIndex, searchIndex, normalizeTranscript } from "./analysis.js";
import { wordsToCues, captionsToClips, CAPTION_STYLES } from "./captions.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (v === undefined || v === null || v === "" ? undefined : +v);

/** The media item whose transcript to use: the given id, else the only (or first used) item with a transcript. */
export function transcriptMedia(m, mediaId) {
  if (mediaId) {
    if (!m.media[mediaId]) throw new Error(`There is no media item “${mediaId}”.`);
    if (!m.analysis?.[mediaId]?.transcript) throw new Error(`“${m.media[mediaId].name}” has no transcript yet. Call scene_transcribe (or scene_set_transcript) first.`);
    return mediaId;
  }
  const withT = Object.keys(m.analysis || {}).filter((id) => m.analysis[id].transcript && m.media[id]);
  if (!withT.length) throw new Error("No media item has a transcript yet. Call scene_transcribe (or scene_set_transcript) first.");
  const used = M.clipList(m).find((c) => withT.includes(c.media));
  return used ? used.media : withT[0];
}

// clips that carry a media item's time, sound first (a video and its linked sound cover the same source range)
function carriers(m, mediaId) {
  const all = M.clipList(m).filter((c) => c.media === mediaId && c.in !== undefined);
  const audio = all.filter((c) => c.type === "audio");
  return audio.length ? audio : all;
}

/** Timeline time of a source time of a media item ([] when no clip shows it; several when it is used twice). */
export function sourceToTimeline(m, mediaId, s) {
  return carriers(m, mediaId).filter((c) => s >= c.in - 1e-6 && s < c.in + c.dur * c.speed - 1e-6).map((c) => c.start + (s - c.in) / c.speed);
}

/** Transcript words with their timeline times (words in cut-out parts are left out). */
export function timelineWords(m, mediaId) {
  const words = m.analysis?.[mediaId]?.transcript?.words || [];
  const out = [];
  for (const c of carriers(m, mediaId)) {
    const s0 = c.in;
    const s1 = c.in + c.dur * c.speed;
    words.forEach((w, i) => {
      const mid = (w.t0 + w.t1) / 2;
      if (mid < s0 || mid >= s1) return;
      out.push({ i, w: w.w, t0: r3(c.start + (Math.max(w.t0, s0) - s0) / c.speed), t1: r3(c.start + (Math.min(w.t1, s1) - s0) / c.speed) });
    });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/**
 * The transcript for the assistant: segments (or words) with source and timeline times, limited to a timeline or
 * source window. Segment numbers are stable references for scene_cut_transcript.
 */
export function transcriptView(m, { media, from = 0, to = Infinity, words = false, limit = 400 } = {}) {
  const id = transcriptMedia(m, media);
  const tr = m.analysis[id].transcript;
  const tl = (s) => sourceToTimeline(m, id, s).map(r3);
  const rows = (words ? tr.words.map((w, i) => ({ n: i, t0: w.t0, t1: w.t1, text: w.w })) : tr.segments.map((s, i) => ({ n: i, t0: s.t0, t1: s.t1, text: s.text })))
    .map((r) => ({ ...r, timeline: tl(r.t0) }))
    .filter((r) => r.timeline.length ? r.timeline.some((t) => t >= from - 1e-6 && t < to) : from === 0 && to === Infinity);
  return {
    media: id,
    name: m.media[id].name,
    engine: tr.engine,
    ...(tr.estimated ? { note: "Word times are estimated (the recognizer returned text without timestamps); cuts may be off by a word." } : {}),
    unit: words ? "word" : "segment",
    count: rows.length,
    rows: rows.slice(0, limit).map((r) => `#${r.n} [${r3(r.t0)}–${r3(r.t1)} src${r.timeline.length ? `, ${r.timeline.join("/")} tl` : ", not on timeline"}] ${r.text}`),
    ...(rows.length > limit ? { truncated: `${rows.length - limit} more; pass from/to` } : {}),
  };
}

/** Union of the timeline ranges in which source ranges of a media item play. */
export function sourceRangesToTimeline(m, mediaId, ranges) {
  return M.mergeRanges(ranges.flatMap(([a, b]) => M.timelineRangesOf(m, mediaId, a, b)));
}

/**
 * Source ranges picked from a transcript: `phrases` (every occurrence), `segments` ([first, last] segment numbers,
 * inclusive), `words` ([first, last] word numbers) and `ranges` ([[t0, t1]] source seconds).
 */
export function transcriptSelection(m, mediaId, a) {
  const tr = m.analysis[mediaId].transcript;
  const out = [];
  const missing = [];
  for (const p of a.phrases || []) {
    const hits = findPhrase(tr.words, p);
    if (!hits.length) missing.push(p);
    for (const h of hits) out.push([h.t0, h.t1]);
  }
  const span = (list, [x, y]) => {
    const i0 = Math.max(0, Math.min(+x, +y));
    const i1 = Math.min(list.length - 1, Math.max(+x, +y));
    if (!list[i0] || !list[i1]) throw new Error(`Index ${x}–${y} is outside the transcript (0–${list.length - 1}).`);
    return [list[i0].t0, list[i1].t1];
  };
  for (const s of a.segments || []) out.push(span(tr.segments, Array.isArray(s) ? s : [s, s]));
  for (const w of a.words || []) out.push(span(tr.words, Array.isArray(w) ? w : [w, w]));
  for (const r of a.ranges || []) out.push([+r[0], +r[1]]);
  return { ranges: M.mergeRanges(out.filter(([x, y]) => y > x)), missing };
}

// widens source ranges by `pad` seconds into the pauses around them, never into a neighboring word
function padRanges(words, ranges, pad) {
  if (!pad) return ranges;
  return ranges.map(([a, b]) => {
    const before = [...words].reverse().find((w) => w.t1 <= a + 1e-6);
    const after = words.find((w) => w.t0 >= b - 1e-6);
    return [Math.max(before ? before.t1 : 0, a - pad), Math.min(after ? after.t0 : Infinity, b + pad)];
  });
}

/** Removes (mode cut) or keeps only (mode keep) what was said in the selected transcript parts, on all tracks. */
export function cutByTranscript(m, a) {
  const id = transcriptMedia(m, a.media);
  const { ranges, missing } = transcriptSelection(m, id, a);
  if (!ranges.length) throw new Error(missing.length ? `None of the phrases was found: ${missing.join(" | ")}. Read the transcript with scene_transcript.` : "Select something: phrases, segments, words or ranges.");
  const padded = padRanges(m.analysis[id].transcript.words, ranges, num(a.pad) ?? 0.08);
  const tl = sourceRangesToTimeline(m, id, padded);
  if (!tl.length) throw new Error("The selected parts are not on the timeline (already cut, or the media is not placed).");
  const before = M.duration(m);
  const next = a.mode === "keep" ? M.keepRanges(m, tl) : M.cutRanges(m, tl);
  return { model: next, result: { mode: a.mode === "keep" ? "keep" : "cut", timelineRanges: tl.map(([x, y]) => [r3(x), r3(y)]), removed: r3(before - M.duration(next)), ...(missing.length ? { notFound: missing } : {}) } };
}

/**
 * Silent timeline ranges: where no audible clip makes sound. A clip with silence analysis is silent in those parts
 * of its source; a clip without analysis counts as sound (unless `ignoreUnanalysed`). Ranges shorter than `minDur`
 * are dropped; `pad` seconds of air stay on each side.
 */
export function timelineSilence(m, { minDur = 0.6, pad = 0.12, ignoreUnanalysed = false, media = null } = {}) {
  const total = M.duration(m);
  const muted = new Set(m.tracks.filter((t) => t.muted).map((t) => t.id));
  const sound = [];
  let analysed = 0;
  for (const c of M.clipList(m)) {
    if (c.type !== "audio" || c.muted || muted.has(c.track)) continue;
    if (media && c.media !== media) continue; // only this item's sound decides
    const sil = m.analysis?.[c.media]?.silence;
    if (!sil) {
      if (!ignoreUnanalysed) sound.push([c.start, M.clipEnd(c)]);
      continue;
    }
    analysed++;
    // the clip's source window minus its silent ranges, mapped to the timeline
    let pos = c.in;
    const end = c.in + c.dur * c.speed;
    for (const [a, b] of sil) {
      if (b <= pos || a >= end) continue;
      if (a > pos) sound.push([c.start + (pos - c.in) / c.speed, c.start + (a - c.in) / c.speed]);
      pos = Math.max(pos, b);
    }
    if (end > pos) sound.push([c.start + (pos - c.in) / c.speed, M.clipEnd(c)]);
  }
  if (!analysed) throw new Error("No sound on the timeline has a silence analysis. Call scene_analyze_audio for the media first.");
  const loud = M.mergeRanges(sound);
  const out = [];
  let pos = 0;
  for (const [a, b] of [...loud, [total, total]]) {
    if (a - pos >= minDur) {
      const x = pos > 0 ? pos + pad : pos;
      const y = a < total ? a - pad : a;
      if (y > x) out.push([r3(x), r3(y)]);
    }
    pos = Math.max(pos, b);
  }
  return out;
}

export function removeSilences(m, a = {}) {
  const ranges = timelineSilence(m, { minDur: num(a.minDur) ?? 0.6, pad: num(a.pad) ?? 0.12, ignoreUnanalysed: !!a.ignoreUnanalysed, media: a.media || null });
  if (a.dryRun || !ranges.length) return { model: m, result: { ranges, total: r3(ranges.reduce((s, [x, y]) => s + y - x, 0)), applied: false } };
  const before = M.duration(m);
  const next = M.cutRanges(m, ranges);
  return { model: next, result: { ranges: ranges.length, removed: r3(before - M.duration(next)), applied: true } };
}

/** Removes filler words ("um", "äh" …; `soft` adds words like "like", "also") found in the transcript. */
export function removeFillers(m, a = {}) {
  const id = transcriptMedia(m, a.media);
  const tr = m.analysis[id].transcript;
  const hits = fillerRanges(tr.words, { lang: a.lang || tr.lang, soft: !!a.soft, extra: a.extra || [] });
  const tl = sourceRangesToTimeline(m, id, hits.map((h) => [h.t0, h.t1]));
  const list = hits.map((h) => `${h.w} @${r3(h.t0)}s`);
  if (a.dryRun || !tl.length) return { model: m, result: { found: hits.length, fillers: list.slice(0, 200), applied: false, ...(tr.estimated ? { note: "Word times are estimated; check the cuts." } : {}) } };
  const before = M.duration(m);
  const next = M.cutRanges(m, tl);
  return { model: next, result: { found: hits.length, removed: r3(before - M.duration(next)), fillers: list.slice(0, 60), applied: true } };
}

/** Caption clips from the transcript as it plays on the timeline (cut parts stay out), in a style preset. */
export function autoCaptions(m, a = {}) {
  const id = transcriptMedia(m, a.media);
  if (a.style && !CAPTION_STYLES[a.style]) throw new Error(`Unknown caption style “${a.style}”. Styles: ${Object.keys(CAPTION_STYLES).join(", ")}.`);
  const words = timelineWords(m, id).map((w) => ({ t0: w.t0, t1: w.t1, w: w.w }));
  if (!words.length) throw new Error("No transcribed word plays on the timeline.");
  const cues = wordsToCues(words, { maxChars: num(a.maxChars) ?? (m.height > m.width ? 24 : 42), maxDur: num(a.maxDur) ?? 4, lines: num(a.lines) ?? 1 });
  const r = captionsToClips(m, cues, { style: a.style || "classic", replace: a.replace !== false, y: num(a.y) ?? (m.height > m.width ? 0.7 : 0.86), anim: a.anim || "none" });
  let next = r.model;
  if (a.uppercase) for (const cid of r.ids) next = M.updateClip(next, cid, { text: { text: next.clips[cid].text.text.toUpperCase() } });
  return { model: next, result: { captions: r.ids.length, media: id } };
}

/** Stores a transcript given by the user or another tool (SRT / VTT cues or words / segments). */
export function setTranscript(m, mediaId, raw) {
  const md = m.media[mediaId];
  if (!md) throw new Error(`There is no media item “${mediaId}”.`);
  const tr = normalizeTranscript(raw, md.duration || Infinity);
  if (!tr.words.length) throw new Error("The transcript is empty.");
  return { model: M.setAnalysis(m, mediaId, { transcript: tr }), result: { media: mediaId, words: tr.words.length, segments: tr.segments.length, estimated: tr.estimated } };
}

/**
 * Adds descriptions of what is seen (from frames you looked at) to the index: `notes` [{ t0, t1?, text }] in source
 * seconds of `media`, or in timeline seconds (timeline: true; mapped to the topmost picture clip at that time).
 */
export function addNotes(m, a) {
  const byMedia = new Map();
  for (const n of a.notes || []) {
    const text = String(n.text || "").trim().slice(0, 1000);
    if (!text) continue;
    let media = a.media;
    let t0 = +n.t0;
    let t1 = Number.isFinite(+n.t1) ? +n.t1 : t0;
    if (a.timeline) {
      const c = M.clipList(m).filter((x) => (x.type === "video" || x.type === "image") && x.start <= t0 + 1e-6 && M.clipEnd(x) > t0).sort((p, q) => M.videoTracks(m).findIndex((t) => t.id === p.track) - M.videoTracks(m).findIndex((t) => t.id === q.track))[0];
      if (!c) throw new Error(`No picture clip plays at ${t0} s.`);
      media = c.media;
      const src = (t) => (c.in !== undefined ? c.in + (Math.min(t, M.clipEnd(c)) - c.start) * c.speed : 0);
      [t0, t1] = [src(t0), src(Math.max(t0, t1))];
    }
    if (!m.media[media]) throw new Error(`Pass media (a media id) or timeline: true. “${media}” is not a media item.`);
    if (!byMedia.has(media)) byMedia.set(media, []);
    byMedia.get(media).push({ t0: r3(Math.max(0, t0)), t1: r3(Math.max(t0, t1)), text });
  }
  if (!byMedia.size) throw new Error("Pass notes: [{ t0, t1?, text }].");
  let next = m;
  let count = 0;
  for (const [media, list] of byMedia) {
    const old = (next.analysis?.[media]?.notes || []).filter((o) => !list.some((n) => Math.abs(n.t0 - o.t0) < 0.05 && (a.replace || n.text === o.text)));
    const notes = [...old, ...list].sort((p, q) => p.t0 - q.t0).slice(-5000);
    next = M.setAnalysis(next, media, { notes });
    count += list.length;
  }
  return { model: next, result: { added: count } };
}

/**
 * "Where does X happen": ranks transcript segments, visual notes, markers and captions and maps every hit to the
 * timeline. A hit whose source is not on the timeline has timeline: [].
 */
export function sceneSearch(m, query, { limit = 10, kinds = null } = {}) {
  const hits = searchIndex(buildIndex(m), query, { limit, kinds });
  const mediaWithIndex = Object.keys(m.analysis || {}).filter((id) => m.analysis[id].transcript || m.analysis[id].notes);
  return {
    query,
    hits: hits.map((h) => ({
      kind: h.kind,
      score: h.score,
      text: h.text.slice(0, 240),
      ...(h.media ? { media: h.media, source: [r3(h.t0), r3(h.t1)], timeline: M.timelineRangesOf(m, h.media, h.t0, Math.max(h.t1, h.t0 + 0.01)).map(([x, y]) => [r3(x), r3(y)]) } : { timeline: [[r3(h.t0), r3(h.t1)]] }),
    })),
    ...(!mediaWithIndex.length ? { note: "Nothing is indexed yet: transcribe the footage (scene_transcribe) and describe what you see (scene_sample_frames, then scene_index_note)." } : {}),
  };
}
