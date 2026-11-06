# Export

File ▸ Export… (Ctrl/Cmd+Shift+E, also the header button) opens the Export popup of the Vector, Pixel and Layout
studios. Its **Image & PDF** tab is generated from one declarative options schema; the **Slices**, **Website** and
**Publish** tabs are unchanged. Office documents (word processor, spreadsheet, presentation, whiteboard) have their own
export dialogs ([office-suite.md](office-suite.md)).

## Design

| Module | Role |
| --- | --- |
| `app/src/engine/export/options.js` | Pure schema: formats, options, groups, built-in presets, `normalizeExportSettings`, `visibleOptions`, page ranges, size lists, naming, spreads, `planExport` (one job per output file) |
| `app/src/engine/export/png.js` | PNG encoder: RGB/RGBA, gray, indexed (PNG-8 with median-cut palette, optional Floyd-Steinberg dithering, 1/2/4/8-bit), Adam7, zlib level, `pHYs`, `iCCP`, `iTXt` and XMP |
| `app/src/engine/export/quantize.js` | Palette quantization for PNG-8 |
| `app/src/engine/export/tiff.js` | TIFF writer: RGB, RGBA, gray, CMYK; LZW, Deflate, PackBits or none; horizontal predictor; resolution, ICC, descriptive tags and XMP |
| `app/src/engine/export/jpeg-meta.js` | JPEG resolution (JFIF density) and XMP (APP1) without re-encoding |
| `app/src/engine/export/pdf-prep.js` | Spreads, effective image resolution, downsampling targets |
| `app/src/core/export-run.js` | Renders and saves the planned files (lazy); also used by File ▸ Export as … and the Vibe tools |
| `app/src/ui/export-dialog.js` | The popup: presets, basic options, an **Advanced** section, a live summary |

Rules that keep the dialog honest:

* **No dead controls.** An option is shown only for formats whose output it changes, and its `when` rule hides it when
  other settings make it irrelevant (for example *Color conversion* when a PDF/X standard already implies CMYK, *Embed
  fonts* for PDF/X, which always embeds, *Quality* for PNG, *Fonts* when no text or no added font exists). Enum choices
  carry their own rules (no *Transparent* for JPEG or CMYK TIFF, no JPEG image compression for CMYK PDF). A test reads
  the export code and fails when an option is never consumed.
* **One schema for every caller.** The dialog, presets, the File ▸ Export as … commands and the Vibe tools all go through
  `normalizeExportSettings`, which fills defaults, clamps numbers, checks enum values against the choices available for
  the document and drops unknown keys. Settings of the previous dialog and of Settings ▸ Defaults (`jpg`, quality 0..1,
  `transparent`, `bleed: true`, `marks`) are mapped.
* **Formats the browser cannot write are not offered.** WebP and AVIF are probed once by encoding a tiny canvas and
  checking the file signature (Safari, for example, returns PNG for WebP).
* Defaults reproduce the earlier fixed dialog: PNG at 1x on the page color, quality 90 %, plain PDF.

## Options

Basic options appear first; the rest is under **Advanced** (its open state is remembered). Values are per format.

