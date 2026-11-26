// Prototype interactions and flows of the Proto model (docs/concepts/proto-studio.md §6, task T9). Pure: no DOM.
//
// A layer's `proto` is a list of interactions; a page's `flows` are named starting points of a prototype.
//   interaction  { on: trigger, do: [action, …] }
//   trigger      { type: click | doubleClick | press | hover | mouseEnter | mouseLeave | drag | key | afterDelay |
//                  variableChange, key?: "Escape" (key), mods?: ["shift", "alt", "ctrl", "meta"] (key),
//                  ms?: 800 (afterDelay), var?: "<variable id>" (variableChange) }
//                  `press` and `hover` run while the layer is pressed or hovered: the player undoes their variant
//                  changes, opened overlays and variable changes when the pointer is released or leaves.
//   action       { act: navigate, to: frameId, tr? }       go to a top-level frame (pushes the history)
//                { act: back, tr? }                        the previous frame (the transition plays reversed)
//                { act: scrollTo, to: layerId, smooth? }   scroll the layer into view inside its scroll container
//                { act: openOverlay, to: frameId, pos?, dim?, closeOutside?, tr? }   show a frame above the screen
//                { act: swapOverlay, to: frameId, tr? }    replace the topmost overlay
//                { act: closeOverlay, tr? }                close the topmost overlay
//                { act: variant, set: { axis: option }, target?: instanceId, tr? }   change an instance's variant
//                                                          (default: the instance the triggering layer belongs to)
//                { act: set, var: variableId, value: expr }   set a variable (expr.js)
//                { act: if, cond: expr, then: [action], else: [action] }
//                { act: openUrl, url, newTab? }            http(s), mailto and tel links (the app confirms them)
//                { act: media }                            reserved (play or pause a video fill, later)
//   transition   { type: instant | dissolve | moveIn | moveOut | push | slide | smart, dir?: left | right | up | down,
//                  dur?: ms (default 300), ease?: linear | ease | ease-in | ease-out | ease-in-out | { bezier: [x1, y1,
//                  x2, y2] } | { spring: [mass, stiffness, damping] } }
//   flow         { id, name, start: top-level frame id on the page, description? }
//
// Operations (registered in ops.js; each is one undo step with an exact inverse):
//   interaction.add      { id, interaction, index? }          append (or insert at index)
//   interaction.set      { id, index, interaction }           replace one
//   interaction.delete   { id, index }                        remove one
//   interaction.connect  { from, to: frameId | null, trigger?, tr? }   the Connect tool: the first interaction of that
//                                                              trigger that navigates gets the new target (or is added);
//                                                              `to: null` removes it
//   flow.create          { start, page?, id?, name?, description? }
//   flow.update          { page, id, set: { name?, start?, description? } }
//   flow.delete          { page, id }
//
// Helpers for the editor, the player, the assistant and the CLI:
//   interactionProblems(model, it) → string[]     what is wrong with one interaction (the operations refuse these)
//   transition(tr) → { type, dir, dur, ease }     defaults filled in;  easingCss(ease, dur?) → CSS easing
//   springCurve(spring, n) / springDuration(spring)                  a damped spring sampled for CSS linear()
//   connections(model, pageId) → [{ from, index, act, to, trigger, path }]   the arrows of Prototype mode
//   flowGraph(model, flow) → { screens, edges, missing }           frames reachable from a flow's start
//   describe(it, nameOf) → "On click: navigate to Home (smart animate, 300 ms)"
//   interactionsOf(model, r) → list   a resolved layer's interactions (an instance without its own falls back to
//                                     the interactions of the variant it shows: interactive components)
//   instanceKeyOf(r) / flatten(resolvedRoot) / matchLayers(a, b)     smart animate: which layers correspond
import { TRIGGERS, ACTIONS } from "./schema.js";
import { pickVariant } from "./components.js";
import { check as checkExpr } from "./expr.js";
import { newId, isId } from "./ids.js";
import { descendants } from "./tree.js";

