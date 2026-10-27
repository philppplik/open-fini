// Reusable UI building blocks. Shoelace provides the design-system primitives (icons, color
// picker, range, select, switch, dropdown); everything dense or canvas-specific is lightweight DOM.
import { ta } from "../i18n/dom.js";
import { t } from "../i18n/index.js";
import { h, clamp, round, prettyShortcut, equal } from "../core/util.js";
import { cssColor, parseColor, toHex6, DEFAULT_SWATCHES } from "../core/color.js";

// ------------------------------------------------------------------ tooltip (one shared element)

let tipEl = null;
let tipTimer = 0;
let helpMod = null; // help-content.js, loaded on the first tooltip (one-line "what it does" under the name)
function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = h("div.of-tip", { role: "tooltip" });
  document.body.append(tipEl);
  return tipEl;
}
export function installTooltips() {
  const hide = () => {
    clearTimeout(tipTimer);
    tipEl?.classList.remove("show");
  };
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) return hide();
    clearTimeout(tipTimer);
    if (!helpMod && !document.documentElement.classList.contains("of-no-tips")) import("./help-content.js").then((m) => (helpMod = m)).catch(() => {});
    tipTimer = setTimeout(() => {
      if (document.documentElement.classList.contains("of-no-tips")) return;
      const el = ensureTip();
      const text = t.getAttribute("data-tip");
      const sc = t.getAttribute("data-shortcut");
      const desc = helpMod?.tipDescription(t);
      el.replaceChildren(text, sc ? h("kbd", prettyShortcut(sc)) : "", desc ? h("span.of-tip__desc", desc) : "");
      const r = t.getBoundingClientRect();
      el.classList.add("show");
      const w = el.offsetWidth;
      const pos = t.getAttribute("data-tip-pos") || "auto";
      let x = r.left + r.width / 2 - w / 2;
      let y = r.bottom + 8;
      if (pos === "right" || (pos === "auto" && r.left < 80 && r.width < 80 && r.height < 80 && r.top > 80)) {
        x = r.right + 8;
        y = r.top + r.height / 2 - el.offsetHeight / 2;
      } else if (pos === "top") y = r.top - el.offsetHeight - 8;
      el.style.left = `${clamp(x, 4, innerWidth - w - 4)}px`;
      el.style.top = `${clamp(y, 4, innerHeight - el.offsetHeight - 4)}px`;
    }, 420);
  });
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
}

// ------------------------------------------------------------------ icons & buttons

export const icon = (name, library) => h("sl-icon", { name, library: library || undefined });

export function iconButton({ icon: ic, lib, label, shortcut, onClick, active = false, disabled = false, cls = "", tipPos } = {}) {
  // label is English source text: translated now and again on a language switch (data-i18n-* markers, i18n/index.js translateDom)
  const b = h("button.of-ibtn", { type: "button", class: cls, ...ta({ "aria-label": label, tip: label }), "data-shortcut": shortcut, "data-tip-pos": tipPos }, ic ? h("sl-icon", { name: ic, library: lib }) : null);
  if (active) b.classList.add("active");
  if (disabled) b.disabled = true;
  if (onClick) b.addEventListener("click", (e) => onClick(e, b));
  return b;
}

export function button(label, onClick, { variant = "default", icon: ic, cls = "", title } = {}) {
  const b = h("button.of-btn", { type: "button", class: `${cls} of-btn--${variant}`, title }, ic ? h("sl-icon", { name: ic }) : null, t(label));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function segmented(options, value, onChange, { cls = "" } = {}) {
  const el = h("div.of-seg", { class: cls, role: "group" });
  const btns = options.map((o) => {
    const b = h("button.of-seg__btn", { type: "button", "data-tip": t(o.label), "aria-pressed": String(o.value === value) }, o.icon ? h("sl-icon", { name: o.icon, library: o.lib }) : t(o.text || o.label));
    b.addEventListener("click", () => {
      set(o.value);
      onChange(o.value);
    });
    el.append(b);
    return b;
  });
  function set(v) {
    btns.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i].value === v)));
  }
  return { el, set };
}

// ------------------------------------------------------------------ number field

const fmt = (v, p) => (Number.isFinite(v) ? String(+v.toFixed(p)) : "");

