// Scene Studio inspector (right panel): properties of the selected clip, or of the sequence when nothing is
// selected. Every animatable row has a keyframe button (diamond): off = constant value; on = the property is
// animated and edits write a keyframe at the playhead (docs/scene-studio.md ▸ Animation).
//
//   createInspector(ui) → { el, render() }      `ui` = the workspace (scene/view.js)
// Invariant: render() never steals focus from a field the user is typing in (the panel is rebuilt only when the
// selection, the clip's shape or the playhead keyframe state changes; plain value changes update fields in place).
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import * as M from "./model.js";
import { valueAt, isTrack, EASING_PRESETS } from "./keyframes.js";
import { EFFECTS, effectParams } from "./effects.js";

const r2 = (v) => Math.round(v * 100) / 100;

export function createInspector(ui) {
  const el = h("div.of-scene-insp", { role: "region", "aria-label": t("Properties") });
  let shape = ""; // structure key of what is rendered
  let updaters = []; // functions that refresh field values in place

  const section = (title, ...rows) => h("section.of-scene-insp__sec", h("h3", t(title)), ...rows.filter(Boolean));
  const row = (label, ...controls) => h("label.of-scene-insp__row", h("span", t(label)), h("div.of-scene-insp__ctl", ...controls));

  function num({ get, set, min = -Infinity, max = Infinity, step = 1, unit = "", scale = 1 }) {
    const inp = h("input.of-scene-insp__num", { type: "number", step: String(step), ...(Number.isFinite(min) ? { min: String(min) } : {}), ...(Number.isFinite(max) ? { max: String(max) } : {}) });
    const show = () => {
      if (document.activeElement !== inp) inp.value = String(r2(get() * scale));
    };
    inp.addEventListener("change", () => {
      const v = +inp.value;
      if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v)) / scale);
    });
    updaters.push(show);
    show();
    return unit ? h("span.of-scene-insp__unit", inp, h("i", unit)) : inp;
  }

  function slider({ get, set, min, max, step }) {
    const inp = h("input.of-scene-insp__range", { type: "range", min: String(min), max: String(max), step: String(step) });
    const show = () => {
      if (document.activeElement !== inp) inp.value = String(get());
    };
    inp.addEventListener("input", () => set(+inp.value));
    updaters.push(show);
    show();
    return inp;
  }

  function color({ get, set, none = false }) {
    const inp = h("input.of-scene-insp__color", { type: "color" });
    const show = () => (inp.value = get() || "#000000");
    inp.addEventListener("input", () => set(inp.value));
    updaters.push(show);
    show();
    if (!none) return inp;
    const off = h("input", { type: "checkbox", title: t("On"), "aria-label": t("On") });
    const sync = () => {
      off.checked = !!get();
      inp.disabled = !off.checked;
    };
    off.addEventListener("change", () => set(off.checked ? inp.value : null));
    updaters.push(sync);
    sync();
    return h("span.of-scene-insp__pair", off, inp);
  }

  function select({ get, set, options }) {
    const sel = h("select.of-scene-insp__sel", options.map((o) => h("option", { value: String(o.value ?? o) }, o.label ? t(o.label) : String(o))));
    const show = () => (sel.value = String(get()));
    sel.addEventListener("change", () => set(sel.value));
    updaters.push(show);
    show();
    return sel;
  }

  // keyframe button of an animatable path, with previous / next keyframe navigation when animated
  function keyBtn(id, path, read) {
    const b = h("button.of-scene-insp__key", { type: "button", title: t("Animate: add or remove a keyframe at the playhead"), "aria-label": t("Keyframe") }, h("span"));
    const sync = () => {
      const c = ui.seqModel().clips[id];
      if (!c) return;
      const v = read(c);
      const local = ui.state.t - c.start;
      const on = isTrack(v) && v.kf.some((k) => Math.abs(k.t - local) < 0.5 / ui.seqModel().fps);
      b.dataset.state = on ? "key" : isTrack(v) ? "anim" : "off";
      b.setAttribute("aria-pressed", String(on));
    };
    b.addEventListener("click", () => {
      const m = ui.seqModel();
      const c = m.clips[id];
      const v = read(c);
      const local = Math.max(0, Math.min(c.dur, ui.state.t - c.start));
      const has = isTrack(v) && v.kf.some((k) => Math.abs(k.t - local) < 0.5 / m.fps);
      if (has) ui.commitSeq("Remove Keyframe", M.removeKeyframe(m, id, path, c.start + local));
      else ui.commitSeq("Add Keyframe", M.setKeyframe(m, id, path, c.start + local, valueAt(v, local)));
    });
    updaters.push(sync);
    sync();
    return b;
  }

  const animRow = (id, label, path, read, o) =>
    row(label, num({ ...o, get: () => {
      const c = ui.seqModel().clips[id];
      return c ? valueAt(read(c), Math.max(0, Math.min(c.dur, ui.state.t - c.start))) : 0;
    }, set: (v) => ui.setProp(id, path, v) }), keyBtn(id, path, read));

  function clipPanel(c) {
    const id = c.id;
    const m = ui.seqModel();
    const clip = () => ui.seqModel().clips[id] || c;
    const upd = (patch, label = "Change Clip") => ui.commitSeq(label, M.updateClip(ui.seqModel(), id, patch), { coalesce: `scene:${id}:${Object.keys(patch).join()}` });
    const out = [];
    const name = h("input.of-scene-insp__text", { type: "text", value: c.name, "aria-label": t("Name") });
    name.addEventListener("change", () => upd({ name: name.value }, "Rename Clip"));
    out.push(section("Clip", row("Name", name),
      row("Start", num({ get: () => clip().start, set: (v) => ui.commitSeq("Move Clip", M.moveClip(ui.seqModel(), id, { start: v })), min: 0, step: 0.1, unit: "s" })),
      row("Duration", num({ get: () => clip().dur, set: (v) => ui.commitSeq("Trim Clip", M.trimClip(ui.seqModel(), id, "end", clip().start + v)), min: 0.04, step: 0.1, unit: "s" })),
      c.speed !== undefined && c.remap === undefined ? row("Speed", num({ get: () => clip().speed, set: (v) => ui.commitSeq("Change Speed", M.setSpeed(ui.seqModel(), id, v)), min: 5, max: 2000, step: 5, unit: "%", scale: 100 })) : null));

    if (c.type === "text") {
      const ta = h("textarea.of-scene-insp__area", { rows: "3", "aria-label": t("Text") });
      ta.value = c.text.text;
      ta.dataset.sceneText = id;
      ta.addEventListener("input", () => upd({ text: { text: ta.value } }, "Edit Text"));
      const tx = (k) => () => clip().text[k];
      const setT = (k) => (v) => upd({ text: { [k]: v } }, "Change Text Style");
      const font = h("input.of-scene-insp__text", { type: "text", value: c.text.font, list: "of-scene-fonts", "aria-label": t("Font") });
      font.addEventListener("change", () => setT("font")(font.value));
      const anim = (k) => select({ get: () => clip().text.anim[k], set: (v) => upd({ text: { anim: { [k]: v } } }, "Change Text Animation"), options: M.TEXT_ANIMS.map((a) => ({ value: a, label: ANIM_LABEL[a] })) });
      out.push(section("Text", ta,
        row("Font", font),
        row("Size", num({ get: tx("size"), set: setT("size"), min: 4, max: 2000 }), select({ get: tx("weight"), set: (v) => setT("weight")(+v), options: [300, 400, 500, 600, 700, 800, 900] })),
        row("Color", color({ get: tx("color"), set: setT("color") }), select({ get: tx("align"), set: setT("align"), options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }] })),
        row("Outline", color({ get: tx("stroke"), set: (v) => upd({ text: { stroke: v, strokeW: v ? clip().text.strokeW || 6 : 0 } }), none: true }), num({ get: tx("strokeW"), set: setT("strokeW"), min: 0, max: 200 })),
        row("Background", color({ get: tx("bg"), set: setT("bg"), none: true })),
        row("Line height", num({ get: tx("lineHeight"), set: setT("lineHeight"), min: 0.6, max: 4, step: 0.05 })),
        row("Letter spacing", num({ get: tx("tracking"), set: setT("tracking"), min: -50, max: 400 })),
        row("Wrap width", num({ get: tx("boxW"), set: setT("boxW"), min: 0, max: 16000, step: 10 })),
        row("Animate in", anim("in"), num({ get: () => clip().text.anim.inDur, set: (v) => upd({ text: { anim: { inDur: v } } }), min: 0.05, max: 20, step: 0.05, unit: "s" })),
        row("Animate out", anim("out"), num({ get: () => clip().text.anim.outDur, set: (v) => upd({ text: { anim: { outDur: v } } }), min: 0.05, max: 20, step: 0.05, unit: "s" }))));
    }
    if (c.type === "shape") {
      const sh = (k) => () => clip().shape[k];
      const setS = (k) => (v) => upd({ shape: { [k]: v } }, "Change Shape");
      out.push(section("Shape",
        row("Kind", select({ get: sh("kind"), set: setS("kind"), options: [{ value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }, { value: "line", label: "Line" }, { value: "polygon", label: "Polygon" }, { value: "star", label: "Star" }] })),
        row("Size", num({ get: sh("w"), set: setS("w"), min: 1, max: 16000 }), num({ get: sh("h"), set: setS("h"), min: 1, max: 16000 })),
        row("Fill", color({ get: sh("fill"), set: setS("fill"), none: true })),
        row("Outline", color({ get: sh("stroke"), set: (v) => upd({ shape: { stroke: v, strokeW: v ? clip().shape.strokeW || 6 : 0 } }), none: true }), num({ get: sh("strokeW"), set: setS("strokeW"), min: 0, max: 400 })),
        row("Corner radius", num({ get: sh("radius"), set: setS("radius"), min: 0, max: 8000 }))));
    }
    if (c.type === "solid") out.push(section("Solid", row("Color", color({ get: () => clip().color, set: (v) => upd({ color: v }, "Change Color") }))));
    if (c.type === "comp") {
      const check = (label, get, set) => {
        const cb = h("input", { type: "checkbox" });
        cb.checked = !!get();
        cb.addEventListener("change", () => set(cb.checked));
        return h("label.of-scene-insp__chk", cb, t(label));
      };
      out.push(section("Composition",
        h("div.of-scene-insp__btns", btn("Open composition", () => ui.openCompClip(id))),
        check("Collapse transformations", () => c.collapse, (on) => upd({ collapse: on }, "Collapse Transformations")),
        check("Time remapping", () => c.remap !== undefined, (on) => ui.commitSeq("Time Remapping", M.setTimeRemap(ui.seqModel(), id, on))),
        c.remap !== undefined ? animRow(id, "Source time", "remap", (k) => k.remap, { min: 0, step: 0.04, unit: "s" }) : null));
    }

    if (c.type !== "audio") {
      out.push(section("Transform",
        animRow(id, "Position X", "x", (k) => k.x, { step: 1 }),
        animRow(id, "Position Y", "y", (k) => k.y, { step: 1 }),
        row("Scale", num({ get: () => valueAt(clip().sx, Math.max(0, ui.state.t - clip().start)), set: (v) => ui.setProps(id, { sx: v, sy: v }), min: 0, max: 10000, step: 1, unit: "%", scale: 100 }), keyBtn(id, "sx", (k) => k.sx)),
        animRow(id, "Rotation", "rot", (k) => k.rot, { step: 1, unit: "°" }),
        animRow(id, "Opacity", "opacity", (k) => k.opacity, { min: 0, max: 100, step: 1, unit: "%", scale: 100 }),
        row("Blend mode", select({ get: () => clip().blend, set: (v) => upd({ blend: v }, "Change Blend Mode"), options: M.BLEND_MODES })),
        h("div.of-scene-insp__btns",
          btn("Fit", () => ui.fitClip(id, "fit")), btn("Fill", () => ui.fitClip(id, "fill")), btn("Center", () => ui.setProps(id, { x: m.width / 2, y: m.height / 2 })), btn("Reset", () => ui.setProps(id, { x: m.width / 2, y: m.height / 2, sx: 1, sy: 1, rot: 0, opacity: 1 })))));
      if (c.type === "video" || c.type === "image") {
        const cr = (k) => ({ get: () => clip().crop[k], set: (v) => upd({ crop: { [k]: v } }, "Crop"), min: 0, max: 99, step: 1, unit: "%", scale: 100 });
        out.push(section("Crop", row("Left / Right", num(cr("l")), num(cr("r"))), row("Top / Bottom", num(cr("t")), num(cr("b")))));
      }
      const mask = () => clip().mask;
      const setMask = (patch) => upd({ mask: patch === null ? null : { shape: "rect", x: 0, y: 0, w: 1, h: 1, feather: 0, invert: false, ...mask(), ...patch } }, "Change Mask");
      out.push(section("Mask",
        row("Shape", select({ get: () => mask()?.shape || "none", set: (v) => setMask(v === "none" ? null : { shape: v }), options: [{ value: "none", label: "None" }, { value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }] })),
        c.mask ? row("Position", num({ get: () => mask()?.x || 0, set: (v) => setMask({ x: v }), step: 1, unit: "%", scale: 100 }), num({ get: () => mask()?.y || 0, set: (v) => setMask({ y: v }), step: 1, unit: "%", scale: 100 })) : null,
        c.mask ? row("Size", num({ get: () => mask()?.w ?? 1, set: (v) => setMask({ w: v }), step: 1, unit: "%", scale: 100 }), num({ get: () => mask()?.h ?? 1, set: (v) => setMask({ h: v }), step: 1, unit: "%", scale: 100 })) : null,
        c.mask ? row("Feather", num({ get: () => mask()?.feather || 0, set: (v) => setMask({ feather: v }), min: 0, max: 500 }), h("label.of-scene-insp__chk", (() => {
          const cb = h("input", { type: "checkbox" });
          cb.checked = !!c.mask.invert;
          cb.addEventListener("change", () => setMask({ invert: cb.checked }));
          return cb;
        })(), t("Invert"))) : null));
      const trans = (edge) => {
        const key = edge === "in" ? "tin" : "tout";
        return row(edge === "in" ? "Transition in" : "Transition out",
          select({ get: () => clip()[key]?.type || "none", set: (v) => ui.commitSeq("Set Transition", M.setTransition(ui.seqModel(), id, edge, v === "none" ? null : v, clip()[key]?.dur || 0.5)), options: [{ value: "none", label: "None" }, ...M.TRANSITION_TYPES.map((x) => ({ value: x, label: TRANS_LABEL[x] }))] }),
          num({ get: () => clip()[key]?.dur || 0.5, set: (v) => clip()[key] && ui.commitSeq("Set Transition", M.setTransition(ui.seqModel(), id, edge, clip()[key].type, v)), min: 0.04, max: 30, step: 0.05, unit: "s" }));
      };
      out.push(section("Transitions", trans("in"), trans("out")));
    }
    if (c.volume !== undefined) {
      out.push(section("Audio",
        animRow(id, "Volume", "volume", (k) => k.volume, { min: 0, max: 400, step: 1, unit: "%", scale: 100 }),
        animRow(id, "Pan", "pan", (k) => k.pan, { min: -100, max: 100, step: 1, scale: 100 }),
        row("Fade in / out", num({ get: () => clip().fadeIn, set: (v) => upd({ fadeIn: v }, "Change Fade"), min: 0, max: 600, step: 0.1, unit: "s" }), num({ get: () => clip().fadeOut, set: (v) => upd({ fadeOut: v }, "Change Fade"), min: 0, max: 600, step: 0.1, unit: "s" }))));
    }

    // effects
    const stageOk = (d) => (c.type === "audio" ? d.stage === "audio" : d.stage !== "audio");
    const add = h("select.of-scene-insp__sel", { "aria-label": t("Add effect") }, h("option", { value: "" }, t("Add effect…")), ...Object.entries(EFFECTS).filter(([, d]) => stageOk(d)).map(([type, d]) => h("option", { value: type }, t(d.label))));
    add.addEventListener("change", () => {
      if (!add.value) return;
      ui.commitSeq("Add Effect", M.addEffect(ui.seqModel(), id, add.value, effectParams(add.value, {})).model);
    });
    const fxRows = c.effects.map((e) => {
      const def = EFFECTS[e.type];
      if (!def) return null;
      const fx = () => clip().effects.find((x) => x.id === e.id) || e;
      const on = h("input", { type: "checkbox", title: t("On"), "aria-label": t("On") });
      on.checked = e.on;
      on.addEventListener("change", () => ui.commitSeq("Toggle Effect", M.updateEffect(ui.seqModel(), id, e.id, { on: on.checked })));
      const del = h("button.of-scene-insp__x", { type: "button", title: t("Remove effect"), "aria-label": t("Remove effect") }, h("sl-icon", { name: "x-lg" }));
      del.addEventListener("click", () => ui.commitSeq("Remove Effect", M.removeEffect(ui.seqModel(), id, e.id)));
      const params = Object.entries(def.params).map(([k, d]) => {
        const path = `fx:${e.id}:${k}`;
        const cur = () => {
          const v = fx().p[k];
          const val = valueAt(v, Math.max(0, Math.min(clip().dur, ui.state.t - clip().start)));
          return val === undefined ? d.def : val;
        };
        if (d.color) return row(d.label, color({ get: cur, set: (v) => ui.commitSeq("Change Effect", M.updateEffect(ui.seqModel(), id, e.id, { p: { [k]: v } }), { coalesce: `scene:${path}` }) }));
        if (d.options) return row(d.label, select({ get: cur, set: (v) => ui.commitSeq("Change Effect", M.updateEffect(ui.seqModel(), id, e.id, { p: { [k]: +v } })), options: d.options.map((label, i) => ({ value: i, label })) }));
        return row(d.label, slider({ get: cur, set: (v) => ui.setProp(id, path, v), min: d.min, max: d.max, step: d.step }), num({ get: cur, set: (v) => ui.setProp(id, path, v), min: d.min, max: d.max, step: d.step }), c.type === "audio" ? null : keyBtn(id, path, (k2) => k2.effects.find((x) => x.id === e.id)?.p[k]));
      });
      return h("div.of-scene-insp__fx", h("div.of-scene-insp__fxhead", on, h("b", t(def.label)), del), ...params);
    });
    out.push(section("Effects", ...fxRows, add));

    // easing of the keyframe under the playhead
    const local = ui.state.t - c.start;
    const keyed = M.ANIMATABLE.filter((k) => isTrack(c[k]) && c[k].kf.some((f) => Math.abs(f.t - local) < 0.5 / m.fps));
    if (keyed.length) {
      const first = c[keyed[0]].kf.find((f) => Math.abs(f.t - local) < 0.5 / m.fps);
      const easy = (x) => x && x[0] === 0 && Math.abs(x[1] - 1 / 3) < 1e-6;
      const cur = typeof first.e === "string" && !first.o ? first.e : easy(first.i) && easy(first.o) ? "easyEase" : first.o || first.i || Array.isArray(first.e) ? "custom" : "linear";
      out.push(section("Keyframe", row("Easing", select({
        get: () => cur,
        set: (v) => {
          if (v === "custom") return;
          let next = ui.seqModel();
          for (const k of keyed) next = M.setEasing(next, id, k, v, { at: ui.state.t });
          ui.commitSeq("Change Easing", next);
        },
        options: [...EASING_PRESETS.map((n) => ({ value: n, label: EASE_LABEL[n] })), ...(cur === "custom" ? [{ value: "custom", label: "Custom curve" }] : [])],
      })), h("div.of-scene-insp__btns", btn("Graph editor", () => ui.toggleGraph(true)))));
    }
    return out;
  }

  function btn(label, fn) {
    const b = h("button.of-scene-insp__btn", { type: "button" }, t(label));
    b.addEventListener("click", fn);
    return b;
  }

  // an opened composition: name, size, duration, markers (frame rate and background belong to the main sequence)
  function compPanel(m) {
    const name = h("input.of-scene-insp__text", { type: "text", value: m.name, "aria-label": t("Name") });
    name.addEventListener("change", () => ui.commit("Rename Composition", M.updateComp(ui.model(), ui.seq, { name: name.value })));
    const used = M.compUsage(ui.model(), ui.seq).length;
    return [
      section("Composition",
        row("Name", name),
        row("Size", num({ get: () => ui.seqModel().width, set: (v) => ui.resizeSequence(Math.round(v), ui.seqModel().height), min: 16, max: 8192 }), num({ get: () => ui.seqModel().height, set: (v) => ui.resizeSequence(ui.seqModel().width, Math.round(v)), min: 16, max: 8192 })),
        row("Duration", h("output", M.timecode(m, M.duration(m)))),
        h("p.of-scene-insp__hint", t("Used by {n} clips. Changes show wherever it is used.", { n: used })),
        h("div.of-scene-insp__btns", btn("Back to main", () => ui.openSequence("main")))),
    ];
  }

  function sequencePanel(m) {
    if (ui.seq !== "main") return compPanel(m);
    const set = (patch, label) => ui.commit(label, M.normalizeScene({ ...ui.model(), ...patch }));
    const preset = h("select.of-scene-insp__sel", { "aria-label": t("Format") }, h("option", { value: "" }, t("Custom")), ...Object.entries(M.PRESETS).map(([id, p]) => h("option", { value: id }, t(p.label))));
    preset.value = Object.entries(M.PRESETS).find(([, p]) => p.width === m.width && p.height === m.height)?.[0] || "";
    preset.addEventListener("change", () => {
      const p = M.PRESETS[preset.value];
      if (p) ui.resizeSequence(p.width, p.height);
    });
    return [
      section("Sequence",
        row("Format", preset),
        row("Size", num({ get: () => ui.seqModel().width, set: (v) => ui.resizeSequence(Math.round(v), ui.seqModel().height), min: 16, max: 8192 }), num({ get: () => ui.seqModel().height, set: (v) => ui.resizeSequence(ui.seqModel().width, Math.round(v)), min: 16, max: 8192 })),
        row("Frames per second", select({ get: () => ui.seqModel().fps, set: (v) => set({ fps: +v }, "Change Frame Rate"), options: [...new Set([24, 25, 30, 50, 60, m.fps])].sort((a, b) => a - b) })),
        row("Background", color({ get: () => ui.model().background, set: (v) => ui.commit("Change Background", { ...ui.model(), background: v }, { coalesce: "scene:bg" }) })),
        row("Duration", h("output", M.timecode(m, M.duration(m))))),
      section("Markers", ...(m.markers.length ? m.markers.map((k) => {
        const go = h("button.of-scene-insp__marker", { type: "button" }, h("i", { style: `background:${k.color}` }), h("span", k.name || t("Marker")), h("code", M.timecode(m, k.t)));
        go.addEventListener("click", () => ui.seek(k.t));
        const del = h("button.of-scene-insp__x", { type: "button", title: t("Remove marker"), "aria-label": t("Remove marker") }, h("sl-icon", { name: "x-lg" }));
        del.addEventListener("click", () => ui.commitSeq("Remove Marker", M.removeMarker(ui.seqModel(), k.id)));
        return h("div.of-scene-insp__mrow", go, del);
      }) : [h("p.of-scene-insp__hint", t("Press M to add a marker at the playhead."))])),
    ];
  }

  function render() {
    const m = ui.seqModel();
    const ids = [...ui.state.sel].filter((id) => m.clips[id]);
    const c = ids.length === 1 ? m.clips[ids[0]] : null;
    const local = c ? ui.state.t - c.start : 0;
    const keyState = c ? M.ANIMATABLE.map((k) => (isTrack(c[k]) && c[k].kf.some((f) => Math.abs(f.t - local) < 0.5 / m.fps) ? "1" : "0")).join("") : "";
    const key = c ? `${c.id}|${c.type}|${c.remap !== undefined}|${!!c.collapse}|${c.effects.map((e) => e.id + e.type).join()}|${!!c.mask}|${keyState}` : ids.length ? `multi${ids.length}` : `seq|${ui.seq}|${m.name || ""}|${m.markers.map((k) => k.id + k.t + k.name).join()}|${m.width}x${m.height}|${M.duration(m)}`;
    if (key !== shape) {
      shape = key;
      updaters = [];
      if (c) el.replaceChildren(...clipPanel(c));
      else if (ids.length) el.replaceChildren(section("Selection", h("p.of-scene-insp__hint", t("{n} clips selected. Select one clip to edit its properties.", { n: ids.length }))));
      else el.replaceChildren(...sequencePanel(m));
    } else for (const fn of updaters) fn();
  }

  return { el, render, focusText: (id) => el.querySelector(`textarea[data-scene-text="${id}"]`)?.focus() };
}

