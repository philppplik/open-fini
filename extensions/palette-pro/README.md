# Palette Pro

Color palettes from your selection or an image, harmonies, a WCAG contrast checker with fix suggestions, and one-click
apply. Works in the Vector, Pixel and Layout studios. Not installed by default: *Studio ▸ Extensions… ▸ Available
extensions*.

**Permissions:** `document.read` (read colors of the selection), `document.write` (apply a palette, insert swatches),
`ui` (forms, messages, opening the panel), `files` (pick an image for the dominant-colors tool; the system dialog always
asks), `storage` (saved palettes, last source colors).

## What you get

- **Panel "Palette Pro"** (bottom dock). *Screenshot, described:* three stacked sections. "Source colors" has buttons
  *From selection* and *From image…* and a color picker, with a row of square swatches below. "Harmonies" has a type
  menu (complementary, split-complementary, triadic, tetradic, analogous, monochromatic), a row of swatches (click to
  copy the hex code), *Apply palette to selected layers* and *Save palette*. "Contrast checker" has two color pickers
  (text and background), a result box that shows the ratio, the WCAG level and pass/fail for normal and large text, and
  suggested replacement colors with a *Use* button.
- **Commands** (Studio ▸ Extension Commands, Vibe `run_extension_command`): *Open Panel*, *Palette from Selection*,
  *Insert Harmony Swatches…* (adds five squares to the page), *Check Contrast of Selection* (first two selected layers).

## How it works

- Colors are read from the fills and strokes of the selected layers (solid colors only; gradients are skipped).
- Dominant colors use median cut on a downscaled copy of the image (done inside the extension's sandbox frame).
- The contrast checker uses the WCAG 2.x formula. Fix suggestions move the lightness of the text color until the ratio is
  reached and offer the smallest change in each direction.
- *Apply palette* assigns the palette colors to the selected layers in a repeating cycle through `set_style`.

## Code layout

`src/lib.js` (pure, tested in `tests/extensions-bundled/palette-pro.test.js`, imports `extensions/_shared/color.js`),
`src/main.js` (commands), `src/panel.js` + `panel/` (UI). `npm run ext:pack-all` bundles them.

## Limits

Gradient and image fills have no single color. Strings are in one `STRINGS` object in `src/lib.js` for translation.
