// Transitions of the Proto prototype player (docs/concepts/proto-studio.md §6.1, §6.2, task T9) with the Web
// Animations API: dissolve, move in, move out, push, slide and smart animate. Smart animate is FLIP: both screens are in
// the DOM, matching layers (engine/proto/interactions.js ▸ matchLayers) are measured in both, the new screen is shown
// and its matched layers animate from the old geometry and colors; layers only the old screen has fade out above it,
// layers only the new one has fade in. When the animations end, the new screen's own CSS is exactly what remains.
//
//   playScreen({ from, to, tr, reverse, size, scale }) → Promise   from/to: screens of player/render.js (hosts already in
//                                                                  the viewport; `to` on top); `from` is removed after
//   playOverlay(el, { tr, out, size }) → Promise                   an overlay box appearing or leaving
//   smartAnimate(from, to, { dur, easing, scale }) → Promise
import { transition, easingCss, matchLayers } from "../../engine/proto/interactions.js";

const REVERSE_DIR = { left: "right", right: "left", up: "down", down: "up" };
/** Where an entering screen comes from, as multiples of the viewport size, for a direction of travel. */
const FROM = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] };

const reduced = () => {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
};

const done = (anims) => Promise.all(anims.filter(Boolean).map((a) => a.finished.catch(() => {})));

function animate(el, frames, opts) {
  if (!el?.animate) return null;
  try {
    return el.animate(frames, opts);
  } catch {
    return null;
  }
}

/**
 * Plays a screen change. `reverse` (back) plays the inverse of the transition that led to `from`.
 * @param {{ from: object|null, to: object, tr: object|null, reverse?: boolean, size: {w:number,h:number}, scale?: number }} o
 */
export async function playScreen({ from, to, tr, reverse = false, size, scale = 1 }) {
  const t = transition(tr);
  if (!from || t.type === "instant" || t.dur <= 0 || reduced()) {
    from?.destroy();
    return;
  }
  const opts = { duration: t.dur, easing: easingCss(t.ease), fill: "both" };
  let type = t.type;
  let dir = t.dir;
  if (reverse) {
    if (type === "moveIn") type = "moveOut";
    else if (type === "moveOut") type = "moveIn";
    dir = REVERSE_DIR[dir];
  }
  const [fx, fy] = FROM[dir] || FROM.left;
  const off = (k) => `translate(${fx * size.w * k}px, ${fy * size.h * k}px)`;
  const zero = "translate(0px, 0px)";
  let anims = [];
  switch (type) {
    case "dissolve":
      anims = [animate(to.host, [{ opacity: 0 }, { opacity: 1 }], opts)];
      break;
    case "moveIn":
      anims = [animate(to.host, [{ transform: off(1) }, { transform: zero }], opts)];
      break;
    case "moveOut":
      from.host.style.zIndex = "2";
      anims = [animate(from.host, [{ transform: zero }, { transform: off(-1) }], opts)];
      break;
    case "push":
      anims = [animate(to.host, [{ transform: off(1) }, { transform: zero }], opts), animate(from.host, [{ transform: zero }, { transform: off(-1) }], opts)];
      break;
    case "slide":
      anims = [animate(to.host, [{ transform: off(1) }, { transform: zero }], opts), animate(from.host, [{ transform: zero }, { transform: off(-0.3) }], opts)];
      break;
    case "smart":
      await smartAnimate(from, to, { dur: t.dur, easing: easingCss(t.ease), scale });
      from.destroy();
      return;
  }
  await done(anims);
  for (const a of anims) a?.cancel();
  from.destroy();
}

/**
 * An overlay box appearing (or leaving with `out`).
 * @param {HTMLElement} el
 * @param {{ tr: object|null, out?: boolean, size: {w:number,h:number} }} o
 */
export async function playOverlay(el, { tr, out = false, size }) {
  const t = transition(tr);
  if (t.type === "instant" || t.dur <= 0 || reduced()) return;
  const opts = { duration: t.dur, easing: easingCss(t.ease), fill: "both" };
  let frames;
  if (t.type === "moveIn" || t.type === "moveOut" || t.type === "push" || t.type === "slide") {
    const [fx, fy] = FROM[t.dir] || FROM.left;
    const a = { transform: `translate(${fx * size.w}px, ${fy * size.h}px)` };
    const b = { transform: "translate(0px, 0px)" };
    frames = out ? [b, a] : [a, b];
  } else frames = out ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }];
  const anim = animate(el, frames, opts);
  await done([anim]);
  if (!out) anim?.cancel();
}

const px = (v) => `${Math.round(v * 100) / 100}px`;

