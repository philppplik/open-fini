// Builds the one-file collaboration relay: scripts/relay.mjs with the QR encoder (app/src/collab/qr.js) and the
// self-signed certificate writer (scripts/relay-tls.mjs) bundled in. People without the OpenFini sources run it with
// `node openfini-relay.mjs --lan` in any folder: Node.js 20+ only, no npm, no package install, nothing else next to it.
//
//   node scripts/relay-bundle.mjs [--out dist/tools/openfini-relay.mjs]
//
// scripts/build.mjs calls bundleRelay() for the app build (dist/tools/openfini-relay.mjs: not precached, not in the
// size budget's total; the Collaboration window's "How to start a relay" saves it), and the release attaches the same
// file as a release asset. The bundle sets globalThis.__OPENFINI_RELAY__ before relay.mjs runs (see its header).
import { build as esbuild } from "esbuild";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Writes the one-file relay to `out`. Returns the output path.
 * @param {{out?: string, version?: string, minify?: boolean}} [o]
 */
export async function bundleRelay({ out = join(projectRoot, "dist", "tools", "openfini-relay.mjs"), version, minify = false } = {}) {
  const pkg = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const v = version || pkg.version;
  const spec = (rel) => JSON.stringify(pathToFileURL(join(projectRoot, rel)).href);
  // Static imports of the extras, then the relay itself by dynamic import so it runs after the global is set.
  const contents = [
    `import * as qr from ${spec("app/src/collab/qr.js")};`,
    `import * as tls from ${spec("scripts/relay-tls.mjs")};`,
    `globalThis.__OPENFINI_RELAY__ = { qr, tls, version: ${JSON.stringify(v)} };`,
    `await import(${spec("scripts/relay.mjs")});`,
  ].join("\n");
  await esbuild({
    stdin: { contents, resolveDir: projectRoot, sourcefile: "openfini-relay-entry.mjs", loader: "js" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    minify,
    legalComments: "none",
    outfile: out,
    logLevel: "silent",
    plugins: [{
      name: "file-urls",
      setup(b) {
        b.onResolve({ filter: /^file:/ }, (a) => ({ path: fileURLToPath(a.path) }));
      },
    }],
    banner: {
      js: [
        "#!/usr/bin/env node",
        `// OpenFini collaboration relay ${v}, one file (MIT license, https://github.com/philppplik/open-fini).`,
        "// Needs only Node.js 20 or newer: no npm, no package install. Run it in the folder where this file is:",
        "//   node openfini-relay.mjs --lan      your network (phones, tablets, laptops), with https and a QR code",
        "//   node openfini-relay.mjs            this computer only",
        "//   node openfini-relay.mjs --help     all options",
      ].join("\n"),
    },
  });
  return out;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? resolve(process.argv[i + 1]) : undefined;
  bundleRelay({ out }).then((p) => console.log(`relay: wrote ${p}`), (e) => {
    console.error(e.message);
    process.exit(1);
  });
}
