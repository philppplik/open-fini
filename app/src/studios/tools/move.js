// Move / Select tool: click, marquee, drag-move, scale and rotate handles, nudge, group entry.
import { Tool } from "../../core/tool.js";
import { pick, pickInRect } from "../../engine/hit.js";
import { localBounds, worldMatrix } from "../../core/nodes.js";
import { mul, invert, apply, translate, rotateAbout, ident, rectFromPoints, snapAngle } from "../../core/math.js";
import { captureTransform, restoreTransform, applyPageDelta, transformKeys, pageBoundsOf } from "../../core/transform.js";
import { collectTargets, snapRect, snapPoint } from "../../core/snap.js";
import { topLevelSelection, duplicateSelection } from "../../core/ops.js";

const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/><path d="M16 3l3 4-5 1zM8 21l-3-4 5-1z" fill="black" stroke="white" stroke-width="1"/></svg>',
)}") 12 12, alias`;

const HANDLES = {
  nw: [0, 0, "nwse-resize"], n: [0.5, 0, "ns-resize"], ne: [1, 0, "nesw-resize"], e: [1, 0.5, "ew-resize"],
  se: [1, 1, "nwse-resize"], s: [0.5, 1, "ns-resize"], sw: [0, 1, "nesw-resize"], w: [0, 0.5, "ew-resize"],
};

export class MoveTool extends Tool {
  static id = "move";
  static label = "Move";
  static icon = "cursor";
  static shortcut = "V";
  static studios = ["vector", "pixel", "layout"];

  cursor = "default";
  hoverNode = null;
  mode = null; // 'move' | 'scale' | 'rotate' | 'marquee' | 'pending'
  marquee = null;
  guides = [];

  // ------------------------------------------------------------------ frame

  /** {W, box} — local→page matrix and the local-space box of the current selection. */
  frame() {
    const sel = topLevelSelection(this.app);
    if (!sel.length) return null;
    if (sel.length === 1) {
      const n = sel[0];
      const box = localBounds(n);
      if (!box) return null;
      return { W: worldMatrix(n), box, single: n };
    }
    const b = pageBoundsOf(sel);
    return b ? { W: ident(), box: b } : null;
  }

  /** Handle points in SCREEN space. */
  handlePoints(fr) {
    const app = this.app;
    const { W, box } = fr;
    const toScreen = (lx, ly) => {
      const [px, py] = apply(W, box.x + lx * box.w, box.y + ly * box.h);
      return app.pageToScreen(px, py);
    };
    const pts = {};
    for (const [id, [fx, fy]] of Object.entries(HANDLES)) pts[id] = toScreen(fx, fy);
    // rotation handle above the top-center
    const tc = pts.n;
    const bc = pts.s;
    let dx = tc[0] - bc[0];
    let dy = tc[1] - bc[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    pts.rot = [tc[0] + dx * 26, tc[1] + dy * 26];
    return pts;
  }

  hitHandle(fr, sx, sy) {
    const pts = this.handlePoints(fr);
    const r = 7;
    const d = (p) => Math.hypot(p[0] - sx, p[1] - sy);
    if (d(pts.rot) <= r + 2) return "rot";
    for (const id of Object.keys(HANDLES)) if (d(pts[id]) <= r) return id;
    for (const id of ["nw", "ne", "se", "sw"]) {
      const dd = d(pts[id]);
      if (dd > r && dd <= 22 && !this.insideFrame(fr, sx, sy)) return `rot:${id}`;
    }
    return null;
  }

  insideFrame(fr, sx, sy) {
    const [px, py] = this.app.screenToPage(sx, sy);
    const inv = invert(fr.W);
    if (!inv) return false;
    const [lx, ly] = apply(inv, px, py);
    return lx >= fr.box.x && ly >= fr.box.y && lx <= fr.box.x + fr.box.w && ly <= fr.box.y + fr.box.h;
  }

  // ------------------------------------------------------------------ events

  activate() {
    this.app.requestOverlay();
  }

  hover(e) {
    const app = this.app;
    const fr = this.frame();
    let cursor = "default";
    let hn = null;
    if (fr) {
      const h = this.hitHandle(fr, e.sx, e.sy);
      if (h === "rot" || h?.startsWith("rot:")) cursor = ROTATE_CURSOR;
      else if (h) cursor = HANDLES[h][2];
    }
    if (cursor === "default") {
      hn = pick(app.context, e.x, e.y, 5 / app.view.zoom, { deep: e.ctrl });
      cursor = hn ? "move" : "default";
    }
    if (hn !== this.hoverNode) {
      this.hoverNode = hn;
      app.requestOverlay();
    }
    this.cursor = cursor;
    app.cv?.setCursor(cursor);
  }

  pointerDown(e) {
    const app = this.app;
    this.guides = [];
    const fr = this.frame();
    if (fr) {
      const h = this.hitHandle(fr, e.sx, e.sy);
      if (h) return this.#beginTransform(h, e, fr);
    }
    const hit = pick(app.context, e.x, e.y, 5 / app.view.zoom, { deep: e.ctrl });
    this.clickHit = hit;
    if (hit) {
      if (e.shift) {
        app.select([hit], { toggle: true });
        this.mode = "pending";
        return;
      }
      if (!app.isSelected(hit)) app.select([hit]);
      this.#beginMove(e);
    } else {
      this.mode = "marquee";
      this.marquee = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, add: e.shift };
      this.base = e.shift ? app.selection.slice() : [];
      if (!e.shift) app.clearSelection();
    }
  }

