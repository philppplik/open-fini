// Crop tool and cropPage(): crops the active page, optionally rotated (straighten), flipped and with filled corners.
//
// Public API: `cropPage(app, rect, opts)` (one history step, shared by the tool, Image > Crop to Selection / Trim /
// Reveal All and the Vibe `crop_image` tool), `CropTool` (id "crop", key C).
// Invariants: every layer of the page is moved by ONE matrix (cropMatrix) so layers stay aligned; with "Delete cropped
// pixels" off nothing is destroyed (content stays outside the page bounds and Reveal All brings it back).
// Pure geometry lives in engine/pixel/crop.js (tested in tests/pixel/crop.test.js).
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { mul, translate } from "../../core/math.js";
import { createNode, walk, worldMatrix } from "../../core/nodes.js";
import { button } from "../../ui/controls.js";
import { t, N_ } from "../../i18n/index.js";
import { ratioValue, resizeRect, applyRatio, rotatedCorners, fitRotatedInside, cropMatrix, levelAngle, overlayLines, nextOverlay } from "../../engine/pixel/crop.js";

const RATIO_OPTIONS = ["free", "original", "1:1", "4:3", "3:2", "16:9", "5:4", "3:4", "2:3", "9:16", "custom"].map((k) => ({ value: k, label: k === "free" ? N_("Free") : k === "original" ? N_("Original") : k === "custom" ? N_("Custom…") : k }));

/**
 * Crops the active page to `rect` (page px). `angle` rotates the crop box (degrees clockwise; content is rotated the
 * other way), `flipH/flipV` mirror the result, `corners` fills uncovered areas: "transparent", "background" (a solid layer
 * in the background color) or "fit" (the box is shrunk until no corner is empty).
 */
export function cropPage(app, rect, { deletePixels = false, angle = 0, flipH = false, flipV = false, corners = "transparent" } = {}) {
  const doc = app.doc;
  const page = app.page;
  const rotated = Math.abs(angle) > 1e-6;
  let r = { ...rect };
  if (rotated && corners === "fit") r = fitRotatedInside(r, angle, page.w, page.h);
  if (!rotated) r = { x: Math.round(r.x), y: Math.round(r.y), w: r.w, h: r.h };
  const w = Math.max(1, Math.round(r.w));
  const hh = Math.max(1, Math.round(r.h));
  let M = rotated ? cropMatrix({ ...r, w, h: hh }, angle) : translate(-r.x, -r.y);
  if (flipH) M = mul([-1, 0, 0, 1, w, 0], M);
  if (flipV) M = mul([1, 0, 0, -1, 0, hh], M);
  doc.tx("Crop", () => {
    for (const n of page.root.children) doc.set(n, { m: mul(M, n.m) });
    if (deletePixels && !rotated && !flipH && !flipV) {
      const nodes = [];
      for (const c of page.root.children) walk(c, (n) => n.type === "pixel" && nodes.push(n));
      for (const n of nodes) {
        const W = worldMatrix(n);
        // only axis-aligned, unscaled layers can be cropped losslessly
        if (Math.abs(W[0] - 1) > 1e-6 || Math.abs(W[3] - 1) > 1e-6 || Math.abs(W[1]) > 1e-6 || Math.abs(W[2]) > 1e-6) continue;
        const src = doc.getPixels(n);
        const lx = Math.max(0, Math.round(-W[4]));
        const ly = Math.max(0, Math.round(-W[5]));
        const lw = Math.min(src.width - lx, Math.round(w - Math.max(0, W[4])));
        const lh = Math.min(src.height - ly, Math.round(hh - Math.max(0, W[5])));
        if (lw < 1 || lh < 1) continue;
        const c = createCanvas(lw, lh);
        ctx2d(c).drawImage(src, lx, ly, lw, lh, 0, 0, lw, lh);
        doc.replacePixels(n, c, { w: lw, h: lh, m: mul(translate(lx, ly), n.m) }, "Crop Pixels");
      }
    }
    if (corners === "background") {
      const bgLayer = createNode("pixel", { name: "Crop background", w, h: hh });
      const c = createCanvas(w, hh);
      const ctx = ctx2d(c);
      ctx.fillStyle = app.style?.secondary || "#ffffff";
      ctx.fillRect(0, 0, w, hh);
      doc.pixels.set(bgLayer.id, c);
      doc.insert(bgLayer, page.root, 0);
    }
    const g = page.guides;
    doc.set(page, { w, h: hh, guides: rotated || flipH || flipV ? { h: [], v: [] } : { h: g.h.map((v) => v - r.y), v: g.v.map((v) => v - r.x) } });
  });
  app.state.pixelMask = null;
  app.state.maskRev = (app.state.maskRev | 0) + 1;
  app.cv?.fitPage();
}