export const TRANSITIONS = Object.freeze(["instant", "dissolve", "moveIn", "moveOut", "push", "slide", "smart"]);
export const DIRECTIONS = Object.freeze(["left", "right", "up", "down"]);
export const EASINGS = Object.freeze(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
export const OVERLAY_POSITIONS = Object.freeze(["center", "top", "bottom", "left", "right", "topLeft", "topRight", "bottomLeft", "bottomRight"]);
export const KEY_MODS = Object.freeze(["shift", "alt", "ctrl", "meta"]);
/** Actions whose `to` is a top-level frame. */
export const FRAME_ACTS = Object.freeze(["navigate", "openOverlay", "swapOverlay"]);
/** Triggers that react to the pointer on a layer (the player's hotspots). */
export const POINTER_TRIGGERS = Object.freeze(["click", "doubleClick", "press", "drag"]);
export const DEFAULT_DURATION = 300;
export const LIMITS = Object.freeze({ actions: 64, depth: 8, delay: 600000, duration: 10000, url: 2048 });

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const URL_RE = /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+0-9()\-\s.]+)$/i;

// ------------------------------------------------------------------------------------------------- transitions

/** A transition with its defaults (`null` and unknown types are instant). */
export function transition(tr) {
  if (!isObj(tr) || !TRANSITIONS.includes(tr.type) || tr.type === "instant") return { type: "instant", dir: "left", dur: 0, ease: "ease-out" };
  const dur = Number.isFinite(tr.dur) ? Math.max(0, Math.min(LIMITS.duration, tr.dur)) : isObj(tr.ease) && Array.isArray(tr.ease.spring) ? springDuration(tr.ease.spring) : DEFAULT_DURATION;
  return { type: tr.type, dir: DIRECTIONS.includes(tr.dir) ? tr.dir : "left", dur, ease: tr.ease ?? "ease-out" };
}

const springParams = (s) => {
  const [m, k, c] = Array.isArray(s) ? s : [];
  return { m: Number.isFinite(m) && m > 0 ? Math.min(m, 100) : 1, k: Number.isFinite(k) && k > 0 ? Math.min(k, 10000) : 300, c: Number.isFinite(c) && c >= 0 ? Math.min(c, 1000) : 20 };
};
/** Position (0 → 1) of a damped spring released from 0 towards 1, at time `t` seconds. */
function springAt({ m, k, c }, t) {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
  const a = r2 / (r2 - r1);
  return 1 - a * Math.exp(r1 * t) - (1 - a) * Math.exp(r2 * t);
}
/** How long a spring takes to settle within 0.1 % (ms, 50 to 10,000). */
export function springDuration(spring) {
  const p = springParams(spring);
  let last = 0;
  for (let t = 0; t <= 10; t += 0.005) if (Math.abs(springAt(p, t) - 1) > 0.001) last = t;
  return Math.round(Math.max(50, Math.min(LIMITS.duration, (last + 0.005) * 1000)));
}
/** `n` samples of a spring over its settle time (the last one is exactly 1). */
export function springCurve(spring, n = 40) {
  const p = springParams(spring);
  const T = springDuration(spring) / 1000;
  const out = [];
  for (let i = 0; i <= n; i++) out.push(i === n ? 1 : Math.round(springAt(p, (T * i) / n) * 10000) / 10000);
  return out;
}

/** The CSS easing of `ease`: a keyword, `cubic-bezier()`, or a spring sampled into `linear()`. */
export function easingCss(ease) {
  if (typeof ease === "string" && EASINGS.includes(ease)) return ease;
  if (isObj(ease) && Array.isArray(ease.bezier) && ease.bezier.length === 4 && ease.bezier.every(Number.isFinite)) {
    const [a, b, c, d] = ease.bezier;
    return `cubic-bezier(${Math.max(0, Math.min(1, a))}, ${b}, ${Math.max(0, Math.min(1, c))}, ${d})`;
  }
  if (isObj(ease) && Array.isArray(ease.spring)) return `linear(${springCurve(ease.spring, 40).join(", ")})`;
  return "ease-out";
}

