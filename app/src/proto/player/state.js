// The state machine of the Proto prototype player (docs/concepts/proto-studio.md §6.2, task T9). Pure: no DOM, tested
// in Node (tests/proto/player-state.test.js). The DOM side (proto/player/player.js) renders the state and plays the
// effects; everything that decides *what* happens lives here.
//
//   initialState(model, { flow?, start?, page? }) → state
//   dispatch(model, state, event, env?) → { state, effects }
//   canBack(state) / varValue(model, state, id) / startOf(model, { flow, start, page })
//
// State (plain, immutable): { start, flow, frame, history: [{ frame, tr }], overlays: [{ id, pos, dim, closeOutside,
//   tr }], vars: { variableId: value }, variants: { instanceKey: { axis: option } }, holds: [{ source, kind, saved }] }
// Events:
//   { type: "actions", actions, source?, instance? }   run actions (a click, a key, a delay…)
//   { type: "hold", kind: "hover" | "press", actions, source, instance? }   run them until "release" (while hovering or
//                                                        pressing); the variants, variables and overlays they changed
//                                                        come back on release
//   { type: "release", source, kind? }                 the pointer left or was released
//   { type: "back" } / { type: "restart" } / { type: "flow", flow }    player controls
// Effects (in order): { kind: "screen", from, to, tr, reverse } · { kind: "overlay", op: "open" | "close" | "swap", id,
//   prev?, tr } · { kind: "update", tr } (variants or variables changed: render again) · { kind: "scroll", to, smooth }
//   · { kind: "url", url, newTab } · { kind: "error", message }
// env.listeners(varId) → [{ actions, source, instance }]: the variableChange interactions of the layers on screen;
// they run after a `set` (cascades are limited to 8 levels and 256 actions per event).
import { evaluate } from "../../engine/proto/expr.js";
import { variableValue } from "../../engine/proto/variables.js";
import { pageList, indexOf, pageKey } from "../../engine/proto/tree.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const MAX_ACTIONS = 256;
const MAX_CASCADE = 8;
const MAX_HISTORY = 200;

/** The frame a prototype starts at: the flow's start, `start`, or the first top-level frame of the page. */
export function startOf(model, { flow = null, start = null, page = null } = {}) {
  if (flow && isObj(model.nodes[flow.start])) return flow.start;
  if (start && isObj(model.nodes[start])) return start;
  const pages = page && model.pages[page] ? [model.pages[page]] : pageList(model);
  for (const p of pages) {
    const tops = indexOf(model).get(pageKey(p.id)) || [];
    const ids = tops.slice().reverse(); // the list is bottom to top; the first frame drawn on top reads naturally
    const frame = ids.map((id) => model.nodes[id]).filter((n) => n && n.visible !== false && (n.type === "frame" || n.type === "component" || n.type === "instance"));
    frame.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    if (frame[0]) return frame[0].id;
  }
  return null;
}

/**
 * @param {object} model
 * @param {{ flow?: {id: string, start: string}|null, start?: string|null, page?: string|null }} [o]
 */
export function initialState(model, o = {}) {
  const start = startOf(model, o);
  return { start, flow: o.flow?.id ?? null, frame: start, history: [], overlays: [], vars: {}, variants: {}, holds: [] };
}

export const canBack = (s) => s.history.length > 0 || s.overlays.length > 0;

/** The current value of a variable in the player: set by the prototype, else the design's value. */
export function varValue(model, state, id) {
  if (Object.prototype.hasOwnProperty.call(state.vars, id)) return state.vars[id];
  const v = variableValue(model, id, {});
  return v === undefined ? null : v;
}

const sameVal = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));

/**
 * Applies an event. Never throws for malformed actions: they are skipped (an `error` effect says why).
 * @param {object} model
 * @param {ReturnType<typeof initialState>} state
 * @param {object} ev
 * @param {{ listeners?: (varId: string) => {actions: object[], source?: string, instance?: string|null}[] }} [env]
 */
