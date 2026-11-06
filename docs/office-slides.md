# Presentation app (Office Suite, kind `slides`)

The Presentation app is the second app of the [Office Suite](office-suite.md). It edits slide decks, opens and saves
PowerPoint and OpenDocument presentations, exports PDF and PNG, and presents full screen with a presenter view. User
guide: [wiki ▸ Presentation App](../wiki/Presentation-App.md).

## Files

| Part | File |
| --- | --- |
| Manifest (formats, templates, AI note) | `app/src/office/slides/manifest.js` |
| Implementation (create / open / save / mount, adapters) | `app/src/office/slides/app.js` |
| Model and pure operations | `app/src/office/slides/model.js` |
| PowerPoint reader / writer | `app/src/office/slides/pptx.js` |
| OpenDocument reader / writer | `app/src/office/slides/odp.js` |
| Display lists for PDF / PNG | `app/src/office/slides/render.js` |
| DOM rendering (canvas, thumbnails, show) | `app/src/office/slides/slide-dom.js` |
| Editor UI | `app/src/office/slides/view.js` |
| Slide show and presenter view | `app/src/office/slides/present.js` |
| Charts from spreadsheet ranges (lazy) | `app/src/office/slides/sheet-link.js` |
| Commands and context menus | `app/src/commands/office-slides.js` (registered when the app first loads) |
| Menus | `app/src/studios/office.js` (`officeKinds: ["slides"]`) |
| Vibe tools | `app/src/vibe/tools/office-slides.js` (group **Presentation**) |
| Styles | `app/styles/office-slides.css` (linked at runtime by `view.js`) |
| Tests | `tests/office/slides.test.js` |

Everything is lazy. Start-up only gains the five menu rows; the commands, the context-menu providers and the stylesheet
are added the first time a deck is shown.

## Model

Plain JSON, immutable values; every change is one `commitOffice` step (undo, history, collaboration).

```
Deck    { version: 1, size: { w, h } (px, 96 per inch; 960 × 540 = 16:9), theme, meta: { title }, slides[], media{},
          master: { elements[], footer: { text, date, number, skipTitle } }, layouts: { <layout id>: [[role, x, y, w, h]] } }
Slide   { id, ord, layout, background: null | { color } | { media }, elements[], notes, transition: { type, duration },
          hidden?, hideMaster? }
Element { id, z, type: text | shape | image | table | chart, x, y, w, h, rot, ph?, text?, style?, spans?, shape?, fill?,
          stroke?, strokeWidth?, media?, rows?, chart?, source?, flipH?, flipV? }
Span    { start, end, bold?, italic?, underline?, color? }   offsets into text; overrides the element style there
```

* **Layouts** (`title`, `title-content`, `section`, `two-content`, `title-only`, `blank`) are placeholder boxes as
  fractions of the slide. `applyLayout` moves placeholders (`ph`: title, subtitle, body, body2) to the new boxes and keeps
  their text; other elements stay. `deck.layouts` holds the layouts the user edited (`layoutPh(deck, id)` returns the
  edited or built-in boxes); editing a layout re-applies it to every slide that uses it, `resetLayout` restores it.
* **Master**: `master.elements` are drawn behind every slide (unless the slide sets `hideMaster`); `master.footer` adds
  date (left), footer text (center) and slide number (right) boxes, optionally not on `title` layout slides.
  `masterElements(deck, slide)` / `renderElements(deck, slide)` produce these render-only elements (ids start with `@`,
  `master: true`) for the DOM, PDF and PNG renderers; they are never part of `slide.elements`.
* **Pseudo slides**: `slideById(deck, "@master")` and `slideById(deck, "@layout:<id>")` return the master and a layout
  as editable slides, and `updateSlide` writes them back, so every element operation (add, move, resize, align, delete)
  works in the master view too.
* **Themes** (`office` "Clean", `midnight`, `paper`, `ocean`, `bold`, `aurora`, `slate`, `sunrise`, `forest`):
  background, text and two accent colors, heading and body fonts. A `null` text color or font means "from the theme",
  so switching themes restyles the deck.
