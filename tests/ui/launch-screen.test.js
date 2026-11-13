// Launch screen (docs/launch-screen.md, ADR 0031): boot stage progress, the shared card in index.html and splash.html,
// the version stamp and the desktop splash window wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { stampVersion } from "../../scripts/build.mjs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
await import("../../app/src/launch.js"); // classic script: exposes its pure part as globalThis.OpenFiniLaunch
const { createBootProgress, STAGES } = globalThis.OpenFiniLaunch;

test("boot progress: stages fill the bar in order, measured parts move inside a stage", () => {
  const p = createBootProgress([["a", 10], ["b", 30], ["c", 60]]);
  assert.deepEqual({ ...p.state }, { value: 0, busy: true, stage: null, label: "", done: false });
  let s = p.stage("b", "Loading studios…");
  assert.equal(s.value, 0.1);
  assert.equal(s.busy, true, "a stage without a measure shimmers");
  assert.equal(s.label, "Loading studios…");
  s = p.progress("c", 0.5);
  assert.equal(s.value, 0.7);
  assert.equal(s.busy, false);
  assert.equal(s.label, "Loading studios…", "the last label stays until a new one comes");
  s = p.stage("a"); // never backwards
  assert.equal(s.value, 0.7);
  s = p.progress("c", 7);
  assert.equal(s.value, 1, "fractions are clamped");
  p.stage("nope");
  p.progress("c", Number.NaN);
  assert.equal(p.state.value, 1);
  s = p.done();
  assert.equal(s.done, true);
  p.stage("a", "late");
  assert.equal(p.state.label, "Loading studios…", "nothing changes after done");
});

test("boot progress: the app's stages are unique and add up", () => {
  const ids = STAGES.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["start", "language", "studios", "interface", "documents", "finish"]) assert.ok(ids.includes(id), id);
  const p = createBootProgress();
  p.progress("documents", 1);
  assert.ok(p.state.value > 0.9 && p.state.value < 1);
  const main = read("app/src/main.js");
  for (const m of main.matchAll(/launch\??\.stage\("(\w+)"/g)) assert.ok(ids.includes(m[1]), `main.js uses an unknown stage ${m[1]}`);
});

test("index.html and splash.html share the same launch card and critical CSS", () => {
  const block = (html, name) => {
    const m = new RegExp(`<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->`).exec(html);
    assert.ok(m, `${name} block`);
    return m[0];
  };
  const index = read("app/index.html");
  const splash = read("app/splash.html");
  for (const name of ["launch-css", "launch-card"]) assert.equal(block(splash, name), block(index, name), `${name} differs: copy it from index.html`);
  const card = block(index, "launch-card");
  assert.match(card, /role="status"/);
  assert.match(card, /aria-live="polite"/);
  assert.match(card, /aria-busy="true"/);
  assert.match(card, /role="progressbar"/);
  assert.match(card, /loading="lazy"/, "the artwork never blocks start-up");
  assert.match(card, /data-of-version><\/span>/, "the version is never hard-coded");
  assert.match(block(index, "launch-css"), /prefers-reduced-motion/);
  // the card's script is a classic script before the app modules, so the card is themed or removed before first paint
  assert.ok(index.indexOf('<script src="./src/launch.js"></script>') < index.indexOf('type="module"'));
  assert.match(splash, /data-launch-window/);
});

test("the artwork is a compact WebP", () => {
  const bytes = readFileSync(new URL("../../app/assets/launch/artwork.webp", import.meta.url));
  assert.equal(bytes.subarray(8, 12).toString("latin1"), "WEBP");
  assert.ok(statSync(new URL("../../app/assets/launch/artwork.webp", import.meta.url)).size < 200 * 1024, "keep the artwork under 200 KB");
});

test("the build stamps the package version into the card", () => {
  const html = '<span class="of-splash__ver" data-of-version></span>';
  assert.equal(stampVersion(html, "1.2.3"), '<span class="of-splash__ver" data-of-version>v1.2.3</span>');
  assert.equal(stampVersion('<span data-of-version>v9</span>', "1.2.3"), '<span data-of-version>v9</span>', "only empty elements");
});

test("desktop: a hidden main window behind a splash window that never blocks start-up", () => {
  for (const file of ["src-tauri/tauri.conf.json", "src-tauri/tauri.macos.conf.json"]) {
    const windows = JSON.parse(read(file)).app.windows;
    const main = windows.find((w) => w.label === "main");
    const splash = windows.find((w) => w.label === "splash");
    assert.equal(main.visible, false, `${file}: the main window shows when the app is ready`);
    assert.ok(splash, `${file}: splash window`);
    assert.equal(splash.url, "splash.html");
    assert.equal(splash.decorations, false);
    assert.equal(splash.resizable, false);
    assert.equal(splash.alwaysOnTop, true);
    assert.equal(splash.center, true);
    assert.equal(splash.visible, false, "it shows itself after its first paint (no empty frame)");
  }
  const cap = JSON.parse(read("src-tauri/capabilities/splash.json"));
  assert.deepEqual(cap.windows, ["splash"]);
  assert.ok(cap.permissions.includes("allow-launch-ready"));
  const lib = read("src-tauri/src/lib.rs");
  assert.match(lib, /LAUNCH_TIMEOUT/, "a timeout shows the main window anyway");
  assert.match(lib, /fn launch_ready/);
});
