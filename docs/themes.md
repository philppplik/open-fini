# Themes, scrollbars and onboarding

## Using themes

*Settings ▸ Appearance* has two independent choices:

* **Mode**: dark, light or match the system (the `theme` preference).
* **Color theme**: a gallery of cards with a live mini-preview (the `themeId` preference). Arrow keys move between cards;
  the choice applies immediately, no reload. **Accent color** is an optional override: the first swatch means "use the
  theme's own accent".

Every theme has a light and a dark variant, so the mode switch always works. A theme changes surfaces, borders, text,
selection, the code editor (including syntax colors), Shoelace menus and dialogs, the canvas surround and Vibe Studio,
not only the accent. **High contrast** (a theme) and *Accessibility ▸ High contrast* (a switch that strengthens any
theme) are separate.

Built in: OpenFini (default), Slate, Mono, Midnight, Paper, Ocean, Forest, Sunset, Rose, Coffee, Solar, High contrast.

## Contrast guarantees

`resolveVars()` raises colors that would fail and `tests/ui/themes.test.js` verifies, for every theme, both modes and the
high-contrast treatment: text 4.5:1 (7:1 in high contrast) on every surface, dim text 4.5:1, faint text 3:1 (hints and
disabled text only), the accent 3:1 on surfaces, text on the accent 4.5:1 (also in its hover state), status colors 4.5:1,
text on a selected row 4.5:1, and the editor's syntax colors. Third-party themes get the same treatment at run time
(text, dim text, status and syntax colors are lifted to the thresholds; accents are not changed, so check yours).

## Registering a theme (extension authors)

```js
import { registerTheme, unregisterTheme } from "../ui/themes.js"; // inside an extension: use the host API

const unregister = registerTheme({
  id: "my-theme",            // a-z, 0-9, dashes (max 40)
  name: "My Theme",
  group: "My Extension",     // gallery heading
  description: "One sentence.",
  accent: { light: "#1d6aa5", dark: "#58b0f0" }, // optional shortcut for --of-accent
  light: { vars: { "--of-bg-app": "#f3f1ea", "--of-bg-panel": "#faf8f2", "--of-text": "#22201c" } },
  dark:  { vars: { "--of-bg-app": "#17161a", "--of-bg-panel": "#1f1e23", "--of-text": "#ecebf0" } },
});
// later: unregister(); or unregisterTheme("my-theme")
```

* Both `light` and `dark` are required. Variables you leave out fall back to the default theme's; derived ones
  (accent states, `--of-on-accent`, editor background, selection, Shoelace neutrals) are computed.
* Only `--of-*` and `--sl-*` custom properties with plain values are accepted (no `url()`, `;`, `{`, `}`).
  `validateTheme(def)` returns the problems without throwing.
* Registering an existing id throws unless you pass `{ replace: true }`; built-in themes cannot be replaced or removed.
  A saved theme that is not registered yet falls back to the default and is applied the moment it is registered.
* `listThemes()`, `getTheme(id)`, `onThemesChanged(fn)` and `applyTheme(id, mode)` are exported too.

### Variable reference

| Variable | Purpose |
| --- | --- |
| `--of-bg-app` `--of-bg-bar` `--of-bg-panel` `--of-bg-raised` `--of-bg-input` `--of-bg-canvas` | window, bars, panels and dialogs, raised surfaces, fields, pasteboard |
| `--of-border` `--of-border-soft` | field borders and strong separators, hairlines |
| `--of-text` `--of-text-dim` `--of-text-faint` | primary, secondary, hint text |
| `--of-accent` `--of-accent-strong` `--of-accent-soft` `--of-on-accent` | accent, its hover, a translucent tint, text drawn on it |
| `--of-danger` `--of-ok` | status colors (lifted to 4.5:1) |
| `--of-hover` `--of-active` `--of-shadow` `--of-selection` | overlays, elevation, selected text |
| `--of-editor-bg` `--of-editor-gutter` `--of-editor-line` `--of-editor-select` | code editor |
| `--of-syn-keyword` `string` `number` `comment` `function` `tag` `attr` `prop` `type` `op` `punct` `heading` `link` | syntax colors (prefix `--of-syn-`) |
| `--sl-color-neutral-*` | Shoelace neutrals (derived from the surfaces unless you set them) |

The full list with descriptions is `THEME_VARS` in `app/src/ui/themes.js`. In component CSS always use these variables
and `color-mix()` for tints; never hard-code colors.

## Scrollbars

`app/styles/themes.css` styles every scrollbar: thin, rounded thumb, transparent track, `--of-scroll-thumb`,
`-hover`, `-active` (accent while dragging), transparent corner, no arrow buttons. WebKit, Chromium and WebView2 use
`::-webkit-scrollbar`; Firefox gets `scrollbar-width: thin` and `scrollbar-color`. Shoelace scrollers inside shadow trees
(dialog body, select list, drawer, textarea, tab panel, details, dropdown panel) are reached with `::part()`. With
*High contrast* on, the bar is thicker with a visible track. Add the class `of-native-scroll` to an element to keep the
platform scrollbar. Not verified in Safari, where overlay scrollbars may take precedence.

## Onboarding and help

* **Invitations**: the first launch (and the first time a studio is opened with a document) shows a small card, never a
  modal: *Start the tour*, *Not now* or *Don't show tours*. Nothing appears for automation (`navigator.webdriver`) or with `?notour` in the URL.
* **Tours** (`app/src/ui/tour-steps.js` is the data, `tour.js` the engine): coach marks anchored to real UI, Next / Back /
  Skip / Don't show again, progress dots, arrow keys, Esc, focus kept in the popover and restored afterwards. Steps whose
  target is not on screen are skipped. Restart from *Help ▸ Take the Tour* / *Tour of This Studio* or Settings ▸ Onboarding and help.
* **Command palette**: `Ctrl/Cmd+K` or `F1` (inside the Code editor `F1` still opens the code palette). Lists the commands
  that can run right now, ranked by fuzzy match, recent use and the current studio. `Ctrl/Cmd+/` opens the shortcuts dialog.
* **What's this?** (`Shift+F1`): click anything to read what it does; `Esc` leaves the mode. Tooltips of tools, panels and
  studios show a one-line explanation (`app/src/ui/help-content.js`); *Settings ▸ Accessibility ▸ Show tooltips* turns them off.
* **What's new**: shown once after the version changes (`app/src/ui/whats-new.js`, written by hand per release).
* Everything respects *Reduce motion* and the other accessibility preferences.

Vibe tools: `list_themes`, `set_theme`, `start_tour`, `list_commands` (there is deliberately no tool that runs arbitrary commands).
