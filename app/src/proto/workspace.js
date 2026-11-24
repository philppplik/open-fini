// Proto Studio workspace: the canvas (proto/view.js) of one open design, its input (select, marquee, pan, zoom), the
// controller (proto/controller.js) and the Layers and Inspector panels. One instance per open Proto document, created
// by proto/host.js; it is `app.protoUI` while its document is active.
//
//   mountProto(host, doc, app) → ws
// The instance is the API for commands (commands/proto.js), the tools of T4, the assistant and collaboration (T10):
//   model() / page / setPage(id)            the Proto model (immutable, engine/proto/) and the page shown
//   run(op, label) → result | null          one operation (engine/proto/ops.js) as one undo step; throws OpError
//   selection / select(ids, { add, toggle }) / clear()
//   pickAt(sx, sy, { deep }) → id|null      what a click at a stage point selects (geometry cache, not the DOM)
//   toWorld(sx, sy) / toStage(wx, wy)       coordinate conversions with the current camera
//   view                                    the renderer: view.geo (geometry), view.overlay.addLayer(fn), view.camera
//   setTool(tool|null)                      T4: a tool gets { down, move, up, key, cursor } before the default selection
//   zoomIn() / zoomOut() / zoomTo(z) / zoomToFit() / zoomToSelection()
//   addFrame(preset?) / deleteSelection() / duplicateSelection() / selectAll() / selectParent() / selectChildren()
//   on(event, fn) → off                      "selection", "change", "camera", "geometry"
//   readOnly                                true for a design saved by a newer version or with errors
//   activate() / deactivate() / destroy()
// Invariants: every model change is ONE undo step through the document history (replayed through the operation's
// inverse, see controller.js ▸ opStep); camera, selection and hover are view state and never saved.
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import { setPanelSlot } from "../ui/panels/slots.js";
import { loadModel, storeModel } from "../engine/proto/format.js";
import { OfficeProject } from "../core/office.js";
import { createView } from "./view.js";
import { createController } from "./controller.js";
import { pickAt as pick, hitTest, marqueeSelect, normRect, unionRect } from "./geometry.js";
import { toWorld, toScreen, zoomAt, panBy, stepZoom, wheelZoom, clampZoom } from "./camera.js";
import { createLayersPanel, createInspector } from "./panels.js";

const isMod = (e) => (/Mac|iPhone|iPad/.test(navigator.platform || "") ? e.metaKey : e.ctrlKey);
const PANELS = ["proto-layers", "proto-inspector"];
export const clearProtoPanels = (app) => PANELS.forEach((id) => setPanelSlot(app, id, null));

