// Accessibility gate for the website (docs/concepts/website.md, task W15): runs axe-core in headless Chromium on every
// built page and fails on any WCAG 2.2 A/AA violation. The home, studio, features, download and project pages are
// checked in the light and in the dark theme; docs pages in the light theme.
//
//   node site/build.mjs --offline && node scripts/site-check.mjs --axe <path to axe.min.js>
//
// axe-core is not a project dependency: CI installs it into a temporary folder (see .github/workflows/pages.yml).
// The browser is found like in site-shots.mjs (CHROME_PATH overrides).
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./serve.mjs";
import { evaluate, launchBrowser, newPage, sleep } from "./lib/cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const o = { dist: join(root, "site", "dist"), axe: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--axe") o.axe = resolve(argv[++i]);
    else if (a === "--dist") o.dist = resolve(argv[++i]);
    else if (a === "--only") o.only = argv[++i]; // a substring of the page path
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!o.axe) throw new Error("--axe <path to axe.min.js> is required (npm install axe-core into a temporary folder)");
  return o;
}

async function htmlFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const axe = await readFile(o.axe, "utf8");
  const server = createServer({ root: o.dist, notFound: "404.html" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const files = (await htmlFiles(o.dist)).map((f) => relative(o.dist, f).split(sep).join("/").replace(/index\.html$/, ""));
  const targets = files
    .filter((p) => !o.only || p.includes(o.only))
    .flatMap((p) => (/^(de\/)?docs\//.test(p) ? [[p, "light"]] : [[p, "light"], [p, "dark"]]));
  const browser = await launchBrowser();
  let failures = 0;
  try {
    const page = await newPage(browser.cdp);
    const { s } = page;
    await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const [path, theme] of targets) {
      await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
      await s("Page.navigate", { url: `${base}/${path}` });
      await sleep(250);
      for (let i = 0; i < 40 && (await evaluate(s, "document.readyState")) !== "complete"; i++) await sleep(100);
      const result = await evaluate(s, `(async () => {
        ${axe}
        const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ") + (n.failureSummary ? " | " + n.failureSummary.split("\\n").slice(1, 2).join("") : "")) }));
      })()`);
      if (result.length) {
        failures += result.length;
        console.error(`✗ /${path} (${theme})`);
        for (const v of result) console.error(`    ${v.id} [${v.impact}] ${v.help}\n      ${v.nodes.join("\n      ")}`);
      }
    }
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`site-check: ${targets.length} page views, ${failures} violation${failures === 1 ? "" : "s"}`);
  if (failures) process.exit(1);
}

await main();
