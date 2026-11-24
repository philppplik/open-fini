// The DOM renderer of the Proto canvas (docs/concepts/proto-studio.md §4.1, §4.2; ADR 0034 decision 4).
//
// The stage holds a world element transformed by the camera (`translate() scale()`) and a Canvas 2D overlay above it.
// Every top-level layer of the page is a host element in the world with its own shadow root, which holds the layer's
// subtree built from css.js declarations only (createElement, textContent and style.setProperty; never innerHTML), a
// shared reset stylesheet, and nothing of the app's CSS. After a commit, proto/patch.js says which top-level layers
// changed (the model shares structure) and plans a keyed patch per layer; only changed elements are touched.
// Offscreen layers get `content-visibility: hidden` and are detached after 10 s; far zoomed out, small layers are
// detached and drawn on the overlay from the geometry cache (level of detail). Geometry is read in one batch per
// animation frame (proto/measure.js) and kept in the geometry cache (proto/geometry.js).
//
//   createView(container, { overlayState, mediaUrl }) → view
//     render(model, pageId) → stats        patch the DOM to the model (call after every commit, undo or remote change)
//     camera / setCamera(cam, { gesture }) pan and zoom; `gesture: true` while a pan or zoom gesture runs
//     size                                 { w, h } of the stage in pixels
//     fit(rect?, opts?)                    camera that shows `rect` (default: everything on the page)
//     geo                                  the geometry cache;  roots → Map of per-layer records (state, box)
//     requestDraw()                        redraw the overlay on the next frame
//     on(event, fn) → off                  "frame" (after measuring and drawing), "camera", "geometry"
//     stage / world / canvas / overlay     elements and the overlay (overlay.addLayer for tools)
//     destroy()
//   `overlayState()` returns { selection: [geometry entries], hover, marquee } for each overlay draw.
import { createResolver } from "../engine/proto/resolve.js";
import { treeCss } from "../engine/proto/css.js";
import { changedRoots, entriesFor, planPatch, cullState, estimateBox, planStats } from "./patch.js";
import { createGeometry, unionRect } from "./geometry.js";
import { measureRoot } from "./measure.js";
import { createOverlay } from "./overlay.js";
import { fitRect, worldViewport, sameCamera } from "./camera.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const GESTURE_IDLE = 150; // ms after the last pan or zoom step before the stage re-rasterizes crisply

// One reset sheet for every shadow root: the design sees none of the app's CSS and starts from browser defaults that
// css.js assumes (border-box, no margins, block divs).
let resetSheet = null;
function reset() {
  if (resetSheet) return resetSheet;
  const css = `:host{all:initial;position:absolute;display:block;width:0;height:0;overflow:visible}
div,span,svg{box-sizing:border-box;margin:0}
div{display:block}
span{white-space:inherit}
svg{display:block;overflow:visible;width:100%;height:100%}`;
  try {
    resetSheet = new CSSStyleSheet();
    resetSheet.replaceSync(css);
  } catch {
    resetSheet = css; // old engines: a <style> element per root
  }
  return resetSheet;
}

/** Blob URLs for media bytes (one per bytes object, released with the view). */
function mediaUrls() {
  const urls = new WeakMap();
  const all = [];
  return {
    url(_id, media) {
      const bytes = media?.bytes;
      if (!bytes || typeof Blob === "undefined") return "";
      let u = urls.get(bytes);
      if (!u) {
        u = URL.createObjectURL(new Blob([bytes], { type: media.mime || "application/octet-stream" }));
        urls.set(bytes, u);
        all.push(u);
      }
      return u;
    },
    release: () => all.splice(0).forEach((u) => URL.revokeObjectURL(u)),
  };
}

function fillText(el, text) {
  el.replaceChildren();
  for (const run of text?.runs || []) {
    if (!run.decls.length) {
      el.append(document.createTextNode(run.text));
      continue;
    }
    const span = document.createElement("span");
    for (const [p, v] of run.decls) span.style.setProperty(p, v);
    span.textContent = run.text;
    el.append(span);
  }
}

