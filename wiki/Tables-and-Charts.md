# Tables and Charts

Tables and charts are first-class objects: real nodes that stay editable after saving, move, resize, duplicate and undo like any other object, and export as vectors to SVG and PDF. They work in every studio; the tools and the Data panel live in the Layout studio.

## Create a table

| Method | How |
| --- | --- |
| Table tool | `B`: click for a default table or drag a rectangle |
| Dialog | *Text ▸ Insert Table…* or *Table ▸ Insert Table…* (rows, columns, header, style, live preview) |
| CSV or TSV | *Table ▸ Import CSV / TSV as Table…* (file or pasted text; the delimiter is detected) |
| Spreadsheet paste | Copy cells from a spreadsheet and press `Ctrl+V` in the Layout studio; HTML tables on the clipboard are read too. If the browser refuses clipboard access, use the Import dialog |

## Edit on the canvas

| Action | How |
| --- | --- |
| Select a cell or range | Click; drag or `Shift`+click or `Shift`+arrows |
| Edit a cell | Double-click, `Enter`, `F2`, or start typing |
| Commit or cancel | `Enter` (moves down) or `Esc`; `Alt+Enter` inserts a line break |
| Move between cells | `Tab`, `Shift+Tab`, arrows (`Tab` in the last cell adds a row) |
| Resize a column or row | Drag the border (`Shift` keeps the table width) |
| Copy, cut, paste cells | `Ctrl+C`, `Ctrl+X`, `Ctrl+V` (TSV and HTML) |
| Context menu | Insert, delete and duplicate rows and columns, merge, split, clear, sort, export CSV |

## Data panel (Table)

Style presets (Clean, Grid, Striped, Minimal, Dark header, Accent, Soft, Ledger) and saved custom styles; header rows and columns; zebra rows and lines; row and column operations; cell alignment, fill, per-edge borders and merge or split; number formats per column or cell (number, currency with ISO code, percent, compact, date, text; decimals, prefix, suffix, negatives in parentheses); sort by the selected column; CSV import and export; alt text.

## Formulas

Type `=` at the start of a cell. Evaluation is a small interpreter without `eval`.

| Syntax | Meaning |
| --- | --- |
| `A1`, `$B$2` | Cell reference (`$` accepted) |
| `B2:B9` | Range |
| `+ - * / ^ %` | Arithmetic (`50%` is 0.5) |
| `&` | Text join |
| `= <> < > <= >=` | Comparison |

Functions: `SUM`, `AVERAGE` (`AVG`), `MIN`, `MAX`, `COUNT`, `COUNTA`, `PRODUCT`, `MEDIAN`, `ROUND`, `ABS`, `SQRT`, `IF`, `AND`, `OR`, `NOT`. Errors show in red: `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#CYCLE!`, `#ERROR!`. References adjust when you insert, delete, move or sort.

```text
=SUM(B2:B5)
=IF(B6>100, "high", "ok")
=ROUND(AVERAGE(C2:C9), 1)
```

*Table ▸ Flow Table Across Pages* splits a table that runs off the page into continuation tables with repeated header rows (the pieces become independent and formulas become values). *Text ▸ Data Merge…* also fills `<<Field Name>>` markers inside cells.

## Charts

The Chart tool (`H`) or *Text ▸ Insert Chart…* opens a gallery of about 20 presets: column, grouped, stacked, 100 percent, bar, line, multi-line, area, stacked area, pie, donut, scatter, radar, big number, progress bar, progress ring and sparkline. Double-click a chart to edit its data grid (paste CSV, TSV or HTML tables directly). **Link to a table** to chart its evaluated cells; the chart redraws live, also on undo, and keeps cached values if the table is deleted. The Data panel controls type, title, palette, legend, axes, labels, number formats, smoothing, markers, donut hole, start angle, targets and alt text.

## Export and accessibility

Charts and tables compile to the same display list as every other object, so SVG and PDF contain real paths and text. Each chart exports an SVG `<title>` and `<desc>` (your alt text or an automatic description). PDF has no tagged structure, so alt text is SVG only.

## Limits

No 3D, secondary axes, trend lines or manual label placement; colliding labels are dropped. Up to 40 series and 2,000 points per series; tables up to 500 rows and 60 columns. Formatting is per cell, not per character. A chart can link only to a table in the same document.

## Vibe

`add_table`, `edit_table`, `read_table`, `list_tables`, `import_csv_to_table`, `add_chart`, `edit_chart`, `read_chart`; the skill `report-with-charts` builds a report page ([[Vibe Tools Reference]]).

## See also

- [[Layout Studio]]
- [[Export and Publish]]
- [[Office Studio]]
- [[Vibe Tools Reference]]