export function dispatch(model, state, ev, env = {}) {
  const effects = [];
  let s = state;
  let budget = MAX_ACTIONS;
  let updated = null; // the transition of the last variant or variable change (one "update" effect per event)
  const touch = (tr) => {
    updated = tr ?? updated ?? null;
    if (!effects.some((e) => e.kind === "update")) effects.push({ kind: "update", tr: null });
  };

  const go = (to, tr, reverse = false) => {
    if (!isObj(model.nodes[to])) return void effects.push({ kind: "error", message: `The target “${to}” does not exist.` });
    const from = s.frame;
    s = { ...s, frame: to, overlays: [], holds: [], history: reverse ? s.history : [...s.history, { frame: from, tr: tr ?? null }].slice(-MAX_HISTORY) };
    effects.push({ kind: "screen", from, to, tr: tr ?? null, reverse });
  };

  const run = (actions, ctx, depth) => {
    if (!Array.isArray(actions)) return;
    for (const a of actions) {
      if (--budget < 0) return void (budget === -1 && effects.push({ kind: "error", message: "Too many actions in one step." }));
      if (!isObj(a)) continue;
      switch (a.act) {
        case "navigate":
          if (typeof a.to === "string") {
            if (a.to === s.frame && !s.overlays.length) break;
            go(a.to, a.tr);
          }
          break;
        case "back": {
          if (s.overlays.length) {
            closeTop(a.tr);
            break;
          }
          const last = s.history[s.history.length - 1];
          if (!last) break;
          s = { ...s, history: s.history.slice(0, -1) };
          go(last.frame, a.tr ?? last.tr, true);
          break;
        }
        case "scrollTo":
          if (typeof a.to === "string") effects.push({ kind: "scroll", to: a.to, smooth: a.smooth !== false });
          break;
        case "openOverlay":
          if (typeof a.to === "string" && isObj(model.nodes[a.to])) {
            const o = { id: a.to, pos: a.pos || "center", dim: a.dim === undefined ? "#00000066" : a.dim, closeOutside: a.closeOutside !== false, tr: a.tr ?? null };
            s = { ...s, overlays: [...s.overlays, o].slice(-16) };
            effects.push({ kind: "overlay", op: "open", id: a.to, tr: a.tr ?? null });
          }
          break;
        case "swapOverlay":
          if (typeof a.to === "string" && isObj(model.nodes[a.to])) {
            if (!s.overlays.length) {
              run([{ ...a, act: "openOverlay" }], ctx, depth);
              break;
            }
            const top = s.overlays[s.overlays.length - 1];
            s = { ...s, overlays: [...s.overlays.slice(0, -1), { ...top, id: a.to, tr: a.tr ?? top.tr }] };
            effects.push({ kind: "overlay", op: "swap", id: a.to, prev: top.id, tr: a.tr ?? null });
          }
          break;
        case "closeOverlay":
          closeTop(a.tr);
          break;
        case "variant": {
          const key = typeof a.target === "string" ? a.target : ctx.instance;
          if (!key || !isObj(a.set)) {
            effects.push({ kind: "error", message: "Change to variant: the layer is not part of an instance." });
            break;
          }
          const cur = s.variants[key] || {};
          if (Object.entries(a.set).every(([k, v]) => cur[k] === v)) break;
          s = { ...s, variants: { ...s.variants, [key]: { ...cur, ...a.set } } };
          touch(a.tr);
          break;
        }
        case "set": {
          if (typeof a.var !== "string" || !isObj(model.vars?.items?.[a.var])) {
            effects.push({ kind: "error", message: `The variable “${a.var}” does not exist.` });
            break;
          }
          const r = evaluate(a.value, { vars: (id) => varValue(model, s, id) });
          if (!r.ok) {
            effects.push({ kind: "error", message: r.error });
            break;
          }
          const value = coerce(model.vars.items[a.var].type, r.value);
          if (sameVal(varValue(model, s, a.var), value)) break;
          s = { ...s, vars: { ...s.vars, [a.var]: value } };
          touch(a.tr);
          if (depth < MAX_CASCADE) for (const l of env.listeners?.(a.var) || []) run(l.actions, { source: l.source ?? null, instance: l.instance ?? null }, depth + 1);
          break;
        }
        case "if": {
          const r = evaluate(a.cond, { vars: (id) => varValue(model, s, id) });
          if (!r.ok) {
            effects.push({ kind: "error", message: r.error });
            break;
          }
          if (depth < MAX_CASCADE) run(r.value === true || (r.value !== false && r.value != null && r.value !== 0 && r.value !== "") ? a.then : a.else, ctx, depth + 1);
          break;
        }
        case "openUrl":
          if (typeof a.url === "string" && /^(https?:\/\/|mailto:|tel:)/i.test(a.url.trim())) effects.push({ kind: "url", url: a.url.trim(), newTab: a.newTab !== false });
          break;
        default:
          break; // media and unknown actions: nothing yet
      }
    }
  };
  const closeTop = (tr) => {
    if (!s.overlays.length) return;
    const top = s.overlays[s.overlays.length - 1];
    s = { ...s, overlays: s.overlays.slice(0, -1) };
    effects.push({ kind: "overlay", op: "close", id: top.id, tr: tr ?? top.tr ?? null });
  };

  switch (ev?.type) {
    case "actions":
      run(ev.actions, { source: ev.source ?? null, instance: ev.instance ?? null }, 0);
      break;
    case "hold": {
      if (s.holds.some((h) => h.source === ev.source && h.kind === ev.kind)) break;
      const saved = { frame: s.frame, variants: s.variants, vars: s.vars, overlays: s.overlays };
      run(ev.actions, { source: ev.source ?? null, instance: ev.instance ?? null }, 0);
      if (s.frame === saved.frame) s = { ...s, holds: [...s.holds, { source: ev.source, kind: ev.kind, saved }] };
      break;
    }
    case "release": {
      const i = s.holds.findIndex((h) => h.source === ev.source && (!ev.kind || h.kind === ev.kind));
      if (i < 0) break;
      const h = s.holds[i];
      const holds = s.holds.filter((_, j) => j !== i);
      if (h.saved.frame !== s.frame) {
        s = { ...s, holds };
        break;
      }
      // put back the instances the hold changed (the variants as they were when it started)
      const variants = { ...s.variants };
      for (const k of new Set([...Object.keys(variants), ...Object.keys(h.saved.variants)])) {
        if (h.saved.variants[k] === undefined) delete variants[k];
        else variants[k] = h.saved.variants[k];
      }
      const changed = JSON.stringify(variants) !== JSON.stringify(s.variants);
      const varsChanged = JSON.stringify(h.saved.vars) !== JSON.stringify(s.vars);
      const closing = s.overlays.length > h.saved.overlays.length ? s.overlays.slice(h.saved.overlays.length) : [];
      s = { ...s, holds, variants, vars: varsChanged ? h.saved.vars : s.vars, overlays: closing.length ? s.overlays.slice(0, h.saved.overlays.length) : s.overlays };
      for (const o of closing.reverse()) effects.push({ kind: "overlay", op: "close", id: o.id, tr: o.tr });
      if (changed || varsChanged) touch(null);
      break;
    }
    case "back":
      run([{ act: "back" }], { source: null, instance: null }, 0);
      break;
    case "restart": {
      const from = s.frame;
      s = { ...initialState(model, { start: s.start }), flow: s.flow };
      effects.push({ kind: "screen", from, to: s.frame, tr: null, reverse: false });
      break;
    }
    case "flow": {
      const from = s.frame;
      s = initialState(model, { flow: ev.flow });
      effects.push({ kind: "screen", from, to: s.frame, tr: null, reverse: false });
      break;
    }
    default:
      break;
  }
  const up = effects.find((e) => e.kind === "update");
  if (up) up.tr = updated;
  return { state: s, effects };
}

