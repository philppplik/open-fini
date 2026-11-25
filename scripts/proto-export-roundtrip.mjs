// Round trip of the Proto HTML export (docs/concepts/proto-studio.md §10.1, task T7): exports every geometry fixture
// of tests/proto/fixtures/geometry/ with codegen (HTML + CSS, data-proto-id on every element), renders the page in a
// headless Chromium-based browser (the launcher of scripts/proto-record-geometry.mjs) and compares each element's
// box with the boxes recorded from the canvas CSS. Tolerance: 1 px for fixtures without text, 2 px with text.
// Layers the export leaves out on purpose (wrappers that add nothing) are reported, not failed.
//
//   node scripts/proto-export-roundtrip.mjs                 every fixture
//   node scripts/proto-export-roundtrip.mjs grid-tracks     some fixtures
//   CHROME_PATH=/usr/bin/chromium node scripts/proto-export-roundtrip.mjs
// Exit code 1 when a box differs; tests/proto/codegen/roundtrip.test.js runs it when PROTO_ROUNDTRIP=1.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, evaluate } from "./proto-record-geometry.mjs";
import { exportCode } from "../app/src/engine/proto/codegen/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "tests", "proto", "fixtures", "geometry");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The exported page of a fixture with its stylesheet inlined (the DevTools page has no folder). */
export async function exportedPage(fixture) {
  const res = await exportCode(fixture.model, { format: "html", ids: [fixture.root], dataIds: true });
  const html = res.files.find((f) => f.path === "index.html").text;
  const css = res.files.find((f) => f.path === "styles.css").text;
  return html.replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}</style>`);
}

export async function roundTrip(browser, fixture) {
  const { s } = browser;
  const { frameTree } = await s("Page.getFrameTree");
  await s("Page.setDocumentContent", { frameId: frameTree.frame.id, html: await exportedPage(fixture) });
  await sleep(50);
  const boxes = await evaluate(
    s,
    `(() => {
      const els = [...document.querySelectorAll("[data-proto-id]")];
      const r0 = els[0].getBoundingClientRect();
      const round = (v) => Math.round(v * 100) / 100;
      const out = {};
      for (const el of els) {
        const r = el.getBoundingClientRect();
        out[el.dataset.protoId] = [round(r.left - r0.left), round(r.top - r0.top), round(r.width), round(r.height)];
      }
      return out;
    })()`,
  );
  const tol = fixture.text ? 2 : 1;
  const diffs = [];
  const missing = [];
  for (const [key, want] of Object.entries(fixture.boxes || {})) {
    const got = boxes[key];
    if (!got) {
      missing.push(key);
      continue;
    }
    const d = Math.max(...want.map((v, i) => Math.abs(v - got[i])));
    if (d > tol) diffs.push({ key, want, got, d });
  }
  return { tol, checked: Object.keys(fixture.boxes || {}).length - missing.length, missing, diffs };
}

async function main() {
  const only = process.argv.slice(2);
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json") && (!only.length || only.includes(f.replace(/\.json$/, "")))).sort();
  const browser = await launch();
  let failed = 0;
  try {
    console.log(`browser: ${browser.product}`);
    for (const f of files) {
      const fixture = JSON.parse(await readFile(join(DIR, f), "utf8"));
      const r = await roundTrip(browser, fixture);
      if (r.diffs.length) failed++;
      console.log(`${r.diffs.length ? "FAIL" : "ok  "} ${f}: ${r.checked} boxes within ${r.tol} px${r.missing.length ? `, left out: ${r.missing.join(", ")}` : ""}`);
      for (const d of r.diffs) console.log(`       ${d.key}: recorded ${d.want.join(", ")}, exported ${d.got.join(", ")} (${d.d} px)`);
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
