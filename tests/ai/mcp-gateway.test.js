import test from "node:test";
import assert from "node:assert/strict";
import { createGateway } from "../../scripts/mcp-gateway.mjs";
import { McpClient } from "../../app/src/ai/mcp.js";

// A tiny stdio MCP server: newline-delimited JSON-RPC on stdin/stdout.
const SERVER = `
const rl = require("node:readline").createInterface({ input: process.stdin });
let inits = 0;
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") { inits++; return send(m.id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } }); }
  if (m.id == null) return;
  if (m.method === "tools/list") return send(m.id, { tools: [{ name: "echo", description: "Echoes text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }, { name: "inits", description: "Initialize count", inputSchema: { type: "object", properties: {} } }] });
  if (m.method === "tools/call") {
    const t = m.params.name === "inits" ? String(inits) : "echo:" + m.params.arguments.text;
    return send(m.id, { content: [{ type: "text", text: t }] });
  }
  send(m.id, {});
});
function send(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }
`;

async function withGateway(opts, fn) {
  const g = await createGateway({ command: process.execPath, args: ["-e", SERVER], port: 0, ...opts });
  try {
    await fn(g);
  } finally {
    await g.close();
  }
}

test("gateway: an MCP client lists and calls tools of a stdio server over HTTP", async () => {
  await withGateway({}, async (g) => {
    const client = new McpClient({ url: g.url, version: "test" });
    await client.connect();
    const tools = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["echo", "inits"]);
    const res = await client.callTool("echo", { text: "hi" });
    assert.match(JSON.stringify(res), /echo:hi/);
  });
});

test("gateway: later clients share one initialized server process", async () => {
  await withGateway({}, async (g) => {
    for (let i = 0; i < 3; i++) {
      const c = new McpClient({ url: g.url, version: "test" });
      await c.connect();
      await c.listTools();
    }
    const c = new McpClient({ url: g.url, version: "test" });
    await c.connect();
    assert.match(JSON.stringify(await c.callTool("inits", {})), /"1"|\\"1\\"/);
  });
});

test("gateway: refuses foreign origins and missing tokens, answers CORS preflight", async () => {
  await withGateway({ token: "s3cret" }, async (g) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const evil = await fetch(g.url, { method: "POST", headers: { origin: "https://evil.example", authorization: "Bearer s3cret", "content-type": "application/json" }, body });
    assert.equal(evil.status, 403);
    const noTok = await fetch(g.url, { method: "POST", headers: { origin: "http://localhost:4191", "content-type": "application/json" }, body });
    assert.equal(noTok.status, 401);
    const pre = await fetch(g.url, { method: "OPTIONS", headers: { origin: "http://localhost:4191" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:4191");
    const ok = await fetch(g.url, { method: "POST", headers: { origin: "http://localhost:4191", authorization: "Bearer s3cret", "content-type": "application/json" }, body });
    assert.equal(ok.status, 200);
  });
});

test("gateway: an extra --origin is allowed", async () => {
  await withGateway({ origins: ["https://studio.example"] }, async (g) => {
    const r = await fetch(g.url, { method: "OPTIONS", headers: { origin: "https://studio.example" } });
    assert.equal(r.status, 204);
  });
});
