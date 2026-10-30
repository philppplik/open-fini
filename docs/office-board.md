# Whiteboard (Office Suite app "board")

The Whiteboard is the Office Suite's infinite canvas for sketches, sticky notes, diagrams and handwritten notebooks, in
the spirit of Excalidraw, tldraw and GoodNotes. It plugs into the suite through the contract of
[office-suite.md](office-suite.md); this page is the user guide and the engineering reference. Wiki: `wiki/Whiteboard.md`.

## Using it

* **New**: Office Home ▸ *Whiteboard*, or a template: *Blank whiteboard*, *Brainstorm*, *Kanban board*, *Flowchart*,
  *Notebook* (three pages with lined and squared paper).
* **Open**: *File ▸ Open…*, drag and drop or the OS *Open with* for `.excalidraw` and `.tldraw`. *File ▸ Save* writes
  the original format again (with a note about what it cannot keep); the `.ofini` keeps everything.
* **Export** (*Board ▸ Export As*, `office.export`): Excalidraw, tldraw, PNG and SVG (current page), PDF (every page).

### Tools and keys (while the canvas has focus)

| Key | Tool | Key | Tool |
| --- | --- | --- | --- |
| `V` | Select | `R` `O` `D` | Rectangle, ellipse, diamond |
| `H` / `Space`-drag / middle button | Pan | `L` `A` | Line, arrow (connector) |
| `P` | Pen (pressure-aware) | `T` | Text (also double-click on empty canvas) |
| `M` | Highlighter | `N` | Sticky note |
| `E` | Eraser (whole strokes and shapes) | `I` | Image (also paste or drop files) |
| `K` | Laser pointer (fading trail, not saved) | `F` | Frame |

`Delete` removes, `Mod+D` duplicates (`Alt`-drag too), `Mod+G` / `Mod+Shift+G` group and ungroup, `Mod+]` / `Mod+[`
(with `Shift`: to front / back), `Mod+A` selects the page, arrows nudge (`Shift`: 10 px), `Enter` edits the text of the
selection, `Shift+1` zooms to fit, `Mod+0` / `Mod+=` / `Mod+-` zoom, `Mod+wheel` or pinch zooms, `PageUp` / `PageDown`
change pages. `Shift` keeps proportions while resizing, snaps rotation to 15° and lines to 15° steps.

* **Selection**: click, `Shift`-click, marquee; eight resize handles and a rotation handle; lines and arrows show their
  end points instead (drag an end onto a shape to connect it).
* **Connectors**: an arrow or line started or ended on a shape binds to it and follows when the shape moves, resizes
  or rotates. The end point sits on the shape's outline (rectangle, ellipse or diamond).
* **Style**: stroke and fill colors, hatched / cross-hatched / solid fill, width, solid / dashed / dotted, font, and the
  *Hand-drawn style* toggle (rough, Excalidraw-like strokes from `toolkit/rough.js`, seeded so they never "boil") versus
  clean geometry. Changing a control restyles the selection and becomes the default for new elements.
* **Arrange**: z-order, group, lock, align, distribute, *Arrange in a Grid*, *Arrange as Flowchart* (layers along the
  connectors).
* **Pages** (notebook style): the bar below the canvas lists pages; add, rename (double-click), delete, and choose the
  paper: plain, dotted, squared or lined. *View ▸ Show Grid* and *Snap to Grid* work on every page.
* **Touch and stylus**: pen pressure and coalesced pointer samples give smooth ink; once a stylus is seen, fingers only
  pan and pinch-zoom (palm rejection, best effort).
* **Comments**: select one element ▸ *Add comment…* (context menu); the comment follows the element.

## Model

`doc.office = OfficeProject(model, "board")`; the model is plain JSON (`office/board/model.js` header):

```js
{ version: 1, title, background: "#ffffff",
  pages: [{ id, name, z, paper }],                  // z: fractional order key (collab/fractional.js)
  elements: { [id]: { id, type, page, x, y, w, h, angle, z, stroke, fill, fillStyle, width, dash, rough, opacity,
                      seed, group?, frame?, locked?, text?, font?, fontSize?, align?, points?, start?, end?, heads?,
                      media?, name? } },
  media: { [id]: { id, mime, name, w, h, bytes } } } // bytes in .ofini as office/board/media/<id>.<ext>
```

Types: `rect ellipse diamond line arrow pen highlighter text sticky image frame`. Points of lines and ink are relative
to `(x, y)`; ink points carry pressure as a third value. Connectors store `start` / `end` as `{ id }`;
`layoutConnectors()` re-routes them after every operation that moves something.

