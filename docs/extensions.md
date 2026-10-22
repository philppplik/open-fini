# Extensions

OpenFini can be extended with **extensions**: small add-ons that add commands, menu items, dock panels, color themes,
document and website templates, file importers and exporters, Code studio snippets, and tools and skills for the Vibe
assistant. They work in every studio and are written in plain JavaScript against a small, versioned API. The SDK lives
in the [`sdk/`](../sdk) folder of the repository (typings, JSON schema, scaffolding and packaging scripts, four working
examples).

> Extensions are new and the API is at version **1**. Additive changes keep the number; breaking changes will increase
> it and old extensions will say so when they load.

## For users

Five ready-made extensions ship with OpenFini but are not installed by default; see [bundled-extensions.md](bundled-extensions.md).

**VS Code extensions** (themes, snippets, language settings and web extensions from Open VSX or a `.vsix`) are installed
from the *VS Code extensions* tab of the same manager; see [vscode-extensions.md](vscode-extensions.md).

### Installing

*Studio ▸ Extensions…* (or *Settings ▸ Extensions*) opens the manager:

| Source | How |
| --- | --- |
| A `.ofext` file | *Install from file…*, or open/drop the file on OpenFini |
| A folder | *From folder…* |
| A link | *From URL…* (https only; `http://localhost` is accepted for development) |

Before anything is installed, a dialog shows the extension's name, publisher, version, what it adds and **every
permission it asks for**, with a plain-language explanation and a risk level. Nothing is installed without your
confirmation, and the Vibe assistant cannot confirm for you.

Updating works the same way. If a new version asks for additional permissions you are asked again; otherwise the
update keeps your settings and stored data.

### Managing

For every extension the manager shows its state (running, idle, disabled, stopped, invalid), an on/off switch,
**each permission with its own switch** (revoking takes effect immediately), what it contributes, its settings (if it
declares any), its source code (`main.js`) and a log. *Restart* restarts it. *Uninstall* removes it and its stored data.

*Settings ▸ Extensions* has two more switches: **Run extensions** (turn it off to start OpenFini in a safe state without
any extension) and **Developer mode**.

Where things appear:

- **Commands** show up in the menus the extension chose, in *Studio ▸ Extension Commands*, in the Code studio command
  palette (`Ctrl+Shift+P`), and may have a keyboard shortcut. Shortcuts that clash with existing ones are ignored and
  logged.
- **Panels** become tabs in the right dock of the studios they declare (*Sections* in the Code studio, for example).
  A panel is reloaded when you switch tabs, so panels keep their state in the extension's storage.
- **Themes** appear in the theme picker of *Settings ▸ Appearance*, each with a light and a dark variant.
- **Templates**, **importers** and **exporters** appear in the *File* menu (*New from …*, *Import with …*, *Export with …*).
  Importers also handle files of their type that you open or drop.
- **Snippets** appear in the Code studio's code completion.
- **Vibe tools** are listed in *Vibe Studio ▸ Tools* with their origin and **always ask for approval** (in every
  approval mode). **Skills** are listed in *Vibe Studio ▸ Skills* and in the chat `/` menu.

### Vibe

The assistant has four tools of its own: `list_extensions`, `run_extension_command`, `install_extension_from_url`
(shows you the permission dialog) and `create_extension`, which writes a small local extension from a description
(manifest and `main.js`), shows you its permissions and installs it after your confirmation. You can read the generated
code under *Source* in the manager.

### Offline mode

While offline mode is on (*Settings ▸ Security and privacy*), extensions cannot use the network at all
(`openfini.network.fetch` fails) and URL installs are refused.

## Security model

- **No extension code runs in the application.** Each extension runs in its own `<iframe sandbox="allow-scripts">`
  without `allow-same-origin`, so it has an opaque origin: it cannot read the app, its storage (IndexedDB, local
  storage, your API keys), cookies or other extensions. Scripts are delivered as `data:` URLs, exactly like the Code
  studio preview and custom Vibe tools; the host never uses `eval` or `new Function` on extension code.
- **The frame has its own Content-Security-Policy**: `connect-src 'none'`, no frames, no workers, no forms, images and
  fonts only from `data:`/`blob:`, scripts only from `data:`. So `fetch`, `XMLHttpRequest`, `WebSocket` and image
  beacons do not work from inside the sandbox; the only door is the RPC below, which enforces permissions.
