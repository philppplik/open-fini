// Settings ▸ Artificial intelligence: hosts the Vibe panels that used to be side-panel tabs (Models, Tools and MCP,
// Skills, Knowledge and memory) behind a small sub-navigation. The panel factories are reused unchanged; they get a
// `vs`-like object that works even before Vibe Studio was opened (the hub is created on demand).
//
// Public API
//   aiSettingsPanels(app, tab?) → HTMLElement   (tab: "models" | "tools" | "skills" | "knowledge")
//   AI_TABS                                     the sub-tabs (id, icon, label)
//   openAiSettings(app, tab)                    opens Settings at Artificial intelligence ▸ tab
// Invariants: one panel instance per tab and app (they subscribe to vibeStore once); remounting just moves the element.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconEl } from "../toolbox.js";
import { vibeStore } from "../../vibe/store.js";
import { getVibeHub } from "../../vibe/hub.js";

export const AI_TABS = [
  { id: "models", icon: "cpu", label: "Models and connections" },
  { id: "tools", icon: "tools", label: "Tools and MCP" },
  { id: "web", icon: "globe2", label: "Web access" },
  { id: "skills", icon: "mortarboard", label: "Skills" },
  { id: "knowledge", icon: "journal-text", label: "Knowledge and memory" },
];

const LOADERS = {
  models: () => import("./panel-models.js").then((m) => m.createModelsPanel),
  tools: () => import("./panel-tools.js").then((m) => m.createToolsPanel),
  web: () => import("./panel-web.js").then((m) => m.createWebPanel),
  skills: () => import("./panel-skills.js").then((m) => m.createSkillsPanel),
  knowledge: () => import("./panel-knowledge.js").then((m) => m.createKnowledgePanel),
};

const cache = new WeakMap(); // app → { panels: Map, tab, vs }

/** Opens Settings ▸ Artificial intelligence at one sub-tab. */
export function openAiSettings(app, tab = "models") {
  app.emit("dialog", { id: "preferences", section: "ai", tab });
}

/** Resolves once Vibe Studio's chat exists (opening the studio when needed). */
export async function whenChat(app) {
  if (app.studio !== "vibe") app.setStudio("vibe");
  for (let i = 0; i < 100 && !app.vibe?.vs?.chat; i++) await new Promise((r) => setTimeout(r, 30));
  return app.vibe?.vs?.chat || null;
}

function settingsVs(app) {
  const hub = getVibeHub(app);
  const closeSettings = () => document.querySelector("sl-dialog.of-settings")?.hide();
  return {
    app,
    hub,
    session: hub.view,
    get chat() {
      return app.vibe?.vs?.chat || null;
    },
    openTab(id) {
      closeSettings();
      whenChat(app).then(() => app.vibe?.vs?.openTab(id));
    },
    skills: () => hub.view.ctx?.skills || [],
  };
}

export function aiSettingsPanels(app, tab) {
  let st = cache.get(app);
  if (!st) cache.set(app, (st = { panels: new Map(), tab: "models", vs: null }));
  if (tab && LOADERS[tab]) st.tab = tab;
  const nav = h("div.of-vset__tabs", { role: "tablist", "aria-label": t("AI settings") });
  const body = h("div.of-vset__body", { role: "tabpanel" });
  const root = h("div.of-vset", nav, body);

  const paintNav = () => {
    nav.replaceChildren(...AI_TABS.map((x) => {
      const b = h("button.of-vset__tab", { type: "button", role: "tab", id: `of-vset-${x.id}`, "aria-selected": String(x.id === st.tab), tabindex: x.id === st.tab ? "0" : "-1" }, iconEl(x.icon), h("span", t(x.label)));
      b.addEventListener("click", () => show(x.id));
      b.addEventListener("keydown", (e) => {
        const i = AI_TABS.indexOf(x);
        const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? AI_TABS.length - 1 : null;
        if (j == null) return;
        e.preventDefault();
        show(AI_TABS[(j + AI_TABS.length) % AI_TABS.length].id);
        nav.querySelector('[aria-selected="true"]')?.focus();
      });
      return b;
    }));
    body.setAttribute("aria-labelledby", `of-vset-${st.tab}`);
  };

  async function show(id) {
    st.tab = id;
    paintNav();
    body.replaceChildren(h("div.of-empty", t("Loading…")));
    try {
      await vibeStore.load();
      st.vs ||= settingsVs(app);
      if (!st.panels.has(id)) st.panels.set(id, (await LOADERS[id]())(st.vs));
      if (st.tab !== id) return;
      const p = st.panels.get(id);
      body.replaceChildren(p.el);
      p.show?.();
    } catch (err) {
      body.replaceChildren(h("div.of-empty", err?.message || String(err)));
    }
  }
  show(st.tab);
  return root;
}