// ------------------------------------------------------------------------------------------------- validation

function trProblems(tr, path, out) {
  if (tr === undefined || tr === null) return;
  if (!isObj(tr)) return void out.push(`${path}: expected a transition object.`);
  if (!TRANSITIONS.includes(tr.type)) out.push(`${path}.type: expected one of ${TRANSITIONS.join(", ")}.`);
  if (tr.dir !== undefined && !DIRECTIONS.includes(tr.dir)) out.push(`${path}.dir: expected one of ${DIRECTIONS.join(", ")}.`);
  if (tr.dur !== undefined && !(Number.isFinite(tr.dur) && tr.dur >= 0 && tr.dur <= LIMITS.duration)) out.push(`${path}.dur: expected 0 to ${LIMITS.duration} ms.`);
  const e = tr.ease;
  if (e !== undefined && !(typeof e === "string" && EASINGS.includes(e)) && !(isObj(e) && Array.isArray(e.bezier) && e.bezier.length === 4 && e.bezier.every(Number.isFinite)) && !(isObj(e) && Array.isArray(e.spring) && e.spring.length === 3 && e.spring.every((x) => Number.isFinite(x) && x >= 0))) {
    out.push(`${path}.ease: expected ${EASINGS.join(", ")}, { bezier: [x1, y1, x2, y2] } or { spring: [mass, stiffness, damping] }.`);
  }
}

const topLevel = (model, id) => isObj(model?.nodes?.[id]) && model.nodes[id].parent == null;

function actionProblems(model, list, path, depth, count, out) {
  if (!Array.isArray(list)) return void out.push(`${path}: expected a list of actions.`);
  if (depth > LIMITS.depth) return void out.push(`${path}: conditions are nested too deeply.`);
  list.forEach((a, i) => {
    const p = `${path}[${i}]`;
    if (++count.n > LIMITS.actions) return void (count.n === LIMITS.actions + 1 && out.push(`${path}: more than ${LIMITS.actions} actions.`));
    if (!isObj(a)) return void out.push(`${p}: expected an action object.`);
    if (!ACTIONS.includes(a.act)) return void out.push(`${p}.act: expected one of ${ACTIONS.join(", ")}.`);
    if (FRAME_ACTS.includes(a.act)) {
      if (typeof a.to !== "string") out.push(`${p}.to: expected a frame id.`);
      else if (!isObj(model?.nodes?.[a.to])) out.push(`${p}.to: the layer “${a.to}” does not exist.`);
      else if (!topLevel(model, a.to)) out.push(`${p}.to: “${model.nodes[a.to].name || a.to}” is not a top-level frame.`);
    }
    if (a.act === "scrollTo") {
      if (typeof a.to !== "string" || !isObj(model?.nodes?.[a.to])) out.push(`${p}.to: expected an existing layer id.`);
      if (a.smooth !== undefined && typeof a.smooth !== "boolean") out.push(`${p}.smooth: expected true or false.`);
    }
    if (a.act === "openOverlay") {
      if (a.pos !== undefined && !OVERLAY_POSITIONS.includes(a.pos)) out.push(`${p}.pos: expected one of ${OVERLAY_POSITIONS.join(", ")}.`);
      if (a.dim !== undefined && a.dim !== null && !(typeof a.dim === "string" && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(a.dim))) out.push(`${p}.dim: expected a hex color or null.`);
      if (a.closeOutside !== undefined && typeof a.closeOutside !== "boolean") out.push(`${p}.closeOutside: expected true or false.`);
    }
    if (a.act === "variant") {
      if (!isObj(a.set) || !Object.keys(a.set).length) out.push(`${p}.set: expected { property: option }.`);
      else for (const [k, v] of Object.entries(a.set)) if (typeof v !== "string" || !k || k.length > 64) out.push(`${p}.set.${k}: expected an option name.`);
      if (a.target !== undefined && a.target !== null && (typeof a.target !== "string" || model?.nodes?.[a.target]?.type !== "instance")) out.push(`${p}.target: expected an instance id.`);
    }
    if (a.act === "set") {
      if (typeof a.var !== "string" || !isObj(model?.vars?.items?.[a.var])) out.push(`${p}.var: expected an existing variable id.`);
      if (!own(a, "value")) out.push(`${p}.value: missing.`);
      else for (const m of checkExpr(a.value)) out.push(`${p}.value: ${m.replace(/^expr\.?/, "")}`);
    }
    if (a.act === "if") {
      if (!own(a, "cond")) out.push(`${p}.cond: missing.`);
      else for (const m of checkExpr(a.cond)) out.push(`${p}.cond: ${m.replace(/^expr\.?/, "")}`);
      actionProblems(model, a.then ?? [], `${p}.then`, depth + 1, count, out);
      actionProblems(model, a.else ?? [], `${p}.else`, depth + 1, count, out);
    }
    if (a.act === "openUrl") {
      if (typeof a.url !== "string" || a.url.length > LIMITS.url || !URL_RE.test(a.url.trim())) out.push(`${p}.url: expected an http(s), mailto or tel link.`);
      if (a.newTab !== undefined && typeof a.newTab !== "boolean") out.push(`${p}.newTab: expected true or false.`);
    }
    trProblems(a.tr, `${p}.tr`, out);
  });
}

