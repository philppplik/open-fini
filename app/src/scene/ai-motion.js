// Scene Studio assistant: motion tools (docs/scene-studio.md ▸ Assistant ▸ Scene motion): parenting and null
// objects, behaviors, sequence layers, keyframe selections, clip time (reverse, freeze, remap), links and effect
// order. Pure: (model, args) → { model, result }; unit-tested in tests/scene/rig.test.js. The tool definitions are
// in vibe/tools/scene-motion.js.
import * as M from "./model.js";
import * as R from "./rig.js";
import * as KO from "./keyops.js";
import * as E from "./edit-ops.js";
import { time, clipOf, clipLine } from "./ai-ops.js";
import { isTrack } from "./keyframes.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (v === undefined || v === null || v === "" ? undefined : +v);
const idsOf = (m, list) => {
  if (!Array.isArray(list) || !list.length) throw new Error("Pass clip ids (from scene_describe).");
  return list.map((id) => clipOf(m, id).id);
};

/** Parents clips to a clip (parent id), to a new null object (nullObject: true) or unparents them (parent: null). */
export function parent(m, a) {
  const list = idsOf(m, a.ids);
  const at = a.at === undefined ? Math.min(...list.map((id) => m.clips[id].start)) : time(m, a.at);
  let next = m;
  let target = a.parent || null;
  let made = null;
  if (a.nullObject) {
    const cs = list.map((id) => next.clips[id]);
    const start = Math.min(...cs.map((c) => c.start));
    const end = Math.max(...cs.map(M.clipEnd));
    const r = M.addClip(next, { ...R.nullProps(), name: a.name || "Null", start, dur: end - start, x: num(a.x) ?? next.width / 2, y: num(a.y) ?? next.height / 2 });
    next = r.model;
    target = made = r.id;
  } else if (target) clipOf(m, target);
  for (const id of list) next = R.setParent(next, id, target, at);
  return { model: next, result: { parent: target, ...(made ? { nullObject: made } : {}), clips: list.map((id) => clipLine(next, next.clips[id])) } };
}

/** Adds, changes or removes a behavior (wiggle, loop, spin) of a clip property. */
export function behavior(m, a) {
  const c = clipOf(m, a.id);
  if (a.action === "remove") return { model: R.updateBehavior(m, c.id, a.behavior, null), result: { removed: a.behavior } };
  if (a.action === "update") return { model: R.updateBehavior(m, c.id, a.behavior, pickBeh(a)), result: { updated: a.behavior } };
  const props = a.prop === "position" ? ["x", "y"] : a.prop === "scale" ? ["sx", "sy"] : [a.prop];
  let next = m;
  const ids = [];
  props.forEach((prop, i) => {
    const r = R.addBehavior(next, c.id, { type: a.type, prop, ...pickBeh(a), ...(a.seed !== undefined ? { seed: +a.seed + i } : { seed: 1 + i }) });
    next = r.model;
    ids.push(r.id);
  });
  return { model: next, result: { added: ids, behaviors: next.clips[c.id].beh } };
}
const pickBeh = (a) => Object.fromEntries(["amount", "freq", "seed", "mode", "rate"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));

/** Sequence layers: offsets the clips one after another (step seconds apart, or overlapping by `overlap`). */
export function stagger(m, a) {
  const list = idsOf(m, a.ids);
  const next = R.staggerClips(m, list, { step: num(a.step) ?? 0.2, overlap: a.overlap === undefined ? null : +a.overlap, order: a.order || "selection", from: a.from === undefined ? null : time(m, a.from), moveClip: M.moveClip });
  return { model: next, result: { clips: list.map((id) => clipLine(next, next.clips[id])) } };
}

/**
 * Edits keyframes of one clip: `paths` (default every animated property) and `at` (timeline times; default every
 * keyframe). Actions: move (by seconds), scale (factor around pivot, default the first selected keyframe), reverse,
 * delete, ease (preset), value.
 */
