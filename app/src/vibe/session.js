// One Vibe chat: its transcript, plan, runs (undo records), approvals queue, attachments and its own agent run.
// Many sessions run at the same time; they are created and coordinated by the VibeHub (hub.js), which owns the
// shared services (knowledge index, MCP clients, the document write lock). The UI talks to the ACTIVE session through
// the hub's SessionView, so it keeps using the same events as before:
//   chat, message, event, approval, ask, plan, notice, done, error, status ("running" | "idle"), runs
// Extra state for the hub: `status` ("idle" | "running" | "approval" | "done" | "error"), `activity` (current tool),
// `pendingApprovals`, `pendingAsks`, `live` (events of the running request, replayed when the user switches to it).
//
// Invariants
//   - Mutating tool calls (and calls that need another document active) run under the hub's write lock, with the
//     document's history tagged { chat, run } so per-run undo stays correct (run-undo.js).
//   - Read-only calls never wait for the lock while the chat's document is the active one.
//   - A chat only ever has one request running; sub-agents run inside that request (agents.js).
import { Emitter, uid } from "../core/util.js";
import { vibeStore } from "./store.js";
import { createOpenFiniTools, TOOL_GROUPS } from "./tools/index.js";
import { advertisedTools } from "./script-lib.js";
import { customToolDefs } from "./custom-tools.js";
import { log } from "../core/log.js";
import { undoRun, runSteps, undoTask, taskSteps } from "./run-undo.js";
import { AgentManager } from "./agents.js";
import { Orchestrator } from "./orchestrator.js";
import { agentTools } from "./tools/agents.js";
import { officeSummary } from "../office/ai.js";
import { createRunLog, recordRun } from "./ai-log.js";

const MAX_TEXT_ATTACHMENT = 60_000;
// tools a skill restriction never blocks: the assistant must still be able to talk, plan and load skills
const ALWAYS_ALLOWED = new Set(["use_skill", "update_plan", "ask_user", "get_document_info", "screenshot"]);
// removed from the tool list when memory is off (globally or for this chat)
const MEMORY_TOOLS = new Set(["remember", "recall_memory", "forget_memory"]);
const LIVE_TYPES = new Set(["text", "thinking", "tool_start", "tool_end", "tool_progress", "agent_status", "agent_event", "retry", "route_fallback", "route_retry"]);

export class VibeSession extends Emitter {
  /**
   * @param {import("./hub.js").VibeHub} hub
   * @param {{hidden?:boolean, chat?:object}} [o] hidden sessions (right-click quick actions) never show in the chat list
   */
  constructor(hub, { hidden = false, chat = null } = {}) {
    super();
    this.hub = hub;
    this.app = hub.app;
    this.hidden = hidden;
    this.chat = chat || this.#blank();
    this.running = false;
    this.status = "idle";
    this.activity = "";
    this.abortCtl = null;
    this.plan = [];
    this.runs = []; // { doc, run, title, edits }
    this.pendingApprovals = [];
    this.pendingAsks = [];
    this.live = [];
    this.attachments = []; // { name, type, size, file, openedDoc? } (memory only)
    this.overrides = chat?.overrides || {}; // per-chat { activeProvider, model, approval }
    this.agentMgr = null;
    this.restrict = null; // Set of allowed tool names while an enforcing skill is active
    this.pinnedDoc = null;
    this.usage = { input: 0, output: 0 };
    this.lastUndoError = "";
  }

  get id() {
    return this.chat.id;
  }