/**
 * What is wrong with one interaction (in the context of `model`, for targets and variables).
 * @param {object} model
 * @param {unknown} it
 * @returns {string[]}
 */
export function interactionProblems(model, it) {
  const out = [];
  if (!isObj(it)) return ["Expected an interaction { on, do }."];
  for (const k of Object.keys(it)) if (k !== "on" && k !== "do") out.push(`Unknown key “${k}”.`);
  const on = it.on;
  if (!isObj(on) || !TRIGGERS.includes(on.type)) out.push(`on.type: expected one of ${TRIGGERS.join(", ")}.`);
  else {
    if (on.type === "key") {
      if (typeof on.key !== "string" || !on.key || on.key.length > 32) out.push("on.key: expected a key name such as “Escape”, “ArrowRight” or “a”.");
      if (on.mods !== undefined && (!Array.isArray(on.mods) || !on.mods.every((m) => KEY_MODS.includes(m)))) out.push(`on.mods: expected a list of ${KEY_MODS.join(", ")}.`);
    }
    if (on.type === "afterDelay" && !(Number.isFinite(on.ms) && on.ms >= 0 && on.ms <= LIMITS.delay)) out.push(`on.ms: expected 0 to ${LIMITS.delay} ms.`);
    if (on.type === "variableChange" && (typeof on.var !== "string" || !isObj(model?.vars?.items?.[on.var]))) out.push("on.var: expected an existing variable id.");
  }
  actionProblems(model, it.do, "do", 0, { n: 0 }, out);
  return out;
}

// ------------------------------------------------------------------------------------------------- reading

/** Walks every action of an interaction list, also inside `if` branches: fn(action, path). */
export function eachAction(list, fn, path = [], depth = 0) {
  if (!Array.isArray(list) || depth > LIMITS.depth) return;
  list.forEach((a, i) => {
    if (!isObj(a)) return;
    fn(a, [...path, i]);
    if (a.act === "if") {
      eachAction(a.then, fn, [...path, i, "then"], depth + 1);
      eachAction(a.else, fn, [...path, i, "else"], depth + 1);
    }
  });
}

/**
 * The connections of a page: one entry per action with a target, for the arrows of Prototype mode.
 * @param {object} model
 * @param {string} pageId
 */
