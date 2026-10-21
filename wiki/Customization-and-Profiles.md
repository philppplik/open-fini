# Customization and Profiles

Almost everything about how OpenFini looks and where things sit can be changed: shortcuts, the toolbox, menus, panels and workspaces, appearance, canvas colors and defaults for new documents. All of it lives in one preferences store, applies live, can be reset per setting, per section or all at once, and travels in a profile file. Open *Settings* with `Mod+,`.

## What you can change

| Where | What | Notes |
| --- | --- | --- |
| Keyboard shortcuts | Click a shortcut and press new keys for any command or tool | Two shortcuts per command (tools: one key); conflict handling with Swap, Unassign the other, Use for both or Cancel; search, studio filter, "changed only" and "conflicts only"; import and export a JSON keymap; presets Default, Classic, Compact, Editor-style |
| Toolbox and menus | Show, hide and reorder tools per studio; hide whole menus or single items; choose the header's quick actions | Hidden items stay reachable from the command palette |
| Layout and workspaces | Show or hide panels per studio, dock side and width, built-in and saved workspaces | Built-in workspaces include Essentials, Painting, Retouching, Typography, Minimal, Data and Focus (depending on the studio) |
| Appearance | Mode, theme, accent, density, interface scale, text size, font, corner radius, animation speed, canvas pointer size | See [[Themes and Surface Styles]] |
| Canvas and editing | Canvas background, transparency checkerboard, grid, guide and selection colors, rulers, low-power mode | |
| Defaults for new things | Size, unit, resolution and background of new documents per studio; default export format, scale and quality; default text style | |
| Profiles and backup | Export and import `.ofprofile` files, named profiles, reset everything | |

Every setting row shows a reset arrow once it differs from the default, and each section has *Reset section to defaults*.

## Shortcut details

- Chords look like `Mod+Shift+Z` (`Mod` is `Ctrl`, or `Cmd` on macOS); tool keys are single keys such as `B` or `F2`.
- `Escape` cannot be bound alone (it cancels recording). Browsers and the OS reserve some combinations (for example `Ctrl+T` and `Ctrl+W` in a tab); the recorder cannot capture them.
- Every tool also exists as a command `tool.select.<id>` ("Tool: Brush"), so hidden tools stay reachable.
- A studio-specific command wins over a general one with the same shortcut inside its studio (for example Code `Mod+Shift+P` over Place). The editor warns only when you assign such a pair yourself.
- The default list is on [[Keyboard Shortcuts]].

## Profiles

A profile is a small JSON file (`.ofprofile`):

```json
{
  "format": "openfini-profile",
  "version": 1,
  "name": "Work",
  "settings": {
    "uiScale": 120,
    "density": "compact",
    "shortcuts": { "edit.undo": ["Mod+Shift+U"] },
    "toolbox": { "pixel": { "hidden": ["eraser"] } }
  }
}
```

- **Never included:** API keys, tokens, passwords, the AI switch, app lock, offline mode, protected mode, Git identity, tour progress, recent commands, collaboration identity and rooms, and documents. A file containing such a key (or something that looks like a secret) is rejected.
- **Import is strict:** at most 512 KB, valid JSON, known format and version (newer versions refused), every value checked, `__proto__` keys refused, unknown non-secret keys ignored with a warning. Nothing is applied before you see a preview (setting, current value, new value) and choose **Merge** (only what the file mentions) or **Replace** (everything else returns to default).
- **Named profiles** are stored on this device; *Switch* saves the active profile first. Templates: Work, Presentation (big UI), Low power.

## Limits

Interface text size scales menus, panels and dialogs; icons and fixed controls follow interface scale. The pointer size enlarges only the arrow and crosshair over the canvas. The dock side applies to windows wider than 960 px. The default unit applies to new documents; rulers always show pixels.

## Vibe

`get_settings`, `set_setting` (validated), `list_shortcuts`, `set_shortcut` (asks) and `export_profile`. Security settings and secrets are not reachable.

## For extension authors

`app.customize.registerSetting(...)` adds a control to Settings and `registerToolboxEntry(...)` adds a toolbox button; keybindings need only a command with a `shortcut` or `contributes.keybindings` ([[Extension SDK Reference]]).

## See also

- [[Keyboard Shortcuts]]
- [[Settings Reference]]
- [[Themes and Surface Styles]]
- [[Accessibility]]
