// Vibe Studio: chat with an assistant that works inside OpenFini. Left: chats. Center: conversation and composer.
// Right: Canvas (live view of the document), Activity (plan, undo), Models, Tools, Skills and Knowledge.
import { h, empty, debounce } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { iconEl } from "../toolbox.js";
import { showContextMenu } from "../menus.js";
import { confirmDialog } from "../dialogs.js";
import { vibeStore } from "../../vibe/store.js";
import { VibeSession } from "../../vibe/session.js";
import { createChat } from "./chat.js";
import { createCanvasPanel } from "./panel-canvas.js";
import { createActivityPanel } from "./panel-activity.js";
import { createRunLog } from "./run-log.js";
import { createModelsPanel } from "./panel-models.js";
import { createToolsPanel } from "./panel-tools.js";
import { createSkillsPanel, createKnowledgePanel } from "./panel-knowledge.js";

const TABS = [
  { id: "canvas", icon: "window", label: "Canvas" },
  { id: "activity", icon: "list-check", label: "Activity" },
  { id: "models", icon: "cpu", label: "Models" },
  { id: "tools", icon: "tools", label: "Tools" },
  { id: "skills", icon: "mortarboard", label: "Skills" },
  { id: "knowledge", icon: "journal-text", label: "Knowledge" },
];

let instance = null;

/** Vibe Studio is a singleton (one assistant for all open documents). */
export function vibeStudio(app) {
  if (instance) return instance;
  const session = new VibeSession(app);
  const vs = { app, session, tab: "canvas", sideOpen: true, listOpen: true };
  vs.timeline = createRunLog(session); // records the Activity log from the first message on, even while the tab is closed
  vs.skills = () => session.ctx?.skills || [];
  vs.openTab = (id) => {
    vs.tab = id;
    vs.sideOpen = true;
    renderSide();
  };

  const list = h("div.of-vlist");
  const chatHost = h("div.of-vmain");
  const side = h("aside.of-vside");
  const root = h("div.of-vibe", list, chatHost, side);
  let chat = null;

  // ------------------------------------------------------------ chat list
  function renderList() {
    empty(list);
    list.append(
      h("div.of-vlist__head", h("strong", "Vibe"), iconButton({ icon: "pencil-square", label: "New chat", onClick: () => session.newChat() })),
      h("div.of-vlist__items", vibeStore.chats.length ? vibeStore.chats.map((c) => {
        const row = h("button.of-vlist__row", { type: "button", class: c.id === session.chat.id ? "active" : "" }, h("span", c.title), h("small", new Date(c.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" })));
        row.addEventListener("click", () => session.openChat(c.id));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showContextMenu(app, e.clientX, e.clientY, [{ label: "Delete chat", icon: "trash3", run: async () => { if (await confirmDialog({ title: "Delete chat", message: `Delete “${c.title}”?`, ok: "Delete", danger: true })) { await vibeStore.deleteChat(c.id); if (c.id === session.chat.id) session.newChat(); } } }]);
        });
        return row;
      }) : h("div.of-empty", "Your chats appear here.")),
    );
  }

  // ------------------------------------------------------------ side panel
  const panels = new Map();
  function renderSide() {
    empty(side);
    side.classList.toggle("collapsed", !vs.sideOpen);
    const tabs = h("div.of-vside__tabs", { role: "tablist" }, TABS.map((t) => {
      const b = h("button.of-vside__tab", { type: "button", role: "tab", class: t.id === vs.tab && vs.sideOpen ? "active" : "", "aria-selected": String(t.id === vs.tab), "data-tip": t.label, "aria-label": t.label }, iconEl(t.icon), h("span", t.label));
      b.addEventListener("click", () => (t.id === vs.tab && vs.sideOpen ? ((vs.sideOpen = false), renderSide()) : vs.openTab(t.id)));
      return b;
    }));
    side.append(tabs);
    if (!vs.sideOpen) return;
    if (!panels.has(vs.tab)) {
      const make = { canvas: createCanvasPanel, activity: createActivityPanel, models: createModelsPanel, tools: createToolsPanel, skills: createSkillsPanel, knowledge: createKnowledgePanel }[vs.tab];
      panels.set(vs.tab, make(vs));
    }
    const p = panels.get(vs.tab);
    side.append(h("div.of-vside__body", p.el));
    p.show?.();
  }

  // ------------------------------------------------------------ model picker popover
  vs.openModelPicker = async (anchor) => {
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
            pop.remove();
            return;
          }
          body.replaceChildren(h("div.of-empty", "Loading models…"));
          let models = [];
          try {
            const prov = await session.providerFor(row.id);
            models = (await prov.listModels()).map((m) => m.id);
          } catch (err) {
            body.replaceChildren(h("div.of-empty", err.message), h("button.of-btn", { type: "button", onclick: () => { pop.remove(); vs.openTab("models"); } }, "Open Models"));
            return;
          }
          const filter = h("input.of-side__search", { type: "search", placeholder: `Search ${models.length} models…`, "aria-label": "Search models" });
          const items = h("div.of-modelpop__list");
          const paint = () => {
            empty(items);
            const q = filter.value.toLowerCase();
            for (const id of models.filter((m) => m.toLowerCase().includes(q)).slice(0, 150)) {
              const b = h("button.of-modelpop__model", { type: "button", class: id === s.model && active ? "active" : "" }, id);
              b.addEventListener("click", async () => {
                await vibeStore.saveSettings({ activeProvider: row.id, model: id });
                pop.remove();
              });
              items.append(b);
            }
            if (q && !items.children.length) items.append(h("button.of-modelpop__model", { type: "button", onclick: async () => { await vibeStore.saveSettings({ activeProvider: row.id, model: filter.value.trim() }); pop.remove(); } }, `Use “${filter.value.trim()}”`));
          };
          filter.addEventListener("input", paint);
          filter.addEventListener("keydown", (e) => e.stopPropagation());
          body.replaceChildren(h("button.of-modelpop__back", { type: "button", onclick: draw }, "← Providers"), filter, items);
          paint();
          filter.focus();
        });
        body.append(head);
      }
      body.append(h("button.of-modelpop__manage", { type: "button", onclick: () => { pop.remove(); vs.openTab("models"); } }, iconEl("gear"), "Manage connections…"));
    };
    draw();
  };

  vibeStore.on("change", (g) => {
    if (g === "chats" || g === "all") renderList();
  });
  session.on("chat", renderList);
  session.on("status", renderList);

  const ready = vibeStore.load().then(() => {
    chat = createChat(vs);
    vs.chat = chat;
    chatHost.append(chat.el);
    renderList();
    renderSide();
  });
  void debounce;

  instance = { el: root, vs, session, ready, activate: () => chat?.focus() };
  app.vibe = instance;
  return instance;
}
