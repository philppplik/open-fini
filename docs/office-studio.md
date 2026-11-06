# Office Studio

> The Office studio is now the **Office Suite**: a launcher (*Home*: new document per app, templates, recent files,
> *Open file…*, *Import from Google…*) plus one app per document kind. This page documents the **Document** app (the
> word processor). Engineers adding apps (Spreadsheet, Presentation, Whiteboard): [office-suite.md](office-suite.md).

The Office Studio is a page-based word processor inside OpenFini: open a Word document, edit it on pages with styles,
lists, tables and images, and save it again as Word, OpenDocument, PDF or another format. Everything runs locally; no
file leaves your device.

This first phase covers **text documents**. Spreadsheets and presentations are planned: their files are already
recognized and you get an honest explanation instead of a broken import (see [Not supported yet](#not-supported-yet)).

## Getting started

* **Open the studio**: the header's **More** menu (the header shows five studios; add Office there in *Settings ▸
  Studios* to get an `Alt+<n>` shortcut), *Studio ▸ Office Studio*, or the command palette.
* **New document**: *Home* in the suite bar or *File ▸ New…* in the Office studio (the launcher: *Blank document* opens the page-size dialog, templates create directly: letter, report, invoice, memo, meeting notes, resume, and the designed newsletter, project proposal, academic paper and event flyer; every template except the blank one comes with a theme, styled tables and, for report, proposal and paper, a table of contents), the *Office Studio* card on the welcome screen, or *Document*
  in the *Start in* row of the New Document dialog. Pick a template, a page size (A4,
  US Letter, US Legal, A5) and the orientation.
* **Open**: *File ▸ Open…*, drag and drop, *Open Folder*, or the operating system's *Open with* menu (`.docx`, `.odt`
  and `.rtf` are registered as "Open with" candidates, never as the default app). In the Office studio, HTML,
  Markdown, text and CSV files open there too; elsewhere they keep opening in the Code studio.
* **Save**: *File ▸ Save* stores an OpenFini document (`.ofini`) that keeps everything. To give someone a Word file
  use **Export** (header button, *File ▸ Export…* or *Document ▸ Export As*). After opening a `.docx`, *Save* still
  writes `.ofini`; export again to `.docx` to update the Word file.

## Editing

* **Toolbar**: paragraph style, font, size, bold / italic / underline / strikethrough, superscript / subscript, text
  and highlight color, alignment, bulleted and numbered lists, indent, line spacing, clear formatting, link, image,
  table (grid picker or custom size), page break, footnote, *Design*, the theme picker, *Track changes*, find,
  *Print* / *Web* layout and zoom. Arrow keys move between toolbar buttons.
* **Styles**: Normal, Title, Subtitle, Heading 1-6, Quote, Code and List Paragraph are built in. The *Styles* tab of
  the sidebar applies a style, *Modify* changes it for every paragraph that uses it (font, size, color, weight,
  spacing, alignment, *Based on*, *Next paragraph*, outline level), *New style…* creates one from the caret paragraph.
  Styles inherit through *Based on* and are saved in DOCX, ODT and RTF. **Update from selection** (sidebar, or
  *Format ▸ Update Style to Match Selection*) makes the caret paragraph's direct formatting part of its style.
* **Outline**: the *Outline* tab lists the headings; click one to jump there.
* **Lists**: bullets and numbers with nine levels (`Tab` / `Shift+Tab`); `Enter` in an empty item ends the list.
* **Tables**: insert with the grid picker; `Tab` moves to the next cell (and adds a row at the end). *Table* menu or
  right-click: insert / delete rows and columns, merge (select across cells) and split cells, header row, cell
  shading, borders, **Table Styles…** (see below), *Sort Rows Ascending / Descending by This Column* (numbers sort
  numerically; the header and a total row stay put), *Add Total Row* (sums every numeric column, keeping decimals
  and thousands separators), *Distribute Columns Evenly* and *Fit Table to Page Width*. Sorting and totals refuse
  tables with merged cells.
* **Images**: *Insert ▸ Image…*, paste, or drag and drop PNG, JPEG, GIF, WebP or SVG. Images are inline (they flow
  with the text). Double-click an image for its size, alternative text and **text wrapping** (in line, float left or
  float right with the text flowing around it).
* **Footnotes**: *Insert ▸ Footnote…*; the notes are listed at the end of the document in the editor, double-click a
  number to edit it. DOCX and ODT exports write real footnotes.
