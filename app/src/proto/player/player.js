// The Proto prototype player (docs/concepts/proto-studio.md §6.2, docs/proto-studio.md ▸ Prototypes, task T9): plays a
// design's interactions in the app (a full-window layer above the studio) or in a window of its own (a native window on
// the desktop, a browser window or tab otherwise, through ui/docking/windows.js: the player stays one object in the
// main window and only its element moves, so it keeps reading the live design).
//
//   openPlayer(ws, { flow?, start?, window? }) → player     ws: the workspace (proto/workspace.js)
//     player: { el, state, restart(), back(), setFlow(id), toggleDevice(), toggleHints(), popOut(), close() }
//
// What it does: renders the current frame and the open overlays (player/render.js), maps input to the layers'
// interactions (click, double click, press, hover, mouse enter and leave, drag, keys, after delay, variable change),
// runs them through the pure state machine (player/state.js) and plays the resulting effects with transitions and smart
// animate (player/animate.js). Toolbar: flow picker, back, restart, device frame, hotspot hints, open in window, close.
// Keys: R restart, ← → previous and next flow, Backspace back, Escape closes the in-app player (after the prototype's
// own key interactions had their turn). A click that hits no interaction flashes the hotspots.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { pageList } from "../../engine/proto/tree.js";
import { field } from "../../engine/proto/schema.js";
import { instanceKeyOf, POINTER_TRIGGERS } from "../../engine/proto/interactions.js";
import { initialState, dispatch, withVariants, canBack } from "./state.js";
import { renderScreen } from "./render.js";
import { playScreen, playOverlay } from "./animate.js";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const DRAG_PX = 6;
const PREF_DEVICE = "protoPlayerDevice";
const PREF_HINTS = "protoPlayerHints";

/** Every flow of the design: [{ id, name, start, page }]. */
export function allFlows(model) {
  const out = [];
  for (const p of pageList(model)) for (const f of Array.isArray(p.flows) ? p.flows : []) if (isObj(f) && model.nodes[f.start]) out.push({ ...f, page: p.id, pageName: p.name });
  return out;
}

/** The kind of device frame for a screen size: phone, tablet, watch or desktop. */
export function deviceOf(w, h) {
  const short = Math.min(w, h);
  if (short <= 220) return "watch";
  if (short <= 500) return "phone";
  if (short <= 1100 && Math.max(w, h) <= 1400) return "tablet";
  return "desktop";
}

function mediaUrls() {
  const urls = new WeakMap();
  const all = [];
  return {
    url(_id, media) {
      const bytes = media?.bytes;
      if (!bytes || typeof Blob === "undefined") return "";
      let u = urls.get(bytes);
      if (!u) {
        u = URL.createObjectURL(new Blob([bytes], { type: media.mime || "application/octet-stream" }));
        urls.set(bytes, u);
        all.push(u);
      }
      return u;
    },
    release: () => all.splice(0).forEach((u) => URL.revokeObjectURL(u)),
  };
}

const keyMatches = (on, e) => {
  if (typeof on.key !== "string") return false;
  const want = on.key.length === 1 ? on.key.toLowerCase() : on.key;
  const got = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (want !== got && !(want === " " && got === "Spacebar")) return false;
  const mods = new Set(Array.isArray(on.mods) ? on.mods : []);
  if (mods.has("alt") !== e.altKey || mods.has("ctrl") !== e.ctrlKey || mods.has("meta") !== e.metaKey) return false;
  if (mods.has("shift") && !e.shiftKey) return false;
  // Shift is part of a typed character ("?" or "A"); for named keys it must be asked for
  return mods.has("shift") || !e.shiftKey || e.key.length === 1;
};

let current = null;

/**
 * Opens the player (one at a time; opening again restarts it with the new flow).
 * @param {object} ws the Proto workspace
 * @param {{ flow?: string|null, start?: string|null, window?: boolean }} [o]
 */