/** Frame presets of Insert ▸ Frame. */
export const FRAME_PRESETS = {
  desktop: { name: N_("Desktop"), w: 1440, h: 1024 },
  phone: { name: N_("Phone"), w: 390, h: 844 },
};

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
  const listeners = new Map();
  const emit = (ev, d) => listeners.get(ev)?.forEach((fn) => fn(d));
  let active = false;
  let destroyed = false;
  let hover = null;
  let marquee = null;
  let tool = null;
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
      marquee: marquee?.rect || null,
    }),
  });
  const stage = view.stage;
  stage.tabIndex = 0;
  stage.setAttribute("role", "application");
  stage.setAttribute("aria-label", t("Design canvas"));
  if (state.cam) view.setCamera(state.cam);

  let layers = null; // created with the API below (the panels read the model, the selection and the geometry)
  let inspector = null;

  function render() {
    if (destroyed) return;
    view.render(prj.model, ctl.page);
    ctl.prune();
    panels();
  }
  function panels() {
    if (!active || !layers) return;
    layers.render();
    inspector.render();
  }
  function onSelection() {
    view.requestDraw();
    panels();
    const n = ctl.selection.length;
    live.textContent = n === 1 ? prj.model.nodes[ctl.selection[0]]?.name || "" : n ? t("{n} layers selected", { n }) : "";
  }

  const offChange = prj.on("change", () => {
    render();
    emit("change", prj.model);
    app.emit("protostatus");
  });
  view.on("camera", (cam) => {
    state.cam = cam;
    emit("camera", cam);
  });
  view.on("geometry", () => {
    if (active) inspector?.render();
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
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    stage.focus({ preventScroll: true });
    const p = stagePoint(e);
    const w = toWorld(view.camera, p.x, p.y);
    if (e.button === 1 || spaceDown || tool?.id === "hand") {
      drag = { kind: "pan", sx: p.x, sy: p.y, cam: view.camera };
    } else if (tool?.down && tool.down({ e, stage: p, world: w, ws: api }) !== false) {
      drag = { kind: "tool" };
    } else {
      const id = pick(view.geo, w.x, w.y, { deep: isMod(e), context: ctl.context() });
      if (id) {
        if (e.shiftKey) ctl.select([id], { toggle: true });
        else if (!ctl.selection.includes(id)) ctl.select([id]);
        drag = { kind: "select" };
      } else {
        const base = e.shiftKey ? ctl.selection.slice() : [];
        if (!e.shiftKey) ctl.clear();
        marquee = { x0: w.x, y0: w.y, base, rect: null };
        drag = { kind: "marquee" };
      }
    }
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    const p = stagePoint(e);
    const w = toWorld(view.camera, p.x, p.y);
    if (drag?.kind === "pan") {
      view.setCamera(panBy(drag.cam, p.x - drag.sx, p.y - drag.sy), { gesture: true });
      return;
    }
    if (drag?.kind === "tool") return void tool?.move?.({ e, stage: p, world: w, ws: api });
    if (drag?.kind === "marquee") {
      marquee.rect = normRect(marquee.x0, marquee.y0, w.x, w.y);
      const hits = marqueeSelect(view.geo, marquee.rect, { scope: null });
      ctl.select([...marquee.base, ...hits.filter((id) => !marquee.base.includes(id))]);
      view.requestDraw();
      return;
    }
    if (drag) return;
    if (tool?.move) return void tool.move({ e, stage: p, world: w, ws: api });
    const id = hitTest(view.geo, w.x, w.y).length ? pick(view.geo, w.x, w.y, { deep: isMod(e), context: ctl.context() }) : null;
    if (id !== hover) {
      hover = id;
      view.requestDraw();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const kind = drag.kind;
    drag = null;
    if (kind === "tool") {
      const p = stagePoint(e);
      tool?.up?.({ e, stage: p, world: toWorld(view.camera, p.x, p.y), ws: api });
    }
    if (kind === "marquee") {
      marquee = null;
      view.requestDraw();
    }
    if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("pointerleave", () => {
    if (hover && !drag) {
      hover = null;
      view.requestDraw();
    }
  });
  stage.addEventListener(
    "wheel",
    (e) => {
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

  // ------------------------------------------------------------------------------------------- keyboard
  root.addEventListener("keydown", (e) => {
    const el = e.target;
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
      if (key === "a") return done(), api.selectAll();
      if (key === "d") return done(), api.duplicateSelection();
      return; // undo, redo, save and the rest belong to the application
    }
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
        return done(), e.shiftKey ? api.selectParent() : api.selectChildren();
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
  });

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
    pickAt(sx, sy, { deep = false } = {}) {
      const w = toWorld(view.camera, sx, sy);
      return pick(view.geo, w.x, w.y, { deep, context: ctl.context() });
    },
    toWorld: (sx, sy) => toWorld(view.camera, sx, sy),
    toStage: (wx, wy) => toScreen(view.camera, wx, wy),
    setTool(next) {
      tool = next || null;
      stage.style.cursor = tool?.cursor || "";
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
    /** Insert ▸ Frame: a frame of a preset size to the right of the page's layers, selected and in view. */
    addFrame(preset = "desktop") {
      const p = FRAME_PRESETS[preset] || FRAME_PRESETS.desktop;
      const boxes = view.geo.rootIds().map((id) => view.rootBox(id));
      const u = unionRect([...boxes, ...Object.values(prj.model.nodes).filter((n) => n.parent == null && n.page === ctl.page).map((n) => view.rootBox(n.id))]);
      const x = u ? Math.round(u.x + u.w + 100) : 0;
      const y = u ? Math.round(u.y) : 0;
      const res = guard(() => ctl.run({ op: "node.create", type: "frame", page: ctl.page, fields: { name: t(p.name), x, y, w: { mode: "fixed", value: p.w }, h: { mode: "fixed", value: p.h } } }, t("Add frame")));
      if (res?.ids?.[0]) {
        ctl.select([res.ids[0]]);
        const r = { x, y, w: p.w, h: p.h };
        const vis = view.fitCamera(r, { maxZoom: view.camera.zoom });
        if (vis.zoom < view.camera.zoom) view.setCamera(vis);
        else {
          const s0 = toScreen(view.camera, x, y);
          const s1 = toScreen(view.camera, x + p.w, y + p.h);
          if (s1.x < 0 || s0.x > view.size.w || s1.y < 0 || s0.y > view.size.h) view.setCamera(vis);
        }
      }
      return res;
    },
    deleteSelection: () => guard(() => ctl.deleteSelection(t("Delete layers"))),
    duplicateSelection: () => guard(() => ctl.duplicateSelection(t("Duplicate layers"))),
    selectAll: () => ctl.selectAll(),
    selectParent: () => ctl.selectParent(),
    selectChildren: () => ctl.selectChildren(),
    activate() {
      active = true;
      publishPanels();
      render();
      view.themeChanged();
    },
    deactivate() {
      active = false;
      hover = null;
    },
    destroy() {
      destroyed = true;
      offChange();
      view.destroy();
    },
  };
  layers = createLayersPanel(api);
  inspector = createInspector(api);
  function publishPanels() {
    setPanelSlot(app, "proto-layers", { el: layers.el, show: () => layers.render() });
    setPanelSlot(app, "proto-inspector", { el: inspector.el, show: () => inspector.render() });
  }
  render();
  return api;
}
