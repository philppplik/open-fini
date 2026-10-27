// Viewport controls of the Code studio preview: the control bar (size fields, presets, lock, rotate, zoom, width
// slider, saved sizes, measure options), the rulers with breakpoint markers and the drag handles of the device frame.
//
// Public API (all take the PreviewPane `pv`; the pane owns the state, this file only draws and forwards input):
//   createViewportBar(pv) -> { el, sync(), flashBadge(), destroy() }
//   createRulers(pv)      -> { corner, h, v, draw(), destroy() }
//   attachHandles(pv, host)  adds the right / bottom / corner handles to the device wrapper `host`
// Invariants: every change goes through pv.setSize / pv.resizeTo (they persist, update the breakpoint and redraw);
// pure arithmetic (clamping, snapping, ticks, markers) lives in engine/web/viewport.js and is unit-tested.
import { h, empty } from "../../core/util.js";
import { ta, tspan } from "../../i18n/dom.js";
import { t, N_ } from "../../i18n/index.js";
import { iconButton } from "../controls.js";
import { promptDialog } from "../dialogs.js";
import { DEVICE_PRESETS, UNITS, VIEWPORT_LIMITS, parseSizeInput, nudgeSize, matchPreset, rulerTicks, describeBox } from "../../engine/web/index.js";

const ZOOMS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const GROUPS = { Desktop: N_("Desktop"), Tablet: N_("Tablet"), Phone: N_("Phone") };
const PHYSICAL =new Set(["mm", "cm", "in", "pt"]);

// ------------------------------------------------------------------------------------------------ saved sizes

function validSizes(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.name === "string" && Number.isFinite(s.w) && Number.isFinite(s.h))
    .slice(0, 12)
    .map((s) => ({ name: s.name.slice(0, 40), w: Math.round(s.w), h: Math.round(s.h) }));
}
const savedSizes = (pv) => validSizes(pv.web.settings.customSizes ?? pv.app.prefs.codeViewportSizes);

// ------------------------------------------------------------------------------------------------ the bar

