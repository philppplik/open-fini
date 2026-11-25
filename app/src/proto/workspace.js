// Proto Studio workspace: the canvas (proto/view.js) of one open design, its input (tools, pan, zoom, keyboard,
// context menu), the controller (proto/controller.js), the tools (proto/tools/) and the Pages, Layers and Design panels
// (proto/panels/). One instance per open Proto document, created by proto/host.js; it is `app.protoUI` while its
// document is active.
//
//   mountProto(host, doc, app) → ws
// The instance is the API for commands (commands/proto.js), the tools, the panels, the assistant and collaboration:
//   model() / page / setPage(id)            the Proto model (immutable, engine/proto/) and the page shown
//   run(op, label) → result | null          one operation (engine/proto/ops.js) as one undo step; throws OpError
//   apply(op, label) → result | null        the same, but a refused operation shows a notice instead of throwing
//   preview(op) → result | null             shows `op` applied to the model without recording it (live drags);
//                                           preview(null) shows the model again; the next change ends a preview
//   selection / select(ids, { add, toggle }) / clear()
//   pickAt(sx, sy, { deep }) → id|null      what a click at a stage point selects (geometry cache, not the DOM)
//   box(id) → { x, y, w, h } | null         the measured world box of a layer
//   toWorld(sx, sy) / toStage(wx, wy)       coordinate conversions with the current camera
//   view                                    the renderer: view.geo (geometry), view.overlay.addLayer(fn), view.camera
//   tools / setTool(tool|null)              the tools (tools/index.js; tools.set(id)); setTool installs a tool object
//   hover / setHover(id) / setMarquee(rect) / setCursor(css) / requestDraw()   overlay state for tools
//   editing / editText(id) / setEditing(state)   in-place text editing (tools/text.js); rename(id) in the Layers panel
//   copy() / cut() / paste() / zoomIn() / zoomOut() / zoomTo(z) / zoomAround(sx, sy, dir) / zoomToFit() / zoomToSelection()
//   addFrame(preset?) / deleteSelection() / duplicateSelection() / selectAll() / selectParent() / selectChildren()
//   mode / setMode("design" | "prototype")   Prototype mode (T9): connections on the canvas, the Prototype panel
//   play({ flow?, start?, window? })        opens the prototype player (proto/player/player.js)
//   goTo(id)                                shows a layer (its page, selected, in view)
//   comments / commentAnchor() / revealComment(anchor)   comment pins and the Comment tool (proto/comments.js)
//   on(event, fn) → off                      "selection", "change", "camera", "geometry", "tool", "mode"
//   readOnly                                true for a design saved by a newer version or with errors
//   activate() / deactivate() / destroy()
// Invariants: every model change is ONE undo step through the document history (replayed through the operation's
// inverse, see controller.js ▸ opStep); camera, selection, hover and previews are view state and never saved.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { setPanelSlot } from "../ui/panels/slots.js";
import { openContextMenu } from "../ui/context-menu/service.js";
import { loadModel, storeModel } from "../engine/proto/format.js";
import { apply as applyOp } from "../engine/proto/ops.js";
import { isContainer } from "../engine/proto/schema.js";
import { indexOf, pageKey, roots as rootIds } from "../engine/proto/tree.js";
import { OfficeProject } from "../core/office.js";
import { createView } from "./view.js";
import { createController } from "./controller.js";
import { pickAt as pick, unionRect } from "./geometry.js";
import { toWorld, toScreen, zoomAt, panBy, stepZoom, wheelZoom, clampZoom } from "./camera.js";
import { createTools } from "./tools/index.js";
import { FRAME_PRESETS } from "./tools/presets.js";
import { startTextEdit } from "./tools/text.js";
import * as E from "./tools/edit.js";
import { inFlow, lockedSet } from "./tools/common.js";
import { createLayersPanel } from "./panels/layers.js";
import { createPagesPanel } from "./panels/pages.js";
import { createDesignPanel } from "./panels/design.js";
import { createPrototypePanel, createInspector } from "./panels/prototype.js";
import { createAssetsPanel } from "./panels/assets.js";
import { createVariablesPanel } from "./panels/variables.js";
import { createCommentLayer } from "./comments.js";

const isMod = (e) => (/Mac|iPhone|iPad/.test(navigator.platform || "") ? e.metaKey : e.ctrlKey);
const PANELS = ["proto-pages", "proto-layers", "proto-inspector", "proto-assets", "proto-variables"];
export const clearProtoPanels = (app) => PANELS.forEach((id) => setPanelSlot(app, id, null));
export { FRAME_PRESETS };

