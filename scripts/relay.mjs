#!/usr/bin/env node
// OpenFini collaboration relay: a minimal, dependency-free WebSocket server (RFC 6455) that forwards encrypted frames
// between the members of a room. It never sees plaintext: clients encrypt and sign everything (app/src/collab/crypto.js).
//
//   node relay.mjs --lan                            standalone: this one file in any folder, no npm, no dependencies
//                                                   (`npm run relay` only works inside the OpenFini project folder)
//   npm run relay                                   127.0.0.1:8787 (this device only)
//   npm run relay -- --lan                          the whole local network: binds 0.0.0.0, serves the app itself,
//                                                   answers http/ws AND https/wss (self-signed) on one port, prints the
//                                                   LAN addresses and a QR code to open the app on a phone or laptop
//   node scripts/relay.mjs --host 0.0.0.0           the local network without serving the app (prints a warning)
//   node scripts/relay.mjs --tls-cert c.pem --tls-key k.pem --port 8443    wss:// directly
//   node scripts/relay.mjs --origin https://app.example.org --max-rooms 50 --max-peers 8
//
// What it does: rooms by id (created on first join, deleted when empty: no persistence), the first joiner pins the
// room's access token (derived from the room secret; others must present the same token), fan-out of text frames to
// the other peers, frame size limit, per-connection rate limits (messages and bytes), per-IP connection limit, ping/pong
// keep-alive, an Origin allow-list for browsers. Logs contain counts, short room-id prefixes and error codes, never
// payloads or tokens. Protocol: docs/collaboration.md ▸ Relay protocol. Module API (tests): startRelay(options).
//
// HTTP endpoints: GET /info (JSON: version, LAN addresses, whether it serves the app; CORS for allowed origins, Chrome
// Private Network Access preflights answered), and with --serve-app the static files of the built app (dist/, or app/
// in a source checkout) on the same origin, so another device opens http(s)://<lan-ip>:<port>/ and connects to the
// relay without mixed-content or origin problems. Pages served by this relay are allowed automatically (same origin,
// IP-literal or localhost hosts only, which rules out DNS rebinding).
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { createServer as createNet, isIP } from "node:net";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve, sep, extname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Standalone use: `node relay.mjs` works as a single downloaded file in any folder. The QR code (app/src/collab/qr.js)
// and the self-signed certificate for --lan (relay-tls.mjs, next to this file) are optional extras loaded when present.
const optional = async (rel) => {
  try {
    return await import(new URL(rel, import.meta.url).href);
  } catch {
    return null;
  }
};
const qrMod = await optional("../app/src/collab/qr.js");
const tlsMod = await optional("./relay-tls.mjs");

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version || "?";
  } catch {
    return "?";
  }
})();

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

/** IPv4 addresses of this machine's network interfaces (not loopback), e.g. ["192.168.1.20"]. */
export function lanAddresses(ifaces = networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces || {}))
    for (const a of list || []) if ((a.family === "IPv4" || a.family === 4) && !a.internal && !a.address.startsWith("169.254.")) out.push(a.address);
  return [...new Set(out)];
}

/**
 * A page served by this relay (--serve-app) may connect: its Origin equals the request's Host and that host is an IP
 * literal or localhost (a DNS name could be rebound to this machine by a hostile site, so names are not trusted).
 */
export function sameOriginAllowed(origin, hostHeader) {
  if (!origin || !hostHeader) return false;
  try {
    const u = new URL(origin);
    if (u.host !== String(hostHeader).toLowerCase()) return false;
    const h = u.hostname.replace(/^\[|\]$/g, "");
    return isIP(h) !== 0 || h === "localhost";
  } catch {
    return false;
  }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".map": "application/json" };

/** The directory with the app to serve: an explicit one, else dist/ (built) or app/ (source checkout). */
export function appDir(dir) {
  if (dir && dir !== true) return resolve(dir);
  for (const d of ["dist", "app"]) if (existsSync(join(REPO, d, "index.html"))) return join(REPO, d);
  return null;
}

