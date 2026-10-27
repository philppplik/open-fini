// Reports exports of app/src that nothing imports, and modules that only tests import. Never fails (exit code 0):
// it is a report for humans, because some exports are used in ways a static scan cannot see.
//
//   node scripts/find-dead-exports.mjs [--json] [--modules-only]
//
// Sources of truth: the static import graph of app/src (scripts/lib/import-graph.mjs) plus tests/, sdk/, scripts/ and
// extensions/ as additional importers. An export counts as used when some module imports it by name, imports the whole
// module (`import * as`, `import()`, `export *`), or re-exports it and the re-export is used.
//
// Known blind spots (check before deleting anything): exports read through a namespace object passed around at
// runtime, names looked up dynamically (`mod[name]`), modules loaded by URL (workers, `new URL()` templates, extension
// sandboxes) and code that the docs promise as public API (sdk/, extension host). Treat the output as a to-do list
// for a human, never as an automatic delete list.
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { buildGraph, stripComments } from "./lib/import-graph.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const posix = (p) => p.split(sep).join("/");
const APP = posix(join(projectRoot, "app", "src"));
const ENTRIES = ["main.js", "bootguard.js", "sw.js"].map((f) => `${APP}/${f}`);

/**
 * @param {Map<string, any>} graph every scanned module (app and its importers)
 * @param {(file: string) => boolean} isApp modules to report on
 * @param {(file: string) => boolean} isTest importers that only count as "tests-only"
 */
export function deadExports(graph, isApp, isTest) {
  // used[name] per module; resolve re-export chains to a fixed point.
  const used = new Map([...graph.keys()].map((f) => [f, new Set()]));
  const usedByTest = new Map([...graph.keys()].map((f) => [f, new Set()]));
  const importedBy = new Map([...graph.keys()].map((f) => [f, { app: 0, test: 0 }]));
  const mark = (target, names, test) => {
    const set = (test ? usedByTest : used).get(target);
    if (!set) return false;
    const before = set.size;
    if (names === "*") set.add("*");
    else for (const n of names) set.add(n);
    return set.size !== before;
  };
  for (const [file, node] of graph) {
    const test = isTest(file);
    for (const [target, names] of node.uses) {
      mark(target, names, test);
      const counter = importedBy.get(target);
      if (counter) counter[test ? "test" : "app"]++;
    }
    for (const t of node.dynamic) {
      const counter = importedBy.get(t);
      if (counter) counter[test ? "test" : "app"]++;
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, node] of graph) {
      for (const which of [used, usedByTest]) {
        const mine = which.get(file);
        for (const { from, names } of node.reexports) {
          const counter = importedBy.get(from);
          if (counter && which === used) counter.app += 0; // counted via uses below
          if (names === null) {
            // export * from: forward everything that is used on this module
            if (mine.size && mark(from, mine.has("*") ? "*" : [...mine], which === usedByTest)) changed = true;
          } else {
            const fwd = names.filter(([, exported]) => mine.has("*") || mine.has(exported)).map(([imported]) => imported);
            if (fwd.length && mark(from, fwd, which === usedByTest)) changed = true;
          }
        }
      }
    }
  }
  const unused = [];
  const testsOnly = [];
  const orphanModules = [];
  for (const [file, node] of graph) {
    if (!isApp(file) || ENTRIES.includes(file)) continue;
    const u = used.get(file);
    const t = usedByTest.get(file);
    const imp = importedBy.get(file);
    const reexported = [...graph.values()].some((n) => n.reexports.some((r) => r.from === file));
    if (imp.app === 0 && !reexported) {
      orphanModules.push({ file, tests: imp.test });
      continue;
    }
    if (u.has("*")) continue;
    for (const name of node.exports) {
      if (u.has(name)) continue;
      if (t.has(name) || t.has("*")) testsOnly.push({ file, name });
      else unused.push({ file, name });
    }
  }
  return { unused, testsOnly, orphanModules };
}

function main() {
  const json = process.argv.includes("--json");
  const modulesOnly = process.argv.includes("--modules-only");
  const roots = ["app/src", "app/sw.js", "tests", "sdk", "scripts", "extensions"].map((p) => posix(join(projectRoot, p)));
  const graph = buildGraph({ roots });
  const isApp = (f) => f.startsWith(`${APP}/`);
  const isTest = (f) => !isApp(f);
  const report = deadExports(graph, isApp, isTest);
  const rel = (f) => posix(relative(projectRoot, f));
  if (json) {
    const map = (xs) => xs.map((x) => ({ ...x, file: rel(x.file) }));
    console.log(JSON.stringify({ unused: map(report.unused), testsOnly: map(report.testsOnly), orphanModules: map(report.orphanModules) }, null, 2));
    return;
  }
  console.log(`Modules no app code imports (${report.orphanModules.length}; "tests" = imported by tests/sdk/scripts only):`);
  for (const m of report.orphanModules) console.log(`  ${rel(m.file)}${m.tests ? `  (tests: ${m.tests})` : ""}`);
  if (modulesOnly) return;
  const group = (xs) => {
    const by = new Map();
    for (const x of xs) by.set(x.file, [...(by.get(x.file) ?? []), x.name]);
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  // An unused export that its own module also never references is dead code; the others only lose the `export`
  // keyword (no size change: esbuild already drops unused exports).
  const sources = new Map();
  const refs = (file, name) => {
    if (!sources.has(file)) sources.set(file, stripComments(readFileSync(file, "utf8")));
    return (sources.get(file).match(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g")) ?? []).length;
  };
  const dead = report.unused.filter((x) => x.name !== "default" && refs(x.file, x.name) <= 1);
  const deadSet = new Set(dead.map((x) => `${x.file}#${x.name}`));
  console.log(`\nDead code: exported, never imported and never used in its own module (${dead.length}):`);
  for (const [file, names] of group(dead)) console.log(`  ${rel(file)}: ${names.join(", ")}`);
  const internal = report.unused.filter((x) => !deadSet.has(`${x.file}#${x.name}`));
  console.log(`\nExports nothing imports, but used inside their module (${internal.length}; the export keyword is unneeded):`);
  for (const [file, names] of group(internal)) console.log(`  ${rel(file)}: ${names.join(", ")}`);
  console.log(`\nExports only tests/scripts import (${report.testsOnly.length}):`);
  for (const [file, names] of group(report.testsOnly)) console.log(`  ${rel(file)}: ${names.join(", ")}`);
  console.log("\nThis is a report, not a delete list: see the header of scripts/find-dead-exports.mjs for blind spots.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
