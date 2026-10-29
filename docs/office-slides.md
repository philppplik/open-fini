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
Deck    { version: 1, size: { w, h } (px, 96 per inch; 960 × 540 = 16:9), theme, meta: { title }, slides[], media{} }
Slide   { id, ord, layout, background: null | { color } | { media }, elements[], notes, transition: { type, duration }, hidden? }
Element { id, z, type: text | shape | image | table, x, y, w, h, rot, ph?, text?, style?, shape?, fill?, stroke?,
          strokeWidth?, media?, rows?, flipH?, flipV? }
```

* **Layouts** (`title`, `title-content`, `section`, `two-content`, `title-only`, `blank`) are placeholder boxes as
  fractions of the slide. `applyLayout` moves placeholders (`ph`: title, subtitle, body, body2) to the new boxes and keeps
  their text; other elements stay.
* **Themes** (`office` "Clean", `midnight`, `paper`, `ocean`, `bold`): background, text and two accent colors, heading and
  body fonts. A `null` text color or font means "from the theme", so switching themes restyles the deck.
* **Text** is one string per element (`\n` between paragraphs) with one style per element (font, size in points,
  color, bold, italic, underline, alignment, vertical alignment, bullets). Mixed formatting inside one box is simplified
  on import.
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
hidden slides, group contents (ungrouped). The import report lists what was simplified (mixed formatting, list levels,
custom shapes, gradients, cropping, groups) and dropped (charts, SmartArt, embedded objects, media, animations,
comments, EMF/WMF pictures).

Write: a minimal valid package (one master, six layouts, theme, notes master, notes slides, media), so PowerPoint,
Impress, Keynote and Google Slides open it. Codecs use the hardened ZIP and XML helpers of `engine/office/` (entry and
size limits, no entity expansion, no path traversal).

## Editor

* Thumbnails panel (drag to reorder, `Alt+↑/↓`, `Delete`, `Ctrl+D`), slide sorter (grid, drag, double-click opens).
* Canvas: click / Shift-click / marquee selection, drag to move (snaps to slide edges, center and other objects; `Alt`
  disables snapping; `Shift` locks the axis), eight resize handles (`Shift` keeps proportions, pictures keep them by
  default), rotation handle (snaps to 15°), double-click or `Enter` edits text in place, arrow keys nudge (`Shift` ×10),
  `Ctrl+C/X/V/D`, `Ctrl+[`/`]` (with `Shift`: front / back), `Tab` cycles objects, pictures by drop or paste.
* Ribbon: slide (new with layout, duplicate, delete, layout, hide), insert (text box, shapes, picture, table), text
  (font, size, bold, italic, underline, color, alignment, bullets), shape (fill, outline), arrange (z-order, align,
  rotate), design (theme, background, transition), slide show.
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
`slides_reorder`, `slides_set_notes`, `slides_set_transition`. Slides are numbered from 1 or addressed by id; each call
is one undoable step. New decks: `office_new` with kind `slides`; export: `office_export`.

## Known limits

* One text style per text box; no rich text runs, no multi-level lists, no text autofit.
* No charts, SmartArt, animations, audio or video; no slide masters editing (layouts are built in).
* Picture cropping, gradients and custom geometry are simplified on import.
* PDF text uses the standard PDF fonts (like every PDF export in OpenFini).
* The presenter view shares the window with the audience view (no separate audience window).