export function connections(model, pageId) {
  const out = [];
  for (const n of Object.values(model?.nodes || {})) {
    if (!isObj(n) || n.page !== pageId || !Array.isArray(n.proto) || !n.proto.length) continue;
    n.proto.forEach((it, index) => {
      if (!isObj(it)) return;
      eachAction(it.do, (a, path) => {
        if ((FRAME_ACTS.includes(a.act) || a.act === "scrollTo") && typeof a.to === "string" && isObj(model.nodes[a.to])) out.push({ from: n.id, index, act: a.act, to: a.to, trigger: it.on?.type || "click", path });
        else if (a.act === "back" || a.act === "closeOverlay") out.push({ from: n.id, index, act: a.act, to: null, trigger: it.on?.type || "click", path });
      });
    });
  }
  return out;
}

/** The top-level ancestor of a layer. */
export function topOf(model, id) {
  let n = model?.nodes?.[id];
  let guard = 0;
  while (n && n.parent != null && guard++ < 256) n = model.nodes[n.parent];
  return n ? n.id : null;
}

/**
 * Frames reachable from a flow's start through navigate and overlay actions (breadth first).
 * @param {object} model
 * @param {{ start: string }} flow
 * @returns {{ screens: string[], edges: {from: string, via: string, to: string, act: string, trigger: string}[], missing: string[] }}
 */
export function flowGraph(model, flow) {
  const screens = [];
  const edges = [];
  const missing = new Set();
  // the layers of a frame with interactions, in document order (pre-order, bottom to top)
  const withProto = (top) => [top, ...(model.nodes[top] ? descendants(model, top) : [])].map((id) => model.nodes[id]).filter((n) => isObj(n) && Array.isArray(n.proto) && n.proto.length);
  const start = flow?.start;
  if (!isObj(model?.nodes?.[start])) return { screens, edges, missing: start ? [start] : [] };
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length && screens.length < 1000) {
    const f = queue.shift();
    screens.push(f);
    for (const n of withProto(f)) {
      n.proto.forEach((it) => {
        if (!isObj(it)) return;
        eachAction(it.do, (a) => {
          if (!FRAME_ACTS.includes(a.act) || typeof a.to !== "string") return;
          if (!isObj(model.nodes[a.to])) return void missing.add(a.to);
          edges.push({ from: f, via: n.id, to: a.to, act: a.act, trigger: it.on?.type || "click" });
          if (!seen.has(a.to)) {
            seen.add(a.to);
            queue.push(a.to);
          }
        });
      });
    }
  }
  return { screens, edges, missing: [...missing] };
}

const TRIGGER_TEXT = { click: "On click", doubleClick: "On double click", press: "While pressing", hover: "While hovering", mouseEnter: "Mouse enter", mouseLeave: "Mouse leave", drag: "On drag", key: "Key", afterDelay: "After delay", variableChange: "Variable change" };
const TR_TEXT = { dissolve: "dissolve", moveIn: "move in", moveOut: "move out", push: "push", slide: "slide", smart: "smart animate" };

