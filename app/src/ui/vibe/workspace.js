// Vibe Studio: chat with an assistant that works inside OpenFini. Left: chats. Center: conversation and composer.
// Right: Canvas (live view of the document, layers, before/after) and Activity (plan, undo). Models, Tools, Skills and
// Knowledge live in Settings ▸ Artificial intelligence (settings-ai.js); vs.openTab("models" | …) opens them there.
import { t } from "../../i18n/index.js";
import { h, empty } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { iconEl } from "../toolbox.js";
import { showContextMenu } from "../menus.js";
import { confirmDialog } from "../dialogs.js";
import { groupModelsForMenu } from "../../ai/providers/ollama.js";
import { vibeStore } from "../../vibe/store.js";
import { getVibeHub } from "../../vibe/hub.js";
import { chatRowExtras, chatListHead } from "./chat-list.js";
import { nestChats } from "../../vibe/chat-ops.js";
import { createChat } from "./chat.js";
import { setPanelSlot } from "../panels/slots.js";
import { createCanvasPanel } from "./panel-canvas.js";
import { createActivityPanel } from "./panel-activity.js";
import { createRunLog } from "./run-log.js";
import { openAiSettings, AI_TABS } from "./settings-ai.js";
import { getChangeRecorder } from "./change-recorder.js";

let instance = null;

