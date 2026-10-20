// The Histogram panel: live, source- and channel-aware, with statistics, hover readout, clipping toggles,
// a compact mode and an accessible data table. Loaded on demand (see ui/panels/index.js).
import { h, empty } from "../../core/util.js";
import { segmented, selectField } from "../controls.js";
import { summarize, channelHistogram, readout, describeHistogram, rebin, assess, CHANNEL_LABELS } from "../../engine/pixel/histogram-analysis.js";
import { SOURCES, resolveSource, analyzeSource, analyzeExact, pageArea, LIVE_PIXELS } from "./source.js";
import { drawHistogram, seriesFor, fitCanvas, onResize } from "./draw.js";

/** Shared analysis controller (one per app): recomputes only when pixels, adjustments, selection or the source change. */
export function getController(app) {
  if (app._hist) return app._hist;
  const listeners = new Set();
  let sig = "";
  let token = 0;
  let timer = 0;
  let exactTimer = 0;
  const ctl = {
    result: null,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    request(now) {
      clearTimeout(timer);
      timer = setTimeout(ctl.compute, now ? 0 : 220);
    },
    compute() {
      if (!app.doc || !app.page || ![...listeners].some((l) => l.visible())) return;
      const st = app.state;
      const source = app.prefs.histSource || "composite";
      const key = [app.doc.id, app.doc.rev, app.page.id, source, app.activeNode?.id, st?.maskRev | 0, !!st?.pixelMask, st?.maskTarget].join("|");
      if (key === sig && ctl.result) return;
      sig = key;
      const mine = ++token;
      clearTimeout(exactTimer);
      let src;
      try {
        src = resolveSource(app, source);
        const r = analyzeSource(src);
        ctl.result = { a: r.a, label: src.label, notes: src.note, approx: r.approx, exact: false, kind: src.kind };
      } catch (err) {
        ctl.result = { a: null, label: "", notes: [`The histogram could not be computed: ${err.message}`], approx: false, exact: false };
      }
      listeners.forEach((l) => l.update(ctl.result));
      if (ctl.result.approx && src) {
        exactTimer = setTimeout(async () => {
          ctl.result.computing = true;
          listeners.forEach((l) => l.update(ctl.result));
          const acc = await analyzeExact(src, () => token === mine);
          if (token !== mine) return;
          ctl.result.computing = false;
          if (acc) Object.assign(ctl.result, { a: acc, approx: false, exact: true });
          listeners.forEach((l) => l.update(ctl.result));
        }, 600);
      }
    },
  };
  for (const ev of ["docchange", "doc", "page", "selection", "pixelmask", "studio"]) app.on(ev, () => ctl.request());
  app.on("prefs", (k) => (k === "histSource" || k === "*") && ctl.request(true));
  app._hist = ctl;
  return ctl;
}

const CHANNELS = ["rgb", "luma", "r", "g", "b", "lab"];
const TEXT = { rgb: "RGB", luma: "Lum", r: "R", g: "G", b: "B", lab: "L*" };
const fmt = (n, p = 1) => (Number.isFinite(n) ? n.toFixed(p) : "0");

