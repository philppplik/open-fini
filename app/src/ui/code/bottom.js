// Bottom panel of the Code studio: Problems (parser and syntax diagnostics) and the preview's Console.
import { h, empty, frameScheduler } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { fileIcon, lineCol } from "./util.js";

const LEVEL_ICONS = { error: "x-circle-fill", warn: "exclamation-triangle-fill", warning: "exclamation-triangle-fill", info: "info-circle-fill", log: "chevron-right", debug: "chevron-right" };

export function createBottomPanel(ws) {
  const state = { open: false, tab: "console" };
  const tabs = h("div.of-bottom__tabs", { role: "tablist" });
  const body = h("div.of-bottom__body");
  const actions = h("div.of-bottom__actions");
  const resize = h("div.of-bottom__resize", { role: "separator", "aria-orientation": "horizontal", title: "Drag to resize" });
  const el = h("div.of-bottom.collapsed", resize, h("div.of-bottom__head", tabs, actions), body);

  const count = (kind) => (kind === "problems" ? ws.problemCount() : ws.consoleLines.filter((l) => l.level === "error").length);

  function renderTabs() {
    empty(tabs);
    for (const [id, label] of [["problems", "Problems"], ["console", "Console"]]) {
      const n = count(id);
      const b = h("button.of-bottom__tab", { type: "button", role: "tab", class: state.tab === id ? "active" : "", "aria-selected": String(state.tab === id) }, label, n ? h("span.of-badge", String(n)) : null);
      b.addEventListener("click", () => show(id));
      tabs.append(b);
    }
    empty(actions);
    if (state.tab === "console") actions.append(iconButton({ icon: "trash3", label: "Clear console", onClick: () => ws.clearConsole() }));
    actions.append(iconButton({ icon: "x-lg", label: "Close panel", onClick: () => toggle(false) }));
  }

  function renderBody() {
    empty(body);
    if (state.tab === "console") {
      if (!ws.consoleLines.length) body.append(h("div.of-empty", "Output of console.log() and runtime errors from the preview appear here."));
      for (const l of ws.consoleLines.slice(-300)) body.append(consoleLine(l));
      body.scrollTop = body.scrollHeight;
    } else {
      const problems = ws._problems || [];
      if (!problems.length) body.append(h("div.of-empty", "No problems found in HTML, CSS, JavaScript or JSON files."));
      for (const p of problems) {
        const text = ws.web.text(p.path) || "";
        const { line, col } = lineCol(text, p.start);
        const row = h("button.of-problem", { type: "button", class: p.severity }, h("sl-icon", { name: LEVEL_ICONS[p.severity] || "info-circle-fill" }), h("span.of-problem__msg", p.message), fileIcon(p.path), h("span.of-problem__loc", `${p.path}:${line}:${col}`));
        row.addEventListener("click", () => ws.openFile(p.path, { focus: true, from: p.start, to: p.end, keepPage: true }));
        body.append(row);
      }
    }
  }
  function consoleLine(l) {
    return h("div.of-console__line", { class: l.level }, h("sl-icon", { name: LEVEL_ICONS[l.level] || "chevron-right" }), h("pre", l.text), h("time", new Date(l.time).toLocaleTimeString("en-US", { hour12: false })));
  }

  function show(tab) {
    state.tab = tab;
    toggle(true);
  }
  function toggle(force) {
    state.open = force ?? !state.open;
    el.classList.toggle("collapsed", !state.open);
    if (state.open) {
      el.style.height = `${ws.web.settings.bottomH || 220}px`;
      if (state.tab === "problems") ws.computeProblems();
      renderTabs();
      renderBody();
    } else el.style.height = "";
    ws.preview?.layout();
    requestAnimationFrame(() => ws.preview?.layout());
  }

  resize.addEventListener("pointerdown", (e) => {
    resize.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = el.getBoundingClientRect().height;
    const mv = (ev) => {
      const hh = Math.max(80, Math.min(window.innerHeight * 0.7, startH + (startY - ev.clientY)));
      el.style.height = `${hh}px`;
      ws.web.settings.bottomH = Math.round(hh);
    };
    const up = () => {
      resize.removeEventListener("pointermove", mv);
      resize.removeEventListener("pointerup", up);
      ws.preview?.layout();
    };
    resize.addEventListener("pointermove", mv);
    resize.addEventListener("pointerup", up);
  });

  const refresh = frameScheduler(() => {
    if (!state.open) return;
    renderTabs();
    renderBody();
  });
  ws.on("console", (line) => {
    if (!state.open) return;
    if (line && state.tab === "console") {
      body.querySelector(".of-empty")?.remove();
      body.append(consoleLine({ ...line, time: Date.now() }));
      body.scrollTop = body.scrollHeight;
      renderTabs();
    } else refresh();
  });
  ws.on("problems", refresh);
  return { el, toggle, show, isOpen: () => state.open };
}