* **Header and footer**: *Document ▸ Header & Footer…* (or double-click the header area). `{PAGE}`, `{PAGES}` and
  `{DATE}` become fields, for example `Page {PAGE} of {PAGES}`.
* **Page setup**: size (A3, A4, A5, Letter, Legal or custom), orientation, margins, header and footer distance and
  columns of the first section (see *Sections and columns*).
* **Find and replace**: `Mod+F` / `Mod+H`, with match case, whole words and regular expressions (`$1` groups in the
  replacement).
* **Undo**: every edit is a step of the document history (`Mod+Z`, `Mod+Shift+Z`, the History of the app), typing is
  grouped.
* **Spelling**: the browser's / system's spell checker underlines words (*View ▸ Check Spelling as You Type*).
* **Status bar**: pages, words, characters and the selection's word count; *Document ▸ Word Count…* has details.
* **Dark mode**: the page stays white like paper. *View ▸ Dark Page in Dark Mode* shows a dark page instead.

### Design and review

All of this lives in `engine/office/design.js` (pure, shared by the editor, the codecs and the Vibe tools) and the
dialogs in `ui/office/design-ui.js`; every action is one undo step.

* **Design** (*Format ▸ Design…* or the palette button): a live preview, seven **themes** (Office, Classic, Modern,
  Elegant, Bold, Minimal, Ocean: heading and body fonts, heading, accent and text colors), a **custom theme** (your
  own fonts and colors) and four **style sets** (Default, Compact, Airy, Formal: spacing, line height, title size and
  alignment). The toolbar's theme picker applies a theme in one click. Themes rewrite the built-in styles, so direct
  formatting on runs still wins.
* **Table Styles…** (*Table* menu): a gallery of eight styles (Plain grid, Light, Theme accent, Blue, Green, Orange,
  Dark, Minimal) with *Header row*, *Banded rows*, *First column* and *Total row* options. The colors are written into
  the cells (shading, header text color, bold), so every export keeps them; *Theme accent* follows the theme.
* **Sections and columns**: *Insert ▸ Section Break (Columns)…* starts a new section with one to four columns, on the
  same page (continuous) or a new page. Insert another break with one column to return to full width. In the editor a
  multi-column section is one box that does not split across pages, so keep it shorter than a page.
* **Text boxes**: *Insert ▸ Text Box…* adds a floating box (plain text, one paragraph per line, width, wrap left /
  right / in line, fill and border) at the caret; text wraps around it. Double-click a box to edit or delete it.
* **Table of contents**: *Insert ▸ Table of Contents* lists the headings (three levels) with page numbers in print
  layout; it updates itself, and a click on an entry jumps there.
* **Track changes** (*Document ▸ Track Changes* or the toolbar button): your typing is marked as an insertion
  (underlined, green) and deleted text stays struck through (red) with your name (*Settings ▸ Collaboration*
  nickname, else the document author). *Document ▸ Review Changes…* lists every change with *Accept* / *Reject*, plus
  *Accept all* / *Reject all*. Splitting and joining paragraphs is not tracked; text you inserted yourself is removed
  when you delete it.

| Feature | DOCX | ODT, RTF, HTML, Markdown, text, PDF |
| --- | --- | --- |
| Themes, style sets, table styles | kept (as styles and cell formatting) | kept (as styles and cell formatting) |
| Sections with columns | kept (section properties per section, continuous or next page) | one column; a *next page* section becomes a page break |
| Table of contents | a real TOC field (Word refreshes page numbers) with the current entries | plain paragraphs |
| Text boxes | indented paragraphs after their anchor paragraph | indented paragraphs after their anchor paragraph |
| Wrapped images | inline | inline |
| Tracked changes | kept (`w:ins` / `w:del` with author; read back from Word files too) | accepted on export |

The export dialog lists what was converted.

### Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Bold / italic / underline / strikethrough | `Mod+B` / `Mod+I` / `Mod+U` / `Mod+Shift+X` |
| Superscript / subscript | `Mod+.` / `Mod+,` |
| Align left / center / right / justify | `Mod+L` / `Mod+E` / `Mod+R` / `Mod+J` |
| Heading 1-3 / Normal | `Mod+Alt+1` … `Mod+Alt+3` / `Mod+Alt+0` |
| Bulleted / numbered list | `Mod+Shift+L` / `Mod+Shift+N` |
| Indent / outdent | `Tab` / `Shift+Tab` in a list, `Mod+]` / `Mod+[` |
| Line break / page break | `Shift+Enter` / `Mod+Enter` |
| Link / footnote | `Mod+K` / `Mod+Alt+F` |
| Find / replace | `Mod+F` / `Mod+H` |
| Paste as plain text | `Mod+Shift+V` |
| Clear formatting | `Mod+Space` |
| Zoom in / out / 100% | `Mod+=` / `Mod+-` / `Mod+0` |
| Open the link at the caret | `Ctrl` + click |

