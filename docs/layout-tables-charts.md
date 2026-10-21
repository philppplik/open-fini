# Tables and charts (Layout studio)

Tables and charts are **first-class objects**: they are real nodes (`table`, `chart`) that stay editable after saving, move / resize / duplicate / copy like any other object, undo and redo exactly, and export as **vectors** to SVG and PDF (and sharp pixels to PNG / JPEG / WebP). They work in every studio, but the tools and the Data panel live in the Layout studio.

## Tables

### Create

* **Table tool** (`B`): click for a default table, or drag a rectangle. Rows, columns, header row and style are in the context bar.
* **Text ▸ Insert Table…** or **Table ▸ Insert Table…**: dialog with rows, columns, header rows / columns, width, style and a live preview.
* **Import CSV / TSV** (*Table ▸ Import CSV / TSV as Table…*): load a file or paste text; delimiter is detected; replace the data of the selected table or create a new one.
* **Paste a spreadsheet**: copy cells in Excel, Numbers, Google Sheets or LibreOffice and press `Ctrl+V` in the Layout studio: text that looks tabular becomes a table. With a cell selected in the Table tool, pasting fills cells from there (the table grows). HTML tables from the clipboard are read too. (Browsers may ask for clipboard permission; if it is refused, use the Import dialog.)
* **Vibe**: `add_table`, `import_csv_to_table`.

### Edit on the canvas

| Action | How |
| --- | --- |
| Select a cell / range | Click; drag or `Shift`+click / `Shift`+arrows for a range |
| Edit a cell | Double-click, `Enter`, `F2`, or just start typing |
| Commit / cancel | `Enter` (moves down) / `Esc`; `Alt+Enter` inserts a line break |
| Move between cells | `Tab`, `Shift+Tab`, arrow keys (`Tab` in the last cell adds a row) |
| Clear contents | `Delete` (with the whole table selected it deletes the table object instead) |
| Resize a column / row | Drag the cell border (`Shift` keeps the table width) |
| Copy / cut / paste cells | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` (TSV and HTML on the system clipboard) |
| Context menu | Right-click: insert / delete / duplicate rows and columns, merge, split, clear, sort, export CSV |

Resizing the whole table with the handles scales the column widths and row heights (fonts keep their size). Rows grow automatically when text wraps (switch off *Rows grow with their text* in the panel to keep fixed heights).

### Data panel ▸ Table

* **Style presets** (Clean, Grid, Striped, Minimal, Dark header, Accent, Soft, Ledger) and *Custom*. **Save style…** stores the current look in the document (`tableStyles`); saved styles show up in every table's style list of that document.
* Header rows / columns, zebra rows, row / column lines, outer frame, colors, line width, font size, padding.
* **Rows and columns**: insert above / below, left / right, duplicate, move, delete, distribute evenly, fit columns to content.
* **Cells** (the selected range, or the whole table when none): alignment (horizontal and vertical), bold / italic / underline, text color, fill, font size, padding, per-edge **borders** (all, outer, inner, top, bottom, left, right, none; width and color), merge / split.
* **Number formats** per column (or per cell): automatic, number, currency (ISO code), percent, compact, date, text; decimals, prefix, suffix, negative in parentheses.
* **Formula bar** (the *Cell content* field) for the focused cell.
* **Data**: sort by the selected column (numbers before text, empty cells last; formulas that refer to their own row keep working), import CSV, export CSV, flow across pages, alt text.

### Formulas

Type `=` at the start of a cell. Evaluation is a small, safe interpreter (no `eval`).

| Syntax | Meaning |
| --- | --- |
| `A1`, `$B$2` | Cell reference (`A` = first column, `1` = first row; `$` is accepted) |
| `B2:B9` | Range |
| `+ - * / ^ %` | Arithmetic (`50%` is 0.5) |
| `&` | Text join |
| `= <> < > <= >=` | Comparison |

Functions: `SUM`, `AVERAGE` (`AVG`), `MIN`, `MAX`, `COUNT` (numbers), `COUNTA` (non-empty), `PRODUCT`, `MEDIAN`, `ROUND(x, digits)`, `ABS`, `SQRT`, `IF(test, then, else)`, `AND`, `OR`, `NOT`. Ranges ignore text and empty cells. Errors show as `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#CYCLE!` (circular reference) or `#ERROR!` (syntax) in red. References adjust when you insert, delete, move or sort rows and columns. Numbers in cells may be written as `1,234.5`, `$12`, `(5)` or `45%`.