function evalExpr(s) {
  const t = String(s).replace(/,/g, ".").trim();
  if (/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
  if (/^[\d\s+\-*/().%]+$/.test(t)) {
    try {
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict";return (${t.replace(/%/g, "/100")})`)();
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;
    }
  }
  return parseFloat(t);
}

/** Compact numeric input with a drag-to-scrub label. */
export function numField({ label = "", value = 0, min = -Infinity, max = Infinity, step = 1, unit = "", precision = 2, scrub = true, onInput, onChange, title, cls = "", wide = false } = {}) {
  let cur = value;
  const input = h("input.of-num__input", { type: "text", inputMode: "decimal", value: fmt(value, precision), spellcheck: false, "aria-label": t(title || label) });
  const lab = label ? h("span.of-num__label", { "data-tip": title ? t(title) : undefined }, t(label)) : null;
  const un = unit ? h("span.of-num__unit", unit) : null;
  const el = h("label.of-num", { class: `${cls}${wide ? " wide" : ""}` }, lab, input, un);
  const commit = (v, final) => {
    v = clamp(v, min, max);
    cur = v;
    input.value = fmt(v, precision);
    (final ? onChange : onInput)?.(v);
    if (final && onInput && !onChange) onInput(v);
  };
  input.addEventListener("change", () => {
    const v = evalExpr(input.value);
    if (Number.isNaN(v)) input.value = fmt(cur, precision);
    else commit(v, true);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const m = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      commit(cur + (e.key === "ArrowUp" ? 1 : -1) * step * m, true);
    } else if (e.key === "Enter") input.blur();
    e.stopPropagation();
  });
  input.addEventListener("focus", () => input.select());
  if (scrub && lab) {
    lab.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      lab.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const v0 = cur;
      let moved = false;
      const mv = (ev) => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 1) moved = true;
        const m = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        commit(v0 + dx * step * m, false);
      };
      const up = (ev) => {
        lab.removeEventListener("pointermove", mv);
        lab.removeEventListener("pointerup", up);
        lab.releasePointerCapture?.(ev.pointerId);
        if (moved) commit(cur, true);
        else input.focus();
      };
      lab.addEventListener("pointermove", mv);
      lab.addEventListener("pointerup", up);
    });
  }
  return {
    el,
    input,
    set(v) {
      cur = v;
      if (document.activeElement !== input) input.value = fmt(v, precision);
    },
    get: () => cur,
    disable(d) {
      input.disabled = d;
      el.classList.toggle("disabled", d);
    },
  };
}

// ------------------------------------------------------------------ slider

/** Labeled slider (Shoelace range) with a numeric readout. */
export function sliderField({ label, value = 0, min = 0, max = 100, step = 1, unit = "", precision = 0, scale = 1, onInput, onChange, cls = "" } = {}) {
  const range = h("sl-range", { min, max, step, value, tooltip: "none", "aria-label": t(label) });
  const num = numField({
    value: value * scale, min: min * scale, max: max * scale, step: step * scale, unit, precision, scrub: false,
    onChange: (v) => {
      range.value = v / scale;
      onChange?.(v / scale);
    },
    onInput: (v) => onInput?.(v / scale),
  });
  num.el.classList.add("of-slider__num");
  const el = h("div.of-slider", { class: cls }, label ? h("span.of-slider__label", t(label)) : null, range, num.el);
  range.addEventListener("sl-input", () => {
    num.set(range.value * scale);
    onInput?.(range.value);
  });
  range.addEventListener("sl-change", () => onChange?.(range.value));
  return {
    el,
    set(v) {
      range.value = v;
      num.set(v * scale);
    },
  };
}

// ------------------------------------------------------------------ color

/** Swatch button that opens a Shoelace color picker (with alpha and document swatches). */
export function colorField({ value = "#000000", alpha = true, swatches = DEFAULT_SWATCHES, onInput, onChange, label = "", cls = "" } = {}) {
  const chip = h("span.of-chip__fill");
  const trigger = h("button.of-chip", { type: "button", slot: "trigger", "aria-label": t(label || "Color") }, chip);
  const picker = h("sl-color-picker", { value, format: "hex", opacity: alpha, size: "small", inline: true, swatches: swatches.join(";"), "no-format-toggle": true });
  const dd = h("sl-dropdown", { class: "of-color-dd", distance: 6, hoist: true }, trigger, h("div.of-popover", picker));
  const paint = (c) => {
    chip.style.background = cssColor(c);
  };
  paint(value);
  picker.addEventListener("sl-input", () => {
    paint(picker.value);
    onInput?.(picker.value);
  });
  picker.addEventListener("sl-change", () => onChange?.(picker.value));
  const el = h("div.of-colorfield", { class: cls }, label ? h("span.of-num__label", t(label)) : null, dd);
  return {
    el,
    set(c) {
      paint(c);
      if (picker.value !== c) picker.value = c;
    },
    picker,
  };
}

