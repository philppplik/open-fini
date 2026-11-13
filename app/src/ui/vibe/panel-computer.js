// Settings ▸ Artificial intelligence ▸ Computer use: master switch (off by default, desktop app on Windows and
// macOS), the operating system permissions (macOS), the session (start with a scope and time limit through the native
// dialog, pause, resume, stop), limits, the app lists (never / only) and the action log.
// Native side: src-tauri/src/computer.rs; tools: ../../vibe/tools/computer.js; policy: ../../vibe/computer-policy.js.
import { h, empty } from "../../core/util.js";
import { t, N_, locale } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { iconEl } from "../toolbox.js";
import { confirmDialog } from "../dialogs.js";
import { computerInvoke, computerAvailable } from "../../vibe/tools/computer.js";
import { normalizeComputerUse, DEFAULT_COMPUTER_USE } from "../../vibe/computer-policy.js";

const OPS = { grant: N_("session allowed"), declined: N_("session declined"), end: N_("session ended"), pause: N_("paused"), resume: N_("resumed"), policy: N_("app lists changed"), screenshot: N_("screenshot"), move: N_("mouse move"), click: N_("click"), drag: N_("drag"), scroll: N_("scroll"), type: N_("typed text"), key: N_("key press") };
const REASONS = { escape: N_("Paused: you pressed Esc."), mouse: N_("Paused: you moved the mouse."), user: N_("Paused.") };

