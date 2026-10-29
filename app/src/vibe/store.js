// Persistence of everything Vibe Studio keeps on this device (IndexedDB through core/storage.js):
// providers and API keys (optionally sealed with a passphrase), settings, chats, skills, custom tools,
// MCP servers, memory notes and the knowledge index. Nothing here is ever written into a document.
import { Emitter, uid } from "../core/util.js";
import { kvGet, kvSet, kvDelete } from "../core/storage.js";

const K = {
  providers: "vibe.providers",
  secrets: "vibe.secrets", // { [providerId]: apiKey } plain, or { sealed: <vault envelope> }
  settings: "vibe.settings",
  chats: "vibe.chats",
  chat: (id) => `vibe.chat.${id}`,
  skills: "vibe.skills",
  tools: "vibe.tools",
  mcp: "vibe.mcp",
  memory: "vibe.memory",
  knowledge: "vibe.knowledge",
  skillStats: "vibe.skillStats",
};

export const DEFAULT_SETTINGS = () => ({
  activeProvider: null,
  model: "",
  imageProvider: null,
  imageModel: "",
  embedProvider: null,
  embedModel: "",
  approval: "balanced", // careful: confirm every change · balanced: confirm costs, deletes and new tools · auto: apply everything except new tools and MCP calls
  reasoning: "off", // off | low | medium | high
  maxSteps: 24,
  disabledTools: [],
  webAccess: null, // Settings ▸ Artificial intelligence ▸ Web access; defaults in vibe/web-access.js (off)
  autoAllow: [],
  extraInstructions: "",
  sendScreenshots: true,
  vault: false,
  // engine (hub, sub-agents, skills); see docs/vibe-studio.md
  maxChats: 4, // chats that may run at the same time
  maxAgents: 3, // sub-agents running at once per chat (more are queued)
  agentModel: "", // model id for sub-agents on the chat's provider ("" = same model as the chat)
  agentSteps: 12, // step limit per sub-agent
  agentBudgetSteps: 80, // total sub-agent steps per request
  agentBudgetTokens: 400000, // total sub-agent tokens per request (when the provider reports usage)
  enforceSkillTools: true, // honor `enforce-tools: true` in skills
  suggestSkills: true, // show the "Use skill X?" chip under the composer
  // model routing with fallback (ai/routing.js): routes = [{ id, name, targets:[{providerId, model, label?, enabled?, timeoutMs?}], policy:{...} }]
  routes: [],
  activeRoute: null, // route id; null = the single activeProvider/model pair acts as a one-element route
});

/** The single store instance; emits "change" with the key group that changed. */
class VibeStore extends Emitter {
  settings = DEFAULT_SETTINGS();
  providers = []; // [{ id, preset, label, kind, baseUrl, headers? }]
  secrets = {}; // unlocked API keys in memory only: { [providerId]: key }
  chats = []; // [{ id, title, updated, model }]
  skills = []; // user skills: { name, description, body, enabled }
  customTools = []; // { name, description, inputSchema, code, enabled }
  mcpServers = []; // { id, name, url, headers, enabled }
  memory = []; // [{ id, text, time }]
  skillStats = {}; // { [skillName]: { uses, last } }
  loaded = false;
  locked = false; // vault enabled and not yet unlocked this session
  #sealed = null;

  async load() {
    if (this.loaded) return this;
    const [settings, providers, secrets, chats, skills, tools, mcp, memory, skillStats] = await Promise.all([K.settings, K.providers, K.secrets, K.chats, K.skills, K.tools, K.mcp, K.memory, K.skillStats].map((k) => kvGet(k)));
    this.skillStats = skillStats || {};
    this.settings = { ...DEFAULT_SETTINGS(), ...(settings || {}) };
    this.providers = providers || [];
    this.chats = chats || [];
    this.skills = skills || [];
    this.customTools = tools || [];
    this.mcpServers = mcp || [];
    this.memory = memory || [];
    if (secrets?.sealed) {
      this.#sealed = secrets.sealed;
      this.locked = true;
    } else this.secrets = secrets || {};
    this.loaded = true;
    return this;
  }

