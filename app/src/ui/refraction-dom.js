// Liquid glass refraction: the DOM side. Lazy-loaded by ui/glass-dom.js only while the Liquid surface style is active.
//
// For every floating surface (dialogs, menus, context menus, command palette, popovers, coach marks, toasts) it creates one
// SVG filter (feImage displacement map -> feDisplacementMap, three of them for chromatic dispersion) and sets
// `--of-rf: url(#id) blur() saturate()` on the surface; glass.css uses it as the surface's backdrop-filter. Maps come from
// ui/refraction.js, are drawn once per size class and cached; a ResizeObserver (debounced) only updates the filter size.
//
// Public API
//   urlBackdropOk()                 one-time probe: does this engine render backdrop-filter: url(#filter)?
//   syncRefraction(cfg)             cfg = { on, strength, bevel, dispersion, blur, sat }; starts, updates or stops
//
// Invariants
//   * One refracting layer per surface level: nested surfaces keep their plain fill (see the "no nesting" rules in
//     glass.css); anything inside a dialog/palette/coach/popover/drawer is never targeted.
//   * Chromium only. Elsewhere `urlBackdropOk()` is false and nothing is created (plain blur + specular edge remain).
import { buildDisplacement, mapKey, sizeClass, channelScales, urlBackdropSupported } from "./refraction.js";

const NS = "http://www.w3.org/2000/svg";
const MAX_MAP = 256; // longest side of a map bitmap in px (it is stretched by <feImage>)

let probed = null;
let svg = null;
let cfg = null;
let seq = 0;
let ro = null;
let mo = null;
let sweepTimer = 0;
const items = new Map(); // host element -> { id, filter, measure, w, h, timer }
const retried = new WeakMap(); // host -> attempts while its measured part did not exist yet (see track())
const maps = new Map(); // mapKey -> data URL

