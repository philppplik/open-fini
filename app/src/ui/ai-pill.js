// AI progress pill: a small floating status at the bottom of the window (every studio) while any Vibe chat or
// right-click AI action runs. "AI is adding shapes…" (from the current tool call) with a thin progress bar
// (step-based when the step count is known), Stop, and a click that opens the chat. Several tasks: "N AI tasks running".
// Hidden when idle, and inside Vibe Studio while only the open chat is working (its composer already shows that).
// Installed once by the Vibe hub (vibe/hub.js); styles in styles/vibe-engine.css.
import { h } from "../core/util.js";
import { iconEl } from "./toolbox.js";
import { pillText } from "./vibe/activity-label.js";

export function installAiPill(app, hub) {
  if (document.querySelector(".of-aipill")) return;
  const text = h("span.of-aipill__text.of-shimmer");
  const live = h("span.of-sr-only", { "aria-live": "polite" });
  const bar = h("span.of-aipill__bar", h("span.of-aipill__fill"));
  const open = h("button.of-aipill__open", { type: "button", title: "Open in Vibe Studio" }, iconEl("stars"), text);
  const stop = h("button.of-aipill__stop", { type: "button", "aria-label": "Stop", title: "Stop" }, iconEl("stop-fill"));
  const el = h("div.of-aipill.hidden", { role: "status" }, open, stop, bar, live);
  document.body.append(el);
  const steps = new Map(); // session id -> step number of the current request

  const tasks = () => hub.running.map((s) => ({ s, activity: s.activity, waiting: s.pendingApprovals.length + s.pendingAsks.length > 0, step: steps.get(s.id) || 0, max: s.settings?.().maxSteps || 24 }));
  let lastSpoken = "";
  let raf = 0;
  function paint() {
    raf = 0;
    const list = tasks();
    const inVibe = app.studio === "vibe";
    const onlyActive = inVibe && list.every((t) => t.s === hub.active);
    if (!list.length || onlyActive) {
      el.classList.add("hidden");
      lastSpoken = "";
      return;
    }
    el.classList.remove("hidden");
    const label = pillText(list);
    text.textContent = label;
    text.classList.toggle("of-shimmer", !list.some((t) => t.waiting));
    el.classList.toggle("waiting", list.some((t) => t.waiting));
    // one task with a known step count: step-based bar; otherwise indeterminate
    const one = list.length === 1 ? list[0] : null;
    const fill = bar.firstChild;
    if (one && one.step) {
      bar.classList.remove("indeterminate");
      fill.style.width = `${Math.min(100, Math.round((one.step / one.max) * 100))}%`;
    } else {
      bar.classList.add("indeterminate");
      fill.style.width = "";
    }
    stop.setAttribute("aria-label", list.length > 1 ? "Stop all AI tasks" : "Stop");
    stop.title = list.length > 1 ? "Stop all AI tasks" : "Stop";
    const spoken = list.length > 1 ? label : label.replace(/…$/, "");
    if (spoken !== lastSpoken) {
      live.textContent = spoken; // polite: announced only when the wording changes
      lastSpoken = spoken;
    }
  }
  const schedule = () => (raf ||= requestAnimationFrame(paint));

  open.addEventListener("click", async () => {
    const list = tasks();
    const target = list.find((t) => !t.s.hidden && t.waiting) || list.find((t) => !t.s.hidden);
    await app.setStudio("vibe");
    if (target) hub.activate(target.s.id);
  });
  stop.addEventListener("click", () => {
    const n = hub.stopAll();
    app.toast(`Stopped ${n} AI task${n === 1 ? "" : "s"}.`, "primary", 1400);
  });
  hub.on("activity", ({ session, ev }) => {
    if (ev?.type === "step" && !ev.agentId) steps.set(session.id, ev.n);
    if (!session.running) steps.delete(session.id);
    schedule();
  });
  hub.on("sessions", schedule);
  hub.on("active", schedule);
  app.on?.("studio", schedule);
  schedule();
}
