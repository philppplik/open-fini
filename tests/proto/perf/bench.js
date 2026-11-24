// Browser benchmark of the Proto renderer (docs/concepts/proto-studio.md §4.3, task T3). Loaded by bench.html; the
// results land in `window.__protoPerf` (a promise) and in the page. scripts/proto-perf.mjs runs it in headless
// Chromium and prints the table.
//
// Scenarios (URL parameter `only=` picks some, comma-separated):
//   open10k    10,000 layers (100 frames) to first paint: render, measure, two animation frames
//   pan5k      50 frames, 5,000 visible layers at 25 %: frame times while panning and while zooming (25 % ↔ 50 %)
//   select5k   selection and hover change on the 5,000-layer canvas: overlay redraw time
//   edit10k    property edit (a fill) to painted frame in the 10,000-layer document
//   lod20k     200 frames, 20,000 layers at 10 % (level of detail): frame times while panning
import { createView } from "../../../app/src/proto/view.js";
import { apply } from "../../../app/src/engine/proto/ops.js";
import { panBy, zoomAt } from "../../../app/src/proto/camera.js";
import { perfDesign } from "./fixture.js";

const host = document.getElementById("host");
const out = document.getElementById("out");
const params = new URLSearchParams(location.search);
const only = params.get("only") ? params.get("only").split(",") : null;
const want = (name) => !only || only.includes(name);

const raf = () => new Promise((r) => requestAnimationFrame(r));
const frames = async (n) => {
  for (let i = 0; i < n; i++) await raf();
};
const pct = (list, p) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (v) => Math.round(v * 10) / 10;
const summary = (list) => ({ n: list.length, p50: r1(pct(list, 50)), p95: r1(pct(list, 95)), max: r1(Math.max(...list)), fps: r1(1000 / (list.reduce((a, b) => a + b, 0) / list.length)) });

/** Runs `step(i)` once per animation frame for `n` frames; returns the frame intervals in ms. */
async function animate(n, step) {
  const deltas = [];
  let last = await raf();
  for (let i = 0; i < n; i++) {
    step(i);
    const now = await raf();
    deltas.push(now - last);
    last = now;
  }
  return deltas;
}

function mount(fixture, overlayState) {
  host.replaceChildren();
  const view = createView(host, { overlayState });
  const t0 = performance.now();
  view.render(fixture.model, fixture.page);
  view.flush();
  return { view, renderMs: performance.now() - t0 };
}

const liveLayers = (view) => {
  let n = 0;
  for (const rec of view.roots.values()) if (rec.state === "live" && rec.entries) n += rec.entries.size;
  return n;
};

async function run() {
  const results = { userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio };
  await frames(5);

  if (want("open10k")) {
    const f = perfDesign({ frames: 100 });
    const t0 = performance.now();
    const { view } = mount(f);
    view.fit(null, { maxZoom: 1 });
    await frames(2);
    results.open10k = { layers: f.nodes, firstPaintMs: r1(performance.now() - t0), heapMB: performance.memory ? r1(performance.memory.usedJSHeapSize / 1048576) : null };
    view.destroy();
  }

  let sel = [];
  let hover = null;
  const state = () => ({ selection: sel, hover, marquee: null });

  if (want("pan5k") || want("select5k")) {
    const f = perfDesign({ frames: 50 });
    const { view, renderMs } = mount(f, state);
    // every frame on screen at 25 % (the lowest zoom without level of detail)
    const fit = view.fitCamera(null, { maxZoom: 0.25, padding: 4 });
    const { w, h } = view.size;
    view.setCamera(zoomAt(fit, w / 2, h / 2, 0.25));
    await frames(30);
    view.flush();
    const visible = liveLayers(view);
    if (want("pan5k")) {
      const cam0 = view.camera;
      const pan = await animate(180, (i) => view.setCamera(panBy(cam0, Math.sin(i / 15) * 120, Math.cos(i / 20) * 60), { gesture: true }));
      view.setCamera(cam0);
      await frames(20);
      const zoom = await animate(120, (i) => view.setCamera(zoomAt(cam0, w / 2, h / 2, 0.25 + 0.25 * Math.abs(Math.sin(i / 25))), { gesture: true }));
      view.setCamera(cam0);
      await frames(20);
      results.pan5k = { layers: f.nodes, visibleLayers: visible, liveFrames: view.stats.live, renderMs: r1(renderMs), pan: summary(pan), zoom: summary(zoom) };
    }
    if (want("select5k")) {
      const entries = [...view.geo.entries()];
      const pick = (i) => entries[(i * 7919) % entries.length];
      const selT = [];
      const hovT = [];
      for (let i = 0; i < 40; i++) {
        sel = [pick(i), pick(i + 1)];
        let t0 = performance.now();
        view.flush();
        selT.push(performance.now() - t0);
        hover = pick(i + 3);
        t0 = performance.now();
        view.flush();
        hovT.push(performance.now() - t0);
        await raf();
      }
      sel = [];
      hover = null;
      results.select5k = { selection: summary(selT), hover: summary(hovT) };
      delete results.select5k.selection.fps;
      delete results.select5k.hover.fps;
    }
    view.destroy();
  }

  if (want("edit10k")) {
    const f = perfDesign({ frames: 100 });
    const { view } = mount(f, state);
    view.fit(null, { maxZoom: 1 });
    view.setCamera(zoomAt(view.camera, view.size.w / 2, view.size.h / 2, 0.5));
    await frames(20);
    const badges = Object.values(f.model.nodes).filter((n) => n.name === "Badge");
    let model = f.model;
    const times = [];
    for (let i = 0; i < 40; i++) {
      const n = badges[(i * 37) % badges.length];
      const t0 = performance.now();
      model = apply(model, { op: "node.update", id: n.id, set: { fills: [{ type: "solid", color: i % 2 ? "#000000" : "#ff0000" }] } }).model;
      view.render(model, f.page);
      view.flush();
      await raf();
      times.push(performance.now() - t0);
    }
    results.edit10k = { layers: f.nodes, ...summary(times) };
    delete results.edit10k.fps;
    view.destroy();
  }

  if (want("lod20k")) {
    const f = perfDesign({ frames: 200, cols: 20 });
    const { view, renderMs } = mount(f, state);
    await frames(2);
    view.fit(null, { maxZoom: 0.1, padding: 4 });
    await frames(20);
    const cam0 = view.camera;
    const pan = await animate(150, (i) => view.setCamera(panBy(cam0, Math.sin(i / 15) * 150, Math.cos(i / 20) * 80), { gesture: true }));
    results.lod20k = { layers: f.nodes, zoom: r1(cam0.zoom * 100) / 100, lodFrames: view.stats.lod, renderMs: r1(renderMs), pan: summary(pan) };
    view.destroy();
  }
  return results;
}

window.__protoPerf = run().then(
  (r) => {
    out.textContent = JSON.stringify(r, null, 1);
    return r;
  },
  (err) => {
    out.textContent = `failed: ${err.stack || err}`;
    return { error: String(err.stack || err) };
  },
);