## Formats and fidelity

| Format | Open | Save / export | What is kept | Simplified or not supported |
| --- | --- | --- | --- | --- |
| Word `.docx` (`.docm`; templates `.dotx`, `.dotm` open as a new untitled document) | yes | yes | text formatting, named paragraph styles with inheritance, theme fonts, lists (numbering definitions, levels, list styles), tables (grid widths, `gridSpan`, `vMerge`, shading, borders, header rows), inline and floating images (PNG, JPEG, GIF, SVG with PNG fallback), hyperlinks (also as fields), footnotes and endnotes (as footnotes), page breaks, header and footer (default) with page fields, page size, margins, columns, document properties | character styles become direct formatting; text boxes and equations become plain text; floating images become inline; comments are dropped; charts, SmartArt, shapes, EMF/WMF images and OLE objects are dropped; sections keep their columns but share one page size and margins; first/even page headers are replaced by the default one; macros are never run (`.docm` content is read as a document only) |
| OpenDocument `.odt` (`.fodt`; template `.ott` opens as a new untitled document) | yes | yes | the same set as DOCX: styles and automatic styles, nested lists with list styles, tables with spans and cell properties, frames with images, notes, links, page layout of the default master page, header and footer, metadata | sections and indexes become plain paragraphs; text frames become text; drawing shapes and embedded objects are dropped |
| Rich Text `.rtf` | yes | yes | fonts, colors, sizes, bold / italic / underline / strike, sub / superscript, highlight, paragraph alignment, spacing, indents, styles (stylesheet), lists (`\pn` and `\ls`), tables with merged cells and shading, PNG/JPEG pictures, footnotes, hyperlinks and page fields, headers and footers, page size and margins, Unicode (`\uN`) | non-Windows-1252 code pages are read as Windows-1252; WMF/EMF pictures and nested tables are simplified; SVG images are written as PNG |
| HTML `.html` | yes (sanitized) | yes | headings, paragraphs, inline formatting and colors, lists, tables with spans, `data:` images, links, footnote sections; exports clean semantic HTML with embedded CSS (`@page` size and margins) and data-URI images | scripts, styles, frames, forms, event handlers and `javascript:` links are removed; remote images are not downloaded |
| Markdown `.md` | yes | yes | headings, emphasis, links, lists, GFM tables, code blocks, block quotes, footnotes, images as data URIs | fonts, colors, alignment and page setup are not representable; merged cells are repeated empty; underline, highlight and sub/superscript use inline HTML |
| Plain text `.txt` | yes | yes | paragraphs, form feeds as page breaks; lists and tables as text on export | all formatting |
| PDF | no (opens in the Layout studio) | yes | pages with the document's page size, margins, headers and footers with page numbers, styles, lists, tables (header rows repeat on new pages), images | text uses the PDF standard fonts (Helvetica, Times or Courier chosen from the font name), so characters outside Windows-1252 (for example Chinese or emoji) print as `?`; links are not clickable; footnotes are printed as endnotes; a paragraph that does not fit is moved to the next page as a whole, a table row never splits |

DOCX and ODT were implemented clean-room from ECMA-376 and ISO/IEC 26300; nothing was copied from other office
suites. Files written by Office Studio open in Microsoft Word, LibreOffice and Google Docs; they were verified with
the app's own reader and with synthetic fixtures in `tests/office/` (not every Word version was checked by hand).

### Robustness

Readers never run code and never fetch anything. ZIP packages are checked before they are unpacked: at most 4000
entries, 80 MB per entry and 300 MB in total (zip bombs), and entry names with `..`, absolute or drive paths are
skipped. XML entities are never expanded (no "billion laughs"), nesting deeper than 256 levels is cut, RTF groups
deeper than 300 levels are skipped and every reader turns malformed input into a clear error or a partial document.
What an import kept, simplified and dropped is listed in the **import report** (*Document ▸ Import Report…*, also
shown as a toast with *Details*).

## Not supported yet