  #beginMove(e) {
    const app = this.app;
    const doc = app.doc;
    const nodes = topLevelSelection(app).filter((n) => !n.locked);
    if (!nodes.length) {
      this.mode = "pending";
      return;
    }
    this.mode = "move";
    this.startE = e;
    this.dragged = false;
    this.altCopy = e.alt;
    this.items = nodes.map((n) => ({ n, snap: captureTransform(n), before: doc.snapshot(n, transformKeys(n)) }));
    this.startBounds = pageBoundsOf(nodes);
    const v = app.view;
    const vis = v.visibleRect();
    this.targets = collectTargets(doc, app.page, {
      exclude: new Set(nodes),
      group: app.state.group,
      area: { x: vis.x - app.page.x, y: vis.y - app.page.y, w: vis.w, h: vis.h },
    });
  }

  #beginTransform(h, e, fr) {
    const app = this.app;
    const doc = app.doc;
    const nodes = topLevelSelection(app).filter((n) => !n.locked);
    if (!nodes.length) return;
    this.items = nodes.map((n) => ({ n, snap: captureTransform(n), before: doc.snapshot(n, transformKeys(n)) }));
    this.fr = fr;
    this.handle = h;
    this.mode = h === "rot" || h.startsWith("rot:") ? "rotate" : "scale";
    this.startE = e;
    const vis = app.view.visibleRect();
    this.targets = collectTargets(doc, app.page, {
      exclude: new Set(nodes),
      group: app.state.group,
      area: { x: vis.x - app.page.x, y: vis.y - app.page.y, w: vis.w, h: vis.h },
    });
    const { W, box } = fr;
    this.inv = invert(W) || ident();
    this.center = apply(W, box.x + box.w / 2, box.y + box.h / 2);
    this.a0 = Math.atan2(e.y - this.center[1], e.x - this.center[0]);
  }

  pointerMove(e) {
    const app = this.app;
    const doc = app.doc;
    switch (this.mode) {
      case "marquee": {
        const m = this.marquee;
        m.x1 = e.x;
        m.y1 = e.y;
        const rect = rectFromPoints(m.x0, m.y0, m.x1, m.y1);
        const hits = pickInRect(app.context, rect, { contain: !e.alt });
        app.select(m.add ? [...new Set([...this.base, ...hits])] : hits);
        app.requestOverlay();
        break;
      }
      case "move": {
        const sdx = e.sx - this.startE.sx;
        const sdy = e.sy - this.startE.sy;
        if (!this.dragged) {
          if (Math.hypot(sdx, sdy) < 3) return;
          this.dragged = true;
          if (this.altCopy) {
            const copies = duplicateSelection(app);
            // the copies stay behind; we drag the originals' duplicates: swap roles
            this.items = copies.map((n) => ({ n, snap: captureTransform(n), before: doc.snapshot(n, transformKeys(n)) }));
          }
        }
        let dx = e.x - this.startE.x;
        let dy = e.y - this.startE.y;
        if (e.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        this.guides = [];
        if (app.doc.settings.snap !== false && !e.ctrl) {
          const r = { x: this.startBounds.x + dx, y: this.startBounds.y + dy, w: this.startBounds.w, h: this.startBounds.h };
          const s = snapRect(r, this.targets, 6 / app.view.zoom);
          dx += s.dx;
          dy += s.dy;
          this.guides = s.lines;
        }
        const D = translate(dx, dy);
        for (const it of this.items) {
          applyPageDelta(it.n, D, it.snap, { bake: false });
          doc.touch(it.n);
        }
        app.status(`X ${(this.startBounds.x + dx).toFixed(1)}  Y ${(this.startBounds.y + dy).toFixed(1)}`);
        app.emit("transforming");
        app.requestRender();
        break;
      }
      case "scale":
        this.#scale(e);
        break;
      case "rotate":
        this.#rotate(e);
        break;
    }
  }

  #scale(e) {
    const app = this.app;
    const doc = app.doc;
    const { W, box } = this.fr;
    const [hx, hy] = HANDLES[this.handle];
    let [px, py] = [e.x, e.y];
    this.guides = [];
    if (doc.settings.snap !== false && !e.ctrl && Math.abs(W[1]) < 1e-9 && Math.abs(W[2]) < 1e-9) {
      const s = snapPoint(px, py, this.targets, 6 / app.view.zoom);
      px = s.x;
      py = s.y;
      this.guides = s.lines;
    }
    const q = apply(this.inv, px, py);
    const anchor = e.alt ? [box.x + box.w / 2, box.y + box.h / 2] : [box.x + (1 - hx) * box.w, box.y + (1 - hy) * box.h];
    const h0 = [box.x + hx * box.w, box.y + hy * box.h];
    let sx = hx === 0.5 ? 1 : (q[0] - anchor[0]) / (h0[0] - anchor[0] || 1e-9);
    let sy = hy === 0.5 ? 1 : (q[1] - anchor[1]) / (h0[1] - anchor[1] || 1e-9);
    const corner = hx !== 0.5 && hy !== 0.5;
    if ((corner && e.shift) || (this.fr.single && this.fr.single.type === "pixel" && corner && !e.ctrl)) {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = Math.sign(sx || 1) * s;
      sy = Math.sign(sy || 1) * s;
    }
    const eps = 1e-3;
    if (Math.abs(sx) < eps) sx = eps * Math.sign(sx || 1);
    if (Math.abs(sy) < eps) sy = eps * Math.sign(sy || 1);
    const Dl = [sx, 0, 0, sy, anchor[0] - sx * anchor[0], anchor[1] - sy * anchor[1]];
    const Dp = mul(W, mul(Dl, this.inv));
    for (const it of this.items) {
      applyPageDelta(it.n, Dp, it.snap);
      doc.touch(it.n);
    }
    app.status(`W ${(box.w * Math.abs(sx)).toFixed(1)}  H ${(box.h * Math.abs(sy)).toFixed(1)}`);
    app.emit("transforming");
    app.requestRender();
  }

  #rotate(e) {
    const app = this.app;
    const doc = app.doc;
    let da = Math.atan2(e.y - this.center[1], e.x - this.center[0]) - this.a0;
    if (e.shift) da = snapAngle(da, Math.PI / 12);
    const D = rotateAbout(da, this.center[0], this.center[1]);
    for (const it of this.items) {
      applyPageDelta(it.n, D, it.snap, { bake: false });
      doc.touch(it.n);
    }
    app.status(`Rotate ${((da * 180) / Math.PI).toFixed(1)}°`);
    app.emit("transforming");
    app.requestRender();
  }

  pointerUp() {
    const app = this.app;
    const doc = app.doc;
    const mode = this.mode;
    this.mode = null;
    this.guides = [];
    if (mode === "marquee") {
      this.marquee = null;
      app.requestOverlay();
      return;
    }
    if ((mode === "move" && this.dragged) || mode === "scale" || mode === "rotate") {
      const label = mode === "move" ? "Move" : mode === "scale" ? "Resize" : "Rotate";
      doc.tx(label, () => {
        for (const it of this.items) doc.recordSet(it.n, it.before, label);
      });
      app.status("");
    } else if (mode === "move" && this.clickHit && app.selection.length > 1) {
      app.select([this.clickHit]); // plain click on one of several selected objects narrows the selection
    }
    this.items = null;
    app.requestOverlay();
    app.requestRender();
    app.emit("transformed");
  }

  doubleClick(e) {
    const app = this.app;
    const hit = pick(app.context, e.x, e.y, 5 / app.view.zoom);
    if (!hit) return;
    if (hit.type === "group") {
      app.enterGroup(hit);
      const child = pick(hit, e.x, e.y, 5 / app.view.zoom);
      app.select(child ? [child] : []);
    } else if (hit.type === "text") {
      app.select([hit]);
      app.setTool("text");
      app.tools.get("text")?.edit(hit, e);
    } else if (hit.type === "path" || hit.type === "rect" || hit.type === "ellipse" || hit.type === "polygon" || hit.type === "star") {
      app.select([hit]);
      app.setTool("node");
    }
  }

  keyDown(ev) {
    const app = this.app;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[ev.key] && app.selection.length) {
      const step = ev.shiftKey ? 10 : 1;
      const [dx, dy] = arrows[ev.key];
      const nodes = topLevelSelection(app).filter((n) => !n.locked);
      const doc = app.doc;
      doc.tx("Nudge", () => {
        for (const n of nodes) {
          const before = doc.snapshot(n, ["m"]);
          const P = n._parent ? worldMatrix(n._parent) : ident();
          const Pi = invert(P) || ident();
          n.m = [n.m[0], n.m[1], n.m[2], n.m[3], n.m[4] + Pi[0] * dx * step + Pi[2] * dy * step, n.m[5] + Pi[1] * dx * step + Pi[3] * dy * step];
          doc.touch(n);
          doc.recordSet(n, before, "Nudge", { coalesce: "nudge" });
        }
      }, { coalesce: "nudge" });
      return true;
    }
    if (ev.key === "Escape") {
      if (app.selection.length) app.clearSelection();
      else if (app.state?.group) app.exitGroup();
      return true;
    }
    return false;
  }

  cancel() {
    if (this.items && this.mode && this.mode !== "marquee") {
      for (const it of this.items) {
        restoreTransform(it.n, it.snap);
        this.app.doc.touch(it.n);
      }
    }
    this.mode = null;
    this.marquee = null;
    this.items = null;
    this.guides = [];
    this.app.requestRender();
    this.app.requestOverlay();
  }

  // ------------------------------------------------------------------ overlay

  overlay(ctx) {
    const app = this.app;
    const view = app.view;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--of-accent").trim() || "#8b7cf6";
    // snap guides
    if (this.guides.length) {
      ctx.save();
      ctx.strokeStyle = "#ff4fa3";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const g of this.guides) {
        if (g.axis === "x") {
          const x = Math.round(view.toScreen(app.page.x + g.v, 0)[0]) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, view.h);
        } else {
          const y = Math.round(view.toScreen(0, app.page.y + g.v)[1]) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(view.w, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    // hover outline
    if (this.hoverNode && !app.isSelected(this.hoverNode) && !this.mode) this.#outline(ctx, this.hoverNode, accent, 1.5);
    // marquee
    if (this.marquee) {
      const m = this.marquee;
      const [x0, y0] = app.pageToScreen(m.x0, m.y0);
      const [x1, y1] = app.pageToScreen(m.x1, m.y1);
      ctx.save();
      ctx.fillStyle = "rgba(139,124,246,0.12)";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
    }
    // handles
    const fr = this.frame();
    if (!fr || this.mode === "marquee") return;
    const pts = this.handlePoints(fr);
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of [["nw", "ne"], ["ne", "se"], ["se", "sw"], ["sw", "nw"]]) {
      ctx.moveTo(Math.round(pts[a][0]) + 0.5, Math.round(pts[a][1]) + 0.5);
      ctx.lineTo(Math.round(pts[b][0]) + 0.5, Math.round(pts[b][1]) + 0.5);
    }
    ctx.moveTo(pts.n[0], pts.n[1]);
    ctx.lineTo(pts.rot[0], pts.rot[1]);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    for (const id of Object.keys(HANDLES)) {
      const [x, y] = pts[id];
      ctx.beginPath();
      ctx.rect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(pts.rot[0], pts.rot[1], 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  #outline(ctx, n, color, width) {
    const b = localBounds(n);
    if (!b || !n._page) return;
    const W = worldMatrix(n);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach(([x, y], i) => {
      const [px, py] = apply(W, x, y);
      const [sx, sy] = this.app.pageToScreen(px, py, n._page);
      ctx[i ? "lineTo" : "moveTo"](sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
