// Regenerates `contributes.snippets` of openfini-extension.json from SNIPPETS in src/lib.js.
//   node extensions/code-tools/build-manifest.mjs
// (tests/extensions-bundled/code-tools.test.js fails when the manifest is out of sync.)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SNIPPETS } from "./src/lib.js";

const file = join(dirname(fileURLToPath(import.meta.url)), "openfini-extension.json");
const manifest = JSON.parse(readFileSync(file, "utf8"));
manifest.contributes.snippets = SNIPPETS;
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${SNIPPETS.length} snippets to ${file}`);