- **All communication is a structured `postMessage` RPC** (`{ ofx: 1, t: "req", id, m, p }`). The host identifies the
  sender by `event.source`, validates the envelope, the method name and **every argument** (type, length, shape),
  measures the message (4 MB cap per request, 8 MB per result, JSON data and typed arrays only), applies a rate limit
  (burst 100, 60 calls/s sustained), a timeout (30 s; interactive dialogs 10 min) and checks the permission **before**
  the handler runs.
- **Capabilities.** A call without the granted permission is rejected with `PERMISSION_DENIED`. Network access is per
  origin (`network:https://api.example.com`, or `https://*.example.com`); the host fetches with no cookies, no redirects,
  a 5 MB response cap and a 30 s timeout, and refuses while offline mode is on.
- **Documents go through the Vibe tool layer.** `openfini.document.callTool` runs the same tools the assistant uses
  (validated against their schemas), read-only tools need `document.read`, all others `document.write`. Tools that use
  the network (image generation), the assistant's internals and the extension tools themselves are not available. Every
  extension command, import and tool call is folded into **one undo step**.
- **Limits and failure.** A frame that floods the host, sends oversized data, stops answering heartbeats (two in a row)
  or fails to start is stopped and logged; after three stops it is disabled. Everything is logged to the manager and to
  the app log (`extensions` scope; secrets are redacted by the log).
- **Validation.** The manifest is validated when it is installed **and again every time OpenFini loads it**; stored
  permissions are intersected with the manifest.
- **Themes** may only set `--of-*` and `--sl-*` CSS variables with plain values (no `url()`, no `@import`).

**Limits you should know about.** The sandbox cannot interrupt a script that loops forever on the UI thread: a
runaway synchronous loop in an extension can freeze the window until you reload it (the heartbeat then stops it).
Extensions are not signed or reviewed; there is no marketplace. A user who grants `document.write` has trusted the
extension with the content of the open document, and a user who grants a network origin has allowed data to be sent
there. The sandbox protects the app and your other data, not the document the extension is allowed to change.

## Package format

An extension is a folder, or a `.ofext` file (a ZIP) with `openfini-extension.json` at its top level (or inside one
wrapping folder):

```text
my-extension/
  openfini-extension.json   the manifest
  main.js                   entry script (optional if it only contributes data)
  panel/index.html          panel UI (any number of files; local scripts, styles and images are inlined)
  skills/…/SKILL.md
```

Limits: 500 files, 8 MB per file, 24 MB unpacked. Package paths are relative; `..`, absolute paths and drive letters are
rejected.

## Manifest reference

```json
{
  "id": "acme.grid-tools",
  "name": "Grid Tools",
  "version": "1.2.0",
  "description": "One sentence.",
  "engines": { "openfini": ">=0.3.0" },
  "main": "main.js",
  "activationEvents": ["onStudio:vector"],
  "permissions": ["document.write", "ui", "network:https://api.example.com"],
  "contributes": { "commands": [{ "id": "make", "title": "Make Grid…" }] }
}
```

| Field | Meaning |
| --- | --- |
| `id` | `publisher.name`: lowercase letters, digits and `-` |
| `version` | semantic version |
| `engines.openfini` | semver range of OpenFini versions (`>=0.3.0`, `^0.4.0`, `0.3.x`, `1.2 - 1.6`, `a \|\| b`) |
| `main` | entry script; required when commands, importers, exporters or Vibe tools run code |
| `icon` | a Bootstrap Icons name or a `.png`/`.svg`/`.webp` path |
| `activationEvents` | `onStartup`, `onStudio:<id>`, `onCommand:<id>`, `onFileType:<ext>`. Commands and importers add their own events, so most extensions need none; an extension that never activates costs nothing |
| `permissions` | see below |
| `contributes` | see below |

**Permissions**

