// A minimal Chrome DevTools Protocol client for the website scripts (site-shots, site-check): it starts a headless
// Chromium-based browser (Chrome, Edge or Chromium; CHROME_PATH overrides) and talks to it over Node's built-in
// WebSocket (Node 22+). No dependencies.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over one browser WebSocket with flattened sessions. */
export class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    });
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", () => rej(new Error("cannot connect to the browser")), { once: true });
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  close() {
    this.ws.close();
  }
}

export async function launchBrowser() {
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error("No Chrome, Edge or Chromium found. Set CHROME_PATH to the browser executable.");
  const profile = await mkdtemp(join(tmpdir(), "ofini-shots-"));
  const child = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = (await readFile(portFile, "utf8")).split(/\r?\n/);
  const cdp = new Cdp(`ws://127.0.0.1:${port}${path}`);
  await cdp.open();
  return {
    cdp,
    async close() {
      cdp.close();
      child.kill();
      await sleep(300);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function newPage(cdp) {
  // an isolated browser context per page: fresh storage, so no autosaved session is restored between shots
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  return { s, close: () => cdp.send("Target.disposeBrowserContext", { browserContextId }) };
}

export async function evaluate(s, expression) {
  const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

export async function waitFor(s, expression, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(s, `!!(${expression})`).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${expression}`);
}
