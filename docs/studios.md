# Studios guide

Switch studios with the buttons in the header or **Alt+1 … Alt+5**. A studio changes the toolbox, the
default panels and the context bar — it never converts or changes your document.

`Mod` below means **Ctrl** on Windows/Linux and **⌘** on macOS.

> In a normal browser tab a few shortcuts (for example `Ctrl+N`, `Ctrl+W`, `Ctrl+T`) are reserved by the
> browser and cannot be intercepted. Install the PWA or use the desktop app for the full shortcut set — the
> same actions are always available from the menus.

## Common to all studios

While no document is open (the start page) the menubar shows only File, View, Studio and Help; the studio menus appear when a document opens. The set is the `MINIMAL_MENUS` constant in `app/src/ui/menubar-select.js`.

| Action | Shortcut |
| --- | --- |
| New / Open / Save / Save As | `Mod+N` / `Mod+O` / `Mod+S` / `Mod+Shift+S` |
| Export… / Place image | `Mod+Shift+E` / `Mod+Shift+P` |
| Undo / Redo | `Mod+Z` / `Mod+Shift+Z` or `Mod+Y` |
| Cut / Copy / Paste / Paste in place / Duplicate | `Mod+X` / `Mod+C` / `Mod+V` / `Mod+Shift+V` / `Mod+J` |
| Select all / Deselect / Delete | `Mod+A` / `Mod+D` / `Delete` |
| Group / Ungroup | `Mod+G` / `Mod+Shift+G` |
| Bring to front / forward / backward / to back | `Mod+Shift+]` / `Mod+]` / `Mod+[` / `Mod+Shift+[` |
| Lock / Hide | `Mod+L` / `Mod+Shift+H` |
| Zoom in / out / 100% / fit page / fit selection | `Mod+=` / `Mod+-` / `Mod+1` / `Mod+0` / `Mod+Shift+0` |
| Pan | hold `Space` and drag, middle mouse, or two-finger scroll |
| Rulers / Grid / Guides | `Mod+R` / `Mod+'` / `Mod+;` |
| Keyboard shortcut list | `F1` |

Drag from a ruler to create a guide; drag a guide back onto the ruler to remove it. Hold `Ctrl` while
dragging to turn snapping off for that move.

Modifiers while drawing and transforming: **Shift** = constrain / uniform scale, **Alt** = from the center
(or copy when moving), **Ctrl** = no snapping / deep select.

## Vector studio

| Tool | Key | Notes |
| --- | --- | --- |
| Move | `V` | Click, marquee, drag, scale / rotate handles. Double-click a group to enter it; `Esc` leaves. Alt-drag copies. Arrow keys nudge (Shift = ×10). |
| Node | `A` | Move anchors / handles, click a segment to drag it, double-click a segment to insert a node, double-click a node to toggle smooth / sharp; buttons for node type, join, break, delete. |
| Pen | `P` | Click for corner nodes, click-drag for smooth nodes (Alt breaks the handle), click the first node to close, `Enter` or double-click to finish, `Backspace` removes the last node. |
| Pencil | `N` | Freehand with adjustable smoothing; ending near the start closes the shape. |
| Rectangle / Ellipse / Polygon / Star / Shapes / Line | `M`, `E`, … | Drag to draw; Shift = square / circle, Alt = from center. Click for a default size. |
| Text | `T` | Click for artistic text, drag for a frame. |
| Gradient | `G` | Drag on an object; edit start / end points and double-click the line to add stops. |
| Fill | `F` | Applies the current fill to the clicked object (Alt = remove fill). |
| Color picker | `I` | Samples the composited color (Shift applies it to the selection). |
| Crop | `C` | Crops the page; `Enter` applies. |

Panels: **Appearance** (fill, stroke, shape parameters, effects), **Transform** (position, size, rotation,
align, arrange), **Color** (picker and swatches), **Type**, **Layers**, **History**, **Navigator**.

Shape menu: **Convert to Curves** (`Mod+Enter`), **Expand Stroke**, **Add / Subtract / Intersect / Exclude /
Divide**, **Trace Image to Vector…**.

## Pixel studio

| Tool | Key | Notes |
| --- | --- | --- |
| Marquee (rect / ellipse) | `M` | Shift / Alt / Shift+Alt combine with the existing selection. |
| Lasso (freehand / polygonal) | `L` | Polygonal: click points, click the first point or `Enter` to close, `Backspace` removes a point. |
| Magic wand / Color range | `W` | Tolerance, contiguous, sample the layer or all layers; Color Range adds softness, sample size and invert. |
| Crop | `C` | Ratios, optional deletion of cropped pixels. |
| Brush / Pencil | `B` | `[` and `]` change the size. Pressure-sensitive. Painting on a mask: light colors reveal, dark colors hide. |
| Eraser | `E` | |
| Clone / Heal / Spot heal / Red eye | `S`, `J`, `R` | Alt-click sets the source for clone and heal. |
| Smudge / Blur / Sharpen | `O` | |
| Dodge / Burn / Sponge | `D` | Range (shadows / midtones / highlights). |
| Fill / Gradient | `F`, `G` | Respect the active selection. |
| Liquify | `Q` | Push, twirl, pinch, bloat, reconstruct; `Enter` applies. |
| Color picker | `I` | Click = foreground, Alt-click = background. |