function fillSvg(el, s) {
  el.replaceChildren();
  if (!s) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  const shape = document.createElementNS(SVG_NS, s.kind === "line" ? "line" : "path");
  if (s.kind === "line") for (const k of ["x1", "y1", "x2", "y2"]) shape.setAttribute(k, s[k]);
  else {
    shape.setAttribute("d", s.d);
    shape.setAttribute("fill", s.fill);
    shape.setAttribute("fill-rule", s.rule);
  }
  shape.setAttribute("stroke", s.stroke);
  shape.setAttribute("stroke-width", s.strokeWidth);
  if (s.dash) shape.setAttribute("stroke-dasharray", s.dash);
  svg.append(shape);
  el.append(svg);
}

function makeElement(entry) {
  const el = document.createElement("div");
  for (const [p, v] of entry.decls) el.style.setProperty(p, v);
  for (const [n, v] of Object.entries(entry.attrs)) el.setAttribute(n, v);
  if (entry.text) fillText(el, entry.text);
  else if (entry.svg) fillSvg(el, entry.svg);
  return el;
}

/** Applies a plan of proto/patch.js to one layer's elements. */
export function applyPlan(rec, ops) {
  const els = rec.els;
  for (const o of ops) {
    switch (o.t) {
      case "create":
        els.set(o.key, makeElement(o.entry));
        break;
      case "remove": {
        const el = els.get(o.key);
        if (o.top) el?.remove();
        els.delete(o.key);
        break;
      }
      case "style": {
        const st = els.get(o.key).style;
        for (const p of o.remove) st.removeProperty(p);
        for (const [p, v] of o.set) st.setProperty(p, v);
        break;
      }
      case "attrs": {
        const el = els.get(o.key);
        for (const n of o.remove) el.removeAttribute(n);
        for (const [n, v] of o.set) el.setAttribute(n, v);
        break;
      }
      case "text":
        fillText(els.get(o.key), o.text);
        break;
      case "svg":
        fillSvg(els.get(o.key), o.svg);
        break;
      case "children": {
        const parent = els.get(o.key);
        const kids = parent.children;
        o.children.forEach((k, i) => {
          const el = els.get(k);
          if (el && kids[i] !== el) parent.insertBefore(el, kids[i] || null);
        });
        while (kids.length > o.children.length) kids[kids.length - 1].remove();
        break;
      }
      case "root":
        rec.content.replaceChildren(els.get(o.key));
        break;
    }
  }
}