// ------------------------------------------------------------------ select / switch

export function selectField({ label, value, options, onChange, cls = "", size = "small" } = {}) {
  const sel = h("sl-select", { value, size, hoist: true, "aria-label": t(label) });
  for (const o of options) sel.append(h("sl-option", { value: o.value }, t(o.label)));
  sel.addEventListener("sl-change", () => onChange?.(sel.value));
  const el = h("div.of-select", { class: cls }, label ? h("span.of-num__label", t(label)) : null, sel);
  return { el, set: (v) => (sel.value = v), select: sel };
}

export function switchField({ label, value = false, onChange, cls = "" } = {}) {
  const sw = h("sl-switch", { size: "small" }, t(label));
  sw.checked = !!value;
  sw.addEventListener("sl-change", () => onChange?.(sw.checked));
  return { el: h("div.of-switch", { class: cls }, sw), set: (v) => (sw.checked = !!v), sw };
}

export function section(title, content, { open = true, actions } = {}) {
  const d = h("details.of-section", { open }, h("summary", h("span", title), actions || null), h("div.of-section__body", content));
  return d;
}

export function row(...children) {
  return h("div.of-row", ...children);
}

// ------------------------------------------------------------------ curve editor

/** Canvas curve editor. value: [[x,y],...] in 0..1 (monotone cubic interpolation is done by the effect). */
export function curveEditor({ value = [[0, 0], [1, 1]], onInput, onChange, size = 168 } = {}) {
  let pts = value.map((p) => [...p]);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = h("canvas.of-curve", { width: size * dpr, height: size * dpr, style: { width: `${size}px`, height: `${size}px` } });
  const ctx = cv.getContext("2d");
  let drag = -1;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)];
  };
  function spline() {
    // monotone cubic (Fritsch–Carlson) sampled for display only
    const n = pts.length;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const d = [];
    const m = [];
    for (let i = 0; i < n - 1; i++) {
      d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-9);
    }
    m[0] = d[0] ?? 0;
    m[n - 1] = d[n - 2] ?? 0;
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) m[i] = m[i + 1] = 0;
      else {
        const a = m[i] / d[i];
        const b = m[i + 1] / d[i];
        const s = a * a + b * b;
        if (s > 9) {
          const t = 3 / Math.sqrt(s);
          m[i] = t * a * d[i];
          m[i + 1] = t * b * d[i];
        }
      }
    }
    return (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (x > xs[i + 1]) i++;
      const hh = xs[i + 1] - xs[i];
      const t = (x - xs[i]) / hh;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
    };
  }
  function draw() {
    const W = cv.width;
    ctx.clearRect(0, 0, W, W);
    const css = getComputedStyle(cv);
    ctx.fillStyle = css.getPropertyValue("--of-bg-input") || "#111";
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = css.getPropertyValue("--of-border") || "#444";
    ctx.lineWidth = dpr;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / 4, 0);
      ctx.lineTo((W * i) / 4, W);
      ctx.moveTo(0, (W * i) / 4);
      ctx.lineTo(W, (W * i) / 4);
      ctx.stroke();
    }
    const f = spline();
    ctx.strokeStyle = css.getPropertyValue("--of-accent") || "#8b7cf6";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      const y = clamp(f(x), 0, 1);
      ctx[i ? "lineTo" : "moveTo"](x * W, (1 - y) * W);
    }
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p[0] * W, (1 - p[1]) * W, 4 * dpr, 0, 7);
      ctx.fill();
    }
  }
  cv.addEventListener("pointerdown", (e) => {
    const [x, y] = pos(e);
    let best = -1;
    let bd = 0.06;
    pts.forEach((p, i) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) {
      pts.push([x, y]);
      pts.sort((a, b) => a[0] - b[0]);
      best = pts.findIndex((p) => p[0] === x && p[1] === y);
    }
    drag = best;
    cv.setPointerCapture(e.pointerId);
    draw();
    onInput?.(pts.map((p) => [...p]));
  });
  cv.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const [x, y] = pos(e);
    const lo = drag === 0 ? 0 : pts[drag - 1][0] + 0.005;
    const hi = drag === pts.length - 1 ? 1 : pts[drag + 1][0] - 0.005;
    pts[drag] = [drag === 0 ? 0 : drag === pts.length - 1 ? 1 : clamp(x, lo, hi), y];
    draw();
    onInput?.(pts.map((p) => [...p]));
  });
  cv.addEventListener("pointerup", () => {
    if (drag >= 0) onChange?.(pts.map((p) => [...p]));
    drag = -1;
  });
  cv.addEventListener("dblclick", (e) => {
    const [x, y] = pos(e);
    const i = pts.findIndex((p, k) => k > 0 && k < pts.length - 1 && Math.hypot(p[0] - x, p[1] - y) < 0.06);
    if (i > 0) {
      pts.splice(i, 1);
      draw();
      onChange?.(pts.map((p) => [...p]));
    }
  });
  requestAnimationFrame(draw);
  return {
    el: cv,
    set(v) {
      if (!equal(v, pts)) {
        pts = v.map((p) => [...p]);
        draw();
      }
    },
  };
}

