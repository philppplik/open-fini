// Scene Studio workspace (docs/scene-studio.md ▸ Workspace): media bin (left), viewer with transport (center),
// inspector (right), tool strip and timeline (bottom): the layout video editors share. One instance per open scene
// document, created by scene/host.js.
//
//   mountScene(host, doc, app) → instance
// The instance is also the API the commands (commands/scene.js) and the assistant's tools (vibe/tools/scene.js) use:
//   model(), commit(label, next, opts), select(ids), seek(t), play(), pause(), toggle(), state, store,
//   importFiles(files), addText(), addShape(kind), addSolid(), addAdjustment(), splitAtPlayhead(), deleteSelection(),
//   setIn() / setOut(), addMarker(), step(frames), goEdit(dir), setTool(id), fit(), frame(t, scale) → canvas
// Clock: while playing, the audio engine's context time is the master; the viewer draws the frame of that time on
// every animation frame and the <video> elements follow it. Paused, the viewer draws state.t.
// Invariants: every edit is ONE commitOffice step (undo / redo, history panel, autosave); view state (playhead,
// zoom, selection, tool) is never saved; the instance releases its media store and audio context in destroy().
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { commitOffice } from "../core/office.js";
import { platform } from "../platform/index.js";
import { promptDialog, confirmDialog } from "../ui/dialogs.js";
import * as M from "./model.js";
import { isTrack, valueAt } from "./keyframes.js";
import { sourceTime } from "./evaluate.js";
import { createCompositor, textSize } from "./render.js";
import { createMediaStore, probeMedia, mediaKind } from "./media.js";
import { createAudioEngine } from "./audio.js";
import { createTimeline } from "./timeline.js";
import { createInspector } from "./inspector.js";

const TOOLS = [
  { id: "select", icon: "cursor", label: "Selection tool (V)", key: "v" },
  { id: "razor", icon: "scissors", label: "Razor tool (C)", key: "c" },
  { id: "slip", icon: "arrows-collapse", label: "Slip tool (Y)", key: "y" },
  { id: "hand", icon: "hand-index", label: "Hand tool (H)", key: "h" },
];
const SHUTTLE = [1, 2, 4, 8];
const isMod = (e) => (/Mac|iPhone|iPad/.test(navigator.platform || "") ? e.metaKey : e.ctrlKey);

/** The model of a scene document, normalized once (older files, foreign input). */
export function ensureScene(prj) {
  if (prj.model?._raw || prj.model?.version !== M.SCENE_VERSION || !Array.isArray(prj.model?.tracks)) {
    const { _raw, ...rest } = prj.model || {};
    prj.model = M.normalizeScene(rest);
  }
  return prj.model;
}