export function openPlayer(ws, o = {}) {
  current?.close();
  const app = ws.app;
  const model = () => ws.model();
  const media = mediaUrls();
  const flows = () => allFlows(model());
  const flowById = (id) => flows().find((f) => f.id === id) || null;
  let flow = o.flow ? flowById(o.flow) : null;
  if (!flow && !o.start) {
    // the selection's frame, else the current page's first flow, else the page's first frame
    const sel = ws.selection?.[0];
    const top = sel ? topFrame(model(), sel) : null;
    if (top) o = { ...o, start: top };
    else flow = flows().find((f) => f.page === ws.page) || null;
  }
  let state = initialState(model(), { flow, start: o.start || null, page: ws.page });
  let device = app.prefs?.[PREF_DEVICE] !== false;
  let hints = app.prefs?.[PREF_HINTS] !== false;
  let base = null; // the screen of the current frame
  let overlays = []; // [{ screen, box, dim, spec }]
  let timers = [];
  let busy = Promise.resolve();
  let hoverChain = [];
  let press = null;
  let win = null;
  let closed = false;
  let scale = 1;

  // ------------------------------------------------------------------------------------------- DOM
  const flowSel = h("select.of-proto-player__flows", { "aria-label": t("Flow") });
  flowSel.addEventListener("change", () => setFlow(flowSel.value || null));
  const btn = (icon, label, fn, key) => {
    const b = h("button.of-ibtn", { type: "button", "aria-label": key ? `${label} (${key})` : label, "data-tip": key ? `${label} (${key})` : label }, h("sl-icon", { name: icon }));
    b.addEventListener("click", fn);
    return b;
  };
  const backBtn = btn("arrow-left", t("Back"), () => api.back(), "Backspace");
  const restartBtn = btn("arrow-counterclockwise", t("Restart"), () => api.restart(), "R");
  const deviceBtn = btn("phone", t("Device frame"), () => api.toggleDevice());
  const hintsBtn = btn("hand-index", t("Hotspot hints"), () => api.toggleHints());
  const windowBtn = btn("box-arrow-up-right", t("Open in window"), () => api.popOut());
  const closeBtn = btn("x-lg", t("Close preview"), () => api.close(), "Esc");
  const title = h("span.of-proto-player__title");
  const bar = h("div.of-proto-player__bar", { role: "toolbar", "aria-label": t("Preview") }, flowSel, backBtn, restartBtn, h("span.of-proto-player__sep"), title, h("span.of-proto-player__sep"), deviceBtn, hintsBtn, windowBtn, closeBtn);
  const viewport = h("div.of-proto-player__viewport", { tabIndex: 0, role: "application", "aria-roledescription": t("Prototype"), "aria-label": t("Prototype") });
  const hintLayer = h("div.of-proto-player__hints", { "aria-hidden": "true" });
  const device_ = h("div.of-proto-player__device", viewport, hintLayer);
  const fit = h("div.of-proto-player__fit", device_);
  const stage = h("div.of-proto-player__stage", fit);
  const live = h("div.of-proto-player__live", { "aria-live": "polite" });
  const el = h("div.of-proto-player", { role: "dialog", "aria-label": t("Prototype preview"), tabIndex: -1 }, bar, stage, live);
  document.body.append(el);

  const docOf = () => el.ownerDocument;
  const viewOf = () => docOf().defaultView || window;
  const size = () => ({ w: base?.w ?? (base?.root?.offsetWidth || 390), h: base?.h ?? (base?.root?.offsetHeight || 844) });

  function layout() {
    if (!base) return;
    const { w, h: hh } = size();
    viewport.style.width = `${w}px`;
    viewport.style.height = `${hh}px`;
    const kind = deviceOf(w, hh);
    device_.className = `of-proto-player__device${device ? ` is-${kind}` : ""}`;
    const pad = device ? (kind === "desktop" ? 40 : kind === "watch" ? 28 : 24) : 0;
    const top = device && kind === "desktop" ? 28 : 0;
    const r = stage.getBoundingClientRect();
    const availW = Math.max(50, r.width - 32);
    const availH = Math.max(50, r.height - 32);
    scale = Math.min(1, availW / (w + pad * 2), availH / (hh + pad * 2 + top));
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    device_.style.transform = `scale(${scale})`;
    fit.style.width = `${(w + pad * 2) * scale}px`;
    fit.style.height = `${(hh + pad * 2 + top) * scale}px`;
    device_.style.padding = device ? `${pad + top}px ${pad}px ${pad}px` : "0";
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => layout()) : null;
  ro?.observe(stage);

  function syncBar() {
    const fl = flows();
    flowSel.replaceChildren(h("option", { value: "", selected: !state.flow }, t("Current frame")), ...fl.map((f) => h("option", { value: f.id, selected: f.id === state.flow }, pageList(model()).length > 1 ? `${f.pageName} ▸ ${f.name}` : f.name)));
    backBtn.disabled = !canBack(state);
    deviceBtn.setAttribute("aria-pressed", String(device));
    hintsBtn.setAttribute("aria-pressed", String(hints));
    windowBtn.hidden = !!win;
    const n = model().nodes[state.frame];
    title.textContent = n?.name || "";
    live.textContent = n?.name || "";
    if (win) win.setTitle(`${t("Preview")}: ${n?.name || ""}`);
  }

  // ------------------------------------------------------------------------------------------- rendering
  const renderOf = (id) => renderScreen(docOf(), withVariants(model(), state.variants), id, { vars: state.vars, mediaUrl: media.url });

  function keepScroll(from, to) {
    if (!from || !to) return;
    for (const [k, a] of from.els) {
      if (!a.scrollTop && !a.scrollLeft) continue;
      const b = to.els.get(k);
      if (b) {
        b.scrollTop = a.scrollTop;
        b.scrollLeft = a.scrollLeft;
      }
    }
  }

  function overlayBox(screen, spec) {
    const { w: W, h: H } = size();
    const w = screen.w ?? screen.root?.offsetWidth ?? 0;
    const hh = screen.h ?? screen.root?.offsetHeight ?? 0;
    const pos = spec.pos || "center";
    const x = pos.includes("Left") || pos === "left" ? 0 : pos.includes("Right") || pos === "right" ? W - w : (W - w) / 2;
    const y = pos.startsWith("top") ? 0 : pos.startsWith("bottom") ? H - hh : (H - hh) / 2;
    const box = h("div.of-proto-player__overlay", { style: { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, width: `${w}px`, height: `${hh}px` } });
    box.append(screen.host);
    return box;
  }
  function addOverlay(spec) {
    const screen = renderOf(spec.id);
    const dim = h("div.of-proto-player__dim", { style: { background: spec.dim || "transparent" } });
    dim.addEventListener("click", (e) => {
      if (e.target === dim && spec.closeOutside) run({ type: "actions", actions: [{ act: "closeOverlay" }] });
    });
    viewport.append(dim);
    const box = overlayBox(screen, spec);
    viewport.append(box);
    const o = { screen, box, dim, spec };
    overlays.push(o);
    return o;
  }
  const removeOverlay = (o) => {
    o.box.remove();
    o.dim.remove();
    o.screen.destroy();
  };

  /** Shows the current state without a transition (first render, restart, flows). */
  function showAll() {
    for (const o of overlays) removeOverlay(o);
    overlays = [];
    base?.destroy();
    base = state.frame ? renderOf(state.frame) : null;
    viewport.replaceChildren();
    if (base) viewport.append(base.host);
    else viewport.append(h("p.of-proto-player__empty", t("There is no frame to play. Add a frame, or a flow in the Pages panel.")));
    for (const spec of state.overlays) addOverlay(spec);
    layout();
    afterShow();
  }

  function afterShow() {
    syncBar();
    schedule();
    hoverChain = [];
  }

  // ------------------------------------------------------------------------------------------- after delay
  function schedule() {
    for (const tm of timers) clearTimeout(tm);
    timers = [];
    const screens = [base, ...overlays.map((o) => o.screen)].filter(Boolean);
    const frame = state.frame;
    const depth = overlays.length;
    for (const sc of screens)
      for (const [key, list] of sc.inter)
        for (const it of list)
          if (it?.on?.type === "afterDelay" && Number.isFinite(it.on.ms)) {
            timers.push(
              setTimeout(() => {
                if (closed || state.frame !== frame || overlays.length !== depth) return;
                run({ type: "actions", actions: it.do, source: key, instance: instanceKeyOf(sc.nodes.get(key)) });
              }, Math.max(0, it.on.ms)),
            );
          }
  }

  // ------------------------------------------------------------------------------------------- state changes
  const listeners = (varId) => {
    const out = [];
    for (const sc of [base, ...overlays.map((o) => o.screen)].filter(Boolean))
      for (const [key, list] of sc.inter) for (const it of list) if (it?.on?.type === "variableChange" && it.on.var === varId) out.push({ actions: it.do, source: key, instance: instanceKeyOf(sc.nodes.get(key)) });
    return out;
  };

  function run(ev) {
    if (closed) return;
    busy = busy.then(() => step(ev)).catch((err) => app.toast?.(err?.message || String(err), "warning", 4000));
    return busy;
  }

  async function step(ev) {
    const res = dispatch(model(), state, ev, { listeners });
    state = res.state;
    for (const fx of res.effects) {
      if (closed) return;
      if (fx.kind === "screen") await showScreen(fx);
      else if (fx.kind === "overlay") await overlayFx(fx);
      else if (fx.kind === "update") await update(fx.tr);
      else if (fx.kind === "scroll") scrollTo(fx);
      else if (fx.kind === "url") openUrl(fx);
      else if (fx.kind === "error") app.toast?.(fx.message, "warning", 3000);
    }
    syncBar();
  }

  async function showScreen(fx) {
    for (const o of overlays) removeOverlay(o);
    overlays = [];
    const from = base;
    const to = state.frame ? renderOf(state.frame) : null;
    if (!to) return;
    base = to;
    viewport.append(to.host);
    to.host.style.zIndex = "1";
    layout();
    await playScreen({ from, to, tr: fx.tr, reverse: fx.reverse, size: size(), scale });
    to.host.style.zIndex = "";
    for (const spec of state.overlays) addOverlay(spec);
    afterShow();
  }

  async function overlayFx(fx) {
    if (fx.op === "open") {
      const spec = state.overlays[state.overlays.length - 1];
      if (!spec) return;
      const o = addOverlay(spec);
      await Promise.all([playOverlay(o.box, { tr: fx.tr, size: size() }), playOverlay(o.dim, { tr: fx.tr ? { ...fx.tr, type: "dissolve" } : null, size: size() })]);
    } else if (fx.op === "close") {
      const o = overlays.pop();
      if (!o) return;
      await Promise.all([playOverlay(o.box, { tr: fx.tr, out: true, size: size() }), playOverlay(o.dim, { tr: fx.tr ? { ...fx.tr, type: "dissolve" } : null, out: true, size: size() })]);
      removeOverlay(o);
    } else if (fx.op === "swap") {
      const old = overlays.pop();
      const spec = state.overlays[state.overlays.length - 1];
      if (old) removeOverlay(old);
      if (spec) await playOverlay(addOverlay(spec).box, { tr: fx.tr, size: size() });
    }
    schedule();
  }

  /** Variants or variables changed: render again; smart animate (or dissolve) between the two renders. */
  async function update(tr) {
    const from = base;
    const to = state.frame ? renderOf(state.frame) : null;
    if (!to) return;
    base = to;
    viewport.insertBefore(to.host, from?.host?.nextSibling || viewport.firstChild);
    keepScroll(from, to);
    await playScreen({ from, to, tr: tr || null, size: size(), scale });
    const old = overlays;
    overlays = [];
    for (const o of old) {
      const spec = o.spec;
      removeOverlay(o);
      const n = addOverlay(spec);
      keepScroll(o.screen, n.screen);
    }
    schedule();
  }

  function scrollTo(fx) {
    for (const sc of [...overlays.map((o) => o.screen).reverse(), base].filter(Boolean)) {
      const target = sc.els.get(fx.to);
      if (!target) continue;
      // scroll the nearest scrolling ancestor inside the screen only (never the player or the app)
      let p = target.parentElement;
      const view = viewOf();
      while (p && p !== sc.root.parentElement) {
        const cs = view.getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) {
          const pr = p.getBoundingClientRect();
          const tr = target.getBoundingClientRect();
          p.scrollTo({ top: p.scrollTop + (tr.top - pr.top) / scale, left: p.scrollLeft + (tr.left - pr.left) / scale, behavior: fx.smooth ? "smooth" : "auto" });
          return;
        }
        p = p.parentElement;
      }
      return;
    }
  }

  async function openUrl(fx) {
    try {
      const { openLink } = await import("../../ui/links.js");
      await openLink(fx.url, { app });
    } catch {
      /* refused or no platform */
    }
  }

  // ------------------------------------------------------------------------------------------- input
  const screens = () => [...overlays.map((o) => o.screen).reverse(), base].filter(Boolean);
  const screenOf = (e) => {
    const path = e.composedPath?.() || [];
    return screens().find((sc) => path.includes(sc.host)) || null;
  };
  /** The innermost layer under the event with an interaction of one of `types`, and its interactions of that type. */
  function hit(e, types) {
    const sc = screenOf(e);
    if (!sc) return null;
    for (const key of sc.chain(e)) {
      const list = (sc.inter.get(key) || []).filter((it) => types.includes(it?.on?.type));
      if (list.length) return { sc, key, list, instance: instanceKeyOf(sc.nodes.get(key)) };
    }
    return null;
  }
  const fire = (m, type) => {
    const its = m.list.filter((it) => it.on.type === type);
    if (its.length) run({ type: "actions", actions: its.flatMap((it) => it.do || []), source: m.key, instance: m.instance });
  };

  viewport.addEventListener("click", (e) => {
    if (press?.dragged) return;
    const m = hit(e, ["click"]);
    if (m) fire(m, "click");
    else if (!e.target.closest?.(".of-proto-player__dim") && !hit(e, POINTER_TRIGGERS.concat("hover", "mouseEnter"))) flashHints();
  });
  viewport.addEventListener("dblclick", (e) => {
    const m = hit(e, ["doubleClick"]);
    if (m) fire(m, "doubleClick");
  });
  viewport.addEventListener("pointerdown", (e) => {
    viewport.focus({ preventScroll: true });
    const m = hit(e, ["press", "drag"]);
    press = { x: e.clientX, y: e.clientY, m, dragged: false, held: null };
    if (m?.list.some((it) => it.on.type === "press")) {
      const actions = m.list.filter((it) => it.on.type === "press").flatMap((it) => it.do || []);
      press.held = m.key;
      run({ type: "hold", kind: "press", actions, source: m.key, instance: m.instance });
    }
  });
  const endPress = () => {
    if (press?.held) run({ type: "release", source: press.held, kind: "press" });
    // a click event follows pointerup: keep a drag from also counting as a click
    const p = press;
    setTimeout(() => press === p && (press = null), 0);
  };
  viewport.addEventListener("pointerup", endPress);
  viewport.addEventListener("pointercancel", endPress);
  viewport.addEventListener("pointermove", (e) => {
    if (press && !press.dragged && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) {
      press.dragged = true;
      if (press.m?.list.some((it) => it.on.type === "drag")) fire(press.m, "drag");
      else press.dragged = false;
    }
    hoverTo(e);
  });
  viewport.addEventListener("pointerover", hoverTo);
  viewport.addEventListener("pointerleave", () => hoverTo(null));

  /** Hover, mouse enter and mouse leave: the layers under the pointer changed. */
  function hoverTo(e) {
    const sc = e ? screenOf(e) : null;
    const chain = sc ? sc.chain(e).map((k) => ({ sc, key: k })) : [];
    const id = (x) => `${x.sc.id}|${x.key}`;
    const now = new Set(chain.map(id));
    const before = new Set(hoverChain.map(id));
    for (const x of hoverChain) {
      if (now.has(id(x))) continue;
      const list = x.sc.inter.get(x.key) || [];
      if (list.some((it) => it?.on?.type === "hover")) run({ type: "release", source: x.key, kind: "hover" });
      const leave = list.filter((it) => it?.on?.type === "mouseLeave");
      if (leave.length) run({ type: "actions", actions: leave.flatMap((it) => it.do || []), source: x.key, instance: instanceKeyOf(x.sc.nodes.get(x.key)) });
    }
    for (const x of chain.slice().reverse()) {
      if (before.has(id(x))) continue;
      const list = x.sc.inter.get(x.key) || [];
      const inst = instanceKeyOf(x.sc.nodes.get(x.key));
      const enter = list.filter((it) => it?.on?.type === "mouseEnter");
      if (enter.length) run({ type: "actions", actions: enter.flatMap((it) => it.do || []), source: x.key, instance: inst });
      const hov = list.filter((it) => it?.on?.type === "hover");
      if (hov.length) run({ type: "hold", kind: "hover", actions: hov.flatMap((it) => it.do || []), source: x.key, instance: inst });
    }
    hoverChain = chain;
    const pointer = chain.some((x) => (x.sc.inter.get(x.key) || []).some((it) => POINTER_TRIGGERS.includes(it?.on?.type)));
    viewport.style.cursor = pointer ? "pointer" : "";
  }

  function onKey(e) {
    if (closed) return;
    const tgt = e.target;
    if (tgt?.closest?.(".of-proto-player__bar") && (e.key === "Enter" || e.key === " ")) return;
    for (const sc of screens())
      for (const [key, list] of sc.inter)
        for (const it of list)
          if (it?.on?.type === "key" && keyMatches(it.on, e)) {
            e.preventDefault();
            e.stopPropagation();
            run({ type: "actions", actions: it.do, source: key, instance: instanceKeyOf(sc.nodes.get(key)) });
            return;
          }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    if (k === "r") api.restart();
    else if (k === "Backspace") api.back();
    else if (k === "ArrowRight" || k === "ArrowLeft") stepFlow(k === "ArrowRight" ? 1 : -1);
    else if (k === "Escape" && !win) api.close();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  let keyDoc = document;
  keyDoc.addEventListener("keydown", onKey, true);

  function stepFlow(dir) {
    const fl = flows();
    if (!fl.length) return;
    const i = fl.findIndex((f) => f.id === state.flow);
    const next = fl[(i + dir + fl.length + (i < 0 && dir < 0 ? 1 : 0)) % fl.length];
    setFlow(next.id);
  }
  function setFlow(id) {
    const f = id ? flowById(id) : null;
    busy = busy.then(() => {
      state = f ? dispatch(model(), state, { type: "flow", flow: f }).state : { ...initialState(model(), { start: state.frame }), flow: null };
      showAll();
    });
  }

  /** Flashes the layers that react to the pointer (after a click that hit none). */
  function flashHints() {
    if (!hints) return;
    hintLayer.replaceChildren();
    Object.assign(hintLayer.style, { left: `${viewport.offsetLeft}px`, top: `${viewport.offsetTop}px`, width: `${viewport.offsetWidth}px`, height: `${viewport.offsetHeight}px` });
    const vr = viewport.getBoundingClientRect();
    for (const sc of screens())
      for (const [key, list] of sc.inter) {
        if (!list.some((it) => POINTER_TRIGGERS.includes(it?.on?.type) || it?.on?.type === "hover")) continue;
        const el = sc.els.get(key);
        const r = el?.getBoundingClientRect();
        if (!r || !r.width || !r.height) continue;
        hintLayer.append(h("div.of-proto-player__hint", { style: { left: `${(r.left - vr.left) / scale}px`, top: `${(r.top - vr.top) / scale}px`, width: `${r.width / scale}px`, height: `${r.height / scale}px` } }));
      }
    hintLayer.classList.remove("is-on");
    void hintLayer.offsetWidth;
    hintLayer.classList.add("is-on");
  }

  // ------------------------------------------------------------------------------------------- API
  const offChange = ws.on?.("change", () => syncBar());
  const api = {
    el,
    get state() {
      return state;
    },
    restart: () => run({ type: "restart" }),
    back: () => run({ type: "back" }),
    setFlow,
    run,
    toggleDevice() {
      device = !device;
      app.setPref?.(PREF_DEVICE, device);
      layout();
      syncBar();
    },
    toggleHints() {
      hints = !hints;
      app.setPref?.(PREF_HINTS, hints);
      syncBar();
      if (hints) flashHints();
    },
    /** Moves the player into a window of its own (desktop window, browser popup); falls back to staying in the app. */
    async popOut() {
      if (win) return win.focus();
      const W = await import("../../ui/docking/windows.js");
      const { w, h: hh } = size();
      const rect = { x: Math.round(window.screenX + 80), y: Math.round(window.screenY + 60), w: Math.round(Math.min(window.screen.availWidth || 1600, Math.max(420, w * Math.min(1, scale) + 120))), h: Math.round(Math.min(window.screen.availHeight || 1000, Math.max(480, hh * Math.min(1, scale) + 160))) };
      const handle = W.openPanelWindow({ name: "openfini-proto-player", rect, title: t("Preview"), onClose: () => api.close(), onRect: () => {} });
      if (!handle) {
        app.toast?.(t("The preview window could not be opened. Allow pop-ups for OpenFini and try again."), "warning", 5000);
        return;
      }
      win = handle;
      keyDoc.removeEventListener("keydown", onKey, true);
      el.classList.add("is-window");
      handle.body.append(el);
      keyDoc = handle.doc;
      keyDoc.addEventListener("keydown", onKey, true);
      ro?.disconnect();
      ro?.observe(stage);
      handle.win.addEventListener("resize", () => layout());
      showAll();
      viewport.focus({ preventScroll: true });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const tm of timers) clearTimeout(tm);
      keyDoc.removeEventListener("keydown", onKey, true);
      ro?.disconnect();
      offChange?.();
      el.remove();
      win?.close();
      media.release();
      if (current === api) current = null;
      ws.view?.stage?.focus?.({ preventScroll: true });
    },
  };
  current = api;
  showAll();
  requestAnimationFrame(() => {
    layout();
    viewport.focus({ preventScroll: true });
  });
  if (o.window) api.popOut();
  return api;
}

/** The top-level frame that contains a layer. */
function topFrame(model, id) {
  let n = model.nodes[id];
  let guard = 0;
  while (n && n.parent != null && guard++ < 256) n = model.nodes[n.parent];
  return n && field(n, "visible") !== false ? n.id : null;
}

/** The open player, if any. */
export const currentPlayer = () => current;
