# Roadmap and known gaps

OpenFini 0.1 is an honest foundation: the studios, engines and tooling are real and tested, but a
full professional suite is a very large surface. This page lists what is **missing or approximate today**
so you can decide whether OpenFini fits your work — and where contributions are most valuable.

## Color and image fidelity

- sRGB, 8 bits per channel only. No CMYK, ICC profiles, 16/32-bit or HDR editing, spot colors or overprint.
  PDF output is DeviceRGB.
- No RAW decoding. The **Develop** and **Tone Mapping** effects work on decoded 8-bit images.
- Selective Color and Color Balance use an RGB-based approximation, not true CMYK.

## Vector studio

- No live (non-destructive) compound shapes: boolean operations are destructive (undo restores).
- Missing: symbols, constraint-based artboards, shape builder, contour / offset tool, gradient mesh, hatch
  fills, pressure-sensitive vector strokes, vector brushes, path-on-text, text on shapes, clipping to text.
- SVG import ignores filters, masks, clip paths and patterns (reported as notes); SVG export flattens live
  effects it cannot express.

## Pixel studio

- Missing: smart / AI selection, refine-edge brush, patch tool, perspective and warp transforms of layers,
  channels, brush textures and dynamics, symmetry painting, macros / batch processing, frequency separation.
- Live adjustment and filter layers run in JavaScript on the viewport pixels (tens of milliseconds for simple
  adjustments, over 100 ms for heavy filters on large windows; half-resolution drafts while dragging).
  Moving them to a Web Worker / WebAssembly is the highest-impact performance task.
- Layers are single canvases: documents above roughly 50 megapixels per layer depend on the WebView's
  canvas memory. Tiled layer storage would lift this.

## Layout studio

- Tables are a **grid of cell objects**, not a real table model: no automatic row heights, merged cells or
  header repeat.
- No footnotes, indexes, cross references, books / sections or per-page numbering formats.
- The layout engine supports text wrap around shapes, baseline grids and exclusions, but there is no UI for
  them yet (the data model and engine are ready).
- No OpenType features (ligatures, small caps from the font, alternates), right-to-left or complex scripts.
  Hyphenation is US English only.
- PDF: standard fonts and embedded fonts. TrueType outlines are subset (unused glyph outlines removed, glyph ids
  kept); OpenType/CFF fonts are embedded whole. No PDF/X, no tagged PDF, no forms, no CMYK.
- Fonts: installed fonts display on screen, but PDF export can only **embed fonts you added through the
  Type panel** (*Add font file…*, one file per family — add bold and italic cuts as separate families).
  All other families fall back to the standard PDF fonts (Helvetica, Times, Courier). WOFF2 is not read.

## Code studio

- The visual designer edits **one page at a time**; there are no shared partials, symbols / components or CMS
  collections. Repeating a header on every page means repeating its markup (or generating pages in a build step
  outside OpenFini).
- No interactions / animation editor, no forms backend, no image optimization pipeline (images are copied as-is).
- The canvas draws a selection, hover, margin / padding guides and drop indicators; it does not (yet) offer resize
  handles, grid / flex visual overlays or element-level drag handles for spacing.
- Editor: syntax highlighting, completions and diagnostics come from CodeMirror's parsers — there is no language
  server, no type checking, no Git integration, no terminal, no extensions. Emmet covers the common subset of
  abbreviations (HTML structure, attributes, numbering, CSS shorthands), not filters or custom snippets.
- The preview resolves project files only: dynamic `import()` of computed paths and `fetch()` of project files do
  not work in it, and in the **desktop** app network requests from the preview are blocked by the Content-Security-Policy
  (the web version has no such limit). Scripts from CDNs are limited to jsDelivr, cdnjs and unpkg.
- Opening very large projects (thousands of files) is not optimized: the explorer lists everything and the
  document stores every file in memory.
- JavaScript source edits cannot be formatted automatically beyond re-indentation; minification of JavaScript is
  not part of the site export.

## File compatibility

- Reads and writes `.ofini`; imports SVG, PNG, JPEG, WebP, GIF, BMP, AVIF; exports PNG, JPEG, WebP, SVG, PDF.
- OpenFini deliberately does **not** read or write other applications' proprietary document formats (see
  [clean-room policy](clean-room.md)). Import of open formats such as PDF pages, PSD layers or IDML is
  welcome as a contribution if implemented from public specifications.

## Platform and distribution

- Desktop builds are **unsigned** until signing certificates are configured (see
  [release process](release-process.md)); there is no auto-update yet.
- Rust compilation, installer bundling and the Windows ARM64 / macOS Intel cross-builds are verified by CI on
  GitHub rather than on the maintainer's machine — please report packaging problems.
- Touch-first layouts for phones are not designed; tablets work in landscape.

## Accessibility and localization

- The canvas is pointer-driven; keyboard-only drawing and screen-reader descriptions of canvas objects are
  not implemented.
- The interface is US English only; strings are not yet extracted for translation.

## Ideas for later

Plugin API · scripting / macros · cloud-free sync via files · real-time collaboration · variable-font
axes · color-managed workflows · WebGPU acceleration as an *optional* fast path · more studios
(Photo-stacking, Animation).

## How to help

Pick any item above, open an issue to discuss the approach, and read [CONTRIBUTING.md](../CONTRIBUTING.md).
Small, well-tested pure modules under `app/src/engine/` are the easiest way to start.
