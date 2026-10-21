#!/usr/bin/env node
// OpenFini collaboration relay: a minimal, dependency-free WebSocket server (RFC 6455) that forwards encrypted frames
// between the members of a room. It never sees plaintext: clients encrypt and sign everything (app/src/collab/crypto.js).
//
//   npm run relay                                   127.0.0.1:8787 (this device only)
//   node scripts/relay.mjs --host 0.0.0.0           the local network (prints a warning; use TLS or a trusted LAN)
//   node scripts/relay.mjs --tls-cert c.pem --tls-key k.pem --port 8443    wss:// directly
//   node scripts/relay.mjs --origin https://app.example.org --max-rooms 50 --max-peers 8
//
// What it does: rooms by id (created on first join, deleted when empty: no persistence), the first joiner pins the
// room's access token (derived from the room secret; others must present the same token), fan-out of text frames to
// the other peers, frame size limit, per-connection rate limits (messages and bytes), per-IP connection limit, ping/pong
// keep-alive, an Origin allow-list for browsers. Logs contain counts, short room-id prefixes and error codes, never
// payloads or tokens. Protocol: docs/collaboration.md ▸ Relay protocol. Module API (tests): startRelay(options).
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const DEFAULT_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost", "http://127.0.0.1", "https://localhost"];

export const DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 8787,
  maxFrame: 256 * 1024 + 1024, // the clients' frame limit plus the JSON wrapper
  maxRooms: 200,
  maxPeers: 16,
  maxConnections: 512,
  maxPerIp: 32,
  rate: 150, // messages per second (sustained)
  burst: 300,
  bytesPerSecond: 4 * 1024 * 1024,
  pingMs: 20000,
  joinTimeoutMs: 10000,
});

class Bucket {
  constructor(rate, burst) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.t = Date.now();
  }
  take(n) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.t) / 1000) * this.rate);
    this.t = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Origin check: exact match, or a loopback origin on any port when the list contains it without a port. */
