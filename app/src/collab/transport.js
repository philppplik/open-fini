// Transports: how encrypted frames travel between members. All of them carry opaque text frames (the envelopes of
// crypto.js); none of them sees plaintext. Pure apart from the platform objects they are given (WebSocket,
// BroadcastChannel), so the memory transport and the relay client run in Node tests.
//
// interface Transport {
//   kind: "relay" | "local" | "memory"
//   host: string                       display name of where frames go ("relay.example:8787", "this device")
//   connect({ room, token }) → Promise  joins the room (token = relay access token from crypto.deriveRoom)
//   send(frame: string) → boolean       false when not connected or the frame is too large
//   close()                             leaves; no more events afterwards
//   onFrame(fn(frame))  onStatus(fn({ state: "connecting"|"open"|"reconnecting"|"closed"|"error", peers?, error? }))
// }
//
// Relay wire protocol (scripts/relay.mjs, docs/collaboration.md ▸ Relay protocol), JSON text frames:
//   client → relay  { t:"join", room, token }   { t:"msg", d:<envelope> }
//   relay → client  { t:"joined", peers }       { t:"msg", d }   { t:"peers", n }   { t:"error", code, message }
import { LIMITS } from "./protocol.js";

/** Creates the transport for a relay address ("local" = same device, otherwise ws:// or wss://). */
export function createTransport(relay, { WebSocketImpl = globalThis.WebSocket, BroadcastChannelImpl = globalThis.BroadcastChannel, pageProtocol = globalThis.location?.protocol } = {}) {
  if (relay === "local") return createLocalTransport({ BroadcastChannelImpl });
  return createRelayTransport(relay, { WebSocketImpl, urls: relayCandidates(relay, pageProtocol) });
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The addresses to try for a relay, in order. `scripts/relay.mjs --lan` answers ws:// and wss:// on the same port, so
 * the other scheme is a safe fallback: an https page cannot open ws:// to another machine (mixed content), so it tries
 * wss:// first; the desktop app may not trust the relay's self-signed certificate, so a wss:// invite falls back to ws://.
 * The keys never depend on the address, only the transport does.
 */
export function relayCandidates(relay, pageProtocol = "") {
  let u;
  try {
    u = new URL(relay);
  } catch {
    return [relay];
  }
  const other = `${u.protocol === "ws:" ? "wss:" : "ws:"}//${u.host}${u.pathname}`;
  if (u.protocol === "ws:" && pageProtocol === "https:" && !LOOPBACK.has(u.hostname)) return [other, relay];
  if (u.protocol === "wss:" && pageProtocol !== "https:") return [relay, other];
  return [relay];
}

function emitterBits() {
  const frames = new Set();
  const statuses = new Set();
  return {
    onFrame: (fn) => (frames.add(fn), () => frames.delete(fn)),
    onStatus: (fn) => (statuses.add(fn), () => statuses.delete(fn)),
    frame: (f) => {
      for (const fn of [...frames]) fn(f);
    },
    status: (s) => {
      for (const fn of [...statuses]) fn(s);
    },
  };
}

// ------------------------------------------------------------------ same device (BroadcastChannel)

export function createLocalTransport({ BroadcastChannelImpl = globalThis.BroadcastChannel } = {}) {
  if (typeof BroadcastChannelImpl !== "function") throw new Error("This browser cannot link windows (BroadcastChannel is missing).");
  const ev = emitterBits();
  let ch = null;
  return {
    kind: "local",
    host: "this device",
    async connect({ room }) {
      ch = new BroadcastChannelImpl(`openfini-collab/${room}`);
      ch.onmessage = (e) => {
        if (typeof e.data === "string" && e.data.length <= LIMITS.frameBytes) ev.frame(e.data);
      };
      ev.status({ state: "open", peers: null });
    },
    send(frame) {
      if (!ch || frame.length > LIMITS.frameBytes) return false;
      ch.postMessage(frame);
      return true;
    },
    close() {
      try {
        ch?.close();
      } catch {
        /* closed */
      }
      ch = null;
      ev.status({ state: "closed" });
    },
    onFrame: ev.onFrame,
    onStatus: ev.onStatus,
  };
}

// ------------------------------------------------------------------ relay (WebSocket)

export function createRelayTransport(firstUrl, { WebSocketImpl = globalThis.WebSocket, maxRetries = 6, setTimer = (f, ms) => setTimeout(f, ms), urls = [firstUrl] } = {}) {
  if (typeof WebSocketImpl !== "function") throw new Error("WebSockets are not available here.");
  const ev = emitterBits();
  let url = urls[0];
  let urlIndex = 0;
  let ws = null;
  let closed = false;
  let joinArgs = null;
  let retries = 0;
  let peers = null;
  let host = "?";
  try {
    host = new URL(url).host;
  } catch {
    /* validated by crypto.normalizeRelay */
  }

  const open = () =>
    new Promise((resolve, reject) => {
      let joined = false;
      ev.status({ state: retries ? "reconnecting" : "connecting" });
      const sock = new WebSocketImpl(url);
      ws = sock;
      sock.onopen = () => sock.send(JSON.stringify({ t: "join", room: joinArgs.room, token: joinArgs.token }));
      sock.onmessage = (e) => {
        if (typeof e.data !== "string" || e.data.length > LIMITS.frameBytes + 64) return;
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === "joined") {
          joined = true;
          retries = 0;
          peers = Number.isInteger(m.peers) ? m.peers : null;
          ev.status({ state: "open", peers });
          resolve();
        } else if (m.t === "msg" && typeof m.d === "string") ev.frame(m.d);
        else if (m.t === "peers" && Number.isInteger(m.n)) {
          peers = m.n;
          ev.status({ state: "open", peers });
        } else if (m.t === "error") {
          const err = new Error(relayErrorText(m.code, m.message));
          err.code = m.code;
          ev.status({ state: "error", error: err });
          if (!joined) {
            closed = closed || ["forbidden", "room_full", "too_many_rooms", "origin"].includes(m.code);
            reject(err);
          }
        }
      };
      sock.onerror = () => {};
      sock.onclose = () => {
        if (ws === sock) ws = null;
        if (!joined) reject(new Error(`Could not reach the relay at ${host}.`));
        if (closed) return;
        if (joined && retries < maxRetries) {
          retries++;
          setTimer(() => !closed && open().catch(() => {}), Math.min(15000, 500 * 2 ** retries));
          ev.status({ state: "reconnecting" });
        } else if (joined) ev.status({ state: "closed", error: new Error("The connection to the relay was lost.") });
      };
    });

  return {
    kind: "relay",
    host,
    get peers() {
      return peers;
    },
    get url() {
      return url;
    },
    async connect({ room, token }) {
      joinArgs = { room, token };
      closed = false;
      // try the candidate addresses in order until one joins (see relayCandidates)
      for (;;) {
        try {
          await open();
          return;
        } catch (e) {
          if (closed || e.code || urlIndex >= urls.length - 1) throw e;
          url = urls[++urlIndex];
        }
      }
    },
    send(frame) {
      if (!ws || ws.readyState !== 1 || frame.length > LIMITS.frameBytes) return false;
      ws.send(JSON.stringify({ t: "msg", d: frame }));
      return true;
    },
    close() {
      closed = true;
      try {
        ws?.close(1000);
      } catch {
        /* closed */
      }
      ws = null;
      ev.status({ state: "closed" });
    },
    onFrame: ev.onFrame,
    onStatus: ev.onStatus,
  };
}

