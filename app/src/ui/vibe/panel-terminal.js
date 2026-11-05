// Settings ▸ Artificial intelligence ▸ Terminal: master switch for run_command (off by default, desktop app only), the
// allow list, deny list and deny patterns, time limit and output cap. Policy logic: ../../vibe/terminal-policy.js.
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { DEFAULT_TERMINAL, normalizeTerminal } from "../../vibe/terminal-policy.js";

export function createTerminalPanel() {
  const el = h("div.of-vweb");
  const get = () => normalizeTerminal(vibeStore.settings.terminal);
  const save = (patch) => vibeStore.saveSettings({ terminal: { ...get(), ...patch } });
  const field = (label, control, hint) => h("label.of-vfield", h("span", label), control, hint ? h("small", hint) : null);
  const list = (value, onChange, sep = /[\s,]+/) => {
    const a = h("textarea.of-vfield__in", { rows: 3, spellcheck: false });
    a.value = (value || []).join(sep.source.includes("\\n") ? "\n" : " ");
    a.addEventListener("change", () => onChange(a.value.split(sep).map((s) => s.trim()).filter(Boolean)));
    a.addEventListener("keydown", (e) => e.stopPropagation());
    return a;
  };
  const num = (value, unit, onChange, min) => {
    const i = h("input.of-vfield__in", { value: String(Math.round(value / unit)), inputmode: "numeric" });
    i.addEventListener("change", () => Number(i.value) >= min && onChange(Number(i.value) * unit));
    return i;
  };
  function render() {
    empty(el);
    const p = get();
    const desktop = !!globalThis.window?.__TAURI__?.core;
    const on = h("sl-switch", { size: "small", disabled: !desktop }, t("Allow the assistant to run commands"));
    on.checked = !!p.enabled;
    on.addEventListener("sl-change", () => {
      save({ enabled: on.checked });
      render();
    });
    el.append(h("div.of-vcard", h("strong", t("Terminal access")), h("p.of-hint", t("Lets the assistant run programs (tool run_command) in folders you opened with File ▸ Open Folder. Off by default and only in the desktop app. Every command asks for your approval and shows the exact program and arguments. No shell is used, so pipes, redirects and variables do not work. An allowed interpreter (node, python, npm scripts) can run any code: allow only what you trust.")), on));
    if (!p.enabled) return;
    el.append(h("div.of-vcard", h("strong", t("Policy")),
      field(t("Allowed programs"), list(p.allow, (v) => save({ allow: v })), t("Program names, separated by spaces. Shells are never allowed.")),
      field(t("Denied programs"), list(p.deny, (v) => save({ deny: v })), t("Always refused, even when on the allowed list.")),
      field(t("Denied patterns"), list(p.denyPatterns, (v) => save({ denyPatterns: v }), /\n+/), t("One per line, for example git push --force. A single word matches an argument exactly.")),
      field(t("Time limit (seconds)"), num(p.timeoutMs, 1000, (v) => save({ timeoutMs: v }), 1)),
      field(t("Output cap (KiB)"), num(p.maxOutputBytes, 1024, (v) => save({ maxOutputBytes: v }), 4)),
      h("button.of-btn", { type: "button", onclick: () => { save({ ...DEFAULT_TERMINAL(), enabled: true }); render(); } }, t("Reset to defaults"))));
  }
  render();
  return { el, show: render };
}
