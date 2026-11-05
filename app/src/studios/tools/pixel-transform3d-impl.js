// 3D Transform interaction (loaded on first use by pixel-transform3d.js): the context-bar values tilt, rotate and skew
// the layer (or the selected pixels) in perspective; the mesh handles on the canvas pin corners or bend the warp grid;
// dragging inside moves the whole mesh. The preview is drawn on the overlay (subdivided triangles); Apply (Enter)
// resamples with the chosen filter on the worker pool as ONE undo step, Cancel (Escape) leaves the layer unchanged.
import { createCanvas, ctx2d } from "../../core/doc.js";
import { homography, applyH } from "../../engine/pixel/transform3d.js";
import { transformSource, meshForParams, transformLayer3d } from "./transform3d-ops.js";
import { N_ } from "../../i18n/index.js";

const PARAM_KEYS = ["rotateX", "rotateY", "rotateZ", "distance", "skewX", "skewY", "grid"];

export class Transform3DImpl {
  constructor(app, tool) {
    this.app = app;
    this.tool = tool;
    this.src = null;
    this.points = null;
    this.drag = null;
    this.busy = false;
  }
  get opts() {
    return this.tool.opts;
  }
  get n() {
    return Math.max(1, Math.min(4, Number(this.opts.grid) || 1));
  }
  activate() {
    const s = transformSource(this.app);
    if (typeof s === "string") {
      this.app.toast(s, "warning");
      return;
    }
    this.src = s;
    const { t, sel, rect } = s;
    const piece = createCanvas(rect.w, rect.h);
    const g = ctx2d(piece);
    g.drawImage(t.canvas, -rect.x, -rect.y);
    if (sel) {
      g.globalCompositeOperation = "destination-in";
      g.drawImage(sel, -rect.x, -rect.y);
    }
    this.piece = piece;
    this.#rebuild();
  }
  deactivate() {
    this.src = this.points = this.piece = null;
    this.app.requestOverlay();
  }
  #paramKey() {
    return PARAM_KEYS.map((k) => this.opts[k]).join("|");
  }
  #rebuild() {
    this.points = meshForParams(this.src.rect, this.opts, this.n);
    this.key = this.#paramKey();
    this.app.requestOverlay();
  }
  /** Option changes rebuild the mesh from the 3D values (manual handle edits are replaced). */
  refresh() {
    if (this.src && this.#paramKey() !== this.key) this.#rebuild();
  }
  #toLayer(e) {
    const v = this.src.t.inv;
    return [v[0] * e.x + v[2] * e.y + v[4], v[1] * e.x + v[3] * e.y + v[5]];
  }
  #toScreen([x, y]) {
    const m = this.src.t.world;
    return this.app.pageToScreen(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  }
  #near(e) {
    const [sx, sy] = this.app.pageToScreen(e.x, e.y);
    let best = -1, bd = 12;
    this.points.forEach((p, i) => {
      const [x, y] = this.#toScreen(p);
      const d = Math.hypot(x - sx, y - sy);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  hover(e) {
    if (this.points) this.app.cv?.setCursor(this.#near(e) >= 0 ? "crosshair" : "move");
  }
  pointerDown(e) {
    if (!this.points || this.busy) return;
    this.drag = { i: this.#near(e), start: this.#toLayer(e), orig: this.points.map((p) => p.slice()) };
  }
  pointerMove(e) {
    if (!this.drag) return;
    const [x, y] = this.#toLayer(e);
    const dx = x - this.drag.start[0], dy = y - this.drag.start[1];
    if (this.drag.i >= 0) this.points[this.drag.i] = [this.drag.orig[this.drag.i][0] + dx, this.drag.orig[this.drag.i][1] + dy];
    else this.points = this.drag.orig.map(([px, py]) => [px + dx, py + dy]);
    this.app.requestOverlay();
  }
  pointerUp() {
    this.drag = null;
  }
  keyDown(ev) {
    if (ev.key === "Enter") return this.apply(), true;
    if (ev.key === "Escape") return this.app.setTool("move"), true;
    return false;
  }
  async apply() {
    if (!this.src || this.busy) return;
    this.busy = true;
    const r = await transformLayer3d(this.app, { points: this.points, n: this.n, filter: this.opts.filter, source: this.src });
    this.busy = false;
    if (r !== true) return this.app.toast(r, "warning");
    this.app.setTool("move");
  }
  pillState() {
    return this.src ? { key: N_("3D Transform"), actions: [{ id: "apply", label: "Apply", key: "Enter", primary: true }, { id: "reset", label: "Reset" }, { id: "cancel", label: "Cancel", key: "Escape" }] } : null;
  }
  pillAction(id) {
    if (id === "apply") this.apply();
    else if (id === "reset") this.#rebuild();
    else this.app.setTool("move");
  }
  overlay(ctx) {
    if (!this.points) return;
    const n = this.n, { rect } = this.src, P = this.points, sub = 6;
    ctx.save();
    // live preview: every mesh cell is split into sub x sub patches drawn as two affine triangles each
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * (n + 1) + i;
      const dst = [P[k], P[k + 1], P[k + n + 2], P[k + n + 1]];
      const cw = rect.w / n, ch = rect.h / n;
      const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], dst);
      if (!H) continue;
      for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) {
        const uv = [[a / sub, b / sub], [(a + 1) / sub, b / sub], [(a + 1) / sub, (b + 1) / sub], [a / sub, (b + 1) / sub]];
        const s = uv.map(([u, v]) => [(i + u) * cw, (j + v) * ch]);
        const d = uv.map(([u, v]) => this.#toScreen(applyH(H, u, v)));
        this.#tri(ctx, s[0], s[1], s[2], d[0], d[1], d[2]);
        this.#tri(ctx, s[0], s[2], s[3], d[0], d[2], d[3]);
      }
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "#8b7cf6";
    ctx.lineWidth = 1.25;
    const S = P.map((p) => this.#toScreen(p));
    for (let j = 0; j <= n; j++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) ctx[i ? "lineTo" : "moveTo"](...S[j * (n + 1) + i]);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= n; i++) ctx[i ? "lineTo" : "moveTo"](...S[i * (n + 1) + j]);
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    for (const [x, y] of S) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  /** Draws the source triangle s0 s1 s2 (piece pixels) onto the screen triangle d0 d1 d2. */
  #tri(ctx, s0, s1, s2, d0, d1, d2) {
    const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
    if (Math.abs(den) < 1e-9) return;
    const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
    const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
    const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
    const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
    ctx.save();
    ctx.beginPath();
    // grow the clip a little so neighboring triangles do not leave hairline seams
    const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
    const grow = (p) => [p[0] + Math.sign(p[0] - cx) * 0.6, p[1] + Math.sign(p[1] - cy) * 0.6];
    ctx.moveTo(...grow(d0));
    ctx.lineTo(...grow(d1));
    ctx.lineTo(...grow(d2));
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]);
    ctx.drawImage(this.piece, 0, 0);
    ctx.restore();
  }
}