/** Smart animate between two rendered screens (both in the viewport, `to` above `from`). */
export async function smartAnimate(from, to, { dur = 300, easing = "ease-out", scale = 1 } = {}) {
  const pairs = matchLayers(from.flat, to.flat); // key in to → key in from
  const k = scale || 1;
  const rectsOf = (screen) => {
    const base = screen.root?.getBoundingClientRect();
    const out = new Map();
    if (!base) return out;
    for (const [key, el] of screen.els) {
      const r = el.getBoundingClientRect();
      out.set(key, { x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k });
    }
    return out;
  };
  const ra = rectsOf(from);
  const rb = rectsOf(to);
  const view = from.root?.ownerDocument?.defaultView || globalThis;
  const styleA = new Map();
  for (const ka of pairs.values()) {
    const el = from.els.get(ka);
    if (!el) continue;
    const cs = view.getComputedStyle(el);
    styleA.set(ka, { opacity: cs.opacity, backgroundColor: cs.backgroundColor, borderRadius: cs.borderTopLeftRadius, color: cs.color });
  }
  // the old screen goes above the new one: only its unmatched layers stay visible, and they fade out
  const matchedA = new Set(pairs.values());
  for (const [key, el] of from.els) el.style.visibility = matchedA.has(key) ? "hidden" : "visible";
  from.host.style.zIndex = "3";
  const opts = { duration: dur, easing, fill: "both" };
  const anims = [animate(from.host, [{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "linear", fill: "both" })];
  const parentOf = new Map(to.flat.map((x) => [x.key, x.parent]));
  const delta = new Map();
  for (const x of to.flat) {
    const el = to.els.get(x.key);
    if (!el) continue;
    const ka = pairs.get(x.key);
    if (ka === undefined) {
      // a layer only the new screen has: fade in (only the outermost of such layers)
      const p = parentOf.get(x.key);
      if (p == null || pairs.has(p)) anims.push(animate(el, [{ opacity: 0 }, { opacity: getComputedStyleOpacity(view, el) }], opts));
      continue;
    }
    const a = ra.get(ka);
    const b = rb.get(x.key);
    const sa = styleA.get(ka);
    if (!a || !b || !sa) continue;
    if (x.depth === 0) {
      anims.push(animate(el, [{ backgroundColor: sa.backgroundColor }, { backgroundColor: view.getComputedStyle(el).backgroundColor }], opts));
      delta.set(x.key, { x: 0, y: 0 });
      continue;
    }
    // translate relative to the nearest ancestor that moves itself (its transform carries this layer along)
    let p = parentOf.get(x.key);
    while (p != null && !delta.has(p)) p = parentOf.get(p);
    const pd = p != null ? delta.get(p) : { x: 0, y: 0 };
    const d = { x: a.x - b.x, y: a.y - b.y };
    delta.set(x.key, d);
    const cs = view.getComputedStyle(el);
    const baseT = el.style.transform || "";
    const dx = d.x - pd.x;
    const dy = d.y - pd.y;
    const sized = Math.abs(a.w - b.w) > 0.5 || Math.abs(a.h - b.h) > 0.5;
    const f0 = { transform: `translate(${px(dx)}, ${px(dy)}) ${baseT}`.trim(), opacity: sa.opacity, backgroundColor: sa.backgroundColor, borderTopLeftRadius: sa.borderRadius, borderTopRightRadius: sa.borderRadius, borderBottomLeftRadius: sa.borderRadius, borderBottomRightRadius: sa.borderRadius, color: sa.color };
    const f1 = { transform: `translate(0px, 0px) ${baseT}`.trim(), opacity: cs.opacity, backgroundColor: cs.backgroundColor, borderTopLeftRadius: cs.borderTopLeftRadius, borderTopRightRadius: cs.borderTopRightRadius, borderBottomLeftRadius: cs.borderBottomLeftRadius, borderBottomRightRadius: cs.borderBottomRightRadius, color: cs.color };
    if (sized) {
      // sizes animate as real widths and heights, so text rewraps and auto layout children follow
      Object.assign(f0, { width: px(a.w), height: px(a.h), flex: "0 0 auto", minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none" });
      Object.assign(f1, { width: px(b.w), height: px(b.h), flex: "0 0 auto", minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none" });
    }
    anims.push(animate(el, [f0, f1], opts));
  }
  await done(anims);
  for (const a of anims) a?.cancel();
}

function getComputedStyleOpacity(view, el) {
  try {
    return view.getComputedStyle(el).opacity || "1";
  } catch {
    return "1";
  }
}
