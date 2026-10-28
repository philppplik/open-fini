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

## Surface styles

An optional second axis next to the color theme: how the *chrome* is drawn. Settings ▸ Appearance ▸ **Surface style**:
**Solid** (default, the unchanged look), **Glass** (frosted glassmorphism), **Liquid glass** (thicker bevels, specular top
edge, a soft sheen sweeping over controls on hover/press, larger corners) and **Sea glass** (matte, softly grained, tinted by the accent,
slightly lower-contrast backdrop). Each combines with every color theme and both modes.

Controls: **Blur** (0-40 px), **Transparency** (0-50 %: how see-through the fill is), **Dim** (darkens the background
layer, 0-80 %), **Slowly move the background** and the **background layer**: Aurora, Ocean, Dusk, Sea glass, Mono, an
accent-derived mesh, or **My image** (file picker; stored only as a Blob in IndexedDB under `ui.glassImage`, downscaled to
1920 px plus a blurred 480 px copy; never in prefs, profiles or exports). Preferences: `surfaceStyle`, `glassBlur`,
`glassTransparency`, `glassBackdrop`, `glassDim`, `glassAnimate` (`null` blur/transparency = the style's default). They are
ordinary customization settings, so profiles carry them (except the image).

### Liquid glass refraction

Chromium-based engines (Chrome, Edge, WebView2 = the Windows desktop app) really bend what is behind a floating surface;
Settings > Appearance > Surface style > *Refraction* has four controls: **Refraction strength** (`glassRefraction`, 0-100 %,
0 = off), **Edge thickness** (`glassBevel`, 4-40 px), **Specular highlight** (`glassSpecular`, 0-100 %) and **Chromatic
dispersion** (`glassDispersion`, 0-100 %). The defaults (60 / 16 / 60 / 20) keep the previous Liquid highlight unchanged.

Technique (own code, no library; see [ADR 0015](adr/0015-liquid-glass-refraction.md)): the rim of a glass slab has a height
profile (a quarter sine over `bevel` px); its slope tilts the surface normal and a vertical ray bends by Snell's law (n = 1.5).
`ui/refraction.js` turns that into an RGBA **displacement map** of the rounded box (R/G = direction x strength, 128 = none),
drawn once per **size class** (sizes snap to a geometric ladder, maps are cached, longest side 256 px). `ui/refraction-dom.js`
(lazy, loaded only while Liquid is active) creates one inline SVG `<filter>` per surface (`feImage` map, then
`feDisplacementMap`; three of them with slightly different scales for dispersion, added with `feComposite arithmetic`) and sets
`--of-rf: url(#id) blur() saturate()` on the surface; glass.css uses `var(--of-rf, var(--of-glass-filter))` as its
backdrop-filter. A `ResizeObserver` (120 ms debounce) only rewrites the filter size; nothing runs per frame.

* **Targets:** dialogs, dropdown menus, context menus, command palette, top-level popovers, coach marks, toasts. Not the
  canvas, artboards, color pickers, the editor or the chrome layer: the header and docks sit on the single `.of-layout::before`
  layer (a second refracting layer there would nest backdrop-filters), so only floating surfaces refract.
* **Direction:** the shift points inward (the rim magnifies content from inside the box). A backdrop-filter has no pixels
  beyond its box, so outward samples would be transparent holes. Dispersion channels are added with `feComposite arithmetic`
  (`feBlend screen` shifts colors).
* **Contrast:** refraction only moves pixels the backdrop already contains, so the worst-case backdrops of `ui/glass.js` still
  bound every fill. With refraction on, menus and dialogs may be as see-through as the panels (`--of-glass-alpha-strong` is
  at least `--of-glass-alpha`, floor 0.72) but never more: the AA floor (`minAlpha`) and the lifted text colors are unchanged.
* **Fallbacks:** feature detection is `CSS.supports("backdrop-filter", "url(#x) blur(1px)")` plus a probe element whose
  computed `backdrop-filter` still contains `url(` plus a Chromium engine check (`urlBackdropSupported`). Safari/WebKit
  (including the macOS and Linux desktop shells) and Firefox get plain blur and the specular edge, and Settings says so.
  Low-power mode, High contrast, `prefers-reduced-transparency` and `prefers-contrast: more` switch it off like the blur.
* **Credits:** the idea (a displacement map from a rim height profile and Snell's law fed to `backdrop-filter: url()`, three
  channels for dispersion) follows [tomacco/amazing-glass](https://github.com/tomacco/amazing-glass) (MIT, (c) tomacco). No
  source is copied or vendored; see `THIRD_PARTY_NOTICES.md`.

### Sea glass tint

Sea glass takes its tint from the **active accent** by default (any theme, all accent presets, the custom accent, extension
themes), so it is not only turquoise. **Sea tint**: *Follow accent (default)* (`seaTint: "accent"`), *Teal (classic)*
(`"teal"`, the previous palette) or *Own hue* (`"custom"` plus `seaHue` 0-359). `ui/sea-glass.js` (pure) derives the palette in
HSL: hue from the accent (or `seaHue`), saturation 0.6 x the accent's, clamped to 28-52 % (a gray accent gives a nearly neutral
tint), fixed lightness per mode (tint 24 % dark / 72 % light, deep 14 / 42, highlight 88 / 97, caustic glow 72 / 80), and three
mesh lights at hue -12 / +14 / -4. It writes `--of-sea-tint/-deep/-hi/-glow/-grain/-m1..3/-b1..2`, used by glass.css for the
edge light, the "Sea glass" background layer, the soft **caustic** highlights (CSS radial gradients under the scrim; they drift
only with "Slowly move the background", never in Low-power mode or with Reduce motion) and the grain. The tint is a 26 % mix
into the panel color and goes through the same `minAlpha()` / `liftedText()` floors, so AA never depends on the hue
(`tests/ui/glass.test.js` sweeps every theme x mode x 20 accent presets x tint modes). The visual language (matte frosted
translucency, soft caustics, tinted depth, grain) is inspired by mweinbach/SeaGlass (Android, no license): design inspiration
only, no code used.

Vibe: `set_theme({ seaTint: "accent" | "teal" | "210", refraction: 0-100 })`.

### Architecture / where things live

| File | Role |
| --- | --- |
| `app/src/ui/glass.js` | **Pure** math and decisions: `blend`, `glassFill`, `stressBackdrops`, `liftedText`, `minAlpha`, `fxState`, `resolveGlass` (returns the `--of-glass-*` variables). Header comment lists the invariants. |
| `app/src/ui/sea-glass.js`, `app/src/ui/refraction.js` | Pure: sea palette from the accent; rim profile, displacement map, size classes, feature-detection decision. |
| `app/src/ui/refraction-dom.js` | Lazy: probe, one SVG filter per surface, observers. |
| `app/src/ui/glass-dom.js` | Writes variables and `data-surface` / `data-glass-fx` / `data-glass-bd` / `data-glass-anim` on `<html>`, owns `#of-backdrop` and the user image. Called from `appearance.js` after the theme. |
| `app/src/ui/surface-gallery.js` | The Settings block (cards, sliders, background choices). |
| `app/styles/glass.css` | All visuals; everything is scoped to `:root[data-surface]`, so solid is untouched. |
| `tests/ui/glass.test.js`, `tests/ui/themes.test.js` | Math, AA guarantees for every theme/mode/style, `surface` validation. |

How it renders: `#of-backdrop` (a fixed layer behind the app: a mesh gradient or image, plus a *scrim* of the theme's app
color, at least 60 %) is the "world" behind the glass. **One** backdrop-filter layer (`.of-layout::before`) blurs it for the
whole chrome; header, bars, docks and the status bar only paint translucent fills over it. The document canvas, the Pixel/Vector
artboards, color pickers and swatches, the studio work areas (Code preview, Vibe, Office documents) are opaque and sit above
that layer, so color accuracy is never affected. Floating surfaces (dialogs, menus, dropdown lists, command palette,
popovers, coach marks, toasts) blur once each, on their own box. Shoelace parts (`sl-dialog::part(panel)`, `sl-select::part(listbox)`,
`sl-alert::part(base)` ...) are styled with `::part()`; menus and dialogs use a higher-opacity fill (`--of-glass-alpha-strong`),
the code editor an even higher one (`--of-glass-alpha-editor`, never tinted).

### CSS variables (`--of-glass-*`, written on `<html>`)

| Variable | Meaning |
| --- | --- |
| `--of-glass-blur`, `--of-glass-sat` | blur radius and saturation boost of the backdrop-filter (`0px` / `1` when effects are off) |
| `--of-glass-alpha`, `--of-glass-alpha-strong`, `--of-glass-alpha-editor` | fill opacity of bars/docks, of menus/dialogs, of the editor |
| `--of-glass-tint`, `--of-glass-tint-amt` | sea glass tint color and mix percentage (`transparent`, `0%` for the others) |
| `--of-glass-scrim` | opacity of the app color drawn over the background layer (0.6-0.95) |
| `--of-glass-fill-bar/-app/-panel/-strong/-solid/-editor` | ready-made translucent fills (derived in glass.css) |
| `--of-glass-edge`, `--of-glass-hi`, `--of-glass-lo`, `--of-glass-shadow`, `--of-glass-grain` | 1 px light border, bevel highlight/shadow, elevation, grain image |
| `--of-glass-mesh-<id>` | the background presets (also used by the Settings previews) |

`--of-text`, `--of-text-dim` and `--of-text-faint` are *lifted* (moved towards white in dark mode, black in light mode) just far
enough while a glass style is active; they are written inline after the theme.

### Accessibility and performance

* **Contrast.** The fill opacity never goes below `minAlpha()`, and the text colors are lifted so that text and dim text are 4.5:1
  on every panel surface over the worst-case backdrops: white, black and the accent, after the 60 % scrim. The editor
  (text 4.5:1, syntax colors by their usual thresholds) is checked the same way. `tests/ui/glass.test.js` runs this for every
  theme, both modes and all three styles at the most transparent setting. Honest limit: blur and the saturation boost are not
  modeled (they only move colors between the tested extremes), and your own image is bounded by the scrim, not analysed.
* **Automatic fallbacks** (same tint, opaque panels, background hidden): Low-power mode (`app.perf.low`), the *High contrast*
  preference and `prefers-contrast: more`, `prefers-reduced-transparency: reduce`, no `backdrop-filter` support
  (`CSS.supports` and an `@supports` rule). Settings shows why blur is off. The animation stops with Reduce motion, in
  Low-power mode and when the surface is solid; the liquid sheen is a static highlight under Reduce motion.
* **Layer budget.** One chrome layer plus at most one floating surface at a time (a menu or dialog or the palette). The
  background mesh is a single composited layer; the animation only transforms it.

### Rules for contributors

1. **Never nest backdrop-filters.** A blurred surface must not contain another blurred surface (it would only blur its parent's
   own pixels and cost a lot). Inside a dialog, a menu, the palette or a coach mark use `--of-glass-fill-solid` and
   `backdrop-filter: none` (see the "no nesting" block in glass.css).
2. **Never blur rows.** Large scrolling lists (layers, files, history, chat) paint plain backgrounds; the list *container* is
   already on glass.
3. **Never glass the document.** Canvas, artboards, previews, color pickers/swatches and thumbnails stay opaque.
4. New chrome: use the `--of-glass-fill-*` variables (or leave the usual `--of-bg-*` background on an opaque work area); do not
   hard-code colors or write your own `backdrop-filter`.
5. Test a new surface in Glass, Liquid and Sea, light and dark, and with *High contrast* and *Low-power mode* on.

### Themes and extensions

`registerTheme({ ..., surface })` is optional and additive: `"none"` opts the theme out (surface styles never apply with it,
the Settings block says so), `"glass" | "liquid" | "sea" | "solid"` is a recommendation shown as a hint (it never overrides the
user's choice). `validateTheme` rejects other values.

Vibe: `set_theme({ surface })` and `list_themes` (field `surfaces`, `current.surface`).

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
