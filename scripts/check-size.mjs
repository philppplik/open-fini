// Reports the size of the production build and fails when a budget is exceeded.
//
//   npm run check:size
//   node scripts/check-size.mjs [--root dist] [--budget scripts/size-budget.json] [--json]
//
// Budgets live in scripts/size-budget.json (KiB of gzip bytes):
//   shellJsGzipKiB   all JavaScript outside vendor/ (the app shell + service worker)
//   startupJsGzipKiB JavaScript needed to start the app (index.html modules + their static imports)
//   totalGzipKiB     everything the browser downloads, excluding fonts and license texts
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const GROUPS = ["shell-js", "vendor-js", "on-demand", "css", "fonts", "images", "markup-data", "legal", "other"];
/** Groups that do not count towards the "total download" budget. */
/** `on-demand` holds large libraries (PDF import, KaTeX) that load only when a feature is used and are not precached. */
const EXCLUDED_FROM_TOTAL = new Set(["fonts", "legal", "on-demand"]);
const ON_DEMAND = /^vendor\/(pdfjs|katex)\//;

/**
 * @param {string} rel posix path relative to the build folder
 * @returns {string} group name
 */
export function groupOf(rel) {
  const name = basename(rel);
  const ext = extname(name).toLowerCase();
  if (/^(LICENSE|COPYING|NOTICE)/i.test(name) || (rel.startsWith("vendor/") && [".md", ".txt"].includes(ext))) return "legal";
  if (ON_DEMAND.test(rel)) return "on-demand";
  if (ext === ".js" || ext === ".mjs") return rel.startsWith("vendor/") ? "vendor-js" : "shell-js";
  if (ext === ".css") return "css";
  if ([".woff2", ".woff", ".ttf", ".otf"].includes(ext)) return "fonts";
  if ([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".ico", ".icns"].includes(ext)) return "images";
  if ([".html", ".json", ".webmanifest", ".xml"].includes(ext)) return "markup-data";
  return "other";
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Measures every file below `root`.
 * @param {string} root
 */
export async function measure(root) {
  const groups = Object.fromEntries(GROUPS.map((g) => [g, { files: 0, raw: 0, gzip: 0, brotli: 0 }]));
  const files = [];
  for (const file of await walk(root)) {
    const rel = relative(root, file).split(sep).join("/");
    if (rel === "build-info.json") continue; // not downloaded by users
    const data = await readFile(file);
    const gzip = gzipSync(data, { level: 9 }).length;
    // Quality 11 is slow on big files; 9 is within a percent or two.
    const quality = data.length < 256 * 1024 ? 11 : 9;
    const brotli = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: quality } }).length;
    const group = groupOf(rel);
    const g = groups[group];
    g.files += 1;
    g.raw += data.length;
    g.gzip += gzip;
    g.brotli += brotli;
    files.push({ rel, group, raw: data.length, gzip, brotli });
  }
  const total = { files: 0, raw: 0, gzip: 0, brotli: 0 };
  for (const [name, g] of Object.entries(groups)) {
    if (EXCLUDED_FROM_TOTAL.has(name)) continue;
    for (const key of Object.keys(total)) total[key] += g[key];
  }
  return { groups, total, files, startup: await startupJs(root, files) };
}

/**
 * Gzip size of the JavaScript the browser must load before the app is usable: the module scripts of index.html and
 * everything they import statically (lazy `import()` chunks are not counted).
 */
export async function startupJs(root, files) {
  const sizes = new Map(files.map((f) => [f.rel, f.gzip]));
  let html = "";
  try {
    html = await readFile(join(root, "index.html"), "utf8");
  } catch {
    return null;
  }
  const seen = new Set();
  const queue = [...html.matchAll(/<script[^>]*type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => m[1]);
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel) || !sizes.has(rel)) continue;
    seen.add(rel);
    const code = await readFile(join(root, rel), "utf8");
    // static imports/re-exports only: `from"./x.js"` and bare `import"./x.js"`
    for (const m of code.matchAll(/(?:from|import)\s*"(\.\/[^"]+\.js)"/g)) {
      if (code[m.index - 1] === "(") continue;
      queue.push(join(dirname(rel), m[1]).split(sep).join("/"));
    }
  }
  let gzip = 0;
  for (const rel of seen) gzip += sizes.get(rel);
  return { files: seen.size, gzip };
}

const kib = (bytes) => (bytes / 1024).toFixed(1).padStart(9);

function parseArgs(argv) {
  const options = { root: join(projectRoot, "dist"), budget: join(projectRoot, "scripts", "size-budget.json"), json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "--root") options.root = resolve(value());
    else if (arg === "--budget") options.budget = resolve(value());
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-size.mjs [--root <dir>] [--budget <file>] [--json]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`check-size: ${err.message}`);
    process.exit(2);
  }

  let budget;
  try {
    budget = JSON.parse(await readFile(options.budget, "utf8"));
  } catch (err) {
    console.error(`check-size: cannot read budget ${options.budget}: ${err.message}`);
    process.exit(2);
  }

  let result;
  try {
    result = await measure(options.root);
  } catch (err) {
    console.error(`check-size: cannot read ${options.root}: ${err.code === "ENOENT" ? 'folder not found (run "npm run build" first)' : err.message}`);
    process.exit(2);
  }

  const checks = [
    { name: "shell JS (gzip)", actual: result.groups["shell-js"].gzip / 1024, limit: budget.shellJsGzipKiB },
    { name: "startup JS (gzip)", actual: result.startup ? result.startup.gzip / 1024 : 0, limit: budget.startupJsGzipKiB },
    { name: "total download (gzip, no fonts)", actual: result.total.gzip / 1024, limit: budget.totalGzipKiB },
  ].filter((c) => typeof c.limit === "number");
  const failed = checks.filter((c) => c.actual > c.limit);

  if (options.json) {
    console.log(JSON.stringify({ ...result, checks, ok: failed.length === 0 }, null, 2));
  } else {
    console.log(`Build size of ${relative(projectRoot, options.root) || options.root} (KiB)\n`);
    console.log(`${"group".padEnd(14)}${"files".padStart(7)}${"raw".padStart(10)}${"gzip".padStart(10)}${"brotli".padStart(10)}`);
    for (const name of GROUPS) {
      const g = result.groups[name];
      if (g.files === 0) continue;
      const note = EXCLUDED_FROM_TOTAL.has(name) ? "  (not in total)" : "";
      console.log(`${name.padEnd(14)}${String(g.files).padStart(7)}${kib(g.raw)} ${kib(g.gzip)} ${kib(g.brotli)}${note}`);
    }
    const t = result.total;
    console.log(`${"total".padEnd(14)}${String(t.files).padStart(7)}${kib(t.raw)} ${kib(t.gzip)} ${kib(t.brotli)}\n`);

    const largest = [...result.files].sort((a, b) => b.gzip - a.gzip).slice(0, 5);
    console.log("Largest files (gzip KiB):");
    for (const f of largest) console.log(`  ${kib(f.gzip)}  ${f.rel}`);
    console.log("");
    for (const c of checks) {
      console.log(`${c.actual > c.limit ? "FAIL" : "ok  "}  ${c.name}: ${c.actual.toFixed(1)} KiB (budget ${c.limit} KiB)`);
    }
  }

  if (failed.length > 0) {
    console.error(`\ncheck-size: ${failed.length} budget(s) exceeded. Raise scripts/size-budget.json only deliberately.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
