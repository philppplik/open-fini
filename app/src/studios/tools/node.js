// Node tool: edit anchors, Bézier handles and segments of curves.
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { invert, apply, det, rectFromPoints } from "../../core/math.js";
import { worldMatrix, isShape } from "../../core/nodes.js";
import { clone } from "../../core/util.js";
import { convertToCurves } from "../../core/ops.js";
import { pick } from "../../engine/hit.js";
import { nearestOnPath, insertNodeAt, deleteNode, setNodeType, moveNode, moveHandle, breakAt, joinSubpaths, segmentPoints, makeNode } from "../../engine/vector/path.js";
import { iconButton } from "../../ui/controls.js";

const ACCENT = "#8b7cf6";
const key = (s, n) => `${s}:${n}`;

export class NodeTool extends Tool {
  static id = "node";
  static label = "Node";
  static icon = "cursor-fill";
  static shortcut = "A";
  static studios = ["vector", "layout"];

  cursor = "default";
  target = null;
  sel = new Set();
  mode = null;

  // ------------------------------------------------------------------ target management

  activate() {
    this.refresh();
  }

  refresh() {
    const app = this.app;
    const s = app.selection;
    let t = s.length === 1 ? s[0] : null;
    if (t && isShape(t) && t.type !== "path") {
      convertToCurves(app, [t]);
    }
    if (t && t.type !== "path") t = null;
    if (t !== this.target) {
      this.target = t;
      this.sel = new Set();
      app.emit("contextbar");
    }
    app.requestOverlay();
  }

  deactivate() {
    this.target = null;
    this.sel.clear();
  }

  get path() {
    return this.target?.path;
  }
  get W() {
    return worldMatrix(this.target);
  }

  toScreen(x, y) {
    const [px, py] = apply(this.W, x, y);
    return this.app.pageToScreen(px, py, this.target._page);
  }
  toLocal(e) {
    const inv = invert(this.W);
    return apply(inv, e.x, e.y);
  }
  /** Tolerance in local units for `px` screen pixels. */
  tol(px) {
    const s = Math.sqrt(Math.abs(det(this.W))) || 1;
    return px / (this.app.view.zoom * s);
  }

  // ------------------------------------------------------------------ hit testing

  hitHandle(e) {
    const p = this.path;
    const r = 6;
    for (const k of this.sel) {
      const [si, ni] = k.split(":").map(Number);
      const n = p.subpaths[si]?.nodes[ni];
      if (!n) continue;
      // also test neighbors' facing handles (shown for context)
      for (const which of ["in", "out"]) {
        const hx = which === "in" ? n.ix : n.ox;
        const hy = which === "in" ? n.iy : n.oy;
        if (hx == null) continue;
        const [sx, sy] = this.toScreen(hx, hy);
        if (Math.hypot(sx - e.sx, sy - e.sy) <= r) return { si, ni, which };
      }
    }
    return null;
  }

  hitAnchor(e) {
    const p = this.path;
    let best = null;
    let bd = 8;
    p.subpaths.forEach((s, si) =>
      s.nodes.forEach((n, ni) => {
        const [sx, sy] = this.toScreen(n.x, n.y);
        const d = Math.hypot(sx - e.sx, sy - e.sy);
        if (d <= bd) {
          bd = d;
          best = { si, ni };
        }
      }),
    );
    return best;
  }

  hitSegment(e) {
    const [lx, ly] = this.toLocal(e);
    const r = nearestOnPath(this.path, lx, ly);
    return r && r.d <= this.tol(6) ? r : null;
  }

  // ------------------------------------------------------------------ events

  hover(e) {
    if (!this.target) return;
    let c = "default";
    if (this.hitHandle(e)) c = "crosshair";
    else if (this.hitAnchor(e)) c = "move";
    else if (this.hitSegment(e)) c = "copy";
    this.app.cv?.setCursor(c);
  }

