// Interactive histogram widgets of the Adjust panel: Levels (draggable points on a histogram), Curves (histogram
// backdrop, point editing, presets, eyedroppers) and a before / after histogram strip for all other adjustments.
import { h } from "../../core/util.js";
import { numField, segmented, selectField } from "../controls.js";
import { buildCurveFloat } from "../../engine/pixel/adjustments.js";
import { autoLevels } from "../../engine/pixel/histogram.js";
import { analyzeImage, autoCorrectSuggestion, channelHistogram, displayCurve } from "../../engine/pixel/histogram-analysis.js";
import {
  levelsSets, levelsParams, editLevels, eyedropperLevels, gammaToMidPos, midPosToGamma, mapHistogram, levelsLUT,
  addCurvePoint, moveCurvePoint, removeCurvePoint, CURVE_PRESETS, curveIdentity, isIdentityCurve,
} from "../../engine/pixel/tone-tools.js";
import { itemsUpTo, samePartsList, renderItems } from "./source.js";
import { drawHistogram, seriesFor, fitCanvas, onResize } from "./draw.js";
import { AdjustPickerTool } from "./picker-tool.js";

const PROXY_PIXELS = 160_000;
const CH_KEYS = { rgb: "master", red: "red", green: "green", blue: "blue" };
const TAB_CH = { rgb: "rgb", red: "r", green: "g", blue: "b" };
const TABS = [{ value: "rgb", text: "RGB", label: "RGB (all channels)" }, { value: "red", text: "R", label: "Red" }, { value: "green", text: "G", label: "Green" }, { value: "blue", text: "B", label: "Blue" }];

/** The picture that enters an adjustment layer (everything below it) at a small size, with its histogram; cached while the layers below are unchanged. */
function createInput(app, node) {
  let parts = null, cached = null;
  return {
    get() {
      if (!node._parent || !app.page) return null;
      const u = itemsUpTo(app, node, false);
      if (cached && samePartsList(u.parts, parts) && cached.bg === u.page.bg) return cached;
      const s = Math.min(1, Math.sqrt(PROXY_PIXELS / (u.page.w * u.page.h)));
      const img = renderItems(u.page, u.items, { scale: s, bg: u.page.bg });
      parts = u.parts;
      cached = { img, scale: s, a: analyzeImage(img, { lab: false }), bg: u.page.bg };
      return cached;
    },
    /** RGB of the input picture at a page position (average of a square). */
    sample(e) {
      const page = node._page || app.page;
      const size = parseInt(app.prefs.infoSample || "1", 10);
      const u = itemsUpTo(app, node, false);
      const x = Math.floor(e.x), y = Math.floor(e.y);
      if (x < 0 || y < 0 || x >= page.w || y >= page.h) return null;
      const half = Math.floor(size / 2);
      const img = renderItems(page, u.items, { scale: 1, bg: page.bg, crop: { x: x - half, y: y - half, w: size, h: size }, width: size, height: size });
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
      return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
    },
  };
}

const pct = (v) => `${v < 0.05 ? "0" : v.toFixed(1)}%`;

function dropper(app, input, kind, label, onPick) {
  const b = h("button.of-lv__drop", { type: "button", title: label, "aria-label": label }, h("span.of-lv__dropsw", { class: kind }), h("sl-icon", { name: "eyedropper" }));
  b.addEventListener("click", () => {
    b.classList.add("active");
    AdjustPickerTool.begin(app, { label, sample: (e) => input.sample(e), onPick, onEnd: () => b.classList.remove("active") });
  });
  return b;
}

// ------------------------------------------------------------------ levels

