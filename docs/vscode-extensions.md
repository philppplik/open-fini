# VS Code extensions

OpenFini can install **VS Code extensions** from [Open VSX](https://open-vsx.org) or from a local `.vsix` file and use
what of them can work outside VS Code: color themes, snippets, language settings and, for **web extensions**, their code
against a documented subset of the VS Code API. This page says honestly what works, what does not and why.

> VS Code extensions were written for VS Code: OpenFini runs only the declarative parts and a subset of the web
> extension API. Every extension gets a compatibility verdict before you install it.

## For users

*Studio ▸ Extensions… ▸ VS Code extensions*:

- **Open VSX** tab: search by name and category; each result shows name, publisher, version, downloads and rating. The
  details show license, categories, description, README (sanitized, no remote images), license text and a
  **compatibility badge** computed from the extension's manifest before you download anything.
- **Installed** tab: enable/disable, *Check for update* (Open VSX installs), *Uninstall*, the compatibility report,
  what it adds (themes with a *Use* button, snippets per language, languages, commands with *Run*, key bindings,
  providers), its settings (`contributes.configuration` as a form), allowed network origins, README, license, output
  channels and a log.
- **Install .vsix…**, drag a `.vsix` onto the tab, onto the window, or open it from the operating system (*Open with*).

Before anything is installed, a dialog shows publisher, source (Open VSX or local file), the compatibility verdict and
its reasons, what it adds, its activation events and what its code may do, plus an optional list of network origins.

### Compatibility verdicts

| Badge | Meaning |
| --- | --- |
| **Fully supported: declarative only** | Themes, snippets, language configuration and/or settings, no code. Everything it contributes works. |
| **Fully supported: web extension using the available API subset** | It has a `browser` entry and the scan found no API OpenFini lacks. |
| **Partially supported: web extension, uses unsupported APIs: …** | Its code runs; the listed APIs throw a clear error when called (also recorded at run time). |
| **Partially supported: contributions only …** | Its code needs Node.js (`main` only) or its web code is not bundled: only themes, snippets and language settings are used. |
| **Partially supported: declarative, without …** | It also contributes things OpenFini ignores (for example TextMate grammars or icon themes). |
| **Not supported: needs Node or native code** | Nothing it contributes can be used (language servers, debuggers, …). |

### Support matrix

| VS Code feature | In OpenFini |
| --- | --- |
| `contributes.themes` (color themes) | Converted to an OpenFini theme (Settings ▸ Appearance). Workbench colors map to `--of-*` variables, `tokenColors` to the editor's syntax colors; `include` chains are followed. VS Code themes have one variant: the other mode keeps OpenFini's surfaces and takes the accent and syntax colors. Illegible colors are raised to WCAG contrast (reported as "adjusted"). |
| `contributes.snippets` | Code studio completions (by VS Code language id). Syntax: `$1`, `${1:default}`, nested placeholders (flattened), `${1|a,b|}` (first choice), `$0`, variables (`TM_FILENAME`, `TM_SELECTED_TEXT`, `CURRENT_YEAR`, `UUID`, …). Regex transforms are ignored (the value is used unchanged). |
| `contributes.languages` + `language-configuration.json` | File extensions and file names map to the language id; for languages the Code studio has no mode for, comment tokens (Toggle Comment) and auto-closing pairs apply. |
| `contributes.grammars` (TextMate) | **Not used** (see [ADR 0012](adr/0012-vscode-extensions.md)): the Code studio keeps its CodeMirror highlighting. |
| `contributes.configuration` | A settings form per extension; `workspace.getConfiguration` reads it. |
| `contributes.commands` + `keybindings` | Web extensions only: real OpenFini commands in the Code studio (palette, shortcut editor). Single-step key bindings are used when they do not clash; multi-step chords and `when` clauses are not. |
| `iconThemes`, `productIconThemes`, views, webviews, debuggers, tasks, terminals, notebooks, SCM, authentication, language servers | Not supported. |

**The `vscode` API subset for web extensions**

| Namespace | Implemented |
| --- | --- |
| `commands` | `registerCommand`, `registerTextEditorCommand`, `executeCommand` (own commands; `editor.action.formatDocument`, `editor.action.commentLine`, `workbench.action.files.save`, `undo`, `redo` map to OpenFini), `getCommands` |
| `window` | `showInformationMessage/WarningMessage/ErrorMessage` (with buttons), `showInputBox`, `showQuickPick` (incl. `canPickMany`), `createOutputChannel` (shown in the manager), `setStatusBarMessage`, `createStatusBarItem`, `withProgress`, `activeTextEditor`, `visibleTextEditors`, `showTextDocument`, `onDidChangeActiveTextEditor`, `onDidChangeTextEditorSelection` |
| `TextEditor` / `TextDocument` | `document.getText/lineAt/offsetAt/positionAt/getWordRangeAtPosition/validateRange/lineCount/uri/languageId/version`, `selection(s)`, `edit(builder => replace/insert/delete)` (**one undo step**, refused when the document changed meanwhile), `insertSnippet` |
| `workspace` | `getConfiguration` (values as own properties, `get/has/inspect/update`), `onDidChangeConfiguration`, `textDocuments`, `openTextDocument`, `findFiles`, `applyEdit`, `fs.readFile/stat/readDirectory` (**read-only** project files), `workspaceFolders`, `getWorkspaceFolder`, `asRelativePath`, document events; `createFileSystemWatcher` is accepted but never fires |
| `languages` | `registerCompletionItemProvider`, `registerHoverProvider`, `registerDocumentFormattingEditProvider`, `registerDocumentRangeFormattingEditProvider`, `registerCodeActionsProvider` (*VS Code: Quick Fix…* in the palette), `createDiagnosticCollection` (stored, not displayed yet), `createLanguageStatusItem` (accepted, not shown), `match`, `getLanguages` |
| `env` | `appName`, `language`, `uiKind` (Web), `machineId`, `sessionId`, `clipboard.writeText`, `openExternal` (asks you first) |
| Classes | `Uri`, `Position`, `Range`, `Selection`, `TextEdit`, `WorkspaceEdit`, `SnippetString`, `MarkdownString`, `CompletionItem`, `CompletionList`, `Hover`, `Diagnostic`, `CodeAction`, `CodeActionKind`, `Disposable`, `EventEmitter`, `ThemeColor`, `ThemeIcon`, `CancellationTokenSource` and the common enums |
| `ExtensionContext` | `subscriptions`, `globalState`/`workspaceState` (stored per extension, 1 MB), `extensionUri`, `asAbsolutePath`, `storageUri`, `extension`; `secrets` is not available |
| `vscode.version` | `1.95.0` (the API level the subset follows) |

Anything else (`window.createWebviewPanel`, tree views, terminals, `debug`, `tasks`, `scm`, …) throws
`vscode.<api> is not supported in OpenFini …`; the access is recorded and shown in the compatibility report.

### Verified extensions

Tested in OpenFini (Chromium, October 2026), installed live from Open VSX:

- **Dracula theme** (`dracula-theme.theme-dracula`, declarative): both themes convert and apply; two colors per theme
  were raised for contrast.
- **Prettier - Code formatter** (`esbenp.prettier-vscode` 12.4, web extension, 4.9 MB bundle): activates, registers its
  formatters, and *Format Document* (Shift+Alt+F) formats JavaScript as one undo step. *Create Configuration File* needs
  `window.showOpenDialog` and fails with a clear message.
- **ES7+ React/Redux/React-Native snippets** (`dsznajder.es7-react-js-snippets`): its 700 snippets work; its web code is
  not bundled into one file and does not start (reported as "contributions only").

Plus three fixture extensions built by the tests (`tests/vscode/fixtures.js`: a theme pack, a snippets + language
extension and a web extension with a command, completion, hover and formatter), verified in the browser: theme switch,
snippet and provider completions, the upper-case command (one undo step), hover and formatting.

### Offline mode and privacy

Searching, details and downloads go to `open-vsx.org` only (no credentials, no referrer) and are refused while offline mode
is on. Open VSX answers with `Access-Control-Allow-Origin: *`, so this works from the PWA as well as the desktop app.
Installed extensions keep working offline. README images from the internet are not loaded.

## Legal

- **Open VSX, not the Visual Studio Marketplace.** The Marketplace Terms of Use say Marketplace offerings are "intended
  for use only with In-Scope Products and Services" (Microsoft's VS Code, Visual Studio, …) and may be installed and
  used only with those. OpenFini is not one of them, so it never contacts the Marketplace. Open VSX is an Eclipse
  Foundation registry whose terms allow any client; each extension carries its own license (shown before install).
- OpenFini does not redistribute any third-party extension; the repository's tests build their own tiny fixtures.
- Sources: [Visual Studio Marketplace Terms of Use](https://cdn.vsassets.io/v/M190_20210811.1/_content/Microsoft-Visual-Studio-Marketplace-Terms-of-Use.pdf),
  [Open VSX](https://open-vsx.org/about) and its [API](https://open-vsx.org/swagger-ui/index.html),
  [VS Code: Web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions),
  [VS Code: Extension manifest](https://code.visualstudio.com/api/references/extension-manifest).

## Security

- **No VS Code code runs in the app.** A web extension runs in its own `<iframe sandbox="allow-scripts">` (opaque origin)
  with the OpenFini extension CSP (`connect-src 'none'`, no workers, scripts only from `data:`). Its bundle is wrapped as a
  CommonJS module; `require` only knows `vscode`.
- **Calls are RPC** through `extensions/rpc.js`: method allow-list, argument validation, 4 MB/8 MB size caps, rate
  limit, timeouts (providers 1.5–8 s, commands 60 s, activation 10 s); a frame that stops answering two heartbeats is
  stopped.
- **Files**: only the open Code studio project, read-only; edits go only through the active editor or
  `workspace.applyEdit` to project text files, each as one undo step.
- **Network**: `fetch` inside the frame goes through the host and reaches only the origins you allowed in the consent
  dialog or the manager (empty by default), never while offline mode is on; no cookies, no redirects, 5 MB cap.
- **Packages**: ZIP check, 64 MB download cap, entry count, per-file and total size limits, compression-ratio check
  (zip bombs), path traversal rejected, and only the files OpenFini uses are decompressed (`main` Node code is never even
  unpacked). Manifests are validated on install and on every load. README Markdown is rendered through the repository's
  allowlist sanitizer. Logs go through `core/log.js` (redacted).
- **Limits**: like OpenFini extensions, a runaway synchronous loop in a frame can freeze the window until the heartbeat
  stops it. Extensions are not signed by OpenFini; Open VSX shows a "verified publisher" flag, which the details show.

## Architecture

```
ui/extensions/vscode.js ──► vscode/host.js ──► vscode/runtime-src.js (in the sandbox frame)
   (manager tab, dialogs)      │   │                ▲ RPC (extensions/sandbox.js + rpc.js)
                               │   └─ vscode/editor-bridge.js ──► ui/code/editor.js (app.editorContributions, app.codeFormatters)
pure: vscode/manifest.js · vsix.js · theme.js · snippets.js · openvsx.js · jsonc.js
```

### Where things live

| File | Role |
| --- | --- |
| `app/src/vscode/manifest.js` | package.json localization (`%key%` via package.nls*.json), normalization, compatibility verdict, API scan, language ids, selectors, key chords, language configuration |
| `app/src/vscode/vsix.js` | defensive, selective `.vsix` unpacking |
| `app/src/vscode/theme.js` | color theme conversion and contrast report |
| `app/src/vscode/snippets.js` | VS Code snippet syntax parser → CodeMirror templates, variables, snippet files |
| `app/src/vscode/openvsx.js` | Open VSX client (injected fetch and network policy) |
| `app/src/vscode/runtime-src.js` | the `vscode` API shim inside the frame |
| `app/src/vscode/host.js` | install/update/uninstall, contributions, frames, RPC handlers, providers |
| `app/src/vscode/editor-bridge.js` | completions, hover, language data, active editor tracking, formatter hook |
| `app/src/ui/extensions/vscode.js`, `vscode-dialogs.js` | manager tab, consent, message and quick pick dialogs |
| `app/src/vibe/tools/vscode.js` | Vibe tools |

Everything is lazy: `extensions/index.js` imports the host only when VS Code extensions are installed (checked with one
key-value read) or the tab is opened; `.vsix` files route through `app.installExtensionFile` and `commands/file.js`.

### How to extend the API coverage

1. Implement the member in `runtime-src.js` (inside the namespace object; the Proxy only catches missing names).
2. If it needs the app, add an RPC method: the name to `METHODS` in `host.js`, a validated handler in `#handlers`
   (use `v.*` validators; mark dialogs `interactive`).
3. Remove it from `KNOWN_UNSUPPORTED` in `manifest.js` so the scan stops flagging it.
4. Add a test in `tests/vscode/runtime.test.js` (the shim runs in a `vm` context against mock handlers) and update the
   tables above.

## Testing

`node --test tests/vscode/*.test.js`: manifest and compatibility, JSONC, snippet parser, theme conversion and contrast
repair, `.vsix` safety (traversal, entry count, sizes, zip bombs), Open VSX parsing with a fake fetch (credentials,
offline, size caps, redirects), the sandbox document, and the shim against a mock host (activation, one-step edits,
providers, configuration, unsupported APIs, network allow-list, value classes). `node tests/vscode/fixtures.js <dir>`
writes the fixture `.vsix` files for manual checks.

## Honest limits

- No TextMate grammars, icon themes, webviews, tree views, terminals, debuggers or language servers.
- Diagnostics from extensions are not displayed yet; decorations (`setDecorations`) are ignored.
- File watchers never fire; workspace files are read-only for extensions.
- Only one editor (the Code studio's active file) is visible to extensions.