export function createViewportBar(pv) {
  const badge = h("div.of-vp__badge", { "aria-hidden": "true" });
  pv.dwrap.append(badge);
  let badgeTimer = 0;
  const flashBadge = () => {
    badge.textContent = `${pv.vw} × ${pv.vh || pv.vhEff}`;
    badge.classList.add("show");
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge.classList.remove("show"), 1400);
  };

  function sizeInput(axis, label) {
    const input = h("input.of-vp__num", { type: "text", inputMode: "numeric", autocomplete: "off", spellcheck: false, ...ta({ "aria-label": label, tip: label }) });
    const committed = () => String(axis === "w" ? pv.vw : pv.vh || pv.vhEff);
    const apply = () => {
      const v = parseSizeInput(input.value);
      if (v == null) input.value = committed();
      else pv.resizeTo(axis === "w" ? { w: v } : { h: v }, { from: axis, snap: false });
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        apply();
        input.select();
      } else if (e.key === "Escape") {
        input.value = committed();
        input.blur();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const cur = parseSizeInput(input.value) ?? Number(committed());
        input.value = String(nudgeSize(cur, e.key === "ArrowUp" ? 1 : -1, e.shiftKey));
        apply();
      }
    });
    input.addEventListener("blur", () => {
      if (input.value !== committed()) apply();
    });
    input.addEventListener("focus", () => input.select());
    return input;
  }
  const wIn = sizeInput("w", N_("Viewport width in CSS pixels (Enter to apply, arrows ±1, Shift ±10)"));
  const hIn = sizeInput("h", N_("Viewport height in CSS pixels (Enter to apply, arrows ±1, Shift ±10)"));

  const lock = iconButton({ icon: "unlock", label: "Lock aspect ratio", onClick: () => pv.setLockAspect(!pv.lockAspect) });
  lock.setAttribute("aria-pressed", "false");
  const rotate = iconButton({ icon: "arrow-repeat", label: "Rotate: swap width and height", onClick: () => pv.rotate() });
  const fill = iconButton({ icon: "arrows-vertical", label: "Fill the available height", onClick: () => pv.setSize(undefined, null) });
  fill.setAttribute("aria-pressed", "false");
  const rulersBtn = iconButton({ icon: "rulers", label: "Show rulers and breakpoint markers", onClick: () => pv.setRulers(!pv.rulersOn) });
  rulersBtn.setAttribute("aria-pressed", "true");
  // hidden by default: a classic scrollbar takes ~15 px from the layout width (layout width != viewport width)
  const sbBtn = iconButton({ icon: "layout-sidebar-inset-reverse", label: "Show the page scrollbar (it reduces the layout width)", onClick: () => pv.setScrollbar(!pv.showScrollbar) });
  sbBtn.setAttribute("aria-pressed", "false");

  // device presets + saved sizes
  const presetSel = h("sl-select", { size: "small", hoist: true, class: "of-vp__preset", ...ta({ "aria-label": "Device size" }) });
  let guard = false;
  function renderPresets() {
    empty(presetSel);
    presetSel.append(h("sl-option", { value: "custom" }, t("Custom size")));
    let group = "";
    for (const p of DEVICE_PRESETS) {
      if (p.group !== group) {
        group = p.group;
        presetSel.append(h("sl-divider"), h("small.of-vp__group", t(GROUPS[p.group])));
      }
      presetSel.append(h("sl-option", { value: p.id }, `${p.label}`, h("span.of-vp__dim", { slot: "suffix" }, `${p.w}×${p.h}`)));
    }
    const saved = savedSizes(pv);
    if (saved.length) presetSel.append(h("sl-divider"), h("small.of-vp__group", t("Saved sizes")));
    saved.forEach((s, i) => presetSel.append(h("sl-option", { value: `saved:${i}` }, s.name, h("span.of-vp__dim", { slot: "suffix" }, `${s.w}×${s.h}`))));
  }
  presetSel.addEventListener("sl-change", () => {
    if (guard) return;
    const v = presetSel.value;
    if (v.startsWith("saved:")) {
      const s = savedSizes(pv)[Number(v.slice(6))];
      if (s) pv.resizeTo({ w: s.w, h: s.h }, { snap: false });
    } else {
      const p = DEVICE_PRESETS.find((x) => x.id === v);
      if (p) pv.resizeTo({ w: p.w, h: p.h }, { snap: false });
    }
  });
  const trash = iconButton({ icon: "trash3", label: "Delete this saved size", onClick: () => {
    const i = Number(presetSel.value.slice(6));
    const list = savedSizes(pv);
    list.splice(i, 1);
    persistSizes(list);
  } });
  trash.classList.add("hidden");
  const save = iconButton({ icon: "star", label: "Save the current size", onClick: async () => {
    const name = await promptDialog({ title: t("Save viewport size"), label: t("Name"), value: `${pv.vw} × ${pv.vh || pv.vhEff}`, ok: t("Save") });
    if (!name?.trim()) return;
    const list = savedSizes(pv).filter((s) => s.name !== name.trim());
    list.push({ name: name.trim().slice(0, 40), w: pv.vw, h: pv.vh || pv.vhEff });
    persistSizes(list.slice(-12));
  } });
  function persistSizes(list) {
    pv.web.settings.customSizes = list;
    pv.app.setPref("codeViewportSizes", list);
    renderPresets();
    sync();
  }

  // zoom
  const zoomSel = h("sl-select", { size: "small", hoist: true, class: "of-vp__zoom", ...ta({ "aria-label": "Zoom" }) });
  const zoomOpts = [{ v: "fit", l: t("Fit") }, ...ZOOMS.map((n) => ({ v: String(n / 100), l: `${n}%` }))];
  for (const z of zoomOpts) zoomSel.append(h("sl-option", { value: z.v }, z.l));
  const zoomExtra = h("sl-option", { value: "x", class: "hidden" }, "");
  zoomSel.append(zoomExtra);
  zoomSel.addEventListener("sl-change", () => !guard && zoomSel.value !== "x" && pv.setZoom(zoomSel.value === "fit" ? "fit" : Number(zoomSel.value)));

  // width slider: snaps to breakpoint markers within 6 px unless Alt is held; the zoom stays put while dragging
  const slider = h("input.of-vp__slider", { type: "range", min: VIEWPORT_LIMITS.sliderMin, max: VIEWPORT_LIMITS.sliderMax, step: 1, ...ta({ "aria-label": "Viewport width slider (snaps to breakpoints, hold Alt to disable)" }) });
  slider.addEventListener("pointerdown", () => (pv.dragging = { scale: pv.scale }));
  const release = () => {
    if (!pv.dragging) return;
    pv.dragging = null;
    pv.layout();
  };
  slider.addEventListener("pointerup", release);
  slider.addEventListener("change", release);
  slider.addEventListener("blur", release);
  slider.addEventListener("input", () => pv.resizeTo({ w: Number(slider.value) }, { snap: true }));

  // measure options (only while the tool is on)
  const unitSel = h("sl-select", { size: "small", hoist: true, class: "of-vp__unit", ...ta({ "aria-label": "Measurement unit" }) });
  for (const u of UNITS) unitSel.append(h("sl-option", { value: u }, u === "%" ? t("% of parent") : u));
  unitSel.addEventListener("sl-change", () => !guard && pv.setMeasureOptions({ unit: unitSel.value }));
  const ppiIn = h("input.of-vp__num.of-vp__ppi", { type: "text", inputMode: "numeric", autocomplete: "off", ...ta({ "aria-label": "Screen density for physical units, in pixels per inch (96 = CSS reference)", tip: "Pixels per inch used for mm, cm, in and pt (96 = CSS reference)" }) });
  const ppiCommit = () => {
    const v = Number(ppiIn.value.replace(",", "."));
    if (v >= 20 && v <= 1000) pv.setMeasureOptions({ ppi: v });
    else ppiIn.value = String(pv.measure.ppi);
  };
  ppiIn.addEventListener("keydown", (e) => e.key === "Enter" && ppiCommit());
  ppiIn.addEventListener("blur", ppiCommit);
  const check = (label, onChange) => {
    const input = h("input", { type: "checkbox" });
    input.addEventListener("change", () => onChange(input.checked));
    return { input, el: h("label.of-vp__check", input, tspan(label)) };
  };
  const detailsChk = check("Spacing values", (v) => pv.setMeasureOptions({ details: v }));
  const dprChk = check("Device pixels", (v) => pv.setMeasureOptions({ dprAware: v }));
  dprChk.el.title = t("Count physical screen pixels (CSS pixels × device pixel ratio) for mm, cm, in and pt. Off = CSS reference pixels.");
  const readout = h("button.of-vp__readout", { type: "button", ...ta({ "aria-label": "Copy the measured size" }) });
  readout.addEventListener("click", () => {
    const r = describe();
    if (r) pv.copyMeasure(r.size.text);
  });
  const measureRow = h(
    "div.of-vp__row.of-vp__measure.hidden",
    h("span.of-vp__title", tspan("Measure")),
    unitSel,
    h("span.of-vp__ppi-wrap", ppiIn, h("span.of-vp__dim", "ppi")),
    detailsChk.el,
    dprChk.el,
    readout,
    h("span.of-vp__hint", tspan("Hover to measure · click to pin · Shift+click to link · hold Alt for distances · Ctrl+C to copy · Esc to leave")),
  );
  function describe() {
    const box = pv.measure.box;
    if (!box) return null;
    return describeBox(box, pv.measure.unit, { ppi: pv.measure.ppi, dpr: window.devicePixelRatio || 1, dprAware: pv.measure.dprAware });
  }

  const row1 = h(
    "div.of-vp__row",
    presetSel,
    trash,
    save,
    h("span.of-vp__size", wIn, lock, hIn),
    rotate,
    fill,
    h("span.of-vp__sep"),
    zoomSel,
    rulersBtn,
    sbBtn,
    slider,
    pv.label,
  );
  const el = h("div.of-vp", { role: "group", ...ta({ "aria-label": "Viewport" }) }, row1, measureRow);

  function sync() {
    const w = pv.vw;
    const hh = pv.vh || pv.vhEff;
    if (document.activeElement !== wIn) wIn.value = String(w);
    if (document.activeElement !== hIn) hIn.value = String(hh);
    slider.value = String(w);
    slider.setAttribute("aria-valuetext", `${w} px`);
    lock.classList.toggle("active", pv.lockAspect);
    lock.setAttribute("aria-pressed", String(pv.lockAspect));
    lock.querySelector("sl-icon")?.setAttribute("name", pv.lockAspect ? "lock" : "unlock");
    fill.classList.toggle("active", !pv.vh);
    fill.setAttribute("aria-pressed", String(!pv.vh));
    rulersBtn.classList.toggle("active", pv.rulersOn);
    rulersBtn.setAttribute("aria-pressed", String(pv.rulersOn));
    sbBtn.classList.toggle("active", !!pv.showScrollbar);
    sbBtn.setAttribute("aria-pressed", String(!!pv.showScrollbar));
    guard = true;
    const saved = savedSizes(pv);
    const si = saved.findIndex((s) => s.w === w && s.h === hh);
    const preset = si >= 0 ? `saved:${si}` : (pv.vh ? matchPreset(w, pv.vh) : matchPreset(w))?.id || "custom";
    customElements.whenDefined("sl-select").then(() => {
      guard = true;
      presetSel.value = preset;
      const z = pv.zoomSetting === "fit" ? "fit" : String(pv.zoomSetting);
      if (z !== "fit" && !zoomOpts.some((o) => o.v === z)) {
        zoomExtra.value = z;
        zoomExtra.textContent = `${Math.round(Number(z) * 100)}%`;
        zoomExtra.classList.remove("hidden");
        zoomSel.value = z;
      } else {
        zoomExtra.classList.add("hidden");
        zoomSel.value = z;
      }
      unitSel.value = pv.measure.unit;
      guard = false;
    });
    guard = false;
    trash.classList.toggle("hidden", si < 0);
    const m = pv.measure;
    measureRow.classList.toggle("hidden", !m.on);
    el.classList.toggle("measuring", m.on);
    if (document.activeElement !== ppiIn) ppiIn.value = String(m.ppi);
    ppiIn.parentElement.classList.toggle("hidden", !PHYSICAL.has(m.unit));
    detailsChk.input.checked = m.details;
    dprChk.input.checked = m.dprAware;
    dprChk.el.classList.toggle("hidden", !PHYSICAL.has(m.unit));
    if (m.on) {
      const r = describe();
      readout.textContent = r ? `${r.tag} · ${r.size.text}${m.details ? ` · margin ${r.margin.text} · padding ${r.padding.text}` : ""}` : t("Hover an element");
      readout.disabled = !r;
    }
  }
  renderPresets();
  pv.on("measure", sync);
  pv.on("zoom", sync);
  sync();
  return { el, sync, flashBadge, destroy: () => clearTimeout(badgeTimer) };
}

