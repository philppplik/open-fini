// Integration: the relay for a whole network (scripts/relay.mjs --lan pieces) on a random port: GET /info with CORS and
// Private Network Access preflights, serving the app with path-traversal rejection, the automatic same-origin rule,
// one port answering both plain and TLS (self-signed certificate), and two members editing a document live through the
// real relay while the relay only ever sees ciphertext.
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay, sameOriginAllowed, safeStaticPath, lanAddresses, parseArgs } from "../../scripts/relay.mjs";
import { selfSignedCert } from "../../scripts/relay-tls.mjs";
import { TestWebSocket } from "./ws-client.js";
import { CollabSession } from "../../app/src/collab/session.js";
import { createRelayTransport, relayCandidates } from "../../app/src/collab/transport.js";
import { TreeCRDT, flattenDoc, diffOps, validateTreeOp } from "../../app/src/collab/tree-crdt.js";
import { applyView } from "../../app/src/collab/tree-apply.js";
import { Doc } from "../../app/src/core/doc.js";
import { createNode } from "../../app/src/core/nodes.js";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await tick(10);
  }
  return false;
}

function get(port, path, { method = "GET", headers = {}, tls = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = (tls ? httpsRequest : request)({ host: "127.0.0.1", port, path, method, headers, ...(tls ? { ca: tls, servername: undefined } : {}) }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function appFixture() {
  const dir = mkdtempSync(join(tmpdir(), "ofrelay-"));
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "app", "index.html"), "<!doctype html><title>OpenFini</title>");
  writeFileSync(join(dir, "app", "main.js"), "export const ok = 1;");
  writeFileSync(join(dir, "secret.txt"), "outside the app root");
  return join(dir, "app");
}

test("relay CLI options: --lan binds every interface and serves the app", () => {
  assert.deepEqual(parseArgs(["--lan"]), { lan: true, host: "0.0.0.0", serveApp: true });
  assert.deepEqual(parseArgs(["--lan", "--host", "192.168.1.5", "--serve-app", "dist"]), { lan: true, host: "192.168.1.5", serveApp: "dist" });
  assert.deepEqual(lanAddresses({ lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }], eth: [{ family: "IPv4", address: "192.168.1.20", internal: false }, { family: "IPv6", address: "fe80::1", internal: false }], x: [{ family: "IPv4", address: "169.254.3.3", internal: false }] }), ["192.168.1.20"]);
});

