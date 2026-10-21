#!/usr/bin/env node
// Scaffolds a new OpenFini extension.
//
//   node sdk/create-extension.mjs my-publisher.my-extension [--template command|panel|theme] [--dir folder]
//
// Creates <dir>/openfini-extension.json plus a starting point (main.js, panel/, or a theme). Dependency-free.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ID = /^[a-z0-9][a-z0-9-]{1,30}\.[a-z0-9][a-z0-9-]{1,40}$/;
const title = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** Returns { "relative/path": "text" } for a new extension. */
export function scaffold(id, template = "command", version = "0.3.0") {
  if (!ID.test(id)) throw new Error(`“${id}” is not a valid extension id. Use publisher.name with lowercase letters, digits and dashes, e.g. acme.grid-tools.`);
  const name = title(id.split(".")[1]);
  const manifest = { id, name, version: "0.1.0", description: `${name}: describe what it does in one sentence.`, engines: { openfini: `>=${version}` } };
  const files = {};
  if (template === "command") {
    Object.assign(manifest, { main: "main.js", permissions: ["document.read", "ui"], contributes: { commands: [{ id: "hello", title: `${name}: Say Hello`, studios: ["vector", "pixel", "layout", "code"] }], menus: [{ menu: "Studio", command: "hello" }] } });
    files["main.js"] = `// ${name}. Runs in a sandbox: the global \`openfini\` object is the whole API.
// Reference: sdk/README.md and docs/extensions.md. Types: sdk/openfini.d.ts.

async function activate(openfini) {
  await openfini.commands.register("hello", async () => {
    const page = await openfini.document.pageInfo(); // needs "document.read"
    const where = page ? \`page \${page.index + 1} of \${page.count} (\${page.width} × \${page.height})\` : "no document";
    await openfini.ui.showMessage(\`Hello from ${name}! You are on \${where}.\`, "success"); // needs "ui"
  });
}
`;
  } else if (template === "panel") {
    Object.assign(manifest, { permissions: ["document.write", "ui"], contributes: { panels: [{ id: "main", title: name.slice(0, 30), html: "panel/index.html", icon: "puzzle", studios: ["vector", "pixel", "layout", "code"] }] } });
    files["panel/index.html"] = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><link rel="stylesheet" href="panel.css"></head>
<body>
  <h1>${name}</h1>
  <p>Edit panel/index.html, panel.css and panel.js.</p>
  <button id="add" class="primary" type="button">Add a rectangle</button>
  <p id="status" role="status"></p>
  <script src="panel.js"></script>
</body>
</html>
`;
    files["panel/panel.css"] = `/* OpenFini's theme variables (--of-*) are available, so the panel matches light and dark. */\n#status { color: var(--of-text-dim); }\n`;
    files["panel/panel.js"] = `document.getElementById("add").addEventListener("click", async () => {
  try {
    const r = await openfini.document.callTool("add_shape", { type: "rect", x: 40, y: 40, w: 120, h: 80 });
    document.getElementById("status").textContent = \`Added \${r.name}.\`;
  } catch (err) {
    document.getElementById("status").textContent = err.message;
  }
});
`;
  } else if (template === "theme") {
    manifest.contributes = {
      themes: [{
        id: "my-theme",
        label: name,
        dark: { "--of-bg-app": "#16181d", "--of-bg-bar": "#1c1f26", "--of-bg-panel": "#20242c", "--of-bg-raised": "#2a2f39", "--of-bg-input": "#14161b", "--of-border": "#363c49", "--of-text": "#e9ecf3", "--of-text-dim": "#a0a7b8", "--of-accent": "#ff8a5b" },
        light: { "--of-bg-app": "#eceef2", "--of-bg-bar": "#f8f9fb", "--of-bg-panel": "#f2f4f7", "--of-bg-raised": "#ffffff", "--of-bg-input": "#ffffff", "--of-border": "#d0d4de", "--of-text": "#1b1e26", "--of-text-dim": "#596073", "--of-accent": "#d9531e" },
      }],
    };
  } else throw new Error(`Unknown template “${template}”. Use command, panel or theme.`);
  files["openfini-extension.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  files["README.md"] = `# ${name}\n\nAn OpenFini extension.\n\n- Load it: OpenFini > Studio > Extensions > turn on Developer mode > Load unpacked… and pick this folder.\n- Pack it: \`node sdk/pack.mjs .\` creates a .ofext file you can share.\n`;
  return files;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const id = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (!id) {
    console.error("Usage: node sdk/create-extension.mjs publisher.name [--template command|panel|theme] [--dir folder]");
    process.exit(1);
  }
  try {
    const dir = resolve(opt("--dir") || id.split(".")[1]);
    if (existsSync(join(dir, "openfini-extension.json"))) throw new Error(`${dir} already contains an extension.`);
    for (const [rel, text] of Object.entries(scaffold(id, opt("--template") || "command"))) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    console.log(`Created ${dir}\nNext: load it in OpenFini (Studio > Extensions > Developer mode > Load unpacked) or pack it with: node sdk/pack.mjs "${dir}"`);
  } catch (err) {
    console.error(`create-extension: ${err.message}`);
    process.exit(1);
  }
}
