# Themes and Surface Styles

OpenFini has two independent look settings: a color theme (with light and dark variants and an accent color) and an optional surface style that changes how the interface chrome is drawn (Solid, Glass, Liquid glass, Sea glass). This page explains both, the contrast guarantees and how extension authors register themes.

## Color themes

*Settings ▸ Appearance* has a **Mode** (dark, light, or match the system) and a **color theme gallery** with a live mini-preview; arrow keys move between cards and the choice applies immediately. **Accent color** is an optional override (20 presets or any color); the first swatch means "use the theme's own accent".

Built in: OpenFini (default), Slate, Mono, Midnight, Paper, Ocean, Forest, Sunset, Rose, Coffee, Solar and High contrast. Every theme has a light and a dark variant. A theme changes surfaces, borders, text, selection, the code editor (including syntax colors), menus and dialogs, the canvas surround and Vibe Studio, not only the accent. The **High contrast** theme and the *Accessibility ▸ High contrast* switch (which strengthens any theme) are separate.

### Contrast guarantees

For every theme, both modes and the high-contrast treatment, tests verify text at 4.5:1 (7:1 in high contrast) on every surface, dim text 4.5:1, faint text 3:1 (hints and disabled text only), the accent 3:1 on surfaces, text on the accent 4.5:1, status colors 4.5:1, text on a selected row 4.5:1 and the editor's syntax colors. Third-party themes get the same treatment at run time (text, dim text, status and syntax colors are lifted to the thresholds; accents are not changed, so check yours).

## Surface styles (since 0.7)

*Settings ▸ Appearance ▸ Surface style*:

| Style | Look |
| --- | --- |
| Solid | The default, unchanged |
| Glass | Frosted glassmorphism |
| Liquid glass | Thicker bevels, a specular top edge, a soft sheen over controls on hover and press, larger corners |
| Sea glass | Muted green-teal tint, matte, light grain, slightly lower-contrast backdrop |

Each combines with every color theme and both modes. Controls: **Blur** (0 to 40 px), **Transparency** (0 to 50 percent), **Dim** (0 to 80 percent), **Slowly move the background**, and the background layer: Aurora, Ocean, Dusk, Sea glass, Mono, an accent-derived mesh, or **My image** (stored only as a blob on this device, downscaled to 1920 px, never in settings, profiles or exports).

The document canvas, artboards, color pickers, swatches and studio work areas (Code preview, Vibe, Office documents) stay opaque, so color accuracy is never affected.

### Automatic fallbacks

Opaque panels and no background are used automatically in low-power mode, with the High contrast preference or `prefers-contrast: more`, with `prefers-reduced-transparency: reduce`, and when the browser has no `backdrop-filter`. The animation stops with Reduce motion and in low-power mode. Settings shows why blur is off. Honest limit: blur and the saturation boost are not modeled by the contrast tests, and your own background image is bounded by a scrim, not analyzed.

## Scrollbars

Scrollbars are thin and themed (accent while dragging); High contrast makes them thicker with a visible track. Not verified in Safari, where overlay scrollbars may take precedence.

## Registering a theme (extension authors)

Both `light` and `dark` are required; only `--of-*` and `--sl-*` custom properties with plain values are accepted (no `url()`, `;`, `{` or `}`). Variables you omit fall back to the default theme; derived ones are computed. An optional `surface` is `"none"` (surface styles never apply), or a recommendation (`glass`, `liquid`, `sea`, `solid`) shown as a hint.

```js
registerTheme({
  id: "my-theme",            // a-z, 0-9, dashes (max 40)
  name: "My Theme",
  group: "My Extension",
  accent: { light: "#1d6aa5", dark: "#58b0f0" },
  light: { vars: { "--of-bg-app": "#f3f1ea", "--of-bg-panel": "#faf8f2", "--of-text": "#22201c" } },
  dark:  { vars: { "--of-bg-app": "#17161a", "--of-bg-panel": "#1f1e23", "--of-text": "#ecebf0" } },
});
```

Extensions declare themes in the manifest (`contributes.themes`, see [[Extension SDK Reference]]). Key variables: `--of-bg-app`, `--of-bg-panel`, `--of-border`, `--of-text`, `--of-text-dim`, `--of-accent`, `--of-on-accent`, `--of-danger`, `--of-ok`, the `--of-editor-*` set and the `--of-syn-*` syntax colors; the complete list is `THEME_VARS` in `app/src/ui/themes.js`.

## Vibe

`list_themes` and `set_theme` (theme, mode, accent and surface).

## See also

- [[Customization and Profiles]]
- [[Accessibility]]
- [[Settings Reference]]
- [[Performance and Low Power]]