/** The in-app clipboard of Proto layers (shared by every open design). */
let clipboard = null;

/**
 * Reads the Proto model of a document once (older schemas migrate; a newer or invalid model opens read-only) and makes
 * saving canonical. Returns the load result ({ readOnly, newer, errors, notes }).
 */
export function ensureProto(prj) {
  if (prj.protoInfo && !prj.model?._raw) return prj.protoInfo;
  const res = loadModel(prj.model);
  prj.model = res.model;
  prj.protoInfo = { readOnly: res.readOnly, newer: res.newer, errors: res.errors, notes: res.notes };
  // stable files: the stored JSON is canonical (engine/proto/serialize.js), whatever order edits left the keys in
  prj.manifest = function manifest() {
    const live = this.model;
    this.model = storeModel(live);
    try {
      return OfficeProject.prototype.manifest.call(this);
    } finally {
      this.model = live;
    }
  };
  return prj.protoInfo;
}

export function mountProto(host, doc, app) {
  const prj = doc.office;
  const info = ensureProto(prj);
  const state = (prj.view.proto ||= { cam: null, page: null });
  let mode = state.mode === "prototype" ? "prototype" : "design";
  const listeners = new Map();
  const emit = (ev, d) => listeners.get(ev)?.forEach((fn) => fn(d));
  let active = false;
  let destroyed = false;
  let hover = null;
  let marquee = null;
  let tool = null;
  let editing = null;
  let previewing = false;
  let spaceDown = false;
  let fitted = !!state.cam;

  // ------------------------------------------------------------------------------------------- controller
  const ctl = createController({
    model: () => prj.model,
    page: state.page,
    emit: (ev, d) => {
      if (ev === "page") {
        state.page = d;
        render();
      }
      if (ev === "selection") onSelection();
      emit(ev, d);
    },
    commit(step, label) {
      if (info.readOnly) throw new Error(t("This design is read-only."));
      const name = label || t("Edit design");
      doc.tx(name, () =>
        doc._do({
          redo: () => prj.set(step.redo(prj.model), { origin: "redo", label: name }),
          undo: () => prj.set(step.undo(prj.model), { origin: "undo", label: name }),
          meta: true,
          bytes: 256,
        }),
      );
    },
  });

  // ------------------------------------------------------------------------------------------- DOM
  const canvasHost = h("div.of-proto__canvas");
  const banner = info.readOnly
    ? h("div.of-proto__banner", { role: "status" }, h("sl-icon", { name: "lock" }), info.newer ? t("This design was saved by a newer version of OpenFini and opens read-only.") : t("This design has problems and opens read-only. Help ▸ Doctor lists them."))
    : null;
  const live = h("div.of-proto__live", { "aria-live": "polite" });
  const root = h("div.of-proto", { tabIndex: -1 }, banner, canvasHost, live);
  host.replaceChildren(root);

  const view = createView(canvasHost, {
    overlayState: () => ({
      selection: ctl.selection.map((id) => view.geo.get(id)).filter(Boolean),
      hover: hover ? view.geo.get(hover) : null,
      marquee,
    }),
  });
  const stage = view.stage;
  stage.tabIndex = 0;
  stage.setAttribute("role", "application");
  stage.setAttribute("aria-label", t("Design canvas"));
  stage.setAttribute("aria-roledescription", t("Design canvas"));
  if (state.cam) view.setCamera(state.cam);
  // tools draw their guides and handles above the selection
  view.overlay.addLayer((ctx, s) => tool?.draw?.(ctx, s));

  let layers = null; // created with the API below (the panels read the model, the selection and the geometry)
  let pages = null;
  let design = null;
  let inspector = null;
  let assets = null;
  let variables = null;

  function render() {
    if (destroyed) return;
    previewing = false;
    view.render(prj.model, ctl.page);
    ctl.prune();
    panels();
  }
  function panels() {
    if (!active || !layers) return;
    layers.render();
    pages.render();
    inspector.render();
    assets.render();
    variables.render();
  }
  function onSelection() {
    view.requestDraw();
    panels();
    const n = ctl.selection.length;
    live.textContent = n === 1 ? prj.model.nodes[ctl.selection[0]]?.name || "" : n ? t("{n} layers selected", { n }) : "";
  }

  const offChange = prj.on("change", () => {
    if (editing && !prj.model.nodes[editing.id] && !editing.creating) editing.finish();
    render();
    emit("change", prj.model);
    app.emit("protostatus");
  });
  view.on("camera", (cam) => {
    state.cam = cam;
    emit("camera", cam);
  });
  view.on("geometry", () => {
    if (active) inspector?.geometry();
    emit("geometry", view.geo);
  });
  view.on("frame", () => {
    if (!fitted && view.size.w > 0) {
      fitted = true;
      view.fit(null, { maxZoom: 1 });
    }
  });

  // ------------------------------------------------------------------------------------------- pointer input
  const stagePoint = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inEditor = (e) => !!editing && (e.composedPath?.() || []).includes(editing.el);
  const ctxOf = (e) => {
    const p = stagePoint(e);
    return { e, stage: p, world: toWorld(view.camera, p.x, p.y), ws: api };
  };
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (inEditor(e)) return; // clicks inside the text being edited place the caret
    if (e.button !== 0 && e.button !== 1) return;
    stage.focus({ preventScroll: true });
    const c = ctxOf(e);
    if (e.button === 1 || spaceDown || tool?.id === "hand") drag = { kind: "pan", sx: c.stage.x, sy: c.stage.y, cam: view.camera };
    else if (tool?.down && tool.down(c) !== false) drag = { kind: "tool" };
    else return;
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    if (inEditor(e)) return;
    const c = ctxOf(e);
    if (drag?.kind === "pan") {
      view.setCamera(panBy(drag.cam, c.stage.x - drag.sx, c.stage.y - drag.sy), { gesture: true });
      return;
    }
    if (drag?.kind === "tool") return void tool?.move?.(c);
    if (drag) return;
    if (spaceDown || tool?.id === "hand") return;
    tool?.hover?.(c);
  });
  const endDrag = (e) => {
    if (!drag) return;
    const kind = drag.kind;
    drag = null;
    if (kind === "tool") tool?.up?.(ctxOf(e));
    if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", (e) => {
    tool?.cancel?.();
    endDrag(e);
  });
  stage.addEventListener("pointerleave", () => {
    if (hover && !drag) {
      hover = null;
      view.requestDraw();
    }
  });
  stage.addEventListener(
    "wheel",
    (e) => {
      if (inEditor(e) && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const p = stagePoint(e);
      if (e.ctrlKey || e.metaKey) view.setCamera(wheelZoom(view.camera, p.x, p.y, e.deltaY, e.deltaMode), { gesture: true });
      else {
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        view.setCamera(panBy(view.camera, -dx, -dy), { gesture: true });
      }
    },
    { passive: false },
  );
  stage.addEventListener("contextmenu", (e) => {
    if (inEditor(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const c = ctxOf(e);
    const id = api.pickAt(c.stage.x, c.stage.y, { deep: isMod(e) });
    if (id && !ctl.selection.includes(id)) ctl.select([id]);
    else if (!id) ctl.clear();
    openContextMenu(app, { kind: ctl.selection.length ? "proto-layers" : "proto-canvas", x: e.clientX, y: e.clientY, event: e, base: contextItems() });
  });

  /** The canvas context menu: commands of commands/proto.js (disabled ones are hidden by the menu). */
  function contextItems() {
    if (!ctl.selection.length) return ["proto.paste", "-", "proto.selectAll", "-", "proto.zoomFit", "proto.zoom100"];
    return [
      "proto.copy", "proto.cut", "proto.paste", "proto.duplicate", "proto.delete", "-",
      "proto.autoLayout", "proto.gridLayout", "proto.removeAutoLayout", "proto.group", "proto.ungroup", "-",
      "proto.createComponent", "proto.combineVariants", "proto.goToMain", "proto.resetInstance", "proto.detachInstance", "-",
      "proto.bringToFront", "proto.bringForward", "proto.sendBackward", "proto.sendToBack", "-",
      "proto.toggleVisible", "proto.toggleLock", "proto.rename", "-", "proto.selectParent", "proto.selectChildren", "proto.zoomSelection",
    ];
  }

  // ------------------------------------------------------------------------------------------- keyboard
  root.addEventListener("keydown", (e) => {
    const el = e.composedPath?.()[0] || e.target;
    if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest?.(".of-proto-layers")) return;
    if (tool?.key?.(e, api) === true) return e.preventDefault();
    const mod = isMod(e);
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === " " && !spaceDown) {
      spaceDown = true;
      stage.classList.add("is-panning");
      return done();
    }
    if (mod) {
      if (key === "a" && !e.shiftKey && !e.altKey) return done(), api.selectAll();
      return; // undo, redo, copy, paste, save and the rest are commands
    }
    if (e.altKey) return;
    if (e.shiftKey && key === "!") return done(), api.zoomToFit();
    if (e.shiftKey && (key === "@" || key === "\"")) return done(), api.zoomToSelection();
    if (e.shiftKey && e.code === "Digit1") return done(), api.zoomToFit();
    if (e.shiftKey && e.code === "Digit2") return done(), api.zoomToSelection();
    if (e.shiftKey && e.code === "Digit0") return done(), api.zoomTo(1);
    switch (key) {
      case "Delete":
      case "Backspace":
        return done(), api.deleteSelection();
      case "Escape":
        return done(), api.selectParent();
      case "Enter":
        if (!e.shiftKey && ctl.selection.length === 1 && prj.model.nodes[ctl.selection[0]]?.type === "text") return done(), api.editText(ctl.selection[0]);
        return done(), e.shiftKey ? api.selectParent() : api.selectChildren();
      case "Tab":
        return done(), selectSibling(e.shiftKey ? -1 : 1);
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        return done(), nudge(key, e.shiftKey ? 10 : 1);
      case "+":
      case "=":
        return done(), api.zoomIn();
      case "-":
        return done(), api.zoomOut();
    }
  });
  root.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      spaceDown = false;
      stage.classList.remove("is-panning");
    }
    tool?.key?.(e, api);
  });

  /** Arrow keys: absolute layers move by 1 (Shift: 10) pixels; layers in an auto layout move one place. */
  function nudge(key, step) {
    const m = prj.model;
    const ids = rootIds(m, ctl.selection).filter((id) => !lockedSet(m).has(id));
    if (!ids.length || info.readOnly) return;
    if (ids.every((id) => inFlow(m, id))) {
      const parent = m.nodes[ids[0]].parent;
      if (ids.some((id) => m.nodes[id].parent !== parent)) return;
      const kids = indexOf(m).get(parent);
      const first = Math.min(...ids.map((id) => kids.indexOf(id)));
      const back = key === "ArrowLeft" || key === "ArrowUp";
      const rest = kids.filter((id) => !ids.includes(id));
      const at = Math.max(0, Math.min(rest.length, back ? first - 1 : first + 1));
      return void api.apply(E.flowMove(m, ids, parent, at), t("Reorder layers"));
    }
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    api.apply(E.moveBy(m, ids, dx, dy), t("Move layers"));
  }

  /** Tab / Shift+Tab: the next or previous sibling of the selection. */
  function selectSibling(dir) {
    const m = prj.model;
    const id = ctl.selection[ctl.selection.length - 1];
    const n = m.nodes[id];
    const sibs = indexOf(m).get(n ? (n.parent ?? pageKey(n.page)) : pageKey(ctl.page));
    if (!sibs.length) return;
    const i = n ? sibs.indexOf(id) : -1;
    ctl.select([sibs[(i + dir + sibs.length) % sibs.length]]);
  }

  // ------------------------------------------------------------------------------------------- API
  const center = () => ({ x: view.size.w / 2, y: view.size.h / 2 });
  const guard = (fn) => {
    try {
      return fn();
    } catch (err) {
      app.toast(err?.message || String(err), "warning", 5000);
      return null;
    }
  };
  const api = {
    doc,
    app,
    project: prj,
    view,
    controller: ctl,
    get readOnly() {
      return info.readOnly;
    },
    model: () => prj.model,
    get page() {
      return ctl.page;
    },
    setPage: (id) => ctl.setPage(id),
    get selection() {
      return ctl.selection;
    },
    select: (ids, o) => ctl.select(ids, o),
    clear: () => ctl.clear(),
    run: (op, label) => ctl.run(op, label),
    apply(op, label) {
      if (!op) {
        if (previewing) render();
        return null;
      }
      const res = guard(() => ctl.run(op, label));
      if (!res && previewing) render();
      return res;
    },
    preview(op) {
      if (!op) {
        if (previewing) render();
        return null;
      }
      try {
        const res = applyOp(prj.model, op);
        previewing = true;
        view.render(res.model, ctl.page);
        return res;
      } catch {
        return null;
      }
    },
    box: (id) => view.geo.get(id) || view.rootBox(id),
    pickAt(sx, sy, { deep = false } = {}) {
      const w = toWorld(view.camera, sx, sy);
      return pick(view.geo, w.x, w.y, { deep, context: ctl.context() });
    },
    toWorld: (sx, sy) => toWorld(view.camera, sx, sy),
    toStage: (wx, wy) => toScreen(view.camera, wx, wy),
    tools: null,
    get tool() {
      return tool?.id || null;
    },
    setTool(next) {
      tool = next || null;
      stage.style.cursor = tool?.cursor || "";
    },
    emitTool: (id) => emit("tool", id),
    get mode() {
      return mode;
    },
    /** Design or Prototype mode: the inspector tab, the connections on the canvas and the Connect handle. */
    setMode(next) {
      const m = next === "prototype" ? "prototype" : "design";
      if (m === mode) return;
      mode = m;
      state.mode = m;
      root.classList.toggle("is-prototype", m === "prototype");
      if (api.tool === "move" || api.tool === "connect") api.tools.set(m === "prototype" ? "connect" : "move");
      view.requestDraw();
      panels();
      emit("mode", m);
      app.emit("commands");
    },
    /** Opens the prototype player (a flow, a start frame, or the selection's frame; `window: true` in its own window). */
    async play(o = {}) {
      const { openPlayer } = await import("./player/player.js");
      return openPlayer(api, o);
    },
    get hover() {
      return hover;
    },
    setHover(id) {
      if (id === hover) return;
      hover = id;
      view.requestDraw();
    },
    setMarquee(rect) {
      marquee = rect;
      view.requestDraw();
    },
    setCursor(css) {
      stage.style.cursor = css || tool?.cursor || "";
    },
    requestDraw: () => view.requestDraw(),
    get editing() {
      return editing;
    },
    setEditing(s) {
      editing = s;
      stage.classList.toggle("is-editing", !!s);
    },
    editText(id) {
      if (info.readOnly) return false;
      return startTextEdit(api, id);
    },
    /** Shows a layer: its page, selected and in view (Go to main component). */
    goTo(id) {
      const n = prj.model.nodes[id];
      if (!n) return false;
      if (ctl.page !== n.page) ctl.setPage(n.page);
      ctl.select([id]);
      requestAnimationFrame(() => requestAnimationFrame(() => api.zoomToSelection()));
      return true;
    },
    /** Comments (proto/comments.js): pins on the canvas, the Comment tool, the anchor of "Add comment". */
    comments: null,
    commentAnchor: () => api.comments?.currentAnchor() || null,
    revealComment: (a) => api.comments?.reveal(a),
    /** Renames a layer in the Layers panel (F2, Object ▸ Rename). */
    rename(id) {
      layers?.rename(id);
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev)?.delete(fn);
    },
    zoomTo(z) {
      const c = center();
      view.setCamera(zoomAt(view.camera, c.x, c.y, clampZoom(z)));
    },
    zoomAround(sx, sy, dir) {
      view.setCamera(zoomAt(view.camera, sx, sy, stepZoom(view.camera.zoom, dir)));
    },
    zoomIn() {
      api.zoomTo(stepZoom(view.camera.zoom, 1));
    },
    zoomOut() {
      api.zoomTo(stepZoom(view.camera.zoom, -1));
    },
    zoomToFit() {
      view.fit(null, { maxZoom: 1 });
    },
    zoomToSelection() {
      const r = unionRect(ctl.selection.map((id) => view.geo.get(id) || view.rootBox(id)));
      if (r) view.fit(r, { maxZoom: 4 });
      else api.zoomToFit();
    },
    /** Shows a world rect when it is (partly) outside the view, zooming out if it does not fit. */
    reveal(r) {
      const vis = view.fitCamera(r, { maxZoom: view.camera.zoom });
      if (vis.zoom < view.camera.zoom) return view.setCamera(vis);
      const s0 = toScreen(view.camera, r.x, r.y);
      const s1 = toScreen(view.camera, r.x + r.w, r.y + r.h);
      if (s1.x < 0 || s0.x > view.size.w || s1.y < 0 || s0.y > view.size.h) view.setCamera(vis);
    },
    /** Insert ▸ Frame: a frame of a preset size to the right of the page's layers, selected and in view. */
    addFrame(preset = "desktop") {
      const p = FRAME_PRESETS[preset] || FRAME_PRESETS.desktop;
      const u = pageBounds();
      const x = u ? Math.round(u.x + u.w + 100) : 0;
      const y = u ? Math.round(u.y) : 0;
      const res = api.apply({ op: "node.create", type: "frame", page: ctl.page, fields: { name: t(p.name), x, y, w: { mode: "fixed", value: p.w }, h: { mode: "fixed", value: p.h } } }, t("Add frame"));
      if (res?.ids?.[0]) {
        ctl.select([res.ids[0]]);
        api.reveal({ x, y, w: p.w, h: p.h });
      }
      api.tools.set("move");
      return res;
    },
    deleteSelection: () => guard(() => ctl.deleteSelection(t("Delete layers"))),
    duplicateSelection: () => guard(() => ctl.duplicateSelection(t("Duplicate layers"))),
    selectAll: () => ctl.selectAll(),
    selectParent: () => ctl.selectParent(),
    selectChildren: () => ctl.selectChildren(),
    copy() {
      if (!ctl.selection.length) return false;
      clipboard = E.copyNodes(prj.model, ctl.selection);
      app.emit("commands");
      return true;
    },
    cut() {
      if (!api.copy()) return false;
      api.deleteSelection();
      return true;
    },
    get canPaste() {
      return !!clipboard;
    },
    /** Pastes into the selected container, next to the selection, or onto the page (to the right of its frames). */
    paste() {
      if (!clipboard || info.readOnly) return null;
      const m = prj.model;
      const sel = ctl.selection.map((id) => m.nodes[id]).filter(Boolean);
      let parent = null;
      if (sel.length === 1 && isContainer(sel[0].type) && sel[0].type !== "instance" && sel[0].type !== "componentSet" && !clipboard.roots.includes(sel[0].id)) parent = sel[0].id;
      else if (sel.length) parent = sel[0].parent ?? null;
      let offset = [0, 0];
      if (parent == null) {
        // top-level layers land to the right of everything on the page
        const u = pageBounds();
        const src = clipboard.nodes.filter((n) => clipboard.roots.includes(n.id));
        const sx = Math.min(...src.map((n) => n.x ?? 0));
        const sy = Math.min(...src.map((n) => n.y ?? 0));
        if (u && src.some((n) => m.nodes[n.id])) offset = [Math.round(u.x + u.w + 100 - sx), Math.round(u.y - sy)];
      }
      const res = E.pasteNodes(m, clipboard, { parent, page: ctl.page, offset });
      if (!res) return null;
      const out = api.apply(res.op, t("Paste"));
      if (out) {
        ctl.select(res.ids);
        requestAnimationFrame(() => {
          const r = unionRect(res.ids.map((id) => api.box(id)));
          if (r) api.reveal(r);
        });
      }
      return out;
    },
    activate() {
      active = true;
      publishPanels();
      render();
      view.themeChanged();
    },
    deactivate() {
      active = false;
      hover = null;
      editing?.finish();
    },
    destroy() {
      destroyed = true;
      api.comments?.destroy();
      offChange();
      view.destroy();
    },
  };

  function pageBounds() {
    const boxes = Object.values(prj.model.nodes)
      .filter((n) => n.parent == null && n.page === ctl.page)
      .map((n) => view.rootBox(n.id) || { x: n.x || 0, y: n.y || 0, w: n.w?.value || 0, h: n.h?.value || 0 });
    return unionRect(boxes);
  }

  api.tools = createTools(api);
  tool = api.tools.current;
  canvasHost.append(api.tools.el);
  layers = createLayersPanel(api);
  pages = createPagesPanel(api);
  design = createDesignPanel(api);
  inspector = createInspector(api, design, createPrototypePanel(api));
  root.classList.toggle("is-prototype", mode === "prototype");
  if (mode === "prototype") api.tools.set("connect");
  assets = createAssetsPanel(api);
  variables = createVariablesPanel(api);
  api.comments = createCommentLayer(api, canvasHost);
  function publishPanels() {
    setPanelSlot(app, "proto-pages", { el: pages.el, show: () => pages.render() });
    setPanelSlot(app, "proto-layers", { el: layers.el, show: () => layers.render() });
    setPanelSlot(app, "proto-inspector", { el: inspector.el, show: () => inspector.render() });
    setPanelSlot(app, "proto-assets", { el: assets.el, show: () => assets.render(true) });
    setPanelSlot(app, "proto-variables", { el: variables.el, show: () => variables.render(true) });
  }
  render();
  return api;
}
