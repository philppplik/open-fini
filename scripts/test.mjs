// Runs every tests/**/*.test.{js,mjs} with the built-in Node test runner.
//
//   npm test
//   npm test -- --test-name-pattern="serves"     extra arguments go to `node --test`
//
// Why not plain `node --test`? Without arguments it also walks _vendor/, _tools/ and any other
// checkout that happens to sit in the folder, and Node 20 and Node 22+ disagree about how
// directories and globs are handled. Passing explicit file paths works on every supported Node.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTests(full));
    else if (/\.test\.m?js$/.test(entry.name)) found.push(full);
  }
  return found;
}

let files;
try {
  files = findTests(join(root, "tests")).sort();
} catch (err) {
  console.error(`test: cannot read tests/: ${err.message}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error("test: no tests/**/*.test.js files found");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files.map((f) => relative(root, f))], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
