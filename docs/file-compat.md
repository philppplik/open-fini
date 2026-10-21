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
| Affinity `.af` `.afdesign` `.afphoto` `.afpub` | no | no | proprietary, no public specification; detected by extension, the app explains how to export PSD / PDF / SVG and can open a plain PNG / JPEG preview if one is stored as an ordinary image stream |
| PDF, Illustrator AI (PDF compatible), EPS with PDF | yes (editable Layout document) | export only | through pdf.js in `core/import-pdf.js`, see [pdf-import.md](pdf-import.md) |
| Sketch `.sketch` | best effort | no | documented ZIP + JSON, `engine/formats/sketch.js`, verified with synthetic files |
| Figma `.fig`, Adobe XD `.xd` | no | no | proprietary; the app shows how to export PDF / SVG instead |
| Word DOCX, OpenDocument ODT, RTF | yes (Office Studio) | yes | `engine/office/`, clean-room from ECMA-376, ISO/IEC 26300 and the RTF 1.9 specification; see [office-studio.md](office-studio.md) for the fidelity matrix |
| HTML, Markdown, plain text as documents | yes (in the Office Studio) | yes | outside the Office Studio these still open in the Code studio |
| Word 97-2003 `.doc`, Apple `.pages`, Google Docs `.gdoc` | no | no | detected; the app explains how to save or download a `.docx` (Google Docs: button opens the document in the browser) |
| Excel / Calc / Numbers, PowerPoint / Impress / Keynote | not yet | no | detected and explained ("not supported yet in Office Studio"); CSV opens as a table in Layout (Table ▸ Import Table) |
| TIFF `.tif` `.tiff` | yes (pages as layers) | no | LZW / PackBits / Deflate, 1 to 16 bit, see below |
| Animated GIF | yes (frames as layers) | no | no timeline yet |
| OpenRaster `.ora` | yes (layers, groups, blend modes) | yes (plain pixel layers) | File > Quick Export > OpenRaster |
| Krita `.kra`, GIMP `.xcf` | flattened image (KRA) / export route (XCF) | no | see the research doc |
| ICO / CUR | largest image | no | |
| EPS | PDF inside, or the TIFF preview of a DOS EPS (flattened) | no | OpenFini never runs PostScript |
| Palettes `.gpl` `.ase` `.aco` | yes (document swatches) | yes | File > Swatches |
| Fonts WOFF, TTC | yes (Type panel) | no | WOFF2 works on screen only, no PDF embedding |

## Raster, palette and font formats (0.5.0)

The research behind each verdict is in [file-format-research.md](file-format-research.md). All engines below are
pure (no DOM), lazy loaded, bounds checked and tested with synthetic files in `tests/formats/` (the fixtures are
written by independent writers in the tests, not by the readers).

| Module | API | Notes |
| --- | --- | --- |
| `tiff.js` | `readTiff(bytes, { maxPixels, maxPages })` -> `{ pages: [{ width, height, rgba, name }], warnings }` | TIFF 6.0, II and MM, IFD chain (loop safe), strips and tiles, compression none / LZW / PackBits / Deflate, predictor 2, 1/2/4/8/16 bit gray and palette, RGB, RGBA, CMYK (naive). Reduced-resolution subfiles are skipped. Errors for BigTIFF, JPEG, planar, YCbCr, Lab. |
| `gif.js` | `readGif(bytes, { maxFrames, maxPixels })` -> `{ width, height, loops, frames: [{ rgba, delay, name }] }` | GIF87a / 89a, interlace, transparency, disposal methods 0 to 3, composited full-canvas frames. A still GIF falls back to the normal image path. |
| `ora.js` | `readOra(bytes)`, `writeOra({ width, height, layers, mergedPng })` | Layers and stacks (groups), opacity, visibility, offsets, `svg:*` composite ops. PNG data stays bytes; the host decodes. Paths cannot escape the archive. |
| `kra.js` | `readKraMerged(bytes)` | Krita: only the flattened `mergedimage.png` / `preview.png`. |
| `ico.js` | `readIco(bytes)` | PNG or BMP entries, largest first. |
| `palette.js` | `readGpl/writeGpl`, `readAse/writeAse`, `readAco/writeAco`, `readHexList`, `readPalette` | RGB, CMYK, Lab, HSB and gray swatches become `#rrggbb` (naive CMYK, no ICC). Writers produce RGB. At most 4096 colors per file. |
| `fontwrap.js` | `unwrapFont(bytes)`, `woffToSfnt`, `ttcFonts`, `fontContainer` | WOFF to sfnt, TTC to standalone fonts; WOFF2 is passed through (not decoded). |
| `embedded.js` | `dosEpsParts(bytes)` | Byte ranges of a DOS EPS binary header (PostScript, WMF, TIFF preview). |

