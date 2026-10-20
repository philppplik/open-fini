// The document viewport: renders pages, rulers, guides and tool overlays, and routes pointer
// input to the active tool. Pan/zoom is previewed with a GPU-composited CSS transform and the
// pixels are re-rendered once the gesture settles — very light on weak devices.
import { h, frameScheduler, clamp, rad } from "../core/util.js";
import { buildPageDL } from "../engine/dl.js";
import { drawDisplayList, dlHasAdjust, CanvasPool } from "../engine/backends/canvas.js";
import { Viewport } from "../core/viewport.js";
import { pageBoundsOf } from "../core/transform.js";
import { localBounds, worldMatrix } from "../core/nodes.js";
import { apply } from "../core/math.js";
import { checkerConfig, overlayColors, cursorFor } from "../customize/canvas-style.js";

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export class CanvasView {
  constructor(app) {
    this.app = app;
    this.main = h("canvas.cv__main");
    this.overlay = h("canvas.cv__overlay");
    this.stage = h("div.cv__stage", { tabIndex: 0, "aria-label": "Canvas" }, this.main, this.overlay);
    this.hRuler = h("canvas.cv__ruler.cv__ruler--h");
    this.vRuler = h("canvas.cv__ruler.cv__ruler--v");
    this.corner = h("div.cv__corner");
    this.el = h("div.cv", this.corner, this.hRuler, this.vRuler, this.stage);
    this.mctx = this.main.getContext("2d");
    this.octx = this.overlay.getContext("2d");
    this.pool = new CanvasPool();
    this.cpuPool = new CanvasPool({ cpu: true });
    this.rendered = null;
    this.size = { w: 0, h: 0 };
    this.spaceDown = false;
    this.panning = null;
    this.drag = null; // active tool drag
    this.pointers = new Map();
    this.gesture = null;
    this.guideDrag = null;
    this.tempTool = null;
    this.checker = null;
    this.hoverScreen = null;
    this.lastRenderMs = 0;
    this.#schedFull = frameScheduler(() => this.render());
    this.#schedOverlay = frameScheduler(() => this.renderOverlay());
    this.#bind();
    // dragging out of a ruler creates a guide (top ruler → horizontal guide)
    this.hRuler.addEventListener("pointerdown", (e) => e.button === 0 && this.startGuide("h", e));
    this.vRuler.addEventListener("pointerdown", (e) => e.button === 0 && this.startGuide("v", e));
    new ResizeObserver(() => this.resize()).observe(this.stage);
    window.addEventListener("openfini:fonts", () => app.requestRender());
  }

  #schedFull;
  #schedOverlay;
  #fullTimer = 0;

  // ------------------------------------------------------------------ wiring

  #bind() {
    const app = this.app;
    app.on("render", () => this.invalidate());
    app.on("overlay", () => this.invalidateOverlay());
    app.on("selection", () => this.invalidateOverlay());
    app.on("tool", () => {
      this.updateCursor();
      this.invalidateOverlay();
    });
    app.on("doc", () => {
      this.invalidate();
      this.updateCursor();
    });
    app.on("prefs", () => this.resize(true));
    app.on("view", () => this.afterViewChange(true));

    const s = this.stage;
    s.addEventListener("pointerdown", (e) => this.#down(e));
    s.addEventListener("pointermove", (e) => this.#move(e));
    s.addEventListener("pointerup", (e) => this.#up(e));
    s.addEventListener("pointercancel", (e) => this.#up(e));
    s.addEventListener("pointerleave", () => {
      this.hoverScreen = null;
      this.invalidateOverlay();
    });
    s.addEventListener("wheel", (e) => this.#wheel(e), { passive: false });
    s.addEventListener("dblclick", (e) => this.#dbl(e));
    s.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.app.emit("contextmenu", { x: e.clientX, y: e.clientY, event: this.makeEvent(e) });
    });
    s.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    s.addEventListener("drop", (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) {
        const ev = this.makeEvent(e);
        app.emit("dropfiles", { files, x: ev.x, y: ev.y });
      }
    });
    // hold space to pan, even when a tool is active
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.repeat && !this.#typing(e)) {
        this.spaceDown = true;
        this.updateCursor();
        if (document.activeElement === this.stage || document.activeElement === document.body) e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.spaceDown = false;
        this.updateCursor();
      }
    });
  }

  #typing(e) {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.tagName === "SL-INPUT" || t.tagName === "SL-SELECT");
  }

  // ------------------------------------------------------------------ sizing

  resize(force = false) {
    const r = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, this.app.perf.dprCap);
    if (!force && w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
    this.size = { w, h, dpr };
    for (const c of [this.main, this.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const st = this.app.state;
    if (st) {
      st.view.resize(w, h, dpr);
      if (!st.fitted) this.fitAll(false);
    }
    this.invalidate();
  }

  fitAll(redraw = true) {
    const app = this.app;
    const st = app.state;
    if (!st || this.size.w < 10) return;
    st.view.resize(this.size.w, this.size.h, this.size.dpr);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of this.shownPages()) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w);
      y1 = Math.max(y1, p.y + p.h);
    }
    st.view.fit({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 64, 1);
    st.fitted = true;
    app.emit("view");
    if (redraw) this.invalidate();
  }

  /** Makes the view model match the current stage size (it can lag behind before the first render). */
  #sync() {
    const r = this.stage.getBoundingClientRect();
    if (r.width > 10 && (Math.round(r.width) !== this.size.w || Math.round(r.height) !== this.size.h)) this.resize(true);
    const st = this.app.state;
    if (st && this.size.w > 10) st.view.resize(this.size.w, this.size.h, this.size.dpr);
  }

  fitPage(page = this.app.page) {
    const st = this.app.state;
    if (!st || !page) return;
    this.#sync();
    st.view.fit({ x: page.x, y: page.y, w: page.w, h: page.h }, 56, 1);
    this.app.emit("view");
  }

  fitSelection() {
    const st = this.app.state;
    const sel = this.app.selection;
    this.#sync();
    if (!st || !sel.length) return this.fitPage();
    const b = pageBoundsOf(sel);
    const p = this.app.page;
    st.view.fit({ x: b.x + p.x, y: b.y + p.y, w: b.w, h: b.h }, 96, 16);
    this.app.emit("view");
  }

  setZoom(z, anchor) {
    const st = this.app.state;
    if (!st) return;
    this.#sync();
    const v = st.view;
    v.zoomAt(anchor?.[0] ?? v.w / 2, anchor?.[1] ?? v.h / 2, z);
    this.app.emit("view");
  }

  // ------------------------------------------------------------------ rendering scheduling

  invalidate() {
    this.#schedFull();
  }
  invalidateOverlay() {
    this.#schedOverlay();
  }

  afterViewChange(immediate = false) {
    this.applyPreview();
    clearTimeout(this.#fullTimer);
    this.#fullTimer = setTimeout(() => this.render(), immediate ? 0 : this.lastRenderMs > 40 ? 140 : 70);
  }

  applyPreview() {
    const r = this.rendered;
    const v = this.app.view;
    if (!r || !v) return;
    const k = v.zoom / r.zoom;
    const tx = v.panX - r.panX * k;
    const ty = v.panY - r.panY * k;
    const t = Math.abs(k - 1) < 1e-6 && Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 ? "" : `matrix(${k},0,0,${k},${tx},${ty})`;
    this.main.style.transform = this.overlay.style.transform = t;
  }

  /** Pages on the pasteboard — or just the master page while one is being edited. */
  shownPages() {
    const st = this.app.state;
    const doc = this.app.doc;
    if (st && doc.masters.includes(st.page)) return [st.page];
    return doc.pages;
  }

  // ------------------------------------------------------------------ main render

  render() {
    const t0 = performance.now();
    const app = this.app;
    const st = app.state;
    const { w, h, dpr } = this.size;
    if (!w) return;
    const ctx = this.mctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = css("--of-bg-canvas", "#141518");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.main.width, this.main.height);
    if (!st) {
      this.rendered = null;
      this.main.style.transform = this.overlay.style.transform = "";
      this.drawRulers();
      return;
    }
    const view = st.view;
    view.resize(w, h, dpr);
    const doc = app.doc;
    const z = view.zoom;
    const clipContent = app.prefs.clipContent ?? doc.studio !== "vector";
    // low-power devices skip live layer effects (blur, shadows, ...) while a drag is in progress
    const draft = !app.perf.fxDuringDrag && !!(this.drag || this.panning);
    const vis = view.visibleRect();
    for (const page of this.shownPages()) {
      if (page.x > vis.x + vis.w || page.x + page.w < vis.x || page.y > vis.y + vis.h || page.y + page.h < vis.y) continue;
      const px = (page.x * z + view.panX) * dpr;
      const py = (page.y * z + view.panY) * dpr;
      const pw = page.w * z * dpr;
      const ph = page.h * z * dpr;
      // paper
      ctx.save();
      if (app.perf.shadows && z > 0.05) {
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 22 * dpr;
        ctx.shadowOffsetY = 4 * dpr;
      }
      ctx.fillStyle = page.bg || "#ffffff";
      ctx.fillRect(px, py, pw, ph);
      ctx.restore();
      if (!page.bg) this.#checker(ctx, px, py, pw, ph, dpr);
      // content
      const dl = buildPageDL(doc, page);
      const base = [z * dpr, 0, 0, z * dpr, px, py];
      const full = { x: 0, y: 0, w: this.main.width, h: this.main.height };
      const adjust = dlHasAdjust(dl.items);
      if (adjust) {
        const rx = Math.max(0, Math.floor(px));
        const ry = Math.max(0, Math.floor(py));
        const rr = Math.min(this.main.width, Math.ceil(px + pw));
        const rb = Math.min(this.main.height, Math.ceil(py + ph));
        const rw = rr - rx;
        const rh = rb - ry;
        if (rw > 0 && rh > 0) {
          const c = this.cpuPool.get(rw, rh);
          const cctx = this.cpuPool.ctx(c);
          drawDisplayList(cctx, dl, { base: [base[0], 0, 0, base[3], px - rx, py - ry], region: { x: 0, y: 0, w: rw, h: rh }, pool: this.cpuPool, draft, fastAdjust: !!this.drag });
          ctx.drawImage(c, 0, 0, rw, rh, rx, ry, rw, rh);
          this.cpuPool.release(c);
        }
      } else if (clipContent) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, pw, ph);
        ctx.clip();
        drawDisplayList(ctx, dl, { base, region: full, pool: this.pool, draft });
        ctx.restore();
      } else {
        drawDisplayList(ctx, dl, { base, region: full, pool: this.pool, draft });
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    this.rendered = { zoom: view.zoom, panX: view.panX, panY: view.panY };
    this.main.style.transform = this.overlay.style.transform = "";
    this.drawRulers();
    this.renderOverlay();
    this.lastRenderMs = performance.now() - t0;
    app.emit("rendered", this.lastRenderMs);
  }

  #checker(ctx, x, y, w, h, dpr) {
    const cfg = checkerConfig(this.app.prefs); // colors and square size are customizable (customize/canvas-style.js)
    if (!cfg) return; // "solid": a plain white page
    const key = `${cfg.a}|${cfg.b}|${cfg.size}|${dpr}`;
    if (!this.checker || this.checkerKey !== key) {
      const sq = Math.max(1, Math.round(cfg.size * dpr));
      const c = document.createElement("canvas");
      c.width = c.height = sq * 2;
      const k = c.getContext("2d");
      k.fillStyle = cfg.a;
      k.fillRect(0, 0, sq * 2, sq * 2);
      k.fillStyle = cfg.b;
      k.fillRect(0, 0, sq, sq);
      k.fillRect(sq, sq, sq, sq);
      this.checker = ctx.createPattern(c, "repeat");
      this.checkerKey = key;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.checker;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // ------------------------------------------------------------------ overlay

  renderOverlay() {
    const app = this.app;
    const st = app.state;
    const { w, h, dpr } = this.size;
    if (!w) return;
    const ctx = this.octx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!st) return;
    const view = st.view;
    this.#drawGrid(ctx, view);
    this.#drawPageGuides(ctx, view);
    // marching ants for the pixel selection, slices, ...
    app.emit("overlay-pixel", ctx);
    app.emit("overlay-extra", ctx);
    // generic selection outlines (the Move tool adds handles on top)
    // selection outlines: a light halo under the accent line keeps them visible on any fill color
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    for (const n of app.selection) this.#outlineNode(ctx, n);
    ctx.lineWidth = 1;
    ctx.strokeStyle = overlayColors(app.prefs, css("--of-accent-strong", "#7a69f2")).selection;
    for (const n of app.selection) this.#outlineNode(ctx, n);
    ctx.restore();
    app.tool?.overlay(ctx, view);
    if (this.guideDrag) this.#drawGuidePreview(ctx, view);
  }

  #outlineNode(ctx, n) {
    const page = n._page;
    const b = localBounds(n);
    if (!page || !b) return;
    const W = worldMatrix(n);
    const view = this.app.view;
    ctx.beginPath();
    [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach(([x, y], i) => {
      const [px, py] = apply(W, x, y);
      const [sx, sy] = view.toScreen(px + page.x, py + page.y);
      if (i) ctx.lineTo(Math.round(sx) + 0.5, Math.round(sy) + 0.5);
      else ctx.moveTo(Math.round(sx) + 0.5, Math.round(sy) + 0.5);
    });
    ctx.closePath();
    ctx.stroke();
    // text frame overflow marker (red square at the bottom-right corner)
    if (n.type === "text" && n._overflow && n.w != null) {
      const [ox, oy] = apply(W, b.x + b.w, b.y + b.h);
      const [sx, sy] = view.toScreen(ox + page.x, oy + page.y);
      ctx.save();
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(Math.round(sx) - 9, Math.round(sy) - 9, 12, 12);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.fillText("+", Math.round(sx) - 6, Math.round(sy) + 1);
      ctx.restore();
    }
  }

  #drawGrid(ctx, view) {
    const oc = overlayColors(this.app.prefs);
    const doc = this.app.doc;
    const g = doc.settings.grid;
    if (!g?.visible) return;
    const page = this.app.page;
    const step = g.size * view.zoom;
    if (step < 4) return;
    const sub = g.subdivisions || 1;
    ctx.save();
    const [ox, oy] = view.toScreen(page.x, page.y);
    const x1 = ox + page.w * view.zoom;
    const y1 = oy + page.h * view.zoom;
    ctx.beginPath();
    ctx.rect(Math.max(0, ox), Math.max(0, oy), Math.min(this.size.w, x1) - Math.max(0, ox), Math.min(this.size.h, y1) - Math.max(0, oy));
    ctx.clip();
    for (let i = 0; i <= (sub > 1 ? 1 : 0); i++) {
      const s = i === 0 ? step : step / sub;
      if (s < 5) continue;
      ctx.strokeStyle = i === 0 ? oc.gridMajor : oc.gridMinor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ox; x <= x1; x += s) {
        const px = Math.round(x) + 0.5;
        ctx.moveTo(px, oy);
        ctx.lineTo(px, y1);
      }
      for (let y = oy; y <= y1; y += s) {
        const py = Math.round(y) + 0.5;
        ctx.moveTo(ox, py);
        ctx.lineTo(x1, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawPageGuides(ctx, view) {
    const app = this.app;
    const doc = app.doc;
    const showGuides = doc.settings.guidesVisible !== false;
    const { w, h } = this.size;
    ctx.save();
    ctx.lineWidth = 1;
    for (const page of this.shownPages()) {
      const [ox, oy] = view.toScreen(page.x, page.y);
      const pw = page.w * view.zoom;
      const ph = page.h * view.zoom;
      if (ox > w || oy > h || ox + pw < 0 || oy + ph < 0) continue;
      const m = page.margins;
      const hasMargins = m && (m.left || m.right || m.top || m.bottom);
      if (hasMargins && app.studio === "layout") {
        ctx.strokeStyle = "rgba(236,72,153,0.75)";
        ctx.strokeRect(Math.round(ox + m.left * view.zoom) + 0.5, Math.round(oy + m.top * view.zoom) + 0.5, Math.round(pw - (m.left + m.right) * view.zoom), Math.round(ph - (m.top + m.bottom) * view.zoom));
        if (page.columns > 1) {
          ctx.strokeStyle = "rgba(96,165,250,0.7)";
          const inner = page.w - m.left - m.right;
          const colW = (inner - page.gutter * (page.columns - 1)) / page.columns;
          ctx.beginPath();
          for (let i = 0; i < page.columns; i++) {
            const x0 = ox + (m.left + i * (colW + page.gutter)) * view.zoom;
            const x1 = x0 + colW * view.zoom;
            for (const x of [x0, x1]) {
              ctx.moveTo(Math.round(x) + 0.5, oy + m.top * view.zoom);
              ctx.lineTo(Math.round(x) + 0.5, oy + ph - m.bottom * view.zoom);
            }
          }
          ctx.stroke();
        }
      }
      if (page.bleed > 0) {
        ctx.strokeStyle = "rgba(239,68,68,0.8)";
        const b = page.bleed * view.zoom;
        ctx.strokeRect(Math.round(ox - b) + 0.5, Math.round(oy - b) + 0.5, Math.round(pw + 2 * b), Math.round(ph + 2 * b));
      }
      // page border + name
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(pw), Math.round(ph));
      if (doc.pages.length > 1) {
        ctx.fillStyle = css("--of-text-dim", "#a3a5ae");
        ctx.font = "11px Inter, system-ui, sans-serif";
        ctx.fillText(page.name, Math.round(ox), Math.round(oy) - 6);
      }
      if (showGuides) {
        ctx.strokeStyle = overlayColors(this.app.prefs).guide;
        ctx.beginPath();
        for (const gx of page.guides.v) {
          const x = Math.round(ox + gx * view.zoom) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        for (const gy of page.guides.h) {
          const y = Math.round(oy + gy * view.zoom) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  #drawGuidePreview(ctx, view) {
    const g = this.guideDrag;
    ctx.save();
    ctx.strokeStyle = overlayColors(this.app.prefs).guidePreview;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const page = this.app.page;
    if (g.axis === "v") {
      const x = Math.round(view.toScreen(page.x + g.pos, 0)[0]) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.size.h);
    } else {
      const y = Math.round(view.toScreen(0, page.y + g.pos)[1]) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(this.size.w, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ rulers

  drawRulers() {
    const app = this.app;
    const show = app.prefs.rulers && app.state;
    this.el.classList.toggle("no-rulers", !show);
    if (!show) return;
    const st = app.state;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const hr = this.hRuler;
    const vr = this.vRuler;
    const hw = hr.clientWidth;
    const hh = hr.clientHeight;
    const vw = vr.clientWidth;
    const vh = vr.clientHeight;
    if (!hw || !vh) return;
    for (const [c, w, hgt] of [[hr, hw, hh], [vr, vw, vh]]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(hgt * dpr);
      }
    }
    const view = st.view;
    const page = app.page;
    const bg = css("--of-bg-bar", "#25262b");
    const fg = css("--of-text-faint", "#8a8c96");
    const line = css("--of-border", "#3a3b43");
    const accent = css("--of-accent", "#8b7cf6");
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const major = steps.find((s) => s * view.zoom >= 64) || steps[steps.length - 1];
    const subdiv = major >= 10 && major * view.zoom >= 80 ? 10 : 5;
    const draw = (ctx, len, thick, horizontal) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, horizontal ? len : thick, horizontal ? thick : len);
      ctx.strokeStyle = line;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(0, thick - 0.5);
        ctx.lineTo(len, thick - 0.5);
      } else {
        ctx.moveTo(thick - 0.5, 0);
        ctx.lineTo(thick - 0.5, len);
      }
      ctx.stroke();
      const origin = horizontal ? view.panX + page.x * view.zoom : view.panY + page.y * view.zoom;
      const startV = Math.floor((0 - origin) / view.zoom / major) * major - major;
      const endV = Math.ceil((len - origin) / view.zoom / major) * major + major;
      ctx.fillStyle = fg;
      ctx.strokeStyle = fg;
      ctx.font = "9px Inter, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.beginPath();
      for (let v = startV; v <= endV; v += major / subdiv) {
        const p = Math.round(origin + v * view.zoom) + 0.5;
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const l = isMajor ? thick : v % (major / 2) === 0 ? thick * 0.5 : thick * 0.28;
        if (horizontal) {
          ctx.moveTo(p, thick - l);
          ctx.lineTo(p, thick);
        } else {
          ctx.moveTo(thick - l, p);
          ctx.lineTo(thick, p);
        }
        if (isMajor) {
          const label = String(Math.round(v * 100) / 100);
          if (horizontal) ctx.fillText(label, p + 3, 2);
          else {
            ctx.save();
            ctx.translate(2, p + 3);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = "right";
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();
      // selection extent
      const sel = app.selection;
      if (sel.length) {
        const b = pageBoundsOf(sel);
        if (b) {
          const a = origin + (horizontal ? b.x : b.y) * view.zoom;
          const e = origin + (horizontal ? b.x + b.w : b.y + b.h) * view.zoom;
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.25;
          if (horizontal) ctx.fillRect(a, 0, e - a, thick);
          else ctx.fillRect(0, a, thick, e - a);
          ctx.globalAlpha = 1;
        }
      }
    };
    draw(hr.getContext("2d"), hw, hh, true);
    draw(vr.getContext("2d"), vh, vw, false);
  }

  // ------------------------------------------------------------------ input

  /** Builds the event object handed to tools. */
  makeEvent(ev) {
    const app = this.app;
    const r = this.stage.getBoundingClientRect();
    const sx = ev.clientX - r.left;
    const sy = ev.clientY - r.top;
    const st = app.state;
    let page = app.page;
    let x = 0;
    let y = 0;
    if (st) {
      const [dx, dy] = st.view.toDoc(sx, sy);
      const hit = this.shownPages().find((p) => dx >= p.x && dy >= p.y && dx <= p.x + p.w && dy <= p.y + p.h);
      page = hit || app.page;
      x = dx - page.x;
      y = dy - page.y;
    }
    const mouse = ev.pointerType === "mouse";
    return {
      x, y, sx, sy, page,
      pressure: mouse ? (ev.buttons ? 1 : 0) || 1 : ev.pressure || 0.5,
      tiltX: ev.tiltX || 0,
      tiltY: ev.tiltY || 0,
      pointerType: ev.pointerType || "mouse",
      shift: ev.shiftKey,
      alt: ev.altKey,
      ctrl: ev.ctrlKey || ev.metaKey,
      button: ev.button,
      buttons: ev.buttons,
      detail: ev.detail,
      timeStamp: ev.timeStamp,
      raw: ev,
    };
  }

  updateCursor() {
    const t = this.tempTool || this.app.tool;
    let c = t?.cursor || "default";
    if (this.panning) c = "grabbing";
    else if (this.spaceDown) c = "grab";
    this.stage.style.cursor = cursorFor(c, this.app.prefs.cursorSize);
  }

  setCursor(c) {
    this.stage.style.cursor = cursorFor(c, this.app.prefs.cursorSize);
  }

  #capture(id) {
    try {
      this.stage.setPointerCapture(id);
    } catch {
      /* synthetic or already-ended pointer: events still arrive through the stage */
    }
  }

  #release(id) {
    try {
      this.stage.releasePointerCapture(id);
    } catch {
      /* not captured */
    }
  }
  #down(ev) {
    const app = this.app;
    if (!app.state) return;
    this.stage.focus({ preventScroll: true });
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ev.pointerType === "touch" && this.pointers.size === 2) {
      this.#startGesture();
      return;
    }
    const wantsPan = ev.button === 1 || (ev.button === 0 && this.spaceDown) || (ev.button === 0 && app.tool?.id === "hand");
    if (wantsPan) {
      this.panning = { x: ev.clientX, y: ev.clientY };
      this.#capture(ev.pointerId);
      this.updateCursor();
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0 && ev.button !== 2 && ev.pointerType === "mouse") return;
    if (ev.button === 2) return;
    // guides: grab an existing guide line with the Move tool
    const e = this.makeEvent(ev);
    const guide = this.#hitGuide(e);
    if (guide && (app.tool?.id === "move" || app.tool?.id === "node")) {
      this.guideDrag = { ...guide, pointer: ev.pointerId };
      this.#capture(ev.pointerId);
      return;
    }
    if (e.page !== app.page) app.setActivePage(e.page);
    const tool = this.#toolFor(ev);
    this.drag = { pointer: ev.pointerId, tool };
    this.#capture(ev.pointerId);
    tool.pointerDown(this.makeEvent(ev));
  }

  #toolFor(ev) {
    const app = this.app;
    // Alt+click temporarily samples colors with the eyedropper in paint tools
    if (ev.altKey && ["brush", "fill", "pencil", "gradient"].includes(app.tool?.id) && app.tools.get("eyedropper")) return app.tools.get("eyedropper");
    return app.tool;
  }

  #move(ev) {
    const app = this.app;
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.gesture) return this.#moveGesture();
    if (this.panning) {
      const v = app.view;
      v.panBy(ev.clientX - this.panning.x, ev.clientY - this.panning.y);
      this.panning.x = ev.clientX;
      this.panning.y = ev.clientY;
      app.emit("view");
      return;
    }
    if (this.guideDrag) return this.#moveGuide(ev);
    const e = this.makeEvent(ev);
    this.hoverScreen = [e.sx, e.sy];
    app.emit("pointer", e);
    if (this.drag) {
      this.drag.tool.pointerMove(e);
    } else if (app.tool) {
      app.tool.hover(e);
      const g = this.#hitGuide(e);
      if (g && (app.tool.id === "move" || app.tool.id === "node")) this.setCursor(g.axis === "v" ? "col-resize" : "row-resize");
    }
  }

  #up(ev) {
    this.pointers.delete(ev.pointerId);
    if (this.gesture) {
      if (this.pointers.size < 2) this.gesture = null;
      return;
    }
    if (this.panning) {
      this.panning = null;
      this.updateCursor();
      this.#release(ev.pointerId);
      return;
    }
    if (this.guideDrag) return this.#endGuide(ev);
    if (this.drag && this.drag.pointer === ev.pointerId) {
      const tool = this.drag.tool;
      this.drag = null;
      this.#release(ev.pointerId);
      tool.pointerUp(this.makeEvent(ev));
      this.app.requestRender(); // full-quality frame after the drag
    }
  }

  #dbl(ev) {
    if (!this.app.state) return;
    this.app.tool?.doubleClick(this.makeEvent(ev));
  }

  #wheel(ev) {
    const app = this.app;
    if (!app.state) return;
    ev.preventDefault();
    const v = app.view;
    const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const r = this.stage.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) {
      const f = Math.exp(clamp(-ev.deltaY * scale * (ev.ctrlKey && !ev.metaKey && Math.abs(ev.deltaY) < 30 ? 0.012 : 0.0035), -0.5, 0.5));
      v.zoomAt(ev.clientX - r.left, ev.clientY - r.top, v.zoom * f);
    } else if (app.prefs.wheelZoom) {
      v.zoomAt(ev.clientX - r.left, ev.clientY - r.top, v.zoom * Math.exp(clamp(-ev.deltaY * scale * 0.0025, -0.5, 0.5)));
    } else {
      let dx = -ev.deltaX * scale;
      let dy = -ev.deltaY * scale;
      if (ev.shiftKey && !dx) [dx, dy] = [dy, 0];
      v.panBy(dx, dy);
    }
    app.emit("view");
  }

  // ------------------------------------------------------------------ touch gestures

  #startGesture() {
    const pts = [...this.pointers.values()];
    this.drag?.tool.cancel?.();
    this.drag = null;
    const v = this.app.view;
    this.gesture = {
      d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
      zoom: v.zoom,
    };
  }

  #moveGesture() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const g = this.gesture;
    const v = this.app.view;
    const r = this.stage.getBoundingClientRect();
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;
    v.panBy(cx - g.cx, cy - g.cy);
    v.zoomAt(cx - r.left, cy - r.top, g.zoom * (d / (g.d || 1)));
    g.cx = cx;
    g.cy = cy;
    this.app.emit("view");
  }

  // ------------------------------------------------------------------ guides

  #hitGuide(e) {
    const app = this.app;
    const doc = app.doc;
    if (!doc || doc.settings.guidesVisible === false) return null;
    const page = e.page;
    const tol = 4 / app.view.zoom;
    for (const g of page.guides.v) if (Math.abs(e.x - g) <= tol) return { axis: "v", pos: g, existing: g, page };
    for (const g of page.guides.h) if (Math.abs(e.y - g) <= tol) return { axis: "h", pos: g, existing: g, page };
    return null;
  }

  /** Starts dragging a new guide out of a ruler. */
  startGuide(axis, ev) {
    const app = this.app;
    if (!app.state) return;
    this.guideDrag = { axis, pos: 0, existing: null, page: app.page, pointer: ev.pointerId };
    this.#capture(ev.pointerId);
    this.#moveGuide(ev);
  }

  #moveGuide(ev) {
    const e = this.makeEvent(ev);
    const g = this.guideDrag;
    g.pos = Math.round((g.axis === "v" ? e.x : e.y) * 100) / 100;
    if (this.app.doc.settings.snap) g.pos = Math.round(g.pos);
    this.invalidateOverlay();
  }

  #endGuide(ev) {
    const g = this.guideDrag;
    this.guideDrag = null;
    const doc = this.app.doc;
    const page = g.page;
    const r = this.stage.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientY >= r.top && ev.clientX <= r.right && ev.clientY <= r.bottom;
    const key = g.axis;
    const list = page.guides[key].slice();
    if (g.existing !== null) {
      const i = list.indexOf(g.existing);
      if (i >= 0) list.splice(i, 1);
    }
    if (inside) list.push(g.pos);
    doc.set(page, { guides: { ...page.guides, [key]: list } }, "Guide");
    this.invalidateOverlay();
  }
}

export { rad, Viewport };
