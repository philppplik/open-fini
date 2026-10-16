import test from "node:test";
import assert from "node:assert/strict";
import { McpClient, McpError, mcpToolsToAgentTools, mcpToolName, mcpContentToBlocks } from "../../app/src/ai/mcp.js";
import { runAgent } from "../../app/src/ai/agent.js";
import { fakeFetch, jsonResponse, streamResponse } from "./helpers.js";
import { scriptedProvider, toolTurn, textTurn } from "./helpers.js";

const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const sse = (...msgs) => msgs.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join("");

/** Fake MCP server over fetch. */
function server(opts = {}) {
  const state = { sessions: new Set(), log: [], deleted: [] };
  const tools = [
    { name: "alpha", description: "A", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } },
    { name: "beta tool!", description: "B" },
    { name: "beta_tool_", description: "C", title: "C title" },
  ];
  const f = fakeFetch((c) => {
    if (c.method === "DELETE") {
      state.deleted.push(c.headers["Mcp-Session-Id"]);
      return new Response(null, { status: 200 });
    }
    const m = c.json;
    state.log.push({ method: m.method, headers: c.headers });
    if (m.method !== "initialize") {
      const sid = c.headers["Mcp-Session-Id"];
      if (opts.expire && !state.expired && m.method === "tools/list") {
        state.expired = true;
        state.sessions.clear();
      }
      if (!state.sessions.has(sid)) return new Response("Session not found", { status: 404 });
    }
    switch (m.method) {
      case "initialize": {
        const sid = "sess-" + (state.sessions.size + 1);
        state.sessions.add(sid);
        return jsonResponse(rpc(m.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Fake Server", version: "1" }, instructions: "hi" }), { headers: { "mcp-session-id": sid } });
      }
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list": {
        const cur = m.params && m.params.cursor;
        const page = cur === "p2" ? { tools: tools.slice(2) } : { tools: tools.slice(0, 2), nextCursor: "p2" };
        return streamResponse([sse({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } }), sse({ jsonrpc: "2.0", id: 99, method: "ping" }) + sse(rpc(m.id, page))], { headers: { "content-type": "text/event-stream" } });
      }
      case "tools/call": {
        const { name, arguments: a } = m.params;
        if (name === "alpha") return jsonResponse(rpc(m.id, { content: [{ type: "text", text: "result for " + a.q }, { type: "image", data: "QUJD", mimeType: "image/png" }] }));
        if (name === "fail") return jsonResponse(rpc(m.id, { isError: true, content: [{ type: "text", text: "it broke" }] }));
        if (name === "rpcfail") return jsonResponse({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Invalid params", data: { x: 1 } } });
        if (name === "hang") return new Promise(() => {});
        return jsonResponse(rpc(m.id, { content: [], structuredContent: { ok: true } }));
      }
      case "resources/list":
        return jsonResponse(rpc(m.id, { resources: [{ uri: "file:///a", name: "a" }] }));
      case "resources/read":
        return jsonResponse(rpc(m.id, { contents: [{ uri: m.params.uri, text: "body" }] }));
      case "prompts/list":
        return jsonResponse(rpc(m.id, { prompts: [{ name: "p1" }] }));
      case "prompts/get":
        return jsonResponse(rpc(m.id, { messages: [{ role: "user", content: { type: "text", text: "Hello " + m.params.arguments.who } }] }));
      default:
        return jsonResponse({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
    }
  });
  return { f, state, tools };
}

test("mcp: connect negotiates, keeps session id and sends headers", async () => {
  const { f, state } = server();
  const c = new McpClient({ url: "https://mcp.test/mcp", headers: { Authorization: "Bearer T" }, fetch: f, version: "9.9" });
  const info = await c.connect();
  assert.equal(info.serverInfo.name, "Fake Server");
  assert.equal(c.sessionId, "sess-1");
  assert.deepEqual(state.log.map((l) => l.method), ["initialize", "notifications/initialized"]);
  const init = f.calls[0];
  assert.equal(init.json.params.clientInfo.name, "OpenFini");
  assert.equal(init.json.params.clientInfo.version, "9.9");
  assert.equal(init.json.params.protocolVersion, "2025-06-18");
  assert.equal(init.headers.Authorization, "Bearer T");
  assert.match(init.headers.Accept, /text\/event-stream/);
  assert.equal(init.headers["Mcp-Session-Id"], undefined);
  const noted = f.calls[1];
  assert.equal(noted.headers["Mcp-Session-Id"], "sess-1");
  assert.equal(noted.headers["MCP-Protocol-Version"], "2025-06-18");
  await c.connect();
  assert.equal(f.calls.length, 2, "connect is idempotent");
});

test("mcp: listTools follows cursors and parses SSE replies, ignoring server messages", async () => {
  const { f } = server();
  const seen = [];
  const c = new McpClient({ url: "https://mcp.test/mcp", fetch: f, onMessage: (m) => seen.push(m.method) });
  const tools = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["alpha", "beta tool!", "beta_tool_"]);
  assert.deepEqual(seen, ["notifications/message", "ping", "notifications/message", "ping"], "once per page");
});

test("mcp: callTool returns JSON replies, maps errors, honors abort and timeout", async () => {
  const { f } = server();
  const c = new McpClient({ url: "https://mcp.test/mcp", fetch: f, timeoutMs: 50 });
  const r = await c.callTool("alpha", { q: "x" });
  assert.equal(r.content[0].text, "result for x");
  assert.equal((await c.callTool("fail")).isError, true);
  await assert.rejects(c.callTool("rpcfail"), (e) => e instanceof McpError && e.code === -32602 && e.message === "Invalid params" && e.data.x === 1);
  await assert.rejects(c.request("nope/method"), (e) => e.code === -32601);
  assert.equal((await c.listResources())[0].uri, "file:///a");
  assert.equal((await c.readResource("file:///a")).contents[0].text, "body");
  assert.equal((await c.listPrompts())[0].name, "p1");
  assert.match((await c.getPrompt("p1", { who: "Ann" })).messages[0].content.text, /Hello Ann/);

  // a fetch that honors the abort signal
  const shared = server();
  const c3 = new McpClient({
    url: "https://mcp.test/mcp",
    timeoutMs: 40,
    fetch: (url, init) => {
      const body = init.body ? JSON.parse(init.body) : {};
      if (body.method === "tools/call") return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))));
      return shared.f(url, init);
    },
  });
  await assert.rejects(c3.callTool("hang", {}, { timeoutMs: 20 }), (e) => e instanceof McpError && e.code === "timeout");
  const ctl = new AbortController();
  const p = c3.callTool("hang", {}, { signal: ctl.signal, timeoutMs: 5000 });
  setTimeout(() => ctl.abort(), 5);
  await assert.rejects(p, (e) => e.name === "AbortError");
});