export class CropTool extends Tool {
  static id = "crop";
  static label = "Crop";
  static icon = "of:crop";
  static shortcut = "C";
  static studios = ["pixel", "vector", "layout"];
  static options = [
    { key: "ratio", label: N_("Ratio"), type: "select", default: "free", options: RATIO_OPTIONS },
    { key: "customW", label: N_("Custom W"), type: "int", min: 1, max: 99, step: 1, default: 5 },
    { key: "customH", label: N_("Custom H"), type: "int", min: 1, max: 99, step: 1, default: 4 },
    { key: "angle", label: N_("Straighten"), type: "angle", min: -45, max: 45, step: 0.1, default: 0 },
    { key: "overlay", label: N_("Overlay"), type: "select", default: "thirds", options: [{ value: "thirds", label: N_("Rule of thirds") }, { value: "grid", label: N_("Grid") }, { value: "golden", label: N_("Golden ratio") }, { value: "diagonal", label: N_("Diagonals") }, { value: "triangle", label: N_("Golden triangle") }, { value: "none", label: N_("None") }] },
    { key: "corners", label: N_("Empty corners"), type: "select", default: "transparent", options: [{ value: "transparent", label: N_("Transparent") }, { value: "background", label: N_("Background color") }, { value: "fit", label: N_("Shrink to fit") }] },
    { key: "deletePixels", label: N_("Delete cropped pixels"), type: "bool", default: false },
  ];
  cursor = "crosshair";
  rect = null;
  flipH = false;
  flipV = false;
  level = false;
  line = null;

