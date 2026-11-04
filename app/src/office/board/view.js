// Whiteboard UI: the infinite canvas of the board app (docs/office-board.md). Mounted by office/board/app.js; one
// instance per document becomes `app.officeUI`. Two stacked canvases: the scene (elements of the current page through
// render.js display lists and engine/backends/canvas.js, redrawn when the model or camera changes) and the overlay
// (selection, handles, ink in progress, laser, eraser; redrawn every animation frame while something moves).
//
// Input: pointer events (pen pressure, coalesced samples, palm rejection: once a stylus was seen, touch only pans and
// zooms), two-finger pinch, wheel (Ctrl/⌘ = zoom), Space or the middle button to pan, keyboard shortcuts while the
// board has focus (single-key tools, Delete, Mod+D/G/A, arrows). Every finished gesture is one commitOffice step.
// Instance API (used by commands/office-board.js and the Vibe tools): see the object returned by mountBoard().
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { commitOffice } from "../../core/office.js";
import { ribbon, button, colorPicker, zoomControl, officeContextMenu, promptDialog } from "../toolkit/ui.js";
import { drawDisplayList, CanvasPool } from "../../engine/backends/canvas.js";
import { elementItems, inkOutline } from "./render.js";
import { measureText } from "./app.js";
import { officeItemAnchor } from "../../collab/anchors.js";
import * as M from "./model.js";

const TOOLS = [
  { id: "select", icon: "cursor", label: N_("Select"), key: "V" },
  { id: "hand", icon: "hand-index-thumb", label: N_("Hand (pan)"), key: "H" },
  { id: "pen", icon: "pen", label: N_("Pen"), key: "P" },
  { id: "highlighter", icon: "brush", label: N_("Highlighter"), key: "M" },
  { id: "eraser", icon: "eraser", label: N_("Eraser"), key: "E" },
  { id: "laser", icon: "record", label: N_("Laser pointer"), key: "K" },
  { id: "rect", icon: "square", label: N_("Rectangle"), key: "R" },
  { id: "ellipse", icon: "circle", label: N_("Ellipse"), key: "O" },
  { id: "diamond", icon: "diamond", label: N_("Diamond"), key: "D" },
  { id: "line", icon: "slash-lg", label: N_("Line"), key: "L" },
  { id: "arrow", icon: "arrow-right", label: N_("Arrow (connector)"), key: "A" },
  { id: "text", icon: "fonts", label: N_("Text"), key: "T" },
  { id: "sticky", icon: "sticky", label: N_("Sticky note"), key: "N" },
  { id: "image", icon: "image", label: N_("Image"), key: "I" },
  { id: "frame", icon: "bounding-box", label: N_("Frame"), key: "F" },
];
const GRID = 20;
const HANDLE = 8;
const BINDABLE = (e) => e && !M.LINEAR.includes(e.type) && !M.INK.includes(e.type);
const CLIP_MARK = "openfini-board";
const mod = (e) => (/Mac|iPhone|iPad/.test(navigator.platform || "") ? e.metaKey : e.ctrlKey);

