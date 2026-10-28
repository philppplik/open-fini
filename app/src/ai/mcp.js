// Model Context Protocol client over Streamable HTTP (spec 2025-06 / 2025-11). Bearer-header auth only.
// Pure: `fetch` is injected, no DOM, no storage.

import { abortError, combineSignals, isAbortError, parseSse } from "./util.js";

/** JSON-RPC / transport error from an MCP server. */
export class McpError extends Error {
  /**
   * @param {string} message
   * @param {{code?:number|string, data?:any, status?:number, wwwAuthenticate?:string}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = "McpError";
    this.code = info.code;
    this.data = info.data;
    this.status = info.status;
    /** `WWW-Authenticate` header of a 401 answer (drives the "Sign in" button, see mcp-oauth.js). */
    this.wwwAuthenticate = info.wwwAuthenticate;
  }
}

const DEFAULT_PROTOCOL = "2025-06-18";

/**
 * MCP client.
 * @example
 *   const c = new McpClient({ url: "https://example.com/mcp", headers: { Authorization: "Bearer ..." } });
 *   await c.connect(); const tools = await c.listTools();
 */
export class McpClient {
  /**
   * @param {{url:string, headers?:Record<string,string>, auth?:{getAccessToken:()=>Promise<string>, onUnauthorized:(www:string|null)=>Promise<boolean>}, fetch?:typeof fetch, name?:string, version?:string, protocolVersion?:string, timeoutMs?:number, onMessage?:(msg:object)=>void}} opts
   */
  constructor(opts) {
    if (!opts || !opts.url) throw new Error("McpClient needs a url.");
    this.url = opts.url;
    this.headers = opts.headers || {};
    /** Optional OAuth session (McpAuthSession): adds `Authorization: Bearer` per request and retries once after a 401 + refresh. */
    this.auth = opts.auth || null;
    this._fetch = opts.fetch || ((...a) => globalThis.fetch(...a));
    this.name = opts.name || "OpenFini";
    this.version = opts.version || "0.0.0";
    this.protocolVersion = opts.protocolVersion || DEFAULT_PROTOCOL;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.onMessage = opts.onMessage || null;
    /** @type {string|null} */ this.sessionId = null;
    /** @type {object|null} */ this.serverInfo = null;
    /** @type {object|null} */ this.serverCapabilities = null;
    /** @type {string|undefined} */ this.instructions = undefined;
    this.negotiatedVersion = null;
    this._id = 0;
    this._connecting = null;
    this.connected = false;
  }

  /** Performs initialize + notifications/initialized. Idempotent. */
  async connect({ signal } = {}) {
    if (this.connected) return this._info();
    if (!this._connecting) {
      this._connecting = this._initialize(signal).finally(() => {
        this._connecting = null;
      });
    }
    return this._connecting;
  }

  _info() {
    return { serverInfo: this.serverInfo, capabilities: this.serverCapabilities, protocolVersion: this.negotiatedVersion, instructions: this.instructions, sessionId: this.sessionId };
  }

