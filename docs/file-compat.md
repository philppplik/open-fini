# File compatibility

OpenFini ships pure, dependency-free engines for a few third-party document formats. They live in
`app/src/engine/formats/` and follow the conventions in `engine-contracts.md` (no DOM, Canvas or ImageData;
Node 20+ and browsers; typed arrays).

```js
import { readPsd, writePsd, readIdml, parseXml, sniffFormat } from './engine/formats/index.js';
```

Everything was implemented clean-room from Adobe's published specifications and general knowledge of the formats.
No proprietary code was used.

## Summary

| Format | Read | Write | Notes |
| --- | --- | --- | --- |
| Photoshop PSD (version 1) | yes | yes (8-bit RGB) | layers, groups, masks, text content, composite |
| Photoshop PSB (version 2) | yes | no | 8-byte lengths, 4-byte RLE counts |
| InDesign IDML | yes | no | pages, shapes, text stories, swatches |
| InDesign INDD | no | no | proprietary binary format, no public specification |
| Affinity `.afdesign` `.afphoto` `.afpub` | no | no | proprietary, no public specification; detected by extension, the app explains how to export PSD / PDF / SVG and can open a plain PNG / JPEG preview if one is stored as an ordinary image stream |
| PDF, Illustrator AI (PDF compatible), EPS with PDF | yes (editable Layout document) | export only | through pdf.js in `core/import-pdf.js`, see [pdf-import.md](pdf-import.md) |
| Sketch `.sketch` | best effort | no | documented ZIP + JSON, `engine/formats/sketch.js`, verified with synthetic files |
| Figma `.fig`, Adobe XD `.xd` | no | no | proprietary; the app shows how to export PDF / SVG instead |

## `sniffFormat(bytes, name?)`

Returns `'psd' | 'psb' | 'idml' | 'ai' | 'indd' | 'afdesign' | 'afphoto' | 'afpub' | 'pdf' | 'svg' | 'unknown'`.

- `8BPS` header: `psd` (version 1) or `psb` (version 2).
- INDD GUID header `06 06 ED F5 D8 1D 46 E5 BD 31 EF E7 FE 74 B7 1D`: `indd`.
- `%PDF`: `ai` when the extension is `.ai` or the header mentions Adobe Illustrator, else `pdf`.
  `%!PS-Adobe` is `ai` only for `.ai` files or when it mentions Illustrator (plain EPS is `unknown`).
- ZIP (`PK`): `idml` when the extension is `.idml`, the first entry is the IDML mimetype, or `designmap.xml` is
  listed in the archive.
- Affinity files are detected by extension only.
- SVG: `.svg` extension, or an `<svg` element near the start of a text file.

## Photoshop (PSD / PSB)

### `readPsd(bytes, { maxPixels = 150e6, readComposite = true })`

Returns `{ width, height, depth, colorMode, version, layers, composite, warnings }`.

Supported:

- PSD and PSB; bit depths 1, 8, 16 and 32 (everything is converted to 8 bit; 32-bit float is clamped to 0..1 without
  tone mapping and produces a warning).
- Color modes RGB, grayscale, indexed, CMYK (simple formula `r = 255 * (1-c) * (1-k)`, no ICC), Lab (D50 to sRGB),
  bitmap. Multichannel and duotone are read as grayscale (first channel) with a warning.
- Channel compression: raw, RLE (PackBits per scanline), ZIP and ZIP with prediction (8/16/32-bit).
- Layer records, transparency channel (-1), user layer mask (-2, aligned to the layer bounds, default color applied,
  inversion applied; `mask.disabled` is set when the mask is switched off). Real/vector masks (-3, `vmsk`) are ignored.
- Additional layer information: `luni` (unicode name, preferred over the Pascal name), `lsct` / `lsdk` (groups),
  `iOpa` (fill opacity, multiplied into `opacity`), `lspf` (`locked`), `TySh` / `tySh` (text), `lyid`, `clbl`, `infx`,
  `knko` (read and skipped without effect), and the global `Lr16` / `Lr32` / `Layr` containers used by 16/32-bit files.
  Unknown blocks are skipped safely. Block padding of 1, 2 or 4 bytes is tolerated.
- Output layer order: bottom-to-top as stored, but group entries (`kind: 'group'`) are placed **before** their
  children. Children carry `parentIndex` (index into `layers`, or -1) and `groupDepth`.
- Blend modes: `normal multiply screen overlay darken lighten color-dodge color-burn hard-light soft-light difference
  exclusion hue saturation color luminosity pass-through` plus the Photoshop-only `dissolve linear-burn linear-dodge
  vivid-light linear-light pin-light hard-mix subtract divide darker-color lighter-color`. Hosts that only know CSS
  blend modes should fall back to `normal` for the extra names.
