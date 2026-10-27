// Explains the production bundle: which chunks and source modules cost the most, and what loads at start-up.
//
//   node scripts/analyze-bundle.mjs [--out dist] [--top 40] [--json]
//
// Runs the real production build (scripts/build.mjs, same esbuild configuration) and reads the esbuild metafile it
// returns. Prints:
//   * chunks by gzip size, marked "startup" when they are in the static import closure of index.html;
//   * the source modules inside the start-up closure, by estimated gzip size (bytes in output scaled by the chunk's
//     gzip ratio; an estimate, good for ranking), and the same aggregated per folder;
//   * the largest modules overall.
// Use it before and after a size refactor; docs/refactoring-audit.md records the numbers.
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "./build.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toPosix = (p) => p.split(sep).join("/");
const kib = (n) => (n / 1024).toFixed(1);

/**
 * Pure analysis of an esbuild metafile.
 * @param {object} metafile esbuild metafile (paths relative to `root`)
 * @param {(outPath: string) => number} gzipOf gzip size of an output file
 */
export function analyze(metafile, gzipOf) {
  const outputs = metafile.outputs;
  const chunks = Object.entries(outputs)
    .filter(([path]) => path.endsWith(".js"))
    .map(([path, o]) => ({ path, raw: o.bytes, gzip: gzipOf(path), entry: o.entryPoint ?? null, inputs: o.inputs, imports: o.imports }));
  const byPath = new Map(chunks.map((c) => [c.path, c]));

  // Static closure of the index.html entry points. Dynamic import() targets also carry `entryPoint` in the metafile,
  // but build.mjs names them "chunk-[hash]" while real entries are "[name]-[hash]".
  const startup = new Set();
  const queue = chunks.filter((c) => c.entry && !/(^|\/)chunk-[^/]+$/.test(c.path)).map((c) => c.path);
  while (queue.length) {
    const p = queue.pop();
    if (startup.has(p) || !byPath.has(p)) continue;
    startup.add(p);
    for (const imp of byPath.get(p).imports) if (imp.kind === "import-statement" && !imp.external) queue.push(imp.path);
  }

  const modules = [];
  for (const c of chunks) {
    const ratio = c.raw ? c.gzip / c.raw : 0;
    for (const [input, { bytesInOutput }] of Object.entries(c.inputs)) {
      if (!bytesInOutput) continue;
      modules.push({ input, chunk: c.path, startup: startup.has(c.path), raw: bytesInOutput, gzipEst: bytesInOutput * ratio });
    }
  }
  // Dominators: for each start-up source module M, the start-up bytes that would leave the closure if M were loaded
  // with import() instead (everything reachable at start-up only through M). The best lazy-loading candidates.
  const startupInputs = new Map(modules.filter((m) => m.startup).map((m) => [m.input, m.gzipEst]));
  const entryInputs = chunks.filter((c) => startup.has(c.path) && c.entry && !/(^|\/)chunk-[^/]+$/.test(c.path)).map((c) => c.entry);
  const reach = (skip) => {
    const seen = new Set();
    const q = [...entryInputs];
    while (q.length) {
      const f = q.pop();
      if (f === skip || seen.has(f)) continue;
      seen.add(f);
      for (const imp of metafile.inputs[f]?.imports ?? []) if (imp.kind === "import-statement" && !imp.external) q.push(imp.path);
    }
    return seen;
  };
  const full = reach(null);
  const dominators = [];
  for (const input of full) {
    if (entryInputs.includes(input)) continue;
    const without = reach(input);
    let gzipEst = 0;
    let count = 0;
    for (const f of full) {
      if (!without.has(f)) {
        gzipEst += startupInputs.get(f) ?? 0;
        count++;
      }
    }
    dominators.push({ input, gzipEst, modules: count });
  }
  dominators.sort((a, b) => b.gzipEst - a.gzipEst);

  const folders = new Map();
  for (const m of modules.filter((x) => x.startup)) {
    const folder = m.input.includes("/") ? m.input.slice(0, m.input.lastIndexOf("/")) : ".";
    folders.set(folder, (folders.get(folder) ?? 0) + m.gzipEst);
  }
  return {
    chunks: chunks.map((c) => ({ path: c.path, raw: c.raw, gzip: c.gzip, startup: startup.has(c.path), entry: c.entry })),
    modules,
    dominators,
    startupFolders: [...folders.entries()].map(([folder, gzipEst]) => ({ folder, gzipEst })).sort((a, b) => b.gzipEst - a.gzipEst),
    startupGzip: chunks.filter((c) => startup.has(c.path)).reduce((s, c) => s + c.gzip, 0),
    totalGzip: chunks.reduce((s, c) => s + c.gzip, 0),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const out = resolve(opt("--out", join(projectRoot, "dist")));
  const top = Number(opt("--top", 40));
  const json = args.includes("--json");

  const result = await build({ out, quiet: true });
  const root = result.root;
  const gz = new Map();
  for (const path of Object.keys(result.metafile.outputs)) {
    if (path.endsWith(".js")) gz.set(path, gzipSync(await readFile(resolve(root, path)), { level: 9 }).length);
  }
  const report = analyze(result.metafile, (p) => gz.get(p) ?? 0);
  const short = (p) => toPosix(relative(projectRoot, resolve(root, p)));

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Bundled app JS: ${kib(report.totalGzip)} KiB gzip in ${report.chunks.length} chunks; start-up closure ${kib(report.startupGzip)} KiB gzip\n`);
  console.log(`Chunks by gzip KiB (top ${top}):`);
  for (const c of [...report.chunks].sort((a, b) => b.gzip - a.gzip).slice(0, top)) {
    const biggest = report.modules.filter((m) => m.chunk === c.path).sort((a, b) => b.raw - a.raw)[0];
    console.log(`  ${kib(c.gzip).padStart(7)}  ${c.startup ? "startup" : "lazy   "}  ${short(c.path)}  (${biggest ? short(biggest.input) : "-"} ...)`);
  }
  console.log(`\nStart-up modules by estimated gzip KiB (top ${top}):`);
  for (const m of report.modules.filter((x) => x.startup).sort((a, b) => b.gzipEst - a.gzipEst).slice(0, top)) {
    console.log(`  ${kib(m.gzipEst).padStart(7)}  ${short(m.input)}`);
  }
  console.log(`\nLazy-loading candidates: start-up KiB (est. gzip) reachable only through a module (top ${top}):`);
  for (const d of report.dominators.slice(0, top)) {
    console.log(`  ${kib(d.gzipEst).padStart(7)}  ${String(d.modules).padStart(4)} modules  ${short(d.input)}`);
  }
  console.log("\nStart-up gzip KiB per folder:");
  for (const f of report.startupFolders.slice(0, top)) console.log(`  ${kib(f.gzipEst).padStart(7)}  ${short(f.folder)}`);
  console.log(`\nLargest modules overall (est. gzip KiB, top ${top}):`);
  for (const m of [...report.modules].sort((a, b) => b.gzipEst - a.gzipEst).slice(0, top)) {
    console.log(`  ${kib(m.gzipEst).padStart(7)}  ${m.startup ? "startup" : "lazy   "}  ${short(m.input)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
