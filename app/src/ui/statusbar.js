// Bottom status bar: hints/status text, document info, zoom controls.
import { h } from "../core/util.js";
import { iconButton } from "./controls.js";
import { STUDIOS } from "../studios/index.js";
import { createErrorIndicator } from "./error-indicator.js";

export function createStatusBar(app) {
  const msg = h("span.of-status__msg");
  const info = h("span.of-status__info");
  const perf = h("span.of-status__perf", { "data-tip": "Low-power mode reduces effects and resolution to keep older devices responsive" });
  const zoomIn = iconButton({ icon: "plus-lg", label: "Zoom in", onClick: () => app.run("view.zoomIn") });
  const zoomOut = iconButton({ icon: "dash-lg", label: "Zoom out", onClick: () => app.run("view.zoomOut") });
  const zoomLabel = h("button.of-status__zoom", { type: "button", "data-tip": "Fit page", onclick: () => app.run("view.fit") }, "100%");
  const range = h("sl-range", { min: 0, max: 100, step: 0.1, tooltip: "none", class: "of-status__range", "aria-label": "Zoom" });
  const el = h("footer.of-status", h("div.of-status__left", msg), h("div.of-status__mid", info), h("div.of-status__right", createErrorIndicator(app), perf, zoomOut, range, zoomIn, zoomLabel));

  // logarithmic zoom slider: 2% … 6400%
  const lo = Math.log(0.02);
  const hi = Math.log(64);
  const toSlider = (z) => ((Math.log(z) - lo) / (hi - lo)) * 100;
  const fromSlider = (v) => Math.exp(lo + (v / 100) * (hi - lo));
  range.addEventListener("sl-input", () => app.cv?.setZoom(fromSlider(range.value)));

  let msgTimer = 0;
  function setMsg(t) {
    msg.textContent = t || "";
  }
  app.on("status", (t) => {
    clearTimeout(msgTimer);
    setMsg(t);
  });

  function update() {
    if (app.studio === "vibe") {
      info.textContent = "Vibe · your documents, chats and keys stay on this device";
      perf.textContent = app.perf.low ? "Low-power" : "";
      return;
    }
    if (app.studio === "office") {
      info.textContent = app.officeUI?.statusText?.() || "Office Studio";
      perf.textContent = app.perf.low ? "Low-power" : "";
      return;
    }
    if (app.studio === "code") {
      info.textContent = app.codeUI?.doc === app.doc ? app.codeUI.statusText() : "Code studio";
      perf.textContent = app.perf.low ? "Low-power" : "";
      return;
    }
    const v = app.view;
    if (!v) {
      zoomLabel.textContent = "—";
      info.textContent = "";
      return;
    }
    zoomLabel.textContent = `${Math.round(v.zoom * 1000) / 10}%`;
    range.value = toSlider(v.zoom);
    const p = app.page;
    info.textContent = p ? `${STUDIOS[app.studio].label} · ${p.name} · ${Math.round(p.w)} × ${Math.round(p.h)} px · ${app.doc.pages.length} page${app.doc.pages.length > 1 ? "s" : ""}` : "";
    perf.textContent = app.perf.low ? "Low-power" : "";
  }
  for (const ev of ["view", "doc", "page", "studio", "prefs", "docchange", "codestatus", "codeui", "officestatus"]) app.on(ev, update);
  // hint for the current tool
  app.on("tool", () => {
    const C = app.toolClasses.get(app.tool?.id);
    if (C) {
      setMsg(`${C.label}${C.shortcut ? ` (${C.shortcut})` : ""}`);
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => setMsg(""), 2500);
    }
  });
  update();
  return { el, update };
}
