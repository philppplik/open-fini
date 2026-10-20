# Customization

OpenFini is customizable through one coherent system. Everything lives in `App.prefs` (stored in `localStorage` like all
settings), applies live, can be reset per setting, per section or all at once, and travels in a **profile**.
Open **Settings** (`Mod+,`) and look for the sections below. Hidden or removed things always stay reachable from the
command palette (`Ctrl+K`).

## Customization points

| Where | What you can change | Pref key(s) |
| --- | --- | --- |
| **Keyboard shortcuts** | Click a shortcut and press new keys for any command or tool; two shortcuts per command (tools: one key); conflict detection with *Swap*, *Unassign the other*, *Use for both* or *Cancel*; search, studio filter, "changed only", "conflicts only"; reset one or all; import / export a JSON keymap; presets **Default**, **Classic**, **Compact**, **Editor-style** (neutral layouts built from generic keys) | `shortcuts`, `shortcutPreset` |
| **Toolbox and menus** | Show / hide tools per studio, reorder by drag or arrow buttons, show a group's tools as separate buttons; hide whole menus or single menu items; choose and order the header's **quick actions** (Undo, Redo, theme, Export, panels, or any command that has an icon) | `toolbox`, `menus`, `quickActions` |
| **Layout and workspaces** | Show / hide panels per studio, dock side (left / right on wide windows) and width; built-in workspaces (*Essentials*, *Painting*, *Retouching*, *Typography*, *Minimal*, *Data*, *Focus*, depending on the studio) and your own saved ones; reset layout | `layout`, `workspaces` |
| **Appearance** | Mode, theme, accent, density, interface scale, **interface text size** (separate from scale), **interface font** (Inter, system, serif, monospace or a family name), **corner radius**, **animation speed**, **canvas pointer size** | `uiFontSize`, `uiFont`, `uiFontCustom`, `uiRadius`, `animSpeed`, `cursorSize` |
| **Canvas and editing** | Canvas background color, transparency checkerboard (light, dark, neutral, none) and square size, grid, guide and selection colors, rulers, low-power mode | `canvasBg`, `checker`, `checkerSize`, `gridColor`, `guideColor`, `selectionColor` |
| **Defaults for new things** | Default size, unit, resolution and background of new documents per studio; default export format, scale, quality and transparency; default text style (family, size, weight, line height, alignment) | `newDocDefaults`, `exportDefaults`, `textDefaults` |
| **Profiles and backup** | Export / import `.ofprofile` files with a preview, named profiles you switch between, reset everything | stored separately (see below) |

Every setting row shows a reset arrow once it differs from its default; every section has *Reset section to defaults*.

Honest limits:

* *Interface text size* scales the text of menus, panels, dialogs, tabs and the status bar. Icons and fixed-size
  controls follow *Interface scale* instead. The canvas zoom is separate from both.
* The pointer size only enlarges the arrow and the crosshair over the canvas; other tool cursors keep their size.
* Browsers and the operating system reserve some key combinations (for example `Ctrl+T`, `Ctrl+W` in a tab); the
  recorder cannot capture them. `Escape` cannot be bound on its own (it cancels recording).
* The dock side applies to windows wider than 960 px; narrow windows always use the sliding dock on the right.
* The default unit is the unit of new documents. Rulers always show pixels.
* A studio-specific command wins over a general command with the same shortcut inside its studio (for example Code
  `Mod+Shift+P` over *Place*). The shortcut editor does not flag that pair, but it does warn when you assign it yourself.

## How shortcuts resolve

The customization layer writes the *effective* shortcut onto each command (`command.shortcut` / `altShortcut`) and onto
each tool class, and keeps the originals (`command._def`, `Tool._defShortcut`). So menus, tooltips, the command
palette, the context bar and the key handler (`app/src/ui/shortcuts.js`) all show and use the user's bindings without
changes. Every tool also exists as a command `tool.select.<id>` ("Tool: Brush") so hidden tools stay reachable from
the palette. Overrides are `{ commandId: [chord, chord] }`; an empty list means "unassigned". Chords look like
`Mod+Shift+Z` (`Mod` = Ctrl, or Cmd on macOS), tool keys like `B` or `F2`.

## Profile format (`.ofprofile`)

```json
{
  "format": "openfini-profile",
  "version": 1,
  "name": "Work",
  "created": "2026-10-20T09:00:00.000Z",
  "app": "0.5.0",
  "settings": {
    "uiScale": 120,
    "uiFontSize": 15,
    "density": "compact",
    "shortcuts": { "edit.undo": ["Mod+Shift+U"] },
    "toolbox": { "pixel": { "hidden": ["eraser"] } },
    "layout": { "pixel": { "hidden": ["histogram"], "side": "left", "width": 360 } },
    "quickActions": ["undo", "redo", "export"]
  }
}
```

* `settings` holds only keys of the schema in `app/src/customize/schema.js`. **Never** included: API keys, tokens,
  passwords, the AI switch, app lock, offline mode, protected mode, Git identity, tour progress, recent commands,
  documents. A file that contains such a key (or anything that looks like a secret) is **rejected**.
* Import is strict (`validateProfile`): size limit 512 KB, valid JSON, format and version (newer versions are refused),
  every value checked against its type and range, `__proto__` keys refused, unknown non-secret keys ignored with a
  warning. Nothing is applied before you see the **preview** (setting, current value, new value) and choose
  **Merge** (only what the file mentions) or **Replace** (everything else returns to its default).
* Named profiles are stored in `localStorage` (`openfini.profiles.v1`). *Switch* saves the active profile first, then
  applies the other one with *Replace*. Templates: **Work**, **Presentation (big UI)**, **Low power**.

## Hooks for extensions and future studios

Available as `app.customize` (`app/src/customize/index.js`):

```js
// a control in Settings (types: switch, segmented, number, text, select, color); the key must be namespaced
const off = app.customize.registerSetting("my-extension", {
  key: "myext.compact", type: "switch", label: "Compact results", hint: "…", default: false,
});
// a command button at the end of a studio's toolbox
app.customize.registerToolboxEntry("vector", { id: "myext.run", label: "Run it", icon: "play", command: "ext:myext:run" });
```

Both return a function that removes the contribution. The section id is an existing section (`appearance`, `canvas`,
…, shown in an "Added by extensions" group) or a new one (it appears as its own section). Values live in
`app.prefs[key]` (read them with `app.prefs[key]`, write with `app.setPref`); they are not part of profiles.
**Keybindings** need no hook: register a command with `shortcut` (or declare `contributes.keybindings` in an extension
manifest, see [extensions.md](extensions.md)); it appears in the shortcut editor and can be rebound.
Pure logic (chords, keymap, schema, profiles, toolbox, workspaces, registry, canvas style) lives in
`app/src/customize/` with tests in `tests/customize/`; the UI in `app/src/ui/customize/` is loaded lazily.

## For the Vibe assistant

`get_settings`, `set_setting` (validated against the schema, the result lists the change), `list_shortcuts`,
`set_shortcut` (asks for approval) and `export_profile` (JSON text) let the assistant handle requests such as "make
the UI bigger and rebind undo". Security settings and secrets are not reachable through them.