/** Resolves a URL path inside `root`, or null for anything outside it (traversal, encoded tricks, NUL bytes). */
export function safeStaticPath(root, urlPath) {
  let p;
  try {
    p = decodeURIComponent(String(urlPath).split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (p.includes("\0") || p.includes("\\") || !p.startsWith("/")) return null;
  if (p.split("/").some((seg) => seg === "..")) return null;
  let file = resolve(root, `.${p}`);
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    const real = realpathSync(file);
    const realRoot = realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null; // symlinks out of the root
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
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

  const root = o.serveApp ? appDir(o.serveApp) : null;
  if (o.serveApp && !root) throw new Error("--serve-app: no app found (build it with npm run build, or pass the directory).");
  const tls = o.tls || (o.tlsCert && o.tlsKey ? { cert: readFileSync(o.tlsCert), key: readFileSync(o.tlsKey) } : null);
  const dual = !!(tls && o.dual); // one port answers both plain and TLS connections
  const allowedFor = (req) => originAllowed(req.headers.origin, origins) || (!!root && sameOriginAllowed(req.headers.origin, req.headers.host));
  let listenPort = 0;

  const info = (req) => {
    const lan = lanAddresses(o.interfaces);
    const hosts = o.host === "0.0.0.0" || o.host === "::" ? lan : [o.host];
    const urls = (scheme) => hosts.map((h) => `${scheme}://${h}:${listenPort}/`);
    return {
      app: "openfini-relay",
      version: VERSION,
      port: listenPort,
      host: o.host,
      lan: o.host === "0.0.0.0" || o.host === "::" ? lan : [],
      ws: !tls || dual ? urls("ws") : [],
      wss: tls ? urls("wss") : [],
      servesApp: !!root,
      appUrls: root ? [...(!tls || dual ? urls("http") : []), ...(tls ? urls("https") : [])] : [],
      originAllowed: allowedFor(req),
    };
  };

  const handler = (req, res) => {
    const origin = req.headers.origin;
    const cors = {};
    if (origin && allowedFor(req)) Object.assign(cors, { "access-control-allow-origin": origin, vary: "Origin" });
    const path = String(req.url || "/").split("?")[0];
    if (req.method === "OPTIONS") {
      // CORS and Chrome Private Network Access preflights (a public https page asking a LAN address)
      if (req.headers["access-control-request-private-network"] && cors["access-control-allow-origin"]) cors["access-control-allow-private-network"] = "true";
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET", "access-control-max-age": "600" });
      return res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end();
    }
    if (path === "/info") {
      res.writeHead(200, { ...cors, "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(JSON.stringify(info(req)));
    }
    if (root) {
      const file = safeStaticPath(root, path);
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("Not found\n");
      }
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      return res.end(req.method === "HEAD" ? undefined : body);
    }
    // a tiny health page: counts only
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`OpenFini relay: ${rooms.size} rooms, ${conns.size} connections. This server only forwards encrypted frames.\n`);
  };
  const plainServer = !tls || dual ? createHttp(handler) : null;
  const tlsServer = tls ? createHttps({ cert: tls.cert, key: tls.key }, handler) : null;
  const server = dual
    ? createNet((sock) => {
        // the first byte of a TLS connection is 0x16 (handshake record); anything else is plain HTTP
        sock.once("data", (buf) => {
          sock.pause();
          sock.unshift(buf);
          (buf[0] === 0x16 ? tlsServer : plainServer).emit("connection", sock);
          process.nextTick(() => sock.resume());
        });
        sock.on("error", () => sock.destroy());
      })
    : tlsServer || plainServer;

  for (const srv of [plainServer, tlsServer]) srv?.on("upgrade", (req, socket) => {
    const ip = req.socket.remoteAddress || "?";
    const deny = (code, text) => {
      counters.rejected++;
      socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (String(req.headers.upgrade || "").toLowerCase() !== "websocket") return deny(400, "Bad Request");
    if (req.headers["sec-websocket-version"] !== "13") return deny(426, "Upgrade Required");
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return deny(400, "Bad Request");
    if (!allowedFor(req)) {
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
      listenPort = port;
      resolve({
        port,
        host: o.host,
        server,
        root,
        tls: !!tls,
        dual,
        info: () => info({ headers: {} }),
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

export function parseArgs(argv) {
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
    else if (a === "--lan") o.lan = true;
    else if (a === "--serve-app") o.serveApp = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else if (a === "--no-serve-app") o.serveApp = false;
    else if (a === "--no-tls") o.noTls = true;
    else if (a === "--tls-dir") o.tlsDir = v();
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown option ${a} (see --help)`);
  }
  if (o.lan) {
    o.host ??= "0.0.0.0";
    if (o.serveApp === undefined) o.serveApp = true;
  }
  return o;
}

const HELP = `OpenFini collaboration relay (forwards end-to-end encrypted frames; sees no content)

  --lan               the whole local network: bind 0.0.0.0, serve the app (--serve-app), answer http/ws and
                      https/wss (self-signed certificate, kept in ~/.openfini-relay/) on one port, print the LAN
                      addresses and a QR code. Other devices open https://<this computer's IP>:<port>/ (accept the
                      certificate warning once) and join with the invite code or a join link.
  --serve-app [dir]   also serve the OpenFini app (default dist/, or app/ in a source checkout)
  --no-tls            with --lan: plain http/ws only (other browsers then cannot use encryption: WebCrypto needs a
                      secure page; only the desktop app and this computer's browser work)
  --tls-dir <dir>     where --lan keeps its certificate (default ~/.openfini-relay)
  --host <addr>       interface to bind (default 127.0.0.1; 0.0.0.0 = every interface, e.g. the LAN)
  --port <n>          port (default 8787; 0 = any free port)
  --tls-cert <file>   PEM certificate: serve wss:// directly (with --tls-key)
  --tls-key <file>    PEM private key
  --origin <origin>   allow browser pages from this origin (repeatable; the desktop app, localhost and pages this
                      relay serves itself are always allowed)
  --any-origin        allow every origin (not recommended)
  --max-rooms <n>     default ${DEFAULTS.maxRooms}
  --max-peers <n>     members per room, default ${DEFAULTS.maxPeers}
  --rate <n>          messages per second per connection, default ${DEFAULTS.rate}
  --quiet             no log output
`;

/** Starts the relay from command-line options and prints how to reach it (used by the CLI and the tests). */
export async function runCli(opts, out = console) {
  if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) throw new Error("--tls-cert and --tls-key must be given together.");
  const lanIps = lanAddresses();
  const start = { ...opts };
  let certInfo = null;
  if (opts.lan && opts.serveApp === true && !appDir()) {
    // standalone relay.mjs: there is no app next to it to serve; relay only
    start.serveApp = false;
    out.log("Note: no OpenFini app found next to relay.mjs, so it only relays (open OpenFini on the other devices yourself).");
  }
  if (opts.lan && !opts.noTls && !opts.tlsCert && !tlsMod) out.log("Note: relay-tls.mjs is not next to relay.mjs, so there is no https/wss. The desktop app works; browsers on other devices need https (put relay-tls.mjs next to relay.mjs).");
  if (opts.lan && !opts.noTls && !opts.tlsCert && tlsMod) {
    certInfo = tlsMod.loadOrCreateCert({ ips: ["127.0.0.1", ...lanIps], dir: opts.tlsDir });
    start.tls = { cert: certInfo.cert, key: certInfo.key };
    start.dual = true;
  }
  const relay = await startRelay(start);
  const { port, host } = relay;
  const pub = host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
  const scheme = relay.tls && !relay.dual ? "wss" : "ws";
  out.log(`OpenFini relay ${VERSION} listening on ${scheme}://${host}:${port}/${relay.dual ? " (also wss:// on the same port)" : ""}`);
  if (relay.root) out.log(`Serving the app from ${relay.root}`);
  if (pub) {
    const ips = host === "0.0.0.0" || host === "::" ? lanIps : [host];
    if (!ips.length) out.log("No network address found (is this computer connected to a network?).");
    for (const ip of ips) {
      out.log(`  Relay address for invite codes: ${relay.dual || !relay.tls ? `ws://${ip}:${port}/` : ""}${relay.tls ? `${relay.dual ? "  or  " : ""}wss://${ip}:${port}/` : ""}`);
      if (relay.root) out.log(`  Open the app on another device: ${relay.tls ? `https://${ip}:${port}/` : `http://${ip}:${port}/`}`);
    }
    const first = ips[0];
    if (relay.root && first && qrMod) {
      const { encodeQR, qrToText } = qrMod;
      const url = `${relay.tls ? "https" : "http"}://${first}:${port}/`;
      out.log(`\nScan to open ${url} (then join with the invite code, or use “Copy join link” in Collaboration ▸ People):\n`);
      out.log(qrToText(encodeQR(url, { ecl: "M" }), { quiet: 2, invert: true }));
    }
    if (certInfo) {
      out.log(`\nTLS: self-signed certificate ${certInfo.created ? "created" : "reused"} (${certInfo.certPath}).`);
      out.log(`  SHA-256 fingerprint: ${certInfo.fingerprint}`);
      out.log("  Browsers warn once per device: open the https:// address above, check the fingerprint (certificate details) and continue.");
      out.log("  The desktop app connects with ws:// on the same port; it does not need the certificate.");
    } else if (!relay.tls && relay.root) {
      out.log("\nNOTE: plain http only (--no-tls). Browsers on other devices cannot encrypt on http:// pages (WebCrypto needs a secure page): use the desktop app there, or drop --no-tls.");
    }
    out.warn("\nWARNING: the relay is reachable from other machines. Content stays end-to-end encrypted and every room needs its access token, but anyone who can reach this port can see IP addresses, room ids, message sizes and timing, and can use your bandwidth. Allow the port only for your network in the firewall (Windows asks on first start: choose Private networks only).");
  }
  return relay;
}

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
  runCli(opts)
    .then(() => {
      const stop = () => process.exit(0);
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch((e) => {
      console.error(`The relay could not start: ${e.message}`);
      if (e.code === "EADDRINUSE") console.error("Another program (maybe another relay) uses this port: stop it or pass --port <n>.");
      process.exit(1);
    });
}
