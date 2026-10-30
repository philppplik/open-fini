# Extension SDK Reference

This is the developer reference for OpenFini extensions (API version 1): package layout, manifest fields, permissions, contribution points, the `openfini` API and a first-extension tutorial. The SDK lives in the repository's `sdk/` folder with typings, a JSON schema, scaffolding and packaging scripts and four examples.

## Package

A folder, or a `.ofext` file (a ZIP) with `openfini-extension.json` at the top level (or inside one wrapping folder):

```text
my-extension/
  openfini-extension.json   the manifest
  main.js                   entry script (optional if it only contributes data)
  panel/index.html          panel UI (local scripts, styles and images are inlined)
  skills/x/SKILL.md
  locales/en.json           optional translations
```

Limits: 500 files, 8 MB per file, 24 MB unpacked; paths are relative (`..`, absolute paths and drive letters are rejected).

## Manifest

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
| `version` | Semantic version |
| `engines.openfini` | Semver range (`>=0.3.0`, `^0.4.0`, `0.3.x`, `1.2 - 1.6`, `a || b`) |
| `main` | Entry script; required when commands, importers, exporters or Vibe tools run code |
| `icon` | A Bootstrap Icons name or a `.png`, `.svg` or `.webp` path |
| `activationEvents` | `onStartup`, `onStudio:<id>`, `onCommand:<id>`, `onFileType:<ext>`; most extensions need none |

## Permissions

| Permission | Allows |
| --- | --- |
| `document.read` | `document.info`, `pageInfo`, `readSelection`, `readLayers`, `listTools`, read-only tools and the document events |
| `document.write` | Every other document tool through `document.callTool` |
| `ui` | `ui.*` (messages, dialogs, forms, panels, status) and `studio.set` |
| `storage` | A private key-value store (256 KB per value, 200 keys, 1 MB) |
| `files` | `files.open` and `files.save`, always through the system dialog |
| `export` | `document.export`: render layers or pages to PNG, JPEG, WebP or SVG bytes |
| `vibe` | `vibe.registerTool`, `registerSkill`, `contributes.vibeTools` and `vibeSkills` |
| `commands` | Run any OpenFini command id; your own commands need nothing |
| `network:<origin>` | `network.fetch` to that origin (`https://host[:port]`, `https://*.host`, `http://localhost[:port]`) |

## Contribution points

`commands` (`{ id, title, category?, icon?, studios?, requires? }`, real commands with id `ext:<extension id>:<id>`), `menus` (menus `File Edit Layer Arrange Shape Select Filter Text Document View Insert Go Studio Help` or `context:canvas`, `context:code`, `context:explorer`, `context:layers`, `context:text`), `keybindings`, `panels`, `themes` (light and dark both required), `templates` (design recipes of tool calls, or website file maps), `importers` and `exporters`, `vibeTools`, `vibeSkills`, `settings` (boolean, string or number with title, default, enum, min, max) and `snippets` (CodeMirror snippet syntax). The full JSON Schema is [sdk/schema/openfini-extension.schema.json](https://github.com/philppplik/open-fini/blob/main/sdk/schema/openfini-extension.schema.json).

## API

`openfini` is a global inside the frame (and its panels). `main.js` may declare `async function activate(openfini)` and `deactivate()`. All methods return promises. Errors carry a `code` (`PERMISSION_DENIED`, `BAD_REQUEST`, `TIMEOUT`, `RATE_LIMITED`, `TOO_LARGE`, `QUOTA`, `NETWORK`, `OFFLINE` and others). Typings: [sdk/openfini.d.ts](https://github.com/philppplik/open-fini/blob/main/sdk/openfini.d.ts).

| API | Permission |
| --- | --- |
| `commands.register(id, fn)`, `commands.execute(id, args)` | none for own commands |
| `ui.showMessage`, `ui.confirm`, `ui.prompt`, `ui.form`, `ui.openPanel`, `ui.setStatus` | `ui` |
| `document.info()`, `pageInfo()`, `readSelection()`, `readLayers(opts)`, `listTools()` | `document.read` |
| `document.export({ format, scale, ids, page })` | `export` |
| `document.callTool(name, args)` | read tools `document.read`, others `document.write` |
| `studio.current()`, `studio.list()` | none (`studio.set` needs `ui`) |
| `storage.get`, `set`, `delete`, `keys`, `clear` | `storage` |
| `settings.get`, `getAll`, `onChange` | none |
| `network.fetch(url, options)` | `network:<origin>` |
| `files.open`, `files.save` | `files` |
| `events.on(name, fn)` with `documentChanged`, `selectionChanged` or `studioChanged` | document events need `document.read` |
| `vibe.registerTool`, `vibe.registerSkill` | `vibe` |
| `messages.post`, `messages.onMessage` | none |
| `log(...)` | none |

Panels get the same API plus the `--of-*` color variables, updated live with the theme.

## Tutorial: your first extension

1. Scaffold: `npm run ext:create -- acme.hello` (templates `--template command|panel|theme`).
2. Load it: *Studio ▸ Extensions…*, turn on **Developer mode**, *Load unpacked…*. Where the File System Access API exists (Chromium, desktop) OpenFini hot-reloads on every save.
3. Edit `main.js`:

```js
async function activate(openfini) {
  await openfini.commands.register("hello", async () => {
    const sel = await openfini.document.readSelection();        // document.read
    await openfini.ui.showMessage(`${sel.selection.length} layers selected`); // ui
  });
}
```

4. Add `"document.read"` and `"ui"` to `permissions` and declare the command under `contributes.commands`.
5. Change the document: `await openfini.document.callTool("add_shape", { type: "rect", x: 10, y: 10, w: 100, h: 60 })` (needs `document.write`; `document.listTools()` shows all tools).
6. Pack: `npm run ext:pack -- path/to/folder` creates `<id>-<version>.ofext`.

Examples in `sdk/examples/`: `grid-generator` (command with form, menus, shortcut, tool, skill), `instant-duotone` (Pixel command, settings, storage), `section-snippets` (snippets and a panel), `theme-pack` (two themes, no code).

## Translations

Any string in `name`, `description` and `contributes` may be a `%key%` placeholder resolved from `locales/<code>.json` in the package (exact tag, base language, `locales/en.json`, then the key).

## Honest limits

Panels reload when their tab is hidden and shown again. Hot reload needs the File System Access API. Extensions cannot read arbitrary files, run programs, or read the Code editor's cursor or selection. Background scripts run in a worker: they have no DOM (`window` is the worker's global scope) and are stopped when they stop answering for about 20 s. Keep long computations asynchronous or split them up. A runaway loop in a panel can only be stopped where the panel frame runs in its own process (Chromium-based builds).

## See also

- [[Extensions]]
- [[Bundled Extensions]]
- [[Extending OpenFini]]
- [[Skills Authoring]]