test("mcp: expired session (404) re-initializes once; close sends DELETE", async () => {
  const { f, state } = server({ expire: true });
  const c = new McpClient({ url: "https://mcp.test/mcp", fetch: f });
  const tools = await c.listTools();
  assert.equal(tools.length > 0, true);
  assert.equal(c.sessionId, "sess-1");
  assert.equal(state.log.filter((l) => l.method === "initialize").length, 2);
  await c.close();
  assert.deepEqual(state.deleted, ["sess-1"]);
  assert.equal(state.deleted.length, 1);
  assert.equal(c.sessionId, null);
  await c.close(); // no session: no further request
  assert.equal(state.deleted.length, 1);
});

test("mcp: http errors", async () => {
  const f = fakeFetch(() => new Response("forbidden", { status: 403 }));
  const c = new McpClient({ url: "https://mcp.test/mcp", fetch: f });
  await assert.rejects(c.connect(), (e) => e instanceof McpError && e.status === 403 && /forbidden/.test(e.message));
  const g = new McpClient({ url: "https://mcp.test/mcp", fetch: async () => { throw new TypeError("offline"); } });
  await assert.rejects(g.connect(), (e) => e.code === "network_error");
  assert.throws(() => new McpClient({}));
});

test("mcp: tool names are sanitized, bounded and collision-safe", () => {
  const used = new Set();
  const a = mcpToolName("My Server", "do it!", used);
  assert.equal(a, "My_Server__do_it_");
  const b = mcpToolName("My Server", "do_it_", used);
  assert.notEqual(a, b);
  assert.match(b, /^[a-zA-Z0-9_-]{1,64}$/);
  const long = mcpToolName("srv", "x".repeat(200), used);
  assert.equal(long.length, 64);
  const long2 = mcpToolName("srv", "x".repeat(199) + "y", used);
  assert.notEqual(long, long2);
  assert.equal(long2.length <= 64, true);
});