## Code map

| Part | File |
| --- | --- |
| Manifest (formats, templates, AI note) | `app/src/office/board/manifest.js` |
| Contract implementation (create, open, save, adapters) | `app/src/office/board/app.js` |
| Pure model and operations (geometry, hit tests, connectors, z-order, align, arrange, pages, records, templates) | `app/src/office/board/model.js` |
| Renderer: elements → engine display lists (screen, SVG, PDF, PNG), ink outlines | `app/src/office/board/render.js` |
| PNG / SVG / PDF export | `app/src/office/board/export.js` |
| Excalidraw / tldraw codecs | `app/src/office/board/formats.js` |
| Canvas UI (gestures, editing, pages) | `app/src/office/board/view.js` |
| Commands and context menu (registered when the first board mounts) | `app/src/commands/office-board.js` |
| Menus | `app/src/studios/office.js ▸ OFFICE_MENUS` (`officeKinds: ["board"]`) |
| Vibe tools | `app/src/vibe/tools/office-board.js` (group *Whiteboard*) |
| Styles | `app/styles/office-board.css` |
| Tests | `tests/office/board.test.js` |

Rendering uses the engine's display lists (docs/engine-contracts.md): the screen draws them with
`engine/backends/canvas.js` on a scene canvas (redrawn on model or camera changes) under an overlay canvas (selection,
ink in progress, laser). Display-list items are cached per element object, which works because models are immutable.

## Undo and collaboration

Every finished gesture, menu command or Vibe call is one `commitOffice` step (nudges coalesce). The `collabAdapter`
flattens the board into records: `el:<id>` per element (last writer wins per element, so two people moving
different shapes never conflict), `page:<id>`, `media:<id>` (images up to about 46 KiB travel inline; larger ones show
as placeholders for the other members until the file is shared again) and `meta:board`. Orders are fractional keys
inside the records. Comments use the item anchor `el:<id>`. Remote cursors are not shown.

## Vibe

`board_describe` (ids, positions, texts, connections), `board_add_shape`, `board_add_sticky`, `board_add_text`,
`board_add_connector` (bound to element ids), `board_update`, `board_delete`, `board_arrange` (grid, row, column,
flow, align, distribute, group, z-order), `board_page`, `board_import` (Excalidraw / tldraw JSON into the current
page) and `board_export` (Excalidraw, tldraw or SVG text). `office_describe`, `office_new` and `office_export` work too.

## Import and export fidelity

| Format | Kept | Simplified or lost |
| --- | --- | --- |
| Excalidraw read | rectangles, ellipses, diamonds, lines, arrows with bindings and arrowheads, freedraw with pressure, text, bound labels, images (embedded files), frames, groups, colors, fills, stroke style, roughness, opacity, angle, links, locks | nested groups become one group; zigzag/dots fills become hatching; elbow arrows become straight segments; embeddables, iframes and other unknown types are dropped (listed in the import report) |
| Excalidraw write | all of the above | sticky notes become filled rectangles with text; highlighter strokes become semi-transparent freehand; several pages become frames side by side |
| tldraw read (2.x and 3.x records, plain or rich text) | pages, geo shapes (rectangle, ellipse, diamond), notes, text, draw and highlight (pressure), arrows with bindings (binding records and the older inline form), lines, frames, groups, images (embedded data URLs), rotation, opacity, locks | other geo shapes become rectangles; curved arrows become straight; images stored outside the file and embeds, bookmarks and videos are dropped |
| tldraw write (schema of tldraw 2.x; newer versions migrate it) | pages, shapes, notes, text, ink, arrows with bindings, lines, frames, images | colors snap to tldraw's palette; widths and font sizes snap to s/m/l/xl; fills follow the stroke color; groups are not written; bent arrows become straight; notes have tldraw's fixed size |
| PNG / SVG | the current page, cropped to its content with a margin | fonts are the system's (the handwritten font maps to Comic Sans MS with fallbacks) |
| PDF | every page | standard PDF fonts |

The tldraw writer was checked by round trips through our own reader, not against tldraw itself.

## Limits

* No elbow / curved connector routing, no arrow labels positioned by the user, no shape libraries.
* No remote cursors or live laser for collaborators; large images are not sent through live editing.
* Text inside rotated shapes is edited unrotated; the editor is a plain textarea (no rich text).
* Palm rejection is heuristic: it activates after the first stylus contact in the session.
