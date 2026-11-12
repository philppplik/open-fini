// Scene Studio actions (docs/scene-studio.md ▸ Context menus, Keyboard): what the context menus (scene/menus.js),
// the keyboard and the commands do with the timeline, the viewer and keyframes. Each action is ONE undo step.
//
//   createActions(ui) → { copy, paste, nudge, speedDialog, reverse, freeze, … }   merged into the workspace API
// `ui` is the workspace (scene/view.js). Clipboards are shared by all scenes of the window (copy in one document,
// paste in another; clips whose media is missing there are skipped).
import { h, optVal, optDecode } from "../core/util.js";
import { t } from "../i18n/index.js";
import { openDialog, confirmDialog } from "../ui/dialogs.js";
import * as M from "./model.js";
import * as KO from "./keyops.js";
import * as E from "./edit-ops.js";
import { isTrack, valueAt } from "./keyframes.js";
import { effectParams, EFFECTS } from "./effects.js";
import { animateClip } from "./motion.js";
import { propLabel } from "./props.js";
import * as R from "./rig.js";

const board = { clips: null, keys: null, last: null }; // window-wide clipboard

export function createActions(ui) {
  const S = ui.state;
  const seq = () => ui.seqModel();
  const sel = () => ui.selection();
  const fps = () => seq().fps;
  // run fn(model) → model over the selection as one step (errors become a toast)
  const editSelected = (label, fn) => {
    try {
      const next = fn(seq());
      if (next && next !== seq()) ui.commitSeq(label, next);
      return next;
    } catch (err) {
      ui.toast(err.message);
      return null;
    }
  };
  const targets = (ids) => (ids?.length ? ids : sel());

  const A = {
    // ------------------------------------------------------------------------------------------- clipboard
    copy() {
      if (S.keys.length) {
        board.keys = KO.copyKeySel(seq(), S.keys);
        board.last = "keys";
        return ui.toast(t("{n} keyframes copied.", { n: S.keys.length }), "success");
      }
      const ids = E.linkedIds(seq(), sel());
      if (!ids.length) return;
      board.clips = E.copyClips(seq(), ids);
      board.last = "clips";
    },
    cut() {
      if (S.keys.length) {
        A.copy();
        return A.deleteKeys();
      }
      A.copy();
      ui.deleteSelection();
    },
    get canPaste() {
      return !!(board.last === "keys" ? board.keys : board.clips);
    },
    /** Pastes keyframes into the selected clip, or clips at `at` (default: the playhead). */
    paste(at = S.t, track = null) {
      if (board.last === "keys" && board.keys) {
        const id = sel()[0];
        if (!id) return ui.toast(t("Select a clip to paste the keyframes into."));
        const r = KO.pasteKeySel(seq(), id, board.keys, at);
        if (!r.sel.length) return ui.toast(t("This clip has none of the copied properties."));
        ui.commitSeq("Paste Keyframes", r.model);
        return ui.selectKeys(r.sel);
      }
      if (!board.clips) return;
      const r = E.pasteClips(seq(), board.clips, at, { track });
      if (r.ids.length) {
        ui.commitSeq("Paste", r.model);
        ui.select(r.ids);
      }
      if (r.skipped) ui.toast(t("{n} clips were skipped: their media is not in this project.", { n: r.skipped }));
    },

    // ------------------------------------------------------------------------------------------- clips
    /** Moves the selected keyframes or clips by whole frames (Alt + Left / Right). */
    nudge(frames) {
      if (S.keys.length) {
        const r = KO.retimeKeys(seq(), S.keys, { dt: frames / fps() });
        ui.commitSeq("Nudge Keyframes", r.model);
        return ui.selectKeys(r.sel);
      }
      const ids = E.linkedIds(seq(), sel());
      if (ids.length) editSelected("Nudge", (m) => M.moveClips(m, ids, frames / m.fps, 0));
    },
    trimTo(edge, ids) {
      const list = targets(ids).length ? E.linkedIds(seq(), targets(ids)) : M.clipList(seq()).filter((c) => S.t > c.start && S.t < M.clipEnd(c)).map((c) => c.id);
      editSelected(edge === "start" ? "Trim Start" : "Trim End", (m) => E.trimTo(m, list, edge, S.t));
    },
    reverse(ids) {
      editSelected("Reverse", (m) => targets(ids).reduce((acc, id) => (["video", "comp"].includes(acc.clips[id]?.type) ? E.reverseClip(acc, id) : acc), m));
    },
    freeze(id = sel()[0], at = S.t) {
      const c = seq().clips[id];
      if (!c) return;
      if (!["video", "comp"].includes(c.type)) return ui.toast(t("Freeze frames work on video and composition clips."));
      try {
        const r = E.freezeFrame(seq(), id, at);
        ui.commitSeq("Freeze Frame", r.model);
        ui.select([r.id]);
      } catch (err) {
        ui.toast(err.message);
      }
    },
    toggleRemap(id = sel()[0]) {
      const c = seq().clips[id];
      if (c) editSelected("Time Remapping", (m) => M.setTimeRemap(m, id, c.remap === undefined));
    },
    link(ids) {
      const list = targets(ids);
      const m = seq();
      const linked = list.length > 1 && list.every((id) => m.clips[id]?.link && m.clips[id].link === m.clips[list[0]].link);
      editSelected(linked ? "Unlink" : "Link", (mm) => (linked || list.length < 2 ? E.unlinkClips(mm, list) : E.linkClips(mm, list)));
    },
    unlink: (ids) => editSelected("Unlink", (m) => E.unlinkClips(m, targets(ids))),
    toggleEnabled(ids) {
      const list = targets(ids);
      const off = !list.every((id) => seq().clips[id]?.off);
      editSelected(off ? "Disable Clip" : "Enable Clip", (m) => list.reduce((acc, id) => (acc.clips[id] ? { ...acc, clips: { ...acc.clips, [id]: off ? { ...acc.clips[id], off: true } : withoutKey(acc.clips[id], "off") } } : acc), m));
    },
    toggleMute(ids) {
      const list = targets(ids).filter((id) => seq().clips[id]?.volume !== undefined);
      if (!list.length) return;
      const mute = !list.every((id) => seq().clips[id].muted);
      editSelected("Mute Clip", (m) => list.reduce((acc, id) => M.updateClip(acc, id, { muted: mute }), m));
    },
    async rename(id = sel()[0]) {
      const c = seq().clips[id];
      const v = c && (await ui.prompt(t("Clip name"), c.name));
      if (v) editSelected("Rename Clip", (m) => M.updateClip(m, id, { name: v }));
    },
    setLabel(color, ids) {
      editSelected("Label Color", (m) => targets(ids).reduce((acc, id) => (acc.clips[id] ? { ...acc, clips: { ...acc.clips, [id]: color ? { ...acc.clips[id], label: color } : withoutKey(acc.clips[id], "label") } } : acc), m));
    },
    replaceMedia: (id, mediaId) => editSelected("Replace Media", (m) => E.replaceMedia(m, id, mediaId)),
    addEffect(type, ids) {
      const list = targets(ids).filter((id) => {
        const c = seq().clips[id];
        return c && (c.type === "audio") === (EFFECTS[type]?.stage === "audio");
      });
      if (!list.length) return ui.toast(t("This effect does not apply to the selected clips."));
      editSelected("Add Effect", (m) => list.reduce((acc, id) => M.addEffect(acc, id, type, effectParams(type, {})).model, m));
    },
    addTransition(edge, type, ids) {
      const list = targets(ids).filter((id) => seq().clips[id] && seq().clips[id].type !== "audio");
      editSelected("Set Transition", (m) => list.reduce((acc, id) => M.setTransition(acc, id, edge, type, acc.clips[id][edge === "in" ? "tin" : "tout"]?.dur || 0.5), m));
    },
    animate(preset, edge, ids) {
      const list = targets(ids).filter((id) => seq().clips[id] && seq().clips[id].type !== "audio");
      if (!list.length) return ui.toast(t("Select a picture clip to animate."));
      editSelected("Animate", (m) => list.reduce((acc, id) => animateClip(acc, { id, preset, edge, dur: Math.min(0.6, acc.clips[id].dur / 3) }).model, m));
    },
    /** A dropped or double-clicked item of the effects browser: "fx:<type>", "tr:<edge>:<type>", "anim:<edge>:<preset>". */
    applyBrowserItem(item, id) {
      const [kind, a, b] = String(item).split(":");
      if (!seq().clips[id]) return;
      if (kind === "fx") return A.addEffect(a, [id]);
      if (kind === "tr") return A.addTransition(a, b, [id]);
      if (kind === "anim") return A.animate(b, a, [id]);
    },
    properties(id = sel()[0]) {
      if (!id) return;
      ui.select([id]);
      ui.revealInspector?.();
    },
    async speedDialog(ids) {
      const list = targets(ids).filter((id) => seq().clips[id]?.speed !== undefined);
      if (!list.length) return ui.toast(t("Speed applies to video, audio and composition clips."));
      const c = seq().clips[list[0]];
      const pct = h("sl-input", { type: "number", label: t("Speed (%)"), value: String(Math.round(c.speed * 100)), min: "5", max: "2000" });
      const dur = h("sl-input", { type: "text", label: t("Duration"), value: M.timecode(seq(), c.dur), "help-text": t("hours:minutes:seconds:frames") });
      const ripple = h("sl-checkbox", {}, t("Ripple edit, shifting later clips"));
      const rev = h("sl-checkbox", { checked: c.remap !== undefined && isTrack(c.remap) && c.remap.kf[0].v > c.remap.kf[c.remap.kf.length - 1].v ? true : undefined, disabled: !list.some((id) => ["video", "comp"].includes(seq().clips[id].type)) || undefined }, t("Reverse speed"));
      pct.addEventListener("sl-input", () => {
        const s = +pct.value / 100;
        if (s > 0) dur.value = M.timecode(seq(), (c.dur * c.speed) / s);
      });
      dur.addEventListener("sl-change", () => {
        const d = M.parseTime(seq(), dur.value);
        if (d > 0) pct.value = String(Math.round(((c.dur * c.speed) / d) * 1000) / 10);
      });
      openDialog({
        title: t("Clip Speed / Duration"),
        width: 380,
        body: h("div.of-scene-dlg", pct, dur, ripple, rev),
        buttons: [
          { label: "Cancel", onClick: (close) => close() },
          {
            label: "OK",
            variant: "primary",
            onClick: (close) => {
              const s = Math.max(0.05, Math.min(20, +pct.value / 100 || 1));
              editSelected("Change Speed", (m) => {
                let next = m;
                for (const id of list) {
                  const k = next.clips[id];
                  if (k.remap !== undefined) next = M.setTimeRemap(next, id, false);
                  next = M.setSpeed(next, id, s, { ripple: ripple.checked });
                  if (rev.checked && ["video", "comp"].includes(k.type)) next = E.reverseClip(next, id);
                }
                return next;
              });
              close();
            },
          },
        ],
      });
    },

    // ------------------------------------------------------------------------------------------- tracks
    addTrackAt(kind, refId = null, above = true) {
      const m = seq();
      const same = m.tracks.filter((k) => k.kind === kind);
      const ref = refId ? same.findIndex((k) => k.id === refId) : -1;
      const index = ref < 0 ? null : above ? ref : ref + 1;
      editSelected("Add Track", (mm) => M.addTrack(mm, kind, { index }).model);
    },
    async renameTrack(id) {
      const tk = M.trackOf(seq(), id);
      const v = tk && (await ui.prompt(t("Track name"), tk.name));
      if (v) editSelected("Rename Track", (m) => M.updateTrack(m, id, { name: v }));
    },
    toggleTrack(id, key) {
      const tk = M.trackOf(seq(), id);
      if (tk) editSelected(key === "locked" ? "Lock Track" : key === "solo" ? "Solo Track" : key === "muted" ? "Mute Track" : "Toggle Track", (m) => M.updateTrack(m, id, { [key]: !tk[key] }));
    },
    async deleteTrack(id) {
      const n = M.trackClips(seq(), id).length;
      if (n && !(await confirmDialog({ title: t("Delete track"), message: t("This track has {n} clips. Delete it with its clips?", { n }), ok: t("Delete"), danger: true }))) return;
      editSelected("Delete Track", (m) => M.removeTrack(m, id));
    },
    duplicateTrack: (id) => editSelected("Duplicate Track", (m) => E.duplicateTrack(m, id).model),
    moveTrack: (id, delta) => editSelected("Move Track", (m) => M.moveTrack(m, id, delta)),
    setTrackHeight(id, px) {
      if (px) S.heights[id] = px;
      else delete S.heights[id];
      ui.requestDraw();
    },
    selectTrack: (id) => ui.select(M.trackClips(seq(), id).map((c) => c.id)),

    // ------------------------------------------------------------------------------------------- empty space, ruler
    async insertGap(at = S.t) {
      const v = await ui.prompt(t("Gap length (seconds)"), "1");
      const d = +String(v || "").replace(",", ".");
      if (d > 0) editSelected("Insert Gap", (m) => M.insertGap(m, at, d));
    },
    rippleDeleteGap: (track, at) => editSelected("Ripple Delete Gap", (m) => E.rippleDeleteGap(m, track, at)),
    addLayerAt(kind, at = S.t, track = null) {
      const tk = track && M.trackOf(seq(), track);
      const props = kind === "text" ? { type: "text", text: { text: t("Your text") } } : kind === "shape" ? { type: "shape", shape: { kind: "rect" } } : kind === "null" ? R.nullProps() : kind === "solid" ? { type: "solid" } : { type: "adjustment", name: "Adjustment layer" };
      try {
        const r = M.addClip(seq(), { start: at, dur: 5, ...props, track: tk && tk.kind === "video" && !tk.locked ? tk.id : undefined });
        ui.commitSeq(kind === "text" ? "Add Text" : kind === "shape" ? "Add Shape" : kind === "null" ? "Add Null Object" : kind === "solid" ? "Add Solid" : "Add Adjustment Layer", r.model);
        ui.select([r.id]);
      } catch (err) {
        ui.toast(err.message);
      }
    },
    addMarkerAt: (at) => editSelected("Add Marker", (m) => M.addMarker(m, at, "").model),
    async renameMarker(id) {
      const k = seq().markers.find((x) => x.id === id);
      const v = k && (await ui.prompt(t("Marker name"), k.name));
      if (v !== null && v !== undefined && k) editSelected("Rename Marker", (m) => ({ ...m, markers: m.markers.map((x) => (x.id === id ? { ...x, name: String(v).slice(0, 200) } : x)) }));
    },
    setInAt(at) {
      const m = seq();
      editSelected("Set In Point", (mm) => M.setRange(mm, at, m.range && m.range.out > at ? m.range.out : M.duration(m) || at + 1));
    },
    setOutAt(at) {
      const m = seq();
      editSelected("Set Out Point", (mm) => M.setRange(mm, m.range && m.range.in < at ? m.range.in : 0, at));
    },
    rangeToSelection() {
      const cs = sel().map((id) => seq().clips[id]).filter(Boolean);
      if (cs.length) editSelected("Set In and Out", (m) => M.setRange(m, Math.min(...cs.map((c) => c.start)), Math.max(...cs.map(M.clipEnd))));
    },

    // ------------------------------------------------------------------------------------------- keyframes
    selectKeysOf(id, path = null) {
      const c = seq().clips[id];
      if (c) ui.selectKeys(KO.keysOfClip(c, path));
    },
    deleteKeys() {
      if (!S.keys.length) return;
      ui.commitSeq("Delete Keyframes", KO.deleteKeys(seq(), S.keys));
      ui.selectKeys([]);
    },
    easeKeys(preset) {
      if (S.keys.length) editSelected("Change Easing", (m) => KO.easeKeys(m, S.keys, preset));
    },
    reverseKeys() {
      if (S.keys.length > 1) editSelected("Reverse Keyframes", (m) => KO.reverseKeys(m, S.keys));
    },
    async setKeyValue() {
      const k = S.keys[0];
      const c = k && seq().clips[k.id];
      if (!c) return;
      const cur = valueAt(M.propValue(c, k.path), k.t);
      const v = await ui.prompt(t("Value of {name}", { name: propLabel(c, k.path) }), String(typeof cur === "number" ? Math.round(cur * 1000) / 1000 : cur));
      if (v === null || v === undefined || v === "") return;
      const val = typeof cur === "number" ? +String(v).replace(",", ".") : String(v).trim();
      if (typeof cur === "number" && !Number.isFinite(val)) return ui.toast(t("Enter a number."));
      editSelected("Set Keyframe Value", (m) => KO.setKeyValue(m, S.keys, val));
    },
    /** Moves the playhead to the previous (-1) or next (1) keyframe of a clip property, the selected clips or all clips. */
    goKeyframe(dir, { id = null, path = null } = {}) {
      const m = seq();
      const clips = id ? [m.clips[id]].filter(Boolean) : sel().length ? sel().map((x) => m.clips[x]) : M.clipList(m);
      const times = [...new Set(clips.flatMap((c) => KO.keyTimesOf(c, path)))].sort((a, b) => a - b);
      const eps = 0.5 / m.fps;
      const next = dir > 0 ? times.find((x) => x > S.t + eps) : [...times].reverse().find((x) => x < S.t - eps);
      if (next !== undefined) ui.seek(next);
    },
    /** Adds or removes the keyframe of a property at timeline time `at` (default: the playhead). */
    toggleKeyAt(id, paths, at = S.t) {
      const list = Array.isArray(paths) ? paths : [paths];
      const m = seq();
      const c = m.clips[id];
      if (!c) return;
      const local = Math.max(0, Math.min(c.dur, M.snapT(m, at) - c.start));
      const v0 = M.propValue(c, list[0]);
      const has = isTrack(v0) && v0.kf.some((k) => Math.abs(k.t - local) < 0.5 / m.fps);
      if (has) editSelected("Remove Keyframe", (mm) => list.reduce((acc, p) => (isTrack(M.propValue(acc.clips[id], p)) ? M.removeKeyframe(acc, id, p, c.start + local) : acc), mm));
      else editSelected("Add Keyframe", (mm) => list.reduce((acc, p) => M.setKeyframe(acc, id, p, c.start + local, valueAt(M.propValue(acc.clips[id], p), local)), mm));
    },
    /** The stopwatch: animation of a property (or of several together, such as uniform scale) on or off. */
    toggleAnimation(id, paths) {
      const list = Array.isArray(paths) ? paths : [paths];
      const on = !isTrack(M.propValue(seq().clips[id] || {}, list[0]));
      editSelected("Animate Property", (m) => list.reduce((acc, p) => (isTrack(M.propValue(acc.clips[id], p)) === on ? acc : KO.toggleAnimation(acc, id, p, S.t)), m));
    },

    // ------------------------------------------------------------------------------------------- motion tools (scene/rig.js)
    setParent(parentId, ids) {
      const list = targets(ids).filter((id) => seq().clips[id]?.type !== "audio" && id !== parentId);
      editSelected(parentId ? "Parent" : "Unparent", (m) => list.reduce((acc, id) => R.setParent(acc, id, parentId || null, S.t), m));
    },
    toggleMotionBlur(ids) {
      const list = targets(ids).filter((id) => seq().clips[id] && seq().clips[id].type !== "audio");
      const on = !list.every((id) => seq().clips[id].mblur);
      editSelected("Motion Blur", (m) => list.reduce((acc, id) => ({ ...acc, clips: { ...acc.clips, [id]: on ? { ...acc.clips[id], mblur: true } : withoutKey(acc.clips[id], "mblur") } }), m));
    },
    /** Adds a behavior preset: wiggle-position, wiggle-rotation, wiggle-scale, loop, pingpong, spin. */
    addBehavior(preset, ids) {
      const list = targets(ids).filter((id) => seq().clips[id] && seq().clips[id].type !== "audio");
      if (!list.length) return ui.toast(t("Select a picture clip first."));
      editSelected("Add Behavior", (m) =>
        list.reduce((acc, id) => {
          const c = acc.clips[id];
          const seed = Math.floor(Math.random() * 9999);
          const add = (b) => (acc = R.addBehavior(acc, id, b).model);
          if (preset === "wiggle-position") ["x", "y"].forEach((prop, i) => add({ type: "wiggle", prop, amount: 20, freq: 2, seed: seed + i }));
          else if (preset === "wiggle-rotation") add({ type: "wiggle", prop: "rot", amount: 8, freq: 2, seed });
          else if (preset === "wiggle-scale") ["sx", "sy"].forEach((prop) => add({ type: "wiggle", prop, amount: 0.05, freq: 1.5, seed }));
          else if (preset === "spin") add({ type: "spin", prop: "rot", rate: 90 });
          else {
            const animated = M.animatedPaths(c).filter((p) => R.BEHAVIOR_PROPS.includes(p));
            if (!animated.length) throw new Error(t("Loops repeat keyframes: animate a transform property of this clip first."));
            for (const prop of animated) add({ type: "loop", prop, mode: preset === "pingpong" ? "pingpong" : "cycle" });
          }
          return acc;
        }, m),
      );
    },
    updateBehavior: (id, bid, patch) => editSelected(patch === null ? "Remove Behavior" : "Change Behavior", (m) => R.updateBehavior(m, id, bid, patch)),
    async staggerDialog(ids) {
      const list = targets(ids);
      if (list.length < 2) return ui.toast(t("Select two or more clips to sequence."));
      const mode = h("sl-select", { label: t("Mode"), value: "offset" }, h("sl-option", { value: "offset" }, t("Start each clip after a delay")), h("sl-option", { value: "overlap" }, t("Start each clip at the end of the previous one")));
      const step = h("sl-input", { type: "number", label: t("Delay or overlap (seconds)"), value: "0.2", step: "0.04" });
      const order = h("sl-select", { label: t("Order"), value: "track" }, h("sl-option", { value: "track" }, t("Tracks from top to bottom")), h("sl-option", { value: "time" }, t("Current start times")), h("sl-option", { value: "selection" }, t("Selection order")));
      openDialog({
        title: t("Sequence Layers"),
        width: 400,
        body: h("div.of-scene-dlg", mode, step, order),
        buttons: [
          { label: "Cancel", onClick: (close) => close() },
          {
            label: "OK",
            variant: "primary",
            onClick: (close) => {
              const v = +String(step.value).replace(",", ".") || 0;
              editSelected("Sequence Layers", (m) => R.staggerClips(m, list, { step: v, overlap: mode.value === "overlap" ? v : null, order: order.value, moveClip: M.moveClip }));
              close();
            },
          },
        ],
      });
    },
    /** Drives a property of clip `id` by the loudness of an audio clip (bakes keyframes; scene/rig.js ▸ audioToKeyframes). */
    async audioDialog(id = sel()[0]) {
      const m = seq();
      const c = m.clips[id];
      if (!c || c.type === "audio") return ui.toast(t("Select a picture clip to animate with sound."));
      const sources = M.clipList(m).filter((x) => (x.type === "audio" || (x.type === "video" && m.media[x.media]?.hasAudio)) && x.start < M.clipEnd(c) && M.clipEnd(x) > c.start);
      if (!sources.length) return ui.toast(t("There is no sound under this clip. Place an audio clip at the same time first."));
      const src = h("sl-select", { label: t("Sound"), value: optVal(sources[0].id) }, ...sources.map((x) => h("sl-option", { value: optVal(x.id) }, `${x.name} (${M.timecode(m, x.start).slice(3)})`)));
      const prop = h("sl-select", { label: t("Property"), value: "scale" }, ...[["scale", "Scale"], ["opacity", "Opacity"], ["rot", "Rotation"], ["y", "Position Y"], ["x", "Position X"]].map(([v, l]) => h("sl-option", { value: optVal(v) }, t(l))));
      const min = h("sl-input", { type: "number", label: t("Value when quiet"), value: "1", step: "0.05" });
      const max = h("sl-input", { type: "number", label: t("Value when loud"), value: "1.25", step: "0.05" });
      const smooth = h("sl-range", { label: t("Smoothing"), min: "0", max: "0.95", step: "0.05", value: "0.6" });
      const defaults = { scale: [1, 1.25], opacity: [0.3, 1], rot: [0, 15], y: [c.y, c.y - 40], x: [c.x, c.x + 40] };
      prop.addEventListener("sl-change", () => {
        const d = defaults[optDecode(prop.value)];
        min.value = String(typeof d[0] === "number" ? Math.round(d[0] * 100) / 100 : 0);
        max.value = String(typeof d[1] === "number" ? Math.round(d[1] * 100) / 100 : 1);
      });
      openDialog({
        title: t("Animate with Sound"),
        width: 420,
        body: h("div.of-scene-dlg", h("p.of-scene-insp__hint", t("Keyframes follow the loudness of the sound, frame by frame. Edit or delete them like any keyframes.")), src, prop, min, max, smooth),
        buttons: [
          { label: "Cancel", onClick: (close) => close() },
          {
            label: "Create keyframes",
            variant: "primary",
            onClick: async (close) => {
              close();
              try {
                const a = seq().clips[optDecode(src.value)];
                const [{ channelsOf }, { mixMono, levelsDb }] = await Promise.all([import("./ai-runtime.js"), import("./analysis.js")]);
                const ctx = { model: () => ui.model(), store: ui.store };
                const { channels, rate } = await channelsOf(ctx, a.media, 16000);
                const levels = levelsDb(mixMono(channels), rate, { hop: 1 / Math.max(25, seq().fps), win: 2 / Math.max(25, seq().fps) });
                const r = R.audioToKeyframes(seq(), { id, prop: optDecode(prop.value), audio: a.id, levels, min: +min.value, max: +max.value, smooth: +smooth.value }, { setProp: M.setProp });
                ui.commitSeq("Animate with Sound", r.model);
                ui.toast(t("{n} keyframes created.", { n: r.keys }), "success");
              } catch (err) {
                ui.toast(err.message);
              }
            },
          },
        ],
      });
    },
    /** Adds markers at the beats of a clip's sound (analyses the sound first when needed). */
    async beatMarkers(id = sel()[0]) {
      const c = seq().clips[id];
      if (!c?.media) return ui.toast(t("Select an audio or video clip with sound."));
      try {
        if (!ui.model().analysis?.[c.media]?.beats) {
          ui.toast(t("Finding the beats…"), "primary");
          const { analyzeAudioOf } = await import("./ai-runtime.js");
          const res = await analyzeAudioOf({ model: () => ui.model(), store: ui.store }, c.media, { beats: true });
          ui.commit("Analyze Sound", M.setAnalysis(ui.model(), c.media, { silence: res.silence, loudness: res.loudness, beats: res.beats }));
        }
        const times = R.beatMarkerTimes(seq(), c.media);
        if (!times.length) return ui.toast(t("No beats were found in this sound."));
        editSelected("Beat Markers", (m) => times.reduce((acc, tt) => (acc.markers.some((k) => Math.abs(k.t - tt) < 0.5 / acc.fps) ? acc : M.addMarker(acc, tt, "", "#22c55e").model), m));
        ui.toast(t("{n} beat markers added.", { n: times.length }), "success");
      } catch (err) {
        ui.toast(err.message);
      }
    },

    // ------------------------------------------------------------------------------------------- viewer
    arrange: (dir, id = sel()[0]) => id && editSelected("Arrange", (m) => E.arrangeClip(m, id, dir)),
    resetTransform(id = sel()[0]) {
      const m = seq();
      const c = m.clips[id];
      if (!c || c.type === "audio") return;
      editSelected("Reset Transform", (mm) => {
        const n = { ...mm.clips[id], x: m.width / 2, y: m.height / 2, sx: 1, sy: 1, rot: 0, opacity: 1 };
        delete n.ax;
        delete n.ay;
        return { ...mm, clips: { ...mm.clips, [id]: n } };
      });
    },
    /** Viewer guides: safe areas, thirds, center cross, motion path (shown unless turned off). */
    toggleGuide(name) {
      S.guides ||= {};
      const cur = name === "path" ? S.guides.path !== false : !!S.guides[name];
      S.guides[name] = !cur;
      ui.requestDraw();
    },
    gapAt: (track, at) => E.gapAt(seq(), track, at),
    goToKey() {
      const k = S.keys[0];
      const c = k && seq().clips[k.id];
      if (c) ui.seek(c.start + k.t);
    },
  };
  return A;
}

const withoutKey = (o, k) => {
  const n = { ...o };
  delete n[k];
  return n;
};
