# 0012: VS Code extensions from Open VSX: declarative parts plus a sandboxed web-extension API subset

Status: Accepted

## Context

Users asked to use VS Code extensions in OpenFini. A full VS Code extension host needs Node.js and the complete `vscode`
API (about 400 members); neither exists in a browser or a Tauri webview. Most extensions are Node-only (`main`), many
popular ones are purely declarative (themes, snippets), and a growing number ship a `browser` build (web extensions) that
runs in a worker against the browser-compatible part of the API. The Visual Studio Marketplace Terms of Use allow
Marketplace offerings only in Microsoft's in-scope products.

## Decision

- **Registry: Open VSX** (open-vsx.org, Eclipse Foundation) plus local `.vsix` files. The Marketplace is never contacted.
  Open VSX sends `Access-Control-Allow-Origin: *`, so the PWA can use it directly; no relay is needed.
- **Declarative contributions for every extension**: color themes become OpenFini themes (with the existing contrast
  repair), snippets become CodeMirror snippet completions (own parser for the VS Code syntax), language configurations
  feed CodeMirror language data, settings get a form.
- **Web extensions run in the existing sandbox** (one `allow-scripts` iframe, the same CSP and RPC limits as OpenFini
  extensions) against a documented `vscode` shim. Unknown members are caught by a Proxy, reported and throw a clear
  error. `main`-only extensions are never run.
- **An honest compatibility verdict** (full / partial / none) from the manifest, a heuristic API scan of the bundle and
  APIs recorded at run time, shown before install.
- **No TextMate engine in this release.** Vendoring `vscode-textmate` + `vscode-oniguruma` would add about 0.5 MB of wasm
  and 60 KB of JS (gzip about 250 KB), a second highlighting pipeline beside CodeMirror's Lezer parsers, and tokenization
  cost on every edit, for a studio whose languages (HTML, CSS, JS/TS, JSON, Markdown, YAML, TOML, LaTeX, XML) already
  highlight. Grammars are listed as "not used" in the report. Revisit if users need highlighting for other languages.

## Consequences

- Themes, snippets and a useful class of web extensions (formatters, completion and hover providers, text commands)
  work; Prettier's web build formats in the Code studio. Language servers, webviews, views and debuggers do not.
- The shim is a maintenance surface: new API members are added on demand (docs/vscode-extensions.md, "How to extend").
- The host and UI are lazy (about 25 KiB gzip), so users who never install a VS Code extension pay one key-value read.

## Update (November 2026): grammars, views and webviews

- **A small TextMate interpreter instead of the full engine.** `vscode/textmate.js` (about 4 KiB gzip) runs JSON grammars
  as CodeMirror stream parsers with JavaScript regular expressions, translating the common Oniguruma syntax and skipping
  rules it cannot express. It is used only for languages without a highlighter of the Code studio's own, so the decision
  above (no `vscode-textmate` + `vscode-oniguruma`, no second pipeline for the built-in languages) still holds.
- **Views are dockable panels** registered through the panel registry (`registerPanel` and the studio's panel list), the
  same API OpenFini extensions use, so they take part in docking, the Window menu and workspaces without special cases.
  Tree views render as native rows; webviews run in their own sandboxed frames with no network and extension files
  inlined as `data:` URIs.
- **Packages up to 512 MB** with a central-directory ZIP reader and bounded, chunked inflating, replacing the 64 MB cap.
