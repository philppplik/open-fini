# Batch Export & Rename

Export selected layers, the current page or all pages in several sizes and formats at once, with a file name template,
and rename many layers in one go. Works in the Vector, Pixel and Layout studios (design documents; website projects have
no image layers to export). Not installed by default: *Studio ▸ Extensions… ▸ Available extensions*.

**Permissions:** `document.read` (selection, pages), `document.write` (renaming through `set_style`), `export` (render
layers and pages to image data; added to the extension API for this extension), `files` (the single save dialog for the
result), `ui`.

## What you get

- **Panel "Batch Export"** (bottom dock). *Screenshot, described:* an "Export" menu (selected layers, current page, all
  pages), a *Sizes* group (1x, 2x, 3x, 0.5x), a *Formats* group (PNG, JPG, WebP, SVG), a file name field with the
  template `{name}@{scale}x`, a live list of the files that will be created, and *Export as ZIP…*. Below, a *Rename
  selected layers* section with Find, Replace, Prefix, Suffix, Case, number options and a live before/after preview.
- **Commands:** *Batch Export…* (File menu), *Batch Rename Layers…* (Layer menu), *Open Panel*.

## Naming

Template tokens: `{name}`, `{scale}`, `{format}`, `{index}`, `{page}`. Names are made file-safe, duplicates get `-2`,
`-3`, and SVG is exported once per target because it is resolution independent. Everything is saved as one ZIP (or as a
single file when only one is produced).

## Export details and limits

- Top-level layers are rendered on their own, cropped to their bounds. Layers nested in groups cannot be lifted out
  without breaking their transforms, so for those the page region is rendered (the API reports `isolated: false`).
- Raster exports are limited by the app (16384 px per side). JPG has no transparency (white background).
- Renaming is a find/replace (plain or regular expression), case conversion, prefix/suffix and numbering applied in that
  order; invalid regular expressions are ignored.

## Code layout

`src/lib.js` (names, templates, rename, ZIP writer and the API-driven runners; tested with a mock API in
`tests/extensions-bundled/batch-export.test.js`), `src/main.js`, `src/panel.js` + `panel/`.
