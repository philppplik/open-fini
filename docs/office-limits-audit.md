# Office and export limits audit

An inventory of every limit named in the Office Suite and export documentation ([office-sheet.md](office-sheet.md),
[office-studio.md](office-studio.md), [office-slides.md](office-slides.md), [office-board.md](office-board.md),
[export.md](export.md)) and the *Limits* notes of the changelog: why it exists, how it could be lifted, and whether
lifting it is worth the effort. AI and platform limits are audited separately.

Ratings: **value** is how often users meet the limit and how much it hurts (high, medium, low); **effort** is S (a
day or less), M (a few days), L (a week or more, or a new subsystem). **Status** is *closed* (lifted, with the change
that lifted it in the changelog), *open* (still a limit) or *by design* (kept on purpose).

When a limit is closed, it is removed from the *Known limits* section of the app's page and marked *closed* here.

## Spreadsheet

| Limit | Cause | How to lift | Value | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| Defined names not in XLSX / ODS | depth features were built model-first | `definedNames` (XLSX), `table:named-expressions` (ODS), both ways | high | S | closed |
| Data validation not in XLSX / ODS | as above | `dataValidations` (XLSX), `table:content-validations` (ODS) | high | S | closed |
| Table styles not in XLSX / ODS | XLSX tables are separate `xl/tables/tableN.xml` parts | write table parts with a built-in `TableStyleMedium*` name; ODS has no table styles, so the look is written into the cell styles and the range as a database range | medium | M | closed |
| Row and column groups not in XLSX / ODS | as above | `outlineLevel` / `collapsed` on rows and columns (XLSX), `table:table-row-group` / `table:table-column-group` (ODS) | medium | S | closed |
| Page setup not in XLSX / ODS | as above | `pageSetup`, `pageMargins`, `printOptions`, `fitToPage`, `_xlnm.Print_Area` (XLSX); page layout styles and `table:print-ranges` (ODS) | medium | S | closed |
| Sparklines not in XLSX / ODS | they live in an `x14` extension list | `x14:sparklineGroups` in the worksheet `extLst` (XLSX); LibreOffice's `calcext:sparkline-groups` (ODS) | low | M | closed |
| Pivot tables are snapshots | pivot-lite writes values only | keep the pivot definition on the target sheet and re-run it on demand (*Data ▸ Refresh All*); real XLSX pivot caches are a separate, large job | medium | S | closed |
| Pivot tables not written as XLSX pivot parts | pivot cache and pivot table parts are a large format | write values (as now); a real pivot part is not planned | low | L | by design |
| Spilling formulas written as plain formulas (Excel shows `@`) | no dynamic-array metadata | write `t="array"` with the spill range, `cm="1"` and `xl/metadata.xml` (`XLDAPR`), `_xlfn._xlws.` prefixes for FILTER and SORT | high | S | closed |
| No outline gutter for groups | the grid had no gutter | draw a gutter left of the row headers and above the column headers with level bars and +/- buttons | medium | M | closed |
| *Fit to one page* resizes the page instead of scaling | the PDF writer sized the page to the print area | scale the content onto the chosen paper (A4 or Letter), keeping orientation and margins | medium | S | closed |
| Validation ignores paste and tool writes | only the cell editor checked input | check pasted and tool-written values, reject or report violations | medium | S | closed |
| Spill references (`A1#`), LET / LAMBDA, INDIRECT / OFFSET | the dependency graph needs static references; LAMBDA needs closures | `A1#` and LET are small; INDIRECT / OFFSET need dynamic dependencies (volatile handling) | medium | M | open |
| Pictures, cell comments from files, rich text in a cell | the cell model has one value and one style | pictures as floating objects like charts; comments into the suite's comments; rich text needs runs per cell | medium | L | open |
| One selection range | the selection model | multi-range selection in the view and the commands | low | M | open |
| Charts and conditional formats not in ODS output | ODS charts are embedded chart objects | write `office:chart` objects and `calcext:conditional-formats` | medium | M | open |
| Legacy `.xls` | BIFF8 is a large binary format | convert first (dialog) | low | L | by design |
| US English display of numbers and dates | one number formatter | locale-aware formatting of number formats | medium | M | open |

## Document

| Limit | Cause | How to lift | Value | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| Multi-column sections do not split across pages | a section is one measured box in the editor | split a section into page-sized slices when paginating, balancing the columns on the last page | high | M | closed |
| Text boxes hold plain text | the box stores a string | store paragraphs with runs (bold, italic, underline, color, size) and edit them in the box dialog | medium | M | closed |
| Text boxes and wrapped images are written to DOCX as indented paragraphs and inline images | the writer had only inline drawing | `wp:anchor` with `wrapSquare` for images; text boxes as `wps:wsp` with `w:txbxContent` inside `mc:AlternateContent` with a VML fallback; read them back | high | M | closed |
| Splitting and joining paragraphs and format changes are not tracked | only text insertions and deletions are marked | `w:pPrChange` / `w:rPrChange` style revisions with the old properties, paragraph-mark insertions; accept / reject restores | medium | M | closed |
| Vibe edits are not tracked | tools write directly | when track changes is on, tool writes become revisions authored *Vibe (AI)* | medium | S | closed |
| ODT has no columns | the ODT writer wrote one column | `text:section` with `style:columns` | medium | S | closed |
| PDF uses standard fonts (no characters outside Windows-1252) | the document PDF path uses the base-14 fonts | embed added fonts through the Layout engine's font embedding | high | M | open |
| Comments in Word files, mail merge, drawing shapes, first / even page headers, page borders | not modeled | one by one; comments map to the suite's comments | medium | L | open |
| Equations become plain text | no OMML model | read OMML into the TeX subset of the whiteboard | low | L | open |

