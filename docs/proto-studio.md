# Proto Studio (Labs preview)

Design application interfaces and prototypes on a canvas that is real HTML and CSS. The design reasons are in
[ADR 0034](adr/0034-proto-studio.md); the full plan, the document model and the build tasks are in the
[concept](concepts/proto-studio.md). This page is the user guide and grows with every task of the plan.

> **Preview.** Proto is being built in steps during the 1.3.x releases. Until the preview ends it is reachable only
> with **Settings ▸ Labs ▸ Proto Studio**. What is there today: the canvas, the drawing tools, auto layout and grid,
> the Pages, Layers and Design panels, undo, saving, editing together in a collaboration room and the assistant's
> tools. Panels for components and variables, prototyping and code export follow.

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
  below: the play button plays a flow, a click shows its first frame, double-click renames, + adds a flow at the
  selected frame (or the page's first frame).
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
  label to scrub a value. With nothing selected the panel shows the page's name and background. The *Prototype* tab
  next to *Design* switches to Prototype mode ([Prototypes](#prototypes)).

## Prototypes

A prototype is the design made clickable: layers react to the pointer, keys and time, screens follow each other with
animated transitions, and the result plays like the finished app.

**Prototype mode.** Click *Prototype* at the top of the Design panel (or *Prototype ▸ Prototype Mode*, Shift+E
switches). The canvas shows every connection as an arrow from a layer to the frame it opens (dashed for overlays and
scrolling), *Back* and *Close* marks, and a ▶ badge above each flow's first frame. The selected layer gets a round
handle at its right edge: **drag it onto a frame** to make a click there navigate to that frame (one undo step); drag
an existing connection's handle onto empty canvas to remove it. Selecting, moving and resizing work as in Design mode.

**Interactions** (the Prototype panel, for one selected layer). Each interaction has a trigger and a list of actions:

| Triggers | Actions |
| --- | --- |
| On click, On double click, While pressing, While hovering, Mouse enter, Mouse leave, On drag, Key (with Shift, Alt, Ctrl, Cmd/Win), After delay, Variable changes | Navigate to, Back, Scroll to, Open overlay (position, dimmed background, close when clicking outside), Swap overlay, Close overlay, Change to variant, Set variable, Conditional (if, then, else), Open link |

*While hovering* and *While pressing* last as long as the pointer: the variants, variables and overlays they changed
come back when it leaves or is released. *Change to variant* switches the instance the layer belongs to (or a chosen
instance); put the interaction on a variant of a component set (for example `state=default` → `state=hover`) and
every instance reacts. *Set variable* takes a value (`true`, `3`, text) or an expression such as `{ "op": "not",
"args": [{ "var": "v1" }] }`; *Toggle* flips a boolean. Layers bound to variables (visibility, text, colors) update
as the prototype changes them. *Open link* opens http(s), mailto and tel links after the usual confirmation.

**Transitions** (navigate, back, overlays, variants): Instant, Dissolve, Move in, Move out, Push, Slide (with a
direction) and **Smart animate**, with an easing (linear, ease, ease in, ease out, ease in and out, or a spring that
takes as long as it needs to settle) and a duration. Smart animate matches the layers of the two screens: the same
layer, the only instances of one component, then layers with the same name path (give corresponding layers the same
names), then the layers inside matched instances; they move, resize and change color, opacity and corner radius from
the old screen to the new one. Layers only one screen has fade.

**Scrolling** (Prototype panel). *Overflow scrolling* lets a frame scroll content that does not fit (vertical,
horizontal or both); *When scrolling* makes a layer in auto layout stick to the top, bottom, left or right edge of its
scrolling frame (a fixed header or tab bar).

**Flows** are named starting points. Add one in the Pages panel, with *Add flow starting point* in the Prototype panel
of a top-level frame, or *Prototype ▸ Add Flow Starting Point*.

**Playing.** *Prototype ▸ Preview Prototype* (Ctrl+Alt+Enter, Cmd+Option+Return on a Mac) plays the selection's frame,
else the page's first flow; *Preview in New Window* opens the player in a window of its own (a separate window on the
desktop, a pop-up window in the browser), which keeps reading the design as you edit. The player has a flow picker,
Back, Restart (R), the device frame (phone, tablet, watch or desktop by the frame's size) and hotspot hints: a click
that hits nothing flashes the layers that react. Keys: R restarts, ← and → go to the previous and next flow, Backspace
goes back, Esc closes the player in the app. Edits made while the player is open show from the next screen or after
a restart.

## Editing together

A design can be shared live in a collaboration room like every other document
([collaboration](collaboration.md#live-editing-edit-together-beta)): right-click the document tab or use **File ▸ Share with Collaboration Room…** and choose *Share as linked live
document*. Everyone who opens it edits the same design.

* **What merges**: each layer travels as a few parts (structure and name, geometry, layout, look, content, component
  data, prototype data), and pages, variables, collections and styles each on their own. Two people who change
  different parts merge: one changes the fill of a button while the other moves it, and both changes stay. When two
  people change the same part of the same layer at the same moment, the later change wins on every device and the one
  whose change was replaced gets a notice.
* **Moves never break the tree**: when someone deletes a frame while you move a layer into it, your layer stays, at
  the top level of the page. Two moves that would put two frames inside each other are resolved the same way on every
  device.
* **Undo** reverts only your own steps, on top of what the others did since.
* **Presence**: the others' pointers (with their names) and the outlines of what they selected are drawn on the canvas
  of the page you are looking at, in their colors. *Follow* in the Collaboration window shows their page and what they
  see.
* Images travel in parts, so a large image arrives a little after the layer that shows it. Members who join later get
  the current design.

## Assistant

With a design open, the Vibe assistant works in it through the tool group **Proto**. Every change it makes is one
undo step labeled *Vibe: …* and is listed in the AI log like every tool call; the design engine checks each change, so
a tool call either applies completely or not at all.

| Tool | What it does |
| --- | --- |
| `proto_describe` | Outline of the design: one line per layer (id, type, name, size as px, hug or fill, auto layout, fills, text, bindings), components, variables with their modes, styles |
| `proto_get_node`, `proto_search` | Full JSON of layers (stored or resolved); find layers by name, text, type, component, variable or unbound values |
| `proto_screenshot` | A picture of a frame for the assistant to look at; with `compare` next to a reference image with a difference score |
| `proto_new` | A new design (empty, desktop or phone frame) |
| `proto_create` | Whole screens or components from one nested spec: auto layout (rows, columns, grids), hug, fill and fixed sizes, fills, strokes, radius, shadows, text, instances, `{ "$var": "color/primary" }` bindings |
| `proto_update`, `proto_move`, `proto_delete`, `proto_duplicate` | Change fields (shorthands and paths such as `layout.gap`), bind variables, reorder, reparent, wrap in auto layout |
| `proto_component` | Make components, combine variants, define and bind properties, create, set, swap, override, reset and detach instances |
| `proto_variables`, `proto_styles`, `proto_tokens` | Collections, modes (light and dark, brands), variables and aliases, mode per frame; text, effect, fill and grid styles; DTCG import and export, CSS, Tailwind and Swift |
| `proto_lint`, `proto_fix` | Contrast, touch targets, unbound colors and spacing, spacing off the 4 px grid, values that equal a style, stale overrides, detached copies of components, empty frames, default names, cut-off text, unused tokens; fixes as one undo step |
| `proto_responsive` | The frame at several widths: what overflows and which text is cut off |
| `proto_content`, `proto_rename` | Realistic text (names, prices, dates or values you give); semantic names and HTML tags |
| `proto_from_screenshot` | An attached screenshot as a locked reference layer next to an empty frame, with its colors and recognized text (a local text recognition engine where installed), to rebuild it as editable layers |

The pictures of `proto_screenshot` come from the layout solver (concept §4.4) painted with the app's fonts, not from
the canvas itself, so they can differ slightly from what you see (text widths, blur effects). Skills for common jobs
(*design a screen from a brief*, *screenshot to editable design*, *component with variants*, *tokens and dark mode*,
*prepare for handoff*, *design system audit*) and the studio guide load on demand.

## For developers

Code: `app/src/studios/proto.js` (definition, menus, Labs switch), `app/src/proto/` (host, workspace, renderer) and
the pure engine in `app/src/engine/proto/`. Live collaboration is the records adapter `app/src/proto/collab.js`
(records, validation and tree repair in its header; tests in `tests/proto/collab.test.js`) and
`app/src/proto/presence.js`. The assistant's tools are `app/src/vibe/tools/proto.js` (definitions) with
`app/src/proto/ai-ops.js` (pure: outline, specs to operations, content, names, responsive check),
`app/src/proto/ai-render.js` (display list and canvas painter), `app/src/proto/ai-runtime.js` (undo step, images) and
`app/src/engine/proto/lint.js` (rules and fixes, shared with the MCP server and the CLI); skills in
`app/src/ai/packs/proto.js` and the studio guide in `app/src/ai/packs/studio-guides.js`. The renderer and its
performance are described in the concept
([§4](concepts/proto-studio.md#4-rendering)); `node scripts/proto-perf.mjs` measures the targets of §4.3 in a headless
Chromium-based browser, and `tests/proto/perf/bench.html` runs the same benchmark by hand in any browser
(`node scripts/serve.mjs --root .`, then open `/tests/proto/perf/bench.html`). Prototypes: the model, operations and
smart animate matching are `app/src/engine/proto/interactions.js` with the expression language `expr.js`; the player is
`app/src/proto/player/` (`state.js` the pure state machine, `render.js` one screen, `animate.js` transitions with the
Web Animations API, `player.js` the UI); the Prototype panel `app/src/proto/panels/prototype.js`, the connections
`app/src/proto/tools/connect.js`; tests in `tests/proto/{interactions,expr,player-state}.test.js`.