Colors: `X` swaps foreground and background, `D` resets them. **Alt+Backspace** fills the selection with
the foreground color, **Mod+Backspace** with the background color.

Select menu: All, Deselect, Reselect, Invert (`Mod+Shift+I`), Feather, Grow, Shrink, Border, Smooth, Color
Range, selection to layer / layer mask / curves.

Layer menu: New pixel layer (`Mod+Shift+N`), group, **adjustments**, **live filters**, add / apply / delete
mask, duplicate, **Merge Down** (`Mod+E`; also bakes an adjustment into the layer below), Rasterize,
Flatten.

Panels: **Histogram** (live, with source and channel choice, statistics, clipping overlay, compact mode), **Info** (color under the pointer) and **Adjust** (interactive Levels and Curves with histogram backdrop and eyedroppers, before / after histograms). See the [Histogram guide](pixel-histogram.md).

Adjustments and live filters are **non-destructive layers** you can reorder, mask, hide and re-edit.
Enable *Apply to the selected layer only* in the Adjust panel to nest them under a layer instead of
affecting everything below.

### Tool pill

A small floating pill at the bottom center of the canvas (above the status bar) names the active state in words and
offers its actions. Pixel selection (marquee, lasso, wand, color range): "Selection active · 1,240 × 860 px" with
**Deselect** (`Mod+D`), **Invert** (`Mod+Shift+I`), **Feather…**, **To layer mask** and **Fill** (the existing commands
`select.none`, `select.invert`, `select.feather`, `select.toMask`, `pixel.fillForeground`). In Vector, Layout and Pixel
a layer selection shows "3 objects selected" with **Deselect**. Tools in a modal-like state: **Apply / Cancel** for crop
and liquify (Enter / Esc), **Finish path / Close path / Cancel** for the pen, **Done editing** for text. Turn it off in
Settings ▸ Canvas and editing ▸ *Show the tool pill* (`toolPill`). The Vibe assistant needs no tool for it: the pill only
calls commands it can already run.

Architecture: the decision is a pure function in `app/src/ui/tool-pill-model.js` (`buildPillModel(snapshot)`, tests in
`tests/ui/tool-pill.test.js`); `app/src/ui/tool-pill.js` renders it (lazy-loaded from `ui/shell.js`, styles in
`styles/tool-pill.css`, glass aware). To give a tool a pill state, add `pillState()` (returns
`{ key, params, actions: [{ id, label, key?, primary? }] }` or null) and `pillAction(id)` to the tool class; messages
must also be listed in `PILL_MESSAGES` so `npm run i18n:extract` finds them.

## Layout studio

* **Pages panel** — thumbnails (drag to reorder), add / duplicate / delete, **master pages**, and *Facing
  pages*. Click the pencil next to a master to edit it; fields from the **Text** menu (page number,
  page count, date) are filled in per page.
* **Text frames** — `T` draws a frame. When text overflows, a red **+** appears: use **Text ▸ Flow Text into
  a New Frame** (adds a linked frame on the next page, creating the page if needed) or **Autoflow** to
  create as many pages as the story needs. **Text ▸ Link Text Frames** links existing frames in selection
  order; **Unlink** takes a frame out of the chain.
* **Styles panel** — paragraph and character styles (Body, Heading 1–3, Caption, Quote can be added with one
  click). Click to apply, ↻ to redefine from the current formatting.
* **Text ▸ Generate Table of Contents** builds a contents page from paragraphs styled *Heading 1–3*.
* **Tables and charts** are real objects: the **Table tool** (`B`), **Chart tool** (`H`), *Text ▸ Insert Table… / Insert Chart…*, the **Data panel** and the *Table* menu. Click into cells to type, use `Tab` / arrows, drag borders, merge cells, number formats, formulas (`=SUM(B2:B5)`), CSV / spreadsheet paste and import, charts with a data grid or linked to a table, ~20 chart presets. See [Tables and charts](layout-tables-charts.md).
* **Image frame** (`I`) — drop or place an image onto a frame to crop-fill it.
* **Text ▸ Data Merge…** — load a CSV, use `<<Column Name>>` markers in your text, preview records and export
  one merged PDF.
