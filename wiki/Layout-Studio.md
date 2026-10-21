# Layout Studio

The Layout studio is for brochures, books and print: pages with master pages, text frames that flow across pages, paragraph and character styles, tables with formulas, linked charts, data merge, and PDF export with bleed and crop marks. It also imports PDFs as editable pages.

## Pages and masters

- The **Pages panel** shows thumbnails (drag to reorder), add, duplicate and delete, **master pages** and *Facing pages*.
- Click the pencil next to a master to edit it. Fields from the **Text** menu (page number, page count, date) are filled per page.
- **Document Setup…** sets page size, margins, columns, gutter and bleed. Guides and a grid are available as in the other studios.

## Text

| Task | How |
| --- | --- |
| Draw a text frame | `T` |
| Flow overflow | A red **+** marks overflow. *Text ▸ Flow Text into a New Frame* adds a linked frame on the next page (creating it if needed); **Autoflow** creates as many pages as the story needs |
| Link and unlink frames | *Text ▸ Link Text Frames* (in selection order), *Unlink* |
| Styles | The **Styles** panel: Body, Heading 1-3, Caption and Quote can be added with one click; click to apply, the redo arrow redefines a style from the current formatting |
| Table of contents | *Text ▸ Generate Table of Contents* builds a contents page from Heading 1-3 |
| Typography | Justification, hyphenation (US English only), tabs with leaders, bullets and numbering, drop caps, widow and orphan control |
| Image frame | `I`; drop or place an image to crop-fill it |

## Tables and charts

The Table tool (`B`), Chart tool (`H`), the Data panel and the Table menu create editable tables (formulas such as `=SUM(B2:B5)`, merge, number formats, CSV and spreadsheet paste) and charts (about 20 presets, linked to a table). See [[Tables and Charts]].

## Data merge

*Text ▸ Data Merge…* loads a CSV. Use `<<Column Name>>` markers in text frames and table cells, preview each record in place, and export one merged PDF.

## Output

PDF export embeds TrueType and OpenType fonts you added in the Type panel (*Add font file…*, one file per family; add bold and italic as separate families). Other families fall back to the standard PDF fonts (Helvetica, Times, Courier). Bleed and crop marks are options in the Export popup ([[Export and Publish]]). PDF is DeviceRGB; there is no PDF/X, tagged PDF or CMYK.

## PDF import

PDF, Illustrator files with PDF content and EPS with PDF open as editable Layout documents with an import report. Presentation slides exported as PDF become one page per slide. See [[File Formats]].

## Shortcuts

Layout shares the vector tools (see [[Vector Studio]]) and adds `T` text frame, `I` image frame, `B` table and `H` chart ([[Keyboard Shortcuts]]).

## Limits

No footnotes, indexes, cross references, books or per-page numbering formats. The engine supports text wrap around shapes and baseline grids, but there is no UI for them yet. No OpenType features, right-to-left or complex scripts. See [[Roadmap and Known Limits]].

## See also

- [[Tables and Charts]]
- [[Export and Publish]]
- [[Studio Overview]]
- [[File Formats]]
