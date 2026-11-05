// Settings ▸ Artificial intelligence ▸ Memory: what Vibe remembers across chats. Global switch, "save without asking",
// memories per request, and the list itself: search, add, edit, switch off, pin, delete, export, import, delete all.
// Records and retrieval: ../../vibe/memory.js; storage: vibeStore (IndexedDB, this device). docs/vibe-memory.md.
//
// Public API: createMemoryPanel(vs) → { el, show }
import { h, empty, downloadName } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { confirmDialog } from "../dialogs.js";
import { iconEl } from "../toolbox.js";

const KIND_LABELS = { preference: N_("Preference"), fact: N_("Fact"), project: N_("Project context"), note: N_("Note") };

export function createMemoryPanel(vs) {
  const { app } = vs;
  const el = h("div.of-vweb.of-vmem");
  let M = null;
  let filter = "";
  let kindFilter = "";
  let editing = null; // id of the memory being edited

  const stop = (i) => (i.addEventListener("keydown", (e) => e.stopPropagation()), i);
  const kindSelect = (value, onChange, label) => {
    const s = h("select.of-vfield__in", { "aria-label": label }, ...M.MEMORY_KINDS.map((k) => h("option", { value: k, selected: k === value }, t(KIND_LABELS[k]))));
    s.addEventListener("change", () => onChange(s.value));
    return s;
  };
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(app.i18n?.locale?.() || undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

  async function render() {
    M ||= await import("../../vibe/memory.js");
    const s = vibeStore.settings;
    const list = vibeStore.memory.map((m) => M.normalizeMemory(m));
    empty(el);

    const on = h("sl-switch", { size: "small" }, t("Use memory across chats"));
    on.checked = s.memoryEnabled !== false;
    on.addEventListener("sl-change", () => vibeStore.saveSettings({ memoryEnabled: on.checked }));
    const auto = h("sl-switch", { size: "small", disabled: s.memoryEnabled === false }, t("Save memories without asking"));
    auto.checked = !!s.memoryAutoSave;
    auto.addEventListener("sl-change", () => vibeStore.saveSettings({ memoryAutoSave: auto.checked }));
    const per = stop(h("input.of-vfield__in", { value: String(s.memoryPerRequest || 8), inputmode: "numeric", "aria-label": t("Memories per request") }));
    per.addEventListener("change", () => {
      const n = Math.round(Number(per.value));
      if (n >= 1 && n <= 40) vibeStore.saveSettings({ memoryPerRequest: n });
    });
    el.append(h("div.of-vcard",
      h("strong", t("Memory")),
      h("p.of-hint", t("Vibe can remember your preferences, facts about you and your work, and project context across chats. Only the memories that fit the current request are sent, and only to the model you chose. Everything is stored on this device; nothing is synced or uploaded anywhere else.")),
      on,
      auto,
      h("small.of-hint", t("When on, the remember tool saves right away and the chat shows the memory with Undo. When off, every new memory asks first.")),
      h("label.of-vfield", h("span", t("Memories per request")), per, h("small", t("The most relevant ones are picked for every message; pinned memories are always included.")))));

    // add by hand
    const text = stop(h("textarea.of-vfield__in", { rows: 2, placeholder: t("For example: I prefer metric units and a calm, friendly tone."), "aria-label": t("New memory") }));
    let kind = "preference";
    const addKind = kindSelect(kind, (v) => (kind = v), t("Kind"));
    const add = h("button.of-btn.of-btn--primary", { type: "button" }, iconEl("plus-lg"), t("Add"));
    add.addEventListener("click", async () => {
      if (!text.value.trim()) return;
      const r = await vibeStore.addMemory(text.value, { kind });
      app.toast(r.updated ? t("Updated a similar memory.") : t("Memory saved."), "success", 1600);
    });
    el.append(h("div.of-vcard", h("strong", t("Add a memory")), text, h("div.of-vmem__row", addKind, add)));

    // list
    const search = stop(h("input.of-side__search", { type: "search", value: filter, placeholder: t("Search memories…"), "aria-label": t("Search memories") }));
    search.addEventListener("input", () => {
      filter = search.value;
      paintList();
    });
    const kf = h("select.of-vfield__in", { "aria-label": t("Filter by kind") }, h("option", { value: "" }, t("All kinds")), ...M.MEMORY_KINDS.map((k) => h("option", { value: k, selected: k === kindFilter }, t(KIND_LABELS[k]))));
    kf.addEventListener("change", () => {
      kindFilter = kf.value;
      paintList();
    });
    const items = h("div.of-vmem__list", { role: "list" });
    const card = h("div.of-vcard", h("div.of-vcard__head", h("strong", t("{n, plural, one {# memory} other {# memories}}", { n: list.length }))), h("div.of-vmem__row", search, kf), items);
    el.append(card);

    function paintList() {
      empty(items);
      const q = filter.trim().toLowerCase();
      const shown = list.filter((m) => (!kindFilter || m.kind === kindFilter) && (!q || m.text.toLowerCase().includes(q))).sort((a, b) => b.pinned - a.pinned || b.updated - a.updated);
      for (const m of shown) items.append(row(m));
      if (!shown.length) items.append(h("div.of-empty", list.length ? t("No memory matches.") : t("No memories yet. Vibe saves one when you tell it a lasting preference, or add one above.")));
    }

    function row(m) {
      const sw = h("sl-switch", { size: "small", checked: m.enabled, "aria-label": t("Use this memory") });
      sw.addEventListener("sl-change", () => vibeStore.updateMemory(m.id, { enabled: sw.checked }));
      const meta = [t(KIND_LABELS[m.kind]), m.scope !== "global" ? t("only in {project}", { project: m.scope.slice(8) }) : null, m.source?.title ? t("from “{chat}”", { chat: m.source.title }) : t("added by you"), m.uses ? t("{n, plural, one {used once} other {used # times}}", { n: m.uses }) : null, fmtDate(m.updated)].filter(Boolean).join(" · ");
      const pin = h("button.of-btn.of-btn--sm", { type: "button", "aria-pressed": String(m.pinned), title: m.pinned ? t("Unpin (send only when relevant)") : t("Pin (send with every request)") }, iconEl("pin-angle"));
      pin.addEventListener("click", () => vibeStore.updateMemory(m.id, { pinned: !m.pinned }));
      const edit = h("button.of-btn.of-btn--sm", { type: "button", "aria-label": t("Edit memory") }, iconEl("pencil"));
      edit.addEventListener("click", () => {
        editing = m.id;
        paintList();
      });
      const del = h("button.of-btn.of-btn--sm", { type: "button", "aria-label": t("Delete memory") }, iconEl("trash3"));
      del.addEventListener("click", () => vibeStore.deleteMemory(m.id));
      let body;
      if (editing === m.id) {
        const ta = stop(h("textarea.of-vfield__in", { rows: 3, "aria-label": t("Memory text") }));
        ta.value = m.text;
        let k = m.kind;
        const scope = stop(h("input.of-vfield__in", { value: m.scope === "global" ? "" : m.scope.slice(8), placeholder: t("All chats"), "aria-label": t("Only for this project or document") }));
        const save = h("button.of-btn.of-btn--sm.of-btn--primary", { type: "button" }, t("Save"));
        save.addEventListener("click", async () => {
          editing = null;
          await vibeStore.updateMemory(m.id, { text: ta.value, kind: k, scope: scope.value.trim() ? `project:${scope.value.trim()}` : "global" });
        });
        const cancel = h("button.of-btn.of-btn--sm", { type: "button" }, t("Cancel"));
        cancel.addEventListener("click", () => {
          editing = null;
          paintList();
        });
        body = h("div.of-vmem__edit", ta, h("div.of-vmem__row", kindSelect(k, (v) => (k = v), t("Kind")), scope), h("div.of-vmem__row", save, cancel));
        setTimeout(() => ta.focus(), 0);
      } else body = h("div.of-vmem__text", h("span", m.text), h("small", meta));
      return h("div.of-vmem__item", { role: "listitem", class: m.enabled ? "" : "off" }, sw, body, h("div.of-vmem__acts", pin, edit, del));
    }
    paintList();

    // export / import / delete all
    const exp = h("button.of-btn", { type: "button" }, iconEl("download"), t("Export…"));
    exp.addEventListener("click", async () => {
      const { platform } = await import("../../platform/index.js");
      const res = await platform.saveFile({ suggestedName: downloadName("openfini-memory", "json"), bytes: new TextEncoder().encode(JSON.stringify({ format: "openfini-memory", version: 1, memories: list }, null, 2)), mime: "application/json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (res) app.toast(t("Saved {name}", { name: res.name }), "success", 2000);
    });
    const imp = h("button.of-btn", { type: "button" }, iconEl("upload"), t("Import…"));
    imp.addEventListener("click", async () => {
      const { pickFiles } = await import("../code/import.js");
      const [f] = await pickFiles({ accept: ".json" });
      if (!f) return;
      try {
        const r = M.importMemories(list, await f.text());
        await vibeStore.saveMemory(r.list);
        app.toast(t("{n, plural, one {Imported # memory.} other {Imported # memories.}}", { n: r.added }), "success", 2000);
      } catch (err) {
        app.toast(err.message, "danger", 4000);
      }
    });
    const clear = h("button.of-btn.of-btn--danger", { type: "button", disabled: !list.length }, iconEl("trash3"), t("Delete all memories…"));
    clear.addEventListener("click", async () => {
      if (await confirmDialog({ title: t("Delete all memories"), message: t("Delete every memory Vibe saved on this device? This cannot be undone."), ok: t("Delete"), danger: true })) await vibeStore.saveMemory([]);
    });
    el.append(h("div.of-vcard", h("strong", t("Your data")), h("p.of-hint", t("Memories are part of your AI data: Settings ▸ Security ▸ Delete AI data removes them too. Exports are plain JSON; keep them private.")), h("div.of-vmem__row", exp, imp, clear)));
  }

  vibeStore.on("change", (g) => (g === "memory" || g === "settings" || g === "all") && el.isConnected && render());
  render();
  return { el, show: render };
}