export function mountScene(host, doc, app) {
  const prj = doc.office;
  ensureScene(prj);
  const state = (prj.view.scene ||= { t: 0, zoom: 80, scrollX: 0, scrollY: 0, snap: true, tool: "select", loop: false });
  state.sel = new Set();
  // open sequences: tabs (composition ids besides "main"), the breadcrumb of each tab and its playhead
  state.seq ||= "main";
  state.tabs ||= [];
  state.paths ||= {};
  state.times ||= {};
  state.graph = false;
  let playing = false;
  let rate = 1;
  let destroyed = false;
  let active = false;
  let raf = 0;
  let dirty = true;
  let peaks = new Map(); // media id → { rate, data } | "loading"

  // The timeline edits one sequence at a time: the root ("main") or an opened composition (state.seq). `rootModel()` is
  // the whole model (saved, undone, exported); `model()` here is the sequence on the timeline (scene/model.js ▸
  // sequence: the composition's tracks and clips plus the shared fps, media and comps).
  const rootModel = () => prj.model;
  let memo = { r: null, s: null, v: null };
  const model = () => {
    const r = prj.model;
    const s = state.seq || "main";
    if (s === "main") return r;
    if (!r.comps?.[s]) {
      state.seq = "main";
      return r;
    }
    if (memo.r !== r || memo.s !== s) memo = { r, s, v: M.sequence(r, s) };
    return memo.v;
  };
  const requestDraw = () => {
    dirty = true;
    if (!raf && !destroyed) raf = requestAnimationFrame(tick);
  };
  const store = createMediaStore(rootModel, () => requestDraw());
  const audio = createAudioEngine(store);
  const compositor = createCompositor({ provider: store });

  // ------------------------------------------------------------------------------------------- DOM
  const canvas = h("canvas.of-scene-view__canvas");
  const overlay = h("canvas.of-scene-view__overlay");
  const stage = h("div.of-scene-view__stage", canvas, overlay);
  const tc = h("output.of-scene-tc", { title: t("Current time (hours:minutes:seconds:frames)") }, "00:00:00:00");
  const total = h("span.of-scene-tc__total", "00:00:00:00");
  const meterL = h("i");
  const meterR = h("i");
  const ibtn = (icon, label, fn, extra = {}) => {
    const b = h("button.of-scene-btn", { type: "button", title: t(label), "aria-label": t(label), ...extra }, h("sl-icon", { name: icon }));
    b.addEventListener("click", fn);
    return b;
  };
  const playBtn = ibtn("play-circle", "Play / Pause (Space)", () => api.toggle());
  const loopBtn = ibtn("arrow-repeat", "Loop playback", () => {
    state.loop = !state.loop;
    loopBtn.setAttribute("aria-pressed", String(state.loop));
  }, { "aria-pressed": String(state.loop) });
  const transport = h("div.of-scene-transport", { role: "toolbar", "aria-label": t("Transport") },
    tc,
    h("div.of-scene-transport__mid",
      ibtn("chevron-double-left", "Go to start (Home)", () => api.seek(0)),
      ibtn("arrow-left", "Previous edit (Up)", () => api.goEdit(-1)),
      ibtn("chevron-left", "Step back one frame (Left)", () => api.step(-1)),
      playBtn,
      ibtn("chevron-right", "Step forward one frame (Right)", () => api.step(1)),
      ibtn("arrow-right", "Next edit (Down)", () => api.goEdit(1)),
      ibtn("chevron-double-right", "Go to end (End)", () => api.seek(M.duration(model()))),
      loopBtn),
    h("div.of-scene-transport__right", h("span.of-scene-meter", { title: t("Output level"), "aria-hidden": "true" }, meterL, meterR), total));
  const viewer = h("div.of-scene-view", stage, transport);

  const binList = h("div.of-scene-bin__list", { role: "list" });
  const compBar = h("div.of-scene-bin__comp");
  const addBtn = (icon, label, fn) => {
    const b = h("button.of-scene-bin__add", { type: "button" }, h("sl-icon", { name: icon }), h("span", t(label)));
    b.addEventListener("click", fn);
    return b;
  };
  const bin = h("div.of-scene-bin", { role: "region", "aria-label": t("Media") },
    h("div.of-scene-bin__head", h("h3", t("Media")), ibtn("plus-lg", "Import media…", () => api.importDialog())),
    binList,
    h("div.of-scene-bin__adds",
      addBtn("fonts", "Text", () => api.addText()),
      addBtn("square", "Shape", () => api.addShape("rect")),
      addBtn("palette", "Solid", () => api.addSolid()),
      addBtn("layers-half", "Adjustment", () => api.addAdjustment())),
    compBar,
    h("datalist", { id: "of-scene-fonts" }, ["Inter", "Arial", "Georgia", "Times New Roman", "Courier New", "Impact", "Verdana", "Trebuchet MS", "Segoe UI", "Helvetica"].map((f) => h("option", { value: f }))));

  const toolBtns = new Map();
  let graph = null; // the graph editor (scene/graph.js), created on first use
  const graphBtn = ibtn("bezier2", "Graph editor (Shift+F3)", () => api.toggleGraph(), { "aria-pressed": "false" });
  const seqBar = h("div.of-scene-seqbar", { role: "tablist", "aria-label": t("Sequences") });
  const snapBtn = ibtn("magnet", "Snapping (S)", () => api.toggleSnap(), { "aria-pressed": String(state.snap) });
  const strip = h("div.of-scene-strip", { role: "toolbar", "aria-label": t("Timeline tools") },
    ...TOOLS.map((d) => {
      const b = ibtn(d.icon, d.label, () => api.setTool(d.id), { "aria-pressed": String(state.tool === d.id) });
      toolBtns.set(d.id, b);
      return b;
    }),
    h("span.of-scene-strip__sep"),
    snapBtn,
    ibtn("layout-split", "Split at playhead (Ctrl+K)", () => api.splitAtPlayhead()),
    ibtn("trash", "Delete (Delete; Shift+Delete closes the gap)", () => api.deleteSelection()),
    ibtn("bookmark-plus", "Add marker (M)", () => api.addMarker()),
    h("span.of-scene-strip__sep"),
    ibtn("plus-square", "Add video track", () => api.addTrack("video")),
    ibtn("music-note-beamed", "Add audio track", () => api.addTrack("audio")),
    h("span.of-scene-strip__sep"),
    graphBtn,
    h("span.of-scene-strip__grow"),
    ibtn("zoom-out", "Zoom out (-)", () => api.zoomBy(1 / 1.4)),
    ibtn("zoom-in", "Zoom in (+)", () => api.zoomBy(1.4)),
    ibtn("aspect-ratio", "Fit the sequence (\\)", () => timeline.fit()));

  const live = h("div.of-scene__live", { role: "status", "aria-live": "polite" });
  const root = h("div.of-scene", { tabindex: "0", role: "application", "aria-label": t("Scene editor"), "aria-roledescription": t("video editor") });

  // ------------------------------------------------------------------------------------------- API
  const api = {
    kind: "scene",
    doc,
    state,
    store,
    compositor,
    audio,
    /** The whole scene model (what is saved and exported). */
    model: rootModel,
    /** The sequence on the timeline: the root, or the opened composition (scene/model.js ▸ sequence). */
    seqModel: model,
    /** Id of the sequence on the timeline: "main" or a composition id. */
    get seq() {
      return state.seq || "main";
    },
    requestDraw,
    focus: () => {
      if (!root.contains(document.activeElement) || document.activeElement === document.body) root.focus({ preventScroll: true });
    },
    toast: (msg, variant = "warning") => app.toast(msg, variant),
    prompt: (title, value) => promptDialog({ title, value }),
    peaksOf(id) {
      const got = peaks.get(id);
      if (got) return got === "loading" ? null : got;
      peaks.set(id, "loading");
      store.peaks(id).then((p) => {
        if (p) peaks.set(id, p);
        requestDraw();
      });
      return null;
    },

    /** Applies a new model as one undo step. Returns the model. */
    commit(label, next, opts = {}) {
      if (!next || next === prj.model) return prj.model;
      commitOffice(doc, label, next, opts);
      return next;
    },
    /** Applies an edited sequence (from seqModel()) as one undo step. */
    commitSeq(label, next, opts = {}) {
      if (!next || next === model()) return prj.model;
      const seq = state.seq || "main";
      return api.commit(label, seq === "main" ? next : M.commitSequence(prj.model, seq, next), opts);
    },
    // --------------------------------------------------------------------------- sequences (compositions)
    /**
     * Shows a sequence on the timeline: "main" or a composition id. `from` = { clip } of the parent sequence when
     * a composition is opened from its clip: the breadcrumb extends and the playhead maps into the composition.
     */
    openSequence(seq, { from = null } = {}) {
      const r = rootModel();
      if (seq !== "main" && !r.comps?.[seq]) return;
      api.pause();
      const cur = state.seq || "main";
      state.times[cur] = state.t;
      let path = state.paths[seq];
      if (from) {
        const c = model().clips[from.clip];
        path = [...(state.paths[cur] || ["main"]), seq].filter((x, i, a) => a.indexOf(x) === i);
        if (c) state.times[seq] = c.remap !== undefined || c.in !== undefined ? Math.max(0, sourceTime(c, Math.max(0, Math.min(c.dur, state.t - c.start)))) : 0;
      }
      if (seq !== "main" && !state.tabs.includes(seq)) state.tabs.push(seq);
      state.paths[seq] = path || (seq === "main" ? ["main"] : ["main", seq]);
      state.seq = seq;
      state.sel = new Set();
      state.t = M.snapT(r, state.times[seq] || 0);
      renderSeqBar();
      requestAnimationFrame(() => timeline.fit());
      requestDraw();
      app.emit("scenestatus");
    },
    /** Closes the tab of a composition (the composition stays in the project). */
    closeSequence(seq) {
      state.tabs = state.tabs.filter((x) => x !== seq);
      if ((state.seq || "main") === seq) api.openSequence("main");
      else renderSeqBar();
    },
    /** Opens the composition of a composition clip in its own tab (double-click on the clip). */
    openCompClip(id) {
      const c = model().clips[id];
      if (c?.type === "comp") api.openSequence(c.comp, { from: { clip: id } });
    },
    newComposition() {
      const r = M.addComp(rootModel(), { name: t("Composition {n}", { n: Object.keys(rootModel().comps).length + 1 }) });
      api.commit("New Composition", r.model);
      api.openSequence(r.id);
    },
    /** Places a composition at the playhead of the sequence on the timeline (refused when it would contain itself). */
    placeComp(compId, { start = state.t, track = null } = {}) {
      try {
        const r = M.placeComp(model(), compId, { start, track });
        api.commitSeq("Add Composition", r.model);
        api.select([r.id]);
      } catch (err) {
        api.toast(err.message);
      }
    },
    async renameComp(compId) {
      const k = rootModel().comps[compId];
      const v = k && (await api.prompt(t("Composition name"), k.name));
      if (v) api.commit("Rename Composition", M.updateComp(rootModel(), compId, { name: v }));
    },
    async removeComp(compId) {
      const uses = M.compUsage(rootModel(), compId).length;
      if (uses && !(await confirmDialog({ title: "Delete composition", message: t("This composition is used by {n} clips. Delete it and those clips?", { n: uses }), ok: "Delete", danger: true }))) return;
      api.closeSequence(compId);
      api.commit("Delete Composition", M.removeComp(rootModel(), compId));
    },
    // --------------------------------------------------------------------------- graph editor
    /** Shows or hides the graph editor (loaded on first use) in place of the timeline. */
    async toggleGraph(on = !state.graph) {
      state.graph = !!on;
      graphBtn.setAttribute("aria-pressed", String(state.graph));
      if (state.graph && !graph) {
        const { createGraphEditor } = await import("./graph.js");
        if (destroyed) return;
        graph = createGraphEditor(api);
        timeline.el.after(graph.el);
      }
      timeline.el.hidden = state.graph;
      if (graph) graph.el.hidden = !state.graph;
      if (state.graph) requestAnimationFrame(() => graph?.fit());
      requestDraw();
    },
    select(ids, { add = false } = {}) {
      const next = add ? new Set(state.sel) : new Set();
      for (const id of ids) {
        if (add && state.sel.has(id) && ids.length === 1) next.delete(id);
        else next.add(id);
      }
      state.sel = next;
      requestDraw();
      app.emit("scenestatus");
    },
    seek(time, { scrub = false } = {}) {
      const m = model();
      state.t = M.snapT(m, Math.max(0, Number.isFinite(time) ? time : M.duration(m)));
      if (playing && !scrub) startAudio();
      if (playing && scrub) api.pause();
      requestDraw();
    },
    step(frames) {
      api.pause();
      api.seek(state.t + frames / model().fps);
    },
    goEdit(dir) {
      const pts = M.editPoints(model());
      const eps = 0.5 / model().fps;
      const next = dir > 0 ? pts.find((p) => p > state.t + eps) : [...pts].reverse().find((p) => p < state.t - eps);
      if (next !== undefined) api.seek(next);
    },
    play(playRate = 1) {
      const m = model();
      if (state.t >= M.duration(m) - 0.5 / m.fps) state.t = m.range ? m.range.in : 0;
      rate = playRate;
      playing = true;
      store.setPlaying(true, rate);
      startAudio();
      playBtn.firstChild.name = "pause";
      requestDraw();
    },
    pause() {
      if (!playing) return;
      const now = audio.time();
      if (now !== null) state.t = M.snapT(model(), now);
      playing = false;
      rate = 1;
      audio.stop();
      store.setPlaying(false);
      playBtn.firstChild.name = "play-circle";
      requestDraw();
    },
    toggle: () => (playing ? api.pause() : api.play()),
    get playing() {
      return playing;
    },
    /** J / K / L: L plays forward, again = faster; K stops; J steps back one second (reverse playback is not supported). */
    shuttle(dir) {
      if (dir === 0) return api.pause();
      if (dir < 0) {
        api.pause();
        return api.seek(state.t - 1);
      }
      const i = playing ? SHUTTLE.indexOf(rate) : -1;
      api.play(SHUTTLE[Math.min(SHUTTLE.length - 1, i + 1)]);
    },
    setTool(id) {
      state.tool = id;
      for (const [k, b] of toolBtns) b.setAttribute("aria-pressed", String(k === id));
      requestDraw();
    },
    toggleSnap() {
      state.snap = !state.snap;
      snapBtn.setAttribute("aria-pressed", String(state.snap));
    },
    zoomBy(f) {
      const center = state.t * state.zoom - state.scrollX;
      state.zoom = Math.max(2, Math.min(2000, state.zoom * f));
      state.scrollX = Math.max(0, state.t * state.zoom - center);
      requestDraw();
    },
    fit: () => timeline.fit(),

    // --------------------------------------------------------------------------- editing
    selection: () => [...state.sel].filter((id) => model().clips[id]),
    splitAtPlayhead() {
      const m = model();
      const ids = api.selection();
      const r = ids.length ? ids.reduce((acc, id) => {
        const s = M.splitClip(acc.model, id, state.t);
        return { model: s.model, ids: s.id ? [...acc.ids, s.id] : acc.ids };
      }, { model: m, ids: [] }) : M.splitAll(m, state.t);
      api.commitSeq("Split Clip", r.model);
    },
    deleteSelection({ ripple = false } = {}) {
      const ids = api.selection();
      if (!ids.length) return;
      api.commitSeq(ripple ? "Ripple Delete" : "Delete Clip", M.deleteClips(model(), ids, { ripple }));
      api.select([]);
    },
    duplicateSelection() {
      const r = M.duplicateClips(model(), api.selection());
      if (r.ids.length) {
        api.commitSeq("Duplicate Clip", r.model);
        api.select(r.ids);
      }
    },
    selectAll: () => api.select(Object.keys(model().clips)),
    /** Trims the clips under the playhead (or the selection) so they start (Q) or end (W) at the playhead, closing the gap. */
    rippleTrimTo(edge) {
      let m = model();
      const ids = api.selection().length ? api.selection() : M.clipList(m).filter((c) => state.t > c.start && state.t < M.clipEnd(c) && !M.trackOf(m, c.track).locked).map((c) => c.id);
      for (const id of ids) m = M.trimClip(m, id, edge, state.t, { ripple: true });
      api.commitSeq("Ripple Trim", m);
      if (edge === "start" && ids.length) api.seek(Math.min(...ids.map((id) => m.clips[id].start)));
    },
    setIn() {
      if (api.seq !== "main") return api.toast(t("In and Out points belong to the main sequence."));
      const m = model();
      api.commitSeq("Set In Point", M.setRange(m, state.t, m.range && m.range.out > state.t ? m.range.out : M.duration(m) || state.t + 1));
    },
    setOut() {
      if (api.seq !== "main") return api.toast(t("In and Out points belong to the main sequence."));
      const m = model();
      api.commitSeq("Set Out Point", M.setRange(m, m.range && m.range.in < state.t ? m.range.in : 0, state.t));
    },
    clearRange: () => api.commitSeq("Clear In and Out", M.setRange(model(), null, null)),
    /** Removes the In / Out range: lift leaves a gap, extract closes it. */
    removeRange(extract) {
      const m = model();
      if (!m.range) return api.toast(t("Set an In and an Out point first (I and O)."));
      const { in: a, out: b } = m.range;
      if (extract) return api.commitSeq("Extract", M.setRange(M.cutRanges(m, [[a, b]]), null, null));
      let next = M.splitAll(M.splitAll(m, a).model, b).model;
      next = M.deleteClips(next, Object.values(next.clips).filter((c) => c.start >= a - 1e-6 && M.clipEnd(c) <= b + 1e-6 && !M.trackOf(next, c.track).locked).map((c) => c.id));
      api.commitSeq("Lift", next);
    },
    addMarker() {
      api.commitSeq("Add Marker", M.addMarker(model(), state.t, "").model);
    },
    addTrack: (kind) => api.commitSeq("Add Track", M.addTrack(model(), kind).model),
    precompose() {
      const ids = api.selection();
      if (!ids.length) return;
      try {
        const r = M.precompose(model(), ids, t("Composition"));
        api.commitSeq("Pre-compose", r.model);
        api.select([r.id]);
      } catch (err) {
        api.toast(err.message);
      }
    },
    addClipAtPlayhead(props, label) {
      const r = M.addClip(model(), { start: state.t, dur: 5, ...props });
      api.commitSeq(label, r.model);
      api.select([r.id]);
      return r.id;
    },
    addText(text = "") {
      const id = api.addClipAtPlayhead({ type: "text", text: { text: text || t("Your text") } }, "Add Text");
      requestAnimationFrame(() => inspector.focusText(id));
      return id;
    },
    addShape: (kind = "rect") => api.addClipAtPlayhead({ type: "shape", shape: { kind } }, "Add Shape"),
    addSolid: () => api.addClipAtPlayhead({ type: "solid" }, "Add Solid"),
    addAdjustment: () => api.addClipAtPlayhead({ type: "adjustment", name: "Adjustment layer" }, "Add Adjustment Layer"),
    editClip(id) {
      if (model().clips[id]?.type === "comp") return api.openCompClip(id);
      api.select([id]);
      if (model().clips[id]?.type === "text") requestAnimationFrame(() => inspector.focusText(id));
    },
    /** Sets a property: a keyframe at the playhead when the property is animated, else the constant. */
    setProp(id, path, value) {
      api.commitSeq("Change Property", M.setProp(model(), id, path, value, state.t), { coalesce: `scene:${id}:${path}` });
    },
    setProps(id, values) {
      let m = model();
      for (const [k, v] of Object.entries(values)) m = M.setProp(m, id, k, v, state.t);
      api.commitSeq("Change Property", m, { coalesce: `scene:${id}:${Object.keys(values).join()}` });
    },
    fitClip(id, mode) {
      const m = model();
      const c = m.clips[id];
      if (!c) return;
      const size = M.layerSize(m, c, textSize);
      const s = mode === "fill" ? Math.max(m.width / size.w, m.height / size.h) : Math.min(m.width / size.w, m.height / size.h);
      api.setProps(id, { x: m.width / 2, y: m.height / 2, sx: s, sy: s });
    },
    /** Changes the frame size and keeps every layer where it was relative to the frame. */
    resizeSequence(w, hgt) {
      const m = model();
      const fx = w / m.width;
      const fy = hgt / m.height;
      const k = Math.min(fx, fy);
      // values and tangent speeds (value units per second) scale alike
      const scaleV = (v, f) => (isTrack(v) ? { kf: v.kf.map((q) => ({ ...q, v: q.v * f, ...(q.i ? { i: [q.i[0] * f, q.i[1]] } : {}), ...(q.o ? { o: [q.o[0] * f, q.o[1]] } : {}) })) } : v * f);
      const clips = Object.fromEntries(Object.entries(m.clips).map(([id, c]) => [id, c.type === "audio" ? c : { ...c, x: scaleV(c.x, fx), y: scaleV(c.y, fy), sx: scaleV(c.sx, k), sy: scaleV(c.sy, k) }]));
      if (api.seq !== "main") return api.commitSeq("Change Composition Size", { ...m, width: Math.round(w), height: Math.round(hgt), clips });
      api.commitSeq("Change Sequence Size", M.normalizeScene({ ...m, width: w, height: hgt, clips }));
    },
    async importDialog() {
      const files = await platform.openFiles({ accept: [{ description: "Media", extensions: ["mp4", "m4v", "mov", "webm", "mkv", "mp3", "wav", "m4a", "aac", "ogg", "flac", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "srt", "vtt"] }], multiple: true }).catch(() => []);
      if (files?.length) await api.importFiles(files);
    },
    /** Imports files into the bin ({ name, bytes, mime }[]). Subtitle files become caption clips. @returns media ids */
    async importFiles(files, { place = false } = {}) {
      const ids = [];
      for (const f of files) {
        try {
          if (/\.(srt|vtt)$/i.test(f.name)) {
            const { parseSubtitles, captionsToClips } = await import("./captions.js");
            const cues = parseSubtitles(new TextDecoder().decode(f.bytes));
            api.commitSeq("Import Captions", captionsToClips(model(), cues).model);
            continue;
          }
          if (!mediaKind(f.name, f.mime)) throw new Error(t("“{name}” is not a video, audio or image file.", { name: f.name }));
          const item = await probeMedia(f.bytes, f.name, f.mime);
          const r = M.addMedia(model(), item);
          let next = r.model;
          if (place) next = M.placeMedia(next, r.id, { start: M.duration(next) }).model;
          api.commitSeq("Import Media", next);
          ids.push(r.id);
        } catch (err) {
          app.toast(t("“{name}” could not be imported: {message}", { name: f.name, message: err.message }), "danger", 6000);
        }
      }
      if (ids.length) live.textContent = t("{n} media files imported.", { n: ids.length });
      return ids;
    },
    /** A frame of the sequence on a fresh canvas with exactly seeked sources (thumbnails, tools, export preview). */
    async frame(time = state.t, scale = 1, opts = {}) {
      const { renderExact } = await import("./frames.js");
      return renderExact(store, rootModel(), time, { scale, ...opts });
    },
    activate() {
      active = true;
      requestDraw();
    },
    deactivate() {
      active = false;
      api.pause();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      offChange();
      timeline.destroy();
      graph?.destroy();
      ro.disconnect();
      audio.destroy();
      store.destroy();
    },
  };

  const timeline = createTimeline(api);
  const inspector = createInspector(api);
  // the bottom area: sequence tabs over the timeline, or over the graph editor when it is on
  root.append(h("div.of-scene__top", bin, viewer, inspector.el), strip, h("div.of-scene__bottom", seqBar, timeline.el), live);
  host.replaceChildren(root);

  function startAudio() {
    audio.start(rootModel(), state.t, rate, state.seq || "main").catch(() => {});
  }

  // ------------------------------------------------------------------------------------------- sequence tabs
  // One tab per open sequence (Main plus opened compositions); the breadcrumb shows how the active one was reached.
  let seqKey = "";
  function renderSeqBar() {
    const r = rootModel();
    state.tabs = state.tabs.filter((id) => r.comps[id]);
    const cur = state.seq || "main";
    const path = (state.paths[cur] || ["main"]).filter((id) => id === "main" || r.comps[id]);
    const nameOf = (id) => (id === "main" ? t("Main") : r.comps[id].name);
    const key = [cur, ...state.tabs.map((id) => id + nameOf(id)), "|", ...path.map(nameOf)].join("\u0001");
    if (key === seqKey) return;
    seqKey = key;
    seqBar.hidden = !state.tabs.length;
    const tab = (id) => {
      const b = h("button.of-scene-seqbar__tab", { type: "button", role: "tab", "aria-selected": String(id === cur), title: nameOf(id) }, h("sl-icon", { name: id === "main" ? "file-earmark-play" : "collection" }), h("span", nameOf(id)));
      b.addEventListener("click", () => api.openSequence(id));
      if (id === "main") return b;
      const x = h("button.of-scene-seqbar__close", { type: "button", title: t("Close tab"), "aria-label": t("Close tab") }, h("sl-icon", { name: "x-lg" }));
      x.addEventListener("click", () => api.closeSequence(id));
      return h("span.of-scene-seqbar__item", b, x);
    };
    const crumbs = h("nav.of-scene-seqbar__crumbs", { "aria-label": t("Composition path") }, ...path.flatMap((id, i) => {
      const last = i === path.length - 1;
      const c = h(last ? "span" : "button", last ? { "aria-current": "location" } : { type: "button" }, nameOf(id));
      if (!last) c.addEventListener("click", () => api.openSequence(id));
      return i ? [h("i", { "aria-hidden": "true" }, "›"), c] : [c];
    }));
    seqBar.replaceChildren(tab("main"), ...state.tabs.map(tab), h("span.of-scene-seqbar__grow"), path.length > 1 ? crumbs : "");
  }

  // ------------------------------------------------------------------------------------------- bin
  let binKey = "";
  function renderBin() {
    const m = model();
    const key = Object.values(m.media).map((x) => x.id + x.name).join("|") + "#" + Object.values(m.comps).map((k) => `${k.id}${k.name}${M.duration(k)}${k.id === state.seq}`).join("|");
    if (key === binKey) return;
    binKey = key;
    renderComps(m);
    const items = Object.values(m.media);
    binList.replaceChildren(...(items.length ? items.map((x) => {
      const thumb = h("span.of-scene-bin__thumb", h("sl-icon", { name: x.kind === "audio" ? "music-note-beamed" : x.kind === "image" ? "image" : "file-earmark-play" }));
      if (x.kind !== "audio") {
        const paint = () => {
          const c = store.thumb(x.id, Math.min(1, x.duration / 2 || 0), 40);
          if (c) thumb.replaceChildren(Object.assign(h("img", { alt: "" }), { src: c.toDataURL("image/jpeg", 0.7) }));
          else if (!destroyed && thumb.isConnected) setTimeout(paint, 400);
        };
        paint();
      }
      const del = h("button.of-scene-insp__x", { type: "button", title: t("Remove from the project"), "aria-label": t("Remove from the project") }, h("sl-icon", { name: "x-lg" }));
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        api.commit("Remove Media", M.removeMedia(rootModel(), x.id));
      });
      const el = h("div.of-scene-bin__item", { role: "listitem", draggable: "true", tabindex: "0", title: t("Drag to the timeline, or double-click to add at the playhead") },
        thumb, h("span.of-scene-bin__name", x.name), h("span.of-scene-bin__dur", x.duration ? M.timecode(m, x.duration).slice(3, 8) : ""), del);
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-ofini-scene-media", x.id);
        e.dataTransfer.effectAllowed = "copy";
      });
      const place = () => {
        try {
          const r = M.placeMedia(model(), x.id, { start: state.t });
          api.commitSeq("Add Clip", r.model);
          api.select(r.ids);
        } catch (err) {
          api.toast(err.message);
        }
      };
      el.addEventListener("dblclick", place);
      el.addEventListener("keydown", (e) => e.key === "Enter" && place());
      return el;
    }) : [h("p.of-scene-bin__empty", t("Drop video, audio and image files here, or use the plus button."))]));
  }

  // the project's compositions: open (double-click), drag to the timeline, rename, delete, new
  function renderComps(m) {
    const list = Object.values(m.comps).sort((a, b) => a.name.localeCompare(b.name));
    const head = h("div.of-scene-bin__head", h("h3", t("Compositions")), ibtn("plus-lg", "New composition", () => api.newComposition()));
    compBar.replaceChildren(head, h("div.of-scene-bin__list", { role: "list", "aria-label": t("Compositions") }, ...list.map((k) => {
      const ren = h("button.of-scene-insp__x", { type: "button", title: t("Rename"), "aria-label": t("Rename") }, h("sl-icon", { name: "pencil" }));
      ren.addEventListener("click", (e) => {
        e.stopPropagation();
        api.renameComp(k.id);
      });
      const del = h("button.of-scene-insp__x", { type: "button", title: t("Delete composition"), "aria-label": t("Delete composition") }, h("sl-icon", { name: "x-lg" }));
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        api.removeComp(k.id);
      });
      const d = M.duration(k);
      const el = h("div.of-scene-bin__item", { role: "listitem", draggable: "true", tabindex: "0", "aria-current": String(k.id === state.seq), title: t("Double-click to open; drag to the timeline to use it") },
        h("span.of-scene-bin__thumb", h("sl-icon", { name: "collection" })), h("span.of-scene-bin__name", k.name), h("span.of-scene-bin__dur", d ? M.timecode(m, d).slice(3, 8) : ""), ren, del);
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-ofini-scene-comp", k.id);
        e.dataTransfer.effectAllowed = "copy";
      });
      el.addEventListener("dblclick", () => api.openSequence(k.id));
      // Enter opens, Shift+Enter places it at the playhead
      el.addEventListener("keydown", (e) => e.key === "Enter" && (e.shiftKey ? api.placeComp(k.id) : api.openSequence(k.id)));
      return el;
    })));
  }

  bin.addEventListener("dragover", (e) => {
    if ([...e.dataTransfer.types].includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  root.addEventListener("drop", async (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => mediaKind(f.name, f.type) || /\.(srt|vtt)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    api.importFiles(loaded, { place: !timeline.el.contains(e.target) ? false : true });
  }, true);
  root.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // ------------------------------------------------------------------------------------------- viewer
  let vw = 0;
  let vh = 0;
  let vscale = 1;
  function layoutViewer() {
    const m = model();
    const r = stage.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const fit = Math.min((r.width - 16) / m.width, (r.height - 16) / m.height);
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(m.width * fit));
    const ch = Math.max(1, Math.round(m.height * fit));
    // while playing draw at most at the sequence's own resolution; never above 1.5× the on-screen size
    const s = Math.min(1, fit * dpr);
    const pw = Math.max(1, Math.round(m.width * s));
    const ph = Math.max(1, Math.round(m.height * s));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    if (vw !== cw || vh !== ch) {
      vw = cw;
      vh = ch;
      for (const c of [canvas, overlay]) {
        c.style.width = `${cw}px`;
        c.style.height = `${ch}px`;
      }
      overlay.width = Math.round(cw * dpr);
      overlay.height = Math.round(ch * dpr);
    }
    vscale = s;
    return true;
  }

  // selection box of the selected clip in sequence coordinates: center, half size, rotation
  function boxOf(c, time) {
    const m = model();
    const local = Math.max(0, Math.min(c.dur, time - c.start));
    const size = M.layerSize(m, c, textSize);
    return { x: valueAt(c.x, local), y: valueAt(c.y, local), w: size.w * valueAt(c.sx, local), h: size.h * valueAt(c.sy, local), rot: valueAt(c.rot, local) };
  }

  function drawOverlay() {
    const m = model();
    const dpr = overlay.width / Math.max(1, vw);
    const o = overlay.getContext("2d");
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, overlay.width, overlay.height);
    const ids = api.selection();
    if (ids.length !== 1 || playing) return;
    const c = m.clips[ids[0]];
    if (c.type === "audio" || state.t < c.start || state.t >= M.clipEnd(c)) return;
    const b = boxOf(c, state.t);
    const k = (vw / m.width) * dpr;
    o.setTransform(k, 0, 0, k, 0, 0);
    o.translate(b.x, b.y);
    o.rotate((b.rot * Math.PI) / 180);
    o.lineWidth = 1.5 / k;
    o.strokeStyle = "#4da3ff";
    o.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    o.fillStyle = "#fff";
    const hs = 5 / k;
    for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      o.fillRect((hx * b.w) / 2 - hs, (hy * b.h) / 2 - hs, hs * 2, hs * 2);
      o.strokeRect((hx * b.w) / 2 - hs, (hy * b.h) / 2 - hs, hs * 2, hs * 2);
    }
    o.beginPath();
    o.moveTo(0, -b.h / 2);
    o.lineTo(0, -b.h / 2 - 24 / k);
    o.stroke();
    o.beginPath();
    o.arc(0, -b.h / 2 - 24 / k, hs, 0, Math.PI * 2);
    o.fill();
    o.stroke();
  }

  // direct manipulation in the viewer: move, scale (corners, from the center) and rotate (top handle)
  overlay.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || playing) return;
    api.focus();
    const m = model();
    const r = overlay.getBoundingClientRect();
    const toSeq = (ev) => [((ev.clientX - r.left) / r.width) * m.width, ((ev.clientY - r.top) / r.height) * m.height];
    const [px, py] = toSeq(e);
    const k = m.width / r.width; // sequence pixels per CSS pixel
    const inBox = (c, x, y, pad = 0) => {
      const b = boxOf(c, state.t);
      const a = (-b.rot * Math.PI) / 180;
      const dx = x - b.x;
      const dy = y - b.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      return { hit: Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad, lx, ly, b };
    };
    let id = api.selection().length === 1 ? api.selection()[0] : null;
    let mode = "move";
    const cur = id && m.clips[id];
    const probe = cur && cur.type !== "audio" ? inBox(cur, px, py, 8 * k) : null;
    if (probe && Math.hypot(probe.lx, probe.ly + probe.b.h / 2 + 24 * k) < 10 * k) mode = "rotate";
    else if (probe?.hit && Math.abs(Math.abs(probe.lx) - probe.b.w / 2) < 10 * k && Math.abs(Math.abs(probe.ly) - probe.b.h / 2) < 10 * k) mode = "scale";
    else {
      // pick the topmost visible layer under the pointer
      const tracks = M.videoTracks(m);
      const under = M.clipList(m)
        .filter((c) => c.type !== "audio" && c.type !== "adjustment" && state.t >= c.start && state.t < M.clipEnd(c) && !M.trackOf(m, c.track).hidden && !M.trackOf(m, c.track).locked && inBox(c, px, py).hit)
        .sort((a, b) => tracks.findIndex((x) => x.id === a.track) - tracks.findIndex((x) => x.id === b.track));
      id = under[0]?.id || null;
      api.select(id ? [id] : []);
      if (!id) return;
    }
    const c0 = model().clips[id];
    const b0 = boxOf(c0, state.t);
    const local = Math.max(0, Math.min(c0.dur, state.t - c0.start));
    const s0 = [valueAt(c0.sx, local), valueAt(c0.sy, local)];
    const d0 = Math.hypot(px - b0.x, py - b0.y) || 1;
    const a0 = Math.atan2(py - b0.y, px - b0.x);
    overlay.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const [x, y] = toSeq(ev);
      if (mode === "move") {
        let nx = b0.x + (x - px);
        let ny = b0.y + (y - py);
        if (ev.shiftKey) Math.abs(x - px) > Math.abs(y - py) ? (ny = b0.y) : (nx = b0.x);
        if (state.snap) {
          if (Math.abs(nx - m.width / 2) < 8 * k) nx = m.width / 2;
          if (Math.abs(ny - m.height / 2) < 8 * k) ny = m.height / 2;
        }
        api.setProps(id, { x: Math.round(nx), y: Math.round(ny) });
      } else if (mode === "scale") {
        const f = Math.max(0.01, Math.hypot(x - b0.x, y - b0.y) / d0);
        api.setProps(id, { sx: s0[0] * f, sy: s0[1] * f });
      } else {
        let deg = b0.rot + ((Math.atan2(y - b0.y, x - b0.x) - a0) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        api.setProps(id, { rot: Math.round(deg * 10) / 10 });
      }
    };
    const up = (ev) => {
      overlay.releasePointerCapture(ev.pointerId);
      overlay.removeEventListener("pointermove", onMove);
      overlay.removeEventListener("pointerup", up);
      overlay.removeEventListener("pointercancel", up);
    };
    overlay.addEventListener("pointermove", onMove);
    overlay.addEventListener("pointerup", up);
    overlay.addEventListener("pointercancel", up);
  });

  // ------------------------------------------------------------------------------------------- frame loop
  let lastPrune = 0;
  function tick() {
    raf = 0;
    if (destroyed || !root.isConnected) return;
    const m = model();
    if (playing) {
      const now = audio.time();
      const end = m.range ? m.range.out : M.duration(m);
      if (now !== null) state.t = now;
      if (state.t >= end) {
        if (state.loop && end > 0) {
          state.t = m.range ? m.range.in : 0;
          startAudio();
        } else {
          state.t = end;
          api.pause();
        }
      }
      timeline.reveal(state.t);
      const [l, r] = audio.levels();
      meterL.style.width = `${Math.round(Math.sqrt(l) * 100)}%`;
      meterR.style.width = `${Math.round(Math.sqrt(r) * 100)}%`;
    } else if (meterL.style.width !== "0%") meterL.style.width = meterR.style.width = "0%";
    if (dirty || playing) {
      dirty = false;
      if (layoutViewer()) {
        const ctx = canvas.getContext("2d");
        // compositions have no background: start from a clear canvas (the stage shows through)
        if ((state.seq || "main") !== "main") ctx.clearRect(0, 0, canvas.width, canvas.height);
        compositor.render(ctx, rootModel(), state.t, { seq: state.seq || "main", scale: vscale, frame: Math.round(state.t * m.fps) });
        drawOverlay();
      }
      renderSeqBar();
      if (state.graph) graph?.draw();
      else timeline.draw();
      tc.textContent = M.timecode(m, state.t);
      total.textContent = M.timecode(m, M.duration(m));
      if (!playing) {
        inspector.render();
        renderBin();
      }
      const nowMs = performance.now();
      if (nowMs - lastPrune > 5000) {
        lastPrune = nowMs;
        // clips inside compositions keep their players too
        const r = rootModel();
        store.prune(new Set([r, ...Object.values(r.comps)].flatMap((s) => Object.keys(s.clips))));
      }
    }
    if (playing && active) raf = requestAnimationFrame(tick);
  }

  const onChange = () => {
    // keep the selection valid and the playhead inside the sequence
    const m = model();
    for (const id of [...state.sel]) if (!m.clips[id]) state.sel.delete(id);
    if (playing) startAudio();
    requestDraw();
    app.emit("scenestatus");
  };
  const offChange = prj.on("change", onChange);
  const ro = new ResizeObserver(() => requestDraw());
  ro.observe(stage);

  // ------------------------------------------------------------------------------------------- keyboard
  root.addEventListener("keydown", (e) => {
    const el = e.target;
    if (el !== root && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
      if (e.key === "Escape") root.focus();
      return;
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const mod = isMod(e);
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === "F3" && e.shiftKey) return done(), api.toggleGraph();
    if (mod) {
      if (key === "k") return done(), api.splitAtPlayhead();
      if (key === "d") return done(), api.duplicateSelection();
      if (key === "a") return done(), api.selectAll();
      return; // undo / redo / save and the rest stay with the application
    }
    const fps = model().fps;
    switch (key) {
      case " ":
        return done(), api.toggle();
      case "k":
        return done(), api.shuttle(0);
      case "l":
        return done(), api.shuttle(1);
      case "j":
        return done(), api.shuttle(-1);
      case "ArrowLeft":
        return done(), api.step(e.shiftKey ? -Math.round(fps / 2) : -1);
      case "ArrowRight":
        return done(), api.step(e.shiftKey ? Math.round(fps / 2) : 1);
      case "ArrowUp":
        return done(), api.goEdit(-1);
      case "ArrowDown":
        return done(), api.goEdit(1);
      case "Home":
        return done(), api.seek(0);
      case "End":
        return done(), api.seek(M.duration(model()));
      case "i":
        return done(), api.setIn();
      case "o":
        return done(), api.setOut();
      case "x":
        return done(), api.clearRange();
      case ";":
        return done(), api.removeRange(false);
      case "'":
        return done(), api.removeRange(true);
      case "m":
        return done(), api.addMarker();
      case "s":
        return done(), api.toggleSnap();
      case "q":
        return done(), api.rippleTrimTo("start");
      case "w":
        return done(), api.rippleTrimTo("end");
      case "t":
        return done(), api.addText();
      case "Delete":
      case "Backspace":
        return done(), api.deleteSelection({ ripple: e.shiftKey });
      case "+":
      case "=":
        return done(), api.zoomBy(1.4);
      case "-":
        return done(), api.zoomBy(1 / 1.4);
      case "\\":
        return done(), timeline.fit();
      case "Escape":
        return done(), api.select([]);
      default: {
        const tool = TOOLS.find((d) => d.key === key);
        if (tool) return done(), api.setTool(tool.id);
      }
    }
  });

  import("../commands/scene.js").then((m) => m.registerSceneCommands(app)).catch(() => {});
  requestAnimationFrame(() => {
    if (M.duration(model()) > 0) timeline.fit();
    requestDraw();
  });
  return api;
}