/** A one-line English description of an interaction (the CLI and the assistant; the panel translates its own). */
export function describe(it, nameOf = (id) => id) {
  if (!isObj(it)) return "(invalid)";
  const on = it.on || {};
  let head = TRIGGER_TEXT[on.type] || String(on.type);
  if (on.type === "key") head += ` ${[...(on.mods || []), on.key].join("+")}`;
  if (on.type === "afterDelay") head += ` ${on.ms} ms`;
  if (on.type === "variableChange") head += ` ${nameOf(on.var)}`;
  const act = (a) => {
    if (!isObj(a)) return "?";
    const tr = isObj(a.tr) && a.tr.type !== "instant" ? ` (${TR_TEXT[a.tr.type] || a.tr.type}${a.tr.dir && a.tr.type !== "smart" && a.tr.type !== "dissolve" ? ` ${a.tr.dir}` : ""}, ${transition(a.tr).dur} ms)` : "";
    switch (a.act) {
      case "navigate":
        return `navigate to ${nameOf(a.to)}${tr}`;
      case "back":
        return `back${tr}`;
      case "scrollTo":
        return `scroll to ${nameOf(a.to)}`;
      case "openOverlay":
        return `open overlay ${nameOf(a.to)}${tr}`;
      case "swapOverlay":
        return `swap overlay with ${nameOf(a.to)}${tr}`;
      case "closeOverlay":
        return "close overlay";
      case "variant":
        return `change to ${Object.entries(a.set || {}).map(([k, v]) => `${k}=${v}`).join(", ")}${tr}`;
      case "set":
        return `set ${nameOf(a.var)} = ${JSON.stringify(a.value)}`;
      case "if":
        return `if ${JSON.stringify(a.cond)} then [${(a.then || []).map(act).join("; ")}]${a.else?.length ? ` else [${a.else.map(act).join("; ")}]` : ""}`;
      case "openUrl":
        return `open ${a.url}`;
      default:
        return a.act;
    }
  };
  return `${head}: ${(Array.isArray(it.do) ? it.do : []).map(act).join("; ") || "nothing"}`;
}

/** The key of the instance a resolved layer belongs to (itself when it is an instance), or null. */
export function instanceKeyOf(r) {
  if (!r) return null;
  if (r.type === "instance") return r.key;
  return r.instance || null;
}

/**
 * The interactions of a resolved layer. An instance without interactions of its own uses those of the variant it
 * shows, so states drawn on a component set (hover, pressed) work on every instance.
 * @param {object} model
 * @param {object} r resolved node (resolve.js)
 */
export function interactionsOf(model, r) {
  const ownList = Array.isArray(r?.node?.proto) && r.node.proto.length ? r.node.proto : null;
  if (ownList || r?.type !== "instance") return ownList || [];
  const st = r.src || model?.nodes?.[r.id];
  if (!isObj(st) || typeof st.of !== "string") return [];
  const comp = pickVariant(model, model.nodes[st.of], st.variant);
  return Array.isArray(comp?.proto) ? comp.proto : [];
}

// ------------------------------------------------------------------------------------------------- smart animate

/**
 * A resolved tree as a flat list in document order: { key, id, name, type, parent, of, depth, path }, where `path` is
 * the names of the layer's ancestors below the root and its own (joined with "/").
 * @param {object} root resolved root (resolve.js)
 */
export function flatten(root) {
  const out = [];
  const visit = (r, parent, path, depth) => {
    const name = String(r.node?.name ?? r.type);
    const p = depth === 0 ? "" : path ? `${path}/${name}` : name;
    out.push({ key: r.key, id: r.id, name, type: r.type, parent, of: r.type === "instance" ? (r.src?.of ?? null) : null, depth, path: p });
    for (const c of r.children || []) visit(c, r.key, p, depth + 1);
  };
  if (root) visit(root, null, "", 0);
  return out;
}

/**
 * Which layers of screen `b` correspond to layers of screen `a` (smart animate). Both are flatten() lists. Matching,
 * in this order: the same key (the same layer shown again, e.g. after a variable or variant change); instances of the
 * same component that are the only one of it on both screens (source id); the same name path below the root (with
 * the n-th of equal paths matching the n-th); layers inside matched instances by their path of source ids. The roots
 * always correspond. Each layer of `a` matches at most once.
 * @param {{key:string,id:string,type:string,parent:string|null,of:string|null,depth:number,path:string}[]} a
 * @param {typeof a} b
 * @returns {Map<string, string>} key in b → key in a
 */