// ------------------------------------------------------------------ gradient editor

/** Edits a gradient fill object (linear | radial | conic) in place via callbacks. */
export function gradientEditor({ fill, onInput, onChange } = {}) {
  let g = JSON.parse(JSON.stringify(fill));
  let sel = 0;
  const bar = h("div.of-grad__bar");
  const stopsRow = h("div.of-grad__stops");
  const stopColor = colorField({ value: g.stops[0].color, alpha: false, label: "Color", onInput: (c) => edit({ color: c }, false), onChange: (c) => edit({ color: c }, true) });
  const stopPos = numField({ label: "Pos", value: g.stops[0].o * 100, min: 0, max: 100, unit: "%", precision: 0, onInput: (v) => edit({ o: v / 100 }, false), onChange: (v) => edit({ o: v / 100 }, true) });
  const stopAlpha = numField({ label: "Op", value: 100, min: 0, max: 100, unit: "%", precision: 0, onInput: (v) => edit({ alpha: v / 100 }, false), onChange: (v) => edit({ alpha: v / 100 }, true) });
  const del = iconButton({ icon: "trash3", label: "Delete stop", onClick: () => {
    if (g.stops.length <= 2) return;
    g.stops.splice(sel, 1);
    sel = clamp(sel - 1, 0, g.stops.length - 1);
    render();
    onChange?.(g);
  } });
  function css() {
    const stops = [...g.stops].sort((a, b) => a.o - b.o).map((s) => `${cssColor(s.color, s.alpha)} ${(s.o * 100).toFixed(1)}%`);
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }
  function render() {
    bar.style.background = `${css()}, repeating-conic-gradient(#808080 0% 25%, #b0b0b0 0% 50%) 0 0 / 10px 10px`;
    stopsRow.replaceChildren(
      ...g.stops.map((s, i) => {
        const b = h("button.of-grad__stop", { type: "button", style: { left: `${s.o * 100}%`, "--c": cssColor(s.color, 1) }, class: i === sel ? "sel" : "" });
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          sel = i;
          b.setPointerCapture(e.pointerId);
          const r = stopsRow.getBoundingClientRect();
          let moved = false;
          const mv = (ev) => {
            moved = true;
            g.stops[i].o = clamp((ev.clientX - r.left) / r.width, 0, 1);
            render();
            onInput?.(g);
          };
          const up = () => {
            b.removeEventListener("pointermove", mv);
            b.removeEventListener("pointerup", up);
            if (moved) onChange?.(g);
          };
          b.addEventListener("pointermove", mv);
          b.addEventListener("pointerup", up);
          render();
        });
        return b;
      }),
    );
    const s = g.stops[sel];
    stopColor.set(toHex6(s.color));
    stopPos.set(s.o * 100);
    stopAlpha.set((s.alpha ?? 1) * 100);
  }
  function edit(patch, final) {
    Object.assign(g.stops[sel], patch);
    render();
    (final ? onChange : onInput)?.(g);
  }
  bar.addEventListener("dblclick", (e) => {
    const r = bar.getBoundingClientRect();
    const o = clamp((e.clientX - r.left) / r.width, 0, 1);
    // interpolate color at o
    const sorted = [...g.stops].sort((a, b) => a.o - b.o);
    let a = sorted[0];
    let b = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) if (o >= sorted[i].o && o <= sorted[i + 1].o) [a, b] = [sorted[i], sorted[i + 1]];
    const t = b.o === a.o ? 0 : (o - a.o) / (b.o - a.o);
    const ca = parseColor(a.color);
    const cb = parseColor(b.color);
    const mix = (u, v) => Math.round(u + (v - u) * t);
    const hex = "#" + [mix(ca.r, cb.r), mix(ca.g, cb.g), mix(ca.b, cb.b)].map((v) => v.toString(16).padStart(2, "0")).join("");
    g.stops.push({ o, color: hex, alpha: (a.alpha ?? 1) + ((b.alpha ?? 1) - (a.alpha ?? 1)) * t });
    sel = g.stops.length - 1;
    render();
    onChange?.(g);
  });
  const el = h("div.of-grad", bar, stopsRow, h("div.of-row", stopColor.el, stopPos.el, stopAlpha.el, del));
  render();
  return {
    el,
    set(f) {
      g = JSON.parse(JSON.stringify(f));
      sel = clamp(sel, 0, g.stops.length - 1);
      render();
    },
  };
}

