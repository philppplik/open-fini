// Settings ▸ Artificial intelligence ▸ Knowledge (documents the assistant can search, memory notes). Skills live in panel-skills.js.
import { h, empty } from "../../core/util.js";
import { vibeStore } from "../../vibe/store.js";
import { pickFiles } from "../code/import.js";
import { iconEl } from "../toolbox.js";

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