- Text layers (`kind: 'text'`): `text.content` (paragraph breaks become `\n`), best-effort `fontSize`
  (multiplied by the transform scale), `color` and the transform origin `x`/`y`. The stored raster is kept in `rgba`.
- The merged image becomes `composite` (RGBA). Its alpha is used only when the file declares a transparency channel
  for the merged data (negative layer count).

Not supported (reported as warnings, never rendered): adjustment layers and fill layers (`kind: 'adjustment'`, `rgba`
is `null`), smart objects (`kind: 'other'`, the stored raster is used), layer effects, vector masks, clipping masks
beyond the `clipping` flag, linked layers, ICC profiles, image resources, paths, guides.

### `writePsd({ width, height, layers, composite? }, { compress = 'rle' })`

Writes a version 1, 8-bit RGB PSD that round-trips through `readPsd`.

- Layers: `{ name, x, y, width, height, rgba, opacity, blend, visible, clipping, parentIndex, kind }`.
  `kind: 'group'` entries must precede their children and `parentIndex` must point to an earlier group entry.
- Groups are written with section dividers (`lsct`), names also as `luni` (non-ASCII characters are replaced by `?`
  in the legacy Pascal name), blend modes, opacity, visibility, clipping flag.
- Compression: `'rle'` (default) or `'raw'`. ZIP is not written.
- The merged composite is taken from `composite.data` (RGBA, canvas sized) or computed by plain source-over of the
  visible layers (blend modes, clipping and masks are ignored, group opacity is multiplied). It is stored with a
  transparency channel (negative layer count), so transparent canvases stay transparent.
- Layer masks, text layers, adjustment layers and effects are not written.
- Canvas up to 30000 x 30000, at most 32767 layer records (groups use two), otherwise it throws `Error`.

### Limits and robustness

- Canvas larger than `maxPixels` throws. A single layer or mask larger than `maxPixels` is skipped (`rgba: null`)
  with a warning.
- Decoded channel sizes are validated against the compressed data length before any allocation (raw needs the full
  data, PackBits expands at most 64:1, ZIP at most about 1100:1), so a tiny file cannot request a huge buffer.
- Truncated or corrupt input either throws `Error('...')` with a clear message (bad signature, header, record
  structure) or returns the layers that could be read plus entries in `warnings`. Only `Error` instances are thrown.

## InDesign (IDML)

### `readIdml(entries, opts?)`

`entries` is the unzipped package (`{ path: Uint8Array }`, for example from `unzipSync`). A zip as `Uint8Array` is
accepted too. Returns `{ name, pages, colors, warnings }`; `name` comes from `opts.name` (default `'Untitled'`).

- `designmap.xml` drives the package: `Resources/Graphic.xml`, `Resources/Styles.xml`, the `Spread` and `Story`
  parts are located through its `src` attributes (with the standard paths as fallback).
- Pages: `name`, `width`, `height`, `spread` (index), and `x`, `y` = the page position inside its spread, measured from
  the spread's top-left (facing pages: the right page has `x` = left page width).
- Items are assigned to the page that contains the center of their bounding box, otherwise to the page with the
  largest overlap. Items completely off every page (pasteboard) are dropped with a warning.
- Item geometry in px (1 pt = 1 px), relative to the page's top-left, with `ItemTransform` matrices of groups and
  items applied.
  - `rect`, `ellipse`, `image`, `text`: `x`, `y`, `width`, `height` describe the untransformed box; `rotation`
    (degrees, clockwise on a y-down canvas) must be applied around the box center. Skew is approximated.
  - `polygon`, `line`: `path` holds the final page coordinates (do not apply any rotation again). Points are
    `[x, y]` corner points, or `{ x, y, hx1, hy1, hx2, hy2 }` (incoming/outgoing handles, absolute) when a point has
    handles. Rectangles that are not axis-aligned 4-point rectangles and ovals that are not 4-point shapes become
    polygons.
  - `group`: bounding box of the children; transforms are already applied to the children.
  - `fill`, `stroke` (swatch references resolved to `#rrggbb`, `Swatch/None` becomes `null`), `strokeWidth`
    (default 1 when a stroke exists), `opacity` (0..1, only set when not 100%). Gradients use their first stop color.
  - `image`: `link` is the `LinkResourceURI`, or `embedded:<id>` for embedded images. Pixels are not decoded.