export function createView(container, { overlayState = () => ({ selection: [], hover: null, marquee: null }) } = {}) {
  const world = document.createElement("div");
  world.className = "of-proto-world";
  const canvas = document.createElement("canvas");
  canvas.className = "of-proto-overlay";
  canvas.setAttribute("aria-hidden", "true");
  const stage = document.createElement("div");
  stage.className = "of-proto-stage";
  stage.append(world, canvas);
  container.append(stage);
  const overlay = createOverlay(canvas);
  const geo = createGeometry();
  const media = mediaUrls();
  const listeners = new Map();
  const emit = (ev, d) => listeners.get(ev)?.forEach((fn) => fn(d));

  /** id → { id, host, content, els, entries, node, index, state, hiddenSince, stale, measure, ro } */
  const roots = new Map();
  let model = null;
  let pageId = null;
  let order = [];
  let cam = { x: 0, y: 0, zoom: 1 };
  let W = 0;
  let H = 0;
  let raf = 0;
  let gestureTimer = 0;
  let destroyed = false;
  let colors = null;
  let resolver = null;
  let resolverModel = null;
  const stats = { roots: 0, live: 0, hidden: 0, detached: 0, lod: 0, patched: 0, ops: 0, renderMs: 0, measureMs: 0, drawMs: 0 };

  const getResolver = () => {
    if (resolverModel !== model) {
      resolver = createResolver(model);
      resolverModel = model;
    }
    return resolver;
  };

  function newRecord(id) {
    const host = document.createElement("div");
    host.className = "of-proto-root";
    host.dataset.id = id;
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = reset();
    if (typeof sheet === "string") {
      const style = document.createElement("style");
      style.textContent = sheet;
      shadow.append(style);
    } else shadow.adoptedStyleSheets = [sheet];
    const content = document.createElement("div");
    content.style.display = "contents";
    shadow.append(content);
    const rec = { id, host, content, els: new Map(), entries: null, node: null, index: 0, state: "new", hiddenSince: null, stale: true, measure: false, ro: null, rootEl: null, attached: false };
    return rec;
  }

  function dropRecord(rec) {
    rec.ro?.disconnect();
    rec.host.remove();
    geo.dropRoot(rec.id);
    roots.delete(rec.id);
  }

  function patch(rec) {
    const r = getResolver();
    const tree = r.tree(rec.id);
    const css = treeCss(tree, { resolver: r, model, vars: "css", root: "origin", mediaUrl: media.url });
    const next = entriesFor(tree, css);
    const ops = planPatch(rec.entries, next);
    applyPlan(rec, ops);
    rec.entries = next;
    rec.stale = false;
    rec.measure = true;
    stats.patched++;
    stats.ops += ops.length;
    // the root element: watch its size (fonts loading, images) to keep the geometry current
    const rootEl = tree ? rec.els.get(tree.key) : null;
    if (rootEl !== rec.rootEl) {
      rec.ro?.disconnect();
      rec.rootEl = rootEl;
      if (rootEl && typeof ResizeObserver !== "undefined") {
        let first = true;
        rec.ro = new ResizeObserver(() => {
          if (first) return void (first = false);
          rec.measure = true;
          schedule();
        });
        rec.ro.observe(rootEl);
      }
    }
    return ops;
  }

  function place(rec) {
    const n = rec.node;
    const x = Number.isFinite(n?.x) ? n.x : 0;
    const y = Number.isFinite(n?.y) ? n.y : 0;
    rec.host.style.left = `${x}px`;
    rec.host.style.top = `${y}px`;
    rec.host.style.zIndex = String(rec.index);
  }

  const boxOf = (rec) => geo.rootBox(rec.id) || estimateBox(rec.node);

  /** Decides per top-level layer how it is drawn and attaches, hides or detaches its host. */
  function cull(now = performance.now()) {
    const view = worldViewport(cam, W, H);
    const near = worldViewport(cam, W, H, Math.max(W, H) * 0.5);
    stats.live = stats.hidden = stats.detached = stats.lod = 0;
    for (const id of order) {
      const rec = roots.get(id);
      if (!rec) continue;
      const st = W && H ? cullState({ box: geo.has(id) ? geo.rootBox(id) : null, view, near, zoom: cam.zoom, hiddenSince: rec.hiddenSince, now }) : "live";
      if (st === "live") {
        rec.hiddenSince = null;
        if (rec.stale) patch(rec);
        if (!rec.attached) {
          world.append(rec.host);
          rec.attached = true;
          rec.measure = true;
        }
        if (rec.state === "hidden") rec.host.style.removeProperty("content-visibility");
        stats.live++;
      } else if (st === "hidden") {
        if (rec.hiddenSince == null) rec.hiddenSince = now;
        if (rec.attached && rec.state !== "hidden") rec.host.style.setProperty("content-visibility", "hidden");
        stats.hidden++;
      } else {
        if (rec.attached) {
          rec.host.remove();
          rec.attached = false;
        }
        rec.host.style.removeProperty("content-visibility");
        if (st === "detached") stats.detached++;
        else stats.lod++;
      }
      // hidden layers that are not attached stay detached until they come near again
      rec.state = st === "hidden" && !rec.attached ? "detached" : st;
    }
  }

  function schedule() {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (destroyed) return;
    cull();
    const t0 = performance.now();
    const origin = stage.getBoundingClientRect();
    let measured = false;
    for (const rec of roots.values()) {
      if (!rec.measure || !rec.attached || rec.state !== "live" || !rec.entries) continue;
      geo.setRoot(rec.id, measureRoot({ rootId: rec.id, entries: rec.entries, els: rec.els, cam, origin, base: rec.index * 1e6 }));
      rec.measure = false;
      measured = true;
    }
    stats.measureMs = performance.now() - t0;
    if (measured) emit("geometry", geo);
    draw();
    emit("frame", stats);
  }

  function draw() {
    const t0 = performance.now();
    colors ||= readColors();
    const s = overlayState();
    const frames = [];
    for (const id of order) {
      const rec = roots.get(id);
      if (!rec) continue;
      frames.push({ id, name: rec.node?.name || "", type: rec.node?.type, box: boxOf(rec), state: rec.state, entries: rec.state === "lod" || rec.state === "block" ? geo.rootEntries(id) : [] });
    }
    overlay.draw({ cam, selection: s.selection || [], hover: s.hover || null, marquee: s.marquee || null, frames, ...colors });
    stats.drawMs = performance.now() - t0;
  }

  function readColors() {
    const cs = getComputedStyle(stage);
    const v = (n) => cs.getPropertyValue(n).trim();
    // labels sit on the page color of the design, not on the app's theme: a neutral gray reads on light and dark pages
    return { accent: v("--of-accent") || "#0d99ff", text: "#71717a", muted: "rgba(0,0,0,0.18)" };
  }

  function applyCamera() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
  }

  const ro = new ResizeObserver(() => {
    const r = stage.getBoundingClientRect();
    if (r.width === W && r.height === H) return;
    W = r.width;
    H = r.height;
    overlay.resize(W, H, Math.min(2, window.devicePixelRatio || 1));
    schedule();
  });
  ro.observe(stage);
  document.fonts?.ready?.then(() => {
    for (const rec of roots.values()) rec.measure = true;
    schedule();
  });

  const view = {
    stage,
    world,
    canvas,
    overlay,
    geo,
    roots,
    stats,
    get camera() {
      return cam;
    },
    get size() {
      return { w: W, h: H };
    },
    get page() {
      return pageId;
    },
    /** Patches the DOM to `next` on page `page`. Cheap when little changed (identity comparison, keyed patches). */
    render(next, page) {
      const t0 = performance.now();
      stats.patched = 0;
      stats.ops = 0;
      if (page !== pageId) {
        for (const rec of [...roots.values()]) dropRecord(rec);
        geo.clear();
      }
      const ch = changedRoots(page !== pageId ? null : model, next, page);
      model = next;
      pageId = page;
      order = ch.order;
      stage.style.setProperty("--of-proto-page", next.pages?.[page]?.bg || "#f4f4f5");
      const keep = new Set(order);
      for (const rec of [...roots.values()]) if (!keep.has(rec.id)) dropRecord(rec);
      order.forEach((id, index) => {
        let rec = roots.get(id);
        if (!rec) roots.set(id, (rec = newRecord(id)));
        const node = next.nodes[id];
        if (ch.all || ch.roots.has(id) || rec.node !== node) rec.stale = true;
        rec.node = node;
        rec.index = index;
        place(rec);
      });
      stats.roots = order.length;
      cull();
      stats.renderMs = performance.now() - t0;
      schedule();
      return { ...stats, plan: null };
    },
    setCamera(next, { gesture = false } = {}) {
      if (sameCamera(next, cam)) return;
      cam = { x: next.x, y: next.y, zoom: next.zoom };
      applyCamera();
      if (gesture) {
        world.style.willChange = "transform";
        clearTimeout(gestureTimer);
        gestureTimer = setTimeout(() => {
          world.style.willChange = "";
        }, GESTURE_IDLE);
      }
      emit("camera", cam);
      schedule();
    },
    /** The camera that shows `rect` (default: every top-level layer of the page). */
    fitCamera(rect = null, opts = {}) {
      const r = rect || unionRect(order.map((id) => roots.get(id)).filter(Boolean).map(boxOf));
      return fitRect(r, W, H, opts);
    },
    fit(rect = null, opts = {}) {
      view.setCamera(view.fitCamera(rect, opts));
    },
    /** The world box of a top-level layer: measured, or its design-time size. */
    rootBox: (id) => (roots.has(id) ? boxOf(roots.get(id)) : null),
    requestDraw() {
      schedule();
    },
    /** Re-reads the theme colors of the overlay (theme switch). */
    themeChanged() {
      colors = null;
      schedule();
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev)?.delete(fn);
    },
    /** Measures and draws now (tests and the benchmark): what the next animation frame would do. */
    flush() {
      cancelAnimationFrame(raf);
      raf = 0;
      frame();
    },
    planStats,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(gestureTimer);
      ro.disconnect();
      for (const rec of [...roots.values()]) dropRecord(rec);
      media.release();
      stage.remove();
    },
  };
  applyCamera();
  return view;
}
