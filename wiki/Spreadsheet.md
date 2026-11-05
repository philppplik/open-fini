# Spreadsheet

The Spreadsheet is the Office studio's app for budgets, lists and calculations. It opens and saves Excel workbooks
(`.xlsx`, `.xlsm`; `.xltx` opens as a new workbook), OpenDocument spreadsheets (`.ods`, `.fods`; `.ots` opens as new)
and CSV / TSV, and exports PDF and PNG. Everything runs locally.

## Getting started

- **New:** Office ▸ *Home* ▸ *Blank spreadsheet*, *Budget* or *Invoice table*, or the *Spreadsheet* button in the
  suite bar.
- **Open:** *File ▸ Open…*, drag and drop, or *Open with* from the operating system. In the Office studio `.csv` and
  `.tsv` files open here.
- **Save:** *File ▸ Save* writes the original format again ([[Save in Original Format]]); CSV keeps only the values of
  the active sheet. *Sheet ▸ Export* writes `.xlsx`, `.ods`, `.csv`, PDF or PNG copies.

## Working with cells

| Task | How |
| --- | --- |
| Enter a value or formula | Select a cell and type; `Enter` / `Tab` commit and move. `=` starts a formula (click cells to insert references) |
| Edit | `F2` or double-click; `Alt+Enter` adds a line break; `Escape` cancels |
| Move and select | Arrow keys, `Ctrl`+arrow (edge of a block), `Shift` extends, `Ctrl+A`, click headers for whole rows / columns |
| Copy, cut, paste | `Ctrl+C`, `Ctrl+X`, `Ctrl+V` (tab-separated text, so other spreadsheets understand it); *Edit ▸ Paste Values Only* |
| Fill | Drag the small square at the bottom right of the selection; `Ctrl+D` / `Ctrl+R`. Number series continue |
| Format | Ribbon or *Format* menu: font, bold / italic / underline, colors, alignment, wrap, merge, number formats, decimals, borders, conditional formatting |
| Column width, row height | Drag the header border; double-click it to fit the content |
| Sort and filter | *Data ▸ Sort*, *Data ▸ Filter* (buttons in the header row with a value checklist) |
| Freeze panes | *View ▸ Freeze Panes* (at the selection), *Freeze Top Row*, *Freeze First Column* |
| Rows and columns | *Insert* and *Data* menus; formulas, merged cells and charts follow |
| Charts | *Insert ▸ Chart…*: column, bar, line, area, pie, donut, scatter. Drag to move, corner to resize, double-click to edit |
| Sheets | Tabs at the bottom: `+` adds, double-click renames, drag reorders, right-click for more |
| Find and replace | `Ctrl+F`, `Ctrl+H` |

The status bar shows the sum, average and count of the selected cells.

## Formulas

Formulas use English function names and commas, as in Excel: `=SUM(B2:B10)`, `=IF(C2>100,"high","low")`,
`=VLOOKUP(A2,Prices!A:C,3,FALSE)`, `=XLOOKUP(E2,A:A,B:B,"none")`, `=TEXT(TODAY(),"yyyy-mm-dd")`. About 150 functions
are available (math, statistics, COUNTIF / SUMIF families, lookups, text, dates, finance); *Data ▸ Insert function*
lists them. References to other sheets look like `Sheet2!A1` or `'My data'!A1`. Errors show as `#DIV/0!`, `#N/A`,
`#NAME?`, `#REF!`, `#VALUE!`, `#NUM!`, `#CYCLE!` for circular references and `#SPILL!` when an array result is blocked.

FILTER, SORT, SORTBY, UNIQUE, SEQUENCE and TRANSPOSE return several values that spill into the empty cells below and to
the right, for example `=SORT(UNIQUE(A2:A100))` or `=FILTER(A2:C50,C2:C50>1000)`. *Data ▸ Named Ranges…* gives cells a
name (`=SUM(Sales)*TaxRate`).

## Tables and data tools

* *Format ▸ Format as Table…*: header, banded rows and a total row.
* *Data ▸ Data Validation…*: drop-down lists (Alt+Down opens them) and number or text-length limits for typed input.
* *Edit ▸ Paste Special…*: paste values, formulas or formats, add/subtract/multiply/divide, skip blanks, transpose.
* *Data ▸ Group Rows / Group Columns* (Alt+Shift+Right), *Collapse Group*, *Expand All Groups*.
* *Insert ▸ Pivot Table…*: sums, counts or averages per category on a new sheet (run again after changes).
* *Insert ▸ Sparkline…*: a small line or column chart inside a cell.
* *Sheet ▸ Page Setup…* and *Print…*: orientation, paper, margins, print area, gridlines and fit to one page; PDF export
  uses the same settings.

## Formats

| Format | Open | Save | Notes |
| --- | --- | --- | --- |
| Excel `.xlsx` / `.xlsm` | yes | yes | Macros, named ranges, data validation, pictures and comments are not kept; the import report lists them |
| OpenDocument `.ods` / `.fods` | yes | yes | Charts and conditional formatting are not written to ODS yet |
| CSV / TSV | yes | yes | One sheet of values |
| PDF, PNG | no | export | PDF contains every sheet; PNG the active one |

Excel 97-2003 `.xls` files must be saved as `.xlsx` first.

## Vibe

Ask Vibe to build or change a spreadsheet: it reads ranges, writes values and formulas, formats cells, adds sheets and
charts, tables, names, validation, groups, pivots and sparklines with the `sheet_` tools ([[Vibe Tools Reference]]);
`sheet_chart_data` hands a range to presentations and documents. Every change is one undo step.

## Limits

Tables, names, validation, groups, page setup and sparklines are kept in OpenFini files but not yet in XLSX or ODS.
Pivot tables do not refresh by themselves. Pictures, cell comments from files and more than one selection range are not
supported yet. Numbers and dates are displayed in US English format.

## See also

- [[Office Studio]]
- [[File Formats]]
- [[Save in Original Format]]
