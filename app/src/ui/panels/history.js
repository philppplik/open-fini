// History and Navigator panels.
import { h, empty, frameScheduler, debounce } from "../../core/util.js";
import { emptyHint } from "../empty-hint.js";
import { buildPageDL } from "../../engine/dl.js";
import { renderToCanvas } from "../../engine/backends/canvas.js";
import { iconButton } from "../controls.js";
import { markContext } from "../context-menu/index.js";

export function createHistoryPanel(app) {
  const list = h("div.of-history__list", { role: "listbox", "aria-label": "History" });
  const undo = iconButton({ icon: "arrow-counterclockwise", label: "Undo", onClick: () => app.run("edit.undo") });
  const redo = iconButton({ icon: "arrow-clockwise", label: "Redo", onClick: () => app.run("edit.redo") });
  const clear = iconButton({ icon: "trash3", label: "Clear history", onClick: () => app.doc?.history.clear() });
  const el = h("div.of-history", list, h("div.of-history__footer", undo, redo, h("span.grow"), clear));

  function render() {
    empty(list);
    const doc = app.doc;
    undo.disabled = !doc?.history.canUndo;
    redo.disabled = !doc?.history.canRedo;
    if (!doc) return;
    const hst = doc.history;
    list.append(historyRow("Open document", hst.index === 0, () => hst.goto(0), doc));
    if (!hst.entries.length) list.append(emptyHint(app, { icon: "clock-history", title: "Nothing to undo yet", text: "Every change you make is listed here. Click a step to go back to it.", plain: "No steps yet." }));
    hst.entries.forEach((e, i) => list.append(historyRow(e.label, hst.index === i + 1, () => hst.goto(i + 1), doc, i + 1 > hst.index)));
    const active = list.querySelector(".active");
    active?.scrollIntoView({ block: "nearest" });
  }
  function historyRow(label, active, go, doc, dim = false) {
    const r = h("button.of-history__row", { type: "button", class: `${active ? "active" : ""} ${dim ? "dim" : ""}`, role: "option", "aria-selected": String(active) }, label);
    markContext(r, "history-item", { label, go: () => (go(), doc.emit("change", { nodes: new Set(), structure: true, history: true, label: "History" })) });
    r.addEventListener("click", () => {
      go();
      doc.emit("change", { nodes: new Set(), structure: true, history: true, label: "History" });
    });
    return r;
  }
  const sched = frameScheduler(render);
  for (const ev of ["doc", "docchange"]) app.on(ev, sched);
  render();
  return { el, show: render };
}

export function createNavigatorPanel(app) {
  const canvas = h("canvas.of-nav__canvas");
  const box = h("div.of-nav__view");
  const wrap = h("div.of-nav__wrap", canvas, box);
  const label = h("span.of-nav__zoom");
  const el = h("div.of-nav", wrap, h("div.of-nav__bar", iconButton({ icon: "zoom-out", label: "Zoom out", onClick: () => app.run("view.zoomOut") }), label, iconButton({ icon: "zoom-in", label: "Zoom in", onClick: () => app.run("view.zoomIn") }), iconButton({ icon: "arrows-angle-contract", label: "Fit page", onClick: () => app.run("view.fit") })));
  markContext(el, "navigator");
  let info = null;

  const draw = debounce(() => {
    const doc = app.doc;
    const page = app.page;
    if (!doc || !page || !el.isConnected) return;
    const maxW = Math.max(120, wrap.clientWidth || 240);
    const maxH = 150;
    const s = Math.min(maxW / page.w, maxH / page.h);
    const w = Math.max(1, Math.round(page.w * s));
    const hh = Math.max(1, Math.round(page.h * s));
    const dl = buildPageDL(doc, page);
    const c = renderToCanvas(dl, { scale: s, width: w, height: hh, bg: page.bg || null });
    canvas.width = w;
    canvas.height = hh;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hh}px`;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c9c9cf";
    ctx.fillRect(0, 0, w, hh);
    ctx.drawImage(c, 0, 0);
    info = { s, w, h: hh };
    place();
  }, 180);

  function place() {
    const v = app.view;
    const page = app.page;
    if (!v || !page || !info) return;
    const vis = v.visibleRect();
    const x0 = Math.max(0, (vis.x - page.x) * info.s);
    const y0 = Math.max(0, (vis.y - page.y) * info.s);
    const x1 = Math.min(info.w, (vis.x + vis.w - page.x) * info.s);
    const y1 = Math.min(info.h, (vis.y + vis.h - page.y) * info.s);
    box.style.cssText = `left:${x0}px;top:${y0}px;width:${Math.max(0, x1 - x0)}px;height:${Math.max(0, y1 - y0)}px`;
    label.textContent = `${Math.round(v.zoom * 1000) / 10}%`;
  }

  wrap.addEventListener("pointerdown", (e) => {
    if (!info) return;
    wrap.setPointerCapture(e.pointerId);
    const go = (ev) => {
      const r = canvas.getBoundingClientRect();
      const page = app.page;
      app.view.centerOn(page.x + (ev.clientX - r.left) / info.s, page.y + (ev.clientY - r.top) / info.s);
      app.emit("view");
    };
    go(e);
    const mv = (ev) => go(ev);
    const up = () => {
      wrap.removeEventListener("pointermove", mv);
      wrap.removeEventListener("pointerup", up);
    };
    wrap.addEventListener("pointermove", mv);
    wrap.addEventListener("pointerup", up);
  });

  app.on("view", place);
  for (const ev of ["doc", "docchange", "page"]) app.on(ev, () => draw());
  draw();
  return { el, show: () => draw() };
}