  async _initialize(signal) {
    this.sessionId = null;
    this.negotiatedVersion = null;
    const r = await this._rpc("initialize", { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: this.name, version: this.version } }, { signal, retried: true });
    this.negotiatedVersion = r.protocolVersion || this.protocolVersion;
    this.serverInfo = r.serverInfo || null;
    this.serverCapabilities = r.capabilities || {};
    this.instructions = r.instructions;
    await this._notify("notifications/initialized", undefined, { signal });
    this.connected = true;
    return this._info();
  }

  _headers(extra) {
    const h = Object.assign({}, this.headers, { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, extra || {});
    if (this.negotiatedVersion) h["MCP-Protocol-Version"] = this.negotiatedVersion;
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  async _fetchWithTimeout(url, init, { signal, timeoutMs }) {
    const ctl = new AbortController();
    let timedOut = false;
    const ms = timeoutMs ?? this.timeoutMs;
    const timer = ms > 0 ? setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, ms) : null;
    const { signal: sig, dispose } = combineSignals([signal, ctl.signal]);
    const done = () => {
      if (timer) clearTimeout(timer);
      dispose();
    };
    try {
      let res = await this._fetch(url, { ...init, headers: await this._withAuth(init.headers), signal: sig });
      if (res.status === 401 && this.auth && (await this.auth.onUnauthorized(res.headers?.get?.("www-authenticate") || null))) res = await this._fetch(url, { ...init, headers: await this._withAuth(init.headers), signal: sig });
      return { res, sig, done, wasTimeout: () => timedOut };
    } catch (e) {
      done();
      if (timedOut) throw new McpError(`MCP request timed out after ${ms} ms`, { code: "timeout" });
      if (signal && signal.aborted) throw abortError(signal);
      if (isAbortError(e)) throw e;
      throw new McpError(`Network error: ${e && e.message ? e.message : e}`, { code: "network_error" });
    }
  }

  async _withAuth(headers) {
    if (!this.auth) return headers;
    const token = await this.auth.getAccessToken();
    return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
  }

  _rpcError(e) {
    return new McpError(e.message || "MCP error", { code: e.code, data: e.data });
  }

  async _httpError(res) {
    let raw = "";
    try {
      raw = await res.text();
    } catch {
      /* ignore */
    }
    let msg = "";
    let code;
    let data;
    try {
      const j = JSON.parse(raw);
      const e = j && (j.error || j);
      msg = e.message || "";
      code = e.code;
      data = e.data;
    } catch {
      /* not JSON */
    }
    return new McpError(msg || `HTTP ${res.status}${raw ? ": " + raw.slice(0, 200) : ""}`, { code: code ?? res.status, data, status: res.status, wwwAuthenticate: res.headers?.get?.("www-authenticate") || undefined });
  }

  async _rpc(method, params, { signal, timeoutMs, retried } = {}) {
    const id = ++this._id;
    const body = { jsonrpc: "2.0", id, method };
    if (params !== undefined) body.params = params;
    const { res, sig, done, wasTimeout } = await this._fetchWithTimeout(this.url, { method: "POST", headers: this._headers(), body: JSON.stringify(body) }, { signal, timeoutMs });
    try {
      if (res.status === 404 && this.sessionId && method !== "initialize" && !retried) {
        // session expired: start a new one and retry once
        this.connected = false;
        done();
        await this._initialize(signal);
        return this._rpc(method, params, { signal, timeoutMs, retried: true });
      }
      if (!res.ok) throw await this._httpError(res);
      const sid = res.headers && res.headers.get && res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;
      const ctype = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
      let found = null;
      const consider = (m) => {
        if (!m || typeof m !== "object") return;
        if (m.id === id && ("result" in m || "error" in m)) found = m;
        else if (this.onMessage) {
          try {
            this.onMessage(m);
          } catch {
            /* ignore */
          }
        }
      };
      if (/text\/event-stream/i.test(ctype)) {
        try {
          for await (const ev of parseSse(res, sig)) {
            let j;
            try {
              j = JSON.parse(ev.data);
            } catch {
              continue;
            }
            if (Array.isArray(j)) j.forEach(consider);
            else consider(j);
            if (found) break;
          }
        } catch (e) {
          if (wasTimeout()) throw new McpError(`MCP request timed out`, { code: "timeout" });
          if (signal && signal.aborted) throw abortError(signal);
          throw e;
        }
      } else {
        const text = await res.text();
        if (text.trim()) {
          let j;
          try {
            j = JSON.parse(text);
          } catch {
            throw new McpError("The MCP server returned invalid JSON.", { code: "bad_response", status: res.status });
          }
          if (Array.isArray(j)) j.forEach(consider);
          else consider(j);
        }
      }
      if (!found) throw new McpError(`The MCP server sent no response to "${method}".`, { code: "no_response", status: res.status });
      if (found.error) throw this._rpcError(found.error);
      return found.result ?? {};
    } finally {
      done();
    }
  }

  async _notify(method, params, { signal } = {}) {
    const body = { jsonrpc: "2.0", method };
    if (params !== undefined) body.params = params;
    const { res, done } = await this._fetchWithTimeout(this.url, { method: "POST", headers: this._headers(), body: JSON.stringify(body) }, { signal });
    try {
      if (!res.ok) throw await this._httpError(res);
      try {
        await res.text();
      } catch {
        /* ignore */
      }
    } finally {
      done();
    }
  }

  /** Sends a request after making sure the session exists. */
  async request(method, params, opts = {}) {
    await this.connect({ signal: opts.signal });
    return this._rpc(method, params, opts);
  }

  async _paged(method, key, params = {}, opts = {}) {
    const out = [];
    let cursor;
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const r = await this.request(method, cursor ? { ...params, cursor } : { ...params }, opts);
      if (Array.isArray(r[key])) out.push(...r[key]);
      cursor = r.nextCursor;
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
    }
    return out;
  }

  /** Lists all tools (follows cursors). @returns {Promise<object[]>} */
  listTools(opts) {
    return this._paged("tools/list", "tools", {}, opts);
  }

  /**
   * Calls a tool. Resolves with the raw MCP result ({content, isError?, structuredContent?}).
   * @param {string} name
   * @param {object} [args]
   * @param {{signal?:AbortSignal, timeoutMs?:number}} [opts]
   */
  callTool(name, args, opts = {}) {
    return this.request("tools/call", { name, arguments: args ?? {} }, { timeoutMs: opts.timeoutMs ?? Math.max(this.timeoutMs, 120000), signal: opts.signal });
  }

  /** @returns {Promise<object[]>} */
  listResources(opts) {
    return this._paged("resources/list", "resources", {}, opts);
  }

  /** @param {string} uri */
  async readResource(uri, opts) {
    return this.request("resources/read", { uri }, opts);
  }

  /** @returns {Promise<object[]>} */
  listPrompts(opts) {
    return this._paged("prompts/list", "prompts", {}, opts);
  }

  /** @param {string} name @param {Record<string,string>} [args] */
  getPrompt(name, args, opts) {
    return this.request("prompts/get", { name, arguments: args ?? {} }, opts);
  }

  /** Ends the session (HTTP DELETE with the session id). Never throws. */
  async close() {
    const sid = this.sessionId;
    this.connected = false;
    if (!sid) return;
    try {
      const { res, done } = await this._fetchWithTimeout(this.url, { method: "DELETE", headers: this._headers() }, { timeoutMs: 5000 });
      done();
      void res;
    } catch {
      /* servers may answer 405 or be gone */
    }
    this.sessionId = null;
  }
}

