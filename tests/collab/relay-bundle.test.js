// The one-file relay (scripts/relay-bundle.mjs): runs from an empty folder with Node only (no package.json, no npm, no
// sibling files), brings the QR code and the self-signed certificate for --lan with it, and relays between members.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleRelay } from "../../scripts/relay-bundle.mjs";
import { TestWebSocket } from "./ws-client.js";

const dir = mkdtempSync(join(tmpdir(), "of-relay-bundle-"));
const file = join(dir, "openfini-relay.mjs");
test.after(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Windows may still hold the folder of the child process for a moment; the OS cleans temp folders
  }
});

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await tick(20);
  }
  return false;
}
function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new TestWebSocket(`ws://127.0.0.1:${port}/`);
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(JSON.parse(e.data));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("connect failed"));
  });
}

test("relay bundle: one self-contained file", async () => {
  await bundleRelay({ out: file, version: "9.9.9-test" });
  assert.deepEqual(readdirSync(dir), ["openfini-relay.mjs"]);
  const src = readFileSync(file, "utf8");
  assert.ok(src.startsWith("#!/usr/bin/env node"), "starts with a shebang");
  assert.doesNotMatch(src, /from\s*["']\.\.?\//, "no relative static imports left");
  const help = spawnSync(process.execPath, [file, "--help"], { cwd: dir, encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--lan/);
});

test("relay bundle: --lan from an empty folder has https built in and relays", async (t) => {
  const p = spawn(process.execPath, [file, "--lan", "--port", "0", "--tls-dir", join(dir, "tls")], { cwd: dir });
  t.after(() => new Promise((r) => (p.exitCode !== null ? r() : (p.once("exit", r), p.kill()))));
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  const re = /listening on ws:\/\/[^\s]+:(\d+)\//;
  assert.ok(await until(() => re.test(out), 15000), out);
  const port = Number(re.exec(out)[1]);
  assert.match(out, /OpenFini relay 9\.9\.9-test/);
  assert.match(out, /also wss:\/\/ on the same port/, "the certificate writer is bundled");
  assert.doesNotMatch(out, /relay-tls\.mjs is not next to/);
  const a = await connect(port);
  const b = await connect(port);
  t.after(() => (a.close(), b.close()));
  const hello = { t: "join", room: "R".repeat(22), token: "T".repeat(22) };
  a.send(JSON.stringify(hello));
  assert.ok(await until(() => a.inbox.some((m) => m.t === "joined")));
  b.send(JSON.stringify(hello));
  assert.ok(await until(() => b.inbox.some((m) => m.t === "joined")));
  a.send(JSON.stringify({ t: "msg", d: "opaque-ciphertext" }));
  assert.ok(await until(() => b.inbox.some((m) => m.t === "msg" && m.d === "opaque-ciphertext")));
});
