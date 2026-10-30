# Spreadsheet (Office Suite)

The Spreadsheet app is the second app of the Office Suite (`kind: "sheet"`, contract: [office-suite.md](office-suite.md)).
It opens, edits and saves Excel workbooks (`.xlsx`, `.xlsm`, `.xltx` as a template), OpenDocument spreadsheets
(`.ods`, flat `.fods`, `.ots` as a template) and CSV / TSV, and exports PDF and PNG. Everything is lazy: the manifest
is registered when the Office suite loads, the implementation when the first spreadsheet opens.

## Using it

* **New**: Office ▸ Home ▸ *Blank spreadsheet*, *Budget* (planned vs. actual with totals, a negative-difference rule and
  a chart) or *Invoice table* (items, quantities, prices, tax and total). **Open**: File ▸ Open or drag a file in; in
  the Office studio `.csv` / `.tsv` open here too. **Save**: File ▸ Save writes the original format again (CSV and TSV
  are marked lossy: one sheet of values); the `.ofini` document keeps everything.
* **Typing**: select a cell and type; Enter / Tab commit and move, Shift reverses, Escape cancels, F2 or a double click
  edits, Alt+Enter adds a line break. Input is parsed like other spreadsheets: `1,234.5`, `$12`, `12 €`, `12%`,
  `2026-10-28`, `10/28/2026`, `28.10.2026`, `12:30`, `TRUE`; a leading `'` keeps text as text. `=` starts a formula;
  while typing one, clicking a cell inserts its reference.
* **Selection and keys**: arrows (Ctrl jumps to the edge of a block, Shift extends), Home, Ctrl+Home / Ctrl+End,
  Page Up / Down, Ctrl+A, Delete clears, Ctrl+C / X / V copy and paste TSV + HTML (formulas move with the paste inside
  OpenFini), Ctrl+D / Ctrl+R fill down / right, Ctrl+B / I / U, Ctrl+5 (strikethrough), Ctrl+F / Ctrl+H find and
  replace, Ctrl+; today's date, Ctrl+wheel zoom. Drag the square at the bottom right of the selection to fill (numbers
  continue a series).
* **Format** (ribbon and Format menu): font, size, bold / italic / underline / strikethrough, text and fill colors,
  alignment, wrap, merge, number formats (presets and custom codes such as `#,##0.00`, `0.0%`, `yyyy-mm-dd`,
  `"$"#,##0.00_);("$"#,##0.00)`), decimals, borders, column width / row height (drag a header border, double-click it
  to autofit), conditional formatting (comparisons, text contains, empty / not empty, red-to-green color scale).
* **Data**: sort ascending / descending (a single cell sorts its block, keeping a text header row), filter (buttons in
  the header row, value checklists), freeze panes (at the selection, top row, first column), insert / delete rows and
  columns (formulas, merges, charts and rules follow).
* **Charts**: Insert ▸ Chart… (column, stacked column, bar, line, area, pie, donut, scatter) from a range whose first
  row holds the series names and first column the categories. Drag to move, drag the corner to resize, double-click to
  edit, Delete removes it. Charts are drawn by the Layout studio's chart engine (`engine/layout/chart-render.js`).
* **Sheets**: tabs at the bottom (`+` adds, double-click renames, drag reorders, right-click for duplicate / delete).
* **Status bar**: sum, average and count of the selection.
* **Comments and Edit together**: Collaboration ▸ Add comment anchors to the active cell (`cell:<sheet id>!B3`);
  live editing merges per cell (see Collaboration below).

## Formulas

Syntax as in Excel / LibreOffice with English function names and commas: `=SUM(B2:B10)`, `=Sheet2!A1*2`,
`='My data'!B:B`, `=$A$1`, operators `+ - * / ^ & = <> < > <= >= %`. Errors: `#DIV/0!`, `#N/A`, `#NAME?`, `#NUM!`,
`#REF!`, `#VALUE!`, `#NULL!`, `#ERROR!` (syntax) and `#CYCLE!` (circular reference).

Functions (about 150): math and statistics (SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTBLANK, PRODUCT, MEDIAN, MODE,
STDEV(.S/.P), VAR(.S/.P), LARGE, SMALL, RANK, ROUND/ROUNDUP/ROUNDDOWN, TRUNC, INT, ABS, SIGN, SQRT, POWER, EXP, LN,
LOG, LOG10, MOD, QUOTIENT, CEILING, FLOOR, PI, RAND, RANDBETWEEN, SUMSQ, SUMPRODUCT), conditional aggregates (COUNTIF(S),
SUMIF(S), AVERAGEIF(S), MAXIFS, MINIFS with `<`, `>=`, `<>`, `*` / `?` wildcards), logic (IF, IFS, IFERROR, IFNA,
SWITCH, CHOOSE, AND, OR, XOR, NOT), information (IS* functions, NA, N), lookup (VLOOKUP, HLOOKUP, XLOOKUP, XMATCH,
LOOKUP, INDEX, MATCH, ROW(S), COLUMN(S)), text (LEN, LEFT, RIGHT, MID, UPPER, LOWER, PROPER, TRIM, CLEAN, CONCAT,
CONCATENATE, TEXTJOIN, REPT, SUBSTITUTE, REPLACE, FIND, SEARCH, EXACT, VALUE, TEXT, FIXED, CHAR, CODE, T), date and time
(TODAY, NOW, DATE, TIME, YEAR … SECOND, WEEKDAY, EDATE, EOMONTH, DAYS, DATEDIF, NETWORKDAYS, DATEVALUE; dates are serial
days of the 1900 system) and finance (PMT, FV, PV). The list is `FUNCTION_NAMES` in `office/sheet/functions.js`.