test("mcp: mcpToolsToAgentTools maps tools, approval flags and results", async () => {
  const { f } = server();
  const c = new McpClient({ url: "https://mcp.test/mcp", fetch: f });
  const defs = await mcpToolsToAgentTools(c, { prefix: "fake", serverName: "Fake" });
  assert.equal(defs.length, 3);
  assert.deepEqual(defs.map((d) => d.name), ["fake__alpha", "fake__beta_tool_", "fake__beta_tool__2"]);
  assert.ok(defs.every((d) => /^[a-zA-Z0-9_-]{1,64}$/.test(d.name)));
  assert.equal(defs[0].description, "[Fake] A");
  assert.equal(defs[0].readOnly, true);
  assert.equal(defs[0].needsApproval, undefined);
  assert.equal(typeof defs[1].needsApproval, "function");
  assert.match(defs[1].needsApproval({}), /Fake/);
  assert.deepEqual(defs[1].inputSchema, { type: "object", properties: {} });
  assert.deepEqual(defs[0].inputSchema.properties.q, { type: "string" });
  const out = await defs[0].run({ q: "z" }, {});
  assert.deepEqual(out, [{ type: "text", text: "result for z" }, { type: "image", mime: "image/png", data: "QUJD" }]);

  // isError -> agent sees an error result; full loop with approval for the non-read-only tool
  const failing = await mcpToolsToAgentTools(c, { prefix: "f2", tools: [{ name: "fail", description: "x" }] });
  const provider = scriptedProvider([toolTurn([{ id: "1", name: "f2__fail", input: {} }, { id: "2", name: "fake__alpha", input: { q: "k" } }]), textTurn("done")]);
  const asked = [];
  const r = await runAgent({ provider, model: "m", messages: [{ role: "user", content: "go" }], tools: [...failing, defs[0]], approve: (q) => (asked.push(q.name), true), sleep: async () => {} });
  const res = r.messages[1].content;
  assert.equal(res[0].isError, true);
  assert.match(res[0].content, /it broke/);
  assert.equal(res[1].isError, undefined);
  assert.deepEqual(asked, ["f2__fail"]);
});

test("mcp: content mapping covers resources, audio and structured content", () => {
  const b = mcpContentToBlocks({
    content: [
      { type: "resource", resource: { uri: "file:///x", text: "T" } },
      { type: "resource", resource: { uri: "file:///i", blob: "QQ==", mimeType: "image/png" } },
      { type: "resource", resource: { uri: "file:///b", blob: "QQ==", mimeType: "application/pdf" } },
      { type: "audio", data: "x", mimeType: "audio/wav" },
      { type: "resource_link", uri: "https://l", name: "L" },
    ],
  });
  assert.deepEqual(b.map((x) => x.type), ["text", "image", "text", "text", "text"]);
  assert.match(b[0].text, /file:\/\/\/x\]\nT/);
  assert.deepEqual(mcpContentToBlocks({ content: [], structuredContent: { a: 1 } }), [{ type: "text", text: '{"a":1}' }]);
  assert.deepEqual(mcpContentToBlocks(null), []);
});