  async #save(key, value, group) {
    await kvSet(key, value);
    this.emit("change", group);
  }

  saveSettings(patch = {}) {
    Object.assign(this.settings, patch);
    return this.#save(K.settings, this.settings, "settings");
  }

  // ---- providers and keys
  async saveProvider(p) {
    const i = this.providers.findIndex((x) => x.id === p.id);
    const rec = { id: p.id || uid("prov"), preset: p.preset, label: p.label, kind: p.kind, baseUrl: p.baseUrl, headers: p.headers || {} };
    if (i >= 0) this.providers[i] = rec;
    else this.providers.push(rec);
    if (p.apiKey !== undefined) await this.setKey(rec.id, p.apiKey);
    if (!this.settings.activeProvider) this.settings.activeProvider = rec.id;
    await this.#save(K.providers, this.providers, "providers");
    await this.saveSettings();
    return rec;
  }
  async removeProvider(id) {
    this.providers = this.providers.filter((p) => p.id !== id);
    delete this.secrets[id];
    await this.#persistSecrets();
    for (const k of ["activeProvider", "imageProvider", "embedProvider"]) if (this.settings[k] === id) this.settings[k] = null;
    await this.#save(K.providers, this.providers, "providers");
    await this.saveSettings();
  }
  getKey(id) {
    return this.secrets[id] || "";
  }
  async setKey(id, key) {
    if (key) this.secrets[id] = key;
    else delete this.secrets[id];
    await this.#persistSecrets();
    this.emit("change", "providers");
  }
  async #persistSecrets() {
    if (this.settings.vault && this.passphrase) {
      const { encryptJson } = await import("../ai/index.js");
      this.#sealed = await encryptJson(this.secrets, this.passphrase);
      await kvSet(K.secrets, { sealed: this.#sealed });
    } else if (!this.settings.vault) await kvSet(K.secrets, this.secrets);
  }
  /** Seals the keys with a passphrase (or removes the seal when `passphrase` is empty). */
  async setVault(passphrase) {
    if (passphrase) {
      this.passphrase = passphrase;
      this.settings.vault = true;
      this.locked = false;
      await this.#persistSecrets();
    } else {
      this.passphrase = null;
      this.settings.vault = false;
      this.locked = false;
      await kvSet(K.secrets, this.secrets);
    }
    await this.saveSettings();
  }
  async unlock(passphrase) {
    const { decryptJson } = await import("../ai/index.js");
    this.secrets = await decryptJson(this.#sealed, passphrase); // throws on a wrong passphrase
    this.passphrase = passphrase;
    this.locked = false;
    this.emit("change", "providers");
  }

  provider(id = this.settings.activeProvider) {
    return this.providers.find((p) => p.id === id) || null;
  }

  // ---- collections
  saveSkills(list) {
    this.skills = list;
    return this.#save(K.skills, list, "skills");
  }
  saveCustomTools(list) {
    this.customTools = list;
    return this.#save(K.tools, list, "tools");
  }
  saveMcp(list) {
    this.mcpServers = list;
    return this.#save(K.mcp, list, "mcp");
  }
  async addMemory(text) {
    this.memory.push({ id: uid("m"), text: String(text).slice(0, 400), time: Date.now() });
    this.memory = this.memory.slice(-60);
    await this.#save(K.memory, this.memory, "memory");
  }
  saveMemory(list) {
    this.memory = list;
    return this.#save(K.memory, list, "memory");
  }
  /** Counts a use of a skill (Skills panel shows "used N times, last …"). Local only. */
  noteSkillUse(name) {
    const s = (this.skillStats[name] ||= { uses: 0, last: 0 });
    s.uses++;
    s.last = Date.now();
    return this.#save(K.skillStats, this.skillStats, "skillStats");
  }

  // ---- chats
  async loadChat(id) {
    return (await kvGet(K.chat(id))) || null;
  }
  async saveChat(chat) {
    const meta = { id: chat.id, title: chat.title, updated: Date.now(), model: chat.model || "" };
    const i = this.chats.findIndex((c) => c.id === chat.id);
    if (i >= 0) this.chats[i] = meta;
    else this.chats.unshift(meta);
    this.chats.sort((a, b) => b.updated - a.updated);
    this.chats = this.chats.slice(0, 80);
    await kvSet(K.chat(chat.id), chat);
    await this.#save(K.chats, this.chats, "chats");
  }
  async deleteChat(id) {
    this.chats = this.chats.filter((c) => c.id !== id);
    await kvDelete(K.chat(id));
    await this.#save(K.chats, this.chats, "chats");
  }

  // ---- knowledge index (serialized by the RAG engine)
  loadKnowledge() {
    return kvGet(K.knowledge);
  }
  saveKnowledge(json) {
    return kvSet(K.knowledge, json);
  }

  /** Forgets everything (Settings ▸ Security ▸ clear AI data). */
  async clearAll() {
    for (const k of Object.values(K)) if (typeof k === "string") await kvDelete(k);
    for (const c of this.chats) await kvDelete(K.chat(c.id));
    Object.assign(this, { settings: DEFAULT_SETTINGS(), providers: [], secrets: {}, chats: [], skills: [], customTools: [], mcpServers: [], memory: [], skillStats: {}, locked: false, passphrase: null });
    this.emit("change", "all");
  }
}

export const vibeStore = new VibeStore();