// ------------------------------------------------------------------------------------------------ rulers

export function createRulers(pv) {
  const corner = h("div.of-ruler__corner");
  const hc = h("canvas");
  const vc = h("canvas");
  const marks = h("div.of-ruler__marks");
  const hr = h("div.of-ruler.of-ruler--h", { role: "group", ...ta({ "aria-label": "Horizontal ruler with breakpoint markers" }) }, hc, marks);
  const vr = h("div.of-ruler.of-ruler--v", { "aria-hidden": "true" }, vc);
  let markKey = "";
  let markEls = [];
  const colors = () => {
    const cs = getComputedStyle(pv.el);
    const get = (n, d) => cs.getPropertyValue(n).trim() || d;
    return { text: get("--of-text-dim", "#888"), line: get("--of-border", "#555"), accent: get("--of-accent", "#4f8cff") };
  };

  function buildMarks() {
    const list = pv.markers();
    const key = list.map((m) => `${m.px}${m.label}`).join("|");
    if (key === markKey) return;
    markKey = key;
    empty(marks);
    markEls = list.map((m) => {
      const b = h("button.of-ruler__mark", { type: "button", class: m.source === "css" ? "css" : "", "data-px": String(m.px), ...ta({ "aria-label": `${m.label} px`, tip: `${m.label} px: click to set the width` }) });
      b.addEventListener("click", () => pv.resizeTo({ w: m.px }, { snap: false }));
      marks.append(b);
      return { b, px: m.px };
    });
  }

  function size(canvas, host) {
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const hh = host.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hh * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    return { ctx, w, h: hh };
  }

  function draw() {
    if (!pv.rulersOn || !pv.el.isConnected) return;
    const dr = pv.dwrap.getBoundingClientRect();
    if (!dr.width) return;
    const c = colors();
    const scale = pv.scale || 1;
    const font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    // horizontal
    {
      const { ctx, w, h: hh } = size(hc, hr);
      const x0 = dr.left - hr.getBoundingClientRect().left;
      const { ticks } = rulerTicks(-x0 / scale, (w - x0) / scale, scale);
      ctx.font = font;
      ctx.textBaseline = "top";
      ctx.fillStyle = c.text;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const tk of ticks) {
        const x = Math.round(x0 + tk.v * scale) + 0.5;
        ctx.moveTo(x, hh);
        ctx.lineTo(x, tk.major ? hh - 10 : hh - 5);
        if (tk.major) ctx.fillText(tk.label, x + 3, 2);
      }
      ctx.stroke();
      const ex = Math.round(x0 + pv.vw * scale) + 0.5;
      ctx.strokeStyle = c.accent;
      ctx.beginPath();
      ctx.moveTo(ex, 0);
      ctx.lineTo(ex, hh);
      ctx.stroke();
      buildMarks();
      for (const m of markEls) {
        const x = x0 + m.px * scale;
        m.b.style.left = `${x}px`;
        m.b.hidden = x < 0 || x > w;
        m.b.classList.toggle("active", m.px === pv.vw);
      }
    }
    // vertical
    {
      const { ctx, w, h: hh } = size(vc, vr);
      const y0 = dr.top - vr.getBoundingClientRect().top;
      const { ticks } = rulerTicks(-y0 / scale, (hh - y0) / scale, scale);
      ctx.font = font;
      ctx.fillStyle = c.text;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const tk of ticks) {
        const y = Math.round(y0 + tk.v * scale) + 0.5;
        ctx.moveTo(w, y);
        ctx.lineTo(tk.major ? w - 10 : w - 5, y);
      }
      ctx.stroke();
      ctx.textBaseline = "top";
      for (const tk of ticks) {
        if (!tk.major) continue;
        ctx.save();
        ctx.translate(2, Math.round(y0 + tk.v * scale) - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(tk.label, 0, 0);
        ctx.restore();
      }
      const ey = Math.round(y0 + (pv.vh || pv.vhEff) * scale) + 0.5;
      ctx.strokeStyle = c.accent;
      ctx.beginPath();
      ctx.moveTo(0, ey);
      ctx.lineTo(w, ey);
      ctx.stroke();
    }
  }
  // theme switches change the colors
  const mo = new MutationObserver(() => draw());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  return { corner, h: hr, v: vr, draw, destroy: () => mo.disconnect() };
}

