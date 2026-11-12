// Scene Studio editing operations behind the timeline's context menus and shortcuts (docs/scene-studio.md ▸
// Context menus): clipboard, reverse and freeze frames, links, gaps, track duplication, layer order, media
// replacement. Pure (model in, model out) on a sequence (scene/model.js ▸ sequence); unit-tested in
// tests/scene/edit-ops.test.js.
import * as M from "./model.js";
import { isTrack, valueAt } from "./keyframes.js";
import { reverseKeys } from "./keyops.js";

const EPS = 1e-6;

/** The clips `ids` and every clip linked to them (picture and sound of one file, linked groups). */
export function linkedIds(m, ids) {
  const links = new Set(ids.map((id) => m.clips[id]?.link).filter(Boolean));
  const out = new Set(ids.filter((id) => m.clips[id]));
  if (links.size) for (const c of Object.values(m.clips)) if (c.link && links.has(c.link)) out.add(c.id);
  return [...out];
}

/** Links clips (they are selected, moved and trimmed together in the timeline). */
export function linkClips(m, ids) {
  const list = ids.filter((id) => m.clips[id]);
  if (list.length < 2) return m;
  const link = M.newId("l");
  return { ...m, clips: { ...m.clips, ...Object.fromEntries(list.map((id) => [id, { ...m.clips[id], link }])) } };
}

/** Removes the clips' links (detaches sound from picture). */
export function unlinkClips(m, ids) {
  const clips = { ...m.clips };
  let changed = false;
  for (const id of linkedIds(m, ids)) {
    if (!clips[id].link) continue;
    const { link: _l, ...rest } = clips[id];
    clips[id] = rest;
    changed = true;
  }
  return changed ? { ...m, clips } : m;
}

// ---------------------------------------------------------------------------------------------- clipboard

/** Copies clips: plain data with starts relative to the earliest clip and the track each was on. */
export function copyClips(m, ids) {
  const src = ids.map((id) => m.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start);
  if (!src.length) return null;
  const t0 = src[0].start;
  return {
    fps: m.fps,
    clips: src.map((c) => ({ ...c, start: c.start - t0, trackIndex: m.tracks.findIndex((k) => k.id === c.track), kind: M.trackOf(m, c.track)?.kind })),
  };
}

/**
 * Pastes copied clips at timeline time `at`. Each clip goes to the track it was copied from when that track exists
 * here (same position and kind, unlocked), else to `track` when given and of the right kind, else to a free track.
 * Clips whose media or composition is not in this project are skipped (`skipped` counts them).
 * @returns {{ model, ids, skipped }}
 */
export function pasteClips(m, board, at, { track = null } = {}) {
  if (!board?.clips?.length) return { model: m, ids: [], skipped: 0 };
  let next = m;
  const ids = [];
  let skipped = 0;
  const links = new Map();
  const target = track ? M.trackOf(m, track) : null;
  for (const c of board.clips) {
    if ((c.media !== undefined && !next.media[c.media]) || (c.type === "comp" && !next.comps?.[c.comp])) {
      skipped++;
      continue;
    }
    const kind = c.type === "audio" ? "audio" : "video";
    let tk = next.tracks[c.trackIndex];
    if (target && target.kind === kind) tk = target;
    if (!tk || tk.kind !== kind || tk.locked) tk = null;
    const link = c.link ? links.get(c.link) || links.set(c.link, M.newId("l")).get(c.link) : undefined;
    const { trackIndex: _i, kind: _k, ...props } = c;
    try {
      const r = M.addClip(next, { ...props, id: undefined, link, track: tk?.id, start: at + c.start, effects: c.effects.map((e) => ({ ...e, id: undefined })) });
      next = r.model;
      ids.push(r.id);
    } catch {
      skipped++;
    }
  }
  return { model: next, ids, skipped };
}

// ---------------------------------------------------------------------------------------------- time

/**
 * Plays a video or composition clip backwards (time remapping, scene format 3). An already remapped clip has its
 * remap keyframes reversed; a constant remap (a freeze frame) stays.
 */
export function reverseClip(m, id) {
  const c = m.clips[id];
  if (!c) throw new Error(`There is no clip “${id}”.`);
  if (c.type !== "video" && c.type !== "comp") throw new Error("Only video and composition clips can play in reverse.");
  const f = 1 / m.fps;
  if (isTrack(c.remap)) return reverseKeys(m, c.remap.kf.map((k) => ({ id, path: "remap", t: k.t })));
  if (c.remap !== undefined) return m;
  const end = Math.max(0, c.dur - f);
  return { ...m, clips: { ...m.clips, [id]: { ...c, remap: { kf: [{ t: 0, v: c.in + end * c.speed }, { t: end, v: c.in }] } } } };
}

/**
 * Freeze frame (frame hold) from timeline time `t`: the clip is split there and the second part shows the frame at
 * `t` for the rest of its length. At the clip's start the whole clip freezes. Returns { model, id } (the frozen part).
 */
