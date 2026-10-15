// Retouching tools built on the pixel engine's per-dab operations: Clone, Heal, Spot Heal, Red Eye,
// Smudge, Blur, Sharpen, Dodge, Burn and Sponge.
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { TileSnapshot } from "../../engine/brush.js";
import { paintTarget, toLayer, layerSpaceMask, commitPixelEdit } from "../../core/pixel.js";
import { makeBrushFalloff, cloneDab, healPatch, spotHeal, removeRedEye, smudgeDab, createSmudgeState, blurDab, sharpenDab, dodgeBurnDab, spongeDab } from "../../engine/pixel/index.js";
import { ctx2d } from "../../core/doc.js";
import { brushBar } from "./pixel-paint.js";

const falloffCache = new Map();
function falloff(d, hardness) {
  const key = `${d}|${hardness.toFixed(2)}`;
  let f = falloffCache.get(key);
  if (!f) {
    f = makeBrushFalloff(d, hardness);
    if (falloffCache.size > 40) falloffCache.delete(falloffCache.keys().next().value);
    falloffCache.set(key, f);
  }
  return f;
}

class RetouchBase extends Tool {
  static studios = ["pixel"];
  cursor = "none";
  hoverPt = null;
  /** Subclasses implement the actual pixel operation on a small patch. */
  operate(_img, _cx, _cy, _fall, _d, _ctx) {}
  needsSource = false;

  activate() {
    this.app.cv?.setCursor("none");
  }
  contextBar() {
    return brushBar(this.app, { opacity: false, flow: false });
  }

  pointerDown(e) {
    const app = this.app;
    const t = paintTarget(app);
    if (!t || t.locked) return;
    if (this.needsSource && e.alt) return this.setSource(t, e);
    if (this.needsSource && !this.source) return app.toast("Alt-click to set the source point first.", "warning");
    this.t = t;
    this.snap = new TileSnapshot(t.canvas);
    this.sel = layerSpaceMask(app, t);
    this.dirty = null;
    this.carry = 0;
    this.state = createSmudgeState();
    this.last = toLayer(t, e.x, e.y);
    if (this.needsSource && (!this.offset || !this.aligned)) {
      this.offset = [this.source[0] - this.last[0], this.source[1] - this.last[1]];
    }
    this.dab(this.last[0], this.last[1]);
  }

  pointerMove(e) {
    this.hoverPt = [e.x, e.y];
    if (!this.t) return this.app.requestOverlay();
    const [x, y] = toLayer(this.t, e.x, e.y);
    const [lx, ly] = this.last;
    const dist = Math.hypot(x - lx, y - ly);
    const step = Math.max(1, (this.app.brush.size / this.t.scale) * 0.12);
    let next = step - this.carry;
    while (next <= dist) {
      const k = next / dist;
      this.dab(lx + (x - lx) * k, ly + (y - ly) * k);
      next += step;
    }
    this.carry = step - (next - dist);
    this.last = [x, y];
    this.app.doc.touch(this.t.node);
    this.app.requestRender();
    this.app.requestOverlay();
  }

  hover(e) {
    this.hoverPt = [e.x, e.y];
    this.app.requestOverlay();
  }

  dab(x, y) {
    const t = this.t;
    const b = this.app.brush;
    const d = Math.max(3, Math.round(b.size / t.scale));
    const pad = this.pad ?? 3;
    const W = t.canvas.width;
    const H = t.canvas.height;
    let rx = Math.floor(x - d / 2) - pad;
    let ry = Math.floor(y - d / 2) - pad;
    let rw = d + pad * 2;
    let rh = d + pad * 2;
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(W, rx + rw);
    const y1 = Math.min(H, ry + rh);
    if (x1 <= x0 || y1 <= y0) return;
    rx = x0;
    ry = y0;
    rw = x1 - x0;
    rh = y1 - y0;
    this.snap.touch(rx, ry, rw, rh);
    const img = t.ctx.getImageData(rx, ry, rw, rh);
    const orig = this.sel ? new Uint8ClampedArray(img.data) : null;
    this.operate(img, x - rx, y - ry, falloff(d, b.hardness), d, { rx, ry, x, y });
    if (orig) {
      const s = ctx2d(this.sel).getImageData(rx, ry, rw, rh).data;
      const dd = img.data;
      for (let i = 0; i < rw * rh; i++) {
        const m = s[i * 4 + 3] / 255;
        if (m >= 1) continue;
        const j = i * 4;
        dd[j] = orig[j] + (dd[j] - orig[j]) * m;
        dd[j + 1] = orig[j + 1] + (dd[j + 1] - orig[j + 1]) * m;
        dd[j + 2] = orig[j + 2] + (dd[j + 2] - orig[j + 2]) * m;
        dd[j + 3] = orig[j + 3] + (dd[j + 3] - orig[j + 3]) * m;
      }
    }
    t.ctx.putImageData(img, rx, ry);
    this.dirty = this.dirty ? { x: Math.min(this.dirty.x, rx), y: Math.min(this.dirty.y, ry), r: Math.max(this.dirty.r, rx + rw), b: Math.max(this.dirty.b, ry + rh) } : { x: rx, y: ry, r: rx + rw, b: ry + rh };
    this.app.doc.touch(t.node);
    this.app.requestRender();
  }

