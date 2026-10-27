// Structure report of app/src from the static import graph (no build needed, no dependencies).
//
//   node scripts/import-report.mjs                 largest modules, fan-in/fan-out, circular imports, start-up closure size
//   node scripts/import-report.mjs --why <file>    shortest static import chain from index.html's entries to <file>
//   node scripts/import-report.mjs --top 30
//
// "Start-up" here is the static closure of app/src/main.js and app/src/bootguard.js (what index.html loads); the
// production numbers in KiB come from scripts/analyze-bundle.mjs.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, findCycles, pathTo, staticClosure } from "./lib/import-graph.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const posix = (p) => p.split(sep).join("/");
const APP = posix(join(projectRoot, "app"));
export const STARTUP_ENTRIES = ["src/main.js", "src/bootguard.js"].map((f) => `${APP}/${f}`);

function main() {
  const args = process.argv.slice(2);
  const top = Number(args[args.indexOf("--top") + 1]) || 20;
  const graph = buildGraph({ roots: [`${APP}/src`, `${APP}/vendor/fflate`, `${APP}/vendor/polygon-clipping`] });
  const rel = (f) => posix(relative(projectRoot, f));
  const why = args.indexOf("--why");
  if (why >= 0) {
    const target = posix(resolve(projectRoot, args[why + 1]));
    const chain = pathTo(graph, STARTUP_ENTRIES, target);
    console.log(chain ? chain.map(rel).join("\n  -> ") : `${rel(target)} is not in the static start-up closure`);
    return;
  }
  const lines = [...graph.keys()].map((f) => ({ f, n: readFileSync(f, "utf8").split("\n").length }));
  const fanIn = new Map([...graph.keys()].map((f) => [f, 0]));
  for (const node of graph.values()) for (const t of node.static) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
  const fanOut = [...graph.entries()].map(([f, n]) => ({ f, n: n.static.size }));
  const closure = staticClosure(graph, STARTUP_ENTRIES);
  const total = lines.reduce((s, x) => s + x.n, 0);
  console.log(`${graph.size} modules, ${total} lines; static start-up closure: ${closure.size} modules\n`);
  console.log(`Largest modules (lines, top ${top}):`);
  for (const x of lines.sort((a, b) => b.n - a.n).slice(0, top)) console.log(`  ${String(x.n).padStart(6)}  ${rel(x.f)}${closure.has(x.f) ? "  [startup]" : ""}`);
  console.log(`\nHighest fan-in (imported by N modules, top ${top}):`);
  for (const [f, n] of [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${String(n).padStart(6)}  ${rel(f)}`);
  console.log(`\nHighest fan-out (imports N modules, top ${top}):`);
  for (const x of fanOut.sort((a, b) => b.n - a.n).slice(0, top)) console.log(`  ${String(x.n).padStart(6)}  ${rel(x.f)}`);
  const cycles = findCycles(graph);
  console.log(`\nCircular static imports: ${cycles.length}`);
  for (const c of cycles) console.log(`  ${c.map(rel).join("  <->  ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