test("relay /info: version, addresses, CORS only for allowed origins, Private Network Access preflight", async (t) => {
  const relay = await startRelay({ port: 0, log: false, interfaces: { eth: [{ family: "IPv4", address: "192.168.1.20", internal: false }] } });
  t.after(() => relay.close());
  const r = await get(relay.port, "/info", { headers: { Origin: "http://localhost:4300" } });
  assert.equal(r.status, 200);
  const info = JSON.parse(r.body);
  assert.equal(info.app, "openfini-relay");
  assert.equal(info.port, relay.port);
  assert.equal(info.servesApp, false);
  assert.deepEqual(info.ws, [`ws://127.0.0.1:${relay.port}/`]);
  assert.equal(info.originAllowed, true);
  assert.equal(r.headers["access-control-allow-origin"], "http://localhost:4300");
  const evil = await get(relay.port, "/info", { headers: { Origin: "https://evil.example" } });
  assert.equal(evil.headers["access-control-allow-origin"], undefined);
  assert.equal(JSON.parse(evil.body).originAllowed, false);
  const pre = await get(relay.port, "/info", { method: "OPTIONS", headers: { Origin: "http://localhost:4300", "Access-Control-Request-Method": "GET", "Access-Control-Request-Private-Network": "true" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["access-control-allow-private-network"], "true");
  const preEvil = await get(relay.port, "/info", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Private-Network": "true" } });
  assert.equal(preEvil.headers["access-control-allow-private-network"], undefined);
  assert.equal((await get(relay.port, "/info", { method: "POST" })).status, 405);
});

test("relay --serve-app: static files, no path traversal, same-origin pages may connect", async (t) => {
  const root = appFixture();
  const relay = await startRelay({ port: 0, log: false, serveApp: root, host: "127.0.0.1" });
  t.after(() => relay.close());
  const index = await get(relay.port, "/");
  assert.equal(index.status, 200);
  assert.match(index.headers["content-type"], /text\/html/);
  assert.equal(index.headers["x-content-type-options"], "nosniff");
  const js = await get(relay.port, "/main.js");
  assert.match(js.headers["content-type"], /javascript/);
  for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%5csecret.txt", "/main.js%00.html", "/nope.txt"]) {
    const res = await get(relay.port, p);
    assert.equal(res.status, 404, p);
    assert.ok(!res.body.includes("outside the app root"), p);
  }
  assert.equal(safeStaticPath(root, "/../secret.txt"), null);
  assert.ok(safeStaticPath(root, "/index.html"));
  assert.equal(JSON.parse((await get(relay.port, "/info")).body).servesApp, true);

  // origins: the page this relay served (IP literal host) may open the WebSocket; others and DNS names may not
  const open = (opts) =>
    new Promise((resolve) => {
      const ws = new TestWebSocket(`ws://127.0.0.1:${relay.port}/`, opts);
      ws.onopen = () => (ws.close(), resolve(true));
      ws.onclose = () => resolve(false);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
  assert.equal(await open({ origin: `http://127.0.0.1:${relay.port}` }), true);
  assert.equal(await open({ origin: "https://evil.example" }), false);
  assert.equal(await open({ origin: `http://rebind.evil:${relay.port}`, hostHeader: `rebind.evil:${relay.port}` }), false);
  assert.equal(sameOriginAllowed("http://192.168.1.20:8787", "192.168.1.20:8787"), true);
  assert.equal(sameOriginAllowed("https://[::1]:8787", "[::1]:8787"), true);
  assert.equal(sameOriginAllowed("http://192.168.1.20:8787", "192.168.1.20:9999"), false);
  assert.equal(sameOriginAllowed("http://attacker.example:8787", "attacker.example:8787"), false);
});

test("relay: one port answers plain http and TLS (self-signed certificate)", async (t) => {
  const { cert, key } = selfSignedCert({ ips: ["127.0.0.1"] });
  const relay = await startRelay({ port: 0, log: false, tls: { cert, key }, dual: true });
  t.after(() => relay.close());
  const plain = JSON.parse((await get(relay.port, "/info")).body);
  const secure = JSON.parse((await get(relay.port, "/info", { tls: cert })).body);
  assert.equal(plain.port, relay.port);
  assert.deepEqual(secure.wss, [`wss://127.0.0.1:${relay.port}/`]);
  assert.deepEqual(secure.ws, [`ws://127.0.0.1:${relay.port}/`]);
  // the client tries the other scheme on the same port when the page needs it
  assert.deepEqual(relayCandidates("ws://192.168.1.20:8787/", "https:"), ["wss://192.168.1.20:8787/", "ws://192.168.1.20:8787/"]);
  assert.deepEqual(relayCandidates("wss://192.168.1.20:8787/", "tauri:"), ["wss://192.168.1.20:8787/", "ws://192.168.1.20:8787/"]);
  assert.deepEqual(relayCandidates("ws://localhost:8787/", "https:"), ["ws://localhost:8787/"]);
});

test("end to end: two members edit one document live through the real relay; the relay sees only ciphertext", async (t) => {
  const relay = await startRelay({ port: 0, log: false });
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${relay.port}/`;
  const seen = [];
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
  const tf = (u) => createRelayTransport(u, { WebSocketImpl: Spy });
  const host = await CollabSession.create({ relay: url, profile: { nick: "Hana", color: "#e5484d" }, transportFactory: tf });
  await host.start();
  const mia = await CollabSession.join({ invite: host.inviteCode, profile: { nick: "Mia", color: "#0090ff" }, transportFactory: tf });
  await mia.start();
  t.after(() => (host.leave(), mia.leave()));
  assert.ok(await until(() => host.members.length === 1 && mia.members.length === 1));

  // both start from the same snapshot
  const base = new Doc({ name: "Poster" });
  base.insert(createNode("rect", { name: "Headline box" }), base.pages[0].root);
  const json = base.toJSON();
  const side = (s) => {
    const doc = Doc.fromJSON(JSON.parse(JSON.stringify(json)));
    const crdt = TreeCRDT.fromFlat(flattenDoc(doc), s.id);
    return { s, doc, crdt, prev: new Set(flattenDoc(doc).keys()) };
  };
  const A = side(host);
  const B = side(mia);
  for (const X of [A, B]) {
    X.s.on("op", ({ sender, msg }) => {
      for (const op of msg.ops) X.crdt.apply(validateTreeOp(op), sender);
      applyView(X.doc, X.crdt);
      X.prev = new Set(flattenDoc(X.doc).keys());
    });
  }
  const push = async (X) => {
    const flat = flattenDoc(X.doc);
    const ops = X.crdt.applyLocal(diffOps(X.crdt, flat, X.prev));
    X.prev = new Set(flat.keys());
    await X.s.op({ doc: X.doc.id, kind: "tree", ops });
  };
  // concurrent edits on both sides
  A.doc.set(A.doc.pages[0].root.children[0], { name: "Secret campaign title" });
  B.doc.insert(createNode("ellipse", { name: "Moonshot logo" }), B.doc.pages[0].root);
  await Promise.all([push(A), push(B)]);
  const names = (d) => d.pages[0].root.children.map((n) => n.name).join(",");
  assert.ok(await until(() => names(A.doc) === names(B.doc) && names(A.doc).includes("Moonshot") && names(A.doc).includes("Secret")), `${names(A.doc)} | ${names(B.doc)}`);
  const all = seen.join("\n");
  for (const secret of ["Secret campaign title", "Moonshot logo", "Headline box"]) assert.ok(!all.includes(secret), `the relay saw “${secret}”`);
  // a viewer's ops are refused by the receivers (role check before the op is used)
  await host.setRole(mia.id, "viewer");
  assert.ok(await until(() => mia.myRole === "viewer"));
  await assert.rejects(() => mia.op({ doc: B.doc.id, kind: "tree", ops: [] }));
});