export function mountBoard(host, doc, app) {
  const prj = doc.office;
  const view = (prj.view.board ||= { x: -40, y: -40, zoom: 1, grid: false, snap: false });
  const model = () => draft || prj.model;
  if (!prj.model.pages.some((p) => p.id === prj.view.boardPage)) prj.view.boardPage = M.sortedPages(prj.model)[0].id;
  const page = () => prj.view.boardPage;

  let draft = null; // model shown while a gesture runs (committed at its end)
  let tool = "select";
  const sel = new Set();
  const style = { stroke: "#1e1e1e", fill: null, fillStyle: "hachure", width: 2, dash: "solid", rough: 1, font: "hand", fontSize: 24, sticky: M.STICKY_COLORS[0], penWidth: 3 };
  let gesture = null;
  let laser = [];
  let editing = null; // { id, ta, created }
  let penSeen = false;
  let spaceDown = false;
  let hoverBind = null;
  let destroyed = false;

  // ------------------------------------------------------------------------------------------- DOM
  const scene = h("canvas.of-board__scene", { "aria-hidden": "true" });
  const overlay = h("canvas.of-board__overlay", { "aria-hidden": "true" });
  const stage = h("div.of-board__stage", { tabindex: "0", role: "application", "aria-label": t("Whiteboard canvas"), "aria-roledescription": t("whiteboard") }, scene, overlay);
  const live = h("div.of-board__live", { role: "status", "aria-live": "polite" });
  const toolButtons = new Map();
  const toolBtn = (d) => {
    const b = button({ icon: d.icon, label: `${t(d.label)} (${d.key})`, toggle: true, pressed: d.id === tool, onClick: () => setTool(d.id) });
    toolButtons.set(d.id, b);
    return b;
  };
  const strokePick = colorPicker({ label: N_("Stroke color"), value: style.stroke, onPick: (c) => applyStyle({ stroke: c || "#1e1e1e" }) });
  const fillPick = colorPicker({ label: N_("Fill color"), value: null, allowNone: true, onPick: (c) => applyStyle({ fill: c || null }) });
  const widthSel = h("select.of-tk-input.of-board__select", { "aria-label": t("Stroke width"), "data-tip": t("Stroke width") }, [1, 2, 4, 8].map((w) => h("option", { value: String(w) }, t("{n} px", { n: w }))));
  widthSel.value = "2";
  widthSel.addEventListener("change", () => applyStyle({ width: +widthSel.value }));
  const dashSel = h("select.of-tk-input.of-board__select", { "aria-label": t("Line style"), "data-tip": t("Line style") }, h("option", { value: "solid" }, t("Solid")), h("option", { value: "dashed" }, t("Dashed")), h("option", { value: "dotted" }, t("Dotted")));
  dashSel.addEventListener("change", () => applyStyle({ dash: dashSel.value }));
  const fillSel = h("select.of-tk-input.of-board__select", { "aria-label": t("Fill style"), "data-tip": t("Fill style") }, h("option", { value: "hachure" }, t("Hatched")), h("option", { value: "cross" }, t("Cross-hatched")), h("option", { value: "solid" }, t("Solid fill")));
  fillSel.addEventListener("change", () => applyStyle({ fillStyle: fillSel.value }));
  const fontSel = h("select.of-tk-input.of-board__select", { "aria-label": t("Font"), "data-tip": t("Font") }, h("option", { value: "hand" }, t("Handwritten")), h("option", { value: "sans" }, t("Sans serif")), h("option", { value: "serif" }, t("Serif")), h("option", { value: "mono" }, t("Monospace")));
  fontSel.addEventListener("change", () => applyStyle({ font: fontSel.value }));
  const roughBtn = button({ icon: "feather", label: N_("Hand-drawn style"), toggle: true, pressed: true, onClick: () => toggleRough() });
  const gridBtn = button({ icon: "grid-3x3", label: N_("Show grid"), toggle: true, pressed: view.grid, onClick: () => toggleGrid() });
  const snapBtn = button({ icon: "magnet", label: N_("Snap to grid"), toggle: true, pressed: view.snap, onClick: () => toggleSnap() });
  const zoom = zoomControl({ value: view.zoom, min: 0.1, max: 8, onChange: (z) => zoomAt(z, null) });
  const bar = ribbon([
    { id: "tools", label: N_("Tools"), items: TOOLS.slice(0, 6).map(toolBtn) },
    { id: "shapes", label: N_("Shapes"), items: TOOLS.slice(6, 11).map(toolBtn) },
    { id: "insert", label: N_("Insert"), items: TOOLS.slice(11).map(toolBtn) },
    { id: "style", label: N_("Style"), items: [strokePick.el, fillPick.el, fillSel, widthSel, dashSel, fontSel, roughBtn] },
    {
      id: "arrange",
      label: N_("Arrange"),
      items: [
        button({ icon: "collection", label: N_("Group"), onClick: () => group() }),
        button({ icon: "view-stacked", label: N_("Ungroup"), onClick: () => ungroup() }),
        button({ icon: "front", label: N_("Bring to front"), onClick: () => order("front") }),
        button({ icon: "back", label: N_("Send to back"), onClick: () => order("back") }),
        button({ icon: "align-start", label: N_("Align left"), onClick: () => align("left") }),
        button({ icon: "align-center", label: N_("Align centers"), onClick: () => align("center") }),
        button({ icon: "align-top", label: N_("Align top"), onClick: () => align("top") }),
        button({ icon: "distribute-horizontal", label: N_("Distribute horizontally"), onClick: () => distribute("horizontal") }),
        button({ icon: "trash", label: N_("Delete"), onClick: () => deleteSelection() }),
      ],
    },
    { id: "view", label: N_("View"), items: [gridBtn, snapBtn, zoom.el, button({ icon: "arrows-expand", label: N_("Zoom to fit"), onClick: () => fit() })] },
  ]);
  const pagesBar = h("div.of-board__pages", { role: "tablist", "aria-label": t("Pages") });
  const root = h("div.of-board", bar, stage, pagesBar, live);
  host.replaceChildren(root);

  // ------------------------------------------------------------------------------------------- camera
  const toWorld = (sx, sy) => [sx / view.zoom + view.x, sy / view.zoom + view.y];
  const toScreen = (wx, wy) => [(wx - view.x) * view.zoom, (wy - view.y) * view.zoom];
  const eventPoint = (e) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const snapV = (v) => (view.snap ? Math.round(v / GRID) * GRID : v);
  function zoomAt(z, at) {
    z = Math.max(0.1, Math.min(8, z));
    const r = stage.getBoundingClientRect();
    const [sx, sy] = at || [r.width / 2, r.height / 2];
    const [wx, wy] = toWorld(sx, sy);
    view.zoom = z;
    view.x = wx - sx / z;
    view.y = wy - sy / z;
    zoom.set(z);
    invalidate(true);
    app.emit("officestatus");
  }
  function fit(els = M.pageElements(model(), page())) {
    const b = M.unionBounds(els);
    const r = stage.getBoundingClientRect();
    if (!b || r.width < 10) {
      view.x = -40;
      view.y = -40;
      return zoomAt(1, [0, 0]);
    }
    const z = Math.max(0.1, Math.min(2, Math.min((r.width - 80) / Math.max(1, b.w), (r.height - 80) / Math.max(1, b.h))));
    view.zoom = z;
    view.x = b.x + b.w / 2 - r.width / 2 / z;
    view.y = b.y + b.h / 2 - r.height / 2 / z;
    zoom.set(z);
    invalidate(true);
    app.emit("officestatus");
  }

  // ------------------------------------------------------------------------------------------- images
  const images = new Map(); // media id → { bytes, ref | null, pending }
  function imageRef(id) {
    const md = model().media?.[id];
    if (!md?.bytes) return null;
    let c = images.get(id);
    if (c && c.bytes !== md.bytes) c = null;
    if (!c) {
      c = { bytes: md.bytes, ref: null };
      images.set(id, c);
      createImageBitmap(new Blob([md.bytes], { type: md.mime }))
        .then((bmp) => {
          c.ref = { id, width: bmp.width, height: bmp.height, source: bmp };
          invalidate(true);
        })
        .catch(() => {});
    }
    return c.ref;
  }
  const rctx = { measure: measureText, image: imageRef, key: "screen" };

  // ------------------------------------------------------------------------------------------- rendering
  const pool = new CanvasPool();
  let sceneDirty = true;
  let frame = 0;
  let size = { w: 0, h: 0, dpr: 1 };
  function invalidate(sceneToo = false) {
    if (sceneToo) sceneDirty = true;
    if (!frame && !destroyed) frame = requestAnimationFrame(paint);
  }
  function resize() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width));
    const hh = Math.max(1, Math.round(r.height));
    if (w === size.w && hh === size.h && dpr === size.dpr) return;
    size = { w, h: hh, dpr };
    for (const c of [scene, overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hh * dpr);
    }
    invalidate(true);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  function paint() {
    frame = 0;
    if (destroyed) return;
    if (sceneDirty) paintScene();
    paintOverlay();
    if (laser.length) invalidate();
  }

  function paintScene() {
    sceneDirty = false;
    const ctx = scene.getContext("2d");
    const { dpr } = size;
    const m = model();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = m.background || "#ffffff";
    ctx.fillRect(0, 0, scene.width, scene.height);
    const pg = m.pages.find((p) => p.id === page());
    paintPaper(ctx, view.grid && pg?.paper === "plain" ? "grid" : pg?.paper || "plain");
    const [vx0, vy0] = toWorld(0, 0);
    const [vx1, vy1] = toWorld(size.w, size.h);
    const items = [];
    for (const el of M.pageElements(m, page())) {
      const b = M.bounds(el);
      if (b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0) continue;
      const shown = editing?.id === el.id ? { ...el, text: "", name: el.type === "frame" ? el.name : undefined } : el;
      items.push(...elementItems(shown, rctx));
    }
    const z = view.zoom * dpr;
    drawDisplayList(ctx, { items }, { base: [z, 0, 0, z, -view.x * z, -view.y * z], pool, region: { x: 0, y: 0, w: scene.width, h: scene.height } });
  }

  function paintPaper(ctx, paper) {
    if (paper === "plain") return;
    const { dpr } = size;
    const step = (paper === "lines" ? 32 : GRID) * view.zoom;
    if (step < 6) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    const ox = (-view.x * view.zoom) % step;
    const oy = (-view.y * view.zoom) % step;
    ctx.fillStyle = ctx.strokeStyle = "rgba(120, 130, 150, 0.35)";
    ctx.lineWidth = 1;
    if (paper === "dots") {
      for (let x = ox; x < size.w; x += step) for (let y = oy; y < size.h; y += step) ctx.fillRect(x - 1, y - 1, 2, 2);
    } else {
      ctx.beginPath();
      if (paper === "grid") for (let x = ox; x < size.w; x += step) (ctx.moveTo(Math.round(x) + 0.5, 0), ctx.lineTo(Math.round(x) + 0.5, size.h));
      for (let y = oy; y < size.h; y += step) (ctx.moveTo(0, Math.round(y) + 0.5), ctx.lineTo(size.w, Math.round(y) + 0.5));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Handles of the selection: { box (world, unrotated), angle, center, handles: [{ id, x, y }] (screen) }. */
  function selectionFrame() {
    const m = model();
    const els = [...sel].map((id) => m.elements[id]).filter(Boolean);
    if (!els.length) return null;
    if (els.length === 1 && M.LINEAR.includes(els[0].type)) {
      const pts = M.absPoints(els[0]);
      return { linear: els[0], handles: [{ id: "p0", ...xy(toScreen(...pts[0])) }, { id: `p${pts.length - 1}`, ...xy(toScreen(...pts[pts.length - 1])) }] };
    }
    const single = els.length === 1 && !els[0].group;
    const box = single ? { x: els[0].x, y: els[0].y, w: els[0].w, h: els[0].h } : M.unionBounds(els);
    const angle = single ? els[0].angle || 0 : 0;
    const c = [box.x + box.w / 2, box.y + box.h / 2];
    const at = (fx, fy) => xy(toScreen(...M.rotate([box.x + box.w * fx, box.y + box.h * fy], c, angle)));
    const handles = [
      { id: "nw", ...at(0, 0) }, { id: "n", ...at(0.5, 0) }, { id: "ne", ...at(1, 0) }, { id: "e", ...at(1, 0.5) },
      { id: "se", ...at(1, 1) }, { id: "s", ...at(0.5, 1) }, { id: "sw", ...at(0, 1) }, { id: "w", ...at(0, 0.5) },
    ];
    const top = M.rotate([c[0], box.y], c, angle);
    const dir = [Math.sin(angle), -Math.cos(angle)];
    const [tx, ty] = toScreen(...top);
    handles.push({ id: "rot", x: tx + dir[0] * 24, y: ty + dir[1] * 24 });
    const locked = els.some((e) => e.locked);
    return { box, angle, center: c, handles: locked ? [] : els.length === 1 && els[0].type === "text" ? handles.filter((x) => ["nw", "ne", "se", "sw", "rot"].includes(x.id)) : handles, els };
  }
  const xy = ([x, y]) => ({ x, y });

  function paintOverlay() {
    const ctx = overlay.getContext("2d");
    const { dpr } = size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const accent = getComputedStyle(root).getPropertyValue("--of-accent").trim() || "#6b58e8";
    // ink in progress
    if (gesture?.kind === "ink" && gesture.points.length) {
      const pts = gesture.points.map(([x, y, p]) => [...toScreen(x, y), p]);
      ctx.save();
      if (gesture.type === "highlighter") {
        ctx.globalAlpha = 0.45;
        ctx.globalCompositeOperation = "multiply";
        ctx.strokeStyle = style.highlight || "#ffd43b";
        ctx.lineWidth = 18 * view.zoom;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      } else {
        ctx.fillStyle = style.stroke;
        const poly = inkOutline(pts, style.penWidth * view.zoom);
        ctx.beginPath();
        poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    // selection
    const f = gesture?.kind === "ink" ? null : selectionFrame();
    if (f) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      if (!f.linear) {
        if (f.els.length > 1) for (const el of f.els) outline(ctx, el, accent, 0.45);
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([fx, fy]) => toScreen(...M.rotate([f.box.x + f.box.w * fx, f.box.y + f.box.h * fy], f.center, f.angle)));
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        const rot = f.handles.find((x) => x.id === "rot");
        if (rot) {
          const n = f.handles.find((x) => x.id === "n");
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(rot.x, rot.y);
          ctx.stroke();
        }
      }
      for (const hd of f.handles) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        if (hd.id === "rot" || f.linear) ctx.arc(hd.x, hd.y, HANDLE / 2 + 1, 0, Math.PI * 2);
        else ctx.rect(hd.x - HANDLE / 2, hd.y - HANDLE / 2, HANDLE, HANDLE);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (hoverBind) outline(ctx, hoverBind, accent, 1, 4);
    if (gesture?.kind === "marquee") {
      const { a, b } = gesture;
      const [x0, y0] = toScreen(Math.min(a[0], b[0]), Math.min(a[1], b[1]));
      const [x1, y1] = toScreen(Math.max(a[0], b[0]), Math.max(a[1], b[1]));
      ctx.fillStyle = "rgba(107, 88, 232, 0.08)";
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = accent;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    }
    if (gesture?.kind === "erase" && gesture.at) {
      const [x, y] = toScreen(...gesture.at);
      ctx.strokeStyle = "rgba(120,120,120,0.8)";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    // laser: a fading red trail
    const now = performance.now();
    laser = laser.filter((p) => now - p[2] < 900);
    if (laser.length > 1) {
      ctx.save();
      ctx.lineCap = ctx.lineJoin = "round";
      for (let i = 1; i < laser.length; i++) {
        const a = laser[i - 1];
        const b = laser[i];
        const life = 1 - (now - b[2]) / 900;
        ctx.strokeStyle = `rgba(255, 40, 40, ${Math.max(0, life)})`;
        ctx.lineWidth = 2 + 5 * life;
        ctx.beginPath();
        ctx.moveTo(...toScreen(a[0], a[1]));
        ctx.lineTo(...toScreen(b[0], b[1]));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function outline(ctx, el, color, alpha = 1, pad = 2) {
    const c = M.center(el);
    const pts = [[el.x - pad, el.y - pad], [el.x + el.w + pad, el.y - pad], [el.x + el.w + pad, el.y + el.h + pad], [el.x - pad, el.y + el.h + pad]].map((p) => toScreen(...M.rotate(p, c, el.angle || 0)));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------- model changes
  function commit(label, next, opts) {
    draft = null;
    if (next && next !== prj.model) commitOffice(doc, label, next, opts);
    invalidate(true);
  }
  const offChange = prj.on("change", () => {
    if (!prj.model.pages.some((p) => p.id === page())) prj.view.boardPage = M.sortedPages(prj.model)[0].id;
    for (const id of [...sel]) if (!prj.model.elements[id] || prj.model.elements[id].page !== page()) sel.delete(id);
    renderPages();
    syncStyleControls();
    invalidate(true);
    app.emit("officestatus");
  });

  function setSelection(ids, { announce = true } = {}) {
    sel.clear();
    for (const id of ids) if (model().elements[id]) sel.add(id);
    syncStyleControls();
    invalidate();
    app.emit("officestatus");
    if (announce) live.textContent = sel.size ? t("{n} selected", { n: sel.size }) : "";
  }

  function setTool(id) {
    if (!TOOLS.some((x) => x.id === id)) return;
    if (id === "image") return insertImage();
    tool = id;
    for (const [k, b] of toolButtons) b.setAttribute("aria-pressed", String(k === id));
    stage.dataset.tool = id;
    if (id !== "select") setSelection([], { announce: false });
    stage.focus({ preventScroll: true });
  }

  /** Style controls follow the selection; changing them restyles the selection and sets the default for new items. */
  function syncStyleControls() {
    const el = model().elements[[...sel][0]];
    if (!el) return;
    strokePick.set(el.stroke || null);
    fillPick.set(el.fill || null);
    if (el.width) widthSel.value = [1, 2, 4, 8].includes(el.width) ? String(el.width) : widthSel.value;
    dashSel.value = el.dash || "solid";
    fillSel.value = el.fillStyle || "hachure";
    if (el.font) fontSel.value = el.font;
    roughBtn.setAttribute("aria-pressed", String(!!el.rough));
  }

  function applyStyle(p) {
    Object.assign(style, p);
    if ("width" in p) style.penWidth = p.width + 1;
    if (!sel.size) return;
    const patches = {};
    for (const id of sel) {
      const el = prj.model.elements[id];
      if (!el || el.locked) continue;
      const q = { ...p };
      if (el.type === "sticky" && "fill" in q) q.fill = q.fill || M.STICKY_COLORS[0];
      if (el.type === "sticky" && "stroke" in q) delete q.stroke;
      if (el.type === "text" && "font" in q) Object.assign(q, M.textBox(el.text, el.fontSize, (s, z) => measureText(s, z, q.font)));
      patches[id] = q;
    }
    commit("Change Style", M.updateElements(prj.model, patches));
  }

  // ------------------------------------------------------------------------------------------- creation helpers
  function newEl(type, props) {
    const base = { page: page(), stroke: style.stroke, width: style.width, dash: style.dash, rough: style.rough, font: style.font };
    if (M.SHAPES.includes(type)) Object.assign(base, { fill: style.fill, fillStyle: style.fillStyle });
    if (type === "sticky") Object.assign(base, { fill: style.sticky, stroke: "#1e1e1e" });
    if (type === "pen") Object.assign(base, { width: style.penWidth, rough: 0 });
    if (type === "highlighter") Object.assign(base, { stroke: style.highlight || "#ffd43b", width: 18, rough: 0 });
    if (type === "text") Object.assign(base, { fontSize: style.fontSize, fill: null });
    if (type === "frame") Object.assign(base, { stroke: "#868e96", width: 1, rough: 0 });
    return M.makeElement(type, { ...base, ...props });
  }

  // ------------------------------------------------------------------------------------------- pointer input
  const pointers = new Map();
  let pinch = null;
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onCancel);
  stage.addEventListener("lostpointercapture", (e) => gesture?.pointer === e.pointerId && onUp(e));
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("dblclick", onDouble);
  stage.addEventListener("contextmenu", onContext);

  function onDown(e) {
    if (editing) finishEditing();
    stage.focus({ preventScroll: true });
    if (e.pointerType === "pen") penSeen = true;
    pointers.set(e.pointerId, eventPoint(e));
    if (pointers.size === 2 && e.pointerType === "touch") {
      // a second finger: pinch zoom and pan, the current gesture is dropped
      cancelGesture();
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom: view.zoom, cam: [view.x, view.y] };
      return;
    }
    if (pointers.size > 2) return;
    const [sx, sy] = eventPoint(e);
    const w = toWorld(sx, sy);
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already released pointers */
    }
    const palm = e.pointerType === "touch" && penSeen; // palm rejection: with a stylus around, fingers navigate
    if (e.button === 1 || spaceDown || tool === "hand" || palm) {
      gesture = { kind: "pan", pointer: e.pointerId, start: [sx, sy], cam: [view.x, view.y] };
      stage.dataset.panning = "1";
      return;
    }
    if (e.button === 2) return;
    e.preventDefault();
    const m = prj.model;
    const pt = [snapV(w[0]), snapV(w[1])];
    switch (tool) {
      case "pen":
      case "highlighter":
        gesture = { kind: "ink", type: tool, pointer: e.pointerId, points: [[w[0], w[1], pressure(e)]] };
        break;
      case "eraser":
        gesture = { kind: "erase", pointer: e.pointerId, ids: new Set(), at: w };
        eraseAt(w);
        break;
      case "laser":
        gesture = { kind: "laser", pointer: e.pointerId };
        laser.push([w[0], w[1], performance.now()]);
        break;
      case "rect":
      case "ellipse":
      case "diamond":
      case "frame":
        gesture = { kind: "create", type: tool, pointer: e.pointerId, a: pt, b: pt };
        break;
      case "line":
      case "arrow": {
        const target = bindTarget(m, w);
        gesture = { kind: "connector", type: tool, pointer: e.pointerId, a: pt, b: pt, start: target ? { id: target.id } : null };
        break;
      }
      case "text":
        gesture = null;
        createText(pt);
        break;
      case "sticky":
        gesture = null;
        createSticky(pt);
        break;
      default:
        startSelectGesture(e, [sx, sy], w);
    }
    invalidate();
  }

  const pressure = (e) => (e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5);

  function startSelectGesture(e, s, w) {
    const m = prj.model;
    const f = selectionFrame();
    const hd = f?.handles.find((x) => Math.abs(x.x - s[0]) <= HANDLE && Math.abs(x.y - s[1]) <= HANDLE);
    if (hd && f.linear) {
      gesture = { kind: "endpoint", pointer: e.pointerId, id: f.linear.id, end: hd.id === "p0" ? 0 : -1, base: m };
      return;
    }
    if (hd) {
      gesture = hd.id === "rot" ? { kind: "rotate", pointer: e.pointerId, f, start: Math.atan2(w[1] - f.center[1], w[0] - f.center[0]), base: m } : { kind: "resize", pointer: e.pointerId, handle: hd.id, f, base: m };
      return;
    }
    // inside the box of the current selection (also hollow shapes): drag it
    const inSel = f && !f.linear && !e.shiftKey && (() => {
      const [lx, ly] = M.rotate(w, f.center, -f.angle);
      return lx >= f.box.x && lx <= f.box.x + f.box.w && ly >= f.box.y && ly <= f.box.y + f.box.h;
    })();
    const hit = inSel ? m.elements[[...sel][0]] : M.elementAt(m, page(), w[0], w[1], 6 / view.zoom);
    if (hit) {
      if (e.shiftKey) {
        const ids = new Set(sel);
        const grp = M.expandSelection(m, [hit.id]).filter((id) => m.elements[id].group === hit.group || id === hit.id);
        for (const id of grp) ids.has(id) ? ids.delete(id) : ids.add(id);
        setSelection([...ids]);
      } else if (!sel.has(hit.id)) setSelection(hit.group ? Object.values(m.elements).filter((x) => x.group === hit.group).map((x) => x.id) : [hit.id]);
      gesture = { kind: "move", pointer: e.pointerId, start: w, base: m, ids: M.expandSelection(m, [...sel]), moved: false, dup: e.altKey };
      return;
    }
    if (!e.shiftKey) setSelection([], { announce: false });
    gesture = { kind: "marquee", pointer: e.pointerId, a: w, b: w, keep: e.shiftKey ? [...sel] : [] };
  }

  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, eventPoint(e));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const z = Math.max(0.1, Math.min(8, (pinch.zoom * d) / Math.max(1, pinch.d)));
      // keep the world point under the start midpoint under the current midpoint
      const wx = pinch.mid[0] / pinch.zoom + pinch.cam[0];
      const wy = pinch.mid[1] / pinch.zoom + pinch.cam[1];
      view.zoom = z;
      view.x = wx - mid[0] / z;
      view.y = wy - mid[1] / z;
      zoom.set(z);
      invalidate(true);
      return;
    }
    const s = eventPoint(e);
    const w = toWorld(...s);
    if (!gesture) {
      if (tool === "line" || tool === "arrow") {
        const tgt = bindTarget(prj.model, w);
        if (tgt !== hoverBind) {
          hoverBind = tgt;
          invalidate();
        }
      }
      stage.style.cursor = tool === "select" ? hoverCursor(s, w) : "";
      return;
    }
    if (gesture.pointer !== e.pointerId) return;
    const g = gesture;
    const m = prj.model;
    switch (g.kind) {
      case "pan":
        view.x = g.cam[0] - (s[0] - g.start[0]) / view.zoom;
        view.y = g.cam[1] - (s[1] - g.start[1]) / view.zoom;
        invalidate(true);
        return;
      case "ink": {
        const samples = e.getCoalescedEvents?.() || [e];
        for (const ce of samples.length ? samples : [e]) {
          const [x, y] = toWorld(...eventPoint(ce));
          const last = g.points[g.points.length - 1];
          // light streamlining: follow the pointer at 65 %, removes jitter without lag
          const k = g.type === "pen" ? 0.65 : 0.5;
          const nx = last[0] + (x - last[0]) * k;
          const ny = last[1] + (y - last[1]) * k;
          if (Math.hypot(nx - last[0], ny - last[1]) * view.zoom > 0.75) g.points.push([nx, ny, pressure(ce)]);
        }
        invalidate();
        return;
      }
      case "erase":
        g.at = w;
        eraseAt(w);
        invalidate();
        return;
      case "laser":
        laser.push([w[0], w[1], performance.now()]);
        invalidate();
        return;
      case "create": {
        let b = [snapV(w[0]), snapV(w[1])];
        if (e.shiftKey) {
          const d = Math.max(Math.abs(b[0] - g.a[0]), Math.abs(b[1] - g.a[1]));
          b = [g.a[0] + Math.sign(b[0] - g.a[0] || 1) * d, g.a[1] + Math.sign(b[1] - g.a[1] || 1) * d];
        }
        g.b = b;
        const el = newEl(g.type, { id: "draft", x: Math.min(g.a[0], b[0]), y: Math.min(g.a[1], b[1]), w: Math.abs(b[0] - g.a[0]), h: Math.abs(b[1] - g.a[1]), seed: 7 });
        draft = M.addElements(m, [el]);
        invalidate(true);
        return;
      }
      case "connector": {
        const tgt = bindTarget(m, w, g.start?.id);
        hoverBind = tgt;
        let b = [snapV(w[0]), snapV(w[1])];
        if (e.shiftKey) b = snapAngle(g.a, b);
        g.b = b;
        g.end = tgt ? { id: tgt.id } : null;
        const el = newEl(g.type, { id: "draft", points: [g.a, b], start: g.start, end: g.end, seed: 7 });
        draft = M.addElements(m, [el]);
        invalidate(true);
        return;
      }
      case "endpoint": {
        const el = g.base.elements[g.id];
        const pts = M.absPoints(el);
        const i = g.end === 0 ? 0 : pts.length - 1;
        const other = el[g.end === 0 ? "end" : "start"]?.id;
        const tgt = bindTarget(g.base, w, other || g.id);
        hoverBind = tgt;
        pts[i] = [snapV(w[0]), snapV(w[1])];
        g.bind = tgt ? { id: tgt.id } : null;
        const next = M.withAbsPoints({ ...el, [g.end === 0 ? "start" : "end"]: g.bind }, pts);
        draft = M.layoutConnectors({ ...g.base, elements: { ...g.base.elements, [g.id]: next } });
        invalidate(true);
        return;
      }
      case "move": {
        let dx = w[0] - g.start[0];
        let dy = w[1] - g.start[1];
        if (!g.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        if (view.snap) {
          const b = M.unionBounds(g.ids.map((id) => g.base.elements[id]));
          dx = snapV(b.x + dx) - b.x;
          dy = snapV(b.y + dy) - b.y;
        }
        g.moved = true;
        let base = g.base;
        let ids = g.ids;
        if (g.dup && !g.copy) {
          const r = M.duplicateElements(g.base, [...sel], 0, 0);
          g.copy = r;
        }
        if (g.copy) {
          base = g.copy.model;
          ids = M.expandSelection(base, g.copy.ids);
        }
        draft = M.moveElements(base, ids, dx, dy);
        invalidate(true);
        return;
      }
      case "resize":
        draft = resizeDraft(g, w, e.shiftKey);
        invalidate(true);
        return;
      case "rotate": {
        let a = Math.atan2(w[1] - g.f.center[1], w[0] - g.f.center[0]) - g.start;
        if (e.shiftKey) a = Math.round((g.f.angle + a) / (Math.PI / 12)) * (Math.PI / 12) - g.f.angle;
        draft = M.rotateElements(g.base, M.expandSelection(g.base, [...sel]), g.f.center, a);
        invalidate(true);
        return;
      }
      case "marquee": {
        g.b = w;
        const r = { x: Math.min(g.a[0], w[0]), y: Math.min(g.a[1], w[1]), w: Math.abs(w[0] - g.a[0]), h: Math.abs(w[1] - g.a[1]) };
        const inside = M.elementsInRect(m, page(), r).map((x) => x.id);
        setSelection([...new Set([...g.keep, ...inside])], { announce: false });
        return;
      }
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      app.emit("officestatus");
      return;
    }
    const g = gesture;
    if (!g || (g.pointer !== e.pointerId && e.type !== "lostpointercapture")) return;
    gesture = null;
    hoverBind = null;
    delete stage.dataset.panning;
    const m = prj.model;
    switch (g.kind) {
      case "pan":
        app.emit("officestatus");
        break;
      case "ink": {
        const pts = simplify(g.points, 0.6 / view.zoom);
        const el = newEl(g.type, { x: 0, y: 0, points: pts.map(([x, y, p]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(p * 100) / 100]) });
        commit(g.type === "pen" ? "Draw" : "Highlight", M.addElements(m, [el]));
        break;
      }
      case "erase":
        commit("Erase", g.ids.size ? M.removeElements(m, [...g.ids]) : null);
        break;
      case "create": {
        let { a, b } = g;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) * view.zoom < 6) {
          const [dw, dh] = g.type === "frame" ? [480, 320] : [160, 100];
          a = [a[0] - dw / 2, a[1] - dh / 2];
          b = [a[0] + dw, a[1] + dh];
        }
        const el = newEl(g.type, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
        let next = M.addElements(m, [el]);
        next = g.type === "frame" ? M.assignFrames(next, M.pageElements(next, page()).map((x) => x.id)) : M.assignFrames(next, [el.id]);
        commit(g.type === "frame" ? "Add Frame" : "Add Shape", next);
        setTool("select");
        setSelection([el.id]);
        break;
      }
      case "connector": {
        const { a, b } = g;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) * view.zoom < 6) {
          draft = null;
          invalidate(true);
          break;
        }
        const el = newEl(g.type, { points: [a, b], start: g.start, end: g.end && g.end.id !== g.start?.id ? g.end : null });
        commit(g.type === "arrow" ? "Add Arrow" : "Add Line", M.addElements(m, [el]));
        setTool("select");
        setSelection([el.id]);
        break;
      }
      case "endpoint":
      case "resize":
      case "rotate":
        commit(g.kind === "rotate" ? "Rotate" : g.kind === "resize" ? "Resize" : "Connect", draft);
        break;
      case "move":
        if (!g.moved) {
          draft = null;
          break;
        }
        {
          const ids = g.copy ? M.expandSelection(draft, g.copy.ids) : g.ids;
          commit(g.copy ? "Duplicate" : "Move", M.assignFrames(draft, ids));
          if (g.copy) setSelection(g.copy.ids);
        }
        break;
      case "marquee":
        invalidate();
        break;
    }
    app.emit("officestatus");
  }

  function onCancel(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (gesture?.pointer === e.pointerId) cancelGesture();
  }
  function cancelGesture() {
    gesture = null;
    draft = null;
    hoverBind = null;
    delete stage.dataset.panning;
    invalidate(true);
  }

  function onWheel(e) {
    e.preventDefault();
    const s = eventPoint(e);
    if (e.ctrlKey || e.metaKey) zoomAt(view.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), s);
    else {
      const k = e.deltaMode ? 20 : 1;
      view.x += ((e.shiftKey ? e.deltaY : e.deltaX) * k) / view.zoom;
      view.y += (e.shiftKey ? 0 : e.deltaY * k) / view.zoom;
      invalidate(true);
    }
  }

  function hoverCursor(s, w) {
    const f = selectionFrame();
    const hd = f?.handles.find((x) => Math.abs(x.x - s[0]) <= HANDLE && Math.abs(x.y - s[1]) <= HANDLE);
    if (hd) return hd.id === "rot" ? "grab" : f.linear ? "crosshair" : { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" }[hd.id];
    return M.elementAt(prj.model, page(), w[0], w[1], 6 / view.zoom) ? "move" : "";
  }

  function bindTarget(m, w, except = null) {
    const els = M.pageElements(m, page());
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.id === except || el.id === "draft" || !BINDABLE(el)) continue;
      const b = M.bounds(el);
      const pad = 12 / view.zoom;
      if (w[0] >= b.x - pad && w[0] <= b.x + b.w + pad && w[1] >= b.y - pad && w[1] <= b.y + b.h + pad) return el;
    }
    return null;
  }

  const snapAngle = (a, b) => {
    const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 12)) * (Math.PI / 12);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a[0] + Math.cos(ang) * d, a[1] + Math.sin(ang) * d];
  };

  function eraseAt(w) {
    const g = gesture;
    const base = prj.model;
    let changed = false;
    for (const el of M.pageElements(base, page())) {
      if (g.ids.has(el.id) || el.locked || el.type === "frame") continue;
      if (M.hitTest(el, w[0], w[1], 10 / view.zoom)) {
        g.ids.add(el.id);
        changed = true;
      }
    }
    if (changed) {
      const faded = {};
      for (const id of g.ids) faded[id] = { opacity: 0.2 };
      draft = { ...base, elements: { ...base.elements, ...Object.fromEntries(Object.entries(faded).map(([id, p]) => [id, { ...base.elements[id], ...p }])) } };
      invalidate(true);
    }
  }

  function resizeDraft(g, w, keepRatio) {
    const { f, handle } = g;
    const ids = M.expandSelection(g.base, [...sel]);
    const single = f.els.length === 1 && ids.length === 1;
    // pointer in the selection's unrotated frame
    const [lx, ly] = M.rotate(w, f.center, -f.angle);
    const b = f.box;
    let x0 = b.x;
    let y0 = b.y;
    let x1 = b.x + b.w;
    let y1 = b.y + b.h;
    if (handle.includes("w")) x0 = snapV(lx);
    if (handle.includes("e")) x1 = snapV(lx);
    if (handle.includes("n")) y0 = snapV(ly);
    if (handle.includes("s")) y1 = snapV(ly);
    const textOnly = single && f.els[0].type === "text";
    if ((keepRatio || textOnly || f.els[0].type === "image") && b.w && b.h && handle.length === 2) {
      const sx = (x1 - x0) / b.w;
      const sy = (y1 - y0) / b.h;
      const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
      if (handle.includes("w")) x0 = x1 - b.w * s * Math.sign(sx || 1) * Math.sign(s);
      else x1 = x0 + b.w * Math.abs(s) * Math.sign(sx || 1);
      if (handle.includes("n")) y0 = y1 - b.h * Math.abs(s) * Math.sign(sy || 1);
      else y1 = y0 + b.h * Math.abs(s) * Math.sign(sy || 1);
    }
    const nb = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(1, Math.abs(x1 - x0)), h: Math.max(1, Math.abs(y1 - y0)) };
    if (single) {
      // keep the opposite corner fixed in world space under rotation
      const lc = [nb.x + nb.w / 2, nb.y + nb.h / 2];
      const wc = M.rotate(lc, f.center, f.angle);
      const box = { x: wc[0] - nb.w / 2, y: wc[1] - nb.h / 2, w: nb.w, h: nb.h };
      const el = g.base.elements[ids[0]];
      return M.updateElements(g.base, { [el.id]: M.resizeElement(el, box) });
    }
    return M.resizeElements(g.base, ids, b, nb);
  }

  /** Ramer–Douglas–Peucker on ink samples (keeps pressure). */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1;
      let bd = tol;
      for (let i = a + 1; i < b; i++) {
        const d = M.distToPolyline(pts[i][0], pts[i][1], [pts[a], pts[b]]);
        if (d > bd) [best, bd] = [i, d];
      }
      if (best > 0) {
        keep[best] = 1;
        stack.push([a, best], [best, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // ------------------------------------------------------------------------------------------- text editing
  function createText(pt) {
    const el = newEl("text", { x: pt[0], y: pt[1] - style.fontSize * 0.6, text: "", ...M.textBox("", style.fontSize) });
    draft = M.addElements(prj.model, [el]);
    editText(el.id, true);
  }
  function createSticky(pt) {
    const el = newEl("sticky", { x: pt[0] - 100, y: pt[1] - 100 });
    const next = M.assignFrames(M.addElements(prj.model, [el]), [el.id]);
    commit("Add Sticky Note", next);
    setTool("select");
    setSelection([el.id]);
    editText(el.id);
  }

  function onDouble(e) {
    const w = toWorld(...eventPoint(e));
    const hit = M.elementAt(prj.model, page(), w[0], w[1], 6 / view.zoom);
    if (hit && !hit.locked && hit.type !== "image" && !M.INK.includes(hit.type)) return editText(hit.id);
    if (!hit && tool === "select") createText([snapV(w[0]), snapV(w[1])]);
  }

  function editText(id, created = false) {
    if (editing) finishEditing();
    const el = model().elements[id];
    if (!el) return;
    setSelection([id], { announce: false });
    const frame = el.type === "frame";
    const value = frame ? el.name || "" : el.text || "";
    const ta = h("textarea.of-board__editor", { "aria-label": frame ? t("Frame name") : t("Text"), spellcheck: "true", value });
    ta.value = value;
    const place = () => {
      const cur = model().elements[id] || el;
      const z = view.zoom;
      const size = (frame ? 14 : cur.fontSize || 20) * z;
      const fam = { hand: '"Comic Sans MS", "Segoe Print", cursive', sans: "Helvetica, Arial, sans-serif", serif: "Georgia, serif", mono: '"Courier New", monospace' }[frame ? "sans" : cur.font] || "sans-serif";
      let box;
      if (cur.type === "text") {
        const tb = M.textBox(ta.value || " ", cur.fontSize, (s, sz) => measureText(s, sz, cur.font));
        box = { x: cur.x, y: cur.y, w: Math.max(tb.w + cur.fontSize, 40), h: tb.h + 4 };
      } else if (frame) box = { x: cur.x, y: cur.y - 22, w: Math.max(cur.w, 120), h: 20 };
      else if (M.LINEAR.includes(cur.type)) {
        const pts = M.absPoints(cur);
        const mid = pts[Math.floor((pts.length - 1) / 2)];
        const nx = pts[Math.min(pts.length - 1, Math.floor((pts.length - 1) / 2) + 1)];
        box = { x: (mid[0] + nx[0]) / 2 - 80, y: (mid[1] + nx[1]) / 2 - size / z, w: 160, h: (size / z) * 2 };
      } else {
        const pad = cur.type === "sticky" ? 12 : 8;
        box = { x: cur.x + pad, y: cur.y + pad, w: cur.w - pad * 2, h: cur.h - pad * 2 };
      }
      const [sx, sy] = toScreen(box.x, box.y);
      Object.assign(ta.style, { left: `${sx}px`, top: `${sy}px`, width: `${box.w * z}px`, height: `${box.h * z}px`, fontSize: `${size}px`, fontFamily: fam, color: cur.type === "sticky" ? "#1e1e1e" : frame ? "#868e96" : cur.stroke, textAlign: cur.type === "text" ? cur.align || "left" : frame ? "left" : "center", transform: cur.angle && !M.LINEAR.includes(cur.type) ? `rotate(${cur.angle}rad)` : "", transformOrigin: `${(cur.x + cur.w / 2 - box.x) * z}px ${(cur.y + cur.h / 2 - box.y) * z}px` });
    };
    ta.addEventListener("input", place);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (mod(e) || frame))) {
        e.preventDefault();
        finishEditing();
        stage.focus({ preventScroll: true });
      }
    });
    ta.addEventListener("blur", () => editing?.ta === ta && finishEditing());
    editing = { id, ta, created, place };
    stage.append(ta);
    place();
    invalidate(true);
    requestAnimationFrame(() => {
      ta.focus();
      ta.select();
    });
  }

  function finishEditing() {
    const ed = editing;
    if (!ed) return;
    editing = null;
    ed.ta.remove();
    const base = draft || prj.model;
    const el = base.elements[ed.id];
    draft = null;
    if (!el) return invalidate(true);
    const text = ed.ta.value.replace(/\s+$/, "");
    if (el.type === "text" && !text.trim()) {
      commit("Delete Text", ed.created ? null : M.removeElements(prj.model, [el.id]));
      setSelection([]);
      return;
    }
    const patch = el.type === "frame" ? { name: text || "Frame" } : { text };
    if (el.type === "text") Object.assign(patch, M.textBox(text, el.fontSize, (s, sz) => measureText(s, sz, el.font)));
    if ((el.type === "frame" ? el.name : el.text) === text && !ed.created) return invalidate(true);
    commit(ed.created ? "Add Text" : "Edit Text", M.updateElements(base, { [el.id]: patch }));
  }

  // ------------------------------------------------------------------------------------------- keyboard
  stage.addEventListener("keydown", (e) => {
    if (e.target !== stage) return;
    const k = e.key;
    const m = prj.model;
    const ids = [...sel];
    const done = () => (e.preventDefault(), e.stopPropagation());
    if (k === " " && !e.repeat) {
      spaceDown = true;
      stage.dataset.space = "1";
      return done();
    }
    if (mod(e)) {
      const lk = k.toLowerCase();
      if (lk === "a") return done(), setSelection(M.pageElements(m, page()).map((x) => x.id));
      if (lk === "d") return done(), duplicate();
      if (lk === "g") return done(), e.shiftKey ? ungroup() : group();
      if (k === "]" || k === "}") return done(), order(e.shiftKey ? "front" : "forward");
      if (k === "[" || k === "{") return done(), order(e.shiftKey ? "back" : "backward");
      if (k === "0") return done(), zoomAt(1, null);
      if (k === "=" || k === "+") return done(), zoomAt(view.zoom * 1.25, null);
      if (k === "-") return done(), zoomAt(view.zoom / 1.25, null);
      return;
    }
    if (e.altKey) return;
    if (k === "Delete" || k === "Backspace") return done(), deleteSelection();
    if (k === "Escape") return done(), sel.size ? setSelection([]) : setTool("select");
    if (k === "Enter" && ids.length === 1) return done(), editText(ids[0]);
    if (k === "!" || (e.shiftKey && e.code === "Digit1")) return done(), fit();
    if (k.startsWith("Arrow") && ids.length) {
      const d = e.shiftKey ? 10 : 1;
      const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[k];
      done();
      return commit("Nudge", M.moveElements(m, M.expandSelection(m, ids), dx, dy), { coalesce: "board-nudge" });
    }
    if (k === "PageDown" || k === "PageUp") return done(), gotoPage(k === "PageDown" ? 1 : -1);
    const tl = TOOLS.find((x) => x.key === k.toUpperCase());
    if (tl && !e.shiftKey) return done(), setTool(tl.id);
  });
  stage.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      spaceDown = false;
      delete stage.dataset.space;
    }
  });

  // ------------------------------------------------------------------------------------------- clipboard and files
  const selectedEls = () => M.expandSelection(prj.model, [...sel]).map((id) => prj.model.elements[id]).sort(M.byZ);
  function clipPayload() {
    const els = selectedEls();
    if (!els.length) return null;
    const media = {};
    for (const e of els) if (e.media && prj.model.media[e.media]?.bytes) media[e.media] = { ...prj.model.media[e.media], bytes: undefined, data: M.toBase64(prj.model.media[e.media].bytes) };
    return { text: els.map(M.elementText).filter(Boolean).join("\n"), json: JSON.stringify({ [CLIP_MARK]: 1, elements: els, media }) };
  }
  let internalClip = null;
  root.addEventListener("copy", (e) => {
    if (editing || e.target !== stage) return;
    const p = clipPayload();
    if (!p) return;
    internalClip = p.json;
    e.clipboardData.setData("text/plain", p.json);
    e.preventDefault();
  });
  root.addEventListener("cut", (e) => {
    if (editing || e.target !== stage) return;
    const p = clipPayload();
    if (!p) return;
    internalClip = p.json;
    e.clipboardData.setData("text/plain", p.json);
    e.preventDefault();
    deleteSelection("Cut");
  });
  root.addEventListener("paste", (e) => {
    if (editing || e.target !== stage) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    e.preventDefault();
    if (files.length) return files.forEach((f) => insertImageFile(f));
    pasteText(e.clipboardData?.getData("text/plain") || "");
  });
  stage.addEventListener("dragover", (e) => e.dataTransfer?.types?.includes("Files") && e.preventDefault());
  stage.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const w = toWorld(...eventPoint(e));
    files.forEach((f, i) => insertImageFile(f, [w[0] + i * 24, w[1] + i * 24]));
  });

  async function pasteText(text) {
    if (!text) return;
    let json = null;
    try {
      json = text.trim().startsWith("{") ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const m = prj.model;
    const at = toWorld(size.w / 2, size.h / 2);
    if (json?.[CLIP_MARK] && Array.isArray(json.elements)) {
      const media = { ...m.media };
      for (const [id, md] of Object.entries(json.media || {})) if (!media[id] && md.data) media[id] = { id, mime: md.mime, name: md.name || "", w: md.w, h: md.h, bytes: M.fromBase64(md.data) };
      const src = M.normalizeBoard({ pages: [{ id: page() }], elements: Object.fromEntries(json.elements.map((x) => [x.id, { ...x, page: page() }])) });
      const box = M.unionBounds(Object.values(src.elements)) || { x: 0, y: 0, w: 0, h: 0 };
      const merged = { ...m, media, elements: { ...m.elements } };
      // paste into a scratch model, then copy with fresh ids next to the viewport center
      const scratch = { ...merged, elements: { ...merged.elements, ...src.elements } };
      const r = M.duplicateElements(scratch, Object.keys(src.elements), at[0] - box.x - box.w / 2, at[1] - box.y - box.h / 2, page());
      const elements = { ...r.model.elements };
      for (const id of Object.keys(src.elements)) if (!m.elements[id]) delete elements[id];
      commit("Paste", { ...r.model, elements });
      setSelection(r.ids);
      return;
    }
    if (json?.type === "excalidraw/clipboard" || json?.type === "excalidraw") {
      const { readExcalidraw } = await import("./formats.js");
      const src = readExcalidraw({ elements: json.elements || [], files: json.files || {} });
      const els = Object.values(src.elements);
      const box = M.unionBounds(els) || { x: 0, y: 0, w: 0, h: 0 };
      const moved = els.map((x) => ({ ...x, page: page(), z: "", id: M.newId(), x: x.x + at[0] - box.x - box.w / 2, y: x.y + at[1] - box.y - box.h / 2, start: null, end: null }));
      commit("Paste", M.addElements({ ...m, media: { ...m.media, ...src.media } }, moved));
      setSelection(moved.map((x) => x.id));
      return;
    }
    const el = newEl("text", { x: at[0], y: at[1], text: text.slice(0, 5000), ...M.textBox(text.slice(0, 5000), style.fontSize, (s, sz) => measureText(s, sz, style.font)) });
    commit("Paste", M.addElements(m, [el]));
    setSelection([el.id]);
  }

  function insertImage() {
    const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml", multiple: true, style: { display: "none" } });
    input.addEventListener("change", () => {
      [...input.files].forEach((f, i) => insertImageFile(f, null, i));
      input.remove();
    });
    root.append(input);
    input.click();
  }

  async function insertImageFile(file, at = null, i = 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) return app.toast(t("“{name}” is larger than 20 MB.", { name: file.name }), "warning");
    let w = 320;
    let hh = 240;
    let natural = [w, hh];
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: file.type }));
      const s = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
      w = bmp.width * s;
      hh = bmp.height * s;
      natural = [bmp.width, bmp.height];
      bmp.close?.();
    } catch {
      return app.toast(t("“{name}” is not an image this app can show.", { name: file.name }), "warning");
    }
    const id = M.newId("m");
    const c = at || toWorld(size.w / 2 + i * 24, size.h / 2 + i * 24);
    const m = prj.model;
    const el = newEl("image", { x: c[0] - w / 2, y: c[1] - hh / 2, w, h: hh, media: id, stroke: null, fill: null });
    commit("Insert Image", M.addElements({ ...m, media: { ...m.media, [id]: { id, mime: file.type || "image/png", name: file.name || "", w: natural[0], h: natural[1], bytes } } }, [el]));
    setTool("select");
    setSelection([el.id]);
  }

  // ------------------------------------------------------------------------------------------- operations
  function deleteSelection(label = "Delete") {
    if (!sel.size) return;
    const ids = M.expandSelection(prj.model, [...sel]).filter((id) => !prj.model.elements[id].locked);
    commit(label, M.removeElements(prj.model, ids));
    setSelection([]);
  }
  function duplicate() {
    if (!sel.size) return;
    const r = M.duplicateElements(prj.model, [...sel]);
    commit("Duplicate", r.model);
    setSelection(r.ids);
  }
  function group() {
    if (sel.size < 2) return;
    commit("Group", M.groupElements(prj.model, [...sel]));
  }
  function ungroup() {
    if (!sel.size) return;
    commit("Ungroup", M.ungroupElements(prj.model, [...sel]));
  }
  function order(how) {
    if (!sel.size) return;
    commit({ front: "Bring to Front", back: "Send to Back", forward: "Bring Forward", backward: "Send Backward" }[how], M.reorderElements(prj.model, M.expandSelection(prj.model, [...sel]), how));
  }
  function align(how) {
    if (sel.size < 2) return;
    commit("Align", M.alignElements(prj.model, [...sel], how));
  }
  function distribute(axis) {
    if (sel.size < 3) return;
    commit("Distribute", M.distributeElements(prj.model, [...sel], axis));
  }
  function arrange(layout) {
    const ids = sel.size >= 2 ? [...sel] : M.pageElements(prj.model, page()).filter((e) => !M.LINEAR.includes(e.type) && !M.INK.includes(e.type) && e.type !== "frame").map((e) => e.id);
    commit("Arrange", M.arrangeElements(prj.model, ids, { layout }));
  }
  function toggleLock() {
    if (!sel.size) return;
    const lock = ![...sel].every((id) => prj.model.elements[id]?.locked);
    commit(lock ? "Lock" : "Unlock", M.updateElements(prj.model, Object.fromEntries([...sel].map((id) => [id, { locked: lock }]))));
  }
  function toggleRough() {
    const on = roughBtn.getAttribute("aria-pressed") !== "true";
    roughBtn.setAttribute("aria-pressed", String(on));
    applyStyle({ rough: on ? 1 : 0 });
  }
  function toggleGrid() {
    view.grid = !view.grid;
    gridBtn.setAttribute("aria-pressed", String(view.grid));
    invalidate(true);
  }
  function toggleSnap() {
    view.snap = !view.snap;
    snapBtn.setAttribute("aria-pressed", String(view.snap));
  }

  // ------------------------------------------------------------------------------------------- pages
  function gotoPage(target) {
    const pages = M.sortedPages(prj.model);
    const i = pages.findIndex((p) => p.id === page());
    const next = typeof target === "number" ? pages[Math.max(0, Math.min(pages.length - 1, i + target))] : pages.find((p) => p.id === target);
    if (!next || next.id === page()) return;
    if (editing) finishEditing();
    prj.view.boardPage = next.id;
    setSelection([], { announce: false });
    renderPages();
    invalidate(true);
    live.textContent = t("Page {n} of {total}", { n: pages.indexOf(next) + 1, total: pages.length });
    app.emit("officestatus");
  }
  function addPage() {
    const cur = prj.model.pages.find((p) => p.id === page());
    const r = M.addPage(prj.model, { after: page(), paper: cur?.paper || "plain" });
    commit("Add Page", r.model);
    gotoPage(r.page);
  }
  async function renamePage(id = page()) {
    const p = prj.model.pages.find((x) => x.id === id);
    if (!p) return;
    const name = await promptDialog({ title: t("Rename page"), label: t("Name"), value: p.name });
    if (name && name.trim() && name !== p.name) commit("Rename Page", M.updatePage(prj.model, id, { name: name.trim().slice(0, 120) }));
  }
  function deletePage(id = page()) {
    if (prj.model.pages.length < 2) return app.toast(t("A whiteboard keeps at least one page."), "warning");
    const pages = M.sortedPages(prj.model);
    const i = pages.findIndex((p) => p.id === id);
    if (id === page()) prj.view.boardPage = (pages[i + 1] || pages[i - 1]).id;
    commit("Delete Page", M.removePage(prj.model, id));
  }
  function setPaper(paper) {
    commit("Page Paper", M.updatePage(prj.model, page(), { paper }));
  }
  function renderPages() {
    const pages = M.sortedPages(prj.model);
    const tabs = pages.map((p, i) => {
      const b = h("button.of-board__page", { type: "button", role: "tab", "aria-selected": String(p.id === page()), title: p.name }, h("span", p.name || t("Page {n}", { n: i + 1 })));
      b.addEventListener("click", () => gotoPage(p.id));
      b.addEventListener("dblclick", () => renamePage(p.id));
      b.addEventListener("contextmenu", (e) => officeContextMenu(app, e, "office-board", { doc, board: inst, page: p.id }));
      return b;
    });
    const cur = prj.model.pages.find((p) => p.id === page());
    const paper = h("select.of-tk-input.of-board__select", { "aria-label": t("Paper"), "data-tip": t("Paper") }, h("option", { value: "plain" }, t("Plain")), h("option", { value: "dots" }, t("Dotted")), h("option", { value: "grid" }, t("Squared")), h("option", { value: "lines" }, t("Lined")));
    paper.value = cur?.paper || "plain";
    paper.addEventListener("change", () => setPaper(paper.value));
    const add = button({ icon: "plus-lg", label: N_("Add page"), onClick: () => addPage() });
    pagesBar.replaceChildren(h("div.of-board__tabs", ...tabs), add, paper);
  }

  // ------------------------------------------------------------------------------------------- context menu
  function onContext(e) {
    const w = toWorld(...eventPoint(e));
    const hit = M.elementAt(prj.model, page(), w[0], w[1], 6 / view.zoom);
    if (hit && !sel.has(hit.id)) setSelection(hit.group ? Object.values(prj.model.elements).filter((x) => x.group === hit.group).map((x) => x.id) : [hit.id]);
    if (!hit) setSelection([]);
    officeContextMenu(app, e, "office-board", { doc, board: inst, at: w, element: hit?.id || null });
  }

  // ------------------------------------------------------------------------------------------- instance
  const inst = {
    kind: "board",
    doc,
    el: root,
    get selection() {
      return [...sel];
    },
    get page() {
      return page();
    },
    get tool() {
      return tool;
    },
    setTool,
    select: (ids) => setSelection(ids),
    deleteSelection,
    duplicate,
    group,
    ungroup,
    order,
    align,
    distribute,
    arrange,
    toggleLock,
    toggleRough,
    toggleGrid,
    toggleSnap,
    isGrid: () => view.grid,
    isSnap: () => view.snap,
    zoomBy: (f) => zoomAt(view.zoom * f, null),
    zoomTo: (z) => zoomAt(z, null),
    fit: () => fit(),
    gotoPage,
    addPage,
    renamePage,
    deletePage,
    setPaper,
    insertImage,
    editText: (id = [...sel][0]) => id && editText(id),
    copy: () => (stage.focus(), document.execCommand?.("copy")),
    cut: () => (stage.focus(), document.execCommand?.("cut")),
    async paste() {
      try {
        if (navigator.clipboard?.read) {
          for (const item of await navigator.clipboard.read()) {
            const img = item.types.find((x) => x.startsWith("image/"));
            if (img) return insertImageFile(new File([await item.getType(img)], "Pasted image", { type: img }));
          }
        }
        pasteText((await navigator.clipboard.readText()) || internalClip || "");
      } catch {
        if (internalClip) pasteText(internalClip);
        else app.toast(t("Use Ctrl+V to paste (the browser blocked clipboard access)."), "warning", 3500);
      }
    },
    /** Shows an element (comments, Vibe): switches to its page and centers it. */
    reveal(id) {
      const el = prj.model.elements[id];
      if (!el) return false;
      gotoPage(el.page);
      const b = M.bounds(el);
      view.x = b.x + b.w / 2 - size.w / 2 / view.zoom;
      view.y = b.y + b.h / 2 - size.h / 2 / view.zoom;
      setSelection([id]);
      invalidate(true);
      return true;
    },
    activate() {
      resize();
      renderPages();
      invalidate(true);
      requestAnimationFrame(() => stage.focus({ preventScroll: true }));
    },
    deactivate() {
      if (editing) finishEditing();
    },
    destroy() {
      destroyed = true;
      offChange?.();
      ro.disconnect();
      bar.destroy?.();
      for (const c of images.values()) c.ref?.source?.close?.();
      root.remove();
    },
    statusText() {
      const pages = M.sortedPages(prj.model);
      const n = pages.findIndex((p) => p.id === page()) + 1;
      const count = M.pageElements(prj.model, page()).length;
      const parts = [t("Page {n} of {total}", { n, total: pages.length }), t("{n} elements", { n: count })];
      if (sel.size) parts.push(t("{n} selected", { n: sel.size }));
      parts.push(`${Math.round(view.zoom * 100)}%`);
      return parts.join(" · ");
    },
    commentAnchor() {
      const id = [...sel][0];
      const el = id && prj.model.elements[id];
      if (!el) return null;
      return officeItemAnchor({ item: `el:${el.id}`, label: (M.elementText(el) || el.type).slice(0, 80) });
    },
    revealAnchor(anchor) {
      const key = String(anchor?.item || "");
      return key.startsWith("el:") ? inst.reveal(key.slice(3)) : false;
    },
  };
  stage.dataset.tool = tool;
  renderPages();
  resize();
  if (!Object.keys(prj.model.elements).length) {
    view.x = -60;
    view.y = -60;
  } else if (!view.fitted) requestAnimationFrame(() => fit());
  view.fitted = true;
  import("../../commands/office-board.js").then((m) => m.registerBoardCommands(app)).catch(() => {});
  return inst;
}