export function originAllowed(origin, allow) {
  if (allow === "*") return true;
  if (!origin) return true; // non-browser clients send no Origin (they could fake any value anyway)
  if (allow.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return allow.includes(`${u.protocol}//${u.hostname}`) && ["localhost", "127.0.0.1", "[::1]", "tauri.localhost"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Encodes one unmasked server frame. */
export function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * Starts a relay. Resolves when listening.
 * @returns {Promise<{port:number, host:string, close:()=>Promise<void>, stats:()=>object, server:any}>}
 */
export function startRelay(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const origins = o.origins === "*" ? "*" : [...DEFAULT_ORIGINS, ...(o.origins || [])];
  const log = o.log === false ? () => {} : o.log || ((...a) => console.log(new Date().toISOString(), ...a));
  const rooms = new Map(); // id → { token, peers:Set<Conn> }
  const conns = new Set();
  const perIp = new Map();
  const counters = { frames: 0, bytes: 0, rejected: 0 };
  const short = (id) => `${String(id).slice(0, 6)}…`;

  const handler = (req, res) => {
    // a tiny health page: counts only
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`OpenFini relay: ${rooms.size} rooms, ${conns.size} connections. This server only forwards encrypted frames.\n`);
  };
  const server = o.tlsCert && o.tlsKey ? createHttps({ cert: readFileSync(o.tlsCert), key: readFileSync(o.tlsKey) }, handler) : createHttp(handler);

  server.on("upgrade", (req, socket) => {
    const ip = req.socket.remoteAddress || "?";
    const deny = (code, text) => {
      counters.rejected++;
      socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (String(req.headers.upgrade || "").toLowerCase() !== "websocket") return deny(400, "Bad Request");
    if (req.headers["sec-websocket-version"] !== "13") return deny(426, "Upgrade Required");
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return deny(400, "Bad Request");
    if (!originAllowed(req.headers.origin, origins)) {
      log(`refused origin ${String(req.headers.origin).slice(0, 80)}`);
      return deny(403, "Forbidden");
    }
    if (conns.size >= o.maxConnections || (perIp.get(ip) || 0) >= o.maxPerIp) return deny(503, "Service Unavailable");
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const c = { socket, ip, room: null, alive: true, buf: Buffer.alloc(0), frag: null, closed: false, msgs: new Bucket(o.rate, o.burst), bytes: new Bucket(o.bytesPerSecond, o.bytesPerSecond * 2), strikes: 0 };
    conns.add(c);
    c.joinTimer = setTimeout(() => !c.room && close(c, 1008, "join timeout"), o.joinTimeoutMs);
    socket.on("data", (d) => onData(c, d));
    socket.on("close", () => cleanup(c));
    socket.on("error", () => cleanup(c));
  });

  const sendRaw = (c, opcode, payload) => {
    if (c.closed) return;
    try {
      c.socket.write(encodeFrame(opcode, payload));
    } catch {
      cleanup(c);
    }
  };
  const sendJson = (c, obj) => sendRaw(c, 1, Buffer.from(JSON.stringify(obj)));

  function close(c, code = 1000, reason = "") {
    if (c.closed) return;
    const r = Buffer.from(reason.slice(0, 100));
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    sendRaw(c, 8, p);
    c.closed = true;
    c.socket.end();
    setTimeout(() => c.socket.destroy(), 1000).unref?.();
    cleanup(c);
  }

  function cleanup(c) {
    if (!conns.has(c)) return;
    conns.delete(c);
    c.closed = true;
    clearTimeout(c.joinTimer);
    const n = (perIp.get(c.ip) || 1) - 1;
    if (n <= 0) perIp.delete(c.ip);
    else perIp.set(c.ip, n);
    if (c.room) {
      const r = rooms.get(c.room);
      if (r) {
        r.peers.delete(c);
        if (!r.peers.size) {
          rooms.delete(c.room);
          log(`room ${short(c.room)} closed`);
        } else for (const p of r.peers) sendJson(p, { t: "peers", n: r.peers.size - 1 });
      }
    }
  }

  function onData(c, data) {
    c.buf = c.buf.length ? Buffer.concat([c.buf, data]) : data;
    if (c.buf.length > o.maxFrame * 2 + 14) return close(c, 1009, "too large");
    for (;;) {
      if (c.closed || c.buf.length < 2) return;
      const b0 = c.buf[0];
      const b1 = c.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      if (b0 & 0x70) return close(c, 1002, "reserved bits");
      if (!(b1 & 0x80)) return close(c, 1002, "unmasked client frame");
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (c.buf.length < 4) return;
        len = c.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (c.buf.length < 10) return;
        const big = c.buf.readBigUInt64BE(2);
        if (big > BigInt(o.maxFrame)) return close(c, 1009, "too large");
        len = Number(big);
        off = 10;
      }
      if (len > o.maxFrame) return close(c, 1009, "too large");
      if (c.buf.length < off + 4 + len) return;
      const mask = c.buf.subarray(off, off + 4);
      const payload = Buffer.from(c.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      c.buf = c.buf.subarray(off + 4 + len);
      if (opcode >= 8) {
        if (!fin || len > 125) return close(c, 1002, "bad control frame");
        if (opcode === 8) return close(c, 1000);
        if (opcode === 9) sendRaw(c, 10, payload);
        if (opcode === 10) c.alive = true;
        continue;
      }
      if (opcode === 2) return close(c, 1003, "text frames only");
      if (opcode === 1) {
        if (c.frag) return close(c, 1002, "unfinished message");
        if (fin) onMessage(c, payload);
        else c.frag = [payload];
      } else if (opcode === 0) {
        if (!c.frag) return close(c, 1002, "unexpected continuation");
        c.frag.push(payload);
        const total = c.frag.reduce((s, p) => s + p.length, 0);
        if (total > o.maxFrame) return close(c, 1009, "too large");
        if (fin) {
          const all = Buffer.concat(c.frag);
          c.frag = null;
          onMessage(c, all);
        }
      } else return close(c, 1002, "unknown opcode");
    }
  }

  function onMessage(c, payload) {
    c.alive = true;
    if (!c.msgs.take(1) || !c.bytes.take(payload.length)) {
      counters.rejected++;
      sendJson(c, { t: "error", code: "rate" });
      if (++c.strikes > o.burst) close(c, 1008, "rate limit");
      return;
    }
    let m;
    try {
      m = JSON.parse(payload.toString("utf8"));
    } catch {
      return close(c, 1007, "invalid JSON");
    }
    if (!m || typeof m !== "object") return close(c, 1007, "invalid message");
    if (m.t === "join") {
      if (c.room) return sendJson(c, { t: "error", code: "joined" });
      if (typeof m.room !== "string" || !ID_RE.test(m.room) || typeof m.token !== "string" || !ID_RE.test(m.token)) return close(c, 1008, "bad join");
      let r = rooms.get(m.room);
      if (!r) {
        if (rooms.size >= o.maxRooms) {
          sendJson(c, { t: "error", code: "too_many_rooms" });
          return close(c, 1008, "too many rooms");
        }
        r = { token: m.token, peers: new Set() };
        rooms.set(m.room, r);
        log(`room ${short(m.room)} opened (${rooms.size} rooms)`);
      } else if (r.token !== m.token) {
        counters.rejected++;
        log(`refused join of room ${short(m.room)}: wrong access token`);
        sendJson(c, { t: "error", code: "forbidden" });
        return close(c, 1008, "forbidden");
      }
      if (r.peers.size >= o.maxPeers) {
        sendJson(c, { t: "error", code: "room_full" });
        return close(c, 1008, "room full");
      }
      clearTimeout(c.joinTimer);
      c.room = m.room;
      r.peers.add(c);
      sendJson(c, { t: "joined", peers: r.peers.size - 1 });
      for (const p of r.peers) if (p !== c) sendJson(p, { t: "peers", n: r.peers.size - 1 });
      return;
    }
    if (m.t === "msg") {
      if (!c.room) return close(c, 1008, "join first");
      if (typeof m.d !== "string") return close(c, 1007, "invalid message");
      const r = rooms.get(c.room);
      if (!r) return;
      counters.frames++;
      counters.bytes += payload.length;
      const out = encodeFrame(1, Buffer.from(`{"t":"msg","d":${JSON.stringify(m.d)}}`));
      for (const p of r.peers) {
        if (p === c || p.closed) continue;
        // a slow receiver must not make the relay buffer without bound
        if (p.socket.writableLength > o.maxFrame * 64) {
          close(p, 1008, "too slow");
          continue;
        }
        try {
          p.socket.write(out);
        } catch {
          cleanup(p);
        }
      }
      return;
    }
    sendJson(c, { t: "error", code: "unknown" });
  }

  const pinger = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) {
        close(c, 1001, "ping timeout");
        continue;
      }
      c.alive = false;
      sendRaw(c, 9, Buffer.alloc(0));
    }
  }, o.pingMs);
  pinger.unref?.();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, o.host, () => {
      const port = server.address().port;
      resolve({
        port,
        host: o.host,
        server,
        stats: () => ({ rooms: rooms.size, connections: conns.size, ...counters }),
        close: () =>
          new Promise((r) => {
            clearInterval(pinger);
            for (const c of [...conns]) close(c, 1001, "relay shutting down");
            server.close(() => r());
            setTimeout(r, 1500).unref?.();
          }),
      });
    });
  });
}

