// Scene Studio captions (docs/scene-studio.md ▸ Captions): SubRip (.srt) and WebVTT (.vtt) in and out, transcript
// words → readable cues, cues → caption clips on a "Captions" track. Pure; unit-tested in tests/scene/captions.test.js.
//
// A cue is { t0, t1, text } in seconds. Caption clips are text clips with `caption: true`, so they export as
// burned-in subtitles AND as a subtitle file, and the assistant can restyle all of them at once.
import { addClip, addTrack, clipList, clipEnd, videoTracks, deleteClips, snapT } from "./model.js";

const TS = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSec = (s) => {
  const m = TS.exec(s);
  if (!m) return NaN;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4].padEnd(3, "0"), 10) / 1000;
};

// Formatting tags (<i>, <c.class>, <00:01.000>) are dropped; what is left is plain text (it is drawn on a canvas,
// never inserted as HTML), so every remaining angle bracket goes too.
function stripTags(s) {
  let out = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "<") depth++;
    else if (ch === ">") depth = Math.max(0, depth - 1);
    else if (!depth) out += ch;
  }
  return out;
}

/** Parses SRT or WebVTT text into cues (tags and positioning are dropped, overlapping cues are kept). */
export function parseSubtitles(text) {
  const cues = [];
  const blocks = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const t0 = toSec(a);
    const t1 = toSec(b);
    const body = stripTags(lines.slice(i + 1).join("\n")).replace(/\{\\[^}]*\}/g, "").trim();
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 && body) cues.push({ t0, t1, text: body });
    if (cues.length >= 20000) break;
  }
  return cues.sort((x, y) => x.t0 - y.t0);
}

const stamp = (t, sep) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

export const formatSrt = (cues) => cues.map((c, i) => `${i + 1}\n${stamp(c.t0, ",")} --> ${stamp(c.t1, ",")}\n${c.text}\n`).join("\n");
export const formatVtt = (cues) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.t0, ".")} --> ${stamp(c.t1, ".")}\n${c.text}\n`).join("\n")}`;

/**
 * Groups transcript words ({ t0, t1, w }) into caption cues: at most `maxChars` characters and `maxDur` seconds per
 * cue, a new cue after a pause longer than `gap` seconds or after sentence punctuation when the cue is half full.
 */
export function wordsToCues(words, { maxChars = 42, maxDur = 4, gap = 0.7, lines = 1 } = {}) {
  const cues = [];
  let cur = null;
  const limit = maxChars * Math.max(1, lines);
  const flush = () => {
    if (!cur) return;
    let text = cur.words.join(" ");
    if (lines > 1 && text.length > maxChars) {
      // break near the middle at a space
      const mid = text.length / 2;
      let best = -1;
      for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
      if (best > 0) text = `${text.slice(0, best)}\n${text.slice(best + 1)}`;
    }
    cues.push({ t0: cur.t0, t1: cur.t1, text });
    cur = null;
  };
  for (const w of words) {
    const word = String(w.w ?? w.text ?? "").trim();
    if (!word) continue;
    if (cur) {
      const len = cur.words.join(" ").length + 1 + word.length;
      if (w.t0 - cur.t1 > gap || len > limit || w.t1 - cur.t0 > maxDur) flush();
    }
    if (!cur) cur = { t0: w.t0, t1: w.t1, words: [] };
    cur.words.push(word);
    cur.t1 = Math.max(cur.t1, w.t1);
    if (/[.!?…]$/.test(word) && cur.words.join(" ").length >= limit / 2) flush();
  }
  flush();
  return cues;
}

export const CAPTION_STYLES = {
  classic: { size: 54, weight: 600, color: "#ffffff", bg: "#000000", bgPad: 14, bgRadius: 6, stroke: null, strokeW: 0, shadow: false },
  outline: { size: 60, weight: 800, color: "#ffffff", bg: null, stroke: "#000000", strokeW: 10, shadow: false },
  bold: { size: 84, weight: 900, color: "#ffe600", bg: null, stroke: "#000000", strokeW: 14, shadow: true },
  minimal: { size: 48, weight: 500, color: "#ffffff", bg: null, stroke: null, strokeW: 0, shadow: true },
};

/** The caption clips of a sequence as cues, in time order. */
export const captionCues = (m) => clipList(m).filter((c) => c.caption).map((c) => ({ t0: c.start, t1: clipEnd(c), text: c.text.text, id: c.id }));

/**
 * Puts cues on the timeline as caption clips (a "Captions" track on top is created when needed). `replace` removes
 * the existing captions first. Position: horizontally centered, `y` as a fraction of the frame height (default 0.86).
 * @returns {{ model, ids }}
 */
export function captionsToClips(m, cues, { style = "classic", replace = false, y = 0.86, offset = 0, anim = "none" } = {}) {
  let next = replace ? deleteClips(m, clipList(m).filter((c) => c.caption).map((c) => c.id)) : m;
  let tk = videoTracks(next).find((t) => t.name === "Captions");
  if (!tk) {
    const r = addTrack(next, "video", { name: "Captions" });
    next = r.model;
    tk = videoTracks(next).find((t) => t.id === r.id);
  }
  const st = CAPTION_STYLES[style] || CAPTION_STYLES.classic;
  const frame = 1 / m.fps;
  const ids = [];
  const sorted = cues.filter((c) => c && c.t1 > c.t0 && String(c.text || "").trim()).sort((a, b) => a.t0 - b.t0);
  sorted.forEach((c, i) => {
    const start = snapT(m, Math.max(0, c.t0 + offset));
    // clips of one track cannot overlap: a cue ends where the next one starts
    const nextStart = sorted[i + 1] ? snapT(m, Math.max(0, sorted[i + 1].t0 + offset)) : Infinity;
    const end = Math.min(snapT(m, c.t1 + offset), nextStart);
    if (end - start < frame) return;
    const r = addClip(next, { type: "text", caption: true, track: tk.id, start, dur: end - start, x: m.width / 2, y: m.height * y, text: { ...st, text: String(c.text).trim(), boxW: Math.round(m.width * 0.86), anim: { in: anim, inDur: Math.min(0.3, (end - start) / 2), out: "none", outDur: 0.3 } } });
    next = r.model;
    ids.push(r.id);
  });
  return { model: next, ids };
}
