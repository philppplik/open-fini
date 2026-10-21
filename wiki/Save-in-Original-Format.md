# Save in Original Format

A file you opened with *File ▸ Open* is saved again in the format it came from: a `.txt` stays a `.txt`, a `.docx` stays a `.docx`. OpenFini asks for `.ofini` only when your edits need more than that format can hold. This behavior is on by default (since 0.6) and described here with its exact rules and limits.

## The switch

*Settings ▸ General ▸ Save opened files in their original format when possible* (`saveOriginalFormat`). Turn it off and Save always writes `.ofini`.

## What saves back to what

| Opened as | Saved back as | Stays that way while | When it no longer fits |
| --- | --- | --- | --- |
| Text and code files (`.txt`, `.md`, `.json`, `.csv`, `.css`, `.js`, `.html`, `.tex` and more) | The same file, UTF-8 | The project is still exactly that one file: no second file, no design pages, no attached images, no Git repository, not renamed | One dialog |
| Word-processor and text files in the Office studio (`.docx`, `.odt`, `.rtf`, `.html`, `.md`, `.txt`) | The same format, written by the Office writers | Always. A toast lists what the format cannot store and offers *Save as .ofini* | Not applicable |
| SVG | SVG through the exporter | A single-page plain vector drawing: no pixel layers, adjustment layers, masks, live effects, blend modes or master pages | One dialog |
| PNG, JPEG, WebP, GIF, TIFF, PSD, PDF, IDML, Illustrator, Sketch | Never silently: Save writes `.ofini` | Not applicable, because writing the flat file back would destroy layers or data | Save As offers PNG, JPEG or WebP as a flattened export next to `.ofini` |

Templates and macro-enabled Word files (`.dotx`, `.docm`) are not written back.

## The dialog

When a document outgrows its source format, the next Save shows one dialog: *This document now has features that {format} cannot hold.* with three choices.

| Choice | Result |
| --- | --- |
| Save as .ofini (keeps everything) | Remembered for that document; it is an `.ofini` document from then on and the tab shows the `.ofini` name |
| Save a copy as {format} (flattened) | A copy; the document and its source are untouched, so Save asks again |
| Cancel | Nothing happens |

## What is written exactly

- **Encoding:** UTF-8 without BOM unless the original had one; the original line endings (LF, CRLF or CR) are kept. A file you did not change is written back byte for byte, even when it was not valid UTF-8. After an edit a file with mixed line endings is written with LF.
- **Desktop:** Save writes to the original path without a dialog.
- **Chromium browsers:** the file handle from *File ▸ Open* is kept and used after a permission check. Other browsers open the save dialog (or download) with the original name.
- **Save As** lists the source format first and `.ofini` as the alternative; the type you pick decides what is written.
- The tab shows the file name with its extension, the status bar shows a badge for the save target (`.txt`, `.docx`, `.ofini`) with a tooltip explaining why, and the toast reads *Saved as notes.txt*.

## Limits

SVG goes through the importer and exporter, so features the importer does not read (scripts, CSS animation, unsupported filters) are not in the written file; keep a copy of the original when an SVG came from another tool. The Office writers keep structure, styles, tables, lists, images, footnotes and links but are not byte-compatible with the original producer. A web file handle exists only while the tab stays open; after a restart restored from autosave, the first Save asks for the file again.

## Vibe

The read-only tool `get_save_target` reports which file type Save would write and why.

## See also

- [[File Formats]]
- [[Office Studio]]
- [[Concepts]]
- [[Settings Reference]]