function createLevels(app, node, { params, set }) {
  const input = createInput(app, node);
  let sets = levelsSets(params);
  let tab = "rgb";
  const canvas = h("canvas.of-lv__canvas", { role: "img", "aria-label": "Input histogram with black, midtone and white points" });
  const strip = h("div.of-lv__strip");
  const outBar = h("div.of-lv__out");
  const clipInfo = h("div.of-hint.of-lv__clip", { "aria-live": "off" });
  const tabs = segmented(TABS, tab, (v) => {
    tab = v;
    refresh();
  }, { cls: "of-lv__tabs" });

  const commit = (next, final) => {
    sets = next;
    set(levelsParams(sets), final);
    refresh();
  };
  const cur = () => sets[tab];
  const edit = (patch, final = true) => commit({ ...sets, [tab]: editLevels(cur(), patch) }, final);

  const mkHandle = (cls, label, get, put, min, max) => {
    const el = h("button.of-lv__h", { type: "button", class: cls, role: "slider", "aria-label": label, "aria-valuemin": min, "aria-valuemax": max });
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.focus();
      el.setPointerCapture(e.pointerId);
      const host = el.parentElement.getBoundingClientRect();
      const mv = (ev) => put(Math.max(0, Math.min(1, (ev.clientX - host.left) / host.width)), false);
      const up = () => {
        el.removeEventListener("pointermove", mv);
        el.removeEventListener("pointerup", up);
        put(null, true);
      };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
    });
    el.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      put(get() + (d * (e.shiftKey ? 10 : 1)) / 255, true, true);
    });
    el.update = (v, text) => {
      el.style.left = `${v * 100}%`;
      el.setAttribute("aria-valuenow", String(text));
    };
    return el;
  };
  const finish = () => commit(sets, true);
  const abs = (x) => Math.round(x * 255);
  const hb = mkHandle("black", "Input black point", () => cur().inBlack / 255, (x, final) => (x == null ? finish() : edit({ inBlack: abs(x) }, final)), 0, 254);
  const hw = mkHandle("white", "Input white point", () => cur().inWhite / 255, (x, final) => (x == null ? finish() : edit({ inWhite: abs(x) }, final)), 1, 255);
  const hg = mkHandle("gray", "Midtone gamma", () => (cur().inBlack + (cur().inWhite - cur().inBlack) * gammaToMidPos(cur().gamma)) / 255, (x, final) => {
    if (x == null) return finish();
    const c = cur();
    edit({ gamma: midPosToGamma((x * 255 - c.inBlack) / (c.inWhite - c.inBlack)) }, final);
  }, 0, 255);
  strip.append(hb, hg, hw);
  const ob = mkHandle("black", "Output black", () => cur().outBlack / 255, (x, final) => (x == null ? finish() : edit({ outBlack: abs(x) }, final)), 0, 255);
  const ow = mkHandle("white", "Output white", () => cur().outWhite / 255, (x, final) => (x == null ? finish() : edit({ outWhite: abs(x) }, final)), 0, 255);
  outBar.append(ob, ow);

  const f = {
    inBlack: numField({ label: "In", title: "Input black point", value: 0, min: 0, max: 254, precision: 0, onChange: (v) => edit({ inBlack: v }) }),
    gamma: numField({ label: "γ", title: "Midtone gamma", value: 1, min: 0.1, max: 5, step: 0.01, precision: 2, onChange: (v) => edit({ gamma: v }) }),
    inWhite: numField({ label: "In", title: "Input white point", value: 255, min: 1, max: 255, precision: 0, onChange: (v) => edit({ inWhite: v }) }),
    outBlack: numField({ label: "Out", title: "Output black", value: 0, min: 0, max: 255, precision: 0, onChange: (v) => edit({ outBlack: v }) }),
    outWhite: numField({ label: "Out", title: "Output white", value: 255, min: 0, max: 255, precision: 0, onChange: (v) => edit({ outWhite: v }) }),
  };
  const pick = (kind) => (rgb) => commit(eyedropperLevels(sets, tab, kind, rgb), true);
  const auto = h("button.of-btn", { type: "button", title: "Set black and white points (and midtones) from the histogram" }, "Auto");
  auto.addEventListener("click", () => {
    const g = input.get();
    if (!g) return;
    if (tab === "rgb") {
      const s = autoCorrectSuggestion(g.a, { clip: 0.1 }).levels;
      commit({ ...sets, rgb: editLevels(sets.rgb, { inBlack: s.inBlack, inWhite: s.inWhite, gamma: s.gamma }) }, true);
    } else {
      const c = autoLevels(g.a, { clip: 0.1 }).channels[tab];
      commit({ ...sets, [tab]: editLevels(sets[tab], c) }, true);
    }
  });
  const resetTab = h("button.of-btn", { type: "button", title: "Reset this channel" }, "Reset channel");
  resetTab.addEventListener("click", () => commit({ ...sets, [tab]: levelsSets({})[tab] }, true));

  function refresh() {
    tabs.set(tab);
    const c = cur();
    hb.update(c.inBlack / 255, c.inBlack);
    hw.update(c.inWhite / 255, c.inWhite);
    const mid = (c.inBlack + (c.inWhite - c.inBlack) * gammaToMidPos(c.gamma)) / 255;
    hg.update(mid, c.gamma.toFixed(2));
    ob.update(c.outBlack / 255, c.outBlack);
    ow.update(c.outWhite / 255, c.outWhite);
    outBar.style.setProperty("--a", `${(c.outBlack / 255) * 100}%`);
    outBar.style.setProperty("--b", `${(c.outWhite / 255) * 100}%`);
    for (const k of Object.keys(f)) f[k].set(c[k]);
    paint();
  }
  function paint() {
    const g = input.get();
    const size = fitCanvas(canvas, 84);
    if (!g) return drawHistogram(canvas, { series: [], size });
    const ch = TAB_CH[tab];
    const lut = levelsLUT(cur());
    const inH = channelHistogram(g.a, ch === "rgb" ? "rgb" : ch);
    const out = displayCurve(mapHistogram(inH, lut)).values;
    drawHistogram(canvas, { series: seriesFor(g.a, ch), lines: [{ values: out }], size });
    const total = inH.reduce((s, v) => s + v, 0) || 1;
    let lo = 0, hi = 0;
    for (let i = 0; i < 256; i++) {
      if (i <= cur().inBlack) lo += inH[i];
      if (i >= cur().inWhite) hi += inH[i];
    }
    clipInfo.textContent = `Clips ${pct((lo / total) * 100)} shadows, ${pct((hi / total) * 100)} highlights. Line = result.`;
  }

  const el = h("div.of-lv",
    tabs.el, canvas, strip,
    h("div.of-row.of-lv__nums", f.inBlack.el, f.gamma.el, f.inWhite.el),
    h("div.of-lv__lbl", "Output levels"), outBar,
    h("div.of-row.of-lv__nums", f.outBlack.el, h("span.grow"), f.outWhite.el),
    h("div.of-row.of-lv__tools", dropper(app, input, "black", "Set black point: click a shadow in the image", pick("black")), dropper(app, input, "gray", "Set gray point: click something that should be neutral", pick("gray")), dropper(app, input, "white", "Set white point: click a highlight in the image", pick("white")), h("span.grow"), auto, resetTab),
    clipInfo);
  onResize(canvas, () => el.isConnected && paint());
  requestAnimationFrame(refresh);
  return {
    el,
    update(p) {
      sets = levelsSets(p);
      refresh();
    },
    refreshInput: paint,
  };
}

