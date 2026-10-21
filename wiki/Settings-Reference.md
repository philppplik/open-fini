# Settings Reference

One dialog configures every studio. Click the OpenFini logo in the header or press `Mod+,`, then choose a section or use the search box, which filters sections and single settings. Changes apply immediately and are stored on this device; *Security and privacy ▸ Reset all settings* restores the defaults. This page lists the sections and what each controls.

## Application menu

The OpenFini logo opens the application menu: About, Settings, Save All, Open Folder, Keyboard Shortcuts, Documentation and Report an Issue.

## Sections

| Section | What it controls |
| --- | --- |
| General | Restore the last session on start; autosave and its delay; ask before closing unsaved documents; **save opened files in their original format when possible** ([[Save in Original Format]]); show recent files and how many to remember; language (Automatic, English (United States), Deutsch); how to make OpenFini the default for file types |
| Appearance | Mode, color theme gallery, surface style (Solid, Glass, Liquid glass, Sea glass) with blur, transparency, background and dim, accent color, density (compact, default, spacious), interface scale (80 to 160 percent), text size, font, corner radius, animation speed, canvas pointer size ([[Themes and Surface Styles]]) |
| Accessibility | High contrast, reduced motion (follows the system by default), always-visible focus outlines, tooltips on or off, interface scale ([[Accessibility]]) |
| Onboarding and help | Offer tours, hints in empty panels, restart the welcome or studio tour, reset tours and What's new, command palette tips |
| Canvas and editing | Rulers, clip content to the page, low-power mode, undo-history memory |
| Code studio | Tab size, word wrap, editor font size, format on save, run JavaScript in the website preview, Git author name and email |
| Artificial intelligence | Master switch (off by default), shortcut to open Vibe, *Delete AI data*; models, keys and permissions are managed inside [[Vibe Studio]] |
| Security and privacy | Security check, offline mode, app lock, protected mode, ask before opening links, privacy tools, integrity check, collaboration (leave room), reset settings ([[Security and Privacy]]) |
| Troubleshooting | Troubleshooting dialog, verbose logging, copy report, save bundle, report an issue, safe mode, reset app data ([[Troubleshooting and Logs]]) |
| Keyboard shortcuts | Rebind any command or tool; conflicts; presets; import and export |
| Toolbox and menus | Show, hide and reorder tools; hide menus and items; header quick actions |
| Layout and workspaces | Panels, dock side and width, built-in and saved workspaces |
| Defaults for new things | New-document size, unit, resolution and background per studio; export and text defaults |
| Profiles and backup | `.ofprofile` export and import, named profiles, reset everything |
| Studios | Choose and order the (at most five) studios shown in the header |
| Extensions | Run extensions, developer mode, the manager ([[Extensions]]) |
| Profile and collaboration | Nickname, presence color, picture, activity feed, cursors, notifications ([[Collaboration]]) |
| About | Version, license, source and documentation links, update checker (manual; optional daily check, off by default) |

The exact set of sections can grow; the dialog itself is data-driven, so new settings appear in it and in search automatically.

## Where settings are stored

In `localStorage` of the app profile on this device (key `openfini.prefs.v1`), except secrets, which use encrypted storage when the app lock or the Vibe key passphrase is on. Settings are not part of documents. Pop-out windows share preferences ([[Multi-Window]]).

## Preference keys worth knowing

| Key | Meaning |
| --- | --- |
| `theme`, `themeId` | Mode and color theme |
| `visibleStudios` | Header studios |
| `saveOriginalFormat` | Save in the original format |
| `language` | `auto` or a locale code |
| `surfaceStyle` | Surface style |
| `shortcuts`, `toolbox`, `menus`, `layout`, `workspaces`, `quickActions` | Customization data |
| `codeLayout` | Code studio split layout |
| `recentLimit`, `showRecent` | Recent files |

## For developers

Preferences live in `App.prefs` (`defaultPrefs()` in `app/src/core/app.js`); `setPref(key, value)` persists and emits `prefs`. The dialog is built by `settingsSections()` in `app/src/ui/settings-dialog.js`; portable settings are described by `app/src/customize/schema.js`. See [[Extending OpenFini]].

## See also

- [[Customization and Profiles]]
- [[Security and Privacy]]
- [[Themes and Surface Styles]]
- [[Keyboard Shortcuts]]
