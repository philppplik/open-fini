// MCP gateway: lets Vibe Studio (a browser app) use MCP servers that are normal programs speaking stdio —
// for example REA — by exposing one of them as a Streamable HTTP MCP endpoint on 127.0.0.1.
//
//   npm run mcp:gateway -- --port 3939 -- node _vendor/rea/scripts/rea.mjs
//   npm run mcp:gateway -- --port 3940 --token secret -- npx -y @modelcontextprotocol/server-filesystem ~/Documents
//
// Then add http://127.0.0.1:3939/mcp under Vibe Studio ▸ Tools ▸ MCP servers.
//
// Safety: the server listens on 127.0.0.1 only, accepts browser requests only from allowed origins
// (localhost, the hosted app, the desktop app; add more with --origin), and can require a bearer token.
// Several clients share one child process; request ids are remapped so they cannot collide.
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const DEFAULT_ORIGINS = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, /^https:\/\/philppplik\.github\.io$/, /^tauri:\/\/localhost$/, /^https?:\/\/tauri\.localhost$/];

function originAllowed(origin, extra) {
  if (!origin) return true; // not a browser request
  if (extra.includes(origin)) return true;
  return DEFAULT_ORIGINS.some((re) => re.test(origin));
}

/**
 * @param {{command: string, args?: string[], port?: number, host?: string, origins?: string[], token?: string, log?: (s: string) => void, cwd?: string, shell?: boolean}} o
 * @returns {Promise<{server: http.Server, child: import("node:child_process").ChildProcess, url: string, close: () => Promise<void>}>}
 */
export function createGateway({ command, args = [], port = 3939, host = "127.0.0.1", origins = [], token = "", log = () => {}, cwd, shell } = {}) {
  if (!command) throw new Error("A command to run is required.");
  const useShell = shell ?? (process.platform === "win32" && /^(npx|npm|pnpm|yarn)$|\.(cmd|bat)$/i.test(command));
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], shell: useShell, cwd });
  const pending = new Map(); // upstream id → { res, clientId, timer }
  let seq = 0;
  let initResult = null; // the child's reply to the first initialize
  let initWaiters = [];
  let alive = true;

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log(`non-JSON output from the server: ${line.slice(0, 120)}`);
        continue;
      }
      if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (p.initialize && msg.result) {
          initResult = msg.result;
          for (const w of initWaiters) w();
          initWaiters = [];
        }
        p.respond({ ...msg, id: p.clientId });
      } else log(`server message ignored: ${String(msg.method || "response").slice(0, 60)}`);
    }
  });
  child.on("exit", (code) => {
    alive = false;
    log(`the server exited (${code})`);
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.fail(502, "The MCP server process ended.");
      pending.delete(id);
    }
  });
  child.on("error", (err) => log(`could not start the server: ${err.message}`));

  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version, authorization, accept, last-event-id");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Access-Control-Max-Age", "600");
    }
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    cors(req, res);
    if (!originAllowed(origin, origins)) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Origin not allowed. Start the gateway with --origin <origin> to allow it.");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (new URL(req.url, "http://x").pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("MCP endpoint: /mcp");
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "text/plain" });
      return res.end("A bearer token is required.");
    }
    if (req.method === "DELETE") {
      res.writeHead(200);
      return res.end();
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST, DELETE, OPTIONS", "content-type": "text/plain" });
      return res.end("This gateway answers POST requests only (no server-initiated streams).");
    }
    if (!alive) {
      res.writeHead(502, { "content-type": "text/plain" });
      return res.end("The MCP server process is not running.");
    }
    let body = "";
    req.setEncoding("utf8");
    for await (const c of req) {
      body += c;
      if (body.length > 8 * 1024 * 1024) {
        res.writeHead(413);
        return res.end();
      }
    }
    let msgs;
    try {
      msgs = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
    }
    const batch = Array.isArray(msgs);
    const list = batch ? msgs : [msgs];
    const replies = [];
    let outstanding = 0;
    let finished = false;
    const sessionId = req.headers["mcp-session-id"] || (list.some((m) => m.method === "initialize") ? randomUUID() : undefined);
    const done = () => {
      if (finished || outstanding > 0) return;
      finished = true;
      const headers = { "content-type": "application/json", ...(sessionId ? { "mcp-session-id": sessionId } : {}) };
      if (!replies.length) {
        res.writeHead(202, headers);
        return res.end();
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(batch ? replies : replies[0]));
    };
    const failAll = (status, text) => {
      if (finished) return;
      finished = true;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(text);
    };
    for (const m of list) {
      if (m.id == null || m.method == null) {
        // notification or response from the client
        if (m.method === "notifications/initialized" && initResult) continue; // the child was initialized already
        send(m);
        continue;
      }
      if (m.method === "initialize" && initResult) {
        replies.push({ jsonrpc: "2.0", id: m.id, result: initResult });
        continue;
      }
      outstanding++;
      const upstream = `gw-${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(upstream);
        outstanding--;
        replies.push({ jsonrpc: "2.0", id: m.id, error: { code: -32001, message: "The MCP server did not answer in time." } });
        done();
      }, 10 * 60 * 1000);
      pending.set(upstream, {
        clientId: m.id,
        timer,
        initialize: m.method === "initialize",
        respond: (r) => {
          outstanding--;
          replies.push(r);
          done();
        },
        fail: failAll,
      });
      send({ ...m, id: upstream });
    }
    done();
  });

  return new Promise((resolveP, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolveP({
        server,
        child,
        url: `http://${host}:${addr.port}/mcp`,
        close: () =>
          new Promise((r) => {
            try {
              child.kill();
            } catch {
              /* already gone */
            }
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

// ------------------------------------------------------------------- CLI

function parse(argv) {
  const opts = { port: 3939, origins: [], token: "", host: "127.0.0.1" };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      i++;
      break;
    }
    if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--origin") opts.origins.push(argv[++i]);
    else if (a === "--token") opts.token = argv[++i];
    else if (a === "--cwd") opts.cwd = resolve(argv[++i]);
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  [opts.command, ...opts.args] = argv.slice(i);
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const o = parse(process.argv.slice(2));
    if (o.help || !o.command) {
      console.log("Usage: node scripts/mcp-gateway.mjs [--port 3939] [--origin <origin>]... [--token <secret>] [--cwd <dir>] -- <command> [args...]");
      process.exit(o.help ? 0 : 1);
    }
    const g = await createGateway({ ...o, log: (s) => console.error(`[gateway] ${s}`) });
    console.log(`MCP gateway ready: ${g.url}\nServing: ${[o.command, ...o.args].join(" ")}\nAdd the URL in Vibe Studio ▸ Tools ▸ MCP servers. Press Ctrl+C to stop.`);
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => g.close().then(() => process.exit(0)));
  } catch (err) {
    console.error(`mcp-gateway: ${err.message}`);
    process.exit(1);
  }
}