export function urlBackdropOk() {
  if (probed !== null) return probed;
  try {
    const css = typeof CSS !== "undefined" && !!CSS.supports && CSS.supports("backdrop-filter", "url(#of-rf-probe) blur(1px)");
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:-9999px;top:0;width:8px;height:8px;backdrop-filter:url(#of-rf-probe) blur(1px)";
    document.body.append(el);
    const computed = /url\(/.test(getComputedStyle(el).backdropFilter || "");
    el.remove();
    const chromium = typeof navigator !== "undefined" && (navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand)) || (/\bChrome\//.test(navigator.userAgent || "") && !/\b(Firefox|Version)\//.test(navigator.userAgent || "")));
    probed = urlBackdropSupported({ css, computed, chromium: !!chromium });
  } catch {
    probed = false;
  }
  return probed;
}

// ------------------------------------------------------------------ targets

const NESTED = "sl-dialog, sl-drawer, .of-palette__box, .of-coach, .of-popover, .of-ctxmenu";
const px = (v) => Number.parseFloat(v) || 0;

/** The surfaces that refract. `measure(el)` returns the box whose size the glass has; `radius` a fallback corner radius. */
const TARGETS = [
  { sel: "sl-dialog", measure: (el) => el.shadowRoot?.querySelector('[part~="panel"]'), radius: 14 },
  { sel: ".of-ctxmenu", measure: (el) => el, radius: 6 },
  { sel: "sl-dropdown", measure: (el) => el.querySelector(":scope > sl-menu"), radius: 6, top: true },
  { sel: ".of-palette__box", measure: (el) => el, radius: 14 },
  { sel: ".of-popover", measure: (el) => el, radius: 12, top: true },
  { sel: ".of-coach", measure: (el) => el, radius: 12 },
  { sel: "sl-alert", measure: (el) => el.shadowRoot?.querySelector('[part~="base"]'), radius: 12 },
];
const SELECTOR = TARGETS.map((t) => t.sel).join(",");

function targetOf(el) {
  const t = TARGETS.find((x) => el.matches(x.sel));
  if (!t) return null;
  if (t.top && el.parentElement?.closest(NESTED)) return null;
  return t;
}

// ------------------------------------------------------------------ filters

function ensureSvg() {
  if (svg?.isConnected) return svg;
  svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  svg.append(document.createElementNS(NS, "defs"));
  document.body.append(svg);
  return svg;
}

const el = (name, attrs) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/** Data URL of the displacement map of a size class (cached). Drawn at reduced resolution; the filter stretches it. */
function mapUrl(w, h, radius, bevel) {
  const key = mapKey(w, h, radius, bevel);
  let url = maps.get(key);
  if (url) return url;
  const cw = sizeClass(w);
  const ch = sizeClass(h);
  const k = Math.min(1, MAX_MAP / Math.max(cw, ch));
  const m = buildDisplacement(cw * k, ch * k, radius * k, bevel * k);
  const c = document.createElement("canvas");
  c.width = m.width;
  c.height = m.height;
  c.getContext("2d").putImageData(new ImageData(m.data, m.width, m.height), 0, 0);
  url = c.toDataURL("image/png");
  if (maps.size > 60) maps.clear();
  maps.set(key, url);
  return url;
}

function buildFilter(id) {
  const f = el("filter", { id, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" });
  svg.firstChild.append(f);
  return f;
}

/** (Re)writes the filter children for the current size and settings. */
function fillFilter(f, w, h, radius) {
  const [sr, sg, sb] = channelScales(cfg.strength, cfg.dispersion);
  f.setAttribute("x", "0");
  f.setAttribute("y", "0");
  f.setAttribute("width", String(w));
  f.setAttribute("height", String(h));
  const kids = [el("feImage", { href: mapUrl(w, h, radius, cfg.bevel), x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map" })];
  const disp = (inn, scale, result) => el("feDisplacementMap", { in: inn, in2: "map", scale: scale.toFixed(2), xChannelSelector: "R", yChannelSelector: "G", result });
  if (cfg.dispersion <= 0) kids.push(disp("SourceGraphic", sg, "out"));
  else {
    const only = (v, result) => el("feColorMatrix", { in: "SourceGraphic", type: "matrix", values: v, result });
    kids.push(
      only("1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1", "r0"),
      only("0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1", "g0"),
      only("0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1", "b0"),
      disp("r0", sr, "r1"),
      disp("g0", sg, "g1"),
      disp("b0", sb, "b1"),
      // channels add up (feBlend "screen" mixes premultiplied alpha and shifts colors; arithmetic add does not)
      el("feComposite", { in: "r1", in2: "g1", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "rg" }),
      el("feComposite", { in: "rg", in2: "b1", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "out" }),
    );
  }
  f.replaceChildren(...kids);
}

function applyItem(host, it) {
  const box = it.measure(host);
  const r = box?.getBoundingClientRect?.();
  const zoom = Number(getComputedStyle(document.getElementById("app") || document.body).zoom) || 1;
  const w = r ? Math.round(r.width / zoom) : 0;
  const h = r ? Math.round(r.height / zoom) : 0;
  if (w < 24 || h < 24) {
    host.style.removeProperty("--of-rf");
    it.w = 0;
    return;
  }
  if (w === it.w && h === it.h && !it.dirty) return;
  it.w = w;
  it.h = h;
  it.dirty = false;
  const cr = px(getComputedStyle(box).borderTopLeftRadius);
  const radius = Math.min(cr > 0 ? cr : it.radius, w / 2, h / 2);
  fillFilter(it.filter, w, h, radius);
  host.style.setProperty("--of-rf", `url(#${it.id}) blur(${cfg.blur}px) saturate(${cfg.sat})`);
}

function track(host) {
  if (items.has(host)) return;
  const t = targetOf(host);
  if (!t) return;
  const box = t.measure(host);
  if (!box) {
    // Shoelace renders its parts asynchronously: poll a bounded number of times (never loop forever)
    const n = (retried.get(host) || 0) + 1;
    retried.set(host, n);
    if (n <= 20) setTimeout(() => cfg?.on && host.isConnected && !items.has(host) && track(host), 50);
    return;
  }
  const it = { id: `of-rf-${++seq}`, filter: null, measure: t.measure, radius: t.radius, w: 0, h: 0, timer: 0, dirty: true, box };
  it.filter = buildFilter(it.id);
  items.set(host, it);
  ro.observe(box);
  applyItem(host, it);
}

function untrack(host) {
  const it = items.get(host);
  if (!it) return;
  ro?.unobserve(it.box);
  clearTimeout(it.timer);
  it.filter.remove();
  host.style.removeProperty("--of-rf");
  items.delete(host);
}

function onResize(entries) {
  for (const e of entries) {
    for (const [host, it] of items) {
      if (it.box !== e.target) continue;
      clearTimeout(it.timer);
      it.timer = setTimeout(() => applyItem(host, it), it.w ? 120 : 0); // first measurement immediately, then debounced
    }
  }
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.(SELECTOR)) track(root);
  root.querySelectorAll?.(SELECTOR).forEach(track);
}

function sweep() {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    for (const host of [...items.keys()]) if (!host.isConnected) untrack(host);
  }, 400);
}

/** Starts, updates or stops refraction. cfg = { on, strength, bevel, dispersion, blur, sat }. */
export function syncRefraction(next) {
  const root = document.documentElement;
  if (!next?.on || !urlBackdropOk()) return stop();
  const changed = !cfg || ["strength", "bevel", "dispersion", "blur", "sat"].some((k) => cfg[k] !== next[k]);
  cfg = next;
  root.dataset.glassRf = "on";
  ensureSvg();
  if (!ro) {
    ro = new ResizeObserver(onResize);
    mo = new MutationObserver((list) => {
      for (const m of list) m.addedNodes.forEach(scan);
      sweep();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  } else if (changed) {
    for (const [host, it] of items) {
      it.dirty = true;
      applyItem(host, it);
    }
  }
}

export function stop() {
  document.documentElement.removeAttribute("data-glass-rf");
  cfg = null;
  for (const host of [...items.keys()]) untrack(host);
  mo?.disconnect();
  ro?.disconnect();
  mo = ro = null;
  svg?.remove();
  svg = null;
}