export function createComputerPanel(vs) {
  const { app } = vs;
  const el = h("div.of-vweb");
  const get = () => normalizeComputerUse(vibeStore.settings.computerUse);
  const save = (patch) => vibeStore.saveSettings({ computerUse: { ...get(), ...patch } });
  const desktop = computerAvailable();
  const fail = (err) => app.toast(err?.message || String(err), "danger", 6000);
  const lines = (text) => String(text || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
  let listening = false;

  async function render() {
    const p = get();
    let st = null;
    let error = "";
    if (desktop) {
      try {
        st = await computerInvoke("computer_status");
      } catch (err) {
        error = err?.message || String(err);
      }
    }
    empty(el);
    const usable = desktop && st?.supported;
    const on = h("sl-switch", { size: "small", disabled: !usable }, t("Allow the assistant to use this computer"));
    on.checked = !!p.enabled && usable;
    on.addEventListener("sl-change", async () => {
      // switching it off also ends a running session
      if (!on.checked) await computerInvoke("computer_stop").catch(() => {});
      save({ enabled: on.checked }).then(render);
    });
    el.append(h("div.of-vcard", h("strong", t("Computer use")),
      h("p.of-hint", t("Lets the assistant see your screen and, if you allow it, use the mouse and keyboard in other apps (tools computer and computer_info). Off by default and only in the desktop app on Windows and macOS. Every session needs your permission in a system dialog, has a time limit and can be stopped at any time. Screenshots go to the model provider you chose and are not stored by OpenFini. The assistant is told never to type passwords or payment details; enter those yourself.")),
      !desktop ? h("p.of-hint", t("Not available in the browser: a web page cannot see the screen or use the mouse and keyboard. Use the OpenFini desktop app on Windows or macOS."))
        : error ? h("div.of-empty", error)
          : !st.supported ? h("p.of-hint", t("Not available on this operating system yet. Computer use works in the desktop app on Windows and macOS."))
            : on));
    if (!usable || !p.enabled) return;

    if (!listening) {
      listening = true;
      Promise.resolve(globalThis.window?.__TAURI__?.event?.listen?.("openfini://computer", () => el.isConnected && render())).catch(() => {});
    }

    // ---- operating system permissions
    if (st.platform === "macos") {
      const row = (label, ok, pane) => h("div.of-vmem__item", { role: "listitem" }, iconEl(ok ? "check-circle" : "exclamation-triangle"), h("div.of-vmem__text", h("span", label), h("small", ok ? t("Allowed") : t("Not allowed yet"))),
        h("div.of-vmem__acts", h("button.of-btn.of-btn--sm", { type: "button", onclick: () => computerInvoke("computer_open_settings", { pane }).catch(fail) }, t("Open System Settings…"))));
      el.append(h("div.of-vcard", h("strong", t("macOS permissions")),
        h("p.of-hint", t("macOS asks you to allow two things in System Settings ▸ Privacy & Security: Screen & System Audio Recording (to see the screen) and Accessibility (to use the mouse and keyboard). After allowing screen recording, quit and reopen OpenFini.")),
        h("div.of-vmem__list", { role: "list" }, row(t("Screen recording"), st.screenPermission, "screen"), row(t("Accessibility (mouse and keyboard)"), st.accessibilityPermission, "accessibility")),
        h("div.of-vmem__row", h("button.of-btn", { type: "button", onclick: render }, iconEl("arrow-clockwise"), t("Check again")))));
    } else {
      el.append(h("div.of-vcard", h("strong", t("Windows notes")), h("p.of-hint", t("Windows does not let OpenFini control apps that run as administrator (for example an elevated terminal, Task Manager or installers) or the secure desktop (UAC prompts, the lock screen). Do those steps yourself."))));
    }

    // ---- the session
    const g = st.grant;
    const session = h("div.of-vcard", h("strong", t("Session")));
    if (g) {
      const mins = Math.max(1, Math.ceil(g.expiresInMs / 60000));
      session.append(
        h("p", { role: "status" }, g.scope === "control" ? t("Active: the assistant can see the screen and use the mouse and keyboard.") : t("Active: the assistant can see the screen (view only).")),
        h("p.of-hint", t("{minutes, plural, one {# minute} other {# minutes}} left · {actions, plural, one {# action} other {# actions}} so far", { minutes: mins, actions: g.actions }), " · ", g.scope !== "control" ? "" : g.autoLowRisk ? t("Clicks, scrolling and navigation keys run without asking; typing, shortcuts and drags ask.") : t("Every action asks for your approval.")),
        g.paused ? h("p", { role: "status" }, t(REASONS[g.paused] || REASONS.user)) : null,
        h("div.of-vmem__row",
          g.scope === "control" ? (g.paused
            ? h("button.of-btn", { type: "button", onclick: () => computerInvoke("computer_resume").then(render, fail) }, t("Resume"))
            : h("button.of-btn", { type: "button", onclick: () => computerInvoke("computer_pause").then(render, fail) }, t("Pause"))) : null,
          h("button.of-btn.of-btn--danger", { type: "button", onclick: () => computerInvoke("computer_stop").then(render, fail) }, iconEl("stop-fill"), t("Stop session"))),
        h("p.of-hint", t("You can also stop with the Stop button in the bar at the top of the screen or with {shortcut}. Pressing Esc pauses.", { shortcut: st.stopShortcut })));
    } else {
      const minutes = h("select.of-vfield__in", { "aria-label": t("Time limit") }, ...[5, 15, 30, 60].map((m) => h("option", { value: String(m), selected: m === p.minutes }, t("{n} minutes", { n: m }))));
      minutes.addEventListener("change", () => save({ minutes: Number(minutes.value) }));
      const auto = h("sl-checkbox", { size: "small" }, t("In this session, run clicks, scrolling and navigation keys without asking"));
      const start = (scope) => computerInvoke("computer_grant_request", { scope, minutes: Number(minutes.value), autoLowRisk: scope === "control" && auto.checked, locale: locale() }).then(render, fail);
      session.append(
        h("p.of-hint", t("No session is active. The assistant asks for one when it needs it, or you start one here. Either way a system dialog asks for your permission and says what is shared.")),
        h("label.of-vfield", h("span", t("Time limit")), minutes),
        auto,
        h("p.of-hint", t("By default every click, key press and text waits for your approval. With this option only typing text, shortcuts, Enter and drags ask; moving your mouse or pressing Esc pauses the assistant.")),
        h("div.of-vmem__row",
          h("button.of-btn", { type: "button", onclick: () => start("view") }, iconEl("eye"), t("Start a view-only session…")),
          h("button.of-btn", { type: "button", onclick: () => start("control") }, iconEl("display"), t("Start a session with control…"))));
    }
    el.append(session);

    // ---- limits
    const num = (label, key, lo, hi, hint) => {
      const input = h("input.of-vfield__in", { value: String(p[key]), inputmode: "numeric", "aria-label": label });
      input.addEventListener("keydown", (e) => e.stopPropagation());
      input.addEventListener("change", () => Number(input.value) >= lo && Number(input.value) <= hi && save({ [key]: Number(input.value) }));
      return h("label.of-vfield", h("span", label), input, h("small", hint));
    };
    const shots = h("sl-switch", { size: "small" }, t("Send a new screenshot after every action"));
    shots.checked = p.autoScreenshot;
    shots.addEventListener("sl-change", () => save({ autoScreenshot: shots.checked }));
    el.append(h("div.of-vcard", h("strong", t("Limits")),
      num(t("Actions per request"), "maxActionsPerTurn", 1, 200, t("After this many mouse and keyboard actions the assistant has to stop and report (1 to 200). A session allows 600 actions in total and at most 120 per minute.")),
      num(t("Screenshot size (px)"), "maxSize", 640, 2000, t("Longest side of the screenshots sent to the model (640 to 2000). Larger is easier to read and costs more.")),
      shots,
      h("button.of-btn", { type: "button", onclick: () => save({ ...DEFAULT_COMPUTER_USE(), enabled: true }).then(render) }, t("Reset to defaults"))));

    // ---- app lists
    try {
      const pol = await computerInvoke("computer_policy");
      const area = (label, value, hint) => {
        const ta = h("textarea.of-vfield__in", { rows: "3", "aria-label": label, disabled: !!g }, value.join("\n"));
        ta.addEventListener("keydown", (e) => e.stopPropagation());
        return { ta, field: h("label.of-vfield", h("span", label), ta, h("small", hint)) };
      };
      const deny = area(t("Never show or control (one app or window title per line)"), pol.deny, t("Added to the built-in list: {list}.", { list: st.defaultDeny.join(", ") }));
      const allow = area(t("Only control these apps (one per line; empty: every app that is not excluded)"), pol.allow, t("Windows of excluded apps are blacked out in screenshots and refuse clicks and keys. OpenFini's own windows always refuse input, so the assistant cannot approve its own actions."));
      const saveLists = h("button.of-btn", { type: "button", disabled: !!g }, t("Save lists"));
      saveLists.addEventListener("click", () => computerInvoke("computer_policy_set", { deny: lines(deny.ta.value), allow: lines(allow.ta.value) }).then(() => { app.toast(t("Saved."), "success", 2000); render(); }, fail));
      el.append(h("div.of-vcard", h("strong", t("Apps")), deny.field, allow.field, g ? h("p.of-hint", t("Stop the session to change the lists.")) : null, h("div.of-vmem__row", saveLists)));
    } catch (err) {
      el.append(h("div.of-vcard", h("strong", t("Apps")), h("div.of-empty", err?.message || String(err))));
    }

    // ---- action log
    const log = h("div.of-ailog__list");
    const clear = h("button.of-btn", { type: "button" }, iconEl("trash3"), t("Clear action log…"));
    clear.addEventListener("click", async () => {
      if (await confirmDialog({ title: t("Clear action log"), message: t("Delete the record of every screenshot and action of computer use?"), ok: t("Delete"), danger: true })) computerInvoke("computer_audit_clear").then(render, fail);
    });
    el.append(h("div.of-vcard", h("strong", t("Action log")), h("p.of-hint", t("Every session, screenshot, click and key press, newest first. Screenshots and typed text are never recorded, only their size.")), log, h("div.of-vmem__row", clear)));
    try {
      const rows = (await computerInvoke("computer_audit", { limit: 300 })).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
      for (const r of rows) log.append(h("div.of-ailog__row", { "data-status": r.ok ? "ok" : "error" }, h("span", new Date(r.time).toLocaleString(app.i18n?.locale?.() || undefined)), h("span", OPS[r.op] ? t(OPS[r.op]) : r.op), h("span", { title: r.detail }, r.detail), h("span", { title: r.app }, r.app), h("span", { title: r.error || "" }, r.ok ? "" : r.error || t("failed"))));
      if (!rows.length) log.append(h("div.of-empty", t("Nothing recorded yet.")));
    } catch (err) {
      log.append(h("div.of-empty", err?.message || String(err)));
    }
  }
  render();
  return { el, show: render };
}