export function keyframeEdit(m, a) {
  const c = clipOf(m, a.id);
  const paths = a.paths?.length ? a.paths : M.animatedPaths(c);
  let sel = paths.flatMap((p) => KO.keysOfClip(c, p));
  if (Array.isArray(a.at) && a.at.length) {
    const at = a.at.map((x) => time(m, x) - c.start);
    sel = sel.filter((k) => at.some((x) => Math.abs(k.t - x) < 0.5 / m.fps));
  }
  if (!sel.length) throw new Error(`No keyframes of “${c.name || c.id}” match. Animated properties: ${M.animatedPaths(c).join(", ") || "none"}.`);
  let next = m;
  switch (a.action) {
    case "move":
      next = KO.retimeKeys(m, sel, { dt: +a.by || 0 }).model;
      break;
    case "scale": {
      const pivot = a.pivot !== undefined ? time(m, a.pivot) : c.start + Math.min(...sel.map((k) => k.t));
      next = KO.retimeKeys(m, sel, { factor: +a.factor || 1, pivot }).model;
      break;
    }
    case "reverse":
      next = KO.reverseKeys(m, sel);
      break;
    case "delete":
      next = KO.deleteKeys(m, sel);
      break;
    case "ease":
      next = KO.easeKeys(m, sel, a.preset || "easyEase");
      break;
    case "value":
      next = KO.setKeyValue(m, sel, a.value);
      break;
    default:
      throw new Error("action is move, scale, reverse, delete, ease or value.");
  }
  const after = next.clips[c.id];
  return { model: next, result: { keyframes: Object.fromEntries(M.animatedPaths(after).map((p) => [p, M.keyframesOf(next, c.id, p).map((k) => `${k.t}s=${typeof k.v === "number" ? r3(k.v) : k.v}`)])) } };
}

/** Clip time: reverse, freeze (frame hold from `at`), remap on / off (time remapping keyframes). */
export function clipTime(m, a) {
  const c = clipOf(m, a.id);
  let next;
  let id = c.id;
  if (a.action === "reverse") next = E.reverseClip(m, c.id);
  else if (a.action === "freeze") ({ model: next, id } = E.freezeFrame(m, c.id, a.at === undefined ? c.start : time(m, a.at)));
  else if (a.action === "remap") next = M.setTimeRemap(m, c.id, a.on !== false);
  else throw new Error("action is reverse, freeze or remap.");
  const n = next.clips[id];
  return { model: next, result: { clip: clipLine(next, n), remap: isTrack(n.remap) ? n.remap.kf.map((k) => `${r3(c.start + k.t)}s→${r3(k.v)}s`) : n.remap } };
}

/** Links or unlinks clips (linked clips are selected and moved together; video and its sound are linked). */
export function link(m, a) {
  const list = idsOf(m, a.ids);
  const next = a.action === "unlink" ? E.unlinkClips(m, list) : E.linkClips(m, list);
  return { model: next, result: { clips: list.map((id) => ({ id, link: next.clips[id].link || null })) } };
}

/** Effect stack: moves an effect to a position (0 = first applied) or resets its parameters. */
export function effectOrder(m, a) {
  const c = clipOf(m, a.id);
  const fx = c.effects.find((e) => e.id === a.effect || e.type === a.effect);
  if (!fx) throw new Error(`Clip “${c.id}” has no effect “${a.effect}”. Effects: ${c.effects.map((e) => `${e.id} (${e.type})`).join(", ") || "none"}.`);
  let next = m;
  if (a.reset) next = M.resetEffect(next, c.id, fx.id);
  if (a.index !== undefined) next = M.moveEffect(next, c.id, fx.id, +a.index);
  return { model: next, result: { effects: next.clips[c.id].effects.map((e) => `${e.id} ${e.type}${e.on ? "" : " (off)"}`) } };
}