export function matchLayers(a, b) {
  const map = new Map();
  const used = new Set();
  const link = (kb, ka) => {
    if (map.has(kb) || used.has(ka)) return false;
    map.set(kb, ka);
    used.add(ka);
    return true;
  };
  if (!a.length || !b.length) return map;
  link(b[0].key, a[0].key);
  // 1. the same layer
  const aKeys = new Set(a.map((x) => x.key));
  for (const x of b) if (aKeys.has(x.key)) link(x.key, x.key);
  // 2. unique instances of the same component
  const byOf = (list) => {
    const m = new Map();
    for (const x of list) if (x.of) m.set(x.of, m.has(x.of) ? null : x);
    return m;
  };
  const ia = byOf(a);
  for (const [of, xb] of byOf(b)) {
    const xa = ia.get(of);
    if (xa && xb) link(xb.key, xa.key);
  }
  // 3. name paths (n-th with n-th)
  const groups = new Map();
  for (const x of a) {
    if (x.depth === 0 || used.has(x.key)) continue;
    if (!groups.has(x.path)) groups.set(x.path, []);
    groups.get(x.path).push(x);
  }
  for (const x of b) {
    if (x.depth === 0 || map.has(x.key)) continue;
    const g = groups.get(x.path);
    while (g?.length) {
      const xa = g.shift();
      if (link(x.key, xa.key)) break;
    }
  }
  // 4. layers inside matched instances: the same source path after the instance's key
  const aByKey = new Map(a.map((x) => [x.key, x]));
  for (const x of b) {
    if (x.type !== "instance" || !map.has(x.key)) continue;
    const ka = map.get(x.key);
    if (aByKey.get(ka)?.type !== "instance") continue;
    const pre = `${x.key}/`;
    for (const y of b) {
      if (!y.key.startsWith(pre) || map.has(y.key)) continue;
      const other = `${ka}/${y.key.slice(pre.length)}`;
      if (aByKey.has(other)) link(y.key, other);
    }
  }
  return map;
}

// ------------------------------------------------------------------------------------------------- operations

