# Proto Studio (Labs preview)

Design application interfaces and prototypes on a canvas that is real HTML and CSS. The design reasons are in
[ADR 0034](adr/0034-proto-studio.md); the full plan, the document model and the build tasks are in the
[concept](concepts/proto-studio.md). This page is the user guide and grows with every task of the plan.

> **Preview.** Proto is being built in steps during the 1.3.x releases. Until the preview ends it is reachable only
> with **Settings ▸ Labs ▸ Proto Studio**. What is there today: the canvas, the drawing tools, auto layout and grid,
> the Pages, Layers and Design panels, undo, and saving. Components, variables, prototyping, code export and the
> assistant follow.

## Turning it on

Open **Settings ▸ Labs** and turn on **Proto Studio**. The studio appears at once in the studio switcher (in the
*More* menu when the header already shows five studios), in **File ▸ New** (*Proto* creates a design with one
desktop frame) and in **File ▸ New Blank** (*Blank Proto Design*, an empty page). Turning the switch off takes effect
at the next start; designs you made stay ordinary files. Opening a design while the switch is off offers to turn it on.

## Designs and files

A design is an ordinary `.ofini` document (kind `proto`, see [file format](file-format.md#proto-designs)). Save,
Save As, autosave, session restore and the History panel work as for every other document; every change is one undo
step. A design saved by a newer version of OpenFini, or one with problems, opens read-only with a notice (Help ▸
Doctor lists the problems).

## Tools

The toolbar at the bottom of the canvas holds the tools; each has a single-key shortcut (they are also in the Insert
and View menus). After drawing a layer the Move tool comes back.

| Tool | Key | How |
| --- | --- | --- |
| Move | V | Select, move, resize and rotate (below) |
| Frame | F | Drag a frame, or click for 100 × 100. The arrow next to it (and Insert ▸ … Frame) adds a device frame: desktop, laptop, tablet, phone, Android phone, watch |
| Rectangle, Ellipse | R, O | Drag; Shift draws a square or circle, Alt draws from the center; a click places 100 × 100 |
| Line | L | Drag from one end to the other; Shift keeps 45° steps |
| Pen | P | Click for corners, drag for curves, click the first point to close; Enter or Escape ends an open path, Backspace removes the last point |
| Text | T | Click for a text that grows with what you type, drag for a fixed width that wraps. Type, then Escape or click elsewhere |
| Hand | H | Drag to pan (Space and the middle mouse button pan with every tool) |
| Zoom | Z | Click to zoom in, Alt-click to zoom out, drag a rectangle to zoom to it |

A new layer goes into the frame under the pointer; in a frame with auto layout it lands in the flow at the pointer.

## Selecting and editing on the canvas

| Action | How |
| --- | --- |
| Select a layer | Click it. A click inside a frame selects the frame's layer under the pointer; with a layer selected, clicks select among its siblings |
| Select the deepest layer | Ctrl-click (Cmd-click on macOS) |
| Go into a frame, edit a text | Double-click (Enter also edits a selected text) |
| Add to or remove from the selection | Shift-click |
| Marquee | Drag on the empty canvas (top-level layers) or on the background of a frame that is not selected (its layers); Shift keeps the selection |
| Move | Drag. Layers snap to the edges and centers of their siblings and parent (pink guides) and show the distances to their neighbors; Shift keeps one axis, Ctrl/Cmd turns snapping off, Alt duplicates. Dropping on another frame moves the layer into it at the same place. A frame can also be dragged by its name |
| Reorder in auto layout | Drag a layer inside its auto layout frame: a line shows where it lands. Drag it out of the frame to take it out |
| Resize | The handles at the corners and edges. Shift keeps the ratio, Alt resizes around the center. Layers inside a frame without auto layout follow their constraints |
| Rotate | Drag just outside a corner; Shift keeps 15° steps |
| Padding and gap | Select an auto layout frame and drag the pink handles in its padding or between its children; Alt changes all sides, Shift the opposite side too |
| Measure | Hold Alt over another layer to see the distances from the selection |
| Nudge | Arrow keys move by 1 pixel (Shift: 10); in auto layout they move the layer one place |
| Next layer | Tab, Shift+Tab |
| Children / parent | Enter selects the children of the selection, Shift+Enter or Escape its parent |
| Select all | Ctrl+A: the siblings of the selection, or every frame of the page |
| Pan and zoom | Scroll (Shift+scroll: sideways), Space-drag, middle mouse button; Ctrl+scroll or pinch zooms; + and − step; Shift+0 is 100 %, Shift+1 fits everything, Shift+2 fits the selection |
| Copy, cut, paste, duplicate, delete | Ctrl+C, Ctrl+X, Ctrl+V (into the selected frame, next to the selection, or to the right of the page's frames), Ctrl+D, Delete |

The **Object** menu and the canvas context menu (right-click) have the layout and arrangement commands:

| Command | Shortcut |
| --- | --- |
| Add Auto Layout: a selected frame without layout arranges its children (direction, gap and padding guessed from where they are); other selections are wrapped in a new auto layout frame | Shift+A |
| Add Grid Layout | Ctrl+Alt+G |
| Remove Auto Layout (the children keep their places) | Alt+Shift+A |
| Group Selection (a frame without layout around the selection), Ungroup | Ctrl+G, Ctrl+Shift+G |
| Bring to Front, Bring Forward, Send Backward, Send to Back | Ctrl+Shift+], Ctrl+], Ctrl+[, Ctrl+Shift+[ |
| Show/Hide, Lock/Unlock (locked layers cannot be selected on the canvas) | Ctrl+Shift+H, Ctrl+Shift+L |
| Rename | F2 |

Every action is one undo step (Ctrl+Z, Ctrl+Shift+Z). Frame names are drawn above the frames. Far zoomed out, small
frames are drawn as simplified boxes until you zoom in again; that keeps very large pages smooth.

## Panels

The panels dock like everywhere else ([workspaces](workspaces.md)).

* **Pages** (left): the pages of the design. Click to show a page, double-click or F2 to rename, Alt+Up/Down to move,
  the trash button or Delete to delete (the last page stays), + to add. The prototype flows of the page are listed
  below; a click shows the flow's first frame.
* **Layers** (left): the layers of the page, top of the list = in front. Click selects, Shift-click selects a range,
  Ctrl-click adds; double-click a name (or F2, Enter) to rename; the eye and lock buttons hide and lock; drag rows to
  reorder or to move layers into another frame (the middle of a frame's row drops inside); the search field filters by
  name. Arrow keys move through the list, Left and Right close and open, Delete deletes. Only the rows in view are
  built, so pages with many thousands of layers stay fast.
* **Design** (right): the properties of the selection; a change applies to every selected layer. *Position* (X, Y,
  rotation, align buttons, constraints for layers in frames without auto layout, *Ignore auto layout* and grid cells
  for children of an auto layout); *Size* (fixed, hug contents, fill container, relative, minimum and maximum);
  *Auto layout* (none, auto layout or grid; direction, wrap, gaps, padding, a 3 × 3 alignment matrix, justify and
  align; grid columns and rows written like `1fr 240px auto minmax(200px, 1fr)`; clip content); *Appearance* (opacity,
  blend mode, corner radius, also per corner); *Fill*, *Stroke* and *Effects* lists (solid and gradient fills, inside,
  center and outside strokes, drop and inner shadows, layer and background blur); *Text* (font, size, weight, line
  height, letter spacing, alignment, case, decoration, color, auto width / auto height / fixed size, maximum lines);
  *Accessibility and code* (HTML element, role, accessible name); *Export* comes with code export. Drag a field's
  label to scrub a value. With nothing selected the panel shows the page's name and background.

## For developers

Code: `app/src/studios/proto.js` (definition, menus, Labs switch), `app/src/proto/` (host, workspace, renderer) and
the pure engine in `app/src/engine/proto/`. The renderer and its performance are described in the concept
([§4](concepts/proto-studio.md#4-rendering)); `node scripts/proto-perf.mjs` measures the targets of §4.3 in a headless
Chromium-based browser, and `tests/proto/perf/bench.html` runs the same benchmark by hand in any browser
(`node scripts/serve.mjs --root .`, then open `/tests/proto/perf/bench.html`).
