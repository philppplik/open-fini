# Settings and the application menu

Click the **OpenFini** logo in the header (or press `Mod+,`) for the application menu: *About*, *Settings…*,
*Save All*, *Open Folder…*, *Keyboard Shortcuts*, *Documentation* and *Report an Issue…*.

*Settings…* opens one dialog for **every studio**: a sidebar of sections on the left, the open section on the right,
and a search box that filters sections and individual settings. Changes apply immediately and are stored on this
device (`localStorage`); *Security and privacy ▸ Reset all settings* restores the defaults.

| Section | What it controls |
| --- | --- |
| **General** | Restore the last session on start, autosave and its delay, ask before closing unsaved documents, *Save All*, *Open Folder…* |
| **Appearance** | Dark / light / system theme, accent color (7 presets), density (compact / default / spacious), interface scale (80–160 %) |
| **Accessibility** | High contrast, reduced motion (follows the system by default), always-visible focus outlines, tooltips on/off, interface scale |
| **Canvas and editing** | Rulers, clip content to the page, low-power mode, undo-history memory |
| **Code studio** | Tab size, word wrap, editor font size, format on save, run JavaScript in the website preview |
| **Artificial intelligence** | Master switch for AI features (off by default: nothing is sent anywhere and no AI menu items appear), shortcut to open Vibe Studio, and *Delete AI data* (chats, keys, skills, tools, MCP servers, memory, knowledge). Models, keys and permissions are managed inside [Vibe Studio](vibe-studio.md) |
| **Security and privacy** | Ask before opening external links, storage in use, clear recent files / autosaved session / added fonts, reset settings |
| **Keyboard shortcuts** | Every shortcut of the current command set |
| **About** | Version, license, source and documentation links |

## For developers

* Preferences live in `App.prefs` (`app/src/core/app.js`, `defaultPrefs()`); `setPref(key, value)` persists and emits
  `prefs`, `resetPrefs()` restores defaults.
* The dialog is data-driven (`settingsSections()` in `app/src/ui/settings-dialog.js`): add an item to a section and
  it appears, is searchable and is stored.
* Appearance and accessibility preferences are applied by `app/src/ui/appearance.js` (classes on `<html>`, CSS custom
  properties, `zoom` on `#app`); the corresponding CSS is at the end of `app/styles/app.css`.
