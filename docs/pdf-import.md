# Opening PDFs and Illustrator files

OpenFini opens PDF files as native, editable **Layout** documents: one page per PDF page, with text as text frames,
pictures as image objects and graphics as vector shapes. Illustrator (`.ai`) files saved with "Create PDF Compatible
File" (the default for many years) are opened through the same importer.

Open a PDF with **File ▸ Open…**, by dropping it on the window, from a folder, or through the operating system's
"Open with". An options dialog appears first. Use **File ▸ Insert Pages from PDF…** to add the pages of a PDF to the
current document, and **File ▸ Extract Pages as PDF…** to save selected pages of the current document as a PDF.
**File ▸ Import Report…** shows what the last import kept, flattened and dropped.

## How it works

The PDF is parsed by [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), vendored in `app/vendor/pdfjs` and loaded
only when a PDF is opened (it never runs for other documents). pdf.js decodes the file (cross-reference tables and
streams, object streams, filters, color spaces, encryption, fonts) and hands OpenFini the page's drawing operations.
`engine/formats/pdf-content.js` walks them into a DOM-free description of the page, `pdf-layout.js` groups text into
lines and paragraphs, and `core/import-pdf.js` builds the document. Nothing is rendered by pdf.js except in the
"Page images" mode.

## Import modes

| Mode | Result |
| --- | --- |
| **Editable objects** (default) | Text frames, vector paths (fills, strokes, dashes, even-odd, gradients, clipping, opacity, blend modes) and images |
| **Page images** | Every page is a flat background image (72-300 dpi) with the page's text on top as editable text frames; for PDFs that are too complex or look wrong in the first mode. The text is removed from the background image so it does not print twice |
| **Text only** | Only text frames; handy for translating or reusing copy |

Other options: a page range (`1-3, 5, 8-`), an image resolution cap, "use embedded fonts" and "join lines into
flowing paragraphs". Pages with more than 12,000 objects (maps, CAD drawings) switch to the page-image mode on their own,
and the report says so. A progress dialog with **Cancel** is shown while pages are converted; the pages converted so far
are kept.

## What is converted

- **Text.** Runs on one baseline become lines, lines with the same style, alignment and regular spacing become one text
  frame (paragraph). By default the original line breaks are kept (forced line breaks inside one paragraph) so the
  layout matches the PDF exactly; "join lines" turns lines into a flowing paragraph. Position, size, color and rotation
  are kept. The first baseline and the line height are calibrated against OpenFini's text layout so lines land where
  they were. Text on page rotations of 90, 180 and 270 degrees is kept rotated.
- **Fonts.** Embedded TrueType, OpenType/CFF and Type 1 fonts are extracted, given a Unicode character map and registered
  as a font named `Name (PDF n)`; they also embed again when you export a PDF. Embedded fonts are **subsets**: they only
  contain the characters the PDF used, so newly typed characters fall back to another font. They live in the app
  session and in the fonts you add on this device, **not** inside the saved `.ofini` file; reopening a saved import on
  another device shows the substitute font until the PDF is imported again. When a font cannot be embedded (not
  embedded in the PDF, Type 3, damaged) the closest family is used (Helvetica, Times New Roman, Courier New or a known
  family such as Calibri or Georgia), bold and italic are derived from the name, and letter spacing is adjusted so
  each line keeps the width it had.
- **Invisible text** (the OCR layer of scanned PDFs) is imported as hidden text frames named "OCR text".
- **Images.** JPEG, Flate and other raw images in DeviceGray, RGB, CMYK, ICC based, Indexed and Lab spaces, image
  masks (stencils) and images with soft masks (alpha) become image objects; JPEG 2000 and JBIG2 decode through
  WebAssembly modules shipped with pdf.js. Images above 40 megapixels are downsampled; the resolution cap in the
  dialog downsamples further.
- **Vectors.** Paths, rectangles (as rectangle objects), strokes with caps, joins, miter limit and dashes, axial and
  radial shadings (as gradient fills), clipping paths (as clip containers), fill and stroke opacity, blend modes.
- **Layers.** Content in optional content groups that are hidden is left out.
- **Pages.** Page size comes from the CropBox (else MediaBox) with the page rotation applied. One PDF point is one
  OpenFini pixel (documents are created at 72 dpi).
- **Form fields and annotations** that have an appearance are imported as static content; **form fields are not
  interactive**. Link annotations (clickable links) are not kept.

## What is not kept

Soft masks of transparency groups (masked content appears unmasked), tiling patterns and mesh shadings (flat color),
knockout and isolated group semantics (approximated), Type 3 font glyph drawings (the Unicode text is used),
overprint, spot-color separations, JavaScript, bookmarks, tags, attachments and embedded video. The import report lists
what applied to the file you opened.

## Passwords and permissions

A password-protected PDF asks for the password (RC4 40/128 bit and AES 128/256 are supported by pdf.js). A wrong
password can be retried; cancelling the prompt cancels the import. A PDF with an owner password only (restricting
printing, copying or editing) opens without a password; the import report notes that the permission flags are your
responsibility. OpenFini does not break or bypass passwords.

## Illustrator (.ai) and EPS

Modern `.ai` files embed a PDF stream and open exactly like PDFs; the report notes that Illustrator-specific data
(live effects, artboards beyond what the PDF holds, symbols, brushes) is not available. `.ai` files without PDF
content (very old PostScript-only files, or files saved without "Create PDF Compatible File") show a dialog with the
steps to export a PDF or SVG from Illustrator. `.eps` files are opened only when they contain a PDF; PostScript EPS
files are not supported (the dialog explains how to export PDF, SVG or PNG).

## Performance and memory

pdf.js runs in a Web Worker; pages are converted one after another and released immediately (`page.cleanup`). The
page IR holds only the current page. Large images are downsampled, giant pages switch to page images, and text frames
are laid out lazily by the editor. Typical office PDFs open in a few seconds; a 100-page text document takes
noticeably longer than a 10-page one, which is why the progress dialog exists.

## Vibe Studio

The assistant has no file access. Attach a PDF, AI, PSD, IDML or Sketch file in the Vibe composer and click **Open as
document** on the attachment chip; the assistant can then use `get_import_report`, `list_pdf_pages`,
`describe_document_pages` (text per page, for summarizing and translating) and `extract_pdf_text`.

## Limits and assumptions

- The vendored pdf.js is the "legacy" build (works in older WebViews). The Tauri content security policy allows
  WebAssembly (`'wasm-unsafe-eval'`) for the JPEG 2000 / JBIG2 / color management modules. The predefined CMap files
  for legacy CJK encodings (about 1 MB) are not shipped: PDFs that rely on them without embedding the font may show
  wrong characters.
- Verified with hand-built PDFs (text, paths, gradients, images, Flate, object streams, cross-reference streams,
  RC4-40 encryption, rotation and CropBox), with PDFs written by OpenFini's own exporter (round trip of text and geometry)
  and, in the browser, with a multi-page PDF and a PDF with an embedded TrueType font. Behavior on the full variety of
  real-world PDFs (scanner output, InDesign and Word exports, CAD plots) follows pdf.js's decoding but was not tested
  file by file.