  pointerUp() {
    const t = this.t;
    if (!t) return;
    this.t = null;
    const r = this.dirty;
    if (!r) return;
    const w = r.r - r.x;
    const hh = r.b - r.y;
    const edit = { x: r.x, y: r.y, before: this.snap.before(r.x, r.y, w, hh), after: t.ctx.getImageData(r.x, r.y, w, hh) };
    commitPixelEdit(this.app, t, edit, this.constructor.label);
    this.snap = null;
    this.app.emit("pixels");
  }

  cancel() {
    this.t = null;
  }

  overlay(ctx) {
    const app = this.app;
    if (this.hoverPt) {
      const [x, y] = app.pageToScreen(...this.hoverPt);
      const r = Math.max(2, (app.brush.size / 2) * app.view.zoom);
      ctx.save();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.beginPath();
      ctx.arc(x, y, r + 1, 0, 7);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Clone and Heal share the "Alt-click to set a source" workflow. */
class SourceTool extends RetouchBase {
  needsSource = true;
  pad = 2;
  source = null;
  static options = [{ key: "aligned", label: "Aligned", type: "bool", default: true }, { key: "opacity", label: "Opacity", type: "range", min: 0.05, max: 1, step: 0.01, default: 1 }];
  get aligned() {
    return this.opts.aligned;
  }
  setSource(t, e) {
    this.source = toLayer(t, e.x, e.y);
    this.offset = null;
    this.srcPage = [e.x, e.y];
    this.app.status("Source point set");
    this.app.requestOverlay();
  }
  contextBar() {
    return h("div.of-row.of-inline", brushBar(this.app, { opacity: false, flow: false }), h("span.of-hint", "Alt-click to set the source"));
  }
  sourcePatch(t, x, y, d) {
    const sx = x + this.offset[0];
    const sy = y + this.offset[1];
    const pad = this.pad;
    const rx = Math.floor(sx - d / 2) - pad;
    const ry = Math.floor(sy - d / 2) - pad;
    const rw = d + pad * 2;
    const rh = d + pad * 2;
    return { img: t.ctx.getImageData(rx, ry, rw, rh), cx: sx - rx, cy: sy - ry };
  }
  overlay(ctx) {
    super.overlay(ctx);
    const app = this.app;
    if (!this.source) return;
    let sp = this.srcPage;
    if (this.t && this.offset && this.hoverPt) sp = [this.hoverPt[0] + this.offset[0], this.hoverPt[1] + this.offset[1]];
    if (!sp) return;
    const [x, y] = app.pageToScreen(...sp);
    ctx.save();
    ctx.strokeStyle = "#ff4fa3";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x, y + 7);
    ctx.stroke();
    ctx.restore();
  }
}

export class CloneTool extends SourceTool {
  static id = "clone";
  static label = "Clone Stamp";
  static icon = "of:clone";
  static shortcut = "S";
  static group = "retouch";
  operate(img, cx, cy, fall, d, c) {
    const s = this.sourcePatch(this.t, c.x, c.y, d);
    cloneDab(img, s.img, s.cx, s.cy, cx, cy, fall, d, this.opts.opacity);
  }
}

export class HealTool extends SourceTool {
  static id = "heal";
  static label = "Healing Brush";
  static icon = "bandaid";
  static shortcut = "S";
  static group = "retouch";
  operate(img, cx, cy, fall, d, c) {
    const s = this.sourcePatch(this.t, c.x, c.y, d);
    healPatch(img, s.img, s.cx, s.cy, cx, cy, fall, d, this.opts.opacity);
  }
}

export class SpotHealTool extends RetouchBase {
  static id = "spot-heal";
  static label = "Spot Healing";
  static icon = "bandaid-fill";
  static shortcut = "J";
  static group = "retouch";
  pad = 12;
  operate(img, cx, cy, _fall, d) {
    spotHeal(img, cx, cy, d / 2);
  }
}

export class RedEyeTool extends RetouchBase {
  static id = "redeye";
  static label = "Red Eye Removal";
  static icon = "eye";
  static shortcut = "R";
  static group = "retouch";
  static options = [{ key: "threshold", label: "Sensitivity", type: "int", min: 10, max: 150, step: 1, default: 50 }];
  operate(img, cx, cy, _fall, d) {
    const r = Math.floor(d / 2);
    removeRedEye(img, { x: Math.max(0, Math.floor(cx - r)), y: Math.max(0, Math.floor(cy - r)), width: d, height: d }, { threshold: this.opts.threshold });
  }
  pointerMove() {}
}

export class SmudgeTool extends RetouchBase {
  static id = "smudge";
  static label = "Smudge";
  static icon = "of:smudge";
  static shortcut = "O";
  static group = "blur";
  static options = [{ key: "strength", label: "Strength", type: "range", min: 0.05, max: 1, step: 0.01, default: 0.6 }];
  operate(img, cx, cy, fall, d) {
    smudgeDab(img, cx, cy, fall, d, this.opts.strength, this.state);
  }
}

export class BlurTool extends RetouchBase {
  static id = "blur";
  static label = "Blur";
  static icon = "droplet";
  static shortcut = "O";
  static group = "blur";
  static options = [{ key: "strength", label: "Strength", type: "range", min: 0.05, max: 1, step: 0.01, default: 0.5 }];
  operate(img, cx, cy, fall, d) {
    blurDab(img, cx, cy, fall, d, this.opts.strength);
  }
}

export class SharpenTool extends RetouchBase {
  static id = "sharpen";
  static label = "Sharpen";
  static icon = "triangle";
  static shortcut = "O";
  static group = "blur";
  static options = [{ key: "strength", label: "Strength", type: "range", min: 0.05, max: 1, step: 0.01, default: 0.5 }];
  operate(img, cx, cy, fall, d) {
    sharpenDab(img, cx, cy, fall, d, this.opts.strength);
  }
}

const TONE_OPTIONS = [
  { key: "range", label: "Range", type: "select", default: "midtones", options: [{ value: "shadows", label: "Shadows" }, { value: "midtones", label: "Midtones" }, { value: "highlights", label: "Highlights" }] },
  { key: "exposure", label: "Exposure", type: "range", min: 0.02, max: 1, step: 0.01, default: 0.25 },
];

export class DodgeTool extends RetouchBase {
  static id = "dodge";
  static label = "Dodge";
  static icon = "sun";
  static shortcut = "D";
  static group = "tone";
  static options = TONE_OPTIONS;
  operate(img, cx, cy, fall, d) {
    dodgeBurnDab(img, cx, cy, fall, d, { mode: "dodge", range: this.opts.range, exposure: this.opts.exposure });
  }
}

export class BurnTool extends RetouchBase {
  static id = "burn";
  static label = "Burn";
  static icon = "moon";
  static shortcut = "D";
  static group = "tone";
  static options = TONE_OPTIONS;
  operate(img, cx, cy, fall, d) {
    dodgeBurnDab(img, cx, cy, fall, d, { mode: "burn", range: this.opts.range, exposure: this.opts.exposure });
  }
}

export class SpongeTool extends RetouchBase {
  static id = "sponge";
  static label = "Sponge";
  static icon = "droplet-half";
  static shortcut = "D";
  static group = "tone";
  static options = [
    { key: "mode", label: "Mode", type: "select", default: "desaturate", options: [{ value: "desaturate", label: "Desaturate" }, { value: "saturate", label: "Saturate" }] },
    { key: "flow", label: "Flow", type: "range", min: 0.05, max: 1, step: 0.01, default: 0.4 },
  ];
  operate(img, cx, cy, fall, d) {
    spongeDab(img, cx, cy, fall, d, { mode: this.opts.mode, flow: this.opts.flow });
  }
}

export const PIXEL_RETOUCH_TOOLS = [CloneTool, HealTool, SpotHealTool, RedEyeTool, SmudgeTool, BlurTool, SharpenTool, DodgeTool, BurnTool, SpongeTool];
