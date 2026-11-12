// Scene Studio graph editor (docs/scene-studio.md ▸ Graph editor): the keyframes of the selected clip's animated
// properties as value curves or speed curves, with Bezier handles, easing presets, box selection, copy / paste and
// numeric entry. Loaded on first use (scene/view.js ▸ toggleGraph) and shown in place of the timeline.
//
//   createGraphEditor(ui) → { el, draw(), fit(selection?), destroy() }
// `ui` is the workspace (scene/view.js): seqModel(), commitSeq(label, next), selection(), state { t, snap },
// seek(t), requestDraw(), focus(). Every gesture edits a draft and commits ONE undo step on release.
// Mouse (After Effects / DaVinci habits): click a keyframe to select it (Shift / Ctrl adds), drag to move it in time
// and value (Shift = one axis; snaps to frames and, with snapping on, to the playhead and other keyframes), drag a
// handle to shape the curve (Alt = break the tangents), drag empty space to box-select, double-click a curve to add
// a keyframe, drag the ruler to scrub. Wheel = scroll, Ctrl / Alt + wheel = zoom time, Shift + wheel = zoom values,
// middle button = pan.
// Keys: F = fit all, Shift+F = fit the selection, F9 = easy ease, Shift+F9 = easy ease in, Ctrl+Shift+F9 = easy ease
// out, Ctrl+C / Ctrl+V = copy / paste at the playhead, Delete = remove, Ctrl+A = select all, arrows = nudge.
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import * as M from "./model.js";
import * as K from "./keyframes.js";
import { EASE_LABEL } from "./inspector.js";
import { propLabel } from "./props.js";

const COLORS = ["#ff6b6b", "#4fc3f7", "#9ccc65", "#ffca28", "#ce93d8", "#ff8a65", "#4db6ac", "#f48fb1", "#90a4ae", "#c5e1a5"];
const RULER = 20;
const HIT = 7;
let clipboard = null; // { [path]: keys (times relative to the first copied keyframe) }, shared by all scenes

