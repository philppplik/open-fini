# Office Studio

The Office studio is a page-based word processor inside OpenFini. Open a Word document, edit it on pages with styles, lists, tables and images, and export it as Word, OpenDocument, PDF or another format. Everything runs locally. This first phase covers text documents; spreadsheets and presentations are not supported yet.

## Getting started

The Office studio opens on **Home**: create a blank document or start from a template (letter, report, invoice, memo,
meeting notes, resume), reopen a recent Office file, *Open file…*, or read how to bring files from Google Docs, Sheets
and Slides (*Import from Google…*: download a .docx/.xlsx/.pptx copy first; OpenFini has no Google account
connection). The bar above the document switches between Home and the Office apps of this version.

- **Open the studio:** the header's *More* menu, *Studio ▸ Office Studio*, or the command palette. Add it to the header in *Settings ▸ Studios* to get an `Alt` shortcut.
- **New document:** *File ▸ New…* in the studio, the Office card on the welcome screen, or *Document* in the *Start in* row. Templates: blank, letter, report, resume; sizes A4, US Letter, US Legal, A5.
- **Open:** *File ▸ Open…*, drag and drop, or the operating system's *Open with* (`.docx`, `.odt` and `.rtf` are Open-with candidates, never the default). Inside the Office studio HTML, Markdown, text and CSV files open here too; elsewhere they open in the Code studio.
- **Save:** *File ▸ Save* writes an `.ofini` (or, for opened text-like files, the same format, see [[Save in Original Format]]). To give someone a Word file use **Export** (header, *File ▸ Export…*, *Document ▸ Export As*).

## Editing

| Feature | Notes |
| --- | --- |
| Toolbar | Paragraph style, font, size, bold, italic, underline, strikethrough, super/subscript, colors, alignment, lists, indent, line spacing, clear formatting, link, image, table, page break, footnote, find, Print/Web layout, zoom |
| Styles | Normal, Title, Subtitle, Heading 1-6, Quote, Code, List Paragraph. *Modify* changes a style everywhere it is used; *New style…* creates one |
| Outline | Headings list; click to jump |
| Lists | Nine levels with `Tab` and `Shift+Tab` |
| Tables | Grid picker; `Tab` moves between cells; merge, split, header row, shading, borders |
| Images | PNG, JPEG, GIF, WebP, SVG inline; double-click for size and alt text |
| Footnotes | *Insert ▸ Footnote…* |
| Header and footer | *Document ▸ Header & Footer…* with `{PAGE}`, `{PAGES}`, `{DATE}` |
| Page setup | A3, A4, A5, Letter, Legal or custom; orientation; margins; columns (kept in DOCX and ODT, shown as one column in the editor and PDF) |
| Find and replace | `Mod+F` / `Mod+H`, match case, whole words, regular expressions |
| Spelling | Your browser or system spell checker |

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Bold, italic, underline, strikethrough | `Mod+B`, `Mod+I`, `Mod+U`, `Mod+Shift+X` |
| Superscript, subscript | `Mod+.`, `Mod+,` |
| Align left, center, right, justify | `Mod+L`, `Mod+E`, `Mod+R`, `Mod+J` |
| Heading 1-3, Normal | `Mod+Alt+1` to `3`, `Mod+Alt+0` |
| Bulleted, numbered list | `Mod+Shift+L`, `Mod+Shift+N` |
| Line break, page break | `Shift+Enter`, `Mod+Enter` |
| Link, footnote | `Mod+K`, `Mod+Alt+F` |
| Paste as plain text | `Mod+Shift+V` |
| Clear formatting | `Mod+Space` |

## Formats

| Format | Open | Save or export | Main simplifications |
| --- | --- | --- | --- |
| Word `.docx` (`.docm`, `.dotx`) | yes | yes | Character styles become direct formatting; text boxes and equations become plain text; floating images become inline; tracked deletions and comments are dropped; charts, SmartArt and shapes are dropped; macros never run |
| OpenDocument `.odt` | yes | yes | Sections and indexes become paragraphs; drawing shapes are dropped |
| Rich Text `.rtf` | yes | yes | Non-Windows-1252 code pages read as Windows-1252 |
| HTML | yes (sanitized) | yes | Scripts, styles, frames, forms removed; remote images not downloaded |
| Markdown, plain text | yes | yes | Fonts, colors and page setup not representable |
| PDF | no (opens in Layout) | yes | Standard PDF fonts only: characters outside Windows-1252 print as `?`; links not clickable |

Word 97-2003 `.doc`, Apple `.pages`, Google `.gdoc`, spreadsheets and presentations are detected and explained instead of imported (save as `.docx` first; export slides as PDF to open them in Layout). The import report (*Document ▸ Import Report…*) lists what was kept, simplified or dropped.

## How pages are drawn

The editor is one editable column on top of page sheets; a block that does not fit moves to the next page, so page breaks are close to, but not identical with, Word's. The PDF export uses its own layout and may break at slightly different places.

## Limits

Comments, tracked changes, mail merge, tables of contents, multiple sections, text boxes and floating objects are out of scope for this phase.

## Vibe

Ten `office_` tools create, read, edit, format and export documents; the built-in skill `write-business-document` covers letters, reports, proposals, memos and resumes ([[Vibe Tools Reference]]). The right-click menu gains AI actions for writing.

## See also

- [[File Formats]]
- [[Save in Original Format]]
- [[Studio Overview]]
- [[Keyboard Shortcuts]]