## Presentation

| Limit | Cause | How to lift | Value | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| No multi-level lists | one bullet flag per box | a level per paragraph (`levels`), Tab / Shift+Tab, indent per level, `lvl` in PPTX and `text:list` nesting in ODP | high | S | closed |
| Mixed formatting without font and size | spans had four keys | add `font` and `size` to spans, the ribbon applies them to the selection, PPTX `latin` / `sz` and ODP spans | medium | S | closed |
| One master per deck; layouts cannot be added | the deck model has one master | `masters[]` with a master per slide (`slide.master`), PPTX writes one slide master per master | low | M | open |
| No automatic date field | the footer date was text | a `{date}` field with a format, updated when shown and written as `datetime` fields | medium | S | closed |
| Charts are snapshots | the deck does not depend on the sheet | refresh linked charts when the source spreadsheet changes while both are open | medium | S | closed |
| Charts written as tables to PPTX / ODP | no chart part writer | PPTX `c:chartSpace` parts with cached values (bar, line, pie, area, scatter); ODP embedded `office:chart` objects | high | M | closed |
| No text autofit, SmartArt, animations, audio or video | not modeled | autofit is M; the rest is L | medium | L | open |
| Picture cropping, gradients and custom geometry simplified on import | not modeled | cropping (`srcRect`) is S, gradients M, custom geometry L | medium | M | open |
| PDF text uses the standard fonts | shared PDF path | see Document | medium | M | open |
| Presenter view shares the window | one window | a second window through the multi-window layer | low | M | open |

## Whiteboard

| Limit | Cause | How to lift | Value | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| No matrices or `\begin` environments in formulas; no `\left` / `\right` | the TeX layout handled rows only | `matrix`, `pmatrix`, `bmatrix`, `vmatrix`, `cases`, `aligned` as grids; stretched delimiters | medium | S | closed |
| Graphs are y = f(x) only | the plot compiler had one variable | parametric `(x(t), y(t))` with a t range and implicit `F(x, y) = 0` by marching squares | medium | S | closed |
| Tables have no merged cells or per-cell formatting | rows of strings | `merges` (A1 ranges) drawn as spanning cells; per-cell bold and fill | low | S | closed |
| Sub-board cards show only the page name | the card did not render the page | a scaled vector preview of the target page inside the card (depth-limited) | low | S | closed |
| Canvas text not localized | built-in labels were English literals | translate the labels drawn on the canvas | low | S | closed |
| No elbow / curved connectors, arrow labels, shape libraries | not modeled | routing is M, libraries L | medium | M | open |
| No remote cursors, laser or large images for collaborators | presence carries no board cursor | cursor records in presence | low | M | open |
| Rotated shape text edited unrotated, plain-text editor | the editor is a textarea | rich text editor in the canvas | low | L | open |
| Palm rejection is heuristic | browsers do not report palm contacts | none (by design) | low | – | by design |
| tldraw export writes rich objects as rectangles | tldraw has no such shapes | none (by design) | low | – | by design |

## Export

| Limit | Cause | How to lift | Value | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| Text is never converted to outlines | no glyph outline extraction | read TrueType `glyf` outlines from fonts added to OpenFini (`engine/layout/sfnt.js` already parses them) and emit paths; system fonts have no readable bytes in a browser, CFF outlines need a charstring interpreter | medium | M | open |
| SVG embeds only added fonts | system font files are not readable | none in the browser (Local Font Access is not broadly available) | low | – | by design |
| WebP and AVIF without metadata, profile or lossless | the canvas encoder exposes only a quality | a WASM encoder (libwebp, libavif) would lift it, at about 150-400 KiB per codec; not worth the size | low | L | by design |
| No progressive JPEG, chroma subsampling or 16-bit output | canvas encoder, 8-bit pipeline | a JS JPEG encoder (M) for progressive and subsampling; 16-bit needs a 16-bit pipeline (L) | low | M | open |
| Page information uses unembedded Helvetica, so it is not offered for PDF/X | the marks use base-14 text | draw the page information as outlined text | low | S | open |
| CMYK PDF images are compressed losslessly | JPEG needs RGB in the canvas encoder | a CMYK JPEG encoder | low | M | open |
| PDF/X conformance checked by OpenFini's preflight | no certified validator in the app | none (by design) | low | – | by design |

## Result

Closed in this pass: every spreadsheet file-format gap of the depth features (names, validation, tables, groups, page
setup, sparklines and pivot definitions through XLSX and ODS; dynamic arrays as Excel dynamic arrays), the outline
gutter, refreshable pivots, fit-to-page scaling, validation of pasted and tool-written values; Word and OpenDocument
text boxes and wrapped images, rich text in text boxes, tracked format and paragraph changes and tracked Vibe edits,
ODT columns, multi-column sections across pages; slide list levels, font and size in mixed formatting, date fields,
live linked charts and native charts in PowerPoint and OpenDocument; whiteboard matrices and stretched delimiters,
parametric and implicit graphs, merged table cells, sub-board previews and localized canvas text.

Next, by value per effort: embedded fonts in Office PDF output (Document, Presentation), text outlines for added
TrueType fonts in export, ODS charts and conditional formats, several slide masters, `A1#` and LET. The remaining open
rows are kept in the app pages' *Known limits* and in [known-limits.md](known-limits.md).
