// Comments on Proto designs (docs/proto-studio.md ▸ Comments; concept §13): the comment anchor kind "proto"
// (collab/anchors.js ▸ protoAnchor: page, point in world coordinates, the layer under it and the point relative to the
// layer's box), the Comment tool (C: click a layer or the page to write a comment there), and the numbered pins over
// the canvas that follow their layers, open their thread on click, and can be dragged to another place (author or
// host). Threads are the app's comments (ui/collab/comments-host.js): saved in the document, shared with a room when
// there is one, listed in the Comments panel. The comments host loads lazily on first use.
//
//   createCommentLayer(ws) → { anchorAt(world, deep?), currentAnchor(), reveal(anchor), refresh(), destroy() }
//   createCommentTool(ws) → tool                    (tools/index.js)
import { h } from "../core/util.js";
import { protoAnchor, pinNumbers, resolvePin } from "../collab/anchors.js";
import { filterThreads } from "../collab/comments.js";
import { toScreen } from "./camera.js";

const host = (app) => import("../ui/collab/comments-host.js").then((m) => m.getComments(app));

export function createCommentLayer(ws, canvasHost) {
  const app = ws.app;
  const layer = h("div.of-proto__pins", { "aria-label": "Comments" });
  canvasHost.append(layer);
  let c = null; // the comments host
  let ui = null; // the inline comment UI
  let scheduled = false;
  const offs = [];

  const ensure = () => {
    if (c) return Promise.resolve(c);
    return host(app).then(async (x) => {
      if (!c) {
        c = x;
        const onChange = () => refresh();
        c.events.addEventListener("change", onChange);
        offs.push(() => c.events.removeEventListener("change", onChange));
      }
      ui ||= await c.commentUI();
      refresh();
      return c;
    });
  };
  // threads already in the document show at once; an empty document loads the comments code only when needed
  if (ws.doc.comments?.length) ensure();

  /** The anchor of a point in world coordinates: the (deepest, with `deep`) layer under it, or the page. */
  function anchorAt(w, deep = true) {
    const s = ws.toStage(w.x, w.y);
    const id = ws.pickAt(s.x, s.y, { deep });
    const m = ws.model();
    const node = id ? m.nodes[id] : null;
    return protoAnchor({ page: ws.page, node, bounds: node ? ws.box(id) : null, point: w });
  }

  /** The anchor for "Add comment" without a click: the top right corner of the selected layer, or the page. */
  function currentAnchor() {
    const id = ws.selection[0];
    const m = ws.model();
    const b = id ? ws.box(id) : null;
    if (id && b) return protoAnchor({ page: ws.page, node: m.nodes[id], bounds: b, point: { x: b.x + b.w, y: b.y } });
    const p = m.pages[ws.page];
    const vis = ws.toWorld(40, 40);
    return { ...protoAnchor({ page: ws.page, point: vis }), ...(p?.name ? { quote: p.name.slice(0, 200) } : {}) };
  }

  /** Opens the composer for a point (stage coordinates of the click and the client point for the popover). */
  async function compose(w, client) {
    const host = await ensure();
    if (!host || !ui) return;
    ui.compose({ anchor: anchorAt(w), at: client });
  }

  /** Shows a thread's place: its page, the layer selected and in view. */
  function reveal(a) {
    if (a.page && ws.model().pages[a.page] && ws.page !== a.page) ws.setPage(a.page);
    const n = a.node ? ws.model().nodes[a.node] : null;
    if (n) {
      ws.select([n.id]);
      requestAnimationFrame(() => ws.zoomToSelection());
    } else if (a.pin) ws.reveal({ x: a.pin.x - 40, y: a.pin.y - 40, w: 80, h: 80 });
    refresh();
  }

  function refresh() {
    // comments added elsewhere (the Comments panel, the assistant, a room) load the comments code on the next redraw
    if (!c) {
      if (ws.doc.comments?.length) ensure();
      return;
    }
    if (scheduled) return;
    scheduled = true;
    // two frames: the renderer patches and measures in the frame after a change; the pins follow the new boxes
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        scheduled = false;
        place();
      }),
    );
  }

  function place() {
    if (!c || !ui || !layer.isConnected) return void layer.replaceChildren();
    const doc = ws.doc;
    const all = c.threads(doc);
    const nums = pinNumbers(all);
    const cam = ws.view.camera;
    const want = [];
    if (ui.pinsVisible())
      for (const th of filterThreads(all, { status: "open" })) {
        const a = th.anchor;
        if (a.kind !== "proto") continue;
        const n = a.node ? ws.model().nodes[a.node] : null;
        // a deleted layer's comment stays on the page where it was
        const page = n ? n.page : a.page;
        if (page !== ws.page) continue;
        const pt = resolvePin(a, { bounds: n ? ws.box(n.id) : null });
        if (!pt) continue;
        const s = toScreen(cam, pt.x, pt.y);
        if (s.x < -30 || s.y < -30 || s.x > ws.view.size.w + 30 || s.y > ws.view.size.h + 30) continue;
        want.push({ th, s, n: nums.get(th.id) });
      }
    const kids = [...layer.children];
    want.forEach(({ th, s, n }, i) => {
      let b = kids[i];
      if (!b) {
        b = ui.makePin(th, n);
        b.addEventListener("pointerdown", (e) => drag(e, b));
        layer.append(b);
      }
      ui.refreshPin(b, th, n);
      if (!b.classList.contains("is-dragging")) b.style.transform = `translate(${Math.round(s.x) - 11}px, ${Math.round(s.y) - 28}px)`;
    });
    for (let i = want.length; i < kids.length; i++) kids[i].remove();
  }

  /** Dragging a pin re-anchors its thread to the layer (or page point) where it is dropped. */
  function drag(e, b) {
    if (e.button !== 0 || !c) return;
    const th = c.threads(ws.doc).find((x) => x.id === b.dataset.thread);
    if (!th || !(c.isMine(th.author) || c.session?.isHost)) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const base = b.style.transform;
    let moved = false;
    b.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moved = true;
      b.classList.add("is-dragging");
      b.style.transform = `${base} translate(${ev.clientX - x0}px, ${ev.clientY - y0}px)`;
    };
    const up = (ev) => {
      b.removeEventListener("pointermove", move);
      b.removeEventListener("pointerup", up);
      b.removeEventListener("pointercancel", up);
      b.classList.remove("is-dragging");
      if (!moved) return;
      b.dataset.dragged = "1";
      setTimeout(() => delete b.dataset.dragged, 50);
      if (ev.type === "pointercancel") return refresh();
      const r = ws.view.stage.getBoundingClientRect();
      const w = ws.toWorld(ev.clientX - r.left, ev.clientY - r.top);
      c.reanchor(ws.doc, th.id, anchorAt(w));
      refresh();
    };
    b.addEventListener("pointermove", move);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
  }

  for (const ev of ["camera", "change", "geometry", "page"]) offs.push(ws.on(ev, refresh));
  // the comment UI asks for a redraw after adding, resolving or hiding comments
  const off = app?.on?.("overlay", () => refresh());
  if (typeof off === "function") offs.push(off);

  return {
    anchorAt,
    currentAnchor,
    compose,
    reveal,
    refresh,
    ensure,
    destroy() {
      for (const off of offs) off?.();
      layer.remove();
    },
  };
}

/** The Comment tool (C): a click opens the composer for the layer or page point under the pointer. */
export function createCommentTool(ws) {
  return {
    id: "comment",
    cursor: "crosshair",
    down(ctx) {
      ws.comments?.compose(ctx.world, { x: ctx.e.clientX, y: ctx.e.clientY });
      return false;
    },
    hover(ctx) {
      const id = ws.pickAt(ctx.stage.x, ctx.stage.y, { deep: true });
      ws.setHover(id);
    },
    key(e) {
      if (e.type === "keydown" && e.key === "Escape") {
        ws.tools.set("move");
        return true;
      }
      return false;
    },
  };
}