// ------------------------------------------------------------------------------------------------ drag handles

export function attachHandles(pv, host) {
  const make = (kind, label) => h(`div.of-vp__handle.of-vp__handle--${kind}`, { role: "separator", tabIndex: 0, "aria-orientation": kind === "b" ? "horizontal" : "vertical", ...ta({ "aria-label": label, tip: label }) });
  const r = make("r", N_("Drag to change the viewport width (Alt: no snapping). Arrow keys ±1, Shift ±10"));
  const b = make("b", N_("Drag to change the viewport height. Arrow keys ±1, Shift ±10"));
  const c = make("c", N_("Drag to change width and height"));
  host.append(r, b, c);

  for (const [el, kind] of [[r, "r"], [b, "b"], [c, "c"]]) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, w: pv.vw, h: pv.vh || pv.vhEff, scale: pv.scale || 1 };
      pv.dragging = { scale: start.scale };
      pv.el.classList.add("is-resizing");
      pv.bar.flashBadge();
      const move = (ev) => {
        const dx = (ev.clientX - start.x) / start.scale;
        const dy = (ev.clientY - start.y) / start.scale;
        pv.resizeTo({ w: kind !== "b" ? Math.round(start.w + dx) : undefined, h: kind !== "r" ? Math.round(start.h + dy) : undefined }, { from: kind === "b" ? "h" : "w", snap: kind !== "b" });
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        pv.dragging = null;
        pv.el.classList.remove("is-resizing");
        pv.layout();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      const dw = kind !== "b" ? d[0] : 0;
      const dh = kind !== "r" ? d[1] : 0;
      if (!dw && !dh) return;
      e.preventDefault();
      pv.resizeTo({ w: dw ? pv.vw + dw : undefined, h: dh ? (pv.vh || pv.vhEff) + dh : undefined }, { from: dh ? "h" : "w", snap: false });
    });
    el.addEventListener("focus", () => pv.bar.flashBadge());
  }
  const aria = () => {
    r.setAttribute("aria-valuenow", String(pv.vw));
    b.setAttribute("aria-valuenow", String(pv.vh || pv.vhEff));
    c.setAttribute("aria-valuetext", `${pv.vw} × ${pv.vh || pv.vhEff}`);
  };
  pv.on("layout", aria);
  aria();
}