// ------------------------------------------------------------------ curves

function createCurves(app, node, { params, set }) {
  const input = createInput(app, node);
  let tab = "rgb";
  let cur = { ...params };
  let sel = -1;
  let drag = -1;
  const SIZE = 232;
  const cv = h("canvas.of-cv__canvas", { tabindex: 0, role: "application", "aria-label": "Curve editor. Click to add a point, drag to move, Delete removes the selected point, arrow keys nudge it, [ and ] select the previous or next point." });
  const readout = h("div.of-hint.of-cv__readout", { "aria-live": "off" }, " ");
  const tabs = segmented(TABS, tab, (v) => {
    tab = v;
    sel = -1;
    refresh();
  }, { cls: "of-lv__tabs" });
  const pts = () => cur[CH_KEYS[tab]] || curveIdentity();
  const commit = (points, final) => {
    cur = { ...cur, [CH_KEYS[tab]]: points };
    set({ [CH_KEYS[tab]]: points }, final);
    refresh();
  };
  const fIn = numField({ label: "In", title: "Input of the selected point (0-255)", min: 0, max: 255, precision: 0, onChange: (v) => selected() && commit(moveCurvePoint(pts(), sel, v / 255, pts()[sel][1]), true) });
  const fOut = numField({ label: "Out", title: "Output of the selected point (0-255)", min: 0, max: 255, precision: 0, onChange: (v) => selected() && commit(moveCurvePoint(pts(), sel, pts()[sel][0], v / 255), true) });
  const selected = () => sel >= 0 && sel < pts().length;
  const presets = selectField({ label: "Preset", value: "", options: [{ value: "", label: "Preset…" }, ...CURVE_PRESETS.map((p) => ({ value: p.id, label: p.label }))], onChange: (v) => {
    const p = CURVE_PRESETS.find((x) => x.id === v);
    if (p) commit(p.points.map((q) => [...q]), true);
    presets.set("");
  } });
  presets.select.setAttribute("aria-label", "Curve preset");
  const del = h("button.of-btn", { type: "button", title: "Delete the selected point" }, "Delete point");
  del.addEventListener("click", () => selected() && pts().length > 2 && (commit(removeCurvePoint(pts(), sel), true), (sel = -1), refresh()));
  const reset = h("button.of-btn", { type: "button", title: "Reset this channel's curve" }, "Reset channel");
  reset.addEventListener("click", () => {
    sel = -1;
    commit(curveIdentity(), true);
  });
  const sampleBtn = h("button.of-lv__drop", { type: "button", title: "Add a point from the image: click a tone in the picture", "aria-label": "Add a point from the image" }, h("sl-icon", { name: "eyedropper" }));
  sampleBtn.addEventListener("click", () => {
    sampleBtn.classList.add("active");
    AdjustPickerTool.begin(app, {
      label: "Add curve point",
      sample: (e) => input.sample(e),
      onPick: (rgb) => {
        const v = tab === "rgb" ? (77 * rgb[0] + 150 * rgb[1] + 29 * rgb[2] + 128) >> 8 : rgb[TABS.findIndex((t) => t.value === tab) - 1];
        const x = v / 255;
        const y = buildCurveFloat(pts(), 256)[v];
        const r = addCurvePoint(pts(), x, y);
        sel = r.index;
        commit(r.points, true);
      },
      onEnd: () => sampleBtn.classList.remove("active"),
    });
  });

  const toXY = (e) => {
    const r = cv.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))];
  };
  const hit = (x, y) => {
    const r = cv.getBoundingClientRect();
    let best = -1, bd = 9 / r.width;
    pts().forEach((p, i) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  cv.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    cv.focus();
    const [x, y] = toXY(e);
    let i = hit(x, y);
    if (i < 0) {
      const r = addCurvePoint(pts(), x, buildCurveFloat(pts(), 256)[Math.round(x * 255)]);
      i = r.index;
      cur = { ...cur, [CH_KEYS[tab]]: r.points };
      set({ [CH_KEYS[tab]]: r.points }, false);
    }
    sel = i;
    drag = i;
    cv.setPointerCapture(e.pointerId);
    refresh();
  });
  cv.addEventListener("pointermove", (e) => {
    const [x, y] = toXY(e);
    readout.textContent = `In ${Math.round(x * 255)} → Out ${Math.round(buildCurveFloat(pts(), 256)[Math.round(x * 255)] * 255)}`;
    if (drag < 0) return;
    const next = moveCurvePoint(pts(), drag, x, y);
    cur = { ...cur, [CH_KEYS[tab]]: next };
    set({ [CH_KEYS[tab]]: next }, false);
    refresh();
  });
  cv.addEventListener("pointerup", () => {
    if (drag >= 0) set({ [CH_KEYS[tab]]: pts() }, true);
    drag = -1;
  });
  const removeSel = () => selected() && pts().length > 2 && (commit(removeCurvePoint(pts(), sel), true), (sel = -1), refresh());
  cv.addEventListener("dblclick", (e) => {
    const i = hit(...toXY(e));
    if (i >= 0) {
      sel = i;
      removeSel();
    }
  });
  cv.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const i = hit(...toXY(e));
    if (i >= 0) {
      sel = i;
      removeSel();
    }
  });
  cv.addEventListener("keydown", (e) => {
    const p = pts();
    const step = (e.shiftKey ? 10 : 1) / 255;
    if (e.key === "Delete" || e.key === "Backspace") removeSel();
    else if (e.key === "[" || e.key === "]") {
      sel = selected() ? (sel + (e.key === "]" ? 1 : -1) + p.length) % p.length : 0;
      refresh();
    } else if (selected() && e.key.startsWith("Arrow")) {
      const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
      const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      commit(moveCurvePoint(p, sel, p[sel][0] + dx, p[sel][1] + dy), true);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  function paint() {
    const g = input.get();
    const { W, H, dpr, css } = fitCanvas(cv, cv.clientWidth || SIZE);
    const ctx = cv.getContext("2d");
    // histogram backdrop (fills the whole square, curve and points go on top)
    drawHistogram(cv, { series: g ? seriesFor(g.a, TAB_CH[tab]) : [], size: { W, H, dpr, css }, grid: false });
    const cs = (n, fb) => css.getPropertyValue(n).trim() || fb;
    ctx.strokeStyle = cs("--of-border", "#444");
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const v = Math.round((i * W) / 4) + 0.5;
      ctx.moveTo(v, 0); ctx.lineTo(v, H); ctx.moveTo(0, v); ctx.lineTo(W, v);
    }
    ctx.stroke();
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);
    const f = buildCurveFloat(pts(), 256);
    const chCol = { rgb: cs("--of-text", "#fff"), red: "#ef4444", green: "#22c55e", blue: "#3b82f6" }[tab];
    ctx.strokeStyle = chCol;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) ctx[i ? "lineTo" : "moveTo"]((i / 255) * W, (1 - f[i]) * H);
    ctx.stroke();
    pts().forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p[0] * W, (1 - p[1]) * H, (i === sel ? 5 : 4) * dpr, 0, 7);
      ctx.fillStyle = i === sel ? cs("--of-accent", "#8b7cf6") : cs("--of-bg-raised", "#fff");
      ctx.fill();
      ctx.strokeStyle = chCol;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    });
  }
  function refresh() {
    tabs.set(tab);
    const p = pts();
    if (selected()) {
      fIn.set(Math.round(p[sel][0] * 255));
      fOut.set(Math.round(p[sel][1] * 255));
    }
    fIn.disable(!selected());
    fOut.disable(!selected());
    del.disabled = !selected() || p.length <= 2;
    reset.disabled = isIdentityCurve(p);
    cv.setAttribute("aria-description", selected() ? `Selected point ${sel + 1} of ${p.length}: input ${Math.round(p[sel][0] * 255)}, output ${Math.round(p[sel][1] * 255)}` : `${p.length} points`);
    paint();
  }
  const el = h("div.of-cv", tabs.el, cv, readout, h("div.of-row.of-lv__nums", fIn.el, fOut.el, del), h("div.of-row.of-lv__tools", sampleBtn, presets.el, h("span.grow"), reset));
  onResize(cv, () => el.isConnected && paint());
  requestAnimationFrame(refresh);
  return {
    el,
    update(p) {
      cur = { ...p };
      refresh();
    },
    refreshInput: paint,
  };
}