Where it is wired: `core/import-raster.js` builds Pixel documents (TIFF pages and GIF frames become layers, the
first visible), writes the import report, adds palette colors to `doc.swatches` and writes ORA; routing is one block in
`commands/file.js openFile`; commands in `commands/formats.js` (File > Swatches, Quick Export > OpenRaster);
file types in `platform/file-types.js` (and the packaging lists, kept consistent by `tests/packaging`).

Fidelity statements shown in the import report: TIFF DPI and ICC profile are ignored and 16-bit data is reduced to 8
bit; GIF frames are layers without a timeline; Krita files open flattened; ICO opens only the largest size; an EPS with
a TIFF preview opens as a flattened low-resolution "preview only" document.

How to extend: add a pure reader under `engine/formats/`, export it from `index.js`, add a loader in
`core/import-raster.js` (plus the extension in `RASTER_FORMAT_EXT`, the routing block in `commands/file.js`,
`OPEN_FILTERS` in `core/io.js`, a `FILE_TYPES` row and the packaging lists), a verdict in
`platform/format-verdicts.js`, and tests with a fixture writer.

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

## Saving back to the original format

File ▸ Save (Ctrl+S) writes a file you opened with File ▸ Open in the format it came from: a `.txt` stays a `.txt`, a `.docx`
stays a `.docx`. Only when your edits need more than that format can hold does the document become an `.ofini`. Turn the
behavior off in Settings ▸ General ▸ *Save opened files in their original format when possible* (off: Save always writes `.ofini`).

| Opened as | Saved back as | Stays that way while | When it no longer fits |
| --- | --- | --- | --- |
| Text and code files (`.txt`, `.md`, `.json`, `.csv`, `.css`, `.js`, `.html`, `.tex` ...) | the same file, UTF-8 | the project is still exactly that one file (no second file, no design pages, no attached images, no Git repository, not renamed) | one dialog |
| Word processor and text files opened in the Office studio (`.docx`, `.odt`, `.rtf`, `.html`, `.md`, `.txt`) | the same format, written by the Office writers | always. After saving, a toast lists what the format cannot store (for example "Formatting is not stored in plain text") and offers *Save as .ofini* | not applicable |
| SVG | SVG through the SVG exporter | the document is a single-page, plain vector drawing (no pixel layers, adjustment layers, masks, live effects, blend modes, master pages) | one dialog |
| PNG, JPEG, WebP, GIF, TIFF ..., PSD, PDF, IDML, Illustrator, Sketch ... | never silently: Save writes `.ofini` | not applicable: writing the flat file back would destroy layers or data | Save As offers PNG, JPEG or WebP as a flattened export next to `.ofini` |

Templates and macro-enabled Word files (`.dotx`, `.docm`) are not written back by a plain document, and neither are files
the Office studio can only read through a guidance dialog.

**The dialog.** When a document that had a source format outgrows it, the next Save shows exactly one dialog: *This document now
has features that {format} cannot hold.* with *Save as .ofini (keeps everything)*, *Save a copy as {format} (flattened)* and
*Cancel*. Choosing `.ofini` is remembered for that document (it is an `.ofini` document from then on and the tab shows the
`.ofini` name); a copy leaves the document and its source untouched, so Save asks again.

**What is written.**
- Text keeps its encoding details: UTF-8 without BOM unless the original had one, and the original line endings (LF, CRLF or
  CR). A file you did not change is written back **byte for byte** (even if it was not valid UTF-8); after an edit a file with
  mixed line endings is written with LF.
- Desktop: Save writes to the original path without a dialog. Browsers with the File System Access API (Chromium) keep the
  file handle from File ▸ Open and write to the same file after a permission check; other browsers open the save dialog (or
  download) with the original file name. Save As lists the source format first and `.ofini` as the alternative; the file type
  you pick decides what is written.
- The tab shows the file name with its extension, the status bar shows a badge with the save target (`.txt`, `.docx`,
  `.ofini`) and its tooltip says why. After a successful save the toast reads *Saved as notes.txt*.

**Limits (honest).** SVG goes through the importer and the exporter, so features the importer does not read (scripts, CSS
animation, filters it cannot represent) are not in the written file; keep an original copy when the SVG came from another
tool. The Office writers keep structure, styles, tables, lists, images, footnotes and links but are not byte-compatible with the
original producer (Word rewrites a file the same way). A web handle exists only while the tab stays open: after a restart
restored from autosave, the first Save asks for the file again.

Implementation: `app/src/core/source-format.js` (pure decision and text codec, tests in `tests/core/source-format.test.js`),
`app/src/commands/save-source.js` (writing and the dialog), `doc.source` on the `Doc`, `platform.saveFile({ bytesFor })` and
`platform.saveFileTo(path | handle)`. The Vibe tool `get_save_target` reports the current target.

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
