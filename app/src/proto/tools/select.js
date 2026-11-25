// The Move tool of the Proto Studio (V, the default; docs/concepts/proto-studio.md §5.2): click and Shift-click
// selection, deep selection (Ctrl/Cmd), double-click to enter a frame or edit a text, marquee selection on the page and
// inside frames, moving with snapping, smart guides and distance labels (Shift keeps an axis, Alt duplicates),
// reordering inside auto layout with an insertion line, dropping into other frames, resize and rotate handles
// (Shift keeps the ratio or 15° steps, Alt resizes around the center; children follow their constraints), padding and
// gap handles of auto layout containers, and Alt-hover measurements. Every drag previews live (workspace.preview)
// and ends in ONE operation (one undo step).
import { normRect, unionRect, marqueeSelect, hitTest } from "../geometry.js";
import { toScreen } from "../camera.js";
import { roots as rootIds, indexOf } from "../../engine/proto/tree.js";
import { field, isContainer } from "../../engine/proto/schema.js";
import { t } from "../../i18n/index.js";
import * as M from "./math.js";
import { snapTargets, snapRect, edgesFor, distances } from "./snap.js";
import * as E from "./edit.js";
import { isMod, pickLayer, selectableGeo, containerAt, childBoxes, snapBoxes, inFlow, stageRect, badge, drawGuides, drawDistances, outline, lockedSet, fmtNum, GUIDE } from "./common.js";

const DRAG_START = 3; // stage pixels before a press becomes a drag
const SNAP_PX = 5;
const r2 = (v) => Math.round(v * 100) / 100;