  pointerDown(e) {
    const app = this.app;
    if (!this.target) {
      // pick a path-like object to edit
      const hit = pick(app.context, e.x, e.y, 5 / app.view.zoom, { deep: true });
      if (hit) {
        app.select([hit]);
        this.refresh();
      }
      return;
    }
    const doc = app.doc;
    this.before = doc.snapshot(this.target, ["path"]);
    const hh = this.hitHandle(e);
    if (hh) {
      this.mode = "handle";
      this.drag = hh;
      return;
    }
    const a = this.hitAnchor(e);
    if (a) {
      const k = key(a.si, a.ni);
      if (e.shift) {
        if (this.sel.has(k)) this.sel.delete(k);
        else this.sel.add(k);
      } else if (!this.sel.has(k)) this.sel = new Set([k]);
      this.mode = "nodes";
      this.start = this.toLocal(e);
      this.snapNodes = this.#captureSelected();
      app.emit("contextbar");
      app.requestOverlay();
      return;
    }
    const sg = this.hitSegment(e);
    if (sg) {
      this.mode = "segment";
      this.seg = sg;
      this.start = this.toLocal(e);
      this.segSnap = clone(this.path);
      return;
    }
    // empty: marquee select nodes
    this.mode = "marquee";
    this.marquee = { x0: e.sx, y0: e.sy, x1: e.sx, y1: e.sy, add: e.shift };
    this.baseSel = e.shift ? new Set(this.sel) : new Set();
    if (!e.shift) this.sel = new Set();
    app.emit("contextbar");
    app.requestOverlay();
  }

