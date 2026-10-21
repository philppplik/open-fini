# File format research

What OpenFini can read or write natively, what only works through an export route, and why. Written for the
0.5.0 "more native formats" work. Rules that frame every verdict (see [clean-room.md](clean-room.md)):

- OpenFini implements a format only from a public specification, a published format description or general
  knowledge of an open container. It never decompiles or reverse engineers vendor binaries and never copies GPL code.
- Third-party code is used only when it is permissively licensed and vendored in `app/vendor/`.
- Everything must run in a browser or webview (no native codecs, no PostScript interpreter, no shelling out).

Verdict categories: **Supported** (implemented, tested), **Partial** (best effort or flattened), **Export route**
(only via an export from the vendor application, the app shows the exact steps), **Not possible** (and why),
**Later** (feasible with an open specification, not implemented yet).

The same verdicts are available as data in `app/src/platform/format-verdicts.js` (used by the Vibe tool
`list_supported_formats`). The user-facing matrix of what the engines do is [file-compat.md](file-compat.md).

How this was researched: web searches on 2026-10-20 (sources at the end of each section) plus the format
knowledge already used by the existing PSD, IDML and PDF engines. Statements marked *unverified* could not be
confirmed against a primary source and are written conservatively.

## Affinity (.af, .afdesign, .afphoto, .afpub, .aftemplate, .afpackage, .afbrushes, .afbook)

**Verdict: not natively possible. Best route: File > Export to PDF (pages, text), PSD (layers) or SVG (vectors).**

- The formats are proprietary. We found no published specification, no SDK and no official open interchange
  other than Affinity's own exports. A community thread asking for a specification states the development team
  appears not to want to document the format; a Rhino forum thread finds no toolkit either.
- Since Canva acquired Serif (2024), Affinity (Photo, Designer, Publisher) was relaunched in October 2025 as one
  free app with a single `.af` format. Reports say the new app opens V1 and V2 files, but V1 / V2 cannot open files
  saved by the new app. So there are now two generations of container to reverse engineer, with no documentation.
  The new app is reported to import PSD, AI, PDF, SVG, TIFF and IDML and to export PDF, PSD, SVG, TIFF and raster
  formats (third-party summaries, *unverified against Affinity's own help*; the long-standing V2 help page lists
  the same export formats).
- Open-source projects: we did not find a permissively licensed parser we could vendor. Existing community
  readers are partial and are based on reverse engineering of the binary, which `clean-room.md` forbids us to
  replicate; GPL code cannot be copied into a project with a permissive license.
- What OpenFini does: recognizes every Affinity extension (`.af` included), explains the export steps with the
  fidelity of each route, and offers to open a plain PNG / JPEG preview stream if one is stored in the file
  (the scan reads only standard image signatures; the preview is low resolution and flattened).
- Fidelity of the routes: PDF keeps text, shapes and images (fonts that are embedded as subsets are
  replaced); PSD keeps raster layers, masks, opacity and blend modes but not live filters or adjustment layers;
  SVG keeps shapes and text as curves without live effects.

