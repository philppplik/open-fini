// Bottom panels of the Code studio: Problems (parser and syntax diagnostics), the preview's Console and the Terminal
// (desktop app; lazy, ./terminal.js). They are three separate dockable panels (code-problems, code-console and
// code-terminal in ui/panels/index.js); this module owns their content for one workspace and the workspace publishes it
// through the panel slots (ui/panels/slots.js).
import { h, empty, frameScheduler } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { fileIcon, lineCol } from "./util.js";
import { t } from "../../i18n/index.js";

const LEVEL_ICONS = { error: "x-circle-fill", warn: "exclamation-triangle-fill", warning: "exclamation-triangle-fill", info: "info-circle-fill", log: "chevron-right", debug: "chevron-right" };
export const BOTTOM_PANELS = { problems: "code-problems", console: "code-console", terminal: "code-terminal" };

export function createBottomPanel(ws) {
  const mk = (kind) => {
    const actions = h("div.of-bottom__actions");
    const count = h("span.of-bottom__count");
    const body = h(kind === "terminal" ? "div.of-bottom__body.of-bottom__body--term" : "div.of-bottom__body");
    return { actions, count, body, el: h("div.of-bottom", h("div.of-bottom__head", count, actions), body) };
  };
  const panes = { problems: mk("problems"), console: mk("console"), terminal: mk("terminal") };
  const visible = (kind) => !!ws.app.dock?.isOpen(BOTTOM_PANELS[kind]);
  const anyOpen = () => Object.keys(panes).some(visible);
  let term = null; // the Terminal (created on first use, kept while the workspace lives)

  function renderHead(kind) {
    const p = panes[kind];
    empty(p.actions);
    const n = kind === "problems" ? ws.problemCount() : kind === "console" ? ws.consoleLines.filter((l) => l.level === "error").length : 0;
    p.count.textContent = n ? (kind === "problems" ? t("{n} problems", { n }) : t("{n} errors", { n })) : "";
    if (kind === "console") p.actions.append(iconButton({ icon: "trash3", label: "Clear console", onClick: () => ws.clearConsole() }));
    if (kind === "terminal") p.actions.append(iconButton({ icon: "trash3", label: "Clear terminal", onClick: () => term?.clear() }));
  }

  function renderBody(kind) {
    const body = panes[kind].body;
    renderHead(kind);
    if (kind === "terminal") return showTerminal();
    empty(body);
    if (kind === "console") {
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
  async function showTerminal() {
    if (!term) term = (await import("./terminal.js")).createTerminal(ws);
    if (!panes.terminal.body.contains(term.el)) panes.terminal.body.append(term.el);
    term.show();
  }
  function consoleLine(l) {
    return h("div.of-console__line", { class: l.level }, h("sl-icon", { name: LEVEL_ICONS[l.level] || "chevron-right" }), h("pre", l.text), h("time", new Date(l.time).toLocaleTimeString("en-US", { hour12: false })));
  }

  /** Brings a tab to the front, opening its panel when it is closed. */
  function show(tab) {
    ws.app.dock?.reveal(BOTTOM_PANELS[tab]);
    if (tab === "problems") ws.computeProblems();
  }
  /** Ctrl+J: closes every bottom panel, or opens the Console. */
  function toggle(force) {
    const open = force ?? !anyOpen();
    if (open) {
      if (!anyOpen()) show("console");
    } else for (const k of Object.keys(panes)) if (visible(k)) ws.app.dock?.hidePanel(BOTTOM_PANELS[k]);
  }

  const refresh = frameScheduler(() => {
    for (const k of ["problems", "console"]) if (visible(k)) renderBody(k);
  });
  ws.on("console", (line) => {
    if (!visible("console")) return;
    const { body } = panes.console;
    if (line) {
      body.querySelector(".of-empty")?.remove();
      body.append(consoleLine({ ...line, time: Date.now() }));
      body.scrollTop = body.scrollHeight;
      renderHead("console");
    } else refresh();
  });
  ws.on("problems", refresh);
  /** Panel slot contents; show() draws a pane when its panel comes to the front. */
  const slots = Object.fromEntries(Object.keys(panes).map((k) => [BOTTOM_PANELS[k], { el: panes[k].el, show: () => renderBody(k) }]));
  return { slots, toggle, show, isOpen: anyOpen };
}
