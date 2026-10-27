// The live preview of the Code studio: a sandboxed iframe (scripts allowed, never same-origin) that shows the
// page being edited at the selected breakpoint width. It is double-buffered — a rebuilt document is swapped in
// only once it reports "ready" — so typing in the editor never flashes. CSS-only edits are patched in place.
import { Emitter, h } from "../../core/util.js";
import { buildPreview, hotCss, BREAKPOINTS, breakpointForWidth, breakpointMarkers, clampSize, snapWidth, sanitizeBox, sanitizeLayoutMetrics, describeLayout, UNITS } from "../../engine/web/index.js";
import { createViewportBar, createRulers, attachHandles } from "./viewport-ui.js";
import { t } from "../../i18n/index.js";
import { bridgeSource } from "./bridge.js";
import { scriptsBlocked } from "../../core/security.js";
import { withOfflinePreviewCsp } from "../../core/network.js";
import { protectedBanner } from "../protected-banner.js";

const dataUrlCache = new WeakMap();

export function toDataUrl(path, bytes, mime) {
  let url = dataUrlCache.get(bytes);
  if (url) return url;
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  url = `data:${mime || "application/octet-stream"};base64,${btoa(bin)}`;
  dataUrlCache.set(bytes, url);
  return url;
}

// Scripts are delivered as data: URLs: srcdoc documents inherit the app's Content-Security-Policy, which forbids
// inline scripts (and blob: scripts cannot be loaded by a sandboxed document).
const scriptUrl = (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;

export class PreviewPane extends Emitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.web = ws.web;
    this.app = ws.app;
    this.page = this.web.settings.page && this.web.has(this.web.settings.page) ? this.web.settings.page : this.web.entry;
    // viewport: width/height in CSS px (height null = fill the available space); the breakpoint always follows the width
    const vp = this.web.settings.viewport;
    const bp0 = BREAKPOINTS.find((b) => b.id === this.web.settings.breakpoint) || BREAKPOINTS[0];
    this.vw = clampSize(vp?.w ?? bp0.width, "w");
    this.vh = vp?.h ? clampSize(vp.h, "h") : null;
    this.lockAspect = !!vp?.lock;
    this.aspect = this.vh ? this.vh / this.vw : 0.625;
    this.vhEff = this.vh || 800; // the height the frame has right now
    this.bp = breakpointForWidth(this.vw);
    this.dragging = null; // { scale } while a handle or the slider is being dragged: the zoom stays put
    this.altHeld = false;
    this.zoomSetting = this.web.settings.zoom ?? "fit";
    this.rulersOn = this.web.settings.rulers !== false;
    this.showScrollbar = this.web.settings.scrollbar === true; // hidden by default so viewport width = layout width
    this.metrics = null; // last { iw, cw, ... } reported by the frame (see describeLayout)
    this.measure = { on: false, unit: UNITS.includes(this.app.prefs.codeMeasureUnit) ? this.app.prefs.codeMeasureUnit : "px", ppi: this.app.prefs.codeMeasurePpi > 0 ? this.app.prefs.codeMeasurePpi : 96, dprAware: !!this.app.prefs.codeMeasureDpr, details: false, box: null, pins: 0 };
    this.markerCache = { rev: -1, list: [] };
    this.edit = true;
    this.scale = 1;
    this.current = null; // { frame, last }
    this.pending = null;
    this.scroll = { x: 0, y: 0 };
    this.selectedId = null;
    this.reqs = new Map();
    this.reqSeq = 1;
    this.dirtyFiles = new Set();
    this.last = null; // PreviewResult of the document on screen
    this.timer = 0;
    this.label = h("div.of-prev__label");
    this.device = h("div.of-prev__device");
    this.dwrap = h("div.of-prev__dwrap", this.device);
    this.stage = h("div.of-prev__stage", this.dwrap);
    this.empty = h("div.of-prev__empty.hidden", h("sl-icon", { name: "window" }), h("p", "This project has no pages yet."), h("p.of-hint", "Create an HTML file in the Explorer."));
    this.rulers = createRulers(this);
    this.bar = createViewportBar(this);
    this.body = h("div.of-prev__body", this.rulers.corner, this.rulers.h, this.rulers.v, this.stage);
    this.body.classList.toggle("no-rulers", !this.rulersOn);
    this.el = h("div.of-prev", this.bar.el, this.body, this.empty);
    this.el.prepend(protectedBanner(this)); // protected mode: "Enable scripts"
    attachHandles(this, this.dwrap);
    this.stage.addEventListener("scroll", () => this.rulers.draw(), { passive: true });
    this.altKeys = (e) => {
      if (e.key === "Alt") this.altHeld = e.type === "keydown";
    };
    window.addEventListener("keydown", this.altKeys);
    window.addEventListener("keyup", this.altKeys);
    this.onBlur = () => (this.altHeld = false);
    window.addEventListener("blur", this.onBlur);

    this.onMessage = (e) => this.#message(e);
    window.addEventListener("message", this.onMessage);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.stage);

    this.web.on("text", ({ path, origin }) => {
      this.dirtyFiles.add(path);
      this.#scheduleBuild(origin === "visual" ? 30 : 220);
    });
    this.web.on("tree", () => {
      if (!this.web.has(this.page)) this.page = this.web.entry;
      this.dirtyFiles.add("*");
      this.#scheduleBuild(80);
    });
  }

  // ------------------------------------------------------------ geometry

  get width() {
    return this.vw;
  }

  /** The viewport as the page sees it: { width, height, heightAuto, scale, breakpoint }. */
  viewport() {
    return { width: this.vw, height: this.vh || this.vhEff, heightAuto: !this.vh, scale: this.scale, breakpoint: { id: this.bp.id, label: this.bp.label, media: this.bp.media } };
  }

  /** Widths where the layout changes (editor breakpoints + @media conditions of the project's CSS), cached per revision. */
  markers() {
    if (this.markerCache.rev !== this.web.rev) {
      const css = this.web.paths.filter((p) => /\.css$/i.test(p)).map((p) => this.web.text(p) || "");
      this.markerCache = { rev: this.web.rev, list: breakpointMarkers(css) };
    }
    return this.markerCache.list;
  }

  /** Re-computes the device box for the current viewport, zoom and available space. */
  layout() {
    const sr = this.stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const pad = 28;
    const availW = Math.max(120, sr.width - pad * 2);
    const availH = Math.max(120, sr.height - pad - 8);
    const w = this.vw;
    let scale;
    if (this.dragging) scale = this.dragging.scale;
    else if (this.zoomSetting === "fit") scale = Math.min(1, availW / w, this.vh ? availH / this.vh : Infinity);
    else scale = Math.max(0.1, Math.min(4, Number(this.zoomSetting) || 1));
    this.scale = scale;
    const hPx = this.vh || Math.floor(availH / scale);
    this.vhEff = hPx;
    // exact (unrounded) box so that the frame and its box never disagree by a pixel; at 100% both are integers anyway
    const dw = w * scale;
    const dh = hPx * scale;
    // the device is centered with an integer offset
    this.dwrap.style.width = `${dw}px`;
    this.dwrap.style.height = `${dh}px`;
    this.dwrap.style.marginLeft = `${Math.max(0, Math.floor((sr.width - pad * 2 - dw) / 2))}px`;
    for (const f of this.#frames()) {
      f.style.width = `${w}px`;
      f.style.height = `${hPx}px`;
      f.style.transform = `scale(${scale})`;
    }
    this.updateLabel();
    // the frame also reports on its own resize events; asking after our own layout keeps the readout exact even when the
    // browser throttles resize events of a background page
    clearTimeout(this.metricsTimer);
    this.metricsTimer = setTimeout(() => this.#post({ type: "metrics" }), 60);
    this.emit("layout", { scale, width: w, height: hPx });
    this.bar.sync();
    this.rulers.draw();
  }

  /** Status text: "Phone · 50% · 390 × 844 · layout 390"; a failed self-check is flagged and explained in the tooltip. */
  updateLabel() {
    const lay = describeLayout(this.vw, this.vh || this.vhEff, this.metrics);
    this.layoutInfo = lay;
    const zoom = this.scale !== 1 ? ` · ${Math.round(this.scale * 100)}%` : "";
    this.label.textContent = `${this.bp.label}${zoom} · ${lay.text}${lay.consistent ? "" : " ⚠"}`;
    this.label.title = lay.consistent
      ? t("CSS pixels, independent of the zoom. Layout width is what 100%-wide boxes and media queries see.")
      : t("The preview frame reports different sizes than configured (self-check failed): {issues}", { issues: lay.issues.join(", ") });
  }

  /** Shows or hides the classic root scrollbar in the frame (hidden = the layout width equals the viewport width). */
  setScrollbar(on) {
    this.showScrollbar = !!on;
    this.web.settings.scrollbar = this.showScrollbar;
    this.#post({ type: "viewportOpts", scrollbar: this.showScrollbar });
    this.emit("viewport", this.viewport());
    this.bar.sync();
  }

  /**
   * Sets the viewport size in CSS px. `h` null = fill the available height; `undefined` keeps it. The matching breakpoint
   * follows the width (so the style panel edits the right @media block).
   */
  setSize(w, h) {
    this.vw = clampSize(w ?? this.vw, "w");
    if (h !== undefined) this.vh = h === null ? null : clampSize(h, "h");
    this.#syncViewport();
  }
  /** User resize (handles, slider, fields): applies the aspect lock, snaps the width to breakpoint markers unless Alt is held. */
  resizeTo({ w, h }, { from = "w", snap = true } = {}) {
    let nw = w ?? this.vw;
    let nh = h;
    if (snap && w != null && !this.altHeld) nw = snapWidth(nw, this.markers(), 6).width;
    if (this.lockAspect && this.aspect > 0) {
      if (from === "h" && nh != null) nw = Math.round(nh / this.aspect);
      else if (nh !== null) nh = Math.round(nw * this.aspect);
    }
    this.setSize(nw, nh);
  }
  setLockAspect(on) {
    this.lockAspect = !!on;
    if (this.lockAspect) this.aspect = this.vhEff / this.vw;
    this.#persistViewport();
    this.emit("viewport", this.viewport());
  }
  rotate() {
    const h = this.vh || this.vhEff;
    const w = this.vw;
    this.vw = clampSize(h, "w");
    this.vh = clampSize(w, "h");
    if (this.lockAspect) this.aspect = this.vh / this.vw;
    this.#syncViewport();
  }
  #persistViewport() {
    this.web.settings.viewport = { w: this.vw, h: this.vh, lock: this.lockAspect };
    this.web.settings.breakpoint = this.bp.id;
  }
  #syncViewport() {
    const nb = breakpointForWidth(this.vw);
    const changed = nb !== this.bp;
    this.bp = nb;
    if (this.lockAspect && this.vh) this.aspect = this.vh / this.vw;
    this.#persistViewport();
    this.layout();
    this.bar.flashBadge();
    this.emit("viewport", this.viewport());
    if (changed) {
      this.emit("breakpoint", nb);
      this.selectionChanged();
    }
  }
  setRulers(on) {
    this.rulersOn = !!on;
    this.web.settings.rulers = this.rulersOn;
    this.body.classList.toggle("no-rulers", !this.rulersOn);
    this.layout();
    this.emit("viewport", this.viewport());
  }

  #frames() {
    return [this.current?.frame, this.pending?.frame].filter(Boolean);
  }

  setBreakpoint(id) {
    const bp = BREAKPOINTS.find((x) => x.id === id);
    if (!bp) return;
    this.setSize(bp.width, undefined);
  }

  setZoom(z) {
    this.zoomSetting = z === "fit" ? "fit" : Math.max(0.25, Math.min(4, Number(z) || 1));
    this.web.settings.zoom = this.zoomSetting;
    this.layout();
    this.emit("zoom", this.zoomSetting);
  }

  setMode(edit) {
    this.edit = !!edit;
    this.#post({ type: "mode", edit: this.edit });
    this.emit("mode", this.edit);
  }

  // ------------------------------------------------------------ building

  showPage(path) {
    if (!this.web.has(path)) return;
    this.page = path;
    this.web.settings.page = path;
    this.emit("page", path);
    this.rebuild();
  }

  #scheduleBuild(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#flush(), ms);
  }

  #flush() {
    const files = this.dirtyFiles;
    this.dirtyFiles = new Set();
    if (!files.size) return;
    // stylesheet-only edits patch the live document; everything else rebuilds it
    const onlyCss = !files.has("*") && [...files].every((f) => /\.css$/i.test(f) && this.last?.styles.some((s) => s.file === f && !s.inline));
    if (onlyCss && this.current) {
      for (const f of files) {
        try {
          this.#post({ type: "css", file: f, inline: false, text: hotCss(this.web.source, f, { makeAssetUrl: toDataUrl }) });
        } catch {
          return this.rebuild();
        }
      }
      this.liveClear();
      setTimeout(() => this.emit("hot"), 40);
      return;
    }
    // changes to files the page does not use (another page, unused CSS) do not need a rebuild
    const relevant = files.has("*") || [...files].some((f) => f === this.page || !/\.html?$/i.test(f));
    if (relevant) this.rebuild();
  }

  rebuild() {
    if (!this.web.has(this.page) || !/\.html?$/i.test(this.page)) this.page = this.web.pages()[0] || null; // Markdown or LaTeX documents have no canvas page
    const empty = !this.page;
    this.empty.classList.toggle("hidden", !empty);
    this.device.classList.toggle("hidden", empty);
    this.dwrap.classList.toggle("hidden", empty);
    if (empty) return;
    let res;
    try {
      res = buildPreview(this.web.source, this.page, {
        bridge: bridgeSource,
        config: { mode: this.edit ? "edit" : "preview", accent: "#4f8cff", spacing: true, scrollbar: this.showScrollbar },
        // with "Run JavaScript in the preview" off, only the inspector runs: page scripts become empty
        makeScriptUrl: (code, info) => scriptUrl(scriptsBlocked(this.app.prefs, this.ws.doc) && info?.file !== "openfini-bridge.js" ? "" : code),
        makeAssetUrl: toDataUrl,
        annotate: true,
      });
    } catch (err) {
      console.error(err);
      this.app.toast(`Preview failed: ${err.message}`, "danger", 5000);
      return;
    }
    this.last = res;
    this.emit("built", res);
    // a stale pending frame is dropped
    this.pending?.frame.remove();
    const frame = h("iframe.of-prev__frame", {
      sandbox: "allow-scripts allow-forms allow-modals allow-popups allow-downloads",
      title: "Website preview",
      referrerpolicy: "no-referrer",
    });
    frame.style.visibility = "hidden";
    this.pending = { frame, started: performance.now() };
    this.device.append(frame);
    this.layout();
    frame.srcdoc = withOfflinePreviewCsp(res.html, this.app.network?.offline); // offline mode: no remote scripts, fonts or requests
    // fall back to swapping anyway if the bridge never reports (scripts blocked, page crashed …)
    this.pending.timer = setTimeout(() => this.#swap(frame), 2500);
  }

  #swap(frame) {
    if (!this.pending || this.pending.frame !== frame) return;
    clearTimeout(this.pending.timer);
    const old = this.current?.frame;
    this.current = { frame };
    this.pending = null;
    frame.style.visibility = "";
    old?.remove();
    this.ws.clearConsole(); // the console shows the output of the document that is on screen
    this.#post({ type: "scroll", x: this.scroll.x, y: this.scroll.y });
    this.#post({ type: "mode", edit: this.edit });
    this.#postMeasure();
    this.#post({ type: "viewportOpts", scrollbar: this.showScrollbar }); // also asks the frame for fresh layout metrics
    this.selectionChanged();
    this.emit("swap");
  }

  // ------------------------------------------------------------ talking to the frame

  #post(msg) {
    const w = this.current?.frame?.contentWindow;
    if (w) w.postMessage({ of: 1, ...msg }, "*");
  }

  /** Selected element id changed (or the breakpoint did): redraw the frame's selection box. */
  selectionChanged() {
    const id = this.ws.selection?.id ?? null;
    this.selectedId = id;
    this.#post({ type: "select", id });
  }
  hover(id) {
    this.#post({ type: "hover", id });
  }
  reveal(id) {
    this.#post({ type: "reveal", id });
  }
  scrollTo(x, y) {
    this.#post({ type: "scroll", x, y });
  }
  setSpacingGuides(on) {
    this.#post({ type: "spacing", on });
  }
  live(id, decls) {
    this.#post({ type: "live", id, decls });
  }
  liveClear() {
    this.#post({ type: "liveClear" });
  }
  startTextEdit(id) {
    this.#post({ type: "textEditStart", id });
  }

  /** Computed style values of an element in the frame. Resolves to { values, rect, … } or null. */
  computed(id, props) {
    return new Promise((resolve) => {
      if (!this.current || id == null) return resolve(null);
      const reqId = this.reqSeq++;
      const timer = setTimeout(() => {
        this.reqs.delete(reqId);
        resolve(null);
      }, 800);
      this.reqs.set(reqId, (m) => {
        clearTimeout(timer);
        resolve(m.values ? m : null);
      });
      this.#post({ type: "computed", id, props, reqId });
    });
  }

  // ------------------------------------------------------------ measure tool

  get measuring() {
    return this.measure.on;
  }
  /** Turns the measure tool on or off (hover = box model overlay, click = pin, Alt = distance to the reference element). */
  setMeasure(on) {
    on = !!on;
    if (on === this.measure.on) return;
    this.measure.on = on;
    if (!on) {
      this.measure.box = null;
      this.measure.pins = 0;
    }
    this.#postMeasure();
    if (on) {
      this.escOff = (e) => {
        if (e.key !== "Escape" || e.defaultPrevented || e.target?.closest?.(".cm-editor, input, textarea, sl-select, sl-input")) return;
        this.setMeasure(false);
      };
      window.addEventListener("keydown", this.escOff);
    } else if (this.escOff) window.removeEventListener("keydown", this.escOff);
    this.emit("measure", this.measure);
  }
  /** Changes unit / ppi basis / flags of the measure tool; unit and basis are remembered as preferences. */
  setMeasureOptions(patch) {
    const m = this.measure;
    if (patch.unit && UNITS.includes(patch.unit)) {
      m.unit = patch.unit;
      this.app.setPref("codeMeasureUnit", m.unit);
    }
    if (patch.ppi > 0) {
      m.ppi = Math.max(20, Math.min(1000, Number(patch.ppi)));
      this.app.setPref("codeMeasurePpi", m.ppi);
    }
    if ("dprAware" in patch) {
      m.dprAware = !!patch.dprAware;
      this.app.setPref("codeMeasureDpr", m.dprAware);
    }
    if ("details" in patch) m.details = !!patch.details;
    this.#postMeasure();
    this.emit("measure", m);
  }
  #postMeasure() {
    const m = this.measure;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--of-accent").trim();
    this.#post({ type: "measure", on: m.on, unit: m.unit, ppi: m.ppi, dprAware: m.dprAware, details: m.details, accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#4f8cff" });
  }
  /** The validated box model of an element (px values of the frame), or null. Used by the Vibe tool measure_element. */
  measureBox(id) {
    return new Promise((resolve) => {
      if (!this.current || id == null) return resolve(null);
      const reqId = this.reqSeq++;
      const timer = setTimeout(() => {
        this.reqs.delete(reqId);
        resolve(null);
      }, 800);
      this.reqs.set(reqId, (m) => {
        clearTimeout(timer);
        resolve(sanitizeBox(m.box));
      });
      this.#post({ type: "measureBox", id, reqId });
    });
  }

  /** Converts client coordinates (parent window) to frame coordinates. Returns null when outside the frame. */
  toFrame(clientX, clientY) {
    const f = this.current?.frame;
    if (!f) return null;
    const r = f.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return { x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
  }
  fromFrame(x, y) {
    const r = this.current?.frame?.getBoundingClientRect();
    return r ? { x: r.left + x * this.scale, y: r.top + y * this.scale } : { x, y };
  }

  /** Asks the frame where an element dropped at the given client position would be inserted. */
  dropProbe(clientX, clientY, movingId) {
    return new Promise((resolve) => {
      const p = this.toFrame(clientX, clientY);
      if (!p) {
        this.dropEnd();
        return resolve(null);
      }
      const reqId = this.reqSeq++;
      const timer = setTimeout(() => {
        this.reqs.delete(reqId);
        resolve(null);
      }, 500);
      this.reqs.set(reqId, (m) => {
        clearTimeout(timer);
        resolve({ parentId: m.parentId, index: m.index });
      });
      this.#post({ type: "dropProbe", x: p.x, y: p.y, reqId, movingId });
    });
  }
  dropEnd() {
    this.#post({ type: "dropEnd" });
  }

  // ------------------------------------------------------------ messages from the frame

  #message(e) {
    const m = e.data;
    if (!m || m.of !== 1) return;
    const w = e.source;
    const isCurrent = w === this.current?.frame?.contentWindow;
    const isPending = w === this.pending?.frame?.contentWindow;
    if (!isCurrent && !isPending) return;
    if (m.type === "ready") {
      if (isPending) this.#swap(this.pending.frame);
      else {
        // the frame was reloaded by the browser (for example after being moved in the DOM): restore its state
        this.#post({ type: "scroll", x: this.scroll.x, y: this.scroll.y });
        this.#post({ type: "mode", edit: this.edit });
        this.#postMeasure();
        this.selectionChanged();
      }
      return;
    }
    if (m.type === "computed" || m.type === "dropTarget" || m.type === "measureBox") {
      const cb = this.reqs.get(m.reqId);
      this.reqs.delete(m.reqId);
      if (typeof cb === "function") cb(m);
      return;
    }
    if (m.type === "scroll") {
      this.scroll = { x: m.x, y: m.y };
      return;
    }
    if (!isCurrent) {
      if (m.type === "console") this.ws.log(m.level, m.text);
      return;
    }
    switch (m.type) {
      case "layoutMetrics":
        this.metrics = sanitizeLayoutMetrics(m);
        this.updateLabel();
        this.emit("metrics", this.metrics);
        break;
      case "console":
        this.ws.log(m.level, m.text);
        break;
      case "pick":
        this.ws.pickFromPreview(m.id, { shift: m.shift, alt: m.alt });
        break;
      case "hover":
        this.ws.setHover(m.id);
        break;
      case "context": {
        const p = this.fromFrame(m.x, m.y);
        this.ws.elementMenu(m.id, p.x, p.y);
        break;
      }
      case "key":
        this.ws.previewKey(m);
        break;
      case "dblclick":
        this.ws.revealInCode(m.id);
        break;
      case "textEdit":
        this.ws.applyTextEdit(m.id, m.text, false);
        break;
      case "htmlEdit":
        this.ws.applyTextEdit(m.id, m.html, true);
        break;
      case "moveDrop":
        this.ws.moveElement(m.id, m.parentId, m.index);
        break;
      case "dropFiles":
        this.ws.dropFiles(m.files, m.parentId, m.index);
        break;
      case "navigate":
        this.ws.navigatePreview(m.href);
        break;
      case "external":
        this.ws.openExternal(m.href);
        break;
      case "submit":
        this.app.toast("Forms are not submitted in the preview.", "primary", 1800);
        break;
      case "measureInfo":
        // untrusted: the page's own scripts can post to the parent too, so everything is validated
        if (!this.measure.on) break;
        this.measure.box = m.box ? sanitizeBox(m.box) : null;
        this.measure.pins = Number.isInteger(m.pins) && m.pins >= 0 && m.pins <= 99 ? m.pins : 0;
        this.emit("measure", this.measure);
        break;
      case "measureExit":
        this.setMeasure(false);
        break;
      case "measureOpt":
        this.measure.details = !!m.details;
        this.emit("measure", this.measure);
        break;
      case "measureCopied":
        if (typeof m.text === "string" && m.text.length < 80) this.copyMeasure(m.text, m.ok === true);
        break;
      default:
        break;
    }
  }

  /** Copies a measurement ("320×48px") to the clipboard; `done` = the frame already did it. */
  copyMeasure(text, done = false) {
    const toast = () => this.app.toast(t("Copied {value}", { value: text }), "success", 1400);
    if (done) return toast();
    navigator.clipboard?.writeText(text).then(toast, () => this.app.toast(t("Could not copy to the clipboard."), "warning", 2400));
  }

  destroy() {
    window.removeEventListener("keydown", this.altKeys);
    window.removeEventListener("keyup", this.altKeys);
    window.removeEventListener("blur", this.onBlur);
    if (this.escOff) window.removeEventListener("keydown", this.escOff);
    clearTimeout(this.metricsTimer);
    this.bar.destroy?.();
    this.rulers.destroy?.();
    clearTimeout(this.timer);
    window.removeEventListener("message", this.onMessage);
    this.ro.disconnect();
    for (const f of this.#frames()) f.remove();
  }
}