const niceStep = (raw) => {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const fmt = (v) => String(Math.round(v * 1000) / 1000);

export function createGraphEditor(ui) {
  const S = ui.state;
  const canvas = h("canvas.of-scene-graph__canvas", { "aria-hidden": "true" });
  const box = h("div.of-scene-graph__canvasbox", canvas);
  const props = h("div.of-scene-graph__props", { role: "list", "aria-label": t("Animated properties") });
  const bar = h("div.of-scene-graph__bar", { role: "toolbar", "aria-label": t("Graph editor") });
  const el = h("div.of-scene-graph", { tabindex: "0", role: "region", "aria-label": t("Graph editor") }, bar, h("div.of-scene-graph__body", props, box));
  const ctx = canvas.getContext("2d");
  const view = { t0: 0, px: 100, v0: -0.1, vpx: 100, mode: "value", normalize: true };
  const hidden = new Set();
  let sel = new Set(); // `${path}|${local time × 1e4}` of the selected keyframes
  let draft = null; // sequence shown while a gesture is in progress
  let marquee = null;
  let frozen = null; // normalization ranges kept still during a gesture
  let W = 0;
  let H = 0;
  let dpr = 1;

  // ------------------------------------------------------------------------------------------- data
  const seq = () => draft || ui.seqModel();
  const clipId = () => ui.selection()[0] || null;
  const clip = () => (clipId() ? seq().clips[clipId()] || null : null);
  const kkey = (path, k) => `${path}|${Math.round(k.t * 1e4)}`;
  const trackOf = (c, path) => M.propValue(c, path);
  const labelOf = (c, path) => propLabel(c, path);
  function curves() {
    const c = clip();
    if (!c) return [];
    return M.animatedPaths(c).map((path, i) => {
      const track = trackOf(c, path);
      return { path, track, color: COLORS[i % COLORS.length], numeric: track.kf.every((k) => typeof k.v === "number"), visible: !hidden.has(path) };
    });
  }
  const shown = () => curves().filter((cv) => cv.visible && cv.numeric);
  // selected keyframe indices per path of the current clip
  function selection() {
    const out = new Map();
    for (const cv of curves()) {
      const idx = cv.track.kf.map((k, i) => (sel.has(kkey(cv.path, k)) ? i : -1)).filter((i) => i >= 0);
      if (idx.length) out.set(cv.path, idx);
    }
    return out;
  }

  // per-curve value range (normalized view) or speed range (speed graph)
  function rangeOf(cv, c) {
    if (view.mode === "speed") {
      let mx = 0;
      const n = 160;
      for (let i = 0; i <= n; i++) mx = Math.max(mx, Math.abs(K.speedAt(cv.track, (c.dur * i) / n)));
      return mx > 1e-9 ? { lo: -mx * 1.1, hi: mx * 1.1 } : { lo: -1, hi: 1 };
    }
    let lo = Infinity;
    let hi = -Infinity;
    cv.track.kf.forEach((k, i) => {
      lo = Math.min(lo, k.v);
      hi = Math.max(hi, k.v);
      const tg = K.tangentsOf(cv.track, i);
      for (const [side, d] of [["in", -1], ["out", 1]]) {
        const g = tg?.[side];
        const nb = cv.track.kf[i + d];
        if (!g || !nb) continue;
        const hv = k.v + d * g[0] * g[1] * Math.abs(nb.t - k.t);
        lo = Math.min(lo, hv);
        hi = Math.max(hi, hv);
      }
    });
    if (!(hi - lo > 1e-9)) return { lo: lo - 0.5, hi: hi + 0.5 };
    return { lo, hi };
  }
  function ranges() {
    if (frozen) return frozen;
    const c = clip();
    const out = new Map();
    if (c) for (const cv of curves()) if (cv.numeric) out.set(cv.path, rangeOf(cv, c));
    return out;
  }
  // value (or speed) ↔ the vertical axis: normalized curves share 0..1, otherwise real units
  const norm = (rg, path, v) => {
    if (!view.normalize) return v;
    const r = rg.get(path);
    return r ? (v - r.lo) / (r.hi - r.lo) : v;
  };
  const unitsPerNorm = (rg, path) => (view.normalize ? (rg.get(path)?.hi ?? 1) - (rg.get(path)?.lo ?? 0) : 1);
  const denorm = (rg, path, n) => (view.normalize ? (rg.get(path)?.lo ?? 0) + n * unitsPerNorm(rg, path) : n);
  const tx = (T) => (T - view.t0) * view.px;
  const xt = (x) => view.t0 + x / view.px;
  const ny = (n) => H - (n - view.v0) * view.vpx;
  const yn = (y) => view.v0 + (H - y) / view.vpx;

  // the speed shown at a keyframe (speed graph): the leaving side, or the entering one at the end
  const keySpeed = (track, i) => {
    if (track.kf[i].e === "hold") return 0;
    const tg = K.tangentsOf(track, i);
    return tg?.out ? tg.out[0] : tg?.in ? tg.in[0] : 0;
  };
  // handle positions of keyframe i: { in: [T, y], out: [T, y] } in timeline seconds and pixels
  function handles(c, cv, i, rg) {
    const tr = cv.track;
    const k = tr.kf[i];
    const tg = K.tangentsOf(tr, i);
    if (!tg) return {};
    const out = {};
    for (const [side, d] of [["in", -1], ["out", 1]]) {
      const g = tg[side];
      const nb = tr.kf[i + d];
      if (!g || !nb || (side === "out" && k.e === "hold") || (side === "in" && nb.e === "hold")) continue;
      const span = Math.abs(nb.t - k.t);
      const T = c.start + k.t + d * g[1] * span;
      const y = view.mode === "speed" ? ny(norm(rg, cv.path, g[0])) : ny(norm(rg, cv.path, k.v + d * g[0] * g[1] * span));
      out[side] = [T, y];
    }
    return out;
  }
  const keyY = (cv, i, rg) => ny(norm(rg, cv.path, view.mode === "speed" ? keySpeed(cv.track, i) : cv.track.kf[i].v));

  // ------------------------------------------------------------------------------------------- toolbar
  const fields = {};
  const numField = (name, label, step, apply) => {
    const inp = h("input.of-scene-insp__num", { type: "number", step: String(step), "aria-label": t(label), title: t(label) });
    inp.addEventListener("change", () => Number.isFinite(+inp.value) && inp.value !== "" && apply(+inp.value));
    fields[name] = inp;
    return h("label", h("span", t(label)), inp);
  };
  const tbtn = (label, fn, icon) => {
    const b = h("button.of-scene-insp__btn", { type: "button", title: t(label), "aria-label": t(label) }, icon ? h("sl-icon", { name: icon }) : t(label));
    b.addEventListener("click", () => {
      fn();
      el.focus({ preventScroll: true });
    });
    return b;
  };
  const modeSel = h("select.of-scene-insp__sel", { "aria-label": t("Graph") }, h("option", { value: "value" }, t("Value graph")), h("option", { value: "speed" }, t("Speed graph")));
  modeSel.addEventListener("change", () => {
    view.mode = modeSel.value;
    api.fit();
  });
  const normBox = h("input", { type: "checkbox" });
  normBox.checked = true;
  normBox.addEventListener("change", () => {
    view.normalize = normBox.checked;
    api.fit();
  });
  const easeSel = h("select.of-scene-insp__sel", { "aria-label": t("Easing") }, h("option", { value: "" }, t("Easing…")), ...K.EASING_PRESETS.map((n) => h("option", { value: n }, t(EASE_LABEL[n] || n))), h("option", { value: "custom" }, t("Custom cubic-bezier…")));
  easeSel.addEventListener("change", async () => {
    const v = easeSel.value;
    easeSel.value = "";
    if (v === "custom") {
      const s = await ui.prompt(t("Cubic-bezier: x1, y1, x2, y2 (as in CSS)"), "0.25, 0.1, 0.25, 1");
      const arr = String(s || "").split(/[\s,]+/).filter(Boolean).map(Number);
      if (arr.length === 4 && arr.every(Number.isFinite)) applyEasing(arr);
      else if (s) ui.toast(t("Enter four numbers, for example 0.25, 0.1, 0.25, 1."));
    } else if (v) applyEasing(v);
    el.focus({ preventScroll: true });
  });
  const brokenBox = h("input", { type: "checkbox" });
  brokenBox.addEventListener("change", () => editSelected("Break Tangents", (tr, idx) => idx.reduce((acc, i) => K.setTangents(acc, i, { broken: brokenBox.checked }), tr)));
  bar.append(
    modeSel,
    h("label", normBox, t("Normalize")),
    h("span.of-scene-strip__sep"),
    tbtn(N_("Linear"), () => applyEasing("linear")),
    tbtn(N_("Easy ease (F9)"), () => applyEasing("easyEase")),
    tbtn(N_("Hold"), () => applyEasing("hold")),
    easeSel,
    h("label", brokenBox, t("Broken")),
    h("span.of-scene-strip__sep"),
    numField("time", N_("Time (s)"), 0.04, (v) => setNumeric({ time: v })),
    numField("value", N_("Value"), 0.1, (v) => setNumeric({ value: v })),
    numField("inS", N_("In speed"), 0.1, (v) => setNumeric({ inS: v })),
    numField("inF", N_("In influence (%)"), 1, (v) => setNumeric({ inF: v })),
    numField("outS", N_("Out speed"), 0.1, (v) => setNumeric({ outS: v })),
    numField("outF", N_("Out influence (%)"), 1, (v) => setNumeric({ outF: v })),
    h("span.of-scene-strip__grow"),
    tbtn(N_("Copy keyframes (Ctrl+C)"), () => copy(), "copy"),
    tbtn(N_("Paste keyframes at the playhead (Ctrl+V)"), () => paste(), "clipboard"),
    tbtn(N_("Fit the selection (Shift+F)"), () => api.fit(true), "arrows-angle-contract"),
    tbtn(N_("Fit all (F)"), () => api.fit(), "aspect-ratio"));

  function syncFields() {
    const c = clip();
    const s = selection();
    const one = s.size === 1 && [...s.values()][0].length === 1 ? { path: [...s.keys()][0], i: [...s.values()][0][0] } : null;
    const tr = one && c ? trackOf(c, one.path) : null;
    const k = tr?.kf[one.i];
    const tg = k ? K.tangentsOf(tr, one.i) : null;
    const set = (name, v) => {
      const inp = fields[name];
      inp.disabled = v === null || v === undefined;
      if (document.activeElement !== inp) inp.value = inp.disabled ? "" : fmt(v);
    };
    set("time", k ? c.start + k.t : null);
    set("value", typeof k?.v === "number" ? k.v : null);
    set("inS", tg?.in?.[0]);
    set("inF", tg?.in ? tg.in[1] * 100 : null);
    set("outS", tg?.out?.[0]);
    set("outF", tg?.out ? tg.out[1] * 100 : null);
    brokenBox.disabled = !s.size;
    brokenBox.checked = !!tg?.broken;
  }

  // ------------------------------------------------------------------------------------------- property list
  let propsKey = "";
  function renderProps() {
    const c = clip();
    const list = curves();
    const key = (c ? c.id : "") + list.map((cv) => cv.path + cv.visible).join();
    if (key === propsKey) return;
    propsKey = key;
    if (!c) return props.replaceChildren(h("p.of-scene-insp__hint", { style: "padding:6px 8px" }, t("Select a clip.")));
    if (!list.length) return props.replaceChildren(h("p.of-scene-insp__hint", { style: "padding:6px 8px" }, t("This clip has no keyframes. Use the diamond next to a property in Properties to animate it.")));
    props.replaceChildren(...list.map((cv) => {
      const cb = h("input", { type: "checkbox", "aria-label": t("Show") });
      cb.checked = cv.visible;
      cb.disabled = !cv.numeric;
      cb.addEventListener("change", () => {
        if (cb.checked) hidden.delete(cv.path);
        else hidden.add(cv.path);
        ui.requestDraw();
      });
      const name = h("button", { type: "button", title: cv.numeric ? t("Select all keyframes of this property") : t("Colors are edited in Properties") }, labelOf(c, cv.path));
      name.addEventListener("click", () => {
        sel = new Set(cv.track.kf.map((k) => kkey(cv.path, k)));
        ui.requestDraw();
      });
      return h("div.of-scene-graph__prop", { role: "listitem", "data-off": String(!cv.visible || !cv.numeric) }, cb, h("i", { style: `background:${cv.color}` }), name);
    }));
  }

  // ------------------------------------------------------------------------------------------- editing
  function commitDraft(label, next) {
    if (next && next !== ui.seqModel()) ui.commitSeq(label, next);
  }
  // fn(track, indices, path) → track for every path with selected keyframes
  function editSelected(label, fn) {
    const c = clip();
    if (!c) return;
    let m = ui.seqModel();
    for (const [path, idx] of selection()) m = M.editKeyframes(m, c.id, path, (tr) => fn(tr, idx, path));
    commitDraft(label, m);
    ui.requestDraw();
  }
  function applyEasing(preset) {
    if (!selection().size) return ui.toast(t("Select keyframes first."));
    try {
      editSelected("Change Easing", (tr, idx) => K.applyEasing(tr, idx, preset));
    } catch (err) {
      ui.toast(err.message);
    }
  }
  function removeSelected() {
    const c = clip();
    if (!c || !selection().size) return;
    let m = ui.seqModel();
    for (const [path, idx] of selection()) {
      const cur = m.clips[c.id];
      const tr = trackOf(cur, path);
      const next = K.removeKeys(tr, idx);
      // removing every keyframe leaves a constant (the property is no longer animated)
      m = K.isTrack(next) ? M.editKeyframes(m, c.id, path, () => next) : M.setProp(m, c.id, path, next);
    }
    sel = new Set();
    commitDraft("Remove Keyframes", m);
  }
  function setNumeric(o) {
    const c = clip();
    const s = selection();
    if (!c || s.size !== 1) return;
    const [path, idx] = [...s][0];
    if (idx.length !== 1) return;
    const i = idx[0];
    const tr = trackOf(c, path);
    const k = tr.kf[i];
    let m = ui.seqModel();
    if (o.time !== undefined) {
      const local = Math.max(0, Math.min(c.dur, M.snapT(m, o.time) - c.start));
      const r = K.moveKeys(tr, [i], local - k.t, 0);
      m = M.editKeyframes(m, c.id, path, () => r.track);
      sel = new Set([kkey(path, r.track.kf[r.idx[0]])]);
    } else if (o.value !== undefined) m = M.editKeyframes(m, c.id, path, (x) => K.moveKeys(x, [i], 0, o.value - k.v).track);
    else {
      const tg = K.tangentsOf(tr, i) || {};
      const side = o.inS !== undefined || o.inF !== undefined ? "in" : "out";
      const cur = tg[side];
      if (!cur) return;
      const g = [o[`${side}S`] ?? cur[0], (o[`${side}F`] ?? cur[1] * 100) / 100];
      m = M.editKeyframes(m, c.id, path, (x) => K.setTangents(x, i, { [side]: g }));
    }
    commitDraft("Change Keyframe", m);
  }
  function copy() {
    const c = clip();
    const s = selection();
    if (!c || !s.size) return;
    // times relative to the earliest selected keyframe of all properties, so the timing between them survives
    const t0 = Math.min(...[...s].map(([path, idx]) => trackOf(c, path).kf[idx[0]].t));
    clipboard = {};
    for (const [path, idx] of s) {
      const tr = trackOf(c, path);
      const shift = tr.kf[[...idx].sort((a, b) => a - b)[0]].t - t0;
      clipboard[path] = K.copyKeys(tr, idx).map((k) => ({ ...k, t: k.t + shift }));
    }
  }
  function paste() {
    const c = clip();
    if (!c || !clipboard) return;
    let m = ui.seqModel();
    const paths = Object.keys(clipboard);
    // one copied property pastes into the one selected property even when the names differ (x → y, …)
    const target = paths.length === 1 && selection().size === 1 ? [...selection().keys()][0] : null;
    try {
      for (const path of paths) m = M.pasteKeyframes(m, c.id, target || path, clipboard[path], S.t);
    } catch (err) {
      return ui.toast(err.message);
    }
    commitDraft("Paste Keyframes", m);
  }
  function nudge(frames, units) {
    const c = clip();
    if (!c || !selection().size) return;
    const rg = ranges();
    let m = ui.seqModel();
    const moved = new Set();
    for (const [path, idx] of selection()) {
      const dv = view.mode === "value" ? units * unitsPerNorm(rg, path) * (view.normalize ? 0.01 : 1) : 0;
      const dt = frames / m.fps;
      m = M.editKeyframes(m, c.id, path, (tr) => {
        const r = K.moveKeys(tr, idx, dt, dv);
        for (const j of r.idx) moved.add(kkey(path, r.track.kf[j]));
        return r.track;
      });
    }
    sel = moved;
    commitDraft("Move Keyframes", m);
  }

  // ------------------------------------------------------------------------------------------- drawing
  const css = (name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

  function draw() {
    const rect = box.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (W !== Math.round(rect.width) || H !== Math.round(rect.height) || canvas.width !== Math.round(rect.width * dpr)) {
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    renderProps();
    syncFields();
    const m = seq();
    const c = clip();
    const col = { bg: css("--of-bg-panel", "#1d1f23"), out: css("--of-bg-app", "#16181b"), line: css("--of-border-soft", "#2c2f36"), text: css("--of-text-muted", "#9aa3b2"), sel: css("--of-accent", "#f59e0b") };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    if (c) {
      // outside the clip
      ctx.fillStyle = col.out;
      ctx.fillRect(0, RULER, Math.max(0, tx(c.start)), H);
      ctx.fillRect(tx(c.start + c.dur), RULER, W, H);
    }
    // horizontal grid with value labels (percent of each curve's range when normalized)
    const vstep = niceStep(60 / view.vpx);
    for (let v = Math.floor(yn(H) / vstep) * vstep; v <= yn(RULER); v += vstep) {
      const y = Math.round(ny(v)) + 0.5;
      ctx.fillStyle = col.line;
      ctx.fillRect(0, y, W, 1);
      ctx.fillStyle = col.text;
      ctx.fillText(view.normalize ? `${Math.round(v * 100)} %` : fmt(v), 4, y - 7);
    }
    // time grid and ruler
    const steps = [1 / m.fps, 2 / m.fps, 5 / m.fps, 10 / m.fps, 0.5, 1, 2, 5, 10, 30, 60];
    const tstep = steps.find((s) => s * view.px >= 70) || 60;
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, W, RULER);
    for (let T = Math.max(0, Math.floor(xt(0) / tstep) * tstep); T < xt(W); T += tstep) {
      const x = Math.round(tx(T)) + 0.5;
      ctx.fillStyle = col.line;
      ctx.fillRect(x, RULER, 1, H);
      ctx.fillStyle = col.text;
      ctx.fillText(M.timecode(m, T).slice(3), x + 3, RULER / 2);
    }
    ctx.fillStyle = col.line;
    ctx.fillRect(0, RULER - 1, W, 1);
    if (!c || !shown().length) {
      ctx.fillStyle = col.text;
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(c ? t("No animated number properties on this clip.") : t("Select a clip with keyframes to see its curves."), W / 2, H / 2);
      ctx.textAlign = "start";
    } else {
      const rg = ranges();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER, W, H - RULER);
      ctx.clip();
      for (const cv of shown()) drawCurve(c, cv, rg, col);
      ctx.restore();
    }
    if (marquee) {
      const [x0, y0, x1, y1] = marquee;
      ctx.fillStyle = "rgba(120, 160, 255, 0.16)";
      ctx.strokeStyle = "rgba(120, 160, 255, 0.9)";
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    const px = Math.round(tx(S.t)) + 0.5;
    ctx.fillStyle = "#ff4d4f";
    ctx.fillRect(px - 0.5, 0, 1, H);
  }

  function drawCurve(c, cv, rg, col) {
    const tr = cv.track;
    const local = (T) => T - c.start;
    const a = Math.max(0, tx(c.start));
    const b = Math.min(W, tx(c.start + c.dur));
    ctx.strokeStyle = cv.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = a; x <= b + 1; x += 2) {
      const T = local(xt(Math.min(x, b)));
      const v = view.mode === "speed" ? K.speedAt(tr, T) : K.valueAt(tr, T);
      const y = ny(norm(rg, cv.path, v));
      if (x === a) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    tr.kf.forEach((k, i) => {
      const x = tx(c.start + k.t);
      const y = keyY(cv, i, rg);
      const on = sel.has(kkey(cv.path, k));
      if (on) {
        const hd = handles(c, cv, i, rg);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1;
        for (const side of ["in", "out"]) {
          if (!hd[side]) continue;
          const hx = tx(hd[side][0]);
          const hy = hd[side][1];
          ctx.beginPath();
          ctx.moveTo(x, view.mode === "speed" ? hy : y);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = k.b ? "#ffffff" : cv.color;
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = on ? col.sel : col.bg;
      ctx.strokeStyle = on ? "#fff" : cv.color;
      ctx.lineWidth = 1.5;
      if (k.e === "hold") {
        ctx.fillRect(-4, -4, 8, 8);
        ctx.strokeRect(-4, -4, 8, 8);
      } else {
        ctx.fillRect(-3.5, -3.5, 7, 7);
        ctx.strokeRect(-3.5, -3.5, 7, 7);
      }
      ctx.restore();
    });
  }

  // ------------------------------------------------------------------------------------------- hit testing
  function hit(x, y) {
    const c = clip();
    if (!c) return null;
    const rg = ranges();
    const list = shown();
    for (const cv of list) {
      for (let i = 0; i < cv.track.kf.length; i++) {
        if (!sel.has(kkey(cv.path, cv.track.kf[i]))) continue;
        const hd = handles(c, cv, i, rg);
        for (const side of ["in", "out"]) if (hd[side] && Math.hypot(tx(hd[side][0]) - x, hd[side][1] - y) <= HIT) return { kind: "handle", path: cv.path, i, side };
      }
    }
    for (const cv of list) {
      for (let i = cv.track.kf.length - 1; i >= 0; i--) if (Math.abs(tx(c.start + cv.track.kf[i].t) - x) <= HIT && Math.abs(keyY(cv, i, rg) - y) <= HIT) return { kind: "key", path: cv.path, i };
    }
    return null;
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // snaps a timeline time to the frame grid and, with snapping on, to the playhead, markers and other keyframes
  function snapTime(T, skip) {
    const m = seq();
    let best = M.snapT(m, T);
    if (!S.snap) return best;
    const c = clip();
    const pts = [S.t, ...m.markers.map((k) => k.t)];
    if (c) for (const cv of shown()) for (const k of cv.track.kf) if (!skip.has(kkey(cv.path, k))) pts.push(c.start + k.t);
    let d = 8 / view.px;
    for (const p of pts) if (Math.abs(p - T) < d) {
      d = Math.abs(p - T);
      best = p;
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    el.focus({ preventScroll: true });
    const [x0, y0] = point(e);
    const c = clip();
    const m0 = ui.seqModel();
    canvas.setPointerCapture(e.pointerId);
    let move = null;
    let label = "";
    let after = null;
    const up = (ev) => {
      canvas.releasePointerCapture(ev.pointerId);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      const d = draft;
      draft = null;
      marquee = null;
      frozen = null;
      if (ev.type === "pointerup" && d && d !== m0) {
        ui.commitSeq(label, d);
        after?.();
      }
      ui.requestDraw();
    };
    const onMove = (ev) => {
      const [x, y] = point(ev);
      move?.(x, y, ev);
      ui.requestDraw();
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    if (y0 < RULER) {
      const scrub = (x) => ui.seek(snapTime(xt(x), new Set()), { scrub: true });
      scrub(x0);
      move = (x) => scrub(x);
      return;
    }
    const target = e.button === 0 ? hit(x0, y0) : null;
    if (e.button === 1 || (e.altKey && !target)) {
      const t0 = view.t0;
      const v0 = view.v0;
      move = (x, y) => {
        view.t0 = t0 - (x - x0) / view.px;
        view.v0 = v0 + (y - y0) / view.vpx;
      };
      return;
    }
    if (!c) return;
    frozen = ranges();
    const rg = frozen;
    if (target?.kind === "handle") {
      const tr0 = trackOf(c, target.path);
      const k = tr0.kf[target.i];
      const nb = tr0.kf[target.i + (target.side === "in" ? -1 : 1)];
      const span = Math.abs(nb.t - k.t);
      const kT = c.start + k.t;
      label = N_("Change Tangent");
      move = (x, y, ev) => {
        const T = xt(x);
        const dtp = Math.max(1e-4, target.side === "out" ? T - kT : kT - T);
        const f = Math.max(0.001, Math.min(1, dtp / span));
        const v = denorm(rg, target.path, yn(y));
        const s = view.mode === "speed" ? v : target.side === "out" ? (v - k.v) / dtp : (k.v - v) / dtp;
        draft = M.editKeyframes(m0, c.id, target.path, (tr) => K.setTangents(tr, target.i, { [target.side]: [s, f], ...(ev.altKey ? { broken: true } : {}) }));
      };
      return;
    }
    if (target?.kind === "key") {
      const k = trackOf(c, target.path).kf[target.i];
      const id = kkey(target.path, k);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
        sel = new Set(sel);
      } else if (!sel.has(id)) sel = new Set([id]);
      if (!sel.has(id)) return;
      const s = selection();
      const kT = c.start + k.t;
      let lo = Infinity;
      let hi = -Infinity;
      for (const [path, idx] of s) for (const i of idx) {
        lo = Math.min(lo, trackOf(c, path).kf[i].t);
        hi = Math.max(hi, trackOf(c, path).kf[i].t);
      }
      label = N_("Move Keyframes");
      let moved = sel;
      move = (x, y, ev) => {
        let dx = x - x0;
        let dy = y - y0;
        if (!draft && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        if (ev.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        if (view.mode === "speed") dy = 0;
        let dt = dx ? snapTime(kT + dx / view.px, sel) - kT : 0;
        dt = Math.max(-lo, Math.min(c.dur - hi, dt));
        let next = m0;
        const nowSel = new Set();
        for (const [path, idx] of s) {
          const dv = (-dy / view.vpx) * unitsPerNorm(rg, path);
          next = M.editKeyframes(next, c.id, path, (tr) => {
            const r = K.moveKeys(tr, idx, dt, dv);
            for (const j of r.idx) nowSel.add(kkey(path, r.track.kf[j]));
            return r.track;
          });
        }
        draft = next;
        moved = nowSel;
      };
      after = () => (sel = moved);
      return;
    }
    // empty space: box selection
    const keep = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(sel) : new Set();
    sel = keep;
    move = (x, y) => {
      marquee = [x0, y0, x, y];
      const [xa, xb] = [Math.min(x0, x), Math.max(x0, x)];
      const [ya, yb] = [Math.min(y0, y), Math.max(y0, y)];
      const next = new Set(keep);
      for (const cv of shown()) cv.track.kf.forEach((k, i) => {
        const kx = tx(c.start + k.t);
        const ky = keyY(cv, i, rg);
        if (kx >= xa && kx <= xb && ky >= ya && ky <= yb) next.add(kkey(cv.path, k));
      });
      sel = next;
    };
  });

  canvas.addEventListener("dblclick", (e) => {
    const c = clip();
    if (!c) return;
    const [x, y] = point(e);
    const target = hit(x, y);
    if (target?.kind === "key") return ui.seek(c.start + trackOf(c, target.path).kf[target.i].t);
    // add a keyframe on the nearest curve at this time
    const T = M.snapT(seq(), xt(x));
    if (T < c.start || T > c.start + c.dur) return;
    const rg = ranges();
    let best = null;
    for (const cv of shown()) {
      const v = K.valueAt(cv.track, T - c.start);
      const d = Math.abs(ny(norm(rg, cv.path, view.mode === "speed" ? K.speedAt(cv.track, T - c.start) : v)) - y);
      if (d < 24 && (!best || d < best.d)) best = { d, cv, v };
    }
    if (!best) return;
    commitDraft("Add Keyframe", M.setKeyframe(ui.seqModel(), c.id, best.cv.path, T, best.v));
    sel = new Set([`${best.cv.path}|${Math.round((T - c.start) * 1e4)}`]);
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = point(e);
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const T = xt(x);
      view.px = Math.max(2, Math.min(20000, view.px * Math.pow(1.0015, -e.deltaY)));
      view.t0 = T - x / view.px;
    } else if (e.shiftKey) {
      const n = yn(y);
      view.vpx = Math.max(1e-6, Math.min(1e7, view.vpx * Math.pow(1.0015, -e.deltaY)));
      view.v0 = n - (H - y) / view.vpx;
    } else {
      view.t0 += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0) / view.px;
      view.v0 -= (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY) / view.vpx;
    }
    ui.requestDraw();
  }, { passive: false });

  el.addEventListener("keydown", (e) => {
    const target = e.target;
    if (target !== el && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === "F9") return done(), applyEasing(mod && e.shiftKey ? "easyEaseOut" : e.shiftKey ? "easyEaseIn" : "easyEase");
    if (mod && key === "c") return done(), copy();
    if (mod && key === "v") return done(), paste();
    if (mod && key === "a") {
      done();
      sel = new Set(shown().flatMap((cv) => cv.track.kf.map((k) => kkey(cv.path, k))));
      return ui.requestDraw();
    }
    if (mod) return;
    if (key === "Delete" || key === "Backspace") return done(), removeSelected();
    if (key === "f") return done(), api.fit(e.shiftKey);
    if (key === "Escape" && sel.size) {
      done();
      sel = new Set();
      return ui.requestDraw();
    }
    if (sel.size && /^Arrow/.test(key)) {
      done();
      const big = e.shiftKey ? 10 : 1;
      if (key === "ArrowLeft") nudge(-big, 0);
      else if (key === "ArrowRight") nudge(big, 0);
      else nudge(0, key === "ArrowUp" ? big : -big);
    }
  });

  const ro = new ResizeObserver(() => ui.requestDraw());
  ro.observe(box);

  const api = {
    el,
    draw,
    /** Shows only one property's curve (the others are hidden, not removed), selects its keyframes and fits. */
    solo(path) {
      const c = clip();
      if (!c || !path) return;
      hidden.clear();
      for (const cv of curves()) if (cv.path !== path) hidden.add(cv.path);
      sel = new Set(curves().filter((cv) => cv.path === path).flatMap((cv) => cv.track.kf.map((k) => kkey(path, k))));
      requestAnimationFrame(() => api.fit());
    },
    /** Zooms so every visible curve (or the selected keyframes) fits. */
    fit(selected = false) {
      const c = clip();
      const rect = box.getBoundingClientRect();
      W = Math.round(rect.width) || W;
      H = Math.round(rect.height) || H;
      if (!c || W < 10 || H < 40) return ui.requestDraw();
      const rg = ranges();
      let ta = c.start;
      let tb = c.start + c.dur;
      let lo = Infinity;
      let hi = -Infinity;
      const s = selected ? selection() : null;
      if (s?.size) {
        ta = Infinity;
        tb = -Infinity;
      }
      for (const cv of shown()) {
        const idx = s?.size ? s.get(cv.path) || [] : cv.track.kf.map((_, i) => i);
        for (const i of idx) {
          const k = cv.track.kf[i];
          const n = norm(rg, cv.path, view.mode === "speed" ? keySpeed(cv.track, i) : k.v);
          lo = Math.min(lo, n);
          hi = Math.max(hi, n);
          if (s?.size) {
            ta = Math.min(ta, c.start + k.t);
            tb = Math.max(tb, c.start + k.t);
          }
        }
        if (!s?.size && view.mode === "speed") {
          lo = Math.min(lo, norm(rg, cv.path, rg.get(cv.path).lo));
          hi = Math.max(hi, norm(rg, cv.path, rg.get(cv.path).hi));
        }
        if (!s?.size) {
          // the curve itself may overshoot between keyframes
          for (let j = 0; j <= 100; j++) {
            const lt = (c.dur * j) / 100;
            const n = norm(rg, cv.path, view.mode === "speed" ? K.speedAt(cv.track, lt) : K.valueAt(cv.track, lt));
            lo = Math.min(lo, n);
            hi = Math.max(hi, n);
          }
        }
      }
      if (!(hi >= lo)) {
        lo = 0;
        hi = 1;
      }
      if (hi - lo < 1e-6) {
        lo -= 0.5;
        hi += 0.5;
      }
      const span = Math.max(tb - ta, 4 / seq().fps);
      view.px = (W - 60) / span;
      view.t0 = ta - 30 / view.px;
      view.vpx = (H - RULER - 40) / (hi - lo);
      view.v0 = lo - 20 / view.vpx;
      ui.requestDraw();
    },
    destroy() {
      ro.disconnect();
    },
  };
  return api;
}
