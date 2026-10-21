// Tools for OpenFini's extension system: list, run commands, install from a URL, scaffold a local extension.
// Installing always shows the user the permission dialog; the assistant can never consent on the user's behalf.
import { tool, S } from "./helpers.js";

export function extensionTools(app) {
  const host = async () => {
    await app.extensionsReady;
    if (!app.extensions) throw new Error("The extension system is not available.");
    return app.extensions;
  };
  const consent = async (info) => (await import("../../ui/extensions/dialogs.js")).consentDialog(info);

  return [
    tool("list_extensions", "Lists the installed OpenFini extensions with their id, version, state, granted permissions, commands and the Vibe tools they add.", {}, [], async () => {
      const h = await host();
      return {
        extensions: h.list().map((e) => ({
          id: e.id,
          name: e.name,
          version: e.manifest?.version,
          state: e.state,
          error: e.error || undefined,
          permissions: e.rec.granted,
          commands: (e.manifest?.contributes.commands || []).map((c) => ({ id: c.id, title: c.title, studios: c.studios })),
          vibeTools: h.vibeToolInfos().filter((t) => t.ext === e.id).map((t) => t.name),
        })),
      };
    }, { readOnly: true }),

    tool("run_extension_command", "Runs a command contributed by an installed extension (see list_extensions). Extension commands can change the document, so the user is asked first.", {
      extension: S.str("Extension id, e.g. acme.grid-tools"), command: S.str("Command id from list_extensions"), args: { type: "object", description: "Optional JSON arguments passed to the command handler" },
    }, ["extension", "command"], async (a) => {
      const h = await host();
      const ext = h.get(a.extension);
      if (!ext?.valid || ext.state === "disabled") throw new Error(`“${a.extension}” is not installed or not enabled. Call list_extensions.`);
      if (!ext.manifest.contributes.commands.some((c) => c.id === a.command)) throw new Error(`“${a.extension}” has no command “${a.command}”.`);
      await h.runCommand(a.extension, a.command, a.args);
      return { ok: true };
    }, { needsApproval: (a) => `Run the command “${a.command}” of the extension “${a.extension}”?` }),

    tool("install_extension_from_url", "Downloads an OpenFini extension package (.ofext, https only) and installs it. The user always sees the extension's permissions and must confirm in a dialog; you cannot approve for them.", {
      url: S.str("https address of the .ofext file"),
    }, ["url"], async (a) => {
      const h = await host();
      const done = await h.install(await h.fetchPackage(a.url), consent);
      return done ? { installed: true, id: done.id, updated: done.updated } : { installed: false, reason: "The user declined the installation." };
    }, { needsApproval: (a) => `Download an extension from ${a.url} and show its permissions for installation?` }),

    tool("create_extension", "Writes and installs a small local OpenFini extension from a description: a manifest and a main.js that registers the commands. main.js runs sandboxed; its global `openfini` object offers openfini.commands.register(id, fn), openfini.document.callTool(name, args) (the same tools you use), openfini.ui.showMessage/prompt/form, openfini.storage and more. Declare every permission it needs (document.read, document.write, ui, storage, …). The user reviews the permissions before it is installed.", {
      name: S.str("Human-readable name"), id: S.str("publisher.name id (optional, default local.<name>)", { pattern: "^[a-z0-9][a-z0-9-]{1,30}\\.[a-z0-9][a-z0-9-]{1,40}$" }),
      description: S.str("What the extension does"),
      permissions: { type: "array", items: { type: "string" }, description: "e.g. [\"document.read\", \"document.write\", \"ui\"]" },
      commands: { type: "array", description: "Commands to contribute", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, studios: { type: "array", items: { type: "string", enum: ["vector", "pixel", "layout", "code"] } } }, required: ["id", "title"] }, minItems: 1 },
      mainJs: S.str("Complete main.js: `async function activate(openfini) { await openfini.commands.register(\"id\", async (args) => { … }); }`"),
    }, ["name", "description", "commands", "mainJs"], async (a) => {
      const h = await host();
      const { buildScaffold } = await import("../../extensions/scaffold.js");
      const { permissionError } = await import("../../extensions/manifest.js");
      for (const p of a.permissions || []) {
        const e = permissionError(p);
        if (e) throw new Error(`permissions: ${e}`);
      }
      const s = buildScaffold({ ...a, hostVersion: h.hostVersion });
      const files = Object.fromEntries(Object.entries(s.files).map(([k, t]) => [k, new TextEncoder().encode(t)]));
      const done = await h.install({ files, source: { type: "assistant", name: a.name } }, consent);
      return done ? { installed: true, id: done.id, commands: a.commands.map((c) => c.id), note: "Run it from Studio ▸ Extension Commands or with run_extension_command." } : { installed: false, reason: "The user declined the installation." };
    }, { needsApproval: (a) => `Create and install the extension “${a.name}” (permissions: ${(a.permissions || []).join(", ") || "none"})? You will review its code and permissions next.` }),
  ];
}