The engine (`office/sheet/formula.js`) parses to an AST (no `eval`), keeps a dependency index (single cells and ranges,
formula cells per column for range lookups) and recalculates only what changed and what depends on it. Dependencies
are evaluated in an explicit post-order, so long chains do not overflow the stack; cycles become `#CYCLE!`. Volatile
functions (TODAY, NOW, RAND) recalculate on every change. References are rewritten for fill / paste (`shiftFormula`),
row / column insertion and deletion (`adjustFormula`) and sheet renames.

## Model

Plain JSON, immutable values (see the header of `office/sheet/model.js`):

```
{ version: 1, active: "s1", meta: { title }, media: {},
  sheets: [{ id, name, pos, cells: { "B3": { v?, f?, s? } }, cols: { "1": 140 }, rows: { "0": 30 },
             merges: ["A1:C1"], freeze: { r, c } | null, filter: { range, hide: { "<col>": [texts] } } | null,
             cf: [{ id, range, type, a?, b?, style?, colors? }], charts: [{ id, type, range, title, r, c, w, h, seriesIn? }] }] }
```

A cell's `v` is a number, string or boolean, `f` a formula without `=`, `s` a style `{ b, i, u, st, color, fill, ha,
va, wrap, nf, font, size, bd: { t, r, b, l } }`. Number formats are always format codes (`nf`); the toolkit presets
convert with `fmtToCode` (`office/sheet/numfmt-code.js`, which also renders codes and backs TEXT()). The active sheet
(`active`) is view state and does not create undo steps; every other change goes through `commitOffice`.

## Formats

| Format | Read | Write | Notes |
| --- | --- | --- | --- |
| XLSX / XLSM / XLTX | values, shared / inline strings, formulas (shared formulas expanded, `_xlfn.` prefixes), cached values, number formats, fonts, fills, borders, alignment, wrap, merges, column widths, row heights, hidden rows / columns, frozen panes, autofilter range, conditional formats (cellIs, containsText, blanks, 2-color scales), bar / column / line / area / pie / doughnut / scatter charts, 1904 dates | everything the model has, with cached results | macros, named ranges, data validation, pictures, shapes, array-formula semantics, filter criteria and comments are reported in the import report |
| ODS / FODS / OTS | values, OpenFormula (`of:=SUM([.A1:.B2])`), styles, data styles, merges, sizes, frozen panes and active sheet (settings.xml) | values, formulas, styles, data styles, merges, sizes, frozen panes, filter range | charts and conditional formats are not written yet (the export says so) |
| CSV / TSV | separator sniffing (comma, semicolon, tab), typed input parsing | active sheet values (dates formatted) | lossy |
| PDF | – | every sheet, A4 pages (columns that do not fit continue on further pages), charts | via `toolkit/export.js` |
| PNG | – | the active sheet's used range at 2x | |

Hostile input: ZIP limits and safe names from `engine/office/zip.js`, the XML parser never expands entities, huge
repeated ODS rows and columns are not expanded, at most 2,000,000 cells per range in functions.

## Architecture

| Part | File |
| --- | --- |
| Manifest | `app/src/office/sheet/manifest.js` (registered in `office/index.js`) |
| Implementation (create, open, save, mount, describe, adapters, `calcFor(doc)`) | `app/src/office/sheet/app.js` |
| Model and operations, templates, records | `app/src/office/sheet/model.js` |
| Formula engine / functions / values | `formula.js`, `functions.js`, `values.js` |
| Number format codes | `numfmt-code.js` |
| Codecs | `xlsx.js`, `ods.js`, `csv.js` |
| Cell look, chart data, export display lists | `render.js` |
| Grid UI (canvas, virtual axes from `toolkit/virtual.js`, frozen panes, editor, fill handle, charts) | `view.js` |
| Dialogs (function, chart, conditional formatting, filter, find / replace, number format) | `dialogs.js` |
| Commands and the context menu (registered when the app loads) | `app/src/commands/office-sheet.js` |
| Menus (`officeKinds: ["sheet"]`) | `app/src/studios/office.js` |
| Styles (loaded on demand) | `app/styles/office-sheet.css` |
| Vibe tools | `app/src/vibe/tools/office-sheet.js` (group *Spreadsheets*) |
| Tests | `tests/office/sheet-formula.test.js`, `tests/office/sheet-codecs.test.js` |

The grid draws into one canvas: four quadrants (frozen rows × frozen columns), only the visible rows and columns, so a
sheet of a million rows costs the same as a small one. A transparent scroller on top provides native scrolling and
focus; the screen reader gets the active cell and its value through a live region and the formula bar.

## Vibe

`sheet_describe`, `sheet_read_range` (computed values, optional formulas and formats, 5000 cells per call),
`sheet_write_range` (typed input, `=` formulas), `sheet_set_formula` (with `fillTo`), `sheet_format`, `sheet_add_sheet`,
`sheet_add_chart`. Each edit is one undo step labelled "Vibe: …". `office_describe` uses the app's `aiAdapter.describe`;
`office_new` creates spreadsheets from the templates; `office_export` writes every format above.

## Collaboration

`collabAdapter.records` flattens the workbook into `cell:<sheet id>!A1` records (one per cell) and `sheet:<id>`
records (name, position, sizes, merges, freeze, filter, rules, charts); `meta:title` is shared, the active sheet is
not. Concurrent edits of different cells merge; the same cell goes to the later writer.

## Known limits

Named ranges, array formulas / dynamic arrays (spilling), INDIRECT / OFFSET, data validation, pictures, cell comments
from files, pivot tables, rich text inside a cell, more than one selection range, charts and conditional formats in
ODS output, legacy `.xls`. The display locale of numbers and dates is US English (formulas use English names and commas).