  activate() {
    const p = this.app.page;
    this.rect = { x: 0, y: 0, w: p.w, h: p.h };
    this.flipH = this.flipV = this.level = false;
    this.line = null;
    this.app.toolOptions(this.id).angle = 0;
    this.app.cv?.setCursor("crosshair");
    this.app.requestOverlay();
  }
  deactivate() {
    this.rect = null;
  }
  refresh() {
    const o = this.opts;
    if (this.rect) {
      const bounds = this.#angle() ? null : this.app.page;
      this.rect = applyRatio(this.rect, this.#ratio(), bounds && { w: bounds.w, h: bounds.h });
      if (o.corners === "fit" && this.#angle()) this.rect = fitRotatedInside(this.rect, this.#angle(), this.app.page.w, this.app.page.h);
    }
    this.app.requestOverlay();
  }
  #angle() {
    return Number(this.opts.angle) || 0;
  }
  #ratio() {
    const o = this.opts;
    const r = ratioValue(o.ratio, this.app.page, `${o.customW}:${o.customH}`);
    return r && (this.portrait ? 1 / r : r);
  }
  /** Toggles landscape / portrait for the ratio (and swaps the current box). */
  swapOrientation() {
    this.portrait = !this.portrait;
    const r = this.rect;
    if (r) {
      const c = [r.x + r.w / 2, r.y + r.h / 2];
      this.rect = applyRatio({ x: c[0] - r.h / 2, y: c[1] - r.w / 2, w: r.h, h: r.w }, this.#ratio(), this.#angle() ? null : this.app.page);
    }
    this.app.requestOverlay();
    this.app.emit("contextbar");
  }
  #center() {
    return [this.rect.x + this.rect.w / 2, this.rect.y + this.rect.h / 2];
  }
  /** Rotates a page point into the (unrotated) frame of the box around `c`. */
  #local(e, c = this.#center(), a = this.#angle()) {
    const r = (-a * Math.PI) / 180;
    const dx = e.x - c[0], dy = e.y - c[1];
    return { x: c[0] + dx * Math.cos(r) - dy * Math.sin(r), y: c[1] + dx * Math.sin(r) + dy * Math.cos(r) };
  }
  #hit(e) {
    const { x, y, w, h: hh } = this.rect;
    const l = this.#local(e);
    const tol = 8 / this.app.view.zoom;
    const near = (a, b) => Math.abs(a - b) <= tol;
    const L = near(l.x, x), R = near(l.x, x + w), T = near(l.y, y), B = near(l.y, y + hh);
    const inX = l.x > x - tol && l.x < x + w + tol, inY = l.y > y - tol && l.y < y + hh + tol;
    if (T && L) return "nw";
    if (T && R) return "ne";
    if (B && L) return "sw";
    if (B && R) return "se";
    if (T && inX) return "n";
    if (B && inX) return "s";
    if (L && inY) return "w";
    if (R && inY) return "e";
    if (l.x > x && l.x < x + w && l.y > y && l.y < y + hh) return "move";
    return null;
  }
  #isFull() {
    const p = this.app.page;
    return !this.#angle() && this.rect.w >= p.w - 0.5 && this.rect.h >= p.h - 0.5 && this.rect.x < 0.5 && this.rect.y < 0.5;
  }

  hover(e) {
    if (!this.rect || this.level) return;
    const hit = this.#hit(e);
    const cur = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", w: "ew-resize", e: "ew-resize", move: "move" }[hit] || (this.#isFull() ? "crosshair" : "grab");
    this.app.cv?.setCursor(cur);
  }

  pointerDown(e) {
    if (!this.rect) return;
    if (this.level) {
      this.line = [[e.x, e.y], [e.x, e.y]];
      this.drag = { kind: "level" };
      return;
    }
    const hit = this.#hit(e);
    const c = this.#center();
    if (hit && !(hit === "move" && this.#isFull())) this.drag = { kind: hit, rect: { ...this.rect }, c, a: this.#angle(), x: e.x, y: e.y };
    else if (!hit && !this.#isFull()) this.drag = { kind: "rotate", c, a0: Math.atan2(e.y - c[1], e.x - c[0]), angle: this.#angle() };
    else this.drag = { kind: "new", x: e.x, y: e.y };
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const page = this.app.page;
    const ratio = this.#ratio();
    const bounded = !this.#angle();
    const clampX = (v) => Math.max(0, Math.min(page.w, v));
    const clampY = (v) => Math.max(0, Math.min(page.h, v));
    if (d.kind === "level") {
      this.line[1] = [e.x, e.y];
    } else if (d.kind === "rotate") {
      let a = d.angle + ((Math.atan2(e.y - d.c[1], e.x - d.c[0]) - d.a0) * 180) / Math.PI;
      a = ((((a + 180) % 360) + 360) % 360) - 180;
      a = Math.max(-45, Math.min(45, e.shift ? Math.round(a / 5) * 5 : Math.round(a * 10) / 10));
      this.app.toolOptions(this.id).angle = a;
      this.#refit();
    } else if (d.kind === "new") {
      const x1 = bounded ? clampX(e.x) : e.x, y1 = bounded ? clampY(e.y) : e.y;
      let r = { x: Math.min(clampX(d.x), x1), y: Math.min(clampY(d.y), y1), w: Math.abs(x1 - clampX(d.x)), h: Math.abs(y1 - clampY(d.y)) };
      if (ratio && r.w > 0 && r.h > 0) {
        const wantW = Math.max(r.w, r.h * ratio);
        r = { x: x1 < d.x ? d.x - wantW : d.x, y: y1 < d.y ? d.y - wantW / ratio : d.y, w: wantW, h: wantW / ratio };
        if (bounded) r = applyRatio({ ...r, x: Math.max(0, Math.min(page.w - r.w, r.x)), y: Math.max(0, Math.min(page.h - r.h, r.y)) }, ratio, page);
      }
      this.rect = r;
    } else if (d.kind === "move") {
      const dx = e.x - d.x, dy = e.y - d.y, r = d.rect;
      this.rect = bounded ? { x: Math.max(0, Math.min(page.w - r.w, r.x + dx)), y: Math.max(0, Math.min(page.h - r.h, r.y + dy)), w: r.w, h: r.h } : { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
    } else {
      const lp = this.#local(e, d.c, d.a);
      const out = resizeRect(d.rect, d.kind, lp.x, lp.y, ratio, bounded ? { w: page.w, h: page.h } : null);
      if (bounded) this.rect = out;
      else {
        // the box rotates around its center: keep the dragged-opposite edge fixed in page space
        const rad = (d.a * Math.PI) / 180;
        const dx = out.x + out.w / 2 - d.c[0], dy = out.y + out.h / 2 - d.c[1];
        const cx = d.c[0] + dx * Math.cos(rad) - dy * Math.sin(rad), cy = d.c[1] + dx * Math.sin(rad) + dy * Math.cos(rad);
        this.rect = { x: cx - out.w / 2, y: cy - out.h / 2, w: out.w, h: out.h };
      }
    }
    if (d.kind !== "level") this.app.status(`${Math.round(this.rect.w)} × ${Math.round(this.rect.h)} px${this.#angle() ? ` · ${this.#angle().toFixed(1)}°` : ""}`);
    this.app.requestOverlay();
  }
  #refit() {
    const o = this.opts;
    if (o.corners === "fit") this.rect = fitRotatedInside(this.rect, this.#angle(), this.app.page.w, this.app.page.h);
  }

  pointerUp() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === "level") {
      const [a, b] = this.line;
      this.line = null;
      this.level = false;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 8) {
        this.app.toolOptions(this.id).angle = Math.max(-45, Math.min(45, levelAngle(a, b)));
        this.#refit();
      }
      this.app.emit("contextbar");
    } else if (d?.kind === "rotate") this.app.emit("contextbar");
    if (this.rect && (this.rect.w < 4 || this.rect.h < 4)) this.activate();
    this.app.status("");
    this.app.requestOverlay();
  }

  doubleClick() {
    this.apply();
  }

  apply() {
    if (!this.rect) return;
    const r = this.rect;
    if (this.#isFull() && !this.flipH && !this.flipV) return this.app.toast("Drag a crop area first.", "warning");
    const o = this.opts;
    cropPage(this.app, r, { deletePixels: o.deletePixels, angle: this.#angle(), corners: o.corners, flipH: this.flipH, flipV: this.flipV });
    this.app.setTool("move");
  }

  keyDown(ev) {
    if (ev.key === "Enter") {
      this.apply();
      return true;
    }
    if (ev.key === "Escape") {
      if (this.level) {
        this.level = false;
        this.line = null;
        this.app.requestOverlay();
        this.app.emit("contextbar");
      } else this.app.setTool("move");
      return true;
    }
    if ((ev.key === "o" || ev.key === "O") && !ev.ctrlKey && !ev.metaKey) {
      this.app.setToolOption(this.id, "overlay", nextOverlay(this.opts.overlay));
      this.app.emit("contextbar");
      return true;
    }
    if (ev.key === "x" || ev.key === "X") {
      this.swapOrientation();
      return true;
    }
    return false;
  }

  contextBar() {
    const toggle = (label, on, fn, title) => {
      const b = button(label, fn, { title });
      b.classList.toggle("active", !!on);
      return b;
    };
    return h(
      "div.of-row.of-inline",
      toggle(N_("Straighten"), this.level, () => { this.level = !this.level; this.app.emit("contextbar"); }, t("Draw a line along something that should be level or plumb")),
      button(N_("Swap"), () => this.swapOrientation()),
      toggle(N_("Flip H"), this.flipH, () => { this.flipH = !this.flipH; this.app.emit("contextbar"); }, t("Mirror the result horizontally")),
      toggle(N_("Flip V"), this.flipV, () => { this.flipV = !this.flipV; this.app.emit("contextbar"); }, t("Mirror the result vertically")),
      button(N_("Reset"), () => { const a = this.app; this.activate(); a.emit("contextbar"); }),
      button(N_("Apply crop"), () => this.apply(), { variant: "primary" }),
      button(N_("Cancel"), () => this.app.setTool("move")),
    );
  }

  /** Tool pill (ui/tool-pill.js). */
  pillState() {
    if (!this.rect) return null;
    return { key: "Crop · {w} × {h} px", params: { w: Math.round(this.rect.w), h: Math.round(this.rect.h) }, actions: [{ id: "apply", label: N_("Apply"), key: "Enter", primary: true }, { id: "cancel", label: N_("Cancel"), key: "Escape" }] };
  }
  pillAction(id) {
    if (id === "apply") this.apply();
    else this.app.setTool("move");
  }

  overlay(ctx) {
    if (!this.rect) return;
    const app = this.app;
    const corners = rotatedCorners(this.rect, this.#angle()).map(([x, y]) => app.pageToScreen(x, y));
    const [px0, py0] = app.pageToScreen(0, 0);
    const [px1, py1] = app.pageToScreen(app.page.w, app.page.h);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(px0, py0, px1 - px0, py1 - py0);
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    const [c0, c1, , c3] = corners;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (const [u0, v0, u1, v1] of overlayLines(this.opts.overlay)) {
      const at = (u, v) => [c0[0] + u * (c1[0] - c0[0]) + v * (c3[0] - c0[0]), c0[1] + u * (c1[1] - c0[1]) + v * (c3[1] - c0[1])];
      ctx.moveTo(...at(u0, v0));
      ctx.lineTo(...at(u1, v1));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#8b7cf6";
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const [hx, hy] of [...corners, mid(corners[0], corners[1]), mid(corners[1], corners[2]), mid(corners[2], corners[3]), mid(corners[3], corners[0])]) {
      ctx.beginPath();
      ctx.rect(Math.round(hx) - 4, Math.round(hy) - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    if (this.line) {
      const [a, b] = this.line.map(([x, y]) => app.pageToScreen(x, y));
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
      ctx.strokeStyle = "#8b7cf6";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