// ------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const o = {};
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} needs a number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === "--host") o.host = v();
    else if (a === "--port") o.port = num(v(), "port");
    else if (a === "--tls-cert") o.tlsCert = v();
    else if (a === "--tls-key") o.tlsKey = v();
    else if (a === "--origin") (o.origins ||= []).push(v());
    else if (a === "--any-origin") o.origins = "*";
    else if (a === "--max-rooms") o.maxRooms = num(v(), "max-rooms");
    else if (a === "--max-peers") o.maxPeers = num(v(), "max-peers");
    else if (a === "--rate") o.rate = num(v(), "rate");
    else if (a === "--quiet") o.log = false;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown option ${a} (see --help)`);
  }
  return o;
}

const HELP = `OpenFini collaboration relay (forwards end-to-end encrypted frames; sees no content)

  --host <addr>       interface to bind (default 127.0.0.1; 0.0.0.0 = every interface, e.g. the LAN)
  --port <n>          port (default 8787; 0 = any free port)
  --tls-cert <file>   PEM certificate: serve wss:// directly (with --tls-key)
  --tls-key <file>    PEM private key
  --origin <origin>   allow browser pages from this origin (repeatable; the desktop app and localhost are always allowed)
  --any-origin        allow every origin (not recommended)
  --max-rooms <n>     default ${DEFAULTS.maxRooms}
  --max-peers <n>     members per room, default ${DEFAULTS.maxPeers}
  --rate <n>          messages per second per connection, default ${DEFAULTS.rate}
  --quiet             no log output
`;

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (opts.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) {
    console.error("--tls-cert and --tls-key must be given together.");
    process.exit(2);
  }
  startRelay(opts)
    .then(({ port, host }) => {
      const scheme = opts.tlsCert ? "wss" : "ws";
      console.log(`OpenFini relay listening on ${scheme}://${host}:${port}/`);
      if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
        console.warn("WARNING: the relay is reachable from other machines. Content stays end-to-end encrypted, but anyone who can reach this port can see IP addresses, room ids, message sizes and timing, and can use your bandwidth. Prefer --tls-cert/--tls-key or a TLS reverse proxy, and a firewall that only admits your network.");
      }
      const stop = () => process.exit(0);
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch((e) => {
      console.error(`The relay could not start: ${e.message}`);
      process.exit(1);
    });
}
