# Accessibility

OpenFini aims for an accessible interface: keyboard operation of the application chrome, visible focus, themes with verified contrast, reduced motion and high contrast options, and descriptions for the graphs it draws. The canvas itself is pointer driven, and this page is honest about that. It lists the settings, what is guaranteed by tests, and the known gaps.

## Settings

*Settings ▸ Accessibility* (see [[Settings Reference]]):

| Setting | Effect |
| --- | --- |
| High contrast | Strengthens any theme (text contrast of 7:1, thicker scrollbars with a visible track) |
| Reduce motion | Switches off the Vibe text shimmer and the glass background animation, and makes tours and effects calmer. Follows the system preference by default |
| Always-visible focus outlines | Keeps keyboard focus rings on |
| Tooltips | Turns the explanatory tooltips off or on |
| Interface scale | 80 to 160 percent; interface text size, density and font are in Appearance |

The **High contrast** theme is a separate color theme. Glass surface styles fall back to opaque panels with High contrast, `prefers-contrast: more` or `prefers-reduced-transparency: reduce` ([[Themes and Surface Styles]]).

## Verified by tests

- Every theme, both modes and the high-contrast treatment meet the contrast thresholds in [[Themes and Surface Styles]] (text 4.5:1, 7:1 in high contrast; accent 3:1 on surfaces).
- Glass styles keep text at 4.5:1 over worst-case backdrops.
- Pure modules that compute colors are unit tested.

## Keyboard

- The command palette (`Mod+K`) reaches any command; `F1` lists shortcuts; all shortcuts are rebindable ([[Customization and Profiles]]).
- Controls with fine adjustment accept keys: histogram graph (arrows, `Shift`, `Home`, `End`), Levels and Curves points, viewport resize handles and splitter in the Code studio, tour popovers (arrow keys, `Esc`), theme gallery (arrows).
- Tour popovers keep focus inside and restore it afterwards; the Office toolbar moves between buttons with the arrow keys.

## Screen readers

The histogram graph has `role="img"` and an `aria-label` describing the distribution in words, and a **Data** view as a table. Charts export SVG `<title>` and `<desc>` with your alt text or an automatic description; tables export their alt text; images accept alt text in Office and in the Code studio, whose pre-publish check flags images without it. Tool cards, approvals and chat status in Vibe are text.

## Known gaps

- The canvas is pointer driven: keyboard-only drawing and screen-reader descriptions of canvas objects are not implemented.
- PDF export has no tagged structure; alt text is SVG only.
- Touch-first phone layouts are not designed; tablets work in landscape.
- Right-to-left and complex scripts are not supported in the Layout text engine.
- No audit with assistive technology has been published; reports are welcome.

## Checking your own work

The bundled Accessibility Checker extension audits contrast, font size, alt text and reading order of a design, audits a website project, and writes a report ([[Bundled Extensions]]). The `check_problems` and contrast actions in Vibe can help as well.

## See also

- [[Themes and Surface Styles]]
- [[Settings Reference]]
- [[Bundled Extensions]]
- [[Roadmap and Known Limits]]