// ------------------------------------------------------------------ before / after

function createBeforeAfter(app, node, eff, { params }) {
  const input = createInput(app, node);
  let p = params;
  let raf = 0;
  const canvas = h("canvas.of-ba__canvas", { role: "img", "aria-label": "Histogram before and after this adjustment" });
  const legend = h("div.of-hint.of-ba__legend", "Filled = before, line = after");
  function paint() {
    raf = 0;
    const g = input.get();
    const size = fitCanvas(canvas, 56);
    if (!g) return drawHistogram(canvas, { series: [], size });
    let after = null;
    try {
      const copy = { width: g.img.width, height: g.img.height, data: new Uint8ClampedArray(g.img.data) };
      const out = eff.apply(copy, { ...eff.defaults, ...p }, { scale: g.scale }) || copy;
      after = analyzeImage({ width: g.img.width, height: g.img.height, data: out.data || copy.data }, { lab: false });
    } catch {
      after = null;
    }
    const ch = "rgb";
    drawHistogram(canvas, { series: seriesFor(g.a, ch), lines: after ? [{ values: displayCurve(channelHistogram(after, "luma")).values }] : [], size });
    canvas.setAttribute("aria-label", after ? `Histogram before (filled) and after (line) ${eff.label}` : "Histogram before this adjustment");
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  onResize(canvas, () => el.isConnected && schedule());
  const el = h("div.of-ba", canvas, legend);
  schedule();
  return { el, update(np) { p = np; schedule(); }, refreshInput: schedule };
}

/**
 * Builds the custom widget of an adjustment, or null when it has none.
 * @returns {{el: HTMLElement, replacesControls: boolean, update(params: object): void, refreshInput(): void}|null}
 */
export function createAdjustWidget(app, node, eff, ctx) {
  if (eff.id === "levels") return { ...createLevels(app, node, ctx), replacesControls: true };
  if (eff.id === "curves") return { ...createCurves(app, node, ctx), replacesControls: true };
  if (node.effect.group === "adjustment" || node.effect.group === "develop") return { ...createBeforeAfter(app, node, eff, ctx), replacesControls: false };
  return null;
}