export function relayErrorText(code, message) {
  switch (code) {
    case "forbidden":
      return "The relay refused to join: this room is protected by a different access token.";
    case "room_full":
      return "The room is full on this relay.";
    case "too_many_rooms":
      return "The relay has reached its room limit.";
    case "rate":
      return "Too many messages: the relay is slowing this connection down.";
    case "too_large":
      return "A message was too large for the relay.";
    case "origin":
      return "The relay does not accept connections from this app (origin not allowed).";
    default:
      return String(message || "Relay error.").slice(0, 200);
  }
}

// ------------------------------------------------------------------ in-memory (tests)

/** A fake relay in memory: same semantics as scripts/relay.mjs (rooms, token pinning, fan-out to others). */
export function createMemoryHub() {
  const rooms = new Map(); // room → { token, peers:Set }
  const log = []; // every frame the "relay" saw (for tests: it must be ciphertext only)
  return {
    log,
    rooms,
    transport() {
      const ev = emitterBits();
      let room = null;
      const self = {
        kind: "memory",
        host: "memory",
        deliver: (f) => ev.frame(f),
        async connect({ room: r, token }) {
          let entry = rooms.get(r);
          if (!entry) rooms.set(r, (entry = { token, peers: new Set() }));
          if (entry.token !== token) {
            const err = new Error(relayErrorText("forbidden"));
            err.code = "forbidden";
            throw err;
          }
          room = r;
          entry.peers.add(self);
          ev.status({ state: "open", peers: entry.peers.size - 1 });
        },
        send(frame) {
          const entry = room && rooms.get(room);
          if (!entry || frame.length > LIMITS.frameBytes) return false;
          log.push(frame);
          for (const p of entry.peers) if (p !== self) queueMicrotask(() => p.deliver(frame));
          return true;
        },
        close() {
          const entry = room && rooms.get(room);
          entry?.peers.delete(self);
          if (entry && !entry.peers.size) rooms.delete(room);
          room = null;
          ev.status({ state: "closed" });
        },
        onFrame: ev.onFrame,
        onStatus: ev.onStatus,
      };
      return self;
    },
  };
}