export function freezeFrame(m, id, t) {
  const c = m.clips[id];
  if (!c) throw new Error(`There is no clip “${id}”.`);
  if (c.type !== "video" && c.type !== "comp") throw new Error("Only video and composition clips can hold a frame.");
  const at = M.snapT(m, t);
  const local = Math.max(0, Math.min(c.dur, at - c.start));
  const src = c.remap !== undefined ? valueAt(c.remap, local) : c.in + local * c.speed;
  let next = m;
  let fid = id;
  if (at > c.start + EPS && at < M.clipEnd(c) - EPS) {
    const r = M.splitClip(m, id, at);
    next = r.model;
    fid = r.id;
  }
  const fc = next.clips[fid];
  return { model: { ...next, clips: { ...next.clips, [fid]: { ...fc, remap: Math.max(0, src) } } }, id: fid };
}

/** Trims the start or the end of clips to timeline time `t` (no ripple; clips that do not contain `t` stay). */
export function trimTo(m, ids, edge, t) {
  let next = m;
  for (const id of ids) {
    const c = next.clips[id];
    if (!c || t <= c.start + EPS || t >= M.clipEnd(c) - EPS) continue;
    next = M.trimClip(next, id, edge, t);
  }
  return next;
}

/** The gap of a track around timeline time `t`: [start, end) between two clips, or null when `t` is on a clip. */
export function gapAt(m, trackId, t) {
  const list = M.trackClips(m, trackId);
  if (list.some((c) => t >= c.start - EPS && t < M.clipEnd(c) - EPS)) return null;
  const a = Math.max(0, ...list.filter((c) => M.clipEnd(c) <= t + EPS).map(M.clipEnd));
  const later = list.filter((c) => c.start >= t - EPS);
  if (!later.length) return null; // after the last clip there is nothing to close
  return [a, Math.min(...later.map((c) => c.start))];
}

/** Ripple delete of the gap under `t` on one track: the later clips of the track move left to close it. */
export function rippleDeleteGap(m, trackId, t) {
  const g = gapAt(m, trackId, t);
  if (!g || M.trackOf(m, trackId)?.locked) return m;
  const d = g[1] - g[0];
  const clips = { ...m.clips };
  for (const c of M.trackClips(m, trackId)) if (c.start >= g[1] - EPS) clips[c.id] = { ...c, start: M.snapT(m, c.start - d) };
  return { ...m, clips };
}

// ---------------------------------------------------------------------------------------------- tracks and layers

/** A copy of a track (with copies of its clips) right above it. Returns { model, id }. */
export function duplicateTrack(m, trackId) {
  const tk = M.trackOf(m, trackId);
  if (!tk) throw new Error(`There is no track “${trackId}”.`);
  const same = m.tracks.filter((k) => k.kind === tk.kind);
  const r = M.addTrack(m, tk.kind, { name: `${tk.name} ${"copy"}`.slice(0, 40), index: same.indexOf(tk) });
  let next = M.updateTrack(r.model, r.id, { muted: tk.muted, hidden: tk.hidden });
  const links = new Map();
  for (const c of M.trackClips(m, trackId)) {
    const link = c.link ? links.get(c.link) || links.set(c.link, M.newId("l")).get(c.link) : undefined;
    next = M.addClip(next, { ...c, id: undefined, link, track: r.id, effects: c.effects.map((e) => ({ ...e, id: undefined })) }).model;
  }
  return { model: next, id: r.id };
}

/**
 * Layer order in the picture: moves a clip to the next video track above (dir 1) or below (-1) that is free over
 * its time, or to the top / bottom (dir 2 / -2), adding a track when none is free.
 */
export function arrangeClip(m, id, dir) {
  const c = m.clips[id];
  if (!c || c.type === "audio") return m;
  const vids = M.videoTracks(m); // top first
  const i = vids.findIndex((k) => k.id === c.track);
  const free = (k) => !k.locked && !M.overlapping(m, k.id, c.start, M.clipEnd(c), c.id).length;
  if ((dir > 0 && i === 0) || (dir < 0 && i === vids.length - 1)) return m;
  let hit = null;
  let index = 0;
  if (dir === 1) {
    hit = vids.slice(0, i).reverse().find(free);
    index = i; // a new track right above
  } else if (dir === -1) {
    hit = vids.slice(i + 1).find(free);
    index = i + 1;
  } else if (dir === 2) {
    hit = free(vids[0]) ? vids[0] : null;
    index = 0;
  } else {
    hit = free(vids[vids.length - 1]) ? vids[vids.length - 1] : null;
    index = vids.length;
  }
  if (hit) return M.moveClip(m, id, { track: hit.id });
  const r = M.addTrack(m, "video", { index });
  return M.moveClip(r.model, id, { track: r.id });
}

/** Replaces the media of a video, audio or image clip by another media item of the same kind (trim kept where possible). */
export function replaceMedia(m, id, mediaId) {
  const c = m.clips[id];
  const md = m.media[mediaId];
  if (!c || !md) throw new Error("There is no such clip or media item.");
  if (c.media === undefined || m.media[c.media]?.kind !== md.kind) throw new Error(`Choose a ${m.media[c.media]?.kind || "media"} item to replace this clip's media.`);
  const n = { ...c, media: mediaId, name: md.name };
  if (n.in !== undefined && md.duration) n.in = Math.min(n.in, Math.max(0, md.duration - 1 / m.fps));
  return M.updateClip({ ...m, clips: { ...m.clips, [id]: n } }, id, {});
}