* **Document Setup…** — page size, margins, columns, gutter and bleed.

## Code studio

Build websites: a code editor (explorer, tabs, search, command palette, Emmet, completions) and a visual
designer (live canvas with breakpoints, navigator, element palette, class-based style panel) over the same
HTML, CSS and JavaScript files, stored inside the document. See the [Code studio guide](code-studio.md).

| Key | Action |
| --- | --- |
| `Mod+Shift+P` | Command palette |
| `Mod+P` | Quick open file |
| `Mod+Alt+1` / `2` / `3` | Design / Split / Code view |
| `Mod+Alt+P` | Design mode ↔ live preview |
| `Tab` | Expand an Emmet abbreviation |

## Vibe studio

Describe what you want and an assistant builds it in the other studios, with undo for the whole run. It has no
toolbox of its own: a chat with the *Canvas* live view, and panels for *Activity*, *Models*, *Tools*, *Skills* and
*Knowledge*. AI features must be switched on under *Settings ▸ Artificial intelligence*. See the
[Vibe Studio guide](vibe-studio.md).

| Key | Action |
| --- | --- |
| `Alt+5` | Open Vibe Studio |
| `Enter` / `Shift+Enter` | Send / new line in the composer |
| `/` | Commands and skills in the composer |
| `Esc` | Stop the running request |

Right-click menus gain an **AI** submenu (canvas, code editor, website elements) when AI features are on.

## Office studio

A page-based word processor for Word (.docx), OpenDocument (.odt), RTF, HTML, Markdown and text documents, with
named styles, lists, tables, images, footnotes, headers and footers, find and replace, and export to DOCX, ODT, RTF,
PDF, HTML, Markdown and text. Its workspace replaces the toolbox and dock: a formatting toolbar, an *Outline* /
*Styles* sidebar and the pages. Spreadsheets and presentations are planned for a later version. See the
[Office Studio guide](office-studio.md).

| Key | Action |
| --- | --- |
| *More* menu | Open the Office studio (or add it to the header in Settings ▸ Studios; it then gets an `Alt` shortcut) |
| `Mod+B` / `Mod+I` / `Mod+U` | Bold / italic / underline |
| `Mod+Alt+1` … `Mod+Alt+3` / `Mod+Alt+0` | Heading 1-3 / Normal text |
| `Mod+Shift+L` / `Mod+Shift+N` | Bulleted / numbered list |
| `Tab` / `Shift+Tab` | Indent list item (next / previous cell in a table) |
| `Mod+Enter` | Page break |
| `Mod+K` | Link |
| `Mod+F` / `Mod+H` | Find / replace |

## Export (popup)

Export is **not a studio** — it is a popup that is available from every studio: press the **Export** button in
the header, or `Mod+Shift+E` (*File ▸ Export…*). Its tabs:

* **Image & PDF** — PNG, JPEG, WebP, SVG or PDF of the current page, all pages or the selection, with scale,
  quality, transparency, bleed and crop marks.
* **Slices** — draw slices with the Slice tool (`S`, in the Vector and Layout toolboxes), or create them from the
  selection / from layers, set format and scale per slice, then export them (a ZIP when there is more than one).
* **Website** — appears when the document has a Code studio project: ZIP, single-file pages or a folder, with
  minification and sitemap options.

*File ▸ Quick Export* still exports the current page as PNG, JPEG, WebP, SVG or PDF with default settings.

## Text editing

Click into text to edit. Standard navigation applies (arrows, Home/End, `Mod`+arrows by word, Shift to
select, double-click selects a word, triple-click a paragraph). `Mod+B`, `Mod+I`, `Mod+U` toggle bold,
italic and underline; everything else is in the **Type** panel. Copy / paste keeps formatting inside
OpenFini and falls back to plain text elsewhere. `Esc` leaves text editing.

## Studio registry, the header and the More menu

The studios are defined in `app/src/studios/registry.js`. A new studio is one call:
`registerStudio({ id, label, icon, blurb, order, workspace?, document?, newDocument?, tools?, top?, bottom? })`
(`systemIcon` uses a Shoelace icon instead of an `assets/icons` glyph). The header, More menu, Studio menu, `studio.<id>`
commands, welcome cards, New document dialog and Alt+N shortcuts are all derived from it.

The header shows at most **five** studios (preference `visibleStudios`, default Vector, Pixel, Layout, Code, Vibe). Every
other registered studio is in the **More** menu; opening one from there shows it in place of the More label until you pick
another studio. Choose and order the header studios in **Settings ▸ Studios** (drag or arrow buttons, at least one, never
more than five). Alt+1 to Alt+N follow the header order. The Office studio registers this way and starts in the *More* menu; planned studios (video, motion, render) will too.
