# File Formats

OpenFini's own format is `.ofini`, and it reads and writes a growing list of open and third-party formats with pure, bounds-checked engines written clean-room from public specifications. This page is the open, save and export matrix, plus guidance for files from other applications, whose formats are proprietary. Product names appear only to describe file-format compatibility.

## Matrix

| Format | Open | Save or export | Notes |
| --- | --- | --- | --- |
| `.ofini` | yes | yes | Native ZIP of JSON and assets; old versions upgraded on open |
| SVG | yes (Vector) | yes | Import ignores filters, masks, clip paths and patterns |
| PNG, JPEG, WebP | yes | export | Open as an image document in Pixel |
| GIF, BMP, AVIF | yes | no | Animated GIF: frames as layers, no timeline |
| TIFF `.tif` `.tiff` | yes | no | Pages as layers; LZW, PackBits, Deflate; 1 to 16 bit reduced to 8; DPI and ICC ignored |
| PSD (version 1) | yes | yes (8-bit RGB) | Layers, groups, masks, text content, composite |
| PSB | yes | no | Large-document variant of PSD |
| PDF | yes (Layout, editable) | export | See below |
| Illustrator `.ai` (PDF compatible), EPS with PDF | yes | no | Opens through the PDF importer; OpenFini never runs PostScript |
| IDML | yes | no | Pages, shapes, text stories, swatches |
| Sketch `.sketch` | best effort | no | Documented ZIP and JSON |
| OpenRaster `.ora` | yes | yes | Layers, groups, blend modes; *File ▸ Quick Export ▸ OpenRaster* |
| Krita `.kra` | flattened image | no | Merged image only |
| ICO, CUR | largest image | no | |
| Palettes `.gpl` `.ase` `.aco` | yes | yes | *File ▸ Swatches* |
| Fonts WOFF, TTC | yes | no | WOFF2 displays on screen but cannot embed in PDF |
| DOCX, ODT, RTF | yes (Office) | yes | See [[Office Studio]] |
| HTML, Markdown, plain text | yes (Office or Code) | yes | |
| Text and code files | yes (Code) | same file | See [[Markdown and LaTeX]] |
| CSV, TSV | yes (table in Layout, or text) | export CSV | *Table ▸ Import Table* |

## Files from other applications

OpenFini does not read or write other products' proprietary formats unless an official public specification exists and permits it ([[Clean-Room Policy]]). When it detects such a file it explains what to do.

| Source | What to do |
| --- | --- |
| Affinity (`.afdesign`, `.afphoto`, `.afpub`) | Not readable. Export to PSD, PDF or SVG from the originating app. If a plain PNG or JPEG preview is stored as an ordinary image stream, OpenFini can open that preview |
| InDesign `.indd` | Not readable. Export IDML or PDF |
| Figma `.fig`, XD `.xd` | Not readable. Export PDF or SVG |
| Photoshop PSD and PSB | Open directly. Text layers become editable frames where the text could be read; smart objects import as their flattened preview; adjustment layers and layer effects are reported as not imported |
| Illustrator `.ai` | Opens when it contains PDF data (the default); otherwise export PDF or SVG |
| Word 97-2003 `.doc`, Apple `.pages`, Google `.gdoc` | Save or download as `.docx` first |
| Spreadsheets and presentations | Not supported in Office yet; save a spreadsheet as CSV, or export slides as PDF and open the PDF in Layout |

## PDF import

PDF opens as an editable Layout document (through pdf.js, loaded on demand, about 610 KiB gzip and not precached). The importer fills an **import report**: *kept*, *flattened*, *dropped* and *note* entries, shown by *File ▸ Import Report…* and readable by the assistant (`get_import_report`). Details: [pdf-import.md](https://github.com/philppplik/open-fini/blob/main/docs/pdf-import.md).

## Import report

Every importer fills the same report. Fidelity statements include: TIFF DPI and ICC are ignored, GIF frames are layers without a timeline, Krita files open flattened, ICO opens the largest size only, and an EPS with a TIFF preview opens as a flattened low-resolution "preview only" document.

## Robustness

Readers validate sizes before allocating (a tiny file cannot request a huge buffer), skip unsafe ZIP paths, never expand XML entities, never execute code and report problems as warnings or clear errors. PSD canvases above 150 megapixels are refused by default.

## Color

Everything is sRGB, 8 bits per channel. CMYK, Lab and other modes convert with simple formulas and no ICC profile. PDF output is DeviceRGB.

## Reference

The engines and exact limits are described in [file-compat.md](https://github.com/philppplik/open-fini/blob/main/docs/file-compat.md); the research behind each verdict is in [file-format-research.md](https://github.com/philppplik/open-fini/blob/main/docs/file-format-research.md).

## See also

- [[Save in Original Format]]
- [[Office Studio]]
- [[Platform Support]]
- [[Export and Publish]]
