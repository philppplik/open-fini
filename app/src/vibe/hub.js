// The Vibe hub: many chats (VibeSession) running at the same time, plus the services they share — the AI runtime
// module, provider construction, the knowledge index, MCP clients and the document write lock (locks.js).
//
// Public API
//   const hub = getVibeHub(app)                      // singleton per app (also app.vibeHub)
//   hub.view                                          // SessionView: the ACTIVE chat with the old VibeSession API/events
//   hub.create({ hidden, chat }) / hub.newChat() / await hub.open(chatId) / hub.activate(sessionId) / hub.remove(id)
//   hub.list() -> [{ id, title, status, hidden, pending, activity }]   hub.running -> sessions that run
//   hub.stopAll()                                     // global kill switch (also stops sub-agents)
//   events: "sessions" (list/status changed), "active" (switched), "activity" ({ session, ev }), "skill-draft"
//
// Invariants
//   - At most settings.maxChats requests run at once (assertCanStart throws a clear error otherwise).
//   - Background chats never steal focus: their approvals/questions wait in session.pendingApprovals/pendingAsks,
//     the list shows a badge, and SessionView re-emits them when the user switches to that chat.
//   - Shared services are created once; a chat never owns the knowledge index or MCP clients.
import { Emitter } from "../core/util.js";
import { vibeStore } from "./store.js";
import { VibeSession } from "./session.js";
import { WriteLock } from "./locks.js";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "mcp";
const VIEW_EVENTS = ["chat", "message", "event", "approval", "ask", "plan", "notice", "done", "error", "status", "runs"];
const MAX_IDLE_SESSIONS = 24;

/**
 * The active chat as one stable object for the UI. It forwards the active session's events and properties, and when
 * the user switches chats it emits "chat" (re-render from the stored messages), replays the running request's live
 * events and re-emits pending approvals and questions.
 */
export class SessionView extends Emitter {
  constructor(hub) {
    super();
    this.hub = hub;
    this.session = null;
    this.offs = [];
  }
  bind(session) {
    if (this.session === session) return;
    for (const off of this.offs) off();
    this.session = session;
    this.offs = VIEW_EVENTS.map((name) => session.on(name, (...a) => this.emit(name, ...a)));
    this.emit("chat");
    for (const ev of session.live) this.emit("event", ev);
    for (const q of session.pendingAsks) this.emit("ask", q);
    for (const r of session.pendingApprovals) this.emit("approval", r);
    this.emit("status", session.running ? "running" : "idle");
    this.emit("runs", session.runs);
  }
  get id() { return this.session.id; }
  get chat() { return this.session.chat; }
  get running() { return this.session.running; }
  get plan() { return this.session.plan; }
  get runs() { return this.session.runs; }
  get ctx() { return this.session.ctx; }
  get attachments() { return this.session.attachments; }
  get overrides() { return this.session.overrides; }
  get lastUndoError() { return this.session.lastUndoError; }
  settings() { return this.session.settings(); }
  setOverrides(p) { return this.session.setOverrides(p); }
  send(text, files) { return this.session.send(text, files); }
  abort() { return this.session.abort(); }
  undoLastRun() { return this.session.undoLastRun(); }
  newChat() { return this.hub.newChat(); }
  openChat(id) { return this.hub.open(id); }
  providerFor(id) { return this.hub.providerFor(id); }
  knowledgeIndex() { return this.hub.knowledgeIndex(); }
  mcpStatus(srv) { return this.hub.mcpStatus(srv); }
  toolList() { return this.session.toolList(); }
}