| Group | Option | Formats | Effect |
| --- | --- | --- | --- |
| General | Pages: current, all, page range, selection only, each top-level layer as a file | all (selection and layers: raster, SVG) | what is exported; the range accepts `1-3, 5, 8-` |
| General | Spreads | PDF, facing-pages documents | facing pages side by side on one PDF page, paired as on the pasteboard (page 1 alone) |
| General | Padding | raster, SVG (selection, layers) | extra pixels around the selection or layer |
| Size | Scale, Width, Height, Resolution (ppi) | raster | output pixels; the effective resolution is written into PNG, JPEG and TIFF |
| Files | Export several sizes | raster | one file per entry: `1x, 2x, 512w, 64h, 300ppi` |
| Output | Quality | JPEG, WebP, AVIF, SVG (JPEG images) | lossy quality |
| Output | Background: page color, transparent, white, custom | raster | transparency only for PNG, WebP, AVIF and RGB TIFF |
| Output | Color: RGB, grayscale, indexed (PNG-8), CMYK | raster (indexed: PNG; CMYK: TIFF) | CMYK converts with the document's color settings |
| Output | Colors, Dither | PNG-8 | palette size 2-256 and error diffusion |
| Output | Embed color profile | PNG, JPEG, TIFF | the RGB working space, or the CMYK profile for CMYK TIFF (the built-in CMYK approximation has no profile) |
| Compression | Interlaced (Adam7), Compression level | PNG | progressive display; zlib level 0-9 (lossless) |
| Compression | Compression: LZW, ZIP/Deflate, PackBits, none | TIFF | lossless |
| Output | Include page color, Units (px, pt, mm, cm, in), Responsive | SVG | background rectangle; width/height units; omit width/height |
| Compression | Decimal places | SVG | coordinate precision |
| Images | Embedded images: PNG or JPEG | SVG | JPEG only for fully opaque images |
| Fonts and text | Fonts: reference by name, embed the fonts you added | SVG | `@font-face` with the font file as a data URL |
| Print | PDF standard: plain, PDF/X-1a:2003, PDF/X-4 | PDF | see [color-management.md](color-management.md) |
| Print | Color conversion: keep RGB, convert to CMYK | plain PDF in an RGB document | DeviceCMYK through the document's color settings |
| Print | Bleed: none, document, custom (mm) | PDF | BleedBox and MediaBox |
| Print | Crop marks, Registration marks, Color bars, Page information | PDF (page information: plain PDF only) | printer marks in the slug |
| Images | Effects resolution | PDF, SVG | resolution at which live effects, masks and adjustments are flattened |
| Images | Downsample images, Target resolution | PDF | images above 1.5 x the target are resampled to it |
| Images | Image compression: automatic, JPEG, ZIP; Image quality | PDF | automatic keeps JPEG photos and compresses the rest losslessly |
| Fonts and text | Embed fonts (subset) | plain PDF | off uses the standard PDF fonts |
| Compression | Compress text and line art | PDF | Flate on content streams |
| Viewer | Open in viewer as | PDF | `/PageLayout`: single page, continuous, two pages, two pages with cover |
| Files | File names | all | tokens `{name}` `{page}` `{pageName}` `{layer}` `{size}` `{w}` `{h}` `{date}`; parts that tell files apart are appended when names would collide |
| Metadata | Include metadata, Title, Author, Copyright, Description, Keywords | PNG, JPEG, TIFF, SVG, PDF | PNG `iTXt` + XMP, JPEG XMP, TIFF tags + XMP, SVG `<title>` `<desc>` `<metadata>`, PDF Info + XMP |

PSD keeps its earlier behavior (one Photoshop layer per top-level layer); only the page choice applies.

Several files are saved as one ZIP archive. The summary under the options shows the number of files, the pixel size and
resolution of the first file and its name, or why the export cannot run (for example a page outside the range).

## Presets

The preset menu holds built-in presets (web PNG at 1x/2x/3x, web JPEG, app icon sizes, CMYK TIFF for print, high-quality
PDF, PDF/X-4 and PDF/X-1a press, smallest PDF, SVG for the web) and your own. **Save** stores only the values that differ
from the defaults in the `exportPresets` preference (portable with Settings ▸ Profiles); **Import** and **Export** read and
write a JSON file (`{"openfiniExportPresets": 1, "presets": [{ "name", "settings" }]}`); imported settings are normalized,
so unknown keys are dropped. The last settings used in each studio are remembered (`exportLast`); without them the dialog
starts from Settings ▸ Defaults ▸ Export, and Layout documents start with PDF.

## Vibe tools

* `list_export_options` (read only): formats this browser writes, the options that apply to a format and given settings
  (type, values or range, current value, hint), the presets and the planned files.
* `export_document`: exports with a format, a preset and/or settings (the same keys); asks for approval and opens the save
  dialog. Office documents use `office_export`.

## Limits

* Text is never converted to outlines (no glyph outline extraction yet); SVG can embed only fonts added to OpenFini, and
  system fonts stay referenced by name.
* WebP and AVIF have no metadata, no profile and no lossless switch: the browser's canvas encoder does not expose them.
  AVIF is offered only where the browser can encode it.
* Progressive JPEG, chroma subsampling and 16-bit output are not available (canvas encoder, 8-bit pipeline).
* Page information uses Helvetica without embedding it, so it is not offered for PDF/X.
* PDF JPEG image compression applies to opaque images in RGB output; CMYK output compresses images losslessly.
* PDF/X conformance is checked by OpenFini's preflight, not by a certified validator.