* **Designs** (`DESIGNS`: `pitch`, `report`, `lesson`, `project`, `roadmap`, `portfolio`): a theme plus master graphics
  (accent bars, bands, circles, a frame) and footer settings; the templates of the same name use them and
  `applyDesign` puts one on an existing deck.
* **Text** is one string per element (`\n` between paragraphs) with a base style per element (font, size in points,
  color, bold, italic, underline, alignment, vertical alignment, bullets). `spans` add mixed bold, italic, underline
  and color inside the box (`formatText`, `formatSpans`). Spans follow text edits (`remapSpans`: typed characters take
  the format before them) and formatting the whole box clears the same keys from its spans.
* **Charts** (`type: "chart"`) store a chart definition with a data snapshot (`engine/layout/chart-data.js`, the same
  renderer the spreadsheet and the Layout studio use) and `source: { doc, sheet, range }`. `sheet-link.js` reads the
  range from an open spreadsheet the way the spreadsheet reads its own charts (computed values, header row = series,
  first column = categories); the deck does not depend on the spreadsheet at run time. Theme fonts, text color and
  accents style the chart.
* **Order**: the array order is the order; `ord` (slides) and `z` (elements) mirror it as fractional keys
  (`collab/fractional.js`), maintained by `fixOrder` in every operation.

## Formats and fidelity

| Format | Read | Write | Notes |
| --- | --- | --- | --- |
| `.pptx`, `.ppsx` | yes | yes | Save in the original format (lossy flag: PowerPoint features the model lacks are not written back) |
| `.potx` | yes (as new) | | |
| `.odp` | yes | yes | The theme is kept in a `meta.xml` user field for OpenFini round trips |
| `.fodp` | yes | | flat XML |
| `.otp` | yes (as new) | | |
| PDF | | yes | vector shapes and text, hidden slides left out |
| PNG | | yes | one 1920 px PNG per visible slide in a ZIP; *This slide as PNG* in the export dialog |
| `.ppt` (97-2003) | | | the "convert first" dialog |

Read: slides, size, theme colors and fonts, text boxes and placeholders (positions inherited from layout and master when
the slide has none), basic shapes (rectangle, rounded rectangle, ellipse, triangle, diamond, arrow, line), pictures,
tables (text), solid and picture backgrounds (slide, layout or master), speaker notes, fade and push-style transitions,
hidden slides, group contents (ungrouped), and bold, italic, underline and color runs inside a text box (as spans; the
formatting that covers most characters becomes the box style). The import report lists what was simplified (mixed
font sizes or typefaces, list levels, custom shapes, gradients, cropping, groups) and dropped (charts, SmartArt,
embedded objects, media, animations, comments, EMF/WMF pictures).

Write: a minimal valid package (one master, six layouts with the deck's edited boxes, theme, notes master, notes slides,
media), so PowerPoint, Impress, Keynote and Google Slides open it. `exportDeck` prepares the deck first: master
graphics, footers and slide numbers become shapes on each slide, charts become tables of their data; spans become
PowerPoint runs (OpenDocument keeps the box's main formatting). The export notes say so. Codecs use the hardened ZIP and XML helpers of `engine/office/` (entry and
size limits, no entity expansion, no path traversal).

## Editor

* Thumbnails panel (drag to reorder, `Alt+↑/↓`, `Delete`, `Ctrl+D`), slide sorter (grid, drag, double-click opens).
* Canvas: click / Shift-click / marquee selection, drag to move (snaps to slide edges, center and other objects; `Alt`
  disables snapping; `Shift` locks the axis), eight resize handles (`Shift` keeps proportions, pictures keep them by
  default), rotation handle (snaps to 15°), double-click or `Enter` edits text in place, arrow keys nudge (`Shift` ×10),
  `Ctrl+C/X/V/D`, `Ctrl+[`/`]` (with `Shift`: front / back), `Tab` cycles objects, pictures by drop or paste.
