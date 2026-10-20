// A Vibe chat session: assembles provider, tools, skills, memory and knowledge, runs the agent loop against the
// open OpenFini document and reports everything as events for the UI. One session per Vibe Studio.
import { Emitter, uid } from "../core/util.js";
import { vibeStore } from "./store.js";
import { createOpenFiniTools } from "./tools/index.js";
import { customToolDefs } from "./custom-tools.js";
import { log } from "../core/log.js";

const MAX_TEXT_ATTACHMENT = 60_000;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "mcp";

export class VibeSession extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.chat = this.#blank();
    this.running = false;
    this.abortCtl = null;
    this.plan = [];
    this.mcp = new Map(); // server id → { client, tools, error }
    this.knowledge = null;
    this.runs = []; // { doc, marker, title }
  }

  #blank() {
    return { id: uid("chat"), title: "New chat", messages: [], created: Date.now(), model: "" };
  }

  newChat() {
    if (this.running) this.abort();
    this.chat = this.#blank();
    this.plan = [];
    this.runs = [];
    this.emit("chat");
  }
  async openChat(id) {
    if (this.running) this.abort();
    const c = await vibeStore.loadChat(id);
    if (c) {
      this.chat = c;
      this.plan = [];
      this.runs = [];
      this.emit("chat");
    }
  }

  // ------------------------------------------------------------ provider plumbing

  async #ai() {
    return import("../ai/index.js");
  }

  /** Provider instance for a stored provider id ("demo" = the offline mock). */
  async providerFor(id) {
    const ai = await this.#ai();
    if (!id || id === "demo") return ai.createMockProvider();
    const rec = vibeStore.provider(id);
    if (!rec) throw new Error("The selected provider no longer exists. Pick another one in the model menu.");
    this.app.network?.assert("ai", rec.baseUrl); // offline mode (Settings ▸ Security and privacy); local servers stay allowed
    if (vibeStore.locked) throw new Error("Your API keys are locked. Unlock them with your passphrase (Models tab).");
    const key = vibeStore.getKey(id);
    const preset = ai.PROVIDER_PRESETS.find((p) => p.id === rec.preset);
    if (!key && preset?.needsKey !== false) throw new Error(`No API key is stored for ${rec.label}. Add one in the Models tab.`);
    return ai.createProvider({ kind: rec.kind, baseUrl: rec.baseUrl, apiKey: key, headers: rec.headers });
  }

  async #imageCtx() {
    const s = vibeStore.settings;
    if (!s.imageProvider || !s.imageModel) return null;
    const rec = vibeStore.provider(s.imageProvider);
    const provider = await this.providerFor(s.imageProvider);
    if (!provider.generateImage) return null;
    const imageApi = rec?.preset === "openrouter" ? "chat" : "images";
    return {
      generate: (o) => provider.generateImage({ prompt: o.prompt, size: o.size, model: s.imageModel, imageApi }),
      edit: (o) => provider.generateImage({ prompt: o.prompt, image: o.image, mask: o.mask, model: s.imageModel, imageApi }),
    };
  }

  async #knowledgeIndex() {
    if (this.knowledge) return this.knowledge;
    const { KnowledgeIndex } = await this.#ai();
    const saved = await vibeStore.loadKnowledge();
    this.knowledge = saved ? KnowledgeIndex.fromJSON(saved) : new KnowledgeIndex();
    return this.knowledge;
  }
  async knowledgeIndex() {
    return this.#knowledgeIndex();
  }
  /** Keeps the open website project searchable. */
  async #syncProject(index) {
    const web = this.app.doc?.web;
    if (!web) return;
    this.projectSig ||= new Map();
    for (const p of web.paths) {
      const text = web.text(p);
      if (text == null || !/\.(html?|css|js|md|json|txt|svg)$/i.test(p)) continue;
      const sig = `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
      if (this.projectSig.get(p) === sig) continue;
      this.projectSig.set(p, sig);
      index.removeDocument(`web:${p}`);
      index.addDocument({ id: `web:${p}`, title: `${this.app.doc.name}/${p}`, text, meta: { project: true } });
    }
  }

  async #mcpTools() {
    const ai = await this.#ai();
    const out = [];
    for (const srv of vibeStore.mcpServers.filter((s) => s.enabled !== false)) {
      let entry = this.mcp.get(srv.id);
      if (!entry || entry.url !== srv.url) {
        entry = { url: srv.url, name: srv.name, client: new ai.McpClient({ url: srv.url, headers: srv.headers || {}, version: "0.3.0" }), tools: null, error: null };
        this.mcp.set(srv.id, entry);
      }
      try {
        if (!entry.tools) {
          this.app.network?.assert("ai", srv.url);
          await entry.client.connect();
          entry.tools = await ai.mcpToolsToAgentTools(entry.client, { prefix: `mcp_${slug(srv.name)}`, serverName: srv.name });
          entry.error = null;
        }
        out.push(...entry.tools);
      } catch (err) {
        entry.error = err.message;
        entry.tools = null;
        this.emit("notice", { kind: "mcp", text: `MCP server “${srv.name}” is unavailable: ${err.message}` });
      }
    }
    return out;
  }
  async mcpStatus(srv) {
    this.app.network?.assert("ai", srv.url);
    const ai = await this.#ai();
    const client = new ai.McpClient({ url: srv.url, headers: srv.headers || {}, version: "0.3.0" });
    await client.connect();
    const tools = await client.listTools();
    await client.close?.();
    return tools;
  }

  // ------------------------------------------------------------ tools

  async #buildTools() {
    const app = this.app;
    const ai = await this.#ai();
    const s = vibeStore.settings;
    await app.extensionsReady?.catch(() => {});
    const skills = [...ai.BUILTIN_SKILLS.map((x) => (typeof x === "string" ? ai.parseSkill(x) : x)), ...vibeStore.skills.filter((x) => x.enabled !== false), ...((await app.extensions?.vibeSkills().catch(() => [])) || [])];
    const index = await this.#knowledgeIndex();
    await this.#syncProject(index);
    const ctx = {
      images: await this.#imageCtx().catch(() => null),
      knowledge: { search: async (q, k) => index.search(q, { k }) },
      memory: { add: (t) => vibeStore.addMemory(t) },
      skills,
      ask: (question, options) => new Promise((resolve) => this.emit("ask", { question, options, resolve })),
      plan: (steps) => {
        this.plan = steps;
        this.emit("plan", steps);
      },
      customTools: { save: async (t) => vibeStore.saveCustomTools([...vibeStore.customTools.filter((x) => x.name !== t.name), { ...t, enabled: true }]) },
    };
    this.ctx = ctx;
    const base = createOpenFiniTools(app, ctx);
    const byName = new Map(base.map((t) => [t.name, t]));
    // custom tools may call any OpenFini tool: they go through the same checks as the model's own calls
    const callTool = async (name, args) => {
      const t = byName.get(name);
      if (!t) throw new Error(`Unknown tool “${name}”.`);
      return t.run(args, {});
    };
    const custom = customToolDefs(vibeStore.customTools, callTool, (text) => this.emit("notice", { kind: "log", text }));
    const mcp = await this.#mcpTools();
    const ext = (await app.extensions?.vibeToolDefs().catch(() => [])) || []; // tools of extensions (ext_<id>_<tool>)
    let all = [...base, ...custom, ...mcp, ...ext];
    all = all.filter((t) => !s.disabledTools.includes(t.name) && !(t.name === "screenshot" && s.sendScreenshots === false));
    // approval policy
    const mode = s.approval;
    return all.map((t) => ({
      ...t,
      needsApproval: (input) => {
        if (s.autoAllow.includes(t.name)) return false;
        const own = t.needsApproval?.(input);
        if (mode === "auto") return t.name === "create_tool" || t.name.startsWith("mcp_") || t.name.startsWith("ext_") || t.name === "install_extension_from_url" || t.name === "create_extension" || t.name === "run_extension_command" ? own || `Run ${t.name}?` : false;
        if (mode === "careful" && !t.readOnly && t.name !== "update_plan" && t.name !== "ask_user") return own || `Allow “${t.name}”?`;
        return own || false;
      },
    }));
  }

  async toolList() {
    return this.#buildTools();
  }

  // ------------------------------------------------------------ running

  async #attachmentBlocks(files) {
    const blocks = [];
    for (const f of files) {
      if (/^image\//.test(f.type)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        blocks.push({ type: "text", text: `[Attached image: ${f.name}]` }, { type: "image", mime: f.type, data: btoa(bin) });
      } else if (f.size <= 4_000_000 && (/^text\//.test(f.type) || /\.(md|txt|csv|json|html?|css|m?js|svg|xml|yml|yaml|ts|tsx|jsx|py|sql)$/i.test(f.name))) {
        let text = await f.text();
        const cut = text.length > MAX_TEXT_ATTACHMENT;
        if (cut) text = text.slice(0, MAX_TEXT_ATTACHMENT);
        blocks.push({ type: "text", text: `[Attached file: ${f.name}${cut ? " (truncated)" : ""}]\n\`\`\`\n${text}\n\`\`\`` });
      } else if (/\.(pdf|ai|psd|psb|idml|sketch)$/i.test(f.name)) {
        blocks.push({ type: "text", text: `[Attached document “${f.name}” (${f.size} bytes). You cannot read the file itself. If the user opened it as a document (chip button “Open as document”) it is the active or an open document: use get_document_info, describe_document_pages, extract_pdf_text and get_import_report. Otherwise ask them to click “Open as document”.]` });
      } else blocks.push({ type: "text", text: `[Attached file “${f.name}” (${f.type || "unknown type"}, ${f.size} bytes) could not be read as text or image.]` });
    }
    return blocks;
  }

  async send(text, files = []) {
    if (this.running) return;
    const app = this.app;
    const s = vibeStore.settings;
    const providerId = s.activeProvider || "demo";
    if (providerId !== "demo" && !this.app.prefs.aiEnabled) throw new Error("AI features are turned off. Turn them on under Settings ▸ Artificial intelligence (or the switch in Vibe ▸ Models) — your messages will then be sent to the provider you chose.");
    const model = providerId === "demo" ? "demo" : s.model;
    if (!model) throw new Error("Choose a model first (model menu in the composer).");
    const ai = await this.#ai();
    const provider = await this.providerFor(providerId);
    const tools = await this.#buildTools();
    const doc = app.doc;
    const marker = doc ? doc.history.index : 0;
    const userBlocks = [...(files.length ? await this.#attachmentBlocks(files) : []), { type: "text", text }];
    const userMsg = { role: "user", content: userBlocks.length === 1 ? text : userBlocks };
    this.chat.messages.push(userMsg);
    if (this.chat.title === "New chat") this.chat.title = text.replace(/\s+/g, " ").slice(0, 48) || "New chat";
    this.chat.model = model;
    this.emit("message", userMsg);

    const skills = this.ctx.skills;
    const system = ai.buildSystemPrompt({
      studio: app.studio,
      doc: doc ? { name: doc.name, pages: doc.pages.length, page: app.page && { width: Math.round(app.page.w), height: Math.round(app.page.h) }, website: !!doc.web, selection: app.selection?.length ? app.selection.slice(0, 20).map((n) => ({ id: n.id, type: n.type, name: n.name || undefined })) : undefined } : null,
      skills,
      memory: vibeStore.memory.map((m) => m.text),
      mode: s.approval,
      extra: s.extraInstructions,
      language: app.i18n?.locale(),
    });

    this.running = true;
    this.abortCtl = new AbortController();
    this.emit("status", "running");
    const startIndex = this.chat.messages.length;
    try {
      const res = await ai.runAgent({
        provider,
        model,
        system,
        messages: this.chat.messages.slice(),
        tools,
        maxSteps: s.maxSteps,
        reasoning: s.reasoning === "off" ? undefined : { effort: s.reasoning },
        signal: this.abortCtl.signal,
        onEvent: (ev) => this.emit("event", ev),
        approve: (call) => new Promise((resolve) => this.emit("approval", { ...call, resolve })),
      });
      for (const m of res.messages) this.chat.messages.push(m);
      this.emit("done", res);
    } catch (err) {
      log.warn("ai", "The assistant run failed", err);
      this.emit("error", err);
    } finally {
      this.running = false;
      this.abortCtl = null;
      if (doc && doc.history.index > marker) this.runs.push({ doc, marker, title: text.slice(0, 40) });
      // a document the run created: undoing the run takes it back to its empty start
      const made = app.doc;
      if (made && made !== doc && made.history.index > 0) this.runs.push({ doc: made, marker: 0, title: text.slice(0, 40) });
      this.emit("status", "idle");
      void startIndex;
      vibeStore.saveChat(this.chat).catch(() => {});
      this.emit("runs", this.runs);
    }
  }

  abort() {
    this.abortCtl?.abort();
  }

  /** Undoes every change the last run(s) made to its document. */
  undoLastRun() {
    const run = this.runs.pop();
    if (!run) return 0;
    let n = 0;
    while (run.doc.history.index > run.marker && run.doc.history.canUndo) {
      run.doc.undo();
      n++;
    }
    this.app.emit("docchange", {});
    this.emit("runs", this.runs);
    return n;
  }
}
