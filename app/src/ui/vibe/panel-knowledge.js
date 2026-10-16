// Vibe Studio ▸ Skills (instruction packs) and Knowledge (documents the assistant can search, memory notes).
import { h, empty } from "../../core/util.js";
import { vibeStore } from "../../vibe/store.js";
import { BUILTIN_SKILLS, parseSkill, serializeSkill } from "../../ai/index.js";
import { pickFiles } from "../code/import.js";
import { confirmDialog } from "../dialogs.js";
import { iconEl } from "../toolbox.js";

export function createSkillsPanel(vs) {
  const { app } = vs;
  const el = h("div.of-vskills");
  const builtin = () => BUILTIN_SKILLS.map((x) => (typeof x === "string" ? parseSkill(x) : x));

  function render() {
    empty(el);
    el.append(h("p.of-vlead", "Skills are instruction packs Vibe loads only when a task needs them — like a recipe book. Type / in the chat to start one."));
    const mine = h("div.of-vcard", h("div.of-vcard__head", h("strong", "Your skills"), h("div.of-vrow", h("button.of-btn", { type: "button", onclick: () => edit(null) }, iconEl("plus-lg"), "New"), h("button.of-btn", { type: "button", onclick: importSkill }, "Import .md"))));
    for (const s of vibeStore.skills) {
      const sw = h("sl-switch", { size: "small" });
      sw.checked = s.enabled !== false;
      sw.addEventListener("sl-change", () => vibeStore.saveSkills(vibeStore.skills.map((x) => (x.name === s.name ? { ...x, enabled: sw.checked } : x))));
      mine.append(h("div.of-vtool", h("div", h("code", s.name), h("small", s.description)), h("div.of-vrow", h("button.of-btn", { type: "button", onclick: () => edit(s) }, "Edit"), sw)));
    }
    if (!vibeStore.skills.length) mine.append(h("div.of-empty", "No skills of your own yet. A skill is a Markdown file with a name, a description and instructions."));
    el.append(mine);
    const bi = h("div.of-vcard", h("strong", "Built in"));
    for (const s of builtin()) bi.append(h("div.of-vtool", h("div", h("code", s.name), h("small", s.description)), h("button.of-btn", { type: "button", onclick: () => { vs.chat.setInput(`/${s.name} `); } }, "Use")));
    el.append(bi);
  }

  function edit(s) {
    const text = h("textarea.of-vfield__in.mono", { rows: 18, spellcheck: false }, s ? serializeSkill(s) : "---\nname: my-skill\ndescription: One sentence: when should Vibe use this skill?\n---\n\n# Steps\n\n1. …\n");
    text.addEventListener("keydown", (e) => e.stopPropagation());
    const err = h("div.of-vstatus.bad");
    el.replaceChildren(h("div.of-vform", h("strong", s ? "Edit skill" : "New skill"), text, err, h("div.of-vrow", h("button.of-btn.of-btn--primary", { type: "button", onclick: async () => {
      try {
        const p = parseSkill(text.value);
        if (!p.name || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(p.name)) throw new Error("The skill needs a name in the front matter (lowercase letters, digits and dashes).");
        if (!p.description) throw new Error("The skill needs a description so Vibe knows when to use it.");
        await vibeStore.saveSkills([...vibeStore.skills.filter((x) => x.name !== p.name && x.name !== s?.name), { ...p, enabled: true }]);
        render();
      } catch (e) {
        err.textContent = e.message;
      }
    } }, "Save"), h("button.of-btn", { type: "button", onclick: render }, "Cancel"), s ? h("button.of-btn", { type: "button", onclick: async () => { if (await confirmDialog({ title: "Delete skill", message: `Delete “${s.name}”?`, ok: "Delete", danger: true })) { await vibeStore.saveSkills(vibeStore.skills.filter((x) => x.name !== s.name)); render(); } } }, "Delete") : null)));
  }
  async function importSkill() {
    const files = await pickFiles({ accept: ".md,.markdown,.txt" });
    for (const f of files) {
      try {
        const p = parseSkill(await f.text());
        if (p.name && p.description) await vibeStore.saveSkills([...vibeStore.skills.filter((x) => x.name !== p.name), { ...p, enabled: true }]);
        else app.toast(`${f.name} needs name and description in its front matter.`, "warning", 3000);
      } catch (e) {
        app.toast(e.message, "danger", 3000);
      }
    }
    render();
  }

  vibeStore.on("change", (g) => g === "skills" && el.isConnected && !el.querySelector(".of-vform") && render());
  render();
  return { el, show: render };
}