* Ribbon: slide (new with layout, duplicate, delete, layout, hide), insert (text box, shapes, picture, table, chart
  from spreadsheet), text (font, size, bold, italic, underline, color, alignment, bullets), shape (fill, outline),
  arrange (z-order, align, rotate), design (themes gallery, designs, background, header and footer, edit master,
  transition), slide show.
* Mixed formatting: select characters while editing a text box, then `Ctrl+B/I/U` or the ribbon's bold, italic,
  underline and text color format only those characters (editing resumes with them selected). Without a character
  selection the buttons format the whole box.
* **Themes…** opens a gallery with a preview card per theme, a live preview of the first slide and fields to fine-tune
  the four colors and the heading and body fonts.
* **Edit master** (Design ▸ Edit master, View menu) shows the slide master or one layout with a banner; master shapes,
  pictures and text appear on every slide, layout placeholders can be moved and resized and slides follow. *Reset
  Layout* restores the built-in boxes, *Close Master View* returns to the slides. *Slide ▸ Hide Master Graphics* turns
  them off for one slide.
* **Header and footer…** sets footer text, a date text and slide numbers for the whole deck.
* **Chart from spreadsheet…** picks an open spreadsheet, a range and a chart type; *Insert ▸ Refresh Chart Data*
  re-reads every chart whose spreadsheet is open.
* Speaker notes below the canvas (typing coalesces into one undo step per slide).
* Comments: `commentAnchor()` names the selected element (`obj:<slide>/<element>`) or the slide (`slide:<id>`);
  `revealAnchor` jumps there.

## Slide show

`F5` from the beginning, `Shift+F5` from the current slide, `Alt+F5` presenter view. Full screen when the browser allows
it. Keys: next `→ ↓ Space Enter PageDown`, previous `← ↑ Backspace PageUp`, `Home`/`End`, number + `Enter` jumps, `B`/`W`
black or white screen, `P` toggles the presenter view (current slide, next-slide preview, notes, timer, clock), `T`
restarts the timer, `Esc` ends. Fade and slide-in transitions use the Web Animations API and are skipped under
`prefers-reduced-motion`.

## Collaboration

`collabAdapter.records` flattens the deck into `meta:deck`, `slide:<id>` (with `ord`), `obj:<slide>/<element>` (with
`z`) and `media:<id>` records. Pictures up to 45 KiB travel inside their record; larger pictures stay with their author
and show as "Picture not available" for others until the document is shared as a copy.

## Vibe

Tools (group **Presentation**): `slides_describe`, `slides_add_slide`, `slides_delete`, `slides_set_text`,
`slides_add_shape`, `slides_add_image` (attachment or data URI), `slides_apply_layout`, `slides_apply_theme`,
`slides_reorder`, `slides_set_notes`, `slides_set_transition`, `slides_format_text` (mixed formatting by matched text or
offsets), `slides_set_footer`, `slides_edit_master` (add/remove/clear master graphics, hide/show them per slide),
`slides_edit_layout` (move or resize a layout placeholder, or reset), `slides_apply_design`, `slides_insert_chart` (from
an open spreadsheet range) and `slides_refresh_charts`. `slides_describe` with slide `@master` returns the master,
footer and edited layouts. Slides are numbered from 1 or addressed by id; each call is one undoable step. New decks:
`office_new` with kind `slides`; export: `office_export`.

## Known limits

* Mixed formatting covers bold, italic, underline and color; font and size are per box. No multi-level lists, no text
  autofit.
* Charts are snapshots (refresh by hand) and are written to PowerPoint and OpenDocument as tables of their data; no
  SmartArt, animations, audio or video.
* One master per deck; layouts can be edited but not added. Footers have no automatic date field (the date is text).

* Picture cropping, gradients and custom geometry are simplified on import.
* PDF text uses the standard PDF fonts (like every PDF export in OpenFini).
* The presenter view shares the window with the audience view (no separate audience window).