| File | What happens |
| --- | --- |
| Google Docs `.gdoc` (and `.gsheet`, `.gslides`) | These are only shortcuts to a document in Google Drive. The dialog explains *File ▸ Download ▸ Microsoft Word (.docx)* (or ODT) and offers **Open in browser** for the document's address (it asks before leaving the app). There is no Google account integration. |
| Apple Pages `.pages` | Export from Pages with *File ▸ Export To ▸ Word…* and open the `.docx`. |
| Word 97-2003 `.doc`, `.wps`, `.wpd` | The old binary formats are not read. Save as `.docx` in Word, LibreOffice or Google Docs first. |
| Excel, Calc, Numbers (`.xlsx`, `.xls`, `.ods`, `.numbers`) | Opened by the Spreadsheet app when this version includes it; otherwise a dialog explains it (save as CSV and use *Table ▸ Import Table…* in the Layout studio, or export a PDF). `.xls`/`.numbers` always need converting first. |
| CSV / TSV | In the Office studio the same dialog appears with **Open as text (Code studio)**; *Table ▸ Import Table…* in the Layout studio turns it into an editable table. |
| PowerPoint, Impress, Keynote (`.pptx`, `.ppt`, `.odp`, `.key`) | Opened by the Presentation app when this version includes it; otherwise export the slides as PDF and open the PDF (every slide becomes an editable page in the Layout studio). |
| Excalidraw, tldraw (`.excalidraw`, `.tldraw`) | Opened by the Whiteboard app when this version includes it; otherwise export SVG/PNG from the tool. |

Comments in Word files, mail merge, drawing shapes, different first/even page headers and page borders are not
supported yet.

## How pages are drawn

The editor is a single editable column on top of page sheets: block heights are measured and a block that does not
fit on the current page moves to the next one, so page breaks are close to, but not always identical with, Word's.
A paragraph or table taller than a page runs across the page gap. *Web layout* drops the pages and shows one column.
The PDF export uses its own layout (the Layout studio's text engine) and can break pages at slightly different places.

## Vibe Studio

The assistant has ten `office_` tools (see [vibe-studio.md](vibe-studio.md)): it can create documents, read the
outline and text, insert Markdown or typed blocks, replace text, apply styles and formatting, insert tables, change
page setup, headers and footers, and export (after your approval). The built-in skill **write-business-document**
covers letters, reports, proposals, memos and resumes. Semantic tools work by heading (`office_list_sections`,
`office_read_section`, `office_rewrite_section`, `office_move_section`), `office_check_accessibility` checks the
document, and cross-app tools turn tables into a spreadsheet, a spreadsheet range into a table and the outline into
slides ([vibe-studio.md](vibe-studio.md#office-semantic-and-cross-app-tools)). Design and review tools apply themes and
style sets, table styles, sections, text boxes, a table of contents, sort and total tables and handle tracked changes
([vibe-studio.md](vibe-studio.md#office-design-and-review-tools)); skills: `write-report`, `polish-document`,
`accessibility-check-document`, `translate-document-keeping-format`, `meeting-notes`, `design-document`. With AI enabled, the editor's right-click menu has *AI ▸
Improve writing, Fix spelling and grammar, Summarize, Translate…, Change tone…* for the selection (or the whole
document).

## Architecture

| Part | Files |
| --- | --- |
| Model, styles, editing operations, find/replace, tables | `app/src/engine/office/model.js` |
| DOCX / ODT / RTF / HTML / Markdown and text codecs, routing | `app/src/engine/office/{docx,odt,rtf,html,markdown,index}.js` |
| PDF layout and export | `app/src/engine/office/pdf.js` (uses `engine/layout/` and `engine/backends/pdf.js`) |
| ZIP limits, XML parser, images, import report | `app/src/engine/office/{zip,xml,media,report}.js` |
| Storage in `.ofini`, undo integration | `app/src/core/office.js` (`commitOffice`) |
| Workspace, editor, dialogs, context menu, file opening | `app/src/ui/office/`, `app/styles/office.css` |
| Studio definition and menus (one registration block) | `app/src/studios/office.js`, `app/src/studios/index.js` |
| Suite contract adapter (Document app) | `app/src/office/document/{manifest,app}.js` ([office-suite.md](office-suite.md)) |
| Commands | `app/src/commands/office.js` |
| Vibe tools | `app/src/vibe/tools/office.js` |

The engine modules are pure (no DOM) and covered by `tests/office/`. The whole studio (suite host, launcher, apps) is loaded on first use; only the
studio definition, the menus and the `.ofini` storage hook are part of the startup bundle.
