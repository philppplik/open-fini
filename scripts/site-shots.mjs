// Screenshot generator for the website (docs/concepts/website.md, task W6). Zero dependencies: it serves app/ with
// the dev server, starts a headless Chromium-based browser (Chrome, Edge or Chromium) with a remote debugging port
// and drives it over the Chrome DevTools Protocol with Node's built-in WebSocket (Node 22+).
//
//   npm run site:shots                       every studio, dark and light, 1x and 2x
//   node scripts/site-shots.mjs --only pixel,code --themes dark --scales 1
//   CHROME_PATH=/usr/bin/chromium node scripts/site-shots.mjs
//
// Output: site/assets/shots/<studio>-<theme>[@2x].webp (1440 × 900 CSS pixels) plus the hero artwork variants
// site/assets/img/artwork-<width>.webp. Re-run it for every release so the site never shows an old interface.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./serve.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "site", "assets", "shots");
const IMG = join(root, "site", "assets", "img");
const VIEW = { width: 1440, height: 900 };

/**
 * One scene per studio: the query string opens the studio, `setup` (run in the page) prepares what is shown.
 * Scenes use the app's own start screens and templates, so the screenshots show only what the app really does.
 */
export const SCENES = [
  {
    // built with the same tools the Vibe assistant uses (vibe/tools), so every object is a real, editable layer
    id: "vector",
    studio: "vector",
    setup: `
      await tool("new_document", { name: "Poster", width: 1200, height: 800, studio: "vector" });
      await tool("add_shape", { type: "rect", x: 0, y: 0, w: 1200, h: 800, radius: 0, name: "Sky", fill: { type: "linear", angle: 160, stops: [{ offset: 0, color: "#3a2350" }, { offset: 0.55, color: "#b8306a" }, { offset: 1, color: "#f07d45" }] } });
      await tool("add_shape", { type: "ellipse", x: 700, y: 120, w: 360, h: 360, name: "Sun", fill: { type: "radial", stops: [{ offset: 0, color: "#ffe2b0" }, { offset: 1, color: "#f2b9b0" }] } });
      await tool("add_shape", { type: "polygon", sides: 3, x: 0, y: 420, w: 680, h: 380, name: "Hill", fill: "#2a1838" });
      await tool("add_shape", { type: "polygon", sides: 3, x: 380, y: 470, w: 820, h: 330, name: "Ridge", fill: "#1d1e22" });
      await tool("add_shape", { type: "star", points: 5, x: 140, y: 110, w: 70, h: 70, name: "Star", fill: "#f2b9b0" });
      await tool("add_text", { text: "Open studio", x: 96, y: 250, fontSize: 104, color: "#ffffff", fontWeight: 800 });
      await sleep(300); openfini.run("edit.deselect"); openfini.run("view.fit");`,
  },
  { id: "pixel", studio: "pixel", setup: `await dropFile("/assets/launch/artwork.webp", "artwork.webp", "image/webp");` },
  {
    id: "layout",
    studio: "layout",
    setup: `
      await tool("new_document", { name: "Report", width: 1240, height: 880, studio: "layout" });
      await tool("add_text", { text: "Quarterly report", x: 80, y: 56, fontSize: 44, color: "#1c1d22", fontWeight: 700 });
      const table = await tool("add_table", { data: [["Region", "Q1", "Q2", "Q3"], ["North", 120, 150, 170], ["South", 90, 110, 140], ["West", 75, 95, 130], ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", "=SUM(D2:D4)"]], headerCols: 1, style: "striped", x: 80, y: 160, w: 500 });
      await tool("add_chart", { type: "column", title: "Sales by region", tableId: table.id, x: 640, y: 160, w: 520, h: 340 });
      await sleep(300); openfini.run("edit.deselect"); openfini.run("view.fit");`,
  },
  {
    id: "code",
    studio: "code",
    setup: `openfini.run("file.new"); await customElements.whenDefined("sl-dialog"); await sleep(600); await clickText("Code");
      await sleep(600); await clickText("Landing page"); await sleep(300); await clickText("Create"); await sleep(2500);`,
  },
  { id: "vibe", studio: "vibe" },
  { id: "office", studio: "office", setup: `await clickText("Report");` },
  { id: "scene", studio: "scene", setup: `await clickText("Animated title"); await sleep(800); for (let i = 0; i < 60; i++) openfini.run("scene.stepForward");` },
];