  #captureSelected() {
    const out = [];
    for (const k of this.sel) {
      const [si, ni] = k.split(":").map(Number);
      const n = this.path.subpaths[si]?.nodes[ni];
      if (n) out.push({ si, ni, n: { ...n } });
    }
    return out;
  }

  pointerMove(e) {
    const app = this.app;
    if (!this.target) return;
    if (this.mode === "handle") {
      const [lx, ly] = this.toLocal(e);
      const n = this.path.subpaths[this.drag.si].nodes[this.drag.ni];
      moveHandle(n, this.drag.which, lx, ly, { breakSymmetry: e.alt });
      if (e.alt) n.t = "cusp";
      this.#changed();
    } else if (this.mode === "nodes") {
      const [lx, ly] = this.toLocal(e);
      const dx = lx - this.start[0];
      const dy = ly - this.start[1];
      for (const it of this.snapNodes) {
        const n = this.path.subpaths[it.si].nodes[it.ni];
        Object.assign(n, it.n);
        moveNode(n, dx, dy);
      }
      this.#changed();
    } else if (this.mode === "segment") {
      const [lx, ly] = this.toLocal(e);
      const d = [lx - this.start[0], ly - this.start[1]];
      this.path.subpaths = clone(this.segSnap).subpaths;
      const s = this.path.subpaths[this.seg.sub];
      const a = s.nodes[this.seg.seg];
      const b = s.nodes[(this.seg.seg + 1) % s.nodes.length];
      const [p0, p1, p2] = segmentPoints(s, this.seg.seg);
      const t = Math.min(0.85, Math.max(0.15, this.seg.t));
      const k = 1 / (3 * t * (1 - t));
      a.ox = p1[0] + d[0] * k;
      a.oy = p1[1] + d[1] * k;
      b.ix = p2[0] + d[0] * k;
      b.iy = p2[1] + d[1] * k;
      if (a.ox === p0[0] && a.oy === p0[1]) a.ox = a.oy = null;
      this.#changed();
    } else if (this.mode === "marquee") {
      const m = this.marquee;
      m.x1 = e.sx;
      m.y1 = e.sy;
      const r = rectFromPoints(m.x0, m.y0, m.x1, m.y1);
      const next = new Set(this.baseSel);
      this.path.subpaths.forEach((s, si) =>
        s.nodes.forEach((n, ni) => {
          const [sx, sy] = this.toScreen(n.x, n.y);
          if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) next.add(key(si, ni));
        }),
      );
      this.sel = next;
      app.requestOverlay();
    }
  }

  #changed() {
    this.app.doc.touch(this.target);
    this.app.requestRender();
    this.app.requestOverlay();
  }

  pointerUp() {
    const app = this.app;
    const mode = this.mode;
    this.mode = null;
    this.marquee = null;
    if (mode && mode !== "marquee" && this.before) {
      app.doc.recordSet(this.target, this.before, mode === "handle" ? "Move Handle" : mode === "segment" ? "Reshape Curve" : "Move Nodes");
    }
    this.before = null;
    app.requestOverlay();
    app.emit("contextbar");
  }

  doubleClick(e) {
    if (!this.target) return;
    const app = this.app;
    const doc = app.doc;
    const a = this.hitAnchor(e);
    if (a) {
      const before = doc.snapshot(this.target, ["path"]);
      const s = this.path.subpaths[a.si];
      const n = s.nodes[a.ni];
      if (n.ix != null || n.ox != null) setNodeType(s, a.ni, "sharp");
      else setNodeType(s, a.ni, "smooth");
      doc.touch(this.target);
      doc.recordSet(this.target, before, "Toggle Node Type");
      app.requestOverlay();
      return;
    }
    const sg = this.hitSegment(e);
    if (sg) {
      const before = doc.snapshot(this.target, ["path"]);
      const idx = insertNodeAt(this.path, sg.sub, sg.seg, sg.t);
      this.sel = new Set([key(sg.sub, idx)]);
      doc.touch(this.target);
      doc.recordSet(this.target, before, "Insert Node");
      app.requestOverlay();
      app.emit("contextbar");
    }
  }

  // ------------------------------------------------------------------ commands on selected nodes

  #edit(label, fn) {
    if (!this.target) return;
    const doc = this.app.doc;
    const before = doc.snapshot(this.target, ["path"]);
    fn(this.path);
    doc.touch(this.target);
    doc.recordSet(this.target, before, label);
    this.app.requestOverlay();
    this.app.emit("contextbar");
  }

  selectedIdx() {
    return [...this.sel].map((k) => k.split(":").map(Number)).sort((a, b) => (a[0] === b[0] ? b[1] - a[1] : b[0] - a[0]));
  }

  setType(type) {
    this.#edit("Node Type", (p) => {
      for (const [si, ni] of this.selectedIdx()) setNodeType(p.subpaths[si], ni, type);
    });
  }

  deleteSelected() {
    if (!this.sel.size) return false;
    this.#edit("Delete Nodes", (p) => {
      for (const [si, ni] of this.selectedIdx()) if (p.subpaths[si]) deleteNode(p, si, ni);
    });
    this.sel = new Set();
    if (!this.path.subpaths.length) this.app.run("edit.delete");
    return true;
  }

  breakSelected() {
    this.#edit("Break Curve", (p) => {
      for (const [si, ni] of this.selectedIdx()) {
        const s = p.subpaths[si];
        if (!s) continue;
        const parts = breakAt(s, ni);
        p.subpaths.splice(si, 1, ...parts);
      }
    });
    this.sel = new Set();
  }

  closeOrJoin() {
    this.#edit("Join Nodes", (p) => {
      const ends = [];
      for (const [si, ni] of this.selectedIdx()) {
        const s = p.subpaths[si];
        if (s && !s.closed && (ni === 0 || ni === s.nodes.length - 1)) ends.push([si, ni]);
      }
      if (ends.length === 2 && ends[0][0] === ends[1][0]) {
        const s = p.subpaths[ends[0][0]];
        s.closed = true;
      } else if (ends.length === 2) {
        const [a, b] = ends.sort((x, y) => x[0] - y[0]);
        const sa = p.subpaths[a[0]];
        const sb = p.subpaths[b[0]];
        if (a[1] === 0) sa.nodes.reverse().forEach((n) => ([n.ix, n.ox] = [n.ox, n.ix], [n.iy, n.oy] = [n.oy, n.iy]));
        if (b[1] !== 0) sb.nodes.reverse().forEach((n) => ([n.ix, n.ox] = [n.ox, n.ix], [n.iy, n.oy] = [n.oy, n.iy]));
        const joined = joinSubpaths(sa, sb);
        p.subpaths.splice(b[0], 1);
        p.subpaths.splice(a[0], 1, joined);
      } else if (!ends.length) {
        // nothing selected: close every open subpath
        for (const s of p.subpaths) if (!s.closed && s.nodes.length > 2) s.closed = true;
      }
    });
  }

  keyDown(ev) {
    if ((ev.key === "Delete" || ev.key === "Backspace") && this.sel.size) {
      this.deleteSelected();
      return true;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[ev.key] && this.sel.size && this.target) {
      const [dx, dy] = arrows[ev.key];
      const step = (ev.shiftKey ? 10 : 1) * this.tol(1);
      this.#edit("Nudge Nodes", (p) => {
        for (const [si, ni] of this.selectedIdx()) moveNode(p.subpaths[si].nodes[ni], dx * step, dy * step);
      });
      return true;
    }
    if (ev.key === "Escape") {
      if (this.sel.size) {
        this.sel = new Set();
        this.app.requestOverlay();
      } else this.app.setTool("move");
      return true;
    }
    return false;
  }

  contextBar() {
    const t = this.target;
    if (!t) return h("span.of-hint", "Select a curve or shape to edit its nodes.");
    return h(
      "div.of-row.of-inline",
      iconButton({ icon: "node-sharp", lib: "of", label: "Sharp node", onClick: () => this.setType("sharp") }),
      iconButton({ icon: "node-smooth", lib: "of", label: "Smooth node", onClick: () => this.setType("smooth") }),
      iconButton({ icon: "node-symmetric", lib: "of", label: "Symmetric node", onClick: () => this.setType("symmetric") }),
      h("span.of-sep"),
      iconButton({ icon: "node-join", lib: "of", label: "Close / join nodes", onClick: () => this.closeOrJoin() }),
      iconButton({ icon: "node-break", lib: "of", label: "Break curve at node", onClick: () => this.breakSelected() }),
      iconButton({ icon: "trash3", label: "Delete nodes", onClick: () => this.deleteSelected() }),
    );
  }

  // ------------------------------------------------------------------ overlay

  overlay(ctx) {
    if (!this.target) return;
    const p = this.path;
    ctx.save();
    // outline
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const s of p.subpaths) {
      const n = s.nodes;
      if (!n.length) continue;
      const [x0, y0] = this.toScreen(n[0].x, n[0].y);
      ctx.moveTo(x0, y0);
      const cnt = s.closed ? n.length : n.length - 1;
      for (let i = 0; i < cnt; i++) {
        const a = n[i];
        const b = n[(i + 1) % n.length];
        const [bx, by] = this.toScreen(b.x, b.y);
        if (a.ox != null || b.ix != null) {
          const c1 = this.toScreen(a.ox ?? a.x, a.oy ?? a.y);
          const c2 = this.toScreen(b.ix ?? b.x, b.iy ?? b.y);
          ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], bx, by);
        } else ctx.lineTo(bx, by);
      }
      if (s.closed) ctx.closePath();
    }
    ctx.stroke();
    // handles of selected nodes (and the facing handles of their neighbors)
    ctx.lineWidth = 1;
    const showHandles = new Set(this.sel);
    for (const k of this.sel) {
      const [si, ni] = k.split(":").map(Number);
      const s = p.subpaths[si];
      if (!s) continue;
      for (const d of [-1, 1]) {
        const j = ni + d;
        if (s.closed) showHandles.add(key(si, (j + s.nodes.length) % s.nodes.length));
        else if (j >= 0 && j < s.nodes.length) showHandles.add(key(si, j));
      }
    }
    for (const k of showHandles) {
      const [si, ni] = k.split(":").map(Number);
      const n = p.subpaths[si]?.nodes[ni];
      if (!n) continue;
      const [x, y] = this.toScreen(n.x, n.y);
      for (const [hx, hy] of [[n.ix, n.iy], [n.ox, n.oy]]) {
        if (hx == null) continue;
        const [px, py] = this.toScreen(hx, hy);
        ctx.strokeStyle = ACCENT;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, 7);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.stroke();
      }
    }
    // anchors
    p.subpaths.forEach((s, si) =>
      s.nodes.forEach((n, ni) => {
        const [x, y] = this.toScreen(n.x, n.y);
        const selected = this.sel.has(key(si, ni));
        ctx.fillStyle = selected ? ACCENT : "#ffffff";
        ctx.strokeStyle = selected ? "#ffffff" : ACCENT;
        ctx.lineWidth = 1.5;
        const smooth = n.ix != null || n.ox != null;
        ctx.beginPath();
        if (smooth) ctx.arc(x, y, 4.5, 0, 7);
        else ctx.rect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }),
    );
    if (this.marquee) {
      const m = this.marquee;
      ctx.fillStyle = "rgba(139,124,246,0.12)";
      ctx.strokeStyle = ACCENT;
      ctx.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeRect(Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
    ctx.restore();
  }
}

export { makeNode };
