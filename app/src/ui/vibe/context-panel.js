// Vibe composer ▸ Context: what the next request sends (instructions, tool definitions, memories, messages,
// attachments, tool calls and results) with estimated tokens against the model's context window, and controls to drop
// items: a tool result or attachment (replaced by a marker), a whole turn, a memory for this chat, memory for this chat
// altogether, or every older tool result at once. Pure model: ../../vibe/context-items.js. docs/vibe-memory.md.
//
// Public API: openContextPanel(vs, anchor, { draft }) → closes itself on outside click or Escape
import { h, empty } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { iconEl } from "../toolbox.js";
import { vibeStore } from "../../vibe/store.js";

const GROUPS = [
  ["system", N_("Instructions")],
  ["tools", N_("Tool definitions")],
  ["memory", N_("Memory")],
  ["message", N_("Messages")],
  ["attachment", N_("Files and images")],
  ["tool_call", N_("Tool calls")],
  ["tool_result", N_("Tool results")],
];

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export async function openContextPanel(vs, anchor, { draft = "" } = {}) {
  const { session, app } = vs;
  document.querySelector(".of-ctxpop")?.remove();
  const pop = h("div.of-ctxpop.of-modelpop", { role: "dialog", "aria-label": t("Context window") });
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 440))}px`;
  pop.style.bottom = `${innerHeight - r.top + 8}px`;
  document.body.append(pop);
  const close = (e) => {
    if (e && e.type === "pointerdown" && pop.contains(e.target)) return;
    if (e && e.type === "keydown" && e.key !== "Escape") return;
    pop.remove();
    document.removeEventListener("pointerdown", close, true);
    document.removeEventListener("keydown", close, true);
    anchor.focus?.();
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
  }, 0);
  const body = h("div.of-ctxpop__body", h("div.of-empty", t("Measuring…")));
  pop.append(body);
  const M = await import("../../vibe/context-items.js");
  const open = new Set(["memory", "tool_result", "attachment"]);

  const save = () => {
    session.emit("chat");
    if (session.chat.messages.length) vibeStore.saveChat(session.chat).catch(() => {});
  };

  async function paint() {
    let pre;
    try {
      pre = await session.previewContext(draft);
    } catch (err) {
      body.replaceChildren(h("div.of-empty", err?.message || String(err)));
      return;
    }
    if (!pop.isConnected) return;
    const chat = session.chat;
    const { items, total, byKind } = M.contextItems({ system: pre.system, tools: pre.tools, memory: pre.memory, messages: chat.messages });
    const model = (session.settings?.() || vibeStore.settings).model || "demo";
    const limit = M.contextWindowFor(model);
    const pct = Math.min(100, Math.round((total / limit) * 100));
    empty(body);
    body.append(
      h("div.of-ctxpop__head", h("strong", t("Context window")), h("span", t("{used} of about {limit} tokens ({pct} %)", { used: fmt(total), limit: fmt(limit), pct }))),
      h("div.of-ctxpop__meter", { role: "meter", "aria-valuemin": "0", "aria-valuemax": String(limit), "aria-valuenow": String(total), "aria-label": t("Context used") },
        ...GROUPS.filter(([k]) => byKind[k]).map(([k, label]) => h("span", { class: `k-${k}`, style: { width: `${Math.max(0.5, (byKind[k] / Math.max(total, limit)) * 100)}%` }, title: `${t(label)}: ${fmt(byKind[k])}` }))),
      h("small.of-hint", t("Estimates (about four characters per token). Older tool results and images are shortened automatically when a request gets too large.")),
    );
    if (pct >= 80) body.append(h("div.of-vnote.info", iconEl("info-circle"), h("span", t("The context is nearly full. Drop large tool results or start a sub-thread for side questions."))));

    // memory switch for this chat
    const memSwitch = h("sl-switch", { size: "small", checked: session.memoryOn?.() ?? true, disabled: vibeStore.settings.memoryEnabled === false }, t("Use memory in this chat"));
    memSwitch.addEventListener("sl-change", () => {
      chat.memoryOff = !memSwitch.checked || undefined;
      save();
      paint();
    });
    const tools = h("div.of-ctxpop__tools", memSwitch);
    if (chat.memoryExclude?.length) tools.append(h("button.of-btn.of-btn--sm", { type: "button", onclick: () => { delete chat.memoryExclude; save(); paint(); } }, t("Restore {n, plural, one {# dropped memory} other {# dropped memories}}", { n: chat.memoryExclude.length })));
    if (byKind.tool_result) tools.append(h("button.of-btn.of-btn--sm", { type: "button", disabled: session.running, onclick: () => { chat.messages = M.dropOldToolResults(chat.messages); save(); paint(); } }, iconEl("trash3"), t("Drop older tool results")));
    body.append(tools);
    if (vibeStore.settings.memoryEnabled === false) body.append(h("small.of-hint", t("Memory is switched off for all chats in Settings ▸ Artificial intelligence ▸ Memory.")));

    for (const [kind, label] of GROUPS) {
      const list = items.filter((x) => x.kind === kind);
      if (!list.length) continue;
      const sum = list.reduce((n, x) => n + x.tokens, 0);
      const head = h("button.of-ctxpop__group", { type: "button", "aria-expanded": String(open.has(kind)) }, iconEl(open.has(kind) ? "chevron-down" : "chevron-right"), h("span", `${t(label)} (${list.length})`), h("small", fmt(sum)));
      head.addEventListener("click", () => {
        open.has(kind) ? open.delete(kind) : open.add(kind);
        paint();
      });
      body.append(head);
      if (!open.has(kind) || kind === "system" || kind === "tools") continue;
      const rows = h("div.of-ctxpop__rows");
      for (const it of [...list].sort((a, b) => b.tokens - a.tokens).slice(0, 60)) {
        const drop = it.droppable
          ? h("button.of-btn.of-btn--sm", { type: "button", disabled: session.running && it.kind !== "memory", "aria-label": t("Remove “{item}” from the context", { item: it.label }) }, iconEl("x-lg"))
          : null;
        drop?.addEventListener("click", () => {
          if (it.kind === "memory") chat.memoryExclude = [...new Set([...(chat.memoryExclude || []), it.memoryId])];
          else chat.messages = M.dropContextItem(chat.messages, it);
          save();
          paint();
        });
        rows.append(h("div.of-ctxpop__row", h("span", it.role === "assistant" ? `↳ ${it.label}` : it.label), h("small", fmt(it.tokens)), drop));
      }
      if (list.length > 60) rows.append(h("small.of-hint", t("{n} smaller items not shown", { n: list.length - 60 })));
      body.append(rows);
    }
    if (pre.memory.length < (pre.considered || 0)) body.append(h("small.of-hint", t("{n} of {total} saved memories match this request; the others stay on this device.", { n: pre.memory.length, total: pre.considered })));
    body.append(h("button.of-modelpop__manage", { type: "button", onclick: () => { close(); vs.openTab("memory"); } }, iconEl("lightbulb"), t("Manage memories…")));
  }
  paint();
  return { close, refresh: paint };
}