/** Helpers available to every `setup` snippet. */
const PAGE_HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = async (text) => {
    for (let i = 0; i < 60; i++) {
      // the deepest visible element whose whole text is the label (querySelectorAll lists parents before children)
      const hit = [...document.querySelectorAll("body *")].filter((el) => el.getClientRects().length && el.textContent.trim() === text).pop();
      if (hit) {
        const target = hit.closest("button, [role=button], a, sl-button, [tabindex]") || hit;
        await target.updateComplete; // Shoelace buttons render asynchronously
        return target.click();
      }
      await sleep(150);
    }
    throw new Error("no element with the text " + text);
  };
  let toolList = null;
  const tool = async (name, input) => {
    toolList ??= (await import("/src/vibe/tools/index.js")).createOpenFiniTools(openfini, {});
    const found = toolList.find((x) => x.name === name);
    if (!found) throw new Error("no tool " + name);
    return found.run(input);
  };
  const dropFile = async (url, name, type) => {
    const blob = await (await fetch(url)).blob();
    const { openDroppedFiles } = await import("/src/ui/open-drop.js");
    await openDroppedFiles(openfini, [{ path: name, file: new File([blob], name, { type }) }]);
  };
`;

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

function parseArgs(argv) {
  const opts = { only: null, themes: ["dark", "light"], scales: [1, 2], artwork: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--only") opts.only = new Set(next().split(","));
    else if (a === "--themes") opts.themes = next().split(",");
    else if (a === "--scales") opts.scales = next().split(",").map(Number);
    else if (a === "--no-artwork") opts.artwork = false;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over one browser WebSocket with flattened sessions. */
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
  close() {
    this.ws.close();
  }
}

async function launchBrowser() {
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

async function newPage(cdp) {
  // an isolated browser context per page: fresh storage, so no autosaved session is restored between shots
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  return { s, close: () => cdp.send("Target.disposeBrowserContext", { browserContextId }) };
}

async function evaluate(s, expression) {
  const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(s, expression, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(s, `!!(${expression})`).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${expression}`);
}

async function shoot(page, base, scene, theme, scale) {
  const { s } = page;
  await s("Emulation.setDeviceMetricsOverride", { ...VIEW, deviceScaleFactor: scale, mobile: false });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await s("Page.navigate", { url: `${base}/?studio=${scene.studio}&notour` });
  await waitFor(s, "window.openfini && !document.querySelector('.of-splash')");
  await evaluate(s, `openfini.setPref("theme", ${JSON.stringify(theme)}); openfini.setPref("language", "en")`);
  if (scene.setup) await evaluate(s, `(async () => { ${PAGE_HELPERS} ${scene.setup} })()`);
  await sleep(1800); // lazy studio chunks, fonts and the first render settle
  const { data } = await s("Page.captureScreenshot", { format: "webp", quality: 82, captureBeyondViewport: false });
  const file = join(OUT, `${scene.id}-${theme}${scale === 2 ? "@2x" : ""}.webp`);
  await writeFile(file, Buffer.from(data, "base64"));
  return file;
}

/** Resizes the launch artwork in the browser (canvas → WebP); no image library needed. */
async function artworkVariants(page, base, widths = [800, 1600]) {
  const { s } = page;
  await s("Page.navigate", { url: `${base}/assets/launch/artwork.webp` });
  await sleep(500);
  for (const w of widths) {
    const dataUrl = await evaluate(s, `(async () => {
      const img = document.querySelector("img"); await img.decode();
      const c = document.createElement("canvas"); c.width = ${w}; c.height = Math.round(${w} * img.naturalHeight / img.naturalWidth);
      const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/webp", 0.72);
    })()`);
    await writeFile(join(IMG, `artwork-${w}.webp`), Buffer.from(dataUrl.split(",")[1], "base64"));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  await mkdir(IMG, { recursive: true });
  const server = createServer({ root: join(root, "app") });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  try {
    if (opts.artwork) {
      const page = await newPage(browser.cdp);
      await artworkVariants(page, base);
      await page.close();
    }
    for (const scene of SCENES) {
      if (opts.only && !opts.only.has(scene.id)) continue;
      for (const theme of opts.themes) {
        for (const scale of opts.scales) {
          // a fresh page (and so a fresh session state) per shot keeps documents from leaking between scenes
          const page = await newPage(browser.cdp);
          try {
            const file = await shoot(page, base, scene, theme, scale);
            console.log(`site-shots: ${file.slice(root.length + 1)}`);
          } catch (err) {
            console.error(`site-shots: ${scene.id} ${theme} ${scale}x failed: ${err.message}`);
            process.exitCode = 1;
          } finally {
            await page.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
