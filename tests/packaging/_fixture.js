// Shared test helper: writes a tiny app that exercises every feature of the
// build script (bundling, code splitting, workers, external Shoelace, CSS) and
// builds it into a temporary folder.
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "../../scripts/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const realSw = resolve(here, "..", "..", "app", "sw.js");

async function write(root, rel, text) {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

export async function createFixtureApp() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "openfini-fixture-")); // realpath: macOS tmp is a symlink and esbuild reports resolved paths
  const app = join(dir, "app");
  await write(app, "index.html", `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="stylesheet" href="./styles/app.css">
<link rel="stylesheet" href="./vendor/shoelace/themes/dark.css">
</head><body><div id="app"></div>
<script type="module" src="./src/main.js"></script>
</body></html>
`);
  await write(app, "styles/app.css", "/* comment */\nbody {\n  margin: 0;\n  background: url(\"../img/bg.png\");\n}\n");
  await write(app, "img/bg.png", "not really a png");
  await write(app, "manifest.webmanifest", "{\"name\":\"Fixture\"}");
  await write(app, "src/main.js", `import { greet } from "./util.js";
import { zip } from "../vendor/fflate/fflate.js";
import "../vendor/shoelace/shoelace-autoloader.js";
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const lazy = () => import("./lazy.js");
const icon = (name) => new URL(\`../assets/icons/\${name}.svg\`, import.meta.url).href;
await Promise.resolve();
globalThis.fixture = { greet: greet("main"), zip, worker, lazy, icon };
`);
  await write(app, "src/util.js", "export const greet = (name) => `hello ${name} from a shared module`;\n");
  await write(app, "src/lazy.js", "export const lazyValue = 'this module is code-split into a chunk';\n");
  await write(app, "src/worker.js", `import { greet } from "./util.js";
self.onmessage = () => self.postMessage(greet("worker"));
`);
  await write(app, "assets/icons/star.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  await write(app, "vendor/fflate/fflate.js", "export const zip = () => 'zip';\n");
  await write(app, "vendor/fflate/LICENSE", "MIT License (fixture)");
  await write(app, "vendor/shoelace/shoelace-autoloader.js", "export const autoloader = true;\n");
  await write(app, "vendor/shoelace/themes/dark.css", ":root{color-scheme:dark}\n");
  await write(app, "vendor/shoelace/translations/en.js", "export default {};\n");
  await write(app, "vendor/shoelace/translations/de.js", "export default {};\n");
  await write(app, "vendor/shoelace/components/button/button.js", "export default {};\n");
  await write(app, "vendor/shoelace/LICENSE.md", "MIT (fixture)");
  await write(app, "icons/icon.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  await cp(realSw, join(app, "sw.js"));
  return { dir, app, out: join(dir, "dist") };
}

/** Builds the fixture and returns paths plus the build result. */
export async function buildFixture(options = {}) {
  const fixture = await createFixtureApp();
  const result = await build({ root: fixture.app, out: fixture.out, quiet: true, ...options });
  return { ...fixture, result, cleanup: () => rm(fixture.dir, { recursive: true, force: true }) };
}
