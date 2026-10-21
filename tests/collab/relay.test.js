// Integration: the real relay (scripts/relay.mjs) on a random port, real WebSocket framing (tests/collab/ws-client.js),
// and full collaboration sessions talking through it.
import test from "node:test";
import assert from "node:assert/strict";
import { startRelay, originAllowed } from "../../scripts/relay.mjs";
import { TestWebSocket, frameText } from "./ws-client.js";
import { CollabSession } from "../../app/src/collab/session.js";
import { createRelayTransport } from "../../app/src/collab/transport.js";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const ROOM = "R".repeat(22);
const TOKEN = "T".repeat(22);

function connect(port, opts) {
  return new Promise((resolve, reject) => {
    const ws = new TestWebSocket(`ws://127.0.0.1:${port}/`, opts);
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(JSON.parse(e.data));
    ws.onopen = () => resolve(ws);
    ws.onclose = (e) => {
      ws.closedWith = e;
      if (ws.readyState !== 1) resolve(ws);
    };
    ws.onerror = () => {};
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await tick(10);
  }
  return false;
}

test("relay: rooms, token pinning, fan-out to others only, peer counts", async (t) => {
  const relay = await startRelay({ port: 0, log: false });
  t.after(() => relay.close());
  const a = await connect(relay.port);
  const b = await connect(relay.port);
  a.send(JSON.stringify({ t: "join", room: ROOM, token: TOKEN }));
  assert.ok(await until(() => a.inbox.some((m) => m.t === "joined")));
  b.send(JSON.stringify({ t: "join", room: ROOM, token: TOKEN }));
  assert.ok(await until(() => b.inbox.some((m) => m.t === "joined" && m.peers === 1)));
  assert.ok(await until(() => a.inbox.some((m) => m.t === "peers" && m.n === 1)));
  a.send(JSON.stringify({ t: "msg", d: "opaque-ciphertext" }));
  assert.ok(await until(() => b.inbox.some((m) => m.t === "msg" && m.d === "opaque-ciphertext")));
  await tick(30);
  assert.ok(!a.inbox.some((m) => m.t === "msg"), "no echo to the sender");
  // wrong token
  const c = await connect(relay.port);
  c.send(JSON.stringify({ t: "join", room: ROOM, token: "X".repeat(22) }));
  assert.ok(await until(() => c.inbox.some((m) => m.t === "error" && m.code === "forbidden")));
  assert.ok(await until(() => c.readyState === 3));
  assert.equal(relay.stats().rooms, 1);
  a.close();
  b.close();
  assert.ok(await until(() => relay.stats().rooms === 0), "empty rooms are dropped (no persistence)");
});

test("relay: limits (frame size, unmasked frames, binary, messages before join, origin, room size)", async (t) => {
  const relay = await startRelay({ port: 0, log: false, maxFrame: 4096, maxPeers: 2 });
  t.after(() => relay.close());
  // too large
  const big = await connect(relay.port);
  big.send(JSON.stringify({ t: "join", room: ROOM, token: TOKEN }));
  await until(() => big.inbox.length);
  big.send(JSON.stringify({ t: "msg", d: "x".repeat(5000) }));
  assert.ok(await until(() => big.readyState === 3));
  assert.equal(big.closeCode, 1009);
  // unmasked client frame
  const raw = await connect(relay.port);
  raw.sendRaw(frameText('{"t":"join"}', { mask: false }));
  assert.ok(await until(() => raw.readyState === 3));
  assert.equal(raw.closeCode, 1002);
  // binary frame
  const bin = await connect(relay.port);
  bin.sendRaw(frameText("abc", { opcode: 2 }));
  assert.ok(await until(() => bin.readyState === 3));
  assert.equal(bin.closeCode, 1003);
  // message before join
  const early = await connect(relay.port);
  early.send(JSON.stringify({ t: "msg", d: "x" }));
  assert.ok(await until(() => early.readyState === 3));
  assert.equal(early.closeCode, 1008);
  // foreign browser origin
  const evil = await connect(relay.port, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal(originAllowed("http://localhost:4300", ["http://localhost"]), true);
  assert.equal(originAllowed("http://localhost.evil.example", ["http://localhost"]), false);
  assert.equal(originAllowed("https://app.example.org", ["https://app.example.org"]), true);
  // room full
  const p = [];
  for (let i = 0; i < 3; i++) {
    const s = await connect(relay.port);
    s.send(JSON.stringify({ t: "join", room: "Q".repeat(22), token: TOKEN }));
    p.push(s);
  }
  assert.ok(await until(() => p[2].inbox.some((m) => m.code === "room_full")));
  for (const s of p) s.close();
});

test("relay: rate limit answers with an error and drops excess frames", async (t) => {
  const relay = await startRelay({ port: 0, log: false, rate: 5, burst: 5 });
  t.after(() => relay.close());
  const a = await connect(relay.port);
  const b = await connect(relay.port);
  for (const s of [a, b]) s.send(JSON.stringify({ t: "join", room: ROOM, token: TOKEN }));
  await until(() => a.inbox.length && b.inbox.length);
  for (let i = 0; i < 20; i++) a.send(JSON.stringify({ t: "msg", d: `m${i}` }));
  assert.ok(await until(() => a.inbox.some((m) => m.code === "rate")));
  await tick(50);
  const delivered = b.inbox.filter((m) => m.t === "msg").length;
  assert.ok(delivered < 20 && delivered >= 3, `delivered ${delivered}`);
  a.close();
  b.close();
});

test("end to end through the real relay: chat and a file arrive, the relay never sees plaintext", async (t) => {
  const relay = await startRelay({ port: 0, log: false });
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${relay.port}/`;
  const seen = [];
  // wrap the test socket to record every frame the relay forwards (what a curious relay operator could log)
  class Spy extends TestWebSocket {
    constructor(u) {
      super(u);
      const orig = this.send.bind(this);
      this.send = (text) => {
        seen.push(text);
        orig(text);
      };
    }
  }
  const tf = (relayUrl) => createRelayTransport(relayUrl, { WebSocketImpl: Spy });
  const host = await CollabSession.create({ relay: url, profile: { nick: "Hanabelle", color: "#e5484d" }, transportFactory: tf });
  await host.start();
  const mia = await CollabSession.join({ invite: host.inviteCode, profile: { nick: "Miaroselle", color: "#0090ff" }, transportFactory: tf });
  await mia.start();
  t.after(() => (host.leave(), mia.leave()));
  assert.ok(await until(() => host.members.length === 1 && mia.members.length === 1, 3000), "members see each other");
  assert.deepEqual(host.fingerprint, mia.fingerprint);
  const texts = [];
  mia.on("chat", (c) => c.message && texts.push(c.message.text));
  const files = [];
  mia.on("file", (f) => files.push(f));
  await host.chat("The launch is on Friday, @Miaroselle");
  const bytes = new Uint8Array(70000).map((_, i) => (i * 13) % 256);
  await host.sendFile(bytes, { name: "brief.pdf" });
  assert.ok(await until(() => texts.length === 1 && files.length === 1, 4000));
  assert.equal(texts[0], "The launch is on Friday, @Miaroselle");
  assert.deepEqual(files[0].bytes, bytes);
  const all = seen.join("\n");
  for (const secret of ["launch is on Friday", "Hanabelle", "Miaroselle", "brief.pdf", parseSecret(host.inviteCode)]) assert.ok(!all.includes(secret), `the relay saw “${secret.slice(0, 12)}”`);
  // a member that tampers with frames on the wire: the other side rejects them
  const before = mia.rejected;
  const ws = [...relay.server.listeners("upgrade")].length; // relay still healthy
  assert.ok(ws >= 1);
  host.transport.send(JSON.stringify({ v: 1, e: 0, s: host.id, n: 1, k: "x", iv: "AAAAAAAAAAAAAAAA", ct: "zz", sig: "zz" }));
  assert.ok(await until(() => mia.rejected > before, 2000));
});

function parseSecret(code) {
  return code.split("#ofc1.")[1].split(".")[1];
}
