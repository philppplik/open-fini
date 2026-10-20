// The live preview of the Code studio: a sandboxed iframe (scripts allowed, never same-origin) that shows the
// page being edited at the selected breakpoint width. It is double-buffered — a rebuilt document is swapped in
// only once it reports "ready" — so typing in the editor never flashes. CSS-only edits are patched in place.
import { Emitter, h } from "../../core/util.js";
import { buildPreview, hotCss, BREAKPOINTS } from "../../engine/web/index.js";
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
    this.bp = BREAKPOINTS.find((b) => b.id === this.web.settings.breakpoint) || BREAKPOINTS[0];
    this.zoomSetting = this.web.settings.zoom ?? "fit";
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
    this.stage = h("div.of-prev__stage", this.device);
    this.empty = h("div.of-prev__empty.hidden", h("sl-icon", { name: "window" }), h("p", "This project has no pages yet."), h("p.of-hint", "Create an HTML file in the Explorer."));
    this.el = h("div.of-prev", this.label, this.stage, this.empty);
    this.el.prepend(protectedBanner(this)); // protected mode: "Enable scripts"

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
    return this.bp.width;
  }

  /** Re-computes the device box for the current breakpoint, zoom and available space. */
  layout() {
    const sr = this.stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const pad = 28;
    const availW = Math.max(120, sr.width - pad * 2);
    const w = this.width;
    this.scale = this.zoomSetting === "fit" ? Math.min(1, availW / w) : Math.max(0.1, Math.min(4, Number(this.zoomSetting) || 1));
    const availH = Math.max(120, sr.height - pad - 8);
    const hPx = Math.floor(availH / this.scale);
    this.device.style.width = `${Math.round(w * this.scale)}px`;
    this.device.style.height = `${Math.round(hPx * this.scale)}px`;
    for (const f of this.#frames()) {
      f.style.width = `${w}px`;
      f.style.height = `${hPx}px`;
      f.style.transform = `scale(${this.scale})`;
    }
    this.label.textContent = `${this.bp.label} · ${w} px${this.scale !== 1 ? ` · ${Math.round(this.scale * 100)}%` : ""}`;
    this.emit("layout", { scale: this.scale, width: w });
  }

  #frames() {
    return [this.current?.frame, this.pending?.frame].filter(Boolean);
  }

  setBreakpoint(id) {
    const bp = BREAKPOINTS.find((b) => b.id === id);
    if (!bp || bp === this.bp) return;
    this.bp = bp;
    this.web.settings.breakpoint = id;
    this.layout();
    this.emit("breakpoint", bp);
    this.selectionChanged();
  }

  setZoom(z) {
    this.zoomSetting = z;
    this.web.settings.zoom = z;
    this.layout();
    this.emit("zoom", z);
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
    if (empty) return;
    let res;
    try {
      res = buildPreview(this.web.source, this.page, {
        bridge: bridgeSource,
        config: { mode: this.edit ? "edit" : "preview", accent: "#4f8cff", spacing: true },
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
        this.selectionChanged();
      }
      return;
    }
    if (m.type === "computed" || m.type === "dropTarget") {
      this.reqs.get(m.reqId)?.(m);
      this.reqs.delete(m.reqId);
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
      default:
        break;
    }
  }

  destroy() {
    clearTimeout(this.timer);
    window.removeEventListener("message", this.onMessage);
    this.ro.disconnect();
    for (const f of this.#frames()) f.remove();
  }
}
