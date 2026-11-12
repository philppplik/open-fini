// Scene Studio inspector (right panel): properties of the selected clip, or of the sequence when nothing is
// selected. Sections fold (the state is kept while the app runs). Every animatable property has keyframe controls:
// the stopwatch turns animation on or off, the arrows jump to the previous / next keyframe, the diamond adds or
// removes a keyframe at the playhead; once animated, edits write a keyframe at the playhead
// (docs/scene-studio.md ▸ Animation).
//
//   createInspector(ui) → { el, render(), focusText(id), reveal() }      `ui` = the workspace (scene/view.js)
// Invariant: render() never steals focus from a field the user is typing in (the panel is rebuilt only when the
// selection or the clip's structure changes; values and keyframe states update in place).
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import * as M from "./model.js";
import { valueAt, isTrack, EASING_PRESETS } from "./keyframes.js";
import { EFFECTS, effectParams } from "./effects.js";
import { LABEL_COLORS, PROP_LABEL } from "./props.js";
import { parentCycle } from "./rig.js";

const r2 = (v) => Math.round(v * 100) / 100;
const folded = new Set(); // section titles folded by the user (all scenes)
const foldedFx = new Set(); // effect ids folded

export function createInspector(ui) {
  const el = h("div.of-scene-insp", { role: "region", "aria-label": t("Properties") });
  let shape = ""; // structure key of what is rendered
  let updaters = []; // functions that refresh field values in place

  const section = (title, ...rows) => {
    const open = !folded.has(title);
    const head = h("button.of-scene-insp__fold", { type: "button", "aria-expanded": String(open) }, h("sl-icon", { name: open ? "chevron-down" : "chevron-right" }), h("h3", t(title)));
    const body = h("div.of-scene-insp__body", ...rows.filter(Boolean));
    body.hidden = !open;
    head.addEventListener("click", () => {
      if (folded.has(title)) folded.delete(title);
      else folded.add(title);
      const on = !folded.has(title);
      body.hidden = !on;
      head.setAttribute("aria-expanded", String(on));
      head.firstChild.name = on ? "chevron-down" : "chevron-right";
    });
    return h("section.of-scene-insp__sec", head, body);
  };
  const row = (label, ...controls) => h("label.of-scene-insp__row", { title: t(label) }, h("span", t(label)), h("div.of-scene-insp__ctl", ...controls.filter(Boolean)));

  function num({ get, set, min = -Infinity, max = Infinity, step = 1, unit = "", scale = 1, title = "" }) {
    const inp = h("input.of-scene-insp__num", { type: "number", step: String(step), ...(title ? { title: t(title), "aria-label": t(title) } : {}), ...(Number.isFinite(min) ? { min: String(min * scale) } : {}), ...(Number.isFinite(max) ? { max: String(max * scale) } : {}) });
    const show = () => {
      const v = get();
      if (document.activeElement !== inp) inp.value = typeof v === "number" ? String(r2(v * scale)) : "";
    };
    inp.addEventListener("change", () => {
      const v = +inp.value / scale;
      if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v)));
    });
    // drag the label-less field vertically with the wheel for fine changes is left to the browser
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
    const show = () => {
      const v = get();
      if (document.activeElement !== inp) inp.value = typeof v === "string" && /^#[0-9a-f]{6}/i.test(v) ? v.slice(0, 7) : "#000000";
    };
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

  function select({ get, set, options, title = "" }) {
    const sel = h("select.of-scene-insp__sel", { ...(title ? { "aria-label": t(title) } : {}) }, options.map((o) => h("option", { value: String(o.value ?? o) }, o.label ? t(o.label) : String(o))));
    const show = () => (sel.value = String(get()));
    sel.addEventListener("change", () => set(sel.value));
    updaters.push(show);
    show();
    return sel;
  }

  function check(label, get, set, title = "") {
    const cb = h("input", { type: "checkbox" });
    const sync = () => (cb.checked = !!get());
    cb.addEventListener("change", () => set(cb.checked));
    updaters.push(sync);
    sync();
    return h("label.of-scene-insp__chk", { title: t(title || label) }, cb, t(label));
  }

  const clipNow = (id) => ui.seqModel().clips[id];
  const localOf = (c) => Math.max(0, Math.min(c.dur, ui.state.t - c.start));
  const valueOf = (id, path) => {
    const c = clipNow(id);
    return c ? valueAt(M.propValue(c, path), localOf(c)) : undefined;
  };

  // keyframe controls of a property: stopwatch, previous, add / remove at the playhead, next
  function keyCtl(id, paths) {
    const path = Array.isArray(paths) ? paths[0] : paths;
    const watch = h("button.of-scene-insp__watch", { type: "button", title: t("Animate this property (stopwatch)"), "aria-label": t("Animate") }, h("sl-icon", { library: "of", name: "stopwatch" }));
    const prev = h("button.of-scene-insp__nav", { type: "button", title: t("Previous keyframe"), "aria-label": t("Previous keyframe") }, h("sl-icon", { name: "chevron-left" }));
    const key = h("button.of-scene-insp__key", { type: "button", title: t("Add or remove a keyframe at the playhead"), "aria-label": t("Keyframe") }, h("span"));
    const next = h("button.of-scene-insp__nav", { type: "button", title: t("Next keyframe"), "aria-label": t("Next keyframe") }, h("sl-icon", { name: "chevron-right" }));
    const box = h("span.of-scene-insp__keys", watch, prev, key, next);
    const sync = () => {
      const c = clipNow(id);
      if (!c) return;
      const v = M.propValue(c, path);
      const local = ui.state.t - c.start;
      const anim = isTrack(v);
      const on = anim && v.kf.some((k) => Math.abs(k.t - local) < 0.5 / ui.seqModel().fps);
      box.dataset.anim = String(anim);
      key.dataset.state = on ? "key" : anim ? "anim" : "off";
      key.setAttribute("aria-pressed", String(on));
      watch.setAttribute("aria-pressed", String(anim));
      prev.disabled = !anim || !v.kf.some((k) => k.t < local - 1e-6);
      next.disabled = !anim || !v.kf.some((k) => k.t > local + 1e-6);
    };
    watch.addEventListener("click", (e) => {
      e.preventDefault();
      ui.toggleAnimation(id, paths);
    });
    key.addEventListener("click", (e) => {
      e.preventDefault();
      ui.toggleKeyAt(id, paths);
    });
    prev.addEventListener("click", (e) => {
      e.preventDefault();
      ui.goKeyframe(-1, { id, path });
    });
    next.addEventListener("click", (e) => {
      e.preventDefault();
      ui.goKeyframe(1, { id, path });
    });
    box.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      ui.openGraph(id, path);
    });
    updaters.push(sync);
    sync();
    return box;
  }

  /** A row of one animatable number: value field (and slider) plus keyframe controls. */
  const animRow = (id, label, path, o = {}) =>
    row(label, o.slider ? slider({ get: () => valueOf(id, path) ?? 0, set: (v) => ui.setProp(id, path, v), min: o.min, max: o.max, step: o.step }) : null, num({ ...o, get: () => valueOf(id, path), set: (v) => ui.setProp(id, path, v) }), keyCtl(id, path));
  const animColor = (id, label, path) => row(label, color({ get: () => valueOf(id, path), set: (v) => ui.setProp(id, path, v) }), keyCtl(id, path));

  function btn(label, fn, icon = null) {
    const b = h("button.of-scene-insp__btn", { type: "button", title: t(label) }, icon ? h("sl-icon", { name: icon }) : null, t(label));
    b.addEventListener("click", fn);
    return b;
  }

  function clipPanel(c) {
    const id = c.id;
    const m = ui.seqModel();
    const clip = () => clipNow(id) || c;
    const upd = (patch, label = "Change Clip") => ui.commitSeq(label, M.updateClip(ui.seqModel(), id, patch), { coalesce: `scene:${id}:${Object.keys(patch).join()}` });
    const out = [];
    const name = h("input.of-scene-insp__text", { type: "text", value: c.name, "aria-label": t("Name") });
    name.addEventListener("change", () => upd({ name: name.value }, "Rename Clip"));
    out.push(section(N_("Clip"),
      row("Name", name),
      row("Start", num({ get: () => clip().start, set: (v) => ui.commitSeq("Move Clip", M.moveClip(ui.seqModel(), id, { start: v })), min: 0, step: 0.1, unit: "s" })),
      row("Duration", num({ get: () => clip().dur, set: (v) => ui.commitSeq("Trim Clip", M.trimClip(ui.seqModel(), id, "end", clip().start + v)), min: 0.04, step: 0.1, unit: "s" })),
      row("Label color", select({ get: () => clip().label || "", set: (v) => ui.setLabel(v || null, [id]), options: [{ value: "", label: "Default" }, ...LABEL_COLORS.map((x) => ({ value: x.color, label: x.label }))] })),
      h("div.of-scene-insp__btns",
        check(N_("Enabled"), () => !clip().off, () => ui.toggleEnabled([id]), N_("Disabled clips are neither seen nor heard (Shift+E)")),
        c.link ? btn("Unlink", () => ui.unlink([id]), "link-45deg") : null)));

    // time: speed, reverse, freeze, time remapping
    if (c.speed !== undefined) {
      const timed = c.type === "video" || c.type === "comp";
      out.push(section(N_("Time"),
        c.remap === undefined ? row("Speed", num({ get: () => clip().speed, set: (v) => ui.commitSeq("Change Speed", M.setSpeed(ui.seqModel(), id, v)), min: 0.05, max: 20, step: 5, unit: "%", scale: 100 })) : null,
        timed ? check(N_("Time remapping"), () => clip().remap !== undefined, () => ui.toggleRemap(id), N_("Keyframe which moment of the source is shown: speed ramps, reverse, freezes")) : null,
        c.remap !== undefined ? animRow(id, "Source time", "remap", { min: 0, step: 0.04, unit: "s" }) : null,
        h("div.of-scene-insp__btns",
          btn("Speed / Duration…", () => ui.speedDialog([id]), "clock-history"),
          timed ? btn("Reverse", () => ui.reverse([id]), "arrow-repeat") : null,
          timed ? btn("Freeze frame", () => ui.freeze(id), "pause") : null)));
    }

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
      out.push(section(N_("Text"), ta,
        row("Font", font, select({ get: tx("weight"), set: (v) => setT("weight")(+v), options: [100, 200, 300, 400, 500, 600, 700, 800, 900], title: N_("Weight") })),
        h("div.of-scene-insp__btns",
          check(N_("Italic"), tx("italic"), (v) => setT("italic")(v)),
          check(N_("Shadow"), tx("shadow"), (v) => setT("shadow")(v)),
          select({ get: tx("align"), set: setT("align"), options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }], title: N_("Alignment") })),
        animRow(id, "Size", "text.size", { min: 4, max: 2000 }),
        animColor(id, "Color", "text.color"),
        animRow(id, "Letter spacing", "text.tracking", { min: -50, max: 400 }),
        animRow(id, "Line height", "text.lineHeight", { min: 0.6, max: 4, step: 0.05 }),
        row("Outline", color({ get: tx("stroke"), set: (v) => upd({ text: { stroke: v, strokeW: v ? (typeof clip().text.strokeW === "number" ? clip().text.strokeW : 0) || 6 : clip().text.strokeW } }), none: true })),
        animRow(id, "Outline width", "text.strokeW", { min: 0, max: 200 }),
        row("Background", color({ get: tx("bg"), set: setT("bg"), none: true }), num({ get: tx("bgPad"), set: setT("bgPad"), min: 0, max: 400, title: N_("Padding") }), num({ get: tx("bgRadius"), set: setT("bgRadius"), min: 0, max: 400, title: N_("Corner radius") })),
        row("Wrap width", num({ get: tx("boxW"), set: setT("boxW"), min: 0, max: 16000, step: 10 })),
        row("Animate in", anim("in"), num({ get: () => clip().text.anim.inDur, set: (v) => upd({ text: { anim: { inDur: v } } }), min: 0.05, max: 20, step: 0.05, unit: "s" })),
        row("Animate out", anim("out"), num({ get: () => clip().text.anim.outDur, set: (v) => upd({ text: { anim: { outDur: v } } }), min: 0.05, max: 20, step: 0.05, unit: "s" }))));
    }
    if (c.type === "shape") {
      const sh = (k) => () => clip().shape[k];
      const setS = (k) => (v) => upd({ shape: { [k]: v } }, "Change Shape");
      out.push(section(N_("Shape"),
        row("Kind", select({ get: sh("kind"), set: setS("kind"), options: [{ value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }, { value: "line", label: "Line" }, { value: "polygon", label: "Polygon" }, { value: "star", label: "Star" }] })),
        animRow(id, "Width", "shape.w", { min: 1, max: 16000 }),
        animRow(id, "Height", "shape.h", { min: 1, max: 16000 }),
        c.shape.fill ? animColor(id, "Fill", "shape.fill") : null,
        row(c.shape.fill ? "Fill on" : "Fill", color({ get: sh("fill"), set: setS("fill"), none: true })),
        row("Outline", color({ get: sh("stroke"), set: (v) => upd({ shape: { stroke: v, strokeW: v ? (typeof clip().shape.strokeW === "number" ? clip().shape.strokeW : 0) || 6 : clip().shape.strokeW } }), none: true })),
        animRow(id, "Outline width", "shape.strokeW", { min: 0, max: 400 }),
        c.shape.kind === "rect" ? animRow(id, "Corner radius", "shape.radius", { min: 0, max: 8000 }) : null,
        c.shape.kind === "polygon" || c.shape.kind === "star" ? row("Points", num({ get: sh("points"), set: setS("points"), min: 3, max: 64 })) : null));
    }
    if (c.type === "solid") out.push(section(N_("Solid"), row("Color", color({ get: () => clip().color, set: (v) => upd({ color: v }, "Change Color") }))));
    if (c.type === "comp") {
      out.push(section(N_("Composition"),
        h("div.of-scene-insp__btns", btn("Open composition", () => ui.openCompClip(id), "box-arrow-in-down-right")),
        check(N_("Collapse transformations"), () => clip().collapse, (on) => upd({ collapse: on }, "Collapse Transformations"), N_("Draw the composition's layers straight into this sequence (sharp at any scale)"))));
    }

    if (c.type !== "audio") {
      const uniform = () => {
        const k = clip();
        return !isTrack(k.sx) && !isTrack(k.sy) ? Math.abs(k.sx - k.sy) < 1e-9 : JSON.stringify(k.sx) === JSON.stringify(k.sy);
      };
      const linked = uniform() && !ui.state.splitScale?.has(id);
      out.push(section(N_("Transform"),
        animRow(id, "Position X", "x", { step: 1 }),
        animRow(id, "Position Y", "y", { step: 1 }),
        linked ? row("Scale", num({ get: () => valueOf(id, "sx"), set: (v) => ui.setProps(id, { sx: v, sy: v }), min: 0, max: 100, step: 1, unit: "%", scale: 100 }), keyCtl(id, ["sx", "sy"])) : null,
        linked ? null : animRow(id, "Scale X", "sx", { min: 0, max: 100, step: 1, unit: "%", scale: 100 }),
        linked ? null : animRow(id, "Scale Y", "sy", { min: 0, max: 100, step: 1, unit: "%", scale: 100 }),
        animRow(id, "Rotation", "rot", { step: 1, unit: "°" }),
        animRow(id, "Opacity", "opacity", { min: 0, max: 1, step: 1, unit: "%", scale: 100, slider: false }),
        animRow(id, "Anchor X", "ax", { step: 1 }),
        animRow(id, "Anchor Y", "ay", { step: 1 }),
        row("Blend mode", select({ get: () => clip().blend, set: (v) => upd({ blend: v }, "Change Blend Mode"), options: M.BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] || b })) })),
        row("Parent", select({ get: () => clip().parent || "", set: (v) => ui.setParent(v || null, [id]), options: [{ value: "", label: "None" }, ...M.clipList(m).filter((p) => p.type !== "audio" && p.id !== id && !parentCycle(m, id, p.id)).map((p) => ({ value: p.id, label: p.name || p.type }))], title: N_("Move, turn and scale with another layer (a null object, for example)") })),
        check(N_("Motion blur"), () => clip().mblur, () => ui.toggleMotionBlur([id]), N_("Blur the layer along its movement (180° shutter)")),
        h("div.of-scene-insp__btns",
          btn("Fit", () => ui.fitClip(id, "fit")),
          btn("Fill", () => ui.fitClip(id, "fill")),
          btn("Center", () => ui.setProps(id, { x: m.width / 2, y: m.height / 2 })),
          btn(linked ? "Unlink scale" : "Link scale", () => {
            ui.state.splitScale ||= new Set();
            if (linked) {
              ui.state.splitScale.add(id);
              shape = "";
              return render();
            }
            ui.state.splitScale.delete(id);
            ui.commitSeq("Link Scale", M.setProp(ui.seqModel(), id, "sy", clip().sx));
          }),
          btn("Reset", () => ui.resetTransform(id)))));
      // behaviors (scene/rig.js): wiggle, loop and spin on top of the keyframes
      const addBeh = select({ get: () => "", set: (v) => v && ui.addBehavior(v, [id]), options: [{ value: "", label: "Add behavior…" }, { value: "wiggle-position", label: "Wiggle position" }, { value: "wiggle-rotation", label: "Wiggle rotation" }, { value: "wiggle-scale", label: "Wiggle scale" }, { value: "loop", label: "Loop keyframes" }, { value: "pingpong", label: "Ping-pong keyframes" }, { value: "spin", label: "Spin" }], title: N_("Add behavior") });
      const behRows = (c.beh || []).map((b) => {
        const set = (patch) => ui.updateBehavior(id, b.id, patch);
        const cur = (k) => () => clip().beh?.find((x) => x.id === b.id)?.[k];
        const del = h("button.of-scene-insp__x", { type: "button", title: t("Remove behavior"), "aria-label": t("Remove behavior") }, h("sl-icon", { name: "x-lg" }));
        del.addEventListener("click", () => set(null));
        const name = `${t(BEH_LABEL[b.type])} › ${t(PROP_LABEL[b.prop] || b.prop)}`;
        if (b.type === "wiggle") return row(name, num({ get: cur("amount"), set: (v) => set({ amount: v }), min: 0, max: 100000, step: b.prop === "sx" || b.prop === "sy" || b.prop === "opacity" ? 0.01 : 1, title: N_("Amount") }), num({ get: cur("freq"), set: (v) => set({ freq: v }), min: 0.01, max: 60, step: 0.1, title: N_("Frequency (per second)") }), del);
        if (b.type === "spin") return row(name, num({ get: cur("rate"), set: (v) => set({ rate: v }), step: 5, title: N_("Units per second") }), del);
        return row(name, select({ get: cur("mode"), set: (v) => set({ mode: v }), options: [{ value: "cycle", label: "Cycle" }, { value: "pingpong", label: "Ping-pong" }, { value: "offset", label: "Offset (continue)" }] }), del);
      });
      out.push(section(N_("Behaviors"), ...behRows, ...(behRows.length ? [] : [h("p.of-scene-insp__hint", t("Behaviors add motion without keyframes: wiggle, loop or spin."))]), addBeh));
      if (c.type === "video" || c.type === "image") {
        const cr = (path, label) => animRow(id, label, path, { min: 0, max: 0.99, step: 1, unit: "%", scale: 100 });
        out.push(section(N_("Crop"), cr("crop.l", "Left"), cr("crop.r", "Right"), cr("crop.t", "Top"), cr("crop.b", "Bottom")));
      }
      const mask = () => clip().mask;
      const setMask = (patch) => upd({ mask: patch === null ? null : { shape: "rect", x: 0, y: 0, w: 1, h: 1, feather: 0, invert: false, ...mask(), ...patch } }, "Change Mask");
      out.push(section(N_("Mask"),
        row("Shape", select({ get: () => mask()?.shape || "none", set: (v) => setMask(v === "none" ? null : { shape: v }), options: [{ value: "none", label: "None" }, { value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }] })),
        c.mask ? animRow(id, "Left edge", "mask.x", { step: 1, unit: "%", scale: 100 }) : null,
        c.mask ? animRow(id, "Top edge", "mask.y", { step: 1, unit: "%", scale: 100 }) : null,
        c.mask ? animRow(id, "Width", "mask.w", { step: 1, unit: "%", scale: 100 }) : null,
        c.mask ? animRow(id, "Height", "mask.h", { step: 1, unit: "%", scale: 100 }) : null,
        c.mask ? animRow(id, "Feather", "mask.feather", { min: 0, max: 500 }) : null,
        c.mask ? check(N_("Invert"), () => clip().mask?.invert, (v) => setMask({ invert: v })) : null,
        c.mask ? null : h("p.of-scene-insp__hint", t("A mask shows only part of the layer; its edges and feather can be animated."))));
      const trans = (edge) => {
        const key = edge === "in" ? "tin" : "tout";
        return row(edge === "in" ? "Transition in" : "Transition out",
          select({ get: () => clip()[key]?.type || "none", set: (v) => ui.commitSeq("Set Transition", M.setTransition(ui.seqModel(), id, edge, v === "none" ? null : v, clip()[key]?.dur || 0.5)), options: [{ value: "none", label: "None" }, ...M.TRANSITION_TYPES.map((x) => ({ value: x, label: TRANS_LABEL[x] }))] }),
          num({ get: () => clip()[key]?.dur || 0.5, set: (v) => clip()[key] && ui.commitSeq("Set Transition", M.setTransition(ui.seqModel(), id, edge, clip()[key].type, v)), min: 0.04, max: 30, step: 0.05, unit: "s" }));
      };
      out.push(section(N_("Transitions"), trans("in"), trans("out")));
    }
    if (c.volume !== undefined) {
      const db = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
      out.push(section(N_("Audio"),
        animRow(id, "Volume", "volume", { min: 0, max: 4, step: 1, unit: "%", scale: 100 }),
        row("Gain (dB)", num({ get: () => {
          const g = valueOf(id, "volume");
          return Number.isFinite(db(g)) ? db(g) : -60;
        }, set: (v) => ui.setProp(id, "volume", Math.pow(10, v / 20)), min: -60, max: 12, step: 0.5, title: N_("Gain in decibels (0 dB = unchanged)") })),
        animRow(id, "Pan", "pan", { min: -1, max: 1, step: 1, scale: 100 }),
        row("Fade in / out", num({ get: () => clip().fadeIn, set: (v) => upd({ fadeIn: v }, "Change Fade"), min: 0, max: 600, step: 0.1, unit: "s" }), num({ get: () => clip().fadeOut, set: (v) => upd({ fadeOut: v }, "Change Fade"), min: 0, max: 600, step: 0.1, unit: "s" })),
        check(N_("Mute"), () => clip().muted, () => ui.toggleMute([id]))));
    }

    // effect stack: order (top first), on / off, fold, reset, remove; keyframeable parameters
    const stageOk = (d) => (c.type === "audio" ? d.stage === "audio" : d.stage !== "audio");
    const add = h("select.of-scene-insp__sel", { "aria-label": t("Add effect") }, h("option", { value: "" }, t("Add effect…")), ...Object.entries(EFFECTS).filter(([, d]) => stageOk(d)).map(([type, d]) => h("option", { value: type }, t(d.label))));
    add.addEventListener("change", () => {
      if (!add.value) return;
      ui.commitSeq("Add Effect", M.addEffect(ui.seqModel(), id, add.value, effectParams(add.value, {})).model);
    });
    const fxRows = c.effects.map((e, i) => {
      const def = EFFECTS[e.type];
      if (!def) return null;
      const fx = () => clip().effects.find((x) => x.id === e.id) || e;
      const on = h("input", { type: "checkbox", title: t("Effect on / off"), "aria-label": t("On") });
      on.checked = e.on;
      on.addEventListener("change", () => ui.commitSeq("Toggle Effect", M.updateEffect(ui.seqModel(), id, e.id, { on: on.checked })));
      const ib = (icon, label, fn, disabled = false) => {
        const b = h("button.of-scene-insp__x", { type: "button", title: t(label), "aria-label": t(label), disabled: disabled || undefined }, h("sl-icon", { name: icon }));
        b.addEventListener("click", fn);
        return b;
      };
      const open = !foldedFx.has(e.id);
      const fold = ib(open ? "chevron-down" : "chevron-right", open ? N_("Fold") : N_("Unfold"), () => {
        if (foldedFx.has(e.id)) foldedFx.delete(e.id);
        else foldedFx.add(e.id);
        shape = "";
        render();
      });
      const params = !open ? [] : Object.entries(def.params).map(([k, d]) => {
        const path = `fx:${e.id}:${k}`;
        const cur = () => {
          const v = fx().p[k];
          const val = valueAt(v, localOf(clip()));
          return val === undefined ? d.def : val;
        };
        if (d.color) return row(d.label, color({ get: cur, set: (v) => (isTrack(fx().p[k]) ? ui.setProp(id, path, v) : ui.commitSeq("Change Effect", M.updateEffect(ui.seqModel(), id, e.id, { p: { [k]: v } }), { coalesce: `scene:${path}` })) }), c.type === "audio" ? null : fx().p[k] === undefined ? null : keyCtl(id, path));
        if (d.options) return row(d.label, select({ get: cur, set: (v) => ui.commitSeq("Change Effect", M.updateEffect(ui.seqModel(), id, e.id, { p: { [k]: +v } })), options: d.options.map((label, j) => ({ value: j, label })) }));
        const setV = (v) => (fx().p[k] === undefined ? ui.commitSeq("Change Effect", M.updateEffect(ui.seqModel(), id, e.id, { p: { [k]: v } }), { coalesce: `scene:${path}` }) : ui.setProp(id, path, v));
        return row(d.label, slider({ get: cur, set: setV, min: d.min, max: d.max, step: d.step }), num({ get: cur, set: setV, min: d.min, max: d.max, step: d.step }), c.type === "audio" ? null : fx().p[k] === undefined ? stopwatchFor(id, e.id, k, cur) : keyCtl(id, path));
      });
      return h("div.of-scene-insp__fx", { "data-off": String(!e.on) },
        h("div.of-scene-insp__fxhead", fold, on, h("b", { title: t(def.label) }, t(def.label)),
          ib("arrow-up", N_("Move up"), () => ui.commitSeq("Reorder Effects", M.moveEffect(ui.seqModel(), id, e.id, i - 1)), i === 0),
          ib("arrow-down", N_("Move down"), () => ui.commitSeq("Reorder Effects", M.moveEffect(ui.seqModel(), id, e.id, i + 1)), i === c.effects.length - 1),
          ib("arrow-counterclockwise", N_("Reset"), () => ui.commitSeq("Reset Effect", M.resetEffect(ui.seqModel(), id, e.id))),
          ib("x-lg", N_("Remove effect"), () => ui.commitSeq("Remove Effect", M.removeEffect(ui.seqModel(), id, e.id)))),
        ...params);
    });
    out.push(section(N_("Effects"), ...(c.effects.length ? fxRows : [h("p.of-scene-insp__hint", t("No effects yet. Add one here, or drag one from the Effects tab onto the clip."))]), add));

    // easing of the keyframes under the playhead
    const local = ui.state.t - c.start;
    const keyed = M.animatedPaths(c).filter((p) => M.propValue(c, p).kf.some((f) => Math.abs(f.t - local) < 0.5 / m.fps));
    if (keyed.length) {
      const first = M.propValue(c, keyed[0]).kf.find((f) => Math.abs(f.t - local) < 0.5 / m.fps);
      const easy = (x) => x && x[0] === 0 && Math.abs(x[1] - 1 / 3) < 1e-6;
      const cur = typeof first.e === "string" && !first.o ? first.e : easy(first.i) && easy(first.o) ? "easyEase" : first.o || first.i || Array.isArray(first.e) ? "custom" : "linear";
      out.push(section(N_("Keyframe"), row("Easing", select({
        get: () => cur,
        set: (v) => {
          if (v === "custom") return;
          let next = ui.seqModel();
          for (const k of keyed) next = M.setEasing(next, id, k, v, { at: ui.state.t });
          ui.commitSeq("Change Easing", next);
        },
        options: [...EASING_PRESETS.map((n) => ({ value: n, label: EASE_LABEL[n] })), ...(cur === "custom" ? [{ value: "custom", label: "Custom curve" }] : [])],
      })), h("div.of-scene-insp__btns", btn("Graph editor", () => ui.toggleGraph(true), "bezier2"))));
    }
    return out;
  }

  // an effect parameter that has never been set: the stopwatch first stores the current value, then animates it
  function stopwatchFor(id, fxId, k, cur) {
    const b = h("button.of-scene-insp__watch", { type: "button", title: t("Animate this property (stopwatch)"), "aria-label": t("Animate") }, h("sl-icon", { library: "of", name: "stopwatch" }));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const m1 = M.updateEffect(ui.seqModel(), id, fxId, { p: { [k]: cur() } });
      const c = m1.clips[id];
      ui.commitSeq("Animate Property", M.setKeyframe(m1, id, `fx:${fxId}:${k}`, Math.max(c.start, Math.min(M.clipEnd(c), ui.state.t)), cur()));
    });
    return h("span.of-scene-insp__keys", { "data-anim": "false" }, b);
  }

  // an opened composition: name, size, duration, markers (frame rate and background belong to the main sequence)
  function compPanel(m) {
    const name = h("input.of-scene-insp__text", { type: "text", value: m.name, "aria-label": t("Name") });
    name.addEventListener("change", () => ui.commit("Rename Composition", M.updateComp(ui.model(), ui.seq, { name: name.value })));
    const used = M.compUsage(ui.model(), ui.seq).length;
    return [
      section(N_("Composition"),
        row("Name", name),
        row("Size", num({ get: () => ui.seqModel().width, set: (v) => ui.resizeSequence(Math.round(v), ui.seqModel().height), min: 16, max: 8192 }), num({ get: () => ui.seqModel().height, set: (v) => ui.resizeSequence(ui.seqModel().width, Math.round(v)), min: 16, max: 8192 })),
        row("Duration", h("output", M.timecode(m, M.duration(m)))),
        h("p.of-scene-insp__hint", t("Used by {n} clips. Changes show wherever it is used.", { n: used })),
        h("div.of-scene-insp__btns", btn("Back to main", () => ui.openSequence("main")))),
      markersSection(m),
    ];
  }

  function markersSection(m) {
    return section(N_("Markers"), ...(m.markers.length ? m.markers.map((k) => {
      const go = h("button.of-scene-insp__marker", { type: "button" }, h("i", { style: `background:${k.color}` }), h("span", k.name || t("Marker")), h("code", M.timecode(m, k.t)));
      go.addEventListener("click", () => ui.seek(k.t));
      go.addEventListener("dblclick", () => ui.renameMarker(k.id));
      const del = h("button.of-scene-insp__x", { type: "button", title: t("Remove marker"), "aria-label": t("Remove marker") }, h("sl-icon", { name: "x-lg" }));
      del.addEventListener("click", () => ui.commitSeq("Remove Marker", M.removeMarker(ui.seqModel(), k.id)));
      return h("div.of-scene-insp__mrow", go, del);
    }) : [h("p.of-scene-insp__hint", t("Press M to add a marker at the playhead."))]));
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
      h("p.of-scene-insp__empty", t("Select a clip in the timeline or the viewer to edit its properties.")),
      section(N_("Sequence"),
        row("Format", preset),
        row("Size", num({ get: () => ui.seqModel().width, set: (v) => ui.resizeSequence(Math.round(v), ui.seqModel().height), min: 16, max: 8192 }), num({ get: () => ui.seqModel().height, set: (v) => ui.resizeSequence(ui.seqModel().width, Math.round(v)), min: 16, max: 8192 })),
        row("Frames per second", select({ get: () => ui.seqModel().fps, set: (v) => set({ fps: +v }, "Change Frame Rate"), options: [...new Set([24, 25, 30, 50, 60, m.fps])].sort((a, b) => a - b) })),
        row("Background", color({ get: () => ui.model().background, set: (v) => ui.commit("Change Background", { ...ui.model(), background: v }, { coalesce: "scene:bg" }) })),
        row("Duration", h("output", M.timecode(m, M.duration(m))))),
      markersSection(m),
    ];
  }

  function multiPanel(ids) {
    return [
      section(N_("Selection"),
        h("p.of-scene-insp__hint", t("{n} clips selected. Select one clip to edit all of its properties.", { n: ids.length })),
        row("Label color", select({ get: () => "", set: (v) => ui.setLabel(v || null, ids), options: [{ value: "", label: "Default" }, ...LABEL_COLORS.map((x) => ({ value: x.color, label: x.label }))] })),
        h("div.of-scene-insp__btns",
          btn("Link", () => ui.link(ids), "link-45deg"),
          btn("Pre-compose", () => ui.precompose(), "collection"),
          btn("Enable / disable", () => ui.toggleEnabled(ids)),
          ui.staggerDialog ? btn("Sequence layers…", () => ui.staggerDialog(ids), "distribute-horizontal") : null)),
    ];
  }

  function render() {
    const m = ui.seqModel();
    const ids = [...ui.state.sel].filter((id) => m.clips[id]);
    const c = ids.length === 1 ? m.clips[ids[0]] : null;
    const local = c ? ui.state.t - c.start : 0;
    const keyState = c ? M.animatedPaths(c).map((p) => (M.propValue(c, p).kf.some((f) => Math.abs(f.t - local) < 0.5 / m.fps) ? "1" : "0")).join("") : "";
    const uniform = c && c.type !== "audio" ? JSON.stringify(c.sx) === JSON.stringify(c.sy) && !ui.state.splitScale?.has(c.id) : true;
    const key = c
      ? `${c.id}|${c.type}|${c.remap !== undefined}|${!!c.collapse}|${c.effects.map((e) => e.id + e.type + e.on + foldedFx.has(e.id) + Object.keys(e.p).join("")).join()}|${c.mask?.shape}|${!!c.link}|${(c.beh || []).map((b) => b.id).join()}|${c.parent || ""}|${uniform}|${c.shape?.kind}|${!!c.shape?.fill}|${M.animatedPaths(c).join()}|${keyState}`
      : ids.length
        ? `multi${ids.join()}`
        : `seq|${ui.seq}|${m.name || ""}|${m.markers.map((k) => k.id + k.t + k.name).join()}|${m.width}x${m.height}|${M.duration(m)}`;
    if (key !== shape) {
      shape = key;
      updaters = [];
      const top = el.scrollTop;
      if (c) el.replaceChildren(...clipPanel(c));
      else if (ids.length) el.replaceChildren(...multiPanel(ids));
      else el.replaceChildren(...sequencePanel(m));
      el.scrollTop = top;
    } else for (const fn of updaters) fn();
  }

  return {
    el,
    render,
    focusText: (id) => el.querySelector(`textarea[data-scene-text="${id}"]`)?.focus(),
    reveal() {
      el.scrollTop = 0;
      el.querySelector("input, select, button")?.focus({ preventScroll: true });
    },
  };
}