export function createHistogramPanel(app) {
  const ctl = getController(app);
  const pref = (k, d) => app.prefs[k] ?? d;
  let hover = null;

  const canvas = h("canvas.of-hist__canvas", { tabindex: 0, role: "img", "aria-label": "Histogram" });
  const readoutEl = h("div.of-hist__readout", { role: "status", "aria-live": "off" });
  const note = h("div.of-hist__note", { "aria-live": "polite" });
  const stats = h("dl.of-hist__stats");
  const table = h("div.of-hist__table");
  const dataBtn = h("button.of-hist__tog", { type: "button", "aria-pressed": "false", title: "Show the histogram as a table" }, "Data");
  const tablePane = h("div.of-hist__tablepane.hidden", table);

  const source = selectField({ label: "Source", value: pref("histSource", "composite"), options: SOURCES, onChange: (v) => app.setPref("histSource", v) });
  source.select.setAttribute("aria-label", "Histogram source");
  const channel = segmented(CHANNELS.map((c) => ({ value: c, text: TEXT[c], label: CHANNEL_LABELS[c] })), pref("histChannel", "rgb"), (v) => {
    app.setPref("histChannel", v);
    paint();
  }, { cls: "of-hist__channels" });

  const tog = (label, title, key, onChange) => {
    const b = h("button.of-hist__tog", { type: "button", title, "aria-pressed": String(!!pref(key, false)) }, label);
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      onChange(on);
    });
    return b;
  };
  const logBtn = tog("Log", "Logarithmic scale: makes small populations visible", "histLog", (v) => {
    app.setPref("histLog", v);
    paint();
  });
  const barsBtn = tog("Bars", "Draw bars instead of a smooth area", "histBars", (v) => {
    app.setPref("histBars", v);
    paint();
  });
  const clipS = tog("Shadows", "Show pixels with a clipped channel (0) in blue on the canvas", "histClipShadows", () => app.run("view.clipShadows"));
  const clipH = tog("Highlights", "Show pixels with a clipped channel (255) in red on the canvas", "histClipHighlights", () => app.run("view.clipHighlights"));
  const compactBtn = h("button.of-hist__tog", { type: "button", title: "Compact / detailed view", "aria-pressed": String(!!pref("histCompact", false)) }, "Compact");
  const syncClip = () => {
    clipS.setAttribute("aria-pressed", String(!!app.prefs.histClipShadows));
    clipH.setAttribute("aria-pressed", String(!!app.prefs.histClipHighlights));
  };

  const top = h("div.of-hist__top", source.el, compactBtn);
  const toggles = h("div.of-hist__toggles", logBtn, barsBtn, h("span.of-hist__sep"), clipS, clipH, h("span.grow"), dataBtn);
  const el = h("div.of-panel.of-hist", top, channel.el, canvas, readoutEl, note, h("div.of-hist__more", toggles, stats, tablePane));

  function applyCompact() {
    const c = !!pref("histCompact", false);
    el.classList.toggle("of-hist--compact", c);
    compactBtn.setAttribute("aria-pressed", String(c));
    compactBtn.textContent = c ? "Detail" : "Compact";
    paint();
  }
  compactBtn.addEventListener("click", () => {
    app.setPref("histCompact", !pref("histCompact", false));
    applyCompact();
  });
  dataBtn.addEventListener("click", () => {
    const on = tablePane.classList.toggle("hidden") === false;
    dataBtn.setAttribute("aria-pressed", String(on));
    if (on) paint();
  });

  const cur = () => pref("histChannel", "rgb");
  const result = () => ctl.result;

  function paint() {
    const r = result();
    const ch = cur();
    const compact = !!pref("histCompact", false);
    const size = fitCanvas(canvas, compact ? 48 : 112);
    if (!r || !r.a) {
      drawHistogram(canvas, { series: [], size });
      canvas.setAttribute("aria-label", "Histogram: no data");
      note.textContent = r?.notes?.join(" ") || (app.doc ? "" : "Open a document to see its histogram.");
      empty(stats);
      return;
    }
    const a = r.a;
    const log = !!pref("histLog", false);
    const bars = !!pref("histBars", false);
    drawHistogram(canvas, { series: seriesFor(a, ch, { log, smooth: bars ? 0 : 1 }), style: bars ? "bars" : "smooth", hover, size });
    const sum = summarize(a, ch);
    const text = describeHistogram(a, ch, r.label);
    canvas.setAttribute("aria-label", text);
    const bits = [...(r.notes || [])];
    if (r.computing) bits.push("Computing exact values…");
    else if (r.approx) bits.push(`Approximate: sampled from ${(LIVE_PIXELS / 1e6).toFixed(1)} MP of ${(pageArea(app.page) / 1e6).toFixed(1)} MP.`);
    else if (r.exact) bits.push("Exact (full resolution).");
    note.textContent = bits.join(" ");
    if (compact) {
      readoutEl.textContent = `${CHANNEL_LABELS[ch]} · mean ${fmt(sum.mean, 0)} · median ${sum.median} · σ ${fmt(sum.stddev, 0)}`;
      return;
    }
    if (hover == null) readoutEl.textContent = `Hover or use ←/→ for level, count and percentile. Source: ${r.label}.`;
    else showReadout(hover);
    renderStats(sum, a);
    if (!tablePane.classList.contains("hidden")) renderTable(a, ch);
  }

  function renderStats(sum, a) {
    const clip = (v) => `${fmt(v, v > 0 && v < 0.1 ? 2 : 1)}%`;
    const items = [
      ["Mean", fmt(sum.mean)], ["Median", sum.median], ["Std dev", fmt(sum.stddev)], ["Pixels", Math.round(sum.pixels).toLocaleString("en-US") + (a.sampled ? " ≈" : "")],
      ["Min / Max", `${sum.min} / ${sum.max}`], ["Shadows clipped", clip(sum.shadowsClipped)], ["Highlights clipped", clip(sum.highlightsClipped)], ["1% / 99%", `${sum.p1} / ${sum.p99}`],
    ];
    empty(stats);
    for (const [k, v] of items) stats.append(h("div.of-hist__stat", h("dt", k), h("dd", { class: (k === "Shadows clipped" && sum.shadowsClipped >= 1) || (k === "Highlights clipped" && sum.highlightsClipped >= 1) ? "warn" : "" }, String(v))));
    const as = assess(a);
    if (as.issues.length) stats.append(h("div.of-hist__assess", as.issues[0]));
  }

  function renderTable(a, ch) {
    const sets = ch === "rgb" ? [["R", a.r], ["G", a.g], ["B", a.b]] : [[TEXT[ch], channelHistogram(a, ch)]];
    const tbl = h("table", { "aria-label": `${CHANNEL_LABELS[ch]} histogram data` }, h("thead", h("tr", h("th", "Levels"), ...sets.map(([n]) => h("th", `${n} %`)))));
    const body = h("tbody");
    const binned = sets.map(([, hh]) => rebin(hh, 16));
    const totals = sets.map(([, hh]) => hh.reduce((s, v) => s + v, 0) || 1);
    for (let i = 0; i < 16; i++) body.append(h("tr", h("td", `${i * 16}–${i * 16 + 15}`), ...binned.map((b, k) => h("td", fmt((b[i] / totals[k]) * 100)))));
    tbl.append(body);
    table.replaceChildren(tbl);
  }

  function levelAt(e) {
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(255, Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * 255)));
  }
  function showReadout(level) {
    const r = result();
    if (!r?.a) return;
    const ch = cur();
    const rd = readout(channelHistogram(r.a, ch), level);
    let extra = "";
    if (ch === "rgb") extra = ` (R ${r.a.r[rd.level]} · G ${r.a.g[rd.level]} · B ${r.a.b[rd.level]})`;
    readoutEl.textContent = `Level ${rd.level} · ${rd.count.toLocaleString("en-US")} px${extra} · ${fmt(rd.share, 2)}% · ${fmt(rd.percentile)}% at or below`;
  }
  canvas.addEventListener("pointermove", (e) => {
    hover = levelAt(e);
    paint();
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    paint();
  });
  canvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 16 : 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") hover = Math.max(0, Math.min(255, (hover ?? 128) + (e.key === "ArrowRight" ? step : -step)));
    else if (e.key === "Home") hover = 0;
    else if (e.key === "End") hover = 255;
    else if (e.key === "Escape") hover = null;
    else return;
    e.preventDefault();
    e.stopPropagation();
    paint();
    readoutEl.setAttribute("aria-live", "polite");
    setTimeout(() => readoutEl.setAttribute("aria-live", "off"), 800);
  });
  canvas.addEventListener("blur", () => {
    hover = null;
    paint();
  });

  const visible = () => el.isConnected && el.offsetParent !== null;
  ctl.subscribe({ visible, update: paint });
  app.on("prefs", (k) => {
    if (k === "histClipShadows" || k === "histClipHighlights" || k === "*") syncClip();
    if (k === "histSource") source.set(pref("histSource", "composite"));
  });
  onResize(canvas, () => visible() && paint());
  applyCompact();
  syncClip();
  return { el, show: () => { ctl.request(true); paint(); } };
}