export class VibeHub extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    /** @type {Map<string, VibeSession>} */
    this.sessions = new Map();
    this.lock = new WriteLock();
    this.mcp = new Map(); // server id -> { client, tools, error }
    this.knowledge = null;
    this.projectSig = new Map();
    this.view = new SessionView(this);
    this.activeId = null;
    this.activate(this.create().id);
    this.lock.on(() => this.emit("lock", this.lock));
  }

  // ------------------------------------------------------------ sessions
  create({ hidden = false, chat = null } = {}) {
    const s = new VibeSession(this, { hidden, chat });
    this.sessions.set(s.id, s);
    this.#gc();
    this.emit("sessions", this.list());
    return s;
  }
  get(id) {
    return this.sessions.get(id) || null;
  }
  get active() {
    return this.sessions.get(this.activeId) || null;
  }
  activate(id) {
    const s = this.sessions.get(id);
    if (!s || s.hidden) return null;
    this.activeId = id;
    this.view.bind(s);
    this.emit("active", s);
    this.emit("sessions", this.list());
    return s;
  }
  /** Starts a new chat (keeps running chats running). Reuses the active chat when it is still empty. */
  newChat() {
    const cur = this.active;
    if (cur && !cur.running && !cur.starting && !cur.chat.messages.length) {
      this.view.emit("chat");
      return cur;
    }
    return this.activate(this.create().id);
  }
  async open(chatId) {
    const existing = [...this.sessions.values()].find((s) => s.chat.id === chatId);
    if (existing) return this.activate(existing.id);
    const chat = await vibeStore.loadChat(chatId);
    if (!chat) return null;
    const s = this.create({ chat });
    return this.activate(s.id);
  }
  /** Forgets a chat's session (after deleting the chat). */
  remove(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.running) s.abort();
    this.sessions.delete(id);
    if (this.activeId === id) this.activate(this.create().id);
    this.emit("sessions", this.list());
  }
  #gc() {
    const idle = [...this.sessions.values()].filter((s) => !s.running && s.id !== this.activeId && !s.pendingApprovals.length);
    while (this.sessions.size > MAX_IDLE_SESSIONS && idle.length) this.sessions.delete(idle.shift().id);
  }
  get running() {
    return [...this.sessions.values()].filter((s) => s.running);
  }
  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, title: s.chat.title, status: s.status, hidden: s.hidden, running: s.running, pending: s.pendingApprovals.length + s.pendingAsks.length, activity: s.activity, empty: !s.chat.messages.length }));
  }
  /** Status of the session holding `chatId` ("idle" when none). */
  statusOf(chatId) {
    const s = [...this.sessions.values()].find((x) => x.chat.id === chatId);
    return s ? { status: s.status, pending: s.pendingApprovals.length + s.pendingAsks.length, running: s.running, id: s.id } : { status: "idle", pending: 0, running: false };
  }
  sessionChanged(s) {
    this.emit("sessions", this.list());
    this.emit("activity", { session: s, ev: null });
  }
  sessionActivity(s, ev) {
    this.emit("activity", { session: s, ev });
  }
  assertCanStart(s) {
    const max = Math.max(1, vibeStore.settings.maxChats ?? 4);
    const n = this.running.filter((x) => x !== s).length;
    if (n >= max) throw new Error(`${n} chats are already running (limit ${max}, Settings ▸ Artificial intelligence ▸ Models ▸ Engine). Wait for one to finish or stop one.`);
  }
  /** Global kill switch: stops every chat and every sub-agent. */
  stopAll() {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.running) {
        s.abort();
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------ shared services
  ai() {
    return import("../ai/index.js");
  }

  /** Provider instance for a stored provider id ("demo" = the offline mock). */
  async providerFor(id) {
    const ai = await this.ai();
    if (!id || id === "demo") return ai.createMockProvider({ delayMs: this.demoDelay ?? 0 });
    const rec = vibeStore.provider(id);
    if (!rec) throw new Error("The selected provider no longer exists. Pick another one in the model menu.");
    this.app.network?.assert("ai", rec.baseUrl);
    if (vibeStore.locked) throw new Error("Your API keys are locked. Unlock them with your passphrase (Models tab).");
    const key = vibeStore.getKey(id);
    const preset = ai.PROVIDER_PRESETS.find((p) => p.id === rec.preset);
    if (rec.preset === "openai-account") {
      if (!key) throw new Error("You are signed out of your OpenAI account. Sign in again in the Models tab.");
      const { openAIGetToken } = await import("./account-auth.js");
      return ai.createProvider({ kind: rec.kind, baseUrl: rec.baseUrl, getToken: openAIGetToken(id) });
    }
    if (!key && preset?.needsKey !== false) throw new Error(`No API key is stored for ${rec.label}. Add one in the Models tab.`);
    return ai.createProvider({ kind: rec.kind, baseUrl: rec.baseUrl, apiKey: key, headers: rec.headers });
  }

  async imageCtx() {
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

  async knowledgeIndex() {
    if (this.knowledge) return this.knowledge;
    const { KnowledgeIndex } = await this.ai();
    const saved = await vibeStore.loadKnowledge();
    this.knowledge ||= saved ? KnowledgeIndex.fromJSON(saved) : new KnowledgeIndex();
    return this.knowledge;
  }

  /** Keeps the open website project searchable. */
  async syncProject(index) {
    const web = this.app.doc?.web;
    if (!web) return;
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

  async mcpTools(session) {
    const ai = await this.ai();
    const out = [];
    for (const srv of vibeStore.mcpServers.filter((s) => s.enabled !== false)) {
      let entry = this.mcp.get(srv.id);
      if (!entry || entry.url !== srv.url) {
        entry = { url: srv.url, name: srv.name, client: new ai.McpClient({ url: srv.url, headers: srv.headers || {}, auth: await (await import("./account-auth.js")).mcpAuthFor(srv), version: "0.3.0" }), tools: null, error: null };
        this.mcp.set(srv.id, entry);
      }
      try {
        if (!entry.tools) {
          this.app.network?.assert("ai", srv.url);
          entry.connecting ||= entry.client.connect().then(() => ai.mcpToolsToAgentTools(entry.client, { prefix: `mcp_${slug(srv.name)}`, serverName: srv.name }));
          entry.tools = await entry.connecting;
          entry.error = null;
        }
        out.push(...entry.tools);
      } catch (err) {
        entry.error = err.message;
        entry.tools = null;
        entry.connecting = null;
        session?.emit("notice", { kind: "mcp", text: `MCP server “${srv.name}” is unavailable: ${err.message}` });
      }
    }
    return out;
  }

  async mcpStatus(srv) {
    this.app.network?.assert("ai", srv.url);
    const ai = await this.ai();
    const client = new ai.McpClient({ url: srv.url, headers: srv.headers || {}, auth: await (await import("./account-auth.js")).mcpAuthFor(srv), version: "0.3.0" });
    await client.connect();
    const tools = await client.listTools();
    await client.close?.();
    return tools;
  }
}

/** The hub of this app (created on first use; also installs the AI progress pill in the browser). */
export function getVibeHub(app) {
  if (app.vibeHub) return app.vibeHub;
  const hub = new VibeHub(app);
  app.vibeHub = hub;
  if (typeof document !== "undefined") import("../ui/ai-pill.js").then((m) => m.installAiPill(app, hub)).catch(() => {});
  return hub;
}