export function createKnowledgePanel(vs) {
  const { app, session } = vs;
  const el = h("div.of-vknow");

  async function embedder() {
    const s = vibeStore.settings;
    if (!s.embedProvider || !s.embedModel) return null;
    const prov = await session.providerFor(s.embedProvider);
    return prov.embed ? (texts) => prov.embed(texts, { model: s.embedModel }) : null;
  }
  async function persist(index) {
    await vibeStore.saveKnowledge(index.toJSON());
  }

  async function render() {
    empty(el);
    const index = await session.knowledgeIndex();
    const st = index.stats?.() || {};
    const docs = index.listDocuments?.() || [];
    el.append(h("p.of-vlead", "Documents Vibe can search (RAG): brand guides, copy decks, specs, notes. Your open website project is searchable automatically. Everything is indexed on this device."));
    const card = h("div.of-vcard", h("div.of-vcard__head", h("strong", `Documents${st.documents != null ? ` (${st.documents} · ${st.chunks} passages)` : ""}`), h("button.of-btn", { type: "button", onclick: add }, iconEl("plus-lg"), "Add files…")));
    for (const d of docs.filter((x) => !x.id.startsWith("web:"))) card.append(h("div.of-vtool", h("div", h("code", d.title), h("small", `${d.chunks ?? ""} passages`)), h("button.of-btn", { type: "button", onclick: async () => { index.removeDocument(d.id); await persist(index); render(); } }, "Remove")));
    const web = docs.filter((x) => x.id.startsWith("web:")).length;
    if (web) card.append(h("div.of-hint", `${web} files of the open website project are indexed automatically.`));
    if (!docs.length) card.append(h("div.of-empty", "Nothing indexed yet."));
    el.append(card);

    const q = h("input.of-side__search", { type: "search", placeholder: "Try a search…", "aria-label": "Test knowledge search" });
    const out = h("div.of-vhits");
    q.addEventListener("keydown", async (e) => {
      e.stopPropagation();
      if (e.key !== "Enter") return;
      empty(out);
      for (const hit of index.search(q.value, { k: 5 })) out.append(h("div.of-vhit", h("strong", hit.title), h("p", hit.text.slice(0, 220) + (hit.text.length > 220 ? "…" : ""))));
      if (!out.children.length) out.append(h("div.of-empty", "No matches."));
    });
    el.append(h("div.of-vcard", h("strong", "Test search"), q, out));

    const mem = h("div.of-vcard", h("div.of-vcard__head", h("strong", `Memory (${vibeStore.memory.length})`)), h("p.of-hint", "Durable notes Vibe saved with your approval, such as brand colors or tone. They are added to every chat."));
    for (const m of vibeStore.memory) mem.append(h("div.of-vtool", h("div", h("small", m.text)), h("button.of-btn", { type: "button", "aria-label": "Forget", onclick: () => vibeStore.saveMemory(vibeStore.memory.filter((x) => x.id !== m.id)).then(render) }, "Forget")));
    if (!vibeStore.memory.length) mem.append(h("div.of-empty", "No memories yet."));
    el.append(mem);
  }

  async function add() {
    const files = await pickFiles({ accept: ".txt,.md,.csv,.json,.html,.css,.js,.svg,.xml,.yml,.yaml" });
    if (!files.length) return;
    const index = await session.knowledgeIndex();
    const emb = await embedder().catch(() => null);
    if (emb && index.setEmbedder) index.setEmbedder(emb);
    app.status("Indexing…");
    try {
      for (const f of files) {
        const text = await f.text();
        index.removeDocument(`file:${f.name}`);
        await index.addDocument({ id: `file:${f.name}`, title: f.name, text, meta: { size: f.size } });
      }
      await persist(index);
      app.toast(`Indexed ${files.length} file${files.length === 1 ? "" : "s"}.`, "success", 1800);
    } catch (e) {
      app.toast(e.message, "danger", 4000);
    } finally {
      app.status("");
      render();
    }
  }

  vibeStore.on("change", (g) => g === "memory" && el.isConnected && render());
  render();
  return { el, show: render };
}