| Permission | Allows |
| --- | --- |
| `document.read` | `document.info/pageInfo/readSelection/readLayers/listTools` and read-only tools; the `documentChanged` and `selectionChanged` events |
| `document.write` | every other document tool through `document.callTool` |
| `ui` | `ui.*` (messages, dialogs, forms, panels, status) and `studio.set` |
| `storage` | `storage.*`: a private key-value store (256 KB per value, 200 keys, 1 MB) |
| `files` | `files.open` / `files.save`: always through the system file dialog |
| `export` | `document.export`: render layers or pages to PNG, JPEG, WebP or SVG bytes |
| `vibe` | `vibe.registerTool` / `registerSkill` and `contributes.vibeTools` / `vibeSkills` |
| `commands` | run any OpenFini command id (`commands.execute`); your own commands need nothing |
| `network:<origin>` | `network.fetch` to that origin (`https://host[:port]`, `https://*.host`, or `http://localhost[:port]`) |

**Contribution points** (`contributes`):

- `commands`: `{ id, title, category?, icon?, studios?, requires?: "document" | "selection" }`. The handler is attached
  with `openfini.commands.register(id, fn)`. They are real OpenFini commands (id `ext:<extension id>:<id>`).
- `menus`: `{ menu, command, studios? }` with `menu` one of `File Edit Layer Arrange Shape Select Filter Text Document
  View Insert Go Studio Help` or `context:canvas`, `context:code`, `context:explorer`, `context:layers`, `context:text` (right-click menus, see context-menus.md).
- `keybindings`: `{ command, key: "Mod+Alt+G", studios? }`.
- `panels`: `{ id, title, html, icon?, studios?, location?: "top" | "bottom" }`. `html` is a file of the package.
- `themes`: `{ id, label, dark: {--of-…}, light: {--of-…} }`: both variants are required.
- `templates`: design templates `{ id, label, studio, width, height, steps: [{ tool, args }] }` (a recipe of Vibe tool
  calls) or website templates `{ kind: "website", files: { "index.html": "templates/index.html" } }`.
- `importers` / `exporters`: `{ id, title, extensions: ["gpl"], command }`. An importer's command receives
  `{ name, mime, size, data: Uint8Array }`; an exporter's command typically calls `files.save`.
- `vibeTools`: `{ name, description, inputSchema }`; handler via `openfini.vibe.registerTool(name, fn)`. Shown to the
  model as `ext_<publisher>_<name>_<tool>`.
- `vibeSkills`: `{ file: "skills/x/SKILL.md" }` or inline `{ name, description, body }`.
- `settings`: `{ properties: { key: { type: "boolean" | "string" | "number", title, default, enum?, min?, max? } } }`.
  Edited in the manager, read with `openfini.settings.get(key)`.
- `snippets`: `{ language: "html" | "css" | "javascript", label, detail?, body }` with CodeMirror snippet syntax
  (`${1:placeholder}`).

The full JSON Schema is [`sdk/schema/openfini-extension.schema.json`](../sdk/schema/openfini-extension.schema.json); every
validation error names the field and says how to fix it.

## API reference

`openfini` is a global inside the extension's frame (and its panels). `main.js` may declare
`async function activate(openfini) {…}`, called once when the extension activates, and `deactivate()`. All methods
return promises. Typings: [`sdk/openfini.d.ts`](../sdk/openfini.d.ts). Errors are `Error`s with a `code`
(`PERMISSION_DENIED`, `BAD_REQUEST`, `TIMEOUT`, `RATE_LIMITED`, `TOO_LARGE`, `QUOTA`, `NETWORK`, `OFFLINE`, …).

