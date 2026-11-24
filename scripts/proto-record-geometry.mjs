// Records the geometry fixtures of the Proto layout solver from a real browser (docs/concepts/proto-studio.md §4.4,
// task T2). Run it by hand after changing css.js or a fixture model; the results are committed and
// tests/proto/layout.test.js compares the pure solver (engine/proto/layout.js) with them.
//
//   node scripts/proto-record-geometry.mjs                    every fixture in tests/proto/fixtures/geometry/
//   node scripts/proto-record-geometry.mjs grid-tracks flex-wrap
//   CHROME_PATH=/usr/bin/chromium node scripts/proto-record-geometry.mjs
//
// For each fixture it resolves the model (resolve.js), compiles the CSS (css.js, literal values, the root at 0, 0),
// builds plain DOM from the declarations (text runs as spans, vector and line layers as inline SVG), loads it into a
// headless Chromium-based browser (Chrome, Edge or Chromium) over the DevTools protocol with Node's built-in WebSocket
// (Node 22+), and stores every layer's border box relative to the root as [x, y, w, h] in `boxes`. Zero dependencies.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createResolver } from "../app/src/engine/proto/resolve.js";
import { treeCss, declsToText } from "../app/src/engine/proto/css.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "tests", "proto", "fixtures", "geometry");

const BROWSERS = [
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain DOM for a resolved tree, from css.js declarations only. */
export function toHtml(r, css) {
  const c = css.get(r.key);
  const attrs = Object.entries(c.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  let inner = "";
  if (c.text) inner = c.text.runs.map((run) => (run.decls.length ? `<span style="${esc(declsToText(run.decls))}">${esc(run.text)}</span>` : esc(run.text))).join("");
  else if (c.svg) {
    const s = c.svg;
    const common = `stroke="${esc(s.stroke)}" stroke-width="${esc(s.strokeWidth)}"${s.dash ? ` stroke-dasharray="${esc(s.dash)}"` : ""}`;
    const shape = s.kind === "line" ? `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${common}/>` : `<path d="${esc(s.d)}" fill="${esc(s.fill)}" fill-rule="${s.rule}" ${common}/>`;
    inner = `<svg width="100%" height="100%" style="display:block;overflow:visible">${shape}</svg>`;
  }
  inner += r.children.map((k) => toHtml(k, css)).join("");
  return `<div data-k="${esc(r.key)}"${attrs} style="${esc(declsToText(c.decls))}">${inner}</div>`;
}

class Cdp {
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
}

async function launch() {
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error("No Chrome, Edge or Chromium found. Set CHROME_PATH to the browser executable.");
  const profile = await mkdtemp(join(tmpdir(), "ofini-geometry-"));
  const child = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = (await readFile(portFile, "utf8")).split(/\r?\n/);
  const cdp = new Cdp(`ws://127.0.0.1:${port}${path}`);
  await cdp.open();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  const { product } = await cdp.send("Browser.getVersion");
  return {
    product,
    s,
    async close() {
      child.kill();
      await sleep(300);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function evaluate(s, expression) {
  const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function record(browser, fixture) {
  const resolver = createResolver(fixture.model);
  const tree = resolver.tree(fixture.root);
  const css = treeCss(tree, { resolver, root: "origin" });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body><div style="position:relative;margin:0">${toHtml(tree, css)}</div></body></html>`;
  const { s } = browser;
  const { frameTree } = await s("Page.getFrameTree");
  await s("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  await sleep(50);
  return evaluate(
    s,
    `(() => {
      const els = [...document.querySelectorAll("[data-k]")];
      const r0 = els[0].getBoundingClientRect();
      const out = {};
      const round = (v) => Math.round(v * 100) / 100;
      for (const el of els) {
        if (getComputedStyle(el).display === "none") continue;
        const r = el.getBoundingClientRect();
        out[el.dataset.k] = [round(r.left - r0.left), round(r.top - r0.top), round(r.width), round(r.height)];
      }
      return out;
    })()`,
  );
}

async function main() {
  const only = process.argv.slice(2);
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json") && (!only.length || only.includes(f.replace(/\.json$/, ""))));
  if (!files.length) throw new Error("No fixtures to record.");
  const browser = await launch();
  try {
    for (const f of files.sort()) {
      const file = join(DIR, f);
      const fixture = JSON.parse(await readFile(file, "utf8"));
      fixture.boxes = await record(browser, fixture);
      fixture.recorded = { browser: browser.product, date: new Date().toISOString().slice(0, 10) };
      await writeFile(file, JSON.stringify(fixture, null, 1) + "\n");
      console.log(`${f}: ${Object.keys(fixture.boxes).length} boxes`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
