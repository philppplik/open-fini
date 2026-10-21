// Generates the files of a small extension (used by the `create_extension` Vibe tool and the manager's
// "New extension" button). The SDK's create-extension.mjs has its own copy of the templates so it stays standalone.
import { MANIFEST_FILE } from "./manifest.js";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "extension";

/**
 * @param {{id?: string, name: string, description?: string, permissions?: string[], commands?: {id?: string, title: string, studios?: string[]}[],
 *   mainJs?: string, hostVersion?: string}} spec
 * @returns {{id: string, files: Record<string,string>}}
 */
export function buildScaffold(spec) {
  const name = String(spec.name || "My Extension").trim().slice(0, 60);
  const id = spec.id && /\./.test(spec.id) ? spec.id : `local.${slug(name)}`;
  const commands = (spec.commands?.length ? spec.commands : [{ id: "run", title: name }]).map((c) => ({ id: c.id || slug(c.title).replace(/-/g, "."), title: c.title, ...(c.studios?.length ? { studios: c.studios } : {}) }));
  const permissions = [...new Set(spec.permissions || [])];
  const manifest = {
    id,
    name,
    version: "0.1.0",
    description: String(spec.description || `${name} (local extension)`).slice(0, 300),
    engines: { openfini: `>=${spec.hostVersion || "0.3.0"}` },
    main: "main.js",
    permissions,
    contributes: { commands },
  };
  const main = spec.mainJs?.trim()
    ? spec.mainJs
    : `// ${name}\n// Runs in a sandbox. The \`openfini\` global is the extension API (see docs/extensions.md).\nasync function activate(openfini) {\n${commands.map((c) => `  await openfini.commands.register(${JSON.stringify(c.id)}, async () => {\n    await openfini.ui.showMessage("Hello from ${name.replace(/["\\]/g, "")}!");\n  });`).join("\n")}\n}\n`;
  return { id, files: { [MANIFEST_FILE]: `${JSON.stringify(manifest, null, 2)}\n`, "main.js": main.endsWith("\n") ? main : `${main}\n` } };
}