// ------------------------------------------------------------------ agent integration

/**
 * Maps an MCP tool result to neutral Blocks (text / image). Audio and unknown parts become text notes.
 * @param {{content?:object[], structuredContent?:any}} result
 * @returns {({type:'text',text:string}|{type:'image',mime:string,data:string})[]}
 */
export function mcpContentToBlocks(result) {
  const out = [];
  for (const c of (result && result.content) || []) {
    if (!c) continue;
    if (c.type === "text") out.push({ type: "text", text: String(c.text ?? "") });
    else if (c.type === "image" && c.data) out.push({ type: "image", mime: c.mimeType || "image/png", data: c.data });
    else if (c.type === "audio") out.push({ type: "text", text: `[audio content omitted (${c.mimeType || "unknown type"})]` });
    else if (c.type === "resource" && c.resource) {
      const r = c.resource;
      if (typeof r.text === "string") out.push({ type: "text", text: `[resource ${r.uri || ""}]\n${r.text}` });
      else if (r.blob && /^image\//.test(r.mimeType || "")) out.push({ type: "image", mime: r.mimeType, data: r.blob });
      else out.push({ type: "text", text: `[binary resource ${r.uri || ""} (${r.mimeType || "unknown type"})]` });
    } else if (c.type === "resource_link") out.push({ type: "text", text: `[resource link ${c.uri || ""}${c.name ? " (" + c.name + ")" : ""}]` });
  }
  if (!out.length && result && result.structuredContent !== undefined) out.push({ type: "text", text: JSON.stringify(result.structuredContent) });
  return out;
}

function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6).padStart(6, "0");
}

/**
 * Builds a tool name `${prefix}__${tool}` limited to [a-zA-Z0-9_-]{1,64}, unique within `used`.
 * @param {string} prefix
 * @param {string} tool
 * @param {Set<string>} used
 */
export function mcpToolName(prefix, tool, used = new Set()) {
  const clean = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
  let base = `${clean(prefix)}__${clean(tool)}`;
  if (base.length > 64) base = base.slice(0, 57) + "_" + shortHash(`${prefix}__${tool}`);
  let name = base;
  for (let n = 2; used.has(name); n++) {
    const suffix = `_${n}`;
    name = base.slice(0, 64 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

/**
 * Lists the server's tools and wraps them as agent ToolDefs. Tools need approval unless the server
 * marks them `annotations.readOnlyHint`. Results from MCP servers are untrusted data.
 * @param {McpClient} client
 * @param {{prefix?:string, serverName?:string, usedNames?:Set<string>, tools?:object[]}} [opts]
 * @returns {Promise<import('./agent.js').ToolDef[]>}
 */
export async function mcpToolsToAgentTools(client, opts = {}) {
  const info = (await client.connect()) || {};
  const serverName = opts.serverName || (info.serverInfo && (info.serverInfo.title || info.serverInfo.name)) || opts.prefix || "mcp";
  const prefix = opts.prefix || String(serverName).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "mcp";
  const used = opts.usedNames || new Set();
  const list = opts.tools || (await client.listTools());
  return list
    .filter((t) => t && typeof t.name === "string")
    .map((t) => {
      const readOnly = !!(t.annotations && t.annotations.readOnlyHint === true);
      const def = {
        name: mcpToolName(prefix, t.name, used),
        description: `[${serverName}] ${t.description || t.title || t.name}`,
        inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
        async run(input, ctx = {}) {
          const r = await client.callTool(t.name, input, { signal: ctx.signal });
          const blocks = mcpContentToBlocks(r);
          if (r && r.isError) throw new Error(blocks.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n") || "The tool reported an error.");
          return blocks.length ? blocks : "OK";
        },
      };
      if (readOnly) def.readOnly = true;
      else def.needsApproval = () => `Run "${t.title || t.name}" on ${serverName}`;
      return def;
    });
}
