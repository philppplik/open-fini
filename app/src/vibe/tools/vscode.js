// Vibe tools for VS Code extensions (docs/vscode-extensions.md): search Open VSX, install (the user always sees the
// consent dialog with the compatibility verdict), list installed ones and describe one's compatibility.
import { tool, S } from "./helpers.js";

export function vscodeTools(app) {
  const host = async () => {
    await app.extensionsReady;
    if (typeof app.vscodeHost !== "function") throw new Error("The extension system is not available (safe mode?).");
    return app.vscodeHost();
  };
  const consent = async (info) => (await import("../../ui/extensions/vscode-dialogs.js")).vscodeConsent(info);
  const describe = (e) => ({
    id: e.id,
    name: e.manifest.displayName,
    version: e.manifest.version,
    publisher: e.manifest.publisher,
    enabled: e.rec.enabled !== false,
    state: e.state,
    source: e.rec.source?.type === "openvsx" ? "Open VSX" : "local .vsix",
    compatibility: { level: e.compat.level, label: e.compat.label, reasons: e.compat.reasons, unsupportedApis: e.compat.apis, unsupportedContributions: e.compat.unsupportedContributions },
    themes: e.themes.map((t) => ({ id: t.id, label: t.label, mode: t.mode })),
    snippets: e.snippets.length,
    languages: e.languages.map((l) => l.id),
    commands: e.compat.runsCode ? e.manifest.contributes.commands.map((c) => ({ id: `vsx:${e.id}:${c.command}`, title: c.title })) : [],
  });

  return [
    tool("search_vscode_extensions", "Searches the Open VSX registry (open-vsx.org) for VS Code extensions. OpenFini can use color themes, snippets and language settings of any extension and runs the code of web extensions against a subset of the VS Code API; extensions that need Node.js only contribute their declarative parts. Returns name, publisher, version, downloads and rating.", {
      query: S.str("Search text, e.g. 'dracula theme' or 'react snippets'"),
      category: S.str("Optional category", { enum: ["Themes", "Snippets", "Programming Languages", "Formatters", "Linters", "Keymaps", "Other"] }),
    }, [], async (a) => {
      const h = await host();
      const r = await h.openVsx.search({ query: a.query || "", category: a.category || "", size: 15 });
      return { total: r.total, results: r.items.map((i) => ({ namespace: i.namespace, name: i.name, displayName: i.displayName, version: i.version, downloads: i.downloads, rating: i.rating, description: i.description })) };
    }, { needsApproval: (a) => `Search Open VSX (open-vsx.org) for “${a.query || a.category || "popular extensions"}”?` }),

    tool("install_vscode_extension", "Downloads a VS Code extension from Open VSX and installs it. The user sees a consent dialog with its compatibility (fully, partially or not supported), what it adds and what its code may do, and must confirm; you cannot approve for them.", {
      namespace: S.str("Publisher namespace from search_vscode_extensions"), name: S.str("Extension name from search_vscode_extensions"),
    }, ["namespace", "name"], async (a) => {
      const h = await host();
      const done = await h.installFromOpenVsx(a.namespace, a.name, consent);
      return done ? { installed: true, id: done.id, updated: done.updated, compatibility: done.compat.label, reasons: done.compat.reasons } : { installed: false, reason: "The user declined the installation." };
    }, { needsApproval: (a) => `Download the VS Code extension ${a.namespace}.${a.name} from Open VSX and show its install dialog?` }),

    tool("list_vscode_extensions", "Lists the installed VS Code extensions with their compatibility, themes (ids usable with the appearance tools), snippet counts, languages and runnable command ids.", {}, [], async () => {
      const h = await host();
      return { extensions: h.list().map(describe) };
    }, { readOnly: true }),

    tool("describe_vscode_extension", "Explains what of an installed VS Code extension works in OpenFini: the compatibility verdict, unsupported APIs and contributions, settings, providers it registered and recent log lines.", {
      id: S.str("Extension id (publisher.name) from list_vscode_extensions"),
    }, ["id"], async (a) => {
      const h = await host();
      const e = h.get(a.id);
      if (!e) throw new Error(`“${a.id}” is not installed. Call list_vscode_extensions.`);
      return { ...describe(e), settings: h.settingsOf(e), providers: [...new Set([...e.providers.values()].map((p) => p.kind))], log: e.logs.slice(-15).map((l) => `${l.level}: ${l.text}`) };
    }, { readOnly: true }),
  ];
}