/** A value of the variable's type (numbers stay finite, strings stay short). */
function coerce(type, v) {
  if (type === "bool") return v === true || (v !== false && v != null && v !== 0 && v !== "" && v !== "false");
  if (type === "number") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "string") return v == null ? "" : String(v).slice(0, 4000);
  if (type === "color") return typeof v === "string" && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : null;
  return v;
}

/**
 * The model the player renders: the design with the player's variant choices written into the instances (a real
 * instance gets `variant`, a layer inside an instance an override `variant` on the outermost real instance).
 * @param {object} model
 * @param {Record<string, Record<string, string>>} variants instanceKey → values
 */
export function withVariants(model, variants) {
  const keys = Object.keys(variants || {});
  if (!keys.length) return model;
  const nodes = { ...model.nodes };
  for (const key of keys) {
    const segs = key.split("/");
    const base = nodes[segs[0]];
    if (!isObj(base) || base.type !== "instance") continue;
    if (segs.length === 1) nodes[segs[0]] = { ...base, variant: { ...(isObj(base.variant) ? base.variant : {}), ...variants[key] } };
    else {
      const path = segs.slice(1).join("/");
      const over = isObj(base.over) ? base.over : {};
      const cur = isObj(over[path]) ? over[path] : {};
      nodes[segs[0]] = { ...base, over: { ...over, [path]: { ...cur, variant: { ...(isObj(cur.variant) ? cur.variant : {}), ...variants[key] } } } };
    }
  }
  return { ...model, nodes };
}