const ANIM_LABEL = { none: N_("None"), fade: N_("Fade"), "slide-up": N_("Slide up"), "slide-down": N_("Slide down"), "slide-left": N_("Slide left"), "slide-right": N_("Slide right"), pop: N_("Pop"), typewriter: N_("Typewriter"), chars: N_("Letter by letter"), words: N_("Word by word"), blur: N_("Blur") };
const TRANS_LABEL = { fade: N_("Fade"), dissolve: N_("Cross dissolve"), "dip-black": N_("Dip to black"), "dip-white": N_("Dip to white"), "slide-left": N_("Slide left"), "slide-right": N_("Slide right"), "slide-up": N_("Slide up"), "slide-down": N_("Slide down"), "wipe-left": N_("Wipe left"), "wipe-right": N_("Wipe right"), "wipe-up": N_("Wipe up"), "wipe-down": N_("Wipe down"), zoom: N_("Zoom"), blur: N_("Blur") };
export const EASE_LABEL = { linear: N_("Linear"), easyEase: N_("Easy ease"), easyEaseIn: N_("Easy ease in"), easyEaseOut: N_("Easy ease out"), ease: N_("Ease"), easeIn: N_("Ease in"), easeOut: N_("Ease out"), easeInOut: N_("Ease in and out"), back: N_("Overshoot"), bounce: N_("Bounce"), elastic: N_("Elastic"), hold: N_("Hold") };
