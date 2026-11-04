// Right-click ▸ AI ▸ Custom instruction…: a small dialog with a prompt field, the recent custom instructions (kept on
// this device, localStorage, at most HISTORY_MAX) and what to attach. Resolves with
// { prompt, selection, document, screenshot, answer } or null. The caller starts the chat (vibe/quick-actions.js).
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { openDialog } from "../dialogs.js";

export const HISTORY_KEY = "of.vibe.customInstructions";
export const HISTORY_MAX = 12;

export function loadHistory(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

/** Puts `prompt` first (no duplicates) and keeps HISTORY_MAX entries. Pure apart from the storage write. */
export function rememberInstruction(prompt, storage = globalThis.localStorage) {
  const p = String(prompt).trim().slice(0, 2000);
  if (!p) return loadHistory(storage);
  const next = [p, ...loadHistory(storage).filter((x) => x !== p)].slice(0, HISTORY_MAX);
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* private mode: history is a convenience */
  }
  return next;
}

export function customInstructionDialog(app, target) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) (done = true), resolve(v);
    };
    const ta = h("textarea.of-input.of-ci__prompt", { rows: "4", placeholder: t("What should Vibe do? For example: make this warmer and more playful"), "aria-label": t("Instruction") });
    const check = (label, on, disabled = false) => {
      const box = h("input", { type: "checkbox" });
      box.checked = !!on;
      box.disabled = !!disabled;
      return [h("label.of-ci__opt", box, h("span", t(label))), box];
    };
    const hasSel = !!(target?.ids?.length || /code|text|cells|element|slides|board/.test(target?.kind || ""));
    const [selL, sel] = check("Attach the selection", hasSel, !hasSel);
    const [docL, whole] = check("Include the whole document", !hasSel);
    const [shotL, shot] = check("Attach a screenshot of the selection", !!target?.ids?.length, !target?.ids?.length);
    const [ansL, answer] = check("Only answer, do not change anything", false);
    const hist = loadHistory();
    const list = hist.length
      ? h("div.of-ci__history", { role: "list", "aria-label": t("Recent instructions") }, ...hist.map((p) => h("button.of-chip2.of-ci__recent", { type: "button", role: "listitem", title: p, onclick: () => ((ta.value = p), ta.focus()) }, p.length > 60 ? `${p.slice(0, 60)}…` : p)))
      : null;
    const go = (close) => {
      const prompt = ta.value.trim();
      if (!prompt) return ta.focus();
      rememberInstruction(prompt);
      finish({ prompt, selection: sel.checked, document: whole.checked, screenshot: shot.checked, answer: answer.checked });
      close();
    };
    const body = h(
      "div.of-ci",
      target?.label ? h("p.of-ci__target", t("Target: {what}", { what: target.label })) : null,
      ta,
      list ? h("p.of-ci__label", t("Recent")) : null,
      list,
      h("div.of-ci__opts", selL, docL, shotL, ansL),
    );
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.preventDefault(), go(d.close));
    });
    const d = openDialog({ title: "Custom instruction", body, width: 520, onClose: () => finish(null), buttons: [{ label: "Cancel", onClick: (c) => (finish(null), c()) }, { label: "Start chat", variant: "primary", onClick: (c) => go(c) }] });
    setTimeout(() => ta.focus(), 80);
  });
}