  #blank() {
    return { id: uid("chat"), title: "New chat", messages: [], created: Date.now(), model: "" };
  }

  #setStatus(s) {
    this.status = s;
    this.hub.sessionChanged(this);
  }

  /** Settings with this chat's overrides applied. */
  settings() {
    const s = vibeStore.settings;
    const o = this.overrides || {};
    // o.disabledTools: tools switched off for this chat only (composer ▸ Tools popover); adds to the global list
    return { ...s, ...(o.approval ? { approval: o.approval } : {}), ...(o.model ? { activeProvider: o.activeProvider ?? null, model: o.model } : {}), ...(o.disabledTools?.length ? { disabledTools: [...(s.disabledTools || []), ...o.disabledTools] } : {}) };
  }
  setOverrides(patch) {
    this.overrides = { ...this.overrides, ...patch };
    for (const k of Object.keys(this.overrides)) if (this.overrides[k] == null || this.overrides[k] === "") delete this.overrides[k];
    this.chat.overrides = this.overrides;
    if (this.chat.messages.length) vibeStore.saveChat(this.chat).catch(() => {});
    this.hub.sessionChanged(this);
    this.emit("status", this.running ? "running" : "idle");
  }

  // ------------------------------------------------------------ compatibility (UI talks to the active session)
  newChat() {
    if (this.hidden) {
      if (this.running) this.abort();
      this.chat = this.#blank();
      this.plan = [];
      this.runs = [];
      this.attachments = [];
      this.emit("chat");
      return;
    }
    this.hub.newChat();
  }
  openChat(id) {
    return this.hub.open(id);
  }
  providerFor(id) {
    return this.hub.providerFor(id);
  }
  knowledgeIndex() {
    return this.hub.knowledgeIndex();
  }
  mcpStatus(srv) {
    return this.hub.mcpStatus(srv);
  }
  async toolList() {
    return this.#buildTools();
  }

  // ------------------------------------------------------------ memory (vibe/memory.js, docs/vibe-memory.md)

  /** Memory is used in this chat: the global switch is on and the chat did not switch it off (context panel). */
  memoryOn() {
    return vibeStore.settings.memoryEnabled !== false && !this.chat.memoryOff;
  }

  /**
   * The memories relevant to `query` (retrieval over all saved memories). `all` ignores this chat's exclusions
   * (recall_memory searches everything the user did not switch off).
   */
  async #memoryFor(query, { k, all = false } = {}) {
    if (!this.memoryOn() || !vibeStore.memory.length) return { selected: [], considered: 0 };
    const M = await import("./memory.js");
    const list = vibeStore.memory.map((m) => M.normalizeMemory(m));
    const recent = this.chat.messages.filter((m) => m.role === "user" && typeof m.content === "string").slice(-2).map((m) => m.content).join(" ");
    return M.selectMemories(list, `${query} ${recent}`, { k: k || vibeStore.settings.memoryPerRequest || 8, project: this.app.doc?.name || "", exclude: all ? [] : this.chat.memoryExclude || [] });
  }

  /**
   * What the next request would send besides the transcript: the system prompt (with the memories it picks for
   * `draft`), the tool definitions and the memories. Used by the context panel (ui/vibe/context-panel.js).
   */
  async previewContext(draft = "") {
    const ai = await this.hub.ai();
    const tools = await this.#buildTools();
    const mem = await this.#memoryFor(draft);
    const system = this.#systemPrompt(ai, this.settings(), mem.selected);
    return { system, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), memory: mem.selected, considered: mem.considered, skills: (this.ctx?.skills || []).map((x) => x.name), last: this.lastContext || null };
  }

  /** Compact tool list (settings.compactTools): which tools are listed for the model; null lists all. */
  #advertise(s) {
    if (!s.compactTools) return null;
    const d = this.app.doc;
    // the studio of the active tab (remembered per tab, core/tab-studio.js), so a tab switch changes the listed tools
    const context = d?.office ? d.office.kind || "document" : d ? this.app.docStudio?.(d) || this.app.studio : this.app.studio;
    const listed = advertisedTools(TOOL_GROUPS, context, this.restrict ? [...this.restrict] : []);
    const builtIn = new Set(Object.values(TOOL_GROUPS).flat());
    // custom, MCP and extension tools are few and the user added them on purpose: always listed
    return (t) => listed.has(t.name) || !builtIn.has(t.name);
  }

  /** Keeps the full text of a result that was cut and tells the model how to read on (read_result). */
  #storeResult({ id, text }) {
    const store = this.results || (this.results = new Map());
    const key = `r${(this.resultSeq = (this.resultSeq || 0) + 1)}`;
    store.set(key, text.slice(0, 2_000_000));
    while (store.size > 8) store.delete(store.keys().next().value);
    void id;
    return `\n[The full result has ${text.length} characters and is stored as “${key}”. Read more with read_result {"id":"${key}","offset":0} or {"id":"${key}","search":"…"}.]`;
  }

  #systemPrompt(ai, s, memory) {
    const app = this.app;
    const target = app.doc;
    return ai.buildSystemPrompt({
      studio: app.studio,
      doc: target ? { name: target.name, pages: target.pages.length, page: app.page && { width: Math.round(app.page.w), height: Math.round(app.page.h) }, website: !!target.web, office: officeSummary(target), selection: app.selection?.length ? app.selection.slice(0, 20).map((n) => ({ id: n.id, type: n.type, name: n.name || undefined })) : undefined, attachments: this.attachments.length ? this.attachments.map((a, i) => `${i + 1}. ${a.name}`).join(", ") : undefined } : this.attachments.length ? { attachments: this.attachments.map((a, i) => `${i + 1}. ${a.name}`).join(", ") } : null,
      skills: this.ctx?.skills,
      memory: memory.map((m) => (m.kind === "note" ? m.text : `${m.kind}: ${m.text}`)),
      mode: s.approval,
      extra: [s.extraInstructions, this.chat.primer, s.compactTools ? "Your tool list is compact: it shows the tools for what is open. Many more exist (other studios, Office apps, web, git, export, color, settings). When you need one, call find_tools with a query, then call_tool with its name and arguments." : ""].filter(Boolean).join("\n\n"),
      language: app.i18n?.locale(),
    });
  }

  // ------------------------------------------------------------ tools

  #policy(t, s) {
    const mode = s.approval;
    return (input) => {
      if (t.alwaysAsk) return t.needsApproval?.(input) || false; // web tools: per-domain approval, never skipped by a mode or "Always allow"
      if (s.autoAllow.includes(t.name)) return false;
      const own = t.needsApproval?.(input);
      if (mode === "auto") return t.name === "create_tool" || t.name.startsWith("mcp_") || t.name.startsWith("ext_") || t.name === "install_extension_from_url" || t.name === "create_extension" || t.name === "run_extension_command" || t.name === "create_skill" ? own || `Run ${t.name}?` : false;
      if (mode === "careful" && !t.readOnly && t.name !== "update_plan" && t.name !== "ask_user") return own || `Allow “${t.name}”?`;
      return own || false;
    };
  }

  /** Wraps a tool with the skill restriction, the write lock, document affinity and history tagging. */
  #wrap(t, s) {
    const app = this.app;
    const hub = this.hub;
    return {
      ...t,
      needsApproval: this.#policy(t, s),
      run: async (input, c = {}) => {
        if (this.restrict && !this.restrict.has(t.name)) throw new Error(`“${t.name}” is not allowed while the active skill restricts tools (enforce-tools). Allowed: ${[...this.restrict].join(", ")}.`);
        const pinned = this.pinnedDoc && app.docs?.includes(this.pinnedDoc) ? this.pinnedDoc : null;
        const needLock = !t.readOnly || t.exclusive || (pinned && pinned !== app.doc);
        if (!needLock) return t.run(input, c);
        const owner = c.owner || this.id;
        const release = await hub.lock.acquire(owner, { signal: c.signal, label: `${this.chat.title.slice(0, 30)} · ${t.name}` });
        const tag = { chat: this.id, run: this.runId, ...(c.owner && c.owner !== this.id ? { agent: c.owner } : {}), ...(c.agent?.taskId ? { task: c.agent.taskId } : {}) };
        let doc = null;
        let probe = null;
        try {
          if (pinned && app.doc !== pinned) app.activateDoc(pinned);
          doc = app.doc;
          if (doc && !t.readOnly) doc.history.tag = tag;
          // optional observer (ui/vibe/change-recorder.js): before/after snapshots for the chat's diff view; never fails a call
          if (!t.readOnly && hub.changeProbe) probe = await Promise.resolve().then(() => hub.changeProbe.before({ session: this, id: c.id, name: t.name, input, doc, run: this.runId })).catch(() => null);
          return await t.run(input, c);
        } finally {
          try {
            probe?.after?.(app.doc);
          } catch {
            /* diff recording is best effort */
          }
          if (doc) doc.history.tag = null;
          if (!t.readOnly && app.doc) {
            const now = app.doc;
            // a document this call created or opened: its first entries belong to the run as well
            if (now !== doc) for (let i = 0; i < now.history.index; i++) now.history.entries[i].tag ||= tag;
            this.pinnedDoc = now;
            this.runDocs?.add(now);
            if (doc) this.runDocs?.add(doc);
          }
          release();
        }
      },
    };
  }

  async #skills() {
    const ai = await this.hub.ai();
    const app = this.app;
    const user = vibeStore.skills.filter((x) => x.enabled !== false).map((x) => (x.params ? x : { ...ai.parseSkill(ai.serializeSkill(x)), files: x.files, source: "user" }));
    const ext = ((await app.extensions?.vibeSkills().catch(() => [])) || []).map((x) => ({ ...x, source: "extension" }));
    const builtin = [...ai.BUILTIN_SKILL_LIST, ...ai.PACK_SKILL_LIST].map((x) => ({ ...x, source: "builtin" }));
    const all = [...user, ...ext, ...builtin.filter((b) => !user.some((u) => u.name === b.name))];
    const studio = app.studio;
    return all.filter((x) => !x.studios?.length || x.studios.includes(studio) || studio === "vibe");
  }

  async #useSkill(name, args, file) {
    const ai = await this.hub.ai();
    const all = this.ctx.skills;
    const found = all.find((x) => x.name === name || x.id === ai.slugify(name));
    const s = found && (await ai.hydrateSkill(found));
    if (!s) throw new Error(`Unknown skill “${name}”. Available: ${all.map((x) => x.name).join(", ")}.`);
    if (file) {
      const text = s.files?.[file];
      if (text == null) throw new Error(`Skill “${s.name}” has no reference file “${file}”. Files: ${Object.keys(s.files || {}).join(", ") || "none"}.`);
      return text;
    }
    const r = ai.renderSkill(s, { args, all });
    if (r.missing.length) {
      const p = s.params.filter((x) => r.missing.includes(x.name));
      throw new Error(`Skill “${s.name}” needs arguments: ${p.map((x) => `${x.name}${x.description ? ` (${x.description})` : ""}`).join(", ")}. Ask the user (ask_user) or pass args, e.g. {"${p[0].name}": "…"}.`);
    }
    vibeStore.noteSkillUse(s.name).catch(() => {});
    if (s.enforceTools && s.allowedTools?.length && this.settings().enforceSkillTools !== false) {
      this.restrict = new Set([...s.allowedTools, ...ALWAYS_ALLOWED]);
      this.emit("notice", { kind: "info", text: `Skill “${s.name}” is active: Vibe may only use ${s.allowedTools.length} tools until this request ends.` });
    }
    return r.text;
  }

  async #buildTools() {
    const app = this.app;
    const s = this.settings();
    await app.extensionsReady?.catch(() => {});
    const skills = await this.#skills();
    const index = await this.hub.knowledgeIndex();
    await this.hub.syncProject(index);
    let raw = [];
    const memoryOn = this.memoryOn();
    const ctx = {
      images: await this.hub.imageCtx().catch(() => null),
      knowledge: { search: async (q, k) => index.search(q, { k }) },
      knowledgeIndex: index,
      saveKnowledge: () => vibeStore.saveKnowledge(index.toJSON()),
      embedder: async () => {
        const st = vibeStore.settings;
        if (!st.embedProvider || !st.embedModel) return null;
        const prov = await this.providerFor(st.embedProvider);
        return prov.embed ? (texts) => prov.embed(texts, { model: st.embedModel }) : null;
      },
      memory: memoryOn
        ? {
            add: async (t, o = {}) => {
              const r = await vibeStore.addMemory(t, { ...o, source: { chat: this.id, title: this.chat.title } });
              // saved without asking (auto-save): tell the user and offer Undo right away
              if (vibeStore.settings.memoryAutoSave) this.emit("notice", { kind: "memory", text: r.updated ? `Memory updated: “${String(t).slice(0, 120)}”` : `Remembered: “${String(t).slice(0, 120)}”`, memory: r });
              return r;
            },
            autoSave: () => !!vibeStore.settings.memoryAutoSave,
            search: async (q, k) => (await this.#memoryFor(q, { k, all: true })).selected,
            forget: async (id) => {
              const m = vibeStore.memory.find((x) => x.id === id);
              if (!m) throw new Error(`No memory with id ${id}.`);
              await vibeStore.deleteMemory(id);
              return m;
            },
          }
        : null,
      skills,
      useSkill: (name, args, file) => this.#useSkill(name, args, file),
      saveSkillDraft: async (a) => {
        const ai = await this.hub.ai();
        const meta = { version: "0.1.0", ...(a.params?.length ? { params: a.params } : {}), ...(a.whenToUse ? { "when-to-use": a.whenToUse } : {}), source: "chat" };
        const skill = ai.parseSkill(ai.serializeSkill({ name: a.name, description: a.description, allowedTools: a.allowedTools || [], tags: [...(a.tags || []), "draft"], body: a.body, meta }));
        await vibeStore.saveSkills([...vibeStore.skills.filter((x) => x.name !== skill.name), { ...skill, enabled: false, draft: true }]);
        this.hub.emit("skill-draft", skill);
        return { name: skill.name };
      },
      ask: (question, options) => new Promise((resolve) => {
        const q = { question, options, chatId: this.id, resolve: (v) => {
          this.pendingAsks = this.pendingAsks.filter((x) => x !== q);
          this.#setStatus(this.pendingApprovals.length || this.pendingAsks.length ? "approval" : "running");
          resolve(v);
        } };
        this.pendingAsks.push(q);
        this.#setStatus("approval");
        this.emit("ask", q);
      }),
      plan: (steps) => {
        this.plan = steps;
        this.emit("plan", steps);
      },
      customTools: { save: async (t) => vibeStore.saveCustomTools([...vibeStore.customTools.filter((x) => x.name !== t.name), { ...t, enabled: true }]) },
      attachments: () => this.attachments,
      agents: () => this.agentMgr,
      // one plan_work job per request; created on first use and bound to this run's AgentManager
      orchestrator: (opts) => {
        if (this.orch?.runId !== this.runId && opts) this.orch = Object.assign(new Orchestrator({ manager: this.agentMgr, guideFor: (st) => this.hub.ai().then((ai) => ai.studioGuide(st)), onPlan: (steps) => ctx.plan(steps), ...opts }), { runId: this.runId });
        return this.orch?.runId === this.runId ? this.orch : null;
      },
      lookup: (name) => raw.find((t) => t.name === name),
      toolNames: () => raw.map((t) => t.name),
      allowed: (name) => !this.restrict || this.restrict.has(name),
      policy: (name, input) => {
        const t = raw.find((x) => x.name === name);
        return t ? this.#policy(t, s)(input) : false;
      },
      snapshots: this.snapshots || (this.snapshots = new Map()),
      results: this.results || (this.results = new Map()),
    };
    this.ctx = ctx;
    const base = createOpenFiniTools(app, ctx);
    const byName = new Map(base.map((t) => [t.name, t]));
    // custom tools may call any OpenFini tool
    const callTool = async (name, args) => {
      const t = byName.get(name);
      if (!t) throw new Error(`Unknown tool “${name}”.`);
      return t.run(args, {});
    };
    const custom = customToolDefs(vibeStore.customTools, callTool, (text) => this.emit("notice", { kind: "log", text }));
    const mcp = await this.hub.mcpTools(this);
    const ext = (await app.extensions?.vibeToolDefs().catch(() => [])) || [];
    raw = [...base, ...custom, ...mcp, ...ext].filter((t) => !s.disabledTools.includes(t.name) && !(t.name === "screenshot" && s.sendScreenshots === false) && (memoryOn || !MEMORY_TOOLS.has(t.name)));
    return raw.map((t) => this.#wrap(t, s));
  }

  // ------------------------------------------------------------ running

  async #attachmentBlocks(files) {
    const blocks = [];
    for (const f of files) {
      const idx = this.attachments.length;
      this.attachments.push({ name: f.name, type: f.type, size: f.size, file: f });
      const hint = ` (attachment ${idx + 1}; open_attachment opens it as a new document)`;
      if (/^image\//.test(f.type)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        blocks.push({ type: "text", text: `[Attached image: ${f.name}${hint}]` }, { type: "image", mime: f.type, data: btoa(bin) });
      } else if (f.size <= 4_000_000 && (/^text\//.test(f.type) || /\.(md|txt|csv|json|html?|css|m?js|svg|xml|yml|yaml|ts|tsx|jsx|py|sql)$/i.test(f.name))) {
        let text = await f.text();
        const cut = text.length > MAX_TEXT_ATTACHMENT;
        if (cut) text = text.slice(0, MAX_TEXT_ATTACHMENT);
        blocks.push({ type: "text", text: `[Attached file: ${f.name}${cut ? " (truncated)" : ""}${hint}]\n\`\`\`\n${text}\n\`\`\`` });
      } else if (/\.(pdf|ai|psd|psb|idml|sketch)$/i.test(f.name)) {
        blocks.push({ type: "text", text: `[Attached document “${f.name}” (${f.size} bytes)${hint}. You cannot read the bytes directly: call open_attachment to import it as a new document, then describe_page, describe_document_pages, extract_pdf_text or get_import_report.]` });
      } else blocks.push({ type: "text", text: `[Attached file “${f.name}” (${f.type || "unknown type"}, ${f.size} bytes)${hint} could not be read as text or image.]` });
    }
    return blocks;
  }

  async send(text, files = []) {
    if (this.running || this.starting) return;
    this.starting = true; // set synchronously: the hub must not reuse this chat while send() is still preparing
    try {
      return await this.#send(text, files);
    } finally {
      this.starting = false;
    }
  }

  async #send(text, files) {
    const app = this.app;
    const s = this.settings();
    const ai = await this.hub.ai();
    // model routing: a chat-level model override becomes the primary target; "Use fallback chain" can be switched off per chat
    const ov = this.overrides || {};
    const route = ai.resolveRoute(s, { useFallback: ov.fallback !== false, primary: ov.model ? { providerId: ov.activeProvider ?? null, model: ov.model } : undefined });
    const providerId = route.targets[0].providerId || "demo";
    if ((providerId !== "demo" || route.targets.some((t) => t.providerId)) && !this.app.prefs.aiEnabled) throw new Error("AI features are turned off. Turn them on under Settings ▸ Artificial intelligence (or the switch in Settings ▸ Artificial intelligence ▸ Models) — your messages will then be sent to the provider you chose.");
    const model = providerId === "demo" ? "demo" : route.targets[0].model;
    if (!model) throw new Error("Choose a model first (model menu in the composer).");
    this.hub.assertCanStart(this);
    const glue = route.chain ? await import("./routing-glue.js") : null;
    const provider = glue ? await glue.buildRoutedProvider(this.hub, route) : await this.providerFor(providerId);
    this.restrict = null;
    const tools = await this.#buildTools();
    const doc = app.doc;
    if (doc && !this.pinnedDoc) this.pinnedDoc = doc;
    const userBlocks = [...(files.length ? await this.#attachmentBlocks(files) : []), { type: "text", text }];
    const userMsg = { role: "user", content: userBlocks.length === 1 ? text : userBlocks };
    this.chat.messages.push(userMsg);
    if (this.chat.title === "New chat") this.chat.title = text.split("\n\n[Vibe context]\n")[0].replace(/\s+/g, " ").slice(0, 48) || "New chat";
    this.chat.model = model;
    this.running = true;
    this.live = [];
    this.runId = uid("run");
    this.runDocs = new Set();
    this.abortCtl = new AbortController();
    this.#setStatus("running");
    if (!this.hidden) vibeStore.saveChat(this.chat).catch(() => {});
    this.emit("message", userMsg);

    const mem = await this.#memoryFor(text).catch(() => ({ selected: [], considered: 0 }));
    const system = this.#systemPrompt(ai, s, mem.selected);
    this.lastContext = { memory: mem.selected.map((m) => m.id), systemChars: system.length, tools: tools.length, time: Date.now() };
    vibeStore.noteMemoryUse(this.lastContext.memory).catch(() => {});

    // AI log (vibe/ai-log.js, docs/ai-logging.md): metadata by default, content only when verbose logging is on
    const runLog = vibeStore.settings.aiLog !== false ? createRunLog({ verbose: !!vibeStore.settings.aiLogVerbose }) : null;
    runLog?.start({ chat: this.id, model, provider: providerId, route: route.chain ? s.activeRoute || "chain" : null, system, skills: (this.ctx.skills || []).map((x) => x.name), tools: tools.length, prompt: text, source: this.chat.source || (this.hidden ? "quick-action" : "chat"), mode: s.approval });
    const approve = (call) => new Promise((resolve) => {
      const req = { ...call, chatId: this.id, resolve: (ok) => {
        runLog?.approval(call.name, ok, call.reason);
        this.pendingApprovals = this.pendingApprovals.filter((x) => x !== req);
        this.#setStatus(this.pendingApprovals.length || this.pendingAsks.length ? "approval" : "running");
        resolve(ok);
      } };
      if (call.agent) req.reason = `Agent “${call.agent.role}”: ${call.reason || `Allow ${call.name}?`}`;
      this.pendingApprovals.push(req);
      this.#setStatus("approval");
      this.emit("approval", req);
    });
    const emitEvent = (ev) => {
      runLog?.event(ev);
      if (LIVE_TYPES.has(ev.type)) this.live.push(ev);
      if (ev.type === "route_fallback") {
        this.activity = "route_fallback";
        this.emit("notice", { kind: "info", text: ev.text });
      } else if (ev.type === "tool_start") this.activity = ev.name;
      else if (ev.type === "thinking") this.activity = "thinking";
      else if (ev.type === "text") this.activity = "writing";
      else if (ev.type === "usage") {
        this.usage.input += ev.input || 0;
        this.usage.output += ev.output || 0;
      }
      if (ev.type === "tool_start" || ev.type === "step" || ev.type === "agent_status") this.hub.sessionActivity(this, ev);
      this.emit("event", ev);
    };

    // sub-agents of this request
    const agentModel = providerId === "demo" ? "demo" : s.agentModel || model;
    // sub-agents use the chain too (unless the route turns that off); their own model replaces the primary target
    const agentProvider = glue && route.policy.fallbackBackground ? await glue.buildRoutedProvider(this.hub, route, { primaryModel: providerId === "demo" ? undefined : agentModel }) : provider;
    const makeManager = (parentTools, depth, budget, signal, prefix) => {
      const mgr = new AgentManager({
        runAgent: ai.runAgent,
        provider: agentProvider,
        model: agentModel,
        parentTools,
        depth,
        budget,
        prefix,
        signal,
        settings: { maxConcurrent: s.maxAgents ?? 3, maxSteps: s.agentSteps ?? 12, budgetSteps: s.agentBudgetSteps ?? 80, budgetTokens: s.agentBudgetTokens ?? 400000 },
        onEvent: emitEvent,
        approve,
        guideFor: (st) => ai.studioGuide(st),
        toolsFor: (agent, childTools) => {
          // nested agents get their own manager bound to the child's tools (depth limit is enforced by resolveToolset)
          if (!childTools.some((t) => t.name === "spawn_agent")) return childTools;
          let sub = null;
          const nested = agentTools(app, { agents: () => (sub ||= makeManager(childTools, depth + 1, mgr.budget, agent.ctl.signal, `${agent.id}.`)) }).map((t) => this.#wrap(t, s));
          return childTools.map((t) => nested.find((n) => n.name === t.name) || t);
        },
      });
      return mgr;
    };
    this.agentMgr = makeManager(tools, 0, null, this.abortCtl.signal, "a");

    let failed = false;
    let res = null;
    let runError = null;
    try {
      res = await ai.runAgent({
        provider,
        model,
        system,
        messages: this.chat.messages.slice(),
        tools,
        maxSteps: s.maxSteps,
        reasoning: s.reasoning === "off" ? undefined : { effort: s.reasoning },
        signal: this.abortCtl.signal,
        onEvent: emitEvent,
        approve,
        advertise: this.#advertise(s),
        onTruncated: (r) => this.#storeResult(r),
      });
      // a run that ends while agents still work: stop them (their result could not be reported anymore)
      this.agentMgr.cancelAll("The parent request ended.");
      for (const m of res.messages) this.chat.messages.push(m);
      failed = res.stopReason === "error";
      if (failed) log.warn("ai", `The assistant run failed: ${String(res.error || "unknown error").slice(0, 300)}`);
      this.emit("done", res);
    } catch (err) {
      failed = true;
      runError = err;
      log.warn("ai", "The assistant run failed", err);
      this.emit("error", err);
    } finally {
      this.agentMgr?.cancelAll("Stopped.");
      this.running = false;
      this.abortCtl = null;
      this.restrict = null;
      this.activity = "";
      for (const r of this.pendingApprovals.splice(0)) r.resolve(false);
      for (const q of this.pendingAsks.splice(0)) q.resolve("");
      for (const d of this.runDocs) {
        const edits = runSteps(d.history, this.runId);
        if (edits) this.runs.push({ doc: d, run: this.runId, title: text.slice(0, 40), edits, marker: Math.max(0, d.history.index - edits) });
      }
      this.runDocs = null;
      if (runLog) recordRun(runLog.finish({ stopReason: res?.stopReason, error: runError }));
      this.#setStatus(failed ? "error" : "done");
      this.emit("status", "idle");
      if (!this.hidden) vibeStore.saveChat(this.chat).catch(() => {});
      this.emit("runs", this.runs);
    }
  }

  abort() {
    this.abortCtl?.abort();
    this.agentMgr?.cancelAll("Stopped by the user.");
  }

  /** Undoes the newest run of this chat (when no other chat or user edit came after it). Returns the steps undone. */
  undoLastRun() {
    const rec = this.runs[this.runs.length - 1];
    if (!rec) return 0;
    const r = undoRun(rec.doc, rec.run);
    if (r.reason) {
      this.lastUndoError = r.reason;
      this.emit("notice", { kind: "info", text: r.reason });
      return 0;
    }
    this.runs.pop();
    this.lastUndoError = "";
    this.app.emit("docchange", {});
    this.emit("runs", this.runs);
    return r.undone;
  }

  // ------------------------------------------------------------ plan_work tasks (Activity tab controls)

  /** Cancels one task of the current plan_work job (stops its agent). Returns false when it already finished. */
  cancelTask(id) {
    if (!this.orch?.tasks.length) return false;
    return this.orch.cancel(id);
  }

  /** Open documents with edits of task `id` of the latest plan_work job: [{ doc, steps }]. */
  taskEdits(id) {
    if (!this.orch) return [];
    return (this.app.docs || []).map((doc) => ({ doc, steps: taskSteps(doc.history, this.orch.runId, id) })).filter((x) => x.steps > 0);
  }

  /**
   * Undoes the edits of one finished task in every open document, under the write lock. A document where newer edits
   * (another task, chat or the user) sit on top is left alone and named in `reasons`.
   * @returns {Promise<{undone:number, reasons:string[]}>}
   */
  async undoTask(id) {
    const o = this.orch;
    const t = o?.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown task “${id}”.`);
    if (!["done", "error", "cancelled"].includes(t.status)) throw new Error("Wait until the task has finished (or cancel it) before undoing it.");
    const release = await this.hub.lock.acquire(`${this.id}:task-undo`, { label: `${this.chat.title.slice(0, 30)} · undo task` });
    let undone = 0;
    const reasons = [];
    try {
      for (const { doc } of this.taskEdits(id)) {
        const r = undoTask(doc, o.runId, id);
        if (r.reason) reasons.push(`${doc.name}: ${r.reason}`);
        undone += r.undone;
      }
    } finally {
      release();
    }
    if (undone) {
      o.markUndone(id);
      // the run's own record shrinks with it (and goes away when nothing of it is left)
      for (const rec of this.runs) if (rec.run === o.runId) rec.edits = runSteps(rec.doc.history, rec.run);
      this.runs = this.runs.filter((rec) => rec.run !== o.runId || rec.edits > 0);
      this.app.emit("docchange", {});
      this.emit("runs", this.runs);
    }
    return { undone, reasons };
  }
}
