#!/usr/bin/env node
// `ofini`: the OpenFini command line tool. Install from a clone of the repository with `npm link` (or
// `npm install -g .`), or run it with `npx ofini` / `npm run ofini --`. Reference: docs/cli.md.
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  process.stderr.write(`ofini needs Node.js 20 or later (this is ${process.versions.node}).\n`);
  process.exit(5);
}

const { main, COMMANDS, VERSION } = await import("./lib/main.mjs");
const argv = process.argv.slice(2);
process.on("SIGINT", () => process.exit(130));
process.stdout.on("error", (e) => {
  if (e.code === "EPIPE") process.exit(0); // `ofini … | head`
});

if (!argv.length && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
  const { startRepl } = await import("./lib/repl.mjs");
  process.removeAllListeners("SIGINT");
  process.exitCode = await startRepl({ main, commands: COMMANDS, version: VERSION, io: { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env, cwd: process.cwd() } });
} else {
  process.exitCode = await main(argv);
}