/** Vibe Studio is a singleton (one assistant for all open documents). */
export function vibeStudio(app) {
  if (instance) return instance;
  const hub = getVibeHub(app);
  const session = hub.view; // the active chat; forwards the active session's events (hub.js SessionView)
  const vs = { app, session, hub, tab: "canvas" };
  // one Activity log per chat, recording from the first message on (even while the tab is closed or the chat is in the background)
  const timelines = new Map();
  const timelineOf = (s) => {
    if (!timelines.has(s.id)) timelines.set(s.id, createRunLog(s));
    return timelines.get(s.id);
  };
  for (const s of hub.sessions.values()) if (!s.hidden) timelineOf(s);
  hub.on("sessions", () => {
    for (const s of hub.sessions.values()) if (!s.hidden) timelineOf(s);
    for (const id of timelines.keys()) if (!hub.sessions.has(id)) timelines.delete(id);
  });
  Object.defineProperty(vs, "timeline", { get: () => (hub.active ? timelineOf(hub.active) : null) });
  vs.skills = () => session.ctx?.skills || [];
  vs.allSkills = async () => {
    const ai = await hub.ai();
    const user = vibeStore.skills.filter((x) => x.enabled !== false).map((x) => ({ ...ai.parseSkill(ai.serializeSkill(x)), files: x.files, source: "user" }));
    return [...user, ...[...ai.BUILTIN_SKILL_LIST, ...ai.PACK_SKILL_LIST].map((x) => ({ ...x, source: "builtin" })).filter((b) => !user.some((u) => u.name === b.name))];
  };
  vs.changes = getChangeRecorder(app, hub);
  vs.openTab = (id) => {
    // the former Models / Tools / Skills / Knowledge tabs moved to Settings ▸ Artificial intelligence
    if (AI_TABS.some((x) => x.id === id)) return openAiSettings(app, id);
    vs.tab = id;
    app.dock?.reveal(`vibe-${id}`);
  };

  const list = h("div.of-vlist");
  const chatHost = h("div.of-vmain");
  const root = h("div.of-vibe", chatHost);
  let chat = null;

  // ------------------------------------------------------------ chat list
  function renderList() {
    const hadFocus = list.contains(document.activeElement) ? document.activeElement.dataset?.chat : null;
    empty(list);
    // chats in memory that are not stored yet (a new chat that is about to run) come first, then the stored ones
    const stored = new Set(vibeStore.chats.map((c) => c.id));
    const live = [...hub.sessions.values()].filter((s) => !s.hidden && !stored.has(s.chat.id) && (s.chat.messages.length || s.running)).map((s) => ({ id: s.chat.id, title: s.chat.title, updated: Date.now() }));
    const chats = [...live, ...vibeStore.chats];
    list.append(
      chatListHead(vs, iconButton({ icon: "pencil-square", label: "New chat", onClick: () => session.newChat() })),
      h("div.of-vlist__items", chats.length ? nestChats(chats).map(({ chat: c, sub }) => {
        const st = hub.statusOf(c.id);
        const row = h("button.of-vlist__row", { type: "button", class: `${c.id === session.chat.id ? "active" : ""}${sub ? " sub" : ""}`, title: sub ? t("Sub-thread") : null, "data-chat": c.id, "aria-current": c.id === session.chat.id ? "true" : null }, h("span", c.title), ...chatRowExtras(vs, c, st), h("small", new Date(c.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" })));
        row.addEventListener("click", () => session.openChat(c.id));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const s = hub.sessions.get(st.id);
          const items = [];
          if (st.running) items.push({ label: "Stop this chat", icon: "stop-fill", run: () => s?.abort() });
          if (s) {
            const ov = s.overrides || {};
            const cur = vibeStore.settings;
            items.push(
              { label: ov.model ? `Model for this chat: ${ov.model} (use default)` : `Pin the current model (${cur.model || "demo"}) to this chat`, icon: "cpu", run: () => s.setOverrides(ov.model ? { model: null, activeProvider: null } : { model: cur.model || "demo", activeProvider: cur.activeProvider || null }) },
              ...["careful", "balanced", "auto"].map((k) => ({ label: `Approval for this chat: ${k}`, checked: ov.approval === k, run: () => s.setOverrides({ approval: ov.approval === k ? null : k }) })),
            );
          }
          items.push({ label: "Delete chat", icon: "trash3", run: async () => { if (await confirmDialog({ title: "Delete chat", message: `Delete “${c.title}”?`, ok: "Delete", danger: true })) { await vibeStore.deleteChat(c.id); if (st.id) hub.remove(st.id); } } });
          showContextMenu(app, e.clientX, e.clientY, items);
        });
        return row;
      }) : h("div.of-empty", "Your chats appear here.")),
    );
    if (hadFocus) list.querySelector(`[data-chat="${CSS.escape(hadFocus)}"]`)?.focus();
  }

  // ------------------------------------------------------------ dockable panels
  // Chats, Canvas and Activity are panels of the docking engine (vibe-chats, vibe-canvas, vibe-activity; docs/workspaces.md).
  // Canvas and Activity are built the first time they are shown and then only moved.
  const panels = new Map();
  const slotFor = (id, make) => {
    const el = h("div.of-vside__body");
    return { el, show: () => {
      if (!panels.has(id)) {
        panels.set(id, make(vs));
        el.replaceChildren(panels.get(id).el);
      }
      panels.get(id).show?.();
    } };
  };
  const slots = { "vibe-chats": { el: list }, "vibe-canvas": slotFor("canvas", createCanvasPanel), "vibe-activity": slotFor("activity", createActivityPanel) };
  function renderSide() {
    for (const [id, c] of Object.entries(slots)) setPanelSlot(app, id, c);
  }

  // ------------------------------------------------------------ model picker popover
  vs.openModelPicker = async (anchor, { onPick = null } = {}) => {
    document.querySelector(".of-modelpop")?.remove();
    const pop = h("div.of-modelpop", { role: "dialog", "aria-label": "Choose a model" });
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 380))}px`;
    pop.style.bottom = `${innerHeight - r.top + 8}px`;
    document.body.append(pop);
    const close = (e) => {
      if (e && pop.contains(e.target)) return;
      pop.remove();
      document.removeEventListener("pointerdown", close, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
    const s = vibeStore.settings;
    const picked = () => {
      pop.remove();
      onPick?.();
    };
    const body = h("div.of-modelpop__body");
    pop.append(body);
    const draw = async () => {
      empty(body);
      const rows = [{ id: null, label: "Demo (offline)", sub: "Scripted assistant for trying Vibe without a key", model: "demo" }];
      for (const p of vibeStore.providers) rows.push({ id: p.id, label: p.label, sub: p.baseUrl, model: null });
      for (const row of rows) {
        const active = (s.activeProvider || null) === row.id;
        const head = h("button.of-modelpop__prov", { type: "button", class: active ? "active" : "" }, h("strong", row.label), h("small", row.sub));
        head.addEventListener("click", async () => {
          if (row.id === null) {
            await vibeStore.saveSettings({ activeProvider: null, model: "demo" });
            picked();
            return;
          }
          body.replaceChildren(h("div.of-empty", "Loading models…"));
          let models = [];
          let ollama = false;
          try {
            const prov = await session.providerFor(row.id);
            models = (await prov.listModels()).filter((m) => !m.embedding);
            ollama = prov.kind === "ollama";
          } catch (err) {
            // many custom endpoints have no model list: let the user type the model id instead
            const manual = h("input.of-side__search", { type: "text", placeholder: "Model id, e.g. my-model-7b", "aria-label": "Model id", spellcheck: false });
            manual.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Enter") use.click();
            });
            const use = h("button.of-btn.of-btn--primary", { type: "button", onclick: async () => { const id = manual.value.trim(); if (!id) return; await vibeStore.saveSettings({ activeProvider: row.id, model: id }); picked(); } }, "Use this model");
            body.replaceChildren(h("button.of-modelpop__back", { type: "button", onclick: draw }, "← Providers"), h("div.of-empty", `No model list available (${err.message}). Type the model id your server expects.`), manual, use, h("button.of-btn", { type: "button", onclick: () => { pop.remove(); vs.openTab("models"); } }, "Open Models"));
            manual.focus();
            return;
          }
          const filter = h("input.of-side__search", { type: "search", placeholder: `Search ${models.length} models…`, "aria-label": "Search models" });
          const items = h("div.of-modelpop__list");
          const paint = () => {
            empty(items);
            const q = filter.value.toLowerCase();
            const modelRow = (id, badges = []) => {
              const b = h("button.of-modelpop__model", { type: "button", class: id === s.model && active ? "active" : "" }, h("span", id), badges.length ? h("span.of-modelpop__badges", badges.map((x) => h("span.of-badge", t(x)))) : null);
              b.addEventListener("click", async () => {
                await vibeStore.saveSettings({ activeProvider: row.id, model: id });
                picked();
              });
              items.append(b);
            };
            if (ollama) {
              for (const g of groupModelsForMenu(models, q)) {
                items.append(h("div.of-modelpop__group", g.id === "cloud" ? t("Cloud") : t("Local")));
                for (const m of g.models) modelRow(m.id, m.badges);
              }
            } else for (const m of models.filter((m) => m.id.toLowerCase().includes(q)).slice(0, 150)) modelRow(m.id);
            if (q && !items.children.length) items.append(h("button.of-modelpop__model", { type: "button", onclick: async () => { await vibeStore.saveSettings({ activeProvider: row.id, model: filter.value.trim() }); picked(); } }, `Use “${filter.value.trim()}”`));
          };
          filter.addEventListener("input", paint);
          filter.addEventListener("keydown", (e) => e.stopPropagation());
          body.replaceChildren(h("button.of-modelpop__back", { type: "button", onclick: draw }, "← Providers"), filter, items);
          paint();
          filter.focus();
        });
        body.append(head);
      }
      const chain = (s.routes || []).find((r) => r.id === s.activeRoute);
      if (chain?.targets?.some((x) => x.enabled !== false)) {
        const on = session.overrides?.fallback !== false;
        const cb = h("input", { type: "checkbox", checked: on });
        cb.addEventListener("change", () => session.setOverrides({ fallback: cb.checked ? null : false }));
        body.append(h("label.of-modelpop__manage", cb, h("span", t("Use fallback chain in this chat"))));
      }
      body.append(h("button.of-modelpop__manage", { type: "button", onclick: () => { pop.remove(); vs.openTab("models"); } }, iconEl("gear"), "Manage connections…"));
    };
    draw();
  };

  vibeStore.on("change", (g) => {
    if (g === "chats" || g === "all") renderList();
  });
  session.on("chat", renderList);
  let listRaf = 0;
  hub.on("sessions", () => (listRaf ||= requestAnimationFrame(() => ((listRaf = 0), renderList()))));

  const ready = vibeStore.load().then(() => {
    chat = createChat(vs);
    vs.chat = chat;
    chatHost.append(chat.el);
    renderList();
    renderSide();
  });

  renderSide();
  instance = { el: root, vs, session, ready, activate: () => chat?.focus() };
  app.vibe = instance;
  return instance;
}
