// Copies only the Bootstrap Icons that the app actually references into app/vendor/shoelace/assets/icons.
// Shoelace ships ~2000 icons; OpenFini uses a few dozen. Run after adding icons to the source:
//
//   node scripts/vendor-icons.mjs <path-to>/@shoelace-style/shoelace/cdn/assets/icons
//
// (npm pack @shoelace-style/shoelace@2.20.1 and extract it to get that directory.)
import { readdir, readFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = process.argv[2];
if (!from || !existsSync(from)) {
  console.error("Usage: node scripts/vendor-icons.mjs <path to shoelace assets/icons>");
  process.exit(1);
}
const dest = join(root, "app", "vendor", "shoelace", "assets", "icons");
await mkdir(dest, { recursive: true });

const available = new Set((await readdir(from)).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)));

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if ([".js", ".html"].includes(extname(p))) yield p;
  }
}

const used = new Set();
for await (const file of walk(join(root, "app", "src"))) {
  const text = await readFile(file, "utf8");
  for (const m of text.matchAll(/["'`]([a-z0-9][a-z0-9-]*)["'`]/g)) if (available.has(m[1])) used.add(m[1]);
}
for (const extra of ["chevron-down", "check", "x", "circle", "square", "dash", "plus", "chevron-up", "chevron-left", "chevron-right", "x-lg", "check-lg", "eye", "eye-slash"]) if (available.has(extra)) used.add(extra);
// Shoelace's own components load a few icons by name
for (const extra of ["x-circle-fill", "check2", "chevron-double-left", "chevron-double-right", "exclamation-triangle", "info-circle", "check2-circle", "exclamation-octagon", "gear", "eyedropper", "star-fill", "star", "upload", "image", "arrow-counterclockwise"]) if (available.has(extra)) used.add(extra);

for (const name of used) await copyFile(join(from, `${name}.svg`), join(dest, `${name}.svg`));
console.log(`Copied ${used.size} icons to ${dest}`);