- Colors: RGB, CMYK (simple formula) and Lab swatches become `colors[name] = '#rrggbb'`. Tints and mixed inks are
  ignored. Black, Paper and Registration have defaults when the swatch file is missing.
- Stories: paragraphs and runs from `ParagraphStyleRange`, `CharacterStyleRange`, `Content` and `Br`. Style
  resolution order: paragraph style chain (`BasedOn`), paragraph range attributes, character style chain, character
  range attributes. Read: `PointSize` / `FontSize`, `AppliedFont`, `FontStyle` (weight and italic derived),
  `FillColor`, `Justification` (`align`). The default font size is 12.
- Frames linked through `PreviousTextFrame` / `NextTextFrame` share one story: the whole story goes into the first
  frame (the head of the chain); the other frames get empty paragraph lists and a warning is added.

Not supported: master spreads and master items, tables (skipped with a warning), anchored objects inside stories,
buttons and interactive objects, text wrap, columns, text on a path, effects, tints, gradients beyond the first stop,
page-level transforms with scale or rotation, bleed/slug, hyperlinks, footnotes, XML structure.

### `parseXml(text)`

A small tolerant XML parser (no DOMParser). Returns the root element as
`{ name, local, attrs, children, text }`: `name` is the qualified name, `local` the name without prefix, `children`
only the child elements, `text` the concatenated direct text. Handles quotes of both kinds, unquoted attributes,
standard and numeric entities (unknown ones stay literal), CDATA, comments, processing instructions, DOCTYPE with
an internal subset, a BOM, unclosed tags and stray close tags. Throws `Error` when there is no root element or the
nesting exceeds 1000 levels.

## PDF, Illustrator, Sketch and the import report

- **PDF / AI / EPS with PDF:** see [pdf-import.md](pdf-import.md). `sniffFormat` returns `pdf` or `ai`; `findPdfStart(bytes)` locates the `%PDF-` header inside AI and EPS wrappers (DOS EPS headers included).
- **Sketch:** `readSketch(zipBytes)` returns `{ pages: [{ name, artboards: [{ name, x, y, width, height, background, items }] }], images, warnings }`. Items are `group`, `rect`, `ellipse`, `path` (from the layer's points), `text` (first text style of the layer), `image`. Solid and linear / radial gradient fills, borders (width, position, dashes), corner radius, rotation, opacity and visibility are read. Not read: symbol instances, boolean operations (the shapes stay separate), shadows, blurs, pattern fills, text with several styles, flips, shared styles and text styles. Verified with synthetic files built from the public file format reference only.
- **Embedded preview scan (Affinity):** `findEmbeddedPreview(bytes)` looks for complete PNG (chunk CRCs checked) and JPEG streams by their public signatures and returns the largest. It does not parse or interpret the Affinity container; it finds nothing when the file stores its preview in a compressed or private form. Verified with synthetic files only.
- **Import report:** every importer fills an `ImportReport` (`core/import-report.js`) with *kept*, *flattened*, *dropped* and *note* entries; File ▸ Import Report… shows it for the active document and Vibe can read it with `get_import_report`.
- **Photoshop in the app:** text layers whose text content could be read become editable text frames (position and size from the file, font Inter; the original raster stays as a hidden layer), smart objects are imported as their flattened preview and reported, adjustment layers and layer effects are listed as not imported.

## Text and code files

Markdown (`.md`, `.markdown`, `.mdx`), LaTeX (`.tex`, `.latex`, `.bib`, `.sty`, `.cls`) and plain text formats (`.txt`, `.json`,
`.yaml`/`.yml`, `.xml`, `.csv`, `.tsv`, `.toml`, `.ini`, `.conf`, `.properties`, `.log`, `.ts`, `.tsx`, `.jsx`, `.js`, `.css`, `.html`) open in the Code studio as a one-file
project (File ▸ Open, drag and drop; folders keep their structure). SVG still opens as a vector document. Files that contain
NUL bytes are refused. See [frameworks.md](frameworks.md).

## Warnings

`warnings` is an array of US English sentences describing everything that was skipped, approximated or damaged. A
file that produces warnings is still returned; callers should show them to the user (for example "3 warnings") but
not fail the import. Hard failures (not a PSD, no `designmap.xml`) throw `Error` instead.

## Specification sources

- Adobe Photoshop File Formats Specification (PSD / PSB).
- Adobe InDesign IDML Specification and IDML Cookbook.
- Extensible Markup Language (XML) 1.0, W3C Recommendation (parser behavior).
- PackBits run-length encoding as described in Apple Technical Note TN1023 and the TIFF 6.0 specification.
- RFC 1950 / RFC 1951 (zlib / deflate) through the vendored `fflate`.