export function createMoveTool(ws) {
  let st = null; // the running gesture
  let hot = null; // the handle under the pointer while idle
  let last = { t: 0, x: 0, y: 0 };
  let alt = false;

  const model = () => ws.model();
  const box = (id) => ws.box(id);
  const zoom = () => ws.view.camera.zoom;
  const editableSel = () => !ws.readOnly && ws.selection.length > 0 && !ws.selection.some((id) => lockedSet(model()).has(id));

  // ------------------------------------------------------------------------------------------- handles
  function handleAt(p) {
    if (!editableSel()) return null;
    const u = unionRect(ws.selection.map(box));
    if (!u) return null;
    const sr = stageRect(ws.view.camera, u);
    const single = ws.selection.length === 1;
    const h = M.hitHandle(sr, p.x, p.y, 5, { rotate: single, edges: sr.w > 14 || sr.h > 14 });
    if (!h) return null;
    if (h.startsWith("rot-")) return { kind: "rotate", handle: h };
    return { kind: "resize", handle: h };
  }

  /** The auto layout container whose padding and gap handles show (one selected flex or grid container). */
  function layoutTarget() {
    if (!editableSel() || ws.selection.length !== 1) return null;
    const id = ws.selection[0];
    const n = model().nodes[id];
    const L = field(n, "layout");
    if (!n || !isContainer(n.type) || (L?.type !== "flex" && L?.type !== "grid")) return null;
    const b = box(id);
    if (!b) return null;
    const pad = Array.isArray(L.pad) && L.pad.every((v) => typeof v === "number") ? L.pad : L.pad === undefined ? [0, 0, 0, 0] : null;
    return { id, n, L, b, pad };
  }

  function layoutHandleAt(w) {
    const T = layoutTarget();
    if (!T) return null;
    const z = zoom();
    const tol = 4 / z;
    const inR = (r, grow = 0) => w.x >= r.x - grow && w.x <= r.x + r.w + grow && w.y >= r.y - grow && w.y <= r.y + r.h + grow;
    if (!inR(T.b)) return null;
    if (T.pad)
      for (const ph of M.padHandles(T.b, T.pad, z)) {
        const thick = (ph.side === "left" || ph.side === "right" ? ph.area.w : ph.area.h) * z >= 6;
        if (inR(ph.grip, tol) || (thick && inR(ph.area))) return { kind: "pad", side: ph.index, T };
      }
    if (T.L.type === "flex" && !T.L.wrap && typeof (T.L.gap ?? 0) === "number") {
      const kids = flowKids(T.id);
      for (const gh of M.gapHandles(kids, T.L.dir || "row", z)) if (inR(gh.grip, tol) || ((T.L.dir === "column" ? gh.area.h : gh.area.w) * z >= 6 && inR(gh.area))) return { kind: "gap", T, index: gh.index };
    }
    return null;
  }

  const flowKids = (pid) => childBoxes(ws, pid).filter((e) => inFlow(model(), e.id));

  /** A top-level frame whose name label (drawn above it) is under the stage point. */
  function labelAt(p) {
    const cam = ws.view.camera;
    for (const id of [...ws.view.geo.rootIds()].reverse()) {
      const n = model().nodes[id];
      if (!n || n.type !== "frame" || lockedSet(model()).has(id)) continue;
      const r = stageRect(cam, box(id) || {});
      if (p.x >= r.x && p.x <= r.x + Math.min(r.w, 240) && p.y >= r.y - 18 && p.y < r.y) return id;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------- gestures
  function down({ e, stage: p, world: w }) {
    const now = performance.now();
    const dbl = now - last.t < 400 && Math.hypot(p.x - last.x, p.y - last.y) < 5;
    last = { t: now, x: p.x, y: p.y };
    if (e.button !== 0) return false;
    if (dbl && doubleClick(w)) {
      st = { mode: "none" };
      return true;
    }
    const h = handleAt(p);
    if (h) {
      beginTransform(h, w);
      return true;
    }
    const lh = layoutHandleAt(w);
    if (lh) {
      st = lh.kind === "pad" ? { mode: "pad", side: lh.side, T: lh.T, start: lh.T.pad.slice(), w0: w, op: null } : { mode: "gap", T: lh.T, start: lh.T.L.gap ?? 0, w0: w, op: null, index: lh.index };
      return true;
    }
    const label = labelAt(p);
    const id = label || pickLayer(ws, w, { deep: isMod(e) });
    if (!id) {
      startMarquee(e, w, null);
      return true;
    }
    if (e.shiftKey) {
      ws.select([id], { toggle: true });
      st = { mode: "none" };
      return true;
    }
    const n = model().nodes[id];
    const top = hitTest(selectableGeo(ws), w.x, w.y)[0];
    const background = !label && n && n.parent == null && isContainer(n.type) && top?.key === id && indexOf(model()).get(id).length > 0;
    const was = ws.selection.includes(id);
    if (background && !was && !isMod(e)) {
      st = { mode: "press-bg", id, p0: p, w0: w, e };
      return true;
    }
    if (!was) ws.select([id]);
    st = { mode: "press", id, was, p0: p, w0: w, alt: e.altKey };
    return true;
  }

  function doubleClick(w) {
    const sel = ws.selection;
    if (sel.length !== 1) return false;
    const n = model().nodes[sel[0]];
    const b = box(sel[0]);
    if (!n || !b || w.x < b.x || w.x > b.x + b.w || w.y < b.y || w.y > b.y + b.h) return false;
    if (n.type === "text" && !ws.readOnly && !lockedSet(model()).has(n.id)) {
      ws.editText(n.id);
      return true;
    }
    if (isContainer(n.type) && n.type !== "instance") {
      const child = pickLayer(ws, w, { context: n.id });
      if (child && child !== n.id) {
        ws.select([child]);
        return true;
      }
    }
    return false;
  }

  function startMarquee(e, w, scope) {
    const base = e.shiftKey ? ws.selection.slice() : [];
    if (!e.shiftKey) ws.clear();
    st = { mode: "marquee", x0: w.x, y0: w.y, base, scope, rect: null };
    ws.setMarquee(null);
  }

  function beginTransform(h, w) {
    const ids = rootIds(model(), ws.selection).filter((id) => box(id));
    const boxes = new Map(ids.map((id) => [id, { ...box(id) }]));
    const u = unionRect([...boxes.values()]);
    if (h.kind === "rotate") {
      const id = ids[0];
      const b = boxes.get(id);
      st = { mode: "rotate", id, c: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, w0: w, base: field(model().nodes[id], "rot") || 0, op: null, angle: 0 };
    } else st = { mode: "resize", handle: h.handle, ids, boxes, u, w0: w, op: null, guides: null, rect: u };
  }

  function beginMove() {
    const m = model();
    const moving = rootIds(m, ws.selection).filter((id) => m.nodes[id] && !lockedSet(m).has(id) && box(id));
    if (!moving.length) return (st = { mode: "none" });
    const boxes = new Map(moving.map((id) => [id, { ...box(id) }]));
    const parents = new Set(moving.map((id) => m.nodes[id].parent ?? null));
    const parent = parents.size === 1 ? [...parents][0] : undefined;
    const allFlow = parent != null && moving.every((id) => inFlow(m, id));
    const set = new Set(moving);
    st = { mode: allFlow && !st.alt ? "reorder" : "free", moving, set, boxes, u: unionRect([...boxes.values()]), parent, w0: st.w0, p0: st.p0, alt: st.alt, op: null, guides: null, dist: null, target: undefined, insert: null };
  }

  function move({ e, stage: p, world: w }) {
    if (!st) return;
    alt = e.altKey;
    switch (st.mode) {
      case "press":
        if (Math.hypot(p.x - st.p0.x, p.y - st.p0.y) < DRAG_START || ws.readOnly) return;
        beginMove();
        return move({ e, stage: p, world: w });
      case "press-bg":
        if (Math.hypot(p.x - st.p0.x, p.y - st.p0.y) < DRAG_START) return;
        startMarquee(st.e, st.w0, st.id);
        return move({ e, stage: p, world: w });
      case "marquee": {
        st.rect = normRect(st.x0, st.y0, w.x, w.y);
        const hits = marqueeSelect(selectableGeo(ws), st.rect, { scope: st.scope });
        ws.select([...st.base, ...hits.filter((id) => !st.base.includes(id))]);
        ws.setMarquee(st.rect);
        return;
      }
      case "free":
        return moveFree(e, w);
      case "reorder":
        return moveReorder(e, w);
      case "resize":
        return moveResize(e, w);
      case "rotate": {
        const deg = M.rotationAt(st.c, st.w0, w, st.base, { snap: e.shiftKey });
        st.angle = deg;
        st.op = E.setFields(model(), [st.id], { rot: deg });
        ws.preview(st.op);
        return;
      }
      case "pad": {
        const dx = w.x - st.w0.x;
        const dy = w.y - st.w0.y;
        const delta = [dy, -dx, -dy, dx][st.side];
        st.value = M.dragPad(st.start, st.side, delta, { all: e.altKey, mirror: e.shiftKey });
        st.op = E.setFields(model(), [st.T.id], { "layout.pad": st.value });
        ws.preview(st.op);
        return;
      }
      case "gap": {
        const d = (st.T.L.dir === "column" ? w.y - st.w0.y : w.x - st.w0.x) / 1;
        st.value = Math.max(0, Math.round(st.start + d));
        st.op = E.setFields(model(), [st.T.id], { "layout.gap": st.value });
        ws.preview(st.op);
        return;
      }
    }
  }

  function delta(e, w) {
    let dx = w.x - st.w0.x;
    let dy = w.y - st.w0.y;
    if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    return { dx, dy };
  }

  function moveFree(e, w) {
    const m = model();
    let { dx, dy } = delta(e, w);
    const u = st.u;
    // pixel grid, then snapping to siblings and the parent
    dx = Math.round(u.x + dx) - u.x;
    dy = Math.round(u.y + dy) - u.y;
    const parent = st.parent === undefined ? null : st.parent;
    const targets = snapTargets(snapBoxes(ws, parent, st.set));
    const moved = { x: u.x + dx, y: u.y + dy, w: u.w, h: u.h };
    const s = e.ctrlKey || e.metaKey ? { dx: 0, dy: 0, guides: [] } : snapRect(moved, targets, SNAP_PX / zoom(), e.shiftKey ? { x: dx ? ["start", "center", "end"] : [], y: dy ? ["start", "center", "end"] : [] } : undefined);
    dx += s.dx;
    dy += s.dy;
    st.dx = dx;
    st.dy = dy;
    st.guides = s.guides;
    const rect = { x: u.x + dx, y: u.y + dy, w: u.w, h: u.h };
    st.dist = distances(rect, snapBoxes(ws, parent, st.set).filter((b) => parent == null || b !== ws.view.geo.get(parent)), parent != null ? box(parent) : null);
    // where it would land: the container under the pointer
    const target = containerAt(ws, w, st.set);
    st.target = target;
    const lt = E.layoutOf(m, target);
    st.insert = target != null && (lt === "flex" || lt === "grid") ? M.insertionAt(flowKids(target).filter((b) => !st.set.has(b.id)), w, field(m.nodes[target], "layout").dir || "row") : null;
    // back inside the auto layout it came from: reorder again
    if (!st.alt && st.parent != null && target === st.parent && st.moving.every((id) => inFlow(m, id))) {
      st.mode = "reorder";
      ws.preview(null);
      return moveReorder(e, w);
    }
    const ops = [];
    if (st.alt) ops.push({ op: "node.duplicate", ids: st.moving, offset: [r2(dx), r2(dy)] });
    else
      for (const id of st.moving) {
        const n = m.nodes[id];
        if (inFlow(m, id)) {
          // a flow child dragged out floats where the pointer is until it lands
          const pb = box(n.parent) || { x: 0, y: 0 };
          const b = st.boxes.get(id);
          ops.push({ op: "node.update", id, set: { pos: "abs", x: r2(b.x + dx - pb.x), y: r2(b.y + dy - pb.y) } });
        } else ops.push(E.moveBy(m, [id], dx, dy));
      }
    st.op = E.batch(ops);
    ws.preview(st.op);
  }

  function moveReorder(e, w) {
    const m = model();
    const pb = box(st.parent);
    const { dx, dy } = delta(e, w);
    st.dx = dx;
    st.dy = dy;
    const out = pb && (w.x < pb.x - 2 || w.x > pb.x + pb.w + 2 || w.y < pb.y - 2 || w.y > pb.y + pb.h + 2);
    if (out) {
      st.mode = "free";
      return moveFree(e, w);
    }
    const L = field(m.nodes[st.parent], "layout");
    st.insert = M.insertionAt(flowKids(st.parent).filter((b) => !st.set.has(b.id)), w, L.type === "grid" ? "row" : L.dir || "row");
    st.target = st.parent;
    st.op = null;
  }

  function moveResize(e, w) {
    const m = model();
    const dx = w.x - st.w0.x;
    const dy = w.y - st.w0.y;
    let r = M.resizeRect(st.u, st.handle, dx, dy, { ratio: e.shiftKey, center: e.altKey });
    // snap the moving edges, then whole pixels
    const first = st.ids[0];
    const parent = m.nodes[first]?.parent ?? null;
    const edges = edgesFor(st.handle);
    const s = e.ctrlKey || e.metaKey || e.shiftKey ? { dx: 0, dy: 0, guides: [] } : snapRect(r, snapTargets(snapBoxes(ws, parent, new Set(st.ids))), SNAP_PX / zoom(), edges);
    if (edges.x[0] === "start") (r.x += s.dx), (r.w -= s.dx);
    else if (edges.x[0] === "end") r.w += s.dx;
    if (edges.y[0] === "start") (r.y += s.dy), (r.h -= s.dy);
    else if (edges.y[0] === "end") r.h += s.dy;
    const x1 = Math.round(r.x + r.w);
    const y1 = Math.round(r.y + r.h);
    r = { x: Math.round(r.x), y: Math.round(r.y) };
    r.w = Math.max(1, x1 - r.x);
    r.h = Math.max(1, y1 - r.y);
    st.rect = r;
    st.guides = s.guides;
    const ops = st.ids.map((id) => {
      const b0 = st.boxes.get(id);
      const nb = st.ids.length === 1 ? r : M.scaleInto(b0, st.u, r);
      const n = m.nodes[id];
      const pb = n.parent != null ? box(n.parent) || { x: 0, y: 0 } : { x: 0, y: 0 };
      // the stored position is the unrotated top-left; rotated layers keep their rotation
      return E.resizeTo(m, id, { x: nb.x - pb.x, y: nb.y - pb.y, w: nb.w, h: nb.h }, { from: { w: b0.w, h: b0.h }, measured: (cid) => box(cid) });
    });
    st.op = E.batch(ops);
    ws.preview(st.op);
  }

  function up({ e }) {
    const s = st;
    st = null;
    if (!s) return;
    switch (s.mode) {
      case "press":
        // a click on a layer of a multiple selection selects just that layer
        if (s.was && ws.selection.length > 1 && !e.shiftKey) ws.select([s.id]);
        return;
      case "press-bg":
        ws.select([s.id]);
        return;
      case "marquee":
        ws.setMarquee(null);
        return;
      case "free":
        return dropFree(s);
      case "reorder": {
        ws.preview(null);
        if (s.insert) ws.apply(E.flowMove(model(), s.moving, s.parent, s.insert.index), t("Reorder layers"));
        return;
      }
      case "resize":
        ws.preview(null);
        return void ws.apply(s.op, t("Resize"));
      case "rotate":
        ws.preview(null);
        return void ws.apply(s.op, t("Rotate"));
      case "pad":
        ws.preview(null);
        return void ws.apply(s.op, t("Padding"));
      case "gap":
        ws.preview(null);
        return void ws.apply(s.op, t("Gap"));
    }
  }

  function dropFree(s) {
    const m = model();
    ws.preview(null);
    if (s.dx === undefined) return;
    if (s.alt) {
      const res = ws.apply(s.op, t("Duplicate layers"));
      if (res?.map) ws.select(s.moving.map((id) => res.map[id]).filter(Boolean));
      return;
    }
    const target = s.target === undefined ? null : s.target;
    const sameParent = s.moving.every((id) => (m.nodes[id].parent ?? null) === target);
    if (sameParent && !s.moving.some((id) => inFlow(m, id))) return void ws.apply(s.op, t("Move layers"));
    // into another container (or back to the page): keep the place on the canvas
    const moved = (id) => {
      const b = s.boxes.get(id);
      return b ? { x: b.x + s.dx, y: b.y + s.dy, w: b.w, h: b.h } : box(id);
    };
    const where = s.insert && target != null ? { index: s.insert.index } : {};
    const op = E.reparent(m, s.moving, target, { ...where, page: ws.page }, moved);
    const res = ws.apply(op, t("Move layers"));
    if (res) ws.select(s.moving);
  }

  // ------------------------------------------------------------------------------------------- idle
  function hover({ e, stage: p, world: w }) {
    alt = e.altKey;
    const h = handleAt(p);
    const lh = h ? null : layoutHandleAt(w);
    hot = h || lh;
    const rot = ws.selection.length === 1 ? field(model().nodes[ws.selection[0]], "rot") || 0 : 0;
    ws.setCursor(h ? M.cursorFor(h.handle, rot) : lh ? (lh.kind === "gap" ? (lh.T.L.dir === "column" ? "row-resize" : "col-resize") : lh.side % 2 ? "col-resize" : "row-resize") : "");
    ws.setHover(h || lh ? null : pickLayer(ws, w, { deep: isMod(e) }));
    ws.requestDraw();
  }

  function key(e) {
    if (e.key === "Escape" && st && st.mode !== "none") {
      ws.preview(null);
      ws.setMarquee(null);
      st = null;
      ws.requestDraw();
      return true;
    }
    if (e.key === "Alt" || e.altKey !== alt) {
      alt = e.altKey || e.type === "keydown";
      ws.requestDraw();
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------- overlay
  function draw(ctx, s) {
    const cam = s.cam;
    const accent = s.accent || "#0d99ff";
    const mode = st?.mode;
    // edge handles of a single selection (the overlay draws the corners)
    if (!mode || mode === "none" || mode === "press") {
      if (ws.selection.length && editableSel()) {
        const u = unionRect(ws.selection.map(box));
        if (u) {
          const r = stageRect(cam, u);
          if (r.w > 24 && r.h > 24) {
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1;
            for (const hp of M.handlePoints(r).filter((q) => q.id.length === 1)) {
              ctx.fillRect(Math.round(hp.x) - 3, Math.round(hp.y) - 3, 7, 7);
              ctx.strokeRect(Math.round(hp.x) - 2.5, Math.round(hp.y) - 2.5, 6, 6);
            }
          }
        }
      }
      // padding and gap handles of an auto layout container
      const T = layoutTarget();
      if (T && !mode) drawLayoutHandles(ctx, cam, T, hot);
      // Alt: measure from the selection to the layer under the pointer
      if (alt && ws.selection.length && ws.hover && !ws.selection.includes(ws.hover)) {
        const a = unionRect(ws.selection.map(box));
        const b = box(ws.hover);
        if (a && b) {
          const inside = a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
          drawDistances(ctx, cam, inside ? distances(a, [], b) : distances(a, [b]));
        }
      }
      return;
    }
    if (mode === "free" || mode === "reorder") {
      if (mode === "free") {
        drawGuides(ctx, cam, st.guides);
        drawDistances(ctx, cam, st.dist);
        if (st.target != null && st.target !== st.parent) outline(ctx, cam, box(st.target) || { x: 0, y: 0, w: 0, h: 0 }, accent, { width: 2 });
      } else {
        // the dragged layers follow the pointer as outlines
        for (const b of st.boxes.values()) outline(ctx, cam, { x: b.x + (st.dx || 0), y: b.y + (st.dy || 0), w: b.w, h: b.h }, accent, { dash: true });
      }
      if (st.insert?.line) {
        const l = stageRect(cam, st.insert.line);
        ctx.fillStyle = accent;
        if (st.insert.line.w === 0) ctx.fillRect(Math.round(l.x) - 1, l.y, 3, Math.max(4, l.h));
        else ctx.fillRect(l.x, Math.round(l.y) - 1, Math.max(4, l.w), 3);
      }
      return;
    }
    if (mode === "resize") {
      drawGuides(ctx, cam, st.guides);
      return;
    }
    if (mode === "rotate") {
      const c = toScreen(cam, st.c.x, st.c.y);
      badge(ctx, c.x, c.y, `${fmtNum(st.angle)}°`, accent);
      return;
    }
    if (mode === "pad" || mode === "gap") {
      const T = layoutTarget();
      if (T) drawLayoutHandles(ctx, cam, { ...T, pad: st.mode === "pad" && st.value ? st.value : T.pad, L: st.mode === "gap" && st.value != null ? { ...T.L, gap: st.value } : T.L }, st.mode === "pad" ? { kind: "pad", side: st.side } : { kind: "gap", index: st.index }, true);
    }
  }

  function drawLayoutHandles(ctx, cam, T, active, dragging = false) {
    const z = cam.zoom;
    const fill = "rgba(244,63,94,0.14)";
    if (T.pad) {
      for (const ph of M.padHandles(T.b, T.pad, z)) {
        const on = active?.kind === "pad" && (active.side === ph.index || (dragging && alt));
        if (on) {
          const a = stageRect(cam, ph.area);
          ctx.fillStyle = fill;
          ctx.fillRect(a.x, a.y, a.w, a.h);
          if (dragging || on) badge(ctx, a.x + a.w / 2, a.y + a.h / 2, fmtNum(T.pad[ph.index]));
        }
        const g = stageRect(cam, ph.grip);
        ctx.fillStyle = on ? GUIDE : "rgba(244,63,94,0.55)";
        ctx.fillRect(g.x, g.y, g.w, g.h);
      }
    }
    if (T.L.type === "flex" && !T.L.wrap) {
      for (const gh of M.gapHandles(flowKids(T.id), T.L.dir || "row", z)) {
        const on = active?.kind === "gap";
        if (on) {
          const a = stageRect(cam, gh.area);
          ctx.fillStyle = fill;
          ctx.fillRect(a.x, a.y, a.w, a.h);
          if (active.index === gh.index) badge(ctx, a.x + a.w / 2, a.y + a.h / 2, fmtNum(T.L.gap ?? 0));
        }
        const g = stageRect(cam, gh.grip);
        ctx.fillStyle = on ? GUIDE : "rgba(244,63,94,0.55)";
        ctx.fillRect(g.x, g.y, g.w, g.h);
      }
    }
  }

  return {
    id: "move",
    cursor: "",
    down,
    move,
    up,
    hover,
    key,
    draw,
    get busy() {
      return !!st && st.mode !== "none";
    },
    cancel() {
      if (st) ws.preview(null);
      st = null;
    },
  };
}
