// "Edit together" adapter of the Scene Studio (docs/scene-studio.md ▸ Editing together). Pure: no DOM; tests in
// tests/collab/office-sync.test.js. Loaded by ui/collab/live.js when a scene document is shared live and used through
// collab/office-sync.js (the same record engine as the Office Suite apps).
//
// Records (last writer wins per record, so two people editing different clips merge):
//   scene:meta  { version, title, width, height, fps, background, range }     scene:tracks  [track]   scene:markers  [marker]
//   clip:<id>   a clip of the main sequence           comp:<id>  a pre-composition without its clips (tracks, markers, size)
//   cclip:<comp>/<id>  a clip inside a pre-composition  media:<id>  media description (bytes: chunk records of office-sync.js)
//   analysis:<media id>  transcripts, shots, beats … (left local when larger than a record)
// Incoming clips go through normalizeClip, so a malformed record cannot break the renderer.
import { normalizeClip, isId, CLIP_TYPES } from "./model.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const META = ["version", "title", "width", "height", "fps", "background", "range"];

function mediaInfo(m) {
  const out = {};
  for (const k of ["kind", "mime", "name", "duration", "w", "h", "hasAudio"]) if (m[k] !== undefined && typeof m[k] !== "object") out[k] = m[k];
  return out;
}

export function sceneRecords(model) {
  const out = {};
  const meta = {};
  for (const k of META) if (model[k] !== undefined) meta[k] = model[k];
  out["scene:meta"] = meta;
  out["scene:tracks"] = model.tracks || [];
  out["scene:markers"] = model.markers || [];
  for (const c of Object.values(model.clips || {})) out[`clip:${c.id}`] = c;
  for (const comp of Object.values(model.comps || {})) {
    const { clips, ...rest } = comp;
    out[`comp:${comp.id}`] = rest;
    for (const c of Object.values(clips || {})) out[`cclip:${comp.id}/${c.id}`] = c;
  }
  for (const [id, m] of Object.entries(model.media || {})) if (m) out[`media:${id}`] = mediaInfo(m);
  for (const [id, a] of Object.entries(model.analysis || {})) if (isObj(a)) out[`analysis:${id}`] = a;
  return out;
}

export function applySceneRecords(model, changes) {
  const next = { ...model };
  let clips = null;
  let comps = null;
  let media = null;
  let analysis = null;
  const compClips = new Map(); // comp id → { clip id: value | null }
  for (const [k, v] of Object.entries(changes)) {
    const i = k.indexOf(":");
    const kind = k.slice(0, i);
    const id = k.slice(i + 1);
    if (k === "scene:meta" && isObj(v)) {
      for (const f of META) if (v[f] !== undefined) next[f] = v[f];
    } else if (k === "scene:tracks" && Array.isArray(v)) next.tracks = v.filter((t) => isObj(t) && isId(t.id) && (t.kind === "video" || t.kind === "audio"));
    else if (k === "scene:markers" && Array.isArray(v)) next.markers = v.filter((m) => isObj(m) && Number.isFinite(+m.t));
    else if (kind === "clip" && isId(id)) {
      clips ||= { ...model.clips };
      if (isObj(v) && CLIP_TYPES.includes(v.type)) clips[id] = normalizeClip(next, { ...v, id });
      else delete clips[id];
    } else if (kind === "comp" && isId(id)) {
      comps ||= { ...model.comps };
      if (isObj(v)) comps[id] = { ...v, id, clips: comps[id]?.clips || {} };
      else delete comps[id];
    } else if (kind === "cclip") {
      const [cid, clipId] = id.split("/");
      if (!isId(cid) || !isId(clipId)) continue;
      if (!compClips.has(cid)) compClips.set(cid, {});
      compClips.get(cid)[clipId] = v;
    } else if (kind === "media" && isId(id)) {
      media ||= { ...model.media };
      if (isObj(v)) media[id] = { ...(media[id] || {}), ...mediaInfo(v), id };
      else delete media[id];
    } else if (kind === "analysis" && isId(id)) {
      analysis ||= { ...(model.analysis || {}) };
      if (isObj(v)) analysis[id] = v;
      else delete analysis[id];
    }
  }
  if (media) next.media = media;
  if (clips) next.clips = clips;
  if (compClips.size) {
    comps ||= { ...model.comps };
    for (const [cid, ch] of compClips) {
      const comp = comps[cid];
      if (!comp) continue;
      const cc = { ...comp.clips };
      const seq = { ...next, width: comp.width, height: comp.height };
      for (const [clipId, v] of Object.entries(ch)) {
        if (isObj(v) && CLIP_TYPES.includes(v.type)) cc[clipId] = normalizeClip(seq, { ...v, id: clipId });
        else delete cc[clipId];
      }
      comps[cid] = { ...comp, clips: cc };
    }
  }
  if (comps) next.comps = comps;
  if (analysis) next.analysis = analysis;
  return next;
}

export const sceneCollabAdapter = { records: sceneRecords, applyRecords: applySceneRecords, inlineMedia: 0 };