Sources: [FileInfo, Affinity file types](https://fileinfo.com/software/canva/affinity),
[TBreak, Affinity relaunch](https://tbreak.com/affinity-free-all-in-one-design-app-uae/),
[Neowin, Affinity relaunch](https://www.neowin.net/amp/canva-relaunches-affinity-as-a-free-all-in-one-creative-app/),
[Affinity help, supported file formats](https://affinity.help/designer2ipad/en-US.lproj/pages/Appendix/fileformat.html),
[Esri Community request for a specification](https://community.esri.com/t5/arcgis-pro-ideas/export-layout-to-affinity-designer/idc-p/1589209/highlight/true),
[McNeel forum](https://discourse.mcneel.com/t/export-to-affinity-document/22871).

## Adobe

| Format | Verdict | Notes |
| --- | --- | --- |
| PSD / PSB | Supported | Public Photoshop file format specification. Read (layers, masks, groups, text, 8/16/32 bit) and PSD write. Smart objects are read as their stored raster. Embedded smart-object PNG/JPEG *source* data is not extracted (the raster preview is what Photoshop shows anyway). |
| AI | Partial | PDF compatible files open as PDF through pdf.js (artboards, live effects and Illustrator-only data are lost). Files without PDF content get export steps. |
| PDF, PDF/X | Supported | ISO 32000. PDF/X is PDF plus constraints, so it opens like a PDF. Writing PDF/X conformance is not implemented. |
| IDML | Supported | Public Adobe format (zip + XML). Read only. |
| INDD, INDT | Export route | Proprietary binary, no public specification. InDesign: File > Save a Copy As > IDML, or export PDF. |
| INX | Export route | Legacy XML interchange of InDesign CS2, superseded by IDML. Not implemented; use IDML. |
| XD | Export route | Adobe XD is in maintenance only; the file is a ZIP of JSON and assets but the structure is undocumented. Export SVG or PDF from XD. |
| EPS / PostScript | Partial | PostScript is a public language but OpenFini does not execute it. EPS that contains a PDF opens; for DOS EPS files (binary header `C5 D0 D3 C6`, public EPS 3.0 specification) the embedded TIFF preview is opened, flattened and marked "preview only". |
| ASE, ACO | Supported | Palettes into document swatches, and export. ACO is documented in Adobe's Photoshop file format specification. For ASE Adobe publishes no official document; the layout follows the widely published community description (big-endian blocks, UTF-16 names, float32 values) and was verified with files written by our own writer only. |
| ABR (brushes) | Not possible (now) | Complex, version dependent, partly undocumented, and OpenFini has no brush-engine model that could use them. |
| ICC profiles | Not possible (now) | OpenFini has no color-managed pipeline; CMYK and Lab are converted with simple formulas. |
| DNG / camera RAW | Not possible (now) | DNG is TIFF based and open, but decoding raw sensor data needs a full demosaic and color pipeline. Develop in a RAW converter and export TIFF / JPEG. |

Sources: Adobe Photoshop File Formats Specification and the IDML specification (public Adobe documents, already
cited in file-compat.md), [community description of ASE and ACO](https://medium.com/swlh/mastering-adobe-color-file-formats-d29e43fde8eb),
[Cyotek ASE walkthrough](https://cyotek.com/blog/reading-adobe-swatch-exchange-ase-files-using-csharp),
[GIMP issue on ASE support](https://gitlab.gnome.org/GNOME/gimp/-/issues/9901).

## Other design and paint applications

| Format | Verdict | Notes |
| --- | --- | --- |
| Figma `.fig` | Export route | Proprietary Kiwi-encoded container, no published specification; Figma may change it without notice. Community parsers exist (for example an MIT-licensed `openfig-core`), but they rest on reverse engineering and are unofficial and unstable. Use Figma's export (PDF, SVG, PNG). |
| Sketch | Partial | Documented ZIP + JSON; best effort, tested with synthetic files only. |
| Canva | Export route | Canva designs live in the cloud; download as PDF, SVG, PNG, PPTX. No local file format. |
| OpenRaster `.ora` | Supported | Open specification (openraster.org): ZIP with `mimetype`, `stack.xml`, layer PNGs, `mergedimage.png`, thumbnail. Read and write with layers, groups, opacity, visibility, offsets and blend modes. |
| Krita `.kra` | Partial | ZIP with `maindoc.xml`; layer data is in a Krita-specific tiled format. Only `mergedimage.png` (or `preview.png`) is read, flattened. For layers, export OpenRaster or PSD in Krita. |
| GIMP `.xcf` | Later | The format is documented officially (developer.gimp.org, "a condensation of the loading and saving code, the code is the ultimate reference", complete for GIMP 2.10). Reading is feasible (properties, hierarchies, tiled RLE) but it is a sizeable parser; not done in this release. In GIMP use Export As > OpenRaster or PSD. |
| Scribus `.sla`, LibreOffice ODG | Later | XML based and open. Not implemented: the value is low compared to PDF / SVG export from those apps. |
| Inkscape SVG | Supported | Plain SVG; Inkscape extras (`sodipodi`, `inkscape` namespaces) are ignored. |

Sources: [OpenRaster file layout specification](https://openraster.org/baseline/file-layout-spec.html),
[OpenRaster layer stack specification](https://www.openraster.org/baseline/layer-stack-spec.html),
[GIMP XCF specification](https://developer.gimp.org/core/standards/xcf),
[Grida notes on the .fig format](https://grida.co/docs/wg/feat-fig/),
[Figma forum thread about the .fig format](https://forum.figma.com/archive-21/inquiry-about-the-fig-file-format-35603).

## Open image and vector formats

| Format | Verdict | Notes |
| --- | --- | --- |
| SVG, PDF | Supported | See above. |
| PNG, JPEG, WebP, BMP, AVIF | Supported | Decoded by the browser engine. |
| GIF (animated) | Supported | Own decoder (public GIF89a): every frame becomes a layer, delays are kept in the layer names. There is no animation timeline yet. |
| TIFF | Supported | Public TIFF 6.0. Multi-page, strips and tiles, none / LZW / PackBits / Deflate, predictor 2, 1 to 16 bit gray and palette, 8 / 16 bit RGB, RGBA, naive CMYK. Not supported (clear error): JPEG-in-TIFF, BigTIFF, planar and YCbCr / Lab. 16 bit is reduced to 8 bit, ICC profiles and DPI are ignored. |
| ICO / CUR | Supported | The largest image (PNG or BMP DIB 1/4/8/24/32 bit with mask) opens; smaller sizes are reported as not imported. Hot spots are ignored. |
| HEIC / HEIF | Not possible | Patent-encumbered (HEVC); there is no royalty free decoder we can vendor and no codec in the webview on all systems. Convert to JPEG, PNG or AVIF first. |
| WMF / EMF | Export route (later) | Microsoft publishes both formats; a vector subset reader is feasible but low priority. Export SVG or PDF from the source. |
| DXF | Export route | CAD interchange, out of scope for a design suite. |
| PNM, TGA, DDS | Later | Trivial formats, little demand; browsers do not decode them. Not worth startup or maintenance cost now. |

Sources: Adobe TIFF 6.0 specification, GIF89a specification, Microsoft ICO format documentation (public).

## Data and text formats

| Format | Verdict | Notes |
| --- | --- | --- |
| TXT, MD, LaTeX, BibTeX, JSON, YAML, XML, TOML, INI, HTML, CSS, JS | Supported | Open in the Code studio (Markdown and LaTeX with live preview). |
| CSV / TSV | Supported | Code studio for editing; Layout > Import CSV / TSV as Table (delimiter detection, quoted fields, header row toggle) creates an editable table. Vibe tool `import_csv_to_table`. |
| SRT / VTT | Supported as text | Opens as text in the Code studio. A subtitle timeline belongs to the later Video studio. |
| TTF, OTF | Supported | Type panel > Add font file. |
| WOFF | Supported | Unwrapped to a plain sfnt (zlib per table, `fflate`), so it also embeds in PDFs. |
| WOFF2 | Partial | Brotli plus a glyph transform. Browsers load it natively, so it works on screen, but OpenFini does not decode it to TTF, so PDF export cannot embed it (the app tells the user). |
| TTC / OTC | Supported | The first font of a collection is added (the app says how many fonts the file holds). |
| Palettes GPL, ASE, ACO | Supported | File > Swatches > Import Palette; export of all three. |
| SK palettes (`.sketchpalette`), `.clr` | Later | Simple but rare. |

## Summary of what was implemented

TIFF, animated GIF, OpenRaster (read and write), Krita (flattened), ICO / CUR, EPS TIFF preview, GPL / ASE / ACO
palettes (read and write), WOFF unwrapping and TTC collections, updated Affinity / InDesign / EPS guidance, the
Vibe tools `list_supported_formats`, `import_palette_from_text` and `export_palette`. See
[file-compat.md](file-compat.md) for the exact behavior and limits and the tests in `tests/formats/`.