| API | Permission | Notes |
| --- | --- | --- |
| `commands.register(id, fn)` | none | the id must be declared in the manifest |
| `commands.execute(id, args)` | none for own commands, else `commands` | |
| `ui.showMessage(text, kind)` | `ui` | kind: `info` `success` `warning` `error` |
| `ui.confirm(text, {title, ok, cancel})` | `ui` | → boolean |
| `ui.prompt(label, {title, value, ok})` | `ui` | → string or `null` |
| `ui.form({title, description, ok, fields})` | `ui` | fields: `{name, label, type: text/number/boolean/select, default, min, max, options}` → values or `null` |
| `ui.openPanel(id)`, `ui.setStatus(text)` | `ui` | |
| `document.info() / pageInfo() / readSelection() / readLayers(opts)` | `document.read` | |
| `document.listTools()` | `document.read` | the tools you may call, with schemas |
| `document.export({format, scale, ids, page})` | `export` | image bytes of layers or a page, see [bundled-extensions.md](bundled-extensions.md#the-export-permission-and-documentexport) |
| `document.callTool(name, args)` | read tools: `document.read`; others: `document.write` | same tools as Vibe (`add_shape`, `add_text`, `set_style`, `apply_adjustment`, `insert_html`, …), undoable as one step |
| `studio.current() / list()` | none | `studio.set(id)` needs `ui` |
| `storage.get/set/delete/keys/clear` | `storage` | JSON values |
| `settings.get(key) / getAll() / onChange(fn)` | none | |
| `network.fetch(url, {method, headers, body, responseType})` | `network:<origin>` | → `{ ok, status, headers, text \| data }` |
| `files.open({extensions, multiple})` / `files.save({name, data, mime})` | `files` | system dialogs |
| `events.on("documentChanged" \| "selectionChanged" \| "studioChanged", fn)` | document events: `document.read` | returns an unsubscribe function; events are throttled |
| `vibe.registerTool(name \| def, fn)` / `vibe.registerSkill(def)` | `vibe` | |
| `messages.post(data)` / `messages.onMessage(fn)` | none | between the background script and panels of the same extension |
| `log(...)` | none | also `console.*`, shown in the manager log |

Panels get the same API, plus the OpenFini color variables (`--of-text`, `--of-bg-panel`, `--of-accent`, …) updated live
with the theme, and a few base styles for `button`, `input` and headings.

## Tutorial: your first extension

1. **Scaffold:** `npm run ext:create -- acme.hello` (or `node sdk/create-extension.mjs acme.hello`). Templates:
   `--template command|panel|theme`.
2. **Load it:** *Studio ▸ Extensions…*, turn on **Developer mode**, *Load unpacked…* and pick the folder. In browsers
   with the File System Access API (Chromium, the desktop app) OpenFini watches the folder and **hot-reloads** on every
   save; elsewhere, use *Restart* after re-loading. Unpacked extensions still show the permission dialog once.
3. **Edit `main.js`:**

   ```js
   async function activate(openfini) {
     await openfini.commands.register("hello", async () => {
       const sel = await openfini.document.readSelection();       // document.read
       await openfini.ui.showMessage(`${sel.selection.length} layers selected`); // ui
     });
   }
   ```

   Add `"document.read"` and `"ui"` to `permissions`, and declare the command in `contributes.commands`.
4. **Change the document:** `await openfini.document.callTool("add_shape", { type: "rect", x: 10, y: 10, w: 100, h: 60 })`
   (needs `document.write`). Run `await openfini.document.listTools()` to see all tools and their arguments.
5. **Give it a panel, a theme or a Vibe tool:** copy from the examples below.
6. **Pack and share:** `npm run ext:pack -- path/to/folder` creates `<id>-<version>.ofext`.

### Examples (`sdk/examples/`)

| Example | Shows |
| --- | --- |
| `grid-generator` | Vector/Layout command with a form, menu and context-menu entries, shortcut, a Vibe tool and a skill |
| `instant-duotone` | Pixel command, settings schema, storage, a gradient-map adjustment layer |
| `section-snippets` | Code studio snippets and a dock panel with its own HTML/CSS/JS |
| `theme-pack` | two themes with light and dark variants, no code |

Pack any of them and install it from the manager: `node sdk/pack.mjs sdk/examples/theme-pack`.

## Publishing and sharing

For now sharing is **by file or URL**: send the `.ofext` or host it anywhere over https and give people the link
(*Install from URL*, or ask the Vibe assistant to install it). There is no marketplace, no signing and no review process;
tell users what permissions to expect and keep them minimal. Keep `engines.openfini` accurate and bump `version` for every
release; installing a newer package with the same `id` updates the extension in place.

## Translating your extension

Any string in `name`, `description` and `contributes` may be a `%key%` placeholder. Put the texts in `locales/<code>.json`
inside the package (for example `locales/en.json` and `locales/de.json`, each `{ "key": "Text" }`). OpenFini resolves them when the
extension is loaded: exact language tag, base language, then `locales/en.json`, then the key itself. See [i18n.md](i18n.md).

## Honest limits

- A runaway synchronous loop in an extension can freeze the window (see the security model).
- Extension panels reload when their tab is hidden and shown again.
- Hot reload watches folders only where the File System Access API exists; the file is a snapshot elsewhere.
- Menu, panel and theme contributions need a running host; extensions do nothing while *Run extensions* is off.
- Extension tools can only use OpenFini's tools and the API above; they cannot read arbitrary files or run programs.