const ANIM_LABEL = { none: N_("None"), fade: N_("Fade"), "slide-up": N_("Slide up"), "slide-down": N_("Slide down"), "slide-left": N_("Slide left"), "slide-right": N_("Slide right"), pop: N_("Pop"), typewriter: N_("Typewriter"), chars: N_("Letter by letter"), words: N_("Word by word"), blur: N_("Blur") };
export const TRANS_LABEL = { fade: N_("Fade"), dissolve: N_("Cross dissolve"), "dip-black": N_("Dip to black"), "dip-white": N_("Dip to white"), "slide-left": N_("Slide left"), "slide-right": N_("Slide right"), "slide-up": N_("Slide up"), "slide-down": N_("Slide down"), "wipe-left": N_("Wipe left"), "wipe-right": N_("Wipe right"), "wipe-up": N_("Wipe up"), "wipe-down": N_("Wipe down"), zoom: N_("Zoom"), blur: N_("Blur") };
export const EASE_LABEL = { linear: N_("Linear"), easyEase: N_("Easy ease"), easyEaseIn: N_("Easy ease in"), easyEaseOut: N_("Easy ease out"), ease: N_("Ease"), easeIn: N_("Ease in"), easeOut: N_("Ease out"), easeInOut: N_("Ease in and out"), back: N_("Overshoot"), bounce: N_("Bounce"), elastic: N_("Elastic"), hold: N_("Hold") };
const BEH_LABEL = { wiggle: N_("Wiggle"), loop: N_("Loop"), spin: N_("Spin") };
const BLEND_LABEL = { normal: N_("Normal"), multiply: N_("Multiply"), screen: N_("Screen"), overlay: N_("Overlay"), darken: N_("Darken"), lighten: N_("Lighten"), "color-dodge": N_("Color dodge"), "color-burn": N_("Color burn"), "hard-light": N_("Hard light"), "soft-light": N_("Soft light"), difference: N_("Difference"), exclusion: N_("Exclusion"), hue: N_("Hue"), saturation: N_("Saturation"), color: N_("Color"), luminosity: N_("Luminosity"), lighter: N_("Add") };
