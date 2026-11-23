# VS Code extensions

OpenFini can install **VS Code extensions** from [Open VSX](https://open-vsx.org) or from a local `.vsix` file and use
what of them can work outside VS Code: color themes, snippets, syntax grammars, language settings and, for **web
extensions**, their code against a documented subset of the VS Code API, with their views as dockable panels, their
webviews in sandboxed frames and their status bar items in OpenFini's status bar. This page says honestly what works, what does not and why.

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
| **Partially supported: declarative, without …** | It also contributes things OpenFini ignores (for example icon themes). |
| **Not supported: needs Node or native code** | Nothing it contributes can be used (language servers, debuggers, …). |

### Support matrix

| VS Code feature | In OpenFini |
| --- | --- |
| `contributes.themes` (color themes) | Converted to an OpenFini theme (Settings ▸ Appearance). Workbench colors map to `--of-*` variables, `tokenColors` to the editor's syntax colors; `include` chains are followed. VS Code themes have one variant: the other mode keeps OpenFini's surfaces and takes the accent and syntax colors. Illegible colors are raised to WCAG contrast (reported as "adjusted"). |
| `contributes.snippets` | Code studio completions (by VS Code language id). Syntax: `$1`, `${1:default}`, nested placeholders (flattened), `${1|a,b|}` (first choice), `$0`, variables (`TM_FILENAME`, `TM_SELECTED_TEXT`, `CURRENT_YEAR`, `UUID`, …). Regex transforms are ignored (the value is used unchanged). |
| `contributes.languages` + `language-configuration.json` | File extensions and file names map to the language id; for languages the Code studio has no mode for, comment tokens (Toggle Comment) and auto-closing pairs apply. |
| `contributes.grammars` (TextMate) | Highlighting for languages the Code studio has no mode of its own for (`vscode/textmate.js`): JSON grammars with match, begin/end and begin/while rules, captures, back-references, `#repository`, `$self` and grammars of other installed extensions; Oniguruma syntax is translated where JavaScript has an equivalent and rules that cannot be translated are skipped. Injections and `.tmLanguage` (XML plist) files are not supported. The Code studio's own highlighting always wins (see [ADR 0012](adr/0012-vscode-extensions.md)). |
| `contributes.views` + `viewsContainers` | Web extensions only: each view is a **dockable panel** of the Code studio (drag, tab, float, Window menu, workspaces like every panel). Views of an activity bar container (and of VS Code's Explorer or Source Control) dock at the side, views of a panel container under the editor. Tree views render as native rows (chevrons, icons, descriptions, keyboard navigation, Refresh); webview views as sandboxed frames. Opening a view activates the extension (`onView:`). `when` clauses are not evaluated. |
| `contributes.configuration` | A settings form per extension; `workspace.getConfiguration` reads it. |
| `contributes.commands` + `keybindings` | Web extensions only: real OpenFini commands in the Code studio (palette, shortcut editor). Single-step key bindings are used when they do not clash; multi-step chords and `when` clauses are not. |
| `iconThemes`, `productIconThemes`, custom editors, debuggers, tasks, terminals, notebooks, SCM, authentication, language servers | Not supported. |

**The `vscode` API subset for web extensions**

| Namespace | Implemented |
| --- | --- |
| `commands` | `registerCommand`, `registerTextEditorCommand`, `executeCommand` (own commands; `editor.action.formatDocument`, `editor.action.commentLine`, `workbench.action.files.save`, `undo`, `redo` map to OpenFini; `<view id>.focus` reveals a contributed view; `setContext` is accepted), `getCommands`; tree items and status bar items may use `vscode.open` with a project file |
| `window` | `showInformationMessage/WarningMessage/ErrorMessage` (with buttons), `showInputBox`, `showQuickPick` (incl. `canPickMany`), `createQuickPick` and `createInputBox` (shown once with the items set by the next task; live filtering events and item buttons do not fire), `createOutputChannel` (shown in the manager), `setStatusBarMessage`, `createStatusBarItem` (**real items** in the status bar while the Code studio is open: text with `$(codicon)` icons, tooltip, click runs the command, left/right and priority, error and warning backgrounds), `withProgress`, `createTreeView` / `registerTreeDataProvider` (title, description, message, reveal, refresh through `onDidChangeTreeData`, selection and visibility events), `createWebviewPanel` and `registerWebviewViewProvider` (see Webviews below), `activeTextEditor`, `visibleTextEditors`, `showTextDocument`, `onDidChangeActiveTextEditor`, `onDidChangeTextEditorSelection` |
| `TextEditor` / `TextDocument` | `document.getText/lineAt/offsetAt/positionAt/getWordRangeAtPosition/validateRange/lineCount/uri/languageId/version`, `selection(s)`, `edit(builder => replace/insert/delete)` (**one undo step**, refused when the document changed meanwhile), `insertSnippet` |
| `workspace` | `getConfiguration` (values as own properties, `get/has/inspect/update`), `onDidChangeConfiguration`, `textDocuments`, `openTextDocument`, `findFiles`, `applyEdit`, `fs.readFile/stat/readDirectory` (**read-only** project files), `workspaceFolders`, `getWorkspaceFolder`, `asRelativePath`, document events; `createFileSystemWatcher` is accepted but never fires |
| `languages` | `registerCompletionItemProvider`, `registerHoverProvider`, `registerDocumentFormattingEditProvider`, `registerDocumentRangeFormattingEditProvider`, `registerCodeActionsProvider` (*VS Code: Quick Fix…* in the palette), `createDiagnosticCollection` (stored, not displayed yet), `createLanguageStatusItem` (accepted, not shown), `match`, `getLanguages` |
| `env` | `appName`, `language`, `uiKind` (Web), `machineId`, `sessionId`, `clipboard.writeText`, `openExternal` (asks you first) |
| Classes | `TreeItem`, `TreeItemCollapsibleState`, `QuickPickItemKind`, `QuickInputButtons`, `Uri`, `Position`, `Range`, `Selection`, `TextEdit`, `WorkspaceEdit`, `SnippetString`, `MarkdownString`, `CompletionItem`, `CompletionList`, `Hover`, `Diagnostic`, `CodeAction`, `CodeActionKind`, `Disposable`, `EventEmitter`, `ThemeColor`, `ThemeIcon`, `CancellationTokenSource` and the common enums |
| `ExtensionContext` | `subscriptions`, `globalState`/`workspaceState` (stored per extension, 1 MB), `extensionUri`, `asAbsolutePath`, `storageUri`, `extension`; `secrets` is not available |
| `vscode.version` | `1.95.0` (the API level the subset follows) |

Anything else (terminals, custom editors, file dialogs, `debug`, `tasks`, `scm`, …) throws
`vscode.<api> is not supported in OpenFini …`; the access is recorded and shown in the compatibility report.

### Webviews

`createWebviewPanel` opens a dockable panel in the Code studio (it appears and is revealed at once; `title` changes
rename it, `dispose()` removes it); `registerWebviewViewProvider` fills a contributed `"type": "webview"` view when its
panel is first shown. The HTML runs in its own `<iframe sandbox="allow-scripts allow-forms allow-modals">` (opaque origin)
built by `vscode/webview.js`:

- **No network.** The frame's policy allows images, fonts, styles and scripts only inline or from `data:`
  (`connect-src`, `frame-src`, `form-action 'none'`); the extension's own CSP `<meta>` applies on top.
- **Extension files** (`webview.asWebviewUri(Uri.joinPath(context.extensionUri, …))`) are inlined as `data:` URIs,
  stylesheets with their relative `url()` references; `webview.cspSource` is `data:`. Web extensions keep up to 24 MB of
  such assets (scripts, styles, images, fonts, wasm; never `node_modules`) when they are installed.
- **`acquireVsCodeApi()`** gives `postMessage`, `getState` and `setState`; messages in both directions are limited to
  1 MB and are queued until the frame has loaded. The state survives reloads of the frame while OpenFini runs.
- **Theme**: the `--vscode-*` color and font variables the common webview toolkits read are set from the OpenFini theme,
  and `<body>` gets `vscode-dark` or `vscode-light`. Links to `http(s)` pages ask before they open in the browser.
- Not supported: webview serializers (panels do not come back after a restart), `retainContextWhenHidden`, local
  resource roots outside the extension, and `enableCommandUris`.

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
- **Packages** (up to **512 MB**): the download is streamed and stops at 512 MB whatever its headers say (60 s without
  data aborts it). `vscode/zip-index.js` reads the central directory without decompressing anything and inflates only the
  files OpenFini uses, entry by entry in 16 KB chunks; an entry that produces more bytes than its header declares is
  stopped (forged headers, zip bombs). Limits: 50,000 entries, 32 MB per unpacked file, 96 MB of required files, 24 MB of
  webview assets (skipped, not refused, beyond that), compression ratio 400:1 for files over 1 MB, encrypted entries and
  unknown compression methods refused, path traversal rejected (`main` Node code is never even unpacked). Manifests are validated on install and on every load. README Markdown is rendered through the repository's
  allowlist sanitizer. Logs go through `core/log.js` (redacted).
- **Limits**: VS Code extensions still run in a frame (not in a worker like OpenFini background scripts), so a runaway
  synchronous loop can freeze the window in builds where the frame shares the app's thread until the heartbeat stops it. Extensions are not signed by OpenFini; Open VSX shows a "verified publisher" flag, which the details show.

## Architecture

```
ui/extensions/vscode.js ──► vscode/host.js ──► vscode/runtime-src.js (in the sandbox frame)
   (manager tab, dialogs)      │   │                ▲ RPC (extensions/sandbox.js + rpc.js)
                               │   └─ vscode/editor-bridge.js ──► ui/code/editor.js (app.editorContributions, app.codeFormatters)
   ├─ ui/extensions/vscode-views.js (tree rows and webview frames in dockable panels, registerPanel + STUDIOS.code)
   └─ app.statusItems ──► ui/statusbar.js
pure: vscode/manifest.js · vsix.js · zip-index.js · textmate.js · webview.js · codicons.js · theme.js · snippets.js · openvsx.js · jsonc.js
```

### Where things live

| File | Role |
| --- | --- |
| `app/src/vscode/manifest.js` | package.json localization (`%key%` via package.nls*.json), normalization, compatibility verdict, API scan, language ids, selectors, key chords, language configuration |
| `app/src/vscode/vsix.js` | defensive, selective `.vsix` unpacking |
| `app/src/vscode/zip-index.js` | central-directory ZIP reader with bounded, chunked inflating |
| `app/src/vscode/textmate.js` | TextMate grammars as CodeMirror stream parsers |
| `app/src/vscode/webview.js` | webview documents: policy, `acquireVsCodeApi`, inlined extension files, theme variables |
| `app/src/vscode/codicons.js` | codicon ids → icons of the vendored set |
| `app/src/ui/extensions/vscode-views.js` | tree views and webview frames inside dockable panels |
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
repair, `.vsix` safety (traversal, entry count, sizes, zip bombs, forged headers, web asset budget), views and view
containers, TextMate tokenizing (`textmate.test.js`), webview documents (`views.test.js`), streamed downloads, Open VSX parsing with a fake fetch (credentials,
offline, size caps, redirects), the sandbox document, and the shim against a mock host (activation, one-step edits,
providers, configuration, unsupported APIs, network allow-list, value classes, tree views, webview panels and views,
status bar items, quick pick and input box objects). `node tests/vscode/fixtures.js <dir>`
writes the fixture `.vsix` files for manual checks.

## Honest limits

- No icon themes, custom editors, terminals, debuggers or language servers; TextMate injections are ignored.
- `when` clauses (views, menus, key bindings) are not evaluated; context keys set with `setContext` are ignored.
- Closing a webview panel from the dock hides it; the extension is only told when it is disposed or the extension
  stops.
- Tree views have no inline action buttons, check boxes or drag and drop yet.
- Diagnostics from extensions are not displayed yet; decorations (`setDecorations`) are ignored.
- File watchers never fire; workspace files are read-only for extensions.
- Only one editor (the Code studio's active file) is visible to extensions.
