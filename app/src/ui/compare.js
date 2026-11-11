// Before / after compare for the Pixel studio (View ▸ Compare Before / After). Loaded on demand.
//
// "Before" is a snapshot of each page as it looked when the Pixel studio first showed it in this session (taken a moment
// after the document appears, rendered at up to 8 megapixels), or whatever *Set Current State as Before* captured later.
// While compare is on, the overlay draws the snapshot left of a vertical divider and the live document right of it;
// drag the divider (or press the arrow keys while the canvas has focus) to move it. Nothing touches the document.
// Snapshots live in memory only (a WeakMap per document) and are dropped with the document.
import { buildPageDL } from "../engine/dl.js";
import { renderToCanvas, CanvasPool } from "../engine/backends/canvas.js";
import { t } from "../i18n/index.js";

const MAX_PIXELS = 8_000_000;
const snaps = new WeakMap(); // doc → Map(pageId → { canvas, w, h })
const scheduled = new WeakSet();
const state = { on: false, x: 0.5, installed: false, drag: false };

/** Renders the page (all visible layers, page background) to a canvas of at most MAX_PIXELS. */
function renderPage(doc, page) {
  const W = Math.max(1, Math.round(page.w)), H = Math.max(1, Math.round(page.h));
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (W * H)));
  const items = buildPageDL(doc, page).items;
  return renderToCanvas({ width: page.w, height: page.h, items }, { scale, width: Math.max(1, Math.round(W * scale)), height: Math.max(1, Math.round(H * scale)), bg: page.bg, pool: new CanvasPool({ cpu: true }) });
}

/** Stores the current look of `page` as its "before" state. */
export function setBefore(app, doc = app.doc, page = app.page) {
  if (!doc || !page) return false;
  let m = snaps.get(doc);
  if (!m) snaps.set(doc, (m = new Map()));
  m.set(page.id, { canvas: renderPage(doc, page), w: page.w, h: page.h });
  app.requestOverlay?.();
  return true;
}

export function hasBefore(app) {
  return !!(app.doc && app.page && snaps.get(app.doc)?.has(app.page.id));
}

/**
 * Called when a document or page shows up in the Pixel studio: takes its first snapshot shortly after (assets have
 * a moment to decode), unless one exists. Edits within that moment would be part of "before"; *Set Current State as
 * Before* retakes it.
 */
export function captureFirstLook(app) {
  const doc = app.doc, page = app.page;
  if (!doc || !page || snaps.get(doc)?.has(page.id)) return;
  const key = page;
  if (scheduled.has(key)) return;
  scheduled.add(key);
  const take = () => {
    if (app.doc === doc && doc.pages?.includes?.(page) !== false && !snaps.get(doc)?.has(page.id)) {
      try {
        setBefore(app, doc, page);
      } catch {
        // a page that cannot render yet (no size) simply has no before state
      }
    }
  };
  setTimeout(() => (globalThis.requestIdleCallback ? requestIdleCallback(take, { timeout: 800 }) : take()), 300);
}

function install(app) {
  if (state.installed) return;
  state.installed = true;
  app.on("overlay-extra", (ctx) => {
    if (!state.on || !app.doc || !app.page) return;
    const snap = snaps.get(app.doc)?.get(app.page.id);
    if (!snap) return;
    const page = app.page;
    const [x0, y0] = app.pageToScreen(0, 0);
    const [x1, y1] = app.pageToScreen(page.w, page.h);
    const sx = x0 + (x1 - x0) * state.x;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, sx - x0, y1 - y0);
    ctx.clip();
    // the snapshot keeps its own page size (a crop or resize afterwards shows it scaled to the old proportions)
    ctx.drawImage(snap.canvas, x0, y0, (x1 - x0) * (snap.w / page.w), (y1 - y0) * (snap.h / page.h));
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 3;
    ctx.fillRect(Math.round(sx) - 1, y0, 2, y1 - y0);
    const my = (y0 + y1) / 2;
    ctx.beginPath();
    ctx.arc(sx, my, 11, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(sx - 7, my);
    ctx.lineTo(sx - 2, my - 5);
    ctx.lineTo(sx - 2, my + 5);
    ctx.moveTo(sx + 7, my);
    ctx.lineTo(sx + 2, my - 5);
    ctx.lineTo(sx + 2, my + 5);
    ctx.fill();
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "top";
    const label = (text, x, align) => {
      ctx.textAlign = align;
      const w = ctx.measureText(text).width + 12;
      const lx = align === "right" ? x - w : x;
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(lx, Math.max(y0, 0) + 8, w, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, align === "right" ? x - 6 : x + 6, Math.max(y0, 0) + 12);
    };
    label(t("Before"), sx - 8, "right");
    label(t("After"), sx + 8, "left");
    ctx.restore();
  });
  const stage = app.cv?.stage;
  if (!stage) return;
  const pageX = (e) => {
    const r = stage.getBoundingClientRect();
    const [x0] = app.pageToScreen(0, 0);
    const [x1] = app.pageToScreen(app.page.w, 0);
    return { sx: e.clientX - r.left, x0, x1 };
  };
  // capture phase: a press on the divider moves it instead of reaching the active tool
  stage.addEventListener("pointerdown", (e) => {
    if (!state.on || !hasBefore(app) || e.button !== 0) return;
    const { sx, x0, x1 } = pageX(e);
    if (Math.abs(sx - (x0 + (x1 - x0) * state.x)) > 12) return;
    state.drag = true;
    stage.setPointerCapture?.(e.pointerId);
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
  stage.addEventListener("pointermove", (e) => {
    if (!state.drag) return;
    const { sx, x0, x1 } = pageX(e);
    state.x = Math.max(0, Math.min(1, (sx - x0) / Math.max(1, x1 - x0)));
    e.stopImmediatePropagation();
    app.requestOverlay();
  }, true);
  const end = (e) => {
    if (!state.drag) return;
    state.drag = false;
    e.stopImmediatePropagation();
  };
  stage.addEventListener("pointerup", end, true);
  stage.addEventListener("pointercancel", end, true);
  stage.addEventListener("keydown", (e) => {
    if (!state.on || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !e.altKey) return;
    state.x = Math.max(0, Math.min(1, state.x + (e.key === "ArrowLeft" ? -0.05 : 0.05)));
    e.preventDefault();
    e.stopImmediatePropagation();
    app.requestOverlay();
  }, true);
}

export function isComparing() {
  return state.on;
}

/** Turns the split view on or off (`on` omitted: toggles). Returns the new state or a reason string. */
export function toggleCompare(app, on = !state.on) {
  install(app);
  if (on && !hasBefore(app)) {
    state.on = false;
    return t("There is no before state for this page yet. Choose View ▸ Set Current State as Before first.");
  }
  state.on = !!on;
  if (state.on) state.x = 0.5;
  app.requestOverlay();
  app.emit("menuschanged");
  return state.on;
}