/** The interaction and flow operations for ops.js (`KIT`: { OpError, runOp }). */
export function interactionOps({ OpError, runOp }) {
  const listOf = (n) => (Array.isArray(n.proto) ? n.proto : []);
  const checkIt = (d, it) => {
    const p = interactionProblems(d.m, it);
    if (p.length) throw new OpError(/does not exist|not a top-level/.test(p[0]) ? "missing-target" : "invalid", `The interaction is not valid: ${p.slice(0, 3).join(" ")}`);
    return clone(it);
  };
  const setList = (d, n, list) => {
    const r = runOp(d, { op: "node.update", id: n.id, ...(list.length ? { set: { proto: list } } : { unset: ["proto"] }) });
    return { inverse: r.inverse, ids: [n.id] };
  };
  const index = (list, i, extra = 0) => {
    if (!Number.isInteger(i) || i < 0 || i >= list.length + extra) throw new OpError("bad-op", `There is no interaction ${i}.`);
    return i;
  };
  const flowsOf = (p) => (Array.isArray(p.flows) ? p.flows : []);
  const setFlows = (d, p, flows) => {
    const r = runOp(d, { op: "page.update", id: p.id, set: { flows } });
    return r.inverse;
  };
  const flowStart = (d, page, start) => {
    const n = d.need(start);
    if (n.parent != null) throw new OpError("flow-start", `A flow starts at a top-level frame; “${n.name || n.id}” is inside another layer.`);
    if (n.page !== page) throw new OpError("flow-page", "The flow's start frame is on another page.");
  };
  const flowName = (v) => {
    if (typeof v !== "string" || !v.trim()) throw new OpError("bad-op", "A flow needs a name.");
    return v.trim().slice(0, 256);
  };
  return {
    "interaction.add"(d, op) {
      const n = d.need(op.id);
      const list = listOf(n).slice();
      if (list.length >= 256) throw new OpError("limit", "A layer has at most 256 interactions.");
      const at = op.index === undefined ? list.length : index(list, op.index, 1);
      list.splice(at, 0, checkIt(d, op.interaction));
      return setList(d, n, list);
    },
    "interaction.set"(d, op) {
      const n = d.need(op.id);
      const list = listOf(n).slice();
      list[index(list, op.index)] = checkIt(d, op.interaction);
      return setList(d, n, list);
    },
    "interaction.delete"(d, op) {
      const n = d.need(op.id);
      const list = listOf(n).slice();
      list.splice(index(list, op.index), 1);
      return setList(d, n, list);
    },
    "interaction.connect"(d, op) {
      const n = d.need(op.from);
      const trigger = op.trigger ?? "click";
      const list = listOf(n).slice();
      const at = list.findIndex((it) => isObj(it) && it.on?.type === trigger && Array.isArray(it.do) && it.do.some((a) => isObj(a) && a.act === "navigate"));
      if (op.to == null) {
        if (at < 0) return { inverse: { op: "node.update", id: n.id, set: {}, unset: [] }, ids: [n.id] };
        const it = list[at];
        const rest = it.do.filter((a) => !(isObj(a) && a.act === "navigate"));
        if (rest.length) list[at] = { ...it, do: rest };
        else list.splice(at, 1);
        return setList(d, n, list);
      }
      if (topOf(d.m, n.id) === op.to) throw new OpError("self", "A layer cannot navigate to its own frame.");
      if (at >= 0) {
        const it = list[at];
        const k = it.do.findIndex((a) => isObj(a) && a.act === "navigate");
        const doList = it.do.slice();
        doList[k] = { ...doList[k], to: op.to, ...(op.tr !== undefined ? { tr: op.tr } : {}) };
        list[at] = checkIt(d, { ...it, do: doList });
      } else list.push(checkIt(d, { on: { type: trigger }, do: [{ act: "navigate", to: op.to, ...(op.tr !== undefined ? { tr: op.tr } : { tr: { type: "dissolve", dur: DEFAULT_DURATION, ease: "ease-out" } }) }] }));
      return setList(d, n, list);
    },
    "flow.create"(d, op) {
      const start = d.need(op.start);
      const page = d.needPage(op.page ?? start.page);
      flowStart(d, page.id, op.start);
      const flows = flowsOf(page);
      if (flows.length >= 256) throw new OpError("limit", "A page has at most 256 flows.");
      const taken = new Set(Object.values(d.m.pages).flatMap((p) => flowsOf(p).map((f) => f.id)));
      if (op.id != null && (!isId(op.id) || taken.has(op.id))) throw new OpError("id", `The flow id “${op.id}” is not free.`);
      const id = op.id ?? newId("f", taken, d.random);
      const flow = { id, name: flowName(op.name ?? `Flow ${flows.length + 1}`), start: op.start };
      if (typeof op.description === "string" && op.description.trim()) flow.description = op.description.trim().slice(0, 1000);
      return { inverse: setFlows(d, page, [...flows, flow]), ids: [id] };
    },
    "flow.update"(d, op) {
      const page = d.needPage(op.page);
      const flows = flowsOf(page);
      const i = flows.findIndex((f) => f?.id === op.id);
      if (i < 0) throw new OpError("missing", `There is no flow “${op.id}” on this page.`);
      const set = isObj(op.set) ? op.set : {};
      const next = { ...flows[i] };
      if (own(set, "name")) next.name = flowName(set.name);
      if (own(set, "start")) {
        flowStart(d, page.id, set.start);
        next.start = set.start;
      }
      if (own(set, "description")) {
        if (typeof set.description === "string" && set.description.trim()) next.description = set.description.trim().slice(0, 1000);
        else delete next.description;
      }
      const list = flows.slice();
      list[i] = next;
      return { inverse: setFlows(d, page, list), ids: [op.id] };
    },
    "flow.delete"(d, op) {
      const page = d.needPage(op.page);
      const flows = flowsOf(page);
      if (!flows.some((f) => f?.id === op.id)) throw new OpError("missing", `There is no flow “${op.id}” on this page.`);
      return { inverse: setFlows(d, page, flows.filter((f) => f?.id !== op.id)), ids: [op.id] };
    },
  };
}
