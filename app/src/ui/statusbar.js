// Bottom status bar: hints/status text, document info, zoom controls.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { ta } from "../i18n/dom.js";
import { iconButton } from "./controls.js";
import { STUDIOS } from "../studios/index.js";
import { createErrorIndicator } from "./error-indicator.js";
import { canSaveAsSource, saveTarget } from "../core/source-format.js";

export function createStatusBar(app) {
  const msg = h("span.of-status__msg");
  const info = h("span.of-status__info");
  const perf = h("span.of-status__perf", ta({ tip: "Low-power mode reduces effects and resolution to keep older devices responsive" }));
  // the file type File ▸ Save writes for the active document (.txt, .docx, .ofini ...)
  const target = h("span.of-status__target", { hidden: true });
  const zoomIn = iconButton({ icon: "plus-lg", label: "Zoom in", onClick: () => app.run("view.zoomIn") });
  const zoomOut = iconButton({ icon: "dash-lg", label: "Zoom out", onClick: () => app.run("view.zoomOut") });
  const zoomLabel = h("button.of-status__zoom", { type: "button", ...ta({ tip: "Fit page" }), onclick: () => app.run("view.fit") }, "100%");
  const range = h("sl-range", { min: 0, max: 100, step: 0.1, tooltip: "none", class: "of-status__range", ...ta({ "aria-label": "Zoom" }) });
  const el = h("footer.of-status", h("div.of-status__left", msg), h("div.of-status__mid", info), h("div.of-status__right", createErrorIndicator(app), target, perf, zoomOut, range, zoomIn, zoomLabel));

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

  function updateTarget() {
    const doc = app.doc;
    if (!doc) {
      target.hidden = true;
      return;
    }
    const opts = { enabled: app.prefs.saveOriginalFormat !== false };
    const st = saveTarget(doc, opts);
    const d = canSaveAsSource(doc, opts);
    target.hidden = false;
    target.textContent = st.label;
    target.classList.toggle("is-source", st.source);
    target.title = st.source ? t("File ▸ Save writes {name}", { name: st.name }) : d.ask ? t("{name} cannot hold this document any more: Save asks what to do ({reason}).", { name: d.name, reason: t(d.reason) }) : t("File ▸ Save writes an OpenFini document (.ofini)");
  }
  function update() {
    updateTarget();
    if (app.studio === "vibe") {
      info.textContent = t("Vibe · your documents, chats and keys stay on this device");
      perf.textContent = app.perf.low ? t("Low-power") : "";
      return;
    }
    if (app.studio === "office") {
      info.textContent = app.officeUI?.statusText?.() || "Office Studio";
      perf.textContent = app.perf.low ? "Low-power" : "";
      return;
    }
    if (app.studio === "code") {
      info.textContent = app.codeUI?.doc === app.doc ? app.codeUI.statusText() : t("Code studio");
      perf.textContent = app.perf.low ? t("Low-power") : "";
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
    info.textContent = p ? t("{studio} · {page} · {w} × {h} px · {n, plural, one {# page} other {# pages}}", { studio: STUDIOS[app.studio].label, page: p.name, w: Math.round(p.w), h: Math.round(p.h), n: app.doc.pages.length }) : "";
    perf.textContent = app.perf.low ? t("Low-power") : "";
  }
  for (const ev of ["view", "doc", "page", "studio", "prefs", "docchange", "codestatus", "codeui", "officestatus", "locale", "docs", "saved"]) app.on(ev, update);
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