// ------------------------------------------------------------------ schema → form

/**
 * Builds a form from a Control schema (see docs/engine-contracts.md §1.1).
 * @param {object[]} schema
 * @param {object} params current values
 * @param {{onInput?:(key:string,value:any,params:object)=>void,onChange?:(key:string,value:any,params:object)=>void}} cb
 */
export function buildControls(schema, params, { onInput, onChange } = {}) {
  const wrap = h("div.of-form");
  const setters = new Map();
  let lastGroup = null;
  for (const c of schema) {
    if (c.group && c.group !== lastGroup) {
      wrap.append(h("div.of-form__group", c.group));
      lastGroup = c.group;
    }
    const v = params[c.key] ?? c.default;
    const input = (val) => onInput?.(c.key, val, params);
    const change = (val) => onChange?.(c.key, val, params);
    let field;
    switch (c.type) {
      case "range":
      case "int": {
        const isInt = c.type === "int";
        const f = sliderField({
          label: c.label, value: v, min: c.min ?? 0, max: c.max ?? 100, step: c.step ?? (isInt ? 1 : 0.01), unit: c.unit || "",
          precision: isInt ? 0 : precisionOf(c.step), onInput: input, onChange: change,
        });
        setters.set(c.key, f.set);
        field = f.el;
        break;
      }
      case "angle": {
        const f = numField({ label: c.label, value: v, min: c.min ?? -360, max: c.max ?? 360, step: c.step ?? 1, unit: "°", precision: 1, onInput: input, onChange: change, wide: true });
        setters.set(c.key, f.set);
        field = f.el;
        break;
      }
      case "bool": {
        const f = switchField({ label: c.label, value: v, onChange: (val) => change(val) });
        setters.set(c.key, f.set);
        field = f.el;
        break;
      }
      case "select": {
        const f = selectField({ label: c.label, value: v, options: c.options, onChange: (val) => change(val) });
        setters.set(c.key, f.set);
        field = f.el;
        break;
      }
      case "color": {
        const f = colorField({ value: v, label: c.label, onInput: input, onChange: change });
        setters.set(c.key, f.set);
        field = f.el;
        break;
      }
      case "curve": {
        const f = curveEditor({ value: v, onInput: input, onChange: change });
        setters.set(c.key, f.set);
        field = h("div.of-curve-wrap", h("span.of-slider__label", c.label), f.el);
        break;
      }
      case "point": {
        const fx = numField({ label: "X", value: (v?.x ?? 0.5) * 100, min: 0, max: 100, unit: "%", precision: 0, onChange: (val) => change({ ...(params[c.key] || v), x: val / 100 }) });
        const fy = numField({ label: "Y", value: (v?.y ?? 0.5) * 100, min: 0, max: 100, unit: "%", precision: 0, onChange: (val) => change({ ...(params[c.key] || v), y: val / 100 }) });
        setters.set(c.key, (p) => {
          fx.set((p?.x ?? 0.5) * 100);
          fy.set((p?.y ?? 0.5) * 100);
        });
        field = h("div.of-row", h("span.of-slider__label", c.label), fx.el, fy.el);
        break;
      }
      default:
        continue;
    }
    if (c.hint) field.setAttribute("data-tip", c.hint);
    wrap.append(field);
  }
  wrap.update = (p) => {
    for (const [k, set] of setters) if (p[k] !== undefined) set(p[k]);
  };
  return wrap;
}

function precisionOf(step) {
  if (!step || step >= 1) return 0;
  return Math.min(4, Math.ceil(-Math.log10(step)));
}

export { round };