### Merge, split and header repeat

Merged cells keep the text of the top-left cell (empty cells adopt the joined text of the others; covered cells are cleared). Rows or columns crossed by a merged cell cannot be reordered or sorted until the cells are split.

**Table ▸ Flow Table Across Pages** splits a table that runs off the page: the original keeps the rows that fit and the rest moves to new pages as continuation tables with the **header rows repeated**. Limits: the pieces are independent tables afterwards (no live link), formulas in a split table are converted to their current values, and a row is never split in the middle.

### Data merge

*Text ▸ Data Merge…* also fills `<<Field Name>>` markers inside table cells (preview and merged PDF export); cell texts are restored afterwards.

## Charts

### Create and edit

* **Chart tool** (`H`): click or drag; the type comes from the context bar. **Text ▸ Insert Chart…** opens the **gallery** with ~20 presets (columns, grouped, stacked, 100 %, bars, line, multi-line, area, stacked area, pie, donut, scatter, radar, big number, progress bar, progress ring, sparkline) and a palette choice.
* **Double-click** a chart (or *Edit Data…* in the Data panel) for the data grid: type into cells, **paste CSV / TSV / HTML tables** straight into the grid, import a CSV file, add or remove rows and columns. First row = series names, first column = categories (scatter: X values).
* **Link to a table**: choose a table in *Data source*. The chart reads the table's *evaluated* cells (formulas included) and redraws live when the table changes, also on undo. Options: range (`A1:D6`), series in columns or rows, header row, label column. The last values are cached in the chart, so it still renders if the table is deleted. Duplicating or pasting a table together with its chart re-links the copy.
* **Data panel ▸ Chart**: type, title, subtitle, palette and per-series colors, legend position, light / dark theme, background, text size, axis titles, gridlines, min / max, logarithmic axis, sorting, data labels, number format, smooth lines, markers, one color per category, corner radius, gap, overlap, donut hole, start angle, center text, target (progress / ring maximum), alt text.
* **Vibe**: `add_chart`, `edit_chart`, `read_chart`.

Chart text scales with the chart's size, so resizing keeps it legible. Data is not limited to what you see: values may be empty (gaps in lines).

### Types

| Type | Notes |
| --- | --- |
| `column`, `bar` | Grouped (overlap option); rounded ends; `bar` is horizontal |
| `stacked-column`, `stacked-bar`, `percent-column` | Positive and negative values stack separately; percent sums to 100 |
| `line`, `area`, `stacked-area` | Straight or monotone-smoothed (never overshoots); markers |
| `pie`, `donut` | Slices start at 12 o'clock; zero and negative values get no slice |
| `scatter` | First column holds numeric X values |
| `radar` | Categories are the spokes |
| `kpi`, `progress`, `ring`, `sparkline` | Single-value variants from one series: the last value is the number; `kpi` shows the change versus the previous value and a sparkline |

### Export fidelity and accessibility

Charts and tables compile to the same display list as every other object. SVG and PDF contain real paths and text (PDF text uses the fonts you added in the Type panel, otherwise the standard PDF fonts, like all text in OpenFini). Each chart exports an SVG `<title>` and `<desc>`: the alt text if you wrote one, otherwise an automatic description (type, title, categories, series, peak values). Tables export their alt text as `<desc>`. PDF export has no tagged structure, so alt text is SVG only.

### Limits

* Charts are drawn by OpenFini's own renderer: no 3D, no secondary axes, no trend lines, no per-point manual positioning of labels. Labels that would collide are dropped rather than moved.
* Up to 40 series and 2,000 points per series; tables up to 500 rows and 60 columns.
* Cell formatting is per cell (and per column / row via the panel), not per character: there is no inline bold or italic inside one cell.
* Table text uses the normal text engine (wrapping, fonts, alignment) but no hyphenation, tabs or bullets.
* Merged cells cover their neighbors' content permanently (it is cleared on merge).
* A chart linked to a table in another document is not possible; links are within one document.

## File format

See [file-format.md](file-format.md#tables-and-charts): `table` and `chart` node types and `tableStyles`.
